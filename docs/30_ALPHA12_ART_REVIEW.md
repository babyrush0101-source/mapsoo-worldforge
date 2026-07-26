# Alpha12 art review

Status: four-profile baseline pipeline pass / production-art fail; first side-platformer production candidate is conditional-review.

Reviewed evidence: [`visual-qa/four-profile-baseline.png`](visual-qa/four-profile-baseline.png)

The first higher-quality direction candidate is documented in
[`31_PRODUCTION_ART_PIPELINE.md`](31_PRODUCTION_ART_PIPELINE.md). It is review evidence,
not yet a replacement asset pack.

## Decision

The four images are engineering-art placeholders. They are good enough to validate camera grammar, depth layers, traversal readability, character scale, asset roles, and the Godot import/runtime pipeline. They are not yet itch.io-quality production asset packs.

The project should say:

> Four complete local asset pipelines with replaceable baseline art.

It should not yet say:

> Four finished professional art packs generated from reference images.

## What must be replaced

Production generation must replace the complete role set, not only the preview:

- tileable terrain, transitions, banks, walls, platforms, and elevation pieces;
- buildings, vegetation, props, interactables, hazards, exits, and effects;
- player and NPC atlases with coherent actions, directions, pivots, and scale;
- parallax, fog, lighting, foreground, and depth layers;
- collision, navigation, spawn, slots, and placements derived from those exact assets;
- a final preview rendered from the exported scene and atlases.

The versioned roles, atlas coordinates, clip manifests, collision data, navigation data, and trusted Godot importers are the replacement contract. Higher-quality art can be substituted without redesigning the runtime.

## Baseline visual findings

| Profile | Readability | Layering | Asset richness | Production decision |
| --- | --- | --- | --- | --- |
| Side platformer | clear route, hazard, exit | clear parallax bands | simple stretched blocks and tiny actor | fail |
| Top-down farm | clear farm, river, path, buildings | clear orthogonal ground order | flat colors and limited texture/transition detail | fail |
| Isometric action | clear arena, actors, effect focal point | convincing 2:1 depth order | simple geometry and sparse prop language | fail |
| Layered-depth 2D | clear gameplay baseline and depth | seven-plane intent is readable | sparse scene and minimal occlusion/material detail | fail |

The shared pink/amber character is visually traceable across profiles at a basic level, but current identity preservation is geometric only: silhouette, four-color palette, anchors, and pivots. It does not yet preserve semantic hair, face, clothing, equipment, or body-proportion cues.

## First side-platformer production candidate

Reviewed evidence:
[`visual-qa/production-art/side-platformer-production-preview-v1.png`](visual-qa/production-art/side-platformer-production-preview-v1.png)

Decision: this is a real-art runtime candidate, not the procedural placeholder, but it
still fails the production/public-release art gate and needs revision before pack release.

What passes visual inspection:

- the riverside settlement has a coherent cool-blue palette, warm landmark lights,
  and convincing far/middle/near/foreground separation;
- the player retains the magenta jacket and amber scarf identity and reads clearly
  against the environment;
- the ground, stone, timber, foliage and water material families feel related;
- entrance-to-exit direction remains readable at a glance.

What must be revised or proved:

- the repeated upper-platform strip is brighter and flatter than the surrounding
  material language and still reads like an inserted gameplay/debug layer;
- entrance and exit now pass explicit visibility, near-opaque foreground coverage,
  and exit contrast thresholds; checkpoint contrast and human composition review
  remain open;
- several atlas props differ in pixel density, lighting and apparent scale from the
  generated background architecture;
- the player foot pivot is aligned to the main-ground top at `y=576`; character v2
  is 73–88 pixels tall (roughly 1.5–1.83 terrain tiles) with at most two pixels of
  foot-anchor error, but final character-to-structure scale still needs human review;
- character v2 now binds 12 clips and 28 distinct runtime frames (idle 2, run 4,
  jump/fall/land/hurt 2 in both directions). These are declared deterministic
  post-process motion variants, not independent model-native or hand-drawn limb frames;
- the entrance is now fully visible and the exit is 99.42% visible with only 0.58%
  near-opaque foreground coverage; the broader gameplay band still needs human review;
- the prop sanitizer cleared all 18 non-empty source cells outside the fourteen
  mapped roles and verifies that every one of the 50 unmapped atlas cells is transparent;
- animation semantics, edge caps, slopes, transitions, hazards and effects require
  frame-by-frame or role-by-role inspection, not only a whole-scene preview;
- the visible slopes and wall now have exact terrain-cell references and bound
  triangle/rectangle collision shapes; Godot 4.3/4.7 physically traverse both
  slopes, jump the wall and reach the exit. Hazard collision, upper-platform
  traversal and pathfinding-agent consumption remain unproved;
- final acceptance still requires user human approval and Raspberry Pi 4B runtime
  evidence.

The correct replacement strategy is role-by-role substitution through the versioned
contract. The procedural pack remains the deterministic fallback; accepted production
art is bound into the same roles instead of destructively overwriting the baseline.

## Production-art acceptance gate

A future model or artist-backed provider must pass all of the following:

1. Decode and use environment pixels rather than only their file digest. The Alpha12 worktree now has a first local-only implementation for palette, value bands, horizon, edge density, detail scale, and color temperature; object/material semantics remain future work.
2. Produce a structured art-direction analysis: palette, value hierarchy, material/texture scale, horizon/depth, dominant forms, and landmark contrast.
3. Generate every required role and animation, with no placeholder rectangles or unrelated preview composition.
4. Render the approval sample and final preview from the same exported atlases and scene data.
5. Preserve the selected character's semantic identity across all requested actions and directions.
6. Pass tile seams, alpha bounds, pivot, sprite-density, collision alignment, navigation, contrast, and occlusion checks.
7. Avoid copying protected characters, maps, logos, textures, UI, or distinctive commercial-game art.
8. Receive a human art review before release.

The procedural provider remains valuable as the deterministic, free, offline fixture and fallback. It should remain visibly labelled as baseline art after a higher-quality provider is introduced.
