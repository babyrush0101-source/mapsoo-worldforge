import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  buildAssetRequirements,
  materializeAssetRequirements,
  type AssetRequirementCategory,
  type AssetRequirementStructuralAxis,
  type AssetRequirements,
} from './asset-requirements';
import { requiredProductionArtRoles } from './production-art-contract';

export const ASSET_REQUIREMENTS_V1_1_VERSION = '1.1.0' as const;

export type AssetRequirementStructuralValue = Readonly<{
  axis: AssetRequirementStructuralAxis;
  value: string | number;
}>;

export type AssetRequirementVariantV1_1 = Readonly<{
  variant_id: string;
  identity_kind: 'canonical-role' | 'layout-landmark';
  layout_ref?: Readonly<{
    kind: 'landmark';
    id: string;
  }>;
}>;

export interface AssetRequirementV1_1 {
  readonly requirement_id: string;
  readonly binding: Readonly<{
    status: 'canonical-role';
    role: string;
  }>;
  readonly category: AssetRequirementCategory;
  readonly usage: 'layout-critical' | 'profile-complete';
  readonly structural_values: readonly AssetRequirementStructuralValue[];
  readonly variants: readonly AssetRequirementVariantV1_1[];
  readonly required_output: Readonly<{
    unit: 'role-variant';
    count: number;
  }>;
}

export interface AssetRequirementsV1_1 {
  readonly schema_version: typeof ASSET_REQUIREMENTS_V1_1_VERSION;
  readonly document_type: 'asset-requirements';
  readonly requirements_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: AssetRequirements['source'];
  readonly layout: AssetRequirements['layout'];
  readonly requirements: readonly AssetRequirementV1_1[];
}

export type AssetRequirementsV1_1ErrorCode =
  | 'asset-requirements-1.1.invalid-shape'
  | 'asset-requirements-1.1.invalid-value'
  | 'asset-requirements-1.1.invalid-binding';

export class AssetRequirementsV1_1Error extends Error {
  constructor(readonly code: AssetRequirementsV1_1ErrorCode, message: string) {
    super(message);
    this.name = 'AssetRequirementsV1_1Error';
  }
}

const EXTENSION_ROLES = Object.freeze({
  'side-platformer': Object.freeze(['terrain.water', 'structure.landmark']),
  'topdown-farm': Object.freeze(['hazard.contact', 'structure.landmark']),
  'isometric-action': Object.freeze(['terrain.water', 'structure.landmark']),
  'layered-depth-2d': Object.freeze(['hazard.contact']),
} satisfies Readonly<Record<WorldAssetProfile, readonly string[]>>);

const VERTICALITY_ROLE = Object.freeze({
  'side-platformer': 'terrain.slope-up',
  'topdown-farm': 'world.preview',
  'isometric-action': 'terrain.elevation.top',
  'layered-depth-2d': 'terrain.stairs',
} satisfies Readonly<Record<WorldAssetProfile, string>>);

const SETTLEMENT_ROLE = Object.freeze({
  'side-platformer': 'prop.lamp',
  'topdown-farm': 'structure.house',
  'isometric-action': 'prop.decoration',
  'layered-depth-2d': 'structure.landmark',
} satisfies Readonly<Record<WorldAssetProfile, string>>);

const WATER_ROLE = Object.freeze({
  'side-platformer': 'terrain.water',
  'topdown-farm': 'terrain.water',
  'isometric-action': 'terrain.water',
  'layered-depth-2d': 'terrain.water',
} satisfies Readonly<Record<WorldAssetProfile, string>>);

const HAZARD_ROLE = Object.freeze({
  'side-platformer': 'hazard.spikes',
  'topdown-farm': 'hazard.contact',
  'isometric-action': 'hazard.contact',
  'layered-depth-2d': 'hazard.contact',
} satisfies Readonly<Record<WorldAssetProfile, string>>);

const SAFE_REQUIREMENT_ID = /^requirement-[0-9]{3}$/;
const SAFE_VARIANT_ID = /^(?:canonical|landmark-[0-9]{3})$/;
const SAFE_ROLE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SHA256 = /^[a-f0-9]{64}$/;

type MutableRecord = Record<string, unknown>;

function fail(code: AssetRequirementsV1_1ErrorCode, message: string): never {
  throw new AssetRequirementsV1_1Error(code, message);
}

function isRecord(value: unknown): value is MutableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: MutableRecord, expectedKeys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(
      'asset-requirements-1.1.invalid-shape',
      `${label} must contain exactly: ${expected.join(', ')}.`,
    );
  }
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail('asset-requirements-1.1.invalid-value', `${label} is unsupported.`);
  }
  return value as T;
}

