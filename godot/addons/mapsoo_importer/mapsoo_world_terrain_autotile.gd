@tool
extends RefCounted

## Optional provider-neutral 16-variant terrain renderer.
##
## The layout and material palette remain authoritative. This module only
## replaces each palette material's single-cell fallback with a validated 4x4
## atlas and selects a tile from same-material N/E/S/W neighbors.

const SCHEMA_VERSION := "1.0.0"
const DOCUMENT_TYPE := "world-terrain-autotile-set"
const MASK_KIND := "edge-mask-16"
const BIT_ORDER := ["north", "east", "south", "west"]
const OUTSIDE := "different-material"
const LOGICAL_LAYER_PATH := "MapsooLayoutMaterialization/Terrain/LogicalCells"
const PALETTE_STATUS := "production-tiles-v1"
const STATUS := "terrain-autotiles-v1"
const SUPPORTED_PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]
const NEIGHBORS := [
	Vector2i(0, -1),
	Vector2i(1, 0),
	Vector2i(0, 1),
	Vector2i(-1, 0),
]


static func validate(
	autotiles: Dictionary,
	plan: Dictionary,
	layout_plan_sha256: String,
	palette: Dictionary,
	material_palette_sha256: String,
	textures: Dictionary
) -> Dictionary:
	if (
		typeof(autotiles) != TYPE_DICTIONARY
		or typeof(plan) != TYPE_DICTIONARY
		or typeof(palette) != TYPE_DICTIONARY
		or typeof(textures) != TYPE_DICTIONARY
		or not _sha256(layout_plan_sha256)
		or not _sha256(material_palette_sha256)
	):
		return _failure("World terrain autotile validation input is invalid.")
	if not _exact_keys(autotiles, [
		"schema_version",
		"document_type",
		"set_id",
		"profile",
		"layout",
		"palette",
		"selection",
		"cell",
		"entries",
	]):
		return _failure("World terrain autotile set has unsupported or missing fields.")
	if (
		autotiles.get("schema_version") != SCHEMA_VERSION
		or autotiles.get("document_type") != DOCUMENT_TYPE
		or not _safe_id(autotiles.get("set_id"))
		or autotiles.get("profile") not in SUPPORTED_PROFILES
		or autotiles.get("profile") != plan.get("profile")
	):
		return _failure("World terrain autotile identity or profile is invalid.")
	var layout := _dictionary(autotiles.get("layout"))
	if (
		not _exact_keys(layout, ["plan_id", "sha256"])
		or not _safe_id(layout.get("plan_id"))
		or layout.get("plan_id") != plan.get("plan_id")
		or layout.get("sha256") != layout_plan_sha256
	):
		return _failure("World terrain autotiles do not bind the exact layout.")
	var palette_binding := _dictionary(autotiles.get("palette"))
	if (
		not _exact_keys(palette_binding, ["palette_id", "sha256"])
		or not _safe_id(palette_binding.get("palette_id"))
		or palette_binding.get("palette_id") != palette.get("palette_id")
		or palette_binding.get("sha256") != material_palette_sha256
	):
		return _failure("World terrain autotiles do not bind the exact palette.")
	var selection := _dictionary(autotiles.get("selection"))
	if (
		not _exact_keys(selection, ["kind", "bit_order", "outside"])
		or selection.get("kind") != MASK_KIND
		or selection.get("bit_order") != BIT_ORDER
		or selection.get("outside") != OUTSIDE
	):
		return _failure("World terrain autotile selection convention is unsupported.")
	var cell := _dictionary(autotiles.get("cell"))
	if (
		not _exact_keys(cell, ["width", "height"])
		or not _integer(cell.get("width"), 1, 1024)
		or not _integer(cell.get("height"), 1, 1024)
	):
		return _failure("World terrain autotile cell dimensions are invalid.")
	var palette_map := {}
	for entry_value: Variant in palette.get("entries", []):
		var entry := _dictionary(entry_value)
		if not _safe_id(entry.get("material")) or not _terrain_role(entry.get("role")):
			return _failure("World terrain autotile palette is invalid.")
		palette_map[str(entry.material)] = str(entry.role)
	var entries_value: Variant = autotiles.get("entries")
	if (
		typeof(entries_value) != TYPE_ARRAY
		or entries_value.is_empty()
		or entries_value.size() > 64
		or entries_value.size() != palette_map.size()
	):
		return _failure("World terrain autotiles must cover every palette material.")
	var entries: Array = entries_value
	var checked_entries := {}
	var used_paths := {}
	var previous := ""
	for index: int in entries.size():
		var entry := _dictionary(entries[index])
		if not _exact_keys(entry, ["material", "role", "image", "tiles"]):
			return _failure("World terrain autotile entry %d has invalid fields." % index)
		var material := str(entry.get("material", ""))
		var role := str(entry.get("role", ""))
		if (
			not _safe_id(material)
			or not _terrain_role(role)
			or not palette_map.has(material)
			or palette_map[material] != role
			or checked_entries.has(material)
			or (not previous.is_empty() and previous >= material)
		):
			return _failure("World terrain autotile materials or roles are invalid.")
		var image := _dictionary(entry.get("image"))
		if (
			not _exact_keys(image, ["path", "sha256", "width", "height"])
			or not _safe_path(image.get("path"))
			or not _sha256(image.get("sha256"))
			or image.get("width") != int(cell.width) * 4
			or image.get("height") != int(cell.height) * 4
			or used_paths.has(str(image.get("path", "")))
		):
			return _failure("World terrain autotile image metadata is invalid.")
		var texture: Texture2D = textures.get(material)
		if (
			texture == null
			or texture.get_width() != int(image.width)
			or texture.get_height() != int(image.height)
		):
			return _failure("World terrain autotile texture dimensions differ from the contract.")
		var tile_map := _tile_map(entry.get("tiles"))
		if tile_map.is_empty():
			return _failure("World terrain autotile entry does not map all 16 masks.")
		checked_entries[material] = {
			"role": role,
			"texture": texture,
			"tiles": tile_map,
		}
		used_paths[str(image.path)] = true
		previous = material
	var checked_materials: Array = checked_entries.keys()
	var palette_materials: Array = palette_map.keys()
	checked_materials.sort()
	palette_materials.sort()
	if checked_materials != palette_materials:
		return _failure("World terrain autotile material coverage differs from the palette.")
	return {
		"ok": true,
		"status": "validated",
		"entries": checked_entries,
		"cell": Vector2i(int(cell.width), int(cell.height)),
		"error": "",
	}


