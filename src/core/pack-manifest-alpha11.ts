import {
  ISOMETRIC_ACTION_COMPLETENESS_POLICY,
  ISOMETRIC_ACTION_DIRECTIONS,
  ISOMETRIC_ACTION_REQUIRED_ROLES,
  ISOMETRIC_ENEMY_ACTIONS,
  ISOMETRIC_PLAYER_ACTIONS,
} from './isometric-action-asset-bundle';
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

export const ALPHA11_PACK_SCHEMA_VERSION = '0.8.0' as const;
export const ALPHA11_PACK_VERSION = '0.1.0-alpha.11' as const;
export const ALPHA11_LAYER_IDS = Object.freeze([
  'void', 'floor', 'elevation', 'walls', 'props', 'actors', 'effects',
] as const);
export const ALPHA11_ATLAS_IDS = Object.freeze([
  'terrain', 'hazards', 'props', 'structures', 'collectibles',
  'effects', 'shadows', 'player', 'enemy-melee', 'enemy-ranged',
] as const);
export const ALPHA11_PLAYER_CLIP_IDS = Object.freeze(ISOMETRIC_PLAYER_ACTIONS.flatMap((action) =>
  ISOMETRIC_ACTION_DIRECTIONS.map((direction) => `${action}.${direction}` as const)));
export const ALPHA11_ENEMY_CLIP_IDS = Object.freeze(ISOMETRIC_ENEMY_ACTIONS.flatMap((action) =>
  ISOMETRIC_ACTION_DIRECTIONS.map((direction) => `${action}.${direction}` as const)));

export interface IsoPoint { readonly x: number; readonly y: number }
export interface IsoRect extends IsoPoint { readonly width: number; readonly height: number }
export interface IsoCell { readonly column: number; readonly row: number; readonly elevation: number }

export interface Alpha11SceneSidecar {
  readonly schema_version: '0.3.0';
  readonly profile: 'isometric-action';
  readonly completeness_policy: typeof ISOMETRIC_ACTION_COMPLETENESS_POLICY;
  readonly bounds: IsoRect;
  readonly grid: Readonly<{ tile_width: 64; tile_height: 32; elevation_height: 16; columns: number; rows: number }>;
  readonly spawn: IsoPoint;
  readonly layers: typeof ALPHA11_LAYER_IDS;
  readonly floor_cells: readonly IsoCell[];
  readonly placements: readonly Readonly<{
    id: string;
    role: string;
    layer: typeof ALPHA11_LAYER_IDS[number];
    column: number;
    row: number;
    elevation: number;
    x: number;
    y: number;
  }>[];
}

export interface Alpha11CollisionSidecar {
  readonly schema_version: '0.3.0';
  readonly profile: 'isometric-action';
  readonly completeness_policy: typeof ISOMETRIC_ACTION_COMPLETENESS_POLICY;
  readonly bounds: IsoRect;
  readonly spawn: IsoPoint;
  readonly walkable_polygon: readonly IsoPoint[];
  readonly blockers: readonly Readonly<{ id: string; rect: IsoRect }>[];
  readonly hazards: readonly Readonly<{ id: string; kind: 'trap' | 'area'; rect: IsoRect }>[];
}

export interface Alpha11NavigationSidecar {
  readonly schema_version: '0.3.0';
  readonly profile: 'isometric-action';
  readonly completeness_policy: typeof ISOMETRIC_ACTION_COMPLETENESS_POLICY;
  readonly bounds: IsoRect;
  readonly spawn: IsoPoint;
  readonly nodes: readonly Readonly<{
    id: string;
    x: number;
    y: number;
    elevation: number;
    kind: 'spawn' | 'route' | 'checkpoint' | 'exit';
  }>[];
  readonly edges: readonly Readonly<{ from: string; to: string; kind: 'walk' | 'stairs' | 'dash' }>[];
  readonly exit_node_id: string;
}

