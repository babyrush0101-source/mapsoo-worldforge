import {
  GENERATED_ASSET_KINDS,
  ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION,
  type AssetBundleIssue,
  type CharacterAction,
  type CharacterDirection,
  type GeneratedAssetBundle,
  type GeneratedAssetKind,
  type GeneratedAssetRecord,
} from './generated-asset-bundle';

export { ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION } from './generated-asset-bundle';

export const ISOMETRIC_ACTION_COMPLETENESS_POLICY = 'isometric-action-complete-v1' as const;

export const ISOMETRIC_ACTION_REQUIRED_ROLES = Object.freeze([
  'terrain.void',
  'terrain.floor.base',
  'terrain.floor.variant',
  'terrain.floor.edge',
  'terrain.elevation.top',
  'terrain.elevation.riser-left',
  'terrain.elevation.riser-right',
  'terrain.ramp',
  'terrain.wall',
  'hazard.contact',
  'hazard.telegraph',
  'prop.blocker',
  'prop.breakable',
  'prop.cover',
  'prop.decoration',
  'prop.light',
  'structure.entrance',
  'structure.exit',
  'structure.checkpoint',
  'collectible.primary',
  'collectible.health',
  'effect.player-attack',
  'effect.enemy-attack',
  'effect.projectile',
  'effect.impact',
  'effect.dash',
  'effect.spawn',
  'effect.defeat',
  'effect.shadow',
  'character.player.atlas',
  'character.enemy-melee.atlas',
  'character.enemy-ranged.atlas',
  'world.scene',
  'world.collision',
  'world.navigation',
  'world.preview',
] as const);

export const ISOMETRIC_PLAYER_ACTIONS = Object.freeze([
  'idle', 'move', 'attack-primary', 'dash', 'hurt', 'defeat',
] as const satisfies readonly CharacterAction[]);

export const ISOMETRIC_ENEMY_ACTIONS = Object.freeze([
  'idle', 'move', 'attack-primary', 'hurt', 'defeat',
] as const satisfies readonly CharacterAction[]);

export const ISOMETRIC_ACTION_DIRECTIONS = Object.freeze([
  'north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west',
] as const satisfies readonly CharacterDirection[]);

