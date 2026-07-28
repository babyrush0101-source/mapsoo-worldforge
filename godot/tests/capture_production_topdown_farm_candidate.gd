extends SceneTree

const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd")
const ProductionReviewOverlay = preload("res://tests/helpers/production_review_overlay.gd")
const VIEWPORT_SIZE := Vector2i(640, 480)
const TERRAIN_CELL := Vector2i(32, 32)
const PROP_CELL := Vector2i(64, 64)
const CHARACTER_FRAME := Vector2i(128, 128)


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var manifest_path := _argument_value("--manifest=")
	var repo_root := _argument_value("--repo-root=")
	var output_path := _argument_value("--output=")
	var evidence_mode := _evidence_mode()
	if manifest_path.is_empty() or repo_root.is_empty() or output_path.is_empty():
		_fail("Pass manifest, repo-root and output.")
		return
	if evidence_mode.is_empty():
		return
	var manifest := _load_json(manifest_path)
	if str(manifest.get("id", "")) != "topdown-farm-production-preview-v1" \
			or str(manifest.get("profile", "")) != "topdown-farm":
		_fail("Top-down farm production preview manifest is invalid.")
		return
	var bindings := manifest.get("source_bindings", {}) as Dictionary
	var terrain_record := _load_json(repo_root.path_join(str(bindings.get("terrain_manifest", ""))))
	var prop_record := _load_json(repo_root.path_join(str(bindings.get("prop_manifest", ""))))
	var character_record := _load_json(repo_root.path_join(str(bindings.get("character_manifest", ""))))
	if terrain_record.is_empty() or prop_record.is_empty() or character_record.is_empty():
		_fail("A top-down production source manifest is invalid.")
		return
	var terrain_texture := _recorded_texture(repo_root, terrain_record, str(bindings.get("terrain_sha256", "")))
	var prop_texture := _recorded_texture(repo_root, prop_record, str(bindings.get("prop_sha256", "")))
	var character_texture := _recorded_texture(repo_root, character_record, str(bindings.get("character_sha256", "")))
	if terrain_texture == null or prop_texture == null or character_texture == null:
		return

	var world := Node2D.new()
	world.name = "TopdownFarmProductionCandidate"
	world.set_meta("mapsoo_profile", "topdown-farm")
	world.set_meta("mapsoo_preview_manifest_sha256", FileAccess.get_sha256(manifest_path))
	root.add_child(world)
	var camera := Camera2D.new()
	camera.name = "CaptureCamera"
	camera.position = Vector2(VIEWPORT_SIZE) * 0.5
	camera.enabled = true
	world.add_child(camera)

	var terrain_count := _add_terrain(
		world,
		(manifest.get("terrain_layout", {}) as Dictionary).get("placements", []) as Array,
		terrain_texture,
	)
	var prop_count := _add_props(world, manifest.get("prop_placements", []) as Array, prop_texture)
	if terrain_count != 374 or prop_count != 23:
		_fail("Top-down production layout has unexpected placement counts.")
		return
	var runtime := manifest.get("runtime_layout", {}) as Dictionary
	if not _validate_runtime(runtime):
		return
	var collision_count := _add_collisions(world, runtime)
	if collision_count != 4:
		_fail("Top-down production world must instantiate four bound collision shapes.")
		return
	var exit_marker := _add_traversal(world, runtime)
	if exit_marker == null:
		return
	var player := _add_player(world, runtime, character_texture, character_record)
	if player == null:
		return
	_attach_review_overlay(world, evidence_mode)

	for _frame in 3:
		await physics_frame
	await process_frame
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
	var rendered := root.get_texture().get_image()
	if rendered == null or rendered.is_empty() or rendered.get_size() != VIEWPORT_SIZE:
		_fail("Top-down production candidate viewport did not render at 640x480.")
		return
	var metrics := _visual_metrics(rendered)
	if int(metrics.colors) < 64 or float(metrics.alpha) < 0.99:
		_fail("Top-down production candidate failed bounded visual metrics: %s" % metrics)
		return
	if rendered.save_png(output_path) != OK:
		_fail("Unable to save top-down production candidate render.")
		return

	player.set("input_enabled", true)
	if not await _drive_to(player, "ui_up", "y", 272.0, false, 120):
		_fail("Player did not reach the west bridge approach.")
		return
	if not await _drive_to(player, "ui_right", "x", 544.0, true, 220):
		_fail("Player did not physically cross the bridge corridor.")
		return
	if not await _drive_to(player, "ui_up", "y", 96.0, false, 160):
		_fail("Player did not reach the east exit approach.")
		return
	if not await _drive_until_exit(player, "ui_right", 80):
		_fail("Player did not physically reach the bound farm exit.")
		return
	var player_visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	var navigation := runtime.get("navigation", {}) as Dictionary
	print(
		"MAPSOO_TOPDOWN_FARM_PRODUCTION_GODOT_OK manifest_sha256=%s render_sha256=%s pixel_sha256=%s terrain=%d props=%d collisions=%d navigation=%d/%d spawn=80,416 exit=%s route=walk-bridge-walk character_clips=%d character_frames=%d animation=%s colors=%d output=%s" % [
			FileAccess.get_sha256(manifest_path),
			FileAccess.get_sha256(output_path),
			_sha256(rendered.get_data()),
			terrain_count,
			prop_count,
			collision_count,
			(navigation.get("nodes", []) as Array).size(),
			(navigation.get("edges", []) as Array).size(),
			str(player.get_meta("mapsoo_exit_reached", "")),
			int(player.get_meta("mapsoo_character_clip_count", 0)),
			int(player.get_meta("mapsoo_character_frame_count", 0)),
			player_visual.animation,
			int(metrics.colors),
			output_path,
		]
	)
	quit(0)


