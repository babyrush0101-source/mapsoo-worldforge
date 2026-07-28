import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import captureReceiptSchema
  from '../../schemas/mapsoo-godot-runtime-capture-receipt-1.0.schema.json';
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
    },
  } as unknown as LoadedWorldArtRuntimeCandidateWorkspace;
}

function input() {
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
      route_reached: true as const,
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
    const built = await buildRuntimeCandidateProductionWorldReview(input());
    const validate = new Ajv2020({ strict: true }).compile(captureReceiptSchema);

    expect(validate(built.captureReceipt), JSON.stringify(validate.errors))
      .toBe(true);
    expect(built.captureReceipt.runtime).toEqual({
      visible_terrain_materials: 1,
      visible_landmarks: 1,
      visible_hazards: 1,
      visible_characters: 1,
      route_reached: true,
      catalog_assets: 6,
      runtime_bindings: 4,
      catalog_only_assets: 2,
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
    await expect(buildRuntimeCandidateProductionWorldReview({
      ...input(),
      captureMetrics: {
        ...input().captureMetrics,
        visible_landmarks: 2,
      },
    })).rejects.toBeInstanceOf(
      BuildRuntimeCandidateProductionWorldReviewError,
    );
  });
});
