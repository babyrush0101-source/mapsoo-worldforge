# Production art pipeline

Status: all four production-art runtime candidates are assembled and technically exercised; human review, public-pack release and physical Raspberry Pi 4B validation remain incomplete.

## What each image proves

The project uses four labels so a generated picture is never confused with a
playable result:

| Label | How it is made | What it proves |
| --- | --- | --- |
| `direction image` | one flattened ImageGen composition | palette, material language, camera and intended landmarks only |
| `production source` | independently generated sheet or layer | editable visual material with recorded prompt and source hash |
| `asset-built preview` | deterministic code composes only validated atlases/layers | the declared runtime assets can form one coherent map |
| `Godot runtime render` | Godot loads the recorded assets and runs a physical route | those exact assets render with collision, navigation and interaction |

ImageGen is the production source for the current visual candidates. It does
not itself prove atlas integrity, animation, collision, navigation, Godot
compatibility or Raspberry Pi performance. Every preview and runtime evidence
record lists the exact input SHA-256 digests it consumes. Direction images are
never shipped in place of missing runtime roles.

## Why the current art is still visible

The procedural provider is the project's deterministic, offline baseline. Its rectangles, simple sprites, collisions, navigation, manifests, Godot importer, and playable scene prove that the complete route works without a paid service. They are deliberately kept as a fallback and test fixture.

Production art does not overwrite that provider. A second provider supplies reviewed source art for the same versioned roles. The trusted pack builder accepts the replacement only after it passes the same completeness and integrity contracts.

```text
four-round world brief
  -> approved art-direction sample
  -> role-by-role production tasks
  -> generated source sheets and layers
  -> deterministic crop / matte / scale / atlas build
  -> seam, alpha, pivot, density and identity validation
  -> collision and navigation derived from accepted assets
  -> Godot import
  -> rendered final preview
  -> human art approval
```

## First real direction sample

The first candidate is [`side-platformer-direction-v1.png`](visual-qa/production-art/side-platformer-direction-v1.png). Its machine-readable review record is [`side-platformer-direction-v1.json`](visual-qa/production-art/side-platformer-direction-v1.json).

It is an original side-on riverside courier world. It proves a stronger visual direction than the engineering baseline:

- readable left-to-right route, platforms, hazards, checkpoint and exit;
- separable sky, far, middle, near and foreground depth bands;
- coherent stone, timber, foliage, water, cloth and light materials;
- a traceable magenta-jacket / amber-scarf player identity.

It is not a tileset or character atlas. The image remains `internal-review` and `UNRELEASED`; it must not be included in a public pack until licensing and human art approval are explicit.

The first character source candidate is
[`side-platformer-character-sheet-rgba-v2.png`](visual-qa/production-art/side-platformer-character-sheet-rgba-v2.png),
with review metadata in
[`side-platformer-character-sheet-v1.json`](visual-qa/production-art/side-platformer-character-sheet-v1.json).
It has an exact `6 × 2` grid of `362 × 362` cells: six actions facing right and
the same six facing left. Chroma removal and grid integrity pass; action semantics,
identity consistency, alpha edges and foot pivots still require review. It is therefore
a source candidate, not yet the exported character atlas.

The deterministic post-processor now turns those 12 recorded and normalized source
poses into
[`side-platformer-character-atlas-v2.png`](visual-qa/production-art/side-platformer-character-atlas-v2.png).
It uses a `1024 × 768`, `8 × 6` atlas with `128 × 128` frames and a shared foot
pivot at `(64, 120)`. Twelve clips contain 28 distinct runtime frames: idle has two,
run has four, and jump/fall/land/hurt each have two in both directions. Visible
height is 73–88 pixels and the maximum foot-anchor error is two pixels. Every
unmapped cell is transparent.

The extra frames are honestly labelled deterministic scale/shift/compression
variants of one recorded pose per action and direction; they are not claimed as
model-native or independently hand-drawn limb animation. Their exact derivation is
recorded in
[`side-platformer-character-atlas-v2.json`](visual-qa/production-art/side-platformer-character-atlas-v2.json).
Godot 4.3 and 4.7 both bind all 12 clips and 28 frames and produce byte-identical
character QA renders, recorded in
[`side-platformer-character-godot-v2.json`](visual-qa/production-art/side-platformer-character-godot-v2.json).

The same atlas is also materialized as an independent, private
[`CharacterProfileRevision v2`](visual-qa/production-art/side-platformer-character-profile-revision-v2.json).
It can be bound to a compatible neutral player slot without rebuilding the world,
collision or navigation. The example uses synthetic opaque reference IDs and
`LicenseRef-Proprietary`; no source file path or private product record enters the
portable contract.

