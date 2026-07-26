# Layered-depth 2D world assets

> Status: internal review only. Every artifact described here is
> `UNRELEASED`. Godot, Raspberry Pi, human-art-review and public-release gates
> remain pending.

## Lanternmere Crossing direction

This pipeline contains original Lanternmere Crossing assets. The established
direction image was used only for layered-depth camera language, dusk palette,
material scale and pixel-cluster discipline. The generated sheet does not copy
the reference scene, buildings, characters or layout.

The untouched built-in generation original is retained as
`layered-depth-2d-prop-sheet-generation-v1.png`. The deterministic builder:

1. verifies the generation original by byte length and SHA-256;
2. applies a fixed chroma hard matte and one-pixel key-edge contraction;
3. separates 22 requested assets using recorded source bands and removes
   disconnected cross-cell fragments;
4. preserves relative proportions with one common scale;
5. emits a strict 6×4 `#ff00ff` source sheet and matching RGBA candidate;
6. emits an 8×8 runtime atlas with 96px cells and common `[48, 96]` bottom
   pivot.

The canonical roles cover:

- terrain: `ground`, `path`, `edge`, `bridge`, `stairs`, `water`
- props: `tree`, `rock`, `crate`, `sign`, `lamp`, `occluder`
- structures: `entrance`, `exit`, `checkpoint`, `landmark`
- collectibles: `primary`, `health`
- effects: `footstep`, `interact`, `portal`, `ambient`

The final two source cells and 42 runtime cells must remain transparent. Every
runtime mapping binds its canonical role and atlas cell explicitly.

Build and verify:

```powershell
node scripts/build-layered-depth-2d-prop-atlas.mjs
node scripts/verify-layered-depth-2d-prop-atlas.mjs
```

The strict verifier checks original provenance, matte settings, exact chroma
background, role coverage, cell containment, shared pivot, relative-scale
records, raster digests and transparent unmapped cells. Role semantics remain a
manual-review gate; Godot, Raspberry Pi and human approval remain explicitly
pending.
