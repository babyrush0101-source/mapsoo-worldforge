import { isWorldAssetProfile, type WorldAssetProfile } from './asset-profile';
import {
  fingerprintConfirmedWorldCreationIntake,
  materializeConfirmedWorldCreationIntake,
} from './confirmed-world-creation-intake';
import {
  deriveWorldLayoutConstraintsFromConfirmedIntake,
  materializeWorldLayoutConstraints,
  type WorldLayoutConstraints,
} from './world-layout-constraints';
import {
  solveWorldLayoutConstraints,
  WORLD_LAYOUT_SOLVER_VERSION,
} from './world-layout-solver';

export const WORLD_LAYOUT_PLAN_VERSION = '1.0.0' as const;
export const WORLD_LAYOUT_PLAN_STATUS = 'planned' as const;

export type WorldLayoutTerrain = Readonly<{
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  material: string;
  navigation: 'walkable' | 'blocked' | 'one-way';
}>;

export type WorldLayoutTerrainLayout =
  | Readonly<{ kind: 'bands'; bands: readonly WorldLayoutTerrain[] }>
  | Readonly<{ kind: 'zones'; zones: readonly WorldLayoutTerrain[] }>;

export type WorldLayoutNodeKind = 'spawn' | 'route' | 'landmark' | 'exit';
export type WorldLayoutTraversalKind = 'walk' | 'jump' | 'drop' | 'climb' | 'portal';

export interface WorldLayoutPlan {
  readonly schema_version: typeof WORLD_LAYOUT_PLAN_VERSION;
  readonly document_type: 'world-layout-plan';
  readonly status: typeof WORLD_LAYOUT_PLAN_STATUS;
  readonly plan_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    intake_id: string;
    session_revision: number;
    intake_sha256: string;
    map_layout_checkpoint_sha256: string;
    seed: string;
    seed_sha256: string;
  }>;
  readonly bounds: Readonly<{
    width: number;
    height: number;
    unit: 'logical-tile';
  }>;
  readonly regions: readonly Readonly<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    purpose: 'spawn' | 'route' | 'landmark' | 'exit';
  }>[];
  readonly terrain_layout: WorldLayoutTerrainLayout;
  readonly spawn: Readonly<{ node_id: string; x: number; y: number }>;
  readonly exit: Readonly<{ node_id: string; x: number; y: number }>;
  readonly traversal: Readonly<{
    nodes: readonly Readonly<{
      id: string;
      kind: WorldLayoutNodeKind;
      region_id: string;
      x: number;
      y: number;
    }>[];
    edges: readonly Readonly<{
      id: string;
      from: string;
      to: string;
      kind: WorldLayoutTraversalKind;
      direction: 'forward' | 'bidirectional';
    }>[];
  }>;
  readonly landmarks: readonly Readonly<{
    id: string;
    label: string;
    region_id: string;
    node_id: string;
    x: number;
    y: number;
  }>[];
  readonly collision_intent: Readonly<{
    mode: 'side-solids' | 'topdown-obstacles' | 'isometric-footprints' | 'depth-lane-blockers';
    solid_terrain_ids: readonly string[];
    one_way_terrain_ids: readonly string[];
    blocked_region_ids: readonly string[];
  }>;
  readonly navigation_intent: Readonly<{
    mode: 'platform-links' | 'orthogonal-grid' | 'diamond-grid' | 'depth-lanes';
    walkable_region_ids: readonly string[];
    traversal_edge_ids: readonly string[];
    agent_radius: number;
  }>;
}

export type WorldLayoutPlanErrorCode =
  | 'layout.invalid-shape'
  | 'layout.invalid-value'
  | 'layout.invalid-binding'
  | 'layout.out-of-bounds'
  | 'layout.invalid-reference'
  | 'layout.disconnected';

export class WorldLayoutPlanError extends Error {
  constructor(readonly code: WorldLayoutPlanErrorCode, message: string) {
    super(message);
    this.name = 'WorldLayoutPlanError';
  }
}

