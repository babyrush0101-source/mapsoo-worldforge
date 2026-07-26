import pako from 'pako';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

export function decodeRgbaPng(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from(PNG_SIGNATURE))) {
    throw new Error('Source is not a PNG.');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error('Source must be a non-interlaced 8-bit RGB or RGBA PNG.');
  }
  const idat = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (offset + 12 + length > bytes.length) throw new Error('PNG chunk is truncated.');
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (idat.length === 0) throw new Error('PNG has no image data.');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const filtered = pako.inflate(concatenate(idat));
  if (filtered.length !== (stride + 1) * height) throw new Error('PNG scanline length is invalid.');
  const decoded = new Uint8Array(stride * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x];
      const outputOffset = y * stride + x;
      const left = x >= channels ? decoded[outputOffset - channels] : 0;
      const up = y > 0 ? decoded[outputOffset - stride] : 0;
      const upperLeft = y > 0 && x >= channels ? decoded[outputOffset - stride - channels] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upperLeft);
      else throw new Error(`Unsupported PNG scanline filter: ${filter}.`);
      decoded[outputOffset] = value & 0xff;
    }
    sourceOffset += stride;
  }
  if (channels === 4) return { width, height, rgba: decoded };
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = decoded[index * 3];
    rgba[index * 4 + 1] = decoded[index * 3 + 1];
    rgba[index * 4 + 2] = decoded[index * 3 + 2];
    rgba[index * 4 + 3] = 255;
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

export function encodeRgbaPng(width, height, rgba) {
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

export function resizeNearest(image, width, height) {
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
  ) {
    throw new Error('Nearest-neighbor target dimensions are invalid.');
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      rgba.set(image.rgba.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { width, height, rgba };
}
