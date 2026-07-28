# Private production handoff

Status: **implemented, deterministic, local-only, zero remote requests**

## Purpose

The guided browser flow already confirms a world through four checkpoints,
accepts one environment image and one arbitrary user-owned character image,
and produces a complete procedural Godot pack for immediate layout and
playability review.

The paid production-art workflow already consumes the same confirmed intake,
references, layout, requirements, character identity, provider adapter and
review gates. Previously, an operator had to copy the intake JSON and both
reference files into a separate private directory by hand.

`PrivateProductionHandoff 1.0` closes only that gap. It does not add a second
generator, a provider-specific core, or a publishing client.

```text
confirmed browser dialogue
  + exact environment reference
  + exact character reference
  + approved procedural preview
  -> deterministic private handoff ZIP
  -> existing world-delivery workspace preparation
  -> existing resumable production-art workflow
```

## Browser behavior

After a confirmed-dialogue generation and preview approval, the browser offers
two independent downloads:

1. the frozen procedural Godot pack, which is safe to use as a playable
   layout/prototyping baseline;
2. the private production handoff, which contains both original references
   and must stay local.

Standalone generation without the confirmed four-stage dialogue does not
produce a private handoff. Changing the profile, facts, references, seed or
approved preview invalidates the previous handoff.

## Archive contract

The ZIP has one canonical root and exactly five files:

```text
<intake-id>-private-production-handoff/
  handoff.json
  confirmed-intake.json
  README.md
  references/environment.png|jpg
  references/character.png|jpg
```

`handoff.json` conforms to
`schemas/mapsoo-private-production-handoff-1.0.schema.json` and binds:

- the exact confirmed-intake fingerprint and bytes;
- profile and runtime target;
- both canonical reference IDs, roles, paths, media types, byte counts and
  SHA-256 values;
- an explicit declaration that original references are present and public
  distribution is forbidden;
- `remote_request_count: 0`.

Every ZIP entry uses a fixed timestamp, permissions and deterministic order.
The same confirmed intake and image bytes therefore produce identical archive
bytes.

The reader rejects CRC failures, non-canonical roots, path traversal, directory
entries, extra files, duplicate roles, malformed JSON, changed intake bytes,
changed reference bytes, descriptor drift and any attempt to declare the
archive public.

## CLI fast path

Prepare the existing private workspace directly:

```bash
pnpm world-delivery:workspace -- prepare \
  --handoff <private-production-handoff.zip> \
  --workspace <private-workspace-outside-the-repository> \
  --character-id <neutral-kebab-case-id> \
  --completed-at <canonical-UTC-ISO> \
  --provider spritecook \
  --resolution 2K
```

This command:

- reads and verifies the archive in memory;
- feeds its exact intake and reference bytes into the existing workspace
  preparation function;
- creates the deterministic layout, complete asset requirements, provider job
  and playable procedural baseline;
- makes zero remote requests.

The previous `--intake` plus `--reference-root` form remains supported. The two
forms are mutually exclusive so there is one unambiguous reference source.

Real generation is still separate and requires `--execute`,
`--allow-remote-upload`, an explicitly chosen provider, runtime credentials and
the existing request-budget/state guards.

## Privacy boundary

The archive is generated only in the user's browser and is not a repository
fixture or public release artifact. It may contain private world descriptions
and the user's original images.

Never:

- commit it;
- publish it on itch.io;
- attach it to a public issue or pull request;
- send it to a remote provider without the user's explicit upload approval.

The public repository contains only the generic format, reader, builder,
schema, tests and documentation. It contains no private product name, path,
record, prompt, character identity cue sheet or source image.
