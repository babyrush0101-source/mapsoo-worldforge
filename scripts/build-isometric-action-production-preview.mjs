import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng, encodeRgbaPng } from './lib/rgba-png.mjs';

const WIDTH = 640;
const HEIGHT = 360;
const ROOT = 'docs/visual-qa/production-art';
const PACK_MANIFEST = `${ROOT}/isometric-action-pack-atlases-v1.json`;
const OUTPUT_PATH = `${ROOT}/isometric-action-production-preview-v1.png`;
const MANIFEST_PATH = `${ROOT}/isometric-action-production-preview-v1.json`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

async function writeIdenticalOrNew(path, bytes, allowedPreviousHashes = []) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      assert(
        allowedPreviousHashes.includes(sha256(existing)),
        `Refusing to overwrite non-identical isometric production preview: ${path}`,
      );
      await writeFile(resolve(path), bytes);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

const packBytes = await readFile(resolve(PACK_MANIFEST));
const pack = JSON.parse(packBytes.toString('utf8'));
assert(
  pack.id === 'isometric-action-pack-atlases-v1'
    && pack.profile === 'isometric-action'
    && pack.pack_schema === '0.8.0'
    && pack.status === 'runtime-candidate'
    && pack.distribution === 'internal-review'
    && pack.output_license === 'UNRELEASED'
    && pack.atlases?.length === 10,
  'Isometric production preview requires the ten-atlas Pack 0.8 projection.',
);

const atlases = new Map();
const roles = new Map();
for (const record of pack.atlases) {
  const bytes = await readFile(resolve(record.path));
  assert(
    bytes.length === record.bytes && sha256(bytes) === record.sha256,
    `${record.path} does not match the Pack projection record.`,
  );
  const image = decodeRgbaPng(bytes);
  assert(
    image.width === record.width && image.height === record.height,
    `${record.path} dimensions are stale.`,
  );
  atlases.set(record.atlas_id, { image, record });
  for (const mapping of record.roles ?? []) {
    roles.set(mapping.role, { image, record, region: mapping.region });
  }
  if (record.role) roles.set(record.role, { image, record });
}

const preview = {
  width: WIDTH,
  height: HEIGHT,
  rgba: new Uint8Array(WIDTH * HEIGHT * 4),
};
for (let y = 0; y < HEIGHT; y += 1) {
  const t = y / Math.max(1, HEIGHT - 1);
  for (let x = 0; x < WIDTH; x += 1) {
    const offset = (y * WIDTH + x) * 4;
    preview.rgba[offset] = Math.round(11 + 8 * t);
    preview.rgba[offset + 1] = Math.round(15 + 10 * t);
    preview.rgba[offset + 2] = Math.round(27 + 14 * t);
    preview.rgba[offset + 3] = 255;
  }
}

const placements = [];
function placeRole(role, anchorX, anchorY, layer, options = {}) {
  const binding = roles.get(role);
  assert(binding, `Pack projection role is missing: ${role}.`);
  let region = binding.region;
  if (!region) {
    const clip = binding.record.clips.find(
      ({ clip_id: id }) => id === options.clipId,
    );
    assert(clip, `Character clip is missing: ${role}/${options.clipId}.`);
    region = {
      x: clip.pack_pixel_origin.x,
      y: clip.pack_pixel_origin.y,
      width: binding.record.frame_width,
      height: binding.record.frame_height,
    };
  }
  const pivot = binding.record.pivot
    ?? [Math.floor(region.width / 2), region.height];
  const topLeft = {
    x: Math.round(anchorX - pivot[0]),
    y: Math.round(anchorY - pivot[1]),
  };
  blit(preview, binding.image, topLeft.x, topLeft.y, region);
  placements.push({
    role,
    layer,
    anchor: { x: anchorX, y: anchorY },
    top_left: topLeft,
    atlas_id: binding.record.atlas_id,
    region,
    ...(options.clipId ? { clip_id: options.clipId } : {}),
  });
}

const floorPlacements = [];
for (let sum = 0; sum <= 14; sum += 1) {
  for (let row = 0; row < 8; row += 1) {
    const column = sum - row;
    if (column < 0 || column >= 8) continue;
    let role = 'terrain.floor.base';
    if (row === 0 || column === 0 || row === 7 || column === 7) {
      role = 'terrain.floor.edge';
    } else if ((row * 11 + column * 7) % 5 === 0) {
      role = 'terrain.floor.variant';
    }
    if (row >= 3 && row <= 4 && column >= 3 && column <= 4) {
      role = 'terrain.elevation.top';
    }
    if (row === 6 && column === 3) role = 'terrain.ramp';
    const anchor = {
      x: 320 + (column - row) * 32,
      y: 80 + (column + row) * 16,
    };
    placeRole(role, anchor.x, anchor.y, 'terrain');
    floorPlacements.push({ role, column, row, anchor });
  }
}

