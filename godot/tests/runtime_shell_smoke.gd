extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const RuntimeShellScene = preload("res://example/main.tscn")
const CharacterFixture = preload("res://tests/character_profile_test_fixture.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_FARM_MANIFEST := "res://tests/.generated/pack-alpha9/mapsoo.manifest.json"
const DEFAULT_SIDE_MANIFEST := "res://tests/.generated/pack-alpha10/mapsoo.manifest.json"
const DEFAULT_ISOMETRIC_MANIFEST := "res://tests/.generated/pack-alpha11/mapsoo.manifest.json"
const DEFAULT_LAYERED_MANIFEST := "res://tests/.generated/pack-alpha12/mapsoo.manifest.json"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var farm_manifest := _argument_value("--farm-manifest=")
	var side_manifest := _argument_value("--side-manifest=")
	var isometric_manifest := _argument_value("--isometric-manifest=")
	var layered_manifest := _argument_value("--layered-manifest=")
	if farm_manifest.is_empty():
		farm_manifest = DEFAULT_FARM_MANIFEST
	if side_manifest.is_empty():
		side_manifest = DEFAULT_SIDE_MANIFEST
	if isometric_manifest.is_empty():
		isometric_manifest = DEFAULT_ISOMETRIC_MANIFEST
	if layered_manifest.is_empty():
		layered_manifest = DEFAULT_LAYERED_MANIFEST
	var farm_result: Dictionary = Importer.import_pack(farm_manifest, OUTPUT_ROOT)
	var side_result: Dictionary = Importer.import_pack(side_manifest, OUTPUT_ROOT)
	var isometric_result: Dictionary = Importer.import_pack(isometric_manifest, OUTPUT_ROOT)
	var layered_result: Dictionary = Importer.import_pack(layered_manifest, OUTPUT_ROOT)
	if farm_result.get("ok", false) != true \
			or side_result.get("ok", false) != true \
			or isometric_result.get("ok", false) != true \
			or layered_result.get("ok", false) != true:
		_fail(
			"Runtime-shell fixtures did not import: farm=%s side=%s isometric=%s layered=%s"
			% [farm_result, side_result, isometric_result, layered_result]
		)
		return

	var shell := RuntimeShellScene.instantiate()
	shell.set("auto_load_on_ready", false)
	root.add_child(shell)
	var initial_fixture := CharacterFixture.create("topdown-farm")
	var no_world: Dictionary = shell.call(
		"bind_player_character",
		initial_fixture.revision_bytes,
		initial_fixture.revision_sha256,
		initial_fixture.atlas_bytes
	)
	if no_world.get("ok", false) == true or no_world.get("code", "") != "shell.character-no-world":
		_fail("Runtime shell accepted a character before loading a world.")
		return
	var no_world_interaction := shell.call("interact_nearest_npc") as Dictionary
	if no_world_interaction.get("ok", false) == true \
			or no_world_interaction.get("code", "") != "shell.interaction-no-world":
		_fail("Runtime shell accepted NPC interaction before loading a world.")
		return
	if shell.call("load_world", "res://mapsoo_imports/../unsafe.world.tscn") != ERR_INVALID_PARAMETER:
		_fail("Runtime shell accepted an unsafe scene path.")
		return
	var farm_scene := str(farm_result.get("scene_path", ""))
	if shell.call("load_world", farm_scene) != OK:
		_fail("Runtime shell did not load the generated farm scene.")
		return
	var first_world := shell.get("active_world") as Node
	if first_world == null or first_world.get_meta("mapsoo_profile", "") != "topdown-farm" or first_world.get_node_or_null("Player") == null:
		_fail("Runtime shell farm world is incomplete.")
		return
	if not _bind_character(shell, "topdown-farm", true):
		return
	if not _interact_npc(shell, "topdown-farm"):
		return
	var unsafe_character: Dictionary = shell.call(
		"bind_player_character_files",
		"res://mapsoo_characters/../character-profile-revision.json",
		"a".repeat(64),
		"res://mapsoo_characters/../character-profile-atlas.png"
	)
	if unsafe_character.get("ok", false) == true \
			or unsafe_character.get("code", "") != "shell.character-path":
		_fail("Runtime shell accepted unsafe character artifact paths.")
		return
	var side_scene := str(side_result.get("scene_path", ""))
	if shell.call("load_world", side_scene) != OK:
		_fail("Runtime shell did not load the generated side scene.")
		return
	var second_world := shell.get("active_world") as Node
	if second_world == null or second_world == first_world or second_world.get_meta("mapsoo_profile", "") != "side-platformer" or second_world.get_node_or_null("Player") == null:
		_fail("Runtime shell did not replace the farm with the side world.")
		return
	if not _bind_character(shell, "side-platformer"):
		return
	if not _interact_npc(shell, "side-platformer"):
		return
	if shell.get_meta("mapsoo_active_scene_path", "") != side_scene or shell.get_meta("mapsoo_active_profile", "") != "side-platformer":
		_fail("Runtime shell did not expose the active frozen-world identity.")
		return
	var isometric_scene := str(isometric_result.get("scene_path", ""))
	if shell.call("load_world", isometric_scene) != OK:
		_fail("Runtime shell did not load the generated isometric scene.")
		return
	var third_world := shell.get("active_world") as Node
	if third_world == null or third_world == second_world or third_world.get_meta("mapsoo_profile", "") != "isometric-action" or third_world.get_node_or_null("YSortedGameplay/Actors/Player") == null:
		_fail("Runtime shell did not replace the side world with the isometric world.")
		return
	if not _bind_character(shell, "isometric-action"):
		return
	if not _interact_npc(shell, "isometric-action"):
		return
	if shell.get_meta("mapsoo_active_scene_path", "") != isometric_scene or shell.get_meta("mapsoo_active_profile", "") != "isometric-action":
		_fail("Runtime shell did not expose the active isometric frozen-world identity.")
		return
	var layered_scene := str(layered_result.get("scene_path", ""))
	if shell.call("load_world", layered_scene) != OK:
		_fail("Runtime shell did not load the generated layered-depth world.")
		return
	var fourth_world := shell.get("active_world") as Node
	if fourth_world == null \
			or fourth_world == third_world \
			or fourth_world.get_meta("mapsoo_profile", "") != "layered-depth-2d" \
			or fourth_world.get_node_or_null("YSortedGameplay/Actors/Player") == null:
		_fail("Runtime shell did not replace the isometric world with the layered-depth world.")
		return
	if not _bind_character(shell, "layered-depth-2d"):
		return
	if not _interact_npc(shell, "layered-depth-2d"):
		return
	if shell.get_meta("mapsoo_active_scene_path", "") != layered_scene \
			or shell.get_meta("mapsoo_active_profile", "") != "layered-depth-2d":
		_fail("Runtime shell did not expose the active layered-depth frozen-world identity.")
		return
	print(
		"MAPSOO_RUNTIME_SHELL_OK"
		+ " safe_path=true farm=true side=true isometric=true layered=true"
		+ " replacement=true character_profiles=4 npc_interactions=4"
	)
	shell.queue_free()
	quit(0)


func _bind_character(shell: Node, profile: String, from_files := false) -> bool:
	var fixture := CharacterFixture.create(profile)
	if fixture.get("ok", false) != true:
		_fail("Unable to create the %s character fixture." % profile)
		return false
	var result: Dictionary
	if from_files:
		result = _bind_character_files(shell, fixture)
	else:
		result = shell.call(
			"bind_player_character",
			fixture.revision_bytes,
			fixture.revision_sha256,
			fixture.atlas_bytes
		)
	if result.get("ok", false) != true \
			or result.get("status", "") != "bound" \
			or result.get("profile", "") != profile \
			or shell.get_meta("mapsoo_active_character_id", "") != "neutral-traveler" \
			or shell.get_meta("mapsoo_active_character_profile_revision_sha256", "") \
				!= fixture.revision_sha256 \
			or shell.get_meta("mapsoo_active_character_atlas_sha256", "") \
				!= fixture.atlas_sha256:
		_fail("%s character did not bind through the runtime shell: %s" % [profile, result])
		return false
	var world := shell.get("active_world") as Node
	var tagged: Array[Node] = world.find_children("*", "AnimatedSprite2D", true, false)
	var player_visuals: Array[AnimatedSprite2D] = []
	for candidate: Node in tagged:
		var visual := candidate as AnimatedSprite2D
		if visual != null and visual.get_meta("mapsoo_runtime_slot_id", "") == "player":
			player_visuals.append(visual)
	if player_visuals.size() != 1 \
			or player_visuals[0].sprite_frames == null \
			or player_visuals[0].sprite_frames.get_animation_names().size() \
				!= fixture.clip_ids.size():
		_fail("%s runtime shell did not expose the bound character animations." % profile)
		return false
	var replay: Dictionary = shell.call(
		"bind_player_character",
		fixture.revision_bytes,
		fixture.revision_sha256,
		fixture.atlas_bytes
	)
	if replay.get("ok", false) != true or replay.get("status", "") != "unchanged":
		_fail("%s runtime-shell character replay is not idempotent." % profile)
		return false
	return true


func _interact_npc(shell: Node, profile: String) -> bool:
	var world := shell.get("active_world") as Node
	if world == null:
		_fail("%s interaction world is missing." % profile)
		return false
	var controllers: Array[Node] = world.find_children(
		"NpcInteraction",
		"Node",
		true,
		false
	)
	if controllers.size() != 1:
		_fail("%s world does not expose one NPC interaction controller." % profile)
		return false
	var player := controllers[0].get_parent() as Node2D
	if player == null:
		_fail("%s world does not expose a neutral player." % profile)
		return false
	var npc: Node2D
	for candidate: Node in player.get_parent().get_children():
		if candidate == player:
			continue
		var interaction_kind := str(
			candidate.get_meta("mapsoo_interaction_kind", "")
		)
		var role := str(candidate.get_meta("mapsoo_role", ""))
		var character_id := str(candidate.get_meta("mapsoo_character_id", ""))
		if interaction_kind == "npc" \
				or role == "character.npc.atlas" \
				or role.begins_with("character.npc.") \
				or character_id == "npc":
			npc = candidate as Node2D
			break
	if npc == null:
		npc = CharacterBody2D.new()
		npc.name = "RuntimeShellNpc"
		npc.set_meta("mapsoo_character_id", "runtime-shell-npc")
		npc.set_meta("mapsoo_interaction_kind", "npc")
		npc.set_meta("mapsoo_interaction_id", "runtime-shell-npc")
		player.get_parent().add_child(npc)
	player.global_position = npc.global_position
	var result := shell.call("interact_nearest_npc") as Dictionary
	if result.get("ok", false) != true \
			or str(result.get("npc_id", "")).is_empty():
		_fail("%s NPC interaction failed through the runtime shell: %s" % [profile, result])
		return false
	return true


func _bind_character_files(shell: Node, fixture: Dictionary) -> Dictionary:
	var artifact_id := "runtime-shell-test-%s" % str(fixture.revision.profile)
	var directory := "res://mapsoo_characters/%s" % artifact_id
	var revision_path := "%s/character-profile-revision.json" % directory
	var atlas_path := "%s/character-profile-atlas.png" % directory
	var absolute_directory := ProjectSettings.globalize_path(directory)
	if DirAccess.dir_exists_absolute(absolute_directory):
		return {
			"ok": false,
			"code": "fixture.directory-exists",
			"error": "Refusing to replace an existing character artifact directory.",
		}
	var directory_error := DirAccess.make_dir_recursive_absolute(absolute_directory)
	if directory_error != OK:
		return {
			"ok": false,
			"code": "fixture.directory",
			"error": "Unable to create the runtime-shell character fixture directory.",
		}
	var revision_file := FileAccess.open(revision_path, FileAccess.WRITE)
	var atlas_file := FileAccess.open(atlas_path, FileAccess.WRITE)
	if revision_file == null or atlas_file == null:
		if revision_file != null:
			revision_file.close()
		if atlas_file != null:
			atlas_file.close()
		_remove_fixture_artifacts(revision_path, atlas_path, directory)
		return {
			"ok": false,
			"code": "fixture.file",
			"error": "Unable to create runtime-shell character fixture files.",
		}
	revision_file.store_buffer(fixture.revision_bytes)
	atlas_file.store_buffer(fixture.atlas_bytes)
	revision_file.close()
	atlas_file.close()
	var result: Dictionary = shell.call(
		"bind_player_character_files",
		revision_path,
		fixture.revision_sha256,
		atlas_path
	)
	_remove_fixture_artifacts(revision_path, atlas_path, directory)
	return result


func _remove_fixture_artifacts(
	revision_path: String,
	atlas_path: String,
	directory: String
) -> void:
	for path: String in [revision_path, atlas_path]:
		var absolute_path := ProjectSettings.globalize_path(path)
		if FileAccess.file_exists(path):
			DirAccess.remove_absolute(absolute_path)
	var absolute_directory := ProjectSettings.globalize_path(directory)
	if DirAccess.dir_exists_absolute(absolute_directory):
		DirAccess.remove_absolute(absolute_directory)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	push_error("MAPSOO_RUNTIME_SHELL_FAILURE: %s" % message)
	quit(1)
