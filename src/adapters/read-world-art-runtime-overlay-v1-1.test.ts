import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  buildWorldArtRuntimeOverlayV1_1Zip,
} from './build-world-art-runtime-overlay-v1-1';
import {
  ReadWorldArtRuntimeOverlayV1_1Error,
  readWorldArtRuntimeOverlayV1_1Archive,
} from './read-world-art-runtime-overlay-v1-1';
import {
  OVERLAY_V1_1_PRIVATE_MARKER,
  buildWorldArtRuntimeOverlayV1_1TestFixture,
} from './world-art-runtime-overlay-v1-1.test-fixture';

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));

async function repack(
  bytes: Uint8Array,
  mutate: (archive: JSZip) => void | Promise<void>,
): Promise<Uint8Array> {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  await mutate(archive);
  return archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
}

describe('readWorldArtRuntimeOverlayV1_1Archive', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('reads and cross-binds one placement-aware %s overlay', async (profile) => {
    const input = await buildWorldArtRuntimeOverlayV1_1TestFixture(profile);
    const built = await buildWorldArtRuntimeOverlayV1_1Zip(input);
    const verified = await readWorldArtRuntimeOverlayV1_1Archive(
      built.readBytes(),
      input.layout_plan,
    );

    expect(verified.manifest).toEqual(built.manifest);
    expect(verified.projection).toEqual(input.projected.projection);
    expect(verified.placement_plan).toEqual(input.placement_plan);
    expect(verified.placement_map).toEqual(input.placement_map);
    expect(verified.runtime_bindings).toHaveLength(2);
    expect(verified.runtime_bindings.map(({ placement_id }) => placement_id))
      .toEqual(['tree-a', 'tree-b']);
    expect(new Set(
      verified.runtime_bindings.map(({ task_id, slot_id }) => `${task_id}/${slot_id}`),
    ).size).toBe(1);
    expect(verified.images).toHaveLength(1);
    expect(verified.images[0]!.readBytes()).toEqual(
      input.projected.images[0]!.readBytes(),
    );

    const archive = await JSZip.loadAsync(verified.bytes, { checkCRC32: true });
    const archivedText = await Promise.all(
      Object.values(archive.files).map((entry) => entry.async('string')),
    );
    expect(archivedText.join('\n')).not.toContain(OVERLAY_V1_1_PRIVATE_MARKER);
  });

  it('rejects an otherwise valid archive when the supplied layout is different', async () => {
    const input = await buildWorldArtRuntimeOverlayV1_1TestFixture('topdown-farm');
    const other = await buildWorldArtRuntimeOverlayV1_1TestFixture('isometric-action');
    const built = await buildWorldArtRuntimeOverlayV1_1Zip(input);

    await expect(readWorldArtRuntimeOverlayV1_1Archive(
      built.readBytes(),
      other.layout_plan,
    )).rejects.toMatchObject({
      code: 'world-art-runtime-overlay-1.1-read.binding',
    } satisfies Partial<ReadWorldArtRuntimeOverlayV1_1Error>);
  });

  it('rejects an added file and changed PNG bytes even with a valid ZIP CRC', async () => {
    const input = await buildWorldArtRuntimeOverlayV1_1TestFixture('side-platformer');
    const built = await buildWorldArtRuntimeOverlayV1_1Zip(input);
    const root = built.manifest.overlay_id;
    const imagePath = input.projected.images[0]!.path;
    const withExtra = await repack(built.readBytes(), (archive) => {
      archive.file(`${root}/unexpected.txt`, 'unexpected', {
        createFolders: false,
        date: ZIP_DATE,
      });
    });
    const changedImage = await repack(built.readBytes(), async (archive) => {
      const entry = archive.file(`${root}/${imagePath}`)!;
      const bytes = await entry.async('uint8array');
      bytes[bytes.length - 1] ^= 1;
      archive.file(`${root}/${imagePath}`, bytes, {
        binary: true,
        createFolders: false,
        date: ZIP_DATE,
      });
    });

    await expect(
      readWorldArtRuntimeOverlayV1_1Archive(withExtra, input.layout_plan),
    ).rejects.toMatchObject({
      code: 'world-art-runtime-overlay-1.1-read.inventory',
    } satisfies Partial<ReadWorldArtRuntimeOverlayV1_1Error>);
    await expect(
      readWorldArtRuntimeOverlayV1_1Archive(changedImage, input.layout_plan),
    ).rejects.toMatchObject({
      code: 'world-art-runtime-overlay-1.1-read.integrity',
    } satisfies Partial<ReadWorldArtRuntimeOverlayV1_1Error>);
  });

  it('rejects malformed ZIP bytes and a non-canonical manifest root', async () => {
    const input = await buildWorldArtRuntimeOverlayV1_1TestFixture('layered-depth-2d');
    const built = await buildWorldArtRuntimeOverlayV1_1Zip(input);
    const moved = await repack(built.readBytes(), async (archive) => {
      const root = built.manifest.overlay_id;
      const path = `${root}/world-art-runtime-overlay.json`;
      const bytes = await archive.file(path)!.async('uint8array');
      archive.remove(path);
      archive.file(`wrong-root/world-art-runtime-overlay.json`, bytes, {
        binary: true,
        createFolders: false,
        date: ZIP_DATE,
      });
    });

    await expect(
      readWorldArtRuntimeOverlayV1_1Archive(Uint8Array.of(1, 2, 3), input.layout_plan),
    ).rejects.toMatchObject({
      code: 'world-art-runtime-overlay-1.1-read.archive',
    } satisfies Partial<ReadWorldArtRuntimeOverlayV1_1Error>);
    await expect(
      readWorldArtRuntimeOverlayV1_1Archive(moved, input.layout_plan),
    ).rejects.toMatchObject({
      code: 'world-art-runtime-overlay-1.1-read.inventory',
    } satisfies Partial<ReadWorldArtRuntimeOverlayV1_1Error>);
  });
});
