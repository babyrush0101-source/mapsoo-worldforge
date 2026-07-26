extends RefCounted
class_name MapsooCharacterProfileRuntime

const CONTRACT_VERSION := "1.0.0"
const DOCUMENT_TYPE := "character-profile-revision"
const SHA256_LENGTH := 64


static func bind_player(
	world: Node,
	revision_bytes: PackedByteArray,
	revision_sha256: String,
	atlas_bytes: PackedByteArray
) -> Dictionary:
	if revision_bytes.is_empty():
		return _failure("binding.revision-bytes", "Canonical character revision bytes are required.")
	if not _is_sha256(revision_sha256) or _sha256(revision_bytes) != revision_sha256:
		return _failure(
			"binding.revision-sha256",
			"Canonical character revision bytes do not match the trusted revision digest."
		)
	var revision_value: Variant = JSON.parse_string(revision_bytes.get_string_from_utf8())
	var validated := _validate_revision(revision_value)
	if not validated.ok:
		return validated
	if world == null:
		return _failure("binding.world", "World root is required.")
	var profile := str(validated.profile)
	if str(world.get_meta("mapsoo_profile", "")) != profile:
		return _failure("binding.profile", "Character profile does not match the loaded world.")
	var slot_result := _player_visual(world, profile)
	if not slot_result.ok:
		return slot_result
	var visual: AnimatedSprite2D = slot_result.visual

	var expected_bytes := int(validated.atlas.bytes)
	if atlas_bytes.is_empty() or atlas_bytes.size() != expected_bytes:
		return _failure("binding.atlas-bytes", "Character atlas byte count does not match the revision.")
	var actual_sha256 := _sha256(atlas_bytes)
	if actual_sha256 != str(validated.atlas.sha256):
		return _failure("binding.atlas-sha256", "Character atlas SHA-256 does not match the revision.")
	var image := Image.new()
	var image_error := image.load_png_from_buffer(atlas_bytes)
	if image_error != OK:
		return _failure("binding.atlas-png", "Character atlas is not a decodable PNG.")
	if image.get_width() != int(validated.atlas.width) \
			or image.get_height() != int(validated.atlas.height):
		return _failure("binding.atlas-dimensions", "Decoded atlas dimensions do not match the revision.")

	if str(visual.get_meta("mapsoo_profile_revision_sha256", "")) == revision_sha256 \
			and str(visual.get_meta("mapsoo_character_atlas_sha256", "")) == actual_sha256 \
			and _visual_has_clips(visual, validated.clip_ids):
		return _success("unchanged", validated, revision_sha256, actual_sha256, visual)

	var texture := ImageTexture.create_from_image(image)
	if texture == null:
		return _failure("binding.atlas-texture", "Character atlas could not become a runtime texture.")
	var frames_result := _build_sprite_frames(validated, texture)
	if not frames_result.ok:
		return frames_result
	var frame_size: Vector2i = validated.frame_size
	var pivot: Vector2i = validated.pivot
	var nominal_size := _nominal_frame_size(profile)
	if nominal_size == Vector2i.ZERO:
		return _failure("binding.profile", "Character profile has no runtime geometry policy.")

	var frames: SpriteFrames = frames_result.frames
	var default_animation := str(validated.default_animation).replace(".", "_")
	visual.sprite_frames = frames
	visual.animation = default_animation
	visual.offset = Vector2(
		float(frame_size.x) * 0.5 - float(pivot.x),
		float(frame_size.y) * 0.5 - float(pivot.y)
	)
	visual.scale = Vector2(
		float(nominal_size.x) / float(frame_size.x),
		float(nominal_size.y) / float(frame_size.y)
	)
	visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	visual.set_meta("mapsoo_character_profile_revision_id", str(validated.profile_revision_id))
	visual.set_meta("mapsoo_profile_revision_sha256", revision_sha256)
	visual.set_meta("mapsoo_character_atlas_sha256", actual_sha256)
	visual.set_meta("mapsoo_profile_character_id", str(validated.character_id))
	var actor := visual.get_parent()
	if actor != null:
		actor.set_meta("mapsoo_character_profile_revision_id", str(validated.profile_revision_id))
		actor.set_meta("mapsoo_profile_revision_sha256", revision_sha256)
		actor.set_meta("mapsoo_profile_character_id", str(validated.character_id))
	world.set_meta("mapsoo_character_profile_revision_id", str(validated.profile_revision_id))
	world.set_meta("mapsoo_profile_revision_sha256", revision_sha256)
	return _success("bound", validated, revision_sha256, actual_sha256, visual)