static func apply(
	root: Node,
	plan: Dictionary,
	layout_plan_sha256: String,
	palette: Dictionary,
	material_palette_sha256: String,
	autotiles: Dictionary,
	textures: Dictionary
) -> Dictionary:
	if root == null:
		return _failure("World terrain autotile application root is missing.")
	var checked := validate(
		autotiles,
		plan,
		layout_plan_sha256,
		palette,
		material_palette_sha256,
		textures
	)
	if not checked.ok:
		return checked
	var layer := root.get_node_or_null(LOGICAL_LAYER_PATH) as TileMapLayer
	if (
		layer == null
		or layer.tile_set == null
		or root.get_meta("mapsoo_material_palette_status", "") != PALETTE_STATUS
		or root.get_meta("mapsoo_material_palette_id", "") != palette.get("palette_id")
		or root.has_meta("mapsoo_terrain_autotile_status")
	):
		return _failure("World terrain autotiles require one exact, unapplied material palette scene.")
	var material_grid := _material_grid(plan)
	if material_grid.is_empty():
		return _failure("World terrain autotiles require a non-empty logical material grid.")

	var tile_set := TileSet.new()
	tile_set.tile_size = checked.cell
	if str(plan.profile) == "isometric-action":
		tile_set.tile_shape = TileSet.TILE_SHAPE_ISOMETRIC
		tile_set.tile_layout = TileSet.TILE_LAYOUT_DIAMOND_RIGHT
	var material_sources := {}
	var ordered_materials: Array = checked.entries.keys()
	ordered_materials.sort()
	for material_value: Variant in ordered_materials:
		var material := str(material_value)
		var entry: Dictionary = checked.entries[material]
		var source := TileSetAtlasSource.new()
		source.texture = entry.texture
		source.texture_region_size = checked.cell
		for mask: int in range(16):
			var coordinate: Vector2i = entry.tiles[mask]
			source.create_tile(coordinate)
		var source_id := material_sources.size()
		if tile_set.add_source(source, source_id) != source_id:
			return _failure("World terrain autotiles could not add a deterministic TileSet source.")
		material_sources[material] = source_id

	layer.clear()
	layer.tile_set = tile_set
	for coordinate_value: Variant in material_grid:
		var coordinate: Vector2i = coordinate_value
		var material: String = material_grid[coordinate]
		var mask := _neighbor_mask(coordinate, material, material_grid)
		var atlas_coordinate: Vector2i = checked.entries[material].tiles[mask]
		layer.set_cell(coordinate, int(material_sources[material]), atlas_coordinate, 0)
	layer.visible = true
	layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	layer.set_meta("mapsoo_terrain_autotile_set_id", str(autotiles.set_id))
	layer.set_meta("mapsoo_terrain_autotile_material_sources", material_sources.duplicate(true))
	root.set_meta("mapsoo_terrain_autotile_status", STATUS)
	root.set_meta("mapsoo_terrain_autotile_set_id", str(autotiles.set_id))
	root.set_meta("mapsoo_terrain_autotile_layout_sha256", layout_plan_sha256)
	root.set_meta("mapsoo_terrain_autotile_palette_sha256", material_palette_sha256)
	return {"ok": true, "status": STATUS, "error": ""}


