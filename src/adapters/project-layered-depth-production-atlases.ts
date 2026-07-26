import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type { NormalizedProductionArtResult } from './normalize-production-art-png';
import {
  assertValidProductionArtOutput,
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../core/production-art-contract';
import type {
  Pack10FileRecord,
  Pack10Manifest,
  Pack10RoleBinding,
} from '../core/pack-manifest-1.0';

const PROJECTION_SCHEMA_VERSION = '1.0.0' as const;
const APPROVED_DIRECTION_REFERENCE_ID = 'approved-scene-direction';
const MINIMUM_VISIBLE_PIXELS = 4;

const ATLAS_DEFINITIONS = Object.freeze([
  {
    id: 'terrain',
    path: 'atlases/terrain.png',
    sourceTaskId: 'terrain-sheet',
    sourceKind: 'opaque-tile-sheet',
    sourceCellSize: Object.freeze([64, 64] as const),
    sourcePivot: Object.freeze([32, 64] as const),
    runtimeCellSize: Object.freeze([64, 128] as const),
    roles: Object.freeze([
      'terrain.ground',
      'terrain.path',
      'terrain.edge',
      'terrain.bridge',
      'terrain.stairs',
      'terrain.water',
    ]),
    requiresTransparentBoundary: false,
  },
  {
    id: 'props',
    path: 'atlases/props.png',
    sourceTaskId: 'prop-sheet',
    sourceKind: 'transparent-prop-sheet',
    sourceCellSize: Object.freeze([96, 96] as const),
    sourcePivot: Object.freeze([48, 88] as const),
    runtimeCellSize: Object.freeze([96, 176] as const),
    roles: Object.freeze([
      'prop.tree',
      'prop.rock',
      'prop.crate',
      'prop.sign',
      'prop.lamp',
      'prop.occluder',
    ]),
    requiresTransparentBoundary: true,
  },
  {
    id: 'structures',
    path: 'atlases/structures.png',
    sourceTaskId: 'prop-sheet',
    sourceKind: 'transparent-prop-sheet',
    sourceCellSize: Object.freeze([96, 96] as const),
    sourcePivot: Object.freeze([48, 88] as const),
    runtimeCellSize: Object.freeze([96, 176] as const),
    roles: Object.freeze([
      'structure.entrance',
      'structure.exit',
      'structure.checkpoint',
      'structure.landmark',
    ]),
    requiresTransparentBoundary: true,
  },
  {
    id: 'collectibles',
    path: 'atlases/collectibles.png',
    sourceTaskId: 'prop-sheet',
    sourceKind: 'transparent-prop-sheet',
    sourceCellSize: Object.freeze([96, 96] as const),
    sourcePivot: Object.freeze([48, 88] as const),
    runtimeCellSize: Object.freeze([96, 176] as const),
    roles: Object.freeze([
      'collectible.primary',
      'collectible.health',
    ]),
    requiresTransparentBoundary: true,
  },
  {
    id: 'effects',
    path: 'atlases/effects.png',
    sourceTaskId: 'effect-sheet',
    sourceKind: 'effect-sheet',
    sourceCellSize: Object.freeze([64, 64] as const),
    sourcePivot: Object.freeze([32, 32] as const),
    runtimeCellSize: Object.freeze([64, 64] as const),
    roles: Object.freeze([
      'effect.footstep',
      'effect.interact',
      'effect.portal',
      'effect.ambient',
    ]),
    requiresTransparentBoundary: true,
  },
] as const);

const SOURCE_TASK_IDS = Object.freeze([
  'terrain-sheet',
  'prop-sheet',
  'effect-sheet',
] as const);

type AtlasDefinition = typeof ATLAS_DEFINITIONS[number];
type Pack10Atlas = Pack10Manifest['atlases'][number];

export type LayeredDepthAtlasProjectionErrorCode =
  | 'atlas-projection.invalid-inventory'
  | 'atlas-projection.invalid-direction'
  | 'atlas-projection.style-binding'
  | 'atlas-projection.integrity'
  | 'atlas-projection.invalid-grid'
  | 'atlas-projection.unmapped-cell'
  | 'atlas-projection.empty-cell'
  | 'atlas-projection.padding'
  | 'atlas-projection.duplicate-cell';

export class LayeredDepthAtlasProjectionError extends Error {
  constructor(
    readonly code: LayeredDepthAtlasProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LayeredDepthAtlasProjectionError';
  }
}

export interface LayeredDepthProductionAtlasProjectionRecord {
  readonly schema_version: typeof PROJECTION_SCHEMA_VERSION;
  readonly document_type: 'production-environment-atlas-pack10-projection';
  readonly profile: 'layered-depth-2d';
  readonly plan_id: string;
  readonly approved_direction: {
    readonly task_id: 'scene-direction';
    readonly normalized_sha256: string;
  };
  readonly atlases: readonly Readonly<{
    id: string;
    path: string;
    roles: readonly string[];
    source_task_id: string;
    source_normalized_sha256: string;
    source_cell_size: readonly [number, number];
    source_pivot: readonly [number, number];
    cell_size: readonly [number, number];
    runtime_cell_center: readonly [number, number];
    pivot_transform: 'source-pivot-to-runtime-cell-center-v1';
    width: number;
    height: number;
    bytes: number;
    sha256: string;
    alpha_policy: 'straight-alpha';
    seam_policy: 'tileable-cells' | 'transparent-cell-padding';
  }>[];
  readonly checks: {
    readonly exact_canonical_source_tasks: true;
    readonly approved_direction_bound: true;
    readonly normalized_evidence_bound: true;
    readonly mapped_cells_nonempty: true;
    readonly unmapped_cells_transparent: true;
    readonly transparent_rgb_zeroed: true;
    readonly binary_alpha_checked: true;
    readonly transparent_boundaries_checked: true;
    readonly exact_duplicates_rejected: true;
    readonly pivot_baked_to_cell_center: true;
  };
  readonly seam_review: 'required';
  readonly human_review: 'required';
}

export interface ProjectedProductionAtlas {
  readonly atlas: Pack10Atlas;
  readonly roleBindings: readonly Pack10RoleBinding[];
  readonly file: Pack10FileRecord;
  readonly png: {
    readonly byteLength: number;
    readBytes(): Uint8Array;
  };
}

export interface LayeredDepthProductionAtlasProjection {
  readonly atlases: readonly ProjectedProductionAtlas[];
  readonly record: LayeredDepthProductionAtlasProjectionRecord;
}

interface VerifiedSource {
  readonly task: ProductionArtTask;
  readonly sha256: string;
  readonly decoded: Awaited<ReturnType<typeof decodeReferenceImageRgba>>;
}

function fail(
  code: LayeredDepthAtlasProjectionErrorCode,
  message: string,
): never {
  throw new LayeredDepthAtlasProjectionError(code, message);
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function exactCanonicalTask(plan: ProductionArtPlan, taskId: string): ProductionArtTask {
  const task = plan.tasks.find(({ task_id: id }) => id === taskId);
  const canonical = createProductionArtPlan('layered-depth-2d', plan.rights)
    .tasks.find(({ task_id: id }) => id === taskId);
  if (!task || !canonical || JSON.stringify(task) !== JSON.stringify(canonical)) {
    fail(
      'atlas-projection.invalid-grid',
      `Atlas projection requires the exact canonical ${taskId} task.`,
    );
  }
  return task;
}

async function verifiedBytes(
  plan: ProductionArtPlan,
  result: NormalizedProductionArtResult,
  task: ProductionArtTask,
): Promise<VerifiedSource> {
  assertValidProductionArtOutput(result.output, plan);
  if (result.output.task_id !== task.task_id) {
    fail('atlas-projection.invalid-inventory', 'Normalized atlas result targets the wrong task.');
  }
  const bytes = result.normalized.readBytes();
  const digest = await sha256(bytes);
  if (
    result.normalized.byteLength !== bytes.byteLength
    || result.output.bytes !== bytes.byteLength
    || result.output.sha256 !== digest
    || result.evidence.plan_id !== plan.plan_id
    || result.evidence.task_id !== task.task_id
    || result.evidence.normalized.bytes !== bytes.byteLength
    || result.evidence.normalized.sha256 !== digest
    || result.evidence.normalized.width !== task.target.width
    || result.evidence.normalized.height !== task.target.height
  ) {
    fail('atlas-projection.integrity', 'Normalized atlas bytes and evidence do not match.');
  }
  const decoded = await decodeReferenceImageRgba(bytes, 'image/png');
  if (decoded.width !== task.target.width || decoded.height !== task.target.height) {
    fail('atlas-projection.integrity', 'Decoded atlas dimensions changed after normalization.');
  }
  return { task, sha256: digest, decoded };
}

function mappedCells(task: ProductionArtTask): ReadonlyMap<string, string> {
  const occupied = new Map<string, string>();
  for (const mapping of task.role_mappings) {
    const rect = mapping.grid_rect;
    if (rect.column_span !== 1 || rect.row_span !== 1) {
      fail('atlas-projection.invalid-grid', `${mapping.role} must occupy exactly one source cell.`);
    }
    occupied.set(`${rect.column}:${rect.row}`, mapping.role);
  }
  return occupied;
}

function assertSourceSheet(source: VerifiedSource): void {
  const { task, decoded } = source;
  const columns = task.target.width / task.target.cell_width;
  const rows = task.target.height / task.target.cell_height;
  const occupied = mappedCells(task);
  const visibleByRole = new Map(task.role_mappings.map(({ role }) => [role, 0]));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const role = occupied.get(`${column}:${row}`);
      let visible = 0;
      for (let y = row * task.target.cell_height; y < (row + 1) * task.target.cell_height; y += 1) {
        for (let x = column * task.target.cell_width; x < (column + 1) * task.target.cell_width; x += 1) {
          const offset = pixelOffset(decoded.width, x, y);
          const alpha = decoded.rgba[offset + 3];
          if (alpha !== 0 && alpha !== 255) {
            fail('atlas-projection.integrity', `${task.task_id} contains unsupported partial alpha.`);
          }
          if (alpha === 0) {
            if (
              decoded.rgba[offset] !== 0
              || decoded.rgba[offset + 1] !== 0
              || decoded.rgba[offset + 2] !== 0
            ) {
              fail(
                'atlas-projection.integrity',
                `${task.task_id} contains non-zero RGB under transparent pixels.`,
              );
            }
          } else {
            visible += 1;
          }
        }
      }
      if (!role && visible > 0) {
        fail(
          'atlas-projection.unmapped-cell',
          `${task.task_id} contains pixels in undeclared source cell ${column}:${row}.`,
        );
      }
      if (role) visibleByRole.set(role, visible);
    }
  }
  for (const [role, visible] of visibleByRole) {
    if (visible < MINIMUM_VISIBLE_PIXELS) {
      fail('atlas-projection.empty-cell', `${role} has no usable source pixels.`);
    }
  }
}

