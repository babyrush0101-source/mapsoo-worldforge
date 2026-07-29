# Layered-depth 2D Pack 0.9 production projection

## Purpose and status

This deterministic projection adapts the richer Lanternmere Crossing
production candidates to the exact raster geometry hard-coded by
`godot/addons/mapsoo_importer/mapsoo_pack_09.gd`.

The output remains `internal-review` and `UNRELEASED`. It is a compatibility
projection, not evidence of Godot, human-art, public-release, or Raspberry Pi
approval.

The hash-bound projection contract is:

`docs/visual-qa/production-art/layered-depth-2d-pack-atlases-v1.json`

## Exact importer output

The builder emits:

- eight independent runtime layers at exactly 320 x 180;
- `terrain` at 256 x 96;
- `props` at 320 x 96;
- `structures` at 192 x 112;
- `collectibles` at 64 x 32;
- `effects` at 256 x 64;
- `player` at 768 x 72, containing 16 ordered 48 x 72 poses;
- `npc` at 384 x 72, containing eight ordered 48 x 72 poses.

Layers are nearest-neighbour reductions of the independently generated
1280 x 720 production runtime layers. Prop regions are nearest-neighbour
64 x 64 reductions from the 96 x 96 production cells, bottom-centred in the
canonical importer regions. Unused top padding remains transparent.

For each character clip, the projection selects only frame zero: the
independently generated source pose. The declared deterministic synthetic
variant is deliberately omitted. These poses are not claimed to be
model-native temporal animation frames.

## Pack 0.9 alias limitation

Pack 0.9 does not allocate one physical region to every production role.
`mapsoo_pack_09.gd::_role_region` aliases four pairs:

| Physical owner | Importer role sharing the same pixels |
| --- | --- |
| `terrain.ground` | `terrain.stairs` |
| `terrain.path` | `terrain.water` |
| `prop.tree` | `prop.occluder` |
| `structure.entrance` | `structure.landmark` |

The projection therefore contains 18 physical prop/terrain regions serving 22
canonical role bindings. The owner art is used for both names. The independent
production art for `stairs`, `water`, `occluder`, and `landmark` cannot be
preserved by Pack 0.9 and is not represented as independent Pack art.

Removing this limitation requires a later Pack schema/importer with distinct
regions. Changing only the PNG cannot solve it because the importer itself
returns the same rectangle for each alias pair.

## Rebuild and verify

From the repository root:

```powershell
node scripts/build-layered-depth-2d-pack-atlases.mjs
node scripts/verify-layered-depth-2d-pack-atlases.mjs
```

The verifier invokes the builder twice and requires byte-identical PNG and
manifest results. It independently checks:

- hashes of all four source manifests and every source atlas/layer binding;
- the exact 15-file output inventory and importer dimensions;
- every physical region is in bounds and non-empty;
- unused top padding and all zero-alpha RGB are transparent;
- the four alias groups, 18 physical regions, and 22 bound role names;
- 16 player poses and eight NPC poses in canonical order;
- honest first-independent-pose character provenance;
- pending Godot, human-art, and Raspberry Pi gates.

Use `--replace-generated` only for an intentional, reviewed projection change.
Routine local verification and CI must omit that flag.
