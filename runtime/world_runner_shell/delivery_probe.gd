extends Node

const SAFE_PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]
const CHARACTER_ROOT := "res://mapsoo_characters/"
const CHARACTER_REVISION_FILE := "character-profile-revision.json"
const CHARACTER_ATLAS_FILE := "character-profile-atlas.png"
const LAUNCH_BINDING_FILE := "res://world-runner-launch-binding.json"
const CharacterRuntime = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_character_profile_runtime.gd"
)

var _physical_acceptance_started_ms := 0
var _physical_acceptance_duration_ms := 0
var _physical_acceptance_frame_ms: Array[float] = []
var _physical_acceptance_peak_memory_bytes := 0


func _ready() -> void:
	var world_id := _argument_value("--world-id=")
	var pack_sha256 := _argument_value("--pack-sha256=")
	if not _safe_id(world_id) or not _sha256(pack_sha256):
		_fail("World ID or Pack SHA-256 argument is invalid.")
		return
	var scene_path := "res://mapsoo_imports/%s/%s.world.tscn" % [world_id, world_id]
	var packed := ResourceLoader.load(
		scene_path,
		"PackedScene",
		ResourceLoader.CACHE_MODE_IGNORE_DEEP,
	) as PackedScene
	if packed == null:
		_fail("Packaged world scene is not loadable.")
		return
	var world := packed.instantiate()
	var profile := str(world.get_meta("mapsoo_profile", ""))
	if str(world.get_meta("mapsoo_pack_id", "")) != world_id \
			or not SAFE_PROFILES.has(profile):
		world.free()
		_fail("Packaged world metadata does not match the delivery.")
		return
	add_child(world)
	var character_revision_id := _argument_value("--character-revision-id=")
	var character_revision_sha256 := _argument_value("--character-revision-sha256=")
	var character_marker := "character_binding=not-requested"
	if not character_revision_id.is_empty() or not character_revision_sha256.is_empty():
		if not _safe_id(character_revision_id) or not _sha256(character_revision_sha256):
			remove_child(world)
			world.free()
			_fail("Character revision ID or SHA-256 argument is invalid.")
			return
		var character_root := "%s%s/" % [CHARACTER_ROOT, character_revision_id]
		var revision_path := "%s%s" % [character_root, CHARACTER_REVISION_FILE]
		var atlas_path := "%s%s" % [character_root, CHARACTER_ATLAS_FILE]
		var revision_bytes := _read_file(revision_path, 1024 * 1024)
		var atlas_bytes := _read_file(atlas_path, 512 * 1024 * 1024)
		if revision_bytes.is_empty() or atlas_bytes.is_empty():
			remove_child(world)
			world.free()
			_fail("Embedded character artifacts are missing or outside their byte limits.")
			return
		var binding: Dictionary = CharacterRuntime.bind_player(
			world,
			revision_bytes,
			character_revision_sha256,
			atlas_bytes,
		)
		if binding.get("ok", false) != true \
				or str(binding.get("profile_revision_id", "")) != character_revision_id \
				or str(binding.get("profile", "")) != profile:
			remove_child(world)
			world.free()
			_fail(
				"Embedded character binding failed: %s"
				% str(binding.get("code", "binding.failed"))
			)
			return
		character_marker = (
			"character_binding=bound"
			+ " character_revision_id=%s" % character_revision_id
			+ " character_revision_sha256=%s" % character_revision_sha256
		)
	var launch_binding := _load_launch_binding()
	if launch_binding.is_empty():
		remove_child(world)
		world.free()
		_fail("Embedded launch binding is missing or invalid.")
		return
	var requested_spawn_id := _argument_value("--spawn-id=")
	var requested_player_slot_id := _argument_value("--player-slot-id=")
	var requested_spawn_count := _argument_count("--spawn-id=")
	var requested_player_slot_count := _argument_count("--player-slot-id=")
	if requested_spawn_count != requested_player_slot_count \
			or requested_spawn_count > 1:
		remove_child(world)
		world.free()
		_fail("Spawn ID and player slot ID arguments must be supplied together exactly once.")
		return
	var has_requested_spawn_id := requested_spawn_count == 1
	var spawn_id := str(launch_binding.get("spawn_id", ""))
	var player_slot_id := str(launch_binding.get("player_slot_id", ""))
	if has_requested_spawn_id:
		if not _safe_id(requested_spawn_id) \
				or not _safe_id(requested_player_slot_id):
			remove_child(world)
			world.free()
			_fail("Spawn ID or player slot ID argument is invalid.")
			return
		if requested_spawn_id != spawn_id \
				or requested_player_slot_id != player_slot_id:
			remove_child(world)
			world.free()
			_fail("Requested launch binding does not match the embedded binding.")
			return
	if not _bind_launch_nodes(world, spawn_id, player_slot_id):
		remove_child(world)
		world.free()
		_fail("World scene does not expose one portable player launch binding.")
		return
	await get_tree().process_frame
	var marker := (
		"MAPSOO_WORLD_RUNNER_PCK_OK"
		+ " world_id=%s" % world_id
		+ " pack_sha256=%s" % pack_sha256
		+ " profile=%s" % profile
		+ " scene=%s" % scene_path
		+ " launch_binding=bound"
		+ " spawn_id=%s" % spawn_id
		+ " player_slot_id=%s" % player_slot_id
		+ " %s" % character_marker
		+ " physical_raspberry_pi=not-tested"
	)
	print(marker)
	if _argument_value("--delivery-smoke=") == "true":
		remove_child(world)
		world.free()
		get_tree().quit(0)
		return
	print(marker.replace("MAPSOO_WORLD_RUNNER_PCK_OK", "MAPSOO_WORLD_RUNNER_READY"))
	var physical_seconds := _argument_value("--physical-acceptance-seconds=")
	if not physical_seconds.is_empty():
		if not physical_seconds.is_valid_int():
			_fail("Physical acceptance duration is invalid.")
			return
		var seconds := int(physical_seconds)
		if seconds < 30 or seconds > 900:
			_fail("Physical acceptance duration must be from 30 through 900 seconds.")
			return
		_physical_acceptance_duration_ms = seconds * 1000
		_physical_acceptance_started_ms = Time.get_ticks_msec()
		_physical_acceptance_peak_memory_bytes = OS.get_static_memory_usage()


