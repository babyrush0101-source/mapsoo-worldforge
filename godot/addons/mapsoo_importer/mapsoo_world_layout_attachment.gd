@tool
extends RefCounted

## Optional WorldLayoutPlan 1.0 attachment support for Pack 0.6--1.0.
##
## The attachment is persisted as verified planning metadata and materialized
## through Godot-native logical cells, collision, navigation and markers.

const LayoutMaterializer = preload(
	"res://addons/mapsoo_importer/mapsoo_world_layout_materializer.gd"
)

const ATTACHMENT_PATH := "world-layout-plan.json"
const SCHEMA_VERSION := "1.0.0"
const DOCUMENT_TYPE := "world-layout-plan"
const STATUS := "planned"
const MAX_JSON_BYTES := 2 * 1024 * 1024
const PROFILE_RULES := {
	"side-platformer": {
		"terrain_kind": "bands",
		"terrain_key": "bands",
		"minimum_terrain": 5,
		"collision_mode": "side-solids",
		"navigation_mode": "platform-links",
	},
	"topdown-farm": {
		"terrain_kind": "zones",
		"terrain_key": "zones",
		"minimum_terrain": 4,
		"collision_mode": "topdown-obstacles",
		"navigation_mode": "orthogonal-grid",
	},
	"isometric-action": {
		"terrain_kind": "zones",
		"terrain_key": "zones",
		"minimum_terrain": 4,
		"collision_mode": "isometric-footprints",
		"navigation_mode": "diamond-grid",
	},
	"layered-depth-2d": {
		"terrain_kind": "zones",
		"terrain_key": "zones",
		"minimum_terrain": 4,
		"collision_mode": "depth-lane-blockers",
		"navigation_mode": "depth-lanes",
	},
}


static func validate_optional(
	manifest: Dictionary,
	pack_root: String,
	manifest_sha256: String
) -> Dictionary:
	var binding_value: Variant = manifest.get("layout")
	var attachment_exists := FileAccess.file_exists(pack_root.path_join(ATTACHMENT_PATH))
	if binding_value == null:
		if attachment_exists:
			return _failure(
				"World layout attachment exists without a manifest layout binding."
			)
		return {
			"ok": true,
			"status": "absent",
			"layout": {},
			"error": "",
		}
	if typeof(binding_value) != TYPE_DICTIONARY:
		return _failure("Manifest layout binding must be an object.")
	var binding: Dictionary = binding_value
	if not _exact_keys(
		binding,
		["schema_version", "document_type", "plan_id", "path", "sha256"]
	):
		return _failure("Manifest layout binding has unsupported or missing fields.")
	if (
		binding.get("schema_version") != SCHEMA_VERSION
		or binding.get("document_type") != DOCUMENT_TYPE
		or not _safe_id(binding.get("plan_id"))
		or binding.get("path") != ATTACHMENT_PATH
		or not _sha256(binding.get("sha256"))
	):
		return _failure("Manifest layout binding is not canonical WorldLayoutPlan 1.0.")
	if not attachment_exists:
		return _failure("Manifest-bound world layout attachment is missing.")

	var file_record := _file_record(manifest.get("files"), ATTACHMENT_PATH)
	if file_record.is_empty():
		return _failure("Manifest layout binding has no matching files record.")
	if (
		not _exact_keys(file_record, ["path", "media_type", "bytes", "sha256"])
		or file_record.get("media_type") != "application/json"
		or not _json_integer(file_record.get("bytes"))
		or int(file_record.get("bytes", 0)) < 1
		or int(file_record.get("bytes", 0)) > MAX_JSON_BYTES
		or file_record.get("sha256") != binding.get("sha256")
	):
		return _failure("World layout files record does not match its manifest binding.")

	var attachment_path := pack_root.path_join(ATTACHMENT_PATH)
	var file := FileAccess.open(attachment_path, FileAccess.READ)
	if file == null:
		return _failure("World layout attachment cannot be read.")
	var length := file.get_length()
	var bytes := file.get_buffer(length)
	file.close()
	if length != int(file_record.get("bytes", -1)):
		return _failure("World layout attachment byte length does not match the manifest.")
	var actual_sha256 := _sha256_bytes(bytes)
	if actual_sha256 != str(binding.get("sha256", "")):
		return _failure("World layout attachment SHA-256 does not match the manifest.")
	var parser := JSON.new()
	if parser.parse(bytes.get_string_from_utf8()) != OK or typeof(parser.data) != TYPE_DICTIONARY:
		return _failure("World layout attachment is not valid JSON.")

	var expected_profile: Variant = manifest.get("profile")
	if typeof(expected_profile) != TYPE_STRING or not PROFILE_RULES.has(expected_profile):
		return _failure("Manifest profile cannot consume WorldLayoutPlan 1.0.")
	var expected_seed: Variant = (manifest.get("provenance", {}) as Dictionary).get("seed")
	var validated := _validate_plan(parser.data as Dictionary, expected_profile, expected_seed)
	if not validated.ok:
		return validated
	var plan: Dictionary = validated.layout
	if plan.get("plan_id") != binding.get("plan_id"):
		return _failure("World layout plan_id differs from its manifest binding.")
	return {
		"ok": true,
		"status": "bound",
		"layout": {
			"plan": plan,
			"sha256": actual_sha256,
			"manifest_sha256": manifest_sha256,
		},
		"error": "",
	}


