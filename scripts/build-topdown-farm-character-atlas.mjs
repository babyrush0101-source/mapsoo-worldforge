import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pako from 'pako';

const ART_ROOT = 'docs/visual-qa/production-art';
const SOURCE_PATH = `${ART_ROOT}/topdown-farm-character-sheet-source-v1.png`;
const RGBA_PATH = `${ART_ROOT}/topdown-farm-character-sheet-rgba-v1.png`;
const SOURCE_MANIFEST_PATH = `${ART_ROOT}/topdown-farm-character-sheet-v1.json`;
const ATLAS_PATH = `${ART_ROOT}/topdown-farm-character-atlas-v1.png`;
const ATLAS_MANIFEST_PATH = `${ART_ROOT}/topdown-farm-character-atlas-v1.json`;
const PROFILE_REVISION_PATH = `${ART_ROOT}/topdown-farm-character-profile-revision-v1.json`;

const EXPECTED_SOURCE = Object.freeze({
  width: 1774,
  height: 887,
  bytes: 1_492_744,
  sha256: 'f0f6f8c15b6728b2207ef97bc298530c4c3e4fdc4e8bea48407b143a7713eee0',
});
const EXPECTED_RGBA = Object.freeze({
  width: 1774,
  height: 887,
  bytes: 782_002,
  sha256: '3800372bbd1759dd1e6779f348e4f95c8c1147c04fb640d7c4a535b367ef8cb0',
});
const SOURCE_ROWS = Object.freeze(['south', 'west', 'east', 'north']);
const SOURCE_COLUMNS = Object.freeze([
  Object.freeze({ action: 'idle', frame: 0 }),
  Object.freeze({ action: 'idle', frame: 1 }),
  Object.freeze({ action: 'walk', frame: 0 }),
  Object.freeze({ action: 'walk', frame: 1 }),
  Object.freeze({ action: 'walk', frame: 2 }),
  Object.freeze({ action: 'walk', frame: 3 }),
  Object.freeze({ action: 'interact', frame: 0 }),
  Object.freeze({ action: 'interact', frame: 1 }),
]);
const PROFILE_ACTIONS = Object.freeze(['idle', 'walk']);
const PROFILE_DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);
const ALL_ACTIONS = Object.freeze(['idle', 'walk', 'interact']);
const TARGET = Object.freeze({
  width: 1024,
  height: 768,
  columns: 8,
  rows: 6,
  frameWidth: 128,
  frameHeight: 128,
  pivotX: 64,
  pivotY: 120,
  visibleWidth: 112,
  visibleHeight: 96,
  minimumVisibleHeight: 64,
  maximumVisibleHeight: 96,
  maximumFootAnchorError: 2,
});
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ALPHA_THRESHOLD = 16;

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
  const da = Math.abs(estimate - a);
  const db = Math.abs(estimate - b);
  const dc = Math.abs(estimate - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

function decodeRgbaPng(bytes, label) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from(PNG_SIGNATURE))) {
    throw new Error(`${label} is not a PNG.`);
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`${label} must be a non-interlaced 8-bit RGBA PNG.`);
  }
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (offset + 12 + length > bytes.length) throw new Error(`${label} has a truncated PNG chunk.`);
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (chunks.length === 0) throw new Error(`${label} has no IDAT data.`);
  const stride = width * 4;
  const filtered = pako.inflate(concatenate(chunks));
  if (filtered.length !== (stride + 1) * height) {
    throw new Error(`${label} has an invalid scanline length.`);
  }
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

function readPngDimensions(bytes, label) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from(PNG_SIGNATURE))) {
    throw new Error(`${label} is not a PNG.`);
  }
  return {
    width: readUint32(bytes, 16),
    height: readUint32(bytes, 20),
  };
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
  if (rgba.length !== width * height * 4) throw new Error('Atlas RGBA length is invalid.');
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

function alphaAt(image, x, y) {
  return image.rgba[(y * image.width + x) * 4 + 3];
}

