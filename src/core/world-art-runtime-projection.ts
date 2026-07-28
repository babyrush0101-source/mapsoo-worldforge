import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import type {
  ProductionArtAlphaPolicy,
  ProductionArtRights,
} from './production-art-contract';
import {
  PRODUCTION_ART_DISTRIBUTIONS,
  PRODUCTION_ART_LICENSES,
} from './production-art-contract';

export const WORLD_ART_RUNTIME_PROJECTION_VERSION = '1.0.0' as const;

export type WorldArtRuntimeUsageKind =
  | 'terrain-material'
  | 'landmark'
  | 'hazard'
  | 'character';

export interface WorldArtRuntimeRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WorldArtRuntimeProjectionImage {
  readonly task_id: string;
  readonly path: string;
  readonly media_type: 'image/png';
  readonly bytes: number;
  readonly sha256: string;
  readonly output_sha256: string;
  readonly width: number;
  readonly height: number;
  readonly cell_size: readonly [number, number];
  readonly pivot: readonly [number, number];
  readonly alpha_policy: ProductionArtAlphaPolicy;
}

export interface WorldArtRuntimePose {
  readonly action: string;
  readonly direction: string;
  readonly frame_index: number;
  readonly duration_ms: number;
  readonly region: WorldArtRuntimeRegion;
}

export interface WorldArtRuntimeAsset {
  readonly task_id: string;
  readonly slot_id: string;
  readonly requirement_id: string;
  readonly role: string;
  readonly variant_id: string;
  readonly image_path: string;
  readonly region: WorldArtRuntimeRegion;
  readonly cell_sha256: string;
  readonly poses: readonly WorldArtRuntimePose[];
}

export interface WorldArtRuntimeBinding {
  readonly usage_kind: WorldArtRuntimeUsageKind;
  readonly usage_id: string;
  readonly task_id: string;
  readonly slot_id: string;
  readonly role: string;
  readonly variant_id: string;
  readonly image_path: string;
  readonly region: WorldArtRuntimeRegion;
  readonly cell_sha256: string;
  readonly poses: readonly WorldArtRuntimePose[];
}

export interface WorldArtRuntimeProjection {
  readonly schema_version: typeof WORLD_ART_RUNTIME_PROJECTION_VERSION;
  readonly document_type: 'world-art-runtime-projection';
  readonly projection_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    variant_map_id: string;
    variant_map_sha256: string;
    layout_plan_sha256: string;
    production_art_plan_id: string;
    production_art_plan_sha256: string;
    requirements_sha256: string;
    run_set_sha256: string;
    reviewed_slot_inventory_sha256: string;
    review_record_sha256: string;
  }>;
  readonly rights: ProductionArtRights;
  readonly images: readonly WorldArtRuntimeProjectionImage[];
  readonly assets: readonly WorldArtRuntimeAsset[];
  readonly bindings: readonly WorldArtRuntimeBinding[];
}

export type WorldArtRuntimeProjectionDraft = Omit<
  WorldArtRuntimeProjection,
  'projection_id'
>;

export type WorldArtRuntimeProjectionErrorCode =
  | 'world-art-runtime-projection.invalid-shape'
  | 'world-art-runtime-projection.invalid-value'
  | 'world-art-runtime-projection.invalid-image'
  | 'world-art-runtime-projection.invalid-binding'
  | 'world-art-runtime-projection.invalid-order';

export class WorldArtRuntimeProjectionError extends Error {
  constructor(readonly code: WorldArtRuntimeProjectionErrorCode, message: string) {
    super(message);
    this.name = 'WorldArtRuntimeProjectionError';
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_ROLE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const PROJECTION_ID = /^world-art-runtime-projection-[a-f0-9]{16}$/;
const USAGE_ORDER: Readonly<Record<WorldArtRuntimeUsageKind, number>> = Object.freeze({
  'terrain-material': 0,
  landmark: 1,
  hazard: 2,
  character: 3,
});

function fail(code: WorldArtRuntimeProjectionErrorCode, message: string): never {
  throw new WorldArtRuntimeProjectionError(code, message);
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
      'world-art-runtime-projection.invalid-shape',
      `${label} must contain exactly: ${expected.join(', ')}.`,
    );
  }
}

function safeId(value: unknown, label: string, maximum = 160): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || !SAFE_ID.test(value)
  ) {
    fail('world-art-runtime-projection.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('world-art-runtime-projection.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum = 131071,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    fail('world-art-runtime-projection.invalid-value', `${label} is invalid.`);
  }
  return value as number;
}

function safePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.includes('\\')
    || value.split('/').some((segment) => segment === '.' || segment === '..')
    || !value.endsWith('.png')
  ) {
    fail('world-art-runtime-projection.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function materializeRegion(value: unknown, label: string): WorldArtRuntimeRegion {
  if (!isRecord(value)) {
    fail('world-art-runtime-projection.invalid-shape', `${label} must be an object.`);
  }
  exactKeys(value, ['x', 'y', 'width', 'height'], label);
  return Object.freeze({
    x: integer(value.x, `${label} x`, 0),
    y: integer(value.y, `${label} y`, 0),
    width: integer(value.width, `${label} width`, 1, 8192),
    height: integer(value.height, `${label} height`, 1, 8192),
  });
}

function materializeRights(value: unknown): ProductionArtRights {
  if (!isRecord(value)) {
    fail('world-art-runtime-projection.invalid-shape', 'Projection rights must be an object.');
  }
  const expectedKeys = value.attribution === undefined
    ? ['distribution', 'license']
    : ['distribution', 'license', 'attribution'];
  exactKeys(value, expectedKeys, 'Projection rights');
  if (
    !PRODUCTION_ART_DISTRIBUTIONS.includes(
      value.distribution as ProductionArtRights['distribution'],
    )
    || typeof value.license !== 'string'
    || !PRODUCTION_ART_LICENSES.includes(
      value.license as ProductionArtRights['license'],
    )
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
    fail('world-art-runtime-projection.invalid-value', 'Projection rights are invalid.');
  }
  return Object.freeze({
    distribution: value.distribution as ProductionArtRights['distribution'],
    license: value.license as ProductionArtRights['license'],
    ...(value.attribution === undefined ? {} : { attribution: value.attribution }),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('world-art-runtime-projection.invalid-value', 'Projection has a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('world-art-runtime-projection.invalid-value', 'Projection has an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function tuple2(
  value: unknown,
  label: string,
  minimum: number,
): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    fail('world-art-runtime-projection.invalid-shape', `${label} must have two items.`);
  }
  return Object.freeze([
    integer(value[0], `${label}[0]`, minimum, 8192),
    integer(value[1], `${label}[1]`, minimum, 8192),
  ]);
}

function regionInside(
  region: WorldArtRuntimeRegion,
  image: WorldArtRuntimeProjectionImage,
): boolean {
  return region.x + region.width <= image.width
    && region.y + region.height <= image.height;
}

function materializeImage(
  value: unknown,
  index: number,
): WorldArtRuntimeProjectionImage {
  if (!isRecord(value)) {
    fail('world-art-runtime-projection.invalid-shape', `Image ${index} must be an object.`);
  }
  exactKeys(value, [
    'task_id',
    'path',
    'media_type',
    'bytes',
    'sha256',
    'output_sha256',
    'width',
    'height',
    'cell_size',
    'pivot',
    'alpha_policy',
  ], `Image ${index}`);
  if (
    value.media_type !== 'image/png'
    || !['opaque', 'straight-alpha'].includes(String(value.alpha_policy))
  ) {
    fail('world-art-runtime-projection.invalid-image', `Image ${index} identity is invalid.`);
  }
  const image = Object.freeze({
    task_id: safeId(value.task_id, `Image ${index} task id`),
    path: safePath(value.path, `Image ${index} path`),
    media_type: 'image/png' as const,
    bytes: integer(value.bytes, `Image ${index} bytes`, 1, 64 * 1024 * 1024),
    sha256: digest(value.sha256, `Image ${index} SHA-256`),
    output_sha256: digest(value.output_sha256, `Image ${index} output SHA-256`),
    width: integer(value.width, `Image ${index} width`, 1, 8192),
    height: integer(value.height, `Image ${index} height`, 1, 8192),
    cell_size: tuple2(value.cell_size, `Image ${index} cell size`, 1),
    pivot: tuple2(value.pivot, `Image ${index} pivot`, 0),
    alpha_policy: value.alpha_policy as ProductionArtAlphaPolicy,
  });
  if (
    image.width % image.cell_size[0] !== 0
    || image.height % image.cell_size[1] !== 0
    || image.pivot[0] > image.cell_size[0]
    || image.pivot[1] > image.cell_size[1]
  ) {
    fail('world-art-runtime-projection.invalid-image', `Image ${index} geometry is invalid.`);
  }
  return image;
}

function materializePose(value: unknown, label: string): WorldArtRuntimePose {
  if (!isRecord(value)) {
    fail('world-art-runtime-projection.invalid-shape', `${label} must be an object.`);
  }
  exactKeys(
    value,
    ['action', 'direction', 'frame_index', 'duration_ms', 'region'],
    label,
  );
  return Object.freeze({
    action: safeId(value.action, `${label} action`, 80),
    direction: safeId(value.direction, `${label} direction`, 80),
    frame_index: integer(value.frame_index, `${label} frame`, 0, 255),
    duration_ms: integer(value.duration_ms, `${label} duration`, 16, 10000),
    region: materializeRegion(value.region, `${label} region`),
  });
}

function materializeBinding(
  value: unknown,
  index: number,
): WorldArtRuntimeBinding {
  if (!isRecord(value)) {
    fail('world-art-runtime-projection.invalid-shape', `Binding ${index} must be an object.`);
  }
  exactKeys(value, [
    'usage_kind',
    'usage_id',
    'task_id',
    'slot_id',
    'role',
    'variant_id',
    'image_path',
    'region',
    'cell_sha256',
    'poses',
  ], `Binding ${index}`);
  if (
    !Object.hasOwn(USAGE_ORDER, String(value.usage_kind))
    || typeof value.role !== 'string'
    || value.role.length > 100
    || !SAFE_ROLE.test(value.role)
    || !Array.isArray(value.poses)
    || value.poses.length > 256
  ) {
    fail('world-art-runtime-projection.invalid-binding', `Binding ${index} is invalid.`);
  }
  const usageKind = value.usage_kind as WorldArtRuntimeUsageKind;
  const poses = Object.freeze(value.poses.map((pose, poseIndex) =>
    materializePose(pose, `Binding ${index} pose ${poseIndex}`)));
  if (
    (usageKind === 'character' && poses.length < 1)
    || (usageKind !== 'character' && poses.length !== 0)
  ) {
    fail(
      'world-art-runtime-projection.invalid-binding',
      `Binding ${index} pose inventory does not match its usage kind.`,
    );
  }
  return Object.freeze({
    usage_kind: usageKind,
    usage_id: safeId(value.usage_id, `Binding ${index} usage id`),
    task_id: safeId(value.task_id, `Binding ${index} task id`),
    slot_id: safeId(value.slot_id, `Binding ${index} slot id`),
    role: value.role,
    variant_id: safeId(value.variant_id, `Binding ${index} variant id`),
    image_path: safePath(value.image_path, `Binding ${index} image path`),
    region: materializeRegion(value.region, `Binding ${index} region`),
    cell_sha256: digest(value.cell_sha256, `Binding ${index} cell SHA-256`),
    poses,
  });
}

function materializeAsset(
  value: unknown,
  index: number,
): WorldArtRuntimeAsset {
  if (!isRecord(value)) {
    fail('world-art-runtime-projection.invalid-shape', `Asset ${index} must be an object.`);
  }
  exactKeys(value, [
    'task_id',
    'slot_id',
    'requirement_id',
    'role',
    'variant_id',
    'image_path',
    'region',
    'cell_sha256',
    'poses',
  ], `Asset ${index}`);
  if (
    typeof value.role !== 'string'
    || value.role.length > 100
    || !SAFE_ROLE.test(value.role)
    || !Array.isArray(value.poses)
    || value.poses.length > 256
  ) {
    fail('world-art-runtime-projection.invalid-binding', `Asset ${index} is invalid.`);
  }
  const poses = Object.freeze(value.poses.map((pose, poseIndex) =>
    materializePose(pose, `Asset ${index} pose ${poseIndex}`)));
  if (
    (value.role.startsWith('character.') && poses.length < 1)
    || (!value.role.startsWith('character.') && poses.length !== 0)
  ) {
    fail(
      'world-art-runtime-projection.invalid-binding',
      `Asset ${index} pose inventory does not match its role.`,
    );
  }
  return Object.freeze({
    task_id: safeId(value.task_id, `Asset ${index} task id`),
    slot_id: safeId(value.slot_id, `Asset ${index} slot id`),
    requirement_id: safeId(value.requirement_id, `Asset ${index} requirement id`),
    role: value.role,
    variant_id: safeId(value.variant_id, `Asset ${index} variant id`),
    image_path: safePath(value.image_path, `Asset ${index} image path`),
    region: materializeRegion(value.region, `Asset ${index} region`),
    cell_sha256: digest(value.cell_sha256, `Asset ${index} cell SHA-256`),
    poses,
  });
}

function compareBindings(
  left: WorldArtRuntimeBinding,
  right: WorldArtRuntimeBinding,
): number {
  return USAGE_ORDER[left.usage_kind] - USAGE_ORDER[right.usage_kind]
    || left.usage_id.localeCompare(right.usage_id, 'en')
    || left.slot_id.localeCompare(right.slot_id, 'en');
}

function compareAssets(left: WorldArtRuntimeAsset, right: WorldArtRuntimeAsset): number {
  return left.task_id.localeCompare(right.task_id, 'en')
    || left.slot_id.localeCompare(right.slot_id, 'en');
}

function comparePoses(left: WorldArtRuntimePose, right: WorldArtRuntimePose): number {
  return left.action.localeCompare(right.action, 'en')
    || left.direction.localeCompare(right.direction, 'en')
    || left.frame_index - right.frame_index;
}

export async function materializeWorldArtRuntimeProjection(
  value: unknown,
): Promise<WorldArtRuntimeProjection> {
  if (!isRecord(value)) {
    fail('world-art-runtime-projection.invalid-shape', 'Projection must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'projection_id',
    'profile',
    'source',
    'rights',
    'images',
    'assets',
    'bindings',
  ], 'Projection');
  if (
    value.schema_version !== WORLD_ART_RUNTIME_PROJECTION_VERSION
    || value.document_type !== 'world-art-runtime-projection'
    || typeof value.projection_id !== 'string'
    || !PROJECTION_ID.test(value.projection_id)
    || !isWorldAssetProfile(value.profile)
    || !isRecord(value.source)
    || !Array.isArray(value.images)
    || value.images.length < 1
    || value.images.length > 256
    || !Array.isArray(value.assets)
    || value.assets.length < 1
    || value.assets.length > 2048
    || !Array.isArray(value.bindings)
    || value.bindings.length < 1
    || value.bindings.length > 2048
  ) {
    fail('world-art-runtime-projection.invalid-value', 'Projection identity is invalid.');
  }
  exactKeys(value.source, [
    'variant_map_id',
    'variant_map_sha256',
    'layout_plan_sha256',
    'production_art_plan_id',
    'production_art_plan_sha256',
    'requirements_sha256',
    'run_set_sha256',
    'reviewed_slot_inventory_sha256',
    'review_record_sha256',
  ], 'Projection source');
  const source = Object.freeze({
    variant_map_id: safeId(value.source.variant_map_id, 'Variant map id', 100),
    variant_map_sha256: digest(value.source.variant_map_sha256, 'Variant map SHA-256'),
    layout_plan_sha256: digest(value.source.layout_plan_sha256, 'Layout SHA-256'),
    production_art_plan_id: safeId(
      value.source.production_art_plan_id,
      'Production plan id',
      100,
    ),
    production_art_plan_sha256: digest(
      value.source.production_art_plan_sha256,
      'Production plan SHA-256',
    ),
    requirements_sha256: digest(value.source.requirements_sha256, 'Requirements SHA-256'),
    run_set_sha256: digest(value.source.run_set_sha256, 'Run-set SHA-256'),
    reviewed_slot_inventory_sha256: digest(
      value.source.reviewed_slot_inventory_sha256,
      'Reviewed inventory SHA-256',
    ),
    review_record_sha256: digest(value.source.review_record_sha256, 'Review record SHA-256'),
  });
  const rights = materializeRights(value.rights);
  const images = Object.freeze(value.images.map(materializeImage));
  const assets = Object.freeze(value.assets.map(materializeAsset));
  const bindings = Object.freeze(value.bindings.map(materializeBinding));
  if (
    new Set(images.map(({ task_id: taskId }) => taskId)).size !== images.length
    || new Set(images.map(({ path }) => path)).size !== images.length
    || images.some((image, index) =>
      index > 0 && images[index - 1]!.task_id.localeCompare(image.task_id, 'en') >= 0)
  ) {
    fail(
      'world-art-runtime-projection.invalid-order',
      'Projection images must be unique and sorted by task id.',
    );
  }
  if (
    new Set(assets.map(({ slot_id: slotId }) => slotId)).size !== assets.length
    || assets.some((asset, index) =>
      index > 0 && compareAssets(assets[index - 1]!, asset) >= 0)
  ) {
    fail(
      'world-art-runtime-projection.invalid-order',
      'Projection assets must have unique slots in canonical task/slot order.',
    );
  }
  if (bindings.some((binding, index) =>
    index > 0 && compareBindings(bindings[index - 1]!, binding) >= 0)) {
    fail(
      'world-art-runtime-projection.invalid-order',
      'Projection bindings must be unique and canonically sorted.',
    );
  }
  const imageByTask = new Map(images.map((image) => [image.task_id, image]));
  const assertImageGeometry = (
    item: WorldArtRuntimeAsset | WorldArtRuntimeBinding,
    label: string,
  ) => {
    const image = imageByTask.get(item.task_id);
    if (
      !image
      || image.path !== item.image_path
      || !regionInside(item.region, image)
      || item.region.x % image.cell_size[0] !== 0
      || item.region.y % image.cell_size[1] !== 0
      || item.region.width % image.cell_size[0] !== 0
      || item.region.height % image.cell_size[1] !== 0
      || item.poses.some((pose, index) =>
        !regionInside(pose.region, image)
        || pose.region.width !== image.cell_size[0]
        || pose.region.height !== image.cell_size[1]
        || pose.region.x % image.cell_size[0] !== 0
        || pose.region.y % image.cell_size[1] !== 0
        || (index > 0 && comparePoses(item.poses[index - 1]!, pose) >= 0))
    ) {
      fail(
        'world-art-runtime-projection.invalid-binding',
        `${label} is outside its image.`,
      );
    }
  };
  for (const asset of assets) {
    assertImageGeometry(asset, `Projection asset ${asset.slot_id}`);
  }
  const assetBySlot = new Map(assets.map((asset) => [asset.slot_id, asset]));
  for (const binding of bindings) {
    assertImageGeometry(
      binding,
      `Projection binding ${binding.usage_kind}/${binding.usage_id}`,
    );
    const asset = assetBySlot.get(binding.slot_id);
    if (
      !asset
      || binding.task_id !== asset.task_id
      || binding.role !== asset.role
      || binding.variant_id !== asset.variant_id
      || binding.image_path !== asset.image_path
      || binding.cell_sha256 !== asset.cell_sha256
      || canonicalJson(binding.region) !== canonicalJson(asset.region)
      || canonicalJson(binding.poses) !== canonicalJson(asset.poses)
    ) {
      fail(
        'world-art-runtime-projection.invalid-binding',
        `Projection binding ${binding.usage_kind}/${binding.usage_id} does not match its catalog asset.`,
      );
    }
  }
  if (images.some(({ task_id: taskId }) =>
    !assets.some(({ task_id: assetTaskId }) => assetTaskId === taskId))) {
    fail('world-art-runtime-projection.invalid-image', 'Projection contains an unused image.');
  }
  const projection = Object.freeze({
    schema_version: WORLD_ART_RUNTIME_PROJECTION_VERSION,
    document_type: 'world-art-runtime-projection' as const,
    projection_id: value.projection_id,
    profile: value.profile,
    source,
    rights,
    images,
    assets,
    bindings,
  });
  const expectedId = `world-art-runtime-projection-${(
    await sha256({
      schema_version: projection.schema_version,
      document_type: projection.document_type,
      profile: projection.profile,
      source: projection.source,
      rights: projection.rights,
      images: projection.images,
      assets: projection.assets,
      bindings: projection.bindings,
    })
  ).slice(0, 16)}`;
  if (projection.projection_id !== expectedId) {
    fail(
      'world-art-runtime-projection.invalid-value',
      'Projection id does not match its canonical runtime payload.',
    );
  }
  return projection;
}

export async function buildWorldArtRuntimeProjection(
  value: WorldArtRuntimeProjectionDraft,
): Promise<WorldArtRuntimeProjection> {
  const projectionId = `world-art-runtime-projection-${(
    await sha256({
      schema_version: value.schema_version,
      document_type: value.document_type,
      profile: value.profile,
      source: value.source,
      rights: value.rights,
      images: value.images,
      assets: value.assets,
      bindings: value.bindings,
    })
  ).slice(0, 16)}`;
  return materializeWorldArtRuntimeProjection({
    ...value,
    projection_id: projectionId,
  });
}

export async function fingerprintWorldArtRuntimeProjection(value: unknown): Promise<string> {
  return sha256(await materializeWorldArtRuntimeProjection(value));
}

export async function serializeCanonicalWorldArtRuntimeProjection(
  value: unknown,
): Promise<Uint8Array> {
  const projection = await materializeWorldArtRuntimeProjection(value);
  return new TextEncoder().encode(`${canonicalJson(projection)}\n`);
}
