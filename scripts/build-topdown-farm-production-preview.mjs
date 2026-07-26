import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const WIDTH = 640;
const HEIGHT = 480;
const TILE = 32;
const OUTPUT_PATH =
  'docs/visual-qa/production-art/topdown-farm-production-preview-v1.png';
const MANIFEST_PATH =
  'docs/visual-qa/production-art/topdown-farm-production-preview-v1.json';
const TERRAIN_MANIFEST =
  'docs/visual-qa/production-art/topdown-farm-terrain-atlas-v1.json';
const PROP_MANIFEST =
  'docs/visual-qa/production-art/topdown-farm-prop-atlas-v1.json';
const CHARACTER_MANIFEST =
  'docs/visual-qa/production-art/topdown-farm-character-atlas-v1.json';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadManifest(path, expectedId) {
  const bytes = await readFile(resolve(path));
  const manifest = JSON.parse(bytes.toString('utf8'));
  assert(
    manifest.id === expectedId
      && manifest.profile === 'topdown-farm'
      && manifest.status === 'runtime-candidate'
      && manifest.distribution === 'internal-review'
      && manifest.output_license === 'UNRELEASED',
    `${path} is not the expected internal top-down farm candidate.`,
  );
  return { bytes, manifest };
}

async function loadRecordedPng(record) {
  const bytes = await readFile(resolve(record.path));
  assert(bytes.length === record.bytes, `${record.path} byte count is stale.`);
  assert(sha256(bytes) === record.sha256, `${record.path} SHA-256 is stale.`);
  const image = decodeRgbaPng(bytes);
  assert(
    image.width === record.width && image.height === record.height,
    `${record.path} dimensions are stale.`,
  );
  return image;
}

function blendPixel(destination, destinationOffset, source, sourceOffset) {
  const sourceAlpha = source[sourceOffset + 3] / 255;
  if (sourceAlpha <= 0) return;
  const destinationAlpha = destination[destinationOffset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    const numerator = source[sourceOffset + channel] * sourceAlpha
      + destination[destinationOffset + channel] * destinationAlpha * (1 - sourceAlpha);
    destination[destinationOffset + channel] =
      outputAlpha <= 0 ? 0 : Math.round(numerator / outputAlpha);
  }
  destination[destinationOffset + 3] = Math.round(outputAlpha * 255);
}

function blit(destination, source, destinationX, destinationY, sourceRect) {
  for (let y = 0; y < sourceRect.height; y += 1) {
    const outputY = destinationY + y;
    if (outputY < 0 || outputY >= destination.height) continue;
    for (let x = 0; x < sourceRect.width; x += 1) {
      const outputX = destinationX + x;
      if (outputX < 0 || outputX >= destination.width) continue;
      const sourceOffset = (
        (sourceRect.y + y) * source.width + sourceRect.x + x
      ) * 4;
      const destinationOffset = (outputY * destination.width + outputX) * 4;
      blendPixel(destination.rgba, destinationOffset, source.rgba, sourceOffset);
    }
  }
}

function colorDistance(left, leftOffset, right, rightOffset) {
  const red = left[leftOffset] - right[rightOffset];
  const green = left[leftOffset + 1] - right[rightOffset + 1];
  const blue = left[leftOffset + 2] - right[rightOffset + 2];
  return Math.sqrt(red * red + green * green + blue * blue) / (Math.sqrt(3) * 255);
}

async function writeIdenticalOrNew(path, bytes, allowedPreviousHashes = []) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      const existingHash = sha256(existing);
      assert(
        allowedPreviousHashes.includes(existingHash),
        `Refusing to overwrite unrecognized generated output: ${path}`,
      );
      await writeFile(resolve(path), bytes);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

function crop(image, sourceRect) {
  const rgba = new Uint8Array(sourceRect.width * sourceRect.height * 4);
  for (let y = 0; y < sourceRect.height; y += 1) {
    const sourceOffset = (
      (sourceRect.y + y) * image.width + sourceRect.x
    ) * 4;
    const destinationOffset = y * sourceRect.width * 4;
    rgba.set(
      image.rgba.subarray(sourceOffset, sourceOffset + sourceRect.width * 4),
      destinationOffset,
    );
  }
  return { width: sourceRect.width, height: sourceRect.height, rgba };
}

