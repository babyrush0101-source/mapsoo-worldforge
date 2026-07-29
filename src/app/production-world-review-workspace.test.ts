import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  buildProductionWorldReview,
  type ProductionWorldReviewSourceFile,
} from '../adapters/build-production-world-review';
import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import {
  writeProductionWorldReviewWorkspace,
} from './production-world-review-workspace';

function source(bytes: Uint8Array): ProductionWorldReviewSourceFile {
  const frozen = Uint8Array.from(bytes);
  return {
    bytes: frozen.byteLength,
    readBytes: () => Uint8Array.from(frozen),
  };
}

function png(red: number): Uint8Array {
  return encodeRgbaPng(1, 1, Uint8Array.from([red, 20, 30, 255]));
}

function mp4(brand: string): Uint8Array {
  return Uint8Array.from([
    0, 0, 0, 16,
    102, 116, 121, 112,
    ...new TextEncoder().encode(brand),
    0, 0, 0, 0,
  ]);
}

async function built() {
  return buildProductionWorldReview({
    reviewId: 'side-world-review-one',
    profile: 'side-platformer',
    godotVersions: ['4.3', '4.7'],
    worldPreview: source(png(10)),
    renderedWorldCapture: source(png(20)),
    rolePlacementOverlay: source(png(30)),
    artCollisionOverlay: source(png(40)),
    spawnExitTraversal: source(mp4('mp42')),
    navigationTraversal: source(mp4('isom')),
  });
}

describe('production world review workspace', () => {
  it('writes once, accepts byte-identical replay, and refuses overwrite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mapsoo-review-workspace-'));
    try {
      const value = await built();
      const first = await writeProductionWorldReviewWorkspace(value, root);
      const second = await writeProductionWorldReviewWorkspace(value, root);
      expect(first).toEqual(second);
      expect(first.files).toHaveLength(7);
      expect(JSON.parse(await readFile(first.reviewPath, 'utf8')))
        .toEqual(value.review);

      const capturePath = join(
        root,
        'review-evidence',
        'rendered-world-capture.png',
      );
      await writeFile(capturePath, Uint8Array.from([1, 2, 3]));
      await expect(writeProductionWorldReviewWorkspace(value, root))
        .rejects.toThrow('Refusing to overwrite different existing review evidence');
      expect(Uint8Array.from(await readFile(capturePath)))
        .toEqual(Uint8Array.from([1, 2, 3]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects empty and control-character output roots', async () => {
    const value = await built();
    await expect(writeProductionWorldReviewWorkspace(value, ''))
      .rejects.toThrow('output root');
    await expect(writeProductionWorldReviewWorkspace(value, 'bad\u0000root'))
      .rejects.toThrow('output root');
  });
});
