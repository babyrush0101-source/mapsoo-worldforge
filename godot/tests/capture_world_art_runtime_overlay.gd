extends SceneTree

## Consumer-neutral technical evidence capture for one canonical
## WorldLayoutPlan and one already-extracted WorldArtRuntimeOverlay.

const LayoutAttachment = preload(
	"res://addons/mapsoo_importer/mapsoo_world_layout_attachment.gd"
)
const MaterialPalette = preload(
	"res://addons/mapsoo_importer/mapsoo_world_material_palette.gd"
)
const RuntimeOverlay = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay.gd"
)
const RuntimeOverlayApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_overlay_applier.gd"
)
const RuntimeHazardApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_hazard_applier.gd"
)
const RuntimeCharacterApplier = preload(
	"res://addons/mapsoo_importer/mapsoo_world_art_runtime_character_applier.gd"
)
const ProductionReviewOverlay = preload(
	"res://tests/helpers/production_review_overlay.gd"
)

const EVIDENCE_MODES := [
	"normal",
	"role-overlay",
	"collision-overlay",
	"spawn-exit",
	"navigation",
]
const LAYOUT_FILENAME := "world-layout-plan.json"
const MAX_LAYOUT_BYTES := 2 * 1024 * 1024
const ROUTE_FRAMES_PER_EDGE := 12


func _init() -> void:
	call_deferred("_run")


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
	var loaded := RuntimeOverlay.load_extracted(
		overlay_path,
		layout_sha256,
		authorization
	)
	if not loaded.ok:
		_fail("Runtime overlay load failed: %s" % str(loaded.error))
		return
	var overlay: Dictionary = loaded.overlay
	if overlay.manifest.get("profile") != plan.get("profile"):
		_fail("Runtime overlay profile differs from the layout.")
		return

	var viewport_size := root.get_visible_rect().size
	if viewport_size.x < 64.0 or viewport_size.y < 64.0:
		_fail("Capture viewport is too small.")
		return
	var world := _create_world(str(plan.profile), viewport_size)
	root.add_child(world)
	var attachment := {
		"plan": plan,
		"sha256": layout_sha256,
		"manifest_sha256": layout_sha256,
	}
	var layout_bound := LayoutAttachment.bind_scene(world, attachment)
	if not layout_bound.ok:
		_fail("WorldLayout materialization failed: %s" % str(layout_bound.error))
		return
	var baseline := _apply_baseline_palette(world, plan, layout_sha256, overlay)
	if not baseline.ok:
		_fail("Runtime overlay palette preparation failed: %s" % str(baseline.error))
		return
	var overlay_bound := RuntimeOverlay.bind_scene(world, overlay)
	if not overlay_bound.ok:
		_fail("Runtime overlay scene binding failed: %s" % str(overlay_bound.error))
		return
	var visual_applied := RuntimeOverlayApplier.apply(world)
	if not visual_applied.ok:
		_fail("Runtime overlay visual application failed: %s" % str(visual_applied.error))
		return
	var hazards_applied := 0
	if not (overlay.projection.get("hazards", []) as Array).is_empty():
		var hazard_result := RuntimeHazardApplier.apply(world)
		if not hazard_result.ok:
			_fail("Runtime overlay hazard application failed: %s" % str(hazard_result.error))
			return
		hazards_applied = int(hazard_result.hazards)
	var characters_applied := 0
	if _has_player_binding(overlay.projection):
		var character_result := RuntimeCharacterApplier.apply(world)
		if not character_result.ok:
			_fail("Runtime overlay character application failed: %s" % str(character_result.error))
			return
		characters_applied = 1
	if not _validate_applied_scene(
		world,
		overlay,
		hazards_applied > 0,
		characters_applied > 0
	):
		return

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
	print(
		(
			"WORLD_ART_RUNTIME_OVERLAY_CAPTURE_OK " +
			"profile=%s mode=%s layout_sha256=%s overlay_id=%s " +
			"render_sha256=%s route_nodes=%d terrain=%d landmarks=%d " +
			"hazards=%d characters=%d animation=%s output=%s"
		) % [
			str(plan.profile),
			evidence_mode,
			layout_sha256,
			str(overlay.manifest.overlay_id),
			render_sha256,
			(route.ids as Array).size(),
			int(visual_applied.terrain_materials),
			int(visual_applied.landmarks),
			hazards_applied,
			characters_applied,
			animation,
			output_absolute,
		]
	)
	quit(0)


