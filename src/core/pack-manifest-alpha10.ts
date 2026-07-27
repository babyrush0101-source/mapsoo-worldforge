import {
  SIDE_PLATFORMER_ACTIONS,
  SIDE_PLATFORMER_COMPLETENESS_POLICY,
  SIDE_PLATFORMER_DIRECTIONS,
  SIDE_PLATFORMER_REQUIRED_ROLES,
} from './side-platformer-asset-bundle';
import {
  validatePackOutputAuthorization,
  type PackOutputLicense,
} from './production-review-pack-license';
import {
  validateWorldLayoutPackBinding,
  type WorldLayoutPackBinding,
} from './world-layout-pack-binding';
import {
  validateWorldMaterialPalettePackBinding,
  type WorldMaterialPalettePackBinding,
} from './world-material-palette';

export const ALPHA10_PACK_SCHEMA_VERSION = '0.7.0' as const;
export const ALPHA10_PACK_VERSION = '0.1.0-alpha.10' as const;
export const ALPHA10_LAYER_IDS = Object.freeze(['background-far', 'background-mid', 'background-near', 'world', 'foreground'] as const);
export const ALPHA10_ATLAS_IDS = Object.freeze(['terrain', 'hazards', 'props', 'structures', 'collectibles', 'backgrounds', 'foreground', 'character'] as const);
export const ALPHA10_CLIP_IDS = Object.freeze(SIDE_PLATFORMER_ACTIONS.flatMap((action) => SIDE_PLATFORMER_DIRECTIONS.map((direction) => `${action}.${direction}` as const)));

export interface PixelPoint { readonly x: number; readonly y: number }
export interface PixelRect extends PixelPoint { readonly width: number; readonly height: number }
export interface Alpha10SceneSidecar {
  readonly schema_version: '0.2.0'; readonly profile: 'side-platformer'; readonly completeness_policy: typeof SIDE_PLATFORMER_COMPLETENESS_POLICY;
  readonly bounds: PixelRect; readonly spawn: PixelPoint; readonly layers: typeof ALPHA10_LAYER_IDS;
  readonly placements: readonly Readonly<{ id: string; role: string; layer: typeof ALPHA10_LAYER_IDS[number]; x: number; y: number; flip_x?: boolean }>[];
}
export interface Alpha10CollisionSidecar {
  readonly schema_version: '0.2.0'; readonly profile: 'side-platformer'; readonly completeness_policy: typeof SIDE_PLATFORMER_COMPLETENESS_POLICY;
  readonly bounds: PixelRect; readonly spawn: PixelPoint;
  readonly surfaces: readonly Readonly<{ id: string; kind: 'solid' | 'one-way'; rect: PixelRect }>[];
  readonly hazards: readonly Readonly<{ id: string; kind: 'spikes' | 'pit'; rect: PixelRect }>[];
}
export interface Alpha10NavigationSidecar {
  readonly schema_version: '0.2.0'; readonly profile: 'side-platformer'; readonly completeness_policy: typeof SIDE_PLATFORMER_COMPLETENESS_POLICY;
  readonly bounds: PixelRect; readonly spawn: PixelPoint;
  readonly nodes: readonly Readonly<{ id: string; x: number; y: number; kind: 'spawn' | 'platform' | 'checkpoint' | 'exit' }>[];
  readonly edges: readonly Readonly<{ from: string; to: string; kind: 'walk' | 'jump' | 'drop' | 'moving-platform' }>[];
  readonly exit_node_id: string;
}

export interface Alpha10PackManifest {
  readonly schema_version: typeof ALPHA10_PACK_SCHEMA_VERSION;
  readonly pack: Readonly<{ id: string; title: string; version: typeof ALPHA10_PACK_VERSION; generator: Readonly<{ name: 'Mapsoo Worldsmith'; version: typeof ALPHA10_PACK_VERSION }>; created_at: string }>;
  readonly profile: 'side-platformer'; readonly completeness_policy: typeof SIDE_PLATFORMER_COMPLETENESS_POLICY;
  readonly compatibility: Readonly<{ godot_min: '4.3'; grid: 'pixel'; art_style: 'pixel_art'; importer: Readonly<{ id: 'mapsoo_importer'; min_version: typeof ALPHA10_PACK_VERSION }> }>;
  readonly layers: readonly Readonly<{ id: typeof ALPHA10_LAYER_IDS[number]; order: number }>[];
  readonly atlases: readonly Readonly<{ id: typeof ALPHA10_ATLAS_IDS[number]; path: string }>[];
  readonly roles: readonly Readonly<{ role: typeof SIDE_PLATFORMER_REQUIRED_ROLES[number]; path: string }>[];
  readonly character: Readonly<{ id: string; atlas: string; frame_size: readonly [number, number]; pivot: readonly [number, number]; clips: readonly Readonly<{ id: string; action: typeof SIDE_PLATFORMER_ACTIONS[number]; direction: typeof SIDE_PLATFORMER_DIRECTIONS[number]; fps: number; frames: readonly PixelPoint[] }>[] }>;
  readonly runtime: Readonly<{ scene: Readonly<{ path: string }>; collision: Readonly<{ path: string }>; navigation: Readonly<{ path: string }>; spawn: PixelPoint }>;
  readonly layout?: Readonly<WorldLayoutPackBinding>;
  readonly material_palette?: Readonly<WorldMaterialPalettePackBinding>;
  readonly files: readonly Readonly<{ path: string; media_type: 'image/png' | 'application/json' | 'application/schema+json' | 'text/markdown'; bytes: number; sha256: string }>[];
  readonly license: Readonly<{ output: Readonly<PackOutputLicense> }>;
  readonly provenance: Readonly<{ provider: Readonly<{ id: string; version: string }>; output_provenance: 'procedural' | 'generative-ai' | 'hybrid'; contains_generative_ai: boolean; model_provider: string | null; model: string | null; seed: string; human_curated: boolean }>;
}

