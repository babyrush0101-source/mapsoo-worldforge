# Character semantic continuity

Status: **implemented private input contract and model-prompt boundary; real-art
review pending**

A source-image digest can prove that four character revisions point back to the
same reference. It cannot prove that a model preserved the same hair, face,
clothing, equipment or body proportions. `CharacterIdentitySemantics 1.0`
closes that gap without adding provider-specific fields to world Packs.

## Conversation step

After a user selects or creates a character image:

1. the Agent proposes a short cue sheet from the image and the user's
   description;
2. the user corrects or confirms every identity-defining cue;
3. the application records a human-confirmed checkpoint;
4. the cue sheet is bound to the neutral character id, opaque source-identity
   digest and character reference id;
5. the private production workspace stores the canonical cue sheet beside the
   reference images.

The contract requires:

- silhouette;
- body proportions;
- hair;
- face;
- one or more clothing cues;
- zero or more equipment cues;
- one or more distinguishing features;
- two through eight lowercase hex palette anchors.

Unconfirmed cues, commercial-game imitation language, unknown fields, unsafe
ids, invalid digests and duplicate list entries fail closed.

## Four-profile adaptation

Every character-bearing provider task compiles the same confirmed cues with one
small profile rule:

| Profile | Allowed adaptation |
| --- | --- |
| `side-platformer` | Side-view foreshortening, left/right readability and declared frame geometry |
| `topdown-farm` | Orthogonal top-down foreshortening, four-direction readability and declared frame geometry |
| `isometric-action` | 2:1 projection, eight-direction combat readability and declared frame geometry |
| `layered-depth-2d` | Shallow-depth near/far projection, layered readability and declared frame geometry |

The prompt explicitly forbids replacing, removing, recoloring or inventing
identity-defining cues merely to fit the environment style. Camera, pixel
density, animation geometry and lighting may adapt; the character identity may
not.

## Private workflow

Prepare a workspace with an optional confirmed cue sheet:

```bash
pnpm world-delivery:workspace -- prepare \
  --intake <confirmed-intake.json> \
  --reference-root <private-reference-root> \
  --workspace <private-workspace-outside-the-repository> \
  --character-id <neutral-character-id> \
  --character-identity-semantics <human-confirmed-character.json> \
  --completed-at <canonical-UTC-ISO>
```

The workspace writes canonical
`character-identity-semantics.json` and points the private workflow job to that
file. Its exact bytes participate in the private input-binding SHA-256. A
changed cue therefore invalidates the existing resumable workflow instead of
silently changing later prompts.

Remote workflow execution now refuses to start without this file. The
single-task runner passes it only for tasks that declare a character reference.
The ordinary provider boundary verifies that its source reference id matches
the one uploaded for that exact task.

## Privacy and review boundary

The raw cue sheet:

- stays outside the public repository by default;
- is not copied to a Pack, source receipt, workflow state, progress report,
  character revision or runtime delivery;
- is uploaded as prompt text only after the existing exact provider/task/
  reference authorization permits both prompt and reference upload;
- is never treated as art approval.

Successful prompt construction proves only that the confirmed constraints were
sent to the selected provider. Human review must still compare the generated
frames against the source character for semantic identity, action, direction,
temporal continuity and readability. A physical Raspberry Pi pass remains a
separate runtime gate.
