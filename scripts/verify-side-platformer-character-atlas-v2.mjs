import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { decodeRgbaPng } from './lib/rgba-png.mjs';

const manifestPath = 'docs/visual-qa/production-art/side-platformer-character-atlas-v2.json';
const revisionPath = 'docs/visual-qa/production-art/side-platformer-character-profile-revision-v2.json';
const godotQaPath = 'docs/visual-qa/production-art/side-platformer-character-godot-v2.json';
const ACTIONS = Object.freeze(['idle', 'run', 'jump', 'fall', 'land', 'hurt']);
const DIRECTIONS = Object.freeze(['right', 'left']);
const PROFILE_DIRECTIONS = Object.freeze(['left', 'right']);
const REQUIRED_COUNTS = Object.freeze({
  idle: 2,
  run: 4,
  jump: 2,
  fall: 2,
  land: 2,
  hurt: 2,
});
const COLUMNS = 8;
const ROWS = 6;
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 128;
const PIVOT_Y = 120;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function frameBytes(image, column, row) {
  const bytes = Buffer.alloc(FRAME_WIDTH * FRAME_HEIGHT * 4);
  let writeOffset = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const sourceOffset = (
      ((row * FRAME_HEIGHT + y) * image.width + column * FRAME_WIDTH) * 4
    );
    Buffer.from(image.rgba.subarray(
      sourceOffset,
      sourceOffset + FRAME_WIDTH * 4,
    )).copy(bytes, writeOffset);
    writeOffset += FRAME_WIDTH * 4;
  }
  return bytes;
}

function frameMetrics(image, column, row) {
  let visiblePixels = 0;
  let minimumY = FRAME_HEIGHT;
  let maximumY = -1;
  let greenSpillPixels = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const offset = (
        ((row * FRAME_HEIGHT + y) * image.width + column * FRAME_WIDTH + x) * 4
      );
      const red = image.rgba[offset];
      const green = image.rgba[offset + 1];
      const blue = image.rgba[offset + 2];
      const alpha = image.rgba[offset + 3];
      if (alpha < 16) continue;
      visiblePixels += 1;
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
      if (green > 96 && green > red * 1.35 && green > blue * 1.35) {
        greenSpillPixels += 1;
      }
    }
  }
  return {
    visiblePixels,
    visibleHeight: maximumY < minimumY ? 0 : maximumY - minimumY + 1,
    footAnchorError: maximumY < 0 ? Number.POSITIVE_INFINITY : PIVOT_Y - (maximumY + 1),
    greenSpillPixels,
  };
}

const manifestBytes = await readFile(resolve(manifestPath));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const atlasBytes = await readFile(resolve(manifest.path));
if (
  manifest.schema_version !== 'mapsoo-runtime-character-atlas/1.0'
  || manifest.id !== 'side-platformer-character-atlas-v2'
  || manifest.profile !== 'side-platformer'
  || manifest.status !== 'runtime-candidate'
  || manifest.distribution !== 'internal-review'
  || manifest.output_license !== 'UNRELEASED'
  || manifest.width !== COLUMNS * FRAME_WIDTH
  || manifest.height !== ROWS * FRAME_HEIGHT
  || manifest.frame_width !== FRAME_WIDTH
  || manifest.frame_height !== FRAME_HEIGHT
  || JSON.stringify(manifest.pivot) !== '[64,120]'
  || atlasBytes.length !== manifest.bytes
  || sha256(atlasBytes) !== manifest.sha256
  || manifest.processing.variant_policy.id !== 'deterministic-pose-variants-v1'
  || manifest.processing.variant_policy.native_model_animation_frames !== false
  || manifest.processing.variant_policy.source_pose_count !== 12
  || manifest.processing.variant_policy.runtime_frame_count !== 28
  || manifest.automated_checks.multi_frame_clips !== 'pass'
  || manifest.automated_checks.native_model_animation_frames !== false
  || manifest.automated_checks.maximum_foot_anchor_error_px > 2
) {
  throw new Error('Character atlas v2 manifest identity, geometry, provenance or digest is invalid.');
}

const image = decodeRgbaPng(atlasBytes);
if (image.width !== manifest.width || image.height !== manifest.height) {
  throw new Error('Character atlas v2 PNG dimensions do not match its manifest.');
}

const expectedClipIds = DIRECTIONS.flatMap((direction) => (
  ACTIONS.map((action) => `${action}.${direction}`)
));
if (
  manifest.clips.length !== expectedClipIds.length
  || manifest.clips.some((clip, index) => clip.clip_id !== expectedClipIds[index])
) {
  throw new Error('Character atlas v2 clips are not in canonical source-pose order.');
}

const occupiedCells = new Set();
const frameRecordByCell = new Map();
for (const frame of manifest.frames) {
  const key = `${frame.atlas_cell.column},${frame.atlas_cell.row}`;
  if (
    occupiedCells.has(key)
    || frame.derivation.kind !== 'deterministic-postprocess-variant'
    || frame.derivation.native_model_frame !== false
    || frame.source_pose.native_model_frame_count !== 1
  ) {
    throw new Error(`Character atlas v2 frame provenance or cell is invalid: ${key}.`);
  }
  occupiedCells.add(key);
  frameRecordByCell.set(key, frame);
}
if (manifest.frames.length !== 28 || occupiedCells.size !== 28) {
  throw new Error('Character atlas v2 must contain exactly 28 uniquely addressed runtime frames.');
}

