import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const SOURCE_PATH =
  'docs/visual-qa/production-art/isometric-action-terrain-sheet-source-v1.png';
const RGBA_PATH =
  'docs/visual-qa/production-art/isometric-action-terrain-sheet-rgba-v1.png';
const SOURCE_MANIFEST_PATH =
  'docs/visual-qa/production-art/isometric-action-terrain-sheet-v1.json';
const ATLAS_PATH =
  'docs/visual-qa/production-art/isometric-action-terrain-atlas-v1.png';
const ATLAS_MANIFEST_PATH =
  'docs/visual-qa/production-art/isometric-action-terrain-atlas-v1.json';
const SOURCE_EXPECTED = Object.freeze({
  width: 1774,
  height: 887,
  bytes: 1_303_271,
  sha256: 'fb2c578ef7a0ccbc5037cdb4988f526f94a8ca225e2f788bd2accc73e47051fa',
});
const GRID = Object.freeze({ columns: 8, rows: 4 });
const TARGET = Object.freeze({
  width: 768,
  height: 384,
  columns: 8,
  rows: 4,
  cellWidth: 96,
  cellHeight: 96,
  logicalDiamondWidth: 96,
  logicalDiamondHeight: 48,
});
const MAPPED_SLOTS = Object.freeze([
  Object.freeze({ type: 'required-role', id: 'terrain.void' }),
  Object.freeze({ type: 'required-role', id: 'terrain.floor.base' }),
  Object.freeze({ type: 'required-role', id: 'terrain.floor.variant' }),
  Object.freeze({ type: 'required-role', id: 'terrain.floor.edge' }),
  Object.freeze({ type: 'required-role', id: 'terrain.elevation.top' }),
  Object.freeze({ type: 'required-role', id: 'terrain.elevation.riser-left' }),
  Object.freeze({ type: 'required-role', id: 'terrain.elevation.riser-right' }),
  Object.freeze({ type: 'required-role', id: 'terrain.ramp' }),
  Object.freeze({ type: 'required-role', id: 'terrain.wall' }),
  Object.freeze({ type: 'auxiliary-variant', id: 'waterway.straight' }),
  Object.freeze({ type: 'auxiliary-variant', id: 'waterway.corner' }),
  Object.freeze({ type: 'auxiliary-variant', id: 'bridge.deck' }),
  Object.freeze({ type: 'auxiliary-variant', id: 'bridge.edge' }),
  Object.freeze({ type: 'auxiliary-variant', id: 'stairs.stone' }),
  Object.freeze({ type: 'auxiliary-variant', id: 'elevation.outside-corner' }),
  Object.freeze({ type: 'auxiliary-variant', id: 'floor.damaged' }),
]);
const REPLACE_GENERATED = process.argv.includes('--replace-generated');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function gridBand(length, index, count) {
  return [
    Math.floor((length * index) / count),
    Math.floor((length * (index + 1)) / count),
  ];
}

function sampleBorderKey(image, inset = 8) {
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (x >= inset && x < image.width - inset && y >= inset && y < image.height - inset) {
        continue;
      }
      const offset = (y * image.width + x) * 4;
      sum[0] += image.rgba[offset];
      sum[1] += image.rgba[offset + 1];
      sum[2] += image.rgba[offset + 2];
      count += 1;
    }
  }
  if (count === 0) throw new Error('Cannot sample an empty chroma border.');
  return sum.map((value) => value / count);
}

