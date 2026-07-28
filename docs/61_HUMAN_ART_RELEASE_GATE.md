# Human art and delivery release gate

Status: **implemented contract and fail-closed promotion boundary; no real
candidate is approved by this repository**.

Automated checks can prove that generated files are complete, hash-bound,
sliceable and loadable in Godot. They cannot decide that a world looks good,
that an action reads correctly, that one character remains recognizable across
camera styles, or that the reviewer has authority to distribute the output.

WorldForge therefore uses two small, separate records:

1. `ProductionWorldReview 1.0` records rendered-world, placement, collision and
   traversal evidence. Its human gate remains pending after automation.
2. `HumanArtReviewReceipt 1.0` records one person's inspection of the exact
   preview, Godot capture, runtime projection, runtime overlay and one-way
   character-identity binding.

`promoteProductionWorldReview()` is the only bridge between them. It accepts a
canonical receipt only when all technical gates already pass, the human receipt
binds the exact artifacts, every criterion passes, and the requested delivery
rights are internally consistent. It then adds a hash-bound human evidence
record and changes the existing review from `blocked` to `approved`.

This does not create a second pack builder or generation pipeline.

## Canonical inspection criteria

Every receipt contains each criterion exactly once:

- coherent art direction, world scale and route readability;
- terrain transitions, role readability and clean sprite edges;
- character identity, scale, pivot, action and direction readability;
- animation loops, foot contact and visible collision alignment;
- no recognizable copying of a commercial character, map or composition;
- confirmed authority over source references and output permissions.

Each item is `pass`, `revise`, or `not-reviewed`. A `revise` item requires a
concrete note. Approval is impossible while any item is not `pass` or any
requested revision remains.

## Exact artifact binding

The receipt contains SHA-256 bindings for:

- the production-world review and world preview;
- the rendered Godot capture;
- `WorldArtRuntimeProjection`;
- `WorldArtRuntimeOverlay`;
- the private character identity's one-way binding.

It contains no raw character description, reference image, local source path,
account email or private product identifier. Changing any bound artifact makes
the old receipt unusable.

The canonical JSON shape is
[`schemas/mapsoo-human-art-review-receipt-1.0.schema.json`](../schemas/mapsoo-human-art-review-receipt-1.0.schema.json).
Semantic validation and promotion live in
[`src/core/human-art-review-receipt.ts`](../src/core/human-art-review-receipt.ts).

## Private and public decisions

The same visual inspection can authorize two intentionally different outputs:

| Decision | Distribution | Allowed output license | Redistribution |
| --- | --- | --- | --- |
| `blocked` | `internal-review` | `LicenseRef-UNRELEASED` | no |
| `approved-private` | `private` | `LicenseRef-Proprietary` | no |
| `approved-public` | `public` | `CC0-1.0`, `CC-BY-4.0`, or `CC-BY-SA-4.0` | yes |

Attribution is mandatory for the two attribution licenses. A private approval
cannot be relabelled as public, and an unreleased candidate cannot be marked
redistributable.

## Operator procedure

1. Generate the internal-review candidate through an explicitly authorized
   provider or the offline baseline.
2. Import the exact runtime overlay in Godot and capture the review evidence.
3. Call `createHumanArtReviewTemplate()` with opaque reviewer and review IDs
   plus the six artifact bindings.
4. Inspect the atlases at 1x and nearest-neighbour 4x, every character action,
   the final world, collisions and traversal.
5. Record every criterion. Keep the decision blocked when revisions are
   required.
6. Encode the accepted record with `encodeHumanArtReviewReceipt()`.
7. Call `promoteProductionWorldReview()` with those exact canonical bytes.
8. Only the returned authorization may be used by a later private delivery or
   public release assembler.

An AI pre-review may suggest revisions, but it cannot set
`review_method: human-visual-inspection`, sign the attestation or promote the
world.

The returned authorization is now consumed by the deterministic
[`Approved world-art delivery kit`](62_APPROVED_WORLD_ART_DELIVERY_KIT.md)
builder. That adapter preserves the exact RuntimeOverlay ZIP and fails closed
if the approval, evidence, license or overlay bytes have changed.
