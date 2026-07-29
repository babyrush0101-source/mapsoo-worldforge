import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import { requiredProductionArtRoles } from './production-art-contract';
import {
  fingerprintWorldLayoutConstraints,
  materializeWorldLayoutConstraints,
  type WorldLayoutConstraints,
} from './world-layout-constraints';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from './world-layout-plan';

export const ASSET_REQUIREMENTS_VERSION = '1.0.0' as const;

export const ASSET_REQUIREMENT_CATEGORIES = Object.freeze([
  'terrain',
  'hazard',
  'prop',
  'structure',
  'collectible',
  'background',
  'foreground',
  'lighting',
  'effect',
  'character',
  'preview',
] as const);
export type AssetRequirementCategory = typeof ASSET_REQUIREMENT_CATEGORIES[number];

export const ASSET_REQUIREMENT_STRUCTURAL_AXES = Object.freeze([
  'route-shape',
  'scale',
  'verticality',
  'water',
  'settlement-density',
  'hazard-level',
  'landmark-count',
] as const);
export type AssetRequirementStructuralAxis =
  typeof ASSET_REQUIREMENT_STRUCTURAL_AXES[number];

export interface CanonicalRoleRequirementBinding {
  readonly status: 'canonical-role';
  readonly role: string;
}

export interface UnresolvedRequirementBinding {
  readonly status: 'unresolved';
  readonly reason: 'no-canonical-role';
}

export type AssetRequirementBinding =
  | CanonicalRoleRequirementBinding
  | UnresolvedRequirementBinding;

export interface AssetRequirement {
  readonly requirement_id: string;
  readonly binding: AssetRequirementBinding;
  readonly category: AssetRequirementCategory;
  readonly usage: 'layout-critical' | 'profile-complete';
  readonly variant_count: number;
  readonly structural_axes: readonly AssetRequirementStructuralAxis[];
}

/**
 * Provider-neutral, public-safe visual requirements derived from one confirmed
 * structural layout. It deliberately excludes dialogue, prompts, references,
 * filesystem paths, provider/model choices, and landmark labels.
 */
export interface AssetRequirements {
  readonly schema_version: typeof ASSET_REQUIREMENTS_VERSION;
  readonly document_type: 'asset-requirements';
  readonly requirements_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    constraints_sha256: string;
    layout_plan_sha256: string;
  }>;
  readonly layout: Readonly<{
    route_shape: WorldLayoutConstraints['route_shape'];
    scale: WorldLayoutConstraints['scale'];
    verticality: WorldLayoutConstraints['verticality'];
    water: WorldLayoutConstraints['water'];
    settlement_density: WorldLayoutConstraints['settlement_density'];
    hazard_level: WorldLayoutConstraints['hazard_level'];
    landmark_count: number;
    terrain_layout: WorldLayoutPlan['terrain_layout']['kind'];
    collision_mode: WorldLayoutPlan['collision_intent']['mode'];
    navigation_mode: WorldLayoutPlan['navigation_intent']['mode'];
    width: number;
    height: number;
    region_count: number;
    traversal_node_count: number;
  }>;
  readonly requirements: readonly AssetRequirement[];
}

export type AssetRequirementsErrorCode =
  | 'asset-requirements.invalid-shape'
  | 'asset-requirements.invalid-value'
  | 'asset-requirements.invalid-binding';

export class AssetRequirementsError extends Error {
  constructor(readonly code: AssetRequirementsErrorCode, message: string) {
    super(message);
    this.name = 'AssetRequirementsError';
  }
}

type MutableRecord = Record<string, unknown>;
type AssetRequirementsExpected = Readonly<{
  constraints: unknown;
  plan: unknown;
}>;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REQUIREMENT_ID = /^requirement-[0-9]{3}$/;
const RUNTIME_ROLES = new Set(['world.scene', 'world.collision', 'world.navigation']);

