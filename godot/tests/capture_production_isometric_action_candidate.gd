extends SceneTree

const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_isometric_player_controller.gd")
const VIEWPORT_SIZE := Vector2i(640, 360)


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var manifest_path := _argument_value("--manifest=")
	var repo_root := _argument_value("--repo-root=")
	var output_path := _argument_value("--output=")
	if manifest_path.is_empty() or repo_root.is_empty() or output_path.is_empty():
		_fail("Pass manifest, repo-root and output.")
		return
	var manifest := _load_json(manifest_path)
	if str(manifest.get("id", "")) != "isometric-action-production-preview-v1" \
			or str(manifest.get("profile", "")) != "isometric-action":
		_fail("Isometric production preview manifest is invalid.")
		return
	var bindings := manifest.get("source_bindings", {}) as Dictionary
	var pack_path := repo_root.path_join(str(bindings.get("pack_atlas_manifest", "")))
	var pack := _load_json(pack_path)
	if pack.is_empty() or str(pack.get("id", "")) != "isometric-action-pack-atlases-v1":
		_fail("Isometric Pack atlas projection is invalid.")
		return
	if FileAccess.get_sha256(pack_path) != str(bindings.get("pack_atlas_manifest_sha256", "")):
		_fail("Isometric Pack atlas projection digest is stale.")
		return
	var textures := {}
	var atlas_records := {}
	for value in pack.get("atlases", []) as Array:
		var record := value as Dictionary
		var texture := _recorded_texture(repo_root, record)
		if texture == null:
			return
		var atlas_id := str(record.get("atlas_id", ""))
		textures[atlas_id] = texture
		atlas_records[atlas_id] = record
	if textures.size() != 10:
		_fail("Isometric production candidate requires ten projected atlases.")
		return

	var world := Node2D.new()
	world.name = "MapsooWorld"
	world.set_meta("mapsoo_profile", "isometric-action")
	world.set_meta("mapsoo_preview_manifest_sha256", FileAccess.get_sha256(manifest_path))
	root.add_child(world)
	var background := ColorRect.new()
	background.name = "Background"
	background.position = Vector2.ZERO
	background.size = Vector2(VIEWPORT_SIZE)
	background.color = Color("#0f1525")
	background.z_index = -20
	world.add_child(background)
	var camera := Camera2D.new()
	camera.name = "CaptureCamera"
	camera.position = Vector2(VIEWPORT_SIZE) * 0.5
	camera.enabled = true
	world.add_child(camera)

	var visual_count := _add_static_visuals(
		world,
		manifest.get("placements", []) as Array,
		textures,
	)
	if visual_count != 81:
		_fail("Isometric production candidate must instantiate 81 static visual placements.")
		return
	var runtime := manifest.get("runtime_layout", {}) as Dictionary
	if not _validate_runtime(runtime):
		return
	if _add_collisions(world, runtime) != 2:
		_fail("Isometric production candidate must instantiate two blockers.")
		return
	if _add_hazards(world, runtime) != 1:
		_fail("Isometric production candidate must instantiate one bound hazard.")
		return
	if _add_traversal(world, runtime) == null:
		return
	var actors := Node2D.new()
	actors.name = "Actors"
	actors.y_sort_enabled = true
	world.add_child(actors)
	var enemy_count := _add_enemies(
		actors,
		manifest.get("placements", []) as Array,
		textures,
		atlas_records,
	)
	if enemy_count != 2:
		_fail("Isometric production candidate must instantiate two production enemies.")
		return
	var player := _add_player(
		world,
		actors,
		runtime,
		textures.get("player") as Texture2D,
		atlas_records.get("player", {}) as Dictionary,
	)
	if player == null:
		return

	for _frame in 3:
		await physics_frame
	await process_frame
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
	var rendered := root.get_texture().get_image()
	if rendered == null or rendered.is_empty() or rendered.get_size() != VIEWPORT_SIZE:
		_fail("Isometric production candidate viewport did not render at 640x360.")
		return
	var metrics := _visual_metrics(rendered)
	if int(metrics.colors) < 64 or float(metrics.alpha) < 0.99:
		_fail("Isometric production candidate failed bounded visual metrics: %s" % metrics)
		return
	if rendered.save_png(output_path) != OK:
		_fail("Unable to save isometric production candidate render.")
		return

	player.set("input_enabled", true)
	Input.action_press("ui_cancel")
	await physics_frame
	Input.action_release("ui_cancel")
	await physics_frame
	if not player.has_meta("mapsoo_attack_direction"):
		_fail("Production player did not exercise the trusted attack action.")
		return

	if not await _drive_to(player, "ui_right", "x", 256.0, true, 80):
		_fail("Production player did not approach the bound hazard.")
		return
	Input.action_press("ui_up")
	for _frame in 80:
		await physics_frame
		if player.has_meta("mapsoo_last_respawn_reason"):
			break
	Input.action_release("ui_up")
	if str(player.get_meta("mapsoo_last_respawn_reason", "")) != "trap" \
			or player.position.distance_to(Vector2(160, 272)) > 2.0:
		_fail("Production player did not physically trigger and respawn from the bound hazard.")
		return

	if not await _drive_to(player, "ui_right", "x", 320.0, true, 100):
		_fail("Production player did not reach the center blocker approach.")
		return
	Input.action_press("ui_up")
	for _frame in 60:
		await physics_frame
	Input.action_release("ui_up")
	if player.position.y < 212.0 or player.position.y > 216.0:
		_fail("Production player did not physically stop on the bound center blocker: %s." % player.position)
		return
	if not await _drive_to(player, "ui_down", "y", 272.0, true, 80):
		_fail("Production player did not return to the southern route.")
		return

	Input.action_press("ui_right")
	Input.action_press("ui_accept")
	await physics_frame
	Input.action_release("ui_accept")
	Input.action_release("ui_right")
	await physics_frame
	if str(player.get_meta("mapsoo_dash_direction", "")) != "east":
		_fail("Production player did not exercise the trusted east dash.")
		return
	if not await _drive_to(player, "ui_right", "x", 448.0, true, 140):
		_fail("Production player did not traverse the southern arena route.")
		return
	if not await _drive_to(player, "ui_up", "y", 128.0, false, 140):
		_fail("Production player did not traverse the eastern arena route.")
		return
	if not await _drive_to(player, "ui_right", "x", 480.0, true, 60):
		_fail("Production player did not reach the exit approach.")
		return
	if not await _drive_until_exit(player, "ui_up", 60):
		_fail("Production player did not physically reach the bound isometric exit.")
		return

	var navigation := runtime.get("navigation", {}) as Dictionary
	var visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	print(
		"MAPSOO_ISOMETRIC_PRODUCTION_GODOT_OK manifest_sha256=%s pack_sha256=%s render_sha256=%s pixel_sha256=%s atlases=10 static=%d enemies=%d collisions=2 hazards=1 navigation=%d/%d spawn=160,272 exit=%s route=hazard-respawn-blocker-dash-walk character_clips=48 total_clips=128 animation=%s colors=%d output=%s" % [
			FileAccess.get_sha256(manifest_path),
			FileAccess.get_sha256(pack_path),
			FileAccess.get_sha256(output_path),
			_sha256(rendered.get_data()),
			visual_count,
			enemy_count,
			(navigation.get("nodes", []) as Array).size(),
			(navigation.get("edges", []) as Array).size(),
			str(player.get_meta("mapsoo_exit_reached", "")),
			visual.animation,
			int(metrics.colors),
			output_path,
		]
	)
	quit(0)


