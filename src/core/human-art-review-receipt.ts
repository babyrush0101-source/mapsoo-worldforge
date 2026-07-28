import {
  assertProductionWorldReview,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from './production-world-review-contract';
import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const HUMAN_ART_REVIEW_RECEIPT_VERSION = '1.0.0' as const;
export const HUMAN_ART_REVIEW_ATTESTATION =
  'I personally inspected the bound exported assets and Godot capture.' as const;

export const HUMAN_ART_REVIEW_CRITERIA = Object.freeze([
  'art-direction.coherence',
  'world.scale-coherence',
  'world.route-readability',
  'terrain.transition-quality',
  'asset.role-readability',
  'asset.edge-cleanliness',
  'character.identity-continuity',
  'character.scale-and-pivot',
  'character.action-readability',
  'character.direction-readability',
  'animation.loop-and-contact',
  'collision.visual-alignment',
  'originality.no-recognizable-copy',
  'rights.source-authority',
  'rights.output-permission',
] as const);
export type HumanArtReviewCriterion = typeof HUMAN_ART_REVIEW_CRITERIA[number];

export const HUMAN_ART_REVIEW_STATUSES = Object.freeze([
  'pass',
  'revise',
  'not-reviewed',
] as const);
export type HumanArtReviewStatus = typeof HUMAN_ART_REVIEW_STATUSES[number];

export interface HumanArtReviewCriterionDecision {
  readonly criterion: HumanArtReviewCriterion;
  readonly status: HumanArtReviewStatus;
  readonly note?: string;
}

export interface HumanArtReviewReceipt {
  readonly schema_version: typeof HUMAN_ART_REVIEW_RECEIPT_VERSION;
  readonly document_type: 'human-art-review-receipt';
  readonly review_id: string;
  readonly profile: WorldAssetProfile;
  readonly reviewer_id: string;
  readonly reviewed_at: string;
  readonly review_method: 'human-visual-inspection';
  readonly bindings: Readonly<{
    production_world_review_id: string;
    world_preview_sha256: string;
    godot_capture_sha256: string;
    runtime_projection_sha256: string;
    runtime_overlay_sha256: string;
    character_identity_binding_sha256: string;
  }>;
  readonly criteria: readonly HumanArtReviewCriterionDecision[];
  readonly requested_revisions: readonly string[];
  readonly rights: Readonly<{
    distribution: 'internal-review' | 'private' | 'public';
    output_license_id:
      | 'LicenseRef-UNRELEASED'
      | 'LicenseRef-Proprietary'
      | 'LicenseRef-User-Owned'
      | 'CC0-1.0'
      | 'CC-BY-4.0'
      | 'CC-BY-SA-4.0';
    permits_redistribution: boolean;
    source_authority_confirmed: boolean;
    attribution?: string;
  }>;
  readonly decision: 'blocked' | 'approved-private' | 'approved-public';
  readonly attestation: typeof HUMAN_ART_REVIEW_ATTESTATION;
}

export interface HumanArtReviewIssue {
  readonly code: string;
  readonly message: string;
  readonly criterion?: HumanArtReviewCriterion;
}

export interface HumanArtReviewBindings {
  readonly production_world_review_id: string;
  readonly world_preview_sha256: string;
  readonly godot_capture_sha256: string;
  readonly runtime_projection_sha256: string;
  readonly runtime_overlay_sha256: string;
  readonly character_identity_binding_sha256: string;
}

export interface ApprovedProductionWorldReview {
  readonly review: ProductionWorldReviewContract;
  readonly human_review: Readonly<{
    receipt_path: string;
    receipt_sha256: string;
    reviewer_id: string;
    reviewed_at: string;
    decision: 'approved-private' | 'approved-public';
  }>;
  readonly authorization: HumanArtReviewReceipt['rights'];
}

export class HumanArtReviewPromotionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HumanArtReviewPromotionError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PRIVATE_LICENSES = Object.freeze([
  'LicenseRef-Proprietary',
  'LicenseRef-User-Owned',
] as const);
const PUBLIC_LICENSES = Object.freeze([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
] as const);
const RECEIPT_KEYS = Object.freeze([
  'schema_version',
  'document_type',
  'review_id',
  'profile',
  'reviewer_id',
  'reviewed_at',
  'review_method',
  'bindings',
  'criteria',
  'requested_revisions',
  'rights',
  'decision',
  'attestation',
] as const satisfies readonly (keyof HumanArtReviewReceipt)[]);
const BINDING_KEYS = Object.freeze([
  'production_world_review_id',
  'world_preview_sha256',
  'godot_capture_sha256',
  'runtime_projection_sha256',
  'runtime_overlay_sha256',
  'character_identity_binding_sha256',
] as const satisfies readonly (keyof HumanArtReviewBindings)[]);
const CRITERION_KEYS = Object.freeze([
  'criterion',
  'status',
] as const);
const RIGHTS_KEYS = Object.freeze([
  'distribution',
  'output_license_id',
  'permits_redistribution',
  'source_authority_confirmed',
] as const);

function boundedText(value: string, maximum = 500): boolean {
  return value.length >= 1
    && value.length <= maximum
    && value.trim() === value
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);
}

