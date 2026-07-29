# World terrain autotiles

Status: **provider-neutral contract, internal-review export, and transactional
Godot import implemented**

## Why this is a separate optional layer

`WorldLayoutPlan` decides logical geometry. `WorldMaterialPalette` maps each
logical material to a canonical `terrain.*` role and always provides a safe
single-cell rendering fallback. `WorldTerrainAutotileSet 1.0` optionally
improves that rendering with edges, joins, caps, and corners.

Keeping these responsibilities separate avoids three architecture problems:

- a map generator must not understand a particular image provider;
- a provider must not decide collision, navigation, or world completeness;
- a missing or rejected transition sheet must not make an otherwise valid
  world unloadable.

The dependency direction is therefore:

```text
confirmed dialogue
  -> WorldLayoutPlan
  -> WorldMaterialPalette (required when art is bound)
  -> WorldTerrainAutotileSet (optional enhancement)
  -> Godot TileSet / TileMapLayer
```

The autotile document binds the exact SHA-256 bytes of both the layout plan and
material palette. Every palette material must appear exactly once. Each entry
binds one PNG, one canonical terrain role, and all 16 mask-to-atlas
coordinates. Unknown fields, missing materials, repeated cells, wrong image
dimensions, unsafe paths, changed hashes, and reordered masks fail closed.

## Neutral 16-variant convention

The first selection mode is `edge-mask-16`. For each logical cell, Godot sets
four bits when the N/E/S/W neighbor has the same logical material:

| Bit | Value | Neighbor |
| --- | ---: | --- |
| 0 | 1 | north |
| 1 | 2 | east |
| 2 | 4 | south |
| 3 | 8 | west |

Outside the generated layout is always treated as a different material. The
contract does not assume a provider's tile order: it explicitly records the
atlas coordinate for masks `0` through `15`. The default authoring layout is a
4 by 4 row-major sheet, but an adapter may safely reorder another layout by
rewriting only these coordinates.

The Godot selector:

- works for side-platformer, top-down farm, isometric action, and layered-depth
  worlds;
- uses the same logical neighbor algorithm for all profiles;
- keeps the profile-specific orthogonal or diamond projection already applied
  by the material palette;
- creates one `TileSetAtlasSource` per logical material and all 16 declared
  atlas tiles;
- verifies every persisted cell's source and atlas coordinate after scene
  reload;
- rejects invalid input before changing the scene.

`pnpm world-terrain-autotile:godot` runs the contract with local Godot 4.3 and
4.7. CI repeats it on Linux and Windows.

## What is borrowed from existing tools

SpriteCook's open tileset base generator demonstrates a useful, mature
authoring pattern: a compact 4 by 4 sheet that makes all 16 binary combinations
visible and reviewable. WorldForge adopts the compact sheet and explicit
combination-map idea, not SpriteCook's product, UI, account system, response
format, or runtime.

SpriteCook's **15-piece** template is a corner-mask convention. The first
WorldForge runtime contract is an N/E/S/W edge-mask convention because the
existing portable pack and Godot tests already use that semantic. A 15-piece
sheet must therefore never be relabelled as an edge-mask sheet.

SpriteCook's **17-piece** 5 by 5 guide is different: its lower four rows contain
all 16 explicit N/E/S/W connection combinations, plus one separate
inner-corner helper. That gives the implemented local adapter a lossless,
auditable mapping:

1. accept one native user-exported 17-piece PNG;
2. remove the optional one-pixel grid and ignore only the documented blank and
   helper cells;
3. reorder the 16 connection cells into masks `0` through `15`;
4. emit a deterministic metadata-free 4 by 4 PNG and source/output hash report.

All dimension, hash, role coverage, privacy, rights, human-review, pack, and
runtime gates remain owned by WorldForge. Removing the adapter leaves the
offline baseline and single-cell fallback operational.

### Local 17-piece import

In SpriteCook's Tileset Base Generator select:

- `17-piece`;
- tile size `16`, `32`, or `64`;
- optional `Black grid`;
- leave `1024 upscale` off.

Then normalize the downloaded PNG locally:

```bash
pnpm terrain-autotile:spritecook:import -- \
  --source <spritecook-17-piece.png> \
  --out <worldforge-edge-mask-16.png> \
  --report <worldforge-edge-mask-16.json> \
  --target-cell 32
```

The command makes zero network requests. The report contains hashes,
dimensions, adapter identity, and all 16 source-to-target cells; it contains no
source path, prompt, credential, or remote response. Existing output is not
overwritten. The `15-piece` corner-mask mode and `1024 upscale` mode are
rejected rather than guessed.
The report is validated by
`mapsoo-terrain-autotile-authoring-import-1.0.schema.json`.

The normalized PNG is only an authoring candidate. Importing it does not prove
that an AI preserved seams, that each cell has the intended material, that the
source may be redistributed, or that public release is authorized. The report
therefore fixes `human_review` to `required` and `public_release` to
`not-authorized`.

The adapter is intentionally local-file only. SpriteCook's public API currently
documents generic generation and animation requests, but the WorldForge core
does not need its account, key, polling, billing, or response format. A future
remote wrapper may download a user-authorized PNG and call this exact same
normalizer without changing the pack or Godot contracts.

Normalize one 17-piece result for every layout material, then copy
`config/terrain-autotile-review-input.example.json` beside those local files
and adjust only its material/source mappings. The input file is operator-local:
its `source` paths are resolved relative to that JSON and are never embedded.
Attach the set to an existing top-down production review build with:

