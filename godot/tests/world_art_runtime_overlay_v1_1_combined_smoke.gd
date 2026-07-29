extends "res://tests/world_art_runtime_overlay_v1_1_smoke.gd"

const MaterialPalette = preload(
	"res://addons/mapsoo_importer/mapsoo_world_material_palette.gd"
)
const BaseVisualApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay_applier.gd"
)
const BaseHazardApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_hazard_applier.gd"
)
const BaseCharacterApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_character_applier.gd"
)

const ROLE_CATALOG := {
	"side-platformer": [
		"terrain.solid", "terrain.one-way", "terrain.wall", "terrain.water",
	],
	"topdown-farm": [
		"terrain.ground", "terrain.soil", "terrain.path", "terrain.water",
	],
	"isometric-action": [
		"terrain.floor.base", "terrain.floor.variant", "terrain.floor.edge",
		"terrain.wall", "terrain.water",
	],
	"layered-depth-2d": [
		"terrain.ground", "terrain.path", "terrain.edge", "terrain.water",
	],
}


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(
		ProjectSettings.globalize_path(TEST_ROOT)
	) != OK:
		_fail("Unable to create combined overlay 1.1 smoke directory.")
		return
	var profiles := 0
	var persisted := 0
	var terrain_total := 0
	var landmark_total := 0
	var hazard_total := 0
	var character_total := 0
	var placement_total := 0
	for profile: String in PROFILES:
		var context := _validated_context(profile, "overlay-v1-1-combined")
		if not context.ok:
			_fail(str(context.error))
			return
		var fixture := _build_combined_fixture(context, "positive")
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var loaded := RuntimeOverlayV11.load_extracted(
			fixture.manifest_path,
			str(context.attachment.sha256)
		)
		if not loaded.ok:
			_fail("%s combined overlay load failed: %s" % [
				profile, loaded.error,
			])
			return
		var world_result := _combined_world(context)
		if not world_result.ok:
			_fail("%s combined world setup failed: %s" % [
				profile, world_result.error,
			])
			return
		var world: Node = world_result.root
		var combined := RuntimeOverlayV11.bind_scene(
			world,
			loaded.overlay,
			context.attachment.plan
		)
		if not combined.ok or not _distinct_statuses(world):
			world.free()
			_fail("%s combined catalog/placement binding failed: %s" % [
				profile, combined,
			])
			return
		var visuals := BaseVisualApplier.apply(world)
		var hazards := BaseHazardApplier.apply(world)
		var character := BaseCharacterApplier.apply(world)
		if (
			not visuals.ok
			or not hazards.ok
			or not character.ok
			or int(visuals.terrain_materials) < 1
			or int(visuals.landmarks) < 1
			or int(hazards.hazards) != 2
			or int(character.animation_count) < 1
			or not _assert_combined_placements(world)
		):
			world.free()
			_fail("%s frozen 1.0 consumers failed beside placements: %s / %s / %s" % [
				profile, visuals, hazards, character,
			])
			return
		var checked := _validate_combined(
			world,
			loaded.overlay,
			context.attachment.plan
		)
		if not checked.ok:
			world.free()
			_fail("%s combined validation failed: %s" % [profile, checked.error])
			return
		terrain_total += int(visuals.terrain_materials)
		landmark_total += int(visuals.landmarks)
		hazard_total += int(hazards.hazards)
		character_total += 1
		placement_total += int(combined.placements)
		var saved := _persist_and_reload(
			world,
			fixture.root,
			"%s-combined-v1-1" % profile
		)
		world.free()
		if not saved.ok:
			_fail("%s combined scene persistence failed." % profile)
			return
		var reloaded: Node = saved.root
		var reload_check := _validate_combined(
			reloaded,
			loaded.overlay,
			context.attachment.plan
		)
		if not reload_check.ok or not _assert_combined_placements(reloaded):
			reloaded.free()
			_fail("%s reloaded combined scene changed: %s" % [
				profile, reload_check.error,
			])
			return
		reloaded.free()
		profiles += 1
		persisted += 1

	var status_conflicts := _assert_status_conflicts()
	if status_conflicts != 2:
		return
	var binding_tampers := _assert_short_binding_fail_closed()
	if binding_tampers != 2:
		return
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print((
		"MAPSOO_WORLD_ART_RUNTIME_OVERLAY_V1_1_COMBINED_OK " +
		"profiles=%d terrain=%d landmarks=%d hazards=%d characters=%d " +
		"placements=%d persisted=%d status_conflicts=%d binding_tamper=%d"
	) % [
		profiles,
		terrain_total,
		landmark_total,
		hazard_total,
		character_total,
		placement_total,
		persisted,
		status_conflicts,
		binding_tampers,
	])
	quit(0)


