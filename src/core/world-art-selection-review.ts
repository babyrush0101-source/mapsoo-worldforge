import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  fingerprintAssetRequirementsV1_1,
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
import type { ProductionArtRights } from './production-art-contract';
import {
  fingerprintProductionArtRunSetV1_1,
  materializeProductionArtRunSetV1_1,
  type ProductionArtRunSetV1_1,
} from './production-art-run-set-v1-1';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from './world-layout-plan';
import { worldMaterialRoleForProfile } from './world-material-palette';
import type {
  ReviewedWorldArtSlotInventory,
  WorldArtAtlasCell,
  WorldArtVariantSelection,
} from './world-art-variant-map';

export const WORLD_ART_SELECTION_REVIEW_VERSION = '1.0.0' as const;

export type WorldArtSelectionReviewStatus = 'pending' | 'pass';
export type WorldArtSlotReviewDecision = 'pending' | 'approved' | 'rejected';

export interface WorldArtSelectionReviewSource {
  readonly layout_plan_id: string;
  readonly layout_plan_sha256: string;
  readonly requirements_id: string;
  readonly requirements_sha256: string;
  readonly production_art_plan_id: string;
  readonly production_art_plan_sha256: string;
  readonly run_set_sha256: string;
}

export interface WorldArtSelectionReviewSlot {
  readonly slot_id: string;
  readonly requirement_id: string;
  readonly role: string;
  readonly variant_id: string;
  readonly atlas_cell: WorldArtAtlasCell;
  readonly decision: WorldArtSlotReviewDecision;
}

export interface WorldArtSelectionReviewTask {
  readonly task_id: string;
  readonly output_path: string;
  readonly artifact_sha256: string;
  readonly output_sha256: string;
  readonly slots: readonly WorldArtSelectionReviewSlot[];
}

export interface WorldArtSelectionReviewDeclarations {
  readonly visual_quality_approved: boolean;
  readonly atlas_integrity_approved: boolean;
  readonly rights_and_redistribution_approved: boolean;
}

export interface WorldArtSelectionReview {
  readonly schema_version: typeof WORLD_ART_SELECTION_REVIEW_VERSION;
  readonly document_type: 'world-art-selection-review';
  readonly review_id: string;
  readonly profile: WorldAssetProfile;
  readonly review_status: WorldArtSelectionReviewStatus;
  readonly source: WorldArtSelectionReviewSource;
  readonly rights: ProductionArtRights;
  readonly declarations: WorldArtSelectionReviewDeclarations;
  readonly tasks: readonly WorldArtSelectionReviewTask[];
  readonly selections: readonly WorldArtVariantSelection[];
}

export interface WorldArtSelectionReviewInput {
  readonly layout_plan: unknown;
  readonly asset_requirements: unknown;
  readonly production_art_plan: unknown;
  readonly production_art_run_set: unknown;
}

export interface PassedWorldArtSelectionReview {
  readonly review: WorldArtSelectionReview & Readonly<{ review_status: 'pass' }>;
  readonly review_record_sha256: string;
  readonly reviewed_slot_inventory: ReviewedWorldArtSlotInventory;
  readonly selections: readonly WorldArtVariantSelection[];
}

export type WorldArtSelectionReviewErrorCode =
  | 'world-art-selection-review.invalid-shape'
  | 'world-art-selection-review.invalid-value'
  | 'world-art-selection-review.invalid-source'
  | 'world-art-selection-review.invalid-rights'
  | 'world-art-selection-review.invalid-review'
  | 'world-art-selection-review.invalid-selection';

export class WorldArtSelectionReviewError extends Error {
  constructor(readonly code: WorldArtSelectionReviewErrorCode, message: string) {
    super(message);
    this.name = 'WorldArtSelectionReviewError';
  }
}

type MutableRecord = Record<string, unknown>;

interface ConfirmedInputs {
  readonly layout: WorldLayoutPlan;
  readonly requirements: AssetRequirementsV1_1;
  readonly plan: ProductionArtPlanV1_1;
  readonly runSet: ProductionArtRunSetV1_1;
  readonly source: WorldArtSelectionReviewSource;
}

