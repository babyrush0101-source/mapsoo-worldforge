@tool
extends RefCounted

const PACK_VERSION := "0.1.0-alpha.11"
const SCHEMA_VERSION := "0.8.0"
const RUNTIME_VERSION := "0.3.0"
const POLICY := "isometric-action-complete-v1"
const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_isometric_player_controller.gd")
const LAYERS := ["void", "floor", "elevation", "walls", "props", "actors", "effects"]
const ATLASES := ["terrain", "hazards", "props", "structures", "collectibles", "effects", "shadows", "player", "enemy-melee", "enemy-ranged"]
const DIRECTIONS := ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
const PLAYER_ACTIONS := ["idle", "move", "attack-primary", "dash", "hurt", "defeat"]
const ENEMY_ACTIONS := ["idle", "move", "attack-primary", "hurt", "defeat"]
const ROLES := [
	"terrain.void", "terrain.floor.base", "terrain.floor.variant", "terrain.floor.edge",
	"terrain.elevation.top", "terrain.elevation.riser-left", "terrain.elevation.riser-right",
	"terrain.ramp", "terrain.wall", "hazard.contact", "hazard.telegraph",
	"prop.blocker", "prop.breakable", "prop.cover", "prop.decoration", "prop.light",
	"structure.entrance", "structure.exit", "structure.checkpoint",
	"collectible.primary", "collectible.health", "effect.player-attack", "effect.enemy-attack",
	"effect.projectile", "effect.impact", "effect.dash", "effect.spawn", "effect.defeat",
	"effect.shadow", "character.player.atlas", "character.enemy-melee.atlas",
	"character.enemy-ranged.atlas", "world.scene", "world.collision", "world.navigation", "world.preview",
]
const PNG_SIZES := {
	"atlases/terrain.png": Vector2i(576, 64),
	"atlases/hazards.png": Vector2i(128, 64),
	"atlases/props.png": Vector2i(320, 96),
	"atlases/structures.png": Vector2i(192, 96),
	"atlases/collectibles.png": Vector2i(64, 32),
	"atlases/effects.png": Vector2i(448, 64),
	"atlases/shadows.png": Vector2i(64, 32),
	"atlases/player.png": Vector2i(2304, 64),
	"atlases/enemy-melee.png": Vector2i(1920, 64),
	"atlases/enemy-ranged.png": Vector2i(1920, 64),
	"previews/world.png": Vector2i(640, 360),
}


