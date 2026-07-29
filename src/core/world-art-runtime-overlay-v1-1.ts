import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  PRODUCTION_ART_DISTRIBUTIONS,
  PRODUCTION_ART_LICENSES,
  type ProductionArtRights,
} from './production-art-contract';

export const WORLD_ART_RUNTIME_OVERLAY_V1_1_VERSION = '1.1.0' as const;
export const WORLD_ART_RUNTIME_OVERLAY_V1_1_MANIFEST_PATH =
  'world-art-runtime-overlay.json' as const;
export const WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH =
  'world-art-runtime-projection.json' as const;
export const WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH =
  'world-visual-placement-plan.json' as const;
export const WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH =
  'world-art-placement-map.json' as const;

export interface WorldArtRuntimeOverlayV1_1File {
  readonly path: string;
  readonly media_type: 'application/json' | 'image/png';
  readonly bytes: number;
  readonly sha256: string;
}

export interface WorldArtRuntimeOverlayV1_1Manifest {
  readonly schema_version: typeof WORLD_ART_RUNTIME_OVERLAY_V1_1_VERSION;
  readonly document_type: 'world-art-runtime-overlay';
  readonly overlay_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    projection_id: string;
    projection_sha256: string;
    layout_plan_id: string;
    layout_plan_sha256: string;
    placement_plan_id: string;
    placement_plan_sha256: string;
    placement_map_id: string;
    placement_map_sha256: string;
    review_record_sha256: string;
  }>;
  readonly rights: ProductionArtRights;
  readonly review: Readonly<{
    human_art: 'pass';
    runtime: 'pending';
    raspberry_pi: 'pending';
  }>;
  readonly projection: Readonly<{
    path: typeof WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH;
    sha256: string;
  }>;
  readonly visual_placement: Readonly<{
    plan_path: typeof WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH;
    plan_sha256: string;
    map_path: typeof WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH;
    map_sha256: string;
  }>;
  readonly files: readonly WorldArtRuntimeOverlayV1_1File[];
  readonly reference_policy: Readonly<{
    embedded: false;
    original_references_excluded: true;
    raw_prompts_excluded: true;
    only_one_way_audit_hashes_retained: true;
  }>;
}

export type WorldArtRuntimeOverlayV1_1Draft = Omit<
  WorldArtRuntimeOverlayV1_1Manifest,
  'overlay_id'
>;

export type WorldArtRuntimeOverlayV1_1ErrorCode =
  | 'world-art-runtime-overlay-1.1.invalid-shape'
  | 'world-art-runtime-overlay-1.1.invalid-value'
  | 'world-art-runtime-overlay-1.1.invalid-rights'
  | 'world-art-runtime-overlay-1.1.invalid-file'
  | 'world-art-runtime-overlay-1.1.invalid-order'
  | 'world-art-runtime-overlay-1.1.invalid-binding';

export class WorldArtRuntimeOverlayV1_1Error extends Error {
  constructor(
    readonly code: WorldArtRuntimeOverlayV1_1ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorldArtRuntimeOverlayV1_1Error';
  }
}

type DataRecord = Record<string, unknown>;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const OVERLAY_ID = /^world-art-runtime-overlay-[a-f0-9]{16}$/;

function fail(code: WorldArtRuntimeOverlayV1_1ErrorCode, message: string): never {
  throw new WorldArtRuntimeOverlayV1_1Error(code, message);
}

function isRecord(value: unknown): value is DataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: DataRecord,
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
      'world-art-runtime-overlay-1.1.invalid-shape',
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
      fail('world-art-runtime-overlay-1.1.invalid-value', 'Manifest has a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay-1.1.invalid-value', 'Manifest has an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('world-art-runtime-overlay-1.1.invalid-value', `${label} must be SHA-256.`);
  }
  return value;
}

function safeId(value: unknown, label: string, maximum = 160): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || !SAFE_ID.test(value)
  ) {
    fail('world-art-runtime-overlay-1.1.invalid-value', `${label} is invalid.`);
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
    fail('world-art-runtime-overlay-1.1.invalid-file', `${label} is not portable.`);
  }
  return value;
}

