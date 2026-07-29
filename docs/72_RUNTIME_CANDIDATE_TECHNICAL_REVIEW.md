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
`WorldArtRuntimeProjection.bindings` selects the terrain, landmarks, hazards,
and player used by this specific world. Overlay 1.1 adds the source-bound
`WorldVisualPlacementPlan` and `WorldArtPlacementMap`; together they select and
place reviewed:

- background layers and other depth planes;
- prop and structure instances;
- effect bindings;
- layout-derived actors.

An asset that exists only in the projection catalog is `catalog-only`. It is
reviewed and packaged, but it is not a visible replacement in the current
runtime scene. An unbound variant must not be counted as visible merely because
its PNG bytes are present in the overlay.

The expected runtime inventory is the exact union of projection bindings and
placement-map bindings. Each item has a canonical `usage_kind` and `usage_id`.
The capture harness derives and fingerprints that expected key inventory, then
requires every Godot evidence mode to report identical expected/applied counts
and binding SHA-256 values. In particular, `runtime_bindings` must equal
`applied_runtime_bindings`, and each capture sentinel's
`bindings_sha256` must equal `applied_bindings_sha256`.

Capture Receipt 1.1 records:

- catalog, bound-catalog, and catalog-only asset counts;
- `runtime_bindings` and `applied_runtime_bindings`;
- visible terrain, landmark, hazard, and character counts;
- applied background, prop, structure, effect, and depth-plane counts;
- the canonical `bindings_sha256`;
- `all_required_bindings_applied: true`.

The receipt can be built only when the complete expected binding set equals the
applied set. The raw build-time key arrays are not copied into the canonical
receipt; their exact derived counts and fingerprint are retained.

## Source-bound local capture

The candidate workspace loader first requires the exact receipt, six declared
artifacts, and the separately supplied canonical trusted `WorldLayoutPlan`. It
rejects missing or extra files, path aliases, symbolic links, size violations,
invalid UTF-8 JSON, stale identities, changed bytes, and mismatched review,
inventory, selection, variant-map, projection, overlay, placement-plan,
placement-map, or layout bindings.

Overlay 1.1 intentionally does not package the trusted layout. Its placement
documents contain stable references and one-way hashes, not private world
descriptions, landmark labels, or the seed. The versioned reader still accepts
existing Overlay 1.0 archives through the unchanged 1.0 path; the current
runtime-candidate technical-review path requires Overlay 1.1 plus its exact
trusted layout.

Godot Capture Receipt 1.1 then binds:

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
navigation visualization. The capture metrics must match the complete derived
runtime-binding inventory before the receipt is built.

The technical-review assembler reuses the existing
`ProductionWorldReview 1.0` evidence contract rather than defining a parallel
release review. It adds the canonical Godot Runtime Capture Receipt 1.1 as
bound technical evidence. Capture Receipt 1.0 remains readable for existing
local evidence and is not silently reinterpreted as 1.1 applied-binding proof.

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
