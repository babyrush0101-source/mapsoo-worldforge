@tool
extends RefCounted

## Loads one extracted, provider-neutral WorldArtRuntimeOverlay 1.0 and binds
## its reviewed image catalog to an already materialized WorldLayoutPlan scene.
## The data overlay never supplies executable Godot resources.

const MANIFEST_FILENAME := "world-art-runtime-overlay.json"
const PROJECTION_PATH := "world-art-runtime-projection.json"
const OVERLAY_VERSION := "1.0.0"
const OVERLAY_DOCUMENT_TYPE := "world-art-runtime-overlay"
const PROJECTION_DOCUMENT_TYPE := "world-art-runtime-projection"
const CONTAINER_NAME := "WorldArtRuntimeOverlay"
const MAX_JSON_BYTES := 2 * 1024 * 1024
const MAX_FILE_BYTES := 64 * 1024 * 1024
const MAX_TOTAL_BYTES := 256 * 1024 * 1024
const MAX_TOTAL_PIXELS := 32 * 1024 * 1024
const MAX_FILES := 257
const PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]
const DISTRIBUTIONS := ["private", "internal-review", "public"]
const LICENSES := [
	"CC0-1.0",
	"CC-BY-4.0",
	"CC-BY-SA-4.0",
	"LicenseRef-Proprietary",
]
const USAGE_ORDER := {
	"terrain-material": 0,
	"landmark": 1,
	"hazard": 2,
	"character": 3,
}


static func load_extracted(
	manifest_path: String,
	expected_layout_sha256: String = "",
	authorization: Dictionary = {}
) -> Dictionary:
	var normalized_path := manifest_path.replace("\\", "/").simplify_path()
	if normalized_path.get_file() != MANIFEST_FILENAME:
		return _failure("Select an extracted %s file." % MANIFEST_FILENAME)
	if not FileAccess.file_exists(normalized_path):
		return _failure("World art runtime overlay manifest does not exist.")
	var manifest_read := _read_bytes(normalized_path, MAX_JSON_BYTES)
	if not manifest_read.ok:
		return manifest_read
	var manifest_parse := _parse_json(manifest_read.bytes, "Overlay manifest")
	if not manifest_parse.ok:
		return manifest_parse
	var manifest: Dictionary = manifest_parse.value
	var manifest_check := _validate_manifest(
		manifest,
		expected_layout_sha256,
		authorization
	)
	if not manifest_check.ok:
		return manifest_check

	var root := normalized_path.get_base_dir()
	var payload_by_path := {}
	var total_bytes := 0
	for file_value: Variant in manifest.files:
		var record: Dictionary = file_value
		var relative_path := str(record.path)
		var read := _read_bytes(root.path_join(relative_path), int(record.bytes))
		if not read.ok:
			return read
		if read.bytes.size() != int(record.bytes):
			return _failure("Overlay file byte length changed: %s." % relative_path)
		if _sha256_bytes(read.bytes) != str(record.sha256):
			return _failure("Overlay file SHA-256 changed: %s." % relative_path)
		total_bytes += read.bytes.size()
		if total_bytes > MAX_TOTAL_BYTES:
			return _failure("Overlay exceeds the total byte limit.")
		payload_by_path[relative_path] = read.bytes

	var projection_bytes: PackedByteArray = payload_by_path.get(
		PROJECTION_PATH,
		PackedByteArray()
	)
	var projection_parse := _parse_json(projection_bytes, "Runtime projection")
	if not projection_parse.ok:
		return projection_parse
	var projection: Dictionary = projection_parse.value
	var projection_check := _validate_projection(
		projection,
		manifest,
		projection_bytes
	)
	if not projection_check.ok:
		return projection_check

	var file_by_path := {}
	for file_value: Variant in manifest.files:
		var record: Dictionary = file_value
		file_by_path[str(record.path)] = record
	var textures := {}
	var decoded_images := {}
	var total_pixels := 0
	for image_value: Variant in projection.images:
		var image_record: Dictionary = image_value
		var path := str(image_record.path)
		var file_record: Dictionary = file_by_path.get(path, {})
		if (
			file_record.is_empty()
			or file_record.get("media_type") != "image/png"
			or int(file_record.get("bytes", -1)) != int(image_record.bytes)
			or file_record.get("sha256") != image_record.get("sha256")
		):
			return _failure("Projection image differs from the overlay inventory: %s." % path)
		var declared_size := _png_size(payload_by_path[path])
		if (
			declared_size.x != int(image_record.width)
			or declared_size.y != int(image_record.height)
			or declared_size.x < 1
			or declared_size.y < 1
		):
			return _failure("Overlay PNG header differs from the projection: %s." % path)
		total_pixels += declared_size.x * declared_size.y
		if total_pixels > MAX_TOTAL_PIXELS:
			return _failure("Overlay exceeds the decoded pixel limit.")
		var image := Image.new()
		if image.load_png_from_buffer(payload_by_path[path]) != OK:
			return _failure("Overlay image is not a canonical readable PNG: %s." % path)
		if (
			image.get_width() != int(image_record.width)
			or image.get_height() != int(image_record.height)
		):
			return _failure("Overlay image dimensions differ from the projection: %s." % path)
		decoded_images[path] = image
		var texture := PortableCompressedTexture2D.new()
		texture.keep_compressed_buffer = true
		texture.create_from_image(
			image,
			PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS
		)
		textures[path] = texture
	if textures.size() != int(manifest_check.png_count):
		return _failure("Projection does not consume the exact overlay PNG inventory.")
	for asset_value: Variant in projection.assets:
		var asset: Dictionary = asset_value
		var source_image: Image = decoded_images.get(str(asset.image_path))
		var region: Dictionary = asset.region
		var cell := source_image.get_region(Rect2i(
			int(region.x),
			int(region.y),
			int(region.width),
			int(region.height)
		))
		if _sha256_bytes(cell.get_data()) != str(asset.cell_sha256):
			return _failure("Overlay asset pixels differ from their reviewed cell digest.")

	return {
		"ok": true,
		"status": "loaded",
		"overlay": {
			"manifest": manifest,
			"manifest_sha256": _sha256_bytes(manifest_read.bytes),
			"projection": projection,
			"projection_file_sha256": _sha256_bytes(projection_bytes),
			"textures": textures,
		},
		"error": "",
	}


