import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-world-art-placement-map-1.0.schema.json';
import { deriveWorldVisualPlacementPlan } from '../adapters/derive-world-visual-placement-plan';
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
import type { ReviewedWorldArtSlotInventory } from './world-art-variant-map';
import {
  buildWorldArtPlacementMap,
  fingerprintWorldArtPlacementMap,
  materializeWorldArtPlacementMap,
  serializeCanonicalWorldArtPlacementMap,
  WorldArtPlacementMapError,
  type WorldArtPlacementMapInput,
} from './world-art-placement-map';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from './world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from './world-layout-plan';

const FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'A traveler reconnects four districts after a storm changes the main route.',
  worldview: 'Restored paths change how neighboring communities cooperate.',
  terrain: 'Readable paths, water, ridges, terraces, gardens, and sheltered crossings.',
  geography: 'A gate, market, workshop, homes, and a distant beacon define the route.',
  culture: 'Crafts, lanterns, shared meals, and public performances shape local life.',
  ecology: 'Trees, reeds, flowers, birds, moss, and shallow pools respond to the season.',
  mood: 'Hopeful exploration with gentle mystery and strong readable silhouettes.',
  art_direction: 'Original pixel art with coherent materials and a restrained palette.',
  traversal: 'Start at the gate, cross the center, visit each landmark, and reach the exit.',
  landmarks: 'Old gate, Lantern market, Waterwheel workshop, Hill beacon',
});

const INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'standard',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'dangerous',
  landmark_labels: Object.freeze([
    'Old gate',
    'Lantern market',
    'Waterwheel workshop',
    'Hill beacon',
  ]),
});

const RIGHTS = Object.freeze({
  distribution: 'public' as const,
  license: 'CC0-1.0' as const,
});

