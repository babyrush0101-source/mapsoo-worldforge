extends "res://tests/capture_world_art_runtime_overlay.gd"

## Consumer-neutral WorldArtRuntimeOverlay 1.1 evidence capture.
##
## Expected runtime binding keys are derived from the reviewed projection and
## placement sidecars. Applied keys are independently reconstructed from the
## materialized scene's receipts and node metadata before the image is saved.

const RuntimeOverlayV11 = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay_v1_1.gd"
)


func _run() -> void:
	var layout_path := _argument_value("--layout=")
	var overlay_path := _argument_value("--overlay-manifest=")
	var output_path := _argument_value("--output=")
	var evidence_mode := _argument_value("--evidence-mode=")
	if evidence_mode.is_empty():
		evidence_mode = "normal"
	if (
		layout_path.is_empty()
		or overlay_path.is_empty()
		or output_path.is_empty()
		or evidence_mode not in EVIDENCE_MODES
	):
		_fail(
			"Pass --layout, --overlay-manifest, --output and a supported " +
			"--evidence-mode."
		)
		return
	if layout_path.replace("\\", "/").get_file() != LAYOUT_FILENAME:
		_fail("Layout input must be canonical %s." % LAYOUT_FILENAME)
		return
	if output_path.get_extension().to_lower() != "png":
		_fail("Capture output must be a PNG path.")
		return

	var layout_read := _load_json_document(layout_path, MAX_LAYOUT_BYTES)
	if not layout_read.ok:
		_fail(str(layout_read.error))
		return
	var plan: Dictionary = layout_read.value
	if (
		plan.get("schema_version") != "1.0.0"
		or plan.get("document_type") != "world-layout-plan"
		or plan.get("status") != "planned"
	):
		_fail("Layout input is not canonical WorldLayoutPlan 1.0.")
		return
	var layout_sha256 := _sha256_bytes(layout_read.bytes)
	var authorization := {}
	var grant_path := _argument_value("--overlay-grant=")
	if not grant_path.is_empty():
		var grant_read := _load_json_document(grant_path, 64 * 1024)
		if not grant_read.ok:
			_fail(str(grant_read.error))
			return
		authorization = grant_read.value
	var loaded := RuntimeOverlayV11.load_extracted(
		overlay_path,
		layout_sha256,
		authorization
	)
	if not loaded.ok:
		_fail("Runtime overlay 1.1 load failed: %s" % str(loaded.error))
		return
	var overlay: Dictionary = loaded.overlay
	if overlay.manifest.get("profile") != plan.get("profile"):
		_fail("Runtime overlay 1.1 profile differs from the layout.")
		return

	var expected := _expected_inventory(overlay)
	if not expected.ok:
		_fail("Expected binding inventory is invalid: %s" % expected.error)
		return
	var viewport_size := root.get_visible_rect().size
	if viewport_size.x < 64.0 or viewport_size.y < 64.0:
		_fail("Capture viewport is too small.")
		return
	var world := _create_world(str(plan.profile), viewport_size)
	var attachment := {
		"plan": plan,
		"sha256": layout_sha256,
		"manifest_sha256": layout_sha256,
	}
	var layout_bound := LayoutAttachment.bind_scene(world, attachment)
	if not layout_bound.ok:
		_fail("WorldLayout materialization failed: %s" % str(layout_bound.error))
		return
	var baseline_overlay := {
		"projection": overlay.projection,
		"textures": overlay.texture_by_path,
	}
	var baseline := _apply_baseline_palette(
		world,
		plan,
		layout_sha256,
		baseline_overlay
	)
	if not baseline.ok:
		_fail("Runtime overlay palette preparation failed: %s" % str(baseline.error))
		return
	var overlay_bound := RuntimeOverlayV11.bind_scene(world, overlay, plan)
	if not overlay_bound.ok:
		_fail("Runtime overlay 1.1 scene binding failed: %s" % overlay_bound.error)
		return
	var visual_applied := RuntimeOverlayApplier.apply(world)
	if not visual_applied.ok:
		_fail("Runtime overlay visual application failed: %s" % visual_applied.error)
		return
	var hazard_result := RuntimeHazardApplier.apply(world)
	if not hazard_result.ok:
		_fail("Runtime overlay hazard application failed: %s" % hazard_result.error)
		return
	var character_result := RuntimeCharacterApplier.apply(world)
	if not character_result.ok:
		_fail("Runtime overlay character application failed: %s" % character_result.error)
		return
	for validation: Dictionary in [
		RuntimeOverlayV11.validate_bound_scene(world, overlay, plan),
		RuntimeOverlayApplier.validate_scene(world),
		RuntimeHazardApplier.validate_scene(world),
		RuntimeCharacterApplier.validate_scene(world),
	]:
		if not validation.ok:
			_fail("Applied runtime overlay 1.1 postcondition failed: %s" % validation)
			return

	var applied := _applied_inventory(world)
	if not applied.ok:
		_fail("Applied binding inventory is invalid: %s" % applied.error)
		return
	if _argument_value("--evidence-test-tamper=") == "same-count-key":
		var tampered: Dictionary = applied.duplicate(true)
		var tampered_keys: Array = (applied.keys as Array).duplicate(true)
		var first: Dictionary = (tampered_keys[0] as Dictionary).duplicate(true)
		first.usage_id = "__same_count_key_tamper__"
		tampered_keys[0] = first
		_sort_usage_keys(tampered_keys)
		tampered.keys = tampered_keys
		tampered.bindings_sha256 = _binding_digest(tampered_keys)
		if not _inventory_matches(expected, tampered):
			_fail("Applied binding key inventory differs from the reviewed sidecars.")
			return
	if not _inventory_matches(expected, applied):
		_fail(
			"Applied binding inventory differs from the reviewed sidecars: " +
			"expected=%s applied=%s." % [
				expected.bindings_sha256,
				applied.bindings_sha256,
			]
		)
		return

	root.add_child(world)
	var route := _route(world, plan)
	if not route.ok:
		_fail("Authored spawn-to-exit route is invalid: %s" % str(route.error))
		return
	if evidence_mode == "navigation":
		_add_traversal_review_view(world, plan)
	if evidence_mode in ["role-overlay", "collision-overlay", "navigation"]:
		var review := ProductionReviewOverlay.new()
		review.name = "ProductionReviewOverlay"
		world.add_child(review)
		review.configure(evidence_mode, world)

	for _frame in 3:
		await process_frame
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
	var rendered := root.get_texture().get_image()
	if rendered == null or rendered.is_empty():
		_fail("Godot viewport did not produce a rendered image.")
		return
	var output_absolute := ProjectSettings.globalize_path(output_path)
	if (
		DirAccess.make_dir_recursive_absolute(output_absolute.get_base_dir()) != OK
		or rendered.save_png(output_absolute) != OK
	):
		_fail("Unable to save rendered PNG evidence.")
		return
	var render_sha256 := FileAccess.get_sha256(output_absolute)
	if render_sha256.is_empty():
		_fail("Rendered PNG digest is unavailable.")
		return

	if evidence_mode in ["spawn-exit", "navigation"]:
		var traversed := await _animate_route(world, route.positions)
		if not traversed:
			_fail("Player could not traverse the authored spawn-to-exit route.")
			return
	var player := world.find_child("Player", true, false) as CharacterBody2D
	var player_visual: AnimatedSprite2D = null
	if player != null:
		player_visual = player.get_node_or_null("Visual") as AnimatedSprite2D
	var animation := (
		str(player_visual.animation)
		if player_visual != null and not str(player_visual.animation).is_empty()
		else "none"
	)
	print((
		"WORLD_ART_RUNTIME_OVERLAY_V1_1_CAPTURE_OK " +
		"profile=%s mode=%s layout_sha256=%s overlay_id=%s " +
		"projection_id=%s placement_plan_id=%s placement_map_id=%s " +
		"render_sha256=%s route_nodes=%d terrain=%d landmarks=%d " +
		"hazards=%d characters=%d backgrounds=%d props=%d structures=%d " +
		"effects=%d depth_planes=%d catalog_assets=%d " +
		"bound_catalog_assets=%d runtime_bindings=%d " +
		"applied_runtime_bindings=%d bindings_sha256=%s " +
		"applied_bindings_sha256=%s animation=%s output=%s"
	) % [
		str(plan.profile),
		evidence_mode,
		layout_sha256,
		str(overlay.manifest.overlay_id),
		str(overlay.projection.projection_id),
		str(overlay.placement_plan.plan_id),
		str(overlay.placement_map.map_id),
		render_sha256,
		(route.ids as Array).size(),
		int(applied.terrain),
		int(applied.landmarks),
		int(applied.hazards),
		int(applied.characters),
		int(applied.backgrounds),
		int(applied.props),
		int(applied.structures),
		int(applied.effects),
		int(applied.depth_planes),
		int(applied.catalog_assets),
		int(applied.bound_catalog_assets),
		(expected.keys as Array).size(),
		(applied.keys as Array).size(),
		str(expected.bindings_sha256),
		str(applied.bindings_sha256),
		animation,
		output_absolute,
	])
	quit(0)


