@tool
extends RefCounted

## Applies the reviewed terrain-material and landmark selections already bound
## by mapsoo_world_art_runtime_overlay.gd. It reuses the authoritative logical
## TileMapLayer and layout landmark markers instead of creating another world.

const OVERLAY_NODE := "WorldArtRuntimeOverlay"
const LOGICAL_LAYER_PATH := "MapsooLayoutMaterialization/Terrain/LogicalCells"
const LANDMARKS_PATH := "MapsooLayoutMaterialization/Landmarks"
const STATUS := "reviewed-runtime-overlay-visuals-v1"
const TERRAIN_STATUS := "reviewed-runtime-overlay-terrain-v1"
const LANDMARK_STATUS := "reviewed-runtime-overlay-landmarks-v1"


static func apply(root: Node) -> Dictionary:
	var prepared := _prepare(root)
	if not prepared.ok:
		return prepared
	var layer: TileMapLayer = prepared.layer
	var landmarks_root: Node2D = prepared.landmarks_root
	var new_tile_set: TileSet = prepared.tile_set
	var landmark_sprites: Array = prepared.landmark_sprites

	layer.tile_set = new_tile_set
	layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	layer.set_meta("mapsoo_world_art_overlay_status", TERRAIN_STATUS)
	layer.set_meta("mapsoo_world_art_overlay_id", prepared.overlay_id)
	layer.set_meta("mapsoo_world_art_projection_id", prepared.projection_id)
	layer.set_meta(
		"mapsoo_world_art_material_bindings",
		prepared.material_bindings.duplicate(true)
	)
	for item_value: Variant in landmark_sprites:
		var item: Dictionary = item_value
		var marker: Marker2D = item.marker
		var sprite: Sprite2D = item.sprite
		marker.add_child(sprite)
		sprite.owner = root
	landmarks_root.set_meta("mapsoo_world_art_overlay_status", LANDMARK_STATUS)
	landmarks_root.set_meta("mapsoo_world_art_overlay_id", prepared.overlay_id)
	landmarks_root.set_meta(
		"mapsoo_world_art_landmark_bindings",
		prepared.landmark_bindings.duplicate(true)
	)
	root.set_meta("mapsoo_world_art_visual_status", STATUS)
	root.set_meta("mapsoo_world_art_visual_overlay_id", prepared.overlay_id)
	root.set_meta("mapsoo_world_art_visual_projection_id", prepared.projection_id)
	return {
		"ok": true,
		"status": STATUS,
		"terrain_materials": prepared.material_bindings.size(),
		"landmarks": prepared.landmark_bindings.size(),
		"error": "",
	}


