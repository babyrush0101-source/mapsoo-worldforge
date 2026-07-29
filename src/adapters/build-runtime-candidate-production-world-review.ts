import type {
  LoadedWorldArtRuntimeCandidateWorkspace,
} from './load-world-art-runtime-candidate-workspace';
import {
  deriveGodotRuntimeBindingInventoryV1_1,
} from './derive-godot-runtime-binding-inventory-v1-1';
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
  buildGodotRuntimeCaptureReceiptV1_1,
  serializeCanonicalGodotRuntimeCaptureReceiptV1_1,
  type GodotRuntimeCaptureReceiptV1_1,
  type GodotRuntimeCaptureV1_1GodotVersion,
} from '../core/godot-runtime-capture-receipt-v1-1';

export interface RuntimeCandidateCaptureMetrics {
  readonly visible_terrain_materials: number;
  readonly visible_landmarks: number;
  readonly visible_hazards: number;
  readonly visible_characters: number;
  readonly applied_background_layers: number;
  readonly applied_prop_instances: number;
  readonly applied_structure_instances: number;
  readonly applied_effect_bindings: number;
  readonly applied_depth_planes: number;
  readonly route_reached: true;
  readonly catalog_assets: number;
  readonly bound_catalog_assets: number;
  readonly runtime_bindings: number;
  readonly applied_runtime_bindings: number;
  readonly catalog_only_assets: number;
  readonly bindings_sha256: string;
  readonly applied_bindings_sha256: string;
}

export interface BuildRuntimeCandidateProductionWorldReviewInput {
  readonly candidate: LoadedWorldArtRuntimeCandidateWorkspace;
  readonly layoutPlanSha256: string;
  readonly reviewId: string;
  readonly godotVersion: GodotRuntimeCaptureV1_1GodotVersion;
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
  readonly captureReceipt: GodotRuntimeCaptureReceiptV1_1;
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

async function expectedCaptureMetrics(
  candidate: LoadedWorldArtRuntimeCandidateWorkspace,
): Promise<Readonly<{
  metrics: RuntimeCandidateCaptureMetrics;
  expected_bindings: Awaited<
    ReturnType<typeof deriveGodotRuntimeBindingInventoryV1_1>
  >['expected_bindings'];
}>> {
  const inventory = await deriveGodotRuntimeBindingInventoryV1_1({
    projection: candidate.runtime_projection,
    placement_plan: candidate.overlay.placement_plan,
    placement_map: candidate.overlay.placement_map,
  });
  return Object.freeze({
    metrics: Object.freeze({
      visible_terrain_materials: inventory.visible_terrain_materials,
      visible_landmarks: inventory.visible_landmarks,
      visible_hazards: inventory.visible_hazards,
      visible_characters: inventory.visible_characters,
      applied_background_layers: inventory.applied_background_layers,
      applied_prop_instances: inventory.applied_prop_instances,
      applied_structure_instances: inventory.applied_structure_instances,
      applied_effect_bindings: inventory.applied_effect_bindings,
      applied_depth_planes: inventory.applied_depth_planes,
      route_reached: true,
      catalog_assets: inventory.catalog_assets,
      bound_catalog_assets: inventory.bound_catalog_assets,
      runtime_bindings: inventory.expected_bindings.length,
      applied_runtime_bindings: inventory.expected_bindings.length,
      catalog_only_assets: inventory.catalog_only_assets,
      bindings_sha256: inventory.bindings_sha256,
      applied_bindings_sha256: inventory.bindings_sha256,
    }),
    expected_bindings: inventory.expected_bindings,
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
    && left.applied_background_layers === right.applied_background_layers
    && left.applied_prop_instances === right.applied_prop_instances
    && left.applied_structure_instances === right.applied_structure_instances
    && left.applied_effect_bindings === right.applied_effect_bindings
    && left.applied_depth_planes === right.applied_depth_planes
    && left.catalog_assets === right.catalog_assets
    && left.bound_catalog_assets === right.bound_catalog_assets
    && left.runtime_bindings === right.runtime_bindings
    && left.applied_runtime_bindings === right.applied_runtime_bindings
    && left.catalog_only_assets === right.catalog_only_assets
    && left.bindings_sha256 === right.bindings_sha256
    && left.applied_bindings_sha256 === right.applied_bindings_sha256
    && left.route_reached === true
    && right.route_reached === true
  );
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
  const expected = await expectedCaptureMetrics(input.candidate);
  if (!sameMetrics(input.captureMetrics, expected.metrics)) {
    fail(
      'runtime-candidate-technical-review.invalid-capture',
      'Godot capture coverage differs from the exact runtime binding inventory.',
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
  const captureReceipt = await buildGodotRuntimeCaptureReceiptV1_1({
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
      visible_terrain_materials: input.captureMetrics.visible_terrain_materials,
      visible_landmarks: input.captureMetrics.visible_landmarks,
      visible_hazards: input.captureMetrics.visible_hazards,
      visible_characters: input.captureMetrics.visible_characters,
      applied_background_layers: input.captureMetrics.applied_background_layers,
      applied_prop_instances: input.captureMetrics.applied_prop_instances,
      applied_structure_instances:
        input.captureMetrics.applied_structure_instances,
      applied_effect_bindings: input.captureMetrics.applied_effect_bindings,
      applied_depth_planes: input.captureMetrics.applied_depth_planes,
      route_reached: true,
      catalog_assets: input.captureMetrics.catalog_assets,
      bound_catalog_assets: input.captureMetrics.bound_catalog_assets,
      catalog_only_assets: input.captureMetrics.catalog_only_assets,
      expected_bindings: expected.expected_bindings,
      applied_bindings: expected.expected_bindings,
    },
  });
  const captureReceiptBytes =
    await serializeCanonicalGodotRuntimeCaptureReceiptV1_1(captureReceipt);
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
