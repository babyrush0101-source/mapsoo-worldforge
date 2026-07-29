extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const RECIPE_PATH := "res://tests/fixtures/pack10/public-fixture.json"
const OUTPUT_ROOT := "res://mapsoo_imports"
const DIRECTIONS := ["left", "right", "near", "far"]
const PLAYER_ACTIONS := ["idle", "walk", "run", "interact"]
const NPC_ACTIONS := ["idle", "talk"]
const PLANE_BINDINGS := [
	["sky", "background.sky", "layers/sky.png", "mix"],
	["far", "background.far", "layers/far.png", "mix"],
	["mid", "background.mid", "layers/mid.png", "mix"],
	["depth-fog", "background.depth-fog", "layers/depth-fog.png", "mix"],
	["near", "near.overlay", "layers/near.png", "mix"],
	["ambient-light", "lighting.ambient", "layers/ambient.png", "multiply"],
	["local-light", "lighting.local", "layers/local.png", "add"],
	["foreground", "foreground.overlay", "layers/foreground.png", "mix"],
]
const ENVIRONMENT_ROLES := [
	"terrain.ground", "terrain.path", "terrain.edge", "terrain.bridge", "terrain.stairs",
	"terrain.water", "prop.tree", "prop.rock", "prop.crate", "prop.sign", "prop.lamp",
	"prop.occluder", "structure.entrance", "structure.exit", "structure.checkpoint",
	"structure.landmark", "collectible.primary", "collectible.health", "effect.footstep",
	"effect.interact", "effect.portal", "effect.ambient",
]
const TEST_IDS := [
	"neutral-pack10-public-smoke",
	"neutral-pack10-internal-smoke",
	"neutral-pack10-private-smoke",
	"neutral-pack10-script-rejection",
	"neutral-pack10-shader-rejection",
	"neutral-pack10-url-rejection",
	"neutral-pack10-absolute-rejection",
	"neutral-pack10-traversal-rejection",
	"neutral-pack10-layout-smoke",
	"neutral-pack10-autotile-rejection",
]


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var recipe := _read_json(RECIPE_PATH)
	if recipe.get("schema_version") != "mapsoo-godot-pack10-fixture-recipe/1.0" \
			or recipe.get("synthetic") != true \
			or recipe.get("contains_generative_ai") != false \
			or recipe.get("contains_source_references") != false \
			or recipe.get("contains_raw_prompts") != false:
		_fail("Neutral Pack 1.0 fixture recipe is invalid.")
		return
	for id: String in TEST_IDS:
		_remove_tree("%s/%s" % [OUTPUT_ROOT, id])

	var public_path := _materialize(recipe, TEST_IDS[0], "public")
	if public_path.is_empty():
		return
	var public_result := Importer.import_pack(public_path)
	if not public_result.ok or not _validate_scene(
		public_result.scene_path, "public", "CC0-1.0", "public",
	):
		_fail("Public Pack 1.0 import failed: %s" % public_result.errors)
		return
	var layout_path := _materialize(recipe, TEST_IDS[8], "public", "layout")
	if layout_path.is_empty():
		return
	var layout_result := Importer.import_pack(layout_path)
	var layout_state := _read_json(str(layout_result.get("state_path", "")))
	var layout_importer: Dictionary = layout_state.get("importer", {})
	if not layout_result.ok or not _validate_scene(
		layout_result.scene_path, "public", "CC0-1.0", "public", true,
	) or layout_importer.get("version") != "1.0.0-layout.4":
		_fail("WorldLayoutPlan-bound Pack 1.0 import failed: %s" % layout_result.errors)
		return
	var autotile_attack_path := _materialize(
		recipe, TEST_IDS[9], "public", "autotile-hash"
	)
	if autotile_attack_path.is_empty():
		return
	var autotile_rejected := Importer.import_pack(autotile_attack_path)
	if autotile_rejected.ok or not _errors_contain(
		autotile_rejected.errors, "terrain_autotiles"
	):
		_fail("Pack 1.0 accepted a terrain autotile chained-hash mismatch.")
		return

	var internal_path := _materialize(recipe, TEST_IDS[1], "internal-review")
	if internal_path.is_empty():
		return
	var denied_internal := Importer.import_pack(internal_path)
	if denied_internal.ok or not _errors_contain(denied_internal.errors, "authorization"):
		_fail("Internal-review Pack 1.0 was not caller-grant gated.")
		return
	var internal_grant := _grant(TEST_IDS[1], "internal-review", "local-review-grant-001")
	var internal_result := Importer.import_pack(internal_path, OUTPUT_ROOT, internal_grant)
	if not internal_result.ok or not _validate_scene(
		internal_result.scene_path,
		"internal-review",
		"LicenseRef-UNRELEASED",
		"local-review-grant-001",
	):
		_fail("Internal-review Pack 1.0 explicit grant failed: %s" % internal_result.errors)
		return

	var private_path := _materialize(recipe, TEST_IDS[2], "private")
	if private_path.is_empty():
		return
	var wrong_grant := _grant("another-pack", "private", "local-private-grant-001")
	var denied_private := Importer.import_pack(private_path, OUTPUT_ROOT, wrong_grant)
	if denied_private.ok or not _errors_contain(denied_private.errors, "authorization"):
		_fail("Private Pack 1.0 accepted a grant for another pack.")
		return
	var private_grant := _grant(TEST_IDS[2], "private", "local-private-grant-001")
	var private_result := Importer.import_pack(private_path, OUTPUT_ROOT, private_grant)
	if not private_result.ok or not _validate_scene(
		private_result.scene_path,
		"private",
		"LicenseRef-Private-Use",
		"local-private-grant-001",
	):
		_fail("Private Pack 1.0 explicit grant failed: %s" % private_result.errors)
		return

	for attack_index: int in 5:
		var attack: String = ["script", "shader", "url", "absolute", "traversal"][attack_index]
		var attack_path := _materialize(recipe, TEST_IDS[3 + attack_index], "public", attack)
		if attack_path.is_empty():
			return
		var rejected := Importer.import_pack(attack_path)
		if rejected.ok:
			_fail("Pack 1.0 accepted forbidden %s content." % attack)
			return

	for id: String in TEST_IDS:
		_remove_tree("%s/%s" % [OUTPUT_ROOT, id])
	print(
		"MAPSOO_PACK10_CONTROLLED_OK schema=1.0.0-draft.1"
		+ " public=pass internal-review=grant-gated private=grant-gated"
		+ " scripts=reject shaders=reject urls=reject absolute=reject traversal=reject"
		+ " autotile-tamper=reject",
	)
	quit(0)