static func validate_and_prepare(manifest: Dictionary, pack_root: String, prepared: Dictionary, file_index: Dictionary) -> Dictionary:
	var errors: Array[String] = prepared.errors
	var manifest_keys := ["schema_version", "pack", "profile", "completeness_policy", "compatibility", "layers", "atlases", "roles", "characters", "runtime", "files", "license", "provenance"]
	if manifest.has("layout"): manifest_keys.append("layout")
	if manifest.has("material_palette"): manifest_keys.append("material_palette")
	_require_keys(manifest, manifest_keys, "Pack 0.8 manifest", errors)
	var pack := _dict(manifest.get("pack"), "pack", errors)
	var compatibility := _dict(manifest.get("compatibility"), "compatibility", errors)
	var importer := _dict(compatibility.get("importer"), "compatibility.importer", errors)
	var license := _dict(manifest.get("license"), "license", errors)
	var output_license := _dict(license.get("output"), "license.output", errors)
	_require_keys(pack, ["id", "title", "version", "generator", "created_at"], "pack", errors)
	var generator := _dict(pack.get("generator"), "pack.generator", errors)
	_require_keys(generator, ["name", "version"], "pack.generator", errors)
	_require_keys(compatibility, ["godot_min", "grid", "art_style", "importer"], "compatibility", errors)
	_require_keys(importer, ["id", "min_version"], "compatibility.importer", errors)
	_require_keys(license, ["output"], "license", errors)
	_require_keys(output_license, ["id", "notice_path", "permits_redistribution"], "license.output", errors)
	if not _pack_id(str(pack.get("id", ""))):
		errors.append("Pack 0.8 pack.id must be lowercase kebab-case ASCII.")
	else:
		prepared.pack_id = pack.id
	if pack.get("version") != PACK_VERSION or generator.get("name") != "Mapsoo Worldsmith" or generator.get("version") != PACK_VERSION:
		errors.append("Pack 0.8 must identify Mapsoo Worldsmith Alpha11.")
	if manifest.get("profile") != "isometric-action" or manifest.get("completeness_policy") != POLICY:
		errors.append("Pack 0.8 requires the complete isometric-action profile.")
	if compatibility.get("godot_min") != "4.3" or compatibility.get("grid") != "diamond-64x32" or compatibility.get("art_style") != "pixel_art" or importer.get("id") != "mapsoo_importer" or importer.get("min_version") != PACK_VERSION:
		errors.append("Pack 0.8 compatibility contract is unsupported.")
	var public_license: bool = output_license.get("id") == "CC0-1.0" and output_license.get("notice_path") == "license-assets.md" and output_license.get("permits_redistribution") == true
	var review_license: bool = output_license.get("id") == "LicenseRef-UNRELEASED" and output_license.get("notice_path") == "license-assets.md" and output_license.get("permits_redistribution") == false
	if not public_license and not review_license:
		errors.append("Pack 0.8 requires the canonical public or internal-review output contract.")
	var provenance := _dict(manifest.get("provenance"), "provenance", errors)
	var provider := _dict(provenance.get("provider"), "provenance.provider", errors)
	_require_keys(provenance, ["provider", "output_provenance", "contains_generative_ai", "model_provider", "model", "seed", "human_curated"], "provenance", errors)
	_require_keys(provider, ["id", "version"], "provenance.provider", errors)
	if not _asset_id(str(provider.get("id", ""))) or str(provider.get("version", "")).is_empty() or provenance.get("output_provenance") not in ["procedural", "generative-ai", "hybrid"] or typeof(provenance.get("contains_generative_ai")) != TYPE_BOOL or typeof(provenance.get("human_curated")) != TYPE_BOOL or typeof(provenance.get("seed")) != TYPE_STRING or str(provenance.get("seed", "")).is_empty():
		errors.append("Pack 0.8 provenance contract is invalid.")
	if review_license and (provenance.get("contains_generative_ai") != true or provenance.get("output_provenance") not in ["generative-ai", "hybrid"] or typeof(provenance.get("model_provider")) != TYPE_STRING or str(provenance.get("model_provider", "")).is_empty() or typeof(provenance.get("model")) != TYPE_STRING or str(provenance.get("model", "")).is_empty() or provenance.get("human_curated") != false):
		errors.append("Pack 0.8 internal-review provenance contract is invalid.")
	_validate_ordered(manifest.get("layers"), LAYERS, "id", "Pack 0.8 layers", errors, true)

	var atlas_paths := {}
	var atlases: Variant = manifest.get("atlases")
	if typeof(atlases) != TYPE_ARRAY or atlases.size() != ATLASES.size():
		errors.append("Pack 0.8 requires ten canonical atlases.")
	else:
		for index: int in ATLASES.size():
			var atlas: Variant = atlases[index]
			if typeof(atlas) == TYPE_DICTIONARY:
				_require_keys(atlas, ["id", "path"], "atlas", errors)
			if typeof(atlas) != TYPE_DICTIONARY or atlas.get("id") != ATLASES[index] or typeof(atlas.get("path")) != TYPE_STRING:
				errors.append("Pack 0.8 atlas inventory is not canonical.")
			else:
				atlas_paths[atlas.id] = atlas.path

	var role_paths := {}
	var roles: Variant = manifest.get("roles")
	if typeof(roles) != TYPE_ARRAY or roles.size() != ROLES.size():
		errors.append("Pack 0.8 requires all 36 canonical roles.")
	else:
		for index: int in ROLES.size():
			var role: Variant = roles[index]
			if typeof(role) == TYPE_DICTIONARY:
				_require_keys(role, ["role", "path"], "role", errors)
			if typeof(role) != TYPE_DICTIONARY or role.get("role") != ROLES[index] or typeof(role.get("path")) != TYPE_STRING:
				errors.append("Pack 0.8 role inventory is not canonical.")
			else:
				role_paths[role.role] = role.path

	var expected_atlases := {
		"terrain": "atlases/terrain.png", "hazards": "atlases/hazards.png", "props": "atlases/props.png",
		"structures": "atlases/structures.png", "collectibles": "atlases/collectibles.png",
		"effects": "atlases/effects.png", "shadows": "atlases/shadows.png",
		"player": "atlases/player.png", "enemy-melee": "atlases/enemy-melee.png",
		"enemy-ranged": "atlases/enemy-ranged.png",
	}
	for atlas_id: String in ATLASES:
		if atlas_paths.get(atlas_id) != expected_atlases[atlas_id]:
			errors.append("Pack 0.8 atlas %s path is not canonical." % atlas_id)
	var expected_role_paths: Array[String] = []
	for index: int in ROLES.size():
		if index < 9: expected_role_paths.append("atlases/terrain.png")
		elif index < 11: expected_role_paths.append("atlases/hazards.png")
		elif index < 16: expected_role_paths.append("atlases/props.png")
		elif index < 19: expected_role_paths.append("atlases/structures.png")
		elif index < 21: expected_role_paths.append("atlases/collectibles.png")
		elif index < 28: expected_role_paths.append("atlases/effects.png")
		elif index == 28: expected_role_paths.append("atlases/shadows.png")
		elif index == 29: expected_role_paths.append("atlases/player.png")
		elif index == 30: expected_role_paths.append("atlases/enemy-melee.png")
		elif index == 31: expected_role_paths.append("atlases/enemy-ranged.png")
		elif index == 32: expected_role_paths.append("runtime/scene.json")
		elif index == 33: expected_role_paths.append("runtime/collision.json")
		elif index == 34: expected_role_paths.append("runtime/navigation.json")
		else: expected_role_paths.append("previews/world.png")
	for index: int in ROLES.size():
		if role_paths.get(ROLES[index]) != expected_role_paths[index]:
			errors.append("Role %s is not bound to its canonical Pack 0.8 asset." % ROLES[index])

	var runtime := _dict(manifest.get("runtime"), "runtime", errors)
	_require_keys(runtime, ["scene", "collision", "navigation", "spawn"], "runtime", errors)
	var runtime_paths := {}
	for key: String in ["scene", "collision", "navigation"]:
		var reference := _dict(runtime.get(key), "runtime.%s" % key, errors)
		if reference.size() != 1 or reference.get("path") != "runtime/%s.json" % key:
			errors.append("Pack 0.8 runtime.%s path is not canonical." % key)
		else:
			runtime_paths[key] = reference.path
	var spawn := _point(runtime.get("spawn"), "manifest spawn", errors)
	var referenced: Array = atlas_paths.values() + role_paths.values() + runtime_paths.values() + [output_license.get("notice_path")]
	for path_value: Variant in referenced:
		if typeof(path_value) != TYPE_STRING or not file_index.has(path_value):
			errors.append("Pack 0.8 referenced file is absent: %s" % path_value)
	if not errors.is_empty():
		return prepared

	_validate_exact_inventory(pack_root, file_index, errors)
	var textures := {}
	for path: String in PNG_SIZES:
		if not file_index.has(path) or file_index[path].get("media_type") != "image/png":
			errors.append("Pack 0.8 PNG is absent: %s" % path)
			continue
		var loaded := _load_png(pack_root.path_join(path))
		if not loaded.ok:
			errors.append(loaded.error)
		elif loaded.image.get_size() != PNG_SIZES[path]:
			errors.append("Pack 0.8 PNG %s has invalid dimensions." % path)
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
	_require_keys(scene, ["schema_version", "profile", "completeness_policy", "bounds", "grid", "spawn", "layers", "floor_cells", "placements"], "scene sidecar", errors)
	_require_keys(collision, ["schema_version", "profile", "completeness_policy", "bounds", "spawn", "walkable_polygon", "blockers", "hazards"], "collision sidecar", errors)
	_require_keys(navigation, ["schema_version", "profile", "completeness_policy", "bounds", "spawn", "nodes", "edges", "exit_node_id"], "navigation sidecar", errors)
	for pair: Array in [[scene, "scene"], [collision, "collision"], [navigation, "navigation"]]:
		var sidecar: Dictionary = pair[0]
		if sidecar.get("schema_version") != RUNTIME_VERSION or sidecar.get("profile") != "isometric-action" or sidecar.get("completeness_policy") != POLICY:
			errors.append("Pack 0.8 %s sidecar contract is invalid." % pair[1])
	var bounds := _rect(scene.get("bounds"), "scene bounds", errors)
	var collision_bounds := _rect(collision.get("bounds"), "collision bounds", errors)
	var navigation_bounds := _rect(navigation.get("bounds"), "navigation bounds", errors)
	if bounds != collision_bounds or bounds != navigation_bounds or bounds.size.x < 1 or bounds.size.y < 1 or bounds.end.x > 8192 or bounds.end.y > 8192:
		errors.append("Pack 0.8 runtime bounds must be shared and bounded.")
	var scene_spawn := _point(scene.get("spawn"), "scene spawn", errors)
	var collision_spawn := _point(collision.get("spawn"), "collision spawn", errors)
	var navigation_spawn := _point(navigation.get("spawn"), "navigation spawn", errors)
	if spawn != scene_spawn or spawn != collision_spawn or spawn != navigation_spawn or not bounds.has_point(Vector2(spawn)):
		errors.append("Pack 0.8 manifest and sidecars must share one in-bounds spawn.")
	_validate_ordered_strings(scene.get("layers"), LAYERS, "scene layers", errors)
	var grid := _dict(scene.get("grid"), "scene grid", errors)
	_require_keys(grid, ["tile_width", "tile_height", "elevation_height", "columns", "rows"], "scene grid", errors)
	if grid.get("tile_width") != 64 or grid.get("tile_height") != 32 or grid.get("elevation_height") != 16 or not _integer(grid.get("columns")) or not _integer(grid.get("rows")) or int(grid.get("columns", 0)) < 4 or int(grid.get("rows", 0)) < 4:
		errors.append("Pack 0.8 requires a bounded 64x32 diamond grid.")
	var floor_cells := _validate_cells(scene.get("floor_cells"), grid, errors)
	var placements := _validate_placements(scene.get("placements"), bounds, role_paths, errors)
	var blockers := _validate_rect_items(collision.get("blockers"), bounds, [], "blocker", errors)
	var hazards := _validate_rect_items(collision.get("hazards"), bounds, ["trap", "area"], "hazard", errors)
	var walkable := _validate_polygon(collision.get("walkable_polygon"), bounds, "walkable polygon", errors)
	var graph := _validate_navigation(navigation, bounds, spawn, errors)
	var characters := _validate_characters(manifest.get("characters"), textures, errors)
	if not errors.is_empty():
		return prepared

	prepared.textures = textures
	prepared.atlas_paths = atlas_paths
	prepared.role_paths = role_paths
	prepared.bounds = bounds
	prepared.spawn = spawn
	prepared.grid = grid.duplicate(true)
	prepared.floor_cells = floor_cells
	prepared.placements = placements
	prepared.blockers = blockers
	prepared.hazards = hazards
	prepared.walkable_polygon = walkable
	prepared.navigation_nodes = graph.nodes
	prepared.navigation_edges = graph.edges
	prepared.exit_node_id = graph.exit_node_id
	prepared.characters = characters
	prepared.props = placements
	prepared.cell_count = floor_cells.size()
	prepared.layer_cell_counts = {}
	prepared.tile_set = _build_tileset()
	return prepared


