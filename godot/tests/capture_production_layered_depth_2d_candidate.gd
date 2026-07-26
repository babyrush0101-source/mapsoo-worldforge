extends SceneTree

const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_layered_depth_player_controller.gd")
const VIEWPORT_SIZE := Vector2i(640, 360)
const LAYER_SOURCE_SIZE := Vector2i(1280, 720)
const PROP_CELL_SIZE := Vector2i(96, 96)
const CHARACTER_FRAME_SIZE := Vector2i(48, 72)


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var layers_manifest_path := _argument_value("--layers-manifest=")
	var props_manifest_path := _argument_value("--props-manifest=")
	var player_manifest_path := _argument_value("--player-manifest=")
	var npc_manifest_path := _argument_value("--npc-manifest=")
	var repo_root := _argument_value("--repo-root=")
	var output_path := _argument_value("--output=")
	if layers_manifest_path.is_empty() or props_manifest_path.is_empty() \
			or player_manifest_path.is_empty() or npc_manifest_path.is_empty() \
			or repo_root.is_empty() or output_path.is_empty():
		_fail("Pass all four manifests, repo-root and output.")
		return

	var layers_manifest := _load_json(layers_manifest_path)
	var props_manifest := _load_json(props_manifest_path)
	var player_manifest := _load_json(player_manifest_path)
	var npc_manifest := _load_json(npc_manifest_path)
	if not _validate_manifests(layers_manifest, props_manifest, player_manifest, npc_manifest):
		return

	var world := Node2D.new()
	world.name = "MapsooWorld"
	world.set_meta("mapsoo_profile", "layered-depth-2d")
	root.add_child(world)
	var camera := Camera2D.new()
	camera.name = "CaptureCamera"
	camera.position = Vector2(VIEWPORT_SIZE) * 0.5
	camera.enabled = true
	world.add_child(camera)

	var layer_textures := {}
	for value in layers_manifest.get("layers", []) as Array:
		var record := value as Dictionary
		var texture := _recorded_texture(
			repo_root,
			record.get("runtime", {}) as Dictionary,
			LAYER_SOURCE_SIZE,
		)
		if texture == null:
			return
		layer_textures[str(record.get("role", ""))] = texture
	if layer_textures.size() != 8:
		_fail("Layered-depth production candidate requires eight exact runtime layers.")
		return
	if not _add_layers(world, layers_manifest, layer_textures):
		return

	var prop_texture := _recorded_texture(repo_root, props_manifest, Vector2i(768, 768))
	var player_texture := _recorded_texture(repo_root, player_manifest, Vector2i(384, 576))
	var npc_texture := _recorded_texture(repo_root, npc_manifest, Vector2i(384, 576))
	if prop_texture == null or player_texture == null or npc_texture == null:
		return

	var prop_count := _add_props(world, props_manifest, prop_texture)
	if prop_count != 22:
		_fail("Layered-depth production candidate must instantiate all 22 production prop roles.")
		return
	if _add_blockers(world) != 1:
		_fail("Layered-depth production candidate must instantiate one visible blocker.")
		return
	if not _add_traversal(world):
		return
	if not _add_collectible(world):
		return

	var actors := Node2D.new()
	actors.name = "Actors"
	actors.y_sort_enabled = true
	world.add_child(actors)
	var npc := _add_npc(actors, npc_texture, npc_manifest)
	if npc == null:
		return
	var player := _add_player(actors, player_texture, player_manifest)
	if player == null:
		return

	for _frame in 3:
		await physics_frame
	await process_frame
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
	var rendered := root.get_texture().get_image()
	if rendered == null or rendered.is_empty() or rendered.get_size() != VIEWPORT_SIZE:
		_fail("Layered-depth production candidate viewport did not render at 640x360.")
		return
	var metrics := _visual_metrics(rendered)
	if int(metrics.colors) < 96 or float(metrics.alpha) < 0.99:
		_fail("Layered-depth production candidate failed bounded visual metrics: %s" % metrics)
		return
	if rendered.save_png(output_path) != OK:
		_fail("Unable to save layered-depth production candidate render.")
		return

	player.set("input_enabled", true)
	if not await _drive_to(player, "ui_right", "x", 176.0, true, 50):
		_fail("Production player did not reach the bound NPC.")
		return
	Input.action_press("ui_accept")
	await physics_frame
	Input.action_release("ui_accept")
	await physics_frame
	if str(player.get_meta("mapsoo_last_interaction", "")) != "npc":
		_fail("Production player did not physically interact with the bound NPC.")
		return

	if not await _drive_to(player, "ui_right", "x", 248.0, true, 60):
		_fail("Production player did not approach the bound collectible.")
		return
	for _frame in 4:
		await physics_frame
	if str(player.get_meta("mapsoo_last_collectible", "")) != "collectible.primary":
		_fail("Production player did not physically collect the bound primary collectible.")
		return

	Input.action_press("ui_right")
	for _frame in 50:
		await physics_frame
	Input.action_release("ui_right")
	await physics_frame
	if player.position.x < 290.0 or player.position.x > 294.0:
		_fail("Production player did not physically stop on the bound route blocker: %s." % player.position)
		return

	if not await _drive_to(player, "ui_up", "y", 174.0, false, 90):
		_fail("Production player did not traverse the authored stairs route.")
		return
	if not await _drive_to(player, "ui_right", "x", 352.0, true, 70):
		_fail("Production player did not reach the bridge entrance.")
		return
	if not await _drive_to(player, "ui_right", "x", 432.0, true, 70):
		_fail("Production player did not cross the authored bridge.")
		return
	if not await _drive_until_exit(player, "ui_right", 80):
		_fail("Production player did not physically reach the bound layered-depth exit.")
		return

	var visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	print(
		"MAPSOO_LAYERED_DEPTH_PRODUCTION_GODOT_OK layers_sha256=%s props_sha256=%s player_sha256=%s npc_sha256=%s render_sha256=%s pixel_sha256=%s layers=8 front_layers=2 prop_roles=%d player_clips=%d npc_clips=%d collisions=1 collectibles=1 npc_interactions=1 navigation=7/6 spawn=112,286 exit=%s route=npc-collectible-blocker-stairs-bridge-exit route_gate=pass animation=%s colors=%d output=%s" % [
			FileAccess.get_sha256(layers_manifest_path),
			FileAccess.get_sha256(props_manifest_path),
			FileAccess.get_sha256(player_manifest_path),
			FileAccess.get_sha256(npc_manifest_path),
			FileAccess.get_sha256(output_path),
			_sha256(rendered.get_data()),
			prop_count,
			(player_manifest.get("clips", []) as Array).size(),
			(npc_manifest.get("clips", []) as Array).size(),
			str(player.get_meta("mapsoo_exit_reached", "")),
			visual.animation,
			int(metrics.colors),
			output_path,
		]
	)
	quit(0)


