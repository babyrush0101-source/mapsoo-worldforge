import {
  COMPLETE_WORLD_EXECUTION_SESSION_VERSION,
  createCompleteWorldExecutionPreview,
  materializeCompleteWorldExecutionSnapshot,
  type CompleteWorldExecutionPreview,
  type CompleteWorldExecutionSnapshot,
} from '../core/complete-world-execution-session';

export interface CompleteWorldWorkflowInvocation {
  readonly execute: boolean;
  readonly expectedStateRevision?: number;
  readonly expectedNextTaskId?: string;
}

export interface CompleteWorldWorkflowInvocationResult {
  readonly execution_snapshot: unknown;
  readonly remote_request_count_this_invocation: number;
}

export type CompleteWorldWorkflowRunner = (
  invocation: CompleteWorldWorkflowInvocation,
) => Promise<CompleteWorldWorkflowInvocationResult>;

export interface CompleteWorldExecutionDryRun {
  readonly schema_version:
    typeof COMPLETE_WORLD_EXECUTION_SESSION_VERSION;
  readonly document_type: 'complete-world-execution-dry-run';
  readonly mode: 'dry-run';
  readonly remote_request_count: 0;
  readonly preview: CompleteWorldExecutionPreview;
}

export interface CompleteWorldExecutionReceipt {
  readonly schema_version:
    typeof COMPLETE_WORLD_EXECUTION_SESSION_VERSION;
  readonly document_type: 'complete-world-execution-receipt';
  readonly mode: 'executed';
  readonly session_id: string;
  readonly authorization_sha256: string;
  readonly workflow_id: string;
  readonly plan_id: string;
  readonly profile: CompleteWorldExecutionPreview['profile'];
  readonly status:
    | 'complete'
    | 'awaiting-direction-approval'
    | 'stopped';
  readonly stop_reason?:
    | 'direction-approval-required'
    | 'task-rejected'
    | 'task-uncertain';
  readonly authorized_task_ids: readonly string[];
  readonly completed_task_ids: readonly string[];
  readonly stopped_task_id?: string;
  readonly requests_started_this_session: number;
  readonly remote_request_count: number;
  readonly final_state_revision: number;
  readonly retry_policy: 'never';
  readonly human_art_review_required: true;
  readonly production_art_only: true;
  readonly runtime_ready: false;
}

export interface RunCompleteWorldExecutionSessionInput {
  readonly execute?: boolean;
  readonly authorizationSha256?: string;
}

function fail(message: string): never {
  throw new Error(`Complete-world execution session: ${message}`);
}

function assertIdentity(
  before: CompleteWorldExecutionSnapshot,
  after: CompleteWorldExecutionSnapshot,
): void {
  if (
    after.workflow_id !== before.workflow_id
    || after.plan_id !== before.plan_id
    || after.profile !== before.profile
    || after.input_binding_sha256 !== before.input_binding_sha256
    || after.request_budget !== before.request_budget
    || after.tasks.length !== before.tasks.length
    || after.tasks.some((task, index) =>
      task.task_id !== before.tasks[index].task_id
      || task.kind !== before.tasks[index].kind)
  ) {
    fail('workflow identity or canonical task inventory changed during execution.');
  }
}

function receipt(
  preview: CompleteWorldExecutionPreview,
  snapshot: CompleteWorldExecutionSnapshot,
  input: {
    readonly status: CompleteWorldExecutionReceipt['status'];
    readonly stopReason?: CompleteWorldExecutionReceipt['stop_reason'];
    readonly completedTaskIds: readonly string[];
    readonly stoppedTaskId?: string;
    readonly requests: number;
  },
): CompleteWorldExecutionReceipt {
  return Object.freeze({
    schema_version: COMPLETE_WORLD_EXECUTION_SESSION_VERSION,
    document_type: 'complete-world-execution-receipt',
    mode: 'executed',
    session_id: preview.session_id,
    authorization_sha256: preview.authorization_sha256,
    workflow_id: preview.workflow_id,
    plan_id: preview.plan_id,
    profile: preview.profile,
    status: input.status,
    ...(input.stopReason ? { stop_reason: input.stopReason } : {}),
    authorized_task_ids: Object.freeze([...preview.authorized_task_ids]),
    completed_task_ids: Object.freeze([...input.completedTaskIds]),
    ...(input.stoppedTaskId
      ? { stopped_task_id: input.stoppedTaskId }
      : {}),
    requests_started_this_session: input.requests,
    remote_request_count: input.requests,
    final_state_revision: snapshot.state_revision,
    retry_policy: 'never',
    human_art_review_required: true,
    production_art_only: true,
    runtime_ready: false,
  });
}