static func bind_scene(root: Node, loaded_overlay: Dictionary) -> Dictionary:
	if root == null or not _loaded_overlay_shape(loaded_overlay):
		return _failure("Runtime overlay scene binding input is invalid.")
	var manifest: Dictionary = loaded_overlay.manifest
	var projection: Dictionary = loaded_overlay.projection
	var expected_layout_sha := str(manifest.source.layout_plan_sha256)
	if (
		str(root.get_meta("mapsoo_layout_plan_sha256", "")) != expected_layout_sha
		or str(root.get_meta("mapsoo_profile", "")) != str(manifest.profile)
	):
		return _failure("Runtime overlay does not match the materialized scene layout.")
	if root.get_node_or_null(CONTAINER_NAME) != null:
		return _failure("Scene already contains a WorldArtRuntimeOverlay binding.")
	var postcheck := _validate_projection(
		projection,
		manifest,
		loaded_overlay.get("projection_bytes", PackedByteArray()),
		false
	)
	if not postcheck.ok:
		return postcheck
	var textures: Dictionary = loaded_overlay.textures
	if textures.size() != projection.images.size():
		return _failure("Runtime overlay texture catalog is incomplete.")
	for image_value: Variant in projection.images:
		var image_record: Dictionary = image_value
		var texture: Texture2D = textures.get(str(image_record.path))
		if (
			texture == null
			or texture.get_width() != int(image_record.width)
			or texture.get_height() != int(image_record.height)
		):
			return _failure("Runtime overlay texture catalog changed before binding.")

	var container := Node.new()
	container.name = CONTAINER_NAME
	container.set_meta("mapsoo_overlay_id", str(manifest.overlay_id))
	container.set_meta("mapsoo_projection_id", str(projection.projection_id))
	container.set_meta("mapsoo_layout_plan_sha256", expected_layout_sha)
	container.set_meta("mapsoo_profile", str(manifest.profile))
	container.set_meta("mapsoo_rights", (manifest.rights as Dictionary).duplicate(true))
	container.set_meta("mapsoo_images", (projection.images as Array).duplicate(true))
	container.set_meta("mapsoo_assets", (projection.assets as Array).duplicate(true))
	container.set_meta("mapsoo_bindings", (projection.bindings as Array).duplicate(true))
	container.set_meta("mapsoo_textures", textures.duplicate())
	root.add_child(container)
	container.owner = root
	root.set_meta("mapsoo_world_art_overlay_status", "reviewed-runtime-overlay-v1")
	root.set_meta("mapsoo_world_art_overlay_id", str(manifest.overlay_id))
	root.set_meta("mapsoo_world_art_projection_id", str(projection.projection_id))
	return {"ok": true, "status": "bound", "error": ""}


