import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  materializeWorldLayoutPlan,
  type WorldLayoutTerrain,
  type WorldLayoutPlan,
} from './world-layout-plan';
import type { PreparedWorldLayoutPackEntry } from './world-layout-pack-binding';

export const WORLD_MATERIAL_PALETTE_VERSION = '1.0.0' as const;
export const WORLD_MATERIAL_PALETTE_PATH = 'world-material-palette.json' as const;

export interface WorldMaterialPalette {
  readonly schema_version: typeof WORLD_MATERIAL_PALETTE_VERSION;
  readonly document_type: 'world-material-palette';
  readonly palette_id: string;
  readonly profile: WorldAssetProfile;
  readonly layout: Readonly<{
    plan_id: string;
    sha256: string;
  }>;
  readonly entries: readonly Readonly<{
    material: string;
    role: string;
    rendering: 'single-cell';
  }>[];
}

export interface WorldMaterialPalettePackBinding {
  readonly schema_version: typeof WORLD_MATERIAL_PALETTE_VERSION;
  readonly document_type: 'world-material-palette';
  readonly palette_id: string;
  readonly layout_plan_sha256: string;
  readonly path: typeof WORLD_MATERIAL_PALETTE_PATH;
  readonly sha256: string;
}

export interface PreparedWorldMaterialPalettePackEntry {
  readonly palette: WorldMaterialPalette;
  readonly bytes: Uint8Array;
  readonly binding: WorldMaterialPalettePackBinding;
}

