extends "res://tests/world_layout_materializer_smoke.gd"

const MaterialPalette = preload(
	"res://addons/mapsoo_importer/mapsoo_world_material_palette.gd"
)
const ROLE_CATALOG := {
	"side-platformer": [
		"terrain.solid",
		"terrain.one-way",
		"terrain.wall",
		"terrain.water",
	],
	"topdown-farm": [
		"terrain.ground",
		"terrain.soil",
		"terrain.path",
		"terrain.water",
	],
	"isometric-action": [
		"terrain.floor.base",
		"terrain.floor.variant",
		"terrain.floor.edge",
		"terrain.wall",
		"terrain.water",
	],
	"layered-depth-2d": [
		"terrain.ground",
		"terrain.path",
		"terrain.edge",
		"terrain.water",
	],
}


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TEST_ROOT)) != OK:
		_fail("Unable to create WorldMaterialPalette smoke directory.")
		return
	for profile: String in PROFILES:
		var fixture := _write_fixture(profile, "material-palette")
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
		var catalog := _catalog(profile, palette)
		var applied := MaterialPalette.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette,
			catalog
		)
		if not applied.ok or applied.status != "production-tiles-v1":
			materialized.root.free()
			_fail("%s production palette application failed: %s" % [profile, applied])
			return
		var checked := MaterialPalette.validate_scene(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette
		)
		if not checked.ok:
			materialized.root.free()
			_fail("%s production palette postcondition failed: %s" % [profile, checked])
			return
		var first_snapshot := _palette_snapshot(materialized.root)
		var persisted := _persist_and_reload(
			materialized.root,
			fixture.root,
			"%s-palette" % profile
		)
		materialized.root.free()
		if not persisted.ok:
			_fail("%s palette persistence failed: %s" % [profile, persisted.error])
			return
		var persisted_check := MaterialPalette.validate_scene(
			persisted.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			palette
		)
		var persisted_snapshot := _palette_snapshot(persisted.root)
		if not persisted_check.ok or persisted_snapshot != first_snapshot:
			persisted.root.free()
			_fail(
				"%s persisted production palette changed semantics: %s" % [
					profile,
					(
						str(persisted_check)
						if not persisted_check.ok
						else _first_difference(first_snapshot, persisted_snapshot)
					),
				]
			)
			return
		persisted.root.free()
	if not _assert_palette_tamper_fails_closed():
		return
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print(
		"MAPSOO_WORLD_MATERIAL_PALETTE_OK " +
		"profiles=4 visible=4 projected=4 persisted=4 tamper=4"
	)
	quit(0)


func _palette(profile: String, attachment: Dictionary) -> Dictionary:
	var entries: Array = []
	var materials := {}
	var layout: Dictionary = attachment.plan.terrain_layout
	for terrain: Dictionary in layout[str(layout.kind)]:
		materials[str(terrain.material)] = true
	var ordered_materials: Array = materials.keys()
	ordered_materials.sort()
	var roles: Array = ROLE_CATALOG[profile]
	for index: int in ordered_materials.size():
		var material: String = ordered_materials[index]
		entries.append({
			"material": material,
			"role": roles[index % roles.size()],
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
	for entry: Dictionary in palette.entries:
		if roles.has(entry.role):
			continue
		var image := Image.create(16, 16, false, Image.FORMAT_RGBA8)
		var color_seed := roles.size() + 1
		image.fill(Color(
			float((color_seed * 53) % 255) / 255.0,
			float((color_seed * 97) % 255) / 255.0,
			float((color_seed * 149) % 255) / 255.0,
			1.0
		))
		roles[entry.role] = ImageTexture.create_from_image(image)
	return {
		"tile_size": (
			Vector2i(32, 16)
			if profile == "isometric-action"
			else Vector2i(32, 32)
		),
		"roles": roles,
	}


func _assert_palette_tamper_fails_closed() -> bool:
	var fixture := _write_fixture("topdown-farm", "material-palette-tamper")
	if not fixture.ok:
		_fail(str(fixture.error))
		return false
	var attachment := LayoutAttachment.validate_optional(
		fixture.manifest,
		fixture.root,
		fixture.manifest_sha256
	)
	if not attachment.ok:
		_fail("Palette tamper fixture validation failed.")
		return false
	var canonical := _palette("topdown-farm", attachment.layout)
	var mutations := []
	var missing: Dictionary = canonical.duplicate(true)
	missing.entries.pop_back()
	mutations.append(missing)
	var wrong_layout: Dictionary = canonical.duplicate(true)
	wrong_layout.layout.sha256 = "f".repeat(64)
	mutations.append(wrong_layout)
	var unknown_role: Dictionary = canonical.duplicate(true)
	unknown_role.entries[0].role = "terrain.missing"
	mutations.append(unknown_role)
	var unsorted: Dictionary = canonical.duplicate(true)
	unsorted.entries.reverse()
	mutations.append(unsorted)
	for index: int in mutations.size():
		var materialized := _materialize_world("topdown-farm", attachment.layout)
		if not materialized.ok:
			_fail("Palette tamper world could not be materialized.")
			return false
		var before := _palette_snapshot(materialized.root)
		var result := MaterialPalette.apply(
			materialized.root,
			attachment.layout.plan,
			attachment.layout.sha256,
			mutations[index],
			_catalog("topdown-farm", canonical)
		)
		if result.ok or before != _palette_snapshot(materialized.root):
			materialized.root.free()
			_fail("Palette tamper %d did not fail before scene mutation." % index)
			return false
		materialized.root.free()
	return true


func _palette_snapshot(root: Node) -> String:
	var layer := root.get_node_or_null(
		"MapsooLayoutMaterialization/Terrain/LogicalCells"
	) as TileMapLayer
	if layer == null:
		return "missing"
	var sources := {}
	if layer.tile_set != null:
		for source_index: int in layer.tile_set.get_source_count():
			var source_id := layer.tile_set.get_source_id(source_index)
			var source := layer.tile_set.get_source(source_id) as TileSetAtlasSource
			sources[str(source_id)] = {
				"size": (
					[source.texture.get_width(), source.texture.get_height()]
					if source != null and source.texture != null
					else []
				),
				"tiles": source.get_tiles_count() if source != null else -1,
			}
	var cells: Array[String] = []
	for cell: Vector2i in layer.get_used_cells():
		cells.append("%s=%d" % [cell, layer.get_cell_source_id(cell)])
	cells.sort()
	return JSON.stringify({
		"visible": layer.visible,
		"transform": [
			_vector_snapshot(layer.transform.x),
			_vector_snapshot(layer.transform.y),
			_vector_snapshot(layer.transform.origin),
		],
		"sources": sources,
		"cells": cells,
		"material_sources": _snapshot_meta(
			layer.get_meta("mapsoo_material_sources", {})
		),
		"material_roles": _snapshot_meta(
			layer.get_meta("mapsoo_material_roles", {})
		),
	})
