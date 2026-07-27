extends CharacterBody2D

signal attack_started(direction: String)
signal dash_started(direction: String)
signal world_exit_reached(exit_id: String)
signal player_respawned(reason: String)

@export var world_bounds := Rect2()
@export var spawn_position := Vector2.ZERO
@export var move_speed := 190.0
@export var dash_speed := 430.0
@export var dash_duration := 0.16
@export var exit_radius := 22.0

var input_enabled := true
var _facing := "south"
var _dash_remaining := 0.0
var _dash_direction := Vector2.ZERO
var _exit_marker: Marker2D
var _exit_id := ""


func _ready() -> void:
	if spawn_position == Vector2.ZERO:
		spawn_position = position
	_connect_hazards()
	_find_exit()
	_configure_camera()


func _physics_process(delta: float) -> void:
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down") if input_enabled else Vector2.ZERO
	if direction != Vector2.ZERO:
		_facing = _direction_name(direction)
	if input_enabled and Input.is_action_just_pressed("ui_accept") and _dash_remaining <= 0.0:
		_dash_remaining = dash_duration
		_dash_direction = direction.normalized() if direction != Vector2.ZERO else _direction_vector(_facing)
		dash_started.emit(_facing)
	if input_enabled and Input.is_action_just_pressed("ui_cancel"):
		_play_animation("attack-primary_%s" % _facing)
		attack_started.emit(_facing)
	if _dash_remaining > 0.0:
		_dash_remaining = maxf(0.0, _dash_remaining - delta)
		velocity = _dash_direction * dash_speed
		_play_animation("dash_%s" % _facing)
	else:
		velocity = direction * move_speed
		_play_animation(("%s_%s" % ["move" if direction != Vector2.ZERO else "idle", _facing]))
	move_and_slide()
	_keep_inside_world()
	_check_exit()


func _direction_name(direction: Vector2) -> String:
	var angle := wrapf(direction.angle(), -PI, PI)
	var index := posmod(roundi(angle / (PI / 4.0)), 8)
	return ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][index]


func _direction_vector(direction: String) -> Vector2:
	var vectors := {
		"north": Vector2.UP, "north-east": Vector2(1, -1).normalized(),
		"east": Vector2.RIGHT, "south-east": Vector2(1, 1).normalized(),
		"south": Vector2.DOWN, "south-west": Vector2(-1, 1).normalized(),
		"west": Vector2.LEFT, "north-west": Vector2(-1, -1).normalized(),
	}
	return vectors.get(direction, Vector2.DOWN)


func _play_animation(animation_name: String) -> void:
	var visual := get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.sprite_frames == null or not visual.sprite_frames.has_animation(animation_name):
		return
	if visual.animation != animation_name or not visual.is_playing():
		visual.play(animation_name)


func _connect_hazards() -> void:
	var world := _world_root()
	var hazards := world.get_node_or_null("Hazards") if world != null else null
	if hazards == null:
		return
	for child: Node in hazards.get_children():
		if child is Area2D:
			var area := child as Area2D
			var callback := _on_hazard_body_entered.bind(area)
			if not area.body_entered.is_connected(callback):
				area.body_entered.connect(callback)


func _on_hazard_body_entered(body: Node2D, area: Area2D) -> void:
	if body == self:
		call_deferred("respawn", str(area.get_meta("mapsoo_kind", "hazard")))


func respawn(reason := "manual") -> void:
	position = spawn_position
	velocity = Vector2.ZERO
	_dash_remaining = 0.0
	set_meta("mapsoo_last_respawn_reason", reason)
	player_respawned.emit(reason)


func _find_exit() -> void:
	var resolved := _resolve_exit()
	_exit_marker = resolved.get("marker") as Marker2D
	_exit_id = str(resolved.get("id", ""))


func _resolve_exit() -> Dictionary:
	var world := _world_root()
	var layout_exit := (
		world.get_node_or_null("WorldLayoutPlan/Exit") as Marker2D
		if world != null
		else null
	)
	if layout_exit != null:
		var layout_exit_id := str(layout_exit.get_meta("mapsoo_node_id", ""))
		if not layout_exit_id.is_empty():
			return {"marker": layout_exit, "id": layout_exit_id}
	var traversal := world.get_node_or_null("WorldTraversal") if world != null else null
	if traversal == null:
		return {}
	var expected_id := str(traversal.get_meta("mapsoo_exit_node_id", ""))
	for child: Node in traversal.get_children():
		if child is Marker2D and str(child.get_meta("mapsoo_id", "")) == expected_id:
			return {"marker": child as Marker2D, "id": expected_id}
	return {}


func _check_exit() -> void:
	if has_meta("mapsoo_exit_reached"):
		return
	var resolved := _resolve_exit()
	var marker := resolved.get("marker") as Marker2D
	var exit_id := str(resolved.get("id", ""))
	if (
		marker != null
		and not exit_id.is_empty()
		and global_position.distance_to(marker.global_position) <= exit_radius
	):
		_exit_marker = marker
		_exit_id = exit_id
		set_meta("mapsoo_exit_reached", exit_id)
		world_exit_reached.emit(exit_id)


func _keep_inside_world() -> void:
	if world_bounds.size.x <= 0.0 or world_bounds.size.y <= 0.0:
		return
	position = Vector2(
		clampf(position.x, world_bounds.position.x, world_bounds.end.x),
		clampf(position.y, world_bounds.position.y, world_bounds.end.y)
	)


func _configure_camera() -> void:
	var camera := get_node_or_null("Camera2D") as Camera2D
	if camera == null:
		return
	camera.limit_left = floori(world_bounds.position.x)
	camera.limit_top = floori(world_bounds.position.y)
	camera.limit_right = ceili(world_bounds.end.x)
	camera.limit_bottom = ceili(world_bounds.end.y)
	camera.enabled = true


func _world_root() -> Node:
	var candidate: Node = self
	while candidate != null and candidate.name != "MapsooWorld":
		candidate = candidate.get_parent()
	return candidate
