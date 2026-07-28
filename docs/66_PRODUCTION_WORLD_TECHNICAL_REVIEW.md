# Production world technical review workspace

Status: **implemented local builder and four-profile Godot capture harness;
human art judgment remains an operator task**.

Human art approval must bind more than one attractive screenshot. Before a
candidate enters the human release gate, WorldForge requires exact evidence
for the final composition, semantic role placement, visible collision,
spawn-to-exit traversal and navigation traversal.

The `production-art:technical-review` command turns those six exact files into
one `ProductionWorldReview 1.0` workspace:

```console
pnpm production-art:technical-review -- \
  --review-id <kebab-case-id> \
  --profile side-platformer|topdown-farm|isometric-action|layered-depth-2d \
  --godot-versions 4.3,4.7 \
  --preview <world-preview.png> \
  --capture <rendered-godot-world.png> \
  --role-overlay <semantic-role-overlay.png> \
  --collision-overlay <art-collision-overlay.png> \
  --spawn-exit-video <spawn-to-exit.avi|mp4> \
  --navigation-video <navigation-route.avi|mp4> \
  --out <local-review-workspace>
```

## Output

The builder emits fixed consumer-neutral paths:

```text
review/
  production-world-review.json
review-evidence/
  world-preview.png
  rendered-world-capture.png
  role-placement-overlay.png
  art-collision-overlay.png
  spawn-exit-traversal.avi|mp4
  navigation-traversal.avi|mp4
```

Local source paths and filenames are not embedded. Every output record contains
the exact byte length and SHA-256. PNG dimensions are read from `IHDR`; MP4
inputs must begin with a bounded `ftyp` box, while AVI inputs require a bounded
`RIFF`/`AVI ` header. Supporting AVI lets maintainers use Godot 4.3/4.7's
built-in Movie Writer without installing a transcoder. All five technical gates are
`technical-pass`, while the human gate remains `pending` and the release
decision remains `blocked`.

Existing byte-identical output is accepted so the workspace is reproducible.
Different existing bytes are never overwritten.

## Capture the four reference profiles in Godot

On Windows, after `pnpm production-art:verify` has materialized the local
production candidates, one command captures and assembles all four technical
review workspaces:

```powershell
pnpm production-art:technical-review:godot
```

The harness invokes the real candidate scene five times per profile:

1. the unmodified rendered composition;
2. a semantic-role overlay, including the bound
   `character.player.atlas` identity;
3. an art/collision overlay;
4. a visible spawn-to-exit run recorded by Godot Movie Writer;
5. the same physical run with authored navigation nodes and edges visible.

It covers `side-platformer`, `topdown-farm`, `isometric-action`, and
`layered-depth-2d`. The default output is the ignored local directory
`.codex_tmp/production-world-reviews`. Use `-Profiles`, `-GodotVersion`,
`-GodotConsole`, or `-OutputRoot` when invoking the PowerShell file directly
to narrow or relocate a run.

Raw captures stay under `_capture/`; successful Godot stdout/stderr logs are
removed after their sentinel has been validated so local absolute paths never
enter a profile review workspace. Failed-run logs remain available for local
diagnosis and must not be treated as delivery artifacts.

Every AVI is checked for a bounded `RIFF`/`AVI ` header before it reaches the
TypeScript builder. The resulting contracts contain five technical passes,
but deliberately keep `human-review: pending` and
`release_decision: blocked`. The command makes no remote request and does not
publish the generated art or evidence.

## Boundary

This command does not decide whether the art is good, does not confirm source
authority, does not grant redistribution rights and does not publish. It makes
zero remote requests.

After capture, pass `review/production-world-review.json` and the exact
RuntimeOverlay ZIP to the
[human art release gate](61_HUMAN_ART_RELEASE_GATE.md). The human reviewer must
still inspect all assets and explicitly complete the receipt.