function projectMappedCell(
  source: VerifiedSource,
  definition: AtlasDefinition,
  role: string,
): Uint8Array {
  const mapping = source.task.role_mappings.find(({ role: mappedRole }) => mappedRole === role);
  if (!mapping || mapping.grid_rect.column_span !== 1 || mapping.grid_rect.row_span !== 1) {
    fail('atlas-projection.invalid-grid', `Missing canonical grid cell for ${role}.`);
  }
  const sourceLeft = mapping.grid_rect.column * source.task.target.cell_width;
  const sourceTop = mapping.grid_rect.row * source.task.target.cell_height;
  const [sourceCellWidth, sourceCellHeight] = definition.sourceCellSize;
  const [runtimeCellWidth, runtimeCellHeight] = definition.runtimeCellSize;
  if (
    source.task.target.cell_width !== sourceCellWidth
    || source.task.target.cell_height !== sourceCellHeight
    || source.task.pivot.x !== definition.sourcePivot[0]
    || source.task.pivot.y !== definition.sourcePivot[1]
    || runtimeCellWidth / 2 !== definition.sourcePivot[0]
    || runtimeCellHeight / 2 !== definition.sourcePivot[1]
  ) {
    fail('atlas-projection.invalid-grid', `${role} pivot geometry is not canonical.`);
  }
  const output = new Uint8Array(runtimeCellWidth * runtimeCellHeight * 4);
  for (let y = 0; y < sourceCellHeight; y += 1) {
    for (let x = 0; x < sourceCellWidth; x += 1) {
      const sourceOffset = pixelOffset(
        source.decoded.width,
        sourceLeft + x,
        sourceTop + y,
      );
      output.set(
        source.decoded.rgba.subarray(sourceOffset, sourceOffset + 4),
        pixelOffset(runtimeCellWidth, x, y),
      );
    }
  }
  return output;
}

