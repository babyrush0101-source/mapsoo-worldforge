@tool
extends RefCounted

## Deterministically materializes a validated WorldLayoutPlan into Godot-native
## runtime semantics. The generated logical TileMap is intentionally hidden:
## production artwork remains owned by the versioned pack, while this layer
## supplies authoritative cells, collision, navigation, traversal and endpoints.

const MATERIALIZATION_NODE := "MapsooLayoutMaterialization"
const STATUS := "profile-layout-v1"
const TERRAIN_NODE := "Terrain"
const LOGICAL_CELLS_NODE := "LogicalCells"
const COLLISION_NODE := "Collision"
const NAVIGATION_NODE := "Navigation"
const TRAVERSAL_NODE := "Traversal"
const LANDMARKS_NODE := "Landmarks"
const LEGACY_RUNTIME_NODES := [
	"WorldCollision",
	"Hazards",
	"WorldNavigation",
	"WorldTraversal",
]
const SUPPORTED_PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]


static func validate_plan(root: Node, plan: Dictionary) -> Dictionary:
	if root == null or typeof(plan) != TYPE_DICTIONARY:
		return _failure("World layout materializer input is invalid.")
	if root.get_node_or_null(MATERIALIZATION_NODE) != null:
		return _failure("Scene already contains a WorldLayoutPlan materialization.")
	var profile: Variant = plan.get("profile")
	if typeof(profile) != TYPE_STRING or profile not in SUPPORTED_PROFILES:
		return _failure("World layout materializer profile is unsupported.")
	var scene_profile: Variant = root.get_meta("mapsoo_profile", "")
	if typeof(scene_profile) == TYPE_STRING and not str(scene_profile).is_empty() and scene_profile != profile:
		return _failure("World layout profile differs from the generated scene.")
	var bounds := _dictionary(plan.get("bounds"))
	if (
		not _positive_integer(bounds.get("width"))
		or not _positive_integer(bounds.get("height"))
		or bounds.get("unit") != "logical-tile"
	):
		return _failure("World layout materializer bounds are invalid.")

	var terrain_layout := _dictionary(plan.get("terrain_layout"))
	var terrain_key := str(terrain_layout.get("kind", ""))
	if terrain_key not in ["bands", "zones"]:
		return _failure("World layout materializer terrain grammar is invalid.")
	var terrain_value: Variant = terrain_layout.get(terrain_key)
	if typeof(terrain_value) != TYPE_ARRAY or terrain_value.is_empty():
		return _failure("World layout materializer terrain is empty.")
	var terrain_index := {}
	for value: Variant in terrain_value:
		var terrain := _dictionary(value)
		if (
			not _safe_id(terrain.get("id"))
			or terrain_index.has(terrain.get("id"))
			or not _rectangle_within(terrain, bounds)
			or not _safe_id(terrain.get("material"))
			or terrain.get("navigation") not in ["walkable", "blocked", "one-way"]
		):
			return _failure("World layout materializer terrain contains an invalid item.")
		terrain_index[terrain.id] = terrain

	var regions_value: Variant = plan.get("regions")
	if typeof(regions_value) != TYPE_ARRAY or regions_value.is_empty():
		return _failure("World layout materializer regions are empty.")
	var region_index := {}
	for value: Variant in regions_value:
		var region := _dictionary(value)
		if (
			not _safe_id(region.get("id"))
			or region_index.has(region.get("id"))
			or not _rectangle_within(region, bounds)
		):
			return _failure("World layout materializer contains an invalid region.")
		region_index[region.id] = region

	var traversal := _dictionary(plan.get("traversal"))
	var nodes_value: Variant = traversal.get("nodes")
	var edges_value: Variant = traversal.get("edges")
	if typeof(nodes_value) != TYPE_ARRAY or typeof(edges_value) != TYPE_ARRAY:
		return _failure("World layout materializer traversal is invalid.")
	var node_index := {}
	for value: Variant in nodes_value:
		var node := _dictionary(value)
		if (
			not _safe_id(node.get("id"))
			or node_index.has(node.get("id"))
			or not region_index.has(node.get("region_id"))
			or not _point_within(node, bounds)
		):
			return _failure("World layout materializer contains an invalid traversal node.")
		node_index[node.id] = node
	var edge_index := {}
	for value: Variant in edges_value:
		var edge := _dictionary(value)
		if (
			not _safe_id(edge.get("id"))
			or edge_index.has(edge.get("id"))
			or not node_index.has(edge.get("from"))
			or not node_index.has(edge.get("to"))
			or edge.get("from") == edge.get("to")
			or edge.get("direction") not in ["forward", "bidirectional"]
		):
			return _failure("World layout materializer contains an invalid traversal edge.")
		edge_index[edge.id] = edge

	var spawn := _dictionary(plan.get("spawn"))
	var exit := _dictionary(plan.get("exit"))
	if (
		not node_index.has(spawn.get("node_id"))
		or not node_index.has(exit.get("node_id"))
		or not _point_within(spawn, bounds)
		or not _point_within(exit, bounds)
	):
		return _failure("World layout materializer endpoints are invalid.")

	var collision := _dictionary(plan.get("collision_intent"))
	for key: String in [
		"solid_terrain_ids",
		"one_way_terrain_ids",
	]:
		var values: Variant = collision.get(key)
		if typeof(values) != TYPE_ARRAY:
			return _failure("World layout materializer collision intent is invalid.")
		for id: Variant in values:
			if not terrain_index.has(id):
				return _failure("World layout materializer collision references missing terrain.")
	var blocked_regions: Variant = collision.get("blocked_region_ids")
	if typeof(blocked_regions) != TYPE_ARRAY:
		return _failure("World layout materializer blocked regions are invalid.")
	for id: Variant in blocked_regions:
		if not region_index.has(id):
			return _failure("World layout materializer collision references a missing region.")

	var navigation := _dictionary(plan.get("navigation_intent"))
	var walkable_regions: Variant = navigation.get("walkable_region_ids")
	var traversal_edges: Variant = navigation.get("traversal_edge_ids")
	if typeof(walkable_regions) != TYPE_ARRAY or typeof(traversal_edges) != TYPE_ARRAY:
		return _failure("World layout materializer navigation intent is invalid.")
	for id: Variant in walkable_regions:
		if not region_index.has(id):
			return _failure("World layout materializer navigation references a missing region.")
	for id: Variant in traversal_edges:
		if not edge_index.has(id):
			return _failure("World layout materializer navigation references a missing edge.")
	return {
		"ok": true,
		"error": "",
		"terrain": terrain_value,
		"terrain_index": terrain_index,
		"region_index": region_index,
		"node_index": node_index,
		"edge_index": edge_index,
	}


