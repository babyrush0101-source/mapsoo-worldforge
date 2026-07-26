# Model-backed production art

Status: **implemented source adapter; internal-review only; not yet a complete
automatic production pack**

This document describes the first real image-model boundary in Mapsoo
Worldforge. It turns one approved production-art task and its reference images
into one normalized PNG candidate. It does not claim that one model call can
reliably create a complete world, a consistent animation set, collision,
navigation, or a publicly licensed pack.

The offline procedural provider remains the reproducible baseline. The optional
model adapter exists to replace visible placeholder art one reviewed task at a
time.

## Implemented path

```text
world dialogue
  -> provider-neutral ProductionArtPlan
  -> choose exactly one task
  -> explicit remote-upload authorization
  -> GPT Image 2 image-edit request
  -> bounded source PNG
  -> deterministic alpha / resize / grid checks
  -> ProductionArtOutput + scrubbed evidence
  -> human art and rights review
  -> later: deterministic pack projection and Godot runtime validation
```

The relevant code is:

- [`src/core/production-art-provider.ts`](../src/core/production-art-provider.ts):
  provider capabilities, single-task remote authorization, reference rebinding,
  credential isolation, PNG limits, and the trusted runner;
- [`src/adapters/openai/openai-production-art-provider.ts`](../src/adapters/openai/openai-production-art-provider.ts):
  the server-only OpenAI image-edit adapter;
- [`src/adapters/normalize-production-art-png.ts`](../src/adapters/normalize-production-art-png.ts):
  deterministic chroma removal, nearest-neighbor resize, transparent-RGB
  cleanup, mapped-cell checks, hashes, output record, and evidence;
- [`schemas/mapsoo-production-art-generation-evidence-1.0.schema.json`](../schemas/mapsoo-production-art-generation-evidence-1.0.schema.json):
  the strict portable schema for scrubbed generation evidence;
- [`src/providers/production-art-replay-provider.ts`](../src/providers/production-art-replay-provider.ts):
  a local replay provider bound to the plan, task, source SHA-256, ordered
  reference ids, and private reference digests;
- [`scripts/run-openai-production-art-source.ts`](../scripts/run-openai-production-art-source.ts):
  the local, one-task CLI.

The adapter uses the pinned `gpt-image-2-2026-04-21` snapshot rather than a
moving alias. OpenAI documents GPT Image 2 as its current image generation and
editing model:

- [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2)
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)

## Safe default

The command is a dry-run unless `--execute` is present:

```bash
pnpm production-art:model -- \
  --profile layered-depth-2d \
  --task scene-direction
```

Dry-run prints the selected task, exact model source resolution, required
reference roles, quality, and review policy. It performs zero uploads and zero
paid requests.

A real request requires both independent switches:

```text
--execute --allow-remote-upload
```

It also requires `OPENAI_API_KEY` in the process environment. The key is passed
only to the HTTP request. It is not included in the plan, prompt evidence,
candidate, output record, filesystem path, or error body.

Every CLI invocation authorizes at most one request for exactly one provider,
task, and ordered reference-id list. Existing permission to adapt or
redistribute a reference image does **not** imply permission to upload it to a
third-party model service.

## Dialogue and approval rounds

The intended workflow is deliberately staged:

1. Run `scene-direction` with an environment reference, character reference,
   world brief, and style bible.
2. Review the returned direction image with the user.
3. Only after acceptance, use that image as `--approved-direction` for one
   terrain, prop, character, background, or effect task.
4. Review every task result before it becomes a frozen source input.
5. After all mandatory roles pass, project them into the existing deterministic
   pack and Godot import path.

All non-scene CLI tasks fail closed unless `--approved-direction` is supplied.
Character tasks also require the original character reference so recognizable
identity cues can be reviewed against both the approved world style and source
character. Their plan contains a canonical per-cell pose inventory with action,
direction, frame index, duration, and grid position. The normalizer requires
every declared cell to contain pixels and every undeclared cell to remain
transparent.

Example of an explicitly authorized direction request:

