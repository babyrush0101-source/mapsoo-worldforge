@tool
extends RefCounted

## Materializes trusted RuntimeProjection hazard instances under the confirmed
## WorldLayoutPlan owner. Legacy Pack hazard geometry remains disabled.

const LayoutMaterializer = preload(
	"res://addons/mapsoo_importer/mapsoo_world_layout_materializer.gd"
)
const OVERLAY_NODE := "WorldArtRuntimeOverlay"
const MATERIALIZATION_PATH := "MapsooLayoutMaterialization"
const HAZARDS_NODE := "Hazards"
const STATUS := "reviewed-runtime-overlay-hazards-v1"


static func apply(root: Node) -> Dictionary:
	var prepared := _prepare(root)
	if not prepared.ok:
		return prepared
	var materialization: Node2D = prepared.materialization
	var hazards_root: Node2D = prepared.hazards_root
	materialization.add_child(hazards_root)
	_set_owner_recursive(hazards_root, root)
	root.set_meta("mapsoo_world_art_hazard_status", STATUS)
	root.set_meta("mapsoo_world_art_hazard_overlay_id", prepared.overlay_id)
	root.set_meta("mapsoo_world_art_hazard_projection_id", prepared.projection_id)
	return {
		"ok": true,
		"status": STATUS,
		"hazards": prepared.hazard_count,
		"error": "",
	}


static func validate_scene(root: Node) -> Dictionary:
	var context := _context(root, true)
	if not context.ok:
		return context
	if (
		root.get_meta("mapsoo_world_art_hazard_status", "") != STATUS
		or root.get_meta("mapsoo_world_art_hazard_overlay_id", "")
			!= context.overlay_id
		or root.get_meta("mapsoo_world_art_hazard_projection_id", "")
			!= context.projection_id
	):
		return _failure("Scene does not declare applied runtime hazards.")
	var hazards_root := context.materialization.get_node_or_null(
		HAZARDS_NODE
	) as Node2D
	if (
		hazards_root == null
		or hazards_root.get_meta("mapsoo_world_art_hazard_status", "") != STATUS
		or hazards_root.get_meta("mapsoo_world_art_overlay_id", "")
			!= context.overlay_id
		or hazards_root.get_meta("mapsoo_world_art_projection_id", "")
			!= context.projection_id
		or hazards_root.get_child_count() != context.hazards.size()
	):
		return _failure("Scene lost its reviewed runtime hazard root.")
	for hazard_value: Variant in context.hazards:
		var hazard: Dictionary = hazard_value
		var area := _hazard_area(hazards_root, str(hazard.hazard_id))
		var binding: Dictionary = context.bindings_by_usage.get(
			str(hazard.binding_usage_id),
			{}
		)
		if (
			area == null
			or not _area_matches(area, hazard, binding, context)
		):
			return _failure(
				"Scene runtime hazard changed: %s." % str(hazard.hazard_id)
			)
	return {
		"ok": true,
		"status": STATUS,
		"hazards": context.hazards.size(),
		"error": "",
	}


static func _prepare(root: Node) -> Dictionary:
	var context := _context(root, false)
	if not context.ok:
		return context
	var hazards_root := Node2D.new()
	hazards_root.name = HAZARDS_NODE
	hazards_root.set_meta("mapsoo_world_art_hazard_status", STATUS)
	hazards_root.set_meta("mapsoo_world_art_overlay_id", context.overlay_id)
	hazards_root.set_meta("mapsoo_world_art_projection_id", context.projection_id)
	hazards_root.set_meta(
		"mapsoo_world_art_hazard_inventory",
		(context.hazards as Array).duplicate(true)
	)
	for hazard_value: Variant in context.hazards:
		var hazard: Dictionary = hazard_value
		var binding: Dictionary = context.bindings_by_usage.get(
			str(hazard.binding_usage_id),
			{}
		)
		var built := _build_hazard(hazard, binding, context)
		if not built.ok:
			hazards_root.free()
			return built
		hazards_root.add_child(built.area)
	return {
		"ok": true,
		"status": "prepared",
		"materialization": context.materialization,
		"hazards_root": hazards_root,
		"hazard_count": context.hazards.size(),
		"overlay_id": context.overlay_id,
		"projection_id": context.projection_id,
		"error": "",
	}