static func materialize(
	root: Node,
	plan: Dictionary,
	spawn_marker: Marker2D,
	exit_marker: Marker2D
) -> Dictionary:
	var checked := validate_plan(root, plan)
	if not checked.ok:
		return checked
	if spawn_marker == null or exit_marker == null:
		return _failure("World layout endpoint markers are unavailable.")
	var pixel_bounds := _resolve_pixel_bounds(root, plan)
	if pixel_bounds.size.x <= 0.0 or pixel_bounds.size.y <= 0.0:
		return _failure("World layout could not resolve positive world bounds.")

	var materialization := Node2D.new()
	materialization.name = MATERIALIZATION_NODE
	materialization.set_meta("mapsoo_layout_status", STATUS)
	materialization.set_meta("mapsoo_profile", str(plan.profile))
	materialization.set_meta("mapsoo_pixel_bounds", pixel_bounds)
	materialization.set_meta("mapsoo_plan_id", str(plan.plan_id))

	var terrain_root := Node2D.new()
	terrain_root.name = TERRAIN_NODE
	terrain_root.visible = false
	materialization.add_child(terrain_root)
	var tile_result := _build_logical_tilemap(plan, checked.terrain)
	if not tile_result.ok:
		materialization.free()
		return tile_result
	terrain_root.add_child(tile_result.layer)
	for terrain_value: Variant in checked.terrain:
		var terrain: Dictionary = terrain_value
		var polygon := Polygon2D.new()
		polygon.name = _node_name("Terrain", str(terrain.id))
		polygon.polygon = logical_rectangle_to_world_polygon(
			str(plan.profile),
			terrain,
			plan.bounds,
			pixel_bounds
		)
		polygon.color = Color(0.0, 0.0, 0.0, 0.0)
		polygon.set_meta("mapsoo_terrain_id", str(terrain.id))
		polygon.set_meta("mapsoo_material", str(terrain.material))
		polygon.set_meta("mapsoo_navigation", str(terrain.navigation))
		terrain_root.add_child(polygon)

	var collision_root := Node2D.new()
	collision_root.name = COLLISION_NODE
	materialization.add_child(collision_root)
	var collision_ids: Array = []
	collision_ids.append_array(plan.collision_intent.solid_terrain_ids)
	for id: Variant in plan.collision_intent.one_way_terrain_ids:
		if id not in collision_ids:
			collision_ids.append(id)
	for terrain_id: Variant in collision_ids:
		_add_collision_body(
			collision_root,
			str(plan.profile),
			checked.terrain_index[terrain_id],
			plan.bounds,
			pixel_bounds,
			terrain_id in plan.collision_intent.one_way_terrain_ids,
			"mapsoo_terrain_id"
		)
	for region_id: Variant in plan.collision_intent.blocked_region_ids:
		_add_collision_body(
			collision_root,
			str(plan.profile),
			checked.region_index[region_id],
			plan.bounds,
			pixel_bounds,
			false,
			"mapsoo_region_id"
		)

	var navigation_root := Node2D.new()
	navigation_root.name = NAVIGATION_NODE
	materialization.add_child(navigation_root)
	for region_id: Variant in plan.navigation_intent.walkable_region_ids:
		var region: Dictionary = checked.region_index[region_id]
		var navigation_region := NavigationRegion2D.new()
		navigation_region.name = _node_name("Region", str(region_id))
		navigation_region.set_meta("mapsoo_region_id", str(region_id))
		var navigation_polygon := NavigationPolygon.new()
		var polygon := logical_rectangle_to_world_polygon(
			str(plan.profile),
			region,
			plan.bounds,
			pixel_bounds
		)
		navigation_polygon.set_vertices(polygon)
		navigation_polygon.add_polygon(PackedInt32Array([0, 1, 2, 3]))
		navigation_region.navigation_polygon = navigation_polygon
		navigation_root.add_child(navigation_region)
	for edge_id: Variant in plan.navigation_intent.traversal_edge_ids:
		var edge: Dictionary = checked.edge_index[edge_id]
		var from_node: Dictionary = checked.node_index[edge.from]
		var to_node: Dictionary = checked.node_index[edge.to]
		var link := NavigationLink2D.new()
		link.name = _node_name("Link", str(edge_id))
		link.start_position = _logical_point_to_world(
			str(plan.profile), from_node, plan.bounds, pixel_bounds
		)
		link.end_position = _logical_point_to_world(
			str(plan.profile), to_node, plan.bounds, pixel_bounds
		)
		link.bidirectional = edge.direction == "bidirectional"
		link.set_meta("mapsoo_edge_id", str(edge_id))
		link.set_meta("mapsoo_edge_kind", str(edge.kind))
		link.set_meta("mapsoo_direction", str(edge.direction))
		navigation_root.add_child(link)

	var traversal_root := Node2D.new()
	traversal_root.name = TRAVERSAL_NODE
	traversal_root.set_meta("mapsoo_edges", plan.traversal.edges.duplicate(true))
	materialization.add_child(traversal_root)
	for node_value: Variant in plan.traversal.nodes:
		var node_plan: Dictionary = node_value
		var marker := Marker2D.new()
		marker.name = _node_name("Node", str(node_plan.id))
		marker.position = _logical_point_to_world(
			str(plan.profile), node_plan, plan.bounds, pixel_bounds
		)
		marker.set_meta("mapsoo_node_id", str(node_plan.id))
		marker.set_meta("mapsoo_kind", str(node_plan.kind))
		marker.set_meta("mapsoo_region_id", str(node_plan.region_id))
		traversal_root.add_child(marker)

	var landmarks_root := Node2D.new()
	landmarks_root.name = LANDMARKS_NODE
	materialization.add_child(landmarks_root)
	for landmark_value: Variant in plan.landmarks:
		var landmark: Dictionary = landmark_value
		var marker := Marker2D.new()
		marker.name = _node_name("Landmark", str(landmark.id))
		marker.position = _logical_point_to_world(
			str(plan.profile), landmark, plan.bounds, pixel_bounds
		)
		marker.set_meta("mapsoo_landmark_id", str(landmark.id))
		marker.set_meta("mapsoo_node_id", str(landmark.node_id))
		marker.set_meta("mapsoo_label", str(landmark.label))
		landmarks_root.add_child(marker)

	var spawn_position := _logical_point_to_world(
		str(plan.profile), plan.spawn, plan.bounds, pixel_bounds
	)
	var exit_position := _logical_point_to_world(
		str(plan.profile), plan.exit, plan.bounds, pixel_bounds
	)
	spawn_marker.position = spawn_position
	exit_marker.position = exit_position
	root.add_child(materialization)
	_set_owner_recursive(materialization, root)
	_bind_runtime_player(root, spawn_position, pixel_bounds)
	_supersede_legacy_runtime_geometry(root)
	root.set_meta("mapsoo_layout_materialization", STATUS)
	root.set_meta("mapsoo_layout_pixel_bounds", pixel_bounds)
	root.set_meta("mapsoo_layout_spawn_world", spawn_position)
	root.set_meta("mapsoo_layout_exit_world", exit_position)
	return {"ok": true, "status": STATUS, "error": ""}


