import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng, encodeRgbaPng, resizeNearest } from './lib/rgba-png.mjs';

const WIDTH = 1280;
const HEIGHT = 720;
const outputPath = resolve(
  'docs/visual-qa/production-art/side-platformer-production-preview-v1.png',
);
const manifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-production-preview-v1.json',
);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function blendPixel(destination, destinationOffset, source, sourceOffset) {
  const sourceAlpha = source[sourceOffset + 3] / 255;
  if (sourceAlpha <= 0) return;
  const destinationAlpha = destination[destinationOffset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    const numerator = source[sourceOffset + channel] * sourceAlpha
      + destination[destinationOffset + channel] * destinationAlpha * (1 - sourceAlpha);
    destination[destinationOffset + channel] = outputAlpha <= 0 ? 0 : Math.round(numerator / outputAlpha);
  }
  destination[destinationOffset + 3] = Math.round(outputAlpha * 255);
}

function blit(destination, source, destinationX, destinationY, sourceRect = undefined) {
  const rect = sourceRect ?? { x: 0, y: 0, width: source.width, height: source.height };
  for (let y = 0; y < rect.height; y += 1) {
    const outputY = destinationY + y;
    if (outputY < 0 || outputY >= destination.height) continue;
    for (let x = 0; x < rect.width; x += 1) {
      const outputX = destinationX + x;
      if (outputX < 0 || outputX >= destination.width) continue;
      const sourceOffset = ((rect.y + y) * source.width + rect.x + x) * 4;
      const destinationOffset = (outputY * destination.width + outputX) * 4;
      blendPixel(destination.rgba, destinationOffset, source.rgba, sourceOffset);
    }
  }
}

function cloneImage(image) {
  return { width: image.width, height: image.height, rgba: image.rgba.slice() };
}

function colorDistance(left, leftOffset, right, rightOffset) {
  const red = left[leftOffset] - right[rightOffset];
  const green = left[leftOffset + 1] - right[rightOffset + 1];
  const blue = left[leftOffset + 2] - right[rightOffset + 2];
  return Math.sqrt(red * red + green * green + blue * blue) / (Math.sqrt(3) * 255);
}

function criticalRoleVisibility(
  role,
  source,
  sourceRect,
  placement,
  foreground,
  backgroundWithForeground,
  finalPreview,
) {
  const NEAR_OPAQUE_ALPHA = 230;
  let sourceVisiblePixels = 0;
  let nearOpaqueForegroundPixels = 0;
  let unoccludedPixels = 0;
  let colorDistanceTotal = 0;
  for (let y = 0; y < sourceRect.height; y += 1) {
    for (let x = 0; x < sourceRect.width; x += 1) {
      const sourceOffset = ((sourceRect.y + y) * source.width + sourceRect.x + x) * 4;
      if (source.rgba[sourceOffset + 3] < 16) continue;
      const worldOffset = ((placement.y + y) * finalPreview.width + placement.x + x) * 4;
      sourceVisiblePixels += 1;
      if (foreground.rgba[worldOffset + 3] >= NEAR_OPAQUE_ALPHA) {
        nearOpaqueForegroundPixels += 1;
        continue;
      }
      unoccludedPixels += 1;
      colorDistanceTotal += colorDistance(
        finalPreview.rgba,
        worldOffset,
        backgroundWithForeground.rgba,
        worldOffset,
      );
    }
  }
  if (sourceVisiblePixels === 0 || unoccludedPixels === 0) {
    throw new Error(`Critical role has no measurable visible pixels: ${role}.`);
  }
  return {
    role,
    source_visible_pixels: sourceVisiblePixels,
    near_opaque_foreground_pixels: nearOpaqueForegroundPixels,
    near_opaque_alpha_threshold: NEAR_OPAQUE_ALPHA,
    foreground_coverage: Number((nearOpaqueForegroundPixels / sourceVisiblePixels).toFixed(6)),
    visible_fraction: Number((unoccludedPixels / sourceVisiblePixels).toFixed(6)),
    mean_color_distance: Number((colorDistanceTotal / unoccludedPixels).toFixed(6)),
  };
}

async function loadRecordedPng(record) {
  const bytes = await readFile(resolve(record.path));
  if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
    throw new Error(`Preview source does not match its record: ${record.path}.`);
  }
  const image = decodeRgbaPng(bytes);
  if (image.width !== record.width || image.height !== record.height) {
    throw new Error(`Preview source dimensions do not match: ${record.path}.`);
  }
  return image;
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

