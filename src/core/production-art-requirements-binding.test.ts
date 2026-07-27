import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import bindingSchema from '../../schemas/mapsoo-production-art-requirements-binding-1.0.schema.json';
import { type WorldAssetProfile } from './asset-profile';
import { buildAssetRequirements } from './asset-requirements';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
} from './production-art-contract';
import {
  buildProductionArtRequirementsBinding,
  fingerprintProductionArtRequirementsBinding,
  materializeProductionArtRequirementsBinding,
  serializeCanonicalProductionArtRequirementsBinding,
} from './production-art-requirements-binding';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
} from './world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from './world-layout-plan';

const HASHES = Object.freeze({
  character: 'a'.repeat(64),
  environment: 'b'.repeat(64),
  identity: 'c'.repeat(64),
  preview: 'd'.repeat(64),
});

const PRIVATE_FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'A private courier premise.',
  worldview: 'A private worldview.',
  terrain: 'A private terrain description.',
  geography: 'A private geography description.',
  culture: 'A private culture description.',
  ecology: 'A private ecology description.',
  mood: 'A private mood description.',
  art_direction: 'A private art direction.',
  traversal: 'A private traversal description.',
  landmarks: 'Private Ferry, Private Market, Private Gate',
});

function reference(role: 'environment-style' | 'character') {
  const name = role === 'character' ? 'traveler' : 'world';
  return {
    id: `${name}-reference`,
    role,
    path: `private/${name}.png`,
    mediaType: 'image/png',
    byteLength: 1024,
    width: 256,
    height: 256,
    sha256: role === 'character' ? HASHES.character : HASHES.environment,
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  } as const;
}

