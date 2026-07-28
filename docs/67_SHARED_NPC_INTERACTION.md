# Shared NPC interaction

Status: executable public runtime contract

WorldForge imports four different movement profiles, but a consuming host should
not need four NPC adapters. Every generated player therefore owns one trusted
`NpcInteraction` child using:

```text
res://addons/mapsoo_importer/runtime/mapsoo_npc_interaction_controller.gd
```

The controller is supplied by the trusted importer and World Runner, never by
an asset pack. Packs remain data-only.

## Host API

The reusable runtime shell exposes:

```gdscript
var result: Dictionary = runtime_shell.interact_nearest_npc()
if result.ok:
    print(result.npc_id)
```

On success, the result contains `ok`, `status`, `npc_id`, and `distance`. The
shell emits `npc_interacted(result)`. Failures return an explicit reason or
shell error code and emit `npc_interaction_failed(result)`.

A host that embeds the generated scene without the shell can call the player's
`NpcInteraction.try_interact()` method. It may optionally define the
`mapsoo_interact` InputMap action for edge-triggered input. WorldForge does not
add or overwrite project InputMap entries.

## Neutral NPC discovery

NPCs are recognized using public scene metadata:

- `mapsoo_interaction_kind = "npc"`; or
- a `mapsoo_role` beginning with `character.npc.`; or
- the legacy neutral `mapsoo_character_id = "npc"`.

The importer writes a stable `mapsoo_interaction_id` where the pack schema has a
character ID. Selection is deterministic: distance first, then interaction ID,
then scene path. Radius values outside `(0, 512]` fail closed.

The public result carries only the neutral generated ID. Personality, dialogue,
memory, relationships, private entity identity, and event transport remain the
consumer's responsibility.

## Verification

Run:

```powershell
pnpm npc:interaction:godot
```

The smoke test covers all four profiles on Godot 4.3 and 4.7, direct host calls,
held-input edge behavior, stable ties, out-of-range rejection, and invalid
radius rejection. The World Runner PCK includes the controller as a pinned
trusted runtime file.