func _add_static_visuals(
	world: Node2D,
	placements: Array,
	textures: Dictionary,
) -> int:
	var layer := Node2D.new()
	layer.name = "StaticVisuals"
	layer.y_sort_enabled = true
	world.add_child(layer)
	var count := 0
	for value in placements:
		var item := value as Dictionary
		var role := str(item.get("role", ""))
		if role.begins_with("character."):
			continue
		var atlas_id := str(item.get("atlas_id", ""))
		var texture := textures.get(atlas_id) as Texture2D
		if texture == null:
			_fail("Static placement references an unknown atlas: %s." % atlas_id)
			return 0
		var sprite := _atlas_sprite(
			"Static_%03d" % count,
			texture,
			item.get("region", {}) as Dictionary,
			Vector2((item.get("top_left", {}) as Dictionary).get("x", 0), (item.get("top_left", {}) as Dictionary).get("y", 0)),
			role,
		)
		sprite.z_index = 0 if role.begins_with("terrain.") else 2
		layer.add_child(sprite)
		count += 1
	return count


func _add_enemies(
	actors: Node2D,
	placements: Array,
	textures: Dictionary,
	records: Dictionary,
) -> int:
	var count := 0
	for value in placements:
		var item := value as Dictionary
		var role := str(item.get("role", ""))
		if role not in ["character.enemy-melee.atlas", "character.enemy-ranged.atlas"]:
			continue
		var atlas_id := str(item.get("atlas_id", ""))
		var body := CharacterBody2D.new()
		body.name = "EnemyMelee" if atlas_id == "enemy-melee" else "EnemyRanged"
		var anchor := item.get("anchor", {}) as Dictionary
		body.position = Vector2(anchor.get("x", 0), anchor.get("y", 0))
		body.collision_layer = 1
		body.collision_mask = 1
		body.set_meta("mapsoo_role", role)
		var visual := _animated_visual(
			textures.get(atlas_id) as Texture2D,
			records.get(atlas_id, {}) as Dictionary,
			str(item.get("clip_id", "")),
		)
		if visual == null:
			return 0
		body.add_child(visual)
		var collision := CollisionShape2D.new()
		var capsule := CapsuleShape2D.new()
		capsule.radius = 8
		capsule.height = 24
		collision.shape = capsule
		collision.position = Vector2(0, -10)
		body.add_child(collision)
		actors.add_child(body)
		count += 1
	return count