func _materialize(
	recipe: Dictionary,
	pack_id: String,
	distribution: String,
	attack := "",
) -> String:
	var root := "user://pack10-fixtures/%s" % pack_id
	_remove_tree(root)
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(root)) != OK:
		_fail("Unable to create Pack 1.0 fixture root.")
		return ""
	var paths: Array[String] = []
	for index: int in PLANE_BINDINGS.size():
		var path := str(PLANE_BINDINGS[index][2])
		if not _write_png(
			root.path_join(path), 320, 180,
			Color.from_string(str(recipe.palette[index % recipe.palette.size()]), Color.BLACK),
		):
			return ""
		paths.append(path)
	if not _write_environment_atlas(root.path_join("atlases/environment.png")):
		return ""
	if not _write_character_atlas(root.path_join("atlases/player.png"), 32):
		return ""
	if not _write_character_atlas(root.path_join("atlases/npc.png"), 16):
		return ""
	if not _write_png(root.path_join("previews/world.png"), 320, 180, Color("#52786e")):
		return ""
	paths.append_array([
		"atlases/environment.png", "atlases/player.png", "atlases/npc.png",
		"previews/world.png",
	])
	var scene := {
		"schema_version": "mapsoo-controlled-scene/1.0",
		"synthetic": true,
		"canvas": {"width": 320, "height": 180},
		"spawn": {"x": 32, "y": 132},
		"placements": [
			{"id": "entry", "role": "structure.entrance", "x": 32, "y": 132},
			{"id": "checkpoint", "role": "structure.checkpoint", "x": 160, "y": 116},
			{"id": "exit-art", "role": "structure.exit", "x": 288, "y": 132},
			{"id": "player", "role": "character.player.atlas", "x": 32, "y": 132},
			{"id": "guide", "role": "character.npc.atlas", "x": 208, "y": 132},
		],
	}
	var collision := {
		"schema_version": "mapsoo-controlled-collision/1.0",
		"synthetic": true,
		"bounds": {"x": 0, "y": 0, "width": 320, "height": 180},
		"solids": [
			{"id": "ground", "x": 0, "y": 148, "width": 320, "height": 32},
		],
	}
	var navigation := {
		"schema_version": "mapsoo-controlled-navigation/1.0",
		"synthetic": true,
		"nodes": [
			{"id": "spawn", "x": 32, "y": 132},
			{"id": "checkpoint", "x": 160, "y": 116},
			{"id": "exit", "x": 288, "y": 132},
		],
		"edges": [
			{"from": "spawn", "to": "checkpoint"},
			{"from": "checkpoint", "to": "exit"},
		],
	}
	for record: Array in [
		["runtime/scene.json", scene],
		["runtime/collision.json", collision],
		["runtime/navigation.json", navigation],
	]:
		if not _write_json(root.path_join(str(record[0])), record[1]):
			return ""
		paths.append(str(record[0]))
	var notice_path := root.path_join("license-assets.md")
	if not _write_text(
		notice_path,
		"# Asset license\n\nSynthetic fixture output; see the manifest license identifier.\n",
	):
		return ""
	paths.append("license-assets.md")

	var manifest := _manifest(recipe, pack_id, distribution, paths, root)
	if attack in ["layout", "autotile-hash"]:
		var plan := _layout_plan()
		if not _write_json(root.path_join("world-layout-plan.json"), plan):
			return ""
		var layout_record := _file_record(
			root, "world-layout-plan.json", "application/json"
		)
		manifest.files.append(layout_record)
		manifest.layout = {
			"schema_version": "1.0.0",
			"document_type": "world-layout-plan",
			"plan_id": plan.plan_id,
			"path": "world-layout-plan.json",
			"sha256": layout_record.sha256,
		}
		var palette := {
			"schema_version": "1.0.0",
			"document_type": "world-material-palette",
			"palette_id": "palette-neutral-layered-layout",
			"profile": "layered-depth-2d",
			"layout": {
				"plan_id": plan.plan_id,
				"sha256": layout_record.sha256,
			},
			"entries": [
				{
					"material": "earth",
					"role": "terrain.ground",
					"rendering": "single-cell",
				},
				{
					"material": "grass",
					"role": "terrain.path",
					"rendering": "single-cell",
				},
				{
					"material": "rock",
					"role": "terrain.water",
					"rendering": "single-cell",
				},
				{
					"material": "stone",
					"role": "terrain.edge",
					"rendering": "single-cell",
				},
			],
		}
		if not _write_json(root.path_join("world-material-palette.json"), palette):
			return ""
		var palette_record := _file_record(
			root, "world-material-palette.json", "application/json"
		)
		manifest.files.append(palette_record)
		manifest.material_palette = {
			"schema_version": "1.0.0",
			"document_type": "world-material-palette",
			"palette_id": palette.palette_id,
			"layout_plan_sha256": layout_record.sha256,
			"path": "world-material-palette.json",
			"sha256": palette_record.sha256,
		}
		var autotile_entries: Array = []
		for entry_value: Variant in palette.entries:
			var entry: Dictionary = entry_value
			var material := str(entry.material)
			var image_path := "terrain-autotiles/%s.png" % material
			if not _write_autotile_png(root.path_join(image_path), autotile_entries.size()):
				return ""
			var image_record := _file_record(root, image_path, "image/png")
			manifest.files.append(image_record)
			var tiles: Array = []
			for mask: int in range(16):
				tiles.append({
					"mask": mask,
					"column": mask % 4,
					"row": mask / 4,
				})
			autotile_entries.append({
				"material": material,
				"role": entry.role,
				"image": {
					"path": image_path,
					"sha256": image_record.sha256,
					"width": 256,
					"height": 128,
				},
				"tiles": tiles,
			})
		var autotiles := {
			"schema_version": "1.0.0",
			"document_type": "world-terrain-autotile-set",
			"set_id": "autotiles-neutral-layered-layout",
			"profile": "layered-depth-2d",
			"layout": {
				"plan_id": plan.plan_id,
				"sha256": layout_record.sha256,
			},
			"palette": {
				"palette_id": palette.palette_id,
				"sha256": palette_record.sha256,
			},
			"selection": {
				"kind": "edge-mask-16",
				"bit_order": ["north", "east", "south", "west"],
				"outside": "different-material",
			},
			"cell": {"width": 64, "height": 32},
			"entries": autotile_entries,
		}
		if not _write_json(root.path_join("world-terrain-autotiles.json"), autotiles):
			return ""
		var autotile_record := _file_record(
			root, "world-terrain-autotiles.json", "application/json"
		)
		manifest.files.append(autotile_record)
		manifest.terrain_autotiles = {
			"schema_version": "1.0.0",
			"document_type": "world-terrain-autotile-set",
			"set_id": autotiles.set_id,
			"layout_plan_sha256": layout_record.sha256,
			"material_palette_sha256": palette_record.sha256,
			"path": "world-terrain-autotiles.json",
			"sha256": autotile_record.sha256,
		}
		if attack == "autotile-hash":
			manifest.terrain_autotiles.material_palette_sha256 = "f".repeat(64)
	elif attack in ["script", "shader"]:
		var extension := "gd" if attack == "script" else "gdshader"
		var payload_path := "payload.%s" % extension
		var payload := "extends Node\n" if attack == "script" else "shader_type canvas_item;\n"
		if not _write_text(root.path_join(payload_path), payload):
			return ""
		manifest.files.append(_file_record(root, payload_path, "text/markdown"))
	elif attack in ["url", "absolute", "traversal"]:
		manifest.planes[0].path = {
			"url": "https://example.invalid/sky.png",
			"absolute": "C:/controlled/sky.png",
			"traversal": "../sky.png",
		}[attack]
	var manifest_path := root.path_join("mapsoo.manifest.json")
	if not _write_json(manifest_path, manifest):
		return ""
	return manifest_path