export interface WorldMaterialPalettePackFileRecord {
  readonly path: string;
  readonly media_type: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface WorldMaterialPalettePackBindingIssue {
  readonly code: string;
  readonly message: string;
}

export type WorldMaterialPaletteErrorCode =
  | 'material-palette.invalid-shape'
  | 'material-palette.invalid-value'
  | 'material-palette.invalid-binding'
  | 'material-palette.incomplete'
  | 'material-palette.unsupported-material';

export class WorldMaterialPaletteError extends Error {
  constructor(readonly code: WorldMaterialPaletteErrorCode, message: string) {
    super(message);
    this.name = 'WorldMaterialPaletteError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_ROLE = /^terrain\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

const DEFAULT_ROLE_BY_MATERIAL = Object.freeze({
  'side-platformer': Object.freeze({
    ground: 'terrain.solid',
    wood: 'terrain.one-way',
    stone: 'terrain.solid',
    water: 'terrain.water',
  }),
  'topdown-farm': Object.freeze({
    meadow: 'terrain.ground',
    farmland: 'terrain.soil',
    'stone-path': 'terrain.path',
    grass: 'terrain.ground',
    water: 'terrain.water',
  }),
  'isometric-action': Object.freeze({
    stone: 'terrain.floor.base',
    arena: 'terrain.floor.variant',
    pillar: 'terrain.wall',
    water: 'terrain.water',
  }),
  'layered-depth-2d': Object.freeze({
    'front-lane': 'terrain.ground',
    'middle-lane': 'terrain.path',
    'back-lane': 'terrain.edge',
    occluder: 'terrain.water',
  }),
} satisfies Readonly<Record<WorldAssetProfile, Readonly<Record<string, string>>>>);

const LEGACY_WATER_ROLE_BY_PROFILE: Readonly<Partial<Record<WorldAssetProfile, string>>> = Object.freeze({
  'side-platformer': 'terrain.solid',
  'isometric-action': 'terrain.floor.variant',
});

/**
 * Returns the canonical runtime terrain role for a layout material.
 *
 * WorldArtVariantMap and the default palette share this lookup so a reviewed
 * terrain variant cannot be selected for an unrelated logical material.
 */
export function worldMaterialRoleForProfile(
  profile: WorldAssetProfile,
  material: string,
): string | undefined {
  const roles: Readonly<Record<string, string>> = DEFAULT_ROLE_BY_MATERIAL[profile];
  return roles[material];
}

function availableWorldMaterialRole(
  profile: WorldAssetProfile,
  material: string,
  availableRoles: readonly string[],
): string | undefined {
  const canonical = worldMaterialRoleForProfile(profile, material);
  if (!canonical || availableRoles.includes(canonical)) return canonical;
  if (material !== 'water') return canonical;

  // Alpha10/11 predate the optional terrain.water role. Preserve those frozen
  // pack contracts with an explicit visual fallback, while Plan 1.1 catalogs
  // select the canonical water asset whenever it is available.
  const legacy = LEGACY_WATER_ROLE_BY_PROFILE[profile];
  return legacy && availableRoles.includes(legacy) ? legacy : canonical;
}

type DataRecord = Record<string, unknown>;

function fail(code: WorldMaterialPaletteErrorCode, message: string): never {
  throw new WorldMaterialPaletteError(code, message);
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
      'material-palette.invalid-shape',
      `${label} must contain exactly: ${canonical.join(', ')}.`,
    );
  }
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 80 || !SAFE_ID.test(value)) {
    fail('material-palette.invalid-value', `${label} must be lowercase kebab-case.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('material-palette.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail('material-palette.invalid-value', 'Palette cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('material-palette.invalid-value', 'Palette contains an unsupported value.');
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

function terrainItems(plan: WorldLayoutPlan): readonly WorldLayoutTerrain[] {
  return plan.terrain_layout.kind === 'bands'
    ? plan.terrain_layout.bands
    : plan.terrain_layout.zones;
}

function distinctLayoutMaterials(plan: WorldLayoutPlan): readonly string[] {
  return Object.freeze(
    [...new Set(terrainItems(plan).map(({ material }) => material))]
      .sort((left, right) => left.localeCompare(right, 'en')),
  );
}

export async function materializeWorldMaterialPalette(
  value: unknown,
  expected?: Readonly<{
    plan: unknown;
    layoutPlanSha256: string;
    availableRoles?: readonly string[];
  }>,
): Promise<WorldMaterialPalette> {
  if (!isRecord(value)) {
    fail('material-palette.invalid-shape', 'World material palette must be an object.');
  }
  exactKeys(
    value,
    ['schema_version', 'document_type', 'palette_id', 'profile', 'layout', 'entries'],
    'World material palette',
  );
  if (
    value.schema_version !== WORLD_MATERIAL_PALETTE_VERSION
    || value.document_type !== 'world-material-palette'
    || !isWorldAssetProfile(value.profile)
  ) {
    fail('material-palette.invalid-value', 'World material palette identity is invalid.');
  }
  if (!isRecord(value.layout)) {
    fail('material-palette.invalid-shape', 'Palette layout binding must be an object.');
  }
  exactKeys(value.layout, ['plan_id', 'sha256'], 'Palette layout binding');
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 64) {
    fail('material-palette.invalid-value', 'Palette requires from 1 to 64 entries.');
  }
  const entries = Object.freeze(value.entries.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('material-palette.invalid-shape', `Palette entry ${index} must be an object.`);
    }
    exactKeys(candidate, ['material', 'role', 'rendering'], `Palette entry ${index}`);
    const material = safeId(candidate.material, `Palette entry ${index} material`);
    if (
      typeof candidate.role !== 'string'
      || candidate.role.length > 120
      || !SAFE_ROLE.test(candidate.role)
      || candidate.rendering !== 'single-cell'
    ) {
      fail('material-palette.invalid-value', `Palette entry ${index} role or rendering is invalid.`);
    }
    return Object.freeze({
      material,
      role: candidate.role,
      rendering: 'single-cell' as const,
    });
  }));
  const materials = entries.map(({ material }) => material);
  if (
    new Set(materials).size !== materials.length
    || materials.some((material, index) => (
      index > 0 && materials[index - 1]!.localeCompare(material, 'en') >= 0
    ))
  ) {
    fail(
      'material-palette.invalid-value',
      'Palette entries must contain unique materials in canonical lexical order.',
    );
  }
  const palette = Object.freeze({
    schema_version: WORLD_MATERIAL_PALETTE_VERSION,
    document_type: 'world-material-palette' as const,
    palette_id: safeId(value.palette_id, 'Palette id'),
    profile: value.profile,
    layout: Object.freeze({
      plan_id: safeId(value.layout.plan_id, 'Palette layout plan id'),
      sha256: digest(value.layout.sha256, 'Palette layout digest'),
    }),
    entries,
  });
  if (expected) {
    const plan = await materializeWorldLayoutPlan(expected.plan);
    const expectedMaterials = distinctLayoutMaterials(plan);
    if (
      palette.profile !== plan.profile
      || palette.layout.plan_id !== plan.plan_id
      || palette.layout.sha256 !== expected.layoutPlanSha256
    ) {
      fail('material-palette.invalid-binding', 'Palette does not bind the exact layout plan.');
    }
    if (
      expectedMaterials.length !== materials.length
      || expectedMaterials.some((material, index) => material !== materials[index])
    ) {
      fail(
        'material-palette.incomplete',
        'Palette must map every distinct layout material exactly once.',
      );
    }
    if (expected.availableRoles) {
      const roles = new Set(expected.availableRoles);
      const missing = entries.find(({ role }) => !roles.has(role));
      if (missing) {
        fail(
          'material-palette.invalid-binding',
          `Palette role is absent from the pack role catalog: ${missing.role}.`,
        );
      }
    }
  }
  return palette;
}

export async function buildDefaultWorldMaterialPalette(
  layout: PreparedWorldLayoutPackEntry,
  availableRoles: readonly string[],
): Promise<WorldMaterialPalette> {
  const materials = distinctLayoutMaterials(layout.plan);
  const entries = materials.map((material) => {
    const role = availableWorldMaterialRole(
      layout.plan.profile,
      material,
      availableRoles,
    );
    if (!role) {
      fail(
        'material-palette.unsupported-material',
        `No canonical role mapping exists for ${layout.plan.profile} material ${material}.`,
      );
    }
    return Object.freeze({ material, role, rendering: 'single-cell' as const });
  });
  return materializeWorldMaterialPalette({
    schema_version: WORLD_MATERIAL_PALETTE_VERSION,
    document_type: 'world-material-palette',
    palette_id: `palette-${layout.plan.plan_id}`,
    profile: layout.plan.profile,
    layout: {
      plan_id: layout.plan.plan_id,
      sha256: layout.binding.sha256,
    },
    entries,
  }, {
    plan: layout.plan,
    layoutPlanSha256: layout.binding.sha256,
    availableRoles,
  });
}

export async function serializeCanonicalWorldMaterialPalette(
  value: unknown,
): Promise<Uint8Array> {
  const palette = await materializeWorldMaterialPalette(value);
  return new TextEncoder().encode(`${canonicalJson(palette)}\n`);
}

export async function prepareWorldMaterialPalettePackEntry(
  layout: PreparedWorldLayoutPackEntry,
  availableRoles: readonly string[],
): Promise<PreparedWorldMaterialPalettePackEntry> {
  const palette = await buildDefaultWorldMaterialPalette(layout, availableRoles);
  const bytes = await serializeCanonicalWorldMaterialPalette(palette);
  return Object.freeze({
    palette,
    bytes,
    binding: Object.freeze({
      schema_version: WORLD_MATERIAL_PALETTE_VERSION,
      document_type: 'world-material-palette' as const,
      palette_id: palette.palette_id,
      layout_plan_sha256: layout.binding.sha256,
      path: WORLD_MATERIAL_PALETTE_PATH,
      sha256: await sha256(bytes),
    }),
  });
}

/** Manifest-only checks; the importer separately verifies and parses exact bytes. */
export function validateWorldMaterialPalettePackBinding(
  binding: WorldMaterialPalettePackBinding | undefined,
  layoutBinding: Readonly<{ sha256: string }> | undefined,
  files: readonly WorldMaterialPalettePackFileRecord[],
): WorldMaterialPalettePackBindingIssue[] {
  if (binding === undefined) return [];
  const issues: WorldMaterialPalettePackBindingIssue[] = [];
  const keys = Object.keys(binding).sort();
  const expectedKeys = [
    'document_type',
    'layout_plan_sha256',
    'palette_id',
    'path',
    'schema_version',
    'sha256',
  ];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    issues.push({
      code: 'material-palette.binding-shape',
      message: 'World material palette binding contains unsupported or missing fields.',
    });
  }
  if (
    binding.schema_version !== WORLD_MATERIAL_PALETTE_VERSION
    || binding.document_type !== 'world-material-palette'
    || binding.path !== WORLD_MATERIAL_PALETTE_PATH
    || !SAFE_ID.test(binding.palette_id)
    || !SHA256.test(binding.layout_plan_sha256)
    || !SHA256.test(binding.sha256)
  ) {
    issues.push({
      code: 'material-palette.binding',
      message: 'World material palette binding is not canonical.',
    });
  }
  if (!layoutBinding || binding.layout_plan_sha256 !== layoutBinding.sha256) {
    issues.push({
      code: 'material-palette.layout-binding',
      message: 'World material palette must bind the manifest WorldLayoutPlan bytes.',
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
      code: 'material-palette.file-record',
      message: 'World material palette binding must match its JSON file integrity record.',
    });
  }
  return issues;
}
