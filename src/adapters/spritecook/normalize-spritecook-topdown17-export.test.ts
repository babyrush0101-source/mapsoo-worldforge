import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import reportSchema from '../../../schemas/mapsoo-terrain-autotile-authoring-import-1.0.schema.json';
import { encodeRgbaPng } from '../canvas/encode-png';
import { decodeReferenceImageRgba } from '../decode-reference-image-rgba';
import {
  normalizeSpriteCookTopdown17Export,
  SpriteCookTopdown17ImportError,
} from './normalize-spritecook-topdown17-export';

const SOURCE_CELL_BY_MASK = Object.freeze([
  [0, 4], [0, 3], [1, 4], [1, 3],
  [0, 1], [0, 2], [1, 1], [1, 2],
  [3, 4], [3, 3], [2, 4], [2, 3],
  [3, 1], [3, 2], [2, 1], [2, 2],
] as const);

function fixture(tileSize: 16 | 32 | 64, grid: boolean): Uint8Array {
  const inset = grid ? 1 : 0;
  const stride = tileSize + (grid ? 1 : 0);
  const size = grid ? tileSize * 5 + 6 : tileSize * 5;
  const rgba = new Uint8Array(size * size * 4);
  if (grid) {
    for (let offset = 0; offset < rgba.byteLength; offset += 4) {
      rgba.set([7, 8, 9, 255], offset);
    }
  }
  SOURCE_CELL_BY_MASK.forEach(([column, row], mask) => {
    for (let y = 0; y < tileSize; y += 1) {
      for (let x = 0; x < tileSize; x += 1) {
        const pixel = (
          ((inset + row * stride + y) * size)
          + inset + column * stride + x
        ) * 4;
        rgba.set([mask + 1, 100 + mask, 200 - mask, 255], pixel);
      }
    }
  });
  return encodeRgbaPng(size, size, rgba);
}

async function outputCellColors(bytes: Uint8Array, cellSize: number) {
  const decoded = await decodeReferenceImageRgba(bytes, 'image/png');
  return Array.from({ length: 16 }, (_, mask) => {
    const x = (mask % 4) * cellSize + Math.floor(cellSize / 2);
    const y = Math.floor(mask / 4) * cellSize + Math.floor(cellSize / 2);
    const offset = (y * decoded.width + x) * 4;
    return [...decoded.rgba.subarray(offset, offset + 4)];
  });
}

describe('SpriteCook top-down 17-piece local export adapter', () => {
  it.each([
    { tileSize: 16 as const, grid: false },
    { tileSize: 16 as const, grid: true },
    { tileSize: 32 as const, grid: false },
    { tileSize: 64 as const, grid: true },
  ])(
    'reorders a native $tileSize px grid=$grid guide into masks 0-15',
    async ({ tileSize, grid }) => {
      const normalized = await normalizeSpriteCookTopdown17Export(
        fixture(tileSize, grid),
        { targetCellSize: 32 },
      );
      expect(normalized.report.source).toMatchObject({
        tile_size: tileSize,
        grid: grid ? 'one-pixel' : 'none',
      });
      expect(normalized.report.output).toMatchObject({
        convention: 'worldforge-edge-mask-16',
        bit_order: ['north', 'east', 'south', 'west'],
        width: 128,
        height: 128,
        cell_width: 32,
        cell_height: 32,
      });
      expect(normalized.report.mapping).toHaveLength(16);
      expect(normalized.report.mapping.map(({ mask }) => mask)).toEqual(
        Array.from({ length: 16 }, (_, mask) => mask),
      );
      expect(await outputCellColors(normalized.png.readBytes(), 32)).toEqual(
        Array.from(
          { length: 16 },
          (_, mask) => [mask + 1, 100 + mask, 200 - mask, 255],
        ),
      );
      expect(normalized.report.human_review).toBe('required');
      expect(normalized.report.public_release).toBe('not-authorized');
      const validate = new Ajv2020({ strict: true, allErrors: true })
        .compile(reportSchema);
      expect(validate(normalized.report), JSON.stringify(validate.errors)).toBe(true);
    },
  );

  it('is byte-reproducible and snapshots both source and output bytes', async () => {
    const source = fixture(16, true);
    const first = await normalizeSpriteCookTopdown17Export(source);
    source.fill(0);
    const second = await normalizeSpriteCookTopdown17Export(fixture(16, true));
    const firstRead = first.png.readBytes();
    firstRead.fill(0);

    expect(first.report).toEqual(second.report);
    expect(first.png.readBytes()).toEqual(second.png.readBytes());
    expect(first.report.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.report.output.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first.report)).not.toContain('\\');
    expect(JSON.stringify(first.report)).not.toContain('C:');
  });

  it('rejects corner-mask 15-piece, 1024-upscale, malformed PNG, and unknown targets', async () => {
    const cornerMask = encodeRgbaPng(64, 64, new Uint8Array(64 * 64 * 4));
    const upscaled = encodeRgbaPng(1024, 1024, new Uint8Array(1024 * 1024 * 4));

    await expect(normalizeSpriteCookTopdown17Export(cornerMask)).rejects.toMatchObject({
      code: 'spritecook-import.unsupported-layout',
    });
    await expect(normalizeSpriteCookTopdown17Export(upscaled)).rejects.toMatchObject({
      code: 'spritecook-import.unsupported-layout',
    });
    await expect(normalizeSpriteCookTopdown17Export(Uint8Array.from([1, 2, 3])))
      .rejects.toBeInstanceOf(SpriteCookTopdown17ImportError);
    await expect(normalizeSpriteCookTopdown17Export(fixture(16, false), {
      targetCellSize: 48 as 16,
    })).rejects.toMatchObject({
      code: 'spritecook-import.invalid-target',
    });
  });
});
