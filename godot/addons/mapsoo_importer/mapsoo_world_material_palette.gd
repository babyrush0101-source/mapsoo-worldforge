@tool
extends RefCounted

## Applies one provider-neutral logical-material -> canonical terrain-role palette
## to the authoritative WorldLayoutPlan TileMapLayer. Pack-specific code only
## supplies already-validated role textures; this module owns coverage,
## deterministic source assignment, projection alignment, and persistence.

const SCHEMA_VERSION := "1.0.0"
const DOCUMENT_TYPE := "world-material-palette"
const RENDERING := "single-cell"
const MATERIALIZATION_NODE := "MapsooLayoutMaterialization"
const LOGICAL_LAYER_PATH := "MapsooLayoutMaterialization/Terrain/LogicalCells"
const STATUS := "production-tiles-v1"
const SUPPORTED_PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]


static func validate(
	palette: Dictionary,
	plan: Dictionary,
	layout_plan_sha256: String,
	available_roles: Array
) -> Dictionary:
	if (
		typeof(palette) != TYPE_DICTIONARY
		or typeof(plan) != TYPE_DICTIONARY
		or not _sha256(layout_plan_sha256)
	):
		return _failure("World material palette validation input is invalid.")
	if not _exact_keys(palette, [
		"schema_version",
		"document_type",
		"palette_id",
		"profile",
		"layout",
		"entries",
	]):
		return _failure("World material palette has unsupported or missing fields.")
	if (
		palette.get("schema_version") != SCHEMA_VERSION
		or palette.get("document_type") != DOCUMENT_TYPE
		or not _safe_id(palette.get("palette_id"))
		or palette.get("profile") not in SUPPORTED_PROFILES
		or palette.get("profile") != plan.get("profile")
	):
		return _failure("World material palette identity or profile is invalid.")
	var layout := _dictionary(palette.get("layout"))
	if (
		not _exact_keys(layout, ["plan_id", "sha256"])
		or not _safe_id(layout.get("plan_id"))
		or not _sha256(layout.get("sha256"))
		or layout.get("plan_id") != plan.get("plan_id")
		or layout.get("sha256") != layout_plan_sha256
	):
		return _failure("World material palette does not bind the exact layout plan.")
	var available := {}
	for role_value: Variant in available_roles:
		if typeof(role_value) != TYPE_STRING or not _terrain_role(role_value):
			return _failure("World material palette role catalog is invalid.")
		available[str(role_value)] = true
	var entries_value: Variant = palette.get("entries")
	if (
		typeof(entries_value) != TYPE_ARRAY
		or entries_value.is_empty()
		or entries_value.size() > 64
	):
		return _failure("World material palette entry count is invalid.")
	var entries: Array = entries_value
	var material_to_role := {}
	var previous := ""
	for index: int in entries.size():
		var entry := _dictionary(entries[index])
		if (
			not _exact_keys(entry, ["material", "role", "rendering"])
			or not _safe_id(entry.get("material"))
			or not _terrain_role(entry.get("role"))
			or entry.get("rendering") != RENDERING
		):
			return _failure("World material palette entry %d is invalid." % index)
		var material := str(entry.material)
		var role := str(entry.role)
		if material_to_role.has(material) or (not previous.is_empty() and previous >= material):
			return _failure("World material palette materials are duplicated or unsorted.")
		if not available.has(role):
			return _failure("World material palette references a role absent from the pack.")
		material_to_role[material] = role
		previous = material
	var expected_materials := _layout_materials(plan)
	var mapped_materials: Array = material_to_role.keys()
	mapped_materials.sort()
	if (
		expected_materials.size() != material_to_role.size()
		or expected_materials != mapped_materials
	):
		return _failure(
			"World material palette must map every layout material exactly once " +
			"(expected=%s mapped=%s)." % [expected_materials, mapped_materials]
		)
	return {
		"ok": true,
		"status": "validated",
		"material_to_role": material_to_role,
		"error": "",
	}


