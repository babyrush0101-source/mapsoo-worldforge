@tool
extends RefCounted

const Pack07 = preload("res://addons/mapsoo_importer/mapsoo_pack_07.gd")
const Pack08 = preload("res://addons/mapsoo_importer/mapsoo_pack_08.gd")
const Pack09 = preload("res://addons/mapsoo_importer/mapsoo_pack_09.gd")
const Pack10 = preload("res://addons/mapsoo_importer/mapsoo_pack_10.gd")
const WorldLayoutAttachment = preload(
	"res://addons/mapsoo_importer/mapsoo_world_layout_attachment.gd"
)
const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd")

const LEGACY_SCHEMA_VERSION := "0.1.0"
const PLAYABLE_TERRAIN_SCHEMA_VERSION := "0.2.0"
const SEMANTIC_PLACES_SCHEMA_VERSION := "0.3.0"
const EXTERIOR_STRUCTURES_SCHEMA_VERSION := "0.4.0"
const MULTI_WORLD_PACK_SCHEMA_VERSION := "0.5.0"
const COMPLETE_FARM_SCHEMA_VERSION := "0.6.0"
const SIDE_PLATFORMER_SCHEMA_VERSION := "0.7.0"
const ISOMETRIC_ACTION_SCHEMA_VERSION := "0.8.0"
const LAYERED_DEPTH_SCHEMA_VERSION := "0.9.0"
const CONTROLLED_SCHEMA_VERSION := "1.0.0-draft.1"
const SUPPORTED_SCHEMA_VERSIONS := [LEGACY_SCHEMA_VERSION, PLAYABLE_TERRAIN_SCHEMA_VERSION, SEMANTIC_PLACES_SCHEMA_VERSION, EXTERIOR_STRUCTURES_SCHEMA_VERSION, MULTI_WORLD_PACK_SCHEMA_VERSION, COMPLETE_FARM_SCHEMA_VERSION, SIDE_PLATFORMER_SCHEMA_VERSION, ISOMETRIC_ACTION_SCHEMA_VERSION, LAYERED_DEPTH_SCHEMA_VERSION, CONTROLLED_SCHEMA_VERSION]
const OUTPUT_ROOT := "res://mapsoo_imports"
const IMPORTER_VERSION := "0.1.0-alpha.9"
const ALPHA9_LAYERS := ["ground", "water", "paths", "soil", "props", "structures", "crops"]
const ALPHA9_ATLASES := ["terrain", "props", "structures", "crops", "character"]
const ALPHA9_ROLES := ["terrain.ground", "terrain.water", "terrain.path", "terrain.soil", "prop.tree", "prop.rock", "prop.flower", "prop.fence", "prop.gate", "prop.crate", "structure.house", "structure.barn", "crop.basic.stage-1", "crop.basic.stage-2", "crop.basic.stage-3", "crop.basic.stage-4", "character.player.atlas", "world.collision", "world.navigation", "world.scene", "world.preview"]
const ALPHA9_CLIPS := ["idle.north", "idle.east", "idle.south", "idle.west", "walk.north", "walk.east", "walk.south", "walk.west"]
const IMPORT_STATE_SCHEMA_VERSION := "1.0.0"
const IMPORT_STATE_FILENAME := "mapsoo.import-state.json"
const BUFFER_SIZE := 1024 * 1024
const MAX_JSON_BYTES := 2 * 1024 * 1024
const MAX_FILE_COUNT := 512
const MAX_FILE_BYTES := 64 * 1024 * 1024
const MAX_TOTAL_BYTES := 256 * 1024 * 1024
const MAX_IMAGE_DIMENSION := 8192
const MAX_IMAGE_PIXELS := 16 * 1024 * 1024
const MAX_TOTAL_IMAGE_PIXELS := 32 * 1024 * 1024
const MAX_ATLAS_COUNT := 8
const MAX_TILE_COUNT := 4096
const MAX_SPRITE_COUNT := 4096
const MAX_PROP_COUNT := 10000
const MAX_PLACE_COUNT := 8
const MAX_STRUCTURE_COUNT := 8
const PLACE_KINDS := ["spawn", "settlement", "landmark", "resource", "encounter", "exit"]
const PLACE_PLACEMENTS := ["center", "near-water", "on-road", "map-edge"]
const STRUCTURE_ARCHETYPES := ["cottage", "workshop", "tower", "shrine"]


static func import_pack(
	manifest_path: String,
	output_root: String = OUTPUT_ROOT,
	authorization: Dictionary = {},
) -> Dictionary:
	var errors: Array[String] = []
	var warnings: Array[String] = []

	if not _is_supported_runtime():
		errors.append("Mapsoo Importer requires Godot 4.3 or newer.")
		return _result(false, errors, warnings)

	if _normalise_resource_dir(output_root) != OUTPUT_ROOT:
		errors.append("The output root is fixed to %s for safety." % OUTPUT_ROOT)
		return _result(false, errors, warnings)

	var local_manifest_path := _normalise_input_path(manifest_path)
	if local_manifest_path.is_empty() or not FileAccess.file_exists(local_manifest_path):
		errors.append("Manifest does not exist: %s" % manifest_path)
		return _result(false, errors, warnings)
	if local_manifest_path.get_file() != "mapsoo.manifest.json":
		errors.append("Select an extracted pack's mapsoo.manifest.json file.")
		return _result(false, errors, warnings)

	var manifest_read := _read_json_file(local_manifest_path)
	if not manifest_read.ok:
		errors.append(manifest_read.error)
		return _result(false, errors, warnings)
	var manifest: Dictionary = manifest_read.value
	var pack_root := local_manifest_path.get_base_dir()

	var validation := _validate_and_prepare(manifest, pack_root, authorization)
	errors.assign(validation.errors)
	warnings.assign(validation.warnings)
	if not errors.is_empty():
		return _result(false, errors, warnings)
	var manifest_sha256: String = manifest_read.sha256
	if manifest_sha256.is_empty():
		errors.append("Unable to hash the validated manifest: %s" % local_manifest_path)
		return _result(false, errors, warnings)
	var layout_validation := WorldLayoutAttachment.validate_optional(
		manifest,
		pack_root,
		manifest_sha256
	)
	if not layout_validation.ok:
		errors.append(layout_validation.error)
		return _result(false, errors, warnings)
	validation.world_layout = layout_validation.layout

	var pack_id: String = validation.pack_id
	var output_dir := "%s/%s" % [OUTPUT_ROOT, pack_id]
	var tileset_path := "%s/%s.tileset.tres" % [output_dir, pack_id]
	var scene_path := "%s/%s.world.tscn" % [output_dir, pack_id]
	var state_path := "%s/%s" % [output_dir, IMPORT_STATE_FILENAME]
	var source_snapshot := _capture_source_snapshot(local_manifest_path, pack_root, manifest, manifest_sha256)
	if not source_snapshot.ok:
		errors.append(source_snapshot.error)
		return _result(false, errors, warnings)

	var existing := _inspect_existing_import(
		output_dir,
		pack_id,
		tileset_path,
		scene_path,
		state_path,
		manifest_sha256,
		validation.schema_version,
		not validation.world_layout.is_empty()
	)
	warnings.append_array(existing.warnings)
	if existing.status == "conflict":
		errors.append_array(existing.errors)
		var conflict_result := _result(false, errors, warnings)
		conflict_result.merge({
			"status": "conflict",
			"pack_id": pack_id,
			"output_dir": output_dir,
			"tileset_path": tileset_path,
			"scene_path": scene_path,
			"state_path": state_path,
			"manifest_sha256": manifest_sha256,
		}, true)
		return conflict_result
	if existing.status == "unchanged":
		return _successful_result(
			"unchanged",
			pack_id,
			output_dir,
			tileset_path,
			scene_path,
			state_path,
			manifest_sha256,
			existing.cell_count,
			existing.prop_count,
			errors,
			warnings
		)

	var operation_status: String = existing.status
	var staging_dir := _unique_transaction_dir("staging", pack_id)
	var staging_absolute := ProjectSettings.globalize_path(staging_dir)
	var mkdir_error := DirAccess.make_dir_recursive_absolute(staging_absolute)
	if mkdir_error != OK:
		errors.append("Unable to create staging directory for %s (error %d)." % [output_dir, mkdir_error])
		return _result(false, errors, warnings)
	var staged_tileset_path := "%s/%s.tileset.tres" % [staging_dir, pack_id]
	var staged_scene_path := "%s/%s.world.tscn" % [staging_dir, pack_id]
	var staged_state_path := "%s/%s" % [staging_dir, IMPORT_STATE_FILENAME]

	var tile_set: TileSet = validation.tile_set
	var save_error := ResourceSaver.save(tile_set, staged_tileset_path)
	if save_error != OK:
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append("Unable to stage TileSet for %s (error %d)." % [tileset_path, save_error])
		return _result(false, errors, warnings)

	var scene_build := _build_scene(validation, tile_set)
	if not scene_build.ok:
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append(scene_build.error)
		return _result(false, errors, warnings)
	var layout_scene_binding := WorldLayoutAttachment.bind_scene(
		scene_build.root,
		validation.world_layout
	)
	if not layout_scene_binding.ok:
		scene_build.root.free()
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append(layout_scene_binding.error)
		return _result(false, errors, warnings)
	var packed_scene := PackedScene.new()
	var pack_error := packed_scene.pack(scene_build.root)
	if pack_error != OK:
		scene_build.root.free()
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append("Unable to pack the generated scene (error %d)." % pack_error)
		return _result(false, errors, warnings)
	var scene_save_error := ResourceSaver.save(packed_scene, staged_scene_path)
	scene_build.root.free()
	if scene_save_error != OK:
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append("Unable to stage scene for %s (error %d)." % [scene_path, scene_save_error])
		return _result(false, errors, warnings)

	var generated_hashes := {
		"%s.tileset.tres" % pack_id: _sha256_file(staged_tileset_path),
		"%s.world.tscn" % pack_id: _sha256_file(staged_scene_path),
	}
	if generated_hashes.values().has(""):
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append("Unable to hash staged resources for %s." % output_dir)
		return _result(false, errors, warnings)
	var import_state := _create_import_state(
		pack_id,
		manifest_sha256,
		generated_hashes,
		validation.cell_count,
		validation.props.size(),
		validation.schema_version,
		not validation.world_layout.is_empty()
	)
	var state_write_error := _write_json_file(staged_state_path, import_state)
	if state_write_error != OK:
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append("Unable to stage import state for %s (error %d)." % [output_dir, state_write_error])
		return _result(false, errors, warnings)
	var staged_validation := _validate_staged_resources(
		staged_tileset_path,
		staged_scene_path,
		validation.layer_cell_counts,
		validation.props.size(),
		validation.places.size(),
		validation.structures.size(),
		_has_structures(validation.schema_version),
		validation.schema_version,
		validation.world_layout
	)
	if not staged_validation.ok:
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append(staged_validation.error)
		return _result(false, errors, warnings)
	var source_check := _capture_source_snapshot(local_manifest_path, pack_root, manifest, manifest_sha256)
	if not source_check.ok or source_check.sha256 != source_snapshot.sha256:
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append("The source pack changed while generated resources were being staged; no files were replaced.")
		return _result(false, errors, warnings)

	var baseline_check := _inspect_existing_import(
		output_dir,
		pack_id,
		tileset_path,
		scene_path,
		state_path,
		manifest_sha256,
		validation.schema_version,
		not validation.world_layout.is_empty()
	)
	if baseline_check.status != operation_status or baseline_check.baseline_sha256 != existing.baseline_sha256:
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append("The existing import changed while the new pack was being staged; no files were replaced.")
		var changed_result := _result(false, errors, warnings)
		changed_result.merge({
			"status": "conflict",
			"pack_id": pack_id,
			"output_dir": output_dir,
			"tileset_path": tileset_path,
			"scene_path": scene_path,
			"state_path": state_path,
			"manifest_sha256": manifest_sha256,
		}, true)
		return changed_result

	var commit := _commit_staged_directory(
		staging_dir,
		output_dir,
		operation_status == "updated",
		existing.baseline_sha256
	)
	warnings.append_array(commit.warnings)
	if not commit.ok:
		_cleanup_transaction_directory(staging_dir, warnings)
		errors.append_array(commit.errors)
		var commit_result := _result(false, errors, warnings)
		if commit.get("status", "") == "conflict":
			commit_result.merge({
				"status": "conflict",
				"pack_id": pack_id,
				"output_dir": output_dir,
				"tileset_path": tileset_path,
				"scene_path": scene_path,
				"state_path": state_path,
				"manifest_sha256": manifest_sha256,
			}, true)
		return commit_result

	return _successful_result(
		operation_status,
		pack_id,
		output_dir,
		tileset_path,
		scene_path,
		state_path,
		manifest_sha256,
		validation.cell_count,
		validation.props.size(),
		errors,
		warnings
	)


static func _inspect_existing_import(
	output_dir: String,
	pack_id: String,
	tileset_path: String,
	scene_path: String,
	state_path: String,
	manifest_sha256: String,
	schema_version: String = "",
	has_world_layout: bool = false
) -> Dictionary:
	var errors: Array[String] = []
	var warnings: Array[String] = []
	var inspection := {
		"status": "created",
		"errors": errors,
		"warnings": warnings,
		"cell_count": 0,
		"prop_count": 0,
		"baseline_sha256": "",
	}
	var absolute_output := ProjectSettings.globalize_path(output_dir)
	if not DirAccess.dir_exists_absolute(absolute_output):
		return inspection

	var directory := DirAccess.open(absolute_output)
	if directory == null:
		errors.append("Unable to inspect existing output directory %s." % output_dir)
		inspection.status = "conflict"
		return inspection
	directory.include_hidden = true
	var actual_files: Array[String] = []
	for filename: String in directory.get_files():
		actual_files.append(filename)
	actual_files.sort()
	var expected_files: Array[String] = [
		"%s.tileset.tres" % pack_id,
		"%s.world.tscn" % pack_id,
		IMPORT_STATE_FILENAME,
	]
	expected_files.sort()
	if actual_files != expected_files or not directory.get_directories().is_empty():
		errors.append(
			"Existing output %s is not an exact importer-managed directory. Move or delete it after preserving any work, then import again." % output_dir
		)
		inspection.status = "conflict"
		return inspection

	var state_read := _read_json_file(state_path)
	if not state_read.ok:
		errors.append("Existing import state is unreadable or invalid: %s" % state_read.error)
		inspection.status = "conflict"
		return inspection
	var state: Dictionary = state_read.value
	var importer: Variant = state.get("importer")
	var generated_files: Variant = state.get("generated_files")
	if (
		state.size() != 9
		or state.get("schema_version") != IMPORT_STATE_SCHEMA_VERSION
		or state.get("pack_id") != pack_id
		or typeof(importer) != TYPE_DICTIONARY
		or importer.size() != 2
		or importer.get("id") != "mapsoo_importer"
		or typeof(importer.get("version")) != TYPE_STRING
		or importer.get("version").is_empty()
		or typeof(state.get("godot_serialization")) != TYPE_STRING
		or state.get("godot_serialization").is_empty()
		or not _is_sha256(str(state.get("manifest_sha256", "")))
		or typeof(generated_files) != TYPE_DICTIONARY
		or generated_files.size() != 2
		or not _is_json_integer(state.get("cell_count"))
		or int(state.get("cell_count")) < 0
		or not _is_json_integer(state.get("prop_count"))
		or int(state.get("prop_count")) < 0
	):
		errors.append("Existing import state does not match the supported ownership schema: %s" % state_path)
		inspection.status = "conflict"
		return inspection
	var recorded_integrity: Variant = state.get("integrity_sha256")
	var expected_integrity := _sha256_text(JSON.stringify(_canonical_import_state_core(state), "", true))
	if typeof(recorded_integrity) != TYPE_STRING or not _is_sha256(recorded_integrity) or recorded_integrity != expected_integrity:
		errors.append("Existing import state failed its integrity check: %s" % state_path)
		inspection.status = "conflict"
		return inspection

	var expected_hashes := {
		"%s.tileset.tres" % pack_id: tileset_path,
		"%s.world.tscn" % pack_id: scene_path,
	}
	var current_hashes := {}
	for filename: String in expected_hashes:
		var recorded_hash: Variant = generated_files.get(filename)
		var current_hash := _sha256_file(expected_hashes[filename])
		if typeof(recorded_hash) != TYPE_STRING or not _is_sha256(recorded_hash) or current_hash != recorded_hash:
			errors.append("Managed output changed outside the importer: %s" % expected_hashes[filename])
			inspection.status = "conflict"
			return inspection
		current_hashes[filename] = current_hash

	inspection.cell_count = int(state.get("cell_count"))
	inspection.prop_count = int(state.get("prop_count"))
	inspection.baseline_sha256 = _sha256_text(JSON.stringify({
		"state_file_sha256": _sha256_file(state_path),
		"generated_files": current_hashes,
	}, "", true))
	var expected_importer_version := (
		str(importer.get("version", ""))
		if schema_version.is_empty()
		else _importer_version_for_schema(schema_version, has_world_layout)
	)
	var same_generation: bool = (
		state.get("manifest_sha256") == manifest_sha256
		and importer.get("version") == expected_importer_version
		and state.get("godot_serialization") == _current_godot_serialization()
	)
	inspection.status = "unchanged" if same_generation else "updated"
	return inspection


static func _create_import_state(
	pack_id: String,
	manifest_sha256: String,
	generated_hashes: Dictionary,
	cell_count: int,
	prop_count: int,
	schema_version: String,
	has_world_layout: bool = false
) -> Dictionary:
	var state := _canonical_import_state_core({
		"schema_version": IMPORT_STATE_SCHEMA_VERSION,
		"importer": {
			"id": "mapsoo_importer",
			"version": _importer_version_for_schema(schema_version, has_world_layout),
		},
		"godot_serialization": _current_godot_serialization(),
		"pack_id": pack_id,
		"manifest_sha256": manifest_sha256,
		"generated_files": generated_hashes.duplicate(true),
		"cell_count": cell_count,
		"prop_count": prop_count,
	})
	state["integrity_sha256"] = _sha256_text(JSON.stringify(state, "", true))
	return state


