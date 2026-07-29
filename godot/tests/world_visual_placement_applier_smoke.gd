extends "res://tests/world_layout_materializer_smoke.gd"

const VisualPlacementApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_visual_placement_applier.gd"
)

const VISUAL_CONTAINER_PATH := (
	"MapsooLayoutMaterialization/WorldVisualPlacements"
)
const EXPECTED_PLACEMENTS := 7


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(
		ProjectSettings.globalize_path(TEST_ROOT)
	) != OK:
		_fail("Unable to create visual placement smoke directory.")
		return

	var profile_runs := 0
	var repeated_asset_runs := 0
	var persisted_runs := 0
	for profile: String in PROFILES:
		var context := _validated_context(profile, "visual-placement")
		if not context.ok:
			_fail(str(context.error))
			return
		var world_result := _materialize_world(profile, context.attachment)
		if not world_result.ok:
			_fail("%s layout materialization failed: %s" % [
				profile, world_result.error,
			])
			return
		var world: Node = world_result.root
		var input := _visual_input(
			profile,
			context.attachment.plan,
			str(context.attachment.sha256)
		)
		var before := _semantic_snapshot(world)
		var prepared := VisualPlacementApplier.prepare(
			world,
			input.plan,
			input.bindings,
			input.assets,
			input.textures,
			context.attachment.plan
		)
		if not prepared.ok or before != _semantic_snapshot(world):
			world.free()
			_fail("%s prepare was not a zero-mutation success: %s" % [
				profile, prepared,
			])
			return
		var applied := VisualPlacementApplier.apply(world, prepared)
		if not applied.ok:
			world.free()
			_fail("%s apply failed: %s" % [profile, applied.error])
			return
		var checked := VisualPlacementApplier.validate_scene(
			world,
			input.plan,
			input.bindings,
			input.assets,
			input.textures,
			context.attachment.plan
		)
		if not checked.ok:
			world.free()
			_fail("%s applied placement validation failed: %s" % [
				profile, checked.error,
			])
			return
		if not _assert_repeated_asset(world):
			world.free()
			_fail("%s repeated asset was not placed twice." % profile)
			return
		var snapshot := _visual_snapshot(world)
		var persisted := _persist_and_reload(
			world,
			context.fixture.root,
			"%s-visual-placement" % profile
		)
		world.free()
		if not persisted.ok:
			_fail("%s visual placement persistence failed: %s" % [
				profile, persisted.error,
			])
			return
		var reloaded: Node = persisted.root
		var reloaded_check := VisualPlacementApplier.validate_scene(
			reloaded,
			input.plan,
			input.bindings,
			input.assets,
			input.textures,
			context.attachment.plan
		)
		if (
			not reloaded_check.ok
			or snapshot != _visual_snapshot(reloaded)
		):
			var reloaded_snapshot := _visual_snapshot(reloaded)
			reloaded.free()
			_fail("%s reloaded visual placements changed: %s; %s" % [
				profile,
				reloaded_check.error
				if not reloaded_check.ok
				else "semantic snapshot mismatch",
				_first_difference(snapshot, reloaded_snapshot),
			])
			return
		reloaded.free()
		profile_runs += 1
		repeated_asset_runs += 1
		persisted_runs += 1

	var negative_count := _assert_fail_closed_cases()
	if negative_count < 10:
		return
	var tamper_count := _assert_scene_tamper_rejected()
	if tamper_count != 2:
		return

	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print(
		(
			"MAPSOO_WORLD_VISUAL_PLACEMENT_APPLIER_OK " +
			"profiles=%d placements=%d repeated=%d persisted=%d " +
			"fail_closed=%d tamper=%d"
		) % [
			profile_runs,
			profile_runs * EXPECTED_PLACEMENTS,
			repeated_asset_runs,
			persisted_runs,
			negative_count,
			tamper_count,
		]
	)
	quit(0)


func _validated_context(profile: String, suffix: String) -> Dictionary:
	var fixture := _write_fixture(profile, suffix)
	if not fixture.ok:
		return fixture
	var validated := LayoutAttachment.validate_optional(
		fixture.manifest,
		fixture.root,
		fixture.manifest_sha256
	)
	if not validated.ok or validated.status != "bound":
		return {
			"ok": false,
			"error": "%s layout fixture validation failed: %s" % [
				profile, validated,
			],
		}
	return {
		"ok": true,
		"fixture": fixture,
		"attachment": validated.layout,
		"error": "",
	}


