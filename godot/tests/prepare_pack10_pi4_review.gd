extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"
const GRANT_ID := "pi4-pack10-review-prepare"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var version := Engine.get_version_info()
	if int(version.get("major", 0)) != 4 or int(version.get("minor", 0)) != 3:
		_fail("Pack 1.0 Pi review artifacts must be serialized by pinned Godot 4.3.")
		return
	var manifest_path := _argument_value("--manifest=")
	if manifest_path.is_empty():
		_fail("Pass --manifest=<absolute-or-res-path>.")
		return
	var manifest := _read_json(manifest_path)
	var pack: Dictionary = manifest.get("pack", {})
	var pack_id := str(pack.get("id", ""))
	if manifest.get("schema_version") != "1.0.0-draft.1" \
			or manifest.get("profile") != "layered-depth-2d" \
			or manifest.get("distribution") != "internal-review" \
			or pack_id.is_empty():
		_fail("Pack 1.0 Pi review candidate identity is invalid.")
		return
	var grant := {
		"decision": "allow",
		"distribution": "internal-review",
		"pack_id": pack_id,
		"grant_id": GRANT_ID,
	}
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT, grant)
	var status := str(result.get("status", ""))
	if result.get("ok", false) != true or status not in ["created", "unchanged"]:
		_fail("Pack 1.0 Pi review import failed: %s" % result.get("errors", []))
		return
	var scene_path := str(result.get("scene_path", ""))
	var tileset_path := str(result.get("tileset_path", ""))
	var state_path := str(result.get("state_path", ""))
	var expected_root := "%s/%s" % [OUTPUT_ROOT, pack_id]
	if scene_path != "%s/%s.world.tscn" % [expected_root, pack_id] \
			or tileset_path != "%s/%s.tileset.tres" % [expected_root, pack_id] \
			or state_path != "%s/mapsoo.import-state.json" % expected_root:
		_fail("Pack 1.0 Pi review output paths are not canonical.")
		return
	var packed := ResourceLoader.load(
		scene_path,
		"PackedScene",
		ResourceLoader.CACHE_MODE_IGNORE_DEEP,
	) as PackedScene
	if packed == null:
		_fail("Prepared Pack 1.0 scene is not loadable.")
		return
	var world := packed.instantiate()
	var props := world.get_node_or_null("YSortedGameplay/Props") as Node2D
	var player := world.get_node_or_null("YSortedGameplay/Actors/Player") as CharacterBody2D
	var npc := world.get_node_or_null("YSortedGameplay/Actors/Npc") as CharacterBody2D
	var collision := world.get_node_or_null("WorldCollision") as Node2D
	var navigation := world.get_node_or_null("WorldNavigation") as NavigationRegion2D
	if world.get_meta("mapsoo_schema_version", "") != "1.0.0-draft.1" \
			or world.get_meta("mapsoo_profile", "") != "layered-depth-2d" \
			or world.get_meta("mapsoo_distribution", "") != "internal-review" \
			or world.get_meta("mapsoo_output_license", "") != "LicenseRef-UNRELEASED" \
			or world.get_meta("mapsoo_authorization_grant", "") != GRANT_ID \
			or props == null or player == null or npc == null \
			or collision == null or navigation == null:
		world.free()
		_fail("Prepared Pack 1.0 scene contract is incomplete.")
		return
	var runtime_scene_path := manifest_path.get_base_dir().path_join(
		str((manifest.get("runtime", {}) as Dictionary).get("scene", {}).get("path", "")),
	)
	var runtime_scene := _read_json(runtime_scene_path)
	var expected_props := 0
	for placement_value: Variant in runtime_scene.get("placements", []) as Array:
		var placement := placement_value as Dictionary
		var role := str(placement.get("role", ""))
		if role in ["character.player.atlas", "character.npc.atlas"]:
			continue
		expected_props += 1
		var sprite := _sprite_for_id(props, str(placement.get("id", "")))
		if sprite == null or sprite.get_meta("mapsoo_role", "") != role \
				or sprite.centered != true:
			world.free()
			_fail("Prepared production placement is invalid: %s." % role)
			return
	if props.get_child_count() != expected_props \
			or not _character_ok(player, 16) \
			or not _character_ok(npc, 8):
		world.free()
		_fail("Prepared production inventory is incomplete.")
		return
	world.free()
	var state := _read_json(state_path)
	var importer: Dictionary = state.get("importer", {})
	var generated_files: Dictionary = state.get("generated_files", {})
	if state.get("pack_id") != pack_id \
			or state.get("manifest_sha256") != FileAccess.get_sha256(manifest_path) \
			or importer.get("id") != "mapsoo_importer" \
			or importer.get("version") != "1.0.0" \
			or generated_files.get("%s.world.tscn" % pack_id) \
				!= FileAccess.get_sha256(scene_path) \
			or generated_files.get("%s.tileset.tres" % pack_id) \
				!= FileAccess.get_sha256(tileset_path):
		_fail("Prepared Pack 1.0 import state is not bound to its exact artifacts.")
		return
	print(
		"MAPSOO_PACK10_PI4_PREPARE_OK"
		+ " pack_id=%s status=%s" % [pack_id, status]
		+ " manifest_sha256=%s" % FileAccess.get_sha256(manifest_path)
		+ " scene_sha256=%s" % FileAccess.get_sha256(scene_path)
		+ " tileset_sha256=%s" % FileAccess.get_sha256(tileset_path)
		+ " state_sha256=%s" % FileAccess.get_sha256(state_path),
	)
	quit(0)


func _sprite_for_id(root: Node2D, id: String) -> Sprite2D:
	for child: Node in root.get_children():
		if child is Sprite2D and child.get_meta("mapsoo_id", "") == id:
			return child as Sprite2D
	return null


func _character_ok(actor: CharacterBody2D, clip_count: int) -> bool:
	var visual := actor.get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.sprite_frames == null \
			or visual.sprite_frames.get_animation_names().size() != clip_count:
		return false
	for animation: StringName in visual.sprite_frames.get_animation_names():
		if visual.sprite_frames.get_frame_count(animation) != 2:
			return false
	return true


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _read_json(path: String) -> Dictionary:
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK \
			or typeof(parser.data) != TYPE_DICTIONARY:
		_fail("Unable to read strict JSON: %s." % path)
		return {}
	return parser.data as Dictionary


func _fail(message: String) -> void:
	push_error("MAPSOO_PACK10_PI4_PREPARE_FAILURE: %s" % message)
	quit(1)
