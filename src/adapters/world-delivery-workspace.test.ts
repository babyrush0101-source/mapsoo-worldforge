import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import JSZip from 'jszip';

import { encodeRgbaPng } from './canvas/encode-png';
import smokeReportSchema
  from '../../schemas/mapsoo-godot-headless-smoke-report-1.0.schema.json';
import workflowJobSchema
  from '../../schemas/mapsoo-production-art-workflow-job-1.0.schema.json';
import workflowJobV1_1Schema
  from '../../schemas/mapsoo-production-art-workflow-job-1.1.schema.json';
import {
  finalizeWorldRunnerDelivery,
  prepareWorldDeliveryWorkspace,
} from './world-delivery-workspace';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from '../core/confirmed-world-creation-intake';
import {
  CHARACTER_PROFILE_REVISION_VERSION,
  requiredCharacterProfileClips,
  serializeCharacterProfileRevisionCanonical,
  type CharacterProfileRevision,
} from '../core/character-profile-revision';
import type { WorldAssetProfile } from '../core/asset-profile';
import type {
  CharacterAction,
  CharacterDirection,
} from '../core/generated-asset-bundle';
import {
  PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
  type PortableWorldRuntimeContract,
} from '../core/portable-world-runtime-contract';
import type {
  CharacterIdentitySemantics,
} from '../core/character-identity-semantics';
import {
  fingerprintAssetRequirementsV1_1,
  materializeAssetRequirementsV1_1,
} from '../core/asset-requirements-v1-1';
import {
  fingerprintProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
} from '../core/production-art-contract-v1-1';

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const COMPLETED_AT = '2026-07-27T12:00:00.000Z';

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function png(marker: number): Uint8Array {
  return encodeRgbaPng(2, 2, Uint8Array.from([
    marker, 40, 80, 255,
    90, marker, 120, 255,
    140, 160, marker, 255,
    marker, marker, marker, 255,
  ]));
}

async function intakeFixture(
  root: string,
  profile: WorldAssetProfile,
  target: ConfirmedWorldCreationIntake['target'] = 'raspberry-pi-4b',
): Promise<ConfirmedWorldCreationIntake> {
  const environment = png(20);
  const character = png(220);
  await mkdir(resolve(root, 'references'), { recursive: true });
  await Promise.all([
    writeFile(resolve(root, 'references/environment.png'), environment),
    writeFile(resolve(root, 'references/character.png'), character),
  ]);
  const rights = {
    basis: 'owned' as const,
    license: 'LicenseRef-User-Owned',
    allowGenerativeAdaptation: true as const,
    allowOutputRedistribution: true as const,
    allowOutputCc0Dedication: true as const,
  };
  return createConfirmedWorldCreationIntake({
    intake_id: `mist-harbor-${profile}`,
    session_revision: 14,
    profile,
    target,
    seed: 'mist-harbor-seed-one',
    facts: {
      premise: 'Explore a misty harbor and restore its lantern routes.',
      worldview: 'Tides preserve memories and the beacon guild controls safe passage.',
      terrain: 'Wet docks, stone terraces, reed marshes, and sea caves.',
      geography: 'A harbor loop connects the spawn pier, market, lighthouse, and cave exit.',
      culture: 'Boat builders and lantern keepers live in timber houses on stone foundations.',
      ecology: 'Cool rain, salt grass, gulls, glowing plankton, and drifting fog.',
      mood: 'Quietly mysterious with strong silhouettes and readable hazards.',
      art_direction: 'Blue slate, warm lanterns, hand-painted pixels, soft rain, and profile-safe character proportions.',
      traversal: 'Follow lit piers, repair three beacons, avoid waves, and exit through the lighthouse.',
      landmarks: 'A leaning lighthouse, red market canopy, bell buoy, and luminous sea cave.',
    },
    character_source: {
      reference_id: 'created-character',
      identity_digest_sha256: 'd'.repeat(64),
    },
    references: [{
      id: 'harbor-environment',
      role: 'environment-style',
      path: 'references/environment.png',
      mediaType: 'image/png',
      byteLength: environment.byteLength,
      width: 2,
      height: 2,
      sha256: sha(environment),
      rights,
    }, {
      id: 'created-character',
      role: 'character',
      path: 'references/character.png',
      mediaType: 'image/png',
      byteLength: character.byteLength,
      width: 2,
      height: 2,
      sha256: sha(character),
      rights,
    }],
    approved_intent_preview_sha256: 'e'.repeat(64),
  });
}

