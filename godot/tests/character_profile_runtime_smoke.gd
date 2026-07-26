extends SceneTree

const CharacterRuntime = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_character_profile_runtime.gd"
)
const PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	for profile: String in PROFILES:
		var fixture := _fixture(profile)
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var world := _world(profile, true)
		var visual := _visual(world, profile)
		var result := CharacterRuntime.bind_player(
			world,
			fixture.revision_bytes,
			fixture.revision_sha256,
			fixture.atlas_bytes
		)
		if not result.ok or result.status != "bound":
			_fail("%s profile did not bind: %s" % [profile, result])
			return
		if not _verify_bound(world, visual, profile, fixture):
			return
		var frames_before := visual.sprite_frames
		var replay := CharacterRuntime.bind_player(
			world,
			fixture.revision_bytes,
			fixture.revision_sha256,
			fixture.atlas_bytes
		)
		if not replay.ok or replay.status != "unchanged" or visual.sprite_frames != frames_before:
			_fail("%s profile binding is not idempotent: %s" % [profile, replay])
			return
		world.free()

	if not _negative_cases():
		return
	print("MAPSOO_CHARACTER_PROFILE_RUNTIME_OK profiles=4 negative=7")
	quit(0)


func _verify_bound(
	world: Node2D,
	visual: AnimatedSprite2D,
	profile: String,
	fixture: Dictionary
) -> bool:
	if visual == null or visual.sprite_frames == null:
		_fail("%s profile lost its player visual." % profile)
		return false
	var expected_ids: Array = fixture.clip_ids
	if visual.sprite_frames.get_animation_names().size() != expected_ids.size():
		_fail("%s profile animation count is wrong." % profile)
		return false
	for clip_id: Variant in expected_ids:
		var animation_name := str(clip_id).replace(".", "_")
		if not visual.sprite_frames.has_animation(animation_name) \
				or visual.sprite_frames.get_frame_count(animation_name) != 1:
			_fail("%s profile clip %s is missing." % [profile, clip_id])
			return false
	var first_name := str(expected_ids[0]).replace(".", "_")
	var first_texture := visual.sprite_frames.get_frame_texture(first_name, 0) as AtlasTexture
	if first_texture == null or Vector2i(first_texture.region.size) != fixture.frame_size:
		_fail("%s profile frame region is wrong." % profile)
		return false
	var expected_offset := Vector2(
		float(fixture.frame_size.x) * 0.5 - float(fixture.pivot.x),
		float(fixture.frame_size.y) * 0.5 - float(fixture.pivot.y)
	)
	var nominal: Vector2i = fixture.nominal_size
	var expected_scale := Vector2(
		float(nominal.x) / float(fixture.frame_size.x),
		float(nominal.y) / float(fixture.frame_size.y)
	)
	if not visual.offset.is_equal_approx(expected_offset) \
			or not visual.scale.is_equal_approx(expected_scale) \
			or str(visual.animation) != str(fixture.default_animation).replace(".", "_") \
			or visual.texture_filter != CanvasItem.TEXTURE_FILTER_NEAREST:
		_fail("%s profile visual geometry is wrong." % profile)
		return false
	if str(world.get_meta("mapsoo_character_profile_revision_id", "")) \
			!= str(fixture.revision.profile_revision_id) \
			or str(visual.get_meta("mapsoo_profile_character_id", "")) != "neutral-traveler" \
			or str(visual.get_meta("mapsoo_character_atlas_sha256", "")) != str(fixture.atlas_sha256):
		_fail("%s profile runtime binding metadata is incomplete." % profile)
		return false
	return true