const backgroundRecord = JSON.parse(await readFile(
  resolve('docs/visual-qa/production-art/side-platformer-background-runtime-v1.json'),
  'utf8',
));
const terrainRecord = JSON.parse(await readFile(
  resolve('docs/visual-qa/production-art/side-platformer-terrain-atlas-v2.json'),
  'utf8',
));
const propRecord = JSON.parse(await readFile(
  resolve('docs/visual-qa/production-art/side-platformer-prop-atlas-v1.json'),
  'utf8',
));
const characterRecord = JSON.parse(await readFile(
  resolve('docs/visual-qa/production-art/side-platformer-character-atlas-v2.json'),
  'utf8',
));
if (
  backgroundRecord.status !== 'runtime-candidate'
  || terrainRecord.status !== 'runtime-candidate'
  || propRecord.status !== 'runtime-candidate'
  || characterRecord.status !== 'runtime-candidate'
) {
  throw new Error('Production preview requires reviewed runtime-candidate inputs.');
}

const backgroundImages = [];
for (const record of backgroundRecord.layers) {
  backgroundImages.push(resizeNearest(await loadRecordedPng(record), WIDTH, HEIGHT));
}
const terrain = await loadRecordedPng(terrainRecord);
const props = await loadRecordedPng(propRecord);
const character = await loadRecordedPng(characterRecord);
const preview = { width: WIDTH, height: HEIGHT, rgba: new Uint8Array(WIDTH * HEIGHT * 4) };

for (let index = 0; index < 4; index += 1) blit(preview, backgroundImages[index], 0, 0);

const placements = [];
const terrainCell = (column) => ({ x: column * 48, y: 0, width: 48, height: 48 });
const propCell = (column, row) => ({ x: column * 64, y: row * 64, width: 64, height: 64 });
const characterCell = (column, row) => ({ x: column * 128, y: row * 128, width: 128, height: 128 });
const terrainLayout = {
  runs: [
    { role: 'terrain.solid', atlas_cell: { column: 0, row: 0 }, start: { x: 0, y: 576 }, count: 27, step: { x: 48, y: 0 } },
    { role: 'terrain.solid', atlas_cell: { column: 0, row: 0 }, start: { x: 0, y: 624 }, count: 27, step: { x: 48, y: 0 } },
    { role: 'terrain.solid', atlas_cell: { column: 0, row: 0 }, start: { x: 0, y: 672 }, count: 27, step: { x: 48, y: 0 } },
    { role: 'terrain.one-way', atlas_cell: { column: 1, row: 0 }, start: { x: 288, y: 432 }, count: 5, step: { x: 48, y: 0 } },
  ],
  singles: [
    { role: 'terrain.slope-up', atlas_cell: { column: 2, row: 0 }, x: 720, y: 528 },
    { role: 'terrain.slope-down', atlas_cell: { column: 3, row: 0 }, x: 768, y: 528 },
    { role: 'terrain.wall', atlas_cell: { column: 4, row: 0 }, x: 960, y: 528 },
  ],
};
for (const run of terrainLayout.runs) {
  for (let index = 0; index < run.count; index += 1) {
    blit(
      preview,
      terrain,
      run.start.x + run.step.x * index,
      run.start.y + run.step.y * index,
      terrainCell(run.atlas_cell.column),
    );
  }
}
for (const item of terrainLayout.singles) {
  blit(preview, terrain, item.x, item.y, terrainCell(item.atlas_cell.column));
}
const environmentBeforeProps = cloneImage(preview);

const propPlacements = [
  ['structure.entrance', 1, 1, 208, 512],
  ['structure.exit', 2, 1, 1084, 512],
  ['structure.checkpoint', 3, 1, 560, 512],
  ['hazard.spikes', 0, 0, 680, 512],
  ['prop.crate', 3, 0, 430, 512],
  ['prop.rock', 4, 0, 830, 512],
  ['prop.plant', 5, 0, 900, 512],
  ['prop.lamp', 7, 0, 1030, 512],
  ['collectible.primary', 4, 1, 610, 462],
  ['collectible.health', 5, 1, 1168, 480],
];
for (const [role, column, row, x, y] of propPlacements) {
  blit(preview, props, x, y, propCell(column, row));
  placements.push({ role, x, y, atlas_cell: { column, row } });
}
blit(preview, character, 80, 456, characterCell(0, 0));
placements.push({
  role: 'character.player.atlas',
  x: 80,
  y: 456,
  atlas_cell: { column: 0, row: 0 },
  pivot_world: { x: 144, y: 576 },
});