function characterSemantics(
  intake: ConfirmedWorldCreationIntake,
): CharacterIdentitySemantics {
  return {
    schema_version: '1.0.0',
    document_type: 'character-identity-semantics',
    character_id: 'neutral-traveler',
    source_identity: {
      identity_digest_sha256:
        intake.character_source.identity_digest_sha256,
      source_reference_id: intake.character_source.reference_id,
    },
    confirmation: {
      status: 'human-confirmed',
      checkpoint_sha256: 'f'.repeat(64),
    },
    cues: {
      silhouette: 'Compact traveler with a broad scarf and narrow boots.',
      body_proportions: 'Large head, short torso, slim arms, and sturdy legs.',
      hair: 'Dark wavy bob with one curl above the left eyebrow.',
      face: 'Round face, straight eyebrows, and a small triangular nose.',
      clothing: ['Magenta jacket.', 'Amber scarf.', 'Charcoal trousers.'],
      equipment: ['Small round lantern at the left hip.'],
      distinguishing_features: ['Pale crescent above the right eyebrow.'],
      palette: ['#231f2b', '#b43b73', '#e4a43b', '#e7d8c9'],
    },
  };
}

describe('world delivery workspace preparation', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('prepares a private, zero-request %s production job', async (profile) => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-workspace-'));
    roots.push(root);
    const intake = await intakeFixture(root, profile);
    const workspace = resolve(root, 'private-workspace');
    const manifest = await prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace,
      characterId: 'neutral-traveler',
      completedAt: COMPLETED_AT,
    });
    expect(manifest.profile).toBe(profile);
    expect(manifest.remote_request_count).toBe(0);
    expect(manifest.task_count).toBeGreaterThan(1);
    expect(manifest.request_budget).toBe(manifest.task_count);
    expect(manifest.complete_art_plan).toMatchObject({
      status: 'planned',
      requirements_path:
        'complete-art/asset-requirements-1.1.json',
      plan_path: 'complete-art/production-art-plan-1.1.json',
      workflow_job_path:
        'complete-art/production-art-workflow-job-1.1.json',
      execution: 'explicit-authorization-required',
    });
    expect(manifest.complete_art_plan.requirement_count).toBeGreaterThan(1);
    expect(manifest.complete_art_plan.task_count).toBeGreaterThan(1);
    expect(manifest.baseline).toMatchObject({
      status: 'godot-import-ready',
      art_quality: 'procedural-placeholder',
      pack_schema_version: {
        'topdown-farm': '0.6.0',
        'side-platformer': '0.7.0',
        'isometric-action': '0.8.0',
        'layered-depth-2d': '0.9.0',
      }[profile],
      preview_path: 'baseline/world-preview.png',
      asset_revision_path: 'baseline/world-asset-revision.json',
      review_evidence_path:
        'baseline/exported-world-review-evidence.json',
      godot_scene_path:
        `res://mapsoo_imports/${intake.intake_id}/${intake.intake_id}.world.tscn`,
      final_art_required: true,
    });
    expect(Object.keys(manifest.files)).toEqual(expect.arrayContaining([
      manifest.baseline.pack_path,
      manifest.baseline.preview_path,
      manifest.baseline.asset_revision_path,
      manifest.baseline.review_evidence_path,
      'confirmed-intake.json',
      'confirmed-intake-projection.json',
      'asset-requirements.json',
      manifest.complete_art_plan.requirements_path,
      manifest.complete_art_plan.plan_path,
      manifest.complete_art_plan.workflow_job_path,
      'production-art-workflow-job.json',
      'production-art-requirements-binding.json',
      'references/environment.png',
      'references/character.png',
      'style-bible.txt',
      'world-layout-constraints.json',
      'world-layout-plan.json',
      'world-brief.txt',
    ]));
    expect(manifest.layout_plan_sha256).toMatch(/^[a-f0-9]{64}$/u);
    const baselinePack = Uint8Array.from(await readFile(
      resolve(workspace, ...manifest.baseline.pack_path.split('/')),
    ));
    expect(sha(baselinePack)).toBe(manifest.baseline.pack_sha256);
    const baselineZip = await JSZip.loadAsync(baselinePack);
    const layoutEntry = Object.values(baselineZip.files)
      .find(({ name }) => name.endsWith('/world-layout-plan.json'));
    expect(layoutEntry).toBeDefined();
    expect(JSON.parse(await layoutEntry!.async('text'))).toMatchObject({
      profile,
      source: {
        intake_id: intake.intake_id,
        seed: intake.seed,
      },
    });
    const assetRevision = JSON.parse(await readFile(
      resolve(workspace, manifest.baseline.asset_revision_path),
      'utf8',
    )) as Record<string, unknown>;
    expect(assetRevision).toMatchObject({
      profile,
      world_id: intake.intake_id,
      pack_sha256: manifest.baseline.pack_sha256,
      revision_sha256: manifest.baseline.asset_revision_sha256,
    });
    const previewBytes = Uint8Array.from(await readFile(
      resolve(workspace, manifest.baseline.preview_path),
    ));
    expect(sha(previewBytes)).toBe(manifest.baseline.preview_sha256);
    const reviewEvidence = JSON.parse(await readFile(
      resolve(workspace, manifest.baseline.review_evidence_path),
      'utf8',
    )) as Record<string, unknown>;
    expect(reviewEvidence).toMatchObject({
      profile,
      approved_intent_preview_sha256:
        intake.approved_intent_preview_sha256,
      review_binding_sha256: manifest.baseline.review_binding_sha256,
    });
    const job = JSON.parse(await readFile(
      resolve(workspace, 'production-art-workflow-job.json'),
      'utf8',
    )) as Record<string, unknown>;
    expect(job.profile).toBe(profile);
    expect(job.character_id).toBe('neutral-traveler');
    expect(String(job.environment_reference)).toContain(workspace);
    expect(job.world_layout_plan_file).toBe(
      resolve(workspace, 'world-layout-plan.json'),
    );
    expect(job.asset_requirements_file).toBe(
      resolve(workspace, 'asset-requirements.json'),
    );
    expect(job.production_art_requirements_binding_file).toBe(
      resolve(workspace, 'production-art-requirements-binding.json'),
    );
    expect(new Ajv2020().compile(workflowJobSchema)(job)).toBe(true);
    const completeArtJobPath = resolve(
      workspace,
      manifest.complete_art_plan.workflow_job_path,
    );
    const completeArtJob = JSON.parse(await readFile(
      completeArtJobPath,
      'utf8',
    ));
    expect(new Ajv2020().compile(workflowJobV1_1Schema)(completeArtJob))
      .toBe(true);
    expect(completeArtJob).toMatchObject({
      schema_version: '1.1.0',
      profile,
      request_budget: manifest.complete_art_plan.task_count,
      asset_requirements_file: resolve(
        workspace,
        manifest.complete_art_plan.requirements_path,
      ),
      production_art_plan_file: resolve(
        workspace,
        manifest.complete_art_plan.plan_path,
      ),
    });
    expect(completeArtJob)
      .not.toHaveProperty('production_art_requirements_binding_file');
    const { stdout: completeArtDryRunStdout } =
      await execFileAsync(process.execPath, [
        resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
        resolve(process.cwd(), 'scripts/run-production-art-workflow.ts'),
        '--job',
        completeArtJobPath,
      ], {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    expect(JSON.parse(completeArtDryRunStdout)).toMatchObject({
      status: 'ready',
      mode: 'dry-run',
      profile,
      total_tasks: manifest.complete_art_plan.task_count,
      remote_request_count_this_invocation: 0,
    });
    const { stdout: completeWorldSessionStdout } =
      await execFileAsync(process.execPath, [
        resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
        resolve(
          process.cwd(),
          'scripts/run-complete-world-execution-session.ts',
        ),
        '--job',
        completeArtJobPath,
      ], {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    expect(JSON.parse(completeWorldSessionStdout)).toMatchObject({
      document_type: 'complete-world-execution-dry-run',
      mode: 'dry-run',
      remote_request_count: 0,
      preview: {
        profile,
        scope: 'scene-direction-only',
        maximum_remote_requests: 1,
        executable: true,
        retry_policy: 'never',
      },
    });
    const assetRequirements = JSON.parse(await readFile(
      resolve(workspace, 'asset-requirements.json'),
      'utf8',
    ));
    const requirementsBinding = JSON.parse(await readFile(
      resolve(workspace, 'production-art-requirements-binding.json'),
      'utf8',
    ));
    expect(assetRequirements).toMatchObject({
      document_type: 'asset-requirements',
      profile,
    });
    expect(requirementsBinding).toMatchObject({
      document_type: 'production-art-requirements-binding',
      profile,
    });
    expect(requirementsBinding.source.asset_requirements_sha256)
      .toMatch(/^[a-f0-9]{64}$/u);
    const completeAssetRequirements =
      await materializeAssetRequirementsV1_1(JSON.parse(await readFile(
        resolve(workspace, manifest.complete_art_plan.requirements_path),
        'utf8',
      )));
    const completeProductionArtPlan =
      await materializeProductionArtPlanV1_1(JSON.parse(await readFile(
        resolve(workspace, manifest.complete_art_plan.plan_path),
        'utf8',
      )), completeAssetRequirements);
    expect(completeAssetRequirements.profile).toBe(profile);
    expect(completeProductionArtPlan.profile).toBe(profile);
    expect(completeAssetRequirements.requirements)
      .toHaveLength(manifest.complete_art_plan.requirement_count);
    expect(completeProductionArtPlan.tasks)
      .toHaveLength(manifest.complete_art_plan.task_count);
    expect(await fingerprintAssetRequirementsV1_1(
      completeAssetRequirements,
    )).toBe(manifest.complete_art_plan.requirements_sha256);
    expect(await fingerprintProductionArtPlanV1_1(
      completeProductionArtPlan,
      completeAssetRequirements,
    )).toBe(manifest.complete_art_plan.plan_sha256);
    const requiredSlots = completeAssetRequirements.requirements
      .flatMap(({ variants }) => variants)
      .length;
    const plannedSlots = completeProductionArtPlan.tasks
      .flatMap(({ slot_mappings: slots }) => slots);
    expect(plannedSlots).toHaveLength(requiredSlots);
    expect(new Set(plannedSlots.map(({ slot_id: slotId }) => slotId)).size)
      .toBe(requiredSlots);
    expect(job.private_output_root).toBe(
      resolve(root, 'private-workspace-production-art-output'),
    );
    expect(await prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace,
      characterId: 'neutral-traveler',
      completedAt: COMPLETED_AT,
    })).toEqual(manifest);
  }, 15_000);

  it('prepares a provider-neutral SpriteCook workflow without contacting it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-spritecook-workspace-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'topdown-farm');
    const workspace = resolve(root, 'private-workspace');
    const manifest = await prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace,
      characterId: 'neutral-traveler',
      provider: 'spritecook',
      model: 'gemini-3.1-flash-image',
      resolution: '2K',
      completedAt: COMPLETED_AT,
    });
    expect(manifest.remote_request_count).toBe(0);
    const jobPath = resolve(
      workspace,
      'production-art-workflow-job.json',
    );
    const job = JSON.parse(await readFile(jobPath, 'utf8'));
    expect(job).toMatchObject({
      provider: 'spritecook',
      model: 'gemini-3.1-flash-image',
      resolution: '2K',
    });
    expect(new Ajv2020().compile(workflowJobSchema)(job)).toBe(true);
    const { stdout } = await execFileAsync(process.execPath, [
      resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
      resolve(process.cwd(), 'scripts/run-production-art-workflow.ts'),
      '--job',
      jobPath,
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'dry-run',
      provider: {
        id: 'spritecook-game-art',
        model: 'gemini-3.1-flash-image',
      },
      remote_request_count_this_invocation: 0,
    });
    const completeJobPath = resolve(
      workspace,
      manifest.complete_art_plan.workflow_job_path,
    );
    const completeJob = JSON.parse(await readFile(completeJobPath, 'utf8'));
    expect(new Ajv2020().compile(workflowJobV1_1Schema)(completeJob))
      .toBe(true);
    const approvedCompleteJobPath = resolve(
      workspace,
      'complete-art/approved-workflow-job-1.1.json',
    );
    await writeFile(approvedCompleteJobPath, `${JSON.stringify({
      ...completeJob,
      approved_direction: resolve(
        workspace,
        manifest.baseline.preview_path,
      ),
    }, null, 2)}\n`);
    const { stdout: approvedStdout } = await execFileAsync(
      process.execPath,
      [
        resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
        resolve(process.cwd(), 'scripts/run-production-art-workflow.ts'),
        '--job',
        approvedCompleteJobPath,
      ],
      {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );
    const approvedSummary = JSON.parse(approvedStdout);
    expect(approvedSummary).toMatchObject({
      status: 'ready',
      mode: 'dry-run',
      provider: {
        id: 'spritecook-game-art',
        model: 'gemini-3.1-flash-image',
      },
      remote_request_count_this_invocation: 0,
    });
    expect(approvedSummary.next_task).toBeTruthy();
    const { stdout: sourceTaskDryRunStdout } =
      await execFileAsync(process.execPath, [
        resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
        resolve(process.cwd(), 'scripts/run-production-art-source.ts'),
        '--provider',
        'spritecook',
        '--profile',
        'topdown-farm',
        '--task',
        approvedSummary.next_task,
        '--asset-requirements-file',
        resolve(workspace, manifest.complete_art_plan.requirements_path),
        '--production-art-plan-file',
        resolve(workspace, manifest.complete_art_plan.plan_path),
        '--environment-reference',
        completeJob.environment_reference,
        '--environment-reference-id',
        completeJob.private_input_binding.environment_reference_id,
        '--character-reference',
        completeJob.character_reference,
        '--character-reference-id',
        completeJob.private_input_binding.character_reference_id,
      ], {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    expect(JSON.parse(sourceTaskDryRunStdout)).toMatchObject({
      mode: 'dry-run',
      provider: 'spritecook-game-art',
      profile: 'topdown-farm',
      task_id: approvedSummary.next_task,
      plan_schema_version: '1.1.0',
      remote_request_count: 0,
    });
  });

  it('blocks unresolved world requirements before any remote execution', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-blocked-workspace-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'side-platformer');
    const workspace = resolve(root, 'private-workspace');
    await prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace,
      characterId: 'neutral-traveler',
      characterIdentitySemantics: characterSemantics(intake),
      completedAt: COMPLETED_AT,
    });
    const binding = JSON.parse(await readFile(
      resolve(workspace, 'production-art-requirements-binding.json'),
      'utf8',
    ));
    expect(binding.status).toBe('blocked');
    await expect(execFileAsync(process.execPath, [
      resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
      resolve(process.cwd(), 'scripts/run-production-art-workflow.ts'),
      '--job',
      resolve(workspace, 'production-art-workflow-job.json'),
      '--execute',
      '--allow-remote-upload',
      '--max-requests',
      '1',
      '--expected-state-revision',
      '0',
      '--expected-next-task',
      'scene-direction',
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'must-not-be-used',
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Production art requirements are unresolved; remote execution is blocked.',
      ),
    });
  });

  it('fails closed when reference bytes change or an existing workspace differs', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-workspace-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'topdown-farm');
    await writeFile(resolve(root, 'references/character.png'), png(100));
    await expect(prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace: resolve(root, 'workspace'),
      characterId: 'neutral-traveler',
      completedAt: COMPLETED_AT,
    })).rejects.toThrow(/SHA-256|byteLength/u);
  });

  it('stages human-confirmed semantic identity only in the private workspace', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-workspace-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'isometric-action');
    const semantics = characterSemantics(intake);
    const workspace = resolve(root, 'private-workspace');
    const manifest = await prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace,
      characterId: 'neutral-traveler',
      characterIdentitySemantics: semantics,
      completedAt: COMPLETED_AT,
    });
    expect(manifest.files).toHaveProperty(
      'character-identity-semantics.json',
    );
    const staged = JSON.parse(await readFile(
      resolve(workspace, 'character-identity-semantics.json'),
      'utf8',
    ));
    expect(staged).toEqual(semantics);
    const job = JSON.parse(await readFile(
      resolve(workspace, 'production-art-workflow-job.json'),
      'utf8',
    ));
    expect(job.character_identity_semantics_file).toBe(
      resolve(workspace, 'character-identity-semantics.json'),
    );
    expect(new Ajv2020().compile(workflowJobSchema)(job)).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain('Magenta jacket');
    const { stdout } = await execFileAsync(process.execPath, [
      resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
      resolve(process.cwd(), 'scripts/run-production-art-workflow.ts'),
      '--job',
      resolve(workspace, 'production-art-workflow-job.json'),
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    expect(stdout).not.toContain('Magenta jacket');
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'dry-run',
      remote_request_count_this_invocation: 0,
    });

    await expect(prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace: resolve(root, 'drifted-workspace'),
      characterId: 'neutral-traveler',
      characterIdentitySemantics: {
        ...semantics,
        source_identity: {
          ...semantics.source_identity,
          identity_digest_sha256: '0'.repeat(64),
        },
      },
      completedAt: COMPLETED_AT,
    })).rejects.toThrow(/bind the selected character/u);
  });

  it('requires an explicit canonical completion instant for the baseline receipt', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-workspace-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'topdown-farm');
    await expect(prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace: resolve(root, 'workspace'),
      characterId: 'neutral-traveler',
      completedAt: 'today',
    })).rejects.toThrow(/canonical UTC ISO instant/u);
  });

  it('runs the generated job in dry-run mode with all state outside the repository', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-private-workflow-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'topdown-farm');
    const workspace = resolve(root, 'workspace');
    await prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace,
      characterId: 'neutral-traveler',
      completedAt: COMPLETED_AT,
    });
    const { stdout } = await execFileAsync(process.execPath, [
      resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
      resolve(process.cwd(), 'scripts/run-production-art-workflow.ts'),
      '--job',
      resolve(workspace, 'production-art-workflow-job.json'),
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const summary = JSON.parse(stdout) as Record<string, unknown>;
    expect(summary.mode).toBe('dry-run');
    expect(summary.remote_request_count_this_invocation).toBe(0);
    const job = JSON.parse(await readFile(
      resolve(workspace, 'production-art-workflow-job.json'),
      'utf8',
    )) as Record<string, unknown>;
    expect(new Ajv2020().compile(workflowJobSchema)(job)).toBe(true);
    expect(JSON.parse(await readFile(resolve(
      root,
      'workspace-production-art-output',
      'workflows',
      'topdown-farm',
      intake.intake_id,
      'state-000000.json',
    ), 'utf8'))).toMatchObject({
      workflow_id: intake.intake_id,
      profile: 'topdown-farm',
      requests_started: 0,
    });
    await expect(prepareWorldDeliveryWorkspace({
      intake,
      referenceRoot: root,
      workspace,
      characterId: 'neutral-traveler',
      completedAt: COMPLETED_AT,
    })).resolves.toMatchObject({
      intake_id: intake.intake_id,
      remote_request_count: 0,
    });
  });
});

