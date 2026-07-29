# Production world visual/collision review contract

`src/core/production-world-review-contract.ts` defines the release-facing review boundary between generated production images and a playable Godot world. It does not change the asset generators or their current review records.

Every review contains exactly six independent gates:

| Gate | Required technical evidence |
| --- | --- |
| `image-composition` | a rendered world capture |
| `role-placement` | a role-labelled placement overlay |
| `art-to-collision` | an art/collision overlay |
| `spawn-exit` | recorded spawn-to-exit traversal |
| `navigation` | recorded navigation traversal |
| `human-review` | a JSON human-review record with an opaque reviewer ID |

Each gate is `pending`, `technical-pass`, or `human-pass`. A `human-pass` on a technical gate requires both its gate-specific technical evidence and a human-review record. The final human-review gate cannot use `technical-pass`.

`headless-asset-controller-smoke` is an allowed evidence inventory item, but no passing gate may cite it. PNG decode, atlas slicing, a hard-coded collision floor, animation switching, or direct placement on an exit marker do not prove rendered composition, art/collision alignment, navigation, or visual quality.

Release approval is fail-closed: every gate must pass and `human-review` must be `human-pass`. Until then, `release_decision` is `blocked`.

The public JSON shape is defined in `schemas/mapsoo-production-world-review-1.0.schema.json`. Semantic validation additionally checks cross-references and gate-specific evidence qualifications that JSON Schema alone cannot safely express.
