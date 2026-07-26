import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from '../../src/adapters/canvas/encode-png';
import { buildAlpha12WorldAssetPack } from '../../src/adapters/export-world-asset-pack-alpha12';
import { extractCharacterIdentitySignature } from '../../src/core/character-identity-signature';
import { bindGenerationRequestV2 } from '../../src/core/generation-request-v2';
import { runWorldAssetProvider } from '../../src/core/world-asset-provider';
import { PROCEDURAL_LAYERED_DEPTH_PROVIDER } from '../../src/providers/procedural-layered-depth-provider';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fixture() {
  const environment = encodeRgbaPng(2, 2, Uint8Array.from([
    28, 76, 128, 255, 72, 142, 112, 255, 24, 34, 64, 255, 208, 164, 88, 255,
  ]));
  const characterRgba = Uint8Array.from([
    184, 58, 108, 255, 236, 184, 138, 255, 58, 68, 142, 255, 24, 28, 40, 255,
  ]);
  const character = encodeRgbaPng(2, 2, characterRgba);
  const descriptor = async (role: 'environment-style' | 'character', bytes: Uint8Array) => ({
    id: `${role}-reference`,
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
    id: 'alpha12-godot-smoke-pack',
    profile: 'layered-depth-2d',
    description: 'An original shallow-depth lantern corridor with a guide and reachable exit.',
    seed: 'alpha12-godot-smoke-001',
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
  const run = await runWorldAssetProvider(PROCEDURAL_LAYERED_DEPTH_PROVIDER, job);
  return buildAlpha12WorldAssetPack(run, bound.request, '2026-07-26T09:00:00.000Z');
}

async function extract(bytes: Uint8Array, outputRoot: string): Promise<void> {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const roots = new Set(files.map((entry) => entry.name.split('/')[0]));
  if (roots.size !== 1) throw new Error('Alpha12 fixture must have one archive root.');
  const root = [...roots][0];
  for (const entry of files) {
    const relative = entry.name.slice(root.length + 1);
    if (!relative || relative.includes('..') || relative.startsWith('/')) {
      throw new Error(`Unsafe fixture path: ${entry.name}`);
    }
    const target = join(outputRoot, ...relative.split('/'));
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, await entry.async('uint8array'));
  }
}

describe('Alpha12 Godot fixture', () => {
  it('materializes the exact Pack 0.9 provider/exporter candidate', async () => {
    const pack = await fixture();
    expect(pack.manifest).toMatchObject({
      schema_version: '0.9.0',
      pack: { id: 'alpha12-godot-smoke-pack' },
      profile: 'layered-depth-2d',
      completeness_policy: 'layered-depth-2d-complete-v1',
    });
    expect(pack.manifest.roles).toHaveLength(36);
    expect(pack.manifest.planes).toHaveLength(7);
    expect(pack.manifest.characters.reduce((total, character) => total + character.clips.length, 0)).toBe(24);
    const outputRoot = process.env.MAPSOO_ALPHA12_FIXTURE_ROOT;
    if (outputRoot) await extract(pack.bytes, outputRoot);
  });
});
