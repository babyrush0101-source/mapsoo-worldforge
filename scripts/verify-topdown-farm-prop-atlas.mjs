import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { decodeRgbaPng } from './lib/rgba-png.mjs';

const SOURCE_MANIFEST_PATH =
  'docs/visual-qa/production-art/topdown-farm-prop-sheet-v1.json';
const OUTPUT_MANIFEST_PATH =
  'docs/visual-qa/production-art/topdown-farm-prop-atlas-v1.json';
const EXPECTED_SOURCE_SHA256 =
  '013d9900ae596f92cdb20c2f450fca2c9a3eaedd0096945b13d79f8f385abb77';
const EXPECTED_RGBA_SHA256 =
  '37912727c38a6dd24e951adbea0f83a039ff38be85f756af0fa5a257fc9e4f53';
const EXPECTED_ROLES = Object.freeze([
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
const ATLAS = Object.freeze({
  width: 512,
  height: 512,
  columns: 8,
  rows: 8,
  cell: 64,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function cellMetrics(image, column, row) {
  let minX = ATLAS.cell;
  let minY = ATLAS.cell;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < ATLAS.cell; y += 1) {
    for (let x = 0; x < ATLAS.cell; x += 1) {
      const offset = (
        ((row * ATLAS.cell + y) * image.width)
        + column * ATLAS.cell
        + x
      ) * 4;
      if (image.rgba[offset + 3] < 16) continue;
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

const sourceManifestBytes = await readFile(resolve(SOURCE_MANIFEST_PATH));
const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8'));
if (
  sourceManifest.schema_version !== 'mapsoo-production-art-source/1.0'
  || sourceManifest.id !== 'topdown-farm-prop-sheet-v1'
  || sourceManifest.profile !== 'topdown-farm'
  || sourceManifest.role !== 'prop.atlas'
  || sourceManifest.status !== 'source-candidate'
  || sourceManifest.distribution !== 'internal-review'
  || sourceManifest.output_license !== 'UNRELEASED'
  || sourceManifest.grid.columns !== 6
  || sourceManifest.grid.rows !== 4
  || sourceManifest.grid.cell_width !== 256
  || sourceManifest.grid.cell_height !== 256
  || sourceManifest.grid.sampling
    !== 'fixed-grid-with-boundary-and-long-grid-component-removal'
  || JSON.stringify(sourceManifest.grid.ordered_roles)
    !== JSON.stringify(EXPECTED_ROLES)
  || sourceManifest.grid.detected_cells.length !== EXPECTED_ROLES.length
) {
  throw new Error('Top-down farm prop source manifest identity or grid is invalid.');
}
const sourceRecord = sourceManifest.rasters.find(
  ({ stage }) => stage === 'grid-source',
);
const rgbaRecord = sourceManifest.rasters.find(
  ({ stage }) => stage === 'rgba-candidate',
);
if (
  !sourceRecord
  || !rgbaRecord
  || sourceRecord.sha256 !== EXPECTED_SOURCE_SHA256
  || rgbaRecord.sha256 !== EXPECTED_RGBA_SHA256
) {
  throw new Error('Top-down farm prop source provenance is incomplete.');
}
for (const record of [sourceRecord, rgbaRecord]) {
  const bytes = await readFile(resolve(record.path));
  const image = decodeRgbaPng(bytes);
  if (
    image.width !== 1536
    || image.height !== 1024
    || bytes.length !== record.bytes
    || sha256(bytes) !== record.sha256
  ) {
    throw new Error(`${record.path} does not match its source review record.`);
  }
}
for (let index = 0; index < sourceManifest.grid.detected_cells.length; index += 1) {
  const cell = sourceManifest.grid.detected_cells[index];
  if (
    cell.role !== EXPECTED_ROLES[index]
    || cell.column !== index % 6
    || cell.row !== Math.floor(index / 6)
    || !cell.visible_bounds
    || cell.visible_bounds.width < 32
    || cell.visible_bounds.height < 32
    || cell.visible_bounds.x < 0
    || cell.visible_bounds.y < 0
    || cell.visible_bounds.x + cell.visible_bounds.width > 256
    || cell.visible_bounds.y + cell.visible_bounds.height > 256
    || cell.boundary_connected_pixels_cleared < 1
    || cell.long_grid_component_pixels_cleared < 0
  ) {
    throw new Error(`Source prop cell ${index} has invalid bounds or sanitation evidence.`);
  }
}

const outputManifest = JSON.parse(
  await readFile(resolve(OUTPUT_MANIFEST_PATH), 'utf8'),
);
const atlasBytes = await readFile(resolve(outputManifest.path));
const atlas = decodeRgbaPng(atlasBytes);
if (
  outputManifest.schema_version !== 'mapsoo-runtime-prop-atlas/1.0'
  || outputManifest.id !== 'topdown-farm-prop-atlas-v1'
  || outputManifest.profile !== 'topdown-farm'
  || outputManifest.status !== 'runtime-candidate'
  || outputManifest.distribution !== 'internal-review'
  || outputManifest.output_license !== 'UNRELEASED'
  || outputManifest.width !== ATLAS.width
  || outputManifest.height !== ATLAS.height
  || outputManifest.columns !== ATLAS.columns
  || outputManifest.rows !== ATLAS.rows
  || outputManifest.cell_width !== ATLAS.cell
  || outputManifest.cell_height !== ATLAS.cell
  || JSON.stringify(outputManifest.pivot) !== '[32,64]'
  || outputManifest.source_manifest !== SOURCE_MANIFEST_PATH
  || outputManifest.source_manifest_sha256 !== sha256(sourceManifestBytes)
  || atlas.width !== ATLAS.width
  || atlas.height !== ATLAS.height
  || atlasBytes.length !== outputManifest.bytes
  || sha256(atlasBytes) !== outputManifest.sha256
  || JSON.stringify(outputManifest.required_roles)
    !== JSON.stringify(REQUIRED_ROLES)
  || outputManifest.role_mappings.length !== EXPECTED_ROLES.length
  || outputManifest.sanitation.mapped_cells !== EXPECTED_ROLES.length
  || outputManifest.sanitation.unmapped_cells
    !== ATLAS.columns * ATLAS.rows - EXPECTED_ROLES.length
  || outputManifest.sanitation.long_grid_component_pixels_cleared < 1
) {
  throw new Error('Top-down farm runtime prop atlas identity, geometry or digest is invalid.');
}
if (
  outputManifest.normalization.policy
    !== 'common-source-scale-nearest-neighbor-bottom-center'
  || outputManifest.normalization.maximum_visible_extent !== 60
  || outputManifest.normalization.largest_source_dimension < 200
  || outputManifest.normalization.common_scale <= 0
  || outputManifest.normalization.common_scale >= 1
) {
  throw new Error('Top-down farm prop normalization policy is invalid.');
}

const mappedCells = new Set();
for (let index = 0; index < outputManifest.role_mappings.length; index += 1) {
  const mapping = outputManifest.role_mappings[index];
  const expectedColumn = index % ATLAS.columns;
  const expectedRow = Math.floor(index / ATLAS.columns);
  const cellKey = `${mapping.atlas_cell.column},${mapping.atlas_cell.row}`;
  if (
    mapping.role !== EXPECTED_ROLES[index]
    || mapping.source_cell.column !== index % 6
    || mapping.source_cell.row !== Math.floor(index / 6)
    || mapping.atlas_cell.column !== expectedColumn
    || mapping.atlas_cell.row !== expectedRow
    || JSON.stringify(mapping.pivot) !== '[32,64]'
    || mappedCells.has(cellKey)
  ) {
    throw new Error(`Runtime prop mapping ${mapping.role} is not canonical.`);
  }
  mappedCells.add(cellKey);
  const metrics = cellMetrics(atlas, expectedColumn, expectedRow);
  if (
    !metrics.bounds
    || metrics.visible_pixels < 32
    || JSON.stringify(metrics.bounds) !== JSON.stringify(mapping.placed_bounds)
    || metrics.visible_pixels !== mapping.visible_pixels
    || metrics.bounds.x < 0
    || metrics.bounds.y < 0
    || metrics.bounds.x + metrics.bounds.width > ATLAS.cell
    || metrics.bounds.y + metrics.bounds.height > ATLAS.cell
    || metrics.bounds.y + metrics.bounds.height !== ATLAS.cell
  ) {
    throw new Error(`Runtime prop ${mapping.role} is empty, unanchored or out of bounds.`);
  }
}
for (const role of REQUIRED_ROLES) {
  if (!outputManifest.role_mappings.some((mapping) => mapping.role === role)) {
    throw new Error(`Required runtime role is missing: ${role}.`);
  }
}
for (let row = 0; row < ATLAS.rows; row += 1) {
  for (let column = 0; column < ATLAS.columns; column += 1) {
    const metrics = cellMetrics(atlas, column, row);
    const mapped = mappedCells.has(`${column},${row}`);
    if ((mapped && metrics.visible_pixels < 32) || (!mapped && metrics.visible_pixels !== 0)) {
      throw new Error(`Atlas cell ${column},${row} violates mapped/unmapped alpha policy.`);
    }
  }
}
for (const check of [
  'exact_target_grid',
  'deterministic_png',
  'required_roles_present',
  'mapped_cells_visible',
  'mapped_cells_in_bounds',
  'all_unmapped_cells_transparent',
  'bottom_pivot_consistency',
]) {
  if (outputManifest.automated_checks[check] !== 'pass') {
    throw new Error(`Runtime prop automated check did not pass: ${check}.`);
  }
}
if (
  outputManifest.automated_checks.role_semantics !== 'manual-review'
  || outputManifest.automated_checks.godot_runtime !== 'pending'
  || !outputManifest.not_accepted_for.includes('public asset-pack release')
) {
  throw new Error('Runtime prop review limitations are not explicit.');
}

console.log(
  `MAPSOO_TOPDOWN_FARM_PROP_STRICT_OK roles=${EXPECTED_ROLES.length} `
  + `required=${REQUIRED_ROLES.length} mapped=${mappedCells.size} `
  + `unmapped=${ATLAS.columns * ATLAS.rows - mappedCells.size} `
  + `sha256=${outputManifest.sha256}`,
);