func _manifest(
	recipe: Dictionary,
	pack_id: String,
	distribution: String,
	paths: Array[String],
	root: String,
) -> Dictionary:
	var roles: Array = []
	for plane: Array in PLANE_BINDINGS:
		roles.append({
			"role": plane[1],
			"binding": {"kind": "file", "path": plane[2]},
		})
	for index: int in ENVIRONMENT_ROLES.size():
		roles.append({
			"role": ENVIRONMENT_ROLES[index],
			"binding": {
				"kind": "atlas-region",
				"atlas": "environment",
				"region": {"x": index * 96, "y": 0, "width": 96, "height": 96},
			},
		})
	roles.append_array([
		{"role": "character.player.atlas", "binding": {"kind": "file", "path": "atlases/player.png"}},
		{"role": "character.npc.atlas", "binding": {"kind": "file", "path": "atlases/npc.png"}},
		{"role": "world.scene", "binding": {"kind": "file", "path": "runtime/scene.json"}},
		{"role": "world.collision", "binding": {"kind": "file", "path": "runtime/collision.json"}},
		{"role": "world.navigation", "binding": {"kind": "file", "path": "runtime/navigation.json"}},
		{"role": "world.preview", "binding": {"kind": "file", "path": "previews/world.png"}},
	])
	var review := {
		"human_art": "pass", "rights": "pass", "runtime": "pass", "raspberry_pi": "pass",
	}
	var output_license := {
		"id": "CC0-1.0",
		"notice_path": "license-assets.md",
		"permits_redistribution": true,
		"permits_commercial_use": true,
	}
	if distribution == "internal-review":
		review.human_art = "pending"
		review.rights = "pending"
		review.raspberry_pi = "pending"
		output_license.id = "LicenseRef-UNRELEASED"
		output_license.permits_redistribution = false
		output_license.permits_commercial_use = false
	elif distribution == "private":
		review.raspberry_pi = "pending"
		output_license.id = "LicenseRef-Private-Use"
		output_license.permits_redistribution = false
	var files: Array = []
	for path: String in paths:
		files.append(_file_record(root, path, _media_type(path)))
	var planes: Array = []
	for plane: Array in PLANE_BINDINGS:
		planes.append({
			"id": plane[0], "role": plane[1], "path": plane[2],
			"layer": plane[0], "blend": plane[3],
		})
	return {
		"schema_version": "1.0.0-draft.1",
		"pack": {
			"id": pack_id,
			"title": str(recipe.title),
			"version": "1.0.0",
			"generator": {"name": "Mapsoo Worldsmith", "version": "1.0.0"},
			"created_at": str(recipe.created_at),
		},
		"profile": "layered-depth-2d",
		"distribution": distribution,
		"review": review,
		"compatibility": {
			"godot_min": "4.3",
			"projection": "layered-depth-stage",
			"art_style": "pixel_art",
			"importer": {"id": "mapsoo_importer", "min_version": "1.0.0"},
		},
		"planes": planes,
		"atlases": [
			{"id": "environment", "path": "atlases/environment.png", "cell_size": [96, 96]},
			{"id": "player", "path": "atlases/player.png", "cell_size": [48, 72]},
			{"id": "npc", "path": "atlases/npc.png", "cell_size": [48, 72]},
		],
		"roles": roles,
		"characters": [
			_character("player", "atlases/player.png", PLAYER_ACTIONS),
			_character("npc", "atlases/npc.png", NPC_ACTIONS),
		],
		"runtime": {
			"scene": {"path": "runtime/scene.json"},
			"collision": {"path": "runtime/collision.json"},
			"navigation": {"path": "runtime/navigation.json"},
			"spawn": {"x": 32, "y": 132},
		},
		"files": files,
		"license": {"output": output_license},
		"provenance": {
			"output_provenance": "procedural",
			"contains_generative_ai": false,
			"model_provider": null,
			"model": null,
			"human_curated": distribution != "internal-review",
			"source_manifest_hashes": [FileAccess.get_sha256(RECIPE_PATH)],
		},
		"reference_policy": {
			"embedded": false,
			"original_references_excluded": true,
			"raw_prompts_excluded": true,
			"only_one_way_audit_hashes_retained": true,
		},
	}


