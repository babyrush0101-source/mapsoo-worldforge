import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';
import type { ProductionArtTaskKind } from './production-art-contract';
import {
  parseProductionArtWorkflowState,
  selectNextProductionArtWorkflowTask,
  type ProductionArtWorkflowPhase,
  type ProductionArtWorkflowPlan,
  type ProductionArtWorkflowState,
  type ProductionArtWorkflowTaskStatus,
} from './production-art-workflow';

export const COMPLETE_WORLD_EXECUTION_SESSION_VERSION = '1.0.0' as const;

export type CompleteWorldExecutionScope =
  | 'scene-direction-only'
  | 'remaining-world'
  | 'none';

export type CompleteWorldExecutionBlockReason =
  | 'direction-approval-required'
  | 'scene-direction-review-required'
  | 'task-review-required'
  | 'workflow-running'
  | 'budget-insufficient'
  | 'budget-exhausted'
  | 'already-complete';

export interface CompleteWorldExecutionSnapshot {
  readonly schema_version:
    typeof COMPLETE_WORLD_EXECUTION_SESSION_VERSION;
  readonly document_type: 'complete-world-execution-snapshot';
  readonly workflow_id: string;
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly state_revision: number;
  readonly input_binding_sha256: string;
  readonly direction_binding_sha256?: string;
  readonly request_budget: number;
  readonly requests_started: number;
  readonly phase: ProductionArtWorkflowPhase;
  readonly next_task_id?: string;
  readonly tasks: readonly Readonly<{
    task_id: string;
    kind: ProductionArtTaskKind;
    status: ProductionArtWorkflowTaskStatus;
    attempts: number;
  }>[];
}

