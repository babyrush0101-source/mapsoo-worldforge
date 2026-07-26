# Isometric-action props, hazards and effects

> Status: internal review only. Every artifact in this pipeline is
> `UNRELEASED`. No Godot, Raspberry Pi, human-art-review or public-release gate
> is claimed here.

## Emberglass Foundry source direction

This pipeline contains original Emberglass Foundry material: dark stone,
oxidized copper, molten amber, cyan emberglass and restrained violet effects.
The existing isometric-action direction image was used only for camera,
material scale, palette discipline and pixel-cluster language.

The built-in image generator produced a 6×4 chroma-key generation original.
That untouched generated bitmap is retained as
`isometric-action-prop-sheet-generation-v1.png`. The deterministic builder:

1. verifies that generation original by byte length and SHA-256;
2. applies a fixed hard matte against its sampled magenta key and contracts one
   key-coloured edge pixel to remove the generated chroma fringe;
3. separates the 20 requested subjects with recorded source bands and removes
   disconnected cross-cell generation fragments;
4. applies one common scale and bottom-centres them into a strict 6×4 source
   grid with exact `#ff00ff` background;
5. emits the matching transparent RGBA review sheet;
6. crops and normalizes the same subjects into an 8×8 runtime atlas with 96px
   cells and a common `[48, 96]` bottom pivot.

The 20 canonical roles are:

- `hazard.contact`, `hazard.telegraph`
- `prop.blocker`, `prop.breakable`, `prop.cover`, `prop.decoration`,
  `prop.light`
- `structure.entrance`, `structure.exit`, `structure.checkpoint`
- `collectible.primary`, `collectible.health`
- `effect.player-attack`, `effect.enemy-attack`, `effect.projectile`,
  `effect.impact`, `effect.dash`, `effect.spawn`, `effect.defeat`,
  `effect.shadow`

The remaining four source cells and 44 runtime cells must remain transparent.
The source and runtime manifests bind every canonical role to an exact cell,
record the relative-scale policy and preserve the internal-review limitations.

Build and verify:

```powershell
node scripts/build-isometric-action-prop-atlas.mjs
node scripts/verify-isometric-action-prop-atlas.mjs
```

The strict verifier checks original-image provenance, deterministic matte
settings, exact chroma background, strict cell containment, role coverage,
runtime digests, common pivot alignment and fully transparent unmapped cells.
Role semantics remain a manual-review gate, while Godot, Raspberry Pi and human
approval remain explicitly pending.
