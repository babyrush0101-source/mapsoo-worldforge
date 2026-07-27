@tool
extends RefCounted

const PlayerController = preload("res://addons/mapsoo_importer/runtime/mapsoo_layered_depth_player_controller.gd")
const SCHEMA_VERSION := "1.0.0-draft.1"
const IMPORTER_VERSION := "1.0.0"
const DIRECTIONS := ["left", "right", "near", "far"]
const PLAYER_ACTIONS := ["idle", "walk", "run", "interact"]
const NPC_ACTIONS := ["idle", "talk"]
const FRAME_PROVENANCE := [
	"independent-generated-pose", "declared-synthetic-variant", "artist-authored",
]
const PLANE_BINDINGS := [
	["sky", "background.sky"],
	["far", "background.far"],
	["mid", "background.mid"],
	["depth-fog", "background.depth-fog"],
	["near", "near.overlay"],
	["ambient-light", "lighting.ambient"],
	["local-light", "lighting.local"],
	["foreground", "foreground.overlay"],
]
const REQUIRED_ROLES := [
	"background.sky", "background.far", "background.mid", "background.depth-fog",
	"near.overlay", "foreground.overlay", "lighting.ambient", "lighting.local",
	"terrain.ground", "terrain.path", "terrain.edge", "terrain.bridge", "terrain.stairs",
	"terrain.water", "prop.tree", "prop.rock", "prop.crate", "prop.sign", "prop.lamp",
	"prop.occluder", "structure.entrance", "structure.exit", "structure.checkpoint",
	"structure.landmark", "collectible.primary", "collectible.health", "effect.footstep",
	"effect.interact", "effect.portal", "effect.ambient", "character.player.atlas",
	"character.npc.atlas", "world.scene", "world.collision", "world.navigation",
	"world.preview",
]
const REVIEW_GATES := ["pending", "pass", "rejected"]
const DISTRIBUTIONS := ["internal-review", "private", "public"]
const MEDIA_TYPES := [
	"image/png", "application/json", "application/schema+json", "text/markdown",
]
const FORBIDDEN_EXTENSIONS := [
	"bat", "cmd", "cs", "dll", "dylib", "exe", "gd", "gdshader", "glsl", "js",
	"mjs", "pck", "ps1", "py", "res", "sh", "shader", "so", "ts", "tscn", "tres",
	"wasm",
]
const FORBIDDEN_SOURCE_KEYS := [
	"reference", "references", "referencePath", "reference_path", "referenceHash",
	"reference_hash", "sourceReferenceIds", "source_reference_ids",
	"sourceReferencePath", "source_reference_path", "originalPath", "original_path",
	"originalHash", "original_hash", "sourceImage", "source_image", "prompt",
	"prompts", "rawPrompt", "raw_prompt", "generationPrompt", "generation_prompt",
]
const FORBIDDEN_SOURCE_SEGMENTS := [
	"reference", "references", "source-reference", "source-references", "prompt",
	"prompts", "raw-prompt", "raw-prompts",
]