func _add_terrain(world: Node2D, placements: Array, texture: Texture2D) -> int:
	var layer := Node2D.new()
	layer.name = "TerrainVisuals"
	layer.z_index = 0
	world.add_child(layer)
	var count := 0
	for value in placements:
		var item := value as Dictionary
		_add_atlas_sprite(
			layer,
			"Terrain_%03d" % count,
			texture,
			item.get("atlas_cell", {}) as Dictionary,
			TERRAIN_CELL,
			Vector2(int(item.get("column", 0)) * TERRAIN_CELL.x, int(item.get("row", 0)) * TERRAIN_CELL.y),
			str(item.get("role", "")),
		)
		count += 1
	return count


func _add_props(world: Node2D, placements: Array, texture: Texture2D) -> int:
	var layer := Node2D.new()
	layer.name = "PropVisuals"
	layer.z_index = 2
	world.add_child(layer)
	var count := 0
	for value in placements:
		var item := value as Dictionary
		var top_left := item.get("top_left", {}) as Dictionary
		var sprite := _add_atlas_sprite(
			layer,
			"Prop_%02d" % count,
			texture,
			item.get("atlas_cell", {}) as Dictionary,
			PROP_CELL,
			Vector2(top_left.get("x", 0), top_left.get("y", 0)),
			str(item.get("role", "")),
		)
		sprite.z_index = 2 if str(item.get("layer", "")) in ["structure", "critical"] else 1
		count += 1
	return count


func _add_atlas_sprite(
	parent: Node2D,
	node_name: String,
	texture: Texture2D,
	cell: Dictionary,
	cell_size: Vector2i,
	position: Vector2,
	role: String,
) -> Sprite2D:
	var atlas := AtlasTexture.new()
	atlas.atlas = texture
	atlas.region = Rect2(
		int(cell.get("column", 0)) * cell_size.x,
		int(cell.get("row", 0)) * cell_size.y,
		cell_size.x,
		cell_size.y,
	)
	atlas.filter_clip = true
	var sprite := Sprite2D.new()
	sprite.name = node_name
	sprite.texture = atlas
	sprite.centered = false
	sprite.position = position
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.set_meta("mapsoo_role", role)
	sprite.set_meta("mapsoo_atlas_cell", Vector2i(int(cell.get("column", 0)), int(cell.get("row", 0))))
	parent.add_child(sprite)
	return sprite


