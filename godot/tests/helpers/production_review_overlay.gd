extends Node2D

const MODES := [
	"role-overlay",
	"collision-overlay",
	"navigation",
]
const PALETTE := [
	Color("#43d9ff"),
	Color("#ffcf4a"),
	Color("#ff6b8b"),
	Color("#7dff8a"),
	Color("#bf8cff"),
	Color("#ff9f43"),
]

var _mode := ""
var _world: Node2D
var _unit_scale := 1.0


func configure(mode: String, world: Node2D, unit_scale: float = 1.0) -> void:
	if mode not in MODES:
		push_error("Unsupported production review overlay mode: %s" % mode)
		return
	_mode = mode
	_world = world
	_unit_scale = maxf(unit_scale, 1.0)
	z_index = 1000
	z_as_relative = false
	set_process(mode == "navigation")
	queue_redraw()


func _process(_delta: float) -> void:
	queue_redraw()


func _draw() -> void:
	if _world == null or _mode.is_empty():
		return
	match _mode:
		"role-overlay":
			_draw_role_overlay()
		"collision-overlay":
			_draw_collision_overlay()
		"navigation":
			_draw_navigation_overlay()


func _draw_role_overlay() -> void:
	var role_bounds := {}
	var role_counts := {}
	_collect_role_bounds(_world, role_bounds, role_counts)
	var roles := role_bounds.keys()
	roles.sort()
	for index in roles.size():
		var role := str(roles[index])
		var rect := role_bounds[role] as Rect2
		var color: Color = PALETTE[index % PALETTE.size()]
		draw_rect(rect, Color(color, 0.08), true)
		draw_rect(rect, color, false, 2.0 * _unit_scale)
		_draw_label(
			rect.position + Vector2(2, -3) * _unit_scale,
			"%s  x%d" % [role, int(role_counts.get(role, 0))],
			color,
		)
	_draw_header("SEMANTIC ROLE PLACEMENT", Color("#43d9ff"))


func _collect_role_bounds(node: Node, bounds: Dictionary, counts: Dictionary) -> void:
	if node != self and node.has_meta("mapsoo_role"):
		var role := str(node.get_meta("mapsoo_role", ""))
		var visual_rect := _visual_rect(node)
		if not role.is_empty() and visual_rect.size.x > 0.0 and visual_rect.size.y > 0.0:
			bounds[role] = (
				(bounds[role] as Rect2).merge(visual_rect)
				if bounds.has(role)
				else visual_rect
			)
			counts[role] = int(counts.get(role, 0)) + 1
	for child in node.get_children():
		_collect_role_bounds(child, bounds, counts)


func _visual_rect(node: Node) -> Rect2:
	if node is Sprite2D:
		return _sprite_rect(node as Sprite2D)
	if node is AnimatedSprite2D:
		return _animated_sprite_rect(node as AnimatedSprite2D)
	for child in node.get_children():
		var child_rect := _visual_rect(child)
		if child_rect.size.x > 0.0 and child_rect.size.y > 0.0:
			return child_rect
	return Rect2()


func _sprite_rect(sprite: Sprite2D) -> Rect2:
	if sprite.texture == null:
		return Rect2()
	var scale := sprite.global_transform.get_scale().abs()
	var size := sprite.texture.get_size() * scale
	var origin := to_local(sprite.global_position)
	if sprite.centered:
		origin -= size * 0.5
	return Rect2(origin, size)


func _animated_sprite_rect(sprite: AnimatedSprite2D) -> Rect2:
	if sprite.sprite_frames == null:
		return Rect2()
	var texture := sprite.sprite_frames.get_frame_texture(sprite.animation, sprite.frame)
	if texture == null:
		return Rect2()
	var scale := sprite.global_transform.get_scale().abs()
	var size := texture.get_size() * scale
	var origin := to_local(sprite.global_position) - size * 0.5
	return Rect2(origin, size)


func _draw_collision_overlay() -> void:
	_draw_collision_nodes(_world)
	_draw_header("ART / COLLISION ALIGNMENT", Color("#ff6b8b"))


