import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import {
  normalizeProductionArtPngV1_1,
  type LocalProductionArtPngSourceV1_1,
} from './normalize-production-art-png-v1-1';
import type { WorldAssetProfile } from '../core/asset-profile';
import { buildAssetRequirementsV1_1 } from '../core/asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from '../core/confirmed-world-creation-intake';
import {
  buildProductionArtPlanV1_1,
  fingerprintProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../core/production-art-contract-v1-1';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from '../core/world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from '../core/world-layout-plan';

const PRIVATE_MARKER = 'PRIVATE_DO_NOT_EXPORT';
const RIGHTS = Object.freeze({
  distribution: 'public' as const,
  license: 'CC0-1.0' as const,
});
const FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: `${PRIVATE_MARKER} premise`,
  worldview: `${PRIVATE_MARKER} worldview`,
  terrain: `${PRIVATE_MARKER} terrain`,
  geography: `${PRIVATE_MARKER} geography`,
  culture: `${PRIVATE_MARKER} culture`,
  ecology: `${PRIVATE_MARKER} ecology`,
  mood: `${PRIVATE_MARKER} mood`,
  art_direction: `${PRIVATE_MARKER} art`,
  traversal: `${PRIVATE_MARKER} traversal`,
  landmarks: `${PRIVATE_MARKER} alpha, beta, gamma`,
});
const INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'standard',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'dangerous',
  landmark_labels: Object.freeze([
    `${PRIVATE_MARKER} alpha`,
    `${PRIVATE_MARKER} beta`,
    `${PRIVATE_MARKER} gamma`,
  ]),
});

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

async function fixture(profile: WorldAssetProfile) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `normalizer-v11-${profile}`,
    session_revision: 11,
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
  return { requirements, plan };
}

function occupied(task: ProductionArtTaskV1_1): ReadonlySet<string> {
  if (task.kind === 'character-animation-sheet') {
    return new Set((task.pose_mappings ?? []).map(({ grid_cell: cell }) =>
      `${cell.column}:${cell.row}`));
  }
  const cells = new Set<string>();
  task.slot_mappings.forEach(({ grid_rect: rect }) => {
    for (let row = rect.row; row < rect.row + rect.row_span; row += 1) {
      for (let column = rect.column; column < rect.column + rect.column_span; column += 1) {
        cells.add(`${column}:${row}`);
      }
    }
  });
  return cells;
}

function pngFor(
  task: ProductionArtTaskV1_1,
  mutate?: (rgba: Uint8Array, occupiedCells: ReadonlySet<string>) => void,
): Uint8Array {
  const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }
  const cells = occupied(task);
  cells.forEach((key) => {
    const [column, row] = key.split(':').map(Number);
    const inset = task.seam_policy === 'transparent-cell-padding' ? 2 : 0;
    for (let y = inset; y < cellHeight - inset; y += 1) {
      for (let x = inset; x < cellWidth - inset; x += 1) {
        const offset = (
          (row * cellHeight + y) * width
          + column * cellWidth
          + x
        ) * 4;
        rgba[offset] = 210;
        rgba[offset + 1] = 40;
        rgba[offset + 2] = 80;
        rgba[offset + 3] = 255;
      }
    }
  });
  mutate?.(rgba, cells);
  return encodeRgbaPng(width, height, rgba);
}

function localSource(task: ProductionArtTaskV1_1, bytes: Uint8Array):
LocalProductionArtPngSourceV1_1 {
  const snapshot = Uint8Array.from(bytes);
  return Object.freeze({
    media_type: 'image/png' as const,
    width: task.target.width,
    height: task.target.height,
    byteLength: snapshot.byteLength,
    readBytes: () => Uint8Array.from(snapshot),
  });
}