func _combined_world(context: Dictionary) -> Dictionary:
	var materialized := _materialize_world(
		str(context.attachment.plan.profile),
		context.attachment
	)
	if not materialized.ok:
		return materialized
	var world: Node = materialized.root
	var palette := _palette(
		str(context.attachment.plan.profile),
		context.attachment
	)
	var palette_result := MaterialPalette.apply(
		world,
		context.attachment.plan,
		context.attachment.sha256,
		palette,
		_catalog(str(context.attachment.plan.profile), palette)
	)
	if not palette_result.ok:
		world.free()
		return {"ok": false, "error": "Production palette failed."}
	var player := _find_player(world)
	if player == null:
		world.free()
		return {"ok": false, "error": "Runtime player is missing."}
	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = SpriteFrames.new()
	visual.set_meta("mapsoo_runtime_slot_id", "player")
	player.add_child(visual)
	visual.owner = world
	return {"ok": true, "root": world, "error": ""}


func _build_combined_fixture(
	context: Dictionary,
	suffix: String
) -> Dictionary:
	var fixture := _build_overlay_fixture(context, "combined-%s" % suffix)
	if not fixture.ok:
		return fixture
	var root := str(fixture.root)
	var plan: Dictionary = fixture.plan
	var placement_map: Dictionary = fixture.placement_map
	var projection: Dictionary = fixture.projection
	var images: Array = projection.images
	var assets: Array = projection.assets
	var bindings: Array = []
	var profile := str(plan.profile)
	var seed := 100

	# Add one structure placement so the sidecar proof covers both reusable
	# props and structural world decoration.
	var structure := {
		"placement_id": "world-structure",
		"kind": "sprite",
		"role": "structure.arch",
		"variant_id": "stone",
		"anchor": {"kind": "landmark", "ref_id": "landmark-b"},
		"render": {
			"layer": "world", "order": 2,
			"y_sort": profile != "side-platformer",
		},
	}
	plan.placements.insert(3, structure)
	var structure_asset := _append_projection_asset(
		root,
		images,
		assets,
		bindings,
		"structure-task",
		"structure-slot",
		"structure.arch",
		Vector2i(64, 64),
		Vector2i(64, 64),
		[32, 56],
		[],
		"",
		"",
		seed
	)
	placement_map.bindings.insert(3, {
		"placement_id": "world-structure",
		"task_id": "structure-task",
		"slot_id": "structure-slot",
		"requirement_id": "requirement-structure-slot",
		"role": "structure.arch",
		"variant_id": "stone",
		"atlas_path": structure_asset.image_path,
		"atlas_cell": {
			"column": 0, "row": 0, "column_span": 1, "row_span": 1,
		},
	})
	# The same runtime asset uses the sidecar's reviewed variant.
	structure_asset.variant_id = "stone"
	seed += 1

	var palette := _palette(profile, context.attachment)
	var tile_size: Vector2i = (
		Vector2i(32, 16)
		if profile == "isometric-action"
		else Vector2i(32, 32)
	)
	for entry_value: Variant in palette.entries:
		var entry: Dictionary = entry_value
		_append_projection_asset(
			root, images, assets, bindings,
			"base-terrain-%s" % str(entry.material),
			"base-terrain-slot-%s" % str(entry.material),
			str(entry.role),
			tile_size,
			tile_size,
			[tile_size.x / 2, tile_size.y],
			[],
			"terrain-material",
			str(entry.material),
			seed
		)
		seed += 1
	for landmark_value: Variant in context.attachment.plan.landmarks:
		var landmark: Dictionary = landmark_value
		_append_projection_asset(
			root, images, assets, bindings,
			"base-landmark-%s" % str(landmark.id),
			"base-landmark-slot-%s" % str(landmark.id),
			"structure.landmark",
			Vector2i(64, 64),
			Vector2i(64, 64),
			[32, 56],
			[],
			"landmark",
			str(landmark.id),
			seed
		)
		seed += 1
	var hazard_roles: Array = (
		["hazard.spikes", "hazard.pit"]
		if profile == "side-platformer"
		else ["hazard.contact"]
	)
	if profile == "isometric-action":
		hazard_roles.append("hazard.telegraph")
	for role_value: Variant in hazard_roles:
		var role := str(role_value)
		_append_projection_asset(
			root, images, assets, bindings,
			"base-%s" % role.replace(".", "-"),
			"base-slot-%s" % role.replace(".", "-"),
			role,
			Vector2i(64, 64),
			Vector2i(64, 64),
			[32, 56],
			[],
			"hazard",
			"requirement-%s" % role.replace(".", "-"),
			seed
		)
		seed += 1
	var geometry := _character_geometry(profile)
	_append_projection_asset(
		root, images, assets, bindings,
		"base-player",
		"base-player-slot",
		"character.player.atlas",
		geometry.size,
		geometry.cell_size,
		geometry.pivot,
		_character_poses(profile, geometry),
		"character",
		"requirement-character-player",
		seed
	)
	projection.hazards = _hazards(profile)
	images.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		return str(left.task_id) < str(right.task_id)
	)
	assets.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		return (
			"%s/%s" % [left.task_id, left.slot_id]
			< "%s/%s" % [right.task_id, right.slot_id]
		)
	)
	bindings.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		var order := {
			"terrain-material": 0, "landmark": 1,
			"hazard": 2, "character": 3,
		}
		return (
			"%d/%s/%s" % [
				order[left.usage_kind], left.usage_id, left.slot_id,
			]
			< "%d/%s/%s" % [
				order[right.usage_kind], right.usage_id, right.slot_id,
			]
		)
	)
	projection.bindings = bindings

	plan.plan_id = "world-visual-placement-plan-%s" % (
		RuntimeOverlayV11._canonical_sha256({
			"profile": plan.profile,
			"source": plan.source,
			"bounds": plan.bounds,
			"placements": plan.placements,
		}).left(16)
	)
	var plan_sha := RuntimeOverlayV11._canonical_sha256(plan)
	placement_map.source.placement_plan_id = plan.plan_id
	placement_map.source.placement_plan_sha256 = plan_sha
	placement_map.map_id = "world-art-placement-map-%s" % (
		RuntimeOverlayV11._canonical_sha256({
			"profile": placement_map.profile,
			"source": placement_map.source,
			"bindings": placement_map.bindings,
		}).left(16)
	)
	projection.erase("projection_id")
	projection.projection_id = "world-art-runtime-projection-%s" % (
		RuntimeOverlayV11._canonical_sha256(projection).left(16)
	)
	return _rewrite_combined_documents(
		fixture,
		plan,
		placement_map,
		projection
	)


