import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from './world-layout-plan';
import {
  materializeWorldMaterialPalette,
  type PreparedWorldMaterialPalettePackEntry,
  type WorldMaterialPalette,
} from './world-material-palette';
import type { PreparedWorldLayoutPackEntry } from './world-layout-pack-binding';

export const WORLD_TERRAIN_AUTOTILE_VERSION = '1.0.0' as const;
export const WORLD_TERRAIN_AUTOTILE_PATH = 'world-terrain-autotiles.json' as const;
export const WORLD_TERRAIN_AUTOTILE_MASK_KIND = 'edge-mask-16' as const;
export const WORLD_TERRAIN_AUTOTILE_BIT_ORDER = Object.freeze([
  'north',
  'east',
  'south',
  'west',
] as const);

export interface WorldTerrainAutotileCoordinate {
  readonly mask: number;
  readonly column: number;
  readonly row: number;
}

export interface WorldTerrainAutotileSet {
  readonly schema_version: typeof WORLD_TERRAIN_AUTOTILE_VERSION;
  readonly document_type: 'world-terrain-autotile-set';
  readonly set_id: string;
  readonly profile: WorldAssetProfile;
  readonly layout: Readonly<{
    plan_id: string;
    sha256: string;
  }>;
  readonly palette: Readonly<{
    palette_id: string;
    sha256: string;
  }>;
  readonly selection: Readonly<{
    kind: typeof WORLD_TERRAIN_AUTOTILE_MASK_KIND;
    bit_order: typeof WORLD_TERRAIN_AUTOTILE_BIT_ORDER;
    outside: 'different-material';
  }>;
  readonly cell: Readonly<{
    width: number;
    height: number;
  }>;
  readonly entries: readonly Readonly<{
    material: string;
    role: string;
    image: Readonly<{
      path: string;
      sha256: string;
      width: number;
      height: number;
    }>;
    tiles: readonly WorldTerrainAutotileCoordinate[];
  }>[];
}

export interface WorldTerrainAutotilePackBinding {
  readonly schema_version: typeof WORLD_TERRAIN_AUTOTILE_VERSION;
  readonly document_type: 'world-terrain-autotile-set';
  readonly set_id: string;
  readonly layout_plan_sha256: string;
  readonly material_palette_sha256: string;
  readonly path: typeof WORLD_TERRAIN_AUTOTILE_PATH;
  readonly sha256: string;
}

export interface PreparedWorldTerrainAutotilePackEntry {
  readonly set: WorldTerrainAutotileSet;
  readonly bytes: Uint8Array;
  readonly binding: WorldTerrainAutotilePackBinding;
}

export interface WorldTerrainAutotileImageInput {
  readonly material: string;
  readonly path: string;
  readonly sha256: string;
}

export interface WorldTerrainAutotilePackFileRecord {
  readonly path: string;
  readonly media_type: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface WorldTerrainAutotilePackBindingIssue {
  readonly code: string;
  readonly message: string;
}

export type WorldTerrainAutotileErrorCode =
  | 'terrain-autotile.invalid-shape'
  | 'terrain-autotile.invalid-value'
  | 'terrain-autotile.invalid-binding'
  | 'terrain-autotile.incomplete';

export class WorldTerrainAutotileError extends Error {
  constructor(readonly code: WorldTerrainAutotileErrorCode, message: string) {
    super(message);
    this.name = 'WorldTerrainAutotileError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_ROLE = /^terrain\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

type DataRecord = Record<string, unknown>;

function fail(code: WorldTerrainAutotileErrorCode, message: string): never {
  throw new WorldTerrainAutotileError(code, message);
}

function isRecord(value: unknown): value is DataRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: DataRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (
    actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])
  ) {
    fail(
      'terrain-autotile.invalid-shape',
      `${label} must contain exactly: ${canonical.join(', ')}.`,
    );
  }
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 80 || !SAFE_ID.test(value)) {
    fail('terrain-autotile.invalid-value', `${label} must be lowercase kebab-case.`);
  }
  return value;
}

function safeRole(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 120 || !SAFE_ROLE.test(value)) {
    fail('terrain-autotile.invalid-value', `${label} must be a canonical terrain role.`);
  }
  return value;
}

function safePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    fail('terrain-autotile.invalid-value', `${label} must be a safe relative path.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('terrain-autotile.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail('terrain-autotile.invalid-value', `${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail('terrain-autotile.invalid-value', 'Autotile set cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('terrain-autotile.invalid-value', 'Autotile set contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digestBuffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function rowMajorCoordinates(): readonly WorldTerrainAutotileCoordinate[] {
  return Object.freeze(Array.from({ length: 16 }, (_, mask) => Object.freeze({
    mask,
    column: mask % 4,
    row: Math.floor(mask / 4),
  })));
}

function materializeCoordinates(value: unknown, entryIndex: number): readonly WorldTerrainAutotileCoordinate[] {
  if (!Array.isArray(value) || value.length !== 16) {
    fail(
      'terrain-autotile.incomplete',
      `Autotile entry ${entryIndex} must map all 16 edge masks.`,
    );
  }
  const coordinates = Object.freeze(value.map((candidate, coordinateIndex) => {
    if (!isRecord(candidate)) {
      fail(
        'terrain-autotile.invalid-shape',
        `Autotile entry ${entryIndex} tile ${coordinateIndex} must be an object.`,
      );
    }
    exactKeys(candidate, ['mask', 'column', 'row'], `Autotile entry ${entryIndex} tile ${coordinateIndex}`);
    return Object.freeze({
      mask: integer(candidate.mask, 0, 15, `Autotile entry ${entryIndex} tile mask`),
      column: integer(candidate.column, 0, 3, `Autotile entry ${entryIndex} tile column`),
      row: integer(candidate.row, 0, 3, `Autotile entry ${entryIndex} tile row`),
    });
  }));
  const masks = coordinates.map(({ mask }) => mask);
  const cells = coordinates.map(({ column, row }) => `${column},${row}`);
  if (
    masks.some((mask, index) => mask !== index)
    || new Set(cells).size !== 16
  ) {
    fail(
      'terrain-autotile.incomplete',
      `Autotile entry ${entryIndex} must map masks 0-15 in order to unique 4x4 cells.`,
    );
  }
  return coordinates;
}

export async function materializeWorldTerrainAutotileSet(
  value: unknown,
  expected?: Readonly<{
    plan: unknown;
    layoutPlanSha256: string;
    palette: unknown;
    materialPaletteSha256: string;
    imageFiles?: readonly WorldTerrainAutotilePackFileRecord[];
  }>,
): Promise<WorldTerrainAutotileSet> {
  if (!isRecord(value)) {
    fail('terrain-autotile.invalid-shape', 'World terrain autotile set must be an object.');
  }
  exactKeys(
    value,
    ['schema_version', 'document_type', 'set_id', 'profile', 'layout', 'palette', 'selection', 'cell', 'entries'],
    'World terrain autotile set',
  );
  if (
    value.schema_version !== WORLD_TERRAIN_AUTOTILE_VERSION
    || value.document_type !== 'world-terrain-autotile-set'
    || !isWorldAssetProfile(value.profile)
  ) {
    fail('terrain-autotile.invalid-value', 'World terrain autotile identity is invalid.');
  }
  if (!isRecord(value.layout) || !isRecord(value.palette) || !isRecord(value.selection) || !isRecord(value.cell)) {
    fail('terrain-autotile.invalid-shape', 'World terrain autotile bindings and selection must be objects.');
  }
  exactKeys(value.layout, ['plan_id', 'sha256'], 'Autotile layout binding');
  exactKeys(value.palette, ['palette_id', 'sha256'], 'Autotile palette binding');
  exactKeys(value.selection, ['kind', 'bit_order', 'outside'], 'Autotile selection');
  exactKeys(value.cell, ['width', 'height'], 'Autotile cell');
  if (
    value.selection.kind !== WORLD_TERRAIN_AUTOTILE_MASK_KIND
    || value.selection.outside !== 'different-material'
    || !Array.isArray(value.selection.bit_order)
    || value.selection.bit_order.length !== WORLD_TERRAIN_AUTOTILE_BIT_ORDER.length
    || value.selection.bit_order.some((direction, index) => (
      direction !== WORLD_TERRAIN_AUTOTILE_BIT_ORDER[index]
    ))
  ) {
    fail('terrain-autotile.invalid-value', 'Autotile selection convention is unsupported.');
  }
  const cell = Object.freeze({
    width: integer(value.cell.width, 1, 1024, 'Autotile cell width'),
    height: integer(value.cell.height, 1, 1024, 'Autotile cell height'),
  });
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 64) {
    fail('terrain-autotile.invalid-value', 'Autotile set requires from 1 to 64 entries.');
  }
  const entries = Object.freeze(value.entries.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('terrain-autotile.invalid-shape', `Autotile entry ${index} must be an object.`);
    }
    exactKeys(candidate, ['material', 'role', 'image', 'tiles'], `Autotile entry ${index}`);
    if (!isRecord(candidate.image)) {
      fail('terrain-autotile.invalid-shape', `Autotile entry ${index} image must be an object.`);
    }
    exactKeys(candidate.image, ['path', 'sha256', 'width', 'height'], `Autotile entry ${index} image`);
    const width = integer(candidate.image.width, 4, 4096, `Autotile entry ${index} image width`);
    const height = integer(candidate.image.height, 4, 4096, `Autotile entry ${index} image height`);
    if (width !== cell.width * 4 || height !== cell.height * 4) {
      fail(
        'terrain-autotile.invalid-value',
        `Autotile entry ${index} image must be exactly a 4x4 cell grid.`,
      );
    }
    return Object.freeze({
      material: safeId(candidate.material, `Autotile entry ${index} material`),
      role: safeRole(candidate.role, `Autotile entry ${index} role`),
      image: Object.freeze({
        path: safePath(candidate.image.path, `Autotile entry ${index} image path`),
        sha256: digest(candidate.image.sha256, `Autotile entry ${index} image digest`),
        width,
        height,
      }),
      tiles: materializeCoordinates(candidate.tiles, index),
    });
  }));
  const materials = entries.map(({ material }) => material);
  const paths = entries.map(({ image }) => image.path);
  if (
    new Set(materials).size !== materials.length
    || materials.some((material, index) => (
      index > 0 && materials[index - 1]!.localeCompare(material, 'en') >= 0
    ))
    || new Set(paths).size !== paths.length
  ) {
    fail(
      'terrain-autotile.invalid-value',
      'Autotile entries require sorted unique materials and unique image paths.',
    );
  }
  const set = Object.freeze({
    schema_version: WORLD_TERRAIN_AUTOTILE_VERSION,
    document_type: 'world-terrain-autotile-set' as const,
    set_id: safeId(value.set_id, 'Autotile set id'),
    profile: value.profile as WorldAssetProfile,
    layout: Object.freeze({
      plan_id: safeId(value.layout.plan_id, 'Autotile layout plan id'),
      sha256: digest(value.layout.sha256, 'Autotile layout digest'),
    }),
    palette: Object.freeze({
      palette_id: safeId(value.palette.palette_id, 'Autotile palette id'),
      sha256: digest(value.palette.sha256, 'Autotile palette digest'),
    }),
    selection: Object.freeze({
      kind: WORLD_TERRAIN_AUTOTILE_MASK_KIND,
      bit_order: WORLD_TERRAIN_AUTOTILE_BIT_ORDER,
      outside: 'different-material' as const,
    }),
    cell,
    entries,
  });
  if (expected) {
    const plan: WorldLayoutPlan = await materializeWorldLayoutPlan(expected.plan);
    const palette: WorldMaterialPalette = await materializeWorldMaterialPalette(expected.palette, {
      plan,
      layoutPlanSha256: expected.layoutPlanSha256,
    });
    if (
      set.profile !== plan.profile
      || set.layout.plan_id !== plan.plan_id
      || set.layout.sha256 !== expected.layoutPlanSha256
      || set.palette.palette_id !== palette.palette_id
      || set.palette.sha256 !== expected.materialPaletteSha256
    ) {
      fail('terrain-autotile.invalid-binding', 'Autotile set does not bind the exact layout and palette.');
    }
    if (
      palette.entries.length !== entries.length
      || palette.entries.some(({ material, role }, index) => (
        material !== entries[index]?.material || role !== entries[index]?.role
      ))
    ) {
      fail(
        'terrain-autotile.incomplete',
        'Autotile set must map every palette material and canonical role exactly once.',
      );
    }
    if (expected.imageFiles) {
      for (const entry of entries) {
        const record = expected.imageFiles.find(({ path }) => path === entry.image.path);
        if (
          !record
          || record.media_type !== 'image/png'
          || record.sha256 !== entry.image.sha256
          || !Number.isSafeInteger(record.bytes)
          || record.bytes < 1
        ) {
          fail(
            'terrain-autotile.invalid-binding',
            `Autotile image differs from its pack record: ${entry.image.path}.`,
          );
        }
      }
    }
  }
  return set;
}

