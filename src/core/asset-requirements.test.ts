import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import assetRequirementsSchema from '../../schemas/mapsoo-asset-requirements-1.0.schema.json';
import { type WorldAssetProfile } from './asset-profile';
import {
  ASSET_REQUIREMENT_STRUCTURAL_AXES,
  buildAssetRequirements,
  fingerprintAssetRequirements,
  materializeAssetRequirements,
  serializeCanonicalAssetRequirements,
  AssetRequirementsError,
  type AssetRequirementStructuralAxis,
} from './asset-requirements';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import { requiredProductionArtRoles } from './production-art-contract';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from './world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from './world-layout-plan';

const CHARACTER_HASH = 'a'.repeat(64);
const ENVIRONMENT_HASH = 'b'.repeat(64);
const IDENTITY_HASH = 'c'.repeat(64);
const PREVIEW_HASH = 'd'.repeat(64);

const PRIVATE_FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'Private courier premise must never enter public art requirements.',
  worldview: 'Private worldview sentence.',
  terrain: 'Private terrain prose.',
  geography: 'Private geography prose.',
  culture: 'Private culture prose.',
  ecology: 'Private ecology prose.',
  mood: 'Private mood prose.',
  art_direction: 'Private art direction prose.',
  traversal: 'Private traversal prose.',
  landmarks: 'Secret Ferry, Hidden Market, Private Hill Gate',
});

const DEFAULT_INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'fork-rejoin',
  scale: 'standard',
  verticality: 'medium',
  water: 'crossing',
  settlement_density: 'settled',
  hazard_level: 'guarded',
  landmark_labels: Object.freeze(['Secret Ferry', 'Hidden Market', 'Private Hill Gate']),
});

function reference(role: 'environment-style' | 'character') {
  const stem = role === 'character' ? 'traveler' : 'harbor';
  return {
    id: `${stem}-reference`,
    role,
    path: `private-input/${stem}.png`,
    mediaType: 'image/png',
    byteLength: 4096,
    width: 512,
    height: 512,
    sha256: role === 'character' ? CHARACTER_HASH : ENVIRONMENT_HASH,
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  } as const;
}

