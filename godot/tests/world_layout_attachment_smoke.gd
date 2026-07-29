extends SceneTree

const LayoutAttachment = preload(
	"res://addons/mapsoo_importer/mapsoo_world_layout_attachment.gd"
)
const PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]
const PROFILE_MODES := {
	"side-platformer": ["bands", "side-solids", "platform-links"],
	"topdown-farm": ["zones", "topdown-obstacles", "orthogonal-grid"],
	"isometric-action": ["zones", "isometric-footprints", "diamond-grid"],
	"layered-depth-2d": ["zones", "depth-lane-blockers", "depth-lanes"],
}
const TEST_ROOT := "user://mapsoo-world-layout-attachment-smoke"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TEST_ROOT)) != OK:
		_fail("Unable to create WorldLayoutPlan smoke directory.")
		return
	var absent := LayoutAttachment.validate_optional(
		{"profile": "topdown-farm", "files": [], "provenance": {"seed": "layout-seed"}},
		TEST_ROOT,
		"a".repeat(64)
	)
	if not absent.ok or absent.status != "absent":
		_fail("No-layout backward compatibility failed: %s" % absent)
		return

	for profile: String in PROFILES:
		var fixture := _write_fixture(profile)
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var validated := LayoutAttachment.validate_optional(
			fixture.manifest,
			fixture.root,
			fixture.manifest_sha256
		)
		if not validated.ok or validated.status != "bound":
			_fail("%s attachment validation failed: %s" % [profile, validated])
			return
		var world := Node2D.new()
		world.name = "MapsooWorld"
		world.set_meta("mapsoo_profile", profile)
		var binding := LayoutAttachment.bind_scene(world, validated.layout)
		if not binding.ok:
			world.free()
			_fail("%s scene binding failed: %s" % [profile, binding])
			return
		var packed := PackedScene.new()
		if packed.pack(world) != OK:
			world.free()
			_fail("%s layout scene could not be packed." % profile)
			return
		var scene_path: String = fixture.root.path_join("bound-scene.tscn")
		if ResourceSaver.save(packed, scene_path) != OK:
			world.free()
			_fail("%s layout scene could not be saved." % profile)
			return
		world.free()
		var loaded := ResourceLoader.load(
			scene_path,
			"PackedScene",
			ResourceLoader.CACHE_MODE_IGNORE_DEEP
		) as PackedScene
		if loaded == null:
			_fail("%s saved layout scene could not be loaded." % profile)
			return
		var staged := loaded.instantiate()
		var staged_check := LayoutAttachment.validate_bound_scene(
			staged,
			validated.layout
		)
		staged.free()
		if not staged_check.ok:
			_fail("%s staged layout metadata failed: %s" % [profile, staged_check])
			return

	if not _negative_cases():
		return
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print("MAPSOO_WORLD_LAYOUT_ATTACHMENT_OK profiles=4 absent=1 negative=8")
	quit(0)


