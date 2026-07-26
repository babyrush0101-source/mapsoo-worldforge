# CharacterProfileRevision 1.0

Status: executable provider-neutral contract

`CharacterProfileRevision` makes a character an independently versioned artifact. A consumer can replace the player visual for an existing world without regenerating the world map, collision, navigation, spawn points, or runtime contract.

The executable public slice lives in:

- `src/core/character-profile-revision.ts`;
- `schemas/mapsoo-character-profile-revision-1.0.schema.json`;
- `src/core/character-profile-revision.test.ts`.

It contains no product user record, NPC memory, private daemon field, source image bytes, absolute source path, hostname, device identifier, or private service address.

## Independent artifact

```text
world pack revision
  -> map, collision, navigation, spawn and neutral entity slots

character profile revision
  -> verified PNG atlas, frame grid, pivot and complete animation clips

launch
  -> bind one verified character revision to a compatible entity slot
```

`profile_revision_id` and `character_id` are portable lowercase IDs. The world profile is one of Mapsoo's four public profiles. The character atlas declares a safe relative PNG path, exact byte count, SHA-256, dimensions, frame grid and pixel pivot.

The model-backed projector derives its revision-id suffix from the character
ID, profile, canonical task, normalized atlas digest, domain-separated identity
digest, opaque reference IDs, and rights. Replaying identical inputs keeps the
same ID; changing identity or rights creates a different revision ID even when
the visible atlas bytes happen to match.

Atlas dimensions must exactly equal:

```text
width  = frame_width  × columns
height = frame_height × rows
```

Every animation frame is addressed by a bounded `column` and `row`; raw pixel offsets and implicit atlas slicing are not trusted.

## Complete profile clips

The semantic validator requires every player clip exactly once, in canonical action-major and direction-minor order:

| Profile | Actions | Directions | Clips |
|---|---|---|---:|
| `side-platformer` | idle, run, jump, fall, land, hurt | left, right | 12 |
| `topdown-farm` | idle, walk | north, east, south, west | 8 |
| `isometric-action` | idle, move, attack-primary, dash, hurt, defeat | 8 compass directions | 48 |
| `layered-depth-2d` | idle, walk, run, interact | left, right, near, far | 16 |

Missing, duplicated, reordered, out-of-profile, or out-of-grid clips fail closed. NPC-specific animation policies can be introduced as a future contract version; they are not silently inferred in 1.0.

## Source privacy

Only this minimized source identity summary is portable:

```ts
source_identity: {
  identity_digest_sha256: string;
  source_reference_ids: readonly string[];
}
```

The identity digest is supplied by the trusted projection boundary. The
model-backed CLI derives it with a domain-separated SHA-256 over the approved
character-reference digest, so the portable revision does not expose the raw
reference digest. Source reference IDs are opaque lowercase IDs, not file
paths. Drive letters, separators, URLs, filenames, original images, local
paths, prompts, private character names and private identity records are not
part of this contract.

This digest is a stable integrity and correlation primitive. It is not proof
of authorship, identity, visual similarity, or preservation of semantic
character traits; those remain human-review questions.

## Rights and distribution

Every revision declares:

```ts
rights: {
  distribution: 'private' | 'internal-review' | 'public';
  license:
    | 'CC0-1.0'
    | 'CC-BY-4.0'
    | 'CC-BY-SA-4.0'
    | 'LicenseRef-Proprietary';
  attribution?: string;
}
```

- Private and internal-review output may remain `LicenseRef-Proprietary`.
- Public output with `LicenseRef-Proprietary` fails closed.
- CC BY and CC BY-SA require non-empty attribution.
- The character revision's rights are independent from the world pack's rights.

A private consumer can therefore use a private character revision with an
otherwise redistributable world without publishing that character. A
model-generated candidate remains `internal-review` until human art and rights
review deliberately changes its distribution and license.

## Neutral runtime binding

`character-profile.bind` is an idempotent message. Its canonical payload binds:

- runtime contract, session and neutral entity slot;
- runtime entity ID;
- character and profile revision IDs;
- canonical revision SHA-256;
- world profile;
- exact atlas path and SHA-256.

The message itself carries an idempotency key and canonical payload SHA-256. Reusing the same key and payload is safe for a consumer; a mutated payload, substituted revision, mismatched world profile, unknown slot, non-character slot, or slot that does not accept `character-atlas` fails before projection.

After validation, `projectCharacterProfileBindToPortableRuntime` produces the existing neutral `PortableRuntimeBindPayload`:

```ts
{
  contract_id,
  session_id,
  bindings: [{
    slot_id,
    entity_id,
    asset_path: revision.atlas.path,
    asset_sha256: revision.atlas.sha256
  }]
}
```

The open-source repository defines and tests this portable projection. A consuming product remains responsible for idempotency storage, authorization, transport, deployment, runtime process state and private identity resolution.

## Validation boundary

JSON Schema rejects unknown fields, malformed IDs, unsafe paths, invalid digests, unsupported profiles and public proprietary rights. The TypeScript semantic validator is authoritative for relationships JSON Schema cannot express compactly:

- exact profile-specific clip sequence;
- atlas-to-frame-grid dimension equality;
- pivot and frame grid bounds;
- revision/payload equality;
- canonical revision and payload digests;
- runtime contract, world profile and entity-slot compatibility.

Tests use synthetic characters, paths, IDs and digests only.
