@tool
extends RefCounted

## Validates the optional provider-neutral WorldMaterialPalette attachment and
## adapts already-validated pack textures to the shared Godot material binder.

const MaterialPalette = preload(
	"res://addons/mapsoo_importer/mapsoo_world_material_palette.gd"
)

const ATTACHMENT_PATH := "world-material-palette.json"
const SCHEMA_VERSION := "1.0.0"
const DOCUMENT_TYPE := "world-material-palette"
const MAX_JSON_BYTES := 2 * 1024 * 1024
const TOPDOWN_TERRAIN_ROLES := [
	"terrain.ground", "terrain.water", "terrain.path", "terrain.soil",
]
const SIDE_TERRAIN_ROLES := [
	"terrain.solid", "terrain.one-way", "terrain.slope-up",
	"terrain.slope-down", "terrain.wall", "terrain.ceiling",
]
const ISOMETRIC_TERRAIN_ROLES := [
	"terrain.void", "terrain.floor.base", "terrain.floor.variant",
	"terrain.floor.edge", "terrain.elevation.top",
	"terrain.elevation.riser-left", "terrain.elevation.riser-right",
	"terrain.ramp", "terrain.wall",
]
const LAYERED_TERRAIN_ROLES := [
	"terrain.ground", "terrain.path", "terrain.edge", "terrain.bridge",
	"terrain.stairs", "terrain.water",
]


static func validate_optional(
	manifest: Dictionary,
	pack_root: String,
	layout_attachment: Dictionary
) -> Dictionary:
	var binding_value: Variant = manifest.get("material_palette")
	var attachment_exists := FileAccess.file_exists(pack_root.path_join(ATTACHMENT_PATH))
	if binding_value == null:
		if attachment_exists:
			return _failure(
				"World material palette exists without a manifest material_palette binding."
			)
		return {"ok": true, "status": "absent", "palette": {}, "error": ""}
	if layout_attachment.is_empty():
		return _failure("World material palette requires a validated world layout.")
	if typeof(binding_value) != TYPE_DICTIONARY:
		return _failure("Manifest material_palette binding must be an object.")
	var binding: Dictionary = binding_value
	if not _exact_keys(binding, [
		"schema_version", "document_type", "palette_id",
		"layout_plan_sha256", "path", "sha256",
	]):
		return _failure("Manifest material_palette binding has unsupported or missing fields.")
	if (
		binding.get("schema_version") != SCHEMA_VERSION
		or binding.get("document_type") != DOCUMENT_TYPE
		or not _safe_id(binding.get("palette_id"))
		or binding.get("layout_plan_sha256") != layout_attachment.get("sha256")
		or binding.get("path") != ATTACHMENT_PATH
		or not _sha256(binding.get("sha256"))
	):
		return _failure("Manifest material_palette binding is not canonical.")
	if not attachment_exists:
		return _failure("Manifest-bound world material palette is missing.")
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
		return _failure("World material palette files record differs from its binding.")
	var bytes := FileAccess.get_file_as_bytes(pack_root.path_join(ATTACHMENT_PATH))
	if (
		bytes.size() != int(file_record.get("bytes", -1))
		or _sha256_bytes(bytes) != str(binding.get("sha256", ""))
	):
		return _failure("World material palette bytes differ from the manifest.")
	var parser := JSON.new()
	if parser.parse(bytes.get_string_from_utf8()) != OK or typeof(parser.data) != TYPE_DICTIONARY:
		return _failure("World material palette is not valid JSON.")
	var roles := _terrain_roles(manifest.get("roles"))
	var checked := MaterialPalette.validate(
		parser.data,
		layout_attachment.plan,
		str(layout_attachment.sha256),
		roles
	)
	if not checked.ok:
		return checked
	if parser.data.get("palette_id") != binding.get("palette_id"):
		return _failure("World material palette ID differs from its manifest binding.")
	return {
		"ok": true,
		"status": "bound",
		"palette": {
			"document": parser.data,
			"sha256": str(binding.sha256),
		},
		"error": "",
	}