static func _validate_revision(value: Variant) -> Dictionary:
	if not value is Dictionary:
		return _failure("revision.shape", "Character revision must be a dictionary.")
	var revision: Dictionary = value
	if not _exact_keys(revision, [
		"schema_version", "document_type", "profile_revision_id", "character_id",
		"profile", "atlas", "frame_geometry", "pivot", "clips",
		"source_identity", "rights",
	]):
		return _failure("revision.shape", "Character revision contains missing or unknown fields.")
	if str(revision.get("schema_version", "")) != CONTRACT_VERSION \
			or str(revision.get("document_type", "")) != DOCUMENT_TYPE:
		return _failure("revision.version", "Character revision contract version is unsupported.")
	var profile := str(revision.get("profile", ""))
	if not _profiles().has(profile):
		return _failure("revision.profile", "Character revision profile is unsupported.")
	var profile_revision_id := str(revision.get("profile_revision_id", ""))
	var character_id := str(revision.get("character_id", ""))
	if not _is_safe_id(profile_revision_id, 100) or not _is_safe_id(character_id, 100):
		return _failure("revision.id", "Character revision ids must be portable kebab-case.")

	var atlas_result := _validate_atlas(revision.get("atlas"))
	if not atlas_result.ok:
		return atlas_result
	var geometry_result := _validate_geometry(revision.get("frame_geometry"), atlas_result)
	if not geometry_result.ok:
		return geometry_result
	var pivot_result := _validate_pivot(revision.get("pivot"), geometry_result.frame_size)
	if not pivot_result.ok:
		return pivot_result
	var identity_result := _validate_source_identity(revision.get("source_identity"))
	if not identity_result.ok:
		return identity_result
	var rights_result := _validate_rights(revision.get("rights"))
	if not rights_result.ok:
		return rights_result
	var clips_result := _validate_clips(
		revision.get("clips"),
		profile,
		geometry_result.columns,
		geometry_result.rows
	)
	if not clips_result.ok:
		return clips_result
	return {
		"ok": true,
		"profile": profile,
		"profile_revision_id": profile_revision_id,
		"character_id": character_id,
		"atlas": atlas_result.atlas,
		"frame_size": geometry_result.frame_size,
		"columns": geometry_result.columns,
		"rows": geometry_result.rows,
		"pivot": pivot_result.pivot,
		"clips": clips_result.clips,
		"clip_ids": clips_result.clip_ids,
		"default_animation": _default_animation(profile),
	}


static func _validate_atlas(value: Variant) -> Dictionary:
	if not value is Dictionary:
		return _failure("revision.atlas", "Character atlas declaration must be a dictionary.")
	var atlas: Dictionary = value
	if not _exact_keys(atlas, ["path", "media_type", "bytes", "sha256", "width", "height"]):
		return _failure("revision.atlas", "Character atlas declaration is not exact.")
	if str(atlas.get("media_type", "")) != "image/png" \
			or not _is_safe_path(str(atlas.get("path", ""))):
		return _failure("revision.atlas", "Character atlas must use a safe relative PNG path.")
	if not _is_bounded_integer(atlas.get("bytes"), 1, 536870912) \
			or not _is_sha256(str(atlas.get("sha256", ""))) \
			or not _is_bounded_integer(atlas.get("width"), 1, 8192) \
			or not _is_bounded_integer(atlas.get("height"), 1, 8192):
		return _failure("revision.atlas", "Character atlas integrity fields are invalid.")
	return {
		"ok": true,
		"atlas": {
			"path": str(atlas.path),
			"bytes": int(atlas.bytes),
			"sha256": str(atlas.sha256),
			"width": int(atlas.width),
			"height": int(atlas.height),
		},
	}