func _expected_inventory(overlay: Dictionary) -> Dictionary:
	var projection: Dictionary = overlay.projection
	var placement_plan: Dictionary = overlay.placement_plan
	var placement_map: Dictionary = overlay.placement_map
	var catalog := {}
	for value: Variant in projection.get("assets", []):
		var asset: Dictionary = value
		catalog[_asset_key(asset)] = true
	var bound_catalog := {}
	var keys: Array = []
	for value: Variant in projection.get("bindings", []):
		var binding: Dictionary = value
		var catalog_key := _asset_key(binding)
		if not catalog.has(catalog_key):
			return {"ok": false, "error": "Projection binding is absent from catalog."}
		bound_catalog[catalog_key] = true
		keys.append(_usage_key(str(binding.usage_kind), str(binding.usage_id)))
	var placements: Array = placement_plan.get("placements", [])
	var bindings: Array = placement_map.get("bindings", [])
	if placements.size() != bindings.size():
		return {"ok": false, "error": "Placement plan/map lengths differ."}
	for index: int in placements.size():
		var placement: Dictionary = placements[index]
		var binding: Dictionary = bindings[index]
		if (
			binding.get("placement_id") != placement.get("placement_id")
			or binding.get("role") != placement.get("role")
			or binding.get("variant_id")
				!= placement.get("variant_id", "canonical")
		):
			return {"ok": false, "error": "Placement map order differs from plan."}
		var catalog_key := _asset_key(binding)
		if not catalog.has(catalog_key):
			return {"ok": false, "error": "Placement binding is absent from catalog."}
		bound_catalog[catalog_key] = true
		keys.append(_usage_key(
			_placement_usage_kind(placement),
			str(placement.placement_id)
		))
	_sort_usage_keys(keys)
	if not _unique_usage_keys(keys):
		return {"ok": false, "error": "Expected runtime usage keys are not unique."}
	var counts := _placement_counts_from_keys(keys)
	return {
		"ok": true,
		"keys": keys,
		"bindings_sha256": _binding_digest(keys),
		"catalog_assets": catalog.size(),
		"bound_catalog_assets": bound_catalog.size(),
		"terrain": _count_kind(keys, "terrain-material"),
		"landmarks": _count_kind(keys, "landmark"),
		"hazards": (projection.get("hazards", []) as Array).size()
			+ _moving_platform_count(placements),
		"characters": _count_kind(keys, "character"),
		"backgrounds": counts.backgrounds,
		"props": counts.props,
		"structures": counts.structures,
		"effects": counts.effects,
		"depth_planes": counts.depth_planes,
		"error": "",
	}