The first generated terrain source is normalized into
[`side-platformer-terrain-atlas-v2.png`](visual-qa/production-art/side-platformer-terrain-atlas-v2.png):
a straight-alpha `384 × 192` atlas with an exact `8 × 4` grid of `48 × 48` cells.
The first row binds solid ground, one-way platform, rising slope, descending slope,
wall and ceiling. Repeatable ground/platform/ceiling edges and the vertical wall
edge are deterministically reconciled and verified with zero boundary mismatches.
Its [runtime-candidate record](visual-qa/production-art/side-platformer-terrain-atlas-v2.json)
still requires slope/material review and Godot world-scene validation.

The rejected `v1` terrain candidate is retained as evidence: opaque blue source-cell
backgrounds made slopes and one-way platforms render as rectangles. `v2` uses
bounded per-role background removal, straight alpha and transparent reserved cells.

The prop batch is normalized into
[`side-platformer-prop-atlas-v1.png`](visual-qa/production-art/side-platformer-prop-atlas-v1.png):
a transparent `512 × 512`, `8 × 8` atlas. Fourteen ordered roles cover hazards,
crate/rock/plant/sign/lamp/breakable props, entrance/exit/checkpoint structures,
and primary/health collectibles. Required cells are non-empty, reserved cells are
transparent, and the bounded chroma-edge detector reports zero retained key pixels.
The sanitizer also inspects every atlas cell outside those fourteen mappings:
18 source cells contained visible pixels and were cleared, so all 50 unmapped cells
are now transparent instead of silently carrying unlicensed or undefined objects.
The [prop record](visual-qa/production-art/side-platformer-prop-atlas-v1.json)
still requires semantic/scale review and world-scene validation.

Five generated parallax layers are normalized to `1920 × 1080`: opaque sky plus
straight-alpha far, middle, near and foreground planes. All layers have reconciled
horizontal edges with zero boundary mismatches and no bounded chroma-edge findings.
The exact files and coverage metrics live in
[`side-platformer-background-runtime-v1.json`](visual-qa/production-art/side-platformer-background-runtime-v1.json).
Depth ordering, gameplay contrast and Godot world-scene composition remain review gates.

The first preview assembled strictly from those exported atlases and layers is
[`side-platformer-production-preview-v1.png`](visual-qa/production-art/side-platformer-production-preview-v1.png).
It is not the earlier concept scene: the builder decodes the recorded background,
terrain, prop and character payload hashes, places their declared cells, composes
the foreground last and emits a deterministic `1280 × 720` PNG. The preview has
1001 quantized colors and is fully opaque. This is the kind of approval preview shown
after the world-creation dialogue rounds; it is not, by itself, the final deliverable. Its
[binding record](visual-qa/production-art/side-platformer-production-preview-v1.json)
now contains fail-closed landmark checks. The entrance is 100% visible; the exit is
99.42% visible with 0.58% near-opaque foreground coverage. Both exceed the required
90% visibility and remain below the 10% coverage ceiling. The exit's mean normalized
color distance from the same scene without the exit is 0.253, above the explicit
0.14 contrast threshold. These are automated composition checks, not human approval.
The binding record
points to the bounded
[Godot world-smoke evidence](visual-qa/production-art/side-platformer-production-world-godot-v1.json).
Godot 4.3 and 4.7 both decode all five background layers, slice six terrain and
fourteen prop cells, run the existing player controller on a hard-coded test floor,
play the generated `run_right` and `jump_right` frames, and trigger the declared
exit after the script directly places the player on its marker. This is a headless
asset/controller smoke. It does not instantiate the terrain, props or backgrounds
as a rendered production scene, run the pack importer, prove art-to-collision
alignment or navigation traversal, certify human art quality, or measure Raspberry
Pi 4B performance.

The preview layout now records all 89 terrain cells, ten prop placements, the
character foot anchor, five collision shapes, spawn, exit and a seven-node/six-edge
navigation route. In addition to ground and one-way rectangles, the visible rising
and descending slopes bind explicit triangle collision polygons and the visible wall
binds a rectangle. There are no unbound visible terrain collision roles.
The character pivot, player anchor, collision bottom and main-ground top now share
`y=576`; this corrects the earlier eight-pixel visual gap.

