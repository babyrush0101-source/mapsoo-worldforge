@tool
extends RefCounted

const PACK_VERSION := "0.1.0-alpha.12"
const SCHEMA_VERSION := "0.9.0"
const RUNTIME_VERSION := "0.4.0"
const POLICY := "layered-depth-2d-complete-v1"
const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_layered_depth_player_controller.gd")
const NpcInteractionController = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_npc_interaction_controller.gd"
)
const LAYERS := ["sky", "far", "mid", "gameplay", "near", "lighting", "foreground"]
const ATLASES := ["terrain", "props", "structures", "collectibles", "effects", "player", "npc"]
const PLANES := ["sky", "far", "mid", "depth-fog", "near", "ambient-light", "foreground"]
const DIRECTIONS := ["left", "right", "near", "far"]
const PLAYER_ACTIONS := ["idle", "walk", "run", "interact"]
const NPC_ACTIONS := ["idle", "talk"]
const ROLES := [
	"background.sky", "background.far", "background.mid", "background.depth-fog",
	"near.overlay", "foreground.overlay", "lighting.ambient", "lighting.local",
	"terrain.ground", "terrain.path", "terrain.edge", "terrain.bridge", "terrain.stairs",
	"terrain.water", "prop.tree", "prop.rock", "prop.crate", "prop.sign", "prop.lamp",
	"prop.occluder", "structure.entrance", "structure.exit", "structure.checkpoint",
	"structure.landmark", "collectible.primary", "collectible.health", "effect.footstep",
	"effect.interact", "effect.portal", "effect.ambient", "character.player.atlas",
	"character.npc.atlas", "world.scene", "world.collision", "world.navigation", "world.preview",
]
const PNG_SIZES := {
	"layers/background-sky.png": Vector2i(320, 180),
	"layers/background-far.png": Vector2i(320, 180),
	"layers/background-mid.png": Vector2i(320, 180),
	"layers/background-depth-fog.png": Vector2i(320, 180),
	"layers/near-overlay.png": Vector2i(320, 180),
	"layers/lighting-ambient.png": Vector2i(320, 180),
	"layers/lighting-local.png": Vector2i(320, 180),
	"layers/foreground-overlay.png": Vector2i(320, 180),
	"atlases/terrain.png": Vector2i(256, 96),
	"atlases/props.png": Vector2i(320, 96),
	"atlases/structures.png": Vector2i(192, 112),
	"atlases/collectibles.png": Vector2i(64, 32),
	"atlases/effects.png": Vector2i(256, 64),
	"atlases/player.png": Vector2i(768, 72),
	"atlases/npc.png": Vector2i(384, 72),
	"previews/world.png": Vector2i(640, 360),
}