type MutableRecord = Record<string, unknown>;
type Position = Readonly<{ x: number; y: number }>;

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const PROFILE_RULES = Object.freeze({
  'side-platformer': Object.freeze({
    terrainKind: 'bands',
    collisionMode: 'side-solids',
    navigationMode: 'platform-links',
    minimumTerrain: 5,
    minimumNodes: 6,
  }),
  'topdown-farm': Object.freeze({
    terrainKind: 'zones',
    collisionMode: 'topdown-obstacles',
    navigationMode: 'orthogonal-grid',
    minimumTerrain: 4,
    minimumNodes: 6,
  }),
  'isometric-action': Object.freeze({
    terrainKind: 'zones',
    collisionMode: 'isometric-footprints',
    navigationMode: 'diamond-grid',
    minimumTerrain: 4,
    minimumNodes: 6,
  }),
  'layered-depth-2d': Object.freeze({
    terrainKind: 'zones',
    collisionMode: 'depth-lane-blockers',
    navigationMode: 'depth-lanes',
    minimumTerrain: 4,
    minimumNodes: 6,
  }),
} as const);

function fail(code: WorldLayoutPlanErrorCode, message: string): never {
  throw new WorldLayoutPlanError(code, message);
}

function isRecord(value: unknown): value is MutableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: MutableRecord, expectedKeys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('layout.invalid-shape', `${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function safeId(value: unknown, label: string, maximum = 80): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || !SAFE_ID.test(value)
  ) {
    fail('layout.invalid-value', `${label} must be lowercase kebab-case.`);
  }
  return value;
}

function text(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || Array.from(value).length > maximum
    || CONTROL_CHARACTER.test(value)
  ) {
    fail('layout.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('layout.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('layout.invalid-value', `${label} must be a safe integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function numberValue(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail('layout.invalid-value', `${label} must be a finite number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('layout.invalid-value', 'Layout plan cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('layout.invalid-value', 'Layout plan contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digestBuffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function uniqueById<T extends Readonly<{ id: string }>>(items: readonly T[], label: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) fail('layout.invalid-value', `${label} id ${item.id} is duplicated.`);
    ids.add(item.id);
  }
}

function materializeRectangle(
  value: unknown,
  label: string,
  bounds: WorldLayoutPlan['bounds'],
  extraKeys: readonly string[],
): Readonly<{ id: string; x: number; y: number; width: number; height: number }> & MutableRecord {
  if (!isRecord(value)) fail('layout.invalid-shape', `${label} must be an object.`);
  exactKeys(value, ['id', 'x', 'y', 'width', 'height', ...extraKeys], label);
  const rectangle = {
    ...value,
    id: safeId(value.id, `${label} id`),
    x: integer(value.x, `${label} x`, 0, bounds.width - 1),
    y: integer(value.y, `${label} y`, 0, bounds.height - 1),
    width: integer(value.width, `${label} width`, 1, bounds.width),
    height: integer(value.height, `${label} height`, 1, bounds.height),
  };
  if (rectangle.x + rectangle.width > bounds.width || rectangle.y + rectangle.height > bounds.height) {
    fail('layout.out-of-bounds', `${label} extends outside the declared bounds.`);
  }
  return rectangle;
}

function positionWithinBounds(
  value: unknown,
  label: string,
  bounds: WorldLayoutPlan['bounds'],
  keys: readonly string[],
): MutableRecord & Position {
  if (!isRecord(value)) fail('layout.invalid-shape', `${label} must be an object.`);
  exactKeys(value, keys, label);
  return {
    ...value,
    x: integer(value.x, `${label} x`, 0, bounds.width - 1),
    y: integer(value.y, `${label} y`, 0, bounds.height - 1),
  };
}

function materializeStringIds(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) fail('layout.invalid-shape', `${label} must be an array.`);
  const values = Object.freeze(value.map((entry, index) => safeId(entry, `${label} ${index}`)));
  if (new Set(values).size !== values.length) fail('layout.invalid-value', `${label} cannot contain duplicates.`);
  return values;
}

function assertReferences(values: readonly string[], allowed: ReadonlySet<string>, label: string): void {
  for (const value of values) {
    if (!allowed.has(value)) fail('layout.invalid-reference', `${label} references unknown id ${value}.`);
  }
}

function reachableNodes(
  nodes: readonly WorldLayoutPlan['traversal']['nodes'][number][],
  edges: readonly WorldLayoutPlan['traversal']['edges'][number][],
  startId: string,
): ReadonlySet<string> {
  const adjacency = new Map(nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    if (edge.direction === 'bidirectional') adjacency.get(edge.to)?.push(edge.from);
  }
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

export async function materializeWorldLayoutPlan(
  value: unknown,
  expectedIntake?: unknown,
): Promise<WorldLayoutPlan> {
  if (!isRecord(value)) fail('layout.invalid-shape', 'World layout plan must be an object.');
  exactKeys(value, [
    'schema_version',
    'document_type',
    'status',
    'plan_id',
    'profile',
    'source',
    'bounds',
    'regions',
    'terrain_layout',
    'spawn',
    'exit',
    'traversal',
    'landmarks',
    'collision_intent',
    'navigation_intent',
  ], 'World layout plan');
  if (
    value.schema_version !== WORLD_LAYOUT_PLAN_VERSION
    || value.document_type !== 'world-layout-plan'
    || value.status !== WORLD_LAYOUT_PLAN_STATUS
  ) {
    fail('layout.invalid-value', 'World layout plan must be a planned 1.0.0 document.');
  }
  if (!isWorldAssetProfile(value.profile)) fail('layout.invalid-value', 'World layout profile is unsupported.');
  const profile = value.profile;
  const rules = PROFILE_RULES[profile];

  if (!isRecord(value.bounds)) fail('layout.invalid-shape', 'Layout bounds must be an object.');
  exactKeys(value.bounds, ['width', 'height', 'unit'], 'Layout bounds');
  if (value.bounds.unit !== 'logical-tile') fail('layout.invalid-value', 'Layout bounds unit must be logical-tile.');
  const bounds = Object.freeze({
    width: integer(value.bounds.width, 'Layout width', 16, 512),
    height: integer(value.bounds.height, 'Layout height', 12, 512),
    unit: 'logical-tile' as const,
  });

  if (!isRecord(value.source)) fail('layout.invalid-shape', 'Layout source must be an object.');
  exactKeys(value.source, [
    'intake_id',
    'session_revision',
    'intake_sha256',
    'map_layout_checkpoint_sha256',
    'seed',
    'seed_sha256',
  ], 'Layout source');
  const source = Object.freeze({
    intake_id: safeId(value.source.intake_id, 'Source intake id'),
    session_revision: integer(value.source.session_revision, 'Source session revision', 4, Number.MAX_SAFE_INTEGER),
    intake_sha256: digest(value.source.intake_sha256, 'Source intake digest'),
    map_layout_checkpoint_sha256: digest(
      value.source.map_layout_checkpoint_sha256,
      'Source map layout checkpoint digest',
    ),
    seed: text(value.source.seed, 'Source seed', 160),
    seed_sha256: digest(value.source.seed_sha256, 'Source seed digest'),
  });
  if (source.seed_sha256 !== await sha256(source.seed)) {
    fail('layout.invalid-binding', 'Source seed digest does not match the declared seed.');
  }

  if (!Array.isArray(value.regions) || value.regions.length < 3 || value.regions.length > 32) {
    fail('layout.invalid-value', 'Layout requires from 3 to 32 regions.');
  }
  const regionPurposes = ['spawn', 'route', 'landmark', 'exit'] as const;
  const regions = Object.freeze(value.regions.map((entry, index) => {
    const rectangle = materializeRectangle(entry, `Region ${index}`, bounds, ['purpose']);
    if (!regionPurposes.includes(rectangle.purpose as typeof regionPurposes[number])) {
      fail('layout.invalid-value', `Region ${index} purpose is unsupported.`);
    }
    return Object.freeze({
      id: rectangle.id,
      x: rectangle.x,
      y: rectangle.y,
      width: rectangle.width,
      height: rectangle.height,
      purpose: rectangle.purpose as typeof regionPurposes[number],
    });
  }));
  uniqueById(regions, 'Region');
  if (!regions.some(({ purpose }) => purpose === 'spawn') || !regions.some(({ purpose }) => purpose === 'exit')) {
    fail('layout.invalid-value', 'Layout requires spawn and exit regions.');
  }
  const regionIds = new Set(regions.map(({ id: regionId }) => regionId));

  if (!isRecord(value.terrain_layout)) fail('layout.invalid-shape', 'Terrain layout must be an object.');
  if (value.terrain_layout.kind !== rules.terrainKind) {
    fail('layout.invalid-value', `${profile} requires ${rules.terrainKind} terrain.`);
  }
  const terrainKey = rules.terrainKind;
  exactKeys(value.terrain_layout, ['kind', terrainKey], 'Terrain layout');
  const rawTerrain = value.terrain_layout[terrainKey];
  if (!Array.isArray(rawTerrain) || rawTerrain.length < rules.minimumTerrain || rawTerrain.length > 64) {
    fail('layout.invalid-value', `${profile} terrain item count is outside its canonical range.`);
  }
  const navigationValues = ['walkable', 'blocked', 'one-way'] as const;
  const terrain = Object.freeze(rawTerrain.map((entry, index) => {
    const rectangle = materializeRectangle(entry, `Terrain ${index}`, bounds, ['material', 'navigation']);
    if (!navigationValues.includes(rectangle.navigation as typeof navigationValues[number])) {
      fail('layout.invalid-value', `Terrain ${index} navigation is unsupported.`);
    }
    return Object.freeze({
      id: rectangle.id,
      x: rectangle.x,
      y: rectangle.y,
      width: rectangle.width,
      height: rectangle.height,
      material: safeId(rectangle.material, `Terrain ${index} material`, 64),
      navigation: rectangle.navigation as typeof navigationValues[number],
    });
  }));
  uniqueById(terrain, 'Terrain');
  const terrainIds = new Set(terrain.map(({ id: terrainId }) => terrainId));
  const terrain_layout: WorldLayoutTerrainLayout = rules.terrainKind === 'bands'
    ? Object.freeze({ kind: 'bands', bands: terrain })
    : Object.freeze({ kind: 'zones', zones: terrain });

  if (!isRecord(value.traversal)) fail('layout.invalid-shape', 'Traversal must be an object.');
  exactKeys(value.traversal, ['nodes', 'edges'], 'Traversal');
  if (!Array.isArray(value.traversal.nodes) || value.traversal.nodes.length < rules.minimumNodes || value.traversal.nodes.length > 64) {
    fail('layout.invalid-value', `${profile} traversal node count is outside its canonical range.`);
  }
  const nodeKinds = ['spawn', 'route', 'landmark', 'exit'] as const;
  const nodes = Object.freeze(value.traversal.nodes.map((entry, index) => {
    const positioned = positionWithinBounds(
      entry,
      `Traversal node ${index}`,
      bounds,
      ['id', 'kind', 'region_id', 'x', 'y'],
    );
    if (!nodeKinds.includes(positioned.kind as typeof nodeKinds[number])) {
      fail('layout.invalid-value', `Traversal node ${index} kind is unsupported.`);
    }
    const regionId = safeId(positioned.region_id, `Traversal node ${index} region id`);
    if (!regionIds.has(regionId)) {
      fail('layout.invalid-reference', `Traversal node ${index} references unknown region ${regionId}.`);
    }
    const region = regions.find(({ id: regionCandidate }) => regionCandidate === regionId)!;
    if (
      positioned.x < region.x
      || positioned.x >= region.x + region.width
      || positioned.y < region.y
      || positioned.y >= region.y + region.height
    ) {
      fail('layout.invalid-reference', `Traversal node ${index} is outside its bound region.`);
    }
    return Object.freeze({
      id: safeId(positioned.id, `Traversal node ${index} id`),
      kind: positioned.kind as typeof nodeKinds[number],
      region_id: regionId,
      x: positioned.x,
      y: positioned.y,
    });
  }));
  uniqueById(nodes, 'Traversal node');
  const nodeIds = new Set(nodes.map(({ id: nodeId }) => nodeId));

  if (!Array.isArray(value.traversal.edges) || value.traversal.edges.length < nodes.length - 1 || value.traversal.edges.length > 128) {
    fail('layout.invalid-value', 'Traversal edge count cannot form the canonical connected graph.');
  }
  const edgeKinds = ['walk', 'jump', 'drop', 'climb', 'portal'] as const;
  const edgeDirections = ['forward', 'bidirectional'] as const;
  const edges = Object.freeze(value.traversal.edges.map((entry, index) => {
    if (!isRecord(entry)) fail('layout.invalid-shape', `Traversal edge ${index} must be an object.`);
    exactKeys(entry, ['id', 'from', 'to', 'kind', 'direction'], `Traversal edge ${index}`);
    const from = safeId(entry.from, `Traversal edge ${index} from`);
    const to = safeId(entry.to, `Traversal edge ${index} to`);
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) {
      fail('layout.invalid-reference', `Traversal edge ${index} has invalid endpoints.`);
    }
    if (!edgeKinds.includes(entry.kind as typeof edgeKinds[number])) {
      fail('layout.invalid-value', `Traversal edge ${index} kind is unsupported.`);
    }
    if (!edgeDirections.includes(entry.direction as typeof edgeDirections[number])) {
      fail('layout.invalid-value', `Traversal edge ${index} direction is unsupported.`);
    }
    return Object.freeze({
      id: safeId(entry.id, `Traversal edge ${index} id`),
      from,
      to,
      kind: entry.kind as typeof edgeKinds[number],
      direction: entry.direction as typeof edgeDirections[number],
    });
  }));
  uniqueById(edges, 'Traversal edge');
  const edgeIds = new Set(edges.map(({ id: edgeId }) => edgeId));
  const traversal = Object.freeze({ nodes, edges });

  const spawnValue = positionWithinBounds(value.spawn, 'Spawn', bounds, ['node_id', 'x', 'y']);
  const exitValue = positionWithinBounds(value.exit, 'Exit', bounds, ['node_id', 'x', 'y']);
  const spawn = Object.freeze({
    node_id: safeId(spawnValue.node_id, 'Spawn node id'),
    x: spawnValue.x,
    y: spawnValue.y,
  });
  const exit = Object.freeze({
    node_id: safeId(exitValue.node_id, 'Exit node id'),
    x: exitValue.x,
    y: exitValue.y,
  });
  const spawnNode = nodes.find(({ id: nodeId }) => nodeId === spawn.node_id);
  const exitNode = nodes.find(({ id: nodeId }) => nodeId === exit.node_id);
  if (!spawnNode || spawnNode.kind !== 'spawn' || spawnNode.x !== spawn.x || spawnNode.y !== spawn.y) {
    fail('layout.invalid-binding', 'Spawn must exactly bind the unique spawn traversal node.');
  }
  if (!exitNode || exitNode.kind !== 'exit' || exitNode.x !== exit.x || exitNode.y !== exit.y) {
    fail('layout.invalid-binding', 'Exit must exactly bind the unique exit traversal node.');
  }
  if (
    nodes.filter(({ kind }) => kind === 'spawn').length !== 1
    || nodes.filter(({ kind }) => kind === 'exit').length !== 1
    || spawn.node_id === exit.node_id
  ) {
    fail('layout.invalid-value', 'Layout must have exactly one distinct spawn and exit node.');
  }
  if (
    regions.find(({ id: regionId }) => regionId === spawnNode.region_id)?.purpose !== 'spawn'
    || regions.find(({ id: regionId }) => regionId === exitNode.region_id)?.purpose !== 'exit'
  ) {
    fail('layout.invalid-binding', 'Spawn and exit nodes must bind regions with matching purposes.');
  }
  const reachable = reachableNodes(nodes, edges, spawn.node_id);
  if (reachable.size !== nodes.length || !reachable.has(exit.node_id)) {
    fail('layout.disconnected', 'Every traversal node, including the exit, must be reachable from spawn.');
  }

  if (!Array.isArray(value.landmarks) || value.landmarks.length < 2 || value.landmarks.length > 16) {
    fail('layout.invalid-value', 'Layout requires from 2 to 16 landmarks.');
  }
  const landmarks = Object.freeze(value.landmarks.map((entry, index) => {
    const positioned = positionWithinBounds(
      entry,
      `Landmark ${index}`,
      bounds,
      ['id', 'label', 'region_id', 'node_id', 'x', 'y'],
    );
    const regionId = safeId(positioned.region_id, `Landmark ${index} region id`);
    const nodeId = safeId(positioned.node_id, `Landmark ${index} node id`);
    const node = nodes.find(({ id: candidateId }) => candidateId === nodeId);
    if (
      !node
      || node.kind !== 'landmark'
      || node.region_id !== regionId
      || node.x !== positioned.x
      || node.y !== positioned.y
    ) {
      fail('layout.invalid-binding', `Landmark ${index} must exactly bind a landmark traversal node.`);
    }
    if (regions.find(({ id: candidateId }) => candidateId === regionId)?.purpose !== 'landmark') {
      fail('layout.invalid-binding', `Landmark ${index} must bind a landmark-purpose region.`);
    }
    return Object.freeze({
      id: safeId(positioned.id, `Landmark ${index} id`),
      label: text(positioned.label, `Landmark ${index} label`, 120),
      region_id: regionId,
      node_id: nodeId,
      x: positioned.x,
      y: positioned.y,
    });
  }));
  uniqueById(landmarks, 'Landmark');
  if (new Set(landmarks.map(({ node_id }) => node_id)).size !== landmarks.length) {
    fail('layout.invalid-binding', 'Each landmark must bind a distinct traversal node.');
  }
  const landmarkNodeIds = new Set(nodes.filter(({ kind }) => kind === 'landmark').map(({ id }) => id));
  if (landmarkNodeIds.size !== landmarks.length || landmarks.some(({ node_id }) => !landmarkNodeIds.has(node_id))) {
    fail('layout.invalid-binding', 'Every landmark traversal node must have exactly one landmark binding.');
  }

  if (!isRecord(value.collision_intent)) fail('layout.invalid-shape', 'Collision intent must be an object.');
  exactKeys(value.collision_intent, [
    'mode',
    'solid_terrain_ids',
    'one_way_terrain_ids',
    'blocked_region_ids',
  ], 'Collision intent');
  if (value.collision_intent.mode !== rules.collisionMode) {
    fail('layout.invalid-value', `${profile} collision mode must be ${rules.collisionMode}.`);
  }
  const collision_intent = Object.freeze({
    mode: rules.collisionMode,
    solid_terrain_ids: materializeStringIds(value.collision_intent.solid_terrain_ids, 'Solid terrain ids'),
    one_way_terrain_ids: materializeStringIds(value.collision_intent.one_way_terrain_ids, 'One-way terrain ids'),
    blocked_region_ids: materializeStringIds(value.collision_intent.blocked_region_ids, 'Blocked region ids'),
  });
  assertReferences(collision_intent.solid_terrain_ids, terrainIds, 'Solid terrain ids');
  assertReferences(collision_intent.one_way_terrain_ids, terrainIds, 'One-way terrain ids');
  assertReferences(collision_intent.blocked_region_ids, regionIds, 'Blocked region ids');
  if (collision_intent.one_way_terrain_ids.some((terrainId) => (
    terrain.find(({ id }) => id === terrainId)?.navigation !== 'one-way'
  ))) {
    fail('layout.invalid-binding', 'One-way collision ids must reference one-way terrain.');
  }
  const declaredOneWayIds = new Set(
    terrain.filter(({ navigation }) => navigation === 'one-way').map(({ id }) => id),
  );
  if (
    collision_intent.one_way_terrain_ids.length !== declaredOneWayIds.size
    || collision_intent.one_way_terrain_ids.some((terrainId) => !declaredOneWayIds.has(terrainId))
  ) {
    fail('layout.invalid-binding', 'Collision intent must bind every one-way terrain item.');
  }
  const solidIds = new Set(collision_intent.solid_terrain_ids);
  if (terrain.some(({ id: terrainId, navigation }) => navigation === 'blocked' && !solidIds.has(terrainId))) {
    fail('layout.invalid-binding', 'Collision intent must bind every blocked terrain item.');
  }
  if (profile === 'side-platformer' && collision_intent.one_way_terrain_ids.length === 0) {
    fail('layout.invalid-value', 'Side-platformer layout requires at least one one-way terrain band.');
  }
  if (profile !== 'side-platformer' && collision_intent.one_way_terrain_ids.length !== 0) {
    fail('layout.invalid-value', `${profile} cannot declare side-view one-way terrain.`);
  }

  if (!isRecord(value.navigation_intent)) fail('layout.invalid-shape', 'Navigation intent must be an object.');
  exactKeys(value.navigation_intent, [
    'mode',
    'walkable_region_ids',
    'traversal_edge_ids',
    'agent_radius',
  ], 'Navigation intent');
  if (value.navigation_intent.mode !== rules.navigationMode) {
    fail('layout.invalid-value', `${profile} navigation mode must be ${rules.navigationMode}.`);
  }
  const navigation_intent = Object.freeze({
    mode: rules.navigationMode,
    walkable_region_ids: materializeStringIds(
      value.navigation_intent.walkable_region_ids,
      'Walkable region ids',
    ),
    traversal_edge_ids: materializeStringIds(
      value.navigation_intent.traversal_edge_ids,
      'Traversal edge ids',
    ),
    agent_radius: numberValue(value.navigation_intent.agent_radius, 'Navigation agent radius', 0.1, 8),
  });
  assertReferences(navigation_intent.walkable_region_ids, regionIds, 'Walkable region ids');
  assertReferences(navigation_intent.traversal_edge_ids, edgeIds, 'Traversal edge ids');
  const walkableRegionIds = new Set(navigation_intent.walkable_region_ids);
  if (
    collision_intent.blocked_region_ids.some((regionId) => walkableRegionIds.has(regionId))
    || nodes.some(({ region_id }) => !walkableRegionIds.has(region_id))
  ) {
    fail('layout.invalid-binding', 'Traversal nodes must use walkable, non-blocked regions.');
  }
  if (
    navigation_intent.walkable_region_ids.length === 0
    || navigation_intent.traversal_edge_ids.length !== edges.length
    || new Set(navigation_intent.traversal_edge_ids).size !== edgeIds.size
  ) {
    fail('layout.invalid-binding', 'Navigation intent must bind every traversal edge and a walkable region.');
  }

  const plan: WorldLayoutPlan = Object.freeze({
    schema_version: WORLD_LAYOUT_PLAN_VERSION,
    document_type: 'world-layout-plan',
    status: WORLD_LAYOUT_PLAN_STATUS,
    plan_id: safeId(value.plan_id, 'Layout plan id'),
    profile,
    source,
    bounds,
    regions,
    terrain_layout,
    spawn,
    exit,
    traversal,
    landmarks,
    collision_intent,
    navigation_intent,
  });

  if (expectedIntake !== undefined) {
    const intake = await materializeConfirmedWorldCreationIntake(expectedIntake);
    const mapCheckpoint = intake.checkpoints.find(({ stage }) => stage === 'map-layout')!;
    if (
      plan.profile !== intake.profile
      || plan.source.intake_id !== intake.intake_id
      || plan.source.session_revision !== intake.session_revision
      || plan.source.seed !== intake.seed
      || plan.source.intake_sha256 !== await fingerprintConfirmedWorldCreationIntake(intake)
      || plan.source.map_layout_checkpoint_sha256 !== mapCheckpoint.snapshot_sha256
    ) {
      fail('layout.invalid-binding', 'Layout plan source does not match the confirmed intake.');
    }
  }
  return plan;
}

export async function buildWorldLayoutPlanFromConfirmedIntake(
  value: unknown,
): Promise<WorldLayoutPlan> {
  const intake = await materializeConfirmedWorldCreationIntake(value);
  const constraints = await deriveWorldLayoutConstraintsFromConfirmedIntake(intake);
  return solveWorldLayoutPlanFromConstraints(constraints, intake);
}

export async function solveWorldLayoutPlanFromConstraints(
  constraintsValue: unknown,
  intakeValue: unknown,
): Promise<WorldLayoutPlan> {
  const intake = await materializeConfirmedWorldCreationIntake(intakeValue);
  const constraints: WorldLayoutConstraints = await materializeWorldLayoutConstraints(
    constraintsValue,
    intake,
  );
  const mapCheckpoint = intake.checkpoints.find(({ stage }) => stage === 'map-layout')!;
  const seedSha256 = await sha256(intake.seed);
  const solverSeedSha256 = await sha256({
    solver: 'world-layout-solver',
    solver_version: WORLD_LAYOUT_SOLVER_VERSION,
    seed_sha256: seedSha256,
    profile: constraints.profile,
    route_shape: constraints.route_shape,
    scale: constraints.scale,
    verticality: constraints.verticality,
    water: constraints.water,
    settlement_density: constraints.settlement_density,
    hazard_level: constraints.hazard_level,
    landmark_count: constraints.landmark_labels.length,
  });
  const solution = solveWorldLayoutConstraints(constraints, solverSeedSha256);
  const rules = PROFILE_RULES[intake.profile];
  const terrain_layout = rules.terrainKind === 'bands'
    ? { kind: 'bands' as const, bands: solution.terrain }
    : { kind: 'zones' as const, zones: solution.terrain };
  const intakeSha256 = await fingerprintConfirmedWorldCreationIntake(intake);
  const constraintsSha256 = await sha256(constraints);
  const planId = `layout-${(await sha256({
    intake_sha256: intakeSha256,
    constraints_sha256: constraintsSha256,
    solver: 'world-layout-solver',
    solver_version: WORLD_LAYOUT_SOLVER_VERSION,
  })).slice(0, 16)}`;
  const spawn = solution.nodes.find(({ kind }) => kind === 'spawn')!;
  const exit = solution.nodes.find(({ kind }) => kind === 'exit')!;
  const candidate = {
    schema_version: WORLD_LAYOUT_PLAN_VERSION,
    document_type: 'world-layout-plan' as const,
    status: WORLD_LAYOUT_PLAN_STATUS,
    plan_id: planId,
    profile: intake.profile,
    source: {
      intake_id: intake.intake_id,
      session_revision: intake.session_revision,
      intake_sha256: intakeSha256,
      map_layout_checkpoint_sha256: mapCheckpoint.snapshot_sha256,
      seed: intake.seed,
      seed_sha256: seedSha256,
    },
    bounds: solution.bounds,
    regions: solution.regions,
    terrain_layout,
    spawn: { node_id: spawn.id, x: spawn.x, y: spawn.y },
    exit: { node_id: exit.id, x: exit.x, y: exit.y },
    traversal: { nodes: solution.nodes, edges: solution.edges },
    landmarks: solution.landmarks,
    collision_intent: {
      mode: solution.collision.mode,
      solid_terrain_ids: solution.collision.solidTerrainIds,
      one_way_terrain_ids: solution.collision.oneWayTerrainIds,
      blocked_region_ids: solution.collision.blockedRegionIds,
    },
    navigation_intent: {
      mode: solution.navigation.mode,
      walkable_region_ids: solution.regions.map(({ id }) => id),
      traversal_edge_ids: solution.edges.map(({ id }) => id),
      agent_radius: solution.navigation.agentRadius,
    },
  };
  return materializeWorldLayoutPlan(candidate, intake);
}

export async function fingerprintWorldLayoutPlan(value: unknown): Promise<string> {
  return sha256(await materializeWorldLayoutPlan(value));
}

/**
 * Serializes a validated plan with recursively sorted object keys. The trailing
 * newline is part of the portable file bytes, while fingerprintWorldLayoutPlan
 * remains the semantic fingerprint of the newline-free canonical JSON value.
 */
export async function serializeCanonicalWorldLayoutPlan(value: unknown): Promise<Uint8Array> {
  const plan = await materializeWorldLayoutPlan(value);
  return new TextEncoder().encode(`${canonicalJson(plan)}\n`);
}
