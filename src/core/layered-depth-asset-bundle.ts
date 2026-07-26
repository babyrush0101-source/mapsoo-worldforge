import {
  GENERATED_ASSET_KINDS,
  LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION,
  type AssetBundleIssue,
  type CharacterAction,
  type CharacterDirection,
  type GeneratedAssetBundle,
  type GeneratedAssetKind,
  type GeneratedAssetRecord,
} from './generated-asset-bundle';

export { LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION } from './generated-asset-bundle';

export const LAYERED_DEPTH_COMPLETENESS_POLICY = 'layered-depth-2d-complete-v1' as const;

export const LAYERED_DEPTH_REQUIRED_ROLES = Object.freeze([
  'background.sky',
  'background.far',
  'background.mid',
  'background.depth-fog',
  'near.overlay',
  'foreground.overlay',
  'lighting.ambient',
  'lighting.local',
  'terrain.ground',
  'terrain.path',
  'terrain.edge',
  'terrain.bridge',
  'terrain.stairs',
  'terrain.water',
  'prop.tree',
  'prop.rock',
  'prop.crate',
  'prop.sign',
  'prop.lamp',
  'prop.occluder',
  'structure.entrance',
  'structure.exit',
  'structure.checkpoint',
  'structure.landmark',
  'collectible.primary',
  'collectible.health',
  'effect.footstep',
  'effect.interact',
  'effect.portal',
  'effect.ambient',
  'character.player.atlas',
  'character.npc.atlas',
  'world.scene',
  'world.collision',
  'world.navigation',
  'world.preview',
] as const);

export const LAYERED_DEPTH_PLAYER_ACTIONS = Object.freeze([
  'idle', 'walk', 'run', 'interact',
] as const satisfies readonly CharacterAction[]);

export const LAYERED_DEPTH_NPC_ACTIONS = Object.freeze([
  'idle', 'talk',
] as const satisfies readonly CharacterAction[]);

export const LAYERED_DEPTH_DIRECTIONS = Object.freeze([
  'left', 'right', 'near', 'far',
] as const satisfies readonly CharacterDirection[]);

export function requiredLayeredDepthKind(role: string): GeneratedAssetKind | undefined {
  if (role.startsWith('background.')) return 'background-layer';
  if (role === 'near.overlay') return 'foreground-layer';
  if (role.startsWith('foreground.')) return 'foreground-layer';
  if (role.startsWith('lighting.')) return 'lighting-layer';
  if (role.startsWith('terrain.')) return 'terrain-atlas';
  if (role.startsWith('prop.')) return 'prop-atlas';
  if (role.startsWith('structure.')) return 'structure-sprite';
  if (role.startsWith('collectible.')) return 'collectible-atlas';
  if (role.startsWith('effect.')) return 'effect-atlas';
  if (role.startsWith('character.')) return 'character-atlas';
  if (role === 'world.scene') return 'scene-data';
  if (role === 'world.collision') return 'collision-map';
  if (role === 'world.navigation') return 'navigation-map';
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

/** Complete, original shallow-depth corridor exploration bundle contract. */
export function validateLayeredDepthAssetBundle(bundle: GeneratedAssetBundle): AssetBundleIssue[] {
  const issues: AssetBundleIssue[] = [];
  if (bundle.schemaVersion !== LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION) {
    issues.push({ code: 'bundle.schema-version', message: 'Layered-depth bundles require schema 0.4.0.' });
  }
  if (!SAFE_ID.test(bundle.jobId) || bundle.jobId.length > 80) {
    issues.push({ code: 'bundle.job-id', message: 'Bundle job ID must be a safe stable identifier.' });
  }
  if (bundle.profile !== 'layered-depth-2d') {
    issues.push({ code: 'bundle.profile', message: 'This contract accepts only layered-depth-2d bundles.' });
  }
  if (bundle.completenessPolicy !== LAYERED_DEPTH_COMPLETENESS_POLICY) {
    issues.push({ code: 'bundle.completeness-policy', message: 'Bundle must declare layered-depth-2d-complete-v1.' });
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
  for (const role of LAYERED_DEPTH_REQUIRED_ROLES) {
    if (!roles.has(role)) {
      issues.push({ code: 'completeness.missing-role', message: `Required role is missing: ${role}.`, role });
      continue;
    }
    if (assets.get(roles.get(role) as string)?.kind !== requiredLayeredDepthKind(role)) {
      issues.push({ code: 'completeness.role-kind', message: `Role ${role} references the wrong asset kind.`, role });
    }
  }
  for (const role of roles.keys()) {
    if (!(LAYERED_DEPTH_REQUIRED_ROLES as readonly string[]).includes(role)) {
      issues.push({ code: 'completeness.unexpected-role', message: `Unexpected layered-depth role: ${role}.`, role });
    }
  }

  const expectedCharacters = [
    { id: 'player', role: 'character.player.atlas', actions: LAYERED_DEPTH_PLAYER_ACTIONS },
    { id: 'npc', role: 'character.npc.atlas', actions: LAYERED_DEPTH_NPC_ACTIONS },
  ] as const;
  if (bundle.characters.length !== expectedCharacters.length) {
    issues.push({ code: 'character.count', message: 'A complete layered-depth bundle requires exactly one player and one NPC.' });
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
    if (character.frameWidth !== 48 || character.frameHeight !== 72 || character.pivot[0] !== 24 || character.pivot[1] !== 67) {
      issues.push({ code: 'character.geometry', message: 'Layered-depth character geometry must be 48x72 with pivot 24,67.' });
    }
    const clips = new Map<string, typeof character.clips[number]>();
    for (const clip of character.clips) {
      const key = `${clip.action}.${clip.direction}`;
      if (clips.has(key)) issues.push({ code: 'character.clip-duplicate', message: `Character clip is duplicated: ${key}.` });
      clips.set(key, clip);
      if (!(expected.actions as readonly string[]).includes(clip.action)
        || !(LAYERED_DEPTH_DIRECTIONS as readonly string[]).includes(clip.direction)
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
      for (const direction of LAYERED_DEPTH_DIRECTIONS) {
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

export function assertCompleteLayeredDepthAssetBundle(bundle: GeneratedAssetBundle): void {
  const issues = validateLayeredDepthAssetBundle(bundle);
  if (issues.length > 0) {
    throw new Error(`Incomplete layered-depth asset bundle: ${issues.map(({ code }) => code).join(', ')}.`);
  }
}
