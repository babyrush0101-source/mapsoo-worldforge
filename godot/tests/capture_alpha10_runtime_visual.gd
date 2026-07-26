extends SceneTree

const Importer = preload("res://addons/mapsoo_importer/mapsoo_pack_importer.gd")
const OUTPUT_ROOT := "res://mapsoo_imports"


func _init() -> void:
	call_deferred("_capture")


func _capture() -> void:
	var manifest_path := _argument_value("--manifest=")
	var output_path := _argument_value("--output=")
	if manifest_path.is_empty() or output_path.is_empty():
		_fail("Pass --manifest and --output.")
		return
	var result: Dictionary = Importer.import_pack(manifest_path, OUTPUT_ROOT)
	if result.get("ok", false) != true:
		_fail("Pack import failed: %s" % result)
		return
	var packed := ResourceLoader.load(str(result.get("scene_path", "")), "PackedScene", ResourceLoader.CACHE_MODE_IGNORE) as PackedScene
	if packed == null:
		_fail("Generated scene is not loadable.")
		return
	var world := packed.instantiate()
	root.add_child(world)
	for _frame in 5:
		await process_frame
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	if image == null or image.is_empty():
		_fail("Rendered viewport returned no image.")
		return
	var metrics := _visual_metrics(image)
	var metrics_error := _metrics_error(metrics)
	if not metrics_error.is_empty():
		_fail("Rendered viewport failed visual QA: %s metrics=%s" % [metrics_error, metrics])
		return
	var error := image.save_png(output_path)
	if error != OK:
		_fail("Unable to save runtime visual: %s." % error_string(error))
		return
	print(
		"MAPSOO_ALPHA10_RUNTIME_VISUAL_OK path=%s width=%d height=%d colors=%d dominant=%.4f luminance_range=%.2f p95p05=%.2f edges=%.5f top_colors=%d bottom_colors=%d alpha=%.4f" % [
			output_path,
			image.get_width(),
			image.get_height(),
			metrics.colors,
			metrics.dominant,
			metrics.luminance_range,
			metrics.p95p05,
			metrics.edges,
			metrics.top_colors,
			metrics.bottom_colors,
			metrics.alpha,
		]
	)
	world.queue_free()
	quit(0)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _visual_metrics(image: Image) -> Dictionary:
	var width := image.get_width()
	var height := image.get_height()
	var stride := 4
	var buckets := {}
	var top_buckets := {}
	var bottom_buckets := {}
	var luminances: Array[float] = []
	var alpha_samples := 0
	var edge_samples := 0
	var edges := 0
	for y: int in range(0, height, stride):
		for x: int in range(0, width, stride):
			var color := image.get_pixel(x, y)
			var key := _quantized_key(color)
			buckets[key] = int(buckets.get(key, 0)) + 1
			if y < int(height * 0.4):
				top_buckets[key] = true
			if y >= int(height * 0.7):
				bottom_buckets[key] = true
			var luminance := _luminance(color)
			luminances.append(luminance)
			if color.a >= 0.99:
				alpha_samples += 1
			if x + stride < width:
				edge_samples += 1
				if absf(luminance - _luminance(image.get_pixel(x + stride, y))) >= 28.0:
					edges += 1
			if y + stride < height:
				edge_samples += 1
				if absf(luminance - _luminance(image.get_pixel(x, y + stride))) >= 28.0:
					edges += 1
	luminances.sort()
	var sample_count := luminances.size()
	var dominant_count := 0
	for count: Variant in buckets.values():
		dominant_count = maxi(dominant_count, int(count))
	var p05 := luminances[int(floor(float(sample_count - 1) * 0.05))]
	var p95 := luminances[int(floor(float(sample_count - 1) * 0.95))]
	return {
		"colors": buckets.size(),
		"dominant": float(dominant_count) / float(sample_count),
		"luminance_range": luminances[-1] - luminances[0],
		"p95p05": p95 - p05,
		"edges": float(edges) / float(edge_samples),
		"top_colors": top_buckets.size(),
		"bottom_colors": bottom_buckets.size(),
		"alpha": float(alpha_samples) / float(sample_count),
	}


func _metrics_error(metrics: Dictionary) -> String:
	if int(metrics.colors) < 12:
		return "fewer than 12 quantized colors"
	if float(metrics.dominant) > 0.90:
		return "one color covers more than 90 percent of the frame"
	if float(metrics.luminance_range) < 64.0:
		return "luminance range is below 64"
	if float(metrics.p95p05) < 32.0:
		return "robust luminance contrast is below 32"
	if float(metrics.edges) < 0.0015:
		return "edge density is below 0.0015"
	if int(metrics.top_colors) < 4 or int(metrics.bottom_colors) < 4:
		return "top or bottom world region has fewer than four colors"
	if float(metrics.alpha) < 0.99:
		return "less than 99 percent of sampled pixels are opaque"
	return ""


func _quantized_key(color: Color) -> int:
	return (
		(int(round(color.r * 15.0)) << 12)
		| (int(round(color.g * 15.0)) << 8)
		| (int(round(color.b * 15.0)) << 4)
		| int(round(color.a * 15.0))
	)


func _luminance(color: Color) -> float:
	return (color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722) * 255.0


func _fail(message: String) -> void:
	push_error("MAPSOO_ALPHA10_RUNTIME_VISUAL_FAILURE: %s" % message)
	quit(1)