func _create_world(profile: String, viewport_size: Vector2) -> Node2D:
	var world := Node2D.new()
	world.name = "World"
	world.set_meta("mapsoo_profile", profile)
	var margin := maxf(16.0, minf(viewport_size.x, viewport_size.y) * 0.05)
	var world_bounds := Rect2(
		Vector2(margin, margin),
		viewport_size - Vector2(margin * 2.0, margin * 2.0)
	)
	world.set_meta("mapsoo_bounds", world_bounds)
	var background := ColorRect.new()
	background.name = "CaptureBackground"
	background.position = Vector2.ZERO
	background.size = viewport_size
	background.color = Color("#111827")
	background.mouse_filter = Control.MOUSE_FILTER_IGNORE
	background.z_index = -100
	world.add_child(background)
	var camera := Camera2D.new()
	camera.name = "CaptureCamera"
	camera.position = viewport_size * 0.5
	camera.enabled = true
	world.add_child(camera)
	var actors := Node2D.new()
	actors.name = "Actors"
	actors.y_sort_enabled = profile in ["isometric-action", "layered-depth-2d"]
	world.add_child(actors)
	var player := CharacterBody2D.new()
	player.name = "Player"
	player.set_meta("mapsoo_role", "character.player.atlas")
	player.collision_layer = 1
	player.collision_mask = 1
	actors.add_child(player)
	var visual := AnimatedSprite2D.new()
	visual.name = "Visual"
	visual.sprite_frames = SpriteFrames.new()
	visual.set_meta("mapsoo_runtime_slot_id", "player")
	visual.set_meta("mapsoo_role", "character.player.atlas")
	visual.z_index = 20
	player.add_child(visual)
	var collision := CollisionShape2D.new()
	collision.name = "CollisionShape2D"
	var capsule := CapsuleShape2D.new()
	capsule.radius = 7.0
	capsule.height = 20.0
	collision.shape = capsule
	collision.position = Vector2(0.0, -8.0)
	player.add_child(collision)
	return world


func _apply_baseline_palette(
	world: Node,
	plan: Dictionary,
	layout_sha256: String,
	overlay: Dictionary
) -> Dictionary:
	var bindings: Array = overlay.projection.get("bindings", [])
	var textures: Dictionary = overlay.textures
	var by_material := {}
	for value: Variant in bindings:
		if value is Dictionary and value.get("usage_kind") == "terrain-material":
			by_material[str(value.get("usage_id", ""))] = value
	var materials := {}
	var terrain_layout: Dictionary = plan.terrain_layout
	for value: Variant in terrain_layout.get(str(terrain_layout.kind), []):
		var terrain: Dictionary = value
		materials[str(terrain.material)] = true
	var ordered: Array = materials.keys()
	ordered.sort()
	var entries: Array = []
	var roles := {}
	for material_value: Variant in ordered:
		var material := str(material_value)
		var binding: Dictionary = by_material.get(material, {})
		if binding.is_empty():
			return {"ok": false, "error": "Missing terrain binding: %s." % material}
		var source: Texture2D = textures.get(str(binding.image_path))
		var region: Dictionary = binding.region
		if source == null:
			return {"ok": false, "error": "Missing terrain texture: %s." % material}
		var atlas := AtlasTexture.new()
		atlas.atlas = source
		atlas.region = Rect2(
			float(region.x),
			float(region.y),
			float(region.width),
			float(region.height)
		)
		atlas.filter_clip = true
		var role := str(binding.role)
		if not roles.has(role):
			roles[role] = atlas
		entries.append({
			"material": material,
			"role": role,
			"rendering": "single-cell",
		})
	var palette := {
		"schema_version": "1.0.0",
		"document_type": "world-material-palette",
		"palette_id": "runtime-capture-%s" % layout_sha256.left(16),
		"profile": str(plan.profile),
		"layout": {"plan_id": str(plan.plan_id), "sha256": layout_sha256},
		"entries": entries,
	}
	return MaterialPalette.apply(
		world,
		plan,
		layout_sha256,
		palette,
		{
			"tile_size": (
				Vector2i(32, 16)
				if plan.profile == "isometric-action"
				else Vector2i(32, 32)
			),
			"roles": roles,
		}
	)


func _validate_applied_scene(
	world: Node,
	overlay: Dictionary,
	has_hazards: bool,
	has_character: bool
) -> bool:
	var bound := RuntimeOverlay.validate_bound_scene(world, overlay)
	var visuals := RuntimeOverlayApplier.validate_scene(world)
	if not bound.ok or not visuals.ok:
		_fail("Applied runtime overlay postcondition failed: %s / %s" % [bound, visuals])
		return false
	if has_hazards:
		var hazards := RuntimeHazardApplier.validate_scene(world)
		if not hazards.ok:
			_fail("Applied runtime hazards changed: %s" % hazards)
			return false
	if has_character:
		var character := RuntimeCharacterApplier.validate_scene(world)
		if not character.ok:
			_fail("Applied runtime character changed: %s" % character)
			return false
	return true


func _has_player_binding(projection: Dictionary) -> bool:
	for value: Variant in projection.get("bindings", []):
		if (
			value is Dictionary
			and value.get("usage_kind") == "character"
			and value.get("role") == "character.player.atlas"
		):
			return true
	return false


