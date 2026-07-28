import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-production-art-output-1.1.schema.json';
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
import {
  buildProductionArtOutputV1_1,
  fingerprintProductionArtOutputV1_1,
  materializeProductionArtOutputV1_1,
  serializeCanonicalProductionArtOutputV1_1,
} from './production-art-output-v1-1';
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

async function fixture(
  profile: WorldAssetProfile,
  intent: WorldLayoutConstraintIntent = INTENT,
) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `production-output-v11-${profile}`,
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
  return { requirements, plan };
}

function localReferences(task: ProductionArtTaskV1_1): readonly string[] {
  if (task.kind !== 'scene-direction') {
    return task.reference_roles.includes('character')
      ? ['character-reference', 'approved-scene-direction']
      : ['approved-scene-direction'];
  }
  return [
    ...(task.reference_roles.includes('character') ? ['character-reference'] : []),
    ...(task.reference_roles.includes('environment-style')
      ? ['environment-reference']
      : []),
  ];
}

async function outputFor(
  profile: WorldAssetProfile,
  taskSelector: (task: ProductionArtTaskV1_1) => boolean = () => true,
) {
  const base = await fixture(profile);
  const task = base.plan.tasks.find(taskSelector);
  if (!task) throw new Error(`No matching production-art task for ${profile}.`);
  const output = await buildProductionArtOutputV1_1(base.plan, base.requirements, {
    taskId: task.task_id,
    assetId: `${profile}-asset`,
    bytes: 4096,
    sha256: 'e'.repeat(64),
    sourceReferenceIds: localReferences(task),
  });
  return { ...base, task, output };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('ProductionArtOutput 1.1', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('is schema-valid and exactly task-bound for %s', async (profile) => {
    const { requirements, plan, task, output } = await outputFor(profile);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
    expect(output.source).toEqual({
      plan_sha256: await fingerprintProductionArtPlanV1_1(plan, requirements),
      requirements_sha256: plan.source.requirements_sha256,
    });
    expect(output.plan_id).toBe(plan.plan_id);
    expect(output.profile).toBe(profile);
    expect(output.task_id).toBe(task.task_id);
    expect(output.path).toBe(task.expected_output_path);
    expect([output.width, output.height]).toEqual([task.target.width, task.target.height]);
    expect(output.alpha_policy).toBe(task.alpha_policy);
    expect(output.pivot).toEqual(task.pivot);
    expect(output.rights).toEqual(plan.rights);
    expect(output.slot_ids).toEqual(task.slot_mappings.map(({ slot_id }) => slot_id));
    expect(output.roles).toEqual(task.slot_mappings.map(({ role }) => role));
    expect(output.variant_ids)
      .toEqual(task.slot_mappings.map(({ variant_id }) => variant_id));
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.slot_ids)).toBe(true);

    const rebuilt = await buildProductionArtOutputV1_1(plan, requirements, {
      taskId: task.task_id,
      assetId: `${profile}-asset`,
      bytes: 4096,
      sha256: 'e'.repeat(64),
      sourceReferenceIds: [...localReferences(task)].reverse(),
    });
    expect(await fingerprintProductionArtOutputV1_1(output, plan, requirements))
      .toBe(await fingerprintProductionArtOutputV1_1(rebuilt, plan, requirements));
    expect(await serializeCanonicalProductionArtOutputV1_1(output, plan, requirements))
      .toEqual(await serializeCanonicalProductionArtOutputV1_1(rebuilt, plan, requirements));
    expect(new TextDecoder().decode(
      await serializeCanonicalProductionArtOutputV1_1(output, plan, requirements),
    ).endsWith('\n')).toBe(true);
  });

  it('enforces scene and downstream approved-direction references in both directions', async () => {
    const { requirements, plan } = await fixture('side-platformer');
    const scene = plan.tasks.find(({ kind }) => kind === 'scene-direction');
    const downstream = plan.tasks.find(({ kind }) => kind !== 'scene-direction');
    if (!scene || !downstream) throw new Error('Expected scene and downstream tasks.');

    await expect(buildProductionArtOutputV1_1(plan, requirements, {
      taskId: scene.task_id,
      assetId: 'scene-output',
      bytes: 1024,
      sha256: '1'.repeat(64),
      sourceReferenceIds: [
        ...localReferences(scene),
        'approved-scene-direction',
      ],
    })).rejects.toMatchObject({
      code: 'production-art-output-1.1.invalid-references',
    });

    await expect(buildProductionArtOutputV1_1(plan, requirements, {
      taskId: downstream.task_id,
      assetId: 'downstream-output',
      bytes: 1024,
      sha256: '2'.repeat(64),
      sourceReferenceIds: localReferences(downstream)
        .filter((referenceId) => referenceId !== 'approved-scene-direction'),
    })).rejects.toMatchObject({
      code: 'production-art-output-1.1.invalid-references',
    });
  });

  it('allows only canonical local reference ids and normalizes their order', async () => {
    const { requirements, plan } = await fixture('isometric-action');
    const scene = plan.tasks.find(({ kind }) => kind === 'scene-direction');
    if (!scene) throw new Error('Expected a scene task.');

    const output = await buildProductionArtOutputV1_1(plan, requirements, {
      taskId: scene.task_id,
      assetId: 'scene-output',
      bytes: 1024,
      sha256: '3'.repeat(64),
      sourceReferenceIds: ['character-reference', 'environment-reference'],
    });
    expect(output.source_reference_ids).toEqual([
      'environment-reference',
      'character-reference',
    ]);

    for (const remoteId of [
      'openai-request-123',
      'spritecook-asset-123',
      'provider-remote-id',
    ]) {
      await expect(buildProductionArtOutputV1_1(plan, requirements, {
        taskId: scene.task_id,
        assetId: 'scene-output',
        bytes: 1024,
        sha256: '3'.repeat(64),
        sourceReferenceIds: [remoteId],
      })).rejects.toMatchObject({
        code: 'production-art-output-1.1.invalid-references',
      });
    }
  });

  it('rejects source, task mapping, geometry, pivot, and rights tampering', async () => {
    const base = await outputFor(
      'side-platformer',
      ({ slot_mappings }) => slot_mappings.length > 1,
    );
    const mutations = [
      (value: any) => { value.source.plan_sha256 = '0'.repeat(64); },
      (value: any) => { value.source.requirements_sha256 = '0'.repeat(64); },
      (value: any) => { value.path = 'generated/tampered.png'; },
      (value: any) => { value.width += 1; },
      (value: any) => {
        value.alpha_policy = value.alpha_policy === 'opaque'
          ? 'straight-alpha'
          : 'opaque';
      },
      (value: any) => { value.pivot.x += 1; },
      (value: any) => { value.rights.distribution = 'internal-review'; },
      (value: any) => { value.roles[0] = 'terrain.fake'; },
      (value: any) => { value.slot_ids.reverse(); },
    ];

    for (const mutate of mutations) {
      const changed = mutable(base.output);
      mutate(changed);
      await expect(materializeProductionArtOutputV1_1(
        changed,
        base.plan,
        base.requirements,
      )).rejects.toMatchObject({
        code: 'production-art-output-1.1.invalid-binding',
      });
    }
  });

  it('rejects outputs against a stale or unrelated plan', async () => {
    const current = await outputFor('topdown-farm');
    const stale = await fixture('topdown-farm', {
      ...INTENT,
      route_shape: 'fork-rejoin',
      scale: 'compact',
    });

    await expect(materializeProductionArtOutputV1_1(
      current.output,
      stale.plan,
      stale.requirements,
    )).rejects.toBeInstanceOf(Error);
  });

  it('does not expose private intake or provider-remote metadata', async () => {
    const { requirements, plan, output } = await outputFor('layered-depth-2d');
    const json = new TextDecoder().decode(
      await serializeCanonicalProductionArtOutputV1_1(output, plan, requirements),
    );

    for (const forbidden of [
      PRIVATE_MARKER,
      'private-input',
      'private-seed',
      'openai',
      'spritecook',
      'provider_request_id',
      'remote_asset_id',
      'model_id',
      'credentials',
    ]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }

    const extraProviderField = mutable(output);
    extraProviderField.provider_request_id = 'remote-request-123';
    await expect(materializeProductionArtOutputV1_1(
      extraProviderField,
      plan,
      requirements,
    )).rejects.toMatchObject({
      code: 'production-art-output-1.1.invalid-shape',
    });
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
    expect(validate(extraProviderField)).toBe(false);
  });
});