func _applied_inventory(world: Node) -> Dictionary:
	var catalog := world.get_node_or_null("WorldArtRuntimeOverlay")
	var terrain := world.get_node_or_null(
		"MapsooLayoutMaterialization/Terrain/LogicalCells"
	)
	var landmarks := world.get_node_or_null(
		"MapsooLayoutMaterialization/Landmarks"
	)
	var hazards := world.get_node_or_null(
		"MapsooLayoutMaterialization/Hazards"
	)
	var placements := world.get_node_or_null(
		"MapsooLayoutMaterialization/WorldVisualPlacements"
	)
	if (
		catalog == null
		or terrain == null
		or landmarks == null
		or hazards == null
		or placements == null
	):
		return {"ok": false, "error": "Applied runtime scene containers are missing."}
	var catalog_assets: Array = catalog.get_meta("mapsoo_assets", [])
	var catalog_bindings: Array = catalog.get_meta("mapsoo_bindings", [])
	var binding_by_usage := {}
	for value: Variant in catalog_bindings:
		var binding: Dictionary = value
		var usage := _usage_key(
			str(binding.get("usage_kind", "")),
			str(binding.get("usage_id", ""))
		)
		binding_by_usage[_usage_key_string(usage)] = binding
	var keys_by_string := {}
	var bound_catalog := {}
	var material_receipts: Dictionary = terrain.get_meta(
		"mapsoo_world_art_material_bindings",
		{}
	)
	for value: Variant in material_receipts:
		var usage := _usage_key("terrain-material", str(value))
		var added := _add_applied_catalog_usage(
			usage,
			binding_by_usage,
			keys_by_string,
			bound_catalog
		)
		if not added.ok:
			return added
	var landmark_receipts: Dictionary = landmarks.get_meta(
		"mapsoo_world_art_landmark_bindings",
		{}
	)
	for value: Variant in landmark_receipts:
		var usage := _usage_key("landmark", str(value))
		var added := _add_applied_catalog_usage(
			usage,
			binding_by_usage,
			keys_by_string,
			bound_catalog
		)
		if not added.ok:
			return added
	var hazard_usage_ids := {}
	_collect_meta_values(hazards, "mapsoo_usage_id", hazard_usage_ids)
	for value: Variant in hazard_usage_ids:
		var usage := _usage_key("hazard", str(value))
		var added := _add_applied_catalog_usage(
			usage,
			binding_by_usage,
			keys_by_string,
			bound_catalog
		)
		if not added.ok:
			return added
	var character_usage_id := str(
		world.get_meta("mapsoo_world_art_character_usage_id", "")
	)
	if character_usage_id.is_empty():
		return {"ok": false, "error": "Applied projected character receipt is missing."}
	var character_added := _add_applied_catalog_usage(
		_usage_key("character", character_usage_id),
		binding_by_usage,
		keys_by_string,
		bound_catalog
	)
	if not character_added.ok:
		return character_added

	var placement_nodes: Array[Node] = []
	_collect_placement_nodes(placements, placement_nodes)
	for node: Node in placement_nodes:
		var placement := {
			"kind": str(node.get_meta("mapsoo_world_visual_kind", "")),
			"role": str(node.get_meta("mapsoo_role", "")),
			"controller": str(node.get_meta("mapsoo_actor_controller", "")),
		}
		var usage := _usage_key(
			_placement_usage_kind(placement),
			str(node.get_meta("mapsoo_world_visual_placement_id", ""))
		)
		var usage_string := _usage_key_string(usage)
		if keys_by_string.has(usage_string):
			return {"ok": false, "error": "Applied runtime usage key is duplicated."}
		keys_by_string[usage_string] = usage
		var task_id := str(node.get_meta("mapsoo_task_id", ""))
		var slot_id := str(node.get_meta("mapsoo_slot_id", ""))
		if task_id.is_empty() or slot_id.is_empty():
			return {"ok": false, "error": "Applied placement asset receipt is incomplete."}
		bound_catalog[_pair_key(task_id, slot_id)] = true
	var keys: Array = keys_by_string.values()
	_sort_usage_keys(keys)
	if not _unique_usage_keys(keys):
		return {"ok": false, "error": "Applied runtime usage keys are not unique."}
	var counts := _placement_counts_from_keys(keys)
	var hazard_inventory: Array = hazards.get_meta(
		"mapsoo_world_art_hazard_inventory",
		[]
	)
	return {
		"ok": true,
		"keys": keys,
		"bindings_sha256": _binding_digest(keys),
		"catalog_assets": catalog_assets.size(),
		"bound_catalog_assets": bound_catalog.size(),
		"terrain": material_receipts.size(),
		"landmarks": landmark_receipts.size(),
		"hazards": hazard_inventory.size()
			+ _count_moving_platform_nodes(placement_nodes),
		"characters": _count_kind(keys, "character"),
		"backgrounds": counts.backgrounds,
		"props": counts.props,
		"structures": counts.structures,
		"effects": counts.effects,
		"depth_planes": counts.depth_planes,
		"error": "",
	}