func _draw_collision_nodes(node: Node) -> void:
	if node is CollisionShape2D:
		_draw_collision_shape(node as CollisionShape2D)
	elif node is CollisionPolygon2D:
		_draw_collision_polygon(node as CollisionPolygon2D)
	for child in node.get_children():
		_draw_collision_nodes(child)


func _draw_collision_shape(shape_node: CollisionShape2D) -> void:
	if shape_node.disabled or shape_node.shape == null:
		return
	var owner := shape_node.get_parent()
	var role := _nearest_role(owner)
	var color := _collision_color(owner)
	var center := to_local(shape_node.global_position)
	var scale := shape_node.global_transform.get_scale().abs()
	if shape_node.shape is RectangleShape2D:
		var rectangle := shape_node.shape as RectangleShape2D
		var size := rectangle.size * scale
		var rect := Rect2(center - size * 0.5, size)
		draw_rect(rect, Color(color, 0.24), true)
		draw_rect(rect, color, false, 3.0 * _unit_scale)
		_draw_label(rect.position + Vector2(2, -3) * _unit_scale, role, color)
	elif shape_node.shape is CircleShape2D:
		var circle := shape_node.shape as CircleShape2D
		var radius := circle.radius * maxf(scale.x, scale.y)
		draw_circle(center, radius, Color(color, 0.24))
		draw_arc(center, radius, 0.0, TAU, 48, color, 3.0 * _unit_scale)
		_draw_label(center + Vector2(radius, -radius), role, color)
	elif shape_node.shape is CapsuleShape2D:
		var capsule := shape_node.shape as CapsuleShape2D
		var size := Vector2(capsule.radius * 2.0, capsule.height) * scale
		var rect := Rect2(center - size * 0.5, size)
		draw_rect(rect, Color(color, 0.18), true)
		draw_rect(rect, color, false, 3.0 * _unit_scale)
		_draw_label(rect.position + Vector2(2, -3) * _unit_scale, role, color)


func _draw_collision_polygon(polygon: CollisionPolygon2D) -> void:
	if polygon.disabled or polygon.polygon.size() < 3:
		return
	var points := PackedVector2Array()
	for point in polygon.polygon:
		points.append(to_local(polygon.to_global(point)))
	var owner := polygon.get_parent()
	var color := _collision_color(owner)
	draw_colored_polygon(points, Color(color, 0.24))
	points.append(points[0])
	draw_polyline(points, color, 3.0 * _unit_scale)
	_draw_label(points[0] + Vector2(2, -3) * _unit_scale, _nearest_role(owner), color)


func _collision_color(node: Node) -> Color:
	var current := node
	while current != null and current != _world:
		if current is Area2D:
			return Color("#ffcf4a") if current.name.contains("Collect") else Color("#ff5252")
		if current is CharacterBody2D:
			return Color("#7dff8a")
		current = current.get_parent()
	return Color("#43d9ff")


func _nearest_role(node: Node) -> String:
	var current := node
	while current != null and current != _world:
		if current.has_meta("mapsoo_role"):
			return str(current.get_meta("mapsoo_role", "collision"))
		current = current.get_parent()
	return "collision"


