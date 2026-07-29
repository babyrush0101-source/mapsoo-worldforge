extends "res://tests/world_visual_placement_applier_smoke.gd"

const RuntimeOverlayV11 = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay_v1_1.gd"
)

const MANIFEST_FILE := "world-art-runtime-overlay.json"
const PROJECTION_PATH := "world-art-runtime-projection.json"
const PLACEMENT_PLAN_PATH := "world-visual-placement-plan.json"
const PLACEMENT_MAP_PATH := "world-art-placement-map.json"


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(
		ProjectSettings.globalize_path(TEST_ROOT)
	) != OK:
		_fail("Unable to create runtime overlay 1.1 smoke directory.")
		return

	var profile_runs := 0
	var persisted_runs := 0
	var repeated_runs := 0
	for profile: String in PROFILES:
		var context := _validated_context(profile, "runtime-overlay-v1-1")
		if not context.ok:
			_fail(str(context.error))
			return
		var fixture := _build_overlay_fixture(context, "positive")
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var loaded := RuntimeOverlayV11.load_extracted(
			fixture.manifest_path,
			str(context.attachment.sha256)
		)
		if not loaded.ok:
			_fail("%s overlay 1.1 load failed: %s" % [profile, loaded.error])
			return
		var world_result := _materialize_world(profile, context.attachment)
		if not world_result.ok:
			_fail("%s layout fixture failed." % profile)
			return
		var world: Node = world_result.root
		var before := _semantic_snapshot(world)
		var prepared := RuntimeOverlayV11.prepare_scene(
			world,
			loaded.overlay,
			context.attachment.plan
		)
		if not prepared.ok or before != _semantic_snapshot(world):
			world.free()
			_fail("%s overlay 1.1 prepare mutated or failed: %s" % [
				profile, prepared,
			])
			return
		var applied := RuntimeOverlayV11.apply_scene(world, prepared)
		if not applied.ok:
			world.free()
			_fail("%s overlay 1.1 apply failed: %s" % [profile, applied.error])
			return
		var checked := RuntimeOverlayV11.validate_bound_scene(
			world,
			loaded.overlay,
			context.attachment.plan
		)
		if not checked.ok or not _assert_repeated_asset(world):
			world.free()
			_fail("%s overlay 1.1 validation failed: %s" % [
				profile, checked.error,
			])
			return
		var persisted := _persist_and_reload(
			world,
			fixture.root,
			"%s-overlay-v1-1" % profile
		)
		world.free()
		if not persisted.ok:
			_fail("%s overlay 1.1 persistence failed." % profile)
			return
		var reloaded: Node = persisted.root
		var reload_check := RuntimeOverlayV11.validate_bound_scene(
			reloaded,
			loaded.overlay,
			context.attachment.plan
		)
		if not reload_check.ok or not _assert_repeated_asset(reloaded):
			reloaded.free()
			_fail("%s reloaded overlay 1.1 changed: %s" % [
				profile, reload_check.error,
			])
			return
		reloaded.free()
		profile_runs += 1
		persisted_runs += 1
		repeated_runs += 1

	var disk_failures := _assert_disk_fail_closed()
	if disk_failures != 4:
		return
	var memory_failures := _assert_memory_fail_closed()
	if memory_failures < 10:
		return
	var apply_failures := _assert_apply_wrong_root_fail_closed()
	if apply_failures != 1:
		return
	var tamper_failures := _assert_persisted_tamper_rejected()
	if tamper_failures != 2:
		return

	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print((
		"MAPSOO_WORLD_ART_RUNTIME_OVERLAY_V1_1_OK " +
		"profiles=%d placements=%d repeated=%d persisted=%d " +
		"disk_fail_closed=%d memory_fail_closed=%d " +
		"apply_fail_closed=%d tamper=%d"
	) % [
		profile_runs,
		profile_runs * EXPECTED_PLACEMENTS,
		repeated_runs,
		persisted_runs,
		disk_failures,
		memory_failures,
		apply_failures,
		tamper_failures,
	])
	quit(0)