const terrainBinding = await loadManifest(
  TERRAIN_MANIFEST,
  'topdown-farm-terrain-atlas-v1',
);
const propBinding = await loadManifest(PROP_MANIFEST, 'topdown-farm-prop-atlas-v1');
const characterBinding = await loadManifest(
  CHARACTER_MANIFEST,
  'topdown-farm-character-atlas-v1',
);
const terrainRecord = terrainBinding.manifest;
const propRecord = propBinding.manifest;
const characterRecord = characterBinding.manifest;
const terrain = await loadRecordedPng(terrainRecord);
const props = await loadRecordedPng(propRecord);
const character = await loadRecordedPng(characterRecord);
assert(
  terrainRecord.cell_width === TILE
    && terrainRecord.cell_height === TILE
    && propRecord.cell_width === 64
    && propRecord.cell_height === 64
    && characterRecord.frame_width === 128
    && characterRecord.frame_height === 128,
  'Top-down production preview source geometry is incompatible.',
);

const terrainRoles = new Map(
  terrainRecord.role_mappings.map((mapping) => [mapping.role, mapping]),
);
const terrainVariants = new Map(
  terrainRecord.variants.map((mapping) => [mapping.variant, mapping]),
);
const propRoles = new Map(
  propRecord.role_mappings.map((mapping) => [mapping.role, mapping]),
);
for (const role of [
  'terrain.ground',
  'terrain.water',
  'terrain.path',
  'terrain.soil',
]) {
  assert(terrainRoles.has(role), `Terrain role is missing: ${role}.`);
}
for (const role of [
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
  'prop.bridge',
  'structure.entrance',
  'structure.exit',
]) {
  assert(propRoles.has(role), `Prop role is missing: ${role}.`);
}
assert(
  characterRecord.clips.length === 12 && characterRecord.frames.length === 32,
  'Top-down production preview requires the 12-clip, 32-frame character candidate.',
);

const preview = {
  width: WIDTH,
  height: HEIGHT,
  rgba: new Uint8Array(WIDTH * HEIGHT * 4),
};
const terrainRect = ({ column, row }) => ({
  x: column * TILE,
  y: row * TILE,
  width: TILE,
  height: TILE,
});
const propRect = ({ column, row }) => ({
  x: column * 64,
  y: row * 64,
  width: 64,
  height: 64,
});
const characterRect = ({ column, row }) => ({
  x: column * 128,
  y: row * 128,
  width: 128,
  height: 128,
});

const terrainPlacements = [];
function placeTerrain(role, variant, column, row, layer) {
  const cell = variant ? terrainVariants.get(variant) : terrainRoles.get(role);
  assert(cell, `Terrain variant is missing: ${variant ?? role}.`);
  blit(preview, terrain, column * TILE, row * TILE, terrainRect(cell));
  terrainPlacements.push({
    role,
    variant: variant ?? null,
    column,
    row,
    layer,
    atlas_cell: { column: cell.column, row: cell.row },
  });
}

