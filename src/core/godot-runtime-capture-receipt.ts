import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const GODOT_RUNTIME_CAPTURE_RECEIPT_VERSION = '1.0.0' as const;
export const GODOT_RUNTIME_CAPTURE_GODOT_VERSIONS =
  Object.freeze(['4.3', '4.7'] as const);
export type GodotRuntimeCaptureGodotVersion =
  typeof GODOT_RUNTIME_CAPTURE_GODOT_VERSIONS[number];

export const GODOT_RUNTIME_CAPTURE_EVIDENCE = Object.freeze([
  Object.freeze({
    kind: 'rendered-world-capture',
    path: 'review-evidence/rendered-world-capture.png',
    media_type: 'image/png',
  }),
  Object.freeze({
    kind: 'role-placement-overlay',
    path: 'review-evidence/role-placement-overlay.png',
    media_type: 'image/png',
  }),
  Object.freeze({
    kind: 'art-collision-overlay',
    path: 'review-evidence/art-collision-overlay.png',
    media_type: 'image/png',
  }),
  Object.freeze({
    kind: 'spawn-exit-traversal',
    path: 'review-evidence/spawn-exit-traversal.avi',
    media_type: 'video/x-msvideo',
  }),
  Object.freeze({
    kind: 'navigation-traversal',
    path: 'review-evidence/navigation-traversal.avi',
    media_type: 'video/x-msvideo',
  }),
] as const);

export type GodotRuntimeCaptureEvidenceKind =
  typeof GODOT_RUNTIME_CAPTURE_EVIDENCE[number]['kind'];
export type GodotRuntimeCaptureEvidenceMediaType =
  typeof GODOT_RUNTIME_CAPTURE_EVIDENCE[number]['media_type'];

export interface GodotRuntimeCaptureEvidence {
  readonly kind: GodotRuntimeCaptureEvidenceKind;
  readonly path: string;
  readonly media_type: GodotRuntimeCaptureEvidenceMediaType;
  readonly bytes: number;
  readonly sha256: string;
}

export interface GodotRuntimeCaptureSource {
  readonly candidate_id: string;
  readonly candidate_receipt_sha256: string;
  readonly layout_plan_sha256: string;
  readonly runtime_overlay_id: string;
  readonly runtime_overlay_sha256: string;
  readonly runtime_projection_id: string;
  readonly runtime_projection_sha256: string;
}

export interface GodotRuntimeCaptureEngine {
  readonly godot_version: GodotRuntimeCaptureGodotVersion;
  readonly executable_sha256: string;
}

export interface GodotRuntimeCaptureRuntime {
  readonly visible_terrain_materials: number;
  readonly visible_landmarks: number;
  readonly visible_hazards: number;
  readonly visible_characters: number;
  readonly route_reached: true;
  readonly catalog_assets: number;
  readonly runtime_bindings: number;
  readonly catalog_only_assets: number;
  readonly all_required_bindings_applied: true;
}

export interface GodotRuntimeCaptureClaims {
  readonly runtime: 'technical-pass';
  readonly raspberry_pi: 'pending';
  readonly production_ready: false;
  readonly remote_request_count: 0;
}

export interface GodotRuntimeCaptureReceipt {
  readonly schema_version: typeof GODOT_RUNTIME_CAPTURE_RECEIPT_VERSION;
  readonly document_type: 'godot-runtime-capture-receipt';
  readonly capture_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: GodotRuntimeCaptureSource;
  readonly engine: GodotRuntimeCaptureEngine;
  readonly evidence: readonly GodotRuntimeCaptureEvidence[];
  readonly runtime: GodotRuntimeCaptureRuntime;
  readonly claims: GodotRuntimeCaptureClaims;
}

export interface BuildGodotRuntimeCaptureReceiptInput {
  readonly profile: WorldAssetProfile;
  readonly source: GodotRuntimeCaptureSource;
  readonly engine: GodotRuntimeCaptureEngine;
  readonly evidence: readonly GodotRuntimeCaptureEvidence[];
  readonly runtime: GodotRuntimeCaptureRuntime;
}

export type GodotRuntimeCaptureReceiptErrorCode =
  | 'godot-runtime-capture.invalid-shape'
  | 'godot-runtime-capture.invalid-value'
  | 'godot-runtime-capture.invalid-binding'
  | 'godot-runtime-capture.invalid-evidence'
  | 'godot-runtime-capture.invalid-order'
  | 'godot-runtime-capture.invalid-claims'
  | 'godot-runtime-capture.invalid-id';

export class GodotRuntimeCaptureReceiptError extends Error {
  constructor(
    readonly code: GodotRuntimeCaptureReceiptErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GodotRuntimeCaptureReceiptError';
  }
}