export interface Alpha10RuntimeIssue { readonly code: string; readonly message: string }
export interface MaterializedAlpha10Runtime { readonly bounds: PixelRect; readonly spawn: PixelPoint; readonly scene: Alpha10SceneSidecar; readonly collision: Alpha10CollisionSidecar; readonly navigation: Alpha10NavigationSidecar }

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const samePoint = (a: PixelPoint, b: PixelPoint) => a.x === b.x && a.y === b.y;
const sameRect = (a: PixelRect, b: PixelRect) => samePoint(a, b) && a.width === b.width && a.height === b.height;
const pointIn = (point: PixelPoint, bounds: PixelRect) => point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;
const rectIn = (rect: PixelRect, bounds: PixelRect) => rect.width > 0 && rect.height > 0 && pointIn(rect, bounds) && rect.x + rect.width <= bounds.x + bounds.width && rect.y + rect.height <= bounds.y + bounds.height;
const duplicate = (values: readonly string[]) => new Set(values).size !== values.length;

export function validateAlpha10PackManifest(manifest: Alpha10PackManifest): Alpha10RuntimeIssue[] {
  const issues: Alpha10RuntimeIssue[] = [];
  if (manifest.schema_version !== ALPHA10_PACK_SCHEMA_VERSION || manifest.pack.version !== ALPHA10_PACK_VERSION || manifest.pack.generator.version !== ALPHA10_PACK_VERSION) issues.push({ code: 'manifest.version', message: 'Pack, generator, and schema versions must identify Alpha10 Pack 0.7.' });
  if (manifest.profile !== 'side-platformer' || manifest.completeness_policy !== SIDE_PLATFORMER_COMPLETENESS_POLICY) issues.push({ code: 'manifest.profile', message: 'Pack 0.7 requires the complete side-platformer policy.' });
  if (manifest.layers.length !== ALPHA10_LAYER_IDS.length || manifest.layers.some((layer, i) => layer.id !== ALPHA10_LAYER_IDS[i] || layer.order !== i)) issues.push({ code: 'manifest.layers', message: 'Canonical layers must appear once in order.' });
  if (manifest.atlases.length !== ALPHA10_ATLAS_IDS.length || manifest.atlases.some((atlas, i) => atlas.id !== ALPHA10_ATLAS_IDS[i])) issues.push({ code: 'manifest.atlases', message: 'Canonical atlases must appear once in order.' });
  if (manifest.roles.length !== SIDE_PLATFORMER_REQUIRED_ROLES.length || manifest.roles.some((role, i) => role.role !== SIDE_PLATFORMER_REQUIRED_ROLES[i])) issues.push({ code: 'manifest.roles', message: 'All 30 canonical roles must appear once in order.' });
  if (manifest.character.clips.length !== ALPHA10_CLIP_IDS.length || manifest.character.clips.some((clip, i) => clip.id !== ALPHA10_CLIP_IDS[i] || clip.id !== `${clip.action}.${clip.direction}`)) issues.push({ code: 'manifest.clips', message: 'All 12 canonical clips must appear once in order.' });
  const paths = manifest.files.map((file) => file.path);
  if (duplicate(paths) || manifest.files.some((file) => !SAFE_PATH.test(file.path) || file.bytes < 1 || !Number.isSafeInteger(file.bytes) || !SHA256.test(file.sha256))) issues.push({ code: 'manifest.files', message: 'Files require unique safe paths and valid integrity metadata.' });
  const known = new Set(paths);
  const referenced = [...manifest.atlases.map((x) => x.path), ...manifest.roles.map((x) => x.path), manifest.character.atlas, manifest.runtime.scene.path, manifest.runtime.collision.path, manifest.runtime.navigation.path, manifest.license.output.notice_path, ...(manifest.layout ? [manifest.layout.path] : [])];
  if (referenced.some((path) => !known.has(path))) issues.push({ code: 'manifest.file-reference', message: 'Every referenced path must exist in files.' });
  issues.push(...validateWorldLayoutPackBinding(manifest.layout, manifest.files));
  issues.push(...validateWorldMaterialPalettePackBinding(
    manifest.material_palette,
    manifest.layout,
    manifest.files,
  ));
  for (const code of validatePackOutputAuthorization(manifest.license.output, manifest.provenance)) {
    issues.push({ code, message: 'Pack output license and provenance are not an authorized public or internal-review pair.' });
  }
  return issues;
}

