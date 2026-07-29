import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from './world-layout-plan';
import { WORLD_LAYOUT_PACK_PATH } from './world-layout-pack-binding';

export const WORLD_VISUAL_PLACEMENT_PLAN_VERSION = '1.0.0' as const;
export const WORLD_VISUAL_PLACEMENT_PLAN_STATUS = 'planned' as const;

export const WORLD_VISUAL_PLACEMENT_KINDS = Object.freeze([
  'sprite',
  'depth-plane',
  'effect',
  'actor',
] as const);
export type WorldVisualPlacementKind = typeof WORLD_VISUAL_PLACEMENT_KINDS[number];

export const WORLD_VISUAL_PLACEMENT_LAYERS = Object.freeze([
  'background',
  'world',
  'actors',
  'effects',
  'foreground',
  'lighting',
] as const);
export type WorldVisualPlacementLayer = typeof WORLD_VISUAL_PLACEMENT_LAYERS[number];

export const WORLD_VISUAL_ACTOR_CONTROLLERS = Object.freeze([
  'player',
  'npc',
  'enemy',
  'moving-platform',
  'ambient',
] as const);
export type WorldVisualActorController = typeof WORLD_VISUAL_ACTOR_CONTROLLERS[number];

export const WORLD_VISUAL_EFFECT_TRIGGERS = Object.freeze([
  'always',
  'on-spawn',
  'on-interact',
  'on-enter',
  'on-exit',
  'on-attack',
  'on-impact',
  'on-defeat',
] as const);
export type WorldVisualEffectTrigger = typeof WORLD_VISUAL_EFFECT_TRIGGERS[number];

export type WorldVisualPlacementAnchor =
  | Readonly<{ kind: 'logical-point'; x: number; y: number }>
  | Readonly<{ kind: 'logical-rect'; x: number; y: number; width: number; height: number }>
  | Readonly<{ kind: 'landmark'; ref_id: string }>
  | Readonly<{ kind: 'traversal'; ref_id: string }>
  | Readonly<{ kind: 'spawn' }>
  | Readonly<{ kind: 'exit' }>
  | Readonly<{ kind: 'region'; ref_id: string }>;

export type WorldVisualYSortedRender = Readonly<{
  layer: WorldVisualPlacementLayer;
  order: number;
  y_sort: boolean;
}>;

export type WorldVisualDepthPlaneRender = Readonly<{
  layer: WorldVisualPlacementLayer;
  order: number;
  parallax: Readonly<{ x: number; y: number }>;
  repeat: Readonly<{ x: boolean; y: boolean }>;
}>;

type WorldVisualPlacementBase = Readonly<{
  placement_id: string;
  role: string;
  variant_id?: string;
  anchor: WorldVisualPlacementAnchor;
}>;

export type WorldVisualSpritePlacement = WorldVisualPlacementBase & Readonly<{
  kind: 'sprite';
  render: WorldVisualYSortedRender;
}>;

export type WorldVisualDepthPlanePlacement = WorldVisualPlacementBase & Readonly<{
  kind: 'depth-plane';
  render: WorldVisualDepthPlaneRender;
}>;

export type WorldVisualEffectPlacement = WorldVisualPlacementBase & Readonly<{
  kind: 'effect';
  render: WorldVisualYSortedRender;
  trigger: WorldVisualEffectTrigger;
}>;

export type WorldVisualActorPlacement = WorldVisualPlacementBase & Readonly<{
  kind: 'actor';
  render: WorldVisualYSortedRender;
  controller: WorldVisualActorController;
}>;

export type WorldVisualPlacement =
  | WorldVisualSpritePlacement
  | WorldVisualDepthPlanePlacement
  | WorldVisualEffectPlacement
  | WorldVisualActorPlacement;