func _add_player(
	world: Node2D,
	actors: Node2D,
	runtime: Dictionary,
	texture: Texture2D,
	record: Dictionary,
) -> CharacterBody2D:
	var data := runtime.get("player", {}) as Dictionary
	var spawn := data.get("spawn_anchor", {}) as Dictionary
	var player := CharacterBody2D.new()
	player.name = "Player"
	player.set_script(PlayerController)
	player.position = Vector2(spawn.get("x", 0), spawn.get("y", 0))
	player.collision_layer = 1
	player.collision_mask = 1
	player.set("world_bounds", Rect2(0, 0, VIEWPORT_SIZE.x, VIEWPORT_SIZE.y))
	player.set("spawn_position", player.position)
	player.set("input_enabled", false)
	player.set("exit_radius", float((runtime.get("exit", {}) as Dictionary).get("radius", 22)))
	player.attack_started.connect(
		func(direction: String) -> void:
			player.set_meta("mapsoo_attack_direction", direction)
	)
	player.dash_started.connect(
		func(direction: String) -> void:
			player.set_meta("mapsoo_dash_direction", direction)
	)
	var visual := _animated_visual(texture, record, "idle.south-east")
	if visual == null:
		return null
	player.add_child(visual)
	var collision_size := data.get("collision_size", {}) as Dictionary
	var collision_offset := data.get("collision_offset", {}) as Dictionary
	var collision := CollisionShape2D.new()
	collision.name = "CollisionShape2D"
	var capsule := CapsuleShape2D.new()
	capsule.radius = float(collision_size.get("width", 16)) * 0.5
	capsule.height = float(collision_size.get("height", 24))
	collision.shape = capsule
	collision.position = Vector2(collision_offset.get("x", 0), collision_offset.get("y", -10))
	player.add_child(collision)
	actors.add_child(player)
	player.set_meta("mapsoo_character_clip_count", (record.get("clips", []) as Array).size())
	return player


