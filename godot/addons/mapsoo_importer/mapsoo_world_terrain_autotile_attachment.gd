@tool
extends RefCounted

## Validates and loads the optional WorldTerrainAutotileSet pack attachment.
## Provider-specific exports must already be normalized to the neutral JSON and
## PNG contract before entering this boundary.

const TerrainAutotile = preload(
	"res://addons/mapsoo_importer/mapsoo_world_terrain_autotile.gd"
)

const ATTACHMENT_PATH := "world-terrain-autotiles.json"
const SCHEMA_VERSION := "1.0.0"
const DOCUMENT_TYPE := "world-terrain-autotile-set"
const MAX_JSON_BYTES := 2 * 1024 * 1024
const MAX_IMAGE_BYTES := 32 * 1024 * 1024


static func validate_optional(
	manifest: Dictionary,
	pack_root: String,
	layout_attachment: Dictionary,
	palette_attachment: Dictionary
) -> Dictionary:
	var binding_value: Variant = manifest.get("terrain_autotiles")
	var attachment_exists := FileAccess.file_exists(pack_root.path_join(ATTACHMENT_PATH))
	if binding_value == null:
		if attachment_exists:
			return _failure(
				"World terrain autotiles exist without a manifest terrain_autotiles binding."
			)
		return {"ok": true, "status": "absent", "autotiles": {}, "error": ""}
	if layout_attachment.is_empty() or palette_attachment.is_empty():
		return _failure("World terrain autotiles require validated layout and palette attachments.")
	if typeof(binding_value) != TYPE_DICTIONARY:
		return _failure("Manifest terrain_autotiles binding must be an object.")
	var binding: Dictionary = binding_value
	if not _exact_keys(binding, [
		"schema_version",
		"document_type",
		"set_id",
		"layout_plan_sha256",
		"material_palette_sha256",
		"path",
		"sha256",
	]):
		return _failure("Manifest terrain_autotiles binding has unsupported or missing fields.")
	if (
		binding.get("schema_version") != SCHEMA_VERSION
		or binding.get("document_type") != DOCUMENT_TYPE
		or not _safe_id(binding.get("set_id"))
		or binding.get("layout_plan_sha256") != layout_attachment.get("sha256")
		or binding.get("material_palette_sha256") != palette_attachment.get("sha256")
		or binding.get("path") != ATTACHMENT_PATH
		or not _sha256(binding.get("sha256"))
	):
		return _failure("Manifest terrain_autotiles binding is not canonical.")
	if not attachment_exists:
		return _failure("Manifest-bound world terrain autotile set is missing.")
	var file_record := _file_record(manifest.get("files"), ATTACHMENT_PATH)
	if (
		file_record.is_empty()
		or not _exact_keys(file_record, ["path", "media_type", "bytes", "sha256"])
		or file_record.get("media_type") != "application/json"
		or not _json_integer(file_record.get("bytes"))
		or int(file_record.get("bytes", 0)) < 1
		or int(file_record.get("bytes", 0)) > MAX_JSON_BYTES
		or file_record.get("sha256") != binding.get("sha256")
	):
		return _failure("World terrain autotile JSON record differs from its binding.")
	var bytes := FileAccess.get_file_as_bytes(pack_root.path_join(ATTACHMENT_PATH))
	if (
		bytes.size() != int(file_record.get("bytes", -1))
		or _sha256_bytes(bytes) != str(binding.get("sha256", ""))
	):
		return _failure("World terrain autotile JSON bytes differ from the manifest.")
	var parser := JSON.new()
	if parser.parse(bytes.get_string_from_utf8()) != OK or typeof(parser.data) != TYPE_DICTIONARY:
		return _failure("World terrain autotile attachment is not valid JSON.")
	var document: Dictionary = parser.data
	if document.get("set_id") != binding.get("set_id"):
		return _failure("World terrain autotile set ID differs from its manifest binding.")
	var loaded := _load_bound_textures(document, manifest, pack_root)
	if not loaded.ok:
		return loaded
	var checked := TerrainAutotile.validate(
		document,
		layout_attachment.plan,
		str(layout_attachment.sha256),
		palette_attachment.document,
		str(palette_attachment.sha256),
		loaded.textures
	)
	if not checked.ok:
		return checked
	return {
		"ok": true,
		"status": "bound",
		"autotiles": {
			"document": document,
			"sha256": str(binding.sha256),
			"textures": loaded.textures,
		},
		"error": "",
	}


