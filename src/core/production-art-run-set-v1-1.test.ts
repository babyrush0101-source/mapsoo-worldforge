import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-production-art-run-set-1.1.schema.json';
import type { WorldAssetProfile } from './asset-profile';
import { buildAssetRequirementsV1_1 } from './asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import {
  buildProductionArtPlanV1_1,
  fingerprintProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from './production-art-contract-v1-1';
import { buildProductionArtOutputV1_1 } from './production-art-output-v1-1';
import {
  buildProductionArtRunSetV1_1,
  fingerprintProductionArtRunSetV1_1,
  materializeProductionArtRunSetV1_1,
  serializeCanonicalProductionArtRunSetV1_1,
  type ProductionArtRunV1_1Input,
} from './production-art-run-set-v1-1';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from './world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from './world-layout-plan';

const PRIVATE_MARKER = 'PRIVATE_DO_NOT_EXPORT';
const RIGHTS = Object.freeze({
  distribution: 'public' as const,
  license: 'CC0-1.0' as const,
});
const FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: `${PRIVATE_MARKER} premise`,
  worldview: `${PRIVATE_MARKER} worldview`,
  terrain: `${PRIVATE_MARKER} terrain`,
  geography: `${PRIVATE_MARKER} geography`,
  culture: `${PRIVATE_MARKER} culture`,
  ecology: `${PRIVATE_MARKER} ecology`,
  mood: `${PRIVATE_MARKER} mood`,
  art_direction: `${PRIVATE_MARKER} art`,
  traversal: `${PRIVATE_MARKER} traversal`,
  landmarks: `${PRIVATE_MARKER} alpha, beta, gamma, delta`,
});
const INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'extended',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'dangerous',
  landmark_labels: Object.freeze([
    `${PRIVATE_MARKER} alpha`,
    `${PRIVATE_MARKER} beta`,
    `${PRIVATE_MARKER} gamma`,
    `${PRIVATE_MARKER} delta`,
  ]),
});

function reference(role: 'environment-style' | 'character') {
  return {
    id: `${role}-reference`,
    role,
    path: `private-input/${role}.png`,
    mediaType: 'image/png',
    byteLength: 4096,
    width: 512,
    height: 512,
    sha256: (role === 'character' ? 'a' : 'b').repeat(64),
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  } as const;
}

function localReferences(task: ProductionArtTaskV1_1): readonly string[] {
  if (task.kind !== 'scene-direction') {
    return task.reference_roles.includes('character')
      ? ['approved-scene-direction', 'character-reference']
      : ['approved-scene-direction'];
  }
  return [
    ...(task.reference_roles.includes('environment-style')
      ? ['environment-reference']
      : []),
    ...(task.reference_roles.includes('character') ? ['character-reference'] : []),
  ];
}

