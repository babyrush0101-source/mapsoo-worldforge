extends "res://tests/world_material_palette_smoke.gd"

const RuntimeOverlayApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay_applier.gd"
)
const RuntimeOverlay = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay.gd"
)
const RuntimeHazardApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_hazard_applier.gd"
)
const RuntimeCharacterApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_character_applier.gd"
)


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TEST_ROOT)) != OK:
		_fail("Unable to create runtime overlay applier smoke directory.")
		return
	var visible_terrain := 0
	var visible_landmarks := 0
	var active_hazards := 0
	var projected_characters := 0
	for profile: String in PROFILES:
		var fixture := _write_fixture(profile, "runtime-overlay-applier")
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var attachment := LayoutAttachment.validate_optional(
			fixture.manifest,
			fixture.root,
			fixture.manifest_sha256
		)
		if not attachment.ok:
			_fail("%s layout fixture validation failed." % profile)
			return
		var materialized := _materialize_world(profile, attachment.layout)
		if not materialized.ok:
			_fail("%s layout materialization failed." % profile)
			return
		var palette := _palette(profile, attachment.layout)
		var palette_result := MaterialPalette.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			_catalog(profile, palette)
		)
		if not palette_result.ok:
			materialized.root.free()
			_fail("%s production palette application failed." % profile)
			return
		var fixture_overlay := _bind_overlay_fixture(
			materialized.root,
			profile,
			attachment.layout.sha256
		)
		if not fixture_overlay.ok:
			materialized.root.free()
			_fail("%s overlay fixture binding failed: %s" % [profile, fixture_overlay])
			return
		var before := _visual_snapshot(materialized.root)
		var applied := RuntimeOverlayApplier.apply(materialized.root)
		var hazards_applied := RuntimeHazardApplier.apply(materialized.root)
		var character_applied := RuntimeCharacterApplier.apply(materialized.root)
		if (
			not applied.ok
			or not hazards_applied.ok
			or not character_applied.ok
			or int(applied.terrain_materials) < 1
			or int(applied.landmarks) < 1
			or int(hazards_applied.hazards) != 2
			or int(character_applied.animation_count) < 1
		):
			materialized.root.free()
			_fail(
				"%s overlay visual application failed: %s / %s / %s" % [
					profile,
					applied,
					hazards_applied,
					character_applied,
				]
			)
			return
		var checked := RuntimeOverlayApplier.validate_scene(materialized.root)
		var hazards_checked := RuntimeHazardApplier.validate_scene(
			materialized.root
		)
		var character_checked := RuntimeCharacterApplier.validate_scene(
			materialized.root
		)
		var after := _visual_snapshot(materialized.root)
		if (
			not checked.ok
			or not hazards_checked.ok
			or not character_checked.ok
			or before == after
		):
			materialized.root.free()
			_fail(
				"%s overlay visuals were not applied: %s / %s / %s" % [
					profile,
					checked,
					hazards_checked,
					character_checked,
				]
			)
			return
		if not await _assert_controller_uses_runtime_hazard(materialized.root):
			materialized.root.free()
			return
		visible_terrain += int(applied.terrain_materials)
		visible_landmarks += int(applied.landmarks)
		active_hazards += int(hazards_applied.hazards)
		projected_characters += 1
		var persisted := _persist_and_reload(
			materialized.root,
			fixture.root,
			"%s-runtime-overlay-visuals" % profile
		)
		materialized.root.free()
		if not persisted.ok:
			_fail("%s overlay visual persistence failed: %s" % [profile, persisted])
			return
		var persisted_check := RuntimeOverlayApplier.validate_scene(persisted.root)
		var persisted_hazards := RuntimeHazardApplier.validate_scene(
			persisted.root
		)
		var persisted_character := RuntimeCharacterApplier.validate_scene(
			persisted.root
		)
		var persisted_snapshot := _visual_snapshot(persisted.root)
		if (
			not persisted_check.ok
			or not persisted_hazards.ok
			or not persisted_character.ok
			or persisted_snapshot != after
		):
			persisted.root.free()
			_fail(
				"%s persisted overlay visuals changed: %s / %s / %s" % [
					profile,
					(
						str(persisted_check)
						if not persisted_check.ok
						else _first_difference(after, persisted_snapshot)
					),
					persisted_hazards,
					persisted_character,
				]
			)
			return
		persisted.root.free()
	if not _assert_visual_tamper_fails_closed():
		return
	if not _assert_hazard_tamper_fails_closed():
		return
	if not _assert_character_tamper_fails_closed():
		return
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print(
		(
			"MAPSOO_WORLD_ART_RUNTIME_OVERLAY_APPLIER_OK " +
			"profiles=4 terrain=%d landmarks=%d hazards=%d characters=%d " +
			"persisted=4 tamper=9"
		) % [
			visible_terrain,
			visible_landmarks,
			active_hazards,
			projected_characters,
		]
	)
	quit(0)


