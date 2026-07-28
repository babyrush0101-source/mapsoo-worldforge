import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import {
  BuildWorldArtRuntimeOverlayError,
  buildWorldArtRuntimeOverlayZip,
} from './build-world-art-runtime-overlay';
import type {
  ProjectedReviewedWorldArtImage,
  ProjectedReviewedWorldArtVariants,
} from './project-reviewed-world-art-variants';
import type { WorldAssetProfile } from '../core/asset-profile';
import type { ProductionArtRights } from '../core/production-art-contract';
import { buildWorldArtRuntimeProjection } from '../core/world-art-runtime-projection';

const PRIVATE_MARKER = 'PRIVATE_DO_NOT_EXPORT';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function fixture(
  profile: WorldAssetProfile,
  rights: ProductionArtRights = {
    distribution: 'public',
    license: 'CC0-1.0',
  },
): Promise<ProjectedReviewedWorldArtVariants> {
  const png = encodeRgbaPng(2, 2, Uint8Array.from([
    80, 120, 180, 255,
    90, 130, 190, 255,
    100, 140, 200, 255,
    110, 150, 210, 255,
  ]));
  const pngSha = await sha256(png);
  const taskId = 'terrain-sheet-001';
  const slotId = 'requirement-001-canonical';
  const path = `production-art/${profile}/${taskId}.png`;
  const projection = await buildWorldArtRuntimeProjection({
    schema_version: '1.0.0',
    document_type: 'world-art-runtime-projection',
    profile,
    source: {
      variant_map_id: 'variant-map-fixture',
      variant_map_sha256: '1'.repeat(64),
      layout_plan_sha256: '2'.repeat(64),
      production_art_plan_id: 'production-art-fixture',
      production_art_plan_sha256: '3'.repeat(64),
      requirements_sha256: '4'.repeat(64),
      run_set_sha256: '5'.repeat(64),
      reviewed_slot_inventory_sha256: '6'.repeat(64),
      review_record_sha256: '7'.repeat(64),
    },
    rights,
    images: [{
      task_id: taskId,
      path,
      media_type: 'image/png',
      bytes: png.byteLength,
      sha256: pngSha,
      output_sha256: '8'.repeat(64),
      width: 2,
      height: 2,
      cell_size: [2, 2],
      pivot: [1, 2],
      alpha_policy: 'opaque',
    }],
    assets: [{
      task_id: taskId,
      slot_id: slotId,
      requirement_id: 'requirement-001',
      role: 'terrain.ground',
      variant_id: 'canonical',
      image_path: path,
      region: { x: 0, y: 0, width: 2, height: 2 },
      cell_sha256: '9'.repeat(64),
      poses: [],
    }],
    bindings: [{
      usage_kind: 'terrain-material',
      usage_id: 'ground',
      task_id: taskId,
      slot_id: slotId,
      role: 'terrain.ground',
      variant_id: 'canonical',
      image_path: path,
      region: { x: 0, y: 0, width: 2, height: 2 },
      cell_sha256: '9'.repeat(64),
      poses: [],
    }],
  });
  const snapshot = Uint8Array.from(png);
  const image: ProjectedReviewedWorldArtImage = Object.freeze({
    task_id: taskId,
    path,
    media_type: 'image/png',
    bytes: snapshot.byteLength,
    sha256: pngSha,
    readBytes: () => Uint8Array.from(snapshot),
  });
  return Object.freeze({
    projection,
    images: Object.freeze([image]),
  });
}

