import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  materializeAssetRequirementsV1_1,
  type AssetRequirementV1_1,
  type AssetRequirementsV1_1,
} from './asset-requirements-v1-1';
import {
  fingerprintProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
  type ProductionArtSlotMappingV1_1,
} from './production-art-contract-v1-1';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from './world-layout-plan';
import { worldMaterialRoleForProfile } from './world-material-palette';

export const WORLD_ART_VARIANT_MAP_VERSION = '1.0.0' as const;
export const REVIEWED_WORLD_ART_SLOT_INVENTORY_VERSION = '1.0.0' as const;

export type WorldArtUsageKind =
  | 'terrain-material'
  | 'landmark'
  | 'hazard'
  | 'character';

export interface WorldArtAtlasCell {
  readonly column: number;
  readonly row: number;
  readonly column_span: number;
  readonly row_span: number;
}

/**
 * Provider-neutral inventory emitted by a review/admission boundary. This core
 * contract intentionally does not infer reviewed paths from provider output.
 */
export interface ReviewedWorldArtSlot {
  readonly slot_id: string;
  readonly requirement_id: string;
  readonly role: string;
  readonly variant_id: string;
  readonly atlas_path: string;
  readonly atlas_cell: WorldArtAtlasCell;
}

export interface ReviewedWorldArtSlotInventory {
  readonly schema_version: typeof REVIEWED_WORLD_ART_SLOT_INVENTORY_VERSION;
  readonly document_type: 'reviewed-world-art-slot-inventory';
  readonly profile: WorldAssetProfile;
  readonly production_art_plan_id: string;
  readonly production_art_plan_sha256: string;
  readonly review_record_sha256: string;
  readonly review_status: 'pass';
  readonly slots: readonly ReviewedWorldArtSlot[];
}

export interface WorldArtVariantSelection {
  readonly usage_kind: Exclude<WorldArtUsageKind, 'landmark'>;
  readonly usage_id: string;
  readonly slot_id: string;
}

export interface WorldArtVariantBinding {
  readonly usage_kind: WorldArtUsageKind;
  readonly usage_id: string;
  readonly slot_id: string;
  readonly role: string;
  readonly variant_id: string;
  readonly atlas_path: string;
  readonly atlas_cell: WorldArtAtlasCell;
}

export interface WorldArtVariantMap {
  readonly schema_version: typeof WORLD_ART_VARIANT_MAP_VERSION;
  readonly document_type: 'world-art-variant-map';
  readonly map_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    layout_plan_id: string;
    layout_plan_sha256: string;
    production_art_plan_id: string;
    production_art_plan_sha256: string;
    reviewed_slot_inventory_sha256: string;
    review_record_sha256: string;
  }>;
  readonly bindings: readonly WorldArtVariantBinding[];
}

export interface WorldArtVariantMapInput {
  readonly layout_plan: unknown;
  readonly asset_requirements: unknown;
  readonly production_art_plan: unknown;
  readonly reviewed_slot_inventory: unknown;
  readonly selections: unknown;
}

export type WorldArtVariantMapErrorCode =
  | 'world-art-variant-map.invalid-shape'
  | 'world-art-variant-map.invalid-value'
  | 'world-art-variant-map.invalid-source'
  | 'world-art-variant-map.invalid-inventory'
  | 'world-art-variant-map.invalid-selection'
  | 'world-art-variant-map.invalid-binding'
  | 'world-art-variant-map.private-path';

export class WorldArtVariantMapError extends Error {
  constructor(readonly code: WorldArtVariantMapErrorCode, message: string) {
    super(message);
    this.name = 'WorldArtVariantMapError';
  }
}

type MutableRecord = Record<string, unknown>;