function assertRuntimeCell(
  role: string,
  rgba: Uint8Array,
  definition: AtlasDefinition,
): void {
  const [runtimeCellWidth, runtimeCellHeight] = definition.runtimeCellSize;
  const [sourceCellWidth, sourceCellHeight] = definition.sourceCellSize;
  let visible = 0;
  for (let y = 0; y < runtimeCellHeight; y += 1) {
    for (let x = 0; x < runtimeCellWidth; x += 1) {
      const offset = pixelOffset(runtimeCellWidth, x, y);
      const alpha = rgba[offset + 3];
      if (alpha === 0) {
        if (rgba[offset] !== 0 || rgba[offset + 1] !== 0 || rgba[offset + 2] !== 0) {
          fail('atlas-projection.integrity', `${role} transparent RGB is not zero.`);
        }
      } else {
        if (alpha !== 255) {
          fail('atlas-projection.integrity', `${role} contains unsupported partial alpha.`);
        }
        visible += 1;
        if (
          definition.requiresTransparentBoundary
          && (x === 0 || y === 0 || x === sourceCellWidth - 1 || y === sourceCellHeight - 1)
        ) {
          fail('atlas-projection.padding', `${role} touches its runtime cell boundary.`);
        }
      }
    }
  }
  if (visible < MINIMUM_VISIBLE_PIXELS) {
    fail('atlas-projection.empty-cell', `${role} has no usable runtime pixels.`);
  }
}