function fail(code: AssetRequirementsErrorCode, message: string): never {
  throw new AssetRequirementsError(code, message);
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
    fail('asset-requirements.invalid-shape', `${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('asset-requirements.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail('asset-requirements.invalid-value', `${label} must be a safe integer of at least ${minimum}.`);
  }
  return value as number;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail('asset-requirements.invalid-value', `${label} is unsupported.`);
  }
  return value as T;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('asset-requirements.invalid-value', 'Asset requirements cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('asset-requirements.invalid-value', 'Asset requirements contain an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digestBuffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function categoryForRole(role: string): AssetRequirementCategory {
  if (role === 'world.preview') return 'preview';
  if (role.startsWith('crop.')) return 'prop';
  if (role.startsWith('near.')) return 'foreground';
  const prefix = role.split('.')[0];
  if ((ASSET_REQUIREMENT_CATEGORIES as readonly string[]).includes(prefix)) {
    return prefix as AssetRequirementCategory;
  }
  fail('asset-requirements.invalid-value', `Canonical role ${role} has no visual requirement category.`);
}

type RequirementWithoutId = Omit<AssetRequirement, 'requirement_id'>;

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

const LANDMARK_ROLE = Object.freeze({
  'side-platformer': 'structure.checkpoint',
  'topdown-farm': 'structure.house',
  'isometric-action': 'structure.checkpoint',
  'layered-depth-2d': 'structure.landmark',
} satisfies Readonly<Record<WorldAssetProfile, string>>);

const WATER_ROLE: Partial<Readonly<Record<WorldAssetProfile, string>>> = Object.freeze({
  'topdown-farm': 'terrain.water',
  'layered-depth-2d': 'terrain.water',
});

const HAZARD_ROLE: Partial<Readonly<Record<WorldAssetProfile, string>>> = Object.freeze({
  'side-platformer': 'hazard.spikes',
  'isometric-action': 'hazard.contact',
});

function ordinal(value: string, values: readonly string[]): number {
  const index = values.indexOf(value);
  if (index < 0) {
    fail('asset-requirements.invalid-value', `Structural value ${value} is unsupported.`);
  }
  return index + 1;
}

function structuralRequirement(
  roles: ReadonlySet<string>,
  axis: AssetRequirementStructuralAxis,
  role: string | undefined,
  category: AssetRequirementCategory,
  variantCount: number,
): RequirementWithoutId {
  const binding: AssetRequirementBinding = role !== undefined && roles.has(role)
    ? Object.freeze({ status: 'canonical-role' as const, role })
    : Object.freeze({ status: 'unresolved' as const, reason: 'no-canonical-role' as const });
  return Object.freeze({
    binding,
    category,
    usage: 'layout-critical' as const,
    variant_count: variantCount,
    structural_axes: Object.freeze([axis]),
  });
}

function structuralRequirements(
  profile: WorldAssetProfile,
  layout: AssetRequirements['layout'],
  roles: ReadonlySet<string>,
): readonly RequirementWithoutId[] {
  const requirements: RequirementWithoutId[] = [
    structuralRequirement(
      roles,
      'route-shape',
      'world.preview',
      'preview',
      ordinal(layout.route_shape, ['direct', 'fork-rejoin', 'loop']),
    ),
    structuralRequirement(
      roles,
      'scale',
      'world.preview',
      'preview',
      ordinal(layout.scale, ['compact', 'standard', 'extended']),
    ),
    structuralRequirement(
      roles,
      'verticality',
      VERTICALITY_ROLE[profile],
      categoryForRole(VERTICALITY_ROLE[profile]),
      ordinal(layout.verticality, ['low', 'medium', 'high']),
    ),
    structuralRequirement(
      roles,
      'settlement-density',
      SETTLEMENT_ROLE[profile],
      categoryForRole(SETTLEMENT_ROLE[profile]),
      ordinal(layout.settlement_density, ['sparse', 'settled', 'dense']),
    ),
    structuralRequirement(
      roles,
      'landmark-count',
      LANDMARK_ROLE[profile],
      categoryForRole(LANDMARK_ROLE[profile]),
      layout.landmark_count,
    ),
  ];
  if (layout.water !== 'none') {
    const role = WATER_ROLE[profile];
    requirements.push(structuralRequirement(
      roles,
      'water',
      role,
      role === undefined ? 'terrain' : categoryForRole(role),
      ordinal(layout.water, ['crossing', 'basin']),
    ));
  }
  if (layout.hazard_level !== 'calm') {
    const role = HAZARD_ROLE[profile];
    requirements.push(structuralRequirement(
      roles,
      'hazard-level',
      role,
      role === undefined ? 'hazard' : categoryForRole(role),
      ordinal(layout.hazard_level, ['guarded', 'dangerous']),
    ));
  }
  return Object.freeze(requirements);
}

function canonicalRequirements(
  profile: WorldAssetProfile,
  layout: AssetRequirements['layout'],
): readonly AssetRequirement[] {
  const canonicalRoles = requiredProductionArtRoles(profile);
  if (canonicalRoles.some((role) => RUNTIME_ROLES.has(role))) {
    fail('asset-requirements.invalid-value', 'Runtime world roles cannot become visual requirements.');
  }
  const roles = new Set(canonicalRoles);
  const baseline: RequirementWithoutId[] = canonicalRoles.map((role) => {
    const category = categoryForRole(role);
    return Object.freeze({
      binding: Object.freeze({ status: 'canonical-role' as const, role }),
      category,
      usage: 'profile-complete' as const,
      variant_count: 1,
      structural_axes: Object.freeze([]),
    });
  });
  return Object.freeze([
    ...baseline,
    ...structuralRequirements(profile, layout, roles),
  ].map((requirement, index) => Object.freeze({
    requirement_id: `requirement-${String(index + 1).padStart(3, '0')}`,
    ...requirement,
  })));
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function validateRequirements(
  value: unknown,
  profile: WorldAssetProfile,
  layout: AssetRequirements['layout'],
): readonly AssetRequirement[] {
  if (!Array.isArray(value)) {
    fail('asset-requirements.invalid-shape', 'Asset requirements inventory must be an array.');
  }
  const expected = canonicalRequirements(profile, layout);
  if (value.length !== expected.length) {
    fail('asset-requirements.invalid-value', 'Asset requirements must cover every canonical visual role once.');
  }
  value.forEach((item, index) => {
    if (!isRecord(item)) {
      fail('asset-requirements.invalid-shape', `Asset requirement ${index} must be an object.`);
    }
    exactKeys(item, [
      'requirement_id',
      'binding',
      'category',
      'usage',
      'variant_count',
      'structural_axes',
    ], `Asset requirement ${index}`);
    if (!SAFE_REQUIREMENT_ID.test(String(item.requirement_id))) {
      fail('asset-requirements.invalid-value', `Asset requirement ${index} id is invalid.`);
    }
    if (!isRecord(item.binding)) {
      fail('asset-requirements.invalid-shape', `Asset requirement ${index} binding must be an object.`);
    }
    if (item.binding.status === 'canonical-role') {
      exactKeys(item.binding, ['status', 'role'], `Asset requirement ${index} binding`);
    } else if (item.binding.status === 'unresolved') {
      exactKeys(item.binding, ['status', 'reason'], `Asset requirement ${index} binding`);
    } else {
      fail('asset-requirements.invalid-value', `Asset requirement ${index} binding is unsupported.`);
    }
    enumValue(item.category, ASSET_REQUIREMENT_CATEGORIES, `Asset requirement ${index} category`);
    enumValue(
      item.usage,
      ['layout-critical', 'profile-complete'] as const,
      `Asset requirement ${index} usage`,
    );
    integer(item.variant_count, `Asset requirement ${index} variant count`);
    if (!Array.isArray(item.structural_axes)) {
      fail('asset-requirements.invalid-shape', `Asset requirement ${index} axes must be an array.`);
    }
    item.structural_axes.forEach((axis) => enumValue(
      axis,
      ASSET_REQUIREMENT_STRUCTURAL_AXES,
      `Asset requirement ${index} structural axis`,
    ));
  });
  if (!sameCanonicalValue(value, expected)) {
    fail(
      'asset-requirements.invalid-binding',
      'Asset requirement entries do not match the canonical profile and layout semantics.',
    );
  }
  return expected;
}

function validateLayout(value: unknown): AssetRequirements['layout'] {
  if (!isRecord(value)) {
    fail('asset-requirements.invalid-shape', 'Asset requirements layout must be an object.');
  }
  exactKeys(value, [
    'route_shape',
    'scale',
    'verticality',
    'water',
    'settlement_density',
    'hazard_level',
    'landmark_count',
    'terrain_layout',
    'collision_mode',
    'navigation_mode',
    'width',
    'height',
    'region_count',
    'traversal_node_count',
  ], 'Asset requirements layout');
  return Object.freeze({
    route_shape: enumValue(value.route_shape, ['direct', 'fork-rejoin', 'loop'] as const, 'Route shape'),
    scale: enumValue(value.scale, ['compact', 'standard', 'extended'] as const, 'Scale'),
    verticality: enumValue(value.verticality, ['low', 'medium', 'high'] as const, 'Verticality'),
    water: enumValue(value.water, ['none', 'crossing', 'basin'] as const, 'Water shape'),
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
    landmark_count: integer(value.landmark_count, 'Landmark count', 2),
    terrain_layout: enumValue(value.terrain_layout, ['bands', 'zones'] as const, 'Terrain layout'),
    collision_mode: enumValue(value.collision_mode, [
      'side-solids',
      'topdown-obstacles',
      'isometric-footprints',
      'depth-lane-blockers',
    ] as const, 'Collision mode'),
    navigation_mode: enumValue(value.navigation_mode, [
      'platform-links',
      'orthogonal-grid',
      'diamond-grid',
      'depth-lanes',
    ] as const, 'Navigation mode'),
    width: integer(value.width, 'Layout width'),
    height: integer(value.height, 'Layout height'),
    region_count: integer(value.region_count, 'Layout region count'),
    traversal_node_count: integer(value.traversal_node_count, 'Traversal node count'),
  });
}

function layoutSummary(
  constraints: WorldLayoutConstraints,
  plan: WorldLayoutPlan,
): AssetRequirements['layout'] {
  return Object.freeze({
    route_shape: constraints.route_shape,
    scale: constraints.scale,
    verticality: constraints.verticality,
    water: constraints.water,
    settlement_density: constraints.settlement_density,
    hazard_level: constraints.hazard_level,
    landmark_count: constraints.landmark_labels.length,
    terrain_layout: plan.terrain_layout.kind,
    collision_mode: plan.collision_intent.mode,
    navigation_mode: plan.navigation_intent.mode,
    width: plan.bounds.width,
    height: plan.bounds.height,
    region_count: plan.regions.length,
    traversal_node_count: plan.traversal.nodes.length,
  });
}

async function expectedFromSources(
  expected: AssetRequirementsExpected,
): Promise<Readonly<{
  constraints: WorldLayoutConstraints;
  plan: WorldLayoutPlan;
  source: AssetRequirements['source'];
  layout: AssetRequirements['layout'];
}>> {
  const constraints = await materializeWorldLayoutConstraints(expected.constraints);
  const plan = await materializeWorldLayoutPlan(expected.plan);
  if (
    constraints.profile !== plan.profile
    || constraints.source.intake_id !== plan.source.intake_id
    || constraints.source.session_revision !== plan.source.session_revision
    || constraints.source.map_layout_checkpoint_sha256
      !== plan.source.map_layout_checkpoint_sha256
    || constraints.landmark_labels.length !== plan.landmarks.length
  ) {
    fail(
      'asset-requirements.invalid-binding',
      'Layout constraints and plan do not describe the same confirmed layout.',
    );
  }
  return Object.freeze({
    constraints,
    plan,
    source: Object.freeze({
      constraints_sha256: await fingerprintWorldLayoutConstraints(constraints),
      layout_plan_sha256: await fingerprintWorldLayoutPlan(plan),
    }),
    layout: layoutSummary(constraints, plan),
  });
}

export async function materializeAssetRequirements(
  value: unknown,
  expected?: AssetRequirementsExpected,
): Promise<AssetRequirements> {
  if (!isRecord(value)) {
    fail('asset-requirements.invalid-shape', 'Asset requirements must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'requirements_id',
    'profile',
    'source',
    'layout',
    'requirements',
  ], 'Asset requirements');
  if (
    value.schema_version !== ASSET_REQUIREMENTS_VERSION
    || value.document_type !== 'asset-requirements'
  ) {
    fail('asset-requirements.invalid-value', 'Asset requirements must be a 1.0.0 document.');
  }
  if (!isWorldAssetProfile(value.profile)) {
    fail('asset-requirements.invalid-value', 'Asset requirements profile is unsupported.');
  }
  if (
    typeof value.requirements_id !== 'string'
    || !/^asset-requirements-[a-f0-9]{16}$/.test(value.requirements_id)
  ) {
    fail('asset-requirements.invalid-value', 'Asset requirements id is invalid.');
  }
  if (!isRecord(value.source)) {
    fail('asset-requirements.invalid-shape', 'Asset requirements source must be an object.');
  }
  exactKeys(
    value.source,
    ['constraints_sha256', 'layout_plan_sha256'],
    'Asset requirements source',
  );
  const source = Object.freeze({
    constraints_sha256: digest(value.source.constraints_sha256, 'Constraints digest'),
    layout_plan_sha256: digest(value.source.layout_plan_sha256, 'Layout plan digest'),
  });
  const layout = validateLayout(value.layout);
  const requirements = validateRequirements(value.requirements, value.profile, layout);
  const expectedId = `asset-requirements-${(await sha256({
    profile: value.profile,
    source,
    layout,
    requirements,
  })).slice(0, 16)}`;
  if (value.requirements_id !== expectedId) {
    fail('asset-requirements.invalid-binding', 'Asset requirements id does not match its contents.');
  }

  if (expected !== undefined) {
    const derived = await expectedFromSources(expected);
    if (
      value.profile !== derived.plan.profile
      || !sameCanonicalValue(source, derived.source)
      || !sameCanonicalValue(layout, derived.layout)
    ) {
      fail(
        'asset-requirements.invalid-binding',
        'Asset requirements do not match their layout constraints and plan.',
      );
    }
  }

  return Object.freeze({
    schema_version: ASSET_REQUIREMENTS_VERSION,
    document_type: 'asset-requirements',
    requirements_id: expectedId,
    profile: value.profile,
    source,
    layout,
    requirements,
  });
}

export async function buildAssetRequirements(
  constraintsValue: unknown,
  planValue: unknown,
): Promise<AssetRequirements> {
  const derived = await expectedFromSources({
    constraints: constraintsValue,
    plan: planValue,
  });
  const requirements = canonicalRequirements(derived.plan.profile, derived.layout);
  const requirementsId = `asset-requirements-${(await sha256({
    profile: derived.plan.profile,
    source: derived.source,
    layout: derived.layout,
    requirements,
  })).slice(0, 16)}`;
  return materializeAssetRequirements({
    schema_version: ASSET_REQUIREMENTS_VERSION,
    document_type: 'asset-requirements',
    requirements_id: requirementsId,
    profile: derived.plan.profile,
    source: derived.source,
    layout: derived.layout,
    requirements,
  }, {
    constraints: derived.constraints,
    plan: derived.plan,
  });
}

export async function fingerprintAssetRequirements(value: unknown): Promise<string> {
  return sha256(await materializeAssetRequirements(value));
}

export async function serializeCanonicalAssetRequirements(value: unknown): Promise<Uint8Array> {
  const requirements = await materializeAssetRequirements(value);
  return new TextEncoder().encode(`${canonicalJson(requirements)}\n`);
}
