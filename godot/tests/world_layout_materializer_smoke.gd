extends "res://tests/world_layout_attachment_smoke.gd"

const LayoutMaterializer = preload(
	"res://addons/mapsoo_importer/mapsoo_world_layout_materializer.gd"
)
const MATERIALIZATION_NODE := "MapsooLayoutMaterialization"
const EXPECTED_STATUS := "profile-layout-v1"
const PlayerController = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_player_controller.gd"
)
const IsometricPlayerController = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_isometric_player_controller.gd"
)
const LayeredDepthPlayerController = preload(
	"res://addons/mapsoo_importer/runtime/mapsoo_layered_depth_player_controller.gd"
)
const LEGACY_RUNTIME_NODES := [
	"WorldCollision",
	"Hazards",
	"WorldNavigation",
	"WorldTraversal",
]


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	if DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(TEST_ROOT)) != OK:
		_fail("Unable to create WorldLayoutPlan materializer smoke directory.")
		return
	if not _assert_absent_compatibility():
		return

	for profile: String in PROFILES:
		var fixture := _write_fixture(profile, "materializer")
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		var validated := LayoutAttachment.validate_optional(
			fixture.manifest,
			fixture.root,
			fixture.manifest_sha256
		)
		if not validated.ok or validated.status != "bound":
			_fail("%s materializer fixture validation failed: %s" % [profile, validated])
			return

		var first := _materialize_world(profile, validated.layout)
		if not first.ok:
			_fail("%s first materialization failed: %s" % [profile, first.error])
			return
		var first_check := _assert_materialized(first.root, validated.layout.plan)
		if not first_check.ok:
			first.root.free()
			_fail("%s materialization contract failed: %s" % [profile, first_check.error])
			return
		var first_snapshot := _semantic_snapshot(first.root)

		var second := _materialize_world(profile, validated.layout)
		if not second.ok:
			first.root.free()
			_fail("%s repeat materialization failed: %s" % [profile, second.error])
			return
		var second_check := _assert_materialized(second.root, validated.layout.plan)
		if not second_check.ok:
			first.root.free()
			second.root.free()
			_fail("%s repeat materialization contract failed: %s" % [profile, second_check.error])
			return
		if first_snapshot != _semantic_snapshot(second.root):
			first.root.free()
			second.root.free()
			_fail("%s materialization was not deterministic." % profile)
			return
		var controller_check := _assert_controller_uses_layout_exit(
			second.root,
			validated.layout.plan
		)
		if not controller_check.ok:
			first.root.free()
			second.root.free()
			_fail("%s controller handoff failed: %s" % [
				profile,
				controller_check.error,
			])
			return

		var persisted := _persist_and_reload(first.root, fixture.root, profile)
		first.root.free()
		second.root.free()
		if not persisted.ok:
			_fail("%s materialized scene persistence failed: %s" % [profile, persisted.error])
			return
		var persisted_check := _assert_materialized(persisted.root, validated.layout.plan)
		if not persisted_check.ok:
			persisted.root.free()
			_fail("%s persisted materialization contract failed: %s" % [
				profile,
				persisted_check.error,
			])
			return
		var persisted_snapshot := _semantic_snapshot(persisted.root)
		if first_snapshot != persisted_snapshot:
			persisted.root.free()
			_fail(
				"%s persisted materialization changed its semantic snapshot: %s" % [
					profile,
					_first_difference(first_snapshot, persisted_snapshot),
				]
			)
			return
		persisted.root.free()

	if not _assert_tamper_fail_closed():
		return
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	print(
		"MAPSOO_WORLD_LAYOUT_MATERIALIZER_OK " +
		"profiles=4 deterministic=4 persisted=4 handoff=4 " +
		"controller-exit=4 absent=1 tamper=2"
	)
	quit(0)


