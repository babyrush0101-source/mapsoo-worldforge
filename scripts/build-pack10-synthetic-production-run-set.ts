import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { encodeRgbaPng } from '../src/adapters/canvas/encode-png';
import type { ProductionArtGenerationEvidence } from '../src/adapters/normalize-production-art-png';
import {
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtTask,
} from '../src/core/production-art-contract';
import { createProductionArtRunSet } from '../src/core/production-art-run-set';

const DEFAULT_OUTPUT =
  'docs/visual-qa/production-art/model-runs/synthetic-pack10-production-v1';

function outputArgument(argv: readonly string[]): string {
  if (argv.length === 0) return DEFAULT_OUTPUT;
  if (argv.length !== 1 || !argv[0].startsWith('--out=')) {
    throw new Error('Use no arguments or exactly --out=<local-directory>.');
  }
  const value = argv[0].slice('--out='.length);
  if (!value || value.trim() !== value) throw new Error('Synthetic run-set output is invalid.');
  return value;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function opaquePng(task: ProductionArtTask): Uint8Array {
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set([38, 64, 92, 255], offset);
  }
  return encodeRgbaPng(task.target.width, task.target.height, rgba);
}

function layerPng(task: ProductionArtTask, marker: number): Uint8Array {
  if (task.alpha_policy === 'opaque') return opaquePng(task);
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  for (let y = 60 + marker; y < task.target.height - 60 - marker; y += 1) {
    for (let x = 80 + marker; x < task.target.width - 80 - marker; x += 1) {
      rgba.set(
        [40 + marker * 9, 70 + marker * 7, 100 + marker * 5, 255],
        (y * task.target.width + x) * 4,
      );
    }
  }
  return encodeRgbaPng(task.target.width, task.target.height, rgba);
}

function environmentSheetPng(task: ProductionArtTask): Uint8Array {
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  const taskOffset = task.task_id === 'terrain-sheet'
    ? 0
    : task.task_id === 'prop-sheet'
      ? 10
      : 30;
  task.role_mappings.forEach((mapping, index) => {
    const identity = taskOffset + index;
    const color = [
      20 + (identity * 37) % 200,
      30 + (identity * 61) % 190,
      40 + (identity * 83) % 180,
      255,
    ] as const;
    const left = mapping.grid_rect.column * task.target.cell_width;
    const top = mapping.grid_rect.row * task.target.cell_height;
    const padding = task.kind === 'opaque-tile-sheet'
      ? 0
      : Math.max(4, Math.floor(task.target.cell_width / 8));
    for (let y = top + padding; y < top + task.target.cell_height - padding; y += 1) {
      for (let x = left + padding; x < left + task.target.cell_width - padding; x += 1) {
        rgba.set(color, (y * task.target.width + x) * 4);
      }
    }
  });
  return encodeRgbaPng(task.target.width, task.target.height, rgba);
}

function characterSheetPng(task: ProductionArtTask): Uint8Array {
  if (!task.pose_mappings) throw new Error('Synthetic character task has no poses.');
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  task.pose_mappings.forEach((pose, index) => {
    const left = pose.grid_cell.column * task.target.cell_width;
    const top = pose.grid_cell.row * task.target.cell_height;
    const color = [
      35 + (index * 11) % 190,
      45 + (index * 17) % 180,
      55 + (index * 23) % 170,
      255,
    ] as const;
    const asymmetry = index % 7;
    for (let y = 58; y <= 180; y += 1) {
      for (let x = 38; x < 88 + asymmetry; x += 1) {
        rgba.set(color, ((top + y) * task.target.width + left + x) * 4);
      }
    }
  });
  return encodeRgbaPng(task.target.width, task.target.height, rgba);
}

function taskPng(task: ProductionArtTask, layerIndex: number): Uint8Array {
  if (task.kind === 'scene-direction') return opaquePng(task);
  if (task.kind === 'background-layer') return layerPng(task, layerIndex + 1);
  if (task.kind === 'character-animation-sheet') return characterSheetPng(task);
  return environmentSheetPng(task);
}

function sourceReferenceIds(task: ProductionArtTask): readonly string[] {
  if (task.kind === 'scene-direction') {
    return ['synthetic-environment', 'synthetic-character'];
  }
  if (task.kind === 'character-animation-sheet') {
    return ['approved-scene-direction', 'synthetic-character'];
  }
  return ['approved-scene-direction'];
}

