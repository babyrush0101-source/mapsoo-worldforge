import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const SOURCE_PATH =
  'docs/visual-qa/production-art/topdown-farm-prop-sheet-source-v1.png';
const RGBA_PATH =
  'docs/visual-qa/production-art/topdown-farm-prop-sheet-rgba-v1.png';
const SOURCE_MANIFEST_PATH =
  'docs/visual-qa/production-art/topdown-farm-prop-sheet-v1.json';
const OUTPUT_PATH =
  'docs/visual-qa/production-art/topdown-farm-prop-atlas-v1.png';
const OUTPUT_MANIFEST_PATH =
  'docs/visual-qa/production-art/topdown-farm-prop-atlas-v1.json';
const SOURCE_EXPECTED = Object.freeze({
  width: 1536,
  height: 1024,
  bytes: 1_797_363,
  sha256: '013d9900ae596f92cdb20c2f450fca2c9a3eaedd0096945b13d79f8f385abb77',
});
const RGBA_EXPECTED = Object.freeze({
  width: 1536,
  height: 1024,
  bytes: 1_118_098,
  sha256: '37912727c38a6dd24e951adbea0f83a039ff38be85f756af0fa5a257fc9e4f53',
});
const SOURCE_GRID = Object.freeze({
  columns: 6,
  rows: 4,
  cellWidth: 256,
  cellHeight: 256,
});
const TARGET = Object.freeze({
  width: 512,
  height: 512,
  columns: 8,
  rows: 8,
  cell: 64,
  maximumVisibleExtent: 60,
});
const ALPHA_THRESHOLD = 16;
const ORDERED_ROLES = Object.freeze([
  'prop.tree',
  'prop.rock',
  'prop.flower',
  'prop.crate',
  'prop.fence',
  'prop.fence.vertical',
  'prop.gate',
  'structure.house',
  'structure.barn',
  'prop.bridge',
  'prop.market',
  'prop.sign',
  'crop.basic.stage-1',
  'crop.basic.stage-2',
  'crop.basic.stage-3',
  'crop.basic.stage-4',
  'prop.sapling',
  'prop.forage',
  'prop.lantern',
  'prop.barrel',
  'prop.well',
  'prop.hay',
  'structure.entrance',
  'structure.exit',
]);
const REQUIRED_ROLES = Object.freeze([
  'prop.tree',
  'prop.rock',
  'prop.flower',
  'prop.fence',
  'prop.gate',
  'prop.crate',
  'structure.house',
  'structure.barn',
  'crop.basic.stage-1',
  'crop.basic.stage-2',
  'crop.basic.stage-3',
  'crop.basic.stage-4',
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

function extractCell(image, column, row) {
  const rgba = new Uint8Array(SOURCE_GRID.cellWidth * SOURCE_GRID.cellHeight * 4);
  for (let y = 0; y < SOURCE_GRID.cellHeight; y += 1) {
    const sourceStart = (
      ((row * SOURCE_GRID.cellHeight + y) * image.width)
      + column * SOURCE_GRID.cellWidth
    ) * 4;
    const targetStart = y * SOURCE_GRID.cellWidth * 4;
    rgba.set(
      image.rgba.subarray(
        sourceStart,
        sourceStart + SOURCE_GRID.cellWidth * 4,
      ),
      targetStart,
    );
  }
  return {
    width: SOURCE_GRID.cellWidth,
    height: SOURCE_GRID.cellHeight,
    rgba,
  };
}

function removeBoundaryConnectedPixels(image) {
  const pixelCount = image.width * image.height;
  const queued = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const enqueue = (index) => {
    if (
      queued[index] !== 0
      || image.rgba[index * 4 + 3] < ALPHA_THRESHOLD
    ) return;
    queued[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < image.width; x += 1) {
    enqueue(x);
    enqueue((image.height - 1) * image.width + x);
  }
  for (let y = 1; y + 1 < image.height; y += 1) {
    enqueue(y * image.width);
    enqueue(y * image.width + image.width - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % image.width;
    const y = Math.floor(index / image.width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < image.width) enqueue(index + 1);
    if (y > 0) enqueue(index - image.width);
    if (y + 1 < image.height) enqueue(index + image.width);
  }
  let clearedPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (queued[index] !== 0 || image.rgba[offset + 3] < ALPHA_THRESHOLD) {
      if (image.rgba[offset + 3] !== 0) clearedPixels += 1;
      image.rgba.fill(0, offset, offset + 4);
    }
  }
  return clearedPixels;
}

function removeLongNearWhiteGridComponents(image) {
  const pixelCount = image.width * image.height;
  const white = new Uint8Array(pixelCount);
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const toClear = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const red = image.rgba[offset];
    const green = image.rgba[offset + 1];
    const blue = image.rgba[offset + 2];
    if (
      image.rgba[offset + 3] >= ALPHA_THRESHOLD
      && red >= 230
      && green >= 230
      && blue >= 230
      && Math.max(red, green, blue) - Math.min(red, green, blue) <= 24
    ) white[index] = 1;
  }
  for (let start = 0; start < pixelCount; start += 1) {
    if (white[start] === 0 || visited[start] !== 0) continue;
    let head = 0;
    let tail = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    const component = [];
    visited[start] = 1;
    queue[tail] = start;
    tail += 1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      component.push(index);
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let neighborY = Math.max(0, y - 1); neighborY <= Math.min(image.height - 1, y + 1); neighborY += 1) {
        for (let neighborX = Math.max(0, x - 1); neighborX <= Math.min(image.width - 1, x + 1); neighborX += 1) {
          const neighbor = neighborY * image.width + neighborX;
          if (white[neighbor] === 0 || visited[neighbor] !== 0) continue;
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }
    if (
      maxX - minX + 1 < image.width / 2
      && maxY - minY + 1 < image.height / 2
      && component.length < image.width / 2
    ) continue;
    for (const index of component) {
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      for (let clearY = Math.max(0, y - 2); clearY <= Math.min(image.height - 1, y + 2); clearY += 1) {
        for (let clearX = Math.max(0, x - 2); clearX <= Math.min(image.width - 1, x + 2); clearX += 1) {
          toClear[clearY * image.width + clearX] = 1;
        }
      }
    }
  }
  let clearedPixels = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (toClear[index] === 0) continue;
    const offset = index * 4;
    if (image.rgba[offset + 3] !== 0) clearedPixels += 1;
    image.rgba.fill(0, offset, offset + 4);
  }
  return clearedPixels;
}

function visibleBounds(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
    }
  }
  if (visiblePixels === 0) throw new Error('A top-down farm prop source cell is empty.');
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    visible_pixels: visiblePixels,
  };
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

