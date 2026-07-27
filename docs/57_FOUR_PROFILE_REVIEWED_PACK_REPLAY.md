# Four-profile reviewed Pack replay

WorldForge has one narrow path for replaying already assembled and reviewed
world assets. It supports all four public profiles without creating a second
packing pipeline:

| Profile | Pack contract | Projector responsibility |
| --- | --- | --- |
| `topdown-farm` | Pack 0.6 review archive | Map verified top-down assets to 21 roles |
| `side-platformer` | Pack 0.7 review archive | Map verified side assets and runtime sidecars to 30 roles |
| `isometric-action` | Pack 0.8 review archive | Map verified isometric assets and runtime sidecars to 36 roles |
| `layered-depth-2d` | Pack 1.0 | Map 19 unique runtime files to 36 layered-depth roles |

The public application entry is `replayReviewedWorldAsset()`.

```text
immutable reviewed ZIP
  -> loadExactPackArchive()
  -> profile-specific semantic projector
  -> ReviewedWorldAssetSourceReceipt
  -> createFingerprintBoundWorldAssetReplayProvider()
  -> runWorldAssetProvider()
```

## Why this stays small

The shared archive loader owns ZIP limits, safe paths, exact inventory,
CRC-checked extraction and file hashes. Each projector owns only the semantic
differences that cannot be shared. The receipt and replay provider are shared.
There is no provider registry, dependency-injection framework or second Godot
importer.

Image generators, SpriteCook, artist exports and offline tools remain upstream
candidate producers. They may use their own accounts, asset IDs and retries,
but must be reduced to the same provider-neutral files and review evidence
before this replay path accepts them.

## Trust boundary

Replay is exact-byte and request-fingerprint bound. It rejects:

- an extra, missing, renamed or hash-mismatched archive entry;
- a Pack contract that does not match the requested profile;
- incomplete roles, invalid canonical PNGs or invalid runtime sidecars;
- a changed description, seed, reference set or rights declaration;
- an internal review archive whose pending gates were silently promoted.

Runtime payloads never contain license, provenance or review documents. Those
facts remain in the versioned
`mapsoo-reviewed-world-asset-source-receipt-1.0` record. Successful replay
proves deterministic materialization, not human art approval, publication
rights or physical Raspberry Pi acceptance.

## Reuse policy

Borrow mature capabilities when they are outside WorldForge's core:

- generation, reference editing, animation and transparent-background cleanup;
- reusable style references and provider-side asset identifiers;
- tile previews, atlas editing and generic format conversion;
- provider authentication, quota checks, polling and downloads.

Only a thin adapter may know these provider details. The world specification,
four-profile completeness rules, review state, reproducible Pack, Godot import
and World Runner contract remain provider-neutral.