function characterRevision(
  profile: WorldAssetProfile,
  atlas: Uint8Array,
): CharacterProfileRevision {
  const clips = requiredCharacterProfileClips(profile);
  const columns = clips.length;
  return {
    schema_version: CHARACTER_PROFILE_REVISION_VERSION,
    document_type: 'character-profile-revision',
    profile_revision_id: 'neutral-traveler-revision-one',
    character_id: 'neutral-traveler',
    profile,
    atlas: {
      path: 'characters/neutral-traveler.png',
      media_type: 'image/png',
      bytes: atlas.byteLength,
      sha256: sha(atlas),
      width: columns * 2,
      height: 2,
    },
    frame_geometry: {
      frame_width: 2,
      frame_height: 2,
      columns,
      rows: 1,
    },
    pivot: { x: 1, y: 1, unit: 'pixels' },
    clips: clips.map((clipId, index) => {
      const [action, direction] =
        clipId.split('.') as [CharacterAction, CharacterDirection];
      return {
        clip_id: clipId,
        action,
        direction,
        fps: 8,
        loop: true,
        frames: [{ column: index, row: 0 }],
      };
    }),
    source_identity: {
      identity_digest_sha256: 'd'.repeat(64),
      source_reference_ids: ['created-character'],
    },
    rights: {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    },
  };
}

