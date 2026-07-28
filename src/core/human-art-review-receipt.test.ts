import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import receiptSchema from '../../schemas/mapsoo-human-art-review-receipt-1.0.schema.json';
import {
  HUMAN_ART_REVIEW_ATTESTATION,
  HUMAN_ART_REVIEW_CRITERIA,
  createHumanArtReviewTemplate,
  encodeHumanArtReviewReceipt,
  promoteProductionWorldReview,
  validateHumanArtReviewReceipt,
  type HumanArtReviewReceipt,
} from './human-art-review-receipt';
import {
  PRODUCTION_WORLD_REVIEW_VERSION,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from './production-world-review-contract';

const HASH = Object.freeze({
  preview: 'a'.repeat(64),
  capture: 'b'.repeat(64),
  projection: 'c'.repeat(64),
  overlay: 'd'.repeat(64),
  identity: 'e'.repeat(64),
});

function technicalEvidence(
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
    bytes: 8192 + index,
    sha256: String(index + 1).repeat(64),
    claim: `Exact technical evidence for the ${evidenceId} production review gate.`,
    godot_versions: ['4.3', '4.7'],
    ...(mediaType === 'image/png' ? { width: 1280, height: 720 } : {}),
  };
}

function worldReview(): ProductionWorldReviewContract {
  const evidence = [
    technicalEvidence('world-capture', 'rendered-world-capture', 0, 'image/png'),
    technicalEvidence('role-overlay', 'role-placement-overlay', 1, 'image/png'),
    technicalEvidence('collision-overlay', 'art-collision-overlay', 2, 'image/png'),
    technicalEvidence('spawn-exit-route', 'spawn-exit-traversal', 3, 'video/mp4'),
    technicalEvidence('navigation-route', 'navigation-traversal', 4, 'video/mp4'),
  ];
  return {
    schema_version: PRODUCTION_WORLD_REVIEW_VERSION,
    review_id: 'four-profile-world-review',
    profile: 'topdown-farm',
    world_preview: {
      path: 'review-evidence/world-preview.png',
      bytes: 16384,
      sha256: HASH.preview,
      width: 1280,
      height: 720,
    },
    evidence,
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
}

function template(): HumanArtReviewReceipt {
  return createHumanArtReviewTemplate({
    reviewId: 'owner-art-review-one',
    profile: 'topdown-farm',
    reviewerId: 'reviewer-owner-one',
    reviewedAt: '2026-07-28T08:00:00.000Z',
    bindings: {
      production_world_review_id: 'four-profile-world-review',
      world_preview_sha256: HASH.preview,
      godot_capture_sha256: HASH.capture,
      runtime_projection_sha256: HASH.projection,
      runtime_overlay_sha256: HASH.overlay,
      character_identity_binding_sha256: HASH.identity,
    },
  });
}

function approvedPrivate(): HumanArtReviewReceipt {
  return {
    ...template(),
    criteria: HUMAN_ART_REVIEW_CRITERIA.map((criterion) => ({
      criterion,
      status: 'pass' as const,
    })),
    rights: {
      distribution: 'private',
      output_license_id: 'LicenseRef-User-Owned',
      permits_redistribution: false,
      source_authority_confirmed: true,
    },
    decision: 'approved-private',
  };
}

describe('human art review receipt and production release gate', () => {
  it('creates a schema-valid fail-closed template for every canonical criterion', () => {
    const value = template();
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(receiptSchema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(value.criteria.map(({ criterion }) => criterion)).toEqual(
      HUMAN_ART_REVIEW_CRITERIA,
    );
    expect(value.criteria.every(({ status }) => status === 'not-reviewed')).toBe(true);
    expect(value.decision).toBe('blocked');
    expect(value.rights).toEqual({
      distribution: 'internal-review',
      output_license_id: 'LicenseRef-UNRELEASED',
      permits_redistribution: false,
      source_authority_confirmed: false,
    });
    expect(value.attestation).toBe(HUMAN_ART_REVIEW_ATTESTATION);
    expect(validateHumanArtReviewReceipt(value)).toEqual([]);
  });

  it('promotes complete private approval into the existing world review without exposing cues', async () => {
    const receipt = approvedPrivate();
    const receiptBytes = encodeHumanArtReviewReceipt(receipt);
    const promoted = await promoteProductionWorldReview({
      review: worldReview(),
      receipt,
      expectedBindings: receipt.bindings,
      receiptPath: 'review-evidence/owner-art-review-one.json',
      receiptBytes,
    });
    expect(promoted.review.release_decision).toBe('approved');
    expect(promoted.review.gates.at(-1)).toEqual({
      gate: 'human-review',
      status: 'human-pass',
      evidence_ids: ['owner-art-review-one-record'],
    });
    expect(promoted.human_review).toMatchObject({
      receipt_path: 'review-evidence/owner-art-review-one.json',
      reviewer_id: 'reviewer-owner-one',
      decision: 'approved-private',
    });
    expect(promoted.authorization).toEqual(receipt.rights);
    expect(JSON.stringify(promoted)).not.toContain('character description');
    expect(JSON.stringify(promoted)).not.toContain('source image path');
  });

  it('permits public approval only with redistribution rights and required attribution', () => {
    const privateReceipt = approvedPrivate();
    const missingAttribution: HumanArtReviewReceipt = {
      ...privateReceipt,
      rights: {
        distribution: 'public',
        output_license_id: 'CC-BY-4.0',
        permits_redistribution: true,
        source_authority_confirmed: true,
      },
      decision: 'approved-public',
    };
    expect(validateHumanArtReviewReceipt(missingAttribution))
      .toContainEqual(expect.objectContaining({ code: 'rights.attribution' }));

    const approvedPublic: HumanArtReviewReceipt = {
      ...missingAttribution,
      rights: {
        ...missingAttribution.rights,
        attribution: 'Original generated and human-curated world art by the pack author.',
      },
    };
    expect(validateHumanArtReviewReceipt(approvedPublic)).toEqual([]);
  });

  it('rejects partial approval, missing revision notes, and distribution escalation', () => {
    const base = approvedPrivate();
    const partial: HumanArtReviewReceipt = {
      ...base,
      criteria: base.criteria.map((criterion) =>
        criterion.criterion === 'character.identity-continuity'
          ? { ...criterion, status: 'not-reviewed' as const }
          : criterion),
    };
    expect(validateHumanArtReviewReceipt(partial))
      .toContainEqual(expect.objectContaining({ code: 'receipt.decision' }));

    const reviseWithoutNote: HumanArtReviewReceipt = {
      ...template(),
      criteria: template().criteria.map((criterion) =>
        criterion.criterion === 'terrain.transition-quality'
          ? { ...criterion, status: 'revise' as const }
          : criterion),
      requested_revisions: ['Repair visible terrain seams before another review.'],
    };
    expect(validateHumanArtReviewReceipt(reviseWithoutNote))
      .toContainEqual(expect.objectContaining({
        code: 'criterion.revision-note',
        criterion: 'terrain.transition-quality',
      }));

    const escalated: HumanArtReviewReceipt = {
      ...base,
      rights: {
        distribution: 'public',
        output_license_id: 'LicenseRef-User-Owned',
        permits_redistribution: false,
        source_authority_confirmed: true,
      },
      decision: 'approved-public',
    };
    expect(validateHumanArtReviewReceipt(escalated))
      .toContainEqual(expect.objectContaining({ code: 'rights.public-boundary' }));
  });

  it('forbids undeclared receipt, criterion, binding, and rights fields', () => {
    const base = approvedPrivate();
    const changed = {
      ...base,
      private_character_cues: 'Undeclared private cue text must never enter a receipt.',
      bindings: {
        ...base.bindings,
        source_image_path: 'private/reference.png',
      },
      criteria: base.criteria.map((criterion, index) => index === 0
        ? { ...criterion, raw_provider_response: 'not allowed' }
        : criterion),
      rights: {
        ...base.rights,
        account_email: 'not-allowed@example.invalid',
      },
    } as HumanArtReviewReceipt;
    const codes = validateHumanArtReviewReceipt(changed).map(({ code }) => code);
    expect(codes).toContain('receipt.fields');
    expect(codes).toContain('binding.coverage');
    expect(codes).toContain('criterion.fields');
    expect(codes).toContain('rights.fields');
  });

  it('fails promotion on tampered bytes, mismatched artifacts, or incomplete technical gates', async () => {
    const receipt = approvedPrivate();
    const receiptBytes = encodeHumanArtReviewReceipt(receipt);
    const tampered = receiptBytes.slice();
    tampered[tampered.length - 2] ^= 1;
    await expect(promoteProductionWorldReview({
      review: worldReview(),
      receipt,
      expectedBindings: receipt.bindings,
      receiptPath: 'review-evidence/owner-art-review-one.json',
      receiptBytes: tampered,
    })).rejects.toMatchObject({ code: 'promotion.bytes' });

    await expect(promoteProductionWorldReview({
      review: worldReview(),
      receipt: {
        ...receipt,
        bindings: {
          ...receipt.bindings,
          runtime_overlay_sha256: 'f'.repeat(64),
          world_preview_sha256: '0'.repeat(64),
        },
      },
      expectedBindings: receipt.bindings,
      receiptPath: 'review-evidence/owner-art-review-one.json',
      receiptBytes,
    })).rejects.toMatchObject({ code: 'promotion.binding' });

    const incomplete = worldReview();
    await expect(promoteProductionWorldReview({
      review: {
        ...incomplete,
        gates: incomplete.gates.map((gate) =>
          gate.gate === 'navigation'
            ? { ...gate, status: 'pending' as const, evidence_ids: [] }
            : gate),
      },
      receipt,
      expectedBindings: receipt.bindings,
      receiptPath: 'review-evidence/owner-art-review-one.json',
      receiptBytes,
    })).rejects.toMatchObject({ code: 'promotion.review-state' });
  });
});
