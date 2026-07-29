extends "res://tests/world_art_runtime_overlay_v1_1_combined_smoke.gd"

const CAPTURE_V1_1_SCRIPT := (
	"res://tests/capture_world_art_runtime_overlay_v1_1.gd"
)
const CAPTURE_V1_1_ROOT := (
	"user://world-art-runtime-overlay-v1-1-capture-smoke"
)
const CAPTURE_MODES_V1_1 := [
	"normal",
	"role-overlay",
	"collision-overlay",
	"spawn-exit",
	"navigation",
]


func _run() -> void:
	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	_remove_tree(ProjectSettings.globalize_path(CAPTURE_V1_1_ROOT))
	for path: String in [TEST_ROOT, CAPTURE_V1_1_ROOT]:
		if DirAccess.make_dir_recursive_absolute(
			ProjectSettings.globalize_path(path)
		) != OK:
			_fail("Unable to create runtime overlay 1.1 capture directory.")
			return
	var captures := 0
	var movies := 0
	var fixture_by_profile := {}
	for profile: String in PROFILES:
		var context := _validated_context(profile, "capture-v1-1")
		if not context.ok:
			_fail(str(context.error))
			return
		var fixture := _build_combined_fixture(context, "capture-v1-1")
		if not fixture.ok:
			_fail(str(fixture.error))
			return
		fixture_by_profile[profile] = {
			"context": context,
			"fixture": fixture,
		}
		var result := _run_capture_v1_1(
			context.fixture.root.path_join("world-layout-plan.json"),
			fixture.manifest_path,
			CAPTURE_V1_1_ROOT.path_join("%s-normal.png" % profile),
			"normal"
		)
		if not result.ok or not _valid_capture_sentinel(result.output, profile, "normal"):
			_fail("%s normal capture failed: %s" % [profile, result])
			return
		captures += 1

	var topdown: Dictionary = fixture_by_profile["topdown-farm"]
	var topdown_context: Dictionary = topdown.context
	var topdown_fixture: Dictionary = topdown.fixture
	for mode: String in CAPTURE_MODES_V1_1:
		if mode == "normal":
			continue
		var movie_path := ""
		if mode in ["spawn-exit", "navigation"]:
			movie_path = ProjectSettings.globalize_path(
				CAPTURE_V1_1_ROOT.path_join("%s.avi" % mode)
			)
		var result := _run_capture_v1_1(
			topdown_context.fixture.root.path_join("world-layout-plan.json"),
			topdown_fixture.manifest_path,
			CAPTURE_V1_1_ROOT.path_join("%s.png" % mode),
			mode,
			movie_path
		)
		if (
			not result.ok
			or not _valid_capture_sentinel(result.output, "topdown-farm", mode)
			or (not movie_path.is_empty() and not _is_avi_v1_1(movie_path))
		):
			_fail("%s evidence capture failed: %s" % [mode, result])
			return
		if (
			mode in ["spawn-exit", "navigation"]
			and not str(result.output).contains("animation=walk_")
		):
			_fail("%s capture did not animate the projected player." % mode)
			return
		if not movie_path.is_empty():
			movies += 1
		captures += 1

	var tamper := _run_capture_v1_1(
		topdown_context.fixture.root.path_join("world-layout-plan.json"),
		topdown_fixture.manifest_path,
		CAPTURE_V1_1_ROOT.path_join("same-count-key-tamper.png"),
		"normal",
		"",
		"same-count-key"
	)
	if (
		tamper.ok
		or not str(tamper.output).contains(
			"Applied binding key inventory differs from the reviewed sidecars."
		)
	):
		_fail("A same-count binding-key substitution was accepted.")
		return

	_remove_tree(ProjectSettings.globalize_path(TEST_ROOT))
	_remove_tree(ProjectSettings.globalize_path(CAPTURE_V1_1_ROOT))
	print((
		"WORLD_ART_RUNTIME_OVERLAY_V1_1_CAPTURE_SMOKE_OK " +
		"profiles=4 modes=5 captures=%d movie_writer=%d " +
		"same_count_key_tamper=1"
	) % [captures, movies])
	quit(0)