static func _importer_version_for_schema(
	schema_version: String,
	has_world_layout: bool = false
) -> String:
	var version := ""
	if schema_version == CONTROLLED_SCHEMA_VERSION:
		version = "1.0.0"
	elif schema_version == LAYERED_DEPTH_SCHEMA_VERSION:
		version = "0.1.0-alpha.12"
	elif schema_version == ISOMETRIC_ACTION_SCHEMA_VERSION:
		version = "0.1.0-alpha.11"
	else:
		version = (
			"0.1.0-alpha.10"
			if schema_version in [COMPLETE_FARM_SCHEMA_VERSION, SIDE_PLATFORMER_SCHEMA_VERSION]
			else IMPORTER_VERSION
		)
	if has_world_layout and schema_version in [
		COMPLETE_FARM_SCHEMA_VERSION,
		SIDE_PLATFORMER_SCHEMA_VERSION,
		ISOMETRIC_ACTION_SCHEMA_VERSION,
		LAYERED_DEPTH_SCHEMA_VERSION,
		CONTROLLED_SCHEMA_VERSION,
	]:
		return "%s-layout.2" % version
	return version


static func _canonical_import_state_core(state: Dictionary) -> Dictionary:
	var importer: Dictionary = state.get("importer", {})
	var generated_files: Dictionary = state.get("generated_files", {})
	var generated_keys: Array = generated_files.keys()
	generated_keys.sort()
	var canonical_files := {}
	for filename: Variant in generated_keys:
		canonical_files[str(filename)] = str(generated_files.get(filename, ""))
	return {
		"schema_version": str(state.get("schema_version", "")),
		"importer": {
			"id": str(importer.get("id", "")),
			"version": str(importer.get("version", "")),
		},
		"godot_serialization": str(state.get("godot_serialization", "")),
		"pack_id": str(state.get("pack_id", "")),
		"manifest_sha256": str(state.get("manifest_sha256", "")),
		"generated_files": canonical_files,
		"cell_count": int(state.get("cell_count", 0)),
		"prop_count": int(state.get("prop_count", 0)),
	}


static func _validate_staged_resources(
	tileset_path: String,
	scene_path: String,
	expected_layer_cells: Dictionary,
	expected_props: int,
	expected_places: int = 0,
	expected_structures: int = 0,
	expect_structures_container: bool = false,
	schema_version: String = "",
	expected_world_layout: Dictionary = {}
) -> Dictionary:
	var tile_set := ResourceLoader.load(tileset_path, "TileSet", ResourceLoader.CACHE_MODE_IGNORE_DEEP) as TileSet
	if tile_set == null:
		return {"ok": false, "error": "Staged TileSet could not be loaded before commit: %s" % tileset_path}
	var packed := ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE_DEEP) as PackedScene
	if packed == null:
		return {"ok": false, "error": "Staged scene could not be loaded before commit: %s" % scene_path}
	var world := packed.instantiate()
	var layout_validation := WorldLayoutAttachment.validate_bound_scene(
		world,
		expected_world_layout
	)
	if not layout_validation.ok:
		world.free()
		return {"ok": false, "error": layout_validation.error}
	if schema_version == COMPLETE_FARM_SCHEMA_VERSION:
		var ground_layer := world.get_node_or_null("Ground") as TileMapLayer
		var alpha9_valid := ground_layer != null and world.get_node_or_null("Water") is TileMapLayer and world.get_node_or_null("Paths") is TileMapLayer and world.get_node_or_null("Soil") is TileMapLayer
		alpha9_valid = alpha9_valid and world.get_node_or_null("Props") is Node2D and world.get_node_or_null("Structures") is Node2D and world.get_node_or_null("Crops") is Node2D
		var standalone_atlas := tile_set.get_source(0) as TileSetAtlasSource
		var embedded_atlas := ground_layer.tile_set.get_source(0) as TileSetAtlasSource if ground_layer != null and ground_layer.tile_set != null else null
		alpha9_valid = alpha9_valid and standalone_atlas != null and _texture_has_persisted_pixels(standalone_atlas.texture)
		alpha9_valid = alpha9_valid and embedded_atlas != null and _texture_has_persisted_pixels(embedded_atlas.texture)
		alpha9_valid = alpha9_valid and _sprite_textures_have_persisted_pixels(world)
		var navigation_region := world.get_node_or_null("WorldNavigation") as NavigationRegion2D
		var spawn := world.get_node_or_null("PlayerSpawn") as Marker2D
		var player := world.get_node_or_null("Player") as CharacterBody2D
		alpha9_valid = alpha9_valid and navigation_region != null and navigation_region.navigation_polygon != null and navigation_region.navigation_polygon.get_polygon_count() > 0
		var used_rect := ground_layer.get_used_rect() if ground_layer != null else Rect2i()
		var expected_bounds := Rect2(used_rect.position * 32, used_rect.size * 32)
		alpha9_valid = alpha9_valid and spawn != null and player != null and player.position == spawn.position and player.get_script() == PlayerController and player.get("mapsoo_profile") == "topdown-farm" and player.get("world_bounds") == expected_bounds and world.get_node_or_null("Player/CollisionShape2D") is CollisionShape2D and world.get_node_or_null("Player/Camera2D") is Camera2D
		var visual := world.get_node_or_null("Player/Visual") as AnimatedSprite2D
		if visual == null or visual.sprite_frames == null:
			alpha9_valid = false
		else:
			alpha9_valid = alpha9_valid and str(visual.get_meta("mapsoo_runtime_slot_id", "")) == "player"
			for clip_id: String in ALPHA9_CLIPS:
				var animation_name := clip_id.replace(".", "_")
				if not visual.sprite_frames.has_animation(animation_name) or visual.sprite_frames.get_frame_count(animation_name) < 1: alpha9_valid = false
				elif not _sprite_frames_have_persisted_pixels(visual.sprite_frames, animation_name): alpha9_valid = false
		world.free()
		return {"ok": alpha9_valid, "error": "" if alpha9_valid else "Staged Pack 0.6 scene is incomplete."}
	if schema_version == SIDE_PLATFORMER_SCHEMA_VERSION:
		var alpha10_result := Pack07.validate_staged_scene(world, expected_props)
		world.free()
		return alpha10_result
	if schema_version == ISOMETRIC_ACTION_SCHEMA_VERSION:
		var alpha11_result := Pack08.validate_staged_scene(world, expected_props)
		world.free()
		return alpha11_result
	if schema_version == LAYERED_DEPTH_SCHEMA_VERSION:
		var alpha12_result := Pack09.validate_staged_scene(world, expected_props)
		world.free()
		return alpha12_result
	if schema_version == CONTROLLED_SCHEMA_VERSION:
		var pack10_result := Pack10.validate_staged_scene(world, expected_props)
		world.free()
		return pack10_result
	var props := world.get_node_or_null("Props")
	var places := world.get_node_or_null("Places")
	var structures := world.get_node_or_null("Structures")
	var valid := props != null
	if valid:
		for layer_id: Variant in expected_layer_cells:
			var layer_name := _scene_layer_name(str(layer_id))
			var tile_layer := world.get_node_or_null(layer_name) as TileMapLayer
			if tile_layer == null or tile_layer.get_used_cells().size() != int(expected_layer_cells[layer_id]):
				valid = false
				break
	if valid:
		valid = props.get_child_count() == expected_props
	if valid:
		valid = (places == null and expected_places == 0) or (places is Node2D and places.get_child_count() == expected_places)
	if valid and places != null:
		for index: int in expected_places:
			var marker := places.get_node_or_null("Place_%04d" % index) as Marker2D
			if marker == null or marker.get_child_count() != 1 or not (marker.get_child(0) is Sprite2D) or not marker.has_meta("mapsoo_id"):
				valid = false
				break
	if valid:
		valid = (structures is Node2D and structures.get_child_count() == expected_structures) if expect_structures_container else structures == null
	if valid and structures != null:
		var place_ids := {}
		if places != null:
			for marker_value: Node in places.get_children():
				place_ids[marker_value.get_meta("mapsoo_id", "")] = true
		for index: int in expected_structures:
			var sprite := structures.get_node_or_null("Structure_%04d" % index) as Sprite2D
			if sprite == null or not (sprite.texture is AtlasTexture) or not sprite.has_meta("mapsoo_id") or not place_ids.has(sprite.get_meta("mapsoo_place_id", "")) or sprite.get_meta("mapsoo_order", -1) != index or not sprite.has_meta("mapsoo_archetype") or not sprite.has_meta("mapsoo_cell"):
				valid = false
				break
	world.free()
	if not valid:
		return {"ok": false, "error": "Staged scene contents differ from the validated pack."}
	return {"ok": true, "error": ""}


static func _sprite_textures_have_persisted_pixels(node: Node) -> bool:
	if node is Sprite2D and not _texture_has_persisted_pixels((node as Sprite2D).texture):
		return false
	for child: Node in node.get_children():
		if not _sprite_textures_have_persisted_pixels(child):
			return false
	return true


static func _sprite_frames_have_persisted_pixels(frames: SpriteFrames, animation_name: StringName) -> bool:
	for frame_index: int in frames.get_frame_count(animation_name):
		if not _texture_has_persisted_pixels(frames.get_frame_texture(animation_name, frame_index)):
			return false
	return true


static func _texture_has_persisted_pixels(value: Texture2D) -> bool:
	var texture := value
	if texture is AtlasTexture:
		texture = (texture as AtlasTexture).atlas
	if texture == null:
		return false
	var image := texture.get_image()
	return image != null and not image.is_empty() and not image.get_data().is_empty()


static func _successful_result(
	status: String,
	pack_id: String,
	output_dir: String,
	tileset_path: String,
	scene_path: String,
	state_path: String,
	manifest_sha256: String,
	cell_count: int,
	prop_count: int,
	errors: Array[String],
	warnings: Array[String]
) -> Dictionary:
	var result := _result(true, errors, warnings)
	result.merge({
		"status": status,
		"pack_id": pack_id,
		"output_dir": output_dir,
		"tileset_path": tileset_path,
		"scene_path": scene_path,
		"state_path": state_path,
		"manifest_sha256": manifest_sha256,
		"cell_count": cell_count,
		"prop_count": prop_count,
	}, true)
	return result


static func _commit_staged_directory(
	staging_dir: String,
	output_dir: String,
	is_update: bool,
	expected_baseline_sha256: String = "",
	simulate_promote_failure: bool = false,
	simulate_baseline_change: bool = false
) -> Dictionary:
	var errors: Array[String] = []
	var warnings: Array[String] = []
	var normalised_staging := _normalise_resource_dir(staging_dir)
	var normalised_output := _normalise_resource_dir(output_dir)
	var pack_id := normalised_output.get_file()
	if (
		normalised_staging != staging_dir
		or normalised_output != output_dir
		or normalised_staging.get_base_dir() != OUTPUT_ROOT
		or normalised_output.get_base_dir() != OUTPUT_ROOT
		or not _is_pack_id(pack_id)
		or not normalised_staging.get_file().begins_with(".mapsoo-staging-%s-" % pack_id)
	):
		errors.append("Transaction paths must be same-parent importer paths under %s." % OUTPUT_ROOT)
		return {"ok": false, "status": "", "errors": errors, "warnings": warnings}
	var staged_inspection := _inspect_existing_import(
		staging_dir,
		pack_id,
		"%s/%s.tileset.tres" % [staging_dir, pack_id],
		"%s/%s.world.tscn" % [staging_dir, pack_id],
		"%s/%s" % [staging_dir, IMPORT_STATE_FILENAME],
		""
	)
	if staged_inspection.status == "conflict":
		errors.append("The staged import is not an exact, valid importer-managed directory.")
		errors.append_array(staged_inspection.errors)
		return {"ok": false, "status": "", "errors": errors, "warnings": warnings}
	var staging_absolute := ProjectSettings.globalize_path(staging_dir)
	var output_absolute := ProjectSettings.globalize_path(output_dir)
	if not is_update:
		var create_error := DirAccess.rename_absolute(staging_absolute, output_absolute)
		if create_error != OK:
			errors.append("Unable to commit the staged import to %s (error %d)." % [output_dir, create_error])
		return {"ok": errors.is_empty(), "status": "", "errors": errors, "warnings": warnings}
	if not _is_sha256(expected_baseline_sha256):
		errors.append("A verified output baseline is required before replacing an existing import.")
		return {"ok": false, "status": "", "errors": errors, "warnings": warnings}

	var backup_dir := _unique_transaction_dir("backup", pack_id)
	var backup_absolute := ProjectSettings.globalize_path(backup_dir)
	var backup_error := DirAccess.rename_absolute(output_absolute, backup_absolute)
	if backup_error != OK:
		errors.append("Unable to prepare the existing import for replacement (error %d); no files were changed." % backup_error)
		return {"ok": false, "status": "", "errors": errors, "warnings": warnings}

	if simulate_baseline_change:
		var simulated_scene := "%s/%s.world.tscn" % [backup_dir, pack_id]
		var simulation_file := FileAccess.open(simulated_scene, FileAccess.READ_WRITE)
		if simulation_file != null:
			simulation_file.seek_end()
			simulation_file.store_string("\n# simulated concurrent edit\n")
			simulation_file.close()
	var backup_baseline := _inspect_existing_import(
		backup_dir,
		pack_id,
		"%s/%s.tileset.tres" % [backup_dir, pack_id],
		"%s/%s.world.tscn" % [backup_dir, pack_id],
		"%s/%s" % [backup_dir, IMPORT_STATE_FILENAME],
		""
	)
	if backup_baseline.status == "conflict" or backup_baseline.baseline_sha256 != expected_baseline_sha256:
		var baseline_rollback_error := DirAccess.rename_absolute(backup_absolute, output_absolute)
		if baseline_rollback_error != OK:
			errors.append(
				"The existing import changed during commit and recovery failed (error %d). Preserve recovery directory %s and do not import again." % [
					baseline_rollback_error,
					backup_dir,
				]
			)
		else:
			errors.append("The existing import changed during commit; the staged update was not applied and the changed import was restored.")
		return {"ok": false, "status": "conflict", "errors": errors, "warnings": warnings}

	var promote_error := ERR_CANT_CREATE if simulate_promote_failure else DirAccess.rename_absolute(staging_absolute, output_absolute)
	if promote_error != OK:
		var rollback_error := DirAccess.rename_absolute(backup_absolute, output_absolute)
		if rollback_error != OK:
			errors.append(
				"Import commit failed (error %d) and rollback also failed (error %d). Preserve recovery directory %s and do not import again." % [
					promote_error,
					rollback_error,
					backup_dir,
				]
			)
		else:
			errors.append("Import commit failed (error %d); the previous import was restored without changes." % promote_error)
		return {"ok": false, "status": "", "errors": errors, "warnings": warnings}

	var cleanup_error := _remove_transaction_directory(backup_dir)
	if cleanup_error != OK:
		warnings.append("The import was committed, but stale backup %s could not be removed (error %d)." % [backup_dir, cleanup_error])
	return {"ok": true, "status": "", "errors": errors, "warnings": warnings}


static func _unique_transaction_dir(kind: String, pack_id: String) -> String:
	return "%s/.mapsoo-%s-%s-%d-%d" % [
		OUTPUT_ROOT,
		kind,
		pack_id,
		OS.get_process_id(),
		Time.get_ticks_usec(),
	]


static func _current_godot_serialization() -> String:
	return "%d.%d" % [
		int(Engine.get_version_info().get("major", 0)),
		int(Engine.get_version_info().get("minor", 0)),
	]


static func _cleanup_transaction_directory(transaction_dir: String, warnings: Array[String]) -> void:
	var cleanup_error := _remove_transaction_directory(transaction_dir)
	if cleanup_error != OK:
		warnings.append("Unable to remove transaction directory %s (error %d); inspect it before importing this pack again." % [transaction_dir, cleanup_error])


static func _remove_transaction_directory(transaction_dir: String) -> Error:
	var normalised := _normalise_resource_dir(transaction_dir)
	var basename := normalised.get_file()
	if normalised.get_base_dir() != OUTPUT_ROOT or (not basename.begins_with(".mapsoo-staging-") and not basename.begins_with(".mapsoo-backup-")):
		return ERR_UNAUTHORIZED
	var absolute_dir := ProjectSettings.globalize_path(normalised)
	if not DirAccess.dir_exists_absolute(absolute_dir):
		return OK
	var directory := DirAccess.open(absolute_dir)
	if directory == null:
		return ERR_CANT_OPEN
	directory.include_hidden = true
	if not directory.get_directories().is_empty():
		return ERR_UNAUTHORIZED
	for filename: String in directory.get_files():
		var remove_error := DirAccess.remove_absolute(absolute_dir.path_join(filename))
		if remove_error != OK:
			return remove_error
	return DirAccess.remove_absolute(absolute_dir)


