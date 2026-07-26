# Pack 1.0 licensed-production migration draft

## Why Pack 1.0 is required

Pack 0.9 cannot represent an internal or privately licensed production
candidate honestly. It requires CC0 and redistribution before the importer can
inspect the world. It also aliases four distinct art roles and permits only one
frame per projected character clip in the current production bridge.

Pack 1.0 should separate technical validation from public-release permission.
The draft schema is:

`schemas/mapsoo-pack-1.0.schema.json`

It does not modify or weaken published Pack 0.9.

## Proposed contract

Pack 1.0 adds:

- `distribution`: `internal-review`, `private`, or `public`;
- an explicit SPDX or `LicenseRef-*` output license;
- independent `permits_redistribution` and `permits_commercial_use` flags;
- human-art, rights, runtime and Raspberry Pi review gates;
- eight independent depth planes, including local lighting;
- one explicit file or atlas-region binding for every role;
- multi-frame character clips with per-frame durations;
- an exclusion contract that forbids embedding original references and raw
  prompts while permitting one-way audit hashes.

Public distribution is conditional: human-art, rights, runtime, and Raspberry
Pi review must pass, redistribution must be permitted, and
`LicenseRef-UNRELEASED` is forbidden.
Internal-review distribution requires redistribution to remain false.

## Migration

1. Keep current production candidates `internal-review` and
   `LicenseRef-UNRELEASED`.
2. Implement a new Pack 1.0 validator/importer beside Pack 0.9.
3. Allocate distinct regions for all 22 environment roles.
4. Export both independently sourced and declared synthetic character frames;
   retain per-frame provenance and never call them model-native animation.
5. After human and rights approval, choose the actual output license and
   regenerate the manifest/receipt.
6. Only a `public` Pack 1.0 artifact with passing release gates may be uploaded
   to a marketplace or attached to a public release.

No original reference image, raw dialogue, private consumer data or private
project identifier belongs in the public pack.

## Executable contract

The draft is now enforced in three independent layers:

- `schemas/mapsoo-pack-1.0.schema.json` validates the closed JSON shape and
  distribution-specific license gates;
- `src/core/pack-manifest-1.0.ts` validates canonical roles, independent
  planes/regions, file references, complete multi-frame clips, provenance and
  privacy semantics;
- `godot/addons/mapsoo_importer/mapsoo_pack_10.gd` imports the exact data-only
  contract. Non-public packs require a trusted caller grant bound to the exact
  pack ID and distribution.

The Godot importer rejects scripts, shaders, executables, URLs, absolute paths,
traversal paths, undeclared files, dangling references and out-of-bounds atlas
regions. Public packs require all four review gates, an approved
commercial/redistributable license and human curation for generative output.

## Neutral conformance evidence

The public fixture in `tests/fixtures/pack10-public/` is generated entirely
from fixed integer geometry and a fixed palette. It contains no production
art or private integration content.

```bash
pnpm pack10:fixture:build
pnpm pack10:fixture:verify
```

Current deterministic evidence:

- 21 payload files;
- 36 exact role bindings;
- 16 player clips and 8 NPC clips, each with two unique frames;
- manifest SHA-256
  `ad5518467874224b8077e2ade095414f051c06e9be98a0a3eb72f23f79474b7c`;
- ZIP SHA-256
  `75a109f72285e61441b0ed8a5862c6a63715d50f37562f760575738cd735a913`.

The routed importer and all negative authorization/content cases pass in
Godot 4.3 and 4.7. This synthetic fixture proves the public contract; it does
not upgrade the separate production-art candidate out of
`internal-review / UNRELEASED`.
