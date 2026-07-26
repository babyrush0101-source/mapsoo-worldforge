import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const ROOT = 'docs/visual-qa/production-art';
const TERRAIN_MANIFEST = `${ROOT}/isometric-action-terrain-atlas-v1.json`;
const PROP_MANIFEST = `${ROOT}/isometric-action-prop-atlas-v1.json`;
const CHARACTER_MANIFESTS = Object.freeze([
  {
    id: 'player',
    role: 'character.player.atlas',
    manifest: `${ROOT}/isometric-action-player-atlas-v1.json`,
    output: `${ROOT}/isometric-action-pack-player-v1.png`,
    expectedClips: 48,
    expectedWidth: 2304,
  },
  {
    id: 'enemy-melee',
    role: 'character.enemy-melee.atlas',
    manifest: `${ROOT}/isometric-action-enemy-melee-atlas-v1.json`,
    output: `${ROOT}/isometric-action-pack-enemy-melee-v1.png`,
    expectedClips: 40,
    expectedWidth: 1920,
  },
  {
    id: 'enemy-ranged',
    role: 'character.enemy-ranged.atlas',
    manifest: `${ROOT}/isometric-action-enemy-ranged-atlas-v1.json`,
    output: `${ROOT}/isometric-action-pack-enemy-ranged-v1.png`,
    expectedClips: 40,
    expectedWidth: 1920,
  },
]);
const OUTPUT_MANIFEST = `${ROOT}/isometric-action-pack-atlases-v1.json`;

const PACK_LAYOUTS = Object.freeze([
  {
    id: 'terrain',
    path: `${ROOT}/isometric-action-pack-terrain-v1.png`,
    width: 576,
    height: 64,
    cellWidth: 64,
    cellHeight: 64,
    roles: [
      'terrain.void',
      'terrain.floor.base',
      'terrain.floor.variant',
      'terrain.floor.edge',
      'terrain.elevation.top',
      'terrain.elevation.riser-left',
      'terrain.elevation.riser-right',
      'terrain.ramp',
      'terrain.wall',
    ],
    source: 'terrain',
  },
  {
    id: 'hazards',
    path: `${ROOT}/isometric-action-pack-hazards-v1.png`,
    width: 128,
    height: 64,
    cellWidth: 64,
    cellHeight: 64,
    roles: ['hazard.contact', 'hazard.telegraph'],
    source: 'prop',
  },
  {
    id: 'props',
    path: `${ROOT}/isometric-action-pack-props-v1.png`,
    width: 320,
    height: 96,
    cellWidth: 64,
    cellHeight: 96,
    roles: [
      'prop.blocker',
      'prop.breakable',
      'prop.cover',
      'prop.decoration',
      'prop.light',
    ],
    source: 'prop',
  },
  {
    id: 'structures',
    path: `${ROOT}/isometric-action-pack-structures-v1.png`,
    width: 192,
    height: 96,
    cellWidth: 64,
    cellHeight: 96,
    roles: ['structure.entrance', 'structure.exit', 'structure.checkpoint'],
    source: 'prop',
  },
  {
    id: 'collectibles',
    path: `${ROOT}/isometric-action-pack-collectibles-v1.png`,
    width: 64,
    height: 32,
    cellWidth: 32,
    cellHeight: 32,
    roles: ['collectible.primary', 'collectible.health'],
    source: 'prop',
  },
  {
    id: 'effects',
    path: `${ROOT}/isometric-action-pack-effects-v1.png`,
    width: 448,
    height: 64,
    cellWidth: 64,
    cellHeight: 64,
    roles: [
      'effect.player-attack',
      'effect.enemy-attack',
      'effect.projectile',
      'effect.impact',
      'effect.dash',
      'effect.spawn',
      'effect.defeat',
    ],
    source: 'prop',
  },
  {
    id: 'shadows',
    path: `${ROOT}/isometric-action-pack-shadows-v1.png`,
    width: 64,
    height: 32,
    cellWidth: 64,
    cellHeight: 32,
    roles: ['effect.shadow'],
    source: 'prop',
  },
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadRecordedAtlas(path, expectedId) {
  const manifestBytes = await readFile(resolve(path));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert(
    manifest.id === expectedId
      && manifest.profile === 'isometric-action'
      && manifest.status === 'runtime-candidate'
      && manifest.distribution === 'internal-review'
      && manifest.output_license === 'UNRELEASED',
    `${path} is not the expected internal production atlas.`,
  );
  const imageBytes = await readFile(resolve(manifest.path));
  assert(
    imageBytes.length === manifest.bytes && sha256(imageBytes) === manifest.sha256,
    `${manifest.path} no longer matches its integrity record.`,
  );
  const image = decodeRgbaPng(imageBytes);
  assert(
    image.width === manifest.width && image.height === manifest.height,
    `${manifest.path} dimensions no longer match its record.`,
  );
  return { manifest, manifestBytes, image };
}

function mappingIndex(manifest) {
  return new Map(
    manifest.role_mappings.map((mapping) => [
      mapping.canonical_role ?? mapping.role,
      mapping,
    ]),
  );
}

function mappingCell(mapping) {
  return mapping.atlas_cell ?? mapping;
}

function cropCell(image, manifest, mapping) {
  const cell = mappingCell(mapping);
  const width = manifest.cell_width;
  const height = manifest.cell_height;
  const rgba = new Uint8Array(width * height * 4);
  const sourceX = cell.column * width;
  const sourceY = cell.row * height;
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = ((sourceY + y) * image.width + sourceX) * 4;
    rgba.set(
      image.rgba.subarray(sourceOffset, sourceOffset + width * 4),
      y * width * 4,
    );
  }
  return { width, height, rgba };
}

function compositeCell(destination, destinationWidth, cell, cellIndex, layout) {
  const destinationX = cellIndex * layout.cellWidth;
  const destinationY = layout.height - cell.height;
  assert(
    destinationX + cell.width <= layout.width
      && destinationY >= 0
      && destinationY + cell.height <= layout.height,
    `Projected ${layout.id} cell does not fit its Pack 0.8 region.`,
  );
  for (let y = 0; y < cell.height; y += 1) {
    const sourceOffset = y * cell.width * 4;
    const targetOffset = (
      (destinationY + y) * destinationWidth + destinationX
    ) * 4;
    destination.set(
      cell.rgba.subarray(sourceOffset, sourceOffset + cell.width * 4),
      targetOffset,
    );
  }
}

function opaqueBounds(image) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] < 16) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

