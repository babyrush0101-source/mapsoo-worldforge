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
deterministic archive is 55,655,386 bytes with SHA-256
`be3630e292cbf85cb50ab71eb27afb2ec5b7a51955590f0d1985daec9d2f9331`.

This fifth world is explicitly `internal-review`, `UNRELEASED`, and
`standard_pack: false`. It is assembled only from an allowlisted configuration,
trusted public runtime code, and exact JSON/PNG/TSCN hashes. Generated data
cannot add scripts, shaders, URLs, or arbitrary scenes. The bundle is for
controlled device validation only and must not be attached to a public release
before human-art and rights approval.

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

The project uses Godot's `gl_compatibility` renderer, a 640×360 viewport, nearest texture filtering, bounded cameras, and a limited number of depth planes/lights suitable for an initial Pi 4B trial.

## Adding a newly created world

The shortest controlled path is:

1. generate and freeze the exact Mapsoo pack;
2. import it on the build machine with the matching trusted importer;
3. run profile structural and playable smoke tests;
4. copy only the importer-managed directory into `project/mapsoo_imports/<world-id>/`;
5. rebuild the runtime ZIP and verify its SHA-256;
6. stage on the Pi and launch `./run-mapsoo.sh <world-id>`.

The launcher accepts only bundled safe world IDs and always resolves the exact generated scene path. Pack data cannot supply scripts, shaders, URLs or arbitrary target scenes.

## What is and is not verified

Verified on the build machine:

- deterministic runtime archive bytes;
- official Godot ARM64 archive SHA-512;
- ELF AArch64 machine type;
- executable ZIP permissions;
- four exact scene paths and file hashes;
- Godot 4.3/4.7 desktop importer/playable regression.

Still requires the physical Pi:

- boot and display compatibility for the installed OS/driver;
- sustained frame time, memory and temperature;
- controller/audio behavior;
- staging, rollback and real-device acceptance.

The first device session should record OS version, GPU driver, display resolution, peak RSS, average/95th-percentile frame time, temperature after ten minutes, and the runtime ZIP SHA-256.
