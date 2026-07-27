import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';
import {
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  type CharacterProfileRevision,
} from './character-profile-revision';
import {
  fingerprintConfirmedWorldCreationIntake,
  materializeConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
  type WorldCreationIntakeTarget,
} from './confirmed-world-creation-intake';
import type { ReferenceImageDescriptor } from './reference-image';

export const WORLD_FAMILY_CONTINUITY_VERSION = '1.0.0' as const;

export interface WorldFamilyContinuityProfileBinding {
  readonly profile: WorldAssetProfile;
  readonly intake_id: string;
  readonly intake_sha256: string;
  readonly character_profile_revision_id: string;
  readonly character_profile_revision_sha256: string;
}

export interface WorldFamilyContinuity {
  readonly schema_version: typeof WORLD_FAMILY_CONTINUITY_VERSION;
  readonly document_type: 'world-family-continuity';
  readonly family_id: string;
  readonly target: WorldCreationIntakeTarget;
  readonly world_identity_sha256: string;
  readonly character_id: string;
  readonly character_identity_sha256: string;
  readonly profiles: readonly WorldFamilyContinuityProfileBinding[];
  readonly status: 'continuity-confirmed';
}

export interface WorldFamilyContinuitySource {
  readonly intake: unknown;
  readonly character_revision: unknown;
}

export type WorldFamilyContinuitySources =
  Readonly<Record<WorldAssetProfile, WorldFamilyContinuitySource>>;

export type WorldFamilyContinuityErrorCode =
  | 'world-family.invalid-shape'
  | 'world-family.invalid-value'
  | 'world-family.incomplete-profiles'
  | 'world-family.profile-mismatch'
  | 'world-family.world-drift'
  | 'world-family.character-drift'
  | 'world-family.binding-mismatch';