static func _validate_cells(value: Variant, grid: Dictionary, errors: Array[String]) -> Array:
	var output: Array = []
	var ids := {}
	if typeof(value) != TYPE_ARRAY or value.is_empty() or value.size() > 16384:
		errors.append("Pack 0.8 floor cell count is invalid.")
		return output
	for cell_value: Variant in value:
		if typeof(cell_value) != TYPE_DICTIONARY:
			errors.append("Floor cell must be an object.")
			continue
		var cell: Dictionary = cell_value
		_require_keys(cell, ["column", "row", "elevation"], "floor cell", errors)
		var column := int(cell.get("column", -1))
		var row := int(cell.get("row", -1))
		var elevation := int(cell.get("elevation", -1))
		var key := "%d:%d" % [column, row]
		if not _integer(cell.get("column")) or not _integer(cell.get("row")) or not _integer(cell.get("elevation")) or column < 0 or row < 0 or column >= int(grid.get("columns", 0)) or row >= int(grid.get("rows", 0)) or elevation < 0 or elevation > 8 or ids.has(key):
			errors.append("Floor cell is invalid or duplicated: %s" % key)
			continue
		ids[key] = true
		output.append(cell.duplicate(true))
	return output


static func _validate_placements(value: Variant, bounds: Rect2i, role_paths: Dictionary, errors: Array[String]) -> Array:
	var output: Array = []
	var ids := {}
	if typeof(value) != TYPE_ARRAY or value.is_empty() or value.size() > 512:
		errors.append("Pack 0.8 placements are invalid.")
		return output
	for item_value: Variant in value:
		if typeof(item_value) != TYPE_DICTIONARY:
			errors.append("Placement must be an object.")
			continue
		var item: Dictionary = item_value
		_require_keys(item, ["id", "role", "layer", "column", "row", "elevation", "x", "y"], "placement", errors)
		var id := str(item.get("id", ""))
		var point := Vector2i(int(item.get("x", -1)), int(item.get("y", -1)))
		if not _asset_id(id) or ids.has(id) or not role_paths.has(item.get("role")) or item.get("layer") not in LAYERS or not _integer(item.get("x")) or not _integer(item.get("y")) or not bounds.has_point(Vector2(point)):
			errors.append("Placement is invalid or duplicated: %s" % id)
			continue
		ids[id] = true
		output.append(item.duplicate(true))
	return output