func _layout_plan() -> Dictionary:
	var seed := "neutral-layered-layout-seed"
	return {
		"schema_version": "1.0.0",
		"document_type": "world-layout-plan",
		"status": "planned",
		"plan_id": "neutral-layered-layout",
		"profile": "layered-depth-2d",
		"source": {
			"intake_id": "neutral-layout-intake",
			"session_revision": 4,
			"intake_sha256": "1".repeat(64),
			"map_layout_checkpoint_sha256": "2".repeat(64),
			"seed": seed,
			"seed_sha256": _sha256_bytes(JSON.stringify(seed).to_utf8_buffer()),
		},
		"bounds": {"width": 64, "height": 36, "unit": "logical-tile"},
		"regions": [
			_layout_region("spawn-region", 0, "spawn"),
			_layout_region("route-region", 12, "route"),
			_layout_region("landmark-a-region", 24, "landmark"),
			_layout_region("landmark-b-region", 36, "landmark"),
			{
				"id": "exit-region", "x": 48, "y": 0,
				"width": 16, "height": 36, "purpose": "exit",
			},
		],
		"terrain_layout": {
			"kind": "zones",
			"zones": [
				_layout_terrain("ground-a", 0, 28, 16, 8, "earth", "walkable"),
				_layout_terrain("ground-b", 16, 26, 16, 10, "stone", "walkable"),
				_layout_terrain("ground-c", 32, 24, 16, 12, "grass", "walkable"),
				_layout_terrain("blocked-a", 48, 20, 16, 16, "rock", "blocked"),
			],
		},
		"spawn": {"node_id": "spawn-node", "x": 4, "y": 28},
		"exit": {"node_id": "exit-node", "x": 56, "y": 20},
		"traversal": {
			"nodes": [
				_layout_node("spawn-node", "spawn", "spawn-region", 4, 28),
				_layout_node("route-a-node", "route", "route-region", 16, 26),
				_layout_node(
					"landmark-a-node", "landmark", "landmark-a-region", 28, 24
				),
				_layout_node("route-b-node", "route", "route-region", 20, 22),
				_layout_node(
					"landmark-b-node", "landmark", "landmark-b-region", 40, 22
				),
				_layout_node("exit-node", "exit", "exit-region", 56, 20),
			],
			"edges": [
				_layout_edge("edge-a", "spawn-node", "route-a-node"),
				_layout_edge("edge-b", "route-a-node", "landmark-a-node"),
				_layout_edge("edge-c", "landmark-a-node", "route-b-node"),
				_layout_edge("edge-d", "route-b-node", "landmark-b-node"),
				_layout_edge("edge-e", "landmark-b-node", "exit-node"),
			],
		},
		"landmarks": [
			_layout_landmark(
				"landmark-a", "First landmark", "landmark-a-region",
				"landmark-a-node", 28, 24
			),
			_layout_landmark(
				"landmark-b", "Second landmark", "landmark-b-region",
				"landmark-b-node", 40, 22
			),
		],
		"collision_intent": {
			"mode": "depth-lane-blockers",
			"solid_terrain_ids": ["blocked-a"],
			"one_way_terrain_ids": [],
			"blocked_region_ids": [],
		},
		"navigation_intent": {
			"mode": "depth-lanes",
			"walkable_region_ids": [
				"spawn-region", "route-region", "landmark-a-region",
				"landmark-b-region", "exit-region",
			],
			"traversal_edge_ids": [
				"edge-a", "edge-b", "edge-c", "edge-d", "edge-e",
			],
			"agent_radius": 0.5,
		},
	}


