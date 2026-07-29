import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import { extractCharacterIdentitySignature } from '../core/character-identity-signature';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import { runWorldAssetProvider } from '../core/world-asset-provider';
import { PROCEDURAL_ISOMETRIC_ACTION_PROVIDER } from '../providers/procedural-isometric-action-provider';
import { buildAlpha11WorldAssetPack } from './export-world-asset-pack-alpha11';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function trustedInput() {
  const environment = encodeRgbaPng(2, 2, Uint8Array.from([
    20, 80, 140, 255, 60, 110, 75, 255, 170, 110, 60, 255, 30, 35, 50, 255,
  ]));
  const characterRgba = Uint8Array.from([
    210, 60, 90, 255, 230, 180, 140, 255, 40, 70, 150, 255, 20, 25, 35, 255,
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
    schemaVersion: '1.0.0',
    id: 'alpha11-isometric-world',
    profile: 'isometric-action',
    description: 'An original luminous action citadel with a readable route and exit.',
    seed: 'alpha11-seed',
    references: [
      await descriptor('environment-style', environment),
      await descriptor('character', character),
    ],
  }, [
    { path: 'references/environment-style.png', bytes: environment },
    { path: 'references/character.png', bytes: character },
  ]);
  const job = Object.freeze({
    ...bound,
    characterIdentity: await extractCharacterIdentitySignature({
      width: 2,
      height: 2,
      rgba: characterRgba,
    }),
  });
  return { bound, run: await runWorldAssetProvider(PROCEDURAL_ISOMETRIC_ACTION_PROVIDER, job) };
}

describe('Alpha11 isometric-action Pack 0.8 exporter', () => {
  it('builds a deterministic, privacy-minimized complete archive', async () => {
    const { bound, run } = await trustedInput();
    const completedAt = '2026-07-26T08:00:00.000Z';
    const first = await buildAlpha11WorldAssetPack(run, bound.request, completedAt);
    const second = await buildAlpha11WorldAssetPack(run, bound.request, completedAt);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.manifest.schema_version).toBe('0.8.0');
    expect(first.manifest.roles).toHaveLength(36);
    expect(first.manifest.characters.reduce((total, character) => total + character.clips.length, 0)).toBe(128);
    expect(first.filename).toBe('mapsoo-alpha11-isometric-world-v0.1.0-alpha.11.zip');

    const archive = await JSZip.loadAsync(first.bytes);
    const names = Object.keys(archive.files);
    expect(names.some((name) => name.endsWith('/mapsoo.manifest.json'))).toBe(true);
    expect(names.some((name) => name.endsWith('/atlases/player.png'))).toBe(true);
    expect(names.some((name) => name.endsWith('/runtime/navigation.json'))).toBe(true);
    expect(names.every((name) => !name.includes('references/'))).toBe(true);
    const receiptName = names.find((name) => name.endsWith('/generation-receipt.json'))!;
    const receipt = await archive.file(receiptName)!.async('string');
    expect(receipt).not.toContain('characterIdentity');
    expect(receipt).not.toContain(bound.request.description);
    expect(receipt).not.toContain(bound.request.references[0].sha256);
  });

  it('rejects mismatched profiles and invalid completion timestamps', async () => {
    const { bound, run } = await trustedInput();
    await expect(buildAlpha11WorldAssetPack(
      run,
      { ...bound.request, profile: 'side-platformer' },
      '2026-07-26T08:00:00.000Z',
    )).rejects.toThrow(/isometric-action/);
    await expect(buildAlpha11WorldAssetPack(
      run,
      bound.request,
      '2026-07-26',
    )).rejects.toThrow(/canonical UTC ISO/);
  });
});