static func validate_and_prepare(
	manifest: Dictionary,
	pack_root: String,
	prepared: Dictionary,
	file_index: Dictionary,
	authorization: Dictionary,
) -> Dictionary:
	var errors: Array[String] = prepared.errors
	var manifest_keys := [
		"schema_version", "pack", "profile", "distribution", "review",
		"compatibility", "planes", "atlases", "roles", "characters", "runtime",
		"files", "license", "provenance", "reference_policy",
	]
	if manifest.has("layout"):
		manifest_keys.append("layout")
	_require_keys(manifest, manifest_keys, "Pack 1.0 manifest", errors)
	var pack := _dict(manifest.get("pack"), "pack", errors)
	var generator := _dict(pack.get("generator"), "pack.generator", errors)
	var review := _dict(manifest.get("review"), "review", errors)
	var compatibility := _dict(manifest.get("compatibility"), "compatibility", errors)
	var importer := _dict(compatibility.get("importer"), "compatibility.importer", errors)
	var license := _dict(manifest.get("license"), "license", errors)
	var output_license := _dict(license.get("output"), "license.output", errors)
	var provenance := _dict(manifest.get("provenance"), "provenance", errors)
	var reference_policy := _dict(manifest.get("reference_policy"), "reference_policy", errors)
	_require_keys(pack, ["id", "title", "version", "generator", "created_at"], "pack", errors)
	_require_keys(generator, ["name", "version"], "pack.generator", errors)
	_require_keys(review, ["human_art", "rights", "runtime", "raspberry_pi"], "review", errors)
	_require_keys(compatibility, ["godot_min", "projection", "art_style", "importer"], "compatibility", errors)
	_require_keys(importer, ["id", "min_version"], "compatibility.importer", errors)
	_require_keys(license, ["output"], "license", errors)
	_require_keys(output_license, [
		"id", "notice_path", "permits_redistribution", "permits_commercial_use",
	], "license.output", errors)
	_require_keys(provenance, [
		"output_provenance", "contains_generative_ai", "model_provider", "model",
		"human_curated", "source_manifest_hashes",
	], "provenance", errors)
	_require_keys(reference_policy, [
		"embedded", "original_references_excluded", "raw_prompts_excluded",
		"only_one_way_audit_hashes_retained",
	], "reference_policy", errors)

	if manifest.get("schema_version") != SCHEMA_VERSION \
			or manifest.get("profile") != "layered-depth-2d":
		errors.append("Pack 1.0 requires schema 1.0.0-draft.1 and layered-depth-2d.")
	if not _safe_id(str(pack.get("id", ""))) \
			or str(pack.get("title", "")).is_empty() \
			or not _semantic_version(str(pack.get("version", ""))) \
			or generator.get("name") != "Mapsoo Worldsmith" \
			or generator.get("version") != pack.get("version"):
		errors.append("Pack 1.0 identity or generator version is invalid.")
	else:
		prepared.pack_id = str(pack.id)
	if compatibility.get("projection") != "layered-depth-stage" \
			or compatibility.get("art_style") != "pixel_art" \
			or importer.get("id") != "mapsoo_importer" \
			or str(importer.get("min_version", "")).is_empty() \
			or not str(compatibility.get("godot_min", "")).begins_with("4."):
		errors.append("Pack 1.0 compatibility contract is unsupported.")
	for key: String in ["human_art", "rights", "runtime", "raspberry_pi"]:
		if str(review.get(key, "")) not in REVIEW_GATES:
			errors.append("Pack 1.0 review gate is invalid: %s." % key)
	_validate_distribution(
		str(manifest.get("distribution", "")),
		review,
		output_license,
		provenance,
		str(pack.get("id", "")),
		authorization,
		errors,
	)
	if reference_policy.get("embedded") != false \
			or reference_policy.get("original_references_excluded") != true \
			or reference_policy.get("raw_prompts_excluded") != true \
			or reference_policy.get("only_one_way_audit_hashes_retained") != true:
		errors.append("Pack 1.0 must exclude references and raw prompts.")
	_validate_provenance(provenance, errors)
	_scan_forbidden_source_fields(manifest, errors)
	_validate_files(pack_root, file_index, errors)
	if not errors.is_empty():
		return prepared

	var textures := {}
	var image_sizes := {}
	var atlases := _validate_atlases(manifest.get("atlases"), pack_root, file_index, textures, image_sizes, errors)
	var planes := _validate_planes(manifest.get("planes"), pack_root, file_index, textures, image_sizes, errors)
	var roles := _validate_roles(manifest.get("roles"), file_index, atlases, image_sizes, errors)
	for plane: Dictionary in planes:
		var plane_binding: Dictionary = roles.get(str(plane.role), {})
		if plane_binding.get("kind") != "file" or plane_binding.get("path") != plane.path:
			errors.append("Pack 1.0 plane roles must bind their exact independent files.")
	var characters := _validate_characters(manifest.get("characters"), file_index, atlases, image_sizes, roles, errors)
	var runtime := _validate_runtime(manifest.get("runtime"), pack_root, file_index, roles, errors)
	if not errors.is_empty():
		return prepared

	prepared.schema_version = SCHEMA_VERSION
	prepared.textures = textures
	prepared.pack10_atlases = atlases
	prepared.pack10_planes = planes
	prepared.pack10_roles = roles
	prepared.pack10_characters = characters
	prepared.pack10_scene = runtime.scene
	prepared.pack10_collision = runtime.collision
	prepared.pack10_navigation = runtime.navigation
	prepared.pack10_bounds = runtime.bounds
	prepared.pack10_spawn = runtime.spawn
	prepared.pack10_distribution = str(manifest.distribution)
	prepared.pack10_output_license = str(output_license.id)
	prepared.pack10_authorization_grant = (
		"public"
		if manifest.distribution == "public"
		else str(authorization.get("grant_id", ""))
	)
	prepared.props = runtime.scene.placements
	prepared.cell_count = runtime.collision.solids.size()
	prepared.layer_cell_counts = {}
	prepared.tile_set = TileSet.new()
	prepared.tile_set.tile_size = Vector2i(32, 32)
	return prepared


static func build_scene(prepared: Dictionary) -> Dictionary:
	var root := Node2D.new()
	root.name = "MapsooWorld"
	root.set_meta("mapsoo_pack_id", prepared.pack_id)
	root.set_meta("mapsoo_profile", "layered-depth-2d")
	root.set_meta("mapsoo_schema_version", SCHEMA_VERSION)
	root.set_meta("mapsoo_distribution", prepared.pack10_distribution)
	root.set_meta("mapsoo_output_license", prepared.pack10_output_license)
	root.set_meta("mapsoo_authorization_grant", prepared.pack10_authorization_grant)
	root.set_meta("mapsoo_data_only", true)
	root.set_meta("mapsoo_bounds", prepared.pack10_bounds)

	for index: int in prepared.pack10_planes.size():
		var plane: Dictionary = prepared.pack10_planes[index]
		var sprite := Sprite2D.new()
		sprite.name = str(plane.id).to_pascal_case()
		sprite.texture = prepared.textures[plane.path]
		sprite.centered = false
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		var texture_size := sprite.texture.get_size()
		sprite.scale = Vector2(
			prepared.pack10_bounds.size.x / texture_size.x,
			prepared.pack10_bounds.size.y / texture_size.y,
		)
		sprite.z_index = [-100, -90, -80, -70, 30, 50, 60, 70][index]
		var blend := str(plane.blend)
		if blend in ["add", "multiply"]:
			var material := CanvasItemMaterial.new()
			material.blend_mode = (
				CanvasItemMaterial.BLEND_MODE_ADD
				if blend == "add"
				else CanvasItemMaterial.BLEND_MODE_MUL
			)
			sprite.material = material
		root.add_child(sprite)
		sprite.owner = root

	var gameplay := Node2D.new()
	gameplay.name = "YSortedGameplay"
	gameplay.y_sort_enabled = true
	root.add_child(gameplay)
	gameplay.owner = root
	var props := Node2D.new()
	props.name = "Props"
	gameplay.add_child(props)
	props.owner = root
	var actors := Node2D.new()
	actors.name = "Actors"
	gameplay.add_child(actors)
	actors.owner = root

	var character_positions := {}
	for placement: Dictionary in prepared.pack10_scene.placements:
		var role := str(placement.role)
		if role in ["character.player.atlas", "character.npc.atlas"]:
			character_positions[role] = Vector2(placement.x, placement.y)
			continue
		var binding: Dictionary = prepared.pack10_roles[role]
		var texture := _binding_texture(prepared, binding)
		if texture == null:
			continue
		var sprite := Sprite2D.new()
		sprite.name = str(placement.id).to_pascal_case()
		sprite.texture = texture
		sprite.position = Vector2(placement.x, placement.y)
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.set_meta("mapsoo_id", placement.id)
		sprite.set_meta("mapsoo_role", role)
		props.add_child(sprite)
		sprite.owner = root

	_add_collision(root, prepared.pack10_collision)
	_add_navigation(root, prepared.pack10_navigation)
	_add_characters(root, actors, prepared, character_positions)
	return {"ok": true, "root": root, "error": ""}


