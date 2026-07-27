import { useMemo, useState } from 'react';

import type { WorldAssetProfile } from '../../core/asset-profile';
import { renderProfileReferenceScene } from '../../adapters/canvas/render-profile-reference-scene';
import {
  CONFIRMED_DIALOGUE_STAGES,
  type ConfirmedDialogueCheckpoint,
} from '../../core/confirmed-generation-binding';
import {
  WORLD_CREATION_FACT_PROMPTS,
  type ConfirmedWorldFacts,
  type WorldCreationIntakeTarget,
} from '../../core/confirmed-world-creation-intake';
import {
  PROFILE_CREATION_CAPABILITIES,
  WORLD_CREATION_STAGES,
  WORLD_CREATION_STAGE_DESCRIPTORS,
  type WorldCreationStage,
} from '../../core/world-creation-flow';
import {
  WorldCreationError,
  createWorldCreationSession,
  reduceWorldCreationSession,
} from '../../core/world-creation-session';

const PROFILE_LABELS: Readonly<Record<WorldAssetProfile, string>> = Object.freeze({
  'topdown-farm': 'Top-down farm',
  'side-platformer': 'Side platformer',
  'isometric-action': 'Isometric action',
  'layered-depth-2d': 'Layered-depth 2D',
});

const STARTER_FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'A hopeful riverside settlement where a young courier reconnects isolated neighborhoods.',
  worldview: 'Seasonal floods separated the districts, so trust is rebuilt through deliveries and repaired crossings.',
  terrain: 'Riverbanks, stone paths, timber bridges, garden plots and one climbable hill.',
  geography: 'The old ferry is the spawn, the market and waterwheel are route landmarks, and the hill gate is the exit.',
  culture: 'Ferry workers, growers and craftspeople share timber homes, awnings, public notice boards and market stalls.',
  ecology: 'A mild river climate with reeds, willow trees, garden plants, birds, drifting leaves and soft morning mist.',
  mood: 'Hopeful and calm, with strong silhouettes and readable paths, hazards, interactions and exits.',
  art_direction: 'Warm hand-painted pixels, soft morning light, teal water, amber landmarks and consistent character scale.',
  traversal: 'Start at the old ferry, cross the market and waterwheel checkpoints, then climb to the hill gate exit.',
  landmarks: 'Old ferry, waterwheel market, hilltop gate.',
});

const STARTER_REPLIES: Readonly<Partial<Record<WorldCreationStage, string>>> = Object.freeze({
  'style-sample': 'Keep the palette and character scale. Increase the exit landmark contrast before full generation.',
});

type WorldFactKey = keyof ConfirmedWorldFacts;

const STAGE_FACT_KEYS: Readonly<
  Partial<Record<WorldCreationStage, readonly WorldFactKey[]>>
> = Object.freeze({
    'world-brief': Object.freeze<WorldFactKey[]>([
      'premise',
      'worldview',
      'terrain',
      'geography',
      'culture',
      'ecology',
    ]),
    'art-direction': Object.freeze<WorldFactKey[]>(['mood', 'art_direction']),
    'map-layout': Object.freeze<WorldFactKey[]>(['traversal', 'landmarks']),
  });

const FACT_MAX_LENGTH: Readonly<Record<WorldFactKey, number>> = Object.freeze({
  premise: 240,
  worldview: 240,
  terrain: 200,
  geography: 200,
  culture: 240,
  ecology: 200,
  mood: 160,
  art_direction: 240,
  traversal: 200,
  landmarks: 240,
});

const FACT_PROMPTS = Object.freeze(Object.fromEntries(
  WORLD_CREATION_FACT_PROMPTS.map(({ fact, question }) => [fact, question]),
) as Record<WorldFactKey, string>);

export interface WorldCreationAssetHandoff {
  readonly profile: WorldAssetProfile;
  readonly target: WorldCreationIntakeTarget;
  readonly facts: ConfirmedWorldFacts;
  readonly description: string;
  readonly sessionRevision: number;
  readonly checkpoints: readonly ConfirmedDialogueCheckpoint[];
  readonly approvedIntentPreviewSha256: string;
}

