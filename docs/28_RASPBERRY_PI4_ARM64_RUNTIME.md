# Raspberry Pi 4B ARM64 runtime

Mapsoo uses one reusable Godot runtime shell. A generated world is a data pack that becomes a verified `.tscn` plus resources on the build machine; the Raspberry Pi does not compile a new application for every world.

## Built artifact

Run:

```bash
pnpm pi4:runtime:build
pnpm pi4:runtime:verify
```

The command requires the official `Godot_v4.3-stable_linux.arm64.zip` under `release/godot-runtimes/`. It verifies the upstream SHA-512, verifies that the contained executable is ELF AArch64, assembles the reusable project shell and four synthetic verified worlds, fixes ZIP timestamps and permissions, and writes:

- `release/pi4-runtime/mapsoo-pi4-arm64-alpha12.zip`;
- `release/pi4-runtime/mapsoo-pi4-arm64-alpha12.zip.json`.

The archive contains no private External Host data, source references, tokens, hostnames or absolute local paths.

## Internal production-art review bundle

An additional controlled bundle can include the current layered-depth production
candidate without describing it as a public Pack 0.9 release:

```bash
pnpm pi4:production-review:build
pnpm pi4:production-review:verify
```

It writes
`release/pi4-runtime/mapsoo-pi4-arm64-alpha12-production-review.zip`, containing
the four synthetic fixtures plus `layered-depth-2d-production-v1`. The current
deterministic archive is 55,678,262 bytes with SHA-256
`484218ec9b1102fba27bba619b2105c7dddeed39208b9e945c66167bb4d0c849`.

This fifth world is explicitly `internal-review`, `UNRELEASED`, and
`standard_pack: false`. It is assembled only from an allowlisted configuration,
trusted public runtime code, and exact JSON/PNG/TSCN hashes. Generated data
cannot add scripts, shaders, URLs, or arbitrary scenes. The bundle is for
controlled device validation only and must not be attached to a public release
before human-art and rights approval.

## Pack 1.0 importer-managed ARM64 review bundle

The complete Pack 1.0 technical candidate has a separate, stronger path. It
uses pinned Godot 4.3 on the build machine to create and test the exact
importer-owned three-file directory that will be staged on the device:

- `neutral-production-runtime-review.world.tscn`;
- `neutral-production-runtime-review.tileset.tres`;
- `mapsoo.import-state.json`.

Run:

```bash
pnpm pi4:pack10-review:prepare
pnpm pi4:pack10-review:build
pnpm pi4:pack10-review:verify
pnpm pi4:pack10-review:godot
```

The prepare command accepts only the Pack 1.0 `internal-review`,
`LicenseRef-UNRELEASED` boundary and only pinned Godot 4.3 serialization. A
second preparation must report `unchanged`. The state binds the source
manifest, importer version, Godot serialization and the exact scene/TileSet
hashes. The builder independently recalculates the state integrity digest and
rejects missing, additional or changed managed files.

The resulting local archive is
`release/pi4-runtime/mapsoo-pi4-arm64-pack10-production-review.zip`. The
current deterministic artifact is 49,489,218 bytes with SHA-256
`2b06b8433d9a4c85ab2952fd65ed8ff695a4c69dd6bfa77c15134dc1202ea591`.
It contains the four synthetic compatibility worlds plus
`neutral-production-runtime-review`. The generated source Pack, model runs and
build workspace are not copied into the ARM64 bundle.

The final command extracts that archive to an isolated directory and loads the
bundled scene directly with local Godot 4.3. It verifies the Pack 1.0 metadata,
two character animation inventories and three runtime props. This proves that
the exact staged scene is self-contained and loadable; it still does not prove
execution or performance on a physical Raspberry Pi.

## Run on Raspberry Pi

Use a 64-bit Raspberry Pi OS image:

```bash
unzip mapsoo-pi4-arm64-alpha12.zip
cd mapsoo-pi4-arm64-alpha12
chmod +x godot run-mapsoo.sh
./run-mapsoo.sh alpha12-godot-smoke-pack
```

