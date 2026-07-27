import {
  LAYERED_DEPTH_COMPLETENESS_POLICY,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
  LAYERED_DEPTH_REQUIRED_ROLES,
} from './layered-depth-asset-bundle';
import {
  validateWorldLayoutPackBinding,
  type WorldLayoutPackBinding,
} from './world-layout-pack-binding';

export const ALPHA12_PACK_SCHEMA_VERSION = '0.9.0' as const;
export const ALPHA12_PACK_VERSION = '0.1.0-alpha.12' as const;
export const ALPHA12_RUNTIME_SCHEMA_VERSION = '0.4.0' as const;
export const ALPHA12_DIRECTIONS = Object.freeze(['left', 'right', 'near', 'far'] as const);
export const ALPHA12_LAYER_IDS = Object.freeze([
  'sky', 'far', 'mid', 'gameplay', 'near', 'lighting', 'foreground',
] as const);
export const ALPHA12_ATLAS_IDS = Object.freeze([
  'terrain', 'props', 'structures', 'collectibles', 'effects', 'player', 'npc',
] as const);
export const ALPHA12_PLANE_IDS = Object.freeze([
  'sky', 'far', 'mid', 'depth-fog', 'near', 'ambient-light', 'foreground',
] as const);
export const ALPHA12_PLAYER_CLIP_IDS = Object.freeze(LAYERED_DEPTH_PLAYER_ACTIONS.flatMap((action) =>
  ALPHA12_DIRECTIONS.map((direction) => `${action}.${direction}` as const)));
export const ALPHA12_NPC_CLIP_IDS = Object.freeze(LAYERED_DEPTH_NPC_ACTIONS.flatMap((action) =>
  ALPHA12_DIRECTIONS.map((direction) => `${action}.${direction}` as const)));

export interface DepthPoint { readonly x: number; readonly y: number }
export interface DepthRect extends DepthPoint { readonly width: number; readonly height: number }

export interface Alpha12SceneSidecar {
  readonly schema_version: typeof ALPHA12_RUNTIME_SCHEMA_VERSION;
  readonly profile: 'layered-depth-2d';
  readonly completeness_policy: typeof LAYERED_DEPTH_COMPLETENESS_POLICY;
  readonly bounds: DepthRect;
  readonly spawn: DepthPoint;
  readonly baseline_y: number;
  readonly layers: typeof ALPHA12_LAYER_IDS;
  readonly planes: readonly Readonly<{
    id: string;
    role: string;
    layer: typeof ALPHA12_LAYER_IDS[number];
    scroll_ratio: readonly [number, number];
    z_index: number;
    blend: 'mix' | 'add' | 'multiply';
    native_size: readonly [320, 180];
    repeat_size: readonly [320, 180];
    repeat_enabled: boolean;
  }>[];
  readonly placements: readonly Readonly<{
    id: string;
    role: string;
    layer: typeof ALPHA12_LAYER_IDS[number];
    x: number;
    y: number;
  }>[];
}

export interface Alpha12CollisionSidecar {
  readonly schema_version: typeof ALPHA12_RUNTIME_SCHEMA_VERSION;
  readonly profile: 'layered-depth-2d';
  readonly completeness_policy: typeof LAYERED_DEPTH_COMPLETENESS_POLICY;
  readonly bounds: DepthRect;
  readonly spawn: DepthPoint;
  readonly ground_segments: readonly Readonly<{
    id: string;
    from: DepthPoint;
    to: DepthPoint;
    one_way: boolean;
  }>[];
  readonly blockers: readonly Readonly<{ id: string; rect: DepthRect }>[];
  readonly hazards: readonly Readonly<{ id: string; kind: 'contact' | 'fall'; rect: DepthRect }>[];
}

export interface Alpha12NavigationSidecar {
  readonly schema_version: typeof ALPHA12_RUNTIME_SCHEMA_VERSION;
  readonly profile: 'layered-depth-2d';
  readonly completeness_policy: typeof LAYERED_DEPTH_COMPLETENESS_POLICY;
  readonly bounds: DepthRect;
  readonly spawn: DepthPoint;
  readonly nodes: readonly Readonly<{
    id: string;
    x: number;
    y: number;
    kind: 'spawn' | 'route' | 'checkpoint' | 'exit';
  }>[];
  readonly edges: readonly Readonly<{ from: string; to: string; kind: 'walk' | 'jump' | 'drop' }>[];
  readonly exit_node_id: string;
}

