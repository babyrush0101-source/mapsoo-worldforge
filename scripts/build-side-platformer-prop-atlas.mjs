import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng, encodeRgbaPng, resizeNearest } from './lib/rgba-png.mjs';

const sourceManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-prop-sheet-v1.json',
);
const outputPngPath = resolve(
  'docs/visual-qa/production-art/side-platformer-prop-atlas-v1.png',
);
const outputManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-prop-atlas-v1.json',
);
const TARGET = Object.freeze({ width: 512, height: 512, columns: 8, rows: 8, cell: 64 });
const SOURCE_ROWS = 4;
const REQUIRED_ROLES = Object.freeze([
  'hazard.spikes',
  'hazard.pit',
  'hazard.moving-platform',
  'prop.crate',
  'prop.rock',
  'prop.plant',
  'prop.sign',
  'prop.lamp',
  'prop.breakable',
  'structure.entrance',
  'structure.exit',
  'structure.checkpoint',
  'collectible.primary',
  'collectible.health',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function alphaMetrics(rgba, atlasWidth, cellColumn, cellRow, cellSize) {
  let minX = cellSize;
  let minY = cellSize;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let chromaEdgePixels = 0;
  for (let y = 0; y < cellSize; y += 1) {
    for (let x = 0; x < cellSize; x += 1) {
      const offset = (((cellRow * cellSize + y) * atlasWidth) + cellColumn * cellSize + x) * 4;
      const red = rgba[offset];
      const green = rgba[offset + 1];
      const blue = rgba[offset + 2];
      const alpha = rgba[offset + 3];
      if (alpha < 16) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (alpha < 250 && green > 170 && red < 100 && blue < 100 && green - red > 90) {
        chromaEdgePixels += 1;
      }
    }
  }
  return {
    visible_pixels: visiblePixels,
    chroma_edge_pixels: chromaEdgePixels,
    bounds: visiblePixels === 0
      ? null
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

function clearCell(rgba, atlasWidth, cellColumn, cellRow, cellSize) {
  for (let y = 0; y < cellSize; y += 1) {
    const start = (((cellRow * cellSize + y) * atlasWidth) + cellColumn * cellSize) * 4;
    rgba.fill(0, start, start + cellSize * 4);
  }
}

async function writeIdenticalOrNew(path, bytes, allowedPreviousHashes = []) {
  try {
    const existing = await readFile(path);
    if (!existing.equals(Buffer.from(bytes))) {
      const existingHash = sha256(existing);
      if (!allowedPreviousHashes.includes(existingHash)) {
        throw new Error(`Refusing to overwrite non-identical generated output: ${path}`);
      }
      await writeFile(path, bytes);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
if (
  sourceManifest.schema_version !== 'mapsoo-production-art-source/1.0'
  || sourceManifest.id !== 'side-platformer-prop-sheet-v1'
  || sourceManifest.status !== 'source-candidate'
  || sourceManifest.distribution !== 'internal-review'
  || sourceManifest.output_license !== 'UNRELEASED'
  || sourceManifest.grid.columns !== 8
  || sourceManifest.grid.rows !== SOURCE_ROWS
  || JSON.stringify(sourceManifest.grid.ordered_roles) !== JSON.stringify(REQUIRED_ROLES)
) {
  throw new Error('Prop source manifest is not the canonical internal-review grid candidate.');
}
const sourceRecord = sourceManifest.rasters.find((raster) => raster.stage === 'rgba-candidate');
if (!sourceRecord) throw new Error('Prop source has no RGBA candidate.');
const sourceBytes = await readFile(resolve(sourceRecord.path));
if (sourceBytes.length !== sourceRecord.bytes || sha256(sourceBytes) !== sourceRecord.sha256) {
  throw new Error('Prop source bytes do not match their review record.');
}
const source = decodeRgbaPng(sourceBytes);
if (source.width !== sourceRecord.width || source.height !== sourceRecord.height) {
  throw new Error('Prop source dimensions do not match their review record.');
}
const normalizedTop = resizeNearest(source, TARGET.width, TARGET.cell * SOURCE_ROWS);
const outputRgba = new Uint8Array(TARGET.width * TARGET.height * 4);
outputRgba.set(normalizedTop.rgba);
const mappedCells = new Set(REQUIRED_ROLES.map((_, index) =>
  `${index % TARGET.columns}:${Math.floor(index / TARGET.columns)}`));
const clearedUnmappedCells = [];
let clearedUnmappedVisiblePixels = 0;
for (let row = 0; row < TARGET.rows; row += 1) {
  for (let column = 0; column < TARGET.columns; column += 1) {
    if (mappedCells.has(`${column}:${row}`)) continue;
    const before = alphaMetrics(outputRgba, TARGET.width, column, row, TARGET.cell);
    if (before.visible_pixels > 0) {
      clearedUnmappedCells.push({
        column,
        row,
        source_visible_pixels: before.visible_pixels,
      });
      clearedUnmappedVisiblePixels += before.visible_pixels;
    }
    clearCell(outputRgba, TARGET.width, column, row, TARGET.cell);
  }
}
const roleMappings = REQUIRED_ROLES.map((role, index) => {
  const column = index % TARGET.columns;
  const row = Math.floor(index / TARGET.columns);
  const metrics = alphaMetrics(outputRgba, TARGET.width, column, row, TARGET.cell);
  if (!metrics.bounds || metrics.visible_pixels < 32) {
    throw new Error(`Required prop cell is empty: ${role}.`);
  }
  if (metrics.chroma_edge_pixels > 0) {
    throw new Error(`Required prop cell retains chroma edge pixels: ${role}.`);
  }
  return { role, column, row, pivot: [32, 64], ...metrics };
});
for (let row = 0; row < TARGET.rows; row += 1) {
  for (let column = 0; column < TARGET.columns; column += 1) {
    if (mappedCells.has(`${column}:${row}`)) continue;
    if (alphaMetrics(outputRgba, TARGET.width, column, row, TARGET.cell).visible_pixels !== 0) {
      throw new Error(`Unmapped prop cell ${column},${row} is not transparent.`);
    }
  }
}
const outputBytes = encodeRgbaPng(TARGET.width, TARGET.height, outputRgba);
const outputHash = sha256(outputBytes);
const outputManifest = {
  schema_version: 'mapsoo-runtime-prop-atlas/1.0',
  id: 'side-platformer-prop-atlas-v1',
  profile: 'side-platformer',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: 'docs/visual-qa/production-art/side-platformer-prop-atlas-v1.png',
  media_type: 'image/png',
  width: TARGET.width,
  height: TARGET.height,
  bytes: outputBytes.length,
  sha256: outputHash,
  cell_width: TARGET.cell,
  cell_height: TARGET.cell,
  pivot: [32, 64],
  source_manifest: 'docs/visual-qa/production-art/side-platformer-prop-sheet-v1.json',
  source_sha256: sourceRecord.sha256,
  role_mappings: roleMappings,
  sanitation: {
    mapped_cells: REQUIRED_ROLES.length,
    unmapped_cells: TARGET.columns * TARGET.rows - REQUIRED_ROLES.length,
    nonempty_unmapped_cells_cleared: clearedUnmappedCells.length,
    visible_pixels_cleared: clearedUnmappedVisiblePixels,
    cleared_cells: clearedUnmappedCells,
  },
  automated_checks: {
    exact_target_grid: 'pass',
    required_cells_nonempty: 'pass',
    all_unmapped_cells_transparent: 'pass',
    reserved_cells_transparent: 'pass',
    chroma_edge_pixels: 0,
    deterministic_png: 'pass',
    role_semantics: 'manual-review',
    scale_consistency: 'manual-review',
    godot_runtime: 'pending',
  },
  not_accepted_for: [
    'complete world asset pack',
    'public asset-pack release',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');
await writeIdenticalOrNew(
  outputPngPath,
  outputBytes,
  ['1a313f2c83aca3fefb14da383afb9275a1ebe85789b5464f309488e407546458'],
);
await writeIdenticalOrNew(
  outputManifestPath,
  manifestBytes,
  ['527e94bff935f4356ad0ff5a490a50c8a7c21d4848579109b962df67d23cf745'],
);
console.log(
  `MAPSOO_PROP_ATLAS_OK side-platformer:${TARGET.width}x${TARGET.height}:roles=${REQUIRED_ROLES.length}:cleared=${clearedUnmappedCells.length}:sha256=${outputHash}`,
);
