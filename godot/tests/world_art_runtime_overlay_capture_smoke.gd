extends "res://tests/world_art_runtime_overlay_applier_smoke.gd"

const CAPTURE_SCRIPT := "res://tests/capture_world_art_runtime_overlay.gd"
const CAPTURE_ROOT := "user://world-art-runtime-overlay-capture-smoke"


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(CAPTURE_ROOT))
	if DirAccess.make_dir_recursive_absolute(
		ProjectSettings.globalize_path(CAPTURE_ROOT)
	) != OK:
		_fail("Unable to create runtime overlay capture smoke directory.")
		return
	var captures := 0
	for profile: String in PROFILES:
		var fixture := _write_fixture(profile, "capture-smoke")
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var extracted := _write_extracted_overlay(
			profile,
			fixture.plan,
			fixture.root,
			fixture.manifest.layout.sha256
		)
		if not extracted.ok:
			_fail(str(extracted.error))
			return
		var output := CAPTURE_ROOT.path_join("%s-normal.png" % profile)
		var result := _run_capture(
			fixture.root.path_join("world-layout-plan.json"),
			extracted.manifest_path,
			output,
			"normal"
		)
		if not result.ok:
			_fail("%s normal capture failed: %s" % [profile, result.error])
			return
		if (
			profile == "topdown-farm"
			and (
				not str(result.output).contains("hazards=1 characters=1 ")
				or not str(result.output).contains("animation=idle_south ")
				or not _sentinel_has_route(result.output)
			)
		):
			_fail("Top-down capture did not exercise hazard, character and route.")
			return
		captures += 1

	var movie_fixture := _write_fixture("topdown-farm", "capture-movie-smoke")
	if not movie_fixture.ok:
		_fail(str(movie_fixture.error))
		return
	var movie_overlay := _write_extracted_overlay(
		"topdown-farm",
		movie_fixture.plan,
		movie_fixture.root,
		movie_fixture.manifest.layout.sha256
	)
	if not movie_overlay.ok:
		_fail(str(movie_overlay.error))
		return
	var movie_count := 0
	for mode: String in [
		"role-overlay",
		"collision-overlay",
		"spawn-exit",
		"navigation",
	]:
		var movie_path := ""
		if mode in ["spawn-exit", "navigation"]:
			movie_path = ProjectSettings.globalize_path(
				CAPTURE_ROOT.path_join("%s.avi" % mode)
			)
		var capture := _run_capture(
			movie_fixture.root.path_join("world-layout-plan.json"),
			movie_overlay.manifest_path,
			CAPTURE_ROOT.path_join("%s.png" % mode),
			mode,
			movie_path
		)
		if (
			not capture.ok
			or (not movie_path.is_empty() and not _is_avi(movie_path))
		):
			_fail("%s evidence capture failed: %s" % [mode, capture])
			return
		if (
			not str(capture.output).contains("hazards=1 characters=1 ")
			or not _sentinel_has_route(capture.output)
			or (
				mode in ["spawn-exit", "navigation"]
				and not str(capture.output).contains("animation=walk_")
			)
		):
			_fail("%s did not preserve hazard, character animation and route." % mode)
			return
		if not movie_path.is_empty():
			movie_count += 1
		captures += 1
	_remove_tree(ProjectSettings.globalize_path(CAPTURE_ROOT))
	print(
		"WORLD_ART_RUNTIME_OVERLAY_CAPTURE_SMOKE_OK " +
		"profiles=4 captures=%d movie_writer=%d" % [captures, movie_count]
	)
	quit(0)