func _animated_visual(
	texture: Texture2D,
	record: Dictionary,
	initial_clip: String,
) -> AnimatedSprite2D:
	if texture == null:
		_fail("Character texture is missing.")
		return null
	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	for value in record.get("clips", []) as Array:
		var clip := value as Dictionary
		var clip_id := str(clip.get("clip_id", ""))
		var animation := clip_id.replace(".", "_")
		var origin := clip.get("pack_pixel_origin", {}) as Dictionary
		if animation.is_empty() or frames.has_animation(animation):
			_fail("Projected character clip is invalid or duplicated.")
			return null
		frames.add_animation(animation)
		frames.set_animation_loop(animation, str(clip.get("action", "")) not in ["attack-primary", "hurt", "defeat"])
		frames.set_animation_speed(animation, 8.0)
		var atlas := AtlasTexture.new()
		atlas.atlas = texture
		atlas.region = Rect2(origin.get("x", 0), origin.get("y", 0), 48, 64)
		atlas.filter_clip = true
		frames.add_frame(animation, atlas)
	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = frames
	visual.animation = initial_clip.replace(".", "_")
	visual.offset = Vector2(0, -26)
	visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	visual.z_index = 5
	return visual


func _atlas_sprite(
	node_name: String,
	texture: Texture2D,
	region: Dictionary,
	position: Vector2,
	role: String,
) -> Sprite2D:
	var atlas := AtlasTexture.new()
	atlas.atlas = texture
	atlas.region = Rect2(
		region.get("x", 0),
		region.get("y", 0),
		region.get("width", 0),
		region.get("height", 0),
	)
	atlas.filter_clip = true
	var sprite := Sprite2D.new()
	sprite.name = node_name
	sprite.texture = atlas
	sprite.centered = false
	sprite.position = position
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.set_meta("mapsoo_role", role)
	return sprite


func _add_collisions(world: Node2D, runtime: Dictionary) -> int:
	var root_node := Node2D.new()
	root_node.name = "WorldCollision"
	world.add_child(root_node)
	var count := 0
	for value in runtime.get("collision_shapes", []) as Array:
		var item := value as Dictionary
		var rect := item.get("rect", {}) as Dictionary
		var size := Vector2(rect.get("width", 0), rect.get("height", 0))
		if str(item.get("shape_type", "")) != "rect" or size.x <= 0 or size.y <= 0:
			_fail("Isometric production collision is invalid.")
			return 0
		var body := StaticBody2D.new()
		body.name = str(item.get("id", "Collision_%d" % count))
		body.position = Vector2(rect.get("x", 0), rect.get("y", 0)) + size * 0.5
		body.set_meta("mapsoo_role", item.get("role"))
		body.set_meta("mapsoo_visual_binding", item.get("visible_binding"))
		var collision := CollisionShape2D.new()
		var shape := RectangleShape2D.new()
		shape.size = size
		collision.shape = shape
		body.add_child(collision)
		root_node.add_child(body)
		count += 1
	return count


func _add_hazards(world: Node2D, runtime: Dictionary) -> int:
	var root_node := Node2D.new()
	root_node.name = "Hazards"
	world.add_child(root_node)
	var count := 0
	for value in runtime.get("hazards", []) as Array:
		var item := value as Dictionary
		var rect := item.get("rect", {}) as Dictionary
		var size := Vector2(rect.get("width", 0), rect.get("height", 0))
		var area := Area2D.new()
		area.name = str(item.get("id", "Hazard_%d" % count))
		area.position = Vector2(rect.get("x", 0), rect.get("y", 0)) + size * 0.5
		area.set_meta("mapsoo_kind", item.get("kind"))
		area.set_meta("mapsoo_role", item.get("role"))
		area.set_meta("mapsoo_visual_binding", item.get("visible_binding"))
		var collision := CollisionShape2D.new()
		var shape := RectangleShape2D.new()
		shape.size = size
		collision.shape = shape
		area.add_child(collision)
		root_node.add_child(area)
		count += 1
	return count


func _add_traversal(world: Node2D, runtime: Dictionary) -> Marker2D:
	var navigation := runtime.get("navigation", {}) as Dictionary
	var exit_id := str(navigation.get("exit_node_id", ""))
	var traversal := Node2D.new()
	traversal.name = "WorldTraversal"
	traversal.set_meta("mapsoo_exit_node_id", exit_id)
	traversal.set_meta("mapsoo_edges", (navigation.get("edges", []) as Array).duplicate(true))
	var exit_marker: Marker2D
	for value in navigation.get("nodes", []) as Array:
		var node := value as Dictionary
		var marker := Marker2D.new()
		marker.name = str(node.get("id", "")).replace("-", "_")
		marker.position = Vector2(node.get("x", 0), node.get("y", 0))
		marker.set_meta("mapsoo_id", node.get("id"))
		marker.set_meta("mapsoo_kind", node.get("kind"))
		traversal.add_child(marker)
		if str(node.get("id", "")) == exit_id:
			exit_marker = marker
	world.add_child(traversal)
	return exit_marker


