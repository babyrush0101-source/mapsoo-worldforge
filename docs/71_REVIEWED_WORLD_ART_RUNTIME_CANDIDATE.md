# Reviewed world-art runtime candidate

Status: **implemented source-free candidate assembly after per-slot human
review; local Godot technical review, holistic composition review, and physical
Raspberry Pi acceptance remain separate**.

This boundary turns a completed `ProductionArtRunSet 1.1` into a
source-free Godot runtime overlay, but only after a human approves every
generated atlas slot.

It is the next local step after the complete-world execution session. It
makes zero remote requests and supports all four profiles:

- `side-platformer`;
- `topdown-farm`;
- `isometric-action`;
- `layered-depth-2d`.

## 1. Create the review template

Use the canonical layout, requirements, plan, completed run-set, and private
model-runs directory:

```bash
pnpm production-art:runtime-candidate -- template \
  --layout <private-workspace>/world-layout-plan.json \
  --requirements <private-workspace>/asset-requirements-1.1.json \
  --plan <private-workspace>/production-art-plan-1.1.json \
  --run-set <private-workspace>/production-art-run-set.json \
  --model-runs-root <private-workspace>/model-runs \
  --out <private-workspace>/world-art-selection-review.json
```

The loader checks the fixed task-directory inventory, real-path containment,
JSON and PNG size limits, UTF-8, output/evidence hashes, dimensions, occupied
cells, and every per-slot pixel digest before it writes the template.

The template contains only neutral task/slot IDs, portable output paths,
digests, rights, declarations, and recommended terrain/hazard/character
selections. It excludes source references, private world prose, prompts,
provider metadata, credentials, and remote responses.

## 2. Review the actual PNGs

For every task and slot:

1. inspect the generated `normalized.png`;
2. confirm visual quality and consistency with the approved scene direction;
3. confirm the atlas cell has no crop, seam, alpha, animation, or identity
   defect;
4. set that slot's `decision` to `approved` only when it passes;
5. confirm all three top-level declarations;
6. set `review_status` to `pass`.

Do not change IDs, paths, digests, atlas cells, selections, or rights. A
change to any bound field invalidates the review.

## 3. Build the private Godot candidate

```bash
pnpm production-art:runtime-candidate -- build \
  --layout <private-workspace>/world-layout-plan.json \
  --requirements <private-workspace>/asset-requirements-1.1.json \
  --plan <private-workspace>/production-art-plan-1.1.json \
  --run-set <private-workspace>/production-art-run-set.json \
  --model-runs-root <private-workspace>/model-runs \
  --review <private-workspace>/world-art-selection-review.json \
  --out <private-workspace>/runtime-candidate
```

The output directory is transactional and idempotent. It contains:

- the canonical passing selection review;
- the reviewed slot inventory and selected variants;
- the deterministic variant map and runtime projection;
- a source-free `world-art-runtime-overlay-<digest>.zip`;
- a hash-bound runtime-candidate receipt.

Pending, rejected, partial, rights-drifted, path-escaped, aliased, or tampered
inputs produce no candidate.

`human_art: pass` at this boundary means every individual atlas slot passed
human inspection. It does not mean that the whole rendered composition passed
human review.

The runtime projection contains both a complete reviewed asset catalog and the
bindings selected for this world. Only bound terrain, landmarks, hazards, and
the player atlas are runtime-visible replacements at this stage. Assets that
exist only in the catalog are not counted as visibly applied.

## Claim boundary

The candidate receipt and overlay say:

- `human_art: pass`;
- `runtime: pending`;
- `raspberry_pi: pending`;
- `remote_request_count: 0`;
- `production_ready: false`.

The candidate is ready for the separate Godot loader/capture gate. It is not
a final release, World Runner PCK, or physical Raspberry Pi acceptance.
The local capture contract and its deliberately narrow technical claim are
documented in
[`72_RUNTIME_CANDIDATE_TECHNICAL_REVIEW.md`](72_RUNTIME_CANDIDATE_TECHNICAL_REVIEW.md).