function materializeRights(value: unknown): ProductionArtRights {
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay-1.1.invalid-shape', 'Overlay rights must be an object.');
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
    || !PRODUCTION_ART_LICENSES.includes(value.license as ProductionArtRights['license'])
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
    fail('world-art-runtime-overlay-1.1.invalid-rights', 'Overlay rights are invalid.');
  }
  return Object.freeze({
    distribution: value.distribution as ProductionArtRights['distribution'],
    license: value.license as ProductionArtRights['license'],
    ...(value.attribution === undefined ? {} : { attribution: value.attribution }),
  });
}

function materializeFile(
  value: unknown,
  index: number,
): WorldArtRuntimeOverlayV1_1File {
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay-1.1.invalid-shape', `File ${index} must be an object.`);
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
    fail('world-art-runtime-overlay-1.1.invalid-file', `File ${index} is invalid.`);
  }
  return Object.freeze({
    path,
    media_type: value.media_type as WorldArtRuntimeOverlayV1_1File['media_type'],
    bytes: value.bytes as number,
    sha256: digest(value.sha256, `File ${index} SHA-256`),
  });
}

function payload(
  value: WorldArtRuntimeOverlayV1_1Manifest,
): WorldArtRuntimeOverlayV1_1Draft {
  return Object.freeze({
    schema_version: value.schema_version,
    document_type: value.document_type,
    profile: value.profile,
    source: value.source,
    rights: value.rights,
    review: value.review,
    projection: value.projection,
    visual_placement: value.visual_placement,
    files: value.files,
    reference_policy: value.reference_policy,
  });
}

