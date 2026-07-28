import type {
  ProductionArtPlan,
  ProductionArtTask,
} from './production-art-contract';
import type {
  ProductionArtPlanV1_1,
  ProductionArtTaskV1_1,
} from './production-art-contract-v1-1';
import type { WorldAssetProfile } from './asset-profile';

export const PRODUCTION_ART_WORKFLOW_VERSION = '1.0.0' as const;

export const PRODUCTION_ART_WORKFLOW_QUALITIES = Object.freeze([
  'low',
  'medium',
  'high',
] as const);
export type ProductionArtWorkflowQuality =
  typeof PRODUCTION_ART_WORKFLOW_QUALITIES[number];

export type ProductionArtWorkflowTaskStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'rejected'
  | 'uncertain';

export interface ProductionArtWorkflowArtifact {
  readonly run_directory: string;
  readonly source_sha256: string;
  readonly normalized_sha256: string;
  readonly character_profile?: {
    readonly profile_revision_id: string;
    readonly profile_revision_sha256: string;
    readonly atlas_sha256: string;
  };
}

export interface ProductionArtWorkflowAttempt {
  readonly attempt: number;
  readonly request_ordinal: number;
  readonly status: Exclude<ProductionArtWorkflowTaskStatus, 'pending'>;
  readonly artifact?: ProductionArtWorkflowArtifact;
  readonly error_code?: string;
}

export interface ProductionArtWorkflowTaskState {
  readonly task_id: string;
  readonly status: ProductionArtWorkflowTaskStatus;
  readonly attempts: readonly ProductionArtWorkflowAttempt[];
}

export interface ProductionArtPrivateInputBinding {
  readonly confirmed_intake_sha256: string;
  readonly seed: string;
  readonly character_identity_digest_sha256: string;
  readonly environment_reference_id: string;
  readonly character_reference_id: string;
}

export interface ProductionArtWorkflowState {
  readonly schema_version: typeof PRODUCTION_ART_WORKFLOW_VERSION;
  readonly document_type: 'production-art-workflow-state';
  readonly state_revision: number;
  readonly workflow_id: string;
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly provider: {
    readonly id: string;
    readonly model: string;
    readonly quality: ProductionArtWorkflowQuality;
  };
  /**
   * A caller-created digest that binds private inputs without storing their
   * contents, paths, filenames, or individual raw digests in this state.
   */
  readonly input_binding_sha256: string;
  /**
   * Neutral lineage fields copied from the confirmed intake. These values are
   * safe to persist, while source paths, source bytes, and raw image digests
   * remain outside workflow state.
   */
  readonly private_input_binding: ProductionArtPrivateInputBinding;
  readonly approved_direction_sha256?: string;
  readonly request_budget: number;
  readonly requests_started: number;
  readonly tasks: readonly ProductionArtWorkflowTaskState[];
}

export type ProductionArtWorkflowPhase =
  | 'ready'
  | 'awaiting-scene-direction'
  | 'awaiting-direction-approval'
  | 'running'
  | 'review-required'
  | 'budget-exhausted'
  | 'complete';

export type ProductionArtWorkflowPlan =
  | ProductionArtPlan
  | ProductionArtPlanV1_1;

export type ProductionArtWorkflowPlanTask =
  | ProductionArtTask
  | ProductionArtTaskV1_1;

export interface ProductionArtWorkflowSelection {
  readonly phase: ProductionArtWorkflowPhase;
  readonly task_id?: string;
}

export interface CreateProductionArtWorkflowInput {
  readonly workflowId: string;
  readonly plan: ProductionArtWorkflowPlan;
  readonly provider: {
    readonly id: string;
    readonly model: string;
    readonly quality: ProductionArtWorkflowQuality;
  };
  readonly inputBindingSha256: string;
  readonly privateInputBinding: ProductionArtPrivateInputBinding;
  readonly requestBudget: number;
}

export interface CompleteProductionArtWorkflowTaskInput {
  readonly expectedStateRevision: number;
  readonly taskId: string;
  readonly attempt: number;
  readonly outcome: 'succeeded' | 'rejected' | 'uncertain';
  readonly artifact?: ProductionArtWorkflowArtifact;
  readonly errorCode?: string;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PROVIDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SAFE_ERROR_CODE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_REQUEST_BUDGET = 64;

export class ProductionArtWorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionArtWorkflowError';
  }
}

