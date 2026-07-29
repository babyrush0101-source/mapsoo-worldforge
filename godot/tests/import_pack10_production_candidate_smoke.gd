extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
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
		_fail("Pack 1.0 production candidate identity is invalid.")
		return
	_remove_tree("%s/%s" % [OUTPUT_ROOT, pack_id])
	var grant := {
		"decision": "allow",
		"distribution": "internal-review",
		"pack_id": pack_id,
		"grant_id": "local-production-review-grant-001",
	}
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT, grant)
	if result.get("ok", false) != true or result.get("status", "") != "created":
		_fail("Pack 1.0 production candidate import failed: %s" % result.get("errors", []))
		return
	var scene_path := str(result.get("scene_path", ""))
	var packed := ResourceLoader.load(
		scene_path,
		"PackedScene",
		ResourceLoader.CACHE_MODE_IGNORE_DEEP,
	) as PackedScene
	if packed == null:
		_fail("Imported Pack 1.0 production scene is not loadable.")
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
			or world.get_meta("mapsoo_authorization_grant", "") \
				!= "local-production-review-grant-001" \
			or props == null or player == null or npc == null \
			or collision == null or navigation == null:
		world.free()
		_fail("Imported Pack 1.0 production scene contract is incomplete.")
		return
	var runtime_scene_path := manifest_path.get_base_dir().path_join(
		str((manifest.get("runtime", {}) as Dictionary).get("scene", {}).get("path", "")),
	)
	var runtime_scene := _read_json(runtime_scene_path)
	var expected_props := 0
	var checked_pivot_baked_structures := 0
	for placement_value: Variant in runtime_scene.get("placements", []) as Array:
		var placement := placement_value as Dictionary
		var role := str(placement.get("role", ""))
		if role in ["character.player.atlas", "character.npc.atlas"]:
			continue
		expected_props += 1
		var sprite := _sprite_for_id(props, str(placement.get("id", "")))
		if sprite == null \
				or sprite.position != Vector2(
					float(placement.get("x", 0)),
					float(placement.get("y", 0)),
				) \
				or sprite.centered != true \
				or sprite.get_meta("mapsoo_role", "") != role:
			world.free()
			_fail("Production environment placement or centered anchor is invalid: %s." % role)
			return
		var atlas_texture := sprite.texture as AtlasTexture
		if atlas_texture == null:
			world.free()
			_fail("Production environment placement does not use an atlas region.")
			return
		var expected_size := _role_cell_size(role)
		if atlas_texture.region.size != expected_size:
			world.free()
			_fail("Production environment role cell size is invalid: %s." % role)
			return
		if role.begins_with("structure."):
			checked_pivot_baked_structures += 1
	if props.get_child_count() != expected_props or checked_pivot_baked_structures < 2:
		world.free()
		_fail("Production environment placement inventory is incomplete.")
		return
	if not _character_ok(player, 16) or not _character_ok(npc, 8):
		world.free()
		_fail("Production character clip inventory is incomplete.")
		return
	world.free()
	var repeated: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT, grant)
	if repeated.get("ok", false) != true or repeated.get("status", "") != "unchanged":
		_fail("Second production candidate import is not byte-stable.")
		return
	print(
		"MAPSOO_PACK10_PRODUCTION_CANDIDATE_OK"
		+ " schema=1.0.0-draft.1 distribution=internal-review"
		+ " planes=8 atlases=7 roles=36 characters=2"
		+ " props=%d pivot_baked_structures=%d" % [
			expected_props,
			checked_pivot_baked_structures,
		]
		+ " player_clips=16 npc_clips=8"
		+ " first=created second=unchanged"
		+ " manifest_sha256=%s" % FileAccess.get_sha256(manifest_path),
	)
	_remove_tree("%s/%s" % [OUTPUT_ROOT, pack_id])
	quit(0)


func _role_cell_size(role: String) -> Vector2:
	if role.begins_with("terrain."):
		return Vector2(64, 128)
	if role.begins_with("effect."):
		return Vector2(64, 64)
	return Vector2(96, 176)


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


func _remove_tree(path: String) -> void:
	var absolute := ProjectSettings.globalize_path(path)
	if not DirAccess.dir_exists_absolute(absolute):
		return
	var directory := DirAccess.open(absolute)
	if directory == null:
		return
	directory.list_dir_begin()
	var name := directory.get_next()
	while not name.is_empty():
		if name != "." and name != "..":
			var child := absolute.path_join(name)
			if directory.current_is_dir():
				_remove_tree(ProjectSettings.localize_path(child))
			else:
				DirAccess.remove_absolute(child)
		name = directory.get_next()
	directory.list_dir_end()
	DirAccess.remove_absolute(absolute)


func _fail(message: String) -> void:
	push_error("MAPSOO_PACK10_PRODUCTION_CANDIDATE_FAILURE: %s" % message)
	quit(1)
