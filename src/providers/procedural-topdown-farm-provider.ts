import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import {
  blitCharacterIdentityFrame,
  renderCharacterIdentityFrame,
} from '../adapters/canvas/render-character-identity-frame';
import {
  GENERATED_ASSET_BUNDLE_SCHEMA_VERSION,
  TOPDOWN_FARM_COMPLETENESS_POLICY,
  type AssetRoleBinding,
  type CharacterAnimationClip,
  type GeneratedAssetBundle,
  type GeneratedAssetKind,
} from '../core/generated-asset-bundle';
import type { GenerationRequestJobV2 } from '../core/generation-request-v2';
import type { CharacterIdentitySignature } from '../core/character-identity-signature';
import { environmentArtSeed } from '../core/environment-art-signature';
import type {
  GeneratedAssetFile,
  WorldAssetProvider,
  WorldAssetProviderOutput,
} from '../core/world-asset-provider';

type Color = readonly [number, number, number, number?];

class Surface {
  readonly pixels: Uint8Array;

  constructor(readonly width: number, readonly height: number, background: Color = [0, 0, 0, 0]) {
    this.pixels = new Uint8Array(width * height * 4);
    this.rect(0, 0, width, height, background);
  }

  pixel(x: number, y: number, color: Color): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 4;
    this.pixels.set([color[0], color[1], color[2], color[3] ?? 255], offset);
  }

  rect(x: number, y: number, width: number, height: number, color: Color): void {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) this.pixel(column, row, color);
    }
  }

  circle(cx: number, cy: number, radius: number, color: Color): void {
    for (let y = cy - radius; y <= cy + radius; y += 1) {
      for (let x = cx - radius; x <= cx + radius; x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) this.pixel(x, y, color);
      }
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Color): void {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let step = 0; step <= steps; step += 1) {
      this.pixel(Math.round(x1 + ((x2 - x1) * step) / steps), Math.round(y1 + ((y2 - y1) * step) / steps), color);
    }
  }
}

interface Palette {
  readonly grass: Color;
  readonly grassLight: Color;
  readonly water: Color;
  readonly waterLight: Color;
  readonly path: Color;
  readonly soil: Color;
  readonly leaf: Color;
  readonly leafLight: Color;
  readonly wood: Color;
  readonly roof: Color;
  readonly accent: Color;
  readonly skin: Color;
  readonly outfit: Color;
  readonly outline: Color;
}

function channel(hex: string, offset: number, minimum: number, span: number): number {
  return minimum + (Number.parseInt(hex.slice(offset, offset + 2), 16) % span);
}

function textFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hexColor(value: string): Color {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function paletteFor(job: GenerationRequestJobV2): Palette {
  const environment = job.request.references.find((reference) => reference.role === 'environment-style');
  const character = job.request.references.find((reference) => reference.role === 'character');
  const requestFingerprint = textFingerprint(`${job.request.seed}\n${job.request.description}`);
  const worldHash = `${requestFingerprint}${environmentArtSeed(job.environmentArt) ?? environment?.sha256 ?? '123456'.repeat(11)}`;
  const identityPalette = job.characterIdentity?.palette;
  // Preserve the published Alpha9 fallback exactly; new browser jobs carry the
  // decoded identity and therefore use only its palette and silhouette.
  const characterHash = job.characterIdentity
    ? character?.sha256 ?? 'abcdef'.repeat(11)
    : `${requestFingerprint.split('').reverse().join('')}${character?.sha256 ?? 'abcdef'.repeat(11)}`;
  const hueA = channel(worldHash, 0, 70, 70);
  const hueB = channel(worldHash, 2, 120, 90);
  return {
    grass: [54, hueA + 45, 65],
    grassLight: [86, Math.min(220, hueA + 75), 88],
    water: [42, 105, hueB],
    waterLight: [78, 155, Math.min(240, hueB + 35)],
    path: [190, 153, 94],
    soil: [112, 72, 49],
    leaf: [35, 112, 55],
    leafLight: [72, 164, 75],
    wood: [116, 71, 43],
    roof: [channel(worldHash, 4, 130, 90), 65, 55],
    accent: identityPalette ? hexColor(identityPalette.accent) : [channel(characterHash, 0, 150, 95), channel(characterHash, 2, 70, 130), channel(characterHash, 4, 80, 150)],
    skin: identityPalette ? hexColor(identityPalette.secondary) : [channel(characterHash, 6, 185, 55), channel(characterHash, 8, 135, 65), channel(characterHash, 10, 105, 60)],
    outfit: identityPalette ? hexColor(identityPalette.primary) : [channel(characterHash, 12, 45, 155), channel(characterHash, 14, 55, 150), channel(characterHash, 16, 70, 145)],
    outline: identityPalette ? hexColor(identityPalette.outline) : [35, 31, 38],
  };
}

function terrainAtlas(palette: Palette): Uint8Array {
  const image = new Surface(128, 32);
  image.rect(0, 0, 32, 32, palette.grass);
  for (let i = 0; i < 20; i += 1) image.pixel((i * 13) % 32, (i * 7) % 32, palette.grassLight);
  image.rect(32, 0, 32, 32, palette.water);
  for (let y = 5; y < 32; y += 8) image.line(35, y, 59, y, palette.waterLight);
  image.rect(64, 0, 32, 32, palette.path);
  for (let i = 0; i < 12; i += 1) image.pixel(66 + (i * 11) % 28, 2 + (i * 5) % 28, [145, 112, 70]);
  image.rect(96, 0, 32, 32, palette.soil);
  for (let x = 100; x < 128; x += 7) image.line(x, 3, x - 3, 29, [82, 51, 38]);
  return encodeRgbaPng(image.width, image.height, image.pixels);
}

function propsAtlas(palette: Palette): Uint8Array {
  const image = new Surface(192, 32);
  image.rect(14, 17, 5, 14, palette.wood);
  image.circle(16, 12, 11, palette.leaf);
  image.circle(11, 9, 6, palette.leafLight);
  image.circle(48, 21, 9, [105, 111, 119]);
  image.circle(45, 18, 4, [159, 163, 169]);
  image.rect(78, 18, 3, 12, [43, 125, 58]);
  image.circle(80, 15, 5, palette.accent);
  image.rect(96, 13, 32, 5, palette.wood);
  image.rect(101, 9, 4, 18, palette.wood);
  image.rect(119, 9, 4, 18, palette.wood);
  image.rect(130, 9, 4, 21, palette.wood);
  image.rect(154, 9, 4, 21, palette.wood);
  image.rect(130, 9, 28, 4, palette.wood);
  image.rect(166, 10, 22, 20, [143, 89, 49]);
  image.rect(169, 13, 16, 14, [181, 119, 61]);
  image.line(169, 13, 185, 27, palette.wood);
  image.line(185, 13, 169, 27, palette.wood);
  return encodeRgbaPng(image.width, image.height, image.pixels);
}

function structuresAtlas(palette: Palette): Uint8Array {
  const image = new Surface(128, 64);
  image.rect(5, 25, 54, 35, [225, 202, 156]);
  for (let y = 8; y < 28; y += 1) image.line(4 + y, y, 60 - y, y, palette.roof);
  image.rect(26, 40, 12, 20, palette.wood);
  image.rect(10, 35, 10, 10, palette.waterLight);
  image.rect(69, 23, 54, 37, [180, 66, 58]);
  for (let y = 7; y < 26; y += 1) image.line(68 + y, y, 124 - y, y, [104, 48, 51]);
  image.rect(86, 35, 20, 25, [235, 221, 183]);
  image.line(86, 35, 106, 60, palette.wood);
  image.line(106, 35, 86, 60, palette.wood);
  return encodeRgbaPng(image.width, image.height, image.pixels);
}

function cropsAtlas(palette: Palette): Uint8Array {
  const image = new Surface(128, 32);
  for (let stage = 0; stage < 4; stage += 1) {
    const origin = stage * 32;
    const stemHeight = 4 + stage * 5;
    image.rect(origin + 15, 29 - stemHeight, 2, stemHeight, [51, 133, 58]);
    if (stage > 0) image.circle(origin + 11, 25 - stage * 3, 3 + stage, palette.leafLight);
    if (stage > 1) image.circle(origin + 21, 22 - stage * 2, 3 + stage, palette.leaf);
    if (stage === 3) image.circle(origin + 16, 12, 5, palette.accent);
  }
  return encodeRgbaPng(image.width, image.height, image.pixels);
}

function drawCharacterFrame(image: Surface, x: number, y: number, direction: number, walking: boolean, frame: number, palette: Palette): void {
  const bob = walking && frame === 1 ? 1 : 0;
  image.circle(x + 16, y + 9 + bob, 7, palette.skin);
  image.rect(x + 10, y + 5 + bob, 12, 4, palette.accent);
  image.rect(x + 9, y + 15 + bob, 14, 11, palette.outfit);
  image.rect(x + 7, y + 17 + bob, 3, 8, palette.skin);
  image.rect(x + 23, y + 17 + bob, 3, 8, palette.skin);
  const stride = walking ? (frame === 0 ? 2 : -2) : 0;
  image.rect(x + 11 + stride, y + 26, 4, 5, palette.outline);
  image.rect(x + 18 - stride, y + 26, 4, 5, palette.outline);
  if (direction !== 0) {
    image.pixel(x + (direction === 2 ? 12 : 14), y + 10 + bob, palette.outline);
    image.pixel(x + (direction === 1 ? 20 : 18), y + 10 + bob, palette.outline);
  }
}

function characterAtlas(palette: Palette, identity?: CharacterIdentitySignature): Uint8Array {
  const image = new Surface(128, 128);
  if (identity) {
    const directions = ['north', 'east', 'south', 'west'] as const;
    const actions = ['idle', 'walk'] as const;
    for (let direction = 0; direction < directions.length; direction += 1) {
      for (let action = 0; action < actions.length; action += 1) {
        for (let frame = 0; frame < 2; frame += 1) {
          const rendered = renderCharacterIdentityFrame(identity, 'topdown-farm', {
            action: actions[action],
            direction: directions[direction],
            frame,
          });
          blitCharacterIdentityFrame(
            image.pixels,
            image.width,
            image.height,
            rendered,
            (action * 2 + frame) * 32,
            direction * 32,
          );
        }
      }
    }
    return encodeRgbaPng(image.width, image.height, image.pixels);
  }
  for (let direction = 0; direction < 4; direction += 1) {
    for (let action = 0; action < 2; action += 1) {
      for (let frame = 0; frame < 2; frame += 1) {
        drawCharacterFrame(image, (action * 2 + frame) * 32, direction * 32, direction, action === 1, frame, palette);
      }
    }
  }
  return encodeRgbaPng(image.width, image.height, image.pixels);
}

function previewImage(palette: Palette, identity?: CharacterIdentitySignature): Uint8Array {
  const image = new Surface(320, 180, palette.grass);
  image.rect(0, 118, 320, 62, palette.soil);
  image.rect(0, 82, 320, 18, palette.water);
  for (let x = 0; x < 320; x += 36) image.line(x, 90, x + 22, 90, palette.waterLight);
  image.rect(136, 0, 38, 180, palette.path);
  image.rect(25, 24, 72, 52, [225, 202, 156]);
  image.rect(218, 28, 76, 50, [180, 66, 58]);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 5; column += 1) image.circle(35 + column * 18, 132 + row * 14, 4, palette.leafLight);
  }
  if (identity) {
    const player = renderCharacterIdentityFrame(identity, 'topdown-farm', {
      action: 'idle', direction: 'south', frame: 0,
    });
    blitCharacterIdentityFrame(image.pixels, image.width, image.height, player, 160, 103);
  } else {
    image.circle(175, 116, 9, palette.accent);
  }
  return encodeRgbaPng(image.width, image.height, image.pixels);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

