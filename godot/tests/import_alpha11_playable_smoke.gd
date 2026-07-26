extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_MANIFEST := "res://tests/.generated/pack-alpha11/mapsoo.manifest.json"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var manifest_path := _argument_value("--manifest=")
	if manifest_path.is_empty():
		manifest_path = DEFAULT_MANIFEST
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	if result.get("ok", false) != true:
		_fail("Pack 0.8 import failed: %s" % result)
		return
	var packed := ResourceLoader.load(str(result.get("scene_path", "")), "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null:
		_fail("Pack 0.8 playable scene is not loadable.")
		return
	var world := packed.instantiate()
	root.add_child(world)
	await physics_frame
	await physics_frame
	var player := world.get_node_or_null("YSortedGameplay/Actors/Player") as CharacterBody2D
	var spawn := world.get_node_or_null("PlayerSpawn") as Marker2D
	if player == null or spawn == null:
		_fail("Pack 0.8 playable scene has no player or spawn.")
		return

	var start := player.position
	Input.action_press("ui_right")
	Input.action_press("ui_down")
	for _frame in 8:
		await physics_frame
	Input.action_release("ui_right")
	Input.action_release("ui_down")
	if player.position.x <= start.x + 8.0 or player.position.y <= start.y + 8.0:
		_fail("Isometric player did not move diagonally: %s -> %s." % [start, player.position])
		return
	var visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.animation != "move_south-east":
		_fail("Isometric player did not select the south-east movement animation: %s." % [visual.animation if visual else "missing"])
		return

	var before_dash := player.position
	Input.action_press("ui_accept")
	await physics_frame
	Input.action_release("ui_accept")
	for _frame in 4:
		await physics_frame
	if player.position.distance_to(before_dash) < 12.0 or visual.animation != "dash_south-east":
		_fail("Isometric dash did not move or animate.")
		return

	player.position = Vector2(320, 252)
	player.velocity = Vector2.ZERO
	for _frame in 3:
		await physics_frame
	if player.position.distance_to(spawn.position) > 1.0 or player.get_meta("mapsoo_last_respawn_reason", "") != "trap":
		_fail("Isometric player did not respawn from generated contact hazard.")
		return

	var traversal := world.get_node_or_null("WorldTraversal") as Node2D
	var exit_marker: Marker2D
	for child: Node in traversal.get_children():
		if str(child.get_meta("mapsoo_kind", "")) == "exit":
			exit_marker = child as Marker2D
			break
	if exit_marker == null:
		_fail("Pack 0.8 traversal has no exit marker.")
		return
	player.position = exit_marker.position
	player.velocity = Vector2.ZERO
	await physics_frame
	if player.get_meta("mapsoo_exit_reached", "") != str(exit_marker.get_meta("mapsoo_id", "")):
		_fail("Isometric player did not report the generated exit.")
		return

	var camera := player.get_node_or_null("Camera2D") as Camera2D
	if camera == null or not camera.enabled or camera.limit_left != 0 or camera.limit_top != 0 or camera.limit_right != 640 or camera.limit_bottom != 360:
		_fail("Isometric camera does not use generated world bounds.")
		return
	print("MAPSOO_ALPHA11_PLAYABLE_OK diagonal=true dash=true hazard_respawn=true exit=true camera_bounds=true")
	world.queue_free()
	quit(0)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	for action: String in ["ui_left", "ui_right", "ui_up", "ui_down", "ui_accept", "ui_cancel"]:
		Input.action_release(action)
	push_error("MAPSOO_ALPHA11_PLAYABLE_FAILURE: %s" % message)
	quit(1)
