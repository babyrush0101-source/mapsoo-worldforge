@tool
extends RefCounted

const PACK_VERSION := "0.1.0-alpha.10"
const SCHEMA_VERSION := "0.7.0"
const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd")
const RUNTIME_VERSION := "0.2.0"
const POLICY := "side-platformer-complete-v1"
const LAYERS := ["background-far", "background-mid", "background-near", "world", "foreground"]
const ATLASES := ["terrain", "hazards", "props", "structures", "collectibles", "backgrounds", "foreground", "character"]
const ROLES := [
	"terrain.solid", "terrain.one-way", "terrain.slope-up", "terrain.slope-down", "terrain.wall", "terrain.ceiling",
	"hazard.spikes", "hazard.pit", "hazard.moving-platform",
	"prop.crate", "prop.rock", "prop.plant", "prop.sign", "prop.lamp", "prop.breakable",
	"structure.entrance", "structure.exit", "structure.checkpoint",
	"collectible.primary", "collectible.health",
	"background.sky", "background.far", "background.mid", "background.near", "foreground.overlay",
	"character.player.atlas", "world.collision", "world.navigation", "world.scene", "world.preview",
]
const CLIPS := [
	"idle.left", "idle.right", "run.left", "run.right", "jump.left", "jump.right",
	"fall.left", "fall.right", "land.left", "land.right", "hurt.left", "hurt.right",
]
const PLACEMENT_ROLES := [
	"terrain.solid", "terrain.one-way", "terrain.slope-up", "terrain.slope-down", "terrain.wall", "terrain.ceiling",
	"hazard.spikes", "hazard.pit", "hazard.moving-platform",
	"prop.crate", "prop.rock", "prop.plant", "prop.sign", "prop.lamp", "prop.breakable",
	"structure.entrance", "structure.exit", "structure.checkpoint", "collectible.primary", "collectible.health",
]
const PNG_SIZES := {
	"atlases/platforms.png": Vector2i(192, 64), "atlases/hazards.png": Vector2i(96, 32),
	"atlases/props.png": Vector2i(192, 32), "atlases/structures.png": Vector2i(96, 64),
	"atlases/collectibles.png": Vector2i(64, 32), "atlases/character.png": Vector2i(384, 64),
	"layers/background-sky.png": Vector2i(320, 180), "layers/background-far.png": Vector2i(320, 180),
	"layers/background-mid.png": Vector2i(320, 180), "layers/background-near.png": Vector2i(320, 180),
	"layers/foreground-overlay.png": Vector2i(320, 180), "previews/world.png": Vector2i(320, 180),
}


