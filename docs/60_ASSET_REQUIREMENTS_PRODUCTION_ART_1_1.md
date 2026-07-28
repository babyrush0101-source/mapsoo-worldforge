# AssetRequirements and ProductionArtPlan 1.1

Status: **implemented requirements, plan, output, and runtime-binding core
contracts; review-only**

This revision adds the smallest core abstraction needed for a confirmed world
to request multiple genuinely distinct visual assets. It does not alter the
published 1.0 contracts, provider workflow, reviewed packs, or Godot runtime.

## Why a parallel version

`AssetRequirements 1.0.variant_count` preserved structural differences, but a
value such as `route_shape=loop` could produce the ordinal `3`. That number is
not a request for three preview images. Conversely, four confirmed landmarks
really do need four independently reviewable visual variants and four runtime
bindings.

Version 1.1 separates the two meanings:

- `structural_values` records confirmed route, scale, verticality, water,
  settlement, hazard, and landmark-count semantics;
- `variants` lists the actual independently generated visual identities;
- `required_output.count` must exactly equal `variants.length`;
- each canonical role has exactly one requirement;
- landmark variants use stable `landmark-001` through `landmark-004` IDs and
  never copy private landmark labels.

The old 1.0 serializer, fingerprints, schemas, plan IDs, projectors, and runtime
remain frozen.

## Minimal architecture

```text
confirmed dialogue
  -> WorldLayoutConstraints 1.0
  -> WorldLayoutPlan 1.0
  -> AssetRequirements 1.1
  -> ProductionArtPlan 1.1
  -> replaceable GeneratorAdapter       (next integration slice)
  -> ProductionArtOutput 1.1            (implemented contract)
  -> normalized reviewed slot inventory (next integration slice)
  -> WorldArtVariantMap 1.0             (implemented contract)
  -> reviewed pack + Godot importer     (next runtime slice)
```

Only the first four stages are core domain logic. Image generation, animation,
background removal, slicing, and provider polling belong in adapters.

## AssetRequirements 1.1

Implemented by:

- `src/core/asset-requirements-v1-1.ts`;
- `schemas/mapsoo-asset-requirements-1.1.schema.json`.

The builder reuses the established four-profile role inventories and adds only
the smallest honest capability delta:

| Profile | Extension roles |
| --- | --- |
| side-platformer | `terrain.water`, `structure.landmark` |
| topdown-farm | `hazard.contact`, `structure.landmark` |
| isometric-action | `terrain.water`, `structure.landmark` |
| layered-depth-2d | `hazard.contact` |

An extension role is demanded only when the confirmed layout uses that
feature. It is review-capable, not automatically runtime-capable.

The contract excludes dialogue, world prose, landmark labels, prompts,
references, filesystem paths, provider names, remote IDs, credentials, and
private image digests.

## ProductionArtPlan 1.1

Implemented by:

- `src/core/production-art-contract-v1-1.ts`;
- `schemas/mapsoo-production-art-1.1.schema.json`.

The plan binds the complete canonical requirements SHA-256 and compiles each
variant into:

- one requirement assignment;
- one globally stable slot ID;
- one role and variant ID;
- one exact grid rectangle;
- one deterministic output task and path.

Tile, prop, hazard, effect, and landmark variants use
`one-cell-per-variant`. Scene direction uses one `composite-sheet`. Each
character style variant owns one complete `pose-grid`; character frames are
never mixed between style variants.

Sheet slots are placed row-major and page deterministically at capacity.
Validators rebuild the expected plan from canonical requirements and reject
changed digests, rights, assignments, slots, cells, task paths, prompts, or
pose mappings.

## Output and runtime binding

`ProductionArtOutput 1.1` records the complete Plan and requirements digests,
then carries the task's slot IDs, repeated roles, and variant IDs in exact
mapping order. It accepts only canonical local reference IDs. Provider request
IDs, remote asset IDs, account data, prompts, and credentials cannot enter the
document.

`WorldArtVariantMap 1.0` is a separate provider-neutral runtime artifact. It
requires:

- the exact confirmed `WorldLayoutPlan`;
- the source-bound `AssetRequirements 1.1` and `ProductionArtPlan 1.1`;
- a `pass` reviewed-slot inventory with exact plan slots, cells, and portable
  PNG paths;
- explicit terrain, hazard, and character selections.

Each confirmed layout landmark is deterministically bound to its matching
label-free landmark variant. The map binds complete SHA-256 values for layout,
production plan, reviewed inventory, and review record. It does not choose an
unreviewed candidate or infer a provider path.

Implemented by:

- `src/core/production-art-output-v1-1.ts`;
- `schemas/mapsoo-production-art-output-1.1.schema.json`;
- `src/core/world-art-variant-map.ts`;
- `schemas/mapsoo-world-art-variant-map-1.0.schema.json`.

## Reusing existing tools

WorldForge should not rebuild mature image-generation products. SpriteCook and
other generators can be reused behind the existing provider port for:

- reference-asset reuse and style continuity;
- batched visual variations;
- character animation;
- background removal and transparent crops;
- provider-side credit checks, polling, and downloads.

Those tools do not decide world structure, canonical roles, required variant
counts, atlas cells, approval status, pack completeness, or Godot runtime
bindings. Provider asset IDs and account data stay in private adapter receipts.
Removing one provider must leave core tests and the offline baseline working.
The implemented SpriteCook boundary is documented in
[`59_SPRITECOOK_PROVIDER_ADAPTER.md`](59_SPRITECOOK_PROVIDER_ADAPTER.md).

## Fail-closed delivery boundary

The 1.1 contracts intentionally stop before paid generation. They are not yet
accepted by:

- `ProductionArtProvider` execution;
- PNG slot normalization and evidence;
- `ProductionArtRunSet`;
- reviewed-pack projectors;
- the Godot importers.

Until those stages are implemented and tested for all four profiles, the
workspace continues to execute the stable 1.0 path. A 1.1 plan is planning and
review evidence only. A `WorldArtVariantMap` is a validated runtime binding
contract, but not proof that its atlas has been projected into a playable
Godot pack.

## Next vertical slices

1. Add provider, normalizer, and RunSet 1.1 branches while preserving all 1.0
   guards.
2. Normalize by slot ID and reject empty, undeclared, or duplicate variants.
3. Project reviewed variant-map bindings into Pack and Godot importers.
4. Complete side-platformer non-enterable `terrain.water` end to end.
5. Complete top-down hazard visuals and `Area2D` behavior.
6. Add visible multi-landmark bindings for all four profiles.
7. Run human art review and a physical Raspberry Pi 4B smoke test.

No live provider request is authorized or claimed by this core revision.