func _add_applied_catalog_usage(
	usage: Dictionary,
	binding_by_usage: Dictionary,
	keys_by_string: Dictionary,
	bound_catalog: Dictionary
) -> Dictionary:
	var usage_string := _usage_key_string(usage)
	if keys_by_string.has(usage_string):
		return {"ok": false, "error": "Applied runtime usage key is duplicated."}
	var binding: Dictionary = binding_by_usage.get(usage_string, {})
	if binding.is_empty():
		return {
			"ok": false,
			"error": "Applied usage has no bound catalog asset: %s." % usage_string,
		}
	keys_by_string[usage_string] = usage
	bound_catalog[_asset_key(binding)] = true
	return {"ok": true, "error": ""}


func _inventory_matches(expected: Dictionary, applied: Dictionary) -> bool:
	for field: String in [
		"catalog_assets",
		"bound_catalog_assets",
		"terrain",
		"landmarks",
		"hazards",
		"characters",
		"backgrounds",
		"props",
		"structures",
		"effects",
		"depth_planes",
	]:
		if expected.get(field) != applied.get(field):
			return false
	return (
		expected.get("keys") == applied.get("keys")
		and expected.get("bindings_sha256") == applied.get("bindings_sha256")
	)


func _placement_usage_kind(placement: Dictionary) -> String:
	var kind := str(placement.get("kind", ""))
	var role := str(placement.get("role", ""))
	if kind == "depth-plane":
		return "background" if role.begins_with("background.") else "depth"
	if kind == "sprite":
		return "structure" if role.begins_with("structure.") else "prop"
	if kind == "effect":
		return "effect"
	return (
		"hazard"
		if str(placement.get("controller", "")) == "moving-platform"
		else "character"
	)


