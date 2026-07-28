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


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TEST_ROOT)) != OK:
		_fail("Unable to create runtime overlay applier smoke directory.")
		return
	var visible_terrain := 0
	var visible_landmarks := 0
	var active_hazards := 0
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
		if (
			not applied.ok
			or not hazards_applied.ok
			or int(applied.terrain_materials) < 1
			or int(applied.landmarks) < 1
			or int(hazards_applied.hazards) != 2
		):
			materialized.root.free()
			_fail(
				"%s overlay visual application failed: %s / %s" % [
					profile,
					applied,
					hazards_applied,
				]
			)
			return
		var checked := RuntimeOverlayApplier.validate_scene(materialized.root)
		var hazards_checked := RuntimeHazardApplier.validate_scene(
			materialized.root
		)
		var after := _visual_snapshot(materialized.root)
		if not checked.ok or not hazards_checked.ok or before == after:
			materialized.root.free()
			_fail(
				"%s overlay visuals were not applied: %s / %s" % [
					profile,
					checked,
					hazards_checked,
				]
			)
			return
		if not await _assert_controller_uses_runtime_hazard(materialized.root):
			materialized.root.free()
			return
		visible_terrain += int(applied.terrain_materials)
		visible_landmarks += int(applied.landmarks)
		active_hazards += int(hazards_applied.hazards)
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
		var persisted_snapshot := _visual_snapshot(persisted.root)
		if (
			not persisted_check.ok
			or not persisted_hazards.ok
			or persisted_snapshot != after
		):
			persisted.root.free()
			_fail(
				"%s persisted overlay visuals changed: %s / %s" % [
					profile,
					(
						str(persisted_check)
						if not persisted_check.ok
						else _first_difference(after, persisted_snapshot)
					),
					persisted_hazards,
				]
			)
			return
		persisted.root.free()
	if not _assert_visual_tamper_fails_closed():
		return
	if not _assert_hazard_tamper_fails_closed():
		return
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print(
		"MAPSOO_WORLD_ART_RUNTIME_OVERLAY_APPLIER_OK " +
		"profiles=4 terrain=%d landmarks=%d hazards=%d persisted=4 tamper=6" % [
			visible_terrain,
			visible_landmarks,
			active_hazards,
		]
	)
	quit(0)


func _bind_overlay_fixture(
	root: Node,
	profile: String,
	layout_sha256: String
) -> Dictionary:
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
	images.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return str(a.task_id) < str(b.task_id)
	)
	assets.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return "%s/%s" % [a.task_id, a.slot_id] < "%s/%s" % [b.task_id, b.slot_id]
	)
	bindings.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var order := {"terrain-material": 0, "landmark": 1, "hazard": 2}
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
	pivot: Array
) -> Dictionary:
	return {
		"task_id": task_id,
		"path": path,
		"media_type": "image/png",
		"bytes": 1,
		"sha256": "3".repeat(64),
		"output_sha256": "4".repeat(64),
		"width": size.x,
		"height": size.y,
		"cell_size": [size.x, size.y],
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
		"cell_sha256": ("%x" % seed).pad_zeros(64),
		"poses": [],
	}


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
	return JSON.stringify({
		"status": root.get_meta("mapsoo_world_art_visual_status", ""),
		"hazard_status": root.get_meta("mapsoo_world_art_hazard_status", ""),
		"sources": sources,
		"landmarks": landmarks,
		"hazards": hazards,
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
	player.position = Vector2(777.0, 555.0)
	player.velocity = Vector2(100.0, 100.0)
	area.body_entered.emit(player)
	await process_frame
	var expected_reason := str(area.get_meta("mapsoo_kind", "hazard"))
	if (
		player.position.distance_to(expected_spawn) > 2.0
		or player.get_meta("mapsoo_last_respawn_reason", "") != expected_reason
	):
		scene_root.remove_child(root)
		_fail(
			"Materialized runtime hazard did not trigger controller respawn: " +
			"position=%s spawn=%s velocity=%s reason=%s expected=%s." % [
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
