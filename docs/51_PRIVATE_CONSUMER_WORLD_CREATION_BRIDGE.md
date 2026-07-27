# Private consumer world-creation bridge

Status: public, consumer-neutral intake, private-workspace CLI, and verified
World Runner delivery implemented; the private consumer adapter remains
outside this repository

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

## Executable neutral bridge

The public CLI accepts only `ConfirmedWorldCreationIntake 1.0`. It does not
know a consumer product name, account, daemon route, internal character record,
NPC record, or launch transport.

First, prepare a private workspace:

```bash
pnpm world-delivery:workspace -- prepare \
  --intake <confirmed-intake.json> \
  --reference-root <private-reference-root> \
  --workspace <absolute-private-workspace-outside-this-repository> \
  --character-id <portable-character-id> \
  --completed-at <canonical-UTC-ISO>
```

This command:

- re-materializes and fingerprints the confirmed ten-fact intake;
- re-reads both reference images under the declared root and verifies their
  media type, dimensions, byte length, SHA-256, role, and rights;
- requires the explicit completion instant used by the reproducible baseline
  receipt instead of inventing or reading a nondeterministic timestamp;
- builds a complete zero-request procedural world pack from the same confirmed
  intake, checkpoint hashes, references and `WorldLayoutPlan`;
- writes the baseline ZIP, exact exported preview, world-asset revision and
  review evidence under `baseline/`, with every byte in the workspace hash
  inventory;
- derives the canonical four-profile production task inventory and exact
  default request budget;
- writes the confirmed intake, projection, world brief, style bible, copied
  references, production-art job, and a hash inventory atomically;
- configures workflow state and generated candidates in a sibling private
  output directory outside the public checkout;
- performs zero uploads and zero remote requests.

Existing output is accepted only when every file is byte-identical. A changed
intake, reference, generated job, or inventory is never merged over prior
state.

The workspace manifest labels the first pack:

```json
{
  "status": "godot-import-ready",
  "art_quality": "procedural-placeholder",
  "final_art_required": true
}
```

It is a real complete pack whose scene, collision, navigation, spawn, exit and
landmarks come from the confirmed layout and can be imported immediately. It
is not presented as finished model art. This gives the user a playable map
while later model tasks replace the placeholder atlases under independent
review gates.

The generated model-art job can be inspected locally with:

```bash
pnpm production-art:workflow -- \
  --job <private-workspace>/production-art-workflow-job.json
```

That invocation is dry-run by default. A real image request still requires the
separate `--execute --allow-remote-upload` authorization. Consumer integrations
also bind that authorization to the exact `state_revision` and `next_task_id`
returned by progress:

```bash
pnpm production-art:workflow -- \
  --job <private-workspace>/production-art-workflow-job.json \
  --execute --allow-remote-upload --max-requests 1 \
  --expected-state-revision <revision-from-progress> \
  --expected-next-task <next-task-id-from-progress>
```

The guarded values are checked under the workflow lock before a credential is
used or request budget is consumed. Scene direction requires its own reviewed
request and exact-byte approval before later asset tasks can start. A private
companion may authorize up to four already-unlocked canonical tasks in one
invocation, but rejected or uncertain output always stops the batch.

The returned `progress` object is the only public workflow status intended for
a consumer UI or Agent. It lists missing roles and the next action without
exposing private prompts or paths. In particular:

- `direction.generated=true` means only that a direction candidate exists;
- `direction.approved=true` means its exact bytes were accepted for this
  immutable workflow;
- `run_set_ready=true` means every canonical image task has verified output;
- `runtime_verified` and `runner_delivery_ready` remain false at this stage.

A private consumer must therefore keep “generating”, “awaiting approval”,
“assembling”, “runtime testing”, and “ready to enter” as distinct states.
Rejected or uncertain mandatory tasks stop later paid generation until the
operator explicitly resolves the same task.

After art approval, deterministic pack projection and Godot import, build the
PCK and its exact evidence on the trusted host:

```bash
pnpm world-runner:pck:build -- \
  --bundle-root <staged-bundle-root> \
  --world-pack packs/world.zip \
  --imported-world imported/<world-id> \
  --world-id <world-id> \
  --spawn-id <spawn-id> \
  --player-slot-id <player-slot-id> \
  --character-revision characters/revision.json \
  --character-atlas characters/atlas.png \
  --godot-bin <trusted-godot-4.3+-binary> \
  --out runtime/world.pck \
  --report evidence/smoke.json \
  --receipt evidence/pck-build-receipt.json
```

The builder accepts exactly the importer-managed scene, TileSet and integrity
state, one portable spawn/player-slot pair, plus an optional exact character
revision/atlas pair. It verifies the
Pack manifest hash, state integrity, generated-file hashes, world/profile
metadata, character profile, atlas bytes, bundle containment and trusted
runtime-script references before calling Godot's `PCKPacker`. It then starts
Godot from the new PCK and requires exact world, Pack, profile, scene,
spawn/player-slot and character-binding markers. The PCK embeds the launch
binding; omitted runtime arguments use those embedded IDs, while supplied IDs
must match them exactly. The runtime resolves one `PlayerSpawn` and one
character-capable `Player`, moves the player to the spawn, and rejects missing,
duplicate or mismatched bindings before readiness.

