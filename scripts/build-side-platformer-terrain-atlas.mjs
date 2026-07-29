import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng, encodeRgbaPng, resizeNearest } from './lib/rgba-png.mjs';

const sourceManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-terrain-sheet-v1.json',
);
const outputPngPath = resolve(
  'docs/visual-qa/production-art/side-platformer-terrain-atlas-v2.png',
);
const outputManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-terrain-atlas-v2.json',
);
const TARGET = Object.freeze({ width: 384, height: 192, columns: 8, rows: 4, cell: 48 });
const REQUIRED_ROLES = Object.freeze([
  'terrain.solid',
  'terrain.one-way',
  'terrain.slope-up',
  'terrain.slope-down',
  'terrain.wall',
  'terrain.ceiling',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pixelOffset(x, y) {
  return (y * TARGET.width + x) * 4;
}

function averageChannel(a, b) {
  return Math.round((a + b) / 2);
}

function joinHorizontalEdge(rgba, cellColumn, cellRow) {
  const left = cellColumn * TARGET.cell;
  const right = left + TARGET.cell - 1;
  const top = cellRow * TARGET.cell;
  for (let y = top; y < top + TARGET.cell; y += 1) {
    for (let inset = 0; inset < 2; inset += 1) {
      const leftOffset = pixelOffset(left + inset, y);
      const rightOffset = pixelOffset(right - inset, y);
      for (let channel = 0; channel < 4; channel += 1) {
        const average = averageChannel(rgba[leftOffset + channel], rgba[rightOffset + channel]);
        rgba[leftOffset + channel] = average;
        rgba[rightOffset + channel] = average;
      }
    }
  }
}

function joinVerticalEdge(rgba, cellColumn, cellRow) {
  const left = cellColumn * TARGET.cell;
  const top = cellRow * TARGET.cell;
  const bottom = top + TARGET.cell - 1;
  for (let x = left; x < left + TARGET.cell; x += 1) {
    for (let inset = 0; inset < 2; inset += 1) {
      const topOffset = pixelOffset(x, top + inset);
      const bottomOffset = pixelOffset(x, bottom - inset);
      for (let channel = 0; channel < 4; channel += 1) {
        const average = averageChannel(rgba[topOffset + channel], rgba[bottomOffset + channel]);
        rgba[topOffset + channel] = average;
        rgba[bottomOffset + channel] = average;
      }
    }
  }
}

function edgeMismatch(rgba, cellColumn, cellRow, axis) {
  const left = cellColumn * TARGET.cell;
  const top = cellRow * TARGET.cell;
  let mismatches = 0;
  let samples = 0;
  for (let index = 0; index < TARGET.cell; index += 1) {
    const first = axis === 'horizontal'
      ? pixelOffset(left, top + index)
      : pixelOffset(left + index, top);
    const last = axis === 'horizontal'
      ? pixelOffset(left + TARGET.cell - 1, top + index)
      : pixelOffset(left + index, top + TARGET.cell - 1);
    for (let channel = 0; channel < 4; channel += 1) {
      samples += 1;
      if (rgba[first + channel] !== rgba[last + channel]) mismatches += 1;
    }
  }
  return { mismatches, samples };
}

function clearCellBackground(rgba, cellColumn, seedPoints, tolerance = 58) {
  const originX = cellColumn * TARGET.cell;
  const references = seedPoints.map(([x, y]) => {
    const offset = pixelOffset(originX + x, y);
    return [rgba[offset], rgba[offset + 1], rgba[offset + 2]];
  });
  const visited = new Uint8Array(TARGET.cell * TARGET.cell);
  const queue = seedPoints.map(([x, y]) => y * TARGET.cell + x);
  let cleared = 0;
  while (queue.length > 0) {
    const index = queue.pop();
    if (visited[index]) continue;
    visited[index] = 1;
    const x = index % TARGET.cell;
    const y = Math.floor(index / TARGET.cell);
    const offset = pixelOffset(originX + x, y);
    const matches = references.some(([red, green, blue]) => (
      Math.hypot(rgba[offset] - red, rgba[offset + 1] - green, rgba[offset + 2] - blue) <= tolerance
    ));
    if (!matches) continue;
    if (rgba[offset + 3] !== 0) {
      rgba[offset + 3] = 0;
      cleared += 1;
    }
    if (x > 0) queue.push(index - 1);
    if (x + 1 < TARGET.cell) queue.push(index + 1);
    if (y > 0) queue.push(index - TARGET.cell);
    if (y + 1 < TARGET.cell) queue.push(index + TARGET.cell);
  }
  return cleared;
}

function clearReservedCells(rgba) {
  for (let row = 0; row < TARGET.rows; row += 1) {
    for (let column = 0; column < TARGET.columns; column += 1) {
      if (row === 0 && column < REQUIRED_ROLES.length) continue;
      for (let y = 0; y < TARGET.cell; y += 1) {
        for (let x = 0; x < TARGET.cell; x += 1) {
          rgba[pixelOffset(column * TARGET.cell + x, row * TARGET.cell + y) + 3] = 0;
        }
      }
    }
  }
}

async function writeIdenticalOrNew(path, bytes) {
  try {
    const existing = await readFile(path);
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error(`Refusing to overwrite non-identical generated output: ${path}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
if (
  sourceManifest.schema_version !== 'mapsoo-production-art-source/1.0'
  || sourceManifest.id !== 'side-platformer-terrain-sheet-v1'
  || sourceManifest.status !== 'source-candidate'
  || sourceManifest.distribution !== 'internal-review'
  || sourceManifest.output_license !== 'UNRELEASED'
  || sourceManifest.grid.columns !== TARGET.columns
  || sourceManifest.grid.rows !== TARGET.rows
) {
  throw new Error('Terrain source manifest is not the approved internal-review grid candidate.');
}
const sourceRecord = sourceManifest.rasters.find((raster) => raster.stage === 'generated-source');
if (!sourceRecord) throw new Error('Terrain generated source record is missing.');
const sourceBytes = await readFile(resolve(sourceRecord.path));
if (sourceBytes.length !== sourceRecord.bytes || sha256(sourceBytes) !== sourceRecord.sha256) {
  throw new Error('Terrain source bytes do not match their review record.');
}
const source = decodeRgbaPng(sourceBytes);
if (source.width !== sourceRecord.width || source.height !== sourceRecord.height) {
  throw new Error('Terrain source dimensions do not match their review record.');
}
const transparentPixels = source.rgba.reduce(
  (count, value, index) => count + (index % 4 === 3 && value !== 255 ? 1 : 0),
  0,
);
if (transparentPixels !== 0) throw new Error('Terrain source must be fully opaque.');

const normalized = resizeNearest(source, TARGET.width, TARGET.height);
const backgroundRemoval = [
  clearCellBackground(normalized.rgba, 0, [[2, 2], [24, 2], [45, 2]]),
  clearCellBackground(normalized.rgba, 1, [[2, 2], [24, 2], [45, 2], [2, 45], [45, 45]]),
  clearCellBackground(normalized.rgba, 2, [[2, 2], [45, 2]]),
  clearCellBackground(normalized.rgba, 3, [[2, 2], [45, 2]]),
  clearCellBackground(normalized.rgba, 4, [[45, 24]]),
  clearCellBackground(normalized.rgba, 5, [[24, 45]]),
];
if (backgroundRemoval.some((pixels) => pixels < 32 || pixels > TARGET.cell * TARGET.cell - 32)) {
  throw new Error('Terrain bounded background removal produced an implausible cell matte.');
}
clearReservedCells(normalized.rgba);
joinHorizontalEdge(normalized.rgba, 0, 0);
joinHorizontalEdge(normalized.rgba, 1, 0);
joinHorizontalEdge(normalized.rgba, 5, 0);
joinVerticalEdge(normalized.rgba, 4, 0);
const seamChecks = [
  { role: 'terrain.solid', axis: 'horizontal', ...edgeMismatch(normalized.rgba, 0, 0, 'horizontal') },
  { role: 'terrain.one-way', axis: 'horizontal', ...edgeMismatch(normalized.rgba, 1, 0, 'horizontal') },
  { role: 'terrain.wall', axis: 'vertical', ...edgeMismatch(normalized.rgba, 4, 0, 'vertical') },
  { role: 'terrain.ceiling', axis: 'horizontal', ...edgeMismatch(normalized.rgba, 5, 0, 'horizontal') },
];
if (seamChecks.some((check) => check.mismatches !== 0)) {
  throw new Error('Terrain deterministic seam normalization failed.');
}
const outputBytes = encodeRgbaPng(TARGET.width, TARGET.height, normalized.rgba);
const outputHash = sha256(outputBytes);
const outputManifest = {
  schema_version: 'mapsoo-runtime-terrain-atlas/1.0',
  id: 'side-platformer-terrain-atlas-v2',
  profile: 'side-platformer',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: 'docs/visual-qa/production-art/side-platformer-terrain-atlas-v2.png',
  media_type: 'image/png',
  width: TARGET.width,
  height: TARGET.height,
  bytes: outputBytes.length,
  sha256: outputHash,
  cell_width: TARGET.cell,
  cell_height: TARGET.cell,
  alpha_policy: 'straight-alpha',
  source_manifest: 'docs/visual-qa/production-art/side-platformer-terrain-sheet-v1.json',
  source_sha256: sourceRecord.sha256,
  role_mappings: REQUIRED_ROLES.map((role, column) => ({ role, column, row: 0 })),
  background_removed_pixels: REQUIRED_ROLES.map((role, index) => ({
    role,
    pixels: backgroundRemoval[index],
  })),
  seam_checks: seamChecks,
  automated_checks: {
    opaque_source: 'pass',
    exact_target_grid: 'pass',
    deterministic_png: 'pass',
    bounded_repeat_edges: 'pass',
    bounded_background_removal: 'pass',
    reserved_cells_transparent: 'pass',
    slope_semantics: 'manual-review',
    material_consistency: 'manual-review',
    godot_runtime: 'pending',
  },
  rejected_predecessor: 'docs/visual-qa/production-art/side-platformer-terrain-atlas-v1.json',
  not_accepted_for: [
    'complete world asset pack',
    'public asset-pack release',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');
await writeIdenticalOrNew(outputPngPath, outputBytes);
await writeIdenticalOrNew(outputManifestPath, manifestBytes);
console.log(
  `MAPSOO_TERRAIN_ATLAS_OK side-platformer:${TARGET.width}x${TARGET.height}:roles=${REQUIRED_ROLES.length}:sha256=${outputHash}`,
);
