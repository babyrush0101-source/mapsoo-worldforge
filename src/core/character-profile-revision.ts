import {
  ISOMETRIC_ACTION_DIRECTIONS,
  ISOMETRIC_PLAYER_ACTIONS,
} from './isometric-action-asset-bundle';
import {
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
} from './layered-depth-asset-bundle';
import {
  SIDE_PLATFORMER_ACTIONS,
  SIDE_PLATFORMER_DIRECTIONS,
} from './side-platformer-asset-bundle';
import {
  materializePortableWorldRuntimeContract,
  type PortableRuntimeBindPayload,
  type PortableWorldRuntimeContract,
} from './portable-world-runtime-contract';
import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';
import type {
  CharacterAction,
  CharacterDirection,
} from './generated-asset-bundle';

export const CHARACTER_PROFILE_REVISION_VERSION = '1.0.0' as const;
export const CHARACTER_PROFILE_BIND_VERSION = '1.0.0' as const;

export const CHARACTER_PROFILE_DISTRIBUTIONS = Object.freeze(['private', 'public'] as const);
export const CHARACTER_PROFILE_LICENSES = Object.freeze([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'LicenseRef-Proprietary',
] as const);

export type CharacterProfileDistribution = typeof CHARACTER_PROFILE_DISTRIBUTIONS[number];
export type CharacterProfileLicense = typeof CHARACTER_PROFILE_LICENSES[number];

export interface CharacterProfileRights {
  readonly distribution: CharacterProfileDistribution;
  readonly license: CharacterProfileLicense;
  readonly attribution?: string;
}

export interface CharacterProfileClip {
  readonly clip_id: string;
  readonly action: CharacterAction;
  readonly direction: CharacterDirection;
  readonly fps: number;
  readonly loop: boolean;
  readonly frames: readonly Readonly<{
    column: number;
    row: number;
  }>[];
}

export interface CharacterProfileRevision {
  readonly schema_version: typeof CHARACTER_PROFILE_REVISION_VERSION;
  readonly document_type: 'character-profile-revision';
  readonly profile_revision_id: string;
  readonly character_id: string;
  readonly profile: WorldAssetProfile;
  readonly atlas: Readonly<{
    path: string;
    media_type: 'image/png';
    bytes: number;
    sha256: string;
    width: number;
    height: number;
  }>;
  readonly frame_geometry: Readonly<{
    frame_width: number;
    frame_height: number;
    columns: number;
    rows: number;
  }>;
  readonly pivot: Readonly<{
    x: number;
    y: number;
    unit: 'pixels';
  }>;
  readonly clips: readonly CharacterProfileClip[];
  readonly source_identity: Readonly<{
    identity_digest_sha256: string;
    source_reference_ids: readonly string[];
  }>;
  readonly rights: CharacterProfileRights;
}

export interface CharacterProfileBindPayload {
  readonly contract_id: string;
  readonly session_id: string;
  readonly slot_id: string;
  readonly entity_id: string;
  readonly profile_revision_id: string;
  readonly profile_revision_sha256: string;
  readonly character_id: string;
  readonly world_profile: WorldAssetProfile;
  readonly atlas_path: string;
  readonly atlas_sha256: string;
}

export interface CharacterProfileBindMessage {
  readonly schema_version: typeof CHARACTER_PROFILE_BIND_VERSION;
  readonly message_type: 'character-profile.bind';
  readonly idempotency_key: string;
  readonly payload_sha256: string;
  readonly payload: CharacterProfileBindPayload;
}

export type CharacterProfileRevisionErrorCode =
  | 'character-profile.invalid-shape'
  | 'character-profile.invalid-value'
  | 'character-profile.invalid-rights'
  | 'character-profile.incomplete-clips'
  | 'character-profile.invalid-reference'
  | 'character-profile.payload-digest-mismatch'
  | 'character-profile.revision-digest-mismatch';