static func bind_scene(root: Node, attachment: Dictionary) -> Dictionary:
	if attachment.is_empty():
		return {"ok": true, "status": "absent", "error": ""}
	if root == null or not attachment.has("plan"):
		return _failure("World layout scene binding input is invalid.")
	if root.get_node_or_null("WorldLayoutPlan") != null:
		return _failure("Generated scene already contains a WorldLayoutPlan node.")
	var plan: Dictionary = attachment.plan
	var plan_source := _dictionary(plan.get("source"))
	var expected_profile := str(root.get_meta("mapsoo_profile", plan.get("profile", "")))
	var plan_revalidation := _validate_plan(
		plan,
		expected_profile,
		plan_source.get("seed")
	)
	if not plan_revalidation.ok:
		return plan_revalidation
	plan = plan_revalidation.layout
	var materializer_preflight := LayoutMaterializer.validate_plan(root, plan)
	if not materializer_preflight.ok:
		return materializer_preflight
	var spawn_value: Dictionary = plan.spawn
	var exit_value: Dictionary = plan.exit
	var bounds_value: Dictionary = plan.bounds
	var collision: Dictionary = plan.collision_intent
	var navigation: Dictionary = plan.navigation_intent

	root.set_meta("mapsoo_layout_schema_version", SCHEMA_VERSION)
	root.set_meta("mapsoo_layout_plan_id", str(plan.plan_id))
	root.set_meta("mapsoo_layout_plan_sha256", str(attachment.sha256))
	root.set_meta("mapsoo_layout_manifest_sha256", str(attachment.manifest_sha256))
	root.set_meta("mapsoo_layout_profile", str(plan.profile))
	root.set_meta(
		"mapsoo_layout_bounds",
		Vector2i(int(bounds_value.width), int(bounds_value.height))
	)
	root.set_meta("mapsoo_layout_unit", "logical-tile")
	root.set_meta(
		"mapsoo_layout_spawn",
		Vector2i(int(spawn_value.x), int(spawn_value.y))
	)
	root.set_meta(
		"mapsoo_layout_exit",
		Vector2i(int(exit_value.x), int(exit_value.y))
	)
	root.set_meta("mapsoo_layout_collision_mode", str(collision.mode))
	root.set_meta("mapsoo_layout_navigation_mode", str(navigation.mode))

	var container := Node.new()
	container.name = "WorldLayoutPlan"
	container.set_meta("mapsoo_regions", (plan.regions as Array).duplicate(true))
	container.set_meta(
		"mapsoo_terrain_layout",
		(plan.terrain_layout as Dictionary).duplicate(true)
	)
	container.set_meta("mapsoo_traversal", (plan.traversal as Dictionary).duplicate(true))
	container.set_meta("mapsoo_landmarks", (plan.landmarks as Array).duplicate(true))
	container.set_meta(
		"mapsoo_collision_intent",
		(plan.collision_intent as Dictionary).duplicate(true)
	)
	container.set_meta(
		"mapsoo_navigation_intent",
		(plan.navigation_intent as Dictionary).duplicate(true)
	)
	root.add_child(container)
	container.owner = root

	var spawn := Marker2D.new()
	spawn.name = "Spawn"
	spawn.set_meta("mapsoo_node_id", str(spawn_value.node_id))
	spawn.set_meta(
		"mapsoo_logical_position",
		Vector2i(int(spawn_value.x), int(spawn_value.y))
	)
	spawn.set_meta("mapsoo_coordinate_unit", "logical-tile")
	container.add_child(spawn)
	spawn.owner = root

	var exit := Marker2D.new()
	exit.name = "Exit"
	exit.set_meta("mapsoo_node_id", str(exit_value.node_id))
	exit.set_meta(
		"mapsoo_logical_position",
		Vector2i(int(exit_value.x), int(exit_value.y))
	)
	exit.set_meta("mapsoo_coordinate_unit", "logical-tile")
	container.add_child(exit)
	exit.owner = root
	var materialized := LayoutMaterializer.materialize(root, plan, spawn, exit)
	if not materialized.ok:
		root.remove_child(container)
		container.free()
		for key: String in [
			"mapsoo_layout_schema_version",
			"mapsoo_layout_plan_id",
			"mapsoo_layout_plan_sha256",
			"mapsoo_layout_manifest_sha256",
			"mapsoo_layout_profile",
			"mapsoo_layout_bounds",
			"mapsoo_layout_unit",
			"mapsoo_layout_spawn",
			"mapsoo_layout_exit",
			"mapsoo_layout_collision_mode",
			"mapsoo_layout_navigation_mode",
		]:
			root.remove_meta(key)
		return materialized
	return {"ok": true, "status": "bound", "error": ""}