static func bind_scene(
	root: Node,
	layout_attachment: Dictionary,
	palette_attachment: Dictionary,
	autotile_attachment: Dictionary
) -> Dictionary:
	if autotile_attachment.is_empty():
		return {"ok": true, "status": "absent", "error": ""}
	return TerrainAutotile.apply(
		root,
		layout_attachment.plan,
		str(layout_attachment.sha256),
		palette_attachment.document,
		str(palette_attachment.sha256),
		autotile_attachment.document,
		autotile_attachment.textures
	)


static func validate_bound_scene(
	root: Node,
	layout_attachment: Dictionary,
	palette_attachment: Dictionary,
	autotile_attachment: Dictionary
) -> Dictionary:
	if autotile_attachment.is_empty():
		if root.has_meta("mapsoo_terrain_autotile_status"):
			return _failure("Staged scene contains undeclared world terrain autotiles.")
		return {"ok": true, "status": "absent", "error": ""}
	return TerrainAutotile.validate_scene(
		root,
		layout_attachment.plan,
		str(layout_attachment.sha256),
		palette_attachment.document,
		str(palette_attachment.sha256),
		autotile_attachment.document
	)


static func _load_bound_textures(
	document: Dictionary,
	manifest: Dictionary,
	pack_root: String
) -> Dictionary:
	var entries_value: Variant = document.get("entries")
	if typeof(entries_value) != TYPE_ARRAY or entries_value.is_empty() or entries_value.size() > 64:
		return _failure("World terrain autotile entry count is invalid.")
	var textures := {}
	for entry_value: Variant in entries_value:
		if typeof(entry_value) != TYPE_DICTIONARY:
			return _failure("World terrain autotile entry is not an object.")
		var entry: Dictionary = entry_value
		var material: Variant = entry.get("material")
		var image_meta: Variant = entry.get("image")
		if not _safe_id(material) or typeof(image_meta) != TYPE_DICTIONARY:
			return _failure("World terrain autotile material or image metadata is invalid.")
		var image_record: Dictionary = image_meta
		var path_value: Variant = image_record.get("path")
		if (
			not _safe_path(path_value)
			or not _sha256(image_record.get("sha256"))
			or not _json_integer(image_record.get("width"))
			or not _json_integer(image_record.get("height"))
		):
			return _failure("World terrain autotile image declaration is invalid.")
		var path := str(path_value)
		var file_record := _file_record(manifest.get("files"), path)
		if (
			file_record.is_empty()
			or not _exact_keys(file_record, ["path", "media_type", "bytes", "sha256"])
			or file_record.get("media_type") != "image/png"
			or not _json_integer(file_record.get("bytes"))
			or int(file_record.get("bytes", 0)) < 1
			or int(file_record.get("bytes", 0)) > MAX_IMAGE_BYTES
			or file_record.get("sha256") != image_record.get("sha256")
		):
			return _failure("World terrain autotile PNG record differs from the contract.")
		var absolute_path := pack_root.path_join(path)
		var image_bytes := FileAccess.get_file_as_bytes(absolute_path)
		if (
			image_bytes.size() != int(file_record.get("bytes", -1))
			or _sha256_bytes(image_bytes) != str(image_record.get("sha256", ""))
		):
			return _failure("World terrain autotile PNG bytes differ from the manifest.")
		var image := Image.new()
		if image.load_png_from_buffer(image_bytes) != OK or image.is_empty():
			return _failure("World terrain autotile PNG cannot be decoded.")
		if (
			image.get_width() != int(image_record.get("width", -1))
			or image.get_height() != int(image_record.get("height", -1))
		):
			return _failure("World terrain autotile decoded dimensions differ from the contract.")
		if textures.has(str(material)):
			return _failure("World terrain autotile material texture is duplicated.")
		var texture := PortableCompressedTexture2D.new()
		texture.keep_compressed_buffer = true
		texture.create_from_image(
			image,
			PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS
		)
		textures[str(material)] = texture
	return {"ok": true, "status": "loaded", "textures": textures, "error": ""}


static func _file_record(value: Variant, path: String) -> Dictionary:
	if typeof(value) != TYPE_ARRAY:
		return {}
	for record_value: Variant in value:
		if typeof(record_value) == TYPE_DICTIONARY and record_value.get("path") == path:
			return record_value
	return {}


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


static func _sha256(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING:
		return false
	var regex := RegEx.new()
	return regex.compile("^[a-f0-9]{64}$") == OK and regex.search(value) != null


static func _sha256_bytes(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	if context.update(bytes) != OK:
		return ""
	return context.finish().hex_encode()


static func _json_integer(value: Variant) -> bool:
	return (
		typeof(value) in [TYPE_INT, TYPE_FLOAT]
		and is_finite(float(value))
		and float(value) == floor(float(value))
	)


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
