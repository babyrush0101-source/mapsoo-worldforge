import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  BuildWorldArtRuntimeOverlayV1_1Error,
  buildWorldArtRuntimeOverlayV1_1Zip,
  type BuildWorldArtRuntimeOverlayV1_1Input,
} from './build-world-art-runtime-overlay-v1-1';
import { encodeRgbaPng } from './canvas/encode-png';
import type {
  ProjectedReviewedWorldArtImage,
  ProjectedReviewedWorldArtVariants,
} from './project-reviewed-world-art-variants';
import type { WorldAssetProfile } from '../core/asset-profile';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from '../core/confirmed-world-creation-intake';
import {
  materializeWorldArtPlacementMapEnvelope,
  type WorldArtPlacementMap,
} from '../core/world-art-placement-map';
import { buildWorldArtRuntimeProjection } from '../core/world-art-runtime-projection';
import {
  buildWorldLayoutPlanFromConfirmedIntake,
  fingerprintWorldLayoutPlan,
} from '../core/world-layout-plan';
import {
  buildWorldVisualPlacementPlan,
  fingerprintWorldVisualPlacementPlan,
} from '../core/world-visual-placement-plan';

const PRIVATE_MARKER = 'PRIVATE_OVERLAY_1_1_DO_NOT_EXPORT';
const FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: `${PRIVATE_MARKER} traveler restores a route.`,
  worldview: `${PRIVATE_MARKER} paths change cooperation.`,
  terrain: `${PRIVATE_MARKER} readable ridges, water, terraces, and gardens.`,
  geography: `${PRIVATE_MARKER} gate, market, workshop, homes, and beacon.`,
  culture: `${PRIVATE_MARKER} crafts, lanterns, meals, and performances.`,
  ecology: `${PRIVATE_MARKER} trees, reeds, flowers, birds, moss, and pools.`,
  mood: `${PRIVATE_MARKER} hopeful exploration with gentle mystery.`,
  art_direction: `${PRIVATE_MARKER} original pixel art and clear silhouettes.`,
  traversal: `${PRIVATE_MARKER} start, cross, visit landmarks, and exit.`,
  landmarks: `${PRIVATE_MARKER} gate, market, workshop, beacon`,
});

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Value(value: unknown): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(canonicalJson(value)));
}

async function withMapId(
  value: Omit<WorldArtPlacementMap, 'map_id'>,
): Promise<WorldArtPlacementMap> {
  return materializeWorldArtPlacementMapEnvelope({
    ...value,
    map_id: `world-art-placement-map-${(await sha256Value({
      profile: value.profile,
      source: value.source,
      bindings: value.bindings,
    })).slice(0, 16)}`,
  });
}