static func _validate_and_prepare(
	manifest: Dictionary,
	pack_root: String,
	authorization: Dictionary = {},
) -> Dictionary:
	var errors: Array[String] = []
	var warnings: Array[String] = []
	var prepared := {
		"errors": errors,
		"warnings": warnings,
		"pack_id": "",
		"tile_set": null,
		"tile_lookup": {},
		"atlas_ids": {},
		"textures": {},
		"sprites": {},
		"cells": [],
		"layer_cells": {},
		"layer_cell_counts": {},
		"tile_layer_ids": [],
		"props": [],
		"places": [],
		"structures": [],
		"width": 0,
		"height": 0,
		"tile_size": Vector2i.ZERO,
		"cell_count": 0,
		"schema_version": "",
		"world_layout": {},
	}

	var schema_version_value: Variant = manifest.get("schema_version")
	if typeof(schema_version_value) != TYPE_STRING or schema_version_value not in SUPPORTED_SCHEMA_VERSIONS:
		errors.append("Unsupported schema_version. Expected one of: %s." % ", ".join(SUPPORTED_SCHEMA_VERSIONS))
		return prepared
	var schema_version: String = schema_version_value
	prepared.schema_version = schema_version
	if schema_version == COMPLETE_FARM_SCHEMA_VERSION:
		return _validate_complete_farm(manifest, pack_root, prepared)
	if schema_version == SIDE_PLATFORMER_SCHEMA_VERSION:
		var file_index := _validate_file_records(manifest.get("files"), pack_root, errors)
		if not errors.is_empty():
			return prepared
		return Pack07.validate_and_prepare(manifest, pack_root, prepared, file_index)
	if schema_version == ISOMETRIC_ACTION_SCHEMA_VERSION:
		var alpha11_file_index := _validate_file_records(manifest.get("files"), pack_root, errors)
		if not errors.is_empty():
			return prepared
		return Pack08.validate_and_prepare(manifest, pack_root, prepared, alpha11_file_index)
	if schema_version == LAYERED_DEPTH_SCHEMA_VERSION:
		var alpha12_file_index := _validate_file_records(manifest.get("files"), pack_root, errors)
		if not errors.is_empty():
			return prepared
		return Pack09.validate_and_prepare(manifest, pack_root, prepared, alpha12_file_index)
	if schema_version == CONTROLLED_SCHEMA_VERSION:
		var controlled_file_index := _validate_file_records(manifest.get("files"), pack_root, errors)
		if not errors.is_empty():
			return prepared
		return Pack10.validate_and_prepare(
			manifest,
			pack_root,
			prepared,
			controlled_file_index,
			authorization,
		)
	var pack := _dictionary_at(manifest, "pack", errors)
	var compatibility := _dictionary_at(manifest, "compatibility", errors)
	var license := _dictionary_at(manifest, "license", errors)
	if not errors.is_empty():
		return prepared
	var pack_id_value: Variant = pack.get("id")
	if typeof(pack_id_value) != TYPE_STRING or not _is_pack_id(pack_id_value):
		errors.append("pack.id must be lowercase kebab-case ASCII.")
	else:
		prepared.pack_id = pack_id_value
	if _has_places(schema_version):
		var generator := _dictionary_at(pack, "generator", errors)
		var expected_pack_version := "0.1.0-alpha.5"
		if schema_version == EXTERIOR_STRUCTURES_SCHEMA_VERSION:
			expected_pack_version = "0.1.0-alpha.6"
		elif schema_version == MULTI_WORLD_PACK_SCHEMA_VERSION:
			expected_pack_version = "0.1.0-alpha.7"
		if pack.get("version") != expected_pack_version:
			errors.append("Schema %s pack.version must be %s." % [schema_version, expected_pack_version])
		if not _has_exact_keys(generator, ["name", "version"]) or generator.get("name") != "Mapsoo Worldsmith" or generator.get("version") != pack.get("version"):
			errors.append("Schema %s pack.generator must identify Mapsoo Worldsmith at the same pack version." % schema_version)
	if compatibility.get("godot_min") != "4.3":
		errors.append("compatibility.godot_min must be 4.3 for schema %s." % schema_version)
	if compatibility.get("grid") != "orthogonal":
		errors.append("Only orthogonal Mapsoo packs are supported.")
	if compatibility.get("art_style") != "pixel_art":
		errors.append("Only pixel_art packs are supported by this importer version.")
	var importer_requirement := _dictionary_at(compatibility, "importer", errors)
	var expected_importer_version := "0.1.0-alpha.1"
	if schema_version == PLAYABLE_TERRAIN_SCHEMA_VERSION:
		expected_importer_version = "0.1.0-alpha.4"
	elif schema_version == SEMANTIC_PLACES_SCHEMA_VERSION:
		expected_importer_version = "0.1.0-alpha.5"
	elif schema_version == EXTERIOR_STRUCTURES_SCHEMA_VERSION:
		expected_importer_version = "0.1.0-alpha.6"
	elif schema_version == MULTI_WORLD_PACK_SCHEMA_VERSION:
		expected_importer_version = "0.1.0-alpha.7"
	if importer_requirement.get("id") != "mapsoo_importer" or importer_requirement.get("min_version") != expected_importer_version:
		errors.append("Pack requires an unsupported importer ID or minimum version.")
	if importer_requirement.get("source") != "https://github.com/babyrush0101-source/mapsoo-kids":
		errors.append("Pack importer source must reference the official Mapsoo repository.")
	var asset_license := _dictionary_at(license, "assets", errors)
	if asset_license.get("id") != "CC0-1.0":
		errors.append("Schema %s generated assets must declare CC0-1.0." % schema_version)
	if not errors.is_empty():
		return prepared

	var file_index := _validate_file_records(manifest.get("files"), pack_root, errors)
	for record_value: Variant in manifest.get("files", []):
		if typeof(record_value) != TYPE_DICTIONARY or not _has_exact_keys(record_value, ["path", "media_type", "bytes", "sha256"]) or record_value.get("media_type") not in ["image/png", "application/json", "application/schema+json", "text/markdown"] or int(record_value.get("bytes", 0)) < 1:
			errors.append("Pack 0.6 file records must use the exact integrity fields and supported media types.")
	if not errors.is_empty():
		return prepared
	var referenced_paths := _collect_referenced_paths(manifest, errors)
	if not errors.is_empty():
		return prepared
	for relative_path: String in referenced_paths:
		if not file_index.has(relative_path):
			errors.append("Referenced file is not declared in manifest.files: %s" % relative_path)
	if not errors.is_empty():
		return prepared
	_validate_png_budget(manifest, pack_root, errors)
	if not errors.is_empty():
		return prepared

	var world_spec_ref := _dictionary_at(manifest, "world_spec", errors)
	if not errors.is_empty():
		return prepared
	var world_path: String = world_spec_ref.get("path", "")
	var world_record: Dictionary = file_index.get(world_path, {})
	if world_spec_ref.get("sha256") != world_record.get("sha256"):
		errors.append("world_spec.sha256 does not match its manifest.files record.")
		return prepared
	var world_read := _read_json_file(_resolve_pack_path(pack_root, world_path))
	if not world_read.ok:
		errors.append(world_read.error)
		return prepared
	var world_spec: Dictionary = world_read.value
	var expected_world_schema := "0.3.0" if _has_structures(schema_version) else ("0.2.0" if schema_version == SEMANTIC_PLACES_SCHEMA_VERSION else LEGACY_SCHEMA_VERSION)
	if world_spec.get("schemaVersion") != expected_world_schema:
		errors.append("World Spec schemaVersion must be %s for pack schema %s." % [expected_world_schema, schema_version])
	if world_spec.get("id") != prepared.pack_id:
		errors.append("World Spec id must match pack.id.")
	var world_visual := _dictionary_at(world_spec, "visual", errors)
	var world_map := _dictionary_at(world_spec, "map", errors)
	var world_output := _dictionary_at(world_spec, "output", errors)
	var world_tile_size_value: Variant = world_visual.get("tileSize")
	if not _is_json_integer(world_tile_size_value) or int(world_tile_size_value) not in [16, 32, 64]:
		errors.append("World Spec visual.tileSize must be 16, 32, or 64.")
	var world_width_value: Variant = world_map.get("width")
	var world_height_value: Variant = world_map.get("height")
	if not _is_json_integer(world_width_value) or not _is_json_integer(world_height_value) or world_width_value < 8 or world_width_value > 48 or world_height_value < 8 or world_height_value > 32:
		errors.append("World Spec map dimensions must be integers from 8x8 to 48x32.")
	if world_map.get("biome") not in ["meadow", "desert", "snow"]:
		errors.append("World Spec biome is not supported by this importer.")
	if world_output.get("assetLicense") != "CC0-1.0" or world_output.get("targets") != ["common", "godot", "itch"]:
		errors.append("World Spec output contract must target common, godot, itch with CC0-1.0 assets.")

	var demo := _dictionary_at(manifest, "demo", errors)
	var map_path_value: Variant = demo.get("map")
	if typeof(map_path_value) != TYPE_STRING:
		errors.append("demo.map must be a relative file path.")
		return prepared
	var map_read := _read_json_file(_resolve_pack_path(pack_root, map_path_value))
	if not map_read.ok:
		errors.append(map_read.error)
		return prepared
	var map_data: Dictionary = map_read.value
	if map_data.get("schema_version") != schema_version:
		errors.append("Demo map schema_version must be %s." % schema_version)

	var atlas_build := _build_tile_set(
		manifest.get("atlases"),
		pack_root,
		errors,
		schema_version,
		manifest.get("terrain_sets", []),
		manifest.get("physics_layers", [])
	)
	if not errors.is_empty():
		return prepared
	prepared.tile_set = atlas_build.tile_set
	prepared.tile_lookup = atlas_build.tile_lookup
	prepared.atlas_ids = atlas_build.atlas_ids
	prepared.textures = atlas_build.textures
	prepared.tile_size = atlas_build.tile_size
	if _is_json_integer(world_tile_size_value) and (prepared.tile_size.x != int(world_tile_size_value) or prepared.tile_size.y != int(world_tile_size_value)):
		errors.append("Atlas cell size must match the square World Spec tileSize.")

	var layers_value: Variant = manifest.get("layers")
	if typeof(layers_value) != TYPE_ARRAY:
		errors.append("manifest.layers must be an array.")
		return prepared
	var expected_tile_layer_ids: Array[String] = ["ground"]
	if _has_playable_terrain(schema_version):
		expected_tile_layer_ids.append_array(["water", "roads"])
	var expected_layer_count := expected_tile_layer_ids.size() + 1
	if layers_value.size() != expected_layer_count:
		errors.append("Schema %s requires exactly %d ordered layers." % [schema_version, expected_layer_count])
		return prepared
	var tile_layers := {}
	for layer_index: int in expected_tile_layer_ids.size():
		var layer_value: Variant = layers_value[layer_index]
		if typeof(layer_value) != TYPE_DICTIONARY:
			errors.append("Layer %d must be a tilemap object." % layer_index)
			continue
		var layer: Dictionary = layer_value
		var expected_id := expected_tile_layer_ids[layer_index]
		if layer.get("id") != expected_id or layer.get("kind") != "tilemap":
			errors.append("Layer %d must be the %s tilemap layer." % [layer_index, expected_id])
			continue
		tile_layers[expected_id] = layer
	var props_value: Variant = layers_value[expected_layer_count - 1]
	var props_layer: Dictionary = props_value if typeof(props_value) == TYPE_DICTIONARY else {}
	if props_layer.get("id") != "props" or props_layer.get("kind") != "objects":
		errors.append("The final layer must be the props object layer.")
	if not errors.is_empty():
		return prepared
	if props_layer.get("encoding") != "objects":
		errors.append("The props layer must use objects encoding.")
	if props_layer.get("path") != map_path_value:
		errors.append("The props layer path must match demo.map.")

	for layer_id: String in expected_tile_layer_ids:
		var tile_layer: Dictionary = tile_layers[layer_id]
		if tile_layer.get("encoding") != "row-major":
			errors.append("The %s layer must use row-major encoding." % layer_id)
		if tile_layer.get("empty_tile_id") != -1:
			errors.append("The %s layer empty_tile_id must be -1." % layer_id)
		var atlas_id: Variant = tile_layer.get("atlas_id")
		if typeof(atlas_id) != TYPE_STRING or not prepared.atlas_ids.has(atlas_id):
			errors.append("The %s layer references an undeclared atlas_id." % layer_id)
		if tile_layer.get("path") != map_path_value:
			errors.append("The %s layer path must match demo.map." % layer_id)
		var dimensions := _positive_int_pair(tile_layer.get("dimensions_cells"), "%s dimensions_cells" % layer_id, errors)
		if layer_id == "ground" and dimensions != Vector2i.ZERO:
			prepared.width = dimensions.x
			prepared.height = dimensions.y
		elif dimensions != Vector2i(prepared.width, prepared.height):
			errors.append("All tile layers must use the ground dimensions.")
		var cell_pointer := _resolve_json_pointer(map_data, tile_layer.get("json_pointer", ""))
		var cells: Array = []
		if not cell_pointer.ok or typeof(cell_pointer.value) != TYPE_ARRAY:
			errors.append("Unable to resolve the %s layer JSON pointer to an array." % layer_id)
		else:
			var raw_cells: Array = cell_pointer.value
			if raw_cells.size() != prepared.width * prepared.height:
				errors.append("%s cell count does not match dimensions_cells." % layer_id.capitalize())
			for cell_value: Variant in raw_cells:
				if not _is_json_integer(cell_value):
					errors.append("%s cells must contain integer tile IDs." % layer_id.capitalize())
					break
				var cell_id := int(cell_value)
				if cell_id != -1:
					if not prepared.tile_lookup.has(cell_id):
						errors.append("%s layer references undeclared tile ID %s." % [layer_id.capitalize(), cell_value])
						break
					var tile_definition: Dictionary = prepared.tile_lookup[cell_id]
					if tile_definition.atlas_id != atlas_id:
						errors.append("%s tile ID %s belongs to a different atlas." % [layer_id.capitalize(), cell_value])
						break
					if _has_playable_terrain(schema_version):
						var expected_terrain_set := "" if layer_id == "ground" else layer_id
						if tile_definition.terrain_set_id != expected_terrain_set:
							errors.append("%s tile ID %s has incompatible terrain metadata." % [layer_id.capitalize(), cell_value])
							break
				cells.append(cell_id)
		prepared.layer_cells[layer_id] = cells
		var non_empty_count := 0
		for cell_id_value: Variant in cells:
			if cell_id_value != -1:
				non_empty_count += 1
		prepared.layer_cell_counts[layer_id] = non_empty_count
	prepared.tile_layer_ids = expected_tile_layer_ids
	prepared.cells = prepared.layer_cells.get("ground", [])
	prepared.cell_count = int(prepared.layer_cell_counts.get("ground", 0))
	if map_data.get("width") != prepared.width or map_data.get("height") != prepared.height:
		errors.append("Demo map dimensions do not match the ground layer manifest.")
	if _is_json_integer(world_width_value) and _is_json_integer(world_height_value) and (prepared.width != int(world_width_value) or prepared.height != int(world_height_value)):
		errors.append("Ground layer dimensions do not match the World Spec.")

	var prop_pointer := _resolve_json_pointer(map_data, props_layer.get("json_pointer", ""))
	if not prop_pointer.ok or typeof(prop_pointer.value) != TYPE_ARRAY:
		errors.append("Unable to resolve the props layer JSON pointer to an array.")
	else:
		prepared.props = prop_pointer.value
		if prepared.props.size() > MAX_PROP_COUNT:
			errors.append("Props layer exceeds the importer limit of %d objects." % MAX_PROP_COUNT)

	var sprite_build := _validate_sprites(manifest.get("sprites"), pack_root, prepared.textures, errors)
	prepared.sprites = sprite_build.sprites
	prepared.textures = sprite_build.textures
	_validate_props(prepared.props, prepared.sprites, props_layer.get("sprite_atlas"), prepared.width, prepared.height, schema_version, errors)
	if _has_places(schema_version):
		prepared.places = _validate_places_runtime(
			manifest,
			file_index,
			pack_root,
			world_spec,
			world_path,
			prepared,
			errors
		)
	if _has_structures(schema_version) and errors.is_empty():
		prepared.structures = _validate_structures_runtime(
			manifest, file_index, pack_root, world_spec, world_path, prepared, errors
		)
	return prepared