static func bind_scene(
	root: Node,
	layout_attachment: Dictionary,
	palette_attachment: Dictionary,
	prepared: Dictionary,
	schema_version: String
) -> Dictionary:
	if palette_attachment.is_empty():
		return {"ok": true, "status": "absent", "error": ""}
	var catalog := _build_catalog(
		prepared,
		schema_version,
		palette_attachment.document
	)
	if not catalog.ok:
		return catalog
	return MaterialPalette.apply(
		root,
		layout_attachment.plan,
		str(layout_attachment.sha256),
		palette_attachment.document,
		catalog.catalog
	)


static func validate_bound_scene(
	root: Node,
	layout_attachment: Dictionary,
	palette_attachment: Dictionary
) -> Dictionary:
	if palette_attachment.is_empty():
		if root.has_meta("mapsoo_material_palette_status"):
			return _failure("Staged scene contains an undeclared material palette.")
		return {"ok": true, "status": "absent", "error": ""}
	return MaterialPalette.validate_scene(
		root,
		layout_attachment.plan,
		str(layout_attachment.sha256),
		palette_attachment.document
	)


static func _build_catalog(
	prepared: Dictionary,
	schema_version: String,
	palette: Dictionary
) -> Dictionary:
	var textures := {}
	for entry_value: Variant in palette.get("entries", []):
		var entry: Dictionary = entry_value
		var role := str(entry.get("role", ""))
		if not textures.has(role):
			var texture := _role_texture(prepared, schema_version, role)
			if texture == null:
				return _failure("Validated pack has no texture region for palette role %s." % role)
			textures[role] = texture
	var tile_size := Vector2i(32, 32)
	if schema_version in ["0.8.0", "0.9.0", "1.0.0-draft.1"]:
		tile_size = Vector2i(64, 32)
	return {
		"ok": true,
		"catalog": {"tile_size": tile_size, "roles": textures},
		"error": "",
	}


static func _role_texture(
	prepared: Dictionary,
	schema_version: String,
	role: String
) -> Texture2D:
	if schema_version == "1.0.0-draft.1":
		return _pack10_role_texture(prepared, role)
	var role_paths: Dictionary = prepared.get("role_paths", {})
	var source: Texture2D = prepared.get("textures", {}).get(str(role_paths.get(role, "")))
	if source == null:
		return null
	var region := Rect2()
	if schema_version == "0.6.0":
		region = Rect2(TOPDOWN_TERRAIN_ROLES.find(role) * 32, 0, 32, 32)
	elif schema_version == "0.7.0":
		region = Rect2(SIDE_TERRAIN_ROLES.find(role) * 32, 0, 32, 32)
	elif schema_version == "0.8.0":
		region = Rect2(ISOMETRIC_TERRAIN_ROLES.find(role) * 64, 0, 64, 64)
	elif schema_version == "0.9.0":
		region = Rect2(posmod(LAYERED_TERRAIN_ROLES.find(role), 4) * 64, 0, 64, 96)
	if region.position.x < 0 or region.end.x > source.get_width() or region.end.y > source.get_height():
		return null
	var texture := AtlasTexture.new()
	texture.atlas = source
	texture.region = region
	texture.filter_clip = true
	return texture


static func _pack10_role_texture(prepared: Dictionary, role: String) -> Texture2D:
	var binding: Dictionary = prepared.get("pack10_roles", {}).get(role, {})
	if binding.get("kind") != "atlas-region":
		return null
	var atlas: Dictionary = prepared.get("pack10_atlases", {}).get(str(binding.get("atlas", "")), {})
	var source: Texture2D = prepared.get("textures", {}).get(str(atlas.get("path", "")))
	var region: Rect2 = binding.get("region", Rect2())
	if (
		source == null
		or region.size.x < 1
		or region.size.y < 1
		or region.end.x > source.get_width()
		or region.end.y > source.get_height()
	):
		return null
	var texture := AtlasTexture.new()
	texture.atlas = source
	texture.region = region
	texture.filter_clip = true
	return texture


static func _terrain_roles(value: Variant) -> Array:
	var roles: Array = []
	if typeof(value) != TYPE_ARRAY:
		return roles
	for role_value: Variant in value:
		if typeof(role_value) == TYPE_DICTIONARY:
			var role: Variant = role_value.get("role")
			if typeof(role) == TYPE_STRING and str(role).begins_with("terrain."):
				roles.append(str(role))
	return roles


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
