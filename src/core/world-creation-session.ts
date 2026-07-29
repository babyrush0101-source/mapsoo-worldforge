import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  canEnterWorldCreationStage,
  nextWorldCreationStage,
  type WorldCreationStage,
} from './world-creation-flow';

export type { WorldCreationStage } from './world-creation-flow';

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

export const WORLD_CREATION_SESSION_SCHEMA_VERSION = '0.1.0' as const;

export type WorldCreationPhase =
  | 'awaiting-user'
  | 'working'
  | 'awaiting-confirmation'
  | 'blocked'
  | 'failed'
  | 'running';

export interface WorldCreationCheckpoint {
  readonly id: string;
  readonly stage: WorldCreationStage;
  readonly sessionRevision: number;
  readonly snapshotSha256: string;
  readonly artifactIds: readonly string[];
}

export type AssetRevisionStatus =
  | 'generating'
  | 'awaiting-approval'
  | 'qa-failed'
  | 'failed'
  | 'frozen'
  | 'superseded';

export interface WorldAssetRevision {
  readonly id: string;
  readonly number: number;
  readonly profile: WorldAssetProfile;
  readonly status: AssetRevisionStatus;
  readonly requestFingerprintSha256?: string;
  readonly manifestSha256?: string;
  readonly packSha256?: string;
  readonly qaIssues: readonly string[];
  readonly failure?: Readonly<{ code: string; message: string }>;
}

export interface WorldAssetFreeze {
  readonly id: string;
  readonly assetRevisionId: string;
  readonly profile: WorldAssetProfile;
  readonly requestFingerprintSha256: string;
  readonly manifestSha256: string;
  readonly packSha256: string;
  readonly sourceCheckpointIds: readonly string[];
}

export type GodotImportResult = 'created' | 'unchanged' | 'updated' | 'conflict';
export type GodotMapBuildStatus =
  | 'building'
  | 'ready'
  | 'conflict'
  | 'failed'
  | 'superseded';

export interface GodotMapRevision {
  readonly id: string;
  readonly number: number;
  readonly profile: WorldAssetProfile;
  readonly assetFreezeId: string;
  readonly target: 'desktop' | 'raspberry-pi-4b' | 'web';
  readonly status: GodotMapBuildStatus;
  readonly importResult?: GodotImportResult;
  readonly scenePath?: string;
  readonly smokePassed?: boolean;
  readonly logArtifactId?: string;
  readonly failure?: Readonly<{ code: string; message: string }>;
}

export type PlaytestStatus = 'ready' | 'running' | 'stopped' | 'crashed';

export interface WorldPlaytest {
  readonly mapRevisionId: string;
  readonly status: PlaytestStatus;
  readonly endpoint?: string;
  readonly failure?: Readonly<{ code: string; message: string }>;
}

export interface WorldCreationEvent {
  readonly revision: number;
  readonly command: WorldCreationCommand['type'];
  readonly resultingStage: WorldCreationStage;
}

export interface WorldCreationSession {
  readonly schemaVersion: typeof WORLD_CREATION_SESSION_SCHEMA_VERSION;
  readonly id: string;
  readonly profile: WorldAssetProfile;
  readonly revision: number;
  readonly stage: WorldCreationStage;
  readonly phase: WorldCreationPhase;
  readonly checkpoints: readonly WorldCreationCheckpoint[];
  readonly assetRevisions: readonly WorldAssetRevision[];
  readonly assetFreezes: readonly WorldAssetFreeze[];
  readonly activeAssetRevisionId?: string;
  readonly activeAssetFreezeId?: string;
  readonly mapRevisions: readonly GodotMapRevision[];
  readonly activeMapRevisionId?: string;
  readonly playtest?: WorldPlaytest;
  readonly history: readonly WorldCreationEvent[];
  readonly blockedReason?: string;
}

interface RevisionCommand {
  readonly expectedRevision: number;
}