interface ConfirmedInputs {
  readonly layout: WorldLayoutPlan;
  readonly requirements: AssetRequirementsV1_1;
  readonly plan: ProductionArtPlanV1_1;
  readonly layoutSha256: string;
  readonly planSha256: string;
  readonly inventory: ReviewedWorldArtSlotInventory;
  readonly inventorySha256: string;
  readonly selections: readonly WorldArtVariantSelection[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_ROLE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SAFE_PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const USAGE_ORDER: Readonly<Record<WorldArtUsageKind, number>> = Object.freeze({
  'terrain-material': 0,
  landmark: 1,
  hazard: 2,
  character: 3,
});

function fail(code: WorldArtVariantMapErrorCode, message: string): never {
  throw new WorldArtVariantMapError(code, message);
}

function isRecord(value: unknown): value is MutableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: MutableRecord,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(
      'world-art-variant-map.invalid-shape',
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
    fail('world-art-variant-map.invalid-value', `${label} must be lowercase kebab-case.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('world-art-variant-map.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function role(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 100 || !SAFE_ROLE.test(value)) {
    fail('world-art-variant-map.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function portableAtlasPath(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.includes('\\')
    || value.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail(
      'world-art-variant-map.private-path',
      'Reviewed atlas paths must be portable relative paths.',
    );
  }
  const segments = value.split('/');
  if (
    segments.some((segment) =>
      segment === '.'
      || segment === '..'
      || !SAFE_PATH_SEGMENT.test(segment))
    || !value.endsWith('.png')
  ) {
    fail(
      'world-art-variant-map.private-path',
      'Reviewed atlas paths must use safe relative PNG path segments.',
    );
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0, maximum = 255): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('world-art-variant-map.invalid-value', `${label} is invalid.`);
  }
  return value as number;
}

function materializeAtlasCell(value: unknown, label: string): WorldArtAtlasCell {
  if (!isRecord(value)) {
    fail('world-art-variant-map.invalid-shape', `${label} must be an object.`);
  }
  exactKeys(value, ['column', 'row', 'column_span', 'row_span'], label);
  return Object.freeze({
    column: integer(value.column, `${label} column`),
    row: integer(value.row, `${label} row`),
    column_span: integer(value.column_span, `${label} column span`, 1, 256),
    row_span: integer(value.row_span, `${label} row span`, 1, 256),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('world-art-variant-map.invalid-value', 'Document contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('world-art-variant-map.invalid-value', 'Document contains an unsupported value.');
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

function sameCell(
  left: WorldArtAtlasCell,
  right: ProductionArtSlotMappingV1_1['grid_rect'],
): boolean {
  return left.column === right.column
    && left.row === right.row
    && left.column_span === right.column_span
    && left.row_span === right.row_span;
}

function planSlots(
  plan: ProductionArtPlanV1_1,
): ReadonlyMap<string, Readonly<{
  slot: ProductionArtSlotMappingV1_1;
  atlasPath: string;
}>> {
  const result = new Map<string, Readonly<{
    slot: ProductionArtSlotMappingV1_1;
    atlasPath: string;
  }>>();
  for (const task of plan.tasks) {
    for (const slot of task.slot_mappings) {
      if (result.has(slot.slot_id)) {
        fail(
          'world-art-variant-map.invalid-source',
          `Production art slot ${slot.slot_id} is not globally unique.`,
        );
      }
      result.set(slot.slot_id, Object.freeze({
        slot,
        atlasPath: task.expected_output_path,
      }));
    }
  }
  return result;
}

function materializeReviewedInventory(
  value: unknown,
  plan: ProductionArtPlanV1_1,
  planSha256: string,
): ReviewedWorldArtSlotInventory {
  if (!isRecord(value)) {
    fail('world-art-variant-map.invalid-shape', 'Reviewed slot inventory must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'profile',
    'production_art_plan_id',
    'production_art_plan_sha256',
    'review_record_sha256',
    'review_status',
    'slots',
  ], 'Reviewed slot inventory');
  if (
    value.schema_version !== REVIEWED_WORLD_ART_SLOT_INVENTORY_VERSION
    || value.document_type !== 'reviewed-world-art-slot-inventory'
    || !isWorldAssetProfile(value.profile)
    || value.profile !== plan.profile
    || safeId(value.production_art_plan_id, 'Reviewed inventory plan id', 100) !== plan.plan_id
    || digest(value.production_art_plan_sha256, 'Reviewed inventory plan digest') !== planSha256
    || value.review_status !== 'pass'
    || !Array.isArray(value.slots)
    || value.slots.length < 1
    || value.slots.length > 2048
  ) {
    fail(
      'world-art-variant-map.invalid-inventory',
      'Reviewed slot inventory identity, review status, or slot count is invalid.',
    );
  }
  const knownSlots = planSlots(plan);
  const seen = new Set<string>();
  const slots = Object.freeze(value.slots.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('world-art-variant-map.invalid-shape', `Reviewed slot ${index} must be an object.`);
    }
    exactKeys(candidate, [
      'slot_id',
      'requirement_id',
      'role',
      'variant_id',
      'atlas_path',
      'atlas_cell',
    ], `Reviewed slot ${index}`);
    const slotId = safeId(candidate.slot_id, `Reviewed slot ${index} id`);
    const requirementId = safeId(
      candidate.requirement_id,
      `Reviewed slot ${index} requirement id`,
    );
    const variantId = safeId(candidate.variant_id, `Reviewed slot ${index} variant id`);
    const slotRole = role(candidate.role, `Reviewed slot ${index} role`);
    const atlasPath = portableAtlasPath(candidate.atlas_path);
    const atlasCell = materializeAtlasCell(candidate.atlas_cell, `Reviewed slot ${index} cell`);
    const expected = knownSlots.get(slotId);
    if (
      seen.has(slotId)
      || expected === undefined
      || expected.slot.requirement_id !== requirementId
      || expected.slot.variant_id !== variantId
      || expected.slot.role !== slotRole
      || !sameCell(atlasCell, expected.slot.grid_rect)
    ) {
      fail(
        'world-art-variant-map.invalid-inventory',
        `Reviewed slot ${slotId} does not match the bound ProductionArtPlan 1.1 slot.`,
      );
    }
    seen.add(slotId);
    return Object.freeze({
      slot_id: slotId,
      requirement_id: requirementId,
      role: slotRole,
      variant_id: variantId,
      atlas_path: atlasPath,
      atlas_cell: atlasCell,
    });
  }));
  return Object.freeze({
    schema_version: REVIEWED_WORLD_ART_SLOT_INVENTORY_VERSION,
    document_type: 'reviewed-world-art-slot-inventory',
    profile: value.profile,
    production_art_plan_id: plan.plan_id,
    production_art_plan_sha256: planSha256,
    review_record_sha256: digest(value.review_record_sha256, 'Review record digest'),
    review_status: 'pass',
    slots,
  });
}

function materializeSelections(value: unknown): readonly WorldArtVariantSelection[] {
  if (!Array.isArray(value) || value.length > 2048) {
    fail(
      'world-art-variant-map.invalid-selection',
      'World art selections must be a bounded array.',
    );
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('world-art-variant-map.invalid-shape', `Selection ${index} must be an object.`);
    }
    exactKeys(candidate, ['usage_kind', 'usage_id', 'slot_id'], `Selection ${index}`);
    if (!['terrain-material', 'hazard', 'character'].includes(String(candidate.usage_kind))) {
      fail(
        'world-art-variant-map.invalid-selection',
        `Selection ${index} has an unsupported usage kind.`,
      );
    }
    const selection = Object.freeze({
      usage_kind: candidate.usage_kind as WorldArtVariantSelection['usage_kind'],
      usage_id: safeId(candidate.usage_id, `Selection ${index} usage id`),
      slot_id: safeId(candidate.slot_id, `Selection ${index} slot id`),
    });
    const key = `${selection.usage_kind}\u0000${selection.usage_id}`;
    if (seen.has(key)) {
      fail(
        'world-art-variant-map.invalid-selection',
        `Selection ${selection.usage_kind}/${selection.usage_id} is duplicated.`,
      );
    }
    seen.add(key);
    return selection;
  }));
}

function terrainMaterials(layout: WorldLayoutPlan): readonly string[] {
  const terrain = layout.terrain_layout.kind === 'bands'
    ? layout.terrain_layout.bands
    : layout.terrain_layout.zones;
  return Object.freeze([...new Set(terrain.map(({ material }) => material))].sort());
}

function requirementsOfCategory(
  requirements: AssetRequirementsV1_1,
  category: 'hazard' | 'character',
): readonly AssetRequirementV1_1[] {
  return Object.freeze(requirements.requirements
    .filter((requirement) => requirement.category === category)
    .sort((left, right) => left.requirement_id.localeCompare(right.requirement_id)));
}

function requiredSelectionKeys(
  layout: WorldLayoutPlan,
  requirements: AssetRequirementsV1_1,
): ReadonlyMap<string, AssetRequirementV1_1 | null> {
  const result = new Map<string, AssetRequirementV1_1 | null>();
  terrainMaterials(layout).forEach((material) => {
    result.set(`terrain-material\u0000${material}`, null);
  });
  (['hazard', 'character'] as const).forEach((category) => {
    requirementsOfCategory(requirements, category).forEach((requirement) => {
      result.set(`${category}\u0000${requirement.requirement_id}`, requirement);
    });
  });
  return result;
}

function bindingFromReviewed(
  usageKind: WorldArtUsageKind,
  usageId: string,
  slot: ReviewedWorldArtSlot,
): WorldArtVariantBinding {
  return Object.freeze({
    usage_kind: usageKind,
    usage_id: usageId,
    slot_id: slot.slot_id,
    role: slot.role,
    variant_id: slot.variant_id,
    atlas_path: slot.atlas_path,
    atlas_cell: slot.atlas_cell,
  });
}

function selectedBindings(
  confirmed: ConfirmedInputs,
): readonly WorldArtVariantBinding[] {
  const required = requiredSelectionKeys(confirmed.layout, confirmed.requirements);
  if (confirmed.selections.length !== required.size) {
    fail(
      'world-art-variant-map.invalid-selection',
      'Selections must cover every terrain material, hazard requirement, and character requirement.',
    );
  }
  const requirements = new Map(confirmed.requirements.requirements.map((item) => [
    item.requirement_id,
    item,
  ]));
  const reviewed = new Map(confirmed.inventory.slots.map((slot) => [slot.slot_id, slot]));
  const bindings = confirmed.selections.map((selection) => {
    const key = `${selection.usage_kind}\u0000${selection.usage_id}`;
    if (!required.has(key)) {
      fail(
        'world-art-variant-map.invalid-selection',
        `Selection ${selection.usage_kind}/${selection.usage_id} was not demanded by layout or requirements.`,
      );
    }
    const reviewedSlot = reviewed.get(selection.slot_id);
    if (reviewedSlot === undefined) {
      fail(
        'world-art-variant-map.invalid-selection',
        `Selection ${selection.usage_kind}/${selection.usage_id} is not in the reviewed inventory.`,
      );
    }
    const slotRequirement = requirements.get(reviewedSlot.requirement_id);
    const demandedRequirement = required.get(key);
    const expectedTerrainRole = selection.usage_kind === 'terrain-material'
      ? worldMaterialRoleForProfile(confirmed.layout.profile, selection.usage_id)
      : undefined;
    if (
      slotRequirement === undefined
      || (selection.usage_kind === 'terrain-material'
        ? slotRequirement.category !== 'terrain'
          || expectedTerrainRole === undefined
          || reviewedSlot.role !== expectedTerrainRole
        : demandedRequirement === null
          || demandedRequirement === undefined
          || reviewedSlot.requirement_id !== demandedRequirement.requirement_id)
    ) {
      fail(
        'world-art-variant-map.invalid-selection',
        `Selection ${selection.usage_kind}/${selection.usage_id} uses an incompatible slot.`,
      );
    }
    return bindingFromReviewed(
      selection.usage_kind,
      selection.usage_id,
      reviewedSlot,
    );
  });
  return Object.freeze(bindings);
}

function landmarkBindings(
  confirmed: ConfirmedInputs,
): readonly WorldArtVariantBinding[] {
  const requirements = confirmed.requirements.requirements.filter((requirement) =>
    requirement.binding.role === 'structure.landmark');
  if (requirements.length !== 1) {
    fail(
      'world-art-variant-map.invalid-binding',
      'Exactly one structure.landmark requirement is required.',
    );
  }
  const requirement = requirements[0];
  const variants = requirement.variants.filter(({ identity_kind: kind }) =>
    kind === 'layout-landmark');
  if (
    variants.length !== confirmed.layout.landmarks.length
    || variants.length !== requirement.variants.length
  ) {
    fail(
      'world-art-variant-map.invalid-binding',
      'Layout landmarks and landmark variants must have equal cardinality.',
    );
  }
  const reviewedByVariant = new Map(confirmed.inventory.slots
    .filter(({ requirement_id: requirementId }) =>
      requirementId === requirement.requirement_id)
    .map((slot) => [slot.variant_id, slot]));
  return Object.freeze(confirmed.layout.landmarks.map((landmark, index) => {
    const variant = variants[index];
    const reviewed = reviewedByVariant.get(variant.variant_id);
    if (reviewed === undefined) {
      fail(
        'world-art-variant-map.invalid-binding',
        `Layout landmark ${landmark.id} has no reviewed production-art variant.`,
      );
    }
    return bindingFromReviewed('landmark', landmark.id, reviewed);
  }));
}

function sortBindings(
  bindings: readonly WorldArtVariantBinding[],
): readonly WorldArtVariantBinding[] {
  return Object.freeze([...bindings].sort((left, right) =>
    USAGE_ORDER[left.usage_kind] - USAGE_ORDER[right.usage_kind]
    || left.usage_id.localeCompare(right.usage_id)
    || left.slot_id.localeCompare(right.slot_id)));
}

async function confirmedInputs(input: WorldArtVariantMapInput): Promise<ConfirmedInputs> {
  try {
    const layout = await materializeWorldLayoutPlan(input.layout_plan);
    const requirements = await materializeAssetRequirementsV1_1(input.asset_requirements);
    const plan = await materializeProductionArtPlanV1_1(
      input.production_art_plan,
      requirements,
    );
    const layoutSha256 = await fingerprintWorldLayoutPlan(layout);
    const planSha256 = await fingerprintProductionArtPlanV1_1(plan, requirements);
    if (
      requirements.profile !== layout.profile
      || plan.profile !== layout.profile
      || requirements.source.layout_plan_sha256 !== layoutSha256
    ) {
      fail(
        'world-art-variant-map.invalid-source',
        'Layout, requirements, and ProductionArtPlan 1.1 are not source-bound.',
      );
    }
    const inventory = materializeReviewedInventory(
      input.reviewed_slot_inventory,
      plan,
      planSha256,
    );
    return Object.freeze({
      layout,
      requirements,
      plan,
      layoutSha256,
      planSha256,
      inventory,
      inventorySha256: await sha256(inventory),
      selections: materializeSelections(input.selections),
    });
  } catch (error) {
    if (error instanceof WorldArtVariantMapError) throw error;
    fail(
      'world-art-variant-map.invalid-source',
      `World art inputs are invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

export async function buildWorldArtVariantMap(
  input: WorldArtVariantMapInput,
): Promise<WorldArtVariantMap> {
  const confirmed = await confirmedInputs(input);
  const bindings = sortBindings([
    ...selectedBindings(confirmed),
    ...landmarkBindings(confirmed),
  ]);
  const source = Object.freeze({
    layout_plan_id: confirmed.layout.plan_id,
    layout_plan_sha256: confirmed.layoutSha256,
    production_art_plan_id: confirmed.plan.plan_id,
    production_art_plan_sha256: confirmed.planSha256,
    reviewed_slot_inventory_sha256: confirmed.inventorySha256,
    review_record_sha256: confirmed.inventory.review_record_sha256,
  });
  const identity = {
    profile: confirmed.layout.profile,
    source,
    bindings,
  };
  return Object.freeze({
    schema_version: WORLD_ART_VARIANT_MAP_VERSION,
    document_type: 'world-art-variant-map',
    map_id: `world-art-variant-map-${(await sha256(identity)).slice(0, 16)}`,
    profile: confirmed.layout.profile,
    source,
    bindings,
  });
}

export async function validateWorldArtVariantMap(
  value: unknown,
  input: WorldArtVariantMapInput,
): Promise<WorldArtVariantMap> {
  if (!isRecord(value)) {
    fail('world-art-variant-map.invalid-shape', 'World art variant map must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'map_id',
    'profile',
    'source',
    'bindings',
  ], 'World art variant map');
  if (
    value.schema_version !== WORLD_ART_VARIANT_MAP_VERSION
    || value.document_type !== 'world-art-variant-map'
    || !isWorldAssetProfile(value.profile)
    || !isRecord(value.source)
    || !Array.isArray(value.bindings)
  ) {
    fail('world-art-variant-map.invalid-value', 'World art variant map identity is invalid.');
  }
  exactKeys(value.source, [
    'layout_plan_id',
    'layout_plan_sha256',
    'production_art_plan_id',
    'production_art_plan_sha256',
    'reviewed_slot_inventory_sha256',
    'review_record_sha256',
  ], 'World art variant map source');
  safeId(value.map_id, 'World art variant map id', 100);
  safeId(value.source.layout_plan_id, 'World art layout plan id', 100);
  digest(value.source.layout_plan_sha256, 'World art layout plan digest');
  safeId(value.source.production_art_plan_id, 'World art production plan id', 100);
  digest(value.source.production_art_plan_sha256, 'World art production plan digest');
  digest(value.source.reviewed_slot_inventory_sha256, 'Reviewed slot inventory digest');
  digest(value.source.review_record_sha256, 'Review record digest');
  value.bindings.forEach((binding, index) => {
    if (!isRecord(binding)) {
      fail('world-art-variant-map.invalid-shape', `Binding ${index} must be an object.`);
    }
    exactKeys(binding, [
      'usage_kind',
      'usage_id',
      'slot_id',
      'role',
      'variant_id',
      'atlas_path',
      'atlas_cell',
    ], `Binding ${index}`);
    if (!Object.hasOwn(USAGE_ORDER, String(binding.usage_kind))) {
      fail('world-art-variant-map.invalid-value', `Binding ${index} usage kind is invalid.`);
    }
    safeId(binding.usage_id, `Binding ${index} usage id`);
    safeId(binding.slot_id, `Binding ${index} slot id`);
    role(binding.role, `Binding ${index} role`);
    safeId(binding.variant_id, `Binding ${index} variant id`);
    portableAtlasPath(binding.atlas_path);
    materializeAtlasCell(binding.atlas_cell, `Binding ${index} atlas cell`);
  });
  const expected = await buildWorldArtVariantMap(input);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(
      'world-art-variant-map.invalid-binding',
      'World art variant map does not match its confirmed layout, plan, review, and selections.',
    );
  }
  return expected;
}

export const materializeWorldArtVariantMap = validateWorldArtVariantMap;

export async function fingerprintWorldArtVariantMap(
  value: unknown,
  input: WorldArtVariantMapInput,
): Promise<string> {
  return sha256(await validateWorldArtVariantMap(value, input));
}

export async function serializeCanonicalWorldArtVariantMap(
  value: unknown,
  input: WorldArtVariantMapInput,
): Promise<Uint8Array> {
  const map = await validateWorldArtVariantMap(value, input);
  return new TextEncoder().encode(`${canonicalJson(map)}\n`);
}
