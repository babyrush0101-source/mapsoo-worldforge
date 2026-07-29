import {
  TOPDOWN_FARM_COMPLETENESS_POLICY,
  TOPDOWN_FARM_REQUIRED_ROLES,
  type CharacterAction,
  type CharacterDirection,
} from './generated-asset-bundle';
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
import {
  validateWorldTerrainAutotilePackBinding,
  type WorldTerrainAutotilePackBinding,
} from './world-terrain-autotile-set';

export const ALPHA9_PACK_SCHEMA_VERSION = '0.6.0' as const;
export const ALPHA9_PACK_VERSION = '0.1.0-alpha.9' as const;
export const ALPHA9_PROFILE = 'topdown-farm' as const;

export const ALPHA9_LAYER_IDS = Object.freeze([
  'ground', 'water', 'paths', 'soil', 'props', 'structures', 'crops',
] as const);

export const ALPHA9_ATLAS_IDS = Object.freeze([
  'terrain', 'props', 'structures', 'crops', 'character',
] as const);

export const ALPHA9_CLIP_IDS = Object.freeze([
  'idle.north', 'idle.east', 'idle.south', 'idle.west',
  'walk.north', 'walk.east', 'walk.south', 'walk.west',
] as const);

export type Alpha9LayerId = typeof ALPHA9_LAYER_IDS[number];
export type Alpha9AtlasId = typeof ALPHA9_ATLAS_IDS[number];
export type Alpha9ClipId = typeof ALPHA9_CLIP_IDS[number];

export interface Alpha9FileRecord {
  readonly path: string;
  readonly media_type: 'image/png' | 'application/json' | 'application/schema+json' | 'text/markdown';
  readonly bytes: number;
  readonly sha256: string;
}

export interface Alpha9PackManifest {
  readonly schema_version: typeof ALPHA9_PACK_SCHEMA_VERSION;
  readonly pack: Readonly<{
    id: string;
    title: string;
    version: typeof ALPHA9_PACK_VERSION;
    generator: Readonly<{ name: 'Mapsoo Worldsmith'; version: typeof ALPHA9_PACK_VERSION }>;
    created_at: string;
  }>;
  readonly profile: typeof ALPHA9_PROFILE;
  readonly completeness_policy: typeof TOPDOWN_FARM_COMPLETENESS_POLICY;
  readonly compatibility: Readonly<{
    godot_min: '4.3';
    grid: 'orthogonal';
    art_style: 'pixel_art';
    importer: Readonly<{ id: 'mapsoo_importer'; min_version: typeof ALPHA9_PACK_VERSION }>;
  }>;
  readonly layers: readonly Readonly<{ id: Alpha9LayerId; order: number }>[];
  readonly atlases: readonly Readonly<{ id: Alpha9AtlasId; path: string }>[];
  readonly roles: readonly Readonly<{ role: typeof TOPDOWN_FARM_REQUIRED_ROLES[number]; path: string }>[];
  readonly character: Readonly<{
    id: string;
    atlas: string;
    frame_size: readonly [number, number];
    pivot: readonly [number, number];
    clips: readonly Readonly<{
      id: Alpha9ClipId;
      action: CharacterAction;
      direction: CharacterDirection;
      fps: number;
      frames: readonly Readonly<{ x: number; y: number }>[];
    }>[];
  }>;
  readonly runtime: Readonly<{
    scene: Readonly<{ path: string }>;
    collision: Readonly<{ path: string }>;
    navigation: Readonly<{ path: string }>;
    spawn: Readonly<{ x: number; y: number }>;
  }>;
  readonly layout?: Readonly<WorldLayoutPackBinding>;
  readonly material_palette?: Readonly<WorldMaterialPalettePackBinding>;
  readonly terrain_autotiles?: Readonly<WorldTerrainAutotilePackBinding>;
  readonly files: readonly Alpha9FileRecord[];
  readonly license: Readonly<{
    output: Readonly<PackOutputLicense>;
  }>;
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

const SAFE_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\\)[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MIME = new Set(['image/png', 'application/json', 'application/schema+json', 'text/markdown']);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  'description', 'references', 'reference', 'sourceReferenceIds', 'source_reference_ids',
  'referencePath', 'reference_path', 'referenceHash', 'reference_hash', 'originalPath',
  'original_path', 'originalHash', 'original_hash',
]);

export interface Alpha9ManifestIssue { readonly code: string; readonly message: string }

function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 240 && SAFE_PATH.test(value);
}

function scanForbiddenKeys(value: unknown, issues: Alpha9ManifestIssue[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => scanForbiddenKeys(item, issues));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) {
      issues.push({ code: 'privacy.reference-metadata', message: `Public manifest contains forbidden reference field: ${key}.` });
    }
    scanForbiddenKeys(child, issues);
  }
}