export async function buildWorldTerrainAutotileSet(
  layout: PreparedWorldLayoutPackEntry,
  palette: PreparedWorldMaterialPalettePackEntry,
  cell: Readonly<{ width: number; height: number }>,
  images: readonly WorldTerrainAutotileImageInput[],
): Promise<WorldTerrainAutotileSet> {
  const imageByMaterial = new Map(images.map((image) => [image.material, image]));
  const entries = palette.palette.entries.map(({ material, role }) => {
    const image = imageByMaterial.get(material);
    if (!image) {
      fail('terrain-autotile.incomplete', `Autotile image is missing for palette material ${material}.`);
    }
    return Object.freeze({
      material,
      role,
      image: Object.freeze({
        path: image.path,
        sha256: image.sha256,
        width: cell.width * 4,
        height: cell.height * 4,
      }),
      tiles: rowMajorCoordinates(),
    });
  });
  if (images.length !== entries.length) {
    fail('terrain-autotile.incomplete', 'Autotile images must cover the palette without extras.');
  }
  return materializeWorldTerrainAutotileSet({
    schema_version: WORLD_TERRAIN_AUTOTILE_VERSION,
    document_type: 'world-terrain-autotile-set',
    set_id: `autotiles-${layout.plan.plan_id}`,
    profile: layout.plan.profile,
    layout: {
      plan_id: layout.plan.plan_id,
      sha256: layout.binding.sha256,
    },
    palette: {
      palette_id: palette.palette.palette_id,
      sha256: palette.binding.sha256,
    },
    selection: {
      kind: WORLD_TERRAIN_AUTOTILE_MASK_KIND,
      bit_order: WORLD_TERRAIN_AUTOTILE_BIT_ORDER,
      outside: 'different-material',
    },
    cell,
    entries,
  }, {
    plan: layout.plan,
    layoutPlanSha256: layout.binding.sha256,
    palette: palette.palette,
    materialPaletteSha256: palette.binding.sha256,
  });
}