function integer(value: unknown, label: string, minimum = 1, maximum?: number): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (maximum !== undefined && (value as number) > maximum)
  ) {
    fail('asset-requirements-1.1.invalid-value', `${label} is invalid.`);
  }
  return value as number;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('asset-requirements-1.1.invalid-value', 'Document contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('asset-requirements-1.1.invalid-value', 'Document contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function categoryForRole(role: string): AssetRequirementCategory {
  if (role === 'world.preview') return 'preview';
  if (role.startsWith('crop.')) return 'prop';
  if (role.startsWith('near.')) return 'foreground';
  const category = role.split('.')[0];
  if ([
    'terrain', 'hazard', 'prop', 'structure', 'collectible', 'background',
    'foreground', 'lighting', 'effect', 'character',
  ].includes(category)) {
    return category as AssetRequirementCategory;
  }
  fail('asset-requirements-1.1.invalid-value', `Role ${role} has no visual category.`);
}

function structuralRole(
  profile: WorldAssetProfile,
  axis: AssetRequirementStructuralAxis,
): string {
  if (axis === 'route-shape' || axis === 'scale') return 'world.preview';
  if (axis === 'verticality') return VERTICALITY_ROLE[profile];
  if (axis === 'settlement-density') return SETTLEMENT_ROLE[profile];
  if (axis === 'water') return WATER_ROLE[profile];
  if (axis === 'hazard-level') return HAZARD_ROLE[profile];
  return 'structure.landmark';
}

function structuralValue(
  layout: AssetRequirements['layout'],
  axis: AssetRequirementStructuralAxis,
): string | number {
  if (axis === 'route-shape') return layout.route_shape;
  if (axis === 'scale') return layout.scale;
  if (axis === 'verticality') return layout.verticality;
  if (axis === 'water') return layout.water;
  if (axis === 'settlement-density') return layout.settlement_density;
  if (axis === 'hazard-level') return layout.hazard_level;
  return layout.landmark_count;
}

function demandedRoles(base: AssetRequirements): readonly string[] {
  const roles = [...requiredProductionArtRoles(base.profile)];
  const extensions = new Set(EXTENSION_ROLES[base.profile]);
  const add = (role: string): void => {
    if (!roles.includes(role)) {
      if (!extensions.has(role)) {
        fail(
          'asset-requirements-1.1.invalid-binding',
          `Role ${role} is not supported by profile ${base.profile}.`,
        );
      }
      roles.push(role);
    }
  };
  add('structure.landmark');
  if (base.layout.water !== 'none') add(WATER_ROLE[base.profile]);
  if (base.layout.hazard_level !== 'calm') add(HAZARD_ROLE[base.profile]);
  return Object.freeze(roles);
}

function canonicalRequirements(base: AssetRequirements): readonly AssetRequirementV1_1[] {
  const baseline = new Set(requiredProductionArtRoles(base.profile));
  const roles = demandedRoles(base);
  const axes = Object.freeze([
    'route-shape',
    'scale',
    'verticality',
    ...(base.layout.water === 'none' ? [] : ['water']),
    'settlement-density',
    ...(base.layout.hazard_level === 'calm' ? [] : ['hazard-level']),
    'landmark-count',
  ] as AssetRequirementStructuralAxis[]);

  return Object.freeze(roles.map((role, index) => {
    const structuralValues = axes
      .filter((axis) => structuralRole(base.profile, axis) === role)
      .map((axis) => Object.freeze({
        axis,
        value: structuralValue(base.layout, axis),
      }));
    const variants: readonly AssetRequirementVariantV1_1[] = role === 'structure.landmark'
      ? Object.freeze(Array.from({ length: base.layout.landmark_count }, (_, landmarkIndex) => {
        const id = `landmark-${String(landmarkIndex + 1).padStart(3, '0')}`;
        return Object.freeze({
          variant_id: id,
          identity_kind: 'layout-landmark' as const,
          layout_ref: Object.freeze({ kind: 'landmark' as const, id }),
        });
      }))
      : Object.freeze([Object.freeze({
        variant_id: 'canonical',
        identity_kind: 'canonical-role' as const,
      })]);
    return Object.freeze({
      requirement_id: `requirement-${String(index + 1).padStart(3, '0')}`,
      binding: Object.freeze({ status: 'canonical-role' as const, role }),
      category: categoryForRole(role),
      usage: baseline.has(role) ? 'profile-complete' as const : 'layout-critical' as const,
      structural_values: Object.freeze(structuralValues),
      variants,
      required_output: Object.freeze({
        unit: 'role-variant' as const,
        count: variants.length,
      }),
    });
  }));
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function validateLayout(value: unknown): AssetRequirements['layout'] {
  if (!isRecord(value)) {
    fail('asset-requirements-1.1.invalid-shape', 'Asset requirements layout must be an object.');
  }
  exactKeys(value, [
    'route_shape', 'scale', 'verticality', 'water', 'settlement_density',
    'hazard_level', 'landmark_count', 'terrain_layout', 'collision_mode',
    'navigation_mode', 'width', 'height', 'region_count', 'traversal_node_count',
  ], 'Asset requirements layout');
  return Object.freeze({
    route_shape: enumValue(value.route_shape, ['direct', 'fork-rejoin', 'loop'] as const, 'Route shape'),
    scale: enumValue(value.scale, ['compact', 'standard', 'extended'] as const, 'Scale'),
    verticality: enumValue(value.verticality, ['low', 'medium', 'high'] as const, 'Verticality'),
    water: enumValue(value.water, ['none', 'crossing', 'basin'] as const, 'Water'),
    settlement_density: enumValue(
      value.settlement_density,
      ['sparse', 'settled', 'dense'] as const,
      'Settlement density',
    ),
    hazard_level: enumValue(
      value.hazard_level,
      ['calm', 'guarded', 'dangerous'] as const,
      'Hazard level',
    ),
    landmark_count: integer(value.landmark_count, 'Landmark count', 2, 4),
    terrain_layout: enumValue(value.terrain_layout, ['bands', 'zones'] as const, 'Terrain layout'),
    collision_mode: enumValue(value.collision_mode, [
      'side-solids', 'topdown-obstacles', 'isometric-footprints', 'depth-lane-blockers',
    ] as const, 'Collision mode'),
    navigation_mode: enumValue(value.navigation_mode, [
      'platform-links', 'orthogonal-grid', 'diamond-grid', 'depth-lanes',
    ] as const, 'Navigation mode'),
    width: integer(value.width, 'Layout width'),
    height: integer(value.height, 'Layout height'),
    region_count: integer(value.region_count, 'Region count'),
    traversal_node_count: integer(value.traversal_node_count, 'Traversal node count'),
  });
}

async function fromBase(baseValue: unknown): Promise<AssetRequirementsV1_1> {
  const base = await materializeAssetRequirements(baseValue);
  const requirements = canonicalRequirements(base);
  const identity = {
    profile: base.profile,
    source: base.source,
    layout: base.layout,
    requirements,
  };
  const requirementsId = `asset-requirements-${(await sha256(identity)).slice(0, 16)}`;
  return Object.freeze({
    schema_version: ASSET_REQUIREMENTS_V1_1_VERSION,
    document_type: 'asset-requirements',
    requirements_id: requirementsId,
    profile: base.profile,
    source: base.source,
    layout: base.layout,
    requirements,
  });
}

export async function buildAssetRequirementsV1_1(
  constraintsValue: unknown,
  planValue: unknown,
): Promise<AssetRequirementsV1_1> {
  return fromBase(await buildAssetRequirements(constraintsValue, planValue));
}

export async function materializeAssetRequirementsV1_1(
  value: unknown,
  expected?: Readonly<{ constraints: unknown; plan: unknown }>,
): Promise<AssetRequirementsV1_1> {
  if (!isRecord(value)) {
    fail('asset-requirements-1.1.invalid-shape', 'Asset requirements must be an object.');
  }
  exactKeys(value, [
    'schema_version', 'document_type', 'requirements_id', 'profile',
    'source', 'layout', 'requirements',
  ], 'Asset requirements');
  if (
    value.schema_version !== ASSET_REQUIREMENTS_V1_1_VERSION
    || value.document_type !== 'asset-requirements'
  ) {
    fail('asset-requirements-1.1.invalid-value', 'Asset requirements must be a 1.1.0 document.');
  }
  if (!isWorldAssetProfile(value.profile)) {
    fail('asset-requirements-1.1.invalid-value', 'Asset requirements profile is unsupported.');
  }
  if (
    !isRecord(value.source)
    || !SHA256.test(String(value.source.constraints_sha256))
    || !SHA256.test(String(value.source.layout_plan_sha256))
  ) {
    fail('asset-requirements-1.1.invalid-value', 'Asset requirements source is invalid.');
  }
  exactKeys(value.source, ['constraints_sha256', 'layout_plan_sha256'], 'Asset requirements source');
  const source = Object.freeze({
    constraints_sha256: String(value.source.constraints_sha256),
    layout_plan_sha256: String(value.source.layout_plan_sha256),
  });
  const layout = validateLayout(value.layout);
  if (!Array.isArray(value.requirements)) {
    fail('asset-requirements-1.1.invalid-shape', 'Asset requirements inventory must be an array.');
  }
  value.requirements.forEach((item, index) => {
    if (!isRecord(item)) {
      fail('asset-requirements-1.1.invalid-shape', `Requirement ${index} must be an object.`);
    }
    exactKeys(item, [
      'requirement_id', 'binding', 'category', 'usage',
      'structural_values', 'variants', 'required_output',
    ], `Requirement ${index}`);
    if (!SAFE_REQUIREMENT_ID.test(String(item.requirement_id)) || !isRecord(item.binding)) {
      fail('asset-requirements-1.1.invalid-value', `Requirement ${index} identity is invalid.`);
    }
    exactKeys(item.binding, ['status', 'role'], `Requirement ${index} binding`);
    if (
      item.binding.status !== 'canonical-role'
      || !SAFE_ROLE.test(String(item.binding.role))
      || !Array.isArray(item.structural_values)
      || !Array.isArray(item.variants)
      || !isRecord(item.required_output)
    ) {
      fail('asset-requirements-1.1.invalid-value', `Requirement ${index} is invalid.`);
    }
    exactKeys(item.required_output, ['unit', 'count'], `Requirement ${index} output`);
    if (
      item.required_output.unit !== 'role-variant'
      || item.required_output.count !== item.variants.length
      || item.variants.length < 1
    ) {
      fail('asset-requirements-1.1.invalid-binding', `Requirement ${index} output count is invalid.`);
    }
    item.structural_values.forEach((entry, structuralIndex) => {
      if (!isRecord(entry)) {
        fail('asset-requirements-1.1.invalid-shape', 'Structural value must be an object.');
      }
      exactKeys(entry, ['axis', 'value'], `Requirement ${index} structural value ${structuralIndex}`);
    });
    item.variants.forEach((variant, variantIndex) => {
      if (!isRecord(variant)) {
        fail('asset-requirements-1.1.invalid-shape', 'Variant must be an object.');
      }
      const landmark = variant.identity_kind === 'layout-landmark';
      exactKeys(
        variant,
        landmark ? ['variant_id', 'identity_kind', 'layout_ref'] : ['variant_id', 'identity_kind'],
        `Requirement ${index} variant ${variantIndex}`,
      );
      if (!SAFE_VARIANT_ID.test(String(variant.variant_id))) {
        fail('asset-requirements-1.1.invalid-value', 'Variant id is invalid.');
      }
      if (landmark) {
        if (!isRecord(variant.layout_ref)) {
          fail('asset-requirements-1.1.invalid-shape', 'Landmark variant requires a layout ref.');
        }
        exactKeys(variant.layout_ref, ['kind', 'id'], 'Landmark layout ref');
        if (
          variant.layout_ref.kind !== 'landmark'
          || variant.layout_ref.id !== variant.variant_id
        ) {
          fail('asset-requirements-1.1.invalid-binding', 'Landmark variant binding is invalid.');
        }
      } else if (variant.identity_kind !== 'canonical-role') {
        fail('asset-requirements-1.1.invalid-value', 'Variant identity kind is invalid.');
      }
    });
  });

  let expectedValue: AssetRequirementsV1_1;
  if (expected !== undefined) {
    expectedValue = await buildAssetRequirementsV1_1(expected.constraints, expected.plan);
  } else {
    const base = {
      profile: value.profile,
      source,
      layout,
    } as AssetRequirements;
    const requirements = canonicalRequirements(base);
    const identity = {
      profile: value.profile,
      source,
      layout,
      requirements,
    };
    const expectedId = `asset-requirements-${(await sha256(identity)).slice(0, 16)}`;
    expectedValue = Object.freeze({
      schema_version: ASSET_REQUIREMENTS_V1_1_VERSION,
      document_type: 'asset-requirements',
      requirements_id: expectedId,
      profile: value.profile,
      source,
      layout,
      requirements,
    });
  }
  if (!sameCanonicalValue(value, expectedValue)) {
    fail(
      'asset-requirements-1.1.invalid-binding',
      'Asset requirements do not match their confirmed layout sources.',
    );
  }
  return expectedValue;
}

export async function fingerprintAssetRequirementsV1_1(value: unknown): Promise<string> {
  return sha256(await materializeAssetRequirementsV1_1(value));
}

export async function serializeCanonicalAssetRequirementsV1_1(
  value: unknown,
): Promise<Uint8Array> {
  const requirements = await materializeAssetRequirementsV1_1(value);
  return new TextEncoder().encode(`${canonicalJson(requirements)}\n`);
}

export function supportedProductionArtRolesV1_1(
  profile: WorldAssetProfile,
): readonly string[] {
  return Object.freeze([
    ...requiredProductionArtRoles(profile),
    ...EXTENSION_ROLES[profile].filter((role) => !requiredProductionArtRoles(profile).includes(role)),
  ]);
}