static func _validate_complete_farm(manifest: Dictionary, pack_root: String, prepared: Dictionary) -> Dictionary:
	var errors: Array[String] = prepared.errors
	var pack := _dictionary_at(manifest, "pack", errors)
	var compatibility := _dictionary_at(manifest, "compatibility", errors)
	var output_license := _dictionary_at(_dictionary_at(manifest, "license", errors), "output", errors)
	if errors.is_empty():
		if not _is_pack_id(str(pack.get("id", ""))): errors.append("pack.id must be lowercase kebab-case ASCII.")
		else: prepared.pack_id = pack.id
		var generator := _dictionary_at(pack, "generator", errors)
		if pack.get("version") != "0.1.0-alpha.9" or not _has_exact_keys(generator, ["name", "version"]) or generator.get("name") != "Mapsoo Worldsmith" or generator.get("version") != "0.1.0-alpha.9": errors.append("Pack 0.6 must identify Mapsoo Worldsmith Alpha.9.")
		var importer := _dictionary_at(compatibility, "importer", errors)
		if compatibility.get("godot_min") != "4.3" or compatibility.get("grid") != "orthogonal" or compatibility.get("art_style") != "pixel_art" or importer.get("id") != "mapsoo_importer" or importer.get("min_version") != "0.1.0-alpha.9": errors.append("Pack 0.6 compatibility contract is unsupported.")
		if manifest.get("profile") != "topdown-farm" or manifest.get("completeness_policy") != "topdown-farm-complete-v1": errors.append("Pack 0.6 must use the complete top-down farm profile.")
		var public_license: bool = output_license.get("id") == "CC0-1.0" and output_license.get("notice_path") == "license-assets.md" and output_license.get("permits_redistribution") == true
		var review_license: bool = output_license.get("id") == "LicenseRef-UNRELEASED" and output_license.get("notice_path") == "license-assets.md" and output_license.get("permits_redistribution") == false
		if not public_license and not review_license: errors.append("Pack 0.6 output must use the canonical public or internal-review license contract.")
		var provenance := _dictionary_at(manifest, "provenance", errors)
		if review_license and (provenance.get("contains_generative_ai") != true or provenance.get("output_provenance") not in ["generative-ai", "hybrid"] or typeof(provenance.get("model_provider")) != TYPE_STRING or str(provenance.get("model_provider", "")).is_empty() or typeof(provenance.get("model")) != TYPE_STRING or str(provenance.get("model", "")).is_empty() or provenance.get("human_curated") != false):
			errors.append("Pack 0.6 internal-review provenance contract is invalid.")
	if not errors.is_empty(): return prepared

	var file_index := _validate_file_records(manifest.get("files"), pack_root, errors)
	var atlas_paths := {}
	var atlases: Variant = manifest.get("atlases")
	if typeof(atlases) != TYPE_ARRAY or atlases.size() != ALPHA9_ATLASES.size():
		errors.append("Pack 0.6 requires exactly five canonical atlases.")
	else:
		for index: int in ALPHA9_ATLASES.size():
			var atlas: Variant = atlases[index]
			if typeof(atlas) != TYPE_DICTIONARY or atlas.get("id") != ALPHA9_ATLASES[index] or typeof(atlas.get("path")) != TYPE_STRING or not _is_safe_relative_path(atlas.path): errors.append("Pack 0.6 atlas %d is not canonical." % index)
			else: atlas_paths[atlas.id] = atlas.path
	var layers: Variant = manifest.get("layers")
	if typeof(layers) != TYPE_ARRAY or layers.size() != ALPHA9_LAYERS.size(): errors.append("Pack 0.6 requires seven canonical layers.")
	else:
		for index: int in ALPHA9_LAYERS.size():
			if typeof(layers[index]) != TYPE_DICTIONARY or layers[index].get("id") != ALPHA9_LAYERS[index] or layers[index].get("order") != index: errors.append("Pack 0.6 layers must use canonical order.")
	var role_paths := {}
	var roles: Variant = manifest.get("roles")
	if typeof(roles) != TYPE_ARRAY or roles.size() != ALPHA9_ROLES.size(): errors.append("Pack 0.6 requires all 21 canonical roles.")
	else:
		for index: int in ALPHA9_ROLES.size():
			if typeof(roles[index]) != TYPE_DICTIONARY or roles[index].get("role") != ALPHA9_ROLES[index] or typeof(roles[index].get("path")) != TYPE_STRING: errors.append("Pack 0.6 roles must use canonical order.")
			else: role_paths[roles[index].role] = roles[index].path
	var runtime := _dictionary_at(manifest, "runtime", errors)
	var runtime_paths := {}
	for key: String in ["scene", "collision", "navigation"]:
		var reference := _dictionary_at(runtime, key, errors)
		if not _has_exact_keys(reference, ["path"]) or typeof(reference.get("path")) != TYPE_STRING or not _is_safe_relative_path(reference.path): errors.append("runtime.%s must contain one safe path." % key)
		else: runtime_paths[key] = reference.path
	var spawn := _dictionary_at(runtime, "spawn", errors)
	if not _has_exact_keys(spawn, ["x", "y"]) or not _is_json_integer(spawn.get("x")) or not _is_json_integer(spawn.get("y")) or spawn.get("x") < 0 or spawn.get("y") < 0: errors.append("runtime.spawn must contain non-negative integer x/y coordinates.")
	var notice_path: Variant = output_license.get("notice_path")
	var canonical_role_paths := [atlas_paths.get("terrain"), atlas_paths.get("terrain"), atlas_paths.get("terrain"), atlas_paths.get("terrain"), atlas_paths.get("props"), atlas_paths.get("props"), atlas_paths.get("props"), atlas_paths.get("props"), atlas_paths.get("props"), atlas_paths.get("props"), atlas_paths.get("structures"), atlas_paths.get("structures"), atlas_paths.get("crops"), atlas_paths.get("crops"), atlas_paths.get("crops"), atlas_paths.get("crops"), atlas_paths.get("character"), runtime_paths.get("collision"), runtime_paths.get("navigation"), runtime_paths.get("scene"), role_paths.get("world.preview")]
	for index: int in ALPHA9_ROLES.size():
		if role_paths.get(ALPHA9_ROLES[index]) != canonical_role_paths[index]: errors.append("Role %s is not bound to its canonical asset." % ALPHA9_ROLES[index])
	var referenced: Array = atlas_paths.values() + role_paths.values() + runtime_paths.values() + [notice_path]
	for path_value: Variant in referenced:
		if typeof(path_value) != TYPE_STRING or not _is_safe_relative_path(path_value) or not file_index.has(path_value): errors.append("Referenced file is absent or unsafe: %s" % path_value)
	if not errors.is_empty(): return prepared
	for atlas_id: String in ALPHA9_ATLASES:
		var path: String = atlas_paths[atlas_id]
		if file_index[path].get("media_type") != "image/png": errors.append("Atlas must be PNG: %s" % path)
		var loaded := _load_png(_resolve_pack_path(pack_root, path))
		if not loaded.ok: errors.append(loaded.error)
		else:
			prepared.textures[path] = _texture_from_image(loaded.image)
			var expected_size: Vector2i = {"terrain": Vector2i(128, 32), "props": Vector2i(192, 32), "structures": Vector2i(128, 64), "crops": Vector2i(128, 32), "character": Vector2i(128, 128)}[atlas_id]
			if loaded.image.get_size() != expected_size: errors.append("Atlas %s must have canonical dimensions %s." % [atlas_id, expected_size])
	for key: String in ["scene", "collision", "navigation"]:
		if file_index[runtime_paths[key]].get("media_type") != "application/json": errors.append("Runtime sidecar must be JSON: %s" % runtime_paths[key])
	if not errors.is_empty(): return prepared

	var scene_read := _read_json_file(_resolve_pack_path(pack_root, runtime_paths.scene))
	var collision_read := _read_json_file(_resolve_pack_path(pack_root, runtime_paths.collision))
	var navigation_read := _read_json_file(_resolve_pack_path(pack_root, runtime_paths.navigation))
	if not scene_read.ok: errors.append(scene_read.error)
	if not collision_read.ok: errors.append(collision_read.error)
	if not navigation_read.ok: errors.append(navigation_read.error)
	if not errors.is_empty(): return prepared
	var scene: Dictionary = scene_read.value
	var map := _dictionary_at(scene, "map", errors)
	if scene.get("schemaVersion") != "0.1.0" or not _is_json_integer(map.get("width")) or not _is_json_integer(map.get("height")) or map.get("width") < 1 or map.get("height") < 1 or map.get("tileSize") != 32: errors.append("Pack 0.6 scene sidecar map is invalid.")
	prepared.width = int(map.get("width", 0)); prepared.height = int(map.get("height", 0)); prepared.tile_size = Vector2i(32, 32)
	var scene_layers := _dictionary_at(scene, "layers", errors)
	for layer_id: String in ["ground", "water", "path", "soil"]:
		var cells: Variant = scene_layers.get(layer_id)
		if typeof(cells) != TYPE_ARRAY or cells.size() != prepared.width * prepared.height: errors.append("Scene layer %s has invalid dimensions." % layer_id)
		else:
			for value: Variant in cells:
				if not _is_json_integer(value) or int(value) not in [-1, 0, 1, 2, 3]: errors.append("Scene layer %s contains an invalid tile." % layer_id); break
			prepared.layer_cells[layer_id] = cells
			prepared.layer_cell_counts[layer_id] = cells.filter(func(value: Variant) -> bool: return int(value) != -1).size()
	prepared.tile_layer_ids = ["ground", "water", "path", "soil"]
	prepared.cells = prepared.layer_cells.get("ground", []); prepared.cell_count = int(prepared.layer_cell_counts.get("ground", 0))
	for group: String in ["props", "structures", "crops"]:
		var entries: Variant = scene.get(group)
		if typeof(entries) != TYPE_ARRAY: errors.append("Scene %s must be an array." % group)
		else:
			for entry: Variant in entries:
				if typeof(entry) != TYPE_DICTIONARY or not role_paths.has(entry.get("role")) or _non_negative_int_pair(entry.get("cell"), "%s cell" % group, errors).x >= prepared.width or int(entry.cell[1]) >= prepared.height: errors.append("Scene %s placement is invalid." % group)
		prepared[group] = entries
	if scene.get("spawn") != spawn: errors.append("Manifest and scene spawn coordinates must match.")
	var collision: Dictionary = collision_read.value
	if collision.get("schemaVersion") != "0.1.0" or collision.get("coordinateSpace") != "map-cells" or typeof(collision.get("blocked")) != TYPE_ARRAY: errors.append("Collision sidecar is invalid.")
	else:
		prepared.collisions = collision.blocked
		for cell: Variant in prepared.collisions:
			var collision_cell := _non_negative_int_pair(cell, "collision blocked cell", errors)
			if collision_cell.x >= prepared.width or collision_cell.y >= prepared.height: errors.append("Collision blocked cell is outside the map.")
	var navigation: Dictionary = navigation_read.value
	if navigation.get("schemaVersion") != "0.1.0" or navigation.get("coordinateSpace") != "map-pixels" or typeof(navigation.get("outlines")) != TYPE_ARRAY or navigation.outlines.is_empty(): errors.append("Navigation sidecar is invalid.")
	else: prepared.navigation_outlines = navigation.outlines
	prepared.spawn = Vector2i(int(spawn.x), int(spawn.y)); prepared.role_paths = role_paths; prepared.atlas_paths = atlas_paths
	var character := _dictionary_at(manifest, "character", errors)
	if character.get("atlas") != atlas_paths.get("character") or _positive_int_pair(character.get("frame_size"), "character.frame_size", errors) != Vector2i(32, 32): errors.append("Character atlas or frame size is invalid.")
	var clips: Variant = character.get("clips")
	if typeof(clips) != TYPE_ARRAY or clips.size() != ALPHA9_CLIPS.size(): errors.append("Character must contain eight canonical clips.")
	else:
		for index: int in ALPHA9_CLIPS.size():
			var clip: Dictionary = clips[index] if typeof(clips[index]) == TYPE_DICTIONARY else {}
			if clip.get("id") != ALPHA9_CLIPS[index] or typeof(clip.get("fps")) not in [TYPE_INT, TYPE_FLOAT] or float(clip.get("fps", 0)) <= 0 or typeof(clip.get("frames")) != TYPE_ARRAY or clip.frames.is_empty(): errors.append("Character clip %s is invalid." % ALPHA9_CLIPS[index])
			else:
				for frame: Variant in clip.frames:
					var frame_pos := _non_negative_int_pair([frame.get("x") if typeof(frame) == TYPE_DICTIONARY else -1, frame.get("y") if typeof(frame) == TYPE_DICTIONARY else -1], "character frame", errors)
					if frame_pos.x + 32 > 128 or frame_pos.y + 32 > 128: errors.append("Character frame is outside the canonical atlas.")
	prepared.character = character
	if errors.is_empty(): prepared.tile_set = _build_complete_farm_tileset(prepared)
	return prepared


static func _build_complete_farm_tileset(prepared: Dictionary) -> TileSet:
	var tile_set := TileSet.new(); tile_set.tile_size = Vector2i(32, 32)
	var source := TileSetAtlasSource.new(); source.texture = prepared.textures[prepared.atlas_paths.terrain]; source.texture_region_size = Vector2i(32, 32)
	for tile_id: int in 4:
		var coords := Vector2i(tile_id, 0); source.create_tile(coords)
		prepared.tile_lookup[tile_id] = {"source_id": 0, "coords": coords, "alternative_id": 0}
	tile_set.add_source(source, 0)
	return tile_set


static func _validate_places_runtime(
	manifest: Dictionary,
	file_index: Dictionary,
	pack_root: String,
	world_spec: Dictionary,
	world_path: String,
	prepared: Dictionary,
	errors: Array[String]
) -> Array:
	var validated: Array = []
	var runtime := _dictionary_at(manifest, "runtime", errors)
	var expected_runtime_keys := ["places", "structures"] if _has_structures(prepared.schema_version) else ["places"]
	if not _has_exact_keys(runtime, expected_runtime_keys):
		errors.append("Schema %s runtime must contain exactly %s." % [prepared.schema_version, ", ".join(expected_runtime_keys)])
		return validated
	var places_ref := _dictionary_at(runtime, "places", errors)
	var places_schema_ref := _dictionary_at(places_ref, "schema", errors)
	if places_ref.size() != 3 or places_schema_ref.size() != 2:
		errors.append("runtime.places and its schema reference must use the exact Alpha.5 fields.")
		return validated
	var places_path: Variant = places_ref.get("path")
	var schema_path: Variant = places_schema_ref.get("path")
	var expected_schema_path := "schema/mapsoo-places-0.1.schema.json"
	var expected_places_schema_version := "0.1.0"
	if prepared.schema_version == EXTERIOR_STRUCTURES_SCHEMA_VERSION:
		expected_schema_path = "schema/mapsoo-places-0.2.schema.json"
		expected_places_schema_version = "0.2.0"
	elif prepared.schema_version == MULTI_WORLD_PACK_SCHEMA_VERSION:
		expected_schema_path = "schema/mapsoo-places-0.3.schema.json"
		expected_places_schema_version = "0.3.0"
	if places_path != "runtime/places.json" or schema_path != expected_schema_path:
		errors.append("Schema %s requires the canonical places sidecar and schema paths." % prepared.schema_version)
		return validated
	var places_record: Dictionary = file_index.get(places_path, {})
	var schema_record: Dictionary = file_index.get(schema_path, {})
	if places_ref.get("sha256") != places_record.get("sha256"):
		errors.append("runtime.places.sha256 does not match its manifest.files record.")
	if places_schema_ref.get("sha256") != schema_record.get("sha256"):
		errors.append("runtime.places.schema.sha256 does not match its manifest.files record.")
	if not errors.is_empty():
		return validated
	var sidecar_read := _read_json_file(_resolve_pack_path(pack_root, str(places_path)))
	if not sidecar_read.ok:
		errors.append(sidecar_read.error)
		return validated
	var sidecar: Dictionary = sidecar_read.value
	if not _has_exact_keys(sidecar, ["schema_version", "pack", "world_spec", "coordinate_space", "placement_algorithm", "places"]):
		errors.append("Places sidecar must use the exact schema 0.1.0 top-level fields.")
		return validated
	if sidecar.get("schema_version") != expected_places_schema_version:
		errors.append("Places sidecar schema_version must be %s." % expected_places_schema_version)
	var pack := _dictionary_at(sidecar, "pack", errors)
	var manifest_pack: Dictionary = manifest.get("pack", {})
	if not _has_exact_keys(pack, ["id", "version"]) or pack.get("id") != prepared.pack_id or pack.get("version") != manifest_pack.get("version"):
		errors.append("Places sidecar pack identity must match the schema %s manifest." % prepared.schema_version)
	var sidecar_world := _dictionary_at(sidecar, "world_spec", errors)
	var world_record: Dictionary = file_index.get(world_path, {})
	if not _has_exact_keys(sidecar_world, ["path", "sha256"]) or sidecar_world.get("path") != world_path or sidecar_world.get("sha256") != world_record.get("sha256"):
		errors.append("Places sidecar world_spec reference must match the manifest-bound World Spec.")
	var coordinate := _dictionary_at(sidecar, "coordinate_space", errors)
	if (
		not _has_exact_keys(coordinate, ["origin", "unit", "tile_size"])
		or coordinate.get("origin") != "top-left"
		or coordinate.get("unit") != "cell"
		or coordinate.get("tile_size") != prepared.tile_size.x
	):
		errors.append("Places coordinate_space must be top-left cells using the World Spec tile size.")
	var algorithm := _dictionary_at(sidecar, "placement_algorithm", errors)
	if not _has_exact_keys(algorithm, ["id", "version"]) or algorithm.get("id") != "mapsoo-semantic-place-resolver" or algorithm.get("version") != "0.1.0":
		errors.append("Places placement_algorithm is unsupported.")
	var authored_value: Variant = world_spec.get("places", [])
	var resolved_value: Variant = sidecar.get("places")
	if typeof(authored_value) != TYPE_ARRAY or typeof(resolved_value) != TYPE_ARRAY:
		errors.append("World Spec places and runtime places must be arrays.")
		return validated
	var authored: Array = authored_value
	var resolved: Array = resolved_value
	if authored.size() > MAX_PLACE_COUNT or resolved.size() != authored.size():
		errors.append("Runtime places must be an exact, ordered projection of at most %d World Spec places." % MAX_PLACE_COUNT)
		return validated
	var ids := {}
	var occupied_cells := {}
	var resolver_occupied := {}
	for index: int in resolved.size():
		var authored_value_at_index: Variant = authored[index]
		var place_value: Variant = resolved[index]
		if typeof(authored_value_at_index) != TYPE_DICTIONARY or typeof(place_value) != TYPE_DICTIONARY:
			errors.append("Every authored and resolved place must be an object.")
			continue
		var authored_place: Dictionary = authored_value_at_index
		var place: Dictionary = place_value
		if not _has_exact_keys(authored_place, ["id", "label", "kind", "placement", "tags"]):
			errors.append("World Spec place %d must use the exact Alpha.5 fields." % index)
			continue
		if not _has_exact_keys(place, ["id", "order", "label", "kind", "placement", "sprite_id", "tags", "cell", "pixel_center"]):
			errors.append("Resolved place %d must use the exact sidecar fields." % index)
			continue
		var place_id: Variant = place.get("id")
		var label: Variant = place.get("label")
		var kind: Variant = place.get("kind")
		var placement: Variant = place.get("placement")
		var sprite_id: Variant = place.get("sprite_id")
		if typeof(place_id) != TYPE_STRING or not _is_place_id(place_id) or ids.has(place_id):
			errors.append("Place IDs must be unique lowercase kebab-case identifiers of at most 64 characters.")
			continue
		ids[place_id] = true
		if not _is_json_integer(place.get("order")) or int(place.order) != index:
			errors.append("Place %s order must equal its zero-based array index." % place_id)
		if typeof(label) != TYPE_STRING or label.strip_edges() != label or label.is_empty() or label.length() > 80 or _contains_control_character(label):
			errors.append("Place %s label must be a trimmed 1-80 character string without control characters." % place_id)
		if typeof(kind) != TYPE_STRING or kind not in PLACE_KINDS:
			errors.append("Place %s kind is unsupported." % place_id)
		if typeof(placement) != TYPE_STRING or placement not in PLACE_PLACEMENTS:
			errors.append("Place %s placement is unsupported." % place_id)
		var expected_sprite_id := "place-%s-01" % str(kind)
		if sprite_id != expected_sprite_id or not prepared.sprites.has(sprite_id) or prepared.sprites[sprite_id].atlas != "atlases/places.png":
			errors.append("Place %s must reference its kind-matched sprite in atlases/places.png." % place_id)
		var tags := _validate_place_tags(place.get("tags"), place_id, errors)
		if (
			authored_place.get("id") != place_id
			or authored_place.get("label") != label
			or authored_place.get("kind") != kind
			or authored_place.get("placement") != placement
			or authored_place.get("tags") != tags
		):
			errors.append("Resolved place %s does not exactly match its World Spec declaration." % place_id)
		var cell := _dictionary_at(place, "cell", errors)
		var pixel_center := _dictionary_at(place, "pixel_center", errors)
		if not _has_exact_keys(cell, ["x", "y"]) or not _has_exact_keys(pixel_center, ["x", "y"]):
			errors.append("Place %s cell and pixel_center must contain only x/y." % place_id)
			continue
		var cell_x: Variant = cell.get("x")
		var cell_y: Variant = cell.get("y")
		if not _is_json_integer(cell_x) or not _is_json_integer(cell_y) or cell_x < 0 or cell_y < 0 or cell_x >= prepared.width or cell_y >= prepared.height:
			errors.append("Place %s cell is outside the map bounds." % place_id)
			continue
		var point := Vector2i(int(cell_x), int(cell_y))
		var expected_resolution := _resolve_expected_place_cell(str(authored_place.get("placement", "")), prepared, resolver_occupied)
		if not expected_resolution.ok:
			errors.append("World Spec place %s cannot be resolved by the deterministic semantic-place resolver." % place_id)
		else:
			var expected_point: Vector2i = expected_resolution.cell
			resolver_occupied["%d,%d" % [expected_point.x, expected_point.y]] = true
			if point != expected_point:
				errors.append("Place %s cell must equal deterministic resolver output %s, got %s." % [place_id, expected_point, point])
		var cell_key := "%d,%d" % [point.x, point.y]
		if occupied_cells.has(cell_key):
			errors.append("Resolved places must occupy distinct cells; duplicate at %s." % cell_key)
		occupied_cells[cell_key] = true
		if not _is_json_integer(pixel_center.get("x")) or not _is_json_integer(pixel_center.get("y")) or int(pixel_center.x) != point.x * prepared.tile_size.x + prepared.tile_size.x / 2 or int(pixel_center.y) != point.y * prepared.tile_size.y + prepared.tile_size.y / 2:
			errors.append("Place %s pixel_center must be the exact center of its resolved cell." % place_id)
		var ground_index: int = point.y * int(prepared.width) + point.x
		var ground_tile_id: int = prepared.layer_cells.ground[ground_index]
		if ground_tile_id == -1 or not prepared.tile_lookup.has(ground_tile_id) or prepared.tile_lookup[ground_tile_id].walkable != true:
			errors.append("Place %s must resolve to a walkable ground cell." % place_id)
		if not _place_satisfies_placement(point, str(placement), prepared):
			errors.append("Place %s cell does not satisfy placement %s." % [place_id, placement])
		validated.append({
			"id": place_id,
			"order": index,
			"label": label,
			"kind": kind,
			"placement": placement,
			"sprite_id": sprite_id,
			"tags": tags,
			"cell": point,
			"pixel_center": Vector2(int(pixel_center.get("x", 0)), int(pixel_center.get("y", 0))),
		})
	return validated


