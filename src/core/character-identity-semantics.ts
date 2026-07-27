import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const CHARACTER_IDENTITY_SEMANTICS_VERSION = '1.0.0' as const;

export interface CharacterIdentitySemantics {
  readonly schema_version: typeof CHARACTER_IDENTITY_SEMANTICS_VERSION;
  readonly document_type: 'character-identity-semantics';
  readonly character_id: string;
  readonly source_identity: Readonly<{
    identity_digest_sha256: string;
    source_reference_id: string;
  }>;
  readonly confirmation: Readonly<{
    status: 'human-confirmed';
    checkpoint_sha256: string;
  }>;
  readonly cues: Readonly<{
    silhouette: string;
    body_proportions: string;
    hair: string;
    face: string;
    clothing: readonly string[];
    equipment: readonly string[];
    distinguishing_features: readonly string[];
    palette: readonly string[];
  }>;
}

export type CharacterIdentitySemanticsErrorCode =
  | 'character-semantics.invalid-shape'
  | 'character-semantics.invalid-value'
  | 'character-semantics.unsafe-imitation';

export class CharacterIdentitySemanticsError extends Error {
  constructor(
    readonly code: CharacterIdentitySemanticsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CharacterIdentitySemanticsError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const NAMED_IMITATION =
  /\b(?:in\s+the\s+style\s+of|hades|stardew(?:\s+valley)?|octopath(?:\s+traveler)?)\b|(?:哈迪斯|星露谷物语|八方旅人)/iu;

const PROFILE_ADAPTATION: Readonly<Record<WorldAssetProfile, string>> =
  Object.freeze({
    'side-platformer':
      'Adapt only camera projection, side-view foreshortening, readable left/right poses, and the declared frame geometry.',
    'topdown-farm':
      'Adapt only orthogonal top-down foreshortening, north/east/south/west readability, and the declared frame geometry.',
    'isometric-action':
      'Adapt only 2:1 isometric projection, eight-direction combat readability, and the declared frame geometry.',
    'layered-depth-2d':
      'Adapt only shallow-depth near/far projection, layered-scene readability, and the declared frame geometry.',
  });

function fail(
  code: CharacterIdentitySemanticsErrorCode,
  message: string,
): never {
  throw new CharacterIdentitySemanticsError(code, message);
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
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      'character-semantics.invalid-shape',
      `${label} must contain exactly: ${expected.join(', ')}.`,
    );
  }
}

function text(value: unknown, label: string, maximum = 240): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || CONTROL.test(value)
  ) {
    fail('character-semantics.invalid-value', `${label} is invalid.`);
  }
  if (NAMED_IMITATION.test(value)) {
    fail(
      'character-semantics.unsafe-imitation',
      `${label} must describe original traits without naming a commercial game or imitation style.`,
    );
  }
  return value;
}

