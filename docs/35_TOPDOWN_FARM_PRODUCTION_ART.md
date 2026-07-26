# Top-down farm production art

> Status: internal review only. All artifacts described here remain
> `UNRELEASED`; this document is not evidence of a public asset-pack release.

## Prop and structure atlas

The source-to-runtime prop pipeline uses the approved, fixed 6×4 review sheet:

- `topdown-farm-prop-sheet-source-v1.png` is the immutable generated source.
- `topdown-farm-prop-sheet-rgba-v1.png` is the immutable transparent candidate.
- `topdown-farm-prop-sheet-v1.json` binds both inputs by byte length and SHA-256.
- `topdown-farm-prop-atlas-v1.png` is a deterministic 8×8 atlas with 64×64
  cells.
- `topdown-farm-prop-atlas-v1.json` records every source crop, runtime cell,
  bottom pivot, visible bound and sanitation result.

The 24 mapped cells cover trees, rocks, flowers, fences, a gate, a crate,
house, barn, four crop stages, and named bridge, market, sign, sapling,
forage, lantern, barrel, well, hay, entrance and exit variants. The remaining
40 cells are required to be transparent.

Boundary-connected grid pixels and long near-white grid components are removed
before cropping; this prevents the source sheet's review dividers from becoming
runtime props. All crops and structures use one shared source-to-runtime scale. This preserves
their relative size instead of independently inflating every object to fill a
64×64 cell. Nearest-neighbor resizing and a `[32, 64]` bottom pivot make the
result suitable for integer-scaled top-down placement.

Build and verify directly:

```powershell
node scripts/build-topdown-farm-prop-atlas.mjs
node scripts/verify-topdown-farm-prop-atlas.mjs
```

The verifier proves input digests, atlas geometry, required-role coverage,
visible mapped cells, cell containment, bottom-pivot alignment and transparent
unmapped cells. Role semantics and Godot runtime composition still require
their separately recorded review gates.

## Terrain and assembled world

The terrain pipeline normalizes the fixed source sheet into a deterministic
`256 × 128`, `8 × 4` atlas of `32 × 32` cells. Its four mandatory role families
are ground, water, path and soil; all 32 declared variants are checked, and the
repeatable base edges have zero mismatched boundary pixels.

The assembled preview is
[`topdown-farm-production-preview-v1.png`](visual-qa/production-art/topdown-farm-production-preview-v1.png).
It is generated from the recorded atlas hashes, not from the flattened direction
image. The world contains:

- a fully tiled `20 × 15` map;
- river banks and a traversable bridge corridor;
- house, barn, market, four crop stages, entrance and exit;
- a proportionally scaled player using the production character atlas;
- four visible-role collision bindings;
- a seven-node/six-edge route from spawn to exit.

Run the complete deterministic build and validation with:

```powershell
pnpm production-art:topdown:verify
pnpm production-art:topdown:candidate:godot
```

The second command runs Godot 4.3 and 4.7, drives the player along the declared
route, and writes
[`topdown-farm-production-candidate-godot-render-v1.json`](visual-qa/production-art/topdown-farm-production-candidate-godot-render-v1.json).
Both engine versions currently produce byte-identical renders. The candidate still
requires human art review and physical Raspberry Pi 4B measurement before release.
