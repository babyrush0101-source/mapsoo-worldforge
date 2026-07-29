import {
  HUMAN_ART_REVIEW_CRITERIA,
  createHumanArtReviewTemplate,
  encodeHumanArtReviewReceipt,
  promoteProductionWorldReview,
  type HumanArtReviewReceipt,
} from '../core/human-art-review-receipt';
import type { ProductionArtRights } from '../core/production-art-contract';
import {
  PRODUCTION_WORLD_REVIEW_VERSION,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from '../core/production-world-review-contract';
import { buildWorldArtRuntimeProjection } from '../core/world-art-runtime-projection';
import { buildWorldArtRuntimeOverlayZip } from './build-world-art-runtime-overlay';
import {
  buildWorldArtRuntimeOverlayV1_1Zip,
} from './build-world-art-runtime-overlay-v1-1';
import { encodeRgbaPng } from './canvas/encode-png';
import type {
  ProjectedReviewedWorldArtImage,
  ProjectedReviewedWorldArtVariants,
} from './project-reviewed-world-art-variants';
import type {
  WorldArtDeliveryReviewFile,
} from './build-approved-world-art-delivery-kit';
import {
  buildWorldArtRuntimeOverlayV1_1TestFixture,
} from './world-art-runtime-overlay-v1-1.test-fixture';

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

export async function approvedWorldArtDeliveryKitTestFixture(
  distribution: 'private' | 'public',
  overlayVersion: '1.0.0' | '1.1.0' = '1.0.0',
) {
  if (overlayVersion === '1.1.0' && distribution !== 'public') {
    throw new Error('The shared Overlay 1.1 fixture is public-only.');
  }
  const v1_1Fixture = overlayVersion === '1.1.0'
    ? await buildWorldArtRuntimeOverlayV1_1TestFixture('topdown-farm')
    : undefined;
  const builtOverlay = v1_1Fixture
    ? await buildWorldArtRuntimeOverlayV1_1Zip(v1_1Fixture)
    : await overlayFixture(distribution === 'private'
      ? { distribution: 'private', license: 'LicenseRef-Proprietary' }
      : { distribution: 'public', license: 'CC0-1.0' });
  const overlay = Object.freeze({
    ...builtOverlay,
    ...(v1_1Fixture === undefined
      ? {}
      : { layoutPlan: v1_1Fixture.layout_plan }),
  });
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
  const videoA = Uint8Array.from([
    0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50,
  ]);
  const videoB = Uint8Array.from([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
  ]);
  const files = await Promise.all([
    reviewFile('review-evidence/world-preview.png', 'image/png', png, {
      width: 2,
      height: 2,
    }),
    reviewFile(
      'review-evidence/world-capture.png',
      'image/png',
      secondPng,
      { width: 2, height: 2 },
    ),
    reviewFile('review-evidence/role-overlay.png', 'image/png', png, {
      width: 2,
      height: 2,
    }),
    reviewFile(
      'review-evidence/collision-overlay.png',
      'image/png',
      secondPng,
      { width: 2, height: 2 },
    ),
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
      evidence(
        'role-overlay',
        'role-placement-overlay',
        'review-evidence/role-overlay.png',
      ),
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
      {
        gate: 'image-composition',
        status: 'technical-pass',
        evidence_ids: ['world-capture'],
      },
      {
        gate: 'role-placement',
        status: 'technical-pass',
        evidence_ids: ['role-overlay'],
      },
      {
        gate: 'art-to-collision',
        status: 'technical-pass',
        evidence_ids: ['collision-overlay'],
      },
      {
        gate: 'spawn-exit',
        status: 'technical-pass',
        evidence_ids: ['spawn-exit-route'],
      },
      {
        gate: 'navigation',
        status: 'technical-pass',
        evidence_ids: ['navigation-route'],
      },
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
    decision: distribution === 'private'
      ? 'approved-private'
      : 'approved-public',
  };
  const receiptBytes = encodeHumanArtReviewReceipt(receipt);
  const approval = await promoteProductionWorldReview({
    review,
    receipt,
    expectedBindings: receipt.bindings,
    receiptPath: 'review-evidence/owner-approved-art.json',
    receiptBytes,
  });
  return Object.freeze({
    overlay,
    approval,
    receipt,
    receiptBytes,
    files: Object.freeze(files),
  });
}