export async function runCompleteWorldExecutionSession(
  input: RunCompleteWorldExecutionSessionInput,
  runner: CompleteWorldWorkflowRunner,
): Promise<CompleteWorldExecutionDryRun | CompleteWorldExecutionReceipt> {
  const inspection = await runner({ execute: false });
  if (inspection.remote_request_count_this_invocation !== 0) {
    fail('inspection unexpectedly reported a remote request.');
  }
  let snapshot = materializeCompleteWorldExecutionSnapshot(
    inspection.execution_snapshot,
  );
  const preview = await createCompleteWorldExecutionPreview(snapshot);
  if (input.execute !== true) {
    return Object.freeze({
      schema_version: COMPLETE_WORLD_EXECUTION_SESSION_VERSION,
      document_type: 'complete-world-execution-dry-run',
      mode: 'dry-run',
      remote_request_count: 0,
      preview,
    });
  }
  if (
    typeof input.authorizationSha256 !== 'string'
    || input.authorizationSha256 !== preview.authorization_sha256
  ) {
    fail('exact preview authorization SHA-256 is required before execution.');
  }
  if (!preview.executable || preview.authorized_task_ids.length < 1) {
    fail(`preview is not executable${preview.block_reason
      ? `: ${preview.block_reason}`
      : ''}.`);
  }

  const completedTaskIds: string[] = [];
  let requests = 0;
  for (
    let index = 0;
    index < preview.authorized_task_ids.length;
    index += 1
  ) {
    const taskId = preview.authorized_task_ids[index];
    if (
      snapshot.phase !== 'ready'
      || snapshot.next_task_id !== taskId
    ) {
      fail('workflow cursor changed before the next authorized task.');
    }
    const result = await runner({
      execute: true,
      expectedStateRevision: snapshot.state_revision,
      expectedNextTaskId: taskId,
    });
    if (result.remote_request_count_this_invocation !== 1) {
      fail('each authorized step must report exactly one remote request.');
    }
    const after = materializeCompleteWorldExecutionSnapshot(
      result.execution_snapshot,
    );
    assertIdentity(snapshot, after);
    if (
      after.requests_started !== snapshot.requests_started + 1
      || after.state_revision <= snapshot.state_revision
    ) {
      fail('workflow request accounting did not advance exactly once.');
    }
    requests += 1;
    const task = after.tasks.find(({ task_id: candidate }) =>
      candidate === taskId)!;
    snapshot = after;
    if (task.status === 'rejected') {
      return receipt(preview, snapshot, {
        status: 'stopped',
        stopReason: 'task-rejected',
        completedTaskIds,
        stoppedTaskId: taskId,
        requests,
      });
    }
    if (task.status === 'uncertain') {
      return receipt(preview, snapshot, {
        status: 'stopped',
        stopReason: 'task-uncertain',
        completedTaskIds,
        stoppedTaskId: taskId,
        requests,
      });
    }
    if (task.status !== 'succeeded') {
      fail('authorized task did not reach a terminal verified state.');
    }
    completedTaskIds.push(taskId);

    if (preview.scope === 'scene-direction-only') {
      if (snapshot.phase !== 'awaiting-direction-approval') {
        fail('scene direction did not stop at the separate human approval gate.');
      }
      return receipt(preview, snapshot, {
        status: 'awaiting-direction-approval',
        stopReason: 'direction-approval-required',
        completedTaskIds,
        requests,
      });
    }
    const expectedNext = preview.authorized_task_ids[index + 1];
    if (
      expectedNext
      && (
        snapshot.phase !== 'ready'
        || snapshot.next_task_id !== expectedNext
      )
    ) {
      fail('workflow cursor diverged from the authorized canonical task order.');
    }
  }
  if (snapshot.phase !== 'complete') {
    fail('authorized task inventory ended before the workflow completed.');
  }
  return receipt(preview, snapshot, {
    status: 'complete',
    completedTaskIds,
    requests,
  });
}