func _visual_input(
	profile: String,
	layout_plan: Dictionary,
	layout_sha256: String
) -> Dictionary:
	var placements := [
		{
			"placement_id": "background-depth",
			"kind": "depth-plane",
			"role": "background.sky",
			"variant_id": "misty",
			"anchor": {
				"kind": "logical-rect",
				"x": 0, "y": 0,
				"width": int(layout_plan.bounds.width),
				"height": int(layout_plan.bounds.height),
			},
			"render": {
				"layer": "background",
				"order": -10,
				"parallax": {"x": 0.5, "y": 0.5},
				"repeat": {"x": true, "y": false},
			},
		},
		{
			"placement_id": "world-tree-a",
			"kind": "sprite",
			"role": "prop.tree",
			"variant_id": "oak",
			"anchor": {"kind": "logical-point", "x": 10, "y": 20},
			"render": {
				"layer": "world", "order": 0,
				"y_sort": profile != "side-platformer",
			},
		},
		{
			"placement_id": "world-tree-b",
			"kind": "sprite",
			"role": "prop.tree",
			"variant_id": "oak",
			"anchor": {"kind": "logical-point", "x": 14, "y": 20},
			"render": {
				"layer": "world", "order": 1,
				"y_sort": profile != "side-platformer",
			},
		},
		{
			"placement_id": "actor-guide",
			"kind": "actor",
			"role": "character.npc",
			"variant_id": "guide",
			"anchor": {"kind": "traversal", "ref_id": "route-a-node"},
			"render": {"layer": "actors", "order": 0, "y_sort": true},
			"controller": "npc",
		},
		{
			"placement_id": "effect-fireflies",
			"kind": "effect",
			"role": "effect.ambient",
			"variant_id": "fireflies",
			"anchor": {"kind": "landmark", "ref_id": "landmark-a"},
			"render": {"layer": "effects", "order": 0, "y_sort": true},
			"trigger": "always",
		},
		{
			"placement_id": "foreground-depth",
			"kind": "depth-plane",
			"role": "foreground.framing",
			"variant_id": "reeds",
			"anchor": {"kind": "region", "ref_id": "exit-region"},
			"render": {
				"layer": "foreground",
				"order": 0,
				"parallax": {"x": 1.0, "y": 1.0},
				"repeat": {"x": false, "y": false},
			},
		},
		{
			"placement_id": "lighting-wash",
			"kind": "depth-plane",
			"role": "lighting.ambient",
			"variant_id": "dusk",
			"anchor": {
				"kind": "logical-rect",
				"x": 0, "y": 0,
				"width": int(layout_plan.bounds.width),
				"height": int(layout_plan.bounds.height),
			},
			"render": {
				"layer": "lighting",
				"order": 0,
				"parallax": {"x": 1.0, "y": 1.0},
				"repeat": {"x": false, "y": false},
			},
		},
	]
	var plan := {
		"schema_version": "1.0.0",
		"document_type": "world-visual-placement-plan",
		"status": "planned",
		"plan_id": "world-visual-placement-plan-%s" % (
			profile.sha256_text().left(16)
		),
		"profile": profile,
		"source": {
			"layout_plan_id": str(layout_plan.plan_id),
			"layout_plan_path": "world-layout-plan.json",
			"layout_plan_sha256": layout_sha256,
		},
		"bounds": (layout_plan.bounds as Dictionary).duplicate(true),
		"placements": placements,
	}
	var bindings := {}
	var assets := {}
	var textures := {}
	var records := [
		["background-depth", "background-slot", "background-task", 1],
		["world-tree-a", "tree-slot", "tree-task", 2],
		["world-tree-b", "tree-slot", "tree-task", 2],
		["actor-guide", "actor-slot", "actor-task", 3],
		["effect-fireflies", "effect-slot", "effect-task", 4],
		["foreground-depth", "foreground-slot", "foreground-task", 5],
		["lighting-wash", "lighting-slot", "lighting-task", 6],
	]
	for record: Array in records:
		var placement := _placement_by_id(placements, str(record[0]))
		var slot_id := str(record[1])
		var task_id := str(record[2])
		if not textures.has(task_id):
			textures[task_id] = _portable_texture(Vector2i(32, 32), int(record[3]))
		var texture := textures[task_id] as Texture2D
		var region := {
			"x": 0, "y": 0,
			"width": texture.get_width(),
			"height": texture.get_height(),
		}
		var binding := {
			"task_id": task_id,
			"slot_id": slot_id,
			"role": str(placement.role),
			"variant_id": str(placement.variant_id),
			"region": region,
			"cell_sha256": _texture_cell_sha(texture, region),
		}
		bindings[str(record[0])] = binding.duplicate(true)
		assets[slot_id] = binding.duplicate(true)
	return {
		"plan": plan,
		"bindings": bindings,
		"assets": assets,
		"textures": textures,
	}


