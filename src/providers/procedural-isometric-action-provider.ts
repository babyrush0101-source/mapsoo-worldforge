import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import {
  blitCharacterIdentityFrame,
  renderCharacterIdentityFrame,
} from '../adapters/canvas/render-character-identity-frame';
import type {
  AssetRoleBinding,
  CharacterAction,
  CharacterAnimationClip,
  CharacterDirection,
  GeneratedAssetBundle,
  GeneratedAssetKind,
} from '../core/generated-asset-bundle';
import type { GenerationRequestJobV2 } from '../core/generation-request-v2';
import { environmentArtSeed } from '../core/environment-art-signature';
import {
  ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION,
  ISOMETRIC_ACTION_COMPLETENESS_POLICY,
  ISOMETRIC_ACTION_DIRECTIONS,
  ISOMETRIC_ACTION_REQUIRED_ROLES,
  ISOMETRIC_ENEMY_ACTIONS,
  ISOMETRIC_PLAYER_ACTIONS,
} from '../core/isometric-action-asset-bundle';
import {
  ALPHA11_LAYER_IDS,
  type Alpha11CollisionSidecar,
  type Alpha11NavigationSidecar,
  type Alpha11SceneSidecar,
} from '../core/pack-manifest-alpha11';
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

function color(hash: number, shift = 0, minimum = 48, span = 160): Color {
  return [
    minimum + ((hash >>> shift) % span),
    minimum + ((hash >>> (shift + 6)) % span),
    minimum + ((hash >>> (shift + 13)) % span),
    255,
  ];
}

function png(width: number, height: number, draw: (surface: Surface) => void): Uint8Array {
  const surface = new Surface(width, height);
  draw(surface);
  return encodeRgbaPng(width, height, surface.pixels);
}

function diamond(
  surface: Surface,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  fill: Color,
  outline: Color,
): void {
  for (let y = -halfHeight; y <= halfHeight; y += 1) {
    const width = Math.floor(halfWidth * (1 - Math.abs(y) / Math.max(halfHeight, 1)));
    surface.rect(centerX - width, centerY + y, width * 2 + 1, 1, fill);
  }
  surface.line(centerX, centerY - halfHeight, centerX + halfWidth, centerY, outline);
  surface.line(centerX + halfWidth, centerY, centerX, centerY + halfHeight, outline);
  surface.line(centerX, centerY + halfHeight, centerX - halfWidth, centerY, outline);
  surface.line(centerX - halfWidth, centerY, centerX, centerY - halfHeight, outline);
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
  directionIndex: number,
): void {
  const bob = action === 'move' && directionIndex % 2 === 1 ? -1 : 0;
  const hurt = action === 'hurt' ? 2 : 0;
  surface.circle(originX + 24 + hurt, 15 + bob, 9, body);
  surface.rect(originX + 15 + hurt, 23 + bob, 18, 27, body);
  surface.rect(originX + 11 + hurt, 27 + bob, 5, 16, accent);
  surface.rect(originX + 32 + hurt, 27 + bob, 5, 16, accent);
  surface.rect(originX + 16 + hurt, 49, 6, 10, outline);
  surface.rect(originX + 27 + hurt, 49, 6, 10, outline);
  if (action === 'attack-primary') {
    surface.line(originX + 35, 28, originX + 46, 18 + directionIndex % 3, accent);
  }
  if (action === 'defeat') surface.rect(originX + 9, 55, 31, 5, outline);
}

function characterAtlas(
  job: GenerationRequestJobV2,
  id: 'player' | 'enemy-melee' | 'enemy-ranged',
  worldHash: number,
): Uint8Array {
  const actions = id === 'player' ? ISOMETRIC_PLAYER_ACTIONS : ISOMETRIC_ENEMY_ACTIONS;
  const width = actions.length * ISOMETRIC_ACTION_DIRECTIONS.length * 48;
  return png(width, 64, (surface) => {
    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      for (let directionIndex = 0; directionIndex < ISOMETRIC_ACTION_DIRECTIONS.length; directionIndex += 1) {
        const frameIndex = actionIndex * ISOMETRIC_ACTION_DIRECTIONS.length + directionIndex;
        const x = frameIndex * 48;
        if (id === 'player' && job.characterIdentity) {
          const frame = renderCharacterIdentityFrame(job.characterIdentity, 'isometric-action', {
            action: actions[actionIndex],
            direction: ISOMETRIC_ACTION_DIRECTIONS[directionIndex],
            frame: actionIndex + directionIndex,
          });
          blitCharacterIdentityFrame(surface.pixels, surface.width, surface.height, frame, x, 0);
        } else {
          const identityOffset = id === 'player' ? 0 : id === 'enemy-melee' ? 9 : 17;
          drawGenericCharacter(
            surface,
            x,
            color(worldHash, identityOffset),
            color(worldHash, identityOffset + 5),
            [25, 29, 38],
            actions[actionIndex],
            directionIndex,
          );
        }
      }
    }
  });
}

