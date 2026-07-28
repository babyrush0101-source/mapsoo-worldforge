import type { WorldAssetProfile } from './asset-profile';
import type { WorldLayoutConstraints } from './world-layout-constraints';
import type {
  WorldLayoutPlan,
  WorldLayoutTerrain,
  WorldLayoutTraversalKind,
} from './world-layout-plan';

export const WORLD_LAYOUT_SOLVER_VERSION = '1.1.0' as const;

export interface WorldLayoutSolution {
  readonly bounds: WorldLayoutPlan['bounds'];
  readonly regions: WorldLayoutPlan['regions'];
  readonly terrain: readonly WorldLayoutTerrain[];
  readonly nodes: WorldLayoutPlan['traversal']['nodes'];
  readonly edges: WorldLayoutPlan['traversal']['edges'];
  readonly landmarks: WorldLayoutPlan['landmarks'];
  readonly collision: Readonly<{
    mode: WorldLayoutPlan['collision_intent']['mode'];
    solidTerrainIds: readonly string[];
    oneWayTerrainIds: readonly string[];
    blockedRegionIds: readonly string[];
  }>;
  readonly navigation: Readonly<{
    mode: WorldLayoutPlan['navigation_intent']['mode'];
    agentRadius: number;
  }>;
}

type Bounds = WorldLayoutPlan['bounds'];
type Node = WorldLayoutPlan['traversal']['nodes'][number];
type NodeRole = 'spawn' | 'landmark' | 'route-center' | 'route-exit' | 'exit' | 'branch';

interface ProfileGeometry {
  readonly terrain: readonly WorldLayoutTerrain[];
  readonly solidTerrainIds: readonly string[];
  readonly oneWayTerrainIds: readonly string[];
  readonly collisionMode: WorldLayoutPlan['collision_intent']['mode'];
  readonly navigationMode: WorldLayoutPlan['navigation_intent']['mode'];
  readonly agentRadius: number;
  readonly yFor: (role: NodeRole, index: number) => number;
  readonly edgeKind: (from: Node, to: Node) => WorldLayoutTraversalKind;
  readonly edgeDirection: (kind: WorldLayoutTraversalKind) => 'forward' | 'bidirectional';
}

interface GeometryInput {
  readonly constraints: WorldLayoutConstraints;
  readonly bounds: Bounds;
  readonly landmarkAnchors: readonly number[];
  readonly routeCenterX: number;
}

