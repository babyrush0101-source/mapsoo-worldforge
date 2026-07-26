import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng } from './lib/rgba-png.mjs';

const SOURCE_MANIFEST =
  'docs/visual-qa/production-art/topdown-farm-terrain-sheet-v1.json';
const ATLAS_MANIFEST =
  'docs/visual-qa/production-art/topdown-farm-terrain-atlas-v1.json';
const REQUIRED_ROLES = [
  'terrain.ground',
  'terrain.water',
  'terrain.path',
  'terrain.soil',
];

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

const sourceManifestBytes = await readFile(resolve(SOURCE_MANIFEST));
const source = JSON.parse(sourceManifestBytes.toString('utf8'));
assert(
  source.schema_version === 'mapsoo-production-art-source/1.0'
    && source.id === 'topdown-farm-terrain-sheet-v1'
    && source.profile === 'topdown-farm'
    && source.status === 'source-candidate'
    && source.distribution === 'internal-review'
    && source.output_license === 'UNRELEASED',
  'Top-down farm terrain source record overstates its status or has an invalid identity.',
);
assert(
  source.grid?.columns === 8
    && source.grid?.rows === 4
    && source.grid?.sampling === 'detected-separated-source-cells'
    && source.grid?.ordered_variants?.length === 32
    && source.grid?.detected_cells?.length === 32,
  'Top-down farm terrain source must bind an exact detected 8x4 grid.',
);
const sourceCells = new Set();
for (const cell of source.grid.detected_cells) {
  const key = `${cell.column}:${cell.row}`;
  assert(
    Number.isInteger(cell.column)
      && cell.column >= 0
      && cell.column < 8
      && Number.isInteger(cell.row)
      && cell.row >= 0
      && cell.row < 4
      && !sourceCells.has(key)
      && cell.source_bounds.width >= 170
      && cell.source_bounds.width <= 195
      && cell.source_bounds.height >= 170
      && cell.source_bounds.height <= 195
      && cell.source_bounds.visible_pixels > 28_000,
    `Top-down farm terrain source cell ${key} is invalid.`,
  );
  sourceCells.add(key);
}
assert(sourceCells.size === 32, 'Top-down farm terrain source grid has duplicate cells.');
for (const raster of source.rasters) {
  await boundPng(raster, `${SOURCE_MANIFEST}:${raster.stage}`);
}
assert(
  source.not_accepted_for.includes('runtime terrain atlas')
    && source.not_accepted_for.includes('public asset-pack release'),
  'The top-down terrain source must reject runtime and release use.',
);

const atlas = JSON.parse(await readFile(resolve(ATLAS_MANIFEST), 'utf8'));
assert(
  atlas.schema_version === 'mapsoo-runtime-terrain-atlas/1.1'
    && atlas.id === 'topdown-farm-terrain-atlas-v1'
    && atlas.profile === 'topdown-farm'
    && atlas.status === 'runtime-candidate'
    && atlas.distribution === 'internal-review'
    && atlas.output_license === 'UNRELEASED',
  'Top-down farm terrain atlas overstates its status or has an invalid identity.',
);
assert(
  atlas.source_manifest === SOURCE_MANIFEST
    && atlas.source_manifest_sha256 === sha256(sourceManifestBytes),
  'Top-down farm terrain atlas does not bind the exact source record.',
);
const { image: atlasImage } = await boundPng(atlas, ATLAS_MANIFEST);
assert(
  atlas.width === 256
    && atlas.height === 128
    && atlas.cell_width === 32
    && atlas.cell_height === 32
    && atlas.alpha_policy === 'straight-alpha',
  'Top-down farm terrain runtime geometry is invalid.',
);
assert(
  JSON.stringify(atlas.role_mappings.map(({ role }) => role))
    === JSON.stringify(REQUIRED_ROLES)
    && atlas.variants.length === 32
    && new Set(atlas.variants.map(({ column, row }) => `${column}:${row}`)).size === 32,
  'Top-down farm terrain atlas has incomplete roles or variants.',
);
for (let offset = 3; offset < atlasImage.rgba.length; offset += 4) {
  assert(atlasImage.rgba[offset] === 255, 'Top-down farm terrain atlas contains a non-opaque pixel.');
}
assert(
  atlas.seam_checks.length === 3
    && atlas.seam_checks.every(({ mismatches }) => mismatches === 0)
    && atlas.automated_checks.exact_target_grid === 'pass'
    && atlas.automated_checks.deterministic_png === 'pass'
    && atlas.automated_checks.all_cells_opaque === 'pass'
    && atlas.automated_checks.base_repeat_edges === 'pass'
    && atlas.automated_checks.transition_semantics === 'manual-review'
    && atlas.automated_checks.godot_runtime === 'pending',
  'Top-down farm terrain atlas automated gates are incomplete or overstated.',
);
assert(
  atlas.not_accepted_for.includes('complete world asset pack')
    && atlas.not_accepted_for.includes('public asset-pack release'),
  'Top-down farm terrain atlas must remain an unreleased partial candidate.',
);

console.log(
  `MAPSOO_TOPDOWN_FARM_TERRAIN_STRICT_OK grid=8x4 roles=4 variants=32 sha256=${atlas.sha256}`,
);