func _run_capture_v1_1(
	layout_path: String,
	manifest_path: String,
	output_path: String,
	mode: String,
	movie_path: String = "",
	tamper: String = ""
) -> Dictionary:
	var arguments := [
		"--display-driver",
		"windows",
		"--audio-driver",
		"Dummy",
		"--path",
		ProjectSettings.globalize_path("res://"),
		"--resolution",
		"640x360",
	]
	if not movie_path.is_empty():
		arguments.append_array([
			"--fixed-fps",
			"30",
			"--write-movie",
			movie_path,
		])
	arguments.append_array([
		"--script",
		CAPTURE_V1_1_SCRIPT,
		"--",
		"--layout=%s" % ProjectSettings.globalize_path(layout_path),
		"--overlay-manifest=%s" % ProjectSettings.globalize_path(manifest_path),
		"--output=%s" % ProjectSettings.globalize_path(output_path),
		"--evidence-mode=%s" % mode,
	])
	if not tamper.is_empty():
		arguments.append("--evidence-test-tamper=%s" % tamper)
	var output: Array = []
	var exit_code := OS.execute(
		OS.get_executable_path(),
		arguments,
		output,
		true,
		false
	)
	var output_text := "\n".join(output)
	var png_path := ProjectSettings.globalize_path(output_path)
	var ok := (
		exit_code == 0
		and output_text.contains("WORLD_ART_RUNTIME_OVERLAY_V1_1_CAPTURE_OK ")
		and FileAccess.file_exists(png_path)
		and not FileAccess.get_sha256(png_path).is_empty()
	)
	return {
		"ok": ok,
		"exit_code": exit_code,
		"output": output_text,
		"error": "" if ok else "exit=%d output=%s" % [exit_code, output_text],
	}


func _valid_capture_sentinel(
	output: String,
	profile: String,
	mode: String
) -> bool:
	var sentinel := ""
	for line: String in output.split("\n"):
		if line.begins_with("WORLD_ART_RUNTIME_OVERLAY_V1_1_CAPTURE_OK "):
			sentinel = line.strip_edges()
	if (
		sentinel.is_empty()
		or not sentinel.contains("profile=%s mode=%s " % [profile, mode])
	):
		return false
	for field: String in [
		"projection_id",
		"placement_plan_id",
		"placement_map_id",
		"backgrounds",
		"props",
		"structures",
		"effects",
		"depth_planes",
		"catalog_assets",
		"bound_catalog_assets",
		"runtime_bindings",
		"applied_runtime_bindings",
		"bindings_sha256",
		"applied_bindings_sha256",
	]:
		if not sentinel.contains(" %s=" % field):
			return false
	for expected: String in [
		"backgrounds=1",
		"props=2",
		"structures=1",
		"effects=1",
		"depth_planes=2",
	]:
		if not sentinel.contains(" %s " % expected):
			return false
	var digest_regex := RegEx.new()
	if digest_regex.compile(
		"bindings_sha256=([a-f0-9]{64}) " +
		"applied_bindings_sha256=([a-f0-9]{64})"
	) != OK:
		return false
	var digest_match := digest_regex.search(sentinel)
	if (
		digest_match == null
		or digest_match.get_string(1) != digest_match.get_string(2)
	):
		return false
	var count_regex := RegEx.new()
	if count_regex.compile(
		"runtime_bindings=([1-9][0-9]*) applied_runtime_bindings=([1-9][0-9]*)"
	) != OK:
		return false
	var count_match := count_regex.search(sentinel)
	return (
		count_match != null
		and count_match.get_string(1) == count_match.get_string(2)
	)


func _is_avi_v1_1(path: String) -> bool:
	if not FileAccess.file_exists(path):
		return false
	var bytes := FileAccess.get_file_as_bytes(path)
	return (
		bytes.size() >= 12
		and bytes.slice(0, 4).get_string_from_ascii() == "RIFF"
		and bytes.slice(8, 12).get_string_from_ascii() == "AVI "
	)