func _add_collisions(world: Node2D, runtime: Dictionary) -> int:
	var collision_root := Node2D.new()
	collision_root.name = "WorldCollision"
	world.add_child(collision_root)
	var count := 0
	for value in runtime.get("collision_shapes", []) as Array:
		var item := value as Dictionary
		if str(item.get("shape_type", "")) != "rect":
			_fail("Top-down production collision shape must be a rectangle.")
			return 0
		var rect := item.get("rect", {}) as Dictionary
		var size := Vector2(rect.get("width", 0), rect.get("height", 0))
		if size.x <= 0.0 or size.y <= 0.0:
			_fail("Top-down production collision rectangle is invalid.")
			return 0
		var body := StaticBody2D.new()
		body.name = str(item.get("id", "Collision_%d" % count))
		body.position = Vector2(rect.get("x", 0), rect.get("y", 0)) + size * 0.5
		body.set_meta("mapsoo_role", item.get("role"))
		body.set_meta("mapsoo_visual_binding", (item.get("visible_binding", {}) as Dictionary).duplicate(true))
		var shape_node := CollisionShape2D.new()
		var rectangle := RectangleShape2D.new()
		rectangle.size = size
		shape_node.shape = rectangle
		body.add_child(shape_node)
		collision_root.add_child(body)
		count += 1
	return count


func _add_traversal(world: Node2D, runtime: Dictionary) -> Marker2D:
	var navigation := runtime.get("navigation", {}) as Dictionary
	var exit := runtime.get("exit", {}) as Dictionary
	var exit_id := str(exit.get("id", ""))
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
	var shapes := runtime.get("collision_shapes", []) as Array
	var navigation := runtime.get("navigation", {}) as Dictionary
	var nodes := navigation.get("nodes", []) as Array
	var edges := navigation.get("edges", []) as Array
	if shapes.size() != 4 or nodes.size() != 7 or edges.size() != 6:
		_fail("Top-down runtime requires four collisions and a seven-node, six-edge route.")
		return false
	var ids := {}
	for value in nodes:
		var node := value as Dictionary
		var node_id := str(node.get("id", ""))
		if node_id.is_empty() or ids.has(node_id):
			_fail("Top-down navigation node ids must be non-empty and unique.")
			return false
		ids[node_id] = true
	for value in edges:
		var edge := value as Dictionary
		if not ids.has(str(edge.get("from", ""))) or not ids.has(str(edge.get("to", ""))):
			_fail("Top-down navigation edge references an unknown node.")
			return false
	if str(navigation.get("spawn_node_id", "")) != "spawn-node" \
			or str(navigation.get("exit_node_id", "")) != "exit-node":
		_fail("Top-down navigation endpoints are not bound.")
		return false
	return true