export interface Alpha12PackManifest {
  readonly schema_version: typeof ALPHA12_PACK_SCHEMA_VERSION;
  readonly pack: Readonly<{
    id: string;
    title: string;
    version: typeof ALPHA12_PACK_VERSION;
    generator: Readonly<{ name: 'Mapsoo Worldsmith'; version: typeof ALPHA12_PACK_VERSION }>;
    created_at: string;
  }>;
  readonly profile: 'layered-depth-2d';
  readonly completeness_policy: typeof LAYERED_DEPTH_COMPLETENESS_POLICY;
  readonly compatibility: Readonly<{
    godot_min: '4.3';
    projection: 'layered-depth-stage';
    art_style: 'pixel_art';
    importer: Readonly<{ id: 'mapsoo_importer'; min_version: typeof ALPHA12_PACK_VERSION }>;
  }>;
  readonly layers: readonly Readonly<{ id: typeof ALPHA12_LAYER_IDS[number]; order: number }>[];
  readonly atlases: readonly Readonly<{ id: typeof ALPHA12_ATLAS_IDS[number]; path: string }>[];
  readonly planes: readonly Readonly<{
    id: typeof ALPHA12_PLANE_IDS[number];
    role: string;
    path: string;
  }>[];
  readonly roles: readonly Readonly<{ role: typeof LAYERED_DEPTH_REQUIRED_ROLES[number]; path: string }>[];
  readonly characters: readonly Readonly<{
    id: 'player' | 'npc';
    atlas: string;
    frame_size: readonly [48, 72];
    pivot: readonly [24, 67];
    clips: readonly Readonly<{
      id: string;
      action: typeof LAYERED_DEPTH_PLAYER_ACTIONS[number] | typeof LAYERED_DEPTH_NPC_ACTIONS[number];
      direction: typeof ALPHA12_DIRECTIONS[number];
      fps: number;
      frames: readonly DepthPoint[];
    }>[];
  }>[];
  readonly runtime: Readonly<{
    scene: Readonly<{ path: string }>;
    collision: Readonly<{ path: string }>;
    navigation: Readonly<{ path: string }>;
    spawn: DepthPoint;
  }>;
  readonly layout?: Readonly<WorldLayoutPackBinding>;
  readonly files: readonly Readonly<{
    path: string;
    media_type: 'image/png' | 'application/json' | 'application/schema+json' | 'text/markdown';
    bytes: number;
    sha256: string;
  }>[];
  readonly license: Readonly<{ output: Readonly<{ id: string; notice_path: string; permits_redistribution: true }> }>;
  readonly provenance: Readonly<{
    provider: Readonly<{ id: string; version: string }>;
    output_provenance: 'procedural' | 'generative-ai' | 'hybrid';
    contains_generative_ai: boolean;
    model_provider: string | null;
    model: string | null;
    seed: string;
    human_curated: boolean;
  }>;
}

export interface Alpha12RuntimeIssue { readonly code: string; readonly message: string }
export interface MaterializedAlpha12Runtime {
  readonly bounds: DepthRect;
  readonly spawn: DepthPoint;
  readonly scene: Alpha12SceneSidecar;
  readonly collision: Alpha12CollisionSidecar;
  readonly navigation: Alpha12NavigationSidecar;
}

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const duplicate = (values: readonly string[]) => new Set(values).size !== values.length;
const samePoint = (a: DepthPoint, b: DepthPoint) => a.x === b.x && a.y === b.y;
const sameRect = (a: DepthRect, b: DepthRect) =>
  samePoint(a, b) && a.width === b.width && a.height === b.height;
const pointIn = (point: DepthPoint, bounds: DepthRect) =>
  Number.isFinite(point.x) && Number.isFinite(point.y)
  && point.x >= bounds.x && point.y >= bounds.y
  && point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height;
const rectIn = (rect: DepthRect, bounds: DepthRect) =>
  rect.width > 0 && rect.height > 0 && pointIn(rect, bounds)
  && rect.x + rect.width <= bounds.x + bounds.width
  && rect.y + rect.height <= bounds.y + bounds.height;

