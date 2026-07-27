import { useMemo, useState } from 'react';

import type { WorldAssetProfile } from '../../core/asset-profile';
import { renderProfileReferenceScene } from '../../adapters/canvas/render-profile-reference-scene';
import {
  CONFIRMED_DIALOGUE_STAGES,
  type ConfirmedDialogueCheckpoint,
} from '../../core/confirmed-generation-binding';
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

const STARTER_REPLIES: Readonly<Partial<Record<WorldCreationStage, string>>> = Object.freeze({
  'world-brief': 'A hopeful riverside settlement where a young courier reconnects isolated neighborhoods.',
  'art-direction': 'Warm hand-painted pixels, soft morning light, readable silhouettes, teal water and amber landmarks.',
  'map-layout': 'Spawn at the old ferry, follow one main route through two landmarks, then reach the hilltop gate.',
  'style-sample': 'Keep the palette and character scale. Increase the exit landmark contrast before full generation.',
});

export interface WorldCreationAssetHandoff {
  readonly profile: WorldAssetProfile;
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
  answers: Partial<Record<WorldCreationStage, string>>,
) {
  return renderProfileReferenceScene(profile, JSON.stringify({
    profile,
    worldBrief: answers['world-brief'] ?? '',
    artDirection: answers['art-direction'] ?? '',
    mapLayout: answers['map-layout'] ?? '',
  }));
}

function checkpointPrefix(stage: WorldCreationStage): string {
  return stage.replace('world-', '').replace('art-direction', 'art').replace('map-layout', 'layout').replace('style-sample', 'sample');
}

export function WorldCreationDialogue({ onReadyForAssets }: WorldCreationDialogueProps) {
  const [session, setSession] = useState(() => createWorldCreationSession({
    id: 'browser-world-session',
    profile: 'topdown-farm',
  }));
  const [reply, setReply] = useState(STARTER_REPLIES['world-brief'] ?? '');
  const [answers, setAnswers] = useState<Partial<Record<WorldCreationStage, string>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Answer one question at a time. Nothing is frozen until you explicitly approve it.');
  const descriptor = WORLD_CREATION_STAGE_DESCRIPTORS[session.stage];
  const dialogueStage = WORLD_CREATION_STAGES.indexOf(session.stage) <= WORLD_CREATION_STAGES.indexOf('style-sample');
  const completedStages = useMemo(() => new Set(session.checkpoints.map(({ stage }) => stage)), [session.checkpoints]);
  const styleSample = useMemo(
    () => session.stage === 'style-sample' ? buildWorldCreationStyleSample(session.profile, answers) : null,
    [session.stage, session.profile, answers],
  );

  async function confirmCurrentStage() {
    if (!dialogueStage || !reply.trim()) return;
    setBusy(true);
    try {
      const normalized = reply.trim();
      const visualSampleSha256 = session.stage === 'style-sample' && styleSample
        ? await sha256Bytes(styleSample.pngBytes)
        : undefined;
      const snapshotSha256 = await sha256(JSON.stringify({
        profile: session.profile,
        stage: session.stage,
        answer: normalized,
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
      setSession(next);
      setReply(STARTER_REPLIES[next.stage] ?? '');
      if (next.stage === 'asset-generation' && next.phase !== 'blocked') {
        if (!visualSampleSha256) throw new Error('The approved intent preview digest is missing.');
        const description = [
          `World: ${nextAnswers['world-brief'] ?? ''}`,
          `Art direction: ${nextAnswers['art-direction'] ?? ''}`,
          `Layout: ${nextAnswers['map-layout'] ?? ''}`,
          `Approved sample notes: ${nextAnswers['style-sample'] ?? ''}`,
        ].join('\n').slice(0, 2000);
        const checkpoints = CONFIRMED_DIALOGUE_STAGES.map((stage) => {
          const checkpoint = next.checkpoints.find((candidate) => candidate.stage === stage);
          if (!checkpoint) throw new Error(`Missing confirmed ${stage} checkpoint.`);
          return Object.freeze({ stage, snapshotSha256: checkpoint.snapshotSha256 });
        });
        onReadyForAssets?.({
          profile: next.profile as WorldCreationAssetHandoff['profile'],
          description,
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
      setReply(answers[stage] ?? STARTER_REPLIES[stage] ?? '');
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
            <label>
              World profile
              <select value={session.profile} onChange={(event) => changeProfile(event.target.value as WorldAssetProfile)}>
                {Object.entries(PROFILE_LABELS).map(([profile, label]) => (
                  <option key={profile} value={profile}>{label}</option>
                ))}
              </select>
            </label>
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
              <label>
                Your answer
                <textarea rows={5} maxLength={2000} value={reply} onChange={(event) => setReply(event.target.value)} />
              </label>
              <p className="creation-output-note">{descriptor.output}</p>
              <button className="primary-action" type="button" disabled={busy || !reply.trim()} onClick={() => void confirmCurrentStage()}>
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
