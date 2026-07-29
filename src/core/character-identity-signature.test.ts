import { describe, expect, it } from 'vitest';

import {
  extractCharacterIdentitySignature,
  projectCharacterIdentity,
} from './character-identity-signature';

function characterPixels(accessory = true, transparentRgb = 0) {
  const width = 12;
  const height = 16;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba[offset] = transparentRgb;
    rgba[offset + 1] = transparentRgb;
    rgba[offset + 2] = transparentRgb;
  }
  const fill = (x0: number, y0: number, x1: number, y1: number, color: readonly number[]) => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const offset = (y * width + x) * 4;
        rgba.set([...color, 255], offset);
      }
    }
  };
  fill(4, 1, 7, 4, [232, 184, 136]);
  fill(3, 5, 8, 11, [64, 112, 208]);
  fill(3, 12, 4, 15, [32, 40, 56]);
  fill(7, 12, 8, 15, [32, 40, 56]);
  if (accessory) fill(8, 6, 10, 8, [232, 72, 88]);
  return { width, height, rgba };
}

describe('character identity signature', () => {
  it('derives a deterministic public-safe visual signature only from decoded character pixels', async () => {
    const first = await extractCharacterIdentitySignature(characterPixels(true, 0));
    const sameVisiblePixels = await extractCharacterIdentitySignature(characterPixels(true, 255));

    expect(sameVisiblePixels).toEqual(first);
    expect(first.silhouette_hex).toMatch(/^[a-f0-9]{64}$/);
    expect(first.signature_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.values(first.palette)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^#[a-f0-9]{6}$/),
    ]));
    expect(first.anchors.foot[1]).toBe(1000);
  });

  it('changes when a distinctive silhouette feature changes', async () => {
    const withAccessory = await extractCharacterIdentitySignature(characterPixels(true));
    const withoutAccessory = await extractCharacterIdentitySignature(characterPixels(false));

    expect(withAccessory.silhouette_hex).not.toBe(withoutAccessory.silhouette_hex);
    expect(withAccessory.signature_sha256).not.toBe(withoutAccessory.signature_sha256);
    expect(withAccessory.anchors.right).not.toEqual(withoutAccessory.anchors.right);
  });

  it('projects one identity into all four profile geometries without changing its source identity', async () => {
    const signature = await extractCharacterIdentitySignature(characterPixels());
    const profiles = ['topdown-farm', 'side-platformer', 'isometric-action', 'layered-depth-2d'] as const;
    const projections = profiles.map((profile) => projectCharacterIdentity(signature, profile));

    expect(projections.map(({ source_signature_sha256 }) => source_signature_sha256))
      .toEqual(Array(4).fill(signature.signature_sha256));
    expect(projections.map(({ frame_size }) => frame_size)).toEqual([
      [32, 32],
      [32, 64],
      [48, 64],
      [48, 72],
    ]);
    expect(new Set(projections.map(({ pivot }) => pivot.join(','))).size).toBe(4);
  });
});
