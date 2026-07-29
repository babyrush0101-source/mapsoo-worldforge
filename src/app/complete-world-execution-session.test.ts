import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import previewSchema from '../../schemas/mapsoo-complete-world-execution-preview-1.0.schema.json';
import receiptSchema from '../../schemas/mapsoo-complete-world-execution-receipt-1.0.schema.json';
import type { WorldAssetProfile } from '../core/asset-profile';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../core/production-art-contract';
import {
  beginProductionArtWorkflowTask,
  completeProductionArtWorkflowTask,
  createProductionArtWorkflowState,
  type ProductionArtWorkflowArtifact,
  type ProductionArtWorkflowState,
} from '../core/production-art-workflow';
import {
  createCompleteWorldExecutionSnapshot,
} from '../core/complete-world-execution-session';
import {
  runCompleteWorldExecutionSession,
  type CompleteWorldWorkflowInvocation,
  type CompleteWorldWorkflowRunner,
} from './complete-world-execution-session';

const INPUT_SHA = 'a'.repeat(64);
const DIRECTION_SHA = 'b'.repeat(64);

function plan(profile: WorldAssetProfile): ProductionArtPlan {
  const base = createProductionArtPlan(profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  return {
    ...base,
    plan_id: `${profile}-execution-app-plan`,
    tasks: base.tasks.map((task) =>
      task.kind === 'scene-direction'
        ? {
          ...task,
          task_id: 'scene-direction-world-preview-base-001',
        }
        : task),
  };
}

function initial(productionPlan: ProductionArtPlan): ProductionArtWorkflowState {
  return createProductionArtWorkflowState({
    workflowId: `execution-app-${productionPlan.profile}`,
    plan: productionPlan,
    provider: {
      id: 'test-provider',
      model: 'test-model',
      quality: 'medium',
    },
    inputBindingSha256: INPUT_SHA,
    privateInputBinding: {
      confirmed_intake_sha256: 'c'.repeat(64),
      seed: 'private-seed',
      character_identity_digest_sha256: 'd'.repeat(64),
      environment_reference_id: 'private-environment',
      character_reference_id: 'private-character',
    },
    requestBudget: productionPlan.tasks.length,
  });
}

function artifact(
  productionPlan: ProductionArtPlan,
  task: ProductionArtTask,
): ProductionArtWorkflowArtifact {
  const isPlayer = task.kind === 'character-animation-sheet'
    && task.role_mappings.length === 1
    && task.role_mappings[0].role === 'character.player.atlas';
  return {
    run_directory:
      `model-runs/${productionPlan.profile}/${task.task_id}/run-1`,
    source_sha256: 'e'.repeat(64),
    normalized_sha256: task.kind === 'scene-direction'
      ? DIRECTION_SHA
      : 'f'.repeat(64),
    ...(isPlayer
      ? {
        character_profile: {
          profile_revision_id:
            `neutral-traveler-${productionPlan.profile}-v1`,
          profile_revision_sha256: '1'.repeat(64),
          atlas_sha256: '2'.repeat(64),
        },
      }
      : {}),
  };
}

function succeedScene(
  state: ProductionArtWorkflowState,
  productionPlan: ProductionArtPlan,
): ProductionArtWorkflowState {
  const scene = productionPlan.tasks.find(({ kind }) =>
    kind === 'scene-direction')!;
  const running = beginProductionArtWorkflowTask(state, productionPlan, {
    expectedStateRevision: state.state_revision,
    taskId: scene.task_id,
  });
  return completeProductionArtWorkflowTask(running, productionPlan, {
    expectedStateRevision: running.state_revision,
    taskId: scene.task_id,
    attempt: 1,
    outcome: 'succeeded',
    artifact: artifact(productionPlan, scene),
  });
}

function harness(input: {
  readonly profile: WorldAssetProfile;
  readonly afterScene: boolean;
  readonly uncertainTaskId?: string;
}) {
  const productionPlan = plan(input.profile);
  let state = initial(productionPlan);
  if (input.afterScene) state = succeedScene(state, productionPlan);
  const invocations: CompleteWorldWorkflowInvocation[] = [];
  const runner: CompleteWorldWorkflowRunner = async (invocation) => {
    invocations.push(invocation);
    if (invocation.execute) {
      const selected = productionPlan.tasks.find(({ task_id: taskId }) =>
        taskId === invocation.expectedNextTaskId)!;
      state = beginProductionArtWorkflowTask(state, productionPlan, {
        expectedStateRevision: invocation.expectedStateRevision!,
        taskId: selected.task_id,
        ...(selected.kind === 'scene-direction'
          ? {}
          : { approvedDirectionSha256: DIRECTION_SHA }),
      });
      const attempt = state.tasks.find(({ task_id: taskId }) =>
        taskId === selected.task_id)!.attempts.length;
      state = completeProductionArtWorkflowTask(state, productionPlan, {
        expectedStateRevision: state.state_revision,
        taskId: selected.task_id,
        attempt,
        outcome: selected.task_id === input.uncertainTaskId
          ? 'uncertain'
          : 'succeeded',
        ...(selected.task_id === input.uncertainTaskId
          ? { errorCode: 'task.result-unverified' }
          : { artifact: artifact(productionPlan, selected) }),
      });
    }
    return {
      execution_snapshot: createCompleteWorldExecutionSnapshot(
        state,
        productionPlan,
        input.afterScene ? DIRECTION_SHA : undefined,
      ),
      remote_request_count_this_invocation: invocation.execute ? 1 : 0,
    };
  };
  return {
    productionPlan,
    invocations,
    runner,
    state: () => state,
  };
}

describe('complete-world execution session app', () => {
  it('is a zero-request dry-run by default', async () => {
    const runtime = harness({
      profile: 'side-platformer',
      afterScene: true,
    });
    const result = await runCompleteWorldExecutionSession(
      {},
      runtime.runner,
    );
    expect(result).toMatchObject({
      mode: 'dry-run',
      remote_request_count: 0,
      preview: {
        scope: 'remaining-world',
        executable: true,
      },
    });
    if (result.mode !== 'dry-run') throw new Error('Expected dry-run.');
    const validate = new Ajv2020({ strict: true, allErrors: true })
      .compile(previewSchema);
    expect(validate(result.preview), JSON.stringify(validate.errors)).toBe(true);
    expect(runtime.invocations).toEqual([{ execute: false }]);
  });

  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)(
    'executes every remaining %s task with a fresh exact cursor guard',
    async (profile) => {
      const runtime = harness({ profile, afterScene: true });
      const dryRun = await runCompleteWorldExecutionSession(
        {},
        runtime.runner,
      );
      if (dryRun.mode !== 'dry-run') throw new Error('Expected dry-run.');
      const result = await runCompleteWorldExecutionSession(
        {
          execute: true,
          authorizationSha256: dryRun.preview.authorization_sha256,
        },
        runtime.runner,
      );
      const expectedTasks = runtime.productionPlan.tasks
        .filter(({ kind }) => kind !== 'scene-direction')
        .map(({ task_id: taskId }) => taskId);
      expect(result).toMatchObject({
        mode: 'executed',
        status: 'complete',
        authorized_task_ids: expectedTasks,
        completed_task_ids: expectedTasks,
        requests_started_this_session: expectedTasks.length,
        remote_request_count: expectedTasks.length,
        retry_policy: 'never',
        human_art_review_required: true,
        runtime_ready: false,
      });
      const validate = new Ajv2020({ strict: true, allErrors: true })
        .compile(receiptSchema);
      expect(validate(result), JSON.stringify(validate.errors)).toBe(true);
      const paid = runtime.invocations.filter(({ execute }) => execute);
      expect(paid).toHaveLength(expectedTasks.length);
      expect(paid.map(({ expectedNextTaskId }) => expectedNextTaskId))
        .toEqual(expectedTasks);
      expect(paid.every(({ expectedStateRevision }, index) =>
        expectedStateRevision === 2 + index * 2)).toBe(true);
    },
  );

  it('stops after one scene-direction request for separate human approval', async () => {
    const runtime = harness({
      profile: 'layered-depth-2d',
      afterScene: false,
    });
    const dryRun = await runCompleteWorldExecutionSession(
      {},
      runtime.runner,
    );
    if (dryRun.mode !== 'dry-run') throw new Error('Expected dry-run.');
    const result = await runCompleteWorldExecutionSession(
      {
        execute: true,
        authorizationSha256: dryRun.preview.authorization_sha256,
      },
      runtime.runner,
    );
    expect(result).toMatchObject({
      status: 'awaiting-direction-approval',
      stop_reason: 'direction-approval-required',
      requests_started_this_session: 1,
      remote_request_count: 1,
    });
    expect(runtime.invocations.filter(({ execute }) => execute)).toHaveLength(1);
  });

  it('stops immediately on an uncertain paid result and never runs the next task', async () => {
    const runtime = harness({
      profile: 'topdown-farm',
      afterScene: true,
      uncertainTaskId: plan('topdown-farm').tasks[2].task_id,
    });
    const dryRun = await runCompleteWorldExecutionSession(
      {},
      runtime.runner,
    );
    if (dryRun.mode !== 'dry-run') throw new Error('Expected dry-run.');
    const result = await runCompleteWorldExecutionSession(
      {
        execute: true,
        authorizationSha256: dryRun.preview.authorization_sha256,
      },
      runtime.runner,
    );
    expect(result).toMatchObject({
      status: 'stopped',
      stop_reason: 'task-uncertain',
      stopped_task_id: runtime.productionPlan.tasks[2].task_id,
      requests_started_this_session: 2,
    });
    expect(runtime.invocations.filter(({ execute }) => execute)).toHaveLength(2);
    expect(runtime.state().tasks[3].status).toBe('pending');
  });

  it('rejects execution when the exact preview authorization is absent', async () => {
    const runtime = harness({
      profile: 'isometric-action',
      afterScene: true,
    });
    await expect(runCompleteWorldExecutionSession(
      {
        execute: true,
        authorizationSha256: '0'.repeat(64),
      },
      runtime.runner,
    )).rejects.toThrow(/exact preview authorization/u);
    expect(runtime.invocations.filter(({ execute }) => execute)).toHaveLength(0);
  });
});