function fail(code: string, message: string): never {
  throw new ProductionArtWorkflowError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length
    && keys.every((key, index) => key === wanted[index]);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function cloneState(state: ProductionArtWorkflowState): ProductionArtWorkflowState {
  return JSON.parse(JSON.stringify(state)) as ProductionArtWorkflowState;
}

function validPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}

function validNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validPrivateInputBinding(
  value: unknown,
): value is ProductionArtPrivateInputBinding {
  return isPlainObject(value)
    && exactKeys(value, [
      'character_identity_digest_sha256',
      'character_reference_id',
      'confirmed_intake_sha256',
      'environment_reference_id',
      'seed',
    ])
    && typeof value.confirmed_intake_sha256 === 'string'
    && SHA256.test(value.confirmed_intake_sha256)
    && typeof value.character_identity_digest_sha256 === 'string'
    && SHA256.test(value.character_identity_digest_sha256)
    && typeof value.seed === 'string'
    && value.seed.length >= 1
    && value.seed.length <= 160
    && value.seed.trim() === value.seed
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value.seed)
    && typeof value.environment_reference_id === 'string'
    && value.environment_reference_id.length <= 80
    && SAFE_ID.test(value.environment_reference_id)
    && typeof value.character_reference_id === 'string'
    && value.character_reference_id.length <= 80
    && SAFE_ID.test(value.character_reference_id)
    && value.environment_reference_id !== value.character_reference_id;
}

function safeArtifactDirectory(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 600
    || value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) =>
    segment.length > 0
    && segment.length <= 120
    && segment !== '.'
    && segment !== '..'
    && /^[A-Za-z0-9._-]+$/.test(segment));
}

function assertPlanIdentity(
  state: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
): void {
  if (state.plan_id !== plan.plan_id || state.profile !== plan.profile) {
    fail(
      'workflow.plan-mismatch',
      'Workflow state does not match the supplied production-art plan.',
    );
  }
  const expectedIds = plan.tasks.map(({ task_id: taskId }) => taskId);
  const actualIds = state.tasks.map(({ task_id: taskId }) => taskId);
  if (
    actualIds.length !== expectedIds.length
    || actualIds.some((taskId, index) => taskId !== expectedIds[index])
  ) {
    fail(
      'workflow.task-inventory-mismatch',
      'Workflow task order does not match the canonical production-art plan.',
    );
  }
}

function sceneTask(
  plan: ProductionArtWorkflowPlan,
): ProductionArtWorkflowPlanTask | undefined {
  return plan.tasks.find(({ task_id: taskId }) =>
    taskId === 'scene-direction');
}

function isLegacyPlayerTask(task: ProductionArtWorkflowPlanTask): boolean {
  return 'role_mappings' in task
    && task.kind === 'character-animation-sheet'
    && task.role_mappings.length === 1
    && task.role_mappings[0].role === 'character.player.atlas';
}

function validateArtifact(value: unknown): value is ProductionArtWorkflowArtifact {
  if (!isPlainObject(value)) return false;
  const hasCharacterProfile = Object.prototype.hasOwnProperty.call(
    value,
    'character_profile',
  );
  return exactKeys(value, [
    'run_directory',
    'source_sha256',
    'normalized_sha256',
    ...(hasCharacterProfile ? ['character_profile'] : []),
  ])
    && safeArtifactDirectory(value.run_directory)
    && typeof value.source_sha256 === 'string'
    && SHA256.test(value.source_sha256)
    && typeof value.normalized_sha256 === 'string'
    && SHA256.test(value.normalized_sha256)
    && (
      !hasCharacterProfile
      || (
        isPlainObject(value.character_profile)
        && exactKeys(value.character_profile, [
          'atlas_sha256',
          'profile_revision_id',
          'profile_revision_sha256',
        ])
        && typeof value.character_profile.profile_revision_id === 'string'
        && value.character_profile.profile_revision_id.length <= 100
        && SAFE_ID.test(value.character_profile.profile_revision_id)
        && typeof value.character_profile.profile_revision_sha256 === 'string'
        && SHA256.test(value.character_profile.profile_revision_sha256)
        && typeof value.character_profile.atlas_sha256 === 'string'
        && SHA256.test(value.character_profile.atlas_sha256)
      )
    );
}

