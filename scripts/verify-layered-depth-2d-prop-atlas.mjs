import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { decodeRgbaPng } from './lib/rgba-png.mjs';

const SOURCE_MANIFEST =
  'docs/visual-qa/production-art/layered-depth-2d-prop-sheet-v1.json';
const ATLAS_MANIFEST =
  'docs/visual-qa/production-art/layered-depth-2d-prop-atlas-v1.json';
const GENERATION_SHA256 =
  'e5b9e27215f115ce93025d8e3f5946d4c75c3c861fa9c8b72007e7bd3065f798';
const ROLES = Object.freeze([
  'terrain.ground',
  'terrain.path',
  'terrain.edge',
  'terrain.bridge',
  'terrain.stairs',
  'terrain.water',
  'prop.tree',
  'prop.rock',
  'prop.crate',
  'prop.sign',
  'prop.lamp',
  'prop.occluder',
  'structure.entrance',
  'structure.exit',
  'structure.checkpoint',
  'structure.landmark',
  'collectible.primary',
  'collectible.health',
  'effect.footstep',
  'effect.interact',
  'effect.portal',
  'effect.ambient',
]);
const SOURCE = Object.freeze({ width: 1536, height: 1024, columns: 6, rows: 4, cell: 256 });
const ATLAS = Object.freeze({ width: 768, height: 768, columns: 8, rows: 8, cell: 96 });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function cellMetrics(image, column, row, cell) {
  let minX = cell;
  let minY = cell;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let exactChromaPixels = 0;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const offset = (
        ((row * cell + y) * image.width) + column * cell + x
      ) * 4;
      if (image.rgba[offset + 3] < 16) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (
        image.rgba[offset] === 255
        && image.rgba[offset + 1] === 0
        && image.rgba[offset + 2] === 255
      ) exactChromaPixels += 1;
    }
  }
  return {
    visible_pixels: visiblePixels,
    exact_chroma_pixels: exactChromaPixels,
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

const sourceManifestBytes = await readFile(resolve(SOURCE_MANIFEST));
const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8'));
if (
  sourceManifest.schema_version !== 'mapsoo-production-art-source/1.0'
  || sourceManifest.id !== 'layered-depth-2d-prop-sheet-v1'
  || sourceManifest.profile !== 'layered-depth-2d'
  || sourceManifest.world_direction !== 'lanternmere-crossing'
  || sourceManifest.status !== 'source-candidate'
  || sourceManifest.distribution !== 'internal-review'
  || sourceManifest.output_license !== 'UNRELEASED'
  || sourceManifest.rasters.length !== 3
  || sourceManifest.rasters[0].sha256 !== GENERATION_SHA256
  || sourceManifest.matte.policy
    !== 'fixed-max-channel-distance-hard-matte-with-key-edge-contract'
  || JSON.stringify(sourceManifest.matte.sampled_key_rgb) !== '[251,3,251]'
  || sourceManifest.matte.tolerance !== 18
  || sourceManifest.matte.key_edge_contract_pixels !== 1
  || sourceManifest.matte.key_edge_pixels_removed < 1
  || sourceManifest.grid.columns !== SOURCE.columns
  || sourceManifest.grid.rows !== SOURCE.rows
  || sourceManifest.grid.cell_width !== SOURCE.cell
  || sourceManifest.grid.cell_height !== SOURCE.cell
  || JSON.stringify(sourceManifest.grid.ordered_roles) !== JSON.stringify(ROLES)
  || sourceManifest.grid.mapped_cells.length !== ROLES.length
  || sourceManifest.grid.reserved_cells.length !== 2
) throw new Error('Layered-depth source manifest identity, matte or grid is invalid.');

const generationRecord = sourceManifest.rasters.find(
  ({ stage }) => stage === 'generation-original',
);
const sourceRecord = sourceManifest.rasters.find(
  ({ stage }) => stage === 'strict-chroma-source',
);
const rgbaRecord = sourceManifest.rasters.find(
  ({ stage }) => stage === 'rgba-candidate',
);
if (!generationRecord || !sourceRecord || !rgbaRecord) {
  throw new Error('Layered-depth source raster records are incomplete.');
}
for (const record of [generationRecord, sourceRecord, rgbaRecord]) {
  const bytes = await readFile(resolve(record.path));
  const image = decodeRgbaPng(bytes);
  if (
    image.width !== SOURCE.width
    || image.height !== SOURCE.height
    || bytes.length !== record.bytes
    || sha256(bytes) !== record.sha256
  ) throw new Error(`${record.path} does not match its source review record.`);
}
if (
  generationRecord.bytes !== 1_766_562
  || generationRecord.sha256 !== GENERATION_SHA256
) throw new Error('Layered-depth generation-original provenance is invalid.');

const sourceBytes = await readFile(resolve(sourceRecord.path));
const rgbaBytes = await readFile(resolve(rgbaRecord.path));
const strictSource = decodeRgbaPng(sourceBytes);
const rgba = decodeRgbaPng(rgbaBytes);
const mappedSourceCells = new Set();
for (let index = 0; index < sourceManifest.grid.mapped_cells.length; index += 1) {
  const mapping = sourceManifest.grid.mapped_cells[index];
  const column = index % SOURCE.columns;
  const row = Math.floor(index / SOURCE.columns);
  const metrics = cellMetrics(rgba, column, row, SOURCE.cell);
  if (
    mapping.role !== ROLES[index]
    || mapping.column !== column
    || mapping.row !== row
    || mappedSourceCells.has(`${column},${row}`)
    || !metrics.bounds
    || metrics.visible_pixels < 128
    || metrics.exact_chroma_pixels !== 0
    || JSON.stringify(metrics.bounds)
      !== JSON.stringify(mapping.strict_visible_bounds)
    || metrics.bounds.x < 18
    || metrics.bounds.y < 18
    || metrics.bounds.x + metrics.bounds.width > SOURCE.cell - 18
    || metrics.bounds.y + metrics.bounds.height > SOURCE.cell - 18
  ) throw new Error(`Layered-depth source role is invalid: ${mapping.role}.`);
  mappedSourceCells.add(`${column},${row}`);
}
for (let index = 0; index < SOURCE.columns * SOURCE.rows; index += 1) {
  const column = index % SOURCE.columns;
  const row = Math.floor(index / SOURCE.columns);
  const metrics = cellMetrics(rgba, column, row, SOURCE.cell);
  const mapped = mappedSourceCells.has(`${column},${row}`);
  if (
    (mapped && metrics.visible_pixels < 128)
    || (!mapped && metrics.visible_pixels !== 0)
  ) throw new Error(`Layered-depth source cell ${column},${row} violates alpha policy.`);
  for (let y = 0; y < SOURCE.cell; y += 1) {
    for (let x = 0; x < SOURCE.cell; x += 1) {
      const offset = (
        ((row * SOURCE.cell + y) * strictSource.width)
        + column * SOURCE.cell
        + x
      ) * 4;
      if (strictSource.rgba[offset + 3] !== 255) {
        throw new Error('Strict chroma source must be fully opaque.');
      }
      if (
        rgba.rgba[offset + 3] === 0
        && (
          strictSource.rgba[offset] !== 255
          || strictSource.rgba[offset + 1] !== 0
          || strictSource.rgba[offset + 2] !== 255
        )
      ) throw new Error('Strict source background is not exact #ff00ff.');
    }
  }
}
if (sourceManifest.automated_checks.exact_chroma_key_visible_pixels !== 0) {
  throw new Error('Source manifest does not bind zero visible chroma pixels.');
}

const atlasManifest = JSON.parse(await readFile(resolve(ATLAS_MANIFEST), 'utf8'));
const atlasBytes = await readFile(resolve(atlasManifest.path));
const atlas = decodeRgbaPng(atlasBytes);
if (
  atlasManifest.schema_version !== 'mapsoo-runtime-prop-atlas/1.0'
  || atlasManifest.id !== 'layered-depth-2d-prop-atlas-v1'
  || atlasManifest.profile !== 'layered-depth-2d'
  || atlasManifest.world_direction !== 'lanternmere-crossing'
  || atlasManifest.status !== 'runtime-candidate'
  || atlasManifest.distribution !== 'internal-review'
  || atlasManifest.output_license !== 'UNRELEASED'
  || atlasManifest.width !== ATLAS.width
  || atlasManifest.height !== ATLAS.height
  || atlasManifest.columns !== ATLAS.columns
  || atlasManifest.rows !== ATLAS.rows
  || atlasManifest.cell_width !== ATLAS.cell
  || atlasManifest.cell_height !== ATLAS.cell
  || JSON.stringify(atlasManifest.pivot) !== '[48,96]'
  || atlasManifest.source_manifest !== SOURCE_MANIFEST
  || atlasManifest.source_manifest_sha256 !== sha256(sourceManifestBytes)
  || JSON.stringify(atlasManifest.required_roles) !== JSON.stringify(ROLES)
  || atlasManifest.role_mappings.length !== ROLES.length
  || atlas.width !== ATLAS.width
  || atlas.height !== ATLAS.height
  || atlasBytes.length !== atlasManifest.bytes
  || sha256(atlasBytes) !== atlasManifest.sha256
  || atlasManifest.sanitation.mapped_cells !== ROLES.length
  || atlasManifest.sanitation.unmapped_cells
    !== ATLAS.columns * ATLAS.rows - ROLES.length
) throw new Error('Layered-depth runtime atlas identity, geometry or digest is invalid.');

const mappedAtlasCells = new Set();
for (let index = 0; index < atlasManifest.role_mappings.length; index += 1) {
  const mapping = atlasManifest.role_mappings[index];
  const column = index % ATLAS.columns;
  const row = Math.floor(index / ATLAS.columns);
  const metrics = cellMetrics(atlas, column, row, ATLAS.cell);
  if (
    mapping.role !== ROLES[index]
    || mapping.canonical_role !== ROLES[index]
    || mapping.atlas_cell.column !== column
    || mapping.atlas_cell.row !== row
    || JSON.stringify(mapping.pivot) !== '[48,96]'
    || mappedAtlasCells.has(`${column},${row}`)
    || !metrics.bounds
    || metrics.visible_pixels < 32
    || metrics.exact_chroma_pixels !== 0
    || JSON.stringify(metrics.bounds) !== JSON.stringify(mapping.placed_bounds)
    || metrics.visible_pixels !== mapping.visible_pixels
    || metrics.bounds.x < 0
    || metrics.bounds.y < 0
    || metrics.bounds.x + metrics.bounds.width > ATLAS.cell
    || metrics.bounds.y + metrics.bounds.height !== ATLAS.cell
  ) throw new Error(`Layered-depth runtime role is invalid: ${mapping.role}.`);
  mappedAtlasCells.add(`${column},${row}`);
}
for (let row = 0; row < ATLAS.rows; row += 1) {
  for (let column = 0; column < ATLAS.columns; column += 1) {
    const metrics = cellMetrics(atlas, column, row, ATLAS.cell);
    const mapped = mappedAtlasCells.has(`${column},${row}`);
    if (
      (mapped && metrics.visible_pixels < 32)
      || (!mapped && metrics.visible_pixels !== 0)
    ) throw new Error(`Layered-depth atlas cell ${column},${row} violates alpha policy.`);
  }
}
for (const check of [
  'exact_target_grid',
  'deterministic_png',
  'required_roles_present',
  'canonical_roles_bound',
  'mapped_cells_visible',
  'mapped_cells_in_bounds',
  'all_unmapped_cells_transparent',
  'common_bottom_pivot',
]) {
  if (atlasManifest.automated_checks[check] !== 'pass') {
    throw new Error(`Layered-depth automated check did not pass: ${check}.`);
  }
}
if (
  atlasManifest.automated_checks.exact_chroma_key_visible_pixels !== 0
  || atlasManifest.automated_checks.godot_runtime !== 'pending'
  || atlasManifest.automated_checks.raspberry_pi_runtime !== 'pending'
  || atlasManifest.automated_checks.human_art_review !== 'pending'
  || !atlasManifest.not_accepted_for.includes('Godot runtime pass')
  || !atlasManifest.not_accepted_for.includes('Raspberry Pi pass')
  || !atlasManifest.not_accepted_for.includes('human art approval')
) throw new Error('Layered-depth runtime limitations are not explicit.');

console.log(
  `MAPSOO_LAYERED_DEPTH_PROP_STRICT_OK roles=${ROLES.length} mapped=`
  + `${mappedAtlasCells.size} unmapped=`
  + `${ATLAS.columns * ATLAS.rows - mappedAtlasCells.size} `
  + `sha256=${atlasManifest.sha256}`,
);
