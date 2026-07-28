extends SceneTree

const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd")
const ProductionReviewOverlay = preload("res://tests/helpers/production_review_overlay.gd")
const WORLD_SIZE := Vector2i(1280, 720)
const VIEWPORT_SIZE := Vector2i(640, 360)
const TERRAIN_CELL := Vector2i(48, 48)
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
	if manifest.is_empty() or str(manifest.get("schema_version", "")) != "mapsoo-production-world-preview/1.0":
		_fail("Production preview manifest is invalid.")
		return
	var source_bindings := manifest.get("source_bindings", {}) as Dictionary
	var background_manifest := _load_json(repo_root.path_join(str(source_bindings.get("capture_background_manifest", ""))))
	var terrain_record := _load_json(repo_root.path_join(str(source_bindings.get("terrain_manifest", ""))))
	var prop_record := _load_json(repo_root.path_join(str(source_bindings.get("prop_manifest", ""))))
	var character_record := _load_json(repo_root.path_join(str(source_bindings.get("character_manifest", ""))))
	if background_manifest.is_empty() or terrain_record.is_empty() or prop_record.is_empty() or character_record.is_empty():
		_fail("A production source manifest is invalid.")
		return

	var terrain_texture := _recorded_texture(repo_root, terrain_record, str(source_bindings.get("terrain_sha256", "")))
	var prop_texture := _recorded_texture(repo_root, prop_record, str(source_bindings.get("prop_sha256", "")))
	var character_texture := _recorded_texture(repo_root, character_record, str(source_bindings.get("character_sha256", "")))
	if terrain_texture == null or prop_texture == null or character_texture == null:
		return

	var world := Node2D.new()
	world.name = "ProductionCandidate"
	world.set_meta("mapsoo_profile", "side-platformer")
	world.set_meta("mapsoo_preview_manifest_sha256", FileAccess.get_sha256(manifest_path))
	root.add_child(world)
	var camera := Camera2D.new()
	camera.name = "CaptureCamera"
	camera.position = Vector2(WORLD_SIZE) * 0.5
	camera.zoom = Vector2(0.5, 0.5)
	camera.enabled = true
	world.add_child(camera)

	var background_count := _add_backgrounds(world, repo_root, background_manifest)
	if background_count != 4:
		_fail("Production candidate must instantiate four rear background layers.")
		return
	var terrain_count := _add_terrain(world, manifest.get("terrain_layout", {}) as Dictionary, terrain_texture)
	if terrain_count != 89:
		_fail("Production terrain layout must instantiate 89 visible cells.")
		return
	var placement_count := _add_props(world, manifest.get("placements", []) as Array, prop_texture)
	if placement_count != 10:
		_fail("Production prop layout must instantiate ten visible roles.")
		return
	var runtime_layout := manifest.get("runtime_layout", {}) as Dictionary
	if not _validate_runtime_layout(manifest.get("terrain_layout", {}) as Dictionary, runtime_layout):
		return
	var collision_count := _add_collisions(world, runtime_layout)
	if collision_count != 5 or not _verify_collision_bindings(world, runtime_layout):
		return
	var exit_marker := _add_traversal(world, runtime_layout)
	if exit_marker == null:
		return
	var player := _add_player(world, runtime_layout, character_texture, character_record)
	if player == null:
		return
	var foreground_count := _add_foreground(world, repo_root, background_manifest)
	if foreground_count != 1:
		return
	_attach_review_overlay(world, evidence_mode, 2.0)

	for _frame in 90:
		await physics_frame
	if not player.is_on_floor() or player.position.distance_to(Vector2(144, 576)) > 2.0:
		_fail("Player spawn anchor does not settle on the bound ground top.")
		return
	await process_frame
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
	var rendered := root.get_texture().get_image()
	if rendered == null or rendered.is_empty() or rendered.get_size() != VIEWPORT_SIZE:
		_fail("Production candidate viewport did not render at 640x360.")
		return
	var metrics := _visual_metrics(rendered)
	if int(metrics.colors) < 64 or float(metrics.alpha) < 0.99:
		_fail("Rendered production candidate failed bounded visual metrics: %s" % metrics)
		return
	var save_error := rendered.save_png(output_path)
	if save_error != OK:
		_fail("Unable to save production candidate render: %s" % error_string(save_error))
		return
	if evidence_mode not in ["spawn-exit", "navigation"]:
		world.visible = false

	player.set("input_enabled", true)
	Input.action_press("ui_right")
	var slope_min_y := player.position.y
	var slope_descended := false
	var wall_jump_sent := false
	var wall_cleared_airborne := false
	for _frame in 600:
		var release_jump := false
		if not wall_jump_sent and player.position.x >= 900.0 and player.is_on_floor():
			Input.action_press("ui_accept")
			wall_jump_sent = true
			release_jump = true
		await physics_frame
		if release_jump:
			Input.action_release("ui_accept")
		if player.position.x >= 704.0 and player.position.x <= 824.0:
			slope_min_y = minf(slope_min_y, player.position.y)
		if player.position.x >= 824.0 and player.position.x < 900.0 \
				and player.is_on_floor() and absf(player.position.y - 576.0) <= 2.0:
			slope_descended = true
		if player.position.x >= 976.0 and player.position.x <= 1016.0 \
				and player.position.y < 560.0:
			wall_cleared_airborne = true
		if player.has_meta("mapsoo_exit_reached"):
			break
	Input.action_release("ui_right")
	Input.action_release("ui_accept")
	if slope_min_y > 548.0 or not slope_descended:
		_fail("Player did not physically ascend and descend the two bound slope polygons.")
		return
	if not wall_jump_sent or not wall_cleared_airborne:
		_fail("Player did not physically jump over the bound terrain.wall collision.")
		return
	if str(player.get_meta("mapsoo_exit_reached", "")) != str(runtime_layout.get("exit", {}).get("id", "")):
		_fail("Player did not traverse the bound spawn-to-exit navigation route.")
		return
	var player_visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	var navigation := runtime_layout.get("navigation", {}) as Dictionary
	print(
		"MAPSOO_PRODUCTION_CANDIDATE_RENDER_OK manifest_sha256=%s render_sha256=%s pixel_sha256=%s backgrounds=%d terrain=%d props=%d collisions=%d collision_roles=3 navigation=%d/%d spawn=144,576 exit=%s route=walk-slope-jump slope_min_y=%.2f wall_airborne=true character_clips=%d character_frames=%d animation=%s colors=%d output=%s" % [
			FileAccess.get_sha256(manifest_path),
			FileAccess.get_sha256(output_path),
			_sha256(rendered.get_data()),
			background_count + foreground_count,
			terrain_count,
			placement_count,
			collision_count,
			(navigation.get("nodes", []) as Array).size(),
			(navigation.get("edges", []) as Array).size(),
			str(player.get_meta("mapsoo_exit_reached", "")),
			slope_min_y,
			int(player.get_meta("mapsoo_character_clip_count", 0)),
			int(player.get_meta("mapsoo_character_frame_count", 0)),
			player_visual.animation,
			int(metrics.colors),
			output_path,
		]
	)
	quit(0)


