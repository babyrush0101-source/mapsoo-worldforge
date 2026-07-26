extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const RuntimeShellScene = preload("res://example/main.tscn")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_FARM_MANIFEST := "res://tests/.generated/pack-alpha9/mapsoo.manifest.json"
const DEFAULT_SIDE_MANIFEST := "res://tests/.generated/pack-alpha10/mapsoo.manifest.json"
const DEFAULT_ISOMETRIC_MANIFEST := "res://tests/.generated/pack-alpha11/mapsoo.manifest.json"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var farm_manifest := _argument_value("--farm-manifest=")
	var side_manifest := _argument_value("--side-manifest=")
	var isometric_manifest := _argument_value("--isometric-manifest=")
	if farm_manifest.is_empty():
		farm_manifest = DEFAULT_FARM_MANIFEST
	if side_manifest.is_empty():
		side_manifest = DEFAULT_SIDE_MANIFEST
	if isometric_manifest.is_empty():
		isometric_manifest = DEFAULT_ISOMETRIC_MANIFEST
	var farm_result: Dictionary = Importer.import_pack(farm_manifest, OUTPUT_ROOT)
	var side_result: Dictionary = Importer.import_pack(side_manifest, OUTPUT_ROOT)
	var isometric_result: Dictionary = Importer.import_pack(isometric_manifest, OUTPUT_ROOT)
	if farm_result.get("ok", false) != true or side_result.get("ok", false) != true or isometric_result.get("ok", false) != true:
		_fail("Runtime-shell fixtures did not import: farm=%s side=%s isometric=%s" % [farm_result, side_result, isometric_result])
		return

	var shell := RuntimeShellScene.instantiate()
	shell.set("auto_load_on_ready", false)
	root.add_child(shell)
	if shell.call("load_world", "res://mapsoo_imports/../unsafe.world.tscn") != ERR_INVALID_PARAMETER:
		_fail("Runtime shell accepted an unsafe scene path.")
		return
	var farm_scene := str(farm_result.get("scene_path", ""))
	if shell.call("load_world", farm_scene) != OK:
		_fail("Runtime shell did not load the generated farm scene.")
		return
	var first_world := shell.get("active_world") as Node
	if first_world == null or first_world.get_meta("mapsoo_profile", "") != "topdown-farm" or first_world.get_node_or_null("Player") == null:
		_fail("Runtime shell farm world is incomplete.")
		return
	var side_scene := str(side_result.get("scene_path", ""))
	if shell.call("load_world", side_scene) != OK:
		_fail("Runtime shell did not load the generated side scene.")
		return
	var second_world := shell.get("active_world") as Node
	if second_world == null or second_world == first_world or second_world.get_meta("mapsoo_profile", "") != "side-platformer" or second_world.get_node_or_null("Player") == null:
		_fail("Runtime shell did not replace the farm with the side world.")
		return
	if shell.get_meta("mapsoo_active_scene_path", "") != side_scene or shell.get_meta("mapsoo_active_profile", "") != "side-platformer":
		_fail("Runtime shell did not expose the active frozen-world identity.")
		return
	var isometric_scene := str(isometric_result.get("scene_path", ""))
	if shell.call("load_world", isometric_scene) != OK:
		_fail("Runtime shell did not load the generated isometric scene.")
		return
	var third_world := shell.get("active_world") as Node
	if third_world == null or third_world == second_world or third_world.get_meta("mapsoo_profile", "") != "isometric-action" or third_world.get_node_or_null("YSortedGameplay/Actors/Player") == null:
		_fail("Runtime shell did not replace the side world with the isometric world.")
		return
	if shell.get_meta("mapsoo_active_scene_path", "") != isometric_scene or shell.get_meta("mapsoo_active_profile", "") != "isometric-action":
		_fail("Runtime shell did not expose the active isometric frozen-world identity.")
		return
	print("MAPSOO_RUNTIME_SHELL_OK safe_path=true farm=true side=true isometric=true replacement=true")
	shell.queue_free()
	quit(0)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	push_error("MAPSOO_RUNTIME_SHELL_FAILURE: %s" % message)
	quit(1)
