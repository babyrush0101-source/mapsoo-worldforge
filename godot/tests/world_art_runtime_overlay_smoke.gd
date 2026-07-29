extends SceneTree

const RuntimeOverlay = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay.gd"
)
const TEST_ROOT := "user://world-art-runtime-overlay-smoke"
const SHA_A := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const SHA_B := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const SHA_C := "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
const SHA_D := "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
const PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]


func _init() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TEST_ROOT)) != OK:
		_fail("Unable to create runtime overlay smoke directory.")
		return
	var persisted_count := 0
	for profile_index in PROFILES.size():
		var profile: String = PROFILES[profile_index]
		var fixture := _write_fixture(profile, profile_index)
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var loaded := RuntimeOverlay.load_extracted(
			fixture.manifest_path,
			SHA_A
		)
		if not loaded.ok:
			_fail("%s overlay load failed: %s" % [profile, loaded.error])
			return
		var root := Node2D.new()
		root.name = "World"
		root.set_meta("mapsoo_layout_plan_sha256", SHA_A)
		root.set_meta("mapsoo_profile", profile)
		var bound := RuntimeOverlay.bind_scene(root, loaded.overlay)
		if not bound.ok:
			root.free()
			_fail("%s overlay bind failed: %s" % [profile, bound.error])
			return
		var persisted := _persist_and_reload(
			root,
			TEST_ROOT.path_join("%s.world.tscn" % profile)
		)
		root.free()
		if not persisted.ok:
			_fail("%s overlay persistence failed: %s" % [profile, persisted.error])
			return
		var checked := RuntimeOverlay.validate_bound_scene(
			persisted.root,
			loaded.overlay
		)
		if not checked.ok:
			persisted.root.free()
			_fail("%s persisted overlay changed: %s" % [profile, checked.error])
			return
		persisted.root.free()
		persisted_count += 1
	if not _assert_tamper_fails_closed():
		return
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print(
		"MAPSOO_WORLD_ART_RUNTIME_OVERLAY_OK " +
		"profiles=4 loaded=4 persisted=%d grants=1 tamper=6 executable_files=0" % persisted_count
	)
	quit(0)


