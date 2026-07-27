extends Node

signal world_loaded(scene_path: String, profile: String)
signal world_load_failed(scene_path: String, error: Error)
signal character_profile_bound(result: Dictionary)
signal character_profile_bind_failed(result: Dictionary)

const FALLBACK_SCENE := "res://mapsoo_imports/smoke-pack/smoke-pack.world.tscn"
const CHARACTER_ARTIFACT_ROOT := "res://mapsoo_characters/"
const CHARACTER_REVISION_FILE := "character-profile-revision.json"
const CHARACTER_ATLAS_FILE := "character-profile-atlas.png"
const CharacterRuntime = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_character_profile_runtime.gd"
)

@export var auto_load_on_ready := true
@export var fallback_scene_path := FALLBACK_SCENE

var active_world: Node
var active_scene_path := ""


func _ready() -> void:
	if not auto_load_on_ready:
		return
	var requested := _argument_value("--mapsoo-scene=")
	if requested.is_empty():
		requested = fallback_scene_path
	var error := load_world(requested)
	if error != OK:
		_set_status("No generated world loaded.\nImport a pack, then pass --mapsoo-scene=res://mapsoo_imports/<id>/<id>.world.tscn")
		return
	_bind_requested_character()


func load_world(scene_path: String) -> Error:
	if not _safe_generated_scene_path(scene_path):
		world_load_failed.emit(scene_path, ERR_INVALID_PARAMETER)
		return ERR_INVALID_PARAMETER
	if not ResourceLoader.exists(scene_path, "PackedScene"):
		world_load_failed.emit(scene_path, ERR_FILE_NOT_FOUND)
		return ERR_FILE_NOT_FOUND
	var packed := ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_REUSE) as PackedScene
	if packed == null:
		world_load_failed.emit(scene_path, ERR_FILE_CORRUPT)
		return ERR_FILE_CORRUPT
	var next_world := packed.instantiate()
	if active_world != null:
		remove_child(active_world)
		active_world.free()
	active_world = next_world
	active_world.name = "ActiveWorld"
	active_scene_path = scene_path
	add_child(active_world)
	move_child(active_world, 0)
	for metadata_key: String in [
		"mapsoo_active_character_id",
		"mapsoo_active_character_profile_revision_id",
		"mapsoo_active_character_profile_revision_sha256",
		"mapsoo_active_character_atlas_sha256",
	]:
		if has_meta(metadata_key):
			remove_meta(metadata_key)
	var profile := str(active_world.get_meta("mapsoo_profile", "legacy"))
	set_meta("mapsoo_active_scene_path", scene_path)
	set_meta("mapsoo_active_profile", profile)
	_set_status("Mapsoo runtime · %s\nArrow keys move · Space/Enter acts" % profile)
	world_loaded.emit(scene_path, profile)
	return OK


func bind_player_character(
	revision_bytes: PackedByteArray,
	revision_sha256: String,
	atlas_bytes: PackedByteArray
) -> Dictionary:
	if active_world == null:
		return _character_failure(
			"shell.character-no-world",
			"Load a generated world before binding a character profile."
		)
	var result: Dictionary = CharacterRuntime.bind_player(
		active_world,
		revision_bytes,
		revision_sha256,
		atlas_bytes
	)
	if result.get("ok", false) != true:
		character_profile_bind_failed.emit(result)
		_set_status(
			"Character profile rejected · %s\n%s"
			% [str(result.get("code", "binding.failed")), str(result.get("error", ""))]
		)
		return result
	set_meta("mapsoo_active_character_id", str(result.character_id))
	set_meta(
		"mapsoo_active_character_profile_revision_id",
		str(result.profile_revision_id)
	)
	set_meta(
		"mapsoo_active_character_profile_revision_sha256",
		str(result.profile_revision_sha256)
	)
	set_meta("mapsoo_active_character_atlas_sha256", str(result.atlas_sha256))
	_set_status(
		"Mapsoo runtime · %s\nCharacter %s · %s"
		% [
			str(result.profile),
			str(result.character_id),
			str(result.status),
		]
	)
	character_profile_bound.emit(result)
	return result


