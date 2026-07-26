extends CharacterBody2D

signal world_exit_reached(exit_id: String)
signal player_respawned(reason: String)

@export_enum("side-platformer", "topdown-farm")
var mapsoo_profile := "side-platformer"
@export var world_bounds := Rect2()
@export var spawn_position := Vector2.ZERO
@export var move_speed := 180.0
@export var jump_velocity := -360.0
@export var gravity := 980.0
@export var exit_radius := 20.0

var input_enabled := true
var _facing := "right"
var _exit_marker: Marker2D
var _exit_id := ""


func _ready() -> void:
	if spawn_position == Vector2.ZERO:
		spawn_position = position
	_connect_hazards()
	_find_exit()
	_configure_camera()


func _physics_process(delta: float) -> void:
	if mapsoo_profile == "topdown-farm":
		_move_topdown()
	else:
		_move_side(delta)
	_keep_inside_world()
	_check_exit()


func _move_side(delta: float) -> void:
	var axis := Input.get_axis("ui_left", "ui_right") if input_enabled else 0.0
	velocity.x = axis * move_speed
	if axis < 0.0:
		_facing = "left"
	elif axis > 0.0:
		_facing = "right"
	if not is_on_floor():
		velocity.y = minf(velocity.y + gravity * delta, gravity)
	elif input_enabled and Input.is_action_just_pressed("ui_accept"):
		velocity.y = jump_velocity
	move_and_slide()
	var action := "idle"
	if not is_on_floor():
		action = "jump" if velocity.y < 0.0 else "fall"
	elif absf(velocity.x) > 0.1:
		action = "run"
	_play_animation("%s_%s" % [action, _facing])


func _move_topdown() -> void:
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down") if input_enabled else Vector2.ZERO
	velocity = direction * move_speed
	move_and_slide()
	if direction != Vector2.ZERO:
		if absf(direction.x) > absf(direction.y):
			_facing = "east" if direction.x > 0.0 else "west"
		else:
			_facing = "south" if direction.y > 0.0 else "north"
		_play_animation("walk_%s" % _facing)
	else:
		if _facing not in ["north", "east", "south", "west"]:
			_facing = "south"
		_play_animation("idle_%s" % _facing)


func _play_animation(animation_name: String) -> void:
	var visual := get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.sprite_frames == null or not visual.sprite_frames.has_animation(animation_name):
		return
	if visual.animation != animation_name or not visual.is_playing():
		visual.play(animation_name)


func _connect_hazards() -> void:
	var hazards := get_node_or_null("../Hazards")
	if hazards == null:
		return
	for child: Node in hazards.get_children():
		if child is Area2D:
			var area := child as Area2D
			var callback := _on_hazard_body_entered.bind(area)
			if not area.body_entered.is_connected(callback):
				area.body_entered.connect(callback)


func _on_hazard_body_entered(body: Node2D, area: Area2D) -> void:
	if body != self:
		return
	call_deferred("respawn", str(area.get_meta("mapsoo_kind", "hazard")))


func respawn(reason := "manual") -> void:
	position = spawn_position
	velocity = Vector2.ZERO
	set_meta("mapsoo_last_respawn_reason", reason)
	player_respawned.emit(reason)


func _find_exit() -> void:
	var traversal := get_node_or_null("../WorldTraversal")
	if traversal == null:
		return
	var expected_id := str(traversal.get_meta("mapsoo_exit_node_id", ""))
	for child: Node in traversal.get_children():
		if child is Marker2D and str(child.get_meta("mapsoo_id", "")) == expected_id:
			_exit_marker = child as Marker2D
			_exit_id = expected_id
			return


func _check_exit() -> void:
	if _exit_marker == null or has_meta("mapsoo_exit_reached"):
		return
	if global_position.distance_to(_exit_marker.global_position) <= exit_radius:
		set_meta("mapsoo_exit_reached", _exit_id)
		world_exit_reached.emit(_exit_id)


func _keep_inside_world() -> void:
	if world_bounds.size.x <= 0.0 or world_bounds.size.y <= 0.0:
		return
	var clamped := Vector2(
		clampf(position.x, world_bounds.position.x, world_bounds.end.x),
		clampf(position.y, world_bounds.position.y, world_bounds.end.y)
	)
	if clamped != position:
		position = clamped
		velocity = Vector2.ZERO


func _configure_camera() -> void:
	var camera := get_node_or_null("Camera2D") as Camera2D
	if camera == null or world_bounds.size.x <= 0.0 or world_bounds.size.y <= 0.0:
		return
	camera.limit_left = floori(world_bounds.position.x)
	camera.limit_top = floori(world_bounds.position.y)
	camera.limit_right = ceili(world_bounds.end.x)
	camera.limit_bottom = ceili(world_bounds.end.y)
	camera.enabled = true
