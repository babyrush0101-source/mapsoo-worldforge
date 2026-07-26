import type { WorldAssetProfile } from './asset-profile';

export const CHARACTER_IDENTITY_SIGNATURE_SCHEMA_VERSION = '0.1.0' as const;
export const CHARACTER_IDENTITY_PROJECTION_SCHEMA_VERSION = '0.1.0' as const;

const NORMALIZED_SIZE = 16;

export interface CharacterIdentityPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface CharacterIdentitySignature {
  readonly schema_version: typeof CHARACTER_IDENTITY_SIGNATURE_SCHEMA_VERSION;
  readonly normalized_size: readonly [16, 16];
  readonly silhouette_hex: string;
  readonly palette: Readonly<{
    readonly outline: string;
    readonly primary: string;
    readonly secondary: string;
    readonly accent: string;
  }>;
  readonly anchors: Readonly<{
    readonly head: readonly [number, number];
    readonly center: readonly [number, number];
    readonly foot: readonly [number, number];
    readonly left: readonly [number, number];
    readonly right: readonly [number, number];
  }>;
  readonly signature_sha256: string;
}

export interface CharacterIdentityProjection {
  readonly schema_version: typeof CHARACTER_IDENTITY_PROJECTION_SCHEMA_VERSION;
  readonly profile: WorldAssetProfile;
  readonly source_signature_sha256: string;
  readonly frame_size: readonly [number, number];
  readonly pivot: readonly [number, number];
  readonly anchors: CharacterIdentitySignature['anchors'];
}

export class CharacterIdentitySignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterIdentitySignatureError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has an invalid shape.`);
  }
}

function fail(message: string): never {
  throw new CharacterIdentitySignatureError(message);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) fail('Character identity contains a non-canonical value.');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function colorDistance(rgba: Uint8Array, offset: number, reference: readonly number[]): number {
  return Math.abs(rgba[offset] - reference[0])
    + Math.abs(rgba[offset + 1] - reference[1])
    + Math.abs(rgba[offset + 2] - reference[2]);
}

function foregroundMask(input: CharacterIdentityPixels): Uint8Array {
  const mask = new Uint8Array(input.width * input.height);
  let hasTransparency = false;
  for (let offset = 3; offset < input.rgba.byteLength; offset += 4) {
    if (input.rgba[offset] < 248) {
      hasTransparency = true;
      break;
    }
  }
  const corners = [
    pixelOffset(input.width, 0, 0),
    pixelOffset(input.width, input.width - 1, 0),
    pixelOffset(input.width, 0, input.height - 1),
    pixelOffset(input.width, input.width - 1, input.height - 1),
  ];
  const background = [0, 1, 2].map((channel) => (
    Math.round(corners.reduce((sum, offset) => sum + input.rgba[offset + channel], 0) / corners.length)
  ));
  let count = 0;
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const offset = pixelOffset(input.width, x, y);
      const foreground = hasTransparency
        ? input.rgba[offset + 3] >= 32
        : input.rgba[offset + 3] >= 32 && colorDistance(input.rgba, offset, background) >= 72;
      if (foreground) {
        mask[y * input.width + x] = 1;
        count += 1;
      }
    }
  }
  if (count >= Math.max(1, Math.floor(input.width * input.height * 0.005))) return mask;
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = input.rgba[index * 4 + 3] >= 32 ? 1 : 0;
  }
  return mask;
}

function bounds(mask: Uint8Array, width: number, height: number): readonly [number, number, number, number] {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) fail('Character reference contains no visible foreground pixels.');
  return [minX, minY, maxX, maxY];
}

function normalizeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  crop: readonly [number, number, number, number],
): Uint8Array {
  const normalized = new Uint8Array(NORMALIZED_SIZE * NORMALIZED_SIZE);
  const cropWidth = crop[2] - crop[0] + 1;
  const cropHeight = crop[3] - crop[1] + 1;
  for (let targetY = 0; targetY < NORMALIZED_SIZE; targetY += 1) {
    const sourceY0 = crop[1] + Math.floor(targetY * cropHeight / NORMALIZED_SIZE);
    const sourceY1 = crop[1] + Math.max(0, Math.ceil((targetY + 1) * cropHeight / NORMALIZED_SIZE) - 1);
    for (let targetX = 0; targetX < NORMALIZED_SIZE; targetX += 1) {
      const sourceX0 = crop[0] + Math.floor(targetX * cropWidth / NORMALIZED_SIZE);
      const sourceX1 = crop[0] + Math.max(0, Math.ceil((targetX + 1) * cropWidth / NORMALIZED_SIZE) - 1);
      let visible = 0;
      let sampled = 0;
      for (let y = sourceY0; y <= Math.min(sourceY1, height - 1); y += 1) {
        for (let x = sourceX0; x <= Math.min(sourceX1, width - 1); x += 1) {
          visible += mask[y * width + x];
          sampled += 1;
        }
      }
      if (visible > 0 && visible / Math.max(sampled, 1) >= 0.2) {
        normalized[targetY * NORMALIZED_SIZE + targetX] = 1;
      }
    }
  }
  return normalized;
}

function maskHex(mask: Uint8Array): string {
  let output = '';
  for (let offset = 0; offset < mask.length; offset += 4) {
    const nibble = (mask[offset] << 3)
      | (mask[offset + 1] << 2)
      | (mask[offset + 2] << 1)
      | mask[offset + 3];
    output += nibble.toString(16);
  }
  return output;
}

function quantizedHex(r: number, g: number, b: number): string {
  const quantize = (channel: number) => Math.min(255, (channel >> 4) * 16 + 8);
  return `#${[quantize(r), quantize(g), quantize(b)].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function palette(input: CharacterIdentityPixels, mask: Uint8Array): CharacterIdentitySignature['palette'] {
  const histogram = new Map<string, number>();
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const offset = index * 4;
    const color = quantizedHex(input.rgba[offset], input.rgba[offset + 1], input.rgba[offset + 2]);
    histogram.set(color, (histogram.get(color) ?? 0) + 1);
  }
  const colors = [...histogram]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([color, count]) => {
      const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
      const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      const saturation = Math.max(...rgb) - Math.min(...rgb);
      return { color, count, luminance, saturation };
    });
  if (colors.length === 0) fail('Character reference contains no palette pixels.');
  const primary = colors[0];
  const outline = [...colors].sort((a, b) => a.luminance - b.luminance || b.count - a.count)[0];
  const secondary = colors.find(({ color }) => color !== primary.color) ?? primary;
  const accent = [...colors].sort((a, b) => b.saturation - a.saturation || b.luminance - a.luminance)[0];
  return Object.freeze({
    outline: outline.color,
    primary: primary.color,
    secondary: secondary.color,
    accent: accent.color,
  });
}

