extends Node

signal interaction_started
signal npc_interacted(npc_id: String)
signal interaction_missed(reason: String)

@export var interaction_action := "mapsoo_interact"
@export var interaction_radius := 72.0
@export var input_enabled := true

var _interaction_held := false


func _physics_process(_delta: float) -> void:
	if not input_enabled \
			or interaction_action.is_empty() \
			or not InputMap.has_action(interaction_action):
		_interaction_held = false
		return
	var pressed := Input.is_action_pressed(interaction_action)
	if pressed and not _interaction_held:
		try_interact()
	_interaction_held = pressed


func try_interact() -> Dictionary:
	interaction_started.emit()
	var player := get_parent() as Node2D
	if player == null:
		return _miss("interaction.player-missing")
	if (
		not is_finite(interaction_radius)
		or interaction_radius <= 0.0
		or interaction_radius > 512.0
	):
		return _miss("interaction.radius-invalid")
	var candidate := _nearest_npc(player)
	if candidate.is_empty():
		return _miss("interaction.no-npc-in-range")
	var npc := candidate.node as Node2D
	var npc_id := _npc_id(npc)
	player.set_meta("mapsoo_last_interaction", npc_id)
	player.set_meta("mapsoo_last_interaction_kind", "npc")
	player.set_meta("mapsoo_last_interaction_distance", candidate.distance)
	npc_interacted.emit(npc_id)
	return {
		"ok": true,
		"status": "npc-interacted",
		"npc_id": npc_id,
		"distance": candidate.distance,
	}


func _nearest_npc(player: Node2D) -> Dictionary:
	var actors := player.get_parent()
	if actors == null:
		return {}
	var candidates: Array[Dictionary] = []
	for child: Node in actors.get_children():
		if child == player or not (child is Node2D) or not _is_npc(child):
			continue
		var npc := child as Node2D
		var distance := player.global_position.distance_to(npc.global_position)
		if distance > interaction_radius:
			continue
		candidates.append({
			"node": npc,
			"distance": distance,
			"id": _npc_id(npc),
			"path": str(npc.get_path()),
		})
	candidates.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		var distance_order := float(left.distance) - float(right.distance)
		if absf(distance_order) > 0.0001:
			return distance_order < 0.0
		var id_order := str(left.id).naturalnocasecmp_to(str(right.id))
		if id_order != 0:
			return id_order < 0
		return str(left.path).naturalnocasecmp_to(str(right.path)) < 0
	)
	return candidates[0] if not candidates.is_empty() else {}


func _is_npc(candidate: Node) -> bool:
	var interaction_kind := str(
		candidate.get_meta("mapsoo_interaction_kind", "")
	)
	var role := str(candidate.get_meta("mapsoo_role", ""))
	var character_id := str(candidate.get_meta("mapsoo_character_id", ""))
	return interaction_kind == "npc" \
		or role == "character.npc.atlas" \
		or role.begins_with("character.npc.") \
		or character_id == "npc"


func _npc_id(candidate: Node) -> String:
	var interaction_id := str(
		candidate.get_meta("mapsoo_interaction_id", "")
	)
	if not interaction_id.is_empty():
		return interaction_id
	var character_id := str(candidate.get_meta("mapsoo_character_id", ""))
	return character_id if not character_id.is_empty() else str(candidate.name)


func _miss(reason: String) -> Dictionary:
	interaction_missed.emit(reason)
	return {
		"ok": false,
		"status": "interaction-missed",
		"reason": reason,
	}