export interface CompleteWorldExecutionPreview {
  readonly schema_version:
    typeof COMPLETE_WORLD_EXECUTION_SESSION_VERSION;
  readonly document_type: 'complete-world-execution-preview';
  readonly session_id: string;
  readonly authorization_sha256: string;
  readonly workflow_id: string;
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly start_state_revision: number;
  readonly start_next_task_id?: string;
  readonly input_binding_sha256: string;
  readonly direction_binding_sha256?: string;
  readonly scope: CompleteWorldExecutionScope;
  readonly authorized_task_ids: readonly string[];
  readonly maximum_remote_requests: number;
  readonly workflow_requests_remaining: number;
  readonly executable: boolean;
  readonly block_reason?: CompleteWorldExecutionBlockReason;
  readonly retry_policy: 'never';
  readonly scene_direction_requires_separate_human_approval: true;
  readonly production_art_only: true;
  readonly runtime_ready: false;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_KINDS = Object.freeze([
  'scene-direction',
  'opaque-tile-sheet',
  'transparent-prop-sheet',
  'character-animation-sheet',
  'background-layer',
  'effect-sheet',
] as const satisfies readonly ProductionArtTaskKind[]);
const TASK_STATUSES = Object.freeze([
  'pending',
  'running',
  'succeeded',
  'rejected',
  'uncertain',
] as const satisfies readonly ProductionArtWorkflowTaskStatus[]);
const PHASES = Object.freeze([
  'ready',
  'awaiting-scene-direction',
  'awaiting-direction-approval',
  'running',
  'review-required',
  'budget-exhausted',
  'complete',
] as const satisfies readonly ProductionArtWorkflowPhase[]);

function fail(message: string): never {
  throw new Error(`Complete-world execution session: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) {
    fail(`${label} contains missing or unsupported fields.`);
  }
}

function safeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 120
    || !SAFE_ID.test(value)
  ) {
    fail(`${label} must be bounded lowercase kebab-case.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${label} must be a safe non-negative integer.`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed < 1 || parsed > 64) {
    fail(`${label} must be from 1 to 64.`);
  }
  return parsed;
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
    if (!Number.isFinite(value)) fail('canonical JSON cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (!isRecord(value)) fail('canonical JSON contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    freeze(child);
  }
  return Object.freeze(value);
}

export function createCompleteWorldExecutionSnapshot(
  stateValue: ProductionArtWorkflowState,
  plan: ProductionArtWorkflowPlan,
  approvedDirectionSha256?: string,
): CompleteWorldExecutionSnapshot {
  const state = parseProductionArtWorkflowState(stateValue, plan);
  const selection = selectNextProductionArtWorkflowTask(
    state,
    plan,
    approvedDirectionSha256,
  );
  const sceneTask = plan.tasks.find(({ kind }) => kind === 'scene-direction');
  const sceneState = sceneTask
    ? state.tasks.find(({ task_id: taskId }) => taskId === sceneTask.task_id)
    : undefined;
  const directionBinding = (
    sceneState
      ? sceneState.status === 'succeeded'
      : selection.phase !== 'awaiting-direction-approval'
  )
    ? state.approved_direction_sha256 ?? approvedDirectionSha256
    : undefined;
  const taskState = new Map(
    state.tasks.map((task) => [task.task_id, task] as const),
  );
  return freeze({
    schema_version: COMPLETE_WORLD_EXECUTION_SESSION_VERSION,
    document_type: 'complete-world-execution-snapshot',
    workflow_id: state.workflow_id,
    plan_id: state.plan_id,
    profile: state.profile,
    state_revision: state.state_revision,
    input_binding_sha256: state.input_binding_sha256,
    ...(directionBinding
      ? { direction_binding_sha256: directionBinding }
      : {}),
    request_budget: state.request_budget,
    requests_started: state.requests_started,
    phase: selection.phase,
    ...(selection.task_id ? { next_task_id: selection.task_id } : {}),
    tasks: plan.tasks.map((task) => {
      const current = taskState.get(task.task_id)!;
      return {
        task_id: task.task_id,
        kind: task.kind,
        status: current.status,
        attempts: current.attempts.length,
      };
    }),
  });
}

export function materializeCompleteWorldExecutionSnapshot(
  value: unknown,
): CompleteWorldExecutionSnapshot {
  if (!isRecord(value)) fail('snapshot root must be an object.');
  const hasDirection = 'direction_binding_sha256' in value;
  const hasNextTask = 'next_task_id' in value;
  exactKeys(
    value,
    [
      'schema_version',
      'document_type',
      'workflow_id',
      'plan_id',
      'profile',
      'state_revision',
      'input_binding_sha256',
      'request_budget',
      'requests_started',
      'phase',
      'tasks',
    ],
    [
      ...(hasDirection ? ['direction_binding_sha256'] : []),
      ...(hasNextTask ? ['next_task_id'] : []),
    ],
    'snapshot',
  );
  if (
    value.schema_version !== COMPLETE_WORLD_EXECUTION_SESSION_VERSION
    || value.document_type !== 'complete-world-execution-snapshot'
    || !WORLD_ASSET_PROFILES.includes(value.profile as WorldAssetProfile)
    || !PHASES.includes(value.phase as ProductionArtWorkflowPhase)
    || typeof value.input_binding_sha256 !== 'string'
    || !SHA256.test(value.input_binding_sha256)
    || (
      hasDirection
      && (
        typeof value.direction_binding_sha256 !== 'string'
        || !SHA256.test(value.direction_binding_sha256)
      )
    )
    || !Array.isArray(value.tasks)
    || value.tasks.length < 1
    || value.tasks.length > 64
  ) {
    fail('snapshot identity, phase, binding, or task inventory is invalid.');
  }
  const stateRevision = nonNegativeInteger(value.state_revision, 'state_revision');
  const requestBudget = positiveInteger(value.request_budget, 'request_budget');
  const requestsStarted = nonNegativeInteger(
    value.requests_started,
    'requests_started',
  );
  if (requestsStarted > requestBudget || stateRevision < requestsStarted) {
    fail('snapshot request accounting is inconsistent.');
  }
  const taskIds = new Set<string>();
  const tasks = value.tasks.map((taskValue, index) => {
    if (!isRecord(taskValue)) fail(`tasks[${index}] must be an object.`);
    exactKeys(
      taskValue,
      ['task_id', 'kind', 'status', 'attempts'],
      [],
      `tasks[${index}]`,
    );
    const taskId = safeId(taskValue.task_id, `tasks[${index}].task_id`);
    if (taskIds.has(taskId)) fail(`task id ${taskId} is duplicated.`);
    taskIds.add(taskId);
    if (
      !TASK_KINDS.includes(taskValue.kind as ProductionArtTaskKind)
      || !TASK_STATUSES.includes(
        taskValue.status as ProductionArtWorkflowTaskStatus,
      )
    ) {
      fail(`tasks[${index}] kind or status is unsupported.`);
    }
    const attempts = nonNegativeInteger(
      taskValue.attempts,
      `tasks[${index}].attempts`,
    );
    if (
      (taskValue.status === 'pending' && attempts !== 0)
      || (taskValue.status !== 'pending' && attempts < 1)
    ) {
      fail(`tasks[${index}] attempts do not match its status.`);
    }
    return Object.freeze({
      task_id: taskId,
      kind: taskValue.kind as ProductionArtTaskKind,
      status: taskValue.status as ProductionArtWorkflowTaskStatus,
      attempts,
    });
  });
  const nextTaskId = hasNextTask
    ? safeId(value.next_task_id, 'next_task_id')
    : undefined;
  if (
    nextTaskId
    && !tasks.some(({ task_id: taskId }) => taskId === nextTaskId)
  ) {
    fail('next_task_id is not in the task inventory.');
  }
  return freeze({
    schema_version: COMPLETE_WORLD_EXECUTION_SESSION_VERSION,
    document_type: 'complete-world-execution-snapshot',
    workflow_id: safeId(value.workflow_id, 'workflow_id'),
    plan_id: safeId(value.plan_id, 'plan_id'),
    profile: value.profile as WorldAssetProfile,
    state_revision: stateRevision,
    input_binding_sha256: value.input_binding_sha256,
    ...(hasDirection
      ? { direction_binding_sha256: value.direction_binding_sha256 as string }
      : {}),
    request_budget: requestBudget,
    requests_started: requestsStarted,
    phase: value.phase as ProductionArtWorkflowPhase,
    ...(nextTaskId ? { next_task_id: nextTaskId } : {}),
    tasks: Object.freeze(tasks),
  });
}

export async function createCompleteWorldExecutionPreview(
  snapshotValue: unknown,
): Promise<CompleteWorldExecutionPreview> {
  const snapshot = materializeCompleteWorldExecutionSnapshot(snapshotValue);
  const remainingBudget =
    snapshot.request_budget - snapshot.requests_started;
  const nextTask = snapshot.next_task_id
    ? snapshot.tasks.find(({ task_id: taskId }) =>
      taskId === snapshot.next_task_id)
    : undefined;
  let scope: CompleteWorldExecutionScope = 'none';
  let taskIds: readonly string[] = [];
  let blockReason: CompleteWorldExecutionBlockReason | undefined;
  if (
    snapshot.phase === 'ready'
    && nextTask?.kind === 'scene-direction'
  ) {
    scope = 'scene-direction-only';
    taskIds = [nextTask.task_id];
  } else if (
    snapshot.phase === 'ready'
    && nextTask
    && snapshot.direction_binding_sha256
  ) {
    scope = 'remaining-world';
    const startIndex = snapshot.tasks.findIndex(({ task_id: taskId }) =>
      taskId === nextTask.task_id);
    taskIds = snapshot.tasks
      .slice(startIndex)
      .filter(({ status }) => status === 'pending')
      .map(({ task_id: taskId }) => taskId);
  } else if (snapshot.phase === 'awaiting-direction-approval') {
    blockReason = 'direction-approval-required';
  } else if (snapshot.phase === 'awaiting-scene-direction') {
    blockReason = 'scene-direction-review-required';
  } else if (snapshot.phase === 'review-required') {
    blockReason = 'task-review-required';
  } else if (snapshot.phase === 'running') {
    blockReason = 'workflow-running';
  } else if (snapshot.phase === 'budget-exhausted') {
    blockReason = 'budget-exhausted';
  } else if (snapshot.phase === 'complete') {
    blockReason = 'already-complete';
  }
  if (taskIds.length > remainingBudget) {
    scope = 'none';
    taskIds = [];
    blockReason = 'budget-insufficient';
  }
  const authorizationBinding = {
    schema_version: COMPLETE_WORLD_EXECUTION_SESSION_VERSION,
    workflow_id: snapshot.workflow_id,
    plan_id: snapshot.plan_id,
    profile: snapshot.profile,
    start_state_revision: snapshot.state_revision,
    ...(snapshot.next_task_id
      ? { start_next_task_id: snapshot.next_task_id }
      : {}),
    input_binding_sha256: snapshot.input_binding_sha256,
    ...(snapshot.direction_binding_sha256
      ? { direction_binding_sha256: snapshot.direction_binding_sha256 }
      : {}),
    scope,
    authorized_task_ids: taskIds,
    maximum_remote_requests: taskIds.length,
    workflow_requests_remaining: remainingBudget,
    retry_policy: 'never',
  };
  const authorizationSha256 = await sha256(authorizationBinding);
  return freeze({
    schema_version: COMPLETE_WORLD_EXECUTION_SESSION_VERSION,
    document_type: 'complete-world-execution-preview',
    session_id: `world-execution-${authorizationSha256.slice(0, 16)}`,
    authorization_sha256: authorizationSha256,
    workflow_id: snapshot.workflow_id,
    plan_id: snapshot.plan_id,
    profile: snapshot.profile,
    start_state_revision: snapshot.state_revision,
    ...(snapshot.next_task_id
      ? { start_next_task_id: snapshot.next_task_id }
      : {}),
    input_binding_sha256: snapshot.input_binding_sha256,
    ...(snapshot.direction_binding_sha256
      ? { direction_binding_sha256: snapshot.direction_binding_sha256 }
      : {}),
    scope,
    authorized_task_ids: Object.freeze([...taskIds]),
    maximum_remote_requests: taskIds.length,
    workflow_requests_remaining: remainingBudget,
    executable: taskIds.length > 0 && blockReason === undefined,
    ...(blockReason ? { block_reason: blockReason } : {}),
    retry_policy: 'never',
    scene_direction_requires_separate_human_approval: true,
    production_art_only: true,
    runtime_ready: false,
  });
}
