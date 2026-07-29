import {
  fingerprintGodotRuntimeBindingKeysV1_1,
  type GodotRuntimeCaptureV1_1BindingKey,
  type GodotRuntimeCaptureV1_1BindingKind,
} from '../core/godot-runtime-capture-receipt-v1-1';
import type {
  WorldArtPlacementMap,
} from '../core/world-art-placement-map';
import type {
  WorldArtRuntimeProjection,
} from '../core/world-art-runtime-projection';
import type {
  WorldVisualPlacement,
  WorldVisualPlacementPlan,
} from '../core/world-visual-placement-plan';

export interface DeriveGodotRuntimeBindingInventoryV1_1Input {
  readonly projection: WorldArtRuntimeProjection;
  readonly placement_plan: WorldVisualPlacementPlan;
  readonly placement_map: WorldArtPlacementMap;
}

export interface GodotRuntimeBindingInventoryV1_1 {
  readonly expected_bindings: readonly GodotRuntimeCaptureV1_1BindingKey[];
  readonly bindings_sha256: string;
  readonly catalog_assets: number;
  readonly bound_catalog_assets: number;
  readonly catalog_only_assets: number;
  readonly visible_terrain_materials: number;
  readonly visible_landmarks: number;
  readonly visible_hazards: number;
  readonly visible_characters: number;
  readonly applied_background_layers: number;
  readonly applied_prop_instances: number;
  readonly applied_structure_instances: number;
  readonly applied_effect_bindings: number;
  readonly applied_depth_planes: number;
}

export class DeriveGodotRuntimeBindingInventoryV1_1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeriveGodotRuntimeBindingInventoryV1_1Error';
  }
}

function fail(message: string): never {
  throw new DeriveGodotRuntimeBindingInventoryV1_1Error(message);
}

function assetKey(taskId: string, slotId: string): string {
  return `${taskId}\u0000${slotId}`;
}

function key(
  usageKind: GodotRuntimeCaptureV1_1BindingKind,
  usageId: string,
): GodotRuntimeCaptureV1_1BindingKey {
  return Object.freeze({
    usage_kind: usageKind,
    usage_id: usageId,
  });
}

function placementKind(
  placement: WorldVisualPlacement,
): GodotRuntimeCaptureV1_1BindingKind {
  if (placement.kind === 'depth-plane') {
    return placement.role.startsWith('background.') ? 'background' : 'depth';
  }
  if (placement.kind === 'sprite') {
    return placement.role.startsWith('structure.') ? 'structure' : 'prop';
  }
  if (placement.kind === 'effect') return 'effect';
  return placement.controller === 'moving-platform' ? 'hazard' : 'character';
}

function compareKeys(
  left: GodotRuntimeCaptureV1_1BindingKey,
  right: GodotRuntimeCaptureV1_1BindingKey,
): number {
  return left.usage_kind.localeCompare(right.usage_kind, 'en')
    || left.usage_id.localeCompare(right.usage_id, 'en');
}

export async function deriveGodotRuntimeBindingInventoryV1_1(
  input: DeriveGodotRuntimeBindingInventoryV1_1Input,
): Promise<GodotRuntimeBindingInventoryV1_1> {
  const { projection, placement_plan: plan, placement_map: map } = input;
  if (
    projection.profile !== plan.profile
    || projection.profile !== map.profile
    || plan.source.layout_plan_sha256 !== projection.source.layout_plan_sha256
    || map.source.layout_plan_sha256 !== projection.source.layout_plan_sha256
    || map.source.placement_plan_id !== plan.plan_id
    || plan.placements.length !== map.bindings.length
  ) {
    fail('Projection, placement plan, and placement map are not source-bound.');
  }

  const catalogKeys = new Set(projection.assets.map((asset) =>
    assetKey(asset.task_id, asset.slot_id)));
  const boundCatalogKeys = new Set<string>();
  for (const binding of projection.bindings) {
    const value = assetKey(binding.task_id, binding.slot_id);
    if (!catalogKeys.has(value)) fail('Projection binding is absent from the catalog.');
    boundCatalogKeys.add(value);
  }

  const keys: GodotRuntimeCaptureV1_1BindingKey[] = projection.bindings.map(
    (binding) => key(binding.usage_kind, binding.usage_id),
  );
  for (const [index, placement] of plan.placements.entries()) {
    const binding = map.bindings[index];
    if (
      !binding
      || binding.placement_id !== placement.placement_id
      || binding.role !== placement.role
      || binding.variant_id !== (placement.variant_id ?? 'canonical')
    ) {
      fail('Placement map does not cover the placement plan in exact order.');
    }
    const value = assetKey(binding.task_id, binding.slot_id);
    if (!catalogKeys.has(value)) fail('Placement binding is absent from the catalog.');
    boundCatalogKeys.add(value);
    keys.push(key(placementKind(placement), placement.placement_id));
  }
  keys.sort(compareKeys);
  if (
    new Set(keys.map(({ usage_kind: kind, usage_id: id }) => `${kind}\u0000${id}`))
      .size !== keys.length
  ) {
    fail('Runtime binding usage keys must be unique.');
  }

  const expectedBindings = Object.freeze(keys);
  const backgroundLayers = plan.placements.filter((placement) =>
    placement.kind === 'depth-plane'
    && placementKind(placement) === 'background').length;
  const depthPlanes = plan.placements.filter((placement) =>
    placement.kind === 'depth-plane'
    && placementKind(placement) === 'depth').length;
  const propInstances = plan.placements.filter((placement) =>
    placement.kind === 'sprite'
    && placementKind(placement) === 'prop').length;
  const structureInstances = plan.placements.filter((placement) =>
    placement.kind === 'sprite'
    && placementKind(placement) === 'structure').length;
  const effects = plan.placements.filter(
    ({ kind: value }) => value === 'effect',
  ).length;
  const placementCharacters = plan.placements.filter((placement) =>
    placement.kind === 'actor'
    && placement.controller !== 'moving-platform').length;
  const projectedCharacters = projection.bindings.filter(
    ({ usage_kind: value }) => value === 'character',
  ).length;

  return Object.freeze({
    expected_bindings: expectedBindings,
    bindings_sha256: await fingerprintGodotRuntimeBindingKeysV1_1(
      expectedBindings,
    ),
    catalog_assets: projection.assets.length,
    bound_catalog_assets: boundCatalogKeys.size,
    catalog_only_assets: projection.assets.length - boundCatalogKeys.size,
    visible_terrain_materials: projection.bindings.filter(
      ({ usage_kind: value }) => value === 'terrain-material',
    ).length,
    visible_landmarks: projection.bindings.filter(
      ({ usage_kind: value }) => value === 'landmark',
    ).length,
    visible_hazards: projection.hazards.length,
    visible_characters: projectedCharacters + placementCharacters,
    applied_background_layers: backgroundLayers,
    applied_prop_instances: propInstances,
    applied_structure_instances: structureInstances,
    applied_effect_bindings: effects,
    applied_depth_planes: depthPlanes,
  });
}