static func _validate_structures_runtime(
	manifest: Dictionary,
	file_index: Dictionary,
	pack_root: String,
	world_spec: Dictionary,
	world_path: String,
	prepared: Dictionary,
	errors: Array[String]
) -> Array:
	var validated: Array = []
	var runtime := _dictionary_at(manifest, "runtime", errors)
	var structures_ref := _dictionary_at(runtime, "structures", errors)
	var schema_ref := _dictionary_at(structures_ref, "schema", errors)
	if not _has_exact_keys(structures_ref, ["path", "sha256", "schema"]) or not _has_exact_keys(schema_ref, ["path", "sha256"]):
		errors.append("runtime.structures and its schema reference must use the exact Alpha.6 fields.")
		return validated
	var structures_path: Variant = structures_ref.get("path")
	var schema_path: Variant = schema_ref.get("path")
	var expected_schema_path := "schema/mapsoo-structures-0.2.schema.json" if prepared.schema_version == MULTI_WORLD_PACK_SCHEMA_VERSION else "schema/mapsoo-structures-0.1.schema.json"
	var expected_schema_version := "0.2.0" if prepared.schema_version == MULTI_WORLD_PACK_SCHEMA_VERSION else "0.1.0"
	if structures_path != "runtime/structures.json" or schema_path != expected_schema_path:
		errors.append("Schema %s requires the canonical structures sidecar and schema paths." % prepared.schema_version)
		return validated
	var structures_record: Dictionary = file_index.get(structures_path, {})
	var schema_record: Dictionary = file_index.get(schema_path, {})
	if structures_ref.get("sha256") != structures_record.get("sha256"):
		errors.append("runtime.structures.sha256 does not match its manifest.files record.")
	if schema_ref.get("sha256") != schema_record.get("sha256"):
		errors.append("runtime.structures.schema.sha256 does not match its manifest.files record.")
	if not errors.is_empty():
		return validated
	var sidecar_read := _read_json_file(_resolve_pack_path(pack_root, str(structures_path)))
	if not sidecar_read.ok:
		errors.append(sidecar_read.error)
		return validated
	var sidecar: Dictionary = sidecar_read.value
	var top_keys := ["schema_version", "pack", "world_spec", "places", "coordinate_space", "resolution_algorithm", "atlas", "structures"]
	if not _has_exact_keys(sidecar, top_keys):
		errors.append("Structures sidecar must use the exact schema 0.1.0 top-level fields.")
		return validated
	if sidecar.get("schema_version") != expected_schema_version:
		errors.append("Structures sidecar schema_version must be %s." % expected_schema_version)
	var manifest_pack: Dictionary = manifest.get("pack", {})
	var pack := _dictionary_at(sidecar, "pack", errors)
	if not _has_exact_keys(pack, ["id", "version"]) or pack.get("id") != prepared.pack_id or pack.get("version") != manifest_pack.get("version"):
		errors.append("Structures sidecar pack identity must match the schema %s manifest." % prepared.schema_version)
	var world_ref := _dictionary_at(sidecar, "world_spec", errors)
	var world_record: Dictionary = file_index.get(world_path, {})
	if not _has_exact_keys(world_ref, ["path", "sha256"]) or world_ref.get("path") != world_path or world_ref.get("sha256") != world_record.get("sha256"):
		errors.append("Structures sidecar world_spec reference must match the manifest-bound World Spec.")
	var places_ref := _dictionary_at(sidecar, "places", errors)
	var manifest_places_ref: Dictionary = runtime.get("places", {})
	if not _has_exact_keys(places_ref, ["path", "sha256"]) or places_ref.get("path") != manifest_places_ref.get("path") or places_ref.get("sha256") != manifest_places_ref.get("sha256"):
		errors.append("Structures sidecar places reference must match runtime.places.")
	var coordinate := _dictionary_at(sidecar, "coordinate_space", errors)
	if not _has_exact_keys(coordinate, ["origin", "unit", "tile_size"]) or coordinate.get("origin") != "top-left" or coordinate.get("unit") != "cell" or coordinate.get("tile_size") != prepared.tile_size.x:
		errors.append("Structures coordinate_space must be top-left cells using the World Spec tile size.")
	var algorithm := _dictionary_at(sidecar, "resolution_algorithm", errors)
	if not _has_exact_keys(algorithm, ["id", "version"]) or algorithm.get("id") != "mapsoo-semantic-structure-resolver" or algorithm.get("version") != "0.1.0":
		errors.append("Structures resolution_algorithm is unsupported.")
	var atlas := _dictionary_at(sidecar, "atlas", errors)
	if not _has_exact_keys(atlas, ["path", "sprite_size_px", "pivot_px"]):
		errors.append("Structures atlas must contain only path, sprite_size_px, and pivot_px.")
		return validated
	var atlas_path: Variant = atlas.get("path")
	var sprite_size := _positive_int_pair(atlas.get("sprite_size_px"), "structures atlas sprite_size_px", errors)
	var atlas_pivot := _positive_int_pair(atlas.get("pivot_px"), "structures atlas pivot_px", errors)
	var expected_size := Vector2i(prepared.tile_size.x * 2, prepared.tile_size.y * 2)
	var expected_pivot := Vector2i(prepared.tile_size.x, prepared.tile_size.y * 2)
	if atlas_path != "atlases/structures.png" or sprite_size != expected_size or atlas_pivot != expected_pivot:
		errors.append("Structures atlas must use canonical two-cell sprites and a bottom-center pivot.")
	if not prepared.textures.has(atlas_path):
		errors.append("Structures atlas must be loaded through a declared manifest atlas or sprite.")
	else:
		var texture: Texture2D = prepared.textures[atlas_path]
		if texture.get_width() != expected_size.x * STRUCTURE_ARCHETYPES.size() or texture.get_height() != expected_size.y:
			errors.append("Structures atlas dimensions must be a single ordered row of four two-cell sprites.")

	var authored_value: Variant = world_spec.get("structures", [])
	var resolved_value: Variant = sidecar.get("structures")
	if typeof(authored_value) != TYPE_ARRAY or typeof(resolved_value) != TYPE_ARRAY:
		errors.append("Alpha.6 World Spec structures and runtime structures must be arrays.")
		return validated
	var authored: Array = authored_value
	var resolved: Array = resolved_value
	if authored.size() > MAX_STRUCTURE_COUNT or resolved.size() != authored.size():
		errors.append("Runtime structures must be an exact, ordered projection of at most %d World Spec structures." % MAX_STRUCTURE_COUNT)
		return validated
	var places_by_id := {}
	for place_value: Variant in prepared.places:
		var place: Dictionary = place_value
		places_by_id[place.id] = place
	var ids := {}
	var used_places := {}
	for index: int in resolved.size():
		var authored_item: Variant = authored[index]
		var resolved_item: Variant = resolved[index]
		if typeof(authored_item) != TYPE_DICTIONARY or typeof(resolved_item) != TYPE_DICTIONARY:
			errors.append("Every authored and resolved structure must be an object.")
			continue
		var declaration: Dictionary = authored_item
		var structure: Dictionary = resolved_item
		if not _has_exact_keys(declaration, ["id", "placeId", "archetype"]):
			errors.append("World Spec structure %d must use the exact Alpha.6 fields." % index)
			continue
		var entry_keys := ["id", "order", "place_id", "archetype", "sprite_id", "cell", "pixel_center", "region_px", "pivot_px"]
		if not _has_exact_keys(structure, entry_keys):
			errors.append("Resolved structure %d must use the exact sidecar fields." % index)
			continue
		var structure_id: Variant = structure.get("id")
		var place_id: Variant = structure.get("place_id")
		var archetype: Variant = structure.get("archetype")
		var sprite_id: Variant = structure.get("sprite_id")
		if typeof(structure_id) != TYPE_STRING or not _is_place_id(structure_id) or ids.has(structure_id):
			errors.append("Structure IDs must be unique lowercase kebab-case identifiers of at most 64 characters.")
			continue
		ids[structure_id] = true
		if not _is_json_integer(structure.get("order")) or int(structure.order) != index:
			errors.append("Structure %s order must equal its zero-based array index." % structure_id)
		if typeof(place_id) != TYPE_STRING or not places_by_id.has(place_id) or used_places.has(place_id):
			errors.append("Structure %s must reference one unique resolved place_id." % structure_id)
			continue
		used_places[place_id] = true
		if typeof(archetype) != TYPE_STRING or archetype not in STRUCTURE_ARCHETYPES:
			errors.append("Structure %s archetype is unsupported." % structure_id)
			continue
		var expected_sprite_id := "structure-%s-01" % archetype
		if sprite_id != expected_sprite_id or not prepared.sprites.has(sprite_id) or prepared.sprites[sprite_id].atlas != atlas_path:
			errors.append("Structure %s must reference its archetype-matched sprite in atlases/structures.png." % structure_id)
		if declaration.get("id") != structure_id or declaration.get("placeId") != place_id or declaration.get("archetype") != archetype:
			errors.append("Resolved structure %s does not exactly match its World Spec declaration." % structure_id)
		var place: Dictionary = places_by_id[place_id]
		var cell := _dictionary_at(structure, "cell", errors)
		var pixel_center := _dictionary_at(structure, "pixel_center", errors)
		if not _has_exact_keys(cell, ["x", "y"]) or not _has_exact_keys(pixel_center, ["x", "y"]):
			errors.append("Structure %s cell and pixel_center must contain only x/y." % structure_id)
			continue
		var point := Vector2i(int(cell.get("x", -1)), int(cell.get("y", -1)))
		var center := Vector2(int(pixel_center.get("x", -1)), int(pixel_center.get("y", -1)))
		if not _is_json_integer(cell.get("x")) or not _is_json_integer(cell.get("y")) or point != place.cell:
			errors.append("Structure %s cell must equal its referenced resolved place cell." % structure_id)
		if not _is_json_integer(pixel_center.get("x")) or not _is_json_integer(pixel_center.get("y")) or center != place.pixel_center:
			errors.append("Structure %s pixel_center must equal its referenced resolved place center." % structure_id)
		var archetype_index := STRUCTURE_ARCHETYPES.find(archetype)
		var expected_region := Rect2(archetype_index * expected_size.x, 0, expected_size.x, expected_size.y)
		var region := _int_quad(structure.get("region_px"), "structure region_px", errors)
		var pivot := _positive_int_pair(structure.get("pivot_px"), "structure pivot_px", errors)
		if region != expected_region or pivot != expected_pivot:
			errors.append("Structure %s region_px and pivot_px must match its canonical atlas slot." % structure_id)
		if prepared.sprites.has(sprite_id):
			var sprite_def: Dictionary = prepared.sprites[sprite_id]
			if sprite_def.region != region or sprite_def.pivot != pivot:
				errors.append("Structure %s sidecar region and pivot must match manifest.sprites." % structure_id)
		validated.append({
			"id": structure_id, "order": index, "place_id": place_id, "archetype": archetype,
			"sprite_id": sprite_id, "cell": point, "pixel_center": center,
			"region": region, "pivot": Vector2(pivot), "atlas": atlas_path,
		})
	return validated


static func _validate_place_tags(value: Variant, place_id: String, errors: Array[String]) -> Array:
	var tags: Array = []
	if typeof(value) != TYPE_ARRAY or value.size() > 8:
		errors.append("Place %s tags must be an array of at most eight identifiers." % place_id)
		return tags
	var seen := {}
	for tag: Variant in value:
		if typeof(tag) != TYPE_STRING or not _is_place_tag(tag) or seen.has(tag):
			errors.append("Place %s tags must be unique lowercase kebab-case identifiers." % place_id)
			continue
		seen[tag] = true
		tags.append(tag)
	return tags


static func _place_satisfies_placement(cell: Vector2i, placement: String, prepared: Dictionary) -> bool:
	if placement == "center":
		return true
	if placement == "map-edge":
		return cell.x == 0 or cell.y == 0 or cell.x == prepared.width - 1 or cell.y == prepared.height - 1
	if placement == "on-road":
		return prepared.layer_cells.roads[cell.y * prepared.width + cell.x] != -1
	if placement == "near-water":
		for offset: Vector2i in [Vector2i.UP, Vector2i.RIGHT, Vector2i.DOWN, Vector2i.LEFT]:
			var neighbor := cell + offset
			if neighbor.x >= 0 and neighbor.y >= 0 and neighbor.x < prepared.width and neighbor.y < prepared.height and prepared.layer_cells.water[neighbor.y * prepared.width + neighbor.x] != -1:
				return true
	return false


static func _resolve_expected_place_cell(placement: String, prepared: Dictionary, occupied: Dictionary) -> Dictionary:
	var best_cell := Vector2i.ZERO
	var best_score := 0
	var found := false
	var width: int = prepared.width
	var height: int = prepared.height
	for y: int in height:
		for x: int in width:
			var cell := Vector2i(x, y)
			if occupied.has("%d,%d" % [x, y]):
				continue
			var index := y * width + x
			var ground_tile_id: int = prepared.layer_cells.ground[index]
			var walkable: bool = (
				prepared.layer_cells.water[index] == -1
				and ground_tile_id != -1
				and prepared.tile_lookup.has(ground_tile_id)
				and prepared.tile_lookup[ground_tile_id].walkable == true
			)
			if not walkable or not _place_satisfies_placement(cell, placement, prepared):
				continue
			var dx := x * 2 - (width - 1)
			var dy := y * 2 - (height - 1)
			var score := dx * dx + dy * dy
			if not found or score < best_score or (score == best_score and (y < best_cell.y or (y == best_cell.y and x < best_cell.x))):
				found = true
				best_score = score
				best_cell = cell
	return {"ok": found, "cell": best_cell}


