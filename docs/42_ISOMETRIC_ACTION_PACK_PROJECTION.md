# Isometric action Pack 0.8 art projection

Status: internal runtime candidate; public release remains blocked.

The reviewed production-art working atlases use `96 × 96` cells because that
gives image generation, chroma cleanup and human inspection enough room for
elevation faces and tall structures. Existing Pack Schema `0.8.0` is already
versioned around a `64 × 32` diamond grid and exact Godot importer atlas
dimensions. The production source contract must not silently change that
portable format.

`scripts/build-isometric-action-pack-atlases.mjs` therefore performs an explicit,
hash-bound nearest-neighbour projection:

```text
96 × 96 reviewed cell
  -> scale 2/3
  -> bottom-centre in the canonical Pack 0.8 region
  -> ten exact importer atlases
```

The generated manifest is
[`isometric-action-pack-atlases-v1.json`](visual-qa/production-art/isometric-action-pack-atlases-v1.json).
It binds the exact production terrain and prop manifests, their source atlas
digests, every canonical role, every Pack region and every projected PNG digest.

The ten outputs match the existing importer contract:

| Atlas | Exact size | Canonical roles |
| --- | ---: | ---: |
| terrain | `576 × 64` | 9 |
| hazards | `128 × 64` | 2 |
| props | `320 × 96` | 5 |
| structures | `192 × 96` | 3 |
| collectibles | `64 × 32` | 2 |
| effects | `448 × 64` | 7 |
| shadows | `64 × 32` | 1 |
| player | `2304 × 64` | 48 clips |
| enemy melee | `1920 × 64` | 40 clips |
| enemy ranged | `1920 × 64` | 40 clips |

Build and independently verify:

```powershell
node scripts/build-isometric-action-pack-atlases.mjs
node scripts/verify-isometric-action-pack-atlases.mjs
```

The current projection binds 29 environment/effect roles and 128 character clips,
and passes exact dimensions, canonical ordering, non-empty regions, source
integrity and deterministic PNG checks. Production character atlases keep two
runtime frames per clip; Pack 0.8 projects the first independently generated
source pose from every clip because the existing importer contract has one
horizontal frame slot per clip. This downgrade is explicit and hash-bound rather
than misrepresented as full production animation.

A complete Pack 0.8 ZIP, Godot 4.3/4.7 import, scripted traversal, human art review
and Raspberry Pi 4B measurement remain separate gates.
