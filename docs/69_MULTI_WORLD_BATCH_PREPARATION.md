# Multi-world batch preparation

`world-delivery:batch` prepares 1–32 independent world-delivery workspaces
from confirmed, consumer-neutral world intakes. It exists for products that
let a user create several worlds while keeping all product records,
references, briefs, and model outputs outside this public repository.

The command does **not** call an image model. Each workspace contains:

- the exact confirmed intake and bound reference images;
- a deterministic, Godot-import-ready procedural baseline;
- a confirmed layout plan and asset requirements;
- the complete 2D production-art task plan;
- a character identity/profile binding;
- local operator jobs for the separately authorized model workflow.

## Request

All paths are portable paths relative to the request JSON directory. Absolute
paths, `..`, duplicate workspace IDs, unknown fields, more than 32 worlds, and
non-canonical timestamps fail closed.

```json
{
  "schema_version": "1.0.0",
  "document_type": "world-delivery-batch-request",
  "batch_id": "four-world-profile-sample",
  "completed_at": "2026-07-29T12:00:00.000Z",
  "worlds": [
    {
      "workspace_id": "harbor-platformer",
      "intake_path": "intakes/harbor-platformer.json",
      "reference_root": "references/harbor-platformer",
      "character_id": "neutral-traveler"
    },
    {
      "workspace_id": "harbor-farm",
      "intake_path": "intakes/harbor-farm.json",
      "reference_root": "references/harbor-farm",
      "character_id": "neutral-traveler",
      "character_identity_semantics_path":
        "characters/neutral-traveler.json"
    }
  ]
}
```

The authoritative schemas are:

- `schemas/mapsoo-world-delivery-batch-request-1.0.schema.json`
- `schemas/mapsoo-world-delivery-batch-receipt-1.0.schema.json`

## Command

The output must be outside the public repository:

```bash
pnpm world-delivery:batch -- prepare \
  --request /private/staging/four-world-profile-sample.json \
  --batch-root /private/output/four-world-profile-sample
```

Optional provider, quality, resolution, model, and request-budget flags apply
to every workspace. They only configure the later operator job. Batch
preparation itself always reports `remote_request_count: 0`.

## Atomicity and idempotency

World workspaces are prepared under a sibling staging directory. Operator job
paths are bound to the intended final locations before their bytes are
hashed. Only after every world succeeds is the staged directory renamed to
the requested batch root.

If any intake, reference, rights binding, character binding, path, budget, or
workspace fails:

- no batch receipt is published;
- the staging directory is removed;
- an existing final batch is never overwritten.

Running the same request again accepts the existing batch only when its
request digest, workspace order, and every workspace-manifest digest still
match. Changed or incomplete output fails closed.

## Receipt boundary

`batch-receipt.json` records only:

- batch and request digests;
- profile counts;
- neutral workspace IDs and portable paths;
- confirmed intake digests;
- workspace-manifest digests;
- target/runtime profile;
- zero remote requests and the atomic-write claim.

It does not copy world descriptions, reference images, absolute paths,
character semantics, private product identifiers, reviewer identity, or
model output. The individual private workspaces intentionally contain the
inputs needed by their local operator jobs and therefore must never be
committed or published.

## What this does not prove

A successful batch receipt proves preparation of isolated baseline and
production-art workspaces. It does not prove:

- that model-backed assets were generated;
- that a human accepted the art or its rights;
- that reviewed assets were imported into Godot;
- that a PCK was built;
- that a physical target device ran the exact artifacts.

Those remain separate, hash-bound workflow, review, World Runner, and
physical-device gates.
