import {
  CHARACTER_PROFILE_DISTRIBUTIONS,
  CHARACTER_PROFILE_LICENSES,
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  type CharacterProfileDistribution,
  type CharacterProfileLicense,
  type CharacterProfileRevision,
  type CharacterProfileRights,
} from './character-profile-revision';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';

export const CHARACTER_PROFILE_FAMILY_VERSION = '1.0.0' as const;

export interface CharacterProfileFamilyMember {
  readonly profile: WorldAssetProfile;
  readonly profile_revision_id: string;
  readonly revision_path: string;
  readonly revision_sha256: string;
  readonly atlas_path: string;
  readonly atlas_sha256: string;
  readonly clip_count: number;
}

export interface CharacterProfileFamily {
  readonly schema_version: typeof CHARACTER_PROFILE_FAMILY_VERSION;
  readonly document_type: 'character-profile-family';
  readonly family_id: string;
  readonly character_id: string;
  readonly character_identity_sha256: string;
  readonly generation: Readonly<{
    mode: 'procedural-reference-baseline';
    environment_style_signature_sha256: string;
    description_binding_sha256: string;
    seed_binding_sha256: string;
  }>;
  readonly rights: CharacterProfileRights;
  readonly profiles: readonly CharacterProfileFamilyMember[];
  readonly privacy: Readonly<{
    source_images_included: false;
    source_paths_included: false;
    source_file_digests_included: false;
    free_text_description_included: false;
  }>;
  readonly review: Readonly<{
    human_art_review: 'required';
    production_ready: false;
  }>;
  readonly status: CharacterProfileDistribution;
}

export interface CharacterProfileFamilyArtifact {
  readonly revision: unknown;
  readonly revisionBytes: Uint8Array;
  readonly atlasBytes: Uint8Array;
}

export type CharacterProfileFamilyArtifacts =
  Readonly<Record<WorldAssetProfile, CharacterProfileFamilyArtifact>>;

export type CharacterProfileFamilyErrorCode =
  | 'character-family.invalid-shape'
  | 'character-family.invalid-value'
  | 'character-family.invalid-rights'
  | 'character-family.incomplete-profiles'
  | 'character-family.binding-mismatch'
  | 'character-family.integrity';

