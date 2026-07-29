import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const GODOT_RUNTIME_CAPTURE_RECEIPT_V1_1_VERSION = '1.1.0' as const;
export const GODOT_RUNTIME_CAPTURE_V1_1_GODOT_VERSIONS =
  Object.freeze(['4.3', '4.7'] as const);
export type GodotRuntimeCaptureV1_1GodotVersion =
  typeof GODOT_RUNTIME_CAPTURE_V1_1_GODOT_VERSIONS[number];

export const GODOT_RUNTIME_CAPTURE_V1_1_EVIDENCE = Object.freeze([
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

export type GodotRuntimeCaptureV1_1EvidenceKind =
  typeof GODOT_RUNTIME_CAPTURE_V1_1_EVIDENCE[number]['kind'];
export type GodotRuntimeCaptureV1_1EvidenceMediaType =
  typeof GODOT_RUNTIME_CAPTURE_V1_1_EVIDENCE[number]['media_type'];

export const GODOT_RUNTIME_CAPTURE_V1_1_BINDING_KINDS = Object.freeze([
  'terrain-material',
  'landmark',
  'hazard',
  'character',
  'background',
  'prop',
  'structure',
  'effect',
  'depth',
] as const);
export type GodotRuntimeCaptureV1_1BindingKind =
  typeof GODOT_RUNTIME_CAPTURE_V1_1_BINDING_KINDS[number];

export interface GodotRuntimeCaptureV1_1BindingKey {
  readonly usage_kind: GodotRuntimeCaptureV1_1BindingKind;
  readonly usage_id: string;
}

export interface GodotRuntimeCaptureV1_1Evidence {
  readonly kind: GodotRuntimeCaptureV1_1EvidenceKind;
  readonly path: string;
  readonly media_type: GodotRuntimeCaptureV1_1EvidenceMediaType;
  readonly bytes: number;
  readonly sha256: string;
}

export interface GodotRuntimeCaptureV1_1Source {
  readonly candidate_id: string;
  readonly candidate_receipt_sha256: string;
  readonly layout_plan_sha256: string;
  readonly runtime_overlay_id: string;
  readonly runtime_overlay_sha256: string;
  readonly runtime_projection_id: string;
  readonly runtime_projection_sha256: string;
}

export interface GodotRuntimeCaptureV1_1Engine {
  readonly godot_version: GodotRuntimeCaptureV1_1GodotVersion;
  readonly executable_sha256: string;
}

export interface GodotRuntimeCaptureV1_1Runtime {
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
  readonly all_required_bindings_applied: true;
}

export interface BuildGodotRuntimeCaptureV1_1Runtime
  extends Omit<
    GodotRuntimeCaptureV1_1Runtime,
    | 'runtime_bindings'
    | 'applied_runtime_bindings'
    | 'bindings_sha256'
    | 'all_required_bindings_applied'
  > {
  /**
   * Exact expected and actually applied usage-key inventories. The builder
   * canonicalizes, compares, counts, and fingerprints these arrays. They are
   * intentionally omitted from the canonical receipt after those derived
   * facts have been recorded.
   */
  readonly expected_bindings: readonly GodotRuntimeCaptureV1_1BindingKey[];
  readonly applied_bindings: readonly GodotRuntimeCaptureV1_1BindingKey[];
}

export interface GodotRuntimeCaptureV1_1Claims {
  readonly runtime: 'technical-pass';
  readonly raspberry_pi: 'pending';
  readonly production_ready: false;
  readonly remote_request_count: 0;
}

export interface GodotRuntimeCaptureReceiptV1_1 {
  readonly schema_version: typeof GODOT_RUNTIME_CAPTURE_RECEIPT_V1_1_VERSION;
  readonly document_type: 'godot-runtime-capture-receipt';
  readonly capture_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: GodotRuntimeCaptureV1_1Source;
  readonly engine: GodotRuntimeCaptureV1_1Engine;
  readonly evidence: readonly GodotRuntimeCaptureV1_1Evidence[];
  readonly runtime: GodotRuntimeCaptureV1_1Runtime;
  readonly claims: GodotRuntimeCaptureV1_1Claims;
}

export interface BuildGodotRuntimeCaptureReceiptV1_1Input {
  readonly profile: WorldAssetProfile;
  readonly source: GodotRuntimeCaptureV1_1Source;
  readonly engine: GodotRuntimeCaptureV1_1Engine;
  readonly evidence: readonly GodotRuntimeCaptureV1_1Evidence[];
  readonly runtime: BuildGodotRuntimeCaptureV1_1Runtime;
}

export type GodotRuntimeCaptureReceiptV1_1ErrorCode =
  | 'godot-runtime-capture-1.1.invalid-shape'
  | 'godot-runtime-capture-1.1.invalid-value'
  | 'godot-runtime-capture-1.1.invalid-binding'
  | 'godot-runtime-capture-1.1.invalid-evidence'
  | 'godot-runtime-capture-1.1.invalid-order'
  | 'godot-runtime-capture-1.1.invalid-claims'
  | 'godot-runtime-capture-1.1.invalid-id';

export class GodotRuntimeCaptureReceiptV1_1Error extends Error {
  constructor(
    readonly code: GodotRuntimeCaptureReceiptV1_1ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GodotRuntimeCaptureReceiptV1_1Error';
  }
}

type MutableRecord = Record<string, unknown>;
type GodotRuntimeCaptureReceiptV1_1Draft = Omit<
  GodotRuntimeCaptureReceiptV1_1,
  'capture_id'
>;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
  'applied_background_layers',
  'applied_prop_instances',
  'applied_structure_instances',
  'applied_effect_bindings',
  'applied_depth_planes',
  'route_reached',
  'catalog_assets',
  'bound_catalog_assets',
  'runtime_bindings',
  'applied_runtime_bindings',
  'catalog_only_assets',
  'bindings_sha256',
  'all_required_bindings_applied',
] as const);
const BUILD_RUNTIME_KEYS = Object.freeze([
  ...RUNTIME_KEYS.filter((key) => ![
    'runtime_bindings',
    'applied_runtime_bindings',
    'bindings_sha256',
    'all_required_bindings_applied',
  ].includes(key)),
  'expected_bindings',
  'applied_bindings',
] as const);
const CLAIM_KEYS = Object.freeze([
  'runtime',
  'raspberry_pi',
  'production_ready',
  'remote_request_count',
] as const);
const BINDING_KEY_KEYS = Object.freeze(['usage_kind', 'usage_id'] as const);

