import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import {
  extractEdgeConnectedChroma,
  forceOpaque,
  pixelOffset,
  resizeNearest,
} from './production-art-png-pixels';
import {
  fingerprintAssetRequirementsV1_1,
  materializeAssetRequirementsV1_1,
  type AssetRequirementsV1_1,
} from '../core/asset-requirements-v1-1';
import {
  fingerprintProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../core/production-art-contract-v1-1';
import {
  buildProductionArtOutputV1_1,
  type ProductionArtOutputV1_1,
} from '../core/production-art-output-v1-1';

const MAX_PNG_BYTES = 64 * 1024 * 1024;

export interface LocalProductionArtPngSourceV1_1 {
  readonly media_type: 'image/png';
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
  readBytes(): Uint8Array;
}

export interface NormalizeProductionArtPngV1_1Input {
  readonly plan: unknown;
  readonly requirements: unknown;
  readonly task: unknown;
  readonly asset_id: string;
  readonly source_reference_ids: readonly string[];
  readonly source: LocalProductionArtPngSourceV1_1;
}

export interface ProductionArtSlotCellEvidenceV1_1 {
  readonly slot_id: string;
  readonly requirement_id: string;
  readonly role: string;
  readonly variant_id: string;
  readonly atlas_cell: Readonly<{
    column: number;
    row: number;
    column_span: number;
    row_span: number;
  }>;
  readonly occupied_cell_count: number;
  readonly cell_sha256: string;
}

export interface ProductionArtGenerationEvidenceV1_1 {
  readonly schema_version: '1.1.0';
  readonly document_type: 'production-art-generation-evidence';
  readonly plan_id: string;
  readonly profile: string;
  readonly task_id: string;
  readonly source_binding: Readonly<{
    plan_sha256: string;
    requirements_sha256: string;
  }>;
  readonly source_png: Readonly<{
    media_type: 'image/png';
    bytes: number;
    sha256: string;
    width: number;
    height: number;
  }>;
  readonly normalized_png: Readonly<{
    media_type: 'image/png';
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    alpha_policy: 'opaque' | 'straight-alpha';
  }>;
  readonly slots: readonly ProductionArtSlotCellEvidenceV1_1[];
  readonly postprocess: Readonly<{
    resize: 'nearest-neighbor-v1';
    alpha_extraction: 'none' | 'edge-connected-green-chroma-v1';
    transparent_rgb_zeroed: true;
    mapped_grid_cells_checked: true;
    unmapped_grid_cells_transparent: true;
    character_pose_cells_checked: true;
  }>;
  readonly human_review: 'required';
}

export interface NormalizedProductionArtResultV1_1 {
  readonly output: ProductionArtOutputV1_1;
  readonly evidence: ProductionArtGenerationEvidenceV1_1;
  readonly source: Readonly<{
    byteLength: number;
    readBytes(): Uint8Array;
  }>;
  readonly normalized: Readonly<{
    byteLength: number;
    readBytes(): Uint8Array;
  }>;
}

type GridCell = Readonly<{ column: number; row: number }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Production art input contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) throw new Error('Production art input contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
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

function slotCells(
  task: ProductionArtTaskV1_1,
): ReadonlyMap<string, readonly GridCell[]> {
  const result = new Map<string, readonly GridCell[]>();
  for (const slot of task.slot_mappings) {
    if (task.kind === 'character-animation-sheet') {
      const seen = new Set<string>();
      const poses = (task.pose_mappings ?? [])
        .filter(({ slot_id: slotId }) => slotId === slot.slot_id)
        .map(({ grid_cell: cell }) => Object.freeze({
          column: cell.column,
          row: cell.row,
        }))
        .filter((cell) => {
          const key = `${cell.column}:${cell.row}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (poses.length === 0) {
        throw new Error(`Character slot ${slot.slot_id} has no declared pose cells.`);
      }
      result.set(slot.slot_id, Object.freeze(poses));
    } else {
      result.set(slot.slot_id, rectCells(slot.grid_rect));
    }
  }
  return result;
}

function occupiedCellKeys(task: ProductionArtTaskV1_1): ReadonlySet<string> {
  const occupied = new Set<string>();
  for (const cells of slotCells(task).values()) {
    cells.forEach(({ column, row }) => occupied.add(`${column}:${row}`));
  }
  return occupied;
}

function assertPixelContract(task: ProductionArtTaskV1_1, rgba: Uint8Array): void {
  const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  let transparent = 0;
  let visible = 0;
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    const alpha = rgba[offset + 3];
    if (alpha === 0) {
      transparent += 1;
      if (rgba[offset] !== 0 || rgba[offset + 1] !== 0 || rgba[offset + 2] !== 0) {
        throw new Error('Transparent output pixels must have zero RGB channels.');
      }
    } else {
      visible += 1;
      if (task.alpha_policy === 'opaque' && alpha !== 255) {
        throw new Error('Opaque production art output cannot contain partial alpha.');
      }
    }
  }
  if (task.alpha_policy === 'opaque' && transparent !== 0) {
    throw new Error('Opaque production art output cannot contain transparent pixels.');
  }
  if (task.alpha_policy === 'straight-alpha' && (transparent === 0 || visible === 0)) {
    throw new Error('Straight-alpha output requires visible and transparent pixels.');
  }
  const columns = width / cellWidth;
  const rows = height / cellHeight;
  const occupied = occupiedCellKeys(task);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const expectedVisible = occupied.has(`${column}:${row}`);
      let cellVisible = 0;
      let paddingTouched = false;
      for (let y = 0; y < cellHeight; y += 1) {
        for (let x = 0; x < cellWidth; x += 1) {
          const offset = pixelOffset(
            width,
            column * cellWidth + x,
            row * cellHeight + y,
          );
          if (rgba[offset + 3] > 0) {
            cellVisible += 1;
            if (x === 0 || y === 0 || x === cellWidth - 1 || y === cellHeight - 1) {
              paddingTouched = true;
            }
          }
        }
      }
      if (expectedVisible && cellVisible === 0) {
        throw new Error(`Mapped production grid cell ${column}:${row} is empty.`);
      }
      if (!expectedVisible && cellVisible > 0) {
        throw new Error(`Unmapped production grid cell ${column}:${row} must remain transparent.`);
      }
      if (expectedVisible && task.seam_policy === 'transparent-cell-padding' && paddingTouched) {
        throw new Error(`Production grid cell ${column}:${row} touches its transparent boundary.`);
      }
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function cellBytes(
  task: ProductionArtTaskV1_1,
  rgba: Uint8Array,
  cells: readonly GridCell[],
): Uint8Array {
  const { width, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  const output = new Uint8Array(cells.length * cellWidth * cellHeight * 4);
  let target = 0;
  for (const cell of cells) {
    for (let y = 0; y < cellHeight; y += 1) {
      const source = pixelOffset(
        width,
        cell.column * cellWidth,
        cell.row * cellHeight + y,
      );
      const row = rgba.subarray(source, source + cellWidth * 4);
      output.set(row, target);
      target += row.byteLength;
    }
  }
  return output;
}

async function slotEvidence(
  task: ProductionArtTaskV1_1,
  rgba: Uint8Array,
): Promise<readonly ProductionArtSlotCellEvidenceV1_1[]> {
  const cells = slotCells(task);
  return Object.freeze(await Promise.all(task.slot_mappings.map(async (slot) => {
    const occupied = cells.get(slot.slot_id);
    if (!occupied) throw new Error(`Production art slot ${slot.slot_id} has no occupied cells.`);
    return Object.freeze({
      slot_id: slot.slot_id,
      requirement_id: slot.requirement_id,
      role: slot.role,
      variant_id: slot.variant_id,
      atlas_cell: Object.freeze({ ...slot.grid_rect }),
      occupied_cell_count: occupied.length,
      cell_sha256: await sha256(cellBytes(task, rgba, occupied)),
    });
  })));
}

async function confirmedInput(
  input: NormalizeProductionArtPngV1_1Input,
): Promise<Readonly<{
  plan: ProductionArtPlanV1_1;
  requirements: AssetRequirementsV1_1;
  task: ProductionArtTaskV1_1;
}>> {
  const requirements = await materializeAssetRequirementsV1_1(input.requirements);
  const plan = await materializeProductionArtPlanV1_1(input.plan, requirements);
  if (!isRecord(input.task) || typeof input.task.task_id !== 'string') {
    throw new Error('ProductionArtPlan 1.1 task input is invalid.');
  }
  const selectedTaskId = input.task.task_id;
  const task = plan.tasks.find(({ task_id: taskId }) => taskId === selectedTaskId);
  if (!task || canonicalJson(input.task) !== canonicalJson(task)) {
    throw new Error('Production art task does not exactly match the verified Plan 1.1 task.');
  }
  if (
    !isRecord(input.source)
    || input.source.media_type !== 'image/png'
    || !Number.isSafeInteger(input.source.width)
    || input.source.width < 1
    || !Number.isSafeInteger(input.source.height)
    || input.source.height < 1
    || !Number.isSafeInteger(input.source.byteLength)
    || input.source.byteLength < 1
    || input.source.byteLength > MAX_PNG_BYTES
    || typeof input.source.readBytes !== 'function'
  ) {
    throw new Error('Local production PNG source metadata is invalid.');
  }
  return Object.freeze({ plan, requirements, task });
}

export async function normalizeProductionArtPngV1_1(
  input: NormalizeProductionArtPngV1_1Input,
): Promise<NormalizedProductionArtResultV1_1> {
  const { plan, requirements, task } = await confirmedInput(input);
  const sourceBytes = input.source.readBytes();
  if (sourceBytes.byteLength !== input.source.byteLength) {
    throw new Error('Local production PNG source bytes changed after metadata binding.');
  }
  const decoded = await decodeReferenceImageRgba(sourceBytes, 'image/png');
  if (decoded.width !== input.source.width || decoded.height !== input.source.height) {
    throw new Error('Decoded production PNG dimensions changed after local source validation.');
  }
  const horizontalScale = decoded.width / task.target.width;
  const verticalScale = decoded.height / task.target.height;
  if (
    !Number.isSafeInteger(horizontalScale)
    || horizontalScale < 1
    || horizontalScale !== verticalScale
  ) {
    throw new Error('Production source PNG must be one integer scale of the Plan 1.1 target grid.');
  }
  const alphaRgba = task.alpha_policy === 'opaque'
    ? forceOpaque(decoded.rgba)
    : extractEdgeConnectedChroma(decoded.width, decoded.height, decoded.rgba);
  const normalizedRgba = resizeNearest(
    { width: decoded.width, height: decoded.height, rgba: alphaRgba },
    task.target.width,
    task.target.height,
  );
  assertPixelContract(task, normalizedRgba);
  const normalizedBytes = encodeRgbaPng(
    task.target.width,
    task.target.height,
    normalizedRgba,
  );
  const [sourceSha256, normalizedSha256, planSha256, requirementsSha256, slots] =
    await Promise.all([
      sha256(sourceBytes),
      sha256(normalizedBytes),
      fingerprintProductionArtPlanV1_1(plan, requirements),
      fingerprintAssetRequirementsV1_1(requirements),
      slotEvidence(task, normalizedRgba),
    ]);
  const output = await buildProductionArtOutputV1_1(plan, requirements, {
    taskId: task.task_id,
    assetId: input.asset_id,
    bytes: normalizedBytes.byteLength,
    sha256: normalizedSha256,
    sourceReferenceIds: input.source_reference_ids,
  });
  const evidence: ProductionArtGenerationEvidenceV1_1 = Object.freeze({
    schema_version: '1.1.0',
    document_type: 'production-art-generation-evidence',
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    source_binding: Object.freeze({
      plan_sha256: planSha256,
      requirements_sha256: requirementsSha256,
    }),
    source_png: Object.freeze({
      media_type: 'image/png',
      bytes: sourceBytes.byteLength,
      sha256: sourceSha256,
      width: decoded.width,
      height: decoded.height,
    }),
    normalized_png: Object.freeze({
      media_type: 'image/png',
      bytes: normalizedBytes.byteLength,
      sha256: normalizedSha256,
      width: task.target.width,
      height: task.target.height,
      alpha_policy: task.alpha_policy,
    }),
    slots,
    postprocess: Object.freeze({
      resize: 'nearest-neighbor-v1',
      alpha_extraction: task.alpha_policy === 'opaque'
        ? 'none'
        : 'edge-connected-green-chroma-v1',
      transparent_rgb_zeroed: true,
      mapped_grid_cells_checked: true,
      unmapped_grid_cells_transparent: true,
      character_pose_cells_checked: true,
    }),
    human_review: 'required',
  });
  const sourceSnapshot = Uint8Array.from(sourceBytes);
  const normalizedSnapshot = Uint8Array.from(normalizedBytes);
  return Object.freeze({
    output,
    evidence,
    source: Object.freeze({
      byteLength: sourceSnapshot.byteLength,
      readBytes: () => Uint8Array.from(sourceSnapshot),
    }),
    normalized: Object.freeze({
      byteLength: normalizedSnapshot.byteLength,
      readBytes: () => Uint8Array.from(normalizedSnapshot),
    }),
  });
}