static func validate_and_prepare(manifest: Dictionary, pack_root: String, prepared: Dictionary, file_index: Dictionary) -> Dictionary:
	var errors: Array[String] = prepared.errors
	var manifest_keys := ["schema_version", "pack", "profile", "completeness_policy", "compatibility", "layers", "atlases", "planes", "roles", "characters", "runtime", "files", "license", "provenance"]
	if manifest.has("layout"): manifest_keys.append("layout")
	if manifest.has("material_palette"): manifest_keys.append("material_palette")
	if manifest.has("terrain_autotiles"): manifest_keys.append("terrain_autotiles")
	_require_keys(manifest, manifest_keys, "Pack 0.9 manifest", errors)
	var pack := _dict(manifest.get("pack"), "pack", errors)
	var compatibility := _dict(manifest.get("compatibility"), "compatibility", errors)
	var importer := _dict(compatibility.get("importer"), "compatibility.importer", errors)
	var license := _dict(manifest.get("license"), "license", errors)
	var output_license := _dict(license.get("output"), "license.output", errors)
	_require_keys(pack, ["id", "title", "version", "generator", "created_at"], "pack", errors)
	var generator := _dict(pack.get("generator"), "pack.generator", errors)
	_require_keys(generator, ["name", "version"], "pack.generator", errors)
	_require_keys(compatibility, ["godot_min", "projection", "art_style", "importer"], "compatibility", errors)
	_require_keys(importer, ["id", "min_version"], "compatibility.importer", errors)
	_require_keys(license, ["output"], "license", errors)
	_require_keys(output_license, ["id", "notice_path", "permits_redistribution"], "license.output", errors)
	if not _pack_id(str(pack.get("id", ""))):
		errors.append("Pack 0.9 pack.id must be lowercase kebab-case ASCII.")
	else:
		prepared.pack_id = pack.id
	if pack.get("version") != PACK_VERSION or generator.get("name") != "Mapsoo Worldsmith" or generator.get("version") != PACK_VERSION:
		errors.append("Pack 0.9 must identify Mapsoo Worldsmith Alpha12.")
	if manifest.get("profile") != "layered-depth-2d" or manifest.get("completeness_policy") != POLICY:
		errors.append("Pack 0.9 requires the complete layered-depth-2d profile.")
	if compatibility.get("godot_min") != "4.3" or compatibility.get("projection") != "layered-depth-stage" or compatibility.get("art_style") != "pixel_art" or importer.get("id") != "mapsoo_importer" or importer.get("min_version") != PACK_VERSION:
		errors.append("Pack 0.9 compatibility contract is unsupported.")
	if output_license.get("id") != "CC0-1.0" or output_license.get("notice_path") != "license-assets.md" or output_license.get("permits_redistribution") != true:
		errors.append("Pack 0.9 requires the canonical CC0 output contract.")
	_validate_ordered(manifest.get("layers"), LAYERS, "id", "Pack 0.9 layers", errors, true)

	var atlas_paths := {}
	var atlases: Variant = manifest.get("atlases")
	if typeof(atlases) != TYPE_ARRAY or atlases.size() != ATLASES.size():
		errors.append("Pack 0.9 requires seven canonical atlases.")
	else:
		for index: int in ATLASES.size():
			var atlas: Variant = atlases[index]
			if typeof(atlas) == TYPE_DICTIONARY:
				_require_keys(atlas, ["id", "path"], "atlas", errors)
			if typeof(atlas) != TYPE_DICTIONARY or atlas.get("id") != ATLASES[index] or typeof(atlas.get("path")) != TYPE_STRING:
				errors.append("Pack 0.9 atlas inventory is not canonical.")
			else:
				atlas_paths[atlas.id] = atlas.path
	var expected_atlases := {
		"terrain": "atlases/terrain.png", "props": "atlases/props.png",
		"structures": "atlases/structures.png", "collectibles": "atlases/collectibles.png",
		"effects": "atlases/effects.png", "player": "atlases/player.png", "npc": "atlases/npc.png",
	}
	for atlas_id: String in ATLASES:
		if atlas_paths.get(atlas_id) != expected_atlases[atlas_id]:
			errors.append("Pack 0.9 atlas %s path is not canonical." % atlas_id)

	var plane_paths := {}
	var planes: Variant = manifest.get("planes")
	if typeof(planes) != TYPE_ARRAY or planes.size() != PLANES.size():
		errors.append("Pack 0.9 requires seven canonical depth planes.")
	else:
		for index: int in PLANES.size():
			var plane: Variant = planes[index]
			if typeof(plane) == TYPE_DICTIONARY:
				_require_keys(plane, ["id", "role", "path"], "plane", errors)
			if typeof(plane) != TYPE_DICTIONARY or plane.get("id") != PLANES[index] or typeof(plane.get("role")) != TYPE_STRING or typeof(plane.get("path")) != TYPE_STRING:
				errors.append("Pack 0.9 plane inventory is not canonical.")
			else:
				plane_paths[plane.id] = plane.path
	var expected_plane_paths := {
		"sky": "layers/background-sky.png", "far": "layers/background-far.png",
		"mid": "layers/background-mid.png", "depth-fog": "layers/background-depth-fog.png",
		"near": "layers/near-overlay.png", "ambient-light": "layers/lighting-ambient.png",
		"foreground": "layers/foreground-overlay.png",
	}
	for plane_id: String in PLANES:
		if plane_paths.get(plane_id) != expected_plane_paths[plane_id]:
			errors.append("Pack 0.9 plane %s path is not canonical." % plane_id)

	var role_paths := {}
	var roles: Variant = manifest.get("roles")
	if typeof(roles) != TYPE_ARRAY or roles.size() != ROLES.size():
		errors.append("Pack 0.9 requires all 36 canonical roles.")
	else:
		for index: int in ROLES.size():
			var role: Variant = roles[index]
			if typeof(role) == TYPE_DICTIONARY:
				_require_keys(role, ["role", "path"], "role", errors)
			if typeof(role) != TYPE_DICTIONARY or role.get("role") != ROLES[index] or typeof(role.get("path")) != TYPE_STRING:
				errors.append("Pack 0.9 role inventory is not canonical.")
			else:
				role_paths[role.role] = role.path
	var expected_role_paths: Array[String] = [
		"layers/background-sky.png", "layers/background-far.png", "layers/background-mid.png",
		"layers/background-depth-fog.png", "layers/near-overlay.png", "layers/foreground-overlay.png",
		"layers/lighting-ambient.png", "layers/lighting-local.png",
	]
	for _index: int in 6: expected_role_paths.append("atlases/terrain.png")
	for _index: int in 6: expected_role_paths.append("atlases/props.png")
	for _index: int in 4: expected_role_paths.append("atlases/structures.png")
	for _index: int in 2: expected_role_paths.append("atlases/collectibles.png")
	for _index: int in 4: expected_role_paths.append("atlases/effects.png")
	expected_role_paths.append_array([
		"atlases/player.png", "atlases/npc.png", "runtime/scene.json",
		"runtime/collision.json", "runtime/navigation.json", "previews/world.png",
	])
	for index: int in ROLES.size():
		if role_paths.get(ROLES[index]) != expected_role_paths[index]:
			errors.append("Role %s is not bound to its canonical Pack 0.9 asset." % ROLES[index])

	var runtime := _dict(manifest.get("runtime"), "runtime", errors)
	_require_keys(runtime, ["scene", "collision", "navigation", "spawn"], "runtime", errors)
	var runtime_paths := {}
	for key: String in ["scene", "collision", "navigation"]:
		var reference := _dict(runtime.get(key), "runtime.%s" % key, errors)
		if reference.size() != 1 or reference.get("path") != "runtime/%s.json" % key:
			errors.append("Pack 0.9 runtime.%s path is not canonical." % key)
		else:
			runtime_paths[key] = reference.path
	var spawn := _point(runtime.get("spawn"), "manifest spawn", errors)
	var referenced: Array = atlas_paths.values() + plane_paths.values() + role_paths.values() + runtime_paths.values() + [output_license.get("notice_path")]
	for path_value: Variant in referenced:
		if typeof(path_value) != TYPE_STRING or not file_index.has(path_value):
			errors.append("Pack 0.9 referenced file is absent: %s" % path_value)
	if not errors.is_empty():
		return prepared

	_validate_exact_inventory(pack_root, file_index, errors)
	var textures := {}
	for path: String in PNG_SIZES:
		if not file_index.has(path) or file_index[path].get("media_type") != "image/png":
			errors.append("Pack 0.9 PNG is absent: %s" % path)
			continue
		var loaded := _load_png(pack_root.path_join(path))
		if not loaded.ok:
			errors.append(loaded.error)
		elif loaded.image.get_size() != PNG_SIZES[path]:
			errors.append("Pack 0.9 PNG %s has invalid dimensions." % path)
		else:
			textures[path] = _texture(loaded.image)
	if not errors.is_empty():
		return prepared

	var scene_read := _read_json(pack_root.path_join(runtime_paths.scene))
	var collision_read := _read_json(pack_root.path_join(runtime_paths.collision))
	var navigation_read := _read_json(pack_root.path_join(runtime_paths.navigation))
	if not scene_read.ok: errors.append(scene_read.error)
	if not collision_read.ok: errors.append(collision_read.error)
	if not navigation_read.ok: errors.append(navigation_read.error)
	if not errors.is_empty():
		return prepared
	var scene: Dictionary = scene_read.value
	var collision: Dictionary = collision_read.value
	var navigation: Dictionary = navigation_read.value
	_require_keys(scene, ["schema_version", "profile", "completeness_policy", "bounds", "spawn", "baseline_y", "layers", "planes", "placements"], "scene sidecar", errors)
	_require_keys(collision, ["schema_version", "profile", "completeness_policy", "bounds", "spawn", "ground_segments", "blockers", "hazards"], "collision sidecar", errors)
	_require_keys(navigation, ["schema_version", "profile", "completeness_policy", "bounds", "spawn", "nodes", "edges", "exit_node_id"], "navigation sidecar", errors)
	for pair: Array in [[scene, "scene"], [collision, "collision"], [navigation, "navigation"]]:
		var sidecar: Dictionary = pair[0]
		if sidecar.get("schema_version") != RUNTIME_VERSION or sidecar.get("profile") != "layered-depth-2d" or sidecar.get("completeness_policy") != POLICY:
			errors.append("Pack 0.9 %s sidecar contract is invalid." % pair[1])
	var bounds := _rect(scene.get("bounds"), "scene bounds", errors)
	var collision_bounds := _rect(collision.get("bounds"), "collision bounds", errors)
	var navigation_bounds := _rect(navigation.get("bounds"), "navigation bounds", errors)
	if bounds != collision_bounds or bounds != navigation_bounds or bounds.size.x < 1 or bounds.size.y < 1 or bounds.end.x > 8192 or bounds.end.y > 8192:
		errors.append("Pack 0.9 runtime bounds must be shared and bounded.")
	var scene_spawn := _point(scene.get("spawn"), "scene spawn", errors)
	var collision_spawn := _point(collision.get("spawn"), "collision spawn", errors)
	var navigation_spawn := _point(navigation.get("spawn"), "navigation spawn", errors)
	if spawn != scene_spawn or spawn != collision_spawn or spawn != navigation_spawn or not bounds.has_point(Vector2(spawn)):
		errors.append("Pack 0.9 manifest and sidecars must share one in-bounds spawn.")
	_validate_ordered_strings(scene.get("layers"), LAYERS, "scene layers", errors)
	if not _integer(scene.get("baseline_y")) or int(scene.get("baseline_y", -1)) < bounds.position.y or int(scene.get("baseline_y", -1)) > bounds.end.y:
		errors.append("Pack 0.9 baseline_y must be an in-bounds integer.")
	var runtime_planes := _validate_planes(scene.get("planes"), bounds, role_paths, plane_paths, errors)
	var placements := _validate_placements(scene.get("placements"), bounds, role_paths, errors)
	var ground_segments := _validate_ground_segments(collision.get("ground_segments"), bounds, errors)
	var blockers := _validate_rect_items(collision.get("blockers"), bounds, [], "blocker", errors)
	var hazards := _validate_rect_items(collision.get("hazards"), bounds, ["contact", "fall"], "hazard", errors)
	var graph := _validate_navigation(navigation, bounds, spawn, errors)
	var characters := _validate_characters(manifest.get("characters"), textures, errors)
	if not errors.is_empty():
		return prepared

	prepared.textures = textures
	prepared.atlas_paths = atlas_paths
	prepared.plane_paths = plane_paths
	prepared.role_paths = role_paths
	prepared.bounds = bounds
	prepared.spawn = spawn
	prepared.baseline_y = int(scene.baseline_y)
	prepared.planes = runtime_planes
	prepared.placements = placements
	prepared.ground_segments = ground_segments
	prepared.blockers = blockers
	prepared.hazards = hazards
	prepared.navigation_nodes = graph.nodes
	prepared.navigation_edges = graph.edges
	prepared.exit_node_id = graph.exit_node_id
	prepared.characters = characters
	prepared.props = placements
	prepared.cell_count = ground_segments.size()
	prepared.layer_cell_counts = {}
	prepared.tile_set = _build_tileset()
	return prepared