function normalizedPoint(x: number, y: number): readonly [number, number] {
  return Object.freeze([
    Math.round(x / (NORMALIZED_SIZE - 1) * 1000),
    Math.round(y / (NORMALIZED_SIZE - 1) * 1000),
  ] as const);
}

function centroid(points: readonly (readonly [number, number])[]): readonly [number, number] {
  if (points.length === 0) return [500, 500];
  return normalizedPoint(
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  );
}

function anchors(mask: Uint8Array): CharacterIdentitySignature['anchors'] {
  const points: Array<readonly [number, number]> = [];
  for (let y = 0; y < NORMALIZED_SIZE; y += 1) {
    for (let x = 0; x < NORMALIZED_SIZE; x += 1) {
      if (mask[y * NORMALIZED_SIZE + x]) points.push([x, y]);
    }
  }
  if (points.length === 0) fail('Normalized character silhouette is empty.');
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  const headLimit = minY + Math.max(1, Math.floor((maxY - minY + 1) * 0.25));
  return Object.freeze({
    head: centroid(points.filter(([, y]) => y <= headLimit)),
    center: centroid(points),
    foot: centroid(points.filter(([, y]) => y === maxY)),
    left: centroid(points.filter(([x]) => x === minX)),
    right: centroid(points.filter(([x]) => x === maxX)),
  });
}

export async function extractCharacterIdentitySignature(
  input: CharacterIdentityPixels,
): Promise<CharacterIdentitySignature> {
  if (
    !Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height)
    || input.width < 1 || input.height < 1 || input.width > 8192 || input.height > 8192
    || !(input.rgba instanceof Uint8Array)
    || input.rgba.byteLength !== input.width * input.height * 4
  ) {
    fail('Character identity pixel input is invalid.');
  }
  const mask = foregroundMask(input);
  const normalized = normalizeMask(mask, input.width, input.height, bounds(mask, input.width, input.height));
  const base = Object.freeze({
    schema_version: CHARACTER_IDENTITY_SIGNATURE_SCHEMA_VERSION,
    normalized_size: Object.freeze([16, 16] as const),
    silhouette_hex: maskHex(normalized),
    palette: palette(input, mask),
    anchors: anchors(normalized),
  });
  return Object.freeze({ ...base, signature_sha256: await sha256(base) });
}