function validateAttempt(
  value: unknown,
  expectedAttempt: number,
  maximumRequestOrdinal: number,
): value is ProductionArtWorkflowAttempt {
  if (!isPlainObject(value)) return false;
  const status = value.status;
  if (!['running', 'succeeded', 'rejected', 'uncertain'].includes(status as string)) {
    return false;
  }
  const expectedKeys = status === 'running'
    ? ['attempt', 'request_ordinal', 'status']
    : status === 'succeeded'
      ? ['artifact', 'attempt', 'request_ordinal', 'status']
      : status === 'rejected'
        ? ['artifact', 'attempt', 'error_code', 'request_ordinal', 'status']
        : ['attempt', 'error_code', 'request_ordinal', 'status'];
  if (!exactKeys(value, expectedKeys)) return false;
  if (
    value.attempt !== expectedAttempt
    || !validPositiveInteger(value.request_ordinal, maximumRequestOrdinal)
  ) {
    return false;
  }
  if (
    (status === 'succeeded' || status === 'rejected')
    && !validateArtifact(value.artifact)
  ) {
    return false;
  }
  if (
    (status === 'rejected' || status === 'uncertain')
    && (
      typeof value.error_code !== 'string'
      || value.error_code.length > 100
      || !SAFE_ERROR_CODE.test(value.error_code)
    )
  ) {
    return false;
  }
  return true;
}