static func _validate_planes(value: Variant, bounds: Rect2i, role_paths: Dictionary, plane_paths: Dictionary, errors: Array[String]) -> Array:
	var output: Array = []
	if typeof(value) != TYPE_ARRAY or value.size() != PLANES.size():
		errors.append("Pack 0.9 scene requires seven canonical depth planes.")
		return output
	for index: int in PLANES.size():
		var item: Variant = value[index]
		if typeof(item) != TYPE_DICTIONARY:
			errors.append("Depth plane must be an object.")
			continue
		var plane: Dictionary = item
		_require_keys(plane, ["id", "role", "layer", "scroll_ratio", "z_index", "blend", "native_size", "repeat_size", "repeat_enabled"], "depth plane", errors)
		var plane_id := str(plane.get("id", ""))
		var role := str(plane.get("role", ""))
		var ratio := _number_pair(plane.get("scroll_ratio"), "depth plane scroll_ratio", errors)
		var native_size := _array_pair(plane.get("native_size"), "depth plane native_size", errors)
		var repeat_size := _array_pair(plane.get("repeat_size"), "depth plane repeat_size", errors)
		if plane_id != PLANES[index] or not role_paths.has(role) or role_paths.get(role) != plane_paths.get(plane_id):
			errors.append("Depth plane %s is not canonically bound." % plane_id)
		if str(plane.get("layer", "")) not in LAYERS or not _integer(plane.get("z_index")) or str(plane.get("blend", "")) not in ["mix", "add", "multiply"]:
			errors.append("Depth plane %s has invalid layer, z-index or blend mode." % plane_id)
		if ratio.x < 0.0 or ratio.x > 1.5 or ratio.y < 0.0 or ratio.y > 1.5 or native_size != Vector2i(320, 180) or repeat_size != Vector2i(320, 180) or plane.get("repeat_enabled") != true:
			errors.append("Depth plane %s has invalid parallax geometry." % plane_id)
		output.append(plane.duplicate(true))
	return output


static func _validate_placements(value: Variant, bounds: Rect2i, role_paths: Dictionary, errors: Array[String]) -> Array:
	var output: Array = []
	var ids := {}
	if typeof(value) != TYPE_ARRAY or value.is_empty() or value.size() > 512:
		errors.append("Pack 0.9 placement count is invalid.")
		return output
	for item: Variant in value:
		if typeof(item) != TYPE_DICTIONARY:
			errors.append("Placement must be an object.")
			continue
		var placement: Dictionary = item
		_require_keys(placement, ["id", "role", "x", "y", "layer"], "placement", errors)
		var id := str(placement.get("id", ""))
		var role := str(placement.get("role", ""))
		var point := Vector2i(int(placement.get("x", -1)), int(placement.get("y", -1)))
		if not _asset_id(id) or ids.has(id):
			errors.append("Placement IDs must be unique safe identifiers.")
		ids[id] = true
		if not role_paths.has(role) or str(placement.get("layer", "")) not in LAYERS or not _integer(placement.get("x")) or not _integer(placement.get("y")) or not bounds.has_point(Vector2(point)):
			errors.append("Placement %s is outside the canonical Pack 0.9 scene." % id)
		output.append(placement.duplicate(true))
	return output


