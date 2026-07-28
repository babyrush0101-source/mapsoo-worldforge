# Runtime consumer boundary

Status: public integration boundary plus executable neutral intake, runtime,
character, and delivery contracts

Mapsoo generates portable, verifiable world and character art data. A consuming product owns users, character identity truth, NPC behavior, memory, dialogue, permissions, device fleet state, and business completion.

This boundary lets a private product consume Mapsoo packs without copying private product content into the open-source repository.

The executable boundary now lives in:

- `src/core/portable-world-runtime-contract.ts`;
- `schemas/mapsoo-portable-world-runtime-1.0.schema.json`;
- `src/core/portable-world-runtime-contract.test.ts`;
- `src/core/character-profile-revision.ts`;
- `schemas/mapsoo-character-profile-revision-1.0.schema.json`;
- `src/core/character-profile-revision.test.ts`;
- `src/core/character-profile-family.ts`;
- `schemas/mapsoo-character-profile-family-1.0.schema.json`;
- `src/core/character-profile-family.test.ts`;
- `src/core/confirmed-world-creation-intake.ts`;
- `schemas/mapsoo-confirmed-world-creation-intake-1.0.schema.json`;
- `src/core/world-runner-delivery.ts`;
- `schemas/mapsoo-world-runner-delivery-1.0.schema.json`.

It validates a portable world, spawn points, neutral entity slots and event hooks, plus generic `prepare`, `bind`, `launch`, `exit`, and `status` messages. Every bridge message carries an idempotency key and a canonical payload SHA-256; unknown slots, broken references, unsafe paths, private extension fields, and changed payloads fail closed. This is a public protocol and mockable validation boundary, not a client for any private daemon.

## Public pipeline responsibility

```text
confirmed world decisions
  -> complete visual assets
  -> collision, navigation, anchors and entity slots
  -> integrity-checked portable pack
  -> Godot import
  -> target runtime artifact input
```

Mapsoo may describe neutral scene slots and event hooks. It must not store real user events or interpret “asset ready”, “scene loaded”, or “world entered” as a private product transaction having completed.

## Portable world runtime contract

```ts
interface PortableWorldRuntimeContract {
  readonly schemaVersion: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly profile:
    | 'side-platformer'
    | 'topdown-farm'
    | 'isometric-action'
    | 'layered-depth-2d';

  readonly packSha256: string;
  readonly manifestSha256: string;
  readonly minimumGodotVersion: string;
  readonly importerContractVersion: string;

  readonly scenes: readonly WorldSceneContract[];
  readonly entitySlots: readonly WorldEntitySlot[];
  readonly eventHooks: readonly WorldEventHook[];
}
```

Scene, location, spawn, exit, and slot IDs are stable generated IDs. Public fixtures use synthetic names only.

## World and character composition

The runtime should load two independently versioned artifacts:

```text
world runtime
  - map, terrain, structures and depth layers
  - collision, navigation, anchors and neutral entity slots

character profile revision
  - atlas and SpriteFrames for the selected profile
  - alpha bounds, foot anchor and pivot
  - clip manifest and identity-projection receipt
```

Changing a character revision must not require rebuilding or overwriting the world artifact. The consumer binds a verified character asset reference to the generated player slot at launch.

Mapsoo does not own a character's private identity record. It may expose an opaque consumer-supplied reference and a public-safe visual identity signature only when the user explicitly permits cross-pack correlation.

`CharacterProfileRevision 1.0` now makes this separation executable. It validates the PNG atlas, frame grid, pivot, complete profile-specific clips, minimized source identity summary, independent output rights, and canonical revision digest. Its `character-profile.bind` message verifies the chosen revision against the world profile and a character-capable neutral entity slot, then projects to the existing `runtime.bind` payload. See `docs/33_CHARACTER_PROFILE_REVISION.md`.

`CharacterProfileFamily 1.0` binds four such revisions to one minimized
character identity without including the source image, path, raw source-file
digest or free-text world description. A consumer selects the member matching
the confirmed world profile and keeps its private character record outside this
repository. See `docs/68_CHARACTER_PROFILE_FAMILY_CLI.md`.

## Neutral entity slots

```ts
interface WorldEntitySlot {
  readonly slotId: string;
  readonly entityKind: 'player' | 'npc' | 'interactable' | 'ambient';
  readonly sceneId: string;
  readonly locationId: string;
  readonly transform: {
    readonly x: number;
    readonly y: number;
    readonly zOrder: number;
    readonly facing?: string;
  };
  readonly visualRole?: string;
  readonly defaultVisualAssetRef?: string;
  readonly runtimeBindingKey?: string;
}
```

NPC personality, story, memory, relationships, goals, agent policy, permissions, and private runtime identifiers never belong in the public pack. A consumer resolves `runtimeBindingKey` inside its own trusted runtime.

Generated players share one trusted, profile-independent NPC interaction
controller. The reusable runtime shell exposes `interact_nearest_npc()` and
returns only a neutral NPC ID plus distance. The consumer maps that public ID
to its private NPC runtime and dialogue flow. See
`docs/67_SHARED_NPC_INTERACTION.md`.

## Runtime bridge

The open-source side defines and validates a neutral message contract, but it does not implement or expose a private daemon client:

```ts
interface WorldRuntimeBridge {
  prepareWorld(input: PrepareWorldInput): Promise<RuntimeAck>;
  bindCharacter(input: BindCharacterInput): Promise<RuntimeAck>;
  launchWorld(input: LaunchWorldInput): Promise<RuntimeAck>;
  requestExit(input: ExitWorldInput): Promise<RuntimeAck>;
  getStatus(runRef: string): Promise<RuntimeStatus>;
}
```

Every write requires an idempotency key and payload digest. Replaying the same key and digest is safe; the same key with a different digest fails before any write. Device unavailability is explicit and must never silently fall back to a developer workstation.

## Raspberry Pi class target

The target device should not rebuild a new game for every world. The shortest controlled path is:

```text
frozen portable pack
  -> build machine performs Godot import
  -> reproducible target-neutral PCK + verified Linux ARM64 runtime
  -> device downloads and verifies SHA-256
  -> staging smoke
  -> atomic promotion with rollback
  -> launch the selected main pack
```

Machine launch, rendered visual review, performance review, and user acceptance are four separate states.

The target artifact records source pack hash, engine version, architecture, main scene, entry count, reproduction digest, and smoke result. It contains runtime files only; QA captures, source workspaces, private logs, tokens, hostnames, and absolute paths are excluded.

## Isolation rule

The public repository must never contain private world or character names, NPC stories, product copy, user or device identifiers, service addresses, tokens, hostnames, internal database/event schemas, private asset hashes, private screenshots, or private source paths.

Tests use only synthetic worlds, characters, entity slots, digests, and runtime acknowledgements. The complete private-consumer bridge and remaining host responsibilities are documented in `docs/51_PRIVATE_CONSUMER_WORLD_CREATION_BRIDGE.md`.
