import {
  WORLD_CREATION_INTAKE_TARGETS,
  type ConfirmedWorldCreationIntake,
} from './confirmed-world-creation-intake';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';
import {
  PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH,
  PRIVATE_PRODUCTION_HANDOFF_README_PATH,
  type PrivateProductionHandoffFile,
  type PrivateProductionHandoffReference,
} from './private-production-handoff';

export const PRIVATE_PRODUCTION_HANDOFF_V1_1_VERSION = '1.1.0' as const;
export const PRIVATE_PRODUCTION_HANDOFF_LAYOUT_CONSTRAINTS_PATH =
  'world-layout-constraints.json' as const;
export const PRIVATE_PRODUCTION_HANDOFF_LAYOUT_PLAN_PATH =
  'world-layout-plan.json' as const;
export const PRIVATE_PRODUCTION_HANDOFF_ASSET_REQUIREMENTS_PATH =
  'complete-art/asset-requirements-1.1.json' as const;
export const PRIVATE_PRODUCTION_HANDOFF_PRODUCTION_ART_PLAN_PATH =
  'complete-art/production-art-plan-1.1.json' as const;

export interface PrivateProductionHandoffPlanningV1_1 {
  readonly layout_constraints: PrivateProductionHandoffFile & Readonly<{
    path: typeof PRIVATE_PRODUCTION_HANDOFF_LAYOUT_CONSTRAINTS_PATH;
  }>;
  readonly layout_plan: PrivateProductionHandoffFile & Readonly<{
    path: typeof PRIVATE_PRODUCTION_HANDOFF_LAYOUT_PLAN_PATH;
  }>;
  readonly asset_requirements: PrivateProductionHandoffFile & Readonly<{
    path: typeof PRIVATE_PRODUCTION_HANDOFF_ASSET_REQUIREMENTS_PATH;
  }>;
  readonly production_art_plan: PrivateProductionHandoffFile & Readonly<{
    path: typeof PRIVATE_PRODUCTION_HANDOFF_PRODUCTION_ART_PLAN_PATH;
  }>;
  readonly requirement_count: number;
  readonly task_count: number;
  readonly maximum_remote_requests: number;
  readonly scene_direction_requests: 1;
  readonly approval_policy: 'scene-direction-then-complete-world';
}

export interface PrivateProductionHandoffManifestV1_1 {
  readonly schema_version:
    typeof PRIVATE_PRODUCTION_HANDOFF_V1_1_VERSION;
  readonly document_type: 'private-production-handoff';
  readonly intake_id: string;
  readonly intake_sha256: string;
  readonly profile: WorldAssetProfile;
  readonly target: ConfirmedWorldCreationIntake['target'];
  readonly intake: PrivateProductionHandoffFile & Readonly<{
    path: typeof PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH;
  }>;
  readonly references: readonly [
    PrivateProductionHandoffReference,
    PrivateProductionHandoffReference,
  ];
  readonly instructions: PrivateProductionHandoffFile & Readonly<{
    path: typeof PRIVATE_PRODUCTION_HANDOFF_README_PATH;
  }>;
  readonly planning: PrivateProductionHandoffPlanningV1_1;
  readonly privacy: Readonly<{
    contains_original_references: true;
    contains_private_world_facts: true;
    public_distribution_allowed: false;
  }>;
  readonly remote_request_count: 0;
}

export type PrivateProductionHandoffV1_1ErrorCode =
  | 'private-handoff-1.1.invalid-shape'
  | 'private-handoff-1.1.invalid-value'
  | 'private-handoff-1.1.invalid-path'
  | 'private-handoff-1.1.invalid-reference';

export class PrivateProductionHandoffV1_1Error extends Error {
  constructor(
    readonly code: PrivateProductionHandoffV1_1ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PrivateProductionHandoffV1_1Error';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function fail(
  code: PrivateProductionHandoffV1_1ErrorCode,
  message: string,
): never {
  throw new PrivateProductionHandoffV1_1Error(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    fail(
      'private-handoff-1.1.invalid-shape',
      `${label} must contain exactly: ${wanted.join(', ')}.`,
    );
  }
}

function safePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.trim() !== value
    || !SAFE_PATH.test(value)
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('//')
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    fail('private-handoff-1.1.invalid-path', `${label} is not portable.`);
  }
  return value;
}