static func _validate_ground_segments(value: Variant, bounds: Rect2i, errors: Array[String]) -> Array:
	var output: Array = []
	var ids := {}
	if typeof(value) != TYPE_ARRAY or value.size() < 2 or value.size() > 64:
		errors.append("Pack 0.9 ground segment count is invalid.")
		return output
	for item: Variant in value:
		if typeof(item) != TYPE_DICTIONARY:
			errors.append("Ground segment must be an object.")
			continue
		var segment: Dictionary = item
		_require_keys(segment, ["id", "from", "to", "one_way"], "ground segment", errors)
		var id := str(segment.get("id", ""))
		var from := _point(segment.get("from"), "ground segment from", errors)
		var to := _point(segment.get("to"), "ground segment to", errors)
		if not _asset_id(id) or ids.has(id) or not bounds.has_point(Vector2(from)) or not bounds.has_point(Vector2(to)) or from.x >= to.x or from.y != to.y or typeof(segment.get("one_way")) != TYPE_BOOL:
			errors.append("Ground segment %s is invalid." % id)
		ids[id] = true
		output.append({"id": id, "from": from, "to": to, "one_way": segment.get("one_way", false)})
	return output


static func _validate_rect_items(value: Variant, bounds: Rect2i, kinds: Array, label: String, errors: Array[String]) -> Array:
	var output: Array = []
	var ids := {}
	if typeof(value) != TYPE_ARRAY or value.size() > 512:
		errors.append("Pack 0.9 %s count is invalid." % label)
		return output
	for item: Variant in value:
		if typeof(item) != TYPE_DICTIONARY:
			errors.append("%s must be an object." % label.capitalize())
			continue
		var record: Dictionary = item
		var expected_keys := ["id", "rect"] if kinds.is_empty() else ["id", "kind", "rect"]
		_require_keys(record, expected_keys, label, errors)
		var id := str(record.get("id", ""))
		var rect := _rect(record.get("rect"), "%s rect" % label, errors)
		if not _asset_id(id) or ids.has(id) or rect.size.x <= 0 or rect.size.y <= 0 or not bounds.encloses(rect):
			errors.append("%s %s is invalid or outside world bounds." % [label.capitalize(), id])
		if not kinds.is_empty() and str(record.get("kind", "")) not in kinds:
			errors.append("%s %s has an unsupported kind." % [label.capitalize(), id])
		ids[id] = true
		output.append({"id": id, "rect": rect, "kind": str(record.get("kind", ""))})
	return output


static func _validate_navigation(value: Dictionary, bounds: Rect2i, spawn: Vector2i, errors: Array[String]) -> Dictionary:
	var nodes: Array = []
	var edges: Array = []
	var ids := {}
	var node_values: Variant = value.get("nodes")
	if typeof(node_values) != TYPE_ARRAY or node_values.is_empty() or node_values.size() > 512:
		errors.append("Pack 0.9 navigation node count is invalid.")
	else:
		for item: Variant in node_values:
			if typeof(item) != TYPE_DICTIONARY:
				errors.append("Navigation node must be an object.")
				continue
			var node: Dictionary = item
			_require_keys(node, ["id", "x", "y", "kind"], "navigation node", errors)
			var id := str(node.get("id", ""))
			var point := Vector2i(int(node.get("x", -1)), int(node.get("y", -1)))
			if not _asset_id(id) or ids.has(id) or not _integer(node.get("x")) or not _integer(node.get("y")) or not bounds.has_point(Vector2(point)) or str(node.get("kind", "")) not in ["spawn", "route", "checkpoint", "exit"]:
				errors.append("Navigation node %s is invalid." % id)
			ids[id] = true
			nodes.append(node.duplicate(true))
	var edge_values: Variant = value.get("edges")
	if typeof(edge_values) != TYPE_ARRAY or edge_values.is_empty() or edge_values.size() > 1024:
		errors.append("Pack 0.9 navigation edge count is invalid.")
	else:
		for item: Variant in edge_values:
			if typeof(item) != TYPE_DICTIONARY:
				errors.append("Navigation edge must be an object.")
				continue
			var edge: Dictionary = item
			_require_keys(edge, ["from", "to", "kind"], "navigation edge", errors)
			if not ids.has(str(edge.get("from", ""))) or not ids.has(str(edge.get("to", ""))) or edge.get("kind") != "walk":
				errors.append("Pack 0.9 traversal edges must be walk-only and connect declared nodes.")
			edges.append(edge.duplicate(true))
	var spawn_nodes: Array = nodes.filter(func(node: Dictionary) -> bool: return node.kind == "spawn")
	var exit_id := str(value.get("exit_node_id", ""))
	var exit_nodes: Array = nodes.filter(func(node: Dictionary) -> bool: return node.id == exit_id and node.kind == "exit")
	if spawn_nodes.size() != 1 or Vector2i(spawn_nodes[0].x, spawn_nodes[0].y) != spawn or exit_nodes.size() != 1:
		errors.append("Pack 0.9 navigation requires one exact spawn and one declared exit.")
	elif not _exit_reachable(str(spawn_nodes[0].id), exit_id, edges):
		errors.append("Pack 0.9 exit must be reachable from spawn.")
	return {"nodes": nodes, "edges": edges, "exit_node_id": exit_id}


static func _exit_reachable(spawn_id: String, exit_id: String, edges: Array) -> bool:
	var reached := {spawn_id: true}
	var changed := true
	while changed:
		changed = false
		for edge: Dictionary in edges:
			if reached.has(str(edge.from)) and not reached.has(str(edge.to)):
				reached[str(edge.to)] = true
				changed = true
	return reached.has(exit_id)


