# Side-platformer character atlas v2

Status: strict internal runtime candidate; user art approval remains pending

The v2 character artifact fixes three bounded acceptance failures in the earlier
single-pose-per-clip candidate:

- every canonical side-platformer clip now has multiple runtime frames;
- every visible character frame is between 72 and 96 pixels tall;
- every frame's visible foot is within two pixels of the shared `(64, 120)` pivot.

The generated artifacts are:

- `visual-qa/production-art/side-platformer-character-atlas-v2.png`;
- `visual-qa/production-art/side-platformer-character-atlas-v2.json`;
- `visual-qa/production-art/side-platformer-character-profile-revision-v2.json`;
- `visual-qa/production-art/side-platformer-character-godot-v2.json`.

## Frame counts

| Action | Frames per direction | Directions | Total |
|---|---:|---:|---:|
| idle | 2 | 2 | 4 |
| run | 4 | 2 | 8 |
| jump | 2 | 2 | 4 |
| fall | 2 | 2 | 4 |
| land | 2 | 2 | 4 |
| hurt | 2 | 2 | 4 |
| **Total** |  |  | **28** |

The `1024 × 768` atlas retains `128 × 128` cells and an `8 × 6` grid. Exactly
28 cells are bound by clips; every other cell must be transparent.

## Honest provenance

The recorded source sheet contains one model-generated pose for each
action/direction pair, not a complete animation sequence. V2 therefore creates
additional frames with deterministic nearest-neighbor scale and translation
variants:

- idle breath compression;
- four-step run bob and stride timing;
- two-step jump and fall motion;
- landing compression;
- hurt recoil.

Every frame record declares:

```text
derivation.kind = deterministic-postprocess-variant
derivation.native_model_frame = false
source_pose.native_model_frame_count = 1
```

The atlas and QA records also set `native_model_animation_frames: false`.
These variants are real, distinct runtime frames, but they must not be described
as model-native limb animation. Replacing them with independently illustrated
limb poses remains a future quality improvement.

## Strict automated gate

`scripts/verify-side-platformer-character-atlas-v2.mjs` checks:

- exact PNG bytes, dimensions and SHA-256;
- 12 canonical action/direction clips and the exact 28-frame minimum;
- a unique atlas cell and unique RGBA digest for every frame in a clip;
- visible height from 72 through 96 pixels;
- foot-anchor error from 0 through 2 pixels;
- zero bounded green spill;
- complete transparency for every unmapped cell;
- an exact independent `CharacterProfileRevision`;
- Godot 4.3 and 4.7 evidence bound to the same atlas hash.

The recorded v2 candidate has a 73–88 pixel visible-height range and a maximum
two-pixel foot-anchor error. Godot 4.3 and 4.7 decode all 28 frames and produce
the same 1:1 QA preview.

Run:

```text
pnpm production-art:character:build
pnpm production-art:character:godot
pnpm production-art:character:verify
```

## Remaining limitations

This technical gate does not prove:

- model-native or hand-authored limb animation;
- transition quality inside the actual game controller;
- match against the final world pixel-density system;
- identity approval by the character owner;
- user or human art approval;
- public redistribution rights;
- physical Raspberry Pi rendering.

The v2 files remain `internal-review`, `UNRELEASED`, and excluded from the public
asset pack until those separate gates are satisfied.
