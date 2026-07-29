import {
  fingerprintWorldArtPlacementMapEnvelope,
  materializeWorldArtPlacementMapEnvelope,
  type WorldArtPlacementMap,
} from '../core/world-art-placement-map';
import {
  fingerprintWorldArtRuntimeProjection,
  materializeWorldArtRuntimeProjection,
  type WorldArtRuntimeAsset,
  type WorldArtRuntimeProjection,
  type WorldArtRuntimeRegion,
} from '../core/world-art-runtime-projection';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  type WorldLayoutPlan,
} from '../core/world-layout-plan';
import {
  fingerprintWorldVisualPlacementPlan,
  materializeWorldVisualPlacementPlan,
  type WorldVisualPlacementPlan,
} from '../core/world-visual-placement-plan';

export interface ValidateWorldArtRuntimeOverlayV1_1SourceInput {
  readonly projection: unknown;
  readonly layout_plan: unknown;
  readonly placement_plan: unknown;
  readonly placement_map: unknown;
}

export interface WorldArtRuntimePlacementBinding {
  readonly placement_id: string;
  readonly task_id: string;
  readonly slot_id: string;
  readonly role: string;
  readonly variant_id: string;
  readonly region: WorldArtRuntimeRegion;
  readonly cell_sha256: string;
}

export interface ValidatedWorldArtRuntimeOverlayV1_1Source {
  readonly projection: WorldArtRuntimeProjection;
  readonly layout_plan: WorldLayoutPlan;
  readonly placement_plan: WorldVisualPlacementPlan;
  readonly placement_map: WorldArtPlacementMap;
  readonly projection_sha256: string;
  readonly layout_plan_sha256: string;
  readonly placement_plan_sha256: string;
  readonly placement_map_sha256: string;
  readonly runtime_bindings: readonly WorldArtRuntimePlacementBinding[];
}

export type ValidateWorldArtRuntimeOverlayV1_1SourceErrorCode =
  | 'world-art-runtime-overlay-1.1-source.invalid-document'
  | 'world-art-runtime-overlay-1.1-source.invalid-source-binding'
  | 'world-art-runtime-overlay-1.1-source.invalid-placement-binding';

export class ValidateWorldArtRuntimeOverlayV1_1SourceError extends Error {
  constructor(
    readonly code: ValidateWorldArtRuntimeOverlayV1_1SourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ValidateWorldArtRuntimeOverlayV1_1SourceError';
  }
}

