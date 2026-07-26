import type { CharacterIdentityPixels } from '../core/character-identity-signature';
import type { ReferenceImageMediaType } from '../core/reference-image';

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function paeth(a: number, b: number, c: number): number {
  const estimate = a + b - c;
  const distanceA = Math.abs(estimate - a);
  const distanceB = Math.abs(estimate - b);
  const distanceC = Math.abs(estimate - c);
  return distanceA <= distanceB && distanceA <= distanceC ? a : distanceB <= distanceC ? b : c;
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This runtime cannot decode PNG identity pixels.');
  }
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const stream = new Blob([input.buffer]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decodePng(bytes: Uint8Array): Promise<CharacterIdentityPixels> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 33 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Character PNG signature is invalid.');
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const interlace = bytes[28];
  if (bitDepth !== 8 || ![2, 6].includes(colorType) || interlace !== 0) {
    throw new Error('Character PNG fallback requires non-interlaced 8-bit RGB or RGBA pixels.');
  }
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (offset + 12 + length > bytes.byteLength) throw new Error('Character PNG chunk is truncated.');
    if (type === 'IDAT') idat.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (idat.length === 0) throw new Error('Character PNG contains no image data.');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const filtered = await inflateZlib(concat(idat));
  if (filtered.byteLength !== (stride + 1) * height) throw new Error('Character PNG scanline length is invalid.');
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
      let value: number;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upperLeft);
      else throw new Error('Character PNG uses an unsupported scanline filter.');
      decoded[outputOffset] = value & 0xff;
    }
    sourceOffset += stride;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = decoded[index * channels];
    rgba[index * 4 + 1] = decoded[index * channels + 1];
    rgba[index * 4 + 2] = decoded[index * channels + 2];
    rgba[index * 4 + 3] = channels === 4 ? decoded[index * channels + 3] : 255;
  }
  return Object.freeze({ width, height, rgba });
}

async function decodeNative(
  bytes: Uint8Array,
  mediaType: ReferenceImageMediaType,
): Promise<CharacterIdentityPixels | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const snapshot = new Uint8Array(bytes.byteLength);
  snapshot.set(bytes);
  const bitmap = await createImageBitmap(new Blob([snapshot.buffer], { type: mediaType }));
  try {
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : typeof document !== 'undefined'
        ? Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
        : null;
    if (!canvas) return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Character image canvas is unavailable.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return Object.freeze({
      width: bitmap.width,
      height: bitmap.height,
      rgba: Uint8Array.from(pixels.data),
    });
  } finally {
    bitmap.close();
  }
}

export async function decodeReferenceImageRgba(
  bytes: Uint8Array,
  mediaType: ReferenceImageMediaType,
): Promise<CharacterIdentityPixels> {
  const native = await decodeNative(bytes, mediaType);
  if (native) return native;
  if (mediaType === 'image/png') return decodePng(bytes);
  throw new Error('JPEG character identity decoding requires a browser image decoder.');
}