static func _validate_characters(value: Variant, textures: Dictionary, errors: Array[String]) -> Array:
	var output: Array = []
	var expected := [
		{"id": "player", "atlas": "atlases/player.png", "actions": PLAYER_ACTIONS},
		{"id": "npc", "atlas": "atlases/npc.png", "actions": NPC_ACTIONS},
	]
	if typeof(value) != TYPE_ARRAY or value.size() != expected.size():
		errors.append("Pack 0.9 requires exactly one player and one NPC.")
		return output
	for character_index: int in expected.size():
		var item: Variant = value[character_index]
		if typeof(item) != TYPE_DICTIONARY:
			errors.append("Character must be an object.")
			continue
		var character: Dictionary = item
		var contract: Dictionary = expected[character_index]
		_require_keys(character, ["id", "atlas", "frame_size", "pivot", "clips"], "character", errors)
		var frame_size := _array_pair(character.get("frame_size"), "character frame_size", errors)
		var pivot := _array_pair(character.get("pivot"), "character pivot", errors)
		if character.get("id") != contract.id or character.get("atlas") != contract.atlas or frame_size != Vector2i(48, 72) or pivot != Vector2i(24, 67) or not textures.has(str(contract.atlas)):
			errors.append("Pack 0.9 character geometry or atlas is invalid.")
		var clips_value: Variant = character.get("clips")
		var expected_clip_count: int = contract.actions.size() * DIRECTIONS.size()
		if typeof(clips_value) != TYPE_ARRAY or clips_value.size() != expected_clip_count:
			errors.append("Character %s has an incomplete clip inventory." % contract.id)
			continue
		var clips: Array = []
		for action_index: int in contract.actions.size():
			for direction_index: int in DIRECTIONS.size():
				var clip_index := action_index * DIRECTIONS.size() + direction_index
				var clip_value: Variant = clips_value[clip_index]
				if typeof(clip_value) != TYPE_DICTIONARY:
					errors.append("Character clip must be an object.")
					continue
				var clip: Dictionary = clip_value
				_require_keys(clip, ["id", "action", "direction", "fps", "frames"], "character clip", errors)
				var expected_id := "%s.%s" % [contract.actions[action_index], DIRECTIONS[direction_index]]
				var frames_value: Variant = clip.get("frames")
				if clip.get("id") != expected_id or clip.get("action") != contract.actions[action_index] or clip.get("direction") != DIRECTIONS[direction_index] or not (clip.get("fps") is float or clip.get("fps") is int) or float(clip.get("fps", 0.0)) <= 0.0 or typeof(frames_value) != TYPE_ARRAY or frames_value.size() != 1:
					errors.append("Character %s clip %s is invalid." % [contract.id, expected_id])
				else:
					var frame := _point(frames_value[0], "character frame", errors)
					var atlas_size: Vector2i = PNG_SIZES[str(contract.atlas)]
					if frame.x < 0 or frame.y < 0 or frame.x + 48 > atlas_size.x or frame.y + 72 > atlas_size.y:
						errors.append("Character %s clip %s is outside its atlas." % [contract.id, expected_id])
				clips.append(clip.duplicate(true))
		output.append({
			"id": str(character.id), "atlas": str(character.atlas),
			"pivot": pivot, "clips": clips,
		})
	return output


static func _build_tileset() -> TileSet:
	var tile_set := TileSet.new()
	tile_set.tile_size = Vector2i(32, 32)
	return tile_set


static func build_scene(prepared: Dictionary) -> Dictionary:
	var root := Node2D.new()
	root.name = "MapsooWorld"
	root.set_meta("mapsoo_pack_id", prepared.pack_id)
	root.set_meta("mapsoo_profile", "layered-depth-2d")
	root.set_meta("mapsoo_schema_version", SCHEMA_VERSION)
	root.set_meta("mapsoo_bounds", prepared.bounds)
	root.set_meta("mapsoo_baseline_y", prepared.baseline_y)

	for plane: Dictionary in prepared.planes:
		var parallax := _plane_node(prepared, plane)
		root.add_child(parallax)
		parallax.owner = root
		for child: Node in parallax.get_children():
			child.owner = root

	var terrain := Node2D.new()
	terrain.name = "Terrain"
	terrain.z_index = -1
	root.add_child(terrain)
	terrain.owner = root
	_add_corridor_art(root, terrain, prepared)

	var ysorted := Node2D.new()
	ysorted.name = "YSortedGameplay"
	ysorted.y_sort_enabled = true
	ysorted.z_index = 0
	root.add_child(ysorted)
	ysorted.owner = root
	var props := Node2D.new()
	props.name = "Props"
	ysorted.add_child(props)
	props.owner = root
	var actors := Node2D.new()
	actors.name = "Actors"
	ysorted.add_child(actors)
	actors.owner = root

	var canvas_modulate := CanvasModulate.new()
	canvas_modulate.name = "AmbientCanvasModulate"
	canvas_modulate.color = Color(0.88, 0.9, 1.0, 1.0)
	root.add_child(canvas_modulate)
	canvas_modulate.owner = root
	var lighting := Node2D.new()
	lighting.name = "Lighting"
	lighting.z_index = 50
	root.add_child(lighting)
	lighting.owner = root

	for placement: Dictionary in prepared.placements:
		if placement.role == "character.npc.atlas":
			continue
		var sprite := _placement_sprite(prepared, placement)
		var parent: Node2D = lighting if placement.layer == "lighting" else props
		parent.add_child(sprite)
		sprite.owner = root

	_add_collision(root, prepared)
	_add_navigation(root, prepared)
	_add_characters(root, actors, prepared)
	return {"ok": true, "root": root, "error": ""}


static func _plane_node(prepared: Dictionary, plane: Dictionary) -> Parallax2D:
	var parallax := Parallax2D.new()
	parallax.name = "%sParallax" % _node_name(str(plane.id))
	var ratio := _number_pair(plane.scroll_ratio, "plane scroll ratio", [])
	parallax.scroll_scale = ratio
	parallax.repeat_size = Vector2(plane.repeat_size[0], plane.repeat_size[1])
	parallax.z_index = int(plane.z_index)
	var sprite := Sprite2D.new()
	sprite.name = "Visual"
	sprite.texture = prepared.textures[prepared.role_paths[str(plane.role)]]
	sprite.centered = false
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	var material := CanvasItemMaterial.new()
	material.blend_mode = {
		"add": CanvasItemMaterial.BLEND_MODE_ADD,
		"multiply": CanvasItemMaterial.BLEND_MODE_MUL,
	}.get(str(plane.blend), CanvasItemMaterial.BLEND_MODE_MIX)
	sprite.material = material
	parallax.add_child(sprite)
	return parallax