for (const clip of manifest.clips) {
  if (
    clip.runtime_frame_count !== REQUIRED_COUNTS[clip.action]
    || clip.frames.length !== REQUIRED_COUNTS[clip.action]
    || clip.frame_origin !== 'deterministic-postprocess-variant'
    || clip.native_model_frame_count !== 1
  ) {
    throw new Error(`Character clip ${clip.clip_id} does not meet its strict frame count.`);
  }
  const digests = new Set();
  for (const cell of clip.frames) {
    const key = `${cell.column},${cell.row}`;
    const record = frameRecordByCell.get(key);
    if (!record || record.clip_id !== clip.clip_id) {
      throw new Error(`Character clip ${clip.clip_id} references an invalid atlas frame.`);
    }
    const metrics = frameMetrics(image, cell.column, cell.row);
    const digest = sha256(frameBytes(image, cell.column, cell.row));
    if (
      metrics.visibleHeight < 72
      || metrics.visibleHeight > 96
      || metrics.footAnchorError < 0
      || metrics.footAnchorError > 2
      || metrics.greenSpillPixels !== 0
      || record.visible_height !== metrics.visibleHeight
      || record.foot_anchor_error_px !== metrics.footAnchorError
      || record.frame_rgba_sha256 !== digest
    ) {
      throw new Error(`Character frame ${key} fails strict height, pivot, spill or digest validation.`);
    }
    digests.add(digest);
  }
  if (digests.size !== clip.frames.length) {
    throw new Error(`Character clip ${clip.clip_id} contains duplicate derived frames.`);
  }
}

for (let index = 0; index < COLUMNS * ROWS; index += 1) {
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const key = `${column},${row}`;
  const metrics = frameMetrics(image, column, row);
  if (!occupiedCells.has(key) && metrics.visiblePixels !== 0) {
    throw new Error(`Unmapped character atlas cell ${key} must be transparent.`);
  }
}

const revision = JSON.parse(await readFile(resolve(revisionPath), 'utf8'));
const expectedProfileClipIds = ACTIONS.flatMap((action) => (
  PROFILE_DIRECTIONS.map((direction) => `${action}.${direction}`)
));
if (
  revision.schema_version !== '1.0.0'
  || revision.document_type !== 'character-profile-revision'
  || revision.profile_revision_id !== 'courier-side-platformer-v2'
  || revision.profile !== 'side-platformer'
  || revision.atlas.bytes !== atlasBytes.length
  || revision.atlas.sha256 !== manifest.sha256
  || revision.atlas.width !== manifest.width
  || revision.atlas.height !== manifest.height
  || JSON.stringify(revision.pivot) !== '{"x":64,"y":120,"unit":"pixels"}'
  || revision.clips.length !== expectedProfileClipIds.length
  || revision.clips.some((clip, index) => (
    clip.clip_id !== expectedProfileClipIds[index]
    || clip.frames.length !== REQUIRED_COUNTS[clip.action]
  ))
  || revision.rights.distribution !== 'private'
  || revision.rights.license !== 'LicenseRef-Proprietary'
) {
  throw new Error('CharacterProfileRevision v2 does not bind the strict runtime atlas exactly.');
}
for (const profileClip of revision.clips) {
  const atlasClip = manifest.clips.find(({ clip_id: clipId }) => clipId === profileClip.clip_id);
  if (!atlasClip || JSON.stringify(profileClip.frames) !== JSON.stringify(atlasClip.frames)) {
    throw new Error(`CharacterProfileRevision clip ${profileClip.clip_id} does not bind exact atlas cells.`);
  }
}

const godotQa = JSON.parse(await readFile(resolve(godotQaPath), 'utf8'));
if (
  godotQa.schema_version !== 'mapsoo-production-art-godot-qa/1.1'
  || godotQa.status !== 'technical-runtime-pass'
  || godotQa.atlas_sha256 !== manifest.sha256
  || godotQa.frames !== 28
  || godotQa.visible_height_range[0] < 72
  || godotQa.visible_height_range[1] > 96
  || godotQa.maximum_foot_anchor_error_px > 2
  || godotQa.frame_origin !== 'deterministic-postprocess-variant'
  || godotQa.native_model_animation_frames !== false
  || JSON.stringify(godotQa.runs.map((run) => run.godot)) !== '["4.3","4.7"]'
  || !godotQa.not_proven.includes('model-native limb animation')
  || !godotQa.not_proven.includes('human or user art approval')
) {
  throw new Error('Character atlas v2 Godot QA evidence is incomplete or mismatched.');
}
const previewHashes = new Set();
for (const run of godotQa.runs) {
  const preview = await readFile(resolve(run.preview_path));
  if (preview.length !== run.preview_bytes || sha256(preview) !== run.preview_sha256) {
    throw new Error(`${run.preview_path} does not match its character v2 Godot QA record.`);
  }
  previewHashes.add(run.preview_sha256);
}
if (previewHashes.size !== 1) {
  throw new Error('Godot 4.3 and 4.7 did not produce identical character v2 previews.');
}

console.log(
  `MAPSOO_CHARACTER_ATLAS_V2_STRICT_OK frames=28 clips=12 height=`
  + `${manifest.automated_checks.visible_height_range.join('-')} foot_error=`
  + `${manifest.automated_checks.maximum_foot_anchor_error_px} native_model_animation=false `
  + `sha256=${manifest.sha256}`,
);
