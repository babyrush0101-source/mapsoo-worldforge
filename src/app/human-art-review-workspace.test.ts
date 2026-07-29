import { describe, expect, it } from 'vitest';

import {
  HUMAN_ART_REVIEW_CRITERIA,
  type HumanArtReviewReceipt,
} from '../core/human-art-review-receipt';
import {
  PRODUCTION_WORLD_REVIEW_VERSION,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from '../core/production-world-review-contract';
import {
  buildWorldArtRuntimeProjection,
} from '../core/world-art-runtime-projection';
import {
  buildWorldArtRuntimeOverlayZip,
} from '../adapters/build-world-art-runtime-overlay';
import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import type {
  ProjectedReviewedWorldArtImage,
} from '../adapters/project-reviewed-world-art-variants';
import {
  prepareHumanArtReviewTemplate,
  promoteHumanArtReviewWorkspace,
  validateHumanArtReviewWorkspace,
} from './human-art-review-workspace';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function overlayFixture() {
  const png = encodeRgbaPng(2, 2, Uint8Array.from([
    40, 80, 120, 255,
    50, 90, 130, 255,
    60, 100, 140, 255,
    70, 110, 150, 255,
  ]));
  const pngSha = await sha256(png);
  const imagePath = 'production-art/topdown-farm/terrain-sheet-001.png';
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
    rights: {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    },
    images: [{
      task_id: 'terrain-sheet-001',
      path: imagePath,
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
      task_id: 'terrain-sheet-001',
      slot_id: 'terrain-ground-canonical',
      requirement_id: 'terrain-ground',
      role: 'terrain.ground',
      variant_id: 'canonical',
      image_path: imagePath,
      region: { x: 0, y: 0, width: 2, height: 2 },
      cell_sha256: '9'.repeat(64),
      poses: [],
    }],
    bindings: [{
      usage_kind: 'terrain-material',
      usage_id: 'ground',
      task_id: 'terrain-sheet-001',
      slot_id: 'terrain-ground-canonical',
      role: 'terrain.ground',
      variant_id: 'canonical',
      image_path: imagePath,
      region: { x: 0, y: 0, width: 2, height: 2 },
      cell_sha256: '9'.repeat(64),
      poses: [],
    }],
    hazards: [],
  });
  const image: ProjectedReviewedWorldArtImage = Object.freeze({
    task_id: 'terrain-sheet-001',
    path: imagePath,
    media_type: 'image/png',
    bytes: png.byteLength,
    sha256: pngSha,
    readBytes: () => Uint8Array.from(png),
  });
  return buildWorldArtRuntimeOverlayZip({
    projection,
    images: [image],
  });
}

function evidence(
  evidenceId: string,
  kind: ProductionWorldEvidence['kind'],
  index: number,
  mediaType: 'image/png' | 'video/mp4',
): ProductionWorldEvidence {
  return {
    evidence_id: evidenceId,
    kind,
    path: `review-evidence/${evidenceId}.${mediaType === 'image/png' ? 'png' : 'mp4'}`,
    media_type: mediaType,
    bytes: 1000 + index,
    sha256: String(index + 1).repeat(64),
    claim: `Exact technical evidence for the ${evidenceId} review gate.`,
    godot_versions: ['4.3', '4.7'],
    ...(mediaType === 'image/png' ? { width: 1280, height: 720 } : {}),
  };
}