func _build_overlay_fixture(
	context: Dictionary,
	suffix: String
) -> Dictionary:
	var profile := str(context.attachment.plan.profile)
	var root := str(context.fixture.root).path_join(
		"runtime-overlay-v1-1-%s" % suffix
	)
	if DirAccess.make_dir_recursive_absolute(
		ProjectSettings.globalize_path(root.path_join("assets"))
	) != OK:
		return {"ok": false, "error": "Could not create overlay fixture."}
	var input := _visual_input(
		profile,
		context.attachment.plan,
		str(context.attachment.sha256)
	)
	var plan: Dictionary = input.plan
	var plan_identity := {
		"profile": plan.profile,
		"source": plan.source,
		"bounds": plan.bounds,
		"placements": plan.placements,
	}
	plan.plan_id = "world-visual-placement-plan-%s" % (
		RuntimeOverlayV11._canonical_sha256(plan_identity).left(16)
	)

	var task_ids: Array = input.textures.keys()
	task_ids.sort()
	var file_records: Array = []
	var image_records: Array = []
	var image_path_by_task := {}
	for task_value: Variant in task_ids:
		var task_id := str(task_value)
		var path := "assets/%s.png" % task_id
		var texture := input.textures[task_id] as Texture2D
		var image := texture.get_image()
		if image.save_png(root.path_join(path)) != OK:
			return {"ok": false, "error": "Could not write fixture PNG."}
		var bytes := _read_file(root.path_join(path))
		if bytes.is_empty():
			return {"ok": false, "error": "Could not read fixture PNG."}
		var digest := _sha256(bytes)
		image_path_by_task[task_id] = path
		file_records.append(_file_record(path, "image/png", bytes))
		image_records.append({
			"task_id": task_id,
			"path": path,
			"media_type": "image/png",
			"bytes": bytes.size(),
			"sha256": digest,
			"output_sha256": digest,
			"width": image.get_width(),
			"height": image.get_height(),
			"cell_size": [image.get_width(), image.get_height()],
			"pivot": [image.get_width() / 2, image.get_height() / 2],
			"alpha_policy": "straight-alpha",
		})

	var assets: Array = []
	for slot_value: Variant in input.assets:
		var slot_id := str(slot_value)
		var source: Dictionary = input.assets[slot_id]
		var poses: Array = []
		if str(source.role).begins_with("character."):
			poses.append({
				"action": "idle",
				"direction": "south",
				"frame_index": 0,
				"duration_ms": 120,
				"region": (source.region as Dictionary).duplicate(true),
			})
		assets.append({
			"task_id": str(source.task_id),
			"slot_id": slot_id,
			"requirement_id": "requirement-%s" % slot_id,
			"role": str(source.role),
			"variant_id": str(source.variant_id),
			"image_path": str(image_path_by_task[str(source.task_id)]),
			"region": (source.region as Dictionary).duplicate(true),
			"cell_sha256": str(source.cell_sha256),
			"poses": poses,
		})
	assets.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		return (
			"%s/%s" % [left.task_id, left.slot_id]
			< "%s/%s" % [right.task_id, right.slot_id]
		)
	)
	var projection_bindings: Array = []
	for value: Variant in assets:
		var asset: Dictionary = value
		var binding := asset.duplicate(true)
		binding.erase("requirement_id")
		binding["usage_kind"] = (
			"character"
			if str(asset.role).begins_with("character.")
			else "landmark"
		)
		binding["usage_id"] = "runtime-%s" % str(asset.slot_id)
		projection_bindings.append(binding)
	projection_bindings.sort_custom(
		func(left: Dictionary, right: Dictionary) -> bool:
			var order := {"landmark": 1, "character": 3}
			return (
				"%d/%s/%s" % [
					order[left.usage_kind], left.usage_id, left.slot_id,
				]
				< "%d/%s/%s" % [
					order[right.usage_kind], right.usage_id, right.slot_id,
				]
			)
	)
	var projection_source := {
		"variant_map_id": "variant-map-fixture",
		"variant_map_sha256": "1".repeat(64),
		"layout_plan_sha256": str(context.attachment.sha256),
		"production_art_plan_id": "production-art-plan-fixture",
		"production_art_plan_sha256": "2".repeat(64),
		"requirements_sha256": "3".repeat(64),
		"run_set_sha256": "4".repeat(64),
		"reviewed_slot_inventory_sha256": "5".repeat(64),
		"review_record_sha256": "6".repeat(64),
	}
	var rights := {"distribution": "public", "license": "CC0-1.0"}
	var projection := {
		"schema_version": "1.0.0",
		"document_type": "world-art-runtime-projection",
		"profile": profile,
		"source": projection_source,
		"rights": rights,
		"images": image_records,
		"assets": assets,
		"bindings": projection_bindings,
		"hazards": [],
	}
	projection["projection_id"] = "world-art-runtime-projection-%s" % (
		RuntimeOverlayV11._canonical_sha256(projection).left(16)
	)

	var map_bindings: Array = []
	for placement_value: Variant in plan.placements:
		var placement: Dictionary = placement_value
		var runtime_binding: Dictionary = input.bindings[placement.placement_id]
		var asset: Dictionary = input.assets[runtime_binding.slot_id]
		map_bindings.append({
			"placement_id": str(placement.placement_id),
			"task_id": str(runtime_binding.task_id),
			"slot_id": str(runtime_binding.slot_id),
			"requirement_id": "requirement-%s" % str(runtime_binding.slot_id),
			"role": str(runtime_binding.role),
			"variant_id": str(runtime_binding.variant_id),
			"atlas_path": str(image_path_by_task[str(runtime_binding.task_id)]),
			"atlas_cell": {
				"column": 0,
				"row": 0,
				"column_span": 1,
				"row_span": 1,
			},
		})
	var plan_sha := RuntimeOverlayV11._canonical_sha256(plan)
	var placement_map := {
		"schema_version": "1.0.0",
		"document_type": "world-art-placement-map",
		"profile": profile,
		"source": {
			"layout_plan_id": str(context.attachment.plan.plan_id),
			"layout_plan_sha256": str(context.attachment.sha256),
			"placement_plan_id": str(plan.plan_id),
			"placement_plan_sha256": plan_sha,
			"requirements_sha256": projection_source.requirements_sha256,
			"production_art_plan_id": projection_source.production_art_plan_id,
			"production_art_plan_sha256":
				projection_source.production_art_plan_sha256,
			"reviewed_slot_inventory_sha256":
				projection_source.reviewed_slot_inventory_sha256,
			"review_record_sha256": projection_source.review_record_sha256,
		},
		"bindings": map_bindings,
	}
	placement_map["map_id"] = "world-art-placement-map-%s" % (
		RuntimeOverlayV11._canonical_sha256({
			"profile": placement_map.profile,
			"source": placement_map.source,
			"bindings": placement_map.bindings,
		}).left(16)
	)

	var document_values := {
		PROJECTION_PATH: projection,
		PLACEMENT_PLAN_PATH: plan,
		PLACEMENT_MAP_PATH: placement_map,
	}
	var document_bytes := {}
	for path_value: Variant in document_values:
		var path := str(path_value)
		var bytes := (
			RuntimeOverlayV11._canonical_json(document_values[path]) + "\n"
		).to_utf8_buffer()
		if not _write_bytes(root.path_join(path), bytes):
			return {"ok": false, "error": "Could not write fixture JSON."}
		document_bytes[path] = bytes
		file_records.append(_file_record(path, "application/json", bytes))
	file_records.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		return str(left.path) < str(right.path)
	)
	var manifest := {
		"schema_version": "1.1.0",
		"document_type": "world-art-runtime-overlay",
		"profile": profile,
		"source": {
			"projection_id": str(projection.projection_id),
			"projection_sha256":
				RuntimeOverlayV11._canonical_sha256(projection),
			"layout_plan_id": str(context.attachment.plan.plan_id),
			"layout_plan_sha256": str(context.attachment.sha256),
			"placement_plan_id": str(plan.plan_id),
			"placement_plan_sha256": plan_sha,
			"placement_map_id": str(placement_map.map_id),
			"placement_map_sha256":
				RuntimeOverlayV11._canonical_sha256(placement_map),
			"review_record_sha256": projection_source.review_record_sha256,
		},
		"rights": rights,
		"review": {
			"human_art": "pass",
			"runtime": "pending",
			"raspberry_pi": "pending",
		},
		"projection": {
			"path": PROJECTION_PATH,
			"sha256": _sha256(document_bytes[PROJECTION_PATH]),
		},
		"visual_placement": {
			"plan_path": PLACEMENT_PLAN_PATH,
			"plan_sha256": _sha256(document_bytes[PLACEMENT_PLAN_PATH]),
			"map_path": PLACEMENT_MAP_PATH,
			"map_sha256": _sha256(document_bytes[PLACEMENT_MAP_PATH]),
		},
		"files": file_records,
		"reference_policy": {
			"embedded": false,
			"original_references_excluded": true,
			"raw_prompts_excluded": true,
			"only_one_way_audit_hashes_retained": true,
		},
	}
	manifest["overlay_id"] = "world-art-runtime-overlay-%s" % (
		RuntimeOverlayV11._canonical_sha256(manifest).left(16)
	)
	var manifest_bytes := (
		RuntimeOverlayV11._canonical_json(manifest) + "\n"
	).to_utf8_buffer()
	var manifest_path := root.path_join(MANIFEST_FILE)
	if not _write_bytes(manifest_path, manifest_bytes):
		return {"ok": false, "error": "Could not write fixture manifest."}
	return {
		"ok": true,
		"root": root,
		"manifest_path": manifest_path,
		"manifest": manifest,
		"plan": plan,
		"placement_map": placement_map,
		"projection": projection,
		"error": "",
	}