export type WorldCreationCommand =
  | (RevisionCommand & {
      readonly type: 'change-profile';
      readonly profile: WorldAssetProfile;
    })
  | (RevisionCommand & {
      readonly type: 'confirm-stage';
      readonly stage: WorldCreationStage;
      readonly checkpointId: string;
      readonly snapshotSha256: string;
      readonly artifactIds?: readonly string[];
    })
  | (RevisionCommand & {
      readonly type: 'back-to-stage';
      readonly stage: WorldCreationStage;
    })
  | (RevisionCommand & {
      readonly type: 'start-asset-generation';
      readonly assetRevisionId: string;
    })
  | (RevisionCommand & {
      readonly type: 'complete-asset-generation';
      readonly assetRevisionId: string;
      readonly requestFingerprintSha256: string;
      readonly manifestSha256: string;
      readonly packSha256: string;
      readonly qaPassed: boolean;
      readonly qaIssues?: readonly string[];
    })
  | (RevisionCommand & {
      readonly type: 'fail-asset-generation';
      readonly assetRevisionId: string;
      readonly code: string;
      readonly message: string;
    })
  | (RevisionCommand & {
      readonly type: 'freeze-assets';
      readonly assetRevisionId: string;
      readonly freezeId: string;
    })
  | (RevisionCommand & {
      readonly type: 'start-godot-build';
      readonly mapRevisionId: string;
      readonly target: GodotMapRevision['target'];
    })
  | (RevisionCommand & {
      readonly type: 'complete-godot-build';
      readonly mapRevisionId: string;
      readonly importResult: GodotImportResult;
      readonly scenePath: string;
      readonly smokePassed: boolean;
      readonly logArtifactId: string;
    })
  | (RevisionCommand & {
      readonly type: 'fail-godot-build';
      readonly mapRevisionId: string;
      readonly code: string;
      readonly message: string;
    })
  | (RevisionCommand & {
      readonly type: 'start-playtest';
      readonly endpoint?: string;
    })
  | (RevisionCommand & {
      readonly type: 'stop-playtest';
    })
  | (RevisionCommand & {
      readonly type: 'crash-playtest';
      readonly code: string;
      readonly message: string;
    });

export type WorldCreationErrorCode =
  | 'creation.invalid-input'
  | 'creation.stale-revision'
  | 'creation.invalid-transition'
  | 'creation.capability-blocked'
  | 'creation.immutable-assets';

export class WorldCreationError extends Error {
  constructor(readonly code: WorldCreationErrorCode, message: string) {
    super(message);
    this.name = 'WorldCreationError';
  }
}

