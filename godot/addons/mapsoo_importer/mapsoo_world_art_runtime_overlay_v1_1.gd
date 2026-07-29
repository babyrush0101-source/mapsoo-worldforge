@tool
extends RefCounted

## Strict, provider-neutral loader for WorldArtRuntimeOverlay 1.1.
## It composes the frozen projection 1.0 validator with the versioned visual
## placement sidecars and never accepts executable content from an archive.

const BaseOverlay = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay.gd"
)
const PlacementApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_visual_placement_applier.gd"
)

const MANIFEST_FILENAME := "world-art-runtime-overlay.json"
const PROJECTION_PATH := "world-art-runtime-projection.json"
const PLACEMENT_PLAN_PATH := "world-visual-placement-plan.json"
const PLACEMENT_MAP_PATH := "world-art-placement-map.json"
const OVERLAY_VERSION := "1.1.0"
const STATUS := "reviewed-runtime-overlay-v1-1"
const MAX_JSON_BYTES := 2 * 1024 * 1024
const MAX_FILE_BYTES := 64 * 1024 * 1024
const MAX_TOTAL_BYTES := 256 * 1024 * 1024
const MAX_TOTAL_PIXELS := 32 * 1024 * 1024
const MAX_FILES := 259
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
const LOADED_KEYS := [
	"manifest",
	"manifest_sha256",
	"projection",
	"projection_file_sha256",
	"placement_plan",
	"placement_plan_file_sha256",
	"placement_map",
	"placement_map_file_sha256",
	"texture_by_task",
	"texture_by_path",
]


static func load_extracted(
	manifest_path: String,
	expected_layout_sha256: String = "",
	authorization: Dictionary = {}
) -> Dictionary:
	var normalized_path := manifest_path.replace("\\", "/").simplify_path()
	if normalized_path.get_file() != MANIFEST_FILENAME:
		return _failure("Select an extracted %s file." % MANIFEST_FILENAME)
	if not FileAccess.file_exists(normalized_path):
		return _failure("World art runtime overlay 1.1 manifest does not exist.")
	var manifest_read := _read_bytes(normalized_path, MAX_JSON_BYTES)
	if not manifest_read.ok:
		return manifest_read
	var manifest_parse := _parse_json(manifest_read.bytes, "Overlay 1.1 manifest")
	if not manifest_parse.ok:
		return manifest_parse
	var manifest: Dictionary = manifest_parse.value
	var canonical_manifest_bytes := (
		_canonical_json(manifest) + "\n"
	).to_utf8_buffer()
	if manifest_read.bytes != canonical_manifest_bytes:
		return _failure(
			"Overlay 1.1 manifest bytes are not canonical: %s." % (
				_byte_difference(manifest_read.bytes, canonical_manifest_bytes)
			)
		)
	var manifest_check := _validate_manifest(
		manifest,
		expected_layout_sha256,
		authorization
	)
	if not manifest_check.ok:
		return manifest_check

	var root := normalized_path.get_base_dir()
	var inventory_check := _validate_directory_inventory(root, manifest.files)
	if not inventory_check.ok:
		return inventory_check
	var payload_by_path := {}
	var total_bytes := 0
	for file_value: Variant in manifest.files:
		var record: Dictionary = file_value
		var relative_path := str(record.path)
		var read := _read_bytes(root.path_join(relative_path), int(record.bytes))
		if not read.ok:
			return read
		if (
			read.bytes.size() != int(record.bytes)
			or _sha256_bytes(read.bytes) != str(record.sha256)
		):
			return _failure(
				"Overlay 1.1 file bytes changed: %s." % relative_path
			)
		total_bytes += read.bytes.size()
		if total_bytes > MAX_TOTAL_BYTES:
			return _failure("Overlay 1.1 exceeds the total byte limit.")
		payload_by_path[relative_path] = read.bytes

	var projection_parse := _parse_json(
		payload_by_path.get(PROJECTION_PATH, PackedByteArray()),
		"Runtime projection 1.0"
	)
	var plan_parse := _parse_json(
		payload_by_path.get(PLACEMENT_PLAN_PATH, PackedByteArray()),
		"WorldVisualPlacementPlan 1.0"
	)
	var map_parse := _parse_json(
		payload_by_path.get(PLACEMENT_MAP_PATH, PackedByteArray()),
		"WorldArtPlacementMap 1.0"
	)
	for parsed: Dictionary in [projection_parse, plan_parse, map_parse]:
		if not parsed.ok:
			return parsed
	var projection: Dictionary = projection_parse.value
	var placement_plan: Dictionary = plan_parse.value
	var placement_map: Dictionary = map_parse.value
	var projection_bytes: PackedByteArray = payload_by_path[PROJECTION_PATH]
	var plan_bytes: PackedByteArray = payload_by_path[PLACEMENT_PLAN_PATH]
	var map_bytes: PackedByteArray = payload_by_path[PLACEMENT_MAP_PATH]
	if (
		projection_bytes != (_canonical_json(projection) + "\n").to_utf8_buffer()
		or plan_bytes != (_canonical_json(placement_plan) + "\n").to_utf8_buffer()
		or map_bytes != (_canonical_json(placement_map) + "\n").to_utf8_buffer()
	):
		return _failure("Overlay 1.1 JSON sidecar bytes are not canonical.")
	var projection_check := BaseOverlay._validate_projection(
		projection,
		manifest,
		projection_bytes,
		true
	)
	if not projection_check.ok:
		return projection_check
	var sidecar_check := _validate_sidecars(
		manifest,
		projection,
		placement_plan,
		placement_map,
		plan_bytes,
		map_bytes,
		true
	)
	if not sidecar_check.ok:
		return sidecar_check
	var decoded := _decode_exact_png_inventory(
		manifest,
		projection,
		payload_by_path
	)
	if not decoded.ok:
		return decoded
	var pixel_check := _validate_projection_pixels(
		projection,
		decoded.image_by_task
	)
	if not pixel_check.ok:
		return pixel_check
	return {
		"ok": true,
		"status": "loaded",
		"overlay": {
			"manifest": manifest,
			"manifest_sha256": _sha256_bytes(manifest_read.bytes),
			"projection": projection,
			"projection_file_sha256": _sha256_bytes(projection_bytes),
			"placement_plan": placement_plan,
			"placement_plan_file_sha256": _sha256_bytes(plan_bytes),
			"placement_map": placement_map,
			"placement_map_file_sha256": _sha256_bytes(map_bytes),
			"texture_by_task": decoded.texture_by_task,
			"texture_by_path": decoded.texture_by_path,
		},
		"error": "",
	}


