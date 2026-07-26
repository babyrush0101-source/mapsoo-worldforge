extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const DEFAULT_MANIFEST := "res://tests/.generated/pack-alpha10/mapsoo.manifest.json"
const CLIPS := [
	"idle_left", "idle_right", "run_left", "run_right", "jump_left", "jump_right",
	"fall_left", "fall_right", "land_left", "land_right", "hurt_left", "hurt_right",
]


func _init() -> void:
	var manifest_path := _argument_value("--manifest=")
	if manifest_path.is_empty(): manifest_path = DEFAULT_MANIFEST
	var manifest := _read_json(manifest_path)
	if manifest.get("schema_version") != "0.7.0": _fail("Pack 0.7 fixture manifest is missing or invalid: %s" % manifest_path); return
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	var first_status := str(result.get("status", ""))
	if result.get("ok", false) != true or first_status not in ["created", "updated", "unchanged"]: _fail("First Pack 0.7 import failed: %s" % result); return
	var scene_path := str(result.get("scene_path", "")); var tileset_path := str(result.get("tileset_path", "")); var state_path := str(result.get("state_path", ""))
	if not ResourceLoader.exists(scene_path, "PackedScene") or not ResourceLoader.exists(tileset_path, "TileSet") or not FileAccess.file_exists(state_path): _fail("Pack 0.7 importer did not create all managed resources."); return
	var packed := ResourceLoader.load(scene_path, "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null: _fail("Pack 0.7 scene is not loadable."); return
	var world := packed.instantiate(); var error := _world_error(world); world.free()
	if not error.is_empty(): _fail(error); return
	var paths := [tileset_path, scene_path, state_path]; var bytes := {}; var mtimes := {}
	for path: String in paths: bytes[path] = FileAccess.get_file_as_bytes(path); mtimes[path] = FileAccess.get_modified_time(path)
	var negative_error := _negative_contracts(manifest_path, paths, bytes)
	if not negative_error.is_empty(): _fail(negative_error); return
	OS.delay_msec(1100)
	var repeated: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	if repeated.get("ok", false) != true or repeated.get("status", "") != "unchanged": _fail("Second Pack 0.7 import must be unchanged: %s" % repeated); return
	for path: String in paths:
		if FileAccess.get_file_as_bytes(path) != bytes[path] or FileAccess.get_modified_time(path) != mtimes[path]: _fail("Unchanged Pack 0.7 import rewrote %s." % path); return
	print("MAPSOO_ALPHA10_GODOT_OK pack_id=%s schema=0.7.0 first=%s second=unchanged negative=7 layers=5 placements=4 surfaces=3 hazards=2 nodes=3 edges=2 animations=12" % [manifest.pack.id, first_status])
	quit(0)


func _negative_contracts(manifest_path: String, managed_paths: Array, managed_bytes: Dictionary) -> String:
	var manifest_bytes := FileAccess.get_file_as_bytes(manifest_path)
	var manifest := _read_json(manifest_path)
	manifest["unexpected"] = true
	_write_json(manifest_path, manifest)
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	var error := _negative_error("extra manifest field", result, "canonical fields", managed_paths, managed_bytes)
	_write_bytes(manifest_path, manifest_bytes)
	if not error.is_empty(): return error

	manifest = _read_json(manifest_path); manifest.pack.id = "bad_pack_id"; _write_json(manifest_path, manifest)
	result = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	error = _negative_error("underscore pack ID", result, "kebab-case", managed_paths, managed_bytes)
	_write_bytes(manifest_path, manifest_bytes)
	if not error.is_empty(): return error

	manifest = _read_json(manifest_path); manifest.files[0].bytes = 0; _write_json(manifest_path, manifest)
	result = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	error = _negative_error("zero-byte file record", result, "byte", managed_paths, managed_bytes)
	_write_bytes(manifest_path, manifest_bytes)
	if not error.is_empty(): return error

	error = _sidecar_negative(manifest_path, "runtime/scene.json", func(sidecar: Dictionary) -> void: sidecar.placements[0].role = "world.scene", "placement", managed_paths, managed_bytes)
	if not error.is_empty(): return error
	error = _sidecar_negative(manifest_path, "runtime/scene.json", func(sidecar: Dictionary) -> void: sidecar.unexpected = true, "canonical fields", managed_paths, managed_bytes)
	if not error.is_empty(): return error
	error = _sidecar_negative(manifest_path, "runtime/navigation.json", func(sidecar: Dictionary) -> void: sidecar.edges = [sidecar.edges[0]], "unreachable", managed_paths, managed_bytes)
	if not error.is_empty(): return error
	error = _sidecar_negative(manifest_path, "runtime/scene.json", func(sidecar: Dictionary) -> void: sidecar.bounds.x = -1, "bounds", managed_paths, managed_bytes)
	return error


func _sidecar_negative(manifest_path: String, relative_path: String, mutate: Callable, expected: String, managed_paths: Array, managed_bytes: Dictionary) -> String:
	var sidecar_path := manifest_path.get_base_dir().path_join(relative_path)
	var original := FileAccess.get_file_as_bytes(sidecar_path); var manifest_original := FileAccess.get_file_as_bytes(manifest_path)
	var sidecar := _read_json(sidecar_path); mutate.call(sidecar); _write_json(sidecar_path, sidecar)
	var manifest := _read_json(manifest_path); var digest := _sha256(sidecar_path); var size := FileAccess.get_file_as_bytes(sidecar_path).size()
	for record: Dictionary in manifest.files:
		if record.path == relative_path: record.bytes = size; record.sha256 = digest
	_write_json(manifest_path, manifest)
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	var error := _negative_error(relative_path, result, expected, managed_paths, managed_bytes)
	_write_bytes(sidecar_path, original); _write_bytes(manifest_path, manifest_original)
	return error


func _negative_error(label: String, result: Dictionary, expected: String, managed_paths: Array, managed_bytes: Dictionary) -> String:
	if result.get("ok", true) != false: return "%s must fail closed: %s" % [label, result]
	if not " ".join(result.get("errors", [])).to_lower().contains(expected.to_lower()): return "%s must report %s: %s" % [label, expected, result]
	for path: String in managed_paths:
		if FileAccess.get_file_as_bytes(path) != managed_bytes[path]: return "%s changed managed output %s." % [label, path]
	return ""


func _world_error(world: Node) -> String:
	if world.name != "MapsooWorld" or world.get_meta("mapsoo_profile", "") != "side-platformer": return "Pack 0.7 root metadata is invalid."
	var parallax_scales := {"BackgroundFar": Vector2(0.12, 0.08), "BackgroundMid": Vector2(0.35, 0.2), "BackgroundNear": Vector2(0.62, 0.38), "Foreground": Vector2(1.08, 1.0)}
	for name: String in parallax_scales:
		var parallax := world.get_node_or_null(name) as Parallax2D
		if parallax == null or parallax.scroll_scale != parallax_scales[name] or parallax.repeat_size != Vector2(1280, 720): return "Pack 0.7 scene is missing configured parallax layer %s." % name
	if not (world.get_node_or_null("World") is Node2D): return "Pack 0.7 scene is missing its gameplay layer."
	if world.get_node("BackgroundFar").get_child_count() != 2 or world.get_node("BackgroundMid").get_child_count() != 1 or world.get_node("BackgroundNear").get_child_count() != 1 or world.get_node("Foreground").get_child_count() != 1: return "Pack 0.7 background/foreground assets are incomplete."
	var world_layer := world.get_node("World") as Node2D
	var roles: Array[String] = []
	for child: Node in world_layer.get_children():
		if child is Sprite2D and child.has_meta("mapsoo_id") and child.has_meta("mapsoo_role"):
			roles.append(str(child.get_meta("mapsoo_role")))
	roles.sort()
	if roles != ["hazard.spikes", "structure.checkpoint", "structure.entrance", "structure.exit"]: return "Pack 0.7 canonical fixture placements are missing."
	var spike := world_layer.get_node_or_null("Spikes") as Sprite2D
	if spike == null or spike.get_meta("mapsoo_rect", Rect2i()) != Rect2i(720, 584, 64, 24): return "Pack 0.7 spike art is not bound to its hazard rectangle."
	var spike_size := spike.get_rect().size * spike.scale
	if spike.position - spike_size * 0.5 != Vector2(720, 584) or spike_size != Vector2(64, 24): return "Pack 0.7 spike art and collision pixels do not align."
	var collision := world.get_node_or_null("WorldCollision") as Node2D
	if collision == null or collision.get_child_count() != 3: return "Pack 0.7 collision surfaces are incomplete."
	var one_way := 0
	for body: Node in collision.get_children():
		var shape := body.get_node_or_null("CollisionShape2D") as CollisionShape2D
		if not (body is StaticBody2D) or shape == null or not (shape.shape is RectangleShape2D): return "Pack 0.7 surface collision is invalid."
		if shape.one_way_collision: one_way += 1
	if one_way != 1: return "Pack 0.7 fixture must contain one one-way platform."
	var terrain_visuals := world.get_node_or_null("World/TerrainVisuals") as Node2D
	if terrain_visuals == null or terrain_visuals.get_child_count() != collision.get_child_count(): return "Pack 0.7 visible terrain does not match collision surfaces."
	for child: Node in terrain_visuals.get_children():
		if not (child is Sprite2D) or not child.has_meta("mapsoo_rect") or not child.has_meta("mapsoo_role"): return "Pack 0.7 terrain visual is not bound to a collision rectangle."
	var hazards := world.get_node_or_null("Hazards") as Node2D
	if hazards == null or hazards.get_child_count() != 2: return "Pack 0.7 hazard areas are incomplete."
	var graph := world.get_node_or_null("WorldTraversal") as Node2D
	if graph == null or graph.get_child_count() != 3 or not graph.has_meta("mapsoo_edges") or (graph.get_meta("mapsoo_edges") as Array).size() != 2 or graph.get_meta("mapsoo_exit_node_id", "") != "exit-node": return "Pack 0.7 traversal graph is incomplete."
	var spawn := world.get_node_or_null("PlayerSpawn") as Marker2D; var player := world.get_node_or_null("Player") as CharacterBody2D; var visual := world.get_node_or_null("Player/Visual") as AnimatedSprite2D; var shape := world.get_node_or_null("Player/CollisionShape2D") as CollisionShape2D; var camera := world.get_node_or_null("Player/Camera2D") as Camera2D
	if spawn == null or spawn.position != Vector2(64, 608) or player == null or player.position != spawn.position or player.get_script() != PlayerController or player.get("mapsoo_profile") != "side-platformer" or player.get("world_bounds") != Rect2(0, 0, 1280, 720) or visual == null or visual.sprite_frames == null or shape == null or not (shape.shape is CapsuleShape2D) or camera == null: return "Pack 0.7 playable player hierarchy is incomplete."
	for clip: String in CLIPS:
		if not visual.sprite_frames.has_animation(clip) or visual.sprite_frames.get_frame_count(clip) != 1: return "Pack 0.7 player is missing animation %s." % clip
		for frame_index: int in visual.sprite_frames.get_frame_count(clip):
			if not _texture_has_persisted_pixels(visual.sprite_frames.get_frame_texture(clip, frame_index)): return "Pack 0.7 reloaded player animation %s lost its atlas pixels." % clip
	if not _sprite_textures_have_persisted_pixels(world): return "Pack 0.7 reloaded scene contains a Sprite2D without persisted pixels."
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


func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path): return {}
	var parser := JSON.new(); if parser.parse(FileAccess.get_file_as_string(path)) != OK or typeof(parser.data) != TYPE_DICTIONARY: return {}
	return parser.data as Dictionary


func _write_json(path: String, value: Variant) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE); file.store_string(JSON.stringify(value, "  ", false) + "\n"); file.close()


func _write_bytes(path: String, bytes: PackedByteArray) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE); file.store_buffer(bytes); file.close()


func _sha256(path: String) -> String:
	var context := HashingContext.new(); context.start(HashingContext.HASH_SHA256); context.update(FileAccess.get_file_as_bytes(path)); return context.finish().hex_encode()


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix): return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	push_error("MAPSOO_ALPHA10_GODOT_FAILURE: %s" % message); quit(1)
