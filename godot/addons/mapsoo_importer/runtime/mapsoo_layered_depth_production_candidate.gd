extends Node2D

## Trusted internal-review runtime for the hash-bound layered-depth production art.
##
## This script is part of the reusable runtime shell. Generated world data never
## supplies scripts. The Pi archive builder copies only the exact manifest and PNG
## files declared by the reviewed candidate world set.

const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_layered_depth_player_controller.gd")
const WORLD_ID := "layered-depth-2d-production-v1"
const WORLD_DIR := "res://mapsoo_imports/%s" % WORLD_ID
const VIEWPORT_SIZE := Vector2i(640, 360)
const LAYER_SOURCE_SIZE := Vector2i(1280, 720)
const PROP_ATLAS_SIZE := Vector2i(768, 768)
const CHARACTER_ATLAS_SIZE := Vector2i(384, 576)
const PROP_CELL_SIZE := Vector2i(96, 96)
const CHARACTER_FRAME_SIZE := Vector2i(48, 72)
const REQUIRED_LAYER_ROLES := [
	"background.sky",
	"background.far",
	"background.mid",
	"background.depth-fog",
	"near.overlay",
	"foreground.overlay",
	"lighting.ambient",
	"lighting.local",
]
const LAYER_FILES := {
	"background.sky": "assets/layer-background-sky.png",
	"background.far": "assets/layer-background-far.png",
	"background.mid": "assets/layer-background-mid.png",
	"background.depth-fog": "assets/layer-background-depth-fog.png",
	"near.overlay": "assets/layer-near-overlay.png",
	"foreground.overlay": "assets/layer-foreground-overlay.png",
	"lighting.ambient": "assets/layer-lighting-ambient.png",
	"lighting.local": "assets/layer-lighting-local.png",
}


func _ready() -> void:
	set_meta("mapsoo_pack_id", WORLD_ID)
	set_meta("mapsoo_profile", "layered-depth-2d")
	set_meta("mapsoo_distribution", "internal-review")
	set_meta("mapsoo_output_license", "UNRELEASED")
	set_meta("mapsoo_standard_pack", false)
	set_meta("mapsoo_runtime_candidate", true)
	if not _assemble():
		_show_failure()


func _assemble() -> bool:
	var layers_manifest := _load_json("%s/manifests/layers.json" % WORLD_DIR)
	var props_manifest := _load_json("%s/manifests/props.json" % WORLD_DIR)
	var player_manifest := _load_json("%s/manifests/player.json" % WORLD_DIR)
	var npc_manifest := _load_json("%s/manifests/npc.json" % WORLD_DIR)
	if not _validate_manifests(
		layers_manifest,
		props_manifest,
		player_manifest,
		npc_manifest,
	):
		return false

	var layer_textures := {}
	for value in layers_manifest.get("layers", []) as Array:
		var record := value as Dictionary
		var role := str(record.get("role", ""))
		var runtime_record := record.get("runtime", {}) as Dictionary
		var texture := _recorded_texture(
			"%s/%s" % [WORLD_DIR, str(LAYER_FILES.get(role, ""))],
			runtime_record,
			LAYER_SOURCE_SIZE,
		)
		if texture == null:
			return false
		layer_textures[role] = texture
	if layer_textures.size() != REQUIRED_LAYER_ROLES.size():
		return _fail("The production world requires eight exact runtime layers.")
	if not _add_layers(layers_manifest, layer_textures):
		return false

	var prop_texture := _recorded_texture(
		"%s/assets/props.png" % WORLD_DIR,
		props_manifest,
		PROP_ATLAS_SIZE,
	)
	var player_texture := _recorded_texture(
		"%s/assets/player.png" % WORLD_DIR,
		player_manifest,
		CHARACTER_ATLAS_SIZE,
	)
	var npc_texture := _recorded_texture(
		"%s/assets/npc.png" % WORLD_DIR,
		npc_manifest,
		CHARACTER_ATLAS_SIZE,
	)
	if prop_texture == null or player_texture == null or npc_texture == null:
		return false
	if _add_props(props_manifest, prop_texture) != 22:
		return _fail("The production world requires all 22 art roles.")
	_add_blocker()
	_add_traversal()
	_add_collectible()

	var actors := Node2D.new()
	actors.name = "Actors"
	actors.y_sort_enabled = true
	add_child(actors)
	if _add_npc(actors, npc_texture, npc_manifest) == null:
		return false
	if _add_player(actors, player_texture, player_manifest) == null:
		return false
	set_meta("mapsoo_runtime_ready", true)
	return true


