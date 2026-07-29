import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import { renderProfileReferenceScene } from '../adapters/canvas/render-profile-reference-scene';
import {
  blitCharacterIdentityFrame,
  renderCharacterIdentityFrame,
} from '../adapters/canvas/render-character-identity-frame';
import type { AssetRoleBinding, CharacterAnimationClip, GeneratedAssetBundle, GeneratedAssetKind } from '../core/generated-asset-bundle';
import type { GenerationRequestJobV2 } from '../core/generation-request-v2';
import { environmentArtSeed } from '../core/environment-art-signature';
import {
  ALPHA10_LAYER_IDS,
  type Alpha10CollisionSidecar,
  type Alpha10NavigationSidecar,
  type Alpha10SceneSidecar,
} from '../core/pack-manifest-alpha10';
import { SIDE_PLATFORMER_ASSET_BUNDLE_SCHEMA_VERSION, SIDE_PLATFORMER_COMPLETENESS_POLICY } from '../core/side-platformer-asset-bundle';
import type { GeneratedAssetFile, WorldAssetProvider, WorldAssetProviderOutput } from '../core/world-asset-provider';

type Color = readonly [number, number, number, number?];
class Surface {
  readonly pixels: Uint8Array;
  constructor(readonly width: number, readonly height: number, color: Color = [0, 0, 0, 0]) {
    this.pixels = new Uint8Array(width * height * 4); this.rect(0, 0, width, height, color);
  }
  pixel(x: number, y: number, c: Color): void { if (x < 0 || y < 0 || x >= this.width || y >= this.height) return; this.pixels.set([c[0], c[1], c[2], c[3] ?? 255], (y * this.width + x) * 4); }
  rect(x: number, y: number, w: number, h: number, c: Color): void { for (let j = y; j < y + h; j += 1) for (let i = x; i < x + w; i += 1) this.pixel(i, j, c); }
  circle(cx: number, cy: number, r: number, c: Color): void { for (let y = cy - r; y <= cy + r; y += 1) for (let x = cx - r; x <= cx + r; x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= r ** 2) this.pixel(x, y, c); }
}

function fingerprint(value: string): number { let h = 0x811c9dc5; for (const c of value) { h ^= c.codePointAt(0) ?? 0; h = Math.imul(h, 0x01000193); } return h >>> 0; }
function color(hash: number, shift = 0): Color { return [55 + ((hash >>> shift) % 150), 55 + ((hash >>> (shift + 5)) % 150), 55 + ((hash >>> (shift + 11)) % 150), 255]; }
function hexColor(value: string): Color { return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16), 255]; }
function png(width: number, height: number, draw: (s: Surface) => void): Uint8Array { const s = new Surface(width, height); draw(s); return encodeRgbaPng(width, height, s.pixels); }
function json(value: unknown): Uint8Array { return new TextEncoder().encode(`${JSON.stringify(value)}\n`); }
async function sha256(bytes: Uint8Array): Promise<string> { const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer); return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, '0')).join(''); }
async function make(id: string, kind: GeneratedAssetKind, path: string, bytes: Uint8Array, refs: readonly string[], dimensions?: readonly [number, number]) {
  const mediaType = dimensions ? 'image/png' as const : 'application/json' as const;
  return { record: { id, kind, path, mediaType, bytes: bytes.byteLength, sha256: await sha256(bytes), ...(dimensions ? { width: dimensions[0], height: dimensions[1] } : {}), sourceReferenceIds: refs }, file: { assetId: id, path, mediaType, bytes } satisfies GeneratedAssetFile };
}