func _add_player(
	world: Node2D,
	runtime: Dictionary,
	texture: Texture2D,
	character_record: Dictionary,
) -> CharacterBody2D:
	var data := runtime.get("player", {}) as Dictionary
	var spawn := data.get("spawn_anchor", {}) as Dictionary
	var collision_size := data.get("collision_size", {}) as Dictionary
	var collision_offset := data.get("collision_offset", {}) as Dictionary
	var visual_offset := data.get("visual_offset", {}) as Dictionary
	var visual_scale := data.get("visual_scale", {}) as Dictionary
	var player := CharacterBody2D.new()
	player.name = "Player"
	player.set_script(PlayerController)
	player.set_meta("mapsoo_role", "character.player.atlas")
	player.position = Vector2(spawn.get("x", 0), spawn.get("y", 0))
	player.collision_layer = 1
	player.collision_mask = 1
	player.set("mapsoo_profile", "topdown-farm")
	player.set("world_bounds", Rect2(0, 0, VIEWPORT_SIZE.x, VIEWPORT_SIZE.y))
	player.set("spawn_position", player.position)
	player.set("input_enabled", false)
	player.set("move_speed", 180.0)
	player.set("exit_radius", float((runtime.get("exit", {}) as Dictionary).get("radius", 20)))

	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	var clip_count := 0
	var frame_count := 0
	for value in character_record.get("clips", []) as Array:
		var clip := value as Dictionary
		var animation := str(clip.get("clip_id", "")).replace(".", "_")
		var clip_frames := clip.get("frames", []) as Array
		if animation.is_empty() or clip_frames.size() < 2 or frames.has_animation(animation):
			_fail("Top-down production character contains an invalid multi-frame clip.")
			return null
		frames.add_animation(animation)
		frames.set_animation_loop(animation, bool(clip.get("loop", false)))
		frames.set_animation_speed(animation, float(clip.get("fps", 0)))
		for frame_value in clip_frames:
			var frame := frame_value as Dictionary
			var column := int(frame.get("column", -1))
			var row := int(frame.get("row", -1))
			if column < 0 or column >= 8 or row < 0 or row >= 6:
				_fail("Top-down production character frame is outside the 8x6 atlas.")
				return null
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(column * 128, row * 128, 128, 128)
			atlas.filter_clip = true
			frames.add_frame(animation, atlas)
			frame_count += 1
		clip_count += 1
	if clip_count != 12 or frame_count != 32:
		_fail("Top-down production character must bind exactly 12 clips and 32 frames.")
		return null
	player.set_meta("mapsoo_character_clip_count", clip_count)
	player.set_meta("mapsoo_character_frame_count", frame_count)
	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = frames
	visual.animation = "idle_south"
	visual.position = Vector2(visual_offset.get("x", 0), visual_offset.get("y", 0))
	visual.scale = Vector2(visual_scale.get("x", 1), visual_scale.get("y", 1))
	visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	visual.z_index = 5
	player.add_child(visual)
	var collision := CollisionShape2D.new()
	collision.name = "CollisionShape2D"
	collision.position = Vector2(collision_offset.get("x", 0), collision_offset.get("y", 0))
	var rectangle := RectangleShape2D.new()
	rectangle.size = Vector2(collision_size.get("width", 0), collision_size.get("height", 0))
	collision.shape = rectangle
	player.add_child(collision)
	world.add_child(player)
	return player


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


func _recorded_texture(repo_root: String, record: Dictionary, expected_sha256: String) -> Texture2D:
	var relative_path := str(record.get("path", ""))
	var path := repo_root.path_join(relative_path)
	if relative_path.is_empty() or not FileAccess.file_exists(path) \
			or FileAccess.get_sha256(path) != expected_sha256:
		_fail("Recorded texture is missing or has a mismatched digest: %s" % relative_path)
		return null
	var image := Image.new()
	if image.load_png_from_buffer(FileAccess.get_file_as_bytes(path)) != OK:
		_fail("Recorded texture is not a PNG: %s" % relative_path)
		return null
	if image.get_width() != int(record.get("width", 0)) \
			or image.get_height() != int(record.get("height", 0)):
		_fail("Recorded texture has mismatched dimensions: %s" % relative_path)
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


func _evidence_mode() -> String:
	var mode := _argument_value("--evidence-mode=")
	if mode.is_empty():
		return "normal"
	if mode not in ["normal", "role-overlay", "collision-overlay", "spawn-exit", "navigation"]:
		_fail("Unsupported evidence mode: %s." % mode)
		return ""
	return mode


func _attach_review_overlay(world: Node2D, mode: String) -> void:
	if mode not in ["role-overlay", "collision-overlay", "navigation"]:
		return
	var overlay := ProductionReviewOverlay.new()
	overlay.name = "ProductionReviewOverlay"
	world.add_child(overlay)
	overlay.configure(mode, world)


func _fail(message: String) -> void:
	push_error(message)
	quit(1)
