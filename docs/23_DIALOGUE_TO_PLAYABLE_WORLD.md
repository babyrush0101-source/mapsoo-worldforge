# Dialogue to a playable world

Status: core state machine and browser dialogue alpha implemented

The product is a guided world-building conversation, not a one-shot image prompt.

## User journey

1. **World brief** — describe the place, inhabitants, mood, target hardware, and choose or accept a recommended profile.
2. **Art direction** — confirm palette, materials, lighting, character scale, rendering treatment, and reference rights.
3. **Map layout** — confirm spawn, main route, landmarks, interactions or hazards, and exit.
4. **Style sample** — review an intent preview for world grammar, traversal, depth, landmarks, and character scale. It is not presented as final exported artwork.
5. **Complete assets** — expand only the approved sample into the profile's full role and animation contract.
6. **Godot map** — freeze the asset revision, import it, build a scene, and pass headless smoke checks.
7. **Enter the world** — launch the map with the selected character, then return to the conversation with playtest feedback.

Every confirmation creates a checkpoint. A revision never overwrites an approved asset pack or Godot map in place.

The browser now exposes the first four confirmation rounds as an interactive guided conversation. After the first three decisions, the fourth round renders a deterministic 320×180 profile intent preview. Its image SHA-256 is included in the style-sample checkpoint alongside the user's approval notes. This preview establishes world grammar, depth, traversal, landmark contrast, and character scale, but it is not described as production art or as the exact final scene. The user's decoded character identity and environment analysis are applied during complete generation.

The trusted core reducer in `src/core/world-creation-session.ts` owns the complete seven-stage transition model. Every command includes `expectedRevision`, so a stale model response, duplicated click, or late generation job cannot overwrite a newer decision.

The handoff to complete generation creates a privacy-minimized `ConfirmedGenerationBinding`:

```text
four ordered checkpoint snapshot hashes
  -> dialogue snapshot SHA-256
  + exact GenerationRequestV2 fingerprint
  -> confirmed generation binding SHA-256
```

No raw answer, reference path, source image digest, or private session identifier appears in this public binding. Pack 0.7 embeds it in `generation-receipt.json`. Published Pack 0.6 bytes remain immutable, so the current farm workflow returns the same binding as an external audit result until a future versioned pack can add it.

Complete generation now also creates a `WorldAssetRevision` that binds the exact ZIP digest, serialized manifest digest, request fingerprint, dialogue binding, profile, compatibility versions, and generated Godot scene path. The browser displays the exact `scene.previewAssetId` PNG emitted into the pack, not the earlier intent preview.

Before that image can be approved, `ExportedWorldReviewEvidence` verifies the preview bytes against their asset-record SHA-256 and binds:

```text
approved intent-preview SHA-256
  + four-round dialogue binding
  + exact generation-request fingerprint
  + scene / collision / navigation SHA-256
  + deterministic visual-asset-set SHA-256
  + exact exported preview SHA-256
  -> exported-world review binding SHA-256
```

This evidence does not claim that baseline procedural art is production-quality art. It proves which exact exported preview, runtime data, and visual asset revision the user is reviewing. Explicit approval then creates a `FrozenWorldLaunchBinding`; a changed pack, manifest, request, dialogue, profile, scene, or preview can no longer reuse that launch approval.

## Freeze rule

Godot map generation accepts an immutable asset revision identified by its pack and manifest SHA-256 values. A visual, profile, character, or asset-list change creates a new asset revision. A layout-only change may reuse the frozen assets and create only a new map revision.

This keeps a late conversational correction from silently changing a previously playable world.

## Current capability truth

| Profile | Dialogue + sample | Complete assets | Godot scene | Player controller | Product launch session |
| --- | --- | --- | --- | --- | --- |
| Top-down farm | Available | Available | Available | Four-direction physics smoke passes | Frozen launch binding; dialogue binding remains external to frozen Pack 0.6 |
| Side-view platformer | Available | Available | Available | Platform physics and rendered-pixel smoke pass | Frozen launch binding; dialogue binding embedded in Alpha10 receipt |
| Isometric action | Available | Available (Alpha11 candidate) | Available | Eight-direction movement/dash/hazard/exit smoke passes | Frozen launch binding; dialogue binding embedded in Pack 0.8 receipt |
| Layered-depth 2D | Available | Available (Alpha12 candidate) | Available | Four-direction shallow-depth movement/NPC/hazard/exit smoke passes | Frozen launch binding; dialogue binding embedded in Pack 0.9 receipt |

The Godot importers now instantiate generated characters, visuals, collision, spawn, bounded `Camera2D`, and trusted addon controllers for all four profiles. Headless Godot 4.3 and 4.7 tests prove farm movement/blocking, side movement/jump/one-way/hazard/exit behavior, isometric diagonal movement/dash/hazard/exit behavior, and layered-depth four-direction movement/NPC interaction/hazard/exit behavior. Each frozen launch binding carries the exact `res://mapsoo_imports/<id>/<id>.world.tscn` path; a private consumer may deploy and launch it only after independently verifying the referenced pack and revision hashes.

Pack 0.7 textures also pass a save/reload pixel-persistence contract. A real 1280x720 Godot capture must contain at least twelve quantized colors, robust luminance contrast, nontrivial edges, and colored upper/lower world regions; a blank viewport or a texture resource containing only dimensions now fails.

## Raspberry Pi 4B target

The shortest runtime path is data-driven:

```text
confirmed dialogue snapshot
  -> frozen Mapsoo pack
  -> import PNG + JSON
  -> create or update Godot resources
  -> load a reusable runtime shell
  -> enter the new scene without rebuilding the whole application
```

The Raspberry Pi should run one reusable Godot runtime shell. Newly created worlds are content packs, not new application builds. The shell loads a generated `.tscn` scene and the character atlas selected by the frozen world revision.

The runtime shell now keeps those revisions independent in practice. It can
load any of the four generated world profiles first, then bind the exact
profile-matched `CharacterProfileRevision` and PNG atlas without rebuilding
the world. File-based launch accepts only one
`res://mapsoo_characters/<revision-id>/` directory and the trusted canonical
revision SHA-256; changing worlds clears the active character binding and
requires a compatible rebind.

Initial constraints:

- Godot 4.3-compatible renderer and importer.
- 320×180 logical art target, scaled to the display.
- Texture atlases within the current importer limits.
- Bounded active sprites, lights, particles, and parallax planes.
- Headless import and playability smoke before a pack is offered to the Raspberry Pi.

## Next implementation slice

1. Connect completed model workflow run sets to the full provider bundle
   builders for all four profiles, not only the layered-depth review assembler.
2. Split large character pose inventories into smaller continuity-bound review
   batches before assembling the canonical atlas.
3. Collect playtest feedback and branch a new revision without overwriting the playable one.
4. Test the reproducible ARM64 runtime artifact on a physical Raspberry Pi 4B and record frame time, memory, temperature and display-driver results.
