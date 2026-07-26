# Alpha10: complete side-platformer world assets

Status: contract implementation in progress. Nothing in this document is a published Alpha10, external-adoption, External Host-production, itch.io, model-understanding, or gameplay claim.

## Outcome

Alpha10 targets one honest vertical slice:

> one local environment reference + one local character reference + a public-safe description + seed → a deterministic, validated, portable `side-platformer` world asset pack → a separately installed Godot 4.3+ importer derives a side-view scene.

Generation Request `1.0.0` already carries the required profile, description, seed and two reference descriptors, so it remains unchanged. Alpha9 Pack `0.6.0`, its receipt schema, fixtures, release attachments and hashes remain immutable. Alpha10 introduces a new generated-bundle `0.2.0`, Pack `0.7.0` and `side-platformer-complete-v1` contract.

## Complete asset contract

The bundle must bind exactly one canonical asset for every role below.

### Terrain, hazards and moving surfaces

- `terrain.solid`
- `terrain.one-way`
- `terrain.slope-up`
- `terrain.slope-down`
- `terrain.wall`
- `terrain.ceiling`
- `hazard.spikes`
- `hazard.pit`
- `hazard.moving-platform`

### Props, structures and collectibles

- `prop.crate`, `prop.rock`, `prop.plant`, `prop.sign`, `prop.lamp`, `prop.breakable`
- `structure.entrance`, `structure.exit`, `structure.checkpoint`
- `collectible.primary`, `collectible.health`

### Depth presentation

- `background.sky`
- `background.far`
- `background.mid`
- `background.near`
- `foreground.overlay`

### Character and runtime

- `character.player.atlas`
- `world.collision`
- `world.navigation`
- `world.scene`
- `world.preview`

The preview must be rendered from the exported scene and atlases. A single concept image, one platform strip, or an unrelated provider preview is not a complete world pack.

## Character identity and animation

The character reference influences the side-view player atlas while the environment reference influences the world palette and shapes. This is deterministic procedural derivation in the current offline baseline, not semantic image understanding or guaranteed style fidelity.

The first contract requires explicit left and right frames for all six actions:

- `idle.left/right`
- `run.left/right`
- `jump.left/right`
- `fall.left/right`
- `land.left/right`
- `hurt.left/right`

Each clip has 1–32 bounded atlas frames and an FPS greater than zero and at most 60. The importer must not invent mirroring. Frame size and pivot are versioned data, not importer guesses. A later schema may add explicit `mirror_of`, foot point and collider geometry without changing the Alpha10 contract.

## Portable runtime contract

Pack 0.7 uses a top-left, X-right, Y-down pixel coordinate space. Rectangles are `[x, x + width) × [y, y + height)`. Spawn is the player world origin in pixels and must match between manifest and scene data.

Alpha10 fixes the remaining atlas and placement interpretation as follows so independent importers do not guess:

- background and foreground images fill the declared world bounds;
- structure and ordinary 32-pixel placement coordinates are bottom-left anchors, rendered with the sprite bottom aligned to `y`;
- a hazard placement whose ID matches a hazard rectangle is scaled into that top-left half-open rectangle, so its art and `Area2D` cover the same pixels;
- atlas slots follow canonical role order within their family: six 32-pixel terrain columns, three hazard columns, six prop columns, three 32×64 structure columns and two collectible columns;
- the traversal sidecar remains an explicit directed platform graph. It is preserved as markers plus edge metadata and is never converted into a top-down `NavigationRegion2D`.

These conventions are frozen for Pack 0.7. A future schema must version any different anchor, atlas-region or traversal interpretation explicitly.

The scene sidecar must describe bounded placement for terrain, one-way platforms, slopes, hazards, props, structures, collectibles, moving platforms, spawn, checkpoints, goal and parallax layers.

The collision sidecar must distinguish solid geometry, one-way surfaces, slopes, hazard regions, kill plane and moving-platform collision. Godot may derive `StaticBody2D`, one-way `CollisionShape2D`, hazard `Area2D` and `AnimatableBody2D`; it must not treat all geometry as Alpha9-style blocked farm cells.

The navigation sidecar is a deterministic platform traversal graph, not a top-down `NavigationPolygon` and not a claim that `NavigationAgent2D` performs platform pathfinding. Nodes and `walk`, `jump`, `drop`, or `ride` edges must be bounded; at least one platform transition must exist, and spawn must reach goal under the declared agent limits.

Parallax data binds at least far, mid and near backgrounds with explicit stable z-order and bounded scroll scales. Godot derives these as `Parallax2D` layers where supported by the declared minimum engine version.

## Godot acceptance

The exact candidate ZIP must pass Linux and Windows with Godot 4.3 and 4.7:

1. first import reports `created`;
2. the clean repeat reports `unchanged` without rewriting managed bytes;
3. the generated scene and resources load;
4. profile/schema metadata, layer order, atlas regions, twelve clips, pivot, spawn, parallax and traversal graph match portable data;
5. real physics checks prove solid landing, one-way landing from above and pass-through from below, plus hazard entry;
6. modified managed output returns `conflict` and is preserved;
7. invalid geometry, digests, roles, frames, spawn, reachability or cross-profile data fail before commit;
8. all historical Alpha1–Alpha9 exact-pack imports remain green.

## Stop conditions

Alpha10 cannot be released if it:

- removes any canonical role or animation merely to make a fixture pass;
- uses a farm `NavigationPolygon` as platform traversal evidence;
- claims slopes, one-way collision, hazards or parallax without real portable data and Godot checks;
- changes Alpha9 schemas, attachments or pinned hashes;
- embeds reference bytes, private paths, raw digests, free-text descriptions or private External Host content in the public pack;
- claims a player controller, combat, platform physics tuning, complete game, external adoption, or External Host production integration.

## Implementation order

1. strict bundle/profile dispatch and negative tests;
2. Pack 0.7, sidecar schemas and receipt version;
3. deterministic procedural side provider and real browser export;
4. deterministic exporter and privacy/rights gates;
5. independent Godot 0.7 validator and scene builder;
6. four-quadrant Godot CI and historical regression;
7. release audit, immutable attachment ledger and public prerelease.