static func prepare_scene(
	root: Node,
	loaded_overlay: Dictionary,
	layout_plan: Dictionary
) -> Dictionary:
	var runtime := _runtime_inputs(loaded_overlay, layout_plan)
	if not runtime.ok:
		return runtime
	if (
		root == null
		or root.get_node_or_null("WorldArtRuntimeOverlay") != null
		or root.has_meta("mapsoo_world_art_overlay_status")
		or root.has_meta("mapsoo_world_art_overlay_id")
		or root.has_meta("mapsoo_world_art_projection_id")
	):
		return _failure("Scene already contains a base runtime overlay catalog.")
	var prepared := PlacementApplier.prepare(
		root,
		loaded_overlay.placement_plan,
		runtime.binding_by_placement,
		runtime.asset_by_slot,
		runtime.texture_by_task,
		layout_plan
	)
	if not prepared.ok:
		return prepared
	var manifest: Dictionary = loaded_overlay.manifest
	return {
		"ok": true,
		"status": "prepared",
		"root_instance_id": root.get_instance_id(),
		"overlay_id": str(manifest.overlay_id),
		"projection_id": str(loaded_overlay.projection.projection_id),
		"placement_plan_id": str(loaded_overlay.placement_plan.plan_id),
		"placement_map_id": str(loaded_overlay.placement_map.map_id),
		"layout_plan_sha256": str(manifest.source.layout_plan_sha256),
		"profile": str(manifest.profile),
		"base_overlay": _base_overlay(loaded_overlay),
		"applier": prepared,
		"error": "",
	}


static func apply_scene(root: Node, prepared: Dictionary) -> Dictionary:
	if (
		root == null
		or not _exact_keys(prepared, [
			"ok", "status", "root_instance_id", "overlay_id",
			"projection_id", "placement_plan_id", "placement_map_id",
			"layout_plan_sha256", "profile", "base_overlay", "applier", "error",
		])
		or prepared.get("ok") != true
		or prepared.get("status") != "prepared"
		or int(prepared.get("root_instance_id", 0)) != root.get_instance_id()
		or typeof(prepared.get("base_overlay")) != TYPE_DICTIONARY
		or typeof(prepared.get("applier")) != TYPE_DICTIONARY
		or not BaseOverlay._loaded_overlay_shape(prepared.base_overlay)
		or not _placement_prepared_attachable(root, prepared.applier)
		or (prepared.applier as Dictionary).get("plan_id")
			!= prepared.get("placement_plan_id")
		or root.get_meta("mapsoo_layout_plan_sha256", "")
			!= prepared.get("layout_plan_sha256")
		or root.get_meta("mapsoo_profile", "") != prepared.get("profile")
		or root.get_node_or_null("WorldArtRuntimeOverlay") != null
		or root.has_meta("mapsoo_world_art_overlay_status")
		or root.has_meta("mapsoo_world_art_overlay_id")
		or root.has_meta("mapsoo_world_art_projection_id")
		or root.has_meta("mapsoo_world_art_overlay_v1_1_status")
		or root.has_meta("mapsoo_world_art_overlay_v1_1_id")
		or root.has_meta("mapsoo_world_visual_placement_plan_id")
		or root.has_meta("mapsoo_world_art_placement_map_id")
	):
		return _failure("Prepared runtime overlay 1.1 input is invalid.")
	var base_bound := BaseOverlay.bind_scene(root, prepared.base_overlay)
	if not base_bound.ok:
		return base_bound
	var applied := PlacementApplier.apply(root, prepared.applier)
	if not applied.ok:
		return applied
	root.set_meta("mapsoo_world_art_overlay_v1_1_status", STATUS)
	root.set_meta("mapsoo_world_art_overlay_v1_1_id", str(prepared.overlay_id))
	root.set_meta(
		"mapsoo_world_visual_placement_plan_id",
		str(prepared.placement_plan_id)
	)
	root.set_meta(
		"mapsoo_world_art_placement_map_id",
		str(prepared.placement_map_id)
	)
	return {
		"ok": true,
		"status": STATUS,
		"placements": int(applied.placements),
		"counts": (applied.counts as Dictionary).duplicate(true),
		"error": "",
	}


static func bind_scene(
	root: Node,
	loaded_overlay: Dictionary,
	layout_plan: Dictionary
) -> Dictionary:
	var prepared := prepare_scene(root, loaded_overlay, layout_plan)
	if not prepared.ok:
		return prepared
	return apply_scene(root, prepared)