func _layout_region(id: String, x: int, purpose: String) -> Dictionary:
	return {
		"id": id, "x": x, "y": 0, "width": 12, "height": 36,
		"purpose": purpose,
	}


func _layout_terrain(
	id: String,
	x: int,
	y: int,
	width: int,
	height: int,
	material: String,
	navigation: String,
) -> Dictionary:
	return {
		"id": id, "x": x, "y": y, "width": width, "height": height,
		"material": material, "navigation": navigation,
	}


func _layout_node(
	id: String,
	kind: String,
	region: String,
	x: int,
	y: int,
) -> Dictionary:
	return {"id": id, "kind": kind, "region_id": region, "x": x, "y": y}


func _layout_edge(id: String, from: String, to: String) -> Dictionary:
	return {
		"id": id, "from": from, "to": to, "kind": "walk",
		"direction": "bidirectional",
	}


func _layout_landmark(
	id: String,
	label: String,
	region: String,
	node: String,
	x: int,
	y: int,
) -> Dictionary:
	return {
		"id": id, "label": label, "region_id": region, "node_id": node,
		"x": x, "y": y,
	}


func _sha256_bytes(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()


func _character(id: String, atlas: String, actions: Array) -> Dictionary:
	var clips: Array = []
	var frame_index := 0
	for action: String in actions:
		for direction: String in DIRECTIONS:
			clips.append({
				"id": "%s.%s" % [action, direction],
				"action": action,
				"direction": direction,
				"frames": [
					{
						"x": frame_index * 48, "y": 0, "duration_ms": 160,
						"provenance": "artist-authored",
					},
					{
						"x": (frame_index + 1) * 48, "y": 0, "duration_ms": 160,
						"provenance": "artist-authored",
					},
				],
			})
			frame_index += 2
	return {
		"id": id, "atlas": atlas, "frame_size": [48, 72],
		"pivot": [24, 67], "clips": clips,
	}


func _write_environment_atlas(path: String) -> bool:
	var image := Image.create_empty(ENVIRONMENT_ROLES.size() * 96, 96, false, Image.FORMAT_RGBA8)
	image.fill(Color(0, 0, 0, 0))
	for index: int in ENVIRONMENT_ROLES.size():
		image.fill_rect(
			Rect2i(index * 96 + 4, 4, 88, 88),
			Color.from_hsv(float(index) / float(ENVIRONMENT_ROLES.size()), 0.45, 0.78),
		)
	return _save_png(path, image)


func _write_character_atlas(path: String, frame_count: int) -> bool:
	var image := Image.create_empty(frame_count * 48, 72, false, Image.FORMAT_RGBA8)
	image.fill(Color(0, 0, 0, 0))
	for index: int in frame_count:
		image.fill_rect(
			Rect2i(index * 48 + 8, 4, 32, 64),
			Color.from_hsv(float(index) / float(frame_count), 0.55, 0.86),
		)
	return _save_png(path, image)


func _write_png(path: String, width: int, height: int, color: Color) -> bool:
	var image := Image.create_empty(width, height, false, Image.FORMAT_RGBA8)
	image.fill(color)
	return _save_png(path, image)


func _write_autotile_png(path: String, material_index: int) -> bool:
	var cell := Vector2i(64, 32)
	var image := Image.create_empty(cell.x * 4, cell.y * 4, false, Image.FORMAT_RGBA8)
	for mask: int in range(16):
		image.fill_rect(
			Rect2i(Vector2i((mask % 4) * cell.x, (mask / 4) * cell.y), cell),
			Color.from_hsv(
				float((material_index * 16 + mask) % 64) / 64.0,
				0.35 + float(mask % 4) * 0.08,
				0.58 + float(mask / 4) * 0.06,
				1.0
			)
		)
	return _save_png(path, image)


func _save_png(path: String, image: Image) -> bool:
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir())) != OK:
		_fail("Unable to create fixture image directory.")
		return false
	var error := image.save_png(path)
	if error != OK:
		_fail("Unable to save fixture PNG: %s." % path)
		return false
	return true


