import {
  createHumanArtReviewTemplate,
  encodeHumanArtReviewReceipt,
  promoteProductionWorldReview,
  assertHumanArtReviewReceipt,
  type ApprovedProductionWorldReview,
  type HumanArtReviewBindings,
  type HumanArtReviewReceipt,
} from '../core/human-art-review-receipt';
import {
  assertProductionWorldReview,
  type ProductionWorldReviewContract,
} from '../core/production-world-review-contract';
import {
  readVersionedWorldArtRuntimeOverlayArchive,
  type VerifiedVersionedWorldArtRuntimeOverlayArchive,
} from '../adapters/read-world-art-runtime-overlay-versioned';

export interface HumanArtReviewWorkspaceArtifacts {
  readonly review: ProductionWorldReviewContract;
  readonly runtimeOverlayBytes: Uint8Array;
  readonly layoutPlan?: unknown;
  readonly godotCaptureEvidenceId: string;
  readonly characterIdentityBindingSha256: string;
}

export interface PreparedHumanArtReviewTemplate {
  readonly receipt: HumanArtReviewReceipt;
  readonly canonicalReceiptBytes: Uint8Array;
  readonly overlay: VerifiedVersionedWorldArtRuntimeOverlayArchive;
}

export interface ValidatedHumanArtReviewWorkspace
  extends PreparedHumanArtReviewTemplate {
  readonly bindings: HumanArtReviewBindings;
}

const SHA256 = /^[a-f0-9]{64}$/;

function exactBindings(
  left: HumanArtReviewBindings,
  right: HumanArtReviewBindings,
): boolean {
  return (
    left.production_world_review_id === right.production_world_review_id
    && left.world_preview_sha256 === right.world_preview_sha256
    && left.godot_capture_sha256 === right.godot_capture_sha256
    && left.runtime_projection_sha256 === right.runtime_projection_sha256
    && left.runtime_overlay_sha256 === right.runtime_overlay_sha256
    && left.character_identity_binding_sha256
      === right.character_identity_binding_sha256
  );
}

async function deriveBindings(
  artifacts: HumanArtReviewWorkspaceArtifacts,
): Promise<Readonly<{
  bindings: HumanArtReviewBindings;
  overlay: VerifiedVersionedWorldArtRuntimeOverlayArchive;
}>> {
  try {
    assertProductionWorldReview(artifacts.review);
  } catch {
    throw new Error('Production world review is invalid.');
  }
  if (
    artifacts.review.release_decision !== 'blocked'
    || artifacts.review.gates.some(({ gate, status }) =>
      gate === 'human-review' ? status !== 'pending' : status === 'pending')
  ) {
    throw new Error(
      'Human review requires complete technical gates and one pending human gate.',
    );
  }
  if (!SHA256.test(artifacts.characterIdentityBindingSha256)) {
    throw new Error(
      'Character identity binding must be one lowercase SHA-256 without private character data.',
    );
  }
  const overlay = await readVersionedWorldArtRuntimeOverlayArchive(
    artifacts.runtimeOverlayBytes,
    artifacts.layoutPlan === undefined
      ? {}
      : { layout_plan: artifacts.layoutPlan },
  );
  if (overlay.manifest.profile !== artifacts.review.profile) {
    throw new Error('Runtime overlay profile differs from the production review.');
  }
  const imageGate = artifacts.review.gates.find(
    ({ gate }) => gate === 'image-composition',
  );
  const capture = artifacts.review.evidence.find(
    ({ evidence_id: evidenceId }) =>
      evidenceId === artifacts.godotCaptureEvidenceId,
  );
  if (
    !imageGate
    || !imageGate.evidence_ids.includes(artifacts.godotCaptureEvidenceId)
    || !capture
    || capture.kind !== 'rendered-world-capture'
    || capture.media_type !== 'image/png'
  ) {
    throw new Error(
      'Godot capture evidence must be a rendered PNG cited by the passing image-composition gate.',
    );
  }
  return Object.freeze({
    bindings: Object.freeze({
      production_world_review_id: artifacts.review.review_id,
      world_preview_sha256: artifacts.review.world_preview.sha256,
      godot_capture_sha256: capture.sha256,
      runtime_projection_sha256: overlay.manifest.source.projection_sha256,
      runtime_overlay_sha256: overlay.sha256,
      character_identity_binding_sha256:
        artifacts.characterIdentityBindingSha256,
    }),
    overlay,
  });
}

export async function prepareHumanArtReviewTemplate(
  input: HumanArtReviewWorkspaceArtifacts & Readonly<{
    reviewId: string;
    reviewerId: string;
    reviewedAt: string;
  }>,
): Promise<PreparedHumanArtReviewTemplate> {
  const { bindings, overlay } = await deriveBindings(input);
  const receipt = createHumanArtReviewTemplate({
    reviewId: input.reviewId,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
    profile: input.review.profile,
    bindings,
  });
  return Object.freeze({
    receipt,
    canonicalReceiptBytes: encodeHumanArtReviewReceipt(receipt),
    overlay,
  });
}

export async function validateHumanArtReviewWorkspace(
  input: HumanArtReviewWorkspaceArtifacts & Readonly<{
    receipt: HumanArtReviewReceipt;
  }>,
): Promise<ValidatedHumanArtReviewWorkspace> {
  try {
    assertHumanArtReviewReceipt(input.receipt);
  } catch {
    throw new Error('Human art review receipt is invalid or incomplete.');
  }
  const { bindings, overlay } = await deriveBindings(input);
  if (
    input.receipt.profile !== input.review.profile
    || !exactBindings(input.receipt.bindings, bindings)
  ) {
    throw new Error(
      'Human art review receipt does not bind the exact current artifacts.',
    );
  }
  return Object.freeze({
    receipt: input.receipt,
    canonicalReceiptBytes: encodeHumanArtReviewReceipt(input.receipt),
    bindings,
    overlay,
  });
}

export async function promoteHumanArtReviewWorkspace(
  input: HumanArtReviewWorkspaceArtifacts & Readonly<{
    receipt: HumanArtReviewReceipt;
    receiptPath: string;
  }>,
): Promise<Readonly<{
  approval: ApprovedProductionWorldReview;
  canonicalReceiptBytes: Uint8Array;
}>> {
  const validated = await validateHumanArtReviewWorkspace(input);
  const approval = await promoteProductionWorldReview({
    review: input.review,
    receipt: input.receipt,
    expectedBindings: validated.bindings,
    receiptPath: input.receiptPath,
    receiptBytes: validated.canonicalReceiptBytes,
  });
  return Object.freeze({
    approval,
    canonicalReceiptBytes: validated.canonicalReceiptBytes,
  });
}
