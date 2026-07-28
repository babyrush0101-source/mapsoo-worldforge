import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  PRODUCTION_ART_DISTRIBUTIONS,
  PRODUCTION_ART_LICENSES,
  type ProductionArtRights,
} from './production-art-contract';

export const WORLD_ART_RUNTIME_OVERLAY_VERSION = '1.0.0' as const;
export const WORLD_ART_RUNTIME_OVERLAY_MANIFEST_PATH =
  'world-art-runtime-overlay.json' as const;
export const WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH =
  'world-art-runtime-projection.json' as const;

export interface WorldArtRuntimeOverlayFile {
  readonly path: string;
  readonly media_type: 'application/json' | 'image/png';
  readonly bytes: number;
  readonly sha256: string;
}

export interface WorldArtRuntimeOverlayManifest {
  readonly schema_version: typeof WORLD_ART_RUNTIME_OVERLAY_VERSION;
  readonly document_type: 'world-art-runtime-overlay';
  readonly overlay_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    projection_id: string;
    projection_sha256: string;
    layout_plan_sha256: string;
    review_record_sha256: string;
  }>;
  readonly rights: ProductionArtRights;
  readonly review: Readonly<{
    human_art: 'pass';
    runtime: 'pending';
    raspberry_pi: 'pending';
  }>;
  readonly projection: Readonly<{
    path: typeof WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH;
    sha256: string;
  }>;
  readonly files: readonly WorldArtRuntimeOverlayFile[];
  readonly reference_policy: Readonly<{
    embedded: false;
    original_references_excluded: true;
    raw_prompts_excluded: true;
    only_one_way_audit_hashes_retained: true;
  }>;
}

export type WorldArtRuntimeOverlayDraft = Omit<
  WorldArtRuntimeOverlayManifest,
  'overlay_id'
>;

export type WorldArtRuntimeOverlayErrorCode =
  | 'world-art-runtime-overlay.invalid-shape'
  | 'world-art-runtime-overlay.invalid-value'
  | 'world-art-runtime-overlay.invalid-rights'
  | 'world-art-runtime-overlay.invalid-file'
  | 'world-art-runtime-overlay.invalid-order'
  | 'world-art-runtime-overlay.invalid-binding';