export interface Alpha11PackManifest {
  readonly schema_version: typeof ALPHA11_PACK_SCHEMA_VERSION;
  readonly pack: Readonly<{
    id: string;
    title: string;
    version: typeof ALPHA11_PACK_VERSION;
    generator: Readonly<{ name: 'Mapsoo Worldsmith'; version: typeof ALPHA11_PACK_VERSION }>;
    created_at: string;
  }>;
  readonly profile: 'isometric-action';
  readonly completeness_policy: typeof ISOMETRIC_ACTION_COMPLETENESS_POLICY;
  readonly compatibility: Readonly<{
    godot_min: '4.3';
    grid: 'diamond-64x32';
    art_style: 'pixel_art';
    importer: Readonly<{ id: 'mapsoo_importer'; min_version: typeof ALPHA11_PACK_VERSION }>;
  }>;
  readonly layers: readonly Readonly<{ id: typeof ALPHA11_LAYER_IDS[number]; order: number }>[];
  readonly atlases: readonly Readonly<{ id: typeof ALPHA11_ATLAS_IDS[number]; path: string }>[];
  readonly roles: readonly Readonly<{ role: typeof ISOMETRIC_ACTION_REQUIRED_ROLES[number]; path: string }>[];
  readonly characters: readonly Readonly<{
    id: string;
    atlas: string;
    frame_size: readonly [48, 64];
    pivot: readonly [24, 58];
    clips: readonly Readonly<{
      id: string;
      action: typeof ISOMETRIC_PLAYER_ACTIONS[number] | typeof ISOMETRIC_ENEMY_ACTIONS[number];
      direction: typeof ISOMETRIC_ACTION_DIRECTIONS[number];
      fps: number;
      frames: readonly IsoPoint[];
    }>[];
  }>[];
  readonly runtime: Readonly<{
    scene: Readonly<{ path: string }>;
    collision: Readonly<{ path: string }>;
    navigation: Readonly<{ path: string }>;
    spawn: IsoPoint;
  }>;
  readonly layout?: Readonly<WorldLayoutPackBinding>;
  readonly material_palette?: Readonly<WorldMaterialPalettePackBinding>;
  readonly files: readonly Readonly<{
    path: string;
    media_type: 'image/png' | 'application/json' | 'application/schema+json' | 'text/markdown';
    bytes: number;
    sha256: string;
  }>[];
  readonly license: Readonly<{ output: Readonly<PackOutputLicense> }>;
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

export interface Alpha11RuntimeIssue { readonly code: string; readonly message: string }
export interface MaterializedAlpha11Runtime {
  readonly bounds: IsoRect;
  readonly spawn: IsoPoint;
  readonly scene: Alpha11SceneSidecar;
  readonly collision: Alpha11CollisionSidecar;
  readonly navigation: Alpha11NavigationSidecar;
}

const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const duplicate = (values: readonly string[]) => new Set(values).size !== values.length;
const samePoint = (a: IsoPoint, b: IsoPoint) => a.x === b.x && a.y === b.y;
const sameRect = (a: IsoRect, b: IsoRect) => samePoint(a, b) && a.width === b.width && a.height === b.height;
const pointIn = (point: IsoPoint, bounds: IsoRect) =>
  Number.isFinite(point.x) && Number.isFinite(point.y)
  && point.x >= bounds.x && point.y >= bounds.y
  && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;
const rectIn = (rect: IsoRect, bounds: IsoRect) =>
  rect.width > 0 && rect.height > 0 && pointIn(rect, bounds)
  && rect.x + rect.width <= bounds.x + bounds.width
  && rect.y + rect.height <= bounds.y + bounds.height;

export function validateAlpha11PackManifest(manifest: Alpha11PackManifest): Alpha11RuntimeIssue[] {
  const issues: Alpha11RuntimeIssue[] = [];
  if (manifest.schema_version !== ALPHA11_PACK_SCHEMA_VERSION
    || manifest.pack.version !== ALPHA11_PACK_VERSION
    || manifest.pack.generator.version !== ALPHA11_PACK_VERSION) {
    issues.push({ code: 'manifest.version', message: 'Pack, generator and schema versions must identify Alpha11 Pack 0.8.' });
  }
  if (manifest.profile !== 'isometric-action'
    || manifest.completeness_policy !== ISOMETRIC_ACTION_COMPLETENESS_POLICY) {
    issues.push({ code: 'manifest.profile', message: 'Pack 0.8 requires the complete isometric-action policy.' });
  }
  if (manifest.layers.length !== ALPHA11_LAYER_IDS.length
    || manifest.layers.some((layer, index) => layer.id !== ALPHA11_LAYER_IDS[index] || layer.order !== index)) {
    issues.push({ code: 'manifest.layers', message: 'Canonical layers must appear once and in order.' });
  }
  if (manifest.atlases.length !== ALPHA11_ATLAS_IDS.length
    || manifest.atlases.some((atlas, index) => atlas.id !== ALPHA11_ATLAS_IDS[index])) {
    issues.push({ code: 'manifest.atlases', message: 'Canonical atlases must appear once and in order.' });
  }
  if (manifest.roles.length !== ISOMETRIC_ACTION_REQUIRED_ROLES.length
    || manifest.roles.some((role, index) => role.role !== ISOMETRIC_ACTION_REQUIRED_ROLES[index])) {
    issues.push({ code: 'manifest.roles', message: 'All canonical isometric roles must appear once and in order.' });
  }
  const expectedCharacters = [
    { id: 'player', clips: ALPHA11_PLAYER_CLIP_IDS },
    { id: 'enemy-melee', clips: ALPHA11_ENEMY_CLIP_IDS },
    { id: 'enemy-ranged', clips: ALPHA11_ENEMY_CLIP_IDS },
  ] as const;
  if (manifest.characters.length !== expectedCharacters.length
    || expectedCharacters.some((expected, characterIndex) => {
      const character = manifest.characters[characterIndex];
      return !character || character.id !== expected.id
        || character.frame_size[0] !== 48 || character.frame_size[1] !== 64
        || character.pivot[0] !== 24 || character.pivot[1] !== 58
        || character.clips.length !== expected.clips.length
        || character.clips.some((clip, clipIndex) =>
          clip.id !== expected.clips[clipIndex] || clip.id !== `${clip.action}.${clip.direction}`);
    })) {
    issues.push({ code: 'manifest.character', message: 'Three canonical characters and all 128 clips are required.' });
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
    ...manifest.roles.map(({ path }) => path),
    ...manifest.characters.map(({ atlas }) => atlas),
    manifest.runtime.scene.path,
    manifest.runtime.collision.path,
    manifest.runtime.navigation.path,
    manifest.license.output.notice_path,
    ...(manifest.layout ? [manifest.layout.path] : []),
  ];
  if (referenced.some((path) => !known.has(path))) {
    issues.push({ code: 'manifest.file-reference', message: 'Every referenced path must exist in files.' });
  }
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

/** Materialize only mutually consistent, bounded and traversable isometric runtime data. */
export function materializeAlpha11Runtime(
  manifest: Alpha11PackManifest,
  scene: Alpha11SceneSidecar,
  collision: Alpha11CollisionSidecar,
  navigation: Alpha11NavigationSidecar,
): MaterializedAlpha11Runtime {
  const issues = validateAlpha11PackManifest(manifest);
  const sidecars = [scene, collision, navigation];
  if (sidecars.some((sidecar) =>
    sidecar.schema_version !== '0.3.0'
    || sidecar.profile !== 'isometric-action'
    || sidecar.completeness_policy !== ISOMETRIC_ACTION_COMPLETENESS_POLICY)) {
    issues.push({ code: 'runtime.contract', message: 'Every sidecar must use the Alpha11 isometric contract.' });
  }
  if (!sameRect(scene.bounds, collision.bounds) || !sameRect(scene.bounds, navigation.bounds)) {
    issues.push({ code: 'runtime.bounds-mismatch', message: 'All runtime sidecars must share exact pixel bounds.' });
  }
  if (!samePoint(manifest.runtime.spawn, scene.spawn)
    || !samePoint(scene.spawn, collision.spawn)
    || !samePoint(scene.spawn, navigation.spawn)) {
    issues.push({ code: 'runtime.spawn-mismatch', message: 'Manifest and all sidecars must share one exact spawn.' });
  }
  if (scene.grid.tile_width !== 64 || scene.grid.tile_height !== 32 || scene.grid.elevation_height !== 16
    || scene.grid.columns < 4 || scene.grid.rows < 4) {
    issues.push({ code: 'runtime.grid', message: 'A bounded 64x32 diamond grid is required.' });
  }
  if (!pointIn(scene.spawn, scene.bounds)
    || scene.floor_cells.some(({ column, row, elevation }) =>
      !Number.isSafeInteger(column) || !Number.isSafeInteger(row) || !Number.isSafeInteger(elevation)
      || column < 0 || row < 0 || column >= scene.grid.columns || row >= scene.grid.rows || elevation < 0 || elevation > 8)
    || scene.placements.some((placement) => !pointIn(placement, scene.bounds))
    || collision.blockers.some(({ rect }) => !rectIn(rect, scene.bounds))
    || collision.hazards.some(({ rect }) => !rectIn(rect, scene.bounds))
    || navigation.nodes.some((node) => !pointIn(node, scene.bounds))) {
    issues.push({ code: 'runtime.out-of-bounds', message: 'Runtime geometry must remain inside declared bounds and grid.' });
  }
  if (collision.walkable_polygon.length < 3
    || collision.walkable_polygon.some((point) => !pointIn(point, scene.bounds))) {
    issues.push({ code: 'runtime.walkable', message: 'Walkable polygon must be a bounded polygon.' });
  }
  if (duplicate(scene.placements.map(({ id }) => id))
    || duplicate(collision.blockers.map(({ id }) => id))
    || duplicate(collision.hazards.map(({ id }) => id))
    || duplicate(navigation.nodes.map(({ id }) => id))) {
    issues.push({ code: 'runtime.duplicate-id', message: 'Runtime IDs must be unique within each collection.' });
  }
  const roles = new Set<string>(ISOMETRIC_ACTION_REQUIRED_ROLES);
  if (scene.placements.some(({ role }) => !roles.has(role))) {
    issues.push({ code: 'runtime.unknown-role', message: 'Scene placement refers to a non-canonical role.' });
  }
  const spawnNodes = navigation.nodes.filter(({ kind }) => kind === 'spawn');
  const exit = navigation.nodes.find(({ id, kind }) => id === navigation.exit_node_id && kind === 'exit');
  if (spawnNodes.length !== 1 || !samePoint(spawnNodes[0] ?? { x: -1, y: -1 }, scene.spawn) || !exit) {
    issues.push({ code: 'navigation.endpoints', message: 'Navigation requires one exact spawn node and its declared exit.' });
  }
  const nodeIds = new Set(navigation.nodes.map(({ id }) => id));
  if (navigation.edges.some(({ from, to }) => !nodeIds.has(from) || !nodeIds.has(to))) {
    issues.push({ code: 'navigation.edge-reference', message: 'Every navigation edge must connect declared nodes.' });
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
    throw new Error(`Invalid Alpha11 runtime: ${issues.map(({ code }) => code).join(', ')}.`);
  }
  return Object.freeze({ bounds: scene.bounds, spawn: scene.spawn, scene, collision, navigation });
}