For bounded runtime work, the five 1920 × 1080 source layers are deterministically
precomputed at both 1280 × 720 and 640 × 360 instead of asking Godot or Raspberry
Pi to rescale the sources every frame. Godot 4.3 and 4.7 both rendered the
640 × 360 candidate with five layers, 89 terrain cells, ten prop placements and
the generated character v2. The runtime instantiates all 12 clips and 28 frames.
The player then moved from spawn `(144, 576)`, physically climbed and descended the
two slope polygons, jumped over the wall and reached `exit-node`; both versions
produced the same PNG and pixel digest on the recorded Windows OpenGL host. The
[rendered candidate](visual-qa/production-art/side-platformer-production-godot-4.3-v1.png)
and its
[bounded evidence](visual-qa/production-art/side-platformer-production-candidate-godot-render-v1.json)
prove a rendered internal candidate, bound slope/wall collisions, multi-frame
character instantiation and one scripted route. They do not prove hand-drawn
animation quality, hazard behavior, upper-platform traversal, an imported public
pack, user art approval or Raspberry Pi performance.

The second profile now has both an internal art-direction candidate and a
rendered runtime candidate. Its direction image is
[`topdown-farm-direction-v1.png`](visual-qa/production-art/topdown-farm-direction-v1.png).
It projects the same dark-hair, mustard-scarf, plum-coat and brown-satchel identity
into an original 3/4 top-down farm valley and covers the expected farmhouse, barn,
fields, crop stages, orchard, paths, water, bridge, market and transition roles.
The direction record
[`topdown-farm-direction-v1.json`](visual-qa/production-art/topdown-farm-direction-v1.json)
explicitly marks that flattened image as inspiration rather than runtime evidence.

The runtime candidate is assembled only from recorded terrain, prop and character
atlases. Its deterministic
[`640 × 480` preview](visual-qa/production-art/topdown-farm-production-preview-v1.png)
contains 374 terrain placements, 23 prop/structure/crop placements, four bound
collision rectangles, and a seven-node/six-edge spawn-to-exit route. The character
atlas contributes 12 clips and 32 independently generated source poses; it is
rendered at 0.75 scale so the visible player is proportionate to the farm buildings.

Godot 4.3 and 4.7 both instantiated those exact recorded hashes. The player moved
from `(80, 416)` up the western path, physically crossed the bridge corridor, walked
to the eastern approach and reached `exit-node`. Both engines produced the same
render PNG and pixel-buffer digest. The bounded evidence is recorded in
[`topdown-farm-production-candidate-godot-render-v1.json`](visual-qa/production-art/topdown-farm-production-candidate-godot-render-v1.json).
This proves one scripted traversal on the recorded Windows host; it does not yet
prove Raspberry Pi 4B performance or human approval for public release.

The third profile now has an original internal direction candidate:
[`isometric-action-direction-v1.png`](visual-qa/production-art/isometric-action-direction-v1.png).
“The Emberglass Foundry” uses a fixed three-quarter isometric arena, charcoal
stone, oxidized copper, amber furnaces and teal water channels. It projects the
same dark-hair, mustard-scarf, plum-coat and brown-satchel player identity into
the action camera while introducing original melee and ranged enemy silhouettes.
The image is deliberately recorded as one flattened direction scene. It is not a
tile atlas, collision source or substitute for a Godot-rendered production pack.

The direction has now been decomposed into reviewed working atlases: 16 terrain,
elevation, waterway and bridge assets; 20 hazards, props, structures,
collectibles and effects; a 96-frame player; and 80-frame melee and ranged
enemies. The player has 48 eight-direction clips, and each enemy has 40.
Every clip contains one independently generated source pose plus one honestly
labelled deterministic variant; none is claimed as model-native temporal
animation.

The `96 × 96` working cells are deterministically projected into the ten exact
Pack 0.8 atlas dimensions without changing the existing `diamond-64x32`
portable contract. The projection binds 29 environment/effect roles and all
128 character clips; Pack 0.8 uses the first independent source pose from each
clip while the richer production mother atlases retain both frames. See
[`42_ISOMETRIC_ACTION_PACK_PROJECTION.md`](42_ISOMETRIC_ACTION_PACK_PROJECTION.md).

The assembled
[`640 × 360` runtime preview](visual-qa/production-art/isometric-action-production-preview-v1.png)
contains 64 floor cells, a player, two enemies, structures, combat effects,
two visible-role blockers, one bound hazard and a seven-node/six-edge route.
Godot 4.3 and 4.7 both instantiated the exact ten projected atlas hashes. The
player attacked, physically entered the hazard and respawned, stopped against
the center blocker, dashed east and reached `exit-node`. Both versions produced
the same render and pixel digest, recorded in
[`isometric-action-production-candidate-godot-render-v1.json`](visual-qa/production-art/isometric-action-production-candidate-godot-render-v1.json).
Human approval, a complete exported production Pack ZIP and Raspberry Pi 4B
measurement remain pending.