func _write_json(path: String, value: Dictionary) -> bool:
	return _write_text(path, JSON.stringify(value, "  ", true) + "\n")


func _write_text(path: String, value: String) -> bool:
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(path.get_base_dir())) != OK:
		_fail("Unable to create fixture text directory.")
		return false
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		_fail("Unable to write fixture file: %s." % path)
		return false
	file.store_string(value)
	file.close()
	return true


func _file_record(root: String, path: String, media_type: String) -> Dictionary:
	var full_path := root.path_join(path)
	var file := FileAccess.open(full_path, FileAccess.READ)
	var bytes := file.get_length() if file != null else 0
	if file != null:
		file.close()
	return {
		"path": path,
		"media_type": media_type,
		"bytes": bytes,
		"sha256": FileAccess.get_sha256(full_path),
	}


func _media_type(path: String) -> String:
	if path.ends_with(".png"):
		return "image/png"
	if path.ends_with(".md"):
		return "text/markdown"
	return "application/json"


func _grant(pack_id: String, distribution: String, grant_id: String) -> Dictionary:
	return {
		"decision": "allow",
		"distribution": distribution,
		"pack_id": pack_id,
		"grant_id": grant_id,
	}


func _validate_scene(
	path: String,
	distribution: String,
	output_license: String,
	grant_id: String,
	expect_layout: bool = false,
) -> bool:
	var packed := ResourceLoader.load(path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE_DEEP) as PackedScene
	if packed == null:
		return false
	var world := packed.instantiate()
	var valid: bool = world.get_meta("mapsoo_schema_version", "") == "1.0.0-draft.1" \
		and world.get_meta("mapsoo_distribution", "") == distribution \
		and world.get_meta("mapsoo_output_license", "") == output_license \
		and world.get_meta("mapsoo_authorization_grant", "") == grant_id \
		and world.get_meta("mapsoo_data_only", false) == true \
		and world.get_node_or_null("YSortedGameplay/Actors/Player") is CharacterBody2D \
		and world.get_node_or_null("WorldTraversal") is Node2D \
		and (
			(
				world.get_meta("mapsoo_layout_plan_id", "") == "neutral-layered-layout"
				and world.get_meta("mapsoo_layout_materialization", "")
					== "profile-layout-v1"
				and world.get_meta("mapsoo_material_palette_status", "")
					== "production-tiles-v1"
				and world.get_meta("mapsoo_terrain_autotile_status", "")
					== "terrain-autotiles-v1"
				and world.get_meta("mapsoo_terrain_autotile_set_id", "")
					== "autotiles-neutral-layered-layout"
				and world.get_meta("mapsoo_layout_runtime_geometry_authority", "")
					== "profile-layout-v1"
				and _legacy_runtime_handoff_valid(world)
				and (
					world.get_node_or_null(
						"MapsooLayoutMaterialization/Terrain/LogicalCells"
					) as TileMapLayer
				).visible
				and world.get_node_or_null("WorldLayoutPlan/Spawn") is Marker2D
				and world.get_node_or_null("WorldLayoutPlan/Exit") is Marker2D
			)
			if expect_layout
			else world.get_node_or_null("WorldLayoutPlan") == null
		)
	world.free()
	return valid