export function parseProductionArtWorkflowState(
  value: unknown,
  plan: ProductionArtWorkflowPlan,
): ProductionArtWorkflowState {
  if (
    !isPlainObject(value)
    || !exactKeys(value, [
      'document_type',
      'input_binding_sha256',
      'plan_id',
      'private_input_binding',
      'profile',
      'provider',
      'request_budget',
      'requests_started',
      'schema_version',
      'state_revision',
      'tasks',
      'workflow_id',
      ...(Object.prototype.hasOwnProperty.call(value, 'approved_direction_sha256')
        ? ['approved_direction_sha256']
        : []),
    ])
    || value.schema_version !== PRODUCTION_ART_WORKFLOW_VERSION
    || value.document_type !== 'production-art-workflow-state'
    || !validNonNegativeInteger(value.state_revision)
    || typeof value.workflow_id !== 'string'
    || value.workflow_id.length > 80
    || !SAFE_ID.test(value.workflow_id)
    || value.plan_id !== plan.plan_id
    || value.profile !== plan.profile
    || typeof value.input_binding_sha256 !== 'string'
    || !SHA256.test(value.input_binding_sha256)
    || !validPrivateInputBinding(value.private_input_binding)
    || (value.approved_direction_sha256 !== undefined
      && (
        typeof value.approved_direction_sha256 !== 'string'
        || !SHA256.test(value.approved_direction_sha256)
      ))
    || !validPositiveInteger(value.request_budget, MAX_REQUEST_BUDGET)
    || !validNonNegativeInteger(value.requests_started)
    || (value.requests_started as number) > (value.request_budget as number)
    || (value.state_revision as number) < (value.requests_started as number)
    || !isPlainObject(value.provider)
    || !exactKeys(value.provider, ['id', 'model', 'quality'])
    || typeof value.provider.id !== 'string'
    || value.provider.id.length > 80
    || !SAFE_PROVIDER_ID.test(value.provider.id)
    || typeof value.provider.model !== 'string'
    || value.provider.model.length > 80
    || !SAFE_MODEL_ID.test(value.provider.model)
    || !PRODUCTION_ART_WORKFLOW_QUALITIES.includes(
      value.provider.quality as ProductionArtWorkflowQuality,
    )
    || !Array.isArray(value.tasks)
    || value.tasks.length !== plan.tasks.length
  ) {
    fail('workflow.invalid-state', 'Production-art workflow state is invalid.');
  }

  const requestOrdinals = new Set<number>();
  let latestRequestOrdinal = 0;
  let runningTasks = 0;
  let downstreamAttempts = 0;
  for (let index = 0; index < value.tasks.length; index += 1) {
    const candidate = value.tasks[index];
    const expectedTask = plan.tasks[index];
    if (
      !isPlainObject(candidate)
      || !exactKeys(candidate, ['attempts', 'status', 'task_id'])
      || candidate.task_id !== expectedTask.task_id
      || !['pending', 'running', 'succeeded', 'rejected', 'uncertain']
        .includes(candidate.status as string)
      || !Array.isArray(candidate.attempts)
    ) {
      fail('workflow.invalid-state', 'Production-art workflow task state is invalid.');
    }
    if (
      candidate.status === 'pending'
      && candidate.attempts.length !== 0
    ) {
      fail('workflow.invalid-state', 'A pending workflow task cannot have attempts.');
    }
    if (
      candidate.status !== 'pending'
      && candidate.attempts.length < 1
    ) {
      fail('workflow.invalid-state', 'A started workflow task requires an attempt.');
    }
    if (candidate.status === 'running') runningTasks += 1;
    if (expectedTask.task_id !== 'scene-direction') {
      downstreamAttempts += candidate.attempts.length;
    }
    for (let attemptIndex = 0; attemptIndex < candidate.attempts.length; attemptIndex += 1) {
      const attempt = candidate.attempts[attemptIndex];
      if (!validateAttempt(attempt, attemptIndex + 1, value.requests_started as number)) {
        fail('workflow.invalid-state', 'Production-art workflow attempt is invalid.');
      }
      if (requestOrdinals.has(attempt.request_ordinal)) {
        fail('workflow.invalid-state', 'Remote request ordinals must be globally unique.');
      }
      requestOrdinals.add(attempt.request_ordinal);
      latestRequestOrdinal = Math.max(latestRequestOrdinal, attempt.request_ordinal);
      if (
        attemptIndex < candidate.attempts.length - 1
        && !['rejected', 'uncertain'].includes(attempt.status)
      ) {
        fail(
          'workflow.invalid-state',
          'Only rejected or uncertain attempts can precede an explicit retry.',
        );
      }
    }
    const latest = candidate.attempts.at(-1);
    if (latest && latest.status !== candidate.status) {
      fail('workflow.invalid-state', 'Task status must match its latest attempt.');
    }
    const latestArtifact = latest?.artifact;
    const isPlayerTask = isLegacyPlayerTask(expectedTask);
    if (
      latestArtifact
      && (
        (
          isPlayerTask
          && latest?.status === 'succeeded'
          && !latestArtifact.character_profile
        )
        || (!isPlayerTask && latestArtifact.character_profile)
      )
    ) {
      fail(
        'workflow.invalid-state',
        'Portable character metadata must appear on successful player artifacts only.',
      );
    }
  }
  if (
    requestOrdinals.size !== value.requests_started
    || latestRequestOrdinal !== value.requests_started
    || runningTasks > 1
  ) {
    fail(
      'workflow.invalid-state',
      'Remote request accounting must be contiguous and conservative.',
    );
  }
  const state = value as unknown as ProductionArtWorkflowState;
  const plannedScene = sceneTask(plan);
  if (plannedScene) {
    const parsedScene = state.tasks.find(({ task_id: taskId }) =>
      taskId === plannedScene.task_id)!;
    const parsedDirectionDigest =
      parsedScene.attempts.at(-1)?.artifact?.normalized_sha256;
    if (
      downstreamAttempts > 0
      && (
        parsedScene.status !== 'succeeded'
        || !state.approved_direction_sha256
        || state.approved_direction_sha256 !== parsedDirectionDigest
      )
    ) {
      fail(
        'workflow.invalid-state',
        'Downstream attempts require the exact successful scene-direction binding.',
      );
    }
    if (
      state.approved_direction_sha256
      && (
        downstreamAttempts === 0
        || state.approved_direction_sha256 !== parsedDirectionDigest
      )
    ) {
      fail(
        'workflow.invalid-state',
        'Approved direction binding is not backed by downstream workflow state.',
      );
    }
  } else if (
    (downstreamAttempts > 0 && !state.approved_direction_sha256)
    || (downstreamAttempts === 0 && state.approved_direction_sha256)
  ) {
    fail(
      'workflow.invalid-state',
      'Plan 1.1 attempts require one frozen externally approved direction binding.',
    );
  }
  assertPlanIdentity(state, plan);
  return deepFreeze(cloneState(state));
}

