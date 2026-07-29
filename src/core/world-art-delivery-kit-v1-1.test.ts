import { describe, expect, it } from 'vitest';

import {
  WorldArtDeliveryKitV1_1Error,
  buildWorldArtDeliveryKitManifestV1_1,
  fingerprintWorldArtDeliveryKitV1_1,
  materializeWorldArtDeliveryKitV1_1,
  serializeCanonicalWorldArtDeliveryKitV1_1,
  type WorldArtDeliveryKitV1_1Draft,
} from './world-art-delivery-kit-v1-1';

const HASH = Object.freeze({
  overlay: 'a'.repeat(64),
  production: 'b'.repeat(64),
  human: 'c'.repeat(64),
  preview: 'd'.repeat(64),
  changelog: 'e'.repeat(64),
  license: 'f'.repeat(64),
  readme: '0'.repeat(64),
  projection: '1'.repeat(64),
});

function draft(): WorldArtDeliveryKitV1_1Draft {
  return {
    schema_version: '1.1.0',
    document_type: 'world-art-delivery-kit',
    pack: {
      id: 'placed-world-art',
      title: 'Placed World Art',
      version: '1.1.0',
    },
    profile: 'topdown-farm',
    distribution: 'public',
    license: {
      id: 'CC0-1.0',
      permits_redistribution: true,
    },
    content: {
      runtime_overlay: {
        path: 'assets/world-art-runtime-overlay-aabbccddeeff0011.zip',
        overlay_id: 'world-art-runtime-overlay-aabbccddeeff0011',
        bytes: 4096,
        sha256: HASH.overlay,
        projection_sha256: HASH.projection,
      },
      production_world_review: {
        path: 'review/production-world-review.json',
        sha256: HASH.production,
      },
      human_art_review: {
        path: 'review-evidence/human-review.json',
        sha256: HASH.human,
      },
      preview: {
        path: 'review-evidence/world-preview.png',
        sha256: HASH.preview,
        width: 1280,
        height: 720,
      },
    },
    compatibility: {
      engine: 'godot',
      tested_versions: ['4.3', '4.7'],
      importer: 'mapsoo-importer',
      asset_contract: 'world-art-runtime-overlay-1.1',
    },
    ai_disclosure: {
      contains_generative_ai: true,
      human_curated: true,
      original_references_embedded: false,
    },
    files: [
      {
        path: 'assets/world-art-runtime-overlay-aabbccddeeff0011.zip',
        media_type: 'application/zip',
        bytes: 4096,
        sha256: HASH.overlay,
      },
      {
        path: 'changelog.md',
        media_type: 'text/markdown',
        bytes: 128,
        sha256: HASH.changelog,
      },
      {
        path: 'license-assets.md',
        media_type: 'text/markdown',
        bytes: 128,
        sha256: HASH.license,
      },
      {
        path: 'readme.md',
        media_type: 'text/markdown',
        bytes: 256,
        sha256: HASH.readme,
      },
      {
        path: 'review-evidence/human-review.json',
        media_type: 'application/json',
        bytes: 1024,
        sha256: HASH.human,
      },
      {
        path: 'review-evidence/world-preview.png',
        media_type: 'image/png',
        bytes: 8192,
        sha256: HASH.preview,
      },
      {
        path: 'review/production-world-review.json',
        media_type: 'application/json',
        bytes: 2048,
        sha256: HASH.production,
      },
    ],
  };
}

describe('world art delivery kit manifest 1.1', () => {
  it('builds and canonically replays a layout-bound delivery identity', async () => {
    const built = await buildWorldArtDeliveryKitManifestV1_1(draft());

    expect(built.schema_version).toBe('1.1.0');
    expect(built.compatibility.asset_contract)
      .toBe('world-art-runtime-overlay-1.1');
    expect(await materializeWorldArtDeliveryKitV1_1(built)).toEqual(built);
    expect(await serializeCanonicalWorldArtDeliveryKitV1_1(built))
      .toEqual(await serializeCanonicalWorldArtDeliveryKitV1_1(built));
    expect(await fingerprintWorldArtDeliveryKitV1_1(built))
      .toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects stale identity, the 1.0 contract, and extra fields', async () => {
    const built = await buildWorldArtDeliveryKitManifestV1_1(draft());
    const cases = [
      { ...built, delivery_id: 'world-art-delivery-0000000000000000' },
      {
        ...built,
        compatibility: {
          ...built.compatibility,
          asset_contract: 'world-art-runtime-overlay-1.0',
        },
      },
      { ...built, schema_version: '1.0.0' },
      { ...built, private_layout_path: 'not-allowed' },
    ];

    for (const value of cases) {
      await expect(materializeWorldArtDeliveryKitV1_1(value))
        .rejects.toBeInstanceOf(WorldArtDeliveryKitV1_1Error);
    }
  });
});