static func validate_scene(
	root: Node,
	plan: Dictionary,
	layout_plan_sha256: String,
	palette: Dictionary,
	material_palette_sha256: String,
	autotiles: Dictionary
) -> Dictionary:
	if (
		root == null
		or root.get_meta("mapsoo_terrain_autotile_status", "") != STATUS
		or root.get_meta("mapsoo_terrain_autotile_set_id", "") != autotiles.get("set_id")
		or root.get_meta("mapsoo_terrain_autotile_layout_sha256", "") != layout_plan_sha256
		or root.get_meta("mapsoo_terrain_autotile_palette_sha256", "") != material_palette_sha256
		or root.get_meta("mapsoo_material_palette_id", "") != palette.get("palette_id")
	):
		return _failure("Scene does not declare the bound terrain autotile set.")
	var layer := root.get_node_or_null(LOGICAL_LAYER_PATH) as TileMapLayer
	if (
		layer == null
		or layer.tile_set == null
		or not layer.visible
		or layer.get_meta("mapsoo_terrain_autotile_set_id", "") != autotiles.get("set_id")
	):
		return _failure("Scene lost its visible terrain autotile TileMapLayer.")
	var material_grid := _material_grid(plan)
	var sources := _dictionary(layer.get_meta("mapsoo_terrain_autotile_material_sources", {}))
	var entries_by_material := {}
	for entry_value: Variant in autotiles.get("entries", []):
		var entry := _dictionary(entry_value)
		var tiles := _tile_map(entry.get("tiles"))
		if tiles.is_empty():
			return _failure("Persisted terrain autotile mapping is invalid.")
		entries_by_material[str(entry.get("material", ""))] = tiles
	if (
		sources.size() != entries_by_material.size()
		or layer.tile_set.get_source_count() != entries_by_material.size()
		or layer.get_used_cells().size() != material_grid.size()
	):
		return _failure("Scene terrain autotile source or cell inventory differs from the contract.")
	for material_value: Variant in entries_by_material:
		var material := str(material_value)
		var source := layer.tile_set.get_source(int(sources.get(material, -1))) as TileSetAtlasSource
		if source == null or source.texture == null or source.get_tiles_count() != 16:
			return _failure("Scene terrain autotile source is incomplete.")
	for coordinate_value: Variant in material_grid:
		var coordinate: Vector2i = coordinate_value
		var material: String = material_grid[coordinate]
		var expected_mask := _neighbor_mask(coordinate, material, material_grid)
		if (
			layer.get_cell_source_id(coordinate) != int(sources[material])
			or layer.get_cell_atlas_coords(coordinate) != entries_by_material[material][expected_mask]
		):
			return _failure("Scene terrain autotile neighbor selection differs from the layout.")
	return {"ok": true, "status": STATUS, "error": ""}


