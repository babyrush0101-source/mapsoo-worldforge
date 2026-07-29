extends "res://tests/world_material_palette_smoke.gd"

const TerrainAutotile = preload(
	"res://addons/mapsoo_importer/mapsoo_world_terrain_autotile.gd"
)
const PALETTE_SHA256 := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TEST_ROOT)) != OK:
		_fail("Unable to create WorldTerrainAutotile smoke directory.")
		return
	var varied_masks := 0
	for profile: String in PROFILES:
		var fixture := _write_fixture(profile, "terrain-autotile")
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var attachment := LayoutAttachment.validate_optional(
			fixture.manifest,
			fixture.root,
			fixture.manifest_sha256
		)
		if not attachment.ok:
			_fail("%s autotile layout fixture validation failed." % profile)
			return
		var materialized := _materialize_world(profile, attachment.layout)
		if not materialized.ok:
			_fail("%s autotile layout materialization failed." % profile)
			return
		var palette := _palette(profile, attachment.layout)
		var palette_applied := MaterialPalette.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			_catalog(profile, palette)
		)
		if not palette_applied.ok:
			materialized.root.free()
			_fail("%s fallback material palette failed." % profile)
			return
		var autotile_fixture := _autotile_fixture(profile, attachment.layout, palette)
		var applied := TerrainAutotile.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			PALETTE_SHA256,
			autotile_fixture.document,
			autotile_fixture.textures
		)
		if not applied.ok or applied.status != "terrain-autotiles-v1":
			materialized.root.free()
			_fail("%s terrain autotile application failed: %s" % [profile, applied])
			return
		var checked := TerrainAutotile.validate_scene(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			PALETTE_SHA256,
			autotile_fixture.document
		)
		if not checked.ok:
			materialized.root.free()
			_fail("%s terrain autotile postcondition failed: %s" % [profile, checked])
			return
		var first_snapshot := _autotile_snapshot(materialized.root)
		var unique_masks: Dictionary = first_snapshot.unique_masks
		if unique_masks.size() < 2:
			materialized.root.free()
			_fail("%s terrain autotiles did not select multiple neighbor variants." % profile)
			return
		varied_masks += unique_masks.size()
		var persisted := _persist_and_reload(
			materialized.root,
			fixture.root,
			"%s-autotile" % profile
		)
		materialized.root.free()
		if not persisted.ok:
			_fail("%s terrain autotile persistence failed: %s" % [profile, persisted.error])
			return
		var persisted_check := TerrainAutotile.validate_scene(
			persisted.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			PALETTE_SHA256,
			autotile_fixture.document
		)
		var persisted_snapshot := _autotile_snapshot(persisted.root)
		if not persisted_check.ok or persisted_snapshot != first_snapshot:
			persisted.root.free()
			_fail("%s persisted terrain autotiles changed semantics." % profile)
			return
		persisted.root.free()
	if not _assert_autotile_tamper_fails_closed():
		return
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print(
		"MAPSOO_WORLD_TERRAIN_AUTOTILE_OK " +
		"profiles=4 variants=%d persisted=4 tamper=4 fallback=4" % varied_masks
	)
	quit(0)


func _autotile_fixture(
	profile: String,
	attachment: Dictionary,
	palette: Dictionary
) -> Dictionary:
	var cell := Vector2i(64, 32) if profile in [
		"isometric-action",
		"layered-depth-2d",
	] else Vector2i(32, 32)
	var entries: Array = []
	var textures := {}
	for entry_value: Variant in palette.entries:
		var entry: Dictionary = entry_value
		var material := str(entry.material)
		var tiles: Array = []
		for mask: int in range(16):
			tiles.append({
				"mask": mask,
				"column": mask % 4,
				"row": mask / 4,
			})
		var image := Image.create(cell.x * 4, cell.y * 4, false, Image.FORMAT_RGBA8)
		for mask: int in range(16):
			var color := Color(
				float((mask * 31 + entries.size() * 17) % 255) / 255.0,
				float((mask * 53 + 41) % 255) / 255.0,
				float((mask * 79 + 83) % 255) / 255.0,
				1.0
			)
			image.fill_rect(
				Rect2i(
					Vector2i((mask % 4) * cell.x, (mask / 4) * cell.y),
					cell
				),
				color
			)
		textures[material] = ImageTexture.create_from_image(image)
		entries.append({
			"material": material,
			"role": entry.role,
			"image": {
				"path": "terrain-autotiles/%s/%s.png" % [profile, material],
				"sha256": ("%x" % (entries.size() + 1)).pad_zeros(64),
				"width": cell.x * 4,
				"height": cell.y * 4,
			},
			"tiles": tiles,
		})
	return {
		"document": {
			"schema_version": "1.0.0",
			"document_type": "world-terrain-autotile-set",
			"set_id": "autotiles-%s" % attachment.plan.plan_id,
			"profile": profile,
			"layout": {
				"plan_id": attachment.plan.plan_id,
				"sha256": attachment.sha256,
			},
			"palette": {
				"palette_id": palette.palette_id,
				"sha256": PALETTE_SHA256,
			},
			"selection": {
				"kind": "edge-mask-16",
				"bit_order": ["north", "east", "south", "west"],
				"outside": "different-material",
			},
			"cell": {"width": cell.x, "height": cell.y},
			"entries": entries,
		},
		"textures": textures,
	}