func _process(delta: float) -> void:
	if _physical_acceptance_duration_ms == 0:
		return
	var frame_ms := delta * 1000.0
	if is_finite(frame_ms) and frame_ms > 0.0:
		_physical_acceptance_frame_ms.append(frame_ms)
	_physical_acceptance_peak_memory_bytes = maxi(
		_physical_acceptance_peak_memory_bytes,
		OS.get_static_memory_usage(),
	)
	var elapsed_ms := Time.get_ticks_msec() - _physical_acceptance_started_ms
	if elapsed_ms < _physical_acceptance_duration_ms:
		return
	if _physical_acceptance_frame_ms.is_empty():
		_fail("Physical acceptance did not observe any frames.")
		return
	var sorted_frame_ms := _physical_acceptance_frame_ms.duplicate()
	sorted_frame_ms.sort()
	var total_frame_ms := 0.0
	for sample: float in _physical_acceptance_frame_ms:
		total_frame_ms += sample
	var average_frame_ms := total_frame_ms / float(_physical_acceptance_frame_ms.size())
	var average_fps := 1000.0 / average_frame_ms
	var p95_index := mini(
		sorted_frame_ms.size() - 1,
		int(ceil(float(sorted_frame_ms.size()) * 0.95)) - 1,
	)
	print(
		"MAPSOO_PI4_PHYSICAL_METRICS"
		+ " observation_ms=%d" % elapsed_ms
		+ " frames=%d" % _physical_acceptance_frame_ms.size()
		+ " average_fps=%.3f" % average_fps
		+ " p95_frame_ms=%.3f" % sorted_frame_ms[p95_index]
		+ " peak_static_memory_bytes=%d" % _physical_acceptance_peak_memory_bytes
	)
	_physical_acceptance_duration_ms = 0
	get_tree().quit(0)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _argument_count(prefix: String) -> int:
	var count := 0
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			count += 1
	return count


