@tool
extends RefCounted

## Materializes one upstream-validated WorldVisualPlacementPlan into a
## materialized WorldLayoutPlan scene. Placement data never supplies scripts.

const LayoutMaterializer = preload(
	"res://addons/mapsoo_importer/mapsoo_world_layout_materializer.gd"
)

const STATUS := "world-visual-placements-v1"
const MATERIALIZATION_PATH := "MapsooLayoutMaterialization"
const CONTAINER_NAME := "WorldVisualPlacements"
const FIXED_NAME := "Fixed"
const Y_SORTED_NAME := "YSorted"
const LAYERS := [
	"background",
	"world",
	"actors",
	"effects",
	"foreground",
	"lighting",
]
const LAYER_ORDER := {
	"background": 0,
	"world": 1,
	"actors": 2,
	"effects": 3,
	"foreground": 4,
	"lighting": 5,
}
const CANVAS_LAYERS := {
	"background": -30,
	"world": 0,
	"actors": 10,
	"effects": 20,
	"foreground": 30,
	"lighting": 40,
}
const LAYER_NAMES := {
	"background": "Background",
	"world": "World",
	"actors": "Actors",
	"effects": "Effects",
	"foreground": "Foreground",
	"lighting": "Lighting",
}
const KINDS := ["sprite", "depth-plane", "effect", "actor"]
const CONTROLLERS := ["player", "npc", "enemy", "moving-platform", "ambient"]
const TRIGGERS := [
	"always", "on-spawn", "on-interact", "on-enter", "on-exit",
	"on-attack", "on-impact", "on-defeat",
]
const PROFILES := [
	"side-platformer",
	"topdown-farm",
	"isometric-action",
	"layered-depth-2d",
]
const BINDING_FIELDS := [
	"task_id", "slot_id", "role", "variant_id", "region", "cell_sha256",
]


static func prepare(
	root: Node,
	placement_plan: Dictionary,
	binding_by_placement: Dictionary,
	asset_by_slot: Dictionary,
	texture_by_task: Dictionary,
	layout_plan: Dictionary
) -> Dictionary:
	var resolved := _resolve(
		root,
		placement_plan,
		binding_by_placement,
		asset_by_slot,
		texture_by_task,
		layout_plan,
		false
	)
	if not resolved.ok:
		return resolved
	var container := Node.new()
	container.name = CONTAINER_NAME
	container.set_meta("mapsoo_world_visual_status", STATUS)
	container.set_meta("mapsoo_world_visual_plan_id", str(placement_plan.plan_id))
	container.set_meta("mapsoo_layout_plan_sha256", str(placement_plan.source.layout_plan_sha256))
	container.set_meta("mapsoo_profile", str(placement_plan.profile))
	container.set_meta("mapsoo_world_visual_receipts", resolved.receipts.duplicate(true))
	container.set_meta("mapsoo_world_visual_counts", resolved.counts.duplicate(true))
	var layer_nodes := {}
	for layer: String in LAYERS:
		var canvas := CanvasLayer.new()
		canvas.name = LAYER_NAMES[layer]
		canvas.layer = int(CANVAS_LAYERS[layer])
		canvas.follow_viewport_enabled = true
		canvas.follow_viewport_scale = 1.0
		canvas.set_meta("mapsoo_world_visual_layer", layer)
		var fixed := Node2D.new()
		fixed.name = FIXED_NAME
		fixed.y_sort_enabled = false
		var y_sorted := Node2D.new()
		y_sorted.name = Y_SORTED_NAME
		y_sorted.y_sort_enabled = true
		canvas.add_child(fixed)
		canvas.add_child(y_sorted)
		container.add_child(canvas)
		layer_nodes[layer] = {"fixed": fixed, "y_sorted": y_sorted}
	for item_value: Variant in resolved.items:
		var item: Dictionary = item_value
		var built := _build_node(item)
		if not built.ok:
			container.free()
			return built
		var groups: Dictionary = layer_nodes[str(item.placement.render.layer)]
		var parent: Node2D = (
			groups.y_sorted
			if bool(item.y_sort)
			else groups.fixed
		)
		parent.add_child(built.node)
	return {
		"ok": true,
		"status": "prepared",
		"root_instance_id": root.get_instance_id(),
		"plan_id": str(placement_plan.plan_id),
		"container": container,
		"counts": resolved.counts.duplicate(true),
		"receipts": resolved.receipts.duplicate(true),
		"error": "",
	}


