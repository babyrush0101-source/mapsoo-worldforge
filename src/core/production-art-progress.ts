import type {
  ProductionArtPlan,
  ProductionArtTaskKind,
} from './production-art-contract';
import {
  parseProductionArtWorkflowState,
  selectNextProductionArtWorkflowTask,
  type ProductionArtWorkflowPhase,
  type ProductionArtWorkflowState,
  type ProductionArtWorkflowTaskStatus,
} from './production-art-workflow';
import type { WorldAssetProfile } from './asset-profile';

export const PRODUCTION_ART_PROGRESS_VERSION = '1.0.0' as const;

export const PRODUCTION_ART_PROGRESS_NEXT_ACTIONS = Object.freeze([
  'generate-scene-direction',
  'wait-for-running-task',
  'retry-or-reconcile-scene-direction',
  'approve-scene-direction',
  'generate-next-asset-task',
  'retry-or-reconcile-asset-task',
  'start-new-budgeted-workflow',
  'assemble-production-review-pack',
] as const);
export type ProductionArtProgressNextAction =
  typeof PRODUCTION_ART_PROGRESS_NEXT_ACTIONS[number];

export interface ProductionArtProgressTask {
  readonly task_id: string;
  readonly kind: ProductionArtTaskKind;
  readonly status: ProductionArtWorkflowTaskStatus;
  readonly attempts: number;
  readonly roles: readonly string[];
}

export interface ProductionArtProgress {
  readonly schema_version: typeof PRODUCTION_ART_PROGRESS_VERSION;
  readonly document_type: 'production-art-progress';
  readonly workflow_id: string;
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly state_revision: number;
  readonly phase: ProductionArtWorkflowPhase;
  readonly next_action: ProductionArtProgressNextAction;
  readonly next_task_id?: string;
  readonly active_task_id?: string;
  readonly attention_task_ids: readonly string[];
  readonly direction: Readonly<{
    generated: boolean;
    approved: boolean;
  }>;
  readonly requests: Readonly<{
    budget: number;
    started: number;
    remaining: number;
  }>;
  readonly coverage: Readonly<{
    total_tasks: number;
    succeeded_tasks: number;
    total_roles: number;
    succeeded_roles: number;
    missing_roles: readonly string[];
  }>;
  readonly tasks: readonly ProductionArtProgressTask[];
  /**
   * A complete model-art task inventory is only the input to pack assembly and
   * review. It never claims that a playable runtime has been built or approved.
   */
  readonly run_set_ready: boolean;
  readonly production_review_required: true;
  readonly runtime_verified: false;
  readonly runner_delivery_ready: false;
}

function nextAction(
  phase: ProductionArtWorkflowPhase,
  nextTaskId: string | undefined,
): ProductionArtProgressNextAction {
  if (phase === 'running') return 'wait-for-running-task';
  if (phase === 'awaiting-scene-direction') {
    return 'retry-or-reconcile-scene-direction';
  }
  if (phase === 'awaiting-direction-approval') {
    return 'approve-scene-direction';
  }
  if (phase === 'review-required') {
    return 'retry-or-reconcile-asset-task';
  }
  if (phase === 'budget-exhausted') {
    return 'start-new-budgeted-workflow';
  }
  if (phase === 'complete') return 'assemble-production-review-pack';
  return nextTaskId === 'scene-direction'
    ? 'generate-scene-direction'
    : 'generate-next-asset-task';
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

/**
 * Projects privacy-minimized, UI-safe progress from the authoritative workflow
 * state. Private prompt text, source paths, provider request ids and raw
 * artifact locations are deliberately absent.
 */
export function createProductionArtProgress(
  stateValue: ProductionArtWorkflowState,
  plan: ProductionArtPlan,
  approvedDirectionSha256?: string,
): ProductionArtProgress {
  const state = parseProductionArtWorkflowState(stateValue, plan);
  const selection = selectNextProductionArtWorkflowTask(
    state,
    plan,
    approvedDirectionSha256,
  );
  const taskStateById = new Map(
    state.tasks.map((task) => [task.task_id, task] as const),
  );
  const tasks = plan.tasks.map((task) => {
    const taskState = taskStateById.get(task.task_id)!;
    return {
      task_id: task.task_id,
      kind: task.kind,
      status: taskState.status,
      attempts: taskState.attempts.length,
      roles: task.role_mappings.map(({ role }) => role),
    } satisfies ProductionArtProgressTask;
  });
  const missingRoles = tasks
    .filter(({ status }) => status !== 'succeeded')
    .flatMap(({ roles }) => roles);
  const totalRoles = tasks.reduce((sum, task) => sum + task.roles.length, 0);
  const succeededRoles = tasks
    .filter(({ status }) => status === 'succeeded')
    .reduce((sum, task) => sum + task.roles.length, 0);
  const scene = state.tasks.find(({ task_id: taskId }) =>
    taskId === 'scene-direction')!;
  const sceneDigest = scene.attempts.at(-1)?.artifact?.normalized_sha256;
  const directionApproved = Boolean(
    scene.status === 'succeeded'
    && sceneDigest
    && (
      state.approved_direction_sha256 === sceneDigest
      || (
        state.approved_direction_sha256 === undefined
        && approvedDirectionSha256 === sceneDigest
      )
    ),
  );
  const activeTaskId = state.tasks.find(({ status }) => status === 'running')?.task_id;
  const attentionTaskIds = state.tasks
    .filter(({ status }) => status === 'rejected' || status === 'uncertain')
    .map(({ task_id: taskId }) => taskId);
  const runSetReady = state.tasks.every(({ status }) => status === 'succeeded');

  return freeze({
    schema_version: PRODUCTION_ART_PROGRESS_VERSION,
    document_type: 'production-art-progress',
    workflow_id: state.workflow_id,
    plan_id: state.plan_id,
    profile: state.profile,
    state_revision: state.state_revision,
    phase: selection.phase,
    next_action: nextAction(selection.phase, selection.task_id),
    ...(selection.task_id ? { next_task_id: selection.task_id } : {}),
    ...(activeTaskId ? { active_task_id: activeTaskId } : {}),
    attention_task_ids: attentionTaskIds,
    direction: {
      generated: scene.status === 'succeeded',
      approved: directionApproved,
    },
    requests: {
      budget: state.request_budget,
      started: state.requests_started,
      remaining: state.request_budget - state.requests_started,
    },
    coverage: {
      total_tasks: tasks.length,
      succeeded_tasks: tasks.filter(({ status }) => status === 'succeeded').length,
      total_roles: totalRoles,
      succeeded_roles: succeededRoles,
      missing_roles: missingRoles,
    },
    tasks,
    run_set_ready: runSetReady,
    production_review_required: true,
    runtime_verified: false,
    runner_delivery_ready: false,
  });
}