func _assert_autotile_tamper_fails_closed() -> bool:
	var fixture := _write_fixture("topdown-farm", "terrain-autotile-tamper")
	if not fixture.ok:
		_fail(str(fixture.error))
		return false
	var attachment := LayoutAttachment.validate_optional(
		fixture.manifest,
		fixture.root,
		fixture.manifest_sha256
	)
	var palette := _palette("topdown-farm", attachment.layout)
	var canonical := _autotile_fixture("topdown-farm", attachment.layout, palette)
	var mutations := []
	var missing: Dictionary = canonical.document.duplicate(true)
	missing.entries.pop_back()
	mutations.append(missing)
	var wrong_palette: Dictionary = canonical.document.duplicate(true)
	wrong_palette.palette.sha256 = "f".repeat(64)
	mutations.append(wrong_palette)
	var duplicate_cell: Dictionary = canonical.document.duplicate(true)
	duplicate_cell.entries[0].tiles[1].column = duplicate_cell.entries[0].tiles[0].column
	duplicate_cell.entries[0].tiles[1].row = duplicate_cell.entries[0].tiles[0].row
	mutations.append(duplicate_cell)
	var wrong_dimensions: Dictionary = canonical.document.duplicate(true)
	wrong_dimensions.entries[0].image.width += 1
	mutations.append(wrong_dimensions)
	for index: int in mutations.size():
		var materialized := _materialize_world("topdown-farm", attachment.layout)
		if not materialized.ok:
			_fail("Autotile tamper world could not be materialized.")
			return false
		var palette_applied := MaterialPalette.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			_catalog("topdown-farm", palette)
		)
		if not palette_applied.ok:
			materialized.root.free()
			_fail("Autotile tamper palette could not be applied.")
			return false
		var before := _palette_snapshot(materialized.root)
		var result := TerrainAutotile.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			PALETTE_SHA256,
			mutations[index],
			canonical.textures
		)
		if result.ok or before != _palette_snapshot(materialized.root):
			materialized.root.free()
			_fail("Terrain autotile tamper %d did not fail before scene mutation." % index)
			return false
		materialized.root.free()
	return true


func _autotile_snapshot(root: Node) -> Dictionary:
	var layer := root.get_node_or_null(
		"MapsooLayoutMaterialization/Terrain/LogicalCells"
	) as TileMapLayer
	if layer == null:
		return {"missing": true}
	var cells: Array[String] = []
	var unique_masks := {}
	for coordinate: Vector2i in layer.get_used_cells():
		var atlas := layer.get_cell_atlas_coords(coordinate)
		var mask := atlas.y * 4 + atlas.x
		unique_masks[mask] = true
		cells.append(
			"%s=%d:%d,%d" % [
				coordinate,
				layer.get_cell_source_id(coordinate),
				atlas.x,
				atlas.y,
			]
		)
	cells.sort()
	return {
		"status": root.get_meta("mapsoo_terrain_autotile_status", ""),
		"set_id": root.get_meta("mapsoo_terrain_autotile_set_id", ""),
		"source_count": layer.tile_set.get_source_count() if layer.tile_set != null else -1,
		"cells": cells,
		"unique_masks": unique_masks,
	}