function id(value: unknown, label: string): string {
  const result = text(value, label, 100);
  if (!SAFE_ID.test(result)) {
    fail(
      'character-semantics.invalid-value',
      `${label} must use lowercase kebab-case.`,
    );
  }
  return result;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(
      'character-semantics.invalid-value',
      `${label} must be a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function textList(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): readonly string[] {
  if (
    !Array.isArray(value)
    || value.length < minimum
    || value.length > maximum
  ) {
    fail(
      'character-semantics.invalid-value',
      `${label} must contain ${minimum} through ${maximum} items.`,
    );
  }
  const result = value.map((entry, index) =>
    text(entry, `${label}[${index}]`, 160));
  if (new Set(result).size !== result.length) {
    fail('character-semantics.invalid-value', `${label} must be unique.`);
  }
  return Object.freeze(result);
}

export function materializeCharacterIdentitySemantics(
  value: unknown,
): CharacterIdentitySemantics {
  if (!record(value)) {
    fail(
      'character-semantics.invalid-shape',
      'Character identity semantics must be an object.',
    );
  }
  exact(value, [
    'schema_version',
    'document_type',
    'character_id',
    'source_identity',
    'confirmation',
    'cues',
  ], 'Character identity semantics');
  if (
    value.schema_version !== CHARACTER_IDENTITY_SEMANTICS_VERSION
    || value.document_type !== 'character-identity-semantics'
  ) {
    fail(
      'character-semantics.invalid-value',
      'Character identity semantics must use contract 1.0.0.',
    );
  }
  if (!record(value.source_identity)) {
    fail(
      'character-semantics.invalid-shape',
      'Character source identity must be an object.',
    );
  }
  exact(
    value.source_identity,
    ['identity_digest_sha256', 'source_reference_id'],
    'Character source identity',
  );
  if (!record(value.confirmation)) {
    fail(
      'character-semantics.invalid-shape',
      'Character semantic confirmation must be an object.',
    );
  }
  exact(
    value.confirmation,
    ['status', 'checkpoint_sha256'],
    'Character semantic confirmation',
  );
  if (value.confirmation.status !== 'human-confirmed') {
    fail(
      'character-semantics.invalid-value',
      'Character semantic cues require explicit human confirmation.',
    );
  }
  if (!record(value.cues)) {
    fail(
      'character-semantics.invalid-shape',
      'Character semantic cues must be an object.',
    );
  }
  exact(value.cues, [
    'silhouette',
    'body_proportions',
    'hair',
    'face',
    'clothing',
    'equipment',
    'distinguishing_features',
    'palette',
  ], 'Character semantic cues');
  if (
    !Array.isArray(value.cues.palette)
    || value.cues.palette.length < 2
    || value.cues.palette.length > 8
    || value.cues.palette.some((color) =>
      typeof color !== 'string' || !HEX_COLOR.test(color))
    || new Set(value.cues.palette).size !== value.cues.palette.length
  ) {
    fail(
      'character-semantics.invalid-value',
      'Character semantic palette must contain 2 through 8 unique lowercase hex colors.',
    );
  }
  return Object.freeze({
    schema_version: CHARACTER_IDENTITY_SEMANTICS_VERSION,
    document_type: 'character-identity-semantics',
    character_id: id(value.character_id, 'Character id'),
    source_identity: Object.freeze({
      identity_digest_sha256: digest(
        value.source_identity.identity_digest_sha256,
        'Character identity digest',
      ),
      source_reference_id: id(
        value.source_identity.source_reference_id,
        'Character source reference id',
      ),
    }),
    confirmation: Object.freeze({
      status: 'human-confirmed',
      checkpoint_sha256: digest(
        value.confirmation.checkpoint_sha256,
        'Character semantic checkpoint',
      ),
    }),
    cues: Object.freeze({
      silhouette: text(value.cues.silhouette, 'Character silhouette'),
      body_proportions: text(
        value.cues.body_proportions,
        'Character body proportions',
      ),
      hair: text(value.cues.hair, 'Character hair'),
      face: text(value.cues.face, 'Character face'),
      clothing: textList(value.cues.clothing, 'Character clothing', 1, 8),
      equipment: textList(value.cues.equipment, 'Character equipment', 0, 8),
      distinguishing_features: textList(
        value.cues.distinguishing_features,
        'Character distinguishing features',
        1,
        8,
      ),
      palette: Object.freeze([...(value.cues.palette as string[])]),
    }),
  });
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (!record(value)) {
    fail(
      'character-semantics.invalid-value',
      'Character semantic canonical value is unsupported.',
    );
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function serializeCharacterIdentitySemanticsCanonical(
  value: unknown,
): Uint8Array {
  return new TextEncoder().encode(
    canonicalJson(materializeCharacterIdentitySemantics(value)),
  );
}

export async function fingerprintCharacterIdentitySemantics(
  value: unknown,
): Promise<string> {
  const bytes = serializeCharacterIdentitySemanticsCanonical(value);
  const digestValue = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digestValue)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function compileCharacterIdentitySemanticsPrompt(
  value: unknown,
  profileValue: unknown,
): string {
  const semantics = materializeCharacterIdentitySemantics(value);
  if (!isWorldAssetProfile(profileValue)) {
    fail(
      'character-semantics.invalid-value',
      'Character semantic target profile is unsupported.',
    );
  }
  const cues = semantics.cues;
  return [
    `Human-confirmed character identity: ${semantics.character_id}.`,
    `Preserve silhouette: ${cues.silhouette}`,
    `Preserve body proportions: ${cues.body_proportions}`,
    `Preserve hair: ${cues.hair}`,
    `Preserve face: ${cues.face}`,
    `Preserve clothing: ${cues.clothing.join('; ')}`,
    `Preserve equipment: ${cues.equipment.length > 0 ? cues.equipment.join('; ') : 'none'}`,
    `Preserve distinguishing features: ${cues.distinguishing_features.join('; ')}`,
    `Preserve identity palette anchors: ${cues.palette.join(', ')}`,
    PROFILE_ADAPTATION[profileValue],
    'Do not replace, remove, recolor, or invent identity-defining cues merely to match the environment style.',
  ].join('\n');
}