static func validate_staged_scene(world: Node, expected_placements: int) -> Dictionary:
	var valid: bool = world != null
	if valid:
		valid = world.name == "MapsooWorld" \
			and world.get_meta("mapsoo_schema_version", "") == SCHEMA_VERSION \
			and world.get_meta("mapsoo_profile", "") == "layered-depth-2d" \
			and world.get_meta("mapsoo_distribution", "") in DISTRIBUTIONS \
			and world.get_meta("mapsoo_data_only", false) == true \
			and not str(world.get_meta("mapsoo_authorization_grant", "")).is_empty()
	valid = valid and world.get_node_or_null("YSortedGameplay/Props") is Node2D \
		and world.get_node_or_null("YSortedGameplay/Actors/Player") is CharacterBody2D \
		and world.get_node_or_null("YSortedGameplay/Actors/Npc") is CharacterBody2D \
		and world.get_node_or_null("WorldCollision") is Node2D \
		and world.get_node_or_null("WorldNavigation") is NavigationRegion2D \
		and world.get_node_or_null("WorldTraversal") is Node2D
	var player := world.get_node_or_null("YSortedGameplay/Actors/Player") as CharacterBody2D
	var npc := world.get_node_or_null("YSortedGameplay/Actors/Npc") as CharacterBody2D
	if valid:
		valid = _actor_has_clips(player, PLAYER_ACTIONS) and _actor_has_clips(npc, NPC_ACTIONS)
	var placement_count := 2
	if world.get_node_or_null("YSortedGameplay/Props") is Node2D:
		placement_count += world.get_node("YSortedGameplay/Props").get_child_count()
	valid = valid and placement_count == expected_placements
	return {
		"ok": valid,
		"error": "" if valid else "Staged Pack 1.0 controlled scene is incomplete.",
	}