static func validate_and_prepare(manifest: Dictionary, pack_root: String, prepared: Dictionary, file_index: Dictionary) -> Dictionary:
	var errors: Array[String] = prepared.errors
	_require_keys(manifest, ["schema_version", "pack", "profile", "completeness_policy", "compatibility", "layers", "atlases", "roles", "character", "runtime", "files", "license", "provenance"], "Pack 0.7 manifest", errors)
	var pack := _dict(manifest.get("pack"), "pack", errors)
	var compatibility := _dict(manifest.get("compatibility"), "compatibility", errors)
	var importer := _dict(compatibility.get("importer"), "compatibility.importer", errors)
	var license := _dict(manifest.get("license"), "license", errors)
	var output_license := _dict(license.get("output"), "license.output", errors)
	_require_keys(pack, ["id", "title", "version", "generator", "created_at"], "pack", errors)
	if not _pack_id(str(pack.get("id", ""))): errors.append("Pack 0.7 pack.id must be lowercase kebab-case ASCII.")
	else: prepared.pack_id = pack.id
	var generator := _dict(pack.get("generator"), "pack.generator", errors)
	_require_keys(generator, ["name", "version"], "pack.generator", errors)
	_require_keys(compatibility, ["godot_min", "grid", "art_style", "importer"], "compatibility", errors)
	_require_keys(importer, ["id", "min_version"], "compatibility.importer", errors)
	_require_keys(license, ["output"], "license", errors)
	_require_keys(output_license, ["id", "notice_path", "permits_redistribution"], "license.output", errors)
	if pack.get("version") != PACK_VERSION or generator.get("name") != "Mapsoo Worldsmith" or generator.get("version") != PACK_VERSION:
		errors.append("Pack 0.7 must identify Mapsoo Worldsmith Alpha10.")
	if typeof(pack.get("title")) != TYPE_STRING or str(pack.get("title", "")).is_empty() or typeof(pack.get("created_at")) != TYPE_STRING or not str(pack.get("created_at", "")).contains("T"):
		errors.append("Pack 0.7 title and created_at are required.")
	if compatibility.get("godot_min") != "4.3" or compatibility.get("grid") != "pixel" or compatibility.get("art_style") != "pixel_art" or importer.get("id") != "mapsoo_importer" or importer.get("min_version") != PACK_VERSION:
		errors.append("Pack 0.7 compatibility contract is unsupported.")
	if manifest.get("profile") != "side-platformer" or manifest.get("completeness_policy") != POLICY:
		errors.append("Pack 0.7 requires the complete side-platformer profile.")
	if output_license.get("id") != "CC0-1.0" or output_license.get("permits_redistribution") != true or output_license.get("notice_path") != "license-assets.md":
		errors.append("Pack 0.7 generated assets must use the canonical redistributable CC0 contract.")
	var provenance := _dict(manifest.get("provenance"), "provenance", errors)
	var provider := _dict(provenance.get("provider"), "provenance.provider", errors)
	_require_keys(provenance, ["provider", "output_provenance", "contains_generative_ai", "model_provider", "model", "seed", "human_curated"], "provenance", errors)
	_require_keys(provider, ["id", "version"], "provenance.provider", errors)
	if not _asset_id(str(provider.get("id", ""))) or str(provider.get("version", "")).is_empty() or provenance.get("output_provenance") not in ["procedural", "generative-ai", "hybrid"] or typeof(provenance.get("contains_generative_ai")) != TYPE_BOOL or typeof(provenance.get("human_curated")) != TYPE_BOOL or typeof(provenance.get("seed")) != TYPE_STRING or str(provenance.get("seed")).is_empty():
		errors.append("Pack 0.7 provenance contract is invalid.")
	var files: Variant = manifest.get("files")
	if typeof(files) == TYPE_ARRAY:
		for record_value: Variant in files:
			if typeof(record_value) != TYPE_DICTIONARY:
				errors.append("Pack 0.7 file record must be an object."); continue
			var record: Dictionary = record_value
			_require_keys(record, ["path", "media_type", "bytes", "sha256"], "files item", errors)
			if record.get("media_type") not in ["image/png", "application/json", "application/schema+json", "text/markdown"] or not _integer(record.get("bytes")) or int(record.get("bytes", 0)) < 1:
				errors.append("Pack 0.7 file record media type or byte length is invalid.")
	_validate_ordered(manifest.get("layers"), LAYERS, "id", "Pack 0.7 layers", errors, true)

	var atlas_paths := {}
	var atlases: Variant = manifest.get("atlases")
	if typeof(atlases) != TYPE_ARRAY or atlases.size() != ATLASES.size():
		errors.append("Pack 0.7 requires eight canonical atlases.")
	else:
		for index: int in ATLASES.size():
			var atlas: Variant = atlases[index]
			if typeof(atlas) == TYPE_DICTIONARY: _require_keys(atlas, ["id", "path"], "atlases item", errors)
			if typeof(atlas) != TYPE_DICTIONARY or atlas.get("id") != ATLASES[index] or typeof(atlas.get("path")) != TYPE_STRING:
				errors.append("Pack 0.7 atlases must use canonical order and paths.")
			else: atlas_paths[atlas.id] = atlas.path

	var role_paths := {}
	var roles: Variant = manifest.get("roles")
	if typeof(roles) != TYPE_ARRAY or roles.size() != ROLES.size():
		errors.append("Pack 0.7 requires all 30 canonical roles.")
	else:
		for index: int in ROLES.size():
			var role: Variant = roles[index]
			if typeof(role) == TYPE_DICTIONARY: _require_keys(role, ["role", "path"], "roles item", errors)
			if typeof(role) != TYPE_DICTIONARY or role.get("role") != ROLES[index] or typeof(role.get("path")) != TYPE_STRING:
				errors.append("Pack 0.7 roles must use canonical order.")
			else: role_paths[role.role] = role.path

	var expected_atlases := {
		"terrain": "atlases/platforms.png", "hazards": "atlases/hazards.png", "props": "atlases/props.png",
		"structures": "atlases/structures.png", "collectibles": "atlases/collectibles.png",
		"backgrounds": "layers/background-far.png", "foreground": "layers/foreground-overlay.png",
		"character": "atlases/character.png",
	}
	for atlas_id: String in ATLASES:
		if atlas_paths.get(atlas_id) != expected_atlases[atlas_id]: errors.append("Pack 0.7 atlas %s path is not canonical." % atlas_id)
	var expected_role_paths: Array[String] = []
	for index: int in ROLES.size():
		if index < 6: expected_role_paths.append("atlases/platforms.png")
		elif index < 9: expected_role_paths.append("atlases/hazards.png")
		elif index < 15: expected_role_paths.append("atlases/props.png")
		elif index < 18: expected_role_paths.append("atlases/structures.png")
		elif index < 20: expected_role_paths.append("atlases/collectibles.png")
		elif index == 20: expected_role_paths.append("layers/background-sky.png")
		elif index == 21: expected_role_paths.append("layers/background-far.png")
		elif index == 22: expected_role_paths.append("layers/background-mid.png")
		elif index == 23: expected_role_paths.append("layers/background-near.png")
		elif index == 24: expected_role_paths.append("layers/foreground-overlay.png")
		elif index == 25: expected_role_paths.append("atlases/character.png")
		elif index == 26: expected_role_paths.append("runtime/collision.json")
		elif index == 27: expected_role_paths.append("runtime/navigation.json")
		elif index == 28: expected_role_paths.append("runtime/scene.json")
		else: expected_role_paths.append("previews/world.png")
	for index: int in ROLES.size():
		if role_paths.get(ROLES[index]) != expected_role_paths[index]: errors.append("Role %s is not bound to its canonical Pack 0.7 asset." % ROLES[index])

	var runtime := _dict(manifest.get("runtime"), "runtime", errors)
	var runtime_paths := {}
	for key: String in ["scene", "collision", "navigation"]:
		var reference := _dict(runtime.get(key), "runtime.%s" % key, errors)
		if reference.size() != 1 or reference.get("path") != "runtime/%s.json" % key: errors.append("Pack 0.7 runtime.%s path is not canonical." % key)
		else: runtime_paths[key] = reference.path
	var spawn := _point(runtime.get("spawn"), "manifest runtime.spawn", errors)
	var referenced: Array = atlas_paths.values() + role_paths.values() + runtime_paths.values() + [output_license.get("notice_path")]
	for path_value: Variant in referenced:
		if typeof(path_value) != TYPE_STRING or not file_index.has(path_value): errors.append("Pack 0.7 referenced file is absent: %s" % path_value)
	if not errors.is_empty(): return prepared

	_validate_exact_inventory(pack_root, file_index, errors)
	var textures := {}
	for path: String in PNG_SIZES:
		if not file_index.has(path) or file_index[path].get("media_type") != "image/png":
			errors.append("Pack 0.7 canonical PNG is absent: %s" % path)
			continue
		var loaded := _load_png(pack_root.path_join(path))
		if not loaded.ok: errors.append(loaded.error)
		elif loaded.image.get_size() != PNG_SIZES[path]: errors.append("Pack 0.7 PNG %s has invalid dimensions." % path)
		else: textures[path] = _texture(loaded.image)
	for key: String in runtime_paths:
		if file_index[runtime_paths[key]].get("media_type") != "application/json": errors.append("Pack 0.7 runtime sidecars must be JSON.")
	if not errors.is_empty(): return prepared

	var scene_read := _read_json(pack_root.path_join(runtime_paths.scene))
	var collision_read := _read_json(pack_root.path_join(runtime_paths.collision))
	var navigation_read := _read_json(pack_root.path_join(runtime_paths.navigation))
	if not scene_read.ok: errors.append(scene_read.error)
	if not collision_read.ok: errors.append(collision_read.error)
	if not navigation_read.ok: errors.append(navigation_read.error)
	if not errors.is_empty(): return prepared
	var scene: Dictionary = scene_read.value
	var collision: Dictionary = collision_read.value
	var navigation: Dictionary = navigation_read.value
	_require_keys(scene, ["schema_version", "profile", "completeness_policy", "bounds", "spawn", "layers", "placements"], "scene sidecar", errors)
	_require_keys(collision, ["schema_version", "profile", "completeness_policy", "bounds", "spawn", "surfaces", "hazards"], "collision sidecar", errors)
	_require_keys(navigation, ["schema_version", "profile", "completeness_policy", "bounds", "spawn", "nodes", "edges", "exit_node_id"], "navigation sidecar", errors)
	var bounds := _rect(scene.get("bounds"), "scene bounds", errors)
	var collision_bounds := _rect(collision.get("bounds"), "collision bounds", errors)
	var navigation_bounds := _rect(navigation.get("bounds"), "navigation bounds", errors)
	for pair: Array in [[scene, "scene"], [collision, "collision"], [navigation, "navigation"]]:
		var sidecar: Dictionary = pair[0]
		if sidecar.get("schema_version") != RUNTIME_VERSION or sidecar.get("profile") != "side-platformer" or sidecar.get("completeness_policy") != POLICY:
			errors.append("Pack 0.7 %s sidecar contract is invalid." % pair[1])
	if bounds != collision_bounds or bounds != navigation_bounds or bounds.position.x < 0 or bounds.position.y < 0 or bounds.size.x < 1 or bounds.size.y < 1 or bounds.size.x > 8192 or bounds.size.y > 8192 or bounds.end.x > 8192 or bounds.end.y > 8192:
		errors.append("Pack 0.7 runtime bounds must be shared, positive and bounded.")
	var scene_spawn := _point(scene.get("spawn"), "scene spawn", errors)
	var collision_spawn := _point(collision.get("spawn"), "collision spawn", errors)
	var navigation_spawn := _point(navigation.get("spawn"), "navigation spawn", errors)
	if spawn != scene_spawn or spawn != collision_spawn or spawn != navigation_spawn or not bounds.has_point(Vector2(spawn)):
		errors.append("Pack 0.7 manifest and sidecars must share one in-bounds spawn.")
	_validate_ordered_strings(scene.get("layers"), LAYERS, "scene layers", errors)

	var placements := _validate_placements(scene.get("placements"), bounds, role_paths, errors)
	var surfaces := _validate_rect_items(collision.get("surfaces"), bounds, ["solid", "one-way"], "surface", errors)
	var hazards := _validate_rect_items(collision.get("hazards"), bounds, ["spikes", "pit"], "hazard", errors)
	var graph := _validate_navigation(navigation, bounds, spawn, errors)
	var supported := false
	for surface_value: Variant in surfaces:
		var rect: Rect2i = surface_value.rect
		if spawn.x >= rect.position.x and spawn.x < rect.end.x and spawn.y == rect.position.y: supported = true
	if not supported: errors.append("Pack 0.7 spawn must sit on a collision surface.")
	var character := _validate_character(manifest.get("character"), textures, errors)
	if not errors.is_empty(): return prepared

	prepared.textures = textures; prepared.atlas_paths = atlas_paths; prepared.role_paths = role_paths
	prepared.bounds = bounds; prepared.spawn = spawn; prepared.placements = placements
	prepared.surfaces = surfaces; prepared.hazards = hazards; prepared.navigation_nodes = graph.nodes
	prepared.navigation_edges = graph.edges; prepared.exit_node_id = graph.exit_node_id; prepared.character = character
	prepared.props = placements; prepared.cell_count = surfaces.size(); prepared.layer_cell_counts = {}
	prepared.tile_set = _build_tileset(textures["atlases/platforms.png"])
	return prepared


