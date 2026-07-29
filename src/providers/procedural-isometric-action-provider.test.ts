import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import { extractCharacterIdentitySignature } from '../core/character-identity-signature';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import {
  ISOMETRIC_ACTION_REQUIRED_ROLES,
} from '../core/isometric-action-asset-bundle';
import { runWorldAssetProvider } from '../core/world-asset-provider';
import { PROCEDURAL_ISOMETRIC_ACTION_PROVIDER } from './procedural-isometric-action-provider';

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function job(description = 'An original luminous diamond-grid citadel.', environmentMarker = 40, characterMarker = 170) {
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
    id: 'isometric-world-job',
    profile: 'isometric-action',
    description,
    seed: 'isometric-seed-011',
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
    characterIdentity: await extractCharacterIdentitySignature({ width: 2, height: 2, rgba: characterRgba }),
  });
}

function bytes(
  result: Awaited<ReturnType<typeof runWorldAssetProvider>>,
  id: string,
): Uint8Array {
  return result.payloads.find(({ assetId }) => assetId === id)!.readBytes();
}

describe('procedural isometric-action provider', () => {
  it('emits 36 roles, three characters, 128 clips and traversable runtime data', async () => {
    const result = await runWorldAssetProvider(PROCEDURAL_ISOMETRIC_ACTION_PROVIDER, await job());
    expect(result.bundle.roles.map(({ role }) => role)).toEqual(ISOMETRIC_ACTION_REQUIRED_ROLES);
    expect(result.bundle.characters.map(({ id }) => id)).toEqual(['player', 'enemy-melee', 'enemy-ranged']);
    expect(result.bundle.characters.reduce((total, character) => total + character.clips.length, 0)).toBe(128);
    expect(bytes(result, 'terrain-atlas').slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(JSON.parse(new TextDecoder().decode(bytes(result, 'scene-data'))).placements).toHaveLength(6);
    expect(JSON.parse(new TextDecoder().decode(bytes(result, 'collision-map'))).hazards).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode(bytes(result, 'navigation-map'))).exit_node_id).toBe('exit-node');
    expect(result.bundle.assets.find(({ id }) => id === 'player-atlas')?.sourceReferenceIds).toEqual(['character-ref']);
  });

  it('is deterministic and isolates player identity from environment changes', async () => {
    const input = await job();
    const first = await runWorldAssetProvider(PROCEDURAL_ISOMETRIC_ACTION_PROVIDER, input);
    const replay = await runWorldAssetProvider(PROCEDURAL_ISOMETRIC_ACTION_PROVIDER, input);
    const changedEnvironment = await runWorldAssetProvider(
      PROCEDURAL_ISOMETRIC_ACTION_PROVIDER,
      await job('An original luminous diamond-grid citadel.', 41),
    );
    const changedCharacter = await runWorldAssetProvider(
      PROCEDURAL_ISOMETRIC_ACTION_PROVIDER,
      await job('An original luminous diamond-grid citadel.', 40, 210),
    );
    expect(first.payloads.map((payload) => payload.readBytes())).toEqual(
      replay.payloads.map((payload) => payload.readBytes()),
    );
    expect(bytes(first, 'terrain-atlas')).not.toEqual(bytes(changedEnvironment, 'terrain-atlas'));
    expect(bytes(first, 'player-atlas')).toEqual(bytes(changedEnvironment, 'player-atlas'));
    expect(bytes(first, 'player-atlas')).not.toEqual(bytes(changedCharacter, 'player-atlas'));
  });
});
