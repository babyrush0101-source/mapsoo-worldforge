import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import { TOPDOWN_FARM_REQUIRED_ROLES } from '../core/generated-asset-bundle';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import { extractCharacterIdentitySignature } from '../core/character-identity-signature';
import { runWorldAssetProvider } from '../core/world-asset-provider';
import { PROCEDURAL_TOPDOWN_FARM_PROVIDER } from './procedural-topdown-farm-provider';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function createJob(description = 'A bright riverside farm.', characterMarker = 180) {
  const environment = encodeRgbaPng(2, 2, Uint8Array.from([
    20, 140, 70, 255, 60, 170, 90, 255,
    40, 100, 180, 255, 200, 160, 90, 255,
  ]));
  const characterRgba = Uint8Array.from([
    characterMarker, 40, 110, 255, 230, 180, 140, 255,
    70, 80, 160, 255, 30, 30, 40, 255,
  ]);
  const character = encodeRgbaPng(2, 2, characterRgba);
  const descriptor = async (role: 'environment-style' | 'character', bytes: Uint8Array) => ({
    id: role === 'environment-style' ? 'environment-reference' : 'character-reference',
    role,
    path: `references/${role}.png`,
    mediaType: 'image/png' as const,
    byteLength: bytes.byteLength,
    width: 2,
    height: 2,
    sha256: await sha256(bytes),
    rights: {
      basis: 'owned' as const,
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true as const,
      allowOutputRedistribution: true as const,
      allowOutputCc0Dedication: true as const,
    },
  });
  const bound = await bindGenerationRequestV2({
    schemaVersion: '1.0.0', id: 'complete-farm-job', profile: 'topdown-farm', description, seed: 'farm-seed-009',
    references: [await descriptor('environment-style', environment), await descriptor('character', character)],
  }, [
    { path: 'references/environment-style.png', bytes: environment },
    { path: 'references/character.png', bytes: character },
  ]);
  return Object.freeze({
    ...bound,
    characterIdentity: await extractCharacterIdentitySignature({ width: 2, height: 2, rgba: characterRgba }),
  });
}

function payload(result: Awaited<ReturnType<typeof runWorldAssetProvider>>, id: string): Uint8Array {
  const found = result.payloads.find((candidate) => candidate.assetId === id);
  if (!found) throw new Error(`Missing payload: ${id}`);
  return found.readBytes();
}

describe('procedural top-down farm provider', () => {
  it('generates all required world roles, five raster asset groups, and runtime sidecars', async () => {
    const result = await runWorldAssetProvider(PROCEDURAL_TOPDOWN_FARM_PROVIDER, await createJob());
    expect(result.bundle.roles.map(({ role }) => role).sort()).toEqual([...TOPDOWN_FARM_REQUIRED_ROLES].sort());
    expect(result.payloads.map(({ path }) => path)).toEqual(expect.arrayContaining([
      'atlases/terrain.png', 'atlases/props.png', 'atlases/structures.png', 'atlases/crops.png',
      'atlases/character.png', 'runtime/scene.json', 'runtime/collision.json', 'runtime/navigation.json',
      'previews/world.png',
    ]));
    const scene = JSON.parse(new TextDecoder().decode(payload(result, 'scene-data')));
    expect(scene.layers.soil.filter((tile: number) => tile >= 0).length).toBeGreaterThan(0);
    expect(scene.crops.map(({ role }: { role: string }) => role)).toEqual([
      'crop.basic.stage-1', 'crop.basic.stage-2', 'crop.basic.stage-3', 'crop.basic.stage-4',
    ]);
    expect(scene.structures).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'structure.house' }), expect.objectContaining({ role: 'structure.barn' }),
    ]));
    const navigation = JSON.parse(new TextDecoder().decode(payload(result, 'navigation-map')));
    expect(navigation.outlines[0]).toHaveLength(4);
    expect(result.bundle.characters[0].clips).toHaveLength(8);
  });

  it('is byte-reproducible for the same bound request', async () => {
    const job = await createJob();
    const first = await runWorldAssetProvider(PROCEDURAL_TOPDOWN_FARM_PROVIDER, job);
    const second = await runWorldAssetProvider(PROCEDURAL_TOPDOWN_FARM_PROVIDER, job);
    expect(first.bundle.assets.map(({ sha256 }) => sha256)).toEqual(second.bundle.assets.map(({ sha256 }) => sha256));
    expect(first.payloads.map((item) => item.readBytes())).toEqual(second.payloads.map((item) => item.readBytes()));
  });

  it('uses both description and character reference when styling output', async () => {
    const baseline = await runWorldAssetProvider(PROCEDURAL_TOPDOWN_FARM_PROVIDER, await createJob());
    const newDescription = await runWorldAssetProvider(PROCEDURAL_TOPDOWN_FARM_PROVIDER, await createJob('A moonlit autumn farm.'));
    const newCharacter = await runWorldAssetProvider(PROCEDURAL_TOPDOWN_FARM_PROVIDER, await createJob('A bright riverside farm.', 210));
    expect(payload(baseline, 'terrain-atlas')).not.toEqual(payload(newDescription, 'terrain-atlas'));
    expect(payload(baseline, 'character-atlas')).not.toEqual(payload(newCharacter, 'character-atlas'));
    expect(payload(baseline, 'character-atlas')).toEqual(payload(newDescription, 'character-atlas'));
    expect(resultCharacterSources(baseline)).toEqual(['character-reference']);
  });
});

function resultCharacterSources(result: Awaited<ReturnType<typeof runWorldAssetProvider>>): readonly string[] | undefined {
  return result.bundle.assets.find(({ id }) => id === 'character-atlas')?.sourceReferenceIds;
}
