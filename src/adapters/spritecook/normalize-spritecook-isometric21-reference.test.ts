import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import reportSchema from '../../../schemas/mapsoo-production-art-geometry-reference-import-1.0.schema.json';
import { encodeRgbaPng } from '../canvas/encode-png';
import { decodeReferenceImageRgba } from '../decode-reference-image-rgba';
import {
  bindSpriteCookIsometric21GeometryReference,
  ISOMETRIC_TERRAIN_GEOMETRY_ROLES,
  normalizeSpriteCookIsometric21Reference,
  SpriteCookIsometric21ImportError,
} from './normalize-spritecook-isometric21-reference';

function insideDiamond(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  return Math.abs((x + 0.5 - width / 2) / (width / 2))
    + Math.abs((y + 0.5 - height / 2) / (height / 2)) <= 1;
}

function fixture(
  tileWidth: 32 | 64,
  columns: number,
  rows: number,
  transparent = false,
): Uint8Array {
  const tileHeight = tileWidth / 2;
  const width = columns * tileWidth + (columns - 1) * 2 + 4;
  const height = rows * tileHeight + (rows - 1) * 2 + 4;
  const rgba = new Uint8Array(width * height * 4);
  const background = transparent
    ? [0, 0, 0, 0]
    : [245, 246, 247, 255];
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set(background, offset);
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const startX = 2 + column * (tileWidth + 2);
      const startY = 2 + row * (tileHeight + 2);
      for (let y = 0; y < tileHeight; y += 1) {
        for (let x = 0; x < tileWidth; x += 1) {
          if (!insideDiamond(x, y, tileWidth, tileHeight)) continue;
          const pixel = ((startY + y) * width + startX + x) * 4;
          rgba.set([20 + index, 80 + index, 140 + index, 255], pixel);
        }
      }
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

async function cellHasPixels(
  rgba: Uint8Array,
  imageWidth: number,
  column: number,
  row: number,
): Promise<boolean> {
  for (let y = row * 48; y < (row + 1) * 48; y += 1) {
    for (let x = column * 96; x < (column + 1) * 96; x += 1) {
      if (rgba[(y * imageWidth + x) * 4 + 3] !== 0) return true;
    }
  }
  return false;
}

describe('SpriteCook 2:1 isometric geometry-reference adapter', () => {
  it.each([
    {
      tileWidth: 32 as const,
      columns: 3,
      rows: 5,
      transparent: false,
    },
    {
      tileWidth: 64 as const,
      columns: 2,
      rows: 4,
      transparent: true,
    },
  ])(
    'validates $tileWidth px $columns by $rows input and independently renders the canonical task guide',
    async ({ tileWidth, columns, rows, transparent }) => {
      const normalized = await normalizeSpriteCookIsometric21Reference(
        fixture(tileWidth, columns, rows, transparent),
      );
      expect(normalized.report.source).toMatchObject({
        tile_width: tileWidth,
        tile_height: tileWidth / 2,
        columns,
        rows,
        gap: 2,
        inset: 2,
        validated_cells: columns * rows,
        source_pixels_copied: false,
      });
      expect(normalized.report.output).toMatchObject({
        width: 768,
        height: 384,
        cell_width: 96,
        cell_height: 48,
        columns: 8,
        rows: 8,
        reference_role: 'environment-style',
        target_profile: 'isometric-action',
        target_task: 'terrain-sheet',
        license: 'CC0-1.0',
      });
      expect(normalized.report.target_mapping.map(({ role }) => role)).toEqual(
        ISOMETRIC_TERRAIN_GEOMETRY_ROLES,
      );
      const decoded = await decodeReferenceImageRgba(
        normalized.png.readBytes(),
        'image/png',
      );
      for (let index = 0; index < 64; index += 1) {
        expect(await cellHasPixels(
          decoded.rgba,
          decoded.width,
          index % 8,
          Math.floor(index / 8),
        )).toBe(index < 9);
      }
      expect([...decoded.rgba]).not.toContain(20);
      expect(normalized.report.runtime_asset).toBe(false);
      expect(normalized.report.human_review).toBe('required');
      const validate = new Ajv2020({ strict: true, allErrors: true })
        .compile(reportSchema);
      expect(validate(normalized.report), JSON.stringify(validate.errors)).toBe(true);
    },
  );

  it('is deterministic, snapshots bytes, and binds as an existing CC0 environment reference', async () => {
    const source = fixture(32, 3, 5);
    const first = await normalizeSpriteCookIsometric21Reference(source);
    source.fill(0);
    const second = await normalizeSpriteCookIsometric21Reference(
      fixture(32, 3, 5),
    );
    const mutableRead = first.png.readBytes();
    mutableRead.fill(0);

    expect(first.report).toEqual(second.report);
    expect(first.png.readBytes()).toEqual(second.png.readBytes());
    expect(first.report.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.report.output.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first.report)).not.toContain('C:');
    expect(JSON.stringify(first.report)).not.toContain('\\');

    const bound = await bindSpriteCookIsometric21GeometryReference(first);
    expect(bound.descriptor).toMatchObject({
      id: 'isometric-terrain-geometry-guide',
      role: 'environment-style',
      path: 'references/isometric-terrain-geometry-guide.png',
      mediaType: 'image/png',
      width: 768,
      height: 384,
      sha256: first.report.output.sha256,
      rights: {
        basis: 'owned',
        license: 'CC0-1.0',
        allowGenerativeAdaptation: true,
        allowOutputRedistribution: true,
        allowOutputCc0Dedication: true,
      },
    });
    expect(bound.readBytes()).toEqual(first.png.readBytes());
  });

  it('rejects top-down, 1024-upscale, malformed, nonuniform-gap, outside-diamond, and empty-cell input', async () => {
    const topdown = encodeRgbaPng(
      80,
      80,
      new Uint8Array(80 * 80 * 4),
    );
    const upscaled = encodeRgbaPng(
      1024,
      1024,
      new Uint8Array(1024 * 1024 * 4),
    );
    await expect(normalizeSpriteCookIsometric21Reference(topdown))
      .rejects.toMatchObject({
        code: 'spritecook-isometric-import.unsupported-layout',
      });
    await expect(normalizeSpriteCookIsometric21Reference(upscaled))
      .rejects.toMatchObject({
        code: 'spritecook-isometric-import.unsupported-layout',
      });
    await expect(normalizeSpriteCookIsometric21Reference(
      Uint8Array.from([1, 2, 3]),
    )).rejects.toBeInstanceOf(SpriteCookIsometric21ImportError);

    const decodedGap = await decodeReferenceImageRgba(
      fixture(32, 3, 5),
      'image/png',
    );
    decodedGap.rgba.set([1, 2, 3, 255], (1 * decodedGap.width + 40) * 4);
    await expect(normalizeSpriteCookIsometric21Reference(encodeRgbaPng(
      decodedGap.width,
      decodedGap.height,
      decodedGap.rgba,
    ))).rejects.toMatchObject({
      code: 'spritecook-isometric-import.invalid-grid',
    });

    const decodedOutside = await decodeReferenceImageRgba(
      fixture(32, 3, 5),
      'image/png',
    );
    decodedOutside.rgba.set([1, 2, 3, 255], (2 * decodedOutside.width + 2) * 4);
    await expect(normalizeSpriteCookIsometric21Reference(encodeRgbaPng(
      decodedOutside.width,
      decodedOutside.height,
      decodedOutside.rgba,
    ))).rejects.toMatchObject({
      code: 'spritecook-isometric-import.invalid-grid',
    });

    const decodedEmpty = await decodeReferenceImageRgba(
      fixture(32, 1, 1),
      'image/png',
    );
    decodedEmpty.rgba.fill(0);
    await expect(normalizeSpriteCookIsometric21Reference(encodeRgbaPng(
      decodedEmpty.width,
      decodedEmpty.height,
      decodedEmpty.rgba,
    ))).rejects.toMatchObject({
      code: 'spritecook-isometric-import.invalid-grid',
    });
  });
});