static func _add_corridor_art(root: Node2D, terrain: Node2D, prepared: Dictionary) -> void:
	var terrain_texture: Texture2D = prepared.textures["atlases/terrain.png"]
	for column: int in range(0, prepared.bounds.size.x + 64, 64):
		var atlas := AtlasTexture.new()
		atlas.atlas = terrain_texture
		atlas.region = Rect2((column / 64) % 4 * 64, 0, 64, 96)
		atlas.filter_clip = true
		var sprite := Sprite2D.new()
		sprite.name = "Ground_%03d" % (column / 64)
		sprite.texture = atlas
		sprite.position = Vector2(prepared.bounds.position.x + column + 32, prepared.baseline_y + 18)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		terrain.add_child(sprite)
		sprite.owner = root


static func _placement_sprite(prepared: Dictionary, placement: Dictionary) -> Sprite2D:
	var role := str(placement.role)
	var texture: Texture2D = prepared.textures[prepared.role_paths[role]]
	var atlas := AtlasTexture.new()
	atlas.atlas = texture
	atlas.region = _role_region(role)
	atlas.filter_clip = true
	var sprite := Sprite2D.new()
	sprite.name = _node_name(str(placement.id))
	sprite.texture = atlas
	sprite.position = Vector2(float(placement.x), float(placement.y))
	sprite.offset = Vector2(0, -atlas.region.size.y * 0.5)
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.set_meta("mapsoo_id", placement.id)
	sprite.set_meta("mapsoo_role", role)
	if role == "lighting.local":
		var material := CanvasItemMaterial.new()
		material.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		sprite.material = material
	return sprite


static func _role_region(role: String) -> Rect2:
	if role.begins_with("terrain."): return Rect2(posmod(ROLES.slice(8, 14).find(role), 4) * 64, 0, 64, 96)
	if role.begins_with("prop."): return Rect2(posmod(ROLES.slice(14, 20).find(role), 5) * 64, 0, 64, 96)
	if role.begins_with("structure."): return Rect2(posmod(ROLES.slice(20, 24).find(role), 3) * 64, 0, 64, 112)
	if role.begins_with("collectible."): return Rect2(ROLES.slice(24, 26).find(role) * 32, 0, 32, 32)
	if role.begins_with("effect."): return Rect2(ROLES.slice(26, 30).find(role) * 64, 0, 64, 64)
	if role == "lighting.local": return Rect2(0, 0, 320, 180)
	return Rect2(0, 0, 64, 96)


static func _add_collision(root: Node2D, prepared: Dictionary) -> void:
	var collision_root := Node2D.new()
	collision_root.name = "WorldCollision"
	root.add_child(collision_root)
	collision_root.owner = root
	for segment: Dictionary in prepared.ground_segments:
		if segment.one_way:
			continue
		var boundary := StaticBody2D.new()
		boundary.name = _node_name(segment.id)
		boundary.set_meta("mapsoo_id", segment.id)
		collision_root.add_child(boundary)
		boundary.owner = root
		var shape_node := CollisionShape2D.new()
		var shape := SegmentShape2D.new()
		shape.a = Vector2(segment["from"])
		shape.b = Vector2(segment.to)
		shape_node.shape = shape
		boundary.add_child(shape_node)
		shape_node.owner = root
	for item: Dictionary in prepared.blockers:
		var body := StaticBody2D.new()
		body.name = _node_name(item.id)
		body.position = Vector2(item.rect.position) + Vector2(item.rect.size) * 0.5
		body.set_meta("mapsoo_id", item.id)
		collision_root.add_child(body)
		body.owner = root
		var shape_node := CollisionShape2D.new()
		var shape := RectangleShape2D.new()
		shape.size = Vector2(item.rect.size)
		shape_node.shape = shape
		body.add_child(shape_node)
		shape_node.owner = root
	var hazards := Node2D.new()
	hazards.name = "Hazards"
	root.add_child(hazards)
	hazards.owner = root
	for item: Dictionary in prepared.hazards:
		var area := Area2D.new()
		area.name = _node_name(item.id)
		area.position = Vector2(item.rect.position) + Vector2(item.rect.size) * 0.5
		area.set_meta("mapsoo_id", item.id)
		area.set_meta("mapsoo_kind", item.kind)
		hazards.add_child(area)
		area.owner = root
		var shape_node := CollisionShape2D.new()
		var shape := RectangleShape2D.new()
		shape.size = Vector2(item.rect.size)
		shape_node.shape = shape
		area.add_child(shape_node)
		shape_node.owner = root


static func _add_navigation(root: Node2D, prepared: Dictionary) -> void:
	var corridor := _corridor_bounds(prepared)
	var navigation_region := NavigationRegion2D.new()
	navigation_region.name = "WorldNavigation"
	var polygon := NavigationPolygon.new()
	polygon.vertices = PackedVector2Array([
		corridor.position, Vector2(corridor.end.x, corridor.position.y),
		corridor.end, Vector2(corridor.position.x, corridor.end.y),
	])
	polygon.add_polygon(PackedInt32Array([0, 1, 2, 3]))
	navigation_region.navigation_polygon = polygon
	root.add_child(navigation_region)
	navigation_region.owner = root
	var graph := Node2D.new()
	graph.name = "WorldTraversal"
	graph.set_meta("mapsoo_edges", prepared.navigation_edges.duplicate(true))
	graph.set_meta("mapsoo_exit_node_id", prepared.exit_node_id)
	root.add_child(graph)
	graph.owner = root
	for node: Dictionary in prepared.navigation_nodes:
		var marker := Marker2D.new()
		marker.name = _node_name(node.id)
		marker.position = Vector2(node.x, node.y)
		marker.set_meta("mapsoo_id", node.id)
		marker.set_meta("mapsoo_kind", node.kind)
		graph.add_child(marker)
		marker.owner = root


