import {
  fingerprintReviewedCharacterProfileFamily,
  materializeReviewedCharacterProfileFamily,
  serializeReviewedCharacterProfileFamilyCanonical,
  verifyReviewedCharacterProfileFamily,
  type ReviewedCharacterProfileFamily,
  type ReviewedCharacterProfileFamilyArtifacts,
} from './reviewed-character-profile-family';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';

export const REVIEWED_CHARACTER_FAMILY_RUNTIME_ACCEPTANCE_VERSION =
  '1.0.0' as const;
export const REVIEWED_CHARACTER_FAMILY_RUNTIME_GODOT_VERSIONS =
  Object.freeze(['4.3', '4.7'] as const);

export interface ReviewedCharacterFamilyRuntimeRun {
  readonly compatibility_version:
    typeof REVIEWED_CHARACTER_FAMILY_RUNTIME_GODOT_VERSIONS[number];
  readonly engine_version: string;
  readonly executable_sha256: string;
  readonly host_platform: 'windows' | 'linux' | 'macos';
  readonly host_architecture: string;
  readonly mode: 'headless-character-family-bind';
  readonly profiles_loaded: 4;
  readonly clips_loaded: 84;
  readonly result: 'pass';
}

export interface ReviewedCharacterFamilyRuntimeAcceptanceMember {
  readonly profile: WorldAssetProfile;
  readonly profile_revision_id: string;
  readonly revision_path: string;
  readonly revision_bytes: number;
  readonly revision_sha256: string;
  readonly atlas_path: string;
  readonly atlas_bytes: number;
  readonly atlas_sha256: string;
  readonly clip_count: number;
}

export interface ReviewedCharacterFamilyRuntimeAcceptance {
  readonly schema_version:
    typeof REVIEWED_CHARACTER_FAMILY_RUNTIME_ACCEPTANCE_VERSION;
  readonly document_type:
    'reviewed-character-profile-family-runtime-acceptance';
  readonly acceptance_id: string;
  readonly family: Readonly<{
    family_id: string;
    manifest_path: 'reviewed-character-profile-family.json';
    manifest_bytes: number;
    manifest_sha256: string;
    character_id: string;
    character_identity_sha256: string;
  }>;
  readonly profiles:
    readonly ReviewedCharacterFamilyRuntimeAcceptanceMember[];
  readonly runs: readonly ReviewedCharacterFamilyRuntimeRun[];
  readonly privacy: Readonly<{
    local_paths_included: false;
    source_images_included: false;
    raw_engine_output_included: false;
    reviewer_identity_included: false;
  }>;
  readonly claims: Readonly<{
    exact_family_artifacts_tested: true;
    technical_runtime_compatibility: 'passed';
    visual_quality_reassessed: false;
    human_art_review_reassessed: false;
    physical_raspberry_pi_tested: false;
  }>;
  readonly status: 'technical-runtime-pass';
}

export interface BuildReviewedCharacterFamilyRuntimeAcceptanceInput {
  readonly family: unknown;
  readonly familyBytes: Uint8Array;
  readonly artifacts: ReviewedCharacterProfileFamilyArtifacts;
  readonly runs: readonly ReviewedCharacterFamilyRuntimeRun[];
}

export type ReviewedCharacterFamilyRuntimeAcceptanceErrorCode =
  | 'reviewed-character-runtime.invalid-shape'
  | 'reviewed-character-runtime.invalid-value'
  | 'reviewed-character-runtime.incomplete-profiles'
  | 'reviewed-character-runtime.incomplete-runs'
  | 'reviewed-character-runtime.binding-mismatch'
  | 'reviewed-character-runtime.integrity';

