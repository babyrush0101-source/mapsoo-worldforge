extends SceneTree

const NpcInteractionController = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_npc_interaction_controller.gd"
)
const PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]

var _signal_count := 0
var _last_signal_id := ""


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var direct_passes := 0
	for profile in PROFILES:
		var fixture := _fixture(str(profile))
		root.add_child(fixture.world)
		var controller := fixture.controller as Node
		controller.npc_interacted.connect(_on_npc_interacted)
		var result := controller.try_interact() as Dictionary
		if (
			result.get("ok", false) != true
			or str(result.get("npc_id", "")) != "guide-near"
			or str(fixture.player.get_meta("mapsoo_last_interaction", ""))
				!= "guide-near"
			or str(fixture.player.get_meta("mapsoo_last_interaction_kind", ""))
				!= "npc"
			or float(result.get("distance", -1.0)) != 40.0
		):
			_fail("%s direct NPC interaction failed." % profile)
			return
		direct_passes += 1
		root.remove_child(fixture.world)
		fixture.world.free()

	var action_fixture := _fixture("isometric-action")
	root.add_child(action_fixture.world)
	var action_controller := action_fixture.controller as Node
	action_controller.npc_interacted.connect(_on_npc_interacted)
	if not InputMap.has_action("mapsoo_interact"):
		InputMap.add_action("mapsoo_interact")
	var before_press := _signal_count
	Input.action_press("mapsoo_interact")
	for _frame in 3:
		await physics_frame
	if _signal_count != before_press + 1 or _last_signal_id != "guide-near":
		_fail("Held interaction input must fire exactly once.")
		return
	Input.action_release("mapsoo_interact")
	await physics_frame
	Input.action_press("mapsoo_interact")
	await physics_frame
	Input.action_release("mapsoo_interact")
	await physics_frame
	if _signal_count != before_press + 2:
		_fail("A released interaction action must be edge-triggerable again.")
		return

	action_fixture.player.position = Vector2(500, 500)
	var missed := action_controller.try_interact() as Dictionary
	if (
		missed.get("ok", true) != false
		or str(missed.get("reason", "")) != "interaction.no-npc-in-range"
	):
		_fail("Out-of-range NPC interaction must fail closed.")
		return
	action_controller.set("interaction_radius", 0.0)
	var invalid_radius := action_controller.try_interact() as Dictionary
	if (
		invalid_radius.get("ok", true) != false
		or str(invalid_radius.get("reason", "")) != "interaction.radius-invalid"
	):
		_fail("Invalid interaction radius must fail closed.")
		return
	InputMap.erase_action("mapsoo_interact")

	print(
		(
			"MAPSOO_NPC_INTERACTION_OK profiles=%d direct=%d "
			+ "nearest=true stable-tie=true input-edge=2 negative=2"
		)
		% [PROFILES.size(), direct_passes]
	)
	quit(0)


func _fixture(profile: String) -> Dictionary:
	var world := Node2D.new()
	world.name = "MapsooWorld"
	world.set_meta("mapsoo_profile", profile)
	var actors := Node2D.new()
	actors.name = "Actors"
	world.add_child(actors)

	var player := CharacterBody2D.new()
	player.name = "Player"
	player.position = Vector2(100, 100)
	actors.add_child(player)
	var controller := Node.new()
	controller.name = "NpcInteraction"
	controller.set_script(NpcInteractionController)
	player.add_child(controller)

	var ignored := CharacterBody2D.new()
	ignored.name = "IgnoredEnemy"
	ignored.position = Vector2(101, 100)
	ignored.set_meta("mapsoo_character_id", "enemy")
	actors.add_child(ignored)

	_add_npc(actors, "GuideZ", "guide-z", Vector2(140, 100), true)
	_add_npc(actors, "GuideNear", "guide-near", Vector2(140, 100), true)
	_add_npc(actors, "GuideFar", "guide-far", Vector2(165, 100), false)
	return {
		"world": world,
		"player": player,
		"controller": controller,
	}


func _add_npc(
	actors: Node2D,
	node_name: String,
	npc_id: String,
	position: Vector2,
	explicit_kind: bool,
) -> void:
	var npc := CharacterBody2D.new()
	npc.name = node_name
	npc.position = position
	npc.set_meta("mapsoo_character_id", npc_id)
	npc.set_meta("mapsoo_interaction_id", npc_id)
	if explicit_kind:
		npc.set_meta("mapsoo_interaction_kind", "npc")
	else:
		npc.set_meta("mapsoo_role", "character.npc.atlas")
	actors.add_child(npc)


func _on_npc_interacted(npc_id: String) -> void:
	_signal_count += 1
	_last_signal_id = npc_id


func _fail(message: String) -> void:
	push_error(message)
	print("MAPSOO_NPC_INTERACTION_FAILED %s" % message)
	quit(1)