static func validate_bound_scene(
	root: Node,
	loaded_overlay: Dictionary,
	layout_plan: Dictionary
) -> Dictionary:
	var runtime := _runtime_inputs(loaded_overlay, layout_plan)
	if not runtime.ok:
		return runtime
	var manifest: Dictionary = loaded_overlay.manifest
	var base_check := BaseOverlay.validate_bound_scene(
		root,
		_base_overlay(loaded_overlay)
	)
	if not base_check.ok:
		return base_check
	if (
		root == null
		or root.get_meta("mapsoo_world_art_overlay_status", "")
			!= "reviewed-runtime-overlay-v1"
		or root.get_meta("mapsoo_world_art_overlay_id", "")
			!= manifest.get("overlay_id")
		or root.get_meta("mapsoo_world_art_projection_id", "")
			!= loaded_overlay.projection.get("projection_id")
		or root.get_meta("mapsoo_world_art_overlay_v1_1_status", "") != STATUS
		or root.get_meta("mapsoo_world_art_overlay_v1_1_id", "")
			!= manifest.get("overlay_id")
		or root.get_meta("mapsoo_world_visual_placement_plan_id", "")
			!= loaded_overlay.placement_plan.get("plan_id")
		or root.get_meta("mapsoo_world_art_placement_map_id", "")
			!= loaded_overlay.placement_map.get("map_id")
	):
		return _failure("Persisted runtime overlay 1.1 identity changed.")
	var checked := PlacementApplier.validate_scene(
		root,
		loaded_overlay.placement_plan,
		runtime.binding_by_placement,
		runtime.asset_by_slot,
		runtime.texture_by_task,
		layout_plan
	)
	if not checked.ok:
		return checked
	return {
		"ok": true,
		"status": STATUS,
		"placements": int(checked.placements),
		"counts": (checked.counts as Dictionary).duplicate(true),
		"error": "",
	}


static func _runtime_inputs(
	loaded_overlay: Dictionary,
	layout_plan: Dictionary
) -> Dictionary:
	if not _loaded_overlay_shape(loaded_overlay):
		return _failure("Loaded runtime overlay 1.1 shape is invalid.")
	var manifest: Dictionary = loaded_overlay.manifest
	var projection: Dictionary = loaded_overlay.projection
	var placement_plan: Dictionary = loaded_overlay.placement_plan
	var placement_map: Dictionary = loaded_overlay.placement_map
	var manifest_check := _validate_manifest(manifest, "", {}, false)
	if not manifest_check.ok:
		return manifest_check
	if (
		_sha256_bytes((_canonical_json(manifest) + "\n").to_utf8_buffer())
			!= loaded_overlay.get("manifest_sha256")
		or _sha256_bytes((_canonical_json(projection) + "\n").to_utf8_buffer())
			!= loaded_overlay.get("projection_file_sha256")
		or _sha256_bytes((_canonical_json(placement_plan) + "\n").to_utf8_buffer())
			!= loaded_overlay.get("placement_plan_file_sha256")
		or _sha256_bytes((_canonical_json(placement_map) + "\n").to_utf8_buffer())
			!= loaded_overlay.get("placement_map_file_sha256")
	):
		return _failure("Loaded runtime overlay 1.1 canonical bytes changed.")
	var projection_check := BaseOverlay._validate_projection(
		projection,
		manifest,
		PackedByteArray(),
		false
	)
	if not projection_check.ok:
		return projection_check
	var sidecar_check := _validate_sidecars(
		manifest,
		projection,
		placement_plan,
		placement_map,
		PackedByteArray(),
		PackedByteArray(),
		false
	)
	if not sidecar_check.ok:
		return sidecar_check
	if (
		typeof(layout_plan) != TYPE_DICTIONARY
		or layout_plan.get("plan_id") != manifest.source.get("layout_plan_id")
		or layout_plan.get("profile") != manifest.get("profile")
		or layout_plan.get("bounds") != placement_plan.get("bounds")
	):
		return _failure("Runtime overlay 1.1 does not match the supplied layout plan.")
	var textures: Dictionary = loaded_overlay.texture_by_task
	var textures_by_path: Dictionary = loaded_overlay.texture_by_path
	var texture_check := _validate_texture_catalog(
		projection,
		textures,
		textures_by_path
	)
	if not texture_check.ok:
		return texture_check
	var image_by_task := {}
	for image_value: Variant in projection.images:
		var image: Dictionary = image_value
		var texture: Texture2D = textures.get(str(image.task_id))
		image_by_task[str(image.task_id)] = texture.get_image()
	var pixel_check := _validate_projection_pixels(projection, image_by_task)
	if not pixel_check.ok:
		return pixel_check
	return _placement_runtime_inputs(
		placement_plan,
		placement_map,
		projection,
		textures
	)


