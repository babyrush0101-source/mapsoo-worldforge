# Complete-world production-art execution session

This session wrapper turns one complete `ProductionArtPlan 1.1` into an
auditable sequence of paid image tasks without weakening the existing
single-task workflow journal.

It intentionally uses two human decisions:

1. Generate exactly one scene-direction image.
2. Review that frozen image, bind its exact SHA-256 in the private workflow
   job, then authorize all remaining world-art tasks as one session.

The second session is the closest safe meaning of “generate the complete
world in one run.” A model must not choose its own art direction and silently
continue into every atlas.

## Preview first

```bash
pnpm production-art:world-session -- \
  --job C:/private/world/complete-art/production-art-workflow-job-1.1.json
```

The default is a zero-request dry-run. Its preview binds:

- workflow, plan, profile, input-binding digest, and state revision;
- the exact ordered task IDs;
- the exact maximum number of remote requests;
- the approved scene-direction digest when downstream work is eligible;
- `retry_policy: never`.

Copy the returned `preview.authorization_sha256` only after reviewing the
inventory and request count.

## Execute the exact preview

```bash
pnpm production-art:world-session -- \
  --job C:/private/world/complete-art/approved-workflow-job-1.1.json \
  --execute \
  --authorize-session-sha256 <exact-preview-sha256>
```

Before every paid task, the wrapper launches the existing workflow with:

- `--max-requests 1`;
- the exact current state revision;
- the exact next canonical task ID.

The workflow lock and journal reserve the request budget before the provider
starts. A concurrent or stale process therefore fails before another request
is launched.

## Stop and recovery rules

- A successful scene-direction request always stops at
  `awaiting-direction-approval`.
- Rejected, uncertain, interrupted, or divergent work stops immediately.
- The session never supplies the workflow retry flag.
- An uncertain task may be reconciled locally if a complete frozen artifact
  already exists. A paid retry remains a separate, explicit single-task
  decision with duplicate-cost acknowledgement.
- A session is executable only when its remaining workflow budget can cover
  every authorized task.

## Privacy and claim boundary

The preview and receipt contain neutral IDs, state counters, and digests.
They do not contain source paths, world prose, prompts, credentials, provider
request IDs, provider responses, or image bytes.

A complete execution receipt proves only that the declared production-art
tasks reached verified workflow artifacts. It still says:

- `human_art_review_required: true`;
- `production_art_only: true`;
- `runtime_ready: false`.

Human art review, reviewed runtime overlay construction, Godot capture,
World Runner packaging, and physical Raspberry Pi acceptance remain separate
gates.
