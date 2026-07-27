# SpriteCook production adapter

Status: **implemented and tested with mocked HTTP; zero live requests made;
internal-review only**

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

One WorldForge production task uses at most four bounded HTTP requests:

```text
authorized environment reference ─┐
                                  ├─> owned SpriteCook asset ids
authorized character reference ───┘
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

## What remains separate

The first adapter deliberately uses the small generic `generate-sync` surface.
It does not yet claim that SpriteCook's dedicated character workflow has been
mapped into WorldForge's exact multi-action atlas contract, or that its
top-down/platformer TileSet export can bypass WorldForge review. Those are
useful next adapters:

1. cache imported `asset_id` values in the private workspace so later tasks do
   not upload the same references again;
2. map the dedicated base-character and animation run into exact profile pose
   cells, retaining the shared semantic identity gate;
3. admit top-down/platformer terrain exports through the existing neutral
   terrain-mask importer;
4. keep isometric output atlas-only, as SpriteCook itself documents;
5. compare a real candidate set against the OpenAI path through the same human
   art, rights, Godot, and physical-device gates.

No live SpriteCook output, credit balance, account connection, human art pass,
or physical Raspberry Pi pass is claimed by this implementation.
