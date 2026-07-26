# Isometric Action Production Terrain v1

## Scope

This package replaces the isometric-action terrain placeholder layer with an
original production-art candidate. It does **not** replace the complete world
asset pack, and it is not yet approved for Godot, Raspberry Pi, or public
distribution.

Runtime consumers must use:

- PNG:
  `docs/visual-qa/production-art/isometric-action-terrain-atlas-v1.png`
- Manifest:
  `docs/visual-qa/production-art/isometric-action-terrain-atlas-v1.json`
- Runtime manifest id: `isometric-action-terrain-atlas-v1`

The current status is `runtime-candidate`, `internal-review`, and
`UNRELEASED`.

## Original art source

The source sheet was produced with Codex built-in image generation in an exact
8 x 4 layout on a solid `#ff00ff` chroma background. The prompt requested
original dark-charcoal masonry, restrained copper-orange edge light, teal
water, an isometric projection, consistent upper-left lighting, no text, no
characters, and no logos. The local default generated original was retained;
the repository contains a copied immutable source candidate:

`docs/visual-qa/production-art/isometric-action-terrain-sheet-source-v1.png`

The visual reference
`docs/visual-qa/production-art/isometric-action-direction-v1.png` was used only
for the project's own palette, masonry material language, projection, and
lighting direction. No third-party game artwork was used as a source asset.

The first 16 source cells contain, in row-major order:

1. void or shadow diamond
2. base floor
3. cracked floor variation
4. floor edge
5. elevation top
6. left riser
7. right riser
8. ramp
9. wall
10. straight waterway
11. corner waterway
12. bridge deck
13. bridge edge
14. stone stairs
15. elevation outside corner
16. damaged floor

The final 16 source cells are intentionally unused. They are recorded in the
source manifest but are forcibly transparent in the runtime atlas.

## Runtime contract

The runtime atlas is 768 x 384 pixels, divided into an 8 x 4 grid of 96 x 96
cells. Its logical ground diamond is 96 x 48 pixels. All mapped sprites have a
two-pixel transparent safety boundary and a `[48, 92]` pivot.

Nine canonical terrain roles are bound by `role_mappings`:

- `terrain.void`
- `terrain.floor.base`
- `terrain.floor.variant`
- `terrain.floor.edge`
- `terrain.elevation.top`
- `terrain.elevation.riser-left`
- `terrain.elevation.riser-right`
- `terrain.ramp`
- `terrain.wall`

Seven helpers are bound by `auxiliary_variants`:

- `waterway.straight`
- `waterway.corner`
- `bridge.deck`
- `bridge.edge`
- `stairs.stone`
- `elevation.outside-corner`
- `floor.damaged`

Every binding includes `column` and `row`; consumers must not infer asset
semantics from image appearance or array position alone.

## Deterministic build and verification

Run from the repository root:

```powershell
node scripts/build-isometric-action-terrain-atlas.mjs
node scripts/verify-isometric-action-terrain-atlas.mjs
```

The builder:

1. pins the immutable source by exact dimensions, byte count, and SHA-256;
2. samples the chroma border and creates a straight-alpha RGBA candidate;
3. removes dark and light magenta spill using distance and hue mattes;
4. detects each mapped source cell within the proportional 8 x 4 grid;
5. crops and nearest-neighbour normalizes every mapped asset to 96 x 96;
6. clears all 16 unmapped runtime cells;
7. rejects nonempty boundary pixels and opaque chroma spill;
8. writes source/RGBA and runtime atlas manifests with bound hashes.

By default, the builder refuses to overwrite a generated file if the bytes
would change. `--replace-generated` exists only for an intentional regeneration
after reviewing a changed matte or source; it must not be used in routine CI.

The strict verifier independently reopens every PNG and manifest and checks:

- safe repository-relative paths;
- exact byte counts, dimensions, and SHA-256 bindings;
- exact manifest identities and unreleased statuses;
- canonical role order and unique 8 x 4 cell coordinates;
- mapped-cell alpha, boundary, and chroma gates;
- complete transparency in all 16 unmapped cells;
- pending human-art, Godot-runtime, and Raspberry-Pi-runtime approvals.

## Remaining acceptance work

Automated sanitation passing is not an art-direction or runtime acceptance.
Before promotion, a human reviewer must inspect the atlas at 1x and 4x, then a
Godot integration test must build a small elevation, ramp, wall, waterway, and
bridge scene. A separate Raspberry Pi 4B run must record import correctness,
frame timing, memory, and camera readability. Until those results are attached,
the package must not be labelled release-ready.