static func validate_bound_scene(root: Node, loaded_overlay: Dictionary) -> Dictionary:
	if root == null or not _loaded_overlay_shape(loaded_overlay):
		return _failure("Runtime overlay scene validation input is invalid.")
	var manifest: Dictionary = loaded_overlay.manifest
	var projection: Dictionary = loaded_overlay.projection
	var container := root.get_node_or_null(CONTAINER_NAME)
	if container == null:
		return _failure("Scene lost its WorldArtRuntimeOverlay node.")
	if (
		root.get_meta("mapsoo_world_art_overlay_status", "") != "reviewed-runtime-overlay-v1"
		or root.get_meta("mapsoo_world_art_overlay_id", "") != manifest.get("overlay_id")
		or root.get_meta("mapsoo_world_art_projection_id", "") != projection.get("projection_id")
		or container.get_meta("mapsoo_overlay_id", "") != manifest.get("overlay_id")
		or container.get_meta("mapsoo_projection_id", "") != projection.get("projection_id")
		or container.get_meta("mapsoo_layout_plan_sha256", "")
			!= manifest.source.get("layout_plan_sha256")
		or container.get_meta("mapsoo_profile", "") != manifest.get("profile")
		or container.get_meta("mapsoo_images", []) != projection.get("images")
		or container.get_meta("mapsoo_assets", []) != projection.get("assets")
		or container.get_meta("mapsoo_bindings", []) != projection.get("bindings")
	):
		return _failure("Persisted WorldArtRuntimeOverlay metadata changed.")
	var textures: Dictionary = container.get_meta("mapsoo_textures", {})
	if textures.size() != projection.images.size():
		return _failure("Persisted WorldArtRuntimeOverlay textures are incomplete.")
	for image_value: Variant in projection.images:
		var image_record: Dictionary = image_value
		var texture: Texture2D = textures.get(str(image_record.path))
		if (
			texture == null
			or texture.get_width() != int(image_record.width)
			or texture.get_height() != int(image_record.height)
		):
			return _failure("Persisted WorldArtRuntimeOverlay texture changed.")
	return {"ok": true, "status": "bound", "error": ""}