func _assert_absent_compatibility() -> bool:
	var world := Node2D.new()
	world.name = "MapsooWorld"
	world.set_meta("mapsoo_profile", "topdown-farm")
	var before := _semantic_snapshot(world)
	var result := LayoutAttachment.bind_scene(world, {})
	if (
		not result.ok
		or result.status != "absent"
		or world.get_node_or_null(MATERIALIZATION_NODE) != null
		or world.has_meta("mapsoo_layout_materialization")
		or before != _semantic_snapshot(world)
	):
		world.free()
		_fail("No-layout packs no longer preserve the untouched legacy scene.")
		return false
	world.free()
	return true


func _materialize_world(profile: String, attachment: Dictionary) -> Dictionary:
	var world := Node2D.new()
	world.name = "MapsooWorld"
	world.set_meta("mapsoo_profile", profile)
	world.set_meta("mapsoo_bounds", Rect2(100.0, 50.0, 1280.0, 720.0))
	var runtime_spawn := Marker2D.new()
	runtime_spawn.name = "PlayerSpawn"
	world.add_child(runtime_spawn)
	runtime_spawn.owner = world
	var actor_root := Node2D.new()
	actor_root.name = "Actors"
	world.add_child(actor_root)
	actor_root.owner = world
	var runtime_player := CharacterBody2D.new()
	runtime_player.name = "Player"
	match profile:
		"isometric-action":
			runtime_player.set_script(IsometricPlayerController)
		"layered-depth-2d":
			runtime_player.set_script(LayeredDepthPlayerController)
		_:
			runtime_player.set_script(PlayerController)
	actor_root.add_child(runtime_player)
	runtime_player.owner = world
	_add_legacy_runtime_geometry(world)
	var binding := LayoutAttachment.bind_scene(world, attachment)
	if not binding.ok or binding.status != "bound":
		world.free()
		return {
			"ok": false,
			"error": "Attachment integration returned %s" % binding,
		}
	var bound_check := LayoutAttachment.validate_bound_scene(world, attachment)
	if not bound_check.ok:
		world.free()
		return {
			"ok": false,
			"error": "Attachment postcondition returned %s" % bound_check,
		}
	var materialized_check := LayoutMaterializer.validate_scene(world, attachment.plan)
	if not materialized_check.ok:
		world.free()
		return {
			"ok": false,
			"error": "Materializer postcondition returned %s" % materialized_check,
		}
	return {"ok": true, "root": world, "error": ""}