func _validate_manifests(
	layers: Dictionary,
	props: Dictionary,
	player: Dictionary,
	npc: Dictionary,
) -> bool:
	if str(layers.get("id", "")) != "layered-depth-2d-production-layers-v1" \
			or str(props.get("id", "")) != "layered-depth-2d-prop-atlas-v1" \
			or str(player.get("id", "")) != "layered-depth-2d-player-atlas-v1" \
			or str(npc.get("id", "")) != "layered-depth-2d-npc-atlas-v1":
		_fail("Layered-depth production manifests are invalid.")
		return false
	for manifest in [layers, props, player, npc]:
		if str((manifest as Dictionary).get("profile", "")) != "layered-depth-2d":
			_fail("Layered-depth production manifest profile mismatch.")
			return false
	var expected_roles := {
		"background.sky": true,
		"background.far": true,
		"background.mid": true,
		"background.depth-fog": true,
		"near.overlay": true,
		"foreground.overlay": true,
		"lighting.ambient": true,
		"lighting.local": true,
	}
	var seen_roles := {}
	for value in layers.get("layers", []) as Array:
		var record := value as Dictionary
		var role := str(record.get("role", ""))
		if not expected_roles.has(role) or seen_roles.has(role):
			_fail("Layered-depth production layer inventory is invalid.")
			return false
		seen_roles[role] = true
		if role in ["near.overlay", "foreground.overlay"]:
			var route := record.get("character_route_metrics", {}) as Dictionary
			if float(route.get("opaque_fraction", 1.0)) > 0.01 \
					or float(route.get("mean_alpha", 255.0)) > 3.0:
				_fail("Layered-depth front layer fails the central route occlusion gate.")
				return false
	if seen_roles.size() != 8 \
			or (props.get("required_roles", []) as Array).size() != 22 \
			or (props.get("role_mappings", []) as Array).size() != 22 \
			or (player.get("clips", []) as Array).size() != 16 \
			or (player.get("frames", []) as Array).size() != 32 \
			or (npc.get("clips", []) as Array).size() != 8 \
			or (npc.get("frames", []) as Array).size() != 16:
		_fail("Layered-depth production inventory is incomplete.")
		return false
	return true


