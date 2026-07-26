# Godot importer smoke tests

`run-smoke.ps1` generates and tests schemas `0.1.0` through `0.5.0` in isolated Godot processes, covering historical import, playable terrain, semantic places, exterior structures, and the Alpha.7 multi-world release binding:

`import_pack10_controlled_smoke.gd` independently exercises the Pack
`1.0.0-draft.1` routed importer. It materializes neutral procedural public,
internal-review, and private fixtures; proves explicit caller grants for both
non-public modes; reloads the generated scene; and rejects scripts, shaders,
URLs, absolute paths, and traversal paths. CI runs it with Godot 4.3 and 4.7
on Linux and Windows.

1. generate a deterministic PNG/JSON/manifest fixture;
2. let the editor import the new PNG resources;
3. call `MapsooPackImporter.import_pack()` and validate the resulting resources.

The schema `0.2.0` contract additionally proves:

- Ground/Water/Roads/Props scene nodes with z-index 0/1/2/3;
- 35 explicit atlas tiles, including all 16 Water and 16 Roads N/E/S/W masks;
- two independent `TERRAIN_MODE_MATCH_SIDES` TerrainSets whose peering bits match the manifest;
- one `world-blocking` physics layer/mask 1, full-cell Water polygons, and no Ground/Road collision;
- six hyphen-named prop sprite definitions and exact explicit tile-ID placement;
- fail-closed rejection of missing Water collision and terrain tiles used in the wrong layer;
- `created → unchanged` with identical bytes and mtimes.

The schema `0.3.0` contract additionally proves exact `runtime.places` and schema hash binding; strict sidecar/World Spec projection; unique IDs/cells, stable order, kind/sprite mapping, walkability, placement, bounds, and pixel-center checks; stable `Place_0000`-style `Marker2D` nodes with queryable metadata and places-atlas icons; and fail-closed re-import preservation after a managed-scene edit.

The positive contract covers `TileMapLayer`, `TileSetAtlasSource`, stable source/alternative IDs and atlas coordinates, exact non-empty cell and prop counts, nearest filtering, `AtlasTexture.filter_clip`, metadata, and loadable `.tres`/`.tscn` files.

The negative contract covers traversal, backslash, missing-file, SHA-256 mismatch, nonstandard empty-tile IDs, unsupported collision, oversized PNG-header, and cumulative decoded-pixel-budget manifests. Every failure must return actionable errors and leave no partial Godot resources.

The re-import transaction contract additionally proves:

- clean first import → `created` with a valid ownership state file;
- identical manifest → true `unchanged` with identical bytes and mtimes;
- a valid changed map/TileSet → `updated` with 64 cells and 3 props;
- edited resource, extra file, missing file, corrupt state, and state-less legacy directory → `conflict` without overwriting;
- validation failure against an existing clean import leaves all three managed files unchanged;
- a changed manifest byte invalidates the parsed source snapshot before commit;
- a deterministic promote failure restores the complete previous directory;
- a deterministic edit after `final → backup` returns `conflict`, restores that edit, and leaves no backup/staging residue.

The exact-pack CLI imports a fixed candidate or published release pack twice and requires `created → unchanged`. For schemas `0.2.0` through `0.5.0`, it also requires Water/Roads layers, two TerrainSets, one physics layer, and the documented z-order. Schemas `0.3.0` through `0.5.0` check every stable marker against the validated places sidecar; schemas `0.4.0`/`0.5.0` additionally check every structure sprite, atlas region, metadata field, and place linkage. Trusted `--expected-*` arguments bind ID/schema/cell/prop/place/structure counts, and `--check-conflict=true` proves an edited managed scene is rejected without changing its bytes. PR and tag CI are configured to run the synthetic and exact-pack contracts on Linux and Windows with Godot 4.3 and 4.7. Windows archive SHA-512 values are pinned from the official Godot release checksum files.

Alpha.7 CI can pass a trusted three-pack descriptor to `scripts/run-exact-pack-set.ps1`. The descriptor has `schemaVersion: 1` and exactly the IDs `sunny-meadow`, `dustwind-outpost`, and `frostwatch-vale`; each pack record supplies `archiveRoot`, `schemaVersion`, `cellCount`, `propCount`, `placeCount`, and `structureCount`. The runner locates each extracted manifest below the trusted root, invokes the exact CLI with all expectations, and requires `created → unchanged → conflict/preserved` for every pack while reusing one OS/Godot job.

## Playable physics contracts

Pack `0.6.0` and `0.7.0` jobs instantiate the imported world inside a real `SceneTree` and advance physics frames:

- `import_alpha9_playable_smoke.gd` checks four-direction movement, blocked-cell collision, animation, bounds, and camera limits.
- `import_alpha10_playable_smoke.gd` checks solid landing, movement, jump, one-way pass-through and landing, hazard respawn, exit reporting, and camera limits.

These run on Linux and Windows with Godot 4.3 and 4.7. They complement structural importer checks; a node hierarchy by itself is not accepted as playability evidence.

`runtime_shell_smoke.gd` then proves that the reusable main scene rejects unsafe paths, loads a generated farm world, replaces it with a generated side world, and exposes the active scene/profile identity.

`character_profile_runtime_smoke.gd` binds canonical synthetic
`CharacterProfileRevision` bytes and exact PNG atlas bytes to the neutral
player visual in all four world profiles. It proves clip inventory, frame
regions, pivot offset, nearest filtering, display scale, metadata and
idempotent replay, then rejects digest changes, profile/clip mismatch, missing
clips, unsafe paths, corrupted atlas bytes, missing slots and ambiguous slots.
CI runs the contract with Godot 4.3 and 4.7 on Linux and Windows. Use
`pnpm character:runtime:godot` for the local Windows compatibility matrix.
The result is a technical runtime gate, not human-art approval or physical
Raspberry Pi evidence.

`texture_persistence_probe.gd` proves on Godot 4.3 and 4.7 that `keep_compressed_buffer` must be set before `PortableCompressedTexture2D.create_from_image()`. `capture_alpha10_runtime_visual.gd` renders the reloaded Pack 0.7 scene and rejects blank or collapsed frames using conservative color, dominant-color, luminance, edge-density, regional-color, and alpha thresholds.

Run when `godot4` or `godot` is on `PATH` (or `GODOT_BIN` points to the console executable):

```powershell
powershell -ExecutionPolicy Bypass -File godot/tests/run-smoke.ps1
```

Or specify another Godot 4.3+ console binary:

```powershell
powershell -ExecutionPolicy Bypass -File godot/tests/run-smoke.ps1 -GodotConsole C:\path\to\Godot_console.exe
```

Use `-KeepGenerated` to inspect the fixture and generated resources in the editor after the test.

To verify a real browser-exported pack after extracting the ZIP, pass its manifest to the reusable CLI contract:

```powershell
Godot_v4.3-stable_win64_console.exe --headless --path godot `
  --script res://tests/import_pack_cli.gd -- `
  --manifest=C:\absolute\path\to\the-extracted-pack\mapsoo.manifest.json
```

The command imports the pack, reloads the generated `TileSet` and scene, confirms that placed cell/prop counts match, then imports the same manifest again and proves the second operation is an unchanged no-op.