async function asset(
  id: string,
  kind: GeneratedAssetKind,
  path: string,
  mediaType: 'image/png' | 'application/json',
  bytes: Uint8Array,
  sourceReferenceIds: readonly string[],
  dimensions?: readonly [number, number],
) {
  return {
    record: {
      id, kind, path, mediaType, bytes: bytes.byteLength, sha256: await digest(bytes),
      ...(dimensions ? { width: dimensions[0], height: dimensions[1] } : {}), sourceReferenceIds,
    },
    file: { assetId: id, path, mediaType, bytes } satisfies GeneratedAssetFile,
  };
}

export async function generateProceduralTopdownFarm(job: GenerationRequestJobV2): Promise<WorldAssetProviderOutput> {
  const palette = paletteFor(job);
  const environmentId = job.request.references.find((reference) => reference.role === 'environment-style')?.id ?? '';
  const characterId = job.request.references.find((reference) => reference.role === 'character')?.id ?? '';
  const environmentSource = [environmentId];
  const characterSource = job.characterIdentity ? [characterId] : [environmentId, characterId];
  const previewSource = [environmentId, characterId];
  const mapWidth = 16;
  const mapHeight = 12;
  const scene = {
    schemaVersion: '0.1.0', map: { width: mapWidth, height: mapHeight, tileSize: 32 },
    layers: {
      ground: Array.from({ length: mapWidth * mapHeight }, () => 0),
      water: Array.from({ length: mapWidth * mapHeight }, (_, index) => Math.floor(index / mapWidth) === 5 ? 1 : -1),
      path: Array.from({ length: mapWidth * mapHeight }, (_, index) => index % mapWidth === 7 ? 2 : -1),
      soil: Array.from({ length: mapWidth * mapHeight }, (_, index) => Math.floor(index / mapWidth) > 7 && index % mapWidth < 6 ? 3 : -1),
    },
    props: [
      { role: 'prop.tree', cell: [2, 2] }, { role: 'prop.rock', cell: [12, 3] },
      { role: 'prop.flower', cell: [10, 7] }, { role: 'prop.fence', cell: [5, 9] },
      { role: 'prop.gate', cell: [7, 8] }, { role: 'prop.crate', cell: [11, 8] },
    ],
    structures: [{ role: 'structure.house', cell: [3, 3] }, { role: 'structure.barn', cell: [11, 2] }],
    crops: [1, 2, 3, 4].map((stage, index) => ({ role: `crop.basic.stage-${stage}`, cell: [1 + index, 9] })),
    spawn: { x: 8, y: 7 },
  };
  const collision = { schemaVersion: '0.1.0', coordinateSpace: 'map-cells', blocked: [[2, 2], [3, 3], [11, 2], [12, 3]] };
  const navigation = {
    schemaVersion: '0.1.0', coordinateSpace: 'map-pixels', agentRadiusPx: 10,
    outlines: [[[0, 0], [512, 0], [512, 384], [0, 384]]],
  };
  const generated = await Promise.all([
    asset('terrain-atlas', 'terrain-atlas', 'atlases/terrain.png', 'image/png', terrainAtlas(palette), environmentSource, [128, 32]),
    asset('props-atlas', 'prop-atlas', 'atlases/props.png', 'image/png', propsAtlas(palette), environmentSource, [192, 32]),
    asset('structures-atlas', 'structure-sprite', 'atlases/structures.png', 'image/png', structuresAtlas(palette), environmentSource, [128, 64]),
    asset('crops-atlas', 'crop-sprite', 'atlases/crops.png', 'image/png', cropsAtlas(palette), environmentSource, [128, 32]),
    asset('character-atlas', 'character-atlas', 'atlases/character.png', 'image/png', characterAtlas(palette, job.characterIdentity), characterSource, [128, 128]),
    asset('collision-map', 'collision-map', 'runtime/collision.json', 'application/json', jsonBytes(collision), environmentSource),
    asset('navigation-map', 'navigation-map', 'runtime/navigation.json', 'application/json', jsonBytes(navigation), environmentSource),
    asset('scene-data', 'scene-data', 'runtime/scene.json', 'application/json', jsonBytes(scene), environmentSource),
    asset('world-preview', 'preview', 'previews/world.png', 'image/png', previewImage(palette, job.characterIdentity), previewSource, [320, 180]),
  ]);
  const roleAsset: Record<string, string> = {
    'terrain.ground': 'terrain-atlas', 'terrain.water': 'terrain-atlas', 'terrain.path': 'terrain-atlas', 'terrain.soil': 'terrain-atlas',
    'prop.tree': 'props-atlas', 'prop.rock': 'props-atlas', 'prop.flower': 'props-atlas', 'prop.fence': 'props-atlas', 'prop.gate': 'props-atlas', 'prop.crate': 'props-atlas',
    'structure.house': 'structures-atlas', 'structure.barn': 'structures-atlas',
    'crop.basic.stage-1': 'crops-atlas', 'crop.basic.stage-2': 'crops-atlas', 'crop.basic.stage-3': 'crops-atlas', 'crop.basic.stage-4': 'crops-atlas',
    'character.player.atlas': 'character-atlas', 'world.collision': 'collision-map', 'world.navigation': 'navigation-map',
    'world.scene': 'scene-data', 'world.preview': 'world-preview',
  };
  const roles: AssetRoleBinding[] = Object.entries(roleAsset).map(([role, assetId]) => ({ role, assetId }));
  const clips: CharacterAnimationClip[] = (['idle', 'walk'] as const).flatMap((action, actionIndex) =>
    (['north', 'east', 'south', 'west'] as const).map((direction, directionIndex) => ({
      action, direction, fps: action === 'idle' ? 4 : 8,
      frames: [{ x: actionIndex * 64, y: directionIndex * 32 }, { x: actionIndex * 64 + 32, y: directionIndex * 32 }],
    })),
  );
  const bundle: GeneratedAssetBundle = {
    schemaVersion: GENERATED_ASSET_BUNDLE_SCHEMA_VERSION,
    jobId: job.request.id,
    profile: 'topdown-farm',
    completenessPolicy: TOPDOWN_FARM_COMPLETENESS_POLICY,
    assets: generated.map(({ record }) => record),
    roles,
    characters: [{ id: 'player', atlasAssetId: 'character-atlas', frameWidth: 32, frameHeight: 32, pivot: [16, 29], clips }],
    scene: {
      id: 'farm-scene', dataAssetId: 'scene-data', collisionAssetId: 'collision-map',
      navigationAssetId: 'navigation-map', previewAssetId: 'world-preview', spawn: { x: 8, y: 7 },
    },
  };
  return { bundle, files: generated.map(({ file }) => file) };
}

export const PROCEDURAL_TOPDOWN_FARM_PROVIDER: WorldAssetProvider = Object.freeze({
  id: 'mapsoo-procedural-topdown-farm',
  version: '0.1.0',
  displayName: 'Mapsoo Procedural Top-down Farm',
  capabilities: Object.freeze({
    execution: 'local' as const,
    determinism: 'seeded' as const,
    outputProvenance: 'procedural' as const,
    requiresCredentials: false,
    supportsAbort: true,
    supportedProfiles: Object.freeze(['topdown-farm'] as const),
    requiredReferenceRoles: Object.freeze(['environment-style', 'character'] as const),
    maxReferenceBytes: 16 * 1024 * 1024,
    maxOutputBytes: 128 * 1024 * 1024,
    maxRasterDimension: 8192,
  }),
  async generate(job: GenerationRequestJobV2, options?: { readonly signal?: AbortSignal }) {
    if (options?.signal?.aborted) throw new DOMException('Generation aborted.', 'AbortError');
    return generateProceduralTopdownFarm(job);
  },
});
