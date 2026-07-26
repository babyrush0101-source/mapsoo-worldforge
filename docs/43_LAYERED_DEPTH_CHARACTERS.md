# Layered-depth 2D production characters

This internal candidate adds two original character pipelines for Lanternmere
Crossing:

- `character.player.atlas`: the recurring courier protagonist.
- `character.npc.atlas`: an original Lanternmere market merchant.

All source and runtime records remain `internal-review` and `UNRELEASED`.
Godot, Raspberry Pi, and human review are explicitly pending.

## Built-in image-generation source

The source sheets were generated with the built-in image-generation tool, then
saved in the project before local chroma-key removal.

The player prompt requests an exact 4 × 4 matrix. Columns are `left`, `right`,
`near`, and `far`; rows are `idle`, `walk`, `run`, and `interact`. It preserves
short messy black hair, a mustard-yellow scarf, plum-purple coat, dark
trousers, brown boots, and brown cross-body satchel.

The merchant prompt requests an exact 4 × 2 matrix with the same directions
and `idle`/`talk` rows. The original merchant has wavy chestnut hair, a small
moustache, indigo cap, moss-green vest, cream shirt, rust-red apron, brown
boots, a copper lantern brooch, and ledger pouch.

Both final prompts are preserved verbatim in their source manifests. Both
require original high-readability pixel art, the Lanternmere
side-and-three-quarter layered-depth camera, a flat `#00ff00` chroma
background, one full pose per cell, and no text, grid, scenery, shadow, logo,
watermark, 3D rendering, or copied commercial character.

Project source records:

- `docs/visual-qa/production-art/layered-depth-2d-player-sheet-source-v1.png`
- `docs/visual-qa/production-art/layered-depth-2d-player-sheet-rgba-v1.png`
- `docs/visual-qa/production-art/layered-depth-2d-player-sheet-v1.json`
- `docs/visual-qa/production-art/layered-depth-2d-npc-sheet-source-v1.png`
- `docs/visual-qa/production-art/layered-depth-2d-npc-sheet-rgba-v1.png`
- `docs/visual-qa/production-art/layered-depth-2d-npc-sheet-v1.json`

The RGBA conversion uses border auto-key sampling, soft matte, thresholds
12/220, one-pixel edge contraction, and despill.

## Honest pose provenance

The player contains 16 independently present source poses; the merchant
contains eight. Each action/direction therefore has one native source pose.

Each runtime clip contains:

1. one nearest-neighbour fit from its generated source pose;
2. one declared deterministic scale/shift variant.

The second frame is marked `synthetic_pose_variant: true`. Every runtime frame
is marked `native_model_animation_frame: false`, because independent poses plus
deterministic variants do not constitute a model-native temporal animation
sequence. Temporal continuity and action semantics remain manual-review gates.

## Pack 0.9 runtime geometry

Both atlases use:

- 48 × 72 frames;
- pivot `(24, 67)`;
- an 8 × 8 frame grid in a 384 × 576 transparent PNG;
- two frames per clip;
- exact atlas-cell, pixel-origin, pixel-rectangle, frame-hash, identity-cue,
  visible-height, and foot-anchor evidence.

The player maps 32 cells across 16 clips and requires 32 unmapped cells to
remain transparent. The NPC maps 16 cells across eight clips and requires 48
unmapped cells to remain transparent.

Final runtime records:

- `docs/visual-qa/production-art/layered-depth-2d-player-atlas-v1.png`
- `docs/visual-qa/production-art/layered-depth-2d-player-atlas-v1.json`
- `docs/visual-qa/production-art/layered-depth-2d-npc-atlas-v1.png`
- `docs/visual-qa/production-art/layered-depth-2d-npc-atlas-v1.json`

## Rebuild and strict verification

```powershell
node scripts/build-layered-depth-character-atlases.mjs
node scripts/verify-layered-depth-character-atlases.mjs
```

The verifier runs the builder twice and requires byte-identical source
manifests, atlas PNGs, and atlas manifests. It independently checks immutable
source hashes, roles, canonical clips, 48 × 72 geometry, `(24,67)` pivot,
native/synthetic labels, frame pixels and hashes, identity cue coverage,
0–1 px foot-anchor error, and transparency of every unmapped cell.