func _draw_navigation_overlay() -> void:
	var traversal := _world.get_node_or_null("WorldTraversal") as Node2D
	if traversal == null:
		_draw_header("AUTHORED NAVIGATION ROUTE", Color("#7dff8a"))
		return
	var positions := {}
	var kinds := {}
	for child in traversal.get_children():
		if child is Marker2D:
			var marker := child as Marker2D
			var node_id := str(marker.get_meta("mapsoo_id", marker.name))
			positions[node_id] = to_local(marker.global_position)
			kinds[node_id] = str(marker.get_meta("mapsoo_kind", "route"))
	for value in traversal.get_meta("mapsoo_edges", []) as Array:
		var edge := value as Dictionary
		var from_id := str(edge.get("from", ""))
		var to_id := str(edge.get("to", ""))
		if positions.has(from_id) and positions.has(to_id):
			var from_position := positions[from_id] as Vector2
			var to_position := positions[to_id] as Vector2
			draw_line(from_position, to_position, Color("#7dff8a"), 4.0 * _unit_scale)
			_draw_arrow_head(from_position, to_position, Color("#7dff8a"))
	var ids := positions.keys()
	ids.sort()
	for index in ids.size():
		var node_id := str(ids[index])
		var position := positions[node_id] as Vector2
		var kind := str(kinds.get(node_id, "route"))
		var color := (
			Color("#43d9ff")
			if kind == "spawn"
			else Color("#ffcf4a") if kind == "exit" else Color("#7dff8a")
		)
		draw_circle(position, 8.0 * _unit_scale, Color("#101923"))
		draw_arc(position, 8.0 * _unit_scale, 0.0, TAU, 32, color, 3.0 * _unit_scale)
		_draw_label(position + Vector2(10, -8) * _unit_scale, "%s / %s" % [node_id, kind], color)
	var player := _world.find_child("Player", true, false) as CharacterBody2D
	if player != null:
		var player_position := to_local(player.global_position)
		draw_circle(player_position, 11.0 * _unit_scale, Color(1.0, 1.0, 1.0, 0.2))
		draw_arc(
			player_position,
			11.0 * _unit_scale,
			0.0,
			TAU,
			32,
			Color.WHITE,
			3.0 * _unit_scale,
		)
	_draw_header("AUTHORED NAVIGATION ROUTE", Color("#7dff8a"))


func _draw_arrow_head(from_position: Vector2, to_position: Vector2, color: Color) -> void:
	var direction := from_position.direction_to(to_position)
	if direction == Vector2.ZERO:
		return
	var tip := to_position - direction * 10.0 * _unit_scale
	var normal := Vector2(-direction.y, direction.x)
	var wing := 6.0 * _unit_scale
	draw_colored_polygon(
		PackedVector2Array([
			to_position,
			tip + normal * wing,
			tip - normal * wing,
		]),
		color,
	)


func _draw_header(text: String, color: Color) -> void:
	var font_size := int(15.0 * _unit_scale)
	var width := float(text.length() * font_size) * 0.62
	var bounds := _visible_world_rect()
	var panel_position := bounds.position + Vector2(6, 6) * _unit_scale
	var position := panel_position + Vector2(
		6.0 * _unit_scale,
		font_size + 2.0 * _unit_scale,
	)
	draw_rect(
		Rect2(
			panel_position,
			Vector2(width + 12.0 * _unit_scale, font_size + 8.0 * _unit_scale),
		),
		Color(0.02, 0.04, 0.07, 0.86),
		true,
	)
	draw_string(
		ThemeDB.fallback_font,
		position,
		text,
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		font_size,
		color,
	)


func _draw_label(position: Vector2, text: String, color: Color) -> void:
	var font_size := int(10.0 * _unit_scale)
	var width := float(text.length() * font_size) * 0.58
	var bounds := _visible_world_rect()
	var panel_size := Vector2(width + 6.0 * _unit_scale, font_size + 6.0 * _unit_scale)
	var safe_position := Vector2(
		clampf(
			position.x,
			bounds.position.x + 2.0 * _unit_scale,
			bounds.end.x - panel_size.x - 2.0 * _unit_scale,
		),
		clampf(
			position.y,
			bounds.position.y + 2.0 * _unit_scale,
			bounds.end.y - panel_size.y - 2.0 * _unit_scale,
		),
	)
	var baseline := safe_position + Vector2(3.0 * _unit_scale, font_size + 1.0 * _unit_scale)
	draw_rect(
		Rect2(safe_position, panel_size),
		Color(0.02, 0.04, 0.07, 0.82),
		true,
	)
	draw_string(
		ThemeDB.fallback_font,
		baseline,
		text,
		HORIZONTAL_ALIGNMENT_LEFT,
		-1,
		font_size,
		color,
	)


func _visible_world_rect() -> Rect2:
	var viewport_size := get_viewport_rect().size
	var camera := get_viewport().get_camera_2d()
	if camera == null:
		return Rect2(Vector2.ZERO, viewport_size)
	var zoom := camera.zoom.abs()
	var visible_size := Vector2(
		viewport_size.x / maxf(zoom.x, 0.001),
		viewport_size.y / maxf(zoom.y, 0.001),
	)
	return Rect2(to_local(camera.global_position) - visible_size * 0.5, visible_size)
