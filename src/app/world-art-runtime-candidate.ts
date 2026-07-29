import {
  buildWorldArtRuntimeOverlayV1_1Zip,
  type BuiltWorldArtRuntimeOverlayV1_1,
} from '../adapters/build-world-art-runtime-overlay-v1-1';
import {
  deriveWorldVisualPlacementPlan,
} from '../adapters/derive-world-visual-placement-plan';
import {
  projectReviewedWorldArtVariants,
  type ProjectedReviewedWorldArtVariants,
} from '../adapters/project-reviewed-world-art-variants';
import type { NormalizedProductionArtResultV1_1 } from '../adapters/normalize-production-art-png-v1-1';
import type { WorldAssetProfile } from '../core/asset-profile';
import type { ProductionArtRights } from '../core/production-art-contract';
import {
  fingerprintProductionArtRunSetV1_1,
} from '../core/production-art-run-set-v1-1';
import {
  buildWorldArtPlacementMap,
  type WorldArtPlacementMap,
} from '../core/world-art-placement-map';
import {
  fingerprintWorldArtRuntimeProjection,
  serializeCanonicalWorldArtRuntimeProjection,
} from '../core/world-art-runtime-projection';
import {
  buildWorldArtVariantMap,
  fingerprintWorldArtVariantMap,
  serializeCanonicalWorldArtVariantMap,
  type ReviewedWorldArtSlotInventory,
  type WorldArtVariantMap,
  type WorldArtVariantMapInput,
  type WorldArtVariantSelection,
} from '../core/world-art-variant-map';
import {
  materializePassedWorldArtSelectionReview,
  serializeCanonicalWorldArtSelectionReview,
  type WorldArtSelectionReview,
  type WorldArtSelectionReviewInput,
} from '../core/world-art-selection-review';
import type {
  WorldVisualPlacementPlan,
} from '../core/world-visual-placement-plan';

export const WORLD_ART_RUNTIME_CANDIDATE_VERSION = '1.0.0' as const;

export interface WorldArtRuntimeCandidateArtifact {
  readonly path: string;
  readonly media_type: 'application/json' | 'application/zip';
  readonly bytes: number;
  readonly sha256: string;
}

export interface WorldArtRuntimeCandidateReceipt {
  readonly schema_version: typeof WORLD_ART_RUNTIME_CANDIDATE_VERSION;
  readonly document_type: 'world-art-runtime-candidate-receipt';
  readonly candidate_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    layout_plan_sha256: string;
    requirements_sha256: string;
    production_art_plan_sha256: string;
    run_set_sha256: string;
    selection_review_sha256: string;
    variant_map_sha256: string;
    runtime_projection_sha256: string;
  }>;
  readonly rights: ProductionArtRights;
  readonly review: Readonly<{
    human_art: 'pass';
    runtime: 'pending';
    raspberry_pi: 'pending';
  }>;
  readonly artifacts: readonly WorldArtRuntimeCandidateArtifact[];
  readonly remote_request_count: 0;
  readonly production_ready: false;
}

export interface WorldArtRuntimeCandidateFile extends WorldArtRuntimeCandidateArtifact {
  readBytes(): Uint8Array;
}

export interface BuiltWorldArtRuntimeCandidate {
  readonly receipt: WorldArtRuntimeCandidateReceipt;
  readonly review: WorldArtSelectionReview & Readonly<{ review_status: 'pass' }>;
  readonly reviewed_slot_inventory: ReviewedWorldArtSlotInventory;
  readonly selections: readonly WorldArtVariantSelection[];
  readonly variant_map: WorldArtVariantMap;
  readonly projected: ProjectedReviewedWorldArtVariants;
  readonly placement_plan: WorldVisualPlacementPlan;
  readonly placement_map: WorldArtPlacementMap;
  readonly overlay: BuiltWorldArtRuntimeOverlayV1_1;
  readonly files: readonly WorldArtRuntimeCandidateFile[];
}

export interface BuildWorldArtRuntimeCandidateInput extends WorldArtSelectionReviewInput {
  readonly selection_review: unknown;
  readonly normalized_results: readonly NormalizedProductionArtResultV1_1[];
}

interface PendingFile {
  readonly path: string;
  readonly media_type: WorldArtRuntimeCandidateArtifact['media_type'];
  readonly bytes: Uint8Array;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Candidate contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) throw new Error('Candidate contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(value)}\n`);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function finalizeFile(value: PendingFile): Promise<WorldArtRuntimeCandidateFile> {
  const snapshot = Uint8Array.from(value.bytes);
  const sha256 = await sha256Bytes(snapshot);
  return Object.freeze({
    path: value.path,
    media_type: value.media_type,
    bytes: snapshot.byteLength,
    sha256,
    readBytes: () => Uint8Array.from(snapshot),
  });
}

