import { describe, expect, it } from 'vitest';

import type { GeneratedAssetBundle } from './generated-asset-bundle';
import {
  ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION,
  ISOMETRIC_ACTION_COMPLETENESS_POLICY,
  ISOMETRIC_ACTION_DIRECTIONS,
  ISOMETRIC_ENEMY_ACTIONS,
  ISOMETRIC_PLAYER_ACTIONS,
  ISOMETRIC_ACTION_REQUIRED_ROLES,
  assertCompleteIsometricActionAssetBundle,
  requiredIsometricActionKind,
  validateIsometricActionAssetBundle,
} from './isometric-action-asset-bundle';

const HASH = 'c'.repeat(64);

function completeBundle(): GeneratedAssetBundle {
  const assets = ISOMETRIC_ACTION_REQUIRED_ROLES.map((role, index) => {
    const kind = requiredIsometricActionKind(role)!;
    const json = ['collision-map', 'navigation-map', 'scene-data'].includes(kind);
    return {
      id: `iso-asset-${index + 1}`,
      kind,
      path: `${json ? 'runtime' : 'art'}/${index + 1}.${json ? 'json' : 'png'}`,
      mediaType: json ? 'application/json' as const : 'image/png' as const,
      bytes: 128,
      sha256: HASH,
      ...(!json ? { width: kind === 'character-atlas' ? 2304 : 320, height: kind === 'character-atlas' ? 64 : 180 } : {}),
      sourceReferenceIds: kind === 'character-atlas' ? ['character-reference'] : ['environment-reference'],
    };
  });
  const roleAsset = (role: string) => assets[ISOMETRIC_ACTION_REQUIRED_ROLES.indexOf(role as never)].id;
  const clips = (actions: readonly ('idle' | 'move' | 'attack-primary' | 'dash' | 'hurt' | 'defeat')[]) =>
    actions.flatMap((action, actionIndex) => ISOMETRIC_ACTION_DIRECTIONS.map((direction, directionIndex) => ({
      action,
      direction,
      fps: action === 'idle' ? 4 : 9,
      frames: [{ x: (actionIndex * 8 + directionIndex) * 48, y: 0 }],
    })));
  return {
    schemaVersion: ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION,
    jobId: 'original-isometric-world',
    profile: 'isometric-action',
    completenessPolicy: ISOMETRIC_ACTION_COMPLETENESS_POLICY,
    assets,
    roles: ISOMETRIC_ACTION_REQUIRED_ROLES.map((role) => ({ role, assetId: roleAsset(role) })),
    characters: [
      {
        id: 'player', atlasAssetId: roleAsset('character.player.atlas'),
        frameWidth: 48, frameHeight: 64, pivot: [24, 58], clips: clips(ISOMETRIC_PLAYER_ACTIONS),
      },
      {
        id: 'enemy-melee', atlasAssetId: roleAsset('character.enemy-melee.atlas'),
        frameWidth: 48, frameHeight: 64, pivot: [24, 58], clips: clips(ISOMETRIC_ENEMY_ACTIONS),
      },
      {
        id: 'enemy-ranged', atlasAssetId: roleAsset('character.enemy-ranged.atlas'),
        frameWidth: 48, frameHeight: 64, pivot: [24, 58], clips: clips(ISOMETRIC_ENEMY_ACTIONS),
      },
    ],
    scene: {
      id: 'isometric-scene',
      dataAssetId: roleAsset('world.scene'),
      collisionAssetId: roleAsset('world.collision'),
      navigationAssetId: roleAsset('world.navigation'),
      previewAssetId: roleAsset('world.preview'),
      spawn: { x: 320, y: 176 },
    },
  };
}

describe('isometric-action-complete-v1', () => {
  it('accepts all 36 roles and 128 eight-direction action clips', () => {
    const bundle = completeBundle();
    expect(validateIsometricActionAssetBundle(bundle)).toEqual([]);
    expect(() => assertCompleteIsometricActionAssetBundle(bundle)).not.toThrow();
  });

  it.each(ISOMETRIC_ACTION_REQUIRED_ROLES)('fails closed when %s is missing', (role) => {
    const bundle = completeBundle();
    expect(validateIsometricActionAssetBundle({
      ...bundle,
      roles: bundle.roles.filter((binding) => binding.role !== role),
    })).toContainEqual(expect.objectContaining({ code: 'completeness.missing-role', role }));
  });

  it('requires the canonical projected frame geometry and role kinds', () => {
    const bundle = completeBundle();
    const prop = bundle.roles.find(({ role }) => role === 'prop.blocker')!;
    const terrain = bundle.roles.find(({ role }) => role === 'terrain.floor.base')!;
    const invalid = {
      ...bundle,
      roles: bundle.roles.map((binding) => binding === prop ? { ...binding, assetId: terrain.assetId } : binding),
      characters: [
        { ...bundle.characters[0], pivot: [23, 58] as const },
        ...bundle.characters.slice(1),
      ],
    };
    const codes = validateIsometricActionAssetBundle(invalid).map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining(['completeness.role-kind', 'character.geometry']));
  });

  it('rejects missing combat clips and profile/schema mixing', () => {
    const bundle = completeBundle();
    const invalid = {
      ...bundle,
      schemaVersion: '0.2.0' as const,
      profile: 'side-platformer' as const,
      characters: [
        {
          ...bundle.characters[0],
          clips: bundle.characters[0].clips.filter(({ action, direction }) => action !== 'attack-primary' || direction !== 'east'),
        },
        ...bundle.characters.slice(1),
      ],
    };
    const codes = validateIsometricActionAssetBundle(invalid).map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      'bundle.schema-version', 'bundle.profile', 'completeness.missing-clip',
    ]));
  });
});