function fail(
  code: ValidateWorldArtRuntimeOverlayV1_1SourceErrorCode,
  message: string,
): never {
  throw new ValidateWorldArtRuntimeOverlayV1_1SourceError(code, message);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(
        'world-art-runtime-overlay-1.1-source.invalid-document',
        'Runtime overlay source contains a non-finite number.',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) {
    fail(
      'world-art-runtime-overlay-1.1-source.invalid-document',
      'Runtime overlay source contains an unsupported value.',
    );
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function expectedAtlasCell(
  asset: WorldArtRuntimeAsset,
  cellSize: readonly [number, number],
): Readonly<{
  column: number;
  row: number;
  column_span: number;
  row_span: number;
}> {
  return Object.freeze({
    column: asset.region.x / cellSize[0],
    row: asset.region.y / cellSize[1],
    column_span: asset.region.width / cellSize[0],
    row_span: asset.region.height / cellSize[1],
  });
}

function assetKey(taskId: string, slotId: string): string {
  return `${taskId}\u0000${slotId}`;
}

export async function validateWorldArtRuntimeOverlayV1_1Source(
  input: ValidateWorldArtRuntimeOverlayV1_1SourceInput,
): Promise<ValidatedWorldArtRuntimeOverlayV1_1Source> {
  let projection: WorldArtRuntimeProjection;
  let layout: WorldLayoutPlan;
  let map: WorldArtPlacementMap;
  try {
    [projection, layout, map] = await Promise.all([
      materializeWorldArtRuntimeProjection(input.projection),
      materializeWorldLayoutPlan(input.layout_plan),
      materializeWorldArtPlacementMapEnvelope(input.placement_map),
    ]);
  } catch (error) {
    return fail(
      'world-art-runtime-overlay-1.1-source.invalid-document',
      `Runtime overlay 1.1 source document is invalid: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  let layoutSha256: string;
  let plan: WorldVisualPlacementPlan;
  try {
    layoutSha256 = await fingerprintWorldLayoutPlan(layout);
    plan = await materializeWorldVisualPlacementPlan(input.placement_plan, layout);
  } catch (error) {
    return fail(
      'world-art-runtime-overlay-1.1-source.invalid-document',
      `Runtime overlay 1.1 placement plan is invalid: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

  const [projectionSha256, planSha256, mapSha256] = await Promise.all([
    fingerprintWorldArtRuntimeProjection(projection),
    fingerprintWorldVisualPlacementPlan(plan, layout),
    fingerprintWorldArtPlacementMapEnvelope(map),
  ]);

  if (
    projection.profile !== layout.profile
    || plan.profile !== layout.profile
    || map.profile !== layout.profile
    || projection.source.layout_plan_sha256 !== layoutSha256
    || plan.source.layout_plan_id !== layout.plan_id
    || plan.source.layout_plan_sha256 !== layoutSha256
    || map.source.layout_plan_id !== layout.plan_id
    || map.source.layout_plan_sha256 !== layoutSha256
    || map.source.placement_plan_id !== plan.plan_id
    || map.source.placement_plan_sha256 !== planSha256
    || map.source.production_art_plan_id !== projection.source.production_art_plan_id
    || map.source.production_art_plan_sha256
      !== projection.source.production_art_plan_sha256
    || map.source.requirements_sha256 !== projection.source.requirements_sha256
    || map.source.reviewed_slot_inventory_sha256
      !== projection.source.reviewed_slot_inventory_sha256
    || map.source.review_record_sha256 !== projection.source.review_record_sha256
  ) {
    fail(
      'world-art-runtime-overlay-1.1-source.invalid-source-binding',
      'Layout, placement documents, runtime projection, and human review are not source-bound.',
    );
  }

  if (
    plan.placements.length !== map.bindings.length
    || plan.placements.some((placement, index) =>
      placement.placement_id !== map.bindings[index]!.placement_id)
  ) {
    fail(
      'world-art-runtime-overlay-1.1-source.invalid-placement-binding',
      'Placement map must cover the canonical placement plan in exact order.',
    );
  }

  const assetByKey = new Map(projection.assets.map((asset) => [
    assetKey(asset.task_id, asset.slot_id),
    asset,
  ]));
  const imageCellByTask = new Map(projection.images.map((image) => [
    image.task_id,
    image.cell_size,
  ]));
  const runtimeBindings: WorldArtRuntimePlacementBinding[] = [];

  for (const [index, placement] of plan.placements.entries()) {
    const binding = map.bindings[index]!;
    const asset = assetByKey.get(assetKey(binding.task_id, binding.slot_id));
    const cellSize = imageCellByTask.get(binding.task_id);
    if (
      !asset
      || !cellSize
      || binding.requirement_id !== asset.requirement_id
      || binding.role !== placement.role
      || binding.role !== asset.role
      || binding.variant_id !== (placement.variant_id ?? 'canonical')
      || binding.variant_id !== asset.variant_id
      || binding.atlas_path !== asset.image_path
      || canonicalJson(binding.atlas_cell) !== canonicalJson(
        expectedAtlasCell(asset, cellSize),
      )
    ) {
      fail(
        'world-art-runtime-overlay-1.1-source.invalid-placement-binding',
        `Placement ${placement.placement_id} does not match its runtime catalog asset.`,
      );
    }
    runtimeBindings.push(Object.freeze({
      placement_id: placement.placement_id,
      task_id: asset.task_id,
      slot_id: asset.slot_id,
      role: asset.role,
      variant_id: asset.variant_id,
      region: asset.region,
      cell_sha256: asset.cell_sha256,
    }));
  }

  return Object.freeze({
    projection,
    layout_plan: layout,
    placement_plan: plan,
    placement_map: map,
    projection_sha256: projectionSha256,
    layout_plan_sha256: layoutSha256,
    placement_plan_sha256: planSha256,
    placement_map_sha256: mapSha256,
    runtime_bindings: Object.freeze(runtimeBindings),
  });
}
