extends SceneTree

const OUTPUT_ROOT := "res://tests/.generated/texture-persistence"


func _init() -> void:
	var version := Engine.get_version_info()
	var version_label := "%d.%d" % [int(version.get("major", 0)), int(version.get("minor", 0))]
	var output_dir := OUTPUT_ROOT.path_join(version_label)
	var mkdir_error := DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_dir))
	if mkdir_error != OK:
		_fail("Unable to create probe directory (error %d)." % mkdir_error)
		return

	var source := Image.create(4, 4, false, Image.FORMAT_RGBA8)
	source.fill(Color8(17, 83, 149, 255))
	source.set_pixel(2, 1, Color8(241, 37, 113, 255))
	var source_bytes := source.get_data()

	var default_result := _round_trip(source, output_dir.path_join("default.tres"), false, false)
	var before_result := _round_trip(source, output_dir.path_join("keep-before.tres"), true, false)
	var after_result := _round_trip(source, output_dir.path_join("keep-after.tres"), false, true)
	if not before_result.get("pixels_match", false):
		_fail("keep_compressed_buffer=true before create_from_image did not preserve pixels: %s" % before_result)
		return
	if before_result.get("bytes", PackedByteArray()) != source_bytes:
		_fail("The persisted lossless texture differs from the source RGBA bytes.")
		return

	print(
		"MAPSOO_TEXTURE_PERSISTENCE_PROBE_OK godot=%s default_pixels=%s keep_before_pixels=%s keep_after_pixels=%s default_has_data=%s keep_before_has_data=%s keep_after_has_data=%s" % [
			version_label,
			default_result.get("pixels_match", false),
			before_result.get("pixels_match", false),
			after_result.get("pixels_match", false),
			default_result.get("serialized_data", false),
			before_result.get("serialized_data", false),
			after_result.get("serialized_data", false),
		]
	)
	quit(0)


func _round_trip(source: Image, path: String, keep_before: bool, keep_after: bool) -> Dictionary:
	var texture := PortableCompressedTexture2D.new()
	texture.keep_compressed_buffer = keep_before
	texture.create_from_image(source, PortableCompressedTexture2D.COMPRESSION_MODE_LOSSLESS)
	if keep_after:
		texture.keep_compressed_buffer = true
	var save_error := ResourceSaver.save(texture, path)
	if save_error != OK:
		return {"pixels_match": false, "error": "save error %d" % save_error}
	var serialized := FileAccess.get_file_as_string(path)
	var loaded := ResourceLoader.load(path, "PortableCompressedTexture2D", ResourceLoader.CACHE_MODE_IGNORE) as PortableCompressedTexture2D
	if loaded == null:
		return {"pixels_match": false, "serialized_data": serialized.contains("_data"), "error": "reload failed"}
	var image := loaded.get_image()
	var bytes := PackedByteArray()
	if image != null and not image.is_empty():
		bytes = image.get_data()
	return {
		"pixels_match": bytes == source.get_data(),
		"serialized_data": serialized.contains("_data"),
		"bytes": bytes,
	}


func _fail(message: String) -> void:
	push_error("MAPSOO_TEXTURE_PERSISTENCE_PROBE_FAILURE: %s" % message)
	quit(1)