export function requiredIsometricActionKind(role: string): GeneratedAssetKind | undefined {
  if (role.startsWith('terrain.')) return 'terrain-atlas';
  if (role.startsWith('prop.')) return 'prop-atlas';
  if (role.startsWith('structure.')) return 'structure-sprite';
  if (role.startsWith('hazard.')) return 'hazard-atlas';
  if (role.startsWith('effect.')) return 'effect-atlas';
  if (role.startsWith('collectible.')) return 'collectible-atlas';
  if (role.startsWith('character.')) return 'character-atlas';
  if (role === 'world.collision') return 'collision-map';
  if (role === 'world.navigation') return 'navigation-map';
  if (role === 'world.scene') return 'scene-data';
  if (role === 'world.preview') return 'preview';
  return undefined;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function safeRelativePath(path: string): boolean {
  return path.length > 0
    && path.length <= 240
    && !path.includes('\\')
    && !path.startsWith('/')
    && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function validateAsset(
  asset: GeneratedAssetRecord,
  ids: Set<string>,
  paths: Set<string>,
  issues: AssetBundleIssue[],
): void {
  if (!SAFE_ID.test(asset.id) || asset.id.length > 80 || ids.has(asset.id)) {
    issues.push({ code: 'asset.id', message: 'Asset IDs must be unique safe identifiers.', assetId: asset.id });
  }
  ids.add(asset.id);
  if (!safeRelativePath(asset.path) || paths.has(asset.path)) {
    issues.push({ code: 'asset.path', message: 'Asset paths must be unique safe relative paths.', assetId: asset.id });
  }
  paths.add(asset.path);
  if (!GENERATED_ASSET_KINDS.includes(asset.kind)) {
    issues.push({ code: 'asset.kind', message: 'Asset kind is unsupported.', assetId: asset.id });
  }
  if (!integer(asset.bytes, 1, 64 * 1024 * 1024) || !SHA256.test(asset.sha256)) {
    issues.push({ code: 'asset.integrity', message: 'Asset byte count and SHA-256 are required.', assetId: asset.id });
  }
  const raster = asset.mediaType === 'image/png';
  if (raster !== (asset.width !== undefined && asset.height !== undefined)) {
    issues.push({ code: 'asset.dimensions', message: 'PNG assets require dimensions and JSON assets forbid them.', assetId: asset.id });
  } else if (raster && (!integer(asset.width, 1, 8192) || !integer(asset.height, 1, 8192))) {
    issues.push({ code: 'asset.dimensions', message: 'Raster dimensions must be bounded integers.', assetId: asset.id });
  }
  if (new Set(asset.sourceReferenceIds).size !== asset.sourceReferenceIds.length) {
    issues.push({ code: 'asset.reference-binding', message: 'Asset source reference IDs must be unique.', assetId: asset.id });
  }
}

/** Complete, original diamond-grid action bundle contract. */
export function validateIsometricActionAssetBundle(bundle: GeneratedAssetBundle): AssetBundleIssue[] {
  const issues: AssetBundleIssue[] = [];
  if (bundle.schemaVersion !== ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION) {
    issues.push({ code: 'bundle.schema-version', message: 'Isometric action bundles require schema 0.3.0.' });
  }
  if (!SAFE_ID.test(bundle.jobId) || bundle.jobId.length > 80) {
    issues.push({ code: 'bundle.job-id', message: 'Bundle job ID must be a safe stable identifier.' });
  }
  if (bundle.profile !== 'isometric-action') {
    issues.push({ code: 'bundle.profile', message: 'This contract accepts only isometric-action bundles.' });
  }
  if (bundle.completenessPolicy !== ISOMETRIC_ACTION_COMPLETENESS_POLICY) {
    issues.push({ code: 'bundle.completeness-policy', message: 'Bundle must declare isometric-action-complete-v1.' });
  }

  const ids = new Set<string>();
  const paths = new Set<string>();
  const assets = new Map<string, GeneratedAssetRecord>();
  for (const asset of bundle.assets) {
    validateAsset(asset, ids, paths, issues);
    if (!assets.has(asset.id)) assets.set(asset.id, asset);
  }

  const roles = new Map<string, string>();
  for (const binding of bundle.roles) {
    if (roles.has(binding.role)) {
      issues.push({ code: 'role.duplicate', message: 'Asset roles must be unique.', role: binding.role });
    } else {
      roles.set(binding.role, binding.assetId);
    }
    if (!assets.has(binding.assetId)) {
      issues.push({ code: 'role.missing-asset', message: 'Asset role references a missing asset.', role: binding.role });
    }
  }
  for (const role of ISOMETRIC_ACTION_REQUIRED_ROLES) {
    if (!roles.has(role)) {
      issues.push({ code: 'completeness.missing-role', message: `Required role is missing: ${role}.`, role });
      continue;
    }
    if (assets.get(roles.get(role) as string)?.kind !== requiredIsometricActionKind(role)) {
      issues.push({ code: 'completeness.role-kind', message: `Role ${role} references the wrong asset kind.`, role });
    }
  }
  for (const role of roles.keys()) {
    if (!(ISOMETRIC_ACTION_REQUIRED_ROLES as readonly string[]).includes(role)) {
      issues.push({ code: 'completeness.unexpected-role', message: `Unexpected isometric-action role: ${role}.`, role });
    }
  }

  const expectedCharacters = [
    { id: 'player', role: 'character.player.atlas', actions: ISOMETRIC_PLAYER_ACTIONS },
    { id: 'enemy-melee', role: 'character.enemy-melee.atlas', actions: ISOMETRIC_ENEMY_ACTIONS },
    { id: 'enemy-ranged', role: 'character.enemy-ranged.atlas', actions: ISOMETRIC_ENEMY_ACTIONS },
  ] as const;
  if (bundle.characters.length !== expectedCharacters.length) {
    issues.push({ code: 'character.count', message: 'A complete isometric action bundle requires player, melee enemy and ranged enemy.' });
  }
  for (const expected of expectedCharacters) {
    const character = bundle.characters.find(({ id }) => id === expected.id);
    if (!character) {
      issues.push({ code: 'character.missing', message: `Required character is missing: ${expected.id}.` });
      continue;
    }
    const atlas = assets.get(character.atlasAssetId);
    if (!SAFE_ID.test(character.id)
      || atlas?.kind !== 'character-atlas'
      || roles.get(expected.role) !== character.atlasAssetId) {
      issues.push({ code: 'character.atlas', message: `${expected.id} must reference its canonical character atlas.` });
    }
    if (character.frameWidth !== 48 || character.frameHeight !== 64 || character.pivot[0] !== 24 || character.pivot[1] !== 58) {
      issues.push({ code: 'character.geometry', message: 'Isometric character geometry must be 48x64 with pivot 24,58.' });
    }
    const clips = new Map<string, typeof character.clips[number]>();
    for (const clip of character.clips) {
      const key = `${clip.action}.${clip.direction}`;
      if (clips.has(key)) issues.push({ code: 'character.clip-duplicate', message: `Character clip is duplicated: ${key}.` });
      clips.set(key, clip);
      if (!(expected.actions as readonly string[]).includes(clip.action)
        || !(ISOMETRIC_ACTION_DIRECTIONS as readonly string[]).includes(clip.direction)
        || !Number.isFinite(clip.fps) || clip.fps <= 0 || clip.fps > 60
        || clip.frames.length < 1 || clip.frames.length > 32) {
        issues.push({ code: 'character.clip', message: `Character clip is invalid: ${key}.` });
      }
      for (const frame of clip.frames) {
        if (!integer(frame.x, 0, 8191) || !integer(frame.y, 0, 8191)
          || (atlas?.width !== undefined && frame.x + character.frameWidth > atlas.width)
          || (atlas?.height !== undefined && frame.y + character.frameHeight > atlas.height)) {
          issues.push({ code: 'character.frame-bounds', message: `Character frame is outside its atlas: ${key}.` });
          break;
        }
      }
    }
    for (const action of expected.actions) {
      for (const direction of ISOMETRIC_ACTION_DIRECTIONS) {
        const key = `${action}.${direction}`;
        if (!clips.has(key)) issues.push({ code: 'completeness.missing-clip', message: `Required clip is missing: ${key}.` });
      }
    }
  }

  const sceneKinds: readonly [string, string, GeneratedAssetKind][] = [
    ['data', bundle.scene.dataAssetId, 'scene-data'],
    ['collision', bundle.scene.collisionAssetId, 'collision-map'],
    ['navigation', bundle.scene.navigationAssetId, 'navigation-map'],
    ['preview', bundle.scene.previewAssetId, 'preview'],
  ];
  for (const [label, id, kind] of sceneKinds) {
    if (assets.get(id)?.kind !== kind) {
      issues.push({ code: 'scene.asset', message: `Scene ${label} must target ${kind}.`, assetId: id });
    }
  }
  if (!SAFE_ID.test(bundle.scene.id)
    || !integer(bundle.scene.spawn.x, 0, 8191)
    || !integer(bundle.scene.spawn.y, 0, 8191)) {
    issues.push({ code: 'scene.spawn', message: 'Scene ID and spawn coordinates are invalid.' });
  }
  return issues;
}

export function assertCompleteIsometricActionAssetBundle(bundle: GeneratedAssetBundle): void {
  const issues = validateIsometricActionAssetBundle(bundle);
  if (issues.length > 0) {
    throw new Error(`Incomplete isometric-action asset bundle: ${issues.map(({ code }) => code).join(', ')}.`);
  }
}
