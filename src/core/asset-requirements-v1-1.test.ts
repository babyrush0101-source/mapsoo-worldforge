import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-asset-requirements-1.1.schema.json';
import type { WorldAssetProfile } from './asset-profile';
import {
  buildAssetRequirementsV1_1,
  fingerprintAssetRequirementsV1_1,
  materializeAssetRequirementsV1_1,
  serializeCanonicalAssetRequirementsV1_1,
  supportedProductionArtRolesV1_1,
} from './asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import { requiredProductionArtRoles } from './production-art-contract';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from './world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from './world-layout-plan';

const PRIVATE_MARKER = 'PRIVATE_DO_NOT_EXPORT';
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

async function fixture(profile: WorldAssetProfile, intent = INTENT) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `requirements-v11-${profile}`,
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
  const plan = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, plan);
  return { constraints, plan, requirements };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('AssetRequirements 1.1', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('builds one requirement per supported demanded role for %s', async (profile) => {
    const { constraints, plan, requirements } = await fixture(profile);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(requirements), JSON.stringify(validate.errors)).toBe(true);
    expect(new Set(requirements.requirements.map(({ binding }) => binding.role)).size)
      .toBe(requirements.requirements.length);
    expect(requirements.requirements
      .filter(({ usage }) => usage === 'profile-complete')
      .map(({ binding }) => binding.role))
      .toEqual(requiredProductionArtRoles(profile));
    expect(requirements.requirements.every(({ binding }) =>
      supportedProductionArtRolesV1_1(profile).includes(binding.role))).toBe(true);
    expect(requirements.requirements.every(({ variants, required_output }) =>
      variants.length === required_output.count)).toBe(true);
    await expect(materializeAssetRequirementsV1_1(
      requirements,
      { constraints, plan },
    )).resolves.toEqual(requirements);
  });

  it('keeps enum choices as structural values, not output counts', async () => {
    const { requirements } = await fixture('side-platformer');
    const preview = requirements.requirements.find(({ binding }) =>
      binding.role === 'world.preview');

    expect(preview?.structural_values).toEqual([
      { axis: 'route-shape', value: 'loop' },
      { axis: 'scale', value: 'extended' },
    ]);
    expect(preview?.variants).toEqual([
      { variant_id: 'canonical', identity_kind: 'canonical-role' },
    ]);
    expect(preview?.required_output.count).toBe(1);
  });

  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('creates label-free landmark variants for %s', async (profile) => {
    const { requirements } = await fixture(profile);
    const landmarks = requirements.requirements.find(({ binding }) =>
      binding.role === 'structure.landmark');

    expect(landmarks?.variants).toEqual([
      {
        variant_id: 'landmark-001',
        identity_kind: 'layout-landmark',
        layout_ref: { kind: 'landmark', id: 'landmark-001' },
      },
      {
        variant_id: 'landmark-002',
        identity_kind: 'layout-landmark',
        layout_ref: { kind: 'landmark', id: 'landmark-002' },
      },
      {
        variant_id: 'landmark-003',
        identity_kind: 'layout-landmark',
        layout_ref: { kind: 'landmark', id: 'landmark-003' },
      },
      {
        variant_id: 'landmark-004',
        identity_kind: 'layout-landmark',
        layout_ref: { kind: 'landmark', id: 'landmark-004' },
      },
    ]);
    expect(landmarks?.required_output.count).toBe(4);
    expect(JSON.stringify(requirements)).not.toContain(PRIVATE_MARKER);
  });

  it('adds honest extension roles only when demanded by the layout', async () => {
    const side = await fixture('side-platformer');
    const topdown = await fixture('topdown-farm');
    const layered = await fixture('layered-depth-2d');

    expect(side.requirements.requirements.map(({ binding }) => binding.role))
      .toEqual(expect.arrayContaining(['terrain.water', 'structure.landmark']));
    expect(topdown.requirements.requirements.map(({ binding }) => binding.role))
      .toEqual(expect.arrayContaining(['hazard.contact', 'structure.landmark']));
    expect(layered.requirements.requirements.map(({ binding }) => binding.role))
      .toContain('hazard.contact');

    const calmDry = await fixture('side-platformer', {
      ...INTENT,
      water: 'none',
      hazard_level: 'calm',
    });
    expect(calmDry.requirements.requirements.map(({ binding }) => binding.role))
      .not.toContain('terrain.water');
  });

  it('is deterministic and rejects source-bound tampering', async () => {
    const left = await fixture('topdown-farm');
    const right = await fixture('topdown-farm');

    expect(await fingerprintAssetRequirementsV1_1(left.requirements))
      .toBe(await fingerprintAssetRequirementsV1_1(right.requirements));
    expect(await serializeCanonicalAssetRequirementsV1_1(left.requirements))
      .toEqual(await serializeCanonicalAssetRequirementsV1_1(right.requirements));

    const tampered = mutable(left.requirements);
    tampered.requirements[0].required_output.count = 2;
    await expect(materializeAssetRequirementsV1_1(
      tampered,
      { constraints: left.constraints, plan: left.plan },
    )).rejects.toMatchObject({
      code: 'asset-requirements-1.1.invalid-binding',
    });
  });
});