static func _context(root: Node, allow_applied: bool) -> Dictionary:
	if root == null:
		return _failure("Runtime hazard application requires a scene root.")
	var overlay := root.get_node_or_null(OVERLAY_NODE)
	var materialization := root.get_node_or_null(
		MATERIALIZATION_PATH
	) as Node2D
	var bounds_value: Variant = root.get_meta("mapsoo_layout_bounds", null)
	var pixel_bounds_value: Variant = root.get_meta(
		"mapsoo_layout_pixel_bounds",
		null
	)
	if (
		overlay == null
		or materialization == null
		or not (bounds_value is Vector2i)
		or not (pixel_bounds_value is Rect2)
		or (bounds_value as Vector2i).x < 1
		or (bounds_value as Vector2i).y < 1
		or (pixel_bounds_value as Rect2).size.x <= 0.0
		or (pixel_bounds_value as Rect2).size.y <= 0.0
		or root.get_meta("mapsoo_layout_materialization", "")
			!= "profile-layout-v1"
		or root.get_meta("mapsoo_world_art_overlay_status", "")
			!= "reviewed-runtime-overlay-v1"
		or (
			not allow_applied
			and materialization.get_node_or_null(HAZARDS_NODE) != null
		)
	):
		return _failure(
			"Runtime hazards require one bound overlay and confirmed layout."
		)
	var hazards_value: Variant = overlay.get_meta("mapsoo_hazards", [])
	var bindings_value: Variant = overlay.get_meta("mapsoo_bindings", [])
	var textures_value: Variant = overlay.get_meta("mapsoo_textures", {})
	if (
		typeof(hazards_value) != TYPE_ARRAY
		or typeof(bindings_value) != TYPE_ARRAY
		or typeof(textures_value) != TYPE_DICTIONARY
	):
		return _failure("Bound runtime hazard catalog is invalid.")
	var bindings_by_usage := {}
	for binding_value: Variant in bindings_value:
		if typeof(binding_value) != TYPE_DICTIONARY:
			return _failure("Bound runtime hazard binding is invalid.")
		var binding: Dictionary = binding_value
		if binding.get("usage_kind") != "hazard":
			continue
		var usage_id := str(binding.get("usage_id", ""))
		if usage_id.is_empty() or bindings_by_usage.has(usage_id):
			return _failure("Bound runtime hazard usage is invalid.")
		bindings_by_usage[usage_id] = binding
	var checked_hazards := _validate_hazards(
		hazards_value,
		bindings_by_usage,
		bounds_value
	)
	if not checked_hazards.ok:
		return checked_hazards
	return {
		"ok": true,
		"status": "context",
		"overlay_id": str(overlay.get_meta("mapsoo_overlay_id", "")),
		"projection_id": str(overlay.get_meta("mapsoo_projection_id", "")),
		"profile": str(root.get_meta("mapsoo_profile", "")),
		"bounds": bounds_value,
		"pixel_bounds": pixel_bounds_value,
		"hazards": checked_hazards.hazards,
		"bindings_by_usage": bindings_by_usage,
		"textures": textures_value,
		"materialization": materialization,
		"error": "",
	}


static func _validate_hazards(
	hazards: Array,
	bindings_by_usage: Dictionary,
	bounds: Vector2i
) -> Dictionary:
	var checked: Array = []
	var previous_id := ""
	for index: int in hazards.size():
		var value: Variant = hazards[index]
		if typeof(value) != TYPE_DICTIONARY:
			return _failure("Runtime hazard %d is invalid." % index)
		var hazard: Dictionary = value
		var keys := [
			"hazard_id", "binding_usage_id", "kind", "behavior", "logical_rect",
		]
		if hazard.has("telegraph_usage_id"):
			keys.append("telegraph_usage_id")
		var rect_value: Variant = hazard.get("logical_rect")
		if (
			not _exact_keys(hazard, keys)
			or typeof(rect_value) != TYPE_DICTIONARY
		):
			return _failure("Runtime hazard %d shape is invalid." % index)
		var rect: Dictionary = rect_value
		var hazard_id := str(hazard.get("hazard_id", ""))
		var binding: Dictionary = bindings_by_usage.get(
			str(hazard.get("binding_usage_id", "")),
			{}
		)
		var telegraph: Dictionary = bindings_by_usage.get(
			str(hazard.get("telegraph_usage_id", "")),
			{}
		)
		if (
			hazard_id.is_empty()
			or (index > 0 and previous_id.casecmp_to(hazard_id) >= 0)
			or hazard.get("kind") not in ["spikes", "pit", "contact"]
			or hazard.get("behavior") != "respawn"
			or binding.get("role") != "hazard.%s" % str(hazard.get("kind"))
			or (
				hazard.has("telegraph_usage_id")
				and telegraph.get("role") != "hazard.telegraph"
			)
			or not _logical_rect_inside(rect, bounds)
		):
			return _failure("Runtime hazard %d binding is invalid." % index)
		previous_id = hazard_id
		checked.append(hazard.duplicate(true))
	return {"ok": true, "status": "validated", "hazards": checked, "error": ""}