```bash
pnpm production-art:model -- \
  --profile layered-depth-2d \
  --task scene-direction \
  --world-brief-file private/world-brief.txt \
  --style-bible-file private/style-bible.txt \
  --environment-reference private/environment.png \
  --character-reference private/character.png \
  --quality medium \
  --execute \
  --allow-remote-upload
```

Those private input paths never enter the output records. The model candidate is
written under the ignored
`docs/visual-qa/production-art/model-runs/<profile>/<task>/<request>/`
directory as:

- `source.png`: the immutable model response;
- `normalized.png`: deterministic output at the plan's exact dimensions;
- `output.json`: `ProductionArtOutput` bound to roles and rights;
- `evidence.json`: provider/model/workflow, dimensions, hashes, postprocess
  version, and `human_review: required`.

World brief, style bible, raw prompt, local paths, API key, and reference bytes
are not copied into either JSON record.

For a `layered-depth-2d` player or NPC task, the same invocation also runs the
deterministic Pack 1.0 character projector. A passing candidate adds:

- `runtime-atlas.png`: an 8-column Godot runtime atlas with `48 × 72` frames;
- `pack-character.json`: the complete player or NPC clip record ready for a
  Pack 1.0 manifest;
- `projection.json`: source/output hashes, geometry and machine-check evidence.

The player projection contains 32 independently mapped poses and 16
action-direction clips. The NPC projection contains 16 poses and 8 clips. Each
clip has two independent frames. The projector rejects empty frames, visible
frame borders, feet that do not land near the declared `24,67` pivot, exact
duplicate frames, horizontal mirror copies and normalized-byte/evidence digest
mismatches.

A paid model response is not discarded merely because this technical
projection fails. The original source, normalized candidate and evidence are
still written, together with `projection-rejection.json`; the command exits
non-zero and reports a bounded rejection code. Passing projection still leaves
`human_review: required` and does not approve the art for release.

## Assemble the first complete Pack 1.0 review candidate

After one passing player run and one passing NPC run, the local-only assembler
can replace both character atlases in a complete Pack 1.0 base world:

```bash
pnpm pack10:fixture:build

pnpm pack10:character-review:build -- \
  --base-pack tests/fixtures/pack10-public/mapsoo-pack10-public-fixture.zip \
  --player-run docs/visual-qa/production-art/model-runs/layered-depth-2d/character-character-player-atlas/<run> \
  --npc-run docs/visual-qa/production-art/model-runs/layered-depth-2d/character-character-npc-atlas/<run> \
  --out review-output/neutral-character-review.zip \
  --pack-id neutral-character-review-world \
  --title "Neutral Character Review World" \
  --version 1.0.0-review.1 \
  --created-at 2026-07-27T18:00:00.000Z
```

This command makes no remote request. It verifies the base ZIP's exact
manifest/file inventory and every payload digest, then revalidates the player
and NPC projection schemas, generation-evidence bindings, atlas hashes,
dimensions, clip inventories, transparent padding, foot anchors, distinct
frames and mirror rejection. The resulting ZIP is deterministic for identical
inputs.

Only the runtime atlases and source-free projection records enter the review
ZIP. Model source PNGs, normalized working sheets, generation evidence, local
paths, references, world brief, style bible, raw prompt and API key remain
outside. One-way hashes bind the omitted normalized sources.

The assembler always changes distribution to `internal-review`, license to
`LicenseRef-UNRELEASED`, and resets `human_art`, `rights`, `runtime` and
`raspberry_pi` to `pending`. This first candidate replaces characters over the
chosen base environment; it is not evidence that the environment itself was
model-generated or that a complete production-art world has passed review.

## Layered-depth runtime plane projection

`projectLayeredDepthProductionLayers(...)` is the next environment replacement
boundary. It accepts the normalized `scene-direction` result plus exactly eight
normalized background/foreground/lighting task results. Every runtime layer
must contain the reserved `approved-scene-direction` reference binding, so
results from an unrelated visual round cannot be silently mixed.

The projector verifies every normalized PNG against its output and generation
evidence hashes, then converts the eight canonical `1920 × 1080` working images
to immutable `640 × 360` Pack 1.0 files:

- sky, far, mid and depth-fog;
- near and foreground overlays;
- ambient multiply lighting and local additive lighting.

