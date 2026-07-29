import { describe, expect, it } from 'vitest';

import type { WorldAssetProfile } from './asset-profile';
import {
  WorldCreationError,
  createWorldCreationSession,
  reduceWorldCreationSession,
  type WorldCreationSession,
  type WorldCreationStage,
} from './world-creation-session';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

function confirm(
  session: WorldCreationSession,
  stage: WorldCreationStage,
  suffix: string,
): WorldCreationSession {
  return reduceWorldCreationSession(session, {
    type: 'confirm-stage',
    expectedRevision: session.revision,
    stage,
    checkpointId: `${suffix}-checkpoint`,
    snapshotSha256: DIGEST_A,
    artifactIds: [`${suffix}-preview`],
  });
}

function confirmDialogue(profile: WorldAssetProfile): WorldCreationSession {
  let session = createWorldCreationSession({ id: `${profile}-session`, profile });
  session = confirm(session, 'world-brief', 'brief');
  session = confirm(session, 'art-direction', 'art');
  session = confirm(session, 'map-layout', 'layout');
  return confirm(session, 'style-sample', 'sample');
}

function freezeCompleteAssets(session: WorldCreationSession): WorldCreationSession {
  let current = reduceWorldCreationSession(session, {
    type: 'start-asset-generation',
    expectedRevision: session.revision,
    assetRevisionId: 'asset-revision-one',
  });
  current = reduceWorldCreationSession(current, {
    type: 'complete-asset-generation',
    expectedRevision: current.revision,
    assetRevisionId: 'asset-revision-one',
    requestFingerprintSha256: DIGEST_A,
    manifestSha256: DIGEST_B,
    packSha256: DIGEST_C,
    qaPassed: true,
  });
  return reduceWorldCreationSession(current, {
    type: 'freeze-assets',
    expectedRevision: current.revision,
    assetRevisionId: 'asset-revision-one',
    freezeId: 'asset-freeze-one',
  });
}

