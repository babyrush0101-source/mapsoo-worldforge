import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import {
  blitCharacterIdentityFrame,
  renderCharacterIdentityFrame,
} from '../adapters/canvas/render-character-identity-frame';
import type {
  AssetRoleBinding,
  CharacterAction,
  CharacterAnimationClip,
  GeneratedAssetBundle,
  GeneratedAssetKind,
} from '../core/generated-asset-bundle';
import type { GenerationRequestJobV2 } from '../core/generation-request-v2';
import { environmentArtSeed } from '../core/environment-art-signature';
import {
  LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION,
  LAYERED_DEPTH_COMPLETENESS_POLICY,
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
  LAYERED_DEPTH_REQUIRED_ROLES,
} from '../core/layered-depth-asset-bundle';
import {
  ALPHA12_LAYER_IDS,
  ALPHA12_RUNTIME_SCHEMA_VERSION,
  type Alpha12CollisionSidecar,
  type Alpha12NavigationSidecar,
  type Alpha12SceneSidecar,
} from '../core/pack-manifest-alpha12';
import type {
  GeneratedAssetFile,
  WorldAssetProvider,
  WorldAssetProviderOutput,
} from '../core/world-asset-provider';

type Color = readonly [number, number, number, number?];

class Surface {
  readonly pixels: Uint8Array;

  constructor(readonly width: number, readonly height: number, color: Color = [0, 0, 0, 0]) {
    this.pixels = new Uint8Array(width * height * 4);
    this.rect(0, 0, width, height, color);
  }

  pixel(x: number, y: number, color: Color): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels.set([color[0], color[1], color[2], color[3] ?? 255], (y * this.width + x) * 4);
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
      this.pixel(
        Math.round(x1 + ((x2 - x1) * step) / steps),
        Math.round(y1 + ((y2 - y1) * step) / steps),
        color,
      );
    }
  }
}