function file(
  value: unknown,
  label: string,
  expectedPath: string,
): PrivateProductionHandoffFile {
  if (!isRecord(value)) {
    fail('private-handoff-1.1.invalid-shape', `${label} must be an object.`);
  }
  exactKeys(value, ['path', 'bytes', 'sha256'], label);
  const path = safePath(value.path, `${label} path`);
  if (path !== expectedPath) {
    fail('private-handoff-1.1.invalid-path', `${label} path is not canonical.`);
  }
  if (
    !Number.isSafeInteger(value.bytes)
    || (value.bytes as number) < 1
    || (value.bytes as number) > MAX_FILE_BYTES
    || typeof value.sha256 !== 'string'
    || !SHA256.test(value.sha256)
  ) {
    fail('private-handoff-1.1.invalid-value', `${label} metadata is invalid.`);
  }
  return Object.freeze({
    path,
    bytes: value.bytes as number,
    sha256: value.sha256,
  });
}

function reference(
  value: unknown,
  index: number,
): PrivateProductionHandoffReference {
  if (!isRecord(value)) {
    fail(
      'private-handoff-1.1.invalid-shape',
      `Reference ${index} must be an object.`,
    );
  }
  exactKeys(
    value,
    ['id', 'role', 'path', 'media_type', 'bytes', 'sha256'],
    `Reference ${index}`,
  );
  const metadata = file({
    path: value.path,
    bytes: value.bytes,
    sha256: value.sha256,
  }, `Reference ${index}`, String(value.path));
  if (
    typeof value.id !== 'string'
    || value.id.length > 80
    || !SAFE_ID.test(value.id)
    || !['environment-style', 'character'].includes(String(value.role))
    || !['image/png', 'image/jpeg'].includes(String(value.media_type))
    || !metadata.path.startsWith('references/')
  ) {
    fail(
      'private-handoff-1.1.invalid-reference',
      `Reference ${index} metadata is invalid.`,
    );
  }
  return Object.freeze({
    id: value.id,
    role: value.role as PrivateProductionHandoffReference['role'],
    path: metadata.path,
    media_type:
      value.media_type as PrivateProductionHandoffReference['media_type'],
    bytes: metadata.bytes,
    sha256: metadata.sha256,
  });
}

function positiveCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 64) {
    fail('private-handoff-1.1.invalid-value', `${label} is invalid.`);
  }
  return value as number;
}