func _write_fixture(
	profile: String,
	color_index: int,
	cell_sha_override: String = "",
	rights_override: Dictionary = {}
) -> Dictionary:
	var root := TEST_ROOT.path_join(profile)
	var image_path := "production-art/%s/terrain-sheet-001.png" % profile
	var image_full_path := root.path_join(image_path)
	if (
		DirAccess.make_dir_recursive_absolute(
			ProjectSettings.globalize_path(image_full_path.get_base_dir())
		) != OK
	):
		return _failure("Unable to create fixture image directory.")
	var image := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	var colors := [
		Color8(58, 126, 82, 255),
		Color8(142, 89, 61, 255),
		Color8(80, 95, 143, 255),
		Color8(104, 72, 132, 255),
	]
	image.fill(colors[color_index])
	image.set_pixel(color_index + 1, color_index + 1, Color8(241, 201, 92, 255))
	if image.save_png(image_full_path) != OK:
		return _failure("Unable to write fixture PNG.")
	var image_bytes := FileAccess.get_file_as_bytes(image_full_path)
	var image_sha := _sha256_bytes(image_bytes)
	var cell_sha := _sha256_bytes(image.get_data())
	if not cell_sha_override.is_empty():
		cell_sha = cell_sha_override
	var source := {
		"variant_map_id": "variant-map-fixture",
		"variant_map_sha256": SHA_B,
		"layout_plan_sha256": SHA_A,
		"production_art_plan_id": "production-plan-fixture",
		"production_art_plan_sha256": SHA_C,
		"requirements_sha256": SHA_D,
		"run_set_sha256": SHA_B,
		"reviewed_slot_inventory_sha256": SHA_C,
		"review_record_sha256": SHA_D,
	}
	var rights := {
		"distribution": "public",
		"license": "CC0-1.0",
	}
	if not rights_override.is_empty():
		rights = rights_override.duplicate(true)
	var image_record := {
		"task_id": "terrain-sheet-001",
		"path": image_path,
		"media_type": "image/png",
		"bytes": image_bytes.size(),
		"sha256": image_sha,
		"output_sha256": SHA_A,
		"width": 32,
		"height": 32,
		"cell_size": [32, 32],
		"pivot": [16, 32],
		"alpha_policy": "opaque",
	}
	var region := {"x": 0, "y": 0, "width": 32, "height": 32}
	var asset := {
		"task_id": "terrain-sheet-001",
		"slot_id": "terrain-ground-default-001",
		"requirement_id": "terrain-ground-requirement",
		"role": "terrain.ground",
		"variant_id": "default",
		"image_path": image_path,
		"region": region,
		"cell_sha256": cell_sha,
		"poses": [],
	}
	var binding := {
		"usage_kind": "terrain-material",
		"usage_id": "material-meadow",
		"task_id": asset.task_id,
		"slot_id": asset.slot_id,
		"role": asset.role,
		"variant_id": asset.variant_id,
		"image_path": asset.image_path,
		"region": region,
		"cell_sha256": asset.cell_sha256,
		"poses": [],
	}
	var projection := {
		"schema_version": "1.0.0",
		"document_type": "world-art-runtime-projection",
		"profile": profile,
		"source": source,
		"rights": rights,
		"images": [image_record],
		"assets": [asset],
		"bindings": [binding],
		"hazards": [],
	}
	projection["projection_id"] = "world-art-runtime-projection-%s" % (
		_canonical_sha256(projection).left(16)
	)
	var projection_bytes := _canonical_bytes(projection, true)
	var projection_path := root.path_join("world-art-runtime-projection.json")
	if not _write_bytes(projection_path, projection_bytes):
		return _failure("Unable to write fixture projection.")
	var manifest := {
		"schema_version": "1.0.0",
		"document_type": "world-art-runtime-overlay",
		"profile": profile,
		"source": {
			"projection_id": projection.projection_id,
			"projection_sha256": _canonical_sha256(projection),
			"layout_plan_sha256": SHA_A,
			"review_record_sha256": SHA_D,
		},
		"rights": rights,
		"review": {
			"human_art": "pass",
			"runtime": "pending",
			"raspberry_pi": "pending",
		},
		"projection": {
			"path": "world-art-runtime-projection.json",
			"sha256": _sha256_bytes(projection_bytes),
		},
		"files": [
			{
				"path": image_path,
				"media_type": "image/png",
				"bytes": image_bytes.size(),
				"sha256": image_sha,
			},
			{
				"path": "world-art-runtime-projection.json",
				"media_type": "application/json",
				"bytes": projection_bytes.size(),
				"sha256": _sha256_bytes(projection_bytes),
			},
		],
		"reference_policy": {
			"embedded": false,
			"original_references_excluded": true,
			"raw_prompts_excluded": true,
			"only_one_way_audit_hashes_retained": true,
		},
	}
	manifest["overlay_id"] = "world-art-runtime-overlay-%s" % (
		_canonical_sha256(manifest).left(16)
	)
	var manifest_path := root.path_join("world-art-runtime-overlay.json")
	if not _write_bytes(manifest_path, _canonical_bytes(manifest, true)):
		return _failure("Unable to write fixture manifest.")
	return {
		"ok": true,
		"root": root,
		"manifest_path": manifest_path,
		"image_path": image_full_path,
		"manifest": manifest,
		"projection": projection,
		"image_bytes": image_bytes,
		"error": "",
	}


