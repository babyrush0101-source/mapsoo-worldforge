import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pako from 'pako';

const sourceManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-character-sheet-v1.json',
);
const outputPngPath = resolve(
  'docs/visual-qa/production-art/side-platformer-character-atlas-v2.png',
);
const outputManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-character-atlas-v2.json',
);
const outputProfileRevisionPath = resolve(
  'docs/visual-qa/production-art/side-platformer-character-profile-revision-v2.json',
);
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ACTIONS = Object.freeze(['idle', 'run', 'jump', 'fall', 'land', 'hurt']);
const DIRECTIONS = Object.freeze(['right', 'left']);
const PROFILE_DIRECTIONS = Object.freeze(['left', 'right']);
const VARIANTS = Object.freeze({
  idle: Object.freeze([
    Object.freeze({ id: 'source-pose', scaleX: 1, scaleY: 1, shiftX: 0, shiftY: 0 }),
    Object.freeze({ id: 'breath-compress', scaleX: 1.01, scaleY: 0.98, shiftX: 0, shiftY: 0 }),
  ]),
  run: Object.freeze([
    Object.freeze({ id: 'stride-a', scaleX: 1, scaleY: 1, shiftX: 0, shiftY: 0 }),
    Object.freeze({ id: 'stride-bob-a', scaleX: 0.98, scaleY: 0.96, shiftX: 1, shiftY: -2 }),
    Object.freeze({ id: 'stride-c', scaleX: 1.02, scaleY: 1, shiftX: 0, shiftY: -1 }),
    Object.freeze({ id: 'stride-bob-b', scaleX: 0.98, scaleY: 0.97, shiftX: -1, shiftY: -2 }),
  ]),
  jump: Object.freeze([
    Object.freeze({ id: 'takeoff-a', scaleX: 1, scaleY: 1, shiftX: 0, shiftY: 0 }),
    Object.freeze({ id: 'takeoff-b', scaleX: 0.98, scaleY: 1, shiftX: 1, shiftY: -2 }),
  ]),
  fall: Object.freeze([
    Object.freeze({ id: 'descent-a', scaleX: 1, scaleY: 1, shiftX: 0, shiftY: 0 }),
    Object.freeze({ id: 'descent-b', scaleX: 1.02, scaleY: 0.98, shiftX: -1, shiftY: -1 }),
  ]),
  land: Object.freeze([
    Object.freeze({ id: 'impact-a', scaleX: 1, scaleY: 1, shiftX: 0, shiftY: 0 }),
    Object.freeze({ id: 'impact-compress', scaleX: 1.04, scaleY: 0.94, shiftX: 0, shiftY: 0 }),
  ]),
  hurt: Object.freeze([
    Object.freeze({ id: 'recoil-a', scaleX: 1, scaleY: 1, shiftX: 0, shiftY: 0 }),
    Object.freeze({ id: 'recoil-b', scaleX: 1, scaleY: 0.98, shiftX: 2, shiftY: -1 }),
  ]),
});
const TARGET = Object.freeze({
  width: 1024,
  height: 768,
  cellWidth: 128,
  cellHeight: 128,
  pivotX: 64,
  pivotY: 120,
  visibleWidth: 96,
  visibleHeight: 88,
  minimumVisibleHeight: 72,
  maximumVisibleHeight: 96,
  maximumFootAnchorError: 2,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readUint32(bytes, offset) {
  return bytes.readUInt32BE(offset);
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
  const distanceA = Math.abs(estimate - a);
  const distanceB = Math.abs(estimate - b);
  const distanceC = Math.abs(estimate - c);
  return distanceA <= distanceB && distanceA <= distanceC ? a : distanceB <= distanceC ? b : c;
}

function decodeRgbaPng(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from(PNG_SIGNATURE))) {
    throw new Error('Character source is not a PNG.');
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error('Character source must be a non-interlaced 8-bit RGBA PNG.');
  }
  const idat = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (offset + 12 + length > bytes.length) throw new Error('Character PNG chunk is truncated.');
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (idat.length === 0) throw new Error('Character PNG has no image data.');
  const channels = 4;
  const stride = width * channels;
  const filtered = pako.inflate(concatenate(idat));
  if (filtered.length !== (stride + 1) * height) {
    throw new Error('Character PNG scanline length is invalid.');
  }
  const rgba = new Uint8Array(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x];
      const outputOffset = y * stride + x;
      const left = x >= channels ? rgba[outputOffset - channels] : 0;
      const up = y > 0 ? rgba[outputOffset - stride] : 0;
      const upperLeft = y > 0 && x >= channels ? rgba[outputOffset - stride - channels] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upperLeft);
      else throw new Error(`Unsupported PNG scanline filter: ${filter}.`);
      rgba[outputOffset] = value & 0xff;
    }
    sourceOffset += stride;
  }
  return { width, height, rgba };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function encodeRgbaPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('RGBA output length is invalid.');
  const rowBytes = width * 4;
  const filtered = new Uint8Array((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (rowBytes + 1);
    filtered[offset] = 0;
    filtered.set(rgba.subarray(row * rowBytes, (row + 1) * rowBytes), offset + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concatenate([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', pako.deflate(filtered, { level: 9 })),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

function alphaBounds(image, cellX, cellY, cellWidth, cellHeight) {
  let minX = cellWidth;
  let minY = cellHeight;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let greenSpillPixels = 0;
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const index = ((cellY + y) * image.width + cellX + x) * 4;
      const red = image.rgba[index];
      const green = image.rgba[index + 1];
      const blue = image.rgba[index + 2];
      const alpha = image.rgba[index + 3];
      if (alpha < 16) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (green > 96 && green > red * 1.35 && green > blue * 1.35) greenSpillPixels += 1;
    }
  }
  if (visiblePixels === 0) throw new Error(`Source cell ${cellX},${cellY} is empty.`);
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    visiblePixels,
    greenSpillPixels,
    transparentPadding:
      minX > 0 && minY > 0 && maxX < cellWidth - 1 && maxY < cellHeight - 1,
  };
}

function placeNearest(source, sourceCell, bounds, destination, targetColumn, targetRow, variant, direction) {
  const sourceScale = Math.min(
    TARGET.visibleWidth / bounds.width,
    TARGET.visibleHeight / bounds.height,
    1,
  );
  const width = Math.max(1, Math.round(bounds.width * sourceScale * variant.scaleX));
  const height = Math.max(1, Math.round(bounds.height * sourceScale * variant.scaleY));
  const directionSign = direction === 'right' ? 1 : -1;
  const relativeLeft = Math.round((TARGET.cellWidth - width) / 2) + variant.shiftX * directionSign;
  const relativeTop = TARGET.pivotY - height + variant.shiftY;
  const left = targetColumn * TARGET.cellWidth + relativeLeft;
  const top = targetRow * TARGET.cellHeight + relativeTop;
  if (
    relativeLeft < 0
    || relativeTop < 0
    || relativeLeft + width > TARGET.cellWidth
    || relativeTop + height > TARGET.cellHeight
  ) {
    throw new Error(`Character variant ${variant.id} exceeds its target frame.`);
  }
  for (let y = 0; y < height; y += 1) {
    const sourceY = sourceCell.y + bounds.y + Math.min(
      bounds.height - 1,
      Math.floor((y * bounds.height) / height),
    );
    for (let x = 0; x < width; x += 1) {
      const sourceX = sourceCell.x + bounds.x + Math.min(
        bounds.width - 1,
        Math.floor((x * bounds.width) / width),
      );
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const destinationOffset = ((top + y) * TARGET.width + left + x) * 4;
      destination.set(source.rgba.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }
  return {
    x: relativeLeft,
    y: relativeTop,
    width,
    height,
    source_scale: sourceScale,
  };
}

function frameSha256(rgba, column, row) {
  const bytes = Buffer.alloc(TARGET.cellWidth * TARGET.cellHeight * 4);
  let writeOffset = 0;
  for (let y = 0; y < TARGET.cellHeight; y += 1) {
    const sourceOffset = (
      ((row * TARGET.cellHeight + y) * TARGET.width + column * TARGET.cellWidth) * 4
    );
    Buffer.from(rgba.subarray(
      sourceOffset,
      sourceOffset + TARGET.cellWidth * 4,
    )).copy(bytes, writeOffset);
    writeOffset += TARGET.cellWidth * 4;
  }
  return sha256(bytes);
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
if (
  sourceManifest.schema_version !== 'mapsoo-production-art-source/1.0'
  || sourceManifest.status !== 'source-candidate'
  || sourceManifest.distribution !== 'internal-review'
  || sourceManifest.output_license !== 'UNRELEASED'
) {
  throw new Error('Character source manifest is not an internal-review source candidate.');
}
if (
  sourceManifest.grid.columns !== ACTIONS.length
  || sourceManifest.grid.rows !== DIRECTIONS.length
  || JSON.stringify(sourceManifest.grid.column_actions) !== JSON.stringify(ACTIONS)
) {
  throw new Error('Character source grid/action order is not canonical.');
}
const sourceRecord = sourceManifest.rasters.find((raster) => raster.stage === 'rgba-candidate');
if (!sourceRecord) throw new Error('Character source has no RGBA candidate.');
const sourceBytes = await readFile(resolve(sourceRecord.path));
if (sourceBytes.length !== sourceRecord.bytes || sha256(sourceBytes) !== sourceRecord.sha256) {
  throw new Error('Character source bytes do not match the review record.');
}
const source = decodeRgbaPng(sourceBytes);
if (
  source.width !== sourceRecord.width
  || source.height !== sourceRecord.height
  || source.width !== sourceManifest.grid.columns * sourceManifest.grid.cell_width
  || source.height !== sourceManifest.grid.rows * sourceManifest.grid.cell_height
) {
  throw new Error('Character source dimensions do not match its exact grid.');
}

const outputRgba = new Uint8Array(TARGET.width * TARGET.height * 4);
const frames = [];
const clips = [];
let totalGreenSpillPixels = 0;
let minimumVisibleHeight = Number.POSITIVE_INFINITY;
let maximumVisibleHeight = 0;
let maximumFootAnchorError = 0;
let frameIndex = 0;
for (let row = 0; row < DIRECTIONS.length; row += 1) {
  for (let column = 0; column < ACTIONS.length; column += 1) {
    const action = ACTIONS[column];
    const direction = DIRECTIONS[row];
    const sourceCell = {
      x: column * sourceManifest.grid.cell_width,
      y: row * sourceManifest.grid.cell_height,
    };
    const bounds = alphaBounds(
      source,
      sourceCell.x,
      sourceCell.y,
      sourceManifest.grid.cell_width,
      sourceManifest.grid.cell_height,
    );
    if (!bounds.transparentPadding) throw new Error(`Character cell ${column},${row} touches its boundary.`);
    totalGreenSpillPixels += bounds.greenSpillPixels;
    const clipFrames = [];
    for (const [variantIndex, variant] of VARIANTS[action].entries()) {
      const targetColumn = frameIndex % (TARGET.width / TARGET.cellWidth);
      const targetRow = Math.floor(frameIndex / (TARGET.width / TARGET.cellWidth));
      const placed = placeNearest(
        source,
        sourceCell,
        bounds,
        outputRgba,
        targetColumn,
        targetRow,
        variant,
        direction,
      );
      const outputBounds = alphaBounds(
        { width: TARGET.width, height: TARGET.height, rgba: outputRgba },
        targetColumn * TARGET.cellWidth,
        targetRow * TARGET.cellHeight,
        TARGET.cellWidth,
        TARGET.cellHeight,
      );
      const footAnchorError = TARGET.pivotY - (outputBounds.y + outputBounds.height);
      if (
        outputBounds.height < TARGET.minimumVisibleHeight
        || outputBounds.height > TARGET.maximumVisibleHeight
      ) {
        throw new Error(
          `Character ${action}.${direction} frame ${variantIndex} visible height `
          + `${outputBounds.height} is outside ${TARGET.minimumVisibleHeight}-${TARGET.maximumVisibleHeight}px.`,
        );
      }
      if (footAnchorError < 0 || footAnchorError > TARGET.maximumFootAnchorError) {
        throw new Error(
          `Character ${action}.${direction} frame ${variantIndex} foot anchor error `
          + `${footAnchorError}px exceeds ${TARGET.maximumFootAnchorError}px.`,
        );
      }
      totalGreenSpillPixels += outputBounds.greenSpillPixels;
      minimumVisibleHeight = Math.min(minimumVisibleHeight, outputBounds.height);
      maximumVisibleHeight = Math.max(maximumVisibleHeight, outputBounds.height);
      maximumFootAnchorError = Math.max(maximumFootAnchorError, footAnchorError);
      const atlasCell = { column: targetColumn, row: targetRow };
      clipFrames.push(atlasCell);
      frames.push({
        clip_id: `${action}.${direction}`,
        action,
        direction,
        frame_index: variantIndex,
        source_pose: {
          source_cell: { column, row },
          native_model_frame_count: 1,
        },
        derivation: {
          kind: 'deterministic-postprocess-variant',
          native_model_frame: false,
          variant_id: variant.id,
          transform: {
            scale_x: variant.scaleX,
            scale_y: variant.scaleY,
            shift_x: variant.shiftX * (direction === 'right' ? 1 : -1),
            shift_y: variant.shiftY,
          },
        },
        atlas_cell: atlasCell,
        visible_bounds: placed,
        visible_height: outputBounds.height,
        foot_anchor_error_px: footAnchorError,
        pivot: [TARGET.pivotX, TARGET.pivotY],
        source_visible_pixels: bounds.visiblePixels,
        source_green_spill_pixels: bounds.greenSpillPixels,
        frame_rgba_sha256: frameSha256(outputRgba, targetColumn, targetRow),
      });
      frameIndex += 1;
    }
    const uniqueDigests = new Set(
      frames
        .filter((frame) => frame.clip_id === `${action}.${direction}`)
        .map((frame) => frame.frame_rgba_sha256),
    );
    if (uniqueDigests.size !== clipFrames.length) {
      throw new Error(`Character clip ${action}.${direction} contains duplicate deterministic variants.`);
    }
    clips.push({
      clip_id: `${action}.${direction}`,
      action,
      direction,
      fps: action === 'run' ? 10 : 6,
      loop: ['idle', 'run', 'fall'].includes(action),
      frame_origin: 'deterministic-postprocess-variant',
      native_model_frame_count: 1,
      runtime_frame_count: clipFrames.length,
      frames: clipFrames,
    });
  }
}
if (totalGreenSpillPixels > 0) {
  throw new Error(`Character source retains ${totalGreenSpillPixels} green-spill pixels.`);
}
if (frameIndex !== 28) {
  throw new Error(`Character runtime atlas must contain exactly 28 derived frames; got ${frameIndex}.`);
}

const outputBytes = encodeRgbaPng(TARGET.width, TARGET.height, outputRgba);
const outputHash = sha256(outputBytes);
const outputManifest = {
  schema_version: 'mapsoo-runtime-character-atlas/1.0',
  id: 'side-platformer-character-atlas-v2',
  profile: 'side-platformer',
  role: 'character.player.atlas',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: 'docs/visual-qa/production-art/side-platformer-character-atlas-v2.png',
  media_type: 'image/png',
  width: TARGET.width,
  height: TARGET.height,
  bytes: outputBytes.length,
  sha256: outputHash,
  frame_width: TARGET.cellWidth,
  frame_height: TARGET.cellHeight,
  pivot: [TARGET.pivotX, TARGET.pivotY],
  source_manifest: 'docs/visual-qa/production-art/side-platformer-character-sheet-v1.json',
  source_sha256: sourceRecord.sha256,
  processing: {
    resampler: 'nearest-neighbor',
    visible_box: [TARGET.visibleWidth, TARGET.visibleHeight],
    placement: 'horizontal-center-and-foot-pivot',
    output_grid: { columns: 8, rows: 6 },
    variant_policy: {
      id: 'deterministic-pose-variants-v1',
      description:
        'Each runtime frame is a declared deterministic nearest-neighbor scale/shift variant '
        + 'of one recorded source pose. These are not model-native animation frames.',
      native_model_animation_frames: false,
      source_pose_count: 12,
      runtime_frame_count: frameIndex,
    },
  },
  clips,
  frames,
  automated_checks: {
    exact_source_grid: 'pass',
    source_cell_padding: 'pass',
    green_spill_pixels: 0,
    frame_bounds: 'pass',
    deterministic_png: 'pass',
    multi_frame_clips: 'pass',
    runtime_frame_count: frameIndex,
    visible_height_range: [minimumVisibleHeight, maximumVisibleHeight],
    maximum_foot_anchor_error_px: maximumFootAnchorError,
    native_model_animation_frames: false,
    action_semantics: 'manual-review',
    identity_consistency: 'manual-review',
    godot_runtime: 'separate-bound-evidence',
  },
  godot_evidence: 'docs/visual-qa/production-art/side-platformer-character-godot-v2.json',
  not_accepted_for: [
    'complete world asset pack',
    'public asset-pack release',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');
const clipById = new Map(clips.map((clip) => [clip.clip_id, clip]));
const profileRevision = {
  schema_version: '1.0.0',
  document_type: 'character-profile-revision',
  profile_revision_id: 'courier-side-platformer-v2',
  character_id: 'courier',
  profile: 'side-platformer',
  atlas: {
    path: 'characters/courier/side-platformer-v2.png',
    media_type: 'image/png',
    bytes: outputBytes.length,
    sha256: outputHash,
    width: TARGET.width,
    height: TARGET.height,
  },
  frame_geometry: {
    frame_width: TARGET.cellWidth,
    frame_height: TARGET.cellHeight,
    columns: TARGET.width / TARGET.cellWidth,
    rows: TARGET.height / TARGET.cellHeight,
  },
  pivot: {
    x: TARGET.pivotX,
    y: TARGET.pivotY,
    unit: 'pixels',
  },
  clips: ACTIONS.flatMap((action) => PROFILE_DIRECTIONS.map((direction) => {
    const clip = clipById.get(`${action}.${direction}`);
    if (!clip) throw new Error(`Character profile clip ${action}.${direction} is missing.`);
    return {
      clip_id: clip.clip_id,
      action,
      direction,
      fps: clip.fps,
      loop: clip.loop,
      frames: clip.frames,
    };
  })),
  source_identity: {
    identity_digest_sha256: '6646e1647391605e1960ef1f4ecb5b34f9f6e0842cee6cab78c6be0280516b70',
    source_reference_ids: [
      'courier-source-v1',
      'riverside-style-v1',
    ],
  },
  rights: {
    distribution: 'private',
    license: 'LicenseRef-Proprietary',
  },
};
const profileRevisionBytes = Buffer.from(`${JSON.stringify(profileRevision, null, 2)}\n`, 'utf8');

for (const [path, bytes] of [
  [outputPngPath, outputBytes],
  [outputManifestPath, manifestBytes],
  [outputProfileRevisionPath, profileRevisionBytes],
]) {
  try {
    const existing = await readFile(path);
    if (existing.equals(Buffer.from(bytes))) continue;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(path, bytes);
}

console.log(
  `MAPSOO_CHARACTER_ATLAS_OK side-platformer:v2:${TARGET.width}x${TARGET.height}:`
  + `frames=${frames.length}:visible_height=${minimumVisibleHeight}-${maximumVisibleHeight}:`
  + `foot_error=${maximumFootAnchorError}:sha256=${outputHash}`,
);
