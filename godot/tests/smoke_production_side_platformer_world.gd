extends SceneTree

const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd")
const ACTIONS := ["idle", "run", "jump", "fall", "land", "hurt"]
const DIRECTIONS := ["left", "right"]


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var terrain_path := _argument_value("--terrain=")
	var props_path := _argument_value("--props=")
	var character_path := _argument_value("--character=")
	var background_manifest_path := _argument_value("--background-manifest=")
	var repo_root := _argument_value("--repo-root=")
	if terrain_path.is_empty() or props_path.is_empty() or character_path.is_empty() \
			or background_manifest_path.is_empty() or repo_root.is_empty():
		_fail("Pass terrain, props, character, background-manifest and repo-root.")
		return

	var terrain := _load_png(terrain_path, Vector2i(384, 192))
	var props := _load_png(props_path, Vector2i(512, 512))
	var character := _load_png(character_path, Vector2i(1024, 768))
	if terrain == null or props == null or character == null:
		return
	if not _verify_backgrounds(background_manifest_path, repo_root):
		return
	if not _verify_atlas_cells(terrain, Vector2i(48, 48), 6, 8, "terrain"):
		return
	if not _verify_atlas_cells(props, Vector2i(64, 64), 14, 8, "props"):
		return

	var world := Node2D.new()
	world.name = "ProductionWorld"
	root.add_child(world)

	var ground := StaticBody2D.new()
	ground.name = "Ground"
	var ground_shape := CollisionShape2D.new()
	var ground_rectangle := RectangleShape2D.new()
	ground_rectangle.size = Vector2(1280, 144)
	ground_shape.shape = ground_rectangle
	ground_shape.position = Vector2(640, 648)
	ground.add_child(ground_shape)
	world.add_child(ground)

	var upper_platform := StaticBody2D.new()
	upper_platform.name = "UpperPlatform"
	var platform_shape := CollisionShape2D.new()
	var platform_rectangle := RectangleShape2D.new()
	platform_rectangle.size = Vector2(240, 12)
	platform_shape.shape = platform_rectangle
	platform_shape.position = Vector2(408, 438)
	upper_platform.add_child(platform_shape)
	world.add_child(upper_platform)

	var traversal := Node2D.new()
	traversal.name = "WorldTraversal"
	traversal.set_meta("mapsoo_exit_node_id", "exit-node")
	var exit_marker := Marker2D.new()
	exit_marker.name = "ExitNode"
	exit_marker.position = Vector2(1200, 546)
	exit_marker.set_meta("mapsoo_id", "exit-node")
	traversal.add_child(exit_marker)
	world.add_child(traversal)

	var player := CharacterBody2D.new()
	player.name = "Player"
	player.set_script(PlayerController)
	player.position = Vector2(144, 400)
	player.set("mapsoo_profile", "side-platformer")
	player.set("world_bounds", Rect2(0, 0, 1280, 720))
	player.set("spawn_position", player.position)
	player.set("input_enabled", false)
	var player_shape := CollisionShape2D.new()
	var player_rectangle := RectangleShape2D.new()
	player_rectangle.size = Vector2(32, 60)
	player_shape.shape = player_rectangle
	player.add_child(player_shape)

	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = _character_frames(character)
	visual.position = Vector2(0, -34)
	visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	player.add_child(visual)
	world.add_child(player)

	for _frame in 90:
		await physics_frame
	if not player.is_on_floor() or absf(player.position.y - 546.0) > 2.0:
		_fail("Player did not settle on the production ground collision.")
		return
	if visual.animation != "idle_right":
		_fail("Production character did not enter idle_right on the floor.")
		return

	var start_x := player.position.x
	player.set("input_enabled", true)
	Input.action_press("ui_right")
	for _frame in 10:
		await physics_frame
	var run_animation := visual.animation
	Input.action_release("ui_right")
	if player.position.x <= start_x + 10.0 or run_animation != "run_right":
		_fail("Production player controller did not move right with the generated run frame.")
		return

	Input.action_press("ui_accept")
	await physics_frame
	Input.action_release("ui_accept")
	await physics_frame
	var jump_animation := visual.animation
	if player.velocity.y >= 0.0 or jump_animation != "jump_right":
		_fail("Production player controller did not jump with the generated jump frame.")
		return

	player.set("input_enabled", false)
	player.position = exit_marker.position
	player.velocity = Vector2.ZERO
	await physics_frame
	if str(player.get_meta("mapsoo_exit_reached", "")) != "exit-node":
		_fail("Production world exit was not reached.")
		return

	print(
		"MAPSOO_PRODUCTION_WORLD_GODOT_OK terrain_sha256=%s props_sha256=%s character_sha256=%s backgrounds=5 cells=20 floor=true run=%s jump=%s exit=exit-node" % [
			FileAccess.get_sha256(terrain_path),
			FileAccess.get_sha256(props_path),
			FileAccess.get_sha256(character_path),
			run_animation,
			jump_animation,
		]
	)
	quit(0)