async function records(
  task: ProductionArtTask,
  bytes: Uint8Array,
): Promise<{
  readonly output: ProductionArtOutput;
  readonly evidence: ProductionArtGenerationEvidence;
}> {
  const digest = await sha256(bytes);
  const plan = createProductionArtPlan('layered-depth-2d', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const output: ProductionArtOutput = {
    schema_version: '1.0.0',
    document_type: 'production-art-output',
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    asset_id: `${task.task_id}-synthetic-candidate`,
    path: task.expected_output_path,
    media_type: 'image/png',
    bytes: bytes.byteLength,
    sha256: digest,
    width: task.target.width,
    height: task.target.height,
    alpha_policy: task.alpha_policy,
    pivot: task.pivot,
    roles: task.role_mappings.map(({ role }) => role),
    source_reference_ids: sourceReferenceIds(task),
    rights: plan.rights,
  };
  const evidence: ProductionArtGenerationEvidence = {
    schema_version: '1.0.0',
    document_type: 'production-art-generation-evidence',
    provider: {
      id: 'synthetic-production-fixture',
      version: '1.0.0',
      documentation_url: 'https://example.com/synthetic-production-fixture',
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    },
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    model: 'synthetic-fixture-no-model',
    workflow: 'recorded-replay',
    source: {
      media_type: 'image/png',
      bytes: bytes.byteLength,
      sha256: digest,
      width: task.target.width,
      height: task.target.height,
    },
    normalized: {
      media_type: 'image/png',
      bytes: bytes.byteLength,
      sha256: digest,
      width: task.target.width,
      height: task.target.height,
      alpha_policy: task.alpha_policy,
    },
    postprocess: {
      resize: 'nearest-neighbor-v1',
      alpha_extraction: task.alpha_policy === 'opaque'
        ? 'none'
        : 'edge-connected-green-chroma-v1',
      transparent_rgb_zeroed: true,
      mapped_grid_cells_checked: true,
    },
    human_review: 'required',
  };
  return { output, evidence };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

async function writeReproducible(path: string, bytes: Uint8Array): Promise<void> {
  try {
    const existing = Uint8Array.from(await readFile(path));
    if (!equalBytes(existing, bytes)) {
      throw new Error(`Existing synthetic fixture differs: ${path}.`);
    }
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

async function main(): Promise<void> {
  const outputRoot = resolve(outputArgument(process.argv.slice(2)));
  const plan = createProductionArtPlan('layered-depth-2d', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const runs: Record<string, string> = {};
  let layerIndex = 0;
  for (const task of plan.tasks) {
    const directory = resolve(outputRoot, task.task_id);
    await mkdir(directory, { recursive: true });
    const png = taskPng(task, layerIndex);
    if (task.kind === 'background-layer') layerIndex += 1;
    const { output, evidence } = await records(task, png);
    await Promise.all([
      writeReproducible(resolve(directory, 'source.png'), png),
      writeReproducible(resolve(directory, 'normalized.png'), png),
      writeReproducible(
        resolve(directory, 'output.json'),
        new TextEncoder().encode(`${JSON.stringify(output, null, 2)}\n`),
      ),
      writeReproducible(
        resolve(directory, 'evidence.json'),
        new TextEncoder().encode(`${JSON.stringify(evidence, null, 2)}\n`),
      ),
    ]);
    runs[task.task_id] = `./${task.task_id}`;
  }
  const runSet = createProductionArtRunSet(plan, runs);
  const runSetPath = resolve(outputRoot, 'layered-depth-run-set.json');
  await writeReproducible(
    runSetPath,
    new TextEncoder().encode(`${JSON.stringify(runSet, null, 2)}\n`),
  );
  console.log(JSON.stringify({
    status: 'synthetic-production-run-set-written',
    purpose: 'technical-validation-only',
    contains_real_model_output: false,
    task_count: plan.tasks.length,
    output: runSetPath,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : 'Synthetic Pack 1.0 production run-set build failed.';
  console.error(`MAPSOO_SYNTHETIC_PRODUCTION_RUN_SET_ERROR ${message}`);
  process.exitCode = 1;
});