export class ReviewedCharacterFamilyRuntimeAcceptanceError extends Error {
  constructor(
    readonly code: ReviewedCharacterFamilyRuntimeAcceptanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewedCharacterFamilyRuntimeAcceptanceError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ACCEPTANCE_ID = /^reviewed-character-runtime-[a-f0-9]{16}$/;
const ENGINE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{1,95}$/;

function fail(
  code: ReviewedCharacterFamilyRuntimeAcceptanceErrorCode,
  message: string,
): never {
  throw new ReviewedCharacterFamilyRuntimeAcceptanceError(code, message);
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    fail(
      'reviewed-character-runtime.invalid-shape',
      `${label} must contain exactly: ${expected.join(', ')}.`,
    );
  }
}

function id(value: unknown, label: string, maximum = 100): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || !SAFE_ID.test(value)
  ) {
    fail('reviewed-character-runtime.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('reviewed-character-runtime.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function path(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    fail('reviewed-character-runtime.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function integer(
  value: unknown,
  label: string,
  minimum = 1,
  maximum = 536_870_912,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    fail('reviewed-character-runtime.invalid-value', `${label} is invalid.`);
  }
  return value as number;
}

function canonical(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('reviewed-character-runtime.invalid-value', 'Canonical data is non-finite.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!record(value)) {
    fail('reviewed-character-runtime.invalid-value', 'Canonical data has an unsupported type.');
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function materializeMember(
  value: unknown,
  index: number,
): ReviewedCharacterFamilyRuntimeAcceptanceMember {
  if (!record(value)) {
    fail(
      'reviewed-character-runtime.invalid-shape',
      `Runtime acceptance profile ${index} must be an object.`,
    );
  }
  exact(value, [
    'profile',
    'profile_revision_id',
    'revision_path',
    'revision_bytes',
    'revision_sha256',
    'atlas_path',
    'atlas_bytes',
    'atlas_sha256',
    'clip_count',
  ], `Runtime acceptance profile ${index}`);
  const profile = WORLD_ASSET_PROFILES[index];
  if (value.profile !== profile) {
    fail(
      'reviewed-character-runtime.incomplete-profiles',
      `Runtime acceptance profile ${index} must be ${profile}.`,
    );
  }
  const revisionPath = path(value.revision_path, `${profile} revision path`);
  const atlasPath = path(value.atlas_path, `${profile} atlas path`);
  if (
    revisionPath !== `profiles/${profile}/character-profile-revision.json`
    || atlasPath !== `profiles/${profile}/character-profile-atlas.png`
  ) {
    fail(
      'reviewed-character-runtime.binding-mismatch',
      `${profile} runtime artifacts must use canonical family paths.`,
    );
  }
  return Object.freeze({
    profile,
    profile_revision_id: id(value.profile_revision_id, `${profile} revision id`),
    revision_path: revisionPath,
    revision_bytes: integer(
      value.revision_bytes,
      `${profile} revision bytes`,
      1,
      1_048_576,
    ),
    revision_sha256: digest(
      value.revision_sha256,
      `${profile} revision digest`,
    ),
    atlas_path: atlasPath,
    atlas_bytes: integer(value.atlas_bytes, `${profile} atlas bytes`),
    atlas_sha256: digest(value.atlas_sha256, `${profile} atlas digest`),
    clip_count: integer(value.clip_count, `${profile} clip count`, 1, 256),
  });
}

function materializeRun(
  value: unknown,
  index: number,
): ReviewedCharacterFamilyRuntimeRun {
  if (!record(value)) {
    fail(
      'reviewed-character-runtime.invalid-shape',
      `Runtime acceptance run ${index} must be an object.`,
    );
  }
  exact(value, [
    'compatibility_version',
    'engine_version',
    'executable_sha256',
    'host_platform',
    'host_architecture',
    'mode',
    'profiles_loaded',
    'clips_loaded',
    'result',
  ], `Runtime acceptance run ${index}`);
  const compatibilityVersion =
    REVIEWED_CHARACTER_FAMILY_RUNTIME_GODOT_VERSIONS[index];
  if (
    value.compatibility_version !== compatibilityVersion
    || typeof value.engine_version !== 'string'
    || !ENGINE_VERSION.test(value.engine_version)
    || !value.engine_version.startsWith(`${compatibilityVersion}.`)
    || !['windows', 'linux', 'macos'].includes(String(value.host_platform))
    || typeof value.host_architecture !== 'string'
    || value.host_architecture.length < 2
    || value.host_architecture.length > 32
    || !/^[a-z0-9_-]+$/u.test(value.host_architecture)
    || value.mode !== 'headless-character-family-bind'
    || value.profiles_loaded !== 4
    || value.clips_loaded !== 84
    || value.result !== 'pass'
  ) {
    fail(
      'reviewed-character-runtime.invalid-value',
      `Runtime acceptance run ${index} is invalid.`,
    );
  }
  return Object.freeze({
    compatibility_version: compatibilityVersion,
    engine_version: value.engine_version,
    executable_sha256: digest(
      value.executable_sha256,
      `Runtime acceptance run ${index} executable digest`,
    ),
    host_platform:
      value.host_platform as ReviewedCharacterFamilyRuntimeRun['host_platform'],
    host_architecture: value.host_architecture,
    mode: 'headless-character-family-bind',
    profiles_loaded: 4,
    clips_loaded: 84,
    result: 'pass',
  });
}

export function materializeReviewedCharacterFamilyRuntimeAcceptance(
  value: unknown,
): ReviewedCharacterFamilyRuntimeAcceptance {
  if (!record(value)) {
    fail(
      'reviewed-character-runtime.invalid-shape',
      'Reviewed character runtime acceptance must be an object.',
    );
  }
  exact(value, [
    'schema_version',
    'document_type',
    'acceptance_id',
    'family',
    'profiles',
    'runs',
    'privacy',
    'claims',
    'status',
  ], 'Reviewed character runtime acceptance');
  if (
    value.schema_version
      !== REVIEWED_CHARACTER_FAMILY_RUNTIME_ACCEPTANCE_VERSION
    || value.document_type
      !== 'reviewed-character-profile-family-runtime-acceptance'
    || typeof value.acceptance_id !== 'string'
    || !ACCEPTANCE_ID.test(value.acceptance_id)
    || value.status !== 'technical-runtime-pass'
  ) {
    fail(
      'reviewed-character-runtime.invalid-value',
      'Reviewed character runtime acceptance identity is invalid.',
    );
  }
  if (!record(value.family)) {
    fail(
      'reviewed-character-runtime.invalid-shape',
      'Runtime acceptance family binding must be an object.',
    );
  }
  exact(value.family, [
    'family_id',
    'manifest_path',
    'manifest_bytes',
    'manifest_sha256',
    'character_id',
    'character_identity_sha256',
  ], 'Runtime acceptance family binding');
  if (value.family.manifest_path !== 'reviewed-character-profile-family.json') {
    fail(
      'reviewed-character-runtime.binding-mismatch',
      'Runtime acceptance must bind the canonical reviewed-family manifest path.',
    );
  }
  if (!Array.isArray(value.profiles) || value.profiles.length !== 4) {
    fail(
      'reviewed-character-runtime.incomplete-profiles',
      'Runtime acceptance requires exactly four profiles.',
    );
  }
  if (!Array.isArray(value.runs) || value.runs.length !== 2) {
    fail(
      'reviewed-character-runtime.incomplete-runs',
      'Runtime acceptance requires exact Godot 4.3 and 4.7 runs.',
    );
  }
  if (!record(value.privacy)) {
    fail(
      'reviewed-character-runtime.invalid-shape',
      'Runtime acceptance privacy policy is missing.',
    );
  }
  exact(value.privacy, [
    'local_paths_included',
    'source_images_included',
    'raw_engine_output_included',
    'reviewer_identity_included',
  ], 'Runtime acceptance privacy');
  if (
    value.privacy.local_paths_included !== false
    || value.privacy.source_images_included !== false
    || value.privacy.raw_engine_output_included !== false
    || value.privacy.reviewer_identity_included !== false
  ) {
    fail(
      'reviewed-character-runtime.invalid-value',
      'Runtime acceptance must exclude private and raw execution data.',
    );
  }
  if (!record(value.claims)) {
    fail(
      'reviewed-character-runtime.invalid-shape',
      'Runtime acceptance claim boundary is missing.',
    );
  }
  exact(value.claims, [
    'exact_family_artifacts_tested',
    'technical_runtime_compatibility',
    'visual_quality_reassessed',
    'human_art_review_reassessed',
    'physical_raspberry_pi_tested',
  ], 'Runtime acceptance claims');
  if (
    value.claims.exact_family_artifacts_tested !== true
    || value.claims.technical_runtime_compatibility !== 'passed'
    || value.claims.visual_quality_reassessed !== false
    || value.claims.human_art_review_reassessed !== false
    || value.claims.physical_raspberry_pi_tested !== false
  ) {
    fail(
      'reviewed-character-runtime.invalid-value',
      'Runtime acceptance claims exceed the technical Godot test.',
    );
  }
  return Object.freeze({
    schema_version:
      REVIEWED_CHARACTER_FAMILY_RUNTIME_ACCEPTANCE_VERSION,
    document_type:
      'reviewed-character-profile-family-runtime-acceptance',
    acceptance_id: value.acceptance_id,
    family: Object.freeze({
      family_id: id(value.family.family_id, 'Runtime family id'),
      manifest_path: 'reviewed-character-profile-family.json',
      manifest_bytes: integer(
        value.family.manifest_bytes,
        'Runtime family manifest bytes',
        1,
        1_048_576,
      ),
      manifest_sha256: digest(
        value.family.manifest_sha256,
        'Runtime family manifest digest',
      ),
      character_id: id(value.family.character_id, 'Runtime character id'),
      character_identity_sha256: digest(
        value.family.character_identity_sha256,
        'Runtime character identity digest',
      ),
    }),
    profiles: Object.freeze(value.profiles.map(materializeMember)),
    runs: Object.freeze(value.runs.map(materializeRun)),
    privacy: Object.freeze({
      local_paths_included: false,
      source_images_included: false,
      raw_engine_output_included: false,
      reviewer_identity_included: false,
    }),
    claims: Object.freeze({
      exact_family_artifacts_tested: true,
      technical_runtime_compatibility: 'passed',
      visual_quality_reassessed: false,
      human_art_review_reassessed: false,
      physical_raspberry_pi_tested: false,
    }),
    status: 'technical-runtime-pass',
  });
}

function acceptanceSeed(
  value: Omit<ReviewedCharacterFamilyRuntimeAcceptance, 'acceptance_id'>,
): Uint8Array {
  return new TextEncoder().encode(canonical(value));
}

export async function buildReviewedCharacterFamilyRuntimeAcceptance(
  input: BuildReviewedCharacterFamilyRuntimeAcceptanceInput,
): Promise<ReviewedCharacterFamilyRuntimeAcceptance> {
  const family = await verifyReviewedCharacterProfileFamily(
    input.family,
    input.artifacts,
  );
  const canonicalFamilyBytes =
    serializeReviewedCharacterProfileFamilyCanonical(family);
  if (
    input.familyBytes.byteLength !== canonicalFamilyBytes.byteLength
    || input.familyBytes.some((byte, index) =>
      byte !== canonicalFamilyBytes[index])
  ) {
    fail(
      'reviewed-character-runtime.integrity',
      'Runtime acceptance requires the canonical reviewed-family manifest bytes.',
    );
  }
  const draft = Object.freeze({
    schema_version:
      REVIEWED_CHARACTER_FAMILY_RUNTIME_ACCEPTANCE_VERSION,
    document_type:
      'reviewed-character-profile-family-runtime-acceptance' as const,
    family: Object.freeze({
      family_id: family.family_id,
      manifest_path: 'reviewed-character-profile-family.json' as const,
      manifest_bytes: canonicalFamilyBytes.byteLength,
      manifest_sha256:
        await fingerprintReviewedCharacterProfileFamily(family),
      character_id: family.character_id,
      character_identity_sha256: family.character_identity_sha256,
    }),
    profiles: Object.freeze(family.profiles.map((member) => {
      const artifact = input.artifacts[member.profile];
      return Object.freeze({
        profile: member.profile,
        profile_revision_id: member.profile_revision_id,
        revision_path: member.revision_path,
        revision_bytes: artifact.revisionBytes.byteLength,
        revision_sha256: member.revision_sha256,
        atlas_path: member.atlas_path,
        atlas_bytes: artifact.atlasBytes.byteLength,
        atlas_sha256: member.atlas_sha256,
        clip_count: member.clip_count,
      });
    })),
    runs: Object.freeze([...input.runs]),
    privacy: Object.freeze({
      local_paths_included: false as const,
      source_images_included: false as const,
      raw_engine_output_included: false as const,
      reviewer_identity_included: false as const,
    }),
    claims: Object.freeze({
      exact_family_artifacts_tested: true as const,
      technical_runtime_compatibility: 'passed' as const,
      visual_quality_reassessed: false as const,
      human_art_review_reassessed: false as const,
      physical_raspberry_pi_tested: false as const,
    }),
    status: 'technical-runtime-pass' as const,
  });
  const acceptanceId = `reviewed-character-runtime-${
    (await sha256(acceptanceSeed(draft))).slice(0, 16)
  }`;
  return materializeReviewedCharacterFamilyRuntimeAcceptance({
    ...draft,
    acceptance_id: acceptanceId,
  });
}

export function serializeReviewedCharacterFamilyRuntimeAcceptanceCanonical(
  value: unknown,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    canonical(materializeReviewedCharacterFamilyRuntimeAcceptance(value)),
  );
}

export async function fingerprintReviewedCharacterFamilyRuntimeAcceptance(
  value: unknown,
): Promise<string> {
  return sha256(
    serializeReviewedCharacterFamilyRuntimeAcceptanceCanonical(value),
  );
}

export async function verifyReviewedCharacterFamilyRuntimeAcceptance(
  value: unknown,
  familyValue: unknown,
  familyBytes: Uint8Array,
  artifacts: ReviewedCharacterProfileFamilyArtifacts,
): Promise<ReviewedCharacterFamilyRuntimeAcceptance> {
  const acceptance =
    materializeReviewedCharacterFamilyRuntimeAcceptance(value);
  const family = materializeReviewedCharacterProfileFamily(familyValue);
  const rebuilt = await buildReviewedCharacterFamilyRuntimeAcceptance({
    family,
    familyBytes,
    artifacts,
    runs: acceptance.runs,
  });
  if (canonical(rebuilt) !== canonical(acceptance)) {
    fail(
      'reviewed-character-runtime.binding-mismatch',
      'Runtime acceptance does not bind the exact reviewed family and Godot runs.',
    );
  }
  return acceptance;
}
