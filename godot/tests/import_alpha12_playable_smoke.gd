extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_MANIFEST := "res://tests/.generated/pack-alpha12/mapsoo.manifest.json"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var manifest_path := _argument_value("--manifest=")
	if manifest_path.is_empty():
		manifest_path = DEFAULT_MANIFEST
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	if result.get("ok", false) != true:
		_fail("Pack 0.9 import failed: %s" % result)
		return
	var packed := ResourceLoader.load(str(result.get("scene_path", "")), "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null:
		_fail("Pack 0.9 playable scene is not loadable.")
		return
	var world := packed.instantiate()
	root.add_child(world)
	await physics_frame
	await physics_frame
	var player := world.get_node_or_null("YSortedGameplay/Actors/Player") as CharacterBody2D
	var npc := world.get_node_or_null("YSortedGameplay/Actors/Npc") as CharacterBody2D
	var spawn := world.get_node_or_null("PlayerSpawn") as Marker2D
	if player == null or npc == null or spawn == null:
		_fail("Pack 0.9 playable scene has no player, NPC or spawn.")
		return

	var start := player.position
	Input.action_press("ui_right")
	for _frame in 8:
		await physics_frame
	Input.action_release("ui_right")
	if player.position.x <= start.x + 8.0 or absf(player.position.y - start.y) > 1.0:
		_fail("Layered-depth player did not move horizontally: %s -> %s." % [start, player.position])
		return
	var visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.animation != "walk_right":
		_fail("Layered-depth player did not select the right movement animation.")
		return

	Input.action_press("ui_down")
	for _frame in 4:
		await physics_frame
	Input.action_release("ui_down")
	if player.position.y <= start.y + 4.0 or visual.animation != "walk_near":
		_fail("Layered-depth player did not move along the shallow-depth near axis.")
		return

	player.position = npc.position + Vector2(0, 32)
	player.velocity = Vector2.ZERO
	Input.action_press("ui_accept")
	await physics_frame
	Input.action_release("ui_accept")
	if player.get_meta("mapsoo_last_interaction", "") != "npc" or visual.animation != "interact_near":
		_fail("Layered-depth player did not interact with the generated NPC: player=%s npc=%s distance=%.2f interaction=%s animation=%s." % [player.position, npc.position, player.global_position.distance_to(npc.global_position), player.get_meta("mapsoo_last_interaction", ""), visual.animation])
		return

	player.position = Vector2(540, 637)
	player.velocity = Vector2.ZERO
	for _frame in 3:
		await physics_frame
	if player.position.distance_to(spawn.position) > 1.0 or player.get_meta("mapsoo_last_respawn_reason", "") != "fall":
		_fail("Layered-depth player did not respawn from generated deep water.")
		return

	var traversal := world.get_node_or_null("WorldTraversal") as Node2D
	var exit_marker: Marker2D
	for child: Node in traversal.get_children():
		if str(child.get_meta("mapsoo_kind", "")) == "exit":
			exit_marker = child as Marker2D
			break
	if exit_marker == null:
		_fail("Pack 0.9 traversal has no exit marker.")
		return
	player.position = exit_marker.position
	player.velocity = Vector2.ZERO
	await physics_frame
	if player.get_meta("mapsoo_exit_reached", "") != str(exit_marker.get_meta("mapsoo_id", "")):
		_fail("Layered-depth player did not report the generated exit.")
		return

	var camera := player.get_node_or_null("Camera2D") as Camera2D
	if camera == null or not camera.enabled or camera.limit_left != 0 or camera.limit_top != 0 or camera.limit_right != 1280 or camera.limit_bottom != 720:
		_fail("Layered-depth camera does not use generated world bounds.")
		return
	var movement_bounds: Rect2 = player.get("movement_bounds")
	if movement_bounds.position.y != 300.0 or movement_bounds.end.y != 650.0:
		_fail("Layered-depth player is not constrained to the generated shallow-depth corridor.")
		return
	print("MAPSOO_ALPHA12_PLAYABLE_OK four_way=true interaction=true hazard_respawn=true exit=true camera_bounds=true no_jump=true")
	world.queue_free()
	quit(0)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	for action: String in ["ui_left", "ui_right", "ui_up", "ui_down", "ui_accept"]:
		Input.action_release(action)
	push_error("MAPSOO_ALPHA12_PLAYABLE_FAILURE: %s" % message)
	quit(1)
