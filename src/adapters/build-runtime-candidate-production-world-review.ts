import type {
  LoadedWorldArtRuntimeCandidateWorkspace,
} from './load-world-art-runtime-candidate-workspace';
import {
  buildProductionWorldReview,
  type BuiltProductionWorldReview,
  type ProductionWorldReviewFile,
  type ProductionWorldReviewSourceFile,
} from './build-production-world-review';
import {
  assertProductionWorldReview,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from '../core/production-world-review-contract';
import {
  buildGodotRuntimeCaptureReceipt,
  serializeCanonicalGodotRuntimeCaptureReceipt,
  type GodotRuntimeCaptureGodotVersion,
  type GodotRuntimeCaptureReceipt,
} from '../core/godot-runtime-capture-receipt';

export interface RuntimeCandidateCaptureMetrics {
  readonly visible_terrain_materials: number;
  readonly visible_landmarks: number;
  readonly visible_hazards: number;
  readonly visible_characters: number;
  readonly route_reached: true;
}

export interface BuildRuntimeCandidateProductionWorldReviewInput {
  readonly candidate: LoadedWorldArtRuntimeCandidateWorkspace;
  readonly layoutPlanSha256: string;
  readonly reviewId: string;
  readonly godotVersion: GodotRuntimeCaptureGodotVersion;
  readonly godotExecutableSha256: string;
  readonly captureMetrics: RuntimeCandidateCaptureMetrics;
  readonly renderedWorldCapture: ProductionWorldReviewSourceFile;
  readonly rolePlacementOverlay: ProductionWorldReviewSourceFile;
  readonly artCollisionOverlay: ProductionWorldReviewSourceFile;
  readonly spawnExitTraversal: ProductionWorldReviewSourceFile;
  readonly navigationTraversal: ProductionWorldReviewSourceFile;
}

export interface BuiltRuntimeCandidateProductionWorldReview
  extends BuiltProductionWorldReview {
  readonly captureReceipt: GodotRuntimeCaptureReceipt;
  readonly captureReceiptFile: ProductionWorldReviewFile;
}

export class BuildRuntimeCandidateProductionWorldReviewError extends Error {
  constructor(
    readonly code:
      | 'runtime-candidate-technical-review.invalid-source'
      | 'runtime-candidate-technical-review.invalid-capture'
      | 'runtime-candidate-technical-review.integrity',
    message: string,
  ) {
    super(message);
    this.name = 'BuildRuntimeCandidateProductionWorldReviewError';
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const CAPTURE_RECEIPT_PATH =
  'review-evidence/godot-runtime-capture-receipt.json' as const;

function fail(
  code: BuildRuntimeCandidateProductionWorldReviewError['code'],
  message: string,
): never {
  throw new BuildRuntimeCandidateProductionWorldReviewError(code, message);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function file(
  path: string,
  mediaType: ProductionWorldReviewFile['media_type'],
  bytesValue: Uint8Array,
): Promise<ProductionWorldReviewFile> {
  const bytes = Uint8Array.from(bytesValue);
  return Object.freeze({
    path,
    media_type: mediaType,
    bytes: bytes.byteLength,
    sha256: await sha256(bytes),
    readBytes: () => Uint8Array.from(bytes),
  });
}

function evidence(
  review: ProductionWorldReviewContract,
  kind:
    | 'rendered-world-capture'
    | 'role-placement-overlay'
    | 'art-collision-overlay'
    | 'spawn-exit-traversal'
    | 'navigation-traversal',
): ProductionWorldEvidence {
  const found = review.evidence.find((record) => record.kind === kind);
  if (!found) {
    return fail(
      'runtime-candidate-technical-review.integrity',
      `Built technical review is missing ${kind}.`,
    );
  }
  return found;
}

function expectedVisibleCounts(
  candidate: LoadedWorldArtRuntimeCandidateWorkspace,
): RuntimeCandidateCaptureMetrics {
  const bindings = candidate.runtime_projection.bindings;
  return Object.freeze({
    visible_terrain_materials: bindings.filter(
      ({ usage_kind: kind }) => kind === 'terrain-material',
    ).length,
    visible_landmarks: bindings.filter(
      ({ usage_kind: kind }) => kind === 'landmark',
    ).length,
    visible_hazards: candidate.runtime_projection.hazards.length,
    visible_characters: bindings.some(
      ({ usage_kind: kind, role }) =>
        kind === 'character' && role === 'character.player.atlas',
    ) ? 1 : 0,
    route_reached: true,
  });
}

function sameMetrics(
  left: RuntimeCandidateCaptureMetrics,
  right: RuntimeCandidateCaptureMetrics,
): boolean {
  return (
    left.visible_terrain_materials === right.visible_terrain_materials
    && left.visible_landmarks === right.visible_landmarks
    && left.visible_hazards === right.visible_hazards
    && left.visible_characters === right.visible_characters
    && left.route_reached === true
    && right.route_reached === true
  );
}

function catalogOnlyCount(
  candidate: LoadedWorldArtRuntimeCandidateWorkspace,
): number {
  const bound = new Set(candidate.runtime_projection.bindings.map(
    ({ task_id: taskId, slot_id: slotId }) => `${taskId}\u0000${slotId}`,
  ));
  return candidate.runtime_projection.assets.filter(
    ({ task_id: taskId, slot_id: slotId }) =>
      !bound.has(`${taskId}\u0000${slotId}`),
  ).length;
}

export async function buildRuntimeCandidateProductionWorldReview(
  input: BuildRuntimeCandidateProductionWorldReviewInput,
): Promise<BuiltRuntimeCandidateProductionWorldReview> {
  if (
    !SHA256.test(input.layoutPlanSha256)
    || !SHA256.test(input.godotExecutableSha256)
    || input.candidate.receipt.profile
      !== input.candidate.runtime_projection.profile
    || input.candidate.receipt.profile
      !== input.candidate.overlay.manifest.profile
    || input.candidate.receipt.source.layout_plan_sha256
      !== input.layoutPlanSha256
    || input.candidate.overlay.manifest.source.layout_plan_sha256
      !== input.layoutPlanSha256
    || input.candidate.receipt.source.runtime_projection_sha256
      !== input.candidate.overlay.manifest.source.projection_sha256
  ) {
    fail(
      'runtime-candidate-technical-review.invalid-source',
      'Candidate, layout, overlay, and runtime projection are not source-bound.',
    );
  }
  const expectedMetrics = expectedVisibleCounts(input.candidate);
  if (!sameMetrics(input.captureMetrics, expectedMetrics)) {
    fail(
      'runtime-candidate-technical-review.invalid-capture',
      'Godot capture counts differ from the exact runtime projection.',
    );
  }
  const base = await buildProductionWorldReview({
    reviewId: input.reviewId,
    profile: input.candidate.receipt.profile,
    godotVersions: [input.godotVersion],
    worldPreview: input.renderedWorldCapture,
    renderedWorldCapture: input.renderedWorldCapture,
    rolePlacementOverlay: input.rolePlacementOverlay,
    artCollisionOverlay: input.artCollisionOverlay,
    spawnExitTraversal: input.spawnExitTraversal,
    navigationTraversal: input.navigationTraversal,
  });
  const captureEvidence = evidence(base.review, 'rendered-world-capture');
  const roleEvidence = evidence(base.review, 'role-placement-overlay');
  const collisionEvidence = evidence(base.review, 'art-collision-overlay');
  const spawnEvidence = evidence(base.review, 'spawn-exit-traversal');
  const navigationEvidence = evidence(base.review, 'navigation-traversal');
  const captureReceipt = await buildGodotRuntimeCaptureReceipt({
    profile: input.candidate.receipt.profile,
    source: {
      candidate_id: input.candidate.receipt.candidate_id,
      candidate_receipt_sha256: input.candidate.receipt_file.sha256,
      layout_plan_sha256: input.layoutPlanSha256,
      runtime_overlay_id: input.candidate.overlay.manifest.overlay_id,
      runtime_overlay_sha256: input.candidate.overlay.sha256,
      runtime_projection_id: input.candidate.runtime_projection.projection_id,
      runtime_projection_sha256:
        input.candidate.receipt.source.runtime_projection_sha256,
    },
    engine: {
      godot_version: input.godotVersion,
      executable_sha256: input.godotExecutableSha256,
    },
    evidence: [
      captureEvidence,
      roleEvidence,
      collisionEvidence,
      spawnEvidence,
      navigationEvidence,
    ].map((record) => ({
      kind: record.kind as
        | 'rendered-world-capture'
        | 'role-placement-overlay'
        | 'art-collision-overlay'
        | 'spawn-exit-traversal'
        | 'navigation-traversal',
      path: record.path,
      media_type: record.media_type as 'image/png' | 'video/x-msvideo',
      bytes: record.bytes,
      sha256: record.sha256,
    })),
    runtime: {
      ...input.captureMetrics,
      catalog_assets: input.candidate.runtime_projection.assets.length,
      runtime_bindings: input.candidate.runtime_projection.bindings.length,
      catalog_only_assets: catalogOnlyCount(input.candidate),
      all_required_bindings_applied: true,
    },
  });
  const captureReceiptBytes =
    await serializeCanonicalGodotRuntimeCaptureReceipt(captureReceipt);
  const captureReceiptFile = await file(
    CAPTURE_RECEIPT_PATH,
    'application/json',
    captureReceiptBytes,
  );
  const receiptEvidence: ProductionWorldEvidence = Object.freeze({
    evidence_id: 'godot-runtime-capture-receipt',
    kind: 'headless-asset-controller-smoke',
    path: captureReceiptFile.path,
    media_type: 'application/json',
    bytes: captureReceiptFile.bytes,
    sha256: captureReceiptFile.sha256,
    claim:
      'Canonical Godot capture receipt binding this review evidence to the exact runtime candidate, layout, overlay, projection, and engine.',
    godot_versions: Object.freeze([input.godotVersion]),
  });
  const review: ProductionWorldReviewContract = Object.freeze({
    ...base.review,
    evidence: Object.freeze([...base.review.evidence, receiptEvidence]),
  });
  try {
    assertProductionWorldReview(review);
  } catch {
    fail(
      'runtime-candidate-technical-review.integrity',
      'Runtime-candidate production review does not satisfy the existing review contract.',
    );
  }
  const reviewFile = await file(
    base.reviewFile.path,
    'application/json',
    new TextEncoder().encode(`${JSON.stringify(review, null, 2)}\n`),
  );
  const baseEvidenceFiles = base.files.filter(
    ({ path }) => path !== base.reviewFile.path,
  );
  return Object.freeze({
    review,
    files: Object.freeze([
      ...baseEvidenceFiles,
      captureReceiptFile,
      reviewFile,
    ]),
    reviewFile,
    captureReceipt,
    captureReceiptFile,
  });
}
