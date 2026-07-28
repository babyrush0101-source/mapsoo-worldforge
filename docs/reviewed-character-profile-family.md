# Reviewed character profile family

This workflow promotes four real-model player candidates into one portable,
source-free character family only after technical world review and a human art
decision pass for every profile.

It is the production successor to the procedural character-family fixture. The
procedural fixture remains useful for deterministic CI, but it does not claim
production art or human approval.

## Profiles

One family contains exactly these ordered profiles:

1. `side-platformer`
2. `isometric-action`
3. `topdown-farm`
4. `layered-depth-2d`

The character id, opaque identity digest, opaque source-reference ids and final
rights decision must be identical across all four. Camera grammar, atlas
geometry, pivot, directions and animation inventory may adapt to the profile.

## Upstream production path

For a player task, `production-art:model` now projects both the legacy plan and
the requirements-driven Plan 1.1 path into:

- `character-profile-atlas.png`
- `character-profile-revision.json`
- `character-profile-projection.json`

Plan 1.1 projection verifies the canonical requirements and plan fingerprints,
normalized PNG bytes, slot evidence, character task, human-confirmed identity
semantics and reference binding. A rejected projection emits a rejection record
and cannot enter the reviewed-family assembler.

## Required private review inputs

Create one directory per profile under a private input root. Each directory
contains:

- `character-profile-revision.json`
- `character-profile-projection.json`
- `world-art-runtime-overlay.zip`
- `approved-world-review.json`
- `human-art-review-receipt.json`

No separate atlas input is accepted. The assembler extracts the exact player
PNG from the CRC-checked runtime overlay, then verifies it against the overlay
manifest, runtime projection, projection record and character revision. This
prevents an unreviewed image from being substituted at packaging time.

## Assembly

```text
pnpm character-family:reviewed:assemble -- \
  --family-id anonymous-traveler-reviewed \
  --input-root <private-reviewed-root> \
  --output-dir <new-output-directory>
```

The output directory must not already exist.

The assembler verifies:

- exactly one player asset and one player runtime binding per profile;
- exact task, slot, path, region, cell digest and pose equality;
- atlas bytes, SHA-256, dimensions, frame geometry and pivot;
- every action, direction, frame, duration, FPS and loop decision;
- production plan/task and portable revision fingerprints;
- runtime projection and overlay fingerprints;
- world preview and Godot capture evidence;
- human receipt, reviewer, decision, identity and authorization;
- a permitted rights transition only;
- one identity and rights decision across all four profiles.

The exported family contains ten files: one manifest, one readme, four promoted
revisions and four reviewed atlases. Original references, source paths, raw
prompts, provider credentials, runtime overlays, captures and human review
records are deliberately excluded. Their one-way hashes remain in the manifest.

## Gate meaning

`reviewed-release-candidate` means exact model output, technical review and
human art review have passed. It does not claim the combined family has passed
Godot runtime acceptance or physical Raspberry Pi acceptance. Those two gates
remain `pending` until their separate evidence is produced.