type MutableRecord = Record<string, unknown>;
type GodotRuntimeCaptureReceiptDraft = Omit<
  GodotRuntimeCaptureReceipt,
  'capture_id'
>;

const SHA256 = /^[a-f0-9]{64}$/;
const CANDIDATE_ID = /^world-art-candidate-[a-f0-9]{16}$/;
const OVERLAY_ID = /^world-art-runtime-overlay-[a-f0-9]{16}$/;
const PROJECTION_ID = /^world-art-runtime-projection-[a-f0-9]{16}$/;
const CAPTURE_ID = /^godot-runtime-capture-[a-f0-9]{16}$/;
const ROOT_KEYS = Object.freeze([
  'schema_version',
  'document_type',
  'capture_id',
  'profile',
  'source',
  'engine',
  'evidence',
  'runtime',
  'claims',
] as const);
const BUILD_INPUT_KEYS = Object.freeze([
  'profile',
  'source',
  'engine',
  'evidence',
  'runtime',
] as const);
const SOURCE_KEYS = Object.freeze([
  'candidate_id',
  'candidate_receipt_sha256',
  'layout_plan_sha256',
  'runtime_overlay_id',
  'runtime_overlay_sha256',
  'runtime_projection_id',
  'runtime_projection_sha256',
] as const);
const ENGINE_KEYS = Object.freeze([
  'godot_version',
  'executable_sha256',
] as const);
const EVIDENCE_KEYS = Object.freeze([
  'kind',
  'path',
  'media_type',
  'bytes',
  'sha256',
] as const);
const RUNTIME_KEYS = Object.freeze([
  'visible_terrain_materials',
  'visible_landmarks',
  'visible_hazards',
  'visible_characters',
  'route_reached',
  'catalog_assets',
  'runtime_bindings',
  'catalog_only_assets',
  'all_required_bindings_applied',
] as const);
const CLAIM_KEYS = Object.freeze([
  'runtime',
  'raspberry_pi',
  'production_ready',
  'remote_request_count',
] as const);

function fail(
  code: GodotRuntimeCaptureReceiptErrorCode,
  message: string,
): never {
  throw new GodotRuntimeCaptureReceiptError(code, message);
}

