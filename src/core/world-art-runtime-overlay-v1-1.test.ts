import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-world-art-runtime-overlay-1.1.schema.json';
import {
  buildWorldArtRuntimeOverlayV1_1,
  fingerprintWorldArtRuntimeOverlayV1_1,
  materializeWorldArtRuntimeOverlayV1_1,
  serializeCanonicalWorldArtRuntimeOverlayV1_1,
  WorldArtRuntimeOverlayV1_1Error,
  type WorldArtRuntimeOverlayV1_1Draft,
} from './world-art-runtime-overlay-v1-1';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);
const E = 'e'.repeat(64);
const F = 'f'.repeat(64);
const ZERO = '0'.repeat(64);

function draft(): WorldArtRuntimeOverlayV1_1Draft {
  return {
    schema_version: '1.1.0',
    document_type: 'world-art-runtime-overlay',
    profile: 'layered-depth-2d',
    source: {
      projection_id: 'world-art-runtime-projection-0123456789abcdef',
      projection_sha256: A,
      layout_plan_id: 'layout-0123456789abcdef',
      layout_plan_sha256: B,
      placement_plan_id: 'world-visual-placement-plan-0123456789abcdef',
      placement_plan_sha256: C,
      placement_map_id: 'world-art-placement-map-0123456789abcdef',
      placement_map_sha256: D,
      review_record_sha256: E,
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
      sha256: F,
    },
    visual_placement: {
      plan_path: 'world-visual-placement-plan.json',
      plan_sha256: ZERO,
      map_path: 'world-art-placement-map.json',
      map_sha256: A,
    },
    files: [
      {
        path: 'assets/world.png',
        media_type: 'image/png',
        bytes: 1024,
        sha256: B,
      },
      {
        path: 'world-art-placement-map.json',
        media_type: 'application/json',
        bytes: 800,
        sha256: A,
      },
      {
        path: 'world-art-runtime-projection.json',
        media_type: 'application/json',
        bytes: 1200,
        sha256: F,
      },
      {
        path: 'world-visual-placement-plan.json',
        media_type: 'application/json',
        bytes: 900,
        sha256: ZERO,
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

describe('WorldArtRuntimeOverlay 1.1', () => {
  it('builds a canonical source-bound manifest with placement sidecars', async () => {
    const manifest = await buildWorldArtRuntimeOverlayV1_1(draft());
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.overlay_id).toMatch(/^world-art-runtime-overlay-[a-f0-9]{16}$/);
    expect(manifest.visual_placement).toEqual(draft().visual_placement);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.files)).toBe(true);
    await expect(materializeWorldArtRuntimeOverlayV1_1(manifest)).resolves.toEqual(manifest);
  });

  it('serializes stable canonical bytes and fingerprints the full manifest', async () => {
    const manifest = await buildWorldArtRuntimeOverlayV1_1(draft());
    const first = await serializeCanonicalWorldArtRuntimeOverlayV1_1(manifest);
    const second = await serializeCanonicalWorldArtRuntimeOverlayV1_1(manifest);

    expect(first).toEqual(second);
    expect(first.at(-1)).toBe(10);
    expect(new TextDecoder().decode(first)).not.toContain('\r\n');
    expect(await fingerprintWorldArtRuntimeOverlayV1_1(manifest)).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('rejects unknown fields, wrong versions, unsorted files, and invalid rights', async () => {
    const manifest = await buildWorldArtRuntimeOverlayV1_1(draft());
    const cases = [
      Object.assign(mutable(manifest), { private_prompt: 'do-not-package' }),
      Object.assign(mutable(manifest), { schema_version: '1.0.0' }),
      Object.assign(mutable(manifest), {
        files: [...mutable(manifest).files].reverse(),
      }),
      Object.assign(mutable(manifest), {
        rights: { distribution: 'public', license: 'LicenseRef-Proprietary' },
      }),
    ];

    for (const candidate of cases) {
      await expect(
        materializeWorldArtRuntimeOverlayV1_1(candidate),
      ).rejects.toBeInstanceOf(WorldArtRuntimeOverlayV1_1Error);
    }
  });

  it('rejects placement document file mismatches and identity tampering', async () => {
    const manifest = await buildWorldArtRuntimeOverlayV1_1(draft());
    const wrongPlan = mutable(manifest);
    wrongPlan.visual_placement.plan_sha256 = D;
    const wrongMapPath = mutable(manifest);
    wrongMapPath.visual_placement.map_path = 'assets/world.png';
    const wrongId = mutable(manifest);
    wrongId.overlay_id = 'world-art-runtime-overlay-ffffffffffffffff';

    for (const candidate of [wrongPlan, wrongMapPath, wrongId]) {
      await expect(
        materializeWorldArtRuntimeOverlayV1_1(candidate),
      ).rejects.toBeInstanceOf(WorldArtRuntimeOverlayV1_1Error);
    }
  });
});