static func _validate_character(value: Variant, textures: Dictionary, errors: Array[String]) -> Dictionary:
	var character := _dict(value, "character", errors)
	_require_keys(character, ["id", "atlas", "frame_size", "pivot", "clips"], "character", errors)
	var frame_size := _array_pair(character.get("frame_size"), "character.frame_size", errors)
	var pivot := _array_pair(character.get("pivot"), "character.pivot", errors)
	if character.get("id") != "player" or character.get("atlas") != "atlases/character.png" or frame_size != Vector2i(32, 64) or pivot != Vector2i(16, 60):
		errors.append("Pack 0.7 character atlas, frame size or pivot is not canonical.")
	var clips: Variant = character.get("clips")
	if typeof(clips) != TYPE_ARRAY or clips.size() != CLIPS.size():
		errors.append("Pack 0.7 character requires 12 canonical clips.")
		return character
	for index: int in CLIPS.size():
		var clip: Variant = clips[index]
		if typeof(clip) == TYPE_DICTIONARY: _require_keys(clip, ["id", "action", "direction", "fps", "frames"], "character clip", errors)
		if typeof(clip) != TYPE_DICTIONARY or clip.get("id") != CLIPS[index] or clip.get("id") != "%s.%s" % [clip.get("action"), clip.get("direction")] or typeof(clip.get("fps")) not in [TYPE_INT, TYPE_FLOAT] or float(clip.get("fps", 0)) <= 0 or float(clip.get("fps", 0)) > 60:
			errors.append("Pack 0.7 character clip %s is invalid." % CLIPS[index]); continue
		var frames: Variant = clip.get("frames")
		if typeof(frames) != TYPE_ARRAY or frames.is_empty() or frames.size() > 32:
			errors.append("Pack 0.7 clip %s frame list is invalid." % CLIPS[index]); continue
		for frame_value: Variant in frames:
			if typeof(frame_value) == TYPE_DICTIONARY: _require_keys(frame_value, ["x", "y"], "character frame", errors)
			var frame := _point(frame_value, "character frame", errors)
			if frame.x + 32 > 384 or frame.y + 64 > 64: errors.append("Pack 0.7 character frame is outside its atlas.")
	return character


