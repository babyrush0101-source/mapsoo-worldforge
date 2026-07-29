import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import {
  loadProductionArtRunSetV1_1Workspace,
  type LoadProductionArtRunSetV1_1WorkspaceInput,
} from './load-production-art-run-set-v1-1-workspace';
import {
  normalizeProductionArtPngV1_1,
  type LocalProductionArtPngSourceV1_1,
  type NormalizedProductionArtResultV1_1,
} from './normalize-production-art-png-v1-1';
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
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from '../core/world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from '../core/world-layout-plan';

const PRIVATE_SIDECAR_MARKER = 'PRIVATE_CHARACTER_PROJECTION_DO_NOT_READ';
const RIGHTS = Object.freeze({
  distribution: 'public' as const,
  license: 'CC0-1.0' as const,
});
const FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'A synthetic production-art workspace.',
  worldview: 'Four profiles share one deterministic fixture.',
  terrain: 'Mixed terrain.',
  geography: 'A compact navigable region.',
  culture: 'A small settlement.',
  ecology: 'Temperate plants and animals.',
  mood: 'Hopeful.',
  art_direction: 'Original readable pixel art.',
  traversal: 'A loop route.',
  landmarks: 'Gate, garden, tower.',
});
const INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'standard',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'guarded',
  landmark_labels: Object.freeze(['Gate', 'Garden', 'Tower']),
});

interface WorkspaceFixture {
  readonly root: string;
  readonly input: LoadProductionArtRunSetV1_1WorkspaceInput;
  readonly expected: readonly NormalizedProductionArtResultV1_1[];
}

