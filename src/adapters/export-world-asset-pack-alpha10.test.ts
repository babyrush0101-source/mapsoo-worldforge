import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import packSchema from '../../schemas/mapsoo-pack-0.7.schema.json';
import receiptSchema from '../../schemas/mapsoo-world-asset-receipt-0.2.schema.json';
import { PROCEDURAL_SIDE_PLATFORMER_PROVIDER } from '../providers/procedural-side-platformer-provider';
import { encodeRgbaPng } from './canvas/encode-png';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import { createConfirmedGenerationBinding } from '../core/confirmed-generation-binding';
import { runWorldAssetProvider } from '../core/world-asset-provider';
import { buildAlpha10WorldAssetPack } from './export-world-asset-pack-alpha10';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function job(basis: 'owned' | 'licensed' = 'owned') {
  const environment = encodeRgbaPng(2, 2, Uint8Array.from([30, 100, 65, 255, 70, 90, 140, 255, 20, 40, 60, 255, 180, 160, 85, 255]));
  const character = encodeRgbaPng(2, 2, Uint8Array.from([170, 45, 95, 255, 225, 175, 125, 255, 45, 55, 125, 255, 18, 24, 32, 255]));
  const descriptor = async (role: 'environment-style' | 'character', bytes: Uint8Array) => ({
    id: `${role}-reference`, role, path: `private/alpha10/${role}.png`, mediaType: 'image/png' as const,
    byteLength: bytes.byteLength, width: 2, height: 2, sha256: await sha256(bytes),
    rights: {
      basis,
      license: basis === 'owned' ? 'LicenseRef-User-Owned' : 'CC-BY-4.0',
      allowGenerativeAdaptation: true as const,
      allowOutputRedistribution: true as const,
      allowOutputCc0Dedication: true as const,
      ...(basis === 'licensed' ? { attribution: 'Private artist name' } : {}),
    },
  });
  return bindGenerationRequestV2({
    schemaVersion: '1.0.0', id: 'alpha10-side-world', profile: 'side-platformer',
    description: 'Private floating forest direction must not ship.', seed: 'public-alpha10-seed',
    references: [await descriptor('environment-style', environment), await descriptor('character', character)],
  }, [
    { path: 'private/alpha10/environment-style.png', bytes: environment },
    { path: 'private/alpha10/character.png', bytes: character },
  ]);
}

async function archiveEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes);
  return new Map(await Promise.all(Object.values(zip.files).filter((file) => !file.dir).map(async (file) => [file.name, await file.async('uint8array')] as const)));
}

describe('Alpha10 side-platformer Pack 0.7 exporter', () => {
  it('builds a deterministic schema-valid portable pack with strict runtime and receipt schemas', async () => {
    const bound = await job();
    const run = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, bound);
    const first = await buildAlpha10WorldAssetPack(run, bound.request, '2026-07-20T12:00:00.000Z');
    const second = await buildAlpha10WorldAssetPack(run, bound.request, '2026-07-20T12:00:00.000Z');
    expect(first.bytes).toEqual(second.bytes);
    expect(first.filename).toBe('mapsoo-alpha10-side-world-v0.1.0-alpha.10.zip');
    const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true }); addFormats(ajv);
    const validateManifest = ajv.compile(packSchema);
    expect(validateManifest(first.manifest), JSON.stringify(validateManifest.errors)).toBe(true);
    const entries = await archiveEntries(first.bytes);
    const root = 'mapsoo-alpha10-side-world-v0.1.0-alpha.10/';
    const receipt = JSON.parse(new TextDecoder().decode(entries.get(`${root}generation-receipt.json`)));
    const validateReceipt = ajv.compile(receiptSchema);
    expect(validateReceipt(receipt), JSON.stringify(validateReceipt.errors)).toBe(true);
    expect(entries.has(`${root}runtime/scene.json`)).toBe(true);
    expect(entries.has(`${root}runtime/collision.json`)).toBe(true);
    expect(entries.has(`${root}runtime/navigation.json`)).toBe(true);
  });

  it('does not embed reference bytes, private paths, description, attribution or raw reference digests', async () => {
    const bound = await job();
    const run = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, bound);
    const pack = await buildAlpha10WorldAssetPack(run, bound.request, '2026-07-20T12:00:00.000Z');
    const entries = await archiveEntries(pack.bytes);
    const exposed = [...entries.values()].map((bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes)).join('\n');
    expect(exposed).not.toContain('private/alpha10');
    expect(exposed).not.toContain('Private floating forest direction');
    for (const reference of bound.request.references) expect(exposed).not.toContain(reference.sha256);
  });

  it('rejects a same-id request substitution through the full request fingerprint', async () => {
    const bound = await job();
    const run = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, bound);
    const substituted = structuredClone(bound.request) as unknown as { description: string };
    substituted.description = 'Different same-id request.';
    await expect(buildAlpha10WorldAssetPack(
      run, substituted as unknown as typeof bound.request, '2026-07-20T12:00:00.000Z',
    )).rejects.toThrow(/fingerprint/);
  });

  it('rejects licensed references instead of silently dedicating their output to CC0', async () => {
    const bound = await job('licensed');
    const run = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, bound);
    await expect(buildAlpha10WorldAssetPack(run, bound.request, '2026-07-20T12:00:00.000Z')).rejects.toThrow(/user-owned/);
  });

  it('embeds and schema-validates a confirmed dialogue binding, then rejects substitution', async () => {
    const bound = await job();
    const run = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, bound);
    const confirmation = await createConfirmedGenerationBinding(bound.request, {
      sessionRevision: 4,
      checkpoints: [
        { stage: 'world-brief', snapshotSha256: 'a'.repeat(64) },
        { stage: 'art-direction', snapshotSha256: 'b'.repeat(64) },
        { stage: 'map-layout', snapshotSha256: 'c'.repeat(64) },
        { stage: 'style-sample', snapshotSha256: 'd'.repeat(64) },
      ],
    });
    const pack = await buildAlpha10WorldAssetPack(
      run, bound.request, '2026-07-20T12:00:00.000Z', confirmation,
    );
    const entries = await archiveEntries(pack.bytes);
    const root = 'mapsoo-alpha10-side-world-v0.1.0-alpha.10/';
    const receipt = JSON.parse(new TextDecoder().decode(entries.get(`${root}generation-receipt.json`)));
    const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true }); addFormats(ajv);
    const validateReceipt = ajv.compile(receiptSchema);
    expect(validateReceipt(receipt), JSON.stringify(validateReceipt.errors)).toBe(true);
    expect(receipt.request.dialogue_binding).toEqual(confirmation);

    await expect(buildAlpha10WorldAssetPack(
      run,
      { ...bound.request, seed: 'substituted-seed' },
      '2026-07-20T12:00:00.000Z',
      confirmation,
    )).rejects.toThrow(/fingerprint/);
  });
});