static func validate_scene(root: Node) -> Dictionary:
	var context := _context(root, true)
	if not context.ok:
		return context
	if (
		root.get_meta("mapsoo_world_art_visual_status", "") != STATUS
		or root.get_meta("mapsoo_world_art_visual_overlay_id", "")
			!= context.overlay_id
		or root.get_meta("mapsoo_world_art_visual_projection_id", "")
			!= context.projection_id
	):
		return _failure("Scene does not declare applied runtime overlay visuals.")
	var terrain := _terrain_bindings(context.bindings)
	var landmarks := _landmark_bindings(context.bindings)
	if not terrain.ok:
		return terrain
	if not landmarks.ok:
		return landmarks
	var layer: TileMapLayer = context.layer
	var material_sources: Dictionary = layer.get_meta("mapsoo_material_sources", {})
	var stored_materials: Dictionary = layer.get_meta(
		"mapsoo_world_art_material_bindings",
		{}
	)
	if (
		layer.get_meta("mapsoo_world_art_overlay_status", "") != TERRAIN_STATUS
		or layer.get_meta("mapsoo_world_art_overlay_id", "") != context.overlay_id
		or layer.get_meta("mapsoo_world_art_projection_id", "")
			!= context.projection_id
		or stored_materials.size() != terrain.by_usage.size()
		or layer.tile_set == null
		or layer.tile_set.get_source_count() != material_sources.size()
	):
		return _failure("Scene lost its reviewed runtime terrain binding.")
	for material_value: Variant in material_sources:
		var material := str(material_value)
		var binding: Dictionary = terrain.by_usage.get(material, {})
		var stored: Dictionary = stored_materials.get(material, {})
		var source_id := int(material_sources.get(material, -1))
		var source := layer.tile_set.get_source(source_id) as TileSetAtlasSource
		if (
			binding.is_empty()
			or stored != _binding_receipt(binding)
			or source == null
			or source.get_tiles_count() != 1
			or source.get_tile_id(0) != Vector2i.ZERO
			or not _source_matches_binding(source, binding, context.textures)
		):
			return _failure("Scene runtime terrain material changed: %s." % material)
	var landmarks_root: Node2D = context.landmarks_root
	var stored_landmarks: Dictionary = landmarks_root.get_meta(
		"mapsoo_world_art_landmark_bindings",
		{}
	)
	if (
		landmarks_root.get_meta("mapsoo_world_art_overlay_status", "")
			!= LANDMARK_STATUS
		or landmarks_root.get_meta("mapsoo_world_art_overlay_id", "")
			!= context.overlay_id
		or stored_landmarks.size() != landmarks.by_usage.size()
	):
		return _failure("Scene lost its reviewed runtime landmark binding.")
	for landmark_value: Variant in landmarks.by_usage:
		var landmark_id := str(landmark_value)
		var marker := _landmark_marker(landmarks_root, landmark_id)
		var sprite: Sprite2D = null
		if marker != null:
			sprite = marker.get_node_or_null("WorldArt") as Sprite2D
		var binding: Dictionary = landmarks.by_usage[landmark_id]
		if (
			marker == null
			or sprite == null
			or stored_landmarks.get(landmark_id) != _binding_receipt(binding)
			or not _sprite_matches_binding(sprite, binding, context)
		):
			return _failure("Scene runtime landmark changed: %s." % landmark_id)
	return {
		"ok": true,
		"status": STATUS,
		"terrain_materials": terrain.by_usage.size(),
		"landmarks": landmarks.by_usage.size(),
		"error": "",
	}


static func _prepare(root: Node) -> Dictionary:
	var context := _context(root, false)
	if not context.ok:
		return context
	if root.has_meta("mapsoo_world_art_visual_status"):
		return _failure("Runtime overlay visuals are already applied.")
	var terrain := _terrain_bindings(context.bindings)
	if not terrain.ok:
		return terrain
	var landmarks := _landmark_bindings(context.bindings)
	if not landmarks.ok:
		return landmarks
	var layer: TileMapLayer = context.layer
	var material_sources: Dictionary = layer.get_meta("mapsoo_material_sources", {})
	var material_keys: Array = material_sources.keys()
	material_keys.sort()
	var terrain_keys: Array = terrain.by_usage.keys()
	terrain_keys.sort()
	if material_keys != terrain_keys:
		return _failure(
			"Runtime overlay terrain selections must cover every logical material."
		)
	var tile_set := TileSet.new()
	tile_set.tile_size = layer.tile_set.tile_size
	tile_set.tile_shape = layer.tile_set.tile_shape
	tile_set.tile_layout = layer.tile_set.tile_layout
	tile_set.tile_offset_axis = layer.tile_set.tile_offset_axis
	var material_receipts := {}
	for material_value: Variant in material_keys:
		var material := str(material_value)
		var binding: Dictionary = terrain.by_usage[material]
		var texture := _atlas_texture(binding, context)
		if texture == null:
			return _failure("Runtime terrain texture is invalid: %s." % material)
		var source := TileSetAtlasSource.new()
		source.texture = texture
		source.texture_region_size = Vector2i(
			int(binding.region.width),
			int(binding.region.height)
		)
		source.create_tile(Vector2i.ZERO)
		var source_id := int(material_sources[material])
		if tile_set.add_source(source, source_id) != source_id:
			return _failure("Runtime terrain source ID could not be preserved.")
		material_receipts[material] = _binding_receipt(binding)
	var landmarks_root: Node2D = context.landmarks_root
	var layout_ids: Array[String] = []
	for child: Node in landmarks_root.get_children():
		if child is Marker2D:
			var landmark_id := str(child.get_meta("mapsoo_landmark_id", ""))
			if not landmark_id.is_empty():
				layout_ids.append(landmark_id)
	layout_ids.sort()
	var selected_ids: Array = landmarks.by_usage.keys()
	selected_ids.sort()
	if layout_ids != selected_ids:
		return _failure(
			"Runtime overlay landmark selections must cover every layout landmark."
		)
	var landmark_sprites: Array = []
	var landmark_receipts := {}
	for landmark_id: String in layout_ids:
		var marker := _landmark_marker(landmarks_root, landmark_id)
		if marker == null or marker.get_node_or_null("WorldArt") != null:
			return _failure("Layout landmark is missing or already has runtime art.")
		var binding: Dictionary = landmarks.by_usage[landmark_id]
		var texture := _atlas_texture(binding, context)
		var image_record: Dictionary = context.images_by_path.get(
			str(binding.image_path),
			{}
		)
		if texture == null or image_record.is_empty():
			return _failure("Runtime landmark texture is invalid: %s." % landmark_id)
		var sprite := Sprite2D.new()
		sprite.name = "WorldArt"
		sprite.texture = texture
		sprite.centered = true
		sprite.position = Vector2(
			float(binding.region.width) * 0.5 - float(image_record.pivot[0]),
			float(binding.region.height) * 0.5 - float(image_record.pivot[1])
		)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.z_index = 1
		sprite.set_meta("mapsoo_landmark_id", landmark_id)
		sprite.set_meta("mapsoo_slot_id", str(binding.slot_id))
		sprite.set_meta("mapsoo_role", str(binding.role))
		sprite.set_meta("mapsoo_variant_id", str(binding.variant_id))
		sprite.set_meta("mapsoo_cell_sha256", str(binding.cell_sha256))
		landmark_sprites.append({"marker": marker, "sprite": sprite})
		landmark_receipts[landmark_id] = _binding_receipt(binding)
	return {
		"ok": true,
		"status": "prepared",
		"layer": layer,
		"landmarks_root": landmarks_root,
		"tile_set": tile_set,
		"landmark_sprites": landmark_sprites,
		"material_bindings": material_receipts,
		"landmark_bindings": landmark_receipts,
		"overlay_id": context.overlay_id,
		"projection_id": context.projection_id,
		"error": "",
	}