export interface WorldVisualPlacementPlan {
  readonly schema_version: typeof WORLD_VISUAL_PLACEMENT_PLAN_VERSION;
  readonly document_type: 'world-visual-placement-plan';
  readonly status: typeof WORLD_VISUAL_PLACEMENT_PLAN_STATUS;
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    layout_plan_id: string;
    layout_plan_path: typeof WORLD_LAYOUT_PACK_PATH;
    layout_plan_sha256: string;
  }>;
  readonly bounds: Readonly<{
    width: number;
    height: number;
    unit: 'logical-tile';
  }>;
  readonly placements: readonly WorldVisualPlacement[];
}

export type WorldVisualPlacementPlanErrorCode =
  | 'world-visual-placement-plan.invalid-shape'
  | 'world-visual-placement-plan.invalid-value'
  | 'world-visual-placement-plan.invalid-path'
  | 'world-visual-placement-plan.invalid-binding'
  | 'world-visual-placement-plan.invalid-bounds'
  | 'world-visual-placement-plan.invalid-reference'
  | 'world-visual-placement-plan.invalid-order'
  | 'world-visual-placement-plan.duplicate';

export class WorldVisualPlacementPlanError extends Error {
  constructor(readonly code: WorldVisualPlacementPlanErrorCode, message: string) {
    super(message);
    this.name = 'WorldVisualPlacementPlanError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_ROLE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PLAN_ID = /^world-visual-placement-plan-[a-f0-9]{16}$/;
const LAYER_ORDER: Readonly<Record<WorldVisualPlacementLayer, number>> = Object.freeze({
  background: 0,
  world: 1,
  actors: 2,
  effects: 3,
  foreground: 4,
  lighting: 5,
});

type DataRecord = Record<string, unknown>;

function fail(code: WorldVisualPlacementPlanErrorCode, message: string): never {
  throw new WorldVisualPlacementPlanError(code, message);
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
      'world-visual-placement-plan.invalid-shape',
      `${label} must contain exactly: ${canonical.join(', ')}.`,
    );
  }
}

function safeId(value: unknown, label: string, maximum = 100): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || !SAFE_ID.test(value)
  ) {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} must be bounded lowercase kebab-case.`,
    );
  }
  return value;
}

function safeRole(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 120 || !SAFE_ROLE.test(value)) {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} must be a bounded dotted role.`,
    );
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} must be a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value as number;
}

