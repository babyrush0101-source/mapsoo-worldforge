import {
  CHARACTER_PROFILE_LICENSES,
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  type CharacterProfileLicense,
  type CharacterProfileRevision,
  type CharacterProfileRights,
} from './character-profile-revision';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';

export const REVIEWED_CHARACTER_PROFILE_FAMILY_VERSION = '1.0.0' as const;

export interface ReviewedCharacterProfileFamilyMember {
  readonly profile: WorldAssetProfile;
  readonly profile_revision_id: string;
  readonly revision_path: string;
  readonly revision_sha256: string;
  readonly atlas_path: string;
  readonly atlas_sha256: string;
  readonly clip_count: number;
  readonly reviewed_source: Readonly<{
    source_profile_revision_id: string;
    source_profile_revision_sha256: string;
    production_character_projection_sha256: string;
    runtime_overlay_sha256: string;
    runtime_projection_sha256: string;
    human_review_receipt_sha256: string;
    approved_world_review_sha256: string;
  }>;
}

export interface ReviewedCharacterProfileFamily {
  readonly schema_version: typeof REVIEWED_CHARACTER_PROFILE_FAMILY_VERSION;
  readonly document_type: 'reviewed-character-profile-family';
  readonly family_id: string;
  readonly character_id: string;
  readonly character_identity_sha256: string;
  readonly rights: CharacterProfileRights & Readonly<{
    distribution: 'private' | 'public';
  }>;
  readonly profiles: readonly ReviewedCharacterProfileFamilyMember[];
  readonly privacy: Readonly<{
    source_images_included: false;
    source_paths_included: false;
    raw_prompts_included: false;
    provider_credentials_included: false;
  }>;
  readonly review: Readonly<{
    technical_world_review: 'passed';
    human_art_review: 'passed';
    exact_profile_count: 4;
    godot_family_runtime: 'pending';
    raspberry_pi: 'pending';
  }>;
  readonly status: 'reviewed-release-candidate';
}

export interface ReviewedCharacterProfileFamilyArtifact {
  readonly revision: unknown;
  readonly revisionBytes: Uint8Array;
  readonly atlasBytes: Uint8Array;
}

export type ReviewedCharacterProfileFamilyArtifacts = Readonly<Record<
WorldAssetProfile,
ReviewedCharacterProfileFamilyArtifact
>>;

export type ReviewedCharacterProfileFamilyErrorCode =
  | 'reviewed-character-family.invalid-shape'
  | 'reviewed-character-family.invalid-value'
  | 'reviewed-character-family.invalid-rights'
  | 'reviewed-character-family.incomplete-profiles'
  | 'reviewed-character-family.binding-mismatch'
  | 'reviewed-character-family.integrity';

export class ReviewedCharacterProfileFamilyError extends Error {
  constructor(
    readonly code: ReviewedCharacterProfileFamilyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewedCharacterProfileFamilyError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

function fail(
  code: ReviewedCharacterProfileFamilyErrorCode,
  message: string,
): never {
  throw new ReviewedCharacterProfileFamilyError(code, message);
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  label = 'Object',
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) {
    fail(
      'reviewed-character-family.invalid-shape',
      `${label} must contain only its declared fields.`,
    );
  }
}

function id(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 100
    || !SAFE_ID.test(value)
  ) {
    fail(
      'reviewed-character-family.invalid-value',
      `${label} must use bounded lowercase kebab-case.`,
    );
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(
      'reviewed-character-family.invalid-value',
      `${label} must be lowercase SHA-256.`,
    );
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
    fail(
      'reviewed-character-family.invalid-value',
      `${label} must be a portable relative path.`,
    );
  }
  return value;
}

function integer(value: unknown, label: string, maximum = 256): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail(
      'reviewed-character-family.invalid-value',
      `${label} must be a bounded positive integer.`,
    );
  }
  return value as number;
}