static func _validate_rect_items(value: Variant, bounds: Rect2i, kinds: Array, label: String, errors: Array[String]) -> Array:
	var output: Array = []
	var ids := {}
	if typeof(value) != TYPE_ARRAY or value.size() > 512:
		errors.append("Pack 0.8 %ss exceed their limit." % label)
		return output
	for item_value: Variant in value:
		if typeof(item_value) != TYPE_DICTIONARY:
			errors.append("%s must be an object." % label)
			continue
		var item: Dictionary = item_value
		var expected_keys := ["id", "rect"] if kinds.is_empty() else ["id", "kind", "rect"]
		_require_keys(item, expected_keys, label, errors)
		var id := str(item.get("id", ""))
		var rect := _rect(item.get("rect"), "%s rect" % label, errors)
		if not _asset_id(id) or ids.has(id) or (not kinds.is_empty() and item.get("kind") not in kinds) or rect.size.x < 1 or rect.size.y < 1 or not bounds.encloses(rect):
			errors.append("%s is invalid or duplicated: %s" % [label, id])
			continue
		ids[id] = true
		var stored := item.duplicate(true)
		stored.rect = rect
		output.append(stored)
	return output


static func _validate_polygon(value: Variant, bounds: Rect2i, label: String, errors: Array[String]) -> PackedVector2Array:
	var output := PackedVector2Array()
	if typeof(value) != TYPE_ARRAY or value.size() < 3 or value.size() > 16:
		errors.append("%s requires 3..16 points." % label)
		return output
	for point_value: Variant in value:
		var point := _point(point_value, label, errors)
		if not bounds.has_point(Vector2(point)):
			errors.append("%s point is outside bounds." % label)
		output.append(Vector2(point))
	return output