func _append_projection_asset(
	root: String,
	images: Array,
	assets: Array,
	bindings: Array,
	task_id: String,
	slot_id: String,
	role: String,
	size: Vector2i,
	cell_size: Vector2i,
	pivot: Array,
	poses: Array,
	usage_kind: String,
	usage_id: String,
	seed: int
) -> Dictionary:
	var image := _portable_texture(size, seed).get_image()
	var path := "assets/%s.png" % task_id
	image.save_png(root.path_join(path))
	var png := _read_file(root.path_join(path))
	var region := {"x": 0, "y": 0, "width": size.x, "height": size.y}
	images.append({
		"task_id": task_id,
		"path": path,
		"media_type": "image/png",
		"bytes": png.size(),
		"sha256": _sha256(png),
		"output_sha256": _sha256(png),
		"width": size.x,
		"height": size.y,
		"cell_size": [cell_size.x, cell_size.y],
		"pivot": pivot,
		"alpha_policy": "straight-alpha",
	})
	var asset := {
		"task_id": task_id,
		"slot_id": slot_id,
		"requirement_id": "requirement-%s" % slot_id,
		"role": role,
		"variant_id": "default",
		"image_path": path,
		"region": region,
		"cell_sha256": _sha256(image.get_data()),
		"poses": poses,
	}
	assets.append(asset)
	if not usage_kind.is_empty():
		var binding := asset.duplicate(true)
		binding.erase("requirement_id")
		binding["usage_kind"] = usage_kind
		binding["usage_id"] = usage_id
		bindings.append(binding)
	return asset