static func _validate_manifest(
	manifest: Dictionary,
	expected_layout_sha256: String,
	authorization: Dictionary
) -> Dictionary:
	if not _exact_keys(manifest, [
		"schema_version", "document_type", "overlay_id", "profile", "source",
		"rights", "review", "projection", "files", "reference_policy",
	]):
		return _failure("Overlay manifest has unsupported or missing fields.")
	if (
		manifest.get("schema_version") != OVERLAY_VERSION
		or manifest.get("document_type") != OVERLAY_DOCUMENT_TYPE
		or not _matches(
			manifest.get("overlay_id"),
			"^world-art-runtime-overlay-[a-f0-9]{16}$",
			80
		)
		or manifest.get("profile") not in PROFILES
		or typeof(manifest.get("source")) != TYPE_DICTIONARY
		or typeof(manifest.get("rights")) != TYPE_DICTIONARY
		or typeof(manifest.get("review")) != TYPE_DICTIONARY
		or typeof(manifest.get("projection")) != TYPE_DICTIONARY
		or typeof(manifest.get("files")) != TYPE_ARRAY
		or typeof(manifest.get("reference_policy")) != TYPE_DICTIONARY
	):
		return _failure("Overlay manifest identity is invalid.")
	var source: Dictionary = manifest.source
	if not _exact_keys(source, [
		"projection_id", "projection_sha256", "layout_plan_sha256",
		"review_record_sha256",
	]):
		return _failure("Overlay source binding is invalid.")
	if (
		not _safe_id(source.get("projection_id"), 100)
		or not _sha256(source.get("projection_sha256"))
		or not _sha256(source.get("layout_plan_sha256"))
		or not _sha256(source.get("review_record_sha256"))
		or (
			not expected_layout_sha256.is_empty()
			and source.get("layout_plan_sha256") != expected_layout_sha256
		)
	):
		return _failure("Overlay source digests are invalid.")
	var rights_check := _validate_rights(manifest.rights, true, authorization, manifest)
	if not rights_check.ok:
		return rights_check
	if (
		not _exact_keys(manifest.review, ["human_art", "runtime", "raspberry_pi"])
		or manifest.review.get("human_art") != "pass"
		or manifest.review.get("runtime") != "pending"
		or manifest.review.get("raspberry_pi") != "pending"
	):
		return _failure("Overlay review gates are invalid.")
	if (
		not _exact_keys(manifest.projection, ["path", "sha256"])
		or manifest.projection.get("path") != PROJECTION_PATH
		or not _sha256(manifest.projection.get("sha256"))
	):
		return _failure("Overlay projection binding is invalid.")
	if (
		not _exact_keys(manifest.reference_policy, [
			"embedded", "original_references_excluded", "raw_prompts_excluded",
			"only_one_way_audit_hashes_retained",
		])
		or manifest.reference_policy.get("embedded") != false
		or manifest.reference_policy.get("original_references_excluded") != true
		or manifest.reference_policy.get("raw_prompts_excluded") != true
		or manifest.reference_policy.get("only_one_way_audit_hashes_retained") != true
	):
		return _failure("Overlay reference privacy policy is invalid.")
	var files: Array = manifest.files
	if files.size() < 2 or files.size() > MAX_FILES:
		return _failure("Overlay file inventory size is invalid.")
	var seen := {}
	var previous := ""
	var json_count := 0
	var png_count := 0
	for index in files.size():
		var file_value: Variant = files[index]
		if typeof(file_value) != TYPE_DICTIONARY:
			return _failure("Overlay file record %d is invalid." % index)
		var file: Dictionary = file_value
		if (
			not _exact_keys(file, ["path", "media_type", "bytes", "sha256"])
			or not _safe_path(file.get("path"))
			or not _integer(file.get("bytes"), 1, MAX_FILE_BYTES)
			or not _sha256(file.get("sha256"))
		):
			return _failure("Overlay file record %d is invalid." % index)
		var path := str(file.path)
		if seen.has(path) or (index > 0 and previous.casecmp_to(path) >= 0):
			return _failure("Overlay files must be unique and sorted.")
		seen[path] = true
		previous = path
		if file.get("media_type") == "application/json" and path.ends_with(".json"):
			json_count += 1
		elif file.get("media_type") == "image/png" and path.ends_with(".png"):
			png_count += 1
		else:
			return _failure("Overlay file media type is not allowed.")
	if (
		json_count != 1
		or png_count < 1
		or not seen.has(PROJECTION_PATH)
		or seen.has(MANIFEST_FILENAME)
		or _file_record(files, PROJECTION_PATH).get("sha256")
			!= manifest.projection.get("sha256")
	):
		return _failure("Overlay files do not bind one projection and its PNG inventory.")
	var payload := manifest.duplicate(true)
	payload.erase("overlay_id")
	var expected_id := "world-art-runtime-overlay-%s" % _canonical_sha256(payload).left(16)
	if manifest.get("overlay_id") != expected_id:
		return _failure("Overlay ID does not match its canonical payload.")
	return {"ok": true, "status": "validated", "png_count": png_count, "error": ""}


