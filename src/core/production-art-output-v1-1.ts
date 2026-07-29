import type { WorldAssetProfile } from './asset-profile';
import {
  fingerprintProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from './production-art-contract-v1-1';
import type {
  ProductionArtAlphaPolicy,
  ProductionArtPivot,
  ProductionArtRights,
} from './production-art-contract';

export const PRODUCTION_ART_OUTPUT_V1_1_VERSION = '1.1.0' as const;

export const PRODUCTION_ART_OUTPUT_V1_1_LOCAL_REFERENCE_IDS = Object.freeze([
  'approved-scene-direction',
  'environment-reference',
  'character-reference',
] as const);
export type ProductionArtOutputV1_1LocalReferenceId =
  typeof PRODUCTION_ART_OUTPUT_V1_1_LOCAL_REFERENCE_IDS[number];

export interface ProductionArtOutputV1_1 {
  readonly schema_version: typeof PRODUCTION_ART_OUTPUT_V1_1_VERSION;
  readonly document_type: 'production-art-output';
  readonly source: Readonly<{
    plan_sha256: string;
    requirements_sha256: string;
  }>;
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly task_id: string;
  readonly asset_id: string;
  readonly path: string;
  readonly media_type: 'image/png';
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly alpha_policy: ProductionArtAlphaPolicy;
  readonly pivot: ProductionArtPivot;
  readonly slot_ids: readonly string[];
  readonly roles: readonly string[];
  readonly variant_ids: readonly string[];
  readonly source_reference_ids: readonly ProductionArtOutputV1_1LocalReferenceId[];
  readonly rights: ProductionArtRights;
}

export interface BuildProductionArtOutputV1_1Input {
  readonly taskId: string;
  readonly assetId: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceReferenceIds: readonly string[];
}

export type ProductionArtOutputV1_1ErrorCode =
  | 'production-art-output-1.1.invalid-shape'
  | 'production-art-output-1.1.invalid-value'
  | 'production-art-output-1.1.invalid-task'
  | 'production-art-output-1.1.invalid-references'
  | 'production-art-output-1.1.invalid-binding';

export class ProductionArtOutputV1_1Error extends Error {
  constructor(readonly code: ProductionArtOutputV1_1ErrorCode, message: string) {
    super(message);
    this.name = 'ProductionArtOutputV1_1Error';
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PNG_BYTES = 64 * 1024 * 1024;

function fail(code: ProductionArtOutputV1_1ErrorCode, message: string): never {
  throw new ProductionArtOutputV1_1Error(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      'production-art-output-1.1.invalid-shape',
      `${label} must contain exactly: ${expected.join(', ')}.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('production-art-output-1.1.invalid-value', 'Output contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('production-art-output-1.1.invalid-value', 'Output contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function taskById(plan: ProductionArtPlanV1_1, taskId: string): ProductionArtTaskV1_1 {
  if (typeof taskId !== 'string' || taskId.length > 160 || !SAFE_ID.test(taskId)) {
    fail('production-art-output-1.1.invalid-task', 'Output task id is invalid.');
  }
  const task = plan.tasks.find(({ task_id: candidate }) => candidate === taskId);
  if (!task) {
    fail('production-art-output-1.1.invalid-task', 'Output task is absent from the bound plan.');
  }
  return task;
}

function canonicalReferences(
  task: ProductionArtTaskV1_1,
  values: readonly string[],
): readonly ProductionArtOutputV1_1LocalReferenceId[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 3) {
    fail(
      'production-art-output-1.1.invalid-references',
      'Output requires from one to three local canonical reference ids.',
    );
  }
  const allowed = new Set<string>(PRODUCTION_ART_OUTPUT_V1_1_LOCAL_REFERENCE_IDS);
  if (
    new Set(values).size !== values.length
    || values.some((value) => typeof value !== 'string' || !allowed.has(value))
  ) {
    fail(
      'production-art-output-1.1.invalid-references',
      'Output references must be unique local canonical ids.',
    );
  }
  const selected = new Set(values);
  const isSceneDirection = task.kind === 'scene-direction';
  if (
    (isSceneDirection && selected.has('approved-scene-direction'))
    || (!isSceneDirection && !selected.has('approved-scene-direction'))
    || (
      task.reference_roles.includes('environment-style')
      && !selected.has('environment-reference')
      && !selected.has('approved-scene-direction')
    )
    || (
      task.reference_roles.includes('character')
      && !selected.has('character-reference')
    )
  ) {
    fail(
      'production-art-output-1.1.invalid-references',
      'Output references do not satisfy the task local-reference contract.',
    );
  }
  return Object.freeze(PRODUCTION_ART_OUTPUT_V1_1_LOCAL_REFERENCE_IDS
    .filter((referenceId) => selected.has(referenceId)));
}

function validateBuildInput(input: BuildProductionArtOutputV1_1Input): void {
  if (
    typeof input.assetId !== 'string'
    || input.assetId.length > 100
    || !SAFE_ID.test(input.assetId)
    || !Number.isSafeInteger(input.bytes)
    || input.bytes < 1
    || input.bytes > MAX_PNG_BYTES
    || typeof input.sha256 !== 'string'
    || !SHA256.test(input.sha256)
  ) {
    fail(
      'production-art-output-1.1.invalid-value',
      'Output asset id, byte count, or PNG SHA-256 is invalid.',
    );
  }
}

function frozenRights(rights: ProductionArtRights): ProductionArtRights {
  return Object.freeze({
    distribution: rights.distribution,
    license: rights.license,
    ...(rights.attribution === undefined ? {} : { attribution: rights.attribution }),
  });
}

export async function buildProductionArtOutputV1_1(
  planValue: unknown,
  requirementsValue: unknown,
  input: BuildProductionArtOutputV1_1Input,
): Promise<ProductionArtOutputV1_1> {
  const plan = await materializeProductionArtPlanV1_1(planValue, requirementsValue);
  validateBuildInput(input);
  const task = taskById(plan, input.taskId);
  const references = canonicalReferences(task, input.sourceReferenceIds);
  const slots = task.slot_mappings;
  return Object.freeze({
    schema_version: PRODUCTION_ART_OUTPUT_V1_1_VERSION,
    document_type: 'production-art-output' as const,
    source: Object.freeze({
      plan_sha256: await fingerprintProductionArtPlanV1_1(plan, requirementsValue),
      requirements_sha256: plan.source.requirements_sha256,
    }),
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    asset_id: input.assetId,
    path: task.expected_output_path,
    media_type: 'image/png' as const,
    bytes: input.bytes,
    sha256: input.sha256,
    width: task.target.width,
    height: task.target.height,
    alpha_policy: task.alpha_policy,
    pivot: Object.freeze({
      x: task.pivot.x,
      y: task.pivot.y,
      unit: 'pixels' as const,
    }),
    slot_ids: Object.freeze(slots.map(({ slot_id: slotId }) => slotId)),
    roles: Object.freeze(slots.map(({ role }) => role)),
    variant_ids: Object.freeze(slots.map(({ variant_id: variantId }) => variantId)),
    source_reference_ids: references,
    rights: frozenRights(plan.rights),
  });
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    fail('production-art-output-1.1.invalid-value', `${label} must be a bounded array.`);
  }
  if (value.some((item) => typeof item !== 'string')) {
    fail('production-art-output-1.1.invalid-value', `${label} must contain only strings.`);
  }
  return value as readonly string[];
}

export async function materializeProductionArtOutputV1_1(
  value: unknown,
  planValue: unknown,
  requirementsValue: unknown,
): Promise<ProductionArtOutputV1_1> {
  if (!isRecord(value)) {
    fail('production-art-output-1.1.invalid-shape', 'Production art output must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'source',
    'plan_id',
    'profile',
    'task_id',
    'asset_id',
    'path',
    'media_type',
    'bytes',
    'sha256',
    'width',
    'height',
    'alpha_policy',
    'pivot',
    'slot_ids',
    'roles',
    'variant_ids',
    'source_reference_ids',
    'rights',
  ], 'Production art output');
  if (
    value.schema_version !== PRODUCTION_ART_OUTPUT_V1_1_VERSION
    || value.document_type !== 'production-art-output'
    || !isRecord(value.source)
    || !isRecord(value.pivot)
    || !isRecord(value.rights)
  ) {
    fail('production-art-output-1.1.invalid-value', 'Production art output identity is invalid.');
  }
  exactKeys(value.source, ['plan_sha256', 'requirements_sha256'], 'Production art output source');
  exactKeys(value.pivot, ['x', 'y', 'unit'], 'Production art output pivot');
  exactKeys(
    value.rights,
    value.rights.attribution === undefined
      ? ['distribution', 'license']
      : ['distribution', 'license', 'attribution'],
    'Production art output rights',
  );
  if (
    typeof value.task_id !== 'string'
    || typeof value.asset_id !== 'string'
    || typeof value.sha256 !== 'string'
    || !Array.isArray(value.source_reference_ids)
  ) {
    fail('production-art-output-1.1.invalid-value', 'Production art output values are invalid.');
  }
  stringArray(value.slot_ids, 'Output slot ids');
  stringArray(value.roles, 'Output roles');
  stringArray(value.variant_ids, 'Output variant ids');
  const references = stringArray(value.source_reference_ids, 'Output reference ids');
  const expected = await buildProductionArtOutputV1_1(
    planValue,
    requirementsValue,
    {
      taskId: value.task_id,
      assetId: value.asset_id,
      bytes: value.bytes as number,
      sha256: value.sha256,
      sourceReferenceIds: references,
    },
  );
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(
      'production-art-output-1.1.invalid-binding',
      'Production art output does not exactly match its Plan 1.1 task and source digests.',
    );
  }
  return expected;
}

export async function fingerprintProductionArtOutputV1_1(
  value: unknown,
  planValue: unknown,
  requirementsValue: unknown,
): Promise<string> {
  return sha256(await materializeProductionArtOutputV1_1(
    value,
    planValue,
    requirementsValue,
  ));
}

export async function serializeCanonicalProductionArtOutputV1_1(
  value: unknown,
  planValue: unknown,
  requirementsValue: unknown,
): Promise<Uint8Array> {
  const output = await materializeProductionArtOutputV1_1(
    value,
    planValue,
    requirementsValue,
  );
  return new TextEncoder().encode(`${canonicalJson(output)}\n`);
}
