import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import type {
  ReferenceImageDescriptor,
} from '../../core/reference-image';
import {
  createPrivateSpriteCookReferenceCache,
} from './private-spritecook-reference-cache';

const roots: string[] = [];

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-spritecook-cache-'));
  roots.push(root);
  return root;
}

function descriptor(
  overrides: Partial<ReferenceImageDescriptor> = {},
): ReferenceImageDescriptor {
  return {
    id: 'character-reference',
    role: 'character',
    path: 'references/character-reference.png',
    mediaType: 'image/png',
    byteLength: 1_024,
    width: 64,
    height: 64,
    sha256: 'a'.repeat(64),
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, {
      recursive: true,
      force: true,
    })),
  );
});

describe('private SpriteCook reference cache', () => {
  it('reuses exact bytes without persisting credentials, paths, ids, or raw digests', async () => {
    const root = await privateRoot();
    const cache = createPrivateSpriteCookReferenceCache({
      rootDirectory: root,
      credential: 'sc_private_account_alpha',
    });
    const importer = vi.fn(async () => 'asset-character-alpha');

    await expect(cache.resolve(descriptor(), importer)).resolves.toEqual({
      assetId: 'asset-character-alpha',
      source: 'import',
    });
    await expect(cache.resolve(descriptor({
      id: 'renamed-reference',
      path: 'references/renamed-reference.png',
    }), importer)).resolves.toEqual({
      assetId: 'asset-character-alpha',
      source: 'cache',
    });
    expect(importer).toHaveBeenCalledTimes(1);

    const files = await readdir(root);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    const stored = await readFile(resolve(root, files[0]), 'utf8');
    expect(stored).toContain('asset-character-alpha');
    expect(stored).not.toContain('sc_private_account_alpha');
    expect(stored).not.toContain('character-reference');
    expect(stored).not.toContain('renamed-reference');
    expect(stored).not.toContain('references/');
    expect(stored).not.toContain('a'.repeat(64));
  });

  it('never reuses one account credential cache entry for another account', async () => {
    const root = await privateRoot();
    const first = createPrivateSpriteCookReferenceCache({
      rootDirectory: root,
      credential: 'sc_private_account_alpha',
    });
    const second = createPrivateSpriteCookReferenceCache({
      rootDirectory: root,
      credential: 'sc_private_account_beta',
    });
    await first.resolve(
      descriptor(),
      async () => 'asset-character-alpha',
    );
    const secondImporter = vi.fn(async () => 'asset-character-beta');

    await expect(second.resolve(
      descriptor(),
      secondImporter,
    )).resolves.toEqual({
      assetId: 'asset-character-beta',
      source: 'import',
    });
    expect(secondImporter).toHaveBeenCalledTimes(1);
    expect(await readdir(root)).toHaveLength(2);
  });

  it('serializes concurrent imports for the same account and exact bytes', async () => {
    const root = await privateRoot();
    const first = createPrivateSpriteCookReferenceCache({
      rootDirectory: root,
      credential: 'sc_private_account_alpha',
    });
    const second = createPrivateSpriteCookReferenceCache({
      rootDirectory: root,
      credential: 'sc_private_account_alpha',
    });
    const importer = vi.fn(async () => {
      await new Promise((accept) => {
        setTimeout(accept, 150);
      });
      return 'asset-concurrent-one';
    });

    const results = await Promise.all([
      first.resolve(descriptor(), importer),
      second.resolve(descriptor(), importer),
    ]);

    expect(importer).toHaveBeenCalledTimes(1);
    expect(results).toEqual(expect.arrayContaining([
      { assetId: 'asset-concurrent-one', source: 'import' },
      { assetId: 'asset-concurrent-one', source: 'cache' },
    ]));
    expect((await readdir(root)).some((file) => file.endsWith('.lock')))
      .toBe(false);
  });

  it('fails closed on a modified cache entry without calling the importer', async () => {
    const root = await privateRoot();
    const cache = createPrivateSpriteCookReferenceCache({
      rootDirectory: root,
      credential: 'sc_private_account_alpha',
    });
    await cache.resolve(descriptor(), async () => 'asset-safe-one');
    const [entryName] = await readdir(root);
    const path = resolve(root, entryName);
    const value = JSON.parse(await readFile(path, 'utf8'));
    value.unexpected = 'field';
    await writeFile(path, JSON.stringify(value), 'utf8');
    const importer = vi.fn(async () => 'asset-should-not-run');

    await expect(cache.resolve(descriptor(), importer))
      .rejects.toThrow('exact contract');
    expect(importer).not.toHaveBeenCalled();
  });

  it('releases its owned lock after an import failure and does not cache a result', async () => {
    const root = await privateRoot();
    const cache = createPrivateSpriteCookReferenceCache({
      rootDirectory: root,
      credential: 'sc_private_account_alpha',
    });
    await expect(cache.resolve(descriptor(), async () => {
      throw new Error('simulated import interruption');
    })).rejects.toThrow('simulated import interruption');
    expect(await readdir(root)).toHaveLength(0);

    await expect(cache.resolve(
      descriptor(),
      async () => 'asset-after-retry',
    )).resolves.toEqual({
      assetId: 'asset-after-retry',
      source: 'import',
    });
  });
});
