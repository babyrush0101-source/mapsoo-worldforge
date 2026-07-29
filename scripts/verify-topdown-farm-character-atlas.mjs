import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pako from 'pako';

const ART_ROOT = 'docs/visual-qa/production-art';
const BUILDER_PATH = resolve('scripts/build-topdown-farm-character-atlas.mjs');
const SOURCE_PATH = resolve(`${ART_ROOT}/topdown-farm-character-sheet-rgba-v1.png`);
const SOURCE_MANIFEST_PATH = resolve(`${ART_ROOT}/topdown-farm-character-sheet-v1.json`);
const ATLAS_PATH = resolve(`${ART_ROOT}/topdown-farm-character-atlas-v1.png`);
const MANIFEST_PATH = resolve(`${ART_ROOT}/topdown-farm-character-atlas-v1.json`);
const REVISION_PATH = resolve(`${ART_ROOT}/topdown-farm-character-profile-revision-v1.json`);
const TRACKED_OUTPUTS = [SOURCE_MANIFEST_PATH, ATLAS_PATH, MANIFEST_PATH, REVISION_PATH];
const EXPECTED_SOURCE_SHA256 = '3800372bbd1759dd1e6779f348e4f95c8c1147c04fb640d7c4a535b367ef8cb0';
const DIRECTIONS = ['north', 'east', 'south', 'west'];
const ACTION_COUNTS = Object.freeze({ idle: 2, walk: 4, interact: 2 });
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const TARGET = Object.freeze({
  width: 1024,
  height: 768,
  frameWidth: 128,
  frameHeight: 128,
  columns: 8,
  rows: 6,
  pivot: [64, 120],
});

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
    if (offset + 12 + length > bytes.length) throw new Error(`${label} has a truncated chunk.`);
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

function frameMetrics(image, column, row) {
  const bytes = frameBytes(image, column, row);
  let minX = TARGET.frameWidth;
  let minY = TARGET.frameHeight;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < TARGET.frameHeight; y += 1) {
    for (let x = 0; x < TARGET.frameWidth; x += 1) {
      const alpha = bytes[(y * TARGET.frameWidth + x) * 4 + 3];
      if (alpha < 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
    }
  }
  if (visiblePixels === 0) {
    return { empty: true, digest: sha256(bytes), visiblePixels: 0 };
  }
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return {
    empty: false,
    digest: sha256(bytes),
    visiblePixels,
    bounds,
    footAnchorError: TARGET.pivot[1] - (maxY + 1),
  };
}