static func apply(root: Node, prepared: Dictionary) -> Dictionary:
	if (
		root == null
		or not _exact_keys(prepared, [
			"ok", "status", "root_instance_id", "plan_id", "container",
			"counts", "receipts", "error",
		])
		or prepared.get("ok") != true
		or prepared.get("status") != "prepared"
		or int(prepared.get("root_instance_id", 0)) != root.get_instance_id()
		or not prepared.get("container") is Node
		or typeof(prepared.get("counts")) != TYPE_DICTIONARY
		or typeof(prepared.get("receipts")) != TYPE_ARRAY
	):
		return _failure("Prepared visual placement input is invalid.")
	var materialization := root.get_node_or_null(MATERIALIZATION_PATH)
	var container: Node = prepared.container
	if (
		materialization == null
		or root.get_meta("mapsoo_layout_materialization", "") != "profile-layout-v1"
		or root.get_node_or_null("%s/%s" % [MATERIALIZATION_PATH, CONTAINER_NAME]) != null
		or root.has_meta("mapsoo_world_visual_status")
		or container.get_parent() != null
		or container.name != CONTAINER_NAME
		or container.get_child_count() != LAYERS.size()
		or container.get_meta("mapsoo_world_visual_plan_id", "") != prepared.get("plan_id")
	):
		return _failure("Prepared visual placements cannot be attached to this scene.")
	materialization.add_child(container)
	_set_owner_recursive(container, root)
	root.set_meta("mapsoo_world_visual_status", STATUS)
	root.set_meta("mapsoo_world_visual_plan_id", str(prepared.plan_id))
	root.set_meta("mapsoo_world_visual_counts", (prepared.counts as Dictionary).duplicate(true))
	return {
		"ok": true,
		"status": STATUS,
		"placements": (prepared.receipts as Array).size(),
		"counts": (prepared.counts as Dictionary).duplicate(true),
		"error": "",
	}


static func validate_scene(
	root: Node,
	placement_plan: Dictionary,
	binding_by_placement: Dictionary,
	asset_by_slot: Dictionary,
	texture_by_task: Dictionary,
	layout_plan: Dictionary
) -> Dictionary:
	var resolved := _resolve(
		root,
		placement_plan,
		binding_by_placement,
		asset_by_slot,
		texture_by_task,
		layout_plan,
		true
	)
	if not resolved.ok:
		return resolved
	var container := root.get_node_or_null(
		"%s/%s" % [MATERIALIZATION_PATH, CONTAINER_NAME]
	)
	if (
		container == null
		or root.get_meta("mapsoo_world_visual_status", "") != STATUS
		or root.get_meta("mapsoo_world_visual_plan_id", "") != placement_plan.get("plan_id")
		or root.get_meta("mapsoo_world_visual_counts", {}) != resolved.counts
		or container.get_meta("mapsoo_world_visual_status", "") != STATUS
		or container.get_meta("mapsoo_world_visual_plan_id", "") != placement_plan.get("plan_id")
		or container.get_meta("mapsoo_layout_plan_sha256", "")
			!= (placement_plan.source as Dictionary).get("layout_plan_sha256")
		or container.get_meta("mapsoo_profile", "") != placement_plan.get("profile")
		or container.get_meta("mapsoo_world_visual_receipts", []) != resolved.receipts
		or container.get_meta("mapsoo_world_visual_counts", {}) != resolved.counts
		or container.get_child_count() != LAYERS.size()
	):
		return _failure("Persisted visual placement root changed.")
	var actual_by_id := {}
	for layer: String in LAYERS:
		var canvas := container.get_node_or_null(LAYER_NAMES[layer]) as CanvasLayer
		if (
			canvas == null
			or canvas.layer != int(CANVAS_LAYERS[layer])
			or not canvas.follow_viewport_enabled
			or not is_equal_approx(canvas.follow_viewport_scale, 1.0)
			or canvas.get_meta("mapsoo_world_visual_layer", "") != layer
			or canvas.get_child_count() != 2
		):
			return _failure("Persisted visual placement layer changed: %s." % layer)
		var fixed := canvas.get_node_or_null(FIXED_NAME) as Node2D
		var y_sorted := canvas.get_node_or_null(Y_SORTED_NAME) as Node2D
		if (
			fixed == null
			or y_sorted == null
			or fixed.y_sort_enabled
			or not y_sorted.y_sort_enabled
		):
			return _failure("Persisted placement sorting roots changed: %s." % layer)
		for group: Node2D in [fixed, y_sorted]:
			for child: Node in group.get_children():
				var placement_id := str(
					child.get_meta("mapsoo_world_visual_placement_id", "")
				)
				if placement_id.is_empty() or actual_by_id.has(placement_id):
					return _failure("Persisted placement node identity is invalid.")
				actual_by_id[placement_id] = {
					"node": child,
					"layer": layer,
					"y_sort": group == y_sorted,
				}
	if actual_by_id.size() != resolved.items.size():
		return _failure("Persisted placement node count changed.")
	for item_value: Variant in resolved.items:
		var item: Dictionary = item_value
		var actual: Dictionary = actual_by_id.get(str(item.placement.placement_id), {})
		if actual.is_empty() or not _node_matches(
			actual.node,
			item,
			str(actual.layer),
			bool(actual.y_sort)
		):
			return _failure(
				"Persisted visual placement changed: %s." % str(item.placement.placement_id)
			)
	return {
		"ok": true,
		"status": STATUS,
		"placements": resolved.items.size(),
		"counts": resolved.counts.duplicate(true),
		"error": "",
	}