func bind_player_character_files(
	revision_path: String,
	revision_sha256: String,
	atlas_path: String
) -> Dictionary:
	if not _safe_character_artifact_path(revision_path, CHARACTER_REVISION_FILE) \
			or not _safe_character_artifact_path(atlas_path, CHARACTER_ATLAS_FILE) \
			or revision_path.get_base_dir() != atlas_path.get_base_dir():
		return _character_failure(
			"shell.character-path",
			"Character files must share one safe res://mapsoo_characters/<revision-id>/ directory."
		)
	var revision_result := _read_artifact(revision_path, 1024 * 1024)
	if not revision_result.ok:
		return revision_result
	var atlas_result := _read_artifact(atlas_path, 512 * 1024 * 1024)
	if not atlas_result.ok:
		return atlas_result
	return bind_player_character(
		revision_result.bytes,
		revision_sha256,
		atlas_result.bytes
	)


func _safe_generated_scene_path(scene_path: String) -> bool:
	const PREFIX := "res://mapsoo_imports/"
	if not scene_path.begins_with(PREFIX) or not scene_path.ends_with(".world.tscn") or scene_path.contains("..") or scene_path.contains("\\"):
		return false
	var relative := scene_path.trim_prefix(PREFIX)
	var parts := relative.split("/", false)
	if parts.size() != 2:
		return false
	var pack_id := str(parts[0])
	if not _safe_pack_id(pack_id):
		return false
	return str(parts[1]) == "%s.world.tscn" % pack_id


func _safe_pack_id(pack_id: String) -> bool:
	if pack_id.is_empty() or pack_id.begins_with("-") or pack_id.ends_with("-") or pack_id.contains("--"):
		return false
	for character: String in pack_id:
		if not "abcdefghijklmnopqrstuvwxyz0123456789-".contains(character):
			return false
	return true


func _safe_character_artifact_path(path: String, expected_file: String) -> bool:
	if not path.begins_with(CHARACTER_ARTIFACT_ROOT) \
			or path.contains("..") or path.contains("\\"):
		return false
	var parts := path.trim_prefix(CHARACTER_ARTIFACT_ROOT).split("/", false)
	return parts.size() == 2 \
		and _safe_pack_id(str(parts[0])) \
		and str(parts[1]) == expected_file


func _read_artifact(path: String, maximum_bytes: int) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return _character_failure(
			"shell.character-file",
			"Unable to open the requested character artifact."
		)
	var length := file.get_length()
	if length < 1 or length > maximum_bytes:
		return _character_failure(
			"shell.character-file",
			"Character artifact exceeds its runtime byte limit."
		)
	var bytes := file.get_buffer(length)
	if bytes.size() != length:
		return _character_failure(
			"shell.character-file",
			"Character artifact could not be read completely."
		)
	return {"ok": true, "bytes": bytes}


func _bind_requested_character() -> Dictionary:
	var revision_path := _argument_value("--mapsoo-character-revision=")
	var revision_sha256 := _argument_value("--mapsoo-character-revision-sha256=")
	var atlas_path := _argument_value("--mapsoo-character-atlas=")
	if revision_path.is_empty() and revision_sha256.is_empty() and atlas_path.is_empty():
		return {"ok": true, "status": "not-requested"}
	if revision_path.is_empty() or revision_sha256.is_empty() or atlas_path.is_empty():
		var incomplete := _character_failure(
			"shell.character-arguments",
			"Character launch requires revision, revision SHA-256, and atlas arguments."
		)
		_set_status("Character profile rejected · shell.character-arguments")
		return incomplete
	return bind_player_character_files(
		revision_path,
		revision_sha256,
		atlas_path
	)


func _character_failure(code: String, message: String) -> Dictionary:
	var result := {"ok": false, "code": code, "error": message}
	character_profile_bind_failed.emit(result)
	return result


func _set_status(message: String) -> void:
	var label := get_node_or_null("Interface/Status") as Label
	if label != null:
		label.text = message


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""
