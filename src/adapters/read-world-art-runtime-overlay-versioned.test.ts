import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { buildWorldArtRuntimeOverlayZip } from './build-world-art-runtime-overlay';
import { buildWorldArtRuntimeOverlayV1_1Zip } from './build-world-art-runtime-overlay-v1-1';
import {
  ReadVersionedWorldArtRuntimeOverlayError,
  readVersionedWorldArtRuntimeOverlayArchive,
} from './read-world-art-runtime-overlay-versioned';
import {
  buildWorldArtRuntimeOverlayV1_1TestFixture,
} from './world-art-runtime-overlay-v1-1.test-fixture';

describe('readVersionedWorldArtRuntimeOverlayArchive', () => {
  it('keeps strict 1.0 archives readable without a layout argument', async () => {
    const fixture = await buildWorldArtRuntimeOverlayV1_1TestFixture(
      'side-platformer',
    );
    const built = await buildWorldArtRuntimeOverlayZip(fixture.projected);
    const verified = await readVersionedWorldArtRuntimeOverlayArchive(
      built.readBytes(),
    );
    expect(verified.manifest.schema_version).toBe('1.0.0');
    expect('runtime_bindings' in verified).toBe(false);
  });

  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('dispatches 1.1 with an exact trusted %s layout', async (profile) => {
    const fixture = await buildWorldArtRuntimeOverlayV1_1TestFixture(profile);
    const built = await buildWorldArtRuntimeOverlayV1_1Zip(fixture);
    const verified = await readVersionedWorldArtRuntimeOverlayArchive(
      built.readBytes(),
      { layout_plan: fixture.layout_plan },
    );

    expect(verified.manifest.schema_version).toBe('1.1.0');
    expect(verified.manifest.profile).toBe(profile);
    expect('runtime_bindings' in verified).toBe(true);
  });

  it('fails closed when 1.1 has no trusted layout', async () => {
    const fixture = await buildWorldArtRuntimeOverlayV1_1TestFixture('topdown-farm');
    const built = await buildWorldArtRuntimeOverlayV1_1Zip(fixture);
    await expect(readVersionedWorldArtRuntimeOverlayArchive(
      built.readBytes(),
    )).rejects.toMatchObject({
      code: 'world-art-runtime-overlay-versioned.layout-required',
    } satisfies Partial<ReadVersionedWorldArtRuntimeOverlayError>);
  });

  it('rejects an unsupported schema version before selecting a reader', async () => {
    const archive = new JSZip();
    archive.file(
      'overlay/world-art-runtime-overlay.json',
      '{"schema_version":"9.9.9"}\n',
      { createFolders: false },
    );
    const bytes = await archive.generateAsync({ type: 'uint8array' });
    await expect(readVersionedWorldArtRuntimeOverlayArchive(bytes))
      .rejects.toMatchObject({
        code: 'world-art-runtime-overlay-versioned.unsupported-version',
      } satisfies Partial<ReadVersionedWorldArtRuntimeOverlayError>);
  });
});
