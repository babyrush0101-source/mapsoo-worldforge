# Private consumer world-creation bridge

Status: public, consumer-neutral intake and World Runner delivery contracts
implemented; the private consumer adapter remains outside this repository

This integration lets a private product open a “create world” flow, ask several
Agent-guided questions, generate a complete Mapsoo world pack, bind a separately
created character, and hand a verified runtime artifact to its own World Runner.

The private product is an acceptance consumer, not part of Mapsoo. Its product
name, user model, Agent memory, daemon API, NPC records, device identifiers,
absolute paths, launch payload fields, and business completion rules must never
enter this repository.

## End-to-end ownership

```text
private create-world UI and Agent
  -> ask and revise world facts
  -> private system confirms its own truth
  -> emit ConfirmedWorldCreationIntake 1.0
  -> Mapsoo verifies references, rights, checkpoints and profile
  -> GenerationRequestV2 + ConfirmedGenerationBinding
  -> production-art tasks and source-free run-set inventory
  -> profile-specific deterministic review-pack projection
  -> human art approval and frozen pack
  -> Godot import + headless smoke
  -> build PCK/project/web artifact on a build host
  -> WorldRunnerDelivery 1.0
  -> private host verifies, registers and launches
```

The private system remains the only truth source for the conversation, user,
character identity, world admission, permissions, and completion. Mapsoo never
turns “files exist” or “smoke passed” into a private product transaction.

## Agent conversation intake

`src/core/confirmed-world-creation-intake.ts` exports ten neutral prompts for:

1. premise and intended player feeling;
2. worldview, history, rules, beliefs, or central tension;
3. terrain;
4. geography, regions, routes, spawn, and exit;
5. culture, people, architecture, work, and customs;
6. ecology, climate, plants, animals, and weather;
7. mood and gameplay readability;
8. art direction, camera, scale, palette, and materials;
9. traversal, interactions, hazards, checkpoints, and exit condition;
10. required visual landmarks.

The Agent may ask follow-up questions or return to an earlier answer. Only the
confirmed result crosses the boundary. `ConfirmedWorldCreationIntake 1.0`
contains:

- the selected Mapsoo profile and target device;
- structured public-safe world facts;
- exactly one environment-style and one character reference descriptor;
- explicit reference rights and immutable image digests;
- an opaque character identity digest, not a private identity record;
- the approved intent-preview digest;
- four ordered checkpoint digests binding the brief, art direction, layout,
  and style sample.

Raw image bytes stay out of JSON and are bound separately by the existing
reference-image validator. Unknown fields, absolute paths, changed facts,
changed references, or changed preview bytes fail closed.

The projection creates the existing `GenerationRequestV2` and
`ConfirmedGenerationBinding`, so the new conversation boundary uses the
production pipeline instead of bypassing it.

## Character composition

The world and selected character remain independently versioned:

```text
frozen world pack
  + compatible CharacterProfileRevision
  + neutral player slot
  -> runtime bind
```

The world is not rebuilt just because the user selects a different compatible
character. A created character first becomes a complete, digest-verified
`CharacterProfileRevision` for the selected world profile. Its atlas, frame
grid, pivot, clips, source-identity summary, and rights are validated before
the runtime player slot changes.

No private Actor, NPC, relationship, memory, or user record belongs in the
character profile.

## World Runner delivery

`WorldRunnerDelivery 1.0` is the final build-host-to-consumer handoff. It binds:

- the exact confirmed-intake SHA-256;
- the frozen world-pack path, size, and SHA-256;
- a PCK, Godot project archive, or web bundle with its own digest;
- the complete portable runtime contract;
- the canonical character-profile revision descriptor and identity digest;
- one valid spawn and one character-capable player slot;
- Godot version plus a passing headless-smoke evidence digest.

Cross-references are semantic, not only structural:

- runtime-contract pack digest must equal the delivered world-pack digest;
- launch spawn and player slot must exist in the runtime contract;
- the character profile must match the world profile and identity digest;
- Raspberry Pi 4B delivery must be a prebuilt ARM64 `godot-pck`;
- web delivery must be a wasm32 `web-bundle-zip`;
- every path must be relative and portable.

The private host may translate this document into its own launch payload,
event-result files, input stream, authorization checks, registration events,
and rollback procedure. That thin adapter stays private.

`createWorldRunnerLaunchEnvelope()` turns a validated delivery and compatible
character revision into the complete neutral message sequence:

```text
runtime.prepare
  -> character-profile.bind
  -> runtime.bind
  -> runtime.launch
```

Every message has an idempotency key and canonical payload digest. The
consumer must authorize and persist the operation before translating it to its
own runtime transport.

## Raspberry Pi 4B fast path

The target device should not compile a new Godot project for each user world.

```text
Mapsoo pack
  -> trusted build machine imports and smokes
  -> reproducible ARM64-compatible PCK
  -> delivery manifest and SHA-256
  -> device stages and verifies
  -> atomic promotion or rollback
  -> Godot --main-pack <verified-pck>
```

This is the shortest controlled path for the current class of host. A reusable
runtime shell plus external content loading can be added later, but must not
weaken digest checks or silently reinterpret a new world as admitted.

## Current evidence and remaining consumer work

Implemented in this repository:

- strict confirmed-intake materializer, canonical fingerprint, and projection;
- strict JSON Schema and positive/negative tests for all four profiles;
- portable runtime and character-profile contracts;
- strict World Runner delivery materializer and JSON Schema;
- enforced PCK fast path for Raspberry Pi 4B;
- deterministic three-profile production review-pack projection plus the
  existing layered-depth Pack 1.0 path.

The internal review archives use their own review-manifest schema. They do not
rewrite or widen the published Pack 0.6, 0.7, or 0.8 schemas, so public release
fixtures remain byte-for-byte immutable.

Still required outside this repository:

- connect the private create-world entry to its own Agent and truth/commit flow;
- convert a confirmed private projection into the public intake document;
- register accepted pack/profile digests in the private asset store;
- adapt the neutral runtime messages to the private launch channels;
- perform physical Raspberry Pi staging, launch, render, performance, rollback,
  and user-acceptance evidence.

No claim of private-product integration or physical-device validation is made
until those consumer-side gates have actually run.
