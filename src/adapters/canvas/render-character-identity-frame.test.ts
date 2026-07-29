import { describe, expect, it } from 'vitest';

import { extractCharacterIdentitySignature } from '../../core/character-identity-signature';
import {
  decodeCharacterIdentitySilhouette,
  renderCharacterIdentityFrame,
} from './render-character-identity-frame';

function characterPixels(accessory = true) {
  const width = 12;
  const height = 16;
  const rgba = new Uint8Array(width * height * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, color: readonly number[]) => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        rgba.set([...color, 255], (y * width + x) * 4);
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

function alphaBounds(pixels: Uint8Array, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function normalizeAlpha(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const bounds = alphaBounds(pixels, width, height);
  const output = new Uint8Array(16 * 16);
  const bodyWidth = bounds.maxX - bounds.minX + 1;
  const bodyHeight = bounds.maxY - bounds.minY + 1;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const x0 = bounds.minX + Math.floor(x * bodyWidth / 16);
      const x1 = bounds.minX + Math.max(0, Math.ceil((x + 1) * bodyWidth / 16) - 1);
      const y0 = bounds.minY + Math.floor(y * bodyHeight / 16);
      const y1 = bounds.minY + Math.max(0, Math.ceil((y + 1) * bodyHeight / 16) - 1);
      let visible = false;
      for (let sourceY = y0; sourceY <= y1 && !visible; sourceY += 1) {
        for (let sourceX = x0; sourceX <= x1; sourceX += 1) {
          if (pixels[(sourceY * width + sourceX) * 4 + 3] > 0) {
            visible = true;
            break;
          }
        }
      }
      output[y * 16 + x] = visible ? 1 : 0;
    }
  }
  return output;
}

function intersectionOverUnion(left: Uint8Array, right: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] || right[index]) union += 1;
    if (left[index] && right[index]) intersection += 1;
  }
  return intersection / union;
}

describe('character identity frame renderer', () => {
  it('projects one silhouette into all four profile geometries with aligned feet', async () => {
    const signature = await extractCharacterIdentitySignature(characterPixels());
    const sourceMask = decodeCharacterIdentitySilhouette(signature);
    const profiles = ['topdown-farm', 'side-platformer', 'isometric-action', 'layered-depth-2d'] as const;
    for (const profile of profiles) {
      const frame = renderCharacterIdentityFrame(signature, profile, {
        action: 'idle',
        direction: profile === 'topdown-farm' ? 'south' : 'right',
        frame: 0,
      });
      const bounds = alphaBounds(frame.pixels, frame.width, frame.height);
      expect(bounds.maxY).toBe(frame.projection.pivot[1]);
      expect(intersectionOverUnion(sourceMask, normalizeAlpha(frame.pixels, frame.width, frame.height)))
        .toBeGreaterThan(0.68);
      expect(frame.projection.source_signature_sha256).toBe(signature.signature_sha256);
    }
  });

  it('turns a distinctive source accessory into a different rendered silhouette', async () => {
    const withAccessory = await extractCharacterIdentitySignature(characterPixels(true));
    const withoutAccessory = await extractCharacterIdentitySignature(characterPixels(false));
    const render = (signature: Awaited<ReturnType<typeof extractCharacterIdentitySignature>>) =>
      renderCharacterIdentityFrame(signature, 'side-platformer', { action: 'idle', direction: 'right', frame: 0 });
    const first = render(withAccessory);
    const second = render(withoutAccessory);

    expect(first.pixels).not.toEqual(second.pixels);
    expect(intersectionOverUnion(
      normalizeAlpha(first.pixels, first.width, first.height),
      normalizeAlpha(second.pixels, second.width, second.height),
    )).toBeLessThan(0.98);
  });

  it('keeps the identity source stable while animation poses change only frame geometry', async () => {
    const signature = await extractCharacterIdentitySignature(characterPixels());
    const idle = renderCharacterIdentityFrame(signature, 'side-platformer', {
      action: 'idle', direction: 'right', frame: 0,
    });
    const run = renderCharacterIdentityFrame(signature, 'side-platformer', {
      action: 'run', direction: 'right', frame: 1,
    });
    expect(run.pixels).not.toEqual(idle.pixels);
    expect(run.projection.source_signature_sha256).toBe(idle.projection.source_signature_sha256);
    expect(run.projection.pivot).toEqual(idle.projection.pivot);
  });
});