func _assert_materialized(world: Node, plan: Dictionary) -> Dictionary:
	if world.get_meta("mapsoo_layout_materialization", "") != EXPECTED_STATUS:
		return _check_failure("Scene does not declare profile-layout-v1 materialization.")
	if (
		world.get_meta("mapsoo_layout_runtime_geometry_authority", "")
			!= EXPECTED_STATUS
		or world.get_meta("mapsoo_layout_superseded_legacy_nodes", [])
			!= LEGACY_RUNTIME_NODES
	):
		return _check_failure("Scene does not declare the layout runtime handoff.")
	for legacy_name: String in LEGACY_RUNTIME_NODES:
		var legacy := world.get_node_or_null(legacy_name)
		if (
			legacy == null
			or legacy.get_meta("mapsoo_layout_superseded", false) != true
			or legacy.process_mode != Node.PROCESS_MODE_DISABLED
			or (legacy is CanvasItem and (legacy as CanvasItem).visible)
			or not _legacy_runtime_node_is_disabled(legacy)
		):
			return _check_failure(
				"Legacy runtime node %s remains active." % legacy_name
			)
	var materialization := world.get_node_or_null(MATERIALIZATION_NODE)
	if materialization == null:
		return _check_failure("Materialization root is missing.")
	for child_name: String in [
		"Terrain",
		"Collision",
		"Navigation",
		"Traversal",
		"Landmarks",
	]:
		if materialization.get_node_or_null(child_name) == null:
			return _check_failure("Materialization child %s is missing." % child_name)

	var terrain_key := str(plan.terrain_layout.kind)
	var terrain_items: Array = plan.terrain_layout.get(terrain_key, [])
	var terrain_root := materialization.get_node("Terrain")
	var logical_cells := terrain_root.get_node_or_null("LogicalCells") as TileMapLayer
	if logical_cells == null or logical_cells.tile_set == null:
		return _check_failure("Materialized logical TileMapLayer is missing.")
	if logical_cells.get_used_cells().size() != _expected_used_cells(terrain_items):
		return _check_failure("Logical TileMap cell coverage does not match terrain union.")
	if terrain_root.get_child_count() != terrain_items.size() + 1:
		return _check_failure("Terrain item count does not match the plan.")
	for terrain_value: Variant in terrain_items:
		var terrain: Dictionary = terrain_value
		var terrain_node := _find_meta_node(
			terrain_root,
			"mapsoo_terrain_id",
			str(terrain.id)
		)
		if not (terrain_node is Polygon2D):
			return _check_failure("Terrain %s is not a Polygon2D." % terrain.id)
		if (terrain_node as Polygon2D).polygon.size() < 4:
			return _check_failure("Terrain %s has no usable map polygon." % terrain.id)
	if plan.profile in ["side-platformer", "isometric-action"]:
		var water_terrain: Dictionary = {}
		for terrain_value: Variant in terrain_items:
			var terrain: Dictionary = terrain_value
			if str(terrain.material) == "water":
				water_terrain = terrain
				break
		if (
			water_terrain.is_empty()
			or str(water_terrain.navigation) != "blocked"
			or str(water_terrain.id) not in plan.collision_intent.solid_terrain_ids
		):
			return _check_failure(
				"%s water is not bound as blocked solid terrain." % plan.profile
			)
		var material_sources: Dictionary = logical_cells.get_meta(
			"mapsoo_material_sources",
			{}
		)
		if (
			not material_sources.has("water")
			or logical_cells.get_cell_source_id(
				Vector2i(int(water_terrain.x), int(water_terrain.y))
			) != int(material_sources.water)
		):
			return _check_failure(
				"%s water did not win the visible material overlap." % plan.profile
			)

	var collision_root := materialization.get_node("Collision")
	var collision_ids: Array = (
		plan.collision_intent.solid_terrain_ids
		+ plan.collision_intent.one_way_terrain_ids
	)
	var unique_collision_ids := {}
	for terrain_id: Variant in collision_ids:
		unique_collision_ids["terrain:%s" % terrain_id] = true
	for region_id: Variant in plan.collision_intent.blocked_region_ids:
		unique_collision_ids["region:%s" % region_id] = true
	if collision_root.get_child_count() != unique_collision_ids.size():
		return _check_failure("Collision body count does not match collision intent.")
	for terrain_key_value: Variant in unique_collision_ids:
		var parts: PackedStringArray = str(terrain_key_value).split(":", true, 1)
		var meta_key := (
			"mapsoo_terrain_id"
			if parts[0] == "terrain"
			else "mapsoo_region_id"
		)
		var item_id := parts[1]
		var body := _find_meta_node(
			collision_root,
			meta_key,
			item_id
		)
		if not (body is StaticBody2D):
			return _check_failure("Collision %s is not a StaticBody2D." % item_id)
		var shapes := _nodes_of_type(body, "CollisionShape2D")
		if shapes.size() != 1:
			return _check_failure("Collision %s does not contain exactly one shape." % item_id)
		var shape_node := shapes[0] as CollisionShape2D
		var expected_shape := (
			shape_node.shape is ConvexPolygonShape2D
			if plan.profile == "isometric-action"
			else shape_node.shape is RectangleShape2D
		)
		if not expected_shape:
			return _check_failure("Collision %s uses the wrong profile shape." % item_id)
		var should_be_one_way: bool = (
			parts[0] == "terrain"
			and item_id in plan.collision_intent.one_way_terrain_ids
		)
		if shape_node.one_way_collision != should_be_one_way:
			return _check_failure("Collision %s has incorrect one-way semantics." % item_id)

	var navigation_root := materialization.get_node("Navigation")
	var region_ids: Array = plan.navigation_intent.walkable_region_ids
	var edge_ids: Array = plan.navigation_intent.traversal_edge_ids
	var navigation_regions := _nodes_of_type(navigation_root, "NavigationRegion2D")
	var navigation_links := _nodes_of_type(navigation_root, "NavigationLink2D")
	if navigation_regions.size() != region_ids.size():
		return _check_failure("Navigation region count does not match navigation intent.")
	if navigation_links.size() != edge_ids.size():
		return _check_failure("Navigation link count does not match traversal intent.")
	for region_id: Variant in region_ids:
		var region := _find_meta_node(
			navigation_root,
			"mapsoo_region_id",
			str(region_id)
		)
		if not (region is NavigationRegion2D):
			return _check_failure("Navigation region %s is missing." % region_id)
		var polygon := (region as NavigationRegion2D).navigation_polygon
		if polygon == null or polygon.get_vertices().size() < 3:
			return _check_failure("Navigation region %s has no baked polygon." % region_id)
	for edge_id: Variant in edge_ids:
		var link := _find_meta_node(
			navigation_root,
			"mapsoo_edge_id",
			str(edge_id)
		)
		if not (link is NavigationLink2D):
			return _check_failure("Navigation link %s is missing." % edge_id)
		if (link as NavigationLink2D).start_position == (link as NavigationLink2D).end_position:
			return _check_failure("Navigation link %s has zero length." % edge_id)

	var traversal_root := materialization.get_node("Traversal")
	var pixel_bounds: Rect2 = materialization.get_meta("mapsoo_pixel_bounds")
	if traversal_root.get_child_count() != plan.traversal.nodes.size():
		return _check_failure("Traversal marker count does not match the plan.")
	for node_value: Variant in plan.traversal.nodes:
		var node_plan: Dictionary = node_value
		var marker := _find_meta_node(
			traversal_root,
			"mapsoo_node_id",
			str(node_plan.id)
		)
		if not (marker is Marker2D):
			return _check_failure("Traversal marker %s is missing." % node_plan.id)
		var expected := _logical_to_world(
			str(plan.profile),
			Vector2i(int(node_plan.x), int(node_plan.y)),
			plan.bounds,
			pixel_bounds
		)
		if not (marker as Marker2D).position.is_equal_approx(expected):
			return _check_failure("Traversal marker %s uses the wrong coordinate model." % node_plan.id)

	var landmarks_root := materialization.get_node("Landmarks")
	if landmarks_root.get_child_count() != plan.landmarks.size():
		return _check_failure("Landmark marker count does not match the plan.")
	for landmark_value: Variant in plan.landmarks:
		var landmark: Dictionary = landmark_value
		if not (
			_find_meta_node(
				landmarks_root,
				"mapsoo_landmark_id",
				str(landmark.id)
			) is Marker2D
		):
			return _check_failure("Landmark marker %s is missing." % landmark.id)

	var spawn := world.get_node_or_null("WorldLayoutPlan/Spawn") as Marker2D
	var exit := world.get_node_or_null("WorldLayoutPlan/Exit") as Marker2D
	if spawn == null or exit == null:
		return _check_failure("Logical spawn or exit marker is missing.")
	var expected_spawn := _logical_to_world(
		str(plan.profile),
		Vector2i(int(plan.spawn.x), int(plan.spawn.y)),
		plan.bounds,
		pixel_bounds
	)
	var expected_exit := _logical_to_world(
		str(plan.profile),
		Vector2i(int(plan.exit.x), int(plan.exit.y)),
		plan.bounds,
		pixel_bounds
	)
	if (
		not spawn.position.is_equal_approx(expected_spawn)
		or not exit.position.is_equal_approx(expected_exit)
	):
		return _check_failure("Spawn or exit was not projected into world coordinates.")
	var runtime_spawn := world.get_node_or_null("PlayerSpawn") as Marker2D
	var runtime_player := world.get_node_or_null("Actors/Player") as CharacterBody2D
	if (
		runtime_spawn == null
		or runtime_player == null
		or not runtime_spawn.position.is_equal_approx(expected_spawn)
		or not runtime_player.position.is_equal_approx(expected_spawn)
		or world.get_meta("mapsoo_layout_player_bound", false) != true
	):
		return _check_failure("Runtime PlayerSpawn/Player did not bind to the confirmed layout.")
	return {"ok": true, "error": ""}


