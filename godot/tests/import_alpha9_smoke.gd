extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_MANIFEST := "res://tests/.generated/pack-alpha9/mapsoo.manifest.json"
const EXPECTED_ANIMATIONS := [
	"idle_north", "idle_east", "idle_south", "idle_west",
	"walk_north", "walk_east", "walk_south", "walk_west",
]


func _init() -> void:
	var manifest_path := _argument_value("--manifest=")
	if manifest_path.is_empty():
		manifest_path = DEFAULT_MANIFEST
	var manifest := _read_json(manifest_path)
	if manifest.is_empty() or manifest.get("schema_version") != "0.6.0":
		_fail("Pack 0.6 fixture manifest is missing or invalid: %s" % manifest_path)
		return
	var scene_ref: Dictionary = (manifest.get("runtime", {}) as Dictionary).get("scene", {})
	var scene_sidecar := _read_json(manifest_path.get_base_dir().path_join(str(scene_ref.get("path", ""))))
	if scene_sidecar.is_empty():
		_fail("Pack 0.6 scene sidecar is missing.")
		return

	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	var first_status := str(result.get("status", ""))
	if result.get("ok", false) != true or first_status not in ["created", "unchanged"]:
		_fail("First Pack 0.6 import must be created or unchanged: %s" % result)
		return
	var scene_path := str(result.get("scene_path", ""))
	var tileset_path := str(result.get("tileset_path", ""))
	var state_path := str(result.get("state_path", ""))
	if not ResourceLoader.exists(scene_path, "PackedScene") or not ResourceLoader.exists(tileset_path, "TileSet") or not FileAccess.file_exists(state_path):
		_fail("Pack 0.6 importer did not create all three managed resources.")
		return
	var tile_set := ResourceLoader.load(tileset_path, "TileSet", ResourceLoader.CACHE_MODE_IGNORE) as TileSet
	var tile_atlas := tile_set.get_source(0) as TileSetAtlasSource if tile_set != null else null
	if tile_atlas == null or not _texture_has_persisted_pixels(tile_atlas.texture):
		_fail("Pack 0.6 standalone TileSet lost its persisted terrain pixels.")
		return
	var packed := ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null:
		_fail("Pack 0.6 scene is not loadable: %s" % scene_path)
		return
	var world := packed.instantiate()
	var error := _world_error(world, manifest, scene_sidecar)
	world.free()
	if not error.is_empty():
		_fail(error)
		return

	var managed_paths := [tileset_path, scene_path, state_path]
	var before_bytes := {}
	var before_mtimes := {}
	for path: String in managed_paths:
		before_bytes[path] = FileAccess.get_file_as_bytes(path)
		before_mtimes[path] = FileAccess.get_modified_time(path)
	OS.delay_msec(1100)
	var repeated: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	if repeated.get("ok", false) != true or repeated.get("status", "") != "unchanged":
		_fail("Second Pack 0.6 import must be unchanged: %s" % repeated)
		return
	for path: String in managed_paths:
		if FileAccess.get_file_as_bytes(path) != before_bytes[path] or FileAccess.get_modified_time(path) != before_mtimes[path]:
			_fail("Unchanged Pack 0.6 import rewrote %s." % path)
			return
	print("MAPSOO_ALPHA9_GODOT_OK pack_id=%s schema=0.6.0 first=%s second=unchanged layers=7 crops=4 animations=8" % [manifest.pack.id, first_status])
	quit(0)


