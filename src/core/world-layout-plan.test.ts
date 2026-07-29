import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import layoutSchema from '../../schemas/mapsoo-world-layout-plan-1.0.schema.json';
import { WORLD_ASSET_PROFILES, type WorldAssetProfile } from './asset-profile';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import {
  buildWorldLayoutPlanFromConfirmedIntake,
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  WorldLayoutPlanError,
} from './world-layout-plan';

const CHARACTER_HASH = 'a'.repeat(64);
const ENVIRONMENT_HASH = 'b'.repeat(64);
const IDENTITY_HASH = 'c'.repeat(64);
const PREVIEW_HASH = 'd'.repeat(64);
const BASE_FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'A courier reconnects neighborhoods separated by a seasonal river.',
  worldview: 'Promises shape safe routes, and restored crossings change how the community cooperates.',
  terrain: 'Low river terraces, orchards, reed wetlands, and one elevated stone ridge.',
  geography: 'A west ferry, central market island, eastern homes, and a hill gate form the route.',
  culture: 'River crafts, shared meals, painted ferry signs, and a lantern exchange define the settlement.',
  ecology: 'Willows, reeds, ducks, fireflies, orchard trees, and shallow seasonal flood pools.',
  mood: 'Hopeful morning exploration with gentle mystery and strong landmark readability.',
  art_direction: 'Hand-painted pixel art, warm landmarks, teal water, mist, and clean silhouettes.',
  traversal: 'Spawn at the old ferry, cross two routes, visit the market, then reach the hill gate.',
  landmarks: 'Old ferry, Lantern market, Waterwheel workshop, Hill gate',
});

