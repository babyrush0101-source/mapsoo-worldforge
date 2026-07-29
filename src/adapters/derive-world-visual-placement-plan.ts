import {
  materializeAssetRequirementsV1_1,
  type AssetRequirementV1_1,
  type AssetRequirementsV1_1,
} from '../core/asset-requirements-v1-1';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from '../core/world-layout-plan';
import {
  buildWorldVisualPlacementPlan,
  type WorldVisualEffectTrigger,
  type WorldVisualPlacement,
  type WorldVisualPlacementAnchor,
  type WorldVisualPlacementPlan,
} from '../core/world-visual-placement-plan';

export interface DeriveWorldVisualPlacementPlanInput {
  readonly layout: unknown;
  readonly requirements: unknown;
}

export type DeriveWorldVisualPlacementPlanErrorCode =
  | 'world-visual-placement-derive.invalid-source'
  | 'world-visual-placement-derive.invalid-role'
  | 'world-visual-placement-derive.empty';

export class DeriveWorldVisualPlacementPlanError extends Error {
  constructor(
    readonly code: DeriveWorldVisualPlacementPlanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeriveWorldVisualPlacementPlanError';
  }
}

type RouteNode = WorldLayoutPlan['traversal']['nodes'][number];

const DEPTH_ROLE_ORDER = Object.freeze({
  'background.sky': -600,
  'background.far': -500,
  'background.mid': -400,
  'background.depth-fog': -300,
  'background.near': -200,
  'near.overlay': 100,
  'foreground.overlay': 200,
  'lighting.ambient': 0,
  'lighting.local': 100,
} satisfies Readonly<Record<string, number>>);

function fail(
  code: DeriveWorldVisualPlacementPlanErrorCode,
  message: string,
): never {
  throw new DeriveWorldVisualPlacementPlanError(code, message);
}

function slug(role: string): string {
  return role.replaceAll('.', '-');
}

function routeNodes(layout: WorldLayoutPlan): readonly RouteNode[] {
  const routes = layout.traversal.nodes.filter(({ kind }) => kind === 'route');
  return routes.length > 0 ? routes : layout.traversal.nodes;
}

function routeNode(
  layout: WorldLayoutPlan,
  index: number,
): RouteNode {
  const routes = routeNodes(layout);
  return routes[index % routes.length]!;
}

function logicalPoint(
  layout: WorldLayoutPlan,
  index: number,
  instance: number,
): WorldVisualPlacementAnchor {
  const node = routeNode(layout, index + instance);
  const offsets = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ] as const;
  const offset = offsets[(index + instance) % offsets.length]!;
  return Object.freeze({
    kind: 'logical-point' as const,
    x: Math.max(0, Math.min(layout.bounds.width - 1, node.x + offset.x)),
    y: Math.max(0, Math.min(layout.bounds.height - 1, node.y + offset.y)),
  });
}

function depthPlaneOrder(role: string): number {
  const known = DEPTH_ROLE_ORDER[role as keyof typeof DEPTH_ROLE_ORDER];
  if (known !== undefined) return known;
  if (role.startsWith('background.')) return -100;
  if (role.startsWith('foreground.') || role.startsWith('near.')) return 100;
  if (role.startsWith('lighting.')) return 0;
  fail(
    'world-visual-placement-derive.invalid-role',
    `Role ${role} is not a supported depth-plane role.`,
  );
}

function depthPlaneLayer(
  role: string,
): 'background' | 'foreground' | 'lighting' {
  if (role.startsWith('background.')) return 'background';
  if (role.startsWith('foreground.') || role.startsWith('near.')) return 'foreground';
  if (role.startsWith('lighting.')) return 'lighting';
  fail(
    'world-visual-placement-derive.invalid-role',
    `Role ${role} is not a supported depth-plane role.`,
  );
}