static func _validate_projection(
	projection: Dictionary,
	manifest: Dictionary,
	projection_bytes: PackedByteArray = PackedByteArray(),
	verify_file_bytes: bool = true
) -> Dictionary:
	if not _exact_keys(projection, [
		"schema_version", "document_type", "projection_id", "profile", "source",
		"rights", "images", "assets", "bindings",
	]):
		return _failure("Runtime projection has unsupported or missing fields.")
	if (
		projection.get("schema_version") != OVERLAY_VERSION
		or projection.get("document_type") != PROJECTION_DOCUMENT_TYPE
		or not _matches(
			projection.get("projection_id"),
			"^world-art-runtime-projection-[a-f0-9]{16}$",
			80
		)
		or projection.get("profile") != manifest.get("profile")
		or typeof(projection.get("source")) != TYPE_DICTIONARY
		or typeof(projection.get("rights")) != TYPE_DICTIONARY
		or typeof(projection.get("images")) != TYPE_ARRAY
		or typeof(projection.get("assets")) != TYPE_ARRAY
		or typeof(projection.get("bindings")) != TYPE_ARRAY
	):
		return _failure("Runtime projection identity is invalid.")
	if (
		projection.get("projection_id") != manifest.source.get("projection_id")
		or projection.source.get("layout_plan_sha256")
			!= manifest.source.get("layout_plan_sha256")
		or projection.source.get("review_record_sha256")
			!= manifest.source.get("review_record_sha256")
		or projection.rights != manifest.rights
		or _canonical_sha256(projection) != manifest.source.get("projection_sha256")
		or (
			verify_file_bytes
			and _sha256_bytes(projection_bytes) != manifest.projection.get("sha256")
		)
	):
		return _failure("Runtime projection differs from its overlay binding.")
	var source_keys := [
		"variant_map_id", "variant_map_sha256", "layout_plan_sha256",
		"production_art_plan_id", "production_art_plan_sha256",
		"requirements_sha256", "run_set_sha256",
		"reviewed_slot_inventory_sha256", "review_record_sha256",
	]
	if not _exact_keys(projection.source, source_keys):
		return _failure("Runtime projection source binding is invalid.")
	for key: String in source_keys:
		if key.ends_with("_id"):
			if not _safe_id(projection.source.get(key), 100):
				return _failure("Runtime projection source ID is invalid.")
		elif not _sha256(projection.source.get(key)):
			return _failure("Runtime projection source digest is invalid.")
	var rights_check := _validate_rights(projection.rights, false, {}, manifest)
	if not rights_check.ok:
		return rights_check
	var images: Array = projection.images
	var assets: Array = projection.assets
	var bindings: Array = projection.bindings
	if (
		images.size() < 1 or images.size() > 256
		or assets.size() < 1 or assets.size() > 2048
		or bindings.size() < 1 or bindings.size() > 2048
	):
		return _failure("Runtime projection inventory size is invalid.")
	var image_by_task := {}
	var previous_task := ""
	for index in images.size():
		var checked := _validate_image(images[index], index)
		if not checked.ok:
			return checked
		var image: Dictionary = images[index]
		var task := str(image.task_id)
		if image_by_task.has(task) or (index > 0 and previous_task.casecmp_to(task) >= 0):
			return _failure("Runtime projection images must be unique and sorted.")
		image_by_task[task] = image
		previous_task = task
	var asset_by_slot := {}
	var previous_asset_key := ""
	for index in assets.size():
		var checked := _validate_asset_or_binding(assets[index], index, false, image_by_task)
		if not checked.ok:
			return checked
		var asset: Dictionary = assets[index]
		var asset_key := "%s/%s" % [asset.task_id, asset.slot_id]
		if (
			asset_by_slot.has(asset.slot_id)
			or (index > 0 and previous_asset_key.casecmp_to(asset_key) >= 0)
		):
			return _failure("Runtime projection assets must be unique and sorted.")
		asset_by_slot[asset.slot_id] = asset
		previous_asset_key = asset_key
	for task: String in image_by_task:
		var used := false
		for asset_value: Variant in assets:
			if (asset_value as Dictionary).get("task_id") == task:
				used = true
				break
		if not used:
			return _failure("Runtime projection contains an unused image.")
	var previous_binding_key := ""
	for index in bindings.size():
		var checked := _validate_asset_or_binding(
			bindings[index],
			index,
			true,
			image_by_task
		)
		if not checked.ok:
			return checked
		var binding: Dictionary = bindings[index]
		var asset: Dictionary = asset_by_slot.get(binding.slot_id, {})
		if asset.is_empty() or not _binding_matches_asset(binding, asset):
			return _failure("Runtime binding does not match its catalog asset.")
		var binding_key := "%d/%s/%s" % [
			int(USAGE_ORDER[binding.usage_kind]),
			binding.usage_id,
			binding.slot_id,
		]
		if index > 0 and previous_binding_key.casecmp_to(binding_key) >= 0:
			return _failure("Runtime projection bindings must be unique and sorted.")
		previous_binding_key = binding_key
	var payload := projection.duplicate(true)
	payload.erase("projection_id")
	var expected_id := "world-art-runtime-projection-%s" % _canonical_sha256(payload).left(16)
	if projection.get("projection_id") != expected_id:
		return _failure("Runtime projection ID does not match its canonical payload.")
	return {"ok": true, "status": "validated", "error": ""}