async function assertDistinctCells(
  cells: readonly Readonly<{ role: string; rgba: Uint8Array }>[],
): Promise<void> {
  const seen = new Map<string, string>();
  for (const cell of cells) {
    const digest = await sha256(cell.rgba);
    const previous = seen.get(digest);
    if (previous) {
      fail(
        'atlas-projection.duplicate-cell',
        `${cell.role} duplicates the runtime pixels of ${previous}.`,
      );
    }
    seen.set(digest, cell.role);
  }
}

function writeAtlas(
  cells: readonly Readonly<{ role: string; rgba: Uint8Array }>[],
  definition: AtlasDefinition,
): Uint8Array {
  const [cellWidth, cellHeight] = definition.runtimeCellSize;
  const width = cells.length * cellWidth;
  const rgba = new Uint8Array(width * cellHeight * 4);
  cells.forEach((cell, index) => {
    const targetLeft = index * cellWidth;
    for (let y = 0; y < cellHeight; y += 1) {
      const sourceOffset = pixelOffset(cellWidth, 0, y);
      const targetOffset = pixelOffset(width, targetLeft, y);
      rgba.set(
        cell.rgba.subarray(sourceOffset, sourceOffset + cellWidth * 4),
        targetOffset,
      );
    }
  });
  return encodeRgbaPng(width, cellHeight, rgba);
}

/**
 * Projects the three normalized layered-depth gameplay sheets into the five
 * canonical Pack 1.0 environment atlases. Source direction and normalized
 * evidence are hash-bound, while source images and prompts stay outside the pack.
 */
