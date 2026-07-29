import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';

describe('reference image RGBA decoder', () => {
  it('round-trips deterministic PNG pixels without browser canvas APIs', async () => {
    const rgba = Uint8Array.from([
      10, 20, 30, 0,
      40, 50, 60, 255,
      70, 80, 90, 128,
      100, 110, 120, 255,
    ]);
    const decoded = await decodeReferenceImageRgba(encodeRgbaPng(2, 2, rgba), 'image/png');
    expect(decoded).toEqual({ width: 2, height: 2, rgba });
  });

  it('fails closed when a PNG has no decodable image data', async () => {
    const bytes = encodeRgbaPng(1, 1, Uint8Array.from([1, 2, 3, 255]));
    const corrupted = bytes.filter((_, index) => index < 33 || index >= bytes.length - 12);
    await expect(decodeReferenceImageRgba(corrupted, 'image/png')).rejects.toThrow();
  });
});
