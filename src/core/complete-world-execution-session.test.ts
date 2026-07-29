import { describe, expect, it } from 'vitest';

import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
} from './production-art-contract';
import {
  beginProductionArtWorkflowTask,
  completeProductionArtWorkflowTask,
  createProductionArtWorkflowState,
  type ProductionArtWorkflowState,
} from './production-art-workflow';
import {
  createCompleteWorldExecutionPreview,
  createCompleteWorldExecutionSnapshot,
  materializeCompleteWorldExecutionSnapshot,
} from './complete-world-execution-session';

const INPUT_SHA = 'a'.repeat(64);
const INTAKE_SHA = 'b'.repeat(64);
const DIRECTION_SHA = 'c'.repeat(64);

function plan(profile: WorldAssetProfile): ProductionArtPlan {
  const base = createProductionArtPlan(profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  return {
    ...base,
    plan_id: `${profile}-complete-session-plan`,
    tasks: base.tasks.map((task) =>
      task.kind === 'scene-direction'
        ? {
          ...task,
          task_id: 'scene-direction-world-preview-base-001',
        }
        : task),
  };
}

function initial(
  productionPlan: ProductionArtPlan,
  requestBudget = productionPlan.tasks.length,
): ProductionArtWorkflowState {
  return createProductionArtWorkflowState({
    workflowId: `complete-session-${productionPlan.profile}`,
    plan: productionPlan,
    provider: {
      id: 'test-provider',
      model: 'test-model',
      quality: 'medium',
    },
    inputBindingSha256: INPUT_SHA,
    privateInputBinding: {
      confirmed_intake_sha256: INTAKE_SHA,
      seed: 'private-seed-never-copied-to-session',
      character_identity_digest_sha256: 'd'.repeat(64),
      environment_reference_id: 'private-environment',
      character_reference_id: 'private-character',
    },
    requestBudget,
  });
}

function finishScene(
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
    artifact: {
      run_directory: `model-runs/${productionPlan.profile}/scene/run-1`,
      source_sha256: 'e'.repeat(64),
      normalized_sha256: DIRECTION_SHA,
    },
  });
}

describe('complete-world execution session contract', () => {
  it.each(WORLD_ASSET_PROFILES)(
    'authorizes only the scene round before human approval for %s',
    async (profile) => {
      const productionPlan = plan(profile);
      const snapshot = createCompleteWorldExecutionSnapshot(
        initial(productionPlan),
        productionPlan,
      );
      const preview = await createCompleteWorldExecutionPreview(snapshot);
      const scene = productionPlan.tasks.find(({ kind }) =>
        kind === 'scene-direction')!;
      expect(preview).toMatchObject({
        scope: 'scene-direction-only',
        executable: true,
        authorized_task_ids: [scene.task_id],
        maximum_remote_requests: 1,
        retry_policy: 'never',
        scene_direction_requires_separate_human_approval: true,
        production_art_only: true,
        runtime_ready: false,
      });
    },
  );

  it.each(WORLD_ASSET_PROFILES)(
    'binds every remaining canonical task after exact direction approval for %s',
    async (profile) => {
      const productionPlan = plan(profile);
      const state = finishScene(initial(productionPlan), productionPlan);
      const blocked = await createCompleteWorldExecutionPreview(
        createCompleteWorldExecutionSnapshot(state, productionPlan),
      );
      expect(blocked).toMatchObject({
        scope: 'none',
        executable: false,
        block_reason: 'direction-approval-required',
      });

      const first = await createCompleteWorldExecutionPreview(
        createCompleteWorldExecutionSnapshot(
          state,
          productionPlan,
          DIRECTION_SHA,
        ),
      );
      const second = await createCompleteWorldExecutionPreview(
        createCompleteWorldExecutionSnapshot(
          state,
          productionPlan,
          DIRECTION_SHA,
        ),
      );
      expect(first).toEqual(second);
      expect(first).toMatchObject({
        scope: 'remaining-world',
        executable: true,
        direction_binding_sha256: DIRECTION_SHA,
        maximum_remote_requests: productionPlan.tasks.length - 1,
      });
      expect(first.authorized_task_ids).toEqual(
        productionPlan.tasks.slice(1).map(({ task_id: taskId }) => taskId),
      );
      expect(first.authorization_sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(first.session_id).toBe(
        `world-execution-${first.authorization_sha256.slice(0, 16)}`,
      );
      const serialized = JSON.stringify(first);
      expect(serialized).not.toContain('private-seed-never-copied');
      expect(serialized).not.toContain('C:\\');
      expect(serialized).not.toContain('/Users/');
      expect(serialized).not.toContain('credential');
      expect(serialized).not.toContain('response');
    },
  );

  it('fails closed when the remaining workflow budget cannot cover the full session', async () => {
    const productionPlan = plan('side-platformer');
    const state = finishScene(initial(productionPlan, 2), productionPlan);
    const preview = await createCompleteWorldExecutionPreview(
      createCompleteWorldExecutionSnapshot(
        state,
        productionPlan,
        DIRECTION_SHA,
      ),
    );
    expect(preview).toMatchObject({
      scope: 'none',
      executable: false,
      block_reason: 'budget-insufficient',
      maximum_remote_requests: 0,
      workflow_requests_remaining: 1,
    });
  });

  it('rejects extra private fields and inconsistent task attempts', () => {
    const productionPlan = plan('topdown-farm');
    const snapshot = createCompleteWorldExecutionSnapshot(
      initial(productionPlan),
      productionPlan,
    );
    expect(() => materializeCompleteWorldExecutionSnapshot({
      ...snapshot,
      private_source_path: 'C:/private/world.png',
    })).toThrow(/unsupported fields/u);
    expect(() => materializeCompleteWorldExecutionSnapshot({
      ...snapshot,
      tasks: snapshot.tasks.map((task, index) =>
        index === 0 ? { ...task, attempts: 1 } : task),
    })).toThrow(/attempts/u);
  });
});