export function validateAlpha12PackManifest(manifest: Alpha12PackManifest): Alpha12RuntimeIssue[] {
  const issues: Alpha12RuntimeIssue[] = [];
  if (manifest.schema_version !== ALPHA12_PACK_SCHEMA_VERSION
    || manifest.pack.version !== ALPHA12_PACK_VERSION
    || manifest.pack.generator.version !== ALPHA12_PACK_VERSION) {
    issues.push({ code: 'manifest.version', message: 'Pack, generator and schema must identify Alpha12 Pack 0.9.' });
  }
  if (manifest.profile !== 'layered-depth-2d'
    || manifest.completeness_policy !== LAYERED_DEPTH_COMPLETENESS_POLICY) {
    issues.push({ code: 'manifest.profile', message: 'Pack 0.9 requires the complete layered-depth policy.' });
  }
  if (manifest.layers.length !== ALPHA12_LAYER_IDS.length
    || manifest.layers.some((layer, index) => layer.id !== ALPHA12_LAYER_IDS[index] || layer.order !== index)) {
    issues.push({ code: 'manifest.layers', message: 'Canonical depth layers must appear once and in order.' });
  }
  if (manifest.atlases.length !== ALPHA12_ATLAS_IDS.length
    || manifest.atlases.some((atlas, index) => atlas.id !== ALPHA12_ATLAS_IDS[index])) {
    issues.push({ code: 'manifest.atlases', message: 'Canonical layered-depth atlases must appear once and in order.' });
  }
  if (manifest.planes.length !== ALPHA12_PLANE_IDS.length
    || manifest.planes.some((plane, index) => plane.id !== ALPHA12_PLANE_IDS[index])) {
    issues.push({ code: 'manifest.planes', message: 'Canonical layered-depth planes must appear once and in order.' });
  }
  if (manifest.roles.length !== LAYERED_DEPTH_REQUIRED_ROLES.length
    || manifest.roles.some((role, index) => role.role !== LAYERED_DEPTH_REQUIRED_ROLES[index])) {
    issues.push({ code: 'manifest.roles', message: 'All canonical layered-depth roles must appear once and in order.' });
  }
  const expectedCharacters = [
    { id: 'player', clips: ALPHA12_PLAYER_CLIP_IDS },
    { id: 'npc', clips: ALPHA12_NPC_CLIP_IDS },
  ] as const;
  if (manifest.characters.length !== 2
    || expectedCharacters.some((expected, index) => {
      const character = manifest.characters[index];
      return !character || character.id !== expected.id
        || character.frame_size[0] !== 48 || character.frame_size[1] !== 72
        || character.pivot[0] !== 24 || character.pivot[1] !== 67
        || character.clips.length !== expected.clips.length
        || character.clips.some((clip, clipIndex) =>
          clip.id !== expected.clips[clipIndex] || clip.id !== `${clip.action}.${clip.direction}`);
    })) {
    issues.push({ code: 'manifest.character', message: 'Player, NPC and all 24 canonical clips are required.' });
  }
  const paths = manifest.files.map(({ path }) => path);
  if (duplicate(paths)
    || manifest.files.some(({ path, bytes, sha256 }) =>
      !SAFE_PATH.test(path) || !Number.isSafeInteger(bytes) || bytes < 1 || !SHA256.test(sha256))) {
    issues.push({ code: 'manifest.files', message: 'Files require unique safe paths and integrity metadata.' });
  }
  const known = new Set(paths);
  const referenced = [
    ...manifest.atlases.map(({ path }) => path),
    ...manifest.planes.map(({ path }) => path),
    ...manifest.roles.map(({ path }) => path),
    ...manifest.characters.map(({ atlas }) => atlas),
    manifest.runtime.scene.path,
    manifest.runtime.collision.path,
    manifest.runtime.navigation.path,
    manifest.license.output.notice_path,
    ...(manifest.layout ? [manifest.layout.path] : []),
  ];
  if (referenced.some((path) => !known.has(path))) {
    issues.push({ code: 'manifest.file-reference', message: 'Every referenced Pack 0.9 path must exist in files.' });
  }
  issues.push(...validateWorldLayoutPackBinding(manifest.layout, manifest.files));
  return issues;
}

