import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import { extractCharacterIdentitySignature } from '../core/character-identity-signature';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import { runWorldAssetProvider } from '../core/world-asset-provider';
import { PROCEDURAL_LAYERED_DEPTH_PROVIDER } from '../providers/procedural-layered-depth-provider';
import { buildAlpha12WorldAssetPack } from './export-world-asset-pack-alpha12';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function trustedInput() {
  const environment = encodeRgbaPng(2, 2, Uint8Array.from([
    22, 76, 138, 255, 58, 112, 78, 255, 166, 106, 64, 255, 28, 34, 52, 255,
  ]));
  const characterRgba = Uint8Array.from([
    208, 62, 94, 255, 232, 182, 142, 255, 42, 72, 148, 255, 18, 24, 36, 255,
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
    id: 'alpha12-layered-world',
    profile: 'layered-depth-2d',
    description: 'An original lantern corridor with layered fog, a guide and a visible exit.',
    seed: 'alpha12-seed',
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
  return { bound, run: await runWorldAssetProvider(PROCEDURAL_LAYERED_DEPTH_PROVIDER, job) };
}

describe('Alpha12 layered-depth Pack 0.9 exporter', () => {
  it('builds a deterministic, privacy-minimized complete archive', async () => {
    const { bound, run } = await trustedInput();
    const completedAt = '2026-07-26T09:00:00.000Z';
    const first = await buildAlpha12WorldAssetPack(run, bound.request, completedAt);
    const second = await buildAlpha12WorldAssetPack(run, bound.request, completedAt);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.manifest.schema_version).toBe('0.9.0');
    expect(first.manifest.roles).toHaveLength(36);
    expect(first.manifest.layers).toHaveLength(7);
    expect(first.manifest.planes).toHaveLength(7);
    expect(first.manifest.characters.reduce((total, character) => total + character.clips.length, 0)).toBe(24);
    expect(first.filename).toBe('mapsoo-alpha12-layered-world-v0.1.0-alpha.12.zip');

    const archive = await JSZip.loadAsync(first.bytes);
    const names = Object.keys(archive.files);
    expect(names.some((name) => name.endsWith('/mapsoo.manifest.json'))).toBe(true);
    expect(names.some((name) => name.endsWith('/layers/background-depth-fog.png'))).toBe(true);
    expect(names.some((name) => name.endsWith('/atlases/player.png'))).toBe(true);
    expect(names.every((name) => !name.includes('references/'))).toBe(true);
    const receiptName = names.find((name) => name.endsWith('/generation-receipt.json'))!;
    const receipt = await archive.file(receiptName)!.async('string');
    expect(receipt).not.toContain('characterIdentity');
    expect(receipt).not.toContain(bound.request.description);
    expect(receipt).not.toContain(bound.request.references[0].sha256);
  });

  it('rejects mismatched profiles and invalid completion timestamps', async () => {
    const { bound, run } = await trustedInput();
    await expect(buildAlpha12WorldAssetPack(
      run,
      { ...bound.request, profile: 'isometric-action' },
      '2026-07-26T09:00:00.000Z',
    )).rejects.toThrow(/layered-depth/);
    await expect(buildAlpha12WorldAssetPack(run, bound.request, '2026-07-26'))
      .rejects.toThrow(/canonical UTC ISO/);
  });
});
