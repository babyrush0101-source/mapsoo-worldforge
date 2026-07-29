extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_layered_depth_player_controller.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_MANIFEST := "res://tests/.generated/pack-alpha12/mapsoo.manifest.json"
const DIRECTIONS := ["left", "right", "near", "far"]
const PLAYER_ACTIONS := ["idle", "walk", "run", "interact"]
const NPC_ACTIONS := ["idle", "talk"]
const PLANE_NODES := [
	"SkyParallax", "FarParallax", "MidParallax", "DepthFogParallax",
	"NearParallax", "AmbientLightParallax", "ForegroundParallax",
]


func _init() -> void:
	var manifest_path := _argument_value("--manifest=")
	if manifest_path.is_empty():
		manifest_path = DEFAULT_MANIFEST
	var manifest := _read_json(manifest_path)
	if manifest.get("schema_version") != "0.9.0":
		_fail("Pack 0.9 fixture manifest is missing or invalid: %s" % manifest_path)
		return
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	var first_status := str(result.get("status", ""))
	if result.get("ok", false) != true or first_status not in ["created", "updated", "unchanged"]:
		_fail("First Pack 0.9 import failed: %s" % result)
		return
	var scene_path := str(result.get("scene_path", ""))
	var tileset_path := str(result.get("tileset_path", ""))
	var state_path := str(result.get("state_path", ""))
	if not ResourceLoader.exists(scene_path, "PackedScene") or not ResourceLoader.exists(tileset_path, "TileSet") or not FileAccess.file_exists(state_path):
		_fail("Pack 0.9 importer did not create all managed resources.")
		return
	var packed := ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null:
		_fail("Pack 0.9 scene is not loadable.")
		return
	var world := packed.instantiate()
	var error := _world_error(world)
	world.free()
	if not error.is_empty():
		_fail(error)
		return
	var repeated: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	if repeated.get("ok", false) != true or repeated.get("status", "") != "unchanged":
		_fail("Second Pack 0.9 import must be unchanged: %s" % repeated)
		return
	print("MAPSOO_ALPHA12_GODOT_OK pack_id=%s schema=0.9.0 first=%s second=unchanged roles=36 planes=7 characters=2 animations=24 ysort=true parallax=true navigation=true" % [manifest.pack.id, first_status])
	quit(0)


func _world_error(world: Node) -> String:
	if world.name != "MapsooWorld" or world.get_meta("mapsoo_profile", "") != "layered-depth-2d" or world.get_meta("mapsoo_schema_version", "") != "0.9.0":
		return "Pack 0.9 root metadata is invalid."
	var ysorted := world.get_node_or_null("YSortedGameplay") as Node2D
	if ysorted == null or ysorted.get_parent() != world or not ysorted.y_sort_enabled:
		return "Pack 0.9 direct Y-sorted gameplay domain is missing."
	for plane_path: String in PLANE_NODES:
		var plane := world.get_node_or_null(plane_path) as Parallax2D
		var visual := world.get_node_or_null("%s/Visual" % plane_path) as Sprite2D
		if plane == null or visual == null or not _texture_has_persisted_pixels(visual.texture):
			return "Pack 0.9 depth plane is missing or lost pixels: %s." % plane_path
	var far := world.get_node("FarParallax") as Parallax2D
	var mid := world.get_node("MidParallax") as Parallax2D
	var near := world.get_node("NearParallax") as Parallax2D
	if far.scroll_scale != Vector2(0.12, 0.04) or mid.scroll_scale != Vector2(0.32, 0.12) or near.scroll_scale != Vector2(0.82, 0.42):
		return "Pack 0.9 far/mid/near parallax ratios are invalid."
	if not (world.get_node_or_null("AmbientCanvasModulate") is CanvasModulate) or not (world.get_node_or_null("Lighting") is Node2D):
		return "Pack 0.9 bounded lighting domain is missing."
	var player := world.get_node_or_null("YSortedGameplay/Actors/Player") as CharacterBody2D
	var npc := world.get_node_or_null("YSortedGameplay/Actors/Npc") as CharacterBody2D
	if player == null or player.get_script() != PlayerController or npc == null:
		return "Pack 0.9 player/NPC hierarchy is incomplete."
	for actor: CharacterBody2D in [player, npc]:
		var visual := actor.get_node_or_null("Visual") as AnimatedSprite2D
		if visual == null or visual.sprite_frames == null:
			return "Pack 0.9 actor visual is missing."
		var actions := PLAYER_ACTIONS if actor == player else NPC_ACTIONS
		for action: String in actions:
			for direction: String in DIRECTIONS:
				var clip := "%s_%s" % [action, direction]
				if not visual.sprite_frames.has_animation(clip) or visual.sprite_frames.get_frame_count(clip) != 1:
					return "Pack 0.9 actor is missing clip %s." % clip
				if not _texture_has_persisted_pixels(visual.sprite_frames.get_frame_texture(clip, 0)):
					return "Pack 0.9 actor clip lost persisted pixels: %s." % clip
	var navigation := world.get_node_or_null("WorldNavigation") as NavigationRegion2D
	if navigation == null or navigation.navigation_polygon == null or navigation.navigation_polygon.get_polygon_count() < 1:
		return "Pack 0.9 navigation corridor is incomplete."
	var traversal := world.get_node_or_null("WorldTraversal") as Node2D
	if traversal == null or traversal.get_child_count() != 6 or traversal.get_meta("mapsoo_exit_node_id", "") != "exit-node":
		return "Pack 0.9 traversal graph is incomplete."
	if not (world.get_node_or_null("WorldCollision") is Node2D) or world.get_node("WorldCollision").get_child_count() < 2:
		return "Pack 0.9 corridor boundaries/blockers are incomplete."
	if not (world.get_node_or_null("Hazards") is Node2D) or world.get_node("Hazards").get_child_count() != 1:
		return "Pack 0.9 hazards are incomplete."
	return ""


func _texture_has_persisted_pixels(value: Texture2D) -> bool:
	var texture := value
	if texture is AtlasTexture:
		texture = (texture as AtlasTexture).atlas
	if texture == null:
		return false
	var image := texture.get_image()
	return image != null and not image.is_empty() and not image.get_data().is_empty()


func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path): return {}
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK or typeof(parser.data) != TYPE_DICTIONARY:
		return {}
	return parser.data as Dictionary


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	push_error("MAPSOO_ALPHA12_GODOT_FAILURE: %s" % message)
	quit(1)
