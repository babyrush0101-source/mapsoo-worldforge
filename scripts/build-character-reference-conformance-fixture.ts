import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import JSZip from 'jszip';

import { encodeRgbaPng } from '../src/adapters/canvas/encode-png';
import {
  renderCharacterIdentityFrame,
  type RenderedCharacterIdentityFrame,
} from '../src/adapters/canvas/render-character-identity-frame';
import type { BrowserReferenceImage } from '../src/adapters/read-reference-image-file';
import {
  extractCharacterIdentitySignature,
  type CharacterIdentityPixels,
} from '../src/core/character-identity-signature';
import {
  generateReferenceWorldPack,
  IMPLEMENTED_REFERENCE_WORLD_PROFILES,
  type ImplementedReferenceWorldProfile,
} from '../src/features/reference-world-generator/generate-reference-world-pack';
import { containsPrivateConsumerToken } from './lib/private-consumer-boundary.mjs';

const FIXTURE_ROOT = 'tests/fixtures/character-reference-conformance';
const REFERENCE_PATH = `${FIXTURE_ROOT}/reference-character.png`;
const CONTACT_SHEET_PATH = `${FIXTURE_ROOT}/four-profile-contact-sheet.png`;
const EVIDENCE_PATH = `${FIXTURE_ROOT}/evidence.json`;
const LICENSE_PATH = `${FIXTURE_ROOT}/license-assets.md`;
const FIXTURE_INVENTORY = Object.freeze([
  REFERENCE_PATH,
  CONTACT_SHEET_PATH,
  EVIDENCE_PATH,
  LICENSE_PATH,
] as const);
const WRITE = process.argv.includes('--write');
const FIXED_COMPLETED_AT = '2026-07-27T00:00:00.000Z';
const EMAIL_OR_ABSOLUTE =
  /@[a-z0-9.-]+\.[a-z]{2,}|\b[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var)\//i;