func _legacy_runtime_handoff_valid(world: Node) -> bool:
	var expected := [
		"WorldCollision",
		"Hazards",
		"WorldNavigation",
		"WorldTraversal",
	]
	if world.get_meta("mapsoo_layout_superseded_legacy_nodes", []) != expected:
		return false
	for node_name: String in expected:
		var legacy := world.get_node_or_null(node_name)
		if (
			legacy == null
			or legacy.get_meta("mapsoo_layout_superseded", false) != true
			or legacy.process_mode != Node.PROCESS_MODE_DISABLED
			or (legacy is CanvasItem and (legacy as CanvasItem).visible)
			or not _legacy_runtime_node_is_disabled(legacy)
		):
			return false
	return true


func _legacy_runtime_node_is_disabled(node: Node) -> bool:
	if (
		node is CollisionObject2D
		and (
			(node as CollisionObject2D).collision_layer != 0
			or (node as CollisionObject2D).collision_mask != 0
		)
	):
		return false
	if (
		node is Area2D
		and (
			(node as Area2D).monitoring
			or (node as Area2D).monitorable
		)
	):
		return false
	if node is CollisionShape2D and not (node as CollisionShape2D).disabled:
		return false
	if node is CollisionPolygon2D and not (node as CollisionPolygon2D).disabled:
		return false
	if node is NavigationRegion2D and (node as NavigationRegion2D).enabled:
		return false
	if node is NavigationLink2D and (node as NavigationLink2D).enabled:
		return false
	for child: Node in node.get_children():
		if not _legacy_runtime_node_is_disabled(child):
			return false
	return true


func _errors_contain(errors: Variant, needle: String) -> bool:
	if typeof(errors) != TYPE_ARRAY:
		return false
	for value: Variant in errors:
		if str(value).to_lower().contains(needle):
			return true
	return false


func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK \
			or typeof(parser.data) != TYPE_DICTIONARY:
		return {}
	return parser.data as Dictionary


func _remove_tree(path: String) -> void:
	var absolute := ProjectSettings.globalize_path(path)
	if not DirAccess.dir_exists_absolute(absolute):
		return
	var directory := DirAccess.open(absolute)
	if directory == null:
		return
	for file: String in directory.get_files():
		DirAccess.remove_absolute(absolute.path_join(file))
	for child: String in directory.get_directories():
		_remove_tree(path.path_join(child))
	DirAccess.remove_absolute(absolute)


func _fail(message: String) -> void:
	push_error("MAPSOO_PACK10_CONTROLLED_FAILURE: %s" % message)
	quit(1)
