import type { WorldAssetProfile } from './asset-profile';

export const GENERATED_ASSET_BUNDLE_SCHEMA_VERSION = '0.1.0' as const;
export const SIDE_PLATFORMER_ASSET_BUNDLE_SCHEMA_VERSION = '0.2.0' as const;
export const ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION = '0.3.0' as const;
export const LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION = '0.4.0' as const;
export type GeneratedAssetBundleSchemaVersion =
  | typeof GENERATED_ASSET_BUNDLE_SCHEMA_VERSION
  | typeof SIDE_PLATFORMER_ASSET_BUNDLE_SCHEMA_VERSION
  | typeof ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION
  | typeof LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION;
export const TOPDOWN_FARM_COMPLETENESS_POLICY = 'topdown-farm-complete-v1' as const;

export const GENERATED_ASSET_KINDS = Object.freeze([
  'terrain-atlas',
  'prop-atlas',
  'structure-sprite',
  'crop-sprite',
  'character-atlas',
  'collision-map',
  'navigation-map',
  'scene-data',
  'preview',
  'platform-atlas',
  'hazard-atlas',
  'collectible-atlas',
  'background-layer',
  'foreground-layer',
  'effect-atlas',
  'lighting-layer',
] as const);
export type GeneratedAssetKind = typeof GENERATED_ASSET_KINDS[number];

export const TOPDOWN_FARM_REQUIRED_ROLES = Object.freeze([
  'terrain.ground',
  'terrain.water',
  'terrain.path',
  'terrain.soil',
  'prop.tree',
  'prop.rock',
  'prop.flower',
  'prop.fence',
  'prop.gate',
  'prop.crate',
  'structure.house',
  'structure.barn',
  'crop.basic.stage-1',
  'crop.basic.stage-2',
  'crop.basic.stage-3',
  'crop.basic.stage-4',
  'character.player.atlas',
  'world.collision',
  'world.navigation',
  'world.scene',
  'world.preview',
] as const);

export type TopdownFarmAssetRole = typeof TOPDOWN_FARM_REQUIRED_ROLES[number];
export type CharacterDirection =
  | 'north' | 'north-east' | 'east' | 'south-east'
  | 'south' | 'south-west' | 'west' | 'north-west'
  | 'left' | 'right' | 'near' | 'far';
export type CharacterAction =
  | 'idle' | 'walk' | 'move' | 'run' | 'jump' | 'fall' | 'land' | 'hurt'
  | 'attack' | 'attack-primary' | 'dash' | 'defeat' | 'interact' | 'talk';

export interface GeneratedAssetRecord {
  readonly id: string;
  readonly kind: GeneratedAssetKind;
  readonly path: string;
  readonly mediaType: 'image/png' | 'application/json';
  readonly bytes: number;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
  readonly sourceReferenceIds: readonly string[];
}

export interface AssetRoleBinding {
  readonly role: string;
  readonly assetId: string;
}

export interface CharacterAnimationClip {
  readonly action: CharacterAction;
  readonly direction: CharacterDirection;
  readonly fps: number;
  readonly frames: readonly { readonly x: number; readonly y: number }[];
}

export interface GeneratedCharacterDefinition {
  readonly id: string;
  readonly atlasAssetId: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly pivot: readonly [number, number];
  readonly clips: readonly CharacterAnimationClip[];
}

export interface GeneratedSceneDefinition {
  readonly id: string;
  readonly dataAssetId: string;
  readonly collisionAssetId: string;
  readonly navigationAssetId: string;
  readonly previewAssetId: string;
  readonly spawn: { readonly x: number; readonly y: number };
}

export interface GeneratedAssetBundle {
  readonly schemaVersion: GeneratedAssetBundleSchemaVersion;
  readonly jobId: string;
  readonly profile: WorldAssetProfile;
  readonly completenessPolicy: string;
  readonly assets: readonly GeneratedAssetRecord[];
  readonly roles: readonly AssetRoleBinding[];
  readonly characters: readonly GeneratedCharacterDefinition[];
  readonly scene: GeneratedSceneDefinition;
}