static func validate_scene(root: Node, plan: Dictionary) -> Dictionary:
	if root == null or root.get_meta("mapsoo_layout_materialization", "") != STATUS:
		return _failure("Scene does not declare WorldLayoutPlan runtime materialization.")
	var legacy_handoff := _validate_legacy_runtime_handoff(root)
	if not legacy_handoff.ok:
		return legacy_handoff
	var materialization := root.get_node_or_null(MATERIALIZATION_NODE)
	if materialization == null:
		return _failure("Scene lost its WorldLayoutPlan materialization root.")
	var checked := _validate_materialized_plan_only(plan)
	if not checked.ok:
		return checked
	var terrain_root := materialization.get_node_or_null(TERRAIN_NODE)
	var logical_cells := materialization.get_node_or_null(
		"%s/%s" % [TERRAIN_NODE, LOGICAL_CELLS_NODE]
	) as TileMapLayer
	if terrain_root == null or logical_cells == null or logical_cells.tile_set == null:
		return _failure("Scene lost its materialized logical TileMap.")
	if logical_cells.get_used_cells().size() != _expected_used_cell_count(checked.terrain):
		return _failure("Materialized logical TileMap cell count differs from the plan.")
	if terrain_root.get_child_count() != checked.terrain.size() + 1:
		return _failure("Materialized terrain polygon count differs from the plan.")

	var expected_collision_count := _unique_collision_count(plan.collision_intent)
	var collision_root := materialization.get_node_or_null(COLLISION_NODE)
	if collision_root == null or collision_root.get_child_count() != expected_collision_count:
		return _failure("Materialized collision count differs from the plan.")
	for child: Node in collision_root.get_children():
		if not (child is StaticBody2D) or child.get_child_count() != 1:
			return _failure("Materialized collision structure is invalid.")

	var navigation_root := materialization.get_node_or_null(NAVIGATION_NODE)
	if navigation_root == null:
		return _failure("Scene lost its materialized navigation root.")
	var navigation_regions := _nodes_of_class(navigation_root, "NavigationRegion2D")
	var navigation_links := _nodes_of_class(navigation_root, "NavigationLink2D")
	if (
		navigation_regions.size() != plan.navigation_intent.walkable_region_ids.size()
		or navigation_links.size() != plan.navigation_intent.traversal_edge_ids.size()
	):
		return _failure("Materialized navigation counts differ from the plan.")

	var traversal_root := materialization.get_node_or_null(TRAVERSAL_NODE)
	var landmarks_root := materialization.get_node_or_null(LANDMARKS_NODE)
	if (
		traversal_root == null
		or traversal_root.get_child_count() != plan.traversal.nodes.size()
		or landmarks_root == null
		or landmarks_root.get_child_count() != plan.landmarks.size()
	):
		return _failure("Materialized traversal or landmark count differs from the plan.")
	var spawn := root.get_node_or_null("WorldLayoutPlan/Spawn") as Marker2D
	var exit := root.get_node_or_null("WorldLayoutPlan/Exit") as Marker2D
	if (
		spawn == null
		or exit == null
		or not spawn.position.is_equal_approx(root.get_meta("mapsoo_layout_spawn_world"))
		or not exit.position.is_equal_approx(root.get_meta("mapsoo_layout_exit_world"))
	):
		return _failure("Materialized world endpoints differ from their scene metadata.")
	return {"ok": true, "status": STATUS, "error": ""}


