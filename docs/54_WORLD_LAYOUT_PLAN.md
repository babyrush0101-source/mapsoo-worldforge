# WorldLayoutPlan 1.0

`WorldLayoutPlan 1.0` is the provider-neutral boundary between a confirmed
world-creation conversation and later art/runtime stages. It describes playable
space and intent only. It does not contain model prompts, provider request IDs,
generated bitmap paths, engine scene syntax, exporter options, or consumer
application fields.

## Contract files

- JSON Schema:
  `schemas/mapsoo-world-layout-plan-1.0.schema.json`
- TypeScript materializer, validator, deterministic builder, and fingerprint:
  `src/core/world-layout-plan.ts`
- Positive and negative conformance tests:
  `src/core/world-layout-plan.test.ts`

The builder accepts only a validated `ConfirmedWorldCreationIntake 1.0`.
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

The canonical builder uses a 64×36 logical-tile space. Every region, terrain
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

The side-platformer canonical graph uses explicit forward jump/drop edges and a
bidirectional final walking edge. The other profiles use connected
bidirectional walking graphs. These graph semantics are planning intent, not
engine physics.

## Integration points

The intended insertion point is immediately after
`materializeConfirmedWorldCreationIntake` and before any production-art
workflow or exporter:

```ts
const plan = await buildWorldLayoutPlanFromConfirmedIntake(confirmedIntake);
const verified = await materializeWorldLayoutPlan(plan, confirmedIntake);
const planSha256 = await fingerprintWorldLayoutPlan(verified);
```

Downstream systems may translate `regions`, `terrain_layout`,
`collision_intent`, and `navigation_intent` to engine-specific formats. That
translation is deliberately outside this contract. No exporter or importer is
coupled to version 1.0 in this change.

## Fail-closed behavior

The materializer rejects:

- unknown properties or unsafe IDs;
- non-canonical profile/terrain/collision/navigation combinations;
- out-of-bounds rectangles and nodes;
- missing or dangling region, terrain, node, and edge references;
- duplicate IDs;
- disconnected traversal or an unreachable exit;
- mismatched spawn, exit, landmark, seed, checkpoint, or intake bindings;
- incomplete navigation edge coverage.

This makes a layout safe to hand to a later art or runtime stage without
claiming that art, collision geometry, navigation meshes, or an engine scene
have already been produced.
