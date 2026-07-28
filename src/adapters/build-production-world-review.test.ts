import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import reviewSchema from '../../schemas/mapsoo-production-world-review-1.0.schema.json';
import { encodeRgbaPng } from './canvas/encode-png';
import {
  BuildProductionWorldReviewError,
  buildProductionWorldReview,
  type ProductionWorldReviewBuildInput,
  type ProductionWorldReviewSourceFile,
} from './build-production-world-review';

function source(bytes: Uint8Array): ProductionWorldReviewSourceFile {
  const frozen = Uint8Array.from(bytes);
  return {
    bytes: frozen.byteLength,
    readBytes: () => Uint8Array.from(frozen),
  };
}

function png(red: number): Uint8Array {
  return encodeRgbaPng(2, 2, Uint8Array.from([
    red, 20, 30, 255,
    red, 40, 50, 255,
    red, 60, 70, 255,
    red, 80, 90, 255,
  ]));
}

function mp4(brand: string): Uint8Array {
  const bytes = Uint8Array.from([
    0, 0, 0, 16,
    102, 116, 121, 112,
    ...new TextEncoder().encode(brand.padEnd(4, ' ').slice(0, 4)),
    0, 0, 0, 0,
  ]);
  return bytes;
}

function fixture(): ProductionWorldReviewBuildInput {
  return {
    reviewId: 'topdown-farm-review-one',
    profile: 'topdown-farm',
    godotVersions: ['4.3', '4.7'],
    worldPreview: source(png(10)),
    renderedWorldCapture: source(png(20)),
    rolePlacementOverlay: source(png(30)),
    artCollisionOverlay: source(png(40)),
    spawnExitTraversal: source(mp4('mp42')),
    navigationTraversal: source(mp4('isom')),
  };
}

describe('production world review builder', () => {
  it('builds one deterministic, schema-valid technical review with human pending', async () => {
    const left = await buildProductionWorldReview(fixture());
    const right = await buildProductionWorldReview(fixture());
    const validate = new Ajv2020({ strict: true, allErrors: true })
      .compile(reviewSchema);

    expect(validate(left.review), JSON.stringify(validate.errors)).toBe(true);
    expect(left.review).toEqual(right.review);
    expect(left.review.release_decision).toBe('blocked');
    expect(left.review.gates.at(-1)).toEqual({
      gate: 'human-review',
      status: 'pending',
      evidence_ids: [],
    });
    expect(left.review.gates.slice(0, -1).every(
      ({ status }) => status === 'technical-pass',
    )).toBe(true);
    expect(left.files.map(({ path }) => path)).toEqual([
      'review-evidence/world-preview.png',
      'review-evidence/rendered-world-capture.png',
      'review-evidence/role-placement-overlay.png',
      'review-evidence/art-collision-overlay.png',
      'review-evidence/spawn-exit-traversal.mp4',
      'review-evidence/navigation-traversal.mp4',
      'review/production-world-review.json',
    ]);
    expect(left.files.map(({ sha256 }) => sha256)).toEqual(
      right.files.map(({ sha256 }) => sha256),
    );
    expect(JSON.parse(new TextDecoder().decode(left.reviewFile.readBytes())))
      .toEqual(left.review);
  });

  it('copies exact bytes and does not embed local source paths or private metadata', async () => {
    const built = await buildProductionWorldReview(fixture());
    for (const file of built.files) {
      const first = file.readBytes();
      const second = file.readBytes();
      expect(first).toEqual(second);
      if (first.byteLength > 0) {
        first[0] ^= 1;
        expect(file.readBytes()).toEqual(second);
      }
    }
    const text = new TextDecoder().decode(built.reviewFile.readBytes());
    expect(text).not.toContain('C:\\');
    expect(text).not.toContain('provider_request_id');
    expect(text).not.toContain('raw_prompt');
    expect(text).not.toContain('character-reference');
  });

  it('rejects invalid PNG, fake MP4, unsafe identity, and changing source bytes', async () => {
    await expect(buildProductionWorldReview({
      ...fixture(),
      worldPreview: source(Uint8Array.from([1, 2, 3])),
    })).rejects.toBeInstanceOf(BuildProductionWorldReviewError);
    await expect(buildProductionWorldReview({
      ...fixture(),
      navigationTraversal: source(Uint8Array.from([
        0, 0, 0, 12, 98, 97, 100, 33, 0, 0, 0, 0,
      ])),
    })).rejects.toBeInstanceOf(BuildProductionWorldReviewError);
    await expect(buildProductionWorldReview({
      ...fixture(),
      reviewId: '../private-review',
    })).rejects.toBeInstanceOf(BuildProductionWorldReviewError);

    const admitted = png(50);
    await expect(buildProductionWorldReview({
      ...fixture(),
      rolePlacementOverlay: {
        bytes: admitted.byteLength,
        readBytes: () => admitted.slice(1),
      },
    })).rejects.toMatchObject({
      code: 'production-world-review-build.integrity',
    });
  });

  it('rejects duplicate or unsupported Godot version claims', async () => {
    await expect(buildProductionWorldReview({
      ...fixture(),
      godotVersions: ['4.3', '4.3'],
    })).rejects.toMatchObject({
      code: 'production-world-review-build.input',
    });
    await expect(buildProductionWorldReview({
      ...fixture(),
      godotVersions: ['4.3', '4.8'] as unknown as readonly ['4.3', '4.7'],
    })).rejects.toMatchObject({
      code: 'production-world-review-build.input',
    });
  });
});
