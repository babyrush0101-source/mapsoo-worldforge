import {
  fingerprintGenerationRequestV2,
  materializeGenerationRequestV2,
  type GenerationRequestV2,
} from './generation-request-v2';
import type { WorldCreationStage } from './world-creation-flow';

export const CONFIRMED_GENERATION_BINDING_SCHEMA_VERSION = '0.1.0' as const;
export const CONFIRMED_DIALOGUE_STAGES = Object.freeze([
  'world-brief',
  'art-direction',
  'map-layout',
  'style-sample',
] as const satisfies readonly WorldCreationStage[]);

const SHA256 = /^[a-f0-9]{64}$/;

export interface ConfirmedDialogueCheckpoint {
  readonly stage: typeof CONFIRMED_DIALOGUE_STAGES[number];
  readonly snapshotSha256: string;
}

export interface ConfirmedGenerationBinding {
  readonly schema_version: typeof CONFIRMED_GENERATION_BINDING_SCHEMA_VERSION;
  readonly session_revision: number;
  readonly request_fingerprint_sha256: string;
  readonly dialogue_snapshot_sha256: string;
  readonly binding_sha256: string;
  readonly checkpoints: readonly Readonly<{
    readonly stage: typeof CONFIRMED_DIALOGUE_STAGES[number];
    readonly snapshot_sha256: string;
  }>[];
}

export interface ConfirmedDialogueInput {
  readonly sessionRevision: number;
  readonly checkpoints: readonly ConfirmedDialogueCheckpoint[];
}

export class ConfirmedGenerationBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmedGenerationBindingError';
  }
}

function fail(message: string): never {
  throw new ConfirmedGenerationBindingError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('Confirmed generation binding contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeCheckpoints(value: unknown): ConfirmedGenerationBinding['checkpoints'] {
  if (!Array.isArray(value) || value.length !== CONFIRMED_DIALOGUE_STAGES.length) {
    fail('Confirmed generation binding requires exactly four dialogue checkpoints.');
  }
  return Object.freeze(value.map((candidate, index) => {
    if (!isRecord(candidate)) fail(`Dialogue checkpoint ${index} must be an object.`);
    const normalized = 'snapshotSha256' in candidate
      ? { stage: candidate.stage, snapshot_sha256: candidate.snapshotSha256 }
      : candidate;
    exactKeys(normalized, ['stage', 'snapshot_sha256'], `Dialogue checkpoint ${index}`);
    if (normalized.stage !== CONFIRMED_DIALOGUE_STAGES[index]) {
      fail(`Dialogue checkpoint ${index} must be ${CONFIRMED_DIALOGUE_STAGES[index]}.`);
    }
    if (typeof normalized.snapshot_sha256 !== 'string' || !SHA256.test(normalized.snapshot_sha256)) {
      fail(`Dialogue checkpoint ${index} requires a lowercase SHA-256 snapshot.`);
    }
    return Object.freeze({
      stage: normalized.stage as typeof CONFIRMED_DIALOGUE_STAGES[number],
      snapshot_sha256: normalized.snapshot_sha256,
    });
  }));
}

async function expectedDialogueSnapshot(
  sessionRevision: number,
  checkpoints: ConfirmedGenerationBinding['checkpoints'],
): Promise<string> {
  return sha256({
    session_revision: sessionRevision,
    checkpoints,
  });
}

async function expectedBindingFingerprint(
  requestFingerprintSha256: string,
  dialogueSnapshotSha256: string,
): Promise<string> {
  return sha256({
    schema_version: CONFIRMED_GENERATION_BINDING_SCHEMA_VERSION,
    request_fingerprint_sha256: requestFingerprintSha256,
    dialogue_snapshot_sha256: dialogueSnapshotSha256,
  });
}

export async function createConfirmedGenerationBinding(
  requestValue: unknown,
  dialogue: ConfirmedDialogueInput,
): Promise<ConfirmedGenerationBinding> {
  const request = materializeGenerationRequestV2(requestValue);
  if (!Number.isSafeInteger(dialogue.sessionRevision) || dialogue.sessionRevision < CONFIRMED_DIALOGUE_STAGES.length) {
    fail('Confirmed dialogue session revision must be a safe integer of at least four.');
  }
  const checkpoints = normalizeCheckpoints(dialogue.checkpoints);
  const requestFingerprintSha256 = await fingerprintGenerationRequestV2(request);
  const dialogueSnapshotSha256 = await expectedDialogueSnapshot(dialogue.sessionRevision, checkpoints);
  const bindingSha256 = await expectedBindingFingerprint(requestFingerprintSha256, dialogueSnapshotSha256);
  return Object.freeze({
    schema_version: CONFIRMED_GENERATION_BINDING_SCHEMA_VERSION,
    session_revision: dialogue.sessionRevision,
    request_fingerprint_sha256: requestFingerprintSha256,
    dialogue_snapshot_sha256: dialogueSnapshotSha256,
    binding_sha256: bindingSha256,
    checkpoints,
  });
}

export async function materializeConfirmedGenerationBinding(
  value: unknown,
  requestValue?: GenerationRequestV2,
): Promise<ConfirmedGenerationBinding> {
  if (!isRecord(value)) fail('Confirmed generation binding must be an object.');
  exactKeys(value, [
    'schema_version',
    'session_revision',
    'request_fingerprint_sha256',
    'dialogue_snapshot_sha256',
    'binding_sha256',
    'checkpoints',
  ], 'Confirmed generation binding');
  if (value.schema_version !== CONFIRMED_GENERATION_BINDING_SCHEMA_VERSION) {
    fail(`Confirmed generation binding schema must be ${CONFIRMED_GENERATION_BINDING_SCHEMA_VERSION}.`);
  }
  if (!Number.isSafeInteger(value.session_revision) || (value.session_revision as number) < CONFIRMED_DIALOGUE_STAGES.length) {
    fail('Confirmed generation binding session revision is invalid.');
  }
  for (const key of ['request_fingerprint_sha256', 'dialogue_snapshot_sha256', 'binding_sha256'] as const) {
    if (typeof value[key] !== 'string' || !SHA256.test(value[key])) {
      fail(`Confirmed generation binding ${key} is invalid.`);
    }
  }
  const checkpoints = normalizeCheckpoints(value.checkpoints);
  const dialogueSnapshotSha256 = await expectedDialogueSnapshot(value.session_revision as number, checkpoints);
  if (dialogueSnapshotSha256 !== value.dialogue_snapshot_sha256) {
    fail('Confirmed generation binding dialogue snapshot does not match its checkpoints.');
  }
  if (requestValue) {
    const requestFingerprint = await fingerprintGenerationRequestV2(requestValue);
    if (requestFingerprint !== value.request_fingerprint_sha256) {
      fail('Confirmed generation binding does not match the generation request.');
    }
  }
  const bindingSha256 = await expectedBindingFingerprint(
    value.request_fingerprint_sha256 as string,
    value.dialogue_snapshot_sha256 as string,
  );
  if (bindingSha256 !== value.binding_sha256) {
    fail('Confirmed generation binding fingerprint is invalid.');
  }
  return Object.freeze({
    schema_version: CONFIRMED_GENERATION_BINDING_SCHEMA_VERSION,
    session_revision: value.session_revision as number,
    request_fingerprint_sha256: value.request_fingerprint_sha256 as string,
    dialogue_snapshot_sha256: value.dialogue_snapshot_sha256 as string,
    binding_sha256: value.binding_sha256 as string,
    checkpoints,
  });
}