static func _validate_placements(value: Variant, bounds: Rect2i, role_paths: Dictionary, errors: Array[String]) -> Array:
	var output: Array = []; var ids := {}
	if typeof(value) != TYPE_ARRAY or value.is_empty() or value.size() > 4096:
		errors.append("Pack 0.7 placements must contain 1..4096 items."); return output
	for item_value: Variant in value:
		if typeof(item_value) != TYPE_DICTIONARY: errors.append("Pack 0.7 placement must be an object."); continue
		var item: Dictionary = item_value; var id := str(item.get("id", "")); var role := str(item.get("role", "")); var layer := str(item.get("layer", ""))
		var placement_keys := ["id", "role", "layer", "x", "y", "flip_x"] if item.has("flip_x") else ["id", "role", "layer", "x", "y"]
		_require_keys(item, placement_keys, "placement", errors)
		var point := Vector2i(int(item.get("x", -1)), int(item.get("y", -1)))
		if not _asset_id(id) or ids.has(id) or role not in PLACEMENT_ROLES or not role_paths.has(role) or layer not in LAYERS or not _integer(item.get("x")) or not _integer(item.get("y")) or (item.has("flip_x") and typeof(item.flip_x) != TYPE_BOOL) or not bounds.has_point(Vector2(point)):
			errors.append("Pack 0.7 placement is invalid or duplicated: %s" % id); continue
		ids[id] = true; output.append(item.duplicate(true))
	return output


static func _validate_rect_items(value: Variant, bounds: Rect2i, kinds: Array, label: String, errors: Array[String]) -> Array:
	var output: Array = []; var ids := {}; var maximum := 2048 if label == "surface" else 1024
	if typeof(value) != TYPE_ARRAY or value.size() > maximum:
		errors.append("Pack 0.7 %ss exceed their limit." % label); return output
	for item_value: Variant in value:
		if typeof(item_value) != TYPE_DICTIONARY: errors.append("Pack 0.7 %s must be an object." % label); continue
		var item: Dictionary = item_value; var id := str(item.get("id", "")); var kind := str(item.get("kind", "")); var rect := _rect(item.get("rect"), "%s rect" % label, errors)
		_require_keys(item, ["id", "kind", "rect"], label, errors)
		if not _asset_id(id) or ids.has(id) or kind not in kinds or rect.size.x < 1 or rect.size.y < 1 or not bounds.encloses(rect):
			errors.append("Pack 0.7 %s is invalid or duplicated: %s" % [label, id]); continue
		ids[id] = true; var stored := item.duplicate(true); stored.rect = rect; output.append(stored)
	return output


