import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-world-art-runtime-overlay-1.0.schema.json';
import {
  buildWorldArtRuntimeOverlay,
  fingerprintWorldArtRuntimeOverlay,
  materializeWorldArtRuntimeOverlay,
  serializeCanonicalWorldArtRuntimeOverlay,
  type WorldArtRuntimeOverlayDraft,
} from './world-art-runtime-overlay';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

function draft(): WorldArtRuntimeOverlayDraft {
  return {
    schema_version: '1.0.0',
    document_type: 'world-art-runtime-overlay',
    profile: 'side-platformer',
    source: {
      projection_id: 'world-art-runtime-projection-0123456789abcdef',
      projection_sha256: A,
      layout_plan_sha256: B,
      review_record_sha256: C,
    },
    rights: {
      distribution: 'public',
      license: 'CC0-1.0',
    },
    review: {
      human_art: 'pass',
      runtime: 'pending',
      raspberry_pi: 'pending',
    },
    projection: {
      path: 'world-art-runtime-projection.json',
      sha256: D,
    },
    files: [
      {
        path: 'production-art/side-platformer/terrain-sheet-001.png',
        media_type: 'image/png',
        bytes: 128,
        sha256: A,
      },
      {
        path: 'world-art-runtime-projection.json',
        media_type: 'application/json',
        bytes: 1024,
        sha256: D,
      },
    ],
    reference_policy: {
      embedded: false,
      original_references_excluded: true,
      raw_prompts_excluded: true,
      only_one_way_audit_hashes_retained: true,
    },
  };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('WorldArtRuntimeOverlay manifest', () => {
  it('is deterministic, canonical, and JSON Schema valid', async () => {
    const left = await buildWorldArtRuntimeOverlay(draft());
    const right = await buildWorldArtRuntimeOverlay(draft());
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(left), JSON.stringify(validate.errors)).toBe(true);
    expect(left).toEqual(right);
    expect(await materializeWorldArtRuntimeOverlay(left)).toEqual(left);
    expect(await fingerprintWorldArtRuntimeOverlay(left))
      .toBe(await fingerprintWorldArtRuntimeOverlay(right));
    expect(await serializeCanonicalWorldArtRuntimeOverlay(left))
      .toEqual(await serializeCanonicalWorldArtRuntimeOverlay(right));
    expect(left.files.map(({ path }) => path)).toEqual(
      [...left.files.map(({ path }) => path)].sort((a, b) => a.localeCompare(b, 'en')),
    );
  });

  it('rejects stale identity, changed gates, file order, and unsafe rights', async () => {
    const manifest = await buildWorldArtRuntimeOverlay(draft());
    const cases = [
      (value: any) => { value.overlay_id = 'world-art-runtime-overlay-0000000000000000'; },
      (value: any) => { value.review.runtime = 'pass'; },
      (value: any) => { value.files.reverse(); },
      (value: any) => {
        value.rights = {
          distribution: 'public',
          license: 'LicenseRef-Proprietary',
        };
      },
      (value: any) => { value.reference_policy.embedded = true; },
    ];
    for (const change of cases) {
      const value = mutable(manifest);
      change(value);
      await expect(materializeWorldArtRuntimeOverlay(value)).rejects.toBeInstanceOf(Error);
    }
  });

  it('accepts proprietary assets for internal review without making them public', async () => {
    const value: WorldArtRuntimeOverlayDraft = {
      ...draft(),
      rights: {
        distribution: 'internal-review',
        license: 'LicenseRef-Proprietary',
      },
    };

    const manifest = await buildWorldArtRuntimeOverlay(value);

    expect(manifest.rights).toEqual(value.rights);
    expect(await materializeWorldArtRuntimeOverlay(manifest)).toEqual(manifest);
  });
});