func _assert_controller_uses_layout_exit(
	world: Node,
	plan: Dictionary
) -> Dictionary:
	var player := _find_player(world)
	var layout_exit := world.get_node_or_null("WorldLayoutPlan/Exit") as Marker2D
	if player == null or layout_exit == null:
		return _check_failure("Controller handoff fixture is incomplete.")
	player.call("_find_exit")
	player.global_position = layout_exit.global_position
	player.call("_check_exit")
	if player.get_meta("mapsoo_exit_reached", "") != str(plan.exit.node_id):
		return _check_failure(
			"Controller did not prefer the WorldLayoutPlan exit."
		)
	return {"ok": true, "error": ""}


func _add_legacy_runtime_geometry(world: Node2D) -> void:
	var collision_root := Node2D.new()
	collision_root.name = "WorldCollision"
	world.add_child(collision_root)
	collision_root.owner = world
	var body := StaticBody2D.new()
	body.name = "LegacyBody"
	body.collision_layer = 1
	body.collision_mask = 1
	collision_root.add_child(body)
	body.owner = world
	var body_shape := CollisionShape2D.new()
	body_shape.name = "CollisionShape2D"
	body_shape.shape = RectangleShape2D.new()
	body.add_child(body_shape)
	body_shape.owner = world

	var hazards := Node2D.new()
	hazards.name = "Hazards"
	world.add_child(hazards)
	hazards.owner = world
	var area := Area2D.new()
	area.name = "LegacyHazard"
	area.collision_layer = 2
	area.collision_mask = 1
	hazards.add_child(area)
	area.owner = world
	var area_shape := CollisionShape2D.new()
	area_shape.name = "CollisionShape2D"
	area_shape.shape = RectangleShape2D.new()
	area.add_child(area_shape)
	area_shape.owner = world

	var navigation := NavigationRegion2D.new()
	navigation.name = "WorldNavigation"
	navigation.enabled = true
	world.add_child(navigation)
	navigation.owner = world

	var traversal := Node2D.new()
	traversal.name = "WorldTraversal"
	traversal.set_meta("mapsoo_exit_node_id", "legacy-exit")
	world.add_child(traversal)
	traversal.owner = world
	var legacy_exit := Marker2D.new()
	legacy_exit.name = "LegacyExit"
	legacy_exit.position = Vector2(-1000.0, -1000.0)
	legacy_exit.set_meta("mapsoo_id", "legacy-exit")
	traversal.add_child(legacy_exit)
	legacy_exit.owner = world