static func _validate_image(value: Variant, index: int) -> Dictionary:
	if typeof(value) != TYPE_DICTIONARY:
		return _failure("Runtime image %d is invalid." % index)
	var image: Dictionary = value
	if (
		not _exact_keys(image, [
			"task_id", "path", "media_type", "bytes", "sha256", "output_sha256",
			"width", "height", "cell_size", "pivot", "alpha_policy",
		])
		or not _safe_id(image.get("task_id"), 160)
		or not _safe_path(image.get("path"))
		or image.get("media_type") != "image/png"
		or not _integer(image.get("bytes"), 1, MAX_FILE_BYTES)
		or not _sha256(image.get("sha256"))
		or not _sha256(image.get("output_sha256"))
		or not _integer(image.get("width"), 1, 8192)
		or not _integer(image.get("height"), 1, 8192)
		or not _tuple2(image.get("cell_size"), 1)
		or not _tuple2(image.get("pivot"), 0)
		or image.get("alpha_policy") not in ["opaque", "straight-alpha"]
	):
		return _failure("Runtime image %d metadata is invalid." % index)
	var cell: Array = image.cell_size
	var pivot: Array = image.pivot
	if (
		int(image.width) % int(cell[0]) != 0
		or int(image.height) % int(cell[1]) != 0
		or int(pivot[0]) > int(cell[0])
		or int(pivot[1]) > int(cell[1])
	):
		return _failure("Runtime image %d geometry is invalid." % index)
	return {"ok": true, "status": "validated", "error": ""}


static func _validate_asset_or_binding(
	value: Variant,
	index: int,
	is_binding: bool,
	image_by_task: Dictionary
) -> Dictionary:
	if typeof(value) != TYPE_DICTIONARY:
		return _failure("Runtime asset/binding %d is invalid." % index)
	var item: Dictionary = value
	var keys := [
		"task_id", "slot_id", "role", "variant_id", "image_path", "region",
		"cell_sha256", "poses",
	]
	if is_binding:
		keys.append_array(["usage_kind", "usage_id"])
	else:
		keys.append("requirement_id")
	if not _exact_keys(item, keys):
		return _failure("Runtime asset/binding %d fields are invalid." % index)
	if (
		not _safe_id(item.get("task_id"), 160)
		or not _safe_id(item.get("slot_id"), 160)
		or not _matches(
			item.get("role"),
			"^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$",
			100
		)
		or not _safe_id(item.get("variant_id"), 160)
		or not _safe_path(item.get("image_path"))
		or not _sha256(item.get("cell_sha256"))
		or typeof(item.get("poses")) != TYPE_ARRAY
		or (item.poses as Array).size() > 256
	):
		return _failure("Runtime asset/binding %d identity is invalid." % index)
	if is_binding:
		if (
			not USAGE_ORDER.has(item.get("usage_kind"))
			or not _safe_id(item.get("usage_id"), 160)
		):
			return _failure("Runtime binding %d usage is invalid." % index)
	else:
		if not _safe_id(item.get("requirement_id"), 160):
			return _failure("Runtime asset %d requirement is invalid." % index)
	var image: Dictionary = image_by_task.get(item.task_id, {})
	if (
		image.is_empty()
		or image.get("path") != item.get("image_path")
		or not _valid_region(item.get("region"), image)
	):
		return _failure("Runtime asset/binding %d is outside its image." % index)
	var poses: Array = item.poses
	var needs_poses: bool = (
		item.get("usage_kind") == "character"
		if is_binding
		else str(item.get("role", "")).begins_with("character.")
	)
	if (needs_poses and poses.is_empty()) or (not needs_poses and not poses.is_empty()):
		return _failure("Runtime asset/binding %d pose inventory is invalid." % index)
	var previous_pose := ""
	for pose_index in poses.size():
		var pose_value: Variant = poses[pose_index]
		if typeof(pose_value) != TYPE_DICTIONARY:
			return _failure("Runtime pose is invalid.")
		var pose: Dictionary = pose_value
		if (
			not _exact_keys(
				pose,
				["action", "direction", "frame_index", "duration_ms", "region"]
			)
			or not _safe_id(pose.get("action"), 80)
			or not _safe_id(pose.get("direction"), 80)
			or not _integer(pose.get("frame_index"), 0, 255)
			or not _integer(pose.get("duration_ms"), 16, 10000)
			or not _valid_region(pose.get("region"), image, true)
		):
			return _failure("Runtime pose is invalid.")
		var pose_key := "%s/%s/%03d" % [
			pose.action,
			pose.direction,
			int(pose.frame_index),
		]
		if pose_index > 0 and previous_pose.casecmp_to(pose_key) >= 0:
			return _failure("Runtime poses must be unique and sorted.")
		previous_pose = pose_key
	return {"ok": true, "status": "validated", "error": ""}


