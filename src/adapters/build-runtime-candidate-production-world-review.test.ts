import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import captureReceiptSchema
  from '../../schemas/mapsoo-godot-runtime-capture-receipt-1.1.schema.json';
import { encodeRgbaPng } from './canvas/encode-png';
import {
  BuildRuntimeCandidateProductionWorldReviewError,
  buildRuntimeCandidateProductionWorldReview,
} from './build-runtime-candidate-production-world-review';
import type {
  LoadedWorldArtRuntimeCandidateWorkspace,
} from './load-world-art-runtime-candidate-workspace';

const LAYOUT_SHA = 'a'.repeat(64);
const PROJECTION_SHA = 'b'.repeat(64);
const OVERLAY_SHA = 'c'.repeat(64);
const RECEIPT_SHA = 'd'.repeat(64);

function source(bytes: Uint8Array) {
  const snapshot = Uint8Array.from(bytes);
  return Object.freeze({
    bytes: snapshot.byteLength,
    readBytes: () => Uint8Array.from(snapshot),
  });
}

function png(red: number, green: number, blue: number): Uint8Array {
  return encodeRgbaPng(
    2,
    2,
    Uint8Array.from([
      red, green, blue, 255,
      red, green, blue, 255,
      red, green, blue, 255,
      red, green, blue, 255,
    ]),
  );
}

function avi(marker: number): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(bytes.buffer).setUint32(4, 8, true);
  bytes.set(new TextEncoder().encode('AVI '), 8);
  bytes[12] = marker;
  return bytes;
}

function candidate(): LoadedWorldArtRuntimeCandidateWorkspace {
  const assets = [
    ['terrain-slot', 'terrain.ground'],
    ['landmark-slot', 'structure.landmark'],
    ['hazard-slot', 'hazard.contact'],
    ['character-slot', 'character.player.atlas'],
    ['background-slot', 'background.far'],
    ['prop-slot', 'prop.decorative'],
  ].map(([slot_id, role], index) => ({
    task_id: `task-${index + 1}`,
    slot_id,
    role,
  }));
  const bindings = [
    {
      ...assets[0],
      usage_kind: 'terrain-material',
      usage_id: 'ground',
    },
    {
      ...assets[1],
      usage_kind: 'landmark',
      usage_id: 'landmark-1',
    },
    {
      ...assets[2],
      usage_kind: 'hazard',
      usage_id: 'hazard-binding',
    },
    {
      ...assets[3],
      usage_kind: 'character',
      usage_id: 'player-binding',
    },
  ];
  return {
    receipt: {
      candidate_id: 'world-art-candidate-0123456789abcdef',
      profile: 'topdown-farm',
      source: {
        layout_plan_sha256: LAYOUT_SHA,
        runtime_projection_sha256: PROJECTION_SHA,
      },
    },
    receipt_file: {
      sha256: RECEIPT_SHA,
    },
    runtime_projection: {
      profile: 'topdown-farm',
      projection_id: 'world-art-runtime-projection-0123456789abcdef',
      source: {
        layout_plan_sha256: LAYOUT_SHA,
      },
      assets,
      bindings,
      hazards: [{ hazard_id: 'hazard-1' }],
    },
    overlay: {
      sha256: OVERLAY_SHA,
      manifest: {
        profile: 'topdown-farm',
        overlay_id: 'world-art-runtime-overlay-fedcba9876543210',
        source: {
          layout_plan_sha256: LAYOUT_SHA,
          projection_sha256: PROJECTION_SHA,
        },
      },
      placement_plan: {
        profile: 'topdown-farm',
        plan_id: 'world-visual-placement-plan-0123456789abcdef',
        source: { layout_plan_sha256: LAYOUT_SHA },
        placements: [
          {
            placement_id: 'background-far',
            kind: 'depth-plane',
            role: 'background.far',
          },
          {
            placement_id: 'prop-decorative',
            kind: 'sprite',
            role: 'prop.decorative',
          },
        ],
      },
      placement_map: {
        profile: 'topdown-farm',
        source: {
          layout_plan_sha256: LAYOUT_SHA,
          placement_plan_id: 'world-visual-placement-plan-0123456789abcdef',
        },
        bindings: [
          {
            placement_id: 'background-far',
            task_id: 'task-5',
            slot_id: 'background-slot',
            role: 'background.far',
            variant_id: 'canonical',
          },
          {
            placement_id: 'prop-decorative',
            task_id: 'task-6',
            slot_id: 'prop-slot',
            role: 'prop.decorative',
            variant_id: 'canonical',
          },
        ],
      },
    },
  } as unknown as LoadedWorldArtRuntimeCandidateWorkspace;
}