func _validate_manifests(
	layers: Dictionary,
	props: Dictionary,
	player: Dictionary,
	npc: Dictionary,
) -> bool:
	if str(layers.get("id", "")) != "layered-depth-2d-production-layers-v1" \
			or str(props.get("id", "")) != "layered-depth-2d-prop-atlas-v1" \
			or str(player.get("id", "")) != "layered-depth-2d-player-atlas-v1" \
			or str(npc.get("id", "")) != "layered-depth-2d-npc-atlas-v1":
		return _fail("Production manifest identity mismatch.")
	for manifest in [layers, props, player, npc]:
		var record := manifest as Dictionary
		if str(record.get("profile", "")) != "layered-depth-2d" \
				or str(record.get("distribution", "")) != "internal-review" \
				or str(record.get("output_license", "")) != "UNRELEASED":
			return _fail("Production review boundary mismatch.")
	var seen := {}
	for value in layers.get("layers", []) as Array:
		var layer := value as Dictionary
		var role := str(layer.get("role", ""))
		if role not in REQUIRED_LAYER_ROLES or seen.has(role):
			return _fail("Production layer inventory mismatch.")
		seen[role] = true
	if seen.size() != REQUIRED_LAYER_ROLES.size() \
			or (props.get("required_roles", []) as Array).size() != 22 \
			or (props.get("role_mappings", []) as Array).size() != 22 \
			or (player.get("clips", []) as Array).size() != 16 \
			or (player.get("frames", []) as Array).size() != 32 \
			or (npc.get("clips", []) as Array).size() != 8 \
			or (npc.get("frames", []) as Array).size() != 16:
		return _fail("Production art inventory is incomplete.")
	return true


func _add_layers(manifest: Dictionary, textures: Dictionary) -> bool:
	var root_node := Node2D.new()
	root_node.name = "ProductionLayers"
	add_child(root_node)
	for value in manifest.get("layers", []) as Array:
		var record := value as Dictionary
		var role := str(record.get("role", ""))
		var sprite := Sprite2D.new()
		sprite.name = role.replace(".", "_")
		sprite.texture = textures.get(role) as Texture2D
		sprite.centered = false
		sprite.scale = Vector2(0.5, 0.5)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.z_index = _runtime_z(role)
		sprite.set_meta("mapsoo_role", role)
		if role in ["near.overlay", "foreground.overlay"]:
			sprite.modulate = Color(0.72, 0.76, 0.86, 0.90)
		elif role == "lighting.local":
			sprite.modulate = Color(1.0, 1.0, 1.0, 0.82)
		var blend := str(record.get("blend_mode", "mix"))
		if blend in ["multiply", "add"]:
			var material := CanvasItemMaterial.new()
			material.blend_mode = (
				CanvasItemMaterial.BLEND_MODE_MUL
				if blend == "multiply"
				else CanvasItemMaterial.BLEND_MODE_ADD
			)
			sprite.material = material
		root_node.add_child(sprite)
	return true


func _runtime_z(role: String) -> int:
	match role:
		"background.sky":
			return -100
		"background.far":
			return -90
		"background.mid":
			return -80
		"background.depth-fog":
			return -70
		"near.overlay":
			return 30
		"foreground.overlay":
			return 40
		"lighting.ambient":
			# Keep the global multiply pass behind actors so character
			# silhouettes retain gameplay contrast in dark scenes.
			return 5
		"lighting.local":
			return 60
	return 0