export async function projectLayeredDepthProductionAtlases(
  plan: ProductionArtPlan,
  approvedDirection: NormalizedProductionArtResult,
  atlasResults: readonly NormalizedProductionArtResult[],
): Promise<LayeredDepthProductionAtlasProjection> {
  if (plan.profile !== 'layered-depth-2d') {
    fail('atlas-projection.invalid-inventory', 'Atlas projection requires a layered-depth plan.');
  }
  const directionTask = exactCanonicalTask(plan, 'scene-direction');
  const direction = await verifiedBytes(plan, approvedDirection, directionTask);
  if (
    approvedDirection.output.source_reference_ids.includes(APPROVED_DIRECTION_REFERENCE_ID)
    || approvedDirection.output.roles.length !== 1
    || approvedDirection.output.roles[0] !== 'world.preview'
  ) {
    fail('atlas-projection.invalid-direction', 'Approved direction output binding is invalid.');
  }

  const resultByTask = new Map<string, NormalizedProductionArtResult>();
  for (const result of atlasResults) {
    if (resultByTask.has(result.output.task_id)) {
      fail('atlas-projection.invalid-inventory', 'Atlas projection received a duplicate task result.');
    }
    resultByTask.set(result.output.task_id, result);
  }
  if (
    resultByTask.size !== SOURCE_TASK_IDS.length
    || [...resultByTask.keys()].some((taskId) =>
      !(SOURCE_TASK_IDS as readonly string[]).includes(taskId))
  ) {
    fail(
      'atlas-projection.invalid-inventory',
      'Atlas projection requires exactly terrain-sheet, prop-sheet and effect-sheet.',
    );
  }

  const sources = new Map<string, VerifiedSource>();
  for (const taskId of SOURCE_TASK_IDS) {
    const task = exactCanonicalTask(plan, taskId);
    const result = resultByTask.get(taskId);
    if (!result) {
      fail('atlas-projection.invalid-inventory', `Missing canonical source task: ${taskId}.`);
    }
    if (
      result.output.source_reference_ids.length < 1
      || !result.output.source_reference_ids.includes(APPROVED_DIRECTION_REFERENCE_ID)
    ) {
      fail('atlas-projection.style-binding', `${taskId} is not bound to the approved direction.`);
    }
    const source = await verifiedBytes(plan, result, task);
    assertSourceSheet(source);
    sources.set(taskId, source);
  }

  const projected: ProjectedProductionAtlas[] = [];
  const recordAtlases: LayeredDepthProductionAtlasProjectionRecord['atlases'][number][] = [];
  const allRuntimeCells: Readonly<{ role: string; rgba: Uint8Array }>[] = [];
  for (const definition of ATLAS_DEFINITIONS) {
    const source = sources.get(definition.sourceTaskId);
    if (!source || source.task.kind !== definition.sourceKind) {
      fail(
        'atlas-projection.invalid-inventory',
        `${definition.id} has no matching canonical production source.`,
      );
    }
    const cells = definition.roles.map((role) => {
      const rgba = projectMappedCell(source, definition, role);
      assertRuntimeCell(role, rgba, definition);
      return Object.freeze({ role, rgba });
    });
    allRuntimeCells.push(...cells);
    const pngBytes = writeAtlas(cells, definition);
    const digest = await sha256(pngBytes);
    const snapshot = Uint8Array.from(pngBytes);
    const [cellWidth, cellHeight] = definition.runtimeCellSize;
    const width = cells.length * cellWidth;
    const atlas: Pack10Atlas = Object.freeze({
      id: definition.id,
      path: definition.path,
      cell_size: definition.runtimeCellSize,
    });
    const roleBindings = Object.freeze(definition.roles.map((role, index) =>
      Object.freeze({
        role,
        binding: Object.freeze({
          kind: 'atlas-region' as const,
          atlas: definition.id,
          region: Object.freeze({
            x: index * cellWidth,
            y: 0,
            width: cellWidth,
            height: cellHeight,
          }),
        }),
      })));
    const file: Pack10FileRecord = Object.freeze({
      path: definition.path,
      media_type: 'image/png',
      bytes: snapshot.byteLength,
      sha256: digest,
    });
    projected.push(Object.freeze({
      atlas,
      roleBindings,
      file,
      png: Object.freeze({
        byteLength: snapshot.byteLength,
        readBytes: () => Uint8Array.from(snapshot),
      }),
    }));
    recordAtlases.push(Object.freeze({
      id: definition.id,
      path: definition.path,
      roles: definition.roles,
      source_task_id: definition.sourceTaskId,
      source_normalized_sha256: source.sha256,
      source_cell_size: definition.sourceCellSize,
      source_pivot: definition.sourcePivot,
      cell_size: definition.runtimeCellSize,
      runtime_cell_center: Object.freeze([cellWidth / 2, cellHeight / 2] as const),
      pivot_transform: 'source-pivot-to-runtime-cell-center-v1',
      width,
      height: cellHeight,
      bytes: snapshot.byteLength,
      sha256: digest,
      alpha_policy: source.task.alpha_policy as 'straight-alpha',
      seam_policy: source.task.seam_policy as 'tileable-cells' | 'transparent-cell-padding',
    }));
  }
  await assertDistinctCells(allRuntimeCells);

  const record: LayeredDepthProductionAtlasProjectionRecord = Object.freeze({
    schema_version: PROJECTION_SCHEMA_VERSION,
    document_type: 'production-environment-atlas-pack10-projection',
    profile: 'layered-depth-2d',
    plan_id: plan.plan_id,
    approved_direction: Object.freeze({
      task_id: 'scene-direction',
      normalized_sha256: direction.sha256,
    }),
    atlases: Object.freeze(recordAtlases),
    checks: Object.freeze({
      exact_canonical_source_tasks: true,
      approved_direction_bound: true,
      normalized_evidence_bound: true,
      mapped_cells_nonempty: true,
      unmapped_cells_transparent: true,
      transparent_rgb_zeroed: true,
      binary_alpha_checked: true,
      transparent_boundaries_checked: true,
      exact_duplicates_rejected: true,
      pivot_baked_to_cell_center: true,
    }),
    seam_review: 'required',
    human_review: 'required',
  });
  return Object.freeze({
    atlases: Object.freeze(projected),
    record,
  });
}
