import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  fingerprintAssetRequirements,
  materializeAssetRequirements,
  type AssetRequirements,
} from './asset-requirements';
import {
  validateProductionArtPlan,
  type ProductionArtPlan,
} from './production-art-contract';

export const PRODUCTION_ART_REQUIREMENTS_BINDING_VERSION = '1.0.0' as const;

export interface ProductionArtRequirementTaskMapping {
  readonly requirement_id: string;
  readonly role: string;
  readonly task_id: string;
  readonly variant_count: number;
}

export interface ProductionArtRequirementsBlocker {
  readonly blocker_id: string;
  readonly requirement_id: string;
  readonly code: 'unresolved-layout-critical';
}

/**
 * Exact, provider-neutral bridge between one AssetRequirements artifact and
 * one existing ProductionArtPlan. The plan's prompts, paths and references do
 * not cross this boundary; their complete canonical bytes are hash-bound.
 */
export interface ProductionArtRequirementsBinding {
  readonly schema_version: typeof PRODUCTION_ART_REQUIREMENTS_BINDING_VERSION;
  readonly document_type: 'production-art-requirements-binding';
  readonly binding_id: string;
  readonly profile: WorldAssetProfile;
  readonly status: 'ready' | 'blocked';
  readonly source: Readonly<{
    asset_requirements_sha256: string;
    production_art_plan_sha256: string;
  }>;
  readonly mappings: readonly ProductionArtRequirementTaskMapping[];
  readonly blockers: readonly ProductionArtRequirementsBlocker[];
}

export type ProductionArtRequirementsBindingErrorCode =
  | 'production-art-requirements-binding.invalid-shape'
  | 'production-art-requirements-binding.invalid-value'
  | 'production-art-requirements-binding.invalid-binding';

export class ProductionArtRequirementsBindingError extends Error {
  constructor(
    readonly code: ProductionArtRequirementsBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionArtRequirementsBindingError';
  }
}

type MutableRecord = Record<string, unknown>;
type ExpectedSources = Readonly<{
  assetRequirements: unknown;
  productionArtPlan: unknown;
}>;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIREMENT_ID = /^requirement-[0-9]{3}$/;
const BLOCKER_ID = /^blocker-[0-9]{3}$/;
const ROLE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function fail(
  code: ProductionArtRequirementsBindingErrorCode,
  message: string,
): never {
  throw new ProductionArtRequirementsBindingError(code, message);
}

function isRecord(value: unknown): value is MutableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: MutableRecord, expectedKeys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(
      'production-art-requirements-binding.invalid-shape',
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
      fail(
        'production-art-requirements-binding.invalid-value',
        'Production art requirements binding cannot contain non-finite numbers.',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail(
      'production-art-requirements-binding.invalid-value',
      'Production art requirements binding contains an unsupported value.',
    );
  }
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digestBuffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail(
      'production-art-requirements-binding.invalid-value',
      `${label} must be a lowercase SHA-256 digest.`,
    );
  }
  return value;
}

function safeId(value: unknown, label: string, pattern = SAFE_ID): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 120
    || !pattern.test(value)
  ) {
    fail('production-art-requirements-binding.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(
      'production-art-requirements-binding.invalid-value',
      `${label} must be a positive safe integer.`,
    );
  }
  return value as number;
}

function materializeProductionArtPlan(value: unknown): ProductionArtPlan {
  if (!isRecord(value)) {
    fail(
      'production-art-requirements-binding.invalid-shape',
      'Production art plan must be an object.',
    );
  }
  let issues;
  try {
    issues = validateProductionArtPlan(value as unknown as ProductionArtPlan);
  } catch {
    fail(
      'production-art-requirements-binding.invalid-shape',
      'Production art plan shape is invalid.',
    );
  }
  if (issues.length > 0) {
    fail(
      'production-art-requirements-binding.invalid-binding',
      `Production art plan is invalid: ${issues.map(({ code }) => code).join(', ')}.`,
    );
  }
  return value as unknown as ProductionArtPlan;
}

async function fingerprintProductionArtPlan(value: unknown): Promise<string> {
  return sha256(materializeProductionArtPlan(value));
}

function canonicalMappings(
  requirements: AssetRequirements,
  plan: ProductionArtPlan,
): readonly ProductionArtRequirementTaskMapping[] {
  const taskByRole = new Map<string, string>();
  for (const task of plan.tasks) {
    for (const { role } of task.role_mappings) taskByRole.set(role, task.task_id);
  }
  return Object.freeze(requirements.requirements.flatMap((requirement) => {
    if (requirement.binding.status !== 'canonical-role') return [];
    const taskId = taskByRole.get(requirement.binding.role);
    if (!taskId) {
      fail(
        'production-art-requirements-binding.invalid-binding',
        `No production art task maps canonical role ${requirement.binding.role}.`,
      );
    }
    return [Object.freeze({
      requirement_id: requirement.requirement_id,
      role: requirement.binding.role,
      task_id: taskId,
      variant_count: requirement.variant_count,
    })];
  }));
}