for (let row = 0; row < HEIGHT / TILE; row += 1) {
  for (let column = 0; column < WIDTH / TILE; column += 1) {
    const detail = (column * 17 + row * 31) % 13 === 0
      ? 'ground.flowers'
      : (column * 7 + row * 11) % 17 === 0
        ? 'ground.stone-detail'
        : 'ground.plain';
    placeTerrain('terrain.ground', detail, column, row, 'ground');
  }
}
for (let row = 0; row < HEIGHT / TILE; row += 1) {
  placeTerrain('terrain.water', 'water.bank-west', 9, row, 'water');
  placeTerrain('terrain.water', 'water.bank-east', 10, row, 'water');
}
for (let row = 3; row <= 8; row += 1) {
  placeTerrain('terrain.path', 'path.vertical', 2, row, 'path');
  placeTerrain('terrain.path', 'path.vertical', 17, row, 'path');
}
for (let column = 2; column <= 17; column += 1) {
  if (column !== 9 && column !== 10) {
    placeTerrain('terrain.path', 'path.horizontal', column, 8, 'path');
  }
}
for (let column = 17; column <= 18; column += 1) {
  placeTerrain('terrain.path', 'path.horizontal', column, 3, 'path');
}
for (let row = 3; row <= 6; row += 1) {
  for (let column = 4; column <= 7; column += 1) {
    const variant = (column + row) % 5 === 0 ? 'soil.wet' : 'soil.plain';
    placeTerrain('terrain.soil', variant, column, row, 'soil');
  }
}

const propPlacements = [];
function placeProp(role, pivotX, pivotY, layer = 'prop') {
  const mapping = propRoles.get(role);
  assert(mapping, `Prop role is missing: ${role}.`);
  const rect = propRect(mapping.atlas_cell);
  const topLeft = { x: pivotX - 32, y: pivotY - 64 };
  blit(preview, props, topLeft.x, topLeft.y, rect);
  propPlacements.push({
    role,
    pivot: { x: pivotX, y: pivotY },
    top_left: topLeft,
    layer,
    atlas_cell: mapping.atlas_cell,
  });
}

placeProp('structure.house', 128, 160, 'structure');
placeProp('structure.barn', 496, 160, 'structure');
placeProp('prop.bridge', 320, 288, 'structure');
placeProp('prop.tree', 64, 96);
placeProp('prop.tree', 576, 224);
placeProp('prop.tree', 32, 320);
placeProp('prop.rock', 224, 352);
placeProp('prop.flower', 160, 352);
placeProp('prop.gate', 256, 224);
placeProp('prop.fence', 144, 224);
placeProp('prop.fence', 208, 224);
placeProp('prop.crate', 448, 400);
placeProp('prop.market', 496, 400, 'structure');
placeProp('prop.sign', 544, 96);
placeProp('prop.lantern', 560, 160);
placeProp('crop.basic.stage-1', 144, 208, 'crop');
placeProp('crop.basic.stage-2', 176, 208, 'crop');
placeProp('crop.basic.stage-3', 208, 208, 'crop');
placeProp('crop.basic.stage-4', 240, 208, 'crop');
placeProp('prop.sapling', 112, 208);
placeProp('prop.forage', 272, 208);

const beforeCritical = preview.rgba.slice();
placeProp('structure.entrance', 48, 448, 'critical');
placeProp('structure.exit', 592, 96, 'critical');
const criticalPlacements = propPlacements.filter(({ layer }) => layer === 'critical');
const criticalRoleMetrics = criticalPlacements.map((placement) => {
  const mapping = propRoles.get(placement.role);
  const rect = propRect(mapping.atlas_cell);
  let sourceVisiblePixels = 0;
  let finalVisiblePixels = 0;
  let distanceTotal = 0;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sourceOffset = ((rect.y + y) * props.width + rect.x + x) * 4;
      if (props.rgba[sourceOffset + 3] < 16) continue;
      sourceVisiblePixels += 1;
      const worldX = placement.top_left.x + x;
      const worldY = placement.top_left.y + y;
      const worldOffset = (worldY * WIDTH + worldX) * 4;
      const distance = colorDistance(preview.rgba, worldOffset, beforeCritical, worldOffset);
      if (distance > 0.01) finalVisiblePixels += 1;
      distanceTotal += distance;
    }
  }
  assert(sourceVisiblePixels > 0, `${placement.role} has no visible source pixels.`);
  return {
    role: placement.role,
    source_visible_pixels: sourceVisiblePixels,
    visible_fraction: Number((finalVisiblePixels / sourceVisiblePixels).toFixed(6)),
    foreground_coverage: 0,
    mean_color_distance: Number((distanceTotal / sourceVisiblePixels).toFixed(6)),
  };
});
for (const metric of criticalRoleMetrics) {
  assert(
    metric.visible_fraction >= 0.9
      && metric.foreground_coverage <= 0.1
      && metric.mean_color_distance >= 0.12,
    `${metric.role} fails the critical landmark visibility gate.`,
  );
}

