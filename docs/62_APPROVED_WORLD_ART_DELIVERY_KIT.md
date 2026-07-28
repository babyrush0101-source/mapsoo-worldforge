# Approved world-art delivery kit

Status: **implemented deterministic builder; no pack is uploaded to itch.io by
this repository**.

`buildApprovedWorldArtDeliveryKit()` is the final provider-neutral packaging
adapter for reviewed 2D world art. It does not generate images, change the
Godot scene, re-slice sprites, or copy the runtime overlay into a second asset
format. It places the exact approved `WorldArtRuntimeOverlay` ZIP inside a
small, human-readable delivery envelope.

The builder accepts only:

- an exact, CRC-valid `WorldArtRuntimeOverlay 1.0` archive;
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

The semantic manifest lives in
[`src/core/world-art-delivery-kit.ts`](../src/core/world-art-delivery-kit.ts),
its JSON Schema in
[`schemas/mapsoo-world-art-delivery-kit-1.0.schema.json`](../schemas/mapsoo-world-art-delivery-kit-1.0.schema.json),
and the ZIP adapter in
[`src/adapters/build-approved-world-art-delivery-kit.ts`](../src/adapters/build-approved-world-art-delivery-kit.ts).
