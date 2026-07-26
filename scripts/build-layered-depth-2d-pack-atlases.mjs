import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const ROOT = 'docs/visual-qa/production-art';
const LAYER_MANIFEST = `${ROOT}/layered-depth-2d-production-layers-v1.json`;
const PROP_MANIFEST = `${ROOT}/layered-depth-2d-prop-atlas-v1.json`;
const OUTPUT_MANIFEST = `${ROOT}/layered-depth-2d-pack-atlases-v1.json`;
const REPLACE = process.argv.includes('--replace-generated');

const LAYERS = Object.freeze([
  ['background.sky', 'background-sky'],
  ['background.far', 'background-far'],
  ['background.mid', 'background-mid'],
  ['background.depth-fog', 'background-depth-fog'],
  ['near.overlay', 'near-overlay'],
  ['lighting.ambient', 'lighting-ambient'],
  ['lighting.local', 'lighting-local'],
  ['foreground.overlay', 'foreground-overlay'],
]);

// Pack 0.9's importer deliberately resolves the second and later role names in
// each alias group to the first physical region. We therefore export one
// explicitly named owner per physical region and record every shared binding.
const ATLAS_LAYOUTS = Object.freeze([
  {
    id: 'terrain',
    path: `${ROOT}/layered-depth-2d-pack-terrain-v1.png`,
    width: 256,
    height: 96,
    cellWidth: 64,
    cellHeight: 96,
    regions: [
      ['terrain.ground', ['terrain.ground', 'terrain.stairs']],
      ['terrain.path', ['terrain.path', 'terrain.water']],
      ['terrain.edge', ['terrain.edge']],
      ['terrain.bridge', ['terrain.bridge']],
    ],
  },
  {
    id: 'props',
    path: `${ROOT}/layered-depth-2d-pack-props-v1.png`,
    width: 320,
    height: 96,
    cellWidth: 64,
    cellHeight: 96,
    regions: [
      ['prop.tree', ['prop.tree', 'prop.occluder']],
      ['prop.rock', ['prop.rock']],
      ['prop.crate', ['prop.crate']],
      ['prop.sign', ['prop.sign']],
      ['prop.lamp', ['prop.lamp']],
    ],
  },
  {
    id: 'structures',
    path: `${ROOT}/layered-depth-2d-pack-structures-v1.png`,
    width: 192,
    height: 112,
    cellWidth: 64,
    cellHeight: 112,
    regions: [
      ['structure.entrance', ['structure.entrance', 'structure.landmark']],
      ['structure.exit', ['structure.exit']],
      ['structure.checkpoint', ['structure.checkpoint']],
    ],
  },
  {
    id: 'collectibles',
    path: `${ROOT}/layered-depth-2d-pack-collectibles-v1.png`,
    width: 64,
    height: 32,
    cellWidth: 32,
    cellHeight: 32,
    regions: [
      ['collectible.primary', ['collectible.primary']],
      ['collectible.health', ['collectible.health']],
    ],
  },
  {
    id: 'effects',
    path: `${ROOT}/layered-depth-2d-pack-effects-v1.png`,
    width: 256,
    height: 64,
    cellWidth: 64,
    cellHeight: 64,
    regions: [
      ['effect.footstep', ['effect.footstep']],
      ['effect.interact', ['effect.interact']],
      ['effect.portal', ['effect.portal']],
      ['effect.ambient', ['effect.ambient']],
    ],
  },
]);