function ratio(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 4) {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} must be a finite number from 0 to 4.`,
    );
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
      fail(
        'world-visual-placement-plan.invalid-value',
        'Visual placement plan cannot contain non-finite numbers.',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail(
      'world-visual-placement-plan.invalid-value',
      'Visual placement plan contains an unsupported value.',
    );
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

function materializeBounds(
  value: unknown,
): WorldVisualPlacementPlan['bounds'] {
  if (!isRecord(value)) {
    fail('world-visual-placement-plan.invalid-shape', 'Placement bounds must be an object.');
  }
  exactKeys(value, ['width', 'height', 'unit'], 'Placement bounds');
  if (value.unit !== 'logical-tile') {
    fail(
      'world-visual-placement-plan.invalid-bounds',
      'Placement bounds must use logical-tile units.',
    );
  }
  return Object.freeze({
    width: integer(value.width, 'Placement bounds width', 16, 512),
    height: integer(value.height, 'Placement bounds height', 12, 512),
    unit: 'logical-tile' as const,
  });
}

function materializeAnchor(
  value: unknown,
  label: string,
  layout: WorldLayoutPlan,
): WorldVisualPlacementAnchor {
  if (!isRecord(value)) {
    fail('world-visual-placement-plan.invalid-shape', `${label} must be an object.`);
  }
  if (![
    'logical-point',
    'logical-rect',
    'landmark',
    'traversal',
    'spawn',
    'exit',
    'region',
  ].includes(String(value.kind))) {
    fail('world-visual-placement-plan.invalid-value', `${label} kind is unsupported.`);
  }
  if (value.kind === 'logical-point') {
    exactKeys(value, ['kind', 'x', 'y'], label);
    return Object.freeze({
      kind: 'logical-point' as const,
      x: integer(value.x, `${label} x`, 0, layout.bounds.width - 1),
      y: integer(value.y, `${label} y`, 0, layout.bounds.height - 1),
    });
  }
  if (value.kind === 'logical-rect') {
    exactKeys(value, ['kind', 'x', 'y', 'width', 'height'], label);
    const rect = Object.freeze({
      kind: 'logical-rect' as const,
      x: integer(value.x, `${label} x`, 0, layout.bounds.width - 1),
      y: integer(value.y, `${label} y`, 0, layout.bounds.height - 1),
      width: integer(value.width, `${label} width`, 1, layout.bounds.width),
      height: integer(value.height, `${label} height`, 1, layout.bounds.height),
    });
    if (
      rect.x + rect.width > layout.bounds.width
      || rect.y + rect.height > layout.bounds.height
    ) {
      fail(
        'world-visual-placement-plan.invalid-bounds',
        `${label} must remain inside layout bounds.`,
      );
    }
    return rect;
  }
  if (value.kind === 'spawn' || value.kind === 'exit') {
    exactKeys(value, ['kind'], label);
    return Object.freeze({ kind: value.kind });
  }
  exactKeys(value, ['kind', 'ref_id'], label);
  const referenceKind = value.kind as 'landmark' | 'traversal' | 'region';
  const refId = safeId(value.ref_id, `${label} reference id`);
  const known = referenceKind === 'landmark'
    ? layout.landmarks.some(({ id }) => id === refId)
    : referenceKind === 'traversal'
      ? layout.traversal.nodes.some(({ id }) => id === refId)
      : layout.regions.some(({ id }) => id === refId);
  if (!known) {
    fail(
      'world-visual-placement-plan.invalid-reference',
      `${label} does not resolve in the bound layout.`,
    );
  }
  return Object.freeze({ kind: referenceKind, ref_id: refId });
}

function materializeYSortedRender(
  value: unknown,
  label: string,
): WorldVisualYSortedRender {
  if (!isRecord(value)) {
    fail('world-visual-placement-plan.invalid-shape', `${label} must be an object.`);
  }
  exactKeys(value, ['layer', 'order', 'y_sort'], label);
  if (
    !WORLD_VISUAL_PLACEMENT_LAYERS.includes(value.layer as WorldVisualPlacementLayer)
    || typeof value.y_sort !== 'boolean'
  ) {
    fail('world-visual-placement-plan.invalid-value', `${label} is invalid.`);
  }
  return Object.freeze({
    layer: value.layer as WorldVisualPlacementLayer,
    order: integer(value.order, `${label} order`, -4096, 4096),
    y_sort: value.y_sort,
  });
}

function materializeDepthPlaneRender(
  value: unknown,
  label: string,
): WorldVisualDepthPlaneRender {
  if (!isRecord(value)) {
    fail('world-visual-placement-plan.invalid-shape', `${label} must be an object.`);
  }
  exactKeys(value, ['layer', 'order', 'parallax', 'repeat'], label);
  if (
    !WORLD_VISUAL_PLACEMENT_LAYERS.includes(value.layer as WorldVisualPlacementLayer)
    || !isRecord(value.parallax)
    || !isRecord(value.repeat)
  ) {
    fail('world-visual-placement-plan.invalid-value', `${label} is invalid.`);
  }
  exactKeys(value.parallax, ['x', 'y'], `${label} parallax`);
  exactKeys(value.repeat, ['x', 'y'], `${label} repeat`);
  if (typeof value.repeat.x !== 'boolean' || typeof value.repeat.y !== 'boolean') {
    fail('world-visual-placement-plan.invalid-value', `${label} repeat flags are invalid.`);
  }
  return Object.freeze({
    layer: value.layer as WorldVisualPlacementLayer,
    order: integer(value.order, `${label} order`, -4096, 4096),
    parallax: Object.freeze({
      x: ratio(value.parallax.x, `${label} parallax x`),
      y: ratio(value.parallax.y, `${label} parallax y`),
    }),
    repeat: Object.freeze({
      x: value.repeat.x,
      y: value.repeat.y,
    }),
  });
}

function validateKindSemantics(placement: WorldVisualPlacement, label: string): void {
  const anchorKind = placement.anchor.kind;
  if (
    placement.kind === 'depth-plane'
    && anchorKind !== 'logical-rect'
    && anchorKind !== 'region'
  ) {
    fail(
      'world-visual-placement-plan.invalid-reference',
      `${label} depth-plane requires a logical-rect or region anchor.`,
    );
  }
  if (
    (placement.kind === 'sprite' || placement.kind === 'actor')
    && (anchorKind === 'logical-rect' || anchorKind === 'region')
  ) {
    fail(
      'world-visual-placement-plan.invalid-reference',
      `${label} ${placement.kind} requires a point or node anchor.`,
    );
  }
  if (
    placement.kind === 'depth-plane'
    && !['background', 'foreground', 'lighting'].includes(placement.render.layer)
  ) {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} depth-plane layer is incompatible.`,
    );
  }
  if (placement.kind === 'actor' && placement.render.layer !== 'actors') {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} actor must use the actors layer.`,
    );
  }
  if (placement.kind === 'effect' && placement.render.layer !== 'effects') {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} effect must use the effects layer.`,
    );
  }
  if (
    placement.kind === 'sprite'
    && !['background', 'world', 'foreground'].includes(placement.render.layer)
  ) {
    fail(
      'world-visual-placement-plan.invalid-value',
      `${label} sprite layer is incompatible.`,
    );
  }
}

