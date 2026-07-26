import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const WIDTH = 640;
const HEIGHT = 360;
const ROOT = 'docs/visual-qa/production-art';
const LAYERS_MANIFEST = `${ROOT}/layered-depth-2d-production-layers-v1.json`;
const PROP_MANIFEST = `${ROOT}/layered-depth-2d-prop-atlas-v1.json`;
const PLAYER_MANIFEST = `${ROOT}/layered-depth-2d-player-atlas-v1.json`;
const NPC_MANIFEST = `${ROOT}/layered-depth-2d-npc-atlas-v1.json`;
const OUTPUT_PATH = `${ROOT}/layered-depth-2d-production-preview-v1.png`;
const MANIFEST_PATH = `${ROOT}/layered-depth-2d-production-preview-v1.json`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadManifest(path, expectedId) {
  const bytes = await readFile(resolve(path));
  const manifest = JSON.parse(bytes.toString('utf8'));
  assert(
    manifest.id === expectedId
      && manifest.profile === 'layered-depth-2d'
      && manifest.status === 'runtime-candidate'
      && manifest.distribution === 'internal-review'
      && manifest.output_license === 'UNRELEASED',
    `${path} is not the expected internal layered-depth candidate.`,
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
  return { bytes, image };
}

function crop(image, rect) {
  const rgba = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceOffset = ((rect.y + y) * image.width + rect.x) * 4;
    const destinationOffset = y * rect.width * 4;
    rgba.set(
      image.rgba.subarray(sourceOffset, sourceOffset + rect.width * 4),
      destinationOffset,
    );
  }
  return { width: rect.width, height: rect.height, rgba };
}

function mixPixel(destination, destinationOffset, source, sourceOffset) {
  const sourceAlpha = source[sourceOffset + 3] / 255;
  if (sourceAlpha <= 0) return;
  const destinationAlpha = destination[destinationOffset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    const numerator = source[sourceOffset + channel] * sourceAlpha
      + destination[destinationOffset + channel]
        * destinationAlpha
        * (1 - sourceAlpha);
    destination[destinationOffset + channel] =
      outputAlpha <= 0 ? 0 : Math.round(numerator / outputAlpha);
  }
  destination[destinationOffset + 3] = Math.round(outputAlpha * 255);
}

function blendFullFrame(destination, source, mode) {
  assert(
    destination.width === source.width && destination.height === source.height,
    `Full-frame ${mode} blend dimensions do not match.`,
  );
  for (let offset = 0; offset < destination.rgba.length; offset += 4) {
    if (mode === 'mix') {
      mixPixel(destination.rgba, offset, source.rgba, offset);
      continue;
    }
    const alpha = source.rgba[offset + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      if (mode === 'multiply') {
        const factor = source.rgba[offset + channel] / 255;
        destination.rgba[offset + channel] = Math.round(
          destination.rgba[offset + channel] * (1 - alpha + factor * alpha),
        );
      } else if (mode === 'add') {
        destination.rgba[offset + channel] = Math.min(
          255,
          Math.round(
            destination.rgba[offset + channel]
              + source.rgba[offset + channel] * alpha,
          ),
        );
      } else {
        throw new Error(`Unsupported full-frame blend mode: ${mode}.`);
      }
    }
    destination.rgba[offset + 3] = 255;
  }
}

function blit(destination, source, destinationX, destinationY) {
  for (let y = 0; y < source.height; y += 1) {
    const outputY = destinationY + y;
    if (outputY < 0 || outputY >= destination.height) continue;
    for (let x = 0; x < source.width; x += 1) {
      const outputX = destinationX + x;
      if (outputX < 0 || outputX >= destination.width) continue;
      const sourceOffset = (y * source.width + x) * 4;
      const destinationOffset = (outputY * destination.width + outputX) * 4;
      mixPixel(destination.rgba, destinationOffset, source.rgba, sourceOffset);
    }
  }
}

async function writeIdenticalOrNew(path, bytes, allowedPreviousHashes = []) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      assert(
        allowedPreviousHashes.includes(sha256(existing)),
        `Refusing to overwrite non-identical layered-depth preview: ${path}`,
      );
      await writeFile(resolve(path), bytes);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

const layersBinding = await loadManifest(
  LAYERS_MANIFEST,
  'layered-depth-2d-production-layers-v1',
);
const propBinding = await loadManifest(
  PROP_MANIFEST,
  'layered-depth-2d-prop-atlas-v1',
);
const playerBinding = await loadManifest(
  PLAYER_MANIFEST,
  'layered-depth-2d-player-atlas-v1',
);
const npcBinding = await loadManifest(
  NPC_MANIFEST,
  'layered-depth-2d-npc-atlas-v1',
);
const layersRecord = layersBinding.manifest;
const propRecord = propBinding.manifest;
const playerRecord = playerBinding.manifest;
const npcRecord = npcBinding.manifest;