func _rewrite_combined_documents(
	fixture: Dictionary,
	plan: Dictionary,
	placement_map: Dictionary,
	projection: Dictionary
) -> Dictionary:
	var root := str(fixture.root)
	var documents := {
		PROJECTION_PATH: projection,
		PLACEMENT_PLAN_PATH: plan,
		PLACEMENT_MAP_PATH: placement_map,
	}
	var bytes_by_path := {}
	for path_value: Variant in documents:
		var path := str(path_value)
		var bytes := (
			RuntimeOverlayV11._canonical_json(documents[path]) + "\n"
		).to_utf8_buffer()
		_write_bytes(root.path_join(path), bytes)
		bytes_by_path[path] = bytes
	var file_records: Array = []
	for image_value: Variant in projection.images:
		var image: Dictionary = image_value
		var png := _read_file(root.path_join(str(image.path)))
		file_records.append(_file_record(str(image.path), "image/png", png))
	for path_value: Variant in documents:
		var path := str(path_value)
		file_records.append(
			_file_record(path, "application/json", bytes_by_path[path])
		)
	file_records.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		return str(left.path) < str(right.path)
	)
	var manifest: Dictionary = fixture.manifest
	manifest.source.projection_id = projection.projection_id
	manifest.source.projection_sha256 = (
		RuntimeOverlayV11._canonical_sha256(projection)
	)
	manifest.source.placement_plan_id = plan.plan_id
	manifest.source.placement_plan_sha256 = (
		RuntimeOverlayV11._canonical_sha256(plan)
	)
	manifest.source.placement_map_id = placement_map.map_id
	manifest.source.placement_map_sha256 = (
		RuntimeOverlayV11._canonical_sha256(placement_map)
	)
	manifest.projection.sha256 = _sha256(bytes_by_path[PROJECTION_PATH])
	manifest.visual_placement.plan_sha256 = _sha256(
		bytes_by_path[PLACEMENT_PLAN_PATH]
	)
	manifest.visual_placement.map_sha256 = _sha256(
		bytes_by_path[PLACEMENT_MAP_PATH]
	)
	manifest.files = file_records
	manifest.erase("overlay_id")
	manifest.overlay_id = "world-art-runtime-overlay-%s" % (
		RuntimeOverlayV11._canonical_sha256(manifest).left(16)
	)
	_write_bytes(
		fixture.manifest_path,
		(RuntimeOverlayV11._canonical_json(manifest) + "\n").to_utf8_buffer()
	)
	fixture.manifest = manifest
	fixture.plan = plan
	fixture.placement_map = placement_map
	fixture.projection = projection
	return fixture


func _validate_combined(
	world: Node,
	loaded: Dictionary,
	layout_plan: Dictionary
) -> Dictionary:
	for result: Dictionary in [
		RuntimeOverlayV11.validate_bound_scene(world, loaded, layout_plan),
		BaseVisualApplier.validate_scene(world),
		BaseHazardApplier.validate_scene(world),
		BaseCharacterApplier.validate_scene(world),
	]:
		if not result.ok:
			return result
	if not _distinct_statuses(world):
		return {"ok": false, "error": "Base and 1.1 statuses collided."}
	return {"ok": true, "error": ""}


func _distinct_statuses(world: Node) -> bool:
	return (
		world.get_meta("mapsoo_world_art_overlay_status", "")
			== "reviewed-runtime-overlay-v1"
		and world.get_meta("mapsoo_world_art_overlay_v1_1_status", "")
			== "reviewed-runtime-overlay-v1-1"
		and world.get_meta("mapsoo_world_art_overlay_id", "")
			== world.get_meta("mapsoo_world_art_overlay_v1_1_id", "")
		and world.get_node_or_null("WorldArtRuntimeOverlay") != null
	)