static func _validate_navigation(value: Dictionary, bounds: Rect2i, spawn: Vector2i, errors: Array[String]) -> Dictionary:
	var nodes: Array = []
	var edges: Array = []
	var ids := {}
	var spawn_ids: Array[String] = []
	var nodes_value: Variant = value.get("nodes")
	if typeof(nodes_value) != TYPE_ARRAY or nodes_value.size() < 2 or nodes_value.size() > 512:
		errors.append("Pack 0.8 navigation nodes are invalid.")
	else:
		for node_value: Variant in nodes_value:
			if typeof(node_value) != TYPE_DICTIONARY:
				errors.append("Navigation node must be an object.")
				continue
			var node: Dictionary = node_value
			_require_keys(node, ["id", "x", "y", "elevation", "kind"], "navigation node", errors)
			var id := str(node.get("id", ""))
			var point := Vector2i(int(node.get("x", -1)), int(node.get("y", -1)))
			if not _asset_id(id) or ids.has(id) or node.get("kind") not in ["spawn", "route", "checkpoint", "exit"] or not bounds.has_point(Vector2(point)):
				errors.append("Navigation node is invalid or duplicated: %s" % id)
				continue
			ids[id] = true
			if node.kind == "spawn": spawn_ids.append(id)
			nodes.append(node.duplicate(true))
	var edges_value: Variant = value.get("edges")
	if typeof(edges_value) != TYPE_ARRAY or edges_value.is_empty() or edges_value.size() > 2048:
		errors.append("Pack 0.8 navigation edges are invalid.")
	else:
		for edge_value: Variant in edges_value:
			if typeof(edge_value) != TYPE_DICTIONARY:
				errors.append("Navigation edge must be an object.")
				continue
			var edge: Dictionary = edge_value
			_require_keys(edge, ["from", "to", "kind"], "navigation edge", errors)
			if not ids.has(edge.get("from")) or not ids.has(edge.get("to")) or edge.get("kind") not in ["walk", "stairs", "dash"]:
				errors.append("Navigation edge is invalid.")
				continue
			edges.append(edge.duplicate(true))
	var exit_id := str(value.get("exit_node_id", ""))
	var spawn_id := spawn_ids[0] if spawn_ids.size() == 1 else ""
	var exit_ok := false
	for node: Dictionary in nodes:
		if node.id == spawn_id and (Vector2i(node.x, node.y) != spawn or node.kind != "spawn"):
			errors.append("Navigation spawn node must match runtime spawn.")
		if node.id == exit_id and node.kind == "exit":
			exit_ok = true
	if spawn_ids.size() != 1 or not exit_ok:
		errors.append("Pack 0.8 requires one spawn and its declared exit.")
	if not spawn_id.is_empty() and exit_ok:
		var reached := {spawn_id: true}
		var changed := true
		while changed:
			changed = false
			for edge: Dictionary in edges:
				if reached.has(edge.from) and not reached.has(edge.to):
					reached[edge.to] = true
					changed = true
		if not reached.has(exit_id):
			errors.append("Pack 0.8 exit is unreachable from spawn.")
	return {"nodes": nodes, "edges": edges, "exit_node_id": exit_id}


static func _validate_characters(value: Variant, textures: Dictionary, errors: Array[String]) -> Array:
	var output: Array = []
	var expected := [
		{"id": "player", "atlas": "atlases/player.png", "actions": PLAYER_ACTIONS},
		{"id": "enemy-melee", "atlas": "atlases/enemy-melee.png", "actions": ENEMY_ACTIONS},
		{"id": "enemy-ranged", "atlas": "atlases/enemy-ranged.png", "actions": ENEMY_ACTIONS},
	]
	if typeof(value) != TYPE_ARRAY or value.size() != expected.size():
		errors.append("Pack 0.8 requires three canonical characters.")
		return output
	for character_index: int in expected.size():
		var character: Variant = value[character_index]
		var contract: Dictionary = expected[character_index]
		if typeof(character) != TYPE_DICTIONARY:
			errors.append("Character must be an object.")
			continue
		_require_keys(character, ["id", "atlas", "frame_size", "pivot", "clips"], "character", errors)
		if character.get("id") != contract.id or character.get("atlas") != contract.atlas or _array_pair(character.get("frame_size"), "frame_size", errors) != Vector2i(48, 64) or _array_pair(character.get("pivot"), "pivot", errors) != Vector2i(24, 58) or not textures.has(contract.atlas):
			errors.append("Pack 0.8 character contract is invalid: %s" % contract.id)
		var clips: Variant = character.get("clips")
		var expected_count: int = contract.actions.size() * DIRECTIONS.size()
		if typeof(clips) != TYPE_ARRAY or clips.size() != expected_count:
			errors.append("Character %s clip count is invalid." % contract.id)
			continue
		for action_index: int in contract.actions.size():
			for direction_index: int in DIRECTIONS.size():
				var clip_index: int = action_index * DIRECTIONS.size() + direction_index
				var clip: Variant = clips[clip_index]
				var clip_id := "%s.%s" % [contract.actions[action_index], DIRECTIONS[direction_index]]
				if typeof(clip) != TYPE_DICTIONARY:
					errors.append("Character clip must be an object.")
					continue
				_require_keys(clip, ["id", "action", "direction", "fps", "frames"], "character clip", errors)
				if clip.get("id") != clip_id or clip.get("action") != contract.actions[action_index] or clip.get("direction") != DIRECTIONS[direction_index] or typeof(clip.get("fps")) not in [TYPE_INT, TYPE_FLOAT] or float(clip.get("fps", 0)) <= 0:
					errors.append("Character clip is invalid: %s" % clip_id)
				var frames: Variant = clip.get("frames")
				if typeof(frames) != TYPE_ARRAY or frames.is_empty() or frames.size() > 16:
					errors.append("Character clip frames are invalid: %s" % clip_id)
					continue
				for frame_value: Variant in frames:
					var frame := _point(frame_value, "character frame", errors)
					if frame.x + 48 > (textures[contract.atlas] as Texture2D).get_width() or frame.y + 64 > 64:
						errors.append("Character frame is outside its atlas: %s" % clip_id)
		output.append(character.duplicate(true))
	return output


