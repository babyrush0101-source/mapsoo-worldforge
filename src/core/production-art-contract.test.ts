import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import productionArtSchema from '../../schemas/mapsoo-production-art-1.0.schema.json';
import {
  PRODUCTION_ART_CONTRACT_VERSION,
  PRODUCTION_ART_TASK_KINDS,
  createProductionArtPlan,
  requiredProductionCharacterPoseMappings,
  requiredProductionArtRoles,
  validateProductionArtOutput,
  validateProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtPlan,
  type ProductionArtRights,
} from './production-art-contract';
import {
  WORLD_ASSET_PROFILES,
} from './asset-profile';

const PUBLIC_RIGHTS: ProductionArtRights = {
  distribution: 'public',
  license: 'CC-BY-4.0',
  attribution: 'Synthetic fixtures by Mapsoo Worldsmith contributors.',
};

function outputFor(plan: ProductionArtPlan, taskIndex = 0): ProductionArtOutput {
  const task = plan.tasks[taskIndex];
  return {
    schema_version: PRODUCTION_ART_CONTRACT_VERSION,
    document_type: 'production-art-output',
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    asset_id: `${task.task_id}-output`,
    path: task.expected_output_path,
    media_type: 'image/png',
    bytes: 4096,
    sha256: 'a'.repeat(64),
    width: task.target.width,
    height: task.target.height,
    alpha_policy: task.alpha_policy,
    pivot: task.pivot,
    roles: task.role_mappings.map(({ role }) => role),
    source_reference_ids: ['synthetic-environment', 'synthetic-character'],
    rights: plan.rights,
  };
}

describe('provider-neutral production art plans', () => {
  it.each(WORLD_ASSET_PROFILES)('builds a complete, schema-valid %s plan', (profile) => {
    const plan = createProductionArtPlan(profile, PUBLIC_RIGHTS);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(productionArtSchema);
    expect(validate(plan), JSON.stringify(validate.errors)).toBe(true);
    expect(validateProductionArtPlan(plan)).toEqual([]);
    expect(new Set(plan.tasks.flatMap(({ role_mappings: mappings }) => mappings.map(({ role }) => role))))
      .toEqual(new Set(requiredProductionArtRoles(profile)));
    expect(plan.tasks.every(({ expected_output_path: path }) => !path.includes('\\') && !path.includes('..'))).toBe(true);
  });

  it('defines every required provider-neutral production task kind', () => {
    const kinds = new Set(
      WORLD_ASSET_PROFILES.flatMap((profile) =>
        createProductionArtPlan(profile, PUBLIC_RIGHTS).tasks.map(({ kind }) => kind)),
    );
    expect(kinds).toEqual(new Set(PRODUCTION_ART_TASK_KINDS));
  });

  it('keeps only the sky opaque so parallax layers can composite', () => {
    const plan = createProductionArtPlan('side-platformer', PUBLIC_RIGHTS);
    const layers = plan.tasks.filter(({ kind }) => kind === 'background-layer');
    expect(layers.find(({ role_mappings: [mapping] }) => mapping.role === 'background.sky')?.alpha_policy)
      .toBe('opaque');
    expect(
      layers
        .filter(({ role_mappings: [mapping] }) => mapping.role !== 'background.sky')
        .every(({ alpha_policy: alphaPolicy }) => alphaPolicy === 'straight-alpha'),
    ).toBe(true);
  });

  it('uses straight alpha for terrain so slopes and one-way platforms have no box background', () => {
    const plan = createProductionArtPlan('side-platformer', PUBLIC_RIGHTS);
    expect(plan.tasks.find(({ task_id: taskId }) => taskId === 'terrain-sheet')?.alpha_policy)
      .toBe('straight-alpha');
  });

  it('keeps private proprietary External-Host-bound output distinct from public assets', () => {
    const privatePlan = createProductionArtPlan('topdown-farm', {
      distribution: 'private',
      license: 'LicenseRef-Proprietary',
    });
    expect(validateProductionArtPlan(privatePlan)).toEqual([]);
    expect(privatePlan.rights).toEqual({
      distribution: 'private',
      license: 'LicenseRef-Proprietary',
    });

    const unsafePublicPlan = {
      ...privatePlan,
      rights: { distribution: 'public', license: 'LicenseRef-Proprietary' },
    } as ProductionArtPlan;
    expect(validateProductionArtPlan(unsafePublicPlan))
      .toContainEqual(expect.objectContaining({ code: 'rights.public-proprietary' }));
  });

  it('keeps generated candidates internal until human review grants a publishable license', () => {
    const reviewPlan = createProductionArtPlan('layered-depth-2d', {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    });
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(productionArtSchema);
    expect(validate(reviewPlan), JSON.stringify(validate.errors)).toBe(true);
    expect(validateProductionArtPlan(reviewPlan)).toEqual([]);
    expect(reviewPlan.rights.distribution).toBe('internal-review');

    const falselyPublished = {
      ...reviewPlan,
      rights: { distribution: 'public', license: 'LicenseRef-Proprietary' },
    } as ProductionArtPlan;
    expect(validateProductionArtPlan(falselyPublished))
      .toContainEqual(expect.objectContaining({ code: 'rights.public-proprietary' }));
  });

  it.each([
    ['side-platformer', [28]],
    ['topdown-farm', [24]],
    ['isometric-action', [96, 80, 80]],
    ['layered-depth-2d', [32, 16]],
  ] as const)('declares exact independent semantic pose cells for %s', (profile, counts) => {
    const plan = createProductionArtPlan(profile, PUBLIC_RIGHTS);
    const characterTasks = plan.tasks.filter(({ kind }) => kind === 'character-animation-sheet');
    expect(characterTasks.map(({ pose_mappings: poses }) => poses?.length)).toEqual([...counts]);
    for (const task of characterTasks) {
      const role = task.role_mappings[0].role;
      expect(task.pose_mappings).toEqual(requiredProductionCharacterPoseMappings(profile, role));
      expect(new Set(task.pose_mappings?.map(({ grid_cell: cell }) => `${cell.column}:${cell.row}`)).size)
        .toBe(task.pose_mappings?.length);
      expect(task.pose_mappings?.every(({ role: poseRole }) => poseRole === role)).toBe(true);
    }
  });

  it('rejects missing, duplicated, or semantically changed character pose cells', () => {
    const plan = createProductionArtPlan('layered-depth-2d', PUBLIC_RIGHTS);
    const character = plan.tasks.find(({ kind }) => kind === 'character-animation-sheet');
    expect(character?.pose_mappings).toBeDefined();
    const changedTask = {
      ...character!,
      pose_mappings: character!.pose_mappings!.map((pose, index) => index === 1
        ? { ...pose, grid_cell: character!.pose_mappings![0].grid_cell }
        : pose).slice(0, -1),
    };
    const changedPlan = {
      ...plan,
      tasks: plan.tasks.map((task) => task.task_id === changedTask.task_id ? changedTask : task),
    };
    expect(validateProductionArtPlan(changedPlan))
      .toContainEqual(expect.objectContaining({ code: 'task.pose-mappings' }));
  });

  it('detects grid overlap, role duplication, and a missing production role', () => {
    const plan = createProductionArtPlan('side-platformer', PUBLIC_RIGHTS);
    const terrain = plan.tasks.find(({ task_id: taskId }) => taskId === 'terrain-sheet');
    expect(terrain).toBeDefined();
    const changedTask = {
      ...terrain!,
      role_mappings: terrain!.role_mappings.slice(0, -1).map((mapping, index) => (
        index === 1
          ? { ...mapping, grid_rect: terrain!.role_mappings[0].grid_rect }
          : mapping
      )),
    };
    const changedPlan = {
      ...plan,
      tasks: plan.tasks.map((task) => task.task_id === terrain!.task_id ? changedTask : task),
    };
    const codes = validateProductionArtPlan(changedPlan).map(({ code }) => code);
    expect(codes).toContain('task.grid-overlap');
    expect(codes).toContain('plan.missing-role');
  });
});