func _assert_combined_placements(world: Node) -> bool:
	var roles := {}
	var kinds := {}
	for node: Node in _placement_nodes(world):
		roles[str(node.get_meta("mapsoo_role", ""))] = true
		kinds[str(node.get_meta("mapsoo_world_visual_kind", ""))] = true
	return (
		roles.has("background.sky")
		and roles.has("prop.tree")
		and roles.has("structure.arch")
		and roles.has("effect.ambient")
		and kinds.has("depth-plane")
		and kinds.has("sprite")
		and kinds.has("effect")
		and kinds.has("actor")
	)


func _assert_status_conflicts() -> int:
	var context := _validated_context("topdown-farm", "combined-status")
	var fixture := _build_combined_fixture(context, "status")
	var loaded := RuntimeOverlayV11.load_extracted(
		fixture.manifest_path,
		str(context.attachment.sha256)
	)
	if not context.ok or not fixture.ok or not loaded.ok:
		_fail("Combined status fixture failed.")
		return -1
	var passed := 0
	for key: String in [
		"mapsoo_world_art_overlay_status",
		"mapsoo_world_art_overlay_v1_1_status",
	]:
		var world_result := _combined_world(context)
		var world: Node = world_result.root
		world.set_meta(key, "conflicting-status")
		var before := _semantic_snapshot(world)
		var prepared := RuntimeOverlayV11.prepare_scene(
			world,
			loaded.overlay,
			context.attachment.plan
		)
		var rejected: bool = not prepared.ok
		if prepared.ok:
			var applied := RuntimeOverlayV11.apply_scene(world, prepared)
			rejected = not applied.ok and before == _semantic_snapshot(world)
			var detached: Node = prepared.applier.container
			detached.free()
		if not rejected:
			world.free()
			_fail("Status conflict %s was accepted." % key)
			return -1
		world.free()
		passed += 1
	return passed


func _assert_short_binding_fail_closed() -> int:
	var context := _validated_context("topdown-farm", "combined-bindings")
	var fixture := _build_combined_fixture(context, "bindings")
	var loaded := RuntimeOverlayV11.load_extracted(
		fixture.manifest_path,
		str(context.attachment.sha256)
	)
	if not loaded.ok:
		_fail("Combined binding fixture failed.")
		return -1
	var passed := 0
	var shortened: Dictionary = loaded.overlay.duplicate(true)
	shortened.projection.bindings.pop_front()
	if not _expect_prepare_failure(
		context.attachment,
		shortened,
		"combined shortened projection"
	):
		return -1
	passed += 1

	var world_result := _combined_world(context)
	var world: Node = world_result.root
	var bound := RuntimeOverlayV11.bind_scene(
		world,
		loaded.overlay,
		context.attachment.plan
	)
	var catalog: Node = world.get_node("WorldArtRuntimeOverlay")
	var bindings: Array = catalog.get_meta("mapsoo_bindings")
	for index: int in range(bindings.size() - 1, -1, -1):
		if bindings[index].usage_kind == "terrain-material":
			bindings.remove_at(index)
			break
	catalog.set_meta("mapsoo_bindings", bindings)
	var before := _semantic_snapshot(world)
	var applied := BaseVisualApplier.apply(world)
	if not bound.ok or applied.ok or before != _semantic_snapshot(world):
		world.free()
		_fail("Short bound terrain binding did not fail closed.")
		return -1
	world.free()
	passed += 1
	return passed


func _palette(profile: String, attachment: Dictionary) -> Dictionary:
	var entries: Array = []
	var materials := {}
	var terrain_layout: Dictionary = attachment.plan.terrain_layout
	for terrain_value: Variant in terrain_layout[str(terrain_layout.kind)]:
		var terrain: Dictionary = terrain_value
		materials[str(terrain.material)] = true
	var ordered: Array = materials.keys()
	ordered.sort()
	var roles: Array = ROLE_CATALOG[profile]
	for index: int in ordered.size():
		entries.append({
			"material": str(ordered[index]),
			"role": str(roles[index % roles.size()]),
			"rendering": "single-cell",
		})
	return {
		"schema_version": "1.0.0",
		"document_type": "world-material-palette",
		"palette_id": "palette-%s" % attachment.plan.plan_id,
		"profile": profile,
		"layout": {
			"plan_id": attachment.plan.plan_id,
			"sha256": attachment.sha256,
		},
		"entries": entries,
	}


