extends SceneTree

## Trusted build-host helper. The Node CLI creates and validates the inventory;
## this script delegates the actual pack encoding to Godot's PCKPacker.


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	var inventory_path := _argument_value("--inventory=")
	var output_path := _argument_value("--output=")
	if inventory_path.is_empty() or output_path.is_empty():
		_fail("Pass --inventory=<absolute-json-path> and --output=<absolute-pck-path>.")
		return
	var inventory_file := FileAccess.open(inventory_path, FileAccess.READ)
	if inventory_file == null or inventory_file.get_length() < 2 \
			or inventory_file.get_length() > 1024 * 1024:
		_fail("Inventory is unavailable or outside its byte limit.")
		return
	var parsed: Variant = JSON.parse_string(inventory_file.get_as_text())
	if typeof(parsed) != TYPE_ARRAY or parsed.is_empty():
		_fail("Inventory must be a non-empty JSON array.")
		return
	var packer := PCKPacker.new()
	var start_error := packer.pck_start(output_path, 32, "0".repeat(64))
	if start_error != OK:
		_fail("PCK start failed with error %d." % start_error)
		return
	var previous_target := ""
	for raw_record: Variant in parsed:
		if typeof(raw_record) != TYPE_DICTIONARY:
			_fail("Inventory record must be an object.")
			return
		var record: Dictionary = raw_record
		if record.size() != 2 or not record.has("source") or not record.has("target"):
			_fail("Inventory record has unexpected fields.")
			return
		var source := str(record.source)
		var target := str(record.target)
		if source.is_empty() or not target.begins_with("res://") \
				or target.contains("..") or target.contains("\\") \
				or (not previous_target.is_empty() and target <= previous_target):
			_fail("Inventory paths are unsafe or not strictly sorted.")
			return
		if not FileAccess.file_exists(source):
			_fail("Inventory source is missing.")
			return
		var add_error := packer.add_file(target, source)
		if add_error != OK:
			_fail("PCK add failed with error %d." % add_error)
			return
		previous_target = target
	var flush_error := packer.flush(false)
	if flush_error != OK:
		_fail("PCK flush failed with error %d." % flush_error)
		return
	print("MAPSOO_WORLD_RUNNER_PCK_BUILD_OK files=%d" % parsed.size())
	quit(0)


func _argument_value(prefix: String) -> String:
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with(prefix):
			return argument.trim_prefix(prefix)
	return ""


func _fail(message: String) -> void:
	push_error("MAPSOO_WORLD_RUNNER_PCK_BUILD_FAILURE: %s" % message)
	quit(1)