export class CharacterProfileRevisionError extends Error {
  constructor(readonly code: CharacterProfileRevisionErrorCode, message: string) {
    super(message);
    this.name = 'CharacterProfileRevisionError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const TOPDOWN_ACTIONS = Object.freeze(['idle', 'walk'] as const satisfies readonly CharacterAction[]);
const TOPDOWN_DIRECTIONS = Object.freeze([
  'north', 'east', 'south', 'west',
] as const satisfies readonly CharacterDirection[]);

const PROFILE_CLIP_POLICIES: Readonly<Record<WorldAssetProfile, Readonly<{
  actions: readonly CharacterAction[];
  directions: readonly CharacterDirection[];
}>>> = Object.freeze({
  'side-platformer': Object.freeze({
    actions: SIDE_PLATFORMER_ACTIONS,
    directions: SIDE_PLATFORMER_DIRECTIONS,
  }),
  'topdown-farm': Object.freeze({
    actions: TOPDOWN_ACTIONS,
    directions: TOPDOWN_DIRECTIONS,
  }),
  'isometric-action': Object.freeze({
    actions: ISOMETRIC_PLAYER_ACTIONS,
    directions: ISOMETRIC_ACTION_DIRECTIONS,
  }),
  'layered-depth-2d': Object.freeze({
    actions: LAYERED_DEPTH_PLAYER_ACTIONS,
    directions: LAYERED_DEPTH_DIRECTIONS,
  }),
});

function fail(code: CharacterProfileRevisionErrorCode, message: string): never {
  throw new CharacterProfileRevisionError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) {
    fail(
      'character-profile.invalid-shape',
      `Object must contain ${required.join(', ')}${optional.length ? `; optional: ${optional.join(', ')}` : ''}.`,
    );
  }
}

function text(value: unknown, label: string, maximum = 100): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || Array.from(value).length > maximum
    || CONTROL_CHARACTER.test(value)
  ) {
    fail('character-profile.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function id(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!SAFE_ID.test(normalized)) {
    fail('character-profile.invalid-value', `${label} must use lowercase kebab-case.`);
  }
  return normalized;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('character-profile.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function safePath(value: unknown, label: string): string {
  const normalized = text(value, label, 240);
  if (
    !SAFE_PATH.test(normalized)
    || normalized.includes('..')
    || normalized.includes('\\')
    || normalized.startsWith('/')
    || /^[A-Za-z]:/.test(normalized)
  ) {
    fail('character-profile.invalid-value', `${label} must be a portable relative path.`);
  }
  return normalized;
}

function safeInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('character-profile.invalid-value', `${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    fail('character-profile.invalid-value', `${label} must be unique.`);
  }
}

function materializeRights(value: unknown): CharacterProfileRights {
  if (!isRecord(value)) fail('character-profile.invalid-shape', 'Character rights must be an object.');
  exactKeys(value, ['distribution', 'license'], ['attribution']);
  if (!CHARACTER_PROFILE_DISTRIBUTIONS.includes(value.distribution as CharacterProfileDistribution)) {
    fail('character-profile.invalid-rights', 'Character distribution must be private or public.');
  }
  if (!CHARACTER_PROFILE_LICENSES.includes(value.license as CharacterProfileLicense)) {
    fail('character-profile.invalid-rights', 'Character output license is unsupported.');
  }
  const distribution = value.distribution as CharacterProfileDistribution;
  const license = value.license as CharacterProfileLicense;
  if (distribution === 'public' && license === 'LicenseRef-Proprietary') {
    fail(
      'character-profile.invalid-rights',
      'A public character revision cannot use LicenseRef-Proprietary.',
    );
  }
  const attribution = value.attribution === undefined
    ? undefined
    : text(value.attribution, 'Character attribution', 500);
  if ((license === 'CC-BY-4.0' || license === 'CC-BY-SA-4.0') && attribution === undefined) {
    fail('character-profile.invalid-rights', `${license} requires attribution.`);
  }
  return Object.freeze({
    distribution,
    license,
    ...(attribution ? { attribution } : {}),
  });
}

export function requiredCharacterProfileClips(profile: WorldAssetProfile): readonly string[] {
  const policy = PROFILE_CLIP_POLICIES[profile];
  return Object.freeze(policy.actions.flatMap((action) => (
    policy.directions.map((direction) => `${action}.${direction}`)
  )));
}

export function materializeCharacterProfileRevision(value: unknown): CharacterProfileRevision {
  if (!isRecord(value)) fail('character-profile.invalid-shape', 'Character profile revision must be an object.');
  exactKeys(value, [
    'schema_version',
    'document_type',
    'profile_revision_id',
    'character_id',
    'profile',
    'atlas',
    'frame_geometry',
    'pivot',
    'clips',
    'source_identity',
    'rights',
  ]);
  if (
    value.schema_version !== CHARACTER_PROFILE_REVISION_VERSION
    || value.document_type !== 'character-profile-revision'
  ) {
    fail('character-profile.invalid-value', 'Character profile revision must use contract 1.0.0.');
  }
  if (!isWorldAssetProfile(value.profile)) {
    fail('character-profile.invalid-value', 'Character world profile is unsupported.');
  }
  const profile = value.profile;

  if (!isRecord(value.atlas)) fail('character-profile.invalid-shape', 'Character atlas must be an object.');
  exactKeys(value.atlas, ['path', 'media_type', 'bytes', 'sha256', 'width', 'height']);
  if (value.atlas.media_type !== 'image/png') {
    fail('character-profile.invalid-value', 'Character atlas must be image/png.');
  }
  const atlas = Object.freeze({
    path: safePath(value.atlas.path, 'Character atlas path'),
    media_type: 'image/png' as const,
    bytes: safeInteger(value.atlas.bytes, 1, 536_870_912, 'Character atlas bytes'),
    sha256: hash(value.atlas.sha256, 'Character atlas digest'),
    width: safeInteger(value.atlas.width, 1, 8192, 'Character atlas width'),
    height: safeInteger(value.atlas.height, 1, 8192, 'Character atlas height'),
  });

  if (!isRecord(value.frame_geometry)) {
    fail('character-profile.invalid-shape', 'Character frame geometry must be an object.');
  }
  exactKeys(value.frame_geometry, ['frame_width', 'frame_height', 'columns', 'rows']);
  const frameGeometry = Object.freeze({
    frame_width: safeInteger(value.frame_geometry.frame_width, 1, 2048, 'Character frame width'),
    frame_height: safeInteger(value.frame_geometry.frame_height, 1, 2048, 'Character frame height'),
    columns: safeInteger(value.frame_geometry.columns, 1, 256, 'Character atlas columns'),
    rows: safeInteger(value.frame_geometry.rows, 1, 256, 'Character atlas rows'),
  });
  if (
    atlas.width !== frameGeometry.frame_width * frameGeometry.columns
    || atlas.height !== frameGeometry.frame_height * frameGeometry.rows
  ) {
    fail(
      'character-profile.invalid-value',
      'Character atlas dimensions must exactly match frame geometry columns and rows.',
    );
  }

  if (!isRecord(value.pivot)) fail('character-profile.invalid-shape', 'Character pivot must be an object.');
  exactKeys(value.pivot, ['x', 'y', 'unit']);
  if (value.pivot.unit !== 'pixels') {
    fail('character-profile.invalid-value', 'Character pivot unit must be pixels.');
  }
  const pivot = Object.freeze({
    x: safeInteger(value.pivot.x, 0, frameGeometry.frame_width - 1, 'Character pivot x'),
    y: safeInteger(value.pivot.y, 0, frameGeometry.frame_height - 1, 'Character pivot y'),
    unit: 'pixels' as const,
  });

  if (!Array.isArray(value.clips)) {
    fail('character-profile.invalid-shape', 'Character clips must be an array.');
  }
  const expectedClips = requiredCharacterProfileClips(profile);
  if (value.clips.length !== expectedClips.length) {
    fail(
      'character-profile.incomplete-clips',
      `Character profile ${profile} requires exactly ${expectedClips.length} canonical clips.`,
    );
  }
  const policy = PROFILE_CLIP_POLICIES[profile];
  const clips = value.clips.map((candidate, index) => {
    if (!isRecord(candidate)) fail('character-profile.invalid-shape', `Character clip ${index} must be an object.`);
    exactKeys(candidate, ['clip_id', 'action', 'direction', 'fps', 'loop', 'frames']);
    const expected = expectedClips[index];
    if (
      candidate.clip_id !== expected
      || candidate.clip_id !== `${String(candidate.action)}.${String(candidate.direction)}`
      || !policy.actions.includes(candidate.action as CharacterAction)
      || !policy.directions.includes(candidate.direction as CharacterDirection)
    ) {
      fail(
        'character-profile.incomplete-clips',
        `Character clip ${index} must be the canonical ${expected} clip.`,
      );
    }
    if (typeof candidate.fps !== 'number' || !Number.isFinite(candidate.fps) || candidate.fps <= 0 || candidate.fps > 60) {
      fail('character-profile.invalid-value', `Character clip ${index} fps must be greater than 0 and at most 60.`);
    }
    if (typeof candidate.loop !== 'boolean') {
      fail('character-profile.invalid-value', `Character clip ${index} loop must be boolean.`);
    }
    if (!Array.isArray(candidate.frames) || candidate.frames.length < 1 || candidate.frames.length > 32) {
      fail('character-profile.invalid-value', `Character clip ${index} requires 1 to 32 frames.`);
    }
    const frames = candidate.frames.map((frame, frameIndex) => {
      if (!isRecord(frame)) {
        fail('character-profile.invalid-shape', `Character clip ${index} frame ${frameIndex} must be an object.`);
      }
      exactKeys(frame, ['column', 'row']);
      return Object.freeze({
        column: safeInteger(
          frame.column,
          0,
          frameGeometry.columns - 1,
          `Character clip ${index} frame ${frameIndex} column`,
        ),
        row: safeInteger(
          frame.row,
          0,
          frameGeometry.rows - 1,
          `Character clip ${index} frame ${frameIndex} row`,
        ),
      });
    });
    return Object.freeze({
      clip_id: expected,
      action: candidate.action as CharacterAction,
      direction: candidate.direction as CharacterDirection,
      fps: candidate.fps,
      loop: candidate.loop,
      frames: Object.freeze(frames),
    });
  });

  if (!isRecord(value.source_identity)) {
    fail('character-profile.invalid-shape', 'Character source identity summary must be an object.');
  }
  exactKeys(value.source_identity, ['identity_digest_sha256', 'source_reference_ids']);
  if (
    !Array.isArray(value.source_identity.source_reference_ids)
    || value.source_identity.source_reference_ids.length < 1
    || value.source_identity.source_reference_ids.length > 32
  ) {
    fail('character-profile.invalid-value', 'Character source identity requires 1 to 32 opaque reference ids.');
  }
  const sourceReferenceIds = value.source_identity.source_reference_ids.map((referenceId, index) => (
    id(referenceId, `Character source reference ${index} id`)
  ));
  unique(sourceReferenceIds, 'Character source reference ids');
  const sourceIdentity = Object.freeze({
    identity_digest_sha256: hash(
      value.source_identity.identity_digest_sha256,
      'Character source identity digest',
    ),
    source_reference_ids: Object.freeze(sourceReferenceIds),
  });

  return Object.freeze({
    schema_version: CHARACTER_PROFILE_REVISION_VERSION,
    document_type: 'character-profile-revision',
    profile_revision_id: id(value.profile_revision_id, 'Character profile revision id'),
    character_id: id(value.character_id, 'Character id'),
    profile,
    atlas,
    frame_geometry: frameGeometry,
    pivot,
    clips: Object.freeze(clips),
    source_identity: sourceIdentity,
    rights: materializeRights(value.rights),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('character-profile.invalid-value', 'Canonical character payload cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('character-profile.invalid-value', 'Canonical character payload contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function fingerprintCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintCharacterProfileRevision(value: unknown): Promise<string> {
  return fingerprintCanonical(materializeCharacterProfileRevision(value));
}

export async function fingerprintCharacterProfileBindPayload(value: unknown): Promise<string> {
  return fingerprintCanonical(materializeCharacterProfileBindPayload(value));
}

function assertRuntimeCompatibility(
  payload: CharacterProfileBindPayload,
  revision: CharacterProfileRevision | undefined,
  contract: PortableWorldRuntimeContract | undefined,
): void {
  if (revision) {
    if (
      payload.profile_revision_id !== revision.profile_revision_id
      || payload.character_id !== revision.character_id
      || payload.world_profile !== revision.profile
      || payload.atlas_path !== revision.atlas.path
      || payload.atlas_sha256 !== revision.atlas.sha256
    ) {
      fail(
        'character-profile.invalid-reference',
        'Character bind payload does not match the supplied character profile revision.',
      );
    }
  }
  if (contract) {
    if (payload.contract_id !== contract.contract_id || payload.world_profile !== contract.world.profile) {
      fail(
        'character-profile.invalid-reference',
        'Character bind payload does not match the supplied world runtime contract.',
      );
    }
    const slot = contract.entity_slots.find(({ slot_id }) => slot_id === payload.slot_id);
    if (
      !slot
      || !['player', 'npc', 'companion'].includes(slot.kind)
      || !slot.accepted_asset_kinds.includes('character-atlas')
    ) {
      fail(
        'character-profile.invalid-reference',
        'Character bind payload must target a character-capable neutral entity slot.',
      );
    }
  }
}

export function materializeCharacterProfileBindPayload(
  value: unknown,
  revisionValue?: unknown,
  contractValue?: unknown,
): CharacterProfileBindPayload {
  if (!isRecord(value)) fail('character-profile.invalid-shape', 'Character bind payload must be an object.');
  exactKeys(value, [
    'contract_id',
    'session_id',
    'slot_id',
    'entity_id',
    'profile_revision_id',
    'profile_revision_sha256',
    'character_id',
    'world_profile',
    'atlas_path',
    'atlas_sha256',
  ]);
  if (!isWorldAssetProfile(value.world_profile)) {
    fail('character-profile.invalid-value', 'Character bind world profile is unsupported.');
  }
  const payload = Object.freeze({
    contract_id: id(value.contract_id, 'Character bind contract id'),
    session_id: id(value.session_id, 'Character bind session id'),
    slot_id: id(value.slot_id, 'Character bind slot id'),
    entity_id: id(value.entity_id, 'Character bind entity id'),
    profile_revision_id: id(value.profile_revision_id, 'Character bind profile revision id'),
    profile_revision_sha256: hash(value.profile_revision_sha256, 'Character profile revision digest'),
    character_id: id(value.character_id, 'Character bind character id'),
    world_profile: value.world_profile,
    atlas_path: safePath(value.atlas_path, 'Character bind atlas path'),
    atlas_sha256: hash(value.atlas_sha256, 'Character bind atlas digest'),
  });
  const revision = revisionValue === undefined
    ? undefined
    : materializeCharacterProfileRevision(revisionValue);
  const contract = contractValue === undefined
    ? undefined
    : materializePortableWorldRuntimeContract(contractValue);
  assertRuntimeCompatibility(payload, revision, contract);
  return payload;
}

export function materializeCharacterProfileBindMessage(
  value: unknown,
  revisionValue?: unknown,
  contractValue?: unknown,
): CharacterProfileBindMessage {
  if (!isRecord(value)) fail('character-profile.invalid-shape', 'Character profile bind message must be an object.');
  exactKeys(value, ['schema_version', 'message_type', 'idempotency_key', 'payload_sha256', 'payload']);
  if (
    value.schema_version !== CHARACTER_PROFILE_BIND_VERSION
    || value.message_type !== 'character-profile.bind'
  ) {
    fail('character-profile.invalid-value', 'Character bind message must use contract 1.0.0.');
  }
  if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotency_key)) {
    fail('character-profile.invalid-value', 'Character bind idempotency key is invalid.');
  }
  return Object.freeze({
    schema_version: CHARACTER_PROFILE_BIND_VERSION,
    message_type: 'character-profile.bind',
    idempotency_key: value.idempotency_key,
    payload_sha256: hash(value.payload_sha256, 'Character bind payload digest'),
    payload: materializeCharacterProfileBindPayload(value.payload, revisionValue, contractValue),
  });
}

export async function assertCharacterProfileBindMessagePayloadDigest(
  value: unknown,
  revisionValue?: unknown,
  contractValue?: unknown,
): Promise<CharacterProfileBindMessage> {
  const message = materializeCharacterProfileBindMessage(value, revisionValue, contractValue);
  if (await fingerprintCanonical(message.payload) !== message.payload_sha256) {
    fail(
      'character-profile.payload-digest-mismatch',
      'Character bind payload digest does not match its canonical payload.',
    );
  }
  if (
    revisionValue !== undefined
    && await fingerprintCharacterProfileRevision(revisionValue) !== message.payload.profile_revision_sha256
  ) {
    fail(
      'character-profile.revision-digest-mismatch',
      'Character profile revision digest does not match the bound revision.',
    );
  }
  return message;
}

export async function createCharacterProfileBindMessage(
  idempotencyKey: string,
  binding: Readonly<{
    contract_id: string;
    session_id: string;
    slot_id: string;
    entity_id: string;
  }>,
  revisionValue: unknown,
  contractValue: unknown,
): Promise<CharacterProfileBindMessage> {
  const revision = materializeCharacterProfileRevision(revisionValue);
  const payload: CharacterProfileBindPayload = {
    ...binding,
    profile_revision_id: revision.profile_revision_id,
    profile_revision_sha256: await fingerprintCharacterProfileRevision(revision),
    character_id: revision.character_id,
    world_profile: revision.profile,
    atlas_path: revision.atlas.path,
    atlas_sha256: revision.atlas.sha256,
  };
  const payloadSha256 = await fingerprintCanonical(payload);
  return assertCharacterProfileBindMessagePayloadDigest({
    schema_version: CHARACTER_PROFILE_BIND_VERSION,
    message_type: 'character-profile.bind',
    idempotency_key: idempotencyKey,
    payload_sha256: payloadSha256,
    payload,
  }, revision, contractValue);
}

export async function projectCharacterProfileBindToPortableRuntime(
  value: unknown,
  revisionValue: unknown,
  contractValue: unknown,
): Promise<PortableRuntimeBindPayload> {
  const message = await assertCharacterProfileBindMessagePayloadDigest(
    value,
    revisionValue,
    contractValue,
  );
  return Object.freeze({
    contract_id: message.payload.contract_id,
    session_id: message.payload.session_id,
    bindings: Object.freeze([
      Object.freeze({
        slot_id: message.payload.slot_id,
        entity_id: message.payload.entity_id,
        asset_path: message.payload.atlas_path,
        asset_sha256: message.payload.atlas_sha256,
      }),
    ]),
  });
}