const WIDTH_BY_SCALE = Object.freeze({
  compact: 48,
  standard: 64,
  extended: 80,
} as const);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sidePlatformerGeometry(input: GeometryInput): ProfileGeometry {
  const { constraints, bounds, landmarkAnchors, routeCenterX } = input;
  const groundY = 28;
  const centerY = constraints.verticality === 'high'
    ? 24
    : constraints.verticality === 'medium'
      ? 26
      : 28;
  const firstWidth = Math.floor(bounds.width * 0.31);
  const centerWidth = Math.floor(bounds.width * 0.38);
  const exitX = firstWidth + centerWidth;
  const lift = constraints.verticality === 'high'
    ? 8
    : constraints.verticality === 'medium'
      ? 6
      : 3;
  const platforms: WorldLayoutTerrain[] = landmarkAnchors.map((anchor, index) => ({
    id: `platform-${index + 1}`,
    x: clamp(anchor - 3, 0, bounds.width - 6),
    y: clamp(groundY - lift + (index % 2 === 0 ? 0 : 2), 4, groundY - 2),
    width: 6,
    height: 2,
    material: constraints.settlement_density === 'dense' ? 'stone' : 'wood',
    navigation: 'one-way',
  }));
  if (constraints.route_shape === 'fork-rejoin') {
    platforms.push({
      id: 'platform-branch',
      x: clamp(routeCenterX - 4, 0, bounds.width - 8),
      y: clamp(groundY - lift - 2, 3, groundY - 3),
      width: 8,
      height: 2,
      material: 'wood',
      navigation: 'one-way',
    });
  }
  const terrain: WorldLayoutTerrain[] = [
    {
      id: 'ground-start',
      x: 0,
      y: groundY,
      width: firstWidth,
      height: bounds.height - groundY,
      material: 'ground',
      navigation: 'walkable',
    },
    {
      id: 'ground-center',
      x: firstWidth,
      y: centerY,
      width: centerWidth,
      height: bounds.height - centerY,
      material: 'ground',
      navigation: 'walkable',
    },
    {
      id: 'ground-exit',
      x: exitX,
      y: groundY,
      width: bounds.width - exitX,
      height: bounds.height - groundY,
      material: 'ground',
      navigation: 'walkable',
    },
    ...platforms,
  ];
  if (constraints.water !== 'none') {
    const waterWidth = constraints.water === 'crossing' ? 6 : 8;
    terrain.push({
      id: constraints.water === 'crossing' ? 'water-crossing' : 'water-basin',
      x: clamp(routeCenterX + 4, 0, bounds.width - waterWidth),
      y: centerY,
      width: waterWidth,
      height: bounds.height - centerY,
      material: 'water',
      navigation: 'blocked',
    });
  } else if (constraints.hazard_level === 'dangerous') {
    terrain.push({
      id: 'ground-hazard',
      x: clamp(routeCenterX - 2, 0, bounds.width - 4),
      y: bounds.height - 3,
      width: 4,
      height: 3,
      material: 'stone',
      navigation: 'blocked',
    });
  }
  const solidTerrainIds = terrain
    .filter(({ navigation }) => navigation !== 'one-way')
    .map(({ id }) => id);
  return {
    terrain,
    solidTerrainIds,
    oneWayTerrainIds: platforms.map(({ id }) => id),
    collisionMode: 'side-solids',
    navigationMode: 'platform-links',
    agentRadius: 0.45,
    yFor: (role, index) => {
      if (role === 'landmark') return platforms[index]!.y - 1;
      if (role === 'branch') {
        return platforms.find(({ id }) => id === 'platform-branch')!.y - 1;
      }
      if (role === 'route-center') return centerY - 1;
      return groundY - 1;
    },
    edgeKind: (from, to) => {
      if (to.y < from.y) return 'jump';
      if (to.y > from.y) return 'drop';
      return 'walk';
    },
    edgeDirection: (kind) => kind === 'walk' ? 'bidirectional' : 'forward',
  };
}

function topdownTerrain(input: GeometryInput): readonly WorldLayoutTerrain[] {
  const { constraints, bounds, routeCenterX } = input;
  const quarter = Math.floor(bounds.width / 4);
  const terrain: WorldLayoutTerrain[] = [
    {
      id: 'zone-start',
      x: 0,
      y: 0,
      width: quarter,
      height: bounds.height,
      material: 'meadow',
      navigation: 'walkable',
    },
    {
      id: 'zone-fields',
      x: quarter,
      y: 0,
      width: quarter,
      height: bounds.height,
      material: 'farmland',
      navigation: 'walkable',
    },
    {
      id: 'zone-settlement',
      x: quarter * 2,
      y: 0,
      width: quarter,
      height: bounds.height,
      material: 'stone-path',
      navigation: 'walkable',
    },
    {
      id: 'zone-exit',
      x: quarter * 3,
      y: 0,
      width: bounds.width - quarter * 3,
      height: bounds.height,
      material: 'grass',
      navigation: 'walkable',
    },
  ];
  if (constraints.water === 'crossing') {
    terrain.push(
      {
        id: 'zone-river-north',
        x: clamp(routeCenterX - 2, 0, bounds.width - 4),
        y: 0,
        width: 4,
        height: 13,
        material: 'water',
        navigation: 'blocked',
      },
      {
        id: 'zone-river-south',
        x: clamp(routeCenterX - 2, 0, bounds.width - 4),
        y: 21,
        width: 4,
        height: bounds.height - 21,
        material: 'water',
        navigation: 'blocked',
      },
    );
  } else {
    terrain.push({
      id: 'zone-obstacle',
      x: clamp(routeCenterX - 2, 0, bounds.width - 4),
      y: 14,
      width: 4,
      height: constraints.water === 'basin' ? 6 : 4,
      material: constraints.water === 'basin' ? 'water' : 'stone-path',
      navigation: 'blocked',
    });
  }
  if (constraints.hazard_level === 'dangerous') {
    terrain.push({
      id: 'zone-hazard',
      x: clamp(Math.floor(bounds.width * 0.7), 0, bounds.width - 3),
      y: 6,
      width: 3,
      height: 4,
      material: 'stone-path',
      navigation: 'blocked',
    });
  }
  return terrain;
}