func _legacy_runtime_node_is_disabled(node: Node) -> bool:
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


func _find_player(root: Node) -> CharacterBody2D:
	if root is CharacterBody2D and root.name == "Player":
		return root
	for child: Node in root.get_children():
		var player := _find_player(child)
		if player != null:
			return player
	return null


func _assert_tamper_fail_closed() -> bool:
	var fixture := _write_fixture("topdown-farm", "materializer-tamper")
	if not fixture.ok:
		_fail(str(fixture.error))
		return false
	var validated := LayoutAttachment.validate_optional(
		fixture.manifest,
		fixture.root,
		fixture.manifest_sha256
	)
	if not validated.ok:
		_fail("Tamper fixture validation failed before mutation.")
		return false

	var wrong_collision: Dictionary = validated.layout.duplicate(true)
	wrong_collision.plan.collision_intent.solid_terrain_ids.append("missing-terrain")
	if not _expect_binding_failure_without_mutation(wrong_collision, "collision reference"):
		return false

	var dangling_edge: Dictionary = validated.layout.duplicate(true)
	dangling_edge.plan.traversal.edges[0].to = "missing-node"
	if not _expect_binding_failure_without_mutation(dangling_edge, "traversal endpoint"):
		return false
	return true


func _expect_binding_failure_without_mutation(
	attachment: Dictionary,
	label: String
) -> bool:
	var world := Node2D.new()
	world.name = "MapsooWorld"
	world.set_meta("mapsoo_profile", str(attachment.plan.profile))
	var before := _semantic_snapshot(world)
	var result := LayoutAttachment.bind_scene(world, attachment)
	if (
		result.ok
		or world.get_child_count() != 0
		or world.has_meta("mapsoo_layout_materialization")
		or world.get_node_or_null("WorldLayoutPlan") != null
		or world.get_node_or_null(MATERIALIZATION_NODE) != null
		or before != _semantic_snapshot(world)
	):
		world.free()
		_fail("Tampered %s did not fail closed before scene mutation." % label)
		return false
	world.free()
	return true