static func validate_bound_scene(root: Node, attachment: Dictionary) -> Dictionary:
	if attachment.is_empty():
		if root.get_node_or_null("WorldLayoutPlan") != null:
			return _failure("Staged scene contains an undeclared WorldLayoutPlan.")
		return {"ok": true, "status": "absent", "error": ""}
	var plan: Dictionary = attachment.get("plan", {})
	var container := root.get_node_or_null("WorldLayoutPlan")
	var spawn := root.get_node_or_null("WorldLayoutPlan/Spawn")
	var exit := root.get_node_or_null("WorldLayoutPlan/Exit")
	if container == null or not (spawn is Marker2D) or not (exit is Marker2D):
		return _failure("Staged scene lost its WorldLayoutPlan markers.")
	if (
		root.get_meta("mapsoo_layout_schema_version", "") != SCHEMA_VERSION
		or root.get_meta("mapsoo_layout_plan_id", "") != plan.get("plan_id")
		or root.get_meta("mapsoo_layout_plan_sha256", "") != attachment.get("sha256")
		or root.get_meta("mapsoo_layout_manifest_sha256", "") != attachment.get("manifest_sha256")
		or root.get_meta("mapsoo_layout_profile", "") != plan.get("profile")
	):
		return _failure("Staged scene WorldLayoutPlan identity metadata differs from validation.")
	var expected_spawn := Vector2i(int(plan.spawn.x), int(plan.spawn.y))
	var expected_exit := Vector2i(int(plan.exit.x), int(plan.exit.y))
	if (
		root.get_meta("mapsoo_layout_spawn", Vector2i(-1, -1)) != expected_spawn
		or root.get_meta("mapsoo_layout_exit", Vector2i(-1, -1)) != expected_exit
		or spawn.get_meta("mapsoo_logical_position", Vector2i(-1, -1)) != expected_spawn
		or exit.get_meta("mapsoo_logical_position", Vector2i(-1, -1)) != expected_exit
		or spawn.get_meta("mapsoo_node_id", "") != plan.spawn.node_id
		or exit.get_meta("mapsoo_node_id", "") != plan.exit.node_id
	):
		return _failure("Staged scene WorldLayoutPlan endpoints differ from validation.")
	if (
		container.get_meta("mapsoo_regions", []) != plan.regions
		or container.get_meta("mapsoo_terrain_layout", {}) != plan.terrain_layout
		or container.get_meta("mapsoo_traversal", {}) != plan.traversal
		or container.get_meta("mapsoo_collision_intent", {}) != plan.collision_intent
		or container.get_meta("mapsoo_navigation_intent", {}) != plan.navigation_intent
	):
		return _failure("Staged scene WorldLayoutPlan intent metadata differs from validation.")
	var materialized := LayoutMaterializer.validate_scene(root, plan)
	if not materialized.ok:
		return materialized
	return {"ok": true, "status": "bound", "error": ""}


