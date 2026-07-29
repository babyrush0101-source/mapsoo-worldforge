import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json';
import { CURRENT_PACK_VERSION } from '../adapters/export-current-pack';
import {
  CURRENT_PUBLIC_RELEASE,
  CURRENT_PUBLIC_RELEASE_VERSION,
} from './current-public-release';

describe('current public release links', () => {
  it('advances the public ledger to Alpha.9 while preserving Alpha.7 compatibility packs', () => {
    expect(packageJson.version).toBe('0.1.0-alpha.9');
    expect(CURRENT_PACK_VERSION).toBe('0.1.0-alpha.7');
    expect(CURRENT_PUBLIC_RELEASE_VERSION).toBe('0.1.0-alpha.9');
    expect(CURRENT_PUBLIC_RELEASE.version).toBe(CURRENT_PUBLIC_RELEASE_VERSION);
    expect(CURRENT_PUBLIC_RELEASE.tag).toBe(`v${CURRENT_PUBLIC_RELEASE_VERSION}`);
    expect(CURRENT_PUBLIC_RELEASE.releaseUrl).toContain('/releases/tag/v0.1.0-alpha.9');
    expect(CURRENT_PUBLIC_RELEASE.assetPack.filename).toContain('v0.1.0-alpha.7');
    expect(CURRENT_PUBLIC_RELEASE.godotImporter.filename).toContain('v0.1.0-alpha.9');
  });

  it('uses only the official HTTPS repository for downloads and community links', () => {
    const urls = [
      CURRENT_PUBLIC_RELEASE.releaseUrl,
      CURRENT_PUBLIC_RELEASE.assetPack.url,
      ...CURRENT_PUBLIC_RELEASE.assetPacks.map((pack) => pack.url),
      CURRENT_PUBLIC_RELEASE.godotImporter.url,
      CURRENT_PUBLIC_RELEASE.completeFarmPack.url,
      CURRENT_PUBLIC_RELEASE.firstImportGuideUrl,
      CURRENT_PUBLIC_RELEASE.feedbackFormUrl,
      CURRENT_PUBLIC_RELEASE.feedbackIndexUrl,
    ];

    for (const url of urls) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.hostname).toBe('github.com');
      expect(parsed.pathname).toContain('/babyrush0101-source/mapsoo-worldforge/');
    }
  });

  it('pins three Alpha.7 compatibility packs plus the Alpha.9 importer and complete farm pack', () => {
    expect(CURRENT_PUBLIC_RELEASE.assetPack).toEqual({
      id: 'sunny-meadow',
      filename: 'mapsoo-sunny-meadow-v0.1.0-alpha.7.zip',
      url: 'https://github.com/babyrush0101-source/mapsoo-worldforge/releases/download/v0.1.0-alpha.9/mapsoo-sunny-meadow-v0.1.0-alpha.7.zip',
      sha256: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
    });
    expect(CURRENT_PUBLIC_RELEASE.assetPacks.map(({ id, sha256 }) => [id, sha256])).toEqual([
      ['sunny-meadow', '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c'],
      ['dustwind-outpost', 'd6dd38a47522f45d24184d9b6869d92b89cc2ae3ad1c2ca1eab0b9cf4b13a502'],
      ['frostwatch-vale', '35a49edd901becae1422731a132803eebaf07659fc3d69efa7d39cd1e87b9e12'],
    ]);
    expect(CURRENT_PUBLIC_RELEASE.godotImporter).toEqual({
      filename: 'mapsoo-godot-importer-v0.1.0-alpha.9.zip',
      url: 'https://github.com/babyrush0101-source/mapsoo-worldforge/releases/download/v0.1.0-alpha.9/mapsoo-godot-importer-v0.1.0-alpha.9.zip',
      sha256: 'bfb736d044818b01955feb35d84b438fe6c139e77764907847a1f4d89ea7b526',
    });
    expect(CURRENT_PUBLIC_RELEASE.completeFarmPack).toEqual({
      filename: 'mapsoo-alpha9-godot-smoke-v0.1.0-alpha.9.zip',
      url: 'https://github.com/babyrush0101-source/mapsoo-worldforge/releases/download/v0.1.0-alpha.9/mapsoo-alpha9-godot-smoke-v0.1.0-alpha.9.zip',
      sha256: '10d89c7888b70215a14af2b6552fc5237d799df9cd3092aee99541961d9e480c',
    });
  });

  it('keeps the public release record immutable at runtime', () => {
    expect(Object.isFrozen(CURRENT_PUBLIC_RELEASE)).toBe(true);
    expect(Object.isFrozen(CURRENT_PUBLIC_RELEASE.assetPack)).toBe(true);
    expect(Object.isFrozen(CURRENT_PUBLIC_RELEASE.assetPacks)).toBe(true);
    expect(CURRENT_PUBLIC_RELEASE.assetPacks.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(CURRENT_PUBLIC_RELEASE.godotImporter)).toBe(true);
    expect(Object.isFrozen(CURRENT_PUBLIC_RELEASE.completeFarmPack)).toBe(true);
  });
});