export async function materializeWorldArtRuntimeOverlayV1_1(
  value: unknown,
): Promise<WorldArtRuntimeOverlayV1_1Manifest> {
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay-1.1.invalid-shape', 'Overlay manifest must be an object.');
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
    'visual_placement',
    'files',
    'reference_policy',
  ], 'Overlay manifest');
  if (
    value.schema_version !== WORLD_ART_RUNTIME_OVERLAY_V1_1_VERSION
    || value.document_type !== 'world-art-runtime-overlay'
    || typeof value.overlay_id !== 'string'
    || !OVERLAY_ID.test(value.overlay_id)
    || !isWorldAssetProfile(value.profile)
    || !isRecord(value.source)
    || !isRecord(value.review)
    || !isRecord(value.projection)
    || !isRecord(value.visual_placement)
    || !Array.isArray(value.files)
    || !isRecord(value.reference_policy)
  ) {
    fail('world-art-runtime-overlay-1.1.invalid-value', 'Overlay identity is invalid.');
  }
  exactKeys(value.source, [
    'projection_id',
    'projection_sha256',
    'layout_plan_id',
    'layout_plan_sha256',
    'placement_plan_id',
    'placement_plan_sha256',
    'placement_map_id',
    'placement_map_sha256',
    'review_record_sha256',
  ], 'Overlay source');
  const source = Object.freeze({
    projection_id: safeId(value.source.projection_id, 'Projection id'),
    projection_sha256: digest(value.source.projection_sha256, 'Projection SHA-256'),
    layout_plan_id: safeId(value.source.layout_plan_id, 'Layout plan id'),
    layout_plan_sha256: digest(value.source.layout_plan_sha256, 'Layout SHA-256'),
    placement_plan_id: safeId(value.source.placement_plan_id, 'Placement plan id'),
    placement_plan_sha256: digest(
      value.source.placement_plan_sha256,
      'Placement plan SHA-256',
    ),
    placement_map_id: safeId(value.source.placement_map_id, 'Placement map id'),
    placement_map_sha256: digest(
      value.source.placement_map_sha256,
      'Placement map SHA-256',
    ),
    review_record_sha256: digest(value.source.review_record_sha256, 'Review SHA-256'),
  });
  const rights = materializeRights(value.rights);
  exactKeys(value.review, ['human_art', 'runtime', 'raspberry_pi'], 'Overlay review');
  if (
    value.review.human_art !== 'pass'
    || value.review.runtime !== 'pending'
    || value.review.raspberry_pi !== 'pending'
  ) {
    fail('world-art-runtime-overlay-1.1.invalid-value', 'Overlay review state is invalid.');
  }
  const review = Object.freeze({
    human_art: 'pass' as const,
    runtime: 'pending' as const,
    raspberry_pi: 'pending' as const,
  });
  exactKeys(value.projection, ['path', 'sha256'], 'Overlay projection');
  if (value.projection.path !== WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH) {
    fail('world-art-runtime-overlay-1.1.invalid-binding', 'Projection path is invalid.');
  }
  const projection = Object.freeze({
    path: WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH,
    sha256: digest(value.projection.sha256, 'Projection file SHA-256'),
  });
  exactKeys(
    value.visual_placement,
    ['plan_path', 'plan_sha256', 'map_path', 'map_sha256'],
    'Overlay visual placement',
  );
  if (
    value.visual_placement.plan_path
      !== WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH
    || value.visual_placement.map_path
      !== WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH
  ) {
    fail('world-art-runtime-overlay-1.1.invalid-binding', 'Visual placement paths are invalid.');
  }
  const visualPlacement = Object.freeze({
    plan_path: WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH,
    plan_sha256: digest(
      value.visual_placement.plan_sha256,
      'Placement plan file SHA-256',
    ),
    map_path: WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH,
    map_sha256: digest(value.visual_placement.map_sha256, 'Placement map file SHA-256'),
  });
  const files = Object.freeze(value.files.map(materializeFile));
  if (
    files.length < 4
    || new Set(files.map(({ path }) => path)).size !== files.length
    || files.some((file, index) =>
      index > 0 && files[index - 1]!.path.localeCompare(file.path, 'en') >= 0)
  ) {
    fail(
      'world-art-runtime-overlay-1.1.invalid-order',
      'Overlay files must be unique and canonically sorted.',
    );
  }
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  if (
    fileByPath.get(projection.path)?.sha256 !== projection.sha256
    || fileByPath.get(visualPlacement.plan_path)?.sha256 !== visualPlacement.plan_sha256
    || fileByPath.get(visualPlacement.map_path)?.sha256 !== visualPlacement.map_sha256
  ) {
    fail(
      'world-art-runtime-overlay-1.1.invalid-binding',
      'Overlay document references do not match the file inventory.',
    );
  }
  exactKeys(value.reference_policy, [
    'embedded',
    'original_references_excluded',
    'raw_prompts_excluded',
    'only_one_way_audit_hashes_retained',
  ], 'Overlay reference policy');
  if (
    value.reference_policy.embedded !== false
    || value.reference_policy.original_references_excluded !== true
    || value.reference_policy.raw_prompts_excluded !== true
    || value.reference_policy.only_one_way_audit_hashes_retained !== true
  ) {
    fail(
      'world-art-runtime-overlay-1.1.invalid-binding',
      'Overlay reference policy must exclude private inputs and raw prompts.',
    );
  }
  const manifest = Object.freeze({
    schema_version: WORLD_ART_RUNTIME_OVERLAY_V1_1_VERSION,
    document_type: 'world-art-runtime-overlay' as const,
    overlay_id: value.overlay_id,
    profile: value.profile,
    source,
    rights,
    review,
    projection,
    visual_placement: visualPlacement,
    files,
    reference_policy: Object.freeze({
      embedded: false as const,
      original_references_excluded: true as const,
      raw_prompts_excluded: true as const,
      only_one_way_audit_hashes_retained: true as const,
    }),
  });
  const expectedId = `world-art-runtime-overlay-${(
    await sha256(payload(manifest))
  ).slice(0, 16)}`;
  if (manifest.overlay_id !== expectedId) {
    fail(
      'world-art-runtime-overlay-1.1.invalid-binding',
      'Overlay id does not match its canonical payload.',
    );
  }
  return manifest;
}

export async function buildWorldArtRuntimeOverlayV1_1(
  value: WorldArtRuntimeOverlayV1_1Draft,
): Promise<WorldArtRuntimeOverlayV1_1Manifest> {
  const overlayId = `world-art-runtime-overlay-${(await sha256(value)).slice(0, 16)}`;
  return materializeWorldArtRuntimeOverlayV1_1({
    ...value,
    overlay_id: overlayId,
  });
}

export async function fingerprintWorldArtRuntimeOverlayV1_1(
  value: unknown,
): Promise<string> {
  return sha256(await materializeWorldArtRuntimeOverlayV1_1(value));
}

export async function serializeCanonicalWorldArtRuntimeOverlayV1_1(
  value: unknown,
): Promise<Uint8Array> {
  const manifest = await materializeWorldArtRuntimeOverlayV1_1(value);
  return new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
}
