# WorldLayoutPlan 1.0

`WorldLayoutPlan 1.0` is the provider-neutral boundary between a confirmed
world-creation conversation and later art/runtime stages. It describes playable
space and intent only. It does not contain model prompts, provider request IDs,
generated bitmap paths, engine scene syntax, exporter options, or consumer
application fields.

## Contract files

- Provider-neutral constraint JSON Schema:
  `schemas/mapsoo-world-layout-constraints-1.0.schema.json`
- Constraint validator, explicit-intent constructor, compatibility projector,
  and fingerprint:
  `src/core/world-layout-constraints.ts`
- Four-profile deterministic solver registry:
  `src/core/world-layout-solver.ts`
- JSON Schema:
  `schemas/mapsoo-world-layout-plan-1.0.schema.json`
- TypeScript materializer, validator, deterministic builder, and fingerprint:
  `src/core/world-layout-plan.ts`
- Positive and negative conformance tests:
  `src/core/world-layout-plan.test.ts`
- Logical-material to canonical terrain-role contract:
  `schemas/mapsoo-world-material-palette-1.0.schema.json` and
  `src/core/world-material-palette.ts`

The builder accepts only a validated `ConfirmedWorldCreationIntake 1.0`.
Before geometry is created, the intake is projected into canonical
`WorldLayoutConstraints 1.0`. The formal world-creation path supplies an
explicit, user-confirmed `WorldLayoutConstraintIntent`; the constraint artifact
is then marked `confirmed-intent`. Existing 1.0 callers that only have the ten
text facts use a deliberately limited bilingual compatibility projector and
are marked `compatibility-derived`, so inferred structure cannot be mistaken
for user-confirmed structure.

The constraints expose only route shape, scale, verticality, water shape,
settlement density, hazard level, and two to four explicitly public landmark
labels. Raw premise, geography, traversal prose, provider prompts, reference
paths, and private application fields are not part of the constraint document.

`source` binds the plan to:

- the confirmed intake ID and session revision;
- the canonical intake SHA-256;
- the confirmed `map-layout` checkpoint SHA-256;
- the exact seed and its canonical SHA-256.

Canonical JSON sorts object keys while retaining array order. A repeated build
from the same confirmed intake therefore produces the same plan and plan
fingerprint. Changing the seed deterministically changes node placement, the
plan ID, the intake binding, and the plan fingerprint.

## Coordinate and graph model

The solver uses a 48, 64, or 80 by 36 logical-tile space according to the
confirmed compact, standard, or extended scale. Every region, terrain
rectangle, traversal node, landmark, spawn, and exit must remain within the
declared bounds. IDs use lowercase kebab-case and cannot contain paths.

Traversal is an explicitly directed graph:

- `forward` permits travel only from `from` to `to`;
- `bidirectional` permits travel in both directions;
- there is exactly one spawn node and one distinct exit node;
- every node, including every landmark and the exit, must be reachable from
  spawn;
- each landmark binds exactly one landmark node at the same region and
  coordinates;
- navigation intent binds every graph edge.

These are semantic checks in the TypeScript materializer. JSON Schema provides
the portable shape/profile discriminator layer; consumers should run both.

## Profile invariants

| Profile | Terrain grammar | Collision intent | Navigation intent |
| --- | --- | --- | --- |
| `side-platformer` | terrain bands, including one-way bands | `side-solids` | `platform-links` |
| `topdown-farm` | terrain zones | `topdown-obstacles` | `orthogonal-grid` |
| `isometric-action` | terrain zones | `isometric-footprints` | `diamond-grid` |
| `layered-depth-2d` | terrain zones | `depth-lane-blockers` | `depth-lanes` |

The side-platformer solver derives walk/jump/drop edges from its platform
heights. The other profiles use connected bidirectional walking graphs.
Direct routes form one main path, fork/rejoin routes add a separately reachable
branch and merge, and loop routes add a canonical cycle. These graph semantics
are planning intent, not a claim that every future arbitrary constraint is
already physically solvable.

## Integration points

The constraints and plan are built immediately after
`materializeConfirmedWorldCreationIntake` and before the production-art
workflow or exporter. An Agent-assisted flow should show the structured intent
to the user and pass that confirmed value:

