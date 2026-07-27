extends RefCounted


static func create(profile: String) -> Dictionary:
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
	var atlas_sha256 := sha256(atlas_bytes)
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
		"revision_sha256": sha256(revision_bytes),
		"atlas_bytes": atlas_bytes,
		"atlas_sha256": atlas_sha256,
		"clip_ids": clip_ids,
		"frame_size": frame_size,
		"pivot": pivot,
		"nominal_size": _nominal_size(profile),
		"default_animation": _default_animation(profile),
	}


static func sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK \
			or context.update(bytes) != OK:
		return ""
	return context.finish().hex_encode()


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


static func _frame_size(profile: String) -> Vector2i:
	match profile:
		"side-platformer", "topdown-farm":
			return Vector2i(128, 128)
		"isometric-action":
			return Vector2i(192, 128)
		"layered-depth-2d":
			return Vector2i(128, 192)
	return Vector2i.ZERO


static func _nominal_size(profile: String) -> Vector2i:
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