func _assert_disk_fail_closed() -> int:
	var passed := 0
	for mutation: String in ["png", "extra", "plan", "manifest-order"]:
		var context := _validated_context(
			"topdown-farm",
			"overlay-v1-1-disk-%s" % mutation
		)
		if not context.ok:
			_fail(str(context.error))
			return -1
		var fixture := _build_overlay_fixture(context, mutation)
		if not fixture.ok:
			_fail(str(fixture.error))
			return -1
		if mutation == "png":
			var png_path: String = str(fixture.root).path_join(
				"assets/tree-task.png"
			)
			var png_bytes := _read_file(png_path)
			png_bytes[png_bytes.size() - 1] = (
				int(png_bytes[png_bytes.size() - 1]) ^ 1
			)
			_write_bytes(png_path, png_bytes)
		elif mutation == "extra":
			_write_bytes(
				fixture.root.path_join("unexpected.json"),
				"{}\n".to_utf8_buffer()
			)
		elif mutation == "plan":
			var plan_path: String = str(fixture.root).path_join(
				PLACEMENT_PLAN_PATH
			)
			var plan_bytes := _read_file(plan_path)
			plan_bytes.append(32)
			_write_bytes(plan_path, plan_bytes)
		else:
			var manifest: Dictionary = fixture.manifest.duplicate(true)
			manifest.files.reverse()
			_write_bytes(
				fixture.manifest_path,
				(RuntimeOverlayV11._canonical_json(manifest) + "\n")
					.to_utf8_buffer()
			)
		var result := RuntimeOverlayV11.load_extracted(
			fixture.manifest_path,
			str(context.attachment.sha256)
		)
		if result.ok:
			_fail("Disk mutation %s was accepted." % mutation)
			return -1
		passed += 1
	return passed