func _load_png(path: String, expected_size: Vector2i) -> Image:
	if not FileAccess.file_exists(path):
		_fail("PNG is missing: %s" % path)
		return null
	var image := Image.new()
	var error := image.load_png_from_buffer(FileAccess.get_file_as_bytes(path))
	if error != OK or image.get_size() != expected_size:
		_fail("PNG has an invalid size or payload: %s" % path)
		return null
	return image


func _verify_backgrounds(manifest_path: String, repo_root: String) -> bool:
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(manifest_path)) != OK or typeof(parser.data) != TYPE_DICTIONARY:
		_fail("Background runtime manifest is invalid.")
		return false
	var manifest := parser.data as Dictionary
	var expected_roles := [
		"background.sky",
		"background.far",
		"background.mid",
		"background.near",
		"foreground.overlay",
	]
	var layers := manifest.get("layers", []) as Array
	if layers.size() != expected_roles.size():
		_fail("Background runtime manifest must contain five layers.")
		return false
	for index in layers.size():
		var layer := layers[index] as Dictionary
		if str(layer.get("role", "")) != expected_roles[index]:
			_fail("Background role order is invalid.")
			return false
		var path := repo_root.path_join(str(layer.get("path", "")))
		if FileAccess.get_sha256(path) != str(layer.get("sha256", "")) \
				or _load_png(path, Vector2i(1920, 1080)) == null:
			_fail("Background layer failed its Godot digest or decode gate.")
			return false
	return true


func _verify_atlas_cells(image: Image, cell_size: Vector2i, required_count: int, columns: int, label: String) -> bool:
	var texture := ImageTexture.create_from_image(image)
	for index in required_count:
		var atlas := AtlasTexture.new()
		atlas.atlas = texture
		atlas.region = Rect2(
			(index % columns) * cell_size.x,
			(index / columns) * cell_size.y,
			cell_size.x,
			cell_size.y
		)
		var cell := atlas.get_image()
		if cell == null or cell.is_empty() or cell.get_used_rect().size == Vector2i.ZERO:
			_fail("%s atlas cell %d is empty in Godot." % [label, index])
			return false
	return true


func _character_frames(image: Image) -> SpriteFrames:
	var texture := ImageTexture.create_from_image(image)
	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	for action_index in ACTIONS.size():
		for direction_index in DIRECTIONS.size():
			var direction: String = DIRECTIONS[direction_index]
			var row := 1 if direction == "left" else 0
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(action_index * 128, row * 128, 128, 128)
			var animation := "%s_%s" % [ACTIONS[action_index], direction]
			frames.add_animation(animation)
			frames.set_animation_loop(animation, ACTIONS[action_index] in ["idle", "run", "fall"])
			frames.set_animation_speed(animation, 10.0 if ACTIONS[action_index] == "run" else 6.0)
			frames.add_frame(animation, atlas)
	return frames


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	push_error("MAPSOO_PRODUCTION_WORLD_GODOT_FAILURE: %s" % message)
	quit(1)
