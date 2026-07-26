import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { decodeRgbaPng } from './lib/rgba-png.mjs';

const GENERATION_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-sheet-generation-v1.png';
const SOURCE_MANIFEST_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-sheet-v1.json';
const OUTPUT_MANIFEST_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-atlas-v1.json';
const GENERATION_SHA256 =
  'd50ecf478a035197faa5e97ccf18bdd48f809a1ef7bad77feb0713c833e729f7';
const ROLES = Object.freeze([
  'hazard.contact',
  'hazard.telegraph',
  'prop.blocker',
  'prop.breakable',
  'prop.cover',
  'prop.decoration',
  'prop.light',
  'structure.entrance',
  'structure.exit',
  'structure.checkpoint',
  'collectible.primary',
  'collectible.health',
  'effect.player-attack',
  'effect.enemy-attack',
  'effect.projectile',
  'effect.impact',
  'effect.dash',
  'effect.spawn',
  'effect.defeat',
  'effect.shadow',
]);
const SOURCE = Object.freeze({
  width: 1536,
  height: 1024,
  columns: 6,
  rows: 4,
  cell: 256,
});
const ATLAS = Object.freeze({
  width: 768,
  height: 768,
  columns: 8,
  rows: 8,
  cell: 96,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function cellMetrics(image, column, row, cell) {
  let minX = cell;
  let minY = cell;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const offset = (
        ((row * cell + y) * image.width) + column * cell + x
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

const generationBytes = await readFile(resolve(GENERATION_PATH));
const generation = decodeRgbaPng(generationBytes);
if (
  generation.width !== SOURCE.width
  || generation.height !== SOURCE.height
  || generationBytes.length !== 1_605_112
  || sha256(generationBytes) !== GENERATION_SHA256
) {
  throw new Error('Isometric prop generation-original provenance is invalid.');
}

const sourceManifestBytes = await readFile(resolve(SOURCE_MANIFEST_PATH));
const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8'));
if (
  sourceManifest.schema_version !== 'mapsoo-production-art-source/1.0'
  || sourceManifest.id !== 'isometric-action-prop-sheet-v1'
  || sourceManifest.profile !== 'isometric-action'
  || sourceManifest.world_direction !== 'emberglass-foundry'
  || sourceManifest.status !== 'source-candidate'
  || sourceManifest.distribution !== 'internal-review'
  || sourceManifest.output_license !== 'UNRELEASED'
  || sourceManifest.rasters.length !== 3
  || sourceManifest.rasters[0].path !== GENERATION_PATH
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
  || sourceManifest.grid.reserved_cells.length !== 4
) {
  throw new Error('Isometric prop source manifest identity, matte or grid is invalid.');
}
const strictSourceRecord = sourceManifest.rasters.find(
  ({ stage }) => stage === 'strict-chroma-source',
);
const rgbaRecord = sourceManifest.rasters.find(
  ({ stage }) => stage === 'rgba-candidate',
);
if (!strictSourceRecord || !rgbaRecord) {
  throw new Error('Isometric prop source manifest is missing strict rasters.');
}
const strictSourceBytes = await readFile(resolve(strictSourceRecord.path));
const rgbaBytes = await readFile(resolve(rgbaRecord.path));
const strictSource = decodeRgbaPng(strictSourceBytes);
const rgba = decodeRgbaPng(rgbaBytes);
for (const [label, bytes, image, record] of [
  ['strict source', strictSourceBytes, strictSource, strictSourceRecord],
  ['RGBA candidate', rgbaBytes, rgba, rgbaRecord],
]) {
  if (
    image.width !== SOURCE.width
    || image.height !== SOURCE.height
    || bytes.length !== record.bytes
    || sha256(bytes) !== record.sha256
  ) {
    throw new Error(`Isometric prop ${label} does not match its review record.`);
  }
}

const sourceMappedCells = new Set();
for (let index = 0; index < sourceManifest.grid.mapped_cells.length; index += 1) {
  const mapping = sourceManifest.grid.mapped_cells[index];
  const column = index % SOURCE.columns;
  const row = Math.floor(index / SOURCE.columns);
  if (
    mapping.role !== ROLES[index]
    || mapping.column !== column
    || mapping.row !== row
    || sourceMappedCells.has(`${column},${row}`)
  ) {
    throw new Error(`Strict source mapping ${index} is not canonical.`);
  }
  sourceMappedCells.add(`${column},${row}`);
  const metrics = cellMetrics(rgba, column, row, SOURCE.cell);
  if (
    !metrics.bounds
    || metrics.visible_pixels < 128
    || JSON.stringify(metrics.bounds)
      !== JSON.stringify(mapping.strict_visible_bounds)
    || metrics.bounds.x < 18
    || metrics.bounds.y < 18
    || metrics.bounds.x + metrics.bounds.width > SOURCE.cell - 18
    || metrics.bounds.y + metrics.bounds.height > SOURCE.cell - 18
  ) {
    throw new Error(`Strict source role ${mapping.role} is empty or leaves its cell.`);
  }
}
let visibleExactChromaPixels = 0;
for (let index = 0; index < SOURCE.columns * SOURCE.rows; index += 1) {
  const column = index % SOURCE.columns;
  const row = Math.floor(index / SOURCE.columns);
  const rgbaMetrics = cellMetrics(rgba, column, row, SOURCE.cell);
  const mapped = sourceMappedCells.has(`${column},${row}`);
  if (
    (mapped && rgbaMetrics.visible_pixels < 128)
    || (!mapped && rgbaMetrics.visible_pixels !== 0)
  ) {
    throw new Error(`Strict RGBA cell ${column},${row} violates alpha policy.`);
  }
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
      const rgbaAlpha = rgba.rgba[offset + 3];
      if (
        rgbaAlpha >= 16
        && rgba.rgba[offset] === 255
        && rgba.rgba[offset + 1] === 0
        && rgba.rgba[offset + 2] === 255
      ) visibleExactChromaPixels += 1;
      if (
        rgbaAlpha === 0
        && (
          strictSource.rgba[offset] !== 255
          || strictSource.rgba[offset + 1] !== 0
          || strictSource.rgba[offset + 2] !== 255
        )
      ) {
        throw new Error('Strict source background is not exact #ff00ff.');
      }
    }
  }
}
if (
  visibleExactChromaPixels !== 0
  || sourceManifest.automated_checks.exact_chroma_key_visible_pixels !== 0
) {
  throw new Error('Strict RGBA source retains an exact chroma-key pixel.');
}

const outputManifest = JSON.parse(
  await readFile(resolve(OUTPUT_MANIFEST_PATH), 'utf8'),
);
const atlasBytes = await readFile(resolve(outputManifest.path));
const atlas = decodeRgbaPng(atlasBytes);
if (
  outputManifest.schema_version !== 'mapsoo-runtime-prop-atlas/1.0'
  || outputManifest.id !== 'isometric-action-prop-atlas-v1'
  || outputManifest.profile !== 'isometric-action'
  || outputManifest.world_direction !== 'emberglass-foundry'
  || outputManifest.status !== 'runtime-candidate'
  || outputManifest.distribution !== 'internal-review'
  || outputManifest.output_license !== 'UNRELEASED'
  || outputManifest.width !== ATLAS.width
  || outputManifest.height !== ATLAS.height
  || outputManifest.columns !== ATLAS.columns
  || outputManifest.rows !== ATLAS.rows
  || outputManifest.cell_width !== ATLAS.cell
  || outputManifest.cell_height !== ATLAS.cell
  || JSON.stringify(outputManifest.pivot) !== '[48,96]'
  || outputManifest.source_manifest !== SOURCE_MANIFEST_PATH
  || outputManifest.source_manifest_sha256 !== sha256(sourceManifestBytes)
  || JSON.stringify(outputManifest.required_roles) !== JSON.stringify(ROLES)
  || outputManifest.role_mappings.length !== ROLES.length
  || atlas.width !== ATLAS.width
  || atlas.height !== ATLAS.height
  || atlasBytes.length !== outputManifest.bytes
  || sha256(atlasBytes) !== outputManifest.sha256
  || outputManifest.sanitation.mapped_cells !== ROLES.length
  || outputManifest.sanitation.unmapped_cells
    !== ATLAS.columns * ATLAS.rows - ROLES.length
) {
  throw new Error('Isometric runtime prop atlas identity, geometry or digest is invalid.');
}
const mappedAtlasCells = new Set();
for (let index = 0; index < outputManifest.role_mappings.length; index += 1) {
  const mapping = outputManifest.role_mappings[index];
  const column = index % ATLAS.columns;
  const row = Math.floor(index / ATLAS.columns);
  const cellKey = `${column},${row}`;
  const metrics = cellMetrics(atlas, column, row, ATLAS.cell);
  if (
    mapping.role !== ROLES[index]
    || mapping.canonical_role !== ROLES[index]
    || mapping.atlas_cell.column !== column
    || mapping.atlas_cell.row !== row
    || JSON.stringify(mapping.pivot) !== '[48,96]'
    || mappedAtlasCells.has(cellKey)
    || !metrics.bounds
    || metrics.visible_pixels < 32
    || JSON.stringify(metrics.bounds) !== JSON.stringify(mapping.placed_bounds)
    || metrics.visible_pixels !== mapping.visible_pixels
    || metrics.bounds.x < 0
    || metrics.bounds.y < 0
    || metrics.bounds.x + metrics.bounds.width > ATLAS.cell
    || metrics.bounds.y + metrics.bounds.height !== ATLAS.cell
  ) {
    throw new Error(`Runtime role ${mapping.role} is missing, unanchored or invalid.`);
  }
  mappedAtlasCells.add(cellKey);
}
let atlasVisibleExactChromaPixels = 0;
for (let row = 0; row < ATLAS.rows; row += 1) {
  for (let column = 0; column < ATLAS.columns; column += 1) {
    const metrics = cellMetrics(atlas, column, row, ATLAS.cell);
    const mapped = mappedAtlasCells.has(`${column},${row}`);
    if (
      (mapped && metrics.visible_pixels < 32)
      || (!mapped && metrics.visible_pixels !== 0)
    ) {
      throw new Error(`Runtime atlas cell ${column},${row} violates alpha policy.`);
    }
    for (let y = 0; y < ATLAS.cell; y += 1) {
      for (let x = 0; x < ATLAS.cell; x += 1) {
        const offset = (
          ((row * ATLAS.cell + y) * atlas.width) + column * ATLAS.cell + x
        ) * 4;
        if (
          atlas.rgba[offset + 3] >= 16
          && atlas.rgba[offset] === 255
          && atlas.rgba[offset + 1] === 0
          && atlas.rgba[offset + 2] === 255
        ) atlasVisibleExactChromaPixels += 1;
      }
    }
  }
}
if (
  atlasVisibleExactChromaPixels !== 0
  || outputManifest.automated_checks.exact_chroma_key_visible_pixels !== 0
) {
  throw new Error('Runtime atlas retains an exact chroma-key pixel.');
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
  if (outputManifest.automated_checks[check] !== 'pass') {
    throw new Error(`Runtime prop automated check did not pass: ${check}.`);
  }
}
if (
  outputManifest.automated_checks.godot_runtime !== 'pending'
  || outputManifest.automated_checks.raspberry_pi_runtime !== 'pending'
  || outputManifest.automated_checks.human_art_review !== 'pending'
  || !outputManifest.not_accepted_for.includes('Godot runtime pass')
  || !outputManifest.not_accepted_for.includes('Raspberry Pi pass')
  || !outputManifest.not_accepted_for.includes('human art approval')
) {
  throw new Error('Runtime prop limitations are not explicit.');
}

console.log(
  `MAPSOO_ISOMETRIC_PROP_STRICT_OK roles=${ROLES.length} mapped=`
  + `${mappedAtlasCells.size} unmapped=`
  + `${ATLAS.columns * ATLAS.rows - mappedAtlasCells.size} `
  + `sha256=${outputManifest.sha256}`,
);