func _bind_overlay_fixture(
	root: Node,
	profile: String,
	layout_sha256: String
) -> Dictionary:
	var player := _find_player(root)
	if player == null:
		return {"ok": false, "error": "Materialized player is missing."}
	var player_visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	if player_visual == null:
		player_visual = AnimatedSprite2D.new()
		player_visual.name = "Visual"
		player_visual.sprite_frames = SpriteFrames.new()
		player_visual.set_meta("mapsoo_runtime_slot_id", "player")
		player.add_child(player_visual)
		player_visual.owner = root
	var layer := root.get_node_or_null(
		"MapsooLayoutMaterialization/Terrain/LogicalCells"
	) as TileMapLayer
	var landmarks_root := root.get_node_or_null(
		"MapsooLayoutMaterialization/Landmarks"
	) as Node2D
	if layer == null or landmarks_root == null:
		return {"ok": false, "error": "Materialized visual owners are missing."}
	var images: Array = []
	var assets: Array = []
	var bindings: Array = []
	var textures := {}
	var material_sources: Dictionary = layer.get_meta("mapsoo_material_sources", {})
	var material_roles: Dictionary = layer.get_meta("mapsoo_material_roles", {})
	var materials: Array = material_sources.keys()
	materials.sort()
	for index: int in materials.size():
		var material := str(materials[index])
		var size := layer.tile_set.tile_size
		var task_id := "terrain-%03d" % index
		var slot_id := "terrain-slot-%03d" % index
		var path := "fixture/%s.png" % task_id
		var texture := _portable_texture(size, index + 1)
		textures[path] = texture
		images.append(_image_record(task_id, path, size, [size.x / 2, size.y]))
		var shared := _asset_fields(
			task_id,
			slot_id,
			str(material_roles[material]),
			path,
			size,
			(index + 1)
		)
		var asset: Dictionary = shared.duplicate(true)
		asset["requirement_id"] = "requirement-%s" % slot_id
		assets.append(asset)
		var binding: Dictionary = shared.duplicate(true)
		binding["usage_kind"] = "terrain-material"
		binding["usage_id"] = material
		bindings.append(binding)
	var landmark_ids: Array[String] = []
	for child: Node in landmarks_root.get_children():
		if child is Marker2D:
			var landmark_id := str(child.get_meta("mapsoo_landmark_id", ""))
			if not landmark_id.is_empty():
				landmark_ids.append(landmark_id)
	landmark_ids.sort()
	for index: int in landmark_ids.size():
		var landmark_id := landmark_ids[index]
		var task_id := "landmark-%03d" % index
		var slot_id := "landmark-slot-%03d" % index
		var path := "fixture/%s.png" % task_id
		var size := Vector2i(64, 64)
		var texture := _portable_texture(size, materials.size() + index + 1)
		textures[path] = texture
		images.append(_image_record(task_id, path, size, [32, 56]))
		var shared := _asset_fields(
			task_id,
			slot_id,
			"structure.landmark",
			path,
			size,
			materials.size() + index + 1
		)
		var asset: Dictionary = shared.duplicate(true)
		asset["requirement_id"] = "requirement-%s" % slot_id
		assets.append(asset)
		var binding: Dictionary = shared.duplicate(true)
		binding["usage_kind"] = "landmark"
		binding["usage_id"] = landmark_id
		bindings.append(binding)
	var hazard_roles: Array = (
		["hazard.spikes", "hazard.pit"]
		if profile == "side-platformer"
		else ["hazard.contact"]
	)
	if profile == "isometric-action":
		hazard_roles.append("hazard.telegraph")
	for index: int in hazard_roles.size():
		var role := str(hazard_roles[index])
		var task_id := "hazard-%03d" % index
		var slot_id := "hazard-slot-%03d" % index
		var path := "fixture/%s.png" % task_id
		var size := Vector2i(64, 64)
		var seed := materials.size() + landmark_ids.size() + index + 1
		textures[path] = _portable_texture(size, seed)
		images.append(_image_record(task_id, path, size, [32, 56]))
		var shared := _asset_fields(
			task_id,
			slot_id,
			role,
			path,
			size,
			seed
		)
		var asset: Dictionary = shared.duplicate(true)
		asset["requirement_id"] = "requirement-%s" % slot_id
		assets.append(asset)
		var binding: Dictionary = shared.duplicate(true)
		binding["usage_kind"] = "hazard"
		binding["usage_id"] = "requirement-%s" % role.replace(".", "-")
		bindings.append(binding)
	var character_geometry := _character_geometry(profile)
	var character_task_id := "character-000"
	var character_slot_id := "character-slot-000"
	var character_path := "fixture/%s.png" % character_task_id
	var character_size: Vector2i = character_geometry.size
	var character_seed := (
		materials.size() + landmark_ids.size() + hazard_roles.size() + 1
	)
	textures[character_path] = _portable_texture(
		character_size,
		character_seed
	)
	images.append(_image_record(
		character_task_id,
		character_path,
		character_size,
		character_geometry.pivot,
		character_geometry.cell_size
	))
	var character_shared := _asset_fields(
		character_task_id,
		character_slot_id,
		"character.player.atlas",
		character_path,
		character_size,
		character_seed
	)
	character_shared["poses"] = _character_poses(profile, character_geometry)
	var character_asset: Dictionary = character_shared.duplicate(true)
	character_asset["requirement_id"] = "requirement-character-player"
	assets.append(character_asset)
	var character_binding: Dictionary = character_shared.duplicate(true)
	character_binding["usage_kind"] = "character"
	character_binding["usage_id"] = "requirement-character-player"
	bindings.append(character_binding)
	images.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return str(a.task_id) < str(b.task_id)
	)
	assets.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return "%s/%s" % [a.task_id, a.slot_id] < "%s/%s" % [b.task_id, b.slot_id]
	)
	bindings.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var order := {
			"terrain-material": 0,
			"landmark": 1,
			"hazard": 2,
			"character": 3,
		}
		return "%d/%s/%s" % [
			order[a.usage_kind],
			a.usage_id,
			a.slot_id,
		] < "%d/%s/%s" % [
			order[b.usage_kind],
			b.usage_id,
			b.slot_id,
		]
	)
	var source := {
		"variant_map_id": "variant-map-fixture",
		"variant_map_sha256": "a".repeat(64),
		"layout_plan_sha256": layout_sha256,
		"production_art_plan_id": "production-plan-fixture",
		"production_art_plan_sha256": "b".repeat(64),
		"requirements_sha256": "c".repeat(64),
		"run_set_sha256": "d".repeat(64),
		"reviewed_slot_inventory_sha256": "e".repeat(64),
		"review_record_sha256": "f".repeat(64),
	}
	var rights := {"distribution": "public", "license": "CC0-1.0"}
	var hazards: Array = []
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
		hazards.append(hazard)
	var projection := {
		"schema_version": "1.0.0",
		"document_type": "world-art-runtime-projection",
		"profile": profile,
		"source": source,
		"rights": rights,
		"images": images,
		"assets": assets,
		"bindings": bindings,
		"hazards": hazards,
	}
	projection["projection_id"] = "world-art-runtime-projection-%s" % (
		_canonical_json(projection).sha256_text().left(16)
	)
	var manifest := {
		"overlay_id": "world-art-runtime-overlay-fixture",
		"profile": profile,
		"source": {
			"projection_id": projection.projection_id,
			"projection_sha256": _canonical_json(projection).sha256_text(),
			"layout_plan_sha256": layout_sha256,
			"review_record_sha256": source.review_record_sha256,
		},
		"rights": rights,
	}
	return RuntimeOverlay.bind_scene(root, {
		"manifest": manifest,
		"manifest_sha256": "1".repeat(64),
		"projection": projection,
		"projection_file_sha256": "2".repeat(64),
		"textures": textures,
	})