export function materializePrivateProductionHandoffManifestV1_1(
  value: unknown,
): PrivateProductionHandoffManifestV1_1 {
  if (!isRecord(value)) {
    fail(
      'private-handoff-1.1.invalid-shape',
      'Private production handoff manifest must be an object.',
    );
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'intake_id',
    'intake_sha256',
    'profile',
    'target',
    'intake',
    'references',
    'instructions',
    'planning',
    'privacy',
    'remote_request_count',
  ], 'Private production handoff manifest');
  if (
    value.schema_version !== PRIVATE_PRODUCTION_HANDOFF_V1_1_VERSION
    || value.document_type !== 'private-production-handoff'
    || typeof value.intake_id !== 'string'
    || value.intake_id.length > 80
    || !SAFE_ID.test(value.intake_id)
    || typeof value.intake_sha256 !== 'string'
    || !SHA256.test(value.intake_sha256)
    || !WORLD_ASSET_PROFILES.includes(value.profile as WorldAssetProfile)
    || !WORLD_CREATION_INTAKE_TARGETS.includes(
      value.target as ConfirmedWorldCreationIntake['target'],
    )
    || value.remote_request_count !== 0
  ) {
    fail(
      'private-handoff-1.1.invalid-value',
      'Private production handoff identity is invalid.',
    );
  }
  if (!Array.isArray(value.references) || value.references.length !== 2) {
    fail(
      'private-handoff-1.1.invalid-reference',
      'Private production handoff requires exactly two references.',
    );
  }
  const references = Object.freeze(value.references.map(reference).sort(
    (left, right) => left.path.localeCompare(right.path, 'en'),
  )) as PrivateProductionHandoffManifestV1_1['references'];
  if (
    new Set(references.map(({ path }) => path)).size !== 2
    || new Set(references.map(({ id }) => id)).size !== 2
    || references.map(({ role }) => role).sort().join(',')
      !== 'character,environment-style'
  ) {
    fail(
      'private-handoff-1.1.invalid-reference',
      'Private production handoff references must be unique and role-complete.',
    );
  }
  if (!isRecord(value.planning)) {
    fail(
      'private-handoff-1.1.invalid-shape',
      'Private production planning must be an object.',
    );
  }
  exactKeys(value.planning, [
    'layout_constraints',
    'layout_plan',
    'asset_requirements',
    'production_art_plan',
    'requirement_count',
    'task_count',
    'maximum_remote_requests',
    'scene_direction_requests',
    'approval_policy',
  ], 'Private production planning');
  const requirementCount = positiveCount(
    value.planning.requirement_count,
    'Requirement count',
  );
  const taskCount = positiveCount(value.planning.task_count, 'Task count');
  if (
    value.planning.maximum_remote_requests !== taskCount
    || value.planning.scene_direction_requests !== 1
    || value.planning.approval_policy
      !== 'scene-direction-then-complete-world'
  ) {
    fail(
      'private-handoff-1.1.invalid-value',
      'Private production planning request policy is invalid.',
    );
  }
  if (!isRecord(value.privacy)) {
    fail(
      'private-handoff-1.1.invalid-shape',
      'Private production handoff privacy declaration must be an object.',
    );
  }
  exactKeys(
    value.privacy,
    [
      'contains_original_references',
      'contains_private_world_facts',
      'public_distribution_allowed',
    ],
    'Private production handoff privacy declaration',
  );
  if (
    value.privacy.contains_original_references !== true
    || value.privacy.contains_private_world_facts !== true
    || value.privacy.public_distribution_allowed !== false
  ) {
    fail(
      'private-handoff-1.1.invalid-value',
      'Private production handoff cannot be declared public.',
    );
  }
  const intake = file(
    value.intake,
    'Confirmed intake',
    PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH,
  ) as PrivateProductionHandoffManifestV1_1['intake'];
  const instructions = file(
    value.instructions,
    'Instructions',
    PRIVATE_PRODUCTION_HANDOFF_README_PATH,
  ) as PrivateProductionHandoffManifestV1_1['instructions'];
  const planning = Object.freeze({
    layout_constraints: file(
      value.planning.layout_constraints,
      'World layout constraints',
      PRIVATE_PRODUCTION_HANDOFF_LAYOUT_CONSTRAINTS_PATH,
    ),
    layout_plan: file(
      value.planning.layout_plan,
      'World layout plan',
      PRIVATE_PRODUCTION_HANDOFF_LAYOUT_PLAN_PATH,
    ),
    asset_requirements: file(
      value.planning.asset_requirements,
      'Asset requirements',
      PRIVATE_PRODUCTION_HANDOFF_ASSET_REQUIREMENTS_PATH,
    ),
    production_art_plan: file(
      value.planning.production_art_plan,
      'Production art plan',
      PRIVATE_PRODUCTION_HANDOFF_PRODUCTION_ART_PLAN_PATH,
    ),
    requirement_count: requirementCount,
    task_count: taskCount,
    maximum_remote_requests: taskCount,
    scene_direction_requests: 1 as const,
    approval_policy: 'scene-direction-then-complete-world' as const,
  }) as PrivateProductionHandoffPlanningV1_1;
  const paths = [
    intake.path,
    instructions.path,
    ...references.map(({ path }) => path),
    planning.layout_constraints.path,
    planning.layout_plan.path,
    planning.asset_requirements.path,
    planning.production_art_plan.path,
  ];
  if (new Set(paths).size !== paths.length) {
    fail(
      'private-handoff-1.1.invalid-path',
      'Private production handoff file paths conflict.',
    );
  }
  return Object.freeze({
    schema_version: PRIVATE_PRODUCTION_HANDOFF_V1_1_VERSION,
    document_type: 'private-production-handoff',
    intake_id: value.intake_id,
    intake_sha256: value.intake_sha256,
    profile: value.profile as WorldAssetProfile,
    target: value.target as ConfirmedWorldCreationIntake['target'],
    intake,
    references,
    instructions,
    planning,
    privacy: Object.freeze({
      contains_original_references: true,
      contains_private_world_facts: true,
      public_distribution_allowed: false,
    }),
    remote_request_count: 0,
  });
}

export function encodePrivateProductionHandoffManifestV1_1(
  value: unknown,
): Uint8Array {
  const manifest = materializePrivateProductionHandoffManifestV1_1(value);
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}