func _negative_cases() -> bool:
	var fixture := _fixture("topdown-farm")
	var world := _world("topdown-farm", true)
	var visual := _visual(world, "topdown-farm")
	var original_frames := visual.sprite_frames
	var result := CharacterRuntime.bind_player(
		world, fixture.revision_bytes, "b".repeat(64), fixture.atlas_bytes
	)
	if result.ok or result.code != "binding.revision-sha256" or visual.sprite_frames != original_frames:
		_fail("Changed revision digest was not rejected before mutation: %s" % result)
		return false

	var wrong_profile: Dictionary = fixture.revision.duplicate(true)
	wrong_profile.profile = "side-platformer"
	var wrong_profile_bytes := JSON.stringify(wrong_profile).to_utf8_buffer()
	result = CharacterRuntime.bind_player(
		world, wrong_profile_bytes, _sha256(wrong_profile_bytes), fixture.atlas_bytes
	)
	if result.ok or result.code != "revision.clips" or visual.sprite_frames != original_frames:
		_fail("Profile-mismatched revision was not rejected before mutation: %s" % result)
		return false

	var missing_clip: Dictionary = fixture.revision.duplicate(true)
	missing_clip.clips.pop_back()
	var missing_clip_bytes := JSON.stringify(missing_clip).to_utf8_buffer()
	result = CharacterRuntime.bind_player(
		world, missing_clip_bytes, _sha256(missing_clip_bytes), fixture.atlas_bytes
	)
	if result.ok or result.code != "revision.clips" or visual.sprite_frames != original_frames:
		_fail("Incomplete clip inventory was not rejected before mutation: %s" % result)
		return false

	var unsafe_path: Dictionary = fixture.revision.duplicate(true)
	unsafe_path.atlas.path = "../private-character.png"
	var unsafe_path_bytes := JSON.stringify(unsafe_path).to_utf8_buffer()
	result = CharacterRuntime.bind_player(
		world, unsafe_path_bytes, _sha256(unsafe_path_bytes), fixture.atlas_bytes
	)
	if result.ok or result.code != "revision.atlas" or visual.sprite_frames != original_frames:
		_fail("Unsafe atlas path was not rejected before mutation: %s" % result)
		return false

	var corrupted: PackedByteArray = fixture.atlas_bytes.duplicate()
	corrupted[corrupted.size() - 1] = corrupted[corrupted.size() - 1] ^ 1
	result = CharacterRuntime.bind_player(
		world, fixture.revision_bytes, fixture.revision_sha256, corrupted
	)
	if result.ok or result.code != "binding.atlas-sha256" or visual.sprite_frames != original_frames:
		_fail("Changed atlas bytes were not rejected before mutation: %s" % result)
		return false

	var empty_world := _world("topdown-farm", false)
	result = CharacterRuntime.bind_player(
		empty_world, fixture.revision_bytes, fixture.revision_sha256, fixture.atlas_bytes
	)
	if result.ok or result.code != "binding.player-slot":
		_fail("Missing neutral player slot was not rejected: %s" % result)
		return false

	var ambiguous_world := _world("topdown-farm", true)
	var duplicate_slot := AnimatedSprite2D.new()
	duplicate_slot.set_meta("mapsoo_runtime_slot_id", "player")
	ambiguous_world.add_child(duplicate_slot)
	result = CharacterRuntime.bind_player(
		ambiguous_world, fixture.revision_bytes, fixture.revision_sha256, fixture.atlas_bytes
	)
	if result.ok or result.code != "binding.player-slot":
		_fail("Ambiguous neutral player slots were not rejected: %s" % result)
		return false
	world.free()
	empty_world.free()
	ambiguous_world.free()
	return true


