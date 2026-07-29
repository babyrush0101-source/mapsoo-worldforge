# Approved world-art delivery kit

Status: **implemented deterministic builder; no pack is uploaded to itch.io by
this repository**.

`buildApprovedWorldArtDeliveryKit()` is the final provider-neutral packaging
adapter for reviewed 2D world art. It does not generate images, change the
Godot scene, re-slice sprites, or copy the runtime overlay into a second asset
format. It places the exact approved `WorldArtRuntimeOverlay` ZIP inside a
small, human-readable delivery envelope.

The builder accepts only:

- an exact, CRC-valid `WorldArtRuntimeOverlay 1.0` archive, or an exact
  `WorldArtRuntimeOverlay 1.1` archive together with its separately supplied
  canonical trusted `WorldLayoutPlan`;
- an approved `ProductionWorldReview 1.0`;
- the canonical `HumanArtReviewReceipt 1.0` bytes;
- the exact preview, render, collision and traversal evidence referenced by
  that review;
- a safe pack id, title, semantic version and explicit generative-AI
  disclosure.

Every input is re-read and re-hashed. The receipt must bind the same profile,
preview, Godot capture, runtime projection and complete overlay ZIP. The
overlay rights, human-approved rights and final delivery rights must be
identical.

Overlay 1.0 produces the frozen `WorldArtDeliveryKit 1.0` contract. Overlay
1.1 produces the separate `WorldArtDeliveryKit 1.1` contract and declares
`world-art-runtime-overlay-1.1`; it does not reinterpret or widen the 1.0
schema. A 1.1 overlay without the exact layout fails closed.

## Archive layout

```text
<pack-id>-v<version>/
  world-art-delivery.json
  readme.md
  license-assets.md
  changelog.md
  assets/
    world-art-runtime-overlay-<digest>.zip
  review/
    production-world-review.json
  review-evidence/
    <human-review>.json
    world-preview.png
    world-capture.png
    role-overlay.png
    collision-overlay.png
    spawn-exit.avi|mp4
    navigation.avi|mp4
```

The exact evidence names come from the approved review. The archive contains no
`addons/`, `.gd`, `.godot/`, editor cache, private reference image, raw prompt
or provider credential. The trusted Godot importer remains a separately
installed open-source component.

The nested overlay is intentional. It remains the single runtime source of
truth and can be imported without teaching Godot about an itch.io-specific
format. The surrounding kit supplies the storefront-facing documentation,
preview and licensing evidence.

The trusted layout is not copied into a 1.1 delivery ZIP. This preserves the
privacy boundary for consumer-owned world descriptions, landmark labels, and
seed. A receiving runtime must already own the exact canonical layout. A
publicly redistributed 1.1 kit is therefore appropriate only when its matching
layout is distributed separately through a privacy-reviewed channel; use the
layout-independent 1.0 art delivery when that handoff is unavailable.

## Private versus public

`approved-private` produces:

- `distribution: private`;
- `LicenseRef-Proprietary`;
- `permits_redistribution: false`;
- a license notice that explicitly denies redistribution.

`approved-public` produces:

- `distribution: public`;
- `CC0-1.0`, `CC-BY-4.0`, or `CC-BY-SA-4.0`;
- `permits_redistribution: true`;
- mandatory attribution for attribution licenses.

Changing a private approval to public, changing the license text, substituting
the overlay or changing a single evidence byte invalidates the build.

## itch.io use

The ZIP is suitable for an itch.io `Graphical Assets` project:

- one stable root folder;
- Quick Start and supported Godot versions;
- clear asset license and changelog;
- exact preview and review evidence;
- explicit generative-AI disclosure;
- no executable platform flag or bundled importer.

The builder is intentionally local-only. Publishing still requires a person to
review the generated page, upload the exact verified ZIP, select `Graphical
Assets`, enter the same AI disclosure, and confirm the license. Passing this
builder never logs in to itch.io or grants upload permission.

## Delivery CLI

The final packaging adapter is exposed as a local maintainer command:

```console
pnpm production-art:delivery-kit:build -- \
  --overlay <world-art-runtime-overlay-id.zip> \
  --approval <approved-production-world-review.json> \
  --receipt <canonical-human-art-review.json> \
  --evidence-root <technical-review-workspace> \
  --layout <world-layout-plan.json> \
  --pack-id <kebab-case-pack-id> \
  --title "<display title>" \
  --version <semver> \
  --contains-generative-ai true \
  --out <delivery-output-directory>
```

`--layout` is required for Overlay 1.1 and forbidden for Overlay 1.0. The
command re-reads the complete overlay, approved review, canonical human
receipt, preview and every cited technical evidence file. It rejects unsafe
relative paths, symlinks, junctions, hard-link aliases, changed files and a
different existing output ZIP.

The output filename is derived from the approved pack id and version. Repeating
the command with exact inputs reports `delivery-kit-unchanged`; it never
overwrites different bytes. The JSON summary always reports zero remote
requests and `uploaded: false`, `published: false`.

For a private consumer integration, keep the Overlay 1.1 layout in the
consumer-owned workspace and run this CLI there. The delivery ZIP does not copy
the layout, private reference images, prompts, world prose, account data or
consumer identifiers.

The semantic manifest lives in
[`src/core/world-art-delivery-kit.ts`](../src/core/world-art-delivery-kit.ts),
with the independent 1.1 extension in
[`src/core/world-art-delivery-kit-v1-1.ts`](../src/core/world-art-delivery-kit-v1-1.ts).
The JSON Schemas are
[`schemas/mapsoo-world-art-delivery-kit-1.0.schema.json`](../schemas/mapsoo-world-art-delivery-kit-1.0.schema.json),
and
[`schemas/mapsoo-world-art-delivery-kit-1.1.schema.json`](../schemas/mapsoo-world-art-delivery-kit-1.1.schema.json),
and the ZIP adapter in
[`src/adapters/build-approved-world-art-delivery-kit.ts`](../src/adapters/build-approved-world-art-delivery-kit.ts).
The filesystem-safe CLI is
[`scripts/build-approved-world-art-delivery-kit.ts`](../scripts/build-approved-world-art-delivery-kit.ts).
