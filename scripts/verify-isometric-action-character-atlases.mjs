import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pako from 'pako';

const ART_ROOT = 'docs/visual-qa/production-art';
const BUILDER = resolve('scripts/build-isometric-action-character-atlases.mjs');
const DIRECTIONS = Object.freeze([
  'north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west',
]);
const PLAYER_ACTIONS = Object.freeze([
  'idle', 'move', 'attack-primary', 'dash', 'hurt', 'defeat',
]);
const ENEMY_ACTIONS = Object.freeze([
  'idle', 'move', 'attack-primary', 'hurt', 'defeat',
]);
const TARGET = Object.freeze({
  width: 768,
  height: 512,
  columns: 16,
  rows: 8,
  frameWidth: 48,
  frameHeight: 64,
  pivot: [24, 58],
});
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CONFIGS = Object.freeze([
  Object.freeze({
    id: 'player',
    role: 'character.player.atlas',
    actions: PLAYER_ACTIONS,
    sourceSha256: '712d74e8c7538ef9c5993603ea7dc53f5ea97730be86e42ed1f9f92b23b3e9ba',
    rgbaSha256: 'c0f8832103f7e8b8c6cf5488eed5dcee81473818c3a0a9b23e877d0692578ce5',
  }),
  Object.freeze({
    id: 'enemy-melee',
    role: 'character.enemy-melee.atlas',
    actions: ENEMY_ACTIONS,
    sourceSha256: '936d7dff9f1cf336fedae36e697498bafb5130b438218bcec6b8ec819d141fa6',
    rgbaSha256: 'dbd5e328a98e4658c03d7725736ac6e416d6b2831a9a727478be117e9d099966',
  }),
  Object.freeze({
    id: 'enemy-ranged',
    role: 'character.enemy-ranged.atlas',
    actions: ENEMY_ACTIONS,
    sourceSha256: 'b1c9cbd01742256e8e40ef53ee383d7c351631fbb237cb61b9c71b25aa291431',
    rgbaSha256: '90c29d2e268d6a6b95faab0c121d508f0ef0560c71ff9d6c9ad4d6f47d2c5bc1',
  }),
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function concatenate(parts) {
  const output = Buffer.alloc(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    Buffer.from(part).copy(output, offset);
    offset += part.length;
  }
  return output;
}

function paeth(a, b, c) {
  const estimate = a + b - c;
  const da = Math.abs(estimate - a);
  const db = Math.abs(estimate - b);
  const dc = Math.abs(estimate - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

function decodeRgbaPng(bytes, label) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from(PNG_SIGNATURE))) {
    throw new Error(`${label} is not a PNG.`);
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) {
    throw new Error(`${label} must be non-interlaced 8-bit RGBA.`);
  }
  const idat = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (offset + 12 + length > bytes.length) throw new Error(`${label} has a truncated PNG chunk.`);
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  const stride = width * 4;
  const filtered = pako.inflate(concatenate(idat));
  if (filtered.length !== (stride + 1) * height) throw new Error(`${label} scanline length is invalid.`);
  const rgba = new Uint8Array(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x];
      const outputOffset = y * stride + x;
      const left = x >= 4 ? rgba[outputOffset - 4] : 0;
      const up = y > 0 ? rgba[outputOffset - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? rgba[outputOffset - stride - 4] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upperLeft);
      else throw new Error(`${label} uses unsupported PNG filter ${filter}.`);
      rgba[outputOffset] = value & 0xff;
    }
    sourceOffset += stride;
  }
  return { width, height, rgba };
}

function cueId(red, green, blue, id) {
  if (id === 'dark-hair') return red < 82 && green < 78 && blue < 88;
  if (id === 'mustard-scarf') return red > 125 && green > 70 && green < 190 && blue < 85 && red > green * 1.15;
  if (id === 'plum-coat') return red > 65 && red < 180 && green < 90 && blue > 45 && red > blue * 1.05;
  if (id === 'brown-satchel') return red > 70 && red < 180 && green > 35 && green < 120 && blue < 85;
  if (id === 'charcoal-armor' || id === 'charcoal-cloth') return red < 105 && green < 100 && blue < 115;
  if (id === 'copper-trim' || id === 'copper-bracers') return red > 90 && red < 210 && green > 45 && green < 145 && blue < 95;
  if (id === 'violet-plume' || id === 'violet-hood') return red > 60 && red < 180 && green < 95 && blue > 55 && blue > green;
  if (id === 'amber-visor') return red > 135 && green > 60 && green < 190 && blue < 70;
  if (id === 'teal-lens') return red < 90 && green > 100 && blue > 100 && blue >= red * 1.5;
  return false;
}