func _add_layers(world: Node2D, manifest: Dictionary, textures: Dictionary) -> bool:
	var root_node := Node2D.new()
	root_node.name = "ProductionLayers"
	world.add_child(root_node)
	for value in manifest.get("layers", []) as Array:
		var record := value as Dictionary
		var role := str(record.get("role", ""))
		var sprite := Sprite2D.new()
		sprite.name = role.replace(".", "_")
		sprite.texture = textures.get(role) as Texture2D
		sprite.centered = false
		sprite.scale = Vector2(0.5, 0.5)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.z_index = _runtime_z(role)
		sprite.set_meta("mapsoo_role", role)
		if role in ["near.overlay", "foreground.overlay"]:
			sprite.modulate = Color(0.72, 0.76, 0.86, 0.90)
		elif role == "lighting.local":
			sprite.modulate = Color(1.0, 1.0, 1.0, 0.82)
		var blend := str(record.get("blend_mode", "mix"))
		if blend in ["multiply", "add"]:
			var material := CanvasItemMaterial.new()
			material.blend_mode = (
				CanvasItemMaterial.BLEND_MODE_MUL
				if blend == "multiply"
				else CanvasItemMaterial.BLEND_MODE_ADD
			)
			sprite.material = material
		root_node.add_child(sprite)
	return true


func _runtime_z(role: String) -> int:
	match role:
		"background.sky":
			return -100
		"background.far":
			return -90
		"background.mid":
			return -80
		"background.depth-fog":
			return -70
		"near.overlay":
			return 30
		"foreground.overlay":
			return 40
		"lighting.ambient":
			# Match the runtime candidate: ambient darkness affects the world,
			# while actors render above it for gameplay readability.
			return 5
		"lighting.local":
			return 60
	return 0


func _add_props(world: Node2D, manifest: Dictionary, texture: Texture2D) -> int:
	var anchors := [
		Vector2(74, 336), Vector2(154, 336), Vector2(232, 336),
		Vector2(390, 220), Vector2(292, 220), Vector2(554, 338),
		Vector2(58, 292), Vector2(106, 326), Vector2(214, 324),
		Vector2(254, 316), Vector2(344, 204), Vector2(316, 320),
		Vector2(68, 306), Vector2(560, 206), Vector2(286, 210),
		Vector2(476, 194), Vector2(248, 286), Vector2(462, 174),
		Vector2(176, 302), Vector2(186, 274), Vector2(538, 182),
		Vector2(420, 194),
	]
	var layer := Node2D.new()
	layer.name = "ProductionProps"
	layer.y_sort_enabled = true
	layer.z_index = -5
	world.add_child(layer)
	var count := 0
	var seen := {}
	for value in manifest.get("role_mappings", []) as Array:
		var item := value as Dictionary
		var role := str(item.get("role", ""))
		if role.is_empty() or seen.has(role):
			_fail("Production prop role is empty or duplicated.")
			return 0
		seen[role] = true
		var cell := item.get("atlas_cell", {}) as Dictionary
		var atlas := AtlasTexture.new()
		atlas.atlas = texture
		atlas.region = Rect2(
			int(cell.get("column", 0)) * PROP_CELL_SIZE.x,
			int(cell.get("row", 0)) * PROP_CELL_SIZE.y,
			PROP_CELL_SIZE.x,
			PROP_CELL_SIZE.y,
		)
		atlas.filter_clip = true
		var sprite := Sprite2D.new()
		sprite.name = "Prop_%02d" % count
		sprite.texture = atlas
		sprite.centered = false
		sprite.scale = Vector2(0.62, 0.62)
		sprite.position = anchors[count] - Vector2(48, 96) * sprite.scale
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.set_meta("mapsoo_role", role)
		layer.add_child(sprite)
		count += 1
	return count