Sky must remain fully opaque. Every other plane must contain both visible and
transparent pixels, with zero RGB in transparent pixels and no partial alpha.
The machine-readable projection record binds the approved direction hash,
source-task hashes, output file hashes, canonical role/path/blend inventory and
runtime dimensions.

The `640 × 360` target matches the current low-memory Raspberry Pi review
resolution; it is not a physical Pi performance result. Horizontal seam quality
and visual composition remain `required` human-review gates. The plane
projector is implemented and tested, but the multi-run disk assembler is still
required before the complete environment can replace the base pack.

## Layered-depth runtime environment atlas projection

`projectLayeredDepthProductionAtlases(...)` accepts the approved
`scene-direction` result plus exactly three direction-bound normalized results:
`terrain-sheet`, `prop-sheet` and `effect-sheet`. It deterministically produces
the five canonical Pack 1.0 gameplay atlases:

| Runtime atlas | Roles | Pivot-baked cell | Atlas dimensions |
| --- | ---: | --- | --- |
| `terrain` | 6 | `64 × 128` | `384 × 128` |
| `props` | 6 | `96 × 176` | `576 × 176` |
| `structures` | 4 | `96 × 176` | `384 × 176` |
| `collectibles` | 2 | `96 × 176` | `192 × 176` |
| `effects` | 4 | `64 × 64` | `256 × 64` |

The projector verifies normalized bytes against both output and generation
evidence, requires the reserved `approved-scene-direction` binding, and uses
the production plan's explicit role-to-grid mapping rather than guessing cell
meaning. It rejects undeclared occupied source cells, empty mapped cells,
non-zero RGB under transparent pixels, partial alpha, exact duplicate runtime
cells, and source-boundary contact for props, structures, collectibles and
effects. Each emitted role receives an independent Pack atlas region.

Pack 1.0 currently places environment `Sprite2D` textures by their region
center. To preserve the declared source anchor without adding an implicit
runtime offset, the projector keeps the original source pixels unchanged and
pads each cell until the source pivot equals the runtime cell center:
terrain `32,64`, prop/structure/collectible `48,88`, and effect `32,32`.

Terrain source boundaries may remain visible for tile continuity, so tile
seams still need visual review. The projection record remains source-free and
marks `seam_review: required` and `human_review: required`. The complete
environment still needs the multi-run disk assembler and real Godot review
before it can replace the synthetic base environment.

## Assemble the complete visible Pack 1.0 candidate

Once every canonical task has one frozen passing local run, create a local
run-set JSON. It is an operator input and is never embedded in the output:

```json
{
  "schema_version": "1.0.0",
  "document_type": "production-art-run-set",
  "profile": "layered-depth-2d",
  "runs": {
    "scene-direction": "./runs/scene-direction",
    "terrain-sheet": "./runs/terrain-sheet",
    "prop-sheet": "./runs/prop-sheet",
    "effect-sheet": "./runs/effect-sheet",
    "character-character-player-atlas": "./runs/player",
    "character-character-npc-atlas": "./runs/npc",
    "background-background-sky": "./runs/background-sky",
    "background-background-far": "./runs/background-far",
    "background-background-mid": "./runs/background-mid",
    "background-background-depth-fog": "./runs/background-depth-fog",
    "background-near-overlay": "./runs/near-overlay",
    "background-lighting-ambient": "./runs/lighting-ambient",
    "background-lighting-local": "./runs/lighting-local",
    "background-foreground-overlay": "./runs/foreground-overlay"
  }
}
```

Each directory must contain the immutable `source.png`, `normalized.png`,
`output.json` and `evidence.json` written by the model adapter. Paths are
resolved relative to the run-set file. Build the complete internal-review ZIP:

```bash
pnpm pack10:fixture:build

pnpm pack10:production-review:build -- \
  --base-pack tests/fixtures/pack10-public/mapsoo-pack10-public-fixture.zip \
  --runs-manifest review-input/layered-depth-run-set.json \
  --out review-output/neutral-production-review.zip \
  --pack-id neutral-production-review-world \
  --title "Neutral Production Review World" \
  --version 1.0.0-review.2 \
  --created-at 2026-07-27T20:00:00.000Z
```