static func _validate_navigation(value: Dictionary, bounds: Rect2i, spawn: Vector2i, errors: Array[String]) -> Dictionary:
	var nodes_value: Variant = value.get("nodes"); var edges_value: Variant = value.get("edges")
	var nodes: Array = []; var edges: Array = []; var ids := {}; var spawn_ids: Array[String] = []
	if typeof(nodes_value) != TYPE_ARRAY or nodes_value.is_empty() or nodes_value.size() > 2048: errors.append("Pack 0.7 traversal nodes are invalid.")
	else:
		for node_value: Variant in nodes_value:
			if typeof(node_value) != TYPE_DICTIONARY: errors.append("Traversal node must be an object."); continue
			var node: Dictionary = node_value; var id := str(node.get("id", "")); var kind := str(node.get("kind", "")); var point := Vector2i(int(node.get("x", -1)), int(node.get("y", -1)))
			_require_keys(node, ["id", "x", "y", "kind"], "traversal node", errors)
			if not _asset_id(id) or ids.has(id) or kind not in ["spawn", "platform", "checkpoint", "exit"] or not _integer(node.get("x")) or not _integer(node.get("y")) or not bounds.has_point(Vector2(point)):
				errors.append("Pack 0.7 traversal node is invalid or duplicated: %s" % id); continue
			ids[id] = true; if kind == "spawn": spawn_ids.append(id)
			nodes.append(node.duplicate(true))
	if typeof(edges_value) != TYPE_ARRAY or edges_value.size() > 4096: errors.append("Pack 0.7 traversal edges are invalid.")
	else:
		var edge_ids := {}
		for edge_value: Variant in edges_value:
			if typeof(edge_value) != TYPE_DICTIONARY: errors.append("Traversal edge must be an object."); continue
			var edge: Dictionary = edge_value; var key := "%s>%s:%s" % [edge.get("from"), edge.get("to"), edge.get("kind")]
			_require_keys(edge, ["from", "to", "kind"], "traversal edge", errors)
			if not ids.has(edge.get("from")) or not ids.has(edge.get("to")) or edge.get("kind") not in ["walk", "jump", "drop", "moving-platform"] or edge_ids.has(key):
				errors.append("Pack 0.7 traversal edge is invalid or duplicated: %s" % key); continue
			edge_ids[key] = true; edges.append(edge.duplicate(true))
	var exit_id := str(value.get("exit_node_id", "")); var exit_ok := false; var spawn_id := spawn_ids[0] if spawn_ids.size() == 1 else ""
	for node: Dictionary in nodes:
		if node.id == spawn_id and (Vector2i(node.x, node.y) != spawn or node.kind != "spawn"): errors.append("Traversal spawn node must match runtime spawn.")
		if node.id == exit_id and node.kind == "exit": exit_ok = true
	if spawn_ids.size() != 1 or not exit_ok: errors.append("Pack 0.7 traversal requires one spawn and its declared exit.")
	if not spawn_id.is_empty() and exit_ok:
		var reached := {spawn_id: true}; var changed := true
		while changed:
			changed = false
			for edge: Dictionary in edges:
				if reached.has(edge.get("from")) and not reached.has(edge.get("to")): reached[edge.get("to")] = true; changed = true
		if not reached.has(exit_id): errors.append("Pack 0.7 exit is unreachable from spawn.")
	return {"nodes": nodes, "edges": edges, "exit_node_id": exit_id}


static func _build_tileset(texture: Texture2D) -> TileSet:
	# Pack 0.7 is pixel-coordinate runtime data, not a cell-grid map. Keep the
	# managed TileSet artifact for importer transaction compatibility only.
	var tile_set := TileSet.new(); tile_set.tile_size = Vector2i(32, 32); return tile_set


static func build_scene(prepared: Dictionary) -> Dictionary:
	var root := Node2D.new(); root.name = "MapsooWorld"; root.set_meta("mapsoo_pack_id", prepared.pack_id); root.set_meta("mapsoo_profile", "side-platformer"); root.set_meta("mapsoo_schema_version", SCHEMA_VERSION); root.set_meta("mapsoo_bounds", prepared.bounds)
	var layer_nodes := {}; var layer_names := {"background-far": "BackgroundFar", "background-mid": "BackgroundMid", "background-near": "BackgroundNear", "world": "World", "foreground": "Foreground"}
	var parallax_scales := {"background-far": Vector2(0.12, 0.08), "background-mid": Vector2(0.35, 0.2), "background-near": Vector2(0.62, 0.38), "foreground": Vector2(1.08, 1.0)}
	for index: int in LAYERS.size():
		var layer_id: String = LAYERS[index]
		var layer: Node2D
		if parallax_scales.has(layer_id):
			var parallax := Parallax2D.new(); parallax.scroll_scale = parallax_scales[layer_id]; parallax.repeat_size = Vector2(prepared.bounds.size); layer = parallax
		else:
			layer = Node2D.new()
		layer.name = layer_names[layer_id]; layer.z_index = index; layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST; root.add_child(layer); layer.owner = root; layer_nodes[layer_id] = layer
	_add_full_layer(root, layer_nodes["background-far"], prepared, "background.sky", "Sky")
	_add_full_layer(root, layer_nodes["background-far"], prepared, "background.far", "Far")
	_add_full_layer(root, layer_nodes["background-mid"], prepared, "background.mid", "Mid")
	_add_full_layer(root, layer_nodes["background-near"], prepared, "background.near", "Near")
	_add_full_layer(root, layer_nodes["foreground"], prepared, "foreground.overlay", "Overlay")
	_add_surface_visuals(root, layer_nodes["world"], prepared)
	for item_value: Variant in prepared.placements:
		var item: Dictionary = item_value; var sprite := _placement_sprite(prepared, item); layer_nodes[item.layer].add_child(sprite); sprite.owner = root
	_add_collision_tree(root, prepared)
	_add_traversal_tree(root, prepared)
	_add_player(root, prepared)
	return {"ok": true, "root": root, "error": ""}


static func _add_full_layer(root: Node2D, parent: Node2D, prepared: Dictionary, role: String, name: String) -> void:
	var texture: Texture2D = prepared.textures[prepared.role_paths[role]]; var sprite := Sprite2D.new(); sprite.name = name; sprite.texture = texture; sprite.centered = false; sprite.position = Vector2(prepared.bounds.position); sprite.scale = Vector2(float(prepared.bounds.size.x) / texture.get_width(), float(prepared.bounds.size.y) / texture.get_height()); sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST; sprite.set_meta("mapsoo_role", role); parent.add_child(sprite); sprite.owner = root