function reviewFixture(): ProductionWorldReviewContract {
  return {
    schema_version: PRODUCTION_WORLD_REVIEW_VERSION,
    review_id: 'topdown-world-technical-review',
    profile: 'topdown-farm',
    world_preview: {
      path: 'review-evidence/world-preview.png',
      bytes: 2000,
      sha256: 'a'.repeat(64),
      width: 1280,
      height: 720,
    },
    evidence: [
      evidence('godot-world-capture', 'rendered-world-capture', 0, 'image/png'),
      evidence('role-overlay', 'role-placement-overlay', 1, 'image/png'),
      evidence('collision-overlay', 'art-collision-overlay', 2, 'image/png'),
      evidence('spawn-exit-route', 'spawn-exit-traversal', 3, 'video/mp4'),
      evidence('navigation-route', 'navigation-traversal', 4, 'video/mp4'),
    ],
    gates: [
      {
        gate: 'image-composition',
        status: 'technical-pass',
        evidence_ids: ['godot-world-capture'],
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
}

function approvePrivate(receipt: HumanArtReviewReceipt): HumanArtReviewReceipt {
  return {
    ...receipt,
    criteria: HUMAN_ART_REVIEW_CRITERIA.map((criterion) => ({
      criterion,
      status: 'pass' as const,
    })),
    rights: {
      distribution: 'private',
      output_license_id: 'LicenseRef-Proprietary',
      permits_redistribution: false,
      source_authority_confirmed: true,
    },
    decision: 'approved-private',
  };
}

describe('human art review workspace', () => {
  it('derives exact artifact bindings and creates only a blocked template', async () => {
    const overlay = await overlayFixture();
    const prepared = await prepareHumanArtReviewTemplate({
      review: reviewFixture(),
      runtimeOverlayBytes: overlay.readBytes(),
      godotCaptureEvidenceId: 'godot-world-capture',
      characterIdentityBindingSha256: 'b'.repeat(64),
      reviewId: 'human-review-one',
      reviewerId: 'owner-reviewer-one',
      reviewedAt: '2026-07-28T10:00:00.000Z',
    });

    expect(prepared.receipt.decision).toBe('blocked');
    expect(prepared.receipt.criteria.every(
      ({ status }) => status === 'not-reviewed',
    )).toBe(true);
    expect(prepared.receipt.bindings).toEqual({
      production_world_review_id: 'topdown-world-technical-review',
      world_preview_sha256: 'a'.repeat(64),
      godot_capture_sha256: '1'.repeat(64),
      runtime_projection_sha256: overlay.manifest.source.projection_sha256,
      runtime_overlay_sha256: await sha256(overlay.readBytes()),
      character_identity_binding_sha256: 'b'.repeat(64),
    });
  });

  it('promotes only a complete human decision bound to the current overlay', async () => {
    const overlay = await overlayFixture();
    const review = reviewFixture();
    const prepared = await prepareHumanArtReviewTemplate({
      review,
      runtimeOverlayBytes: overlay.readBytes(),
      godotCaptureEvidenceId: 'godot-world-capture',
      characterIdentityBindingSha256: 'b'.repeat(64),
      reviewId: 'human-review-one',
      reviewerId: 'owner-reviewer-one',
      reviewedAt: '2026-07-28T10:00:00.000Z',
    });
    const receipt = approvePrivate(prepared.receipt);
    const validated = await validateHumanArtReviewWorkspace({
      review,
      runtimeOverlayBytes: overlay.readBytes(),
      godotCaptureEvidenceId: 'godot-world-capture',
      characterIdentityBindingSha256: 'b'.repeat(64),
      receipt,
    });
    expect(validated.canonicalReceiptBytes.byteLength).toBeGreaterThan(100);

    const promoted = await promoteHumanArtReviewWorkspace({
      review,
      runtimeOverlayBytes: overlay.readBytes(),
      godotCaptureEvidenceId: 'godot-world-capture',
      characterIdentityBindingSha256: 'b'.repeat(64),
      receipt,
      receiptPath: 'review-evidence/human-review-one.json',
    });
    expect(promoted.approval.review.release_decision).toBe('approved');
    expect(promoted.approval.human_review.decision).toBe('approved-private');
  });

  it('rejects a changed overlay, wrong profile, or non-cited capture', async () => {
    const overlay = await overlayFixture();
    const prepared = await prepareHumanArtReviewTemplate({
      review: reviewFixture(),
      runtimeOverlayBytes: overlay.readBytes(),
      godotCaptureEvidenceId: 'godot-world-capture',
      characterIdentityBindingSha256: 'b'.repeat(64),
      reviewId: 'human-review-one',
      reviewerId: 'owner-reviewer-one',
      reviewedAt: '2026-07-28T10:00:00.000Z',
    });
    const changed = overlay.readBytes();
    changed[changed.length - 1] ^= 1;
    await expect(validateHumanArtReviewWorkspace({
      review: reviewFixture(),
      runtimeOverlayBytes: changed,
      godotCaptureEvidenceId: 'godot-world-capture',
      characterIdentityBindingSha256: 'b'.repeat(64),
      receipt: approvePrivate(prepared.receipt),
    })).rejects.toThrow();
    await expect(prepareHumanArtReviewTemplate({
      review: { ...reviewFixture(), profile: 'side-platformer' },
      runtimeOverlayBytes: overlay.readBytes(),
      godotCaptureEvidenceId: 'godot-world-capture',
      characterIdentityBindingSha256: 'b'.repeat(64),
      reviewId: 'human-review-two',
      reviewerId: 'owner-reviewer-one',
      reviewedAt: '2026-07-28T10:00:00.000Z',
    })).rejects.toThrow('profile');
    await expect(prepareHumanArtReviewTemplate({
      review: reviewFixture(),
      runtimeOverlayBytes: overlay.readBytes(),
      godotCaptureEvidenceId: 'role-overlay',
      characterIdentityBindingSha256: 'b'.repeat(64),
      reviewId: 'human-review-three',
      reviewerId: 'owner-reviewer-one',
      reviewedAt: '2026-07-28T10:00:00.000Z',
    })).rejects.toThrow('Godot capture');
  });
});
