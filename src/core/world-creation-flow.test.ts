import { describe, expect, it } from 'vitest';

import { WORLD_ASSET_PROFILES } from './asset-profile';
import {
  PROFILE_CREATION_CAPABILITIES,
  WORLD_CREATION_STAGES,
  assertCanEnterWorldCreationStage,
  canEnterWorldCreationStage,
  nextWorldCreationStage,
} from './world-creation-flow';

describe('dialogue-to-playable-world capability flow', () => {
  it('lets every profile complete the four confirmation rounds', () => {
    for (const profile of WORLD_ASSET_PROFILES) {
      for (const stage of ['world-brief', 'art-direction', 'map-layout', 'style-sample'] as const) {
        expect(canEnterWorldCreationStage(profile, stage)).toBe(true);
      }
    }
  });

  it('allows complete packs and Godot maps only for implemented providers', () => {
    expect(canEnterWorldCreationStage('topdown-farm', 'asset-generation')).toBe(true);
    expect(canEnterWorldCreationStage('topdown-farm', 'godot-map')).toBe(true);
    expect(canEnterWorldCreationStage('side-platformer', 'asset-generation')).toBe(true);
    expect(canEnterWorldCreationStage('side-platformer', 'godot-map')).toBe(true);
    expect(canEnterWorldCreationStage('isometric-action', 'asset-generation')).toBe(true);
    expect(canEnterWorldCreationStage('isometric-action', 'godot-map')).toBe(true);
    expect(canEnterWorldCreationStage('layered-depth-2d', 'godot-map')).toBe(true);
  });

  it('opens playtest only for profiles with controller and runtime-shell evidence', () => {
    expect(PROFILE_CREATION_CAPABILITIES['side-platformer'].playerController).toBe(true);
    expect(PROFILE_CREATION_CAPABILITIES['topdown-farm'].playerController).toBe(true);
    expect(PROFILE_CREATION_CAPABILITIES['isometric-action'].playerController).toBe(true);
    expect(() => assertCanEnterWorldCreationStage('side-platformer', 'playtest')).not.toThrow();
    expect(() => assertCanEnterWorldCreationStage('topdown-farm', 'playtest')).not.toThrow();
    expect(() => assertCanEnterWorldCreationStage('isometric-action', 'playtest')).not.toThrow();
  });

  it('defines one deterministic stage order', () => {
    expect(WORLD_CREATION_STAGES.map(nextWorldCreationStage)).toEqual([
      'art-direction', 'map-layout', 'style-sample', 'asset-generation', 'godot-map', 'playtest', null,
    ]);
  });
});