func _add_blockers(world: Node2D) -> int:
	var root_node := Node2D.new()
	root_node.name = "WorldCollision"
	world.add_child(root_node)
	var body := StaticBody2D.new()
	body.name = "RouteBlocker"
	body.position = Vector2(316, 264)
	body.set_meta("mapsoo_role", "prop.occluder")
	body.set_meta("mapsoo_visual_binding", "prop.occluder")
	var collision := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = Vector2(32, 144)
	collision.shape = shape
	body.add_child(collision)
	root_node.add_child(body)
	return 1


func _add_collectible(world: Node2D) -> bool:
	var root_node := Node2D.new()
	root_node.name = "Collectibles"
	world.add_child(root_node)
	var area := Area2D.new()
	area.name = "PrimaryCollectible"
	area.position = Vector2(248, 286)
	area.set_meta("mapsoo_role", "collectible.primary")
	var collision := CollisionShape2D.new()
	var shape := CircleShape2D.new()
	shape.radius = 14
	collision.shape = shape
	area.add_child(collision)
	area.body_entered.connect(
		func(body: Node2D) -> void:
			if body.name == "Player":
				body.set_meta("mapsoo_last_collectible", "collectible.primary")
				area.set_deferred("monitoring", false)
	)
	root_node.add_child(area)
	return true


func _add_traversal(world: Node2D) -> bool:
	var nodes := [
		{"id": "spawn-node", "kind": "spawn", "position": Vector2(112, 286)},
		{"id": "npc-node", "kind": "npc", "position": Vector2(176, 286)},
		{"id": "collectible-node", "kind": "collectible", "position": Vector2(248, 286)},
		{"id": "stairs-node", "kind": "stairs", "position": Vector2(280, 174)},
		{"id": "bridge-entry-node", "kind": "bridge-entry", "position": Vector2(352, 174)},
		{"id": "bridge-exit-node", "kind": "bridge-exit", "position": Vector2(432, 174)},
		{"id": "exit-node", "kind": "exit", "position": Vector2(520, 174)},
	]
	var edges := [
		{"from": "spawn-node", "to": "npc-node"},
		{"from": "npc-node", "to": "collectible-node"},
		{"from": "collectible-node", "to": "stairs-node"},
		{"from": "stairs-node", "to": "bridge-entry-node"},
		{"from": "bridge-entry-node", "to": "bridge-exit-node"},
		{"from": "bridge-exit-node", "to": "exit-node"},
	]
	var traversal := Node2D.new()
	traversal.name = "WorldTraversal"
	traversal.set_meta("mapsoo_exit_node_id", "exit-node")
	traversal.set_meta("mapsoo_edges", edges)
	for item in nodes:
		var marker := Marker2D.new()
		marker.name = str(item.id).replace("-", "_")
		marker.position = item.position
		marker.set_meta("mapsoo_id", item.id)
		marker.set_meta("mapsoo_kind", item.kind)
		traversal.add_child(marker)
	world.add_child(traversal)
	return traversal.get_child_count() == 7 and edges.size() == 6


