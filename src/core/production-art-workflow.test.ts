import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import workflowJobSchema from '../../schemas/mapsoo-production-art-workflow-job-1.0.schema.json';
import workflowStateSchema from '../../schemas/mapsoo-production-art-workflow-state-1.0.schema.json';
import exampleWorkflowJob from '../../config/production-art-workflow.example.json';

import { createProductionArtPlan } from './production-art-contract';
import type { ProductionArtPlanV1_1 } from './production-art-contract-v1-1';
import {
  ProductionArtWorkflowError,
  beginProductionArtWorkflowTask,
  completeProductionArtWorkflowTask,
  createProductionArtWorkflowState,
  parseProductionArtWorkflowState,
  reconcileProductionArtWorkflowTask,
  selectNextProductionArtWorkflowTask,
  type ProductionArtWorkflowArtifact,
} from './production-art-workflow';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function plan() {
  return createProductionArtPlan('layered-depth-2d', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
}

function suffixedScenePlan() {
  const base = plan();
  return {
    ...base,
    plan_id: 'layered-depth-2d-suffixed-scene-plan',
    tasks: base.tasks.map((task) =>
      task.kind === 'scene-direction'
        ? {
          ...task,
          task_id: 'scene-direction-world-preview-base-001',
        }
        : task),
  };
}

function completePlan(): ProductionArtPlanV1_1 {
  const task = (
    taskId: string,
    role: string,
  ): ProductionArtPlanV1_1['tasks'][number] => ({
    task_id: taskId,
    kind: 'transparent-prop-sheet',
    expected_output_path: `production/${taskId}.png`,
    target: {
      width: 64,
      height: 64,
      cell_width: 64,
      cell_height: 64,
    },
    alpha_policy: 'straight-alpha',
    seam_policy: 'transparent-cell-padding',
    pivot: { x: 32, y: 63, unit: 'pixels' },
    reference_roles: ['environment-style'],
    requirement_assignments: [{
      requirement_id: `requirement-${taskId}`,
      role,
      strategy: 'one-cell-per-variant',
      required_variant_count: 1,
      slot_ids: [`slot-${taskId}`],
    }],
    slot_mappings: [{
      slot_id: `slot-${taskId}`,
      requirement_id: `requirement-${taskId}`,
      variant_id: `variant-${taskId}`,
      role,
      grid_rect: {
        column: 0,
        row: 0,
        column_span: 1,
        row_span: 1,
      },
    }],
    prompt: `Render ${role}.`,
    negative_constraints: ['Do not add text.'],
  });
  return {
    schema_version: '1.1.0',
    document_type: 'production-art-plan',
    plan_id: 'complete-plan-v1',
    profile: 'topdown-farm',
    source: {
      requirements_id: 'complete-requirements-v1',
      requirements_sha256: SHA_A,
    },
    rights: {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    },
    tasks: [
      task('complete-prop-sheet-1', 'prop.environment.atlas'),
      task('complete-effect-sheet-1', 'effect.environment.atlas'),
    ],
  };
}

function initial(requestBudget = 14) {
  const productionPlan = plan();
  return {
    productionPlan,
    state: createProductionArtWorkflowState({
      workflowId: 'mist-harbor-v1',
      plan: productionPlan,
      provider: {
        id: 'openai-production-art',
        model: 'gpt-image-2',
        quality: 'medium',
      },
      inputBindingSha256: SHA_A,
      privateInputBinding: {
        confirmed_intake_sha256: SHA_B,
        seed: 'mist-harbor-seed',
        character_identity_digest_sha256: SHA_C,
        environment_reference_id: 'mist-harbor-environment',
        character_reference_id: 'neutral-traveler-reference',
      },
      requestBudget,
    }),
  };
}

function artifact(taskId: string, source = SHA_B, normalized = SHA_C):
ProductionArtWorkflowArtifact {
  return {
    run_directory:
      `docs/visual-qa/production-art/model-runs/layered-depth-2d/${taskId}/run-1`,
    source_sha256: source,
    normalized_sha256: normalized,
  };
}

function finishScene() {
  const { productionPlan, state } = initial();
  const running = beginProductionArtWorkflowTask(state, productionPlan, {
    expectedStateRevision: 0,
    taskId: 'scene-direction',
  });
  const completed = completeProductionArtWorkflowTask(running, productionPlan, {
    expectedStateRevision: 1,
    taskId: 'scene-direction',
    attempt: 1,
    outcome: 'succeeded',
    artifact: artifact('scene-direction'),
  });
  return { productionPlan, completed };
}

describe('production art workflow', () => {
  it('publishes strict JSON schemas for the local job and privacy-minimized state', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validateJob = ajv.compile(workflowJobSchema);
    expect(validateJob(exampleWorkflowJob), JSON.stringify(validateJob.errors)).toBe(true);

    const { state } = initial();
    const validateState = ajv.compile(workflowStateSchema);
    expect(validateState(state), JSON.stringify(validateState.errors)).toBe(true);
    expect(validateState({ ...state, private_path: 'C:/private/source.png' })).toBe(false);
  });

  it('starts with the direction task and conservatively consumes request budget', () => {
    const { productionPlan, state } = initial();
    expect(selectNextProductionArtWorkflowTask(state, productionPlan)).toEqual({
      phase: 'ready',
      task_id: 'scene-direction',
    });

    const running = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: 0,
      taskId: 'scene-direction',
    });
    expect(running).toMatchObject({
      state_revision: 1,
      requests_started: 1,
    });
    expect(running.tasks[0]).toEqual({
      task_id: 'scene-direction',
      status: 'running',
      attempts: [{ attempt: 1, request_ordinal: 1, status: 'running' }],
    });
    expect(selectNextProductionArtWorkflowTask(running, productionPlan)).toEqual({
      phase: 'running',
    });
    expect(Object.isFrozen(running)).toBe(true);
    expect(Object.isFrozen(running.tasks[0].attempts)).toBe(true);
  });

  it('recognizes a complete-plan scene direction by kind instead of a fixed task id', () => {
    const productionPlan = suffixedScenePlan();
    const sceneTask = productionPlan.tasks.find(({ kind }) =>
      kind === 'scene-direction')!;
    let state = createProductionArtWorkflowState({
      workflowId: 'suffixed-scene-workflow-v1',
      plan: productionPlan,
      provider: {
        id: 'test-provider',
        model: 'test-model',
        quality: 'medium',
      },
      inputBindingSha256: SHA_A,
      privateInputBinding: {
        confirmed_intake_sha256: SHA_B,
        seed: 'suffixed-scene-seed',
        character_identity_digest_sha256: SHA_C,
        environment_reference_id: 'suffixed-environment',
        character_reference_id: 'suffixed-character',
      },
      requestBudget: productionPlan.tasks.length,
    });
    expect(selectNextProductionArtWorkflowTask(state, productionPlan)).toEqual({
      phase: 'ready',
      task_id: sceneTask.task_id,
    });

    state = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: state.state_revision,
      taskId: sceneTask.task_id,
    });
    state = completeProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: state.state_revision,
      taskId: sceneTask.task_id,
      attempt: 1,
      outcome: 'succeeded',
      artifact: artifact(sceneTask.task_id),
    });
    expect(selectNextProductionArtWorkflowTask(state, productionPlan)).toEqual({
      phase: 'awaiting-direction-approval',
    });
    expect(selectNextProductionArtWorkflowTask(
      state,
      productionPlan,
      SHA_C,
    )).toMatchObject({
      phase: 'ready',
      task_id: productionPlan.tasks[1].task_id,
    });
  });

  it('requires exact human-approved direction bytes before downstream work', () => {
    const { productionPlan, completed } = finishScene();
    expect(selectNextProductionArtWorkflowTask(completed, productionPlan)).toEqual({
      phase: 'awaiting-direction-approval',
    });
    expect(() => selectNextProductionArtWorkflowTask(
      completed,
      productionPlan,
      SHA_B,
    )).toThrowError(expect.objectContaining({
      code: 'workflow.direction-mismatch',
    }));
    expect(selectNextProductionArtWorkflowTask(
      completed,
      productionPlan,
      SHA_C,
    )).toEqual({
      phase: 'ready',
      task_id: 'terrain-sheet',
    });
    expect(() => beginProductionArtWorkflowTask(completed, productionPlan, {
      expectedStateRevision: completed.state_revision,
      taskId: 'prop-sheet',
      approvedDirectionSha256: SHA_C,
    })).toThrowError(expect.objectContaining({
      code: 'workflow.task-out-of-order',
    }));

    const terrain = beginProductionArtWorkflowTask(completed, productionPlan, {
      expectedStateRevision: completed.state_revision,
      taskId: 'terrain-sheet',
      approvedDirectionSha256: SHA_C,
    });
    expect(terrain.approved_direction_sha256).toBe(SHA_C);
  });

  it('runs a complete Plan 1.1 only after one externally approved direction is frozen', () => {
    const productionPlan = completePlan();
    let state = createProductionArtWorkflowState({
      workflowId: 'complete-plan-workflow-v1',
      plan: productionPlan,
      provider: {
        id: 'test-provider',
        model: 'test-model',
        quality: 'medium',
      },
      inputBindingSha256: SHA_A,
      privateInputBinding: {
        confirmed_intake_sha256: SHA_B,
        seed: 'complete-plan-seed',
        character_identity_digest_sha256: SHA_C,
        environment_reference_id: 'complete-environment',
        character_reference_id: 'complete-character',
      },
      requestBudget: productionPlan.tasks.length,
    });
    expect(selectNextProductionArtWorkflowTask(
      state,
      productionPlan,
    )).toEqual({ phase: 'awaiting-direction-approval' });
    expect(selectNextProductionArtWorkflowTask(
      state,
      productionPlan,
      SHA_C,
    )).toEqual({
      phase: 'ready',
      task_id: productionPlan.tasks[0].task_id,
    });

    for (const task of productionPlan.tasks) {
      const running = beginProductionArtWorkflowTask(state, productionPlan, {
        expectedStateRevision: state.state_revision,
        taskId: task.task_id,
        approvedDirectionSha256: SHA_C,
      });
      state = completeProductionArtWorkflowTask(running, productionPlan, {
        expectedStateRevision: running.state_revision,
        taskId: task.task_id,
        attempt: 1,
        outcome: 'succeeded',
        artifact: artifact(task.task_id),
      });
    }
    expect(state.approved_direction_sha256).toBe(SHA_C);
    expect(selectNextProductionArtWorkflowTask(
      state,
      productionPlan,
      SHA_C,
    )).toEqual({ phase: 'complete' });
    expect(() => selectNextProductionArtWorkflowTask(
      state,
      productionPlan,
      SHA_B,
    )).toThrowError(expect.objectContaining({
      code: 'workflow.direction-replaced',
    }));

    const tampered = JSON.parse(JSON.stringify(state));
    delete tampered.approved_direction_sha256;
    expect(() => parseProductionArtWorkflowState(
      tampered,
      productionPlan,
    )).toThrowError(expect.objectContaining({
      code: 'workflow.invalid-state',
    }));
  });

  it('keeps the frozen Plan 1.1 direction on an explicitly acknowledged retry', () => {
    const productionPlan = completePlan();
    let state = createProductionArtWorkflowState({
      workflowId: 'complete-plan-retry-v1',
      plan: productionPlan,
      provider: {
        id: 'test-provider',
        model: 'test-model',
        quality: 'medium',
      },
      inputBindingSha256: SHA_A,
      privateInputBinding: {
        confirmed_intake_sha256: SHA_B,
        seed: 'complete-plan-retry-seed',
        character_identity_digest_sha256: SHA_C,
        environment_reference_id: 'complete-environment',
        character_reference_id: 'complete-character',
      },
      requestBudget: productionPlan.tasks.length + 1,
    });
    const taskId = productionPlan.tasks[0].task_id;
    state = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: state.state_revision,
      taskId,
      approvedDirectionSha256: SHA_C,
    });
    state = completeProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: state.state_revision,
      taskId,
      attempt: 1,
      outcome: 'rejected',
      artifact: artifact(taskId),
      errorCode: 'task.semantic-rejected',
    });
    state = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: state.state_revision,
      taskId,
      acknowledgeDuplicateCostRisk: true,
    });
    expect(state.approved_direction_sha256).toBe(SHA_C);
    expect(() => parseProductionArtWorkflowState(
      state,
      productionPlan,
    )).not.toThrow();
  });

  it('does not silently retry a rejected or uncertain paid attempt', () => {
    const { productionPlan, state } = initial();
    const running = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: 0,
      taskId: 'scene-direction',
    });
    const uncertain = completeProductionArtWorkflowTask(running, productionPlan, {
      expectedStateRevision: 1,
      taskId: 'scene-direction',
      attempt: 1,
      outcome: 'uncertain',
      errorCode: 'task.process-interrupted',
    });
    expect(selectNextProductionArtWorkflowTask(uncertain, productionPlan)).toEqual({
      phase: 'awaiting-scene-direction',
    });
    expect(() => beginProductionArtWorkflowTask(uncertain, productionPlan, {
      expectedStateRevision: uncertain.state_revision,
      taskId: 'scene-direction',
    })).toThrowError(expect.objectContaining({
      code: 'workflow.retry-acknowledgement-required',
    }));

    const retry = beginProductionArtWorkflowTask(uncertain, productionPlan, {
      expectedStateRevision: uncertain.state_revision,
      taskId: 'scene-direction',
      acknowledgeDuplicateCostRisk: true,
    });
    expect(retry.requests_started).toBe(2);
    expect(retry.tasks[0].attempts).toHaveLength(2);
  });

  it('does not advance to later paid tasks while an asset task needs attention', () => {
    const { productionPlan, completed } = finishScene();
    const running = beginProductionArtWorkflowTask(completed, productionPlan, {
      expectedStateRevision: completed.state_revision,
      taskId: 'terrain-sheet',
      approvedDirectionSha256: SHA_C,
    });
    const rejected = completeProductionArtWorkflowTask(running, productionPlan, {
      expectedStateRevision: running.state_revision,
      taskId: 'terrain-sheet',
      attempt: 1,
      outcome: 'rejected',
      artifact: artifact('terrain-sheet'),
      errorCode: 'task.semantic-rejected',
    });
    expect(selectNextProductionArtWorkflowTask(
      rejected,
      productionPlan,
      SHA_C,
    )).toEqual({ phase: 'review-required' });
  });

  it('reconciles an uncertain attempt without consuming another request', () => {
    const { productionPlan, state } = initial();
    const running = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: 0,
      taskId: 'scene-direction',
    });
    const uncertain = completeProductionArtWorkflowTask(running, productionPlan, {
      expectedStateRevision: 1,
      taskId: 'scene-direction',
      attempt: 1,
      outcome: 'uncertain',
      errorCode: 'task.process-interrupted',
    });
    const reconciled = reconcileProductionArtWorkflowTask(
      uncertain,
      productionPlan,
      {
        expectedStateRevision: uncertain.state_revision,
        taskId: 'scene-direction',
        artifact: artifact('scene-direction'),
      },
    );
    expect(reconciled.requests_started).toBe(1);
    expect(reconciled.tasks[0]).toMatchObject({
      status: 'succeeded',
      attempts: [{ status: 'succeeded', artifact: artifact('scene-direction') }],
    });
  });

  it('fails closed at the total request budget', () => {
    const { productionPlan, state } = initial(1);
    const running = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: 0,
      taskId: 'scene-direction',
    });
    const completed = completeProductionArtWorkflowTask(running, productionPlan, {
      expectedStateRevision: 1,
      taskId: 'scene-direction',
      attempt: 1,
      outcome: 'succeeded',
      artifact: artifact('scene-direction'),
    });
    expect(selectNextProductionArtWorkflowTask(
      completed,
      productionPlan,
      SHA_C,
    )).toEqual({ phase: 'budget-exhausted' });
    expect(() => beginProductionArtWorkflowTask(completed, productionPlan, {
      expectedStateRevision: completed.state_revision,
      taskId: 'terrain-sheet',
      approvedDirectionSha256: SHA_C,
    })).toThrowError(expect.objectContaining({
      code: 'workflow.budget-exhausted',
    }));
  });

  it('requires portable character metadata before a player task can succeed', () => {
    const { productionPlan, completed } = finishScene();
    let state = completed;
    for (const taskId of ['terrain-sheet', 'prop-sheet']) {
      state = beginProductionArtWorkflowTask(state, productionPlan, {
        expectedStateRevision: state.state_revision,
        taskId,
        approvedDirectionSha256: SHA_C,
      });
      state = completeProductionArtWorkflowTask(state, productionPlan, {
        expectedStateRevision: state.state_revision,
        taskId,
        attempt: 1,
        outcome: 'succeeded',
        artifact: artifact(taskId),
      });
    }
    state = beginProductionArtWorkflowTask(state, productionPlan, {
      expectedStateRevision: state.state_revision,
      taskId: 'character-character-player-atlas',
      approvedDirectionSha256: SHA_C,
    });
    const running = state;
    expect(() => completeProductionArtWorkflowTask(running, productionPlan, {
      expectedStateRevision: running.state_revision,
      taskId: 'character-character-player-atlas',
      attempt: 1,
      outcome: 'succeeded',
      artifact: artifact('character-character-player-atlas'),
    })).toThrowError(expect.objectContaining({ code: 'workflow.invalid-state' }));

    const completedPlayer = completeProductionArtWorkflowTask(
      running,
      productionPlan,
      {
        expectedStateRevision: running.state_revision,
        taskId: 'character-character-player-atlas',
        attempt: 1,
        outcome: 'succeeded',
        artifact: {
          ...artifact('character-character-player-atlas'),
          character_profile: {
            profile_revision_id: 'neutral-traveler-layered-depth-2d-v1',
            profile_revision_sha256: SHA_A,
            atlas_sha256: SHA_B,
          },
        },
      },
    );
    expect(completedPlayer.tasks[3].status).toBe('succeeded');
  });

  it('rejects tampered state, stale writers, absolute paths, and frozen direction changes', () => {
    const { productionPlan, completed } = finishScene();
    expect(() => beginProductionArtWorkflowTask(completed, productionPlan, {
      expectedStateRevision: 0,
      taskId: 'terrain-sheet',
      approvedDirectionSha256: SHA_C,
    })).toThrowError(expect.objectContaining({ code: 'workflow.stale-state' }));

    const tampered = JSON.parse(JSON.stringify(completed));
    tampered.requests_started = 0;
    expect(() => parseProductionArtWorkflowState(
      tampered,
      productionPlan,
    )).toThrow(ProductionArtWorkflowError);

    const running = beginProductionArtWorkflowTask(completed, productionPlan, {
      expectedStateRevision: completed.state_revision,
      taskId: 'terrain-sheet',
      approvedDirectionSha256: SHA_C,
    });
    expect(() => completeProductionArtWorkflowTask(running, productionPlan, {
      expectedStateRevision: running.state_revision,
      taskId: 'terrain-sheet',
      attempt: 1,
      outcome: 'succeeded',
      artifact: {
        ...artifact('terrain-sheet'),
        run_directory: 'C:/private/run',
      },
    })).toThrowError(expect.objectContaining({
      code: 'workflow.artifact-invalid',
    }));

    const succeeded = completeProductionArtWorkflowTask(running, productionPlan, {
      expectedStateRevision: running.state_revision,
      taskId: 'terrain-sheet',
      attempt: 1,
      outcome: 'succeeded',
      artifact: artifact('terrain-sheet'),
    });
    expect(() => selectNextProductionArtWorkflowTask(
      succeeded,
      productionPlan,
      SHA_B,
    )).toThrowError(expect.objectContaining({
      code: 'workflow.direction-mismatch',
    }));
  });
});