function canonicalBlockers(
  requirements: AssetRequirements,
): readonly ProductionArtRequirementsBlocker[] {
  return Object.freeze(requirements.requirements
    .filter((requirement) => (
      requirement.binding.status === 'unresolved'
      && requirement.usage === 'layout-critical'
    ))
    .map((requirement, index) => Object.freeze({
      blocker_id: `blocker-${String(index + 1).padStart(3, '0')}`,
      requirement_id: requirement.requirement_id,
      code: 'unresolved-layout-critical' as const,
    })));
}

async function deriveBinding(
  assetRequirementsValue: unknown,
  productionArtPlanValue: unknown,
): Promise<ProductionArtRequirementsBinding> {
  const requirements = await materializeAssetRequirements(assetRequirementsValue);
  const plan = materializeProductionArtPlan(productionArtPlanValue);
  if (requirements.profile !== plan.profile) {
    fail(
      'production-art-requirements-binding.invalid-binding',
      'Asset requirements and production art plan profiles do not match.',
    );
  }
  const source = Object.freeze({
    asset_requirements_sha256: await fingerprintAssetRequirements(requirements),
    production_art_plan_sha256: await fingerprintProductionArtPlan(plan),
  });
  const mappings = canonicalMappings(requirements, plan);
  const blockers = canonicalBlockers(requirements);
  const status = blockers.length > 0 ? 'blocked' as const : 'ready' as const;
  const bindingId = `requirements-binding-${(await sha256({
    profile: requirements.profile,
    status,
    source,
    mappings,
    blockers,
  })).slice(0, 16)}`;
  return Object.freeze({
    schema_version: PRODUCTION_ART_REQUIREMENTS_BINDING_VERSION,
    document_type: 'production-art-requirements-binding',
    binding_id: bindingId,
    profile: requirements.profile,
    status,
    source,
    mappings,
    blockers,
  });
}

function materializeMappings(value: unknown): readonly ProductionArtRequirementTaskMapping[] {
  if (!Array.isArray(value)) {
    fail(
      'production-art-requirements-binding.invalid-shape',
      'Production art requirements mappings must be an array.',
    );
  }
  const requirementIds = new Set<string>();
  return Object.freeze(value.map((mapping, index) => {
    if (!isRecord(mapping)) {
      fail(
        'production-art-requirements-binding.invalid-shape',
        `Production art requirements mapping ${index} must be an object.`,
      );
    }
    exactKeys(
      mapping,
      ['requirement_id', 'role', 'task_id', 'variant_count'],
      `Production art requirements mapping ${index}`,
    );
    const requirementId = safeId(
      mapping.requirement_id,
      `Production art requirements mapping ${index} requirement id`,
      REQUIREMENT_ID,
    );
    const role = safeId(
      mapping.role,
      `Production art requirements mapping ${index} role`,
      ROLE,
    );
    const taskId = safeId(
      mapping.task_id,
      `Production art requirements mapping ${index} task id`,
    );
    if (requirementIds.has(requirementId)) {
      fail(
        'production-art-requirements-binding.invalid-value',
        'Production art requirements mappings must have unique requirement ids.',
      );
    }
    requirementIds.add(requirementId);
    return Object.freeze({
      requirement_id: requirementId,
      role,
      task_id: taskId,
      variant_count: positiveInteger(
        mapping.variant_count,
        `Production art requirements mapping ${index} variant count`,
      ),
    });
  }));
}

function materializeBlockers(value: unknown): readonly ProductionArtRequirementsBlocker[] {
  if (!Array.isArray(value)) {
    fail(
      'production-art-requirements-binding.invalid-shape',
      'Production art requirements blockers must be an array.',
    );
  }
  const requirementIds = new Set<string>();
  return Object.freeze(value.map((blocker, index) => {
    if (!isRecord(blocker)) {
      fail(
        'production-art-requirements-binding.invalid-shape',
        `Production art requirements blocker ${index} must be an object.`,
      );
    }
    exactKeys(
      blocker,
      ['blocker_id', 'requirement_id', 'code'],
      `Production art requirements blocker ${index}`,
    );
    const blockerId = safeId(
      blocker.blocker_id,
      `Production art requirements blocker ${index} id`,
      BLOCKER_ID,
    );
    if (blockerId !== `blocker-${String(index + 1).padStart(3, '0')}`) {
      fail(
        'production-art-requirements-binding.invalid-value',
        'Production art requirements blocker ids must be canonical and ordered.',
      );
    }
    const requirementId = safeId(
      blocker.requirement_id,
      `Production art requirements blocker ${index} requirement id`,
      REQUIREMENT_ID,
    );
    if (requirementIds.has(requirementId)) {
      fail(
        'production-art-requirements-binding.invalid-value',
        'Production art requirements blockers must reference unique requirements.',
      );
    }
    requirementIds.add(requirementId);
    if (blocker.code !== 'unresolved-layout-critical') {
      fail(
        'production-art-requirements-binding.invalid-value',
        'Production art requirements blocker code is unsupported.',
      );
    }
    return Object.freeze({
      blocker_id: blockerId,
      requirement_id: requirementId,
      code: 'unresolved-layout-critical' as const,
    });
  }));
}

