import { describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import { decodeReferenceImageRgba } from '../adapters/decode-reference-image-rgba';
import { normalizeProductionArtPng } from '../adapters/normalize-production-art-png';
import productionArtEvidenceSchema from '../../schemas/mapsoo-production-art-generation-evidence-1.0.schema.json';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtTask,
} from './production-art-contract';
import { buildProductionArtPlanV1_1 } from './production-art-contract-v1-1';
import { buildAssetRequirementsV1_1 } from './asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from './world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from './world-layout-plan';
import {
  ProductionArtProviderError,
  assertTrustedProductionArtSource,
  runProductionArtProvider,
  type ProductionArtProvider,
  type ProductionArtProviderInputV1_1,
  type ProductionArtProviderJobV1_1,
  type ProductionArtProviderV1_1,
  type RemoteProcessingAuthorization,
  type TrustedProductionArtSource,
} from './production-art-provider';
import { compileProductionArtPrompt } from './production-art-prompt';
import {
  bindReferenceImage,
  type ReferenceImageRole,
  type RuntimeReferenceImage,
} from './reference-image';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function reference(
  id = 'environment-reference',
  role: ReferenceImageRole = 'environment-style',
  marker = 180,
): Promise<RuntimeReferenceImage> {
  const bytes = encodeRgbaPng(2, 2, new Uint8Array(2 * 2 * 4).fill(marker));
  return bindReferenceImage({
    id,
    role,
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

const V1_1_FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'An original settlement beside an elevated water crossing.',
  worldview: 'Communities maintain shared routes between compact districts.',
  terrain: 'Layered stone, soil, shallow water, and planted terraces.',
  geography: 'A loop route links four anonymous landmarks.',
  culture: 'Practical craft traditions use restrained geometric motifs.',
  ecology: 'Reeds and small resilient plants cluster near water.',
  mood: 'Quiet, readable, and lightly adventurous.',
  art_direction: 'Original pixel art with crisp silhouettes and a limited palette.',
  traversal: 'A loop with elevated shortcuts and guarded crossings.',
  landmarks: 'Four label-free structural anchors.',
});

const V1_1_INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'extended',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'dangerous',
  landmark_labels: Object.freeze(['anchor-a', 'anchor-b', 'anchor-c', 'anchor-d']),
});