```ts
const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(
  confirmedIntake,
  confirmedLayoutIntent,
);
const plan = await solveWorldLayoutPlanFromConstraints(
  constraints,
  confirmedIntake,
);
const verified = await materializeWorldLayoutPlan(plan, confirmedIntake);
const planSha256 = await fingerprintWorldLayoutPlan(verified);
```

`buildWorldLayoutPlanFromConfirmedIntake(confirmedIntake)` remains the
compatibility facade for older callers. It derives a
`compatibility-derived` constraint artifact first and then invokes the same
solver; there is no remaining fixed-template runtime path.

The delivery workspace writes canonical `world-layout-plan.json` bytes and
binds their semantic fingerprint to the production-art manifest. When a
confirmed plan is supplied to a Pack 0.6–1.0 exporter or Pack 1.0 production
candidate assembler, the packager:

- includes the canonical plan at the pack root;
- records the file and its exact-byte SHA-256 in the pack manifest;
- binds the manifest to the plan ID and schema version;
- rejects a plan whose profile or seed does not match the pack;
- creates `world-material-palette.json`, bound to the exact layout bytes, for
  every newly exported layout-bearing Pack 0.6–1.0.

The attachment is optional so existing packs remain compatible. When present,
the Godot importer verifies the manifest binding, exact file bytes, profile,
seed digest, bounds, references, traversal graph, and source confirmation before
committing an import. It then attaches planning metadata plus spawn, exit,
region, terrain, traversal, and landmark nodes to the imported scene.

Two hashes deliberately serve different boundaries:

- `layout_plan_sha256` is the semantic fingerprint of canonical JSON content;
- `manifest.layout.sha256` is the SHA-256 of the exact file bytes stored in the
  pack, including the trailing newline.

The public components remain provider-neutral and consumer-neutral. Private
applications can adapt their own conversation state to the confirmed intake
contract without placing application names, paths, accounts, prompts, or
internal runtime details in this repository.

## Current runtime boundary

The geometry attachment is marked `profile-layout-v1`. After the exact plan,
palette, and manifest bindings pass validation, the importer deterministically
creates:

- an authoritative logical `TileMapLayer` containing every terrain cell;
- profile-projected terrain polygons;
- `StaticBody2D` collision for solid terrain, one-way terrain, and blocked
  regions;
- `NavigationRegion2D` regions and `NavigationLink2D` traversal edges;
- traversal and landmark markers;
- world-space spawn and exit markers;
- a binding that moves the generated `PlayerSpawn` and player body to the
  confirmed spawn when the scene contains a runtime player.

Layout-bearing imports perform an explicit runtime handoff after the new
geometry has been built successfully. Legacy `WorldCollision`, `Hazards`,
`WorldNavigation`, and `WorldTraversal` nodes remain in the derived scene only
for pack-schema compatibility checks, but are hidden, process-disabled, and
have all collision, monitoring, and navigation participation disabled. The
layout materialization is therefore the only active runtime geometry. The
three trusted player controllers prefer the exact `WorldLayoutPlan/Exit`
marker and fall back to historical `WorldTraversal` only for packs without a
layout attachment.

This handoff advances layout-bearing derived import state to the `layout.4`
generation so a clean older managed import is rebuilt instead of being
incorrectly reported as unchanged. It does not alter the bytes or behavior of
packs without `world-layout-plan.json`.

The projection uses the generated scene's pixel bounds. Top-down, platformer,
and layered-depth plans use bounded linear projection; isometric action uses a
diamond projection. The same plan produces the same scene semantics before and
after `PackedScene` persistence.

`WorldMaterialPalette 1.0` maps every distinct logical material exactly once to
one canonical `terrain.*` role already validated by the pack. The shared Godot
binder crops the role's validated atlas region, creates a deterministic
`TileSetAtlasSource` per material, projects the `TileMapLayer` for the selected
profile, makes it visible, and verifies the saved scene on reload. This is the
same port for all four profiles and for built-in, model-backed, artist-authored,
or optional third-party authoring adapters.

The required rendering mode remains deliberately `single-cell`: it proves exact
asset selection, visible coverage, projection, persistence, and tamper
rejection while providing a safe fallback. The optional
`WorldTerrainAutotileSet 1.0` now binds the exact layout and palette bytes, maps
all 16 N/E/S/W same-material masks to explicit 4 by 4 atlas cells, and replaces
the fallback in the shared Godot layer. The selector works for all four
profiles, survives saved-scene reload, and rejects incomplete or changed input
before mutation.

