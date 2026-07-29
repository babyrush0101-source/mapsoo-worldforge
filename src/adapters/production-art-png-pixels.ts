const CHROMA_KEY = Object.freeze({ red: 0, green: 255, blue: 0 });
const CHROMA_DISTANCE_SQUARED = 150 * 150;
const CHROMA_GREEN_DOMINANCE = 38;

export function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function isChroma(red: number, green: number, blue: number): boolean {
  const dr = red - CHROMA_KEY.red;
  const dg = green - CHROMA_KEY.green;
  const db = blue - CHROMA_KEY.blue;
  return (dr * dr + dg * dg + db * db <= CHROMA_DISTANCE_SQUARED)
    || (
      green >= 110
      && green - Math.max(red, blue) >= CHROMA_GREEN_DOMINANCE
    );
}

export function extractEdgeConnectedChroma(
  width: number,
  height: number,
  sourceRgba: Uint8Array,
): Uint8Array {
  const pixelCount = width * height;
  const background = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const seed = (x: number, y: number): void => {
    const index = y * width + x;
    if (background[index]) return;
    const offset = index * 4;
    if (!isChroma(sourceRgba[offset], sourceRgba[offset + 1], sourceRgba[offset + 2])) return;
    background[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    seed(x, 0);
    if (height > 1) seed(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    seed(0, y);
    if (width > 1) seed(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) seed(x - 1, y);
    if (x + 1 < width) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y + 1 < height) seed(x, y + 1);
  }

  const minimumBackground = Math.max(1, Math.floor(pixelCount * 0.01));
  const minimumSubject = Math.max(1, Math.floor(pixelCount * 0.0025));
  if (tail < minimumBackground || pixelCount - tail < minimumSubject) {
    throw new Error(
      'Straight-alpha source must contain a visible subject isolated by an edge-connected green chroma background.',
    );
  }

  const output = Uint8Array.from(sourceRgba);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (background[index]) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 0;
      continue;
    }
    output[offset + 3] = 255;
    const x = index % width;
    const y = Math.floor(index / width);
    const touchesBackground = (x > 0 && background[index - 1])
      || (x + 1 < width && background[index + 1])
      || (y > 0 && background[index - width])
      || (y + 1 < height && background[index + width]);
    if (touchesBackground && output[offset + 1] > Math.max(output[offset], output[offset + 2]) + 16) {
      output[offset + 1] = Math.min(255, Math.max(output[offset], output[offset + 2]) + 16);
    }
  }
  return output;
}

export function forceOpaque(rgba: Uint8Array): Uint8Array {
  const output = Uint8Array.from(rgba);
  for (let offset = 3; offset < output.byteLength; offset += 4) output[offset] = 255;
  return output;
}

export function resizeNearest(
  source: Readonly<{ width: number; height: number; rgba: Uint8Array }>,
  width: number,
  height: number,
): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y * source.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x * source.width) / width));
      const sourceOffset = pixelOffset(source.width, sourceX, sourceY);
      output.set(source.rgba.subarray(sourceOffset, sourceOffset + 4), pixelOffset(width, x, y));
    }
  }
  return output;
}
