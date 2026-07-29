import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import { extractCharacterIdentitySignature } from '../core/character-identity-signature';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import {
  LAYERED_DEPTH_REQUIRED_ROLES,
  assertCompleteLayeredDepthAssetBundle,
} from '../core/layered-depth-asset-bundle';
import {
  PROCEDURAL_LAYERED_DEPTH_PROVIDER,
  generateProceduralLayeredDepth,
} from './procedural-layered-depth-provider';

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function job(
  description = 'An original lantern passage with theatrical depth.',
  environmentMarker = 40,
  characterMarker = 170,
  seed = 'layered-depth-seed-012',
) {
  const environment = encodeRgbaPng(2, 2, Uint8Array.from([
    environmentMarker, 120, 80, 255, 80, 90, 150, 255,
    30, 50, 70, 255, 200, 170, 90, 255,
  ]));
  const characterRgba = Uint8Array.from([
    characterMarker, 50, 100, 255, 230, 180, 130, 255,
    50, 60, 130, 255, 20, 25, 35, 255,
  ]);
  const character = encodeRgbaPng(2, 2, characterRgba);
  const descriptor = async (role: 'environment-style' | 'character', bytes: Uint8Array) => ({
    id: `${role}-ref`,
    role,
    path: `references/${role}.png`,
    mediaType: 'image/png' as const,
    byteLength: bytes.byteLength,
    width: 2,
    height: 2,
    sha256: await hash(bytes),
    rights: {
      basis: 'owned' as const,
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true as const,
      allowOutputRedistribution: true as const,
      allowOutputCc0Dedication: true as const,
    },
  });
  const bound = await bindGenerationRequestV2({
    schemaVersion: '1.0.0',
    id: 'layered-depth-world-job',
    profile: 'layered-depth-2d',
    description,
    seed,
    references: [
      await descriptor('environment-style', environment),
      await descriptor('character', character),
    ],
  }, [
    { path: 'references/environment-style.png', bytes: environment },
    { path: 'references/character.png', bytes: character },
  ]);
  return Object.freeze({
    ...bound,
    characterIdentity: await extractCharacterIdentitySignature({
      width: 2,
      height: 2,
      rgba: characterRgba,
    }),
  });
}

function bytes(
  output: Awaited<ReturnType<typeof generateProceduralLayeredDepth>>,
  id: string,
): Uint8Array {
  return output.files.find(({ assetId }) => assetId === id)!.bytes;
}

describe('procedural layered-depth provider', () => {
  it('emits 36 roles, two characters, 24 clips and real shallow-depth runtime data', async () => {
    const output = await generateProceduralLayeredDepth(await job());
    expect(() => assertCompleteLayeredDepthAssetBundle(output.bundle)).not.toThrow();
    expect(output.bundle.roles.map(({ role }) => role)).toEqual(LAYERED_DEPTH_REQUIRED_ROLES);
    expect(output.bundle.characters.map(({ id }) => id)).toEqual(['player', 'npc']);
    expect(output.bundle.characters.reduce((total, character) => total + character.clips.length, 0)).toBe(24);
    expect(bytes(output, 'terrain-atlas').slice(0, 8)).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const scene = JSON.parse(new TextDecoder().decode(bytes(output, 'scene-data')));
    const collision = JSON.parse(new TextDecoder().decode(bytes(output, 'collision-map')));
    const navigation = JSON.parse(new TextDecoder().decode(bytes(output, 'navigation-map')));
    expect(scene.layers).toEqual(['sky', 'far', 'mid', 'gameplay', 'near', 'lighting', 'foreground']);
    expect(scene.planes).toHaveLength(7);
    expect(scene.baseline_y).toBe(470);
    expect(collision.ground_segments).toHaveLength(3);
    expect(navigation.edges.every(({ kind }: { kind: string }) => kind === 'walk')).toBe(true);
    expect(navigation.exit_node_id).toBe('exit-node');
    expect(output.bundle.assets.find(({ id }) => id === 'player-atlas')?.sourceReferenceIds).toEqual(['character-ref']);
    expect(PROCEDURAL_LAYERED_DEPTH_PROVIDER.capabilities.supportedProfiles).toEqual(['layered-depth-2d']);
  });

  it('is deterministic and keeps the player atlas isolated from world inputs', async () => {
    const input = await job();
    const first = await generateProceduralLayeredDepth(input);
    const replay = await generateProceduralLayeredDepth(input);
    const changedEnvironment = await generateProceduralLayeredDepth(
      await job('An original lantern passage with theatrical depth.', 41),
    );
    const changedDescription = await generateProceduralLayeredDepth(
      await job('An original misty archive with a deep central aisle.'),
    );
    const changedSeed = await generateProceduralLayeredDepth(
      await job('An original lantern passage with theatrical depth.', 40, 170, 'another-depth-seed'),
    );
    const changedCharacter = await generateProceduralLayeredDepth(
      await job('An original lantern passage with theatrical depth.', 40, 210),
    );
    expect(first.files.map(({ bytes: payload }) => payload)).toEqual(
      replay.files.map(({ bytes: payload }) => payload),
    );
    expect(bytes(first, 'terrain-atlas')).not.toEqual(bytes(changedEnvironment, 'terrain-atlas'));
    expect(bytes(first, 'terrain-atlas')).not.toEqual(bytes(changedDescription, 'terrain-atlas'));
    expect(bytes(first, 'terrain-atlas')).not.toEqual(bytes(changedSeed, 'terrain-atlas'));
    expect(bytes(first, 'player-atlas')).toEqual(bytes(changedEnvironment, 'player-atlas'));
    expect(bytes(first, 'player-atlas')).toEqual(bytes(changedDescription, 'player-atlas'));
    expect(bytes(first, 'player-atlas')).toEqual(bytes(changedSeed, 'player-atlas'));
    expect(bytes(first, 'player-atlas')).not.toEqual(bytes(changedCharacter, 'player-atlas'));
  });
});