assert(
  layersRecord.layers.length === 8
    && layersRecord.layers.every(
      ({ runtime }) => runtime.width === 1280 && runtime.height === 720,
    ),
  'Layered-depth preview requires eight exact 1280x720 production layers.',
);
assert(
  propRecord.width === 768
    && propRecord.height === 768
    && propRecord.cell_width === 96
    && propRecord.cell_height === 96
    && propRecord.role_mappings.length === 22,
  'Layered-depth preview requires the 8x8 production prop atlas.',
);
for (const record of [playerRecord, npcRecord]) {
  assert(
    record.width === 384
      && record.height === 576
      && record.frame_geometry.frame_width === 48
      && record.frame_geometry.frame_height === 72
      && record.pivot[0] === 24
      && record.pivot[1] === 67,
    `${record.id} has incompatible runtime geometry.`,
  );
}

const layerImages = new Map();
const layerInputRecords = [];
for (const layer of layersRecord.layers) {
  const loaded = await loadRecordedPng(layer.runtime);
  const previewImage = resizeNearest(loaded.image, WIDTH, HEIGHT);
  layerImages.set(layer.role, previewImage);
  layerInputRecords.push({
    role: layer.role,
    z_order: layer.z_order,
    blend_mode: layer.blend_mode,
    path: layer.runtime.path,
    bytes: layer.runtime.bytes,
    sha256: layer.runtime.sha256,
    source_size: { width: 1280, height: 720 },
    preview_size: { width: WIDTH, height: HEIGHT },
    resize: 'nearest-neighbour',
  });
}

const propLoaded = await loadRecordedPng(propRecord);
const playerLoaded = await loadRecordedPng(playerRecord);
const npcLoaded = await loadRecordedPng(npcRecord);
const propRoles = new Map(
  propRecord.role_mappings.map((mapping) => [mapping.role, mapping]),
);

const preview = {
  width: WIDTH,
  height: HEIGHT,
  rgba: new Uint8Array(WIDTH * HEIGHT * 4),
};
const composition = [];

function placeLayer(role) {
  const record = layersRecord.layers.find((layer) => layer.role === role);
  assert(record, `Production layer is missing: ${role}.`);
  blendFullFrame(preview, layerImages.get(role), record.blend_mode);
  composition.push({
    kind: 'production-layer',
    role,
    z_order: record.z_order,
    blend_mode: record.blend_mode,
  });
}

for (const role of [
  'background.sky',
  'background.far',
  'background.mid',
  'background.depth-fog',
]) {
  placeLayer(role);
}

const propPlacements = [];
function placeProp(role, anchorX, anchorY, renderScale, layer) {
  const mapping = propRoles.get(role);
  assert(mapping, `Prop role is missing: ${role}.`);
  const rect = {
    x: mapping.atlas_cell.column * propRecord.cell_width,
    y: mapping.atlas_cell.row * propRecord.cell_height,
    width: propRecord.cell_width,
    height: propRecord.cell_height,
  };
  const rendered = resizeNearest(
    crop(propLoaded.image, rect),
    Math.round(rect.width * renderScale),
    Math.round(rect.height * renderScale),
  );
  const pivot = {
    x: Math.round(propRecord.pivot[0] * renderScale),
    y: Math.round(propRecord.pivot[1] * renderScale),
  };
  const topLeft = { x: anchorX - pivot.x, y: anchorY - pivot.y };
  blit(preview, rendered, topLeft.x, topLeft.y);
  propPlacements.push({
    role,
    layer,
    anchor: { x: anchorX, y: anchorY },
    top_left: topLeft,
    atlas_cell: mapping.atlas_cell,
    source_rect: rect,
    render_scale: renderScale,
    rendered_size: { width: rendered.width, height: rendered.height },
    rendered_pivot: pivot,
  });
}

// The ordered anchors make one readable route: entrance -> stairs -> bridge
// -> checkpoint/NPC -> collectible -> exit.
placeProp('terrain.ground', 72, 336, 0.75, 'walkable-base');
placeProp('terrain.path', 144, 326, 0.75, 'walkable-route');
placeProp('terrain.stairs', 218, 310, 0.75, 'walkable-route');
placeProp('terrain.bridge', 302, 288, 0.9, 'walkable-route');
placeProp('terrain.path', 384, 278, 0.75, 'walkable-route');
placeProp('terrain.path', 456, 252, 0.75, 'walkable-route');
placeProp('structure.entrance', 82, 318, 0.85, 'critical');
placeProp('structure.checkpoint', 390, 274, 0.8, 'structure');
placeProp('structure.exit', 548, 222, 0.85, 'critical');
placeProp('structure.landmark', 474, 234, 0.8, 'structure');
placeProp('prop.lamp', 246, 282, 0.7, 'prop');
placeProp('prop.sign', 432, 260, 0.7, 'prop');
placeProp('prop.crate', 166, 320, 0.65, 'prop');
placeProp('prop.rock', 340, 300, 0.65, 'prop');
placeProp('collectible.primary', 466, 226, 0.65, 'collectible');
placeProp('effect.portal', 548, 218, 0.65, 'effect');

