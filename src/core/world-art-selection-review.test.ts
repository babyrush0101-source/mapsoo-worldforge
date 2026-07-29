import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-world-art-selection-review-1.0.schema.json';
import type { WorldAssetProfile } from './asset-profile';
import { buildAssetRequirementsV1_1 } from './asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import {
  buildProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from './production-art-contract-v1-1';
import { buildProductionArtOutputV1_1 } from './production-art-output-v1-1';
import {
  buildProductionArtRunSetV1_1,
  type ProductionArtRunV1_1Input,
} from './production-art-run-set-v1-1';
import {
  buildPendingWorldArtSelectionReview,
  fingerprintWorldArtSelectionReview,
  materializePassedWorldArtSelectionReview,
  materializeWorldArtSelectionReview,
  serializeCanonicalWorldArtSelectionReview,
  type WorldArtSelectionReviewInput,
} from './world-art-selection-review';
import { buildWorldArtVariantMap } from './world-art-variant-map';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from './world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from './world-layout-plan';

const PRIVATE_MARKER = 'PRIVATE_SELECTION_REVIEW_LABEL';
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
  landmarks: `${PRIVATE_MARKER} alpha, beta, gamma`,
});
const INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'standard',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'dangerous',
  landmark_labels: Object.freeze([
    `${PRIVATE_MARKER} alpha`,
    `${PRIVATE_MARKER} beta`,
    `${PRIVATE_MARKER} gamma`,
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

async function fixture(profile: WorldAssetProfile) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `selection-review-${profile}`,
    session_revision: 14,
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
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(intake, INTENT);
  const layout = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layout);
  const plan = await buildProductionArtPlanV1_1(requirements, RIGHTS);
  const runInputs: ProductionArtRunV1_1Input[] = [];
  for (const [index, task] of plan.tasks.entries()) {
    const output = await buildProductionArtOutputV1_1(plan, requirements, {
      taskId: task.task_id,
      assetId: `review-asset-${String(index + 1).padStart(3, '0')}`,
      bytes: 8192 + index,
      sha256: String((index % 9) + 1).repeat(64),
      sourceReferenceIds: localReferences(task),
    });
    runInputs.push({
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
  const runSet = await buildProductionArtRunSetV1_1(plan, requirements, runInputs);
  const input: WorldArtSelectionReviewInput = {
    layout_plan: layout,
    asset_requirements: requirements,
    production_art_plan: plan,
    production_art_run_set: runSet,
  };
  return { input, layout, requirements, plan, runSet };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

function approve(value: unknown): any {
  const result = mutable(value);
  result.review_status = 'pass';
  result.declarations = {
    visual_quality_approved: true,
    atlas_integrity_approved: true,
    rights_and_redistribution_approved: true,
  };
  result.tasks.forEach((task: any) => {
    task.slots.forEach((slot: any) => {
      slot.decision = 'approved';
    });
  });
  return result;
}

describe('WorldArtSelectionReview 1.0', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('builds and admits a complete provider-neutral review for %s', async (profile) => {
    const base = await fixture(profile);
    const pending = await buildPendingWorldArtSelectionReview(base.input);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(pending), JSON.stringify(validate.errors)).toBe(true);
    expect(pending.review_status).toBe('pending');
    expect(pending.tasks).toHaveLength(base.plan.tasks.length);
    expect(pending.tasks.flatMap(({ slots }) => slots))
      .toHaveLength(base.plan.tasks.flatMap(({ slot_mappings }) => slot_mappings).length);
    expect(pending.tasks.every(({ slots }) =>
      slots.every(({ decision }) => decision === 'pending'))).toBe(true);
    expect(Object.values(pending.declarations).every((value) => value === false)).toBe(true);

    const passed = approve(pending);
    expect(validate(passed), JSON.stringify(validate.errors)).toBe(true);
    const admitted = await materializePassedWorldArtSelectionReview(passed, base.input);
    expect(admitted.reviewed_slot_inventory.slots)
      .toHaveLength(base.plan.tasks.flatMap(({ slot_mappings }) => slot_mappings).length);
    expect(admitted.review_record_sha256)
      .toBe(await fingerprintWorldArtSelectionReview(admitted.review, base.input));
    expect(admitted.reviewed_slot_inventory.review_record_sha256)
      .toBe(admitted.review_record_sha256);
    expect(Object.isFrozen(admitted.review)).toBe(true);
    expect(Object.isFrozen(admitted.reviewed_slot_inventory.slots)).toBe(true);

    await expect(buildWorldArtVariantMap({
      layout_plan: base.layout,
      asset_requirements: base.requirements,
      production_art_plan: base.plan,
      reviewed_slot_inventory: admitted.reviewed_slot_inventory,
      selections: admitted.selections,
    })).resolves.toMatchObject({ profile });
  }, 15_000);

  it('is deterministic and canonically serializable', async () => {
    const base = await fixture('topdown-farm');
    const left = await buildPendingWorldArtSelectionReview(base.input);
    const right = await buildPendingWorldArtSelectionReview(base.input);

    expect(left).toEqual(right);
    expect(await fingerprintWorldArtSelectionReview(left, base.input))
      .toBe(await fingerprintWorldArtSelectionReview(right, base.input));
    expect(await serializeCanonicalWorldArtSelectionReview(left, base.input))
      .toEqual(await serializeCanonicalWorldArtSelectionReview(right, base.input));
  });

  it('rejects pending and partial pass reviews', async () => {
    const base = await fixture('side-platformer');
    const pending = await buildPendingWorldArtSelectionReview(base.input);
    await expect(materializePassedWorldArtSelectionReview(pending, base.input))
      .rejects.toMatchObject({ code: 'world-art-selection-review.invalid-review' });

    const unapprovedSlot = approve(pending);
    unapprovedSlot.tasks[0].slots[0].decision = 'pending';
    await expect(materializeWorldArtSelectionReview(unapprovedSlot, base.input))
      .rejects.toMatchObject({ code: 'world-art-selection-review.invalid-review' });

    const falseDeclaration = approve(pending);
    falseDeclaration.declarations.visual_quality_approved = false;
    await expect(materializeWorldArtSelectionReview(falseDeclaration, base.input))
      .rejects.toMatchObject({ code: 'world-art-selection-review.invalid-review' });
  });

  it('rejects source, artifact, slot, selection, and order tampering', async () => {
    const base = await fixture('isometric-action');
    const pending = await buildPendingWorldArtSelectionReview(base.input);
    const mutations = [
      (value: any) => { value.source.layout_plan_sha256 = '0'.repeat(64); },
      (value: any) => { value.source.run_set_sha256 = '0'.repeat(64); },
      (value: any) => { value.tasks[0].artifact_sha256 = '0'.repeat(64); },
      (value: any) => { value.tasks[0].slots[0].atlas_cell.column += 1; },
      (value: any) => { value.tasks.reverse(); },
      (value: any) => {
        const character = value.tasks
          .flatMap((task: any) => task.slots)
          .find((slot: any) => slot.role.startsWith('character.'));
        value.selections[0].slot_id = character.slot_id;
      },
    ];
    for (const mutate of mutations) {
      const changed = mutable(pending);
      mutate(changed);
      await expect(materializeWorldArtSelectionReview(changed, base.input))
        .rejects.toBeInstanceOf(Error);
    }
  });

  it('rejects rights drift and unsupported review metadata', async () => {
    const base = await fixture('topdown-farm');
    const pending = await buildPendingWorldArtSelectionReview(base.input);
    const rightsDrift = mutable(pending);
    rightsDrift.rights.distribution = 'internal-review';
    await expect(materializeWorldArtSelectionReview(rightsDrift, base.input))
      .rejects.toMatchObject({ code: 'world-art-selection-review.invalid-rights' });

    const remoteMetadata = mutable(pending);
    remoteMetadata.provider_request_id = 'remote-request-123';
    await expect(materializeWorldArtSelectionReview(remoteMetadata, base.input))
      .rejects.toMatchObject({ code: 'world-art-selection-review.invalid-shape' });
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
    expect(validate(remoteMetadata)).toBe(false);
  });

  it('does not expose private intake, prompts, paths, or provider metadata', async () => {
    const base = await fixture('layered-depth-2d');
    const pending = await buildPendingWorldArtSelectionReview(base.input);
    const json = new TextDecoder().decode(
      await serializeCanonicalWorldArtSelectionReview(pending, base.input),
    ).toLowerCase();

    for (const forbidden of [
      PRIVATE_MARKER,
      'private-input',
      'private-seed',
      'provider_request_id',
      'remote_asset_id',
      'model_id',
      'credentials',
      'openai',
      'midjourney',
      'stability',
      'prompt',
      'negative_constraints',
    ]) {
      expect(json).not.toContain(forbidden.toLowerCase());
    }
    expect(pending.tasks.every(({ output_path }) =>
      output_path.startsWith('production-art/layered-depth-2d/'))).toBe(true);
  }, 15_000);
});
