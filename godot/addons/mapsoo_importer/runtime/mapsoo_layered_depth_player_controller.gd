extends CharacterBody2D

signal interaction_started(direction: String)
signal npc_interacted(npc_id: String)
signal world_exit_reached(exit_id: String)
signal player_respawned(reason: String)

@export var world_bounds := Rect2()
@export var movement_bounds := Rect2()
@export var spawn_position := Vector2.ZERO
@export var move_speed := 175.0
@export var interaction_radius := 72.0
@export var exit_radius := 24.0

var input_enabled := true
var _facing := "near"
var _exit_marker: Marker2D
var _exit_id := ""
var _interaction_held := false


func _ready() -> void:
	if spawn_position == Vector2.ZERO:
		spawn_position = position
	if movement_bounds.size.x <= 0.0 or movement_bounds.size.y <= 0.0:
		movement_bounds = world_bounds
	_connect_hazards()
	_find_exit()
	_configure_camera()


func _physics_process(_delta: float) -> void:
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down") if input_enabled else Vector2.ZERO
	if direction != Vector2.ZERO:
		_facing = _direction_name(direction)
	velocity = direction * move_speed
	_play_animation("%s_%s" % ["walk" if direction != Vector2.ZERO else "idle", _facing])
	move_and_slide()
	_keep_inside_corridor()
	var interaction_pressed := input_enabled and Input.is_action_pressed("ui_accept")
	if interaction_pressed and not _interaction_held:
		_interact()
	_interaction_held = interaction_pressed
	_check_exit()


func _direction_name(direction: Vector2) -> String:
	if absf(direction.x) >= absf(direction.y):
		return "right" if direction.x >= 0.0 else "left"
	return "near" if direction.y >= 0.0 else "far"


func _play_animation(animation_name: String) -> void:
	var visual := get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.sprite_frames == null or not visual.sprite_frames.has_animation(animation_name):
		return
	_apply_declared_direction_transform(visual, animation_name)
	if visual.animation != animation_name or not visual.is_playing():
		visual.play(animation_name)


func _apply_declared_direction_transform(
	visual: AnimatedSprite2D,
	animation_name: String
) -> void:
	var directions_value: Variant = visual.get_meta("mapsoo_horizontal_flip_directions", [])
	var directions: Array = directions_value if directions_value is Array else []
	var direction := ""
	if animation_name.ends_with("_left"):
		direction = "left"
	elif animation_name.ends_with("_right"):
		direction = "right"
	visual.flip_h = not direction.is_empty() and directions.has(direction)


func _interact() -> void:
	_play_animation("interact_%s" % _facing)
	interaction_started.emit(_facing)
	var nearest := _nearest_npc()
	if nearest == null:
		return
	var npc_id := str(nearest.get_meta("mapsoo_character_id", nearest.name))
	set_meta("mapsoo_last_interaction", npc_id)
	npc_interacted.emit(npc_id)


func _nearest_npc() -> CharacterBody2D:
	var actors := get_parent()
	if actors == null:
		return null
	var nearest: CharacterBody2D
	var nearest_distance := interaction_radius
	for child: Node in actors.get_children():
		if child == self or not (child is CharacterBody2D):
			continue
		if str(child.get_meta("mapsoo_character_id", "")) != "npc":
			continue
		var distance := global_position.distance_to((child as CharacterBody2D).global_position)
		if distance <= nearest_distance:
			nearest = child as CharacterBody2D
			nearest_distance = distance
	return nearest


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
	set_meta("mapsoo_last_respawn_reason", reason)
	player_respawned.emit(reason)


func _find_exit() -> void:
	var world := _world_root()
	var traversal := world.get_node_or_null("WorldTraversal") if world != null else null
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


func _keep_inside_corridor() -> void:
	if movement_bounds.size.x <= 0.0 or movement_bounds.size.y <= 0.0:
		return
	position = Vector2(
		clampf(position.x, movement_bounds.position.x, movement_bounds.end.x),
		clampf(position.y, movement_bounds.position.y, movement_bounds.end.y)
	)


func _configure_camera() -> void:
	var camera := get_node_or_null("Camera2D") as Camera2D
	if camera == null:
		return
	camera.limit_left = floori(world_bounds.position.x)
	camera.limit_top = floori(world_bounds.position.y)
	camera.limit_right = ceili(world_bounds.end.x)
	camera.limit_bottom = ceili(world_bounds.end.y)
	camera.position_smoothing_enabled = false
	camera.enabled = true


func _world_root() -> Node:
	var candidate: Node = self
	while candidate != null \
			and candidate.name != "MapsooWorld" \
			and not candidate.has_meta("mapsoo_profile"):
		candidate = candidate.get_parent()
	return candidate