function fail(code: WorldCreationErrorCode, message: string): never {
  throw new WorldCreationError(code, message);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function safeId(value: string, label: string): void {
  if (!SAFE_ID.test(value) || value.length > 100) {
    fail('creation.invalid-input', `${label} must be lowercase kebab-case.`);
  }
}

function digest(value: string, label: string): void {
  if (!SHA256.test(value)) fail('creation.invalid-input', `${label} must be a lowercase SHA-256 digest.`);
}

function message(value: string, label: string): void {
  if (value.trim() !== value || value.length < 1 || value.length > 500) {
    fail('creation.invalid-input', `${label} is invalid.`);
  }
}

function stageIndex(stage: WorldCreationStage): number {
  const stages: readonly WorldCreationStage[] = [
    'world-brief',
    'art-direction',
    'map-layout',
    'style-sample',
    'asset-generation',
    'godot-map',
    'playtest',
  ];
  return stages.indexOf(stage);
}

function commit(
  session: WorldCreationSession,
  command: WorldCreationCommand['type'],
  patch: Partial<WorldCreationSession>,
): WorldCreationSession {
  const revision = session.revision + 1;
  const resultingStage = patch.stage ?? session.stage;
  return deepFreeze({
    ...session,
    ...patch,
    revision,
    history: [
      ...session.history,
      { revision, command, resultingStage },
    ],
  });
}

function requireCapability(profile: WorldAssetProfile, stage: WorldCreationStage): void {
  if (!canEnterWorldCreationStage(profile, stage)) {
    fail(
      'creation.capability-blocked',
      `${profile} cannot enter ${stage} until its provider, importer, or interactive runtime is available.`,
    );
  }
}

function activeAsset(session: WorldCreationSession, id?: string): WorldAssetRevision {
  const wanted = id ?? session.activeAssetRevisionId;
  const asset = session.assetRevisions.find((candidate) => candidate.id === wanted);
  if (!asset) fail('creation.invalid-transition', 'The active asset revision does not exist.');
  return asset;
}

function activeMap(session: WorldCreationSession, id?: string): GodotMapRevision {
  const wanted = id ?? session.activeMapRevisionId;
  const map = session.mapRevisions.find((candidate) => candidate.id === wanted);
  if (!map) fail('creation.invalid-transition', 'The active Godot map revision does not exist.');
  return map;
}

function replaceAsset(
  revisions: readonly WorldAssetRevision[],
  id: string,
  replacement: WorldAssetRevision,
): readonly WorldAssetRevision[] {
  return revisions.map((revision) => revision.id === id ? replacement : revision);
}

function replaceMap(
  revisions: readonly GodotMapRevision[],
  id: string,
  replacement: GodotMapRevision,
): readonly GodotMapRevision[] {
  return revisions.map((revision) => revision.id === id ? replacement : revision);
}

export function createWorldCreationSession(input: {
  readonly id: string;
  readonly profile: WorldAssetProfile;
}): WorldCreationSession {
  safeId(input.id, 'World creation session id');
  if (!isWorldAssetProfile(input.profile)) fail('creation.invalid-input', 'World asset profile is unsupported.');
  return deepFreeze({
    schemaVersion: WORLD_CREATION_SESSION_SCHEMA_VERSION,
    id: input.id,
    profile: input.profile,
    revision: 0,
    stage: 'world-brief',
    phase: 'awaiting-user',
    checkpoints: [],
    assetRevisions: [],
    assetFreezes: [],
    mapRevisions: [],
    history: [],
  });
}

export function reduceWorldCreationSession(
  session: WorldCreationSession,
  command: WorldCreationCommand,
): WorldCreationSession {
  if (command.expectedRevision !== session.revision) {
    fail(
      'creation.stale-revision',
      `Expected session revision ${session.revision}, received ${command.expectedRevision}.`,
    );
  }

  switch (command.type) {
    case 'change-profile': {
      if (session.stage !== 'world-brief' || session.checkpoints.some(({ stage }) => stage === 'world-brief')) {
        fail('creation.invalid-transition', 'The profile can change only while the world brief is unconfirmed.');
      }
      if (!isWorldAssetProfile(command.profile)) fail('creation.invalid-input', 'World asset profile is unsupported.');
      return commit(session, command.type, { profile: command.profile });
    }

    case 'confirm-stage': {
      if (command.stage !== session.stage) {
        fail('creation.invalid-transition', `Cannot confirm ${command.stage} while editing ${session.stage}.`);
      }
      if (['asset-generation', 'playtest'].includes(command.stage)) {
        fail('creation.invalid-transition', `${command.stage} uses its explicit freeze or launch command.`);
      }
      if (session.phase === 'working' || session.phase === 'running') {
        fail('creation.invalid-transition', `Cannot confirm ${command.stage} while work is in progress.`);
      }
      if (command.stage === 'godot-map' && activeMap(session).status !== 'ready') {
        fail('creation.invalid-transition', 'The Godot map must pass import and smoke testing before confirmation.');
      }
      safeId(command.checkpointId, 'Checkpoint id');
      digest(command.snapshotSha256, 'Checkpoint snapshot');
      if (session.checkpoints.some(({ id }) => id === command.checkpointId)) {
        fail('creation.invalid-input', 'Checkpoint ids must be unique.');
      }
      const artifactIds = [...(command.artifactIds ?? [])];
      artifactIds.forEach((id) => safeId(id, 'Checkpoint artifact id'));
      const checkpoint: WorldCreationCheckpoint = {
        id: command.checkpointId,
        stage: command.stage,
        sessionRevision: session.revision + 1,
        snapshotSha256: command.snapshotSha256,
        artifactIds,
      };
      const next = nextWorldCreationStage(command.stage);
      if (!next) fail('creation.invalid-transition', 'The final stage has no confirmation transition.');
      if (!canEnterWorldCreationStage(session.profile, next)) {
        return commit(session, command.type, {
          phase: 'blocked',
          checkpoints: [...session.checkpoints, checkpoint],
          blockedReason: `${session.profile} does not yet support ${next}.`,
        });
      }
      return commit(session, command.type, {
        stage: next,
        phase: 'awaiting-user',
        checkpoints: [...session.checkpoints, checkpoint],
        blockedReason: undefined,
        ...(next === 'playtest' ? {
          playtest: { mapRevisionId: activeMap(session).id, status: 'ready' as const },
        } : {}),
      });
    }

    case 'back-to-stage': {
      if (session.playtest?.status === 'running') {
        fail('creation.invalid-transition', 'Stop the running playtest before returning to an earlier stage.');
      }
      if (stageIndex(command.stage) >= stageIndex(session.stage)) {
        fail('creation.invalid-transition', 'Back navigation must target an earlier stage.');
      }
      const preserveFreeze = command.stage === 'godot-map';
      const maps = session.mapRevisions.map((map) => (
        map.status === 'superseded' ? map : { ...map, status: 'superseded' as const }
      ));
      const assets = session.assetRevisions.map((asset) => (
        asset.status === 'frozen' || asset.status === 'superseded'
          ? asset
          : { ...asset, status: 'superseded' as const }
      ));
      return commit(session, command.type, {
        stage: command.stage,
        phase: 'awaiting-user',
        checkpoints: session.checkpoints.filter(({ stage }) => stageIndex(stage) < stageIndex(command.stage)),
        assetRevisions: assets,
        activeAssetRevisionId: undefined,
        activeAssetFreezeId: preserveFreeze ? session.activeAssetFreezeId : undefined,
        mapRevisions: maps,
        activeMapRevisionId: undefined,
        playtest: undefined,
        blockedReason: undefined,
      });
    }

    case 'start-asset-generation': {
      if (session.stage !== 'asset-generation') {
        if (session.stage === 'style-sample' && session.phase === 'blocked') {
          requireCapability(session.profile, 'asset-generation');
        }
        fail('creation.invalid-transition', 'Complete assets can start only after the style sample is confirmed.');
      }
      requireCapability(session.profile, 'asset-generation');
      safeId(command.assetRevisionId, 'Asset revision id');
      if (session.assetRevisions.some(({ id }) => id === command.assetRevisionId)) {
        fail('creation.invalid-input', 'Asset revision ids must be unique.');
      }
      if (session.assetRevisions.some(({ status }) => status === 'generating')) {
        fail('creation.invalid-transition', 'Another asset revision is still generating.');
      }
      const superseded = session.assetRevisions.map((asset) => (
        asset.status === 'frozen' || asset.status === 'superseded'
          ? asset
          : { ...asset, status: 'superseded' as const }
      ));
      const asset: WorldAssetRevision = {
        id: command.assetRevisionId,
        number: session.assetRevisions.length + 1,
        profile: session.profile,
        status: 'generating',
        qaIssues: [],
      };
      return commit(session, command.type, {
        phase: 'working',
        assetRevisions: [...superseded, asset],
        activeAssetRevisionId: asset.id,
      });
    }

    case 'complete-asset-generation': {
      const asset = activeAsset(session, command.assetRevisionId);
      if (asset.status === 'frozen') {
        fail('creation.immutable-assets', 'A frozen asset revision cannot be completed again.');
      }
      if (session.stage !== 'asset-generation' || asset.status !== 'generating') {
        fail('creation.invalid-transition', 'Only the generating asset revision can complete.');
      }
      digest(command.requestFingerprintSha256, 'Request fingerprint');
      digest(command.manifestSha256, 'Asset manifest');
      digest(command.packSha256, 'Asset pack');
      const qaIssues = [...(command.qaIssues ?? [])];
      qaIssues.forEach((issue) => message(issue, 'Asset QA issue'));
      if (command.qaPassed && qaIssues.length > 0) {
        fail('creation.invalid-input', 'A passing asset revision cannot contain QA issues.');
      }
      const completed: WorldAssetRevision = {
        ...asset,
        status: command.qaPassed ? 'awaiting-approval' : 'qa-failed',
        requestFingerprintSha256: command.requestFingerprintSha256,
        manifestSha256: command.manifestSha256,
        packSha256: command.packSha256,
        qaIssues,
      };
      return commit(session, command.type, {
        phase: command.qaPassed ? 'awaiting-confirmation' : 'failed',
        assetRevisions: replaceAsset(session.assetRevisions, asset.id, completed),
      });
    }

    case 'fail-asset-generation': {
      const asset = activeAsset(session, command.assetRevisionId);
      if (asset.status === 'frozen') {
        fail('creation.immutable-assets', 'A frozen asset revision cannot be changed to failed.');
      }
      if (session.stage !== 'asset-generation' || asset.status !== 'generating') {
        fail('creation.invalid-transition', 'Only the generating asset revision can fail.');
      }
      message(command.code, 'Asset failure code');
      message(command.message, 'Asset failure message');
      return commit(session, command.type, {
        phase: 'failed',
        assetRevisions: replaceAsset(session.assetRevisions, asset.id, {
          ...asset,
          status: 'failed',
          failure: { code: command.code, message: command.message },
        }),
      });
    }

    case 'freeze-assets': {
      const asset = activeAsset(session, command.assetRevisionId);
      if (asset.status === 'frozen') {
        fail('creation.immutable-assets', 'A frozen asset revision cannot be frozen or replaced in place.');
      }
      if (session.stage !== 'asset-generation' || asset.status !== 'awaiting-approval') {
        fail('creation.invalid-transition', 'Only a QA-passing asset revision can be frozen.');
      }
      if (!asset.requestFingerprintSha256 || !asset.manifestSha256 || !asset.packSha256) {
        fail('creation.invalid-transition', 'The asset revision is missing immutable integrity metadata.');
      }
      safeId(command.freezeId, 'Asset freeze id');
      if (session.assetFreezes.some(({ id }) => id === command.freezeId)) {
        fail('creation.invalid-input', 'Asset freeze ids must be unique.');
      }
      const sourceCheckpointIds = session.checkpoints
        .filter(({ stage }) => stageIndex(stage) <= stageIndex('style-sample'))
        .map(({ id }) => id);
      if (sourceCheckpointIds.length !== 4) {
        fail('creation.invalid-transition', 'All four dialogue checkpoints are required before assets can freeze.');
      }
      const freeze: WorldAssetFreeze = {
        id: command.freezeId,
        assetRevisionId: asset.id,
        profile: session.profile,
        requestFingerprintSha256: asset.requestFingerprintSha256,
        manifestSha256: asset.manifestSha256,
        packSha256: asset.packSha256,
        sourceCheckpointIds,
      };
      return commit(session, command.type, {
        stage: 'godot-map',
        phase: 'awaiting-user',
        assetRevisions: replaceAsset(session.assetRevisions, asset.id, { ...asset, status: 'frozen' }),
        assetFreezes: [...session.assetFreezes, freeze],
        activeAssetFreezeId: freeze.id,
      });
    }

    case 'start-godot-build': {
      if (session.stage !== 'godot-map' || !session.activeAssetFreezeId) {
        fail('creation.invalid-transition', 'A frozen asset revision is required before building a Godot map.');
      }
      requireCapability(session.profile, 'godot-map');
      safeId(command.mapRevisionId, 'Godot map revision id');
      if (session.mapRevisions.some(({ id }) => id === command.mapRevisionId)) {
        fail('creation.invalid-input', 'Godot map revision ids must be unique.');
      }
      if (session.mapRevisions.some(({ status }) => status === 'building')) {
        fail('creation.invalid-transition', 'Another Godot map revision is still building.');
      }
      const maps = session.mapRevisions.map((map) => (
        map.status === 'superseded' ? map : { ...map, status: 'superseded' as const }
      ));
      const map: GodotMapRevision = {
        id: command.mapRevisionId,
        number: session.mapRevisions.length + 1,
        profile: session.profile,
        assetFreezeId: session.activeAssetFreezeId,
        target: command.target,
        status: 'building',
      };
      return commit(session, command.type, {
        phase: 'working',
        mapRevisions: [...maps, map],
        activeMapRevisionId: map.id,
        playtest: undefined,
      });
    }

    case 'complete-godot-build': {
      const map = activeMap(session, command.mapRevisionId);
      if (session.stage !== 'godot-map' || map.status !== 'building') {
        fail('creation.invalid-transition', 'Only the building Godot map revision can complete.');
      }
      message(command.scenePath, 'Godot scene path');
      safeId(command.logArtifactId, 'Godot log artifact id');
      const ready = command.importResult !== 'conflict' && command.smokePassed;
      const completed: GodotMapRevision = {
        ...map,
        status: command.importResult === 'conflict' ? 'conflict' : ready ? 'ready' : 'failed',
        importResult: command.importResult,
        scenePath: command.scenePath,
        smokePassed: command.smokePassed,
        logArtifactId: command.logArtifactId,
        ...(!ready && command.importResult !== 'conflict' ? {
          failure: { code: 'godot.smoke-failed', message: 'Godot headless smoke did not pass.' },
        } : {}),
      };
      return commit(session, command.type, {
        phase: ready ? 'awaiting-confirmation' : 'failed',
        mapRevisions: replaceMap(session.mapRevisions, map.id, completed),
      });
    }

    case 'fail-godot-build': {
      const map = activeMap(session, command.mapRevisionId);
      if (session.stage !== 'godot-map' || map.status !== 'building') {
        fail('creation.invalid-transition', 'Only the building Godot map revision can fail.');
      }
      message(command.code, 'Godot failure code');
      message(command.message, 'Godot failure message');
      return commit(session, command.type, {
        phase: 'failed',
        mapRevisions: replaceMap(session.mapRevisions, map.id, {
          ...map,
          status: 'failed',
          failure: { code: command.code, message: command.message },
        }),
      });
    }

    case 'start-playtest': {
      if (session.stage !== 'playtest') {
        fail('creation.invalid-transition', 'Playtest can launch only after the Godot map is confirmed.');
      }
      requireCapability(session.profile, 'playtest');
      const map = activeMap(session);
      if (map.status !== 'ready') fail('creation.invalid-transition', 'The active Godot map is not ready.');
      if (command.endpoint !== undefined) message(command.endpoint, 'Playtest endpoint');
      return commit(session, command.type, {
        phase: 'running',
        playtest: {
          mapRevisionId: map.id,
          status: 'running',
          ...(command.endpoint === undefined ? {} : { endpoint: command.endpoint }),
        },
      });
    }

    case 'stop-playtest': {
      if (session.stage !== 'playtest' || session.playtest?.status !== 'running') {
        fail('creation.invalid-transition', 'No playtest is running.');
      }
      return commit(session, command.type, {
        phase: 'awaiting-user',
        playtest: { ...session.playtest, status: 'stopped' },
      });
    }

    case 'crash-playtest': {
      if (session.stage !== 'playtest' || session.playtest?.status !== 'running') {
        fail('creation.invalid-transition', 'No playtest is running.');
      }
      message(command.code, 'Playtest failure code');
      message(command.message, 'Playtest failure message');
      return commit(session, command.type, {
        phase: 'failed',
        playtest: {
          ...session.playtest,
          status: 'crashed',
          failure: { code: command.code, message: command.message },
        },
      });
    }
  }
}