func _world_error(world: Node, manifest: Dictionary, scene_sidecar: Dictionary) -> String:
	if world.name != "MapsooWorld":
		return "Pack 0.6 scene root must be MapsooWorld."
	for layer_name: String in ["Ground", "Water", "Paths", "Soil"]:
		var layer := world.get_node_or_null(layer_name) as TileMapLayer
		if layer == null:
			return "Pack 0.6 scene is missing %s: TileMapLayer." % layer_name
		if layer_name in ["Ground", "Soil"] and layer.get_used_cells().is_empty():
			return "Pack 0.6 %s layer must contain cells." % layer_name
	var collection_contract := {
		"Props": scene_sidecar.get("props", []),
		"Structures": scene_sidecar.get("structures", []),
		"Crops": scene_sidecar.get("crops", []),
	}
	for root_name: String in collection_contract:
		var collection := world.get_node_or_null(root_name) as Node2D
		var expected: Array = collection_contract[root_name]
		if collection == null or collection.get_child_count() != expected.size():
			return "Pack 0.6 %s count differs from the generated scene sidecar." % root_name
		var actual_roles: Array[String] = []
		for child: Node in collection.get_children():
			if not (child is Sprite2D) or not child.has_meta("mapsoo_role"):
				return "Pack 0.6 %s child is not a role-bound Sprite2D." % root_name
			actual_roles.append(str(child.get_meta("mapsoo_role")))
		var expected_roles: Array[String] = []
		for item: Variant in expected:
			expected_roles.append(str((item as Dictionary).get("role", "")))
		actual_roles.sort()
		expected_roles.sort()
		if actual_roles != expected_roles:
			return "Pack 0.6 %s roles differ from the generated scene sidecar." % root_name
	var structure_roles := _child_roles(world.get_node("Structures"))
	var crop_roles := _child_roles(world.get_node("Crops"))
	if structure_roles != ["structure.barn", "structure.house"]:
		return "Pack 0.6 fixture must materialize house and barn."
	if crop_roles != ["crop.basic.stage-1", "crop.basic.stage-2", "crop.basic.stage-3", "crop.basic.stage-4"]:
		return "Pack 0.6 fixture must materialize all four crop stages."

	var navigation := world.get_node_or_null("WorldNavigation") as NavigationRegion2D
	if navigation == null or navigation.navigation_polygon == null or navigation.navigation_polygon.get_outline_count() < 1:
		return "Pack 0.6 scene is missing a usable WorldNavigation polygon."
	var spawn := world.get_node_or_null("PlayerSpawn") as Marker2D
	var spawn_data: Dictionary = scene_sidecar.get("spawn", {})
	var tile_size := int(((scene_sidecar.get("map", {}) as Dictionary).get("tileSize", 0)))
	var expected_spawn := Vector2((float(spawn_data.get("x", -1)) + 0.5) * tile_size, (float(spawn_data.get("y", -1)) + 0.5) * tile_size)
	if spawn == null or spawn.position != expected_spawn:
		return "Pack 0.6 PlayerSpawn differs from the generated scene sidecar."
	var player := world.get_node_or_null("Player") as CharacterBody2D
	var visual := world.get_node_or_null("Player/Visual") as AnimatedSprite2D
	var collision := world.get_node_or_null("Player/CollisionShape2D") as CollisionShape2D
	var camera := world.get_node_or_null("Player/Camera2D") as Camera2D
	if player == null or player.position != expected_spawn or player.get_script() != PlayerController or player.get("mapsoo_profile") != "topdown-farm" or player.get("world_bounds") != Rect2(0, 0, 512, 384) or visual == null or visual.sprite_frames == null or collision == null or collision.shape == null or camera == null:
		return "Pack 0.6 playable Player hierarchy or spawn position is incomplete."
	var manifest_clips: Array = (manifest.get("character", {}) as Dictionary).get("clips", [])
	if manifest_clips.size() != EXPECTED_ANIMATIONS.size():
		return "Pack 0.6 manifest must contain exactly eight character clips."
	for animation_name: String in EXPECTED_ANIMATIONS:
		if not visual.sprite_frames.has_animation(animation_name) or visual.sprite_frames.get_frame_count(animation_name) < 1:
			return "Pack 0.6 Player is missing animation %s." % animation_name
		for frame_index: int in visual.sprite_frames.get_frame_count(animation_name):
			if not _texture_has_persisted_pixels(visual.sprite_frames.get_frame_texture(animation_name, frame_index)):
				return "Pack 0.6 reloaded Player animation %s lost its atlas pixels." % animation_name
	if not _sprite_textures_have_persisted_pixels(world):
		return "Pack 0.6 reloaded scene contains a Sprite2D without persisted pixels."
	return ""


func _sprite_textures_have_persisted_pixels(node: Node) -> bool:
	if node is Sprite2D and not _texture_has_persisted_pixels((node as Sprite2D).texture):
		return false
	for child: Node in node.get_children():
		if not _sprite_textures_have_persisted_pixels(child):
			return false
	return true


func _texture_has_persisted_pixels(value: Texture2D) -> bool:
	var texture := value
	if texture is AtlasTexture:
		texture = (texture as AtlasTexture).atlas
	if texture == null:
		return false
	var image := texture.get_image()
	return image != null and not image.is_empty() and not image.get_data().is_empty()


func _child_roles(root: Node) -> Array[String]:
	var roles: Array[String] = []
	for child: Node in root.get_children():
		roles.append(str(child.get_meta("mapsoo_role", "")))
	roles.sort()
	return roles


func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
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
	push_error("MAPSOO_ALPHA9_GODOT_FAILURE: %s" % message)
	quit(1)