func _portable_texture(size: Vector2i, seed: int) -> PortableCompressedTexture2D:
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


func _image_record(
	task_id: String,
	path: String,
	size: Vector2i,
	pivot: Array,
	cell_size: Vector2i = Vector2i.ZERO
) -> Dictionary:
	var effective_cell := size if cell_size == Vector2i.ZERO else cell_size
	return {
		"task_id": task_id,
		"path": path,
		"media_type": "image/png",
		"bytes": 1,
		"sha256": "3".repeat(64),
		"output_sha256": "4".repeat(64),
		"width": size.x,
		"height": size.y,
		"cell_size": [effective_cell.x, effective_cell.y],
		"pivot": pivot,
		"alpha_policy": "opaque",
	}


func _asset_fields(
	task_id: String,
	slot_id: String,
	role: String,
	path: String,
	size: Vector2i,
	seed: int
) -> Dictionary:
	return {
		"task_id": task_id,
		"slot_id": slot_id,
		"role": role,
		"variant_id": "default",
		"image_path": path,
		"region": {"x": 0, "y": 0, "width": size.x, "height": size.y},
		"cell_sha256": str(seed).sha256_text(),
		"poses": [],
	}


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


func _character_poses(
	profile: String,
	geometry: Dictionary
) -> Array:
	var poses: Array = []
	var actions := _character_actions(profile)
	var directions := _character_directions(profile)
	var size: Vector2i = geometry.size
	var cell_size: Vector2i = geometry.cell_size
	var columns := size.x / cell_size.x
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
						"duration_ms": _character_frame_duration(action),
						"region": {
							"x": (
								(frame_index - frame_start)
								* directions.size()
								+ direction_index
							) * cell_size.x,
							"y": row * cell_size.y,
							"width": cell_size.x,
							"height": cell_size.y,
						},
					})
			row += 1
	poses.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		return "%s/%s/%03d" % [
			left.action,
			left.direction,
			int(left.frame_index),
		] < "%s/%s/%03d" % [
			right.action,
			right.direction,
			int(right.frame_index),
		]
	)
	return poses


