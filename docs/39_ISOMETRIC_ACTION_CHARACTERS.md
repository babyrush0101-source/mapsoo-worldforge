# Isometric action production characters

This candidate adds three original transparent character pipelines for the
Emberglass Foundry direction:

- `character.player.atlas`: the courier protagonist.
- `character.enemy-melee.atlas`: the Emberglass Forge Guard.
- `character.enemy-ranged.atlas`: the Emberglass Channeler.

All source and runtime records remain `internal-review` and `UNRELEASED`.
Nothing in this evidence claims Godot runtime, Raspberry Pi, human animation
review, complete-world, or public-release acceptance.

## Image-generation source

The three source sheets were generated with the built-in image-generation
tool, using the isometric world direction as the camera/palette reference. The
player also uses the existing top-down and side-platformer courier sheets as
identity references. The enemies use the player sheet only for camera, scale,
pixel density, and spacing.

The final prompt set requested:

- Player: an exact 8-column × 6-row sheet with directions
  `north..north-west` and actions `idle`, `move`, `attack-primary`, `dash`,
  `hurt`, `defeat`; preserve short messy black hair, mustard-yellow scarf,
  plum-purple coat, dark trousers, brown boots, and brown cross-body satchel.
- Melee: an exact 8-column × 5-row Forge Guard sheet with `idle`, `move`,
  `attack-primary`, `hurt`, `defeat`; preserve charcoal armor, copper trim,
  violet plume, amber visor, and bronze forge hammer.
- Ranged: an exact 8-column × 5-row Channeler sheet with the same enemy
  actions; preserve charcoal cloth, violet hood, copper bracers, teal lens,
  and bronze hand-crossbow.

Every prompt required one full pose per cell, consistent fixed 3/4 isometric
camera, original pixel art, a flat `#00ff00` chroma-key background, and no
text, labels, grid, scenery, shadow, logo, watermark, or copied commercial
character.

The chroma sheets were converted locally with border auto-key sampling, soft
matte, thresholds 12/220, one-pixel edge contraction, and despill. The source
and RGBA images are preserved separately:

- `docs/visual-qa/production-art/isometric-action-player-sheet-source-v1.png`
- `docs/visual-qa/production-art/isometric-action-player-sheet-rgba-v1.png`
- `docs/visual-qa/production-art/isometric-action-enemy-melee-sheet-source-v1.png`
- `docs/visual-qa/production-art/isometric-action-enemy-melee-sheet-rgba-v1.png`
- `docs/visual-qa/production-art/isometric-action-enemy-ranged-sheet-source-v1.png`
- `docs/visual-qa/production-art/isometric-action-enemy-ranged-sheet-rgba-v1.png`

## Honest pose and animation provenance

Each action/direction has one independently present generated source pose:
48 player poses and 40 poses for each enemy. Row-wise connected-component
clustering recovers the eight pose groups even when a sword, hammer, projectile,
or impact accent overlaps another pose in horizontal projection.

Each runtime clip contains:

1. one nearest-neighbour fit of its independent source pose;
2. one declared deterministic scale/shift motion variant.

The second frame is marked `synthetic_pose_variant: true`. Both frames are
marked `native_model_animation_frame: false`, because one independent pose plus
a deterministic variant is not a model-native temporal animation sequence.
Temporal continuity and action semantics remain manual-review gates.

## Runtime layout

All atlases use:

- 48 × 64 frames;
- pivot `(24, 58)`;
- 16 columns × 8 rows in a 768 × 512 PNG;
- two runtime frames per clip;
- exact atlas-cell, pixel-origin, and pixel-rectangle records.

The player maps 96 cells and requires 32 unmapped cells to remain transparent.
Each enemy maps 80 cells and requires 48 unmapped cells to remain transparent.
Every mapped frame has a unique RGBA digest, a 0–1 px foot-anchor error, no
green spill, and recorded identity-cue pixel counts.

Final runtime records:

- `docs/visual-qa/production-art/isometric-action-player-atlas-v1.png`
- `docs/visual-qa/production-art/isometric-action-player-atlas-v1.json`
- `docs/visual-qa/production-art/isometric-action-enemy-melee-atlas-v1.png`
- `docs/visual-qa/production-art/isometric-action-enemy-melee-atlas-v1.json`
- `docs/visual-qa/production-art/isometric-action-enemy-ranged-atlas-v1.png`
- `docs/visual-qa/production-art/isometric-action-enemy-ranged-atlas-v1.json`

## Rebuild and strict verification

```powershell
node scripts/build-isometric-action-character-atlases.mjs
node scripts/verify-isometric-action-character-atlases.mjs
```

The verifier invokes the builder twice and requires every generated source
manifest, atlas PNG, and atlas manifest to be byte-identical. It independently
checks immutable source hashes, roles, 48 × 64 geometry, pivot, clip order,
native/synthetic provenance, pixel coordinates, per-frame hashes, identity
cues, foot anchors, and transparency of every unmapped cell.