static func apply(
	root: Node,
	plan: Dictionary,
	layout_plan_sha256: String,
	palette: Dictionary,
	catalog: Dictionary
) -> Dictionary:
	if root == null or typeof(catalog) != TYPE_DICTIONARY:
		return _failure("World material palette application input is invalid.")
	var roles := _dictionary(catalog.get("roles"))
	var checked := validate(
		palette,
		plan,
		layout_plan_sha256,
		roles.keys()
	)
	if not checked.ok:
		return checked
	if not _catalog_geometry_valid(catalog, roles):
		return _failure("World material palette texture catalog is invalid.")
	var layer := root.get_node_or_null(LOGICAL_LAYER_PATH) as TileMapLayer
	var materialization := root.get_node_or_null(MATERIALIZATION_NODE) as Node2D
	if (
		layer == null
		or materialization == null
		or root.get_meta("mapsoo_layout_plan_sha256", "") != layout_plan_sha256
		or root.get_meta("mapsoo_layout_plan_id", "") != plan.get("plan_id")
	):
		return _failure("World material palette requires an exact materialized layout.")
	if root.has_meta("mapsoo_material_palette_status"):
		return _failure("World material palette is already applied.")

	var tile_size: Vector2i = catalog.tile_size
	var tile_set := TileSet.new()
	tile_set.tile_size = tile_size
	if str(plan.profile) == "isometric-action":
		tile_set.tile_shape = TileSet.TILE_SHAPE_ISOMETRIC
		tile_set.tile_layout = TileSet.TILE_LAYOUT_DIAMOND_RIGHT
	var material_sources := {}
	for material_value: Variant in checked.material_to_role:
		var material := str(material_value)
		var role := str(checked.material_to_role[material])
		var texture: Texture2D = roles[role]
		var source := TileSetAtlasSource.new()
		source.texture = texture
		source.texture_region_size = Vector2i(texture.get_width(), texture.get_height())
		source.create_tile(Vector2i.ZERO)
		var source_id := material_sources.size()
		if tile_set.add_source(source, source_id) != source_id:
			return _failure("World material palette could not add a deterministic TileSet source.")
		material_sources[material] = source_id

	layer.clear()
	layer.tile_set = tile_set
	for terrain_value: Variant in _terrain_items(plan):
		var terrain: Dictionary = terrain_value
		var source_id := int(material_sources[str(terrain.material)])
		for y: int in range(int(terrain.y), int(terrain.y) + int(terrain.height)):
			for x: int in range(int(terrain.x), int(terrain.x) + int(terrain.width)):
				layer.set_cell(Vector2i(x, y), source_id, Vector2i.ZERO, 0)
	_align_layer(layer, plan, materialization.get_meta("mapsoo_pixel_bounds"))
	layer.visible = true
	layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	layer.set_meta("mapsoo_semantic_only", false)
	layer.set_meta("mapsoo_material_sources", material_sources.duplicate(true))
	layer.set_meta("mapsoo_material_roles", checked.material_to_role.duplicate(true))
	layer.set_meta("mapsoo_material_palette_id", str(palette.palette_id))
	var terrain_root := layer.get_parent() as CanvasItem
	if terrain_root != null:
		terrain_root.visible = true
	root.set_meta("mapsoo_material_palette_status", STATUS)
	root.set_meta("mapsoo_material_palette_id", str(palette.palette_id))
	root.set_meta("mapsoo_material_palette_layout_sha256", layout_plan_sha256)
	return {"ok": true, "status": STATUS, "error": ""}


static func validate_scene(
	root: Node,
	plan: Dictionary,
	layout_plan_sha256: String,
	palette: Dictionary
) -> Dictionary:
	if (
		root == null
		or root.get_meta("mapsoo_material_palette_status", "") != STATUS
		or root.get_meta("mapsoo_material_palette_id", "") != palette.get("palette_id")
		or root.get_meta("mapsoo_material_palette_layout_sha256", "") != layout_plan_sha256
	):
		return _failure("Scene does not declare the bound production material palette.")
	var layer := root.get_node_or_null(LOGICAL_LAYER_PATH) as TileMapLayer
	if (
		layer == null
		or layer.tile_set == null
		or not layer.visible
		or layer.get_meta("mapsoo_semantic_only", true) != false
		or layer.get_meta("mapsoo_material_palette_id", "") != palette.get("palette_id")
	):
		return _failure("Scene lost its visible production material TileMapLayer.")
	var expected_materials := _layout_materials(plan)
	var sources := _dictionary(layer.get_meta("mapsoo_material_sources", {}))
	var roles := _dictionary(layer.get_meta("mapsoo_material_roles", {}))
	if sources.keys() != expected_materials or roles.keys() != expected_materials:
		return _failure("Scene material source inventory differs from the layout.")
	if layer.tile_set.get_source_count() != expected_materials.size():
		return _failure("Scene TileSet source count differs from the palette.")
	for material: String in expected_materials:
		var source_id := int(sources.get(material, -1))
		var source := layer.tile_set.get_source(source_id) as TileSetAtlasSource
		if (
			source == null
			or source.texture == null
			or source.get_tiles_count() != 1
			or source.get_tile_id(0) != Vector2i.ZERO
		):
			return _failure("Scene production TileSet source is incomplete.")
	if layer.get_used_cells().size() != _expected_used_cell_count(_terrain_items(plan)):
		return _failure("Scene production TileMap coverage differs from the layout.")
	var bounds: Rect2 = root.get_node(MATERIALIZATION_NODE).get_meta("mapsoo_pixel_bounds")
	for coordinate: Vector2i in [
		Vector2i.ZERO,
		Vector2i(int(plan.bounds.width) - 1, 0),
		Vector2i(0, int(plan.bounds.height) - 1),
	]:
		var expected := _logical_center_to_world(str(plan.profile), coordinate, plan.bounds, bounds)
		var actual := layer.to_global(layer.map_to_local(coordinate))
		if actual.distance_to(expected) > 0.01:
			return _failure(
				"Scene production TileMap projection differs from the layout " +
				"(%s expected=%s actual=%s)." % [coordinate, expected, actual]
			)
	return {"ok": true, "status": STATUS, "error": ""}


