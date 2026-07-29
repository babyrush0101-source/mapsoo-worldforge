import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import placementSchema from '../../schemas/mapsoo-world-visual-placement-plan-1.0.schema.json';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from './confirmed-world-creation-intake';
import {
  buildWorldLayoutPlanFromConfirmedIntake,
  fingerprintWorldLayoutPlan,
  type WorldLayoutPlan,
} from './world-layout-plan';
import {
  buildWorldVisualPlacementPlan,
  fingerprintWorldVisualPlacementPlan,
  materializeWorldVisualPlacementPlan,
  serializeCanonicalWorldVisualPlacementPlan,
  WorldVisualPlacementPlanError,
  type WorldVisualPlacement,
} from './world-visual-placement-plan';

async function intake(): Promise<ConfirmedWorldCreationIntake> {
  return createConfirmedWorldCreationIntake({
    intake_id: 'visual-placement-world',
    session_revision: 8,
    profile: 'topdown-farm',
    target: 'raspberry-pi-4b',
    seed: 'visual-placement-world-seed',
    facts: {
      premise: 'A courier reconnects a settlement after the seasonal river changes course.',
      worldview: 'Restored crossings change how neighboring communities cooperate.',
      terrain: 'River terraces, orchards, wetlands, stone ridges, and readable paths.',
      geography: 'A ferry, market, workshop, homes, and a hill gate define the route.',
      culture: 'River crafts, painted signs, shared meals, and lantern exchanges shape local life.',
      ecology: 'Willows, reeds, ducks, fireflies, orchard trees, and shallow flood pools.',
      mood: 'Hopeful exploration with gentle mystery and clear readable landmarks.',
      art_direction: 'Original pixel art with restrained colors and strong silhouettes.',
      traversal: 'Start at the ferry, visit the market, cross the center, and reach the gate.',
      landmarks: 'Old ferry, Lantern market, Waterwheel workshop, Hill gate',
    },
    character_source: {
      reference_id: 'traveler-reference',
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
        id: 'traveler-reference',
        role: 'character',
        path: 'references/traveler.png',
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
}

async function layout(): Promise<WorldLayoutPlan> {
  return buildWorldLayoutPlanFromConfirmedIntake(await intake());
}

function draftPlacements(plan: WorldLayoutPlan): readonly WorldVisualPlacement[] {
  return [
    {
      placement_id: 'ambient-fireflies',
      kind: 'effect',
      role: 'effect.ambient',
      anchor: { kind: 'region', ref_id: plan.regions[1]!.id },
      render: { layer: 'effects', order: 10, y_sort: true },
      trigger: 'always',
    },
    {
      placement_id: 'player',
      kind: 'actor',
      role: 'character.player.atlas',
      variant_id: 'canonical',
      anchor: { kind: 'spawn' },
      render: { layer: 'actors', order: 0, y_sort: true },
      controller: 'player',
    },
    {
      placement_id: 'market-tree',
      kind: 'sprite',
      role: 'prop.tree',
      anchor: { kind: 'landmark', ref_id: plan.landmarks[1]!.id },
      render: { layer: 'world', order: 20, y_sort: true },
    },
    {
      placement_id: 'sky',
      kind: 'depth-plane',
      role: 'background.sky',
      anchor: {
        kind: 'logical-rect',
        x: 0,
        y: 0,
        width: plan.bounds.width,
        height: plan.bounds.height,
      },
      render: {
        layer: 'background',
        order: -100,
        parallax: { x: 0.25, y: 0.1 },
        repeat: { x: true, y: false },
      },
    },
  ] as const;
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('WorldVisualPlacementPlan 1.0', () => {
  it('builds deterministic source-bound canonical placements and validates the schema', async () => {
    const boundLayout = await layout();
    const first = await buildWorldVisualPlacementPlan(
      boundLayout,
      draftPlacements(boundLayout),
    );
    const second = await buildWorldVisualPlacementPlan(
      boundLayout,
      [...draftPlacements(boundLayout)].reverse(),
    );
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(placementSchema);

    expect(validate(first), JSON.stringify(validate.errors)).toBe(true);
    expect(first).toEqual(second);
    expect(first.profile).toBe(boundLayout.profile);
    expect(first.bounds).toEqual(boundLayout.bounds);
    expect(first.source).toEqual({
      layout_plan_id: boundLayout.plan_id,
      layout_plan_path: 'world-layout-plan.json',
      layout_plan_sha256: await fingerprintWorldLayoutPlan(boundLayout),
    });
    expect(first.placements.map(({ placement_id: placementId }) => placementId)).toEqual([
      'sky',
      'market-tree',
      'player',
      'ambient-fireflies',
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.placements)).toBe(true);
    expect(Object.isFrozen(first.placements[0]!.anchor)).toBe(true);
  });

  it('serializes exact canonical bytes and fingerprints the materialized plan', async () => {
    const boundLayout = await layout();
    const plan = await buildWorldVisualPlacementPlan(
      boundLayout,
      draftPlacements(boundLayout),
    );
    const first = await serializeCanonicalWorldVisualPlacementPlan(plan, boundLayout);
    const second = await serializeCanonicalWorldVisualPlacementPlan(plan, boundLayout);

    expect(first).toEqual(second);
    expect(first.at(-1)).toBe(10);
    expect(new TextDecoder().decode(first)).not.toContain('\r\n');
    expect(await fingerprintWorldVisualPlacementPlan(plan, boundLayout)).toMatch(
      /^[a-f0-9]{64}$/,
    );
    await expect(materializeWorldVisualPlacementPlan(plan, boundLayout)).resolves.toEqual(plan);
  });

  it('accepts every bounded anchor grammar and resolves all layout references', async () => {
    const boundLayout = await layout();
    const nodeId = boundLayout.traversal.nodes.find(({ kind }) => kind === 'route')!.id;
    const placements: readonly WorldVisualPlacement[] = [
      {
        placement_id: 'point-sprite',
        kind: 'sprite',
        role: 'prop.rock',
        anchor: { kind: 'logical-point', x: 1, y: 1 },
        render: { layer: 'world', order: 1, y_sort: true },
      },
      {
        placement_id: 'landmark-sprite',
        kind: 'sprite',
        role: 'structure.landmark',
        anchor: { kind: 'landmark', ref_id: boundLayout.landmarks[0]!.id },
        render: { layer: 'world', order: 2, y_sort: true },
      },
      {
        placement_id: 'traversal-sprite',
        kind: 'sprite',
        role: 'collectible.primary',
        anchor: { kind: 'traversal', ref_id: nodeId },
        render: { layer: 'world', order: 3, y_sort: true },
      },
      {
        placement_id: 'spawn-actor',
        kind: 'actor',
        role: 'character.player.atlas',
        anchor: { kind: 'spawn' },
        render: { layer: 'actors', order: 1, y_sort: true },
        controller: 'player',
      },
      {
        placement_id: 'exit-actor',
        kind: 'actor',
        role: 'character.npc.atlas',
        anchor: { kind: 'exit' },
        render: { layer: 'actors', order: 2, y_sort: true },
        controller: 'npc',
      },
      {
        placement_id: 'rect-effect',
        kind: 'effect',
        role: 'effect.portal',
        anchor: { kind: 'logical-rect', x: 0, y: 0, width: 2, height: 2 },
        render: { layer: 'effects', order: 1, y_sort: false },
        trigger: 'on-enter',
      },
      {
        placement_id: 'region-plane',
        kind: 'depth-plane',
        role: 'background.far',
        anchor: { kind: 'region', ref_id: boundLayout.regions[0]!.id },
        render: {
          layer: 'background',
          order: 1,
          parallax: { x: 0.5, y: 0.5 },
          repeat: { x: false, y: false },
        },
      },
    ];

    const plan = await buildWorldVisualPlacementPlan(boundLayout, placements);
    expect(new Set(plan.placements.map(({ anchor }) => anchor.kind))).toEqual(new Set([
      'logical-point',
      'logical-rect',
      'landmark',
      'traversal',
      'spawn',
      'exit',
      'region',
    ]));
  });

  it('rejects extensions, unsafe ids and roles, unsafe paths, and invalid hashes', async () => {
    const boundLayout = await layout();
    const plan = await buildWorldVisualPlacementPlan(
      boundLayout,
      draftPlacements(boundLayout),
    );

    const extension = mutable(plan);
    extension.private_consumer = 'not-portable';
    await expect(materializeWorldVisualPlacementPlan(extension, boundLayout)).rejects
      .toBeInstanceOf(WorldVisualPlacementPlanError);

    const unsafeId = mutable(plan);
    unsafeId.placements[0].placement_id = '../sky';
    await expect(materializeWorldVisualPlacementPlan(unsafeId, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-value' });

    const unsafeRole = mutable(plan);
    unsafeRole.placements[0].role = '../background.png';
    await expect(materializeWorldVisualPlacementPlan(unsafeRole, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-value' });

    const unsafePath = mutable(plan);
    unsafePath.source.layout_plan_path = '../world-layout-plan.json';
    await expect(materializeWorldVisualPlacementPlan(unsafePath, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-path' });

    const invalidHash = mutable(plan);
    invalidHash.source.layout_plan_sha256 = 'A'.repeat(64);
    await expect(materializeWorldVisualPlacementPlan(invalidHash, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-value' });
  });

  it('rejects a different layout, profile, bounds, source identity, and derived plan id', async () => {
    const boundLayout = await layout();
    const plan = await buildWorldVisualPlacementPlan(
      boundLayout,
      draftPlacements(boundLayout),
    );

    const wrongProfile = mutable(plan);
    wrongProfile.profile = 'isometric-action';
    await expect(materializeWorldVisualPlacementPlan(wrongProfile, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-binding' });

    const wrongBounds = mutable(plan);
    wrongBounds.bounds.width -= 1;
    await expect(materializeWorldVisualPlacementPlan(wrongBounds, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-binding' });

    const wrongSource = mutable(plan);
    wrongSource.source.layout_plan_id = 'another-layout';
    await expect(materializeWorldVisualPlacementPlan(wrongSource, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-binding' });

    const wrongPlanId = mutable(plan);
    wrongPlanId.plan_id = `world-visual-placement-plan-${'0'.repeat(16)}`;
    await expect(materializeWorldVisualPlacementPlan(wrongPlanId, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-binding' });

    const otherLayout = mutable(boundLayout);
    otherLayout.plan_id = 'different-layout';
    await expect(materializeWorldVisualPlacementPlan(plan, otherLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-binding' });
  });

  it('rejects out-of-bounds coordinates and dangling references', async () => {
    const boundLayout = await layout();

    await expect(buildWorldVisualPlacementPlan(boundLayout, [{
      placement_id: 'outside-point',
      kind: 'sprite',
      role: 'prop.tree',
      anchor: { kind: 'logical-point', x: boundLayout.bounds.width, y: 0 },
      render: { layer: 'world', order: 0, y_sort: true },
    }])).rejects.toMatchObject({
      code: 'world-visual-placement-plan.invalid-value',
    });

    await expect(buildWorldVisualPlacementPlan(boundLayout, [{
      placement_id: 'outside-rect',
      kind: 'depth-plane',
      role: 'background.sky',
      anchor: {
        kind: 'logical-rect',
        x: boundLayout.bounds.width - 1,
        y: 0,
        width: 2,
        height: 1,
      },
      render: {
        layer: 'background',
        order: 0,
        parallax: { x: 1, y: 1 },
        repeat: { x: false, y: false },
      },
    }])).rejects.toMatchObject({
      code: 'world-visual-placement-plan.invalid-bounds',
    });

    await expect(buildWorldVisualPlacementPlan(boundLayout, [{
      placement_id: 'missing-landmark',
      kind: 'sprite',
      role: 'structure.landmark',
      anchor: { kind: 'landmark', ref_id: 'missing-landmark' },
      render: { layer: 'world', order: 0, y_sort: true },
    }])).rejects.toMatchObject({
      code: 'world-visual-placement-plan.invalid-reference',
    });
  });

  it('rejects duplicate ids and non-canonical materialized order', async () => {
    const boundLayout = await layout();
    const plan = await buildWorldVisualPlacementPlan(
      boundLayout,
      draftPlacements(boundLayout),
    );

    const duplicate = mutable(plan);
    duplicate.placements[1].placement_id = duplicate.placements[0].placement_id;
    await expect(materializeWorldVisualPlacementPlan(duplicate, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.duplicate' });

    const unsorted = mutable(plan);
    unsorted.placements.reverse();
    await expect(materializeWorldVisualPlacementPlan(unsorted, boundLayout)).rejects
      .toMatchObject({ code: 'world-visual-placement-plan.invalid-order' });
  });

  it('rejects kind-incompatible anchors, layers, render shapes, controllers, and triggers', async () => {
    const boundLayout = await layout();
    const cases: readonly unknown[][] = [
      [{
        placement_id: 'bad-plane-anchor',
        kind: 'depth-plane',
        role: 'background.sky',
        anchor: { kind: 'spawn' },
        render: {
          layer: 'background',
          order: 0,
          parallax: { x: 1, y: 1 },
          repeat: { x: false, y: false },
        },
      }],
      [{
        placement_id: 'bad-actor-layer',
        kind: 'actor',
        role: 'character.player.atlas',
        anchor: { kind: 'spawn' },
        render: { layer: 'world', order: 0, y_sort: true },
        controller: 'player',
      }],
      [{
        placement_id: 'bad-controller',
        kind: 'actor',
        role: 'character.player.atlas',
        anchor: { kind: 'spawn' },
        render: { layer: 'actors', order: 0, y_sort: true },
        controller: 'arbitrary-script',
      }],
      [{
        placement_id: 'bad-trigger',
        kind: 'effect',
        role: 'effect.portal',
        anchor: { kind: 'exit' },
        render: { layer: 'effects', order: 0, y_sort: true },
        trigger: 'execute-code',
      }],
      [{
        placement_id: 'bad-parallax',
        kind: 'depth-plane',
        role: 'background.sky',
        anchor: { kind: 'region', ref_id: boundLayout.regions[0]!.id },
        render: {
          layer: 'background',
          order: 0,
          parallax: { x: 5, y: 1 },
          repeat: { x: false, y: false },
        },
      }],
      [{
        placement_id: 'bad-render-extension',
        kind: 'sprite',
        role: 'prop.tree',
        anchor: { kind: 'logical-point', x: 0, y: 0 },
        render: { layer: 'world', order: 0, y_sort: true, executable: true },
      }],
    ];

    for (const placements of cases) {
      await expect(buildWorldVisualPlacementPlan(boundLayout, placements)).rejects
        .toBeInstanceOf(WorldVisualPlacementPlanError);
    }
  });
});
