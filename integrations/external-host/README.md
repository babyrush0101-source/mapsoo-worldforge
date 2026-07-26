# External Host integration contract

This directory defines the public, privacy-minimized boundary between an External Host world/scene request and Mapsoo Worldsmith. It is an integration example, not a private External Host SDK and not evidence that External Host production adoption is complete.

## Contract files

- [`external-host-asset-request.schema.json`](external-host-asset-request.schema.json) — strict Draft 2020-12 request schema;
- [`../../examples/integrations/external-host/river-valley-asset-request.json`](../../examples/integrations/external-host/river-valley-asset-request.json) — synthetic public fixture;
- [`../../src/integrations/external-host/asset-request.ts`](../../src/integrations/external-host/asset-request.ts) — validated projection and canonical SHA-256 binding;
- [`../../src/integrations/external-host/asset-request.test.ts`](../../src/integrations/external-host/asset-request.test.ts) — projection, determinism, privacy allowlist, invalid version, tag, dimension, style, and license tests.
- [`../../src/adapters/import-external-host-asset-request.ts`](../../src/adapters/import-external-host-asset-request.ts) — strict local file import sharing the World Spec UTF-8/size/structure boundary;
- [`../../src/adapters/import-external-host-asset-request.test.ts`](../../src/adapters/import-external-host-asset-request.test.ts) — file, duplicate-key, private-field, size, UTF-8, and safe-error tests.
- [`external-host-mapsoo-export-receipt.schema.json`](external-host-mapsoo-export-receipt.schema.json) — strict request-to-pack receipt schema;
- [`../../src/integrations/external-host/export-bridge.ts`](../../src/integrations/external-host/export-bridge.ts) — validated World Spec 0.2 → 0.3 bridge with no invented places or structures;
- [`../../scripts/export-external-host-pack.mjs`](../../scripts/export-external-host-pack.mjs) — reproducible no-UI exporter using loopback-only headless Chrome;
- [`../../scripts/verify-external-host-export-cli.mjs`](../../scripts/verify-external-host-export-cli.mjs) — byte-reproducibility, conflict, hash-binding, and privacy-negative gate.

Run the focused contract gate:

```bash
pnpm exec vitest run src/integrations/external-host/asset-request.test.ts src/adapters/import-external-host-asset-request.test.ts
pnpm external-host:export:verify
```

The same tests are included in `pnpm check`. The Workbench exposes **Load External Host Asset Request** beside the ordinary World Spec loader; both paths supersede stale requests and preserve the last successful world on failure.

## Data flow

```text
External Host private World State
        │ explicit allowlist projection
        ▼
ExternalHostAssetRequest 1.0.0
        │ canonical key ordering + SHA-256
        ▼
Mapsoo World Spec 0.2.0
        │ org.mapsoo.externalhost.assetrequest.v1 metadata
        ▼
World Spec 0.3 migration (no inferred semantics)
        │ local procedural provider + explicit timestamp
        ▼
Alpha.7-compatible executable-free pack + external export receipt
        │
        ▼
trusted Godot importer
```

`packId` identifies one scene/variant pack and must be unique when multiple variants need to coexist in Godot. `world.id` and `world.version` identify the parent External Host world; `scene.id` and `requiredSceneTags` provide stable public semantics. The request hash binds every allowlisted request field. Reordering JSON object keys does not change the hash, while changing tag array order does because arrays are ordered contract data.

The alpha preserves scene tags as namespaced World Spec metadata; it does not yet place semantic interaction anchors into the generated map. Reimporting the same `packId` intentionally replaces Mapsoo-derived Godot resources. Hand-authored gameplay logic must stay outside `res://mapsoo_imports/<packId>/`.

## Privacy boundary

The request schema is an allowlist and rejects unknown keys at every level. Do not add any of the following:

- child identity, voice, chat, learning progress, or growth records;
- parent identity, contact information, household settings, or relationship data;
- private URLs, service credentials, paid provider keys, or internal commercial data;
- unlicensed character/IP references or content-safety conclusions.

The adapter rejects non-allowlisted fields; it is not a PII detector. A name, internal identifier, email address, secret, or private URL encoded in any allowlisted string—including IDs, tags, content rating, seed, title, or description—would still cross the boundary. The External Host-side projection must therefore supply synthetic or explicitly public-safe values for every field before calling Mapsoo.

Namespaced `extensions` are exported inside the asset pack. They are an interoperability mechanism, not a privacy sandbox. External Host remains responsible for age suitability, family controls, story state, tasks, printing, and content safety; Mapsoo produces reproducible visual source assets and verifiable pack metadata.

## No-UI export

```bash
pnpm external-host:export -- \
  --input examples/integrations/external-host/river-valley-asset-request.json \
  --out-dir ./external-host-output \
  --completed-at 2026-07-19T12:00:00.000Z
```

The command requires Node.js 20+, pnpm 11+, and Chrome/Chromium. It writes the ZIP and external receipt only when both targets are absent. Repeating the exact export is an `unchanged` no-op; any partial, modified, symlinked, or mismatched output is a `conflict`. The receipt binds the canonical request hash, projected World Spec hash, provider identity, pack SHA-256, manifest hash, and generation-receipt hash without storing local paths.

This is an executable integration boundary, not evidence that the separate External Host product has adopted it in production. A consumer-side contract test will be added only when a real public-safe External Host runtime repository exists.