func _portable_texture(
	size: Vector2i,
	seed: int
) -> PortableCompressedTexture2D:
	var image := Image.create(size.x, size.y, false, Image.FORMAT_RGBA8)
	image.fill(Color8(
		(seed * 53) % 220 + 20,
		(seed * 97) % 220 + 20,
		(seed * 149) % 220 + 20,
		255
	))
	image.set_pixel(seed % size.x, seed % size.y, Color8(250, 220, 80, 255))
	var texture := PortableCompressedTexture2D.new()
	texture.keep_compressed_buffer = true
	texture.create_from_image(
		image,
		PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS
	)
	return texture


func _texture_cell_sha(texture: Texture2D, region: Dictionary) -> String:
	var image := texture.get_image()
	if image == null:
		return ""
	return _sha256(image.get_region(Rect2i(
		int(region.x), int(region.y),
		int(region.width), int(region.height)
	)).get_data())


func _placement_by_id(placements: Array, placement_id: String) -> Dictionary:
	for value: Variant in placements:
		if value is Dictionary and value.get("placement_id") == placement_id:
			return value
	return {}


func _assert_repeated_asset(world: Node) -> bool:
	var container := world.get_node_or_null(VISUAL_CONTAINER_PATH)
	if container == null:
		return false
	var repeated := 0
	for node: Node in _placement_nodes(container):
		if node.get_meta("mapsoo_slot_id", "") == "tree-slot":
			repeated += 1
	return repeated == 2


func _assert_fail_closed_cases() -> int:
	var context := _validated_context("topdown-farm", "visual-negative")
	if not context.ok:
		_fail(str(context.error))
		return -1
	var base := _visual_input(
		"topdown-farm",
		context.attachment.plan,
		str(context.attachment.sha256)
	)
	var cases: Array = []

	var wrong_profile: Dictionary = base.duplicate(true)
	wrong_profile.plan.profile = "side-platformer"
	cases.append(["profile mismatch", wrong_profile])

	var wrong_sha: Dictionary = base.duplicate(true)
	wrong_sha.plan.source.layout_plan_sha256 = "f".repeat(64)
	cases.append(["layout digest mismatch", wrong_sha])

	var duplicate_id: Dictionary = base.duplicate(true)
	duplicate_id.plan.placements[2].placement_id = "world-tree-a"
	cases.append(["duplicate placement id", duplicate_id])

	var unsorted: Dictionary = base.duplicate(true)
	unsorted.plan.placements.reverse()
	cases.append(["noncanonical placement order", unsorted])

	var missing_binding: Dictionary = base.duplicate(true)
	missing_binding.bindings.erase("world-tree-a")
	cases.append(["missing binding", missing_binding])

	var extra_binding: Dictionary = base.duplicate(true)
	extra_binding.bindings["extra-placement"] = (
		base.bindings["world-tree-a"] as Dictionary
	).duplicate(true)
	cases.append(["extra binding", extra_binding])

	var missing_asset: Dictionary = base.duplicate(true)
	missing_asset.assets.erase("tree-slot")
	cases.append(["missing asset", missing_asset])

	var extra_asset: Dictionary = base.duplicate(true)
	extra_asset.assets["extra-slot"] = (
		base.assets["tree-slot"] as Dictionary
	).duplicate(true)
	cases.append(["extra asset", extra_asset])

	var missing_texture: Dictionary = base.duplicate(true)
	missing_texture.textures.erase("tree-task")
	cases.append(["missing texture", missing_texture])

	var extra_texture: Dictionary = base.duplicate(true)
	extra_texture.textures["extra-task"] = base.textures["tree-task"]
	cases.append(["extra texture", extra_texture])

	var wrong_role: Dictionary = base.duplicate(true)
	wrong_role.bindings["world-tree-a"].role = "prop.rock"
	cases.append(["binding role mismatch", wrong_role])

	var wrong_cell: Dictionary = base.duplicate(true)
	wrong_cell.bindings["world-tree-a"].cell_sha256 = "0".repeat(64)
	cases.append(["reviewed cell digest mismatch", wrong_cell])

	var missing_anchor: Dictionary = base.duplicate(true)
	missing_anchor.plan.placements[4].anchor.ref_id = "missing-landmark"
	cases.append(["missing layout anchor", missing_anchor])

	var invalid_layer: Dictionary = base.duplicate(true)
	invalid_layer.plan.placements[3].render.layer = "world"
	cases.append(["kind layer mismatch", invalid_layer])

	var passed := 0
	for case_value: Variant in cases:
		var case: Array = case_value
		if not _expect_prepare_failure_without_mutation(
			context.attachment,
			case[1],
			str(case[0])
		):
			return -1
		passed += 1
	return passed


