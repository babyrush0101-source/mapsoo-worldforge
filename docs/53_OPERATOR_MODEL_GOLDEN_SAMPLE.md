# Operator-model golden sample

Status: **complete real model candidate, standard internal review pack/PCK, and
exact Godot traversal proof; human art, rights, and physical Raspberry Pi
approval pending**

This proof answers a narrower but essential question than the synthetic Pack
1.0 fixture: can one confirmed neutral world identity produce every canonical
image task for a playable 2D profile, survive strict atlas materialization, and
load as a traversable world in real Godot?

The answer is now **yes for an internal side-platformer candidate**, with the
limitations below. It is not yet a publishable golden sample.

## Source-free world identity

The proof uses the public-safe Blue Harbor identity from the four-profile
direction protocol:

- rainy blue-gray harbor at dawn with warm brass signal lights;
- wet stone, dark timber, moss, reeds, dock ropes, arches and beacon posts;
- split twin lighthouse as the destination landmark;
- portable lantern traveler with black forelock, mustard scarf, teal weather
  coat, copper satchel and compact lantern.

No private consumer name, user id, user biography, local path, daemon field,
NPC record or private launch payload is included in this document or in the
public implementation.

## Canonical output

The side-platformer plan contains exactly nine image tasks:

| Task | Canonical output | Materialized content |
| --- | --- | --- |
| scene direction | `1536 × 1024` | world, camera, route and landmark direction |
| terrain sheet | `384 × 192`, `8 × 4` grid | 6 terrain roles |
| prop sheet | `512 × 512`, `8 × 8` grid | 14 hazard, prop, structure and collectible roles |
| player atlas | `1024 × 768`, `8 × 6` grid | 28 canonical pose cells |
| sky | `1920 × 1080` | opaque rear sky |
| far background | `1920 × 1080` | transparent far harbor and twin lighthouse |
| middle background | `1920 × 1080` | transparent architecture and bridges |
| near background | `1920 × 1080` | transparent edge framing |
| foreground overlay | `1920 × 1080` | sparse reeds, ropes and rain |

All nine normalized candidates are hash-bound under an ignored operator review
directory. Their deterministic composite is `1280 × 720`, 1,792,392 bytes, at
SHA-256
`f6c046627abf1c985c193726b048c3179da4267730d3833f5bf3a5be6d1f1d9f`.
The source and normalized bitmaps remain `UNRELEASED` and are not committed.

## What the live run exposed

Fourteen model requests were needed for the nine canonical tasks and subsequent
art corrections:

1. the terrain request returned six attractive subjects in reading order but
   not inside the requested engineering cells;
2. the prop request contained fourteen intended subjects plus one detached
   82-pixel fragment;
3. the first player request returned only 18 of the required 28 poses;
4. the second player request returned 27 poses;
5. a targeted correction supplied the 28th pose;
6. the first foreground correction painted a transparency checkerboard and was
   rejected before admission;
7. a chroma-keyed foreground correction cleared the spawn and exit but required
   soft-matte despill before it was visually clean;
8. a direction-specific player correction still failed to make every left pose
   face left and was not admitted.

This is why a user-facing “generate my world” action should be one job but not
one assumed-perfect image response. The Agent must retain the confirmed world
identity while the worker executes and validates multiple bounded tasks.

The local operator materializer added in this revision can recover a
reading-ordered terrain, prop, effect or character sheet without another model
request:

```bash
pnpm production-art:operator-import -- \
  --profile side-platformer \
  --task terrain-sheet \
  --source /private/review/terrain-rgba.png \
  --mode component-reading-order \
  --out /private/review/terrain-candidate.png \
  --report /private/review/terrain-candidate.json
```

It requires the exact canonical significant-subject count, records ignored
fragments and component bounds, re-packs subjects into exact cells, verifies
mapped and undeclared cells, and keeps absolute operator paths out of its
report. It does not convert reading order into semantic approval.

## Godot evidence

The exact nine-task candidate was imported by:

- Godot `4.3.stable.official.77dcf97d8` on Windows using
  `gl_compatibility`;
- Godot `4.7.stable.official.5b4e0cb0f` on Windows using
  `gl_compatibility`.

Both runs loaded five background planes, six terrain roles, fourteen prop
roles and the 28-pose character atlas. A real `CharacterBody2D` settled on the
world floor, played the run-row cells and reached the declared right-side exit.

The final nine-task inventory passed the standard production-art run-set
verifier and produced an internal Pack 0.7 review archive at SHA-256
`7303221de8cb88f3e3c9580430d3aa9f26cc74609427ca4dc510047fbbe07694`.
Godot imported that archive and passed the Pack 0.7 playable smoke. The exact
World Runner PCK was rebuilt byte-identically at 826,272 bytes and SHA-256
`06aab6d371987f9dca4f479923edb0b0c96484d92d3e87941a34ed4d52e7ec06`.

Windowed OpenGL3 captures from Godot 4.3 and 4.7 were byte-identical:
`1280 x 720`, 1,349,106 bytes, SHA-256
`bfc6413fc8948f0634d56c2e86799a919ad8942e0304ff2b4fe992781f9c6c47`.
Godot reopened the saved PNG, the host decoded it independently, and both
receipts matched the host hash. A targeted pixel audit found zero strong or
moderate magenta spill pixels.

## Honest review result

Machine result: `complete-model-candidate-human-review-required`.

Current AI pre-review:

- world identity, landmark and palette continuity: pass;
- canonical task and role coverage: pass;
- exact atlas dimensions and undeclared-cell transparency: pass;
- character identity: pass;
- character left/right direction semantics: revise;
- temporal animation quality: review;
- terrain and prop semantic ordering: review;
- foreground coverage at spawn and exit: pass after revision;
- art-to-collision alignment: pending;
- standard run-set, Pack 0.7 and reproducible World Runner PCK: technical pass;
- exact Godot 4.3/4.7 framebuffer binding: pass;
- human art approval: pending;
- redistribution rights: pending;
- physical Raspberry Pi 4B: pending.

Until those findings are resolved and exact revised hashes are approved, this
must remain an **internal complete model candidate**, not a production-ready or
itch.io-ready world pack.
