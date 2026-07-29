import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  fingerprintAssetRequirementsV1_1,
  materializeAssetRequirementsV1_1,
  type AssetRequirementsV1_1,
} from './asset-requirements-v1-1';
import {
  fingerprintProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
  type ProductionArtSlotMappingV1_1,
  type ProductionArtTaskV1_1,
} from './production-art-contract-v1-1';
import type {
  ReviewedWorldArtSlotInventory,
  WorldArtAtlasCell,
} from './world-art-variant-map';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from './world-layout-plan';
import {
  fingerprintWorldVisualPlacementPlan,
  materializeWorldVisualPlacementPlan,
  type WorldVisualPlacementPlan,
} from './world-visual-placement-plan';

export const WORLD_ART_PLACEMENT_MAP_VERSION = '1.0.0' as const;

export interface WorldArtPlacementBinding {
  readonly placement_id: string;
  readonly task_id: string;
  readonly slot_id: string;
  readonly requirement_id: string;
  readonly role: string;
  readonly variant_id: string;
  readonly atlas_path: string;
  readonly atlas_cell: WorldArtAtlasCell;
}

export interface WorldArtPlacementMap {
  readonly schema_version: typeof WORLD_ART_PLACEMENT_MAP_VERSION;
  readonly document_type: 'world-art-placement-map';
  readonly map_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    layout_plan_id: string;
    layout_plan_sha256: string;
    placement_plan_id: string;
    placement_plan_sha256: string;
    requirements_sha256: string;
    production_art_plan_id: string;
    production_art_plan_sha256: string;
    reviewed_slot_inventory_sha256: string;
    review_record_sha256: string;
  }>;
  readonly bindings: readonly WorldArtPlacementBinding[];
}

export interface WorldArtPlacementMapInput {
  readonly layout_plan: unknown;
  readonly placement_plan: unknown;
  readonly asset_requirements: unknown;
  readonly production_art_plan: unknown;
  readonly reviewed_slot_inventory: unknown;
}

export type WorldArtPlacementMapErrorCode =
  | 'world-art-placement-map.invalid-shape'
  | 'world-art-placement-map.invalid-value'
  | 'world-art-placement-map.invalid-source'
  | 'world-art-placement-map.invalid-inventory'
  | 'world-art-placement-map.invalid-binding'
  | 'world-art-placement-map.invalid-order'
  | 'world-art-placement-map.private-path';

export class WorldArtPlacementMapError extends Error {
  constructor(readonly code: WorldArtPlacementMapErrorCode, message: string) {
    super(message);
    this.name = 'WorldArtPlacementMapError';
  }
}

type DataRecord = Record<string, unknown>;
type ConfirmedInputs = Readonly<{
  layout: WorldLayoutPlan;
  placementPlan: WorldVisualPlacementPlan;
  requirements: AssetRequirementsV1_1;
  productionPlan: ProductionArtPlanV1_1;
  inventory: ReviewedWorldArtSlotInventory;
  layoutSha256: string;
  placementPlanSha256: string;
  requirementsSha256: string;
  productionPlanSha256: string;
  inventorySha256: string;
}>;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_ROLE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SAFE_PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const MAP_ID = /^world-art-placement-map-[a-f0-9]{16}$/;