func _add_props(manifest: Dictionary, texture: Texture2D) -> int:
	var anchors := [
		Vector2(74, 336), Vector2(154, 336), Vector2(232, 336),
		Vector2(390, 220), Vector2(292, 220), Vector2(554, 338),
		Vector2(58, 292), Vector2(106, 326), Vector2(214, 324),
		Vector2(254, 316), Vector2(344, 204), Vector2(316, 320),
		Vector2(68, 306), Vector2(560, 206), Vector2(286, 210),
		Vector2(476, 194), Vector2(248, 286), Vector2(462, 174),
		Vector2(176, 302), Vector2(186, 274), Vector2(538, 182),
		Vector2(420, 194),
	]
	var layer := Node2D.new()
	layer.name = "ProductionProps"
	layer.y_sort_enabled = true
	layer.z_index = -5
	add_child(layer)
	var count := 0
	var seen := {}
	for value in manifest.get("role_mappings", []) as Array:
		var item := value as Dictionary
		var role := str(item.get("role", ""))
		if role.is_empty() or seen.has(role) or count >= anchors.size():
			return 0
		seen[role] = true
		var cell := item.get("atlas_cell", {}) as Dictionary
		var atlas := AtlasTexture.new()
		atlas.atlas = texture
		atlas.region = Rect2(
			int(cell.get("column", 0)) * PROP_CELL_SIZE.x,
			int(cell.get("row", 0)) * PROP_CELL_SIZE.y,
			PROP_CELL_SIZE.x,
			PROP_CELL_SIZE.y,
		)
		atlas.filter_clip = true
		var sprite := Sprite2D.new()
		sprite.name = "Prop_%02d" % count
		sprite.texture = atlas
		sprite.centered = false
		sprite.scale = Vector2(0.62, 0.62)
		sprite.position = anchors[count] - Vector2(48, 96) * sprite.scale
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.set_meta("mapsoo_role", role)
		layer.add_child(sprite)
		count += 1
	return count


func _add_blocker() -> void:
	var collision_root := Node2D.new()
	collision_root.name = "WorldCollision"
	add_child(collision_root)
	var body := StaticBody2D.new()
	body.name = "RouteBlocker"
	body.position = Vector2(316, 264)
	body.set_meta("mapsoo_role", "prop.occluder")
	var collision := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = Vector2(32, 144)
	collision.shape = shape
	body.add_child(collision)
	collision_root.add_child(body)


func _add_collectible() -> void:
	var collectible_root := Node2D.new()
	collectible_root.name = "Collectibles"
	add_child(collectible_root)
	var area := Area2D.new()
	area.name = "PrimaryCollectible"
	area.position = Vector2(248, 286)
	area.set_meta("mapsoo_role", "collectible.primary")
	var collision := CollisionShape2D.new()
	var shape := CircleShape2D.new()
	shape.radius = 14
	collision.shape = shape
	area.add_child(collision)
	area.body_entered.connect(
		func(body: Node2D) -> void:
			if body.name == "Player":
				body.set_meta("mapsoo_last_collectible", "collectible.primary")
				area.set_deferred("monitoring", false)
	)
	collectible_root.add_child(area)


func _add_traversal() -> void:
	var nodes := [
		{"id": "spawn-node", "kind": "spawn", "position": Vector2(112, 286)},
		{"id": "npc-node", "kind": "npc", "position": Vector2(176, 286)},
		{"id": "collectible-node", "kind": "collectible", "position": Vector2(248, 286)},
		{"id": "stairs-node", "kind": "stairs", "position": Vector2(280, 174)},
		{"id": "bridge-entry-node", "kind": "bridge-entry", "position": Vector2(352, 174)},
		{"id": "bridge-exit-node", "kind": "bridge-exit", "position": Vector2(432, 174)},
		{"id": "exit-node", "kind": "exit", "position": Vector2(520, 174)},
	]
	var edges := [
		{"from": "spawn-node", "to": "npc-node"},
		{"from": "npc-node", "to": "collectible-node"},
		{"from": "collectible-node", "to": "stairs-node"},
		{"from": "stairs-node", "to": "bridge-entry-node"},
		{"from": "bridge-entry-node", "to": "bridge-exit-node"},
		{"from": "bridge-exit-node", "to": "exit-node"},
	]
	var traversal := Node2D.new()
	traversal.name = "WorldTraversal"
	traversal.set_meta("mapsoo_exit_node_id", "exit-node")
	traversal.set_meta("mapsoo_edges", edges)
	for item in nodes:
		var marker := Marker2D.new()
		marker.name = str(item.id).replace("-", "_")
		marker.position = item.position
		marker.set_meta("mapsoo_id", item.id)
		marker.set_meta("mapsoo_kind", item.kind)
		traversal.add_child(marker)
	add_child(traversal)