The fourth profile also has an original internal direction candidate:
[`layered-depth-2d-direction-v1.png`](visual-qa/production-art/layered-depth-2d-direction-v1.png).
“Lanternmere Crossing” stages the same player identity across a rear sky, far
silhouette, mid architecture, traversable depth corridor, near props, foreground
occluders, fog and local lantern light. It demonstrates the intended separation
grammar for a layered Godot world. That PNG remains a flattened direction image
and is not used as a substitute for runtime layers.

Eight runtime planes were instead generated independently and normalized to
`1280 × 720`: sky, far architecture, mid architecture, depth fog, near overlay,
foreground overlay, ambient light and local light. The manifest explicitly records
`flattened_direction_auto_separation=false`; all source and runtime hashes, alpha
contracts, blend modes and the protected central character corridor are recorded in
[`layered-depth-2d-production-layers-v1.json`](visual-qa/production-art/layered-depth-2d-production-layers-v1.json).
The near and foreground planes stay visible at the sides while remaining below the
declared opacity limits through the route.

The working prop atlas binds 22 terrain, prop, structure, collectible and effect
roles. The player atlas contains 16 clips and 32 frames; the NPC atlas contains
eight clips and 16 frames. Both character atlases use one independently generated
pose plus one disclosed deterministic variant per clip, with shared grounded
pivots and transparent unused cells.

Godot 4.3 and 4.7 both loaded those exact eight layers and three mother atlases.
A `CharacterBody2D` physically moved from spawn to an NPC interaction, triggered
the primary collectible, stopped against the visible blocker, traversed the stairs
and bridge, and reached `exit-node` over the seven-node/six-edge route. The two
engines produced the same render and pixel hashes. The bounded evidence is
[`layered-depth-2d-production-candidate-godot-render-v1.json`](visual-qa/production-art/layered-depth-2d-production-candidate-godot-render-v1.json).
This is an internal runtime candidate, not human approval, a released Pack 0.9 ZIP
or Raspberry Pi 4B performance evidence.

## Production task batches

For the side-platformer sample, the accepted direction is decomposed into:

| Batch | Required output | Main gate |
| --- | --- | --- |
| Terrain | straight-alpha tile sheets for solid, one-way, slopes, walls and ceiling | seamless joins and fixed grid |
| Gameplay props | transparent sheets for hazards, crates, rocks, plants, signs, lamps and breakables | clean alpha and readable silhouette |
| Structures | entrance, checkpoint and exit sprites | shared scale and grounded pivots |
| Character | player atlas for idle, run, jump, fall, land and hurt in both directions | semantic identity and exact frames |
| Collectibles/effects | primary and health collectibles plus effects | contrast against every background |
| Parallax | sky, far, middle, near and foreground layers | edge continuity and depth ordering |
| World assembly | placements, collision, navigation, spawn and exit | derived from the accepted visible assets |
| Evidence | final preview rendered from the exported pack | must not use an unrelated concept image |

The other three profiles use the same lifecycle but different role sets and camera grammar. Their task plans are versioned data, not one large prompt.
The provider-neutral TypeScript and JSON Schema boundary is specified in
[`32_PRODUCTION_ART_CONTRACT.md`](32_PRODUCTION_ART_CONTRACT.md).

## Image model boundary

The production provider is intentionally model-neutral. OpenAI's current image documentation describes `gpt-image-2` as the current image-generation model and supports both image generation and image editing. The Image API is suited to single generate/edit calls, while the Responses API supports conversational, multi-turn image work:

- [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2)
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)

No browser client stores an API key. A future hosted adapter receives a bounded task, reference inputs and a private credential on the server; it returns files that must still pass the local contract. The offline provider remains usable without that adapter.

## Acceptance rule

A production pack is accepted only when all mandatory roles exist, byte and SHA-256 records match, paths are safe, dimensions and grids match the plan, alpha and seam policies pass, pivots and animation frames stay in bounds, and the final Godot-rendered preview matches the assets in the pack.

Human approval is required after automation. A visually attractive whole-scene image alone never replaces the placeholder pack.

## Local candidate isolation

Unapproved production rasters and their raw Godot logs are local review inputs,
not ordinary repository fixtures. They remain under the ignored
`docs/visual-qa/production-art/` boundary until a human review record grants a
public redistribution license. This prevents `git add .` from silently publishing
`UNRELEASED` or private character artifacts.

`pnpm check` therefore validates the provider-neutral contracts, source-free
fixtures, exporters, importers and application build from a fresh clone. A
maintainer who has the complete local candidate set runs the stronger optional
gate:

```bash
pnpm check:production-art
```

Approved source archives belong in a hash-pinned GitHub Release asset (or another
explicit artifact store), not implicitly in normal Git history. Raw stdout/stderr
logs are never release evidence; only scrubbed structured JSON may be promoted.