export async function buildWorldArtRuntimeCandidate(
  input: BuildWorldArtRuntimeCandidateInput,
): Promise<BuiltWorldArtRuntimeCandidate> {
  const reviewInput: WorldArtSelectionReviewInput = Object.freeze({
    layout_plan: input.layout_plan,
    asset_requirements: input.asset_requirements,
    production_art_plan: input.production_art_plan,
    production_art_run_set: input.production_art_run_set,
  });
  const admitted = await materializePassedWorldArtSelectionReview(
    input.selection_review,
    reviewInput,
  );
  const variantMapInput: WorldArtVariantMapInput = Object.freeze({
    layout_plan: input.layout_plan,
    asset_requirements: input.asset_requirements,
    production_art_plan: input.production_art_plan,
    reviewed_slot_inventory: admitted.reviewed_slot_inventory,
    selections: admitted.selections,
  });
  const variantMap = await buildWorldArtVariantMap(variantMapInput);
  const projected = await projectReviewedWorldArtVariants({
    variantMap,
    variantMapInput,
    requirements: input.asset_requirements,
    plan: input.production_art_plan,
    runSet: input.production_art_run_set,
    normalizedResults: input.normalized_results,
  });
  const placementPlan = await deriveWorldVisualPlacementPlan({
    layout: input.layout_plan,
    requirements: input.asset_requirements,
  });
  const placementMap = await buildWorldArtPlacementMap({
    layout_plan: input.layout_plan,
    placement_plan: placementPlan,
    asset_requirements: input.asset_requirements,
    production_art_plan: input.production_art_plan,
    reviewed_slot_inventory: admitted.reviewed_slot_inventory,
  });
  const overlay = await buildWorldArtRuntimeOverlayV1_1Zip({
    projected,
    layout_plan: input.layout_plan,
    placement_plan: placementPlan,
    placement_map: placementMap,
  });
  const [
    reviewBytes,
    variantMapBytes,
    projectionBytes,
    variantMapSha,
    projectionSha,
    runSetSha,
  ] = await Promise.all([
    serializeCanonicalWorldArtSelectionReview(admitted.review, reviewInput),
    serializeCanonicalWorldArtVariantMap(variantMap, variantMapInput),
    serializeCanonicalWorldArtRuntimeProjection(projected.projection),
    fingerprintWorldArtVariantMap(variantMap, variantMapInput),
    fingerprintWorldArtRuntimeProjection(projected.projection),
    fingerprintProductionArtRunSetV1_1(
      input.production_art_run_set,
      input.production_art_plan,
      input.asset_requirements,
    ),
  ]);
  const files = await Promise.all([
    finalizeFile({
      path: 'world-art-selection-review.json',
      media_type: 'application/json',
      bytes: reviewBytes,
    }),
    finalizeFile({
      path: 'reviewed-world-art-slot-inventory.json',
      media_type: 'application/json',
      bytes: canonicalBytes(admitted.reviewed_slot_inventory),
    }),
    finalizeFile({
      path: 'world-art-variant-selections.json',
      media_type: 'application/json',
      bytes: canonicalBytes(admitted.selections),
    }),
    finalizeFile({
      path: 'world-art-variant-map.json',
      media_type: 'application/json',
      bytes: variantMapBytes,
    }),
    finalizeFile({
      path: 'world-art-runtime-projection.json',
      media_type: 'application/json',
      bytes: projectionBytes,
    }),
    finalizeFile({
      path: overlay.filename,
      media_type: 'application/zip',
      bytes: overlay.readBytes(),
    }),
  ]);
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const source = Object.freeze({
    layout_plan_sha256: admitted.review.source.layout_plan_sha256,
    requirements_sha256: admitted.review.source.requirements_sha256,
    production_art_plan_sha256: admitted.review.source.production_art_plan_sha256,
    run_set_sha256: runSetSha,
    selection_review_sha256: admitted.review_record_sha256,
    variant_map_sha256: variantMapSha,
    runtime_projection_sha256: projectionSha,
  });
  const receiptIdentity = Object.freeze({
    profile: admitted.review.profile,
    source,
    rights: admitted.review.rights,
    artifacts: files.map(({ path, media_type, bytes, sha256 }) => ({
      path,
      media_type,
      bytes,
      sha256,
    })),
  });
  const identitySha = await sha256Bytes(canonicalBytes(receiptIdentity));
  const receipt: WorldArtRuntimeCandidateReceipt = Object.freeze({
    schema_version: WORLD_ART_RUNTIME_CANDIDATE_VERSION,
    document_type: 'world-art-runtime-candidate-receipt',
    candidate_id: `world-art-candidate-${identitySha.slice(0, 16)}`,
    profile: admitted.review.profile,
    source,
    rights: admitted.review.rights,
    review: Object.freeze({
      human_art: 'pass',
      runtime: 'pending',
      raspberry_pi: 'pending',
    }),
    artifacts: Object.freeze(receiptIdentity.artifacts),
    remote_request_count: 0,
    production_ready: false,
  });
  const receiptFile = await finalizeFile({
    path: 'runtime-candidate-receipt.json',
    media_type: 'application/json',
    bytes: canonicalBytes(receipt),
  });
  return Object.freeze({
    receipt,
    review: admitted.review,
    reviewed_slot_inventory: admitted.reviewed_slot_inventory,
    selections: admitted.selections,
    variant_map: variantMap,
    projected,
    placement_plan: placementPlan,
    placement_map: placementMap,
    overlay,
    files: Object.freeze([...files, receiptFile]
      .sort((left, right) => left.path.localeCompare(right.path, 'en'))),
  });
}
