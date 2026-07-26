# Production art human review

Status: review procedure ready; no candidate is human-approved yet.

Automated checks can prove dimensions, alpha, hashes, role coverage, pivots,
collision bindings and scripted Godot routes. They cannot decide whether a
character feels alive, a palette is attractive, an attack reads correctly or a
world is good enough to publish. Every production profile therefore remains
`UNRELEASED` until a person reviews the actual exported assets and rendered
Godot scene.

## Current review targets

These are the exact files to review. The static preview is a deterministic
asset-only composition; the runtime render is captured by Godot after binding
the same candidate assets.

| Profile | Asset-built preview | Godot runtime render | Decision |
| --- | --- | --- | --- |
| Side platformer | [`5e6adab2…`](visual-qa/production-art/side-platformer-production-preview-v1.png) | [`17035a97…`](visual-qa/production-art/side-platformer-production-godot-4.3-v1.png) | `not-reviewed` |
| Top-down farm | [`9104ee7a…`](visual-qa/production-art/topdown-farm-production-preview-v1.png) | [`f7f28825…`](visual-qa/production-art/topdown-farm-production-godot-4.3-v1.png) | `not-reviewed` |
| Isometric action | [`4c3d6ddb…`](visual-qa/production-art/isometric-action-production-preview-v1.png) | [`982e0249…`](visual-qa/production-art/isometric-action-production-godot-4.3-v1.png) | `not-reviewed` |
| Layered-depth 2D | [`687903d5…`](visual-qa/production-art/layered-depth-2d-production-preview-v1.png) | [`6fcecdf3…`](visual-qa/production-art/layered-depth-2d-production-godot-4.3-v1.png) | `not-reviewed` |

The complete digests remain in each adjacent JSON evidence record; shortened
digests in this table are labels, not verification inputs.

## Review order

Review each profile in this order:

1. direction image at fit-to-window;
2. terrain and prop atlases at 1× and 4× nearest-neighbour zoom;
3. character atlas at 4×, then every animation in Godot;
4. final static preview;
5. live movement from entrance to exit;
6. collision overlay and navigation route;
7. Raspberry Pi capture when available.

Do not approve a profile because only its direction image looks good. The
direction image is not part of the runtime pack.

## Common decision questions

For each question choose `pass`, `revise`, or `not-reviewed`:

- Does the same player remain recognizable across camera profiles?
- Are the world materials and palette coherent?
- Do character, buildings, props and terrain share a believable scale?
- Are entrance, checkpoint, objective and exit immediately readable?
- Are foreground layers decorative without hiding the player or route?
- Do collisions match the visible surfaces?
- Does the route remain readable without arrows or debug overlays?
- Do movement and attack frames communicate their action and direction?
- Are synthetic animation variants visually acceptable after their origin is
  disclosed?
- Are any cells contaminated by chroma colour, grid lines or neighboring
  sprites?
- Does the world avoid recognizable copying of a commercial game's characters,
  map, interface or exact visual composition?

## Profile-specific checks

### Side platformer

- rising and descending slope art matches the collision angle;
- the wall communicates that it must be jumped;
- player feet stay on the ground during idle, run, jump, fall and land;
- rear layers create depth without competing with hazards and the exit.

### Top-down farm

- water banks, bridge, paths and crop plots join coherently;
- player size is credible relative to the house and barn;
- four directions read correctly;
- crops have a clear growth sequence;
- the bridge route is visually and physically open.

### Isometric action

- the `64 × 32` Pack projection retains enough detail from the `96 × 96`
  production mother atlas;
- elevation, walls and ramps share one projection and light direction;
- player, melee enemy and ranged enemy remain distinct during combat;
- attack, projectile, impact, dash and hazard telegraph effects are not confused;
- the exit remains readable during combat effects;
- one-frame Pack 0.8 compatibility clips are acceptable only as an alpha
  fallback; the richer two-frame production atlas must remain available.

### Layered-depth 2D

- sky, far, mid, fog, near and foreground planes create depth without visible
  seams;
- ambient and local lighting do not crush character silhouettes;
- player and NPC remain readable across near/far depth lanes;
- foreground occluders do not cover critical landmarks for too long;
- bridge, stairs and water agree with the collision and shallow-depth route.

## Recording a decision

Human review records must not contain names, account emails, private project
identifiers or source image paths. Use an opaque reviewer id such as
`reviewer-owner-01`.

A valid approval record must bind:

- profile and review id;
- exact preview SHA-256;
- exact Godot render SHA-256;
- each question and its decision;
- requested revisions, if any;
- an explicit `approved` or `blocked` release decision.

Until every canonical gate has evidence and the human gate is `human-pass`, the
production-world review contract requires `release_decision: blocked`.