function matteChroma(image, key) {
  const TRANSPARENT_DISTANCE = 12;
  const OPAQUE_DISTANCE = 90;
  const rgba = new Uint8Array(image.width * image.height * 4);
  let transparentPixels = 0;
  let partialAlphaPixels = 0;
  for (let index = 0; index < image.width * image.height; index += 1) {
    const offset = index * 4;
    const red = image.rgba[offset];
    const green = image.rgba[offset + 1];
    const blue = image.rgba[offset + 2];
    const distance = Math.hypot(red - key[0], green - key[1], blue - key[2]);
    let distanceAlpha;
    if (distance <= TRANSPARENT_DISTANCE) distanceAlpha = 0;
    else if (distance >= OPAQUE_DISTANCE) distanceAlpha = 255;
    else distanceAlpha = Math.round(((distance - TRANSPARENT_DISTANCE)
      / (OPAQUE_DISTANCE - TRANSPARENT_DISTANCE)) * 255);
    const redBlueMaximum = Math.max(red, blue, 1);
    const magentaAffinity = (Math.min(red, blue) - green) / redBlueMaximum;
    const redBlueBalance = Math.abs(red - blue) / redBlueMaximum;
    let hueAlpha = 255;
    if (redBlueBalance <= 0.35 && magentaAffinity > 0.25) {
      hueAlpha = magentaAffinity >= 0.75
        ? 0
        : Math.round(((0.75 - magentaAffinity) / 0.5) * 255);
    }
    const alpha = Math.min(distanceAlpha, hueAlpha);
    if (alpha <= 8) {
      transparentPixels += 1;
      continue;
    }
    const normalizedAlpha = alpha / 255;
    rgba[offset] = clampByte((red - key[0] * (1 - normalizedAlpha)) / normalizedAlpha);
    rgba[offset + 1] = clampByte((green - key[1] * (1 - normalizedAlpha)) / normalizedAlpha);
    rgba[offset + 2] = clampByte((blue - key[2] * (1 - normalizedAlpha)) / normalizedAlpha);
    rgba[offset + 3] = alpha;
    if (alpha < 255) partialAlphaPixels += 1;
  }
  return {
    image: { width: image.width, height: image.height, rgba },
    metrics: {
      sampled_key_rgb: key.map((value) => Number(value.toFixed(3))),
      transparent_distance: TRANSPARENT_DISTANCE,
      opaque_distance: OPAQUE_DISTANCE,
      transparent_pixels: transparentPixels,
      partial_alpha_pixels: partialAlphaPixels,
    },
  };
}

function findVisibleBounds(image, xBand, yBand, alphaThreshold = 16) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = yBand[0]; y < yBand[1]; y += 1) {
    for (let x = xBand[0]; x < xBand[1]; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] < alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
    }
  }
  if (visiblePixels === 0) return null;
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
    rgba.set(
      image.rgba.subarray(sourceStart, sourceStart + bounds.width * 4),
      y * bounds.width * 4,
    );
  }
  return { width: bounds.width, height: bounds.height, rgba };
}

function blit(target, source, destinationX, destinationY) {
  for (let y = 0; y < source.height; y += 1) {
    const sourceStart = y * source.width * 4;
    const targetStart = ((destinationY + y) * target.width + destinationX) * 4;
    target.rgba.set(
      source.rgba.subarray(sourceStart, sourceStart + source.width * 4),
      targetStart,
    );
  }
}

function cellMetrics(image, column, row) {
  const xBand = [column * TARGET.cellWidth, (column + 1) * TARGET.cellWidth];
  const yBand = [row * TARGET.cellHeight, (row + 1) * TARGET.cellHeight];
  const bounds = findVisibleBounds(image, xBand, yBand);
  let boundaryPixels = 0;
  let chromaSpillPixels = 0;
  for (let y = yBand[0]; y < yBand[1]; y += 1) {
    for (let x = xBand[0]; x < xBand[1]; x += 1) {
      const offset = (y * image.width + x) * 4;
      if (image.rgba[offset + 3] < 16) continue;
      const localX = x - xBand[0];
      const localY = y - yBand[0];
      if (localX < 2
        || localY < 2
        || localX >= TARGET.cellWidth - 2
        || localY >= TARGET.cellHeight - 2) boundaryPixels += 1;
      if (
        image.rgba[offset + 3] >= 192
        && image.rgba[offset] > 230
        && image.rgba[offset + 2] > 230
        && image.rgba[offset + 1] < 70
      ) chromaSpillPixels += 1;
    }
  }
  return { bounds, boundary_pixels: boundaryPixels, chroma_spill_pixels: chromaSpillPixels };
}