function materializePlacement(
  value: unknown,
  index: number,
  layout: WorldLayoutPlan,
): WorldVisualPlacement {
  const label = `Placement ${index}`;
  if (!isRecord(value)) {
    fail('world-visual-placement-plan.invalid-shape', `${label} must be an object.`);
  }
  if (!WORLD_VISUAL_PLACEMENT_KINDS.includes(value.kind as WorldVisualPlacementKind)) {
    fail('world-visual-placement-plan.invalid-value', `${label} kind is unsupported.`);
  }
  const kind = value.kind as WorldVisualPlacementKind;
  const optionalVariant = value.variant_id === undefined ? [] : ['variant_id'];
  const kindSpecific = kind === 'actor'
    ? ['controller']
    : kind === 'effect'
      ? ['trigger']
      : [];
  exactKeys(
    value,
    [
      'placement_id',
      'kind',
      'role',
      ...optionalVariant,
      'anchor',
      'render',
      ...kindSpecific,
    ],
    label,
  );
  const base = {
    placement_id: safeId(value.placement_id, `${label} id`),
    kind,
    role: safeRole(value.role, `${label} role`),
    ...(value.variant_id === undefined
      ? {}
      : { variant_id: safeId(value.variant_id, `${label} variant id`) }),
    anchor: materializeAnchor(value.anchor, `${label} anchor`, layout),
  };
  let placement: WorldVisualPlacement;
  if (kind === 'depth-plane') {
    placement = Object.freeze({
      ...base,
      kind,
      render: materializeDepthPlaneRender(value.render, `${label} render`),
    });
  } else if (kind === 'actor') {
    if (!WORLD_VISUAL_ACTOR_CONTROLLERS.includes(value.controller as WorldVisualActorController)) {
      fail('world-visual-placement-plan.invalid-value', `${label} controller is unsupported.`);
    }
    placement = Object.freeze({
      ...base,
      kind,
      render: materializeYSortedRender(value.render, `${label} render`),
      controller: value.controller as WorldVisualActorController,
    });
  } else if (kind === 'effect') {
    if (!WORLD_VISUAL_EFFECT_TRIGGERS.includes(value.trigger as WorldVisualEffectTrigger)) {
      fail('world-visual-placement-plan.invalid-value', `${label} trigger is unsupported.`);
    }
    placement = Object.freeze({
      ...base,
      kind,
      render: materializeYSortedRender(value.render, `${label} render`),
      trigger: value.trigger as WorldVisualEffectTrigger,
    });
  } else {
    placement = Object.freeze({
      ...base,
      kind,
      render: materializeYSortedRender(value.render, `${label} render`),
    });
  }
  validateKindSemantics(placement, label);
  return placement;
}

