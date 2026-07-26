import { describe, expect, it } from 'vitest';

import { WORLD_ASSET_PROFILES } from '../../core/asset-profile';
import {
  PROFILE_VISUAL_ACCEPTANCE,
  assertProfileReferenceScene,
  renderProfileReferenceScene,
} from './render-profile-reference-scene';

describe('four-profile visual reference scenes', () => {
  it('defines an explicit contract for every supported world profile', () => {
    expect(Object.keys(PROFILE_VISUAL_ACCEPTANCE).sort()).toEqual([...WORLD_ASSET_PROFILES].sort());
    expect(PROFILE_VISUAL_ACCEPTANCE['side-platformer'].status).toBe('implemented');
    expect(PROFILE_VISUAL_ACCEPTANCE['topdown-farm'].status).toBe('implemented');
    expect(PROFILE_VISUAL_ACCEPTANCE['isometric-action'].status).toBe('implemented');
    expect(PROFILE_VISUAL_ACCEPTANCE['layered-depth-2d'].status).toBe('implemented');
  });

  it.each(WORLD_ASSET_PROFILES)('renders a deterministic, inspectable %s baseline', (profile) => {
    const first = renderProfileReferenceScene(profile);
    const second = renderProfileReferenceScene(profile);
    expect(first.width).toBe(320);
    expect(first.height).toBe(180);
    expect(first.pngBytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(first.pngBytes).toEqual(second.pngBytes);
    expect(() => assertProfileReferenceScene(first)).not.toThrow();
  });

  it('changes the character/world accent when the seed changes', () => {
    const first = renderProfileReferenceScene('side-platformer', 'visual-seed-a');
    const second = renderProfileReferenceScene('side-platformer', 'visual-seed-b');
    expect(first.pngBytes).not.toEqual(second.pngBytes);
  });
});