static func _build_hazard(
	hazard: Dictionary,
	binding: Dictionary,
	context: Dictionary
) -> Dictionary:
	var atlas := _atlas_texture(binding, context.textures)
	if atlas == null:
		return _failure("Runtime hazard texture is invalid.")
	var polygon := _world_polygon(hazard.logical_rect, context)
	if polygon.size() != 4:
		return _failure("Runtime hazard geometry is invalid.")
	var area := Area2D.new()
	area.name = str(hazard.hazard_id).replace("-", "_").to_pascal_case()
	area.collision_layer = 2
	area.collision_mask = 1
	area.monitoring = true
	area.monitorable = true
	area.set_meta("mapsoo_hazard_id", str(hazard.hazard_id))
	area.set_meta("mapsoo_kind", str(hazard.kind))
	area.set_meta("mapsoo_behavior", str(hazard.behavior))
	area.set_meta("mapsoo_logical_rect", hazard.logical_rect.duplicate(true))
	area.set_meta(
		"mapsoo_world_art_binding",
		_binding_receipt(binding)
	)
	var collision := CollisionPolygon2D.new()
	collision.name = "CollisionPolygon2D"
	collision.polygon = polygon
	area.add_child(collision)
	var visual := _sprite("WorldArt", atlas, polygon, binding, 3)
	area.add_child(visual)
	if hazard.has("telegraph_usage_id"):
		var telegraph: Dictionary = context.bindings_by_usage.get(
			str(hazard.telegraph_usage_id),
			{}
		)
		var telegraph_texture := _atlas_texture(telegraph, context.textures)
		if telegraph_texture == null:
			area.free()
			return _failure("Runtime hazard telegraph texture is invalid.")
		var telegraph_sprite := _sprite(
			"Telegraph",
			telegraph_texture,
			polygon,
			telegraph,
			2
		)
		area.add_child(telegraph_sprite)
	return {"ok": true, "status": "built", "area": area, "error": ""}


static func _area_matches(
	area: Area2D,
	hazard: Dictionary,
	binding: Dictionary,
	context: Dictionary
) -> bool:
	var collision := area.get_node_or_null(
		"CollisionPolygon2D"
	) as CollisionPolygon2D
	var visual := area.get_node_or_null("WorldArt") as Sprite2D
	var polygon := _world_polygon(hazard.logical_rect, context)
	if (
		area.collision_layer != 2
		or area.collision_mask != 1
		or not area.monitoring
		or not area.monitorable
		or area.get_meta("mapsoo_kind", "") != hazard.kind
		or area.get_meta("mapsoo_behavior", "") != hazard.behavior
		or area.get_meta("mapsoo_logical_rect", {}) != hazard.logical_rect
		or area.get_meta("mapsoo_world_art_binding", {})
			!= _binding_receipt(binding)
		or collision == null
		or collision.disabled
		or not _polygon_matches(collision.polygon, polygon)
		or not _sprite_matches(visual, binding, polygon, context.textures)
	):
		return false
	var telegraph := area.get_node_or_null("Telegraph") as Sprite2D
	if not hazard.has("telegraph_usage_id"):
		return telegraph == null
	var telegraph_binding: Dictionary = context.bindings_by_usage.get(
		str(hazard.telegraph_usage_id),
		{}
	)
	return _sprite_matches(
		telegraph,
		telegraph_binding,
		polygon,
		context.textures
	)


static func _sprite(
	name_value: String,
	texture: AtlasTexture,
	polygon: PackedVector2Array,
	binding: Dictionary,
	z: int
) -> Sprite2D:
	var bounds := _polygon_bounds(polygon)
	var sprite := Sprite2D.new()
	sprite.name = name_value
	sprite.texture = texture
	sprite.centered = true
	sprite.position = bounds.get_center()
	sprite.scale = Vector2(
		bounds.size.x / texture.region.size.x,
		bounds.size.y / texture.region.size.y
	)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.z_index = z
	sprite.set_meta("mapsoo_usage_id", str(binding.usage_id))
	sprite.set_meta("mapsoo_slot_id", str(binding.slot_id))
	sprite.set_meta("mapsoo_role", str(binding.role))
	sprite.set_meta("mapsoo_variant_id", str(binding.variant_id))
	sprite.set_meta("mapsoo_cell_sha256", str(binding.cell_sha256))
	return sprite