static func _context(root: Node, allow_applied: bool) -> Dictionary:
	if root == null:
		return _failure("Runtime overlay visual application requires a scene root.")
	var overlay := root.get_node_or_null(OVERLAY_NODE)
	var layer := root.get_node_or_null(LOGICAL_LAYER_PATH) as TileMapLayer
	var landmarks_root := root.get_node_or_null(LANDMARKS_PATH) as Node2D
	if (
		overlay == null
		or layer == null
		or layer.tile_set == null
		or landmarks_root == null
		or root.get_meta("mapsoo_world_art_overlay_status", "")
			!= "reviewed-runtime-overlay-v1"
		or root.get_meta("mapsoo_material_palette_status", "")
			!= "production-tiles-v1"
		or (
			not allow_applied
			and layer.has_meta("mapsoo_world_art_overlay_status")
		)
	):
		return _failure(
			"Runtime overlay visuals require a bound overlay and production material TileMap."
		)
	var bindings: Variant = overlay.get_meta("mapsoo_bindings", [])
	var images: Variant = overlay.get_meta("mapsoo_images", [])
	var textures: Variant = overlay.get_meta("mapsoo_textures", {})
	if (
		typeof(bindings) != TYPE_ARRAY
		or typeof(images) != TYPE_ARRAY
		or typeof(textures) != TYPE_DICTIONARY
	):
		return _failure("Bound runtime overlay catalog is invalid.")
	var images_by_path := {}
	for image_value: Variant in images:
		if typeof(image_value) != TYPE_DICTIONARY:
			return _failure("Bound runtime overlay image record is invalid.")
		var image: Dictionary = image_value
		images_by_path[str(image.get("path", ""))] = image
	return {
		"ok": true,
		"status": "context",
		"overlay_id": str(overlay.get_meta("mapsoo_overlay_id", "")),
		"projection_id": str(overlay.get_meta("mapsoo_projection_id", "")),
		"bindings": bindings,
		"images_by_path": images_by_path,
		"textures": textures,
		"layer": layer,
		"landmarks_root": landmarks_root,
		"error": "",
	}


