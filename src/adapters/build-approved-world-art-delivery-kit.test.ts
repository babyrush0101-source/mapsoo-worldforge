import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import deliverySchema from '../../schemas/mapsoo-world-art-delivery-kit-1.0.schema.json';
import {
  buildApprovedWorldArtDeliveryKit,
  type WorldArtDeliveryReviewFile,
} from './build-approved-world-art-delivery-kit';
import { buildWorldArtRuntimeOverlayZip } from './build-world-art-runtime-overlay';
import { encodeRgbaPng } from './canvas/encode-png';
import type {
  ProjectedReviewedWorldArtImage,
  ProjectedReviewedWorldArtVariants,
} from './project-reviewed-world-art-variants';
import {
  HUMAN_ART_REVIEW_CRITERIA,
  createHumanArtReviewTemplate,
  encodeHumanArtReviewReceipt,
  promoteProductionWorldReview,
  type HumanArtReviewReceipt,
} from '../core/human-art-review-receipt';
import {
  PRODUCTION_WORLD_REVIEW_VERSION,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from '../core/production-world-review-contract';
import type { ProductionArtRights } from '../core/production-art-contract';
import { buildWorldArtRuntimeProjection } from '../core/world-art-runtime-projection';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function overlayFixture(rights: ProductionArtRights) {
  const png = encodeRgbaPng(2, 2, Uint8Array.from([
    80, 120, 180, 255,
    90, 130, 190, 255,
    100, 140, 200, 255,
    110, 150, 210, 255,
  ]));
  const pngSha = await sha256(png);
  const taskId = 'terrain-sheet-001';
  const slotId = 'requirement-001-canonical';
  const path = `production-art/topdown-farm/${taskId}.png`;
  const projection = await buildWorldArtRuntimeProjection({
    schema_version: '1.0.0',
    document_type: 'world-art-runtime-projection',
    profile: 'topdown-farm',
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
    hazards: [],
  });
  const image: ProjectedReviewedWorldArtImage = Object.freeze({
    task_id: taskId,
    path,
    media_type: 'image/png',
    bytes: png.byteLength,
    sha256: pngSha,
    readBytes: () => Uint8Array.from(png),
  });
  const projected: ProjectedReviewedWorldArtVariants = Object.freeze({
    projection,
    images: Object.freeze([image]),
  });
  return buildWorldArtRuntimeOverlayZip(projected);
}

async function reviewFile(
  path: string,
  mediaType: WorldArtDeliveryReviewFile['media_type'],
  bytes: Uint8Array,
  dimensions?: Readonly<{ width: number; height: number }>,
): Promise<WorldArtDeliveryReviewFile> {
  const snapshot = Uint8Array.from(bytes);
  return Object.freeze({
    path,
    media_type: mediaType,
    bytes: snapshot.byteLength,
    sha256: await sha256(snapshot),
    ...(dimensions ?? {}),
    readBytes: () => Uint8Array.from(snapshot),
  });
}

async function approvedFixture(
  distribution: 'private' | 'public',
) {
  const overlay = await overlayFixture(distribution === 'private'
    ? { distribution: 'private', license: 'LicenseRef-Proprietary' }
    : { distribution: 'public', license: 'CC0-1.0' });
  const png = encodeRgbaPng(2, 2, Uint8Array.from([
    10, 20, 30, 255,
    40, 50, 60, 255,
    70, 80, 90, 255,
    100, 110, 120, 255,
  ]));
  const secondPng = encodeRgbaPng(2, 2, Uint8Array.from([
    120, 110, 100, 255,
    90, 80, 70, 255,
    60, 50, 40, 255,
    30, 20, 10, 255,
  ]));
  const videoA = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
  const videoB = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const files = await Promise.all([
    reviewFile('review-evidence/world-preview.png', 'image/png', png, {
      width: 2,
      height: 2,
    }),
    reviewFile('review-evidence/world-capture.png', 'image/png', secondPng, {
      width: 2,
      height: 2,
    }),
    reviewFile('review-evidence/role-overlay.png', 'image/png', png, {
      width: 2,
      height: 2,
    }),
    reviewFile('review-evidence/collision-overlay.png', 'image/png', secondPng, {
      width: 2,
      height: 2,
    }),
    reviewFile('review-evidence/spawn-exit.mp4', 'video/mp4', videoA),
    reviewFile('review-evidence/navigation.avi', 'video/x-msvideo', videoB),
  ]);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const evidence = (
    evidenceId: string,
    kind: ProductionWorldEvidence['kind'],
    path: string,
  ): ProductionWorldEvidence => {
    const file = byPath.get(path)!;
    return {
      evidence_id: evidenceId,
      kind,
      path,
      media_type: file.media_type,
      bytes: file.bytes,
      sha256: file.sha256,
      claim: `Exact delivery evidence for the ${evidenceId} production gate.`,
      godot_versions: ['4.3', '4.7'],
      ...(file.width === undefined ? {} : { width: file.width }),
      ...(file.height === undefined ? {} : { height: file.height }),
    };
  };
  const preview = byPath.get('review-evidence/world-preview.png')!;
  const review: ProductionWorldReviewContract = {
    schema_version: PRODUCTION_WORLD_REVIEW_VERSION,
    review_id: 'approved-topdown-world',
    profile: 'topdown-farm',
    world_preview: {
      path: preview.path,
      bytes: preview.bytes,
      sha256: preview.sha256,
      width: preview.width!,
      height: preview.height!,
    },
    evidence: [
      evidence(
        'world-capture',
        'rendered-world-capture',
        'review-evidence/world-capture.png',
      ),
      evidence('role-overlay', 'role-placement-overlay', 'review-evidence/role-overlay.png'),
      evidence(
        'collision-overlay',
        'art-collision-overlay',
        'review-evidence/collision-overlay.png',
      ),
      evidence(
        'spawn-exit-route',
        'spawn-exit-traversal',
        'review-evidence/spawn-exit.mp4',
      ),
      evidence(
        'navigation-route',
        'navigation-traversal',
        'review-evidence/navigation.avi',
      ),
    ],
    gates: [
      { gate: 'image-composition', status: 'technical-pass', evidence_ids: ['world-capture'] },
      { gate: 'role-placement', status: 'technical-pass', evidence_ids: ['role-overlay'] },
      { gate: 'art-to-collision', status: 'technical-pass', evidence_ids: ['collision-overlay'] },
      { gate: 'spawn-exit', status: 'technical-pass', evidence_ids: ['spawn-exit-route'] },
      { gate: 'navigation', status: 'technical-pass', evidence_ids: ['navigation-route'] },
      { gate: 'human-review', status: 'pending', evidence_ids: [] },
    ],
    release_decision: 'blocked',
  };
  const overlayBytes = overlay.readBytes();
  const receiptTemplate = createHumanArtReviewTemplate({
    reviewId: 'owner-approved-art',
    profile: 'topdown-farm',
    reviewerId: 'reviewer-owner-one',
    reviewedAt: '2026-07-28T09:00:00.000Z',
    bindings: {
      production_world_review_id: review.review_id,
      world_preview_sha256: review.world_preview.sha256,
      godot_capture_sha256: review.evidence[0]!.sha256,
      runtime_projection_sha256: overlay.manifest.source.projection_sha256,
      runtime_overlay_sha256: await sha256(overlayBytes),
      character_identity_binding_sha256: 'e'.repeat(64),
    },
  });
  const receipt: HumanArtReviewReceipt = {
    ...receiptTemplate,
    criteria: HUMAN_ART_REVIEW_CRITERIA.map((criterion) => ({
      criterion,
      status: 'pass',
    })),
    rights: distribution === 'private'
      ? {
        distribution: 'private',
        output_license_id: 'LicenseRef-Proprietary',
        permits_redistribution: false,
        source_authority_confirmed: true,
      }
      : {
        distribution: 'public',
        output_license_id: 'CC0-1.0',
        permits_redistribution: true,
        source_authority_confirmed: true,
      },
    decision: distribution === 'private' ? 'approved-private' : 'approved-public',
  };
  const receiptBytes = encodeHumanArtReviewReceipt(receipt);
  const approval = await promoteProductionWorldReview({
    review,
    receipt,
    expectedBindings: receipt.bindings,
    receiptPath: 'review-evidence/owner-approved-art.json',
    receiptBytes,
  });
  return { overlay, approval, receipt, receiptBytes, files };
}

describe('approved world-art itch-style delivery kit', () => {
  it('builds one deterministic public single-root kit with the exact nested overlay', async () => {
    const fixture = await approvedFixture('public');
    const options = {
      packId: 'moonlit-meadow-art',
      title: 'Moonlit Meadow World Art',
      version: '1.0.0',
      containsGenerativeAi: true,
    };
    const first = await buildApprovedWorldArtDeliveryKit(
      fixture.overlay,
      fixture.approval,
      fixture.receipt,
      fixture.receiptBytes,
      fixture.files,
      options,
    );
    const replay = await buildApprovedWorldArtDeliveryKit(
      fixture.overlay,
      fixture.approval,
      fixture.receipt,
      fixture.receiptBytes,
      fixture.files,
      options,
    );
    expect(first.readBytes()).toEqual(replay.readBytes());
    expect(first.filename).toBe('moonlit-meadow-art-v1.0.0.zip');
    expect(first.manifest).toMatchObject({
      profile: 'topdown-farm',
      distribution: 'public',
      license: {
        id: 'CC0-1.0',
        permits_redistribution: true,
      },
      compatibility: {
        engine: 'godot',
        tested_versions: ['4.3', '4.7'],
        importer: 'mapsoo-importer',
        asset_contract: 'world-art-runtime-overlay-1.0',
      },
      ai_disclosure: {
        contains_generative_ai: true,
        human_curated: true,
        original_references_embedded: false,
      },
    });
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validate = ajv.compile(deliverySchema);
    expect(validate(first.manifest), JSON.stringify(validate.errors)).toBe(true);

    const archive = await JSZip.loadAsync(first.readBytes(), { checkCRC32: true });
    const names = Object.keys(archive.files);
    const root = 'moonlit-meadow-art-v1.0.0';
    expect(names.every((name) => name.startsWith(`${root}/`))).toBe(true);
    expect(names.every((name) => !archive.files[name]!.dir)).toBe(true);
    expect(new Set(names.map((name) => name.split('/')[0]))).toEqual(new Set([root]));
    expect(names).not.toContain(expect.stringMatching(/(?:^|\/)(?:addons|\.godot)\//));
    const nestedOverlay = await archive.file(
      `${root}/${first.manifest.content.runtime_overlay.path}`,
    )!.async('uint8array');
    expect(nestedOverlay).toEqual(fixture.overlay.readBytes());
    for (const file of first.manifest.files) {
      const entry = archive.file(`${root}/${file.path}`)!;
      const bytes = await entry.async('uint8array');
      expect(bytes.byteLength).toBe(file.bytes);
      expect(await sha256(bytes)).toBe(file.sha256);
      expect(entry.date.toISOString()).toBe('1980-01-01T00:00:00.000Z');
      expect((entry.unixPermissions as number) & 0o777).toBe(0o644);
    }
    expect(names).toContain(`${root}/readme.md`);
    expect(names).toContain(`${root}/license-assets.md`);
    expect(names).toContain(`${root}/changelog.md`);
    expect(names).toContain(`${root}/world-art-delivery.json`);
    expect(names).toContain(`${root}/review-evidence/owner-approved-art.json`);
  });

  it('keeps a private approval proprietary and non-redistributable', async () => {
    const fixture = await approvedFixture('private');
    const built = await buildApprovedWorldArtDeliveryKit(
      fixture.overlay,
      fixture.approval,
      fixture.receipt,
      fixture.receiptBytes,
      fixture.files,
      {
        packId: 'private-meadow-art',
        title: 'Private Meadow World Art',
        version: '1.0.0',
        containsGenerativeAi: true,
      },
    );
    expect(built.manifest).toMatchObject({
      distribution: 'private',
      license: {
        id: 'LicenseRef-Proprietary',
        permits_redistribution: false,
      },
    });
    const archive = await JSZip.loadAsync(built.readBytes());
    const license = await archive.file(
      'private-meadow-art-v1.0.0/license-assets.md',
    )!.async('string');
    expect(license).toContain('Redistribution');
    expect(license).toContain('not granted');
  });

  it('rejects detached approval, changed evidence, changed overlay, and rights escalation', async () => {
    const fixture = await approvedFixture('public');
    const options = {
      packId: 'rejected-meadow-art',
      title: 'Rejected Meadow World Art',
      version: '1.0.0',
      containsGenerativeAi: true,
    };
    await expect(buildApprovedWorldArtDeliveryKit(
      fixture.overlay,
      {
        ...fixture.approval,
        review: {
          ...fixture.approval.review,
          release_decision: 'blocked',
        },
      },
      fixture.receipt,
      fixture.receiptBytes,
      fixture.files,
      options,
    )).rejects.toMatchObject({ code: 'world-art-delivery-build.review' });

    await expect(buildApprovedWorldArtDeliveryKit(
      fixture.overlay,
      fixture.approval,
      fixture.receipt,
      fixture.receiptBytes,
      fixture.files.map((file, index) => index === 0
        ? { ...file, sha256: '0'.repeat(64) }
        : file),
      options,
    )).rejects.toMatchObject({ code: 'world-art-delivery-build.inventory' });

    await expect(buildApprovedWorldArtDeliveryKit(
      {
        ...fixture.overlay,
        readBytes: () => {
          const bytes = fixture.overlay.readBytes();
          bytes[bytes.length - 1] ^= 1;
          return bytes;
        },
      },
      fixture.approval,
      fixture.receipt,
      fixture.receiptBytes,
      fixture.files,
      options,
    )).rejects.toMatchObject({ code: 'world-art-delivery-build.overlay' });

    await expect(buildApprovedWorldArtDeliveryKit(
      fixture.overlay,
      fixture.approval,
      {
        ...fixture.receipt,
        rights: {
          ...fixture.receipt.rights,
          output_license_id: 'CC-BY-4.0',
          attribution: 'Changed rights cannot reuse an old approval.',
        },
      },
      fixture.receiptBytes,
      fixture.files,
      options,
    )).rejects.toMatchObject({ code: 'world-art-delivery-build.review' });
  });
});