func _catalog(profile: String, palette: Dictionary) -> Dictionary:
	var roles := {}
	for entry_value: Variant in palette.entries:
		var entry: Dictionary = entry_value
		if roles.has(entry.role):
			continue
		var image := Image.create(16, 16, false, Image.FORMAT_RGBA8)
		image.fill(Color(0.3, 0.6, 0.8, 1.0))
		roles[entry.role] = ImageTexture.create_from_image(image)
	return {
		"tile_size": (
			Vector2i(32, 16)
			if profile == "isometric-action"
			else Vector2i(32, 32)
		),
		"roles": roles,
	}


func _hazards(profile: String) -> Array:
	var result: Array = []
	for index: int in 2:
		var kind: String = (
			["spikes", "pit"][index]
			if profile == "side-platformer"
			else "contact"
		)
		var hazard := {
			"hazard_id": "hazard-%03d" % (index + 1),
			"binding_usage_id": "requirement-hazard-%s" % kind,
			"kind": kind,
			"behavior": "respawn",
			"logical_rect": (
				{"x": 15, "y": 25, "width": 2, "height": 1}
				if index == 0
				else {"x": 35, "y": 23, "width": 3, "height": 1}
			),
		}
		if profile == "isometric-action":
			hazard["telegraph_usage_id"] = "requirement-hazard-telegraph"
		result.append(hazard)
	return result


func _character_geometry(profile: String) -> Dictionary:
	match profile:
		"side-platformer", "topdown-farm":
			return {
				"size": Vector2i(1024, 768),
				"cell_size": Vector2i(128, 128),
				"pivot": [64, 120],
			}
		"isometric-action":
			return {
				"size": Vector2i(1536, 1536),
				"cell_size": Vector2i(192, 128),
				"pivot": [96, 120],
			}
		"layered-depth-2d":
			return {
				"size": Vector2i(1024, 1152),
				"cell_size": Vector2i(128, 192),
				"pivot": [64, 180],
			}
	return {}


func _character_poses(profile: String, geometry: Dictionary) -> Array:
	var poses: Array = []
	var actions := _character_actions(profile)
	var directions := _character_directions(profile)
	var size: Vector2i = geometry.size
	var cell: Vector2i = geometry.cell_size
	var columns := size.x / cell.x
	var frames_per_row := columns / directions.size()
	var row := 0
	for action: String in actions:
		var frame_count := _character_frame_count(profile, action)
		for frame_start: int in range(0, frame_count, frames_per_row):
			var frame_end := mini(frame_start + frames_per_row, frame_count)
			for frame_index: int in range(frame_start, frame_end):
				for direction_index: int in directions.size():
					poses.append({
						"action": action,
						"direction": directions[direction_index],
						"frame_index": frame_index,
						"duration_ms": 120,
						"region": {
							"x": (
								(frame_index - frame_start)
								* directions.size()
								+ direction_index
							) * cell.x,
							"y": row * cell.y,
							"width": cell.x,
							"height": cell.y,
						},
					})
			row += 1
	poses.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		return (
			"%s/%s/%03d" % [
				left.action, left.direction, int(left.frame_index),
			]
			< "%s/%s/%03d" % [
				right.action, right.direction, int(right.frame_index),
			]
		)
	)
	return poses


func _character_actions(profile: String) -> Array[String]:
	match profile:
		"side-platformer":
			return ["idle", "run", "jump", "fall", "land", "hurt"]
		"topdown-farm":
			return ["idle", "walk"]
		"isometric-action":
			return [
				"idle", "move", "attack-primary", "dash", "hurt", "defeat",
			]
		"layered-depth-2d":
			return ["idle", "walk", "run", "interact"]
	return []


func _character_directions(profile: String) -> Array[String]:
	match profile:
		"side-platformer":
			return ["left", "right"]
		"topdown-farm":
			return ["north", "east", "south", "west"]
		"isometric-action":
			return [
				"north", "north-east", "east", "south-east",
				"south", "south-west", "west", "north-west",
			]
		"layered-depth-2d":
			return ["left", "right", "near", "far"]
	return []


func _character_frame_count(profile: String, action: String) -> int:
	if profile == "side-platformer" and action == "run":
		return 4
	if profile == "topdown-farm" and action == "walk":
		return 4
	return 2