async function writeIdenticalOrNew(path, bytes, allowedPreviousHashes = []) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      assert(
        allowedPreviousHashes.includes(sha256(existing)),
        `Refusing to overwrite non-identical generated Pack atlas: ${path}`,
      );
      await writeFile(resolve(path), bytes);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

const terrain = await loadRecordedAtlas(
  TERRAIN_MANIFEST,
  'isometric-action-terrain-atlas-v1',
);
const props = await loadRecordedAtlas(
  PROP_MANIFEST,
  'isometric-action-prop-atlas-v1',
);
const sources = { terrain, prop: props };
const indexes = {
  terrain: mappingIndex(terrain.manifest),
  prop: mappingIndex(props.manifest),
};

const outputRecords = [];
for (const layout of PACK_LAYOUTS) {
  const source = sources[layout.source];
  const index = indexes[layout.source];
  const rgba = new Uint8Array(layout.width * layout.height * 4);
  const roles = [];
  for (let roleIndex = 0; roleIndex < layout.roles.length; roleIndex += 1) {
    const role = layout.roles[roleIndex];
    const mapping = index.get(role);
    assert(mapping, `Production atlas is missing Pack 0.8 role ${role}.`);
    const sourceCell = cropCell(source.image, source.manifest, mapping);
    const squareSize = layout.cellWidth;
    const projectedSquare = resizeNearest(sourceCell, squareSize, squareSize);
    let projected = projectedSquare;
    if (layout.cellHeight < squareSize) {
      const rgbaSlice = new Uint8Array(layout.cellWidth * layout.cellHeight * 4);
      const sourceStartY = squareSize - layout.cellHeight;
      for (let y = 0; y < layout.cellHeight; y += 1) {
        const sourceOffset = ((sourceStartY + y) * squareSize) * 4;
        rgbaSlice.set(
          projectedSquare.rgba.subarray(
            sourceOffset,
            sourceOffset + layout.cellWidth * 4,
          ),
          y * layout.cellWidth * 4,
        );
      }
      projected = {
        width: layout.cellWidth,
        height: layout.cellHeight,
        rgba: rgbaSlice,
      };
    }
    compositeCell(rgba, layout.width, projected, roleIndex, layout);
    const bounds = opaqueBounds(projected);
    assert(bounds, `Projected Pack 0.8 role is empty: ${role}.`);
    roles.push({
      role,
      region: {
        x: roleIndex * layout.cellWidth,
        y: 0,
        width: layout.cellWidth,
        height: layout.cellHeight,
      },
      source_atlas_cell: mappingCell(mapping),
      projected_visible_bounds: bounds,
    });
  }
  const pngBytes = encodeRgbaPng(layout.width, layout.height, rgba);
  await writeIdenticalOrNew(layout.path, pngBytes);
  outputRecords.push({
    atlas_id: layout.id,
    path: layout.path,
    media_type: 'image/png',
    width: layout.width,
    height: layout.height,
    bytes: pngBytes.length,
    sha256: sha256(pngBytes),
    roles,
  });
}