const spawn = { x: 160, y: 272 };
placeRole('structure.entrance', 112, 288, 'critical');
placeRole('structure.exit', 480, 96, 'critical');
placeRole('structure.checkpoint', 320, 272, 'structure');
placeRole('prop.blocker', 320, 192, 'prop');
placeRole('prop.breakable', 240, 240, 'prop');
placeRole('prop.cover', 400, 240, 'prop');
placeRole('prop.decoration', 208, 160, 'prop');
placeRole('prop.light', 432, 176, 'prop');
placeRole('hazard.contact', 256, 208, 'hazard');
placeRole('hazard.telegraph', 352, 224, 'effect');
placeRole('collectible.primary', 304, 144, 'collectible');
placeRole('collectible.health', 448, 128, 'collectible');
placeRole('effect.player-attack', 224, 264, 'effect');
placeRole('effect.enemy-attack', 368, 208, 'effect');
placeRole('effect.shadow', spawn.x, spawn.y, 'shadow');
placeRole('effect.shadow', 352, 208, 'shadow');
placeRole('effect.shadow', 416, 144, 'shadow');
placeRole('character.player.atlas', spawn.x, spawn.y, 'actor', {
  clipId: 'idle.south-east',
});
placeRole('character.enemy-melee.atlas', 352, 208, 'actor', {
  clipId: 'idle.south-west',
});
placeRole('character.enemy-ranged.atlas', 416, 144, 'actor', {
  clipId: 'idle.south-west',
});

let opaquePixels = 0;
const quantizedColors = new Set();
for (let offset = 0; offset < preview.rgba.length; offset += 4) {
  if (preview.rgba[offset + 3] === 255) opaquePixels += 1;
  quantizedColors.add(
    `${preview.rgba[offset] >> 4}:${preview.rgba[offset + 1] >> 4}:${preview.rgba[offset + 2] >> 4}`,
  );
}
assert(opaquePixels === WIDTH * HEIGHT, 'Isometric production preview must be opaque.');
assert(quantizedColors.size >= 64, 'Isometric production preview lacks color diversity.');

const outputBytes = encodeRgbaPng(WIDTH, HEIGHT, preview.rgba);
const manifest = {
  schema_version: 'mapsoo-production-world-preview/1.0',
  id: 'isometric-action-production-preview-v1',
  profile: 'isometric-action',
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
    pack_atlas_manifest: PACK_MANIFEST,
    pack_atlas_manifest_sha256: sha256(packBytes),
    pack_schema: '0.8.0',
    grid: 'diamond-64x32',
    atlas_count: 10,
    visual_role_count: 29,
    character_clip_count: 128,
  },
  floor_layout: {
    grid: {
      tile_width: 64,
      tile_height: 32,
      elevation_height: 16,
      columns: 8,
      rows: 8,
    },
    placements: floorPlacements,
  },
  placements,
  runtime_layout: {
    world_bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    player: {
      spawn_anchor: spawn,
      collision_size: { width: 16, height: 24 },
      collision_offset: { x: 0, y: -10 },
    },
    exit: { id: 'exit-node', x: 480, y: 96, radius: 22 },
    collision_shapes: [
      {
        id: 'center-blocker',
        role: 'prop.blocker',
        shape_type: 'rect',
        rect: { x: 304, y: 160, width: 32, height: 32 },
        visible_binding: { placement_role: 'prop.blocker', anchor: [320, 192] },
      },
      {
        id: 'east-cover',
        role: 'prop.cover',
        shape_type: 'rect',
        rect: { x: 384, y: 216, width: 32, height: 24 },
        visible_binding: { placement_role: 'prop.cover', anchor: [400, 240] },
      },
    ],
    hazards: [
      {
        id: 'contact-hazard',
        role: 'hazard.contact',
        kind: 'trap',
        rect: { x: 232, y: 184, width: 48, height: 24 },
        visible_binding: { placement_role: 'hazard.contact', anchor: [256, 208] },
      },
    ],
    navigation: {
      spawn_node_id: 'spawn-node',
      exit_node_id: 'exit-node',
      nodes: [
        { id: 'spawn-node', kind: 'spawn', x: 160, y: 272, elevation: 0 },
        { id: 'south-route', kind: 'route', x: 272, y: 272, elevation: 0 },
        { id: 'checkpoint-node', kind: 'checkpoint', x: 320, y: 272, elevation: 0 },
        { id: 'east-route', kind: 'route', x: 448, y: 272, elevation: 0 },
        { id: 'north-route', kind: 'route', x: 448, y: 128, elevation: 0 },
        { id: 'exit-approach', kind: 'route', x: 480, y: 128, elevation: 0 },
        { id: 'exit-node', kind: 'exit', x: 480, y: 96, elevation: 0 },
      ],
      edges: [
        { from: 'spawn-node', to: 'south-route', kind: 'walk' },
        { from: 'south-route', to: 'checkpoint-node', kind: 'walk' },
        { from: 'checkpoint-node', to: 'east-route', kind: 'walk' },
        { from: 'east-route', to: 'north-route', kind: 'walk' },
        { from: 'north-route', to: 'exit-approach', kind: 'dash' },
        { from: 'exit-approach', to: 'exit-node', kind: 'walk' },
      ],
    },
  },
  automated_checks: {
    preview_from_pack_projected_assets: 'pass',
    exact_pack_dimensions: 'pass',
    exact_role_bindings: 'pass',
    fully_opaque_composite: 'pass',
    quantized_colors: quantizedColors.size,
    collision_alignment: 'candidate-pass',
    navigation_alignment: 'candidate-pass',
    godot_runtime: 'pending',
    human_art_review: 'pending',
    raspberry_pi_runtime: 'pending',
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
  ['00026f17f0d2643d85a47e0dcd2d7ec8813977db07acac47d7e92522cf129b36'],
);
await writeIdenticalOrNew(
  MANIFEST_PATH,
  manifestBytes,
  ['941a8be50ca4246e106ed361f5a6452ed7de8fb026d1513e6843b3617349bb99'],
);
console.log(
  `MAPSOO_ISOMETRIC_PRODUCTION_PREVIEW_OK size=${WIDTH}x${HEIGHT} floor=${floorPlacements.length} placements=${placements.length} colors=${quantizedColors.size} sha256=${manifest.sha256}`,
);