func _character_actions(profile: String) -> Array[String]:
	match profile:
		"side-platformer":
			return ["idle", "run", "jump", "fall", "land", "hurt"]
		"topdown-farm":
			return ["idle", "walk"]
		"isometric-action":
			return ["idle", "move", "attack-primary", "dash", "hurt", "defeat"]
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


func _character_frame_duration(action: String) -> int:
	if action == "idle":
		return 250
	if action in ["walk", "interact"]:
		return 150
	if action in ["run", "move"]:
		return 100
	if action in ["attack-primary", "dash"]:
		return 80
	if action == "defeat":
		return 180
	return 120


func _canonical_json(value: Variant) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return str(value)
		TYPE_FLOAT:
			if not is_finite(float(value)):
				return ""
			if float(value) == floor(float(value)):
				return str(int(value))
			return JSON.stringify(value, "", true, false)
		TYPE_STRING:
			return JSON.stringify(value)
		TYPE_ARRAY:
			var items: Array[String] = []
			for item: Variant in value:
				items.append(_canonical_json(item))
			return "[%s]" % ",".join(items)
		TYPE_DICTIONARY:
			var keys: Array = value.keys()
			keys.sort()
			var entries: Array[String] = []
			for key: Variant in keys:
				entries.append(
					"%s:%s" % [JSON.stringify(str(key)), _canonical_json(value[key])]
				)
			return "{%s}" % ",".join(entries)
		_:
			return ""