static func _resolve(
	root: Node,
	placement_plan: Dictionary,
	binding_by_placement: Dictionary,
	asset_by_slot: Dictionary,
	texture_by_task: Dictionary,
	layout_plan: Dictionary,
	allow_applied: bool
) -> Dictionary:
	if (
		root == null
		or typeof(placement_plan) != TYPE_DICTIONARY
		or typeof(binding_by_placement) != TYPE_DICTIONARY
		or typeof(asset_by_slot) != TYPE_DICTIONARY
		or typeof(texture_by_task) != TYPE_DICTIONARY
		or typeof(layout_plan) != TYPE_DICTIONARY
		or placement_plan.get("schema_version") != "1.0.0"
		or placement_plan.get("document_type") != "world-visual-placement-plan"
		or placement_plan.get("status") != "planned"
		or not _matches(
			placement_plan.get("plan_id"),
			"^world-visual-placement-plan-[a-f0-9]{16}$",
			100
		)
		or placement_plan.get("profile") not in PROFILES
		or placement_plan.get("profile") != layout_plan.get("profile")
		or placement_plan.get("profile") != root.get_meta("mapsoo_profile", "")
		or typeof(placement_plan.get("source")) != TYPE_DICTIONARY
		or typeof(placement_plan.get("bounds")) != TYPE_DICTIONARY
		or typeof(placement_plan.get("placements")) != TYPE_ARRAY
	):
		return _failure("Visual placement application input is invalid.")
	var source: Dictionary = placement_plan.source
	var bounds: Dictionary = placement_plan.bounds
	if (
		source.get("layout_plan_id") != layout_plan.get("plan_id")
		or source.get("layout_plan_path") != "world-layout-plan.json"
		or source.get("layout_plan_sha256")
			!= root.get_meta("mapsoo_layout_plan_sha256", "")
		or root.get_meta("mapsoo_layout_plan_id", "") != layout_plan.get("plan_id")
		or root.get_meta("mapsoo_layout_materialization", "") != "profile-layout-v1"
		or root.get_node_or_null(MATERIALIZATION_PATH) == null
		or bounds != layout_plan.get("bounds")
		or bounds.get("unit") != "logical-tile"
		or not _positive_integer(bounds.get("width"))
		or not _positive_integer(bounds.get("height"))
		or (
			not allow_applied
			and (
				root.has_meta("mapsoo_world_visual_status")
				or root.get_node_or_null(
					"%s/%s" % [MATERIALIZATION_PATH, CONTAINER_NAME]
				) != null
			)
		)
	):
		return _failure("Visual placements do not bind the exact materialized layout.")
	var placements: Array = placement_plan.placements
	if (
		placements.is_empty()
		or placements.size() > 2048
		or binding_by_placement.size() != placements.size()
	):
		return _failure("Visual placement inventory size is invalid.")
	var seen := {}
	var used_slots := {}
	var used_tasks := {}
	var items: Array = []
	var receipts: Array = []
	var counts := {
		"sprite": 0,
		"depth-plane": 0,
		"effect": 0,
		"actor": 0,
	}
	var previous_key := ""
	for index: int in placements.size():
		var placement_value: Variant = placements[index]
		if typeof(placement_value) != TYPE_DICTIONARY:
			return _failure("Visual placement %d is invalid." % index)
		var placement: Dictionary = placement_value
		var checked := _validate_placement(placement, bounds)
		if not checked.ok:
			return checked
		var placement_id := str(placement.placement_id)
		var binding_value: Variant = binding_by_placement.get(placement_id)
		if seen.has(placement_id) or typeof(binding_value) != TYPE_DICTIONARY:
			return _failure("Visual placement ids or bindings are invalid.")
		seen[placement_id] = true
		var binding: Dictionary = binding_value
		var item_check := _resolve_binding(
			placement,
			binding,
			asset_by_slot,
			texture_by_task
		)
		if not item_check.ok:
			return item_check
		var anchor := _resolve_anchor(root, placement.anchor, layout_plan)
		if not anchor.ok:
			return anchor
		var key := "%d/%+06d/%s" % [
			int(LAYER_ORDER[placement.render.layer]),
			int(placement.render.order),
			placement_id,
		]
		if index > 0 and previous_key.casecmp_to(key) >= 0:
			return _failure("Visual placements are not in canonical order.")
		previous_key = key
		var y_sort := (
			bool(placement.render.y_sort)
			if placement.kind != "depth-plane"
			else false
		)
		var item := {
			"placement": placement,
			"binding": binding,
			"asset": item_check.asset,
			"texture": item_check.texture,
			"anchor": anchor,
			"y_sort": y_sort,
		}
		used_slots[str(binding.slot_id)] = true
		used_tasks[str(binding.task_id)] = true
		items.append(item)
		receipts.append(_receipt(item))
		counts[str(placement.kind)] = int(counts[str(placement.kind)]) + 1
	for key_value: Variant in binding_by_placement:
		if not seen.has(str(key_value)):
			return _failure("Binding catalog contains an extra placement.")
	if not _dictionary_has_exact_string_keys(asset_by_slot, used_slots):
		return _failure("Asset catalog contains a missing or extra slot.")
	if not _dictionary_has_exact_string_keys(texture_by_task, used_tasks):
		return _failure("Texture catalog contains a missing or extra task.")
	return {
		"ok": true,
		"status": "resolved",
		"items": items,
		"receipts": receipts,
		"counts": counts,
		"error": "",
	}