static func _validate_materialized_plan_only(plan: Dictionary) -> Dictionary:
	var dummy := Node2D.new()
	dummy.name = "ValidationRoot"
	dummy.set_meta("mapsoo_profile", str(plan.get("profile", "")))
	var checked := validate_plan(dummy, plan)
	dummy.free()
	return checked


static func _build_logical_tilemap(plan: Dictionary, terrain_items: Array) -> Dictionary:
	var layer := TileMapLayer.new()
	layer.name = LOGICAL_CELLS_NODE
	layer.visible = false
	layer.collision_enabled = false
	layer.set_meta("mapsoo_semantic_only", true)
	layer.set_meta("mapsoo_overlap_rule", "later-plan-item-wins")
	var tile_set := TileSet.new()
	tile_set.tile_size = Vector2i(32, 32)
	if plan.profile == "isometric-action":
		tile_set.tile_shape = TileSet.TILE_SHAPE_ISOMETRIC
	var material_sources := {}
	for terrain_value: Variant in terrain_items:
		var terrain: Dictionary = terrain_value
		var material := str(terrain.material)
		if material_sources.has(material):
			continue
		var source_id := material_sources.size()
		var texture := GradientTexture2D.new()
		texture.width = 32
		texture.height = 32
		var gradient := Gradient.new()
		gradient.colors = PackedColorArray([
			Color(0.0, 0.0, 0.0, 0.0),
			Color(0.0, 0.0, 0.0, 0.0),
		])
		texture.gradient = gradient
		var source := TileSetAtlasSource.new()
		source.texture = texture
		source.texture_region_size = Vector2i(32, 32)
		source.create_tile(Vector2i.ZERO)
		tile_set.add_source(source, source_id)
		material_sources[material] = source_id
	layer.tile_set = tile_set
	layer.set_meta("mapsoo_material_sources", material_sources.duplicate(true))
	for terrain_value: Variant in terrain_items:
		var terrain: Dictionary = terrain_value
		var source_id := int(material_sources[str(terrain.material)])
		for y: int in range(int(terrain.y), int(terrain.y) + int(terrain.height)):
			for x: int in range(int(terrain.x), int(terrain.x) + int(terrain.width)):
				layer.set_cell(Vector2i(x, y), source_id, Vector2i.ZERO, 0)
	return {"ok": true, "layer": layer, "error": ""}


