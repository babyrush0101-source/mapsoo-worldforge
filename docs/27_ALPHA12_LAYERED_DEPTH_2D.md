# Alpha12 layered-depth 2D

Alpha12 adds a fourth complete local world pipeline without changing the published Alpha9 farm bytes or the Alpha10/Alpha11 candidate contracts.

## Version boundary

- generated asset bundle: `0.4.0`;
- Pack Schema: `0.9.0`;
- runtime sidecars: `0.4.0`;
- public receipt: `0.4.0`;
- pack/generator/importer candidate: `0.1.0-alpha.12`;
- completeness policy: `layered-depth-2d-complete-v1`.

This is an original shallow-depth 2D stage grammar. It uses no commercial game assets, names, maps, or extracted style data.

## Complete asset contract

The pack binds exactly 36 roles:

- sky, far, mid, depth-fog, near and foreground planes;
- ambient and local lighting;
- six terrain roles, six prop roles and four structures;
- two collectibles and four effects;
- one player atlas and one NPC atlas;
- scene, collision, navigation and preview.

The player has `idle`, `walk`, `run`, and `interact` in `left`, `right`, `near`, and `far` directions. The NPC has `idle` and `talk` in the same directions. Both use 48×72 frames and pivot `[24,67]`, for 24 explicit clips total.

The player atlas is projected from the local `CharacterIdentitySignature`. Environment reference, description and seed may change world art and the NPC, but they cannot change the player identity atlas.

## Runtime grammar

The generated map is a 1280×720 shallow-depth corridor with a fixed gameplay baseline. Seven 320×180 planes declare their own scroll ratio, blend mode, z-index and repeat behavior:

`sky → far → mid/depth fog → gameplay → near → lighting → foreground`.

Scene placements use foot-point coordinates. Collision, navigation and scene sidecars share exact bounds and spawn. Navigation proves a walk-only route from spawn through the checkpoint to the exit. No pack-supplied script, shader, URL or target scene is permitted.

The independent trusted Godot Pack 0.9 importer builds the depth planes, a common Y-sorted gameplay domain, player and NPC, collision, hazards, traversal markers, a bounded camera and a profile-specific controller. Pack 0.6, 0.7 and 0.8 dispatch and controller semantics remain separate.

## Dialogue-to-world route

The existing four confirmed checkpoints remain authoritative:

1. world brief;
2. art direction;
3. map layout;
4. style sample.

After confirmation, the exact request and checkpoint hashes are bound to generation. The browser exports a deterministic Pack 0.9 ZIP, freezes the asset revision, and records the exact expected Godot scene path. Raw dialogue answers, source images, source paths, original image digests and the local identity signature are excluded from the public pack.

## Current status

Alpha12 is a local candidate, not a published release. TypeScript contract/provider/exporter tests, the four-profile browser export gate, and Godot 4.3/4.7 importer/playable smoke tests pass locally. Raspberry Pi 4B ARM64 packaging remains the next independent delivery gate.