static func _validate_placement(
	placement: Dictionary,
	bounds: Dictionary
) -> Dictionary:
	if (
		not _safe_id(placement.get("placement_id"), 100)
		or placement.get("kind") not in KINDS
		or not _matches(
			placement.get("role"),
			"^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*)+$",
			120
		)
		or (
			placement.has("variant_id")
			and not _safe_id(placement.get("variant_id"), 100)
		)
		or typeof(placement.get("anchor")) != TYPE_DICTIONARY
		or typeof(placement.get("render")) != TYPE_DICTIONARY
	):
		return _failure("Visual placement identity is invalid.")
	var kind := str(placement.kind)
	var render: Dictionary = placement.render
	var anchor: Dictionary = placement.anchor
	if (
		render.get("layer") not in LAYERS
		or not _integer(render.get("order"), -4096, 4096)
	):
		return _failure("Visual placement render order is invalid.")
	if kind == "depth-plane":
		if (
			render.get("layer") not in ["background", "foreground", "lighting"]
			or typeof(render.get("parallax")) != TYPE_DICTIONARY
			or typeof(render.get("repeat")) != TYPE_DICTIONARY
			or not _ratio(render.parallax.get("x"))
			or not _ratio(render.parallax.get("y"))
			or typeof(render.repeat.get("x")) != TYPE_BOOL
			or typeof(render.repeat.get("y")) != TYPE_BOOL
			or anchor.get("kind") not in ["logical-rect", "region"]
		):
			return _failure("Depth-plane placement semantics are invalid.")
	else:
		if typeof(render.get("y_sort")) != TYPE_BOOL:
			return _failure("Visual placement y-sort policy is invalid.")
		if kind == "actor" and (
			render.get("layer") != "actors"
			or placement.get("controller") not in CONTROLLERS
		):
			return _failure("Actor placement semantics are invalid.")
		if kind == "effect" and (
			render.get("layer") != "effects"
			or placement.get("trigger") not in TRIGGERS
		):
			return _failure("Effect placement semantics are invalid.")
		if kind == "sprite" and render.get("layer") not in [
			"background", "world", "foreground",
		]:
			return _failure("Sprite placement layer is invalid.")
		if (
			kind in ["sprite", "actor"]
			and anchor.get("kind") in ["logical-rect", "region"]
		):
			return _failure("Point placement uses an area anchor.")
	return _validate_anchor_shape(anchor, bounds)


static func _validate_anchor_shape(
	anchor: Dictionary,
	bounds: Dictionary
) -> Dictionary:
	var kind := str(anchor.get("kind", ""))
	if kind == "logical-point":
		if (
			not _exact_keys(anchor, ["kind", "x", "y"])
			or not _integer(anchor.get("x"), 0, int(bounds.width) - 1)
			or not _integer(anchor.get("y"), 0, int(bounds.height) - 1)
		):
			return _failure("Logical point anchor is invalid.")
	elif kind == "logical-rect":
		if (
			not _exact_keys(anchor, ["kind", "x", "y", "width", "height"])
			or not _integer(anchor.get("x"), 0, int(bounds.width) - 1)
			or not _integer(anchor.get("y"), 0, int(bounds.height) - 1)
			or not _integer(anchor.get("width"), 1, int(bounds.width))
			or not _integer(anchor.get("height"), 1, int(bounds.height))
			or int(anchor.x) + int(anchor.width) > int(bounds.width)
			or int(anchor.y) + int(anchor.height) > int(bounds.height)
		):
			return _failure("Logical rectangle anchor is invalid.")
	elif kind in ["landmark", "traversal", "region"]:
		if (
			not _exact_keys(anchor, ["kind", "ref_id"])
			or not _safe_id(anchor.get("ref_id"), 100)
		):
			return _failure("Referenced visual anchor is invalid.")
	elif kind in ["spawn", "exit"]:
		if not _exact_keys(anchor, ["kind"]):
			return _failure("Endpoint visual anchor is invalid.")
	else:
		return _failure("Visual anchor kind is invalid.")
	return {"ok": true, "status": "validated", "error": ""}


