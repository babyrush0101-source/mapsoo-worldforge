extends SceneTree

const CharacterRuntime = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_character_profile_runtime.gd"
)
const CharacterFixture = preload("res://tests/character_profile_test_fixture.gd")
const SideController = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd"
)
const LayeredController = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_layered_depth_player_controller.gd"
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
		var fixture := CharacterFixture.create(profile)
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

	if not _direction_transform_cases():
		return
	if not _negative_cases():
		return
	print("MAPSOO_CHARACTER_PROFILE_RUNTIME_OK profiles=4 transforms=2 negative=9")
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
	if not (visual.get_meta("mapsoo_horizontal_flip_directions", []) as Array).is_empty() \
			or visual.flip_h:
		_fail("%s profile unexpectedly enabled a direction transform." % profile)
		return false
	return true


func _direction_transform_cases() -> bool:
	for profile: String in ["side-platformer", "layered-depth-2d"]:
		var fixture := CharacterFixture.create(profile, ["left"])
		var world := _world(profile, true)
		var visual := _visual(world, profile)
		var player := visual.get_parent() as CharacterBody2D
		player.set_script(
			SideController if profile == "side-platformer" else LayeredController
		)
		var result := CharacterRuntime.bind_player(
			world,
			fixture.revision_bytes,
			fixture.revision_sha256,
			fixture.atlas_bytes
		)
		if not result.ok \
				or visual.get_meta("mapsoo_horizontal_flip_directions", []) != ["left"]:
			_fail("%s explicit direction transform did not bind: %s" % [profile, result])
			return false
		player.call("_play_animation", "idle_left")
		if not visual.flip_h:
			_fail("%s left animation did not apply its declared horizontal flip." % profile)
			return false
		player.call("_play_animation", "idle_right")
		if visual.flip_h:
			_fail("%s right animation inherited an undeclared horizontal flip." % profile)
			return false
		world.free()
	return true


func _negative_cases() -> bool:
	var fixture := CharacterFixture.create("topdown-farm")
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
		world,
		wrong_profile_bytes,
		CharacterFixture.sha256(wrong_profile_bytes),
		fixture.atlas_bytes
	)
	if result.ok or result.code != "revision.clips" or visual.sprite_frames != original_frames:
		_fail("Profile-mismatched revision was not rejected before mutation: %s" % result)
		return false

	var missing_clip: Dictionary = fixture.revision.duplicate(true)
	missing_clip.clips.pop_back()
	var missing_clip_bytes := JSON.stringify(missing_clip).to_utf8_buffer()
	result = CharacterRuntime.bind_player(
		world,
		missing_clip_bytes,
		CharacterFixture.sha256(missing_clip_bytes),
		fixture.atlas_bytes
	)
	if result.ok or result.code != "revision.clips" or visual.sprite_frames != original_frames:
		_fail("Incomplete clip inventory was not rejected before mutation: %s" % result)
		return false

	var unsafe_path: Dictionary = fixture.revision.duplicate(true)
	unsafe_path.atlas.path = "../private-character.png"
	var unsafe_path_bytes := JSON.stringify(unsafe_path).to_utf8_buffer()
	result = CharacterRuntime.bind_player(
		world,
		unsafe_path_bytes,
		CharacterFixture.sha256(unsafe_path_bytes),
		fixture.atlas_bytes
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

	var bad_transform := CharacterFixture.create("side-platformer", ["left"])
	bad_transform.revision.runtime_direction_transform.provenance.source_reference_ids = [
		"unbound-direction-review",
	]
	var bad_transform_bytes := JSON.stringify(bad_transform.revision).to_utf8_buffer()
	var transform_world := _world("side-platformer", true)
	result = CharacterRuntime.bind_player(
		transform_world,
		bad_transform_bytes,
		CharacterFixture.sha256(bad_transform_bytes),
		bad_transform.atlas_bytes
	)
	if result.ok or result.code != "revision.direction-transform":
		_fail("Unbound direction transform provenance was not rejected: %s" % result)
		return false

	var unsupported_transform := CharacterFixture.create("topdown-farm")
	unsupported_transform.revision["runtime_direction_transform"] = {
		"strategy": "horizontal-flip",
		"directions": ["left"],
		"provenance": {
			"basis": "operator-declared-direction-equivalence",
			"source_reference_ids": ["character-reference"],
		},
	}
	var unsupported_bytes := JSON.stringify(unsupported_transform.revision).to_utf8_buffer()
	var topdown_world := _world("topdown-farm", true)
	result = CharacterRuntime.bind_player(
		topdown_world,
		unsupported_bytes,
		CharacterFixture.sha256(unsupported_bytes),
		unsupported_transform.atlas_bytes
	)
	if result.ok or result.code != "revision.direction-transform":
		_fail("Unsupported profile direction transform was not rejected: %s" % result)
		return false
	world.free()
	empty_world.free()
	ambiguous_world.free()
	transform_world.free()
	topdown_world.free()
	return true


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


func _fail(message: String) -> void:
	push_error(message)
	quit(1)