static func _validate_plan(
	plan: Dictionary,
	expected_profile: String,
	expected_seed: Variant
) -> Dictionary:
	var top_level := [
		"schema_version", "document_type", "status", "plan_id", "profile",
		"source", "bounds", "regions", "terrain_layout", "spawn", "exit",
		"traversal", "landmarks", "collision_intent", "navigation_intent",
	]
	if not _exact_keys(plan, top_level):
		return _failure("World layout plan has unsupported or missing top-level fields.")
	if (
		plan.get("schema_version") != SCHEMA_VERSION
		or plan.get("document_type") != DOCUMENT_TYPE
		or plan.get("status") != STATUS
		or not _safe_id(plan.get("plan_id"))
		or plan.get("profile") != expected_profile
	):
		return _failure("World layout identity or profile is invalid.")
	var rules: Dictionary = PROFILE_RULES[expected_profile]

	var source := _dictionary(plan.get("source"))
	if not _exact_keys(source, [
		"intake_id", "session_revision", "intake_sha256",
		"map_layout_checkpoint_sha256", "seed", "seed_sha256",
	]):
		return _failure("World layout source binding is invalid.")
	if (
		not _safe_id(source.get("intake_id"))
		or not _json_integer(source.get("session_revision"))
		or int(source.get("session_revision", 0)) < 4
		or not _sha256(source.get("intake_sha256"))
		or not _sha256(source.get("map_layout_checkpoint_sha256"))
		or typeof(source.get("seed")) != TYPE_STRING
		or str(source.get("seed", "")).is_empty()
		or not _sha256(source.get("seed_sha256"))
		or source.get("seed_sha256") != _sha256_text(JSON.stringify(source.get("seed")))
		or (
			expected_seed != null
			and (
				typeof(expected_seed) != TYPE_STRING
				or source.get("seed") != expected_seed
			)
		)
	):
		return _failure("World layout source seed or provenance binding is invalid.")

	var bounds := _dictionary(plan.get("bounds"))
	if (
		not _exact_keys(bounds, ["width", "height", "unit"])
		or not _integer_range(bounds.get("width"), 16, 512)
		or not _integer_range(bounds.get("height"), 12, 512)
		or bounds.get("unit") != "logical-tile"
	):
		return _failure("World layout bounds are invalid.")

	var regions_value: Variant = plan.get("regions")
	if (
		typeof(regions_value) != TYPE_ARRAY
		or regions_value.size() < 3
		or regions_value.size() > 32
	):
		return _failure("World layout regions are invalid.")
	var regions: Array = regions_value
	var region_index := {}
	var purposes := {}
	for value: Variant in regions:
		var region := _dictionary(value)
		if (
			not _exact_keys(region, ["id", "x", "y", "width", "height", "purpose"])
			or not _safe_id(region.get("id"))
			or region_index.has(region.get("id"))
			or region.get("purpose") not in ["spawn", "route", "landmark", "exit"]
			or not _valid_rectangle(region, bounds)
		):
			return _failure("World layout contains an invalid or duplicate region.")
		region_index[region.id] = region
		purposes[region.purpose] = true
	if not purposes.has("spawn") or not purposes.has("exit"):
		return _failure("World layout requires spawn and exit regions.")

	var terrain_layout := _dictionary(plan.get("terrain_layout"))
	if (
		not _exact_keys(terrain_layout, ["kind", rules.terrain_key])
		or terrain_layout.get("kind") != rules.terrain_kind
	):
		return _failure("World layout terrain grammar does not match its profile.")
	var terrain_value: Variant = terrain_layout.get(rules.terrain_key)
	if (
		typeof(terrain_value) != TYPE_ARRAY
		or terrain_value.size() < int(rules.minimum_terrain)
		or terrain_value.size() > 64
	):
		return _failure("World layout terrain count is invalid.")
	var terrain_index := {}
	for value: Variant in terrain_value:
		var terrain := _dictionary(value)
		if (
			not _exact_keys(
				terrain,
				["id", "x", "y", "width", "height", "material", "navigation"]
			)
			or not _safe_id(terrain.get("id"))
			or terrain_index.has(terrain.get("id"))
			or not _safe_id(terrain.get("material"))
			or terrain.get("navigation") not in ["walkable", "blocked", "one-way"]
			or not _valid_rectangle(terrain, bounds)
		):
			return _failure("World layout contains invalid or duplicate terrain.")
		terrain_index[terrain.id] = terrain

	var traversal := _dictionary(plan.get("traversal"))
	if not _exact_keys(traversal, ["nodes", "edges"]):
		return _failure("World layout traversal is invalid.")
	var nodes_value: Variant = traversal.get("nodes")
	var edges_value: Variant = traversal.get("edges")
	if (
		typeof(nodes_value) != TYPE_ARRAY
		or nodes_value.size() < 6
		or nodes_value.size() > 64
		or typeof(edges_value) != TYPE_ARRAY
		or edges_value.size() < 5
		or edges_value.size() > 128
	):
		return _failure("World layout traversal counts are invalid.")
	var node_index := {}
	var spawn_nodes: Array[String] = []
	var exit_nodes: Array[String] = []
	for value: Variant in nodes_value:
		var node := _dictionary(value)
		if (
			not _exact_keys(node, ["id", "kind", "region_id", "x", "y"])
			or not _safe_id(node.get("id"))
			or node_index.has(node.get("id"))
			or node.get("kind") not in ["spawn", "route", "landmark", "exit"]
			or not region_index.has(node.get("region_id"))
			or not _valid_point(node, bounds)
			or not _region_contains(region_index[node.region_id], node)
		):
			return _failure("World layout contains an invalid or duplicate traversal node.")
		node_index[node.id] = node
		if node.kind == "spawn":
			spawn_nodes.append(node.id)
		elif node.kind == "exit":
			exit_nodes.append(node.id)
	if spawn_nodes.size() != 1 or exit_nodes.size() != 1:
		return _failure("World layout requires exactly one spawn and one exit node.")

	var edge_index := {}
	var adjacency := {}
	for node_id: Variant in node_index:
		adjacency[node_id] = []
	for value: Variant in edges_value:
		var edge := _dictionary(value)
		if (
			not _exact_keys(edge, ["id", "from", "to", "kind", "direction"])
			or not _safe_id(edge.get("id"))
			or edge_index.has(edge.get("id"))
			or not node_index.has(edge.get("from"))
			or not node_index.has(edge.get("to"))
			or edge.get("from") == edge.get("to")
			or edge.get("kind") not in ["walk", "jump", "drop", "climb", "portal"]
			or edge.get("direction") not in ["forward", "bidirectional"]
		):
			return _failure("World layout contains an invalid or duplicate traversal edge.")
		edge_index[edge.id] = edge
		(adjacency[edge.get("from")] as Array).append(edge.get("to"))
		if edge.get("direction") == "bidirectional":
			(adjacency[edge.get("to")] as Array).append(edge.get("from"))

	var spawn := _dictionary(plan.get("spawn"))
	var exit := _dictionary(plan.get("exit"))
	if (
		not _valid_endpoint(spawn, node_index, "spawn", bounds)
		or not _valid_endpoint(exit, node_index, "exit", bounds)
		or spawn.get("node_id") == exit.get("node_id")
	):
		return _failure("World layout spawn or exit binding is invalid.")
	if (
		(region_index[(node_index[spawn.node_id] as Dictionary).region_id] as Dictionary).purpose
			!= "spawn"
		or (region_index[(node_index[exit.node_id] as Dictionary).region_id] as Dictionary).purpose
			!= "exit"
	):
		return _failure("World layout endpoints must use matching-purpose regions.")
	var reached := {}
	var queue: Array = [spawn.node_id]
	reached[spawn.node_id] = true
	while not queue.is_empty():
		var current: Variant = queue.pop_front()
		for next: Variant in adjacency[current]:
			if not reached.has(next):
				reached[next] = true
				queue.append(next)
	if reached.size() != node_index.size() or not reached.has(exit.node_id):
		return _failure("World layout traversal is disconnected from spawn.")

	var landmarks_value: Variant = plan.get("landmarks")
	if (
		typeof(landmarks_value) != TYPE_ARRAY
		or landmarks_value.size() < 2
		or landmarks_value.size() > 16
	):
		return _failure("World layout landmarks are invalid.")
	var landmark_ids := {}
	var landmark_node_ids := {}
	for value: Variant in landmarks_value:
		var landmark := _dictionary(value)
		var landmark_node: Dictionary = node_index.get(landmark.get("node_id"), {})
		if (
			not _exact_keys(
				landmark,
				["id", "label", "region_id", "node_id", "x", "y"]
			)
			or not _safe_id(landmark.get("id"))
			or landmark_ids.has(landmark.get("id"))
			or typeof(landmark.get("label")) != TYPE_STRING
			or str(landmark.get("label", "")).strip_edges().is_empty()
			or str(landmark.get("label", "")).length() > 120
			or not region_index.has(landmark.get("region_id"))
			or (region_index[landmark.get("region_id")] as Dictionary).get("purpose")
				!= "landmark"
			or landmark_node.get("kind") != "landmark"
			or landmark_node.get("region_id") != landmark.get("region_id")
			or landmark_node.get("x") != landmark.get("x")
			or landmark_node.get("y") != landmark.get("y")
		):
			return _failure("World layout contains an invalid landmark binding.")
		landmark_ids[landmark.id] = true
		if landmark_node_ids.has(landmark.node_id):
			return _failure("World layout landmarks must bind distinct nodes.")
		landmark_node_ids[landmark.node_id] = true
	for node_id: Variant in node_index:
		if (
			(node_index[node_id] as Dictionary).get("kind") == "landmark"
			and not landmark_node_ids.has(node_id)
		):
			return _failure("Every landmark node must have one landmark binding.")

	var collision := _dictionary(plan.get("collision_intent"))
	if (
		not _exact_keys(collision, [
			"mode", "solid_terrain_ids", "one_way_terrain_ids", "blocked_region_ids",
		])
		or collision.get("mode") != rules.collision_mode
		or not _valid_id_array(collision.get("solid_terrain_ids"), terrain_index)
		or not _valid_id_array(collision.get("one_way_terrain_ids"), terrain_index)
		or not _valid_id_array(collision.get("blocked_region_ids"), region_index)
	):
		return _failure("World layout collision intent is invalid.")
	for terrain_id: Variant in collision.get("one_way_terrain_ids"):
		if (terrain_index[terrain_id] as Dictionary).get("navigation") != "one-way":
			return _failure("World layout one-way collision intent references non-one-way terrain.")
	var declared_one_way := {}
	for terrain_id: Variant in terrain_index:
		var navigation_kind: Variant = (terrain_index[terrain_id] as Dictionary).get("navigation")
		if navigation_kind == "one-way":
			declared_one_way[terrain_id] = true
		elif (
			navigation_kind == "blocked"
			and not (collision.get("solid_terrain_ids") as Array).has(terrain_id)
		):
			return _failure("World layout collision intent omits blocked terrain.")
	if not _same_id_set(collision.get("one_way_terrain_ids"), declared_one_way.keys()):
		return _failure("World layout collision intent must bind every one-way terrain item.")
	if (
		(expected_profile == "side-platformer" and declared_one_way.is_empty())
		or (
			expected_profile != "side-platformer"
			and not (collision.get("one_way_terrain_ids") as Array).is_empty()
		)
	):
		return _failure("World layout one-way terrain is incompatible with its profile.")

	var navigation := _dictionary(plan.get("navigation_intent"))
	if (
		not _exact_keys(navigation, [
			"mode", "walkable_region_ids", "traversal_edge_ids", "agent_radius",
		])
		or navigation.get("mode") != rules.navigation_mode
		or not _valid_id_array(navigation.get("walkable_region_ids"), region_index)
		or not _valid_id_array(navigation.get("traversal_edge_ids"), edge_index)
		or not _number_range(navigation.get("agent_radius"), 0.1, 8.0)
		or not _same_id_set(navigation.get("traversal_edge_ids"), edge_index.keys())
	):
		return _failure("World layout navigation intent is invalid.")
	var walkable_regions: Array = navigation.get("walkable_region_ids")
	if walkable_regions.is_empty():
		return _failure("World layout navigation requires a walkable region.")
	for region_id: Variant in collision.get("blocked_region_ids"):
		if walkable_regions.has(region_id):
			return _failure("Blocked regions cannot be declared walkable.")
	for node_id: Variant in node_index:
		if not walkable_regions.has((node_index[node_id] as Dictionary).get("region_id")):
			return _failure("Traversal nodes must use walkable regions.")
	return {"ok": true, "status": "bound", "layout": plan.duplicate(true), "error": ""}