/** Materializes only a mutually consistent, bounded and traversable runtime contract. */
export function materializeAlpha10Runtime(manifest: Alpha10PackManifest, scene: Alpha10SceneSidecar, collision: Alpha10CollisionSidecar, navigation: Alpha10NavigationSidecar): MaterializedAlpha10Runtime {
  const issues = validateAlpha10PackManifest(manifest);
  const sidecars = [scene, collision, navigation];
  if (sidecars.some((sidecar) => sidecar.schema_version !== '0.2.0' || sidecar.profile !== 'side-platformer' || sidecar.completeness_policy !== SIDE_PLATFORMER_COMPLETENESS_POLICY)) issues.push({ code: 'runtime.contract', message: 'Every sidecar must use the Alpha10 side-platformer contract.' });
  if (!sameRect(scene.bounds, collision.bounds) || !sameRect(scene.bounds, navigation.bounds)) issues.push({ code: 'runtime.bounds-mismatch', message: 'All runtime sidecars must share exact pixel bounds.' });
  if (!samePoint(manifest.runtime.spawn, scene.spawn) || !samePoint(scene.spawn, collision.spawn) || !samePoint(scene.spawn, navigation.spawn)) issues.push({ code: 'runtime.spawn-mismatch', message: 'Manifest and all sidecars must share one exact pixel spawn.' });
  if (!pointIn(scene.spawn, scene.bounds) || scene.placements.some((p) => !pointIn(p, scene.bounds)) || collision.surfaces.some((s) => !rectIn(s.rect, scene.bounds)) || collision.hazards.some((h) => !rectIn(h.rect, scene.bounds)) || navigation.nodes.some((n) => !pointIn(n, scene.bounds))) issues.push({ code: 'runtime.out-of-bounds', message: 'Spawn and runtime geometry must remain inside pixel bounds.' });
  if (duplicate(scene.placements.map((x) => x.id)) || duplicate(collision.surfaces.map((x) => x.id)) || duplicate(collision.hazards.map((x) => x.id)) || duplicate(navigation.nodes.map((x) => x.id))) issues.push({ code: 'runtime.duplicate-id', message: 'Runtime IDs must be unique within each collection.' });
  const roles = new Set<string>(SIDE_PLATFORMER_REQUIRED_ROLES);
  if (scene.placements.some((p) => !roles.has(p.role))) issues.push({ code: 'runtime.unknown-role', message: 'Scene placement refers to a non-canonical role.' });
  const spawnNodes = navigation.nodes.filter((node) => node.kind === 'spawn');
  const exit = navigation.nodes.find((node) => node.id === navigation.exit_node_id && node.kind === 'exit');
  if (spawnNodes.length !== 1 || !samePoint(spawnNodes[0] ?? { x: -1, y: -1 }, scene.spawn) || !exit) issues.push({ code: 'navigation.endpoints', message: 'Navigation requires one exact spawn node and its declared exit node.' });
  const nodeIds = new Set(navigation.nodes.map((node) => node.id));
  if (navigation.edges.some((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))) issues.push({ code: 'navigation.edge-reference', message: 'Every navigation edge must connect declared nodes.' });
  if (spawnNodes[0] && exit) {
    const reached = new Set([spawnNodes[0].id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of navigation.edges) if (reached.has(edge.from) && !reached.has(edge.to)) { reached.add(edge.to); changed = true; }
    }
    if (!reached.has(exit.id)) issues.push({ code: 'navigation.unreachable-exit', message: 'The exit must be reachable from spawn through directed movement edges.' });
  }
  const support = collision.surfaces.some(({ rect }) => scene.spawn.x >= rect.x && scene.spawn.x < rect.x + rect.width && scene.spawn.y === rect.y);
  if (!support) issues.push({ code: 'collision.unsupported-spawn', message: 'Spawn must sit on the top edge of a collision surface.' });
  if (issues.length) throw new Error(`Invalid Alpha10 runtime: ${issues.map(({ code }) => code).join(', ')}.`);
  return Object.freeze({ bounds: scene.bounds, spawn: scene.spawn, scene, collision, navigation });
}
