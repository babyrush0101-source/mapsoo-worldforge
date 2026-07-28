# AssetRequirements and ProductionArtPlan 1.1

Status: **implemented requirements, plan, provider, normalization, run-set,
output, reviewed selection, runtime projection, reproducible runtime overlay,
and shared Godot application; complete private-workspace blueprint integrated;
same resumable runner accepts 1.0 and 1.1 jobs; live execution remains pending
explicit authorization**

This revision adds the smallest core abstraction needed for a confirmed world
to request multiple genuinely distinct visual assets. It does not alter the
published 1.0 contracts, reviewed packs, or Godot runtime.

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

The private world-delivery workspace now writes the complete 1.1 requirements
and Plan under `complete-art/` and binds their full SHA-256 values and counts in
`workspace-manifest.json.complete_art_plan`. It also writes a bound 1.1 job for
the same resumable runner. The executable 1.0 compatibility workflow remains
alongside it; neither job silently claims that paid generation occurred.

## Minimal architecture

```text
confirmed dialogue
  -> WorldLayoutConstraints 1.0
  -> WorldLayoutPlan 1.0
  -> AssetRequirements 1.1
  -> ProductionArtPlan 1.1
  -> shared resumable workflow runner   (implemented, dry-run by default)
  -> replaceable GeneratorAdapter       (implemented versioned port)
  -> PNG normalize + slot evidence      (implemented local boundary)
  -> ProductionArtOutput 1.1
  -> ProductionArtRunSet 1.1
  -> normalized reviewed slot inventory (next integration slice)
  -> WorldArtVariantMap 1.0             (implemented contract)
  -> WorldArtRuntimeProjection 1.0      (implemented byte-bound adapter)
  -> WorldArtRuntimeOverlay 1.0         (implemented reproducible ZIP)
  -> shared Godot overlay loader        (implemented persistent catalog)
  -> terrain + landmark apply           (implemented shared scene applier)
  -> hazard apply                       (implemented shared gameplay applier)
  -> character apply                    (implemented existing-runtime adapter)
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
unreviewed candidate or infer a provider path. Terrain selections must match
the same canonical material-to-role mapping used by `WorldMaterialPalette`;
for example, a meadow cannot be bound to a reviewed water or wall cell.

Implemented by:

- `src/core/production-art-output-v1-1.ts`;
- `schemas/mapsoo-production-art-output-1.1.schema.json`;
- `src/core/production-art-run-set-v1-1.ts`;
- `schemas/mapsoo-production-art-run-set-1.1.schema.json`;
- `src/adapters/normalize-production-art-png-v1-1.ts`;
- `src/core/world-art-variant-map.ts`;
- `schemas/mapsoo-world-art-variant-map-1.0.schema.json`.

The 1.1 provider overload requires the exact source requirements before it
calls an adapter. Its prompt lists every slot, requirement, variant, and role.
The local PNG boundary checks mapped cells, rejects visible undeclared cells,
and hashes each normalized slot. `ProductionArtRunSet 1.1` then requires every
dynamic plan task exactly once and binds its output and evidence to the same
Plan and requirements digests. The old 1.0 provider and normalizer remain
unchanged at their public boundaries.

## Runtime projection

`WorldArtRuntimeProjection 1.0` is the first Pack-facing artifact. The shared
adapter revalidates the exact VariantMap, requirements, Plan, RunSet, every
normalized output, generation evidence, decoded PNG dimensions, full-file
SHA-256, and per-slot RGBA digest before emitting it.

The projection keeps a complete catalog of every Plan 1.1 slot and every task
image that owns one, including background, prop, structure, effect, terrain,
landmark, hazard, and character assets. A separate binding list records which
catalog assets the current world's terrain, landmarks, hazards, and characters
actually use. Grid cells become explicit pixel regions. Character catalog
assets also expand to complete action, direction, frame, duration, and
pixel-region records so Godot never has to infer pose geometry from a prompt
or provider response. It also contains deterministic hazard instances: each
instance binds one reviewed hazard usage to a bounded logical rectangle and a
trusted `respawn` behavior. Isometric instances may bind a separate reviewed
telegraph. Calm worlds contain no instances; guarded and dangerous worlds
contain one and two respectively.

Implemented by:

- `src/core/world-art-runtime-projection.ts`;
- `schemas/mapsoo-world-art-runtime-projection-1.0.schema.json`;
- `src/adapters/project-reviewed-world-art-variants.ts`.

The projection ID hashes the complete canonical runtime payload. Changing the
RunSet, review binding, image digest, region, pose, or selected variant changes
the identity. Prompt text, reference paths, provider request IDs, remote asset
IDs, credentials, and private world labels are excluded.

## Runtime overlay

`WorldArtRuntimeOverlay 1.0` packages the complete runtime projection and every
PNG it references without rebuilding an existing world Pack. It is a small,
version-neutral layer that a runner can apply to an already loaded world.
This keeps the public contract independent of the four historical Alpha Pack
exporters and avoids copying four profile-specific delivery paths.

Implemented by:

- `src/core/world-art-runtime-overlay.ts`;
- `schemas/mapsoo-world-art-runtime-overlay-1.0.schema.json`;
- `src/adapters/build-world-art-runtime-overlay.ts`.

The builder rematerializes the projection, verifies every path, byte count,
SHA-256, and referenced image, rejects extra files, then emits a deterministic
single-root ZIP. The manifest binds the source projection, layout, review
record, rights, and review gates. It excludes original references, raw prompts,
provider metadata, account data, and credentials. Proprietary assets may be
used for private or internal review, but cannot be marked for public
distribution.

The trusted Godot addon now has one shared loader for all four profiles:

- `godot/addons/mapsoo_importer/mapsoo_world_art_runtime_overlay.gd`;
- `godot/addons/mapsoo_importer/mapsoo_world_art_runtime_overlay_applier.gd`;
- `godot/addons/mapsoo_importer/mapsoo_world_art_runtime_hazard_applier.gd`;
- `godot/addons/mapsoo_importer/mapsoo_world_art_runtime_character_applier.gd`;
- `godot/tests/world_art_runtime_overlay_smoke.gd`;
- `godot/tests/world_art_runtime_overlay_applier_smoke.gd`;
- `scripts/verify-world-art-runtime-overlay-godot.ps1`;
- `scripts/verify-world-art-runtime-overlay-applier-godot.ps1`.

It accepts only an extracted `world-art-runtime-overlay.json`, revalidates the
manifest and projection identities, rights and optional local grant, exact file
inventory, byte lengths, SHA-256 values, decoded PNG dimensions, asset regions,
per-slot RGBA digests, and runtime bindings. It creates lossless portable Godot
textures and binds the complete catalog to an existing scene only when the
profile and layout SHA-256 match. Godot 4.3 and 4.7 tests save and reload the
bound catalog for all four profiles. The data overlay contains and loads no
scripts, shaders, URLs, or executable resources.

The separate shared applier consumes only that trusted bound catalog. It
reuses `MapsooLayoutMaterialization/Terrain/LogicalCells`, preserves every
existing logical-material source ID while replacing its texture with the
selected reviewed cell, and attaches each selected landmark to the matching
layout `Marker2D`. It preflights complete material and landmark coverage before
mutation. Four-profile Godot 4.3 and 4.7 tests prove visible application,
save/reload persistence, and fail-closed missing/conflicting input handling.
The hazard applier is deliberately separate from terrain/landmark rendering.
It converts only trusted projection rectangles into `Area2D` collision and
reviewed sprites under the confirmed layout owner. It executes no overlay
code, keeps historical Pack hazard coordinates disabled, and lets the existing
profile controllers consume the same shared node path. Tests additionally
prove controller respawn, exact binding persistence, and failure before
mutation for missing bindings, out-of-bounds rectangles, and conflicting
hazard roots.

The character applier does not introduce another animation runtime. It selects
exactly one reviewed `character.player.atlas` binding and delegates its
complete action/direction/frame regions to
`MapsooCharacterProfileRuntime`. That existing runtime still owns the neutral
player slot, animation names, loop policy, default animation, pivot, profile
scale, controller compatibility, and persistence checks. Missing frames,
ambiguous players, or an already bound different character fail before visual
replacement.

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

The 1.1 contracts do not authorize paid generation. The shared resumable
runner validates the canonical 1.1 requirements and Plan, freezes one external
approved-direction digest on the first attempt, journals request accounting,
and dispatches each dynamic task through the same provider port used by 1.0.
Provider execution, local PNG normalization, run-set assembly, reviewed selection, and
Pack-facing runtime projection, overlay assembly, and shared Godot
load/persistence now have explicit versioned branches. The loaded catalog is
applied to logical terrain TileSets, landmark scene nodes, and deterministic
hazard `Area2D` nodes. Reviewed player pose regions reuse the portable
character-profile runtime rather than introducing a parallel animation path.

A 1.1 plan alone is planning and review evidence only. A
`WorldArtVariantMap` is a validated runtime binding contract. A persisted
runtime overlay plus a passing applier receipt proves that its selected terrain
and landmark pixels are visible and that its reviewed hazards trigger trusted
controller respawn. It also proves the reviewed player atlas drives complete
profile animations through the existing runtime. It does not yet prove final
human art quality or physical-device performance.

## Next vertical slices

1. Complete side-platformer and isometric non-enterable `terrain.water`.
2. Run one opt-in remote task only after explicit user authorization.
3. Complete human art review and assemble the reviewed 1.1 runtime overlay.
4. Run a physical Raspberry Pi 4B smoke test.

No live provider request is authorized or claimed by this core revision.