export async function generateProceduralSidePlatformer(job: GenerationRequestJobV2): Promise<WorldAssetProviderOutput> {
  const env = job.request.references.find((r) => r.role === 'environment-style')!;
  const character = job.request.references.find((r) => r.role === 'character')!;
  const worldHash = fingerprint(`${job.request.seed}\n${job.request.description}\n${environmentArtSeed(job.environmentArt) ?? env.sha256}`);
  // Preserve the pre-identity Alpha10 fixture path; new browser jobs carry the
  // decoded identity and therefore isolate character styling from the world.
  const heroHash = job.characterIdentity
    ? fingerprint(character.sha256)
    : fingerprint(`${job.request.seed}\n${job.request.description}\n${env.sha256}\n${character.sha256}`);
  const identityPalette = job.characterIdentity?.palette;
  const heroSkin = identityPalette ? hexColor(identityPalette.secondary) : color(heroHash, 3);
  const heroOutfit = identityPalette ? hexColor(identityPalette.primary) : color(heroHash, 11);
  const heroAccent = identityPalette ? hexColor(identityPalette.accent) : color(heroHash, 17);
  const heroOutline = identityPalette ? hexColor(identityPalette.outline) : [32, 34, 45] as const;
  const worldRefs = [env.id];
  const heroRefs = job.characterIdentity ? [character.id] : [env.id, character.id];
  const previewRefs = [env.id, character.id];
  const terrain = png(192, 64, (s) => { s.rect(0, 0, 192, 64, color(worldHash)); s.rect(0, 0, 192, 10, color(worldHash, 7)); for (let x = 4; x < 192; x += 16) s.rect(x, 22 + (x % 3), 7, 7, color(worldHash, 13)); });
  const hazards = png(96, 32, (s) => { for (let x = 0; x < 32; x += 8) for (let y = 28; y > 28 - x % 9; y -= 1) s.pixel(x + 3, y, [235, 70, 65]); s.rect(34, 17, 26, 12, color(worldHash, 4)); s.rect(66, 20, 27, 9, color(worldHash, 9)); });
  const props = png(192, 32, (s) => { for (let i = 0; i < 6; i += 1) { s.rect(i * 32 + 7, 11, 18, 19, color(worldHash, i * 3)); s.rect(i * 32 + 9, 13, 14, 3, [235, 215, 140]); } });
  const structures = png(96, 64, (s) => { for (let i = 0; i < 3; i += 1) { const x = i * 32; s.rect(x + 5, 16, 22, 47, color(worldHash, 5 + i * 4)); s.rect(x + 9, 24, 14, 32, [42, 38, 54]); s.rect(x + 12, 8, 8, 12, color(worldHash, 16 - i * 2)); } });
  const collectibles = png(64, 32, (s) => { s.circle(16, 16, 8, color(worldHash, 6)); s.circle(48, 16, 9, [215, 65, 95]); s.rect(46, 7, 4, 18, [245, 185, 195]); });
  const layer = (index: number) => png(320, 180, (s) => {
    if (index === 0) {
      const sky = color(worldHash, 2);
      s.rect(0, 0, 320, 180, [Math.max(12, sky[0] - 45), Math.max(18, sky[1] - 38), Math.max(28, sky[2] - 24)]);
      s.rect(0, 62, 320, 118, [Math.max(22, sky[0] - 18), Math.max(30, sky[1] - 12), Math.min(225, sky[2] + 18)]);
      const cloud: Color = [224, 226, 198, 210];
      s.circle(66, 34, 8, cloud); s.circle(76, 31, 11, cloud); s.circle(88, 35, 8, cloud);
      s.circle(172, 48, 7, [205, 215, 198, 190]); s.circle(181, 45, 9, [205, 215, 198, 190]); s.circle(191, 49, 7, [205, 215, 198, 190]);
      s.circle(264, 34, 17, [241, 222, 168]);
      return;
    }
    if (index === 4) {
      s.rect(0, 158, 320, 22, [15, 29, 28, 235]);
      for (let x = -8; x < 328; x += 31) s.circle(x, 162 + ((x + worldHash) % 9), 17, [18, 45, 38, 225]);
      return;
    }
    const spacing = 43 - index * 5;
    for (let x = -10; x < 330; x += spacing) {
      const height = 34 + ((x + worldHash + index * 19) % (28 + index * 6));
      const silhouette = color(worldHash, 17 - index * 2);
      s.rect(x + 7, 180 - height, 5 + index, height, [silhouette[0], silhouette[1], silhouette[2], 205 + index * 12]);
      s.circle(x + 10, 180 - height, 10 + index * 2, [silhouette[0], silhouette[1], silhouette[2], 185 + index * 15]);
    }
  });
  const actions = ['idle', 'run', 'jump', 'fall', 'land', 'hurt'] as const;
  const atlas = job.characterIdentity
    ? png(384, 64, (surface) => {
      for (let action = 0; action < actions.length; action += 1) {
        for (let direction = 0; direction < 2; direction += 1) {
          const rendered = renderCharacterIdentityFrame(job.characterIdentity!, 'side-platformer', {
            action: actions[action],
            direction: direction === 0 ? 'left' : 'right',
            frame: action,
          });
          blitCharacterIdentityFrame(
            surface.pixels,
            surface.width,
            surface.height,
            rendered,
            (action * 2 + direction) * 32,
            0,
          );
        }
      }
    })
    : png(384, 64, (s) => { for (let frame = 0; frame < 12; frame += 1) { const x = frame * 32; const facing = frame % 2 === 0 ? -1 : 1; s.circle(x + 16, 12, 7, heroSkin); s.rect(x + 10, 19, 13, 25, heroOutfit); s.rect(x + (facing < 0 ? 7 : 22), 20, 3, 14, heroAccent); s.rect(x + 10 + frame % 3, 44, 4, 15, heroOutline); s.rect(x + 19 - frame % 3, 44, 4, 15, heroOutline); } });
  const referencePreview = renderProfileReferenceScene('side-platformer', `${worldHash}:${heroHash}`);
  const preview = job.characterIdentity
    ? (() => {
      const pixels = referencePreview.pixels.slice();
      const player = renderCharacterIdentityFrame(job.characterIdentity!, 'side-platformer', {
        action: 'idle', direction: 'right', frame: 0,
      });
      blitCharacterIdentityFrame(pixels, 320, 180, player, 38, 92);
      return encodeRgbaPng(320, 180, pixels);
    })()
    : referencePreview.pngBytes;
  const runtimeCommon = {
    schema_version: '0.2.0' as const,
    profile: 'side-platformer' as const,
    completeness_policy: SIDE_PLATFORMER_COMPLETENESS_POLICY,
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    spawn: { x: 64, y: 608 },
  };
  const scene: Alpha10SceneSidecar = {
    ...runtimeCommon,
    layers: ALPHA10_LAYER_IDS,
    placements: [
      { id: 'entrance', role: 'structure.entrance', layer: 'world', x: 32, y: 608 },
      { id: 'checkpoint', role: 'structure.checkpoint', layer: 'world', x: 448, y: 480 },
      { id: 'spikes', role: 'hazard.spikes', layer: 'world', x: 720, y: 584 },
      { id: 'exit', role: 'structure.exit', layer: 'world', x: 1184, y: 608 },
    ],
  };
  const collision: Alpha10CollisionSidecar = {
    ...runtimeCommon,
    surfaces: [
      { id: 'ground-left', kind: 'solid', rect: { x: 0, y: 608, width: 1000, height: 112 } },
      { id: 'ground-right', kind: 'solid', rect: { x: 1096, y: 608, width: 184, height: 112 } },
      { id: 'upper-platform', kind: 'one-way', rect: { x: 320, y: 480, width: 256, height: 24 } },
    ],
    hazards: [
      { id: 'spikes', kind: 'spikes', rect: { x: 720, y: 584, width: 64, height: 24 } },
      { id: 'kill-pit', kind: 'pit', rect: { x: 1000, y: 608, width: 96, height: 112 } },
    ],
  };
  const navigation: Alpha10NavigationSidecar = {
    ...runtimeCommon,
    nodes: [
      { id: 'spawn-node', x: 64, y: 608, kind: 'spawn' },
      { id: 'checkpoint-node', x: 448, y: 480, kind: 'checkpoint' },
      { id: 'exit-node', x: 1184, y: 608, kind: 'exit' },
    ],
    edges: [
      { from: 'spawn-node', to: 'checkpoint-node', kind: 'jump' },
      { from: 'checkpoint-node', to: 'exit-node', kind: 'drop' },
    ],
    exit_node_id: 'exit-node',
  };
  const generated = await Promise.all([
    make('platform-atlas', 'platform-atlas', 'atlases/platforms.png', terrain, worldRefs, [192, 64]), make('hazard-atlas', 'hazard-atlas', 'atlases/hazards.png', hazards, worldRefs, [96, 32]),
    make('prop-atlas', 'prop-atlas', 'atlases/props.png', props, worldRefs, [192, 32]), make('collectible-atlas', 'collectible-atlas', 'atlases/collectibles.png', collectibles, worldRefs, [64, 32]),
    make('structure-atlas', 'structure-sprite', 'atlases/structures.png', structures, worldRefs, [96, 64]),
    ...await Promise.all(['sky', 'far', 'mid', 'near'].map((name, i) => make(`background-${name}`, 'background-layer', `layers/background-${name}.png`, layer(i), worldRefs, [320, 180]))),
    make('foreground-overlay', 'foreground-layer', 'layers/foreground-overlay.png', layer(4), worldRefs, [320, 180]), make('character-atlas', 'character-atlas', 'atlases/character.png', atlas, heroRefs, [384, 64]),
    make('collision-map', 'collision-map', 'runtime/collision.json', json(collision), worldRefs), make('navigation-map', 'navigation-map', 'runtime/navigation.json', json(navigation), worldRefs), make('scene-data', 'scene-data', 'runtime/scene.json', json(scene), worldRefs),
    make('world-preview', 'preview', 'previews/world.png', preview, previewRefs, [320, 180]),
  ]);
  const roleAssets: Record<string, string> = {
    'terrain.solid': 'platform-atlas', 'terrain.one-way': 'platform-atlas', 'terrain.slope-up': 'platform-atlas', 'terrain.slope-down': 'platform-atlas', 'terrain.wall': 'platform-atlas', 'terrain.ceiling': 'platform-atlas',
    'hazard.spikes': 'hazard-atlas', 'hazard.pit': 'hazard-atlas', 'hazard.moving-platform': 'hazard-atlas', 'prop.crate': 'prop-atlas', 'prop.rock': 'prop-atlas', 'prop.plant': 'prop-atlas', 'prop.sign': 'prop-atlas', 'prop.lamp': 'prop-atlas', 'prop.breakable': 'prop-atlas',
    'structure.entrance': 'structure-atlas', 'structure.exit': 'structure-atlas', 'structure.checkpoint': 'structure-atlas', 'collectible.primary': 'collectible-atlas', 'collectible.health': 'collectible-atlas',
    'background.sky': 'background-sky', 'background.far': 'background-far', 'background.mid': 'background-mid', 'background.near': 'background-near', 'foreground.overlay': 'foreground-overlay', 'character.player.atlas': 'character-atlas',
    'world.collision': 'collision-map', 'world.navigation': 'navigation-map', 'world.scene': 'scene-data', 'world.preview': 'world-preview',
  };
  const clips: CharacterAnimationClip[] = actions.flatMap((action, i) => (['left', 'right'] as const).map((direction, d) => ({ action, direction, fps: action === 'run' ? 10 : 6, frames: [{ x: (i * 2 + d) * 32, y: 0 }] })));
  const bundle: GeneratedAssetBundle = { schemaVersion: SIDE_PLATFORMER_ASSET_BUNDLE_SCHEMA_VERSION, jobId: job.request.id, profile: 'side-platformer', completenessPolicy: SIDE_PLATFORMER_COMPLETENESS_POLICY, assets: generated.map((x) => x.record), roles: Object.entries(roleAssets).map(([role, assetId]) => ({ role, assetId })) satisfies AssetRoleBinding[], characters: [{ id: 'player', atlasAssetId: 'character-atlas', frameWidth: 32, frameHeight: 64, pivot: [16, 60], clips }], scene: { id: 'side-platformer-scene', dataAssetId: 'scene-data', collisionAssetId: 'collision-map', navigationAssetId: 'navigation-map', previewAssetId: 'world-preview', spawn: { x: 64, y: 608 } } };
  return { bundle, files: generated.map((x) => x.file) };
}

export const PROCEDURAL_SIDE_PLATFORMER_PROVIDER: WorldAssetProvider = Object.freeze({
  id: 'mapsoo-procedural-side-platformer', version: '0.1.0', displayName: 'Mapsoo Procedural Side Platformer',
  capabilities: Object.freeze({ execution: 'local' as const, determinism: 'seeded' as const, outputProvenance: 'procedural' as const, requiresCredentials: false, supportsAbort: true, supportedProfiles: Object.freeze(['side-platformer'] as const), requiredReferenceRoles: Object.freeze(['environment-style', 'character'] as const), maxReferenceBytes: 16 * 1024 * 1024, maxOutputBytes: 128 * 1024 * 1024, maxRasterDimension: 8192 }),
  async generate(job: GenerationRequestJobV2, options?: { readonly signal?: AbortSignal }) { if (options?.signal?.aborted) throw new DOMException('Generation aborted.', 'AbortError'); return generateProceduralSidePlatformer(job); },
});