export function createProductionArtWorkflowState(
  input: CreateProductionArtWorkflowInput,
): ProductionArtWorkflowState {
  const { plan } = input;
  if (
    !SAFE_ID.test(input.workflowId)
    || input.workflowId.length > 80
    || !SAFE_PROVIDER_ID.test(input.provider.id)
    || input.provider.id.length > 80
    || !SAFE_MODEL_ID.test(input.provider.model)
    || input.provider.model.length > 80
    || !PRODUCTION_ART_WORKFLOW_QUALITIES.includes(input.provider.quality)
    || !SHA256.test(input.inputBindingSha256)
    || !validPrivateInputBinding(input.privateInputBinding)
    || !validPositiveInteger(input.requestBudget, MAX_REQUEST_BUDGET)
  ) {
    fail('workflow.invalid-input', 'Production-art workflow input is invalid.');
  }
  return deepFreeze({
    schema_version: PRODUCTION_ART_WORKFLOW_VERSION,
    document_type: 'production-art-workflow-state',
    state_revision: 0,
    workflow_id: input.workflowId,
    plan_id: plan.plan_id,
    profile: plan.profile,
    provider: {
      id: input.provider.id,
      model: input.provider.model,
      quality: input.provider.quality,
    },
    input_binding_sha256: input.inputBindingSha256,
    private_input_binding: {
      ...input.privateInputBinding,
    },
    request_budget: input.requestBudget,
    requests_started: 0,
    tasks: plan.tasks.map(({ task_id: taskId }) => ({
      task_id: taskId,
      status: 'pending' as const,
      attempts: [],
    })),
  });
}

function sceneState(
  state: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
): ProductionArtWorkflowTaskState {
  if (!sceneTask(plan)) {
    fail('workflow.scene-task-missing', 'Canonical workflow has no scene-direction task.');
  }
  const scene = state.tasks.find(({ task_id: taskId }) => taskId === 'scene-direction');
  if (!scene) {
    fail('workflow.scene-task-missing', 'Canonical workflow has no scene-direction task.');
  }
  return scene;
}

function directionDigest(
  state: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
): string | undefined {
  return sceneState(state, plan).attempts.at(-1)?.artifact?.normalized_sha256;
}

function validateDirectionApproval(
  state: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
  approvedDirectionSha256: string | undefined,
): boolean {
  const selectedDirectionSha256 = approvedDirectionSha256
    ?? state.approved_direction_sha256;
  if (!selectedDirectionSha256) return false;
  if (!SHA256.test(selectedDirectionSha256)) {
    fail('workflow.direction-invalid', 'Approved direction digest must be canonical SHA-256.');
  }
  if (sceneTask(plan)) {
    const expected = directionDigest(state, plan);
    if (!expected || selectedDirectionSha256 !== expected) {
      fail(
        'workflow.direction-mismatch',
        'Approved direction must exactly match the successful scene-direction output.',
      );
    }
  }
  if (
    state.approved_direction_sha256
    && state.approved_direction_sha256 !== selectedDirectionSha256
  ) {
    fail(
      'workflow.direction-replaced',
      'A workflow cannot replace its frozen approved scene direction.',
    );
  }
  return true;
}

export function selectNextProductionArtWorkflowTask(
  state: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
  approvedDirectionSha256?: string,
): ProductionArtWorkflowSelection {
  assertPlanIdentity(state, plan);
  if (state.tasks.some(({ status }) => status === 'running')) {
    return Object.freeze({ phase: 'running' });
  }

  const plannedScene = sceneTask(plan);
  if (plannedScene) {
    const scene = sceneState(state, plan);
    if (scene.status === 'pending') {
      return Object.freeze({ phase: 'ready', task_id: scene.task_id });
    }
    if (scene.status !== 'succeeded') {
      return Object.freeze({ phase: 'awaiting-scene-direction' });
    }
  }
  if (!validateDirectionApproval(state, plan, approvedDirectionSha256)) {
    return Object.freeze({ phase: 'awaiting-direction-approval' });
  }
  if (state.tasks.every(({ status }) => status === 'succeeded')) {
    return Object.freeze({ phase: 'complete' });
  }
  if (state.requests_started >= state.request_budget) {
    return Object.freeze({ phase: 'budget-exhausted' });
  }

  if (state.tasks.some(({ status }) => status === 'rejected' || status === 'uncertain')) {
    return Object.freeze({ phase: 'review-required' });
  }
  const next = state.tasks.find(({ status, task_id: taskId }) =>
    taskId !== 'scene-direction' && status === 'pending');
  if (next) return Object.freeze({ phase: 'ready', task_id: next.task_id });
  return Object.freeze({ phase: 'complete' });
}

