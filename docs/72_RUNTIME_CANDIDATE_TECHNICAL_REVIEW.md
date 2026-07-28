# Runtime candidate technical review

Status: **implemented local candidate validation, Godot capture receipt, and
technical-review assembly; holistic human composition review and physical
Raspberry Pi 4B acceptance remain pending**.

This boundary checks that one reviewed World Art Runtime Candidate is applied
to the exact confirmed layout and is visibly usable in local Godot. It consumes
the source-free candidate described in
[`71_REVIEWED_WORLD_ART_RUNTIME_CANDIDATE.md`](71_REVIEWED_WORLD_ART_RUNTIME_CANDIDATE.md).
It makes zero remote requests.

## Two different human decisions

The runtime-candidate receipt contains `human_art: pass` only after a human has
approved every generated atlas slot. That is a narrow, hash-bound decision
about the individual cells: their identity, crop, seams, alpha, animation
frames, and consistency with the approved scene direction.

An all-slot pass is **not** a human pass for the complete rendered world. It
does not approve the final composition, scale relationships, visual hierarchy,
readability during movement, art-to-collision alignment, or the combined
terrain, landmark, hazard, and player presentation. The existing
`ProductionWorldReview` therefore keeps its holistic `human-review` gate
`pending` after this technical step. Final human promotion remains the separate
[human art release gate](61_HUMAN_ART_RELEASE_GATE.md).

## What is runtime-visible

`WorldArtRuntimeProjection.assets` is a complete reviewed catalog.
`WorldArtRuntimeProjection.bindings` is the smaller set selected for this
specific world. The local technical acceptance may claim visibility only for:

- terrain materials selected by `terrain-material` bindings;
- landmarks selected by `landmark` bindings;
- the trusted hazard instances and their selected hazard bindings;
- the selected `character.player.atlas` binding.

An asset that exists only in the projection catalog is `catalog-only`. It is
reviewed and packaged, but it is not a visible replacement in the current
runtime scene. Background, prop, structure, effect, or unselected variant
catalog entries must not be counted as visible merely because their PNG bytes
are present in the overlay.

The expected visible counts come from the projection bindings and hazard
instances, not from the total catalog size. A mismatch fails technical
acceptance.

## Source-bound local capture

The candidate workspace loader first requires the exact receipt and six
declared artifacts. It rejects missing or extra files, path aliases, symbolic
links, size violations, invalid UTF-8 JSON, stale identities, changed bytes,
and mismatched review, inventory, selection, variant-map, projection, or
overlay bindings.

The Godot capture receipt then binds:

- the candidate ID and candidate-receipt SHA-256;
- the exact layout-plan SHA-256;
- the runtime overlay ID and archive SHA-256;
- the runtime projection ID and SHA-256;
- Godot `4.3` or `4.7` and the executable SHA-256;
- the exact byte lengths and SHA-256 values of all capture evidence.

The required evidence is:

```text
review-evidence/
  world-preview.png
  rendered-world-capture.png
  role-placement-overlay.png
  art-collision-overlay.png
  spawn-exit-traversal.avi
  navigation-traversal.avi
  godot-runtime-capture-receipt.json
review/
  production-world-review.json
```

The rendered capture proves the selected replacements are present. The role
overlay exposes their semantic bindings. The collision overlay shows the
relationship between visible art and logical collision. The two traversal
recordings prove the declared route is reached with and without authored
navigation visualization. The capture metrics must match the exact selected
terrain, landmark, hazard, and player inventory before the receipt is built.

The technical-review assembler reuses the existing
`ProductionWorldReview 1.0` evidence contract rather than defining a parallel
release review. It adds the canonical Godot runtime capture receipt as bound
technical evidence.

## Run the local technical review

Use a Godot 4.3 or 4.7 console executable. The output must be a private
directory separate from the candidate input:

```bash
pnpm production-art:runtime-candidate:technical-review -- \
  --candidate <private-workspace>/runtime-candidate \
  --layout <private-workspace>/world-layout-plan.json \
  --godot-console <local-godot-console> \
  --godot-version 4.3 \
  --review-id <lowercase-kebab-case-review-id> \
  --out <private-workspace>/runtime-technical-review
```

For a candidate whose distribution is not `public`, also pass its exact
canonical local authorization using
`--overlay-grant <private-workspace>/overlay-grant.json`.

The command validates all inputs before capture, launches Godot without a
shell, records the five fixed evidence modes, verifies the unique success
sentinel and output SHA-256 for every run, and promotes the output
transactionally. Re-running with identical evidence is idempotent; a different
existing output is never overwritten.

## Claim boundary

A passing capture receipt states exactly:

```json
{
  "runtime": "technical-pass",
  "raspberry_pi": "pending",
  "production_ready": false,
  "remote_request_count": 0
}
```

`runtime: technical-pass` means only that the exact reviewed candidate passed
the local Godot application, capture, binding-count, collision, and traversal
checks represented by the receipt. It is not physical Raspberry Pi evidence,
does not make the candidate production-ready, does not complete holistic human
composition review, and does not authorize publishing.

The remaining sequence is:

1. inspect the complete Godot composition and complete the holistic human
   review;
2. build the intended World Runner delivery only after its separate gates pass;
3. run and record the physical Raspberry Pi 4B acceptance.
