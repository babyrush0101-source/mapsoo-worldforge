# Mapsoo Worldsmith

> Open-source world asset generator for Godot creators.

[![CI](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/workflows/ci.yml/badge.svg)](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/workflows/ci.yml)
[![GitHub Pages](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/workflows/pages.yml/badge.svg)](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/workflows/pages.yml)

[Live demo](https://babyrush0101-source.github.io/mapsoo-worldforge/) · [v0.1.0-alpha.9 public release](https://github.com/babyrush0101-source/mapsoo-worldforge/releases/tag/v0.1.0-alpha.9) · [Alpha.9 release notes](docs/releases/v0.1.0-alpha.9.md) · [First-import feedback](https://github.com/babyrush0101-source/mapsoo-worldforge/issues/12)

Mapsoo Worldsmith is evolving from the original `mapsoo-kids` website into a local-first tool that turns a compact world specification into previewable, versioned game-art asset packs for Godot. itch.io distribution is intentionally postponed; GitHub Releases is the audited public channel for this alpha.

The public repository slug is **`mapsoo-worldforge`**. `Mapsoo Worldsmith`
remains the alpha generator/protocol identifier because it is embedded in
immutable release manifests, schemas, receipts, and verified archive hashes.
Renaming that identifier in place would break existing pack verification; any
future product-name migration must use a new schema version with an explicit
compatibility path.

The **published v0.1.0-alpha.9 prerelease** is the immutable compatibility baseline. It accepts one environment image, one character image, and a short description, then builds a complete `topdown-farm` Pack Schema 0.6.0 ZIP. The exact published pack passed Linux/Windows with Godot 4.3/4.7 and remains pinned at SHA-256 `10d89c7888b70215a14af2b6552fc5237d799df9cd3092aee99541961d9e480c`.

The current **unpublished Alpha12 development candidate** expands that workflow into a guided four-round conversation and four complete original world grammars:

| Profile | Complete pack | Godot scene | Playable runtime checks |
| --- | --- | --- | --- |
| `topdown-farm` | Pack 0.6 | TileMap, character, collision, navigation | four-direction movement and blocking |
| `side-platformer` | Pack 0.7 | parallax, platforms, hazards, exit | movement, jump, one-way platform, respawn |
| `isometric-action` | Pack 0.8 | original isometric arena and entities | eight-direction movement, dash, hazard, exit |
| `layered-depth-2d` | Pack 0.9 | seven depth planes and shallow corridor | movement, NPC interaction, hazard, exit |

The intended user path is: **world brief → art direction → map layout → style sample → complete assets → Godot map → enter the world**. The first four stages run in the browser; complete packs, trusted Godot importers, controllers, and headless playability tests exist for all four profiles. The candidate is not yet a public release and physical Raspberry Pi 4B performance validation remains pending.

The fourth-round image is explicitly an **intent preview**, not final artwork.
After references and complete assets are generated, the browser instead shows
the exact `scene.previewAssetId` PNG included in the downloadable pack. An
`ExportedWorldReviewEvidence` SHA-256 chain binds that PNG to the confirmed
intent, dialogue, generation request, scene/collision/navigation data, and the
complete visual-asset set before the asset revision can be frozen.

The public [character-reference conformance
fixture](docs/48_CHARACTER_REFERENCE_CONFORMANCE.md) now decodes one synthetic
`64 × 96` reference, carries the same deterministic identity signature and
representative projection cues through all four complete ZIP routes, and
verifies each emitted player atlas against its manifest. It intentionally
exposes the remaining boundary: deterministic silhouette/palette projection
works today, while production-quality arbitrary-reference adaptation still
needs model-backed pose generation connected to the complete pack builder,
confirmed style samples, continuity checks, and human approval.

The first optional **server-only image-model source adapter** is now implemented
behind that boundary. It converts one explicitly authorized production task into
a hash-bound internal-review PNG candidate and deterministic normalized output;
it is dry-run by default and never stores the API key. A resumable operator
workflow now schedules those single-task calls under an immutable private-input
binding, append-only state journal, exact scene-direction approval, total
request budget and per-invocation cap. Interrupted work never retries
automatically; frozen run files can be reconciled without another request, and
any retry requires explicit duplicate-cost acknowledgement. Private input
paths, contents and individual reference digests are excluded from workflow
state and the completed source-free run set. A shared zero-request verifier now
materializes those run sets for all four profiles, re-decodes and re-hashes
every frozen PNG/evidence pair, and rejects incomplete, aliased or substituted
task inventories before a profile-specific pack builder can mutate a ZIP.
Each workflow response also includes a schema-bound, privacy-minimized progress
document with exact missing asset roles and the next allowed action. It keeps
`runtime_verified` and `runner_delivery_ready` false even when all image tasks
are complete, so a direction candidate or PNG folder cannot be presented as an
enterable world. Rejected or uncertain tasks stop later paid generation until
the same task is explicitly resolved.
Player tasks for all four profiles now additionally project into portable, complete
`CharacterProfileRevision` artifacts while preserving normalized atlas bytes.
The reusable Godot runtime shell can now load any of the four generated world
profiles and bind a matching revision plus atlas afterward, including through
fixed `res://mapsoo_characters/<revision-id>/` launch arguments. Switching
worlds clears the active character binding; the world pack remains immutable
and internal-review/private character rights stay separate.
The consumer-neutral `world-delivery:workspace` CLI now turns a confirmed
ten-fact intake into an atomic private production workspace for all four
profiles. Its references, briefs, workflow state, and generated candidates are
forced outside the public repository. After review and a trusted Godot build,
the same CLI finalizes an exact-byte delivery by binding the world pack, runtime
artifact, portable contract, created-character revision, and headless-smoke
report. No private product record or launch protocol enters this repository;
see the [private-consumer bridge](docs/51_PRIVATE_CONSUMER_WORLD_CREATION_BRIDGE.md).
The projector rejects occupied undeclared cells, empty, duplicate, mirrored,
border-touching and mis-anchored frames. Layered-depth player and NPC tasks also
project into exact Pack 1.0 `48 × 72` Godot atlases with complete two-frame clip
records. Two passing layered-depth runs can be assembled into a deterministic,
non-redistributable Pack 1.0 review ZIP over a complete base world, with every
human, rights, runtime and Raspberry Pi gate reset to pending. This is still an
internal-review candidate rather than a complete production pack. Character
plans bind every required source cell to an explicit action, direction, frame
index and duration, while semantic identity and animation quality still require
human review. The eight layered-depth
background, overlay and lighting tasks can now also be projected from
direction-bound `1920 × 1080` working images into hash-bound `640 × 360`
Pack 1.0 runtime planes. The three direction-bound terrain, prop and effect
working sheets can now also be projected into five canonical gameplay atlases
for all 22 environment roles. The projector preserves source pixel density,
bakes each declared source pivot to the centered Godot `Sprite2D` anchor, and
rejects occupied undeclared cells, invalid transparent padding, duplicate role
pixels and evidence mismatches. Seam, composition and semantic art review
remain pending. A source-free local assembler now combines all 14 frozen task
runs into one deterministic Pack 1.0 ZIP that replaces all eight planes, all
five gameplay atlases and both character atlases while keeping every release
gate pending and the license `LicenseRef-UNRELEASED`. See
[Model-backed production art](docs/49_MODEL_BACKED_PRODUCTION_ART.md).
The provider-neutral
[live-model four-profile direction review](docs/52_LIVE_MODEL_FOUR_PROFILE_DIRECTION_REVIEW.md)
catches world-landmark and character-identity drift before one profile is
selected and later asset tasks are unlocked.

A separately labelled **synthetic technical fixture** now exercises that full
path without a model call. Its deterministic candidate passed real headless
imports on local Godot 4.3 and 4.7 with 8 planes, 7 atlases, 36 roles, 2
characters, pivot-baked structures, and byte-stable re-import. This proves the
technical Pack/Godot boundary only: it is not real model output, human art
approval, or physical Raspberry Pi evidence.

The same fixture can be prepared with pinned Godot 4.3 into the exact
importer-managed scene, TileSet and integrity state used by a reproducible
Linux ARM64 review bundle. An extracted bundle passes an independent Godot 4.3
load without the source Pack or build workspace. Physical Raspberry Pi 4B
performance remains an explicit pending gate.

The dynamic World Runner PCK path now optionally embeds the reviewed
profile-matched character revision and atlas, proves that exact character is
bound during a real `--main-pack` smoke, and separately proves that the same
PCK remains alive after an interactive readiness marker. The build receipt
still explicitly says that this desktop evidence is not a physical Pi test.
A separate fail-closed Pi 4B acceptance command verifies physical device
model, ARM64, exact PCK and character binding, then records bounded startup,
FPS, P95 frame time, memory and temperature evidence without device identity
or network details.

Reference bytes stay local and are not embedded in the ZIP; local paths, filenames, raw reference digests, and the free-text description are excluded from the public receipt. The World ID and seed are intentionally public and appear in pack metadata, so users must choose public-safe values. The current browser path accepts only user-owned references with explicit generative-adaptation, output-redistribution, and **CC0 dedication** permission. Licensed references are rejected rather than silently relicensed. Generated PNG/runtime JSON output is CC0-1.0, repository code and documentation are MIT, and the original references retain their own rights. Current checks validate file bytes, media signatures, dimensions, budgets, and declared rights; they do not perform face recognition, OCR, trademark detection, or content-level sanitization. The current provider is procedural and truthfully records `contains_generative_ai: false`; that statement does not apply to future model providers. No external adoption, External Host production use, Godot Asset Library listing, or itch.io publication is claimed.

## Project status

The **v0.1.0-alpha.9 prerelease** is the current immutable public release. Alpha12 is the current local candidate and must not be described as published until its reviewed release exists. Alpha.8 and its three asset-pack compatibility fixtures remain an immutable, byte-identical compatibility baseline, preserving the account-free, backend-free, API-key-free loop:

1. Edit a compact World Spec for meadow, desert, or snowfield worlds.
2. Generate the same 3 ground variants, 16 water masks, 16 road masks, 6 prop sprites, and map again from the same seed.
3. Preview the layered pixel-art result in the browser and review validation issues.
4. Download/load a World Spec JSON, or load the strict synthetic External Host Asset Request example and project it locally.
5. Export an executable-free 18-file ZIP containing PNG atlases, Ground/Water/Roads/Props data, semantic-place and structure metadata, a map preview, five schemas, manifest, receipt 0.2, and asset license.

Alpha.5 adds World Spec 0.2 semantic places, a canonical `runtime/places.json` sidecar, six reusable place markers, a browser overlay/list, and Godot `Marker2D` anchors. Its real-browser ZIP has 15 files, four schemas, and SHA-256 `8d86124a4a37fa4a78487c4e91cb7f5024561f140814a5fd139c5b93fde54f36`; the exact published pack imports as `created → unchanged` in the Linux/Windows Godot 4.3/4.7 release matrix. All 12 public attachment digests are pinned in the immutable release registry.

Alpha.6 adds optional place-linked exterior structures, four deterministic archetypes, `runtime/structures.json`, a transparent structures atlas, browser structure controls, and managed Godot `Sprite2D` derivation. Its published 18-file real-browser fixture has SHA-256 `4563552187977b38cdba86c7d3cbf5429a67b7a0a6049e978c2ef2992ef3a054`. The separate importer ZIP has SHA-256 `bbfacd2b5c8503214b7647d59e9911a34fa1b4e073f86bd1310686812c9142c0`. itch.io upload remains postponed; no External Host production adoption, independent user report, or external adoption is claimed.

Alpha.7 publishes Sunny Meadow, Dustwind Outpost, and Frostwatch Vale as three independent Pack Schema 0.5 ZIPs. Their real-browser bytes are pinned in the public registry, and all three exact packs passed `created → unchanged → conflict preserved` on Linux/Windows with Godot 4.3/4.7. All 17 public attachment digests are now pinned in the immutable release ledger.

The current public starter input is [`examples/sunny-meadow-v0.3.world.json`](examples/sunny-meadow-v0.3.world.json); earlier Alpha.4/Alpha.5 inputs remain available for historical verification. The privacy-minimized External Host integration fixture is [`examples/integrations/external-host/river-valley-asset-request.json`](examples/integrations/external-host/river-valley-asset-request.json).

Local World Spec and External Host Asset Request imports share the same 128 KiB cap, strict UTF-8 decoding, duplicate-key detection, bounded JSON depth/complexity, safe-number checks, forbidden prototype-key checks, and strict schema/runtime validation. An External Host request is first projected to a World Spec with a canonical SHA-256 binding; initial generation, editor generation, and both import paths then run through the same validated provider runner. A newer user action aborts and supersedes older work, so a failed or stale request never replaces the last successful world.

![Actual Sunny Meadow alpha.7 preview](examples/packs/sunny-meadow-v0.1.0-alpha.7/previews/map-preview.png)

The committed Alpha.7 fixtures for [Sunny Meadow](examples/packs/sunny-meadow-v0.1.0-alpha.7/), [Dustwind Outpost](examples/packs/dustwind-outpost-v0.1.0-alpha.7/), and [Frostwatch Vale](examples/packs/frostwatch-vale-v0.1.0-alpha.7/) were captured from one real browser export run. Each has 18 files and 17 manifest payload records.

The older published Alpha.1–Alpha.5 fixtures and hashes remain immutable. A pinned pure-JavaScript PNG encoder removes browser-native PNG compression drift, and CI runs the real browser exporter before passing the byte-identical canonical ZIP to the Godot matrix.

The published [v0.1.0-alpha.7 release](https://github.com/babyrush0101-source/mapsoo-worldforge/releases/tag/v0.1.0-alpha.7) is tagged at commit `c2e2ed5`. Its successful [release workflow](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/runs/29688782893) rebuilt all three fixed packs, passed the exact 17-attachment audit, and imported every pack in the Linux/Windows × Godot 4.3/4.7 release matrix.

## Reproducible External Host export CLI

The published Alpha.8 release adds a no-UI bridge for a public-safe `ExternalHostAssetRequest`. It validates and hashes the request, migrates its projection to World Spec 0.3 without inventing places or structures, reuses the audited local procedural exporter, and writes an Alpha.7-compatible Godot pack plus a separate request-to-pack receipt:

```bash
pnpm external-host:export -- \
  --input examples/integrations/external-host/river-valley-asset-request.json \
  --out-dir ./external-host-output \
  --completed-at 2026-07-19T12:00:00.000Z
```

Node.js 20+, pnpm 11+, and Chrome/Chromium are required. The explicit timestamp is part of reproducibility. Existing output is accepted only when both files are byte-identical; otherwise the command fails closed and never overwrites it. This executable bridge is not a claim that External Host has a production consumer yet; see the [Alpha.8 scope and verification contract](docs/18_ALPHA8_EXTERNAL_HOST_EXPORT_CLI.md).

The [public Alpha.8 workflow](https://github.com/babyrush0101-source/mapsoo-worldforge/actions/runs/29691179168) rebuilt all 20 release attachments and imported the three compatibility packs plus the reproducible External Host bridge pack on Linux/Windows with Godot 4.3/4.7. Historical public attachment digests remain pinned, while the privacy-neutral current source tree has its own deterministic rebuild hashes.

The ZIP uses engine-neutral PNG and JSON as its source of truth and intentionally contains no executable addon code. Install the MIT-licensed importer only from this official repository (or the Godot Asset Library once published), then select the extracted pack's `mapsoo.manifest.json`; schema 0.2 derives Ground, Water, and Roads `TileMapLayer` nodes, Props, two TerrainSets, and basic Water collision under `res://mapsoo_imports/`. Managed-resource ownership remains in `mapsoo.import-state.json`: identical clean input is `unchanged`, a clean source update is `updated`, and manual edits or legacy output without state fail closed as `conflict`. This is a terrain asset and import contract, not a complete game, navigation system, or production-readiness claim. SHA-256 records verify pack consistency, not publisher identity, so never enable scripts copied from a third-party asset pack.

## First Godot import

The public first-user path is intentionally short and version-bound:

1. Download the audited complete farm Pack 0.6 from the [Alpha9 release](https://github.com/babyrush0101-source/mapsoo-worldforge/releases/tag/v0.1.0-alpha.9) (`10d89c…480c`).
2. Download the separate [Alpha9 Godot importer ZIP](https://github.com/babyrush0101-source/mapsoo-worldforge/releases/download/v0.1.0-alpha.9/mapsoo-godot-importer-v0.1.0-alpha.9.zip) (`bfb736d0…b526`) from the same release.
3. Follow the exact filenames, hashes, and steps in the [10-minute Alpha9 guide](docs/10_FIRST_GODOT_IMPORT.md).
4. Submit either success or failure through the [structured feedback form](https://github.com/babyrush0101-source/mapsoo-worldforge/issues/new?template=first-import-feedback.yml).

The expected generated directory is `res://mapsoo_imports/alpha9-godot-smoke-pack/`. The guide pins both download hashes and explains the current derived-output/re-import boundary.

## Why this order

Image generation alone does not make a usable game-asset pipeline. Mapsoo first makes the asset contract, validation, reproducibility, preview, and export reliable. The Workbench now routes its initial, edited, imported World Specs, and projected External Host requests through the provider SDK, atomically stores a deeply frozen runner-owned world/evidence result, exposes the Provider snapshot that produced it, and keeps only the latest request eligible to update the preview. The legacy exporter rejects bare worlds and optional AI providers; full receipt/manifest projection enters a new versioned pack rather than rewriting the published alpha.

The registered alpha.2 release introduced runner-owned evidence and actual World Spec byte binding in receipt `0.2.0`; alpha.3 added safe Godot re-import; alpha.4 uses a separately version-bound `procedural-terrain-v2@0.2.0` policy and pack schema 0.2 without changing any older published fixture or hash. AI-provider publication remains fail-closed: the current export policy authorizes only the exact source-free CC0 built-in procedural terrain profile.

Release tooling now resolves `package.json` through a fail-closed, immutable version registry. That registry selects the exact fixture, release inputs, itch.io page/media, and receipt policy; CI also rebuilds every published example pack and compares it with its pinned public SHA-256. Every GitHub attachment digest for a published tag is pinned, and the builder refuses to overwrite that tag—continued development must use a new candidate version.

## Documentation

- [Master plan](docs/00_MASTER_PLAN.md)
- [Product and MVP specification](docs/01_PRODUCT_AND_MVP.md)
- [Technical architecture](docs/02_TECHNICAL_ARCHITECTURE.md)
- [Asset and export specification](docs/03_ASSET_AND_EXPORT_SPEC.md)
- [Roadmap](docs/04_ROADMAP.md)
- [Open-source and Codex OSS readiness](docs/05_OPEN_SOURCE_READINESS.md)
- [Security and migration audit](docs/06_SECURITY_AND_MIGRATION.md)
- [External Host integration](docs/07_EXTERNAL_HOST_INTEGRATION.md)
- [Executable External Host Asset Request contract](integrations/external-host/README.md)
- [GitHub, itch.io, and Codex for OSS release kit](docs/08_RELEASE_ITCH_AND_OSS_KIT.md)
- [Alpha9 community test campaign](docs/20_COMMUNITY_ALPHA9_OUTREACH.md)
- [Alpha10 complete side-platformer contract](docs/21_ALPHA10_SIDE_PLATFORMER.md)
- [Four-profile visual acceptance](docs/22_FOUR_PROFILE_VISUAL_ACCEPTANCE.md)
- [Dialogue to a playable world](docs/23_DIALOGUE_TO_PLAYABLE_WORLD.md)
- [Runtime consumer boundary](docs/24_RUNTIME_CONSUMER_BOUNDARY.md)
- [Character identity projection](docs/25_CHARACTER_IDENTITY_PROJECTION.md)
- [Alpha11 original isometric-action candidate](docs/26_ALPHA11_ISOMETRIC_ACTION.md)
- [Alpha12 original layered-depth 2D candidate](docs/27_ALPHA12_LAYERED_DEPTH_2D.md)
- [Raspberry Pi 4B ARM64 runtime bundle](docs/28_RASPBERRY_PI4_ARM64_RUNTIME.md)
- [Codex for OSS application evidence and truthful draft](docs/29_CODEX_OSS_APPLICATION.md)
- [Alpha12 engineering-art review and production replacement gate](docs/30_ALPHA12_ART_REVIEW.md)
- [Production-art replacement pipeline and first side-platformer direction sample](docs/31_PRODUCTION_ART_PIPELINE.md)
- [Production-art task/output contract for all four profiles](docs/32_PRODUCTION_ART_CONTRACT.md)
- [Independent character profile revisions and neutral runtime binding](docs/33_CHARACTER_PROFILE_REVISION.md)
- [Godot runtime binding for portable character profiles](docs/50_CHARACTER_PROFILE_RUNTIME_BINDING.md)
- [Private-consumer world creation and World Runner bridge](docs/51_PRIVATE_CONSUMER_WORLD_CREATION_BRIDGE.md)
- [Generation Provider SDK](docs/09_PROVIDER_SDK.md)
- [Model-backed production art and safe single-task CLI](docs/49_MODEL_BACKED_PRODUCTION_ART.md)
- [Live-model four-profile direction review](docs/52_LIVE_MODEL_FOUR_PROFILE_DIRECTION_REVIEW.md)
- [Operator-model complete internal candidate and golden-sample gaps](docs/53_OPERATOR_MODEL_GOLDEN_SAMPLE.md)
- [10-minute first Godot import](docs/10_FIRST_GODOT_IMPORT.md)
- [Safe Godot re-import contract](docs/11_SAFE_GODOT_REIMPORT.md)
- [Alpha.9 reference-to-farm scope and acceptance](docs/19_ALPHA9_REFERENCE_TO_FARM_WORLD.md)
- [v0.1.0-alpha.9 release notes](docs/releases/v0.1.0-alpha.9.md)
- [Deterministic itch.io release visuals](docs/release-visuals/README.md)
- [Verified itch.io operator upload kit](docs/itch-kit/README.md)
- [75-second evidence video source and verification](video/README.md)
- [v0.1.0-alpha.1 release notes](docs/releases/v0.1.0-alpha.1.md)
- [v0.1.0-alpha.2 release notes](docs/releases/v0.1.0-alpha.2.md)
- [v0.1.0-alpha.2 release visual source](docs/release-visuals/README-v0.1.0-alpha.2.md)
- [v0.1.0-alpha.3 release notes](docs/releases/v0.1.0-alpha.3.md)
- [v0.1.0-alpha.3 release visual source](docs/release-visuals/README-v0.1.0-alpha.3.md)
- [v0.1.0-alpha.4 design and acceptance](docs/12_ALPHA4_PLAYABLE_TERRAIN.md)
- [Alpha.5 semantic places scope and acceptance](docs/13_ALPHA5_SEMANTIC_PLACES.md)
- [v0.1.0-alpha.4 release notes](docs/releases/v0.1.0-alpha.4.md)
- [v0.1.0-alpha.4 release visual source](docs/release-visuals/README-v0.1.0-alpha.4.md)
- [v0.1.0-alpha.5 release notes](docs/releases/v0.1.0-alpha.5.md)
- [Alpha.6 exterior structures scope and acceptance](docs/15_ALPHA6_EXTERIOR_STRUCTURES.md)
- [v0.1.0-alpha.6 release notes](docs/releases/v0.1.0-alpha.6.md)
- [v0.1.0-alpha.6 deferred release visual source](docs/release-visuals/README-v0.1.0-alpha.6.md)
- [v0.1.0-alpha.6 first-import guide](docs/16_ALPHA6_FIRST_GODOT_IMPORT.md)
- [Alpha.7 multi-world gallery scope and acceptance](docs/17_ALPHA7_MULTI_WORLD_GALLERY.md)
- [v0.1.0-alpha.7 release notes](docs/releases/v0.1.0-alpha.7.md)
- [Alpha.8 reproducible External Host export CLI scope and acceptance](docs/18_ALPHA8_EXTERNAL_HOST_EXPORT_CLI.md)
- [Community evidence ledger](docs/14_COMMUNITY_EVIDENCE.md)

## Community and contributing

Bug reports, feature proposals, and reproducible Godot import feedback are welcome through the repository [issue templates](https://github.com/babyrush0101-source/mapsoo-worldforge/issues/new/choose). Before opening a pull request, read [CONTRIBUTING.md](CONTRIBUTING.md); project decision and response boundaries are documented in [GOVERNANCE.md](GOVERNANCE.md), sensitive reports belong in the private path described by [SECURITY.md](SECURITY.md), and independent use is recorded only when it satisfies the public [community evidence ledger](docs/14_COMMUNITY_EVIDENCE.md). This is a volunteer-maintained project and does not offer an SLA.

The reviewed [silent bilingual 75-second MP4](docs/media/v0.1.0-alpha.1/video/mapsoo-worldsmith-v0.1.0-alpha.1-75s.mp4) remains an immutable alpha.1 [GitHub release asset](https://github.com/babyrush0101-source/mapsoo-worldforge/releases/download/v0.1.0-alpha.1/mapsoo-worldsmith-v0.1.0-alpha.1-75s.mp4). Alpha.2 does not rename or reuse it as evidence.

## Local development

Requirements: Node.js 20+ and pnpm 11+.

```bash
pnpm install
pnpm dev
```

Run the complete local verification before contributing:

```bash
pnpm check
pnpm security:audit
pnpm release:history:remote
pnpm release:browser:verify
```

`pnpm check` is the deterministic offline project gate and includes the production-license notice verifier. The audit checks both the current app and historical alpha.1 video lockfiles against the package registry. The final commands confirm all nine immutable public GitHub releases, reproduce the registered browser exporters and verify the Alpha.8 External Host bridge CLI and Alpha.9 Pack 0.6 release evidence.

After registering and selecting a future unpublished version, build, validate, and reproduce its complete candidate release bundle:

```bash
pnpm release:local
```

The command intentionally refuses to rebuild a version whose lifecycle is already `published`. To inspect a published release, download its attachments into the configured release directory and run `pnpm release:verify`; every attachment must match the pinned GitHub digest. Start a new candidate version for any changed output.

Build the exact version-configured itch.io Draft directory. Alpha.1–Alpha.4 retain their historical cover/screenshots; because Alpha.5 and Alpha.6 postpone itch publication, their Drafts contain only the executable-free asset ZIP, checksum, page metadata/copy, and byte manifest—no media and no upload:

```bash
pnpm release:itch
```

Candidate GitHub files are written to `release/v<version>/`; the separate itch.io operator kit is written to `release/itch/v<version>/`. The itch kit intentionally excludes the importer and preserves page visibility as `Draft` until the maintainer previews the real page. An explicit matching version tag creates a GitHub release **draft** only after the branch has been reviewed and merged; the maintainer then deliberately publishes the verified prerelease. The public alpha was produced through that path and is now protected from rebuilding.

No environment variables are required for the portable alpha. See [`.env.example`](.env.example) for the key-handling policy before adding a future provider.

The old marketing website is not part of the new product. Its history remains available in Git, while the active source tree is being rebuilt as the Worldsmith workbench.

## License

Source code is licensed under the [MIT License](LICENSE). Generated packs and bundled examples carry their own license metadata; do not assume that every imported or generated image is MIT-licensed.