func _add_backgrounds(world: Node2D, repo_root: String, manifest: Dictionary) -> int:
	var layers := manifest.get("layers", []) as Array
	if layers.size() != 5:
		_fail("Background manifest must contain five layers.")
		return 0
	var count := 0
	for index in 4:
		var record := layers[index] as Dictionary
		var texture := _recorded_texture(repo_root, record, str(record.get("sha256", "")))
		if texture == null:
			return 0
		var sprite := Sprite2D.new()
		sprite.name = "Background_%d" % index
		sprite.texture = texture
		sprite.centered = false
		sprite.position = Vector2.ZERO
		sprite.scale = Vector2(
			float(WORLD_SIZE.x) / float(texture.get_width()),
			float(WORLD_SIZE.y) / float(texture.get_height())
		)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.z_index = index
		sprite.set_meta("mapsoo_role", record.get("role"))
		sprite.set_meta("mapsoo_sha256", record.get("sha256"))
		world.add_child(sprite)
		count += 1
	return count


func _add_foreground(world: Node2D, repo_root: String, manifest: Dictionary) -> int:
	var record := (manifest.get("layers", []) as Array)[4] as Dictionary
	var texture := _recorded_texture(repo_root, record, str(record.get("sha256", "")))
	if texture == null:
		return 0
	var sprite := Sprite2D.new()
	sprite.name = "ForegroundOverlay"
	sprite.texture = texture
	sprite.centered = false
	sprite.scale = Vector2(
		float(WORLD_SIZE.x) / float(texture.get_width()),
		float(WORLD_SIZE.y) / float(texture.get_height())
	)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.z_index = 20
	sprite.set_meta("mapsoo_role", record.get("role"))
	sprite.set_meta("mapsoo_sha256", record.get("sha256"))
	world.add_child(sprite)
	return 1