const temporaryRoots: string[] = [];

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
        rgba[offset + 1] = 40 + (row % 5) * 25;
        rgba[offset + 2] = 190;
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fixture(profile: WorldAssetProfile): Promise<WorkspaceFixture> {
  const root = await mkdtemp(join(tmpdir(), `mapsoo-v11-workspace-${profile}-`));
  temporaryRoots.push(root);
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `workspace-loader-${profile}`,
    session_revision: 14,
    profile,
    target: 'raspberry-pi-4b',
    seed: `workspace-loader-seed-${profile}`,
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
  const results: NormalizedProductionArtResultV1_1[] = [];
  for (const [index, task] of plan.tasks.entries()) {
    results.push(await normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: `${profile}-workspace-${String(index + 1).padStart(3, '0')}`,
      source_reference_ids: localReferences(task),
      source: localSource(task, pngFor(task)),
    }));
  }
  const runSet = await buildProductionArtRunSetV1_1(
    plan,
    requirements,
    results.map((result) => ({
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
  for (const result of results) {
    const directory = join(root, 'model-runs', result.output.task_id);
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(join(directory, 'source.png'), result.source.readBytes()),
      writeFile(join(directory, 'normalized.png'), result.normalized.readBytes()),
      writeJson(join(directory, 'output.json'), result.output),
      writeJson(join(directory, 'evidence.json'), result.evidence),
    ]);
    if (result.output.roles.some((role) => role.startsWith('character.'))) {
      await writeJson(join(directory, 'character-profile-projection.json'), {
        private_marker: PRIVATE_SIDECAR_MARKER,
      });
    }
  }
  return {
    root,
    input: { requirements, plan, runSet, modelRunsRoot: root },
    expected: results,
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

const TEST_TIMEOUT_MS = 45_000;

describe('loadProductionArtRunSetV1_1Workspace', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('loads a complete read-only synthetic %s workspace', async (profile) => {
    const base = await fixture(profile);
    const loaded = await loadProductionArtRunSetV1_1Workspace(base.input);

    expect(loaded.requirements).toEqual(base.input.requirements);
    expect(loaded.plan).toEqual(base.input.plan);
    expect(loaded.runSet).toEqual(base.input.runSet);
    expect(loaded.normalizedResults.map(({ output }) => output.task_id))
      .toEqual(base.expected.map(({ output }) => output.task_id));
    expect(JSON.stringify(loaded)).not.toContain(PRIVATE_SIDECAR_MARKER);
    expect(Object.isFrozen(loaded.normalizedResults)).toBe(true);

    const first = loaded.normalizedResults[0].normalized.readBytes();
    const originalFirstByte = first[0];
    first[0] ^= 0xff;
    expect(loaded.normalizedResults[0].normalized.readBytes()[0]).toBe(originalFirstByte);
  }, TEST_TIMEOUT_MS);

  it('rejects missing, extra, output-tampered, and slot-evidence-tampered files', async () => {
    const base = await fixture('side-platformer');
    const run = base.input.runSet as Awaited<ReturnType<typeof buildProductionArtRunSetV1_1>>;
    const directory = join(base.root, ...run.runs[0].run_directory.split('/'));
    const extraPath = join(directory, 'provider-response.json');
    await writeJson(extraPath, { private: true });
    await expect(loadProductionArtRunSetV1_1Workspace(base.input))
      .rejects.toMatchObject({
        code: 'production-art-workspace-1.1.invalid-inventory',
      });
    await rm(extraPath);

    const outputPath = join(directory, 'output.json');
    const originalOutput = await readFile(outputPath);
    const changedOutput = JSON.parse(originalOutput.toString('utf8'));
    changedOutput.sha256 = '0'.repeat(64);
    await writeJson(outputPath, changedOutput);
    await expect(loadProductionArtRunSetV1_1Workspace(base.input))
      .rejects.toMatchObject({
        code: 'production-art-workspace-1.1.invalid-output',
      });
    await writeFile(outputPath, Uint8Array.from(originalOutput));

    const evidencePath = join(directory, 'evidence.json');
    const originalEvidence = await readFile(evidencePath);
    const changedEvidence = JSON.parse(originalEvidence.toString('utf8'));
    changedEvidence.slots[0].cell_sha256 = '0'.repeat(64);
    await writeJson(evidencePath, changedEvidence);
    await expect(loadProductionArtRunSetV1_1Workspace(base.input))
      .rejects.toMatchObject({
        code: 'production-art-workspace-1.1.invalid-evidence',
      });
    await writeFile(evidencePath, Uint8Array.from(originalEvidence));

    const hiddenEvidence = join(directory, 'evidence.missing');
    await rename(evidencePath, hiddenEvidence);
    await expect(loadProductionArtRunSetV1_1Workspace(base.input))
      .rejects.toMatchObject({
        code: 'production-art-workspace-1.1.invalid-inventory',
      });
    await rename(hiddenEvidence, evidencePath);
  }, TEST_TIMEOUT_MS);

  it('rejects realpath aliases and symlink escapes before reading task files', async () => {
    const base = await fixture('topdown-farm');
    const runSet = base.input.runSet as Awaited<
      ReturnType<typeof buildProductionArtRunSetV1_1>
    >;
    const firstDirectory = join(base.root, ...runSet.runs[0].run_directory.split('/'));
    const secondDirectory = join(base.root, ...runSet.runs[1].run_directory.split('/'));
    const backupDirectory = `${secondDirectory}-backup`;
    await rename(secondDirectory, backupDirectory);
    try {
      await symlink(
        firstDirectory,
        secondDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(loadProductionArtRunSetV1_1Workspace(base.input))
        .rejects.toMatchObject({
          code: 'production-art-workspace-1.1.path-alias',
        });
      await unlink(secondDirectory);

      const outside = await mkdtemp(join(tmpdir(), 'mapsoo-v11-workspace-outside-'));
      temporaryRoots.push(outside);
      await symlink(
        outside,
        secondDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(loadProductionArtRunSetV1_1Workspace(base.input))
        .rejects.toMatchObject({
          code: 'production-art-workspace-1.1.path-escape',
        });
      await unlink(secondDirectory);
    } finally {
      await unlink(secondDirectory).catch(() => undefined);
      await mkdir(dirname(secondDirectory), { recursive: true });
      await rename(backupDirectory, secondDirectory).catch(() => undefined);
    }
  }, TEST_TIMEOUT_MS);
});