func _add_npc(
	actors: Node2D,
	texture: Texture2D,
	manifest: Dictionary,
) -> CharacterBody2D:
	var npc := CharacterBody2D.new()
	npc.name = "LanternKeeper"
	npc.position = Vector2(190, 286)
	npc.collision_layer = 0
	npc.collision_mask = 0
	npc.set_meta("mapsoo_character_id", "npc")
	npc.set_meta("mapsoo_role", "character.npc.atlas")
	var visual := _animated_visual(texture, manifest, "idle.left")
	if visual == null:
		return null
	npc.add_child(visual)
	actors.add_child(npc)
	return npc


func _add_player(
	actors: Node2D,
	texture: Texture2D,
	manifest: Dictionary,
) -> CharacterBody2D:
	var player := CharacterBody2D.new()
	player.name = "Player"
	player.set_script(PlayerController)
	player.position = Vector2(112, 286)
	player.collision_layer = 1
	player.collision_mask = 1
	player.set("world_bounds", Rect2(0, 0, VIEWPORT_SIZE.x, VIEWPORT_SIZE.y))
	player.set("movement_bounds", Rect2(32, 112, 576, 212))
	player.set("spawn_position", player.position)
	player.set("input_enabled", true)
	player.set("interaction_radius", 72.0)
	player.set("exit_radius", 24.0)
	player.set_meta("mapsoo_character_id", "player")
	var visual := _animated_visual(texture, manifest, "idle.near")
	if visual == null:
		return null
	player.add_child(visual)
	var collision := CollisionShape2D.new()
	collision.name = "CollisionShape2D"
	var capsule := CapsuleShape2D.new()
	capsule.radius = 7
	capsule.height = 26
	collision.shape = capsule
	collision.position = Vector2(0, -13)
	player.add_child(collision)
	var camera := Camera2D.new()
	camera.name = "Camera2D"
	player.add_child(camera)
	actors.add_child(player)
	return player


func _animated_visual(
	texture: Texture2D,
	manifest: Dictionary,
	initial_clip: String,
) -> AnimatedSprite2D:
	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	for value in manifest.get("clips", []) as Array:
		var clip := value as Dictionary
		var clip_id := str(clip.get("clip_id", ""))
		var animation := clip_id.replace(".", "_")
		if animation.is_empty() or frames.has_animation(animation):
			return null
		frames.add_animation(animation)
		frames.set_animation_loop(animation, bool(clip.get("loop", true)))
		frames.set_animation_speed(animation, float(clip.get("fps", 5)))
		for frame_value in clip.get("frames", []) as Array:
			var frame := frame_value as Dictionary
			var origin := frame.get("pixel_origin", {}) as Dictionary
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(
				int(origin.get("x", 0)),
				int(origin.get("y", 0)),
				CHARACTER_FRAME_SIZE.x,
				CHARACTER_FRAME_SIZE.y,
			)
			atlas.filter_clip = true
			frames.add_frame(animation, atlas)
	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = frames
	visual.animation = initial_clip.replace(".", "_")
	visual.offset = Vector2(0, -67)
	visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	visual.z_index = 10
	return visual


func _recorded_texture(
	path: String,
	record: Dictionary,
	expected_size: Vector2i,
) -> Texture2D:
	if path.is_empty() or not FileAccess.file_exists(path) \
			or FileAccess.get_sha256(path) != str(record.get("sha256", "")):
		_fail("Runtime art is missing or has a mismatched digest: %s" % path)
		return null
	var image := Image.new()
	if image.load_png_from_buffer(FileAccess.get_file_as_bytes(path)) != OK:
		_fail("Runtime art is not a valid PNG: %s" % path)
		return null
	if image.get_size() != expected_size \
			or image.get_width() != int(record.get("width", 0)) \
			or image.get_height() != int(record.get("height", 0)):
		_fail("Runtime art dimensions are stale: %s" % path)
		return null
	return ImageTexture.create_from_image(image)


func _load_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		_fail("Runtime manifest is missing: %s" % path)
		return {}
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK \
			or typeof(parser.data) != TYPE_DICTIONARY:
		_fail("Runtime manifest is invalid: %s" % path)
		return {}
	return parser.data as Dictionary


func _fail(message: String) -> bool:
	push_error(message)
	set_meta("mapsoo_runtime_error", message)
	return false


func _show_failure() -> void:
	var label := Label.new()
	label.position = Vector2(24, 96)
	label.text = "Production runtime candidate failed integrity validation."
	label.add_theme_color_override("font_color", Color(1.0, 0.45, 0.4))
	add_child(label)
