import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const PRODUCTION_WORLD_REVIEW_VERSION = '1.0.0' as const;

export const PRODUCTION_WORLD_REVIEW_GATES = Object.freeze([
  'image-composition',
  'role-placement',
  'art-to-collision',
  'spawn-exit',
  'navigation',
  'human-review',
] as const);
export type ProductionWorldReviewGate = typeof PRODUCTION_WORLD_REVIEW_GATES[number];

export const PRODUCTION_WORLD_REVIEW_STATUSES = Object.freeze([
  'pending',
  'technical-pass',
  'human-pass',
] as const);
export type ProductionWorldReviewStatus = typeof PRODUCTION_WORLD_REVIEW_STATUSES[number];

export const PRODUCTION_WORLD_EVIDENCE_KINDS = Object.freeze([
  'headless-asset-controller-smoke',
  'rendered-world-capture',
  'role-placement-overlay',
  'art-collision-overlay',
  'spawn-exit-traversal',
  'navigation-traversal',
  'human-review-record',
] as const);
export type ProductionWorldEvidenceKind = typeof PRODUCTION_WORLD_EVIDENCE_KINDS[number];

export interface ProductionWorldEvidence {
  readonly evidence_id: string;
  readonly kind: ProductionWorldEvidenceKind;
  readonly path: string;
  readonly media_type:
    | 'image/png'
    | 'application/json'
    | 'video/mp4'
    | 'video/x-msvideo'
    | 'text/plain';
  readonly bytes: number;
  readonly sha256: string;
  readonly claim: string;
  readonly godot_versions?: readonly ('4.3' | '4.7')[];
  readonly reviewer_id?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface ProductionWorldGateReview {
  readonly gate: ProductionWorldReviewGate;
  readonly status: ProductionWorldReviewStatus;
  readonly evidence_ids: readonly string[];
  readonly note?: string;
}

export interface ProductionWorldReviewContract {
  readonly schema_version: typeof PRODUCTION_WORLD_REVIEW_VERSION;
  readonly review_id: string;
  readonly profile: WorldAssetProfile;
  readonly world_preview: {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
  };
  readonly evidence: readonly ProductionWorldEvidence[];
  readonly gates: readonly ProductionWorldGateReview[];
  readonly release_decision: 'blocked' | 'approved';
}

export interface ProductionWorldReviewIssue {
  readonly code: string;
  readonly message: string;
  readonly gate?: ProductionWorldReviewGate;
  readonly evidence_id?: string;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const EVIDENCE_MEDIA_TYPES = Object.freeze([
  'image/png',
  'application/json',
  'video/mp4',
  'video/x-msvideo',
  'text/plain',
] as const);
const ALLOWED_TECHNICAL_EVIDENCE: Readonly<Record<ProductionWorldReviewGate, readonly ProductionWorldEvidenceKind[]>> =
  Object.freeze({
    'image-composition': Object.freeze(['rendered-world-capture'] as const),
    'role-placement': Object.freeze(['role-placement-overlay'] as const),
    'art-to-collision': Object.freeze(['art-collision-overlay'] as const),
    'spawn-exit': Object.freeze(['spawn-exit-traversal'] as const),
    navigation: Object.freeze(['navigation-traversal'] as const),
    'human-review': Object.freeze([] as const),
  } satisfies Record<ProductionWorldReviewGate, readonly ProductionWorldEvidenceKind[]>);

function safePath(path: string): boolean {
  return path.length <= 240 && SAFE_PATH.test(path);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function exactGateSet(gates: readonly ProductionWorldGateReview[]): boolean {
  return gates.length === PRODUCTION_WORLD_REVIEW_GATES.length
    && new Set(gates.map(({ gate }) => gate)).size === PRODUCTION_WORLD_REVIEW_GATES.length
    && PRODUCTION_WORLD_REVIEW_GATES.every((gate) => gates.some((candidate) => candidate.gate === gate));
}

function validateEvidenceRecord(
  evidence: ProductionWorldEvidence,
  issues: ProductionWorldReviewIssue[],
  ids: Set<string>,
  paths: Set<string>,
): void {
  if (!SAFE_ID.test(evidence.evidence_id) || evidence.evidence_id.length > 100 || ids.has(evidence.evidence_id)) {
    issues.push({
      code: 'evidence.id',
      message: 'Evidence ids must be unique bounded safe identifiers.',
      evidence_id: evidence.evidence_id,
    });
  }
  ids.add(evidence.evidence_id);
  if (!PRODUCTION_WORLD_EVIDENCE_KINDS.includes(evidence.kind)) {
    issues.push({
      code: 'evidence.kind',
      message: 'Evidence kind is unsupported.',
      evidence_id: evidence.evidence_id,
    });
  }
  if (!safePath(evidence.path) || paths.has(evidence.path)) {
    issues.push({
      code: 'evidence.path',
      message: 'Evidence paths must be unique safe relative paths.',
      evidence_id: evidence.evidence_id,
    });
  }
  if (
    (evidence.media_type === 'image/png' && !evidence.path.endsWith('.png'))
    || (
      evidence.media_type === 'application/json'
      && !evidence.path.endsWith('.json')
    )
    || (evidence.media_type === 'video/mp4' && !evidence.path.endsWith('.mp4'))
    || (
      evidence.media_type === 'video/x-msvideo'
      && !evidence.path.endsWith('.avi')
    )
  ) {
    issues.push({
      code: 'evidence.media-path',
      message: 'Evidence media type must match its portable file extension.',
      evidence_id: evidence.evidence_id,
    });
  }
  paths.add(evidence.path);
  if (!EVIDENCE_MEDIA_TYPES.includes(evidence.media_type)
    || !integer(evidence.bytes, 1, 128 * 1024 * 1024)
    || !SHA256.test(evidence.sha256)) {
    issues.push({
      code: 'evidence.integrity',
      message: 'Evidence requires bounded bytes and a lowercase SHA-256.',
      evidence_id: evidence.evidence_id,
    });
  }
  if (evidence.claim.length < 10 || evidence.claim.length > 500 || evidence.claim.trim() !== evidence.claim) {
    issues.push({
      code: 'evidence.claim',
      message: 'Evidence claim must be descriptive, bounded, and trimmed.',
      evidence_id: evidence.evidence_id,
    });
  }
  const isRaster = evidence.media_type === 'image/png';
  const hasDimensions = evidence.width !== undefined || evidence.height !== undefined;
  if (isRaster !== hasDimensions
    || (isRaster && (!integer(evidence.width, 1, 8192) || !integer(evidence.height, 1, 8192)))) {
    issues.push({
      code: 'evidence.dimensions',
      message: 'PNG evidence requires bounded width and height; non-PNG evidence forbids them.',
      evidence_id: evidence.evidence_id,
    });
  }
  if (evidence.godot_versions !== undefined && (
    evidence.godot_versions.length < 1
    || evidence.godot_versions.length > 2
    || new Set(evidence.godot_versions).size !== evidence.godot_versions.length
    || evidence.godot_versions.some((version) => version !== '4.3' && version !== '4.7')
  )) {
    issues.push({
      code: 'evidence.godot-versions',
      message: 'Godot evidence may declare unique supported 4.3 and 4.7 versions.',
      evidence_id: evidence.evidence_id,
    });
  }
  if (evidence.kind !== 'human-review-record'
    && (!evidence.godot_versions || evidence.godot_versions.length < 1)) {
    issues.push({
      code: 'evidence.technical-version',
      message: 'Technical evidence must bind at least one tested Godot version.',
      evidence_id: evidence.evidence_id,
    });
  }
  const imageEvidenceKinds: readonly ProductionWorldEvidenceKind[] = [
    'rendered-world-capture',
    'role-placement-overlay',
    'art-collision-overlay',
  ];
  const videoEvidenceKinds: readonly ProductionWorldEvidenceKind[] = [
    'spawn-exit-traversal',
    'navigation-traversal',
  ];
  if (imageEvidenceKinds.includes(evidence.kind) && evidence.media_type !== 'image/png') {
    issues.push({
      code: 'evidence.media-type',
      message: 'Rendered and overlay evidence must be a dimension-bound PNG.',
      evidence_id: evidence.evidence_id,
    });
  }
  if (
    videoEvidenceKinds.includes(evidence.kind)
    && evidence.media_type !== 'video/mp4'
    && evidence.media_type !== 'video/x-msvideo'
  ) {
    issues.push({
      code: 'evidence.media-type',
      message: 'Traversal evidence must be an MP4 or Godot-native AVI recording.',
      evidence_id: evidence.evidence_id,
    });
  }
  if (evidence.kind === 'headless-asset-controller-smoke'
    && evidence.media_type !== 'application/json'
    && evidence.media_type !== 'text/plain') {
    issues.push({
      code: 'evidence.media-type',
      message: 'Headless smoke evidence must be a JSON record or text transcript.',
      evidence_id: evidence.evidence_id,
    });
  }
  if (evidence.kind === 'human-review-record') {
    if (!evidence.reviewer_id
      || !SAFE_ID.test(evidence.reviewer_id)
      || evidence.reviewer_id.length > 100
      || evidence.media_type !== 'application/json') {
      issues.push({
        code: 'evidence.human-review',
        message: 'Human review evidence requires an opaque reviewer id and JSON record.',
        evidence_id: evidence.evidence_id,
      });
    }
  } else if (evidence.reviewer_id !== undefined) {
    issues.push({
      code: 'evidence.reviewer',
      message: 'Only human review records may declare a reviewer id.',
      evidence_id: evidence.evidence_id,
    });
  }
}

function validateGate(
  gate: ProductionWorldGateReview,
  evidence: ReadonlyMap<string, ProductionWorldEvidence>,
  issues: ProductionWorldReviewIssue[],
): void {
  if (!PRODUCTION_WORLD_REVIEW_STATUSES.includes(gate.status)) {
    issues.push({ code: 'gate.status', message: 'Review gate status is unsupported.', gate: gate.gate });
  }
  if (gate.note !== undefined
    && (gate.note.length < 1 || gate.note.length > 500 || gate.note.trim() !== gate.note)) {
    issues.push({ code: 'gate.note', message: 'Gate note must be non-empty, bounded, and trimmed.', gate: gate.gate });
  }
  if (new Set(gate.evidence_ids).size !== gate.evidence_ids.length) {
    issues.push({ code: 'gate.evidence-duplicate', message: 'Gate evidence ids must be unique.', gate: gate.gate });
  }
  const records: ProductionWorldEvidence[] = [];
  for (const id of gate.evidence_ids) {
    const record = evidence.get(id);
    if (!record) {
      issues.push({
        code: 'gate.evidence-missing',
        message: 'Gate references unknown evidence.',
        gate: gate.gate,
        evidence_id: id,
      });
    } else {
      records.push(record);
    }
  }

  if (gate.status === 'pending') return;
  if (gate.gate === 'human-review' && gate.status === 'technical-pass') {
    issues.push({
      code: 'gate.human-review-technical',
      message: 'Human review cannot be satisfied by a technical pass.',
      gate: gate.gate,
    });
    return;
  }
  if (records.some(({ kind }) => kind === 'headless-asset-controller-smoke')) {
    issues.push({
      code: 'gate.headless-smoke',
      message: 'Headless decode/controller smoke cannot be cited by a passing visual, collision, traversal, or human gate.',
      gate: gate.gate,
    });
  }
  const allowed = ALLOWED_TECHNICAL_EVIDENCE[gate.gate];
  if (gate.gate !== 'human-review' && !records.some(({ kind }) => allowed.includes(kind))) {
    issues.push({
      code: 'gate.technical-evidence',
      message: 'Passing gate lacks the required gate-specific technical evidence.',
      gate: gate.gate,
    });
  }
  if (gate.status === 'human-pass'
    && !records.some(({ kind }) => kind === 'human-review-record')) {
    issues.push({
      code: 'gate.human-evidence',
      message: 'Human pass requires a bound human review record.',
      gate: gate.gate,
    });
  }
}

export function validateProductionWorldReview(
  contract: ProductionWorldReviewContract,
): ProductionWorldReviewIssue[] {
  const issues: ProductionWorldReviewIssue[] = [];
  if (contract.schema_version !== PRODUCTION_WORLD_REVIEW_VERSION) {
    issues.push({ code: 'review.schema', message: 'Production world review schema is unsupported.' });
  }
  if (!SAFE_ID.test(contract.review_id) || contract.review_id.length > 100) {
    issues.push({ code: 'review.id', message: 'Review id must be a bounded safe identifier.' });
  }
  if (!isWorldAssetProfile(contract.profile)) {
    issues.push({ code: 'review.profile', message: 'Review profile is unsupported.' });
  }
  if (contract.release_decision !== 'blocked' && contract.release_decision !== 'approved') {
    issues.push({ code: 'review.release-decision', message: 'Release decision is unsupported.' });
  }
  if (!safePath(contract.world_preview.path)
    || !contract.world_preview.path.endsWith('.png')
    || !integer(contract.world_preview.bytes, 1, 64 * 1024 * 1024)
    || !SHA256.test(contract.world_preview.sha256)
    || !integer(contract.world_preview.width, 1, 8192)
    || !integer(contract.world_preview.height, 1, 8192)) {
    issues.push({ code: 'review.preview', message: 'World preview must be a bounded, hash-bound safe PNG.' });
  }
  const ids = new Set<string>();
  const paths = new Set<string>([contract.world_preview.path]);
  const evidence = new Map<string, ProductionWorldEvidence>();
  for (const record of contract.evidence) {
    validateEvidenceRecord(record, issues, ids, paths);
    if (!evidence.has(record.evidence_id)) evidence.set(record.evidence_id, record);
  }
  if (!exactGateSet(contract.gates)) {
    issues.push({ code: 'review.gates', message: 'Review must contain each canonical gate exactly once.' });
  }
  for (const gate of contract.gates) validateGate(gate, evidence, issues);

  const allPassed = PRODUCTION_WORLD_REVIEW_GATES.every((requiredGate) => {
    const gate = contract.gates.find(({ gate: candidate }) => candidate === requiredGate);
    return gate?.status === 'technical-pass' || gate?.status === 'human-pass';
  });
  const humanReviewPassed = contract.gates.find(({ gate }) => gate === 'human-review')?.status === 'human-pass';
  if (contract.release_decision === 'approved' && (!allPassed || !humanReviewPassed)) {
    issues.push({
      code: 'review.release-decision',
      message: 'Release approval requires every gate to pass and explicit human review.',
    });
  }
  if (contract.release_decision === 'blocked' && allPassed && humanReviewPassed) {
    issues.push({
      code: 'review.release-decision',
      message: 'A fully passed review cannot remain blocked.',
    });
  }
  return issues;
}

export function assertProductionWorldReview(
  contract: ProductionWorldReviewContract,
): void {
  const issues = validateProductionWorldReview(contract);
  if (issues.length > 0) {
    throw new Error(`Invalid production world review: ${issues.map(({ code }) => code).join(', ')}.`);
  }
}
