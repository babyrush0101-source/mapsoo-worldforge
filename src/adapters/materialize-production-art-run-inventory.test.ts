import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';
import {
  ProductionArtRunInventoryError,
  materializeProductionArtRunInventory,
} from './materialize-production-art-run-inventory';
import {
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtTask,
} from '../core/production-art-contract';
import type { WorldAssetProfile } from '../core/asset-profile';
import { createProductionArtRunSet } from '../core/production-art-run-set';

const rights = Object.freeze({
  distribution: 'internal-review' as const,
  license: 'LicenseRef-Proprietary' as const,
});

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function result(
  task: ProductionArtTask,
  planId: string,
  profile: WorldAssetProfile,
): Promise<NormalizedProductionArtResult> {
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba[offset] = 40;
    rgba[offset + 1] = 90;
    rgba[offset + 2] = 130;
    rgba[offset + 3] = 255;
  }
  const png = encodeRgbaPng(task.target.width, task.target.height, rgba);
  const digest = await sha256(png);
  const output: ProductionArtOutput = {
    schema_version: '1.0.0',
    document_type: 'production-art-output',
    plan_id: planId,
    profile,
    task_id: task.task_id,
    asset_id: task.task_id,
    path: task.expected_output_path,
    media_type: 'image/png',
    bytes: png.byteLength,
    sha256: digest,
    width: task.target.width,
    height: task.target.height,
    alpha_policy: task.alpha_policy,
    pivot: task.pivot,
    roles: task.role_mappings.map(({ role }) => role),
    source_reference_ids: ['environment-reference', 'character-reference'],
    rights,
  };
  const imageRecord = {
    media_type: 'image/png' as const,
    bytes: png.byteLength,
    sha256: digest,
    width: task.target.width,
    height: task.target.height,
  };
  const evidence: ProductionArtGenerationEvidence = {
    schema_version: '1.0.0',
    document_type: 'production-art-generation-evidence',
    provider: {
      id: 'recorded-review-provider',
      version: '1.0.0',
      documentation_url: 'https://example.com/provider',
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    },
    plan_id: planId,
    profile,
    task_id: task.task_id,
    model: 'recorded-review-v1',
    workflow: 'recorded-replay',
    source: imageRecord,
    normalized: {
      ...imageRecord,
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
  return {
    output,
    evidence,
    source: { byteLength: png.byteLength, readBytes: () => png.slice() },
    normalized: { byteLength: png.byteLength, readBytes: () => png.slice() },
  };
}

async function fixture() {
  const plan = createProductionArtPlan('topdown-farm', rights);
  const runs = Object.fromEntries(plan.tasks.map(({ task_id: taskId }) => [
    taskId,
    `./runs/${taskId}`,
  ]));
  const runSet = createProductionArtRunSet(plan, runs);
  const entries = await Promise.all(plan.tasks.map(async (task) => [
    task.task_id,
    await result(task, plan.plan_id, plan.profile),
  ] as const));
  return { plan, runSet, results: Object.fromEntries(entries) };
}

describe('production art run inventory', () => {
  it('freezes one complete, hash-verified profile inventory for an assembler', async () => {
    const { plan, runSet, results } = await fixture();
    const inventory = await materializeProductionArtRunInventory(plan, runSet, results);
    expect(inventory).toMatchObject({
      plan_id: plan.plan_id,
      profile: 'topdown-farm',
      providers: ['recorded-review-provider'],
      models: ['recorded-review-v1'],
    });
    expect(inventory.items.map(({ task }) => task.task_id)).toEqual(
      plan.tasks.map(({ task_id: taskId }) => taskId),
    );
    expect(Object.isFrozen(inventory.items)).toBe(true);
  });

  it('rejects substituted normalized bytes before profile projection', async () => {
    const { plan, runSet, results } = await fixture();
    const taskId = plan.tasks[0].task_id;
    const original = results[taskId];
    const changed = {
      ...results,
      [taskId]: {
        ...original,
        normalized: {
          byteLength: original.normalized.byteLength,
          readBytes: () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
        },
      },
    };
    await expect(materializeProductionArtRunInventory(plan, runSet, changed)).rejects.toThrow(
      ProductionArtRunInventoryError,
    );
  });

  it('rejects a missing task result before any pack mutation', async () => {
    const { plan, runSet, results } = await fixture();
    const changed = { ...results };
    delete changed[plan.tasks[0].task_id];
    await expect(materializeProductionArtRunInventory(plan, runSet, changed)).rejects.toThrowError(
      expect.objectContaining({ code: 'run-inventory.task-inventory' }),
    );
  });
});