static func _resolve_binding(
	placement: Dictionary,
	binding: Dictionary,
	asset_by_slot: Dictionary,
	texture_by_task: Dictionary
) -> Dictionary:
	for field: String in BINDING_FIELDS:
		if not binding.has(field):
			return _failure("Placement binding is incomplete.")
	var slot_id := str(binding.get("slot_id", ""))
	var task_id := str(binding.get("task_id", ""))
	var asset_value: Variant = asset_by_slot.get(slot_id)
	var texture_value: Variant = texture_by_task.get(task_id)
	if (
		not _safe_id(slot_id, 160)
		or not _safe_id(task_id, 160)
		or typeof(asset_value) != TYPE_DICTIONARY
		or not texture_value is Texture2D
		or binding.get("role") != placement.get("role")
		or (
			placement.has("variant_id")
			and binding.get("variant_id") != placement.get("variant_id")
		)
	):
		return _failure("Placement binding does not match its plan.")
	var asset: Dictionary = asset_value
	for field: String in BINDING_FIELDS:
		if asset.get(field) != binding.get(field):
			return _failure("Placement binding differs from its catalog asset.")
	var region_value: Variant = binding.get("region")
	if typeof(region_value) != TYPE_DICTIONARY:
		return _failure("Placement texture region is invalid.")
	var region: Dictionary = region_value
	var texture: Texture2D = texture_value
	if (
		not _exact_keys(region, ["x", "y", "width", "height"])
		or not _integer(region.get("x"), 0, 131071)
		or not _integer(region.get("y"), 0, 131071)
		or not _integer(region.get("width"), 1, 8192)
		or not _integer(region.get("height"), 1, 8192)
		or int(region.x) + int(region.width) > texture.get_width()
		or int(region.y) + int(region.height) > texture.get_height()
		or not _sha256(binding.get("cell_sha256"))
		or _texture_cell_sha(texture, region) != binding.get("cell_sha256")
	):
		return _failure("Placement texture or reviewed cell digest is invalid.")
	return {
		"ok": true,
		"status": "resolved",
		"asset": asset,
		"texture": texture,
		"error": "",
	}


static func _resolve_anchor(
	root: Node,
	anchor: Dictionary,
	layout_plan: Dictionary
) -> Dictionary:
	var kind := str(anchor.kind)
	if kind == "spawn" or kind == "exit":
		var key := (
			"mapsoo_layout_spawn_world"
			if kind == "spawn"
			else "mapsoo_layout_exit_world"
		)
		var value: Variant = root.get_meta(key, null)
		if not value is Vector2:
			return _failure("Materialized endpoint anchor is missing.")
		var point: Vector2 = value
		return _anchor_result(
			point,
			Rect2(point - Vector2.ONE * 0.5, Vector2.ONE)
		)
	if kind == "landmark":
		var marker := _find_meta_marker(
			root.get_node_or_null("%s/Landmarks" % MATERIALIZATION_PATH),
			"mapsoo_landmark_id",
			str(anchor.ref_id)
		)
		if marker == null:
			return _failure("Materialized landmark anchor is missing.")
		return _anchor_result(marker.global_position, Rect2(
			marker.global_position - Vector2.ONE * 0.5,
			Vector2.ONE
		))
	if kind == "traversal":
		var marker := _find_meta_marker(
			root.get_node_or_null("%s/Traversal" % MATERIALIZATION_PATH),
			"mapsoo_node_id",
			str(anchor.ref_id)
		)
		if marker == null:
			return _failure("Materialized traversal anchor is missing.")
		return _anchor_result(marker.global_position, Rect2(
			marker.global_position - Vector2.ONE * 0.5,
			Vector2.ONE
		))
	var logical_rect: Dictionary
	if kind == "logical-point":
		logical_rect = {
			"x": int(anchor.x), "y": int(anchor.y), "width": 1, "height": 1,
		}
	elif kind == "logical-rect":
		logical_rect = {
			"x": int(anchor.x), "y": int(anchor.y),
			"width": int(anchor.width), "height": int(anchor.height),
		}
	elif kind == "region":
		logical_rect = _layout_item_by_id(
			layout_plan.get("regions", []),
			str(anchor.ref_id)
		)
		if logical_rect.is_empty():
			return _failure("Referenced layout region is missing.")
	else:
		return _failure("Visual anchor cannot be resolved.")
	var pixel_bounds_value: Variant = root.get_meta("mapsoo_layout_pixel_bounds", null)
	if not pixel_bounds_value is Rect2:
		return _failure("Materialized pixel bounds are missing.")
	var polygon := LayoutMaterializer.logical_rectangle_to_world_polygon(
		str(layout_plan.profile),
		logical_rect,
		layout_plan.bounds,
		pixel_bounds_value
	)
	if polygon.size() != 4:
		return _failure("Visual anchor projection failed.")
	var projected := _polygon_bounds(polygon)
	return _anchor_result(projected.get_center(), projected)