function runBuilder() {
  const result = spawnSync(process.execPath, [BUILDER_PATH], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `Top-down character builder failed.\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  if (!result.stdout.includes('MAPSOO_TOPDOWN_CHARACTER_ATLAS_OK')) {
    throw new Error('Top-down character builder did not emit its success sentinel.');
  }
}

async function snapshot() {
  return Promise.all(TRACKED_OUTPUTS.map(async (path) => ({
    path,
    bytes: await readFile(path),
  })));
}

function assertSame(first, second, label) {
  for (let index = 0; index < first.length; index += 1) {
    if (first[index].path !== second[index].path || !first[index].bytes.equals(second[index].bytes)) {
      throw new Error(`${label} changed ${first[index].path}; generation is not deterministic.`);
    }
  }
}

runBuilder();
const first = await snapshot();
runBuilder();
const second = await snapshot();
assertSame(first, second, 'Second deterministic build');

const [sourceBytes, sourceManifestBytes, atlasBytes, manifestBytes, revisionBytes] = await Promise.all([
  readFile(SOURCE_PATH),
  readFile(SOURCE_MANIFEST_PATH),
  readFile(ATLAS_PATH),
  readFile(MANIFEST_PATH),
  readFile(REVISION_PATH),
]);
const sourceManifest = JSON.parse(sourceManifestBytes);
const manifest = JSON.parse(manifestBytes);
const revision = JSON.parse(revisionBytes);
const sourceImage = decodeRgbaPng(sourceBytes, 'Top-down RGBA source');
const atlasImage = decodeRgbaPng(atlasBytes, 'Top-down runtime atlas');

if (
  sha256(sourceBytes) !== EXPECTED_SOURCE_SHA256
  || sourceImage.width !== 1774
  || sourceImage.height !== 887
) {
  throw new Error('Top-down RGBA source digest or dimensions changed.');
}
if (
  sourceManifest.schema_version !== 'mapsoo-production-art-source/1.0'
  || sourceManifest.profile !== 'topdown-farm'
  || sourceManifest.status !== 'source-candidate'
  || sourceManifest.distribution !== 'internal-review'
  || sourceManifest.output_license !== 'UNRELEASED'
  || sourceManifest.extraction.native_source_pose_count !== 32
  || sourceManifest.extraction.distinct_source_cells !== 32
  || sourceManifest.extraction.generation_receipt !== 'not-available'
  || sourceManifest.automated_checks.native_source_poses !== true
  || sourceManifest.automated_checks.temporal_animation_continuity !== 'manual-review'
  || sourceManifest.grid.partition_policy !== 'transparent-gap-midpoint-edges'
  || sourceManifest.grid.x_subject_bands.length !== 8
  || sourceManifest.grid.y_subject_bands.length !== 4
  || sourceManifest.source_cells.length !== 32
) {
  throw new Error('Top-down source manifest does not retain the strict native-pose review boundary.');
}
const sourceCellKeys = new Set(
  sourceManifest.source_cells.map(({ source_cell: cell }) => `${cell.column},${cell.row}`),
);
if (sourceCellKeys.size !== 32) throw new Error('Source pose cells are not one-to-one.');
for (const cell of sourceManifest.source_cells) {
  if (
    cell.detection.transparent_padding !== true
    || cell.detection.selected_pixels <= 0
    || cell.detection.discarded_pixels < 0
    || cell.detection.dominant_component_ratio < 0.75
    || cell.detection.component_count < 1
    || cell.detection.selected_component_count !== 1
  ) {
    throw new Error(`Source pose ${cell.source_cell.column},${cell.source_cell.row} failed component QA.`);
  }
}

if (
  manifest.schema_version !== 'mapsoo-runtime-character-atlas/1.0'
  || manifest.profile !== 'topdown-farm'
  || manifest.status !== 'runtime-candidate'
  || manifest.distribution !== 'internal-review'
  || manifest.output_license !== 'UNRELEASED'
  || manifest.width !== TARGET.width
  || manifest.height !== TARGET.height
  || manifest.frame_width !== TARGET.frameWidth
  || manifest.frame_height !== TARGET.frameHeight
  || JSON.stringify(manifest.pivot) !== JSON.stringify(TARGET.pivot)
  || manifest.bytes !== atlasBytes.length
  || manifest.sha256 !== sha256(atlasBytes)
  || manifest.source_sha256 !== EXPECTED_SOURCE_SHA256
  || atlasImage.width !== TARGET.width
  || atlasImage.height !== TARGET.height
) {
  throw new Error('Top-down runtime atlas identity, geometry or digest is invalid.');
}
if (
  manifest.processing.pose_policy.native_source_poses !== true
  || manifest.processing.pose_policy.synthetic_pose_variants !== false
  || manifest.processing.pose_policy.native_source_pose_count !== 32
  || manifest.processing.pose_policy.runtime_frame_count !== 32
  || manifest.processing.pose_policy.temporal_animation_continuity !== 'manual-review'
  || manifest.processing.pose_policy.generation_receipt !== 'not-available'
  || manifest.automated_checks.native_source_poses !== true
  || manifest.automated_checks.synthetic_pose_variants !== false
  || manifest.automated_checks.temporal_animation_continuity !== 'manual-review'
  || manifest.automated_checks.transparent_gap_source_grid !== 'pass'
) {
  throw new Error('Native-source-pose provenance is overstated or incomplete.');
}
if (
  manifest.frames.length !== 32
  || manifest.clips.length !== 12
  || manifest.automated_checks.runtime_frame_count !== 32
  || manifest.automated_checks.runtime_clip_count !== 12
  || manifest.automated_checks.transparent_reserved_cells !== 16
) {
  throw new Error('Top-down frame, clip or reserved-cell count is invalid.');
}

const frameCellKeys = new Set();
const frameDigests = new Set();
const sourceMappings = new Set();
let observedMinimumHeight = Number.POSITIVE_INFINITY;
let observedMaximumHeight = 0;
let observedMaximumFootError = 0;
for (const frame of manifest.frames) {
  const cellKey = `${frame.atlas_cell.column},${frame.atlas_cell.row}`;
  const sourceKey = `${frame.source_pose.source_cell.column},${frame.source_pose.source_cell.row}`;
  const metrics = frameMetrics(atlasImage, frame.atlas_cell.column, frame.atlas_cell.row);
  if (
    metrics.empty
    || frame.source_pose.native_source_pose !== true
    || frame.source_pose.generation_receipt !== 'not-available'
    || frame.derivation.kind !== 'one-to-one-nearest-neighbor-fit'
    || frame.derivation.synthetic_pose_variant !== false
    || frame.derivation.mirrored !== false
    || frame.frame_rgba_sha256 !== metrics.digest
    || frame.visible_pixels !== metrics.visiblePixels
    || frame.visible_height !== metrics.bounds.height
    || JSON.stringify(frame.visible_bounds) !== JSON.stringify(metrics.bounds)
    || frame.foot_anchor_error_px !== metrics.footAnchorError
    || JSON.stringify(frame.pivot) !== JSON.stringify(TARGET.pivot)
    || metrics.bounds.height < 64
    || metrics.bounds.height > 96
    || metrics.footAnchorError < 0
    || metrics.footAnchorError > 2
  ) {
    throw new Error(`Runtime frame ${cellKey} fails exact pixel, source or pivot validation.`);
  }
  if (frameCellKeys.has(cellKey) || sourceMappings.has(sourceKey) || frameDigests.has(metrics.digest)) {
    throw new Error(`Runtime frame ${cellKey} is not a unique one-to-one source mapping.`);
  }
  frameCellKeys.add(cellKey);
  sourceMappings.add(sourceKey);
  frameDigests.add(metrics.digest);
  observedMinimumHeight = Math.min(observedMinimumHeight, metrics.bounds.height);
  observedMaximumHeight = Math.max(observedMaximumHeight, metrics.bounds.height);
  observedMaximumFootError = Math.max(observedMaximumFootError, metrics.footAnchorError);
}
if (
  JSON.stringify(manifest.automated_checks.visible_height_range)
    !== JSON.stringify([observedMinimumHeight, observedMaximumHeight])
  || manifest.automated_checks.maximum_foot_anchor_error_px !== observedMaximumFootError
) {
  throw new Error('Recorded visible-height or foot-anchor aggregate is stale.');
}
for (let row = 4; row < TARGET.rows; row += 1) {
  for (let column = 0; column < TARGET.columns; column += 1) {
    if (!frameMetrics(atlasImage, column, row).empty) {
      throw new Error(`Reserved atlas cell ${column},${row} is not transparent.`);
    }
  }
}

const clipIds = new Set();
for (const clip of manifest.clips) {
  const expectedCount = ACTION_COUNTS[clip.action];
  if (
    !expectedCount
    || !DIRECTIONS.includes(clip.direction)
    || clip.clip_id !== `${clip.action}.${clip.direction}`
    || clip.frame_origin !== 'independent-native-source-pose'
    || clip.native_source_pose_count !== expectedCount
    || clip.runtime_frame_count !== expectedCount
    || clip.frames.length !== expectedCount
    || clip.temporal_animation_continuity !== 'manual-review'
    || clipIds.has(clip.clip_id)
  ) {
    throw new Error(`Runtime clip ${clip.clip_id} is incomplete or overclaims review.`);
  }
  clipIds.add(clip.clip_id);
  const records = manifest.frames
    .filter((frame) => frame.clip_id === clip.clip_id)
    .sort((a, b) => a.frame_index - b.frame_index);
  if (
    records.length !== expectedCount
    || JSON.stringify(clip.frames) !== JSON.stringify(records.map(({ atlas_cell: cell }) => cell))
  ) {
    throw new Error(`Runtime clip ${clip.clip_id} does not bind its exact native source frames.`);
  }
}
for (const action of Object.keys(ACTION_COUNTS)) {
  for (const direction of DIRECTIONS) {
    if (!clipIds.has(`${action}.${direction}`)) throw new Error(`Missing runtime clip ${action}.${direction}.`);
  }
}

if (
  revision.schema_version !== '1.0.0'
  || revision.document_type !== 'character-profile-revision'
  || revision.profile_revision_id !== 'courier-topdown-farm-v1'
  || revision.character_id !== 'courier'
  || revision.profile !== 'topdown-farm'
  || revision.atlas.bytes !== atlasBytes.length
  || revision.atlas.sha256 !== sha256(atlasBytes)
  || revision.atlas.width !== TARGET.width
  || revision.atlas.height !== TARGET.height
  || JSON.stringify(revision.frame_geometry)
    !== JSON.stringify({ frame_width: 128, frame_height: 128, columns: 8, rows: 6 })
  || JSON.stringify(revision.pivot) !== JSON.stringify({ x: 64, y: 120, unit: 'pixels' })
  || revision.clips.length !== 8
  || revision.rights.distribution !== 'private'
  || revision.rights.license !== 'LicenseRef-Proprietary'
) {
  throw new Error('CharacterProfileRevision does not exactly bind the private top-down runtime atlas.');
}
const expectedProfileIds = ['idle', 'walk'].flatMap((action) => (
  DIRECTIONS.map((direction) => `${action}.${direction}`)
));
if (JSON.stringify(revision.clips.map(({ clip_id: id }) => id)) !== JSON.stringify(expectedProfileIds)) {
  throw new Error('CharacterProfileRevision canonical clip order is invalid.');
}
for (const revisionClip of revision.clips) {
  const runtimeClip = manifest.clips.find(({ clip_id: id }) => id === revisionClip.clip_id);
  if (
    !runtimeClip
    || JSON.stringify(revisionClip.frames) !== JSON.stringify(runtimeClip.frames)
    || revisionClip.action !== runtimeClip.action
    || revisionClip.direction !== runtimeClip.direction
    || revisionClip.fps !== runtimeClip.fps
    || revisionClip.loop !== runtimeClip.loop
  ) {
    throw new Error(`CharacterProfileRevision clip ${revisionClip.clip_id} is not exact.`);
  }
}
if (
  manifest.not_accepted_for.includes('public asset-pack release') !== true
  || sourceManifest.not_accepted_for.includes('human-approved animation') !== true
) {
  throw new Error('Review-boundary exclusions are missing.');
}

console.log(
  `MAPSOO_TOPDOWN_CHARACTER_VERIFY_OK frames=32:clips=12:profile_clips=8:`
  + `reserved=16:visible_height=${observedMinimumHeight}-${observedMaximumHeight}:`
  + `foot_error=${observedMaximumFootError}:sha256=${sha256(atlasBytes)}:determinism=two-build-byte-equal`,
);