static func _valid_endpoint(
	endpoint: Dictionary,
	nodes: Dictionary,
	expected_kind: String,
	bounds: Dictionary
) -> bool:
	if (
		not _exact_keys(endpoint, ["node_id", "x", "y"])
		or not nodes.has(endpoint.get("node_id"))
		or not _valid_point(endpoint, bounds)
	):
		return false
	var node: Dictionary = nodes[endpoint.node_id]
	return (
		node.get("kind") == expected_kind
		and node.get("x") == endpoint.get("x")
		and node.get("y") == endpoint.get("y")
	)


static func _valid_rectangle(value: Dictionary, bounds: Dictionary) -> bool:
	return (
		_integer_range(value.get("x"), 0, int(bounds.width) - 1)
		and _integer_range(value.get("y"), 0, int(bounds.height) - 1)
		and _integer_range(value.get("width"), 1, int(bounds.width))
		and _integer_range(value.get("height"), 1, int(bounds.height))
		and int(value.x) + int(value.width) <= int(bounds.width)
		and int(value.y) + int(value.height) <= int(bounds.height)
	)


static func _valid_point(value: Dictionary, bounds: Dictionary) -> bool:
	return (
		_integer_range(value.get("x"), 0, int(bounds.width) - 1)
		and _integer_range(value.get("y"), 0, int(bounds.height) - 1)
	)