const characterPlacements = [];
function placeCharacter(record, image, role, clipId, anchor, scale, layer) {
  const clip = record.clips.find(({ clip_id: id }) => id === clipId);
  assert(clip?.frames?.length === 2, `${role}/${clipId} is incomplete.`);
  const frame = clip.frames[0];
  const rect = {
    x: frame.atlas_cell.column * record.frame_geometry.frame_width,
    y: frame.atlas_cell.row * record.frame_geometry.frame_height,
    width: record.frame_geometry.frame_width,
    height: record.frame_geometry.frame_height,
  };
  const rendered = resizeNearest(
    crop(image, rect),
    Math.round(record.frame_geometry.frame_width * scale),
    Math.round(record.frame_geometry.frame_height * scale),
  );
  const pivot = {
    x: Math.round(record.pivot[0] * scale),
    y: Math.round(record.pivot[1] * scale),
  };
  const topLeft = { x: anchor.x - pivot.x, y: anchor.y - pivot.y };
  blit(preview, rendered, topLeft.x, topLeft.y);
  characterPlacements.push({
    role,
    layer,
    clip_id: clipId,
    frame_index: 0,
    anchor,
    top_left: topLeft,
    atlas_cell: frame.atlas_cell,
    source_rect: rect,
    render_scale: scale,
    rendered_size: { width: rendered.width, height: rendered.height },
    rendered_pivot: pivot,
  });
}

placeCharacter(
  npcRecord,
  npcLoaded.image,
  'character.npc.atlas',
  'talk.left',
  { x: 398, y: 270 },
  1.15,
  'characters',
);
placeCharacter(
  playerRecord,
  playerLoaded.image,
  'character.player.atlas',
  'walk.right',
  { x: 320, y: 290 },
  1.3,
  'characters',
);

placeLayer('near.overlay');
placeLayer('foreground.overlay');
placeLayer('lighting.ambient');
placeLayer('lighting.local');

let opaquePixels = 0;
let transparentPixels = 0;
const quantizedColors = new Set();
for (let offset = 0; offset < preview.rgba.length; offset += 4) {
  if (preview.rgba[offset + 3] === 255) opaquePixels += 1;
  else transparentPixels += 1;
  quantizedColors.add(
    `${preview.rgba[offset] >> 4}:${preview.rgba[offset + 1] >> 4}:${preview.rgba[offset + 2] >> 4}`,
  );
}
assert(
  opaquePixels === WIDTH * HEIGHT && transparentPixels === 0,
  'Layered-depth preview must be fully opaque.',
);
assert(
  quantizedColors.size >= 96,
  'Layered-depth preview has insufficient color diversity.',
);

composition.splice(4, 0,
  {
    kind: 'atlas-placements',
    role: 'world.props-and-terrain',
    z_order: 40,
    blend_mode: 'mix',
    placement_count: propPlacements.length,
  },
  {
    kind: 'atlas-placements',
    role: 'world.characters',
    z_order: 60,
    blend_mode: 'mix',
    placement_count: characterPlacements.length,
  },
);