function frameBytes(image, column, row) {
  const bytes = Buffer.alloc(TARGET.frameWidth * TARGET.frameHeight * 4);
  let writeOffset = 0;
  for (let y = 0; y < TARGET.frameHeight; y += 1) {
    const offset = (
      ((row * TARGET.frameHeight + y) * image.width + column * TARGET.frameWidth) * 4
    );
    Buffer.from(image.rgba.subarray(offset, offset + TARGET.frameWidth * 4))
      .copy(bytes, writeOffset);
    writeOffset += TARGET.frameWidth * 4;
  }
  return bytes;
}

function frameMetrics(image, column, row, cues) {
  const bytes = frameBytes(image, column, row);
  let minX = TARGET.frameWidth;
  let minY = TARGET.frameHeight;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let greenSpillPixels = 0;
  const cuePixels = Object.fromEntries(cues.map(({ id }) => [id, 0]));
  for (let y = 0; y < TARGET.frameHeight; y += 1) {
    for (let x = 0; x < TARGET.frameWidth; x += 1) {
      const offset = (y * TARGET.frameWidth + x) * 4;
      const red = bytes[offset];
      const green = bytes[offset + 1];
      const blue = bytes[offset + 2];
      const alpha = bytes[offset + 3];
      if (alpha < 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
      if (green > 96 && green > red * 1.35 && green > blue * 1.35) greenSpillPixels += 1;
      for (const cue of cues) if (cueId(red, green, blue, cue.id)) cuePixels[cue.id] += 1;
    }
  }
  if (visiblePixels === 0) return { empty: true, digest: sha256(bytes) };
  return {
    empty: false,
    digest: sha256(bytes),
    visiblePixels,
    greenSpillPixels,
    cuePixels,
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    footAnchorError: TARGET.pivot[1] - (maxY + 1),
  };
}

function paths(config) {
  return {
    source: resolve(`${ART_ROOT}/isometric-action-${config.id}-sheet-source-v1.png`),
    rgba: resolve(`${ART_ROOT}/isometric-action-${config.id}-sheet-rgba-v1.png`),
    sheetManifest: resolve(`${ART_ROOT}/isometric-action-${config.id}-sheet-v1.json`),
    atlas: resolve(`${ART_ROOT}/isometric-action-${config.id}-atlas-v1.png`),
    atlasManifest: resolve(`${ART_ROOT}/isometric-action-${config.id}-atlas-v1.json`),
  };
}

const trackedOutputs = CONFIGS.flatMap((config) => {
  const candidate = paths(config);
  return [candidate.sheetManifest, candidate.atlas, candidate.atlasManifest];
});

function runBuilder() {
  const result = spawnSync(process.execPath, [BUILDER], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Isometric character builder failed.\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  if (!result.stdout.includes('MAPSOO_ISOMETRIC_CHARACTER_ATLASES_OK')) {
    throw new Error('Isometric character builder success sentinel is missing.');
  }
}

async function snapshot() {
  return Promise.all(trackedOutputs.map(async (path) => ({
    path,
    bytes: await readFile(path),
  })));
}

function assertSnapshotsEqual(first, second) {
  for (let index = 0; index < first.length; index += 1) {
    if (first[index].path !== second[index].path || !first[index].bytes.equals(second[index].bytes)) {
      throw new Error(`Repeated build changed ${first[index].path}.`);
    }
  }
}

runBuilder();
const first = await snapshot();
runBuilder();
const second = await snapshot();
assertSnapshotsEqual(first, second);

const summary = [];
for (const config of CONFIGS) {
  const candidatePaths = paths(config);
  const [sourceBytes, rgbaBytes, sheetBytes, atlasBytes, atlasManifestBytes] = await Promise.all([
    readFile(candidatePaths.source),
    readFile(candidatePaths.rgba),
    readFile(candidatePaths.sheetManifest),
    readFile(candidatePaths.atlas),
    readFile(candidatePaths.atlasManifest),
  ]);
  const sheet = JSON.parse(sheetBytes);
  const manifest = JSON.parse(atlasManifestBytes);
  const atlas = decodeRgbaPng(atlasBytes, `${config.id} runtime atlas`);
  const expectedSourcePoses = config.actions.length * DIRECTIONS.length;
  const expectedFrames = expectedSourcePoses * 2;
  const expectedUnmapped = TARGET.columns * TARGET.rows - expectedFrames;

  if (sha256(sourceBytes) !== config.sourceSha256 || sha256(rgbaBytes) !== config.rgbaSha256) {
    throw new Error(`${config.id} immutable source input changed.`);
  }
  if (
    sheet.schema_version !== 'mapsoo-production-art-source/1.0'
    || sheet.profile !== 'isometric-action'
    || sheet.role !== config.role
    || sheet.status !== 'source-candidate'
    || sheet.distribution !== 'internal-review'
    || sheet.output_license !== 'UNRELEASED'
    || sheet.grid.columns !== 8
    || sheet.grid.rows !== config.actions.length
    || sheet.grid.partition_policy !== 'row-wise-connected-component-clustering'
    || JSON.stringify(sheet.grid.column_directions) !== JSON.stringify(DIRECTIONS)
    || JSON.stringify(sheet.grid.row_actions) !== JSON.stringify(config.actions)
    || sheet.grid.row_pose_centers_x.length !== config.actions.length
    || sheet.source_poses.length !== expectedSourcePoses
    || sheet.provenance_claim.native_source_poses !== true
    || sheet.provenance_claim.native_source_pose_count !== expectedSourcePoses
    || sheet.provenance_claim.native_animation_sequence !== false
    || sheet.generation_context.mode !== 'built-in-image-generation'
    || sheet.generation_context.generation_receipt !== 'not-persisted'
  ) {
    throw new Error(`${config.id} source-sheet contract is invalid.`);
  }
  const sourcePoseKeys = new Set();
  const sourcePoseDigests = new Set();
  for (const pose of sheet.source_poses) {
    const key = `${pose.source_cell.column},${pose.source_cell.row}`;
    if (
      pose.clip_id !== `${pose.action}.${pose.direction}`
      || config.actions[pose.source_cell.row] !== pose.action
      || DIRECTIONS[pose.source_cell.column] !== pose.direction
      || pose.component_group_id < 1
      || pose.source_region.width < 1
      || pose.source_region.height < 1
      || pose.detection.component_count < 1
      || pose.detection.visible_pixels < 1
      || pose.detection.transparent_padding !== true
      || !/^[a-f0-9]{64}$/.test(pose.source_subject_rgba_sha256)
      || sourcePoseKeys.has(key)
      || sourcePoseDigests.has(pose.source_subject_rgba_sha256)
    ) {
      throw new Error(`${config.id} source pose ${key} is not a distinct bounded component group.`);
    }
    sourcePoseKeys.add(key);
    sourcePoseDigests.add(pose.source_subject_rgba_sha256);
  }

  if (
    manifest.schema_version !== 'mapsoo-runtime-character-atlas/1.0'
    || manifest.id !== `isometric-action-${config.id}-atlas-v1`
    || manifest.profile !== 'isometric-action'
    || manifest.role !== config.role
    || manifest.status !== 'runtime-candidate'
    || manifest.distribution !== 'internal-review'
    || manifest.output_license !== 'UNRELEASED'
    || manifest.width !== TARGET.width
    || manifest.height !== TARGET.height
    || manifest.bytes !== atlasBytes.length
    || manifest.sha256 !== sha256(atlasBytes)
    || manifest.source_rgba_sha256 !== config.rgbaSha256
    || JSON.stringify(manifest.frame_geometry)
      !== JSON.stringify({ frame_width: 48, frame_height: 64, columns: 16, rows: 8 })
    || JSON.stringify(manifest.pivot) !== JSON.stringify(TARGET.pivot)
    || atlas.width !== TARGET.width
    || atlas.height !== TARGET.height
    || manifest.clips.length !== expectedSourcePoses
    || manifest.frames.length !== expectedFrames
  ) {
    throw new Error(`${config.id} runtime atlas identity, geometry, role or digest is invalid.`);
  }
  if (
    manifest.processing.pose_policy.native_source_pose_count !== expectedSourcePoses
    || manifest.processing.pose_policy.native_model_animation_frame_count !== 0
    || manifest.processing.pose_policy.synthetic_variant_count !== expectedSourcePoses
    || manifest.processing.pose_policy.runtime_frame_count !== expectedFrames
    || manifest.processing.pose_policy.native_animation_sequence !== false
    || manifest.processing.mapped_cells !== expectedFrames
    || manifest.processing.unmapped_transparent_cells !== expectedUnmapped
  ) {
    throw new Error(`${config.id} runtime provenance or mapping counts are overstated.`);
  }

  const frameCells = new Set();
  const frameDigests = new Set();
  let maximumFootError = 0;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = 0;
  for (const frame of manifest.frames) {
    const actionIndex = config.actions.indexOf(frame.action);
    const directionIndex = DIRECTIONS.indexOf(frame.direction);
    const expectedColumn = directionIndex * 2 + frame.frame_index;
    const expectedRow = actionIndex;
    const key = `${frame.atlas_cell.column},${frame.atlas_cell.row}`;
    const metrics = frameMetrics(atlas, frame.atlas_cell.column, frame.atlas_cell.row, manifest.identity.cues);
    if (
      actionIndex < 0
      || directionIndex < 0
      || frame.clip_id !== `${frame.action}.${frame.direction}`
      || ![0, 1].includes(frame.frame_index)
      || frame.atlas_cell.column !== expectedColumn
      || frame.atlas_cell.row !== expectedRow
      || frame.pixel_origin.x !== expectedColumn * TARGET.frameWidth
      || frame.pixel_origin.y !== expectedRow * TARGET.frameHeight
      || JSON.stringify(frame.pixel_rect) !== JSON.stringify({
        x: expectedColumn * TARGET.frameWidth,
        y: expectedRow * TARGET.frameHeight,
        width: TARGET.frameWidth,
        height: TARGET.frameHeight,
      })
      || metrics.empty
      || metrics.digest !== frame.frame_rgba_sha256
      || metrics.visiblePixels !== frame.visible_pixels
      || JSON.stringify(metrics.bounds) !== JSON.stringify(frame.visible_bounds)
      || metrics.bounds.height !== frame.visible_height
      || metrics.footAnchorError !== frame.foot_anchor_error_px
      || metrics.footAnchorError < 0
      || metrics.footAnchorError > 1
      || JSON.stringify(frame.pivot) !== JSON.stringify(TARGET.pivot)
      || metrics.greenSpillPixels !== 0
      || JSON.stringify(metrics.cuePixels) !== JSON.stringify(frame.identity_cue_pixels)
      || frame.derivation.native_model_animation_frame !== false
      || frame.derivation.mirrored !== false
      || frameCells.has(key)
      || frameDigests.has(metrics.digest)
    ) {
      throw new Error(`${config.id} runtime frame ${key} fails exact pixel/provenance validation.`);
    }
    if (frame.frame_index === 0) {
      if (
        frame.source_pose.native_source_pose !== true
        || frame.derivation.kind !== 'one-to-one-nearest-neighbor-fit'
        || frame.derivation.synthetic_pose_variant !== false
      ) {
        throw new Error(`${config.id} native source frame ${key} is mislabeled.`);
      }
    } else if (
      frame.source_pose.native_source_pose !== false
      || frame.derivation.kind !== 'deterministic-postprocess-variant'
      || frame.derivation.synthetic_pose_variant !== true
    ) {
      throw new Error(`${config.id} synthetic variant frame ${key} is mislabeled.`);
    }
    frameCells.add(key);
    frameDigests.add(metrics.digest);
    maximumFootError = Math.max(maximumFootError, metrics.footAnchorError);
    minimumHeight = Math.min(minimumHeight, metrics.bounds.height);
    maximumHeight = Math.max(maximumHeight, metrics.bounds.height);
  }

  const clipIds = new Set();
  for (const clip of manifest.clips) {
    const actionIndex = config.actions.indexOf(clip.action);
    const directionIndex = DIRECTIONS.indexOf(clip.direction);
    const records = manifest.frames
      .filter((frame) => frame.clip_id === clip.clip_id)
      .sort((a, b) => a.frame_index - b.frame_index);
    if (
      actionIndex < 0
      || directionIndex < 0
      || clip.clip_id !== `${clip.action}.${clip.direction}`
      || clip.native_source_pose_count !== 1
      || clip.native_model_animation_frame_count !== 0
      || clip.synthetic_variant_count !== 1
      || clip.temporal_animation_continuity !== 'manual-review'
      || clip.frames.length !== 2
      || records.length !== 2
      || clipIds.has(clip.clip_id)
      || records[0].source_pose.source_subject_rgba_sha256
        !== records[1].source_pose.source_subject_rgba_sha256
      || JSON.stringify(clip.frames) !== JSON.stringify(records.map((frame) => ({
        atlas_cell: frame.atlas_cell,
        pixel_origin: frame.pixel_origin,
      })))
    ) {
      throw new Error(`${config.id} clip ${clip.clip_id} is incomplete or overclaims native animation.`);
    }
    clipIds.add(clip.clip_id);
  }
  const expectedClipIds = config.actions.flatMap((action) => (
    DIRECTIONS.map((direction) => `${action}.${direction}`)
  ));
  if (JSON.stringify([...clipIds]) !== JSON.stringify(expectedClipIds)) {
    throw new Error(`${config.id} clip ordering or completeness is invalid.`);
  }

  let unmapped = 0;
  for (let row = 0; row < TARGET.rows; row += 1) {
    for (let column = 0; column < TARGET.columns; column += 1) {
      const key = `${column},${row}`;
      const metrics = frameMetrics(atlas, column, row, manifest.identity.cues);
      if (frameCells.has(key)) {
        if (metrics.empty) throw new Error(`${config.id} mapped cell ${key} is empty.`);
      } else {
        if (!metrics.empty) throw new Error(`${config.id} unmapped cell ${key} is not transparent.`);
        unmapped += 1;
      }
    }
  }
  if (
    unmapped !== expectedUnmapped
    || manifest.automated_checks.unmapped_transparent_cell_count !== expectedUnmapped
    || manifest.automated_checks.mapped_cell_count !== expectedFrames
    || manifest.automated_checks.maximum_foot_anchor_error_px !== maximumFootError
    || JSON.stringify(manifest.automated_checks.visible_height_range)
      !== JSON.stringify([minimumHeight, maximumHeight])
  ) {
    throw new Error(`${config.id} aggregate cell, height or pivot evidence is stale.`);
  }

  for (const cue of manifest.identity.cues) {
    const result = manifest.identity.cue_results.find(({ id }) => id === cue.id);
    const coveredFrames = manifest.frames.filter(
      (frame) => frame.identity_cue_pixels[cue.id] >= Math.max(1, cue.minimumPixels),
    ).length;
    const totalPixels = manifest.frames.reduce(
      (total, frame) => total + frame.identity_cue_pixels[cue.id],
      0,
    );
    const requiredCoverage = cue.minimumFrameCoverage ?? expectedFrames;
    const requiredTotal = cue.minimumTotalPixels ?? cue.minimumPixels * expectedFrames;
    if (
      !result
      || result.covered_frames !== coveredFrames
      || result.total_pixels !== totalPixels
      || result.required_covered_frames !== requiredCoverage
      || result.required_total_pixels !== requiredTotal
      || coveredFrames < requiredCoverage
      || totalPixels < requiredTotal
    ) {
      throw new Error(`${config.id} identity cue ${cue.id} gate is invalid.`);
    }
  }
  if (
    manifest.automated_checks.identity_cue_gate !== 'pass'
    || manifest.automated_checks.Godot_runtime !== 'not-performed'
    || manifest.automated_checks.Raspberry_Pi_runtime !== 'not-performed'
    || manifest.automated_checks.human_review !== 'not-performed'
    || !manifest.not_accepted_for.includes('Godot runtime validation')
    || !manifest.not_accepted_for.includes('Raspberry Pi validation')
    || !manifest.not_accepted_for.includes('human-approved animation')
    || !manifest.not_accepted_for.includes('public asset-pack release')
  ) {
    throw new Error(`${config.id} review boundary is overstated.`);
  }
  summary.push(`${config.id}:${manifest.sha256}:frames=${expectedFrames}:unmapped=${expectedUnmapped}`);
}

console.log(
  `MAPSOO_ISOMETRIC_CHARACTER_VERIFY_OK ${summary.join(' ')}:`
  + 'determinism=two-build-byte-equal:Godot=not-performed:Pi=not-performed:human=not-performed',
);