function detectAxisBands(image, axis, expectedCount) {
  const length = axis === 'x' ? image.width : image.height;
  const crossLength = axis === 'x' ? image.height : image.width;
  const occupied = new Uint32Array(length);
  for (let position = 0; position < length; position += 1) {
    let count = 0;
    for (let cross = 0; cross < crossLength; cross += 1) {
      const x = axis === 'x' ? position : cross;
      const y = axis === 'x' ? cross : position;
      if (alphaAt(image, x, y) >= ALPHA_THRESHOLD) count += 1;
    }
    occupied[position] = count;
  }
  const rawBands = [];
  let start = -1;
  for (let position = 0; position <= length; position += 1) {
    const active = position < length && occupied[position] >= 8;
    if (active && start < 0) start = position;
    if (!active && start >= 0) {
      rawBands.push({ start, end: position - 1 });
      start = -1;
    }
  }
  const merged = [];
  for (const band of rawBands) {
    const previous = merged.at(-1);
    if (previous && band.start - previous.end <= 4) previous.end = band.end;
    else merged.push({ ...band });
  }
  if (merged.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} transparent-gap-separated ${axis}-axis bands; got `
      + `${merged.length}: ${JSON.stringify(merged)}.`,
    );
  }
  const edges = [0];
  for (let index = 0; index < merged.length - 1; index += 1) {
    edges.push(Math.floor((merged[index].end + merged[index + 1].start) / 2));
  }
  edges.push(length);
  return { bands: merged, edges };
}

function detectComponents(image, cell) {
  const width = cell.x1 - cell.x0;
  const height = cell.y1 - cell.y0;
  const visited = new Uint8Array(width * height);
  const components = [];
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);
  const neighbours = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const localIndex = localY * width + localX;
      if (visited[localIndex] || alphaAt(image, cell.x0 + localX, cell.y0 + localY) < ALPHA_THRESHOLD) {
        continue;
      }
      let head = 0;
      let tail = 1;
      queueX[0] = localX;
      queueY[0] = localY;
      visited[localIndex] = 1;
      let minX = localX;
      let minY = localY;
      let maxX = localX;
      let maxY = localY;
      let pixels = 0;
      while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head += 1;
        pixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        for (const [dx, dy] of neighbours) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const index = ny * width + nx;
          if (
            visited[index]
            || alphaAt(image, cell.x0 + nx, cell.y0 + ny) < ALPHA_THRESHOLD
          ) continue;
          visited[index] = 1;
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail += 1;
        }
      }
      components.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        pixels,
      });
    }
  }
  components.sort((a, b) => b.pixels - a.pixels || a.y - b.y || a.x - b.x);
  if (components.length === 0) throw new Error(`Source cell ${cell.column},${cell.row} is empty.`);
  const largest = components[0].pixels;
  const selected = [components[0]];
  const selectedPixels = selected.reduce((sum, component) => sum + component.pixels, 0);
  const allPixels = components.reduce((sum, component) => sum + component.pixels, 0);
  const bounds = {
    x: Math.min(...selected.map((component) => component.x)),
    y: Math.min(...selected.map((component) => component.y)),
    width: 0,
    height: 0,
  };
  const maxX = Math.max(...selected.map((component) => component.x + component.width - 1));
  const maxY = Math.max(...selected.map((component) => component.y + component.height - 1));
  bounds.width = maxX - bounds.x + 1;
  bounds.height = maxY - bounds.y + 1;
  const transparentPadding = (
    bounds.x > 0
    && bounds.y > 0
    && bounds.x + bounds.width < width
    && bounds.y + bounds.height < height
  );
  if (!transparentPadding) {
    throw new Error(
      `Source cell ${cell.column},${cell.row} subject touches its partition boundary: `
      + `${JSON.stringify({ bounds, components: components.slice(0, 8) })}`,
    );
  }
  if (selectedPixels / allPixels < 0.75) {
    throw new Error(
      `Source cell ${cell.column},${cell.row} has no unambiguous dominant pose component `
      + `(dominant ratio ${selectedPixels / allPixels}).`,
    );
  }
  return {
    bounds,
    component_count: components.length,
    selected_component_count: selected.length,
    selected_pixels: selectedPixels,
    discarded_pixels: allPixels - selectedPixels,
    dominant_component_ratio: Number((largest / allPixels).toFixed(6)),
    transparent_padding: true,
  };
}

function copyNearest(source, sourceCell, detection, destination, targetColumn, targetRow) {
  const { bounds } = detection;
  const scale = Math.min(
    TARGET.visibleWidth / bounds.width,
    TARGET.visibleHeight / bounds.height,
    1,
  );
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const relativeLeft = Math.round((TARGET.frameWidth - width) / 2);
  const relativeTop = TARGET.pivotY - height;
  if (
    relativeLeft < 0
    || relativeTop < 0
    || relativeLeft + width > TARGET.frameWidth
    || relativeTop + height > TARGET.frameHeight
  ) {
    throw new Error(`Frame ${targetColumn},${targetRow} does not fit its runtime cell.`);
  }
  const sourceX0 = sourceCell.x0 + bounds.x;
  const sourceY0 = sourceCell.y0 + bounds.y;
  const destinationX0 = targetColumn * TARGET.frameWidth + relativeLeft;
  const destinationY0 = targetRow * TARGET.frameHeight + relativeTop;
  for (let y = 0; y < height; y += 1) {
    const sourceY = sourceY0 + Math.min(bounds.height - 1, Math.floor((y * bounds.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = sourceX0 + Math.min(bounds.width - 1, Math.floor((x * bounds.width) / width));
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const destinationOffset = ((destinationY0 + y) * TARGET.width + destinationX0 + x) * 4;
      destination.set(source.rgba.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }
  return {
    x: relativeLeft,
    y: relativeTop,
    width,
    height,
    scale: Number(scale.toFixed(8)),
  };
}

function frameMetrics(rgba, column, row) {
  let minX = TARGET.frameWidth;
  let minY = TARGET.frameHeight;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let greenSpillPixels = 0;
  const bytes = Buffer.alloc(TARGET.frameWidth * TARGET.frameHeight * 4);
  let writeOffset = 0;
  for (let y = 0; y < TARGET.frameHeight; y += 1) {
    const rowOffset = (
      ((row * TARGET.frameHeight + y) * TARGET.width + column * TARGET.frameWidth) * 4
    );
    Buffer.from(rgba.subarray(rowOffset, rowOffset + TARGET.frameWidth * 4))
      .copy(bytes, writeOffset);
    writeOffset += TARGET.frameWidth * 4;
    for (let x = 0; x < TARGET.frameWidth; x += 1) {
      const offset = rowOffset + x * 4;
      const red = rgba[offset];
      const green = rgba[offset + 1];
      const blue = rgba[offset + 2];
      const alpha = rgba[offset + 3];
      if (alpha < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
      if (green > 96 && green > red * 1.35 && green > blue * 1.35) greenSpillPixels += 1;
    }
  }
  if (visiblePixels === 0) {
    return {
      empty: true,
      visiblePixels: 0,
      rgbaSha256: sha256(bytes),
    };
  }
  const height = maxY - minY + 1;
  return {
    empty: false,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height },
    visiblePixels,
    greenSpillPixels,
    footAnchorError: TARGET.pivotY - (maxY + 1),
    rgbaSha256: sha256(bytes),
  };
}

async function writeIfChanged(path, bytes) {
  try {
    const current = await readFile(resolve(path));
    if (current.equals(Buffer.from(bytes))) return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(resolve(path), bytes);
}

function rasterRecord(stage, path, bytes, image, expected) {
  if (
    bytes.length !== expected.bytes
    || sha256(bytes) !== expected.sha256
    || image.width !== expected.width
    || image.height !== expected.height
  ) {
    throw new Error(`${stage} raster does not match the recorded immutable input.`);
  }
  return {
    stage,
    path,
    media_type: 'image/png',
    width: image.width,
    height: image.height,
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

const sourceBytes = await readFile(resolve(SOURCE_PATH));
const rgbaBytes = await readFile(resolve(RGBA_PATH));
const sourceImage = readPngDimensions(sourceBytes, 'Top-down source sheet');
const rgbaImage = decodeRgbaPng(rgbaBytes, 'Top-down RGBA sheet');
const sourceRecord = rasterRecord('source-render', SOURCE_PATH, sourceBytes, sourceImage, EXPECTED_SOURCE);
const rgbaRecord = rasterRecord('rgba-candidate', RGBA_PATH, rgbaBytes, rgbaImage, EXPECTED_RGBA);
const xSegmentation = detectAxisBands(rgbaImage, 'x', 8);
const ySegmentation = detectAxisBands(rgbaImage, 'y', 4);
const xEdges = xSegmentation.edges;
const yEdges = ySegmentation.edges;

const sourceCells = [];
for (let row = 0; row < SOURCE_ROWS.length; row += 1) {
  for (let column = 0; column < SOURCE_COLUMNS.length; column += 1) {
    const sourceColumn = SOURCE_COLUMNS[column];
    const cell = {
      column,
      row,
      x0: xEdges[column],
      x1: xEdges[column + 1],
      y0: yEdges[row],
      y1: yEdges[row + 1],
    };
    const detection = detectComponents(rgbaImage, cell);
    sourceCells.push({
      action: sourceColumn.action,
      direction: SOURCE_ROWS[row],
      frame_index: sourceColumn.frame,
      source_cell: { column, row },
      partition: {
        x: cell.x0,
        y: cell.y0,
        width: cell.x1 - cell.x0,
        height: cell.y1 - cell.y0,
      },
      detection,
    });
  }
}
if (sourceCells.length !== 32) throw new Error('Top-down source sheet must contain exactly 32 poses.');

const sourceCellKeys = new Set(sourceCells.map(({ source_cell: cell }) => `${cell.column},${cell.row}`));
if (sourceCellKeys.size !== 32) throw new Error('Every native source pose must occupy a distinct grid cell.');
const sourceManifest = {
  schema_version: 'mapsoo-production-art-source/1.0',
  id: 'topdown-farm-character-sheet-v1',
  profile: 'topdown-farm',
  role: 'character.player.atlas',
  status: 'source-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  grid: {
    columns: 8,
    rows: 4,
    partition_policy: 'transparent-gap-midpoint-edges',
    x_edges: xEdges,
    y_edges: yEdges,
    x_subject_bands: xSegmentation.bands,
    y_subject_bands: ySegmentation.bands,
    row_directions: SOURCE_ROWS,
    column_frames: SOURCE_COLUMNS,
  },
  rasters: [sourceRecord, rgbaRecord],
  extraction: {
    alpha_threshold: ALPHA_THRESHOLD,
    connectivity: 8,
    component_selection:
      'select the largest 8-connected alpha component in each transparent-gap-derived cell; require at least 75% '
      + 'dominance so neighbouring-row fragments cannot become part of the pose crop',
    native_source_pose_count: 32,
    distinct_source_cells: 32,
    generation_receipt: 'not-available',
    native_source_pose_claim:
      'Each pose is an independently present RGBA source cell. This proves distinct source poses, '
      + 'but does not prove temporal animation continuity.',
  },
  source_cells: sourceCells,
  identity_cues: [
    'messy dark hair',
    'mustard-yellow scarf',
    'plum-purple coat',
    'brown shoulder satchel',
  ],
  automated_checks: {
    immutable_input_hashes: 'pass',
    transparent_gap_grid_partition: 'pass',
    source_cell_count: 32,
    distinct_source_cells: 32,
    transparent_cell_padding: 'pass',
    alpha_component_detection: 'pass',
    native_source_poses: true,
    temporal_animation_continuity: 'manual-review',
    action_semantics: 'manual-review',
    identity_consistency: 'manual-review',
  },
  not_accepted_for: [
    'human-approved animation',
    'complete world asset pack',
    'public asset-pack release',
  ],
};

const outputRgba = new Uint8Array(TARGET.width * TARGET.height * 4);
const frames = [];
let minimumVisibleHeight = Number.POSITIVE_INFINITY;
let maximumVisibleHeight = 0;
let maximumFootAnchorError = 0;
let greenSpillPixels = 0;
for (const sourceCell of sourceCells) {
  const frameNumber = sourceCell.source_cell.row * 8 + sourceCell.source_cell.column;
  const targetColumn = frameNumber % TARGET.columns;
  const targetRow = Math.floor(frameNumber / TARGET.columns);
  const placed = copyNearest(
    rgbaImage,
    {
      x0: sourceCell.partition.x,
      x1: sourceCell.partition.x + sourceCell.partition.width,
      y0: sourceCell.partition.y,
      y1: sourceCell.partition.y + sourceCell.partition.height,
    },
    sourceCell.detection,
    outputRgba,
    targetColumn,
    targetRow,
  );
  const metrics = frameMetrics(outputRgba, targetColumn, targetRow);
  if (metrics.empty) throw new Error(`Runtime frame ${targetColumn},${targetRow} is empty.`);
  if (
    metrics.bounds.height < TARGET.minimumVisibleHeight
    || metrics.bounds.height > TARGET.maximumVisibleHeight
  ) {
    throw new Error(
      `Runtime frame ${targetColumn},${targetRow} visible height ${metrics.bounds.height}px `
      + `is outside ${TARGET.minimumVisibleHeight}-${TARGET.maximumVisibleHeight}px.`,
    );
  }
  if (metrics.footAnchorError < 0 || metrics.footAnchorError > TARGET.maximumFootAnchorError) {
    throw new Error(
      `Runtime frame ${targetColumn},${targetRow} foot anchor error `
      + `${metrics.footAnchorError}px exceeds ${TARGET.maximumFootAnchorError}px.`,
    );
  }
  minimumVisibleHeight = Math.min(minimumVisibleHeight, metrics.bounds.height);
  maximumVisibleHeight = Math.max(maximumVisibleHeight, metrics.bounds.height);
  maximumFootAnchorError = Math.max(maximumFootAnchorError, metrics.footAnchorError);
  greenSpillPixels += metrics.greenSpillPixels;
  frames.push({
    clip_id: `${sourceCell.action}.${sourceCell.direction}`,
    action: sourceCell.action,
    direction: sourceCell.direction,
    frame_index: sourceCell.frame_index,
    source_pose: {
      source_cell: sourceCell.source_cell,
      source_rgba_sha256: EXPECTED_RGBA.sha256,
      native_source_pose: true,
      generation_receipt: 'not-available',
    },
    derivation: {
      kind: 'one-to-one-nearest-neighbor-fit',
      synthetic_pose_variant: false,
      mirrored: false,
      source_crop: sourceCell.detection.bounds,
      scale: placed.scale,
    },
    atlas_cell: { column: targetColumn, row: targetRow },
    visible_bounds: metrics.bounds,
    visible_height: metrics.bounds.height,
    foot_anchor_error_px: metrics.footAnchorError,
    pivot: [TARGET.pivotX, TARGET.pivotY],
    visible_pixels: metrics.visiblePixels,
    frame_rgba_sha256: metrics.rgbaSha256,
  });
}
if (greenSpillPixels !== 0) {
  throw new Error(`Top-down runtime atlas contains ${greenSpillPixels} green-spill pixels.`);
}
if (new Set(frames.map(({ frame_rgba_sha256: digest }) => digest)).size !== 32) {
  throw new Error('All 32 independently supplied runtime poses must have distinct RGBA digests.');
}
for (let row = 4; row < TARGET.rows; row += 1) {
  for (let column = 0; column < TARGET.columns; column += 1) {
    if (!frameMetrics(outputRgba, column, row).empty) {
      throw new Error(`Reserved atlas cell ${column},${row} must remain transparent.`);
    }
  }
}

const clips = ALL_ACTIONS.flatMap((action) => PROFILE_DIRECTIONS.map((direction) => {
  const clipFrames = frames
    .filter((frame) => frame.action === action && frame.direction === direction)
    .sort((a, b) => a.frame_index - b.frame_index);
  const expectedCount = action === 'walk' ? 4 : 2;
  if (clipFrames.length !== expectedCount) {
    throw new Error(`${action}.${direction} must have exactly ${expectedCount} native source poses.`);
  }
  return {
    clip_id: `${action}.${direction}`,
    action,
    direction,
    fps: action === 'walk' ? 8 : action === 'idle' ? 4 : 6,
    loop: action !== 'interact',
    frame_origin: 'independent-native-source-pose',
    native_source_pose_count: clipFrames.length,
    runtime_frame_count: clipFrames.length,
    temporal_animation_continuity: 'manual-review',
    frames: clipFrames.map(({ atlas_cell: cell }) => cell),
  };
}));

const atlasBytes = encodeRgbaPng(TARGET.width, TARGET.height, outputRgba);
const atlasHash = sha256(atlasBytes);
const atlasManifest = {
  schema_version: 'mapsoo-runtime-character-atlas/1.0',
  id: 'topdown-farm-character-atlas-v1',
  profile: 'topdown-farm',
  role: 'character.player.atlas',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: ATLAS_PATH,
  media_type: 'image/png',
  width: TARGET.width,
  height: TARGET.height,
  bytes: atlasBytes.length,
  sha256: atlasHash,
  frame_width: TARGET.frameWidth,
  frame_height: TARGET.frameHeight,
  pivot: [TARGET.pivotX, TARGET.pivotY],
  source_manifest: SOURCE_MANIFEST_PATH,
  source_sha256: EXPECTED_RGBA.sha256,
  processing: {
    resampler: 'nearest-neighbor',
    visible_box: [TARGET.visibleWidth, TARGET.visibleHeight],
    placement: 'horizontal-center-and-foot-pivot',
    output_grid: { columns: TARGET.columns, rows: TARGET.rows },
    populated_cells: 32,
    reserved_transparent_cells: 16,
    pose_policy: {
      id: 'one-to-one-native-source-poses-v1',
      description:
        'Each populated runtime cell comes from one unique recorded source cell using only '
        + 'nearest-neighbor crop/fit. No pose is mirrored or synthesized.',
      native_source_poses: true,
      native_source_pose_count: 32,
      runtime_frame_count: 32,
      synthetic_pose_variants: false,
      temporal_animation_continuity: 'manual-review',
      generation_receipt: 'not-available',
    },
  },
  clips,
  frames,
  automated_checks: {
    immutable_source_hash: 'pass',
    transparent_gap_source_grid: 'pass',
    alpha_component_detection: 'pass',
    source_cell_padding: 'pass',
    one_to_one_source_mapping: 'pass',
    unique_source_cells: 32,
    unique_frame_rgba_digests: 32,
    runtime_frame_count: 32,
    runtime_clip_count: 12,
    transparent_reserved_cells: 16,
    visible_height_range: [minimumVisibleHeight, maximumVisibleHeight],
    maximum_foot_anchor_error_px: maximumFootAnchorError,
    green_spill_pixels: greenSpillPixels,
    deterministic_png: 'pass',
    native_source_poses: true,
    synthetic_pose_variants: false,
    temporal_animation_continuity: 'manual-review',
    action_semantics: 'manual-review',
    identity_consistency: 'manual-review',
  },
  not_accepted_for: [
    'human-approved animation',
    'complete world asset pack',
    'public asset-pack release',
  ],
};

const clipById = new Map(clips.map((clip) => [clip.clip_id, clip]));
const profileRevision = {
  schema_version: '1.0.0',
  document_type: 'character-profile-revision',
  profile_revision_id: 'courier-topdown-farm-v1',
  character_id: 'courier',
  profile: 'topdown-farm',
  atlas: {
    path: 'characters/courier/topdown-farm-v1.png',
    media_type: 'image/png',
    bytes: atlasBytes.length,
    sha256: atlasHash,
    width: TARGET.width,
    height: TARGET.height,
  },
  frame_geometry: {
    frame_width: TARGET.frameWidth,
    frame_height: TARGET.frameHeight,
    columns: TARGET.columns,
    rows: TARGET.rows,
  },
  pivot: { x: TARGET.pivotX, y: TARGET.pivotY, unit: 'pixels' },
  clips: PROFILE_ACTIONS.flatMap((action) => PROFILE_DIRECTIONS.map((direction) => {
    const clip = clipById.get(`${action}.${direction}`);
    if (!clip) throw new Error(`Canonical profile clip ${action}.${direction} is missing.`);
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
      'orchard-river-homestead-style-v1',
    ],
  },
  rights: {
    distribution: 'private',
    license: 'LicenseRef-Proprietary',
  },
};

await writeIfChanged(
  SOURCE_MANIFEST_PATH,
  Buffer.from(`${JSON.stringify(sourceManifest, null, 2)}\n`, 'utf8'),
);
await writeIfChanged(ATLAS_PATH, atlasBytes);
await writeIfChanged(
  ATLAS_MANIFEST_PATH,
  Buffer.from(`${JSON.stringify(atlasManifest, null, 2)}\n`, 'utf8'),
);
await writeIfChanged(
  PROFILE_REVISION_PATH,
  Buffer.from(`${JSON.stringify(profileRevision, null, 2)}\n`, 'utf8'),
);

console.log(
  `MAPSOO_TOPDOWN_CHARACTER_ATLAS_OK topdown-farm:v1:${TARGET.width}x${TARGET.height}:`
  + `frames=32:clips=12:visible_height=${minimumVisibleHeight}-${maximumVisibleHeight}:`
  + `foot_error=${maximumFootAnchorError}:sha256=${atlasHash}`,
);