static func _validate_file_records(value: Variant, pack_root: String, errors: Array[String]) -> Dictionary:
	var index := {}
	if typeof(value) != TYPE_ARRAY:
		errors.append("manifest.files must be an array.")
		return index
	if value.size() > MAX_FILE_COUNT:
		errors.append("manifest.files exceeds the importer limit of %d files." % MAX_FILE_COUNT)
		return index
	var total_bytes := 0
	for record_value: Variant in value:
		if typeof(record_value) != TYPE_DICTIONARY:
			errors.append("Each manifest.files entry must be an object.")
			continue
		var record: Dictionary = record_value
		var path_value: Variant = record.get("path")
		if typeof(path_value) != TYPE_STRING or not _is_safe_relative_path(path_value):
			errors.append("manifest.files contains an unsafe path: %s" % path_value)
			continue
		var relative_path: String = path_value
		if index.has(relative_path):
			errors.append("Duplicate manifest.files path: %s" % relative_path)
			continue
		var absolute_path := _resolve_pack_path(pack_root, relative_path)
		if not FileAccess.file_exists(absolute_path):
			errors.append("Missing pack file: %s" % relative_path)
			continue
		var expected_hash: Variant = record.get("sha256")
		if typeof(expected_hash) != TYPE_STRING or not _is_sha256(expected_hash):
			errors.append("Invalid SHA-256 value for %s." % relative_path)
			continue
		var expected_bytes: Variant = record.get("bytes")
		if not _is_json_integer(expected_bytes) or expected_bytes < 0:
			errors.append("Invalid byte length for %s." % relative_path)
			continue
		if expected_bytes > MAX_FILE_BYTES:
			errors.append("Pack file exceeds the %d-byte per-file limit: %s" % [MAX_FILE_BYTES, relative_path])
			continue
		total_bytes += int(expected_bytes)
		if total_bytes > MAX_TOTAL_BYTES:
			errors.append("Pack payload exceeds the %d-byte total limit." % MAX_TOTAL_BYTES)
			return index
		var file := FileAccess.open(absolute_path, FileAccess.READ)
		if file == null:
			errors.append("Unable to open pack file: %s" % relative_path)
			continue
		if file.get_length() != int(expected_bytes):
			errors.append("Byte length mismatch for %s." % relative_path)
			file.close()
			continue
		file.close()
		var actual_hash := _sha256_file(absolute_path)
		if actual_hash != expected_hash:
			errors.append("SHA-256 mismatch for %s." % relative_path)
			continue
		index[relative_path] = record
	return index


static func _collect_referenced_paths(manifest: Dictionary, errors: Array[String]) -> Array[String]:
	var paths: Array[String] = []
	var refs: Array = []
	var world_spec: Variant = manifest.get("world_spec")
	var demo: Variant = manifest.get("demo")
	var receipt: Variant = manifest.get("receipt")
	var license: Variant = manifest.get("license")
	var runtime: Variant = manifest.get("runtime")
	if typeof(world_spec) == TYPE_DICTIONARY: refs.append(world_spec.get("path"))
	if typeof(demo) == TYPE_DICTIONARY:
		refs.append(demo.get("map"))
		refs.append(demo.get("preview"))
	if typeof(receipt) == TYPE_DICTIONARY: refs.append(receipt.get("path"))
	if typeof(license) == TYPE_DICTIONARY:
		var asset_license: Variant = license.get("assets")
		if typeof(asset_license) == TYPE_DICTIONARY: refs.append(asset_license.get("file"))
	if typeof(runtime) == TYPE_DICTIONARY:
		var places: Variant = runtime.get("places")
		if typeof(places) == TYPE_DICTIONARY:
			refs.append(places.get("path"))
			var places_schema: Variant = places.get("schema")
			if typeof(places_schema) == TYPE_DICTIONARY: refs.append(places_schema.get("path"))
		var structures: Variant = runtime.get("structures")
		if typeof(structures) == TYPE_DICTIONARY:
			refs.append(structures.get("path"))
			var structures_schema: Variant = structures.get("schema")
			if typeof(structures_schema) == TYPE_DICTIONARY: refs.append(structures_schema.get("path"))
	for layer_value: Variant in manifest.get("layers", []):
		if typeof(layer_value) == TYPE_DICTIONARY:
			refs.append(layer_value.get("path"))
			if layer_value.has("sprite_atlas"): refs.append(layer_value.get("sprite_atlas"))
	for atlas_value: Variant in manifest.get("atlases", []):
		if typeof(atlas_value) == TYPE_DICTIONARY: refs.append(atlas_value.get("file"))
	for sprite_value: Variant in manifest.get("sprites", []):
		if typeof(sprite_value) == TYPE_DICTIONARY: refs.append(sprite_value.get("atlas"))
	for value: Variant in refs:
		if typeof(value) != TYPE_STRING or not _is_safe_relative_path(value):
			errors.append("Manifest contains an unsafe referenced path: %s" % value)
		elif not paths.has(value):
			paths.append(value)
	return paths


static func _configure_terrain_sets(tile_set: TileSet, value: Variant, errors: Array[String]) -> Dictionary:
	var lookup := {}
	if typeof(value) != TYPE_ARRAY or value.size() != 2:
		errors.append("Schema 0.2.0 requires exactly the water and roads terrain sets.")
		return lookup
	var expected_sets: Array[String] = ["water", "roads"]
	var expected_terrains: Array[String] = ["water", "road"]
	for set_index: int in expected_sets.size():
		var set_value: Variant = value[set_index]
		if typeof(set_value) != TYPE_DICTIONARY:
			errors.append("Terrain set %d must be an object." % set_index)
			continue
		var terrain_set: Dictionary = set_value
		var set_id := expected_sets[set_index]
		if terrain_set.get("id") != set_id or terrain_set.get("mode") != "match-sides":
			errors.append("Terrain set %d must be ordered %s with match-sides mode." % [set_index, set_id])
			continue
		var terrains_value: Variant = terrain_set.get("terrains")
		if typeof(terrains_value) != TYPE_ARRAY or terrains_value.size() != 1 or typeof(terrains_value[0]) != TYPE_DICTIONARY:
			errors.append("Terrain set %s must contain exactly one terrain." % set_id)
			continue
		var terrain: Dictionary = terrains_value[0]
		var terrain_id := expected_terrains[set_index]
		var terrain_name: Variant = terrain.get("name")
		var color_value: Variant = terrain.get("color")
		if terrain.get("id") != terrain_id or typeof(terrain_name) != TYPE_STRING or terrain_name.is_empty() or typeof(color_value) != TYPE_STRING or not _is_hex_color(color_value):
			errors.append("Terrain set %s has an invalid terrain id, name, or #RRGGBB color." % set_id)
			continue
		tile_set.add_terrain_set(set_index)
		tile_set.set_terrain_set_mode(set_index, TileSet.TERRAIN_MODE_MATCH_SIDES)
		tile_set.add_terrain(set_index, 0)
		tile_set.set_terrain_name(set_index, 0, terrain_name)
		tile_set.set_terrain_color(set_index, 0, Color.html(color_value))
		lookup[set_id] = {"set_index": set_index, "terrains": {terrain_id: 0}}
	return lookup


static func _configure_physics_layers(tile_set: TileSet, value: Variant, errors: Array[String]) -> Dictionary:
	var lookup := {}
	if typeof(value) != TYPE_ARRAY or value.size() != 1 or typeof(value[0]) != TYPE_DICTIONARY:
		errors.append("Schema 0.2.0 requires exactly one world-blocking physics layer.")
		return lookup
	var layer: Dictionary = value[0]
	if layer.get("id") != "world-blocking" or layer.get("collision_layer") != 1 or layer.get("collision_mask") != 1:
		errors.append("The world-blocking physics layer must use collision layer/mask 1.")
		return lookup
	var layer_index := 0
	tile_set.add_physics_layer(layer_index)
	var collision_layer: int = layer.collision_layer
	var collision_mask: int = layer.collision_mask
	tile_set.set_physics_layer_collision_layer(layer_index, collision_layer)
	tile_set.set_physics_layer_collision_mask(layer_index, collision_mask)
	lookup["world-blocking"] = {"layer_index": layer_index}
	return lookup


static func _validate_tile_metadata(
	tile: Dictionary,
	tile_id: int,
	schema_version: String,
	terrain_sets: Dictionary,
	physics_layers: Dictionary,
	errors: Array[String]
) -> Dictionary:
	var result := {
		"ok": false,
		"terrain_set_id": "",
		"terrain_set_index": -1,
		"terrain_index": -1,
		"peering": {},
		"collision_type": "",
		"physics_layer_index": -1,
	}
	var collision_value: Variant = tile.get("collision")
	if typeof(collision_value) != TYPE_DICTIONARY:
		errors.append("Tile %d collision must be an object." % tile_id)
		return result
	var collision: Dictionary = collision_value
	if schema_version == LEGACY_SCHEMA_VERSION:
		if collision.get("type") != "none":
			errors.append("Tile %d collision must be {type: none} in schema 0.1.0." % tile_id)
			return result
		result.ok = true
		result.collision_type = "none"
		return result

	var terrain_value: Variant = tile.get("terrain")
	if terrain_value != null:
		if typeof(terrain_value) != TYPE_DICTIONARY:
			errors.append("Tile %d terrain must be null or an object." % tile_id)
			return result
		var terrain: Dictionary = terrain_value
		var set_id: Variant = terrain.get("set_id")
		var terrain_id: Variant = terrain.get("terrain_id")
		if typeof(set_id) != TYPE_STRING or not terrain_sets.has(set_id):
			errors.append("Tile %d references an unknown terrain set." % tile_id)
			return result
		var set_definition: Dictionary = terrain_sets[set_id]
		if typeof(terrain_id) != TYPE_STRING or not set_definition.terrains.has(terrain_id):
			errors.append("Tile %d references an unknown terrain in set %s." % [tile_id, set_id])
			return result
		var peering_value: Variant = terrain.get("peering")
		if typeof(peering_value) != TYPE_DICTIONARY:
			errors.append("Tile %d terrain peering must contain north/east/south/west." % tile_id)
			return result
		var peering: Dictionary = peering_value
		var sides := {
			"north": TileSet.CELL_NEIGHBOR_TOP_SIDE,
			"east": TileSet.CELL_NEIGHBOR_RIGHT_SIDE,
			"south": TileSet.CELL_NEIGHBOR_BOTTOM_SIDE,
			"west": TileSet.CELL_NEIGHBOR_LEFT_SIDE,
		}
		if peering.size() != 4:
			errors.append("Tile %d terrain peering must contain only north/east/south/west." % tile_id)
			return result
		for side: String in sides:
			if not peering.has(side) or (peering[side] != null and peering[side] != terrain_id):
				errors.append("Tile %d has invalid %s terrain peering." % [tile_id, side])
				return result
			result.peering[sides[side]] = -1 if peering[side] == null else int(set_definition.terrains[terrain_id])
		result.terrain_set_id = set_id
		result.terrain_set_index = int(set_definition.set_index)
		result.terrain_index = int(set_definition.terrains[terrain_id])

	var collision_type: Variant = collision.get("type")
	if collision_type == "none":
		result.collision_type = "none"
	elif collision_type == "full-cell":
		var physics_id: Variant = collision.get("physics_layer")
		if typeof(physics_id) != TYPE_STRING or not physics_layers.has(physics_id):
			errors.append("Tile %d references an unknown physics layer." % tile_id)
			return result
		result.collision_type = "full-cell"
		result.physics_layer_index = int(physics_layers[physics_id].layer_index)
	else:
		errors.append("Tile %d collision type is unsupported." % tile_id)
		return result
	if result.terrain_set_id == "water" and result.collision_type != "full-cell":
		errors.append("Water tile %d must use full-cell collision." % tile_id)
		return result
	if result.terrain_set_id != "water" and result.collision_type != "none":
		errors.append("Only water terrain tiles may use full-cell collision (tile %d)." % tile_id)
		return result
	result.ok = true
	return result


static func _build_tile_set(
	value: Variant,
	pack_root: String,
	errors: Array[String],
	schema_version: String,
	terrain_sets_value: Variant,
	physics_layers_value: Variant
) -> Dictionary:
	var tile_set := TileSet.new()
	tile_set.add_custom_data_layer()
	tile_set.set_custom_data_layer_name(0, "walkable")
	tile_set.set_custom_data_layer_type(0, TYPE_BOOL)
	tile_set.add_custom_data_layer()
	tile_set.set_custom_data_layer_name(1, "biome")
	tile_set.set_custom_data_layer_type(1, TYPE_STRING)
	var tile_lookup := {}
	var atlas_ids := {}
	var textures := {}
	var expected_tile_size := Vector2i.ZERO
	var source_ids := {}
	var terrain_sets := {}
	var physics_layers := {}
	if _has_playable_terrain(schema_version):
		terrain_sets = _configure_terrain_sets(tile_set, terrain_sets_value, errors)
		physics_layers = _configure_physics_layers(tile_set, physics_layers_value, errors)
		if not errors.is_empty():
			return {"tile_set": tile_set, "tile_lookup": tile_lookup, "atlas_ids": atlas_ids, "textures": textures, "tile_size": expected_tile_size}
	if typeof(value) != TYPE_ARRAY or value.is_empty():
		errors.append("manifest.atlases must contain at least one atlas.")
		return {"tile_set": tile_set, "tile_lookup": tile_lookup, "atlas_ids": atlas_ids, "textures": textures, "tile_size": expected_tile_size}
	if value.size() > MAX_ATLAS_COUNT:
		errors.append("manifest.atlases exceeds the importer limit of %d atlases." % MAX_ATLAS_COUNT)
		return {"tile_set": tile_set, "tile_lookup": tile_lookup, "atlas_ids": atlas_ids, "textures": textures, "tile_size": expected_tile_size}
	for atlas_value: Variant in value:
		if typeof(atlas_value) != TYPE_DICTIONARY:
			errors.append("Each atlas entry must be an object.")
			continue
		var atlas: Dictionary = atlas_value
		var atlas_id: Variant = atlas.get("id")
		if typeof(atlas_id) != TYPE_STRING or not _is_asset_id(atlas_id) or atlas_ids.has(atlas_id):
			errors.append("Atlas IDs must be unique lowercase ASCII identifiers.")
			continue
		atlas_ids[atlas_id] = true
		var source_id_value: Variant = atlas.get("source_id")
		if not _is_json_integer(source_id_value) or source_id_value < 0:
			errors.append("Atlas source_id must be a unique non-negative integer.")
			continue
		var source_id := int(source_id_value)
		if source_ids.has(source_id):
			errors.append("Atlas source_id must be a unique non-negative integer.")
			continue
		source_ids[source_id] = true
		var atlas_path: Variant = atlas.get("file")
		if typeof(atlas_path) != TYPE_STRING or not _is_safe_relative_path(atlas_path):
			errors.append("Atlas file path is unsafe.")
			continue
		var pair_error_count := errors.size()
		var cell_size := _positive_int_pair(atlas.get("cell_size_px"), "atlas cell_size_px", errors)
		var margins := _non_negative_int_pair(atlas.get("margin_px"), "atlas margin_px", errors)
		var separation := _non_negative_int_pair(atlas.get("separation_px"), "atlas separation_px", errors)
		if errors.size() != pair_error_count:
			continue
		if expected_tile_size == Vector2i.ZERO:
			expected_tile_size = cell_size
			tile_set.tile_size = cell_size
		elif cell_size != expected_tile_size:
			errors.append("All Mapsoo atlases must use one cell size.")
		pair_error_count = errors.size()
		var declared_size := _positive_int_pair(atlas.get("image_size_px"), "atlas image_size_px", errors)
		if errors.size() != pair_error_count:
			continue
		var texture: PortableCompressedTexture2D
		if textures.has(atlas_path):
			texture = textures[atlas_path]
			if Vector2i(texture.get_width(), texture.get_height()) != declared_size:
				errors.append("Atlas image dimensions do not match manifest: %s" % atlas_path)
				continue
		else:
			var image_result := _load_png(_resolve_pack_path(pack_root, atlas_path))
			if not image_result.ok:
				errors.append(image_result.error)
				continue
			var image: Image = image_result.image
			if image.get_size() != declared_size:
				errors.append("Atlas image dimensions do not match manifest: %s" % atlas_path)
				continue
			texture = _texture_from_image(image)
			textures[atlas_path] = texture
		var source := TileSetAtlasSource.new()
		source.texture = texture
		source.texture_region_size = cell_size
		source.margins = margins
		source.separation = separation
		if typeof(atlas.get("texture_padding")) != TYPE_BOOL:
			errors.append("Atlas texture_padding must be a boolean.")
			continue
		source.use_texture_padding = atlas.texture_padding
		var tiles_value: Variant = atlas.get("tiles")
		if typeof(tiles_value) != TYPE_ARRAY:
			errors.append("Atlas tiles must be an array.")
			continue
		if tiles_value.size() > MAX_TILE_COUNT:
			errors.append("Atlas exceeds the importer limit of %d tiles." % MAX_TILE_COUNT)
			continue
		var pending_tile_data: Array[Dictionary] = []
		for tile_value: Variant in tiles_value:
			if typeof(tile_value) != TYPE_DICTIONARY:
				errors.append("Each atlas tile must be an object.")
				continue
			var tile: Dictionary = tile_value
			var tile_id_value: Variant = tile.get("tile_id")
			var alternative_id_value: Variant = tile.get("alternative_id")
			if not _is_json_integer(tile_id_value) or tile_id_value < 0:
				errors.append("tile_id must be a unique non-negative integer.")
				continue
			var tile_id := int(tile_id_value)
			if tile_lookup.has(tile_id):
				errors.append("tile_id must be a unique non-negative integer.")
				continue
			if not _is_json_integer(alternative_id_value) or alternative_id_value < 0:
				errors.append("alternative_id must be a non-negative integer.")
				continue
			var alternative_id := int(alternative_id_value)
			var tile_pair_error_count := errors.size()
			var coords := _non_negative_int_pair(tile.get("atlas_coords"), "tile atlas_coords", errors)
			var size_cells := _positive_int_pair(tile.get("size_cells"), "tile size_cells", errors)
			if errors.size() != tile_pair_error_count:
				continue
			var tile_metadata := _validate_tile_metadata(
				tile,
				tile_id,
				schema_version,
				terrain_sets,
				physics_layers,
				errors
			)
			if not tile_metadata.ok:
				continue
			if not source.has_room_for_tile(coords, size_cells, 1, Vector2i.ZERO, 1):
				errors.append("Atlas tile does not fit or overlaps at %s." % coords)
				continue
			source.create_tile(coords, size_cells)
			if alternative_id > 0 and source.create_alternative_tile(coords, alternative_id) != alternative_id:
				errors.append("Unable to create alternative tile %d at %s." % [alternative_id, coords])
				continue
			var custom_data_value: Variant = tile.get("custom_data")
			if typeof(custom_data_value) != TYPE_DICTIONARY or typeof(custom_data_value.get("walkable")) != TYPE_BOOL or typeof(custom_data_value.get("biome")) != TYPE_STRING:
				errors.append("Tile %d custom_data must contain boolean walkable and string biome." % tile_id)
				continue
			pending_tile_data.append({
				"tile_id": tile_id,
				"coords": coords,
				"alternative_id": alternative_id,
				"walkable": custom_data_value.walkable,
				"biome": custom_data_value.biome,
				"terrain_set_id": tile_metadata.terrain_set_id,
				"terrain_set_index": tile_metadata.terrain_set_index,
				"terrain_index": tile_metadata.terrain_index,
				"peering": tile_metadata.peering,
				"collision_type": tile_metadata.collision_type,
				"physics_layer_index": tile_metadata.physics_layer_index,
			})
			tile_lookup[tile_id] = {
				"atlas_id": atlas_id,
				"source_id": source_id,
				"coords": coords,
				"alternative_id": alternative_id,
				"terrain_set_id": tile_metadata.terrain_set_id,
				"collision_type": tile_metadata.collision_type,
				"walkable": custom_data_value.walkable,
			}
		if tile_set.add_source(source, source_id) != source_id:
			errors.append("Unable to preserve atlas source_id %d." % source_id)
			continue
		for pending: Dictionary in pending_tile_data:
			var tile_data := source.get_tile_data(pending.coords, pending.alternative_id)
			if tile_data == null:
				errors.append("Unable to access TileData for tile %d." % pending.tile_id)
				continue
			tile_data.set_custom_data("walkable", pending.walkable)
			tile_data.set_custom_data("biome", pending.biome)
			if pending.terrain_set_index >= 0:
				tile_data.set_terrain_set(pending.terrain_set_index)
				tile_data.set_terrain(pending.terrain_index)
				for neighbor: int in pending.peering:
					tile_data.set_terrain_peering_bit(neighbor, int(pending.peering[neighbor]))
			if pending.collision_type == "full-cell":
				tile_data.set_collision_polygons_count(pending.physics_layer_index, 1)
				var half_size := Vector2(expected_tile_size) * 0.5
				tile_data.set_collision_polygon_points(
					pending.physics_layer_index,
					0,
					PackedVector2Array([
						Vector2(-half_size.x, -half_size.y),
						Vector2(half_size.x, -half_size.y),
						Vector2(half_size.x, half_size.y),
						Vector2(-half_size.x, half_size.y),
					])
				)
	return {"tile_set": tile_set, "tile_lookup": tile_lookup, "atlas_ids": atlas_ids, "textures": textures, "tile_size": expected_tile_size}