describe('production art output validation', () => {
  it.each(WORLD_ASSET_PROFILES)('accepts a bound %s output in runtime and JSON Schema', (profile) => {
    const plan = createProductionArtPlan(profile, PUBLIC_RIGHTS);
    const output = outputFor(plan);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(productionArtSchema);
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
    expect(validateProductionArtOutput(output, plan)).toEqual([]);
  });

  it.each([
    ['output.path', { path: '../private/asset.png' }],
    ['output.integrity', { sha256: 'not-a-sha' }],
    ['output.dimensions', { width: 17 }],
    ['output.roles', { roles: ['unexpected.role'] }],
    ['output.references', { source_reference_ids: ['C:/private/reference.png'] }],
    ['output.rights', { rights: { distribution: 'private', license: 'LicenseRef-Proprietary' } }],
  ] as const)('rejects %s tampering', (expectedCode, change) => {
    const plan = createProductionArtPlan('isometric-action', PUBLIC_RIGHTS);
    const output = { ...outputFor(plan), ...change } as ProductionArtOutput;
    expect(validateProductionArtOutput(output, plan))
      .toContainEqual(expect.objectContaining({ code: expectedCode }));
  });

  it('rejects output from a task belonging to another profile plan', () => {
    const side = createProductionArtPlan('side-platformer', PUBLIC_RIGHTS);
    const farm = createProductionArtPlan('topdown-farm', PUBLIC_RIGHTS);
    const sideBackgroundIndex = side.tasks.findIndex(({ kind }) => kind === 'background-layer');
    const output = {
      ...outputFor(side, sideBackgroundIndex),
      plan_id: farm.plan_id,
      profile: farm.profile,
    } as ProductionArtOutput;
    expect(validateProductionArtOutput(output, farm))
      .toContainEqual(expect.objectContaining({ code: 'output.task-reference' }));
  });
});