static func _material_grid(plan: Dictionary) -> Dictionary:
	var grid := {}
	for terrain_value: Variant in _terrain_items(plan):
		var terrain := _dictionary(terrain_value)
		if (
			not _safe_id(terrain.get("material"))
			or not _integer(terrain.get("x"), 0, 65535)
			or not _integer(terrain.get("y"), 0, 65535)
			or not _integer(terrain.get("width"), 1, 65535)
			or not _integer(terrain.get("height"), 1, 65535)
		):
			return {}
		for y: int in range(int(terrain.y), int(terrain.y) + int(terrain.height)):
			for x: int in range(int(terrain.x), int(terrain.x) + int(terrain.width)):
				grid[Vector2i(x, y)] = str(terrain.material)
	return grid


static func _neighbor_mask(coordinate: Vector2i, material: String, grid: Dictionary) -> int:
	var mask := 0
	for bit: int in range(NEIGHBORS.size()):
		if grid.get(coordinate + NEIGHBORS[bit], "") == material:
			mask |= 1 << bit
	return mask


static func _tile_map(value: Variant) -> Dictionary:
	if typeof(value) != TYPE_ARRAY or value.size() != 16:
		return {}
	var result := {}
	var used_cells := {}
	for index: int in value.size():
		var tile := _dictionary(value[index])
		if (
			not _exact_keys(tile, ["mask", "column", "row"])
			or not _integer(tile.get("mask"), 0, 15)
			or int(tile.mask) != index
			or not _integer(tile.get("column"), 0, 3)
			or not _integer(tile.get("row"), 0, 3)
		):
			return {}
		var coordinate := Vector2i(int(tile.column), int(tile.row))
		if used_cells.has(coordinate):
			return {}
		result[index] = coordinate
		used_cells[coordinate] = true
	return result if result.size() == 16 and used_cells.size() == 16 else {}


static func _terrain_items(plan: Dictionary) -> Array:
	var layout := _dictionary(plan.get("terrain_layout"))
	return layout.get(str(layout.get("kind", "")), []) as Array


static func _dictionary(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


static func _exact_keys(value: Dictionary, expected: Array) -> bool:
	var actual: Array = value.keys()
	actual.sort()
	var canonical := expected.duplicate()
	canonical.sort()
	return actual == canonical


static func _integer(value: Variant, minimum: int, maximum: int) -> bool:
	return (
		typeof(value) in [TYPE_INT, TYPE_FLOAT]
		and is_finite(float(value))
		and float(value) == float(int(value))
		and int(value) >= minimum
		and int(value) <= maximum
	)


static func _safe_id(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or str(value).is_empty() or str(value).length() > 80:
		return false
	var regex := RegEx.new()
	return regex.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$") == OK and regex.search(value) != null


static func _safe_path(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or str(value).is_empty() or str(value).length() > 240:
		return false
	var regex := RegEx.new()
	return (
		not str(value).contains("\\")
		and not str(value).begins_with("/")
		and not str(value).contains("../")
		and regex.compile(
			"^[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)*$"
		) == OK
		and regex.search(value) != null
	)


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