static func _placement_sprite(prepared: Dictionary, item: Dictionary) -> Sprite2D:
	var role := str(item.role); var region := _role_region(role); var atlas := AtlasTexture.new(); atlas.atlas = prepared.textures[prepared.role_paths[role]]; atlas.region = region; atlas.filter_clip = true
	var sprite := Sprite2D.new(); sprite.name = _node_name(str(item.id)); sprite.texture = atlas; sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST; sprite.flip_h = bool(item.get("flip_x", false))
	var matched_hazard: Dictionary = {}
	if role.begins_with("hazard."):
		for hazard: Dictionary in prepared.hazards:
			if hazard.id == item.id: matched_hazard = hazard; break
	if not matched_hazard.is_empty():
		sprite.position = Vector2(matched_hazard.rect.position) + Vector2(matched_hazard.rect.size) * 0.5
		sprite.scale = Vector2(float(matched_hazard.rect.size.x) / region.size.x, float(matched_hazard.rect.size.y) / region.size.y)
		sprite.set_meta("mapsoo_rect", matched_hazard.rect)
	else:
		sprite.position = Vector2(float(item.x) + region.size.x * 0.5, float(item.y) - region.size.y * 0.5)
	sprite.set_meta("mapsoo_id", item.id); sprite.set_meta("mapsoo_role", role); sprite.set_meta("mapsoo_layer", item.layer); return sprite


static func _add_surface_visuals(root: Node2D, parent: Node2D, prepared: Dictionary) -> void:
	var container := Node2D.new(); container.name = "TerrainVisuals"; container.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST; parent.add_child(container); container.owner = root
	for item: Dictionary in prepared.surfaces:
		var role := "terrain.one-way" if item.kind == "one-way" else "terrain.solid"
		var region := _role_region(role); var atlas := AtlasTexture.new(); atlas.atlas = prepared.textures[prepared.role_paths[role]]; atlas.region = region; atlas.filter_clip = true
		var sprite := Sprite2D.new(); sprite.name = _node_name(item.id); sprite.texture = atlas; sprite.position = Vector2(item.rect.position) + Vector2(item.rect.size) * 0.5; sprite.scale = Vector2(float(item.rect.size.x) / region.size.x, float(item.rect.size.y) / region.size.y); sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.set_meta("mapsoo_id", item.id); sprite.set_meta("mapsoo_role", role); sprite.set_meta("mapsoo_rect", item.rect); container.add_child(sprite); sprite.owner = root


static func _role_region(role: String) -> Rect2:
	if role.begins_with("terrain."): return Rect2(ROLES.slice(0, 6).find(role) * 32, 0, 32, 32)
	if role.begins_with("hazard."): return Rect2(ROLES.slice(6, 9).find(role) * 32, 0, 32, 32)
	if role.begins_with("prop."): return Rect2(ROLES.slice(9, 15).find(role) * 32, 0, 32, 32)
	if role.begins_with("structure."): return Rect2(ROLES.slice(15, 18).find(role) * 32, 0, 32, 64)
	if role.begins_with("collectible."): return Rect2(ROLES.slice(18, 20).find(role) * 32, 0, 32, 32)
	return Rect2(0, 0, 32, 32)


static func _add_collision_tree(root: Node2D, prepared: Dictionary) -> void:
	var collision_root := Node2D.new(); collision_root.name = "WorldCollision"; root.add_child(collision_root); collision_root.owner = root
	for item: Dictionary in prepared.surfaces:
		var body := StaticBody2D.new(); body.name = _node_name(item.id); body.position = Vector2(item.rect.position) + Vector2(item.rect.size) * 0.5; body.collision_layer = 1; body.collision_mask = 1; body.set_meta("mapsoo_id", item.id); body.set_meta("mapsoo_kind", item.kind); collision_root.add_child(body); body.owner = root
		var shape_node := CollisionShape2D.new(); shape_node.name = "CollisionShape2D"; var shape := RectangleShape2D.new(); shape.size = Vector2(item.rect.size); shape_node.shape = shape; shape_node.one_way_collision = item.kind == "one-way"; body.add_child(shape_node); shape_node.owner = root
	var hazards_root := Node2D.new(); hazards_root.name = "Hazards"; root.add_child(hazards_root); hazards_root.owner = root
	for item: Dictionary in prepared.hazards:
		var area := Area2D.new(); area.name = _node_name(item.id); area.position = Vector2(item.rect.position) + Vector2(item.rect.size) * 0.5; area.collision_layer = 2; area.collision_mask = 1; area.monitoring = true; area.monitorable = true; area.set_meta("mapsoo_id", item.id); area.set_meta("mapsoo_kind", item.kind); hazards_root.add_child(area); area.owner = root
		var shape_node := CollisionShape2D.new(); shape_node.name = "CollisionShape2D"; var shape := RectangleShape2D.new(); shape.size = Vector2(item.rect.size); shape_node.shape = shape; area.add_child(shape_node); shape_node.owner = root


static func _add_traversal_tree(root: Node2D, prepared: Dictionary) -> void:
	var graph := Node2D.new(); graph.name = "WorldTraversal"; graph.set_meta("mapsoo_edges", prepared.navigation_edges.duplicate(true)); graph.set_meta("mapsoo_exit_node_id", prepared.exit_node_id); root.add_child(graph); graph.owner = root
	for node: Dictionary in prepared.navigation_nodes:
		var marker := Marker2D.new(); marker.name = _node_name(node.id); marker.position = Vector2(node.x, node.y); marker.set_meta("mapsoo_id", node.id); marker.set_meta("mapsoo_kind", node.kind); graph.add_child(marker); marker.owner = root