func _negative_cases() -> bool:
	var fixture := _write_fixture("topdown-farm", "negative")
	if not fixture.ok:
		_fail(str(fixture.error))
		return false

	var wrong_profile: Dictionary = fixture.manifest.duplicate(true)
	wrong_profile.profile = "isometric-action"
	if LayoutAttachment.validate_optional(
		wrong_profile, fixture.root, fixture.manifest_sha256
	).ok:
		return _negative_fail("Profile mismatch was accepted.")

	var wrong_seed: Dictionary = fixture.manifest.duplicate(true)
	wrong_seed.provenance.seed = "different-seed"
	if LayoutAttachment.validate_optional(
		wrong_seed, fixture.root, fixture.manifest_sha256
	).ok:
		return _negative_fail("Seed mismatch was accepted.")

	var wrong_binding: Dictionary = fixture.manifest.duplicate(true)
	wrong_binding.layout.sha256 = "b".repeat(64)
	if LayoutAttachment.validate_optional(
		wrong_binding, fixture.root, fixture.manifest_sha256
	).ok:
		return _negative_fail("Manifest/file digest mismatch was accepted.")

	var unsafe_path: Dictionary = fixture.manifest.duplicate(true)
	unsafe_path.layout.path = "../world-layout-plan.json"
	if LayoutAttachment.validate_optional(
		unsafe_path, fixture.root, fixture.manifest_sha256
	).ok:
		return _negative_fail("Non-canonical attachment path was accepted.")

	var missing_record: Dictionary = fixture.manifest.duplicate(true)
	missing_record.files = []
	if LayoutAttachment.validate_optional(
		missing_record, fixture.root, fixture.manifest_sha256
	).ok:
		return _negative_fail("Missing files record was accepted.")

	var unbound_manifest: Dictionary = fixture.manifest.duplicate(true)
	unbound_manifest.erase("layout")
	if LayoutAttachment.validate_optional(
		unbound_manifest, fixture.root, fixture.manifest_sha256
	).ok:
		return _negative_fail("Unbound attachment file was accepted.")

	var tampered_plan: Dictionary = fixture.plan.duplicate(true)
	tampered_plan.traversal.edges[0].to = "missing-node"
	var tampered_fixture := _write_fixture(
		"topdown-farm",
		"tampered-graph",
		tampered_plan
	)
	if tampered_fixture.ok and LayoutAttachment.validate_optional(
		tampered_fixture.manifest,
		tampered_fixture.root,
		tampered_fixture.manifest_sha256
	).ok:
		return _negative_fail("Dangling traversal edge was accepted.")

	var wrong_intent: Dictionary = fixture.plan.duplicate(true)
	wrong_intent.collision_intent.mode = "side-solids"
	var intent_fixture := _write_fixture(
		"topdown-farm",
		"wrong-intent",
		wrong_intent
	)
	if intent_fixture.ok and LayoutAttachment.validate_optional(
		intent_fixture.manifest,
		intent_fixture.root,
		intent_fixture.manifest_sha256
	).ok:
		return _negative_fail("Profile collision intent mismatch was accepted.")
	return true


func _write_fixture(
	profile: String,
	suffix: String = "",
	provided_plan: Dictionary = {}
) -> Dictionary:
	var root := TEST_ROOT.path_join(profile + (("-" + suffix) if not suffix.is_empty() else ""))
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(root)) != OK:
		return {"ok": false, "error": "Unable to create fixture directory."}
	var plan := provided_plan if not provided_plan.is_empty() else _plan(profile)
	var bytes := (JSON.stringify(plan, "", true) + "\n").to_utf8_buffer()
	var path := root.path_join(LayoutAttachment.ATTACHMENT_PATH)
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return {"ok": false, "error": "Unable to write fixture plan."}
	file.store_buffer(bytes)
	file.close()
	var digest := _sha256(bytes)
	var manifest := {
		"profile": profile,
		"provenance": {"seed": "layout-seed"},
		"layout": {
			"schema_version": "1.0.0",
			"document_type": "world-layout-plan",
			"plan_id": plan.plan_id,
			"path": "world-layout-plan.json",
			"sha256": digest,
		},
		"files": [{
			"path": "world-layout-plan.json",
			"media_type": "application/json",
			"bytes": bytes.size(),
			"sha256": digest,
		}],
	}
	return {
		"ok": true,
		"root": root,
		"plan": plan,
		"manifest": manifest,
		"manifest_sha256": "a".repeat(64),
	}


