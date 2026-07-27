import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import progressSchema from '../../schemas/mapsoo-production-art-progress-1.0.schema.json';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
} from './production-art-contract';
import {
  beginProductionArtWorkflowTask,
  completeProductionArtWorkflowTask,
  createProductionArtWorkflowState,
  type ProductionArtWorkflowArtifact,
  type ProductionArtWorkflowState,
} from './production-art-workflow';
import {
  createProductionArtProgress,
} from './production-art-progress';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';

const INPUT_SHA = 'a'.repeat(64);
const SOURCE_SHA = 'b'.repeat(64);
const DIRECTION_SHA = 'c'.repeat(64);

function plan(profile: WorldAssetProfile): ProductionArtPlan {
  return createProductionArtPlan(profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
}

function initial(productionPlan: ProductionArtPlan): ProductionArtWorkflowState {
  return createProductionArtWorkflowState({
    workflowId: `progress-${productionPlan.profile}-v1`,
    plan: productionPlan,
    provider: {
      id: 'test-provider',
      model: 'test-model',
      quality: 'medium',
    },
    inputBindingSha256: INPUT_SHA,
    requestBudget: productionPlan.tasks.length,
  });
}

function artifact(
  productionPlan: ProductionArtPlan,
  taskId: string,
): ProductionArtWorkflowArtifact {
  const task = productionPlan.tasks.find(({ task_id: candidate }) =>
    candidate === taskId)!;
  const isPlayer = task.kind === 'character-animation-sheet'
    && task.role_mappings.some(({ role }) => role === 'character.player.atlas');
  return {
    run_directory: `model-runs/${productionPlan.profile}/${taskId}/run-1`,
    source_sha256: SOURCE_SHA,
    normalized_sha256: taskId === 'scene-direction'
      ? DIRECTION_SHA
      : 'd'.repeat(64),
    ...(isPlayer ? {
      character_profile: {
        profile_revision_id: `neutral-traveler-${productionPlan.profile}-v1`,
        profile_revision_sha256: 'e'.repeat(64),
        atlas_sha256: 'f'.repeat(64),
      },
    } : {}),
  };
}

function succeed(
  state: ProductionArtWorkflowState,
  productionPlan: ProductionArtPlan,
  taskId: string,
): ProductionArtWorkflowState {
  const running = beginProductionArtWorkflowTask(state, productionPlan, {
    expectedStateRevision: state.state_revision,
    taskId,
    ...(taskId === 'scene-direction'
      ? {}
      : { approvedDirectionSha256: DIRECTION_SHA }),
  });
  return completeProductionArtWorkflowTask(running, productionPlan, {
    expectedStateRevision: running.state_revision,
    taskId,
    attempt: running.tasks.find(({ task_id: candidate }) =>
      candidate === taskId)!.attempts.length,
    outcome: 'succeeded',
    artifact: artifact(productionPlan, taskId),
  });
}

describe('production art progress', () => {
  it.each(WORLD_ASSET_PROFILES)(
    'publishes schema-valid privacy-minimized initial progress for %s',
    (profile) => {
      const productionPlan = plan(profile);
      const progress = createProductionArtProgress(
        initial(productionPlan),
        productionPlan,
      );
      const validate = new Ajv2020({ strict: true, allErrors: true })
        .compile(progressSchema);
      expect(validate(progress), JSON.stringify(validate.errors)).toBe(true);
      expect(progress).toMatchObject({
        phase: 'ready',
        next_action: 'generate-scene-direction',
        next_task_id: 'scene-direction',
        direction: { generated: false, approved: false },
        coverage: {
          total_tasks: productionPlan.tasks.length,
          succeeded_tasks: 0,
          succeeded_roles: 0,
        },
        run_set_ready: false,
        production_review_required: true,
        runtime_verified: false,
        runner_delivery_ready: false,
      });
      expect(JSON.stringify(progress)).not.toContain(INPUT_SHA);
      expect(Object.isFrozen(progress)).toBe(true);
      expect(Object.isFrozen(progress.tasks)).toBe(true);
    },
  );

  it('distinguishes generated direction, exact approval, and complete task coverage', () => {
    const productionPlan = plan('side-platformer');
    let state = succeed(initial(productionPlan), productionPlan, 'scene-direction');

    expect(createProductionArtProgress(state, productionPlan)).toMatchObject({
      phase: 'awaiting-direction-approval',
      next_action: 'approve-scene-direction',
      direction: { generated: true, approved: false },
      run_set_ready: false,
    });
    expect(createProductionArtProgress(
      state,
      productionPlan,
      DIRECTION_SHA,
    )).toMatchObject({
      phase: 'ready',
      next_action: 'generate-next-asset-task',
      next_task_id: productionPlan.tasks[1].task_id,
      direction: { generated: true, approved: true },
    });

    for (const task of productionPlan.tasks.slice(1)) {
      state = succeed(state, productionPlan, task.task_id);
    }
    const complete = createProductionArtProgress(
      state,
      productionPlan,
      DIRECTION_SHA,
    );
    expect(complete).toMatchObject({
      phase: 'complete',
      next_action: 'assemble-production-review-pack',
      direction: { generated: true, approved: true },
      coverage: {
        total_tasks: productionPlan.tasks.length,
        succeeded_tasks: productionPlan.tasks.length,
        missing_roles: [],
      },
      run_set_ready: true,
      production_review_required: true,
      runtime_verified: false,
      runner_delivery_ready: false,
    });
    expect(complete.coverage.succeeded_roles).toBe(complete.coverage.total_roles);
  });

  it('blocks later paid tasks after a rejected asset until explicit attention', () => {
    const productionPlan = plan('topdown-farm');
    let state = succeed(initial(productionPlan), productionPlan, 'scene-direction');
    const taskId = productionPlan.tasks[1].task_id;
    const running = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: state.state_revision,
      taskId,
      approvedDirectionSha256: DIRECTION_SHA,
    });
    state = completeProductionArtWorkflowTask(running, productionPlan, {
      expectedStateRevision: running.state_revision,
      taskId,
      attempt: 1,
      outcome: 'rejected',
      artifact: artifact(productionPlan, taskId),
      errorCode: 'task.semantic-rejected',
    });

    const progress = createProductionArtProgress(
      state,
      productionPlan,
      DIRECTION_SHA,
    );
    expect(progress).toMatchObject({
      phase: 'review-required',
      next_action: 'retry-or-reconcile-asset-task',
      attention_task_ids: [taskId],
      run_set_ready: false,
    });
    expect(progress.next_task_id).toBeUndefined();
    expect(progress.coverage.missing_roles).toEqual(
      expect.arrayContaining(
        productionPlan.tasks[1].role_mappings.map(({ role }) => role),
      ),
    );
  });
});