static func _add_player(root: Node2D, prepared: Dictionary) -> void:
	var spawn := Marker2D.new(); spawn.name = "PlayerSpawn"; spawn.position = Vector2(prepared.spawn); root.add_child(spawn); spawn.owner = root
	var player := CharacterBody2D.new(); player.name = "Player"; player.position = spawn.position; player.collision_layer = 1; player.collision_mask = 1; root.add_child(player); player.owner = root
	player.set_script(PlayerController); player.set("mapsoo_profile", "side-platformer"); player.set("world_bounds", Rect2(prepared.bounds)); player.set("spawn_position", spawn.position)
	var frames := SpriteFrames.new(); frames.remove_animation("default"); var texture: Texture2D = prepared.textures[prepared.character.atlas]
	for clip: Dictionary in prepared.character.clips:
		var animation_name := str(clip.id).replace(".", "_"); frames.add_animation(animation_name); frames.set_animation_speed(animation_name, float(clip.fps)); frames.set_animation_loop(animation_name, true)
		for frame: Dictionary in clip.frames:
			var atlas := AtlasTexture.new(); atlas.atlas = texture; atlas.region = Rect2(frame.x, frame.y, 32, 64); atlas.filter_clip = true; frames.add_frame(animation_name, atlas)
	var visual := AnimatedSprite2D.new(); visual.name = "Visual"; visual.sprite_frames = frames; visual.animation = "idle_right"; visual.offset = Vector2(0, -28); visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST; visual.set_meta("mapsoo_runtime_slot_id", "player"); player.add_child(visual); visual.owner = root
	var collision := CollisionShape2D.new(); collision.name = "CollisionShape2D"; collision.position = Vector2(0, -20); var capsule := CapsuleShape2D.new(); capsule.radius = 8; capsule.height = 40; collision.shape = capsule; player.add_child(collision); collision.owner = root
	var camera := Camera2D.new(); camera.name = "Camera2D"; camera.position_smoothing_enabled = false; player.add_child(camera); camera.owner = root


static func validate_staged_scene(world: Node, expected_placements: int) -> Dictionary:
	var valid: bool = world.name == "MapsooWorld" and world.get_meta("mapsoo_profile", "") == "side-platformer"
	for name: String in ["BackgroundFar", "BackgroundMid", "BackgroundNear", "Foreground"]: valid = valid and world.get_node_or_null(name) is Parallax2D
	valid = valid and world.get_node_or_null("World") is Node2D
	var expected_scales := {"BackgroundFar": Vector2(0.12, 0.08), "BackgroundMid": Vector2(0.35, 0.2), "BackgroundNear": Vector2(0.62, 0.38), "Foreground": Vector2(1.08, 1.0)}
	for name: String in expected_scales: valid = valid and (world.get_node_or_null(name) as Parallax2D).scroll_scale == expected_scales[name]
	var placement_count := 0
	for layer_name: String in ["BackgroundFar", "BackgroundMid", "BackgroundNear", "World", "Foreground"]:
		var placement_layer := world.get_node_or_null(layer_name)
		if placement_layer == null: continue
		for child: Node in placement_layer.get_children():
			if child.has_meta("mapsoo_id") and child.has_meta("mapsoo_role"): placement_count += 1
	valid = valid and placement_count == expected_placements
	var collision := world.get_node_or_null("WorldCollision") as Node2D; var hazards := world.get_node_or_null("Hazards") as Node2D; var graph := world.get_node_or_null("WorldTraversal") as Node2D
	valid = valid and collision != null and collision.get_child_count() > 0 and hazards != null and graph != null and graph.get_child_count() > 1 and graph.has_meta("mapsoo_edges") and graph.has_meta("mapsoo_exit_node_id")
	var terrain_visuals := world.get_node_or_null("World/TerrainVisuals") as Node2D
	valid = valid and terrain_visuals != null and terrain_visuals.get_child_count() == collision.get_child_count()
	var spawn := world.get_node_or_null("PlayerSpawn") as Marker2D; var player := world.get_node_or_null("Player") as CharacterBody2D; var visual := world.get_node_or_null("Player/Visual") as AnimatedSprite2D; var shape := world.get_node_or_null("Player/CollisionShape2D") as CollisionShape2D; var camera := world.get_node_or_null("Player/Camera2D") as Camera2D
	valid = valid and spawn != null and player != null and player.position == spawn.position and player.get_script() == PlayerController and player.get("mapsoo_profile") == "side-platformer" and visual != null and visual.sprite_frames != null and str(visual.get_meta("mapsoo_runtime_slot_id", "")) == "player" and shape != null and shape.shape is CapsuleShape2D and camera != null
	valid = valid and _sprite_textures_have_persisted_pixels(world)
	if visual != null and visual.sprite_frames != null:
		for clip: String in CLIPS:
			var animation_name := clip.replace(".", "_")
			valid = valid and visual.sprite_frames.has_animation(animation_name) and visual.sprite_frames.get_frame_count(animation_name) > 0
			if visual.sprite_frames.has_animation(animation_name):
				for frame_index: int in visual.sprite_frames.get_frame_count(animation_name):
					valid = valid and _texture_has_persisted_pixels(visual.sprite_frames.get_frame_texture(animation_name, frame_index))
	return {"ok": valid, "error": "" if valid else "Staged Pack 0.7 scene is incomplete."}


static func _sprite_textures_have_persisted_pixels(node: Node) -> bool:
	if node is Sprite2D and not _texture_has_persisted_pixels((node as Sprite2D).texture):
		return false
	for child: Node in node.get_children():
		if not _sprite_textures_have_persisted_pixels(child):
			return false
	return true


static func _texture_has_persisted_pixels(value: Texture2D) -> bool:
	var texture := value
	if texture is AtlasTexture:
		texture = (texture as AtlasTexture).atlas
	if texture == null:
		return false
	var image := texture.get_image()
	return image != null and not image.is_empty() and not image.get_data().is_empty()