static func _validate_geometry(value: Variant, atlas_result: Dictionary) -> Dictionary:
	if not value is Dictionary:
		return _failure("revision.geometry", "Character frame geometry must be a dictionary.")
	var geometry: Dictionary = value
	if not _exact_keys(geometry, ["frame_width", "frame_height", "columns", "rows"]):
		return _failure("revision.geometry", "Character frame geometry is not exact.")
	if not _is_bounded_integer(geometry.get("frame_width"), 1, 2048) \
			or not _is_bounded_integer(geometry.get("frame_height"), 1, 2048) \
			or not _is_bounded_integer(geometry.get("columns"), 1, 256) \
			or not _is_bounded_integer(geometry.get("rows"), 1, 256):
		return _failure("revision.geometry", "Character frame geometry values are invalid.")
	var frame_size := Vector2i(int(geometry.frame_width), int(geometry.frame_height))
	var columns := int(geometry.columns)
	var rows := int(geometry.rows)
	if frame_size.x * columns != int(atlas_result.atlas.width) \
			or frame_size.y * rows != int(atlas_result.atlas.height):
		return _failure("revision.geometry", "Character frame grid does not cover the atlas exactly.")
	return {
		"ok": true,
		"frame_size": frame_size,
		"columns": columns,
		"rows": rows,
	}


static func _validate_pivot(value: Variant, frame_size: Vector2i) -> Dictionary:
	if not value is Dictionary:
		return _failure("revision.pivot", "Character pivot must be a dictionary.")
	var pivot_value: Dictionary = value
	if not _exact_keys(pivot_value, ["x", "y", "unit"]) \
			or str(pivot_value.get("unit", "")) != "pixels" \
			or not _is_bounded_integer(pivot_value.get("x"), 0, frame_size.x - 1) \
			or not _is_bounded_integer(pivot_value.get("y"), 0, frame_size.y - 1):
		return _failure("revision.pivot", "Character pivot is outside its frame.")
	return {"ok": true, "pivot": Vector2i(int(pivot_value.x), int(pivot_value.y))}


static func _validate_source_identity(value: Variant) -> Dictionary:
	if not value is Dictionary:
		return _failure("revision.source-identity", "Source identity summary must be a dictionary.")
	var identity: Dictionary = value
	if not _exact_keys(identity, ["identity_digest_sha256", "source_reference_ids"]) \
			or not _is_sha256(str(identity.get("identity_digest_sha256", ""))):
		return _failure("revision.source-identity", "Source identity digest is invalid.")
	var ids: Variant = identity.get("source_reference_ids")
	if not ids is Array or ids.is_empty() or ids.size() > 32:
		return _failure("revision.source-identity", "Source identity reference list is invalid.")
	var seen := {}
	for id_value: Variant in ids:
		var id := str(id_value)
		if not _is_safe_id(id, 100) or seen.has(id):
			return _failure("revision.source-identity", "Source identity references must be unique opaque ids.")
		seen[id] = true
	return {"ok": true}


