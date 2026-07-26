# Mapsoo schemas

These schemas are the portable contract between the browser workbench, future CLI tools, Godot importers, and external generators.

- `mapsoo-world.schema.json` validates the versioned input World Spec.
- `mapsoo-pack.schema.json` validates the immutable `0.1.0` portable asset-pack manifest used by the published alpha.1–alpha.3 packs.
- `mapsoo-pack-0.2.schema.json` defines the strict `0.2.0` terrain-aware pack manifest for alpha.4. It fixes the ordered layer contract to `ground`, `water`, `roads`, and `props`; fixes the two side-matching terrain sets, the `world-blocking` physics layer, the 35 terrain tiles, and the six prop sprites; and requires importer `0.1.0-alpha.4` or newer.
- `mapsoo-generation-receipt.schema.json` defines the strict `0.2.0` Provider Receipt planned for the next pack release. It records provider/model/workflow identity, the exact World Spec hash, ordered transformations, AI disclosure, licensing, and source declarations.

The JSON files are the source of truth. Godot `.tres` and `.tscn` resources are derived artifacts created by the importer. Schema major versions are compatibility boundaries; changing an existing field's meaning requires a migration or a new major version.

Alpha9, Alpha10, Alpha11, and the local Alpha12 candidate add separate contracts rather than widening an already published schema:

- `mapsoo-pack-0.6.schema.json` is the published Alpha9 `topdown-farm` Pack 0.6 contract.
- `mapsoo-world-asset-receipt-0.1.schema.json` is the published Alpha9, owned-reference-only public receipt.
- `mapsoo-pack-0.7.schema.json` is the Alpha10 candidate `side-platformer` Pack 0.7 contract with 30 canonical roles and 12 explicit left/right character clips.
- `mapsoo-side-platformer-scene-0.2.schema.json`, `mapsoo-side-platformer-collision-0.2.schema.json`, and `mapsoo-side-platformer-navigation-0.2.schema.json` define bounded pixel-coordinate scene placement, collision/hazard geometry, and a directed platform traversal graph.
- `mapsoo-world-asset-receipt-0.2.schema.json` is the Alpha10 candidate receipt. It remains owned-reference-only, binds the full request fingerprint, and omits reference bytes, paths, raw digests, attribution text, and the source description.
- `mapsoo-pack-0.8.schema.json` is the Alpha11 candidate `isometric-action` contract with 36 canonical roles, ten atlas bindings, three characters, and 128 explicit eight-direction clips.
- `mapsoo-isometric-action-scene-0.3.schema.json`, `mapsoo-isometric-action-collision-0.3.schema.json`, and `mapsoo-isometric-action-navigation-0.3.schema.json` define its diamond grid, elevation, placements, bounded collision, hazard, and reachable traversal data.
- `mapsoo-world-asset-receipt-0.3.schema.json` is the Alpha11 privacy-minimized receipt. It deliberately omits the local character identity signature as well as all original reference material.
- `mapsoo-pack-0.9.schema.json` is the Alpha12 candidate `layered-depth-2d` contract with 36 canonical roles, seven depth planes, two characters, and 24 explicit four-direction clips.
- `mapsoo-pack-1.0.schema.json` is an unpublished licensed-production draft. It keeps `internal-review`, `private`, and `public` distribution distinct; requires human-art, rights, runtime, and Raspberry Pi release gates to pass before public distribution; supports eight independent depth planes and explicit per-role/per-frame provenance; and forbids embedding source references or raw prompts. It does not alter Pack 0.9.
- `mapsoo-layered-depth-*-0.4.schema.json` define the shallow-depth scene, collision, and navigation sidecars.
- `mapsoo-world-asset-receipt-0.4.schema.json` is the Alpha12 privacy-minimized receipt and likewise excludes source images, raw dialogue and the local identity signature.
- `mapsoo-portable-world-runtime-1.0.schema.json` defines a synthetic-only consumer boundary for a portable world, spawn points, neutral entity slots, event hooks, and idempotent `prepare` / `bind` / `launch` / `exit` / `status` messages. It contains no private daemon, user, NPC-memory, or product fields.
- `mapsoo-character-profile-revision-1.0.schema.json` defines an independently versioned, provider-neutral character atlas revision plus an idempotent character bind message. It binds profile-specific action/direction clip completeness, safe PNG metadata, frame geometry, pivot, minimized source-identity summaries, explicit private/public rights, and a canonical projection into a compatible portable runtime character slot.
- `mapsoo-production-art-1.0.schema.json` defines the provider-neutral production-art plan and output receipt. It binds exact target/cell dimensions, alpha/seam/pivot policy, canonical asset roles, safe relative PNG paths, bytes, SHA-256, source-reference IDs, and explicit `private` / `internal-review` / `public` distribution plus output licensing. Collision, navigation, and scene JSON remain deterministic pipeline outputs rather than image-provider tasks.

Pack 0.9 does not alter Pack 0.8, Pack 0.7 or Pack 0.6. Alpha10, Alpha11 and Alpha12 are local candidates and are not published releases.

The published alpha.1–alpha.3 packs and their embedded `0.1.0` pack schema remain byte-for-byte frozen. Legacy `0.1.0` receipts are valid only for allowlisted procedural releases and must never authorize AI output. The `0.2.0` pack and receipt contracts enter a new alpha.4 release directory instead of silently changing an existing tag.

JSON Schema enforces the closed alpha.4 manifest shape, field bounds, ordered IDs, fixed atlas coordinates, terrain peering, and collision declarations. The semantic validator remains authoritative for relationships JSON Schema cannot express safely: referenced files must exist and match their declared bytes and hashes; layer dimensions and sprite/atlas coordinates must agree with the selected tile size and payload contents; every reference must resolve; and the receipt, World Spec, files, and manifest provenance must be the exact trusted projections of the same generation run.