Other bundled synthetic worlds:

```bash
./run-mapsoo.sh alpha9-godot-smoke-pack
./run-mapsoo.sh alpha10-godot-smoke-pack
./run-mapsoo.sh alpha11-godot-smoke-pack
```

For the controlled production-review archive only:

```bash
./run-mapsoo.sh layered-depth-2d-production-v1
```

For the Pack 1.0 importer-managed review archive only:

```bash
./run-mapsoo.sh neutral-production-runtime-review
```

To enter a bundled world with an independently reviewed character, copy only
the canonical revision and its declared atlas into:

```text
project/mapsoo_characters/<profile-revision-id>/
  character-profile-revision.json
  character-profile-atlas.png
```

Then launch:

```bash
./run-mapsoo.sh <world-id> <profile-revision-id> <revision-sha256>
```

The launcher accepts a portable revision ID and lowercase canonical SHA-256,
then constructs both fixed `res://mapsoo_characters/` paths itself. It never
accepts an arbitrary filesystem path. The runtime rejects changed bytes,
unsafe paths, wrong profiles, incomplete animation inventories or an
ambiguous player slot before replacing the world's `SpriteFrames`. A character
revision can therefore change without rebuilding the world or the Godot
application.

The project uses Godot's `gl_compatibility` renderer, a 640×360 viewport, nearest texture filtering, bounded cameras, and a limited number of depth planes/lights suitable for an initial Pi 4B trial.

## Adding a newly created world

The shortest controlled path is:

1. generate and freeze the exact Mapsoo pack;
2. import it on the build machine with the matching trusted importer;
3. run profile structural and playable smoke tests;
4. prepare the exact importer-managed scene, TileSet and integrity state with
   the same pinned Godot version used by the runtime;
5. run `pnpm world-runner:pck:build -- ...` against the frozen Pack and that
   exact three-file directory;
6. retain the generated PCK, headless smoke report and build receipt, all bound
   to the exact Pack SHA-256;
7. combine the target-neutral PCK with the separately verified Linux ARM64
   Godot executable, stage both on the Pi and launch with
   `godot --main-pack <verified-pck>`.

The PCK is Godot content, not an ARM64 executable. `arm64` identifies the
runtime target in the delivery. The build receipt separately records the
actual build-host platform and does not turn a desktop smoke into physical Pi
evidence.

The launcher accepts only bundled safe world IDs and always resolves the exact generated scene path. Pack data cannot supply scripts, shaders, URLs or arbitrary target scenes.

Character staging is a separate transaction: validate the
`CharacterProfileRevision`, copy its two source-free artifacts under the
fixed character root, and provide the trusted revision hash at launch. Do not
merge an internal-review/private character into a public world archive.

## What is and is not verified

Verified on the build machine:

- deterministic runtime archive bytes;
- official Godot ARM64 archive SHA-512;
- ELF AArch64 machine type;
- executable ZIP permissions;
- four exact scene paths and file hashes;
- Godot 4.3/4.7 desktop importer/playable regression.
- Pack 1.0 prepare `created` then `unchanged` under pinned Godot 4.3;
- exact Pack 1.0 scene/TileSet/state hashes and state integrity;
- deterministic Pack 1.0 Linux ARM64 review archive;
- direct Godot 4.3 load from the extracted ARM64 project without source Pack
  or workspace access.
- reusable-shell binding of separate character revisions across all four
  profiles on desktop Godot 4.3 and 4.7.
- real `PCKPacker` output launched through `--main-pack`, with an exact
  world/Pack/profile marker and byte-for-byte rebuild reproducibility.

Still requires the physical Pi:

- boot and display compatibility for the installed OS/driver;
- sustained frame time, memory and temperature;
- controller/audio behavior;
- staging, rollback and real-device acceptance.

The first device session should record OS version, GPU driver, display resolution, peak RSS, average/95th-percentile frame time, temperature after ten minutes, and the runtime ZIP SHA-256.