const CREDENTIAL_ASSIGNMENT =
  /\b(?:api[_-]?key|api[_-]?secret|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\r\n]+["']/i;

type Color = readonly [number, number, number, number];
interface RepresentativeFrame {
  readonly frame: RenderedCharacterIdentityFrame;
  readonly action: string;
  readonly direction: string;
  readonly manifestFrameIndex: number;
}
interface AtlasFrame {
  readonly frame: RenderedCharacterIdentityFrame;
  readonly atlasX: number;
  readonly atlasY: number;
}
interface ManifestFrame { readonly x: number; readonly y: number }
interface ManifestCharacter {
  readonly id: string;
  readonly atlas: string;
  readonly frame_size: readonly [number, number];
  readonly clips: readonly Readonly<{
    readonly action: string;
    readonly direction: string;
    readonly frames: readonly ManifestFrame[];
  }>[];
}
interface ManifestFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
interface PublicPackManifest {
  readonly character?: ManifestCharacter;
  readonly characters?: readonly ManifestCharacter[];
  readonly files: readonly ManifestFile[];
}
interface InspectedPack {
  readonly atlas: CharacterIdentityPixels;
  readonly atlasBytes: Uint8Array;
  readonly atlasPath: string;
  readonly frameOrigin: readonly [number, number];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function rgba(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

function setPixel(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: Color,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  pixels.set(color, (y * width + x) * 4);
}

function fillRect(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: Color,
): void {
  for (let targetY = y; targetY < y + rectHeight; targetY += 1) {
    for (let targetX = x; targetX < x + rectWidth; targetX += 1) {
      setPixel(pixels, width, height, targetX, targetY, color);
    }
  }
}

function buildCharacterReference(): CharacterIdentityPixels {
  const width = 64;
  const height = 96;
  const pixels = rgba(width, height);
  const outline: Color = [24, 30, 42, 255];
  const hair: Color = [35, 43, 57, 255];
  const skin: Color = [224, 166, 116, 255];
  const coat: Color = [126, 44, 82, 255];
  const coatLight: Color = [170, 67, 103, 255];
  const scarf: Color = [230, 166, 48, 255];
  const trousers: Color = [42, 55, 70, 255];
  const leather: Color = [112, 70, 40, 255];

  fillRect(pixels, width, height, 20, 8, 25, 7, outline);
  fillRect(pixels, width, height, 16, 14, 33, 12, hair);
  fillRect(pixels, width, height, 20, 24, 25, 21, skin);
  fillRect(pixels, width, height, 16, 18, 8, 12, hair);
  fillRect(pixels, width, height, 41, 18, 8, 10, hair);
  fillRect(pixels, width, height, 21, 43, 26, 8, scarf);
  fillRect(pixels, width, height, 43, 47, 12, 7, scarf);
  fillRect(pixels, width, height, 17, 51, 32, 25, outline);
  fillRect(pixels, width, height, 20, 53, 26, 21, coat);
  fillRect(pixels, width, height, 22, 55, 8, 17, coatLight);
  fillRect(pixels, width, height, 12, 55, 9, 20, coat);
  fillRect(pixels, width, height, 47, 55, 9, 20, coat);
  fillRect(pixels, width, height, 50, 57, 11, 17, leather);
  fillRect(pixels, width, height, 22, 75, 9, 14, trousers);
  fillRect(pixels, width, height, 36, 75, 9, 14, trousers);
  fillRect(pixels, width, height, 18, 88, 14, 6, leather);
  fillRect(pixels, width, height, 35, 88, 14, 6, leather);

  setPixel(pixels, width, height, 27, 33, [20, 25, 34, 255]);
  setPixel(pixels, width, height, 38, 33, [20, 25, 34, 255]);
  return Object.freeze({ width, height, rgba: pixels });
}

function buildEnvironmentReference(): CharacterIdentityPixels {
  const width = 64;
  const height = 64;
  const pixels = rgba(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const horizon = y < 30;
      const noise = (x * 17 + y * 29) % 19;
      setPixel(
        pixels,
        width,
        height,
        x,
        y,
        horizon
          ? [66 + noise, 108 + noise, 154 + noise, 255]
          : [52 + noise, 116 + noise, 67 + noise, 255],
      );
    }
  }
  fillRect(pixels, width, height, 0, 29, 64, 4, [211, 164, 72, 255]);
  return Object.freeze({ width, height, rgba: pixels });
}

async function browserReference(
  role: 'environment-style' | 'character',
  pixels: CharacterIdentityPixels,
): Promise<BrowserReferenceImage> {
  const bytes = encodeRgbaPng(pixels.width, pixels.height, pixels.rgba);
  const path = role === 'character'
    ? 'fixtures/character-reference/reference-character.png'
    : 'fixtures/character-reference/environment-style.png';
  return Object.freeze({
    role,
    descriptor: Object.freeze({
      id: `${role}-public-conformance`,
      role,
      path,
      mediaType: 'image/png' as const,
      byteLength: bytes.byteLength,
      width: pixels.width,
      height: pixels.height,
      sha256: sha256(bytes),
      rights: Object.freeze({
        basis: 'owned' as const,
        license: 'LicenseRef-User-Owned',
        allowGenerativeAdaptation: true,
        allowOutputRedistribution: true,
        allowOutputCc0Dedication: true,
      }),
    }),
    bytes,
  });
}

const GLYPHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
});

function label(
  target: Uint8Array,
  targetWidth: number,
  targetHeight: number,
  value: string,
  x: number,
  y: number,
): void {
  const color: Color = [225, 232, 245, 255];
  let cursor = x;
  for (const character of value) {
    const glyph = GLYPHS[character];
    if (!glyph) {
      cursor += 4;
      continue;
    }
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === '1') {
          fillRect(target, targetWidth, targetHeight, cursor + column * 2, y + row * 2, 2, 2, color);
        }
      }
    }
    cursor += 12;
  }
}

function blitScaled(
  target: Uint8Array,
  targetWidth: number,
  targetHeight: number,
  source: CharacterIdentityPixels | RenderedCharacterIdentityFrame,
  x: number,
  y: number,
  scale: number,
): void {
  for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
      const offset = (sourceY * source.width + sourceX) * 4;
      const sourcePixels = 'pixels' in source ? source.pixels : source.rgba;
      if (sourcePixels[offset + 3] === 0) continue;
      const color = sourcePixels.slice(offset, offset + 4) as unknown as Color;
      fillRect(
        target,
        targetWidth,
        targetHeight,
        x + sourceX * scale,
        y + sourceY * scale,
        scale,
        scale,
        color,
      );
    }
  }
}