static func _build_node(item: Dictionary) -> Dictionary:
	var placement: Dictionary = item.placement
	var binding: Dictionary = item.binding
	var anchor: Dictionary = item.anchor
	var atlas := _atlas_texture(item.texture, binding.region)
	if atlas == null:
		return _failure("Placement atlas could not be built.")
	var node: Node2D
	var visual: Sprite2D
	if placement.kind == "actor":
		var actor := CharacterBody2D.new()
		node = actor
		visual = _sprite(atlas)
		visual.name = "Visual"
		actor.add_child(visual)
	elif placement.kind == "depth-plane":
		var plane := Parallax2D.new()
		node = plane
		visual = _sprite(atlas)
		visual.name = "Visual"
		plane.add_child(visual)
		# Parallax2D owns its transform while running. A semantic placement
		# offset belongs in scroll_offset so it persists and survives cameras.
		plane.scroll_offset = anchor.position
		plane.scroll_scale = Vector2(
			float(placement.render.parallax.x),
			float(placement.render.parallax.y)
		)
		plane.repeat_size = Vector2(
			anchor.rect.size.x if bool(placement.render.repeat.x) else 0.0,
			anchor.rect.size.y if bool(placement.render.repeat.y) else 0.0
		)
	else:
		visual = _sprite(atlas)
		node = visual
	node.name = _node_name(str(placement.placement_id))
	node.position = (
		Vector2.ZERO
		if placement.kind == "depth-plane"
		else anchor.position
	)
	node.z_index = int(placement.render.order)
	if _placement_fills_anchor(placement):
		visual.scale = Vector2(
			anchor.rect.size.x / float(binding.region.width),
			anchor.rect.size.y / float(binding.region.height)
		)
	node.set_meta("mapsoo_world_visual_placement_id", str(placement.placement_id))
	node.set_meta("mapsoo_world_visual_kind", str(placement.kind))
	node.set_meta("mapsoo_role", str(placement.role))
	node.set_meta("mapsoo_variant_id", str(binding.variant_id))
	node.set_meta("mapsoo_slot_id", str(binding.slot_id))
	node.set_meta("mapsoo_task_id", str(binding.task_id))
	node.set_meta("mapsoo_cell_sha256", str(binding.cell_sha256))
	node.set_meta("mapsoo_texture_region", (binding.region as Dictionary).duplicate(true))
	node.set_meta("mapsoo_logical_anchor", (placement.anchor as Dictionary).duplicate(true))
	node.set_meta("mapsoo_render_layer", str(placement.render.layer))
	node.set_meta("mapsoo_render_order", int(placement.render.order))
	node.set_meta("mapsoo_y_sort", bool(item.y_sort))
	if placement.kind == "actor":
		node.set_meta("mapsoo_actor_controller", str(placement.controller))
	elif placement.kind == "effect":
		node.set_meta("mapsoo_effect_trigger", str(placement.trigger))
		node.set_meta("mapsoo_effect_status", "applied")
	elif placement.kind == "depth-plane":
		node.set_meta(
			"mapsoo_parallax",
			(placement.render.parallax as Dictionary).duplicate(true)
		)
		node.set_meta(
			"mapsoo_repeat",
			(placement.render.repeat as Dictionary).duplicate(true)
		)
	visual.set_meta("mapsoo_role", str(placement.role))
	visual.set_meta("mapsoo_world_visual_placement_id", str(placement.placement_id))
	return {"ok": true, "status": "built", "node": node, "error": ""}