function fail(
  code: GodotRuntimeCaptureReceiptV1_1ErrorCode,
  message: string,
): never {
  throw new GodotRuntimeCaptureReceiptV1_1Error(code, message);
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
      'godot-runtime-capture-1.1.invalid-shape',
      `${label} must contain exactly: ${expected.join(', ')}.`,
    );
  }
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-value',
      `${label} must be a lowercase SHA-256.`,
    );
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
    fail(
      'godot-runtime-capture-1.1.invalid-value',
      `${label} is outside its boundary.`,
    );
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
      fail(
        'godot-runtime-capture-1.1.invalid-value',
        'Canonical data is non-finite.',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (!record(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-value',
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

function materializeBindingKeys(
  value: unknown,
): readonly GodotRuntimeCaptureV1_1BindingKey[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 65535) {
    fail(
      'godot-runtime-capture-1.1.invalid-binding',
      'Runtime binding key inventory is invalid.',
    );
  }
  const keys = value.map((candidate, index) => {
    if (!record(candidate)) {
      fail(
        'godot-runtime-capture-1.1.invalid-shape',
        `Runtime binding key ${index} must be an object.`,
      );
    }
    exact(candidate, BINDING_KEY_KEYS, `Runtime binding key ${index}`);
    if (
      typeof candidate.usage_kind !== 'string'
      || !GODOT_RUNTIME_CAPTURE_V1_1_BINDING_KINDS.includes(
        candidate.usage_kind as GodotRuntimeCaptureV1_1BindingKind,
      )
      || typeof candidate.usage_id !== 'string'
      || candidate.usage_id.length > 160
      || !SAFE_ID.test(candidate.usage_id)
    ) {
      fail(
        'godot-runtime-capture-1.1.invalid-binding',
        `Runtime binding key ${index} is invalid.`,
      );
    }
    return Object.freeze({
      usage_kind: candidate.usage_kind as GodotRuntimeCaptureV1_1BindingKind,
      usage_id: candidate.usage_id,
    });
  });
  keys.sort((left, right) =>
    left.usage_kind.localeCompare(right.usage_kind, 'en')
    || left.usage_id.localeCompare(right.usage_id, 'en'));
  if (keys.some((key, index) =>
    index > 0
    && key.usage_kind === keys[index - 1]!.usage_kind
    && key.usage_id === keys[index - 1]!.usage_id)) {
    fail(
      'godot-runtime-capture-1.1.invalid-binding',
      'Runtime binding keys must be unique.',
    );
  }
  return Object.freeze(keys);
}

export async function fingerprintGodotRuntimeBindingKeysV1_1(
  value: readonly GodotRuntimeCaptureV1_1BindingKey[],
): Promise<string> {
  const keys = materializeBindingKeys(value);
  return sha256(new TextEncoder().encode(canonicalJson(keys)));
}

function materializeSource(value: unknown): GodotRuntimeCaptureV1_1Source {
  if (!record(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-shape',
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
      'godot-runtime-capture-1.1.invalid-binding',
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

function materializeEngine(value: unknown): GodotRuntimeCaptureV1_1Engine {
  if (!record(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-shape',
      'Runtime capture engine binding must be an object.',
    );
  }
  exact(value, ENGINE_KEYS, 'Runtime capture engine binding');
  if (
    typeof value.godot_version !== 'string'
    || !GODOT_RUNTIME_CAPTURE_V1_1_GODOT_VERSIONS.includes(
      value.godot_version as GodotRuntimeCaptureV1_1GodotVersion,
    )
  ) {
    fail(
      'godot-runtime-capture-1.1.invalid-binding',
      'Runtime capture Godot version is unsupported.',
    );
  }
  return Object.freeze({
    godot_version: value.godot_version as GodotRuntimeCaptureV1_1GodotVersion,
    executable_sha256: digest(
      value.executable_sha256,
      'Godot executable digest',
    ),
  });
}

function materializeEvidence(
  value: unknown,
  index: number,
): GodotRuntimeCaptureV1_1Evidence {
  if (!record(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-shape',
      `Runtime capture evidence ${index} must be an object.`,
    );
  }
  exact(value, EVIDENCE_KEYS, `Runtime capture evidence ${index}`);
  const expected = GODOT_RUNTIME_CAPTURE_V1_1_EVIDENCE[index];
  if (
    expected === undefined
    || value.kind !== expected.kind
    || value.path !== expected.path
    || value.media_type !== expected.media_type
  ) {
    fail(
      'godot-runtime-capture-1.1.invalid-order',
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

function materializeRuntime(value: unknown): GodotRuntimeCaptureV1_1Runtime {
  if (!record(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-shape',
      'Runtime capture result must be an object.',
    );
  }
  exact(value, RUNTIME_KEYS, 'Runtime capture result');
  if (
    value.route_reached !== true
    || value.all_required_bindings_applied !== true
  ) {
    fail(
      'godot-runtime-capture-1.1.invalid-claims',
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
    applied_background_layers: boundedInteger(
      value.applied_background_layers,
      'Applied background layer count',
      0,
      256,
    ),
    applied_prop_instances: boundedInteger(
      value.applied_prop_instances,
      'Applied prop instance count',
      0,
      2048,
    ),
    applied_structure_instances: boundedInteger(
      value.applied_structure_instances,
      'Applied structure instance count',
      0,
      2048,
    ),
    applied_effect_bindings: boundedInteger(
      value.applied_effect_bindings,
      'Applied effect binding count',
      0,
      2048,
    ),
    applied_depth_planes: boundedInteger(
      value.applied_depth_planes,
      'Applied depth plane count',
      0,
      256,
    ),
    route_reached: true,
    catalog_assets: boundedInteger(
      value.catalog_assets,
      'Runtime projection catalog asset count',
      1,
      65535,
    ),
    bound_catalog_assets: boundedInteger(
      value.bound_catalog_assets,
      'Bound catalog asset count',
      1,
      65535,
    ),
    runtime_bindings: boundedInteger(
      value.runtime_bindings,
      'Runtime binding count',
      1,
      65535,
    ),
    applied_runtime_bindings: boundedInteger(
      value.applied_runtime_bindings,
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
    bindings_sha256: digest(
      value.bindings_sha256,
      'Runtime binding-key inventory digest',
    ),
    all_required_bindings_applied: true,
  });
  if (
    result.bound_catalog_assets > result.catalog_assets
    || result.bound_catalog_assets > result.runtime_bindings
    || result.catalog_only_assets
      !== result.catalog_assets - result.bound_catalog_assets
    || result.applied_runtime_bindings !== result.runtime_bindings
  ) {
    fail(
      'godot-runtime-capture-1.1.invalid-binding',
      'Catalog, bound-asset, runtime-binding, and applied-binding counts are inconsistent.',
    );
  }
  return result;
}

async function materializeBuildRuntime(
  value: unknown,
): Promise<GodotRuntimeCaptureV1_1Runtime> {
  if (!record(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-shape',
      'Runtime capture build result must be an object.',
    );
  }
  exact(value, BUILD_RUNTIME_KEYS, 'Runtime capture build result');
  const expectedBindings = materializeBindingKeys(value.expected_bindings);
  const appliedBindings = materializeBindingKeys(value.applied_bindings);
  if (canonicalJson(expectedBindings) !== canonicalJson(appliedBindings)) {
    fail(
      'godot-runtime-capture-1.1.invalid-binding',
      'Applied runtime binding-key inventory differs from the complete expected binding set.',
    );
  }
  const runtimeValue = {
    ...Object.fromEntries(
      RUNTIME_KEYS.filter((key) => ![
        'runtime_bindings',
        'applied_runtime_bindings',
        'bindings_sha256',
        'all_required_bindings_applied',
      ].includes(key)).map((key) => [key, value[key]]),
    ),
    runtime_bindings: expectedBindings.length,
    applied_runtime_bindings: appliedBindings.length,
    bindings_sha256: await fingerprintGodotRuntimeBindingKeysV1_1(
      expectedBindings,
    ),
    all_required_bindings_applied: true,
  };
  const result = materializeRuntime(runtimeValue);
  return result;
}

function materializeClaims(value: unknown): GodotRuntimeCaptureV1_1Claims {
  if (!record(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-shape',
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
      'godot-runtime-capture-1.1.invalid-claims',
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

function materializeDraft(
  value: MutableRecord,
): GodotRuntimeCaptureReceiptV1_1Draft {
  if (
    value.schema_version !== GODOT_RUNTIME_CAPTURE_RECEIPT_V1_1_VERSION
    || value.document_type !== 'godot-runtime-capture-receipt'
    || !isWorldAssetProfile(value.profile)
  ) {
    fail(
      'godot-runtime-capture-1.1.invalid-value',
      'Runtime capture receipt identity or profile is invalid.',
    );
  }
  if (
    !Array.isArray(value.evidence)
    || value.evidence.length !== GODOT_RUNTIME_CAPTURE_V1_1_EVIDENCE.length
  ) {
    fail(
      'godot-runtime-capture-1.1.invalid-evidence',
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
      'godot-runtime-capture-1.1.invalid-evidence',
      'Runtime capture evidence kinds, paths, and digests must be unique.',
    );
  }
  return Object.freeze({
    schema_version: GODOT_RUNTIME_CAPTURE_RECEIPT_V1_1_VERSION,
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
  draft: GodotRuntimeCaptureReceiptV1_1Draft,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(draft));
  return `godot-runtime-capture-${(await sha256(bytes)).slice(0, 16)}`;
}

export async function materializeGodotRuntimeCaptureReceiptV1_1(
  value: unknown,
): Promise<GodotRuntimeCaptureReceiptV1_1> {
  if (!record(value)) {
    fail(
      'godot-runtime-capture-1.1.invalid-shape',
      'Godot runtime capture receipt must be an object.',
    );
  }
  exact(value, ROOT_KEYS, 'Godot runtime capture receipt');
  if (
    typeof value.capture_id !== 'string'
    || !CAPTURE_ID.test(value.capture_id)
  ) {
    fail(
      'godot-runtime-capture-1.1.invalid-id',
      'Godot runtime capture id is invalid.',
    );
  }
  const draft = materializeDraft(value);
  if (value.capture_id !== await expectedCaptureId(draft)) {
    fail(
      'godot-runtime-capture-1.1.invalid-id',
      'Godot runtime capture id does not match its canonical payload.',
    );
  }
  return Object.freeze({
    ...draft,
    capture_id: value.capture_id,
  });
}

export async function buildGodotRuntimeCaptureReceiptV1_1(
  input: BuildGodotRuntimeCaptureReceiptV1_1Input,
): Promise<GodotRuntimeCaptureReceiptV1_1> {
  if (!record(input)) {
    fail(
      'godot-runtime-capture-1.1.invalid-shape',
      'Godot runtime capture build input must be an object.',
    );
  }
  exact(input, BUILD_INPUT_KEYS, 'Godot runtime capture build input');
  const runtime = await materializeBuildRuntime(input.runtime);
  const draft = materializeDraft({
    schema_version: GODOT_RUNTIME_CAPTURE_RECEIPT_V1_1_VERSION,
    document_type: 'godot-runtime-capture-receipt',
    profile: input.profile,
    source: input.source,
    engine: input.engine,
    evidence: input.evidence,
    runtime,
    claims: {
      runtime: 'technical-pass',
      raspberry_pi: 'pending',
      production_ready: false,
      remote_request_count: 0,
    },
  });
  return materializeGodotRuntimeCaptureReceiptV1_1({
    ...draft,
    capture_id: await expectedCaptureId(draft),
  });
}

export async function serializeCanonicalGodotRuntimeCaptureReceiptV1_1(
  value: unknown,
): Promise<Uint8Array> {
  const receipt = await materializeGodotRuntimeCaptureReceiptV1_1(value);
  return new TextEncoder().encode(`${canonicalJson(receipt)}\n`);
}

export async function fingerprintGodotRuntimeCaptureReceiptV1_1(
  value: unknown,
): Promise<string> {
  return sha256(await serializeCanonicalGodotRuntimeCaptureReceiptV1_1(value));
}