static func _catalog_geometry_valid(catalog: Dictionary, roles: Dictionary) -> bool:
	if not _exact_keys(catalog, ["tile_size", "roles"]):
		return false
	var tile_size: Variant = catalog.get("tile_size")
	if not (tile_size is Vector2i) or tile_size.x < 1 or tile_size.y < 1:
		return false
	for role_value: Variant in roles:
		if not _terrain_role(role_value) or not (roles[role_value] is Texture2D):
			return false
		var texture: Texture2D = roles[role_value]
		if texture.get_width() < 1 or texture.get_height() < 1:
			return false
	return true


static func _align_layer(layer: TileMapLayer, plan: Dictionary, pixel_bounds: Rect2) -> void:
	var local_origin := layer.map_to_local(Vector2i.ZERO)
	var local_x := layer.map_to_local(Vector2i(1, 0)) - local_origin
	var local_y := layer.map_to_local(Vector2i(0, 1)) - local_origin
	var world_origin := _logical_center_to_world(
		str(plan.profile), Vector2i.ZERO, plan.bounds, pixel_bounds
	)
	var world_x := _logical_center_to_world(
		str(plan.profile), Vector2i(1, 0), plan.bounds, pixel_bounds
	) - world_origin
	var world_y := _logical_center_to_world(
		str(plan.profile), Vector2i(0, 1), plan.bounds, pixel_bounds
	) - world_origin
	var local_basis := Transform2D(local_x, local_y, local_origin)
	var world_basis := Transform2D(world_x, world_y, world_origin)
	layer.transform = world_basis * local_basis.affine_inverse()


static func _logical_center_to_world(
	profile: String,
	coordinate: Vector2i,
	logical_bounds: Dictionary,
	pixel_bounds: Rect2
) -> Vector2:
	var u := (float(coordinate.x) + 0.5) / float(logical_bounds.width)
	var v := (float(coordinate.y) + 0.5) / float(logical_bounds.height)
	if profile == "isometric-action":
		return Vector2(
			pixel_bounds.position.x + pixel_bounds.size.x * 0.5
				+ (u - v) * pixel_bounds.size.x * 0.5,
			pixel_bounds.position.y + (u + v) * pixel_bounds.size.y * 0.5
		)
	return pixel_bounds.position + Vector2(
		u * pixel_bounds.size.x,
		v * pixel_bounds.size.y
	)


static func _terrain_items(plan: Dictionary) -> Array:
	var layout := _dictionary(plan.get("terrain_layout"))
	return layout.get(str(layout.get("kind", "")), []) as Array


static func _layout_materials(plan: Dictionary) -> Array:
	var material_set := {}
	for terrain_value: Variant in _terrain_items(plan):
		var terrain := _dictionary(terrain_value)
		if not _safe_id(terrain.get("material")):
			return []
		material_set[str(terrain.material)] = true
	var materials: Array = material_set.keys()
	materials.sort()
	return materials


static func _expected_used_cell_count(terrain_items: Array) -> int:
	var cells := {}
	for terrain_value: Variant in terrain_items:
		var terrain: Dictionary = terrain_value
		for y: int in range(int(terrain.y), int(terrain.y) + int(terrain.height)):
			for x: int in range(int(terrain.x), int(terrain.x) + int(terrain.width)):
				cells[Vector2i(x, y)] = true
	return cells.size()


static func _dictionary(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


static func _exact_keys(value: Dictionary, expected: Array) -> bool:
	var actual: Array = value.keys()
	actual.sort()
	var canonical := expected.duplicate()
	canonical.sort()
	return actual == canonical


static func _safe_id(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or str(value).is_empty() or str(value).length() > 80:
		return false
	var regex := RegEx.new()
	return regex.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$") == OK and regex.search(value) != null


static func _terrain_role(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or str(value).length() > 120:
		return false
	var regex := RegEx.new()
	return (
		regex.compile("^terrain\\.[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)*$") == OK
		and regex.search(value) != null
	)


static func _sha256(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING:
		return false
	var regex := RegEx.new()
	return regex.compile("^[a-f0-9]{64}$") == OK and regex.search(value) != null


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