func _visual_snapshot(root: Node) -> String:
	var layer := root.get_node_or_null(
		"MapsooLayoutMaterialization/Terrain/LogicalCells"
	) as TileMapLayer
	var landmarks_root := root.get_node_or_null(
		"MapsooLayoutMaterialization/Landmarks"
	) as Node2D
	if layer == null or landmarks_root == null:
		return "missing"
	var sources := {}
	for source_index: int in layer.tile_set.get_source_count():
		var source_id := layer.tile_set.get_source_id(source_index)
		var source := layer.tile_set.get_source(source_id) as TileSetAtlasSource
		var atlas := source.texture as AtlasTexture
		if atlas != null:
			sources[str(source_id)] = {
				"kind": "reviewed-atlas",
				"region": [
					atlas.region.position.x,
					atlas.region.position.y,
					atlas.region.size.x,
					atlas.region.size.y,
				],
				"texture_size": [atlas.atlas.get_width(), atlas.atlas.get_height()],
			}
		else:
			sources[str(source_id)] = {
				"kind": "palette-placeholder",
				"texture_size": [
					source.texture.get_width(),
					source.texture.get_height(),
				],
			}
	var landmarks := {}
	for child: Node in landmarks_root.get_children():
		if child is Marker2D:
			var sprite := child.get_node_or_null("WorldArt") as Sprite2D
			var landmark_id := str(child.get_meta("mapsoo_landmark_id", ""))
			landmarks[landmark_id] = (
				{
					"position": [sprite.position.x, sprite.position.y],
					"slot_id": sprite.get_meta("mapsoo_slot_id", ""),
					"cell_sha256": sprite.get_meta("mapsoo_cell_sha256", ""),
				}
				if sprite != null
				else {}
			)
	var hazards := {}
	var hazards_root := root.get_node_or_null(
		"MapsooLayoutMaterialization/Hazards"
	)
	if hazards_root != null:
		for child: Node in hazards_root.get_children():
			if child is Area2D:
				var collision := child.get_node_or_null(
					"CollisionPolygon2D"
				) as CollisionPolygon2D
				var visual := child.get_node_or_null("WorldArt") as Sprite2D
				var telegraph := child.get_node_or_null("Telegraph") as Sprite2D
				hazards[str(child.get_meta("mapsoo_hazard_id", ""))] = {
					"kind": child.get_meta("mapsoo_kind", ""),
					"behavior": child.get_meta("mapsoo_behavior", ""),
					"logical_rect": child.get_meta("mapsoo_logical_rect", {}),
					"collision_points": collision.polygon.size() if collision != null else 0,
					"visual_usage": (
						visual.get_meta("mapsoo_usage_id", "")
						if visual != null
						else ""
					),
					"telegraph_usage": (
						telegraph.get_meta("mapsoo_usage_id", "")
						if telegraph != null
						else ""
					),
				}
	var character := {}
	var player := _find_player(root)
	var visual := (
		player.get_node_or_null("Visual") as AnimatedSprite2D
		if player != null
		else null
	)
	if visual != null and visual.sprite_frames != null:
		var animation_names: Array = visual.sprite_frames.get_animation_names()
		animation_names.sort()
		var frame_counts := {}
		for animation_name: StringName in animation_names:
			frame_counts[str(animation_name)] = (
				visual.sprite_frames.get_frame_count(animation_name)
			)
		character = {
			"status": visual.get_meta(
				"mapsoo_world_art_character_status",
				""
			),
			"usage_id": visual.get_meta("mapsoo_world_art_usage_id", ""),
			"cell_sha256": visual.get_meta(
				"mapsoo_world_art_cell_sha256",
				""
			),
			"frame_counts": frame_counts,
		}
	return JSON.stringify({
		"status": root.get_meta("mapsoo_world_art_visual_status", ""),
		"hazard_status": root.get_meta("mapsoo_world_art_hazard_status", ""),
		"sources": sources,
		"landmarks": landmarks,
		"hazards": hazards,
		"character": character,
	})