function clips(actions: readonly CharacterAction[]): CharacterAnimationClip[] {
  return actions.flatMap((action, actionIndex) =>
    ISOMETRIC_ACTION_DIRECTIONS.map((direction, directionIndex) => ({
      action,
      direction,
      fps: action === 'idle' ? 4 : action === 'attack-primary' ? 10 : 8,
      frames: [{
        x: (actionIndex * ISOMETRIC_ACTION_DIRECTIONS.length + directionIndex) * 48,
        y: 0,
      }],
    })));
}

function preview(
  worldHash: number,
  job: GenerationRequestJobV2,
  floor: Color,
  floorVariant: Color,
  outline: Color,
): Uint8Array {
  return png(640, 360, (surface) => {
    surface.rect(0, 0, 640, 360, [17, 22, 34]);
    for (let row = 0; row < 8; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const x = 320 + (column - row) * 32;
        const y = 62 + (column + row) * 16;
        diamond(surface, x, y, 32, 16, (column + row) % 3 === 0 ? floorVariant : floor, outline);
      }
    }
    surface.rect(280, 154, 22, 36, color(worldHash, 10));
    surface.circle(291, 150, 13, color(worldHash, 15));
    surface.rect(412, 205, 25, 40, color(worldHash, 5));
    surface.circle(424, 203, 14, color(worldHash, 20));
    const enemy = new Surface(48, 64);
    drawGenericCharacter(enemy, 0, color(worldHash, 9), color(worldHash, 14), [25, 29, 38], 'idle', 5);
    for (let y = 0; y < enemy.height; y += 1) {
      for (let x = 0; x < enemy.width; x += 1) {
        const offset = (y * enemy.width + x) * 4;
        if (enemy.pixels[offset + 3] !== 0) {
          surface.pixels.set(enemy.pixels.subarray(offset, offset + 4), ((222 + y) * 640 + 412 + x) * 4);
        }
      }
    }
    if (job.characterIdentity) {
      const player = renderCharacterIdentityFrame(job.characterIdentity, 'isometric-action', {
        action: 'idle',
        direction: 'south-east',
        frame: 0,
      });
      blitCharacterIdentityFrame(surface.pixels, surface.width, surface.height, player, 296, 112);
    }
    surface.rect(0, 0, 640, 28, [10, 14, 24, 190]);
    surface.rect(0, 332, 640, 28, [10, 14, 24, 190]);
  });
}