static func _node_matches(
	node: Node,
	item: Dictionary,
	layer: String,
	y_sort: bool
) -> bool:
	var placement: Dictionary = item.placement
	var binding: Dictionary = item.binding
	var anchor: Dictionary = item.anchor
	if (
		not node is Node2D
		or layer != placement.render.layer
		or y_sort != bool(item.y_sort)
		or node.get_meta("mapsoo_world_visual_kind", "") != placement.kind
		or node.get_meta("mapsoo_role", "") != placement.role
		or node.get_meta("mapsoo_variant_id", "") != binding.variant_id
		or node.get_meta("mapsoo_slot_id", "") != binding.slot_id
		or node.get_meta("mapsoo_task_id", "") != binding.task_id
		or node.get_meta("mapsoo_cell_sha256", "") != binding.cell_sha256
		or node.get_meta("mapsoo_texture_region", {}) != binding.region
		or node.get_meta("mapsoo_logical_anchor", {}) != placement.anchor
		or node.get_meta("mapsoo_render_layer", "") != placement.render.layer
		or node.get_meta("mapsoo_render_order", 999999) != placement.render.order
		or node.get_meta("mapsoo_y_sort", null) != bool(item.y_sort)
		or not (node as Node2D).position.is_equal_approx(
			Vector2.ZERO
			if placement.kind == "depth-plane"
			else anchor.position
		)
		or (node as Node2D).z_index != int(placement.render.order)
	):
		return false
	var visual: Sprite2D
	if placement.kind == "actor":
		if (
			not node is CharacterBody2D
			or node.get_meta("mapsoo_actor_controller", "") != placement.controller
			or node.get_child_count() != 1
		):
			return false
		visual = node.get_node_or_null("Visual") as Sprite2D
	elif placement.kind == "depth-plane":
		if (
			not node is Parallax2D
			or node.get_child_count() != 1
			or node.get_meta("mapsoo_parallax", {}) != placement.render.parallax
			or node.get_meta("mapsoo_repeat", {}) != placement.render.repeat
			or not (node as Parallax2D).scroll_offset.is_equal_approx(
				anchor.position
			)
			or not (node as Parallax2D).scroll_scale.is_equal_approx(Vector2(
				float(placement.render.parallax.x),
				float(placement.render.parallax.y)
			))
			or not (node as Parallax2D).repeat_size.is_equal_approx(Vector2(
				anchor.rect.size.x if bool(placement.render.repeat.x) else 0.0,
				anchor.rect.size.y if bool(placement.render.repeat.y) else 0.0
			))
		):
			return false
		visual = node.get_node_or_null("Visual") as Sprite2D
	else:
		if not node is Sprite2D or node.get_child_count() != 0:
			return false
		visual = node as Sprite2D
		if placement.kind == "effect" and (
			node.get_meta("mapsoo_effect_trigger", "") != placement.trigger
			or node.get_meta("mapsoo_effect_status", "") != "applied"
		):
			return false
	if visual == null or not _visual_matches(visual, item):
		return false
	return true


static func _visual_matches(visual: Sprite2D, item: Dictionary) -> bool:
	var binding: Dictionary = item.binding
	var placement: Dictionary = item.placement
	var anchor: Dictionary = item.anchor
	var atlas := visual.texture as AtlasTexture
	if (
		atlas == null
		or atlas.region != Rect2(
			float(binding.region.x), float(binding.region.y),
			float(binding.region.width), float(binding.region.height)
		)
		or atlas.atlas == null
		or _texture_cell_sha(atlas.atlas, binding.region) != binding.cell_sha256
		or visual.get_meta("mapsoo_role", "") != placement.role
		or visual.get_meta("mapsoo_world_visual_placement_id", "")
			!= placement.placement_id
	):
		return false
	var expected_scale := Vector2.ONE
	if _placement_fills_anchor(placement):
		expected_scale = Vector2(
			anchor.rect.size.x / float(binding.region.width),
			anchor.rect.size.y / float(binding.region.height)
		)
	return visual.scale.is_equal_approx(expected_scale)


static func _receipt(item: Dictionary) -> Dictionary:
	var placement: Dictionary = item.placement
	var binding: Dictionary = item.binding
	var result := {
		"placement_id": str(placement.placement_id),
		"kind": str(placement.kind),
		"role": str(placement.role),
		"variant_id": str(binding.variant_id),
		"slot_id": str(binding.slot_id),
		"task_id": str(binding.task_id),
		"cell_sha256": str(binding.cell_sha256),
		"region": (binding.region as Dictionary).duplicate(true),
		"anchor": (placement.anchor as Dictionary).duplicate(true),
		"layer": str(placement.render.layer),
		"order": int(placement.render.order),
		"y_sort": bool(item.y_sort),
	}
	if placement.kind == "actor":
		result["controller"] = str(placement.controller)
	elif placement.kind == "effect":
		result["trigger"] = str(placement.trigger)
	elif placement.kind == "depth-plane":
		result["parallax"] = (placement.render.parallax as Dictionary).duplicate(true)
		result["repeat"] = (placement.render.repeat as Dictionary).duplicate(true)
	return result