func _assert_memory_fail_closed() -> int:
	var context := _validated_context("topdown-farm", "overlay-v1-1-memory")
	if not context.ok:
		_fail(str(context.error))
		return -1
	var fixture := _build_overlay_fixture(context, "memory")
	var loaded_result := RuntimeOverlayV11.load_extracted(
		fixture.manifest_path,
		str(context.attachment.sha256)
	)
	if not loaded_result.ok:
		_fail("Memory tamper source overlay did not load.")
		return -1
	var base: Dictionary = loaded_result.overlay
	var cases: Array = []

	var map_role: Dictionary = base.duplicate(true)
	map_role.placement_map.bindings[1].role = "prop.rock"
	cases.append(["map role", map_role])
	var map_task: Dictionary = base.duplicate(true)
	map_task.placement_map.bindings[1].task_id = "actor-task"
	cases.append(["map task", map_task])
	var map_cell: Dictionary = base.duplicate(true)
	map_cell.placement_map.bindings[1].atlas_cell.column = 1
	cases.append(["map cell", map_cell])
	var map_missing: Dictionary = base.duplicate(true)
	map_missing.placement_map.bindings.pop_back()
	cases.append(["missing map binding", map_missing])
	var map_extra: Dictionary = base.duplicate(true)
	map_extra.placement_map.bindings.append(
		(map_extra.placement_map.bindings[0] as Dictionary).duplicate(true)
	)
	cases.append(["extra map binding", map_extra])
	var plan_order: Dictionary = base.duplicate(true)
	plan_order.placement_plan.placements.reverse()
	cases.append(["plan order", plan_order])
	var projection_cell: Dictionary = base.duplicate(true)
	projection_cell.projection.assets[0].cell_sha256 = "0".repeat(64)
	cases.append(["projection cell", projection_cell])
	var missing_texture: Dictionary = base.duplicate(true)
	missing_texture.texture_by_task.erase("tree-task")
	cases.append(["missing texture", missing_texture])
	var extra_texture: Dictionary = base.duplicate(true)
	extra_texture.texture_by_task["unexpected-task"] = (
		base.texture_by_task["tree-task"]
	)
	cases.append(["extra texture", extra_texture])
	var source_digest: Dictionary = base.duplicate(true)
	source_digest.manifest.source.placement_plan_sha256 = "0".repeat(64)
	cases.append(["manifest source", source_digest])
	var raw_digest: Dictionary = base.duplicate(true)
	raw_digest.placement_map_file_sha256 = "0".repeat(64)
	cases.append(["remembered file digest", raw_digest])
	var extra_key: Dictionary = base.duplicate(true)
	extra_key["unexpected"] = true
	cases.append(["loaded shape", extra_key])

	var passed := 0
	for value: Variant in cases:
		var case: Array = value
		if not _expect_prepare_failure(
			context.attachment,
			case[1],
			str(case[0])
		):
			return -1
		passed += 1
	return passed


