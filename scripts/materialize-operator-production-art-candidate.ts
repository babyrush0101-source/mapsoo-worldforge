import { createHash } from 'node:crypto';
import {
  readFile,
  writeFile,
} from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { encodeRgbaPng } from '../src/adapters/canvas/encode-png';
import { decodeReferenceImageRgba } from '../src/adapters/decode-reference-image-rgba';
import {
  createProductionArtPlan,
  type ProductionArtTask,
} from '../src/core/production-art-contract';
import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from '../src/core/asset-profile';

const MODES = Object.freeze([
  'proportional-grid',
  'component-reading-order',
] as const);
type MaterializationMode = typeof MODES[number];

const VALUE_FLAGS = new Set([
  '--profile',
  '--task',
  '--source',
  '--out',
  '--report',
  '--mode',
]);
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MIN_COMPONENT_PIXELS = 32;

interface Arguments {
  readonly profile: WorldAssetProfile;
  readonly taskId: string;
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly reportPath: string;
  readonly mode: MaterializationMode;
}

interface Raster {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Component extends Bounds {
  readonly pixels: number;
}

interface OccupiedCell {
  readonly role: string;
  readonly column: number;
  readonly row: number;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — operator-reviewed production-art candidate materializer',
    '',
    'Usage:',
    '  pnpm production-art:operator-import -- \\',
    '    --profile <profile> --task <task-id> --source <rgba.png> \\',
    '    --mode <proportional-grid|component-reading-order> \\',
    '    --out <candidate.png> --report <candidate.json>',
    '',
    'This command imports already-generated local PNG bytes. It does not call a',
    'remote model and does not grant redistribution rights. Reports intentionally',
    'record only source/output basenames and hashes, never absolute local paths.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Arguments {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(usage());
    process.exit(0);
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!VALUE_FLAGS.has(flag)) throw new Error(`Unknown flag: ${flag}.`);
    if (values.has(flag)) throw new Error(`Duplicate flag: ${flag}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    values.set(flag, value);
    index += 1;
  }
  const required = [...VALUE_FLAGS];
  for (const flag of required) {
    if (!values.has(flag)) throw new Error(`${flag} is required.`);
  }
  const profile = values.get('--profile') as string;
  const mode = values.get('--mode') as string;
  if (!isWorldAssetProfile(profile)) throw new Error('--profile is unsupported.');
  if (!MODES.includes(mode as MaterializationMode)) throw new Error('--mode is unsupported.');
  return {
    profile,
    taskId: values.get('--task') as string,
    sourcePath: resolve(values.get('--source') as string),
    outputPath: resolve(values.get('--out') as string),
    reportPath: resolve(values.get('--report') as string),
    mode: mode as MaterializationMode,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function sanitizeAlpha(image: Raster, task: ProductionArtTask): Raster {
  const rgba = Uint8Array.from(image.rgba);
  let visible = 0;
  let transparent = 0;
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    if (task.alpha_policy === 'opaque') {
      rgba[offset + 3] = 255;
      visible += 1;
      continue;
    }
    if (rgba[offset + 3] < 16) {
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 0;
      transparent += 1;
    } else {
      visible += 1;
    }
  }
  if (visible === 0) throw new Error('Operator source contains no visible pixels.');
  if (task.alpha_policy === 'straight-alpha' && transparent === 0) {
    throw new Error('Straight-alpha operator source contains no transparent pixels.');
  }
  return { width: image.width, height: image.height, rgba };
}

function resizeNearest(image: Raster, width: number, height: number): Raster {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const sourceOffset = pixelOffset(image.width, sourceX, sourceY);
      rgba.set(image.rgba.subarray(sourceOffset, sourceOffset + 4), pixelOffset(width, x, y));
    }
  }
  return { width, height, rgba };
}

function aspectDifference(image: Raster, task: ProductionArtTask): number {
  const sourceAspect = image.width / image.height;
  const targetAspect = task.target.width / task.target.height;
  return Math.abs(sourceAspect - targetAspect) / targetAspect;
}

function occupiedCells(task: ProductionArtTask): readonly OccupiedCell[] {
  if (task.kind === 'character-animation-sheet' && task.pose_mappings) {
    return task.pose_mappings.map((pose) => ({
      role: `${pose.role}:${pose.action}.${pose.direction}.frame-${pose.frame_index}`,
      column: pose.grid_cell.column,
      row: pose.grid_cell.row,
    }));
  }
  const cells: OccupiedCell[] = [];
  for (const mapping of task.role_mappings) {
    const rect = mapping.grid_rect;
    for (let row = rect.row; row < rect.row + rect.row_span; row += 1) {
      for (let column = rect.column; column < rect.column + rect.column_span; column += 1) {
        cells.push({ role: mapping.role, column, row });
      }
    }
  }
  return cells;
}

function visiblePixel(rgba: Uint8Array, index: number): boolean {
  return rgba[index * 4 + 3] >= 16;
}

function findComponents(image: Raster): {
  readonly components: readonly Component[];
  readonly ignoredPixels: number;
  readonly threshold: number;
} {
  const pixels = image.width * image.height;
  const visited = new Uint8Array(pixels);
  const discovered: Component[] = [];
  const queue = new Uint32Array(pixels);
  for (let start = 0; start < pixels; start += 1) {
    if (visited[start] || !visiblePixel(image.rgba, start)) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let count = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (
            nextX < 0
            || nextY < 0
            || nextX >= image.width
            || nextY >= image.height
          ) continue;
          const next = nextY * image.width + nextX;
          if (visited[next] || !visiblePixel(image.rgba, next)) continue;
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      }
    }
    discovered.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels: count,
    });
  }
  const threshold = Math.max(MIN_COMPONENT_PIXELS, Math.floor(pixels / 10_000));
  const components = discovered.filter(({ pixels: count }) => count >= threshold);
  const ignoredPixels = discovered
    .filter(({ pixels: count }) => count < threshold)
    .reduce((total, { pixels: count }) => total + count, 0);
  return { components, ignoredPixels, threshold };
}

function verticalOverlap(left: Component, right: Component): number {
  const top = Math.max(left.y, right.y);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, bottom - top);
}

function readingOrder(components: readonly Component[]): readonly Component[] {
  const rows: Component[][] = [];
  const byCenterY = [...components].sort((left, right) =>
    (left.y + left.height / 2) - (right.y + right.height / 2));
  for (const component of byCenterY) {
    const centerY = component.y + component.height / 2;
    const row = rows.find((candidate) => candidate.some((member) => {
      const memberCenterY = member.y + member.height / 2;
      const overlap = verticalOverlap(component, member);
      return overlap >= Math.min(component.height, member.height) * 0.2
        || Math.abs(centerY - memberCenterY)
          <= Math.max(component.height, member.height) * 0.35;
    }));
    if (row) row.push(component);
    else rows.push([component]);
  }
  rows.sort((left, right) =>
    Math.min(...left.map(({ y }) => y)) - Math.min(...right.map(({ y }) => y)));
  return rows.flatMap((row) => [...row].sort((left, right) => left.x - right.x));
}

function copyScaled(
  source: Raster,
  sourceBounds: Bounds,
  destination: Raster,
  destinationBounds: Bounds,
): void {
  for (let y = 0; y < destinationBounds.height; y += 1) {
    const sourceY = sourceBounds.y
      + Math.min(
        sourceBounds.height - 1,
        Math.floor((y * sourceBounds.height) / destinationBounds.height),
      );
    for (let x = 0; x < destinationBounds.width; x += 1) {
      const sourceX = sourceBounds.x
        + Math.min(
          sourceBounds.width - 1,
          Math.floor((x * sourceBounds.width) / destinationBounds.width),
        );
      const sourceOffset = pixelOffset(source.width, sourceX, sourceY);
      const destinationOffset = pixelOffset(
        destination.width,
        destinationBounds.x + x,
        destinationBounds.y + y,
      );
      destination.rgba.set(
        source.rgba.subarray(sourceOffset, sourceOffset + 4),
        destinationOffset,
      );
    }
  }
}

function destinationBoundsForRole(
  role: string,
  task: ProductionArtTask,
  cell: OccupiedCell,
  component: Component,
): Bounds {
  const cellWidth = task.target.cell_width;
  const cellHeight = task.target.cell_height;
  const cellX = cell.column * cellWidth;
  const cellY = cell.row * cellHeight;
  if (task.seam_policy === 'tileable-cells') {
    if (
      role.endsWith('solid')
      || role.includes('slope-')
    ) {
      return { x: cellX, y: cellY, width: cellWidth, height: cellHeight };
    }
    const scale = role.endsWith('wall')
      ? cellHeight / component.height
      : cellWidth / component.width;
    const width = Math.max(1, Math.min(cellWidth, Math.round(component.width * scale)));
    const height = Math.max(1, Math.min(cellHeight, Math.round(component.height * scale)));
    const x = cellX + Math.floor((cellWidth - width) / 2);
    const y = role.endsWith('ceiling')
      ? cellY
      : cellY + cellHeight - height;
    return { x, y, width, height };
  }
  const padding = Math.max(2, Math.floor(Math.min(cellWidth, cellHeight) * 0.08));
  const maximumWidth = cellWidth - padding * 2;
  const maximumHeight = cellHeight - padding * 2;
  const scale = Math.min(
    maximumWidth / component.width,
    maximumHeight / component.height,
  );
  const width = Math.max(1, Math.round(component.width * scale));
  const height = Math.max(1, Math.round(component.height * scale));
  return {
    x: cellX + Math.floor((cellWidth - width) / 2),
    y: cellY + cellHeight - padding - height,
    width,
    height,
  };
}

function componentReflow(
  source: Raster,
  task: ProductionArtTask,
): {
  readonly raster: Raster;
  readonly sourceComponents: readonly Component[];
  readonly ignoredPixels: number;
  readonly componentThreshold: number;
} {
  if (
    task.kind === 'scene-direction'
    || task.kind === 'background-layer'
  ) {
    throw new Error(
      'Component reading-order reflow is limited to terrain, prop, effect, and character sheets.',
    );
  }
  const cells = occupiedCells(task);
  const discovered = findComponents(source);
  if (discovered.components.length !== cells.length) {
    throw new Error(
      `Component reflow found ${discovered.components.length} significant subjects; `
      + `task ${task.task_id} requires exactly ${cells.length}.`,
    );
  }
  const components = readingOrder(discovered.components);
  const raster: Raster = {
    width: task.target.width,
    height: task.target.height,
    rgba: new Uint8Array(task.target.width * task.target.height * 4),
  };
  components.forEach((component, index) => {
    const cell = cells[index];
    copyScaled(
      source,
      component,
      raster,
      destinationBoundsForRole(cell.role, task, cell, component),
    );
  });
  return {
    raster,
    sourceComponents: components,
    ignoredPixels: discovered.ignoredPixels,
    componentThreshold: discovered.threshold,
  };
}

function countVisible(
  raster: Raster,
  bounds: Bounds,
): { readonly visible: number; readonly borderVisible: number } {
  let visible = 0;
  let borderVisible = 0;
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const alpha = raster.rgba[
        pixelOffset(raster.width, bounds.x + x, bounds.y + y) + 3
      ];
      if (alpha < 16) continue;
      visible += 1;
      if (x === 0 || y === 0 || x === bounds.width - 1 || y === bounds.height - 1) {
        borderVisible += 1;
      }
    }
  }
  return { visible, borderVisible };
}

function assertGridContract(
  raster: Raster,
  task: ProductionArtTask,
): readonly {
  readonly role: string;
  readonly column: number;
  readonly row: number;
  readonly visible_pixels: number;
}[] {
  const mapped = new Map(
    occupiedCells(task).map((cell) => [`${cell.column}:${cell.row}`, cell]),
  );
  const columns = task.target.width / task.target.cell_width;
  const rows = task.target.height / task.target.cell_height;
  const bindings = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const bounds = {
        x: column * task.target.cell_width,
        y: row * task.target.cell_height,
        width: task.target.cell_width,
        height: task.target.cell_height,
      };
      const metrics = countVisible(raster, bounds);
      const cell = mapped.get(`${column}:${row}`);
      if (cell && metrics.visible < 32) {
        throw new Error(`Mapped candidate cell ${column}:${row} is empty.`);
      }
      if (!cell && metrics.visible !== 0) {
        throw new Error(`Unmapped candidate cell ${column}:${row} is not transparent.`);
      }
      if (
        cell
        && task.seam_policy === 'transparent-cell-padding'
        && metrics.borderVisible !== 0
      ) {
        throw new Error(`Candidate cell ${column}:${row} touches its padding boundary.`);
      }
      if (cell) {
        bindings.push({
          role: cell.role,
          column,
          row,
          visible_pixels: metrics.visible,
        });
      }
    }
  }
  return bindings;
}

async function writeIdenticalOrNew(path: string, bytes: Uint8Array): Promise<void> {
  try {
    const existing = await readFile(path);
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error(`Refusing to overwrite non-identical candidate output: ${path}.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

async function run(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.outputPath === args.reportPath || args.sourcePath === args.outputPath) {
    throw new Error('Source, output, and report paths must be distinct.');
  }
  const plan = createProductionArtPlan(args.profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const task = plan.tasks.find(({ task_id: taskId }) => taskId === args.taskId);
  if (!task) throw new Error(`Unknown canonical production-art task: ${args.taskId}.`);
  const sourceBytes = await readFile(args.sourcePath);
  if (sourceBytes.byteLength < 1 || sourceBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error('Operator source PNG exceeds the bounded byte budget.');
  }
  const decoded = await decodeReferenceImageRgba(sourceBytes, 'image/png');
  const source = sanitizeAlpha(decoded, task);
  let materialized: Raster;
  let components: readonly Component[] = [];
  let ignoredComponentPixels = 0;
  let componentThreshold = 0;
  if (args.mode === 'proportional-grid') {
    if (aspectDifference(source, task) > 0.002) {
      throw new Error(
        'Proportional-grid source aspect ratio differs from the canonical task by more than 0.2%.',
      );
    }
    materialized = resizeNearest(source, task.target.width, task.target.height);
  } else {
    const reflowed = componentReflow(source, task);
    materialized = reflowed.raster;
    components = reflowed.sourceComponents;
    ignoredComponentPixels = reflowed.ignoredPixels;
    componentThreshold = reflowed.componentThreshold;
  }
  materialized = sanitizeAlpha(materialized, task);
  const roleBindings = assertGridContract(materialized, task);
  const outputBytes = encodeRgbaPng(
    materialized.width,
    materialized.height,
    materialized.rgba,
  );
  const report = {
    schema_version: '1.0.0',
    document_type: 'operator-production-art-candidate',
    profile: args.profile,
    task_id: task.task_id,
    status: 'internal-review-candidate',
    distribution: 'internal-review',
    output_license: 'UNRELEASED',
    source: {
      basename: basename(args.sourcePath),
      media_type: 'image/png',
      width: source.width,
      height: source.height,
      bytes: sourceBytes.byteLength,
      sha256: sha256(sourceBytes),
    },
    output: {
      basename: basename(args.outputPath),
      media_type: 'image/png',
      width: materialized.width,
      height: materialized.height,
      bytes: outputBytes.byteLength,
      sha256: sha256(outputBytes),
      alpha_policy: task.alpha_policy,
    },
    normalization: {
      mode: args.mode,
      target_cell_width: task.target.cell_width,
      target_cell_height: task.target.cell_height,
      mapped_cells_checked: true,
      unmapped_cells_transparent: true,
      transparent_rgb_zeroed: true,
      significant_components: components.length,
      component_threshold_pixels: componentThreshold,
      ignored_component_pixels: ignoredComponentPixels,
    },
    role_bindings: roleBindings,
    source_components: components,
    human_review: 'required',
    accepted_for: [
      'internal visual review',
      'candidate Godot import after exact manifest binding',
    ],
    not_accepted_for: [
      'production-art run-set',
      'public asset-pack release',
      'redistribution rights claim',
      'human art approval',
    ],
  };
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeIdenticalOrNew(args.outputPath, outputBytes);
  await writeIdenticalOrNew(args.reportPath, reportBytes);
  console.log(JSON.stringify({
    status: 'operator-candidate-written',
    profile: args.profile,
    task_id: task.task_id,
    mode: args.mode,
    roles: roleBindings.length,
    source_sha256: report.source.sha256,
    output_sha256: report.output.sha256,
  }));
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Candidate materialization failed.');
  process.exitCode = 1;
});