func _write_extracted_overlay(
	profile: String,
	plan: Dictionary,
	fixture_root: String,
	layout_sha256: String
) -> Dictionary:
	var overlay_root := fixture_root.path_join("overlay")
	var image_root := overlay_root.path_join("fixture")
	if DirAccess.make_dir_recursive_absolute(
		ProjectSettings.globalize_path(image_root)
	) != OK:
		return {"ok": false, "error": "Unable to create extracted overlay fixture."}
	var materials := {}
	var terrain_layout: Dictionary = plan.terrain_layout
	for value: Variant in terrain_layout.get(str(terrain_layout.kind), []):
		var terrain: Dictionary = value
		materials[str(terrain.material)] = true
	var ordered_materials: Array = materials.keys()
	ordered_materials.sort()
	var landmark_ids: Array[String] = []
	for value: Variant in plan.landmarks:
		landmark_ids.append(str((value as Dictionary).id))
	landmark_ids.sort()

	var images: Array = []
	var assets: Array = []
	var bindings: Array = []
	var files: Array = []
	var seed := 1
	for material_value: Variant in ordered_materials:
		var material := str(material_value)
		var task_id := "terrain-%03d" % seed
		var slot_id := "terrain-slot-%03d" % seed
		var relative_path := "fixture/%s.png" % task_id
		var record := _write_image_record(
			overlay_root,
			relative_path,
			task_id,
			seed
		)
		if not record.ok:
			return record
		images.append(record.image)
		files.append(record.file)
		var shared := _runtime_fields(
			task_id,
			slot_id,
			"terrain.ground",
			relative_path,
			record.cell_sha256
		)
		var asset: Dictionary = shared.duplicate(true)
		asset["requirement_id"] = "requirement-%s" % slot_id
		assets.append(asset)
		var binding: Dictionary = shared.duplicate(true)
		binding["usage_kind"] = "terrain-material"
		binding["usage_id"] = material
		bindings.append(binding)
		seed += 1
	for landmark_id: String in landmark_ids:
		var task_id := "landmark-%03d" % seed
		var slot_id := "landmark-slot-%03d" % seed
		var relative_path := "fixture/%s.png" % task_id
		var record := _write_image_record(
			overlay_root,
			relative_path,
			task_id,
			seed
		)
		if not record.ok:
			return record
		images.append(record.image)
		files.append(record.file)
		var shared := _runtime_fields(
			task_id,
			slot_id,
			"structure.landmark",
			relative_path,
			record.cell_sha256
		)
		var asset: Dictionary = shared.duplicate(true)
		asset["requirement_id"] = "requirement-%s" % slot_id
		assets.append(asset)
		var binding: Dictionary = shared.duplicate(true)
		binding["usage_kind"] = "landmark"
		binding["usage_id"] = landmark_id
		bindings.append(binding)
		seed += 1
	var hazards: Array = []
	if profile == "topdown-farm":
		var hazard_task := "hazard-%03d" % seed
		var hazard_slot := "hazard-slot-%03d" % seed
		var hazard_path := "fixture/%s.png" % hazard_task
		var hazard_record := _write_image_record(
			overlay_root,
			hazard_path,
			hazard_task,
			seed
		)
		if not hazard_record.ok:
			return hazard_record
		images.append(hazard_record.image)
		files.append(hazard_record.file)
		var hazard_shared := _runtime_fields(
			hazard_task,
			hazard_slot,
			"hazard.contact",
			hazard_path,
			hazard_record.cell_sha256
		)
		var hazard_asset: Dictionary = hazard_shared.duplicate(true)
		hazard_asset["requirement_id"] = "requirement-hazard-contact"
		assets.append(hazard_asset)
		var hazard_binding: Dictionary = hazard_shared.duplicate(true)
		hazard_binding["usage_kind"] = "hazard"
		hazard_binding["usage_id"] = "requirement-hazard-contact"
		bindings.append(hazard_binding)
		hazards.append({
			"hazard_id": "hazard-001",
			"binding_usage_id": "requirement-hazard-contact",
			"kind": "contact",
			"behavior": "respawn",
			"logical_rect": {"x": 20, "y": 25, "width": 2, "height": 1},
		})
		seed += 1
		var geometry: Dictionary = _character_geometry(profile)
		var character_task := "character-%03d" % seed
		var character_slot := "character-slot-%03d" % seed
		var character_path := "fixture/%s.png" % character_task
		var character_record := _write_image_record(
			overlay_root,
			character_path,
			character_task,
			seed,
			geometry.size,
			geometry.cell_size,
			geometry.pivot
		)
		if not character_record.ok:
			return character_record
		images.append(character_record.image)
		files.append(character_record.file)
		var character_shared := _runtime_fields(
			character_task,
			character_slot,
			"character.player.atlas",
			character_path,
			character_record.cell_sha256,
			{
				"x": 0,
				"y": 0,
				"width": int((geometry.size as Vector2i).x),
				"height": int((geometry.size as Vector2i).y),
			},
			_character_poses(profile, geometry)
		)
		var character_asset: Dictionary = character_shared.duplicate(true)
		character_asset["requirement_id"] = "requirement-character-player"
		assets.append(character_asset)
		var character_binding: Dictionary = character_shared.duplicate(true)
		character_binding["usage_kind"] = "character"
		character_binding["usage_id"] = "requirement-character-player"
		bindings.append(character_binding)
		seed += 1
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
		return "%d/%s/%s" % [order[a.usage_kind], a.usage_id, a.slot_id] \
			< "%d/%s/%s" % [order[b.usage_kind], b.usage_id, b.slot_id]
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
	var projection_bytes := (
		_canonical_json(projection) + "\n"
	).to_utf8_buffer()
	var projection_path := overlay_root.path_join(
		"world-art-runtime-projection.json"
	)
	if not _store_bytes(projection_path, projection_bytes):
		return {"ok": false, "error": "Unable to write runtime projection fixture."}
	files.append({
		"path": "world-art-runtime-projection.json",
		"media_type": "application/json",
		"bytes": projection_bytes.size(),
		"sha256": _sha256(projection_bytes),
	})
	files.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return str(a.path) < str(b.path)
	)
	var manifest := {
		"schema_version": "1.0.0",
		"document_type": "world-art-runtime-overlay",
		"profile": profile,
		"source": {
			"projection_id": projection.projection_id,
			"projection_sha256": _canonical_json(projection).sha256_text(),
			"layout_plan_sha256": layout_sha256,
			"review_record_sha256": source.review_record_sha256,
		},
		"rights": rights,
		"review": {
			"human_art": "pass",
			"runtime": "pending",
			"raspberry_pi": "pending",
		},
		"projection": {
			"path": "world-art-runtime-projection.json",
			"sha256": _sha256(projection_bytes),
		},
		"files": files,
		"reference_policy": {
			"embedded": false,
			"original_references_excluded": true,
			"raw_prompts_excluded": true,
			"only_one_way_audit_hashes_retained": true,
		},
	}
	manifest["overlay_id"] = "world-art-runtime-overlay-%s" % (
		_canonical_json(manifest).sha256_text().left(16)
	)
	var manifest_path := overlay_root.path_join(
		"world-art-runtime-overlay.json"
	)
	if not _store_bytes(
		manifest_path,
		(_canonical_json(manifest) + "\n").to_utf8_buffer()
	):
		return {"ok": false, "error": "Unable to write runtime overlay fixture."}
	return {"ok": true, "manifest_path": manifest_path, "error": ""}