func _add_terrain(world: Node2D, layout: Dictionary, texture: Texture2D) -> int:
	var root_node := Node2D.new()
	root_node.name = "TerrainVisuals"
	root_node.z_index = 5
	world.add_child(root_node)
	var count := 0
	for run_value in layout.get("runs", []) as Array:
		var run := run_value as Dictionary
		var start := run.get("start", {}) as Dictionary
		var step := run.get("step", {}) as Dictionary
		for index in int(run.get("count", 0)):
			_add_atlas_sprite(
				root_node,
				"Terrain_%03d" % count,
				texture,
				run.get("atlas_cell", {}) as Dictionary,
				TERRAIN_CELL,
				Vector2(float(start.get("x", 0)) + float(step.get("x", 0)) * index, float(start.get("y", 0)) + float(step.get("y", 0)) * index),
				str(run.get("role", ""))
			)
			count += 1
	for item_value in layout.get("singles", []) as Array:
		var item := item_value as Dictionary
		_add_atlas_sprite(
			root_node,
			"Terrain_%03d" % count,
			texture,
			item.get("atlas_cell", {}) as Dictionary,
			TERRAIN_CELL,
			Vector2(item.get("x", 0), item.get("y", 0)),
			str(item.get("role", ""))
		)
		count += 1
	return count


func _add_props(world: Node2D, placements: Array, texture: Texture2D) -> int:
	var root_node := Node2D.new()
	root_node.name = "Props"
	root_node.z_index = 6
	world.add_child(root_node)
	var count := 0
	for item_value in placements:
		var item := item_value as Dictionary
		var role := str(item.get("role", ""))
		if role == "character.player.atlas":
			continue
		_add_atlas_sprite(
			root_node,
			"Prop_%02d" % count,
			texture,
			item.get("atlas_cell", {}) as Dictionary,
			PROP_CELL,
			Vector2(item.get("x", 0), item.get("y", 0)),
			role
		)
		count += 1
	return count