describe('world creation session reducer', () => {
  it('runs the confirmed farm dialogue through immutable assets, Godot build, and playtest', () => {
    let session = confirmDialogue('topdown-farm');
    expect(session).toMatchObject({
      revision: 4,
      stage: 'asset-generation',
      phase: 'awaiting-user',
    });
    expect(session.checkpoints.map(({ stage }) => stage)).toEqual([
      'world-brief',
      'art-direction',
      'map-layout',
      'style-sample',
    ]);

    session = freezeCompleteAssets(session);
    expect(session).toMatchObject({
      stage: 'godot-map',
      phase: 'awaiting-user',
      activeAssetFreezeId: 'asset-freeze-one',
    });
    expect(session.assetRevisions[0]).toMatchObject({ status: 'frozen' });
    expect(session.assetFreezes[0]).toEqual({
      id: 'asset-freeze-one',
      assetRevisionId: 'asset-revision-one',
      profile: 'topdown-farm',
      requestFingerprintSha256: DIGEST_A,
      manifestSha256: DIGEST_B,
      packSha256: DIGEST_C,
      sourceCheckpointIds: [
        'brief-checkpoint',
        'art-checkpoint',
        'layout-checkpoint',
        'sample-checkpoint',
      ],
    });
    expect(Object.isFrozen(session.assetFreezes[0])).toBe(true);
    expect(() => reduceWorldCreationSession(session, {
      type: 'freeze-assets',
      expectedRevision: session.revision,
      assetRevisionId: 'asset-revision-one',
      freezeId: 'replacement-freeze',
    })).toThrowError(expect.objectContaining({ code: 'creation.immutable-assets' }));

    session = reduceWorldCreationSession(session, {
      type: 'start-godot-build',
      expectedRevision: session.revision,
      mapRevisionId: 'map-revision-one',
      target: 'raspberry-pi-4b',
    });
    expect(session.mapRevisions[0]).toMatchObject({
      assetFreezeId: 'asset-freeze-one',
      status: 'building',
      target: 'raspberry-pi-4b',
    });

    session = reduceWorldCreationSession(session, {
      type: 'complete-godot-build',
      expectedRevision: session.revision,
      mapRevisionId: 'map-revision-one',
      importResult: 'created',
      scenePath: 'res://mapsoo_imports/world/world.tscn',
      smokePassed: true,
      logArtifactId: 'godot-smoke-log',
    });
    expect(session).toMatchObject({ stage: 'godot-map', phase: 'awaiting-confirmation' });
    expect(session.mapRevisions[0]).toMatchObject({
      status: 'ready',
      importResult: 'created',
      smokePassed: true,
    });

    session = confirm(session, 'godot-map', 'godot-map');
    expect(session).toMatchObject({
      stage: 'playtest',
      phase: 'awaiting-user',
      playtest: { mapRevisionId: 'map-revision-one', status: 'ready' },
    });

    session = reduceWorldCreationSession(session, {
      type: 'start-playtest',
      expectedRevision: session.revision,
      endpoint: 'http://raspberry-pi.local:8080',
    });
    expect(session).toMatchObject({
      phase: 'running',
      playtest: { status: 'running', endpoint: 'http://raspberry-pi.local:8080' },
    });

    session = reduceWorldCreationSession(session, {
      type: 'stop-playtest',
      expectedRevision: session.revision,
    });
    expect(session).toMatchObject({ phase: 'awaiting-user', playtest: { status: 'stopped' } });
    expect(session.history).toHaveLength(session.revision);
    expect(Object.isFrozen(session)).toBe(true);
  });

  it('rejects stale commands without changing the prior immutable session', () => {
    const initial = createWorldCreationSession({ id: 'concurrency-session', profile: 'side-platformer' });
    const command = {
      type: 'confirm-stage' as const,
      expectedRevision: 0,
      stage: 'world-brief' as const,
      checkpointId: 'brief-checkpoint',
      snapshotSha256: DIGEST_A,
    };
    const confirmed = reduceWorldCreationSession(initial, command);

    expect(() => reduceWorldCreationSession(confirmed, command)).toThrowError(
      expect.objectContaining({ code: 'creation.stale-revision' }),
    );
    expect(initial).toMatchObject({ revision: 0, stage: 'world-brief', checkpoints: [] });
    expect(confirmed).toMatchObject({ revision: 1, stage: 'art-direction' });
  });

  it('returns to an earlier round without mutating or silently reusing a frozen asset set', () => {
    let session = freezeCompleteAssets(confirmDialogue('side-platformer'));
    const frozenSnapshot = session.assetFreezes[0];
    session = reduceWorldCreationSession(session, {
      type: 'start-godot-build',
      expectedRevision: session.revision,
      mapRevisionId: 'old-map-revision',
      target: 'desktop',
    });
    session = reduceWorldCreationSession(session, {
      type: 'complete-godot-build',
      expectedRevision: session.revision,
      mapRevisionId: 'old-map-revision',
      importResult: 'unchanged',
      scenePath: 'res://mapsoo_imports/old/world.tscn',
      smokePassed: true,
      logArtifactId: 'old-smoke-log',
    });
    session = confirm(session, 'godot-map', 'old-map');

    session = reduceWorldCreationSession(session, {
      type: 'back-to-stage',
      expectedRevision: session.revision,
      stage: 'art-direction',
    });

    expect(session).toMatchObject({
      stage: 'art-direction',
      phase: 'awaiting-user',
      activeAssetFreezeId: undefined,
      activeMapRevisionId: undefined,
    });
    expect(session.checkpoints.map(({ stage }) => stage)).toEqual(['world-brief']);
    expect(session.assetFreezes[0]).toBe(frozenSnapshot);
    expect(session.assetFreezes[0].packSha256).toBe(DIGEST_C);
    expect(session.assetRevisions[0].status).toBe('frozen');
    expect(session.mapRevisions[0].status).toBe('superseded');
  });

  it('requires stopping a running playtest before returning to revise the world', () => {
    let session = freezeCompleteAssets(confirmDialogue('topdown-farm'));
    session = reduceWorldCreationSession(session, {
      type: 'start-godot-build',
      expectedRevision: session.revision,
      mapRevisionId: 'play-map',
      target: 'desktop',
    });
    session = reduceWorldCreationSession(session, {
      type: 'complete-godot-build',
      expectedRevision: session.revision,
      mapRevisionId: 'play-map',
      importResult: 'updated',
      scenePath: 'res://mapsoo_imports/play/world.tscn',
      smokePassed: true,
      logArtifactId: 'play-smoke-log',
    });
    session = confirm(session, 'godot-map', 'play-map');
    session = reduceWorldCreationSession(session, {
      type: 'start-playtest',
      expectedRevision: session.revision,
    });

    expect(() => reduceWorldCreationSession(session, {
      type: 'back-to-stage',
      expectedRevision: session.revision,
      stage: 'map-layout',
    })).toThrow(/Stop the running playtest/);
  });

  it.each(['topdown-farm', 'side-platformer', 'isometric-action', 'layered-depth-2d'] as const)(
    'allows implemented %s profiles to enter complete asset generation',
    (profile) => {
      const session = confirmDialogue(profile);
      const generating = reduceWorldCreationSession(session, {
        type: 'start-asset-generation',
        expectedRevision: session.revision,
        assetRevisionId: 'supported-assets',
      });
      expect(generating).toMatchObject({
        stage: 'asset-generation',
        phase: 'working',
        activeAssetRevisionId: 'supported-assets',
      });
    },
  );

  it('never freezes a failed-QA asset revision and supersedes a retried draft', () => {
    let session = confirmDialogue('side-platformer');
    session = reduceWorldCreationSession(session, {
      type: 'start-asset-generation',
      expectedRevision: session.revision,
      assetRevisionId: 'failed-assets',
    });
    session = reduceWorldCreationSession(session, {
      type: 'complete-asset-generation',
      expectedRevision: session.revision,
      assetRevisionId: 'failed-assets',
      requestFingerprintSha256: DIGEST_A,
      manifestSha256: DIGEST_B,
      packSha256: DIGEST_C,
      qaPassed: false,
      qaIssues: ['Foreground hides the player spawn.'],
    });
    expect(session.assetRevisions[0]).toMatchObject({ status: 'qa-failed' });
    expect(() => reduceWorldCreationSession(session, {
      type: 'freeze-assets',
      expectedRevision: session.revision,
      assetRevisionId: 'failed-assets',
      freezeId: 'bad-freeze',
    })).toThrowError(expect.objectContaining({ code: 'creation.invalid-transition' }));

    session = reduceWorldCreationSession(session, {
      type: 'start-asset-generation',
      expectedRevision: session.revision,
      assetRevisionId: 'retry-assets',
    });
    expect(session.assetRevisions).toMatchObject([
      { id: 'failed-assets', status: 'superseded' },
      { id: 'retry-assets', status: 'generating' },
    ]);
  });

  it('reports importer conflicts as failed map builds that cannot enter playtest', () => {
    let session = freezeCompleteAssets(confirmDialogue('topdown-farm'));
    session = reduceWorldCreationSession(session, {
      type: 'start-godot-build',
      expectedRevision: session.revision,
      mapRevisionId: 'conflict-map',
      target: 'desktop',
    });
    session = reduceWorldCreationSession(session, {
      type: 'complete-godot-build',
      expectedRevision: session.revision,
      mapRevisionId: 'conflict-map',
      importResult: 'conflict',
      scenePath: 'res://mapsoo_imports/conflict/world.tscn',
      smokePassed: false,
      logArtifactId: 'conflict-log',
    });

    expect(session).toMatchObject({ stage: 'godot-map', phase: 'failed' });
    expect(session.mapRevisions[0]).toMatchObject({ status: 'conflict', importResult: 'conflict' });
    expect(() => confirm(session, 'godot-map', 'conflict-map')).toThrow(/must pass import and smoke/);
  });

  it('allows profile changes only after returning to the unconfirmed world brief', () => {
    let session = createWorldCreationSession({ id: 'profile-change', profile: 'topdown-farm' });
    session = reduceWorldCreationSession(session, {
      type: 'change-profile',
      expectedRevision: session.revision,
      profile: 'side-platformer',
    });
    expect(session.profile).toBe('side-platformer');
    session = confirm(session, 'world-brief', 'profile-brief');
    expect(() => reduceWorldCreationSession(session, {
      type: 'change-profile',
      expectedRevision: session.revision,
      profile: 'topdown-farm',
    })).toThrowError(WorldCreationError);
  });
});