func _write_image_record(
	overlay_root: String,
	relative_path: String,
	task_id: String,
	seed: int,
	size: Vector2i = Vector2i(32, 32),
	cell_size: Vector2i = Vector2i(32, 32),
	pivot: Array = [16, 32]
) -> Dictionary:
	var image := Image.create(size.x, size.y, false, Image.FORMAT_RGBA8)
	image.fill(Color8(
		(seed * 53) % 220 + 20,
		(seed * 97) % 220 + 20,
		(seed * 149) % 220 + 20,
		255
	))
	image.set_pixel(
		seed % size.x,
		(seed * 3) % size.y,
		Color8(250, 220, 80, 255)
	)
	var absolute := overlay_root.path_join(relative_path)
	if image.save_png(absolute) != OK:
		return {"ok": false, "error": "Unable to write overlay image fixture."}
	var bytes := FileAccess.get_file_as_bytes(absolute)
	var sha := _sha256(bytes)
	return {
		"ok": true,
		"image": {
			"task_id": task_id,
			"path": relative_path,
			"media_type": "image/png",
			"bytes": bytes.size(),
			"sha256": sha,
			"output_sha256": sha,
			"width": size.x,
			"height": size.y,
			"cell_size": [cell_size.x, cell_size.y],
			"pivot": pivot,
			"alpha_policy": "opaque",
		},
		"file": {
			"path": relative_path,
			"media_type": "image/png",
			"bytes": bytes.size(),
			"sha256": sha,
		},
		"cell_sha256": _sha256(image.get_data()),
		"error": "",
	}


func _runtime_fields(
	task_id: String,
	slot_id: String,
	role: String,
	path: String,
	cell_sha256: String,
	region: Dictionary = {"x": 0, "y": 0, "width": 32, "height": 32},
	poses: Array = []
) -> Dictionary:
	return {
		"task_id": task_id,
		"slot_id": slot_id,
		"role": role,
		"variant_id": "default",
		"image_path": path,
		"region": region,
		"cell_sha256": cell_sha256,
		"poses": poses,
	}


func _run_capture(
	layout_path: String,
	manifest_path: String,
	output_path: String,
	mode: String,
	movie_path: String = ""
) -> Dictionary:
	var arguments := [
		"--display-driver",
		"windows",
		"--audio-driver",
		"Dummy",
		"--path",
		ProjectSettings.globalize_path("res://"),
		"--resolution",
		"640x360",
	]
	if not movie_path.is_empty():
		arguments.append_array([
			"--fixed-fps",
			"30",
			"--write-movie",
			movie_path,
		])
	arguments.append_array([
		"--script",
		CAPTURE_SCRIPT,
		"--",
		"--layout=%s" % ProjectSettings.globalize_path(layout_path),
		"--overlay-manifest=%s" % ProjectSettings.globalize_path(manifest_path),
		"--output=%s" % ProjectSettings.globalize_path(output_path),
		"--evidence-mode=%s" % mode,
	])
	var output: Array = []
	var exit_code := OS.execute(
		OS.get_executable_path(),
		arguments,
		output,
		true,
		false
	)
	var text := "\n".join(output)
	var png_path := ProjectSettings.globalize_path(output_path)
	if (
		exit_code != 0
		or not text.contains("WORLD_ART_RUNTIME_OVERLAY_CAPTURE_OK ")
		or not FileAccess.file_exists(png_path)
		or FileAccess.get_sha256(png_path).is_empty()
	):
		return {"ok": false, "error": "exit=%d output=%s" % [exit_code, text]}
	return {"ok": true, "output": text, "error": ""}


func _store_bytes(path: String, bytes: PackedByteArray) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_buffer(bytes)
	file.close()
	return true


func _is_avi(path: String) -> bool:
	if not FileAccess.file_exists(path):
		return false
	var bytes := FileAccess.get_file_as_bytes(path)
	return (
		bytes.size() >= 12
		and bytes.slice(0, 4).get_string_from_ascii() == "RIFF"
		and bytes.slice(8, 12).get_string_from_ascii() == "AVI "
	)


func _sentinel_has_route(output: String) -> bool:
	var regex := RegEx.new()
	return (
		regex.compile("route_nodes=([2-9]|[1-9][0-9]+)") == OK
		and regex.search(output) != null
	)