static func _terrain_bindings(bindings: Array) -> Dictionary:
	var by_usage := {}
	for value: Variant in bindings:
		if typeof(value) != TYPE_DICTIONARY:
			return _failure("Runtime overlay binding is invalid.")
		var binding: Dictionary = value
		if binding.get("usage_kind") != "terrain-material":
			continue
		var usage := str(binding.get("usage_id", ""))
		if (
			usage.is_empty()
			or by_usage.has(usage)
			or not str(binding.get("role", "")).begins_with("terrain.")
		):
			return _failure("Runtime terrain binding is invalid.")
		by_usage[usage] = binding
	if by_usage.is_empty():
		return _failure("Runtime overlay has no terrain-material bindings.")
	return {"ok": true, "by_usage": by_usage, "error": ""}


static func _landmark_bindings(bindings: Array) -> Dictionary:
	var by_usage := {}
	for value: Variant in bindings:
		if typeof(value) != TYPE_DICTIONARY:
			return _failure("Runtime overlay binding is invalid.")
		var binding: Dictionary = value
		if binding.get("usage_kind") != "landmark":
			continue
		var usage := str(binding.get("usage_id", ""))
		if (
			usage.is_empty()
			or by_usage.has(usage)
			or binding.get("role") != "structure.landmark"
		):
			return _failure("Runtime landmark binding is invalid.")
		by_usage[usage] = binding
	return {"ok": true, "by_usage": by_usage, "error": ""}


static func _atlas_texture(binding: Dictionary, context: Dictionary) -> AtlasTexture:
	var source: Texture2D = context.textures.get(str(binding.get("image_path", "")))
	var region_value: Variant = binding.get("region")
	if source == null or typeof(region_value) != TYPE_DICTIONARY:
		return null
	var region: Dictionary = region_value
	var rect := Rect2(
		float(region.get("x", -1)),
		float(region.get("y", -1)),
		float(region.get("width", 0)),
		float(region.get("height", 0))
	)
	if (
		rect.position.x < 0
		or rect.position.y < 0
		or rect.size.x < 1
		or rect.size.y < 1
		or rect.end.x > source.get_width()
		or rect.end.y > source.get_height()
	):
		return null
	var texture := AtlasTexture.new()
	texture.atlas = source
	texture.region = rect
	texture.filter_clip = true
	return texture


static func _source_matches_binding(
	source: TileSetAtlasSource,
	binding: Dictionary,
	textures: Dictionary
) -> bool:
	var texture := source.texture as AtlasTexture
	var expected: Texture2D = textures.get(str(binding.image_path))
	return (
		texture != null
		and expected != null
		and texture.atlas == expected
		and texture.atlas.get_width() == expected.get_width()
		and texture.atlas.get_height() == expected.get_height()
		and texture.region == Rect2(
			float(binding.region.x),
			float(binding.region.y),
			float(binding.region.width),
			float(binding.region.height)
		)
	)


static func _sprite_matches_binding(
	sprite: Sprite2D,
	binding: Dictionary,
	context: Dictionary
) -> bool:
	var image_record: Dictionary = context.images_by_path.get(
		str(binding.image_path),
		{}
	)
	var texture := sprite.texture as AtlasTexture
	var expected: Texture2D = context.textures.get(str(binding.image_path))
	return (
		not image_record.is_empty()
		and texture != null
		and expected != null
		and texture.atlas == expected
		and texture.region == Rect2(
			float(binding.region.x),
			float(binding.region.y),
			float(binding.region.width),
			float(binding.region.height)
		)
		and sprite.position == Vector2(
			float(binding.region.width) * 0.5 - float(image_record.pivot[0]),
			float(binding.region.height) * 0.5 - float(image_record.pivot[1])
		)
		and sprite.get_meta("mapsoo_slot_id", "") == binding.slot_id
		and sprite.get_meta("mapsoo_cell_sha256", "") == binding.cell_sha256
	)


static func _binding_receipt(binding: Dictionary) -> Dictionary:
	return {
		"slot_id": str(binding.slot_id),
		"role": str(binding.role),
		"variant_id": str(binding.variant_id),
		"image_path": str(binding.image_path),
		"region": (binding.region as Dictionary).duplicate(true),
		"cell_sha256": str(binding.cell_sha256),
	}


static func _landmark_marker(root: Node2D, landmark_id: String) -> Marker2D:
	for child: Node in root.get_children():
		if (
			child is Marker2D
			and child.get_meta("mapsoo_landmark_id", "") == landmark_id
		):
			return child
	return null


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
