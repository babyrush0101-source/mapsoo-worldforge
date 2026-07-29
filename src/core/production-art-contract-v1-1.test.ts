import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-production-art-1.1.schema.json';
import type { WorldAssetProfile } from './asset-profile';
import {
  buildAssetRequirementsV1_1,
  fingerprintAssetRequirementsV1_1,
} from './asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import {
  buildProductionArtPlanV1_1,
  fingerprintProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
  serializeCanonicalProductionArtPlanV1_1,
} from './production-art-contract-v1-1';
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

async function fixture(profile: WorldAssetProfile) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `production-art-v11-${profile}`,
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
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(intake, INTENT);
  const layoutPlan = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layoutPlan);
  const plan = await buildProductionArtPlanV1_1(requirements, RIGHTS);
  return { requirements, plan };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('ProductionArtPlan 1.1', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('is deterministic, schema-valid, source-bound, and private for %s', async (profile) => {
    const left = await fixture(profile);
    const right = await buildProductionArtPlanV1_1(left.requirements, RIGHTS);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(left.plan), JSON.stringify(validate.errors)).toBe(true);
    expect(left.plan.source).toEqual({
      requirements_id: left.requirements.requirements_id,
      requirements_sha256: await fingerprintAssetRequirementsV1_1(left.requirements),
    });
    expect(await fingerprintProductionArtPlanV1_1(left.plan, left.requirements))
      .toBe(await fingerprintProductionArtPlanV1_1(right, left.requirements));
    expect(await serializeCanonicalProductionArtPlanV1_1(left.plan, left.requirements))
      .toEqual(await serializeCanonicalProductionArtPlanV1_1(right, left.requirements));
    expect(JSON.stringify(left.plan)).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(left.plan)).not.toContain('private-input');
    expect(JSON.stringify(left.plan)).not.toContain('private-seed');
  });

  it('maps one role with multiple variants into independent row-major cells', async () => {
    const { plan } = await fixture('side-platformer');
    const slots = plan.tasks
      .flatMap(({ slot_mappings: mappings }) => mappings)
      .filter(({ role }) => role === 'structure.landmark');

    expect(slots.map(({ variant_id: variantId }) => variantId)).toEqual([
      'landmark-001',
      'landmark-002',
      'landmark-003',
      'landmark-004',
    ]);
    expect(new Set(slots.map(({ grid_rect: rect }) => `${rect.column}:${rect.row}`)).size).toBe(4);
    expect(slots.every(({ grid_rect: rect }) =>
      rect.column_span === 1 && rect.row_span === 1)).toBe(true);
  });

  it('uses a composite sheet for world.preview and a bound pose grid for every character', async () => {
    const { plan } = await fixture('isometric-action');
    const preview = plan.tasks.find(({ kind }) => kind === 'scene-direction');
    expect(preview?.requirement_assignments[0].strategy).toBe('composite-sheet');
    expect(preview?.slot_mappings[0].grid_rect).toEqual({
      column: 0,
      row: 0,
      column_span: 1,
      row_span: 1,
    });

    const characters = plan.tasks.filter(({ kind }) => kind === 'character-animation-sheet');
    expect(characters.length).toBeGreaterThan(0);
    for (const character of characters) {
      expect(character.requirement_assignments[0].strategy).toBe('pose-grid');
      expect(character.pose_mappings?.length).toBeGreaterThan(0);
      expect(character.pose_mappings?.every((pose) =>
        pose.slot_id === character.slot_mappings[0].slot_id
        && pose.requirement_id === character.slot_mappings[0].requirement_id
        && pose.variant_id === character.slot_mappings[0].variant_id)).toBe(true);
    }
  });

  it('places canonical sheet slots row-major without exceeding page capacity', async () => {
    const base = await fixture('side-platformer');
    const left = await buildProductionArtPlanV1_1(base.requirements, RIGHTS);
    const right = await buildProductionArtPlanV1_1(base.requirements, RIGHTS);
    const pages = left.tasks.filter(({ task_id: taskId }) => taskId.startsWith('prop-sheet-'));

    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const columns = page.target.width / page.target.cell_width;
      const rows = page.target.height / page.target.cell_height;
      expect(page.slot_mappings.length).toBeLessThanOrEqual(columns * rows);
      expect(page.slot_mappings.map(({ grid_rect: rect }) => [rect.column, rect.row]))
        .toEqual(page.slot_mappings.map((_, index) => [
          index % columns,
          Math.floor(index / columns),
        ]));
    }
    expect(left).toEqual(right);
  });

  it('rejects source, assignment, slot, and cell tampering', async () => {
    const { requirements, plan } = await fixture('topdown-farm');
    for (const mutate of [
      (value: any) => { value.source.requirements_sha256 = '0'.repeat(64); },
      (value: any) => { value.tasks[0].requirement_assignments[0].role = 'prop.fake'; },
      (value: any) => { value.tasks[0].slot_mappings[0].variant_id = 'landmark-999'; },
      (value: any) => { value.tasks[1].slot_mappings[0].grid_rect.column += 1; },
    ]) {
      const changed = mutable(plan);
      mutate(changed);
      await expect(materializeProductionArtPlanV1_1(changed, requirements))
        .rejects.toMatchObject({ code: 'production-art-1.1.invalid-binding' });
    }
  });

  it('rejects unresolved requirement bindings before task construction', async () => {
    const { requirements } = await fixture('layered-depth-2d');
    const unresolved = mutable(requirements);
    unresolved.requirements[0].binding = {
      status: 'unresolved',
      reason: 'no-canonical-role',
    };
    await expect(buildProductionArtPlanV1_1(unresolved, RIGHTS))
      .rejects.toMatchObject({ code: 'production-art-1.1.invalid-requirements' });
  });
});
