# Core and reuse policy

Status: **active architecture rule**

WorldForge owns only the capabilities that make a confirmed world portable,
reviewable, and runnable:

1. turn a multi-turn, human-confirmed world intent into versioned constraints;
2. solve one deterministic layout for the selected 2D profile;
3. compile the complete provider-neutral asset requirement inventory;
4. bind one user-owned character identity across profiles;
5. normalize and review untrusted art candidates;
6. build reproducible Packs and load them through the Godot/World Runner
   contract.

Everything else is a replaceable authoring capability. The project should use
an existing library, local export, artist workflow, or server-only adapter
when its license and data handling are acceptable.

## One small architecture

```text
features / CLI
      |
      v
app use cases
      |
      +----> core contracts and validation
      |
      +----> replaceable adapters/providers
                    |
                    +-- offline procedural baseline
                    +-- SpriteCook
                    +-- another model, tool, or artist
      |
      v
reviewed Pack -> Godot importer -> World Runner
```

`core` never knows an account, API key, credit balance, model response, remote
asset ID, or vendor SDK. A third-party result is always untrusted input until
the shared normalizer, validator, rights record, and human review accept it.
Removing a provider must leave the offline baseline, Pack validator, and Godot
importer working.

## Build versus reuse

| Capability | Decision |
| --- | --- |
| confirmed world dialogue/checkpoints | build in core |
| layout constraints and four profile solvers | build in core |
| complete asset-role inventory | build in core |
| character identity binding | build in core |
| Pack/receipt schemas, reproducibility, review gates | build in core |
| Godot importer and World Runner contract | build in core |
| image and sprite generation | reuse through an adapter |
| character animation generation | reuse through an adapter |
| background removal and smart crop | reuse through an adapter |
| tileset authoring and engine export | reuse local exports through an adapter |
| PNG, ZIP, hashing and schema validation | reuse pinned libraries |
| hosted asset library, accounts, billing and editor UI | do not build |

## SpriteCook boundary

The current SpriteCook integration deliberately reuses:

- reference-asset IDs for consistent art and fewer uploads;
- explicit credit/request budgets before generation;
- local 17-piece top-down terrain exports;
- local 2:1 isometric atlas geometry.

The next capabilities should also be adapters, not new WorldForge products:

- character animation through SpriteCook's character or animation endpoints,
  after arbitrary imported-character identity is proven;
- background removal through its bounded cleanup endpoint when a reviewed task
  actually needs it;
- user-initiated Godot character/TileSet exports as untrusted authoring input.

WorldForge does not copy SpriteCook's account system, asset library, editor,
billing, agent session, animation UI, or Godot export UI. It also never loads a
third-party `.tres` as trusted runtime content. The adapter extracts only
bounded PNG/atlas/animation/terrain data and projects it into the neutral Pack
contract.

The provider remains opt-in. A real request still requires explicit upload and
budget authorization; dry-run and offline operation remain the default.

## Rules enforced in CI

`pnpm architecture:verify` parses all production TypeScript imports and fails
when:

- new `core` code imports a provider, adapter, app, feature, or integration;
- provider-specific names enter production `core`;
- an adapter starts depending on app or UI code;
- a built-in provider uses anything except `core` and the shared canvas
  primitives;
- UI/application dependency direction is reversed.

Nine exact compatibility or UI-composition edges are frozen. The three
core-to-provider edges preserve already-published Alpha behavior; the others
are narrow legacy facades or the current React composition root. They cannot
be copied or expanded casually. Removing a published edge requires an explicit
versioned migration.

## Admission test for a new dependency

Add a dependency or integration only when all answers are yes:

1. Is the capability outside the six WorldForge-owned responsibilities?
2. Is the implementation mature enough and licensed for this use?
3. Can it enter through an existing port or one small adapter?
4. Does removing it leave offline generation, validation, and runtime loading
   intact?
5. Can credentials, private references, billing, and raw errors stay outside
   public Packs and repository state?

If one implementation has no current replacement, keep a simple function.
Do not introduce a framework or plugin system speculatively.