static func _validate_sprites(value: Variant, pack_root: String, texture_cache: Dictionary, errors: Array[String]) -> Dictionary:
	var sprites := {}
	var textures := texture_cache.duplicate()
	if typeof(value) != TYPE_ARRAY:
		errors.append("manifest.sprites must be an array.")
		return {"sprites": sprites, "textures": textures}
	if value.size() > MAX_SPRITE_COUNT:
		errors.append("manifest.sprites exceeds the importer limit of %d sprites." % MAX_SPRITE_COUNT)
		return {"sprites": sprites, "textures": textures}
	for sprite_value: Variant in value:
		if typeof(sprite_value) != TYPE_DICTIONARY:
			errors.append("Each sprite entry must be an object.")
			continue
		var sprite: Dictionary = sprite_value
		var sprite_id: Variant = sprite.get("id")
		var atlas_path: Variant = sprite.get("atlas")
		if typeof(sprite_id) != TYPE_STRING or not _is_asset_id(sprite_id) or sprites.has(sprite_id):
			errors.append("Sprite IDs must be unique lowercase ASCII identifiers.")
			continue
		if typeof(atlas_path) != TYPE_STRING or not _is_safe_relative_path(atlas_path):
			errors.append("Sprite atlas path is unsafe.")
			continue
		if not textures.has(atlas_path):
			var image_result := _load_png(_resolve_pack_path(pack_root, atlas_path))
			if not image_result.ok:
				errors.append(image_result.error)
				continue
			textures[atlas_path] = _texture_from_image(image_result.image)
		var region := _int_quad(sprite.get("region_px"), "sprite region_px", errors)
		var pivot := _non_negative_int_pair(sprite.get("pivot_px"), "sprite pivot_px", errors)
		if region.size != Vector2.ZERO:
			var texture: Texture2D = textures[atlas_path]
			if region.position.x < 0 or region.position.y < 0 or region.end.x > texture.get_width() or region.end.y > texture.get_height():
				errors.append("Sprite region is outside its atlas: %s" % sprite_id)
				continue
		sprites[sprite_id] = {"atlas": atlas_path, "region": region, "pivot": pivot}
	return {"sprites": sprites, "textures": textures}


static func _validate_props(
	props: Array,
	sprites: Dictionary,
	layer_atlas: Variant,
	width: int,
	height: int,
	schema_version: String,
	errors: Array[String]
) -> void:
	if typeof(layer_atlas) != TYPE_STRING or not _is_safe_relative_path(layer_atlas):
		errors.append("The props layer sprite_atlas path is unsafe.")
		return
	var ids := {}
	for prop_value: Variant in props:
		if typeof(prop_value) != TYPE_DICTIONARY:
			errors.append("Each prop must be an object.")
			continue
		var prop: Dictionary = prop_value
		var prop_id: Variant = prop.get("id")
		var kind: Variant = prop.get("kind")
		var x: Variant = prop.get("x")
		var y: Variant = prop.get("y")
		if typeof(prop_id) != TYPE_STRING or not _is_asset_id(prop_id) or ids.has(prop_id):
			errors.append("Prop IDs must be unique lowercase ASCII identifiers.")
			continue
		ids[prop_id] = true
		var sprite_id := _sprite_id_for_kind(str(kind), schema_version) if typeof(kind) == TYPE_STRING else ""
		if sprite_id.is_empty() or not sprites.has(sprite_id):
			errors.append("Prop %s does not have a matching versioned <kind> sprite." % prop_id)
		elif sprites[sprite_id].atlas != layer_atlas:
			errors.append("Prop %s sprite is not in the props layer atlas." % prop_id)
		if not _is_json_integer(x) or not _is_json_integer(y) or x < 0 or y < 0 or x >= width or y >= height:
			errors.append("Prop %s is outside the map bounds." % prop_id)
		else:
			prop.x = int(x)
			prop.y = int(y)


static func _alpha9_role_region(role: String) -> Rect2:
	if role.begins_with("prop."): return Rect2(ALPHA9_ROLES.slice(4, 10).find(role) * 32, 0, 32, 32)
	if role == "structure.house": return Rect2(0, 0, 64, 64)
	if role == "structure.barn": return Rect2(64, 0, 64, 64)
	if role.begins_with("crop.basic.stage-"): return Rect2((int(role.trim_prefix("crop.basic.stage-")) - 1) * 32, 0, 32, 32)
	return Rect2()


static func _alpha9_add_placement_group(root: Node2D, prepared: Dictionary, group: String, name: String, atlas_id: String, z: int) -> void:
	var container := Node2D.new(); container.name = name; container.z_index = z; container.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	root.add_child(container); container.owner = root
	var texture: Texture2D = prepared.textures[prepared.atlas_paths[atlas_id]]
	var index := 0
	for entry_value: Variant in prepared[group]:
		var entry: Dictionary = entry_value
		var region := _alpha9_role_region(entry.role)
		var atlas_texture := AtlasTexture.new(); atlas_texture.atlas = texture; atlas_texture.region = region; atlas_texture.filter_clip = true
		var sprite := Sprite2D.new(); sprite.name = "%s_%04d" % [name.trim_suffix("s"), index]; sprite.texture = atlas_texture; sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.position = Vector2((int(entry.cell[0]) + 0.5) * 32, (int(entry.cell[1]) + 1.0) * 32); sprite.offset = Vector2(0, -region.size.y * 0.5 + 16)
		sprite.set_meta("mapsoo_role", entry.role); sprite.set_meta("mapsoo_cell", Vector2i(int(entry.cell[0]), int(entry.cell[1])))
		container.add_child(sprite); sprite.owner = root; index += 1


static func _build_complete_farm_scene(prepared: Dictionary, tile_set: TileSet) -> Dictionary:
	var root := Node2D.new(); root.name = "MapsooWorld"; root.set_meta("mapsoo_pack_id", prepared.pack_id); root.set_meta("mapsoo_profile", "topdown-farm")
	var width: int = prepared.width
	var layer_names := {"ground": "Ground", "water": "Water", "path": "Paths", "soil": "Soil"}
	for layer_index: int in prepared.tile_layer_ids.size():
		var layer_id: String = prepared.tile_layer_ids[layer_index]
		var layer := TileMapLayer.new(); layer.name = layer_names[layer_id]; layer.tile_set = tile_set; layer.z_index = layer_index; layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		root.add_child(layer); layer.owner = root
		var cells: Array = prepared.layer_cells[layer_id]
		for index: int in cells.size():
			var tile_id := int(cells[index]); if tile_id >= 0: layer.set_cell(Vector2i(index % width, index / width), 0, Vector2i(tile_id, 0), 0)
	_alpha9_add_placement_group(root, prepared, "props", "Props", "props", 4)
	_alpha9_add_placement_group(root, prepared, "structures", "Structures", "structures", 5)
	_alpha9_add_placement_group(root, prepared, "crops", "Crops", "crops", 6)

	var navigation_region := NavigationRegion2D.new(); navigation_region.name = "WorldNavigation"
	var polygon := NavigationPolygon.new()
	for outline_value: Variant in prepared.navigation_outlines:
		if typeof(outline_value) != TYPE_ARRAY or outline_value.size() < 3: continue
		var outline := PackedVector2Array()
		for point: Variant in outline_value:
			var pair := _non_negative_int_pair(point, "navigation point", prepared.errors); outline.append(Vector2(pair.x, pair.y))
		polygon.add_outline(outline)
	polygon.make_polygons_from_outlines(); navigation_region.navigation_polygon = polygon
	root.add_child(navigation_region); navigation_region.owner = root

	var collisions_root := StaticBody2D.new(); collisions_root.name = "WorldCollision"; collisions_root.collision_layer = 1; collisions_root.collision_mask = 1; root.add_child(collisions_root); collisions_root.owner = root
	for index: int in prepared.collisions.size():
		var cell: Array = prepared.collisions[index]
		var shape_node := CollisionShape2D.new(); shape_node.name = "Blocked_%04d" % index; shape_node.position = Vector2((int(cell[0]) + 0.5) * 32, (int(cell[1]) + 0.5) * 32)
		var shape := RectangleShape2D.new(); shape.size = Vector2(32, 32); shape_node.shape = shape; collisions_root.add_child(shape_node); shape_node.owner = root

	var spawn := Marker2D.new(); spawn.name = "PlayerSpawn"; spawn.position = Vector2((prepared.spawn.x + 0.5) * 32, (prepared.spawn.y + 0.5) * 32); root.add_child(spawn); spawn.owner = root
	var player := CharacterBody2D.new(); player.name = "Player"; player.position = spawn.position; player.collision_layer = 1; player.collision_mask = 1; root.add_child(player); player.owner = root
	player.set_script(PlayerController); player.set("mapsoo_profile", "topdown-farm"); player.set("world_bounds", Rect2(0, 0, prepared.width * 32, prepared.height * 32)); player.set("spawn_position", spawn.position)
	var frames := SpriteFrames.new(); frames.remove_animation("default")
	var atlas: Texture2D = prepared.textures[prepared.atlas_paths.character]
	for clip_value: Variant in prepared.character.clips:
		var clip: Dictionary = clip_value; var animation_name := str(clip.id).replace(".", "_"); frames.add_animation(animation_name); frames.set_animation_speed(animation_name, float(clip.fps)); frames.set_animation_loop(animation_name, true)
		for frame_value: Variant in clip.frames:
			var frame: Dictionary = frame_value; var texture := AtlasTexture.new(); texture.atlas = atlas; texture.region = Rect2(int(frame.x), int(frame.y), 32, 32); texture.filter_clip = true; frames.add_frame(animation_name, texture)
	var visual := AnimatedSprite2D.new(); visual.name = "Visual"; visual.sprite_frames = frames; visual.animation = "idle_south"; visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST; visual.offset = Vector2(16 - float(prepared.character.pivot[0]), 16 - float(prepared.character.pivot[1])); visual.set_meta("mapsoo_runtime_slot_id", "player")
	player.add_child(visual); visual.owner = root
	var player_collision := CollisionShape2D.new(); player_collision.name = "CollisionShape2D"; var capsule := CapsuleShape2D.new(); capsule.radius = 8; capsule.height = 20; player_collision.shape = capsule; player_collision.position = Vector2(0, 6); player.add_child(player_collision); player_collision.owner = root
	var camera := Camera2D.new(); camera.name = "Camera2D"; camera.position_smoothing_enabled = false; player.add_child(camera); camera.owner = root
	return {"ok": prepared.errors.is_empty(), "root": root, "error": "Navigation data is invalid." if not prepared.errors.is_empty() else ""}


static func _build_scene(prepared: Dictionary, tile_set: TileSet) -> Dictionary:
	if prepared.schema_version == COMPLETE_FARM_SCHEMA_VERSION:
		return _build_complete_farm_scene(prepared, tile_set)
	if prepared.schema_version == SIDE_PLATFORMER_SCHEMA_VERSION:
		return Pack07.build_scene(prepared)
	if prepared.schema_version == ISOMETRIC_ACTION_SCHEMA_VERSION:
		return Pack08.build_scene(prepared)
	if prepared.schema_version == LAYERED_DEPTH_SCHEMA_VERSION:
		return Pack09.build_scene(prepared)
	if prepared.schema_version == CONTROLLED_SCHEMA_VERSION:
		return Pack10.build_scene(prepared)
	var root := Node2D.new()
	root.name = "MapsooWorld"
	root.set_meta("mapsoo_pack_id", prepared.pack_id)
	var width: int = prepared.width
	for layer_index: int in prepared.tile_layer_ids.size():
		var layer_id: String = prepared.tile_layer_ids[layer_index]
		var tile_layer := TileMapLayer.new()
		tile_layer.name = _scene_layer_name(layer_id)
		tile_layer.tile_set = tile_set
		tile_layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		tile_layer.z_index = layer_index
		root.add_child(tile_layer)
		tile_layer.owner = root
		var cells: Array = prepared.layer_cells[layer_id]
		for index: int in cells.size():
			var tile_id: int = cells[index]
			if tile_id == -1:
				continue
			var tile: Dictionary = prepared.tile_lookup[tile_id]
			tile_layer.set_cell(Vector2i(index % width, index / width), tile.source_id, tile.coords, tile.alternative_id)

	var props_root := Node2D.new()
	props_root.name = "Props"
	props_root.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	props_root.z_index = prepared.tile_layer_ids.size()
	root.add_child(props_root)
	props_root.owner = root
	var tile_size: Vector2i = prepared.tile_size
	for prop_value: Variant in prepared.props:
		var prop: Dictionary = prop_value
		var sprite_id := _sprite_id_for_kind(str(prop.kind), prepared.schema_version)
		var sprite_def: Dictionary = prepared.sprites[sprite_id]
		var atlas_texture := AtlasTexture.new()
		atlas_texture.atlas = prepared.textures[sprite_def.atlas]
		atlas_texture.region = sprite_def.region
		atlas_texture.filter_clip = true
		var sprite := Sprite2D.new()
		sprite.name = prop.id
		sprite.texture = atlas_texture
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.centered = true
		var pivot: Vector2 = sprite_def.pivot
		sprite.offset = sprite_def.region.size * 0.5 - pivot
		sprite.position = Vector2((prop.x + 0.5) * tile_size.x, (prop.y + 1.0) * tile_size.y)
		sprite.set_meta("mapsoo_id", prop.id)
		sprite.set_meta("mapsoo_kind", prop.kind)
		props_root.add_child(sprite)
		sprite.owner = root
	if _has_structures(prepared.schema_version):
		var structures_root := Node2D.new()
		structures_root.name = "Structures"
		structures_root.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		structures_root.z_index = prepared.tile_layer_ids.size() + 1
		root.add_child(structures_root)
		structures_root.owner = root
		for structure_value: Variant in prepared.structures:
			var structure: Dictionary = structure_value
			var structure_texture := AtlasTexture.new()
			structure_texture.atlas = prepared.textures[structure.atlas]
			structure_texture.region = structure.region
			structure_texture.filter_clip = true
			var structure_sprite := Sprite2D.new()
			structure_sprite.name = "Structure_%04d" % int(structure.order)
			structure_sprite.texture = structure_texture
			structure_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
			structure_sprite.centered = true
			structure_sprite.offset = structure.region.size * 0.5 - structure.pivot
			structure_sprite.position = structure.pixel_center
			structure_sprite.set_meta("mapsoo_id", structure.id)
			structure_sprite.set_meta("mapsoo_place_id", structure.place_id)
			structure_sprite.set_meta("mapsoo_archetype", structure.archetype)
			structure_sprite.set_meta("mapsoo_cell", structure.cell)
			structure_sprite.set_meta("mapsoo_order", structure.order)
			structures_root.add_child(structure_sprite)
			structure_sprite.owner = root
	if not prepared.places.is_empty():
		var places_root := Node2D.new()
		places_root.name = "Places"
		places_root.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		places_root.z_index = prepared.tile_layer_ids.size() + (2 if _has_structures(prepared.schema_version) else 1)
		root.add_child(places_root)
		places_root.owner = root
		for place_value: Variant in prepared.places:
			var place: Dictionary = place_value
			var marker := Marker2D.new()
			marker.name = "Place_%04d" % int(place.order)
			marker.position = place.pixel_center
			marker.set_meta("mapsoo_id", place.id)
			marker.set_meta("mapsoo_label", place.label)
			marker.set_meta("mapsoo_kind", place.kind)
			marker.set_meta("mapsoo_placement", place.placement)
			marker.set_meta("mapsoo_tags", place.tags.duplicate())
			marker.set_meta("mapsoo_cell", place.cell)
			places_root.add_child(marker)
			marker.owner = root
			var place_sprite_def: Dictionary = prepared.sprites[place.sprite_id]
			var place_texture := AtlasTexture.new()
			place_texture.atlas = prepared.textures[place_sprite_def.atlas]
			place_texture.region = place_sprite_def.region
			place_texture.filter_clip = true
			var place_sprite := Sprite2D.new()
			place_sprite.name = "Icon"
			place_sprite.texture = place_texture
			place_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
			place_sprite.centered = true
			var place_pivot: Vector2 = place_sprite_def.pivot
			place_sprite.offset = place_sprite_def.region.size * 0.5 - place_pivot
			marker.add_child(place_sprite)
			place_sprite.owner = root
	return {"ok": true, "root": root, "error": ""}


