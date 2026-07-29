import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pako from 'pako';

const ART_ROOT = 'docs/visual-qa/production-art';
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
  pivotX: 24,
  pivotY: 58,
  visibleWidth: 46,
  visibleHeight: 56,
  maximumFootAnchorError: 1,
});
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ALPHA_THRESHOLD = 16;

const CONFIGS = Object.freeze([
  Object.freeze({
    id: 'player',
    role: 'character.player.atlas',
    characterId: 'courier',
    actions: PLAYER_ACTIONS,
    sourcePath: `${ART_ROOT}/isometric-action-player-sheet-source-v1.png`,
    sourceBytes: 1_850_329,
    sourceSha256: '712d74e8c7538ef9c5993603ea7dc53f5ea97730be86e42ed1f9f92b23b3e9ba',
    rgbaPath: `${ART_ROOT}/isometric-action-player-sheet-rgba-v1.png`,
    rgbaBytes: 1_012_776,
    rgbaSha256: 'c0f8832103f7e8b8c6cf5488eed5dcee81473818c3a0a9b23e877d0692578ce5',
    sheetManifestPath: `${ART_ROOT}/isometric-action-player-sheet-v1.json`,
    atlasPath: `${ART_ROOT}/isometric-action-player-atlas-v1.png`,
    atlasManifestPath: `${ART_ROOT}/isometric-action-player-atlas-v1.json`,
    promptId: 'isometric-action-player-sheet-prompt-v1',
    identityDigest: '6646e1647391605e1960ef1f4ecb5b34f9f6e0842cee6cab78c6be0280516b70',
    identityCues: Object.freeze([
      Object.freeze({ id: 'dark-hair', minimumPixels: 5 }),
      Object.freeze({ id: 'mustard-scarf', minimumPixels: 2 }),
      Object.freeze({ id: 'plum-coat', minimumPixels: 5 }),
      Object.freeze({ id: 'brown-satchel', minimumPixels: 3 }),
    ]),
    prompt: `Use case: stylized-concept.
Asset type: internal-review source pose sheet for an original Godot 2D isometric-action player character.
Input images: Image 1 is the isometric world camera, pixel density, lighting, and palette reference only; Images 2 and 3 are the player identity references only.
Primary request: Create one clean pixel-art character pose sheet containing exactly 48 full-body independent source poses of the same original courier protagonist. Arrange an exact 8-column by 6-row matrix, evenly spaced and centered, with no overlap. Columns, left to right, are the eight isometric facing directions: north, north-east, east, south-east, south, south-west, west, north-west. Rows, top to bottom, are actions: idle, move, attack-primary, dash, hurt, defeat. Every cell must contain exactly one clearly distinguishable full-body pose appropriate to its row and facing direction. Preserve identity in every pose: short messy black hair, mustard-yellow scarf, plum-purple coat, dark trousers, brown boots, brown cross-body satchel. The protagonist uses a short bronze sword only for attack-primary; hands otherwise readable and uncluttered.
Style/medium: original high-readability pixel art, fixed 3/4 isometric game camera, compact proportions suitable for later downscaling into 48x64 runtime frames, crisp nearest-neighbour-like edges, coherent silhouette.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for removal.
Composition/framing: strict unlabelled sprite sheet, 8 columns by 6 rows, wide landscape, generous uniform padding around every pose, feet fully visible and aligned within each row.
Constraints: one character per cell; exactly 48 poses; consistent scale, costume, body proportions and lighting; no cell may touch another; no cast shadow, no contact shadow, no reflection; do not use #00ff00 anywhere in the subject.
Avoid: text, labels, numbers, grid lines, UI, logos, watermark, scenery, floor plane, gradients, background texture, blur, photorealism, 3D rendering, copied commercial characters.`,
  }),
  Object.freeze({
    id: 'enemy-melee',
    role: 'character.enemy-melee.atlas',
    characterId: 'emberglass-forge-guard',
    actions: ENEMY_ACTIONS,
    sourcePath: `${ART_ROOT}/isometric-action-enemy-melee-sheet-source-v1.png`,
    sourceBytes: 1_811_417,
    sourceSha256: '936d7dff9f1cf336fedae36e697498bafb5130b438218bcec6b8ec819d141fa6',
    rgbaPath: `${ART_ROOT}/isometric-action-enemy-melee-sheet-rgba-v1.png`,
    rgbaBytes: 906_415,
    rgbaSha256: 'dbd5e328a98e4658c03d7725736ac6e416d6b2831a9a727478be117e9d099966',
    sheetManifestPath: `${ART_ROOT}/isometric-action-enemy-melee-sheet-v1.json`,
    atlasPath: `${ART_ROOT}/isometric-action-enemy-melee-atlas-v1.png`,
    atlasManifestPath: `${ART_ROOT}/isometric-action-enemy-melee-atlas-v1.json`,
    promptId: 'isometric-action-enemy-melee-sheet-prompt-v1',
    identityDigest: '2f77a775238708170d9f0c777af7be3b4075ad1958a93eed2990b02c194660d0',
    identityCues: Object.freeze([
      Object.freeze({ id: 'charcoal-armor', minimumPixels: 10 }),
      Object.freeze({ id: 'copper-trim', minimumPixels: 3 }),
      Object.freeze({ id: 'violet-plume', minimumPixels: 2 }),
      Object.freeze({ id: 'amber-visor', minimumPixels: 1 }),
    ]),
    prompt: `Use case: stylized-concept.
Asset type: internal-review source pose sheet for an original Godot 2D isometric-action melee enemy.
Input images: Image 1 is the isometric world camera, furnace-ruin palette, and enemy mood reference only; Image 2 is the player sheet and is used only for sprite scale, pixel density, matrix spacing, and camera consistency. Do not copy the player identity or clothing.
Primary request: Create one clean pixel-art pose sheet containing exactly 40 full-body independent source poses of the same original Emberglass Forge Guard melee enemy. Arrange an exact 8-column by 5-row matrix with no overlap. Columns, left to right, are facing north, north-east, east, south-east, south, south-west, west, north-west. Rows, top to bottom, are actions idle, move, attack-primary, hurt, defeat. Every cell contains exactly one distinguishable full-body pose appropriate to its row and direction.
Subject: compact masked forge guard in charcoal plate and dark leather, oxidized-copper shoulder plates and belt, small violet hood or plume, glowing amber visor slit, carrying a short heavy bronze forge hammer. The silhouette and palette must remain consistent in all 40 cells and must be visually distinct from the courier protagonist.
Style/medium: original high-readability pixel art, fixed 3/4 isometric game camera, compact proportions for downscaling into 48x64 runtime frames, crisp nearest-neighbour-like edges.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for removal.
Composition/framing: strict unlabelled sprite sheet, 8 columns by 5 rows, wide landscape, generous uniform padding, feet fully visible and aligned within each row.
Constraints: one enemy per cell; exactly 40 poses; consistent scale, armor, body proportions and lighting; attack row clearly swings the hammer; defeat row clearly grounded; no overlaps; no cast or contact shadow; do not use #00ff00 in the subject.
Avoid: text, labels, numbers, grid lines, UI, logos, watermark, scenery, floor plane, gradients, background texture, blur, photorealism, 3D rendering, copied commercial enemies.`,
  }),
  Object.freeze({
    id: 'enemy-ranged',
    role: 'character.enemy-ranged.atlas',
    characterId: 'emberglass-channeler',
    actions: ENEMY_ACTIONS,
    sourcePath: `${ART_ROOT}/isometric-action-enemy-ranged-sheet-source-v1.png`,
    sourceBytes: 1_820_868,
    sourceSha256: 'b1c9cbd01742256e8e40ef53ee383d7c351631fbb237cb61b9c71b25aa291431',
    rgbaPath: `${ART_ROOT}/isometric-action-enemy-ranged-sheet-rgba-v1.png`,
    rgbaBytes: 963_500,
    rgbaSha256: '90c29d2e268d6a6b95faab0c121d508f0ef0560c71ff9d6c9ad4d6f47d2c5bc1',
    sheetManifestPath: `${ART_ROOT}/isometric-action-enemy-ranged-sheet-v1.json`,
    atlasPath: `${ART_ROOT}/isometric-action-enemy-ranged-atlas-v1.png`,
    atlasManifestPath: `${ART_ROOT}/isometric-action-enemy-ranged-atlas-v1.json`,
    promptId: 'isometric-action-enemy-ranged-sheet-prompt-v1',
    identityDigest: '5a3f1f37144e78a8cb6756256dafad4be8b1426a8e4b0d24944a4b53837247b5',
    identityCues: Object.freeze([
      Object.freeze({ id: 'charcoal-cloth', minimumPixels: 8 }),
      Object.freeze({ id: 'violet-hood', minimumPixels: 5 }),
      Object.freeze({ id: 'copper-bracers', minimumPixels: 2 }),
      Object.freeze({
        id: 'teal-lens',
        minimumPixels: 0,
        minimumFrameCoverage: 16,
        minimumTotalPixels: 20,
      }),
    ]),
    prompt: `Use case: stylized-concept.
Asset type: internal-review source pose sheet for an original Godot 2D isometric-action ranged enemy.
Input images: Image 1 is the isometric world camera and furnace-ruin palette reference only; Image 2 is used only for sprite scale, pixel density, matrix spacing, and camera consistency; Image 3 is the melee-enemy reference only so this ranged enemy remains equally polished but visually distinct.
Primary request: Create one clean pixel-art pose sheet containing exactly 40 full-body independent source poses of the same original Emberglass Channeler ranged enemy. Arrange an exact 8-column by 5-row matrix with no overlap. Columns, left to right, are facing north, north-east, east, south-east, south, south-west, west, north-west. Rows, top to bottom, are actions idle, move, attack-primary, hurt, defeat. Every cell contains exactly one distinguishable full-body pose appropriate to its row and direction.
Subject: lean hooded arc-channeler in dark charcoal cloth and leather, violet hood and sash, oxidized-copper bracers, small teal-glowing monocle or mask lens, carrying a compact bronze hand-crossbow with a tiny teal energy crystal. Keep the silhouette, equipment, and palette consistent in all 40 cells. It must be clearly distinct from both the courier protagonist and the heavy hammer guard.
Style/medium: original high-readability pixel art, fixed 3/4 isometric game camera, compact proportions for downscaling into 48x64 runtime frames, crisp nearest-neighbour-like edges.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for removal.
Composition/framing: strict unlabelled sprite sheet, 8 columns by 5 rows, wide landscape, generous uniform padding, feet fully visible and aligned within each row.
Constraints: one enemy per cell; exactly 40 poses; consistent scale, hood, crossbow, body proportions and lighting; attack row clearly aims or fires the hand-crossbow; defeat row clearly grounded; no overlaps; no cast or contact shadow; do not use #00ff00 in the subject.
Avoid: text, labels, numbers, grid lines, UI, logos, watermark, scenery, floor plane, gradients, background texture, blur, photorealism, 3D rendering, copied commercial enemies.`,
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

function pngDimensions(bytes, label) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from(PNG_SIGNATURE))) {
    throw new Error(`${label} is not a PNG.`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function decodeRgbaPng(bytes, label) {
  const { width, height } = pngDimensions(bytes, label);
  if (bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) {
    throw new Error(`${label} must be a non-interlaced 8-bit RGBA PNG.`);
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
  if (idat.length === 0) throw new Error(`${label} has no IDAT data.`);
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
  const rowBytes = width * 4;
  if (rgba.length !== rowBytes * height) throw new Error('Runtime atlas RGBA length is invalid.');
  const filtered = new Uint8Array((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (rowBytes + 1);
    filtered[target] = 0;
    filtered.set(rgba.subarray(row * rowBytes, (row + 1) * rowBytes), target + 1);
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

function proportionalEdges(length, divisions) {
  return Array.from({ length: divisions + 1 }, (_, index) => (
    Math.floor((index * length) / divisions)
  ));
}

function detectAxisBands(image, axis, expectedCount, crossRange) {
  const length = axis === 'x' ? image.width : image.height;
  const crossLength = axis === 'x' ? image.height : image.width;
  const crossStart = crossRange?.start ?? 0;
  const crossEnd = crossRange?.end ?? crossLength;
  if (crossStart < 0 || crossEnd > crossLength || crossStart >= crossEnd) {
    throw new Error(`Invalid ${axis}-axis segmentation cross range.`);
  }
  const occupied = new Uint32Array(length);
  for (let position = 0; position < length; position += 1) {
    let count = 0;
    for (let cross = crossStart; cross < crossEnd; cross += 1) {
      const x = axis === 'x' ? position : cross;
      const y = axis === 'x' ? cross : position;
      if (alphaAt(image, x, y) >= ALPHA_THRESHOLD) count += 1;
    }
    occupied[position] = count;
  }
  const raw = [];
  let start = -1;
  for (let position = 0; position <= length; position += 1) {
    const active = position < length && occupied[position] >= 8;
    if (active && start < 0) start = position;
    if (!active && start >= 0) {
      raw.push({ start, end: position - 1 });
      start = -1;
    }
  }
  const merged = [];
  for (const band of raw) {
    const prior = merged.at(-1);
    if (prior && band.start - prior.end <= 5) prior.end = band.end;
    else merged.push({ ...band });
  }
  if (merged.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} ${axis}-axis subject bands; got ${merged.length}: `
      + JSON.stringify(merged),
    );
  }
  const edges = [0];
  for (let index = 0; index < merged.length - 1; index += 1) {
    edges.push(Math.floor((merged[index].end + merged[index + 1].start) / 2));
  }
  edges.push(length);
  return { bands: merged, edges };
}

function detectCellSubject(image, cell) {
  const width = cell.x1 - cell.x0;
  const height = cell.y1 - cell.y0;
  const visited = new Uint8Array(width * height);
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);
  const components = [];
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
      visited[localIndex] = 1;
      queueX[0] = localX;
      queueY[0] = localY;
      let head = 0;
      let tail = 1;
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
  const retained = components.filter(({ pixels }) => pixels >= 2);
  const discardedPixels = components
    .filter(({ pixels }) => pixels < 2)
    .reduce((total, component) => total + component.pixels, 0);
  const totalPixels = components.reduce((total, component) => total + component.pixels, 0);
  if (discardedPixels / totalPixels > 0.001) {
    throw new Error(`Source cell ${cell.column},${cell.row} has excessive isolated alpha noise.`);
  }
  const minX = Math.min(...retained.map((component) => component.x));
  const minY = Math.min(...retained.map((component) => component.y));
  const maxX = Math.max(...retained.map((component) => component.x + component.width - 1));
  const maxY = Math.max(...retained.map((component) => component.y + component.height - 1));
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  if (
    bounds.x <= 0
    || bounds.y <= 0
    || bounds.x + bounds.width >= width
    || bounds.y + bounds.height >= height
  ) {
    throw new Error(
      `Source cell ${cell.column},${cell.row} touches a segmentation edge: `
      + JSON.stringify({ bounds, width, height }),
    );
  }
  return {
    bounds,
    component_count: components.length,
    retained_component_count: retained.length,
    visible_pixels: totalPixels,
    discarded_isolated_pixels: discardedPixels,
    transparent_padding: true,
  };
}

function detectRowPoseGroups(image, y0, y1, expectedCount, labels, firstGroupId) {
  const rowHeight = y1 - y0;
  const visited = new Uint8Array(image.width * rowHeight);
  const queueX = new Int32Array(image.width * rowHeight);
  const queueY = new Int32Array(image.width * rowHeight);
  const neighbours = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  const components = [];
  for (let localY = 0; localY < rowHeight; localY += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = localY * image.width + x;
      if (visited[index] || alphaAt(image, x, y0 + localY) === 0) continue;
      visited[index] = 1;
      queueX[0] = x;
      queueY[0] = localY;
      let head = 0;
      let tail = 1;
      let minX = x;
      let minY = localY;
      let maxX = x;
      let maxY = localY;
      let sumX = 0;
      let sumY = 0;
      const pixelIndices = [];
      while (head < tail) {
        const currentX = queueX[head];
        const currentY = queueY[head];
        head += 1;
        const globalY = y0 + currentY;
        pixelIndices.push(globalY * image.width + currentX);
        sumX += currentX;
        sumY += globalY;
        minX = Math.min(minX, currentX);
        minY = Math.min(minY, currentY);
        maxX = Math.max(maxX, currentX);
        maxY = Math.max(maxY, currentY);
        for (const [dx, dy] of neighbours) {
          const nx = currentX + dx;
          const ny = currentY + dy;
          if (nx < 0 || ny < 0 || nx >= image.width || ny >= rowHeight) continue;
          const neighbourIndex = ny * image.width + nx;
          if (visited[neighbourIndex] || alphaAt(image, nx, y0 + ny) === 0) continue;
          visited[neighbourIndex] = 1;
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail += 1;
        }
      }
      components.push({
        bounds: {
          x: minX,
          y: y0 + minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        pixels: pixelIndices.length,
        centerX: sumX / pixelIndices.length,
        centerY: sumY / pixelIndices.length,
        pixelIndices,
      });
    }
  }
  const retained = components.filter(({ pixels }) => pixels >= 2);
  const primary = [...retained]
    .sort((a, b) => b.pixels - a.pixels)
    .slice(0, expectedCount)
    .sort((a, b) => a.centerX - b.centerX);
  if (
    primary.length !== expectedCount
    || primary.some(({ pixels }) => pixels < 500)
    || primary.some((component, index) => (
      index > 0 && component.centerX - primary[index - 1].centerX < 70
    ))
  ) {
    throw new Error(
      `Could not identify ${expectedCount} distinct primary pose components in row ${y0}-${y1}.`,
    );
  }
  const groups = primary.map((component, index) => ({
    groupId: firstGroupId + index,
    primaryCenterX: component.centerX,
    components: [],
  }));
  for (const component of retained) {
    let selected = groups[0];
    let minimumDistance = Math.abs(component.centerX - selected.primaryCenterX);
    for (let index = 1; index < groups.length; index += 1) {
      const distance = Math.abs(component.centerX - groups[index].primaryCenterX);
      if (distance < minimumDistance) {
        selected = groups[index];
        minimumDistance = distance;
      }
    }
    selected.components.push(component);
    for (const pixelIndex of component.pixelIndices) labels[pixelIndex] = selected.groupId;
  }
  return groups.map((group) => {
    const minX = Math.min(...group.components.map(({ bounds }) => bounds.x));
    const minY = Math.min(...group.components.map(({ bounds }) => bounds.y));
    const maxX = Math.max(...group.components.map(({ bounds }) => bounds.x + bounds.width - 1));
    const maxY = Math.max(...group.components.map(({ bounds }) => bounds.y + bounds.height - 1));
    const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    if (
      bounds.x <= 0
      || bounds.y <= y0
      || bounds.x + bounds.width >= image.width
      || bounds.y + bounds.height >= y1
    ) {
      throw new Error(`Pose group ${group.groupId} touches its row/image segmentation edge.`);
    }
    return {
      groupId: group.groupId,
      centerX: Number(group.primaryCenterX.toFixed(3)),
      bounds,
      componentCount: group.components.length,
      visiblePixels: group.components.reduce((total, component) => total + component.pixels, 0),
    };
  });
}

function groupCropDigest(image, labels, groupId, bounds) {
  const bytes = Buffer.alloc(bounds.width * bounds.height * 4);
  let writeOffset = 0;
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceX = bounds.x + x;
      const sourceY = bounds.y + y;
      const pixelIndex = sourceY * image.width + sourceX;
      if (labels[pixelIndex] === groupId) {
        const sourceOffset = pixelIndex * 4;
        Buffer.from(image.rgba.subarray(sourceOffset, sourceOffset + 4)).copy(bytes, writeOffset);
      }
      writeOffset += 4;
    }
  }
  return sha256(bytes);
}

function placeSourcePose(source, labels, groupId, bounds, destination, atlasCell, variant) {
  const baseScale = Math.min(
    TARGET.visibleWidth / bounds.width,
    TARGET.visibleHeight / bounds.height,
    1,
  );
  const width = Math.max(1, Math.round(bounds.width * baseScale * variant.scaleX));
  const height = Math.max(1, Math.round(bounds.height * baseScale * variant.scaleY));
  const relativeLeft = Math.round((TARGET.frameWidth - width) / 2) + variant.shiftX;
  const relativeTop = TARGET.pivotY - height - variant.footLift;
  if (
    relativeLeft < 0
    || relativeTop < 0
    || relativeLeft + width > TARGET.frameWidth
    || relativeTop + height > TARGET.frameHeight
  ) {
    throw new Error(`Runtime frame ${atlasCell.column},${atlasCell.row} exceeds its cell.`);
  }
  const sourceX0 = bounds.x;
  const sourceY0 = bounds.y;
  const destinationX0 = atlasCell.column * TARGET.frameWidth + relativeLeft;
  const destinationY0 = atlasCell.row * TARGET.frameHeight + relativeTop;
  for (let y = 0; y < height; y += 1) {
    const sourceY = sourceY0 + (
      height === 1 ? 0 : Math.round((y * (bounds.height - 1)) / (height - 1))
    );
    for (let x = 0; x < width; x += 1) {
      const sourceX = sourceX0 + (
        width === 1 ? 0 : Math.round((x * (bounds.width - 1)) / (width - 1))
      );
      const sourcePixelIndex = sourceY * source.width + sourceX;
      if (labels[sourcePixelIndex] !== groupId) continue;
      const sourceOffset = sourcePixelIndex * 4;
      const destinationOffset = ((destinationY0 + y) * TARGET.width + destinationX0 + x) * 4;
      destination.set(source.rgba.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }
  return {
    x: relativeLeft,
    y: relativeTop,
    width,
    height,
    base_scale: Number(baseScale.toFixed(8)),
  };
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

function frameMetrics(rgba, column, row, cuePolicy) {
  let minX = TARGET.frameWidth;
  let minY = TARGET.frameHeight;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  let greenSpillPixels = 0;
  const cues = Object.fromEntries(cuePolicy.map(({ id }) => [id, 0]));
  const bytes = Buffer.alloc(TARGET.frameWidth * TARGET.frameHeight * 4);
  let writeOffset = 0;
  for (let y = 0; y < TARGET.frameHeight; y += 1) {
    const sourceOffset = (
      ((row * TARGET.frameHeight + y) * TARGET.width + column * TARGET.frameWidth) * 4
    );
    Buffer.from(rgba.subarray(sourceOffset, sourceOffset + TARGET.frameWidth * 4))
      .copy(bytes, writeOffset);
    writeOffset += TARGET.frameWidth * 4;
    for (let x = 0; x < TARGET.frameWidth; x += 1) {
      const offset = sourceOffset + x * 4;
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
      for (const cue of cuePolicy) if (cueId(red, green, blue, cue.id)) cues[cue.id] += 1;
    }
  }
  if (visiblePixels === 0) return { empty: true, rgbaSha256: sha256(bytes) };
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return {
    empty: false,
    bounds,
    visiblePixels,
    greenSpillPixels,
    footAnchorError: TARGET.pivotY - (maxY + 1),
    cuePixels: cues,
    rgbaSha256: sha256(bytes),
  };
}

function shiftFrameDown(rgba, column, row, amount) {
  if (!Number.isInteger(amount) || amount <= 0) return;
  const rowBytes = TARGET.frameWidth * 4;
  for (let y = TARGET.frameHeight - 1; y >= 0; y -= 1) {
    const targetOffset = (
      ((row * TARGET.frameHeight + y) * TARGET.width + column * TARGET.frameWidth) * 4
    );
    if (y >= amount) {
      const sourceOffset = (
        ((row * TARGET.frameHeight + y - amount) * TARGET.width + column * TARGET.frameWidth) * 4
      );
      rgba.copyWithin(targetOffset, sourceOffset, sourceOffset + rowBytes);
    } else {
      rgba.fill(0, targetOffset, targetOffset + rowBytes);
    }
  }
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

function inputRecord(stage, path, bytes, image, expectedBytes, expectedSha256) {
  if (bytes.length !== expectedBytes || sha256(bytes) !== expectedSha256) {
    throw new Error(`${stage} input ${path} changed.`);
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

const summaries = [];
for (const config of CONFIGS) {
  const [sourceBytes, rgbaBytes] = await Promise.all([
    readFile(resolve(config.sourcePath)),
    readFile(resolve(config.rgbaPath)),
  ]);
  const sourceDimensions = pngDimensions(sourceBytes, `${config.id} chroma source`);
  const source = decodeRgbaPng(rgbaBytes, `${config.id} RGBA source`);
  if (
    sourceDimensions.width !== 1536
    || sourceDimensions.height !== 1024
    || source.width !== 1536
    || source.height !== 1024
  ) {
    throw new Error(`${config.id} source sheets must be exactly 1536x1024.`);
  }
  const sourceRecord = inputRecord(
    'chroma-source',
    config.sourcePath,
    sourceBytes,
    sourceDimensions,
    config.sourceBytes,
    config.sourceSha256,
  );
  const rgbaRecord = inputRecord(
    'rgba-candidate',
    config.rgbaPath,
    rgbaBytes,
    source,
    config.rgbaBytes,
    config.rgbaSha256,
  );
  const ySegmentation = detectAxisBands(source, 'y', config.actions.length);
  const poseLabels = new Uint16Array(source.width * source.height);
  const sourcePoses = [];
  const rowPoseCentersX = [];
  let firstGroupId = 1;
  for (let actionIndex = 0; actionIndex < config.actions.length; actionIndex += 1) {
    const groups = detectRowPoseGroups(
      source,
      ySegmentation.edges[actionIndex],
      ySegmentation.edges[actionIndex + 1],
      DIRECTIONS.length,
      poseLabels,
      firstGroupId,
    );
    firstGroupId += DIRECTIONS.length;
    rowPoseCentersX.push(groups.map(({ centerX }) => centerX));
    for (let directionIndex = 0; directionIndex < DIRECTIONS.length; directionIndex += 1) {
      const group = groups[directionIndex];
      sourcePoses.push({
        clip_id: `${config.actions[actionIndex]}.${DIRECTIONS[directionIndex]}`,
        action: config.actions[actionIndex],
        direction: DIRECTIONS[directionIndex],
        source_cell: { column: directionIndex, row: actionIndex },
        component_group_id: group.groupId,
        source_region: group.bounds,
        detection: {
          component_count: group.componentCount,
          retained_component_count: group.componentCount,
          visible_pixels: group.visiblePixels,
          discarded_isolated_pixels: 0,
          transparent_padding: true,
        },
        source_subject_rgba_sha256: groupCropDigest(
          source,
          poseLabels,
          group.groupId,
          group.bounds,
        ),
      });
    }
  }
  const expectedSourcePoseCount = config.actions.length * DIRECTIONS.length;
  if (
    sourcePoses.length !== expectedSourcePoseCount
    || new Set(sourcePoses.map(({ source_subject_rgba_sha256: digest }) => digest)).size
      !== expectedSourcePoseCount
  ) {
    throw new Error(`${config.id} must contain one distinct source pose per action/direction.`);
  }

  const sheetManifest = {
    schema_version: 'mapsoo-production-art-source/1.0',
    id: `isometric-action-${config.id}-sheet-v1`,
    profile: 'isometric-action',
    role: config.role,
    status: 'source-candidate',
    distribution: 'internal-review',
    output_license: 'UNRELEASED',
    grid: {
      columns: DIRECTIONS.length,
      rows: config.actions.length,
      partition_policy: 'row-wise-connected-component-clustering',
      y_edges: ySegmentation.edges,
      y_subject_bands: ySegmentation.bands,
      row_pose_centers_x: rowPoseCentersX,
      column_directions: DIRECTIONS,
      row_actions: config.actions,
    },
    rasters: [sourceRecord, rgbaRecord],
    generation_context: {
      mode: 'built-in-image-generation',
      generation_receipt: 'not-persisted',
      prompt_id: config.promptId,
      prompt: config.prompt,
      references: [
        `${ART_ROOT}/isometric-action-direction-v1.png`,
        ...(config.id === 'player'
          ? [
            `${ART_ROOT}/topdown-farm-character-sheet-rgba-v1.png`,
            `${ART_ROOT}/side-platformer-character-sheet-rgba-v2.png`,
          ]
          : [`${ART_ROOT}/isometric-action-player-sheet-source-v1.png`]),
      ],
    },
    extraction: {
      operation: 'chroma-key-to-alpha',
      auto_key: 'border',
      sampled_key_color: config.id === 'player' ? '#04f903' : config.id === 'enemy-melee' ? '#05f20a' : '#05ee07',
      soft_matte: true,
      transparent_threshold: 12,
      opaque_threshold: 220,
      edge_contract: 1,
      despill: true,
      alpha_threshold_for_slicing: ALPHA_THRESHOLD,
      connectivity: 8,
      retained_component_policy:
        'per action row, select eight largest primary components ordered by x; assign every '
        + 'remaining component with at least 2 alpha pixels to its nearest primary x center',
    },
    source_poses: sourcePoses,
    provenance_claim: {
      native_source_poses: true,
      native_source_pose_count: expectedSourcePoseCount,
      native_animation_sequence: false,
      explanation:
        'Each action/direction owns one independently present source cell. The sheet does not '
        + 'contain a model-native temporal animation sequence for each clip.',
    },
    automated_checks: {
      immutable_input_hashes: 'pass',
      source_pose_count: expectedSourcePoseCount,
      unique_source_pose_digests: expectedSourcePoseCount,
      transparent_gap_segmentation: 'pass',
      transparent_cell_padding: 'pass',
      native_source_poses: true,
      native_animation_sequence: false,
      action_semantics: 'manual-review',
      identity_consistency: 'runtime-color-gate-plus-manual-review',
    },
    not_accepted_for: [
      'human-approved animation',
      'Godot runtime validation',
      'Raspberry Pi validation',
      'complete world asset pack',
      'public asset-pack release',
    ],
  };

  const atlasRgba = new Uint8Array(TARGET.width * TARGET.height * 4);
  const frames = [];
  let minimumVisibleHeight = Number.POSITIVE_INFINITY;
  let maximumVisibleHeight = 0;
  let maximumFootAnchorError = 0;
  for (const sourcePose of sourcePoses) {
    const actionIndex = config.actions.indexOf(sourcePose.action);
    const directionIndex = DIRECTIONS.indexOf(sourcePose.direction);
    const directionShift = directionIndex < 4 ? 1 : -1;
    const variants = [
      {
        id: 'native-source-pose',
        kind: 'one-to-one-nearest-neighbor-fit',
        scaleX: 1,
        scaleY: 1,
        shiftX: 0,
        footLift: 0,
        nativeSourcePose: true,
        syntheticPoseVariant: false,
      },
      {
        id: 'declared-motion-variant',
        kind: 'deterministic-postprocess-variant',
        scaleX: 0.97,
        scaleY: 0.98,
        shiftX: directionShift,
        footLift: sourcePose.action === 'move' || sourcePose.action === 'dash' ? 1 : 0,
        nativeSourcePose: false,
        syntheticPoseVariant: true,
      },
    ];
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      const variant = variants[variantIndex];
      const atlasCell = { column: directionIndex * 2 + variantIndex, row: actionIndex };
      const placed = placeSourcePose(
        source,
        poseLabels,
        sourcePose.component_group_id,
        sourcePose.source_region,
        atlasRgba,
        atlasCell,
        variant,
      );
      let metrics = frameMetrics(atlasRgba, atlasCell.column, atlasCell.row, config.identityCues);
      if (!metrics.empty && metrics.footAnchorError > variant.footLift) {
        const correction = metrics.footAnchorError - variant.footLift;
        shiftFrameDown(atlasRgba, atlasCell.column, atlasCell.row, correction);
        placed.y += correction;
        metrics = frameMetrics(atlasRgba, atlasCell.column, atlasCell.row, config.identityCues);
      }
      if (metrics.empty) throw new Error(`${config.id} runtime frame ${atlasCell.column},${atlasCell.row} is empty.`);
      if (
        metrics.footAnchorError < 0
        || metrics.footAnchorError > TARGET.maximumFootAnchorError
      ) {
        throw new Error(
          `${config.id} runtime frame ${atlasCell.column},${atlasCell.row} foot error `
          + `${metrics.footAnchorError}px is invalid.`,
        );
      }
      for (const cue of config.identityCues) {
        if (metrics.cuePixels[cue.id] < cue.minimumPixels) {
          throw new Error(
            `${config.id} ${sourcePose.clip_id} frame ${variantIndex} identity cue ${cue.id} `
            + `has ${metrics.cuePixels[cue.id]}px; needs ${cue.minimumPixels}px.`,
          );
        }
      }
      if (metrics.greenSpillPixels !== 0) {
        throw new Error(`${config.id} frame ${atlasCell.column},${atlasCell.row} retains green spill.`);
      }
      minimumVisibleHeight = Math.min(minimumVisibleHeight, metrics.bounds.height);
      maximumVisibleHeight = Math.max(maximumVisibleHeight, metrics.bounds.height);
      maximumFootAnchorError = Math.max(maximumFootAnchorError, metrics.footAnchorError);
      frames.push({
        clip_id: sourcePose.clip_id,
        action: sourcePose.action,
        direction: sourcePose.direction,
        frame_index: variantIndex,
        source_pose: {
          source_cell: sourcePose.source_cell,
          source_subject_rgba_sha256: sourcePose.source_subject_rgba_sha256,
          native_source_pose: variant.nativeSourcePose,
          generation_receipt: 'not-persisted',
        },
        derivation: {
          kind: variant.kind,
          variant_id: variant.id,
          native_model_animation_frame: false,
          synthetic_pose_variant: variant.syntheticPoseVariant,
          mirrored: false,
          transform: {
            scale_x: variant.scaleX,
            scale_y: variant.scaleY,
            shift_x: variant.shiftX,
            foot_lift: variant.footLift,
          },
        },
        atlas_cell: atlasCell,
        pixel_origin: {
          x: atlasCell.column * TARGET.frameWidth,
          y: atlasCell.row * TARGET.frameHeight,
        },
        pixel_rect: {
          x: atlasCell.column * TARGET.frameWidth,
          y: atlasCell.row * TARGET.frameHeight,
          width: TARGET.frameWidth,
          height: TARGET.frameHeight,
        },
        visible_bounds: metrics.bounds,
        placed_bounds: placed,
        visible_height: metrics.bounds.height,
        visible_pixels: metrics.visiblePixels,
        foot_anchor_error_px: metrics.footAnchorError,
        pivot: [TARGET.pivotX, TARGET.pivotY],
        identity_cue_pixels: metrics.cuePixels,
        frame_rgba_sha256: metrics.rgbaSha256,
      });
    }
  }
  if (
    new Set(frames.map(({ frame_rgba_sha256: digest }) => digest)).size !== frames.length
  ) {
    throw new Error(`${config.id} runtime frames must have distinct RGBA digests.`);
  }
  const identityCueResults = config.identityCues.map((cue) => {
    const coveredFrames = frames.filter(
      (frame) => frame.identity_cue_pixels[cue.id] >= Math.max(1, cue.minimumPixels),
    ).length;
    const totalPixels = frames.reduce(
      (total, frame) => total + frame.identity_cue_pixels[cue.id],
      0,
    );
    const requiredCoverage = cue.minimumFrameCoverage ?? frames.length;
    const requiredTotal = cue.minimumTotalPixels ?? cue.minimumPixels * frames.length;
    if (coveredFrames < requiredCoverage || totalPixels < requiredTotal) {
      throw new Error(
        `${config.id} identity cue ${cue.id} coverage ${coveredFrames}/${frames.length}, `
        + `${totalPixels}px does not meet ${requiredCoverage} frames and ${requiredTotal}px.`,
      );
    }
    return {
      id: cue.id,
      covered_frames: coveredFrames,
      total_pixels: totalPixels,
      required_covered_frames: requiredCoverage,
      required_total_pixels: requiredTotal,
    };
  });
  const mappedCells = new Set(frames.map(({ atlas_cell: cell }) => `${cell.column},${cell.row}`));
  let transparentUnmappedCells = 0;
  for (let row = 0; row < TARGET.rows; row += 1) {
    for (let column = 0; column < TARGET.columns; column += 1) {
      const key = `${column},${row}`;
      const metrics = frameMetrics(atlasRgba, column, row, config.identityCues);
      if (mappedCells.has(key)) {
        if (metrics.empty) throw new Error(`${config.id} mapped cell ${key} is empty.`);
      } else {
        if (!metrics.empty) throw new Error(`${config.id} unmapped cell ${key} is not transparent.`);
        transparentUnmappedCells += 1;
      }
    }
  }

  const clips = config.actions.flatMap((action) => DIRECTIONS.map((direction) => {
    const clipFrames = frames
      .filter((frame) => frame.action === action && frame.direction === direction)
      .sort((a, b) => a.frame_index - b.frame_index);
    if (
      clipFrames.length !== 2
      || clipFrames[0].source_pose.native_source_pose !== true
      || clipFrames[1].derivation.synthetic_pose_variant !== true
    ) {
      throw new Error(`${config.id} clip ${action}.${direction} provenance is incomplete.`);
    }
    return {
      clip_id: `${action}.${direction}`,
      action,
      direction,
      fps: action === 'move' || action === 'dash' ? 10 : action === 'attack-primary' ? 8 : 6,
      loop: action === 'idle' || action === 'move',
      native_source_pose_count: 1,
      native_model_animation_frame_count: 0,
      synthetic_variant_count: 1,
      temporal_animation_continuity: 'manual-review',
      frames: clipFrames.map(({ atlas_cell: cell, pixel_origin: origin }) => ({
        atlas_cell: cell,
        pixel_origin: origin,
      })),
    };
  }));
  const atlasBytes = encodeRgbaPng(TARGET.width, TARGET.height, atlasRgba);
  const atlasHash = sha256(atlasBytes);
  const expectedRuntimeFrames = expectedSourcePoseCount * 2;
  const expectedUnmapped = TARGET.columns * TARGET.rows - expectedRuntimeFrames;
  if (transparentUnmappedCells !== expectedUnmapped) {
    throw new Error(`${config.id} transparent unmapped cell count is invalid.`);
  }
  const atlasManifest = {
    schema_version: 'mapsoo-runtime-character-atlas/1.0',
    id: `isometric-action-${config.id}-atlas-v1`,
    profile: 'isometric-action',
    character_id: config.characterId,
    role: config.role,
    status: 'runtime-candidate',
    distribution: 'internal-review',
    output_license: 'UNRELEASED',
    path: config.atlasPath,
    media_type: 'image/png',
    width: TARGET.width,
    height: TARGET.height,
    bytes: atlasBytes.length,
    sha256: atlasHash,
    frame_geometry: {
      frame_width: TARGET.frameWidth,
      frame_height: TARGET.frameHeight,
      columns: TARGET.columns,
      rows: TARGET.rows,
    },
    pivot: [TARGET.pivotX, TARGET.pivotY],
    source_manifest: config.sheetManifestPath,
    source_rgba_sha256: config.rgbaSha256,
    identity: {
      identity_digest_sha256: config.identityDigest,
      cues: config.identityCues,
      cue_results: identityCueResults,
      gate:
        'per-frame minimums plus declared coverage/total thresholds for directionally occluded cues',
    },
    processing: {
      resampler: 'nearest-neighbor',
      visible_box: [TARGET.visibleWidth, TARGET.visibleHeight],
      placement: 'horizontal-center-and-foot-pivot',
      mapped_cells: expectedRuntimeFrames,
      unmapped_transparent_cells: transparentUnmappedCells,
      pose_policy: {
        id: 'native-source-pose-plus-declared-variant-v1',
        native_source_pose_count: expectedSourcePoseCount,
        native_model_animation_frame_count: 0,
        synthetic_variant_count: expectedSourcePoseCount,
        runtime_frame_count: expectedRuntimeFrames,
        native_animation_sequence: false,
        description:
          'Each clip uses one independently generated source pose plus one declared deterministic '
          + 'scale/shift variant. No clip is represented as a model-native temporal animation.',
      },
    },
    clips,
    frames,
    automated_checks: {
      exact_frame_geometry: 'pass',
      exact_pivot: 'pass',
      runtime_clip_count: clips.length,
      runtime_frame_count: frames.length,
      unique_runtime_frame_digests: frames.length,
      native_source_pose_count: expectedSourcePoseCount,
      native_model_animation_frame_count: 0,
      synthetic_variant_count: expectedSourcePoseCount,
      mapped_cell_count: expectedRuntimeFrames,
      unmapped_transparent_cell_count: transparentUnmappedCells,
      visible_height_range: [minimumVisibleHeight, maximumVisibleHeight],
      maximum_foot_anchor_error_px: maximumFootAnchorError,
      identity_cue_gate: 'pass',
      green_spill_pixels: 0,
      deterministic_png: 'pass',
      action_semantics: 'manual-review',
      temporal_animation_continuity: 'manual-review',
      Godot_runtime: 'not-performed',
      Raspberry_Pi_runtime: 'not-performed',
      human_review: 'not-performed',
    },
    not_accepted_for: [
      'human-approved animation',
      'Godot runtime validation',
      'Raspberry Pi validation',
      'complete world asset pack',
      'public asset-pack release',
    ],
  };

  await writeIfChanged(
    config.sheetManifestPath,
    Buffer.from(`${JSON.stringify(sheetManifest, null, 2)}\n`, 'utf8'),
  );
  await writeIfChanged(config.atlasPath, atlasBytes);
  await writeIfChanged(
    config.atlasManifestPath,
    Buffer.from(`${JSON.stringify(atlasManifest, null, 2)}\n`, 'utf8'),
  );
  summaries.push(
    `${config.id}:frames=${frames.length}:clips=${clips.length}:unmapped=${transparentUnmappedCells}:`
    + `height=${minimumVisibleHeight}-${maximumVisibleHeight}:foot=${maximumFootAnchorError}:sha256=${atlasHash}`,
  );
}

console.log(`MAPSOO_ISOMETRIC_CHARACTER_ATLASES_OK ${summaries.join(' ')}`);
