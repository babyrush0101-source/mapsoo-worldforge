import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import runSetSchema from '../../schemas/mapsoo-production-art-run-set-1.0.schema.json';
import { WORLD_ASSET_PROFILES } from './asset-profile';
import { createProductionArtPlan } from './production-art-contract';
import {
  ProductionArtRunSetError,
  createProductionArtRunSet,
  materializeProductionArtRunSet,
} from './production-art-run-set';

const rights = Object.freeze({
  distribution: 'internal-review' as const,
  license: 'LicenseRef-Proprietary' as const,
});

function directories(plan: ReturnType<typeof createProductionArtPlan>) {
  return Object.fromEntries(plan.tasks.map(({ task_id: taskId }) => [
    taskId,
    `./model-runs/${taskId}`,
  ]));
}

describe('production art run-set', () => {
  it.each(WORLD_ASSET_PROFILES)('materializes the exact canonical %s task inventory', (profile) => {
    const plan = createProductionArtPlan(profile, rights);
    const runSet = createProductionArtRunSet(plan, directories(plan));
    expect(runSet.profile).toBe(profile);
    expect(Object.keys(runSet.runs)).toEqual(plan.tasks.map(({ task_id: taskId }) => taskId));
    expect(materializeProductionArtRunSet(JSON.parse(JSON.stringify(runSet)), plan)).toEqual(runSet);
    const validate = new Ajv2020({ strict: true }).compile(runSetSchema);
    expect(validate(runSet), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects missing, extra, aliased, absolute and URL run directories', () => {
    const plan = createProductionArtPlan('topdown-farm', rights);
    const valid = directories(plan);
    const first = plan.tasks[0].task_id;
    const second = plan.tasks[1].task_id;
    const cases = [
      Object.fromEntries(Object.entries(valid).filter(([taskId]) => taskId !== first)),
      { ...valid, unexpected: './model-runs/unexpected' },
      { ...valid, [second]: valid[first] },
      { ...valid, [first]: 'C:/private/run' },
      { ...valid, [first]: 'https://example.com/run' },
    ];
    for (const candidate of cases) {
      expect(() => createProductionArtRunSet(plan, candidate)).toThrow(ProductionArtRunSetError);
    }
  });

  it('rejects a run-set when its profile and plan disagree', () => {
    const farm = createProductionArtPlan('topdown-farm', rights);
    const side = createProductionArtPlan('side-platformer', rights);
    const runSet = createProductionArtRunSet(farm, directories(farm));
    expect(() => materializeProductionArtRunSet(runSet, side)).toThrowError(
      expect.objectContaining({ code: 'run-set.profile-mismatch' }),
    );
  });

  it('rejects a valid-looking plan whose canonical task content was changed', () => {
    const plan = createProductionArtPlan('topdown-farm', rights);
    const changed = {
      ...plan,
      tasks: plan.tasks.map((task, index) => index === 0
        ? { ...task, prompt: `${task.prompt} Altered.` }
        : task),
    };
    expect(() => createProductionArtRunSet(
      changed,
      directories(plan),
    )).toThrowError(expect.objectContaining({ code: 'run-set.invalid-plan' }));
  });
});