The command makes no network request. It reruns the layer, environment-atlas
and character projectors, then independently reopens and verifies every
runtime PNG and record before assembling the ZIP. The resulting archive
contains all eight planes, five gameplay atlases, two character atlases, the
data-only base scene/collision/navigation files and four source-free projection
records. It excludes model source images, normalized working sheets,
generation-evidence JSON, raw prompts, original references and local paths.

The result remains a technical review candidate: distribution is
`internal-review`, the license is `LicenseRef-UNRELEASED`, and human-art,
rights, runtime and Raspberry Pi gates are all `pending`. The base preview and
data-only world layout are not treated as proof that a real Godot render or
physical Pi run has passed.

## Alpha policy

GPT Image 2 currently does not support transparent output. For every task that
needs straight alpha, the adapter requests an opaque, edge-connected
`#00FF00` chroma background. The deterministic normalizer then:

1. decodes a real non-interlaced RGB/RGBA PNG;
2. removes only green pixels connected to the image edge;
3. reduces green spill on the immediate subject boundary;
4. sets every fully transparent pixel to RGBA `(0,0,0,0)`;
5. resizes with nearest-neighbor sampling to the exact task dimensions;
6. rejects empty mapped cells, visible undeclared cells, missing transparency,
   and content touching declared transparent cell padding.

Opaque tasks have alpha forced to `255`.

GPT Image 2 accepts flexible resolutions, but both edges must be multiples of
16, the aspect ratio must be at most 3:1, total pixels must be between 655,360
and 8,294,400, and the largest edge must not exceed 3,840. The adapter chooses
the smallest exact integer scale of the production target that satisfies all
those constraints. Postprocessing returns to the task's original dimensions.

## Original style boundary

Profile names describe camera and gameplay grammar, not an instruction to copy
a commercial product:

| User shorthand | Public prompt language |
| --- | --- |
| farming life simulation | original orthogonal top-down farm world |
| side-scrolling platform game | original side-view platform world |
| isometric action arena | original diamond-grid isometric action world |
| layered cinematic 2D | original shallow-depth layered exploration world |

The adapter rejects prompts that ask for named-game imitation or “in the style
of” replication. Users must instead describe original camera, palette,
materials, silhouette, density, lighting, and mood traits.

## Determinism and evidence

The model pixels are `best-effort`, not seeded deterministic output. A seed
cannot make a remote generative image byte-identical. Reproducibility begins
after a candidate is frozen:

- source PNG SHA-256 is recorded;
- normalization is deterministic;
- normalized PNG SHA-256 is recorded;
- packing, scene layout, collision, navigation, Godot import, and release
  receipts remain deterministic;
- replay should use the frozen source bytes rather than call the model again.

The repository now implements that last step. A
`createProductionArtReplayProvider(...)` fixture takes the frozen source bytes,
their expected SHA-256, original model id, exact plan/task, and the ordered
reference ids plus reference digests. The replay is local, needs no credential
or remote-upload authorization, and must produce the same normalized PNG bytes.
Changing the caller-owned source buffer after provider creation, changing a
reference digest, or lying about the source hash fails closed.

Automated tests inject a fake HTTP transport. They verify form fields, reference
uploads, absence of `input_fidelity`, opaque output requests, authorization
failure, secret redaction, chroma normalization, cell checks, and evidence
binding without making a paid API call.

## What remains

This source adapter is a real provider implementation, but the following work is
still required before claiming “a few dialogue rounds create one complete
production world”:

- connect the projected layered-depth player and NPC, followed by accepted
  environment outputs, to the full `WorldAssetProvider` bundle builder;
- expand the same runtime projection boundary to the other three profiles;
- execute the canonical character pose inventory in smaller, independently
  reviewed batches instead of relying on one perfect sprite-sheet request;
- add semantic identity, action, direction, temporal-continuity, seam, pivot,
  and art-to-collision human review;
- render the imported pack in Godot rather than approving a direction image;
- complete physical Raspberry Pi 4B frame-time, memory, temperature,
  controller, and audio validation;
- record an explicit publishable license before moving any ignored candidate
  into the public repository or a release asset.

Until those gates pass, the honest label is **model-generated source candidate
for internal review**, not production-ready world pack.