function buildContactSheet(
  reference: CharacterIdentityPixels,
  frames: Readonly<Record<ImplementedReferenceWorldProfile, RenderedCharacterIdentityFrame>>,
): Uint8Array {
  const width = 760;
  const height = 286;
  const pixels = rgba(width, height);
  fillRect(pixels, width, height, 0, 0, width, height, [10, 17, 29, 255]);
  const panels = [
    { label: 'REFERENCE', x: 16, width: 144 },
    { label: 'FARM', x: 172, width: 112 },
    { label: 'SIDE', x: 296, width: 112 },
    { label: 'ISO', x: 420, width: 144 },
    { label: 'DEPTH', x: 576, width: 168 },
  ];
  for (const panel of panels) {
    fillRect(pixels, width, height, panel.x, 18, panel.width, 250, [24, 36, 55, 255]);
    label(pixels, width, height, panel.label, panel.x + 10, 28);
  }
  blitScaled(pixels, width, height, reference, 24, 68, 2);
  blitScaled(pixels, width, height, frames['topdown-farm'], 180, 116, 3);
  blitScaled(pixels, width, height, frames['side-platformer'], 304, 68, 3);
  blitScaled(pixels, width, height, frames['isometric-action'], 420, 68, 3);
  blitScaled(pixels, width, height, frames['layered-depth-2d'], 584, 50, 3);
  return encodeRgbaPng(width, height, pixels);
}

function containsColor(bytes: Uint8Array, hex: string): boolean {
  const expected = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    if (
      bytes[offset] === expected[0]
      && bytes[offset + 1] === expected[1]
      && bytes[offset + 2] === expected[2]
      && bytes[offset + 3] > 0
    ) return true;
  }
  return false;
}

function frameMatchesAtlas(
  atlas: CharacterIdentityPixels,
  representative: AtlasFrame,
): boolean {
  const { frame, atlasX, atlasY } = representative;
  if (
    atlasX < 0
    || atlasY < 0
    || atlasX + frame.width > atlas.width
    || atlasY + frame.height > atlas.height
  ) return false;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const frameOffset = (y * frame.width + x) * 4;
      const atlasOffset = ((atlasY + y) * atlas.width + atlasX + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        if (frame.pixels[frameOffset + channel] !== atlas.rgba[atlasOffset + channel]) {
          return false;
        }
      }
    }
  }
  return true;
}

