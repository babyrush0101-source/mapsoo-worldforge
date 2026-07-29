import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type { NormalizedProductionArtResultV1_1 } from './normalize-production-art-png-v1-1';
import {
  fingerprintAssetRequirementsV1_1,
  materializeAssetRequirementsV1_1,
  type AssetRequirementsV1_1,
} from '../core/asset-requirements-v1-1';
import {
  fingerprintProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../core/production-art-contract-v1-1';
import {
  fingerprintProductionArtOutputV1_1,
  materializeProductionArtOutputV1_1,
} from '../core/production-art-output-v1-1';
import {
  fingerprintProductionArtRunSetV1_1,
  materializeProductionArtRunSetV1_1,
} from '../core/production-art-run-set-v1-1';
import {
  buildWorldArtRuntimeProjection,
  type WorldArtRuntimeAsset,
  type WorldArtRuntimeBinding,
  type WorldArtRuntimeHazard,
  type WorldArtRuntimePose,
  type WorldArtRuntimeProjection,
  type WorldArtRuntimeProjectionImage,
} from '../core/world-art-runtime-projection';
import {
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from '../core/world-layout-plan';
import {
  fingerprintWorldArtVariantMap,
  validateWorldArtVariantMap,
  type WorldArtVariantMapInput,
} from '../core/world-art-variant-map';

export interface ProjectReviewedWorldArtVariantsInput {
  readonly variantMap: unknown;
  readonly variantMapInput: WorldArtVariantMapInput;
  readonly requirements: unknown;
  readonly plan: unknown;
  readonly runSet: unknown;
  readonly normalizedResults: readonly NormalizedProductionArtResultV1_1[];
}

export interface ProjectedReviewedWorldArtImage {
  readonly task_id: string;
  readonly path: string;
  readonly media_type: 'image/png';
  readonly bytes: number;
  readonly sha256: string;
  readBytes(): Uint8Array;
}

export interface ProjectedReviewedWorldArtVariants {
  readonly projection: WorldArtRuntimeProjection;
  readonly images: readonly ProjectedReviewedWorldArtImage[];
}

export type ProjectReviewedWorldArtVariantsErrorCode =
  | 'reviewed-world-art-projection.invalid-source'
  | 'reviewed-world-art-projection.invalid-inventory'
  | 'reviewed-world-art-projection.invalid-output'
  | 'reviewed-world-art-projection.invalid-evidence'
  | 'reviewed-world-art-projection.integrity'
  | 'reviewed-world-art-projection.invalid-binding';

export class ProjectReviewedWorldArtVariantsError extends Error {
  constructor(
    readonly code: ProjectReviewedWorldArtVariantsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectReviewedWorldArtVariantsError';
  }
}

type GridCell = Readonly<{ column: number; row: number }>;

const SHA256 = /^[a-f0-9]{64}$/;
const USAGE_ORDER = Object.freeze({
  'terrain-material': 0,
  landmark: 1,
  hazard: 2,
  character: 3,
} as const);

function fail(
  code: ProjectReviewedWorldArtVariantsErrorCode,
  message: string,
): never {
  throw new ProjectReviewedWorldArtVariantsError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      'reviewed-world-art-projection.invalid-evidence',
      `${label} contains unsupported or missing fields.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('reviewed-world-art-projection.integrity', 'Non-finite value.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('reviewed-world-art-projection.integrity', 'Unsupported value.');
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function rectCells(
  rect: ProductionArtTaskV1_1['slot_mappings'][number]['grid_rect'],
): readonly GridCell[] {
  const cells: GridCell[] = [];
  for (let row = rect.row; row < rect.row + rect.row_span; row += 1) {
    for (let column = rect.column; column < rect.column + rect.column_span; column += 1) {
      cells.push(Object.freeze({ column, row }));
    }
  }
  return Object.freeze(cells);
}

function cellsForSlot(task: ProductionArtTaskV1_1, slotId: string): readonly GridCell[] {
  if (task.kind !== 'character-animation-sheet') {
    const slot = task.slot_mappings.find(({ slot_id: candidate }) => candidate === slotId);
    return slot ? rectCells(slot.grid_rect) : [];
  }
  const seen = new Set<string>();
  return Object.freeze((task.pose_mappings ?? [])
    .filter(({ slot_id: candidate }) => candidate === slotId)
    .map(({ grid_cell }) => Object.freeze({
      column: grid_cell.column,
      row: grid_cell.row,
    }))
    .filter(({ column, row }) => {
      const key = `${column}:${row}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
}

function rgbaForCells(
  task: ProductionArtTaskV1_1,
  rgba: Uint8Array,
  cells: readonly GridCell[],
): Uint8Array {
  const { width, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  const output = new Uint8Array(cells.length * cellWidth * cellHeight * 4);
  let targetOffset = 0;
  for (const { column, row } of cells) {
    for (let y = 0; y < cellHeight; y += 1) {
      const sourceOffset = (
        (row * cellHeight + y) * width
        + column * cellWidth
      ) * 4;
      const sourceRow = rgba.subarray(sourceOffset, sourceOffset + cellWidth * 4);
      output.set(sourceRow, targetOffset);
      targetOffset += sourceRow.byteLength;
    }
  }
  return output;
}

function rgbaForRegion(
  task: ProductionArtTaskV1_1,
  rgba: Uint8Array,
  rect: ProductionArtTaskV1_1['slot_mappings'][number]['grid_rect'],
): Uint8Array {
  const {
    width,
    cell_width: cellWidth,
    cell_height: cellHeight,
  } = task.target;
  const sourceX = rect.column * cellWidth;
  const sourceY = rect.row * cellHeight;
  const regionWidth = rect.column_span * cellWidth;
  const regionHeight = rect.row_span * cellHeight;
  const output = new Uint8Array(regionWidth * regionHeight * 4);
  let targetOffset = 0;
  for (let y = 0; y < regionHeight; y += 1) {
    const sourceOffset = (
      (sourceY + y) * width
      + sourceX
    ) * 4;
    const sourceRow = rgba.subarray(
      sourceOffset,
      sourceOffset + regionWidth * 4,
    );
    output.set(sourceRow, targetOffset);
    targetOffset += sourceRow.byteLength;
  }
  return output;
}

function resultTaskId(value: NormalizedProductionArtResultV1_1): string {
  if (
    !isRecord(value)
    || !isRecord(value.output)
    || typeof value.output.task_id !== 'string'
  ) {
    fail(
      'reviewed-world-art-projection.invalid-inventory',
      'Normalized result task identity is invalid.',
    );
  }
  return value.output.task_id;
}

async function validateNormalizedResult(
  result: NormalizedProductionArtResultV1_1,
  task: ProductionArtTaskV1_1,
  plan: unknown,
  requirements: unknown,
  runOutput: unknown,
): Promise<Readonly<{
  bytes: Uint8Array;
  sha256: string;
  outputSha256: string;
  cellShaBySlot: ReadonlyMap<string, string>;
  regionShaBySlot: ReadonlyMap<string, string>;
}>> {
  const output = await materializeProductionArtOutputV1_1(
    result.output,
    plan,
    requirements,
  ).catch(() => fail(
    'reviewed-world-art-projection.invalid-output',
    `Normalized output ${task.task_id} is not bound to Plan 1.1.`,
  ));
  if (canonicalJson(output) !== canonicalJson(runOutput)) {
    fail(
      'reviewed-world-art-projection.invalid-output',
      `Normalized output ${task.task_id} differs from RunSet 1.1.`,
    );
  }
  if (
    !isRecord(result.normalized)
    || typeof result.normalized.readBytes !== 'function'
    || !Number.isSafeInteger(result.normalized.byteLength)
    || !isRecord(result.source)
    || typeof result.source.readBytes !== 'function'
    || !Number.isSafeInteger(result.source.byteLength)
    || !isRecord(result.evidence)
  ) {
    fail(
      'reviewed-world-art-projection.invalid-evidence',
      `Normalized result ${task.task_id} shape is invalid.`,
    );
  }
  const normalizedBytes = result.normalized.readBytes();
  const sourceBytes = result.source.readBytes();
  if (
    normalizedBytes.byteLength !== result.normalized.byteLength
    || sourceBytes.byteLength !== result.source.byteLength
  ) {
    fail(
      'reviewed-world-art-projection.integrity',
      `Production art bytes changed for ${task.task_id}.`,
    );
  }
  const [normalizedSha, sourceSha, decoded, decodedSource, outputSha] = await Promise.all([
    sha256Bytes(normalizedBytes),
    sha256Bytes(sourceBytes),
    decodeReferenceImageRgba(normalizedBytes, 'image/png'),
    decodeReferenceImageRgba(sourceBytes, 'image/png'),
    fingerprintProductionArtOutputV1_1(output, plan, requirements),
  ]);
  const evidence = result.evidence;
  exactKeys(evidence as unknown as Record<string, unknown>, [
    'schema_version',
    'document_type',
    'plan_id',
    'profile',
    'task_id',
    'source_binding',
    'source_png',
    'normalized_png',
    'slots',
    'postprocess',
    'human_review',
  ], `Evidence ${task.task_id}`);
  if (
    evidence.schema_version !== '1.1.0'
    || evidence.document_type !== 'production-art-generation-evidence'
    || evidence.plan_id !== output.plan_id
    || evidence.profile !== output.profile
    || evidence.task_id !== task.task_id
    || evidence.human_review !== 'required'
    || !isRecord(evidence.source_binding)
    || !isRecord(evidence.source_png)
    || !isRecord(evidence.normalized_png)
    || !isRecord(evidence.postprocess)
    || !Array.isArray(evidence.slots)
  ) {
    fail(
      'reviewed-world-art-projection.invalid-evidence',
      `Evidence ${task.task_id} identity is invalid.`,
    );
  }
  exactKeys(evidence.source_binding, ['plan_sha256', 'requirements_sha256'], 'Evidence source');
  exactKeys(
    evidence.source_png,
    ['media_type', 'bytes', 'sha256', 'width', 'height'],
    'Evidence source PNG',
  );
  exactKeys(
    evidence.normalized_png,
    ['media_type', 'bytes', 'sha256', 'width', 'height', 'alpha_policy'],
    'Evidence normalized PNG',
  );
  exactKeys(evidence.postprocess, [
    'resize',
    'alpha_extraction',
    'transparent_rgb_zeroed',
    'mapped_grid_cells_checked',
    'unmapped_grid_cells_transparent',
    'character_pose_cells_checked',
  ], 'Evidence postprocess');
  if (
    evidence.source_binding.plan_sha256 !== output.source.plan_sha256
    || evidence.source_binding.requirements_sha256 !== output.source.requirements_sha256
    || evidence.source_png.media_type !== 'image/png'
    || evidence.source_png.bytes !== sourceBytes.byteLength
    || evidence.source_png.sha256 !== sourceSha
    || evidence.source_png.width !== decodedSource.width
    || evidence.source_png.height !== decodedSource.height
    || evidence.normalized_png.media_type !== 'image/png'
    || evidence.normalized_png.bytes !== normalizedBytes.byteLength
    || evidence.normalized_png.sha256 !== normalizedSha
    || evidence.normalized_png.width !== decoded.width
    || evidence.normalized_png.height !== decoded.height
    || evidence.normalized_png.alpha_policy !== task.alpha_policy
    || output.bytes !== normalizedBytes.byteLength
    || output.sha256 !== normalizedSha
    || decoded.width !== task.target.width
    || decoded.height !== task.target.height
    || evidence.postprocess.resize !== 'nearest-neighbor-v1'
    || evidence.postprocess.alpha_extraction !== (
      task.alpha_policy === 'opaque' ? 'none' : 'edge-connected-green-chroma-v1'
    )
    || evidence.postprocess.transparent_rgb_zeroed !== true
    || evidence.postprocess.mapped_grid_cells_checked !== true
    || evidence.postprocess.unmapped_grid_cells_transparent !== true
    || evidence.postprocess.character_pose_cells_checked !== true
  ) {
    fail(
      'reviewed-world-art-projection.integrity',
      `Evidence and bytes differ for ${task.task_id}.`,
    );
  }
  if (evidence.slots.length !== task.slot_mappings.length) {
    fail(
      'reviewed-world-art-projection.invalid-evidence',
      `Evidence slot inventory differs for ${task.task_id}.`,
    );
  }
  const cellShaBySlot = new Map<string, string>();
  const regionShaBySlot = new Map<string, string>();
  for (const [index, slot] of task.slot_mappings.entries()) {
    const candidate = evidence.slots[index];
    if (!isRecord(candidate)) {
      fail('reviewed-world-art-projection.invalid-evidence', 'Evidence slot is invalid.');
    }
    exactKeys(candidate, [
      'slot_id',
      'requirement_id',
      'role',
      'variant_id',
      'atlas_cell',
      'occupied_cell_count',
      'cell_sha256',
    ], `Evidence slot ${index}`);
    const cells = cellsForSlot(task, slot.slot_id);
    const cellSha = await sha256Bytes(rgbaForCells(task, decoded.rgba, cells));
    if (
      candidate.slot_id !== slot.slot_id
      || candidate.requirement_id !== slot.requirement_id
      || candidate.role !== slot.role
      || candidate.variant_id !== slot.variant_id
      || canonicalJson(candidate.atlas_cell) !== canonicalJson(slot.grid_rect)
      || candidate.occupied_cell_count !== cells.length
      || candidate.cell_sha256 !== cellSha
      || !SHA256.test(String(candidate.cell_sha256))
    ) {
      fail(
        'reviewed-world-art-projection.invalid-evidence',
        `Evidence slot ${slot.slot_id} differs from normalized pixels.`,
      );
    }
    cellShaBySlot.set(slot.slot_id, cellSha);
    regionShaBySlot.set(
      slot.slot_id,
      await sha256Bytes(rgbaForRegion(task, decoded.rgba, slot.grid_rect)),
    );
  }
  return Object.freeze({
    bytes: Uint8Array.from(normalizedBytes),
    sha256: normalizedSha,
    outputSha256: outputSha,
    cellShaBySlot,
    regionShaBySlot,
  });
}

function posesFor(task: ProductionArtTaskV1_1, slotId: string): readonly WorldArtRuntimePose[] {
  if (task.kind !== 'character-animation-sheet') return Object.freeze([]);
  return Object.freeze((task.pose_mappings ?? [])
    .filter(({ slot_id: candidate }) => candidate === slotId)
    .map((pose) => Object.freeze({
      action: pose.action,
      direction: pose.direction,
      frame_index: pose.frame_index,
      duration_ms: pose.duration_ms,
      region: Object.freeze({
        x: pose.grid_cell.column * task.target.cell_width,
        y: pose.grid_cell.row * task.target.cell_height,
        width: task.target.cell_width,
        height: task.target.cell_height,
      }),
    }))
    .sort((left, right) =>
      left.action.localeCompare(right.action, 'en')
      || left.direction.localeCompare(right.direction, 'en')
      || left.frame_index - right.frame_index));
}

function runtimeHazards(
  layout: WorldLayoutPlan,
  requirements: AssetRequirementsV1_1,
  bindings: readonly WorldArtRuntimeBinding[],
): readonly WorldArtRuntimeHazard[] {
  const level = requirements.layout.hazard_level;
  if (level === 'calm') return Object.freeze([]);
  const count = level === 'dangerous' ? 2 : 1;
  const routes = layout.traversal.nodes.filter(({ kind }) => kind === 'route');
  if (routes.length < count) {
    fail(
      'reviewed-world-art-projection.invalid-binding',
      `Layout has ${routes.length} route nodes but ${count} hazard placements are required.`,
    );
  }
  const hazardBindings = bindings.filter(({ usage_kind: usageKind }) =>
    usageKind === 'hazard');
  const byRole = new Map(hazardBindings.map((binding) => [binding.role, binding]));
  const primaryRoles = layout.profile === 'side-platformer'
    ? (count === 1 ? ['hazard.spikes'] : ['hazard.spikes', 'hazard.pit'])
    : Array.from({ length: count }, () => 'hazard.contact');
  const telegraph = layout.profile === 'isometric-action'
    ? byRole.get('hazard.telegraph')
    : undefined;
  const hazards = primaryRoles.map((role, index) => {
    const binding = byRole.get(role);
    if (binding === undefined) {
      fail(
        'reviewed-world-art-projection.invalid-binding',
        `Hazard placement requires reviewed binding ${role}.`,
      );
    }
    const routeIndex = Math.floor(((index + 1) * routes.length) / (count + 1));
    const route = routes[Math.min(routeIndex, routes.length - 1)]!;
    const width = role === 'hazard.pit' ? 3 : 2;
    const height = layout.profile === 'side-platformer' ? 1 : 2;
    const x = Math.max(
      0,
      Math.min(layout.bounds.width - width, route.x - Math.floor(width / 2)),
    );
    const y = Math.max(
      0,
      Math.min(
        layout.bounds.height - height,
        route.y - (layout.profile === 'side-platformer' ? 0 : 1),
      ),
    );
    return Object.freeze({
      hazard_id: `hazard-${String(index + 1).padStart(3, '0')}`,
      binding_usage_id: binding.usage_id,
      kind: role.slice('hazard.'.length) as WorldArtRuntimeHazard['kind'],
      behavior: 'respawn' as const,
      logical_rect: Object.freeze({ x, y, width, height }),
      ...(telegraph === undefined
        ? {}
        : { telegraph_usage_id: telegraph.usage_id }),
    });
  });
  const overlaps = hazards.some(({ logical_rect: left }, leftIndex) =>
    hazards.some(({ logical_rect: right }, rightIndex) =>
      rightIndex > leftIndex
      && left.x < right.x + right.width
      && left.x + left.width > right.x
      && left.y < right.y + right.height
      && left.y + left.height > right.y));
  if (overlaps) {
    fail(
      'reviewed-world-art-projection.invalid-binding',
      'Hazard placement produced overlapping logical rectangles.',
    );
  }
  return Object.freeze(hazards);
}

export async function projectReviewedWorldArtVariants(
  input: ProjectReviewedWorldArtVariantsInput,
): Promise<ProjectedReviewedWorldArtVariants> {
  const requirements = await materializeAssetRequirementsV1_1(input.requirements);
  const plan = await materializeProductionArtPlanV1_1(input.plan, requirements);
  const [map, layout, planSha, requirementsSha, runSet] = await Promise.all([
    validateWorldArtVariantMap(input.variantMap, input.variantMapInput),
    materializeWorldLayoutPlan(input.variantMapInput.layout_plan),
    fingerprintProductionArtPlanV1_1(plan, requirements),
    fingerprintAssetRequirementsV1_1(requirements),
    materializeProductionArtRunSetV1_1(input.runSet, plan, requirements),
  ]).catch((error) => fail(
    'reviewed-world-art-projection.invalid-source',
    `Reviewed world-art inputs are invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
  ));
  if (
    map.profile !== plan.profile
    || map.source.production_art_plan_id !== plan.plan_id
    || map.source.production_art_plan_sha256 !== planSha
    || runSet.plan_id !== plan.plan_id
    || runSet.source.plan_sha256 !== planSha
    || runSet.source.requirements_sha256 !== requirementsSha
  ) {
    fail(
      'reviewed-world-art-projection.invalid-source',
      'Variant map, plan, requirements, and run-set are not source-bound.',
    );
  }
  if (!Array.isArray(input.normalizedResults)) {
    fail('reviewed-world-art-projection.invalid-inventory', 'Normalized results must be an array.');
  }
  const normalizedByTask = new Map<string, NormalizedProductionArtResultV1_1>();
  for (const result of input.normalizedResults) {
    const taskId = resultTaskId(result);
    if (normalizedByTask.has(taskId)) {
      fail(
        'reviewed-world-art-projection.invalid-inventory',
        `Normalized task ${taskId} is duplicated.`,
      );
    }
    normalizedByTask.set(taskId, result);
  }
  if (
    normalizedByTask.size !== plan.tasks.length
    || plan.tasks.some(({ task_id: taskId }) => !normalizedByTask.has(taskId))
  ) {
    fail(
      'reviewed-world-art-projection.invalid-inventory',
      'Every Plan 1.1 task requires exactly one normalized result.',
    );
  }
  const runByTask = new Map(runSet.runs.map((run) => [run.task_id, run]));
  const verifiedByTask = new Map<string, Awaited<ReturnType<typeof validateNormalizedResult>>>();
  for (const task of plan.tasks) {
    verifiedByTask.set(task.task_id, await validateNormalizedResult(
      normalizedByTask.get(task.task_id)!,
      task,
      plan,
      requirements,
      runByTask.get(task.task_id)?.output,
    ));
  }

  const taskBySlot = new Map<string, ProductionArtTaskV1_1>();
  for (const task of plan.tasks) {
    for (const slot of task.slot_mappings) taskBySlot.set(slot.slot_id, task);
  }
  const assets: WorldArtRuntimeAsset[] = [];
  for (const task of [...plan.tasks]
    .filter(({ slot_mappings: slots }) => slots.length > 0)
    .sort((left, right) => left.task_id.localeCompare(right.task_id, 'en'))) {
    const verified = verifiedByTask.get(task.task_id)!;
    for (const slot of [...task.slot_mappings]
      .sort((left, right) => left.slot_id.localeCompare(right.slot_id, 'en'))) {
      assets.push(Object.freeze({
        task_id: task.task_id,
        slot_id: slot.slot_id,
        requirement_id: slot.requirement_id,
        role: slot.role,
        variant_id: slot.variant_id,
        image_path: task.expected_output_path,
        region: Object.freeze({
          x: slot.grid_rect.column * task.target.cell_width,
          y: slot.grid_rect.row * task.target.cell_height,
          width: slot.grid_rect.column_span * task.target.cell_width,
          height: slot.grid_rect.row_span * task.target.cell_height,
        }),
        // The frozen runtime projection field is named `cell_sha256`, but its
        // loader contract hashes the exact rectangular `region` in row-major
        // RGBA order. Human-review evidence remains independently verified
        // above against the occupied production cells.
        cell_sha256: verified.regionShaBySlot.get(slot.slot_id)!,
        poses: posesFor(task, slot.slot_id),
      }));
    }
  }
  const assetBySlot = new Map(assets.map((asset) => [asset.slot_id, asset]));
  const bindings: WorldArtRuntimeBinding[] = [];
  for (const mapBinding of map.bindings) {
    const task = taskBySlot.get(mapBinding.slot_id);
    const slot = task?.slot_mappings.find(({ slot_id: slotId }) =>
      slotId === mapBinding.slot_id);
    const asset = assetBySlot.get(mapBinding.slot_id);
    if (
      !task
      || !slot
      || !asset
      || task.expected_output_path !== mapBinding.atlas_path
      || slot.role !== mapBinding.role
      || slot.variant_id !== mapBinding.variant_id
      || canonicalJson(slot.grid_rect) !== canonicalJson(mapBinding.atlas_cell)
    ) {
      fail(
        'reviewed-world-art-projection.invalid-binding',
        `Variant binding ${mapBinding.usage_kind}/${mapBinding.usage_id} is not a Plan 1.1 slot.`,
      );
    }
    bindings.push(Object.freeze({
      usage_kind: mapBinding.usage_kind,
      usage_id: mapBinding.usage_id,
      task_id: asset.task_id,
      slot_id: asset.slot_id,
      role: asset.role,
      variant_id: asset.variant_id,
      image_path: asset.image_path,
      region: asset.region,
      cell_sha256: asset.cell_sha256,
      poses: asset.poses,
    }));
  }
  bindings.sort((left, right) =>
    USAGE_ORDER[left.usage_kind] - USAGE_ORDER[right.usage_kind]
    || left.usage_id.localeCompare(right.usage_id, 'en')
    || left.slot_id.localeCompare(right.slot_id, 'en'));

  const images: WorldArtRuntimeProjectionImage[] = [];
  const projectedImages: ProjectedReviewedWorldArtImage[] = [];
  for (const task of [...plan.tasks]
    .filter(({ slot_mappings: slots }) => slots.length > 0)
    .sort((left, right) => left.task_id.localeCompare(right.task_id, 'en'))) {
    const run = runByTask.get(task.task_id)!;
    const verified = verifiedByTask.get(task.task_id)!;
    images.push(Object.freeze({
      task_id: task.task_id,
      path: task.expected_output_path,
      media_type: 'image/png',
      bytes: verified.bytes.byteLength,
      sha256: verified.sha256,
      output_sha256: run.evidence.output_sha256,
      width: task.target.width,
      height: task.target.height,
      cell_size: Object.freeze([task.target.cell_width, task.target.cell_height] as const),
      pivot: Object.freeze([task.pivot.x, task.pivot.y] as const),
      alpha_policy: task.alpha_policy,
    }));
    const snapshot = Uint8Array.from(verified.bytes);
    projectedImages.push(Object.freeze({
      task_id: task.task_id,
      path: task.expected_output_path,
      media_type: 'image/png',
      bytes: snapshot.byteLength,
      sha256: verified.sha256,
      readBytes: () => Uint8Array.from(snapshot),
    }));
  }
  const [variantMapSha, runSetSha] = await Promise.all([
    fingerprintWorldArtVariantMap(map, input.variantMapInput),
    fingerprintProductionArtRunSetV1_1(runSet, plan, requirements),
  ]);
  const projection = await buildWorldArtRuntimeProjection({
    schema_version: '1.0.0',
    document_type: 'world-art-runtime-projection',
    profile: map.profile,
    source: {
      variant_map_id: map.map_id,
      variant_map_sha256: variantMapSha,
      layout_plan_sha256: map.source.layout_plan_sha256,
      production_art_plan_id: plan.plan_id,
      production_art_plan_sha256: planSha,
      requirements_sha256: requirementsSha,
      run_set_sha256: runSetSha,
      reviewed_slot_inventory_sha256: map.source.reviewed_slot_inventory_sha256,
      review_record_sha256: map.source.review_record_sha256,
    },
    rights: runSet.rights,
    images,
    assets,
    bindings,
    hazards: runtimeHazards(layout, requirements, bindings),
  });
  return Object.freeze({
    projection,
    images: Object.freeze(projectedImages),
  });
}
