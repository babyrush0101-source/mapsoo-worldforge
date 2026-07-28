import { describe, expect, it } from 'vitest';

import {
  WorldArtDeliveryKitError,
  buildWorldArtDeliveryKitManifest,
  materializeWorldArtDeliveryKit,
  serializeCanonicalWorldArtDeliveryKit,
  type WorldArtDeliveryKitDraft,
} from './world-art-delivery-kit';

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

function draft(): WorldArtDeliveryKitDraft {
  return {
    schema_version: '1.0.0',
    document_type: 'world-art-delivery-kit',
    pack: {
      id: 'neutral-world-art',
      title: 'Neutral World Art',
      version: '1.0.0',
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
      asset_contract: 'world-art-runtime-overlay-1.0',
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

describe('world art delivery kit manifest', () => {
  it('builds and canonically replays one exact delivery identity', async () => {
    const built = await buildWorldArtDeliveryKitManifest(draft());
    expect(await materializeWorldArtDeliveryKit(built)).toEqual(built);
    expect(await serializeCanonicalWorldArtDeliveryKit(built))
      .toEqual(await serializeCanonicalWorldArtDeliveryKit(built));
    expect(built.delivery_id).toMatch(/^world-art-delivery-[a-f0-9]{16}$/);
  });

  it('rejects stale identity, file order, content binding, and extra fields', async () => {
    const built = await buildWorldArtDeliveryKitManifest(draft());
    const cases = [
      { ...built, delivery_id: 'world-art-delivery-0000000000000000' },
      { ...built, files: [...built.files].reverse() },
      {
        ...built,
        content: {
          ...built.content,
          preview: {
            ...built.content.preview,
            sha256: '2'.repeat(64),
          },
        },
      },
      { ...built, private_source_path: 'not-allowed' },
    ];
    for (const value of cases) {
      await expect(materializeWorldArtDeliveryKit(value))
        .rejects.toBeInstanceOf(WorldArtDeliveryKitError);
    }
  });

  it('rejects public proprietary rights and private redistribution', async () => {
    await expect(buildWorldArtDeliveryKitManifest({
      ...draft(),
      license: {
        id: 'LicenseRef-Proprietary',
        permits_redistribution: true,
      },
    })).rejects.toMatchObject({ code: 'world-art-delivery.invalid-rights' });

    await expect(buildWorldArtDeliveryKitManifest({
      ...draft(),
      distribution: 'private',
      license: {
        id: 'LicenseRef-Proprietary',
        permits_redistribution: true,
      },
    })).rejects.toMatchObject({ code: 'world-art-delivery.invalid-rights' });
  });
});
