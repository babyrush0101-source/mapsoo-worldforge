import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import layerProjectionSchema from '../../schemas/mapsoo-production-layer-projection-1.0.schema.json';
import committedPublicFixture from '../../tests/fixtures/pack10-public/mapsoo.manifest.json';
import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';
import {
  LayeredDepthLayerProjectionError,
  projectLayeredDepthProductionLayers,
} from './project-layered-depth-production-layers';
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

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sourcePng(
  width: number,
  height: number,
  mode: 'opaque' | 'straight-alpha',
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const visible = mode === 'opaque'
        || (x > Math.floor(width * 0.08)
          && x < Math.floor(width * 0.92)
          && y > Math.floor(height * 0.12)
          && y < Math.floor(height * 0.88));
      if (visible) rgba.set([75, 105, 145, 255], offset);
    }
  }
  return encodeRgbaPng(width, height, rgba);
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
      id: 'fixture-layer-replay',
      version: '1.0.0',
      documentation_url: 'https://example.com/fixture-layer-replay',
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    },
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    model: 'fixture-layer-model',
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

async function completeInputs() {
  const plan = createProductionArtPlan('layered-depth-2d', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const directionTask = plan.tasks.find(({ task_id: taskId }) => taskId === 'scene-direction');
  if (!directionTask) throw new Error('Fixture direction task is missing.');
  const [directionBytes, opaqueLayerBytes, alphaLayerBytes] = [
    sourcePng(1536, 1024, 'opaque'),
    sourcePng(1920, 1080, 'opaque'),
    sourcePng(1920, 1080, 'straight-alpha'),
  ];
  const approvedDirection = await normalizedResult(
    plan,
    directionTask,
    directionBytes,
    ['synthetic-environment', 'synthetic-character'],
  );
  const layerTasks = plan.tasks.filter(({ kind }) => kind === 'background-layer');
  const layers = await Promise.all(layerTasks.map((task) => normalizedResult(
    plan,
    task,
    task.alpha_policy === 'opaque' ? opaqueLayerBytes : alphaLayerBytes,
    ['approved-scene-direction'],
  )));
  return { plan, approvedDirection, layers };
}

describe('layered-depth production layer projector', () => {
  it('projects all eight style-bound planes into Pack 1.0 runtime files', async () => {
    const { plan, approvedDirection, layers } = await completeInputs();
    const projected = await projectLayeredDepthProductionLayers(
      plan,
      approvedDirection,
      layers,
    );
    const validateRecord = new Ajv2020({ strict: true, allErrors: true })
      .compile(layerProjectionSchema);

    expect(validateRecord(projected.record), JSON.stringify(validateRecord.errors)).toBe(true);
    expect(projected.planes).toHaveLength(8);
    expect(projected.record).toMatchObject({
      profile: 'layered-depth-2d',
      runtime_size: [640, 360],
      checks: {
        exact_canonical_planes: true,
        approved_direction_bound: true,
        normalized_evidence_bound: true,
        transparent_rgb_zeroed: true,
        output_alpha_checked: true,
      },
      seam_review: 'required',
      human_review: 'required',
    });
    for (const [index, item] of projected.planes.entries()) {
      expect(item.file.sha256).toBe(await sha256(item.png.readBytes()));
      expect(item.plane.role).toBe(projected.record.planes[index].role);
      expect(item.roleBinding).toEqual({
        role: item.plane.role,
        binding: { kind: 'file', path: item.plane.path },
      });
      const decoded = await decodeReferenceImageRgba(item.png.readBytes(), 'image/png');
      expect([decoded.width, decoded.height]).toEqual([640, 360]);
      const mutable = item.png.readBytes();
      mutable.fill(0);
      expect(item.png.readBytes()).not.toEqual(mutable);
    }

    const manifest = structuredClone(committedPublicFixture) as unknown as DeepMutable<Pack10Manifest>;
    manifest.planes = projected.planes.map(({ plane }) => structuredClone(plane));
    for (const item of projected.planes) {
      const roleIndex = manifest.roles.findIndex(({ role }) => role === item.plane.role);
      manifest.roles[roleIndex] = structuredClone(item.roleBinding);
      const fileIndex = manifest.files.findIndex(({ path }) => path === item.file.path);
      manifest.files[fileIndex] = structuredClone(item.file);
    }
    expect(validatePack10Manifest(manifest)).toEqual([]);
  });

  it('rejects missing, duplicate and unbound layer results', async () => {
    const { plan, approvedDirection, layers } = await completeInputs();
    await expect(projectLayeredDepthProductionLayers(
      plan,
      approvedDirection,
      layers.slice(1),
    )).rejects.toEqual(expect.objectContaining({ code: 'layer-projection.invalid-inventory' }));
    await expect(projectLayeredDepthProductionLayers(
      plan,
      approvedDirection,
      [layers[0], ...layers],
    )).rejects.toEqual(expect.objectContaining({ code: 'layer-projection.invalid-inventory' }));
    const unbound = {
      ...layers[0],
      output: { ...layers[0].output, source_reference_ids: ['different-direction'] },
    };
    await expect(projectLayeredDepthProductionLayers(
      plan,
      approvedDirection,
      [unbound, ...layers.slice(1)],
    )).rejects.toEqual(expect.objectContaining({ code: 'layer-projection.style-binding' }));
  });

  it('rejects a changed normalized digest even when the PNG bytes are valid', async () => {
    const { plan, approvedDirection, layers } = await completeInputs();
    const changed = {
      ...layers[0],
      output: { ...layers[0].output, sha256: 'f'.repeat(64) },
    };
    await expect(projectLayeredDepthProductionLayers(
      plan,
      approvedDirection,
      [changed, ...layers.slice(1)],
    )).rejects.toBeInstanceOf(LayeredDepthLayerProjectionError);
  });
});