function rights(value: unknown): ReviewedCharacterProfileFamily['rights'] {
  if (!record(value)) {
    fail('reviewed-character-family.invalid-rights', 'Reviewed family rights must be an object.');
  }
  exact(value, ['distribution', 'license'], ['attribution'], 'Reviewed family rights');
  if (
    value.distribution !== 'private'
    && value.distribution !== 'public'
  ) {
    fail(
      'reviewed-character-family.invalid-rights',
      'Reviewed family distribution must be private or public.',
    );
  }
  if (
    !CHARACTER_PROFILE_LICENSES.includes(value.license as CharacterProfileLicense)
    || (
      value.distribution === 'private'
      && value.license !== 'LicenseRef-Proprietary'
    )
    || (
      value.distribution === 'public'
      && value.license === 'LicenseRef-Proprietary'
    )
  ) {
    fail(
      'reviewed-character-family.invalid-rights',
      'Reviewed family license does not match its distribution.',
    );
  }
  const attribution = value.attribution;
  if (
    attribution !== undefined
    && (
      typeof attribution !== 'string'
      || attribution.length < 1
      || attribution.length > 500
      || attribution !== attribution.trim()
      || CONTROL_CHARACTER.test(attribution)
    )
  ) {
    fail('reviewed-character-family.invalid-rights', 'Reviewed family attribution is invalid.');
  }
  if (
    (value.license === 'CC-BY-4.0' || value.license === 'CC-BY-SA-4.0')
    && attribution === undefined
  ) {
    fail('reviewed-character-family.invalid-rights', `${value.license} requires attribution.`);
  }
  return Object.freeze({
    distribution: value.distribution,
    license: value.license as CharacterProfileLicense,
    ...(attribution === undefined ? {} : { attribution }),
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('reviewed-character-family.invalid-value', 'Canonical data is non-finite.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!record(value)) {
    fail('reviewed-character-family.invalid-value', 'Canonical data has an unsupported type.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonical(value[key])}`
  )).join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const hash = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function materializeReviewedCharacterProfileFamily(
  value: unknown,
): ReviewedCharacterProfileFamily {
  if (!record(value)) {
    fail('reviewed-character-family.invalid-shape', 'Reviewed family must be an object.');
  }
  exact(value, [
    'schema_version',
    'document_type',
    'family_id',
    'character_id',
    'character_identity_sha256',
    'rights',
    'profiles',
    'privacy',
    'review',
    'status',
  ], [], 'Reviewed family');
  if (
    value.schema_version !== REVIEWED_CHARACTER_PROFILE_FAMILY_VERSION
    || value.document_type !== 'reviewed-character-profile-family'
    || value.status !== 'reviewed-release-candidate'
  ) {
    fail('reviewed-character-family.invalid-value', 'Reviewed family identity is invalid.');
  }
  const familyRights = rights(value.rights);

  if (!Array.isArray(value.profiles) || value.profiles.length !== 4) {
    fail(
      'reviewed-character-family.incomplete-profiles',
      'Reviewed family requires exactly four profile members.',
    );
  }
  const profiles = Object.freeze(value.profiles.map((candidate, index) => {
    if (!record(candidate)) {
      fail('reviewed-character-family.invalid-shape', `Profile ${index} must be an object.`);
    }
    exact(candidate, [
      'profile',
      'profile_revision_id',
      'revision_path',
      'revision_sha256',
      'atlas_path',
      'atlas_sha256',
      'clip_count',
      'reviewed_source',
    ], [], `Profile ${index}`);
    const profile = WORLD_ASSET_PROFILES[index];
    if (candidate.profile !== profile) {
      fail(
        'reviewed-character-family.incomplete-profiles',
        `Profile ${index} must be ${profile}.`,
      );
    }
    const revisionPath = path(candidate.revision_path, `Profile ${index} revision path`);
    const atlasPath = path(candidate.atlas_path, `Profile ${index} atlas path`);
    if (
      revisionPath !== `profiles/${profile}/character-profile-revision.json`
      || atlasPath !== `profiles/${profile}/character-profile-atlas.png`
    ) {
      fail(
        'reviewed-character-family.invalid-value',
        `${profile} must use canonical reviewed-family artifact paths.`,
      );
    }
    if (!record(candidate.reviewed_source)) {
      fail(
        'reviewed-character-family.invalid-shape',
        `${profile} reviewed source must be an object.`,
      );
    }
    exact(candidate.reviewed_source, [
      'source_profile_revision_id',
      'source_profile_revision_sha256',
      'production_character_projection_sha256',
      'runtime_overlay_sha256',
      'runtime_projection_sha256',
      'human_review_receipt_sha256',
      'approved_world_review_sha256',
    ], [], `${profile} reviewed source`);
    return Object.freeze({
      profile,
      profile_revision_id: id(candidate.profile_revision_id, `${profile} revision id`),
      revision_path: revisionPath,
      revision_sha256: digest(candidate.revision_sha256, `${profile} revision digest`),
      atlas_path: atlasPath,
      atlas_sha256: digest(candidate.atlas_sha256, `${profile} atlas digest`),
      clip_count: integer(candidate.clip_count, `${profile} clip count`),
      reviewed_source: Object.freeze({
        source_profile_revision_id: id(
          candidate.reviewed_source.source_profile_revision_id,
          `${profile} source revision id`,
        ),
        source_profile_revision_sha256: digest(
          candidate.reviewed_source.source_profile_revision_sha256,
          `${profile} source revision digest`,
        ),
        production_character_projection_sha256: digest(
          candidate.reviewed_source.production_character_projection_sha256,
          `${profile} character projection digest`,
        ),
        runtime_overlay_sha256: digest(
          candidate.reviewed_source.runtime_overlay_sha256,
          `${profile} runtime overlay digest`,
        ),
        runtime_projection_sha256: digest(
          candidate.reviewed_source.runtime_projection_sha256,
          `${profile} runtime projection digest`,
        ),
        human_review_receipt_sha256: digest(
          candidate.reviewed_source.human_review_receipt_sha256,
          `${profile} human review digest`,
        ),
        approved_world_review_sha256: digest(
          candidate.reviewed_source.approved_world_review_sha256,
          `${profile} approved world review digest`,
        ),
      }),
    });
  }));
  if (
    new Set(profiles.map(({ profile_revision_id: revisionId }) => revisionId)).size !== 4
    || new Set(profiles.map(({ revision_path: revisionPath }) => revisionPath)).size !== 4
    || new Set(profiles.map(({ atlas_path: atlasPath }) => atlasPath)).size !== 4
  ) {
    fail(
      'reviewed-character-family.invalid-value',
      'Reviewed family revision ids and paths must be unique.',
    );
  }

  if (!record(value.privacy)) {
    fail('reviewed-character-family.invalid-shape', 'Reviewed family privacy is missing.');
  }
  exact(value.privacy, [
    'source_images_included',
    'source_paths_included',
    'raw_prompts_included',
    'provider_credentials_included',
  ], [], 'Reviewed family privacy');
  if (
    value.privacy.source_images_included !== false
    || value.privacy.source_paths_included !== false
    || value.privacy.raw_prompts_included !== false
    || value.privacy.provider_credentials_included !== false
  ) {
    fail(
      'reviewed-character-family.invalid-value',
      'Reviewed families must exclude private source and provider data.',
    );
  }

  if (!record(value.review)) {
    fail('reviewed-character-family.invalid-shape', 'Reviewed family review is missing.');
  }
  exact(value.review, [
    'technical_world_review',
    'human_art_review',
    'exact_profile_count',
    'godot_family_runtime',
    'raspberry_pi',
  ], [], 'Reviewed family review');
  if (
    value.review.technical_world_review !== 'passed'
    || value.review.human_art_review !== 'passed'
    || value.review.exact_profile_count !== 4
    || value.review.godot_family_runtime !== 'pending'
    || value.review.raspberry_pi !== 'pending'
  ) {
    fail(
      'reviewed-character-family.invalid-value',
      'Reviewed family gates must preserve pending runtime and Raspberry Pi acceptance.',
    );
  }

  return Object.freeze({
    schema_version: REVIEWED_CHARACTER_PROFILE_FAMILY_VERSION,
    document_type: 'reviewed-character-profile-family',
    family_id: id(value.family_id, 'Reviewed family id'),
    character_id: id(value.character_id, 'Character id'),
    character_identity_sha256: digest(
      value.character_identity_sha256,
      'Character identity digest',
    ),
    rights: familyRights,
    profiles,
    privacy: Object.freeze({
      source_images_included: false,
      source_paths_included: false,
      raw_prompts_included: false,
      provider_credentials_included: false,
    }),
    review: Object.freeze({
      technical_world_review: 'passed',
      human_art_review: 'passed',
      exact_profile_count: 4,
      godot_family_runtime: 'pending',
      raspberry_pi: 'pending',
    }),
    status: 'reviewed-release-candidate',
  });
}

export function serializeReviewedCharacterProfileFamilyCanonical(
  value: unknown,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    canonical(materializeReviewedCharacterProfileFamily(value)),
  );
}

export async function fingerprintReviewedCharacterProfileFamily(
  value: unknown,
): Promise<string> {
  return sha256(serializeReviewedCharacterProfileFamilyCanonical(value));
}

export async function verifyReviewedCharacterProfileFamily(
  value: unknown,
  artifacts: ReviewedCharacterProfileFamilyArtifacts,
): Promise<ReviewedCharacterProfileFamily> {
  const family = materializeReviewedCharacterProfileFamily(value);
  const keys = Object.keys(artifacts).sort();
  const expected = [...WORLD_ASSET_PROFILES].sort();
  if (keys.length !== 4 || keys.some((key, index) => key !== expected[index])) {
    fail(
      'reviewed-character-family.incomplete-profiles',
      'Reviewed family verification requires four exact artifact sets.',
    );
  }
  await Promise.all(family.profiles.map(async (member) => {
    const artifact = artifacts[member.profile];
    const revision = materializeCharacterProfileRevision(artifact.revision);
    const [revisionFileSha256, revisionFingerprint, atlasSha256] = await Promise.all([
      sha256(artifact.revisionBytes),
      fingerprintCharacterProfileRevision(revision),
      sha256(artifact.atlasBytes),
    ]);
    if (
      revision.profile !== member.profile
      || revision.profile_revision_id !== member.profile_revision_id
      || revision.character_id !== family.character_id
      || revision.source_identity.identity_digest_sha256
        !== family.character_identity_sha256
      || canonical(revision.rights) !== canonical(family.rights)
      || revision.clips.length !== member.clip_count
      || revision.atlas.path !== 'character-profile-atlas.png'
    ) {
      fail(
        'reviewed-character-family.binding-mismatch',
        `${member.profile} reviewed revision does not bind the family.`,
      );
    }
    if (
      revisionFileSha256 !== member.revision_sha256
      || revisionFingerprint !== member.revision_sha256
      || atlasSha256 !== member.atlas_sha256
      || revision.atlas.sha256 !== member.atlas_sha256
      || revision.atlas.bytes !== artifact.atlasBytes.byteLength
    ) {
      fail(
        'reviewed-character-family.integrity',
        `${member.profile} reviewed artifacts changed.`,
      );
    }
  }));
  return family;
}