static func _add_collision_body(
	parent: Node2D,
	profile: String,
	item: Dictionary,
	logical_bounds: Dictionary,
	pixel_bounds: Rect2,
	one_way: bool,
	meta_key: String
) -> void:
	var item_id := str(item.id)
	var body := StaticBody2D.new()
	body.name = _node_name("Body", item_id)
	body.collision_layer = 1
	body.collision_mask = 1
	body.set_meta(meta_key, item_id)
	body.set_meta("mapsoo_one_way", one_way)
	parent.add_child(body)
	var polygon := logical_rectangle_to_world_polygon(
		profile,
		item,
		logical_bounds,
		pixel_bounds
	)
	var shape_node := CollisionShape2D.new()
	shape_node.name = "CollisionShape2D"
	shape_node.one_way_collision = one_way
	if profile == "isometric-action":
		var shape := ConvexPolygonShape2D.new()
		shape.points = polygon
		shape_node.shape = shape
	else:
		var minimum := polygon[0]
		var maximum := polygon[0]
		for point: Vector2 in polygon:
			minimum = minimum.min(point)
			maximum = maximum.max(point)
		body.position = (minimum + maximum) * 0.5
		var shape := RectangleShape2D.new()
		shape.size = maximum - minimum
		shape_node.shape = shape
	body.add_child(shape_node)