function byteSequenceIndex(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return -1;
  outer: for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function parseManifest(bytes: Uint8Array, profile: ImplementedReferenceWorldProfile): PublicPackManifest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${profile} pack manifest is not valid JSON.`);
  }
  if (!value || typeof value !== 'object') throw new Error(`${profile} manifest must be an object.`);
  const manifest = value as Partial<PublicPackManifest>;
  if (!Array.isArray(manifest.files)) throw new Error(`${profile} manifest has no files inventory.`);
  return manifest as PublicPackManifest;
}

function playerCharacter(
  manifest: PublicPackManifest,
  profile: ImplementedReferenceWorldProfile,
): ManifestCharacter {
  const candidate = manifest.character
    ?? manifest.characters?.find(({ id }) => id === 'player');
  if (
    !candidate
    || typeof candidate.atlas !== 'string'
    || !Array.isArray(candidate.frame_size)
    || candidate.frame_size.length !== 2
    || !Array.isArray(candidate.clips)
  ) throw new Error(`${profile} manifest has no valid player character record.`);
  return candidate;
}

async function inspectPack(
  packBytes: Uint8Array,
  profile: ImplementedReferenceWorldProfile,
  representative: RepresentativeFrame,
  forbiddenValues: readonly Uint8Array[],
  rawReferences: readonly Uint8Array[],
): Promise<InspectedPack> {
  const zip = await JSZip.loadAsync(packBytes);
  const entries = Object.values(zip.files).filter(({ dir }) => !dir);
  const manifestEntries = entries.filter(({ name }) => name.endsWith('/mapsoo.manifest.json'));
  if (manifestEntries.length !== 1) {
    throw new Error(`${profile} pack must contain exactly one mapsoo.manifest.json.`);
  }
  const manifestBytes = await manifestEntries[0].async('uint8array');
  const manifest = parseManifest(manifestBytes, profile);
  const character = playerCharacter(manifest, profile);
  const clip = character.clips.find(({ action, direction }) => (
    action === representative.action && direction === representative.direction
  ));
  const origin = clip?.frames[representative.manifestFrameIndex];
  if (
    !origin
    || !Number.isSafeInteger(origin.x)
    || !Number.isSafeInteger(origin.y)
    || character.frame_size[0] !== representative.frame.width
    || character.frame_size[1] !== representative.frame.height
  ) throw new Error(`${profile} manifest does not declare the representative frame.`);

  const root = manifestEntries[0].name.slice(0, -'mapsoo.manifest.json'.length);
  const atlasEntryName = `${root}${character.atlas}`;
  const atlasEntry = zip.file(atlasEntryName);
  if (!atlasEntry) throw new Error(`${profile} pack is missing manifest atlas ${character.atlas}.`);
  const atlas = await atlasEntry.async('uint8array');
  const atlasRecord = manifest.files.find(({ path }) => path === character.atlas);
  if (
    !atlasRecord
    || atlasRecord.bytes !== atlas.byteLength
    || atlasRecord.sha256 !== sha256(atlas)
  ) throw new Error(`${profile} manifest atlas integrity record is invalid.`);

  for (const entry of entries) {
    const bytes = await entry.async('uint8array');
    if (rawReferences.some((reference) => byteSequenceIndex(bytes, reference) >= 0)) {
      throw new Error(`${profile} pack contains raw reference bytes in ${entry.name}.`);
    }
    if (forbiddenValues.some((value) => byteSequenceIndex(bytes, value) >= 0)) {
      throw new Error(`${profile} pack leaks private reference metadata in ${entry.name}.`);
    }
  }

  const decodedAtlas = await import('../src/adapters/decode-reference-image-rgba')
    .then(({ decodeReferenceImageRgba }) => decodeReferenceImageRgba(atlas, 'image/png'));
  return Object.freeze({
    atlas: decodedAtlas,
    atlasBytes: atlas,
    atlasPath: character.atlas,
    frameOrigin: Object.freeze([origin.x, origin.y] as const),
  });
}

function pngChunkTypes(bytes: Uint8Array): readonly string[] {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new Error('Fixture PNG has an invalid signature.');
  }
  const chunks: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = (
      bytes[offset] * 0x1000000
      + bytes[offset + 1] * 0x10000
      + bytes[offset + 2] * 0x100
      + bytes[offset + 3]
    );
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
    chunks.push(type);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (offset !== bytes.byteLength || chunks.at(-1) !== 'IEND') {
    throw new Error('Fixture PNG chunk stream is malformed.');
  }
  return Object.freeze(chunks);
}

async function fixtureFiles(path: string): Promise<readonly string[]> {
  const absoluteRoot = resolve(path);
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        found.push(`${FIXTURE_ROOT}/${relative(absoluteRoot, absolute).replaceAll('\\', '/')}`);
      } else {
        throw new Error(`Fixture inventory contains unsupported entry ${entry.name}.`);
      }
    }
  }
  await visit(absoluteRoot);
  return found.sort();
}

async function assertFixtureInventory(): Promise<void> {
  const expected = [...FIXTURE_INVENTORY].sort();
  const actual = await fixtureFiles(FIXTURE_ROOT);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Fixture inventory mismatch: expected ${expected.join(', ')}, got ${actual.join(', ')}.`);
  }
}