function exactCriterionSet(
  criteria: readonly HumanArtReviewCriterionDecision[],
): boolean {
  return criteria.length === HUMAN_ART_REVIEW_CRITERIA.length
    && new Set(criteria.map(({ criterion }) => criterion)).size
      === HUMAN_ART_REVIEW_CRITERIA.length
    && HUMAN_ART_REVIEW_CRITERIA.every((criterion) =>
      criteria.some((candidate) => candidate.criterion === criterion));
}

function hasOnlyKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => allowed.has(key));
}

function validateRights(
  receipt: HumanArtReviewReceipt,
  issues: HumanArtReviewIssue[],
): void {
  const { rights, decision } = receipt;
  if (decision === 'blocked') {
    if (
      rights.distribution !== 'internal-review'
      || rights.output_license_id !== 'LicenseRef-UNRELEASED'
      || rights.permits_redistribution
    ) {
      issues.push({
        code: 'rights.blocked-boundary',
        message: 'Blocked art must remain internal-review, unreleased, and non-redistributable.',
      });
    }
    return;
  }
  if (!rights.source_authority_confirmed) {
    issues.push({
      code: 'rights.source-authority',
      message: 'Approval requires a human confirmation of source authority.',
    });
  }
  if (decision === 'approved-private') {
    if (
      rights.distribution !== 'private'
      || !(PRIVATE_LICENSES as readonly string[]).includes(rights.output_license_id)
      || rights.permits_redistribution
      || rights.attribution !== undefined
    ) {
      issues.push({
        code: 'rights.private-boundary',
        message: 'Private approval requires a private, non-redistributable private-use license.',
      });
    }
    return;
  }
  if (
    rights.distribution !== 'public'
    || !(PUBLIC_LICENSES as readonly string[]).includes(rights.output_license_id)
    || !rights.permits_redistribution
  ) {
    issues.push({
      code: 'rights.public-boundary',
      message: 'Public approval requires an allowlisted public license and redistribution permission.',
    });
  }
  if (
    rights.output_license_id !== 'CC0-1.0'
    && (rights.attribution === undefined || !boundedText(rights.attribution, 500))
  ) {
    issues.push({
      code: 'rights.attribution',
      message: 'Attribution licenses require a bounded attribution statement.',
    });
  }
}