export class WorldFamilyContinuityError extends Error {
  constructor(readonly code: WorldFamilyContinuityErrorCode, message: string) {
    super(message);
    this.name = 'WorldFamilyContinuityError';
  }
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TARGETS: readonly WorldCreationIntakeTarget[] = [
  'desktop',
  'raspberry-pi-4b',
  'web',
];

function fail(code: WorldFamilyContinuityErrorCode, message: string): never {
  throw new WorldFamilyContinuityError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('world-family.invalid-shape', `${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 100 || !ID.test(value)) {
    fail('world-family.invalid-value', `${label} must be bounded lowercase kebab-case.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('world-family.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('world-family.invalid-value', 'Canonical value contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('world-family.invalid-value', 'Canonical value contains an unsupported type.');
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function referenceByRole(
  intake: ConfirmedWorldCreationIntake,
  role: ReferenceImageDescriptor['role'],
): ReferenceImageDescriptor {
  const reference = intake.references.find((candidate) => candidate.role === role);
  if (!reference) fail('world-family.invalid-value', `Confirmed intake lacks the ${role} reference.`);
  return reference;
}

function worldIdentityPayload(intake: ConfirmedWorldCreationIntake): unknown {
  const { facts } = intake;
  return {
    domain: 'mapsoo-world-family/world-identity/v1',
    seed: intake.seed,
    facts: {
      premise: facts.premise,
      worldview: facts.worldview,
      terrain: facts.terrain,
      culture: facts.culture,
      ecology: facts.ecology,
      mood: facts.mood,
      landmarks: facts.landmarks,
    },
    environment_reference: referenceByRole(intake, 'environment-style'),
  };
}

function characterSourcePayload(
  intake: ConfirmedWorldCreationIntake,
  revision: CharacterProfileRevision,
): unknown {
  return {
    domain: 'mapsoo-world-family/character-source/v1',
    character_id: revision.character_id,
    identity_digest_sha256: revision.source_identity.identity_digest_sha256,
    source_reference_ids: revision.source_identity.source_reference_ids,
    character_reference: referenceByRole(intake, 'character'),
    rights: revision.rights,
  };
}

async function materializeSources(
  sourcesValue: unknown,
): Promise<Readonly<Record<WorldAssetProfile, Readonly<{
  intake: ConfirmedWorldCreationIntake;
  revision: CharacterProfileRevision;
}>>>> {
  if (!isRecord(sourcesValue)) {
    fail('world-family.invalid-shape', 'World family sources must be a profile-keyed object.');
  }
  exactKeys(sourcesValue, WORLD_ASSET_PROFILES, 'World family sources');
  const pairs = await Promise.all(WORLD_ASSET_PROFILES.map(async (profile) => {
    const source = sourcesValue[profile];
    if (!isRecord(source)) fail('world-family.invalid-shape', `${profile} source must be an object.`);
    exactKeys(source, ['intake', 'character_revision'], `${profile} source`);
    const [intake, revision] = await Promise.all([
      materializeConfirmedWorldCreationIntake(source.intake),
      Promise.resolve(materializeCharacterProfileRevision(source.character_revision)),
    ]);
    if (intake.profile !== profile || revision.profile !== profile) {
      fail('world-family.profile-mismatch', `${profile} source documents must both target that profile.`);
    }
    if (
      intake.character_source.identity_digest_sha256
        !== revision.source_identity.identity_digest_sha256
      || !revision.source_identity.source_reference_ids.includes(
        intake.character_source.reference_id,
      )
    ) {
      fail(
        'world-family.character-drift',
        `${profile} character revision does not bind the confirmed character source.`,
      );
    }
    return [profile, Object.freeze({ intake, revision })] as const;
  }));
  return Object.freeze(Object.fromEntries(pairs)) as Readonly<Record<
  WorldAssetProfile,
  Readonly<{ intake: ConfirmedWorldCreationIntake; revision: CharacterProfileRevision }>
  >>;
}

export async function createWorldFamilyContinuity(
  familyIdValue: string,
  sourcesValue: unknown,
): Promise<WorldFamilyContinuity> {
  const familyId = id(familyIdValue, 'World family id');
  const sources = await materializeSources(sourcesValue);
  const first = sources[WORLD_ASSET_PROFILES[0]];
  const target = first.intake.target;
  const worldPayload = canonicalJson(worldIdentityPayload(first.intake));
  const characterPayload = canonicalJson(characterSourcePayload(first.intake, first.revision));

  for (const profile of WORLD_ASSET_PROFILES.slice(1)) {
    const { intake, revision } = sources[profile];
    if (intake.target !== target || canonicalJson(worldIdentityPayload(intake)) !== worldPayload) {
      fail(
        'world-family.world-drift',
        'All profiles must preserve one target, seed, world identity, landmarks, and environment reference.',
      );
    }
    if (canonicalJson(characterSourcePayload(intake, revision)) !== characterPayload) {
      fail(
        'world-family.character-drift',
        'All profiles must preserve one character id, identity, source reference, and rights basis.',
      );
    }
  }

  const profiles = Object.freeze(await Promise.all(WORLD_ASSET_PROFILES.map(async (profile) => {
    const { intake, revision } = sources[profile];
    return Object.freeze({
      profile,
      intake_id: intake.intake_id,
      intake_sha256: await fingerprintConfirmedWorldCreationIntake(intake),
      character_profile_revision_id: revision.profile_revision_id,
      character_profile_revision_sha256: await fingerprintCharacterProfileRevision(revision),
    });
  })));

  return Object.freeze({
    schema_version: WORLD_FAMILY_CONTINUITY_VERSION,
    document_type: 'world-family-continuity',
    family_id: familyId,
    target,
    world_identity_sha256: await sha256(JSON.parse(worldPayload)),
    character_id: first.revision.character_id,
    character_identity_sha256: first.revision.source_identity.identity_digest_sha256,
    profiles,
    status: 'continuity-confirmed',
  });
}

export function materializeWorldFamilyContinuity(value: unknown): WorldFamilyContinuity {
  if (!isRecord(value)) fail('world-family.invalid-shape', 'World family continuity must be an object.');
  exactKeys(value, [
    'schema_version',
    'document_type',
    'family_id',
    'target',
    'world_identity_sha256',
    'character_id',
    'character_identity_sha256',
    'profiles',
    'status',
  ], 'World family continuity');
  if (
    value.schema_version !== WORLD_FAMILY_CONTINUITY_VERSION
    || value.document_type !== 'world-family-continuity'
    || value.status !== 'continuity-confirmed'
    || !TARGETS.includes(value.target as WorldCreationIntakeTarget)
  ) {
    fail('world-family.invalid-value', 'World family continuity identity, target, or status is unsupported.');
  }
  if (!Array.isArray(value.profiles) || value.profiles.length !== WORLD_ASSET_PROFILES.length) {
    fail('world-family.incomplete-profiles', 'World family continuity requires exactly four profile bindings.');
  }
  const profiles = Object.freeze(value.profiles.map((candidate, index) => {
    if (!isRecord(candidate)) fail('world-family.invalid-shape', `Profile binding ${index} must be an object.`);
    exactKeys(candidate, [
      'profile',
      'intake_id',
      'intake_sha256',
      'character_profile_revision_id',
      'character_profile_revision_sha256',
    ], `Profile binding ${index}`);
    if (candidate.profile !== WORLD_ASSET_PROFILES[index]) {
      fail(
        'world-family.incomplete-profiles',
        `Profile binding ${index} must be ${WORLD_ASSET_PROFILES[index]}.`,
      );
    }
    return Object.freeze({
      profile: candidate.profile,
      intake_id: id(candidate.intake_id, `Profile binding ${index} intake id`),
      intake_sha256: digest(candidate.intake_sha256, `Profile binding ${index} intake digest`),
      character_profile_revision_id: id(
        candidate.character_profile_revision_id,
        `Profile binding ${index} character revision id`,
      ),
      character_profile_revision_sha256: digest(
        candidate.character_profile_revision_sha256,
        `Profile binding ${index} character revision digest`,
      ),
    }) as WorldFamilyContinuityProfileBinding;
  }));
  return Object.freeze({
    schema_version: WORLD_FAMILY_CONTINUITY_VERSION,
    document_type: 'world-family-continuity',
    family_id: id(value.family_id, 'World family id'),
    target: value.target as WorldCreationIntakeTarget,
    world_identity_sha256: digest(value.world_identity_sha256, 'World identity digest'),
    character_id: id(value.character_id, 'Character id'),
    character_identity_sha256: digest(value.character_identity_sha256, 'Character identity digest'),
    profiles,
    status: 'continuity-confirmed',
  });
}

export async function verifyWorldFamilyContinuity(
  value: unknown,
  sourcesValue: unknown,
): Promise<WorldFamilyContinuity> {
  const stored = materializeWorldFamilyContinuity(value);
  const expected = await createWorldFamilyContinuity(stored.family_id, sourcesValue);
  if (canonicalJson(stored) !== canonicalJson(expected)) {
    fail(
      'world-family.binding-mismatch',
      'World family continuity does not match the supplied confirmed intakes and character revisions.',
    );
  }
  return stored;
}