const spawn = { x: 80, y: 416 };
const idleSouth = characterRecord.clips.find(({ clip_id: id }) => id === 'idle.south');
assert(idleSouth?.frames?.length === 2, 'Character idle.south clip is incomplete.');
const characterRenderScale = 0.58;
const characterRenderSize = Math.round(128 * characterRenderScale);
const characterPivot = {
  x: Math.round(characterRenderSize / 2),
  y: Math.round(characterRenderSize * 0.94),
};
const characterFrame = resizeNearest(
  crop(character, characterRect(idleSouth.frames[0])),
  characterRenderSize,
  characterRenderSize,
);
blit(
  preview,
  characterFrame,
  spawn.x - characterPivot.x,
  spawn.y - characterPivot.y,
  { x: 0, y: 0, width: characterRenderSize, height: characterRenderSize },
);
const characterPlacement = {
  role: 'character.player.atlas',
  pivot: spawn,
  atlas_cell: idleSouth.frames[0],
  clip_id: 'idle.south',
  render_scale: characterRenderScale,
  rendered_frame_size: {
    width: characterRenderSize,
    height: characterRenderSize,
  },
  rendered_pivot: characterPivot,
};

let opaquePixels = 0;
const quantizedColors = new Set();
for (let offset = 0; offset < preview.rgba.length; offset += 4) {
  if (preview.rgba[offset + 3] === 255) opaquePixels += 1;
  quantizedColors.add(
    `${preview.rgba[offset] >> 4}:${preview.rgba[offset + 1] >> 4}:${preview.rgba[offset + 2] >> 4}`,
  );
}
assert(opaquePixels === WIDTH * HEIGHT, 'Top-down production preview must be fully opaque.');
assert(quantizedColors.size >= 64, 'Top-down production preview has insufficient color diversity.');

