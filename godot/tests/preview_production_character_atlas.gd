extends SceneTree

const FRAME_SIZE := Vector2i(128, 128)
const ATLAS_SIZE := Vector2i(1024, 768)
const ATLAS_COLUMNS := 8
const ATLAS_ROWS := 6
const RUNTIME_FRAME_COUNT := 28
const PIVOT := Vector2i(64, 120)
const MINIMUM_VISIBLE_HEIGHT := 72
const MAXIMUM_VISIBLE_HEIGHT := 96
const MAXIMUM_FOOT_ERROR := 2
const PREVIEW_SIZE := Vector2i(1024, 512)
const PREVIEW_SCALE := 1.0


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var atlas_path := _argument_value("--atlas=")
	var output_path := _argument_value("--output=")
	if atlas_path.is_empty() or output_path.is_empty():
		_fail("Pass --atlas and --output.")
		return
	if not FileAccess.file_exists(atlas_path):
		_fail("Atlas does not exist: %s" % atlas_path)
		return
	var bytes := FileAccess.get_file_as_bytes(atlas_path)
	var image := Image.new()
	var error := image.load_png_from_buffer(bytes)
	if error != OK or image.get_size() != ATLAS_SIZE:
		_fail("Atlas must decode as a 1024x768 PNG.")
		return

	var visible_total := 0
	var minimum_visible_height := 100000
	var maximum_visible_height := 0
	var maximum_foot_error := 0
	for frame_index in RUNTIME_FRAME_COUNT:
		var column := frame_index % ATLAS_COLUMNS
		var row := frame_index / ATLAS_COLUMNS
		var metrics := _frame_metrics(
			image,
			Rect2i(column * FRAME_SIZE.x, row * FRAME_SIZE.y, FRAME_SIZE.x, FRAME_SIZE.y)
		)
		var visible_height := int(metrics.max_y) - int(metrics.min_y) + 1
		var foot_error := PIVOT.y - (int(metrics.max_y) + 1)
		if int(metrics.visible_pixels) < 64:
			_fail("Frame %d is empty or too small." % frame_index)
			return
		if int(metrics.green_spill_pixels) != 0:
			_fail("Frame %d contains chroma spill." % frame_index)
			return
		if visible_height < MINIMUM_VISIBLE_HEIGHT or visible_height > MAXIMUM_VISIBLE_HEIGHT:
			_fail("Frame %d visible height %d is outside %d-%d." % [
				frame_index, visible_height, MINIMUM_VISIBLE_HEIGHT, MAXIMUM_VISIBLE_HEIGHT,
			])
			return
		if foot_error < 0 or foot_error > MAXIMUM_FOOT_ERROR:
			_fail("Frame %d foot error %d exceeds %d." % [
				frame_index, foot_error, MAXIMUM_FOOT_ERROR,
			])
			return
		visible_total += int(metrics.visible_pixels)
		minimum_visible_height = mini(minimum_visible_height, visible_height)
		maximum_visible_height = maxi(maximum_visible_height, visible_height)
		maximum_foot_error = maxi(maximum_foot_error, foot_error)
	for frame_index in range(RUNTIME_FRAME_COUNT, ATLAS_COLUMNS * ATLAS_ROWS):
		var column := frame_index % ATLAS_COLUMNS
		var row := frame_index / ATLAS_COLUMNS
		if int(_frame_metrics(
			image,
			Rect2i(column * FRAME_SIZE.x, row * FRAME_SIZE.y, FRAME_SIZE.x, FRAME_SIZE.y)
		).visible_pixels) != 0:
			_fail("Reserved frame %d must remain transparent." % frame_index)
			return

	var preview := Image.create(PREVIEW_SIZE.x, PREVIEW_SIZE.y, false, Image.FORMAT_RGBA8)
	preview.fill(Color("#172235"))
	var atlas_texture := ImageTexture.create_from_image(image)
	var display_size := Vector2i(
		roundi(FRAME_SIZE.x * PREVIEW_SCALE),
		roundi(FRAME_SIZE.y * PREVIEW_SCALE)
	)
	for row in 4:
		var row_top := row * FRAME_SIZE.y
		var floor_y := row_top + roundi(PIVOT.y * PREVIEW_SCALE)
		preview.fill_rect(Rect2i(10, floor_y, PREVIEW_SIZE.x - 20, 2), Color("#5e7890"))
		for column in ATLAS_COLUMNS:
			var frame_index := row * ATLAS_COLUMNS + column
			if frame_index >= RUNTIME_FRAME_COUNT:
				continue
			var frame_texture := AtlasTexture.new()
			frame_texture.atlas = atlas_texture
			frame_texture.region = Rect2(
				column * FRAME_SIZE.x,
				row * FRAME_SIZE.y,
				FRAME_SIZE.x,
				FRAME_SIZE.y
			)
			var frame_image := frame_texture.get_image()
			if frame_image == null or frame_image.is_empty() or frame_image.get_size() != FRAME_SIZE:
				_fail("Godot AtlasTexture could not resolve frame %d,%d." % [column, row])
				return
			frame_image.resize(display_size.x, display_size.y, Image.INTERPOLATE_NEAREST)
			var destination := Vector2i(
				column * display_size.x,
				row_top
			)
			preview.blend_rect(frame_image, Rect2i(Vector2i.ZERO, display_size), destination)
	var save_error := preview.save_png(output_path)
	if save_error != OK:
		_fail("Unable to save production-character preview: %s" % error_string(save_error))
		return
	var preview_pixels_sha256 := _sha256(preview.get_data())
	print(
		"MAPSOO_PRODUCTION_CHARACTER_GODOT_OK atlas_sha256=%s preview_pixels_sha256=%s frames=%d visible_pixels=%d visible_height=%d-%d foot_error=%d preview=%s" % [
			FileAccess.get_sha256(atlas_path),
			preview_pixels_sha256,
			RUNTIME_FRAME_COUNT,
			visible_total,
			minimum_visible_height,
			maximum_visible_height,
			maximum_foot_error,
			output_path,
		]
	)
	quit(0)


func _frame_metrics(image: Image, region: Rect2i) -> Dictionary:
	var visible_pixels := 0
	var green_spill_pixels := 0
	var min_y := FRAME_SIZE.y
	var max_y := -1
	for y in FRAME_SIZE.y:
		for x in FRAME_SIZE.x:
			var color := image.get_pixel(region.position.x + x, region.position.y + y)
			if color.a < 16.0 / 255.0:
				continue
			visible_pixels += 1
			min_y = mini(min_y, y)
			max_y = maxi(max_y, y)
			if color.g > 96.0 / 255.0 and color.g > color.r * 1.35 and color.g > color.b * 1.35:
				green_spill_pixels += 1
	return {
		"visible_pixels": visible_pixels,
		"green_spill_pixels": green_spill_pixels,
		"min_y": min_y,
		"max_y": max_y,
	}


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _sha256(bytes: PackedByteArray) -> String:
	var context := HashingContext.new()
	context.start(HashingContext.HASH_SHA256)
	context.update(bytes)
	return context.finish().hex_encode()


func _fail(message: String) -> void:
	push_error("MAPSOO_PRODUCTION_CHARACTER_GODOT_FAILURE: %s" % message)
	quit(1)