interface WorldCreationDialogueProps {
  readonly onReadyForAssets?: (handoff: WorldCreationAssetHandoff) => void;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const snapshot = value.slice();
  const digest = await crypto.subtle.digest('SHA-256', snapshot.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function dataUrl(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return `data:image/png;base64,${btoa(chunks.join(''))}`;
}

export function buildWorldCreationStyleSample(
  profile: WorldAssetProfile,
  facts: ConfirmedWorldFacts,
) {
  return renderProfileReferenceScene(profile, JSON.stringify({
    profile,
    worldBrief: `${facts.premise} ${facts.worldview} ${facts.culture} ${facts.ecology}`,
    artDirection: `${facts.mood} ${facts.art_direction}`,
    mapLayout: `${facts.terrain} ${facts.geography} ${facts.traversal} ${facts.landmarks}`,
  }));
}

function stageSummary(stage: WorldCreationStage, facts: ConfirmedWorldFacts, sampleNotes: string): string {
  const factKeys = STAGE_FACT_KEYS[stage] ?? [];
  if (factKeys.length === 0) return sampleNotes.trim();
  return factKeys.map((fact) => facts[fact].trim()).join(' · ');
}

function generationDescription(facts: ConfirmedWorldFacts): string {
  return [
    `Premise: ${facts.premise}`,
    `Worldview: ${facts.worldview}`,
    `Terrain: ${facts.terrain}`,
    `Geography: ${facts.geography}`,
    `Culture: ${facts.culture}`,
    `Ecology: ${facts.ecology}`,
    `Mood: ${facts.mood}`,
    `Art direction: ${facts.art_direction}`,
    `Traversal: ${facts.traversal}`,
    `Landmarks: ${facts.landmarks}`,
  ].join('\n').slice(0, 2000);
}

function checkpointPrefix(stage: WorldCreationStage): string {
  return stage.replace('world-', '').replace('art-direction', 'art').replace('map-layout', 'layout').replace('style-sample', 'sample');
}

export function WorldCreationDialogue({ onReadyForAssets }: WorldCreationDialogueProps) {
  const [session, setSession] = useState(() => createWorldCreationSession({
    id: 'browser-world-session',
    profile: 'topdown-farm',
  }));
  const [target, setTarget] = useState<WorldCreationIntakeTarget>('raspberry-pi-4b');
  const [facts, setFacts] = useState<ConfirmedWorldFacts>(STARTER_FACTS);
  const [reply, setReply] = useState('');
  const [answers, setAnswers] = useState<Partial<Record<WorldCreationStage, string>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Answer one question at a time. Nothing is frozen until you explicitly approve it.');
  const descriptor = WORLD_CREATION_STAGE_DESCRIPTORS[session.stage];
  const dialogueStage = WORLD_CREATION_STAGES.indexOf(session.stage) <= WORLD_CREATION_STAGES.indexOf('style-sample');
  const completedStages = useMemo(() => new Set(session.checkpoints.map(({ stage }) => stage)), [session.checkpoints]);
  const styleSample = useMemo(
    () => session.stage === 'style-sample' ? buildWorldCreationStyleSample(session.profile, facts) : null,
    [session.stage, session.profile, facts],
  );
  const currentFactKeys = STAGE_FACT_KEYS[session.stage] ?? [];
  const canConfirm = currentFactKeys.length > 0
    ? currentFactKeys.every((fact) => facts[fact].trim().length > 0)
    : reply.trim().length > 0;

  async function confirmCurrentStage() {
    if (!dialogueStage || !canConfirm) return;
    setBusy(true);
    try {
      const normalizedFacts = {
        ...facts,
        ...Object.fromEntries(
          currentFactKeys.map((fact) => [fact, facts[fact].trim()]),
        ),
      } as ConfirmedWorldFacts;
      const normalized = stageSummary(session.stage, normalizedFacts, reply);
      const visualSampleSha256 = session.stage === 'style-sample' && styleSample
        ? await sha256Bytes(styleSample.pngBytes)
        : undefined;
      const snapshotSha256 = await sha256(JSON.stringify({
        profile: session.profile,
        target,
        stage: session.stage,
        facts: Object.fromEntries(
          currentFactKeys.map((fact) => [fact, normalizedFacts[fact]]),
        ),
        ...(session.stage === 'style-sample' ? { sampleNotes: normalized } : {}),
        ...(visualSampleSha256 ? { visualSampleSha256 } : {}),
      }));
      const prefix = checkpointPrefix(session.stage);
      const next = reduceWorldCreationSession(session, {
        type: 'confirm-stage',
        expectedRevision: session.revision,
        stage: session.stage,
        checkpointId: `${prefix}-r${session.revision + 1}`,
        snapshotSha256,
      });
      const nextAnswers = { ...answers, [session.stage]: normalized };
      setAnswers(nextAnswers);
      setFacts(normalizedFacts);
      setSession(next);
      setReply(STARTER_REPLIES[next.stage] ?? '');
      if (next.stage === 'asset-generation' && next.phase !== 'blocked') {
        if (!visualSampleSha256) throw new Error('The approved intent preview digest is missing.');
        const checkpoints = CONFIRMED_DIALOGUE_STAGES.map((stage) => {
          const checkpoint = next.checkpoints.find((candidate) => candidate.stage === stage);
          if (!checkpoint) throw new Error(`Missing confirmed ${stage} checkpoint.`);
          return Object.freeze({ stage, snapshotSha256: checkpoint.snapshotSha256 });
        });
        onReadyForAssets?.({
          profile: next.profile as WorldCreationAssetHandoff['profile'],
          target,
          facts: Object.freeze({ ...normalizedFacts }),
          description: generationDescription(normalizedFacts),
          sessionRevision: next.revision,
          checkpoints: Object.freeze(checkpoints),
          approvedIntentPreviewSha256: visualSampleSha256,
        });
      }
      setNotice(next.phase === 'blocked'
        ? next.blockedReason ?? 'This profile is not yet available for complete generation.'
        : `${descriptor.label} confirmed. Continue with ${WORLD_CREATION_STAGE_DESCRIPTORS[next.stage].label.toLowerCase()}.`);
    } catch (error) {
      setNotice(error instanceof WorldCreationError ? error.message : 'The dialogue checkpoint could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function changeProfile(profile: WorldAssetProfile) {
    try {
      const next = reduceWorldCreationSession(session, {
        type: 'change-profile',
        expectedRevision: session.revision,
        profile,
      });
      setSession(next);
      setNotice(`${PROFILE_LABELS[profile]} selected. The later steps now follow that profile's asset contract.`);
    } catch (error) {
      setNotice(error instanceof WorldCreationError ? error.message : 'The profile could not be changed.');
    }
  }

  function returnToStage(stage: WorldCreationStage) {
    try {
      const next = reduceWorldCreationSession(session, {
        type: 'back-to-stage',
        expectedRevision: session.revision,
        stage,
      });
      setSession(next);
      setReply(stage === 'style-sample'
        ? answers[stage] ?? STARTER_REPLIES[stage] ?? ''
        : '');
      setNotice(`Returned to ${WORLD_CREATION_STAGE_DESCRIPTORS[stage].label.toLowerCase()}. Later draft checkpoints were cleared.`);
    } catch (error) {
      setNotice(error instanceof WorldCreationError ? error.message : 'The earlier checkpoint could not be restored.');
    }
  }

  const capability = PROFILE_CREATION_CAPABILITIES[session.profile];
  return (
    <section className="creation-dialogue" aria-labelledby="creation-dialogue-title">
      <div className="creation-dialogue-heading">
        <div>
          <p className="eyebrow">Guided world creation · deterministic checkpoints</p>
          <h2 id="creation-dialogue-title">Build the world through a short conversation.</h2>
        </div>
        <p>
          Confirm the premise, art direction, layout and sample. Only then can a complete asset revision
          be frozen, assembled in Godot and launched for play.
        </p>
      </div>

      <ol className="creation-stepper" aria-label="World creation progress">
        {WORLD_CREATION_STAGES.map((stage, index) => {
          const current = stage === session.stage;
          const complete = completedStages.has(stage);
          const available = index <= WORLD_CREATION_STAGES.indexOf('style-sample')
            || (stage === 'asset-generation' && capability.completeAssetProvider)
            || (stage === 'godot-map' && capability.godotSceneImporter)
            || (stage === 'playtest' && capability.interactiveRuntime);
          return (
            <li className={`${current ? 'is-current' : ''} ${complete ? 'is-complete' : ''}`} key={stage}>
              <span>{complete ? '✓' : String(index + 1).padStart(2, '0')}</span>
              <strong>{WORLD_CREATION_STAGE_DESCRIPTORS[stage].label}</strong>
              <small>{available ? 'available' : 'prototype'}</small>
            </li>
          );
        })}
      </ol>

      <div className="creation-dialogue-body">
        <aside className="creation-dialogue-history" aria-label="Confirmed answers">
          <strong>Confirmed checkpoints</strong>
          {session.checkpoints.length === 0 ? <p>No answers confirmed yet.</p> : (
            <ol>
              {session.checkpoints.map((checkpoint) => (
                <li key={checkpoint.id}>
                  <button type="button" onClick={() => returnToStage(checkpoint.stage)}>
                    <span>{WORLD_CREATION_STAGE_DESCRIPTORS[checkpoint.stage].label}</span>
                    <small>{answers[checkpoint.stage] ?? 'Confirmed'}</small>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>

        <div className="creation-dialogue-turn">
          <p className="creation-speaker">Mapsoo · {descriptor.label}</p>
          <h3>{descriptor.question}</h3>
          {session.stage === 'world-brief' && (
            <div className="two-column-fields">
              <label>
                World profile
                <select value={session.profile} onChange={(event) => changeProfile(event.target.value as WorldAssetProfile)}>
                  {Object.entries(PROFILE_LABELS).map(([profile, label]) => (
                    <option key={profile} value={profile}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                Runtime target
                <select value={target} onChange={(event) => setTarget(event.target.value as WorldCreationIntakeTarget)}>
                  <option value="raspberry-pi-4b">Raspberry Pi 4B</option>
                  <option value="desktop">Desktop</option>
                  <option value="web">Web</option>
                </select>
              </label>
            </div>
          )}
          {dialogueStage ? (
            <>
              {styleSample && (
                <figure className="creation-style-sample">
                  <img
                    src={dataUrl(styleSample.pngBytes)}
                    alt={`${PROFILE_LABELS[session.profile]} representative style sample`}
                    width={styleSample.width}
                    height={styleSample.height}
                  />
                  <figcaption>
                    <strong>Intent preview · not the final exported artwork</strong>
                    <span>
                      320×180 · {styleSample.metrics.distinctColorBuckets} color buckets · review traversal,
                      depth, landmark contrast and character scale. Its digest is carried into generation; review the
                      real pack preview again after your references and complete assets are generated.
                    </span>
                  </figcaption>
                </figure>
              )}
              {currentFactKeys.map((fact) => (
                <label key={fact}>
                  <span>{FACT_PROMPTS[fact]}</span>
                  <textarea
                    rows={3}
                    maxLength={FACT_MAX_LENGTH[fact]}
                    value={facts[fact]}
                    onChange={(event) => setFacts((current) => ({
                      ...current,
                      [fact]: event.target.value,
                    }))}
                  />
                </label>
              ))}
              {session.stage === 'style-sample' && (
                <label>
                  Approval notes
                  <textarea rows={4} maxLength={1000} value={reply} onChange={(event) => setReply(event.target.value)} />
                </label>
              )}
              <p className="creation-output-note">{descriptor.output}</p>
              <button className="primary-action" type="button" disabled={busy || !canConfirm} onClick={() => void confirmCurrentStage()}>
                <span>{busy ? 'Saving checkpoint…' : descriptor.confirmation}</span><span>→</span>
              </button>
            </>
          ) : (
            <div className="creation-handoff">
              <strong>The four creative decisions are confirmed.</strong>
              <p>
                {capability.completeAssetProvider
                  ? 'Continue to the complete pack generator. The confirmed intent preview and checkpoint hashes will be bound to the real exported preview and asset revision.'
                  : 'This profile can be planned and visually sampled, but complete pack generation and playtest remain capability-gated.'}
              </p>
              {capability.completeAssetProvider && <a href="#reference-generator">Continue to asset generation ↓</a>}
            </div>
          )}
          <p className={session.phase === 'blocked' ? 'creation-notice is-blocked' : 'creation-notice'} aria-live="polite">{notice}</p>
        </div>
      </div>
    </section>
  );
}
