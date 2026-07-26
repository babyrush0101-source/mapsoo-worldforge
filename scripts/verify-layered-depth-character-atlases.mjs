import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pako from 'pako';

const ART_ROOT = 'docs/visual-qa/production-art';
const BUILDER = resolve('scripts/build-layered-depth-character-atlases.mjs');
const DIRECTIONS = Object.freeze(['left', 'right', 'near', 'far']);
const PLAYER_ACTIONS = Object.freeze(['idle', 'walk', 'run', 'interact']);
const NPC_ACTIONS = Object.freeze(['idle', 'talk']);
const TARGET = Object.freeze({
  width: 384,
  height: 576,
  columns: 8,
  rows: 8,
  frameWidth: 48,
  frameHeight: 72,
  pivot: [24, 67],
});
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CONFIGS = Object.freeze([
  Object.freeze({
    id: 'player',
    role: 'character.player.atlas',
    actions: PLAYER_ACTIONS,
    sourceSha256: '64efa788b8549e5e9a2a2ca0301f52fd23531ac74a7112afb6516bb7db9965b5',
    rgbaSha256: 'c74cc93ac606ada040fc20e6c25dd80fd25bb61f1e1c6f16dddd6fd08bd3371d',
  }),
  Object.freeze({
    id: 'npc',
    role: 'character.npc.atlas',
    actions: NPC_ACTIONS,
    sourceSha256: '8bb68b190943b7e0e3b6884d015c00b1d1764ea6258c7aec4aa19782c2ea5821',
    rgbaSha256: '93e0f36739710b0596014f6efd629910435b94fd75e9edc879dd3afebed60ebd',
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
  if (id === 'chestnut-hair') return red > 55 && red < 170 && green > 25 && green < 115 && blue < 85 && red > green * 1.15;
  if (id === 'indigo-cap') return red > 30 && red < 125 && green < 105 && blue > 55 && blue >= green;
  if (id === 'moss-vest') return red > 45 && red < 145 && green > 55 && green < 145 && blue < 80 && green >= blue * 1.2;
  if (id === 'rust-apron') return red > 90 && red < 205 && green > 30 && green < 115 && blue < 80 && red > green * 1.25;
  if (id === 'copper-lantern-brooch') return red > 130 && green > 55 && green < 170 && blue < 75;
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

function candidatePaths(config) {
  return {
    source: resolve(`${ART_ROOT}/layered-depth-2d-${config.id}-sheet-source-v1.png`),
    rgba: resolve(`${ART_ROOT}/layered-depth-2d-${config.id}-sheet-rgba-v1.png`),
    sheetManifest: resolve(`${ART_ROOT}/layered-depth-2d-${config.id}-sheet-v1.json`),
    atlas: resolve(`${ART_ROOT}/layered-depth-2d-${config.id}-atlas-v1.png`),
    atlasManifest: resolve(`${ART_ROOT}/layered-depth-2d-${config.id}-atlas-v1.json`),
  };
}

const trackedOutputs = CONFIGS.flatMap((config) => {
  const paths = candidatePaths(config);
  return [paths.sheetManifest, paths.atlas, paths.atlasManifest];
});

function runBuilder() {
  const result = spawnSync(process.execPath, [BUILDER], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Layered-depth character builder failed.\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  if (!result.stdout.includes('MAPSOO_LAYERED_DEPTH_CHARACTER_ATLASES_OK')) {
    throw new Error('Layered-depth character builder success sentinel is missing.');
  }
}

async function snapshot() {
  return Promise.all(trackedOutputs.map(async (path) => ({
    path,
    bytes: await readFile(path),
  })));
}

runBuilder();
const first = await snapshot();
runBuilder();
const second = await snapshot();
for (let index = 0; index < first.length; index += 1) {
  if (first[index].path !== second[index].path || !first[index].bytes.equals(second[index].bytes)) {
    throw new Error(`Repeated build changed ${first[index].path}.`);
  }
}

const summary = [];
for (const config of CONFIGS) {
  const paths = candidatePaths(config);
  const [sourceBytes, rgbaBytes, sheetBytes, atlasBytes, manifestBytes] = await Promise.all([
    readFile(paths.source),
    readFile(paths.rgba),
    readFile(paths.sheetManifest),
    readFile(paths.atlas),
    readFile(paths.atlasManifest),
  ]);
  const sheet = JSON.parse(sheetBytes);
  const manifest = JSON.parse(manifestBytes);
  const atlas = decodeRgbaPng(atlasBytes, `${config.id} layered-depth atlas`);
  const expectedSourcePoses = config.actions.length * DIRECTIONS.length;
  const expectedFrames = expectedSourcePoses * 2;
  const expectedUnmapped = TARGET.columns * TARGET.rows - expectedFrames;

  if (sha256(sourceBytes) !== config.sourceSha256 || sha256(rgbaBytes) !== config.rgbaSha256) {
    throw new Error(`${config.id} immutable source input changed.`);
  }
  if (
    sheet.schema_version !== 'mapsoo-production-art-source/1.0'
    || sheet.profile !== 'layered-depth-2d'
    || sheet.role !== config.role
    || sheet.status !== 'source-candidate'
    || sheet.distribution !== 'internal-review'
    || sheet.output_license !== 'UNRELEASED'
    || sheet.grid.columns !== 4
    || sheet.grid.rows !== config.actions.length
    || sheet.grid.partition_policy !== 'equal-columns-transparent-gap-row-midpoints'
    || sheet.grid.y_subject_bands.length !== config.actions.length
    || JSON.stringify(sheet.grid.column_directions) !== JSON.stringify(DIRECTIONS)
    || JSON.stringify(sheet.grid.row_actions) !== JSON.stringify(config.actions)
    || sheet.source_poses.length !== expectedSourcePoses
    || sheet.provenance_claim.native_source_poses !== true
    || sheet.provenance_claim.native_source_pose_count !== expectedSourcePoses
    || sheet.provenance_claim.native_animation_sequence !== false
    || sheet.generation_context.mode !== 'built-in-image-generation'
    || sheet.generation_context.generation_receipt !== 'not-persisted'
  ) {
    throw new Error(`${config.id} source-sheet contract is invalid.`);
  }
  const sourceKeys = new Set();
  const sourceDigests = new Set();
  for (const pose of sheet.source_poses) {
    const key = `${pose.source_cell.column},${pose.source_cell.row}`;
    if (
      pose.clip_id !== `${pose.action}.${pose.direction}`
      || config.actions[pose.source_cell.row] !== pose.action
      || DIRECTIONS[pose.source_cell.column] !== pose.direction
      || pose.detection.component_count < 1
      || pose.detection.visible_pixels < 1
      || pose.detection.transparent_padding !== true
      || !/^[a-f0-9]{64}$/.test(pose.source_subject_rgba_sha256)
      || sourceKeys.has(key)
      || sourceDigests.has(pose.source_subject_rgba_sha256)
    ) {
      throw new Error(`${config.id} source pose ${key} is invalid or duplicated.`);
    }
    sourceKeys.add(key);
    sourceDigests.add(pose.source_subject_rgba_sha256);
  }

  if (
    manifest.schema_version !== 'mapsoo-runtime-character-atlas/1.0'
    || manifest.id !== `layered-depth-2d-${config.id}-atlas-v1`
    || manifest.profile !== 'layered-depth-2d'
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
      !== JSON.stringify({ frame_width: 48, frame_height: 72, columns: 8, rows: 8 })
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
    throw new Error(`${config.id} provenance or mapping count is overstated.`);
  }

  const mappedCells = new Set();
  const runtimeDigests = new Set();
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = 0;
  let maximumFootError = 0;
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
      || mappedCells.has(key)
      || runtimeDigests.has(metrics.digest)
    ) {
      throw new Error(`${config.id} runtime frame ${key} fails exact validation.`);
    }
    if (frame.frame_index === 0) {
      if (
        frame.source_pose.native_source_pose !== true
        || frame.derivation.kind !== 'one-to-one-nearest-neighbor-fit'
        || frame.derivation.synthetic_pose_variant !== false
      ) {
        throw new Error(`${config.id} native frame ${key} is mislabeled.`);
      }
    } else if (
      frame.source_pose.native_source_pose !== false
      || frame.derivation.kind !== 'deterministic-postprocess-variant'
      || frame.derivation.synthetic_pose_variant !== true
    ) {
      throw new Error(`${config.id} synthetic frame ${key} is mislabeled.`);
    }
    mappedCells.add(key);
    runtimeDigests.add(metrics.digest);
    minimumHeight = Math.min(minimumHeight, metrics.bounds.height);
    maximumHeight = Math.max(maximumHeight, metrics.bounds.height);
    maximumFootError = Math.max(maximumFootError, metrics.footAnchorError);
  }

  const clipIds = new Set();
  for (const clip of manifest.clips) {
    const records = manifest.frames
      .filter((frame) => frame.clip_id === clip.clip_id)
      .sort((a, b) => a.frame_index - b.frame_index);
    if (
      !config.actions.includes(clip.action)
      || !DIRECTIONS.includes(clip.direction)
      || clip.clip_id !== `${clip.action}.${clip.direction}`
      || clip.native_source_pose_count !== 1
      || clip.native_model_animation_frame_count !== 0
      || clip.synthetic_variant_count !== 1
      || clip.temporal_animation_continuity !== 'manual-review'
      || clip.frames.length !== 2
      || records.length !== 2
      || records[0].source_pose.source_subject_rgba_sha256
        !== records[1].source_pose.source_subject_rgba_sha256
      || JSON.stringify(clip.frames) !== JSON.stringify(records.map((frame) => ({
        atlas_cell: frame.atlas_cell,
        pixel_origin: frame.pixel_origin,
      })))
      || clipIds.has(clip.clip_id)
    ) {
      throw new Error(`${config.id} clip ${clip.clip_id} is incomplete or overstated.`);
    }
    clipIds.add(clip.clip_id);
  }
  const expectedClipIds = config.actions.flatMap((action) => (
    DIRECTIONS.map((direction) => `${action}.${direction}`)
  ));
  if (JSON.stringify([...clipIds]) !== JSON.stringify(expectedClipIds)) {
    throw new Error(`${config.id} canonical clip order is invalid.`);
  }

  let unmapped = 0;
  for (let row = 0; row < TARGET.rows; row += 1) {
    for (let column = 0; column < TARGET.columns; column += 1) {
      const key = `${column},${row}`;
      const metrics = frameMetrics(atlas, column, row, manifest.identity.cues);
      if (mappedCells.has(key)) {
        if (metrics.empty) throw new Error(`${config.id} mapped cell ${key} is empty.`);
      } else {
        if (!metrics.empty) throw new Error(`${config.id} unmapped cell ${key} is not transparent.`);
        unmapped += 1;
      }
    }
  }
  if (
    unmapped !== expectedUnmapped
    || manifest.automated_checks.mapped_cell_count !== expectedFrames
    || manifest.automated_checks.unmapped_transparent_cell_count !== expectedUnmapped
    || manifest.automated_checks.maximum_foot_anchor_error_px !== maximumFootError
    || JSON.stringify(manifest.automated_checks.visible_height_range)
      !== JSON.stringify([minimumHeight, maximumHeight])
  ) {
    throw new Error(`${config.id} aggregate transparency, height or pivot evidence is stale.`);
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
    || manifest.automated_checks.Godot_runtime !== 'pending'
    || manifest.automated_checks.Raspberry_Pi_runtime !== 'pending'
    || manifest.automated_checks.human_review !== 'pending'
    || !manifest.not_accepted_for.includes('Godot runtime validation')
    || !manifest.not_accepted_for.includes('Raspberry Pi validation')
    || !manifest.not_accepted_for.includes('human-approved animation')
    || !manifest.not_accepted_for.includes('public asset-pack release')
  ) {
    throw new Error(`${config.id} pending review boundary is invalid.`);
  }
  summary.push(`${config.id}:${manifest.sha256}:frames=${expectedFrames}:unmapped=${expectedUnmapped}`);
}

console.log(
  `MAPSOO_LAYERED_DEPTH_CHARACTER_VERIFY_OK ${summary.join(' ')}:`
  + 'determinism=two-build-byte-equal:Godot=pending:Pi=pending:human=pending',
);