static func _validate_manifest(
	manifest: Dictionary,
	expected_layout_sha256: String,
	authorization: Dictionary,
	enforce_authorization: bool = true
) -> Dictionary:
	if not _exact_keys(manifest, [
		"schema_version", "document_type", "overlay_id", "profile", "source",
		"rights", "review", "projection", "visual_placement", "files",
		"reference_policy",
	]):
		return _failure("Overlay 1.1 manifest fields are invalid.")
	if (
		manifest.get("schema_version") != OVERLAY_VERSION
		or manifest.get("document_type") != "world-art-runtime-overlay"
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
		or typeof(manifest.get("visual_placement")) != TYPE_DICTIONARY
		or typeof(manifest.get("files")) != TYPE_ARRAY
		or typeof(manifest.get("reference_policy")) != TYPE_DICTIONARY
	):
		return _failure("Overlay 1.1 manifest identity is invalid.")
	var source: Dictionary = manifest.source
	if not _exact_keys(source, [
		"projection_id", "projection_sha256", "layout_plan_id",
		"layout_plan_sha256", "placement_plan_id", "placement_plan_sha256",
		"placement_map_id", "placement_map_sha256", "review_record_sha256",
	]):
		return _failure("Overlay 1.1 source binding is invalid.")
	for key: String in [
		"projection_id", "layout_plan_id", "placement_plan_id", "placement_map_id",
	]:
		if not _safe_id(source.get(key), 160):
			return _failure("Overlay 1.1 source ID is invalid.")
	for key: String in [
		"projection_sha256", "layout_plan_sha256", "placement_plan_sha256",
		"placement_map_sha256", "review_record_sha256",
	]:
		if not _sha256(source.get(key)):
			return _failure("Overlay 1.1 source digest is invalid.")
	if (
		not expected_layout_sha256.is_empty()
		and source.get("layout_plan_sha256") != expected_layout_sha256
	):
		return _failure("Overlay 1.1 layout digest differs from the expected layout.")
	var rights_check := _validate_rights(
		manifest.rights,
		authorization,
		manifest,
		enforce_authorization
	)
	if not rights_check.ok:
		return rights_check
	if (
		not _exact_keys(manifest.review, [
			"human_art", "runtime", "raspberry_pi",
		])
		or manifest.review.get("human_art") != "pass"
		or manifest.review.get("runtime") != "pending"
		or manifest.review.get("raspberry_pi") != "pending"
	):
		return _failure("Overlay 1.1 review gates are invalid.")
	if (
		not _exact_keys(manifest.projection, ["path", "sha256"])
		or manifest.projection.get("path") != PROJECTION_PATH
		or not _sha256(manifest.projection.get("sha256"))
		or not _exact_keys(manifest.visual_placement, [
			"plan_path", "plan_sha256", "map_path", "map_sha256",
		])
		or manifest.visual_placement.get("plan_path") != PLACEMENT_PLAN_PATH
		or not _sha256(manifest.visual_placement.get("plan_sha256"))
		or manifest.visual_placement.get("map_path") != PLACEMENT_MAP_PATH
		or not _sha256(manifest.visual_placement.get("map_sha256"))
	):
		return _failure("Overlay 1.1 document references are invalid.")
	if (
		not _exact_keys(manifest.reference_policy, [
			"embedded", "original_references_excluded", "raw_prompts_excluded",
			"only_one_way_audit_hashes_retained",
		])
		or manifest.reference_policy.get("embedded") != false
		or manifest.reference_policy.get("original_references_excluded") != true
		or manifest.reference_policy.get("raw_prompts_excluded") != true
		or manifest.reference_policy.get(
			"only_one_way_audit_hashes_retained"
		) != true
	):
		return _failure("Overlay 1.1 reference privacy policy is invalid.")
	var files: Array = manifest.files
	if files.size() < 4 or files.size() > MAX_FILES:
		return _failure("Overlay 1.1 file inventory size is invalid.")
	var seen := {}
	var previous := ""
	var json_count := 0
	var png_count := 0
	for index: int in files.size():
		var value: Variant = files[index]
		if typeof(value) != TYPE_DICTIONARY:
			return _failure("Overlay 1.1 file record is invalid.")
		var file: Dictionary = value
		if (
			not _exact_keys(file, ["path", "media_type", "bytes", "sha256"])
			or not _safe_path(file.get("path"))
			or not _integer(file.get("bytes"), 1, MAX_FILE_BYTES)
			or not _sha256(file.get("sha256"))
		):
			return _failure("Overlay 1.1 file record is invalid.")
		var path := str(file.path)
		if seen.has(path) or (index > 0 and previous.casecmp_to(path) >= 0):
			return _failure("Overlay 1.1 files must be unique and sorted.")
		seen[path] = true
		previous = path
		if file.get("media_type") == "application/json" and path.ends_with(".json"):
			json_count += 1
		elif file.get("media_type") == "image/png" and path.ends_with(".png"):
			png_count += 1
		else:
			return _failure("Overlay 1.1 file media type is invalid.")
	if (
		json_count != 3
		or png_count < 1
		or seen.has(MANIFEST_FILENAME)
		or not seen.has(PROJECTION_PATH)
		or not seen.has(PLACEMENT_PLAN_PATH)
		or not seen.has(PLACEMENT_MAP_PATH)
		or _file_record(files, PROJECTION_PATH).get("sha256")
			!= manifest.projection.get("sha256")
		or _file_record(files, PLACEMENT_PLAN_PATH).get("sha256")
			!= manifest.visual_placement.get("plan_sha256")
		or _file_record(files, PLACEMENT_MAP_PATH).get("sha256")
			!= manifest.visual_placement.get("map_sha256")
	):
		return _failure("Overlay 1.1 inventory does not exactly bind its documents.")
	var payload := manifest.duplicate(true)
	payload.erase("overlay_id")
	var expected_id := "world-art-runtime-overlay-%s" % (
		_canonical_sha256(payload).left(16)
	)
	if manifest.get("overlay_id") != expected_id:
		return _failure("Overlay 1.1 ID does not match its canonical payload.")
	return {
		"ok": true,
		"status": "validated",
		"png_count": png_count,
		"error": "",
	}