export async function generateProceduralIsometricAction(
  job: GenerationRequestJobV2,
): Promise<WorldAssetProviderOutput> {
  const environment = job.request.references.find(({ role }) => role === 'environment-style')!;
  const character = job.request.references.find(({ role }) => role === 'character')!;
  const worldHash = fingerprint(`${job.request.seed}\n${job.request.description}\n${environmentArtSeed(job.environmentArt) ?? environment.sha256}`);
  const floorColor = color(worldHash, 2);
  const floorVariant = color(worldHash, 8);
  const outline: Color = [28, 33, 43];
  const environmentRefs = [environment.id];
  const playerRefs = job.characterIdentity ? [character.id] : [environment.id, character.id];
  const previewRefs = [environment.id, character.id];

  const terrain = png(576, 64, (surface) => {
    for (let tile = 0; tile < 9; tile += 1) {
      const x = tile * 64 + 32;
      diamond(surface, x, 24, 31, 15, tile % 2 === 0 ? floorColor : floorVariant, outline);
      if (tile >= 4 && tile <= 6) {
        surface.rect(tile * 64 + 1, 24, 62, 20, color(worldHash, 13 + tile));
        surface.line(tile * 64 + 1, 44, tile * 64 + 32, 59, outline);
        surface.line(tile * 64 + 63, 44, tile * 64 + 32, 59, outline);
      }
      if (tile === 7) surface.line(tile * 64 + 8, 48, tile * 64 + 56, 24, [222, 198, 115]);
    }
  });
  const hazards = png(128, 64, (surface) => {
    diamond(surface, 32, 38, 28, 13, [150, 45, 55], outline);
    for (let x = 12; x < 53; x += 10) surface.line(x, 38, x + 5, 18, [232, 85, 70]);
    diamond(surface, 96, 38, 28, 13, [225, 92, 58, 120], [255, 180, 80]);
  });
  const props = png(320, 96, (surface) => {
    for (let index = 0; index < 5; index += 1) {
      const x = index * 64;
      diamond(surface, x + 32, 78, 25, 11, color(worldHash, index + 3), outline);
      surface.rect(x + 20, 30 - index % 2 * 8, 24, 48 + index % 2 * 8, color(worldHash, 9 + index));
      surface.line(x + 20, 30, x + 32, 20 - index % 3 * 4, [230, 192, 106]);
      surface.line(x + 44, 30, x + 32, 20 - index % 3 * 4, [230, 192, 106]);
    }
  });
  const structures = png(192, 96, (surface) => {
    for (let index = 0; index < 3; index += 1) {
      const x = index * 64;
      surface.rect(x + 10, 30, 44, 56, color(worldHash, 6 + index * 5));
      surface.rect(x + 20, 48, 24, 38, [32, 35, 48]);
      surface.line(x + 10, 30, x + 32, 10, [230, 188, 104]);
      surface.line(x + 54, 30, x + 32, 10, [230, 188, 104]);
    }
  });
  const collectibles = png(64, 32, (surface) => {
    surface.circle(16, 16, 8, [231, 194, 74]);
    surface.circle(48, 16, 9, [206, 62, 92]);
    surface.rect(46, 7, 4, 18, [250, 176, 188]);
  });
  const effects = png(448, 64, (surface) => {
    for (let index = 0; index < 7; index += 1) {
      const x = index * 64 + 32;
      surface.circle(x, 32, 6 + index % 4 * 3, color(worldHash, 4 + index * 3));
      for (let ray = 0; ray < 8; ray += 1) {
        const dx = Math.round(Math.cos(ray * Math.PI / 4) * (15 + index % 3 * 4));
        const dy = Math.round(Math.sin(ray * Math.PI / 4) * (8 + index % 3 * 3));
        surface.line(x, 32, x + dx, 32 + dy, [240, 218, 142]);
      }
    }
  });
  const shadows = png(64, 32, (surface) => {
    diamond(surface, 32, 17, 24, 8, [7, 10, 17, 130], [7, 10, 17, 90]);
  });
  const playerAtlas = characterAtlas(job, 'player', worldHash);
  const meleeAtlas = characterAtlas(job, 'enemy-melee', worldHash);
  const rangedAtlas = characterAtlas(job, 'enemy-ranged', worldHash);

  const runtimeCommon = {
    schema_version: '0.3.0' as const,
    profile: 'isometric-action' as const,
    completeness_policy: ISOMETRIC_ACTION_COMPLETENESS_POLICY,
    bounds: { x: 0, y: 0, width: 640, height: 360 },
    spawn: { x: 320, y: 96 },
  };
  const floorCells = Array.from({ length: 64 }, (_, index) => ({
    column: index % 8,
    row: Math.floor(index / 8),
    elevation: index === 27 || index === 28 ? 1 : 0,
  }));
  const scene: Alpha11SceneSidecar = {
    ...runtimeCommon,
    grid: { tile_width: 64, tile_height: 32, elevation_height: 16, columns: 8, rows: 8 },
    layers: ALPHA11_LAYER_IDS,
    floor_cells: floorCells,
    placements: [
      { id: 'entrance', role: 'structure.entrance', layer: 'props', column: 1, row: 1, elevation: 0, x: 320, y: 96 },
      { id: 'checkpoint', role: 'structure.checkpoint', layer: 'props', column: 3, row: 3, elevation: 1, x: 320, y: 176 },
      { id: 'melee-one', role: 'character.enemy-melee.atlas', layer: 'actors', column: 5, row: 3, elevation: 0, x: 384, y: 208 },
      { id: 'ranged-one', role: 'character.enemy-ranged.atlas', layer: 'actors', column: 3, row: 5, elevation: 0, x: 256, y: 208 },
      { id: 'contact-hazard', role: 'hazard.contact', layer: 'effects', column: 5, row: 5, elevation: 0, x: 320, y: 256 },
      { id: 'exit', role: 'structure.exit', layer: 'props', column: 6, row: 6, elevation: 0, x: 320, y: 288 },
    ],
  };
  const collision: Alpha11CollisionSidecar = {
    ...runtimeCommon,
    walkable_polygon: [{ x: 320, y: 48 }, { x: 576, y: 176 }, { x: 320, y: 304 }, { x: 64, y: 176 }],
    blockers: [
      { id: 'center-blocker', rect: { x: 276, y: 142, width: 32, height: 32 } },
      { id: 'east-cover', rect: { x: 410, y: 188, width: 34, height: 26 } },
    ],
    hazards: [{ id: 'contact-hazard', kind: 'trap', rect: { x: 296, y: 240, width: 48, height: 24 } }],
  };
  const navigation: Alpha11NavigationSidecar = {
    ...runtimeCommon,
    nodes: [
      { id: 'spawn-node', x: 320, y: 96, elevation: 0, kind: 'spawn' },
      { id: 'melee-node', x: 384, y: 208, elevation: 0, kind: 'route' },
      { id: 'checkpoint-node', x: 320, y: 176, elevation: 1, kind: 'checkpoint' },
      { id: 'ranged-node', x: 256, y: 208, elevation: 0, kind: 'route' },
      { id: 'exit-node', x: 320, y: 288, elevation: 0, kind: 'exit' },
    ],
    edges: [
      { from: 'spawn-node', to: 'melee-node', kind: 'walk' },
      { from: 'spawn-node', to: 'checkpoint-node', kind: 'stairs' },
      { from: 'checkpoint-node', to: 'ranged-node', kind: 'stairs' },
      { from: 'melee-node', to: 'exit-node', kind: 'walk' },
      { from: 'ranged-node', to: 'exit-node', kind: 'dash' },
    ],
    exit_node_id: 'exit-node',
  };
  const previewBytes = preview(worldHash, job, floorColor, floorVariant, outline);

  const generated = await Promise.all([
    asset('terrain-atlas', 'terrain-atlas', 'atlases/terrain.png', terrain, environmentRefs, [576, 64]),
    asset('hazard-atlas', 'hazard-atlas', 'atlases/hazards.png', hazards, environmentRefs, [128, 64]),
    asset('prop-atlas', 'prop-atlas', 'atlases/props.png', props, environmentRefs, [320, 96]),
    asset('structure-atlas', 'structure-sprite', 'atlases/structures.png', structures, environmentRefs, [192, 96]),
    asset('collectible-atlas', 'collectible-atlas', 'atlases/collectibles.png', collectibles, environmentRefs, [64, 32]),
    asset('effect-atlas', 'effect-atlas', 'atlases/effects.png', effects, environmentRefs, [448, 64]),
    asset('shadow-atlas', 'effect-atlas', 'atlases/shadows.png', shadows, environmentRefs, [64, 32]),
    asset('player-atlas', 'character-atlas', 'atlases/player.png', playerAtlas, playerRefs, [2304, 64]),
    asset('enemy-melee-atlas', 'character-atlas', 'atlases/enemy-melee.png', meleeAtlas, environmentRefs, [1920, 64]),
    asset('enemy-ranged-atlas', 'character-atlas', 'atlases/enemy-ranged.png', rangedAtlas, environmentRefs, [1920, 64]),
    asset('scene-data', 'scene-data', 'runtime/scene.json', jsonBytes(scene), environmentRefs),
    asset('collision-map', 'collision-map', 'runtime/collision.json', jsonBytes(collision), environmentRefs),
    asset('navigation-map', 'navigation-map', 'runtime/navigation.json', jsonBytes(navigation), environmentRefs),
    asset('world-preview', 'preview', 'previews/world.png', previewBytes, previewRefs, [640, 360]),
  ]);

  const roleAssets: Record<string, string> = {
    'terrain.void': 'terrain-atlas',
    'terrain.floor.base': 'terrain-atlas',
    'terrain.floor.variant': 'terrain-atlas',
    'terrain.floor.edge': 'terrain-atlas',
    'terrain.elevation.top': 'terrain-atlas',
    'terrain.elevation.riser-left': 'terrain-atlas',
    'terrain.elevation.riser-right': 'terrain-atlas',
    'terrain.ramp': 'terrain-atlas',
    'terrain.wall': 'terrain-atlas',
    'hazard.contact': 'hazard-atlas',
    'hazard.telegraph': 'hazard-atlas',
    'prop.blocker': 'prop-atlas',
    'prop.breakable': 'prop-atlas',
    'prop.cover': 'prop-atlas',
    'prop.decoration': 'prop-atlas',
    'prop.light': 'prop-atlas',
    'structure.entrance': 'structure-atlas',
    'structure.exit': 'structure-atlas',
    'structure.checkpoint': 'structure-atlas',
    'collectible.primary': 'collectible-atlas',
    'collectible.health': 'collectible-atlas',
    'effect.player-attack': 'effect-atlas',
    'effect.enemy-attack': 'effect-atlas',
    'effect.projectile': 'effect-atlas',
    'effect.impact': 'effect-atlas',
    'effect.dash': 'effect-atlas',
    'effect.spawn': 'effect-atlas',
    'effect.defeat': 'effect-atlas',
    'effect.shadow': 'shadow-atlas',
    'character.player.atlas': 'player-atlas',
    'character.enemy-melee.atlas': 'enemy-melee-atlas',
    'character.enemy-ranged.atlas': 'enemy-ranged-atlas',
    'world.scene': 'scene-data',
    'world.collision': 'collision-map',
    'world.navigation': 'navigation-map',
    'world.preview': 'world-preview',
  };
  const bundle: GeneratedAssetBundle = {
    schemaVersion: ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION,
    jobId: job.request.id,
    profile: 'isometric-action',
    completenessPolicy: ISOMETRIC_ACTION_COMPLETENESS_POLICY,
    assets: generated.map(({ record }) => record),
    roles: ISOMETRIC_ACTION_REQUIRED_ROLES.map((role) => ({ role, assetId: roleAssets[role] })) satisfies AssetRoleBinding[],
    characters: [
      {
        id: 'player', atlasAssetId: 'player-atlas', frameWidth: 48, frameHeight: 64,
        pivot: [24, 58], clips: clips(ISOMETRIC_PLAYER_ACTIONS),
      },
      {
        id: 'enemy-melee', atlasAssetId: 'enemy-melee-atlas', frameWidth: 48, frameHeight: 64,
        pivot: [24, 58], clips: clips(ISOMETRIC_ENEMY_ACTIONS),
      },
      {
        id: 'enemy-ranged', atlasAssetId: 'enemy-ranged-atlas', frameWidth: 48, frameHeight: 64,
        pivot: [24, 58], clips: clips(ISOMETRIC_ENEMY_ACTIONS),
      },
    ],
    scene: {
      id: 'isometric-action-scene',
      dataAssetId: 'scene-data',
      collisionAssetId: 'collision-map',
      navigationAssetId: 'navigation-map',
      previewAssetId: 'world-preview',
      spawn: { x: 320, y: 96 },
    },
  };
  return { bundle, files: generated.map(({ file }) => file) };
}

export const PROCEDURAL_ISOMETRIC_ACTION_PROVIDER: WorldAssetProvider = Object.freeze({
  id: 'mapsoo-procedural-isometric-action',
  version: '0.1.0',
  displayName: 'Mapsoo Procedural Isometric Action',
  capabilities: Object.freeze({
    execution: 'local' as const,
    determinism: 'seeded' as const,
    outputProvenance: 'procedural' as const,
    requiresCredentials: false,
    supportsAbort: true,
    supportedProfiles: Object.freeze(['isometric-action'] as const),
    requiredReferenceRoles: Object.freeze(['environment-style', 'character'] as const),
    maxReferenceBytes: 16 * 1024 * 1024,
    maxOutputBytes: 128 * 1024 * 1024,
    maxRasterDimension: 8192,
  }),
  async generate(job: GenerationRequestJobV2, options?: { readonly signal?: AbortSignal }) {
    if (options?.signal?.aborted) throw new DOMException('Generation aborted.', 'AbortError');
    return generateProceduralIsometricAction(job);
  },
});
