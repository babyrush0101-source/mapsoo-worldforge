import { describe, expect, it } from 'vitest';

import type { GeneratedAssetBundle, GeneratedAssetRecord } from './generated-asset-bundle';
import type { TrustedGeneratedAssetPayload } from './world-asset-provider';
import { createExportedWorldReviewEvidence } from './exported-world-review-evidence';

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fixture() {
  const values = {
    preview: Uint8Array.from([137, 80, 78, 71, 1]),
    scene: new TextEncoder().encode('{"scene":1}'),
    collision: new TextEncoder().encode('{"collision":1}'),
    navigation: new TextEncoder().encode('{"navigation":1}'),
    atlas: Uint8Array.from([137, 80, 78, 71, 2]),
  };
  const record = async (
    id: keyof typeof values,
    kind: GeneratedAssetRecord['kind'],
    path: string,
    mediaType: GeneratedAssetRecord['mediaType'],
    dimensions?: readonly [number, number],
  ): Promise<GeneratedAssetRecord> => ({
    id,
    kind,
    path,
    mediaType,
    bytes: values[id].byteLength,
    sha256: await digest(values[id]),
    ...(dimensions ? { width: dimensions[0], height: dimensions[1] } : {}),
    sourceReferenceIds: [],
  });
  const assets = await Promise.all([
    record('preview', 'preview', 'previews/world.png', 'image/png', [320, 180]),
    record('scene', 'scene-data', 'runtime/scene.json', 'application/json'),
    record('collision', 'collision-map', 'runtime/collision.json', 'application/json'),
    record('navigation', 'navigation-map', 'runtime/navigation.json', 'application/json'),
    record('atlas', 'terrain-atlas', 'atlases/terrain.png', 'image/png', [32, 32]),
  ]);
  const bundle: GeneratedAssetBundle = {
    schemaVersion: '0.1.0',
    jobId: 'review-world',
    profile: 'topdown-farm',
    completenessPolicy: 'fixture',
    assets,
    roles: [{ role: 'world.preview', assetId: 'preview' }],
    characters: [],
    scene: {
      id: 'scene',
      dataAssetId: 'scene',
      collisionAssetId: 'collision',
      navigationAssetId: 'navigation',
      previewAssetId: 'preview',
      spawn: { x: 0, y: 0 },
    },
  };
  const payloads: TrustedGeneratedAssetPayload[] = assets.map((asset) => ({
    assetId: asset.id,
    path: asset.path,
    mediaType: asset.mediaType,
    byteLength: asset.bytes,
    readBytes: () => values[asset.id as keyof typeof values].slice(),
  }));
  return { bundle, payloads };
}

describe('exported world review evidence', () => {
  it('binds the approved intent, exact pack preview, runtime data and visual assets', async () => {
    const { bundle, payloads } = await fixture();
    const evidence = await createExportedWorldReviewEvidence({
      bundle,
      payloads,
      requestFingerprintSha256: 'a'.repeat(64),
      dialogueBindingSha256: 'b'.repeat(64),
      approvedIntentPreviewSha256: 'c'.repeat(64),
    });
    expect(evidence).toMatchObject({
      profile: 'topdown-farm',
      approved_intent_preview_sha256: 'c'.repeat(64),
      preview: { asset_id: 'preview', path: 'previews/world.png', width: 320, height: 180 },
    });
    expect(evidence.visual_asset_set_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.review_binding_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a substituted preview payload', async () => {
    const { bundle, payloads } = await fixture();
    const substituted = payloads.map((payload) => payload.assetId === 'preview'
      ? { ...payload, readBytes: () => Uint8Array.from([1, 2, 3]) }
      : payload);
    await expect(createExportedWorldReviewEvidence({
      bundle,
      payloads: substituted,
      requestFingerprintSha256: 'a'.repeat(64),
    })).rejects.toThrow('recorded SHA-256');
  });

  it('rejects a preview that is not the exported world.preview role', async () => {
    const { bundle, payloads } = await fixture();
    await expect(createExportedWorldReviewEvidence({
      bundle: { ...bundle, roles: [{ role: 'world.preview', assetId: 'atlas' }] },
      payloads,
      requestFingerprintSha256: 'a'.repeat(64),
    })).rejects.toThrow('scene-bound world.preview');
  });
});
