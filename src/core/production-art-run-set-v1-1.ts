import type { WorldAssetProfile } from './asset-profile';
import {
  fingerprintProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
} from './production-art-contract-v1-1';
import type { ProductionArtRights } from './production-art-contract';
import {
  fingerprintProductionArtOutputV1_1,
  materializeProductionArtOutputV1_1,
  type ProductionArtOutputV1_1,
} from './production-art-output-v1-1';

export const PRODUCTION_ART_RUN_SET_V1_1_VERSION = '1.1.0' as const;

export interface ProductionArtRunEvidenceV1_1 {
  readonly artifact_path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly output_sha256: string;
}

export interface ProductionArtRunV1_1 {
  readonly task_id: string;
  readonly run_directory: string;
  readonly output: ProductionArtOutputV1_1;
  readonly evidence: ProductionArtRunEvidenceV1_1;
}

export interface ProductionArtRunSetV1_1 {
  readonly schema_version: typeof PRODUCTION_ART_RUN_SET_V1_1_VERSION;
  readonly document_type: 'production-art-run-set';
  readonly source: Readonly<{
    plan_sha256: string;
    requirements_sha256: string;
  }>;
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly rights: ProductionArtRights;
  readonly runs: readonly ProductionArtRunV1_1[];
}

export interface ProductionArtRunEvidenceV1_1Input {
  readonly artifactPath: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ProductionArtRunV1_1Input {
  readonly taskId: string;
  readonly runDirectory: string;
  readonly output: unknown;
  readonly evidence: ProductionArtRunEvidenceV1_1Input;
}

export type ProductionArtRunSetV1_1ErrorCode =
  | 'production-art-run-set-1.1.invalid-shape'
  | 'production-art-run-set-1.1.invalid-value'
  | 'production-art-run-set-1.1.task-inventory'
  | 'production-art-run-set-1.1.invalid-path'
  | 'production-art-run-set-1.1.path-alias'
  | 'production-art-run-set-1.1.invalid-output'
  | 'production-art-run-set-1.1.invalid-evidence'
  | 'production-art-run-set-1.1.invalid-binding';

export class ProductionArtRunSetV1_1Error extends Error {
  constructor(readonly code: ProductionArtRunSetV1_1ErrorCode, message: string) {
    super(message);
    this.name = 'ProductionArtRunSetV1_1Error';
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PORTABLE_PATH =
  /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

function fail(code: ProductionArtRunSetV1_1ErrorCode, message: string): never {
  throw new ProductionArtRunSetV1_1Error(code, message);
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
      'production-art-run-set-1.1.invalid-shape',
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
      fail('production-art-run-set-1.1.invalid-value', 'Run-set contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('production-art-run-set-1.1.invalid-value', 'Run-set contains an unsupported value.');
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

function isPortableRelativePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 240
    && PORTABLE_PATH.test(value)
    && value.split('/').every((segment) => segment !== '.' && segment !== '..')
    && !value.includes('\\')
    && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function frozenRights(rights: ProductionArtRights): ProductionArtRights {
  return Object.freeze({
    distribution: rights.distribution,
    license: rights.license,
    ...(rights.attribution === undefined ? {} : { attribution: rights.attribution }),
  });
}

function validateInputShape(value: unknown): asserts value is ProductionArtRunV1_1Input {
  if (!isRecord(value)) {
    fail('production-art-run-set-1.1.invalid-shape', 'Run input must be an object.');
  }
  exactKeys(value, ['taskId', 'runDirectory', 'output', 'evidence'], 'Run input');
  if (!isRecord(value.evidence)) {
    fail('production-art-run-set-1.1.invalid-shape', 'Run evidence must be an object.');
  }
  exactKeys(value.evidence, ['artifactPath', 'bytes', 'sha256'], 'Run evidence');
  if (
    typeof value.taskId !== 'string'
    || value.taskId.length > 160
    || !SAFE_ID.test(value.taskId)
    || !isPortableRelativePath(value.runDirectory)
  ) {
    fail('production-art-run-set-1.1.invalid-path', 'Run task id or directory is invalid.');
  }
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export async function buildProductionArtRunSetV1_1(
  planValue: unknown,
  requirementsValue: unknown,
  runInputs: readonly ProductionArtRunV1_1Input[],
): Promise<ProductionArtRunSetV1_1> {
  const plan = await materializeProductionArtPlanV1_1(planValue, requirementsValue);
  if (!Array.isArray(runInputs)) {
    fail('production-art-run-set-1.1.invalid-shape', 'Run inputs must be an array.');
  }
  const inputsByTask = new Map<string, ProductionArtRunV1_1Input>();
  for (const input of runInputs) {
    validateInputShape(input);
    if (inputsByTask.has(input.taskId)) {
      fail('production-art-run-set-1.1.task-inventory', 'Each plan task must occur once.');
    }
    inputsByTask.set(input.taskId, input);
  }
  const expectedTaskIds = plan.tasks.map(({ task_id: taskId }) => taskId);
  if (
    inputsByTask.size !== expectedTaskIds.length
    || expectedTaskIds.some((taskId) => !inputsByTask.has(taskId))
  ) {
    fail(
      'production-art-run-set-1.1.task-inventory',
      'Run-set must contain every dynamic Plan 1.1 task exactly once.',
    );
  }
  const runDirectories = expectedTaskIds.map((taskId) => inputsByTask.get(taskId)!.runDirectory);
  if (new Set(runDirectories).size !== runDirectories.length) {
    fail('production-art-run-set-1.1.path-alias', 'Run directories cannot alias.');
  }

  const runs: ProductionArtRunV1_1[] = [];
  for (const task of plan.tasks) {
    const input = inputsByTask.get(task.task_id)!;
    let output: ProductionArtOutputV1_1;
    try {
      output = await materializeProductionArtOutputV1_1(
        input.output,
        plan,
        requirementsValue,
      );
    } catch {
      fail(
        'production-art-run-set-1.1.invalid-output',
        `Run output for ${task.task_id} is not a bound Output 1.1 document.`,
      );
    }
    if (
      output.task_id !== task.task_id
      || output.path !== task.expected_output_path
      || !equalStrings(output.slot_ids, task.slot_mappings.map(({ slot_id }) => slot_id))
      || !equalStrings(output.roles, task.slot_mappings.map(({ role }) => role))
      || !equalStrings(
        output.variant_ids,
        task.slot_mappings.map(({ variant_id }) => variant_id),
      )
      || canonicalJson(output.rights) !== canonicalJson(plan.rights)
    ) {
      fail(
        'production-art-run-set-1.1.invalid-output',
        `Run output for ${task.task_id} does not match task order, path, or rights.`,
      );
    }
    const evidence = input.evidence;
    if (
      evidence.artifactPath !== output.path
      || evidence.bytes !== output.bytes
      || evidence.sha256 !== output.sha256
      || !isPortableRelativePath(evidence.artifactPath)
      || !Number.isSafeInteger(evidence.bytes)
      || evidence.bytes < 1
      || typeof evidence.sha256 !== 'string'
      || !SHA256.test(evidence.sha256)
    ) {
      fail(
        'production-art-run-set-1.1.invalid-evidence',
        `Run evidence for ${task.task_id} does not match its PNG output.`,
      );
    }
    runs.push(Object.freeze({
      task_id: task.task_id,
      run_directory: input.runDirectory,
      output,
      evidence: Object.freeze({
        artifact_path: output.path,
        bytes: output.bytes,
        sha256: output.sha256,
        output_sha256: await fingerprintProductionArtOutputV1_1(
          output,
          plan,
          requirementsValue,
        ),
      }),
    }));
  }

  return Object.freeze({
    schema_version: PRODUCTION_ART_RUN_SET_V1_1_VERSION,
    document_type: 'production-art-run-set' as const,
    source: Object.freeze({
      plan_sha256: await fingerprintProductionArtPlanV1_1(plan, requirementsValue),
      requirements_sha256: plan.source.requirements_sha256,
    }),
    plan_id: plan.plan_id,
    profile: plan.profile,
    rights: frozenRights(plan.rights),
    runs: Object.freeze(runs),
  });
}

export async function materializeProductionArtRunSetV1_1(
  value: unknown,
  planValue: unknown,
  requirementsValue: unknown,
): Promise<ProductionArtRunSetV1_1> {
  if (!isRecord(value)) {
    fail('production-art-run-set-1.1.invalid-shape', 'Production art run-set must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'source',
    'plan_id',
    'profile',
    'rights',
    'runs',
  ], 'Production art run-set');
  if (
    value.schema_version !== PRODUCTION_ART_RUN_SET_V1_1_VERSION
    || value.document_type !== 'production-art-run-set'
    || !isRecord(value.source)
    || !isRecord(value.rights)
    || !Array.isArray(value.runs)
  ) {
    fail('production-art-run-set-1.1.invalid-value', 'Run-set identity or values are invalid.');
  }
  exactKeys(value.source, ['plan_sha256', 'requirements_sha256'], 'Run-set source');
  exactKeys(
    value.rights,
    value.rights.attribution === undefined
      ? ['distribution', 'license']
      : ['distribution', 'license', 'attribution'],
    'Run-set rights',
  );
  const inputs: ProductionArtRunV1_1Input[] = value.runs.map((runValue) => {
    if (!isRecord(runValue)) {
      fail('production-art-run-set-1.1.invalid-shape', 'Run must be an object.');
    }
    exactKeys(runValue, ['task_id', 'run_directory', 'output', 'evidence'], 'Run');
    if (!isRecord(runValue.evidence)) {
      fail('production-art-run-set-1.1.invalid-shape', 'Run evidence must be an object.');
    }
    exactKeys(
      runValue.evidence,
      ['artifact_path', 'bytes', 'sha256', 'output_sha256'],
      'Run evidence',
    );
    return {
      taskId: runValue.task_id as string,
      runDirectory: runValue.run_directory as string,
      output: runValue.output,
      evidence: {
        artifactPath: runValue.evidence.artifact_path as string,
        bytes: runValue.evidence.bytes as number,
        sha256: runValue.evidence.sha256 as string,
      },
    };
  });
  const expected = await buildProductionArtRunSetV1_1(
    planValue,
    requirementsValue,
    inputs,
  );
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(
      'production-art-run-set-1.1.invalid-binding',
      'Run-set does not exactly match its Plan 1.1, Requirements 1.1, outputs, and evidence.',
    );
  }
  return expected;
}

export async function fingerprintProductionArtRunSetV1_1(
  value: unknown,
  planValue: unknown,
  requirementsValue: unknown,
): Promise<string> {
  return sha256(await materializeProductionArtRunSetV1_1(
    value,
    planValue,
    requirementsValue,
  ));
}

export async function serializeCanonicalProductionArtRunSetV1_1(
  value: unknown,
  planValue: unknown,
  requirementsValue: unknown,
): Promise<Uint8Array> {
  const runSet = await materializeProductionArtRunSetV1_1(
    value,
    planValue,
    requirementsValue,
  );
  return new TextEncoder().encode(`${canonicalJson(runSet)}\n`);
}