func _expect_prepare_failure_without_mutation(
	attachment: Dictionary,
	input: Dictionary,
	label: String
) -> bool:
	var world_result := _materialize_world(
		str(attachment.plan.profile),
		attachment
	)
	if not world_result.ok:
		_fail("%s could not build its layout fixture." % label)
		return false
	var world: Node = world_result.root
	var before := _semantic_snapshot(world)
	var result := VisualPlacementApplier.prepare(
		world,
		input.plan,
		input.bindings,
		input.assets,
		input.textures,
		attachment.plan
	)
	if result.ok:
		var detached: Node = result.container
		detached.free()
	if result.ok or before != _semantic_snapshot(world):
		world.free()
		_fail("%s did not fail before scene mutation." % label)
		return false
	world.free()
	return true


func _assert_scene_tamper_rejected() -> int:
	var context := _validated_context("topdown-farm", "visual-tamper")
	if not context.ok:
		_fail(str(context.error))
		return -1
	var input := _visual_input(
		"topdown-farm",
		context.attachment.plan,
		str(context.attachment.sha256)
	)
	var tamper_count := 0
	for tamper_kind: String in ["metadata", "extra-node"]:
		var world_result := _materialize_world(
			"topdown-farm",
			context.attachment
		)
		if not world_result.ok:
			_fail("Tamper layout fixture could not be built.")
			return -1
		var world: Node = world_result.root
		var prepared := VisualPlacementApplier.prepare(
			world,
			input.plan,
			input.bindings,
			input.assets,
			input.textures,
			context.attachment.plan
		)
		var applied := VisualPlacementApplier.apply(world, prepared)
		if not prepared.ok or not applied.ok:
			world.free()
			_fail("Tamper fixture could not apply visual placements.")
			return -1
		if tamper_kind == "metadata":
			var node := _find_placement(world, "world-tree-a")
			if node == null:
				world.free()
				_fail("Tamper placement node is missing.")
				return -1
			node.set_meta("mapsoo_role", "prop.tampered")
		else:
			var extra := Node2D.new()
			extra.name = "Unexpected"
			world.get_node(
				"%s/World/Fixed" % VISUAL_CONTAINER_PATH
			).add_child(extra)
		var checked := VisualPlacementApplier.validate_scene(
			world,
			input.plan,
			input.bindings,
			input.assets,
			input.textures,
			context.attachment.plan
		)
		if checked.ok:
			world.free()
			_fail("%s scene tamper was accepted." % tamper_kind)
			return -1
		world.free()
		tamper_count += 1
	return tamper_count


func _find_placement(root: Node, placement_id: String) -> Node:
	for node: Node in _placement_nodes(root):
		if (
			node.get_meta("mapsoo_world_visual_placement_id", "")
			== placement_id
		):
			return node
	return null


func _placement_nodes(root: Node) -> Array[Node]:
	var nodes: Array[Node] = []
	if root.has_meta("mapsoo_world_visual_placement_id"):
		nodes.append(root)
	for child: Node in root.get_children():
		nodes.append_array(_placement_nodes(child))
	return nodes


func _visual_snapshot(world: Node) -> String:
	var container := world.get_node_or_null(VISUAL_CONTAINER_PATH)
	if container == null:
		return ""
	return JSON.stringify(_visual_node_snapshot(container), "", true)


func _visual_node_snapshot(node: Node) -> Dictionary:
	var snapshot := {
		"name": str(node.name),
		"class": node.get_class(),
		"metadata": {},
		"children": [],
	}
	var keys := node.get_meta_list()
	keys.sort()
	for key: StringName in keys:
		snapshot.metadata[str(key)] = _snapshot_meta(node.get_meta(key))
	if node is CanvasLayer:
		snapshot["canvas_layer"] = (node as CanvasLayer).layer
	if node is Node2D:
		snapshot["position"] = _vector_snapshot((node as Node2D).position)
		snapshot["scale"] = _vector_snapshot((node as Node2D).scale)
		snapshot["z_index"] = (node as Node2D).z_index
	if node is Sprite2D:
		var sprite := node as Sprite2D
		var atlas := sprite.texture as AtlasTexture
		snapshot["texture_region"] = (
			_snapshot_meta(atlas.region)
			if atlas != null
			else null
		)
	for child: Node in node.get_children():
		snapshot.children.append(_visual_node_snapshot(child))
	return snapshot