func _fixture(profile: String) -> Dictionary:
	var actions := _actions(profile)
	var directions := _directions(profile)
	var clip_ids: Array[String] = []
	for action: String in actions:
		for direction: String in directions:
			clip_ids.append("%s.%s" % [action, direction])
	var columns := 8
	var rows := ceili(float(clip_ids.size()) / float(columns))
	var frame_size := _frame_size(profile)
	var pivot := Vector2i(frame_size.x / 2, frame_size.y - 8)
	var image := Image.create(
		frame_size.x * columns,
		frame_size.y * rows,
		false,
		Image.FORMAT_RGBA8
	)
	image.fill(Color(0, 0, 0, 0))
	var clips: Array[Dictionary] = []
	for index: int in clip_ids.size():
		var cell := Vector2i(index % columns, index / columns)
		image.set_pixel(
			cell.x * frame_size.x + frame_size.x / 2,
			cell.y * frame_size.y + pivot.y,
			Color8(37 + index % 180, 83 + index % 120, 149 + index % 90, 255)
		)
		var clip_id := clip_ids[index]
		var separator := clip_id.find(".")
		var action := clip_id.substr(0, separator)
		var direction := clip_id.substr(separator + 1)
		clips.append({
			"clip_id": clip_id,
			"action": action,
			"direction": direction,
			"fps": 8.0,
			"loop": action in ["idle", "walk", "run", "move", "fall"],
			"frames": [{"column": cell.x, "row": cell.y}],
		})
	var atlas_bytes := image.save_png_to_buffer()
	if atlas_bytes.is_empty():
		return {"ok": false, "error": "Unable to encode synthetic character atlas."}
	var atlas_sha256 := _sha256(atlas_bytes)
	var revision := {
		"schema_version": "1.0.0",
		"document_type": "character-profile-revision",
		"profile_revision_id": "neutral-traveler-%s-review" % profile,
		"character_id": "neutral-traveler",
		"profile": profile,
		"atlas": {
			"path": "character-profile-atlas.png",
			"media_type": "image/png",
			"bytes": atlas_bytes.size(),
			"sha256": atlas_sha256,
			"width": image.get_width(),
			"height": image.get_height(),
		},
		"frame_geometry": {
			"frame_width": frame_size.x,
			"frame_height": frame_size.y,
			"columns": columns,
			"rows": rows,
		},
		"pivot": {"x": pivot.x, "y": pivot.y, "unit": "pixels"},
		"clips": clips,
		"source_identity": {
			"identity_digest_sha256": "c".repeat(64),
			"source_reference_ids": ["character-reference"],
		},
		"rights": {
			"distribution": "internal-review",
			"license": "LicenseRef-Proprietary",
		},
	}
	var revision_bytes := JSON.stringify(revision).to_utf8_buffer()
	return {
		"ok": true,
		"revision": revision,
		"revision_bytes": revision_bytes,
		"revision_sha256": _sha256(revision_bytes),
		"atlas_bytes": atlas_bytes,
		"atlas_sha256": atlas_sha256,
		"clip_ids": clip_ids,
		"frame_size": frame_size,
		"pivot": pivot,
		"nominal_size": _nominal_size(profile),
		"default_animation": _default_animation(profile),
	}


func _world(profile: String, with_player: bool) -> Node2D:
	var world := Node2D.new()
	world.name = "MapsooWorld"
	world.set_meta("mapsoo_profile", profile)
	if not with_player:
		return world
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


func _actions(profile: String) -> Array[String]:
	match profile:
		"side-platformer":
			return ["idle", "run", "jump", "fall", "land", "hurt"]
		"topdown-farm":
			return ["idle", "walk"]
		"isometric-action":
			return ["idle", "move", "attack-primary", "dash", "hurt", "defeat"]
		"layered-depth-2d":
			return ["idle", "walk", "run", "interact"]
	return []


func _directions(profile: String) -> Array[String]:
	match profile:
		"side-platformer":
			return ["left", "right"]
		"topdown-farm":
			return ["north", "east", "south", "west"]
		"isometric-action":
			return [
				"north", "north-east", "east", "south-east",
				"south", "south-west", "west", "north-west",
			]
		"layered-depth-2d":
			return ["left", "right", "near", "far"]
	return []


func _frame_size(profile: String) -> Vector2i:
	match profile:
		"side-platformer", "topdown-farm":
			return Vector2i(128, 128)
		"isometric-action":
			return Vector2i(192, 128)
		"layered-depth-2d":
			return Vector2i(128, 192)
	return Vector2i.ZERO


func _nominal_size(profile: String) -> Vector2i:
	match profile:
		"side-platformer":
			return Vector2i(32, 64)
		"topdown-farm":
			return Vector2i(32, 32)
		"isometric-action":
			return Vector2i(48, 64)
		"layered-depth-2d":
			return Vector2i(48, 72)
	return Vector2i.ZERO


func _default_animation(profile: String) -> String:
	match profile:
		"side-platformer":
			return "idle.right"
		"topdown-farm", "isometric-action":
			return "idle.south"
		"layered-depth-2d":
			return "idle.near"
	return ""


func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK \
			or context.update(bytes) != OK:
		return ""
	return context.finish().hex_encode()


func _fail(message: String) -> void:
	push_error(message)
	quit(1)