const characterBindings = [];
for (const spec of CHARACTER_MANIFESTS) {
  const source = await loadRecordedAtlas(spec.manifest, `isometric-action-${spec.id}-atlas-v1`);
  assert(
    source.manifest.role === spec.role
      && source.manifest.frame_geometry?.frame_width === 48
      && source.manifest.frame_geometry?.frame_height === 64
      && source.manifest.pivot?.join(',') === '24,58'
      && source.manifest.clips?.length === spec.expectedClips,
    `${spec.manifest} is incompatible with the Pack 0.8 character contract.`,
  );
  const rgba = new Uint8Array(spec.expectedWidth * 64 * 4);
  const clips = [];
  const clipIds = new Set();
  for (let clipIndex = 0; clipIndex < source.manifest.clips.length; clipIndex += 1) {
    const clip = source.manifest.clips[clipIndex];
    assert(
      typeof clip.clip_id === 'string'
        && !clipIds.has(clip.clip_id)
        && clip.frames?.length >= 2,
      `${spec.manifest} has an invalid or duplicate multi-frame clip.`,
    );
    clipIds.add(clip.clip_id);
    const nativeFrame = clip.frames[0];
    const sourceX = nativeFrame.pixel_origin?.x
      ?? nativeFrame.atlas_cell?.column * 48;
    const sourceY = nativeFrame.pixel_origin?.y
      ?? nativeFrame.atlas_cell?.row * 64;
    assert(
      Number.isSafeInteger(sourceX)
        && Number.isSafeInteger(sourceY)
        && sourceX >= 0
        && sourceY >= 0
        && sourceX + 48 <= source.image.width
        && sourceY + 64 <= source.image.height,
      `${spec.manifest} native frame is out of bounds: ${clip.clip_id}.`,
    );
    const targetX = clipIndex * 48;
    for (let y = 0; y < 64; y += 1) {
      const sourceOffset = ((sourceY + y) * source.image.width + sourceX) * 4;
      const targetOffset = (y * spec.expectedWidth + targetX) * 4;
      rgba.set(
        source.image.rgba.subarray(sourceOffset, sourceOffset + 48 * 4),
        targetOffset,
      );
    }
    clips.push({
      clip_id: clip.clip_id,
      action: clip.action,
      direction: clip.direction,
      pack_pixel_origin: { x: targetX, y: 0 },
      source_pixel_origin: { x: sourceX, y: sourceY },
      frame_policy: 'first-independent-native-source-pose',
    });
  }
  const pngBytes = encodeRgbaPng(spec.expectedWidth, 64, rgba);
  await writeIdenticalOrNew(spec.output, pngBytes);
  const record = {
    atlas_id: spec.id,
    role: spec.role,
    path: spec.output,
    media_type: 'image/png',
    width: spec.expectedWidth,
    height: 64,
    bytes: pngBytes.length,
    sha256: sha256(pngBytes),
    frame_width: 48,
    frame_height: 64,
    pivot: [24, 58],
    clips,
  };
  outputRecords.push(record);
  characterBindings.push({
    manifest: spec.manifest,
    manifest_sha256: sha256(source.manifestBytes),
    production_atlas_sha256: source.manifest.sha256,
    pack_atlas_sha256: record.sha256,
    full_production_runtime_frames:
      source.manifest.processing?.pose_policy?.runtime_frame_count,
    projected_pack_frames: clips.length,
  });
}

const manifest = {
  schema_version: 'mapsoo-isometric-action-pack-atlas-projection/1.0',
  id: 'isometric-action-pack-atlases-v1',
  profile: 'isometric-action',
  pack_schema: '0.8.0',
  compatibility: {
    grid: 'diamond-64x32',
    godot_min: '4.3',
    importer: 'mapsoo_importer@0.1.0-alpha.11',
  },
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  projection: {
    resampler: 'nearest-neighbor',
    source_cell: [96, 96],
    scale: [2, 3],
    placement: 'bottom-center-in-canonical-pack-region',
    semantic_source: 'manifest-role-mapping-only',
  },
  source_bindings: {
    terrain_manifest: TERRAIN_MANIFEST,
    terrain_manifest_sha256: sha256(terrain.manifestBytes),
    terrain_atlas_sha256: terrain.manifest.sha256,
    prop_manifest: PROP_MANIFEST,
    prop_manifest_sha256: sha256(props.manifestBytes),
    prop_atlas_sha256: props.manifest.sha256,
    characters: characterBindings,
  },
  atlases: outputRecords,
  automated_checks: {
    exact_pack_dimensions: 'pass',
    exact_canonical_role_order: 'pass',
    character_first_native_frame_projection: 'pass',
    mapped_regions_nonempty: 'pass',
    deterministic_png: 'pass',
    godot_import: 'pending',
    human_art_review: 'pending',
    raspberry_pi_runtime: 'pending',
  },
  not_accepted_for: [
    'public asset-pack release',
    'Raspberry Pi approval',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeIdenticalOrNew(
  OUTPUT_MANIFEST,
  manifestBytes,
  ['2abe681b6df4ef48eab81352b73ac9af4315fdb25a3555885664a1baf7d03b64'],
);
console.log(
  `MAPSOO_ISOMETRIC_PACK_ATLASES_OK atlases=${outputRecords.length} roles=${outputRecords.slice(0, 7).reduce((total, record) => total + record.roles.length, 0)} character_clips=${outputRecords.slice(7).reduce((total, record) => total + record.clips.length, 0)} terrain=${outputRecords[0].sha256} manifest_sha256=${sha256(manifestBytes)}`,
);
