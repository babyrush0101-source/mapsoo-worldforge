import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import atlasProjectionSchema from '../../schemas/mapsoo-production-environment-atlas-projection-1.0.schema.json';
import committedPublicFixture from '../../tests/fixtures/pack10-public/mapsoo.manifest.json';
import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';
import {
  LayeredDepthAtlasProjectionError,
  projectLayeredDepthProductionAtlases,
} from './project-layered-depth-production-atlases';
import {
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../core/production-art-contract';
import {
  validatePack10Manifest,
  type Pack10Manifest,
} from '../core/pack-manifest-1.0';

type DeepMutable<T> =
  T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

interface SheetOptions {
  readonly populateUnmapped?: true;
  readonly touchBoundaryRole?: string;
  readonly duplicateRole?: string;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function solidPng(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set([58, 82, 118, 255], offset);
  }
  return encodeRgbaPng(width, height, rgba);
}

function sheetPng(
  task: ProductionArtTask,
  options: SheetOptions = {},
): Uint8Array {
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  task.role_mappings.forEach((mapping, index) => {
    const taskOffset = task.task_id === 'terrain-sheet'
      ? 0
      : task.task_id === 'prop-sheet'
        ? 10
        : 30;
    const sourceIndex = taskOffset + (mapping.role === options.duplicateRole ? 0 : index);
    const color = [
      20 + (sourceIndex * 37) % 200,
      30 + (sourceIndex * 61) % 190,
      40 + (sourceIndex * 83) % 180,
      255,
    ] as const;
    const left = mapping.grid_rect.column * task.target.cell_width;
    const top = mapping.grid_rect.row * task.target.cell_height;
    const touchesBoundary = task.kind === 'opaque-tile-sheet'
      || mapping.role === options.touchBoundaryRole;
    const padding = touchesBoundary ? 0 : Math.max(4, Math.floor(task.target.cell_width / 8));
    for (let y = top + padding; y < top + task.target.cell_height - padding; y += 1) {
      for (let x = left + padding; x < left + task.target.cell_width - padding; x += 1) {
        const offset = (y * task.target.width + x) * 4;
        rgba.set(color, offset);
      }
    }
  });
  if (options.populateUnmapped) {
    const x = task.target.width - Math.floor(task.target.cell_width / 2);
    const y = task.target.height - Math.floor(task.target.cell_height / 2);
    rgba.set([255, 0, 255, 255], (y * task.target.width + x) * 4);
  }
  return encodeRgbaPng(task.target.width, task.target.height, rgba);
}

async function normalizedResult(
  plan: ProductionArtPlan,
  task: ProductionArtTask,
  bytes: Uint8Array,
  sourceReferenceIds: readonly string[],
): Promise<NormalizedProductionArtResult> {
  const digest = await sha256(bytes);
  const output: ProductionArtOutput = {
    schema_version: '1.0.0',
    document_type: 'production-art-output',
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    asset_id: `${task.task_id}-candidate`,
    path: task.expected_output_path,
    media_type: 'image/png',
    bytes: bytes.byteLength,
    sha256: digest,
    width: task.target.width,
    height: task.target.height,
    alpha_policy: task.alpha_policy,
    pivot: task.pivot,
    roles: task.role_mappings.map(({ role }) => role),
    source_reference_ids: [...sourceReferenceIds],
    rights: plan.rights,
  };
  const evidence: ProductionArtGenerationEvidence = {
    schema_version: '1.0.0',
    document_type: 'production-art-generation-evidence',
    provider: {
      id: 'fixture-atlas-replay',
      version: '1.0.0',
      documentation_url: 'https://example.com/fixture-atlas-replay',
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    },
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    model: 'fixture-atlas-model',
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
  const snapshot = Uint8Array.from(bytes);
  return {
    output,
    evidence,
    source: {
      byteLength: snapshot.byteLength,
      readBytes: () => Uint8Array.from(snapshot),
    },
    normalized: {
      byteLength: snapshot.byteLength,
      readBytes: () => Uint8Array.from(snapshot),
    },
  };
}

async function completeInputs(
  taskOptions: Readonly<Record<string, SheetOptions>> = {},
) {
  const plan = createProductionArtPlan('layered-depth-2d', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const directionTask = plan.tasks.find(({ task_id: id }) => id === 'scene-direction');
  if (!directionTask) throw new Error('Fixture direction task is missing.');
  const approvedDirection = await normalizedResult(
    plan,
    directionTask,
    solidPng(directionTask.target.width, directionTask.target.height),
    ['synthetic-environment', 'synthetic-character'],
  );
  const atlasTasks = ['terrain-sheet', 'prop-sheet', 'effect-sheet'].map((taskId) => {
    const task = plan.tasks.find(({ task_id: id }) => id === taskId);
    if (!task) throw new Error(`Fixture task is missing: ${taskId}.`);
    return task;
  });
  const atlases = await Promise.all(atlasTasks.map((task) => normalizedResult(
    plan,
    task,
    sheetPng(task, taskOptions[task.task_id]),
    ['approved-scene-direction'],
  )));
  return { plan, approvedDirection, atlases };
}

describe('layered-depth production environment atlas projector', () => {
  it('projects three source sheets into five schema-valid Pack 1.0 atlases', async () => {
    const { plan, approvedDirection, atlases } = await completeInputs();
    const projected = await projectLayeredDepthProductionAtlases(
      plan,
      approvedDirection,
      atlases,
    );
    const replayed = await projectLayeredDepthProductionAtlases(
      plan,
      approvedDirection,
      atlases,
    );
    const validateRecord = new Ajv2020({ strict: true, allErrors: true })
      .compile(atlasProjectionSchema);

    expect(validateRecord(projected.record), JSON.stringify(validateRecord.errors)).toBe(true);
    expect(replayed.record).toEqual(projected.record);
    expect(replayed.atlases.map(({ png }) => png.readBytes()))
      .toEqual(projected.atlases.map(({ png }) => png.readBytes()));
    expect(projected.atlases.map(({ atlas }) => atlas.id)).toEqual([
      'terrain',
      'props',
      'structures',
      'collectibles',
      'effects',
    ]);
    expect(projected.record.checks).toEqual({
      exact_canonical_source_tasks: true,
      approved_direction_bound: true,
      normalized_evidence_bound: true,
      mapped_cells_nonempty: true,
      unmapped_cells_transparent: true,
      transparent_rgb_zeroed: true,
      binary_alpha_checked: true,
      transparent_boundaries_checked: true,
      exact_duplicates_rejected: true,
      pivot_baked_to_cell_center: true,
    });
    expect(projected.atlases.flatMap(({ roleBindings }) => roleBindings)).toHaveLength(22);
    expect(projected.atlases.map(({ atlas }) => atlas.cell_size)).toEqual([
      [64, 128],
      [96, 176],
      [96, 176],
      [96, 176],
      [64, 64],
    ]);
    expect(projected.record.atlases.map((atlas) => [
      atlas.source_pivot,
      atlas.runtime_cell_center,
      atlas.pivot_transform,
    ])).toEqual([
      [[32, 64], [32, 64], 'source-pivot-to-runtime-cell-center-v1'],
      [[48, 88], [48, 88], 'source-pivot-to-runtime-cell-center-v1'],
      [[48, 88], [48, 88], 'source-pivot-to-runtime-cell-center-v1'],
      [[48, 88], [48, 88], 'source-pivot-to-runtime-cell-center-v1'],
      [[32, 32], [32, 32], 'source-pivot-to-runtime-cell-center-v1'],
    ]);

    for (const item of projected.atlases) {
      expect(item.file.sha256).toBe(await sha256(item.png.readBytes()));
      expect(item.file.path).toBe(item.atlas.path);
      expect(item.roleBindings.every(({ binding }) =>
        binding.kind === 'atlas-region' && binding.atlas === item.atlas.id)).toBe(true);
      const decoded = await decodeReferenceImageRgba(item.png.readBytes(), 'image/png');
      expect(decoded.height).toBe(item.atlas.cell_size[1]);
      expect(decoded.width).toBe(item.roleBindings.length * item.atlas.cell_size[0]);
      const changed = item.png.readBytes();
      changed.fill(0);
      expect(item.png.readBytes()).not.toEqual(changed);
    }

    const manifest = structuredClone(committedPublicFixture) as unknown as DeepMutable<Pack10Manifest>;
    for (const item of projected.atlases) {
      const atlasIndex = manifest.atlases.findIndex(({ id }) => id === item.atlas.id);
      manifest.atlases[atlasIndex] = {
        id: item.atlas.id,
        path: item.atlas.path,
        cell_size: [item.atlas.cell_size[0], item.atlas.cell_size[1]],
      };
      for (const roleBinding of item.roleBindings) {
        const roleIndex = manifest.roles.findIndex(({ role }) => role === roleBinding.role);
        manifest.roles[roleIndex] = structuredClone(roleBinding);
      }
      const fileIndex = manifest.files.findIndex(({ path }) => path === item.file.path);
      manifest.files[fileIndex] = structuredClone(item.file);
    }
    expect(validatePack10Manifest(manifest)).toEqual([]);
  });

  it('rejects missing, duplicate, unexpected and unbound source inventories', async () => {
    const { plan, approvedDirection, atlases } = await completeInputs();
    await expect(projectLayeredDepthProductionAtlases(
      plan,
      approvedDirection,
      atlases.slice(1),
    )).rejects.toEqual(expect.objectContaining({
      code: 'atlas-projection.invalid-inventory',
    }));
    await expect(projectLayeredDepthProductionAtlases(
      plan,
      approvedDirection,
      [atlases[0], ...atlases],
    )).rejects.toEqual(expect.objectContaining({
      code: 'atlas-projection.invalid-inventory',
    }));
    await expect(projectLayeredDepthProductionAtlases(
      plan,
      approvedDirection,
      [approvedDirection, ...atlases.slice(1)],
    )).rejects.toEqual(expect.objectContaining({
      code: 'atlas-projection.invalid-inventory',
    }));
    const unbound = {
      ...atlases[0],
      output: {
        ...atlases[0].output,
        source_reference_ids: ['different-direction'],
      },
    };
    await expect(projectLayeredDepthProductionAtlases(
      plan,
      approvedDirection,
      [unbound, ...atlases.slice(1)],
    )).rejects.toEqual(expect.objectContaining({
      code: 'atlas-projection.style-binding',
    }));
  });

  it('rejects pixels in undeclared source cells and non-terrain boundary contact', async () => {
    const polluted = await completeInputs({
      'terrain-sheet': { populateUnmapped: true },
    });
    await expect(projectLayeredDepthProductionAtlases(
      polluted.plan,
      polluted.approvedDirection,
      polluted.atlases,
    )).rejects.toEqual(expect.objectContaining({
      code: 'atlas-projection.unmapped-cell',
    }));

    const touching = await completeInputs({
      'prop-sheet': { touchBoundaryRole: 'prop.tree' },
    });
    await expect(projectLayeredDepthProductionAtlases(
      touching.plan,
      touching.approvedDirection,
      touching.atlases,
    )).rejects.toEqual(expect.objectContaining({
      code: 'atlas-projection.padding',
    }));
  });

  it('rejects duplicate runtime role pixels and tampered normalized evidence', async () => {
    const duplicate = await completeInputs({
      'effect-sheet': { duplicateRole: 'effect.interact' },
    });
    await expect(projectLayeredDepthProductionAtlases(
      duplicate.plan,
      duplicate.approvedDirection,
      duplicate.atlases,
    )).rejects.toEqual(expect.objectContaining({
      code: 'atlas-projection.duplicate-cell',
    }));

    const valid = await completeInputs();
    const changed = {
      ...valid.atlases[0],
      output: { ...valid.atlases[0].output, sha256: 'f'.repeat(64) },
    };
    await expect(projectLayeredDepthProductionAtlases(
      valid.plan,
      valid.approvedDirection,
      [changed, ...valid.atlases.slice(1)],
    )).rejects.toBeInstanceOf(LayeredDepthAtlasProjectionError);
  });
});