function fail(code: WorldArtPlacementMapErrorCode, message: string): never {
  throw new WorldArtPlacementMapError(code, message);
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
      'world-art-placement-map.invalid-shape',
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
    fail('world-art-placement-map.invalid-value', `${label} must be a safe identifier.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('world-art-placement-map.invalid-value', `${label} must be SHA-256.`);
  }
  return value;
}

function role(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 120 || !SAFE_ROLE.test(value)) {
    fail('world-art-placement-map.invalid-value', `${label} must be a safe role.`);
  }
  return value;
}

function portablePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.includes('\\')
    || value.startsWith('/')
    || value.split('/').some((segment) =>
      segment === '.'
      || segment === '..'
      || !SAFE_PATH_SEGMENT.test(segment))
    || /(^|\/)(?:private|references?|uploads?|source-images?)(?:\/|$)/i.test(value)
  ) {
    fail('world-art-placement-map.private-path', `${label} is not a portable reviewed path.`);
  }
  return value;
}

function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = 255,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('world-art-placement-map.invalid-value', `${label} is invalid.`);
  }
  return value as number;
}

function materializeCell(value: unknown, label: string): WorldArtAtlasCell {
  if (!isRecord(value)) {
    fail('world-art-placement-map.invalid-shape', `${label} must be an object.`);
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
      fail('world-art-placement-map.invalid-value', 'Map contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('world-art-placement-map.invalid-value', 'Map contains an unsupported value.');
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

function taskSlots(
  plan: ProductionArtPlanV1_1,
): readonly Readonly<{
  task: ProductionArtTaskV1_1;
  slot: ProductionArtSlotMappingV1_1;
}>[] {
  return Object.freeze(plan.tasks.flatMap((task) =>
    task.slot_mappings.map((slot) => Object.freeze({ task, slot }))));
}

function materializeInventorySlot(
  value: unknown,
  index: number,
): ReviewedWorldArtSlotInventory['slots'][number] {
  if (!isRecord(value)) {
    fail('world-art-placement-map.invalid-shape', `Inventory slot ${index} must be an object.`);
  }
  exactKeys(value, [
    'slot_id',
    'requirement_id',
    'role',
    'variant_id',
    'atlas_path',
    'atlas_cell',
  ], `Inventory slot ${index}`);
  return Object.freeze({
    slot_id: safeId(value.slot_id, `Inventory slot ${index} id`),
    requirement_id: safeId(value.requirement_id, `Inventory slot ${index} requirement id`),
    role: role(value.role, `Inventory slot ${index} role`),
    variant_id: safeId(value.variant_id, `Inventory slot ${index} variant id`),
    atlas_path: portablePath(value.atlas_path, `Inventory slot ${index} atlas path`),
    atlas_cell: materializeCell(value.atlas_cell, `Inventory slot ${index} atlas cell`),
  });
}

function materializeInventory(
  value: unknown,
  profile: WorldAssetProfile,
  plan: ProductionArtPlanV1_1,
  planSha256: string,
): ReviewedWorldArtSlotInventory {
  if (!isRecord(value)) {
    fail('world-art-placement-map.invalid-shape', 'Reviewed slot inventory must be an object.');
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
    value.schema_version !== '1.0.0'
    || value.document_type !== 'reviewed-world-art-slot-inventory'
    || value.profile !== profile
    || value.production_art_plan_id !== plan.plan_id
    || value.production_art_plan_sha256 !== planSha256
    || value.review_status !== 'pass'
    || !Array.isArray(value.slots)
  ) {
    fail(
      'world-art-placement-map.invalid-inventory',
      'Reviewed slot inventory identity does not match the production plan.',
    );
  }
  const slots = value.slots.map(materializeInventorySlot);
  if (
    slots.length < 1
    || new Set(slots.map(({ slot_id: slotId }) => slotId)).size !== slots.length
  ) {
    fail(
      'world-art-placement-map.invalid-order',
      'Reviewed inventory slots must be unique.',
    );
  }
  const expected = taskSlots(plan);
  const expectedBySlot = new Map(expected.map((planned) => [
    planned.slot.slot_id,
    planned,
  ]));
  if (
    slots.length !== expected.length
    || slots.some((slot) => {
      const planned = expectedBySlot.get(slot.slot_id);
      return !planned
        || slot.requirement_id !== planned.slot.requirement_id
        || slot.role !== planned.slot.role
        || slot.variant_id !== planned.slot.variant_id
        || slot.atlas_path !== planned.task.expected_output_path
        || canonicalJson(slot.atlas_cell) !== canonicalJson(planned.slot.grid_rect);
    })
  ) {
    fail(
      'world-art-placement-map.invalid-inventory',
      'Reviewed inventory must exactly cover every production plan slot.',
    );
  }
  return Object.freeze({
    schema_version: '1.0.0' as const,
    document_type: 'reviewed-world-art-slot-inventory' as const,
    profile,
    production_art_plan_id: plan.plan_id,
    production_art_plan_sha256: planSha256,
    review_record_sha256: digest(value.review_record_sha256, 'Review record SHA-256'),
    review_status: 'pass' as const,
    slots: Object.freeze(slots),
  });
}

async function confirmedInputs(input: WorldArtPlacementMapInput): Promise<ConfirmedInputs> {
  try {
    const layout = await materializeWorldLayoutPlan(input.layout_plan);
    const requirements = await materializeAssetRequirementsV1_1(input.asset_requirements);
    const productionPlan = await materializeProductionArtPlanV1_1(
      input.production_art_plan,
      requirements,
    );
    const [layoutSha256, requirementsSha256, productionPlanSha256] = await Promise.all([
      fingerprintWorldLayoutPlan(layout),
      fingerprintAssetRequirementsV1_1(requirements),
      fingerprintProductionArtPlanV1_1(productionPlan, requirements),
    ]);
    const placementPlan = await materializeWorldVisualPlacementPlan(
      input.placement_plan,
      layout,
    );
    const placementPlanSha256 = await fingerprintWorldVisualPlacementPlan(
      placementPlan,
      layout,
    );
    if (
      requirements.profile !== layout.profile
      || productionPlan.profile !== layout.profile
      || placementPlan.profile !== layout.profile
      || requirements.source.layout_plan_sha256 !== layoutSha256
    ) {
      fail(
        'world-art-placement-map.invalid-source',
        'Layout, placement plan, requirements, and production plan are not source-bound.',
      );
    }
    const inventory = materializeInventory(
      input.reviewed_slot_inventory,
      layout.profile,
      productionPlan,
      productionPlanSha256,
    );
    return Object.freeze({
      layout,
      placementPlan,
      requirements,
      productionPlan,
      inventory,
      layoutSha256,
      placementPlanSha256,
      requirementsSha256,
      productionPlanSha256,
      inventorySha256: await sha256(inventory),
    });
  } catch (error) {
    if (error instanceof WorldArtPlacementMapError) throw error;
    fail(
      'world-art-placement-map.invalid-source',
      `World art placement inputs are invalid: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}

function bindingsFor(confirmed: ConfirmedInputs): readonly WorldArtPlacementBinding[] {
  const taskSlotById = new Map(taskSlots(confirmed.productionPlan).map(({ task, slot }) => [
    slot.slot_id,
    { task, slot },
  ]));
  const inventoryByRoleVariant = new Map<string, ReviewedWorldArtSlotInventory['slots'][number]>();
  for (const slot of confirmed.inventory.slots) {
    const key = `${slot.role}\0${slot.variant_id}`;
    if (inventoryByRoleVariant.has(key)) {
      fail(
        'world-art-placement-map.invalid-inventory',
        `Reviewed role variant ${slot.role}/${slot.variant_id} is ambiguous.`,
      );
    }
    inventoryByRoleVariant.set(key, slot);
  }
  return Object.freeze(confirmed.placementPlan.placements.map((placement) => {
    const variantId = placement.variant_id ?? 'canonical';
    const slot = inventoryByRoleVariant.get(`${placement.role}\0${variantId}`);
    const planned = slot === undefined ? undefined : taskSlotById.get(slot.slot_id);
    if (
      !slot
      || !planned
      || planned.slot.role !== placement.role
      || planned.slot.variant_id !== variantId
    ) {
      fail(
        'world-art-placement-map.invalid-binding',
        `Placement ${placement.placement_id} has no exact reviewed role variant.`,
      );
    }
    return Object.freeze({
      placement_id: placement.placement_id,
      task_id: planned.task.task_id,
      slot_id: slot.slot_id,
      requirement_id: slot.requirement_id,
      role: slot.role,
      variant_id: slot.variant_id,
      atlas_path: slot.atlas_path,
      atlas_cell: slot.atlas_cell,
    });
  }));
}

function sourceOf(confirmed: ConfirmedInputs): WorldArtPlacementMap['source'] {
  return Object.freeze({
    layout_plan_id: confirmed.layout.plan_id,
    layout_plan_sha256: confirmed.layoutSha256,
    placement_plan_id: confirmed.placementPlan.plan_id,
    placement_plan_sha256: confirmed.placementPlanSha256,
    requirements_sha256: confirmed.requirementsSha256,
    production_art_plan_id: confirmed.productionPlan.plan_id,
    production_art_plan_sha256: confirmed.productionPlanSha256,
    reviewed_slot_inventory_sha256: confirmed.inventorySha256,
    review_record_sha256: confirmed.inventory.review_record_sha256,
  });
}

async function expectedMap(confirmed: ConfirmedInputs): Promise<WorldArtPlacementMap> {
  const source = sourceOf(confirmed);
  const bindings = bindingsFor(confirmed);
  const identity = Object.freeze({
    profile: confirmed.layout.profile,
    source,
    bindings,
  });
  return Object.freeze({
    schema_version: WORLD_ART_PLACEMENT_MAP_VERSION,
    document_type: 'world-art-placement-map' as const,
    map_id: `world-art-placement-map-${(await sha256(identity)).slice(0, 16)}`,
    profile: confirmed.layout.profile,
    source,
    bindings,
  });
}

export async function buildWorldArtPlacementMap(
  input: WorldArtPlacementMapInput,
): Promise<WorldArtPlacementMap> {
  return expectedMap(await confirmedInputs(input));
}

function materializeBinding(value: unknown, index: number): WorldArtPlacementBinding {
  if (!isRecord(value)) {
    fail('world-art-placement-map.invalid-shape', `Placement binding ${index} must be an object.`);
  }
  exactKeys(value, [
    'placement_id',
    'task_id',
    'slot_id',
    'requirement_id',
    'role',
    'variant_id',
    'atlas_path',
    'atlas_cell',
  ], `Placement binding ${index}`);
  return Object.freeze({
    placement_id: safeId(value.placement_id, `Placement binding ${index} placement id`),
    task_id: safeId(value.task_id, `Placement binding ${index} task id`),
    slot_id: safeId(value.slot_id, `Placement binding ${index} slot id`),
    requirement_id: safeId(
      value.requirement_id,
      `Placement binding ${index} requirement id`,
    ),
    role: role(value.role, `Placement binding ${index} role`),
    variant_id: safeId(value.variant_id, `Placement binding ${index} variant id`),
    atlas_path: portablePath(value.atlas_path, `Placement binding ${index} atlas path`),
    atlas_cell: materializeCell(value.atlas_cell, `Placement binding ${index} atlas cell`),
  });
}

export async function materializeWorldArtPlacementMap(
  value: unknown,
  input: WorldArtPlacementMapInput,
): Promise<WorldArtPlacementMap> {
  const envelope = await materializeWorldArtPlacementMapEnvelope(value);
  const expected = await expectedMap(await confirmedInputs(input));
  if (canonicalJson(envelope) !== canonicalJson(expected)) {
    fail(
      'world-art-placement-map.invalid-binding',
      'World art placement map does not match its layout, placement plan, production plan, and review.',
    );
  }
  return expected;
}

/**
 * Validates the portable map envelope and its derived identity without
 * requiring private/admission-side production inputs. Runtime archive readers
 * must additionally cross-bind it to the packaged placement plan and runtime
 * asset catalog.
 */
export async function materializeWorldArtPlacementMapEnvelope(
  value: unknown,
): Promise<WorldArtPlacementMap> {
  if (!isRecord(value)) {
    fail('world-art-placement-map.invalid-shape', 'World art placement map must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'map_id',
    'profile',
    'source',
    'bindings',
  ], 'World art placement map');
  if (
    value.schema_version !== WORLD_ART_PLACEMENT_MAP_VERSION
    || value.document_type !== 'world-art-placement-map'
    || typeof value.map_id !== 'string'
    || !MAP_ID.test(value.map_id)
    || !isWorldAssetProfile(value.profile)
    || !isRecord(value.source)
    || !Array.isArray(value.bindings)
    || value.bindings.length < 1
    || value.bindings.length > 2048
  ) {
    fail('world-art-placement-map.invalid-value', 'World art placement map identity is invalid.');
  }
  exactKeys(value.source, [
    'layout_plan_id',
    'layout_plan_sha256',
    'placement_plan_id',
    'placement_plan_sha256',
    'requirements_sha256',
    'production_art_plan_id',
    'production_art_plan_sha256',
    'reviewed_slot_inventory_sha256',
    'review_record_sha256',
  ], 'World art placement map source');
  safeId(value.source.layout_plan_id, 'Placement map layout plan id');
  digest(value.source.layout_plan_sha256, 'Placement map layout plan SHA-256');
  safeId(value.source.placement_plan_id, 'Placement plan id');
  digest(value.source.placement_plan_sha256, 'Placement plan SHA-256');
  digest(value.source.requirements_sha256, 'Placement requirements SHA-256');
  safeId(value.source.production_art_plan_id, 'Placement production plan id');
  digest(value.source.production_art_plan_sha256, 'Placement production plan SHA-256');
  digest(value.source.reviewed_slot_inventory_sha256, 'Placement inventory SHA-256');
  digest(value.source.review_record_sha256, 'Placement review record SHA-256');
  const bindings = value.bindings.map(materializeBinding);
  if (
    new Set(bindings.map(({ placement_id: placementId }) => placementId)).size
      !== bindings.length
  ) {
    fail(
      'world-art-placement-map.invalid-order',
      'Placement bindings must have unique placement ids.',
    );
  }
  const source = Object.freeze({
    layout_plan_id: safeId(value.source.layout_plan_id, 'Placement map layout plan id'),
    layout_plan_sha256: digest(
      value.source.layout_plan_sha256,
      'Placement map layout plan SHA-256',
    ),
    placement_plan_id: safeId(value.source.placement_plan_id, 'Placement plan id'),
    placement_plan_sha256: digest(
      value.source.placement_plan_sha256,
      'Placement plan SHA-256',
    ),
    requirements_sha256: digest(
      value.source.requirements_sha256,
      'Placement requirements SHA-256',
    ),
    production_art_plan_id: safeId(
      value.source.production_art_plan_id,
      'Placement production plan id',
    ),
    production_art_plan_sha256: digest(
      value.source.production_art_plan_sha256,
      'Placement production plan SHA-256',
    ),
    reviewed_slot_inventory_sha256: digest(
      value.source.reviewed_slot_inventory_sha256,
      'Placement inventory SHA-256',
    ),
    review_record_sha256: digest(
      value.source.review_record_sha256,
      'Placement review record SHA-256',
    ),
  });
  const map = Object.freeze({
    schema_version: WORLD_ART_PLACEMENT_MAP_VERSION,
    document_type: 'world-art-placement-map' as const,
    map_id: value.map_id,
    profile: value.profile,
    source,
    bindings: Object.freeze(bindings),
  });
  const expectedId = `world-art-placement-map-${(await sha256({
    profile: map.profile,
    source: map.source,
    bindings: map.bindings,
  })).slice(0, 16)}`;
  if (map.map_id !== expectedId) {
    fail(
      'world-art-placement-map.invalid-binding',
      'World art placement map id does not match its canonical payload.',
    );
  }
  return map;
}

export async function fingerprintWorldArtPlacementMap(
  value: unknown,
  input: WorldArtPlacementMapInput,
): Promise<string> {
  return sha256(await materializeWorldArtPlacementMap(value, input));
}

export async function fingerprintWorldArtPlacementMapEnvelope(
  value: unknown,
): Promise<string> {
  return sha256(await materializeWorldArtPlacementMapEnvelope(value));
}

export async function serializeCanonicalWorldArtPlacementMap(
  value: unknown,
  input: WorldArtPlacementMapInput,
): Promise<Uint8Array> {
  const map = await materializeWorldArtPlacementMap(value, input);
  return new TextEncoder().encode(`${canonicalJson(map)}\n`);
}

export async function serializeCanonicalWorldArtPlacementMapEnvelope(
  value: unknown,
): Promise<Uint8Array> {
  const map = await materializeWorldArtPlacementMapEnvelope(value);
  return new TextEncoder().encode(`${canonicalJson(map)}\n`);
}