export function validateHumanArtReviewReceipt(
  receipt: HumanArtReviewReceipt,
): HumanArtReviewIssue[] {
  const issues: HumanArtReviewIssue[] = [];
  if (!hasOnlyKeys(receipt, RECEIPT_KEYS)) {
    issues.push({
      code: 'receipt.fields',
      message: 'Human art receipts forbid undeclared fields and require every canonical field.',
    });
  }
  if (receipt.schema_version !== HUMAN_ART_REVIEW_RECEIPT_VERSION) {
    issues.push({ code: 'receipt.schema', message: 'Human art review schema is unsupported.' });
  }
  if (receipt.document_type !== 'human-art-review-receipt') {
    issues.push({ code: 'receipt.type', message: 'Human art review document type is unsupported.' });
  }
  if (!SAFE_ID.test(receipt.review_id) || receipt.review_id.length > 100) {
    issues.push({ code: 'receipt.id', message: 'Review id must be a bounded safe identifier.' });
  }
  if (!isWorldAssetProfile(receipt.profile)) {
    issues.push({ code: 'receipt.profile', message: 'Review profile is unsupported.' });
  }
  if (!SAFE_ID.test(receipt.reviewer_id) || receipt.reviewer_id.length > 100) {
    issues.push({
      code: 'receipt.reviewer',
      message: 'Reviewer id must be opaque bounded kebab-case.',
    });
  }
  if (
    !CANONICAL_UTC.test(receipt.reviewed_at)
    || Number.isNaN(Date.parse(receipt.reviewed_at))
    || new Date(receipt.reviewed_at).toISOString() !== receipt.reviewed_at
  ) {
    issues.push({
      code: 'receipt.reviewed-at',
      message: 'Review time must be canonical UTC with milliseconds.',
    });
  }
  if (receipt.review_method !== 'human-visual-inspection') {
    issues.push({
      code: 'receipt.method',
      message: 'Only a human visual inspection may satisfy this receipt.',
    });
  }
  if (receipt.attestation !== HUMAN_ART_REVIEW_ATTESTATION) {
    issues.push({
      code: 'receipt.attestation',
      message: 'The exact personal-inspection attestation is required.',
    });
  }
  if (!hasOnlyKeys(receipt.bindings, BINDING_KEYS)) {
    issues.push({
      code: 'binding.coverage',
      message: 'Every exact world, runtime, and character artifact binding is required.',
    });
  }
  for (const [name, value] of Object.entries(receipt.bindings)) {
    if (name === 'production_world_review_id') {
      if (!SAFE_ID.test(value) || value.length > 100) {
        issues.push({ code: 'binding.review', message: 'Bound production review id is invalid.' });
      }
    } else if (!SHA256.test(value)) {
      issues.push({ code: 'binding.sha256', message: `${name} must be a lowercase SHA-256.` });
    }
  }
  if (!exactCriterionSet(receipt.criteria)) {
    issues.push({
      code: 'criteria.coverage',
      message: 'Every canonical art, character, originality, and rights criterion is required exactly once.',
    });
  }
  for (const criterion of receipt.criteria) {
    if (!hasOnlyKeys(criterion, CRITERION_KEYS, ['note'])) {
      issues.push({
        code: 'criterion.fields',
        message: 'Criterion decisions forbid undeclared fields.',
        criterion: criterion.criterion,
      });
    }
    if (!HUMAN_ART_REVIEW_CRITERIA.includes(criterion.criterion)) {
      issues.push({
        code: 'criterion.name',
        message: 'Review criterion is unsupported.',
        criterion: criterion.criterion,
      });
    }
    if (!HUMAN_ART_REVIEW_STATUSES.includes(criterion.status)) {
      issues.push({
        code: 'criterion.status',
        message: 'Review criterion status is unsupported.',
        criterion: criterion.criterion,
      });
    }
    if (criterion.note !== undefined && !boundedText(criterion.note)) {
      issues.push({
        code: 'criterion.note',
        message: 'Criterion note must be bounded, printable, and trimmed.',
        criterion: criterion.criterion,
      });
    }
    if (criterion.status === 'revise' && criterion.note === undefined) {
      issues.push({
        code: 'criterion.revision-note',
        message: 'A revise decision requires a concrete note.',
        criterion: criterion.criterion,
      });
    }
  }
  if (
    receipt.requested_revisions.length > 64
    || receipt.requested_revisions.some((revision) => !boundedText(revision))
    || new Set(receipt.requested_revisions).size !== receipt.requested_revisions.length
  ) {
    issues.push({
      code: 'receipt.revisions',
      message: 'Requested revisions must be unique bounded statements.',
    });
  }
  const allPassed = receipt.criteria.length === HUMAN_ART_REVIEW_CRITERIA.length
    && receipt.criteria.every(({ status }) => status === 'pass');
  if (receipt.decision === 'blocked') {
    if (allPassed && receipt.requested_revisions.length === 0) {
      issues.push({
        code: 'receipt.decision',
        message: 'A fully passed receipt with no requested revisions cannot remain blocked.',
      });
    }
  } else if (
    (receipt.decision !== 'approved-private' && receipt.decision !== 'approved-public')
    || !allPassed
    || receipt.requested_revisions.length > 0
  ) {
    issues.push({
      code: 'receipt.decision',
      message: 'Approval requires every criterion to pass and no requested revisions.',
    });
  }
  if (!hasOnlyKeys(receipt.rights, RIGHTS_KEYS, ['attribution'])) {
    issues.push({
      code: 'rights.fields',
      message: 'Rights decisions forbid undeclared fields.',
    });
  }
  validateRights(receipt, issues);
  return issues;
}

export function assertHumanArtReviewReceipt(
  receipt: HumanArtReviewReceipt,
): void {
  const issues = validateHumanArtReviewReceipt(receipt);
  if (issues.length > 0) {
    throw new Error(`Invalid human art review receipt: ${issues.map(({ code }) => code).join(', ')}.`);
  }
}

export function createHumanArtReviewTemplate(input: Readonly<{
  reviewId: string;
  profile: WorldAssetProfile;
  reviewerId: string;
  reviewedAt: string;
  bindings: HumanArtReviewBindings;
}>): HumanArtReviewReceipt {
  const receipt: HumanArtReviewReceipt = Object.freeze({
    schema_version: HUMAN_ART_REVIEW_RECEIPT_VERSION,
    document_type: 'human-art-review-receipt',
    review_id: input.reviewId,
    profile: input.profile,
    reviewer_id: input.reviewerId,
    reviewed_at: input.reviewedAt,
    review_method: 'human-visual-inspection',
    bindings: Object.freeze({ ...input.bindings }),
    criteria: Object.freeze(HUMAN_ART_REVIEW_CRITERIA.map((criterion) =>
      Object.freeze({ criterion, status: 'not-reviewed' as const }))),
    requested_revisions: Object.freeze([]),
    rights: Object.freeze({
      distribution: 'internal-review',
      output_license_id: 'LicenseRef-UNRELEASED',
      permits_redistribution: false,
      source_authority_confirmed: false,
    }),
    decision: 'blocked',
    attestation: HUMAN_ART_REVIEW_ATTESTATION,
  });
  assertHumanArtReviewReceipt(receipt);
  return receipt;
}