async function input() {
  return {
    candidate: candidate(),
    layoutPlanSha256: LAYOUT_SHA,
    reviewId: 'runtime-candidate-review',
    godotVersion: '4.3' as const,
    godotExecutableSha256: 'e'.repeat(64),
    captureMetrics: {
      visible_terrain_materials: 1,
      visible_landmarks: 1,
      visible_hazards: 1,
      visible_characters: 1,
      applied_background_layers: 1,
      applied_prop_instances: 1,
      applied_structure_instances: 0,
      applied_effect_bindings: 0,
      applied_depth_planes: 0,
      route_reached: true as const,
      catalog_assets: 6,
      bound_catalog_assets: 6,
      runtime_bindings: 6,
      applied_runtime_bindings: 6,
      catalog_only_assets: 0,
      bindings_sha256:
        'a3c5193fa771364d10657378fd51d0a61413c5a9b9c659098b393cb1e25201a0',
      applied_bindings_sha256:
        'a3c5193fa771364d10657378fd51d0a61413c5a9b9c659098b393cb1e25201a0',
    },
    renderedWorldCapture: source(png(30, 40, 50)),
    rolePlacementOverlay: source(png(60, 70, 80)),
    artCollisionOverlay: source(png(90, 100, 110)),
    spawnExitTraversal: source(avi(1)),
    navigationTraversal: source(avi(2)),
  };
}

describe('buildRuntimeCandidateProductionWorldReview', () => {
  it('binds exact candidate coverage and five captures into the existing review', async () => {
    const built = await buildRuntimeCandidateProductionWorldReview(await input());
    const validate = new Ajv2020({ strict: true }).compile(captureReceiptSchema);

    expect(validate(built.captureReceipt), JSON.stringify(validate.errors))
      .toBe(true);
    expect(built.captureReceipt.runtime).toEqual({
      visible_terrain_materials: 1,
      visible_landmarks: 1,
      visible_hazards: 1,
      visible_characters: 1,
      applied_background_layers: 1,
      applied_prop_instances: 1,
      applied_structure_instances: 0,
      applied_effect_bindings: 0,
      applied_depth_planes: 0,
      route_reached: true,
      catalog_assets: 6,
      bound_catalog_assets: 6,
      runtime_bindings: 6,
      applied_runtime_bindings: 6,
      catalog_only_assets: 0,
      bindings_sha256:
        'a3c5193fa771364d10657378fd51d0a61413c5a9b9c659098b393cb1e25201a0',
      all_required_bindings_applied: true,
    });
    expect(built.review.evidence.at(-1)).toMatchObject({
      evidence_id: 'godot-runtime-capture-receipt',
      kind: 'headless-asset-controller-smoke',
      path: 'review-evidence/godot-runtime-capture-receipt.json',
    });
    expect(built.review.gates.at(-1)).toEqual({
      gate: 'human-review',
      status: 'pending',
      evidence_ids: [],
    });
    expect(built.review.release_decision).toBe('blocked');
    expect(built.captureReceipt.claims).toEqual({
      runtime: 'technical-pass',
      raspberry_pi: 'pending',
      production_ready: false,
      remote_request_count: 0,
    });
  });

  it('rejects a sentinel count that differs from the exact projection', async () => {
    const candidateInput = await input();
    await expect(buildRuntimeCandidateProductionWorldReview({
      ...candidateInput,
      captureMetrics: {
        ...candidateInput.captureMetrics,
        visible_landmarks: 2,
      },
    })).rejects.toBeInstanceOf(
      BuildRuntimeCandidateProductionWorldReviewError,
    );
  });

  it('rejects a same-count sentinel whose applied binding digest changed', async () => {
    const candidateInput = await input();
    await expect(buildRuntimeCandidateProductionWorldReview({
      ...candidateInput,
      captureMetrics: {
        ...candidateInput.captureMetrics,
        applied_bindings_sha256: 'f'.repeat(64),
      },
    })).rejects.toMatchObject({
      code: 'runtime-candidate-technical-review.invalid-capture',
    });
  });
});