function comparePlacements(left: WorldVisualPlacement, right: WorldVisualPlacement): number {
  return LAYER_ORDER[left.render.layer] - LAYER_ORDER[right.render.layer]
    || left.render.order - right.render.order
    || left.placement_id.localeCompare(right.placement_id, 'en');
}

function materializePlacements(
  value: unknown,
  layout: WorldLayoutPlan,
  requireCanonicalOrder: boolean,
): readonly WorldVisualPlacement[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2048) {
    fail(
      'world-visual-placement-plan.invalid-value',
      'Visual placement plan requires from 1 to 2048 placements.',
    );
  }
  const placements = value.map((candidate, index) =>
    materializePlacement(candidate, index, layout));
  const ids = placements.map(({ placement_id: placementId }) => placementId);
  if (new Set(ids).size !== ids.length) {
    fail(
      'world-visual-placement-plan.duplicate',
      'Visual placement ids must be globally unique.',
    );
  }
  const sorted = [...placements].sort(comparePlacements);
  if (
    requireCanonicalOrder
    && placements.some((placement, index) => placement !== sorted[index])
  ) {
    fail(
      'world-visual-placement-plan.invalid-order',
      'Visual placements must use canonical layer, order, and id order.',
    );
  }
  return Object.freeze(requireCanonicalOrder ? placements : sorted);
}

function planIdentity(
  profile: WorldAssetProfile,
  source: WorldVisualPlacementPlan['source'],
  bounds: WorldVisualPlacementPlan['bounds'],
  placements: readonly WorldVisualPlacement[],
): Readonly<{
  profile: WorldAssetProfile;
  source: WorldVisualPlacementPlan['source'];
  bounds: WorldVisualPlacementPlan['bounds'];
  placements: readonly WorldVisualPlacement[];
}> {
  return Object.freeze({ profile, source, bounds, placements });
}

async function expectedPlanId(
  profile: WorldAssetProfile,
  source: WorldVisualPlacementPlan['source'],
  bounds: WorldVisualPlacementPlan['bounds'],
  placements: readonly WorldVisualPlacement[],
): Promise<string> {
  return `world-visual-placement-plan-${(
    await sha256(planIdentity(profile, source, bounds, placements))
  ).slice(0, 16)}`;
}

export async function buildWorldVisualPlacementPlan(
  layoutValue: unknown,
  placementsValue: unknown,
): Promise<WorldVisualPlacementPlan> {
  const layout = await materializeWorldLayoutPlan(layoutValue);
  const layoutSha256 = await fingerprintWorldLayoutPlan(layout);
  const source = Object.freeze({
    layout_plan_id: layout.plan_id,
    layout_plan_path: WORLD_LAYOUT_PACK_PATH,
    layout_plan_sha256: layoutSha256,
  });
  const bounds = Object.freeze({ ...layout.bounds });
  const placements = materializePlacements(placementsValue, layout, false);
  return materializeWorldVisualPlacementPlan({
    schema_version: WORLD_VISUAL_PLACEMENT_PLAN_VERSION,
    document_type: 'world-visual-placement-plan',
    status: WORLD_VISUAL_PLACEMENT_PLAN_STATUS,
    plan_id: await expectedPlanId(layout.profile, source, bounds, placements),
    profile: layout.profile,
    source,
    bounds,
    placements,
  }, layout);
}