func _expect_prepare_failure(
	attachment: Dictionary,
	loaded: Dictionary,
	label: String
) -> bool:
	var world_result := _materialize_world(
		str(attachment.plan.profile),
		attachment
	)
	if not world_result.ok:
		_fail("%s world fixture failed." % label)
		return false
	var world: Node = world_result.root
	var before := _semantic_snapshot(world)
	var prepared := RuntimeOverlayV11.prepare_scene(
		world,
		loaded,
		attachment.plan
	)
	if prepared.ok:
		var detached: Node = prepared.applier.container
		detached.free()
	if prepared.ok or before != _semantic_snapshot(world):
		world.free()
		_fail("Memory mutation %s did not fail before mutation." % label)
		return false
	world.free()
	return true


func _assert_apply_wrong_root_fail_closed() -> int:
	var context := _validated_context("topdown-farm", "overlay-v1-1-wrong-root")
	var fixture := _build_overlay_fixture(context, "wrong-root")
	var loaded := RuntimeOverlayV11.load_extracted(
		fixture.manifest_path,
		str(context.attachment.sha256)
	)
	var first := _materialize_world("topdown-farm", context.attachment)
	var second := _materialize_world("topdown-farm", context.attachment)
	if not loaded.ok or not first.ok or not second.ok:
		_fail("Wrong-root fixture failed.")
		return -1
	var prepared := RuntimeOverlayV11.prepare_scene(
		first.root,
		loaded.overlay,
		context.attachment.plan
	)
	var before := _semantic_snapshot(second.root)
	var applied := RuntimeOverlayV11.apply_scene(second.root, prepared)
	var clean: bool = (
		not applied.ok
		and before == _semantic_snapshot(second.root)
	)
	if prepared.ok:
		var detached: Node = prepared.applier.container
		detached.free()
	first.root.free()
	second.root.free()
	if not clean:
		_fail("Prepared overlay applied to the wrong scene.")
		return -1
	return 1


func _assert_persisted_tamper_rejected() -> int:
	var context := _validated_context("topdown-farm", "overlay-v1-1-tamper")
	var fixture := _build_overlay_fixture(context, "tamper")
	var loaded := RuntimeOverlayV11.load_extracted(
		fixture.manifest_path,
		str(context.attachment.sha256)
	)
	if not loaded.ok:
		_fail("Tamper overlay did not load.")
		return -1
	var passed := 0
	for mutation: String in ["overlay-id", "placement"]:
		var world_result := _materialize_world(
			"topdown-farm",
			context.attachment
		)
		var applied := RuntimeOverlayV11.bind_scene(
			world_result.root,
			loaded.overlay,
			context.attachment.plan
		)
		if not world_result.ok or not applied.ok:
			_fail("Tamper overlay did not bind.")
			return -1
		if mutation == "overlay-id":
			world_result.root.set_meta(
				"mapsoo_world_art_overlay_id",
				"world-art-runtime-overlay-0000000000000000"
			)
		else:
			var placement := _find_placement(
				world_result.root,
				"world-tree-a"
			)
			placement.set_meta("mapsoo_slot_id", "tampered-slot")
		var checked := RuntimeOverlayV11.validate_bound_scene(
			world_result.root,
			loaded.overlay,
			context.attachment.plan
		)
		world_result.root.free()
		if checked.ok:
			_fail("Persisted %s tamper was accepted." % mutation)
			return -1
		passed += 1
	return passed


func _file_record(
	path: String,
	media_type: String,
	bytes: PackedByteArray
) -> Dictionary:
	return {
		"path": path,
		"media_type": media_type,
		"bytes": bytes.size(),
		"sha256": _sha256(bytes),
	}


func _read_file(path: String) -> PackedByteArray:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return PackedByteArray()
	var bytes := file.get_buffer(file.get_length())
	file.close()
	return bytes


func _write_bytes(path: String, bytes: PackedByteArray) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_buffer(bytes)
	file.close()
	return true