async function assertFixtureTextPrivacy(): Promise<void> {
  for (const path of [EVIDENCE_PATH, LICENSE_PATH]) {
    const text = await readFile(resolve(path), 'utf8');
    if (
      containsPrivateConsumerToken(text)
      || EMAIL_OR_ABSOLUTE.test(text)
      || CREDENTIAL_ASSIGNMENT.test(text)
    ) throw new Error(`${path} crosses the public fixture privacy boundary.`);
  }
}

async function output(path: string, bytes: Uint8Array): Promise<void> {
  const absolute = resolve(path);
  if (WRITE) {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    return;
  }
  const expected = await readFile(absolute);
  if (!expected.equals(Buffer.from(bytes))) {
    throw new Error(`${path} is stale; run pnpm character:fixture:build.`);
  }
}

const characterPixels = buildCharacterReference();
const environmentPixels = buildEnvironmentReference();
const character = await browserReference('character', characterPixels);
const environment = await browserReference('environment-style', environmentPixels);
const signature = await extractCharacterIdentitySignature(characterPixels);
const representatives: Readonly<Record<ImplementedReferenceWorldProfile, RepresentativeFrame>> = Object.freeze({
  'topdown-farm': Object.freeze({
    frame: renderCharacterIdentityFrame(signature, 'topdown-farm', {
      action: 'walk', direction: 'south', frame: 1,
    }),
    action: 'walk',
    direction: 'south',
    manifestFrameIndex: 1,
  }),
  'side-platformer': Object.freeze({
    frame: renderCharacterIdentityFrame(signature, 'side-platformer', {
      action: 'run', direction: 'right', frame: 1,
    }),
    action: 'run',
    direction: 'right',
    manifestFrameIndex: 0,
  }),
  'isometric-action': Object.freeze({
    frame: renderCharacterIdentityFrame(signature, 'isometric-action', {
      action: 'move', direction: 'east', frame: 3,
    }),
    action: 'move',
    direction: 'east',
    manifestFrameIndex: 0,
  }),
  'layered-depth-2d': Object.freeze({
    frame: renderCharacterIdentityFrame(signature, 'layered-depth-2d', {
      action: 'walk', direction: 'right', frame: 2,
    }),
    action: 'walk',
    direction: 'right',
    manifestFrameIndex: 0,
  }),
});
const frames = Object.freeze(Object.fromEntries(
  IMPLEMENTED_REFERENCE_WORLD_PROFILES.map((profile) => [profile, representatives[profile].frame]),
) as Record<ImplementedReferenceWorldProfile, RenderedCharacterIdentityFrame>);
const forbiddenPackValues = Object.freeze([
  character.descriptor.path,
  environment.descriptor.path,
  character.descriptor.sha256,
  environment.descriptor.sha256,
  character.descriptor.id,
  environment.descriptor.id,
  'reference-character.png',
  'environment-style.png',
  'A public synthetic identity-conformance world.',
].map((value) => new TextEncoder().encode(value)));
const rawReferences = Object.freeze([character.bytes, environment.bytes]);

const builds = await Promise.all(IMPLEMENTED_REFERENCE_WORLD_PROFILES.map(async (profile) => {
  const build = await generateReferenceWorldPack({
    profile,
    environment,
    character,
    worldId: `character-conformance-${profile}`,
    description: 'A public synthetic identity-conformance world.',
    seed: 'character-conformance-seed',
    completedAt: FIXED_COMPLETED_AT,
  });
  const inspected = await inspectPack(
    build.pack.bytes,
    profile,
    representatives[profile],
    forbiddenPackValues,
    rawReferences,
  );
  const paletteBound = Object.values(signature.palette).every((color) => (
    containsColor(inspected.atlas.rgba, color)
  ));
  const representativeFrameExact = frameMatchesAtlas(
    inspected.atlas,
    Object.freeze({
      ...representatives[profile],
      atlasX: inspected.frameOrigin[0],
      atlasY: inspected.frameOrigin[1],
    }),
  );
  if (
    !paletteBound
    || !representativeFrameExact
    || build.characterIdentitySignatureSha256 !== signature.signature_sha256
  ) {
    throw new Error(`${profile} failed the character identity binding.`);
  }
  return Object.freeze({
    profile,
    pack_schema_version: build.packSchemaVersion,
    clip_count: build.characterClipCount,
    pack_sha256: sha256(build.pack.bytes),
    atlas_path: inspected.atlasPath,
    atlas_sha256: sha256(inspected.atlasBytes),
    palette_bound: paletteBound,
    representative_frame_exact: representativeFrameExact,
    representative_frame_origin: inspected.frameOrigin,
    projected_frame_size: frames[profile].projection.frame_size,
  });
}));

