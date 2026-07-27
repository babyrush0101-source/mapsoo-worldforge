# Portable character profile runtime binding

Status: implemented technical runtime path; human art review and physical
Raspberry Pi verification remain required

Mapsoo can load a world first and bind an independently generated player
character afterward. The world pack stays immutable: map data, collision,
navigation, spawn, controller scripts and event hooks are not regenerated or
rewritten.

```text
verified world pack
  + canonical CharacterProfileRevision bytes
  + exact character-profile atlas PNG bytes
  -> validate before mutation
  -> locate the neutral player visual slot
  -> replace SpriteFrames only
  -> enter the existing playable world
```

This is the shortest safe path for using one approved character across the
four supported world profiles:

- `side-platformer`;
- `topdown-farm`;
- `isometric-action`;
- `layered-depth-2d`.

It is a provider-neutral boundary. The image may originate from a local tool,
a remote image model or a human artist, but it must first pass the same
`CharacterProfileRevision` contract.

## Runtime inputs

The consumer supplies three immutable values to
`MapsooCharacterProfileRuntime.bind_player()`:

1. the exact UTF-8 bytes of `character-profile-revision.json`;
2. the trusted SHA-256 of those exact revision bytes;
3. the exact PNG atlas bytes declared by the revision.

The production-art CLI writes the revision using
`serializeCharacterProfileRevisionCanonical()`. Therefore the raw file
SHA-256 is the same digest carried by `character-profile.bind`; reformatting
the JSON changes the digest and is rejected.

The Godot adapter validates before changing the scene:

- raw revision byte digest and strict JSON shape;
- profile, portable IDs, safe atlas path and explicit rights;
- atlas byte count, digest, PNG decode and dimensions;
- exact frame grid, bounded pivot and every canonical clip;
- world-profile equality;
- one unambiguous neutral player visual slot.

Only after all checks pass does it create runtime `AtlasTexture` frames and
replace `AnimatedSprite2D.sprite_frames`. It preserves the atlas pixels and
frame regions. A display scale maps high-resolution source frames onto the
existing profile's nominal actor footprint; the source PNG is not resampled
or repacked.

## Neutral player slot

Current importers mark the player `AnimatedSprite2D` with:

```gdscript
visual.set_meta("mapsoo_runtime_slot_id", "player")
```

The binder searches for exactly one tagged slot instead of depending on a
consumer-specific scene tree. More than one tagged player slot fails closed.
For scenes imported before this metadata existed, the adapter recognizes the
legacy Mapsoo player path once and upgrades that visual in memory.

The runtime metadata records only portable IDs and SHA-256 values. It does not
contain user records, character display names, source paths, prompts, host
addresses, device IDs or private service fields.

## Rights boundary

World-pack rights and character-revision rights remain independent. A public
or redistributable base world must not silently absorb an
`internal-review`/`LicenseRef-Proprietary` character into its archive.
Internal-review and private characters travel as separate revision and PNG
artifacts. Public distribution requires a deliberate rights change plus human
review.

## Reusable runtime-shell entry point

The reusable Godot shell in `godot/example/main.gd` now exposes the same
provider-neutral boundary after a world has loaded:

```gdscript
runtime_shell.bind_player_character(
	revision_bytes,
	revision_sha256,
	atlas_bytes
)
```

It also accepts two separately staged files. Both must live under one exact
portable directory:

```text
res://mapsoo_characters/<profile-revision-id>/
  character-profile-revision.json
  character-profile-atlas.png
```

Call `bind_player_character_files(...)` from a host, or launch the reusable
shell with all three arguments:

```bash
godot --path project -- \
  --mapsoo-scene=res://mapsoo_imports/<world-id>/<world-id>.world.tscn \
  --mapsoo-character-revision=res://mapsoo_characters/<revision-id>/character-profile-revision.json \
  --mapsoo-character-revision-sha256=<canonical-revision-sha256> \
  --mapsoo-character-atlas=res://mapsoo_characters/<revision-id>/character-profile-atlas.png
```

The shell rejects partial argument sets, traversal paths, mismatched
directories, unsafe revision IDs, over-budget files, digest changes, profile
mismatches and ambiguous player slots. Successful binding publishes only the
portable character/revision/atlas identities as runtime metadata. Loading a
different world clears those active-character markers, so the host must bind a
revision for the new world's exact profile rather than accidentally reusing an
incompatible atlas.

## Verification

Run the local compatibility matrix:

```powershell
pnpm character:runtime:godot
```

The PowerShell verifier uses repository-local test runtimes when present, then
falls back to `GODOT_BIN`, `godot4` or `godot` on `PATH`. Multiple paths may be
passed explicitly with `-GodotConsoles`.

The adapter smoke creates high-resolution synthetic atlases and proves all four
profile bindings on Godot 4.3 and 4.7. The runtime-shell smoke additionally
imports and switches among four complete generated worlds, stages one
character through the file entry point, binds the remaining profiles from
immutable bytes, and proves idempotent replay. The checks cover canonical
clips, exact atlas regions, pivot offset, nearest filtering, display scale and
portable metadata. Negative tests reject:

- changed revision bytes or digest;
- mismatched profile/clip policy;
- incomplete clips;
- unsafe atlas paths;
- corrupted PNG bytes;
- missing player slots;
- ambiguous player slots;
- binding before a world is loaded;
- unsafe runtime-shell artifact paths.

CI runs the same test on Linux and Windows for both Godot versions.

Passing this gate proves technical compatibility only. It does not prove:

- that model-generated art preserves the intended character identity;
- that animation looks good or matches the world art direction;
- that rights permit publication;
- physical Raspberry Pi 4B performance.

Those remain explicit human-art, rights and device gates.

## Consumer integration

A private host may validate and authorize the public
`character-profile.bind` message, then deliver the canonical revision and PNG
bytes to its Godot process. Authorization, transport, session state,
idempotency storage and private identity lookup stay outside this repository.
No private product model or protocol is required by the open-source runtime
adapter.