static func _region_contains(region: Dictionary, point: Dictionary) -> bool:
	return (
		int(point.x) >= int(region.x)
		and int(point.y) >= int(region.y)
		and int(point.x) < int(region.x) + int(region.width)
		and int(point.y) < int(region.y) + int(region.height)
	)


static func _valid_id_array(value: Variant, allowed: Dictionary) -> bool:
	if typeof(value) != TYPE_ARRAY or value.size() > 128:
		return false
	var seen := {}
	for item: Variant in value:
		if not _safe_id(item) or seen.has(item) or not allowed.has(item):
			return false
		seen[item] = true
	return true


static func _same_id_set(left: Variant, right: Array) -> bool:
	if typeof(left) != TYPE_ARRAY or left.size() != right.size():
		return false
	var values := {}
	for item: Variant in left:
		values[item] = true
	for item: Variant in right:
		if not values.has(item):
			return false
	return true


static func _file_record(value: Variant, expected_path: String) -> Dictionary:
	if typeof(value) != TYPE_ARRAY:
		return {}
	var found := {}
	for record_value: Variant in value:
		if (
			typeof(record_value) == TYPE_DICTIONARY
			and record_value.get("path") == expected_path
		):
			if not found.is_empty():
				return {}
			found = record_value
	return found


static func _dictionary(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


static func _exact_keys(value: Dictionary, expected: Array) -> bool:
	if value.size() != expected.size():
		return false
	for key: Variant in expected:
		if not value.has(key):
			return false
	return true


static func _safe_id(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING or str(value).is_empty() or str(value).length() > 80:
		return false
	var regex := RegEx.new()
	return (
		regex.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$") == OK
		and regex.search(value) != null
	)


static func _sha256(value: Variant) -> bool:
	if typeof(value) != TYPE_STRING:
		return false
	var regex := RegEx.new()
	return regex.compile("^[0-9a-f]{64}$") == OK and regex.search(value) != null


static func _json_integer(value: Variant) -> bool:
	return (
		typeof(value) == TYPE_INT
		or (typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value))
	)


static func _integer_range(value: Variant, minimum: int, maximum: int) -> bool:
	return _json_integer(value) and int(value) >= minimum and int(value) <= maximum


static func _number_range(value: Variant, minimum: float, maximum: float) -> bool:
	return (
		typeof(value) in [TYPE_INT, TYPE_FLOAT]
		and is_finite(float(value))
		and float(value) >= minimum
		and float(value) <= maximum
	)


static func _sha256_bytes(value: PackedByteArray) -> String:
	var context := HashingContext.new()
	if context.start(HashingContext.HASH_SHA256) != OK:
		return ""
	context.update(value)
	return context.finish().hex_encode()


static func _sha256_text(value: String) -> String:
	return _sha256_bytes(value.to_utf8_buffer())


static func _failure(message: String) -> Dictionary:
	return {
		"ok": false,
		"status": "failed",
		"layout": {},
		"error": message,
	}
