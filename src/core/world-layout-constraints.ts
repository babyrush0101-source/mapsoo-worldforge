import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  materializeConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';

export const WORLD_LAYOUT_CONSTRAINTS_VERSION = '1.0.0' as const;

export type WorldLayoutRouteShape = 'direct' | 'fork-rejoin' | 'loop';
export type WorldLayoutScale = 'compact' | 'standard' | 'extended';
export type WorldLayoutVerticality = 'low' | 'medium' | 'high';
export type WorldLayoutWaterShape = 'none' | 'crossing' | 'basin';
export type WorldLayoutSettlementDensity = 'sparse' | 'settled' | 'dense';
export type WorldLayoutHazardLevel = 'calm' | 'guarded' | 'dangerous';
export type WorldLayoutConstraintOrigin = 'confirmed-intent' | 'compatibility-derived';

export interface WorldLayoutConstraintIntent {
  readonly route_shape: WorldLayoutRouteShape;
  readonly scale: WorldLayoutScale;
  readonly verticality: WorldLayoutVerticality;
  readonly water: WorldLayoutWaterShape;
  readonly settlement_density: WorldLayoutSettlementDensity;
  readonly hazard_level: WorldLayoutHazardLevel;
  readonly landmark_labels: readonly string[];
}

/**
 * Provider-neutral structural input for the deterministic layout solvers.
 *
 * Raw dialogue is deliberately excluded. Only coarse, reviewable constraints
 * and explicitly confirmed public landmark labels may cross this boundary.
 */
export interface WorldLayoutConstraints {
  readonly schema_version: typeof WORLD_LAYOUT_CONSTRAINTS_VERSION;
  readonly document_type: 'world-layout-constraints';
  readonly origin: WorldLayoutConstraintOrigin;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    intake_id: string;
    session_revision: number;
    map_layout_checkpoint_sha256: string;
    layout_facts_sha256: string;
  }>;
  readonly route_shape: WorldLayoutRouteShape;
  readonly scale: WorldLayoutScale;
  readonly verticality: WorldLayoutVerticality;
  readonly water: WorldLayoutWaterShape;
  readonly settlement_density: WorldLayoutSettlementDensity;
  readonly hazard_level: WorldLayoutHazardLevel;
  readonly landmark_labels: readonly string[];
}

export type WorldLayoutConstraintsErrorCode =
  | 'layout-constraints.invalid-shape'
  | 'layout-constraints.invalid-value'
  | 'layout-constraints.invalid-binding';

export class WorldLayoutConstraintsError extends Error {
  constructor(
    readonly code: WorldLayoutConstraintsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorldLayoutConstraintsError';
  }
}

type MutableRecord = Record<string, unknown>;

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const ROUTE_SHAPES = Object.freeze(['direct', 'fork-rejoin', 'loop'] as const);
const SCALES = Object.freeze(['compact', 'standard', 'extended'] as const);
const VERTICALITIES = Object.freeze(['low', 'medium', 'high'] as const);
const WATER_SHAPES = Object.freeze(['none', 'crossing', 'basin'] as const);
const SETTLEMENT_DENSITIES = Object.freeze(['sparse', 'settled', 'dense'] as const);
const HAZARD_LEVELS = Object.freeze(['calm', 'guarded', 'dangerous'] as const);
const ORIGINS = Object.freeze(['confirmed-intent', 'compatibility-derived'] as const);