func _assert_visual_tamper_fails_closed() -> bool:
	var fixture := _write_fixture("topdown-farm", "runtime-overlay-applier-tamper")
	if not fixture.ok:
		_fail(str(fixture.error))
		return false
	var attachment := LayoutAttachment.validate_optional(
		fixture.manifest,
		fixture.root,
		fixture.manifest_sha256
	)
	if not attachment.ok:
		_fail("Runtime overlay applier tamper fixture validation failed.")
		return false
	var mutations := ["missing-material", "missing-landmark", "existing-art"]
	for mutation: String in mutations:
		var materialized := _materialize_world("topdown-farm", attachment.layout)
		if not materialized.ok:
			_fail("Runtime overlay applier tamper world setup failed.")
			return false
		var palette := _palette("topdown-farm", attachment.layout)
		var palette_result := MaterialPalette.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			_catalog("topdown-farm", palette)
		)
		if not palette_result.ok:
			materialized.root.free()
			_fail("Runtime overlay applier tamper world setup failed.")
			return false
		var bound := _bind_overlay_fixture(
			materialized.root,
			"topdown-farm",
			attachment.layout.sha256
		)
		var container: Node = materialized.root.get_node("WorldArtRuntimeOverlay")
		var bindings: Array = container.get_meta("mapsoo_bindings")
		if mutation == "missing-material":
			for index: int in range(bindings.size() - 1, -1, -1):
				if bindings[index].usage_kind == "terrain-material":
					bindings.remove_at(index)
					break
		elif mutation == "missing-landmark":
			for index: int in range(bindings.size() - 1, -1, -1):
				if bindings[index].usage_kind == "landmark":
					bindings.remove_at(index)
					break
		else:
			var landmarks_root: Node = materialized.root.get_node(
				"MapsooLayoutMaterialization/Landmarks"
			)
			var marker: Marker2D = landmarks_root.get_child(0)
			var existing := Sprite2D.new()
			existing.name = "WorldArt"
			marker.add_child(existing)
		container.set_meta("mapsoo_bindings", bindings)
		var before := _visual_snapshot(materialized.root)
		var result := RuntimeOverlayApplier.apply(materialized.root)
		var after := _visual_snapshot(materialized.root)
		if not bound.ok or result.ok or before != after:
			materialized.root.free()
			_fail("Runtime overlay visual tamper did not fail before mutation: %s." % mutation)
			return false
		materialized.root.free()
	return true


func _assert_hazard_tamper_fails_closed() -> bool:
	var fixture := _write_fixture("topdown-farm", "runtime-hazard-applier-tamper")
	if not fixture.ok:
		_fail(str(fixture.error))
		return false
	var attachment := LayoutAttachment.validate_optional(
		fixture.manifest,
		fixture.root,
		fixture.manifest_sha256
	)
	if not attachment.ok:
		_fail("Runtime hazard applier tamper fixture validation failed.")
		return false
	var mutations := ["missing-binding", "out-of-bounds", "existing-root"]
	for mutation: String in mutations:
		var materialized := _materialize_world(
			"topdown-farm",
			attachment.layout
		)
		if not materialized.ok:
			_fail("Runtime hazard applier tamper world setup failed.")
			return false
		var palette := _palette("topdown-farm", attachment.layout)
		var palette_result := MaterialPalette.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			_catalog("topdown-farm", palette)
		)
		if not palette_result.ok:
			materialized.root.free()
			_fail("Runtime hazard applier tamper palette setup failed.")
			return false
		var bound := _bind_overlay_fixture(
			materialized.root,
			"topdown-farm",
			attachment.layout.sha256
		)
		var container: Node = materialized.root.get_node("WorldArtRuntimeOverlay")
		if mutation == "missing-binding":
			var bindings: Array = container.get_meta("mapsoo_bindings")
			for index: int in range(bindings.size() - 1, -1, -1):
				if bindings[index].usage_id == "requirement-hazard-contact":
					bindings.remove_at(index)
					break
			container.set_meta("mapsoo_bindings", bindings)
		elif mutation == "out-of-bounds":
			var hazards: Array = container.get_meta("mapsoo_hazards")
			hazards[0].logical_rect.x = 64
			container.set_meta("mapsoo_hazards", hazards)
		else:
			var existing := Node2D.new()
			existing.name = "Hazards"
			var materialization: Node = materialized.root.get_node(
				"MapsooLayoutMaterialization"
			)
			materialization.add_child(existing)
			existing.owner = materialized.root
		var before := _visual_snapshot(materialized.root)
		var result := RuntimeHazardApplier.apply(materialized.root)
		var after := _visual_snapshot(materialized.root)
		if not bound.ok or result.ok or before != after:
			materialized.root.free()
			_fail(
				"Runtime hazard tamper did not fail before mutation: %s." % mutation
			)
			return false
		materialized.root.free()
	return true


