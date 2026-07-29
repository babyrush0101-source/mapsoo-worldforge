import {
  REFERENCE_IMAGE_ROLES,
  bindReferenceImage,
  materializeReferenceImageDescriptor,
  type ReferenceImageDescriptor,
  type RuntimeReferenceImage,
} from './reference-image';
import { WORLD_ASSET_PROFILES, type WorldAssetProfile } from './asset-profile';
import type { CharacterIdentitySignature } from './character-identity-signature';
import type { EnvironmentArtSignature } from './environment-art-signature';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

export const GENERATION_REQUEST_SCHEMA_VERSION = '1.0.0' as const;
export interface GenerationRequestV2 {
  readonly schemaVersion: typeof GENERATION_REQUEST_SCHEMA_VERSION;
  readonly id: string;
  readonly profile: WorldAssetProfile;
  readonly description: string;
  readonly seed: string;
  readonly references: readonly [ReferenceImageDescriptor, ReferenceImageDescriptor];
}

/** Runtime-only job. Image bytes are never part of the JSON request/schema. */
export interface GenerationRequestJobV2 {
  readonly request: GenerationRequestV2;
  readonly references: readonly [RuntimeReferenceImage, RuntimeReferenceImage];
  /** Runtime-only decoded visual identity. Never serialized into the public request. */
  readonly characterIdentity?: CharacterIdentitySignature;
  /** Runtime-only decoded environment grammar. Never serialized into the public request. */
  readonly environmentArt?: EnvironmentArtSignature;
}

export type GenerationRequestV2ErrorCode =
  | 'request.invalid-shape'
  | 'request.invalid-value'
  | 'request.invalid-references'
  | 'request.missing-runtime-reference'
  | 'request.unexpected-runtime-reference';

export class GenerationRequestV2Error extends Error {
  constructor(readonly code: GenerationRequestV2ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GenerationRequestV2Error';
  }
}

function fail(code: GenerationRequestV2ErrorCode, message: string, options?: ErrorOptions): never {
  throw new GenerationRequestV2Error(code, message, options);
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
    fail('request.invalid-shape', `${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value !== value.trim()
    || Array.from(value).length > maximum
    || CONTROL_CHARACTER.test(value)
  ) {
    fail('request.invalid-value', `${label} is invalid.`);
  }
  return value;
}

export function materializeGenerationRequestV2(value: unknown): GenerationRequestV2 {
  if (!isRecord(value)) fail('request.invalid-shape', 'Generation request must be an object.');
  exactKeys(value, ['schemaVersion', 'id', 'profile', 'description', 'seed', 'references'], 'Generation request');
  if (value.schemaVersion !== GENERATION_REQUEST_SCHEMA_VERSION) {
    fail('request.invalid-value', `Generation request schemaVersion must be ${GENERATION_REQUEST_SCHEMA_VERSION}.`);
  }
  const id = text(value.id, 'Generation request id', 80);
  if (!ID.test(id)) fail('request.invalid-value', 'Generation request id must use lowercase kebab-case.');
  if (!WORLD_ASSET_PROFILES.includes(value.profile as WorldAssetProfile)) {
    fail('request.invalid-value', 'Generation request profile is unsupported.');
  }
  if (!Array.isArray(value.references) || value.references.length !== 2) {
    fail('request.invalid-references', 'Generation request requires exactly two reference images.');
  }
  let references: ReferenceImageDescriptor[];
  try {
    references = value.references.map(materializeReferenceImageDescriptor);
  } catch (error) {
    fail('request.invalid-references', 'Generation request contains an invalid reference image.', { cause: error });
  }
  if (new Set(references.map(({ id: referenceId }) => referenceId)).size !== references.length) {
    fail('request.invalid-references', 'Generation request reference ids must be unique.');
  }
  if (new Set(references.map(({ path }) => path)).size !== references.length) {
    fail('request.invalid-references', 'Generation request reference paths must be unique.');
  }
  const roles = references.map(({ role }) => role).sort();
  if (JSON.stringify(roles) !== JSON.stringify([...REFERENCE_IMAGE_ROLES].sort())) {
    fail('request.invalid-references', 'Generation request requires one environment-style and one character reference.');
  }
  const snapshot = references.map((reference) => reference) as [ReferenceImageDescriptor, ReferenceImageDescriptor];
  return Object.freeze({
    schemaVersion: GENERATION_REQUEST_SCHEMA_VERSION,
    id,
    profile: value.profile as WorldAssetProfile,
    description: text(value.description, 'Generation request description', 2_000),
    seed: text(value.seed, 'Generation request seed', 160),
    references: Object.freeze(snapshot),
  });
}

/** One-way binding for the complete validated request, including reference rights and digests. */
export async function fingerprintGenerationRequestV2(value: unknown): Promise<string> {
  const request = materializeGenerationRequestV2(value);
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface RuntimeReferenceBytes {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export async function bindGenerationRequestV2(
  requestValue: unknown,
  runtimeValues: readonly RuntimeReferenceBytes[],
): Promise<GenerationRequestJobV2> {
  const request = materializeGenerationRequestV2(requestValue);
  if (!Array.isArray(runtimeValues) || runtimeValues.length !== 2) {
    fail('request.missing-runtime-reference', 'Runtime generation requires exactly two reference byte sources.');
  }
  const runtimeByPath = new Map<string, Uint8Array>();
  for (const runtime of runtimeValues) {
    if (!isRecord(runtime) || Object.keys(runtime).sort().join(',') !== 'bytes,path') {
      fail('request.unexpected-runtime-reference', 'Runtime reference must contain only path and bytes.');
    }
    if (typeof runtime.path !== 'string' || !(runtime.bytes instanceof Uint8Array)) {
      fail('request.unexpected-runtime-reference', 'Runtime reference path or bytes are invalid.');
    }
    if (runtimeByPath.has(runtime.path)) {
      fail('request.unexpected-runtime-reference', 'Runtime reference paths must be unique.');
    }
    runtimeByPath.set(runtime.path, runtime.bytes);
  }
  const expectedPaths = new Set(request.references.map(({ path }) => path));
  if ([...runtimeByPath.keys()].some((path) => !expectedPaths.has(path))) {
    fail('request.unexpected-runtime-reference', 'Runtime reference contains a path not declared by the request.');
  }
  const bound: RuntimeReferenceImage[] = [];
  for (const descriptor of request.references) {
    const bytes = runtimeByPath.get(descriptor.path);
    if (!bytes) fail('request.missing-runtime-reference', `Runtime bytes are missing for ${descriptor.path}.`);
    bound.push(await bindReferenceImage(descriptor, bytes));
  }
  return Object.freeze({
    request,
    references: Object.freeze(bound as [RuntimeReferenceImage, RuntimeReferenceImage]),
  });
}