static func _build_tileset() -> TileSet:
	var tile_set := TileSet.new()
	tile_set.tile_size = Vector2i(64, 32)
	return tile_set


static func build_scene(prepared: Dictionary) -> Dictionary:
	var root := Node2D.new()
	root.name = "MapsooWorld"
	root.set_meta("mapsoo_pack_id", prepared.pack_id)
	root.set_meta("mapsoo_profile", "isometric-action")
	root.set_meta("mapsoo_schema_version", SCHEMA_VERSION)
	root.set_meta("mapsoo_bounds", prepared.bounds)

	var void_layer := Node2D.new()
	void_layer.name = "Void"
	void_layer.z_index = 0
	root.add_child(void_layer)
	void_layer.owner = root
	var floor_layer := Node2D.new()
	floor_layer.name = "Floor"
	floor_layer.z_index = 1
	floor_layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	root.add_child(floor_layer)
	floor_layer.owner = root
	var elevation_layer := Node2D.new()
	elevation_layer.name = "Elevation"
	elevation_layer.z_index = 2
	elevation_layer.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	root.add_child(elevation_layer)
	elevation_layer.owner = root
	var ysorted := Node2D.new()
	ysorted.name = "YSortedGameplay"
	ysorted.y_sort_enabled = true
	ysorted.z_index = 3
	root.add_child(ysorted)
	ysorted.owner = root
	var walls := Node2D.new()
	walls.name = "Walls"
	ysorted.add_child(walls)
	walls.owner = root
	var props := Node2D.new()
	props.name = "Props"
	ysorted.add_child(props)
	props.owner = root
	var actors := Node2D.new()
	actors.name = "Actors"
	ysorted.add_child(actors)
	actors.owner = root
	var effects := Node2D.new()
	effects.name = "Effects"
	effects.z_index = 4
	root.add_child(effects)
	effects.owner = root

	var terrain_texture: Texture2D = prepared.textures["atlases/terrain.png"]
	var origin := Vector2(float(prepared.bounds.position.x + prepared.bounds.size.x / 2), float(prepared.bounds.position.y + 48))
	for cell_value: Variant in prepared.floor_cells:
		var cell: Dictionary = cell_value
		var region := AtlasTexture.new()
		region.atlas = terrain_texture
		region.region = Rect2(64 if (int(cell.column) + int(cell.row)) % 3 == 0 else 0, 0, 64, 64)
		region.filter_clip = true
		var sprite := Sprite2D.new()
		sprite.name = "Cell_%02d_%02d" % [int(cell.column), int(cell.row)]
		sprite.texture = region
		sprite.position = origin + Vector2((int(cell.column) - int(cell.row)) * 32, (int(cell.column) + int(cell.row)) * 16 - int(cell.elevation) * 16)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		(elevation_layer if int(cell.elevation) > 0 else floor_layer).add_child(sprite)
		sprite.owner = root

	for placement_value: Variant in prepared.placements:
		var placement: Dictionary = placement_value
		if str(placement.role).begins_with("character."):
			continue
		var sprite := _placement_sprite(prepared, placement)
		var parent := effects if placement.layer == "effects" else props
		parent.add_child(sprite)
		sprite.owner = root

	_add_collision(root, prepared)
	_add_navigation(root, prepared)
	_add_characters(root, actors, prepared)
	return {"ok": true, "root": root, "error": ""}


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
	sprite.set_meta("mapsoo_elevation", placement.elevation)
	return sprite


static func _role_region(role: String) -> Rect2:
	if role.begins_with("terrain."): return Rect2(ROLES.slice(0, 9).find(role) * 64, 0, 64, 64)
	if role.begins_with("hazard."): return Rect2(ROLES.slice(9, 11).find(role) * 64, 0, 64, 64)
	if role.begins_with("prop."): return Rect2(ROLES.slice(11, 16).find(role) * 64, 0, 64, 96)
	if role.begins_with("structure."): return Rect2(ROLES.slice(16, 19).find(role) * 64, 0, 64, 96)
	if role.begins_with("collectible."): return Rect2(ROLES.slice(19, 21).find(role) * 32, 0, 32, 32)
	if role.begins_with("effect.") and role != "effect.shadow": return Rect2(ROLES.slice(21, 28).find(role) * 64, 0, 64, 64)
	if role == "effect.shadow": return Rect2(0, 0, 64, 32)
	return Rect2(0, 0, 48, 64)


