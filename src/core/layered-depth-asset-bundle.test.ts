import { describe, expect, it } from 'vitest';

import type { GeneratedAssetBundle } from './generated-asset-bundle';
import {
  LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION,
  LAYERED_DEPTH_COMPLETENESS_POLICY,
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
  LAYERED_DEPTH_REQUIRED_ROLES,
  assertCompleteLayeredDepthAssetBundle,
  requiredLayeredDepthKind,
  validateLayeredDepthAssetBundle,
} from './layered-depth-asset-bundle';

const HASH = 'd'.repeat(64);

function completeBundle(): GeneratedAssetBundle {
  const assets = LAYERED_DEPTH_REQUIRED_ROLES.map((role, index) => {
    const kind = requiredLayeredDepthKind(role)!;
    const json = ['collision-map', 'navigation-map', 'scene-data'].includes(kind);
    return {
      id: `depth-asset-${index + 1}`,
      kind,
      path: `${json ? 'runtime' : 'art'}/${index + 1}.${json ? 'json' : 'png'}`,
      mediaType: json ? 'application/json' as const : 'image/png' as const,
      bytes: 128,
      sha256: HASH,
      ...(!json ? { width: kind === 'character-atlas' ? 768 : 320, height: kind === 'character-atlas' ? 72 : 180 } : {}),
      sourceReferenceIds: kind === 'character-atlas' ? ['character-reference'] : ['environment-reference'],
    };
  });
  const roleAsset = (role: string) => assets[LAYERED_DEPTH_REQUIRED_ROLES.indexOf(role as never)].id;
  const clips = (actions: readonly ('idle' | 'walk' | 'run' | 'interact' | 'talk')[]) =>
    actions.flatMap((action, actionIndex) => LAYERED_DEPTH_DIRECTIONS.map((direction, directionIndex) => ({
      action,
      direction,
      fps: action === 'idle' ? 4 : 8,
      frames: [{ x: (actionIndex * 4 + directionIndex) * 48, y: 0 }],
    })));
  return {
    schemaVersion: LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION,
    jobId: 'original-layered-depth-world',
    profile: 'layered-depth-2d',
    completenessPolicy: LAYERED_DEPTH_COMPLETENESS_POLICY,
    assets,
    roles: LAYERED_DEPTH_REQUIRED_ROLES.map((role) => ({ role, assetId: roleAsset(role) })),
    characters: [
      {
        id: 'player',
        atlasAssetId: roleAsset('character.player.atlas'),
        frameWidth: 48,
        frameHeight: 72,
        pivot: [24, 67],
        clips: clips(LAYERED_DEPTH_PLAYER_ACTIONS),
      },
      {
        id: 'npc',
        atlasAssetId: roleAsset('character.npc.atlas'),
        frameWidth: 48,
        frameHeight: 72,
        pivot: [24, 67],
        clips: clips(LAYERED_DEPTH_NPC_ACTIONS),
      },
    ],
    scene: {
      id: 'layered-depth-scene',
      dataAssetId: roleAsset('world.scene'),
      collisionAssetId: roleAsset('world.collision'),
      navigationAssetId: roleAsset('world.navigation'),
      previewAssetId: roleAsset('world.preview'),
      spawn: { x: 96, y: 470 },
    },
  };
}

describe('layered-depth-2d-complete-v1', () => {
  it('accepts all 36 roles and 24 four-direction depth clips', () => {
    const bundle = completeBundle();
    expect(validateLayeredDepthAssetBundle(bundle)).toEqual([]);
    expect(() => assertCompleteLayeredDepthAssetBundle(bundle)).not.toThrow();
    expect(bundle.characters.reduce((total, character) => total + character.clips.length, 0)).toBe(24);
  });

  it.each(LAYERED_DEPTH_REQUIRED_ROLES)('fails closed when %s is missing', (role) => {
    const bundle = completeBundle();
    expect(validateLayeredDepthAssetBundle({
      ...bundle,
      roles: bundle.roles.filter((binding) => binding.role !== role),
    })).toContainEqual(expect.objectContaining({ code: 'completeness.missing-role', role }));
  });

  it('requires canonical geometry and semantic asset kinds', () => {
    const bundle = completeBundle();
    const terrain = bundle.roles.find(({ role }) => role === 'terrain.ground')!;
    const background = bundle.roles.find(({ role }) => role === 'background.sky')!;
    const invalid = {
      ...bundle,
      roles: bundle.roles.map((binding) =>
        binding === terrain ? { ...binding, assetId: background.assetId } : binding),
      characters: [
        { ...bundle.characters[0], pivot: [24, 66] as const },
        bundle.characters[1],
      ],
    };
    expect(validateLayeredDepthAssetBundle(invalid).map(({ code }) => code)).toEqual(expect.arrayContaining([
      'completeness.role-kind', 'character.geometry',
    ]));
  });

  it('rejects missing depth movement clips and profile/schema mixing', () => {
    const bundle = completeBundle();
    const invalid = {
      ...bundle,
      schemaVersion: '0.3.0' as const,
      profile: 'isometric-action' as const,
      characters: [
        {
          ...bundle.characters[0],
          clips: bundle.characters[0].clips.filter(({ action, direction }) =>
            action !== 'interact' || direction !== 'far'),
        },
        bundle.characters[1],
      ],
    };
    expect(validateLayeredDepthAssetBundle(invalid).map(({ code }) => code)).toEqual(expect.arrayContaining([
      'bundle.schema-version', 'bundle.profile', 'completeness.missing-clip',
    ]));
  });
});
