# Live-model four-profile direction review

Status: **implemented review protocol; real local direction candidates produced;
human approval and complete asset generation still pending**

This protocol checks an important failure mode before a complete model-art run
is authorized: the same world and character can drift into unrelated designs
when the camera and gameplay profile change.

The protocol is provider-neutral. It can be used with the optional server-side
model adapter documented in
[`49_MODEL_BACKED_PRODUCTION_ART.md`](49_MODEL_BACKED_PRODUCTION_ART.md), or
with another operator-approved image provider whose results are later imported
through a reviewed source boundary. It does not weaken the production
workflow's per-task upload authorization, request budget, immutable input
binding, or human-review gates.

## What stays fixed

Write one source-free world identity before generating any direction:

- premise and objective;
- three to five world landmarks;
- environment materials and recurring motifs;
- time of day and warm/cool value hierarchy;
- one portable character id;
- four to six observable character identity cues.

The identity cues must be visible rather than biographical. Examples include
hair silhouette, scarf color, coat shape, satchel placement, tool silhouette,
and body proportions. Do not put a private display name, user id, biography,
source path, or raw reference digest in the public review record.

## What changes

Generate exactly one `scene-direction` candidate for each public profile:

| Profile | Camera and gameplay proof required |
| --- | --- |
| `side-platformer` | continuous side route, spawn, traversal surface, hazards and destination |
| `topdown-farm` | readable paths, fields, structures, water edges and four-direction character scale |
| `isometric-action` | coherent projection, combat clearance, hazards, elevation and objective |
| `layered-depth-2d` | grounded 2D route and at least seven visually separable depth planes |

All four candidates use the same world and character identity, the exact
profile task contract, and a `1536x1024` source. Prompts describe camera,
readability and asset function. They must not ask for direct imitation of a
named game, copyrighted character, logo, UI, watermark, or pseudo-text.

Generate each candidate independently. Do not create one four-panel image and
pretend that it proves four independent model responses.

## Local review board

Source candidates, prompts, references and a comparison board remain under a
private or ignored operator directory. The board may scale copies for visual
comparison, but its manifest must bind the selected source bytes, not only the
composite preview.

Review in this order:

1. exact PNG dimensions, byte bounds and SHA-256;
2. world landmark continuity;
3. character cue continuity;
4. profile camera and navigation readability;
5. value grouping and gameplay contrast;
6. obvious provider artifacts, pseudo-text and duplicated subjects;
7. whether a targeted edit can fix one localized issue without redrawing the
   whole candidate.

An AI-assisted pre-review may label a candidate `direction-pass`,
`pass-with-revision`, or `redo`. It is not a human approval record.

## Approval boundary

The user selects one profile and approves the exact direction bytes before the
workflow may schedule terrain, prop, structure, effect, background or character
tasks for that profile. The private job records the approved direction path;
the workflow hashes it and binds every later task to those bytes.

Approval of a direction image does **not** prove:

- that a flattened image can be separated into runtime layers;
- that terrain tiles are seamless;
- that sprite sheets obey the required cell inventory;
- that the reference character remains recognizable in every animation;
- that collision, navigation, NPC behavior or map layout is correct;
- that redistribution rights are approved;
- that a Godot scene or physical Raspberry Pi build passes.

Those claims remain separate gates in the production-art, pack, World Runner
and Pi review contracts.

## First neutral proof run

On 2026-07-27 a local, source-free proof used one neutral harbor brief and one
portable lantern-traveler identity across all four profiles. Four independent
`1536x1024` candidates were generated. The first isometric candidate preserved
the arena and character but collapsed the required split lighthouse into one
tower. A targeted landmark-only revision restored two towers while preserving
the rest of the composition.

The proof shows that the protocol can detect and correct cross-profile landmark
drift. The images remain local internal-review candidates and are deliberately
excluded by `.gitignore`. This record is not human art approval, public-license
evidence, a complete asset pack, or runtime acceptance.

## Exit criteria

A direction round is ready to unlock one selected profile only when:

- all four source images pass the machine checks above;
- the selected profile preserves the required world and character cues;
- any revisions are bound as new immutable source bytes;
- a human explicitly approves the selected source;
- reference upload rights and output distribution remain recorded separately;
- later requests remain within the workflow request budget.