static func _validate_distribution(
	distribution: String,
	review: Dictionary,
	output_license: Dictionary,
	provenance: Dictionary,
	pack_id: String,
	authorization: Dictionary,
	errors: Array[String],
) -> void:
	if distribution not in DISTRIBUTIONS:
		errors.append("Pack 1.0 distribution is unsupported.")
		return
	var license_id := str(output_license.get("id", ""))
	var redistributable: Variant = output_license.get("permits_redistribution")
	var commercial: Variant = output_license.get("permits_commercial_use")
	if distribution == "internal-review":
		if license_id != "LicenseRef-UNRELEASED" \
				or redistributable != false or commercial != false:
			errors.append("Internal-review Pack 1.0 must remain UNRELEASED and non-redistributable.")
	elif distribution == "private":
		if review.get("human_art") != "pass" or review.get("rights") != "pass" \
				or review.get("runtime") != "pass" \
				or license_id == "LicenseRef-UNRELEASED" or redistributable != false:
			errors.append("Private Pack 1.0 requires human, rights and runtime approval plus a private-use license.")
	else:
		for value: Variant in review.values():
			if value != "pass":
				errors.append("Public Pack 1.0 requires every review gate.")
				break
		if license_id not in ["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "MIT"] \
				or redistributable != true or commercial != true \
				or (provenance.get("contains_generative_ai") == true \
				and provenance.get("human_curated") != true):
			errors.append("Public Pack 1.0 requires an approved commercial/redistributable license and human curation.")
	if distribution != "public":
		_require_keys(
			authorization,
			["decision", "distribution", "pack_id", "grant_id"],
			"caller authorization",
			errors,
		)
		if authorization.get("decision") != "allow" \
				or authorization.get("distribution") != distribution \
				or authorization.get("pack_id") != pack_id \
				or not _safe_id(str(authorization.get("grant_id", ""))):
			errors.append("Caller authorization does not grant this exact non-public pack.")


static func _validate_provenance(value: Dictionary, errors: Array[String]) -> void:
	if str(value.get("output_provenance", "")) not in [
		"procedural", "generative-ai", "hybrid", "artist-authored",
	] or typeof(value.get("contains_generative_ai")) != TYPE_BOOL \
			or typeof(value.get("human_curated")) != TYPE_BOOL:
		errors.append("Pack 1.0 provenance declaration is invalid.")
	var hashes: Variant = value.get("source_manifest_hashes")
	var seen := {}
	if typeof(hashes) != TYPE_ARRAY or hashes.is_empty() or hashes.size() > 128:
		errors.append("Pack 1.0 requires source manifest audit hashes.")
	else:
		for hash_value: Variant in hashes:
			var hash := str(hash_value)
			if not _sha256(hash) or seen.has(hash):
				errors.append("Pack 1.0 source manifest hashes must be unique SHA-256 values.")
			seen[hash] = true


static func _validate_files(
	pack_root: String,
	file_index: Dictionary,
	errors: Array[String],
) -> void:
	for path_value: Variant in file_index:
		var path := str(path_value)
		var record: Dictionary = file_index[path]
		if str(record.get("media_type", "")) not in MEDIA_TYPES:
			errors.append("Pack 1.0 file media type is unsupported: %s." % path)
		if path.get_extension().to_lower() in FORBIDDEN_EXTENSIONS:
			errors.append("Pack 1.0 rejects script, shader and executable content: %s." % path)
		for segment: String in path.to_lower().split("/", true):
			if segment in FORBIDDEN_SOURCE_SEGMENTS:
				errors.append("Pack 1.0 forbids source-reference and raw-prompt files.")
		if str(record.get("media_type", "")) != "image/png":
			var text := FileAccess.get_file_as_string(pack_root.path_join(path))
			if _forbidden_text(text):
				errors.append("Pack 1.0 data contains a URL, absolute path, script, shader or traversal reference: %s." % path)
	_validate_exact_inventory(pack_root, file_index, errors)


static func _validate_atlases(
	value: Variant,
	pack_root: String,
	file_index: Dictionary,
	textures: Dictionary,
	image_sizes: Dictionary,
	errors: Array[String],
) -> Dictionary:
	var output := {}
	var paths := {}
	if typeof(value) != TYPE_ARRAY or value.is_empty() or value.size() > 32:
		errors.append("Pack 1.0 atlas inventory is invalid.")
		return output
	for item: Variant in value:
		var atlas := _dict(item, "atlas", errors)
		_require_keys(atlas, ["id", "path", "cell_size"], "atlas", errors)
		var id := str(atlas.get("id", ""))
		var path := str(atlas.get("path", ""))
		var cell := _int_pair(atlas.get("cell_size"), "atlas cell_size", errors, true)
		if not _safe_id(id) or output.has(id) or paths.has(path) \
				or not _file_is(file_index, path, "image/png"):
			errors.append("Pack 1.0 atlas identity, path or media type is invalid.")
			continue
		var loaded := _load_png(pack_root.path_join(path))
		if not loaded.ok or cell.x > loaded.image.get_width() or cell.y > loaded.image.get_height():
			errors.append("Pack 1.0 atlas image or cell geometry is invalid: %s." % path)
			continue
		textures[path] = _texture(loaded.image)
		image_sizes[path] = loaded.image.get_size()
		output[id] = {"id": id, "path": path, "cell_size": cell}
		paths[path] = true
	return output


static func _validate_planes(
	value: Variant,
	pack_root: String,
	file_index: Dictionary,
	textures: Dictionary,
	image_sizes: Dictionary,
	errors: Array[String],
) -> Array:
	var output: Array = []
	var paths := {}
	if typeof(value) != TYPE_ARRAY or value.size() != PLANE_BINDINGS.size():
		errors.append("Pack 1.0 requires eight independent canonical planes.")
		return output
	for index: int in PLANE_BINDINGS.size():
		var plane := _dict(value[index], "plane", errors)
		_require_keys(plane, ["id", "role", "path", "layer", "blend"], "plane", errors)
		var path := str(plane.get("path", ""))
		if plane.get("id") != PLANE_BINDINGS[index][0] \
				or plane.get("role") != PLANE_BINDINGS[index][1] \
				or plane.get("layer") != plane.get("id") \
				or str(plane.get("blend", "")) not in ["mix", "add", "multiply"] \
				or paths.has(path) or not _file_is(file_index, path, "image/png"):
			errors.append("Pack 1.0 plane %d is invalid or aliases another plane." % index)
			continue
		var loaded := _load_png(pack_root.path_join(path))
		if not loaded.ok:
			errors.append("Unable to load Pack 1.0 plane: %s." % path)
			continue
		textures[path] = _texture(loaded.image)
		image_sizes[path] = loaded.image.get_size()
		paths[path] = true
		output.append(plane.duplicate(true))
	return output


static func _validate_roles(
	value: Variant,
	file_index: Dictionary,
	atlases: Dictionary,
	image_sizes: Dictionary,
	errors: Array[String],
) -> Dictionary:
	var output := {}
	var regions := {}
	if typeof(value) != TYPE_ARRAY or value.size() != REQUIRED_ROLES.size():
		errors.append("Pack 1.0 requires exactly 36 canonical roles.")
		return output
	for item: Variant in value:
		var role_record := _dict(item, "role", errors)
		_require_keys(role_record, ["role", "binding"], "role", errors)
		var role := str(role_record.get("role", ""))
		var binding := _dict(role_record.get("binding"), "role.binding", errors)
		if role not in REQUIRED_ROLES or output.has(role):
			errors.append("Pack 1.0 role is missing, unexpected or duplicated: %s." % role)
			continue
		var normalized := {}
		if binding.get("kind") == "file":
			_require_keys(binding, ["kind", "path"], "file binding", errors)
			var path := str(binding.get("path", ""))
			if not file_index.has(path) or str(file_index[path].get("media_type", "")) not in ["image/png", "application/json"]:
				errors.append("Pack 1.0 file role binding is absent or has the wrong media type.")
			normalized = {"kind": "file", "path": path}
		elif binding.get("kind") == "atlas-region":
			_require_keys(binding, ["kind", "atlas", "region"], "atlas binding", errors)
			var atlas_id := str(binding.get("atlas", ""))
			var region := _rect(binding.get("region"), "atlas region", errors)
			if not atlases.has(atlas_id):
				errors.append("Pack 1.0 role references a missing atlas.")
			else:
				var atlas: Dictionary = atlases[atlas_id]
				var size: Vector2i = image_sizes[atlas.path]
				var key := "%s:%d,%d,%d,%d" % [atlas_id, region.position.x, region.position.y, region.size.x, region.size.y]
				if region.size.x > atlas.cell_size.x or region.size.y > atlas.cell_size.y \
						or region.end.x > size.x or region.end.y > size.y or regions.has(key):
					errors.append("Pack 1.0 role region is out of bounds or aliased.")
				regions[key] = true
			normalized = {"kind": "atlas-region", "atlas": atlas_id, "region": Rect2(region)}
		else:
			errors.append("Pack 1.0 role binding kind is unsupported.")
		output[role] = normalized
	for role: String in REQUIRED_ROLES:
		if not output.has(role):
			errors.append("Required Pack 1.0 role is absent: %s." % role)
	for index: int in PLANE_BINDINGS.size():
		var plane_role: String = PLANE_BINDINGS[index][1]
		var plane_binding: Dictionary = output.get(plane_role, {})
		if plane_binding.get("kind") != "file":
			errors.append("Pack 1.0 plane roles must use exact file bindings.")
	return output


static func _validate_characters(
	value: Variant,
	file_index: Dictionary,
	atlases: Dictionary,
	image_sizes: Dictionary,
	roles: Dictionary,
	errors: Array[String],
) -> Array:
	var output: Array = []
	if typeof(value) != TYPE_ARRAY or value.size() != 2:
		errors.append("Pack 1.0 requires exactly one player and one NPC.")
		return output
	for contract: Dictionary in [
		{"id": "player", "role": "character.player.atlas", "actions": PLAYER_ACTIONS},
		{"id": "npc", "role": "character.npc.atlas", "actions": NPC_ACTIONS},
	]:
		var matches: Array = (value as Array).filter(
			func(item: Variant) -> bool:
				return typeof(item) == TYPE_DICTIONARY and item.get("id") == contract.id
		)
		if matches.size() != 1:
			errors.append("Pack 1.0 character is absent or duplicated: %s." % contract.id)
			continue
		var character: Dictionary = matches[0]
		_require_keys(character, ["id", "atlas", "frame_size", "pivot", "clips"], "character", errors)
		var atlas_path := str(character.get("atlas", ""))
		var frame_size := _int_pair(character.get("frame_size"), "character frame_size", errors, true)
		var pivot := _int_pair(character.get("pivot"), "character pivot", errors, false)
		var atlas_id := ""
		for candidate: String in atlases:
			if str(atlases[candidate].path) == atlas_path:
				atlas_id = candidate
		var role_binding: Dictionary = roles.get(str(contract.role), {})
		if atlas_id.is_empty() or not _file_is(file_index, atlas_path, "image/png") \
				or role_binding.get("kind") != "file" or role_binding.get("path") != atlas_path \
				or frame_size != Vector2i(48, 72) or pivot != Vector2i(24, 67) \
				or atlases.get(atlas_id, {}).get("cell_size") != frame_size:
			errors.append("Pack 1.0 character atlas or geometry is invalid: %s." % contract.id)
		var clips_value: Variant = character.get("clips")
		var clips := {}
		if typeof(clips_value) != TYPE_ARRAY:
			errors.append("Pack 1.0 character clips must be an array.")
			continue
		for item: Variant in clips_value:
			var clip := _dict(item, "character clip", errors)
			_require_keys(clip, ["id", "action", "direction", "frames"], "character clip", errors)
			var clip_id := str(clip.get("id", ""))
			var action := str(clip.get("action", ""))
			var direction := str(clip.get("direction", ""))
			var frames_value: Variant = clip.get("frames")
			if clip_id != "%s.%s" % [action, direction] or clips.has(clip_id) \
					or action not in contract.actions or direction not in DIRECTIONS \
					or typeof(frames_value) != TYPE_ARRAY or frames_value.size() < 2 \
					or frames_value.size() > 64:
				errors.append("Pack 1.0 character clip is invalid: %s." % clip_id)
				continue
			var frame_origins := {}
			var frames: Array = []
			for frame_value: Variant in frames_value:
				var frame := _dict(frame_value, "character frame", errors)
				_require_keys(frame, ["x", "y", "duration_ms", "provenance"], "character frame", errors)
				var x := int(frame.get("x", -1))
				var y := int(frame.get("y", -1))
				var key := "%d,%d" % [x, y]
				var atlas_size: Vector2i = image_sizes.get(atlas_path, Vector2i.ZERO)
				if not _integer(frame.get("x")) or not _integer(frame.get("y")) \
						or x < 0 or y < 0 or x % 48 != 0 or y % 72 != 0 \
						or x + 48 > atlas_size.x or y + 72 > atlas_size.y \
						or not _integer(frame.get("duration_ms")) \
						or int(frame.get("duration_ms", 0)) < 16 \
						or int(frame.get("duration_ms", 0)) > 10000 \
						or str(frame.get("provenance", "")) not in FRAME_PROVENANCE \
						or frame_origins.has(key):
					errors.append("Pack 1.0 character frame is invalid: %s." % clip_id)
				frame_origins[key] = true
				frames.append(frame.duplicate(true))
			clips[clip_id] = {
				"id": clip_id, "action": action, "direction": direction, "frames": frames,
			}
		for action: String in contract.actions:
			for direction: String in DIRECTIONS:
				if not clips.has("%s.%s" % [action, direction]):
					errors.append("Required Pack 1.0 clip is absent: %s/%s.%s." % [contract.id, action, direction])
		output.append({
			"id": str(contract.id), "atlas": atlas_path, "pivot": pivot,
			"frame_size": frame_size, "clips": clips.values(),
		})
	return output


static func _validate_runtime(
	value: Variant,
	pack_root: String,
	file_index: Dictionary,
	roles: Dictionary,
	errors: Array[String],
) -> Dictionary:
	var runtime := _dict(value, "runtime", errors)
	_require_keys(runtime, ["scene", "collision", "navigation", "spawn"], "runtime", errors)
	var paths := {}
	for key: String in ["scene", "collision", "navigation"]:
		var ref := _dict(runtime.get(key), "runtime.%s" % key, errors)
		_require_keys(ref, ["path"], "runtime.%s" % key, errors)
		var path := str(ref.get("path", ""))
		if not _file_is(file_index, path, "application/json"):
			errors.append("Pack 1.0 runtime sidecar is absent: %s." % key)
		paths[key] = path
	for pair: Array in [
		["world.scene", paths.get("scene", "")],
		["world.collision", paths.get("collision", "")],
		["world.navigation", paths.get("navigation", "")],
	]:
		var binding: Dictionary = roles.get(str(pair[0]), {})
		if binding.get("kind") != "file" or binding.get("path") != pair[1]:
			errors.append("Pack 1.0 runtime role does not bind its exact sidecar: %s." % pair[0])
	var spawn := _point(runtime.get("spawn"), "runtime spawn", errors)
	if not errors.is_empty():
		return {}
	var scene := _read_json(pack_root.path_join(paths.scene), errors)
	var collision := _read_json(pack_root.path_join(paths.collision), errors)
	var navigation := _read_json(pack_root.path_join(paths.navigation), errors)
	var canvas := _dict(scene.get("canvas"), "scene.canvas", errors)
	var bounds := Rect2(
		0, 0, float(canvas.get("width", 0)), float(canvas.get("height", 0)),
	)
	if not _integer(canvas.get("width")) or not _integer(canvas.get("height")) \
			or bounds.size.x < 1 or bounds.size.y < 1 or bounds.size.x > 8192 \
			or bounds.size.y > 8192:
		errors.append("Pack 1.0 scene canvas is invalid.")
	var scene_spawn := _point(scene.get("spawn"), "scene spawn", errors)
	if scene_spawn != spawn or not bounds.has_point(spawn):
		errors.append("Pack 1.0 manifest and scene spawn differ or are out of bounds.")
	var placements: Variant = scene.get("placements")
	if typeof(placements) != TYPE_ARRAY or placements.is_empty() or placements.size() > 512:
		errors.append("Pack 1.0 scene placements are invalid.")
	else:
		var ids := {}
		for item: Variant in placements:
			var placement := _dict(item, "placement", errors)
			_require_keys(placement, ["id", "role", "x", "y"], "placement", errors)
			var id := str(placement.get("id", ""))
			var point := Vector2(float(placement.get("x", -1)), float(placement.get("y", -1)))
			if not _safe_id(id) or ids.has(id) or not roles.has(str(placement.get("role", ""))) \
					or not bounds.has_point(point):
				errors.append("Pack 1.0 placement is invalid: %s." % id)
			ids[id] = true
	var collision_bounds := _rect(collision.get("bounds"), "collision bounds", errors)
	if Rect2(collision_bounds) != bounds:
		errors.append("Pack 1.0 collision bounds differ from scene canvas.")
	var solids := _validate_rect_array(collision.get("solids"), bounds, "collision solid", errors)
	var nodes: Variant = navigation.get("nodes")
	var edges: Variant = navigation.get("edges")
	var graph_nodes := {}
	if typeof(nodes) != TYPE_ARRAY or nodes.is_empty() or nodes.size() > 512:
		errors.append("Pack 1.0 navigation nodes are invalid.")
	else:
		for item: Variant in nodes:
			var node := _dict(item, "navigation node", errors)
			_require_keys(node, ["id", "x", "y"], "navigation node", errors)
			var id := str(node.get("id", ""))
			var point := Vector2(float(node.get("x", -1)), float(node.get("y", -1)))
			if not _safe_id(id) or graph_nodes.has(id) or not bounds.has_point(point):
				errors.append("Pack 1.0 navigation node is invalid: %s." % id)
			graph_nodes[id] = node.duplicate(true)
	var graph_edges: Array = []
	if typeof(edges) != TYPE_ARRAY or edges.is_empty() or edges.size() > 1024:
		errors.append("Pack 1.0 navigation edges are invalid.")
	else:
		for item: Variant in edges:
			var edge := _dict(item, "navigation edge", errors)
			_require_keys(edge, ["from", "to"], "navigation edge", errors)
			if not graph_nodes.has(str(edge.get("from", ""))) or not graph_nodes.has(str(edge.get("to", ""))):
				errors.append("Pack 1.0 navigation edge is dangling.")
			graph_edges.append(edge.duplicate(true))
	if not graph_nodes.has("spawn") or not graph_nodes.has("exit") \
			or Vector2(graph_nodes.get("spawn", {}).get("x", -1), graph_nodes.get("spawn", {}).get("y", -1)) != spawn \
			or not _reachable("spawn", "exit", graph_edges):
		errors.append("Pack 1.0 navigation requires a reachable spawn-to-exit route.")
	return {
		"scene": {"placements": placements, "canvas": canvas},
		"collision": {"bounds": collision_bounds, "solids": solids},
		"navigation": {"nodes": graph_nodes.values(), "edges": graph_edges},
		"bounds": bounds,
		"spawn": spawn,
	}


static func _add_collision(root: Node2D, collision: Dictionary) -> void:
	var collision_root := Node2D.new()
	collision_root.name = "WorldCollision"
	root.add_child(collision_root)
	collision_root.owner = root
	for solid: Dictionary in collision.solids:
		var body := StaticBody2D.new()
		body.name = str(solid.id).to_pascal_case()
		var shape_node := CollisionShape2D.new()
		var shape := RectangleShape2D.new()
		shape.size = solid.rect.size
		shape_node.shape = shape
		body.position = solid.rect.position + solid.rect.size * 0.5
		body.add_child(shape_node)
		collision_root.add_child(body)
		body.owner = root
		shape_node.owner = root
	var hazards := Node2D.new()
	hazards.name = "Hazards"
	root.add_child(hazards)
	hazards.owner = root


static func _add_navigation(root: Node2D, navigation: Dictionary) -> void:
	var region := NavigationRegion2D.new()
	region.name = "WorldNavigation"
	var polygon := NavigationPolygon.new()
	var bounds: Rect2 = root.get_meta("mapsoo_bounds")
	polygon.vertices = PackedVector2Array([
		bounds.position, Vector2(bounds.end.x, bounds.position.y),
		bounds.end, Vector2(bounds.position.x, bounds.end.y),
	])
	polygon.add_polygon(PackedInt32Array([0, 1, 2, 3]))
	region.navigation_polygon = polygon
	root.add_child(region)
	region.owner = root
	var traversal := Node2D.new()
	traversal.name = "WorldTraversal"
	traversal.set_meta("mapsoo_edges", navigation.edges)
	traversal.set_meta("mapsoo_exit_node_id", "exit")
	root.add_child(traversal)
	traversal.owner = root
	for node: Dictionary in navigation.nodes:
		var marker := Marker2D.new()
		marker.name = str(node.id).to_pascal_case()
		marker.position = Vector2(node.x, node.y)
		marker.set_meta("mapsoo_id", node.id)
		marker.set_meta("mapsoo_kind", node.id)
		traversal.add_child(marker)
		marker.owner = root


static func _add_characters(
	root: Node2D,
	actors: Node2D,
	prepared: Dictionary,
	positions: Dictionary,
) -> void:
	for character: Dictionary in prepared.pack10_characters:
		var actor := CharacterBody2D.new()
		actor.name = "Player" if character.id == "player" else "Npc"
		actor.position = positions.get(
			"character.player.atlas" if character.id == "player" else "character.npc.atlas",
			prepared.pack10_spawn,
		)
		actor.set_meta("mapsoo_character_id", character.id)
		if character.id == "player":
			actor.set_script(PlayerController)
			actor.set("world_bounds", prepared.pack10_bounds)
			actor.set("movement_bounds", prepared.pack10_bounds)
			actor.set("spawn_position", prepared.pack10_spawn)
		var visual := AnimatedSprite2D.new()
		visual.name = "Visual"
		visual.sprite_frames = _sprite_frames(character, prepared.textures[character.atlas])
		visual.animation = "idle_near"
		visual.offset = -Vector2(character.pivot)
		visual.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		actor.add_child(visual)
		var collision := CollisionShape2D.new()
		var capsule := CapsuleShape2D.new()
		capsule.radius = 7
		capsule.height = 26
		collision.shape = capsule
		collision.position = Vector2(0, -13)
		actor.add_child(collision)
		if character.id == "player":
			var camera := Camera2D.new()
			camera.name = "Camera2D"
			actor.add_child(camera)
		actors.add_child(actor)
		actor.owner = root
		visual.owner = root
		collision.owner = root
		for child: Node in actor.get_children():
			child.owner = root
	var spawn_marker := Marker2D.new()
	spawn_marker.name = "PlayerSpawn"
	spawn_marker.position = prepared.pack10_spawn
	root.add_child(spawn_marker)
	spawn_marker.owner = root


static func _sprite_frames(character: Dictionary, texture: Texture2D) -> SpriteFrames:
	var result := SpriteFrames.new()
	result.remove_animation("default")
	for clip: Dictionary in character.clips:
		var animation_name := str(clip.id).replace(".", "_")
		result.add_animation(animation_name)
		result.set_animation_loop(animation_name, clip.action not in ["interact", "talk"])
		var total_ms := 0
		for frame: Dictionary in clip.frames:
			total_ms += int(frame.duration_ms)
		var fps: float = 1000.0 * float(clip.frames.size()) / maxf(1.0, float(total_ms))
		result.set_animation_speed(animation_name, fps)
		for frame: Dictionary in clip.frames:
			var atlas := AtlasTexture.new()
			atlas.atlas = texture
			atlas.region = Rect2(frame.x, frame.y, character.frame_size.x, character.frame_size.y)
			atlas.filter_clip = true
			result.add_frame(animation_name, atlas, float(frame.duration_ms) / (1000.0 / fps))
	return result


static func _binding_texture(prepared: Dictionary, binding: Dictionary) -> Texture2D:
	if binding.kind == "file":
		return prepared.textures.get(str(binding.path))
	var atlas: Dictionary = prepared.pack10_atlases.get(str(binding.atlas), {})
	if atlas.is_empty():
		return null
	var texture := AtlasTexture.new()
	texture.atlas = prepared.textures.get(str(atlas.path))
	texture.region = binding.region
	texture.filter_clip = true
	return texture


static func _actor_has_clips(actor: CharacterBody2D, actions: Array) -> bool:
	if actor == null:
		return false
	var visual := actor.get_node_or_null("Visual") as AnimatedSprite2D
	if visual == null or visual.sprite_frames == null:
		return false
	for action: String in actions:
		for direction: String in DIRECTIONS:
			var id := "%s_%s" % [action, direction]
			if not visual.sprite_frames.has_animation(id) \
					or visual.sprite_frames.get_frame_count(id) < 2:
				return false
	return true


static func _scan_forbidden_source_fields(value: Variant, errors: Array[String]) -> void:
	if typeof(value) == TYPE_ARRAY:
		for child: Variant in value:
			_scan_forbidden_source_fields(child, errors)
	elif typeof(value) == TYPE_DICTIONARY:
		for key: Variant in value:
			if str(key) in FORBIDDEN_SOURCE_KEYS:
				errors.append("Pack 1.0 forbids source-reference and raw-prompt fields.")
			_scan_forbidden_source_fields(value[key], errors)


static func _forbidden_text(value: String) -> bool:
	var lower := value.to_lower()
	if lower.contains("http://") or lower.contains("https://") or lower.contains("file://") \
			or lower.contains("www.") or lower.contains("shader_type") \
			or lower.contains("extends node") or lower.contains("<script") \
			or value.contains("\\"):
		return true
	var absolute := RegEx.new()
	if absolute.compile("(^|[^A-Za-z0-9])[A-Za-z]:/") == OK and absolute.search(value) != null:
		return true
	for segment: String in value.split("/", true):
		if segment == "..":
			return true
	return false


static func _validate_exact_inventory(pack_root: String, file_index: Dictionary, errors: Array[String]) -> void:
	var actual: Array[String] = []
	_collect_files(ProjectSettings.globalize_path(pack_root), "", actual)
	actual.sort()
	var expected: Array[String] = ["mapsoo.manifest.json"]
	for key: Variant in file_index:
		expected.append(str(key))
	expected.sort()
	if actual != expected:
		errors.append("Pack 1.0 directory must contain exactly the manifest-declared files.")


static func _collect_files(directory_path: String, prefix: String, output: Array[String]) -> void:
	var directory := DirAccess.open(directory_path)
	if directory == null:
		return
	for file: String in directory.get_files():
		output.append(prefix.path_join(file) if not prefix.is_empty() else file)
	for child: String in directory.get_directories():
		_collect_files(
			directory_path.path_join(child),
			prefix.path_join(child) if not prefix.is_empty() else child,
			output,
		)


static func _load_png(path: String) -> Dictionary:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		return {"ok": false, "image": null}
	var image := Image.new()
	var error := image.load_png_from_buffer(bytes)
	return {"ok": error == OK and not image.is_empty(), "image": image}


static func _texture(image: Image) -> PortableCompressedTexture2D:
	var texture := PortableCompressedTexture2D.new()
	texture.keep_compressed_buffer = true
	texture.create_from_image(image, PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS)
	return texture


static func _read_json(path: String, errors: Array[String]) -> Dictionary:
	if not FileAccess.file_exists(path):
		errors.append("Pack 1.0 JSON is absent: %s." % path)
		return {}
	var parser := JSON.new()
	if parser.parse(FileAccess.get_file_as_string(path)) != OK \
			or typeof(parser.data) != TYPE_DICTIONARY:
		errors.append("Pack 1.0 JSON is invalid: %s." % path)
		return {}
	return parser.data as Dictionary


static func _validate_rect_array(value: Variant, bounds: Rect2, label: String, errors: Array[String]) -> Array:
	var output: Array = []
	if typeof(value) != TYPE_ARRAY or value.is_empty() or value.size() > 512:
		errors.append("Pack 1.0 %s inventory is invalid." % label)
		return output
	for item: Variant in value:
		var record := _dict(item, label, errors)
		_require_keys(record, ["id", "x", "y", "width", "height"], label, errors)
		var rect := Rect2(
			float(record.get("x", -1)), float(record.get("y", -1)),
			float(record.get("width", -1)), float(record.get("height", -1)),
		)
		if not _safe_id(str(record.get("id", ""))) or rect.size.x <= 0 \
				or rect.size.y <= 0 or not bounds.encloses(rect):
			errors.append("Pack 1.0 %s is invalid." % label)
		output.append({"id": str(record.get("id", "")), "rect": rect})
	return output


static func _reachable(start: String, target: String, edges: Array) -> bool:
	var reached := {start: true}
	var changed := true
	while changed:
		changed = false
		for edge: Dictionary in edges:
			if reached.has(str(edge.from)) and not reached.has(str(edge.to)):
				reached[str(edge.to)] = true
				changed = true
	return reached.has(target)


static func _file_is(file_index: Dictionary, path: String, media_type: String) -> bool:
	return file_index.has(path) and file_index[path].get("media_type") == media_type


static func _dict(value: Variant, label: String, errors: Array[String]) -> Dictionary:
	if typeof(value) != TYPE_DICTIONARY:
		errors.append("%s must be an object." % label)
		return {}
	return value


static func _require_keys(value: Dictionary, expected: Array, label: String, errors: Array[String]) -> void:
	var actual := value.keys()
	actual.sort()
	var canonical := expected.duplicate()
	canonical.sort()
	if actual != canonical:
		errors.append("%s must contain exactly: %s." % [label, ", ".join(expected)])


static func _int_pair(value: Variant, label: String, errors: Array[String], positive: bool) -> Vector2i:
	if typeof(value) != TYPE_ARRAY or value.size() != 2 \
			or not _integer(value[0]) or not _integer(value[1]) \
			or (positive and (int(value[0]) < 1 or int(value[1]) < 1)):
		errors.append("%s must contain two bounded integers." % label)
		return Vector2i.ZERO
	return Vector2i(int(value[0]), int(value[1]))


static func _point(value: Variant, label: String, errors: Array[String]) -> Vector2:
	var point := _dict(value, label, errors)
	_require_keys(point, ["x", "y"], label, errors)
	if not _number(point.get("x")) or not _number(point.get("y")):
		errors.append("%s coordinates must be finite numbers." % label)
	return Vector2(float(point.get("x", -1)), float(point.get("y", -1)))


static func _rect(value: Variant, label: String, errors: Array[String]) -> Rect2i:
	var rect := _dict(value, label, errors)
	_require_keys(rect, ["x", "y", "width", "height"], label, errors)
	for key: String in ["x", "y", "width", "height"]:
		if not _integer(rect.get(key)):
			errors.append("%s values must be integers." % label)
	return Rect2i(
		int(rect.get("x", -1)), int(rect.get("y", -1)),
		int(rect.get("width", -1)), int(rect.get("height", -1)),
	)


static func _number(value: Variant) -> bool:
	return (typeof(value) == TYPE_INT or typeof(value) == TYPE_FLOAT) and is_finite(float(value))


static func _integer(value: Variant) -> bool:
	return typeof(value) == TYPE_INT \
		or (typeof(value) == TYPE_FLOAT and is_finite(value) and value == floor(value))


static func _safe_id(value: String) -> bool:
	var pattern := RegEx.new()
	return value.length() <= 120 \
		and pattern.compile("^[a-z0-9]+(?:-[a-z0-9]+)*$") == OK \
		and pattern.search(value) != null


static func _semantic_version(value: String) -> bool:
	var pattern := RegEx.new()
	return pattern.compile("^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$") == OK \
		and pattern.search(value) != null


static func _sha256(value: String) -> bool:
	var pattern := RegEx.new()
	return pattern.compile("^[a-f0-9]{64}$") == OK and pattern.search(value) != null