static func _add_collision(root: Node2D, prepared: Dictionary) -> void:
	var collision_root := Node2D.new()
	collision_root.name = "WorldCollision"
	root.add_child(collision_root)
	collision_root.owner = root
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
	var navigation_region := NavigationRegion2D.new()
	navigation_region.name = "WorldNavigation"
	var polygon := NavigationPolygon.new()
	polygon.add_outline(prepared.walkable_polygon)
	polygon.make_polygons_from_outlines()
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
		body.name = "Player" if character.id == "player" else _node_name(character.id)
		body.position = spawn.position if character.id == "player" else _enemy_position(prepared, character.id)
		body.collision_layer = 1
		body.collision_mask = 1
		body.set_meta("mapsoo_character_id", character.id)
		actors.add_child(body)
		body.owner = root
		if character.id == "player":
			body.set_script(PlayerController)
			body.set("world_bounds", Rect2(prepared.bounds))
			body.set("spawn_position", spawn.position)
		var frames := _sprite_frames(character, prepared.textures[character.atlas])
		var visual := AnimatedSprite2D.new()
		visual.name = "Visual"
		visual.sprite_frames = frames
		visual.animation = "idle_south"
		visual.offset = Vector2(0, -26)
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


static func _enemy_position(prepared: Dictionary, character_id: String) -> Vector2:
	var expected_role := "character.%s.atlas" % character_id
	for placement: Dictionary in prepared.placements:
		if placement.role == expected_role:
			return Vector2(placement.x, placement.y)
	return Vector2(prepared.spawn) + Vector2(64 if character_id == "enemy-melee" else -64, 96)


static func _sprite_frames(character: Dictionary, texture: Texture2D) -> SpriteFrames:
	var frames := SpriteFrames.new()
	frames.remove_animation("default")
	for clip: Dictionary in character.clips:
		var animation_name := str(clip.id).replace(".", "_")
		frames.add_animation(animation_name)
		frames.set_animation_speed(animation_name, float(clip.fps))
		frames.set_animation_loop(animation_name, clip.action not in ["attack-primary", "hurt", "defeat"])
		for frame: Dictionary in clip.frames:
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(frame.x, frame.y, 48, 64)
			atlas.filter_clip = true
			frames.add_frame(animation_name, atlas)
	return frames


static func validate_staged_scene(world: Node, expected_placements: int) -> Dictionary:
	var valid: bool = world.name == "MapsooWorld" and world.get_meta("mapsoo_profile", "") == "isometric-action" and world.get_meta("mapsoo_schema_version", "") == SCHEMA_VERSION
	var ysorted := world.get_node_or_null("YSortedGameplay") as Node2D
	valid = valid and world.get_node_or_null("Floor") is Node2D and world.get_node_or_null("Elevation") is Node2D
	valid = valid and ysorted != null and ysorted.y_sort_enabled and world.get_node_or_null("YSortedGameplay/Props") is Node2D and world.get_node_or_null("YSortedGameplay/Actors") is Node2D
	var player := world.get_node_or_null("YSortedGameplay/Actors/Player") as CharacterBody2D
	valid = valid and player != null and player.get_script() == PlayerController and world.get_node_or_null("PlayerSpawn") is Marker2D
	valid = valid and world.get_node_or_null("YSortedGameplay/Actors/EnemyMelee") is CharacterBody2D and world.get_node_or_null("YSortedGameplay/Actors/EnemyRanged") is CharacterBody2D
	valid = valid and world.get_node_or_null("WorldCollision") is Node2D and world.get_node_or_null("Hazards") is Node2D and world.get_node_or_null("WorldNavigation") is NavigationRegion2D and world.get_node_or_null("WorldTraversal") is Node2D
	var actor_root := world.get_node_or_null("YSortedGameplay/Actors")
	if actor_root != null:
		for actor: Node in actor_root.get_children():
			var visual := actor.get_node_or_null("Visual") as AnimatedSprite2D
			valid = valid and visual != null and visual.sprite_frames != null
			if actor.name == "Player" and visual != null:
				valid = valid and str(visual.get_meta("mapsoo_runtime_slot_id", "")) == "player"
			var actions := PLAYER_ACTIONS if actor.name == "Player" else ENEMY_ACTIONS
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
	for child: Node in world.get_node("Effects").get_children():
		if child.has_meta("mapsoo_id"): placement_count += 1
	valid = valid and placement_count == expected_placements - 2
	return {"ok": valid, "error": "" if valid else "Staged Pack 0.8 scene is incomplete."}


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
		errors.append("Pack 0.8 directory must contain exactly the manifest-declared files.")