func _plan(profile: String) -> Dictionary:
	var modes: Array = PROFILE_MODES[profile]
	var terrain := [
		_terrain("ground-a", 0, 28, 16, 8, "earth", "walkable"),
		_terrain("ground-b", 16, 26, 16, 10, "stone", "walkable"),
		_terrain("ground-c", 32, 24, 16, 12, "grass", "walkable"),
		_terrain("blocked-a", 48, 20, 16, 16, "rock", "blocked"),
	]
	if profile == "side-platformer":
		terrain.append(_terrain("one-way-a", 20, 18, 12, 2, "wood", "one-way"))
	if profile in ["side-platformer", "isometric-action"]:
		terrain.append(_terrain("water-a", 42, 28, 6, 8, "water", "blocked"))
	var edge_ids := ["edge-a", "edge-b", "edge-c", "edge-d", "edge-e"]
	var solid_terrain_ids := ["blocked-a"]
	if profile in ["side-platformer", "isometric-action"]:
		solid_terrain_ids.append("water-a")
	return {
		"schema_version": "1.0.0",
		"document_type": "world-layout-plan",
		"status": "planned",
		"plan_id": "%s-layout" % profile,
		"profile": profile,
		"source": {
			"intake_id": "confirmed-intake",
			"session_revision": 4,
			"intake_sha256": "1".repeat(64),
			"map_layout_checkpoint_sha256": "2".repeat(64),
			"seed": "layout-seed",
			"seed_sha256": _sha256(JSON.stringify("layout-seed").to_utf8_buffer()),
		},
		"bounds": {"width": 64, "height": 36, "unit": "logical-tile"},
		"regions": [
			_region("spawn-region", 0, "spawn"),
			_region("route-region", 12, "route"),
			_region("landmark-a-region", 24, "landmark"),
			_region("landmark-b-region", 36, "landmark"),
			{"id": "exit-region", "x": 48, "y": 0, "width": 16, "height": 36, "purpose": "exit"},
		],
		"terrain_layout": {
			"kind": modes[0],
			str(modes[0]): terrain,
		},
		"spawn": {"node_id": "spawn-node", "x": 4, "y": 28},
		"exit": {"node_id": "exit-node", "x": 56, "y": 20},
		"traversal": {
			"nodes": [
				_node("spawn-node", "spawn", "spawn-region", 4, 28),
				_node("route-a-node", "route", "route-region", 16, 26),
				_node("landmark-a-node", "landmark", "landmark-a-region", 28, 24),
				_node("route-b-node", "route", "route-region", 20, 22),
				_node("landmark-b-node", "landmark", "landmark-b-region", 40, 22),
				_node("exit-node", "exit", "exit-region", 56, 20),
			],
			"edges": [
				_edge("edge-a", "spawn-node", "route-a-node"),
				_edge("edge-b", "route-a-node", "landmark-a-node"),
				_edge("edge-c", "landmark-a-node", "route-b-node"),
				_edge("edge-d", "route-b-node", "landmark-b-node"),
				_edge("edge-e", "landmark-b-node", "exit-node"),
			],
		},
		"landmarks": [
			_landmark("landmark-a", "First landmark", "landmark-a-region", "landmark-a-node", 28, 24),
			_landmark("landmark-b", "Second landmark", "landmark-b-region", "landmark-b-node", 40, 22),
		],
		"collision_intent": {
			"mode": modes[1],
			"solid_terrain_ids": solid_terrain_ids,
			"one_way_terrain_ids": ["one-way-a"] if profile == "side-platformer" else [],
			"blocked_region_ids": [],
		},
		"navigation_intent": {
			"mode": modes[2],
			"walkable_region_ids": [
				"spawn-region", "route-region", "landmark-a-region",
				"landmark-b-region", "exit-region",
			],
			"traversal_edge_ids": edge_ids,
			"agent_radius": 0.5,
		},
	}


func _region(id: String, x: int, purpose: String) -> Dictionary:
	return {"id": id, "x": x, "y": 0, "width": 12, "height": 36, "purpose": purpose}


func _terrain(
	id: String,
	x: int,
	y: int,
	width: int,
	height: int,
	material: String,
	navigation: String
) -> Dictionary:
	return {
		"id": id, "x": x, "y": y, "width": width, "height": height,
		"material": material, "navigation": navigation,
	}


func _node(id: String, kind: String, region: String, x: int, y: int) -> Dictionary:
	return {"id": id, "kind": kind, "region_id": region, "x": x, "y": y}


func _edge(id: String, from: String, to: String) -> Dictionary:
	return {
		"id": id, "from": from, "to": to, "kind": "walk",
		"direction": "bidirectional",
	}


func _landmark(
	id: String,
	label: String,
	region: String,
	node: String,
	x: int,
	y: int
) -> Dictionary:
	return {
		"id": id, "label": label, "region_id": region, "node_id": node,
		"x": x, "y": y,
	}


func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()


func _negative_fail(message: String) -> bool:
	_fail(message)
	return false


func _fail(message: String) -> void:
	push_error(message)
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	quit(1)


func _remove_tree(path: String) -> void:
	if not DirAccess.dir_exists_absolute(path):
		return
	var directory := DirAccess.open(path)
	if directory == null:
		return
	for child: String in directory.get_directories():
		_remove_tree(path.path_join(child))
	for filename: String in directory.get_files():
		DirAccess.remove_absolute(path.path_join(filename))
	DirAccess.remove_absolute(path)
