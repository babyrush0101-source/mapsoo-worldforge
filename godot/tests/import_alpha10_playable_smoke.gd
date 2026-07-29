extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_MANIFEST := "res://tests/.generated/pack-alpha10/mapsoo.manifest.json"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var manifest_path := _argument_value("--manifest=")
	if manifest_path.is_empty():
		manifest_path = DEFAULT_MANIFEST
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	if result.get("ok", false) != true:
		_fail("Pack 0.7 import failed: %s" % result)
		return
	var packed := ResourceLoader.load(str(result.get("scene_path", "")), "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null:
		_fail("Pack 0.7 playable scene is not loadable.")
		return
	var world := packed.instantiate()
	root.add_child(world)
	await physics_frame
	await physics_frame
	var player := world.get_node_or_null("Player") as CharacterBody2D
	var spawn := world.get_node_or_null("PlayerSpawn") as Marker2D
	if player == null or spawn == null:
		_fail("Pack 0.7 playable scene has no player or spawn.")
		return

	var start := player.position
	if not player.is_on_floor():
		_fail("Side player did not settle onto the generated solid surface.")
		return
	Input.action_press("ui_right")
	for _frame in 8:
		await physics_frame
	Input.action_release("ui_right")
	if player.position.x <= start.x + 8.0 or absf(player.position.y - start.y) > 2.0:
		_fail("Side player did not move horizontally on its collision surface: %s -> %s." % [start, player.position])
		return
	var visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.animation != "run_right":
		_fail("Side player did not select the run-right animation.")
		return

	await physics_frame
	Input.action_press("ui_accept")
	await physics_frame
	Input.action_release("ui_accept")
	for _frame in 3:
		await physics_frame
	if player.position.y >= start.y - 4.0 or player.velocity.y >= 0.0:
		_fail("Side player did not jump from the generated surface.")
		return

	player.set("input_enabled", false)
	player.position = Vector2(400, 540)
	player.velocity = Vector2(0, -520)
	var passed_from_below := false
	for _frame in 18:
		await physics_frame
		if player.position.y < 470.0:
			passed_from_below = true
	if not passed_from_below:
		_fail("Side player did not pass through the one-way platform from below.")
		return
	player.position = Vector2(400, 430)
	player.velocity = Vector2(0, 80)
	for _frame in 30:
		await physics_frame
	if not player.is_on_floor() or absf(player.position.y - 480.0) > 2.0:
		_fail("Side player did not land on the one-way platform from above: %s." % player.position)
		return

	player.position = Vector2(752, 596)
	player.velocity = Vector2.ZERO
	for _frame in 3:
		await physics_frame
	if player.position.distance_to(spawn.position) > 1.0 or player.get_meta("mapsoo_last_respawn_reason", "") != "spikes":
		_fail("Side player did not respawn after entering the generated spike hazard.")
		return

	var traversal := world.get_node_or_null("WorldTraversal")
	var exit_marker: Marker2D
	for child: Node in traversal.get_children():
		if str(child.get_meta("mapsoo_kind", "")) == "exit":
			exit_marker = child as Marker2D
			break
	if exit_marker == null:
		_fail("Pack 0.7 traversal has no exit marker.")
		return
	player.position = exit_marker.position
	player.velocity = Vector2.ZERO
	for _frame in 3:
		await physics_frame
	if player.get_meta("mapsoo_exit_reached", "") != str(exit_marker.get_meta("mapsoo_id", "")):
		_fail(
			"Side player did not report the generated world exit " +
			"(bound=%s expected=%s reached=%s marker=%s)." % [
				player.get("_exit_id"),
				exit_marker.get_meta("mapsoo_id", ""),
				player.get_meta("mapsoo_exit_reached", ""),
				player.get("_exit_marker"),
			]
		)
		return

	var camera := player.get_node_or_null("Camera2D") as Camera2D
	if camera == null or not camera.enabled or camera.limit_left != 0 or camera.limit_top != 0 or camera.limit_right != 1280 or camera.limit_bottom != 720:
		_fail("Side player camera does not use generated world bounds.")
		return
	print("MAPSOO_ALPHA10_PLAYABLE_OK solid=true moved=true jumped=true one_way_below=true one_way_above=true hazard_respawn=true exit=true camera_bounds=true")
	world.queue_free()
	quit(0)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	Input.action_release("ui_left")
	Input.action_release("ui_right")
	Input.action_release("ui_accept")
	push_error("MAPSOO_ALPHA10_PLAYABLE_FAILURE: %s" % message)
	quit(1)