static func _atlas_texture(
	source: Texture2D,
	region: Dictionary
) -> AtlasTexture:
	if source == null:
		return null
	var atlas := AtlasTexture.new()
	atlas.atlas = source
	atlas.region = Rect2(
		float(region.x), float(region.y),
		float(region.width), float(region.height)
	)
	atlas.filter_clip = true
	return atlas


static func _sprite(texture: Texture2D) -> Sprite2D:
	var sprite := Sprite2D.new()
	sprite.texture = texture
	sprite.centered = true
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	return sprite


static func _texture_cell_sha(
	texture: Texture2D,
	region: Dictionary
) -> String:
	if texture == null:
		return ""
	var image := texture.get_image()
	if image == null or image.is_empty():
		return ""
	var rect := Rect2i(
		int(region.get("x", -1)),
		int(region.get("y", -1)),
		int(region.get("width", 0)),
		int(region.get("height", 0))
	)
	if (
		rect.position.x < 0
		or rect.position.y < 0
		or rect.size.x < 1
		or rect.size.y < 1
		or rect.end.x > image.get_width()
		or rect.end.y > image.get_height()
	):
		return ""
	return _sha256_bytes(image.get_region(rect).get_data())


static func _find_meta_marker(
	root: Node,
	key: String,
	value: String
) -> Marker2D:
	if root == null:
		return null
	for child: Node in root.get_children():
		if child is Marker2D and child.get_meta(key, "") == value:
			return child
	return null


static func _layout_item_by_id(values: Variant, id: String) -> Dictionary:
	if typeof(values) != TYPE_ARRAY:
		return {}
	for value: Variant in values:
		if typeof(value) == TYPE_DICTIONARY and value.get("id") == id:
			return (value as Dictionary).duplicate(true)
	return {}


static func _polygon_bounds(polygon: PackedVector2Array) -> Rect2:
	if polygon.is_empty():
		return Rect2()
	var minimum := polygon[0]
	var maximum := polygon[0]
	for point: Vector2 in polygon:
		minimum = minimum.min(point)
		maximum = maximum.max(point)
	return Rect2(minimum, maximum - minimum)


static func _anchor_result(position: Vector2, rect: Rect2) -> Dictionary:
	return {
		"ok": true,
		"status": "resolved",
		"position": position,
		"rect": rect,
		"error": "",
	}


static func _node_name(placement_id: String) -> String:
	return "Placement_%s" % placement_id.replace("-", "_").to_pascal_case()


static func _set_owner_recursive(node: Node, owner: Node) -> void:
	node.owner = owner
	for child: Node in node.get_children():
		_set_owner_recursive(child, owner)


static func _positive_integer(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] \
		and is_finite(float(value)) \
		and float(value) == floor(float(value)) \
		and int(value) > 0


static func _integer(value: Variant, minimum: int, maximum: int) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] \
		and is_finite(float(value)) \
		and float(value) == floor(float(value)) \
		and int(value) >= minimum \
		and int(value) <= maximum


static func _ratio(value: Variant) -> bool:
	return typeof(value) in [TYPE_INT, TYPE_FLOAT] \
		and is_finite(float(value)) \
		and float(value) >= 0.0 \
		and float(value) <= 4.0


static func _safe_id(value: Variant, maximum: int) -> bool:
	return _matches(value, "^[a-z0-9]+(?:-[a-z0-9]+)*$", maximum)


static func _sha256(value: Variant) -> bool:
	return _matches(value, "^[a-f0-9]{64}$", 64)


static func _matches(value: Variant, pattern: String, maximum: int) -> bool:
	if typeof(value) != TYPE_STRING or str(value).is_empty() or str(value).length() > maximum:
		return false
	var regex := RegEx.new()
	return regex.compile(pattern) == OK and regex.search(str(value)) != null


static func _exact_keys(value: Dictionary, expected: Array) -> bool:
	var actual: Array = value.keys()
	actual.sort()
	var canonical := expected.duplicate()
	canonical.sort()
	return actual == canonical


static func _dictionary_has_exact_string_keys(
	value: Dictionary,
	expected: Dictionary
) -> bool:
	if value.size() != expected.size():
		return false
	for key: Variant in value:
		if typeof(key) != TYPE_STRING or not expected.has(str(key)):
			return false
	return true


static func _placement_fills_anchor(placement: Dictionary) -> bool:
	return (
		placement.get("kind") == "depth-plane"
		or (placement.get("anchor") as Dictionary).get("kind")
			in ["logical-rect", "region"]
	)


static func _sha256_bytes(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()


static func _failure(message: String) -> Dictionary:
	return {"ok": false, "status": "failed", "error": message}