func _usage_key(usage_kind: String, usage_id: String) -> Dictionary:
	return {"usage_kind": usage_kind, "usage_id": usage_id}


func _usage_key_string(key: Dictionary) -> String:
	return _pair_key(str(key.usage_kind), str(key.usage_id))


func _asset_key(value: Dictionary) -> String:
	return _pair_key(
		str(value.get("task_id", "")),
		str(value.get("slot_id", ""))
	)


func _pair_key(left: String, right: String) -> String:
	return RuntimeOverlayV11._canonical_json([left, right])


func _sort_usage_keys(keys: Array) -> void:
	keys.sort_custom(func(left: Dictionary, right: Dictionary) -> bool:
		var left_kind := str(left.usage_kind)
		var right_kind := str(right.usage_kind)
		if left_kind != right_kind:
			return left_kind < right_kind
		return str(left.usage_id) < str(right.usage_id)
	)


func _unique_usage_keys(keys: Array) -> bool:
	var unique := {}
	for value: Variant in keys:
		var key: Dictionary = value
		unique[_usage_key_string(key)] = true
	return unique.size() == keys.size()


func _binding_digest(keys: Array) -> String:
	return RuntimeOverlayV11._canonical_json(keys).sha256_text()


func _count_kind(keys: Array, usage_kind: String) -> int:
	var count := 0
	for value: Variant in keys:
		if (value as Dictionary).get("usage_kind") == usage_kind:
			count += 1
	return count


func _placement_counts_from_keys(keys: Array) -> Dictionary:
	return {
		"backgrounds": _count_kind(keys, "background"),
		"props": _count_kind(keys, "prop"),
		"structures": _count_kind(keys, "structure"),
		"effects": _count_kind(keys, "effect"),
		"depth_planes": _count_kind(keys, "depth"),
	}


func _moving_platform_count(placements: Array) -> int:
	var count := 0
	for value: Variant in placements:
		var placement: Dictionary = value
		if (
			placement.get("kind") == "actor"
			and placement.get("controller") == "moving-platform"
		):
			count += 1
	return count


func _count_moving_platform_nodes(nodes: Array[Node]) -> int:
	var count := 0
	for node: Node in nodes:
		if (
			node.get_meta("mapsoo_world_visual_kind", "") == "actor"
			and node.get_meta("mapsoo_actor_controller", "") == "moving-platform"
		):
			count += 1
	return count


func _collect_meta_values(
	node: Node,
	meta_name: String,
	values: Dictionary
) -> void:
	if node.has_meta(meta_name):
		var value := str(node.get_meta(meta_name, ""))
		if not value.is_empty():
			values[value] = true
	for child: Node in node.get_children():
		_collect_meta_values(child, meta_name, values)


func _collect_placement_nodes(node: Node, nodes: Array[Node]) -> void:
	if (
		node.has_meta("mapsoo_world_visual_placement_id")
		and node.has_meta("mapsoo_world_visual_kind")
	):
		nodes.append(node)
	for child: Node in node.get_children():
		_collect_placement_nodes(child, nodes)


func _fail(message: String) -> void:
	push_error("WORLD_ART_RUNTIME_OVERLAY_V1_1_CAPTURE_FAILURE: %s" % message)
	quit(1)