func _persist_and_reload(world: Node, root: String, profile: String) -> Dictionary:
	var packed := PackedScene.new()
	if packed.pack(world) != OK:
		return {"ok": false, "error": "PackedScene.pack failed."}
	var path := root.path_join("%s-materialized.tscn" % profile)
	if ResourceSaver.save(packed, path) != OK:
		return {"ok": false, "error": "ResourceSaver.save failed."}
	var loaded := ResourceLoader.load(
		path,
		"PackedScene",
		ResourceLoader.CACHE_MODE_IGNORE_DEEP
	) as PackedScene
	if loaded == null:
		return {"ok": false, "error": "Saved scene could not be loaded."}
	return {"ok": true, "root": loaded.instantiate(), "error": ""}


func _find_meta_node(root: Node, key: String, expected: String) -> Node:
	if root.has_meta(key) and str(root.get_meta(key)) == expected:
		return root
	for child: Node in root.get_children():
		var found := _find_meta_node(child, key, expected)
		if found != null:
			return found
	return null


func _nodes_of_type(root: Node, type_name: String) -> Array[Node]:
	var result: Array[Node] = []
	if root.is_class(type_name):
		result.append(root)
	for child: Node in root.get_children():
		result.append_array(_nodes_of_type(child, type_name))
	return result


func _logical_to_world(
	profile: String,
	logical: Vector2i,
	logical_bounds: Dictionary,
	pixel_bounds: Rect2
) -> Vector2:
	var u := (float(logical.x) + 0.5) / float(logical_bounds.width)
	var v := (float(logical.y) + 0.5) / float(logical_bounds.height)
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


func _semantic_snapshot(root: Node) -> String:
	return JSON.stringify(_node_snapshot(root), "", true)