async function fixture(
  profile: WorldAssetProfile,
  intent: WorldLayoutConstraintIntent = INTENT,
) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `production-run-set-v11-${profile}`,
    session_revision: 11,
    profile,
    target: 'raspberry-pi-4b',
    seed: `private-seed-${profile}`,
    facts: FACTS,
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: 'c'.repeat(64),
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: 'd'.repeat(64),
  });
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(intake, intent);
  const layoutPlan = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layoutPlan);
  const plan = await buildProductionArtPlanV1_1(requirements, RIGHTS);
  const inputs: ProductionArtRunV1_1Input[] = [];
  for (const [index, task] of plan.tasks.entries()) {
    const output = await buildProductionArtOutputV1_1(plan, requirements, {
      taskId: task.task_id,
      assetId: `asset-${String(index + 1).padStart(3, '0')}`,
      bytes: 4096 + index,
      sha256: ((index % 9) + 1).toString().repeat(64),
      sourceReferenceIds: localReferences(task),
    });
    inputs.push({
      taskId: task.task_id,
      runDirectory: `model-runs/${task.task_id}`,
      output,
      evidence: {
        artifactPath: output.path,
        bytes: output.bytes,
        sha256: output.sha256,
      },
    });
  }
  const runSet = await buildProductionArtRunSetV1_1(plan, requirements, inputs);
  return { requirements, plan, inputs, runSet };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('ProductionArtRunSet 1.1', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('binds every dynamic task and evidence exactly once for %s', async (profile) => {
    const { requirements, plan, inputs, runSet } = await fixture(profile);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(runSet), JSON.stringify(validate.errors)).toBe(true);
    expect(runSet.source).toEqual({
      plan_sha256: await fingerprintProductionArtPlanV1_1(plan, requirements),
      requirements_sha256: plan.source.requirements_sha256,
    });
    expect(runSet.plan_id).toBe(plan.plan_id);
    expect(runSet.profile).toBe(profile);
    expect(runSet.rights).toEqual(plan.rights);
    expect(runSet.runs.map(({ task_id }) => task_id))
      .toEqual(plan.tasks.map(({ task_id }) => task_id));
    expect(runSet.runs).toHaveLength(plan.tasks.length);
    for (const [index, run] of runSet.runs.entries()) {
      const task = plan.tasks[index];
      expect(run.output.task_id).toBe(task.task_id);
      expect(run.output.slot_ids).toEqual(task.slot_mappings.map(({ slot_id }) => slot_id));
      expect(run.output.roles).toEqual(task.slot_mappings.map(({ role }) => role));
      expect(run.output.variant_ids)
        .toEqual(task.slot_mappings.map(({ variant_id }) => variant_id));
      expect(run.evidence).toMatchObject({
        artifact_path: run.output.path,
        bytes: run.output.bytes,
        sha256: run.output.sha256,
      });
    }

    const rebuilt = await buildProductionArtRunSetV1_1(
      plan,
      requirements,
      [...inputs].reverse(),
    );
    expect(await fingerprintProductionArtRunSetV1_1(runSet, plan, requirements))
      .toBe(await fingerprintProductionArtRunSetV1_1(rebuilt, plan, requirements));
    expect(await serializeCanonicalProductionArtRunSetV1_1(runSet, plan, requirements))
      .toEqual(await serializeCanonicalProductionArtRunSetV1_1(
        rebuilt,
        plan,
        requirements,
      ));
    expect(Object.isFrozen(runSet)).toBe(true);
    expect(Object.isFrozen(runSet.runs)).toBe(true);
  });

  it('rejects missing, duplicate, extra, aliased, absolute, URL, and traversal runs', async () => {
    const base = await fixture('topdown-farm');
    const missing = base.inputs.slice(1);
    const duplicate = [...base.inputs, base.inputs[0]];
    const extra = [
      ...base.inputs,
      {
        ...base.inputs[0],
        taskId: 'unexpected-task',
        runDirectory: 'model-runs/unexpected-task',
      },
    ];
    await expect(buildProductionArtRunSetV1_1(base.plan, base.requirements, missing))
      .rejects.toMatchObject({ code: 'production-art-run-set-1.1.task-inventory' });
    await expect(buildProductionArtRunSetV1_1(base.plan, base.requirements, duplicate))
      .rejects.toMatchObject({ code: 'production-art-run-set-1.1.task-inventory' });
    await expect(buildProductionArtRunSetV1_1(base.plan, base.requirements, extra))
      .rejects.toMatchObject({ code: 'production-art-run-set-1.1.task-inventory' });

    for (const path of [
      base.inputs[1].runDirectory,
      'C:/private/run',
      '/private/run',
      'https://example.com/run',
      '../private/run',
      'model-runs\\private',
    ]) {
      const changed = base.inputs.map((input, index) => index === 0
        ? { ...input, runDirectory: path }
        : input);
      await expect(buildProductionArtRunSetV1_1(
        base.plan,
        base.requirements,
        changed,
      )).rejects.toBeInstanceOf(Error);
    }
  });

  it('rejects source, run order, output slots, evidence, and rights tampering', async () => {
    const base = await fixture('side-platformer');
    const mutations = [
      (value: any) => { value.source.plan_sha256 = '0'.repeat(64); },
      (value: any) => { value.source.requirements_sha256 = '0'.repeat(64); },
      (value: any) => { value.plan_id = 'tampered-plan'; },
      (value: any) => { value.rights.distribution = 'internal-review'; },
      (value: any) => { value.runs.reverse(); },
      (value: any) => { value.runs[0].output.slot_ids[0] = 'tampered-slot'; },
      (value: any) => { value.runs[0].evidence.bytes += 1; },
      (value: any) => { value.runs[0].evidence.output_sha256 = 'f'.repeat(64); },
    ];
    for (const mutate of mutations) {
      const changed = mutable(base.runSet);
      mutate(changed);
      await expect(materializeProductionArtRunSetV1_1(
        changed,
        base.plan,
        base.requirements,
      )).rejects.toBeInstanceOf(Error);
    }
  });

  it('rejects a run-set from a stale world requirements and plan pair', async () => {
    const current = await fixture('isometric-action');
    const stale = await fixture('isometric-action', {
      ...INTENT,
      route_shape: 'fork-rejoin',
      scale: 'compact',
    });

    await expect(materializeProductionArtRunSetV1_1(
      current.runSet,
      stale.plan,
      stale.requirements,
    )).rejects.toBeInstanceOf(Error);
  });

  it('keeps private intake and provider-remote metadata outside the run-set', async () => {
    const { requirements, plan, runSet } = await fixture('layered-depth-2d');
    const json = new TextDecoder().decode(
      await serializeCanonicalProductionArtRunSetV1_1(runSet, plan, requirements),
    );
    for (const forbidden of [
      PRIVATE_MARKER,
      'private-input',
      'private-seed',
      'provider_request_id',
      'remote_asset_id',
      'model_id',
      'credentials',
      'openai-request',
      'spritecook-asset',
    ]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }

    const changed = mutable(runSet);
    changed.runs[0].evidence.provider_request_id = 'remote-request-123';
    await expect(materializeProductionArtRunSetV1_1(
      changed,
      plan,
      requirements,
    )).rejects.toMatchObject({
      code: 'production-art-run-set-1.1.invalid-shape',
    });
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
    expect(validate(changed)).toBe(false);
  });
});