const referenceBytes = character.bytes;
const contactSheetBytes = buildContactSheet(characterPixels, frames);
for (const png of [referenceBytes, contactSheetBytes]) {
  const chunks = pngChunkTypes(png);
  if (chunks.some((chunk) => !['IHDR', 'IDAT', 'IEND'].includes(chunk))) {
    throw new Error(`Fixture PNG contains metadata or unsupported chunks: ${chunks.join(', ')}.`);
  }
}
const licenseBytes = Buffer.from(
  '# Fixture asset license\n\n'
    + 'The deterministic reference character, contact sheet, and generated visual '
    + 'fixture data in this directory are dedicated to the public domain under '
    + '[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).\n',
);
const evidence = Object.freeze({
  schema_version: 'mapsoo-character-reference-conformance/1.0',
  status: 'synthetic-conformance-pass',
  distribution: 'public',
  license: 'CC0-1.0',
  license_notice: LICENSE_PATH,
  fixture_inventory: FIXTURE_INVENTORY,
  fixture_provenance: Object.freeze({
    reference_character: 'drawn from zero by deterministic rectangle and pixel operations in this fixture script',
    environment_reference: 'drawn from zero by deterministic pixel operations in this fixture script',
    contact_sheet_labels: 'drawn from the fixture script embedded bitmap glyphs',
    png_chunks_allowed: Object.freeze(['IHDR', 'IDAT', 'IEND']),
  }),
  zip_privacy_checks: Object.freeze([
    'raw character and environment reference bytes are absent',
    'reference paths, source filenames, descriptor IDs, and reference SHA-256 values are absent',
    'the private free-text generation description is absent',
  ]),
  reference: Object.freeze({
    path: REFERENCE_PATH,
    media_type: 'image/png',
    width: characterPixels.width,
    height: characterPixels.height,
    sha256: sha256(referenceBytes),
    origin: 'deterministic synthetic fixture',
  }),
  identity: Object.freeze({
    signature_sha256: signature.signature_sha256,
    normalized_size: signature.normalized_size,
    palette: signature.palette,
    anchors: signature.anchors,
  }),
  profiles: builds,
  contact_sheet: Object.freeze({
    path: CONTACT_SHEET_PATH,
    width: 760,
    height: 286,
    sha256: sha256(contactSheetBytes),
    order: ['reference', ...IMPLEMENTED_REFERENCE_WORLD_PROFILES],
  }),
  proves: Object.freeze([
    'the actual PNG decoder reads a nontrivial 64x96 character reference',
    'one local-only identity signature drives all four implemented profile generators',
    'all four complete ZIP pipelines contain an exact representative projected frame and all palette roles in their player atlas',
    'the fixture is deterministic and contains no private reference or consumer data',
  ]),
  does_not_prove: Object.freeze([
    'semantic recognition of facial identity, costume parts, species, or named traits',
    'semantic identity or motion continuity across every direction and animation frame',
    'model-generated production art quality from an arbitrary reference',
    'human approval, public rights for user-supplied references, or Raspberry Pi performance',
  ]),
});
const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);

await output(REFERENCE_PATH, referenceBytes);
await output(CONTACT_SHEET_PATH, contactSheetBytes);
await output(LICENSE_PATH, licenseBytes);
await output(EVIDENCE_PATH, evidenceBytes);
await assertFixtureInventory();
await assertFixtureTextPrivacy();

console.log(
  `MAPSOO_CHARACTER_REFERENCE_CONFORMANCE_OK mode=${WRITE ? 'write' : 'verify'}`
    + ` identity=${signature.signature_sha256}`
    + ` reference=${sha256(referenceBytes)} contact=${sha256(contactSheetBytes)}`
    + ` profiles=${builds.length}`,
);