static func _binding_matches_asset(binding: Dictionary, asset: Dictionary) -> bool:
	for key: String in [
		"task_id", "slot_id", "role", "variant_id", "image_path",
		"cell_sha256", "region", "poses",
	]:
		if binding.get(key) != asset.get(key):
			return false
	return true


static func _validate_rights(
	rights: Dictionary,
	enforce_authorization: bool,
	authorization: Dictionary,
	manifest: Dictionary
) -> Dictionary:
	var keys := ["distribution", "license"]
	if rights.has("attribution"):
		keys.append("attribution")
	if (
		not _exact_keys(rights, keys)
		or rights.get("distribution") not in DISTRIBUTIONS
		or rights.get("license") not in LICENSES
		or (
			rights.get("distribution") == "public"
			and rights.get("license") == "LicenseRef-Proprietary"
		)
		or (
			rights.get("license") in ["CC-BY-4.0", "CC-BY-SA-4.0"]
			and not rights.has("attribution")
		)
		or (
			rights.has("attribution")
			and (
				typeof(rights.attribution) != TYPE_STRING
				or str(rights.attribution).strip_edges() != str(rights.attribution)
				or str(rights.attribution).is_empty()
				or str(rights.attribution).length() > 500
			)
		)
	):
		return _failure("Runtime overlay rights are invalid.")
	if (
		enforce_authorization
		and rights.get("distribution") != "public"
		and (
			not _exact_keys(
				authorization,
				["decision", "distribution", "overlay_id", "grant_id"]
			)
			or authorization.get("decision") != "allow"
			or authorization.get("distribution") != rights.get("distribution")
			or authorization.get("overlay_id") != manifest.get("overlay_id")
			or not _safe_id(authorization.get("grant_id"), 100)
		)
	):
		return _failure("Private or internal-review overlay requires an exact local grant.")
	return {"ok": true, "status": "validated", "error": ""}


static func _loaded_overlay_shape(value: Dictionary) -> bool:
	return (
		_exact_keys(
			value,
			[
				"manifest", "manifest_sha256", "projection",
				"projection_file_sha256", "textures",
			]
		)
		and typeof(value.get("manifest")) == TYPE_DICTIONARY
		and typeof(value.get("projection")) == TYPE_DICTIONARY
		and typeof(value.get("textures")) == TYPE_DICTIONARY
		and _sha256(value.get("manifest_sha256"))
		and _sha256(value.get("projection_file_sha256"))
	)


static func _valid_region(
	value: Variant,
	image: Dictionary,
	one_cell: bool = false
) -> bool:
	if typeof(value) != TYPE_DICTIONARY:
		return false
	var region: Dictionary = value
	if (
		not _exact_keys(region, ["x", "y", "width", "height"])
		or not _integer(region.get("x"), 0, 131071)
		or not _integer(region.get("y"), 0, 131071)
		or not _integer(region.get("width"), 1, 8192)
		or not _integer(region.get("height"), 1, 8192)
	):
		return false
	var cell: Array = image.cell_size
	return (
		int(region.x) + int(region.width) <= int(image.width)
		and int(region.y) + int(region.height) <= int(image.height)
		and int(region.x) % int(cell[0]) == 0
		and int(region.y) % int(cell[1]) == 0
		and int(region.width) % int(cell[0]) == 0
		and int(region.height) % int(cell[1]) == 0
		and (
			not one_cell
			or (
				int(region.width) == int(cell[0])
				and int(region.height) == int(cell[1])
			)
		)
	)


