# Four-profile world-family continuity

Status: **implemented core contract and fail-closed source verification**

A user-created world may be rendered with four different camera and gameplay
grammars without becoming four unrelated worlds. `WorldFamilyContinuity 1.0`
proves that exact boundary before production approval:

- `side-platformer`;
- `isometric-action`;
- `topdown-farm`;
- `layered-depth-2d`.

The contract reuses `ConfirmedWorldCreationIntake 1.0` and
`CharacterProfileRevision 1.0`. It does not create another generation
provider, pack format, review system, or runtime.

## Fixed and adaptable fields

The following source facts must remain identical:

- target and seed;
- premise, worldview, terrain, culture, ecology, mood, and landmarks;
- the exact environment reference descriptor and rights;
- character id, opaque identity digest, source-reference descriptor, and
  output rights.

The profile may adapt geography, art direction, traversal, approved intent
preview, atlas geometry, actions, and directions. Those are projection-specific
details, so requiring identical values would prevent the four profiles from
expressing their actual camera and gameplay needs.

Every profile still needs its own confirmed intake and complete character
revision. Creation fails when a profile is missing, documents are assigned to
the wrong profile, the revision does not bind the confirmed character source,
or any fixed fact drifts.

## Receipt and verification

`createWorldFamilyContinuity()` reads the four local source pairs and emits a
small portable receipt containing:

- one domain-separated world-identity digest;
- one opaque character-identity digest and safe character id;
- exact fingerprints for all four confirmed intakes;
- exact fingerprints for all four character revisions;
- the fixed target and canonical profile order.

`verifyWorldFamilyContinuity()` rematerializes every source document,
recomputes the receipt, and requires byte-equivalent canonical data. The JSON
Schema is
[`mapsoo-world-family-continuity-1.0.schema.json`](../schemas/mapsoo-world-family-continuity-1.0.schema.json).

The read-only CLI exposes the same core functions without adding an application
path:

```bash
pnpm world-family:continuity -- --family-id=<safe-id> \
  --side-platformer-intake=<intake.json> \
  --side-platformer-character=<revision.json> \
  --isometric-action-intake=<intake.json> \
  --isometric-action-character=<revision.json> \
  --topdown-farm-intake=<intake.json> \
  --topdown-farm-character=<revision.json> \
  --layered-depth-2d-intake=<intake.json> \
  --layered-depth-2d-character=<revision.json>
```

It prints the source-minimized receipt to stdout. Add
`--receipt=<world-family-continuity.json>` to verify an existing receipt
against the same eight source documents.

The receipt intentionally contains no raw dialogue, private product field,
absolute path, source-image path, or provider credential. Operators should
still keep the source intakes and reference records private when their content
is not intended for publication.

## What this does not approve

`status: continuity-confirmed` means only that the four projections preserve
one world and one character. It does not mean:

- generated art passed human review;
- output or reference rights were approved for public release;
- a production pack is complete;
- Godot runtime, collision, or navigation passed;
- a physical Raspberry Pi 4B passed performance or rollback checks.

Those claims remain owned by the existing production-art, review-pack, World
Runner, and physical-Pi contracts.

## Reuse rule

Supplier features such as SpriteCook terrain templates enter through thin,
local adapters. Their useful geometry or tile ordering is normalized into
Mapsoo contracts, then the ordinary layout, material, pack, review, and Godot
paths continue unchanged. Supplier UI, accounts, billing, job state, and
proprietary response formats never become world-family or runtime fields.

This keeps the architecture small:

```text
external tool or image model
  -> thin adapter
  -> provider-neutral core contracts
  -> one application pipeline
  -> pack / review / Godot / Runner gates
```
