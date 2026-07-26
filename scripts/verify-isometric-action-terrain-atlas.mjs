import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng } from './lib/rgba-png.mjs';

const SOURCE_MANIFEST =
  'docs/visual-qa/production-art/isometric-action-terrain-sheet-v1.json';
const ATLAS_MANIFEST =
  'docs/visual-qa/production-art/isometric-action-terrain-atlas-v1.json';
const REQUIRED_ROLES = Object.freeze([
  'terrain.void',
  'terrain.floor.base',
  'terrain.floor.variant',
  'terrain.floor.edge',
  'terrain.elevation.top',
  'terrain.elevation.riser-left',
  'terrain.elevation.riser-right',
  'terrain.ramp',
  'terrain.wall',
]);
const REQUIRED_AUXILIARY = Object.freeze([
  'waterway.straight',
  'waterway.corner',
  'bridge.deck',
  'bridge.edge',
  'stairs.stone',
  'elevation.outside-corner',
  'floor.damaged',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRelativePath(path) {
  return (
    typeof path === 'string'
    && !path.includes('\\')
    && !path.startsWith('/')
    && !/^[A-Za-z]:/.test(path)
    && path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

async function boundPng(record, label) {
  assert(safeRelativePath(record.path), `${label} has an unsafe path.`);
  const bytes = await readFile(resolve(record.path));
  const image = decodeRgbaPng(bytes);
  assert(bytes.length === record.bytes, `${label} byte count is stale.`);
  assert(sha256(bytes) === record.sha256, `${label} SHA-256 is stale.`);
  assert(
    image.width === record.width && image.height === record.height,
    `${label} dimensions are stale.`,
  );
  return { bytes, image };
}

function inspectCell(image, column, row) {
  const startX = column * 96;
  const startY = row * 96;
  let visiblePixels = 0;
  let boundaryPixels = 0;
  let chromaSpillPixels = 0;
  for (let localY = 0; localY < 96; localY += 1) {
    for (let localX = 0; localX < 96; localX += 1) {
      const offset = ((startY + localY) * image.width + startX + localX) * 4;
      const alpha = image.rgba[offset + 3];
      if (alpha < 16) continue;
      visiblePixels += 1;
      if (
        localX < 2
        || localY < 2
        || localX >= 94
        || localY >= 94
      ) boundaryPixels += 1;
      if (
        alpha >= 192
        && image.rgba[offset] > 230
        && image.rgba[offset + 2] > 230
        && image.rgba[offset + 1] < 70
      ) chromaSpillPixels += 1;
    }
  }
  return { visiblePixels, boundaryPixels, chromaSpillPixels };
}

const sourceManifestBytes = await readFile(resolve(SOURCE_MANIFEST));
const source = JSON.parse(sourceManifestBytes.toString('utf8'));
assert(
  source.schema_version === 'mapsoo-production-art-source/1.0'
    && source.id === 'isometric-action-terrain-sheet-v1'
    && source.profile === 'isometric-action'
    && source.role === 'terrain.atlas'
    && source.status === 'source-candidate'
    && source.distribution === 'internal-review'
    && source.output_license === 'UNRELEASED',
  'Isometric terrain source overstates its status or has an invalid identity.',
);
assert(
  source.generation_context?.provider_mode === 'built-in-image-generation'
    && source.generation_context?.chroma_key === '#ff00ff'
    && safeRelativePath(source.generation_context?.reference_image),
  'Isometric terrain source lacks a valid generation record.',
);
assert(
  source.grid?.columns === 8
    && source.grid?.rows === 4
    && source.grid?.sampling === 'proportional-8x4-source-grid'
    && source.grid?.ordered_slots?.length === 16
    && source.grid?.detected_cells?.length === 16
    && source.grid?.unmapped_source_cells?.length === 16,
  'Isometric terrain source must bind 16 mapped and 16 unmapped cells in an exact 8x4 grid.',
);
const expectedSlots = [
  ...REQUIRED_ROLES.map((id) => ({ type: 'required-role', id })),
  ...REQUIRED_AUXILIARY.map((id) => ({ type: 'auxiliary-variant', id })),
];
assert(
  JSON.stringify(source.grid.ordered_slots) === JSON.stringify(expectedSlots),
  'Isometric terrain ordered source slots are stale or reordered.',
);
const sourceMappedCells = new Set();
for (let index = 0; index < source.grid.detected_cells.length; index += 1) {
  const cell = source.grid.detected_cells[index];
  const expected = expectedSlots[index];
  const key = `${cell.column}:${cell.row}`;
  assert(
    cell.column === index % 8
      && cell.row === Math.floor(index / 8)
      && cell.binding_type === expected.type
      && cell.binding_id === expected.id
      && !sourceMappedCells.has(key)
      && cell.source_bounds?.visible_pixels >= 1_000
      && cell.source_bounds?.width >= 48
      && cell.source_bounds?.height >= 32
      && cell.normalized_bounds?.width > 0
      && cell.normalized_bounds?.height > 0,
    `Isometric terrain mapped source cell ${key} is invalid.`,
  );
  sourceMappedCells.add(key);
}
assert(
  source.grid.unmapped_source_cells.every(
    (cell, index) => cell.column === index % 8 && cell.row === 2 + Math.floor(index / 8),
  ),
  'Isometric terrain unmapped source cell records are stale.',
);
assert(
  Array.isArray(source.rasters)
    && source.rasters.length === 2
    && source.rasters[0].stage === 'chroma-source'
    && source.rasters[1].stage === 'rgba-candidate',
  'Isometric terrain source raster stages are incomplete.',
);
for (const raster of source.rasters) {
  await boundPng(raster, `${SOURCE_MANIFEST}:${raster.stage}`);
}
assert(
  source.automated_checks?.exact_grid === 'pass'
    && source.automated_checks?.mapped_cells_nonempty === 'pass'
    && source.automated_checks?.unmapped_cells_recorded === 'pass'
    && source.automated_checks?.chroma_matte === 'pass'
    && source.automated_checks?.role_semantics === 'manual-review',
  'Isometric terrain source automated gates are incomplete or overstated.',
);
assert(
  source.not_accepted_for?.includes('runtime terrain atlas')
    && source.not_accepted_for?.includes('Godot runtime approval')
    && source.not_accepted_for?.includes('Raspberry Pi approval')
    && source.not_accepted_for?.includes('public asset-pack release'),
  'Isometric terrain source must remain an unreleased source candidate.',
);

const atlas = JSON.parse(await readFile(resolve(ATLAS_MANIFEST), 'utf8'));
assert(
  atlas.schema_version === 'mapsoo-runtime-isometric-terrain-atlas/1.0'
    && atlas.id === 'isometric-action-terrain-atlas-v1'
    && atlas.profile === 'isometric-action'
    && atlas.status === 'runtime-candidate'
    && atlas.distribution === 'internal-review'
    && atlas.output_license === 'UNRELEASED',
  'Isometric terrain atlas overstates its status or has an invalid identity.',
);
assert(
  atlas.source_manifest === SOURCE_MANIFEST
    && atlas.source_manifest_sha256 === sha256(sourceManifestBytes),
  'Isometric terrain atlas does not bind the exact source manifest.',
);
const { image: atlasImage } = await boundPng(atlas, ATLAS_MANIFEST);
assert(
  atlas.width === 768
    && atlas.height === 384
    && atlas.columns === 8
    && atlas.rows === 4
    && atlas.cell_width === 96
    && atlas.cell_height === 96
    && atlas.logical_diamond_footprint?.width === 96
    && atlas.logical_diamond_footprint?.height === 48
    && atlas.alpha_policy === 'straight-alpha',
  'Isometric terrain atlas runtime geometry is invalid.',
);
assert(
  JSON.stringify(atlas.role_mappings?.map(({ role }) => role))
    === JSON.stringify(REQUIRED_ROLES)
    && JSON.stringify(atlas.auxiliary_variants?.map(({ variant }) => variant))
      === JSON.stringify(REQUIRED_AUXILIARY),
  'Isometric terrain atlas lacks the canonical roles or auxiliary variants.',
);
const runtimeMappings = [...atlas.role_mappings, ...atlas.auxiliary_variants];
const runtimeCells = new Set();
for (let index = 0; index < runtimeMappings.length; index += 1) {
  const mapping = runtimeMappings[index];
  const key = `${mapping.column}:${mapping.row}`;
  const metrics = inspectCell(atlasImage, mapping.column, mapping.row);
  assert(
    mapping.column === index % 8
      && mapping.row === Math.floor(index / 8)
      && !runtimeCells.has(key)
      && JSON.stringify(mapping.pivot) === JSON.stringify([48, 92])
      && mapping.visible_pixels === metrics.visiblePixels
      && mapping.boundary_pixels === 0
      && mapping.chroma_spill_pixels === 0
      && metrics.visiblePixels >= 200
      && metrics.boundaryPixels === 0
      && metrics.chromaSpillPixels === 0,
    `Isometric terrain runtime cell ${key} fails its alpha, boundary or chroma gate.`,
  );
  runtimeCells.add(key);
}
for (let row = 2; row < 4; row += 1) {
  for (let column = 0; column < 8; column += 1) {
    const metrics = inspectCell(atlasImage, column, row);
    assert(
      metrics.visiblePixels === 0,
      `Unmapped isometric terrain cell ${column}:${row} is not transparent.`,
    );
  }
}
assert(
  atlas.sanitation?.mapped_cells === 16
    && atlas.sanitation?.unmapped_cells === 16
    && atlas.sanitation?.all_unmapped_cells_transparent === true
    && atlas.automated_checks?.exact_target_dimensions === 'pass'
    && atlas.automated_checks?.exact_target_grid === 'pass'
    && atlas.automated_checks?.mapped_cells_nonempty === 'pass'
    && atlas.automated_checks?.cell_boundaries_transparent === 'pass'
    && atlas.automated_checks?.all_unmapped_cells_transparent === 'pass'
    && atlas.automated_checks?.chroma_spill_pixels === 0
    && atlas.automated_checks?.deterministic_png === 'pass'
    && atlas.automated_checks?.human_art_review === 'pending'
    && atlas.automated_checks?.godot_runtime === 'pending'
    && atlas.automated_checks?.raspberry_pi_runtime === 'pending',
  'Isometric terrain atlas automated gates are incomplete or overstated.',
);
assert(
  atlas.not_accepted_for?.includes('complete world asset pack')
    && atlas.not_accepted_for?.includes('Godot runtime approval')
    && atlas.not_accepted_for?.includes('Raspberry Pi approval')
    && atlas.not_accepted_for?.includes('public asset-pack release'),
  'Isometric terrain atlas must remain an unreleased runtime candidate.',
);

console.log(
  `MAPSOO_ISOMETRIC_TERRAIN_STRICT_OK grid=8x4 roles=9 auxiliary=7 unmapped=16 sha256=${atlas.sha256}`,
);