export function encodeHumanArtReviewReceipt(
  receipt: HumanArtReviewReceipt,
): Uint8Array {
  assertHumanArtReviewReceipt(receipt);
  return new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fail(code: string, message: string): never {
  throw new HumanArtReviewPromotionError(code, message);
}

export async function promoteProductionWorldReview(input: Readonly<{
  review: ProductionWorldReviewContract;
  receipt: HumanArtReviewReceipt;
  expectedBindings: HumanArtReviewBindings;
  receiptPath: string;
  receiptBytes: Uint8Array;
}>): Promise<ApprovedProductionWorldReview> {
  try {
    assertProductionWorldReview(input.review);
  } catch {
    return fail('promotion.world-review', 'Production world review is invalid.');
  }
  try {
    assertHumanArtReviewReceipt(input.receipt);
  } catch {
    return fail('promotion.human-review', 'Human art review receipt is invalid.');
  }
  if (input.receipt.decision === 'blocked') {
    fail('promotion.decision', 'A blocked human review cannot authorize delivery.');
  }
  if (
    input.review.release_decision !== 'blocked'
    || input.review.gates.some(({ gate, status }) =>
      gate === 'human-review' ? status !== 'pending' : status === 'pending')
  ) {
    fail(
      'promotion.review-state',
      'Promotion requires a blocked review with complete technical gates and a pending human gate.',
    );
  }
  if (
    input.receipt.profile !== input.review.profile
    || input.expectedBindings.production_world_review_id !== input.review.review_id
    || input.expectedBindings.world_preview_sha256 !== input.review.world_preview.sha256
    || BINDING_KEYS.some((name) =>
      input.receipt.bindings[name] !== input.expectedBindings[name])
  ) {
    fail(
      'promotion.binding',
      'Human review receipt does not bind the exact profile, review, and world preview.',
    );
  }
  if (
    !SAFE_PATH.test(input.receiptPath)
    || input.receiptPath.length > 240
    || !input.receiptPath.endsWith('.json')
  ) {
    fail('promotion.path', 'Human review receipt path must be a safe relative JSON path.');
  }
  const canonicalBytes = encodeHumanArtReviewReceipt(input.receipt);
  if (
    input.receiptBytes.byteLength !== canonicalBytes.byteLength
    || input.receiptBytes.some((byte, index) => byte !== canonicalBytes[index])
  ) {
    fail('promotion.bytes', 'Human review receipt bytes are not the canonical bound record.');
  }
  const receiptSha256 = await sha256(canonicalBytes);
  const evidenceId = `${input.receipt.review_id}-record`;
  if (
    input.review.evidence.some(({ evidence_id: id }) => id === evidenceId)
    || input.review.evidence.some(({ path }) => path === input.receiptPath)
  ) {
    fail('promotion.evidence-conflict', 'Human review evidence id or path already exists.');
  }
  const humanEvidence: ProductionWorldEvidence = Object.freeze({
    evidence_id: evidenceId,
    kind: 'human-review-record',
    path: input.receiptPath,
    media_type: 'application/json',
    bytes: canonicalBytes.byteLength,
    sha256: receiptSha256,
    claim: 'Human visual inspection of the exact bound world art, character continuity, originality, and rights.',
    reviewer_id: input.receipt.reviewer_id,
  });
  const review: ProductionWorldReviewContract = Object.freeze({
    ...input.review,
    evidence: Object.freeze([...input.review.evidence, humanEvidence]),
    gates: Object.freeze(input.review.gates.map((gate) =>
      gate.gate === 'human-review'
        ? Object.freeze({
          gate: 'human-review' as const,
          status: 'human-pass' as const,
          evidence_ids: Object.freeze([evidenceId]),
        })
        : gate)),
    release_decision: 'approved',
  });
  try {
    assertProductionWorldReview(review);
  } catch {
    return fail('promotion.result', 'Promoted production world review is invalid.');
  }
  return Object.freeze({
    review,
    human_review: Object.freeze({
      receipt_path: input.receiptPath,
      receipt_sha256: receiptSha256,
      reviewer_id: input.receipt.reviewer_id,
      reviewed_at: input.receipt.reviewed_at,
      decision: input.receipt.decision,
    }),
    authorization: input.receipt.rights,
  });
}
