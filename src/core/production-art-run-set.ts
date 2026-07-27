import {
  createProductionArtPlan,
  validateProductionArtPlan,
  type ProductionArtPlan,
} from './production-art-contract';
import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const PRODUCTION_ART_RUN_SET_VERSION = '1.0.0' as const;

export interface ProductionArtRunSet {
  readonly schema_version: typeof PRODUCTION_ART_RUN_SET_VERSION;
  readonly document_type: 'production-art-run-set';
  readonly profile: WorldAssetProfile;
  readonly runs: Readonly<Record<string, string>>;
}

export class ProductionArtRunSetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionArtRunSetError';
  }
}

function fail(code: string, message: string): never {
  throw new ProductionArtRunSetError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function safeRunDirectory(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 1000
    && value.trim() === value
    && !value.includes('\\')
    && !value.startsWith('/')
    && !/^[A-Za-z]:/.test(value)
    && !/^[a-z][a-z0-9+.-]*:/i.test(value)
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function canonicalPlan(profile: WorldAssetProfile): ProductionArtPlan {
  return createProductionArtPlan(profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
}

function assertCanonicalPlan(plan: ProductionArtPlan): void {
  const issues = validateProductionArtPlan(plan);
  if (issues.length > 0) fail('run-set.invalid-plan', 'Production art run-set requires a valid canonical plan.');
  const canonical = createProductionArtPlan(plan.profile, plan.rights);
  if (JSON.stringify(plan) !== JSON.stringify(canonical)) {
    fail('run-set.invalid-plan', 'Production art run-set requires the canonical profile task inventory.');
  }
}

export function createProductionArtRunSet(
  plan: ProductionArtPlan,
  runDirectories: Readonly<Record<string, string>>,
): ProductionArtRunSet {
  assertCanonicalPlan(plan);
  if (!isRecord(runDirectories)) fail('run-set.invalid-runs', 'Run directories must be a plain object.');
  const expectedTaskIds = plan.tasks.map(({ task_id: taskId }) => taskId);
  if (!exactKeys(runDirectories, expectedTaskIds)) {
    fail('run-set.task-inventory', 'Run-set must map every canonical task exactly once.');
  }
  const directories = expectedTaskIds.map((taskId) => runDirectories[taskId]);
  if (directories.some((directory) => !safeRunDirectory(directory))) {
    fail('run-set.invalid-path', 'Run-set directories must be bounded portable relative paths.');
  }
  if (new Set(directories).size !== directories.length) {
    fail('run-set.path-alias', 'Run-set tasks cannot alias one run directory.');
  }
  const runs = Object.freeze(Object.fromEntries(
    expectedTaskIds.map((taskId) => [taskId, runDirectories[taskId]]),
  ));
  return Object.freeze({
    schema_version: PRODUCTION_ART_RUN_SET_VERSION,
    document_type: 'production-art-run-set',
    profile: plan.profile,
    runs,
  });
}

export function materializeProductionArtRunSet(
  value: unknown,
  planValue?: ProductionArtPlan,
): ProductionArtRunSet {
  if (!isRecord(value) || !exactKeys(value, [
    'schema_version',
    'document_type',
    'profile',
    'runs',
  ])) {
    fail('run-set.invalid-shape', 'Production art run-set must contain only declared fields.');
  }
  if (
    value.schema_version !== PRODUCTION_ART_RUN_SET_VERSION
    || value.document_type !== 'production-art-run-set'
    || !isWorldAssetProfile(value.profile)
  ) {
    fail('run-set.invalid-identity', 'Production art run-set identity or profile is unsupported.');
  }
  const plan = planValue ?? canonicalPlan(value.profile);
  if (plan.profile !== value.profile) {
    fail('run-set.profile-mismatch', 'Production art run-set does not match the requested plan profile.');
  }
  return createProductionArtRunSet(plan, value.runs as Readonly<Record<string, string>>);
}