This adopts the compact, reviewable 16-combination authoring idea used by tools
such as SpriteCook without making any provider a core or runtime dependency.
SpriteCook's published base template uses corner masks, while this first
portable runtime uses edge masks, so an adapter must explicitly transform and
prove the mapping rather than blindly rename an export. The Pack 1.0
internal-review builder and transactional Godot importer now carry the exact
JSON/PNG attachment through manifest, byte, dimension, persistence, and source
snapshot checks. Production entry points for the other three profiles, visual
variants beyond neighbor topology, animated tiles, final art direction,
profile gameplay completion, human art approval, and physical Raspberry Pi
performance remain separate gates. See
[`55_WORLD_TERRAIN_AUTOTILES.md`](55_WORLD_TERRAIN_AUTOTILES.md).

The fixed profile template has been removed from the active builder. Confirmed
route shape now changes graph structure, scale changes bounds, every confirmed
landmark becomes a bound region/node, water and hazard constraints change
terrain/collision inventory, and verticality changes profile-specific
placement. Tests compare a structural topology projection that excludes plan
IDs, hashes, labels, and seed jitter, so metadata changes cannot masquerade as
a different world.

The current solver intentionally selects only material IDs already backed by
each profile's canonical `terrain.*` asset roles. It will not invent a
`volcanic-floor`, `reed-wetland`, or cultural building material and silently
reuse an unrelated tile.

`AssetRequirements 1.0` now compiles the verified constraints and plan into a
provider-neutral, canonical JSON inventory. It reuses
`requiredProductionArtRoles(profile)` as the only complete visual-role source,
then appends narrowly scoped requirements for route shape, scale, verticality,
water, settlement density, hazard level, and landmark count. Every structural
axis changes the semantic inventory rather than only changing a document hash.
When a profile has no honest canonical role for a requested feature—for
example, side-view water or a top-down hazard—the requirement is explicitly
`unresolved`; an unrelated tile cannot silently satisfy it. Runtime-only
scene, collision, and navigation roles never become image tasks.

The artifact contains the constraints and plan digests plus coarse layout
values, but excludes landmark labels, raw dialogue, prompts, references,
filesystem paths, provider/model fields, credentials, and private image
digests.

`ProductionArtRequirementsBinding 1.0` is the small compatibility bridge to
the existing profile-complete `ProductionArtPlan 1.0`. It keeps that plan,
RunSet, provider port, atlas projectors, and Godot contracts unchanged. Each
canonical-role requirement maps to one exact plan task, while unresolved
layout-critical requirements become stable blockers. The binding carries full
canonical SHA-256 values for both source artifacts, not only their shortened
IDs.

The private world-delivery workspace writes `asset-requirements.json` and
`production-art-requirements-binding.json`. The workflow validates both against
the canonical plan and the exact `WorldLayoutPlan`, then includes their bytes
in its existing immutable input digest. Reusing the same workflow ID with a
different world layout or requirement set therefore fails closed. A blocked
binding may be inspected in dry-run mode, but `--execute` stops before reading
a provider credential or making a remote request.

This binding proves requirement-to-task lineage; it is not evidence that final
art exists. Multiple independently addressable atlas cells for one canonical
role remain a future versioned `ProductionArtPlan` capability rather than an
incompatible change to Plan 1.0.

The browser now presents and hashes the structured constraint choices at the
map-layout checkpoint, carries the frozen intent through the application
handoff, displays it again beside the reference generator, and invalidates
that handoff when the user returns to an earlier round.

## Fail-closed behavior

The materializer rejects:

- malformed or source-mismatched layout constraints;
- unsupported constraint enum values and duplicate or missing landmarks;
- unknown properties or unsafe IDs;
- non-canonical profile/terrain/collision/navigation combinations;
- out-of-bounds rectangles and nodes;
- missing or dangling region, terrain, node, and edge references;
- duplicate IDs;
- disconnected traversal or an unreachable exit;
- mismatched spawn, exit, landmark, seed, checkpoint, or intake bindings;
- incomplete navigation edge coverage.

This makes a layout safe to materialize and binds its logical material IDs to
validated production-role artwork without claiming final human art approval.
