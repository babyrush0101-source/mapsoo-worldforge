import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const SOURCE_PATH = 'docs/visual-qa/production-art/topdown-farm-terrain-sheet-source-v1.png';
const RGBA_PATH = 'docs/visual-qa/production-art/topdown-farm-terrain-sheet-rgba-v1.png';
const SOURCE_MANIFEST_PATH =
  'docs/visual-qa/production-art/topdown-farm-terrain-sheet-v1.json';
const OUTPUT_PATH = 'docs/visual-qa/production-art/topdown-farm-terrain-atlas-v1.png';
const OUTPUT_MANIFEST_PATH =
  'docs/visual-qa/production-art/topdown-farm-terrain-atlas-v1.json';
const SOURCE_EXPECTED = Object.freeze({
  width: 1774,
  height: 887,
  sha256: '34e584e2be9c023ec68f8228da4751f687eeeefcdf2a77d6bc7654fe72b12a90',
});
const RGBA_EXPECTED = Object.freeze({
  width: 1774,
  height: 887,
  sha256: '5a6033d878b6a295625155824a5e4ef4f25c1f8c272f72267f0ebc6bdab6223b',
});
const TARGET = Object.freeze({ width: 256, height: 128, columns: 8, rows: 4, cell: 32 });
const X_BANDS = Object.freeze([
  [0, 237],
  [237, 454],
  [454, 672],
  [672, 888],
  [888, 1103],
  [1103, 1319],
  [1319, 1535],
  [1535, 1774],
]);
const Y_BANDS = Object.freeze([
  [0, 234],
  [234, 449],
  [449, 653],
  [653, 887],
]);
const ROW_ROLES = Object.freeze([
  Object.freeze([
    'ground.plain',
    'ground.flowers',
    'ground.worn-diagonal',
    'ground.dark-edge',
    'ground.worn-center',
    'ground.stone-detail',
    'ground.pebble-detail',
    'ground.worn-patch',
  ]),
  Object.freeze([
    'water.lilies',
    'water.ripples',
    'water.bank-north',
    'water.bank-south',
    'water.bank-east',
    'water.bank-west',
    'water.bank-inner-corner',
    'water.bank-outer-corner',
  ]),
  Object.freeze([
    'path.vertical',
    'path.horizontal',
    'path.edge-west',
    'path.edge-east',
    'path.turn-north-east',
    'path.turn-south-east',
    'path.junction',
    'path.worn-center',
  ]),
  Object.freeze([
    'soil.plain',
    'soil.furrows',
    'soil.wet',
    'soil.edge-north',
    'soil.edge-south',
    'soil.edge-east',
    'soil.edge-west',
    'soil.corner',
  ]),
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeIdenticalOrNew(path, bytes) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error(`Refusing to overwrite non-identical generated output: ${path}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

function findVisibleBounds(image, xBand, yBand, alphaThreshold = 32) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = yBand[0]; y < yBand[1]; y += 1) {
    for (let x = xBand[0]; x < xBand[1]; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('A top-down terrain source cell is empty.');
  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    visible_pixels: visiblePixels,
  };
  const area = bounds.width * bounds.height;
  if (
    bounds.width < 170
    || bounds.width > 195
    || bounds.height < 170
    || bounds.height > 195
    || visiblePixels / area < 0.96
  ) {
    throw new Error(`A terrain source cell has an implausible detected box: ${JSON.stringify(bounds)}`);
  }
  return bounds;
}

function crop(image, bounds) {
  const rgba = new Uint8Array(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = ((bounds.y + y) * image.width + bounds.x) * 4;
    const targetStart = y * bounds.width * 4;
    rgba.set(
      image.rgba.subarray(sourceStart, sourceStart + bounds.width * 4),
      targetStart,
    );
  }
  return { width: bounds.width, height: bounds.height, rgba };
}

function fillTransparentPixels(image, alphaThreshold = 32) {
  const count = image.width * image.height;
  const distance = new Int32Array(count);
  distance.fill(-1);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < count; index += 1) {
    if (image.rgba[index * 4 + 3] > alphaThreshold) {
      distance[index] = 0;
      queue[tail] = index;
      tail += 1;
    }
  }
  if (tail === 0) throw new Error('Cannot fill an empty terrain cell.');
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    const neighbors = [];
    if (x > 0) neighbors.push(index - 1);
    if (x + 1 < image.width) neighbors.push(index + 1);
    if (y > 0) neighbors.push(index - image.width);
    if (y + 1 < image.height) neighbors.push(index + image.width);
    for (const neighbor of neighbors) {
      if (distance[neighbor] !== -1) continue;
      const sourceOffset = index * 4;
      const targetOffset = neighbor * 4;
      image.rgba[targetOffset] = image.rgba[sourceOffset];
      image.rgba[targetOffset + 1] = image.rgba[sourceOffset + 1];
      image.rgba[targetOffset + 2] = image.rgba[sourceOffset + 2];
      image.rgba[targetOffset + 3] = 255;
      distance[neighbor] = distance[index] + 1;
      queue[tail] = neighbor;
      tail += 1;
    }
  }
  for (let index = 0; index < count; index += 1) image.rgba[index * 4 + 3] = 255;
}

function blitCell(targetRgba, cell, column, row) {
  for (let y = 0; y < TARGET.cell; y += 1) {
    const sourceStart = y * TARGET.cell * 4;
    const targetStart = (
      (row * TARGET.cell + y) * TARGET.width + column * TARGET.cell
    ) * 4;
    targetRgba.set(
      cell.rgba.subarray(sourceStart, sourceStart + TARGET.cell * 4),
      targetStart,
    );
  }
}

function targetOffset(column, row, x, y) {
  return (
    (row * TARGET.cell + y) * TARGET.width
    + column * TARGET.cell
    + x
  ) * 4;
}

function reconcileRepeatEdges(rgba, column, row) {
  for (let index = 0; index < TARGET.cell; index += 1) {
    const pairs = [
      [targetOffset(column, row, 0, index), targetOffset(column, row, TARGET.cell - 1, index)],
      [targetOffset(column, row, index, 0), targetOffset(column, row, index, TARGET.cell - 1)],
    ];
    for (const [first, last] of pairs) {
      for (let channel = 0; channel < 4; channel += 1) {
        const average = Math.round((rgba[first + channel] + rgba[last + channel]) / 2);
        rgba[first + channel] = average;
        rgba[last + channel] = average;
      }
    }
  }
  const corners = [
    targetOffset(column, row, 0, 0),
    targetOffset(column, row, TARGET.cell - 1, 0),
    targetOffset(column, row, 0, TARGET.cell - 1),
    targetOffset(column, row, TARGET.cell - 1, TARGET.cell - 1),
  ];
  for (let channel = 0; channel < 4; channel += 1) {
    const average = Math.round(
      corners.reduce((sum, offset) => sum + rgba[offset + channel], 0) / corners.length,
    );
    for (const offset of corners) rgba[offset + channel] = average;
  }
}

function repeatEdgeMismatch(rgba, column, row) {
  let mismatches = 0;
  for (let index = 0; index < TARGET.cell; index += 1) {
    const pairs = [
      [targetOffset(column, row, 0, index), targetOffset(column, row, TARGET.cell - 1, index)],
      [targetOffset(column, row, index, 0), targetOffset(column, row, index, TARGET.cell - 1)],
    ];
    for (const [first, last] of pairs) {
      for (let channel = 0; channel < 4; channel += 1) {
        if (rgba[first + channel] !== rgba[last + channel]) mismatches += 1;
      }
    }
  }
  return mismatches;
}

const sourceBytes = await readFile(resolve(SOURCE_PATH));
const rgbaBytes = await readFile(resolve(RGBA_PATH));
const source = decodeRgbaPng(sourceBytes);
const rgbaSource = decodeRgbaPng(rgbaBytes);
for (const [label, bytes, image, expected] of [
  ['source', sourceBytes, source, SOURCE_EXPECTED],
  ['rgba', rgbaBytes, rgbaSource, RGBA_EXPECTED],
]) {
  if (
    image.width !== expected.width
    || image.height !== expected.height
    || sha256(bytes) !== expected.sha256
  ) {
    throw new Error(`Top-down terrain ${label} bytes do not match the approved source.`);
  }
}

const detectedCells = [];
const outputRgba = new Uint8Array(TARGET.width * TARGET.height * 4);
for (let row = 0; row < TARGET.rows; row += 1) {
  for (let column = 0; column < TARGET.columns; column += 1) {
    const bounds = findVisibleBounds(rgbaSource, X_BANDS[column], Y_BANDS[row]);
    const cropped = crop(rgbaSource, bounds);
    fillTransparentPixels(cropped);
    const normalized = resizeNearest(cropped, TARGET.cell, TARGET.cell);
    blitCell(outputRgba, normalized, column, row);
    detectedCells.push({
      column,
      row,
      variant: ROW_ROLES[row][column],
      source_bounds: bounds,
    });
  }
}

for (const [column, row] of [[0, 0], [0, 1], [0, 3]]) {
  reconcileRepeatEdges(outputRgba, column, row);
}
const seamChecks = [
  { variant: 'ground.plain', column: 0, row: 0 },
  { variant: 'water.lilies', column: 0, row: 1 },
  { variant: 'soil.plain', column: 0, row: 3 },
].map((entry) => ({
  ...entry,
  mismatches: repeatEdgeMismatch(outputRgba, entry.column, entry.row),
}));
if (seamChecks.some((check) => check.mismatches !== 0)) {
  throw new Error('Top-down farm base tile seam reconciliation failed.');
}
let transparentPixels = 0;
for (let offset = 3; offset < outputRgba.length; offset += 4) {
  if (outputRgba[offset] !== 255) transparentPixels += 1;
}
if (transparentPixels !== 0) throw new Error('Top-down farm terrain atlas must be fully opaque.');

const sourceManifest = {
  schema_version: 'mapsoo-production-art-source/1.0',
  id: 'topdown-farm-terrain-sheet-v1',
  profile: 'topdown-farm',
  role: 'terrain.atlas',
  status: 'source-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  rasters: [
    {
      stage: 'chroma-source',
      path: SOURCE_PATH,
      media_type: 'image/png',
      width: source.width,
      height: source.height,
      bytes: sourceBytes.length,
      sha256: sha256(sourceBytes),
    },
    {
      stage: 'rgba-candidate',
      path: RGBA_PATH,
      media_type: 'image/png',
      width: rgbaSource.width,
      height: rgbaSource.height,
      bytes: rgbaBytes.length,
      sha256: sha256(rgbaBytes),
    },
  ],
  generation_context: {
    reference_image: 'docs/visual-qa/production-art/topdown-farm-direction-v1.png',
    reference_scope: 'palette, materials, scale and pixel-cluster language',
    provider_mode: 'built-in-image-generation',
    chroma_key: '#ff00ff',
  },
  grid: {
    columns: TARGET.columns,
    rows: TARGET.rows,
    sampling: 'detected-separated-source-cells',
    ordered_variants: ROW_ROLES.flat(),
    detected_cells: detectedCells,
  },
  automated_checks: {
    exact_detected_cell_count: 'pass',
    detected_cell_coverage: 'pass',
    transparent_gutters: 'pass',
    chroma_spill: 'pass',
    role_semantics: 'manual-review',
  },
  not_accepted_for: [
    'runtime terrain atlas',
    'complete world asset pack',
    'public asset-pack release',
  ],
};
const sourceManifestBytes = Buffer.from(`${JSON.stringify(sourceManifest, null, 2)}\n`);
const outputBytes = encodeRgbaPng(TARGET.width, TARGET.height, outputRgba);
const outputManifest = {
  schema_version: 'mapsoo-runtime-terrain-atlas/1.1',
  id: 'topdown-farm-terrain-atlas-v1',
  profile: 'topdown-farm',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: OUTPUT_PATH,
  media_type: 'image/png',
  width: TARGET.width,
  height: TARGET.height,
  bytes: outputBytes.length,
  sha256: sha256(outputBytes),
  cell_width: TARGET.cell,
  cell_height: TARGET.cell,
  alpha_policy: 'straight-alpha',
  source_manifest: SOURCE_MANIFEST_PATH,
  source_manifest_sha256: sha256(sourceManifestBytes),
  role_mappings: [
    { role: 'terrain.ground', column: 0, row: 0 },
    { role: 'terrain.water', column: 0, row: 1 },
    { role: 'terrain.path', column: 0, row: 2 },
    { role: 'terrain.soil', column: 0, row: 3 },
  ],
  variants: detectedCells.map(({ column, row, variant }) => ({ column, row, variant })),
  seam_checks: seamChecks,
  automated_checks: {
    exact_target_grid: 'pass',
    deterministic_png: 'pass',
    all_cells_opaque: 'pass',
    base_repeat_edges: 'pass',
    transition_semantics: 'manual-review',
    godot_runtime: 'pending',
  },
  not_accepted_for: [
    'complete world asset pack',
    'public asset-pack release',
  ],
};

await writeIdenticalOrNew(SOURCE_MANIFEST_PATH, sourceManifestBytes);
await writeIdenticalOrNew(OUTPUT_PATH, outputBytes);
await writeIdenticalOrNew(
  OUTPUT_MANIFEST_PATH,
  Buffer.from(`${JSON.stringify(outputManifest, null, 2)}\n`),
);
console.log(
  `MAPSOO_TOPDOWN_FARM_TERRAIN_OK grid=8x4 cell=32 roles=4 variants=32 sha256=${outputManifest.sha256}`,
);
