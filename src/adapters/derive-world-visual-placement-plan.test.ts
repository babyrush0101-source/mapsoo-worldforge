import { describe, expect, it } from 'vitest';

import {
  deriveWorldVisualPlacementPlan,
  DeriveWorldVisualPlacementPlanError,
} from './derive-world-visual-placement-plan';
import type { WorldAssetProfile } from '../core/asset-profile';
import { buildAssetRequirementsV1_1 } from '../core/asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from '../core/confirmed-world-creation-intake';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from '../core/world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from '../core/world-layout-plan';
import {
  materializeWorldVisualPlacementPlan,
} from '../core/world-visual-placement-plan';

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

async function fixture(profile: WorldAssetProfile, suffix: string = profile) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `placement-${suffix}`,
    session_revision: 4,
    profile,
    target: 'raspberry-pi-4b',
    seed: `placement-seed-${suffix}`,
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
  return { layout, requirements };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('deriveWorldVisualPlacementPlan', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('derives deterministic complete non-legacy placement coverage for %s', async (
    profile,
  ) => {
    const source = await fixture(profile);
    const first = await deriveWorldVisualPlacementPlan(source);
    const second = await deriveWorldVisualPlacementPlan(source);
    const roles = new Set(first.placements.map(({ role }) => role));

    expect(first).toEqual(second);
    expect(first.profile).toBe(profile);
    expect(first.bounds).toEqual(source.layout.bounds);
    expect(first.placements.length).toBeGreaterThan(0);
    expect(first.placements.some(({ role }) => role.startsWith('terrain.'))).toBe(false);
    expect(roles.has('character.player.atlas')).toBe(false);
    expect(roles.has('structure.landmark')).toBe(false);
    expect(roles.has('world.preview')).toBe(false);
    expect(first.placements.some(({ kind }) => kind === 'sprite')).toBe(true);
    await expect(
      materializeWorldVisualPlacementPlan(first, source.layout),
    ).resolves.toEqual(first);

    const demanded = source.requirements.requirements
      .map(({ binding }) => binding.role)
      .filter((role) =>
        !role.startsWith('terrain.')
        && role !== 'structure.landmark'
        && role !== 'character.player.atlas'
        && role !== 'world.preview'
        && (!role.startsWith('hazard.') || role === 'hazard.moving-platform'));
    expect([...new Set(demanded)].every((role) => roles.has(role))).toBe(true);
  });

  it('creates explicit depth, effect, enemy/NPC, and moving-platform semantics', async () => {
    const side = await fixture('side-platformer');
    const isometric = await fixture('isometric-action');
    const layered = await fixture('layered-depth-2d');
    const [sidePlan, isometricPlan, layeredPlan] = await Promise.all([
      deriveWorldVisualPlacementPlan(side),
      deriveWorldVisualPlacementPlan(isometric),
      deriveWorldVisualPlacementPlan(layered),
    ]);

    expect(sidePlan.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'background.sky',
        kind: 'depth-plane',
        render: expect.objectContaining({ layer: 'background' }),
      }),
      expect.objectContaining({
        role: 'hazard.moving-platform',
        kind: 'actor',
        controller: 'moving-platform',
      }),
    ]));
    expect(isometricPlan.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'character.enemy-melee.atlas',
        kind: 'actor',
        controller: 'enemy',
      }),
      expect.objectContaining({
        role: 'effect.player-attack',
        kind: 'effect',
        trigger: 'on-attack',
      }),
    ]));
    expect(layeredPlan.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'character.npc.atlas',
        kind: 'actor',
        controller: 'npc',
      }),
      expect.objectContaining({
        role: 'foreground.overlay',
        kind: 'depth-plane',
        render: expect.objectContaining({ layer: 'foreground' }),
      }),
      expect.objectContaining({
        role: 'lighting.ambient',
        kind: 'depth-plane',
        render: expect.objectContaining({ layer: 'lighting' }),
      }),
    ]));
  });

  it('reuses one reviewed role variant for multiple deterministic prop placements', async () => {
    const source = await fixture('topdown-farm');
    const plan = await deriveWorldVisualPlacementPlan(source);
    const trees = plan.placements.filter(({ role }) => role === 'prop.tree');
    const crops = plan.placements.filter(({ role }) => role === 'crop.basic.stage-1');

    expect(trees).toHaveLength(2);
    expect(crops).toHaveLength(2);
    expect(new Set(trees.map(({ variant_id: variantId }) => variantId))).toEqual(
      new Set(['canonical']),
    );
    expect(new Set(trees.map(({ placement_id: placementId }) => placementId)).size).toBe(2);
  });

  it('rejects requirements bound to another layout before deriving placements', async () => {
    const left = await fixture('topdown-farm', 'left');
    const right = await fixture('topdown-farm', 'right');
    const tampered = mutable(left.requirements);
    tampered.source.layout_plan_sha256 = right.requirements.source.layout_plan_sha256;

    await expect(deriveWorldVisualPlacementPlan({
      layout: left.layout,
      requirements: tampered,
    })).rejects.toMatchObject({
      code: 'world-visual-placement-derive.invalid-source',
    } satisfies Partial<DeriveWorldVisualPlacementPlanError>);
    await expect(deriveWorldVisualPlacementPlan({
      layout: left.layout,
      requirements: right.requirements,
    })).rejects.toMatchObject({
      code: 'world-visual-placement-derive.invalid-source',
    } satisfies Partial<DeriveWorldVisualPlacementPlanError>);
  });
});