function taskById(
  state: ProductionArtWorkflowState,
  taskId: string,
): ProductionArtWorkflowTaskState {
  const task = state.tasks.find(({ task_id: id }) => id === taskId);
  if (!task) fail('workflow.task-unknown', `Unknown production-art task: ${taskId}.`);
  return task;
}

function planTaskById(
  plan: ProductionArtWorkflowPlan,
  taskId: string,
): ProductionArtWorkflowPlanTask {
  const task = plan.tasks.find(({ task_id: id }) => id === taskId);
  if (!task) fail('workflow.task-unknown', `Unknown production-art task: ${taskId}.`);
  return task;
}

export function beginProductionArtWorkflowTask(
  state: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
  input: {
    readonly expectedStateRevision: number;
    readonly taskId: string;
    readonly approvedDirectionSha256?: string;
    readonly acknowledgeDuplicateCostRisk?: boolean;
  },
): ProductionArtWorkflowState {
  assertPlanIdentity(state, plan);
  if (input.expectedStateRevision !== state.state_revision) {
    fail('workflow.stale-state', 'Workflow state revision is stale.');
  }
  if (state.tasks.some(({ status }) => status === 'running')) {
    fail('workflow.concurrent-task', 'Only one remote production-art task may run at a time.');
  }
  if (state.requests_started >= state.request_budget) {
    fail('workflow.budget-exhausted', 'Remote request budget is exhausted.');
  }
  const task = taskById(state, input.taskId);
  planTaskById(plan, input.taskId);
  const retry = task.status === 'rejected' || task.status === 'uncertain';
  if (
    task.status === 'succeeded'
    || task.status === 'running'
    || (retry && input.acknowledgeDuplicateCostRisk !== true)
  ) {
    fail(
      retry ? 'workflow.retry-acknowledgement-required' : 'workflow.task-not-runnable',
      retry
        ? 'Retry requires explicit acknowledgement that another request may be billed.'
        : 'Task is not runnable in its current state.',
    );
  }
  if (task.status !== 'pending' && !retry) {
    fail('workflow.task-not-runnable', 'Task is not runnable in its current state.');
  }
  if (!retry) {
    const selected = selectNextProductionArtWorkflowTask(
      state,
      plan,
      input.approvedDirectionSha256,
    );
    if (selected.task_id !== input.taskId) {
      fail(
        'workflow.task-out-of-order',
        'Pending workflow tasks must start in canonical plan order.',
      );
    }
  }

  if (input.taskId === 'scene-direction') {
    if (task.attempts.length > 0 && !retry) {
      fail('workflow.task-not-runnable', 'Scene direction has already been attempted.');
    }
  } else {
    if (sceneTask(plan)) {
      const scene = sceneState(state, plan);
      if (scene.status !== 'succeeded') {
        fail(
          'workflow.scene-direction-required',
          'Downstream art tasks require a successful scene-direction task.',
        );
      }
    }
    validateDirectionApproval(state, plan, input.approvedDirectionSha256);
  }

  const next = cloneState(state);
  const mutableTask = next.tasks.find(
    ({ task_id: id }) => id === input.taskId,
  ) as ProductionArtWorkflowTaskState;
  const requestOrdinal = state.requests_started + 1;
  const attempt: ProductionArtWorkflowAttempt = {
    attempt: mutableTask.attempts.length + 1,
    request_ordinal: requestOrdinal,
    status: 'running',
  };
  const replacement: ProductionArtWorkflowTaskState = {
    task_id: mutableTask.task_id,
    status: 'running',
    attempts: [...mutableTask.attempts, attempt],
  };
  const taskIndex = next.tasks.findIndex(({ task_id: id }) => id === input.taskId);
  (next.tasks as ProductionArtWorkflowTaskState[])[taskIndex] = replacement;
  (next as { state_revision: number }).state_revision += 1;
  (next as { requests_started: number }).requests_started = requestOrdinal;
  if (input.taskId !== 'scene-direction') {
    (next as { approved_direction_sha256?: string }).approved_direction_sha256 =
      input.approvedDirectionSha256 ?? state.approved_direction_sha256;
  }
  return deepFreeze(next);
}