function topdownFarmGeometry(input: GeometryInput): ProfileGeometry {
  const { constraints } = input;
  const terrain = topdownTerrain(input);
  const amplitude = constraints.verticality === 'high'
    ? 8
    : constraints.verticality === 'medium'
      ? 5
      : 2;
  return {
    terrain,
    solidTerrainIds: terrain.filter(({ navigation }) => navigation === 'blocked').map(({ id }) => id),
    oneWayTerrainIds: [],
    collisionMode: 'topdown-obstacles',
    navigationMode: 'orthogonal-grid',
    agentRadius: 0.5,
    yFor: (role, index) => {
      if (role === 'spawn' || role === 'exit') return 28;
      if (role === 'route-center') return 17;
      if (role === 'route-exit') return 24;
      if (role === 'branch') return 8;
      return 22 - (index % 2 === 0 ? amplitude : -Math.floor(amplitude / 2));
    },
    edgeKind: () => 'walk',
    edgeDirection: () => 'bidirectional',
  };
}

function isometricActionGeometry(input: GeometryInput): ProfileGeometry {
  const { constraints, bounds, routeCenterX } = input;
  const half = Math.floor(bounds.width / 2);
  const terrain: WorldLayoutTerrain[] = [
    {
      id: 'zone-approach',
      x: 0,
      y: 0,
      width: half,
      height: Math.floor(bounds.height / 2),
      material: 'stone',
      navigation: 'walkable',
    },
    {
      id: 'zone-arena-west',
      x: 0,
      y: Math.floor(bounds.height / 2),
      width: half,
      height: bounds.height - Math.floor(bounds.height / 2),
      material: 'arena',
      navigation: 'walkable',
    },
    {
      id: 'zone-arena-east',
      x: half,
      y: 0,
      width: bounds.width - half,
      height: Math.floor(bounds.height / 2),
      material: 'arena',
      navigation: 'walkable',
    },
    {
      id: 'zone-gate',
      x: half,
      y: Math.floor(bounds.height / 2),
      width: bounds.width - half,
      height: bounds.height - Math.floor(bounds.height / 2),
      material: 'stone',
      navigation: 'walkable',
    },
    {
      id: 'zone-footprint',
      x: clamp(routeCenterX - 2, 0, bounds.width - 4),
      y: 14,
      width: 4,
      height: constraints.verticality === 'high' ? 6 : 4,
      material: 'pillar',
      navigation: 'blocked',
    },
  ];
  if (constraints.route_shape === 'fork-rejoin' || constraints.hazard_level === 'dangerous') {
    terrain.push({
      id: 'zone-footprint-east',
      x: clamp(Math.floor(bounds.width * 0.68), 0, bounds.width - 3),
      y: 22,
      width: 3,
      height: 4,
      material: 'pillar',
      navigation: 'blocked',
    });
  }
  if (constraints.water === 'crossing') {
    const waterX = clamp(routeCenterX - 2, 0, bounds.width - 4);
    terrain.push(
      {
        id: 'zone-water-north',
        x: waterX,
        y: 0,
        width: 4,
        height: 10,
        material: 'water',
        navigation: 'blocked',
      },
      {
        id: 'zone-water-south',
        x: waterX,
        y: 30,
        width: 4,
        height: bounds.height - 30,
        material: 'water',
        navigation: 'blocked',
      },
    );
  } else if (constraints.water === 'basin') {
    terrain.push({
      id: 'zone-water-basin',
      x: clamp(routeCenterX - 4, 0, bounds.width - 8),
      y: 4,
      width: 8,
      height: 6,
      material: 'water',
      navigation: 'blocked',
    });
  }
  const amplitude = constraints.verticality === 'high'
    ? 8
    : constraints.verticality === 'medium'
      ? 5
      : 2;
  return {
    terrain,
    solidTerrainIds: terrain.filter(({ navigation }) => navigation === 'blocked').map(({ id }) => id),
    oneWayTerrainIds: [],
    collisionMode: 'isometric-footprints',
    navigationMode: 'diamond-grid',
    agentRadius: constraints.hazard_level === 'dangerous' ? 0.8 : 0.7,
    yFor: (role, index) => {
      if (role === 'spawn') return 28;
      if (role === 'exit') return 8;
      if (role === 'route-center') return 18;
      if (role === 'route-exit') return 12;
      if (role === 'branch') return 28;
      return 24 - (index % 2 === 0 ? amplitude : 0);
    },
    edgeKind: () => 'walk',
    edgeDirection: () => 'bidirectional',
  };
}

