import { describe, expect, it } from 'vitest';

import {
  EnvironmentArtSignatureError,
  environmentArtSeed,
  extractEnvironmentArtSignature,
  materializeEnvironmentArtSignature,
} from './environment-art-signature';

function scene(metadataPixel: number): { width: number; height: number; rgba: Uint8Array } {
  const width = 12;
  const height = 9;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const color = y < 4 ? [40, 90, 160] : [70, 135, 65];
      rgba.set([...color, 255], offset);
    }
  }
  // This value sits in a fully transparent pixel and must not influence art.
  rgba.set([metadataPixel, 255 - metadataPixel, metadataPixel, 0], 0);
  return { width, height, rgba };
}

describe('environment art signature', () => {
  it('extracts stable visible color/value/structure features', async () => {
    const first = await extractEnvironmentArtSignature(scene(1));
    const hiddenByteChange = await extractEnvironmentArtSignature(scene(250));
    expect(first).toEqual(hiddenByteChange);
    expect(first.palette).toEqual(expect.arrayContaining(['#285aa0', '#468741']));
    expect(first.vertical_luminance[0]).toBeLessThan(first.vertical_luminance[2]);
    expect(first.horizon_y).toBeGreaterThan(300);
    expect(first.horizon_y).toBeLessThan(700);
    expect(environmentArtSeed(first)).not.toContain(first.signature_sha256);
  });

  it('changes when visible art direction changes', async () => {
    const cool = await extractEnvironmentArtSignature(scene(1));
    const warmPixels = scene(1);
    for (let offset = 0; offset < warmPixels.rgba.length; offset += 4) {
      if (warmPixels.rgba[offset + 3] === 0) continue;
      warmPixels.rgba[offset] = 190;
      warmPixels.rgba[offset + 1] = 90;
      warmPixels.rgba[offset + 2] = 45;
    }
    const warm = await extractEnvironmentArtSignature(warmPixels);
    expect(cool.signature_sha256).not.toBe(warm.signature_sha256);
    expect(warm.temperature).toBe('warm');
  });

  it('materializes only an untampered bounded signature', async () => {
    const signature = await extractEnvironmentArtSignature(scene(1));
    await expect(materializeEnvironmentArtSignature(signature)).resolves.toEqual(signature);
    await expect(materializeEnvironmentArtSignature({ ...signature, horizon_y: 999 }))
      .rejects.toBeInstanceOf(EnvironmentArtSignatureError);
  });
});