const outputBytes = encodeRgbaPng(WIDTH, HEIGHT, preview.rgba);
const manifest = {
  schema_version: 'mapsoo-production-world-preview/1.0',
  id: 'topdown-farm-production-preview-v1',
  profile: 'topdown-farm',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: OUTPUT_PATH,
  media_type: 'image/png',
  width: WIDTH,
  height: HEIGHT,
  bytes: outputBytes.length,
  sha256: sha256(outputBytes),
  source_bindings: {
    terrain_manifest: TERRAIN_MANIFEST,
    terrain_manifest_sha256: sha256(terrainBinding.bytes),
    terrain_sha256: terrainRecord.sha256,
    prop_manifest: PROP_MANIFEST,
    prop_manifest_sha256: sha256(propBinding.bytes),
    prop_sha256: propRecord.sha256,
    character_manifest: CHARACTER_MANIFEST,
    character_manifest_sha256: sha256(characterBinding.bytes),
    character_sha256: characterRecord.sha256,
    character_clip_count: characterRecord.clips.length,
    character_frame_count: characterRecord.frames.length,
  },
  terrain_layout: {
    map: { columns: WIDTH / TILE, rows: HEIGHT / TILE, tile_size: TILE },
    placements: terrainPlacements,
  },
  prop_placements: propPlacements,
  character_placement: characterPlacement,
  runtime_layout: {
    world_bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    player: {
      spawn_anchor: spawn,
      collision_size: { width: 24, height: 20 },
      collision_offset: { x: 0, y: -10 },
      visual_scale: { x: characterRenderScale, y: characterRenderScale },
      visual_offset: { x: 0, y: -34 },
    },
    exit: { id: 'exit-node', x: 592, y: 96, radius: 20 },
    collision_shapes: [
      {
        id: 'river-north',
        role: 'terrain.water',
        shape_type: 'rect',
        rect: { x: 288, y: 0, width: 64, height: 224 },
        visible_binding: { columns: [9, 10], rows: [0, 6] },
      },
      {
        id: 'river-south',
        role: 'terrain.water',
        shape_type: 'rect',
        rect: { x: 288, y: 288, width: 64, height: 192 },
        visible_binding: { columns: [9, 10], rows: [9, 14] },
      },
      {
        id: 'house-blocker',
        role: 'structure.house',
        shape_type: 'rect',
        rect: { x: 104, y: 128, width: 48, height: 32 },
        visible_binding: { placement_index: 0 },
      },
      {
        id: 'barn-blocker',
        role: 'structure.barn',
        shape_type: 'rect',
        rect: { x: 472, y: 128, width: 48, height: 32 },
        visible_binding: { placement_index: 1 },
      },
    ],
    unbound_visible_collision_roles: [],
    navigation: {
      spawn_node_id: 'spawn-node',
      exit_node_id: 'exit-node',
      nodes: [
        { id: 'spawn-node', kind: 'spawn', x: 80, y: 416 },
        { id: 'west-turn', kind: 'route', x: 80, y: 272 },
        { id: 'bridge-west', kind: 'route', x: 272, y: 272 },
        { id: 'bridge-east', kind: 'route', x: 368, y: 272 },
        { id: 'east-turn', kind: 'route', x: 544, y: 272 },
        { id: 'exit-approach', kind: 'route', x: 544, y: 96 },
        { id: 'exit-node', kind: 'exit', x: 592, y: 96 },
      ],
      edges: [
        { from: 'spawn-node', to: 'west-turn', kind: 'north' },
        { from: 'west-turn', to: 'bridge-west', kind: 'east' },
        { from: 'bridge-west', to: 'bridge-east', kind: 'bridge' },
        { from: 'bridge-east', to: 'east-turn', kind: 'east' },
        { from: 'east-turn', to: 'exit-approach', kind: 'north' },
        { from: 'exit-approach', to: 'exit-node', kind: 'east' },
      ],
    },
  },
  critical_role_visibility: criticalRoleMetrics,
  critical_role_thresholds: {
    minimum_visible_fraction: 0.9,
    maximum_foreground_coverage: 0.1,
    minimum_mean_color_distance: 0.12,
  },
  automated_checks: {
    preview_from_exported_assets: 'pass',
    fully_opaque_composite: 'pass',
    quantized_colors: quantizedColors.size,
    deterministic_png: 'pass',
    required_visible_roles: 'pass',
    critical_structure_visibility: 'pass',
    collision_alignment: 'candidate-pass',
    navigation_alignment: 'candidate-pass',
    multi_frame_character_binding: 'candidate-pass',
    godot_runtime: 'pending',
    human_art_review: 'pending',
  },
  not_accepted_for: [
    'public asset-pack release',
    'Raspberry Pi 4B performance claim',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeIdenticalOrNew(
  OUTPUT_PATH,
  outputBytes,
  [
    '13bc1323fb72ad21de83199e3f97d124de9b3bec3d4b7ed4c441cec10203b8a5',
    '9104ee7a7362fa4a3f03fd1fa3112ee5979804fddf334e219bd01bf905bc6e9e',
  ],
);
await writeIdenticalOrNew(
  MANIFEST_PATH,
  manifestBytes,
  [
    '3dc7c3371be0070177fd6132c81555b6dd3f8f5d2dd4cc02607d4292ffd45f95',
    '4050dcfd3bdc6904b0b40c84527eac1d8fe96fd6d849d3e11625f50146d47788',
    '05bd2330a51eb95c3874f69786645f310ab3ebba8f4f9edd49ea973b7369cea6',
  ],
);
console.log(
  `MAPSOO_TOPDOWN_FARM_PREVIEW_OK size=${WIDTH}x${HEIGHT} terrain=${terrainPlacements.length} props=${propPlacements.length} clips=12 frames=32 colors=${quantizedColors.size} sha256=${manifest.sha256}`,
);