export async function materializeCharacterIdentitySignature(
  value: unknown,
): Promise<CharacterIdentitySignature> {
  if (!isRecord(value)) fail('Character identity signature must be an object.');
  exactKeys(
    value,
    ['schema_version', 'normalized_size', 'silhouette_hex', 'palette', 'anchors', 'signature_sha256'],
    'Character identity signature',
  );
  if (value.schema_version !== CHARACTER_IDENTITY_SIGNATURE_SCHEMA_VERSION) {
    fail(`Character identity signature schema must be ${CHARACTER_IDENTITY_SIGNATURE_SCHEMA_VERSION}.`);
  }
  if (
    !Array.isArray(value.normalized_size)
    || value.normalized_size.length !== 2
    || value.normalized_size[0] !== 16
    || value.normalized_size[1] !== 16
  ) {
    fail('Character identity normalized size must be 16×16.');
  }
  if (typeof value.silhouette_hex !== 'string' || !/^[a-f0-9]{64}$/.test(value.silhouette_hex)) {
    fail('Character identity silhouette is invalid.');
  }
  if (!isRecord(value.palette)) fail('Character identity palette must be an object.');
  const paletteValue = value.palette;
  exactKeys(paletteValue, ['outline', 'primary', 'secondary', 'accent'], 'Character identity palette');
  const normalizedPalette = Object.fromEntries(
    ['outline', 'primary', 'secondary', 'accent'].map((role) => {
      const color = paletteValue[role];
      if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/.test(color)) {
        fail(`Character identity ${role} color is invalid.`);
      }
      return [role, color];
    }),
  ) as unknown as CharacterIdentitySignature['palette'];
  if (!isRecord(value.anchors)) fail('Character identity anchors must be an object.');
  const anchorValue = value.anchors;
  exactKeys(anchorValue, ['head', 'center', 'foot', 'left', 'right'], 'Character identity anchors');
  const normalizedAnchors = Object.fromEntries(
    ['head', 'center', 'foot', 'left', 'right'].map((name) => {
      const point = anchorValue[name];
      if (
        !Array.isArray(point)
        || point.length !== 2
        || point.some((coordinate) => !Number.isSafeInteger(coordinate) || coordinate < 0 || coordinate > 1000)
      ) {
        fail(`Character identity ${name} anchor is invalid.`);
      }
      return [name, Object.freeze([point[0], point[1]] as const)];
    }),
  ) as unknown as CharacterIdentitySignature['anchors'];
  if (typeof value.signature_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature_sha256)) {
    fail('Character identity signature SHA-256 is invalid.');
  }
  const base = Object.freeze({
    schema_version: CHARACTER_IDENTITY_SIGNATURE_SCHEMA_VERSION,
    normalized_size: Object.freeze([16, 16] as const),
    silhouette_hex: value.silhouette_hex,
    palette: Object.freeze(normalizedPalette),
    anchors: Object.freeze(normalizedAnchors),
  });
  if (await sha256(base) !== value.signature_sha256) {
    fail('Character identity signature failed integrity verification.');
  }
  return Object.freeze({ ...base, signature_sha256: value.signature_sha256 });
}

const PROFILE_GEOMETRY = Object.freeze({
  'topdown-farm': Object.freeze({ frame: [32, 32] as const, pivot: [16, 29] as const }),
  'side-platformer': Object.freeze({ frame: [32, 64] as const, pivot: [16, 60] as const }),
  'isometric-action': Object.freeze({ frame: [48, 64] as const, pivot: [24, 58] as const }),
  'layered-depth-2d': Object.freeze({ frame: [48, 72] as const, pivot: [24, 67] as const }),
});

export function projectCharacterIdentity(
  signature: CharacterIdentitySignature,
  profile: WorldAssetProfile,
): CharacterIdentityProjection {
  const geometry = PROFILE_GEOMETRY[profile];
  if (!geometry) fail('Character identity projection profile is unsupported.');
  const project = ([x, y]: readonly [number, number]): readonly [number, number] => Object.freeze([
    Math.round(2 + x / 1000 * (geometry.frame[0] - 4)),
    Math.round(2 + y / 1000 * (geometry.pivot[1] - 3)),
  ] as const);
  return Object.freeze({
    schema_version: CHARACTER_IDENTITY_PROJECTION_SCHEMA_VERSION,
    profile,
    source_signature_sha256: signature.signature_sha256,
    frame_size: geometry.frame,
    pivot: geometry.pivot,
    anchors: Object.freeze({
      head: project(signature.anchors.head),
      center: project(signature.anchors.center),
      foot: project(signature.anchors.foot),
      left: project(signature.anchors.left),
      right: project(signature.anchors.right),
    }),
  });
}