static func _validate_sidecars(
	manifest: Dictionary,
	projection: Dictionary,
	plan: Dictionary,
	map: Dictionary,
	plan_bytes: PackedByteArray,
	map_bytes: PackedByteArray,
	verify_file_bytes: bool
) -> Dictionary:
	var plan_check := _validate_placement_plan(plan)
	if not plan_check.ok:
		return plan_check
	var map_check := _validate_placement_map(map)
	if not map_check.ok:
		return map_check
	var source: Dictionary = manifest.source
	var map_source: Dictionary = map.source
	var projection_source: Dictionary = projection.source
	if (
		plan.get("profile") != manifest.get("profile")
		or map.get("profile") != manifest.get("profile")
		or plan.get("plan_id") != source.get("placement_plan_id")
		or map.get("map_id") != source.get("placement_map_id")
		or plan.source.get("layout_plan_id") != source.get("layout_plan_id")
		or plan.source.get("layout_plan_sha256") != source.get("layout_plan_sha256")
		or map_source.get("layout_plan_id") != source.get("layout_plan_id")
		or map_source.get("layout_plan_sha256") != source.get("layout_plan_sha256")
		or map_source.get("placement_plan_id") != plan.get("plan_id")
		or map_source.get("placement_plan_sha256")
			!= source.get("placement_plan_sha256")
		or map_source.get("review_record_sha256")
			!= source.get("review_record_sha256")
		or projection_source.get("review_record_sha256")
			!= source.get("review_record_sha256")
		or map_source.get("requirements_sha256")
			!= projection_source.get("requirements_sha256")
		or map_source.get("production_art_plan_id")
			!= projection_source.get("production_art_plan_id")
		or map_source.get("production_art_plan_sha256")
			!= projection_source.get("production_art_plan_sha256")
		or map_source.get("reviewed_slot_inventory_sha256")
			!= projection_source.get("reviewed_slot_inventory_sha256")
		or _canonical_sha256(plan) != source.get("placement_plan_sha256")
		or _canonical_sha256(map) != source.get("placement_map_sha256")
		or (
			verify_file_bytes
			and (
				_sha256_bytes(plan_bytes)
					!= manifest.visual_placement.get("plan_sha256")
				or _sha256_bytes(map_bytes)
					!= manifest.visual_placement.get("map_sha256")
			)
		)
	):
		return _failure("Overlay 1.1 sidecar source bindings are inconsistent.")
	return _placement_runtime_inputs(plan, map, projection, {})


static func _validate_placement_plan(plan: Dictionary) -> Dictionary:
	if (
		not _exact_keys(plan, [
			"schema_version", "document_type", "status", "plan_id", "profile",
			"source", "bounds", "placements",
		])
		or plan.get("schema_version") != "1.0.0"
		or plan.get("document_type") != "world-visual-placement-plan"
		or plan.get("status") != "planned"
		or not _matches(
			plan.get("plan_id"),
			"^world-visual-placement-plan-[a-f0-9]{16}$",
			100
		)
		or plan.get("profile") not in PROFILES
		or typeof(plan.get("source")) != TYPE_DICTIONARY
		or typeof(plan.get("bounds")) != TYPE_DICTIONARY
		or typeof(plan.get("placements")) != TYPE_ARRAY
	):
		return _failure("WorldVisualPlacementPlan 1.0 envelope is invalid.")
	if (
		not _exact_keys(plan.source, [
			"layout_plan_id", "layout_plan_path", "layout_plan_sha256",
		])
		or not _safe_id(plan.source.get("layout_plan_id"), 100)
		or plan.source.get("layout_plan_path") != "world-layout-plan.json"
		or not _sha256(plan.source.get("layout_plan_sha256"))
		or not _exact_keys(plan.bounds, ["width", "height", "unit"])
		or not _integer(plan.bounds.get("width"), 16, 512)
		or not _integer(plan.bounds.get("height"), 12, 512)
		or plan.bounds.get("unit") != "logical-tile"
	):
		return _failure("WorldVisualPlacementPlan 1.0 source or bounds are invalid.")
	var placements: Array = plan.placements
	if placements.is_empty() or placements.size() > 2048:
		return _failure("WorldVisualPlacementPlan 1.0 inventory is invalid.")
	var seen := {}
	var previous := ""
	for index: int in placements.size():
		var value: Variant = placements[index]
		if typeof(value) != TYPE_DICTIONARY:
			return _failure("World visual placement is invalid.")
		var placement: Dictionary = value
		var keys := ["placement_id", "kind", "role", "anchor", "render"]
		if placement.has("variant_id"):
			keys.append("variant_id")
		if placement.get("kind") == "actor":
			keys.append("controller")
		elif placement.get("kind") == "effect":
			keys.append("trigger")
		if not _exact_keys(placement, keys):
			return _failure("World visual placement fields are invalid.")
		var checked := PlacementApplier._validate_placement(
			placement,
			plan.bounds
		)
		if not checked.ok:
			return checked
		var render: Dictionary = placement.render
		var render_keys := (
			["layer", "order", "parallax", "repeat"]
			if placement.kind == "depth-plane"
			else ["layer", "order", "y_sort"]
		)
		if (
			not _exact_keys(render, render_keys)
			or (
				placement.kind == "depth-plane"
				and (
					not _exact_keys(render.parallax, ["x", "y"])
					or not _exact_keys(render.repeat, ["x", "y"])
				)
			)
		):
			return _failure("World visual placement render fields are invalid.")
		var placement_id := str(placement.placement_id)
		var key := "%d/%+06d/%s" % [
			int(PlacementApplier.LAYER_ORDER[placement.render.layer]),
			int(placement.render.order),
			placement_id,
		]
		if (
			seen.has(placement_id)
			or (index > 0 and previous.casecmp_to(key) >= 0)
		):
			return _failure("World visual placements must be unique and sorted.")
		seen[placement_id] = true
		previous = key
	var identity := {
		"profile": plan.profile,
		"source": plan.source,
		"bounds": plan.bounds,
		"placements": plan.placements,
	}
	if plan.get("plan_id") != "world-visual-placement-plan-%s" % (
		_canonical_sha256(identity).left(16)
	):
		return _failure("WorldVisualPlacementPlan ID is not canonical.")
	return {"ok": true, "status": "validated", "error": ""}