static func _sprite_matches(
	sprite: Sprite2D,
	binding: Dictionary,
	polygon: PackedVector2Array,
	textures: Dictionary
) -> bool:
	if sprite == null:
		return false
	var texture := sprite.texture as AtlasTexture
	var expected: Texture2D = textures.get(str(binding.get("image_path", "")))
	var bounds := _polygon_bounds(polygon)
	return (
		texture != null
		and expected != null
		and texture.atlas == expected
		and texture.region == Rect2(
			float(binding.region.x),
			float(binding.region.y),
			float(binding.region.width),
			float(binding.region.height)
		)
		and sprite.position.is_equal_approx(bounds.get_center())
		and sprite.scale.is_equal_approx(Vector2(
			bounds.size.x / texture.region.size.x,
			bounds.size.y / texture.region.size.y
		))
		and sprite.get_meta("mapsoo_usage_id", "") == binding.get("usage_id")
		and sprite.get_meta("mapsoo_cell_sha256", "")
			== binding.get("cell_sha256")
	)


static func _atlas_texture(
	binding: Dictionary,
	textures: Dictionary
) -> AtlasTexture:
	var source: Texture2D = textures.get(str(binding.get("image_path", "")))
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
		rect.position.x < 0.0
		or rect.position.y < 0.0
		or rect.size.x <= 0.0
		or rect.size.y <= 0.0
		or rect.end.x > source.get_width()
		or rect.end.y > source.get_height()
	):
		return null
	var texture := AtlasTexture.new()
	texture.atlas = source
	texture.region = rect
	texture.filter_clip = true
	return texture


static func _world_polygon(
	logical_rect: Dictionary,
	context: Dictionary
) -> PackedVector2Array:
	var bounds: Vector2i = context.bounds
	return LayoutMaterializer.logical_rectangle_to_world_polygon(
		str(context.profile),
		logical_rect,
		{"width": bounds.x, "height": bounds.y},
		context.pixel_bounds
	)


static func _polygon_bounds(polygon: PackedVector2Array) -> Rect2:
	if polygon.is_empty():
		return Rect2()
	var minimum := polygon[0]
	var maximum := polygon[0]
	for point: Vector2 in polygon:
		minimum = minimum.min(point)
		maximum = maximum.max(point)
	return Rect2(minimum, maximum - minimum)


static func _polygon_matches(
	actual: PackedVector2Array,
	expected: PackedVector2Array
) -> bool:
	if actual.size() != expected.size():
		return false
	for index: int in actual.size():
		if not actual[index].is_equal_approx(expected[index]):
			return false
	return true


static func _logical_rect_inside(rect: Dictionary, bounds: Vector2i) -> bool:
	for key: String in ["x", "y", "width", "height"]:
		var value: Variant = rect.get(key)
		if (
			typeof(value) not in [TYPE_INT, TYPE_FLOAT]
			or not is_finite(float(value))
			or float(value) != floor(float(value))
		):
			return false
	return (
		int(rect.x) >= 0
		and int(rect.y) >= 0
		and int(rect.width) > 0
		and int(rect.height) > 0
		and int(rect.x) + int(rect.width) <= bounds.x
		and int(rect.y) + int(rect.height) <= bounds.y
	)


static func _binding_receipt(binding: Dictionary) -> Dictionary:
	return {
		"usage_id": str(binding.get("usage_id", "")),
		"slot_id": str(binding.get("slot_id", "")),
		"role": str(binding.get("role", "")),
		"variant_id": str(binding.get("variant_id", "")),
		"image_path": str(binding.get("image_path", "")),
		"region": (binding.get("region", {}) as Dictionary).duplicate(true),
		"cell_sha256": str(binding.get("cell_sha256", "")),
	}


static func _hazard_area(root: Node2D, hazard_id: String) -> Area2D:
	for child: Node in root.get_children():
		if (
			child is Area2D
			and child.get_meta("mapsoo_hazard_id", "") == hazard_id
		):
			return child
	return null


static func _set_owner_recursive(node: Node, owner: Node) -> void:
	node.owner = owner
	for child: Node in node.get_children():
		_set_owner_recursive(child, owner)


static func _exact_keys(value: Dictionary, expected: Array) -> bool:
	var actual: Array = value.keys()
	actual.sort()
	var canonical := expected.duplicate()
	canonical.sort()
	return actual == canonical


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
