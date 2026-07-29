import {
  buildWorldArtRuntimeCandidate,
  type BuiltWorldArtRuntimeCandidate,
} from './world-art-runtime-candidate';
import type { WorldAssetProfile } from '../core/asset-profile';
import { buildAssetRequirementsV1_1 } from '../core/asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from '../core/confirmed-world-creation-intake';
import {
  buildProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../core/production-art-contract-v1-1';
import { buildProductionArtRunSetV1_1 } from '../core/production-art-run-set-v1-1';
import { buildPendingWorldArtSelectionReview } from '../core/world-art-selection-review';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from '../core/world-layout-constraints';
import {
  solveWorldLayoutPlanFromConstraints,
  type WorldLayoutPlan,
} from '../core/world-layout-plan';
import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import {
  normalizeProductionArtPngV1_1,
  type LocalProductionArtPngSourceV1_1,
  type NormalizedProductionArtResultV1_1,
} from '../adapters/normalize-production-art-png-v1-1';

export const WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER =
  'PRIVATE_RUNTIME_CANDIDATE_WORKSPACE';

const RIGHTS = Object.freeze({
  distribution: 'public' as const,
  license: 'CC0-1.0' as const,
});
const FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} premise`,
  worldview: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} worldview`,
  terrain: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} terrain`,
  geography: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} geography`,
  culture: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} culture`,
  ecology: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} ecology`,
  mood: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} mood`,
  art_direction: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} art`,
  traversal: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} traversal`,
  landmarks: `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} alpha, beta, gamma`,
});
const INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'standard',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'dangerous',
  landmark_labels: Object.freeze([
    `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} alpha`,
    `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} beta`,
    `${WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER} gamma`,
  ]),
});

export interface WorldArtRuntimeCandidateTestFixture {
  readonly built: BuiltWorldArtRuntimeCandidate;
  readonly layout: WorldLayoutPlan;
}

function reference(role: 'environment-style' | 'character') {
  return {
    id: `${role}-reference`,
    role,
    path: `private-input/${role}.png`,
    mediaType: 'image/png',
    byteLength: 4096,
    width: 512,
    height: 512,
    sha256: (role === 'character' ? 'a' : 'b').repeat(64),
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  } as const;
}

function occupied(task: ProductionArtTaskV1_1): ReadonlySet<string> {
  if (task.kind === 'character-animation-sheet') {
    return new Set((task.pose_mappings ?? []).map(({ grid_cell }) =>
      `${grid_cell.column}:${grid_cell.row}`));
  }
  const cells = new Set<string>();
  for (const { grid_rect: rect } of task.slot_mappings) {
    for (let row = rect.row; row < rect.row + rect.row_span; row += 1) {
      for (let column = rect.column; column < rect.column + rect.column_span; column += 1) {
        cells.add(`${column}:${row}`);
      }
    }
  }
  return cells;
}

function pngFor(task: ProductionArtTaskV1_1): Uint8Array {
  const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }
  occupied(task).forEach((key) => {
    const [column, row] = key.split(':').map(Number);
    const inset = (
      task.seam_policy === 'transparent-cell-padding'
      || task.alpha_policy === 'straight-alpha'
    ) ? Math.max(2, Math.floor(Math.min(cellWidth, cellHeight) / 10)) : 0;
    for (let y = inset; y < cellHeight - inset; y += 1) {
      for (let x = inset; x < cellWidth - inset; x += 1) {
        const offset = (
          (row * cellHeight + y) * width
          + column * cellWidth
          + x
        ) * 4;
        rgba[offset] = 70 + (column % 5) * 25;
        rgba[offset + 1] = 35 + (row % 5) * 20;
        rgba[offset + 2] = 180;
        rgba[offset + 3] = 255;
      }
    }
  });
  return encodeRgbaPng(width, height, rgba);
}

function localSource(
  task: ProductionArtTaskV1_1,
  bytes: Uint8Array,
): LocalProductionArtPngSourceV1_1 {
  const snapshot = Uint8Array.from(bytes);
  return Object.freeze({
    media_type: 'image/png' as const,
    width: task.target.width,
    height: task.target.height,
    byteLength: snapshot.byteLength,
    readBytes: () => Uint8Array.from(snapshot),
  });
}

function localReferences(task: ProductionArtTaskV1_1): readonly string[] {
  if (task.kind === 'scene-direction') {
    return [
      ...(task.reference_roles.includes('environment-style')
        ? ['environment-reference']
        : []),
      ...(task.reference_roles.includes('character') ? ['character-reference'] : []),
    ];
  }
  return [
    'approved-scene-direction',
    ...(task.reference_roles.includes('character') ? ['character-reference'] : []),
  ];
}

function approve(value: unknown): unknown {
  const review = JSON.parse(JSON.stringify(value));
  review.review_status = 'pass';
  review.declarations = {
    visual_quality_approved: true,
    atlas_integrity_approved: true,
    rights_and_redistribution_approved: true,
  };
  review.tasks.forEach((task: any) => {
    task.slots.forEach((slot: any) => {
      slot.decision = 'approved';
    });
  });
  return review;
}

export async function buildWorldArtRuntimeCandidateTestFixture(
  profile: WorldAssetProfile,
): Promise<WorldArtRuntimeCandidateTestFixture> {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `runtime-candidate-workspace-${profile}`,
    session_revision: 16,
    profile,
    target: 'raspberry-pi-4b',
    seed: `private-seed-${profile}`,
    facts: FACTS,
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: 'c'.repeat(64),
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: 'd'.repeat(64),
  });
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(intake, INTENT);
  const layout = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layout);
  const plan = await buildProductionArtPlanV1_1(requirements, RIGHTS);
  const normalizedResults: NormalizedProductionArtResultV1_1[] = [];
  for (const [index, task] of plan.tasks.entries()) {
    normalizedResults.push(await normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: `candidate-asset-${String(index + 1).padStart(3, '0')}`,
      source_reference_ids: localReferences(task),
      source: localSource(task, pngFor(task)),
    }));
  }
  const runSet = await buildProductionArtRunSetV1_1(
    plan,
    requirements,
    normalizedResults.map((result) => ({
      taskId: result.output.task_id,
      runDirectory: `model-runs/${result.output.task_id}`,
      output: result.output,
      evidence: {
        artifactPath: result.output.path,
        bytes: result.output.bytes,
        sha256: result.output.sha256,
      },
    })),
  );
  const reviewInput = {
    layout_plan: layout,
    asset_requirements: requirements,
    production_art_plan: plan,
    production_art_run_set: runSet,
  };
  const pending = await buildPendingWorldArtSelectionReview(reviewInput);
  const built = await buildWorldArtRuntimeCandidate({
    ...reviewInput,
    selection_review: approve(pending),
    normalized_results: normalizedResults,
  });
  return Object.freeze({ built, layout });
}