static func _validate_placement_map(map: Dictionary) -> Dictionary:
	if (
		not _exact_keys(map, [
			"schema_version", "document_type", "map_id", "profile", "source",
			"bindings",
		])
		or map.get("schema_version") != "1.0.0"
		or map.get("document_type") != "world-art-placement-map"
		or not _matches(
			map.get("map_id"),
			"^world-art-placement-map-[a-f0-9]{16}$",
			100
		)
		or map.get("profile") not in PROFILES
		or typeof(map.get("source")) != TYPE_DICTIONARY
		or typeof(map.get("bindings")) != TYPE_ARRAY
	):
		return _failure("WorldArtPlacementMap 1.0 envelope is invalid.")
	var source: Dictionary = map.source
	if not _exact_keys(source, [
		"layout_plan_id", "layout_plan_sha256", "placement_plan_id",
		"placement_plan_sha256", "requirements_sha256",
		"production_art_plan_id", "production_art_plan_sha256",
		"reviewed_slot_inventory_sha256", "review_record_sha256",
	]):
		return _failure("WorldArtPlacementMap 1.0 source is invalid.")
	for key: String in [
		"layout_plan_id", "placement_plan_id", "production_art_plan_id",
	]:
		if not _safe_id(source.get(key), 160):
			return _failure("WorldArtPlacementMap source ID is invalid.")
	for key: String in source:
		if key.ends_with("_sha256") and not _sha256(source.get(key)):
			return _failure("WorldArtPlacementMap source digest is invalid.")
	var bindings: Array = map.bindings
	if bindings.is_empty() or bindings.size() > 2048:
		return _failure("WorldArtPlacementMap binding inventory is invalid.")
	var seen := {}
	for value: Variant in bindings:
		if typeof(value) != TYPE_DICTIONARY:
			return _failure("WorldArtPlacementMap binding is invalid.")
		var binding: Dictionary = value
		if (
			not _exact_keys(binding, [
				"placement_id", "task_id", "slot_id", "requirement_id",
				"role", "variant_id", "atlas_path", "atlas_cell",
			])
			or not _safe_id(binding.get("placement_id"), 160)
			or not _safe_id(binding.get("task_id"), 160)
			or not _safe_id(binding.get("slot_id"), 160)
			or not _safe_id(binding.get("requirement_id"), 160)
			or not _role(binding.get("role"))
			or not _safe_id(binding.get("variant_id"), 160)
			or not _safe_path(binding.get("atlas_path"))
			or not _valid_atlas_cell(binding.get("atlas_cell"))
			or seen.has(str(binding.placement_id))
		):
			return _failure("WorldArtPlacementMap binding is invalid.")
		seen[str(binding.placement_id)] = true
	var identity := {
		"profile": map.profile,
		"source": map.source,
		"bindings": map.bindings,
	}
	if map.get("map_id") != "world-art-placement-map-%s" % (
		_canonical_sha256(identity).left(16)
	):
		return _failure("WorldArtPlacementMap ID is not canonical.")
	return {"ok": true, "status": "validated", "error": ""}


static func _placement_runtime_inputs(
	plan: Dictionary,
	map: Dictionary,
	projection: Dictionary,
	texture_by_task_all: Dictionary
) -> Dictionary:
	var placements: Array = plan.placements
	var bindings: Array = map.bindings
	if bindings.size() != placements.size():
		return _failure("Placement map does not exactly cover the placement plan.")
	var image_by_task := {}
	for image_value: Variant in projection.images:
		var image: Dictionary = image_value
		image_by_task[str(image.task_id)] = image
	var asset_by_slot_all := {}
	for asset_value: Variant in projection.assets:
		var asset: Dictionary = asset_value
		asset_by_slot_all[str(asset.slot_id)] = asset
	var binding_by_placement := {}
	var asset_by_slot := {}
	var texture_by_task := {}
	for index: int in placements.size():
		var placement: Dictionary = placements[index]
		var map_binding: Dictionary = bindings[index]
		var asset: Dictionary = asset_by_slot_all.get(
			str(map_binding.slot_id),
			{}
		)
		var image: Dictionary = image_by_task.get(str(map_binding.task_id), {})
		var expected_variant := str(placement.get("variant_id", "canonical"))
		if (
			map_binding.get("placement_id") != placement.get("placement_id")
			or map_binding.get("role") != placement.get("role")
			or map_binding.get("variant_id") != expected_variant
			or asset.is_empty()
			or image.is_empty()
			or map_binding.get("task_id") != asset.get("task_id")
			or map_binding.get("slot_id") != asset.get("slot_id")
			or map_binding.get("requirement_id") != asset.get("requirement_id")
			or map_binding.get("role") != asset.get("role")
			or map_binding.get("variant_id") != asset.get("variant_id")
			or map_binding.get("atlas_path") != asset.get("image_path")
			or not _atlas_cell_matches_region(
				map_binding.atlas_cell,
				asset.region,
				image
			)
		):
			return _failure(
				"Placement %s does not match its exact projection asset." % (
					str(placement.get("placement_id", "unknown"))
				)
			)
		var placement_id := str(placement.placement_id)
		var slot_id := str(asset.slot_id)
		var task_id := str(asset.task_id)
		binding_by_placement[placement_id] = asset.duplicate(true)
		if asset_by_slot.has(slot_id) and asset_by_slot[slot_id] != asset:
			return _failure("Repeated placement slot resolves ambiguously.")
		asset_by_slot[slot_id] = asset.duplicate(true)
		if not texture_by_task_all.is_empty():
			var texture: Texture2D = texture_by_task_all.get(task_id)
			if texture == null:
				return _failure("Placement task texture is missing.")
			texture_by_task[task_id] = texture
	return {
		"ok": true,
		"status": "resolved",
		"binding_by_placement": binding_by_placement,
		"asset_by_slot": asset_by_slot,
		"texture_by_task": texture_by_task,
		"error": "",
	}