static func _validate_exact_inventory(pack_root: String, file_index: Dictionary, errors: Array[String]) -> void:
	var actual: Array[String] = []; _collect_files(ProjectSettings.globalize_path(pack_root), "", actual); actual.sort()
	var expected: Array[String] = ["mapsoo.manifest.json"]; for key: Variant in file_index.keys(): expected.append(str(key)); expected.sort()
	if actual != expected: errors.append("Pack 0.7 directory must contain exactly the manifest-declared files.")


static func _collect_files(directory_path: String, prefix: String, output: Array[String]) -> void:
	var directory := DirAccess.open(directory_path); if directory == null: return
	for file: String in directory.get_files(): output.append(prefix.path_join(file) if not prefix.is_empty() else file)
	for child: String in directory.get_directories(): _collect_files(directory_path.path_join(child), prefix.path_join(child) if not prefix.is_empty() else child, output)


static func _load_png(path: String) -> Dictionary:
	var bytes := FileAccess.get_file_as_bytes(path); if bytes.is_empty(): return {"ok": false, "error": "Unable to read Pack 0.7 PNG: %s" % path}
	var image := Image.new(); var error := image.load_png_from_buffer(bytes); return {"ok": error == OK, "image": image, "error": "Unable to decode Pack 0.7 PNG: %s" % path}


static func _texture(image: Image) -> PortableCompressedTexture2D:
	var texture := PortableCompressedTexture2D.new()
	# PortableCompressedTexture2D discards its compressed source buffer by
	# default. ResourceSaver can then persist only size_override, which reloads
	# as a blank texture. This flag must be set before create_from_image() in
	# both Godot 4.3 and 4.7; setting it afterwards cannot recover the buffer.
	texture.keep_compressed_buffer = true
	texture.create_from_image(image, PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS)
	return texture


static func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path): return {"ok": false, "error": "Pack 0.7 JSON is missing: %s" % path}
	var bytes := FileAccess.get_file_as_bytes(path); if bytes.size() > 2 * 1024 * 1024: return {"ok": false, "error": "Pack 0.7 JSON is too large: %s" % path}
	var parser := JSON.new(); var error := parser.parse(bytes.get_string_from_utf8()); if error != OK or typeof(parser.data) != TYPE_DICTIONARY: return {"ok": false, "error": "Pack 0.7 JSON is invalid: %s" % path}
	return {"ok": true, "value": parser.data}


static func _dict(value: Variant, label: String, errors: Array[String]) -> Dictionary:
	if typeof(value) != TYPE_DICTIONARY: errors.append("%s must be an object." % label); return {}
	return value as Dictionary


static func _require_keys(value: Dictionary, expected: Array, label: String, errors: Array[String]) -> void:
	var actual: Array = value.keys(); actual.sort(); var canonical := expected.duplicate(); canonical.sort()
	if actual != canonical: errors.append("%s must contain exactly the canonical fields." % label)


static func _point(value: Variant, label: String, errors: Array[String]) -> Vector2i:
	if typeof(value) != TYPE_DICTIONARY or not _integer(value.get("x")) or not _integer(value.get("y")) or int(value.x) < 0 or int(value.y) < 0:
		errors.append("%s must contain non-negative integer x/y." % label); return Vector2i(-1, -1)
	_require_keys(value, ["x", "y"], label, errors)
	return Vector2i(int(value.x), int(value.y))


static func _rect(value: Variant, label: String, errors: Array[String]) -> Rect2i:
	if typeof(value) != TYPE_DICTIONARY or not _integer(value.get("x")) or not _integer(value.get("y")) or not _integer(value.get("width")) or not _integer(value.get("height")):
		errors.append("%s must contain integer x/y/width/height." % label); return Rect2i()
	_require_keys(value, ["x", "y", "width", "height"], label, errors)
	return Rect2i(int(value.x), int(value.y), int(value.width), int(value.height))


static func _array_pair(value: Variant, label: String, errors: Array[String]) -> Vector2i:
	if typeof(value) != TYPE_ARRAY or value.size() != 2 or not _integer(value[0]) or not _integer(value[1]):
		errors.append("%s must contain two integers." % label); return Vector2i(-1, -1)
	return Vector2i(int(value[0]), int(value[1]))


static func _validate_ordered(value: Variant, expected: Array, key: String, label: String, errors: Array[String], require_order: bool) -> void:
	if typeof(value) != TYPE_ARRAY or value.size() != expected.size(): errors.append("%s count is invalid." % label); return
	for index: int in expected.size():
		if typeof(value[index]) != TYPE_DICTIONARY or value[index].get(key) != expected[index] or (require_order and value[index].get("order") != index): errors.append("%s must be canonical and ordered." % label); return


static func _validate_ordered_strings(value: Variant, expected: Array, label: String, errors: Array[String]) -> void:
	if typeof(value) != TYPE_ARRAY or value != expected: errors.append("Pack 0.7 %s must be canonical and ordered." % label)


static func _integer(value: Variant) -> bool:
	return typeof(value) == TYPE_INT or (typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value))


static func _pack_id(value: String) -> bool:
	if value.length() < 1 or value.length() > 80 or value != value.to_lower() or value.strip_edges() != value or value.begins_with("-") or value.ends_with("-") or value.to_ascii_buffer().get_string_from_ascii() != value or value.contains("_"):
		return false
	for part: String in value.split("-"):
		if part.is_empty():
			return false
		for character: String in part:
			if character not in "abcdefghijklmnopqrstuvwxyz0123456789": return false
	return true


static func _asset_id(value: String) -> bool:
	return _pack_id(value.replace("_", "-"))


static func _node_name(value: String) -> String:
	var parts := value.replace("_", "-").split("-"); var output := ""
	for part: String in parts: output += part.capitalize().replace(" ", "")
	return output if not output.is_empty() else "Item"