async function fixture(profile: WorldAssetProfile, includeUnresolved = false) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `requirements-binding-${profile}`,
    session_revision: 8,
    profile,
    target: 'raspberry-pi-4b',
    seed: `private-seed-${profile}`,
    facts: PRIVATE_FACTS,
    character_source: {
      reference_id: 'traveler-reference',
      identity_digest_sha256: HASHES.identity,
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: HASHES.preview,
  });
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(intake, {
    route_shape: 'fork-rejoin',
    scale: 'standard',
    verticality: 'medium',
    water: profile === 'side-platformer' || profile === 'isometric-action'
      ? includeUnresolved ? 'crossing' : 'none'
      : 'crossing',
    settlement_density: 'settled',
    hazard_level: profile === 'topdown-farm' || profile === 'layered-depth-2d'
      ? includeUnresolved ? 'guarded' : 'calm'
      : 'guarded',
    landmark_labels: ['Private Ferry', 'Private Market', 'Private Gate'],
  });
  const layoutPlan = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const assetRequirements = await buildAssetRequirements(constraints, layoutPlan);
  const productionArtPlan = createProductionArtPlan(profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const binding = await buildProductionArtRequirementsBinding(
    assetRequirements,
    productionArtPlan,
  );
  return { assetRequirements, productionArtPlan, binding };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function repairBindingId(value: any): Promise<any> {
  value.binding_id = `requirements-binding-${(await sha256({
    profile: value.profile,
    status: value.status,
    source: value.source,
    mappings: value.mappings,
    blockers: value.blockers,
  })).slice(0, 16)}`;
  return value;
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

describe('ProductionArtRequirementsBinding 1.0', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('maps every %s canonical-role requirement to its exact task', async (profile) => {
    const { assetRequirements, productionArtPlan, binding } = await fixture(profile);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(bindingSchema);

    expect(validate(binding), JSON.stringify(validate.errors)).toBe(true);
    expect(binding.status).toBe('ready');
    expect(binding.blockers).toEqual([]);
    expect(binding.mappings).toHaveLength(assetRequirements.requirements.length);
    for (const mapping of binding.mappings) {
      const requirement = assetRequirements.requirements.find(
        ({ requirement_id: id }) => id === mapping.requirement_id,
      )!;
      const task = productionArtPlan.tasks.find(
        ({ task_id: id }) => id === mapping.task_id,
      )!;
      expect(requirement.binding).toEqual({
        status: 'canonical-role',
        role: mapping.role,
      });
      expect(mapping.variant_count).toBe(requirement.variant_count);
      expect(task.role_mappings.some(({ role }) => role === mapping.role)).toBe(true);
    }
    expect(binding.source.asset_requirements_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.source.production_art_plan_sha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(materializeProductionArtRequirementsBinding(binding, {
      assetRequirements,
      productionArtPlan,
    })).resolves.toEqual(binding);
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.source)).toBe(true);
    expect(Object.isFrozen(binding.mappings)).toBe(true);
    expect(Object.isFrozen(binding.mappings[0])).toBe(true);
  });

  it('is deterministic and binds every canonical production plan field', async () => {
    const first = await fixture('side-platformer');
    const second = await fixture('side-platformer');
    expect(first.binding).toEqual(second.binding);
    expect(await fingerprintProductionArtRequirementsBinding(first.binding))
      .toBe(await fingerprintProductionArtRequirementsBinding(second.binding));
    expect(await serializeCanonicalProductionArtRequirementsBinding(first.binding))
      .toEqual(await serializeCanonicalProductionArtRequirementsBinding(second.binding));

    const changedPlan = mutable(first.productionArtPlan) as ProductionArtPlan;
    (changedPlan as any).tasks[0].prompt += ' Canonical hash mutation.';
    const changed = await buildProductionArtRequirementsBinding(
      first.assetRequirements,
      changedPlan,
    );
    expect(changed.source.production_art_plan_sha256)
      .not.toBe(first.binding.source.production_art_plan_sha256);
    expect(changed.binding_id).not.toBe(first.binding.binding_id);
  });

  it('derives and materializes stable blockers for unresolved layout-critical requirements', async () => {
    const { assetRequirements, productionArtPlan, binding } = await fixture('topdown-farm', true);
    const unresolved = assetRequirements.requirements.filter(
      ({ binding: requirementBinding, usage }) => (
        requirementBinding.status === 'unresolved' && usage === 'layout-critical'
      ),
    );

    expect(unresolved).toHaveLength(1);
    const first = await materializeProductionArtRequirementsBinding(binding, {
      assetRequirements,
      productionArtPlan,
    });
    const second = await materializeProductionArtRequirementsBinding(binding);
    expect(first.status).toBe('blocked');
    expect(first.blockers).toEqual([{
      blocker_id: 'blocker-001',
      requirement_id: unresolved[0].requirement_id,
      code: 'unresolved-layout-critical',
    }]);
    expect(first).toEqual(second);
    expect(await fingerprintProductionArtRequirementsBinding(first))
      .toBe(await fingerprintProductionArtRequirementsBinding(second));
  });

  it('fails closed on mapping, source, shape and profile tampering', async () => {
    const { assetRequirements, productionArtPlan, binding } = await fixture('isometric-action');

    const changedVariant = mutable(binding);
    changedVariant.mappings[0].variant_count += 1;
    await repairBindingId(changedVariant);
    await expect(materializeProductionArtRequirementsBinding(changedVariant, {
      assetRequirements,
      productionArtPlan,
    })).rejects.toMatchObject({
      code: 'production-art-requirements-binding.invalid-binding',
    });

    const changedSource = mutable(binding);
    changedSource.source.production_art_plan_sha256 = 'f'.repeat(64);
    await repairBindingId(changedSource);
    await expect(materializeProductionArtRequirementsBinding(changedSource, {
      assetRequirements,
      productionArtPlan,
    })).rejects.toMatchObject({
      code: 'production-art-requirements-binding.invalid-binding',
    });

    const extra = mutable(binding);
    extra.provider = 'forbidden';
    await expect(materializeProductionArtRequirementsBinding(extra)).rejects.toMatchObject({
      code: 'production-art-requirements-binding.invalid-shape',
    });

    const otherPlan = createProductionArtPlan('topdown-farm', {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    });
    await expect(buildProductionArtRequirementsBinding(
      assetRequirements,
      otherPlan,
    )).rejects.toMatchObject({
      code: 'production-art-requirements-binding.invalid-binding',
    });
  });

  it('does not expose prompts, paths, provider choices, references or private world text', async () => {
    const { binding } = await fixture('layered-depth-2d');
    const serialized = JSON.stringify(binding);
    const keys = allKeys(binding);

    for (const value of Object.values(PRIVATE_FACTS)) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain('Private Ferry');
    expect(serialized).not.toContain('private/');
    expect(keys).not.toContain('prompt');
    expect(keys).not.toContain('path');
    expect(keys).not.toContain('provider');
    expect(keys).not.toContain('model');
    expect(keys).not.toContain('reference');
    expect(keys).not.toContain('landmark_labels');
  });
});