function fail(code: WorldLayoutConstraintsErrorCode, message: string): never {
  throw new WorldLayoutConstraintsError(code, message);
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
    fail('layout-constraints.invalid-shape', `${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function safeId(value: unknown, label: string, maximum = 80): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || !SAFE_ID.test(value)
  ) {
    fail('layout-constraints.invalid-value', `${label} must be lowercase kebab-case.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('layout-constraints.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail('layout-constraints.invalid-value', `${label} must be a safe integer of at least ${minimum}.`);
  }
  return value as number;
}

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || Array.from(value).length > maximum
    || CONTROL_CHARACTER.test(value)
  ) {
    fail('layout-constraints.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail('layout-constraints.invalid-value', `${label} is unsupported.`);
  }
  return value as T;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('layout-constraints.invalid-value', 'Layout constraints cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('layout-constraints.invalid-value', 'Layout constraints contain an unsupported value.');
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

function layoutFacts(facts: ConfirmedWorldFacts): unknown {
  return {
    premise: facts.premise,
    terrain: facts.terrain,
    geography: facts.geography,
    culture: facts.culture,
    traversal: facts.traversal,
    landmarks: facts.landmarks,
  };
}

function normalized(...values: readonly string[]): string {
  return values.join(' ').normalize('NFKC').toLocaleLowerCase('en-US');
}

function includesAny(value: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => value.includes(fragment));
}

function confirmedLandmarkLabels(facts: ConfirmedWorldFacts): readonly string[] {
  const labels = facts.landmarks
    .split(/[,;，；、|\n]+/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((value) => value.slice(0, 120).trim());
  if (labels.length === 0) labels.push('Confirmed landmark');
  if (labels.length === 1) {
    const fallback = facts.geography.slice(0, 120).trim();
    labels.push(fallback && fallback !== labels[0] ? fallback : 'Secondary landmark');
  }
  return Object.freeze(labels);
}

function inferRouteShape(facts: ConfirmedWorldFacts): WorldLayoutRouteShape {
  const value = normalized(facts.geography, facts.traversal);
  if (includesAny(value, [
    'loop',
    'circle back',
    'return route',
    'returns to',
    '环线',
    '环路',
    '循环路线',
    '绕回',
    '回到起点',
  ])) return 'loop';
  if (includesAny(value, [
    'branch',
    'fork',
    'split route',
    'two routes',
    'alternate route',
    '岔路',
    '分支',
    '支线',
    '分叉',
    '两条路线',
    '多条路线',
  ])) return 'fork-rejoin';
  return 'direct';
}

function inferScale(facts: ConfirmedWorldFacts, landmarkCount: number): WorldLayoutScale {
  const value = normalized(facts.premise, facts.geography, facts.traversal);
  if (
    landmarkCount >= 4
    || includesAny(value, ['expansive', 'large world', 'long route', 'vast', '广阔', '大型', '长路线'])
  ) return 'extended';
  if (includesAny(value, ['compact', 'small world', 'short route', 'intimate', '紧凑', '小型', '短路线'])) {
    return 'compact';
  }
  return 'standard';
}

function inferVerticality(facts: ConfirmedWorldFacts): WorldLayoutVerticality {
  const value = normalized(facts.terrain, facts.geography, facts.traversal);
  if (includesAny(value, [
    'mountain',
    'cliff',
    'vertical',
    'tower',
    'high ridge',
    'multi-level',
    'multilevel',
    'elevated',
    '悬崖',
    '山地',
    '高塔',
    '高低差',
    '多层',
    '垂直',
  ])) return 'high';
  if (includesAny(value, [
    'hill',
    'ridge',
    'slope',
    'stairs',
    'platform',
    'elevation',
    '山丘',
    '山脊',
    '坡地',
    '楼梯',
    '平台',
    '高地',
  ])) return 'medium';
  return 'low';
}

function inferWater(facts: ConfirmedWorldFacts): WorldLayoutWaterShape {
  const value = normalized(facts.terrain, facts.geography, facts.ecology, facts.traversal);
  if (includesAny(value, [
    'no water',
    'waterless',
    'dry desert',
    '无水',
    '没有水域',
    '干旱沙漠',
  ])) return 'none';
  if (includesAny(value, [
    'river',
    'canal',
    'stream',
    'bridge',
    'ferry',
    'crossing',
    '河流',
    '运河',
    '溪流',
    '桥',
    '渡口',
    '渡船',
  ])) return 'crossing';
  if (includesAny(value, [
    'lake',
    'pond',
    'wetland',
    'marsh',
    'harbor',
    'coast',
    'ocean',
    '湖',
    '池塘',
    '湿地',
    '沼泽',
    '港口',
    '海岸',
    '海洋',
  ])) return 'basin';
  return 'none';
}

function inferSettlementDensity(facts: ConfirmedWorldFacts): WorldLayoutSettlementDensity {
  const value = normalized(facts.geography, facts.culture, facts.landmarks);
  if (includesAny(value, [
    'city',
    'district',
    'market',
    'urban',
    'crowded',
    'metropolis',
    '城市',
    '城区',
    '街区',
    '市场',
    '集市',
    '繁华',
  ])) return 'dense';
  if (includesAny(value, [
    'village',
    'settlement',
    'homes',
    'farm',
    'workshop',
    'temple',
    '村庄',
    '聚落',
    '住宅',
    '农场',
    '工坊',
    '寺庙',
  ])) return 'settled';
  return 'sparse';
}

function inferHazardLevel(facts: ConfirmedWorldFacts): WorldLayoutHazardLevel {
  const value = normalized(facts.premise, facts.worldview, facts.terrain, facts.traversal);
  if (includesAny(value, [
    'boss',
    'enemy',
    'combat',
    'trap',
    'lava',
    'spike',
    'poison',
    'monster',
    'danger',
    '首领',
    '敌人',
    '战斗',
    '陷阱',
    '熔岩',
    '尖刺',
    '毒',
    '怪物',
    '危险',
  ])) return 'dangerous';
  if (includesAny(value, [
    'hazard',
    'obstacle',
    'checkpoint',
    'guard',
    '危险区',
    '障碍',
    '检查点',
    '守卫',
  ])) return 'guarded';
  return 'calm';
}

export async function materializeWorldLayoutConstraints(
  value: unknown,
  expectedIntake?: unknown,
): Promise<WorldLayoutConstraints> {
  if (!isRecord(value)) {
    fail('layout-constraints.invalid-shape', 'World layout constraints must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'origin',
    'profile',
    'source',
    'route_shape',
    'scale',
    'verticality',
    'water',
    'settlement_density',
    'hazard_level',
    'landmark_labels',
  ], 'World layout constraints');
  if (
    value.schema_version !== WORLD_LAYOUT_CONSTRAINTS_VERSION
    || value.document_type !== 'world-layout-constraints'
  ) {
    fail('layout-constraints.invalid-value', 'World layout constraints must be a 1.0.0 document.');
  }
  if (!isWorldAssetProfile(value.profile)) {
    fail('layout-constraints.invalid-value', 'World layout constraints profile is unsupported.');
  }
  if (!isRecord(value.source)) {
    fail('layout-constraints.invalid-shape', 'World layout constraints source must be an object.');
  }
  exactKeys(value.source, [
    'intake_id',
    'session_revision',
    'map_layout_checkpoint_sha256',
    'layout_facts_sha256',
  ], 'World layout constraints source');
  if (
    !Array.isArray(value.landmark_labels)
    || value.landmark_labels.length < 2
    || value.landmark_labels.length > 4
  ) {
    fail('layout-constraints.invalid-value', 'World layout constraints require from two to four landmarks.');
  }
  const landmarkLabels = Object.freeze(value.landmark_labels.map((label, index) => (
    text(label, `World layout landmark ${index}`, 120)
  )));
  if (new Set(landmarkLabels).size !== landmarkLabels.length) {
    fail('layout-constraints.invalid-value', 'World layout landmark labels must be unique.');
  }
  const constraints: WorldLayoutConstraints = Object.freeze({
    schema_version: WORLD_LAYOUT_CONSTRAINTS_VERSION,
    document_type: 'world-layout-constraints',
    origin: enumValue(value.origin, ORIGINS, 'World layout constraints origin'),
    profile: value.profile,
    source: Object.freeze({
      intake_id: safeId(value.source.intake_id, 'World layout source intake id'),
      session_revision: integer(
        value.source.session_revision,
        'World layout source session revision',
        4,
      ),
      map_layout_checkpoint_sha256: digest(
        value.source.map_layout_checkpoint_sha256,
        'World layout map checkpoint digest',
      ),
      layout_facts_sha256: digest(
        value.source.layout_facts_sha256,
        'World layout facts digest',
      ),
    }),
    route_shape: enumValue(value.route_shape, ROUTE_SHAPES, 'World layout route shape'),
    scale: enumValue(value.scale, SCALES, 'World layout scale'),
    verticality: enumValue(value.verticality, VERTICALITIES, 'World layout verticality'),
    water: enumValue(value.water, WATER_SHAPES, 'World layout water shape'),
    settlement_density: enumValue(
      value.settlement_density,
      SETTLEMENT_DENSITIES,
      'World layout settlement density',
    ),
    hazard_level: enumValue(value.hazard_level, HAZARD_LEVELS, 'World layout hazard level'),
    landmark_labels: landmarkLabels,
  });

  if (expectedIntake !== undefined) {
    const intake = await materializeConfirmedWorldCreationIntake(expectedIntake);
    const mapCheckpoint = intake.checkpoints.find(({ stage }) => stage === 'map-layout')!;
    if (
      constraints.profile !== intake.profile
      || constraints.source.intake_id !== intake.intake_id
      || constraints.source.session_revision !== intake.session_revision
      || constraints.source.map_layout_checkpoint_sha256 !== mapCheckpoint.snapshot_sha256
      || constraints.source.layout_facts_sha256 !== await sha256(layoutFacts(intake.facts))
    ) {
      fail(
        'layout-constraints.invalid-binding',
        'World layout constraints do not match the confirmed intake.',
      );
    }
  }
  return constraints;
}

export async function deriveWorldLayoutConstraintsFromConfirmedIntake(
  value: unknown,
): Promise<WorldLayoutConstraints> {
  const intake: ConfirmedWorldCreationIntake = await materializeConfirmedWorldCreationIntake(value);
  const landmarkLabels = confirmedLandmarkLabels(intake.facts);
  return createWorldLayoutConstraintsFromConfirmedIntake(intake, {
    route_shape: inferRouteShape(intake.facts),
    scale: inferScale(intake.facts, landmarkLabels.length),
    verticality: inferVerticality(intake.facts),
    water: inferWater(intake.facts),
    settlement_density: inferSettlementDensity(intake.facts),
    hazard_level: inferHazardLevel(intake.facts),
    landmark_labels: landmarkLabels,
  }, 'compatibility-derived');
}

export async function createWorldLayoutConstraintsFromConfirmedIntake(
  value: unknown,
  intent: WorldLayoutConstraintIntent,
  origin: WorldLayoutConstraintOrigin = 'confirmed-intent',
): Promise<WorldLayoutConstraints> {
  const intake: ConfirmedWorldCreationIntake = await materializeConfirmedWorldCreationIntake(value);
  const mapCheckpoint = intake.checkpoints.find(({ stage }) => stage === 'map-layout')!;
  return materializeWorldLayoutConstraints({
    schema_version: WORLD_LAYOUT_CONSTRAINTS_VERSION,
    document_type: 'world-layout-constraints',
    origin,
    profile: intake.profile,
    source: {
      intake_id: intake.intake_id,
      session_revision: intake.session_revision,
      map_layout_checkpoint_sha256: mapCheckpoint.snapshot_sha256,
      layout_facts_sha256: await sha256(layoutFacts(intake.facts)),
    },
    route_shape: intent.route_shape,
    scale: intent.scale,
    verticality: intent.verticality,
    water: intent.water,
    settlement_density: intent.settlement_density,
    hazard_level: intent.hazard_level,
    landmark_labels: intent.landmark_labels,
  }, intake);
}

export async function fingerprintWorldLayoutConstraints(value: unknown): Promise<string> {
  return sha256(await materializeWorldLayoutConstraints(value));
}
