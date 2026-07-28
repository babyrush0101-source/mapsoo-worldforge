import {
  lstat,
  open,
  readdir,
  realpath,
} from 'node:fs/promises';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type {
  NormalizedProductionArtResultV1_1,
  ProductionArtGenerationEvidenceV1_1,
  ProductionArtSlotCellEvidenceV1_1,
} from './normalize-production-art-png-v1-1';
import {
  materializeAssetRequirementsV1_1,
  type AssetRequirementsV1_1,
} from '../core/asset-requirements-v1-1';
import {
  materializeProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../core/production-art-contract-v1-1';
import {
  fingerprintProductionArtOutputV1_1,
  materializeProductionArtOutputV1_1,
  type ProductionArtOutputV1_1,
} from '../core/production-art-output-v1-1';
import {
  materializeProductionArtRunSetV1_1,
  type ProductionArtRunSetV1_1,
} from '../core/production-art-run-set-v1-1';

const MAX_PNG_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_FILES = Object.freeze([
  'source.png',
  'normalized.png',
  'output.json',
  'evidence.json',
] as const);
const CHARACTER_PROJECTION_FILES = Object.freeze([
  'character-profile-atlas.png',
  'character-profile-revision.json',
  'character-profile-projection.json',
  'character-profile-projection-rejection.json',
  'projection-rejection.json',
] as const);
const ALLOWED_FILES = new Set<string>([
  ...REQUIRED_FILES,
  ...CHARACTER_PROJECTION_FILES,
]);

export interface LoadProductionArtRunSetV1_1WorkspaceInput {
  readonly requirements: unknown;
  readonly plan: unknown;
  readonly runSet: unknown;
  readonly modelRunsRoot: string;
}

export interface LoadedProductionArtRunSetV1_1Workspace {
  readonly requirements: AssetRequirementsV1_1;
  readonly plan: ProductionArtPlanV1_1;
  readonly runSet: ProductionArtRunSetV1_1;
  readonly normalizedResults: readonly NormalizedProductionArtResultV1_1[];
}

export type ProductionArtRunSetV1_1WorkspaceErrorCode =
  | 'production-art-workspace-1.1.invalid-source'
  | 'production-art-workspace-1.1.invalid-root'
  | 'production-art-workspace-1.1.path-escape'
  | 'production-art-workspace-1.1.path-alias'
  | 'production-art-workspace-1.1.invalid-inventory'
  | 'production-art-workspace-1.1.file-too-large'
  | 'production-art-workspace-1.1.invalid-json'
  | 'production-art-workspace-1.1.invalid-output'
  | 'production-art-workspace-1.1.invalid-evidence'
  | 'production-art-workspace-1.1.integrity';

export class ProductionArtRunSetV1_1WorkspaceError extends Error {
  constructor(
    readonly code: ProductionArtRunSetV1_1WorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionArtRunSetV1_1WorkspaceError';
  }
}

type GridCell = Readonly<{ column: number; row: number }>;

function fail(
  code: ProductionArtRunSetV1_1WorkspaceErrorCode,
  message: string,
): never {
  throw new ProductionArtRunSetV1_1WorkspaceError(code, message);
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
      'production-art-workspace-1.1.invalid-evidence',
      `${label} contains unsupported or missing fields.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('production-art-workspace-1.1.integrity', 'A bound document contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('production-art-workspace-1.1.integrity', 'A bound document contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function normalizedPathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isStrictlyInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot.length > 0
    && fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseStrictJson(bytes: Uint8Array, taskId: string, label: string): unknown {
  try {
    if (
      bytes.byteLength >= 3
      && bytes[0] === 0xef
      && bytes[1] === 0xbb
      && bytes[2] === 0xbf
    ) {
      fail(
        'production-art-workspace-1.1.invalid-json',
        `${taskId} ${label} must not contain a UTF-8 byte-order mark.`,
      );
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ProductionArtRunSetV1_1WorkspaceError) throw error;
    fail(
      'production-art-workspace-1.1.invalid-json',
      `${taskId} ${label} must be strict UTF-8 JSON.`,
    );
  }
}

async function readBoundFile(
  runDirectory: string,
  filename: string,
  maximumBytes: number,
  taskId: string,
  seenFiles: Set<string>,
): Promise<Uint8Array> {
  const path = join(runDirectory, filename);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  let canonicalPath: string;
  try {
    metadata = await lstat(path);
    canonicalPath = await realpath(path);
  } catch {
    fail(
      'production-art-workspace-1.1.invalid-inventory',
      `${taskId} is missing required file ${filename}.`,
    );
  }
  if (
    metadata.isSymbolicLink()
    || !metadata.isFile()
    || !isStrictlyInside(runDirectory, canonicalPath)
    || normalizedPathKey(canonicalPath) !== normalizedPathKey(path)
  ) {
    fail(
      'production-art-workspace-1.1.path-escape',
      `${taskId} required file ${filename} is not a direct regular file.`,
    );
  }
  const canonicalKey = normalizedPathKey(canonicalPath);
  if (seenFiles.has(canonicalKey)) {
    fail(
      'production-art-workspace-1.1.path-alias',
      `${taskId} required file ${filename} aliases another workspace file.`,
    );
  }
  seenFiles.add(canonicalKey);
  if (metadata.size < 1 || metadata.size > maximumBytes) {
    fail(
      'production-art-workspace-1.1.file-too-large',
      `${taskId} required file ${filename} has an invalid size.`,
    );
  }
  const handle = await open(path, 'r').catch(() => fail(
    'production-art-workspace-1.1.invalid-inventory',
    `${taskId} required file ${filename} cannot be opened.`,
  ));
  try {
    const openedMetadata = await handle.stat();
    if (
      !openedMetadata.isFile()
      || openedMetadata.size !== metadata.size
      || openedMetadata.dev !== metadata.dev
      || openedMetadata.ino !== metadata.ino
    ) {
      fail(
        'production-art-workspace-1.1.integrity',
        `${taskId} required file ${filename} changed while loading.`,
      );
    }
    const bytes = Uint8Array.from(await handle.readFile());
    if (bytes.byteLength !== openedMetadata.size) {
      fail(
        'production-art-workspace-1.1.integrity',
        `${taskId} required file ${filename} changed while loading.`,
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
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

function frozenSlotEvidence(
  candidate: Record<string, unknown>,
): ProductionArtSlotCellEvidenceV1_1 {
  const atlasCell = candidate.atlas_cell as Record<string, number>;
  return Object.freeze({
    slot_id: candidate.slot_id as string,
    requirement_id: candidate.requirement_id as string,
    role: candidate.role as string,
    variant_id: candidate.variant_id as string,
    atlas_cell: Object.freeze({
      column: atlasCell.column,
      row: atlasCell.row,
      column_span: atlasCell.column_span,
      row_span: atlasCell.row_span,
    }),
    occupied_cell_count: candidate.occupied_cell_count as number,
    cell_sha256: candidate.cell_sha256 as string,
  });
}

async function validateEvidence(
  value: unknown,
  task: ProductionArtTaskV1_1,
  output: ProductionArtOutputV1_1,
  sourceBytes: Uint8Array,
  normalizedBytes: Uint8Array,
): Promise<ProductionArtGenerationEvidenceV1_1> {
  if (!isRecord(value)) {
    fail(
      'production-art-workspace-1.1.invalid-evidence',
      `${task.task_id} evidence must be an object.`,
    );
  }
  exactKeys(value, [
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
  ], `${task.task_id} evidence`);
  if (
    value.schema_version !== '1.1.0'
    || value.document_type !== 'production-art-generation-evidence'
    || value.plan_id !== output.plan_id
    || value.profile !== output.profile
    || value.task_id !== task.task_id
    || value.human_review !== 'required'
    || !isRecord(value.source_binding)
    || !isRecord(value.source_png)
    || !isRecord(value.normalized_png)
    || !isRecord(value.postprocess)
    || !Array.isArray(value.slots)
  ) {
    fail(
      'production-art-workspace-1.1.invalid-evidence',
      `${task.task_id} evidence identity is invalid.`,
    );
  }
  exactKeys(value.source_binding, ['plan_sha256', 'requirements_sha256'], 'Evidence source');
  exactKeys(
    value.source_png,
    ['media_type', 'bytes', 'sha256', 'width', 'height'],
    'Evidence source PNG',
  );
  exactKeys(
    value.normalized_png,
    ['media_type', 'bytes', 'sha256', 'width', 'height', 'alpha_policy'],
    'Evidence normalized PNG',
  );
  exactKeys(value.postprocess, [
    'resize',
    'alpha_extraction',
    'transparent_rgb_zeroed',
    'mapped_grid_cells_checked',
    'unmapped_grid_cells_transparent',
    'character_pose_cells_checked',
  ], 'Evidence postprocess');

  let sourceImage: Awaited<ReturnType<typeof decodeReferenceImageRgba>>;
  let normalizedImage: Awaited<ReturnType<typeof decodeReferenceImageRgba>>;
  try {
    [sourceImage, normalizedImage] = await Promise.all([
      decodeReferenceImageRgba(sourceBytes, 'image/png'),
      decodeReferenceImageRgba(normalizedBytes, 'image/png'),
    ]);
  } catch {
    fail(
      'production-art-workspace-1.1.integrity',
      `${task.task_id} source or normalized PNG cannot be decoded.`,
    );
  }
  const [sourceSha256, normalizedSha256] = await Promise.all([
    sha256Bytes(sourceBytes),
    sha256Bytes(normalizedBytes),
  ]);
  const sourcePng = value.source_png;
  const normalizedPng = value.normalized_png;
  const postprocess = value.postprocess;
  if (
    value.source_binding.plan_sha256 !== output.source.plan_sha256
    || value.source_binding.requirements_sha256 !== output.source.requirements_sha256
    || sourcePng.media_type !== 'image/png'
    || sourcePng.bytes !== sourceBytes.byteLength
    || sourcePng.sha256 !== sourceSha256
    || sourcePng.width !== sourceImage.width
    || sourcePng.height !== sourceImage.height
    || normalizedPng.media_type !== 'image/png'
    || normalizedPng.bytes !== normalizedBytes.byteLength
    || normalizedPng.sha256 !== normalizedSha256
    || normalizedPng.width !== normalizedImage.width
    || normalizedPng.height !== normalizedImage.height
    || normalizedPng.alpha_policy !== task.alpha_policy
    || normalizedImage.width !== task.target.width
    || normalizedImage.height !== task.target.height
    || output.bytes !== normalizedBytes.byteLength
    || output.sha256 !== normalizedSha256
    || postprocess.resize !== 'nearest-neighbor-v1'
    || postprocess.alpha_extraction !== (
      task.alpha_policy === 'opaque' ? 'none' : 'edge-connected-green-chroma-v1'
    )
    || postprocess.transparent_rgb_zeroed !== true
    || postprocess.mapped_grid_cells_checked !== true
    || postprocess.unmapped_grid_cells_transparent !== true
    || postprocess.character_pose_cells_checked !== true
  ) {
    fail(
      'production-art-workspace-1.1.integrity',
      `${task.task_id} evidence and required files differ.`,
    );
  }

  if (value.slots.length !== task.slot_mappings.length) {
    fail(
      'production-art-workspace-1.1.invalid-evidence',
      `${task.task_id} evidence slot inventory differs from its plan task.`,
    );
  }
  const slots: ProductionArtSlotCellEvidenceV1_1[] = [];
  for (const [index, slot] of task.slot_mappings.entries()) {
    const candidate = value.slots[index];
    if (!isRecord(candidate)) {
      fail(
        'production-art-workspace-1.1.invalid-evidence',
        `${task.task_id} evidence slot ${index} is invalid.`,
      );
    }
    exactKeys(candidate, [
      'slot_id',
      'requirement_id',
      'role',
      'variant_id',
      'atlas_cell',
      'occupied_cell_count',
      'cell_sha256',
    ], `${task.task_id} evidence slot ${index}`);
    if (!isRecord(candidate.atlas_cell)) {
      fail(
        'production-art-workspace-1.1.invalid-evidence',
        `${task.task_id} evidence slot ${index} atlas cell is invalid.`,
      );
    }
    exactKeys(
      candidate.atlas_cell,
      ['column', 'row', 'column_span', 'row_span'],
      `${task.task_id} evidence slot ${index} atlas cell`,
    );
    const cells = cellsForSlot(task, slot.slot_id);
    const actualCellSha256 = await sha256Bytes(
      rgbaForCells(task, normalizedImage.rgba, cells),
    );
    if (
      candidate.slot_id !== slot.slot_id
      || candidate.requirement_id !== slot.requirement_id
      || candidate.role !== slot.role
      || candidate.variant_id !== slot.variant_id
      || canonicalJson(candidate.atlas_cell) !== canonicalJson(slot.grid_rect)
      || candidate.occupied_cell_count !== cells.length
      || candidate.cell_sha256 !== actualCellSha256
      || !SHA256.test(String(candidate.cell_sha256))
    ) {
      fail(
        'production-art-workspace-1.1.invalid-evidence',
        `${task.task_id} evidence slot ${slot.slot_id} differs from normalized pixels.`,
      );
    }
    slots.push(frozenSlotEvidence(candidate));
  }

  return Object.freeze({
    schema_version: '1.1.0',
    document_type: 'production-art-generation-evidence',
    plan_id: output.plan_id,
    profile: output.profile,
    task_id: task.task_id,
    source_binding: Object.freeze({
      plan_sha256: output.source.plan_sha256,
      requirements_sha256: output.source.requirements_sha256,
    }),
    source_png: Object.freeze({
      media_type: 'image/png',
      bytes: sourceBytes.byteLength,
      sha256: sourceSha256,
      width: sourceImage.width,
      height: sourceImage.height,
    }),
    normalized_png: Object.freeze({
      media_type: 'image/png',
      bytes: normalizedBytes.byteLength,
      sha256: normalizedSha256,
      width: normalizedImage.width,
      height: normalizedImage.height,
      alpha_policy: task.alpha_policy,
    }),
    slots: Object.freeze(slots),
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
}

async function runDirectory(
  root: string,
  path: string,
  taskId: string,
  seenDirectories: Set<string>,
): Promise<string> {
  const unresolved = join(root, ...path.split('/'));
  let canonical: string;
  try {
    canonical = await realpath(unresolved);
  } catch {
    fail(
      'production-art-workspace-1.1.invalid-inventory',
      `${taskId} run directory is missing.`,
    );
  }
  if (!isStrictlyInside(root, canonical)) {
    fail(
      'production-art-workspace-1.1.path-escape',
      `${taskId} run directory resolves outside the model-runs root.`,
    );
  }
  const key = normalizedPathKey(canonical);
  if (seenDirectories.has(key)) {
    fail(
      'production-art-workspace-1.1.path-alias',
      `${taskId} run directory aliases another task directory.`,
    );
  }
  seenDirectories.add(key);
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    const metadata = await lstat(canonical);
    if (!metadata.isDirectory()) throw new Error('not-directory');
    entries = await readdir(canonical, { withFileTypes: true });
  } catch {
    fail(
      'production-art-workspace-1.1.invalid-inventory',
      `${taskId} run path is not a readable directory.`,
    );
  }
  const names = new Set(entries.map(({ name }) => name));
  if (
    entries.length < REQUIRED_FILES.length
    || REQUIRED_FILES.some((filename) => !names.has(filename))
    || entries.some((entry) =>
      !ALLOWED_FILES.has(entry.name)
      || !entry.isFile())
  ) {
    fail(
      'production-art-workspace-1.1.invalid-inventory',
      `${taskId} run directory has a missing, unsupported, or non-file entry.`,
    );
  }
  return canonical;
}

async function loadResult(
  root: string,
  task: ProductionArtTaskV1_1,
  run: ProductionArtRunSetV1_1['runs'][number],
  plan: ProductionArtPlanV1_1,
  requirements: AssetRequirementsV1_1,
  seenDirectories: Set<string>,
  seenFiles: Set<string>,
): Promise<NormalizedProductionArtResultV1_1> {
  const directory = await runDirectory(
    root,
    run.run_directory,
    task.task_id,
    seenDirectories,
  );
  const [sourceBytes, normalizedBytes, outputBytes, evidenceBytes] = await Promise.all([
    readBoundFile(
      directory,
      'source.png',
      MAX_PNG_BYTES,
      task.task_id,
      seenFiles,
    ),
    readBoundFile(
      directory,
      'normalized.png',
      MAX_PNG_BYTES,
      task.task_id,
      seenFiles,
    ),
    readBoundFile(
      directory,
      'output.json',
      MAX_JSON_BYTES,
      task.task_id,
      seenFiles,
    ),
    readBoundFile(
      directory,
      'evidence.json',
      MAX_JSON_BYTES,
      task.task_id,
      seenFiles,
    ),
  ]);
  let output: ProductionArtOutputV1_1;
  try {
    output = await materializeProductionArtOutputV1_1(
      parseStrictJson(outputBytes, task.task_id, 'output'),
      plan,
      requirements,
    );
  } catch (error) {
    if (
      error instanceof ProductionArtRunSetV1_1WorkspaceError
      && error.code === 'production-art-workspace-1.1.invalid-json'
    ) {
      throw error;
    }
    fail(
      'production-art-workspace-1.1.invalid-output',
      `${task.task_id} output is not bound to the canonical Plan 1.1 task.`,
    );
  }
  const [outputSha256, runOutputSha256] = await Promise.all([
    fingerprintProductionArtOutputV1_1(output, plan, requirements),
    fingerprintProductionArtOutputV1_1(run.output, plan, requirements),
  ]);
  if (
    canonicalJson(output) !== canonicalJson(run.output)
    || outputSha256 !== runOutputSha256
    || run.evidence.output_sha256 !== outputSha256
    || run.evidence.artifact_path !== output.path
    || run.evidence.bytes !== output.bytes
    || run.evidence.sha256 !== output.sha256
  ) {
    fail(
      'production-art-workspace-1.1.invalid-output',
      `${task.task_id} output differs from its RunSet 1.1 binding.`,
    );
  }
  const evidenceValue = parseStrictJson(evidenceBytes, task.task_id, 'evidence');
  const evidence = await validateEvidence(
    evidenceValue,
    task,
    output,
    sourceBytes,
    normalizedBytes,
  );
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

export async function loadProductionArtRunSetV1_1Workspace(
  input: LoadProductionArtRunSetV1_1WorkspaceInput,
): Promise<LoadedProductionArtRunSetV1_1Workspace> {
  let requirements: AssetRequirementsV1_1;
  let plan: ProductionArtPlanV1_1;
  let runSet: ProductionArtRunSetV1_1;
  try {
    requirements = await materializeAssetRequirementsV1_1(input.requirements);
    plan = await materializeProductionArtPlanV1_1(input.plan, requirements);
    runSet = await materializeProductionArtRunSetV1_1(
      input.runSet,
      plan,
      requirements,
    );
  } catch {
    fail(
      'production-art-workspace-1.1.invalid-source',
      'Requirements, Plan, and RunSet 1.1 must be canonical and mutually bound.',
    );
  }
  if (
    typeof input.modelRunsRoot !== 'string'
    || input.modelRunsRoot.length < 1
    || input.modelRunsRoot.trim() !== input.modelRunsRoot
  ) {
    fail(
      'production-art-workspace-1.1.invalid-root',
      'Model-runs root must be a non-empty local path.',
    );
  }
  let root: string;
  try {
    root = await realpath(resolve(input.modelRunsRoot));
    const metadata = await lstat(root);
    if (!metadata.isDirectory()) throw new Error('not-directory');
  } catch {
    fail(
      'production-art-workspace-1.1.invalid-root',
      'Model-runs root must be an existing readable directory.',
    );
  }

  const runByTask = new Map(runSet.runs.map((run) => [run.task_id, run]));
  const seenDirectories = new Set<string>();
  const seenFiles = new Set<string>();
  const normalizedResults: NormalizedProductionArtResultV1_1[] = [];
  for (const task of plan.tasks) {
    const run = runByTask.get(task.task_id);
    if (!run) {
      fail(
        'production-art-workspace-1.1.invalid-inventory',
        `${task.task_id} is absent from RunSet 1.1.`,
      );
    }
    normalizedResults.push(await loadResult(
      root,
      task,
      run,
      plan,
      requirements,
      seenDirectories,
      seenFiles,
    ));
  }

  return Object.freeze({
    requirements,
    plan,
    runSet,
    normalizedResults: Object.freeze(normalizedResults),
  });
}