function reference(role: 'environment-style' | 'character') {
  const stem = role === 'character' ? 'traveler' : 'harbor';
  return {
    id: `${stem}-reference`,
    role,
    path: `references/${stem}.png`,
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

async function intake(
  profile: WorldAssetProfile = 'topdown-farm',
  seed = `blue-harbor-${profile}-seed`,
  facts: ConfirmedWorldFacts = BASE_FACTS,
): Promise<ConfirmedWorldCreationIntake> {
  return createConfirmedWorldCreationIntake({
    intake_id: `blue-harbor-${profile}`,
    session_revision: 8,
    profile,
    target: 'raspberry-pi-4b',
    seed,
    facts,
    character_source: {
      reference_id: 'traveler-reference',
      identity_digest_sha256: IDENTITY_HASH,
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: PREVIEW_HASH,
  });
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

function structuralTopology(plan: Awaited<ReturnType<typeof buildWorldLayoutPlanFromConfirmedIntake>>) {
  const terrain = plan.terrain_layout.kind === 'bands'
    ? plan.terrain_layout.bands
    : plan.terrain_layout.zones;
  return {
    bounds: plan.bounds,
    regions: plan.regions,
    terrain,
    nodes: plan.traversal.nodes.map(({ id, kind, region_id }) => ({ id, kind, region_id })),
    edges: plan.traversal.edges,
    spawn_node_id: plan.spawn.node_id,
    exit_node_id: plan.exit.node_id,
    landmarks: plan.landmarks.map(({ id, region_id, node_id }) => ({ id, region_id, node_id })),
    collision_intent: plan.collision_intent,
    navigation_intent: plan.navigation_intent,
  };
}

function placement(plan: Awaited<ReturnType<typeof buildWorldLayoutPlanFromConfirmedIntake>>) {
  return {
    nodes: plan.traversal.nodes.map(({ id, x, y }) => ({ id, x, y })),
    spawn: plan.spawn,
    exit: plan.exit,
    landmarks: plan.landmarks.map(({ id, x, y }) => ({ id, x, y })),
  };
}

describe('WorldLayoutPlan 1.0', () => {
  it.each(WORLD_ASSET_PROFILES)(
    'deterministically builds and schema-validates the canonical %s plan',
    async (profile) => {
      const confirmed = await intake(profile);
      const first = await buildWorldLayoutPlanFromConfirmedIntake(confirmed);
      const second = await buildWorldLayoutPlanFromConfirmedIntake(confirmed);
      const validate = new Ajv2020({ strict: true, allErrors: true }).compile(layoutSchema);

      expect(validate(first), JSON.stringify(validate.errors)).toBe(true);
      expect(first).toEqual(second);
      expect(await fingerprintWorldLayoutPlan(first)).toBe(await fingerprintWorldLayoutPlan(second));
      expect(Object.isFrozen(first)).toBe(true);
      expect(first.document_type).toBe('world-layout-plan');
      expect(first.source.intake_id).toBe(confirmed.intake_id);
      expect(first.source.seed).toBe(confirmed.seed);
      expect(first.source.map_layout_checkpoint_sha256).toBe(
        confirmed.checkpoints.find(({ stage }) => stage === 'map-layout')?.snapshot_sha256,
      );
      expect(first.landmarks.map(({ label }) => label)).toEqual([
        'Old ferry',
        'Lantern market',
        'Waterwheel workshop',
        'Hill gate',
      ]);
      expect(first.navigation_intent.traversal_edge_ids).toEqual(
        first.traversal.edges.map(({ id }) => id),
      );
    },
  );

  it.each([
    ['side-platformer', 'bands', 'side-solids', 'platform-links'],
    ['topdown-farm', 'zones', 'topdown-obstacles', 'orthogonal-grid'],
    ['isometric-action', 'zones', 'isometric-footprints', 'diamond-grid'],
    ['layered-depth-2d', 'zones', 'depth-lane-blockers', 'depth-lanes'],
  ] as const)(
    'enforces the %s profile grammar',
    async (profile, terrainKind, collisionMode, navigationMode) => {
      const plan = await buildWorldLayoutPlanFromConfirmedIntake(await intake(profile));
      expect(plan.terrain_layout.kind).toBe(terrainKind);
      expect(plan.collision_intent.mode).toBe(collisionMode);
      expect(plan.navigation_intent.mode).toBe(navigationMode);
      expect(plan.traversal.nodes.filter(({ kind }) => kind === 'spawn')).toHaveLength(1);
      expect(plan.traversal.nodes.filter(({ kind }) => kind === 'exit')).toHaveLength(1);
      await expect(materializeWorldLayoutPlan(plan)).resolves.toEqual(plan);
    },
  );

  it.each(['side-platformer', 'isometric-action'] as const)(
    'materializes %s water as visible, blocked terrain with solid collision',
    async (profile) => {
      const plan = await buildWorldLayoutPlanFromConfirmedIntake(await intake(profile));
      const terrain = plan.terrain_layout.kind === 'bands'
        ? plan.terrain_layout.bands
        : plan.terrain_layout.zones;
      const water = terrain.filter(({ material }) => material === 'water');

      expect(water.length).toBeGreaterThan(0);
      expect(water.every(({ navigation }) => navigation === 'blocked')).toBe(true);
      expect(water.every(({ id }) => plan.collision_intent.solid_terrain_ids.includes(id))).toBe(true);
      expect(water.every(({ id }) => !plan.collision_intent.one_way_terrain_ids.includes(id))).toBe(true);
      expect(plan.traversal.nodes.every((node) => water.every((item) => (
        node.x < item.x
        || node.x >= item.x + item.width
        || node.y < item.y
        || node.y >= item.y + item.height
      )))).toBe(true);
    },
  );

  it('changes the bound plan and canonical fingerprint when the confirmed seed changes', async () => {
    const first = await buildWorldLayoutPlanFromConfirmedIntake(
      await intake('topdown-farm', 'seed-one'),
    );
    const second = await buildWorldLayoutPlanFromConfirmedIntake(
      await intake('topdown-farm', 'seed-two'),
    );

    expect(first.source.seed_sha256).not.toBe(second.source.seed_sha256);
    expect(first.source.intake_sha256).not.toBe(second.source.intake_sha256);
    expect(first.plan_id).not.toBe(second.plan_id);
    expect(first.traversal.nodes.map(({ x }) => x)).not.toEqual(
      second.traversal.nodes.map(({ x }) => x),
    );
    expect(structuralTopology(first)).toEqual(structuralTopology(second));
    expect(placement(first)).not.toEqual(placement(second));
    expect(await fingerprintWorldLayoutPlan(first)).not.toBe(
      await fingerprintWorldLayoutPlan(second),
    );
  });

  it.each(WORLD_ASSET_PROFILES)(
    'changes %s structural topology when confirmed route facts change',
    async (profile) => {
      const directFacts: ConfirmedWorldFacts = {
        ...BASE_FACTS,
        terrain: 'A flat dry meadow with orchards and stone paths.',
        geography: 'One direct route connects the west entrance to the east gate.',
        traversal: 'Follow one direct route through every landmark to the exit.',
      };
      const forkFacts: ConfirmedWorldFacts = {
        ...directFacts,
        geography: 'The route forks after the entrance and two routes rejoin before the east gate.',
        traversal: 'Choose either branch, pass the same landmarks, then rejoin before the exit.',
      };
      const direct = await buildWorldLayoutPlanFromConfirmedIntake(
        await intake(profile, 'shared-topology-seed', directFacts),
      );
      const fork = await buildWorldLayoutPlanFromConfirmedIntake(
        await intake(profile, 'shared-topology-seed', forkFacts),
      );

      expect(direct.source.seed_sha256).toBe(fork.source.seed_sha256);
      expect(direct.landmarks.map(({ label }) => label)).toEqual(
        fork.landmarks.map(({ label }) => label),
      );
      expect(structuralTopology(direct)).not.toEqual(structuralTopology(fork));
      expect(direct.traversal.nodes.some(({ id }) => id === 'node-route-branch')).toBe(false);
      expect(fork.traversal.nodes.some(({ id }) => id === 'node-route-branch')).toBe(true);
      expect(fork.traversal.edges.length).toBeGreaterThan(direct.traversal.edges.length);
    },
  );

  it.each(WORLD_ASSET_PROFILES)(
    'keeps %s topology and placement stable when only non-layout art facts change',
    async (profile) => {
      const first = await buildWorldLayoutPlanFromConfirmedIntake(
        await intake(profile, 'stable-non-layout-seed', BASE_FACTS),
      );
      const second = await buildWorldLayoutPlanFromConfirmedIntake(
        await intake(profile, 'stable-non-layout-seed', {
          ...BASE_FACTS,
          mood: 'A nocturnal, solemn atmosphere with restrained visual tension.',
          art_direction: 'Limited-color ink rendering with crisp silhouettes and moonlit accents.',
        }),
      );

      expect(first.plan_id).not.toBe(second.plan_id);
      expect(structuralTopology(first)).toEqual(structuralTopology(second));
      expect(placement(first)).toEqual(placement(second));
    },
  );

  it('changes only public labels when landmark wording changes without changing count', async () => {
    const first = await buildWorldLayoutPlanFromConfirmedIntake(
      await intake('topdown-farm', 'label-only-seed', BASE_FACTS),
    );
    const second = await buildWorldLayoutPlanFromConfirmedIntake(
      await intake('topdown-farm', 'label-only-seed', {
        ...BASE_FACTS,
        landmarks: 'West landing, Festival square, Mill workshop, Summit gate',
      }),
    );

    expect(first.landmarks.map(({ label }) => label)).not.toEqual(
      second.landmarks.map(({ label }) => label),
    );
    expect(structuralTopology(first)).toEqual(structuralTopology(second));
    expect(placement(first)).toEqual(placement(second));
  });

  it('rejects unknown fields and unsafe ids', async () => {
    const plan = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    plan.private_extension = 'not portable';
    await expect(materializeWorldLayoutPlan(plan)).rejects.toBeInstanceOf(WorldLayoutPlanError);

    delete plan.private_extension;
    plan.regions[0].id = '../unsafe';
    await expect(materializeWorldLayoutPlan(plan)).rejects.toMatchObject({
      code: 'layout.invalid-value',
    });
  });

  it('rejects rectangles and nodes outside logical bounds', async () => {
    const plan = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    plan.regions[0].width = plan.bounds.width + 1;
    await expect(materializeWorldLayoutPlan(plan)).rejects.toMatchObject({
      code: 'layout.invalid-value',
    });

    const nodeOutsideRegion = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    nodeOutsideRegion.traversal.nodes[0].x = 24;
    nodeOutsideRegion.spawn.x = 24;
    await expect(materializeWorldLayoutPlan(nodeOutsideRegion)).rejects.toMatchObject({
      code: 'layout.invalid-reference',
    });
  });

  it('rejects disconnected graphs even when every endpoint id exists', async () => {
    const plan = mutable(
      await buildWorldLayoutPlanFromConfirmedIntake(await intake('side-platformer')),
    );
    plan.traversal.edges[0] = {
      ...plan.traversal.edges[0],
      from: 'node-landmark-2',
      to: 'node-landmark-1',
      direction: 'forward',
    };
    await expect(materializeWorldLayoutPlan(plan)).rejects.toMatchObject({
      code: 'layout.disconnected',
    });
  });

  it('rejects dangling terrain, region, node, and edge references', async () => {
    const terrain = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    terrain.collision_intent.solid_terrain_ids = ['missing-terrain'];
    await expect(materializeWorldLayoutPlan(terrain)).rejects.toMatchObject({
      code: 'layout.invalid-reference',
    });

    const region = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    region.traversal.nodes[1].region_id = 'missing-region';
    await expect(materializeWorldLayoutPlan(region)).rejects.toMatchObject({
      code: 'layout.invalid-reference',
    });

    const edge = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    edge.navigation_intent.traversal_edge_ids[0] = 'missing-edge';
    await expect(materializeWorldLayoutPlan(edge)).rejects.toMatchObject({
      code: 'layout.invalid-reference',
    });
  });

  it('requires exact spawn, exit, and landmark bindings', async () => {
    const spawn = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    spawn.spawn.x += 1;
    await expect(materializeWorldLayoutPlan(spawn)).rejects.toMatchObject({
      code: 'layout.invalid-binding',
    });

    const exit = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    exit.exit.node_id = 'node-route-exit';
    await expect(materializeWorldLayoutPlan(exit)).rejects.toMatchObject({
      code: 'layout.invalid-binding',
    });

    const landmark = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    landmark.landmarks[0].node_id = landmark.landmarks[1].node_id;
    await expect(materializeWorldLayoutPlan(landmark)).rejects.toMatchObject({
      code: 'layout.invalid-binding',
    });
  });

  it('rejects a profile grammar borrowed from another profile', async () => {
    const plan = mutable(
      await buildWorldLayoutPlanFromConfirmedIntake(await intake('topdown-farm')),
    );
    plan.collision_intent.mode = 'isometric-footprints';
    await expect(materializeWorldLayoutPlan(plan)).rejects.toMatchObject({
      code: 'layout.invalid-value',
    });
  });

  it('binds the seed digest and confirmed intake identity', async () => {
    const confirmed = await intake();
    const plan = mutable(await buildWorldLayoutPlanFromConfirmedIntake(confirmed));
    plan.source.seed = 'tampered-seed';
    await expect(materializeWorldLayoutPlan(plan)).rejects.toMatchObject({
      code: 'layout.invalid-binding',
    });

    const validPlan = await buildWorldLayoutPlanFromConfirmedIntake(confirmed);
    const otherIntake = await intake('isometric-action');
    await expect(materializeWorldLayoutPlan(validPlan, otherIntake)).rejects.toMatchObject({
      code: 'layout.invalid-binding',
    });
  });

  it('rejects omitted graph coverage from navigation intent', async () => {
    const plan = mutable(await buildWorldLayoutPlanFromConfirmedIntake(await intake()));
    plan.navigation_intent.traversal_edge_ids.pop();
    await expect(materializeWorldLayoutPlan(plan)).rejects.toMatchObject({
      code: 'layout.invalid-binding',
    });
  });

  it('rejects one-way terrain semantics outside side-platformer', async () => {
    const plan = mutable(
      await buildWorldLayoutPlanFromConfirmedIntake(await intake('topdown-farm')),
    );
    plan.terrain_layout.zones[0].navigation = 'one-way';
    plan.collision_intent.one_way_terrain_ids = [plan.terrain_layout.zones[0].id];
    await expect(materializeWorldLayoutPlan(plan)).rejects.toMatchObject({
      code: 'layout.invalid-value',
    });
  });
});
