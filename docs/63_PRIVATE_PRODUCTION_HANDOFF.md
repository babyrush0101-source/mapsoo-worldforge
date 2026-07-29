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

`PrivateProductionHandoff 1.1` also closes a more important fidelity gap:
the browser now freezes the exact structured layout choices and the complete
production task inventory instead of asking the CLI to infer layout choices
again from prose. It does not add a second generator, a provider-specific
core, or a publishing client. The 1.0 reader remains supported for existing
five-file archives.

```text
confirmed browser dialogue
  + exact environment reference
  + exact character reference
  + approved procedural preview
  + exact confirmed layout constraints and plan
  + complete AssetRequirements 1.1 and ProductionArtPlan 1.1
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

## Archive contract 1.1

The current browser ZIP has one canonical root and exactly nine files:

```text
<intake-id>-private-production-handoff/
  handoff.json
  confirmed-intake.json
  README.md
  world-layout-constraints.json
  world-layout-plan.json
  complete-art/asset-requirements-1.1.json
  complete-art/production-art-plan-1.1.json
  references/environment.png|jpg
  references/character.png|jpg
```

`handoff.json` conforms to
`schemas/mapsoo-private-production-handoff-1.1.schema.json` and binds:

- the exact confirmed-intake fingerprint and bytes;
- profile and runtime target;
- both canonical reference IDs, roles, paths, media types, byte counts and
  SHA-256 values;
- the exact structured layout constraints and solved map;
- every complete world-art requirement, atlas slot and production task;
- the exact requirement count, maximum reviewed image-request count, and
  `scene-direction-then-complete-world` approval policy;
- an explicit declaration that original references are present and public
  distribution is forbidden;
- `remote_request_count: 0`.

Every ZIP entry uses a fixed timestamp, permissions and deterministic order.
The same confirmed intake and image bytes therefore produce identical archive
bytes.

The reader rejects CRC failures, non-canonical roots, path traversal, directory
entries, extra files, duplicate roles, malformed JSON, changed intake bytes,
changed reference bytes, descriptor drift, layout/intake drift,
requirements/plan drift, non-canonical planning bytes, count mismatches and
any attempt to declare the archive public.

Legacy 1.0 archives keep their original five-file meaning. Because they do not
contain structured planning, workspace preparation uses the documented
compatibility derivation from confirmed prose. New browser handoffs always use
1.1.

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
- revalidates and preserves the exact confirmed layout, complete
  `AssetRequirements 1.1` and `ProductionArtPlan 1.1` bytes from a 1.1
  handoff;
- creates the compatibility provider job and playable procedural baseline
  from that same layout;
- makes zero remote requests.

The complete blueprint is written beside, not over, the existing compatibility
workflow:

```text
complete-art/
  asset-requirements-1.1.json
  production-art-plan-1.1.json
  production-art-workflow-job-1.1.json
```

`workspace-manifest.json.complete_art_plan` binds the two canonical input
files, their SHA-256 values, requirement count, task count, the 1.1 job path, and the
`explicit-authorization-required` execution policy. This proves that every
confirmed visual variant has an exact task and atlas slot before any provider
is contacted. The 1.0 compatibility job and complete 1.1 job use the same
resumable runner. Inspecting the 1.1 job without execution initializes an
`awaiting-direction-approval` state and makes zero remote requests:

```bash
pnpm production-art:workflow -- \
  --job <private-workspace>/complete-art/production-art-workflow-job-1.1.json
```

This remains a blueprint and resumable schedule, not a claim of paid
generation or finished art.

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