export class WorldArtRuntimeOverlayError extends Error {
  constructor(readonly code: WorldArtRuntimeOverlayErrorCode, message: string) {
    super(message);
    this.name = 'WorldArtRuntimeOverlayError';
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const OVERLAY_ID = /^world-art-runtime-overlay-[a-f0-9]{16}$/;

function fail(code: WorldArtRuntimeOverlayErrorCode, message: string): never {
  throw new WorldArtRuntimeOverlayError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      'world-art-runtime-overlay.invalid-shape',
      `${label} must contain exactly: ${expected.join(', ')}.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('world-art-runtime-overlay.invalid-value', 'Manifest contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay.invalid-value', 'Manifest contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('world-art-runtime-overlay.invalid-value', `${label} must be SHA-256.`);
  }
  return value;
}

function safePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.includes('\\')
    || value.startsWith('/')
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    fail('world-art-runtime-overlay.invalid-file', `${label} must be a portable path.`);
  }
  return value;
}

function materializeRights(value: unknown): ProductionArtRights {
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay.invalid-shape', 'Overlay rights must be an object.');
  }
  exactKeys(
    value,
    value.attribution === undefined
      ? ['distribution', 'license']
      : ['distribution', 'license', 'attribution'],
    'Overlay rights',
  );
  const attributionRequired =
    value.license === 'CC-BY-4.0' || value.license === 'CC-BY-SA-4.0';
  if (
    !PRODUCTION_ART_DISTRIBUTIONS.includes(
      value.distribution as ProductionArtRights['distribution'],
    )
    || typeof value.license !== 'string'
    || !PRODUCTION_ART_LICENSES.includes(
      value.license as ProductionArtRights['license'],
    )
    || (value.distribution === 'public' && value.license === 'LicenseRef-Proprietary')
    || (attributionRequired && value.attribution === undefined)
    || (
      value.attribution !== undefined
      && (
        typeof value.attribution !== 'string'
        || value.attribution.trim() !== value.attribution
        || value.attribution.length < 1
        || value.attribution.length > 500
      )
    )
  ) {
    fail('world-art-runtime-overlay.invalid-rights', 'Overlay rights are invalid.');
  }
  return Object.freeze({
    distribution: value.distribution as ProductionArtRights['distribution'],
    license: value.license as ProductionArtRights['license'],
    ...(value.attribution === undefined ? {} : { attribution: value.attribution }),
  });
}

function materializeFile(value: unknown, index: number): WorldArtRuntimeOverlayFile {
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay.invalid-shape', `File ${index} must be an object.`);
  }
  exactKeys(value, ['path', 'media_type', 'bytes', 'sha256'], `File ${index}`);
  const path = safePath(value.path, `File ${index} path`);
  if (
    !['application/json', 'image/png'].includes(String(value.media_type))
    || !Number.isSafeInteger(value.bytes)
    || (value.bytes as number) < 1
    || (value.bytes as number) > 64 * 1024 * 1024
    || (value.media_type === 'image/png' && !path.endsWith('.png'))
    || (value.media_type === 'application/json' && !path.endsWith('.json'))
  ) {
    fail('world-art-runtime-overlay.invalid-file', `File ${index} metadata is invalid.`);
  }
  return Object.freeze({
    path,
    media_type: value.media_type as WorldArtRuntimeOverlayFile['media_type'],
    bytes: value.bytes as number,
    sha256: digest(value.sha256, `File ${index} SHA-256`),
  });
}

function payloadOf(
  manifest: Omit<WorldArtRuntimeOverlayManifest, 'overlay_id'>,
): Omit<WorldArtRuntimeOverlayManifest, 'overlay_id'> {
  return manifest;
}

export async function materializeWorldArtRuntimeOverlay(
  value: unknown,
): Promise<WorldArtRuntimeOverlayManifest> {
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay.invalid-shape', 'Overlay manifest must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'overlay_id',
    'profile',
    'source',
    'rights',
    'review',
    'projection',
    'files',
    'reference_policy',
  ], 'Overlay manifest');
  if (
    value.schema_version !== WORLD_ART_RUNTIME_OVERLAY_VERSION
    || value.document_type !== 'world-art-runtime-overlay'
    || typeof value.overlay_id !== 'string'
    || !OVERLAY_ID.test(value.overlay_id)
    || !isWorldAssetProfile(value.profile)
    || !isRecord(value.source)
    || !isRecord(value.review)
    || !isRecord(value.projection)
    || !Array.isArray(value.files)
    || value.files.length < 2
    || value.files.length > 257
    || !isRecord(value.reference_policy)
  ) {
    fail('world-art-runtime-overlay.invalid-value', 'Overlay identity is invalid.');
  }
  exactKeys(value.source, [
    'projection_id',
    'projection_sha256',
    'layout_plan_sha256',
    'review_record_sha256',
  ], 'Overlay source');
  if (
    typeof value.source.projection_id !== 'string'
    || !SAFE_ID.test(value.source.projection_id)
    || value.source.projection_id.length > 100
  ) {
    fail('world-art-runtime-overlay.invalid-value', 'Projection id is invalid.');
  }
  const source = Object.freeze({
    projection_id: value.source.projection_id,
    projection_sha256: digest(value.source.projection_sha256, 'Projection SHA-256'),
    layout_plan_sha256: digest(value.source.layout_plan_sha256, 'Layout SHA-256'),
    review_record_sha256: digest(value.source.review_record_sha256, 'Review record SHA-256'),
  });
  exactKeys(value.review, ['human_art', 'runtime', 'raspberry_pi'], 'Overlay review');
  if (
    value.review.human_art !== 'pass'
    || value.review.runtime !== 'pending'
    || value.review.raspberry_pi !== 'pending'
  ) {
    fail('world-art-runtime-overlay.invalid-value', 'Overlay review gates are invalid.');
  }
  const review = Object.freeze({
    human_art: 'pass' as const,
    runtime: 'pending' as const,
    raspberry_pi: 'pending' as const,
  });
  exactKeys(value.projection, ['path', 'sha256'], 'Overlay projection');
  if (value.projection.path !== WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH) {
    fail('world-art-runtime-overlay.invalid-binding', 'Projection path is not canonical.');
  }
  const projection = Object.freeze({
    path: WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH,
    sha256: digest(value.projection.sha256, 'Projection file SHA-256'),
  });
  exactKeys(value.reference_policy, [
    'embedded',
    'original_references_excluded',
    'raw_prompts_excluded',
    'only_one_way_audit_hashes_retained',
  ], 'Reference policy');
  if (
    value.reference_policy.embedded !== false
    || value.reference_policy.original_references_excluded !== true
    || value.reference_policy.raw_prompts_excluded !== true
    || value.reference_policy.only_one_way_audit_hashes_retained !== true
  ) {
    fail('world-art-runtime-overlay.invalid-value', 'Reference policy is invalid.');
  }
  const referencePolicy = Object.freeze({
    embedded: false as const,
    original_references_excluded: true as const,
    raw_prompts_excluded: true as const,
    only_one_way_audit_hashes_retained: true as const,
  });
  const files = Object.freeze(value.files.map(materializeFile));
  if (
    new Set(files.map(({ path }) => path)).size !== files.length
    || files.some((file, index) =>
      index > 0 && files[index - 1]!.path.localeCompare(file.path, 'en') >= 0)
  ) {
    fail('world-art-runtime-overlay.invalid-order', 'Overlay files must be unique and sorted.');
  }
  const projectionFile = files.find(({ path }) =>
    path === WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH);
  if (
    !projectionFile
    || projectionFile.media_type !== 'application/json'
    || projectionFile.sha256 !== projection.sha256
    || files.some(({ path }) => path === WORLD_ART_RUNTIME_OVERLAY_MANIFEST_PATH)
    || files.filter(({ media_type }) => media_type === 'image/png').length < 1
    || files.filter(({ media_type }) => media_type === 'application/json').length !== 1
  ) {
    fail(
      'world-art-runtime-overlay.invalid-binding',
      'Overlay files do not contain the exact projection JSON and PNG inventory.',
    );
  }
  const manifest = Object.freeze({
    schema_version: WORLD_ART_RUNTIME_OVERLAY_VERSION,
    document_type: 'world-art-runtime-overlay' as const,
    overlay_id: value.overlay_id,
    profile: value.profile,
    source,
    rights: materializeRights(value.rights),
    review,
    projection,
    files,
    reference_policy: referencePolicy,
  });
  const expectedId = `world-art-runtime-overlay-${(
    await sha256(payloadOf({
      schema_version: manifest.schema_version,
      document_type: manifest.document_type,
      profile: manifest.profile,
      source: manifest.source,
      rights: manifest.rights,
      review: manifest.review,
      projection: manifest.projection,
      files: manifest.files,
      reference_policy: manifest.reference_policy,
    }))
  ).slice(0, 16)}`;
  if (manifest.overlay_id !== expectedId) {
    fail('world-art-runtime-overlay.invalid-binding', 'Overlay id is stale.');
  }
  return manifest;
}

export async function buildWorldArtRuntimeOverlay(
  value: WorldArtRuntimeOverlayDraft,
): Promise<WorldArtRuntimeOverlayManifest> {
  const overlayId = `world-art-runtime-overlay-${(
    await sha256(payloadOf(value))
  ).slice(0, 16)}`;
  return materializeWorldArtRuntimeOverlay({
    ...value,
    overlay_id: overlayId,
  });
}

export async function fingerprintWorldArtRuntimeOverlay(value: unknown): Promise<string> {
  return sha256(await materializeWorldArtRuntimeOverlay(value));
}

export async function serializeCanonicalWorldArtRuntimeOverlay(
  value: unknown,
): Promise<Uint8Array> {
  const manifest = await materializeWorldArtRuntimeOverlay(value);
  return new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
}
