# Production world technical review workspace

Status: **implemented local builder; real four-profile evidence capture remains
an operator task**.

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
  --spawn-exit-video <spawn-to-exit.mp4> \
  --navigation-video <navigation-route.mp4> \
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
  spawn-exit-traversal.mp4
  navigation-traversal.mp4
```

Local source paths and filenames are not embedded. Every output record contains
the exact byte length and SHA-256. PNG dimensions are read from `IHDR`; MP4
inputs must begin with a bounded `ftyp` box. All five technical gates are
`technical-pass`, while the human gate remains `pending` and the release
decision remains `blocked`.

Existing byte-identical output is accepted so the workspace is reproducible.
Different existing bytes are never overwritten.

## Boundary

This command does not decide whether the art is good, does not confirm source
authority, does not grant redistribution rights and does not publish. It makes
zero remote requests.

After capture, pass `review/production-world-review.json` and the exact
RuntimeOverlay ZIP to the
[human art release gate](61_HUMAN_ART_RELEASE_GATE.md). The human reviewer must
still inspect all assets and explicitly complete the receipt.
