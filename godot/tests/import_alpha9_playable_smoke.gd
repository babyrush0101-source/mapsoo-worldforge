extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_MANIFEST := "res://tests/.generated/pack-alpha9/mapsoo.manifest.json"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var manifest_path := _argument_value("--manifest=")
	if manifest_path.is_empty():
		manifest_path = DEFAULT_MANIFEST
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	if result.get("ok", false) != true:
		_fail("Pack 0.6 import failed: %s" % result)
		return
	var packed := ResourceLoader.load(str(result.get("scene_path", "")), "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null:
		_fail("Pack 0.6 playable scene is not loadable.")
		return
	var world := packed.instantiate()
	root.add_child(world)
	await physics_frame
	await physics_frame
	var player := world.get_node_or_null("Player") as CharacterBody2D
	if player == null:
		_fail("Pack 0.6 playable scene has no player.")
		return
	var visual := player.get_node_or_null("Visual") as AnimatedSprite2D

	var start := player.position
	Input.action_press("ui_right")
	for _frame in 8:
		await physics_frame
	if player.position.x <= start.x + 8.0 or absf(player.position.y - start.y) > 1.0:
		_fail("Farm player did not move east: %s -> %s." % [start, player.position])
		return
	if visual == null or visual.animation != "walk_east":
		_fail("Farm player did not select the east walk animation.")
		return
	Input.action_release("ui_right")
	await physics_frame
	if visual.animation != "idle_east":
		_fail("Farm player did not preserve east facing while idle.")
		return

	player.position = Vector2(80, 112)
	player.velocity = Vector2.ZERO
	Input.action_press("ui_right")
	for _frame in 20:
		await physics_frame
	Input.action_release("ui_right")
	if player.position.x > 89.0:
		_fail("Farm player crossed a generated blocked-cell collider: %s." % player.position)
		return

	player.position = Vector2(-30, -20)
	player.velocity = Vector2.ZERO
	await physics_frame
	if player.position != Vector2.ZERO:
		_fail("Farm player was not clamped to generated world bounds: %s." % player.position)
		return

	var camera := player.get_node_or_null("Camera2D") as Camera2D
	if camera == null or not camera.enabled or camera.limit_left != 0 or camera.limit_top != 0 or camera.limit_right != 512 or camera.limit_bottom != 384:
		_fail("Farm player camera does not use generated world bounds.")
		return
	print("MAPSOO_ALPHA9_PLAYABLE_OK moved=true blocked_cell=true bounds=true animations=true camera_bounds=true")
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
	Input.action_release("ui_up")
	Input.action_release("ui_down")
	push_error("MAPSOO_ALPHA9_PLAYABLE_FAILURE: %s" % message)
	quit(1)