export function completeProductionArtWorkflowTask(
  state: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
  input: CompleteProductionArtWorkflowTaskInput,
): ProductionArtWorkflowState {
  assertPlanIdentity(state, plan);
  if (input.expectedStateRevision !== state.state_revision) {
    fail('workflow.stale-state', 'Workflow state revision is stale.');
  }
  const task = taskById(state, input.taskId);
  const latest = task.attempts.at(-1);
  if (
    task.status !== 'running'
    || !latest
    || latest.status !== 'running'
    || latest.attempt !== input.attempt
  ) {
    fail('workflow.attempt-not-running', 'The selected workflow attempt is not running.');
  }
  if (
    (input.outcome === 'succeeded' || input.outcome === 'rejected')
    && !validateArtifact(input.artifact)
  ) {
    fail('workflow.artifact-invalid', 'Completed task artifact metadata is invalid.');
  }
  if (
    input.outcome === 'succeeded'
    && input.errorCode !== undefined
  ) {
    fail('workflow.outcome-invalid', 'A successful task cannot carry an error code.');
  }
  if (
    (input.outcome === 'rejected' || input.outcome === 'uncertain')
    && (
      !input.errorCode
      || input.errorCode.length > 100
      || !SAFE_ERROR_CODE.test(input.errorCode)
    )
  ) {
    fail('workflow.outcome-invalid', 'Rejected or uncertain tasks require a safe error code.');
  }
  if (input.outcome === 'uncertain' && input.artifact !== undefined) {
    fail('workflow.outcome-invalid', 'An uncertain task cannot claim a verified artifact.');
  }

  const next = cloneState(state);
  const taskIndex = next.tasks.findIndex(({ task_id: id }) => id === input.taskId);
  const mutableTask = next.tasks[taskIndex];
  const attempts = [...mutableTask.attempts];
  attempts[attempts.length - 1] = {
    attempt: latest.attempt,
    request_ordinal: latest.request_ordinal,
    status: input.outcome,
    ...(input.artifact ? { artifact: input.artifact } : {}),
    ...(input.errorCode ? { error_code: input.errorCode } : {}),
  };
  (next.tasks as ProductionArtWorkflowTaskState[])[taskIndex] = {
    task_id: mutableTask.task_id,
    status: input.outcome,
    attempts,
  };
  (next as { state_revision: number }).state_revision += 1;
  return parseProductionArtWorkflowState(next, plan);
}

export function reconcileProductionArtWorkflowTask(
  state: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
  input: {
    readonly expectedStateRevision: number;
    readonly taskId: string;
    readonly artifact: ProductionArtWorkflowArtifact;
  },
): ProductionArtWorkflowState {
  assertPlanIdentity(state, plan);
  if (input.expectedStateRevision !== state.state_revision) {
    fail('workflow.stale-state', 'Workflow state revision is stale.');
  }
  const task = taskById(state, input.taskId);
  const latest = task.attempts.at(-1);
  if (
    task.status !== 'uncertain'
    || !latest
    || latest.status !== 'uncertain'
    || !validateArtifact(input.artifact)
  ) {
    fail(
      'workflow.reconcile-invalid',
      'Only an uncertain attempt can be reconciled with a verified artifact.',
    );
  }
  const next = cloneState(state);
  const taskIndex = next.tasks.findIndex(({ task_id: id }) => id === input.taskId);
  const attempts = [...next.tasks[taskIndex].attempts];
  attempts[attempts.length - 1] = {
    attempt: latest.attempt,
    request_ordinal: latest.request_ordinal,
    status: 'succeeded',
    artifact: input.artifact,
  };
  (next.tasks as ProductionArtWorkflowTaskState[])[taskIndex] = {
    task_id: input.taskId,
    status: 'succeeded',
    attempts,
  };
  (next as { state_revision: number }).state_revision += 1;
  return parseProductionArtWorkflowState(next, plan);
}