function fingerprint(value: string): number {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function color(hash: number, shift = 0, minimum = 40, span = 176, alpha = 255): Color {
  return [
    minimum + ((hash >>> shift) % span),
    minimum + ((hash >>> (shift + 6)) % span),
    minimum + ((hash >>> (shift + 13)) % span),
    alpha,
  ];
}

function png(width: number, height: number, draw: (surface: Surface) => void): Uint8Array {
  const surface = new Surface(width, height);
  draw(surface);
  return encodeRgbaPng(width, height, surface.pixels);
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function asset(
  id: string,
  kind: GeneratedAssetKind,
  path: string,
  bytes: Uint8Array,
  sourceReferenceIds: readonly string[],
  dimensions?: readonly [number, number],
) {
  const mediaType = dimensions ? 'image/png' as const : 'application/json' as const;
  return {
    record: {
      id,
      kind,
      path,
      mediaType,
      bytes: bytes.byteLength,
      sha256: await digest(bytes),
      ...(dimensions ? { width: dimensions[0], height: dimensions[1] } : {}),
      sourceReferenceIds,
    },
    file: { assetId: id, path, mediaType, bytes } satisfies GeneratedAssetFile,
  };
}

function drawGenericCharacter(
  surface: Surface,
  originX: number,
  body: Color,
  accent: Color,
  outline: Color,
  action: CharacterAction,
  direction: 'left' | 'right' | 'near' | 'far',
): void {
  const active = action === 'walk' || action === 'run';
  const bob = active ? -1 : 0;
  const hurt = action === 'interact' || action === 'talk' ? (direction === 'left' ? -1 : 1) : 0;
  const facing = direction === 'left' ? -1 : 1;
  surface.circle(originX + 24 + hurt, 14 + bob, 9, body);
  surface.rect(originX + 15 + hurt, 23 + bob, 18, 31, body);
  surface.rect(originX + 11 + hurt, 28 + bob, 5, 18, accent);
  surface.rect(originX + 32 + hurt, 28 + bob, 5, 18, accent);
  surface.rect(originX + 16 + hurt + (active ? facing : 0), 54, 6, 13, outline);
  surface.rect(originX + 27 + hurt - (active ? facing : 0), 54, 6, 13, outline);
  if (direction === 'near') {
    surface.rect(originX + 16, 13 + bob, 4, 3, accent);
    surface.rect(originX + 28, 13 + bob, 4, 3, accent);
  } else if (direction !== 'far') {
    surface.rect(originX + (direction === 'left' ? 12 : 31), 13 + bob, 5, 3, accent);
  }
}

function characterAtlas(
  job: GenerationRequestJobV2,
  id: 'player' | 'npc',
  worldHash: number,
  characterHash: number,
): Uint8Array {
  const actions = id === 'player' ? LAYERED_DEPTH_PLAYER_ACTIONS : LAYERED_DEPTH_NPC_ACTIONS;
  return png(actions.length * LAYERED_DEPTH_DIRECTIONS.length * 48, 72, (surface) => {
    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      for (let directionIndex = 0; directionIndex < LAYERED_DEPTH_DIRECTIONS.length; directionIndex += 1) {
        const x = (actionIndex * LAYERED_DEPTH_DIRECTIONS.length + directionIndex) * 48;
        const direction = LAYERED_DEPTH_DIRECTIONS[directionIndex];
        if (id === 'player' && job.characterIdentity) {
          const frame = renderCharacterIdentityFrame(job.characterIdentity, 'layered-depth-2d', {
            action: actions[actionIndex],
            direction,
            frame: actionIndex + directionIndex,
          });
          blitCharacterIdentityFrame(surface.pixels, surface.width, surface.height, frame, x, 0);
        } else {
          const identityHash = id === 'player' ? characterHash : worldHash;
          drawGenericCharacter(
            surface,
            x,
            color(identityHash, id === 'player' ? 1 : 8),
            color(identityHash, id === 'player' ? 7 : 15),
            [22, 25, 36],
            actions[actionIndex],
            direction,
          );
        }
      }
    }
  });
}

function clips(actions: readonly CharacterAction[]): CharacterAnimationClip[] {
  return actions.flatMap((action, actionIndex) =>
    LAYERED_DEPTH_DIRECTIONS.map((direction, directionIndex) => ({
      action,
      direction,
      fps: action === 'idle' ? 4 : action === 'run' ? 10 : 7,
      frames: [{
        x: (actionIndex * LAYERED_DEPTH_DIRECTIONS.length + directionIndex) * 48,
        y: 0,
      }],
    })));
}

function preview(worldHash: number, job: GenerationRequestJobV2): Uint8Array {
  return png(640, 360, (surface) => {
    const sky = color(worldHash, 1, 18, 92);
    const glow = color(worldHash, 9, 92, 128);
    surface.rect(0, 0, 640, 360, sky);
    surface.circle(510, 72, 42, glow);
    for (let ridge = 0; ridge < 8; ridge += 1) {
      const x = ridge * 92 - 30;
      surface.line(x, 230, x + 62, 118 + (ridge % 3) * 17, color(worldHash, ridge + 4, 28, 92));
      surface.line(x + 62, 118 + (ridge % 3) * 17, x + 132, 230, color(worldHash, ridge + 4, 28, 92));
    }
    surface.rect(0, 245, 640, 115, color(worldHash, 14, 38, 92));
    surface.rect(0, 288, 640, 72, [24, 27, 38]);
    for (let column = 0; column < 7; column += 1) {
      const x = 36 + column * 102;
      surface.rect(x, 176 + (column % 2) * 18, 18, 112, color(worldHash, 3 + column, 42, 104));
      surface.circle(x + 9, 166 + (column % 2) * 18, 18, color(worldHash, 10 + column, 52, 126));
    }
    surface.rect(468, 230, 54, 58, color(worldHash, 18));
    surface.rect(482, 246, 26, 42, [28, 31, 43]);
    const npc = new Surface(48, 72);
    drawGenericCharacter(npc, 0, color(worldHash, 8), color(worldHash, 15), [22, 25, 36], 'idle', 'near');
    for (let y = 0; y < npc.height; y += 1) {
      for (let x = 0; x < npc.width; x += 1) {
        const offset = (y * npc.width + x) * 4;
        if (npc.pixels[offset + 3] !== 0) {
          surface.pixels.set(npc.pixels.subarray(offset, offset + 4), ((216 + y) * 640 + 384 + x) * 4);
        }
      }
    }
    if (job.characterIdentity) {
      const player = renderCharacterIdentityFrame(job.characterIdentity, 'layered-depth-2d', {
        action: 'idle',
        direction: 'near',
        frame: 0,
      });
      blitCharacterIdentityFrame(surface.pixels, surface.width, surface.height, player, 176, 216);
    }
    surface.rect(0, 0, 640, 20, [10, 12, 20, 180]);
    surface.rect(0, 340, 640, 20, [10, 12, 20, 180]);
  });
}

export async function generateProceduralLayeredDepth(
  job: GenerationRequestJobV2,
): Promise<WorldAssetProviderOutput> {
  const environment = job.request.references.find(({ role }) => role === 'environment-style')!;
  const character = job.request.references.find(({ role }) => role === 'character')!;
  const worldHash = fingerprint(`${job.request.seed}\n${job.request.description}\n${environmentArtSeed(job.environmentArt) ?? environment.sha256}`);
  const characterHash = fingerprint(character.sha256);
  const environmentRefs = [environment.id];
  const characterRefs = [character.id];
  const previewRefs = [environment.id, character.id];

  const backgroundSky = png(320, 180, (surface) => {
    const upper = color(worldHash, 1, 16, 82);
    const lower = color(worldHash, 7, 42, 110);
    for (let y = 0; y < 180; y += 1) {
      const mix = y / 179;
      surface.rect(0, y, 320, 1, [
        Math.round(upper[0] * (1 - mix) + lower[0] * mix),
        Math.round(upper[1] * (1 - mix) + lower[1] * mix),
        Math.round(upper[2] * (1 - mix) + lower[2] * mix),
      ]);
    }
    surface.circle(254, 35, 22, color(worldHash, 14, 110, 116));
  });
  const backgroundFar = png(320, 180, (surface) => {
    for (let ridge = 0; ridge < 8; ridge += 1) {
      const x = ridge * 46 - 17;
      const peak = 64 + (ridge % 3) * 11;
      for (let y = peak; y < 160; y += 1) {
        const half = Math.floor((y - peak) * 0.72);
        surface.rect(x + 30 - half, y, half * 2 + 1, 1, color(worldHash, 4 + ridge, 28, 88, 210));
      }
    }
  });
  const backgroundMid = png(320, 180, (surface) => {
    for (let index = 0; index < 10; index += 1) {
      const x = index * 38 - 11;
      const height = 36 + (index % 4) * 11;
      surface.rect(x, 150 - height, 17, height, color(worldHash, 8 + index, 34, 98, 230));
      surface.rect(x + 4, 120 - height, 9, 24, color(worldHash, 13 + index, 46, 110, 230));
    }
  });
  const nearOverlay = png(320, 180, (surface) => {
    for (let index = 0; index < 7; index += 1) {
      const x = 10 + index * 52;
      surface.rect(x, 89 + (index % 2) * 10, 10, 56, color(worldHash, 3 + index, 38, 98, 245));
      surface.circle(x + 5, 85 + (index % 2) * 10, 10, color(worldHash, 11 + index, 48, 120, 245));
    }
  });
  const terrain = png(256, 96, (surface) => {
    for (let tile = 0; tile < 4; tile += 1) {
      const x = tile * 64;
      surface.rect(x, 28, 64, 68, color(worldHash, 4 + tile * 4, 48, 118));
      surface.rect(x, 24, 64, 9, color(worldHash, 12 + tile * 3, 76, 114));
      if (tile === 2) {
        for (let step = 0; step < 6; step += 1) surface.rect(x + step * 10, 24 - step * 4, 12, 72 + step * 4, color(worldHash, 17));
      }
      if (tile === 3) surface.rect(x + 8, 38, 48, 58, [24, 28, 38]);
    }
  });
  const props = png(320, 96, (surface) => {
    for (let item = 0; item < 5; item += 1) {
      const x = item * 64;
      surface.rect(x + 12, 34 - (item % 2) * 11, 40, 54 + (item % 2) * 11, color(worldHash, 5 + item * 4));
      surface.rect(x + 17, 42, 30, 38, color(worldHash, 12 + item * 3));
      surface.line(x + 12, 34, x + 32, 20 - item % 3 * 4, [225, 188, 104]);
      surface.line(x + 52, 34, x + 32, 20 - item % 3 * 4, [225, 188, 104]);
    }
  });
  const structures = png(192, 112, (surface) => {
    for (let item = 0; item < 3; item += 1) {
      const x = item * 64;
      surface.rect(x + 8, 30, 48, 82, color(worldHash, 7 + item * 7));
      surface.rect(x + 19, 52, 26, 60, [26, 29, 41]);
      surface.line(x + 8, 30, x + 32, 8, [230, 196, 118]);
      surface.line(x + 56, 30, x + 32, 8, [230, 196, 118]);
    }
  });
  const collectibles = png(64, 32, (surface) => {
    surface.circle(16, 16, 8, [236, 198, 74]);
    surface.circle(48, 16, 9, [207, 65, 94]);
    surface.rect(46, 7, 4, 18, [251, 178, 192]);
  });
  const effects = png(256, 64, (surface) => {
    for (let effect = 0; effect < 4; effect += 1) {
      const center = effect * 64 + 32;
      surface.circle(center, 32, 6 + effect * 2, color(worldHash, 6 + effect * 5));
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = ray * Math.PI / 4;
        surface.line(
          center,
          32,
          center + Math.round(Math.cos(angle) * (16 + effect * 3)),
          32 + Math.round(Math.sin(angle) * (11 + effect * 2)),
          [242, 216, 134],
        );
      }
    }
  });
  const ambientLight = png(320, 180, (surface) => {
    surface.rect(0, 0, 320, 180, color(worldHash, 18, 24, 54, 44));
  });
  const localLight = png(320, 180, (surface) => {
    for (let radius = 27; radius >= 2; radius -= 3) {
      surface.circle(236, 108, radius, [255, 205, 116, Math.max(4, 38 - radius)]);
    }
  });
  const depthFog = png(320, 180, (surface) => {
    for (let band = 0; band < 5; band += 1) {
      surface.rect(0, 98 + band * 12, 320, 7, color(worldHash, 22 + band, 118, 58, 26 + band * 5));
    }
  });
  const foregroundOverlay = png(320, 180, (surface) => {
    for (let index = 0; index < 6; index += 1) {
      const x = index * 66 - 9;
      surface.rect(x, 119 - (index % 2) * 13, 17, 61 + (index % 2) * 13, color(worldHash, 9 + index, 18, 54, 215));
      surface.circle(x + 9, 113 - (index % 2) * 13, 17, color(worldHash, 13 + index, 22, 62, 215));
    }
  });
  const playerAtlas = characterAtlas(job, 'player', worldHash, characterHash);
  const npcAtlas = characterAtlas(job, 'npc', worldHash, characterHash);

  const runtimeCommon = {
    schema_version: ALPHA12_RUNTIME_SCHEMA_VERSION,
    profile: 'layered-depth-2d' as const,
    completeness_policy: LAYERED_DEPTH_COMPLETENESS_POLICY,
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    spawn: { x: 96, y: 470 },
  };
  const scene = {
    ...runtimeCommon,
    baseline_y: 470,
    layers: ALPHA12_LAYER_IDS,
    planes: [
      {
        id: 'sky', role: 'background.sky', layer: 'sky',
        scroll_ratio: [0, 0], z_index: -70, blend: 'mix',
        native_size: [320, 180], repeat_size: [320, 180], repeat_enabled: true,
      },
      {
        id: 'far', role: 'background.far', layer: 'far',
        scroll_ratio: [0.12, 0.04], z_index: -60, blend: 'mix',
        native_size: [320, 180], repeat_size: [320, 180], repeat_enabled: true,
      },
      {
        id: 'mid', role: 'background.mid', layer: 'mid',
        scroll_ratio: [0.32, 0.12], z_index: -50, blend: 'mix',
        native_size: [320, 180], repeat_size: [320, 180], repeat_enabled: true,
      },
      {
        id: 'depth-fog', role: 'background.depth-fog', layer: 'mid',
        scroll_ratio: [0.45, 0.18], z_index: -40, blend: 'add',
        native_size: [320, 180], repeat_size: [320, 180], repeat_enabled: true,
      },
      {
        id: 'near', role: 'near.overlay', layer: 'near',
        scroll_ratio: [0.82, 0.42], z_index: 30, blend: 'mix',
        native_size: [320, 180], repeat_size: [320, 180], repeat_enabled: true,
      },
      {
        id: 'ambient-light', role: 'lighting.ambient', layer: 'lighting',
        scroll_ratio: [1, 1], z_index: 50, blend: 'multiply',
        native_size: [320, 180], repeat_size: [320, 180], repeat_enabled: true,
      },
      {
        id: 'foreground', role: 'foreground.overlay', layer: 'foreground',
        scroll_ratio: [1.16, 1.08], z_index: 70, blend: 'mix',
        native_size: [320, 180], repeat_size: [320, 180], repeat_enabled: true,
      },
    ],
    placements: [
      { id: 'entrance', role: 'structure.entrance', x: 48, y: 390, layer: 'gameplay' },
      { id: 'npc-guide', role: 'character.npc.atlas', x: 430, y: 560, layer: 'gameplay' },
      { id: 'checkpoint', role: 'structure.checkpoint', x: 680, y: 360, layer: 'gameplay' },
      { id: 'collectible', role: 'collectible.primary', x: 824, y: 500, layer: 'gameplay' },
      { id: 'landmark', role: 'structure.landmark', x: 930, y: 320, layer: 'gameplay' },
      { id: 'local-light', role: 'lighting.local', x: 960, y: 390, layer: 'lighting' },
      { id: 'exit', role: 'structure.exit', x: 1184, y: 440, layer: 'gameplay' },
    ],
  } satisfies Alpha12SceneSidecar;
  const collision = {
    ...runtimeCommon,
    ground_segments: [
      { id: 'far-boundary', from: { x: 40, y: 300 }, to: { x: 1240, y: 300 }, one_way: false },
      { id: 'middle-guide', from: { x: 40, y: 470 }, to: { x: 1240, y: 470 }, one_way: true },
      { id: 'near-boundary', from: { x: 40, y: 650 }, to: { x: 1240, y: 650 }, one_way: false },
    ],
    blockers: [
      { id: 'west-rock', rect: { x: 342, y: 390, width: 58, height: 68 } },
      { id: 'east-landmark', rect: { x: 900, y: 310, width: 92, height: 80 } },
    ],
    hazards: [
      { id: 'deep-water', kind: 'fall', rect: { x: 500, y: 625, width: 140, height: 25 } },
    ],
  } satisfies Alpha12CollisionSidecar;
  const navigation = {
    ...runtimeCommon,
    nodes: [
      { id: 'spawn-node', x: 96, y: 470, kind: 'spawn' },
      { id: 'far-node', x: 330, y: 350, kind: 'route' },
      { id: 'npc-node', x: 430, y: 560, kind: 'route' },
      { id: 'checkpoint-node', x: 680, y: 420, kind: 'checkpoint' },
      { id: 'near-node', x: 920, y: 600, kind: 'route' },
      { id: 'exit-node', x: 1184, y: 470, kind: 'exit' },
    ],
    edges: [
      { from: 'spawn-node', to: 'far-node', kind: 'walk' },
      { from: 'spawn-node', to: 'npc-node', kind: 'walk' },
      { from: 'far-node', to: 'checkpoint-node', kind: 'walk' },
      { from: 'npc-node', to: 'checkpoint-node', kind: 'walk' },
      { from: 'checkpoint-node', to: 'near-node', kind: 'walk' },
      { from: 'near-node', to: 'exit-node', kind: 'walk' },
    ],
    exit_node_id: 'exit-node',
  } satisfies Alpha12NavigationSidecar;
  const previewBytes = preview(worldHash, job);

  const generated = await Promise.all([
    asset('background-sky', 'background-layer', 'layers/background-sky.png', backgroundSky, environmentRefs, [320, 180]),
    asset('background-far', 'background-layer', 'layers/background-far.png', backgroundFar, environmentRefs, [320, 180]),
    asset('background-mid', 'background-layer', 'layers/background-mid.png', backgroundMid, environmentRefs, [320, 180]),
    asset('background-depth-fog', 'background-layer', 'layers/background-depth-fog.png', depthFog, environmentRefs, [320, 180]),
    asset('near-overlay', 'foreground-layer', 'layers/near-overlay.png', nearOverlay, environmentRefs, [320, 180]),
    asset('terrain-atlas', 'terrain-atlas', 'atlases/terrain.png', terrain, environmentRefs, [256, 96]),
    asset('prop-atlas', 'prop-atlas', 'atlases/props.png', props, environmentRefs, [320, 96]),
    asset('structure-atlas', 'structure-sprite', 'atlases/structures.png', structures, environmentRefs, [192, 112]),
    asset('collectible-atlas', 'collectible-atlas', 'atlases/collectibles.png', collectibles, environmentRefs, [64, 32]),
    asset('effect-atlas', 'effect-atlas', 'atlases/effects.png', effects, environmentRefs, [256, 64]),
    asset('lighting-ambient', 'lighting-layer', 'layers/lighting-ambient.png', ambientLight, environmentRefs, [320, 180]),
    asset('lighting-local', 'lighting-layer', 'layers/lighting-local.png', localLight, environmentRefs, [320, 180]),
    asset('foreground-overlay', 'foreground-layer', 'layers/foreground-overlay.png', foregroundOverlay, environmentRefs, [320, 180]),
    asset('player-atlas', 'character-atlas', 'atlases/player.png', playerAtlas, characterRefs, [768, 72]),
    asset('npc-atlas', 'character-atlas', 'atlases/npc.png', npcAtlas, environmentRefs, [384, 72]),
    asset('scene-data', 'scene-data', 'runtime/scene.json', jsonBytes(scene), environmentRefs),
    asset('collision-map', 'collision-map', 'runtime/collision.json', jsonBytes(collision), environmentRefs),
    asset('navigation-map', 'navigation-map', 'runtime/navigation.json', jsonBytes(navigation), environmentRefs),
    asset('world-preview', 'preview', 'previews/world.png', previewBytes, previewRefs, [640, 360]),
  ]);

  const roleAssets: Record<string, string> = {
    'background.sky': 'background-sky',
    'background.far': 'background-far',
    'background.mid': 'background-mid',
    'background.depth-fog': 'background-depth-fog',
    'near.overlay': 'near-overlay',
    'foreground.overlay': 'foreground-overlay',
    'lighting.ambient': 'lighting-ambient',
    'lighting.local': 'lighting-local',
    'terrain.ground': 'terrain-atlas',
    'terrain.path': 'terrain-atlas',
    'terrain.edge': 'terrain-atlas',
    'terrain.bridge': 'terrain-atlas',
    'terrain.stairs': 'terrain-atlas',
    'terrain.water': 'terrain-atlas',
    'prop.tree': 'prop-atlas',
    'prop.rock': 'prop-atlas',
    'prop.crate': 'prop-atlas',
    'prop.sign': 'prop-atlas',
    'prop.lamp': 'prop-atlas',
    'prop.occluder': 'prop-atlas',
    'structure.entrance': 'structure-atlas',
    'structure.exit': 'structure-atlas',
    'structure.checkpoint': 'structure-atlas',
    'structure.landmark': 'structure-atlas',
    'collectible.primary': 'collectible-atlas',
    'collectible.health': 'collectible-atlas',
    'effect.footstep': 'effect-atlas',
    'effect.interact': 'effect-atlas',
    'effect.portal': 'effect-atlas',
    'effect.ambient': 'effect-atlas',
    'character.player.atlas': 'player-atlas',
    'character.npc.atlas': 'npc-atlas',
    'world.scene': 'scene-data',
    'world.collision': 'collision-map',
    'world.navigation': 'navigation-map',
    'world.preview': 'world-preview',
  };
  const bundle: GeneratedAssetBundle = {
    schemaVersion: LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION,
    jobId: job.request.id,
    profile: 'layered-depth-2d',
    completenessPolicy: LAYERED_DEPTH_COMPLETENESS_POLICY,
    assets: generated.map(({ record }) => record),
    roles: LAYERED_DEPTH_REQUIRED_ROLES.map((role) => ({
      role,
      assetId: roleAssets[role],
    })) satisfies AssetRoleBinding[],
    characters: [
      {
        id: 'player',
        atlasAssetId: 'player-atlas',
        frameWidth: 48,
        frameHeight: 72,
        pivot: [24, 67],
        clips: clips(LAYERED_DEPTH_PLAYER_ACTIONS),
      },
      {
        id: 'npc',
        atlasAssetId: 'npc-atlas',
        frameWidth: 48,
        frameHeight: 72,
        pivot: [24, 67],
        clips: clips(LAYERED_DEPTH_NPC_ACTIONS),
      },
    ],
    scene: {
      id: 'layered-depth-scene',
      dataAssetId: 'scene-data',
      collisionAssetId: 'collision-map',
      navigationAssetId: 'navigation-map',
      previewAssetId: 'world-preview',
      spawn: { x: 96, y: 470 },
    },
  };
  return { bundle, files: generated.map(({ file }) => file) };
}

export const PROCEDURAL_LAYERED_DEPTH_PROVIDER: WorldAssetProvider = Object.freeze({
  id: 'mapsoo-procedural-layered-depth',
  version: '0.1.0',
  displayName: 'Mapsoo Procedural Layered Depth',
  capabilities: Object.freeze({
    execution: 'local' as const,
    determinism: 'seeded' as const,
    outputProvenance: 'procedural' as const,
    requiresCredentials: false,
    supportsAbort: true,
    supportedProfiles: Object.freeze(['layered-depth-2d'] as const),
    requiredReferenceRoles: Object.freeze(['environment-style', 'character'] as const),
    maxReferenceBytes: 16 * 1024 * 1024,
    maxOutputBytes: 128 * 1024 * 1024,
    maxRasterDimension: 8192,
  }),
  async generate(job: GenerationRequestJobV2, options?: { readonly signal?: AbortSignal }) {
    if (options?.signal?.aborted) throw new DOMException('Generation aborted.', 'AbortError');
    return generateProceduralLayeredDepth(job);
  },
});
