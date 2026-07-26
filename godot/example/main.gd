extends Node

signal world_loaded(scene_path: String, profile: String)
signal world_load_failed(scene_path: String, error: Error)

const FALLBACK_SCENE := "res://mapsoo_imports/smoke-pack/smoke-pack.world.tscn"

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
	var profile := str(active_world.get_meta("mapsoo_profile", "legacy"))
	set_meta("mapsoo_active_scene_path", scene_path)
	set_meta("mapsoo_active_profile", profile)
	_set_status("Mapsoo runtime · %s\nArrow keys move · Space/Enter acts" % profile)
	world_loaded.emit(scene_path, profile)
	return OK


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


func _set_status(message: String) -> void:
	var label := get_node_or_null("Interface/Status") as Label
	if label != null:
		label.text = message


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""