func _add_npc(actors: Node2D, texture: Texture2D, manifest: Dictionary) -> CharacterBody2D:
	var npc := CharacterBody2D.new()
	npc.name = "LanternKeeper"
	npc.position = Vector2(190, 286)
	npc.collision_layer = 0
	npc.collision_mask = 0
	npc.set_meta("mapsoo_character_id", "npc")
	npc.set_meta("mapsoo_role", "character.npc.atlas")
	var visual := _animated_visual(texture, manifest, "idle.left")
	if visual == null:
		return null
	npc.add_child(visual)
	actors.add_child(npc)
	return npc


func _add_player(
	actors: Node2D,
	texture: Texture2D,
	manifest: Dictionary,
) -> CharacterBody2D:
	var player := CharacterBody2D.new()
	player.name = "Player"
	player.set_script(PlayerController)
	player.position = Vector2(112, 286)
	player.collision_layer = 1
	player.collision_mask = 1
	player.set("world_bounds", Rect2(0, 0, VIEWPORT_SIZE.x, VIEWPORT_SIZE.y))
	player.set("movement_bounds", Rect2(32, 112, 576, 212))
	player.set("spawn_position", player.position)
	player.set("input_enabled", false)
	player.set("interaction_radius", 72.0)
	player.set("exit_radius", 24.0)
	var visual := _animated_visual(texture, manifest, "idle.near")
	if visual == null:
		return null
	player.add_child(visual)
	var collision := CollisionShape2D.new()
	collision.name = "CollisionShape2D"
	var capsule := CapsuleShape2D.new()
	capsule.radius = 7
	capsule.height = 26
	collision.shape = capsule
	collision.position = Vector2(0, -13)
	player.add_child(collision)
	actors.add_child(player)
	return player


func _animated_visual(
	texture: Texture2D,
	manifest: Dictionary,
	initial_clip: String,
) -> AnimatedSprite2D:
	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	for value in manifest.get("clips", []) as Array:
		var clip := value as Dictionary
		var clip_id := str(clip.get("clip_id", ""))
		var animation := clip_id.replace(".", "_")
		if animation.is_empty() or frames.has_animation(animation):
			_fail("Production character clip is invalid or duplicated.")
			return null
		frames.add_animation(animation)
		frames.set_animation_loop(animation, bool(clip.get("loop", true)))
		frames.set_animation_speed(animation, float(clip.get("fps", 5)))
		for frame_value in clip.get("frames", []) as Array:
			var frame := frame_value as Dictionary
			var origin := frame.get("pixel_origin", {}) as Dictionary
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(
				origin.get("x", 0),
				origin.get("y", 0),
				CHARACTER_FRAME_SIZE.x,
				CHARACTER_FRAME_SIZE.y,
			)
			atlas.filter_clip = true
			frames.add_frame(animation, atlas)
	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = frames
	visual.animation = initial_clip.replace(".", "_")
	visual.offset = Vector2(0, -67)
	visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	visual.z_index = 10
	return visual


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


func _recorded_texture(
	repo_root: String,
	record: Dictionary,
	expected_size: Vector2i,
) -> Texture2D:
	var relative_path := str(record.get("path", ""))
	var path := repo_root.path_join(relative_path)
	if relative_path.is_empty() or not FileAccess.file_exists(path) \
			or FileAccess.get_sha256(path) != str(record.get("sha256", "")):
		_fail("Recorded production texture is missing or has a mismatched digest: %s" % relative_path)
		return null
	var image := Image.new()
	if image.load_png_from_buffer(FileAccess.get_file_as_bytes(path)) != OK:
		_fail("Recorded production texture is not a PNG: %s" % relative_path)
		return null
	if image.get_size() != expected_size \
			or image.get_width() != int(record.get("width", 0)) \
			or image.get_height() != int(record.get("height", 0)):
		_fail("Recorded production texture dimensions are stale: %s" % relative_path)
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
