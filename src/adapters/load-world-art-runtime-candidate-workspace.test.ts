import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import receiptSchema
  from '../../schemas/mapsoo-world-art-runtime-candidate-receipt-1.0.schema.json';
import { buildWorldArtRuntimeCandidate } from '../app/world-art-runtime-candidate';
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
  buildPendingWorldArtSelectionReview,
} from '../core/world-art-selection-review';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from '../core/world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from '../core/world-layout-plan';
import { encodeRgbaPng } from './canvas/encode-png';
import {
  normalizeProductionArtPngV1_1,
  type LocalProductionArtPngSourceV1_1,
  type NormalizedProductionArtResultV1_1,
} from './normalize-production-art-png-v1-1';
import {
  LoadWorldArtRuntimeCandidateWorkspaceError,
  loadWorldArtRuntimeCandidateWorkspace,
} from './load-world-art-runtime-candidate-workspace';

const PRIVATE_MARKER = 'PRIVATE_RUNTIME_CANDIDATE_WORKSPACE';
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
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
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

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(value)}\n`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function approve(value: unknown): any {
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

async function candidate(profile: WorldAssetProfile) {
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
  return buildWorldArtRuntimeCandidate({
    ...reviewInput,
    selection_review: approve(pending),
    normalized_results: normalizedResults,
  });
}

async function workspace(profile: WorldAssetProfile): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), `mapsoo-runtime-candidate-${profile}-`));
  roots.push(root);
  const directory = resolve(root, 'candidate');
  await mkdir(directory);
  const built = await candidate(profile);
  await Promise.all(built.files.map((file) =>
    writeFile(resolve(directory, file.path), file.readBytes())));
  return directory;
}

async function updateReceiptForArtifact(
  directory: string,
  artifactPath: string,
): Promise<void> {
  const receiptPath = resolve(directory, 'runtime-candidate-receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const bytes = Uint8Array.from(await readFile(resolve(directory, artifactPath)));
  const artifact = receipt.artifacts.find(({ path }: { path: string }) =>
    path === artifactPath);
  artifact.bytes = bytes.byteLength;
  artifact.sha256 = await sha256(bytes);
  const identity = {
    profile: receipt.profile,
    source: receipt.source,
    rights: receipt.rights,
    artifacts: receipt.artifacts,
  };
  receipt.candidate_id = `world-art-candidate-${(
    await sha256(canonicalBytes(identity))
  ).slice(0, 16)}`;
  await writeFile(receiptPath, canonicalBytes(receipt));
}

describe('loadWorldArtRuntimeCandidateWorkspace', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('loads and cross-binds the exact six artifacts for %s', async (profile) => {
    const directory = await workspace(profile);
    const loaded = await loadWorldArtRuntimeCandidateWorkspace(directory);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(receiptSchema);

    expect(validate(loaded.receipt), JSON.stringify(validate.errors)).toBe(true);
    expect(loaded.receipt.profile).toBe(profile);
    expect(loaded.artifacts).toHaveLength(6);
    expect(loaded.overlay.manifest.profile).toBe(profile);
    expect(loaded.runtime_projection.profile).toBe(profile);
    const first = loaded.overlay.readBytes();
    const replay = loaded.overlay.readBytes();
    first[0] ^= 0xff;
    expect(loaded.overlay.readBytes()).toEqual(replay);
    const artifactFirst = loaded.artifacts[0]!.readBytes();
    const artifactReplay = loaded.artifacts[0]!.readBytes();
    artifactFirst[0] ^= 0xff;
    expect(loaded.artifacts[0]!.readBytes()).toEqual(artifactReplay);
    expect(JSON.stringify(loaded)).not.toContain(directory);
  }, 30_000);

  it('rejects changed artifacts, cross-binding tampering, and corrupt overlay archives', async () => {
    const changedDirectory = await workspace('topdown-farm');
    const changedPath = resolve(changedDirectory, 'world-art-variant-selections.json');
    const changedBytes = Uint8Array.from(await readFile(changedPath));
    changedBytes[changedBytes.length - 2] ^= 1;
    await writeFile(changedPath, changedBytes);
    await expect(loadWorldArtRuntimeCandidateWorkspace(changedDirectory))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.integrity' });

    const bindingDirectory = await workspace('side-platformer');
    const reviewPath = resolve(bindingDirectory, 'world-art-selection-review.json');
    const review = JSON.parse(await readFile(reviewPath, 'utf8'));
    review.tasks[0].artifact_sha256 = '0'.repeat(64);
    await writeFile(reviewPath, canonicalBytes(review));
    await updateReceiptForArtifact(bindingDirectory, 'world-art-selection-review.json');
    await expect(loadWorldArtRuntimeCandidateWorkspace(bindingDirectory))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.invalid-binding' });

    const overlayDirectory = await workspace('isometric-action');
    const names = await readdir(overlayDirectory);
    const overlayName = names.find((name) => name.endsWith('.zip'))!;
    const overlayPath = resolve(overlayDirectory, overlayName);
    const overlayBytes = Uint8Array.from(await readFile(overlayPath));
    await writeFile(overlayPath, overlayBytes.subarray(0, overlayBytes.length - 7));
    await updateReceiptForArtifact(overlayDirectory, overlayName);
    await expect(loadWorldArtRuntimeCandidateWorkspace(overlayDirectory))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.invalid-overlay' });
  }, 30_000);

  it('rejects extra files, symlinks, and hard-link aliases', async () => {
    const extraDirectory = await workspace('topdown-farm');
    await writeFile(resolve(extraDirectory, 'private.log'), 'secret');
    await expect(loadWorldArtRuntimeCandidateWorkspace(extraDirectory))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.invalid-inventory' });

    const aliasDirectory = await workspace('side-platformer');
    const first = resolve(aliasDirectory, 'world-art-variant-map.json');
    const second = resolve(aliasDirectory, 'world-art-variant-selections.json');
    await unlink(second);
    await link(first, second);
    await expect(loadWorldArtRuntimeCandidateWorkspace(aliasDirectory))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.path-alias' });

    const symlinkDirectory = await workspace('layered-depth-2d');
    const symlinkTarget = resolve(symlinkDirectory, 'world-art-variant-map.json');
    const symlinkPath = resolve(symlinkDirectory, 'world-art-variant-selections.json');
    await unlink(symlinkPath);
    try {
      await symlink(symlinkTarget, symlinkPath, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await expect(loadWorldArtRuntimeCandidateWorkspace(symlinkDirectory))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.invalid-inventory' });
  }, 30_000);

  it('does not return or embed private roots, intake text, provider metadata, or credentials', async () => {
    const directory = await workspace('layered-depth-2d');
    const loaded = await loadWorldArtRuntimeCandidateWorkspace(directory);
    const json = JSON.stringify(loaded).toLowerCase();

    for (const forbidden of [
      directory,
      PRIVATE_MARKER,
      'private-input',
      'private-seed',
      'provider_request_id',
      'remote_asset_id',
      'credentials',
      'openai-request',
      'spritecook-asset',
    ]) {
      expect(json).not.toContain(forbidden.toLowerCase());
    }
    expect(loaded.receipt.remote_request_count).toBe(0);
  }, 30_000);

  it('uses stable fail-closed errors without leaking the private path', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-invalid-candidate-'));
    roots.push(root);
    const privatePath = resolve(root, 'private-missing-candidate');
    let failure: unknown;
    try {
      await loadWorldArtRuntimeCandidateWorkspace(privatePath);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LoadWorldArtRuntimeCandidateWorkspaceError);
    expect((failure as Error).message).not.toContain(privatePath);
  });
});