function references(task: ProductionArtTaskV1_1): readonly string[] {
  return task.kind === 'character-animation-sheet'
    ? ['approved-scene-direction', 'character-reference']
    : ['approved-scene-direction'];
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('normalizeProductionArtPngV1_1', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('normalizes verified local Plan 1.1 slot geometry for %s', async (profile) => {
    const { requirements, plan } = await fixture(profile);
    const task = plan.tasks.find(({ kind }) => kind === 'opaque-tile-sheet');
    if (!task) throw new Error(`Missing terrain task for ${profile}.`);
    const bytes = pngFor(task);
    const result = await normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: `${profile}-terrain-candidate`,
      source_reference_ids: references(task),
      source: localSource(task, bytes),
    });

    expect(result.output.source.plan_sha256)
      .toBe(await fingerprintProductionArtPlanV1_1(plan, requirements));
    expect(result.output.slot_ids).toEqual(task.slot_mappings.map(({ slot_id: id }) => id));
    expect(result.evidence.slots).toHaveLength(task.slot_mappings.length);
    expect(result.evidence.slots.every(({ cell_sha256: digest }) =>
      /^[a-f0-9]{64}$/u.test(digest))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(result.evidence)).not.toContain('provider_request_id');
    expect(result.normalized.readBytes()).toEqual(result.normalized.readBytes());
  });

  it('checks character pose cells instead of treating the whole character slot as occupied', async () => {
    const { requirements, plan } = await fixture('topdown-farm');
    const task = plan.tasks.find(({ kind }) => kind === 'character-animation-sheet');
    if (!task) throw new Error('Missing character task.');
    const result = await normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: 'topdown-character-candidate',
      source_reference_ids: references(task),
      source: localSource(task, pngFor(task)),
    });
    expect(result.evidence.slots[0].occupied_cell_count)
      .toBe(new Set(task.pose_mappings?.map(({ grid_cell: cell }) =>
        `${cell.column}:${cell.row}`)).size);
    expect(result.evidence.postprocess.character_pose_cells_checked).toBe(true);
  });

  it('rejects a non-canonical task and source-byte metadata tampering', async () => {
    const { requirements, plan } = await fixture('side-platformer');
    const task = plan.tasks.find(({ kind }) => kind === 'opaque-tile-sheet')!;
    const bytes = pngFor(task);
    const changedTask = mutable(task);
    changedTask.prompt = `${changedTask.prompt} changed`;
    await expect(normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task: changedTask,
      asset_id: 'tampered-task',
      source_reference_ids: references(task),
      source: localSource(task, bytes),
    })).rejects.toThrow(/exactly match/u);

    const source = localSource(task, bytes);
    await expect(normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: 'tampered-bytes',
      source_reference_ids: references(task),
      source: { ...source, byteLength: source.byteLength + 1 },
    })).rejects.toThrow(/bytes changed/u);
  });

  it('fails closed when a mapped cell is empty or an unmapped cell contains pixels', async () => {
    const { requirements, plan } = await fixture('layered-depth-2d');
    const task = plan.tasks.find(({ kind }) => kind === 'opaque-tile-sheet')!;
    const cellWidth = task.target.cell_width;
    const cellHeight = task.target.cell_height;
    const clearMapped = pngFor(task, (rgba, cells) => {
      const [key] = cells;
      const [column, row] = key.split(':').map(Number);
      for (let y = 0; y < cellHeight; y += 1) {
        for (let x = 0; x < cellWidth; x += 1) {
          const offset = (
            (row * cellHeight + y) * task.target.width
            + column * cellWidth
            + x
          ) * 4;
          rgba[offset] = 0;
          rgba[offset + 1] = 255;
          rgba[offset + 2] = 0;
          rgba[offset + 3] = 255;
        }
      }
    });
    await expect(normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: 'empty-cell',
      source_reference_ids: references(task),
      source: localSource(task, clearMapped),
    })).rejects.toThrow(/is empty/u);

    const columns = task.target.width / cellWidth;
    const rows = task.target.height / cellHeight;
    const filledUnmapped = pngFor(task, (rgba, cells) => {
      let target: string | undefined;
      for (let row = 0; row < rows && target === undefined; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          if (!cells.has(`${column}:${row}`)) {
            target = `${column}:${row}`;
            break;
          }
        }
      }
      if (!target) throw new Error('Fixture task has no unmapped cell.');
      const [column, row] = target.split(':').map(Number);
      const offset = (
        (row * cellHeight + Math.floor(cellHeight / 2)) * task.target.width
        + column * cellWidth
        + Math.floor(cellWidth / 2)
      ) * 4;
      rgba[offset] = 210;
      rgba[offset + 1] = 40;
      rgba[offset + 2] = 80;
      rgba[offset + 3] = 255;
    });
    await expect(normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: 'unmapped-cell',
      source_reference_ids: references(task),
      source: localSource(task, filledUnmapped),
    })).rejects.toThrow(/must remain transparent/u);
  });
});