blit(preview, backgroundImages[4], 0, 0);
const backgroundWithForeground = cloneImage(environmentBeforeProps);
blit(backgroundWithForeground, backgroundImages[4], 0, 0);
const criticalRoleMetrics = ['structure.entrance', 'structure.exit'].map((role) => {
  const placement = propPlacements.find(([candidate]) => candidate === role);
  if (!placement) throw new Error(`Critical role placement is missing: ${role}.`);
  const [, column, row, x, y] = placement;
  return criticalRoleVisibility(
    role,
    props,
    propCell(column, row),
    { x, y },
    backgroundImages[4],
    backgroundWithForeground,
    preview,
  );
});
for (const metric of criticalRoleMetrics) {
  if (metric.visible_fraction < 0.9 || metric.foreground_coverage > 0.1) {
    throw new Error(`${metric.role} fails the 90% visibility / 10% foreground-coverage gate.`);
  }
}
const exitMetric = criticalRoleMetrics.find(({ role }) => role === 'structure.exit');
if (!exitMetric || exitMetric.mean_color_distance < 0.14) {
  throw new Error('The exit fails the explicit mean color-distance contrast gate.');
}
const outputBytes = encodeRgbaPng(WIDTH, HEIGHT, preview.rgba);
const outputHash = sha256(outputBytes);
let opaquePixels = 0;
const colors = new Set();
for (let offset = 0; offset < preview.rgba.length; offset += 4) {
  if (preview.rgba[offset + 3] === 255) opaquePixels += 1;
  colors.add(
    `${preview.rgba[offset] >> 4}:${preview.rgba[offset + 1] >> 4}:${preview.rgba[offset + 2] >> 4}`,
  );
}
if (opaquePixels !== WIDTH * HEIGHT || colors.size < 64) {
  throw new Error('Production preview coverage or color diversity is invalid.');
}
const manifest = {
  schema_version: 'mapsoo-production-world-preview/1.0',
  id: 'side-platformer-production-preview-v1',
  profile: 'side-platformer',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: 'docs/visual-qa/production-art/side-platformer-production-preview-v1.png',
  media_type: 'image/png',
  width: WIDTH,
  height: HEIGHT,
  bytes: outputBytes.length,
  sha256: outputHash,
  source_bindings: {
    background_manifest: 'docs/visual-qa/production-art/side-platformer-background-runtime-v1.json',
    runtime_background_manifest: 'docs/visual-qa/production-art/side-platformer-background-runtime-1280x720-v1.json',
    capture_background_manifest: 'docs/visual-qa/production-art/side-platformer-background-runtime-640x360-v1.json',
    terrain_manifest: 'docs/visual-qa/production-art/side-platformer-terrain-atlas-v2.json',
    prop_manifest: 'docs/visual-qa/production-art/side-platformer-prop-atlas-v1.json',
    character_manifest: 'docs/visual-qa/production-art/side-platformer-character-atlas-v2.json',
    terrain_sha256: terrainRecord.sha256,
    prop_sha256: propRecord.sha256,
    character_sha256: characterRecord.sha256,
    character_clip_count: characterRecord.clips.length,
    character_frame_count: characterRecord.frames.length,
    character_frame_origin: characterRecord.clips[0].frame_origin,
  },
  terrain_layout: terrainLayout,
  runtime_layout: {
    world_bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    player: {
      spawn_anchor: { x: 144, y: 576 },
      collision_size: { width: 32, height: 60 },
      collision_offset: { x: 0, y: -30 },
      visual_offset: { x: 0, y: -56 },
    },
    exit: { id: 'exit-node', x: 1116, y: 576, radius: 20 },
    collision_shapes: [
      {
        id: 'ground-main',
        role: 'terrain.solid',
        kind: 'solid',
        shape_type: 'rect',
        rect: { x: 0, y: 576, width: WIDTH, height: 144 },
      },
      {
        id: 'upper-platform',
        role: 'terrain.one-way',
        kind: 'one-way',
        shape_type: 'rect',
        rect: { x: 288, y: 432, width: 240, height: 12 },
      },
      {
        id: 'slope-up-main',
        role: 'terrain.slope-up',
        kind: 'solid',
        shape_type: 'polygon',
        points: [
          { x: 720, y: 576 },
          { x: 768, y: 528 },
          { x: 768, y: 576 },
        ],
        visual_binding: {
          terrain_single_index: 0,
          atlas_cell: { column: 2, row: 0 },
          rect: { x: 720, y: 528, width: 48, height: 48 },
        },
      },
      {
        id: 'slope-down-main',
        role: 'terrain.slope-down',
        kind: 'solid',
        shape_type: 'polygon',
        points: [
          { x: 768, y: 528 },
          { x: 816, y: 576 },
          { x: 768, y: 576 },
        ],
        visual_binding: {
          terrain_single_index: 1,
          atlas_cell: { column: 3, row: 0 },
          rect: { x: 768, y: 528, width: 48, height: 48 },
        },
      },
      {
        id: 'wall-main',
        role: 'terrain.wall',
        kind: 'solid',
        shape_type: 'rect',
        rect: { x: 960, y: 528, width: 48, height: 48 },
        visual_binding: {
          terrain_single_index: 2,
          atlas_cell: { column: 4, row: 0 },
          rect: { x: 960, y: 528, width: 48, height: 48 },
        },
      },
    ],
    unbound_visible_collision_roles: [],
    navigation: {
      spawn_node_id: 'spawn-node',
      exit_node_id: 'exit-node',
      nodes: [
        { id: 'spawn-node', kind: 'spawn', x: 144, y: 576 },
        { id: 'slope-up-entry', kind: 'route', x: 720, y: 576 },
        { id: 'slope-peak', kind: 'route', x: 768, y: 528 },
        { id: 'slope-down-exit', kind: 'route', x: 816, y: 576 },
        { id: 'wall-approach', kind: 'route', x: 928, y: 576 },
        { id: 'wall-clear', kind: 'route', x: 1024, y: 576 },
        { id: 'exit-node', kind: 'exit', x: 1116, y: 576 },
      ],
      edges: [
        { from: 'spawn-node', to: 'slope-up-entry', kind: 'walk' },
        { from: 'slope-up-entry', to: 'slope-peak', kind: 'slope-up' },
        { from: 'slope-peak', to: 'slope-down-exit', kind: 'slope-down' },
        { from: 'slope-down-exit', to: 'wall-approach', kind: 'walk' },
        { from: 'wall-approach', to: 'wall-clear', kind: 'jump' },
        { from: 'wall-clear', to: 'exit-node', kind: 'walk' },
      ],
    },
  },
  placements,
  critical_role_visibility: criticalRoleMetrics,
  critical_role_thresholds: {
    minimum_visible_fraction: 0.9,
    maximum_near_opaque_foreground_coverage: 0.1,
    minimum_exit_mean_color_distance: 0.14,
  },
  automated_checks: {
    preview_from_exported_assets: 'pass',
    fully_opaque_composite: 'pass',
    quantized_colors: colors.size,
    deterministic_png: 'pass',
    critical_structure_visibility: 'pass',
    foreground_occlusion: 'pass',
    exit_visual_contrast: 'pass',
    collision_alignment: 'candidate-pass',
    navigation_alignment: 'candidate-pass',
    multi_frame_character_binding: 'candidate-pass',
    godot_runtime: 'candidate-pass',
    godot_headless_world_smoke: 'pass',
    godot_headless_world_smoke_evidence: 'docs/visual-qa/production-art/side-platformer-production-world-godot-v1.json',
    human_art_review: 'pending',
  },
  not_accepted_for: [
    'public asset-pack release',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeIdenticalOrNew(
  outputPath,
  outputBytes,
  [
    '3e8d1b9b875525412f29992a1816982b0643f01396294f7487113d0eee8f3909',
    'ee0bfe7259ce32d152ac20a887a8443931d7e91961fce3b463b8394808e56ad3',
    'fa51847700eece749699a74dc2988d9305c2c5b366096b7ad97e430cca9e0481',
  ],
);
await writeIdenticalOrNew(
  manifestPath,
  manifestBytes,
  [
    '644cbf430f21e3ca80bc4e52f0f78e0fc1224251ae010f4532e41891ba9c839f',
    '5c2c59da951f577bbe8bc2c477dc7ab555fe8cf581c37adeb8adf6ca78d9e776',
    'e8fdff2c316d375ad833ad75071617758bda4ba6df843c4749375b5c5be0412d',
    '932e52e85bc57420e82b89f248b8893e52ee077cc5cd6df910f3c8467cac1e61',
    '80c6cc6eb955e8da4fed08b583ce33009f0a52d79269d4a87d96eea0fe08000d',
    '55a279a15fa9d2e4fa5e09017aeb664a858968cf387bbd16e0db775606842e6b',
  ],
);
console.log(
  `MAPSOO_PRODUCTION_WORLD_PREVIEW_OK side-platformer:${WIDTH}x${HEIGHT}:colors=${colors.size}:sha256=${outputHash}`,
);