static func _add_characters(root: Node2D, actors: Node2D, prepared: Dictionary) -> void:
	var spawn := Marker2D.new()
	spawn.name = "PlayerSpawn"
	spawn.position = Vector2(prepared.spawn)
	root.add_child(spawn)
	spawn.owner = root
	for character: Dictionary in prepared.characters:
		var body := CharacterBody2D.new()
		body.name = "Player" if character.id == "player" else "Npc"
		body.position = spawn.position if character.id == "player" else _npc_position(prepared)
		body.collision_layer = 1
		body.collision_mask = 1
		body.set_meta("mapsoo_character_id", character.id)
		actors.add_child(body)
		body.owner = root
		if character.id == "player":
			body.set_script(PlayerController)
			body.set("world_bounds", Rect2(prepared.bounds))
			body.set("movement_bounds", _corridor_bounds(prepared))
			body.set("spawn_position", spawn.position)
			var interaction := Node.new()
			interaction.name = "NpcInteraction"
			interaction.set_script(NpcInteractionController)
			body.add_child(interaction)
			interaction.owner = root
		else:
			body.set_meta("mapsoo_interaction_kind", "npc")
			body.set_meta("mapsoo_interaction_id", character.id)
		var frames := _sprite_frames(character, prepared.textures[character.atlas])
		var visual := AnimatedSprite2D.new()
		visual.name = "Visual"
		visual.sprite_frames = frames
		visual.animation = "idle_near"
		visual.offset = Vector2(0, -31)
		visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		if character.id == "player":
			visual.set_meta("mapsoo_runtime_slot_id", "player")
		body.add_child(visual)
		visual.owner = root
		var collision := CollisionShape2D.new()
		collision.name = "CollisionShape2D"
		var capsule := CapsuleShape2D.new()
		capsule.radius = 8
		capsule.height = 24
		collision.shape = capsule
		collision.position = Vector2(0, -10)
		body.add_child(collision)
		collision.owner = root
		if character.id == "player":
			var camera := Camera2D.new()
			camera.name = "Camera2D"
			body.add_child(camera)
			camera.owner = root


static func _npc_position(prepared: Dictionary) -> Vector2:
	for placement: Dictionary in prepared.placements:
		if placement.role == "character.npc.atlas":
			return Vector2(placement.x, placement.y)
	return Vector2(prepared.spawn) + Vector2(160, 0)


static func _corridor_bounds(prepared: Dictionary) -> Rect2:
	var min_x := float(prepared.bounds.position.x)
	var max_x := float(prepared.bounds.end.x)
	var min_y := float(prepared.bounds.position.y)
	var max_y := float(prepared.bounds.end.y)
	if not prepared.ground_segments.is_empty():
		min_x = INF
		max_x = -INF
		min_y = INF
		max_y = -INF
		for segment: Dictionary in prepared.ground_segments:
			min_x = minf(min_x, float(segment["from"].x))
			max_x = maxf(max_x, float(segment.to.x))
			min_y = minf(min_y, float(segment["from"].y))
			max_y = maxf(max_y, float(segment["from"].y))
	return Rect2(min_x, min_y, max_x - min_x, max_y - min_y)


static func _sprite_frames(character: Dictionary, texture: Texture2D) -> SpriteFrames:
	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	for clip: Dictionary in character.clips:
		var animation_name := str(clip.id).replace(".", "_")
		frames.add_animation(animation_name)
		frames.set_animation_speed(animation_name, float(clip.fps))
		frames.set_animation_loop(animation_name, clip.action not in ["interact", "talk"])
		for frame: Dictionary in clip.frames:
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(frame.x, frame.y, 48, 72)
			atlas.filter_clip = true
			frames.add_frame(animation_name, atlas)
	return frames


static func validate_staged_scene(world: Node, expected_placements: int) -> Dictionary:
	var valid: bool = world.name == "MapsooWorld" and world.get_meta("mapsoo_profile", "") == "layered-depth-2d" and world.get_meta("mapsoo_schema_version", "") == SCHEMA_VERSION
	var ysorted := world.get_node_or_null("YSortedGameplay") as Node2D
	valid = valid and ysorted != null and ysorted.get_parent() == world and ysorted.y_sort_enabled
	valid = valid and world.get_node_or_null("SkyParallax") is Parallax2D and world.get_node_or_null("FarParallax") is Parallax2D and world.get_node_or_null("MidParallax") is Parallax2D
	valid = valid and world.get_node_or_null("NearParallax") is Parallax2D and world.get_node_or_null("ForegroundParallax") is Parallax2D
	valid = valid and world.get_node_or_null("DepthFogParallax") is Parallax2D and world.get_node_or_null("AmbientLightParallax") is Parallax2D
	valid = valid and world.get_node_or_null("AmbientCanvasModulate") is CanvasModulate and world.get_node_or_null("Lighting") is Node2D
	valid = valid and world.get_node_or_null("YSortedGameplay/Props") is Node2D and world.get_node_or_null("YSortedGameplay/Actors") is Node2D
	var player := world.get_node_or_null("YSortedGameplay/Actors/Player") as CharacterBody2D
	var npc := world.get_node_or_null("YSortedGameplay/Actors/Npc") as CharacterBody2D
	valid = valid and player != null and player.get_script() == PlayerController and player.get_node_or_null("NpcInteraction") != null and player.get_node("NpcInteraction").get_script() == NpcInteractionController and npc != null and str(npc.get_meta("mapsoo_interaction_kind", "")) == "npc" and world.get_node_or_null("PlayerSpawn") is Marker2D
	valid = valid and world.get_node_or_null("WorldCollision") is Node2D and world.get_node_or_null("Hazards") is Node2D and world.get_node_or_null("WorldNavigation") is NavigationRegion2D and world.get_node_or_null("WorldTraversal") is Node2D
	for actor: CharacterBody2D in [player, npc]:
		if actor == null:
			continue
		var visual := actor.get_node_or_null("Visual") as AnimatedSprite2D
		valid = valid and visual != null and visual.sprite_frames != null
		if actor == player and visual != null:
			valid = valid and str(visual.get_meta("mapsoo_runtime_slot_id", "")) == "player"
		var actions := PLAYER_ACTIONS if actor == player else NPC_ACTIONS
		if visual != null and visual.sprite_frames != null:
			for action: String in actions:
				for direction: String in DIRECTIONS:
					var animation_name := "%s_%s" % [action, direction]
					valid = valid and visual.sprite_frames.has_animation(animation_name) and visual.sprite_frames.get_frame_count(animation_name) > 0
					if visual.sprite_frames.has_animation(animation_name):
						for frame_index: int in visual.sprite_frames.get_frame_count(animation_name):
							valid = valid and _texture_has_persisted_pixels(visual.sprite_frames.get_frame_texture(animation_name, frame_index))
	var placement_count := 0
	for child: Node in world.get_node("YSortedGameplay/Props").get_children():
		if child.has_meta("mapsoo_id"): placement_count += 1
	for child: Node in world.get_node("Lighting").get_children():
		if child.has_meta("mapsoo_id"): placement_count += 1
	valid = valid and placement_count == expected_placements - 1
	return {"ok": valid, "error": "" if valid else "Staged Pack 0.9 scene is incomplete."}