func _node_snapshot(node: Node) -> Dictionary:
	var metadata := {}
	var metadata_keys := node.get_meta_list()
	metadata_keys.sort()
	for key: StringName in metadata_keys:
		metadata[str(key)] = _snapshot_meta(node.get_meta(key))
	var snapshot := {
		"name": str(node.name),
		"class": node.get_class(),
		"metadata": metadata,
		"children": [],
	}
	if node is Node2D:
		snapshot.position = _vector_snapshot((node as Node2D).position)
	if node is Polygon2D:
		snapshot.polygon = _packed_vector_snapshot((node as Polygon2D).polygon)
	if node is CollisionShape2D:
		var collision := node as CollisionShape2D
		snapshot.one_way = collision.one_way_collision
		snapshot.shape = _shape_snapshot(collision.shape)
	if node is NavigationRegion2D:
		var navigation_polygon := (node as NavigationRegion2D).navigation_polygon
		snapshot.navigation = (
			"none"
			if navigation_polygon == null
			else _packed_vector_snapshot(navigation_polygon.get_vertices())
		)
	if node is NavigationLink2D:
		var link := node as NavigationLink2D
		snapshot.link = [
			_vector_snapshot(link.start_position),
			_vector_snapshot(link.end_position),
		]
	if node is TileMapLayer:
		var layer := node as TileMapLayer
		var cell_records: Array[String] = []
		for cell: Vector2i in layer.get_used_cells():
			cell_records.append("%s=%d" % [cell, layer.get_cell_source_id(cell)])
		cell_records.sort()
		snapshot.cells = cell_records
	var children: Array[Node] = []
	for child: Node in node.get_children():
		children.append(child)
	children.sort_custom(func(left: Node, right: Node) -> bool:
		return str(left.name) < str(right.name)
	)
	for child: Node in children:
		snapshot.children.append(_node_snapshot(child))
	return snapshot


func _shape_snapshot(shape: Shape2D) -> Variant:
	if shape == null:
		return null
	if shape is RectangleShape2D:
		return {
			"class": shape.get_class(),
			"size": _vector_snapshot((shape as RectangleShape2D).size),
		}
	if shape is ConvexPolygonShape2D:
		return {
			"class": shape.get_class(),
			"points": _packed_vector_snapshot((shape as ConvexPolygonShape2D).points),
		}
	return {"class": shape.get_class()}


func _snapshot_meta(value: Variant) -> Variant:
	if typeof(value) == TYPE_DICTIONARY:
		var result := {}
		var keys: Array = value.keys()
		keys.sort_custom(func(left: Variant, right: Variant) -> bool:
			return str(left) < str(right)
		)
		for key: Variant in keys:
			result[str(key)] = _snapshot_meta(value[key])
		return result
	if typeof(value) == TYPE_ARRAY:
		var result: Array = []
		for item: Variant in value:
			result.append(_snapshot_meta(item))
		return result
	if typeof(value) == TYPE_VECTOR2:
		return _vector_snapshot(value)
	if typeof(value) == TYPE_VECTOR2I:
		return [value.x, value.y]
	if typeof(value) == TYPE_RECT2:
		return [
			_vector_snapshot(value.position),
			_vector_snapshot(value.size),
		]
	if typeof(value) == TYPE_RECT2I:
		return [
			[value.position.x, value.position.y],
			[value.size.x, value.size.y],
		]
	if typeof(value) == TYPE_PACKED_VECTOR2_ARRAY:
		return _packed_vector_snapshot(value)
	return value


func _vector_snapshot(value: Vector2) -> Array[float]:
	return [snappedf(value.x, 0.01), snappedf(value.y, 0.01)]


func _packed_vector_snapshot(value: PackedVector2Array) -> Array:
	var result: Array = []
	for point: Vector2 in value:
		result.append(_vector_snapshot(point))
	return result


func _expected_used_cells(terrain_items: Array) -> int:
	var cells := {}
	for terrain_value: Variant in terrain_items:
		var terrain: Dictionary = terrain_value
		for y: int in range(int(terrain.y), int(terrain.y) + int(terrain.height)):
			for x: int in range(int(terrain.x), int(terrain.x) + int(terrain.width)):
				cells[Vector2i(x, y)] = true
	return cells.size()


func _first_difference(left: String, right: String) -> String:
	var limit := mini(left.length(), right.length())
	for index: int in limit:
		if left[index] != right[index]:
			return "index=%d left=%s right=%s" % [
				index,
				left.substr(maxi(0, index - 80), 160),
				right.substr(maxi(0, index - 80), 160),
			]
	return "length left=%d right=%d" % [left.length(), right.length()]


func _check_failure(message: String) -> Dictionary:
	return {"ok": false, "error": message}