static func _resolve_pixel_bounds(root: Node, plan: Dictionary) -> Rect2:
	var metadata: Variant = root.get_meta("mapsoo_bounds") if root.has_meta("mapsoo_bounds") else null
	if metadata is Rect2:
		return metadata
	if metadata is Rect2i:
		return Rect2(metadata)
	var player := _find_runtime_player(root)
	if player != null:
		for property: Dictionary in player.get_property_list():
			if property.get("name") == "world_bounds":
				var value: Variant = player.get("world_bounds")
				if value is Rect2:
					return value
				if value is Rect2i:
					return Rect2(value)
	var width := float(plan.bounds.width)
	var height := float(plan.bounds.height)
	match str(plan.profile):
		"isometric-action":
			return Rect2(-height * 32.0, 0.0, (width + height) * 32.0, (width + height) * 16.0)
		"layered-depth-2d":
			return Rect2(0.0, 0.0, width * 32.0, height * 16.0)
		_:
			return Rect2(0.0, 0.0, width * 32.0, height * 32.0)


static func _logical_point_to_world(
	profile: String,
	point: Dictionary,
	logical_bounds: Dictionary,
	pixel_bounds: Rect2
) -> Vector2:
	return _logical_coordinate_to_world(
		profile,
		float(point.x) + 0.5,
		float(point.y) + 0.5,
		logical_bounds,
		pixel_bounds
	)


static func _logical_coordinate_to_world(
	profile: String,
	x: float,
	y: float,
	logical_bounds: Dictionary,
	pixel_bounds: Rect2
) -> Vector2:
	var u := x / float(logical_bounds.width)
	var v := y / float(logical_bounds.height)
	if profile == "isometric-action":
		return Vector2(
			pixel_bounds.position.x + pixel_bounds.size.x * 0.5
				+ (u - v) * pixel_bounds.size.x * 0.5,
			pixel_bounds.position.y + (u + v) * pixel_bounds.size.y * 0.5
		)
	return pixel_bounds.position + Vector2(
		u * pixel_bounds.size.x,
		v * pixel_bounds.size.y
	)