func _route(world: Node, plan: Dictionary) -> Dictionary:
	var adjacency := {}
	for value: Variant in plan.traversal.nodes:
		var node: Dictionary = value
		adjacency[str(node.id)] = []
	for value: Variant in plan.traversal.edges:
		var edge: Dictionary = value
		if not adjacency.has(str(edge.from)) or not adjacency.has(str(edge.to)):
			return {"ok": false, "error": "Traversal edge is dangling."}
		(adjacency[str(edge.from)] as Array).append(str(edge.to))
		if edge.direction == "bidirectional":
			(adjacency[str(edge.to)] as Array).append(str(edge.from))
	for key: Variant in adjacency:
		(adjacency[key] as Array).sort()
	var start := str(plan.spawn.node_id)
	var goal := str(plan.exit.node_id)
	var queue: Array[String] = [start]
	var previous := {start: ""}
	while not queue.is_empty():
		var current: String = queue.pop_front()
		if current == goal:
			break
		for next_value: Variant in adjacency.get(current, []):
			var next := str(next_value)
			if not previous.has(next):
				previous[next] = current
				queue.append(next)
	if not previous.has(goal):
		return {"ok": false, "error": "No directed spawn-to-exit path."}
	var ids: Array[String] = []
	var cursor := goal
	while not cursor.is_empty():
		ids.push_front(cursor)
		cursor = str(previous.get(cursor, ""))
	var positions_by_id := {}
	var traversal := world.get_node_or_null(
		"MapsooLayoutMaterialization/Traversal"
	)
	if traversal == null:
		return {"ok": false, "error": "Materialized traversal is missing."}
	for child: Node in traversal.get_children():
		if child is Marker2D:
			positions_by_id[str(child.get_meta("mapsoo_node_id", ""))] = (
				child as Marker2D
			).global_position
	var positions: Array[Vector2] = []
	for id: String in ids:
		if not positions_by_id.has(id):
			return {"ok": false, "error": "Materialized route marker is missing."}
		positions.append(positions_by_id[id])
	return {"ok": true, "ids": ids, "positions": positions, "error": ""}


func _add_traversal_review_view(world: Node2D, plan: Dictionary) -> void:
	var view := Node2D.new()
	view.name = "WorldTraversal"
	view.set_meta("mapsoo_edges", (plan.traversal.edges as Array).duplicate(true))
	var source := world.get_node("MapsooLayoutMaterialization/Traversal")
	for child: Node in source.get_children():
		if not child is Marker2D:
			continue
		var marker := Marker2D.new()
		marker.name = child.name
		marker.position = (child as Marker2D).position
		marker.set_meta("mapsoo_id", child.get_meta("mapsoo_node_id", ""))
		marker.set_meta("mapsoo_kind", child.get_meta("mapsoo_kind", "route"))
		view.add_child(marker)
	world.add_child(view)


func _animate_route(world: Node, positions: Array[Vector2]) -> bool:
	var player := world.find_child("Player", true, false) as CharacterBody2D
	if player == null or positions.size() < 2:
		return false
	player.position = positions[0]
	var visual := player.get_node_or_null("Visual") as AnimatedSprite2D
	_select_movement_animation(visual)
	for index: int in range(positions.size() - 1):
		var start := positions[index]
		var finish := positions[index + 1]
		for frame: int in ROUTE_FRAMES_PER_EDGE:
			var weight := float(frame + 1) / float(ROUTE_FRAMES_PER_EDGE)
			player.global_position = start.lerp(finish, weight)
			await process_frame
	if visual != null:
		visual.stop()
	return player.global_position.distance_to(positions[-1]) <= 0.01


func _select_movement_animation(visual: AnimatedSprite2D) -> void:
	if visual == null or visual.sprite_frames == null:
		return
	var names := visual.sprite_frames.get_animation_names()
	names.sort()
	for prefix: String in ["run_", "walk_", "move_"]:
		for name: StringName in names:
			if str(name).begins_with(prefix):
				visual.play(name)
				return


func _load_json_document(path: String, maximum: int) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"ok": false, "error": "JSON input does not exist: %s." % path}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null or file.get_length() < 1 or file.get_length() > maximum:
		return {"ok": false, "error": "JSON input size is invalid: %s." % path}
	var bytes := file.get_buffer(file.get_length())
	file.close()
	var parser := JSON.new()
	if (
		parser.parse(bytes.get_string_from_utf8()) != OK
		or typeof(parser.data) != TYPE_DICTIONARY
	):
		return {"ok": false, "error": "JSON input is invalid: %s." % path}
	return {"ok": true, "value": parser.data as Dictionary, "bytes": bytes, "error": ""}


func _sha256_bytes(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()


func _argument_value(prefix: String) -> String:
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	push_error("WORLD_ART_RUNTIME_OVERLAY_CAPTURE_FAILURE: %s" % message)
	quit(1)