async function intake(profile: WorldAssetProfile): Promise<ConfirmedWorldCreationIntake> {
  return createConfirmedWorldCreationIntake({
    intake_id: `asset-requirements-${profile}`,
    session_revision: 8,
    profile,
    target: 'raspberry-pi-4b',
    seed: `private-seed-${profile}`,
    facts: PRIVATE_FACTS,
    character_source: {
      reference_id: 'traveler-reference',
      identity_digest_sha256: IDENTITY_HASH,
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: PREVIEW_HASH,
  });
}

async function fixture(
  profile: WorldAssetProfile,
  intent: WorldLayoutConstraintIntent = DEFAULT_INTENT,
) {
  const confirmed = await intake(profile);
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(confirmed, intent);
  const plan = await solveWorldLayoutPlanFromConstraints(constraints, confirmed);
  const requirements = await buildAssetRequirements(constraints, plan);
  return { confirmed, constraints, plan, requirements };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

describe('AssetRequirements 1.0', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('covers the exact canonical visual role inventory for %s', async (profile) => {
    const { constraints, plan, requirements } = await fixture(profile);
    const validate = new Ajv2020({ strict: true, allErrors: true })
      .compile(assetRequirementsSchema);

    expect(validate(requirements), JSON.stringify(validate.errors)).toBe(true);
    expect(requirements.requirements
      .filter(({ usage }) => usage === 'profile-complete')
      .map(({ binding }) => (
        binding.status === 'canonical-role' ? binding.role : 'unresolved'
      ))).toEqual(requiredProductionArtRoles(profile));
    expect(requirements.requirements.some(({ binding }) => (
      binding.status === 'canonical-role'
      && ['world.scene', 'world.collision', 'world.navigation'].includes(binding.role)
    ))).toBe(false);
    expect(requirements.source).toEqual({
      constraints_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      layout_plan_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(materializeAssetRequirements(
      requirements,
      { constraints, plan },
    )).resolves.toEqual(requirements);
    expect(Object.isFrozen(requirements)).toBe(true);
    expect(Object.isFrozen(requirements.source)).toBe(true);
    expect(Object.isFrozen(requirements.layout)).toBe(true);
    expect(Object.isFrozen(requirements.requirements)).toBe(true);
    expect(Object.isFrozen(requirements.requirements[0].binding)).toBe(true);
    expect(Object.isFrozen(requirements.requirements[0].structural_axes)).toBe(true);
  });

  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('makes every structural axis change the semantic inventory for %s', async (profile) => {
    const variants: Readonly<Record<
      AssetRequirementStructuralAxis,
      readonly [WorldLayoutConstraintIntent, WorldLayoutConstraintIntent]
    >> = {
      'route-shape': [
        { ...DEFAULT_INTENT, route_shape: 'direct' },
        { ...DEFAULT_INTENT, route_shape: 'loop' },
      ],
      scale: [
        { ...DEFAULT_INTENT, scale: 'compact' },
        { ...DEFAULT_INTENT, scale: 'extended' },
      ],
      verticality: [
        { ...DEFAULT_INTENT, verticality: 'low' },
        { ...DEFAULT_INTENT, verticality: 'high' },
      ],
      water: [
        { ...DEFAULT_INTENT, water: 'none' },
        { ...DEFAULT_INTENT, water: 'basin' },
      ],
      'settlement-density': [
        { ...DEFAULT_INTENT, settlement_density: 'sparse' },
        { ...DEFAULT_INTENT, settlement_density: 'dense' },
      ],
      'hazard-level': [
        { ...DEFAULT_INTENT, hazard_level: 'calm' },
        { ...DEFAULT_INTENT, hazard_level: 'dangerous' },
      ],
      'landmark-count': [
        { ...DEFAULT_INTENT, landmark_labels: ['Private Alpha', 'Private Beta'] },
        {
          ...DEFAULT_INTENT,
          landmark_labels: [
            'Private Alpha',
            'Private Beta',
            'Private Gamma',
            'Private Delta',
          ],
        },
      ],
    };

    for (const axis of ASSET_REQUIREMENT_STRUCTURAL_AXES) {
      const [leftIntent, rightIntent] = variants[axis];
      const left = await fixture(profile, leftIntent);
      const right = await fixture(profile, rightIntent);
      const axisProjection = (value: typeof left.requirements) => value.requirements
        .filter(({ structural_axes: axes }) => axes.includes(axis));
      expect(axisProjection(left.requirements), axis)
        .not.toEqual(axisProjection(right.requirements));
    }
  });

  it('surfaces structural art gaps instead of borrowing an unrelated canonical role', async () => {
    const sideWater = await fixture('side-platformer', {
      ...DEFAULT_INTENT,
      water: 'basin',
    });
    const topdownHazard = await fixture('topdown-farm', {
      ...DEFAULT_INTENT,
      hazard_level: 'dangerous',
    });

    expect(sideWater.requirements.requirements.find(({ structural_axes }) =>
      structural_axes.includes('water'))?.binding).toEqual({
      status: 'unresolved',
      reason: 'no-canonical-role',
    });
    expect(topdownHazard.requirements.requirements.find(({ structural_axes }) =>
      structural_axes.includes('hazard-level'))?.binding).toEqual({
      status: 'unresolved',
      reason: 'no-canonical-role',
    });
  });

  it('preserves structural-axis differences without carrying landmark labels', async () => {
    const compact = await fixture('layered-depth-2d', {
      route_shape: 'direct',
      scale: 'compact',
      verticality: 'low',
      water: 'none',
      settlement_density: 'sparse',
      hazard_level: 'calm',
      landmark_labels: ['Private Alpha', 'Private Beta'],
    });
    const extended = await fixture('layered-depth-2d', {
      route_shape: 'loop',
      scale: 'extended',
      verticality: 'high',
      water: 'basin',
      settlement_density: 'dense',
      hazard_level: 'dangerous',
      landmark_labels: ['Private Alpha', 'Private Beta', 'Private Gamma', 'Private Delta'],
    });

    expect(compact.requirements.layout).toMatchObject({
      route_shape: 'direct',
      scale: 'compact',
      verticality: 'low',
      water: 'none',
      settlement_density: 'sparse',
      hazard_level: 'calm',
      landmark_count: 2,
    });
    expect(extended.requirements.layout).toMatchObject({
      route_shape: 'loop',
      scale: 'extended',
      verticality: 'high',
      water: 'basin',
      settlement_density: 'dense',
      hazard_level: 'dangerous',
      landmark_count: 4,
    });
    expect(extended.requirements.requirements_id)
      .not.toBe(compact.requirements.requirements_id);
    expect(await fingerprintAssetRequirements(extended.requirements))
      .not.toBe(await fingerprintAssetRequirements(compact.requirements));
    expect(JSON.stringify(extended.requirements)).not.toContain('Private Gamma');
  });

  it('serializes and fingerprints deterministically', async () => {
    const first = await fixture('isometric-action');
    const second = await fixture('isometric-action');

    expect(first.requirements).toEqual(second.requirements);
    expect(await fingerprintAssetRequirements(first.requirements))
      .toBe(await fingerprintAssetRequirements(second.requirements));
    expect(await serializeCanonicalAssetRequirements(first.requirements))
      .toEqual(await serializeCanonicalAssetRequirements(second.requirements));
    expect(new TextDecoder().decode(
      await serializeCanonicalAssetRequirements(first.requirements),
    ).endsWith('\n')).toBe(true);
  });

  it('excludes raw dialogue, references, providers, prompts, paths, digests and landmark labels', async () => {
    const { requirements } = await fixture('topdown-farm');
    const serialized = JSON.stringify(requirements);
    const keys = allKeys(requirements);

    for (const value of Object.values(PRIVATE_FACTS)) {
      expect(serialized).not.toContain(value);
    }
    for (const label of DEFAULT_INTENT.landmark_labels) {
      expect(serialized).not.toContain(label);
    }
    expect(serialized).not.toContain('private-input/');
    expect(serialized).not.toContain('private-seed-');
    expect(keys).not.toContain('provider');
    expect(keys).not.toContain('model');
    expect(keys).not.toContain('prompt');
    expect(keys).not.toContain('path');
    expect(keys).not.toContain('raw_dialogue');
    expect(keys).not.toContain('reference_digest');
    expect(keys).not.toContain('landmark_labels');
  });

  it('fails closed on shape, semantic, digest and expected-source tampering', async () => {
    const { constraints, plan, requirements } = await fixture('side-platformer');

    const extraPrompt = mutable(requirements);
    extraPrompt.prompt = 'forbidden';
    await expect(materializeAssetRequirements(extraPrompt)).rejects.toMatchObject({
      code: 'asset-requirements.invalid-shape',
    });

    const runtimeRole = mutable(requirements);
    runtimeRole.requirements[0].binding.role = 'world.scene';
    await expect(materializeAssetRequirements(runtimeRole)).rejects.toMatchObject({
      code: 'asset-requirements.invalid-binding',
    });

    const alteredVariant = mutable(requirements);
    alteredVariant.requirements[0].variant_count += 1;
    await expect(materializeAssetRequirements(alteredVariant)).rejects.toMatchObject({
      code: 'asset-requirements.invalid-binding',
    });

    const alteredDigest = mutable(requirements);
    alteredDigest.source.constraints_sha256 = 'f'.repeat(64);
    await expect(materializeAssetRequirements(
      alteredDigest,
      { constraints, plan },
    )).rejects.toBeInstanceOf(AssetRequirementsError);

    const other = await fixture('side-platformer', {
      ...DEFAULT_INTENT,
      scale: 'extended',
    });
    await expect(materializeAssetRequirements(
      requirements,
      { constraints: other.constraints, plan: other.plan },
    )).rejects.toMatchObject({
      code: 'asset-requirements.invalid-binding',
    });
  });
});
