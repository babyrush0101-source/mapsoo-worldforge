# Alpha11 original isometric-action candidate

Status: implemented locally, not published

Alpha11 introduces a separate Pack Schema `0.8.0` for an original diamond-grid action world. It is a new versioned contract; Pack `0.6.0` farm bytes and Pack `0.7.0` side-platformer semantics are unchanged.

The profile is inspired only by general 2D isometric action grammar: a 2:1 diamond grid, elevation, shared Y sorting, readable combat silhouettes, hazards and a route to an exit. The pack must not copy a commercial game's names, characters, layouts, palettes, UI, sprites or other protected expression.

## Dialogue-to-world result

After the four confirmed dialogue rounds, the browser can generate:

- bundle schema `0.3.0`;
- Pack Schema `0.8.0`;
- `isometric-action-complete-v1`;
- 36 canonical asset roles;
- ten canonical atlas bindings;
- one user-derived player plus world-native melee and ranged enemy atlases;
- 48 player clips and 40 clips per enemy, totalling 128 explicit eight-direction clips;
- a 64×32 diamond grid with a 16-pixel elevation step;
- scene, collision, navigation and preview sidecars;
- a deterministic CC0 asset ZIP with privacy-minimized receipt;
- an immutable `WorldAssetRevision` and, after visual approval, a `FrozenWorldLaunchBinding`.

The extracted character identity signature remains local. The public ZIP contains the generated player atlas, but not reference images, reference paths, source image digests, the free-text source description or the reusable identity signature.

## Godot result

The independent `mapsoo_pack_08.gd` importer:

- validates the exact manifest, role, atlas, file-integrity and runtime inventory;
- decodes only canonical PNG/JSON assets;
- constructs floor and elevation visuals;
- puts props and all three characters in one `y_sort_enabled` gameplay domain;
- creates blockers, hazard areas, a navigation polygon and traversal markers;
- creates a trusted eight-direction player controller with movement, dash, hazard respawn, exit reporting and bounded camera;
- persists generated textures before committing the managed scene;
- reuses the existing `created → unchanged → updated/conflict` transaction boundary.

The data pack never supplies GDScript. Controller code comes only from the separately installed trusted importer.

## Verified acceptance

Local tests currently prove:

- deterministic provider and ZIP bytes;
- environment changes alter world art without changing the player identity atlas;
- character changes alter the player atlas;
- all 36 roles and 128 clips are present;
- the exit is reachable in the runtime graph;
- Godot 4.3 and 4.7 both import the exact generated Pack 0.8 fixture;
- a second clean import is `unchanged`;
- the saved and reloaded scene retains all character-atlas pixels;
- the player moves diagonally, selects an eight-direction animation, dashes, respawns from a generated hazard, reaches the generated exit and uses exact camera bounds.

This is an Alpha11 candidate, not a published release. Enemy AI, damage resolution, attack windows, projectiles and Raspberry Pi ARM64 packaging are later acceptance slices and are not claimed complete here.

## Raspberry Pi path

Alpha11 remains a content pack. The target Raspberry Pi should not compile a new Godot application for every world:

```text
confirmed dialogue
  → frozen Pack 0.8 ZIP
  → trusted import on build/deployment host
  → generated .tscn + .tres
  → reusable ARM64 Godot runtime shell
  → load exact frozen scene path
```

The next device-specific gate is a reproducible Linux ARM64 runtime artifact plus Pi 4B frame-time and memory measurements.