function parallaxFor(role: string): Readonly<{ x: number; y: number }> {
  if (role === 'background.sky') return Object.freeze({ x: 0, y: 0 });
  if (role === 'background.far') return Object.freeze({ x: 0.25, y: 0.1 });
  if (role === 'background.mid') return Object.freeze({ x: 0.5, y: 0.25 });
  if (role === 'background.depth-fog') return Object.freeze({ x: 0.65, y: 0.4 });
  if (role === 'background.near') return Object.freeze({ x: 0.8, y: 0.65 });
  return Object.freeze({ x: 1, y: 1 });
}

function effectTrigger(role: string): WorldVisualEffectTrigger {
  if (role.includes('spawn')) return 'on-spawn';
  if (role.includes('attack') || role.includes('projectile')) return 'on-attack';
  if (role.includes('impact')) return 'on-impact';
  if (role.includes('defeat')) return 'on-defeat';
  if (role.includes('interact')) return 'on-interact';
  if (role.includes('portal')) return 'on-enter';
  return 'always';
}

function structureAnchor(
  role: string,
  layout: WorldLayoutPlan,
  roleIndex: number,
): WorldVisualPlacementAnchor {
  if (role === 'structure.entrance') return Object.freeze({ kind: 'spawn' as const });
  if (role === 'structure.exit') return Object.freeze({ kind: 'exit' as const });
  if (role === 'structure.checkpoint') {
    return Object.freeze({
      kind: 'traversal' as const,
      ref_id: routeNode(layout, Math.floor(routeNodes(layout).length / 2)).id,
    });
  }
  const landmark = layout.landmarks[roleIndex % layout.landmarks.length];
  if (landmark) {
    return Object.freeze({ kind: 'landmark' as const, ref_id: landmark.id });
  }
  return Object.freeze({
    kind: 'traversal' as const,
    ref_id: routeNode(layout, roleIndex).id,
  });
}

function actorController(
  role: string,
): 'npc' | 'enemy' | 'moving-platform' {
  if (role === 'hazard.moving-platform') return 'moving-platform';
  if (role === 'character.npc.atlas') return 'npc';
  if (role.startsWith('character.enemy-')) return 'enemy';
  fail(
    'world-visual-placement-derive.invalid-role',
    `Role ${role} is not a supported generated actor role.`,
  );
}

function shouldSkip(role: string): boolean {
  return role.startsWith('terrain.')
    || role === 'structure.landmark'
    || role === 'character.player.atlas'
    || role === 'world.preview'
    || (role.startsWith('hazard.') && role !== 'hazard.moving-platform');
}

function placementCount(requirement: AssetRequirementV1_1): number {
  const role = requirement.binding.role;
  return role.startsWith('prop.') || role.startsWith('crop.') ? 2 : 1;
}