function runtimeContract(
  profile: WorldAssetProfile,
  packSha256: string,
): PortableWorldRuntimeContract {
  return {
    schema_version: PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
    contract_id: 'mist-harbor-runtime-one',
    world: {
      world_id: 'mist-harbor-world',
      pack_id: 'mist-harbor-pack',
      pack_version: '1.0.0-review.1',
      pack_sha256: packSha256,
      profile,
      entry_scene: 'world/main.tscn',
      viewport: { width: 640, height: 360 },
    },
    spawn_points: [{ spawn_id: 'world-entry', x: 32, y: 48 }],
    entity_slots: [{
      slot_id: 'player-one',
      kind: 'player',
      required: true,
      spawn_id: 'world-entry',
      accepted_asset_kinds: ['character-atlas', 'animation-set'],
    }],
    event_hooks: [
      { hook_id: 'on-ready', event: 'runtime.ready', required: true },
      { hook_id: 'on-entered', event: 'world.entered', required: true },
      { hook_id: 'on-exited', event: 'world.exited', required: true },
    ],
  };
}

describe('World Runner delivery finalization', () => {
  it('publishes a strict schema for the exact-byte smoke evidence', () => {
    const validate = new Ajv2020({ allErrors: true }).compile(smokeReportSchema);
    const valid = {
      schema_version: '1.0.0',
      document_type: 'godot-headless-smoke-report',
      passed: true,
      godot_version: '4.3.0',
      world_id: 'mist-harbor-world',
      pack_sha256: 'a'.repeat(64),
      runtime_artifact_sha256: 'b'.repeat(64),
      launch_binding: {
        status: 'bound',
        spawn_id: 'world-entry',
        player_slot_id: 'player-one',
      },
      character_binding: {
        status: 'bound',
        profile_revision_id: 'test-character',
        revision_sha256: 'c'.repeat(64),
        atlas_sha256: 'd'.repeat(64),
      },
    };
    expect(validate(valid)).toBe(true);
    const { launch_binding: _launchBinding, ...legacyReport } = valid;
    expect(validate(legacyReport)).toBe(true);
    expect(validate({
      ...valid,
      launch_binding: {
        status: 'bound',
        spawn_id: 'World Entry',
        player_slot_id: 'player-one',
      },
    })).toBe(false);
    expect(validate({ ...valid, private_product_id: 'must-not-cross' })).toBe(false);
    expect(validate({ ...valid, passed: false })).toBe(false);
  });

  it('binds exact intake, pack, PCK, character atlas and headless report bytes', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-delivery-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'topdown-farm');
    const bundle = resolve(root, 'bundle');
    await mkdir(resolve(bundle, 'packs'), { recursive: true });
    await mkdir(resolve(bundle, 'runtime'), { recursive: true });
    await mkdir(resolve(bundle, 'characters'), { recursive: true });
    await mkdir(resolve(bundle, 'evidence'), { recursive: true });
    const pack = textBytes('frozen reviewed pack');
    const pck = textBytes('verified raspberry pi pck');
    const atlas = encodeRgbaPng(
      requiredCharacterProfileClips('topdown-farm').length * 2,
      2,
      new Uint8Array(requiredCharacterProfileClips('topdown-farm').length * 2 * 2 * 4)
        .fill(255),
    );
    const revision = characterRevision('topdown-farm', atlas);
    const revisionBytes = serializeCharacterProfileRevisionCanonical(revision);
    const contract = runtimeContract('topdown-farm', sha(pack));
    const report = {
      schema_version: '1.0.0',
      document_type: 'godot-headless-smoke-report',
      passed: true,
      godot_version: '4.3.0',
      world_id: contract.world.world_id,
      pack_sha256: sha(pack),
      runtime_artifact_sha256: sha(pck),
      launch_binding: {
        status: 'bound',
        spawn_id: 'world-entry',
        player_slot_id: 'player-one',
      },
      character_binding: {
        status: 'bound',
        profile_revision_id: revision.profile_revision_id,
        revision_sha256: sha(revisionBytes),
        atlas_sha256: sha(atlas),
      },
    };
    await Promise.all([
      writeFile(resolve(bundle, 'packs/world.zip'), pack),
      writeFile(resolve(bundle, 'runtime/world.pck'), pck),
      writeFile(resolve(bundle, 'runtime/contract.json'), `${JSON.stringify(contract)}\n`),
      writeFile(
        resolve(bundle, 'characters/revision.json'),
        revisionBytes,
      ),
      writeFile(resolve(bundle, revision.atlas.path), atlas),
      writeFile(resolve(bundle, 'evidence/smoke.json'), `${JSON.stringify(report)}\n`),
    ]);
    const output = resolve(root, 'delivery.json');
    const delivery = await finalizeWorldRunnerDelivery({
      intake,
      bundleRoot: bundle,
      worldPackPath: 'packs/world.zip',
      runtimeArtifact: {
        kind: 'godot-pck',
        architecture: 'arm64',
        path: 'runtime/world.pck',
      },
      runtimeContractPath: 'runtime/contract.json',
      characterRevisionPath: 'characters/revision.json',
      verificationReportPath: 'evidence/smoke.json',
      deliveryId: 'mist-harbor-delivery-one',
      spawnId: 'world-entry',
      playerSlotId: 'player-one',
      outputPath: output,
    });
    expect(delivery.target).toBe('raspberry-pi-4b');
    expect(delivery.world_pack.sha256).toBe(sha(pack));
    expect(delivery.runtime_artifact.sha256).toBe(sha(pck));
    expect(delivery.character_profile_revision.identity_digest_sha256)
      .toBe(intake.character_source.identity_digest_sha256);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(delivery);

    await writeFile(resolve(bundle, 'evidence/smoke.json'), `${JSON.stringify({
      ...report,
      launch_binding: {
        ...report.launch_binding,
        spawn_id: 'different-entry',
      },
    })}\n`);
    await expect(finalizeWorldRunnerDelivery({
      intake,
      bundleRoot: bundle,
      worldPackPath: 'packs/world.zip',
      runtimeArtifact: {
        kind: 'godot-pck',
        architecture: 'arm64',
        path: 'runtime/world.pck',
      },
      runtimeContractPath: 'runtime/contract.json',
      characterRevisionPath: 'characters/revision.json',
      verificationReportPath: 'evidence/smoke.json',
      deliveryId: 'mist-harbor-delivery-two',
      spawnId: 'world-entry',
      playerSlotId: 'player-one',
      outputPath: resolve(root, 'different-delivery.json'),
    })).rejects.toThrow(/requested launch spawn and player slot/u);

    const {
      launch_binding: _launchBinding,
      ...reportWithoutLaunchBinding
    } = report;
    await writeFile(
      resolve(bundle, 'evidence/smoke.json'),
      `${JSON.stringify(reportWithoutLaunchBinding)}\n`,
    );
    await expect(finalizeWorldRunnerDelivery({
      intake,
      bundleRoot: bundle,
      worldPackPath: 'packs/world.zip',
      runtimeArtifact: {
        kind: 'godot-pck',
        architecture: 'arm64',
        path: 'runtime/world.pck',
      },
      runtimeContractPath: 'runtime/contract.json',
      characterRevisionPath: 'characters/revision.json',
      verificationReportPath: 'evidence/smoke.json',
      deliveryId: 'mist-harbor-delivery-three',
      spawnId: 'world-entry',
      playerSlotId: 'player-one',
      outputPath: resolve(root, 'missing-launch-delivery.json'),
    })).rejects.toThrow(/missing or does not bind/u);
  });

  it('rejects a changed atlas', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-delivery-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'topdown-farm');
    const bundle = resolve(root, 'bundle');
    await mkdir(resolve(bundle, 'packs'), { recursive: true });
    await mkdir(resolve(bundle, 'runtime'), { recursive: true });
    await mkdir(resolve(bundle, 'characters'), { recursive: true });
    await mkdir(resolve(bundle, 'evidence'), { recursive: true });
    const pack = textBytes('pack');
    const pck = textBytes('pck');
    const atlas = png(15);
    const revision = characterRevision('topdown-farm', atlas);
    const contract = runtimeContract('topdown-farm', sha(pack));
    await Promise.all([
      writeFile(resolve(bundle, 'packs/world.zip'), pack),
      writeFile(resolve(bundle, 'runtime/world.pck'), pck),
      writeFile(resolve(bundle, 'runtime/contract.json'), JSON.stringify(contract)),
      writeFile(
        resolve(bundle, 'characters/revision.json'),
        serializeCharacterProfileRevisionCanonical(revision),
      ),
      writeFile(resolve(bundle, revision.atlas.path), png(200)),
      writeFile(resolve(bundle, 'evidence/smoke.json'), JSON.stringify({
        schema_version: '1.0.0',
        document_type: 'godot-headless-smoke-report',
        passed: true,
        godot_version: '4.3.0',
        world_id: contract.world.world_id,
        pack_sha256: sha(pack),
        runtime_artifact_sha256: 'f'.repeat(64),
        launch_binding: {
          status: 'bound',
          spawn_id: 'world-entry',
          player_slot_id: 'player-one',
        },
      })),
    ]);
    await expect(finalizeWorldRunnerDelivery({
      intake,
      bundleRoot: bundle,
      worldPackPath: 'packs/world.zip',
      runtimeArtifact: {
        kind: 'godot-pck',
        architecture: 'arm64',
        path: 'runtime/world.pck',
      },
      runtimeContractPath: 'runtime/contract.json',
      characterRevisionPath: 'characters/revision.json',
      verificationReportPath: 'evidence/smoke.json',
      deliveryId: 'mist-harbor-delivery-one',
      spawnId: 'world-entry',
      playerSlotId: 'player-one',
      outputPath: resolve(root, 'delivery.json'),
    })).rejects.toThrow(/Character atlas/u);
  });

  it('rejects a report for different PCK bytes', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-delivery-'));
    roots.push(root);
    const intake = await intakeFixture(root, 'topdown-farm');
    const bundle = resolve(root, 'bundle');
    await Promise.all([
      mkdir(resolve(bundle, 'packs'), { recursive: true }),
      mkdir(resolve(bundle, 'runtime'), { recursive: true }),
      mkdir(resolve(bundle, 'characters'), { recursive: true }),
      mkdir(resolve(bundle, 'evidence'), { recursive: true }),
    ]);
    const pack = textBytes('pack');
    const pck = textBytes('pck');
    const atlas = encodeRgbaPng(
      requiredCharacterProfileClips('topdown-farm').length * 2,
      2,
      new Uint8Array(requiredCharacterProfileClips('topdown-farm').length * 2 * 2 * 4)
        .fill(255),
    );
    const revision = characterRevision('topdown-farm', atlas);
    const contract = runtimeContract('topdown-farm', sha(pack));
    await Promise.all([
      writeFile(resolve(bundle, 'packs/world.zip'), pack),
      writeFile(resolve(bundle, 'runtime/world.pck'), pck),
      writeFile(resolve(bundle, 'runtime/contract.json'), JSON.stringify(contract)),
      writeFile(
        resolve(bundle, 'characters/revision.json'),
        serializeCharacterProfileRevisionCanonical(revision),
      ),
      writeFile(resolve(bundle, revision.atlas.path), atlas),
      writeFile(resolve(bundle, 'evidence/smoke.json'), JSON.stringify({
        schema_version: '1.0.0',
        document_type: 'godot-headless-smoke-report',
        passed: true,
        godot_version: '4.3.0',
        world_id: contract.world.world_id,
        pack_sha256: sha(pack),
        runtime_artifact_sha256: 'f'.repeat(64),
        launch_binding: {
          status: 'bound',
          spawn_id: 'world-entry',
          player_slot_id: 'player-one',
        },
      })),
    ]);
    await expect(finalizeWorldRunnerDelivery({
      intake,
      bundleRoot: bundle,
      worldPackPath: 'packs/world.zip',
      runtimeArtifact: {
        kind: 'godot-pck',
        architecture: 'arm64',
        path: 'runtime/world.pck',
      },
      runtimeContractPath: 'runtime/contract.json',
      characterRevisionPath: 'characters/revision.json',
      verificationReportPath: 'evidence/smoke.json',
      deliveryId: 'mist-harbor-delivery-one',
      spawnId: 'world-entry',
      playerSlotId: 'player-one',
      outputPath: resolve(root, 'delivery.json'),
    })).rejects.toThrow(/exact pack and runtime artifact/u);
    const duplicateKeyReport = JSON.stringify({
      schema_version: '1.0.0',
      document_type: 'godot-headless-smoke-report',
      passed: true,
      godot_version: '4.3.0',
      world_id: contract.world.world_id,
      pack_sha256: sha(pack),
      runtime_artifact_sha256: sha(pck),
    }).replace(
      '"pack_sha256":',
      `"pack_sha256":"${'a'.repeat(64)}","pack_sha256":`,
    );
    await writeFile(resolve(bundle, 'evidence/smoke.json'), duplicateKeyReport);
    await expect(finalizeWorldRunnerDelivery({
      intake,
      bundleRoot: bundle,
      worldPackPath: 'packs/world.zip',
      runtimeArtifact: {
        kind: 'godot-pck',
        architecture: 'arm64',
        path: 'runtime/world.pck',
      },
      runtimeContractPath: 'runtime/contract.json',
      characterRevisionPath: 'characters/revision.json',
      verificationReportPath: 'evidence/smoke.json',
      deliveryId: 'mist-harbor-delivery-one',
      spawnId: 'world-entry',
      playerSlotId: 'player-one',
      outputPath: resolve(root, 'delivery.json'),
    })).rejects.toThrow(/repeats the object key/u);
  });
});

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
