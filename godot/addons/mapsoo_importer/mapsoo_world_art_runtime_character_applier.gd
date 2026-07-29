@tool
extends RefCounted

## Selects one reviewed player binding from the trusted runtime overlay and
## delegates animation construction to the existing character profile runtime.

const CharacterRuntime = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_character_profile_runtime.gd"
)
const OVERLAY_NODE := "WorldArtRuntimeOverlay"


static func apply(root: Node) -> Dictionary:
	var context := _context(root)
	if not context.ok:
		return context
	return CharacterRuntime.bind_projected_player(
		root,
		context.binding,
		context.image,
		context.texture,
		context.overlay_id,
		context.projection_id
	)


static func validate_scene(root: Node) -> Dictionary:
	var context := _context(root)
	if not context.ok:
		return context
	return CharacterRuntime.validate_projected_player(
		root,
		context.binding,
		context.image,
		context.texture,
		context.overlay_id,
		context.projection_id
	)


static func _context(root: Node) -> Dictionary:
	if root == null:
		return _failure("Projected character application requires a scene root.")
	var overlay := root.get_node_or_null(OVERLAY_NODE)
	if (
		overlay == null
		or root.get_meta("mapsoo_world_art_overlay_status", "")
			!= "reviewed-runtime-overlay-v1"
	):
		return _failure("Projected character requires one bound runtime overlay.")
	var bindings_value: Variant = overlay.get_meta("mapsoo_bindings", [])
	var images_value: Variant = overlay.get_meta("mapsoo_images", [])
	var textures_value: Variant = overlay.get_meta("mapsoo_textures", {})
	if (
		not bindings_value is Array
		or not images_value is Array
		or not textures_value is Dictionary
	):
		return _failure("Projected character catalog is invalid.")
	var players: Array[Dictionary] = []
	for binding_value: Variant in bindings_value:
		if (
			binding_value is Dictionary
			and binding_value.get("usage_kind") == "character"
			and binding_value.get("role") == "character.player.atlas"
		):
			players.append(binding_value)
	if players.size() != 1:
		return _failure(
			"Projected character catalog must select exactly one player atlas."
		)
	var binding := players[0]
	var image: Dictionary = {}
	for image_value: Variant in images_value:
		if (
			image_value is Dictionary
			and image_value.get("task_id") == binding.get("task_id")
			and image_value.get("path") == binding.get("image_path")
		):
			if not image.is_empty():
				return _failure("Projected player image is ambiguous.")
			image = image_value
	var texture: Texture2D = textures_value.get(
		str(binding.get("image_path", ""))
	)
	if image.is_empty() or texture == null:
		return _failure("Projected player image is missing.")
	return {
		"ok": true,
		"binding": binding,
		"image": image,
		"texture": texture,
		"overlay_id": str(overlay.get_meta("mapsoo_overlay_id", "")),
		"projection_id": str(overlay.get_meta("mapsoo_projection_id", "")),
		"error": "",
	}


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