const outputBytes = encodeRgbaPng(WIDTH, HEIGHT, preview.rgba);
const manifest = {
  schema_version: 'mapsoo-production-world-preview/1.0',
  id: 'layered-depth-2d-production-preview-v1',
  profile: 'layered-depth-2d',
  world: layersRecord.world,
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
    layers_manifest: LAYERS_MANIFEST,
    layers_manifest_sha256: sha256(layersBinding.bytes),
    production_layers: layerInputRecords,
    prop_manifest: PROP_MANIFEST,
    prop_manifest_sha256: sha256(propBinding.bytes),
    prop_atlas: {
      path: propRecord.path,
      bytes: propRecord.bytes,
      sha256: propRecord.sha256,
      role_count: propRecord.role_mappings.length,
    },
    player_manifest: PLAYER_MANIFEST,
    player_manifest_sha256: sha256(playerBinding.bytes),
    player_atlas: {
      path: playerRecord.path,
      bytes: playerRecord.bytes,
      sha256: playerRecord.sha256,
      clip_count: playerRecord.clips.length,
      frame_count: playerRecord.frames.length,
    },
    npc_manifest: NPC_MANIFEST,
    npc_manifest_sha256: sha256(npcBinding.bytes),
    npc_atlas: {
      path: npcRecord.path,
      bytes: npcRecord.bytes,
      sha256: npcRecord.sha256,
      clip_count: npcRecord.clips.length,
      frame_count: npcRecord.frames.length,
    },
  },
  composition_order: composition,
  prop_placements: propPlacements,
  character_placements: characterPlacements,
  runtime_layout: {
    world_bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    player: {
      spawn_anchor: { x: 120, y: 316 },
      current_preview_anchor: { x: 320, y: 290 },
      collision_size: { width: 22, height: 16 },
      collision_offset: { x: 0, y: -8 },
      visual_scale: { x: 1.3, y: 1.3 },
    },
    entrance: { id: 'entrance-node', x: 82, y: 318, radius: 22 },
    exit: { id: 'exit-node', x: 548, y: 222, radius: 22 },
    bridge: {
      id: 'bridge-route',
      rect: { x: 261, y: 263, width: 82, height: 29 },
      visible_binding: { placement_index: 3, role: 'terrain.bridge' },
    },
    stairs: {
      id: 'stairs-route',
      rect: { x: 193, y: 280, width: 51, height: 28 },
      visible_binding: { placement_index: 2, role: 'terrain.stairs' },
    },
    collision_shapes: [
      {
        id: 'south-canal-bank',
        role: 'background.mid',
        shape_type: 'rect',
        rect: { x: 0, y: 340, width: 640, height: 20 },
      },
      {
        id: 'checkpoint-blocker',
        role: 'structure.checkpoint',
        shape_type: 'rect',
        rect: { x: 365, y: 250, width: 50, height: 20 },
        visible_binding: { placement_index: 7 },
      },
      {
        id: 'landmark-blocker',
        role: 'structure.landmark',
        shape_type: 'rect',
        rect: { x: 449, y: 210, width: 50, height: 20 },
        visible_binding: { placement_index: 9 },
      },
    ],
    unbound_visible_collision_roles: [],
    navigation: {
      spawn_node_id: 'spawn-node',
      exit_node_id: 'exit-node',
      nodes: [
        { id: 'entrance-node', kind: 'entrance', x: 82, y: 318 },
        { id: 'spawn-node', kind: 'spawn', x: 120, y: 316 },
        { id: 'stairs-bottom', kind: 'route', x: 190, y: 310 },
        { id: 'stairs-top', kind: 'route', x: 235, y: 288 },
        { id: 'bridge-west', kind: 'route', x: 270, y: 286 },
        { id: 'bridge-east', kind: 'route', x: 340, y: 280 },
        { id: 'npc-node', kind: 'npc', x: 398, y: 270 },
        { id: 'collectible-node', kind: 'collectible', x: 466, y: 226 },
        { id: 'exit-node', kind: 'exit', x: 548, y: 222 },
      ],
      edges: [
        { from: 'entrance-node', to: 'spawn-node', kind: 'walk' },
        { from: 'spawn-node', to: 'stairs-bottom', kind: 'walk' },
        { from: 'stairs-bottom', to: 'stairs-top', kind: 'stairs' },
        { from: 'stairs-top', to: 'bridge-west', kind: 'walk' },
        { from: 'bridge-west', to: 'bridge-east', kind: 'bridge' },
        { from: 'bridge-east', to: 'npc-node', kind: 'walk' },
        { from: 'npc-node', to: 'collectible-node', kind: 'walk' },
        { from: 'collectible-node', to: 'exit-node', kind: 'walk' },
      ],
    },
  },
  visual_readability: {
    player_anchor_inside_source_character_route: true,
    source_character_route_at_preview_scale: {
      x: 272,
      y: 180,
      width: 96,
      height: 144,
    },
    front_layers_after_characters: ['near.overlay', 'foreground.overlay'],
    source_front_layer_route_gate: layersRecord.character_route,
    note: 'The player is centered inside the gated clear corridor while edge foliage and masonry remain in front.',
  },
  automated_checks: {
    preview_from_exact_production_assets: 'pass',
    eight_layer_bindings: 'pass',
    prop_atlas_binding: 'pass',
    player_atlas_binding: 'pass',
    npc_atlas_binding: 'pass',
    entrance_exit_bridge_stairs_npc_collectible_present: 'pass',
    fully_opaque_composite: 'pass',
    quantized_colors: quantizedColors.size,
    deterministic_png: 'pass',
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
await writeIdenticalOrNew(OUTPUT_PATH, outputBytes);
await writeIdenticalOrNew(
  MANIFEST_PATH,
  manifestBytes,
  ['d24219906f3df64c77b5d347ab9eb2f9d8ebcb96b17af66c295eedc81bca454d'],
);
console.log(
  `MAPSOO_LAYERED_DEPTH_PREVIEW_OK size=${WIDTH}x${HEIGHT} layers=8 props=${propPlacements.length} characters=${characterPlacements.length} colors=${quantizedColors.size} sha256=${manifest.sha256}`,
);