func _assert_controller_uses_runtime_hazard(root: Node) -> bool:
	var player := _find_player(root)
	var hazards_root := root.get_node_or_null(
		"MapsooLayoutMaterialization/Hazards"
	)
	if player == null or hazards_root == null or hazards_root.get_child_count() < 1:
		_fail("Runtime hazard controller fixture is incomplete.")
		return false
	var area := hazards_root.get_child(0) as Area2D
	if area == null:
		_fail("Runtime hazard controller fixture has no Area2D.")
		return false
	var scene_root := get_root()
	scene_root.add_child(root)
	await process_frame
	player.call("_connect_hazards")
	if area.body_entered.get_connections().is_empty():
		scene_root.remove_child(root)
		_fail("Controller did not connect to the materialized runtime hazard.")
		return false
	var expected_spawn: Vector2 = player.get("spawn_position")
	var respawn_events: Array = []
	player.connect(
		"player_respawned",
		func(reason: String) -> void:
			respawn_events.append({
				"reason": reason,
				"position": player.position,
				"velocity": player.velocity,
			}),
		CONNECT_ONE_SHOT
	)
	player.position = Vector2(777.0, 555.0)
	player.velocity = Vector2(100.0, 100.0)
	area.body_entered.emit(player)
	await process_frame
	var expected_reason := str(area.get_meta("mapsoo_kind", "hazard"))
	if (
		respawn_events.size() != 1
		or not (respawn_events[0].position as Vector2).is_equal_approx(
			expected_spawn
		)
		or respawn_events[0].velocity != Vector2.ZERO
		or respawn_events[0].reason != expected_reason
		or player.get_meta("mapsoo_last_respawn_reason", "") != expected_reason
	):
		scene_root.remove_child(root)
		_fail(
			"Materialized runtime hazard did not trigger controller respawn: " +
			"events=%s position=%s spawn=%s velocity=%s reason=%s expected=%s." % [
				respawn_events,
				player.position,
				expected_spawn,
				player.velocity,
				player.get_meta("mapsoo_last_respawn_reason", ""),
				expected_reason,
			]
		)
		return false
	scene_root.remove_child(root)
	return true


func _assert_character_tamper_fails_closed() -> bool:
	var fixture := _write_fixture(
		"topdown-farm",
		"runtime-character-applier-tamper"
	)
	if not fixture.ok:
		_fail(str(fixture.error))
		return false
	var attachment := LayoutAttachment.validate_optional(
		fixture.manifest,
		fixture.root,
		fixture.manifest_sha256
	)
	if not attachment.ok:
		_fail("Runtime character applier tamper fixture validation failed.")
		return false
	var mutations := ["missing-binding", "incomplete-poses", "existing-profile"]
	for mutation: String in mutations:
		var materialized := _materialize_world(
			"topdown-farm",
			attachment.layout
		)
		if not materialized.ok:
			_fail("Runtime character applier tamper world setup failed.")
			return false
		var palette := _palette("topdown-farm", attachment.layout)
		var palette_result := MaterialPalette.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			_catalog("topdown-farm", palette)
		)
		if not palette_result.ok:
			materialized.root.free()
			_fail("Runtime character applier tamper palette setup failed.")
			return false
		var bound := _bind_overlay_fixture(
			materialized.root,
			"topdown-farm",
			attachment.layout.sha256
		)
		var container: Node = materialized.root.get_node("WorldArtRuntimeOverlay")
		var bindings: Array = container.get_meta("mapsoo_bindings")
		if mutation == "missing-binding":
			for index: int in range(bindings.size() - 1, -1, -1):
				if bindings[index].usage_kind == "character":
					bindings.remove_at(index)
					break
			container.set_meta("mapsoo_bindings", bindings)
		elif mutation == "incomplete-poses":
			for binding: Dictionary in bindings:
				if binding.usage_kind == "character":
					binding.poses.pop_back()
					break
			container.set_meta("mapsoo_bindings", bindings)
		else:
			materialized.root.set_meta(
				"mapsoo_character_profile_revision_id",
				"existing-reviewed-character"
			)
		var before := _visual_snapshot(materialized.root)
		var result := RuntimeCharacterApplier.apply(materialized.root)
		var after := _visual_snapshot(materialized.root)
		if not bound.ok or result.ok or before != after:
			materialized.root.free()
			_fail(
				"Runtime character tamper did not fail before mutation: %s."
				% mutation
			)
			return false
		materialized.root.free()
	return true