interface KnownSlot {
  readonly taskId: string;
  readonly outputPath: string;
  readonly slot: ProductionArtSlotMappingV1_1;
  readonly requirement: AssetRequirementV1_1;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_ROLE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SAFE_PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const USAGE_ORDER = Object.freeze({
  'terrain-material': 0,
  hazard: 1,
  character: 2,
} satisfies Readonly<Record<WorldArtVariantSelection['usage_kind'], number>>);

function fail(code: WorldArtSelectionReviewErrorCode, message: string): never {
  throw new WorldArtSelectionReviewError(code, message);
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
      'world-art-selection-review.invalid-shape',
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
    fail(
      'world-art-selection-review.invalid-value',
      `${label} must be lowercase kebab-case.`,
    );
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(
      'world-art-selection-review.invalid-value',
      `${label} must be a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function role(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 120 || !SAFE_ROLE.test(value)) {
    fail('world-art-selection-review.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function portablePngPath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.includes('\\')
    || value.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    fail('world-art-selection-review.invalid-value', `${label} must be a portable path.`);
  }
  const segments = value.split('/');
  if (
    !value.endsWith('.png')
    || segments.some((segment) =>
      segment === '.'
      || segment === '..'
      || !SAFE_PATH_SEGMENT.test(segment))
  ) {
    fail('world-art-selection-review.invalid-value', `${label} must be a portable PNG path.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0, maximum = 256): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('world-art-selection-review.invalid-value', `${label} is invalid.`);
  }
  return value as number;
}