function record(value: unknown): value is MutableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(
  value: MutableRecord,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      'godot-runtime-capture.invalid-shape',
      `${label} must contain exactly: ${expected.join(', ')}.`,
    );
  }
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('godot-runtime-capture.invalid-value', `${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < minimum
    || (value as number) > maximum
  ) {
    fail('godot-runtime-capture.invalid-value', `${label} is outside its boundary.`);
  }
  return value as number;
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('godot-runtime-capture.invalid-value', 'Canonical data is non-finite.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (!record(value)) {
    fail(
      'godot-runtime-capture.invalid-value',
      'Canonical data contains an unsupported value.',
    );
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestBytes = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digestBytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function materializeSource(value: unknown): GodotRuntimeCaptureSource {
  if (!record(value)) {
    fail(
      'godot-runtime-capture.invalid-shape',
      'Runtime capture source binding must be an object.',
    );
  }
  exact(value, SOURCE_KEYS, 'Runtime capture source binding');
  if (
    typeof value.candidate_id !== 'string'
    || !CANDIDATE_ID.test(value.candidate_id)
    || typeof value.runtime_overlay_id !== 'string'
    || !OVERLAY_ID.test(value.runtime_overlay_id)
    || typeof value.runtime_projection_id !== 'string'
    || !PROJECTION_ID.test(value.runtime_projection_id)
  ) {
    fail(
      'godot-runtime-capture.invalid-binding',
      'Runtime capture source identifiers are invalid.',
    );
  }
  return Object.freeze({
    candidate_id: value.candidate_id,
    candidate_receipt_sha256: digest(
      value.candidate_receipt_sha256,
      'Candidate receipt digest',
    ),
    layout_plan_sha256: digest(value.layout_plan_sha256, 'Layout plan digest'),
    runtime_overlay_id: value.runtime_overlay_id,
    runtime_overlay_sha256: digest(
      value.runtime_overlay_sha256,
      'Runtime overlay digest',
    ),
    runtime_projection_id: value.runtime_projection_id,
    runtime_projection_sha256: digest(
      value.runtime_projection_sha256,
      'Runtime projection digest',
    ),
  });
}

function materializeEngine(value: unknown): GodotRuntimeCaptureEngine {
  if (!record(value)) {
    fail(
      'godot-runtime-capture.invalid-shape',
      'Runtime capture engine binding must be an object.',
    );
  }
  exact(value, ENGINE_KEYS, 'Runtime capture engine binding');
  if (
    typeof value.godot_version !== 'string'
    || !GODOT_RUNTIME_CAPTURE_GODOT_VERSIONS.includes(
      value.godot_version as GodotRuntimeCaptureGodotVersion,
    )
  ) {
    fail(
      'godot-runtime-capture.invalid-binding',
      'Runtime capture Godot version is unsupported.',
    );
  }
  return Object.freeze({
    godot_version: value.godot_version as GodotRuntimeCaptureGodotVersion,
    executable_sha256: digest(
      value.executable_sha256,
      'Godot executable digest',
    ),
  });
}

function materializeEvidence(
  value: unknown,
  index: number,
): GodotRuntimeCaptureEvidence {
  if (!record(value)) {
    fail(
      'godot-runtime-capture.invalid-shape',
      `Runtime capture evidence ${index} must be an object.`,
    );
  }
  exact(value, EVIDENCE_KEYS, `Runtime capture evidence ${index}`);
  const expected = GODOT_RUNTIME_CAPTURE_EVIDENCE[index];
  if (
    expected === undefined
    || value.kind !== expected.kind
    || value.path !== expected.path
    || value.media_type !== expected.media_type
  ) {
    fail(
      'godot-runtime-capture.invalid-order',
      `Runtime capture evidence ${index} is not the canonical evidence item.`,
    );
  }
  return Object.freeze({
    kind: expected.kind,
    path: expected.path,
    media_type: expected.media_type,
    bytes: boundedInteger(
      value.bytes,
      `Runtime capture evidence ${index} bytes`,
      1,
      128 * 1024 * 1024,
    ),
    sha256: digest(
      value.sha256,
      `Runtime capture evidence ${index} digest`,
    ),
  });
}

function materializeRuntime(value: unknown): GodotRuntimeCaptureRuntime {
  if (!record(value)) {
    fail(
      'godot-runtime-capture.invalid-shape',
      'Runtime capture visible result must be an object.',
    );
  }
  exact(value, RUNTIME_KEYS, 'Runtime capture visible result');
  if (
    value.route_reached !== true
    || value.all_required_bindings_applied !== true
  ) {
    fail(
      'godot-runtime-capture.invalid-claims',
      'Technical runtime pass requires the route and every required runtime binding.',
    );
  }
  const result = Object.freeze({
    visible_terrain_materials: boundedInteger(
      value.visible_terrain_materials,
      'Visible terrain material count',
      1,
      256,
    ),
    visible_landmarks: boundedInteger(
      value.visible_landmarks,
      'Visible landmark count',
      0,
      2048,
    ),
    visible_hazards: boundedInteger(
      value.visible_hazards,
      'Visible hazard count',
      0,
      256,
    ),
    visible_characters: boundedInteger(
      value.visible_characters,
      'Visible character count',
      1,
      256,
    ),
    route_reached: true,
    catalog_assets: boundedInteger(
      value.catalog_assets,
      'Runtime projection catalog asset count',
      1,
      65535,
    ),
    runtime_bindings: boundedInteger(
      value.runtime_bindings,
      'Applied runtime binding count',
      1,
      65535,
    ),
    catalog_only_assets: boundedInteger(
      value.catalog_only_assets,
      'Catalog-only asset count',
      0,
      65535,
    ),
    all_required_bindings_applied: true,
  });
  if (
    result.runtime_bindings > result.catalog_assets
    || result.catalog_only_assets
      !== result.catalog_assets - result.runtime_bindings
    || result.visible_terrain_materials
      + result.visible_landmarks
      + result.visible_characters > result.runtime_bindings
  ) {
    fail(
      'godot-runtime-capture.invalid-binding',
      'Runtime-visible, bound, and catalog-only counts are inconsistent.',
    );
  }
  return result;
}

function materializeClaims(value: unknown): GodotRuntimeCaptureClaims {
  if (!record(value)) {
    fail(
      'godot-runtime-capture.invalid-shape',
      'Runtime capture claim boundary must be an object.',
    );
  }
  exact(value, CLAIM_KEYS, 'Runtime capture claim boundary');
  if (
    value.runtime !== 'technical-pass'
    || value.raspberry_pi !== 'pending'
    || value.production_ready !== false
    || value.remote_request_count !== 0
  ) {
    fail(
      'godot-runtime-capture.invalid-claims',
      'Runtime capture claims exceed the local technical Godot evidence.',
    );
  }
  return Object.freeze({
    runtime: 'technical-pass',
    raspberry_pi: 'pending',
    production_ready: false,
    remote_request_count: 0,
  });
}

function materializeDraft(value: MutableRecord): GodotRuntimeCaptureReceiptDraft {
  if (
    value.schema_version !== GODOT_RUNTIME_CAPTURE_RECEIPT_VERSION
    || value.document_type !== 'godot-runtime-capture-receipt'
    || !isWorldAssetProfile(value.profile)
  ) {
    fail(
      'godot-runtime-capture.invalid-value',
      'Runtime capture receipt identity or profile is invalid.',
    );
  }
  if (
    !Array.isArray(value.evidence)
    || value.evidence.length !== GODOT_RUNTIME_CAPTURE_EVIDENCE.length
  ) {
    fail(
      'godot-runtime-capture.invalid-evidence',
      'Runtime capture receipt requires exactly five evidence items.',
    );
  }
  const evidence = Object.freeze(value.evidence.map(materializeEvidence));
  if (
    new Set(evidence.map(({ kind }) => kind)).size !== evidence.length
    || new Set(evidence.map(({ path }) => path)).size !== evidence.length
    || new Set(evidence.map(({ sha256: valueSha }) => valueSha)).size
      !== evidence.length
  ) {
    fail(
      'godot-runtime-capture.invalid-evidence',
      'Runtime capture evidence kinds, paths, and digests must be unique.',
    );
  }
  return Object.freeze({
    schema_version: GODOT_RUNTIME_CAPTURE_RECEIPT_VERSION,
    document_type: 'godot-runtime-capture-receipt',
    profile: value.profile,
    source: materializeSource(value.source),
    engine: materializeEngine(value.engine),
    evidence,
    runtime: materializeRuntime(value.runtime),
    claims: materializeClaims(value.claims),
  });
}

async function expectedCaptureId(
  draft: GodotRuntimeCaptureReceiptDraft,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(draft));
  return `godot-runtime-capture-${(await sha256(bytes)).slice(0, 16)}`;
}

export async function materializeGodotRuntimeCaptureReceipt(
  value: unknown,
): Promise<GodotRuntimeCaptureReceipt> {
  if (!record(value)) {
    fail(
      'godot-runtime-capture.invalid-shape',
      'Godot runtime capture receipt must be an object.',
    );
  }
  exact(value, ROOT_KEYS, 'Godot runtime capture receipt');
  if (
    typeof value.capture_id !== 'string'
    || !CAPTURE_ID.test(value.capture_id)
  ) {
    fail(
      'godot-runtime-capture.invalid-id',
      'Godot runtime capture id is invalid.',
    );
  }
  const draft = materializeDraft(value);
  if (value.capture_id !== await expectedCaptureId(draft)) {
    fail(
      'godot-runtime-capture.invalid-id',
      'Godot runtime capture id does not match its canonical payload.',
    );
  }
  return Object.freeze({
    schema_version: draft.schema_version,
    document_type: draft.document_type,
    capture_id: value.capture_id,
    profile: draft.profile,
    source: draft.source,
    engine: draft.engine,
    evidence: draft.evidence,
    runtime: draft.runtime,
    claims: draft.claims,
  });
}

export async function buildGodotRuntimeCaptureReceipt(
  input: BuildGodotRuntimeCaptureReceiptInput,
): Promise<GodotRuntimeCaptureReceipt> {
  if (!record(input)) {
    fail(
      'godot-runtime-capture.invalid-shape',
      'Godot runtime capture build input must be an object.',
    );
  }
  exact(input, BUILD_INPUT_KEYS, 'Godot runtime capture build input');
  const draft = materializeDraft({
    schema_version: GODOT_RUNTIME_CAPTURE_RECEIPT_VERSION,
    document_type: 'godot-runtime-capture-receipt',
    profile: input.profile,
    source: input.source,
    engine: input.engine,
    evidence: input.evidence,
    runtime: input.runtime,
    claims: {
      runtime: 'technical-pass',
      raspberry_pi: 'pending',
      production_ready: false,
      remote_request_count: 0,
    },
  });
  return materializeGodotRuntimeCaptureReceipt({
    ...draft,
    capture_id: await expectedCaptureId(draft),
  });
}

export async function serializeCanonicalGodotRuntimeCaptureReceipt(
  value: unknown,
): Promise<Uint8Array> {
  const receipt = await materializeGodotRuntimeCaptureReceipt(value);
  return new TextEncoder().encode(`${canonicalJson(receipt)}\n`);
}

export async function fingerprintGodotRuntimeCaptureReceipt(
  value: unknown,
): Promise<string> {
  return sha256(await serializeCanonicalGodotRuntimeCaptureReceipt(value));
}