static func _decode_exact_png_inventory(
	manifest: Dictionary,
	projection: Dictionary,
	payload_by_path: Dictionary
) -> Dictionary:
	var file_by_path := {}
	var manifest_pngs := {}
	for value: Variant in manifest.files:
		var record: Dictionary = value
		file_by_path[str(record.path)] = record
		if record.get("media_type") == "image/png":
			manifest_pngs[str(record.path)] = true
	var consumed_pngs := {}
	var image_by_task := {}
	var texture_by_task := {}
	var texture_by_path := {}
	var total_pixels := 0
	for value: Variant in projection.images:
		var image_record: Dictionary = value
		var task_id := str(image_record.task_id)
		var path := str(image_record.path)
		var file_record: Dictionary = file_by_path.get(path, {})
		if (
			file_record.is_empty()
			or file_record.get("media_type") != "image/png"
			or int(file_record.get("bytes", -1)) != int(image_record.bytes)
			or file_record.get("sha256") != image_record.get("sha256")
			or consumed_pngs.has(path)
		):
			return _failure("Projection image does not match the exact PNG inventory.")
		var bytes: PackedByteArray = payload_by_path.get(path, PackedByteArray())
		var declared := BaseOverlay._png_size(bytes)
		if (
			declared.x != int(image_record.width)
			or declared.y != int(image_record.height)
		):
			return _failure("Projection PNG header dimensions changed.")
		total_pixels += declared.x * declared.y
		if total_pixels > MAX_TOTAL_PIXELS:
			return _failure("Overlay 1.1 exceeds the decoded pixel limit.")
		var image := Image.new()
		if (
			image.load_png_from_buffer(bytes) != OK
			or image.get_width() != int(image_record.width)
			or image.get_height() != int(image_record.height)
		):
			return _failure("Projection PNG cannot be decoded exactly.")
		var texture := PortableCompressedTexture2D.new()
		texture.keep_compressed_buffer = true
		texture.create_from_image(
			image,
			PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS
		)
		consumed_pngs[path] = true
		image_by_task[task_id] = image
		texture_by_task[task_id] = texture
		texture_by_path[path] = texture
	if consumed_pngs != manifest_pngs:
		return _failure("Projection does not consume the exact PNG inventory.")
	return {
		"ok": true,
		"status": "decoded",
		"image_by_task": image_by_task,
		"texture_by_task": texture_by_task,
		"texture_by_path": texture_by_path,
		"error": "",
	}


static func _validate_projection_pixels(
	projection: Dictionary,
	image_by_task: Dictionary
) -> Dictionary:
	for value: Variant in projection.assets:
		var asset: Dictionary = value
		var image: Image = image_by_task.get(str(asset.task_id))
		var region: Dictionary = asset.region
		if image == null:
			return _failure("Projection asset image is missing.")
		var cell := image.get_region(Rect2i(
			int(region.x), int(region.y),
			int(region.width), int(region.height)
		))
		if _sha256_bytes(cell.get_data()) != str(asset.cell_sha256):
			return _failure("Projection asset pixels differ from reviewed evidence.")
	return {"ok": true, "status": "validated", "error": ""}


static func _validate_texture_catalog(
	projection: Dictionary,
	textures_by_task: Dictionary,
	textures_by_path: Dictionary
) -> Dictionary:
	if (
		textures_by_task.size() != projection.images.size()
		or textures_by_path.size() != projection.images.size()
	):
		return _failure("Loaded overlay texture inventory changed.")
	var seen_tasks := {}
	var seen_paths := {}
	for value: Variant in projection.images:
		var image: Dictionary = value
		var task_id := str(image.task_id)
		var path := str(image.path)
		var texture: Texture2D = textures_by_task.get(task_id)
		var path_texture: Texture2D = textures_by_path.get(path)
		if (
			texture == null
			or path_texture == null
			or texture != path_texture
			or texture.get_width() != int(image.width)
			or texture.get_height() != int(image.height)
		):
			return _failure("Loaded overlay texture changed.")
		seen_tasks[task_id] = true
		seen_paths[path] = true
	for key: Variant in textures_by_task:
		if typeof(key) != TYPE_STRING or not seen_tasks.has(str(key)):
			return _failure("Loaded overlay contains an extra task texture.")
	for key: Variant in textures_by_path:
		if typeof(key) != TYPE_STRING or not seen_paths.has(str(key)):
			return _failure("Loaded overlay contains an extra texture.")
	return {"ok": true, "status": "validated", "error": ""}


static func _base_overlay(loaded_overlay: Dictionary) -> Dictionary:
	return {
		"manifest": loaded_overlay.get("manifest", {}),
		"manifest_sha256": loaded_overlay.get("manifest_sha256", ""),
		"projection": loaded_overlay.get("projection", {}),
		"projection_file_sha256": loaded_overlay.get(
			"projection_file_sha256",
			""
		),
		"textures": loaded_overlay.get("texture_by_path", {}),
	}


static func _placement_prepared_attachable(
	root: Node,
	prepared: Dictionary
) -> bool:
	var container_value: Variant = prepared.get("container")
	if not container_value is Node:
		return false
	var container: Node = container_value
	return (
		prepared.get("ok") == true
		and prepared.get("status") == "prepared"
		and int(prepared.get("root_instance_id", 0)) == root.get_instance_id()
		and container.get_parent() == null
		and container.name == "WorldVisualPlacements"
		and container.get_child_count() == PlacementApplier.LAYERS.size()
		and container.get_meta("mapsoo_world_visual_plan_id", "")
			== prepared.get("plan_id")
		and root.get_node_or_null("MapsooLayoutMaterialization") != null
		and root.get_meta("mapsoo_layout_materialization", "")
			== "profile-layout-v1"
		and root.get_node_or_null(
			"MapsooLayoutMaterialization/WorldVisualPlacements"
		) == null
		and not root.has_meta("mapsoo_world_visual_status")
	)