export function validateAlpha9PackManifest(manifest: Alpha9PackManifest): Alpha9ManifestIssue[] {
  const issues: Alpha9ManifestIssue[] = [];
  scanForbiddenKeys(manifest, issues);
  if (manifest.schema_version !== ALPHA9_PACK_SCHEMA_VERSION) issues.push({ code: 'manifest.schema-version', message: 'Pack schema must be 0.6.0.' });
  if (manifest.pack.version !== ALPHA9_PACK_VERSION || manifest.pack.generator.version !== ALPHA9_PACK_VERSION) issues.push({ code: 'manifest.pack-version', message: 'Pack and generator versions must identify Alpha.9.' });
  if (manifest.profile !== ALPHA9_PROFILE) issues.push({ code: 'manifest.profile', message: 'Pack 0.6 is topdown-farm-only.' });
  if (manifest.completeness_policy !== TOPDOWN_FARM_COMPLETENESS_POLICY) issues.push({ code: 'manifest.completeness', message: 'The complete farm policy is required.' });

  if (manifest.layers.length !== ALPHA9_LAYER_IDS.length || manifest.layers.some((layer, index) => layer.id !== ALPHA9_LAYER_IDS[index] || layer.order !== index)) {
    issues.push({ code: 'manifest.layers', message: 'The seven canonical layers must appear once in canonical order.' });
  }
  if (manifest.atlases.length !== ALPHA9_ATLAS_IDS.length || manifest.atlases.some((atlas, index) => atlas.id !== ALPHA9_ATLAS_IDS[index])) {
    issues.push({ code: 'manifest.atlases', message: 'The five canonical atlases must appear once in canonical order.' });
  }
  if (manifest.roles.length !== TOPDOWN_FARM_REQUIRED_ROLES.length || manifest.roles.some((binding, index) => binding.role !== TOPDOWN_FARM_REQUIRED_ROLES[index])) {
    issues.push({ code: 'manifest.roles', message: 'All 21 canonical asset roles must appear once in canonical order.' });
  }
  if (manifest.character.clips.length !== ALPHA9_CLIP_IDS.length || manifest.character.clips.some((clip, index) => {
    const expected = ALPHA9_CLIP_IDS[index];
    return clip.id !== expected || clip.id !== `${clip.action}.${clip.direction}`;
  })) issues.push({ code: 'manifest.character-clips', message: 'The player must contain the eight canonical idle/walk clips.' });

  const paths = new Set<string>();
  for (const file of manifest.files) {
    if (!safePath(file.path) || paths.has(file.path)) issues.push({ code: 'file.path', message: `File paths must be unique safe relative paths: ${file.path}.` });
    paths.add(file.path);
    if (!MIME.has(file.media_type)) issues.push({ code: 'file.media-type', message: `Unsupported media type for ${file.path}.` });
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 1 || !SHA256.test(file.sha256)) issues.push({ code: 'file.integrity', message: `Invalid size or SHA-256 for ${file.path}.` });
  }
  const referencedPaths = [
    ...manifest.atlases.map(({ path }) => path), ...manifest.roles.map(({ path }) => path),
    manifest.character.atlas, manifest.runtime.scene.path, manifest.runtime.collision.path,
    manifest.runtime.navigation.path, manifest.license.output.notice_path,
    ...(manifest.layout ? [manifest.layout.path] : []),
    ...(manifest.material_palette ? [manifest.material_palette.path] : []),
    ...(manifest.terrain_autotiles ? [manifest.terrain_autotiles.path] : []),
  ];
  for (const path of referencedPaths) {
    if (!safePath(path) || !paths.has(path)) issues.push({ code: 'file.missing-reference', message: `Manifest path is absent from files: ${path}.` });
  }
  for (const atlas of manifest.atlases) {
    if (manifest.files.find(({ path }) => path === atlas.path)?.media_type !== 'image/png') issues.push({ code: 'atlas.media-type', message: `Atlas must reference PNG: ${atlas.path}.` });
  }
  for (const path of [manifest.runtime.scene.path, manifest.runtime.collision.path, manifest.runtime.navigation.path]) {
    if (manifest.files.find((file) => file.path === path)?.media_type !== 'application/json') issues.push({ code: 'runtime.media-type', message: `Runtime sidecar must reference JSON: ${path}.` });
  }
  if (manifest.character.atlas !== manifest.atlases[4]?.path) issues.push({ code: 'character.atlas', message: 'Player character must reference the canonical character atlas.' });
  if (!SAFE_ID.test(manifest.character.id) || !manifest.character.clips.every((clip) => clip.frames.length > 0 && clip.frames.every((frame) => Number.isSafeInteger(frame.x) && frame.x >= 0 && Number.isSafeInteger(frame.y) && frame.y >= 0))) issues.push({ code: 'character.geometry', message: 'Character identity and frame coordinates must be valid.' });
  if (!SAFE_ID.test(manifest.provenance.provider.id) || !manifest.provenance.provider.version.trim() || !manifest.provenance.seed.trim()) issues.push({ code: 'provenance.invalid', message: 'Provider identity, version, and public generation seed are required.' });
  issues.push(...validateWorldLayoutPackBinding(manifest.layout, manifest.files));
  issues.push(...validateWorldMaterialPalettePackBinding(
    manifest.material_palette,
    manifest.layout,
    manifest.files,
  ));
  issues.push(...validateWorldTerrainAutotilePackBinding(
    manifest.terrain_autotiles,
    manifest.layout,
    manifest.material_palette,
    manifest.files,
  ));
  if (manifest.provenance.contains_generative_ai && (!manifest.provenance.model_provider?.trim() || !manifest.provenance.model?.trim())) issues.push({ code: 'provenance.model', message: 'Generative output must disclose model provider and model.' });
  for (const code of validatePackOutputAuthorization(manifest.license.output, manifest.provenance)) {
    issues.push({ code, message: 'Pack output license and provenance are not an authorized public or internal-review pair.' });
  }
  return issues;
}

export function assertAlpha9PackManifest(manifest: Alpha9PackManifest): void {
  const issues = validateAlpha9PackManifest(manifest);
  if (issues.length) throw new Error(`Invalid Pack 0.6 manifest: ${issues.map(({ code }) => code).join(', ')}.`);
}
