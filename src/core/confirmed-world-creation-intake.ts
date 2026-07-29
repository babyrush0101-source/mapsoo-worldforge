import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  createConfirmedGenerationBinding,
  type ConfirmedGenerationBinding,
} from './confirmed-generation-binding';
import {
  GENERATION_REQUEST_SCHEMA_VERSION,
  materializeGenerationRequestV2,
  type GenerationRequestV2,
} from './generation-request-v2';
import {
  materializeReferenceImageDescriptor,
  type ReferenceImageDescriptor,
} from './reference-image';

export const CONFIRMED_WORLD_CREATION_INTAKE_VERSION = '1.0.0' as const;
export const WORLD_CREATION_INTAKE_STATUS = 'confirmed' as const;
export const WORLD_CREATION_INTAKE_TARGETS = Object.freeze([
  'desktop',
  'raspberry-pi-4b',
  'web',
] as const);
export const WORLD_CREATION_INTAKE_CHECKPOINTS = Object.freeze([
  'world-brief',
  'art-direction',
  'map-layout',
  'style-sample',
] as const);
export const WORLD_CREATION_FACT_PROMPTS = Object.freeze([
  Object.freeze({
    fact: 'premise',
    question: 'Describe the world in a few sentences. What can the player do there, and what should they feel?',
  }),
  Object.freeze({
    fact: 'worldview',
    question: 'What rules, beliefs, history, or central tension make this world distinct?',
  }),
  Object.freeze({
    fact: 'terrain',
    question: 'Which terrain types must shape the playable space?',
  }),
  Object.freeze({
    fact: 'geography',
    question: 'How are regions, routes, settlements, water, elevation, spawn, and exit arranged?',
  }),
  Object.freeze({
    fact: 'culture',
    question: 'Who lives here, and what architecture, work, customs, clothing, and public spaces express their culture?',
  }),
  Object.freeze({
    fact: 'ecology',
    question: 'Which climate, weather, plants, animals, and ambient effects belong here?',
  }),
  Object.freeze({
    fact: 'mood',
    question: 'What emotional tone and gameplay readability should the finished scene preserve?',
  }),
  Object.freeze({
    fact: 'art_direction',
    question: 'Confirm palette, materials, lighting, rendering style, camera, scale, and character treatment.',
  }),
  Object.freeze({
    fact: 'traversal',
    question: 'Describe the main playable route, interactions, hazards, checkpoints, and exit condition.',
  }),
  Object.freeze({
    fact: 'landmarks',
    question: 'Name the visual landmarks that must remain recognizable in the map and runtime render.',
  }),
] as const satisfies readonly Readonly<{
  fact: keyof ConfirmedWorldFacts;
  question: string;
}>[]);

export type WorldCreationIntakeTarget = typeof WORLD_CREATION_INTAKE_TARGETS[number];
export type WorldCreationIntakeCheckpointStage = typeof WORLD_CREATION_INTAKE_CHECKPOINTS[number];

export interface ConfirmedWorldFacts {
  readonly premise: string;
  readonly worldview: string;
  readonly terrain: string;
  readonly geography: string;
  readonly culture: string;
  readonly ecology: string;
  readonly mood: string;
  readonly art_direction: string;
  readonly traversal: string;
  readonly landmarks: string;
}

export interface ConfirmedWorldCreationIntake {
  readonly schema_version: typeof CONFIRMED_WORLD_CREATION_INTAKE_VERSION;
  readonly status: typeof WORLD_CREATION_INTAKE_STATUS;
  readonly intake_id: string;
  readonly session_revision: number;
  readonly profile: WorldAssetProfile;
  readonly target: WorldCreationIntakeTarget;
  readonly seed: string;
  readonly facts: ConfirmedWorldFacts;
  readonly character_source: Readonly<{
    reference_id: string;
    identity_digest_sha256: string;
  }>;
  readonly references: readonly [ReferenceImageDescriptor, ReferenceImageDescriptor];
  readonly approved_intent_preview_sha256: string;
  readonly checkpoints: readonly Readonly<{
    stage: WorldCreationIntakeCheckpointStage;
    snapshot_sha256: string;
  }>[];
}

export interface ConfirmedWorldCreationProjection {
  readonly intake: ConfirmedWorldCreationIntake;
  readonly intake_sha256: string;
  readonly generation_request: GenerationRequestV2;
  readonly generation_binding: ConfirmedGenerationBinding;
}

export type ConfirmedWorldCreationIntakeErrorCode =
  | 'intake.invalid-shape'
  | 'intake.invalid-value'
  | 'intake.invalid-reference'
  | 'intake.checkpoint-mismatch';

