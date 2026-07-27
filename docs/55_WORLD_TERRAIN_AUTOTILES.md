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

SpriteCook describes its base template as a corner-mask convention. The first
WorldForge runtime contract is an N/E/S/W edge-mask convention because the
existing portable pack and Godot tests already use that semantic. An adapter
must therefore inspect or transform a SpriteCook export; it must never relabel
a corner-mask sheet as an edge-mask sheet without proving the mapping.

The intended thin adapter has only two responsibilities:

1. accept a user-exported or API-returned candidate PNG under the user's own
   authorization and license;
2. normalize it into the neutral 4 by 4 PNG plus explicit mask-coordinate
   metadata.

All dimension, hash, role coverage, privacy, rights, human-review, pack, and
runtime gates remain owned by WorldForge. Removing the adapter leaves the
offline baseline and single-cell fallback operational.

## Pack and importer boundary

`buildPack10ProductionReviewCandidate()` accepts an optional neutral authoring
artifact only when it also receives the exact `WorldLayoutPlan`. It requires a
complete set of metadata-free 256 by 128 PNGs (4 by 4 cells at 64 by 32),
derives their hashes, writes the canonical JSON, and keeps the result
`LicenseRef-UNRELEASED`, non-redistributable, non-commercial, and at all review
gates `pending`.

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

The generic contract and importer work for all four profiles, while the first
production authoring entry point is intentionally limited to the
non-redistributable Pack 1.0 layered-depth review builder. Remaining work is:

- expose the same optional authoring input from the other three
  non-redistributable production-review builders without changing published
  historical pack bytes;
- implement and test one actual SpriteCook/user-export adapter against the
  neutral boundary;
- add visual seam and topology review captures using real generated or
  artist-authored transition sheets;
- decide whether approved public packs may include the images only after
  explicit rights and human-art gates pass.

Human art-direction approval, redistribution rights, and Raspberry Pi 4B
physical performance remain independent release gates.

## External references

- [SpriteCook Tileset Base Generator](https://www.spritecook.ai/tileset-base-generator)
- [SpriteCook open 4 by 4 tileset generator (MIT)](https://github.com/SpriteCook/spritecook-tileset-gen)
- [SpriteCook public API documentation](https://www.spritecook.ai/api-docs)
