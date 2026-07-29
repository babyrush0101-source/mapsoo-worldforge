# Layered-depth production Pack 0.9 candidate

## Outcome

The Lanternmere Crossing production art can now be assembled as a
deterministic, hash-bound Pack 0.9-shaped ZIP and extracted fixture without
claiming that the art is released.

This artifact is deliberately:

- `status: runtime-candidate`;
- `distribution: internal-review`;
- `output_license: UNRELEASED`;
- not redistributable;
- not accepted by the current Pack 0.9 Godot importer.

The source archive adapter cannot be reused directly. Alpha12's
`buildAlpha12WorldAssetPack` requires trusted provider output, owned references
with explicit CC0 permission and a CC0 receipt. Those are public-release
conditions, not facts about this human-review-pending production art.

## Inventory

The builder copies the exact 15 hash-bound production projection PNGs:

- eight 320 x 180 layers;
- five environment atlases at the exact Pack 0.9 dimensions;
- one 768 x 72 player atlas;
- one 384 x 72 NPC atlas.

`previews/world.png` is a separately bound sixteenth PNG. It is the 640 x 360
composited production preview and is not counted as a projection output.

The archive also contains:

- `runtime/scene.json`;
- `runtime/collision.json`;
- `runtime/navigation.json`;
- `mapsoo.manifest.json`;
- `generation-receipt.json`;
- `review-status.json`;
- five unchanged Pack 0.9/runtime/receipt schema copies;
- `license-assets.md` and `readme.md`.

The runtime sidecars are derived from the production preview's spawn, world
bounds, placements, collision shapes and reachable entrance-to-exit route.
They do not reuse the procedural Alpha12 smoke fixture.

## Expected Pack 0.9 rejection

Pack 0.9 has one irrevocable output-license contract:

```text
license.output.id = CC0-1.0
license.output.permits_redistribution = true
```

The existing Godot importer explicitly rejects any other values. Receipt 0.4
also fixes `output.license` to `CC0-1.0`.

This candidate truthfully records:

```text
license.output.id = LicenseRef-UNRELEASED
license.output.permits_redistribution = false
```

Therefore:

- the Pack 0.9 JSON schema passes because its `license` object is not yet
  semantically constrained;
- all three runtime 0.4 schemas pass;
- receipt 0.4 fails only its CC0 license constant;
- the Pack 0.9 Godot importer is expected to reject its canonical CC0 gate.

That rejection is the safe result. Changing the candidate to CC0 only to make
the importer pass would misrepresent the asset rights.

Pack 0.9 also aliases four role pairs into shared regions: ground/stairs,
path/water, tree/occluder and entrance/landmark. The receipt and review status
retain the existing 18-region/22-role disclosure.

## Build and verify

From the repository root:

```powershell
node scripts/build-layered-depth-2d-production-pack09-candidate.mjs
node scripts/verify-layered-depth-2d-production-pack09-candidate.mjs
```

The verifier builds twice and requires byte-identical:

- ZIP bytes;
- build record;
- every extracted fixture file.

It also checks all source and archive hashes, exact PNG dimensions, canonical
paths, JSON schemas, runtime bounds/spawn/reachability, archive traversal
safety, the expected receipt/importer license rejection, and the absence of a
private consumer name.

Generated outputs:

- `docs/visual-qa/production-art/layered-depth-2d-production-pack09-candidate-v1.zip`;
- `docs/visual-qa/production-art/layered-depth-2d-production-pack09-candidate-v1.json`;
- `tests/fixtures/layered-depth-2d-production-pack09-candidate-v1/`.

Do not publish or upload this candidate. Public release still requires human
art approval, rights/license approval, an honestly licensed export, and the
remaining release gates.