export function materializeAlpha12Runtime(
  manifest: Alpha12PackManifest,
  scene: Alpha12SceneSidecar,
  collision: Alpha12CollisionSidecar,
  navigation: Alpha12NavigationSidecar,
): MaterializedAlpha12Runtime {
  const issues = validateAlpha12PackManifest(manifest);
  const sidecars = [scene, collision, navigation];
  if (sidecars.some((sidecar) =>
    sidecar.schema_version !== ALPHA12_RUNTIME_SCHEMA_VERSION
    || sidecar.profile !== 'layered-depth-2d'
    || sidecar.completeness_policy !== LAYERED_DEPTH_COMPLETENESS_POLICY)) {
    issues.push({ code: 'runtime.contract', message: 'Every sidecar must use the Alpha12 layered-depth contract.' });
  }
  if (!sameRect(scene.bounds, collision.bounds) || !sameRect(scene.bounds, navigation.bounds)) {
    issues.push({ code: 'runtime.bounds-mismatch', message: 'All runtime sidecars must share exact bounds.' });
  }
  if (!samePoint(manifest.runtime.spawn, scene.spawn)
    || !samePoint(scene.spawn, collision.spawn)
    || !samePoint(scene.spawn, navigation.spawn)) {
    issues.push({ code: 'runtime.spawn-mismatch', message: 'Manifest and all sidecars must share one spawn.' });
  }
  if (scene.layers.length !== ALPHA12_LAYER_IDS.length
    || scene.layers.some((layer, index) => layer !== ALPHA12_LAYER_IDS[index])
    || !Number.isFinite(scene.baseline_y)
    || !pointIn({ x: scene.bounds.x, y: scene.baseline_y }, scene.bounds)) {
    issues.push({ code: 'runtime.layers', message: 'The canonical stage layers and bounded baseline are required.' });
  }
  if (!pointIn(scene.spawn, scene.bounds)
    || scene.planes.some(({ scroll_ratio: ratio, z_index, blend, native_size: nativeSize, repeat_size: repeatSize }) =>
      ratio.length !== 2 || ratio.some((value) => !Number.isFinite(value) || value < 0 || value > 1.5)
      || !Number.isSafeInteger(z_index)
      || !(['mix', 'add', 'multiply'] as const).includes(blend)
      || nativeSize[0] !== 320 || nativeSize[1] !== 180
      || repeatSize[0] !== 320 || repeatSize[1] !== 180)
    || scene.placements.some((placement) => !pointIn(placement, scene.bounds))
    || collision.ground_segments.some((segment) =>
      !pointIn(segment.from, scene.bounds) || !pointIn(segment.to, scene.bounds)
      || segment.from.x >= segment.to.x)
    || collision.blockers.some(({ rect }) => !rectIn(rect, scene.bounds))
    || collision.hazards.some(({ rect }) => !rectIn(rect, scene.bounds))
    || navigation.nodes.some((node) => !pointIn(node, scene.bounds))) {
    issues.push({ code: 'runtime.out-of-bounds', message: 'Stage geometry must remain inside declared bounds.' });
  }
  if (duplicate(scene.planes.map(({ id }) => id))
    || duplicate(scene.placements.map(({ id }) => id))
    || duplicate(collision.ground_segments.map(({ id }) => id))
    || duplicate(collision.blockers.map(({ id }) => id))
    || duplicate(collision.hazards.map(({ id }) => id))
    || duplicate(navigation.nodes.map(({ id }) => id))) {
    issues.push({ code: 'runtime.duplicate-id', message: 'Runtime IDs must be unique within each collection.' });
  }
  const roles = new Set<string>(LAYERED_DEPTH_REQUIRED_ROLES);
  if (scene.planes.some(({ role }) => !roles.has(role))
    || scene.placements.some(({ role }) => !roles.has(role))) {
    issues.push({ code: 'runtime.unknown-role', message: 'Scene data refers to a non-canonical role.' });
  }
  const spawnNodes = navigation.nodes.filter(({ kind }) => kind === 'spawn');
  const exit = navigation.nodes.find(({ id, kind }) => id === navigation.exit_node_id && kind === 'exit');
  if (spawnNodes.length !== 1 || !samePoint(spawnNodes[0] ?? { x: -1, y: -1 }, scene.spawn) || !exit) {
    issues.push({ code: 'navigation.endpoints', message: 'Navigation requires one exact spawn and declared exit.' });
  }
  const nodeIds = new Set(navigation.nodes.map(({ id }) => id));
  if (navigation.edges.some(({ from, to }) => !nodeIds.has(from) || !nodeIds.has(to))) {
    issues.push({ code: 'navigation.edge-reference', message: 'Navigation edges must connect declared nodes.' });
  }
  if (spawnNodes[0] && exit) {
    const reached = new Set([spawnNodes[0].id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of navigation.edges) {
        if (reached.has(edge.from) && !reached.has(edge.to)) {
          reached.add(edge.to);
          changed = true;
        }
      }
    }
    if (!reached.has(exit.id)) {
      issues.push({ code: 'navigation.unreachable-exit', message: 'Exit must be reachable from spawn.' });
    }
  }
  if (issues.length > 0) {
    throw new Error(`Invalid Alpha12 runtime: ${issues.map(({ code }) => code).join(', ')}.`);
  }
  return Object.freeze({ bounds: scene.bounds, spawn: scene.spawn, scene, collision, navigation });
}
