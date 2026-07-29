# AI-assisted production art pre-review v1

Status: `revise`

Reviewer id: `codex-visual-review-01`

This is a visual pre-review of the generated atlases and real Godot 4.3
captures. It is not a human approval record and does not satisfy the
`human-pass`, public-license, or Raspberry Pi 4B gates. All four profiles
remain `UNRELEASED`.

## Evidence binding

| Profile | Godot render SHA-256 | Cross-version result |
| --- | --- | --- |
| Side platformer | `17035a97e0c6a2f14bbc8ea8b3e8890de04fd24a0ee025149b26c2133ff5df31` | Godot 4.3 and 4.7 byte-identical |
| Top-down farm | `7a697e0e3d110c505cd76f84f7d21282c066c5f0155a96deb2eee0172440ba41` | Godot 4.3 and 4.7 byte-identical |
| Isometric action | `982e0249e2f039b33fcc45a5564e0ea654e299bc6d073e427f44f8f486280c8e` | Godot 4.3 and 4.7 byte-identical |
| Layered-depth 2D | `546eae7995a3c589e8c02c672edc1149edc21a782937d7fb164d3ff565811121` | Godot 4.3 and 4.7 byte-identical |

## Cross-profile identity

Decision: `pass-with-revisions`

The player remains recognizable through black tousled hair, a gold scarf,
burgundy outerwear, brown satchel, dark trousers, and warm boots. The body
proportions change appropriately between side, top-down, isometric, and
layered-depth cameras without losing the identity signature.

Before release, review every animation at 4x nearest-neighbour zoom. Several
clips use short two-frame cycles or closely related poses; a still atlas cannot
prove that foot contact, silhouette timing, and attack anticipation feel
natural in motion.

## Side platformer

Decision: `revise-minor`

Strengths:

- cohesive blue-hour palette and strong foreground/midground/background depth;
- terrain, architecture, props, and character share a convincing pixel style;
- warm windows and lamps guide the eye through the route;
- the player identity remains readable at runtime scale.

Required revisions:

- reduce foreground silhouettes where they cover the left spawn and right exit
  edges;
- increase the gameplay contrast of hazards, checkpoint, objective, and exit;
- inspect slope feet and landing frames in motion rather than relying on the
  final still;
- confirm that floating crate/heart markers are intentional game roles and not
  temporary QA markers.

## Top-down farm

Decision: `revise-major`

Strengths:

- readable bridge, water, crop plot, paths, trees, buildings, and market roles;
- the warm rural palette is coherent and the four-direction character identity
  is recognizable;
- the bridge route is visually open.

Required revisions:

- break up the repeated square grass pattern and hard grid rhythm;
- add intentional terrain transitions around water banks, paths, fields, and
  building foundations;
- expand the environment composition beyond a sparse validation layout before
  presenting it as a generated world;
- review directional walk cycles in motion and remove poses that read as combat
  gestures if the selected world brief is non-combat farming.

Applied after the initial pre-review:

- reduced the runtime and preview character scale from `0.75` to `0.58`;
- regenerated the preview and both Godot renders;
- confirmed the revised Godot 4.3 and 4.7 renders are byte-identical.

## Isometric action

Decision: `revise-minor`

Strengths:

- coherent projection, palette, light direction, tile scale, and combat effects;
- player, melee enemy, ranged enemy, hazard, portal, and props remain distinct;
- attack and dash silhouettes are readable;
- the character atlas preserves the shared identity while adapting to the
  action profile.

Required revisions:

- make the intended exit unambiguous when multiple portal-like objects are
  visible;
- reduce empty floor repetition and add authored landmarks without obscuring
  combat readability;
- review effect timing in motion so attack, impact, dash, hazard, and exit cues
  cannot be confused;
- verify grounding and shadow consistency for all characters and tall props;
- do not market the current compact combat arena as a complete generated world.

## Layered-depth 2D

Decision: `revise-minor`

Strengths:

- the eight planes create strong atmospheric depth without obvious seams;
- architecture, props, characters, water, fog, and lighting are stylistically
  coherent;
- the warm/cool lighting contrast gives the scene a distinctive identity;
- player and NPC identity remain recognizable in the atlas.

Required revisions:

- reduce foreground reed and silhouette coverage over the lower route;
- prevent local lights from blooming over collision edges and interaction
  landmarks;
- make stairs, bridge traversal, collectible, and exit readable without QA
  knowledge;
- test multiple depth-lane positions, not only the final capture, to ensure
  characters remain visible behind near and foreground planes.

Applied after the initial pre-review:

- moved the ambient multiply pass behind actors so player and NPC silhouettes
  retain gameplay contrast;
- reduced near/foreground overlay brightness and local-light intensity;
- regenerated both Godot renders and confirmed Godot 4.3/4.7 byte identity.

## Release recommendation

`blocked`

The assets are valid internal runtime candidates and visibly exceed placeholder
quality. They are not yet approved public production assets. Complete the listed
revisions, inspect every animation in live Godot, record a human review bound to
the exact revised hashes, establish public redistribution rights, and run the
production bundle on a physical Raspberry Pi 4B before changing distribution
from `internal-review`.
