import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import committedManifest from '../../tests/fixtures/pack10-public/mapsoo.manifest.json';
import {
  bindGenerationRequestV2,
  fingerprintGenerationRequestV2,
  type GenerationRequestJobV2,
} from '../core/generation-request-v2';
import { materializeReferenceImageDescriptor, type ReferenceImageRole } from '../core/reference-image';
import {
  assertTrustedWorldAssetGeneration,
  createFingerprintBoundWorldAssetReplayProvider,
  runWorldAssetProvider,
} from '../core/world-asset-provider';
import { LAYERED_DEPTH_REQUIRED_ROLES } from '../core/layered-depth-asset-bundle';
import {
  materializePack10WorldAssetOutput,
  Pack10WorldAssetProjectionError,
} from '../adapters/materialize-pack10-world-asset-output';
import { replayPack10WorldAsset } from './replay-pack10-world-asset';

const FIXTURE_ROOT = resolve(process.cwd(), 'tests/fixtures/pack10-public');

function png(width: number, height: number, marker: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes[32] = marker;
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function descriptor(
  id: string,
  role: ReferenceImageRole,
  path: string,
  bytes: Uint8Array,
) {
  return materializeReferenceImageDescriptor({
    id,
    role,
    path,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    width: 2,
    height: 3,
    sha256: await sha256(bytes),
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  });
}

async function job(
  description = 'A layered harbor village with a playable exploration corridor.',
): Promise<GenerationRequestJobV2> {
  const environment = png(2, 3, 1);
  const character = png(2, 3, 2);
  const request = {
    schemaVersion: '1.0.0' as const,
    id: 'pack10-replay-job',
    profile: 'layered-depth-2d' as const,
    description,
    seed: 'pack10-replay-seed-001',
    references: [
      await descriptor(
        'environment-reference',
        'environment-style',
        'references/environment.png',
        environment,
      ),
      await descriptor(
        'character-reference',
        'character',
        'references/character.png',
        character,
      ),
    ] as const,
  };
  return bindGenerationRequestV2(request, [
    { path: 'references/environment.png', bytes: environment },
    { path: 'references/character.png', bytes: character },
  ]);
}

async function fixtureZip(
  edit?: (archive: JSZip) => void | Promise<void>,
): Promise<Uint8Array> {
  const archive = new JSZip();
  const manifestBytes = Uint8Array.from(
    await readFile(resolve(FIXTURE_ROOT, 'mapsoo.manifest.json')),
  );
  archive.file('mapsoo.manifest.json', manifestBytes, { createFolders: false });
  for (const record of committedManifest.files) {
    archive.file(
      record.path,
      Uint8Array.from(await readFile(resolve(FIXTURE_ROOT, record.path))),
      { createFolders: false },
    );
  }
  await edit?.(archive);
  return Uint8Array.from(await archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  }));
}

describe('Pack 1.0 world asset replay', () => {
  it('projects the complete Pack once and reuses the trusted provider runner', async () => {
    const result = await replayPack10WorldAsset(await fixtureZip(), await job());

    expect(result.generation.bundle.profile).toBe('layered-depth-2d');
    expect(result.generation.bundle.roles.map(({ role }) => role)).toEqual(LAYERED_DEPTH_REQUIRED_ROLES);
    expect(result.generation.bundle.assets).toHaveLength(19);
    expect(result.generation.bundle.characters.map(({ id }) => id)).toEqual(['player', 'npc']);
    expect(result.generation.payloads).toHaveLength(19);
    expect(result.generation.payloads.every(({ path }) =>
      !path.startsWith('license') && !path.startsWith('provenance/'))).toBe(true);
    expect(result.generation.provider.capabilities.outputProvenance).toBe('recorded-replay');
    expect(result.source).toMatchObject({
      document_type: 'pack10-world-asset-replay-receipt',
      pack_id: 'pack10-public-fixture',
      distribution: 'public',
      runtime_asset_count: 19,
      runtime_role_count: 36,
    });
    expect(result.source.review).toEqual(committedManifest.review);
    expect(() => assertTrustedWorldAssetGeneration(result.generation)).not.toThrow();
  });

  it('binds replay to the full request fingerprint, not only its id', async () => {
    const originalJob = await job();
    const projection = await materializePack10WorldAssetOutput(await fixtureZip(), originalJob.request);
    const provider = createFingerprintBoundWorldAssetReplayProvider(
      'pack10-fingerprint-test',
      '1.0.0',
      'layered-depth-2d',
      projection.output,
      await fingerprintGenerationRequestV2(originalJob.request),
    );
    const changedJob = await job('A different world description with the same request id.');

    await expect(runWorldAssetProvider(provider, changedJob)).rejects.toMatchObject({
      code: 'world-provider.invalid-output',
    });
  });

  it('rejects an unrecorded ZIP entry and a payload hash mismatch', async () => {
    const request = (await job()).request;
    const extra = await fixtureZip((archive) => {
      archive.file('unrecorded.json', '{}', { createFolders: false });
    });
    await expect(materializePack10WorldAssetOutput(extra, request)).rejects.toMatchObject({
      code: 'pack10-replay.integrity',
    });

    const tampered = await fixtureZip((archive) => {
      archive.file('runtime/scene.json', '{"tampered":true}', { createFolders: false });
    });
    await expect(materializePack10WorldAssetOutput(tampered, request))
      .rejects.toBeInstanceOf(Pack10WorldAssetProjectionError);
    await expect(materializePack10WorldAssetOutput(tampered, request)).rejects.toMatchObject({
      code: 'pack10-replay.integrity',
    });
  });

  it('rejects a non-layered request before archive projection', async () => {
    const layered = await job();
    const request = { ...layered.request, profile: 'topdown-farm' as const };
    await expect(materializePack10WorldAssetOutput(await fixtureZip(), request)).rejects.toMatchObject({
      code: 'pack10-replay.invalid-runtime-projection',
    });
  });
});
