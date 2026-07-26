import { describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import { normalizeProductionArtPng } from '../adapters/normalize-production-art-png';
import productionArtEvidenceSchema from '../../schemas/mapsoo-production-art-generation-evidence-1.0.schema.json';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtTask,
} from './production-art-contract';
import {
  ProductionArtProviderError,
  assertTrustedProductionArtSource,
  runProductionArtProvider,
  type ProductionArtProvider,
  type RemoteProcessingAuthorization,
  type TrustedProductionArtSource,
} from './production-art-provider';
import { bindReferenceImage, type RuntimeReferenceImage } from './reference-image';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function reference(): Promise<RuntimeReferenceImage> {
  const bytes = encodeRgbaPng(2, 2, new Uint8Array(2 * 2 * 4).fill(180));
  return bindReferenceImage({
    id: 'environment-reference',
    role: 'environment-style',
    path: 'references/environment.png',
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    width: 2,
    height: 2,
    sha256: await sha256(bytes),
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  }, bytes);
}

function smallStraightAlphaPlan(): { plan: ProductionArtPlan; task: ProductionArtTask } {
  const base = createProductionArtPlan('side-platformer', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const original = base.tasks.find((task) =>
    task.kind === 'background-layer' && task.alpha_policy === 'straight-alpha');
  if (!original) throw new Error('Expected a straight-alpha background task.');
  const task: ProductionArtTask = {
    ...original,
    target: { width: 16, height: 16, cell_width: 16, cell_height: 16 },
    role_mappings: original.role_mappings.map((mapping) => ({
      ...mapping,
      grid_rect: { column: 0, row: 0, column_span: 1, row_span: 1 },
    })),
  };
  const plan: ProductionArtPlan = {
    ...base,
    tasks: base.tasks.map((item) => item.task_id === task.task_id ? task : item),
  };
  return { plan, task };
}

function greenScreenSource(): Uint8Array {
  const width = 32;
  const height = 32;
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba.set([0, 255, 0, 255], index * 4);
  }
  for (let y = 10; y < 22; y += 1) {
    for (let x = 10; x < 22; x += 1) {
      rgba.set([190, 45, 70, 255], (y * width + x) * 4);
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

function provider(generate = vi.fn(async () => ({
  sourcePngBytes: greenScreenSource(),
  model: 'test-image-model',
  workflow: 'image-edit' as const,
  providerRequestId: 'req_test_1',
}))): ProductionArtProvider {
  return {
    id: 'test-remote-art',
    version: '1.0.0',
    displayName: 'Test remote art provider',
    capabilities: {
      execution: 'remote',
      determinism: 'best-effort',
      outputProvenance: 'generative-ai',
      requiresCredentials: true,
      supportsAbort: true,
      supportedProfiles: ['side-platformer'],
      supportedTaskKinds: ['background-layer'],
      maxReferenceBytes: 8 * 1024 * 1024,
      maxReferenceCount: 2,
      maxOutputBytes: 8 * 1024 * 1024,
      maxRasterDimension: 1024,
      maxRequestsPerTask: 1,
      providerDocumentationUrl: 'https://example.com/provider-docs',
    },
    generate,
  };
}

describe('production art provider runner', () => {
  it('fails closed before upload when provider-bound authorization is absent', async () => {
    const { plan, task } = smallStraightAlphaPlan();
    const generate = vi.fn(async () => ({
      sourcePngBytes: greenScreenSource(),
      model: 'test-image-model',
      workflow: 'image-edit' as const,
    }));
    await expect(runProductionArtProvider(provider(generate), {
      plan,
      taskId: task.task_id,
      worldBrief: 'An original compact river crossing.',
      styleBible: 'Cool dusk palette, readable silhouettes, restrained outlines.',
      references: [await reference()],
    }, { credential: 'secret-runtime-key' })).rejects.toMatchObject({
      code: 'production-provider.remote-authorization-required',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('normalizes a trusted green-screen source and records honest evidence', async () => {
    const { plan, task } = smallStraightAlphaPlan();
    const environment = await reference();
    const authorization: RemoteProcessingAuthorization = {
      decision: 'approved',
      provider_id: 'test-remote-art',
      task_id: task.task_id,
      reference_ids: [environment.descriptor.id],
      allow_reference_upload: true,
      allow_prompt_upload: true,
      max_requests: 1,
    };
    const trusted = await runProductionArtProvider(provider(), {
      plan,
      taskId: task.task_id,
      worldBrief: 'An original compact river crossing.',
      styleBible: 'Cool dusk palette, readable silhouettes, restrained outlines.',
      references: [environment],
      remoteAuthorization: authorization,
    }, { credential: 'secret-runtime-key' });
    expect(() => assertTrustedProductionArtSource(trusted)).not.toThrow();

    const normalized = await normalizeProductionArtPng(trusted);
    expect(normalized.output).toMatchObject({
      width: 16,
      height: 16,
      alpha_policy: 'straight-alpha',
      source_reference_ids: ['environment-reference'],
    });
    expect(normalized.evidence).toMatchObject({
      model: 'test-image-model',
      workflow: 'image-edit',
      human_review: 'required',
      postprocess: {
        resize: 'nearest-neighbor-v1',
        alpha_extraction: 'edge-connected-green-chroma-v1',
      },
    });
    const validateEvidence = new Ajv2020({ strict: true, allErrors: true })
      .compile(productionArtEvidenceSchema);
    expect(validateEvidence(normalized.evidence), JSON.stringify(validateEvidence.errors)).toBe(true);
    expect(JSON.stringify(normalized)).not.toContain('secret-runtime-key');
    expect(JSON.stringify(trusted)).not.toContain('An original compact river crossing');
    expect(JSON.stringify(trusted)).not.toContain('Cool dusk palette');
    expect(normalized.normalized.readBytes()).not.toEqual(normalized.source.readBytes());
  });

  it('rejects forged sources that did not pass the trusted runner', async () => {
    const { plan, task } = smallStraightAlphaPlan();
    const forged = {
      provider: provider(),
      plan,
      task,
      worldBrief: 'A',
      styleBible: 'B',
      sourceReferenceIds: ['environment-reference'],
      generation: { model: 'test-image-model', workflow: 'image-edit' },
      source: {
        mediaType: 'image/png',
        byteLength: greenScreenSource().byteLength,
        width: 32,
        height: 32,
        readBytes: () => greenScreenSource(),
      },
    } as unknown as TrustedProductionArtSource;
    await expect(normalizeProductionArtPng(forged)).rejects.toBeInstanceOf(ProductionArtProviderError);
  });
});