function placementsForRequirement(
  requirement: AssetRequirementV1_1,
  layout: WorldLayoutPlan,
  roleIndex: number,
): readonly WorldVisualPlacement[] {
  const role = requirement.binding.role;
  if (shouldSkip(role)) return Object.freeze([]);
  if (requirement.variants.length !== 1) {
    fail(
      'world-visual-placement-derive.invalid-role',
      `Generated placement role ${role} must have exactly one canonical variant.`,
    );
  }
  const variantId = requirement.variants[0]!.variant_id;
  const ySort = layout.profile !== 'side-platformer';
  if (
    role.startsWith('background.')
    || role.startsWith('foreground.')
    || role.startsWith('near.')
    || role.startsWith('lighting.')
  ) {
    return Object.freeze([Object.freeze({
      placement_id: `placement-${slug(role)}-001`,
      kind: 'depth-plane' as const,
      role,
      variant_id: variantId,
      anchor: Object.freeze({
        kind: 'logical-rect' as const,
        x: 0,
        y: 0,
        width: layout.bounds.width,
        height: layout.bounds.height,
      }),
      render: Object.freeze({
        layer: depthPlaneLayer(role),
        order: depthPlaneOrder(role),
        parallax: parallaxFor(role),
        repeat: Object.freeze({
          x: role.startsWith('background.') || role.startsWith('foreground.'),
          y: false,
        }),
      }),
    })]);
  }
  if (role.startsWith('effect.')) {
    return Object.freeze([Object.freeze({
      placement_id: `placement-${slug(role)}-001`,
      kind: 'effect' as const,
      role,
      variant_id: variantId,
      anchor: Object.freeze({
        kind: 'traversal' as const,
        ref_id: routeNode(layout, roleIndex).id,
      }),
      render: Object.freeze({ layer: 'effects' as const, order: roleIndex, y_sort: ySort }),
      trigger: effectTrigger(role),
    })]);
  }
  if (role.startsWith('character.') || role === 'hazard.moving-platform') {
    return Object.freeze([Object.freeze({
      placement_id: `placement-${slug(role)}-001`,
      kind: 'actor' as const,
      role,
      variant_id: variantId,
      anchor: Object.freeze({
        kind: 'traversal' as const,
        ref_id: routeNode(layout, roleIndex + 1).id,
      }),
      render: Object.freeze({ layer: 'actors' as const, order: roleIndex, y_sort: ySort }),
      controller: actorController(role),
    })]);
  }
  if (
    role.startsWith('prop.')
    || role.startsWith('crop.')
    || role.startsWith('collectible.')
    || role.startsWith('structure.')
  ) {
    return Object.freeze(Array.from(
      { length: placementCount(requirement) },
      (_, instance) => Object.freeze({
        placement_id: `placement-${slug(role)}-${String(instance + 1).padStart(3, '0')}`,
        kind: 'sprite' as const,
        role,
        variant_id: variantId,
        anchor: role.startsWith('structure.')
          ? structureAnchor(role, layout, roleIndex + instance)
          : logicalPoint(layout, roleIndex, instance),
        render: Object.freeze({
          layer: 'world' as const,
          order: roleIndex * 10 + instance,
          y_sort: ySort,
        }),
      }),
    ));
  }
  fail(
    'world-visual-placement-derive.invalid-role',
    `Role ${role} has no deterministic runtime placement policy.`,
  );
}

function assertSourceBinding(
  layout: WorldLayoutPlan,
  requirements: AssetRequirementsV1_1,
  layoutSha256: string,
): void {
  if (
    requirements.profile !== layout.profile
    || requirements.source.layout_plan_sha256 !== layoutSha256
    || requirements.layout.width !== layout.bounds.width
    || requirements.layout.height !== layout.bounds.height
    || requirements.layout.region_count !== layout.regions.length
    || requirements.layout.traversal_node_count !== layout.traversal.nodes.length
  ) {
    fail(
      'world-visual-placement-derive.invalid-source',
      'Asset requirements do not bind the exact canonical WorldLayoutPlan.',
    );
  }
}

/**
 * Converts the complete reviewed role demand into deterministic scene
 * placements. Existing terrain, layout landmarks, respawn hazards, and the
 * player keep their established runtime paths; this sidecar covers the
 * remaining environment, decor, effect, actor, and moving-platform roles.
 */
export async function deriveWorldVisualPlacementPlan(
  input: DeriveWorldVisualPlacementPlanInput,
): Promise<WorldVisualPlacementPlan> {
  const [layout, requirements] = await Promise.all([
    materializeWorldLayoutPlan(input.layout),
    materializeAssetRequirementsV1_1(input.requirements),
  ]).catch((error) => fail(
    'world-visual-placement-derive.invalid-source',
    `World visual placement sources are invalid: ${
      error instanceof Error ? error.message : 'unknown error'
    }`,
  ));
  const layoutSha256 = await fingerprintWorldLayoutPlan(layout);
  assertSourceBinding(layout, requirements, layoutSha256);
  const placements = requirements.requirements.flatMap((requirement, index) =>
    placementsForRequirement(requirement, layout, index));
  if (placements.length < 1) {
    fail(
      'world-visual-placement-derive.empty',
      'The complete profile did not produce any visual placements.',
    );
  }
  return buildWorldVisualPlacementPlan(layout, placements);
}
