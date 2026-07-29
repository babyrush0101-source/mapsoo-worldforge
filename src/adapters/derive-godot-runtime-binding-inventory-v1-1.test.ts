import { describe, expect, it } from 'vitest';

import {
  DeriveGodotRuntimeBindingInventoryV1_1Error,
  deriveGodotRuntimeBindingInventoryV1_1,
} from './derive-godot-runtime-binding-inventory-v1-1';
import {
  buildWorldArtRuntimeOverlayV1_1TestFixture,
} from './world-art-runtime-overlay-v1-1.test-fixture';

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('deriveGodotRuntimeBindingInventoryV1_1', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('derives exact catalog and instance evidence for %s', async (profile) => {
    const fixture = await buildWorldArtRuntimeOverlayV1_1TestFixture(profile);
    const result = await deriveGodotRuntimeBindingInventoryV1_1({
      projection: fixture.projected.projection,
      placement_plan: fixture.placement_plan as any,
      placement_map: fixture.placement_map as any,
    });

    expect(result.catalog_assets).toBe(2);
    expect(result.bound_catalog_assets).toBe(2);
    expect(result.catalog_only_assets).toBe(0);
    expect(result.expected_bindings).toEqual([
      { usage_kind: 'prop', usage_id: 'tree-a' },
      { usage_kind: 'prop', usage_id: 'tree-b' },
      { usage_kind: 'terrain-material', usage_id: 'ground' },
    ]);
    expect(result.applied_prop_instances).toBe(2);
    expect(result.visible_terrain_materials).toBe(1);
    expect(result.bindings_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('distinguishes repeated placement instances from their one catalog asset', async () => {
    const fixture = await buildWorldArtRuntimeOverlayV1_1TestFixture('topdown-farm');
    const result = await deriveGodotRuntimeBindingInventoryV1_1({
      projection: fixture.projected.projection,
      placement_plan: fixture.placement_plan as any,
      placement_map: fixture.placement_map as any,
    });
    const propBindings = result.expected_bindings.filter(
      ({ usage_kind: value }) => value === 'prop',
    );
    expect(propBindings).toHaveLength(2);
    expect(new Set(
      (fixture.placement_map as any).bindings.map(
        ({ task_id: task, slot_id: slot }: any) => `${task}/${slot}`,
      ),
    ).size).toBe(1);
  });

  it('rejects missing, reordered, duplicated, or non-catalog placement bindings', async () => {
    const fixture = await buildWorldArtRuntimeOverlayV1_1TestFixture('side-platformer');
    const missing = mutable(fixture.placement_map);
    missing.bindings.pop();
    const reordered = mutable(fixture.placement_map);
    reordered.bindings.reverse();
    const duplicatedPlan = mutable(fixture.placement_plan);
    duplicatedPlan.placements[1].placement_id =
      duplicatedPlan.placements[0].placement_id;
    const duplicatedMap = mutable(fixture.placement_map);
    duplicatedMap.bindings[1].placement_id =
      duplicatedMap.bindings[0].placement_id;
    const nonCatalog = mutable(fixture.placement_map);
    nonCatalog.bindings[0].slot_id = 'missing-slot';

    for (const candidate of [
      {
        placement_plan: fixture.placement_plan,
        placement_map: missing,
      },
      {
        placement_plan: fixture.placement_plan,
        placement_map: reordered,
      },
      {
        placement_plan: duplicatedPlan,
        placement_map: duplicatedMap,
      },
      {
        placement_plan: fixture.placement_plan,
        placement_map: nonCatalog,
      },
    ]) {
      await expect(deriveGodotRuntimeBindingInventoryV1_1({
        projection: fixture.projected.projection,
        ...candidate,
      } as any)).rejects.toBeInstanceOf(
        DeriveGodotRuntimeBindingInventoryV1_1Error,
      );
    }
  });
});