func _add_atlas_sprite(parent: Node2D, node_name: String, texture: Texture2D, cell: Dictionary, cell_size: Vector2i, position: Vector2, role: String) -> void:
	var atlas := AtlasTexture.new()
	atlas.atlas = texture
	atlas.region = Rect2(
		int(cell.get("column", 0)) * cell_size.x,
		int(cell.get("row", 0)) * cell_size.y,
		cell_size.x,
		cell_size.y
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


func _add_collisions(world: Node2D, runtime: Dictionary) -> int:
	var collision_root := Node2D.new()
	collision_root.name = "WorldCollision"
	world.add_child(collision_root)
	var count := 0
	for item_value in runtime.get("collision_shapes", []) as Array:
		var item := item_value as Dictionary
		var body := StaticBody2D.new()
		body.name = str(item.get("id", "Collision_%d" % count))
		body.set_meta("mapsoo_role", item.get("role"))
		body.set_meta("mapsoo_binding_id", item.get("id"))
		body.set_meta("mapsoo_shape_type", item.get("shape_type"))
		body.set_meta("mapsoo_visual_binding", (item.get("visual_binding", {}) as Dictionary).duplicate(true))
		if str(item.get("shape_type", "")) == "rect":
			var rect := item.get("rect", {}) as Dictionary
			var size := Vector2(rect.get("width", 0), rect.get("height", 0))
			if size.x <= 0 or size.y <= 0:
				_fail("Collision rectangle has invalid geometry.")
				return 0
			body.position = Vector2(rect.get("x", 0), rect.get("y", 0)) + size * 0.5
			body.set_meta("mapsoo_rect", Rect2(Vector2(rect.get("x", 0), rect.get("y", 0)), size))
			var shape_node := CollisionShape2D.new()
			shape_node.name = "CollisionShape2D"
			var rectangle := RectangleShape2D.new()
			rectangle.size = size
			shape_node.shape = rectangle
			shape_node.one_way_collision = str(item.get("kind", "")) == "one-way"
			body.add_child(shape_node)
		elif str(item.get("shape_type", "")) == "polygon":
			var points := PackedVector2Array()
			for point_value in item.get("points", []) as Array:
				var point := point_value as Dictionary
				points.append(Vector2(point.get("x", 0), point.get("y", 0)))
			if points.size() != 3:
				_fail("Production slope collision must be one explicit triangle.")
				return 0
			var polygon := CollisionPolygon2D.new()
			polygon.name = "CollisionPolygon2D"
			polygon.polygon = points
			body.set_meta("mapsoo_points", points)
			body.add_child(polygon)
		else:
			_fail("Collision shape type is unsupported.")
			return 0
		collision_root.add_child(body)
		count += 1
	return count


func _add_traversal(world: Node2D, runtime: Dictionary) -> Marker2D:
	var exit := runtime.get("exit", {}) as Dictionary
	var exit_id := str(exit.get("id", ""))
	if exit_id.is_empty():
		_fail("Runtime layout has no exit.")
		return null
	var traversal := Node2D.new()
	traversal.name = "WorldTraversal"
	traversal.set_meta("mapsoo_exit_node_id", exit_id)
	traversal.set_meta("mapsoo_route_kind", "walk-slope-jump")
	var navigation := runtime.get("navigation", {}) as Dictionary
	traversal.set_meta("mapsoo_edges", (navigation.get("edges", []) as Array).duplicate(true))
	var exit_marker: Marker2D
	for node_value in navigation.get("nodes", []) as Array:
		var node := node_value as Dictionary
		var marker := Marker2D.new()
		marker.name = _node_name(str(node.get("id", "")))
		marker.position = Vector2(node.get("x", 0), node.get("y", 0))
		marker.set_meta("mapsoo_id", node.get("id"))
		marker.set_meta("mapsoo_kind", node.get("kind"))
		traversal.add_child(marker)
		if str(node.get("id", "")) == exit_id:
			exit_marker = marker
	world.add_child(traversal)
	return exit_marker


func _validate_runtime_layout(terrain_layout: Dictionary, runtime: Dictionary) -> bool:
	var singles := terrain_layout.get("singles", []) as Array
	var collision_shapes := runtime.get("collision_shapes", []) as Array
	if singles.size() != 3 or collision_shapes.size() != 5:
		_fail("Production candidate requires three collision-bearing terrain singles and five shapes.")
		return false
	var required_roles := {
		"terrain.slope-up": false,
		"terrain.slope-down": false,
		"terrain.wall": false,
	}
	var collision_ids := {}
	for item_value in collision_shapes:
		var item := item_value as Dictionary
		var collision_id := str(item.get("id", ""))
		if collision_id.is_empty() or collision_ids.has(collision_id):
			_fail("Production collision ids must be non-empty and unique.")
			return false
		collision_ids[collision_id] = true
		var role := str(item.get("role", ""))
		if not required_roles.has(role):
			continue
		var binding := item.get("visual_binding", {}) as Dictionary
		var single_index := int(binding.get("terrain_single_index", -1))
		if single_index < 0 or single_index >= singles.size():
			_fail("Collision %s has no terrain single binding." % collision_id)
			return false
		var single := singles[single_index] as Dictionary
		var binding_cell := binding.get("atlas_cell", {}) as Dictionary
		var single_cell := single.get("atlas_cell", {}) as Dictionary
		var binding_rect := binding.get("rect", {}) as Dictionary
		if str(single.get("role", "")) != role \
				or int(single.get("x", -1)) != int(binding_rect.get("x", -2)) \
				or int(single.get("y", -1)) != int(binding_rect.get("y", -2)) \
				or int(binding_rect.get("width", 0)) != TERRAIN_CELL.x \
				or int(binding_rect.get("height", 0)) != TERRAIN_CELL.y \
				or int(binding_cell.get("column", -1)) != int(single_cell.get("column", -2)) \
				or int(binding_cell.get("row", -1)) != int(single_cell.get("row", -2)):
			_fail("Collision %s does not exactly bind its visible terrain cell." % collision_id)
			return false
		required_roles[role] = true
	if required_roles.values().has(false) \
			or not (runtime.get("unbound_visible_collision_roles", []) as Array).is_empty():
		_fail("All visible slope and wall collision roles must be bound.")
		return false

	var player := runtime.get("player", {}) as Dictionary
	var spawn := player.get("spawn_anchor", {}) as Dictionary
	var exit := runtime.get("exit", {}) as Dictionary
	var navigation := runtime.get("navigation", {}) as Dictionary
	var nodes := navigation.get("nodes", []) as Array
	var edges := navigation.get("edges", []) as Array
	if nodes.size() != 7 or edges.size() != 6 \
			or str(navigation.get("spawn_node_id", "")) != "spawn-node" \
			or str(navigation.get("exit_node_id", "")) != str(exit.get("id", "")):
		_fail("Production navigation must use the canonical seven-node, six-edge route.")
		return false
	var node_index := {}
	for node_value in nodes:
		var node := node_value as Dictionary
		var node_id := str(node.get("id", ""))
		if node_id.is_empty() or node_index.has(node_id):
			_fail("Production navigation node ids must be unique.")
			return false
		node_index[node_id] = node
	for edge_value in edges:
		var edge := edge_value as Dictionary
		if not node_index.has(str(edge.get("from", ""))) or not node_index.has(str(edge.get("to", ""))):
			_fail("Production navigation edge references an unknown node.")
			return false
	var spawn_node := node_index.get(str(navigation.get("spawn_node_id", "")), {}) as Dictionary
	var exit_node := node_index.get(str(navigation.get("exit_node_id", "")), {}) as Dictionary
	if int(spawn_node.get("x", -1)) != int(spawn.get("x", -2)) \
			or int(spawn_node.get("y", -1)) != int(spawn.get("y", -2)) \
			or int(exit_node.get("x", -1)) != int(exit.get("x", -2)) \
			or int(exit_node.get("y", -1)) != int(exit.get("y", -2)):
		_fail("Navigation spawn and exit must exactly bind the runtime anchors.")
		return false
	var reached := {str(navigation.get("spawn_node_id", "")): true}
	var changed := true
	while changed:
		changed = false
		for edge_value in edges:
			var edge := edge_value as Dictionary
			if reached.has(str(edge.get("from", ""))) and not reached.has(str(edge.get("to", ""))):
				reached[str(edge.get("to", ""))] = true
				changed = true
	if not reached.has(str(navigation.get("exit_node_id", ""))):
		_fail("Production navigation exit is not reachable from spawn.")
		return false
	return true


func _verify_collision_bindings(world: Node2D, runtime: Dictionary) -> bool:
	var collision_root := world.get_node_or_null("WorldCollision") as Node2D
	if collision_root == null or collision_root.get_child_count() != 5:
		_fail("Production collision tree is incomplete.")
		return false
	var bound_roles := {}
	for item_value in runtime.get("collision_shapes", []) as Array:
		var item := item_value as Dictionary
		var body := collision_root.get_node_or_null(str(item.get("id", ""))) as StaticBody2D
		if body == null or body.get_meta("mapsoo_binding_id", "") != item.get("id") \
				or body.get_meta("mapsoo_role", "") != item.get("role"):
			_fail("Production collision node lost its runtime binding.")
			return false
		if str(item.get("shape_type", "")) == "rect":
			var shape_node := body.get_node_or_null("CollisionShape2D") as CollisionShape2D
			if shape_node == null or not (shape_node.shape is RectangleShape2D):
				_fail("Bound collision rectangle is not a CollisionShape2D.")
				return false
		else:
			var polygon := body.get_node_or_null("CollisionPolygon2D") as CollisionPolygon2D
			if polygon == null or polygon.polygon.size() != 3:
				_fail("Bound slope is not an equivalent static collision polygon.")
				return false
		var role := str(item.get("role", ""))
		if role in ["terrain.slope-up", "terrain.slope-down", "terrain.wall"]:
			bound_roles[role] = true
	if bound_roles.size() != 3:
		_fail("Production candidate did not instantiate all three visible collision roles.")
		return false
	return true


func _node_name(value: String) -> String:
	var result := ""
	for part in value.split("-", false):
		result += str(part).capitalize()
	return result


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
	var player := CharacterBody2D.new()
	player.name = "Player"
	player.set_script(PlayerController)
	player.set_meta("mapsoo_role", "character.player.atlas")
	player.position = Vector2(spawn.get("x", 0), spawn.get("y", 0))
	player.collision_layer = 1
	player.collision_mask = 1
	player.set("mapsoo_profile", "side-platformer")
	player.set("world_bounds", Rect2(0, 0, WORLD_SIZE.x, WORLD_SIZE.y))
	player.set("spawn_position", player.position)
	player.set("input_enabled", false)
	player.set("exit_radius", float((runtime.get("exit", {}) as Dictionary).get("radius", 20)))

	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	var clip_count := 0
	var frame_count := 0
	for clip_value in character_record.get("clips", []) as Array:
		var clip := clip_value as Dictionary
		var animation := str(clip.get("clip_id", "")).replace(".", "_")
		var clip_frames := clip.get("frames", []) as Array
		if animation.is_empty() or clip_frames.size() < 2 or frames.has_animation(animation):
			_fail("Production character v2 contains an invalid or duplicate multi-frame clip.")
			return null
		frames.add_animation(animation)
		frames.set_animation_loop(animation, bool(clip.get("loop", false)))
		frames.set_animation_speed(animation, float(clip.get("fps", 0)))
		for frame_value in clip_frames:
			var frame := frame_value as Dictionary
			var column := int(frame.get("column", -1))
			var row := int(frame.get("row", -1))
			if column < 0 or column >= 8 or row < 0 or row >= 6:
				_fail("Production character v2 frame is outside the declared 8x6 atlas.")
				return null
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(
				column * CHARACTER_FRAME.x,
				row * CHARACTER_FRAME.y,
				CHARACTER_FRAME.x,
				CHARACTER_FRAME.y,
			)
			atlas.filter_clip = true
			frames.add_frame(animation, atlas)
			frame_count += 1
		clip_count += 1
	if clip_count != 12 or frame_count != 28:
		_fail("Production character v2 must bind exactly 12 clips and 28 frames.")
		return null
	player.set_meta("mapsoo_character_clip_count", clip_count)
	player.set_meta("mapsoo_character_frame_count", frame_count)
	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = frames
	visual.animation = "idle_right"
	visual.position = Vector2(visual_offset.get("x", 0), visual_offset.get("y", 0))
	visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	visual.z_index = 8
	player.add_child(visual)

	var shape_node := CollisionShape2D.new()
	shape_node.name = "CollisionShape2D"
	shape_node.position = Vector2(collision_offset.get("x", 0), collision_offset.get("y", 0))
	var rectangle := RectangleShape2D.new()
	rectangle.size = Vector2(collision_size.get("width", 0), collision_size.get("height", 0))
	shape_node.shape = rectangle
	player.add_child(shape_node)
	world.add_child(player)
	return player


func _recorded_texture(repo_root: String, record: Dictionary, expected_sha256: String) -> Texture2D:
	var relative_path := str(record.get("path", ""))
	var path := repo_root.path_join(relative_path)
	if relative_path.is_empty() or not FileAccess.file_exists(path) or FileAccess.get_sha256(path) != expected_sha256:
		_fail("Recorded texture is missing or has a mismatched digest: %s" % relative_path)
		return null
	var image := Image.new()
	if image.load_png_from_buffer(FileAccess.get_file_as_bytes(path)) != OK:
		_fail("Recorded texture is not a PNG: %s" % relative_path)
		return null
	if image.get_width() != int(record.get("width", 0)) or image.get_height() != int(record.get("height", 0)):
		_fail("Recorded texture has mismatched dimensions: %s" % relative_path)
		return null
	return ImageTexture.create_from_image(image)


func _load_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK or typeof(parser.data) != TYPE_DICTIONARY:
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


func _attach_review_overlay(world: Node2D, mode: String, unit_scale: float) -> void:
	if mode not in ["role-overlay", "collision-overlay", "navigation"]:
		return
	var overlay := ProductionReviewOverlay.new()
	overlay.name = "ProductionReviewOverlay"
	world.add_child(overlay)
	overlay.configure(mode, world, unit_scale)


func _fail(message: String) -> void:
	push_error("MAPSOO_PRODUCTION_CANDIDATE_RENDER_FAILURE: %s" % message)
	quit(1)