function materializeCell(value: unknown, label: string): WorldArtAtlasCell {
  if (!isRecord(value)) {
    fail('world-art-selection-review.invalid-shape', `${label} must be an object.`);
  }
  exactKeys(value, ['column', 'row', 'column_span', 'row_span'], label);
  return Object.freeze({
    column: integer(value.column, `${label} column`, 0, 255),
    row: integer(value.row, `${label} row`, 0, 255),
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
      fail('world-art-selection-review.invalid-value', 'Review contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('world-art-selection-review.invalid-value', 'Review contains an unsupported value.');
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

function frozenRights(rights: ProductionArtRights): ProductionArtRights {
  return Object.freeze({
    distribution: rights.distribution,
    license: rights.license,
    ...(rights.attribution === undefined ? {} : { attribution: rights.attribution }),
  });
}

function terrainMaterials(layout: WorldLayoutPlan): readonly string[] {
  const terrain = layout.terrain_layout.kind === 'bands'
    ? layout.terrain_layout.bands
    : layout.terrain_layout.zones;
  return Object.freeze(
    [...new Set(terrain.map(({ material }) => material))]
      .sort((left, right) => left.localeCompare(right, 'en')),
  );
}

async function confirmedInputs(input: WorldArtSelectionReviewInput): Promise<ConfirmedInputs> {
  try {
    const layout = await materializeWorldLayoutPlan(input.layout_plan);
    const requirements = await materializeAssetRequirementsV1_1(input.asset_requirements);
    const plan = await materializeProductionArtPlanV1_1(
      input.production_art_plan,
      requirements,
    );
    const runSet = await materializeProductionArtRunSetV1_1(
      input.production_art_run_set,
      plan,
      requirements,
    );
    const [
      layoutSha,
      requirementsSha,
      planSha,
      runSetSha,
    ] = await Promise.all([
      fingerprintWorldLayoutPlan(layout),
      fingerprintAssetRequirementsV1_1(requirements),
      fingerprintProductionArtPlanV1_1(plan, requirements),
      fingerprintProductionArtRunSetV1_1(runSet, plan, requirements),
    ]);
    if (
      layout.profile !== requirements.profile
      || layout.profile !== plan.profile
      || layout.profile !== runSet.profile
      || requirements.source.layout_plan_sha256 !== layoutSha
      || plan.source.requirements_id !== requirements.requirements_id
      || plan.source.requirements_sha256 !== requirementsSha
      || runSet.source.plan_sha256 !== planSha
      || runSet.source.requirements_sha256 !== requirementsSha
    ) {
      fail(
        'world-art-selection-review.invalid-source',
        'Layout, Requirements 1.1, Plan 1.1, and RunSet 1.1 are not canonically source-bound.',
      );
    }
    if (
      canonicalJson(plan.rights) !== canonicalJson(runSet.rights)
    ) {
      fail(
        'world-art-selection-review.invalid-rights',
        'Production art rights drifted between the plan and run-set.',
      );
    }
    return Object.freeze({
      layout,
      requirements,
      plan,
      runSet,
      source: Object.freeze({
        layout_plan_id: layout.plan_id,
        layout_plan_sha256: layoutSha,
        requirements_id: requirements.requirements_id,
        requirements_sha256: requirementsSha,
        production_art_plan_id: plan.plan_id,
        production_art_plan_sha256: planSha,
        run_set_sha256: runSetSha,
      }),
    });
  } catch (error) {
    if (error instanceof WorldArtSelectionReviewError) throw error;
    fail(
      'world-art-selection-review.invalid-source',
      `World art review inputs are invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

function knownSlots(confirmed: ConfirmedInputs): ReadonlyMap<string, KnownSlot> {
  const requirements = new Map(confirmed.requirements.requirements.map((requirement) => [
    requirement.requirement_id,
    requirement,
  ]));
  const result = new Map<string, KnownSlot>();
  for (const task of confirmed.plan.tasks) {
    for (const slot of task.slot_mappings) {
      const requirement = requirements.get(slot.requirement_id);
      if (!requirement || result.has(slot.slot_id)) {
        fail(
          'world-art-selection-review.invalid-source',
          `Plan slot ${slot.slot_id} is duplicated or lacks a canonical requirement.`,
        );
      }
      result.set(slot.slot_id, Object.freeze({
        taskId: task.task_id,
        outputPath: task.expected_output_path,
        slot,
        requirement,
      }));
    }
  }
  return result;
}

function compareSelections(
  left: WorldArtVariantSelection,
  right: WorldArtVariantSelection,
): number {
  return USAGE_ORDER[left.usage_kind] - USAGE_ORDER[right.usage_kind]
    || left.usage_id.localeCompare(right.usage_id, 'en')
    || left.slot_id.localeCompare(right.slot_id, 'en');
}

function recommendedSelections(confirmed: ConfirmedInputs): readonly WorldArtVariantSelection[] {
  const slots = [...knownSlots(confirmed).values()]
    .sort((left, right) => left.slot.slot_id.localeCompare(right.slot.slot_id, 'en'));
  const selections: WorldArtVariantSelection[] = [];
  for (const material of terrainMaterials(confirmed.layout)) {
    const expectedRole = worldMaterialRoleForProfile(confirmed.layout.profile, material);
    const selected = slots.find(({ requirement, slot }) =>
      requirement.category === 'terrain'
      && slot.role === expectedRole
      && slot.variant_id === 'canonical')
      ?? slots.find(({ requirement, slot }) =>
        requirement.category === 'terrain' && slot.role === expectedRole);
    if (!expectedRole || !selected) {
      fail(
        'world-art-selection-review.invalid-selection',
        `No canonical reviewed slot can represent terrain material ${material}.`,
      );
    }
    selections.push(Object.freeze({
      usage_kind: 'terrain-material',
      usage_id: material,
      slot_id: selected.slot.slot_id,
    }));
  }
  for (const requirement of confirmed.requirements.requirements) {
    if (requirement.category !== 'hazard' && requirement.category !== 'character') continue;
    const selected = slots.find(({ slot }) =>
      slot.requirement_id === requirement.requirement_id
      && slot.variant_id === 'canonical')
      ?? slots.find(({ slot }) => slot.requirement_id === requirement.requirement_id);
    if (!selected) {
      fail(
        'world-art-selection-review.invalid-selection',
        `No production-art slot exists for ${requirement.requirement_id}.`,
      );
    }
    selections.push(Object.freeze({
      usage_kind: requirement.category,
      usage_id: requirement.requirement_id,
      slot_id: selected.slot.slot_id,
    }));
  }
  return Object.freeze(selections.sort(compareSelections));
}

function reviewTasks(
  confirmed: ConfirmedInputs,
  decision: WorldArtSlotReviewDecision,
): readonly WorldArtSelectionReviewTask[] {
  const runByTask = new Map(confirmed.runSet.runs.map((run) => [run.task_id, run]));
  return Object.freeze([...confirmed.plan.tasks]
    .sort((left, right) => left.task_id.localeCompare(right.task_id, 'en'))
    .map((task) => {
      const run = runByTask.get(task.task_id);
      if (!run) {
        fail(
          'world-art-selection-review.invalid-source',
          `Run-set lacks task ${task.task_id}.`,
        );
      }
      return Object.freeze({
        task_id: task.task_id,
        output_path: task.expected_output_path,
        artifact_sha256: run.evidence.sha256,
        output_sha256: run.evidence.output_sha256,
        slots: Object.freeze([...task.slot_mappings]
          .sort((left, right) => left.slot_id.localeCompare(right.slot_id, 'en'))
          .map((slot) => Object.freeze({
            slot_id: slot.slot_id,
            requirement_id: slot.requirement_id,
            role: slot.role,
            variant_id: slot.variant_id,
            atlas_cell: Object.freeze({ ...slot.grid_rect }),
            decision,
          }))),
      });
    }));
}

async function expectedPendingReview(
  confirmed: ConfirmedInputs,
): Promise<WorldArtSelectionReview> {
  const identity = Object.freeze({
    profile: confirmed.layout.profile,
    source: confirmed.source,
  });
  return Object.freeze({
    schema_version: WORLD_ART_SELECTION_REVIEW_VERSION,
    document_type: 'world-art-selection-review' as const,
    review_id: `world-art-selection-review-${(await sha256(identity)).slice(0, 16)}`,
    profile: confirmed.layout.profile,
    review_status: 'pending' as const,
    source: confirmed.source,
    rights: frozenRights(confirmed.plan.rights),
    declarations: Object.freeze({
      visual_quality_approved: false,
      atlas_integrity_approved: false,
      rights_and_redistribution_approved: false,
    }),
    tasks: reviewTasks(confirmed, 'pending'),
    selections: recommendedSelections(confirmed),
  });
}

function materializeSource(value: unknown): WorldArtSelectionReviewSource {
  if (!isRecord(value)) {
    fail('world-art-selection-review.invalid-shape', 'Review source must be an object.');
  }
  exactKeys(value, [
    'layout_plan_id',
    'layout_plan_sha256',
    'requirements_id',
    'requirements_sha256',
    'production_art_plan_id',
    'production_art_plan_sha256',
    'run_set_sha256',
  ], 'Review source');
  return Object.freeze({
    layout_plan_id: safeId(value.layout_plan_id, 'Layout plan id', 100),
    layout_plan_sha256: digest(value.layout_plan_sha256, 'Layout plan digest'),
    requirements_id: safeId(value.requirements_id, 'Requirements id', 100),
    requirements_sha256: digest(value.requirements_sha256, 'Requirements digest'),
    production_art_plan_id: safeId(value.production_art_plan_id, 'Production plan id', 100),
    production_art_plan_sha256: digest(
      value.production_art_plan_sha256,
      'Production plan digest',
    ),
    run_set_sha256: digest(value.run_set_sha256, 'Run-set digest'),
  });
}

function materializeRights(value: unknown): ProductionArtRights {
  if (!isRecord(value)) {
    fail('world-art-selection-review.invalid-shape', 'Review rights must be an object.');
  }
  exactKeys(
    value,
    value.attribution === undefined
      ? ['distribution', 'license']
      : ['distribution', 'license', 'attribution'],
    'Review rights',
  );
  if (
    !['private', 'internal-review', 'public'].includes(String(value.distribution))
    || !['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'LicenseRef-Proprietary']
      .includes(String(value.license))
    || (value.attribution !== undefined && (
      typeof value.attribution !== 'string'
      || value.attribution.length < 1
      || value.attribution.length > 500
      || value.attribution.trim() !== value.attribution
    ))
  ) {
    fail('world-art-selection-review.invalid-rights', 'Review rights are invalid.');
  }
  return Object.freeze({
    distribution: value.distribution as ProductionArtRights['distribution'],
    license: value.license as ProductionArtRights['license'],
    ...(value.attribution === undefined ? {} : { attribution: value.attribution as string }),
  });
}

function materializeDeclarations(value: unknown): WorldArtSelectionReviewDeclarations {
  if (!isRecord(value)) {
    fail('world-art-selection-review.invalid-shape', 'Review declarations must be an object.');
  }
  exactKeys(value, [
    'visual_quality_approved',
    'atlas_integrity_approved',
    'rights_and_redistribution_approved',
  ], 'Review declarations');
  if (
    typeof value.visual_quality_approved !== 'boolean'
    || typeof value.atlas_integrity_approved !== 'boolean'
    || typeof value.rights_and_redistribution_approved !== 'boolean'
  ) {
    fail('world-art-selection-review.invalid-review', 'Review declarations must be booleans.');
  }
  return Object.freeze({
    visual_quality_approved: value.visual_quality_approved,
    atlas_integrity_approved: value.atlas_integrity_approved,
    rights_and_redistribution_approved: value.rights_and_redistribution_approved,
  });
}

function materializeTasks(value: unknown): readonly WorldArtSelectionReviewTask[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    fail('world-art-selection-review.invalid-review', 'Review requires 1 to 256 tasks.');
  }
  const tasks = Object.freeze(value.map((candidate, taskIndex) => {
    if (!isRecord(candidate)) {
      fail('world-art-selection-review.invalid-shape', `Review task ${taskIndex} must be an object.`);
    }
    exactKeys(candidate, [
      'task_id',
      'output_path',
      'artifact_sha256',
      'output_sha256',
      'slots',
    ], `Review task ${taskIndex}`);
    if (!Array.isArray(candidate.slots) || candidate.slots.length > 2048) {
      fail('world-art-selection-review.invalid-review', `Review task ${taskIndex} slots are invalid.`);
    }
    const slots = Object.freeze(candidate.slots.map((slotValue, slotIndex) => {
      if (!isRecord(slotValue)) {
        fail(
          'world-art-selection-review.invalid-shape',
          `Review task ${taskIndex} slot ${slotIndex} must be an object.`,
        );
      }
      exactKeys(slotValue, [
        'slot_id',
        'requirement_id',
        'role',
        'variant_id',
        'atlas_cell',
        'decision',
      ], `Review task ${taskIndex} slot ${slotIndex}`);
      if (!['pending', 'approved', 'rejected'].includes(String(slotValue.decision))) {
        fail(
          'world-art-selection-review.invalid-review',
          `Review task ${taskIndex} slot ${slotIndex} decision is invalid.`,
        );
      }
      return Object.freeze({
        slot_id: safeId(slotValue.slot_id, `Review slot ${slotIndex} id`),
        requirement_id: safeId(
          slotValue.requirement_id,
          `Review slot ${slotIndex} requirement id`,
        ),
        role: role(slotValue.role, `Review slot ${slotIndex} role`),
        variant_id: safeId(slotValue.variant_id, `Review slot ${slotIndex} variant id`),
        atlas_cell: materializeCell(
          slotValue.atlas_cell,
          `Review task ${taskIndex} slot ${slotIndex} cell`,
        ),
        decision: slotValue.decision as WorldArtSlotReviewDecision,
      });
    }));
    if (slots.some((slot, index) =>
      index > 0 && slots[index - 1]!.slot_id.localeCompare(slot.slot_id, 'en') >= 0)) {
      fail(
        'world-art-selection-review.invalid-review',
        `Review task ${taskIndex} slots must be unique and canonically sorted.`,
      );
    }
    return Object.freeze({
      task_id: safeId(candidate.task_id, `Review task ${taskIndex} id`),
      output_path: portablePngPath(candidate.output_path, `Review task ${taskIndex} output path`),
      artifact_sha256: digest(
        candidate.artifact_sha256,
        `Review task ${taskIndex} artifact digest`,
      ),
      output_sha256: digest(candidate.output_sha256, `Review task ${taskIndex} output digest`),
      slots,
    });
  }));
  if (tasks.some((task, index) =>
    index > 0 && tasks[index - 1]!.task_id.localeCompare(task.task_id, 'en') >= 0)) {
    fail(
      'world-art-selection-review.invalid-review',
      'Review tasks must be unique and canonically sorted.',
    );
  }
  const slotIds = tasks.flatMap(({ slots }) => slots.map(({ slot_id: slotId }) => slotId));
  if (new Set(slotIds).size !== slotIds.length) {
    fail('world-art-selection-review.invalid-review', 'Review slot ids must be globally unique.');
  }
  return tasks;
}

function materializeSelections(
  value: unknown,
  confirmed: ConfirmedInputs,
): readonly WorldArtVariantSelection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2048) {
    fail('world-art-selection-review.invalid-selection', 'Review selections are invalid.');
  }
  const selections = Object.freeze(value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('world-art-selection-review.invalid-shape', `Selection ${index} must be an object.`);
    }
    exactKeys(candidate, ['usage_kind', 'usage_id', 'slot_id'], `Selection ${index}`);
    if (!['terrain-material', 'hazard', 'character'].includes(String(candidate.usage_kind))) {
      fail('world-art-selection-review.invalid-selection', `Selection ${index} kind is invalid.`);
    }
    return Object.freeze({
      usage_kind: candidate.usage_kind as WorldArtVariantSelection['usage_kind'],
      usage_id: safeId(candidate.usage_id, `Selection ${index} usage id`),
      slot_id: safeId(candidate.slot_id, `Selection ${index} slot id`),
    });
  }));
  if (selections.some((selection, index) =>
    index > 0 && compareSelections(selections[index - 1]!, selection) >= 0)) {
    fail(
      'world-art-selection-review.invalid-selection',
      'Selections must be unique and canonically sorted.',
    );
  }
  const slots = knownSlots(confirmed);
  const required = new Map<string, AssetRequirementV1_1 | null>();
  terrainMaterials(confirmed.layout).forEach((material) => {
    required.set(`terrain-material\u0000${material}`, null);
  });
  confirmed.requirements.requirements.forEach((requirement) => {
    if (requirement.category === 'hazard' || requirement.category === 'character') {
      required.set(`${requirement.category}\u0000${requirement.requirement_id}`, requirement);
    }
  });
  if (selections.length !== required.size) {
    fail(
      'world-art-selection-review.invalid-selection',
      'Selections must cover every terrain material, hazard, and character requirement.',
    );
  }
  const seen = new Set<string>();
  for (const selection of selections) {
    const key = `${selection.usage_kind}\u0000${selection.usage_id}`;
    const demanded = required.get(key);
    const selected = slots.get(selection.slot_id);
    if (
      seen.has(key)
      || !required.has(key)
      || !selected
      || (selection.usage_kind === 'terrain-material'
        ? selected.requirement.category !== 'terrain'
          || selected.slot.role
            !== worldMaterialRoleForProfile(confirmed.layout.profile, selection.usage_id)
        : !demanded
          || selected.requirement.requirement_id !== demanded.requirement_id
          || selected.requirement.category !== selection.usage_kind)
    ) {
      fail(
        'world-art-selection-review.invalid-selection',
        `Selection ${selection.usage_kind}/${selection.usage_id} is incompatible.`,
      );
    }
    seen.add(key);
  }
  return selections;
}

function taskIdentity(tasks: readonly WorldArtSelectionReviewTask[]): unknown {
  return tasks.map((task) => ({
    task_id: task.task_id,
    output_path: task.output_path,
    artifact_sha256: task.artifact_sha256,
    output_sha256: task.output_sha256,
    slots: task.slots.map((slot) => ({
      slot_id: slot.slot_id,
      requirement_id: slot.requirement_id,
      role: slot.role,
      variant_id: slot.variant_id,
      atlas_cell: slot.atlas_cell,
    })),
  }));
}

export async function buildPendingWorldArtSelectionReview(
  input: WorldArtSelectionReviewInput,
): Promise<WorldArtSelectionReview> {
  return expectedPendingReview(await confirmedInputs(input));
}

export async function materializeWorldArtSelectionReview(
  value: unknown,
  input: WorldArtSelectionReviewInput,
): Promise<WorldArtSelectionReview> {
  if (!isRecord(value)) {
    fail('world-art-selection-review.invalid-shape', 'World art selection review must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'review_id',
    'profile',
    'review_status',
    'source',
    'rights',
    'declarations',
    'tasks',
    'selections',
  ], 'World art selection review');
  if (
    value.schema_version !== WORLD_ART_SELECTION_REVIEW_VERSION
    || value.document_type !== 'world-art-selection-review'
    || !isWorldAssetProfile(value.profile)
    || !['pending', 'pass'].includes(String(value.review_status))
  ) {
    fail('world-art-selection-review.invalid-value', 'Review identity or status is invalid.');
  }
  const confirmed = await confirmedInputs(input);
  const expected = await expectedPendingReview(confirmed);
  const source = materializeSource(value.source);
  const rights = materializeRights(value.rights);
  const declarations = materializeDeclarations(value.declarations);
  const tasks = materializeTasks(value.tasks);
  const selections = materializeSelections(value.selections, confirmed);
  const review = Object.freeze({
    schema_version: WORLD_ART_SELECTION_REVIEW_VERSION,
    document_type: 'world-art-selection-review' as const,
    review_id: safeId(value.review_id, 'Review id', 100),
    profile: value.profile,
    review_status: value.review_status as WorldArtSelectionReviewStatus,
    source,
    rights,
    declarations,
    tasks,
    selections,
  });
  if (
    review.review_id !== expected.review_id
    || review.profile !== expected.profile
    || canonicalJson(review.source) !== canonicalJson(expected.source)
    || canonicalJson(review.rights) !== canonicalJson(expected.rights)
    || canonicalJson(taskIdentity(review.tasks)) !== canonicalJson(taskIdentity(expected.tasks))
  ) {
    fail(
      canonicalJson(review.rights) !== canonicalJson(expected.rights)
        ? 'world-art-selection-review.invalid-rights'
        : 'world-art-selection-review.invalid-source',
      'Review identity, source, rights, task artifacts, or slots drifted from canonical inputs.',
    );
  }
  if (
    review.review_status === 'pass'
    && (
      !review.declarations.visual_quality_approved
      || !review.declarations.atlas_integrity_approved
      || !review.declarations.rights_and_redistribution_approved
      || review.tasks.some(({ slots }) =>
        slots.some(({ decision }) => decision !== 'approved'))
    )
  ) {
    fail(
      'world-art-selection-review.invalid-review',
      'A passing review requires every slot approved and every declaration true.',
    );
  }
  return review;
}

export async function fingerprintWorldArtSelectionReview(
  value: unknown,
  input: WorldArtSelectionReviewInput,
): Promise<string> {
  return sha256(await materializeWorldArtSelectionReview(value, input));
}

export async function serializeCanonicalWorldArtSelectionReview(
  value: unknown,
  input: WorldArtSelectionReviewInput,
): Promise<Uint8Array> {
  const review = await materializeWorldArtSelectionReview(value, input);
  return new TextEncoder().encode(`${canonicalJson(review)}\n`);
}

export async function materializePassedWorldArtSelectionReview(
  value: unknown,
  input: WorldArtSelectionReviewInput,
): Promise<PassedWorldArtSelectionReview> {
  const review = await materializeWorldArtSelectionReview(value, input);
  if (review.review_status !== 'pass') {
    fail(
      'world-art-selection-review.invalid-review',
      'Only a passing review can admit world-art slots and selections.',
    );
  }
  const reviewRecordSha = await sha256(review);
  const confirmed = await confirmedInputs(input);
  const slots = Object.freeze(review.tasks.flatMap((task) =>
    task.slots.map((slot) => Object.freeze({
      slot_id: slot.slot_id,
      requirement_id: slot.requirement_id,
      role: slot.role,
      variant_id: slot.variant_id,
      atlas_path: task.output_path,
      atlas_cell: slot.atlas_cell,
    }))));
  const inventory: ReviewedWorldArtSlotInventory = Object.freeze({
    schema_version: '1.0.0',
    document_type: 'reviewed-world-art-slot-inventory',
    profile: review.profile,
    production_art_plan_id: confirmed.plan.plan_id,
    production_art_plan_sha256: confirmed.source.production_art_plan_sha256,
    review_record_sha256: reviewRecordSha,
    review_status: 'pass',
    slots,
  });
  return Object.freeze({
    review: review as WorldArtSelectionReview & Readonly<{ review_status: 'pass' }>,
    review_record_sha256: reviewRecordSha,
    reviewed_slot_inventory: inventory,
    selections: review.selections,
  });
}