static func _atlas_cell_matches_region(
	cell: Dictionary,
	region: Dictionary,
	image: Dictionary
) -> bool:
	var cell_size: Array = image.cell_size
	return (
		int(region.get("x", -1))
			== int(cell.column) * int(cell_size[0])
		and int(region.get("y", -1))
			== int(cell.row) * int(cell_size[1])
		and int(region.get("width", -1))
			== int(cell.column_span) * int(cell_size[0])
		and int(region.get("height", -1))
			== int(cell.row_span) * int(cell_size[1])
	)


static func _valid_atlas_cell(value: Variant) -> bool:
	if typeof(value) != TYPE_DICTIONARY:
		return false
	var cell: Dictionary = value
	return (
		_exact_keys(cell, ["column", "row", "column_span", "row_span"])
		and _integer(cell.get("column"), 0, 255)
		and _integer(cell.get("row"), 0, 255)
		and _integer(cell.get("column_span"), 1, 256)
		and _integer(cell.get("row_span"), 1, 256)
	)


static func _validate_directory_inventory(
	root: String,
	records: Array
) -> Dictionary:
	var scanned := _scan_directory(root, "")
	if not scanned.ok:
		return scanned
	var expected: Array[String] = [MANIFEST_FILENAME]
	for value: Variant in records:
		expected.append(str((value as Dictionary).path))
	expected.sort()
	var actual: Array = scanned.files
	actual.sort()
	if actual != expected:
		return _failure("Extracted overlay directory differs from its exact inventory.")
	return {"ok": true, "status": "validated", "error": ""}


static func _scan_directory(root: String, relative: String) -> Dictionary:
	var path := root if relative.is_empty() else root.path_join(relative)
	var directory := DirAccess.open(path)
	if directory == null:
		return _failure("Extracted overlay directory cannot be read.")
	var files: Array[String] = []
	directory.list_dir_begin()
	var name := directory.get_next()
	while not name.is_empty():
		if name != "." and name != "..":
			var child_relative := name if relative.is_empty() else relative.path_join(name)
			if directory.is_link(name):
				directory.list_dir_end()
				return _failure("Extracted overlay must not contain links.")
			if directory.current_is_dir():
				var nested := _scan_directory(root, child_relative)
				if not nested.ok:
					directory.list_dir_end()
					return nested
				files.append_array(nested.files)
			else:
				files.append(child_relative.replace("\\", "/"))
		name = directory.get_next()
	directory.list_dir_end()
	return {"ok": true, "status": "scanned", "files": files, "error": ""}


static func _validate_rights(
	rights: Dictionary,
	authorization: Dictionary,
	manifest: Dictionary,
	enforce_authorization: bool
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
		return _failure("Overlay 1.1 rights are invalid.")
	if (
		enforce_authorization
		and rights.get("distribution") != "public"
		and (
			not _exact_keys(authorization, [
				"decision", "distribution", "overlay_id", "grant_id",
			])
			or authorization.get("decision") != "allow"
			or authorization.get("distribution") != rights.get("distribution")
			or authorization.get("overlay_id") != manifest.get("overlay_id")
			or not _safe_id(authorization.get("grant_id"), 100)
		)
	):
		return _failure("Non-public overlay 1.1 requires an exact local grant.")
	return {"ok": true, "status": "validated", "error": ""}


static func _loaded_overlay_shape(value: Dictionary) -> bool:
	return (
		_exact_keys(value, LOADED_KEYS)
		and typeof(value.get("manifest")) == TYPE_DICTIONARY
		and typeof(value.get("projection")) == TYPE_DICTIONARY
		and typeof(value.get("placement_plan")) == TYPE_DICTIONARY
		and typeof(value.get("placement_map")) == TYPE_DICTIONARY
		and typeof(value.get("texture_by_task")) == TYPE_DICTIONARY
		and typeof(value.get("texture_by_path")) == TYPE_DICTIONARY
		and _sha256(value.get("manifest_sha256"))
		and _sha256(value.get("projection_file_sha256"))
		and _sha256(value.get("placement_plan_file_sha256"))
		and _sha256(value.get("placement_map_file_sha256"))
	)


static func _role(value: Variant) -> bool:
	return _matches(
		value,
		"^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$",
		120
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
		and RegEx.create_from_string(
			"(^|/)(?:private|references?|uploads?|source-images?)(?:/|$)"
		).search(path) == null
	)


static func _safe_id(value: Variant, maximum: int) -> bool:
	return _matches(value, "^[a-z0-9]+(?:-[a-z0-9]+)*$", maximum)


static func _sha256(value: Variant) -> bool:
	return _matches(value, "^[a-f0-9]{64}$", 64)


static func _matches(value: Variant, pattern: String, maximum: int) -> bool:
	if (
		typeof(value) != TYPE_STRING
		or str(value).is_empty()
		or str(value).length() > maximum
	):
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
		return _failure("Overlay 1.1 file cannot be read: %s." % path.get_file())
	var length := file.get_length()
	if length < 1 or length > maximum:
		file.close()
		return _failure("Overlay 1.1 file byte length is invalid.")
	var bytes := file.get_buffer(length)
	file.close()
	if bytes.size() != length:
		return _failure("Overlay 1.1 file read was incomplete.")
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
			keys.sort_custom(func(left: Variant, right: Variant) -> bool:
				return str(left) < str(right)
			)
			var entries: Array[String] = []
			for key: Variant in keys:
				entries.append(
					"%s:%s" % [
						JSON.stringify(str(key)),
						_canonical_json(value[key]),
					]
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


static func _byte_difference(
	actual: PackedByteArray,
	expected: PackedByteArray
) -> String:
	var limit := mini(actual.size(), expected.size())
	for index: int in limit:
		if actual[index] != expected[index]:
			return "index=%d actual=%d expected=%d" % [
				index, int(actual[index]), int(expected[index]),
			]
	return "length actual=%d expected=%d" % [actual.size(), expected.size()]


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