export interface AssetBundleIssue {
  readonly code: string;
  readonly message: string;
  readonly assetId?: string;
  readonly role?: string;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DIRECTIONS: readonly CharacterDirection[] = ['north', 'east', 'south', 'west'];
const ACTIONS: readonly CharacterAction[] = ['idle', 'walk'];

function safeRelativePath(path: string): boolean {
  return path.length > 0
    && path.length <= 240
    && !path.includes('\\')
    && !path.startsWith('/')
    && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function finiteInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function validateTopdownFarmAssetBundle(bundle: GeneratedAssetBundle): AssetBundleIssue[] {
  const issues: AssetBundleIssue[] = [];
  if (bundle.schemaVersion !== GENERATED_ASSET_BUNDLE_SCHEMA_VERSION) {
    issues.push({ code: 'bundle.schema-version', message: 'Generated asset bundle schema version is unsupported.' });
  }
  if (!SAFE_ID.test(bundle.jobId) || bundle.jobId.length > 80) {
    issues.push({ code: 'bundle.job-id', message: 'Bundle job ID must be a safe stable identifier.' });
  }
  if (bundle.profile !== 'topdown-farm') {
    issues.push({ code: 'bundle.profile', message: 'This completeness policy only accepts topdown-farm bundles.' });
  }
  if (bundle.completenessPolicy !== TOPDOWN_FARM_COMPLETENESS_POLICY) {
    issues.push({ code: 'bundle.completeness-policy', message: 'Bundle does not declare topdown-farm-complete-v1.' });
  }

  const assets = new Map<string, GeneratedAssetRecord>();
  const paths = new Set<string>();
  for (const asset of bundle.assets) {
    if (!SAFE_ID.test(asset.id) || asset.id.length > 80 || assets.has(asset.id)) {
      issues.push({ code: 'asset.id', message: 'Asset IDs must be unique safe identifiers.', assetId: asset.id });
      continue;
    }
    assets.set(asset.id, asset);
    if (!safeRelativePath(asset.path) || paths.has(asset.path)) {
      issues.push({ code: 'asset.path', message: 'Asset paths must be unique safe relative paths.', assetId: asset.id });
    }
    paths.add(asset.path);
    if (!GENERATED_ASSET_KINDS.includes(asset.kind)) {
      issues.push({ code: 'asset.kind', message: 'Asset kind is unsupported.', assetId: asset.id });
    }
    if (!finiteInteger(asset.bytes, 1, 64 * 1024 * 1024) || !SHA256.test(asset.sha256)) {
      issues.push({ code: 'asset.integrity', message: 'Asset byte count and SHA-256 are required.', assetId: asset.id });
    }
    const hasWidth = asset.width !== undefined;
    const hasHeight = asset.height !== undefined;
    if (hasWidth !== hasHeight || (hasWidth && (
      !finiteInteger(asset.width as number, 1, 8192)
      || !finiteInteger(asset.height as number, 1, 8192)
    ))) {
      issues.push({ code: 'asset.dimensions', message: 'Raster dimensions must be a bounded integer pair.', assetId: asset.id });
    }
    if (new Set(asset.sourceReferenceIds).size !== asset.sourceReferenceIds.length) {
      issues.push({ code: 'asset.reference-binding', message: 'Asset source reference IDs must be unique.', assetId: asset.id });
    }
  }

  const roles = new Map<string, string>();
  for (const binding of bundle.roles) {
    if (roles.has(binding.role)) {
      issues.push({ code: 'role.duplicate', message: 'Asset roles must be unique.', role: binding.role });
      continue;
    }
    roles.set(binding.role, binding.assetId);
    if (!assets.has(binding.assetId)) {
      issues.push({ code: 'role.missing-asset', message: 'Asset role references a missing asset.', role: binding.role });
    }
  }
  for (const role of TOPDOWN_FARM_REQUIRED_ROLES) {
    if (!roles.has(role)) {
      issues.push({ code: 'completeness.missing-role', message: `Required asset role is missing: ${role}.`, role });
    }
  }

  if (bundle.characters.length !== 1) {
    issues.push({ code: 'character.count', message: 'A complete top-down farm bundle must contain exactly one player character.' });
  }
  const character = bundle.characters[0];
  if (character) {
    const atlas = assets.get(character.atlasAssetId);
    if (!SAFE_ID.test(character.id) || !atlas || atlas.kind !== 'character-atlas') {
      issues.push({ code: 'character.atlas', message: 'Player character must reference a character atlas.' });
    }
    if (
      !finiteInteger(character.frameWidth, 1, 512)
      || !finiteInteger(character.frameHeight, 1, 512)
      || character.pivot.length !== 2
      || !character.pivot.every((value) => Number.isFinite(value))
    ) {
      issues.push({ code: 'character.geometry', message: 'Character frame geometry and pivot are invalid.' });
    }
    const clips = new Map<string, CharacterAnimationClip>();
    for (const clip of character.clips) {
      const key = `${clip.action}.${clip.direction}`;
      if (clips.has(key)) issues.push({ code: 'character.clip-duplicate', message: `Character clip is duplicated: ${key}.` });
      clips.set(key, clip);
      if (!Number.isFinite(clip.fps) || clip.fps <= 0 || clip.fps > 60 || clip.frames.length < 1 || clip.frames.length > 32) {
        issues.push({ code: 'character.clip', message: `Character clip timing or frame count is invalid: ${key}.` });
      }
      for (const frame of clip.frames) {
        if (
          !finiteInteger(frame.x, 0, 8191)
          || !finiteInteger(frame.y, 0, 8191)
          || (atlas?.width !== undefined && frame.x + character.frameWidth > atlas.width)
          || (atlas?.height !== undefined && frame.y + character.frameHeight > atlas.height)
        ) {
          issues.push({ code: 'character.frame-bounds', message: `Character frame is outside its atlas: ${key}.` });
          break;
        }
      }
    }
    for (const action of ACTIONS) {
      for (const direction of DIRECTIONS) {
        const key = `${action}.${direction}`;
        if (!clips.has(key)) issues.push({ code: 'completeness.missing-clip', message: `Required character clip is missing: ${key}.` });
      }
    }
  }

  const sceneReferences: [string, string, GeneratedAssetKind][] = [
    ['data', bundle.scene.dataAssetId, 'scene-data'],
    ['collision', bundle.scene.collisionAssetId, 'collision-map'],
    ['navigation', bundle.scene.navigationAssetId, 'navigation-map'],
    ['preview', bundle.scene.previewAssetId, 'preview'],
  ];
  for (const [label, assetId, kind] of sceneReferences) {
    if (assets.get(assetId)?.kind !== kind) {
      issues.push({ code: 'scene.asset', message: `Scene ${label} reference must target a ${kind} asset.`, assetId });
    }
  }
  if (
    !SAFE_ID.test(bundle.scene.id)
    || !finiteInteger(bundle.scene.spawn.x, 0, 4095)
    || !finiteInteger(bundle.scene.spawn.y, 0, 4095)
  ) {
    issues.push({ code: 'scene.spawn', message: 'Scene ID and spawn coordinates are invalid.' });
  }
  return issues;
}

export function assertCompleteTopdownFarmAssetBundle(bundle: GeneratedAssetBundle): void {
  const issues = validateTopdownFarmAssetBundle(bundle);
  if (issues.length > 0) {
    throw new Error(`Incomplete top-down farm asset bundle: ${issues.map((issue) => issue.code).join(', ')}.`);
  }
}