static func _safe_path(value: Variant) -> bool:
	if not _matches(
		value,
		"^[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)*$",
		240
	):
		return false
	var path := str(value)
	return (
		not path.contains("\\")
		and not path.begins_with("/")
		and not path.split("/").has(".")
		and not path.split("/").has("..")
	)


static func _safe_id(value: Variant, maximum: int) -> bool:
	return _matches(value, "^[a-z0-9]+(?:-[a-z0-9]+)*$", maximum)


static func _sha256(value: Variant) -> bool:
	return _matches(value, "^[a-f0-9]{64}$", 64)


static func _matches(value: Variant, pattern: String, maximum: int) -> bool:
	if typeof(value) != TYPE_STRING or str(value).is_empty() or str(value).length() > maximum:
		return false
	var regex := RegEx.new()
	return regex.compile(pattern) == OK and regex.search(str(value)) != null


static func _integer(value: Variant, minimum: int, maximum: int) -> bool:
	return (
		typeof(value) in [TYPE_INT, TYPE_FLOAT]
		and is_finite(float(value))
		and float(value) == floor(float(value))
		and int(value) >= minimum
		and int(value) <= maximum
	)


static func _tuple2(value: Variant, minimum: int) -> bool:
	return (
		typeof(value) == TYPE_ARRAY
		and (value as Array).size() == 2
		and _integer(value[0], minimum, 8192)
		and _integer(value[1], minimum, 8192)
	)


static func _exact_keys(value: Dictionary, expected: Array) -> bool:
	var actual: Array = value.keys()
	actual.sort()
	var canonical := expected.duplicate()
	canonical.sort()
	return actual == canonical


static func _file_record(files: Array, path: String) -> Dictionary:
	for value: Variant in files:
		if typeof(value) == TYPE_DICTIONARY and value.get("path") == path:
			return value
	return {}


static func _read_bytes(path: String, maximum: int) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return _failure("Overlay file cannot be read: %s." % path.get_file())
	var length := file.get_length()
	if length < 1 or length > maximum:
		file.close()
		return _failure("Overlay file has an invalid byte length: %s." % path.get_file())
	var bytes := file.get_buffer(length)
	file.close()
	if bytes.size() != length:
		return _failure("Overlay file read was incomplete: %s." % path.get_file())
	return {"ok": true, "status": "read", "bytes": bytes, "error": ""}


static func _parse_json(bytes: PackedByteArray, label: String) -> Dictionary:
	var parser := JSON.new()
	if (
		parser.parse(bytes.get_string_from_utf8()) != OK
		or typeof(parser.data) != TYPE_DICTIONARY
	):
		return _failure("%s is not valid JSON." % label)
	return {"ok": true, "status": "parsed", "value": parser.data, "error": ""}


static func _canonical_sha256(value: Variant) -> String:
	return _canonical_json(value).sha256_text()


static func _canonical_json(value: Variant) -> String:
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


static func _sha256_bytes(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	if context.update(bytes) != OK:
		return ""
	return context.finish().hex_encode()


static func _png_size(bytes: PackedByteArray) -> Vector2i:
	if bytes.size() < 24:
		return Vector2i(-1, -1)
	var signature := [137, 80, 78, 71, 13, 10, 26, 10]
	for index in signature.size():
		if int(bytes[index]) != int(signature[index]):
			return Vector2i(-1, -1)
	if (
		int(bytes[8]) != 0
		or int(bytes[9]) != 0
		or int(bytes[10]) != 0
		or int(bytes[11]) != 13
		or bytes.slice(12, 16).get_string_from_ascii() != "IHDR"
	):
		return Vector2i(-1, -1)
	var width := (
		(int(bytes[16]) << 24)
		| (int(bytes[17]) << 16)
		| (int(bytes[18]) << 8)
		| int(bytes[19])
	)
	var height := (
		(int(bytes[20]) << 24)
		| (int(bytes[21]) << 16)
		| (int(bytes[22]) << 8)
		| int(bytes[23])
	)
	if width < 1 or height < 1 or width > 8192 or height > 8192:
		return Vector2i(-1, -1)
	return Vector2i(width, height)


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