const CHARACTERS = Object.freeze([
  {
    id: 'player',
    role: 'character.player.atlas',
    manifest: `${ROOT}/layered-depth-2d-player-atlas-v1.json`,
    output: `${ROOT}/layered-depth-2d-pack-player-v1.png`,
    clips: 16,
    width: 768,
  },
  {
    id: 'npc',
    role: 'character.npc.atlas',
    manifest: `${ROOT}/layered-depth-2d-npc-atlas-v1.json`,
    output: `${ROOT}/layered-depth-2d-pack-npc-v1.png`,
    clips: 8,
    width: 384,
  },
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeGenerated(path, bytes) {
  try {
    const existing = await readFile(resolve(path));
    if (existing.equals(Buffer.from(bytes))) return;
    assert(REPLACE, `Refusing to overwrite changed generated file: ${path}`);
    await writeFile(resolve(path), bytes);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

async function loadJson(path) {
  const bytes = await readFile(resolve(path));
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

async function loadRecordedImage(record, label) {
  const bytes = await readFile(resolve(record.path));
  assert(
    bytes.length === record.bytes && sha256(bytes) === record.sha256,
    `${label} no longer matches its recorded bytes and SHA-256.`,
  );
  const image = decodeRgbaPng(bytes);
  assert(
    image.width === record.width && image.height === record.height,
    `${label} dimensions no longer match its record.`,
  );
  return { bytes, image };
}

function cropCell(image, mapping, cellWidth, cellHeight) {
  const x = mapping.atlas_cell.column * cellWidth;
  const y = mapping.atlas_cell.row * cellHeight;
  assert(
    x >= 0 && y >= 0 && x + cellWidth <= image.width && y + cellHeight <= image.height,
    `Production role ${mapping.canonical_role ?? mapping.role} is out of bounds.`,
  );
  const rgba = new Uint8Array(cellWidth * cellHeight * 4);
  for (let row = 0; row < cellHeight; row += 1) {
    const start = ((y + row) * image.width + x) * 4;
    rgba.set(image.rgba.subarray(start, start + cellWidth * 4), row * cellWidth * 4);
  }
  return { width: cellWidth, height: cellHeight, rgba };
}

function blitBottomCenter(destination, destinationWidth, region, index, cellWidth, cellHeight) {
  assert(region.width <= cellWidth && region.height <= cellHeight, 'Projected region is too large.');
  const targetX = index * cellWidth + Math.floor((cellWidth - region.width) / 2);
  const targetY = cellHeight - region.height;
  for (let y = 0; y < region.height; y += 1) {
    const sourceStart = y * region.width * 4;
    const targetStart = ((targetY + y) * destinationWidth + targetX) * 4;
    destination.set(region.rgba.subarray(sourceStart, sourceStart + region.width * 4), targetStart);
  }
}

function visiblePixels(image, region = { x: 0, y: 0, width: image.width, height: image.height }) {
  let count = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] >= 16) count += 1;
    }
  }
  return count;
}

const layerSource = await loadJson(LAYER_MANIFEST);
const layerManifest = layerSource.value;
assert(
  layerManifest.id === 'layered-depth-2d-production-layers-v1'
    && layerManifest.profile === 'layered-depth-2d'
    && layerManifest.status === 'runtime-candidate'
    && layerManifest.distribution === 'internal-review'
    && layerManifest.output_license === 'UNRELEASED',
  'Layer production manifest is not the expected internal candidate.',
);

const outputs = [];
for (const [role, slug] of LAYERS) {
  const sourceRecord = layerManifest.layers.find((entry) => entry.role === role)?.runtime;
  assert(sourceRecord, `Production layers are missing ${role}.`);
  const source = await loadRecordedImage(sourceRecord, role);
  assert(source.image.width === 1280 && source.image.height === 720, `${role} is not 1280x720.`);
  const projected = resizeNearest(source.image, 320, 180);
  const png = encodeRgbaPng(320, 180, projected.rgba);
  const path = `${ROOT}/layered-depth-2d-pack-${slug}-v1.png`;
  await writeGenerated(path, png);
  outputs.push({
    kind: 'layer',
    id: role,
    path,
    media_type: 'image/png',
    width: 320,
    height: 180,
    bytes: png.length,
    sha256: sha256(png),
    source_path: sourceRecord.path,
    source_sha256: sourceRecord.sha256,
    source_dimensions: [1280, 720],
    resampler: 'nearest-neighbor',
  });
}

const propSource = await loadJson(PROP_MANIFEST);
const propManifest = propSource.value;
assert(
  propManifest.id === 'layered-depth-2d-prop-atlas-v1'
    && propManifest.profile === 'layered-depth-2d'
    && propManifest.status === 'runtime-candidate'
    && propManifest.distribution === 'internal-review'
    && propManifest.output_license === 'UNRELEASED'
    && propManifest.cell_width === 96
    && propManifest.cell_height === 96,
  'Prop production manifest is not the expected 96px internal candidate.',
);
const propImage = await loadRecordedImage(propManifest, 'layered-depth production prop atlas');
const propIndex = new Map(
  propManifest.role_mappings.map((mapping) => [mapping.canonical_role ?? mapping.role, mapping]),
);

for (const layout of ATLAS_LAYOUTS) {
  const rgba = new Uint8Array(layout.width * layout.height * 4);
  const regions = [];
  for (let index = 0; index < layout.regions.length; index += 1) {
    const [ownerRole, boundRoles] = layout.regions[index];
    const mapping = propIndex.get(ownerRole);
    assert(mapping, `Production prop atlas is missing alias owner ${ownerRole}.`);
    const sourceCell = cropCell(
      propImage.image,
      mapping,
      propManifest.cell_width,
      propManifest.cell_height,
    );
    const projectedSize = layout.cellWidth;
    const projected = resizeNearest(sourceCell, projectedSize, projectedSize);
    assert(visiblePixels(projected) > 0, `Projected alias owner is empty: ${ownerRole}.`);
    blitBottomCenter(
      rgba,
      layout.width,
      projected,
      index,
      layout.cellWidth,
      layout.cellHeight,
    );
    regions.push({
      region_index: index,
      physical_region: {
        x: index * layout.cellWidth,
        y: 0,
        width: layout.cellWidth,
        height: layout.cellHeight,
      },
      source_owner_role: ownerRole,
      bound_importer_roles: boundRoles,
      independent_role_art: boundRoles.length === 1,
      source_atlas_cell: mapping.atlas_cell,
      projected_content: {
        width: projectedSize,
        height: projectedSize,
        placement: 'bottom-center',
      },
    });
  }
  const png = encodeRgbaPng(layout.width, layout.height, rgba);
  await writeGenerated(layout.path, png);
  outputs.push({
    kind: 'atlas',
    id: layout.id,
    path: layout.path,
    media_type: 'image/png',
    width: layout.width,
    height: layout.height,
    bytes: png.length,
    sha256: sha256(png),
    source_path: propManifest.path,
    source_sha256: propManifest.sha256,
    source_cell: [96, 96],
    regions,
  });
}

const characterBindings = [];
for (const spec of CHARACTERS) {
  const source = await loadJson(spec.manifest);
  const manifest = source.value;
  assert(
    manifest.id === `layered-depth-2d-${spec.id}-atlas-v1`
      && manifest.role === spec.role
      && manifest.status === 'runtime-candidate'
      && manifest.distribution === 'internal-review'
      && manifest.output_license === 'UNRELEASED'
      && manifest.frame_geometry?.frame_width === 48
      && manifest.frame_geometry?.frame_height === 72
      && manifest.pivot?.join(',') === '24,67'
      && manifest.clips?.length === spec.clips,
    `${spec.manifest} is incompatible with the Pack 0.9 character geometry.`,
  );
  const image = await loadRecordedImage(manifest, `${spec.id} production atlas`);
  const rgba = new Uint8Array(spec.width * 72 * 4);
  const clips = [];
  for (let index = 0; index < manifest.clips.length; index += 1) {
    const clip = manifest.clips[index];
    const native = manifest.frames.find(
      (frame) => frame.clip_id === clip.clip_id && frame.frame_index === 0,
    );
    assert(
      native
        && native.source_pose?.native_source_pose === true
        && native.derivation?.kind === 'one-to-one-nearest-neighbor-fit'
        && native.derivation?.native_model_animation_frame === false
        && native.derivation?.synthetic_pose_variant === false,
      `${spec.id} ${clip.clip_id} has no honestly labelled independent source pose.`,
    );
    const sourceX = native.pixel_origin.x;
    const sourceY = native.pixel_origin.y;
    assert(
      sourceX >= 0 && sourceY >= 0 && sourceX + 48 <= image.image.width
        && sourceY + 72 <= image.image.height,
      `${spec.id} ${clip.clip_id} native frame is out of bounds.`,
    );
    const targetX = index * 48;
    for (let y = 0; y < 72; y += 1) {
      const sourceStart = ((sourceY + y) * image.image.width + sourceX) * 4;
      const targetStart = (y * spec.width + targetX) * 4;
      rgba.set(image.image.rgba.subarray(sourceStart, sourceStart + 48 * 4), targetStart);
    }
    clips.push({
      clip_id: clip.clip_id,
      action: clip.action,
      direction: clip.direction,
      pack_pixel_origin: { x: targetX, y: 0 },
      source_pixel_origin: { x: sourceX, y: sourceY },
      source_frame_rgba_sha256: native.frame_rgba_sha256,
      frame_policy: 'first-independent-source-pose-only',
      native_model_animation_frame: false,
    });
  }
  const png = encodeRgbaPng(spec.width, 72, rgba);
  await writeGenerated(spec.output, png);
  outputs.push({
    kind: 'character',
    id: spec.id,
    role: spec.role,
    path: spec.output,
    media_type: 'image/png',
    width: spec.width,
    height: 72,
    bytes: png.length,
    sha256: sha256(png),
    frame_width: 48,
    frame_height: 72,
    pivot: [24, 67],
    clips,
  });
  characterBindings.push({
    id: spec.id,
    manifest: spec.manifest,
    manifest_sha256: sha256(source.bytes),
    production_atlas_sha256: manifest.sha256,
    production_runtime_frames: manifest.frames.length,
    pack_projected_frames: clips.length,
    omitted_declared_synthetic_variants: manifest.frames.length - clips.length,
  });
}

const manifest = {
  schema_version: 'mapsoo-layered-depth-pack-atlas-projection/1.0',
  id: 'layered-depth-2d-pack-atlases-v1',
  profile: 'layered-depth-2d',
  pack_schema: '0.9.0',
  compatibility: {
    projection: 'layered-depth-stage',
    godot_min: '4.3',
    importer: 'mapsoo_importer@0.1.0-alpha.12',
  },
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  projection: {
    resampler: 'nearest-neighbor',
    layer_scale: [1, 4],
    prop_source_cell: [96, 96],
    prop_projected_square: [64, 64],
    placement: 'bottom-center-in-canonical-pack-region',
    semantic_source: 'production-manifest-role-mapping-only',
  },
  source_bindings: {
    layers_manifest: LAYER_MANIFEST,
    layers_manifest_sha256: sha256(layerSource.bytes),
    prop_manifest: PROP_MANIFEST,
    prop_manifest_sha256: sha256(propSource.bytes),
    prop_atlas_sha256: propManifest.sha256,
    characters: characterBindings,
  },
  alias_contract: {
    importer_function: 'mapsoo_pack_09.gd::_role_region',
    independent_pack_regions: 18,
    canonical_role_bindings: 22,
    alias_groups: [
      {
        physical_owner: 'terrain.ground',
        shared_roles: ['terrain.ground', 'terrain.stairs'],
        omitted_independent_source_role: 'terrain.stairs',
      },
      {
        physical_owner: 'terrain.path',
        shared_roles: ['terrain.path', 'terrain.water'],
        omitted_independent_source_role: 'terrain.water',
      },
      {
        physical_owner: 'prop.tree',
        shared_roles: ['prop.tree', 'prop.occluder'],
        omitted_independent_source_role: 'prop.occluder',
      },
      {
        physical_owner: 'structure.entrance',
        shared_roles: ['structure.entrance', 'structure.landmark'],
        omitted_independent_source_role: 'structure.landmark',
      },
    ],
    limitation:
      'Pack 0.9 binds each alias group to one physical region; aliased roles do not retain independent art in this projection.',
    upgrade_path:
      'A later Pack schema/importer must allocate distinct regions before all 22 production roles can remain visually independent.',
  },
  outputs,
  automated_checks: {
    exact_importer_dimensions: 'pass',
    source_manifest_hash_binding: 'pass',
    source_atlas_hash_binding: 'pass',
    mapped_regions_nonempty: 'pass',
    unused_padding_transparent: 'pass',
    all_regions_in_bounds: 'pass',
    alias_limitations_disclosed: 'pass',
    character_first_independent_pose_projection: 'pass',
    character_native_animation_claim: false,
    deterministic_png: 'pass',
    godot_import: 'pending',
    human_art_review: 'pending',
    raspberry_pi_runtime: 'pending',
  },
  not_accepted_for: [
    'independent Pack 0.9 art for aliased roles',
    'model-native temporal character animation',
    'public asset-pack release',
    'Raspberry Pi approval',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeGenerated(OUTPUT_MANIFEST, manifestBytes);

console.log(
  `MAPSOO_LAYERED_DEPTH_PACK_ATLASES_OK outputs=${outputs.length}`
  + ` roles=22 physical_regions=18 player_clips=16 npc_clips=8`
  + ` manifest_sha256=${sha256(manifestBytes)}`,
);
