# Four-profile visual acceptance

Status: active development gate
Baseline capture: [`visual-qa/four-profile-baseline.png`](visual-qa/four-profile-baseline.png)
Godot side runtime capture: [`visual-qa/alpha10-godot-runtime.png`](visual-qa/alpha10-godot-runtime.png)

Mapsoo validates neutral genre and camera grammar. It does not copy the protected characters, logos, maps, textures, UI, or distinctive art direction of any commercial game.

## Current decision

| Profile | Baseline composition | Complete provider | Godot importer | Production art decision |
| --- | --- | --- | --- | --- |
| Side-view platformer | Pass | Pack 0.7 candidate | Implemented and smoke-tested | Needs refinement |
| Top-down farm | Pass | Pack 0.6 / Alpha9 | Implemented and smoke-tested | Needs refinement |
| Isometric action | Pass | Complete Alpha11 provider | Godot 4.3/4.7 smoke passes | Engineering-art baseline |
| Layered-depth 2D | Pass | Complete Alpha12 provider | Godot 4.3/4.7 smoke passes | Engineering-art baseline |

“Baseline pass” means the deterministic image meets minimum color grouping, value range, edge density, camera, layering, and focal-point checks. It does **not** mean that the full asset generator is production-ready.

## Shared automated checks

- A deterministic 320×180 PNG can be reproduced from the same seed.
- Each profile has an exhaustive acceptance contract.
- Camera grammar and required planes are explicit.
- Quantized color groups, luminance range, and edge density cannot silently collapse below the stored minimum.
- Every profile is labelled `pipeline ready · baseline art` only after its complete provider exists; this label explicitly does not claim finished production artwork. Godot evidence is tracked separately.
- The Pack 0.7 Godot scene must preserve raster pixels across save/reload and pass a real rendered-frame color, contrast, edge, regional-color, and alpha gate.

Run:

```bash
pnpm browser:profile-art:verify
```

The command renders the four-profile browser sheet, validates its machine-readable result, and captures the PNG used for manual review.

## Manual gates

### Side-view platformer

- The traversal silhouette, hazards, checkpoints, exits, and character must remain readable at gameplay scale.
- Foreground decoration must not obscure the playable lane.
- Background planes require transparent compositing and a controlled value hierarchy.
- The generated preview must eventually be rendered from the exported scene, placements, and atlases.

Current issue: the real Godot capture now proves that the layered background, platforms, character, structures, hazards, exit, and foreground render after import. It remains intentionally classified as an engineering-art baseline: the character is tiny, terrain is stretched rather than tiled, and character identity is still mostly expressed through color. The separate browser preview is not yet proof of exact scene/atlas fidelity.

### Top-down farm

- Grass, water, path, and soil need shape or texture differences in addition to color.
- Structures and props must use one ground-contact convention.
- The player and interaction targets must remain distinct from patterned ground.
- Bridges, banks, fences, and crop placement must match the exported runtime scene.

Current issue: the new baseline has a readable farm, path, river, structures, crops, and player, but it is a next-version target. Alpha9 Pack 0.6 remains byte-frozen and still uses its published preview. Character identity and exact runtime-scene fidelity require a later versioned gate.

### Isometric action

- Use an original 2:1 diamond grid, elevation cues, and deterministic Y sorting.
- Keep actors, attacks, hazards, and the walkable arena in distinct value groups.
- Occluding walls and props must follow one front-to-back rule.

Alpha11 candidate status: the complete 36-role provider, Pack 0.8 exporter, three-character/128-clip contract, runtime sidecars, Godot importer, Y-sorted scene, controller and Godot 4.3/4.7 smoke evidence now exist. Enemy combat resolution and Raspberry Pi packaging remain later gates.

### Layered-depth 2D

- Keep the gameplay plane crisp while depth fog, light, and parallax reinforce staging.
- Preserve consistent sprite scale and pixel density in the gameplay plane.
- Foreground and lighting must guide attention instead of hiding traversal.

Alpha12 candidate status: the complete 36-role provider, Pack 0.9 exporter, seven declared depth planes, two-character/24-clip contract, runtime sidecars, independent Godot importer, common foot-point Y sorting, controller and Godot 4.3/4.7 smoke evidence now exist. More detailed occlusion fading and Raspberry Pi packaging remain later gates.

## Release rule

All four profiles now have complete local providers, separate versioned source-pack evidence, and local Godot importer/playable smoke evidence. This supports the phrase “four playable local profile candidates”; it does not mean Alpha10, Alpha11 or Alpha12 are published releases.