export class ConfirmedWorldCreationIntakeError extends Error {
  constructor(readonly code: ConfirmedWorldCreationIntakeErrorCode, message: string) {
    super(message);
    this.name = 'ConfirmedWorldCreationIntakeError';
  }
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

function fail(code: ConfirmedWorldCreationIntakeErrorCode, message: string): never {
  throw new ConfirmedWorldCreationIntakeError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('intake.invalid-shape', `${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || Array.from(value).length > maximum
    || CONTROL_CHARACTER.test(value)
  ) {
    fail('intake.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function id(value: unknown, label: string, maximum = 80): string {
  const normalized = text(value, label, maximum);
  if (!ID.test(normalized)) fail('intake.invalid-value', `${label} must use lowercase kebab-case.`);
  return normalized;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('intake.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('intake.invalid-value', 'Canonical intake cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('intake.invalid-value', 'Canonical intake contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digestBuffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function materializeFacts(value: unknown): ConfirmedWorldFacts {
  if (!isRecord(value)) fail('intake.invalid-shape', 'Confirmed world facts must be an object.');
  exactKeys(value, [
    'premise',
    'worldview',
    'terrain',
    'geography',
    'culture',
    'ecology',
    'mood',
    'art_direction',
    'traversal',
    'landmarks',
  ], 'Confirmed world facts');
  return Object.freeze({
    premise: text(value.premise, 'World premise', 240),
    worldview: text(value.worldview, 'Worldview', 240),
    terrain: text(value.terrain, 'Terrain', 200),
    geography: text(value.geography, 'Geography', 200),
    culture: text(value.culture, 'Culture', 240),
    ecology: text(value.ecology, 'Ecology', 200),
    mood: text(value.mood, 'Mood', 160),
    art_direction: text(value.art_direction, 'Art direction', 240),
    traversal: text(value.traversal, 'Traversal', 200),
    landmarks: text(value.landmarks, 'Landmarks', 240),
  });
}

function checkpointPayload(
  stage: WorldCreationIntakeCheckpointStage,
  intake: Pick<ConfirmedWorldCreationIntake, 'profile' | 'target' | 'facts' | 'references' | 'approved_intent_preview_sha256'>,
): unknown {
  if (stage === 'world-brief') {
    return {
      profile: intake.profile,
      target: intake.target,
      premise: intake.facts.premise,
      worldview: intake.facts.worldview,
      terrain: intake.facts.terrain,
      geography: intake.facts.geography,
      culture: intake.facts.culture,
      ecology: intake.facts.ecology,
    };
  }
  if (stage === 'art-direction') {
    return {
      mood: intake.facts.mood,
      art_direction: intake.facts.art_direction,
    };
  }
  if (stage === 'map-layout') {
    return {
      profile: intake.profile,
      terrain: intake.facts.terrain,
      geography: intake.facts.geography,
      traversal: intake.facts.traversal,
      landmarks: intake.facts.landmarks,
    };
  }
  return {
    approved_intent_preview_sha256: intake.approved_intent_preview_sha256,
    references: intake.references.map(({ id: referenceId, role, sha256: referenceSha256 }) => ({
      id: referenceId,
      role,
      sha256: referenceSha256,
    })),
  };
}

async function expectedCheckpoints(
  intake: Pick<ConfirmedWorldCreationIntake, 'profile' | 'target' | 'facts' | 'references' | 'approved_intent_preview_sha256'>,
): Promise<ConfirmedWorldCreationIntake['checkpoints']> {
  return Object.freeze(await Promise.all(WORLD_CREATION_INTAKE_CHECKPOINTS.map(async (stage) => Object.freeze({
    stage,
    snapshot_sha256: await sha256(checkpointPayload(stage, intake)),
  }))));
}

function sameCheckpoints(
  left: ConfirmedWorldCreationIntake['checkpoints'],
  right: ConfirmedWorldCreationIntake['checkpoints'],
): boolean {
  return left.length === right.length && left.every((checkpoint, index) => (
    checkpoint.stage === right[index]?.stage
    && checkpoint.snapshot_sha256 === right[index]?.snapshot_sha256
  ));
}

export async function materializeConfirmedWorldCreationIntake(
  value: unknown,
): Promise<ConfirmedWorldCreationIntake> {
  if (!isRecord(value)) fail('intake.invalid-shape', 'Confirmed world creation intake must be an object.');
  exactKeys(value, [
    'schema_version',
    'status',
    'intake_id',
    'session_revision',
    'profile',
    'target',
    'seed',
    'facts',
    'character_source',
    'references',
    'approved_intent_preview_sha256',
    'checkpoints',
  ], 'Confirmed world creation intake');
  if (value.schema_version !== CONFIRMED_WORLD_CREATION_INTAKE_VERSION || value.status !== WORLD_CREATION_INTAKE_STATUS) {
    fail('intake.invalid-value', 'World creation intake must be a confirmed 1.0.0 document.');
  }
  if (!Number.isSafeInteger(value.session_revision) || (value.session_revision as number) < 4) {
    fail('intake.invalid-value', 'World creation session revision must be a safe integer of at least four.');
  }
  if (!isWorldAssetProfile(value.profile)) fail('intake.invalid-value', 'World asset profile is unsupported.');
  if (!WORLD_CREATION_INTAKE_TARGETS.includes(value.target as WorldCreationIntakeTarget)) {
    fail('intake.invalid-value', 'World creation target is unsupported.');
  }
  if (!Array.isArray(value.references) || value.references.length !== 2) {
    fail('intake.invalid-reference', 'World creation intake requires exactly two reference images.');
  }
  let references: ReferenceImageDescriptor[];
  try {
    references = value.references.map(materializeReferenceImageDescriptor);
  } catch (error) {
    fail(
      'intake.invalid-reference',
      `World creation reference is invalid${error instanceof Error ? `: ${error.message}` : '.'}`,
    );
  }
  const roles = references.map(({ role }) => role).sort();
  if (roles.join(',') !== 'character,environment-style') {
    fail('intake.invalid-reference', 'World creation intake requires one character and one environment-style reference.');
  }
  if (!isRecord(value.character_source)) {
    fail('intake.invalid-shape', 'Character source must be an object.');
  }
  exactKeys(value.character_source, ['reference_id', 'identity_digest_sha256'], 'Character source');
  const referenceId = id(value.character_source.reference_id, 'Character source reference id', 64);
  if (!references.some((reference) => reference.role === 'character' && reference.id === referenceId)) {
    fail('intake.invalid-reference', 'Character source must reference the declared character image.');
  }
  if (!Array.isArray(value.checkpoints) || value.checkpoints.length !== WORLD_CREATION_INTAKE_CHECKPOINTS.length) {
    fail('intake.invalid-value', 'World creation intake requires exactly four ordered checkpoints.');
  }
  const checkpoints = Object.freeze(value.checkpoints.map((candidate, index) => {
    if (!isRecord(candidate)) fail('intake.invalid-shape', `Checkpoint ${index} must be an object.`);
    exactKeys(candidate, ['stage', 'snapshot_sha256'], `Checkpoint ${index}`);
    if (candidate.stage !== WORLD_CREATION_INTAKE_CHECKPOINTS[index]) {
      fail('intake.invalid-value', `Checkpoint ${index} must be ${WORLD_CREATION_INTAKE_CHECKPOINTS[index]}.`);
    }
    return Object.freeze({
      stage: candidate.stage as WorldCreationIntakeCheckpointStage,
      snapshot_sha256: digest(candidate.snapshot_sha256, `Checkpoint ${index} snapshot`),
    });
  }));
  const intake: ConfirmedWorldCreationIntake = Object.freeze({
    schema_version: CONFIRMED_WORLD_CREATION_INTAKE_VERSION,
    status: WORLD_CREATION_INTAKE_STATUS,
    intake_id: id(value.intake_id, 'World creation intake id'),
    session_revision: value.session_revision as number,
    profile: value.profile,
    target: value.target as WorldCreationIntakeTarget,
    seed: text(value.seed, 'World creation seed', 160),
    facts: materializeFacts(value.facts),
    character_source: Object.freeze({
      reference_id: referenceId,
      identity_digest_sha256: digest(
        value.character_source.identity_digest_sha256,
        'Character source identity digest',
      ),
    }),
    references: Object.freeze(references as [ReferenceImageDescriptor, ReferenceImageDescriptor]),
    approved_intent_preview_sha256: digest(
      value.approved_intent_preview_sha256,
      'Approved intent preview digest',
    ),
    checkpoints,
  });
  if (!sameCheckpoints(checkpoints, await expectedCheckpoints(intake))) {
    fail('intake.checkpoint-mismatch', 'World creation checkpoints do not match the confirmed facts and references.');
  }
  return intake;
}

export async function createConfirmedWorldCreationIntake(
  input: Omit<ConfirmedWorldCreationIntake, 'schema_version' | 'status' | 'checkpoints'>,
): Promise<ConfirmedWorldCreationIntake> {
  const candidate = {
    schema_version: CONFIRMED_WORLD_CREATION_INTAKE_VERSION,
    status: WORLD_CREATION_INTAKE_STATUS,
    ...input,
  };
  return materializeConfirmedWorldCreationIntake({
    ...candidate,
    checkpoints: await expectedCheckpoints(candidate),
  });
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
  ].join(' | ').slice(0, 2_000).trimEnd();
}

export async function fingerprintConfirmedWorldCreationIntake(value: unknown): Promise<string> {
  return sha256(await materializeConfirmedWorldCreationIntake(value));
}

export async function projectConfirmedWorldCreationIntake(
  value: unknown,
): Promise<ConfirmedWorldCreationProjection> {
  const intake = await materializeConfirmedWorldCreationIntake(value);
  const generationRequest = materializeGenerationRequestV2({
    schemaVersion: GENERATION_REQUEST_SCHEMA_VERSION,
    id: intake.intake_id,
    profile: intake.profile,
    description: generationDescription(intake.facts),
    seed: intake.seed,
    references: intake.references,
  });
  const generationBinding = await createConfirmedGenerationBinding(generationRequest, {
    sessionRevision: intake.session_revision,
    checkpoints: intake.checkpoints.map(({ stage, snapshot_sha256 }) => ({
      stage,
      snapshotSha256: snapshot_sha256,
    })),
  });
  return Object.freeze({
    intake,
    intake_sha256: await sha256(intake),
    generation_request: generationRequest,
    generation_binding: generationBinding,
  });
}