async function fixture(
  profile: WorldAssetProfile = 'topdown-farm',
  suffix: string = profile,
) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `placement-map-${suffix}`,
    session_revision: 5,
    profile,
    target: 'raspberry-pi-4b',
    seed: `placement-map-seed-${suffix}`,
    facts: FACTS,
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: 'c'.repeat(64),
    },
    references: [
      {
        id: 'environment-reference',
        role: 'environment-style',
        path: 'references/environment.png',
        mediaType: 'image/png',
        byteLength: 4096,
        width: 512,
        height: 512,
        sha256: 'b'.repeat(64),
        rights: {
          basis: 'owned',
          license: 'LicenseRef-User-Owned',
          allowGenerativeAdaptation: true,
          allowOutputRedistribution: true,
          allowOutputCc0Dedication: true,
        },
      },
      {
        id: 'character-reference',
        role: 'character',
        path: 'references/character.png',
        mediaType: 'image/png',
        byteLength: 4096,
        width: 512,
        height: 512,
        sha256: 'a'.repeat(64),
        rights: {
          basis: 'owned',
          license: 'LicenseRef-User-Owned',
          allowGenerativeAdaptation: true,
          allowOutputRedistribution: true,
          allowOutputCc0Dedication: true,
        },
      },
    ],
    approved_intent_preview_sha256: 'd'.repeat(64),
  });
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(intake, INTENT);
  const layout = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layout);
  const placementPlan = await deriveWorldVisualPlacementPlan({ layout, requirements });
  const productionPlan = await buildProductionArtPlanV1_1(requirements, RIGHTS);
  const productionPlanSha256 = await fingerprintProductionArtPlanV1_1(
    productionPlan,
    requirements,
  );
  const slots = productionPlan.tasks.flatMap((task) =>
    task.slot_mappings.map((slot) => ({
      slot_id: slot.slot_id,
      requirement_id: slot.requirement_id,
      role: slot.role,
      variant_id: slot.variant_id,
      atlas_path: task.expected_output_path,
      atlas_cell: slot.grid_rect,
    }))).sort((left, right) => left.slot_id.localeCompare(right.slot_id, 'en'));
  const inventory: ReviewedWorldArtSlotInventory = Object.freeze({
    schema_version: '1.0.0',
    document_type: 'reviewed-world-art-slot-inventory',
    profile,
    production_art_plan_id: productionPlan.plan_id,
    production_art_plan_sha256: productionPlanSha256,
    review_record_sha256: 'e'.repeat(64),
    review_status: 'pass',
    slots: Object.freeze(slots),
  });
  const input: WorldArtPlacementMapInput = Object.freeze({
    layout_plan: layout,
    placement_plan: placementPlan,
    asset_requirements: requirements,
    production_art_plan: productionPlan,
    reviewed_slot_inventory: inventory,
  });
  return {
    layout,
    requirements,
    placementPlan,
    productionPlan,
    inventory,
    input,
  };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('WorldArtPlacementMap 1.0', () => {
  it('binds every placement to one exact reviewed production-art slot', async () => {
    const source = await fixture();
    const map = await buildWorldArtPlacementMap(source.input);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(map), JSON.stringify(validate.errors)).toBe(true);
    expect(map.profile).toBe(source.layout.profile);
    expect(map.source.placement_plan_id).toBe(source.placementPlan.plan_id);
    expect(map.bindings).toHaveLength(source.placementPlan.placements.length);
    expect(map.bindings.map(({ placement_id: placementId }) => placementId)).toEqual(
      source.placementPlan.placements.map(({ placement_id: placementId }) => placementId),
    );
    await expect(materializeWorldArtPlacementMap(map, source.input)).resolves.toEqual(map);
  });

  it('allows multiple placements to reuse one catalog asset without duplicating the slot', async () => {
    const source = await fixture();
    const map = await buildWorldArtPlacementMap(source.input);
    const treeBindings = map.bindings.filter(({ role }) => role === 'prop.tree');

    expect(treeBindings).toHaveLength(2);
    expect(new Set(treeBindings.map(({ placement_id: placementId }) => placementId)).size).toBe(2);
    expect(new Set(treeBindings.map(({ slot_id: slotId }) => slotId)).size).toBe(1);
    expect(new Set(treeBindings.map(({ task_id: taskId }) => taskId)).size).toBe(1);
  });

  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('builds reviewed placement bindings for %s', async (profile) => {
    const source = await fixture(profile);
    const map = await buildWorldArtPlacementMap(source.input);

    expect(map.profile).toBe(profile);
    expect(map.bindings.length).toBeGreaterThan(0);
    expect(map.bindings.every(({ role, variant_id: variantId }) =>
      source.placementPlan.placements.some((placement) =>
        placement.role === role
        && (placement.variant_id ?? 'canonical') === variantId))).toBe(true);
  });

  it('serializes and fingerprints canonical reviewed bindings', async () => {
    const source = await fixture();
    const map = await buildWorldArtPlacementMap(source.input);
    const first = await serializeCanonicalWorldArtPlacementMap(map, source.input);
    const second = await serializeCanonicalWorldArtPlacementMap(map, source.input);

    expect(first).toEqual(second);
    expect(first.at(-1)).toBe(10);
    expect(new TextDecoder().decode(first)).not.toContain('\r\n');
    expect(await fingerprintWorldArtPlacementMap(map, source.input)).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('rejects missing, unreviewed, ambiguous, or private inventory slots', async () => {
    const source = await fixture();
    const missing = mutable(source.inventory);
    missing.slots = missing.slots.filter(({ role }: { role: string }) => role !== 'prop.tree');
    const pending = mutable(source.inventory);
    pending.review_status = 'pending';
    const duplicated = mutable(source.inventory);
    duplicated.slots.splice(1, 0, mutable(duplicated.slots[0]));
    const privatePath = mutable(source.inventory);
    privatePath.slots[0].atlas_path = 'private/source.png';

    for (const inventory of [missing, pending, duplicated, privatePath]) {
      await expect(buildWorldArtPlacementMap({
        ...source.input,
        reviewed_slot_inventory: inventory,
      })).rejects.toBeInstanceOf(WorldArtPlacementMapError);
    }
  });

  it('rejects a map whose placement is redirected to another reviewed slot', async () => {
    const source = await fixture();
    const map = await buildWorldArtPlacementMap(source.input);
    const tampered = mutable(map);
    const replacement = map.bindings.find(({ role }) => role !== map.bindings[0]!.role)!;
    tampered.bindings[0].task_id = replacement.task_id;
    tampered.bindings[0].slot_id = replacement.slot_id;
    tampered.bindings[0].requirement_id = replacement.requirement_id;
    tampered.bindings[0].role = replacement.role;
    tampered.bindings[0].variant_id = replacement.variant_id;
    tampered.bindings[0].atlas_path = replacement.atlas_path;
    tampered.bindings[0].atlas_cell = replacement.atlas_cell;

    await expect(
      materializeWorldArtPlacementMap(tampered, source.input),
    ).rejects.toMatchObject({
      code: 'world-art-placement-map.invalid-binding',
    } satisfies Partial<WorldArtPlacementMapError>);
  });

  it('rejects a placement plan, requirements, or review from another layout', async () => {
    const left = await fixture('topdown-farm', 'left');
    const right = await fixture('topdown-farm', 'right');

    for (const patch of [
      { placement_plan: right.placementPlan },
      { asset_requirements: right.requirements },
      { reviewed_slot_inventory: right.inventory },
    ]) {
      await expect(buildWorldArtPlacementMap({
        ...left.input,
        ...patch,
      })).rejects.toBeInstanceOf(WorldArtPlacementMapError);
    }
  });
});