static func _sprite_id_for_kind(kind: String, schema_version: String) -> String:
	return "%s-01" % kind if _has_playable_terrain(schema_version) else "%s_01" % kind


static func _has_playable_terrain(schema_version: String) -> bool:
	return schema_version in [PLAYABLE_TERRAIN_SCHEMA_VERSION, SEMANTIC_PLACES_SCHEMA_VERSION, EXTERIOR_STRUCTURES_SCHEMA_VERSION, MULTI_WORLD_PACK_SCHEMA_VERSION]


static func _has_places(schema_version: String) -> bool:
	return schema_version in [SEMANTIC_PLACES_SCHEMA_VERSION, EXTERIOR_STRUCTURES_SCHEMA_VERSION, MULTI_WORLD_PACK_SCHEMA_VERSION]


static func _has_structures(schema_version: String) -> bool:
	return schema_version in [EXTERIOR_STRUCTURES_SCHEMA_VERSION, MULTI_WORLD_PACK_SCHEMA_VERSION]


static func _scene_layer_name(layer_id: String) -> String:
	match layer_id:
		"ground": return "Ground"
		"water": return "Water"
		"roads": return "Roads"
		_: return layer_id.capitalize()


static func _resolve_json_pointer(root: Variant, pointer: Variant) -> Dictionary:
	if typeof(pointer) != TYPE_STRING or pointer.is_empty() or not pointer.begins_with("/"):
		return {"ok": false, "value": null}
	var current: Variant = root
	for encoded_token: String in pointer.trim_prefix("/").split("/", true):
		var token := encoded_token.replace("~1", "/").replace("~0", "~")
		if typeof(current) == TYPE_DICTIONARY:
			if not current.has(token): return {"ok": false, "value": null}
			current = current[token]
		elif typeof(current) == TYPE_ARRAY:
			if not token.is_valid_int(): return {"ok": false, "value": null}
			var index := token.to_int()
			if index < 0 or index >= current.size(): return {"ok": false, "value": null}
			current = current[index]
		else:
			return {"ok": false, "value": null}
	return {"ok": true, "value": current}


static func _read_json_file(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {"ok": false, "value": {}, "sha256": "", "error": "Unable to open JSON file: %s" % path}
	if file.get_length() > MAX_JSON_BYTES:
		file.close()
		return {"ok": false, "value": {}, "sha256": "", "error": "JSON file exceeds the %d-byte limit: %s" % [MAX_JSON_BYTES, path]}
	var bytes := file.get_buffer(file.get_length())
	file.close()
	var parser := JSON.new()
	var parse_error := parser.parse(bytes.get_string_from_utf8())
	if parse_error != OK:
		return {"ok": false, "value": {}, "sha256": "", "error": "Invalid JSON in %s at line %d: %s" % [path, parser.get_error_line(), parser.get_error_message()]}
	if typeof(parser.data) != TYPE_DICTIONARY:
		return {"ok": false, "value": {}, "sha256": "", "error": "JSON root must be an object: %s" % path}
	return {"ok": true, "value": parser.data, "sha256": _sha256_bytes(bytes), "error": ""}


static func _write_json_file(path: String, value: Dictionary) -> Error:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return FileAccess.get_open_error()
	file.store_string(JSON.stringify(value, "  ", true) + "\n")
	file.close()
	return OK


static func _load_png(path: String) -> Dictionary:
	if path.get_extension().to_lower() != "png":
		return {"ok": false, "image": null, "error": "Only PNG atlas files are accepted: %s" % path}
	var header := _read_png_header(path)
	if not header.ok:
		return {"ok": false, "image": null, "error": header.error}
	var declared_width: int = header.width
	var declared_height: int = header.height
	if declared_width > MAX_IMAGE_DIMENSION or declared_height > MAX_IMAGE_DIMENSION or declared_width * declared_height > MAX_IMAGE_PIXELS:
		return {
			"ok": false,
			"image": null,
			"error": "PNG dimensions exceed the %d-pixel side or %d-pixel decoded-area limit: %s" % [MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, path],
		}
	var image := Image.new()
	var load_error := image.load(path)
	if load_error != OK:
		return {"ok": false, "image": null, "error": "Unable to decode PNG %s (error %d)." % [path, load_error]}
	if image.is_empty():
		return {"ok": false, "image": null, "error": "PNG is empty: %s" % path}
	if image.get_width() != declared_width or image.get_height() != declared_height:
		return {"ok": false, "image": null, "error": "Decoded PNG dimensions differ from its IHDR: %s" % path}
	if image.get_format() != Image.FORMAT_RGBA8:
		image.convert(Image.FORMAT_RGBA8)
	return {"ok": true, "image": image, "error": ""}


static func _validate_png_budget(manifest: Dictionary, pack_root: String, errors: Array[String]) -> void:
	var png_paths: Array[String] = []
	for atlas_value: Variant in manifest.get("atlases", []):
		if typeof(atlas_value) == TYPE_DICTIONARY:
			var atlas_path: Variant = atlas_value.get("file")
			if typeof(atlas_path) == TYPE_STRING and not png_paths.has(atlas_path):
				png_paths.append(atlas_path)
	for sprite_value: Variant in manifest.get("sprites", []):
		if typeof(sprite_value) == TYPE_DICTIONARY:
			var sprite_path: Variant = sprite_value.get("atlas")
			if typeof(sprite_path) == TYPE_STRING and not png_paths.has(sprite_path):
				png_paths.append(sprite_path)

	var total_pixels := 0
	for relative_path: String in png_paths:
		var header := _read_png_header(_resolve_pack_path(pack_root, relative_path))
		if not header.ok:
			errors.append(header.error)
			continue
		var width: int = header.width
		var height: int = header.height
		var pixels := width * height
		if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION or pixels > MAX_IMAGE_PIXELS:
			errors.append("PNG dimensions exceed the %d-pixel side or %d-pixel decoded-area limit: %s" % [MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, relative_path])
			continue
		total_pixels += pixels
		if total_pixels > MAX_TOTAL_IMAGE_PIXELS:
			errors.append("Referenced PNG atlases exceed the %d-pixel pack budget." % MAX_TOTAL_IMAGE_PIXELS)
			return


static func _read_png_header(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {"ok": false, "width": 0, "height": 0, "error": "Unable to open PNG header: %s" % path}
	if file.get_length() < 24:
		file.close()
		return {"ok": false, "width": 0, "height": 0, "error": "PNG header is truncated: %s" % path}
	var header := file.get_buffer(24)
	file.close()
	var expected_signature := [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
	for index in expected_signature.size():
		if header[index] != expected_signature[index]:
			return {"ok": false, "width": 0, "height": 0, "error": "File does not have a valid PNG signature: %s" % path}
	if _uint32_be(header, 8) != 13 or header.slice(12, 16).get_string_from_ascii() != "IHDR":
		return {"ok": false, "width": 0, "height": 0, "error": "PNG does not begin with a valid IHDR chunk: %s" % path}
	var width := _uint32_be(header, 16)
	var height := _uint32_be(header, 20)
	if width <= 0 or height <= 0:
		return {"ok": false, "width": 0, "height": 0, "error": "PNG IHDR dimensions must be positive: %s" % path}
	return {"ok": true, "width": width, "height": height, "error": ""}


static func _uint32_be(bytes: PackedByteArray, offset: int) -> int:
	return (int(bytes[offset]) << 24) | (int(bytes[offset + 1]) << 16) | (int(bytes[offset + 2]) << 8) | int(bytes[offset + 3])


static func _texture_from_image(image: Image) -> PortableCompressedTexture2D:
	var texture := PortableCompressedTexture2D.new()
	texture.keep_compressed_buffer = true
	texture.create_from_image(image, PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS)
	return texture


static func _capture_source_snapshot(
	manifest_path: String,
	pack_root: String,
	manifest: Dictionary,
	expected_manifest_sha256: String
) -> Dictionary:
	var current_manifest_sha256 := _sha256_file(manifest_path)
	if current_manifest_sha256.is_empty() or current_manifest_sha256 != expected_manifest_sha256:
		return {
			"ok": false,
			"sha256": "",
			"error": "The manifest changed while it was being validated: %s" % manifest_path,
		}
	var records_value: Variant = manifest.get("files")
	if typeof(records_value) != TYPE_ARRAY:
		return {"ok": false, "sha256": "", "error": "manifest.files must be an array."}
	var snapshot_files: Array = []
	var records: Array = records_value
	for record_value: Variant in records:
		if typeof(record_value) != TYPE_DICTIONARY:
			return {"ok": false, "sha256": "", "error": "The source file baseline contains an invalid record."}
		var record: Dictionary = record_value
		var relative_path_value: Variant = record.get("path")
		if typeof(relative_path_value) != TYPE_STRING or not _is_safe_relative_path(relative_path_value):
			return {"ok": false, "sha256": "", "error": "The source file baseline contains an unsafe path."}
		var relative_path: String = relative_path_value
		var source_path := _resolve_pack_path(pack_root, relative_path)
		var source_file := FileAccess.open(source_path, FileAccess.READ)
		if source_file == null:
			return {"ok": false, "sha256": "", "error": "A validated source file is no longer readable: %s" % relative_path}
		var actual_bytes := source_file.get_length()
		source_file.close()
		var actual_sha256 := _sha256_file(source_path)
		if (
			actual_sha256.is_empty()
			or actual_sha256 != record.get("sha256")
			or actual_bytes != int(record.get("bytes", -1))
		):
			return {"ok": false, "sha256": "", "error": "A validated source file changed during import: %s" % relative_path}
		snapshot_files.append({
			"path": relative_path,
			"bytes": actual_bytes,
			"sha256": actual_sha256,
		})
	snapshot_files.sort_custom(func(left: Dictionary, right: Dictionary) -> bool: return left.path < right.path)
	return {
		"ok": true,
		"sha256": _sha256_text(JSON.stringify({
			"manifest_sha256": current_manifest_sha256,
			"files": snapshot_files,
		}, "", true)),
		"error": "",
	}


static func _sha256_file(path: String) -> String:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return ""
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		file.close()
		return ""
	while file.get_position() < file.get_length():
		context.update(file.get_buffer(mini(BUFFER_SIZE, file.get_length() - file.get_position())))
	file.close()
	return context.finish().hex_encode()


static func _sha256_bytes(value: PackedByteArray) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	context.update(value)
	return context.finish().hex_encode()


static func _sha256_text(value: String) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	context.update(value.to_utf8_buffer())
	return context.finish().hex_encode()


static func _resolve_pack_path(pack_root: String, relative_path: String) -> String:
	return pack_root.path_join(relative_path)


static func _normalise_input_path(path: String) -> String:
	var trimmed := path.strip_edges().replace("\\", "/")
	if trimmed.begins_with("res://"):
		return trimmed.simplify_path()
	if trimmed.is_absolute_path():
		return trimmed.simplify_path()
	return ""


static func _normalise_resource_dir(path: String) -> String:
	var normalised := path.strip_edges().replace("\\", "/").trim_suffix("/")
	if not normalised.begins_with("res://") or normalised.contains(".."):
		return ""
	return normalised.simplify_path()


static func _is_supported_runtime() -> bool:
	var version := Engine.get_version_info()
	return version.major > 4 or (version.major == 4 and version.minor >= 3)


static func _dictionary_at(parent: Dictionary, key: String, errors: Array[String]) -> Dictionary:
	var value: Variant = parent.get(key)
	if typeof(value) != TYPE_DICTIONARY:
		errors.append("%s must be an object." % key)
		return {}
	return value


static func _positive_int_pair(value: Variant, label: String, errors: Array[String]) -> Vector2i:
	if typeof(value) != TYPE_ARRAY or value.size() != 2 or not _is_json_integer(value[0]) or not _is_json_integer(value[1]) or value[0] <= 0 or value[1] <= 0:
		errors.append("%s must contain two positive integers." % label)
		return Vector2i.ZERO
	return Vector2i(int(value[0]), int(value[1]))


static func _non_negative_int_pair(value: Variant, label: String, errors: Array[String]) -> Vector2i:
	if typeof(value) != TYPE_ARRAY or value.size() != 2 or not _is_json_integer(value[0]) or not _is_json_integer(value[1]) or value[0] < 0 or value[1] < 0:
		errors.append("%s must contain two non-negative integers." % label)
		return Vector2i.ZERO
	return Vector2i(int(value[0]), int(value[1]))


static func _int_quad(value: Variant, label: String, errors: Array[String]) -> Rect2:
	if typeof(value) != TYPE_ARRAY or value.size() != 4:
		errors.append("%s must contain four integers." % label)
		return Rect2()
	for item: Variant in value:
		if not _is_json_integer(item):
			errors.append("%s must contain four integers." % label)
			return Rect2()
	if value[0] < 0 or value[1] < 0 or value[2] <= 0 or value[3] <= 0:
		errors.append("%s must describe a positive in-bounds rectangle." % label)
		return Rect2()
	return Rect2(int(value[0]), int(value[1]), int(value[2]), int(value[3]))


static func _is_json_integer(value: Variant) -> bool:
	if typeof(value) == TYPE_INT:
		return true
	return typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value)


static func _is_safe_relative_path(path: String) -> bool:
	if path.is_empty() or path.begins_with("/") or path.ends_with("/") or path.contains("\\") or path.contains("//") or path.contains(":"):
		return false
	var segment_pattern := RegEx.new()
	if segment_pattern.compile("^[a-z0-9][a-z0-9._-]*$") != OK:
		return false
	for segment: String in path.split("/", true):
		if segment == "." or segment == ".." or segment_pattern.search(segment) == null:
			return false
	return true


static func _is_pack_id(value: String) -> bool:
	if value.length() > 80:
		return false
	var pattern := RegEx.new()
	return pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$") == OK and pattern.search(value) != null


static func _is_asset_id(value: String) -> bool:
	if value.length() > 120:
		return false
	var pattern := RegEx.new()
	return pattern.compile("^[a-z0-9][a-z0-9_-]*$") == OK and pattern.search(value) != null


static func _is_place_id(value: String) -> bool:
	if value.length() < 1 or value.length() > 64:
		return false
	var pattern := RegEx.new()
	return pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$") == OK and pattern.search(value) != null


static func _is_place_tag(value: String) -> bool:
	if value.length() < 1 or value.length() > 32:
		return false
	var pattern := RegEx.new()
	return pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$") == OK and pattern.search(value) != null


static func _contains_control_character(value: String) -> bool:
	for index: int in value.length():
		var codepoint := value.unicode_at(index)
		if codepoint < 32 or (codepoint >= 127 and codepoint <= 159):
			return true
	return false


static func _has_exact_keys(value: Dictionary, expected: Array) -> bool:
	if value.size() != expected.size():
		return false
	for key: Variant in expected:
		if not value.has(key):
			return false
	return true


static func _is_sha256(value: String) -> bool:
	var pattern := RegEx.new()
	return pattern.compile("^[0-9a-f]{64}$") == OK and pattern.search(value) != null


static func _is_hex_color(value: String) -> bool:
	var pattern := RegEx.new()
	return pattern.compile("^#[0-9A-Fa-f]{6}$") == OK and pattern.search(value) != null


static func _result(ok: bool, errors: Array[String], warnings: Array[String]) -> Dictionary:
	return {
		"ok": ok,
		"status": "failed",
		"errors": errors.duplicate(),
		"warnings": warnings.duplicate(),
		"pack_id": "",
		"output_dir": "",
		"tileset_path": "",
		"scene_path": "",
		"state_path": "",
		"manifest_sha256": "",
		"cell_count": 0,
		"prop_count": 0,
	}