export async function serializeCanonicalWorldTerrainAutotileSet(
  value: unknown,
): Promise<Uint8Array> {
  const set = await materializeWorldTerrainAutotileSet(value);
  return new TextEncoder().encode(`${canonicalJson(set)}\n`);
}

export async function prepareWorldTerrainAutotilePackEntry(
  layout: PreparedWorldLayoutPackEntry,
  palette: PreparedWorldMaterialPalettePackEntry,
  cell: Readonly<{ width: number; height: number }>,
  images: readonly WorldTerrainAutotileImageInput[],
): Promise<PreparedWorldTerrainAutotilePackEntry> {
  const set = await buildWorldTerrainAutotileSet(layout, palette, cell, images);
  const bytes = await serializeCanonicalWorldTerrainAutotileSet(set);
  return Object.freeze({
    set,
    bytes,
    binding: Object.freeze({
      schema_version: WORLD_TERRAIN_AUTOTILE_VERSION,
      document_type: 'world-terrain-autotile-set' as const,
      set_id: set.set_id,
      layout_plan_sha256: layout.binding.sha256,
      material_palette_sha256: palette.binding.sha256,
      path: WORLD_TERRAIN_AUTOTILE_PATH,
      sha256: await sha256(bytes),
    }),
  });
}

/** Manifest-only checks; the importer separately verifies exact JSON and PNG bytes. */
export function validateWorldTerrainAutotilePackBinding(
  binding: WorldTerrainAutotilePackBinding | undefined,
  layoutBinding: Readonly<{ sha256: string }> | undefined,
  paletteBinding: Readonly<{ sha256: string }> | undefined,
  files: readonly WorldTerrainAutotilePackFileRecord[],
): WorldTerrainAutotilePackBindingIssue[] {
  if (binding === undefined) return [];
  const issues: WorldTerrainAutotilePackBindingIssue[] = [];
  const keys = Object.keys(binding).sort();
  const expectedKeys = [
    'document_type',
    'layout_plan_sha256',
    'material_palette_sha256',
    'path',
    'schema_version',
    'set_id',
    'sha256',
  ];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    issues.push({
      code: 'terrain-autotile.binding-shape',
      message: 'World terrain autotile binding contains unsupported or missing fields.',
    });
  }
  if (
    binding.schema_version !== WORLD_TERRAIN_AUTOTILE_VERSION
    || binding.document_type !== 'world-terrain-autotile-set'
    || binding.path !== WORLD_TERRAIN_AUTOTILE_PATH
    || !SAFE_ID.test(binding.set_id)
    || !SHA256.test(binding.layout_plan_sha256)
    || !SHA256.test(binding.material_palette_sha256)
    || !SHA256.test(binding.sha256)
  ) {
    issues.push({
      code: 'terrain-autotile.binding',
      message: 'World terrain autotile binding is not canonical.',
    });
  }
  if (!layoutBinding || binding.layout_plan_sha256 !== layoutBinding.sha256) {
    issues.push({
      code: 'terrain-autotile.layout-binding',
      message: 'World terrain autotiles must bind the manifest WorldLayoutPlan bytes.',
    });
  }
  if (!paletteBinding || binding.material_palette_sha256 !== paletteBinding.sha256) {
    issues.push({
      code: 'terrain-autotile.palette-binding',
      message: 'World terrain autotiles must bind the manifest WorldMaterialPalette bytes.',
    });
  }
  const record = files.find(({ path }) => path === binding.path);
  if (
    !record
    || record.media_type !== 'application/json'
    || record.sha256 !== binding.sha256
    || !Number.isSafeInteger(record.bytes)
    || record.bytes < 1
  ) {
    issues.push({
      code: 'terrain-autotile.file-record',
      message: 'World terrain autotile binding must match its JSON file integrity record.',
    });
  }
  return issues;
}
