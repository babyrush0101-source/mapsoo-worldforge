# Four-profile character family CLI

Status: implemented deterministic baseline; human art review required.

`character-family:build` converts one approved character reference and one
environment-style reference into a source-free character family for all four
public 2D profiles:

- `side-platformer`;
- `isometric-action`;
- `topdown-farm`;
- `layered-depth-2d`.

This closes the portable boundary between “the user created one character” and
“the same character can enter worlds with different projections”. It does not
claim that the deterministic baseline has model-generated production art
quality.

## Build

Use a new output directory. Existing directories are refused instead of being
overwritten.

```powershell
pnpm character-family:build -- `
  --character .\private-inputs\traveler.png `
  --environment .\private-inputs\world-style.png `
  --character-id traveler-one `
  --family-id traveler-one-family `
  --description-file .\private-inputs\world-description.txt `
  --seed traveler-one-seed `
  --completed-at 2026-07-28T00:00:00.000Z `
  --out .\.local-output\traveler-one-family `
  --confirm-owned-references
```

`--confirm-owned-references` is mandatory. It declares that the operator owns
both references and may adapt them, redistribute generated output, and dedicate
that output under CC0-1.0.

The default distribution is `internal-review`. Public status requires a second,
separate confirmation:

```powershell
  --distribution public --confirm-public-release
```

The public option changes the declared review distribution. It does not replace
a human check of the source rights or generated art.

## Output

```text
character-profile-family.json
readme.md
profiles/
  side-platformer/
    character-profile-atlas.png
    character-profile-revision.json
  isometric-action/
    character-profile-atlas.png
    character-profile-revision.json
  topdown-farm/
    character-profile-atlas.png
    character-profile-revision.json
  layered-depth-2d/
    character-profile-atlas.png
    character-profile-revision.json
```

Every profile revision uses the existing
[`CharacterProfileRevision`](33_CHARACTER_PROFILE_REVISION.md) runtime contract.
A private world-creation service selects the revision matching the new world's
profile and binds it through the neutral runtime interface documented in
[`50_CHARACTER_PROFILE_RUNTIME_BINDING.md`](50_CHARACTER_PROFILE_RUNTIME_BINDING.md).

`character-profile-family.json` binds all four revisions to:

- one public-safe `character_id`;
- one minimized `character_identity_sha256`;
- one environment-style signature;
- domain-separated description and seed bindings;
- exact revision and PNG digests;
- one shared rights and review policy.

The family verifier rejects a missing profile, changed atlas, changed revision,
identity drift, rights/status drift, unsafe artifact path, or a claim that the
procedural baseline is production-ready.

## Privacy boundary

The output intentionally excludes:

- the two source images;
- source filenames and absolute paths;
- raw source-file SHA-256 values;
- the free-text world description;
- private service or product identifiers;
- temporary four-profile world packs used during projection.

Only minimized identity/style signatures and domain-separated text bindings
remain. These prove continuity without making the original input material part
of the portable family.

## Reproducibility and verification

The same image bytes, description, seed, IDs, completion time, and project
revision produce the same procedural family. Run:

```powershell
pnpm character-family:verify
```

The verifier executes the real CLI against synthetic, anonymous inputs and
checks:

- exactly four profile revisions and four PNG atlases;
- ten expected output files and no extras;
- internal-review is the safe default;
- source bytes, paths and free text are absent;
- existing output is never overwritten;
- public status is impossible without explicit confirmation.

The core contract also has schema, binding, tamper and negative privacy tests:

- `src/core/character-profile-family.ts`;
- `schemas/mapsoo-character-profile-family-1.0.schema.json`;
- `src/core/character-profile-family.test.ts`;
- `src/app/build-character-profile-family.test.ts`.

The exact exported revisions are also loaded by the real Godot runtime:

```powershell
pnpm character-family:godot
```

This regenerates an ignored anonymous fixture and binds all four atlases, 84
canonical clips, family revision digests and runtime metadata in both locally
available Godot 4.3 and 4.7 consoles. The Linux and Windows CI matrices perform
the same exported-family runtime check.

## What remains outside this baseline

The CLI proves the end-to-end contract and supplies playable procedural
characters. Production release still requires:

1. model-backed or artist-authored variants for each profile;
2. human identity, silhouette, animation and style review;
3. source-rights approval;
4. Godot scene review with the intended world art;
5. physical Raspberry Pi 4B performance acceptance for that exact reviewed
   revision.

Those gates are deliberately not converted into automatic “passed” claims.