func _assert_tamper_fails_closed() -> bool:
	var fixture := _write_fixture("topdown-farm", 1)
	if not fixture.ok:
		_fail(str(fixture.error))
		return false
	var wrong_layout := RuntimeOverlay.load_extracted(fixture.manifest_path, SHA_B)
	if wrong_layout.ok:
		_fail("Overlay accepted a different layout digest.")
		return false
	var wrong_cell_fixture := _write_fixture("layered-depth-2d", 3, SHA_A)
	if not wrong_cell_fixture.ok:
		_fail(str(wrong_cell_fixture.error))
		return false
	var wrong_cell := RuntimeOverlay.load_extracted(
		wrong_cell_fixture.manifest_path,
		SHA_A
	)
	if wrong_cell.ok:
		_fail("Overlay accepted a false reviewed cell digest.")
		return false
	var internal_fixture := _write_fixture(
		"isometric-action",
		2,
		"",
		{
			"distribution": "internal-review",
			"license": "LicenseRef-Proprietary",
		}
	)
	if not internal_fixture.ok:
		_fail(str(internal_fixture.error))
		return false
	var ungranted := RuntimeOverlay.load_extracted(
		internal_fixture.manifest_path,
		SHA_A
	)
	if ungranted.ok:
		_fail("Internal-review overlay loaded without a local grant.")
		return false
	var granted := RuntimeOverlay.load_extracted(
		internal_fixture.manifest_path,
		SHA_A,
		{
			"decision": "allow",
			"distribution": "internal-review",
			"overlay_id": internal_fixture.manifest.overlay_id,
			"grant_id": "runtime-overlay-smoke-grant",
		}
	)
	if not granted.ok:
		_fail("Exact internal-review overlay grant was rejected: %s" % granted.error)
		return false
	var original_bytes: PackedByteArray = fixture.image_bytes
	if not _write_bytes(fixture.image_path, PackedByteArray([1, 2, 3, 4])):
		_fail("Unable to write PNG tamper fixture.")
		return false
	var changed_png := RuntimeOverlay.load_extracted(fixture.manifest_path, SHA_A)
	if changed_png.ok:
		_fail("Overlay accepted changed PNG bytes.")
		return false
	if not _write_bytes(fixture.image_path, original_bytes):
		_fail("Unable to restore PNG fixture.")
		return false
	var unsafe_manifest: Dictionary = fixture.manifest.duplicate(true)
	unsafe_manifest.rights = {
		"distribution": "public",
		"license": "LicenseRef-Proprietary",
	}
	unsafe_manifest.erase("overlay_id")
	unsafe_manifest["overlay_id"] = "world-art-runtime-overlay-%s" % (
		_canonical_sha256(unsafe_manifest).left(16)
	)
	if not _write_bytes(
		fixture.manifest_path,
		_canonical_bytes(unsafe_manifest, true)
	):
		_fail("Unable to write unsafe rights fixture.")
		return false
	var unsafe_rights := RuntimeOverlay.load_extracted(fixture.manifest_path, SHA_A)
	if unsafe_rights.ok:
		_fail("Overlay accepted public proprietary rights.")
		return false
	var loaded := RuntimeOverlay.load_extracted(
		TEST_ROOT.path_join("side-platformer/world-art-runtime-overlay.json"),
		SHA_A
	)
	if not loaded.ok:
		_fail("Unable to reload scene-binding fixture.")
		return false
	var wrong_scene := Node2D.new()
	wrong_scene.name = "WrongWorld"
	wrong_scene.set_meta("mapsoo_layout_plan_sha256", SHA_A)
	wrong_scene.set_meta("mapsoo_profile", "isometric-action")
	var wrong_profile := RuntimeOverlay.bind_scene(wrong_scene, loaded.overlay)
	wrong_scene.free()
	if wrong_profile.ok:
		_fail("Overlay bound to a scene from another profile.")
		return false
	return true


func _persist_and_reload(root: Node, path: String) -> Dictionary:
	var packed := PackedScene.new()
	if packed.pack(root) != OK:
		return _failure("Unable to pack overlay scene.")
	if ResourceSaver.save(packed, path) != OK:
		return _failure("Unable to save overlay scene.")
	var loaded := ResourceLoader.load(
		path,
		"PackedScene",
		ResourceLoader.CACHE_MODE_IGNORE
	) as PackedScene
	if loaded == null:
		return _failure("Unable to reload overlay scene.")
	var instance := loaded.instantiate()
	if instance == null:
		return _failure("Unable to instantiate overlay scene.")
	return {"ok": true, "root": instance, "error": ""}


func _canonical_bytes(value: Variant, newline: bool) -> PackedByteArray:
	var text := _canonical_json(value)
	if newline:
		text += "\n"
	return text.to_utf8_buffer()


func _canonical_sha256(value: Variant) -> String:
	return _canonical_json(value).sha256_text()


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


func _write_bytes(path: String, bytes: PackedByteArray) -> bool:
	if (
		DirAccess.make_dir_recursive_absolute(
			ProjectSettings.globalize_path(path.get_base_dir())
		) != OK
	):
		return false
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_buffer(bytes)
	file.flush()
	file.close()
	return true


func _sha256_bytes(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	if context.update(bytes) != OK:
		return ""
	return context.finish().hex_encode()


func _remove_tree(absolute: String) -> void:
	if not DirAccess.dir_exists_absolute(absolute):
		return
	var directory := DirAccess.open(absolute)
	if directory == null:
		return
	directory.list_dir_begin()
	var name := directory.get_next()
	while not name.is_empty():
		if name not in [".", ".."]:
			var child := absolute.path_join(name)
			if directory.current_is_dir():
				_remove_tree(child)
			else:
				DirAccess.remove_absolute(child)
		name = directory.get_next()
	directory.list_dir_end()
	DirAccess.remove_absolute(absolute)


func _failure(message: String) -> Dictionary:
	return {"ok": false, "error": message}


func _fail(message: String) -> void:
	push_error("MAPSOO_WORLD_ART_RUNTIME_OVERLAY_FAILURE: %s" % message)
	quit(1)
