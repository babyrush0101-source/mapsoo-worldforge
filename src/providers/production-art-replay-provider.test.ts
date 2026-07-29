import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import { normalizeProductionArtPng } from '../adapters/normalize-production-art-png';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../core/production-art-contract';
import { runProductionArtProvider } from '../core/production-art-provider';
import { bindReferenceImage, type RuntimeReferenceImage } from '../core/reference-image';
import { createProductionArtReplayProvider } from './production-art-replay-provider';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function reference(id = 'environment-reference', marker = 180): Promise<RuntimeReferenceImage> {
  const bytes = encodeRgbaPng(2, 2, new Uint8Array(2 * 2 * 4).fill(marker));
  return bindReferenceImage({
    id,
    role: 'environment-style',
    path: `references/${id}.png`,
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

function smallPlan(): { plan: ProductionArtPlan; task: ProductionArtTask } {
  const base = createProductionArtPlan('layered-depth-2d', {
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
  return {
    task,
    plan: {
      ...base,
      tasks: base.tasks.map((candidate) => candidate.task_id === task.task_id ? task : candidate),
    },
  };
}

function greenScreenSource(): Uint8Array {
  const width = 32;
  const height = 32;
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba.set([0, 255, 0, 255], index * 4);
  }
  for (let y = 8; y < 24; y += 1) {
    for (let x = 9; x < 23; x += 1) {
      rgba.set([140, 55, 90, 255], (y * width + x) * 4);
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

describe('production art recorded replay provider', () => {
  it('rebuilds byte-identical normalized output without credentials or remote authorization', async () => {
    const { plan, task } = smallPlan();
    const environment = await reference();
    const mutableSource = greenScreenSource();
    const expectedSource = Uint8Array.from(mutableSource);
    const provider = createProductionArtReplayProvider('local-art-replay', '1.0.0', {
      planId: plan.plan_id,
      profile: plan.profile,
      taskId: task.task_id,
      taskKind: task.kind,
      references: [{
        id: environment.descriptor.id,
        sha256: environment.descriptor.sha256,
      }],
      sourcePngBytes: mutableSource,
      sourceSha256: await sha256(expectedSource),
      originalModel: 'test-image-model',
    });
    mutableSource.fill(0);

    const run = async () => normalizeProductionArtPng(await runProductionArtProvider(provider, {
      plan,
      taskId: task.task_id,
      worldBrief: 'Local replay of one frozen source.',
      styleBible: 'Local replay preserves the accepted source pixels.',
      references: [environment],
    }));
    const first = await run();
    const second = await run();

    expect(first.evidence.provider).toMatchObject({
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    });
    expect(first.evidence.workflow).toBe('recorded-replay');
    expect(first.evidence.source.sha256).toBe(await sha256(expectedSource));
    expect(first.output.sha256).toBe(second.output.sha256);
    expect(first.normalized.readBytes()).toEqual(second.normalized.readBytes());
  });

  it('rejects a replay when the current reference digest differs', async () => {
    const { plan, task } = smallPlan();
    const expectedReference = await reference();
    const source = greenScreenSource();
    const provider = createProductionArtReplayProvider('bound-art-replay', '1.0.0', {
      planId: plan.plan_id,
      profile: plan.profile,
      taskId: task.task_id,
      taskKind: task.kind,
      references: [{
        id: expectedReference.descriptor.id,
        sha256: expectedReference.descriptor.sha256,
      }],
      sourcePngBytes: source,
      sourceSha256: await sha256(source),
      originalModel: 'test-image-model',
    });
    const changedReference = await reference('environment-reference', 181);
    await expect(runProductionArtProvider(provider, {
      plan,
      taskId: task.task_id,
      worldBrief: 'Local replay of one frozen source.',
      styleBible: 'Local replay preserves the accepted source pixels.',
      references: [changedReference],
    })).rejects.toMatchObject({ code: 'production-provider.invalid-output' });
  });

  it('rejects a fixture whose declared source digest is false', async () => {
    const { plan, task } = smallPlan();
    const environment = await reference();
    const source = greenScreenSource();
    const provider = createProductionArtReplayProvider('tampered-art-replay', '1.0.0', {
      planId: plan.plan_id,
      profile: plan.profile,
      taskId: task.task_id,
      taskKind: task.kind,
      references: [{
        id: environment.descriptor.id,
        sha256: environment.descriptor.sha256,
      }],
      sourcePngBytes: source,
      sourceSha256: '0'.repeat(64),
      originalModel: 'test-image-model',
    });
    await expect(runProductionArtProvider(provider, {
      plan,
      taskId: task.task_id,
      worldBrief: 'Local replay of one frozen source.',
      styleBible: 'Local replay preserves the accepted source pixels.',
      references: [environment],
    })).rejects.toMatchObject({ code: 'production-provider.invalid-output' });
  });
});
