export interface EnvironmentArtPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface EnvironmentArtSignature {
  readonly schema_version: '0.1.0';
  readonly palette: readonly string[];
  readonly average_luminance: number;
  readonly vertical_luminance: readonly [number, number, number];
  readonly horizon_y: number;
  readonly edge_density: number;
  readonly detail_scale: 'coarse' | 'medium' | 'fine';
  readonly temperature: 'cool' | 'neutral' | 'warm';
  readonly signature_sha256: string;
}

export class EnvironmentArtSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentArtSignatureError';
  }
}

function fail(message: string): never {
  throw new EnvironmentArtSignatureError(message);
}

function validatePixels(input: EnvironmentArtPixels): void {
  if (
    !Number.isSafeInteger(input.width)
    || !Number.isSafeInteger(input.height)
    || input.width < 1
    || input.height < 1
    || input.width > 8192
    || input.height > 8192
    || !(input.rgba instanceof Uint8Array)
    || input.rgba.byteLength !== input.width * input.height * 4
  ) {
    fail('Environment pixels must be a bounded RGBA raster.');
  }
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(r: number, g: number, b: number): number {
  return Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);
}

function stableJson(signature: Omit<EnvironmentArtSignature, 'signature_sha256'>): string {
  return JSON.stringify({
    schema_version: signature.schema_version,
    palette: signature.palette,
    average_luminance: signature.average_luminance,
    vertical_luminance: signature.vertical_luminance,
    horizon_y: signature.horizon_y,
    edge_density: signature.edge_density,
    detail_scale: signature.detail_scale,
    temperature: signature.temperature,
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Extracts a compact, local-only visual grammar from decoded environment pixels.
 * It intentionally describes color/value/structure rather than naming objects or
 * imitating a protected art style.
 */
export async function extractEnvironmentArtSignature(
  input: EnvironmentArtPixels,
): Promise<EnvironmentArtSignature> {
  validatePixels(input);
  const sampleWidth = Math.min(64, input.width);
  const sampleHeight = Math.min(64, input.height);
  const pixels: Array<readonly [number, number, number]> = [];
  const grid: Array<readonly [number, number, number] | undefined> =
    new Array(sampleWidth * sampleHeight).fill(undefined);
  const rowLuminance = new Array<number>(sampleHeight).fill(0);
  const rowSamples = new Array<number>(sampleHeight).fill(0);
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let red = 0;
  let blue = 0;

  for (let sy = 0; sy < sampleHeight; sy += 1) {
    const sourceY = Math.min(input.height - 1, Math.floor(((sy + 0.5) * input.height) / sampleHeight));
    for (let sx = 0; sx < sampleWidth; sx += 1) {
      const sourceX = Math.min(input.width - 1, Math.floor(((sx + 0.5) * input.width) / sampleWidth));
      const offset = (sourceY * input.width + sourceX) * 4;
      if (input.rgba[offset + 3] < 16) continue;
      const r = input.rgba[offset];
      const g = input.rgba[offset + 1];
      const b = input.rgba[offset + 2];
      const sampled = [r, g, b] as const;
      pixels.push(sampled);
      grid[sy * sampleWidth + sx] = sampled;
      const value = luminance(r, g, b);
      rowLuminance[sy] += value;
      rowSamples[sy] += 1;
      red += r;
      blue += b;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }
  if (pixels.length === 0) fail('Environment image contains no visible pixels.');

  const palette = [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)
    .map((bucket) => hex(
      Math.round(bucket.r / bucket.count),
      Math.round(bucket.g / bucket.count),
      Math.round(bucket.b / bucket.count),
    ));
  while (palette.length < 3) palette.push(palette[palette.length - 1] ?? '#000000');

  const rowAverage = rowLuminance.map((sum, index) => (
    rowSamples[index] === 0 ? 0 : sum / rowSamples[index]
  ));
  let horizonIndex = Math.floor(sampleHeight / 2);
  let strongestBandChange = -1;
  const start = Math.max(1, Math.floor(sampleHeight * 0.2));
  const end = Math.min(sampleHeight - 1, Math.ceil(sampleHeight * 0.8));
  for (let row = start; row <= end; row += 1) {
    const change = Math.abs(rowAverage[row] - rowAverage[row - 1]);
    if (change > strongestBandChange) {
      strongestBandChange = change;
      horizonIndex = row;
    }
  }

  let edgeCount = 0;
  let comparisonCount = 0;
  for (let sy = 0; sy < sampleHeight; sy += 1) {
    for (let sx = 0; sx < sampleWidth; sx += 1) {
      const index = sy * sampleWidth + sx;
      const current = grid[index];
      if (!current) continue;
      const currentLum = luminance(...current);
      const right = sx + 1 < sampleWidth ? grid[index + 1] : undefined;
      const below = sy + 1 < sampleHeight ? grid[index + sampleWidth] : undefined;
      for (const neighbor of [right, below]) {
        if (!neighbor) continue;
        comparisonCount += 1;
        if (Math.abs(currentLum - luminance(...neighbor)) >= 28) edgeCount += 1;
      }
    }
  }
  const edgeDensity = comparisonCount === 0 ? 0 : Math.round((edgeCount / comparisonCount) * 1000);
  const averageLuminance = Math.round(
    pixels.reduce((sum, [r, g, b]) => sum + luminance(r, g, b), 0) / pixels.length,
  );
  const bandValue = (from: number, to: number) => {
    const values = rowAverage.slice(from, Math.max(from + 1, to));
    return Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
  };
  const oneThird = Math.max(1, Math.floor(sampleHeight / 3));
  const verticalLuminance = Object.freeze([
    bandValue(0, oneThird),
    bandValue(oneThird, oneThird * 2),
    bandValue(oneThird * 2, sampleHeight),
  ]) as EnvironmentArtSignature['vertical_luminance'];
  const withoutDigest = Object.freeze({
    schema_version: '0.1.0' as const,
    palette: Object.freeze(palette),
    average_luminance: averageLuminance,
    vertical_luminance: verticalLuminance,
    horizon_y: Math.round((horizonIndex / Math.max(1, sampleHeight - 1)) * 1000),
    edge_density: edgeDensity,
    detail_scale: (edgeDensity < 100 ? 'coarse' : edgeDensity < 260 ? 'medium' : 'fine') as EnvironmentArtSignature['detail_scale'],
    temperature: (red - blue > pixels.length * 10
      ? 'warm'
      : blue - red > pixels.length * 10
        ? 'cool'
        : 'neutral') as EnvironmentArtSignature['temperature'],
  });
  return Object.freeze({
    ...withoutDigest,
    signature_sha256: await sha256(stableJson(withoutDigest)),
  });
}

export async function materializeEnvironmentArtSignature(
  value: unknown,
): Promise<EnvironmentArtSignature> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('Environment art signature must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expected = [
    'average_luminance', 'detail_scale', 'edge_density', 'horizon_y', 'palette',
    'schema_version', 'signature_sha256', 'temperature', 'vertical_luminance',
  ];
  if (Object.keys(record).sort().join(',') !== expected.sort().join(',')) {
    fail('Environment art signature contains undeclared fields.');
  }
  if (
    record.schema_version !== '0.1.0'
    || !Array.isArray(record.palette)
    || record.palette.length < 3
    || record.palette.length > 6
    || record.palette.some((color) => typeof color !== 'string' || !/^#[0-9a-f]{6}$/.test(color))
    || !Array.isArray(record.vertical_luminance)
    || record.vertical_luminance.length !== 3
    || record.vertical_luminance.some((number) => !Number.isSafeInteger(number) || number < 0 || number > 255)
    || !Number.isSafeInteger(record.average_luminance)
    || (record.average_luminance as number) < 0
    || (record.average_luminance as number) > 255
    || !Number.isSafeInteger(record.horizon_y)
    || (record.horizon_y as number) < 0
    || (record.horizon_y as number) > 1000
    || !Number.isSafeInteger(record.edge_density)
    || (record.edge_density as number) < 0
    || (record.edge_density as number) > 1000
    || !['coarse', 'medium', 'fine'].includes(record.detail_scale as string)
    || !['cool', 'neutral', 'warm'].includes(record.temperature as string)
    || typeof record.signature_sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(record.signature_sha256)
  ) {
    fail('Environment art signature is invalid.');
  }
  const candidate = {
    schema_version: '0.1.0' as const,
    palette: Object.freeze([...(record.palette as string[])]),
    average_luminance: record.average_luminance as number,
    vertical_luminance: Object.freeze([...(record.vertical_luminance as number[])]) as unknown as EnvironmentArtSignature['vertical_luminance'],
    horizon_y: record.horizon_y as number,
    edge_density: record.edge_density as number,
    detail_scale: record.detail_scale as EnvironmentArtSignature['detail_scale'],
    temperature: record.temperature as EnvironmentArtSignature['temperature'],
  };
  const expectedDigest = await sha256(stableJson(candidate));
  if (record.signature_sha256 !== expectedDigest) fail('Environment art signature digest is invalid.');
  return Object.freeze({ ...candidate, signature_sha256: expectedDigest });
}

export function environmentArtSeed(signature: EnvironmentArtSignature | undefined): string | undefined {
  if (!signature) return undefined;
  return JSON.stringify({
    palette: signature.palette,
    average_luminance: signature.average_luminance,
    vertical_luminance: signature.vertical_luminance,
    horizon_y: signature.horizon_y,
    edge_density: signature.edge_density,
    detail_scale: signature.detail_scale,
    temperature: signature.temperature,
  });
}