describe('buildWorldArtRuntimeOverlayZip', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('builds one deterministic CRC-valid overlay for %s', async (profile) => {
    const projected = await fixture(profile);
    const left = await buildWorldArtRuntimeOverlayZip(projected);
    const right = await buildWorldArtRuntimeOverlayZip(projected);

    expect(left.readBytes()).toEqual(right.readBytes());
    expect(left.bytes).toBe(left.readBytes().byteLength);
    expect(left.filename).toBe(`${left.manifest.overlay_id}.zip`);
    expect(left.manifest.profile).toBe(profile);
    expect(left.manifest.review).toEqual({
      human_art: 'pass',
      runtime: 'pending',
      raspberry_pi: 'pending',
    });
    expect(left.manifest.files).toHaveLength(projected.images.length + 1);
    expect(left.manifest.files.map(({ path }) => path)).toEqual(
      [...left.manifest.files.map(({ path }) => path)].sort((a, b) =>
        a.localeCompare(b, 'en')),
    );

    const archive = await JSZip.loadAsync(left.readBytes(), { checkCRC32: true });
    const names = Object.keys(archive.files);
    const root = left.manifest.overlay_id;
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(names).toHaveLength(left.manifest.files.length + 1);
    expect(names.every((name) => name.startsWith(`${root}/`))).toBe(true);
    expect(names.every((name) => !archive.files[name]!.dir)).toBe(true);
    expect(new Set(names.map((name) => name.split('/')[0]))).toEqual(new Set([root]));

    const manifestName = `${root}/world-art-runtime-overlay.json`;
    const archivedManifest = JSON.parse(await archive.file(manifestName)!.async('string'));
    expect(archivedManifest).toEqual(left.manifest);
    for (const record of left.manifest.files) {
      const entry = archive.file(`${root}/${record.path}`);
      expect(entry).not.toBeNull();
      const bytes = await entry!.async('uint8array');
      expect(bytes.byteLength).toBe(record.bytes);
      expect(await sha256(bytes)).toBe(record.sha256);
      expect(entry!.date.toISOString()).toBe('1980-01-01T00:00:00.000Z');
      expect(typeof entry!.unixPermissions).toBe('number');
      expect((entry!.unixPermissions as number) & 0o777).toBe(0o644);
    }
  });

  it('rejects missing, extra, changed-path, changed-SHA, and changed bytes', async () => {
    const projected = await fixture('topdown-farm');
    const original = projected.images[0]!;
    const cases: ProjectedReviewedWorldArtVariants[] = [
      { ...projected, images: [] },
      { ...projected, images: [original, original] },
      {
        ...projected,
        images: [{ ...original, path: 'production-art/topdown-farm/changed.png' }],
      },
      {
        ...projected,
        images: [{ ...original, sha256: '0'.repeat(64) }],
      },
      {
        ...projected,
        images: [{
          ...original,
          readBytes: () => {
            const bytes = original.readBytes();
            bytes[bytes.length - 1] ^= 1;
            return bytes;
          },
        }],
      },
    ];
    for (const value of cases) {
      await expect(buildWorldArtRuntimeOverlayZip(value)).rejects
        .toBeInstanceOf(BuildWorldArtRuntimeOverlayError);
    }
  });

  it('rejects projection tampering, unsafe rights, and private metadata fields', async () => {
    const projected = await fixture('side-platformer');
    const changedProjection = JSON.parse(JSON.stringify(projected.projection));
    changedProjection.source.layout_plan_sha256 = '0'.repeat(64);
    await expect(buildWorldArtRuntimeOverlayZip({
      ...projected,
      projection: changedProjection,
    })).rejects.toBeInstanceOf(BuildWorldArtRuntimeOverlayError);

    const unsafeRights = await fixture('side-platformer', {
      distribution: 'public',
      license: 'LicenseRef-Proprietary',
    });
    await expect(buildWorldArtRuntimeOverlayZip(unsafeRights))
      .rejects.toBeInstanceOf(BuildWorldArtRuntimeOverlayError);

    await expect(buildWorldArtRuntimeOverlayZip({
      ...projected,
      provider_request_id: PRIVATE_MARKER,
    } as unknown as ProjectedReviewedWorldArtVariants))
      .rejects.toBeInstanceOf(BuildWorldArtRuntimeOverlayError);

    const built = await buildWorldArtRuntimeOverlayZip(projected);
    const archive = await JSZip.loadAsync(built.readBytes(), { checkCRC32: true });
    const names = Object.keys(archive.files);
    const archiveText = [
      ...names,
      ...(await Promise.all(names
        .filter((name) => name.endsWith('.json'))
        .map((name) => archive.file(name)!.async('string')))),
    ].join('\n');
    for (const forbidden of [
      PRIVATE_MARKER,
      'provider_request_id',
      'raw_prompt_text',
      'private-input',
      'environment-reference',
      'character-reference',
    ]) {
      expect(archiveText.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(built.manifest.reference_policy).toEqual({
      embedded: false,
      original_references_excluded: true,
      raw_prompts_excluded: true,
      only_one_way_audit_hashes_retained: true,
    });
  });
});