function intakeReference(role: 'environment-style' | 'character') {
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

async function productionArtV1_1Fixture() {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: 'provider-v11-fixture',
    session_revision: 11,
    profile: 'side-platformer',
    target: 'raspberry-pi-4b',
    seed: 'private-provider-v11-seed',
    facts: V1_1_FACTS,
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: 'c'.repeat(64),
    },
    references: [intakeReference('environment-style'), intakeReference('character')],
    approved_intent_preview_sha256: 'd'.repeat(64),
  });
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(
    intake,
    V1_1_INTENT,
  );
  const layoutPlan = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layoutPlan);
  const plan = await buildProductionArtPlanV1_1(requirements, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const task = plan.tasks.find(({ kind }) => kind === 'transparent-prop-sheet');
  if (!task) throw new Error('Expected a 1.1 prop sheet.');
  return { requirements, plan, task };
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

function characterGreenScreenSource(task: ProductionArtTask): Uint8Array {
  const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba.set([0, 255, 0, 255], index * 4);
  }
  for (const pose of task.pose_mappings ?? []) {
    const left = pose.grid_cell.column * cellWidth + Math.floor(cellWidth * 0.35);
    const top = pose.grid_cell.row * cellHeight + Math.floor(cellHeight * 0.25);
    const right = pose.grid_cell.column * cellWidth + Math.floor(cellWidth * 0.65);
    const bottom = pose.grid_cell.row * cellHeight + Math.floor(cellHeight * 0.75);
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        rgba.set([150, 55, 95, 255], (y * width + x) * 4);
      }
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

function providerV1_1(
  generate: ProductionArtProviderV1_1['generate'],
): ProductionArtProviderV1_1 {
  return {
    id: 'test-remote-art-v11',
    version: '1.1.0',
    displayName: 'Test remote art provider 1.1',
    capabilities: {
      execution: 'remote',
      determinism: 'best-effort',
      outputProvenance: 'generative-ai',
      requiresCredentials: true,
      supportsAbort: true,
      supportedProfiles: ['side-platformer'],
      supportedTaskKinds: ['transparent-prop-sheet'],
      maxReferenceBytes: 8 * 1024 * 1024,
      maxReferenceCount: 2,
      maxOutputBytes: 8 * 1024 * 1024,
      maxRasterDimension: 1024,
      maxRequestsPerTask: 1,
      providerDocumentationUrl: 'https://example.com/provider-v11-docs',
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

  it('keeps only declared character pose cells and clears every unused atlas cell', async () => {
    const plan = createProductionArtPlan('layered-depth-2d', {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    });
    const task = plan.tasks.find(({ task_id: taskId }) =>
      taskId === 'character-character-npc-atlas');
    if (!task) throw new Error('Layered-depth NPC production task missing.');
    const references = [
      await reference(),
      await reference('character-reference', 'character', 90),
    ];
    const source = characterGreenScreenSource(task);
    const characterProvider: ProductionArtProvider = {
      id: 'test-character-art',
      version: '1.0.0',
      displayName: 'Test character art provider',
      capabilities: {
        execution: 'remote',
        determinism: 'best-effort',
        outputProvenance: 'generative-ai',
        requiresCredentials: true,
        supportsAbort: true,
        supportedProfiles: ['layered-depth-2d'],
        supportedTaskKinds: ['character-animation-sheet'],
        maxReferenceBytes: 8 * 1024 * 1024,
        maxReferenceCount: 2,
        maxOutputBytes: 16 * 1024 * 1024,
        maxRasterDimension: 2048,
        maxRequestsPerTask: 1,
        providerDocumentationUrl: 'https://example.com/provider-docs',
      },
      async generate() {
        return {
          sourcePngBytes: source,
          model: 'test-image-model',
          workflow: 'image-edit',
        };
      },
    };
    const trusted = await runProductionArtProvider(characterProvider, {
      plan,
      taskId: task.task_id,
      worldBrief: 'An original layered settlement with one neutral NPC.',
      styleBible: 'Readable silhouettes and consistent grounded character proportions.',
      references,
      remoteAuthorization: {
        decision: 'approved',
        provider_id: characterProvider.id,
        task_id: task.task_id,
        reference_ids: references.map(({ descriptor }) => descriptor.id),
        allow_reference_upload: true,
        allow_prompt_upload: true,
        max_requests: 1,
      },
    }, { credential: 'runtime-test-credential' });
    const normalized = await normalizeProductionArtPng(trusted);
    const decoded = await decodeReferenceImageRgba(normalized.normalized.readBytes(), 'image/png');
    const used = new Set(task.pose_mappings?.map(({ grid_cell: cell }) => `${cell.column}:${cell.row}`));
    let checkedUnused = false;
    for (let row = 0; row < task.target.height / task.target.cell_height; row += 1) {
      for (let column = 0; column < task.target.width / task.target.cell_width; column += 1) {
        const x = column * task.target.cell_width + Math.floor(task.target.cell_width / 2);
        const y = row * task.target.cell_height + Math.floor(task.target.cell_height / 2);
        const alpha = decoded.rgba[(y * decoded.width + x) * 4 + 3];
        if (used.has(`${column}:${row}`)) expect(alpha).toBe(255);
        else {
          expect(alpha).toBe(0);
          checkedUnused = true;
        }
      }
    }
    expect(checkedUnused).toBe(true);
  });

  it('runs a source-bound 1.1 fake provider and compiles full slot identities', async () => {
    const { requirements, plan, task } = await productionArtV1_1Fixture();
    const environment = await reference();
    let compiledPrompt = '';
    const generate = vi.fn(async (job: ProductionArtProviderJobV1_1) => {
      compiledPrompt = compileProductionArtPrompt(job);
      return {
        sourcePngBytes: greenScreenSource(),
        model: 'test-image-model-v11',
        workflow: 'image-edit' as const,
      };
    });
    const testProvider = providerV1_1(generate);
    const trusted = await runProductionArtProvider(testProvider, {
      plan,
      requirements,
      taskId: task.task_id,
      worldBrief: 'An original compact settlement with four structural anchors.',
      styleBible: 'Crisp silhouettes, restrained geometry, and one coherent palette.',
      references: [environment],
      remoteAuthorization: {
        decision: 'approved',
        provider_id: testProvider.id,
        task_id: task.task_id,
        reference_ids: [environment.descriptor.id],
        allow_reference_upload: true,
        allow_prompt_upload: true,
        max_requests: 1,
      },
    }, { credential: 'runtime-test-credential' });

    expect(generate).toHaveBeenCalledOnce();
    expect(trusted.plan.schema_version).toBe('1.1.0');
    expect(trusted.task.slot_mappings).toEqual(task.slot_mappings);
    const first = task.slot_mappings[0];
    expect(compiledPrompt).toContain('Declared slots:');
    expect(compiledPrompt).toContain(`slot_id=${first.slot_id}`);
    expect(compiledPrompt).toContain(`requirement_id=${first.requirement_id}`);
    expect(compiledPrompt).toContain(`variant_id=${first.variant_id}`);
    expect(compiledPrompt).toContain(`role=${first.role}`);
    expect(compiledPrompt).not.toContain('Declared roles:');
  });

  it('rejects missing requirements or tampered 1.1 plans before provider execution', async () => {
    const { requirements, plan, task } = await productionArtV1_1Fixture();
    const environment = await reference();
    const generate = vi.fn(async (_job: ProductionArtProviderJobV1_1) => ({
      sourcePngBytes: greenScreenSource(),
      model: 'test-image-model-v11',
      workflow: 'image-edit' as const,
    }));
    const testProvider = providerV1_1(generate);
    const common = {
      plan,
      taskId: task.task_id,
      worldBrief: 'An original compact settlement with four structural anchors.',
      styleBible: 'Crisp silhouettes, restrained geometry, and one coherent palette.',
      references: [environment],
      remoteAuthorization: {
        decision: 'approved' as const,
        provider_id: testProvider.id,
        task_id: task.task_id,
        reference_ids: [environment.descriptor.id],
        allow_reference_upload: true as const,
        allow_prompt_upload: true as const,
        max_requests: 1,
      },
    };
    await expect(runProductionArtProvider(
      testProvider,
      common as unknown as ProductionArtProviderInputV1_1,
      { credential: 'runtime-test-credential' },
    )).rejects.toMatchObject({ code: 'production-provider.invalid-metadata' });

    const tampered = JSON.parse(JSON.stringify(plan));
    tampered.tasks.find(({ task_id: taskId }: { task_id: string }) =>
      taskId === task.task_id).slot_mappings[0].variant_id = 'landmark-999';
    await expect(runProductionArtProvider(testProvider, {
      ...common,
      plan: tampered,
      requirements,
    }, { credential: 'runtime-test-credential' })).rejects.toMatchObject({
      code: 'production-provider.invalid-metadata',
    });
    expect(generate).not.toHaveBeenCalled();
  });
});
