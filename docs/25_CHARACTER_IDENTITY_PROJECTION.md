# Character identity projection

Status: decoded-pixel signature and four-profile palette, silhouette, anchor, atlas and preview projection implemented

One user-created character must remain recognizably the same character when projected into different world grammars. Environment reference, world description, seed, and profile are not character identity inputs.

## Current contract

Mapsoo decodes the character reference to RGBA pixels and extracts a local-only `CharacterIdentitySignature`:

- a foreground-cropped 16×16 silhouette mask;
- four quantized palette roles;
- head, center, foot, left, and right visual anchors;
- a SHA-256 binding the normalized signature.

The signature is computed from decoded pixels, not the filename, environment image, description, seed, or target profile. PNG has a deterministic decoder fallback for non-browser tests; the browser's native image decoder supports accepted PNG and JPEG uploads.

Each profile receives a `CharacterIdentityProjection` with profile-specific frame size, pivot, and projected anchors while preserving the same source identity SHA-256:

| Profile | Frame | Pivot |
| --- | ---: | ---: |
| Top-down farm | 32×32 | 16,29 |
| Side-view platformer | 32×64 | 16,60 |
| Isometric action | 48×64 | 24,58 |
| Layered-depth 2D | 48×72 | 24,67 |

The implemented farm, side-platformer, isometric-action, and layered-depth providers now consume the same decoded palette, normalized silhouette, extreme anchors and profile geometry. The silhouette is rasterized into every player animation frame with profile-specific pose offsets while keeping the declared foot pivot stable. The generated world preview uses the same projected character frame instead of an unrelated placeholder.

Their player character atlases depend on the character reference only; changing the world brief, seed, or environment does not restyle the character atlas. Automated tests:

- project one signature into all four profile geometries and require normalized silhouette IoU above the acceptance threshold;
- require the lowest visible pixel to match the declared foot pivot;
- prove that a distinctive accessory silhouette changes atlas and preview pixels;
- open all four complete generated ZIPs and prove that each carries the same local identity signature into its projected player atlas;
- prove that changing only the character leaves the generated world terrain byte-identical.

The legacy no-signature provider path is retained only to reproduce already-published Alpha9 bytes. New browser jobs always decode and bind a character identity before provider execution.

## Privacy

The signature is local-only and is not written into Pack 0.6, Pack 0.7, or Pack 0.8. Public packs bind their exact character atlas bytes through the manifest and ZIP digest. A future public cross-pack character identifier requires a separate explicit user permission because it enables correlation across worlds.

## Remaining visual work

This is a geometric identity baseline, not a semantic likeness model. Before claiming full likeness preservation, the extractor must distinguish visible hair, face, headwear, clothing regions, carried items and body-proportion cues rather than representing all of them only through one silhouette, four colors and extreme anchors. All four providers now consume the contract in complete asset packs and playable Godot scenes; semantic likeness remains future work.