async function fixture(
  profile: WorldAssetProfile,
): Promise<BuildWorldArtRuntimeOverlayV1_1Input> {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `overlay-1-1-${profile}`,
    session_revision: 6,
    profile,
    target: 'raspberry-pi-4b',
    seed: `overlay-1-1-seed-${profile}`,
    facts: FACTS,
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: 'c'.repeat(64),
    },
    references: [
      {
        id: 'environment-reference',
        role: 'environment-style',
        path: 'private-input/environment.png',
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
        path: 'private-input/character.png',
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
  const layout = await buildWorldLayoutPlanFromConfirmedIntake(intake);
  const layoutSha256 = await fingerprintWorldLayoutPlan(layout);
  const ySort = profile !== 'side-platformer';
  const placementPlan = await buildWorldVisualPlacementPlan(layout, [
    {
      placement_id: 'tree-a',
      kind: 'sprite',
      role: 'prop.tree',
      variant_id: 'canonical',
      anchor: { kind: 'logical-point', x: 1, y: 1 },
      render: { layer: 'world', order: 1, y_sort: ySort },
    },
    {
      placement_id: 'tree-b',
      kind: 'sprite',
      role: 'prop.tree',
      variant_id: 'canonical',
      anchor: { kind: 'logical-point', x: 2, y: 1 },
      render: { layer: 'world', order: 2, y_sort: ySort },
    },
  ]);
  const placementPlanSha256 = await fingerprintWorldVisualPlacementPlan(
    placementPlan,
    layout,
  );
  const png = encodeRgbaPng(4, 2, Uint8Array.from([
    80, 120, 180, 255, 80, 120, 180, 255,
    40, 180, 80, 255, 40, 180, 80, 255,
    80, 120, 180, 255, 80, 120, 180, 255,
    40, 180, 80, 255, 40, 180, 80, 255,
  ]));
  const pngSha256 = await sha256Bytes(png);
  const taskId = 'world-sheet-001';
  const terrainSlotId = 'requirement-001-canonical';
  const treeSlotId = 'requirement-002-canonical';
  const imagePath = `production-art/${profile}/${taskId}.png`;
  const productionPlanId = 'production-art-plan-fixture';
  const productionPlanSha256 = '3'.repeat(64);
  const requirementsSha256 = '4'.repeat(64);
  const inventorySha256 = '6'.repeat(64);
  const reviewSha256 = '7'.repeat(64);
  const projection = await buildWorldArtRuntimeProjection({
    schema_version: '1.0.0',
    document_type: 'world-art-runtime-projection',
    profile,
    source: {
      variant_map_id: 'variant-map-fixture',
      variant_map_sha256: '1'.repeat(64),
      layout_plan_sha256: layoutSha256,
      production_art_plan_id: productionPlanId,
      production_art_plan_sha256: productionPlanSha256,
      requirements_sha256: requirementsSha256,
      run_set_sha256: '5'.repeat(64),
      reviewed_slot_inventory_sha256: inventorySha256,
      review_record_sha256: reviewSha256,
    },
    rights: {
      distribution: 'public',
      license: 'CC0-1.0',
    },
    images: [{
      task_id: taskId,
      path: imagePath,
      media_type: 'image/png',
      bytes: png.byteLength,
      sha256: pngSha256,
      output_sha256: '8'.repeat(64),
      width: 4,
      height: 2,
      cell_size: [2, 2],
      pivot: [1, 2],
      alpha_policy: 'straight-alpha',
    }],
    assets: [
      {
        task_id: taskId,
        slot_id: terrainSlotId,
        requirement_id: 'requirement-001',
        role: 'terrain.ground',
        variant_id: 'canonical',
        image_path: imagePath,
        region: { x: 0, y: 0, width: 2, height: 2 },
        cell_sha256: '9'.repeat(64),
        poses: [],
      },
      {
        task_id: taskId,
        slot_id: treeSlotId,
        requirement_id: 'requirement-002',
        role: 'prop.tree',
        variant_id: 'canonical',
        image_path: imagePath,
        region: { x: 2, y: 0, width: 2, height: 2 },
        cell_sha256: '0'.repeat(64),
        poses: [],
      },
    ],
    bindings: [{
      usage_kind: 'terrain-material',
      usage_id: 'ground',
      task_id: taskId,
      slot_id: terrainSlotId,
      role: 'terrain.ground',
      variant_id: 'canonical',
      image_path: imagePath,
      region: { x: 0, y: 0, width: 2, height: 2 },
      cell_sha256: '9'.repeat(64),
      poses: [],
    }],
    hazards: [],
  });
  const snapshot = Uint8Array.from(png);
  const image: ProjectedReviewedWorldArtImage = Object.freeze({
    task_id: taskId,
    path: imagePath,
    media_type: 'image/png',
    bytes: snapshot.byteLength,
    sha256: pngSha256,
    readBytes: () => Uint8Array.from(snapshot),
  });
  const projected: ProjectedReviewedWorldArtVariants = Object.freeze({
    projection,
    images: Object.freeze([image]),
  });
  const source = Object.freeze({
    layout_plan_id: layout.plan_id,
    layout_plan_sha256: layoutSha256,
    placement_plan_id: placementPlan.plan_id,
    placement_plan_sha256: placementPlanSha256,
    requirements_sha256: requirementsSha256,
    production_art_plan_id: productionPlanId,
    production_art_plan_sha256: productionPlanSha256,
    reviewed_slot_inventory_sha256: inventorySha256,
    review_record_sha256: reviewSha256,
  });
  const bindings = Object.freeze(['tree-a', 'tree-b'].map((placementId) =>
    Object.freeze({
      placement_id: placementId,
      task_id: taskId,
      slot_id: treeSlotId,
      requirement_id: 'requirement-002',
      role: 'prop.tree',
      variant_id: 'canonical',
      atlas_path: imagePath,
      atlas_cell: Object.freeze({
        column: 1,
        row: 0,
        column_span: 1,
        row_span: 1,
      }),
    })));
  const placementMap = await withMapId({
    schema_version: '1.0.0',
    document_type: 'world-art-placement-map',
    profile,
    source,
    bindings,
  });
  return Object.freeze({
    projected,
    layout_plan: layout,
    placement_plan: placementPlan,
    placement_map: placementMap,
  });
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('buildWorldArtRuntimeOverlayV1_1Zip', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('builds one deterministic placement-aware overlay for %s', async (profile) => {
    const input = await fixture(profile);
    const first = await buildWorldArtRuntimeOverlayV1_1Zip(input);
    const second = await buildWorldArtRuntimeOverlayV1_1Zip(input);

    expect(first.readBytes()).toEqual(second.readBytes());
    expect(first.manifest.schema_version).toBe('1.1.0');
    expect(first.manifest.profile).toBe(profile);
    expect(first.manifest.files).toHaveLength(input.projected.images.length + 3);
    expect(first.filename).toBe(`${first.manifest.overlay_id}.zip`);

    const archive = await JSZip.loadAsync(first.readBytes(), { checkCRC32: true });
    const names = Object.keys(archive.files);
    const root = first.manifest.overlay_id;
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(names).toHaveLength(first.manifest.files.length + 1);
    expect(names.every((name) => name.startsWith(`${root}/`))).toBe(true);
    expect(names).toEqual(expect.arrayContaining([
      `${root}/world-art-placement-map.json`,
      `${root}/world-art-runtime-overlay.json`,
      `${root}/world-art-runtime-projection.json`,
      `${root}/world-visual-placement-plan.json`,
    ]));
    const archiveText = await Promise.all(names.map((name) =>
      archive.file(name)!.async('string').catch(() => '')));
    expect(archiveText.join('\n')).not.toContain(PRIVATE_MARKER);
  });

  it('rejects placement-plan/map/catalog drift even when the map id is recomputed', async () => {
    const input = await fixture('topdown-farm');
    const map = mutable(input.placement_map);
    map.bindings[0] = {
      ...map.bindings[0],
      slot_id: 'requirement-001-canonical',
      requirement_id: 'requirement-001',
      role: 'terrain.ground',
      atlas_cell: { column: 0, row: 0, column_span: 1, row_span: 1 },
    };
    delete map.map_id;
    const recomputed = await withMapId(map);

    await expect(buildWorldArtRuntimeOverlayV1_1Zip({
      ...input,
      placement_map: recomputed,
    })).rejects.toMatchObject({
      code: 'world-art-runtime-overlay-1.1-build.invalid-placement',
    } satisfies Partial<BuildWorldArtRuntimeOverlayV1_1Error>);
  });

  it('rejects another layout, missing placement bindings, and changed image bytes', async () => {
    const input = await fixture('topdown-farm');
    const other = await fixture('isometric-action');
    const missing = mutable(input.placement_map);
    missing.bindings.pop();
    delete missing.map_id;
    const missingWithId = await withMapId(missing);
    const image = input.projected.images[0]!;
    const changedImage = {
      ...input.projected,
      images: [{
        ...image,
        readBytes: () => {
          const bytes = image.readBytes();
          bytes[bytes.length - 1] ^= 1;
          return bytes;
        },
      }],
    };

    for (const candidate of [
      { ...input, layout_plan: other.layout_plan },
      { ...input, placement_map: missingWithId },
      { ...input, projected: changedImage },
    ]) {
      await expect(
        buildWorldArtRuntimeOverlayV1_1Zip(candidate),
      ).rejects.toBeInstanceOf(BuildWorldArtRuntimeOverlayV1_1Error);
    }
  });
});
