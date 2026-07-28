import {
  WORLD_CREATION_INTAKE_TARGETS,
  type ConfirmedWorldCreationIntake,
} from './confirmed-world-creation-intake';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';
import type {
  ReferenceImageMediaType,
  ReferenceImageRole,
} from './reference-image';

export const PRIVATE_PRODUCTION_HANDOFF_VERSION = '1.0.0' as const;
export const PRIVATE_PRODUCTION_HANDOFF_MANIFEST_PATH = 'handoff.json' as const;
export const PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH =
  'confirmed-intake.json' as const;
export const PRIVATE_PRODUCTION_HANDOFF_README_PATH = 'README.md' as const;

export interface PrivateProductionHandoffFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PrivateProductionHandoffReference
  extends PrivateProductionHandoffFile {
  readonly id: string;
  readonly role: ReferenceImageRole;
  readonly media_type: ReferenceImageMediaType;
}

export interface PrivateProductionHandoffManifest {
  readonly schema_version: typeof PRIVATE_PRODUCTION_HANDOFF_VERSION;
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
  readonly privacy: Readonly<{
    contains_original_references: true;
    public_distribution_allowed: false;
  }>;
  readonly remote_request_count: 0;
}

export type PrivateProductionHandoffErrorCode =
  | 'private-handoff.invalid-shape'
  | 'private-handoff.invalid-value'
  | 'private-handoff.invalid-path'
  | 'private-handoff.invalid-reference';

export class PrivateProductionHandoffError extends Error {
  constructor(
    readonly code: PrivateProductionHandoffErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PrivateProductionHandoffError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function fail(
  code: PrivateProductionHandoffErrorCode,
  message: string,
): never {
  throw new PrivateProductionHandoffError(code, message);
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
      'private-handoff.invalid-shape',
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
    fail('private-handoff.invalid-path', `${label} is not a portable path.`);
  }
  return value;
}

function file(
  value: unknown,
  label: string,
  expectedPath?: string,
): PrivateProductionHandoffFile {
  if (!isRecord(value)) {
    fail('private-handoff.invalid-shape', `${label} must be an object.`);
  }
  exactKeys(value, ['path', 'bytes', 'sha256'], label);
  const path = safePath(value.path, `${label} path`);
  if (expectedPath !== undefined && path !== expectedPath) {
    fail('private-handoff.invalid-path', `${label} path is not canonical.`);
  }
  if (
    !Number.isSafeInteger(value.bytes)
    || (value.bytes as number) < 1
    || (value.bytes as number) > MAX_FILE_BYTES
    || typeof value.sha256 !== 'string'
    || !SHA256.test(value.sha256)
  ) {
    fail('private-handoff.invalid-value', `${label} metadata is invalid.`);
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
      'private-handoff.invalid-shape',
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
  }, `Reference ${index}`);
  if (
    typeof value.id !== 'string'
    || value.id.length > 80
    || !SAFE_ID.test(value.id)
    || !['environment-style', 'character'].includes(value.role as string)
    || !['image/png', 'image/jpeg'].includes(value.media_type as string)
    || !metadata.path.startsWith('references/')
  ) {
    fail(
      'private-handoff.invalid-reference',
      `Reference ${index} metadata is invalid.`,
    );
  }
  return Object.freeze({
    id: value.id,
    role: value.role as ReferenceImageRole,
    path: metadata.path,
    media_type: value.media_type as ReferenceImageMediaType,
    bytes: metadata.bytes,
    sha256: metadata.sha256,
  });
}

export function materializePrivateProductionHandoffManifest(
  value: unknown,
): PrivateProductionHandoffManifest {
  if (!isRecord(value)) {
    fail(
      'private-handoff.invalid-shape',
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
    'privacy',
    'remote_request_count',
  ], 'Private production handoff manifest');
  if (
    value.schema_version !== PRIVATE_PRODUCTION_HANDOFF_VERSION
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
      'private-handoff.invalid-value',
      'Private production handoff identity is invalid.',
    );
  }
  if (!Array.isArray(value.references) || value.references.length !== 2) {
    fail(
      'private-handoff.invalid-reference',
      'Private production handoff requires exactly two references.',
    );
  }
  const references = Object.freeze(value.references.map(reference).sort(
    (left, right) => left.path.localeCompare(right.path, 'en'),
  )) as PrivateProductionHandoffManifest['references'];
  if (
    new Set(references.map(({ path }) => path)).size !== 2
    || new Set(references.map(({ id }) => id)).size !== 2
    || references.map(({ role }) => role).sort().join(',')
      !== 'character,environment-style'
  ) {
    fail(
      'private-handoff.invalid-reference',
      'Private production handoff references must be unique and role-complete.',
    );
  }
  if (!isRecord(value.privacy)) {
    fail(
      'private-handoff.invalid-shape',
      'Private production handoff privacy declaration must be an object.',
    );
  }
  exactKeys(
    value.privacy,
    ['contains_original_references', 'public_distribution_allowed'],
    'Private production handoff privacy declaration',
  );
  if (
    value.privacy.contains_original_references !== true
    || value.privacy.public_distribution_allowed !== false
  ) {
    fail(
      'private-handoff.invalid-value',
      'Private production handoff cannot be declared public.',
    );
  }
  const intake = file(
    value.intake,
    'Confirmed intake',
    PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH,
  ) as PrivateProductionHandoffManifest['intake'];
  const instructions = file(
    value.instructions,
    'Instructions',
    PRIVATE_PRODUCTION_HANDOFF_README_PATH,
  ) as PrivateProductionHandoffManifest['instructions'];
  const paths = [
    intake.path,
    instructions.path,
    ...references.map(({ path }) => path),
  ];
  if (new Set(paths).size !== paths.length) {
    fail(
      'private-handoff.invalid-path',
      'Private production handoff file paths conflict.',
    );
  }
  return Object.freeze({
    schema_version: PRIVATE_PRODUCTION_HANDOFF_VERSION,
    document_type: 'private-production-handoff',
    intake_id: value.intake_id,
    intake_sha256: value.intake_sha256,
    profile: value.profile as WorldAssetProfile,
    target: value.target as ConfirmedWorldCreationIntake['target'],
    intake: Object.freeze(intake),
    references,
    instructions: Object.freeze(instructions),
    privacy: Object.freeze({
      contains_original_references: true,
      public_distribution_allowed: false,
    }),
    remote_request_count: 0,
  });
}

export function encodePrivateProductionHandoffManifest(
  value: unknown,
): Uint8Array {
  const manifest = materializePrivateProductionHandoffManifest(value);
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}