export class CharacterProfileFamilyError extends Error {
  constructor(
    readonly code: CharacterProfileFamilyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CharacterProfileFamilyError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

function fail(code: CharacterProfileFamilyErrorCode, message: string): never {
  throw new CharacterProfileFamilyError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
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
      'character-family.invalid-shape',
      `${label} must contain exactly: ${wanted.join(', ')}.`,
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
      'character-family.invalid-value',
      `${label} must use bounded lowercase kebab-case.`,
    );
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(
      'character-family.invalid-value',
      `${label} must be a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function safePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    fail(
      'character-family.invalid-value',
      `${label} must be a portable relative path.`,
    );
  }
  return value;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    fail(
      'character-family.invalid-value',
      `${label} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value as number;
}

function rights(value: unknown): CharacterProfileRights {
  if (!isRecord(value)) {
    fail('character-family.invalid-rights', 'Character family rights must be an object.');
  }
  const allowed = new Set(['distribution', 'license', 'attribution']);
  if (
    !Object.hasOwn(value, 'distribution')
    || !Object.hasOwn(value, 'license')
    || Object.keys(value).some((key) => !allowed.has(key))
    || !CHARACTER_PROFILE_DISTRIBUTIONS.includes(
      value.distribution as CharacterProfileDistribution,
    )
    || !CHARACTER_PROFILE_LICENSES.includes(value.license as CharacterProfileLicense)
  ) {
    fail('character-family.invalid-rights', 'Character family rights are unsupported.');
  }
  const distribution = value.distribution as CharacterProfileDistribution;
  const license = value.license as CharacterProfileLicense;
  if (distribution === 'public' && license === 'LicenseRef-Proprietary') {
    fail(
      'character-family.invalid-rights',
      'A public character family cannot use LicenseRef-Proprietary.',
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
    fail('character-family.invalid-rights', 'Character family attribution is invalid.');
  }
  if (
    (license === 'CC-BY-4.0' || license === 'CC-BY-SA-4.0')
    && attribution === undefined
  ) {
    fail(
      'character-family.invalid-rights',
      `${license} requires attribution.`,
    );
  }
  return Object.freeze({
    distribution,
    license,
    ...(attribution === undefined ? {} : { attribution }),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('character-family.invalid-value', 'Canonical family data contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('character-family.invalid-value', 'Canonical family data contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const hash = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function materializeCharacterProfileFamily(value: unknown): CharacterProfileFamily {
  if (!isRecord(value)) {
    fail('character-family.invalid-shape', 'Character profile family must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'family_id',
    'character_id',
    'character_identity_sha256',
    'generation',
    'rights',
    'profiles',
    'privacy',
    'review',
    'status',
  ], 'Character profile family');
  if (
    value.schema_version !== CHARACTER_PROFILE_FAMILY_VERSION
    || value.document_type !== 'character-profile-family'
  ) {
    fail('character-family.invalid-value', 'Character profile family must use contract 1.0.0.');
  }

  if (!isRecord(value.generation)) {
    fail('character-family.invalid-shape', 'Character family generation must be an object.');
  }
  exactKeys(value.generation, [
    'mode',
    'environment_style_signature_sha256',
    'description_binding_sha256',
    'seed_binding_sha256',
  ], 'Character family generation');
  if (value.generation.mode !== 'procedural-reference-baseline') {
    fail('character-family.invalid-value', 'Character family generation mode is unsupported.');
  }
  const generation = Object.freeze({
    mode: 'procedural-reference-baseline' as const,
    environment_style_signature_sha256: digest(
      value.generation.environment_style_signature_sha256,
      'Environment style signature',
    ),
    description_binding_sha256: digest(
      value.generation.description_binding_sha256,
      'Description binding',
    ),
    seed_binding_sha256: digest(value.generation.seed_binding_sha256, 'Seed binding'),
  });

  const familyRights = rights(value.rights);
  if (
    !CHARACTER_PROFILE_DISTRIBUTIONS.includes(value.status as CharacterProfileDistribution)
    || value.status !== familyRights.distribution
  ) {
    fail(
      'character-family.invalid-rights',
      'Character family status must equal its rights distribution.',
    );
  }

  if (!Array.isArray(value.profiles) || value.profiles.length !== WORLD_ASSET_PROFILES.length) {
    fail(
      'character-family.incomplete-profiles',
      'Character family requires exactly four profile members.',
    );
  }
  const profiles = Object.freeze(value.profiles.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('character-family.invalid-shape', `Character family profile ${index} must be an object.`);
    }
    exactKeys(candidate, [
      'profile',
      'profile_revision_id',
      'revision_path',
      'revision_sha256',
      'atlas_path',
      'atlas_sha256',
      'clip_count',
    ], `Character family profile ${index}`);
    const expectedProfile = WORLD_ASSET_PROFILES[index];
    if (candidate.profile !== expectedProfile) {
      fail(
        'character-family.incomplete-profiles',
        `Character family profile ${index} must be ${expectedProfile}.`,
      );
    }
    const revisionPath = safePath(candidate.revision_path, `Profile ${index} revision path`);
    const atlasPath = safePath(candidate.atlas_path, `Profile ${index} atlas path`);
    if (
      revisionPath !== `profiles/${expectedProfile}/character-profile-revision.json`
      || atlasPath !== `profiles/${expectedProfile}/character-profile-atlas.png`
    ) {
      fail(
        'character-family.invalid-value',
        `Profile ${expectedProfile} must use its canonical family artifact paths.`,
      );
    }
    return Object.freeze({
      profile: expectedProfile,
      profile_revision_id: id(
        candidate.profile_revision_id,
        `Profile ${index} revision id`,
      ),
      revision_path: revisionPath,
      revision_sha256: digest(
        candidate.revision_sha256,
        `Profile ${index} revision digest`,
      ),
      atlas_path: atlasPath,
      atlas_sha256: digest(candidate.atlas_sha256, `Profile ${index} atlas digest`),
      clip_count: integer(candidate.clip_count, 1, 256, `Profile ${index} clip count`),
    });
  }));
  if (
    new Set(profiles.map(({ profile_revision_id: revisionId }) => revisionId)).size
      !== profiles.length
    || new Set(profiles.map(({ revision_path: path }) => path)).size !== profiles.length
    || new Set(profiles.map(({ atlas_path: path }) => path)).size !== profiles.length
  ) {
    fail(
      'character-family.invalid-value',
      'Character family revision ids and artifact paths must be unique.',
    );
  }

  if (!isRecord(value.privacy)) {
    fail('character-family.invalid-shape', 'Character family privacy must be an object.');
  }
  exactKeys(value.privacy, [
    'source_images_included',
    'source_paths_included',
    'source_file_digests_included',
    'free_text_description_included',
  ], 'Character family privacy');
  if (
    value.privacy.source_images_included !== false
    || value.privacy.source_paths_included !== false
    || value.privacy.source_file_digests_included !== false
    || value.privacy.free_text_description_included !== false
  ) {
    fail(
      'character-family.invalid-value',
      'Character family exports must exclude source images and private source metadata.',
    );
  }

  if (!isRecord(value.review)) {
    fail('character-family.invalid-shape', 'Character family review must be an object.');
  }
  exactKeys(value.review, ['human_art_review', 'production_ready'], 'Character family review');
  if (
    value.review.human_art_review !== 'required'
    || value.review.production_ready !== false
  ) {
    fail(
      'character-family.invalid-value',
      'Procedural character families must remain pending human art review.',
    );
  }

  return Object.freeze({
    schema_version: CHARACTER_PROFILE_FAMILY_VERSION,
    document_type: 'character-profile-family',
    family_id: id(value.family_id, 'Character family id'),
    character_id: id(value.character_id, 'Character id'),
    character_identity_sha256: digest(
      value.character_identity_sha256,
      'Character identity digest',
    ),
    generation,
    rights: familyRights,
    profiles,
    privacy: Object.freeze({
      source_images_included: false,
      source_paths_included: false,
      source_file_digests_included: false,
      free_text_description_included: false,
    }),
    review: Object.freeze({
      human_art_review: 'required',
      production_ready: false,
    }),
    status: familyRights.distribution,
  });
}

export function serializeCharacterProfileFamilyCanonical(
  value: unknown,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson(materializeCharacterProfileFamily(value)));
}

export async function fingerprintCharacterProfileFamily(value: unknown): Promise<string> {
  return sha256(serializeCharacterProfileFamilyCanonical(value));
}

export async function verifyCharacterProfileFamily(
  value: unknown,
  artifacts: CharacterProfileFamilyArtifacts,
): Promise<CharacterProfileFamily> {
  const family = materializeCharacterProfileFamily(value);
  const actualKeys = Object.keys(artifacts).sort();
  const expectedKeys = [...WORLD_ASSET_PROFILES].sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(
      'character-family.incomplete-profiles',
      'Character family verification requires exactly four profile artifact sets.',
    );
  }
  await Promise.all(family.profiles.map(async (member) => {
    const artifact = artifacts[member.profile];
    const revision = materializeCharacterProfileRevision(artifact.revision);
    const [revisionBytesSha256, revisionFingerprint, atlasSha256] = await Promise.all([
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
      || canonicalJson(revision.rights) !== canonicalJson(family.rights)
      || revision.clips.length !== member.clip_count
      || revision.atlas.path !== 'character-profile-atlas.png'
    ) {
      fail(
        'character-family.binding-mismatch',
        `${member.profile} character revision does not bind the family identity and policy.`,
      );
    }
    if (
      revisionBytesSha256 !== member.revision_sha256
      || revisionFingerprint !== member.revision_sha256
      || atlasSha256 !== member.atlas_sha256
      || revision.atlas.sha256 !== member.atlas_sha256
      || revision.atlas.bytes !== artifact.atlasBytes.byteLength
    ) {
      fail(
        'character-family.integrity',
        `${member.profile} character artifacts do not match the family inventory.`,
      );
    }
  }));
  return family;
}