func _safe_id(value: String) -> bool:
	if value.is_empty() or value.length() > 80 \
			or value.begins_with("-") or value.ends_with("-") \
			or value.contains("--"):
		return false
	for character: String in value:
		if not "abcdefghijklmnopqrstuvwxyz0123456789-".contains(character):
			return false
	return true


func _load_launch_binding() -> Dictionary:
	var bytes := _read_file(LAUNCH_BINDING_FILE, 16 * 1024)
	if bytes.is_empty():
		return {}
	var parsed: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	if not parsed is Dictionary:
		return {}
	var binding := parsed as Dictionary
	if binding.size() != 5 \
			or binding.get("schema_version", null) != "1.0.0" \
			or binding.get("document_type", null) != "world-runner-launch-binding" \
			or binding.get("status", null) != "bound" \
			or typeof(binding.get("spawn_id", null)) != TYPE_STRING \
			or typeof(binding.get("player_slot_id", null)) != TYPE_STRING:
		return {}
	for key: Variant in binding.keys():
		if not [
			"schema_version",
			"document_type",
			"status",
			"spawn_id",
			"player_slot_id",
		].has(key):
			return {}
	var spawn_id := str(binding.get("spawn_id", ""))
	var player_slot_id := str(binding.get("player_slot_id", ""))
	if not _safe_id(spawn_id) or not _safe_id(player_slot_id):
		return {}
	return binding


func _bind_launch_nodes(world: Node, spawn_id: String, player_slot_id: String) -> bool:
	var spawn_matches: Array[Node] = []
	var player_matches: Array[Node] = []
	_collect_launch_nodes(world, spawn_matches, player_matches)
	if spawn_matches.size() != 1 or player_matches.size() != 1:
		return false
	var spawn := spawn_matches[0] as Marker2D
	var player := player_matches[0] as Node2D
	if spawn == null or player == null:
		return false
	spawn.set_meta("mapsoo_portable_spawn_id", spawn_id)
	player.set_meta("mapsoo_portable_slot_id", player_slot_id)
	player.global_position = spawn.global_position
	return true


func _collect_launch_nodes(
	node: Node,
	spawn_matches: Array[Node],
	player_matches: Array[Node],
) -> void:
	if node is Marker2D and node.name == &"PlayerSpawn":
		spawn_matches.append(node)
	if node is Node2D and node.name == &"Player" \
			and _count_legacy_player_slots(node) == 1:
		player_matches.append(node)
	for child: Node in node.get_children():
		_collect_launch_nodes(child, spawn_matches, player_matches)


func _count_legacy_player_slots(node: Node) -> int:
	var count := 0
	for child: Node in node.get_children():
		if str(child.get_meta("mapsoo_runtime_slot_id", "")) == "player":
			count += 1
		count += _count_legacy_player_slots(child)
	return count


func _sha256(value: String) -> bool:
	if value.length() != 64:
		return false
	for character: String in value:
		if not "abcdef0123456789".contains(character):
			return false
	return true


func _read_file(path: String, maximum_bytes: int) -> PackedByteArray:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return PackedByteArray()
	var length := file.get_length()
	if length < 1 or length > maximum_bytes:
		return PackedByteArray()
	var bytes := file.get_buffer(length)
	if bytes.size() != length:
		return PackedByteArray()
	return bytes


func _fail(message: String) -> void:
	push_error("MAPSOO_WORLD_RUNNER_PCK_FAILURE: %s" % message)
	get_tree().quit(1)