export async function materializeWorldVisualPlacementPlan(
  value: unknown,
  layoutValue: unknown,
): Promise<WorldVisualPlacementPlan> {
  const layout = await materializeWorldLayoutPlan(layoutValue).catch((error) => fail(
    'world-visual-placement-plan.invalid-binding',
    `Bound WorldLayoutPlan is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
  ));
  if (!isRecord(value)) {
    fail(
      'world-visual-placement-plan.invalid-shape',
      'World visual placement plan must be an object.',
    );
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'status',
    'plan_id',
    'profile',
    'source',
    'bounds',
    'placements',
  ], 'World visual placement plan');
  if (
    value.schema_version !== WORLD_VISUAL_PLACEMENT_PLAN_VERSION
    || value.document_type !== 'world-visual-placement-plan'
    || value.status !== WORLD_VISUAL_PLACEMENT_PLAN_STATUS
    || !isWorldAssetProfile(value.profile)
    || typeof value.plan_id !== 'string'
    || !PLAN_ID.test(value.plan_id)
  ) {
    fail(
      'world-visual-placement-plan.invalid-value',
      'World visual placement plan identity is invalid.',
    );
  }
  if (!isRecord(value.source)) {
    fail(
      'world-visual-placement-plan.invalid-shape',
      'World visual placement source must be an object.',
    );
  }
  exactKeys(
    value.source,
    ['layout_plan_id', 'layout_plan_path', 'layout_plan_sha256'],
    'World visual placement source',
  );
  if (value.source.layout_plan_path !== WORLD_LAYOUT_PACK_PATH) {
    fail(
      'world-visual-placement-plan.invalid-path',
      `Layout plan path must be ${WORLD_LAYOUT_PACK_PATH}.`,
    );
  }
  const source = Object.freeze({
    layout_plan_id: safeId(value.source.layout_plan_id, 'Layout plan id'),
    layout_plan_path: WORLD_LAYOUT_PACK_PATH,
    layout_plan_sha256: digest(value.source.layout_plan_sha256, 'Layout plan digest'),
  });
  const bounds = materializeBounds(value.bounds);
  const placements = materializePlacements(value.placements, layout, true);
  const plan = Object.freeze({
    schema_version: WORLD_VISUAL_PLACEMENT_PLAN_VERSION,
    document_type: 'world-visual-placement-plan' as const,
    status: WORLD_VISUAL_PLACEMENT_PLAN_STATUS,
    plan_id: value.plan_id,
    profile: value.profile,
    source,
    bounds,
    placements,
  });
  const layoutSha256 = await fingerprintWorldLayoutPlan(layout);
  if (
    plan.profile !== layout.profile
    || plan.source.layout_plan_id !== layout.plan_id
    || plan.source.layout_plan_sha256 !== layoutSha256
    || canonicalJson(plan.bounds) !== canonicalJson(layout.bounds)
  ) {
    fail(
      'world-visual-placement-plan.invalid-binding',
      'Visual placement plan does not bind the exact canonical layout profile and bounds.',
    );
  }
  if (
    plan.plan_id !== await expectedPlanId(
      plan.profile,
      plan.source,
      plan.bounds,
      plan.placements,
    )
  ) {
    fail(
      'world-visual-placement-plan.invalid-binding',
      'Visual placement plan id does not match its canonical identity.',
    );
  }
  return plan;
}

export async function fingerprintWorldVisualPlacementPlan(
  value: unknown,
  layoutValue: unknown,
): Promise<string> {
  return sha256(await materializeWorldVisualPlacementPlan(value, layoutValue));
}

export async function serializeCanonicalWorldVisualPlacementPlan(
  value: unknown,
  layoutValue: unknown,
): Promise<Uint8Array> {
  const plan = await materializeWorldVisualPlacementPlan(value, layoutValue);
  return new TextEncoder().encode(`${canonicalJson(plan)}\n`);
}