function layeredDepthGeometry(input: GeometryInput): ProfileGeometry {
  const { constraints, bounds, routeCenterX } = input;
  const laneHeight = Math.floor(bounds.height / 3);
  const terrain: WorldLayoutTerrain[] = [
    {
      id: 'zone-back-lane',
      x: 0,
      y: 0,
      width: bounds.width,
      height: laneHeight,
      material: 'back-lane',
      navigation: 'walkable',
    },
    {
      id: 'zone-middle-west',
      x: 0,
      y: laneHeight,
      width: Math.floor(bounds.width / 2),
      height: laneHeight,
      material: 'middle-lane',
      navigation: 'walkable',
    },
    {
      id: 'zone-middle-east',
      x: Math.floor(bounds.width / 2),
      y: laneHeight,
      width: bounds.width - Math.floor(bounds.width / 2),
      height: laneHeight,
      material: 'middle-lane',
      navigation: 'walkable',
    },
    {
      id: 'zone-front-lane',
      x: 0,
      y: laneHeight * 2,
      width: bounds.width,
      height: bounds.height - laneHeight * 2,
      material: 'front-lane',
      navigation: 'walkable',
    },
    {
      id: 'zone-occluder',
      x: clamp(routeCenterX - 2, 0, bounds.width - 4),
      y: laneHeight + 6,
      width: 4,
      height: constraints.verticality === 'high' ? 9 : 7,
      material: 'occluder',
      navigation: 'blocked',
    },
  ];
  if (constraints.route_shape === 'fork-rejoin' || constraints.hazard_level === 'dangerous') {
    terrain.push({
      id: 'zone-occluder-east',
      x: clamp(Math.floor(bounds.width * 0.7), 0, bounds.width - 3),
      y: 7,
      width: 3,
      height: 8,
      material: 'occluder',
      navigation: 'blocked',
    });
  }
  return {
    terrain,
    solidTerrainIds: terrain.filter(({ navigation }) => navigation === 'blocked').map(({ id }) => id),
    oneWayTerrainIds: [],
    collisionMode: 'depth-lane-blockers',
    navigationMode: 'depth-lanes',
    agentRadius: 0.5,
    yFor: (role, index) => {
      if (role === 'spawn' || role === 'exit') return 30;
      if (role === 'route-center') return 18;
      if (role === 'route-exit') return 24;
      if (role === 'branch') return 7;
      return index % 3 === 0 ? 29 : index % 3 === 1 ? 18 : 7;
    },
    edgeKind: () => 'walk',
    edgeDirection: () => 'bidirectional',
  };
}

