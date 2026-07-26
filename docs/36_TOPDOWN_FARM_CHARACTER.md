# Top-down farm character pipeline

The top-down farm candidate turns one reviewed 8 × 4 RGBA pose sheet into a
Godot-ready 1024 × 768 character atlas. It is a production candidate, not a
publicly released asset.

## Source and runtime geometry

- Source rows: `south`, `west`, `east`, `north`.
- Source columns: two `idle`, four `walk`, and two `interact` poses.
- Runtime cells: 128 × 128 in an 8 × 6 atlas.
- Runtime pivot: `(64, 120)`.
- Populated cells: 32. The final 16 cells are required to remain transparent.
- Runtime clips: 12 (`idle2`, `walk4`, `interact2` for each direction).

The builder detects eight column bands and four row bands from transparent
gaps, then places integer cell edges at the gap midpoints. It detects
8-connected alpha components independently in
every cell, selects the dominant component only, requires at least 75% alpha
dominance to reject ambiguous cells, rejects boundary contact, crops the
detected subject, and uses nearest-neighbour scaling. Each populated runtime
cell maps to one distinct source cell. No frame is mirrored and no pose is
synthesized.

This makes `native_source_pose: true` evidence-based: 32 distinct source cells,
32 distinct source mappings, and 32 distinct runtime-frame RGBA digests. It
does **not** establish that the poses form human-approved temporal animation.
Action semantics, identity consistency, and temporal continuity remain manual
review gates.

## Contract boundary

The runtime atlas manifest contains all 12 clips. `CharacterProfileRevision
1.0.0` currently defines only `idle` and `walk` for `topdown-farm`, so the
independent profile revision binds the eight canonical clips and the exact
atlas digest. `interact` remains present in the runtime atlas manifest but is
not falsely represented as part of the current profile-revision contract.

The revision remains private with `LicenseRef-Proprietary`. Neither the source,
atlas, nor revision claims human approval or public-release readiness.

## Rebuild and strict verification

```powershell
node scripts/build-topdown-farm-character-atlas.mjs
node scripts/verify-topdown-farm-character-atlas.mjs
```

The verifier runs the builder twice and requires byte-identical source
manifest, atlas PNG, atlas manifest, and profile revision outputs. It then
recomputes frame hashes, visible bounds, foot-anchor error, one-to-one source
mapping, clip completeness, reserved-cell transparency, and the private
profile-revision binding.