static func logical_rectangle_to_world_polygon(
	profile: String,
	item: Dictionary,
	logical_bounds: Dictionary,
	pixel_bounds: Rect2
) -> PackedVector2Array:
	var left := float(item.x)
	var top := float(item.y)
	var right := left + float(item.width)
	var bottom := top + float(item.height)
	return PackedVector2Array([
		_logical_coordinate_to_world(profile, left, top, logical_bounds, pixel_bounds),
		_logical_coordinate_to_world(profile, right, top, logical_bounds, pixel_bounds),
		_logical_coordinate_to_world(profile, right, bottom, logical_bounds, pixel_bounds),
		_logical_coordinate_to_world(profile, left, bottom, logical_bounds, pixel_bounds),
	])


static func _bind_runtime_player(root: Node, spawn: Vector2, pixel_bounds: Rect2) -> void:
	var marker := root.get_node_or_null("PlayerSpawn") as Marker2D
	if marker != null:
		marker.position = spawn
	var player := _find_runtime_player(root)
	if player == null:
		root.set_meta("mapsoo_layout_player_bound", false)
		return
	player.position = spawn
	for property: Dictionary in player.get_property_list():
		if property.get("name") == "spawn_position":
			player.set("spawn_position", spawn)
		elif property.get("name") == "world_bounds":
			player.set("world_bounds", pixel_bounds)
	root.set_meta("mapsoo_layout_player_bound", true)


static func _find_runtime_player(root: Node) -> CharacterBody2D:
	if root is CharacterBody2D and root.name == "Player":
		return root
	for child: Node in root.get_children():
		var player := _find_runtime_player(child)
		if player != null:
			return player
	return null


static func _supersede_legacy_runtime_geometry(root: Node) -> void:
	var superseded: Array[String] = []
	for node_name: String in LEGACY_RUNTIME_NODES:
		var legacy := root.get_node_or_null(node_name)
		if legacy == null:
			continue
		legacy.set_meta("mapsoo_layout_superseded", true)
		legacy.process_mode = Node.PROCESS_MODE_DISABLED
		if legacy is CanvasItem:
			(legacy as CanvasItem).visible = false
		_disable_legacy_runtime_node(legacy)
		superseded.append(node_name)
	root.set_meta("mapsoo_layout_runtime_geometry_authority", STATUS)
	root.set_meta("mapsoo_layout_superseded_legacy_nodes", superseded)


static func _disable_legacy_runtime_node(node: Node) -> void:
	if node is CollisionObject2D:
		(node as CollisionObject2D).collision_layer = 0
		(node as CollisionObject2D).collision_mask = 0
	if node is Area2D:
		(node as Area2D).monitoring = false
		(node as Area2D).monitorable = false
	if node is CollisionShape2D:
		(node as CollisionShape2D).disabled = true
	if node is CollisionPolygon2D:
		(node as CollisionPolygon2D).disabled = true
	if node is NavigationRegion2D:
		(node as NavigationRegion2D).enabled = false
	if node is NavigationLink2D:
		(node as NavigationLink2D).enabled = false
	for child: Node in node.get_children():
		_disable_legacy_runtime_node(child)


static func _validate_legacy_runtime_handoff(root: Node) -> Dictionary:
	if root.get_meta("mapsoo_layout_runtime_geometry_authority", "") != STATUS:
		return _failure("Scene does not declare authoritative layout runtime geometry.")
	var declared_value: Variant = root.get_meta(
		"mapsoo_layout_superseded_legacy_nodes",
		[]
	)
	if typeof(declared_value) != TYPE_ARRAY:
		return _failure("Scene legacy runtime handoff metadata is invalid.")
	var declared: Array = declared_value
	var expected: Array[String] = []
	for node_name: String in LEGACY_RUNTIME_NODES:
		var legacy := root.get_node_or_null(node_name)
		if legacy == null:
			continue
		expected.append(node_name)
		if (
			legacy.get_meta("mapsoo_layout_superseded", false) != true
			or legacy.process_mode != Node.PROCESS_MODE_DISABLED
			or (legacy is CanvasItem and (legacy as CanvasItem).visible)
			or not _legacy_runtime_node_is_disabled(legacy)
		):
			return _failure(
				"Legacy runtime node %s remains active beside WorldLayoutPlan." %
				node_name
			)
	if declared != expected:
		return _failure("Scene legacy runtime handoff inventory is inconsistent.")
	return {"ok": true, "status": STATUS, "error": ""}