An optional revision-bound horizontal direction transform is copied into the
PCK only after its profile, single direction and opaque provenance reference
are validated; the PCK builder does not infer direction from atlas pixels.
Only after that launch succeeds does it write
`mapsoo-godot-headless-smoke-report-1.0` and the build receipt.

The `.pck` contains platform-neutral Godot content; it is not an ARM64
executable. The delivery binds that content to the separately verified Godot
Linux ARM64 runtime used by the Raspberry Pi. The receipt records the actual
build host and always says `physical_raspberry_pi_tested: false`.
When a character pair is supplied, the receipt also binds the embedded
revision bytes and atlas hashes. The same PCK can then launch interactively
with only portable world/character IDs and trusted SHA-256 arguments; it does
not need a source project or an arbitrary private filesystem path.

Physical Pi admission is intentionally later and separate. Run
`pnpm pi4:physical:accept` on the device to obtain a privacy-minimized receipt
that binds that exact PCK and embedded character to world-entered,
character-bound and performance evidence. A desktop build/smoke report cannot
be promoted into this receipt.

Finally, finalize the handoff:

```bash
pnpm world-delivery:workspace -- finalize \
  --intake <confirmed-intake.json> \
  --bundle-root <staged-bundle-root> \
  --world-pack packs/world.zip \
  --runtime-artifact runtime/world.pck \
  --runtime-kind godot-pck \
  --architecture arm64 \
  --runtime-contract runtime/contract.json \
  --character-revision characters/revision.json \
  --verification-report evidence/smoke.json \
  --delivery-id <delivery-id> \
  --spawn-id <spawn-id> \
  --player-slot-id <player-slot-id> \
  --out <private-delivery.json>
```

Finalization streams and hashes the staged pack and runtime artifact, requires
canonical character-revision bytes, verifies the declared atlas bytes and
identity digest, validates the runtime contract, and requires a strict
`mapsoo-godot-headless-smoke-report-1.0` document bound to those exact pack,
runtime, spawn and player-slot values. A legacy report may still validate
against the historical JSON Schema, but it cannot finalize a new delivery
without launch evidence. Different existing output is never overwritten.

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

The public browser demonstrates the same neutral boundary. Its four visible
rounds collect the ten facts in groups: six world facts, two art-direction
facts, two map facts, and one intent-preview approval. Profile and runtime
target are then locked. Reference selection and explicit rights confirmation
complete the final style-sample checkpoint; only at that point does the
application create the canonical intake, derive the character identity digest,
build the `WorldLayoutPlan`, and invoke the existing provider runner. The
generated ZIP therefore contains the exact layout derived from the confirmed
facts and seed rather than a UI-only description or unrelated default map.

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
- Raspberry Pi 4B delivery must be a prebuilt `godot-pck` bound to the ARM64
  runtime target;
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
  -> reproducible target-neutral PCK bound to the ARM64 runtime
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
- strict four-profile world-family continuity receipt binding one shared world
  identity and character identity to the exact four intake/revision pairs;
- zero-request private-workspace preparation CLI with atomic/idempotent output;
- external private workflow-state and candidate-art roots, proven by a real
  workflow dry run;
- portable runtime and character-profile contracts;
- strict World Runner delivery materializer and JSON Schema;
- exact-byte delivery finalizer plus strict Godot headless-smoke report schema;
- enforced PCK fast path for Raspberry Pi 4B;
- real Godot `PCKPacker` build, exact embedded-character bind,
  launch-from-PCK smoke, persistent interactive readiness, build receipt,
  negative input tests, and byte-for-byte reproducibility test;
- separate fail-closed physical Pi 4B acceptance contract and device-only
  collector for startup, frames, memory and temperature;
- deterministic three-profile production review-pack projection plus the
  existing layered-depth Pack 1.0 path.

The internal review archives use their own review-manifest schema. They do not
rewrite or widen the published Pack 0.6, 0.7, or 0.8 schemas, so public release
fixtures remain byte-for-byte immutable.

Still required in the private consumer or trusted build environment:

- connect the private create-world entry to its own Agent and truth/commit flow;
- translate the private confirmed projection into the public intake document;
- run paid model tasks only after the product obtains explicit upload consent
  and the user approves each direction/candidate;
- run the reviewed real-art pack through the trusted PCK builder;
- register accepted pack/profile digests in the private asset store;
- adapt the neutral runtime messages to the private launch channels;
- perform physical Raspberry Pi staging, launch, render, performance, rollback,
  and user-acceptance evidence.

No claim of private-product integration or physical-device validation is made
until those consumer-side gates have actually run.