async function writeIdenticalOrNew(path, bytes) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      if (REPLACE_GENERATED) {
        await writeFile(resolve(path), bytes);
        return;
      }
      throw new Error(`Refusing to overwrite non-identical generated output: ${path}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

const sourceBytes = await readFile(resolve(SOURCE_PATH));
const source = decodeRgbaPng(sourceBytes);
if (
  source.width !== SOURCE_EXPECTED.width
  || source.height !== SOURCE_EXPECTED.height
  || sourceBytes.length !== SOURCE_EXPECTED.bytes
  || sha256(sourceBytes) !== SOURCE_EXPECTED.sha256
) {
  throw new Error('Isometric terrain source does not match the approved generated original.');
}

const matte = matteChroma(source, sampleBorderKey(source));
const rgbaBytes = encodeRgbaPng(matte.image.width, matte.image.height, matte.image.rgba);
const detectedCells = [];
const unmappedSourceCells = [];
const atlas = {
  width: TARGET.width,
  height: TARGET.height,
  rgba: new Uint8Array(TARGET.width * TARGET.height * 4),
};
for (let row = 0; row < GRID.rows; row += 1) {
  for (let column = 0; column < GRID.columns; column += 1) {
    const index = row * GRID.columns + column;
    const xBand = gridBand(source.width, column, GRID.columns);
    const yBand = gridBand(source.height, row, GRID.rows);
    const sourceBounds = findVisibleBounds(matte.image, xBand, yBand);
    if (index >= MAPPED_SLOTS.length) {
      unmappedSourceCells.push({
        column,
        row,
        source_visible_pixels_cleared: sourceBounds?.visible_pixels ?? 0,
      });
      continue;
    }
    if (!sourceBounds
      || sourceBounds.visible_pixels < 1_000
      || sourceBounds.width < 48
      || sourceBounds.height < 32) {
      throw new Error(
        `Mapped isometric source cell ${column},${row} has invalid bounds: `
        + `${JSON.stringify({ xBand, yBand, sourceBounds })}.`,
      );
    }
    const sourceCell = crop(matte.image, sourceBounds);
    const scale = Math.min(
      (TARGET.cellWidth - 8) / sourceCell.width,
      (TARGET.cellHeight - 8) / sourceCell.height,
    );
    const normalizedWidth = Math.max(1, Math.round(sourceCell.width * scale));
    const normalizedHeight = Math.max(1, Math.round(sourceCell.height * scale));
    const normalized = resizeNearest(sourceCell, normalizedWidth, normalizedHeight);
    const destinationX = column * TARGET.cellWidth
      + Math.floor((TARGET.cellWidth - normalizedWidth) / 2);
    const destinationY = row * TARGET.cellHeight + TARGET.cellHeight - 4 - normalizedHeight;
    blit(atlas, normalized, destinationX, destinationY);
    detectedCells.push({
      column,
      row,
      binding_type: MAPPED_SLOTS[index].type,
      binding_id: MAPPED_SLOTS[index].id,
      source_bounds: sourceBounds,
      normalized_bounds: {
        x: destinationX - column * TARGET.cellWidth,
        y: destinationY - row * TARGET.cellHeight,
        width: normalizedWidth,
        height: normalizedHeight,
      },
    });
  }
}

const roleMappings = [];
const auxiliaryVariants = [];
for (const cell of detectedCells) {
  const metrics = cellMetrics(atlas, cell.column, cell.row);
  if (!metrics.bounds
    || metrics.bounds.visible_pixels < 200
    || metrics.boundary_pixels !== 0
    || metrics.chroma_spill_pixels !== 0) {
    throw new Error(
      `Normalized isometric cell fails alpha/boundary checks: ${cell.binding_id} `
      + `${JSON.stringify(metrics)}.`,
    );
  }
  const record = {
    id: cell.binding_id,
    column: cell.column,
    row: cell.row,
    pivot: [48, 92],
    visible_pixels: metrics.bounds.visible_pixels,
    boundary_pixels: metrics.boundary_pixels,
    chroma_spill_pixels: metrics.chroma_spill_pixels,
    bounds: {
      x: metrics.bounds.x - cell.column * TARGET.cellWidth,
      y: metrics.bounds.y - cell.row * TARGET.cellHeight,
      width: metrics.bounds.width,
      height: metrics.bounds.height,
    },
  };
  if (cell.binding_type === 'required-role') {
    const { id, ...mapping } = record;
    roleMappings.push({ role: id, ...mapping });
  } else {
    const { id, ...mapping } = record;
    auxiliaryVariants.push({ variant: id, ...mapping });
  }
}
for (const cell of unmappedSourceCells) {
  if (cellMetrics(atlas, cell.column, cell.row).bounds !== null) {
    throw new Error(`Unmapped isometric atlas cell ${cell.column},${cell.row} is not transparent.`);
  }
}
const atlasChromaSpill = [...roleMappings, ...auxiliaryVariants]
  .reduce((sum, record) => sum + record.chroma_spill_pixels, 0);
if (atlasChromaSpill !== 0) throw new Error('Isometric terrain atlas retains chroma spill.');

const sourceManifest = {
  schema_version: 'mapsoo-production-art-source/1.0',
  id: 'isometric-action-terrain-sheet-v1',
  profile: 'isometric-action',
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
      width: matte.image.width,
      height: matte.image.height,
      bytes: rgbaBytes.length,
      sha256: sha256(rgbaBytes),
    },
  ],
  generation_context: {
    reference_image:
      'docs/visual-qa/production-art/isometric-action-direction-v1.png',
    reference_scope:
      'original palette, masonry material language, isometric projection and lighting only',
    provider_mode: 'built-in-image-generation',
    chroma_key: '#ff00ff',
  },
  matte: matte.metrics,
  grid: {
    columns: GRID.columns,
    rows: GRID.rows,
    sampling: 'proportional-8x4-source-grid',
    ordered_slots: MAPPED_SLOTS,
    detected_cells: detectedCells,
    unmapped_source_cells: unmappedSourceCells,
  },
  automated_checks: {
    exact_grid: 'pass',
    mapped_cells_nonempty: 'pass',
    unmapped_cells_recorded: 'pass',
    chroma_matte: 'pass',
    role_semantics: 'manual-review',
  },
  not_accepted_for: [
    'runtime terrain atlas',
    'complete world asset pack',
    'Godot runtime approval',
    'Raspberry Pi approval',
    'public asset-pack release',
  ],
};
const sourceManifestBytes = Buffer.from(`${JSON.stringify(sourceManifest, null, 2)}\n`);
const atlasBytes = encodeRgbaPng(atlas.width, atlas.height, atlas.rgba);
const atlasManifest = {
  schema_version: 'mapsoo-runtime-isometric-terrain-atlas/1.0',
  id: 'isometric-action-terrain-atlas-v1',
  profile: 'isometric-action',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: ATLAS_PATH,
  media_type: 'image/png',
  width: TARGET.width,
  height: TARGET.height,
  bytes: atlasBytes.length,
  sha256: sha256(atlasBytes),
  columns: TARGET.columns,
  rows: TARGET.rows,
  cell_width: TARGET.cellWidth,
  cell_height: TARGET.cellHeight,
  logical_diamond_footprint: {
    width: TARGET.logicalDiamondWidth,
    height: TARGET.logicalDiamondHeight,
  },
  alpha_policy: 'straight-alpha',
  source_manifest: SOURCE_MANIFEST_PATH,
  source_manifest_sha256: sha256(sourceManifestBytes),
  role_mappings: roleMappings,
  auxiliary_variants: auxiliaryVariants,
  sanitation: {
    mapped_cells: MAPPED_SLOTS.length,
    unmapped_cells: GRID.columns * GRID.rows - MAPPED_SLOTS.length,
    all_unmapped_cells_transparent: true,
  },
  automated_checks: {
    exact_target_dimensions: 'pass',
    exact_target_grid: 'pass',
    mapped_cells_nonempty: 'pass',
    cell_boundaries_transparent: 'pass',
    all_unmapped_cells_transparent: 'pass',
    chroma_spill_pixels: atlasChromaSpill,
    deterministic_png: 'pass',
    human_art_review: 'pending',
    godot_runtime: 'pending',
    raspberry_pi_runtime: 'pending',
  },
  not_accepted_for: [
    'complete world asset pack',
    'Godot runtime approval',
    'Raspberry Pi approval',
    'public asset-pack release',
  ],
};
const atlasManifestBytes = Buffer.from(`${JSON.stringify(atlasManifest, null, 2)}\n`);

await writeIdenticalOrNew(RGBA_PATH, rgbaBytes);
await writeIdenticalOrNew(SOURCE_MANIFEST_PATH, sourceManifestBytes);
await writeIdenticalOrNew(ATLAS_PATH, atlasBytes);
await writeIdenticalOrNew(ATLAS_MANIFEST_PATH, atlasManifestBytes);
console.log(
  `MAPSOO_ISOMETRIC_TERRAIN_OK source=${sha256(sourceBytes)} rgba=${sha256(rgbaBytes)} atlas=${atlasManifest.sha256} roles=${roleMappings.length} aux=${auxiliaryVariants.length}`,
);
