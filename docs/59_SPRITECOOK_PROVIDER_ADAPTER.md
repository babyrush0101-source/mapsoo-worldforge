# SpriteCook production adapter

Status: **implemented with private cross-task reference reuse and tested with
mocked HTTP; zero live requests made; internal-review only**

## Purpose

WorldForge does not need to rebuild a hosted image generator, asset account,
animation service, TileSet editor, or Godot export UI. SpriteCook already
provides those general capabilities. The project keeps its differentiating
work—confirmed world intent, layout, four-profile completeness, character
identity, review, reproducible Packs, and runtime delivery—and connects
SpriteCook through the existing `ProductionArtProvider` port.

Official references:

- [SpriteCook REST API](https://www.spritecook.ai/api-docs)
- [SpriteCook agent workflow](https://www.spritecook.ai/agents)
- [SpriteCook Godot export](https://www.spritecook.ai/works-with/godot)
- [official MIT plugin workflow skills](https://github.com/SpriteCook/claude-plugin)

## Implemented request boundary

One WorldForge production task uses two to four bounded HTTP requests:

```text
authorized environment reference ─┐
                                  ├─> private account-scoped id cache
authorized character reference ───┘                 │
                                      cache miss ───┴─> owned SpriteCook id
                                      |
shared ProductionArtPrompt + ids ─────┴─> generate-sync
                                               |
                                      allowlisted PNG download
                                               |
                               exact-grid nearest resize
                                               |
                         normal WorldForge normalize / validate
                                               |
                              untrusted internal-review candidate
```

The adapter:

- requires exact provider/task/reference authorization before the first upload;
- accepts no more than one environment and one character reference;
- uses the character asset as the primary reference and the environment asset
  as style guidance when both exist;
- sends the same human-confirmed character semantic contract used by the
  OpenAI adapter;
- requests one variation, disables smart crop, preserves the full task grid,
  and asks for the green-chroma policy required by deterministic alpha
  extraction;
- accepts downloads only from the documented SpriteCook API host or its
  current public asset bucket;
- bounds JSON and PNG response bytes and never exposes response bodies or the
  credential through errors;
- converts a same-aspect-ratio result to the exact approved task dimensions
  before the shared normalizer checks mapped cells, alpha, pivots, hashes, and
  output roles.

Imports create assets in the user's SpriteCook account. WorldForge does not
delete those external assets automatically. A real execution therefore needs
explicit reference-upload consent even when the user already owns the source
images.

## Private reference reuse

Jobs prepared through `world-delivery:workspace` use an absolute
`private_output_root` outside the repository. The workflow derives this cache
location without adding it to public state or Pack data:

```text
<private_output_root>/provider-cache/spritecook/v1/
```

The cache remains an adapter concern:

- it stores one opaque SpriteCook `asset_id` per entry;
- its filename and key are HMAC-SHA-256 bindings over the runtime credential,
  provider, reference role, media type, dimensions, byte count, and exact
  reference digest;
- it stores no credential, credential digest, local path, reference id,
  filename, prompt, URL, original reference digest, or private consumer data;
- renamed local references with the same exact bytes are reused, while a
  different SpriteCook credential cannot reuse the entry;
- a per-key exclusive lock covers the remote import and an fsynced temporary
  file is atomically promoted, preventing deliberate duplicate concurrent
  imports across workflows;
- a normal import failure releases only its owned lock. A process crash may
  leave an exact `.lock`; it is never deleted automatically. Inspect and
  remove only that lock after confirming no workflow is active;
- malformed, oversized, symlinked, tampered, or unsafe-ID entries fail closed;
- if SpriteCook no longer accepts a cached ID, the task fails without silently
  re-importing or spending an unapproved extra request.

With two cached references a task makes two HTTP requests (generate and
download). One miss makes three; two misses make four. Authorization remains a
hard maximum of four and the execution summary reports the actual count. The
resumable workflow continues to count one potentially billed generation
**task attempt**, not free import/download transport calls.

The standalone runner enables caching only through an explicit
`--spritecook-asset-cache-root` outside the repository. The complete private
workflow adds it automatically. Its child process receives only the selected
provider credential and a small system-variable allowlist instead of the
parent's full environment.

## Zero-request use

Inspect a task without a key, upload, or credit use:

```bash
pnpm production-art:model -- \
  --provider spritecook \
  --profile topdown-farm \
  --task scene-direction
```

Prepare a complete private workspace whose resumable workflow selects
SpriteCook:

```bash
pnpm world-delivery:workspace -- prepare \
  --intake <confirmed-intake.json> \
  --reference-root <private-reference-root> \
  --workspace <private-workspace-outside-the-repository> \
  --character-id <portable-character-id> \
  --character-identity-semantics <confirmed-character-semantics.json> \
  --completed-at <canonical-UTC-ISO> \
  --provider spritecook \
  --resolution 2K
```

Both commands make zero remote requests. Real execution additionally requires
`--execute --allow-remote-upload` and a runtime-only `SPRITECOOK_API_KEY`.
Never put the key in JSON, a command argument, chat, Pack, receipt, issue, or
committed environment file.

## Character animation compatibility decision

SpriteCook now documents `/v1/api/characters`, batched character animation
runs, and `animate-sync`. These are useful, but they are not silently selected:

1. `/characters` generates a new 64 × 64 base from text. WorldForge starts
   from an arbitrary user-owned character image plus human-confirmed identity
   semantics, so replacing it with a newly invented base would break the
   identity requirement.
2. `animate-sync` produces one motion from one owned asset. Mapping every
   WorldForge action/direction clip separately would multiply paid calls and
   still require deterministic atlas assembly and identity review.
3. The batched character endpoint becomes eligible only after mocked and then
   explicitly authorized live evidence proves that an imported arbitrary
   character can be its canonical base and that returned preset IDs cover the
   exact WorldForge pose inventory.

Until those conditions are proved, the provider-neutral full-sheet task
remains the honest default and does not claim model-native temporal animation.
Other useful next adapters are:

1. admit top-down/platformer terrain exports through the existing neutral
   terrain-mask importer;
2. keep isometric output atlas-only, as SpriteCook itself documents;
3. compare a real candidate set against the OpenAI path through the same human
   art, rights, Godot, and physical-device gates.

No live SpriteCook output, credit balance, account connection, human art pass,
or physical Raspberry Pi pass is claimed by this implementation.