static func _texture_has_persisted_pixels(value: Texture2D) -> bool:
	var texture := value
	if texture is AtlasTexture:
		texture = (texture as AtlasTexture).atlas
	if texture == null:
		return false
	var image := texture.get_image()
	return image != null and not image.is_empty() and not image.get_data().is_empty()


static func _validate_exact_inventory(pack_root: String, file_index: Dictionary, errors: Array[String]) -> void:
	var actual: Array[String] = []
	_collect_files(ProjectSettings.globalize_path(pack_root), "", actual)
	actual.sort()
	var expected: Array[String] = ["mapsoo.manifest.json"]
	for key: Variant in file_index.keys(): expected.append(str(key))
	expected.sort()
	if actual != expected:
		errors.append("Pack 0.9 directory must contain exactly the manifest-declared files.")


static func _collect_files(directory_path: String, prefix: String, output: Array[String]) -> void:
	var directory := DirAccess.open(directory_path)
	if directory == null: return
	for file: String in directory.get_files(): output.append(prefix.path_join(file) if not prefix.is_empty() else file)
	for child: String in directory.get_directories(): _collect_files(directory_path.path_join(child), prefix.path_join(child) if not prefix.is_empty() else child, output)


static func _load_png(path: String) -> Dictionary:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty(): return {"ok": false, "error": "Unable to read Pack 0.9 PNG: %s" % path}
	var image := Image.new()
	var error := image.load_png_from_buffer(bytes)
	return {"ok": error == OK, "image": image, "error": "Unable to decode Pack 0.9 PNG: %s" % path}


static func _texture(image: Image) -> PortableCompressedTexture2D:
	var texture := PortableCompressedTexture2D.new()
	texture.keep_compressed_buffer = true
	texture.create_from_image(image, PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS)
	return texture


static func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"ok": false, "error": "Pack 0.9 JSON is absent: %s" % path}
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK or typeof(parser.data) != TYPE_DICTIONARY:
		return {"ok": false, "error": "Pack 0.9 JSON is invalid: %s" % path}
	return {"ok": true, "value": parser.data}


static func _dict(value: Variant, label: String, errors: Array[String]) -> Dictionary:
	if typeof(value) != TYPE_DICTIONARY:
		errors.append("%s must be an object." % label)
		return {}
	return value


static func _require_keys(value: Dictionary, expected: Array, label: String, errors: Array[String]) -> void:
	var actual: Array = value.keys()
	actual.sort()
	var canonical := expected.duplicate()
	canonical.sort()
	if actual != canonical:
		errors.append("%s must contain exactly: %s." % [label, ", ".join(expected)])


static func _point(value: Variant, label: String, errors: Array[String]) -> Vector2i:
	var point := _dict(value, label, errors)
	_require_keys(point, ["x", "y"], label, errors)
	if not _integer(point.get("x")) or not _integer(point.get("y")):
		errors.append("%s coordinates must be integers." % label)
	return Vector2i(int(point.get("x", -1)), int(point.get("y", -1)))


static func _rect(value: Variant, label: String, errors: Array[String]) -> Rect2i:
	var rect := _dict(value, label, errors)
	_require_keys(rect, ["x", "y", "width", "height"], label, errors)
	for key: String in ["x", "y", "width", "height"]:
		if not _integer(rect.get(key)):
			errors.append("%s values must be integers." % label)
	return Rect2i(int(rect.get("x", -1)), int(rect.get("y", -1)), int(rect.get("width", -1)), int(rect.get("height", -1)))


static func _array_pair(value: Variant, label: String, errors: Array[String]) -> Vector2i:
	if typeof(value) != TYPE_ARRAY or value.size() != 2 or not _integer(value[0]) or not _integer(value[1]):
		errors.append("%s must contain two integers." % label)
		return Vector2i(-1, -1)
	return Vector2i(int(value[0]), int(value[1]))


static func _number_pair(value: Variant, label: String, errors: Array[String]) -> Vector2:
	if typeof(value) != TYPE_ARRAY or value.size() != 2 or not (value[0] is float or value[0] is int) or not (value[1] is float or value[1] is int):
		errors.append("%s must contain two numbers." % label)
		return Vector2(-1, -1)
	return Vector2(float(value[0]), float(value[1]))


static func _validate_ordered(value: Variant, expected: Array, key: String, label: String, errors: Array[String], require_order: bool) -> void:
	if typeof(value) != TYPE_ARRAY or value.size() != expected.size():
		errors.append("%s inventory is incomplete." % label)
		return
	for index: int in expected.size():
		var item: Variant = value[index]
		if typeof(item) != TYPE_DICTIONARY or item.get(key) != expected[index] or (require_order and item.get("order") != index):
			errors.append("%s inventory is not canonical." % label)
			return
		_require_keys(item, [key, "order"] if require_order else [key], label, errors)


static func _validate_ordered_strings(value: Variant, expected: Array, label: String, errors: Array[String]) -> void:
	if typeof(value) != TYPE_ARRAY or value != expected:
		errors.append("%s inventory is not canonical." % label)


static func _integer(value: Variant) -> bool:
	return typeof(value) == TYPE_INT or (typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value))


static func _pack_id(value: String) -> bool:
	if value.is_empty() or value.length() > 80 or value[0] == "-" or value[-1] == "-":
		return false
	for character: String in value:
		if not (character >= "a" and character <= "z") and not (character >= "0" and character <= "9") and character != "-":
			return false
	return not value.contains("--")


static func _asset_id(value: String) -> bool:
	return _pack_id(value)


static func _node_name(value: String) -> String:
	var words := value.replace("_", "-").split("-", false)
	var result := ""
	for word: String in words:
		result += word.capitalize()
	return result
