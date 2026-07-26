extends SceneTree

## Loads one exact importer-managed scene from an assembled runtime project.
##
## This script is bundled with the reusable shell so a staged archive can be
## checked without access to the source Pack, build workspace or private host.


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var scene_path := _argument_value("--scene=")
	if not _safe_scene_path(scene_path):
		_fail("Pass a canonical --scene=res://mapsoo_imports/<id>/<id>.world.tscn.")
		return
	var packed := ResourceLoader.load(
		scene_path,
		"PackedScene",
		ResourceLoader.CACHE_MODE_IGNORE_DEEP,
	) as PackedScene
	if packed == null:
		_fail("Bundled importer-managed scene is not loadable.")
		return
	var world := packed.instantiate()
	var player := world.get_node_or_null("YSortedGameplay/Actors/Player") as CharacterBody2D
	var npc := world.get_node_or_null("YSortedGameplay/Actors/Npc") as CharacterBody2D
	var props := world.get_node_or_null("YSortedGameplay/Props") as Node2D
	if world.get_meta("mapsoo_schema_version", "") != "1.0.0-draft.1" \
			or world.get_meta("mapsoo_profile", "") != "layered-depth-2d" \
			or world.get_meta("mapsoo_distribution", "") != "internal-review" \
			or world.get_meta("mapsoo_output_license", "") != "LicenseRef-UNRELEASED" \
			or world.get_meta("mapsoo_data_only", false) != true \
			or world.get_node_or_null("WorldCollision") == null \
			or world.get_node_or_null("WorldNavigation") == null \
			or props == null or props.get_child_count() != 3 \
			or not _character_ok(player, 16) \
			or not _character_ok(npc, 8):
		world.free()
		_fail("Bundled importer-managed scene contract is incomplete.")
		return
	world.free()
	print(
		"MAPSOO_PI4_RUNTIME_SCENE_OK"
		+ " scene=%s" % scene_path
		+ " scene_sha256=%s" % FileAccess.get_sha256(scene_path)
		+ " profile=layered-depth-2d"
		+ " characters=2 props=3 player_clips=16 npc_clips=8"
		+ " physical_raspberry_pi=not-tested",
	)
	quit(0)


func _character_ok(actor: CharacterBody2D, clip_count: int) -> bool:
	if actor == null:
		return false
	var visual := actor.get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.sprite_frames == null \
			or visual.sprite_frames.get_animation_names().size() != clip_count:
		return false
	for animation: StringName in visual.sprite_frames.get_animation_names():
		if visual.sprite_frames.get_frame_count(animation) != 2:
			return false
	return true


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _safe_scene_path(path: String) -> bool:
	const PREFIX := "res://mapsoo_imports/"
	if not path.begins_with(PREFIX) or not path.ends_with(".world.tscn") \
			or path.contains("..") or path.contains("\\"):
		return false
	var parts := path.trim_prefix(PREFIX).split("/", false)
	if parts.size() != 2:
		return false
	var pack_id := str(parts[0])
	if pack_id.is_empty() or pack_id.begins_with("-") or pack_id.ends_with("-") \
			or pack_id.contains("--"):
		return false
	for character: String in pack_id:
		if not "abcdefghijklmnopqrstuvwxyz0123456789-".contains(character):
			return false
	return str(parts[1]) == "%s.world.tscn" % pack_id


func _fail(message: String) -> void:
	push_error("MAPSOO_PI4_RUNTIME_SCENE_FAILURE: %s" % message)
	quit(1)
