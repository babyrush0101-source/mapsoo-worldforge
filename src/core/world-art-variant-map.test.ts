import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-world-art-variant-map-1.0.schema.json';
import type { WorldAssetProfile } from './asset-profile';
import { buildAssetRequirementsV1_1 } from './asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import {
  buildProductionArtPlanV1_1,
  fingerprintProductionArtPlanV1_1,
} from './production-art-contract-v1-1';
import {
  buildWorldArtVariantMap,
  fingerprintWorldArtVariantMap,
  serializeCanonicalWorldArtVariantMap,
  validateWorldArtVariantMap,
  type ReviewedWorldArtSlotInventory,
  type WorldArtVariantMapInput,
  type WorldArtVariantSelection,
} from './world-art-variant-map';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from './world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from './world-layout-plan';
import { worldMaterialRoleForProfile } from './world-material-palette';

const PRIVATE_MARKER = 'PRIVATE_VARIANT_MAP_LABEL';
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
  scale: 'extended',
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
const RIGHTS = Object.freeze({
  distribution: 'public' as const,
  license: 'CC0-1.0' as const,
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
    intake_id: `variant-map-${profile}`,
    session_revision: 12,
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
  const layout = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layout);
  const plan = await buildProductionArtPlanV1_1(requirements, RIGHTS);
  const planSha = await fingerprintProductionArtPlanV1_1(plan, requirements);
  const slots = plan.tasks.flatMap((task) => task.slot_mappings.map((slot) => ({
    slot_id: slot.slot_id,
    requirement_id: slot.requirement_id,
    role: slot.role,
    variant_id: slot.variant_id,
    atlas_path: task.expected_output_path,
    atlas_cell: slot.grid_rect,
  })));
  const inventory: ReviewedWorldArtSlotInventory = {
    schema_version: '1.0.0',
    document_type: 'reviewed-world-art-slot-inventory',
    profile,
    production_art_plan_id: plan.plan_id,
    production_art_plan_sha256: planSha,
    review_record_sha256: 'e'.repeat(64),
    review_status: 'pass',
    slots,
  };
  const terrain = layout.terrain_layout.kind === 'bands'
    ? layout.terrain_layout.bands
    : layout.terrain_layout.zones;
  const materials = [...new Set(terrain.map(({ material }) => material))].sort();
  const selections: WorldArtVariantSelection[] = materials.map((material) => {
    const expectedRole = worldMaterialRoleForProfile(profile, material);
    const slot = slots.find(({ role }) => role === expectedRole);
    if (!slot) throw new Error(`Test fixture lacks terrain slot for ${profile}/${material}.`);
    return {
      usage_kind: 'terrain-material',
      usage_id: material,
      slot_id: slot.slot_id,
    };
  });
  for (const requirement of requirements.requirements) {
    if (requirement.category !== 'hazard' && requirement.category !== 'character') continue;
    const slot = slots.find(({ requirement_id: id }) => id === requirement.requirement_id);
    if (!slot) throw new Error(`Test fixture lacks slot for ${requirement.requirement_id}.`);
    selections.push({
      usage_kind: requirement.category,
      usage_id: requirement.requirement_id,
      slot_id: slot.slot_id,
    });
  }
  const input: WorldArtVariantMapInput = {
    layout_plan: layout,
    asset_requirements: requirements,
    production_art_plan: plan,
    reviewed_slot_inventory: inventory,
    selections,
  };
  return { layout, requirements, plan, inventory, selections, input };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('WorldArtVariantMap 1.0', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('builds a reviewed, source-bound runtime map for %s', async (profile) => {
    const fixtureValue = await fixture(profile);
    const map = await buildWorldArtVariantMap(fixtureValue.input);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(map), JSON.stringify(validate.errors)).toBe(true);
    expect(map.bindings.filter(({ usage_kind }) => usage_kind === 'landmark'))
      .toHaveLength(fixtureValue.layout.landmarks.length);
    expect(map.bindings.every(({ atlas_path }) =>
      atlas_path.startsWith(`production-art/${profile}/`))).toBe(true);
    expect(JSON.stringify(map)).not.toContain(PRIVATE_MARKER);
    await expect(validateWorldArtVariantMap(map, fixtureValue.input)).resolves.toEqual(map);
  });

  it('is deterministic and canonical', async () => {
    const fixtureValue = await fixture('topdown-farm');
    const left = await buildWorldArtVariantMap(fixtureValue.input);
    const right = await buildWorldArtVariantMap(fixtureValue.input);

    expect(left).toEqual(right);
    expect(await fingerprintWorldArtVariantMap(left, fixtureValue.input))
      .toBe(await fingerprintWorldArtVariantMap(right, fixtureValue.input));
    expect(await serializeCanonicalWorldArtVariantMap(left, fixtureValue.input))
      .toEqual(await serializeCanonicalWorldArtVariantMap(right, fixtureValue.input));
  });

  it('rejects changed sources, selections, bindings, review state, and private paths', async () => {
    const fixtureValue = await fixture('side-platformer');
    const map = await buildWorldArtVariantMap(fixtureValue.input);

    const changedMap = mutable(map);
    changedMap.bindings[0].slot_id = 'requirement-999-canonical';
    await expect(validateWorldArtVariantMap(changedMap, fixtureValue.input))
      .rejects.toMatchObject({ code: 'world-art-variant-map.invalid-binding' });

    const missingSelection = {
      ...fixtureValue.input,
      selections: fixtureValue.selections.slice(1),
    };
    await expect(buildWorldArtVariantMap(missingSelection))
      .rejects.toMatchObject({ code: 'world-art-variant-map.invalid-selection' });

    const failedReview = mutable(fixtureValue.inventory);
    failedReview.review_status = 'pending';
    await expect(buildWorldArtVariantMap({
      ...fixtureValue.input,
      reviewed_slot_inventory: failedReview,
    })).rejects.toMatchObject({ code: 'world-art-variant-map.invalid-inventory' });

    const privatePath = mutable(fixtureValue.inventory);
    privatePath.slots[0].atlas_path = 'C:\\private\\atlas.png';
    await expect(buildWorldArtVariantMap({
      ...fixtureValue.input,
      reviewed_slot_inventory: privatePath,
    })).rejects.toMatchObject({ code: 'world-art-variant-map.private-path' });
  });

  it('rejects a reviewed terrain slot that does not match the material palette role', async () => {
    const fixtureValue = await fixture('topdown-farm');
    const changedSelections = mutable(fixtureValue.selections);
    const meadow = changedSelections.find((selection: WorldArtVariantSelection) =>
      selection.usage_kind === 'terrain-material' && selection.usage_id === 'meadow');
    const waterSlot = fixtureValue.inventory.slots.find(({ role }) => role === 'terrain.water');
    if (!meadow || !waterSlot) throw new Error('Test fixture lacks meadow or water selection.');
    meadow.slot_id = waterSlot.slot_id;

    await expect(buildWorldArtVariantMap({
      ...fixtureValue.input,
      selections: changedSelections,
    })).rejects.toMatchObject({ code: 'world-art-variant-map.invalid-selection' });
  });

  it('rejects a layout from another confirmed world', async () => {
    const current = await fixture('layered-depth-2d');
    const other = await fixture('layered-depth-2d', {
      ...INTENT,
      route_shape: 'fork-rejoin',
      scale: 'compact',
    });

    await expect(buildWorldArtVariantMap({
      ...current.input,
      layout_plan: other.layout,
    })).rejects.toMatchObject({ code: 'world-art-variant-map.invalid-source' });
  });
});