func _validate_runtime(runtime: Dictionary) -> bool:
	var navigation := runtime.get("navigation", {}) as Dictionary
	var nodes := navigation.get("nodes", []) as Array
	var edges := navigation.get("edges", []) as Array
	if (runtime.get("collision_shapes", []) as Array).size() != 2 \
			or (runtime.get("hazards", []) as Array).size() != 1 \
			or nodes.size() != 7 \
			or edges.size() != 6 \
			or str(navigation.get("spawn_node_id", "")) != "spawn-node" \
			or str(navigation.get("exit_node_id", "")) != "exit-node":
		_fail("Isometric production runtime graph or physical inventory is incomplete.")
		return false
	var ids := {}
	for value in nodes:
		var node := value as Dictionary
		var node_id := str(node.get("id", ""))
		if node_id.is_empty() or ids.has(node_id):
			_fail("Isometric production navigation node ids are invalid.")
			return false
		ids[node_id] = true
	for value in edges:
		var edge := value as Dictionary
		if not ids.has(str(edge.get("from", ""))) or not ids.has(str(edge.get("to", ""))):
			_fail("Isometric production navigation edge is dangling.")
			return false
	return true


func _drive_to(
	player: CharacterBody2D,
	action: StringName,
	axis: String,
	target: float,
	increasing: bool,
	max_frames: int,
) -> bool:
	Input.action_press(action)
	for _frame in max_frames:
		await physics_frame
		var value := player.position.x if axis == "x" else player.position.y
		if (increasing and value >= target) or (not increasing and value <= target):
			Input.action_release(action)
			await physics_frame
			return true
	Input.action_release(action)
	return false


func _drive_until_exit(player: CharacterBody2D, action: StringName, max_frames: int) -> bool:
	Input.action_press(action)
	for _frame in max_frames:
		await physics_frame
		if player.has_meta("mapsoo_exit_reached"):
			Input.action_release(action)
			return true
	Input.action_release(action)
	return false


func _recorded_texture(repo_root: String, record: Dictionary) -> Texture2D:
	var relative_path := str(record.get("path", ""))
	var path := repo_root.path_join(relative_path)
	if relative_path.is_empty() or not FileAccess.file_exists(path) \
			or FileAccess.get_sha256(path) != str(record.get("sha256", "")):
		_fail("Recorded projected atlas is missing or has a mismatched digest: %s" % relative_path)
		return null
	var image := Image.new()
	if image.load_png_from_buffer(FileAccess.get_file_as_bytes(path)) != OK:
		_fail("Recorded projected atlas is not a PNG: %s" % relative_path)
		return null
	if image.get_width() != int(record.get("width", 0)) \
			or image.get_height() != int(record.get("height", 0)):
		_fail("Recorded projected atlas dimensions are stale: %s" % relative_path)
		return null
	return ImageTexture.create_from_image(image)


func _load_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK \
			or typeof(parser.data) != TYPE_DICTIONARY:
		return {}
	return parser.data as Dictionary


func _visual_metrics(image: Image) -> Dictionary:
	var colors := {}
	var opaque := 0
	var samples := 0
	for y in range(0, image.get_height(), 4):
		for x in range(0, image.get_width(), 4):
			var color := image.get_pixel(x, y)
			var key := (
				(int(round(color.r * 15.0)) << 12)
				| (int(round(color.g * 15.0)) << 8)
				| (int(round(color.b * 15.0)) << 4)
				| int(round(color.a * 15.0))
			)
			colors[key] = true
			if color.a >= 0.99:
				opaque += 1
			samples += 1
	return {"colors": colors.size(), "alpha": float(opaque) / float(samples)}


func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	push_error(message)
	quit(1)