export async function materializeProductionArtRequirementsBinding(
  value: unknown,
  expected?: ExpectedSources,
): Promise<ProductionArtRequirementsBinding> {
  if (!isRecord(value)) {
    fail(
      'production-art-requirements-binding.invalid-shape',
      'Production art requirements binding must be an object.',
    );
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'binding_id',
    'profile',
    'status',
    'source',
    'mappings',
    'blockers',
  ], 'Production art requirements binding');
  if (
    value.schema_version !== PRODUCTION_ART_REQUIREMENTS_BINDING_VERSION
    || value.document_type !== 'production-art-requirements-binding'
  ) {
    fail(
      'production-art-requirements-binding.invalid-value',
      'Production art requirements binding must be a 1.0.0 document.',
    );
  }
  if (!isWorldAssetProfile(value.profile)) {
    fail(
      'production-art-requirements-binding.invalid-value',
      'Production art requirements binding profile is unsupported.',
    );
  }
  if (
    typeof value.binding_id !== 'string'
    || !/^requirements-binding-[a-f0-9]{16}$/.test(value.binding_id)
  ) {
    fail(
      'production-art-requirements-binding.invalid-value',
      'Production art requirements binding id is invalid.',
    );
  }
  if (value.status !== 'ready' && value.status !== 'blocked') {
    fail(
      'production-art-requirements-binding.invalid-value',
      'Production art requirements binding status is unsupported.',
    );
  }
  if (!isRecord(value.source)) {
    fail(
      'production-art-requirements-binding.invalid-shape',
      'Production art requirements binding source must be an object.',
    );
  }
  exactKeys(
    value.source,
    ['asset_requirements_sha256', 'production_art_plan_sha256'],
    'Production art requirements binding source',
  );
  const source = Object.freeze({
    asset_requirements_sha256: digest(
      value.source.asset_requirements_sha256,
      'Asset requirements digest',
    ),
    production_art_plan_sha256: digest(
      value.source.production_art_plan_sha256,
      'Production art plan digest',
    ),
  });
  const mappings = materializeMappings(value.mappings);
  const blockers = materializeBlockers(value.blockers);
  const mappedRequirementIds = new Set(mappings.map(({ requirement_id: id }) => id));
  if (blockers.some(({ requirement_id: id }) => mappedRequirementIds.has(id))) {
    fail(
      'production-art-requirements-binding.invalid-binding',
      'A requirement cannot be both task-mapped and blocked.',
    );
  }
  if (
    (value.status === 'ready' && blockers.length !== 0)
    || (value.status === 'blocked' && blockers.length === 0)
  ) {
    fail(
      'production-art-requirements-binding.invalid-binding',
      'Production art requirements status must agree with its blockers.',
    );
  }
  const expectedId = `requirements-binding-${(await sha256({
    profile: value.profile,
    status: value.status,
    source,
    mappings,
    blockers,
  })).slice(0, 16)}`;
  if (value.binding_id !== expectedId) {
    fail(
      'production-art-requirements-binding.invalid-binding',
      'Production art requirements binding id does not match its contents.',
    );
  }
  const materialized = Object.freeze({
    schema_version: PRODUCTION_ART_REQUIREMENTS_BINDING_VERSION,
    document_type: 'production-art-requirements-binding' as const,
    binding_id: expectedId,
    profile: value.profile,
    status: value.status,
    source,
    mappings,
    blockers,
  });
  if (expected !== undefined) {
    const canonical = await deriveBinding(
      expected.assetRequirements,
      expected.productionArtPlan,
    );
    if (canonicalJson(materialized) !== canonicalJson(canonical)) {
      fail(
        'production-art-requirements-binding.invalid-binding',
        'Production art requirements binding does not match its source artifacts.',
      );
    }
  }
  return materialized;
}

export async function buildProductionArtRequirementsBinding(
  assetRequirementsValue: unknown,
  productionArtPlanValue: unknown,
): Promise<ProductionArtRequirementsBinding> {
  const binding = await deriveBinding(assetRequirementsValue, productionArtPlanValue);
  return materializeProductionArtRequirementsBinding(binding, {
    assetRequirements: assetRequirementsValue,
    productionArtPlan: productionArtPlanValue,
  });
}

export async function fingerprintProductionArtRequirementsBinding(
  value: unknown,
): Promise<string> {
  return sha256(await materializeProductionArtRequirementsBinding(value));
}

export async function serializeCanonicalProductionArtRequirementsBinding(
  value: unknown,
): Promise<Uint8Array> {
  const binding = await materializeProductionArtRequirementsBinding(value);
  return new TextEncoder().encode(`${canonicalJson(binding)}\n`);
}
