extends SceneTree

const CharacterRuntime = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_character_profile_runtime.gd"
)
const FAMILY_ROOT := "res://tests/.generated/character-family"
const FAMILY_PATH := FAMILY_ROOT + "/character-profile-family.json"
const EXPECTED_PROFILES := [
	"side-platformer",
	"isometric-action",
	"topdown-farm",
	"layered-depth-2d",
]


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var family_bytes := FileAccess.get_file_as_bytes(FAMILY_PATH)
	if family_bytes.is_empty():
		_fail("Character family fixture is missing.")
		return
	var parsed: Variant = JSON.parse_string(family_bytes.get_string_from_utf8())
	if not parsed is Dictionary:
		_fail("Character family fixture is not JSON.")
		return
	var family := parsed as Dictionary
	if not _verify_family_header(family):
		return

	var total_clips := 0
	var members: Array = family.profiles
	for index in members.size():
		var member_value: Variant = members[index]
		if not member_value is Dictionary:
			_fail("Character family member %d is invalid." % index)
			return
		var member := member_value as Dictionary
		var profile := str(member.get("profile", ""))
		if profile != EXPECTED_PROFILES[index]:
			_fail("Character family member %d has the wrong profile." % index)
			return
		var revision_path := FAMILY_ROOT + "/" + str(member.get("revision_path", ""))
		var atlas_path := FAMILY_ROOT + "/" + str(member.get("atlas_path", ""))
		var revision_bytes := FileAccess.get_file_as_bytes(revision_path)
		var atlas_bytes := FileAccess.get_file_as_bytes(atlas_path)
		if revision_bytes.is_empty() or atlas_bytes.is_empty():
			_fail("%s family artifacts are missing." % profile)
			return
		var revision_value: Variant = JSON.parse_string(
			revision_bytes.get_string_from_utf8()
		)
		if not revision_value is Dictionary:
			_fail("%s revision is not JSON." % profile)
			return
		var revision := revision_value as Dictionary
		var world := _world(profile)
		var visual := _visual(world, profile)
		var result := CharacterRuntime.bind_player(
			world,
			revision_bytes,
			str(member.get("revision_sha256", "")),
			atlas_bytes
		)
		if not result.ok or result.status != "bound":
			_fail("%s family revision did not bind: %s" % [profile, result])
			return
		if not _verify_bound(world, visual, family, member, revision):
			return
		total_clips += (revision.get("clips", []) as Array).size()
		world.free()

	if total_clips != 84:
		_fail("Character family clip total is wrong: %d." % total_clips)
		return
	print(
		"MAPSOO_CHARACTER_FAMILY_GODOT_OK "
		+ "profiles=4 clips=84 source_images=false"
	)
	quit(0)


func _verify_family_header(family: Dictionary) -> bool:
	if str(family.get("schema_version", "")) != "1.0.0" \
			or str(family.get("document_type", "")) != "character-profile-family" \
			or str(family.get("status", "")) != "internal-review":
		_fail("Character family header is invalid.")
		return false
	var members: Variant = family.get("profiles")
	if not members is Array or (members as Array).size() != 4:
		_fail("Character family must contain four profile members.")
		return false
	var privacy_value: Variant = family.get("privacy")
	if not privacy_value is Dictionary:
		_fail("Character family privacy declaration is missing.")
		return false
	var privacy := privacy_value as Dictionary
	if privacy.get("source_images_included", true) != false \
			or privacy.get("source_paths_included", true) != false \
			or privacy.get("source_file_digests_included", true) != false \
			or privacy.get("free_text_description_included", true) != false:
		_fail("Character family privacy declaration is unsafe.")
		return false
	return true


func _verify_bound(
	world: Node2D,
	visual: AnimatedSprite2D,
	family: Dictionary,
	member: Dictionary,
	revision: Dictionary
) -> bool:
	if visual == null or visual.sprite_frames == null:
		_fail("%s family visual is missing." % str(member.profile))
		return false
	var clips_value: Variant = revision.get("clips")
	if not clips_value is Array:
		_fail("%s family clips are missing." % str(member.profile))
		return false
	var clips := clips_value as Array
	if visual.sprite_frames.get_animation_names().size() != clips.size() \
			or clips.size() != int(member.get("clip_count", -1)):
		_fail("%s family clip count is wrong." % str(member.profile))
		return false
	for clip_value: Variant in clips:
		if not clip_value is Dictionary:
			_fail("%s family clip is invalid." % str(member.profile))
			return false
		var clip := clip_value as Dictionary
		var animation_name := str(clip.get("clip_id", "")).replace(".", "_")
		var frames_value: Variant = clip.get("frames")
		if not frames_value is Array \
				or not visual.sprite_frames.has_animation(animation_name) \
				or visual.sprite_frames.get_frame_count(animation_name) \
					!= (frames_value as Array).size():
			_fail(
				"%s family animation %s is incomplete."
				% [str(member.profile), animation_name]
			)
			return false
	if str(world.get_meta("mapsoo_character_profile_revision_id", "")) \
			!= str(member.get("profile_revision_id", "")) \
			or str(visual.get_meta("mapsoo_profile_character_id", "")) \
				!= str(family.get("character_id", "")) \
			or str(visual.get_meta("mapsoo_character_atlas_sha256", "")) \
				!= str(member.get("atlas_sha256", "")):
		_fail("%s family binding metadata is incomplete." % str(member.profile))
		return false
	var first_clip := clips[0] as Dictionary
	var first_animation := str(first_clip.get("clip_id", "")).replace(".", "_")
	var first_texture := visual.sprite_frames.get_frame_texture(
		first_animation,
		0
	) as AtlasTexture
	var geometry_value: Variant = revision.get("frame_geometry")
	if first_texture == null or not geometry_value is Dictionary:
		_fail("%s family frame geometry is missing." % str(member.profile))
		return false
	var geometry := geometry_value as Dictionary
	if Vector2i(first_texture.region.size) != Vector2i(
		int(geometry.get("frame_width", 0)),
		int(geometry.get("frame_height", 0))
	):
		_fail("%s family frame region is wrong." % str(member.profile))
		return false
	return true


func _world(profile: String) -> Node2D:
	var world := Node2D.new()
	world.name = "MapsooWorld"
	world.set_meta("mapsoo_profile", profile)
	var parent: Node = world
	if profile in ["isometric-action", "layered-depth-2d"]:
		var gameplay := Node2D.new()
		gameplay.name = "YSortedGameplay"
		world.add_child(gameplay)
		var actors := Node2D.new()
		actors.name = "Actors"
		gameplay.add_child(actors)
		parent = actors
	var player := CharacterBody2D.new()
	player.name = "Player"
	parent.add_child(player)
	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = SpriteFrames.new()
	visual.set_meta("mapsoo_runtime_slot_id", "player")
	player.add_child(visual)
	return world


func _visual(world: Node, profile: String) -> AnimatedSprite2D:
	var path := "Player/Visual"
	if profile in ["isometric-action", "layered-depth-2d"]:
		path = "YSortedGameplay/Actors/Player/Visual"
	return world.get_node_or_null(path) as AnimatedSprite2D


func _fail(message: String) -> void:
	push_error(message)
	quit(1)
