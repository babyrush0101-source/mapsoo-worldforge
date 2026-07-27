extends Node

const SAFE_PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]


func _ready() -> void:
	var world_id := _argument_value("--world-id=")
	var pack_sha256 := _argument_value("--pack-sha256=")
	if not _safe_id(world_id) or not _sha256(pack_sha256):
		_fail("World ID or Pack SHA-256 argument is invalid.")
		return
	var scene_path := "res://mapsoo_imports/%s/%s.world.tscn" % [world_id, world_id]
	var packed := ResourceLoader.load(
		scene_path,
		"PackedScene",
		ResourceLoader.CACHE_MODE_IGNORE_DEEP,
	) as PackedScene
	if packed == null:
		_fail("Packaged world scene is not loadable.")
		return
	var world := packed.instantiate()
	var profile := str(world.get_meta("mapsoo_profile", ""))
	if str(world.get_meta("mapsoo_pack_id", "")) != world_id \
			or not SAFE_PROFILES.has(profile):
		world.free()
		_fail("Packaged world metadata does not match the delivery.")
		return
	add_child(world)
	await get_tree().process_frame
	remove_child(world)
	world.free()
	print(
		"MAPSOO_WORLD_RUNNER_PCK_OK"
		+ " world_id=%s" % world_id
		+ " pack_sha256=%s" % pack_sha256
		+ " profile=%s" % profile
		+ " scene=%s" % scene_path
		+ " physical_raspberry_pi=not-tested",
	)
	get_tree().quit(0)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _safe_id(value: String) -> bool:
	if value.is_empty() or value.begins_with("-") or value.ends_with("-") \
			or value.contains("--"):
		return false
	for character: String in value:
		if not "abcdefghijklmnopqrstuvwxyz0123456789-".contains(character):
			return false
	return true


func _sha256(value: String) -> bool:
	if value.length() != 64:
		return false
	for character: String in value:
		if not "abcdef0123456789".contains(character):
			return false
	return true


func _fail(message: String) -> void:
	push_error("MAPSOO_WORLD_RUNNER_PCK_FAILURE: %s" % message)
	get_tree().quit(1)