static func _collect_files(directory_path: String, prefix: String, output: Array[String]) -> void:
	var directory := DirAccess.open(directory_path)
	if directory == null: return
	for file: String in directory.get_files(): output.append(prefix.path_join(file) if not prefix.is_empty() else file)
	for child: String in directory.get_directories(): _collect_files(directory_path.path_join(child), prefix.path_join(child) if not prefix.is_empty() else child, output)


static func _load_png(path: String) -> Dictionary:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty(): return {"ok": false, "error": "Unable to read Pack 0.8 PNG: %s" % path}
	var image := Image.new()
	var error := image.load_png_from_buffer(bytes)
	return {"ok": error == OK, "image": image, "error": "Unable to decode Pack 0.8 PNG: %s" % path}


static func _texture(image: Image) -> PortableCompressedTexture2D:
	var texture := PortableCompressedTexture2D.new()
	texture.keep_compressed_buffer = true
	texture.create_from_image(image, PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS)
	return texture


static func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path): return {"ok": false, "error": "Pack 0.8 JSON is missing: %s" % path}
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.size() > 2 * 1024 * 1024: return {"ok": false, "error": "Pack 0.8 JSON is too large."}
	var parser := JSON.new()
	var error := parser.parse(bytes.get_string_from_utf8())
	if error != OK or typeof(parser.data) != TYPE_DICTIONARY: return {"ok": false, "error": "Pack 0.8 JSON is invalid: %s" % path}
	return {"ok": true, "value": parser.data}


static func _dict(value: Variant, label: String, errors: Array[String]) -> Dictionary:
	if typeof(value) != TYPE_DICTIONARY:
		errors.append("%s must be an object." % label)
		return {}
	return value as Dictionary


static func _require_keys(value: Dictionary, expected: Array, label: String, errors: Array[String]) -> void:
	var actual: Array = value.keys()
	actual.sort()
	var canonical := expected.duplicate()
	canonical.sort()
	if actual != canonical: errors.append("%s must contain exactly the canonical fields." % label)


static func _point(value: Variant, label: String, errors: Array[String]) -> Vector2i:
	if typeof(value) != TYPE_DICTIONARY or not _integer(value.get("x")) or not _integer(value.get("y")) or int(value.x) < 0 or int(value.y) < 0:
		errors.append("%s must contain non-negative integer x/y." % label)
		return Vector2i(-1, -1)
	_require_keys(value, ["x", "y"], label, errors)
	return Vector2i(int(value.x), int(value.y))


static func _rect(value: Variant, label: String, errors: Array[String]) -> Rect2i:
	if typeof(value) != TYPE_DICTIONARY or not _integer(value.get("x")) or not _integer(value.get("y")) or not _integer(value.get("width")) or not _integer(value.get("height")):
		errors.append("%s must contain integer x/y/width/height." % label)
		return Rect2i()
	_require_keys(value, ["x", "y", "width", "height"], label, errors)
	return Rect2i(int(value.x), int(value.y), int(value.width), int(value.height))


static func _array_pair(value: Variant, label: String, errors: Array[String]) -> Vector2i:
	if typeof(value) != TYPE_ARRAY or value.size() != 2 or not _integer(value[0]) or not _integer(value[1]):
		errors.append("%s must contain two integers." % label)
		return Vector2i(-1, -1)
	return Vector2i(int(value[0]), int(value[1]))


static func _validate_ordered(value: Variant, expected: Array, key: String, label: String, errors: Array[String], require_order: bool) -> void:
	if typeof(value) != TYPE_ARRAY or value.size() != expected.size():
		errors.append("%s count is invalid." % label)
		return
	for index: int in expected.size():
		if typeof(value[index]) != TYPE_DICTIONARY or value[index].get(key) != expected[index] or (require_order and value[index].get("order") != index):
			errors.append("%s must be canonical and ordered." % label)
			return


static func _validate_ordered_strings(value: Variant, expected: Array, label: String, errors: Array[String]) -> void:
	if typeof(value) != TYPE_ARRAY or value != expected:
		errors.append("Pack 0.8 %s must be canonical and ordered." % label)


static func _integer(value: Variant) -> bool:
	return typeof(value) == TYPE_INT or (typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value))


static func _pack_id(value: String) -> bool:
	if value.length() < 1 or value.length() > 80 or value != value.to_lower() or value.strip_edges() != value or value.begins_with("-") or value.ends_with("-") or value.to_ascii_buffer().get_string_from_ascii() != value or value.contains("_"):
		return false
	for part: String in value.split("-"):
		if part.is_empty(): return false
		for character: String in part:
			if character not in "abcdefghijklmnopqrstuvwxyz0123456789": return false
	return true


static func _asset_id(value: String) -> bool:
	return _pack_id(value.replace("_", "-"))


static func _node_name(value: String) -> String:
	var parts := value.replace("_", "-").split("-")
	var output := ""
	for part: String in parts: output += part.capitalize().replace(" ", "")
	return output if not output.is_empty() else "Item"