```bash
pnpm production-art:review-pack:build -- \
  --base-pack <base.zip> \
  --runs-manifest <production-art-run-set.json> \
  --out <review.zip> \
  --pack-id <lowercase-kebab-id> \
  --title <review-title> \
  --created-at <canonical-UTC-ISO> \
  --terrain-autotiles <terrain-autotile-review-input.json>
```

The builder independently reopens every PNG, rejects metadata and wrong
dimensions, verifies complete material coverage, regenerates every hash and
binding, and keeps the resulting archive non-redistributable.

### Separate 2:1 isometric geometry reference

SpriteCook's current `Isometric 2:1` mode is **not** an autotile transition
sheet. It exports a rectangular grid of separated 2:1 diamonds:

- tile width `32` or `64`;
- tile height exactly half the width;
- `2px` outer inset and `2px` gaps;
- operator-selected `1-16` columns and rows;
- native output or an optional centered `1024x1024` upscale.

Those cells have no N/E/S/W mask meaning. Assigning them to
`WorldTerrainAutotileSet` masks would invent semantics and could create broken
material joins. WorldForge therefore routes this mode through the existing
production-art **reference** boundary instead of the runtime autotile boundary.

Normalize one native export locally:

```bash
pnpm production-art:spritecook:isometric-reference -- \
  --source <spritecook-isometric-2-1.png> \
  --out <worldforge-isometric-terrain-geometry.png> \
  --report <worldforge-isometric-terrain-geometry.json>
```

The adapter verifies every gap, inset, cell and diamond boundary, but copies no
source pixels or colors. It independently renders a metadata-free,
CC0-licensed `768x384` guide matching the existing `isometric-action`
`terrain-sheet` task: an `8x8` grid of `96x48` cells with the nine declared
terrain-role footprints populated and all undeclared cells transparent. The
report is validated by
`mapsoo-production-art-geometry-reference-import-1.0.schema.json`.

The guide can then be passed as the optional second environment reference while
the accepted scene direction remains the first, style-bearing reference:

```bash
pnpm production-art:model -- \
  --profile isometric-action \
  --task terrain-sheet \
  --world-brief-file <private-brief.txt> \
  --style-bible-file <private-style.txt> \
  --approved-direction <accepted-scene-direction.png> \
  --environment-reference <worldforge-isometric-terrain-geometry.png> \
  --environment-reference-id isometric-terrain-geometry-guide \
  --quality medium \
  --execute --allow-remote-upload
```

This reuses the existing provider authorization, reference hashing,
normalization, review-pack projection and Godot path. The adapter is not a
provider, does not call SpriteCook or another image API, and does not create a
second isometric pack format. Its output is a geometry reference only—not final
art, a runtime asset, a transition sheet, or evidence of human approval.

## Pack and importer boundary

`buildPack10ProductionReviewCandidate()` accepts an optional neutral authoring
artifact only when it also receives the exact `WorldLayoutPlan`. It requires a
complete set of metadata-free 256 by 128 PNGs (4 by 4 cells at 64 by 32),
derives their hashes, writes the canonical JSON, and keeps the result
`LicenseRef-UNRELEASED`, non-redistributable, non-commercial, and at all review
gates `pending`.

The existing `buildProductionReviewPack()` now accepts the same neutral
authoring shape for `topdown-farm`, `side-platformer`, and `isometric-action`.
It requires respectively `32x32`, `32x32`, and `64x32` cells and exact layout
and material-palette bytes from the base pack. The SpriteCook 17-piece adapter
currently supplies the first real `topdown-farm` path; other providers may
produce the same neutral PNGs without changing the builder.

The Pack schemas expose an optional `terrain_autotiles` binding chained to both
layout and palette hashes. The Godot importer:

- admits only manifest-recorded JSON and PNG files with exact byte hashes;
- decodes PNGs under the existing file and decoded-pixel budgets;
- verifies dimensions, full material coverage, and all 16 unique mappings;
- creates lossless portable textures so pixels survive `PackedScene` reload;
- applies the shared selector only after the single-cell palette succeeds;
- validates saved-scene atlas coordinates before committing the import;
- rechecks the complete source snapshot before promotion;
- rejects orphan JSON and chained-hash tampering.

The controlled Pack 1.0 importer smoke sends a real four-material attachment
through that full transaction on Godot 4.3 and 4.7. Packs without the optional
field retain the single-cell path and their no-layout schema projection strips
all three optional layout-related definitions.

## Remaining work

The generic contract, all four internal-review builder boundaries, and Godot
importer are implemented. Remaining work is:

- generate and review a real isometric terrain result using the new 2:1
  geometry reference; runtime multi-material transitions still require an
  independently authored mask-aware sheet rather than relabelling the guide;
- add visual seam and topology review captures using real generated or
  artist-authored transition sheets;
- decide whether approved public packs may include the images only after
  explicit rights and human-art gates pass.

Human art-direction approval, redistribution rights, and Raspberry Pi 4B
physical performance remain independent release gates.

## External references

- [SpriteCook Tileset Base Generator](https://www.spritecook.ai/tileset-base-generator)
- [SpriteCook open top-down tileset generator (MIT)](https://github.com/SpriteCook/spritecook-tileset-gen)
- [SpriteCook public API documentation](https://www.spritecook.ai/api-docs)