static func _validate_rights(value: Variant) -> Dictionary:
	if not value is Dictionary:
		return _failure("revision.rights", "Character rights must be a dictionary.")
	var rights: Dictionary = value
	if not _exact_keys(rights, ["distribution", "license"], ["attribution"]):
		return _failure("revision.rights", "Character rights declaration is not exact.")
	var distribution := str(rights.get("distribution", ""))
	var license := str(rights.get("license", ""))
	if not ["private", "internal-review", "public"].has(distribution) \
			or not ["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "LicenseRef-Proprietary"].has(license):
		return _failure("revision.rights", "Character rights declaration is unsupported.")
	if distribution == "public" and license == "LicenseRef-Proprietary":
		return _failure("revision.rights", "Public character output cannot remain proprietary.")
	if license in ["CC-BY-4.0", "CC-BY-SA-4.0"]:
		var attribution := str(rights.get("attribution", ""))
		if attribution.is_empty() or attribution.strip_edges() != attribution or attribution.length() > 500:
			return _failure("revision.rights", "Attribution license requires bounded attribution.")
	return {"ok": true}


static func _validate_clips(
	value: Variant,
	profile: String,
	columns: int,
	rows: int
) -> Dictionary:
	if not value is Array:
		return _failure("revision.clips", "Character clips must be an array.")
	var clips: Array = value
	var expected_ids := _required_clip_ids(profile)
	if clips.size() != expected_ids.size():
		return _failure("revision.clips", "Character clip inventory is incomplete.")
	var normalized_clips: Array[Dictionary] = []
	for index: int in clips.size():
		var clip_value: Variant = clips[index]
		if not clip_value is Dictionary:
			return _failure("revision.clips", "Character clip must be a dictionary.")
		var clip: Dictionary = clip_value
		if not _exact_keys(clip, ["clip_id", "action", "direction", "fps", "loop", "frames"]):
			return _failure("revision.clips", "Character clip declaration is not exact.")
		var expected_id := str(expected_ids[index])
		var separator := expected_id.find(".")
		var expected_action := expected_id.substr(0, separator)
		var expected_direction := expected_id.substr(separator + 1)
		if str(clip.get("clip_id", "")) != expected_id \
				or str(clip.get("action", "")) != expected_action \
				or str(clip.get("direction", "")) != expected_direction:
			return _failure("revision.clips", "Character clips are not in canonical order.")
		var fps: Variant = clip.get("fps")
		if not _is_number(fps) or float(fps) <= 0.0 or float(fps) > 60.0 \
				or typeof(clip.get("loop")) != TYPE_BOOL:
			return _failure("revision.clips", "Character clip timing or loop policy is invalid.")
		var frame_values: Variant = clip.get("frames")
		if not frame_values is Array or frame_values.is_empty() or frame_values.size() > 32:
			return _failure("revision.clips", "Character clip frame list is invalid.")
		var normalized_frames: Array[Vector2i] = []
		for frame_value: Variant in frame_values:
			if not frame_value is Dictionary:
				return _failure("revision.frames", "Character frame must be a dictionary.")
			var frame: Dictionary = frame_value
			if not _exact_keys(frame, ["column", "row"]) \
					or not _is_bounded_integer(frame.get("column"), 0, columns - 1) \
					or not _is_bounded_integer(frame.get("row"), 0, rows - 1):
				return _failure("revision.frames", "Character frame is outside the atlas grid.")
			var cell := Vector2i(int(frame.column), int(frame.row))
			normalized_frames.append(cell)
		normalized_clips.append({
			"clip_id": expected_id,
			"fps": float(fps),
			"loop": bool(clip.loop),
			"frames": normalized_frames,
		})
	return {"ok": true, "clips": normalized_clips, "clip_ids": expected_ids}


static func _build_sprite_frames(validated: Dictionary, texture: Texture2D) -> Dictionary:
	var result := SpriteFrames.new()
	result.remove_animation("default")
	var frame_size: Vector2i = validated.frame_size
	for clip: Dictionary in validated.clips:
		var animation_name := str(clip.clip_id).replace(".", "_")
		result.add_animation(animation_name)
		result.set_animation_speed(animation_name, float(clip.fps))
		result.set_animation_loop(animation_name, bool(clip.loop))
		for cell: Vector2i in clip.frames:
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(
				cell.x * frame_size.x,
				cell.y * frame_size.y,
				frame_size.x,
				frame_size.y
			)
			atlas.filter_clip = true
			result.add_frame(animation_name, atlas)
	return {"ok": true, "frames": result}


static func _player_visual(world: Node, profile: String) -> Dictionary:
	var tagged: Array[AnimatedSprite2D] = []
	for candidate: Node in world.find_children("*", "AnimatedSprite2D", true, false):
		var visual := candidate as AnimatedSprite2D
		if visual != null and str(visual.get_meta("mapsoo_runtime_slot_id", "")) == "player":
			tagged.append(visual)
	if tagged.size() == 1:
		return {"ok": true, "visual": tagged[0], "source": "neutral-slot"}
	if tagged.size() > 1:
		return _failure(
			"binding.player-slot",
			"Loaded world exposes more than one neutral player visual slot."
		)

	# Backward compatibility for scenes imported before the neutral slot metadata existed.
	var path := "Player/Visual"
	if profile in ["isometric-action", "layered-depth-2d"]:
		path = "YSortedGameplay/Actors/Player/Visual"
	var legacy := world.get_node_or_null(path) as AnimatedSprite2D
	if legacy == null:
		return _failure("binding.player-slot", "Loaded world does not expose a neutral player visual slot.")
	legacy.set_meta("mapsoo_runtime_slot_id", "player")
	return {"ok": true, "visual": legacy, "source": "legacy-path"}


static func _visual_has_clips(visual: AnimatedSprite2D, clip_ids: Array) -> bool:
	if visual.sprite_frames == null:
		return false
	for clip_id: Variant in clip_ids:
		if not visual.sprite_frames.has_animation(str(clip_id).replace(".", "_")):
			return false
	return true


static func _success(
	status: String,
	validated: Dictionary,
	revision_sha256: String,
	atlas_sha256: String,
	visual: AnimatedSprite2D
) -> Dictionary:
	return {
		"ok": true,
		"status": status,
		"profile": str(validated.profile),
		"character_id": str(validated.character_id),
		"profile_revision_id": str(validated.profile_revision_id),
		"profile_revision_sha256": revision_sha256,
		"atlas_sha256": atlas_sha256,
		"animation_count": visual.sprite_frames.get_animation_names().size(),
		"default_animation": str(validated.default_animation),
		"human_review": "required",
	}


static func _failure(code: String, message: String) -> Dictionary:
	return {"ok": false, "code": code, "error": message}


static func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	if context.update(bytes) != OK:
		return ""
	return context.finish().hex_encode()


static func _exact_keys(value: Dictionary, required: Array, optional: Array = []) -> bool:
	if value.size() < required.size() or value.size() > required.size() + optional.size():
		return false
	var allowed := {}
	for key: Variant in required:
		allowed[str(key)] = true
	for key: Variant in optional:
		allowed[str(key)] = true
	for key: Variant in value.keys():
		if not allowed.has(str(key)):
			return false
	for key: Variant in required:
		if not value.has(str(key)):
			return false
	return true


static func _is_bounded_integer(value: Variant, minimum: int, maximum: int) -> bool:
	if not _is_number(value):
		return false
	var number := float(value)
	return is_finite(number) and number == floor(number) and number >= minimum and number <= maximum


static func _is_number(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT]


static func _is_sha256(value: String) -> bool:
	if value.length() != SHA256_LENGTH:
		return false
	for index: int in value.length():
		var code := value.unicode_at(index)
		if not (code >= 48 and code <= 57) and not (code >= 97 and code <= 102):
			return false
	return true


static func _is_safe_id(value: String, maximum: int) -> bool:
	if value.is_empty() or value.length() > maximum \
			or value.begins_with("-") or value.ends_with("-") or value.contains("--"):
		return false
	for index: int in value.length():
		var code := value.unicode_at(index)
		var lowercase := code >= 97 and code <= 122
		var digit := code >= 48 and code <= 57
		if not lowercase and not digit and code != 45:
			return false
	return true


static func _is_safe_path(value: String) -> bool:
	if value.is_empty() or value.length() > 240 or value.begins_with("/") \
			or value.contains("\\") or value.contains("..") or not value.ends_with(".png"):
		return false
	for segment: String in value.split("/"):
		if segment.is_empty() or segment == "." or segment == ".." \
				or not _is_lowercase_path_segment(segment):
			return false
	return true


static func _is_lowercase_path_segment(segment: String) -> bool:
	var first := segment.unicode_at(0)
	if not ((first >= 97 and first <= 122) or (first >= 48 and first <= 57)):
		return false
	for index: int in segment.length():
		var code := segment.unicode_at(index)
		var lowercase := code >= 97 and code <= 122
		var digit := code >= 48 and code <= 57
		if not lowercase and not digit and code not in [45, 46, 95]:
			return false
	return true


static func _profiles() -> Array[String]:
	return ["side-platformer", "topdown-farm", "isometric-action", "layered-depth-2d"]


static func _actions(profile: String) -> Array[String]:
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


static func _directions(profile: String) -> Array[String]:
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


static func _required_clip_ids(profile: String) -> Array[String]:
	var result: Array[String] = []
	for action: String in _actions(profile):
		for direction: String in _directions(profile):
			result.append("%s.%s" % [action, direction])
	return result


static func _nominal_frame_size(profile: String) -> Vector2i:
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


static func _default_animation(profile: String) -> String:
	match profile:
		"side-platformer":
			return "idle.right"
		"topdown-farm", "isometric-action":
			return "idle.south"
		"layered-depth-2d":
			return "idle.near"
	return ""