function blitBottomCentered(targetRgba, image, column, row) {
  const x = column * TARGET.cell + Math.floor((TARGET.cell - image.width) / 2);
  const y = row * TARGET.cell + TARGET.cell - image.height;
  if (
    image.width > TARGET.cell
    || image.height > TARGET.cell
    || x < column * TARGET.cell
    || y < row * TARGET.cell
  ) {
    throw new Error(`Normalized prop does not fit runtime cell ${column},${row}.`);
  }
  for (let sourceY = 0; sourceY < image.height; sourceY += 1) {
    const sourceStart = sourceY * image.width * 4;
    const targetStart = ((y + sourceY) * TARGET.width + x) * 4;
    targetRgba.set(
      image.rgba.subarray(sourceStart, sourceStart + image.width * 4),
      targetStart,
    );
  }
  return {
    x: x - column * TARGET.cell,
    y: y - row * TARGET.cell,
    width: image.width,
    height: image.height,
  };
}

function atlasCellMetrics(rgba, column, row) {
  let minX = TARGET.cell;
  let minY = TARGET.cell;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < TARGET.cell; y += 1) {
    for (let x = 0; x < TARGET.cell; x += 1) {
      const offset = (
        ((row * TARGET.cell + y) * TARGET.width)
        + column * TARGET.cell
        + x
      ) * 4;
      if (rgba[offset + 3] < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
    }
  }
  return {
    visible_pixels: visiblePixels,
    bounds: visiblePixels === 0
      ? null
      : {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
  };
}

const sourceBytes = await readFile(resolve(SOURCE_PATH));
const rgbaBytes = await readFile(resolve(RGBA_PATH));
const sourceImage = decodeRgbaPng(sourceBytes);
const rgbaImage = decodeRgbaPng(rgbaBytes);
for (const [label, bytes, image, expected] of [
  ['source', sourceBytes, sourceImage, SOURCE_EXPECTED],
  ['rgba', rgbaBytes, rgbaImage, RGBA_EXPECTED],
]) {
  if (
    image.width !== expected.width
    || image.height !== expected.height
    || bytes.length !== expected.bytes
    || sha256(bytes) !== expected.sha256
  ) {
    throw new Error(`Top-down farm prop ${label} does not match the approved input.`);
  }
}

const sourceCells = [];
for (let index = 0; index < ORDERED_ROLES.length; index += 1) {
  const sourceColumn = index % SOURCE_GRID.columns;
  const sourceRow = Math.floor(index / SOURCE_GRID.columns);
  const cell = extractCell(rgbaImage, sourceColumn, sourceRow);
  const boundaryPixelsCleared = removeBoundaryConnectedPixels(cell);
  const gridComponentPixelsCleared = removeLongNearWhiteGridComponents(cell);
  const bounds = visibleBounds(cell);
  sourceCells.push({
    role: ORDERED_ROLES[index],
    sourceColumn,
    sourceRow,
    boundaryPixelsCleared,
    gridComponentPixelsCleared,
    bounds,
    cropped: crop(cell, bounds),
  });
}
const largestSourceDimension = Math.max(
  ...sourceCells.flatMap(({ bounds }) => [bounds.width, bounds.height]),
);
const commonScale = TARGET.maximumVisibleExtent / largestSourceDimension;
const outputRgba = new Uint8Array(TARGET.width * TARGET.height * 4);
const roleMappings = sourceCells.map((entry, index) => {
  const atlasColumn = index % TARGET.columns;
  const atlasRow = Math.floor(index / TARGET.columns);
  const targetWidth = Math.max(1, Math.round(entry.cropped.width * commonScale));
  const targetHeight = Math.max(1, Math.round(entry.cropped.height * commonScale));
  const scaled = resizeNearest(entry.cropped, targetWidth, targetHeight);
  const normalized = crop(scaled, visibleBounds(scaled));
  const normalizationBox = blitBottomCentered(
    outputRgba,
    normalized,
    atlasColumn,
    atlasRow,
  );
  const metrics = atlasCellMetrics(outputRgba, atlasColumn, atlasRow);
  if (
    metrics.visible_pixels < 32
    || metrics.bounds === null
    || metrics.bounds.x < 0
    || metrics.bounds.y < 0
    || metrics.bounds.x + metrics.bounds.width > TARGET.cell
    || metrics.bounds.y + metrics.bounds.height > TARGET.cell
  ) {
    throw new Error(`Runtime prop ${entry.role} is empty or escapes its atlas cell.`);
  }
  return {
    role: entry.role,
    source_cell: {
      column: entry.sourceColumn,
      row: entry.sourceRow,
      visible_bounds: entry.bounds,
      boundary_connected_pixels_cleared: entry.boundaryPixelsCleared,
      long_grid_component_pixels_cleared: entry.gridComponentPixelsCleared,
    },
    atlas_cell: { column: atlasColumn, row: atlasRow },
    pivot: [32, 64],
    normalization_box: normalizationBox,
    placed_bounds: metrics.bounds,
    visible_pixels: metrics.visible_pixels,
  };
});

const mappedCells = new Set(
  roleMappings.map(({ atlas_cell: cell }) => `${cell.column},${cell.row}`),
);
for (let row = 0; row < TARGET.rows; row += 1) {
  for (let column = 0; column < TARGET.columns; column += 1) {
    const metrics = atlasCellMetrics(outputRgba, column, row);
    if (mappedCells.has(`${column},${row}`)) {
      if (!metrics.bounds || metrics.visible_pixels < 32) {
        throw new Error(`Mapped atlas cell ${column},${row} is empty.`);
      }
    } else if (metrics.visible_pixels !== 0) {
      throw new Error(`Unmapped atlas cell ${column},${row} is not transparent.`);
    }
  }
}
for (const role of REQUIRED_ROLES) {
  if (!roleMappings.some((mapping) => mapping.role === role)) {
    throw new Error(`Required top-down farm prop role is missing: ${role}.`);
  }
}

const sourceManifest = {
  schema_version: 'mapsoo-production-art-source/1.0',
  id: 'topdown-farm-prop-sheet-v1',
  profile: 'topdown-farm',
  role: 'prop.atlas',
  status: 'source-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  rasters: [
    {
      stage: 'grid-source',
      path: SOURCE_PATH,
      media_type: 'image/png',
      width: sourceImage.width,
      height: sourceImage.height,
      bytes: sourceBytes.length,
      sha256: sha256(sourceBytes),
    },
    {
      stage: 'rgba-candidate',
      path: RGBA_PATH,
      media_type: 'image/png',
      width: rgbaImage.width,
      height: rgbaImage.height,
      bytes: rgbaBytes.length,
      sha256: sha256(rgbaBytes),
    },
  ],
  generation_context: {
    reference_image: 'docs/visual-qa/production-art/topdown-farm-direction-v1.png',
    reference_scope: 'palette, material language and top-down silhouette direction',
    provider_mode: 'built-in-image-generation',
  },
  grid: {
    columns: SOURCE_GRID.columns,
    rows: SOURCE_GRID.rows,
    cell_width: SOURCE_GRID.cellWidth,
    cell_height: SOURCE_GRID.cellHeight,
    sampling: 'fixed-grid-with-boundary-and-long-grid-component-removal',
    ordered_roles: [...ORDERED_ROLES],
    detected_cells: roleMappings.map(({ role, source_cell: sourceCell }) => ({
      role,
      column: sourceCell.column,
      row: sourceCell.row,
      visible_bounds: sourceCell.visible_bounds,
      boundary_connected_pixels_cleared:
        sourceCell.boundary_connected_pixels_cleared,
      long_grid_component_pixels_cleared:
        sourceCell.long_grid_component_pixels_cleared,
    })),
  },
  automated_checks: {
    exact_source_grid: 'pass',
    exact_role_count: 'pass',
    boundary_and_long_grid_components_removed: 'pass',
    all_source_cells_nonempty: 'pass',
    role_semantics: 'manual-review',
  },
  not_accepted_for: [
    'runtime prop atlas',
    'complete world asset pack',
    'public asset-pack release',
  ],
};
const sourceManifestBytes = Buffer.from(
  `${JSON.stringify(sourceManifest, null, 2)}\n`,
);
const outputBytes = encodeRgbaPng(TARGET.width, TARGET.height, outputRgba);
const outputManifest = {
  schema_version: 'mapsoo-runtime-prop-atlas/1.0',
  id: 'topdown-farm-prop-atlas-v1',
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
  columns: TARGET.columns,
  rows: TARGET.rows,
  cell_width: TARGET.cell,
  cell_height: TARGET.cell,
  pivot: [32, 64],
  normalization: {
    policy: 'common-source-scale-nearest-neighbor-bottom-center',
    common_scale: commonScale,
    largest_source_dimension: largestSourceDimension,
    maximum_visible_extent: TARGET.maximumVisibleExtent,
    alpha_threshold: ALPHA_THRESHOLD,
  },
  source_manifest: SOURCE_MANIFEST_PATH,
  source_manifest_sha256: sha256(sourceManifestBytes),
  required_roles: [...REQUIRED_ROLES],
  role_mappings: roleMappings,
  sanitation: {
    mapped_cells: roleMappings.length,
    unmapped_cells: TARGET.columns * TARGET.rows - roleMappings.length,
    boundary_connected_pixels_cleared: roleMappings.reduce(
      (sum, mapping) => (
        sum + mapping.source_cell.boundary_connected_pixels_cleared
      ),
      0,
    ),
    long_grid_component_pixels_cleared: roleMappings.reduce(
      (sum, mapping) => (
        sum + mapping.source_cell.long_grid_component_pixels_cleared
      ),
      0,
    ),
  },
  automated_checks: {
    exact_target_grid: 'pass',
    deterministic_png: 'pass',
    required_roles_present: 'pass',
    mapped_cells_visible: 'pass',
    mapped_cells_in_bounds: 'pass',
    all_unmapped_cells_transparent: 'pass',
    bottom_pivot_consistency: 'pass',
    role_semantics: 'manual-review',
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
  `MAPSOO_TOPDOWN_FARM_PROP_OK grid=8x8 cell=64 roles=${roleMappings.length} `
  + `required=${REQUIRED_ROLES.length} sha256=${outputManifest.sha256}`,
);