static func _legacy_runtime_node_is_disabled(node: Node) -> bool:
	if (
		node is CollisionObject2D
		and (
			(node as CollisionObject2D).collision_layer != 0
			or (node as CollisionObject2D).collision_mask != 0
		)
	):
		return false
	if (
		node is Area2D
		and (
			(node as Area2D).monitoring
			or (node as Area2D).monitorable
		)
	):
		return false
	if node is CollisionShape2D and not (node as CollisionShape2D).disabled:
		return false
	if node is CollisionPolygon2D and not (node as CollisionPolygon2D).disabled:
		return false
	if node is NavigationRegion2D and (node as NavigationRegion2D).enabled:
		return false
	if node is NavigationLink2D and (node as NavigationLink2D).enabled:
		return false
	for child: Node in node.get_children():
		if not _legacy_runtime_node_is_disabled(child):
			return false
	return true


static func _set_owner_recursive(node: Node, owner: Node) -> void:
	node.owner = owner
	for child: Node in node.get_children():
		_set_owner_recursive(child, owner)


static func _expected_used_cell_count(terrain_items: Array) -> int:
	var cells := {}
	for terrain_value: Variant in terrain_items:
		var terrain: Dictionary = terrain_value
		for y: int in range(int(terrain.y), int(terrain.y) + int(terrain.height)):
			for x: int in range(int(terrain.x), int(terrain.x) + int(terrain.width)):
				cells[Vector2i(x, y)] = true
	return cells.size()


static func _unique_collision_count(intent: Dictionary) -> int:
	var ids := {}
	for key: String in ["solid_terrain_ids", "one_way_terrain_ids"]:
		for id: Variant in intent.get(key, []):
			ids["terrain:%s" % id] = true
	for id: Variant in intent.get("blocked_region_ids", []):
		ids["region:%s" % id] = true
	return ids.size()


static func _nodes_of_class(root: Node, type_name: String) -> Array[Node]:
	var nodes: Array[Node] = []
	if root.is_class(type_name):
		nodes.append(root)
	for child: Node in root.get_children():
		nodes.append_array(_nodes_of_class(child, type_name))
	return nodes


static func _rectangle_within(value: Dictionary, bounds: Dictionary) -> bool:
	return (
		_non_negative_integer(value.get("x"))
		and _non_negative_integer(value.get("y"))
		and _positive_integer(value.get("width"))
		and _positive_integer(value.get("height"))
		and int(value.x) + int(value.width) <= int(bounds.width)
		and int(value.y) + int(value.height) <= int(bounds.height)
	)


static func _point_within(value: Dictionary, bounds: Dictionary) -> bool:
	return (
		_non_negative_integer(value.get("x"))
		and _non_negative_integer(value.get("y"))
		and int(value.x) < int(bounds.width)
		and int(value.y) < int(bounds.height)
	)


static func _positive_integer(value: Variant) -> bool:
	return (
		typeof(value) == TYPE_INT
		or (typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value))
	) and int(value) > 0


static func _non_negative_integer(value: Variant) -> bool:
	return (
		typeof(value) == TYPE_INT
		or (typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value))
	) and int(value) >= 0


static func _dictionary(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


static func _safe_id(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or str(value).is_empty() or str(value).length() > 80:
		return false
	var regex := RegEx.new()
	return regex.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$") == OK and regex.search(value) != null


static func _node_name(prefix: String, id: String) -> String:
	return "%s_%s" % [prefix, id.to_pascal_case()]


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