const PROFILE_GEOMETRY = Object.freeze({
  'side-platformer': sidePlatformerGeometry,
  'topdown-farm': topdownFarmGeometry,
  'isometric-action': isometricActionGeometry,
  'layered-depth-2d': layeredDepthGeometry,
} satisfies Readonly<Record<
  WorldAssetProfile,
  (input: GeometryInput) => ProfileGeometry
>>);

function landmarkAnchors(bounds: Bounds, count: number): readonly number[] {
  const start = 12;
  const end = bounds.width - 18;
  if (count === 1) return [Math.floor((start + end) / 2)];
  return Object.freeze(Array.from({ length: count }, (_, index) => (
    Math.round(start + (index * (end - start)) / (count - 1))
  )));
}

function seededNodeX(
  node: Node,
  region: WorldLayoutPlan['regions'][number],
  seedSha256: string,
  index: number,
): number {
  if (node.kind === 'spawn' || node.kind === 'exit') return node.x;
  const offset = (Number.parseInt(seedSha256.slice(index * 2, index * 2 + 2), 16) % 5) - 2;
  return clamp(node.x + offset, region.x, region.x + region.width - 1);
}

export function solveWorldLayoutConstraints(
  constraints: WorldLayoutConstraints,
  seedSha256: string,
): WorldLayoutSolution {
  const bounds: Bounds = Object.freeze({
    width: WIDTH_BY_SCALE[constraints.scale],
    height: 36,
    unit: 'logical-tile',
  });
  const anchors = landmarkAnchors(bounds, constraints.landmark_labels.length);
  const routeCenterX = Math.floor(bounds.width / 2);
  const routeExitX = bounds.width - 10;
  const geometry = PROFILE_GEOMETRY[constraints.profile]({
    constraints,
    bounds,
    landmarkAnchors: anchors,
    routeCenterX,
  });
  const landmarkRegions = anchors.map((anchor, index) => Object.freeze({
    id: `region-landmark-${index + 1}`,
    x: clamp(anchor - 4, 0, bounds.width - 9),
    y: 0,
    width: 9,
    height: bounds.height,
    purpose: 'landmark' as const,
  }));
  const regions: WorldLayoutPlan['regions'][number][] = [
    Object.freeze({
      id: 'region-start',
      x: 0,
      y: 0,
      width: 10,
      height: bounds.height,
      purpose: 'spawn' as const,
    }),
    ...landmarkRegions,
    Object.freeze({
      id: 'region-center',
      x: clamp(routeCenterX - 5, 0, bounds.width - 11),
      y: 0,
      width: 11,
      height: bounds.height,
      purpose: 'route' as const,
    }),
    Object.freeze({
      id: 'region-exit',
      x: bounds.width - 14,
      y: 0,
      width: 14,
      height: bounds.height,
      purpose: 'exit' as const,
    }),
  ];
  if (constraints.route_shape === 'fork-rejoin') {
    regions.push(Object.freeze({
      id: 'region-route-branch',
      x: clamp(routeCenterX - 6, 0, bounds.width - 13),
      y: 0,
      width: 13,
      height: bounds.height,
      purpose: 'route' as const,
    }));
  }

  const landmarkNodes: Node[] = anchors.map((anchor, index) => Object.freeze({
    id: `node-landmark-${index + 1}`,
    kind: 'landmark' as const,
    region_id: `region-landmark-${index + 1}`,
    x: anchor,
    y: geometry.yFor('landmark', index),
  }));
  const middleNodes: Node[] = [
    ...landmarkNodes,
    Object.freeze({
      id: 'node-route-center',
      kind: 'route' as const,
      region_id: 'region-center',
      x: routeCenterX,
      y: geometry.yFor('route-center', 0),
    }),
  ].sort((left, right) => left.x - right.x || left.id.localeCompare(right.id));
  const baseNodes: Node[] = [
    Object.freeze({
      id: 'node-spawn',
      kind: 'spawn' as const,
      region_id: 'region-start',
      x: 4,
      y: geometry.yFor('spawn', 0),
    }),
    ...middleNodes,
    Object.freeze({
      id: 'node-route-exit',
      kind: 'route' as const,
      region_id: 'region-exit',
      x: routeExitX,
      y: geometry.yFor('route-exit', 0),
    }),
    Object.freeze({
      id: 'node-exit',
      kind: 'exit' as const,
      region_id: 'region-exit',
      x: bounds.width - 4,
      y: geometry.yFor('exit', 0),
    }),
  ];
  if (constraints.route_shape === 'fork-rejoin') {
    baseNodes.push(Object.freeze({
      id: 'node-route-branch',
      kind: 'route' as const,
      region_id: 'region-route-branch',
      x: routeCenterX,
      y: geometry.yFor('branch', 0),
    }));
  }
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const nodes = Object.freeze(baseNodes.map((node, index) => {
    const region = regionById.get(node.region_id)!;
    return Object.freeze({
      ...node,
      x: seededNodeX(node, region, seedSha256, index),
    });
  }));
  const pathNodes = nodes.filter(({ id }) => id !== 'node-route-branch');
  const edges: WorldLayoutPlan['traversal']['edges'][number][] = [];
  for (let index = 0; index < pathNodes.length - 1; index += 1) {
    const from = pathNodes[index]!;
    const to = pathNodes[index + 1]!;
    const kind = geometry.edgeKind(from, to);
    edges.push(Object.freeze({
      id: `edge-${index + 1}`,
      from: from.id,
      to: to.id,
      kind,
      direction: geometry.edgeDirection(kind),
    }));
  }
  if (constraints.route_shape === 'fork-rejoin') {
    const branch = nodes.find(({ id }) => id === 'node-route-branch')!;
    const fork = nodes.find(({ id }) => id === 'node-landmark-1')!;
    const join = nodes.find(({ id }) => (
      id === `node-landmark-${constraints.landmark_labels.length}`
    ))!;
    const intoBranch = geometry.edgeKind(fork, branch);
    const outOfBranch = geometry.edgeKind(branch, join);
    edges.push(
      Object.freeze({
        id: 'edge-branch-in',
        from: fork.id,
        to: branch.id,
        kind: intoBranch,
        direction: geometry.edgeDirection(intoBranch),
      }),
      Object.freeze({
        id: 'edge-branch-out',
        from: branch.id,
        to: join.id,
        kind: outOfBranch,
        direction: geometry.edgeDirection(outOfBranch),
      }),
    );
  } else if (constraints.route_shape === 'loop') {
    const first = nodes.find(({ id }) => id === 'node-landmark-1')!;
    const last = nodes.find(({ id }) => (
      id === `node-landmark-${constraints.landmark_labels.length}`
    ))!;
    const kind = geometry.edgeKind(last, first);
    edges.push(Object.freeze({
      id: 'edge-loop',
      from: last.id,
      to: first.id,
      kind,
      direction: geometry.edgeDirection(kind),
    }));
  }
  const landmarks = Object.freeze(constraints.landmark_labels.map((label, index) => {
    const node = nodes.find(({ id }) => id === `node-landmark-${index + 1}`)!;
    return Object.freeze({
      id: `landmark-${index + 1}`,
      label,
      region_id: node.region_id,
      node_id: node.id,
      x: node.x,
      y: node.y,
    });
  }));
  return Object.freeze({
    bounds,
    regions: Object.freeze(regions),
    terrain: Object.freeze(geometry.terrain),
    nodes,
    edges: Object.freeze(edges),
    landmarks,
    collision: Object.freeze({
      mode: geometry.collisionMode,
      solidTerrainIds: Object.freeze(geometry.solidTerrainIds),
      oneWayTerrainIds: Object.freeze(geometry.oneWayTerrainIds),
      blockedRegionIds: Object.freeze([]),
    }),
    navigation: Object.freeze({
      mode: geometry.navigationMode,
      agentRadius: geometry.agentRadius,
    }),
  });
}
