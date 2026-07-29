import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import JSZip from 'jszip';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import handoffSchema
  from '../../schemas/mapsoo-private-production-handoff-1.0.schema.json';
import handoffV1_1Schema
  from '../../schemas/mapsoo-private-production-handoff-1.1.schema.json';
import {
  buildPrivateProductionHandoff,
  readPrivateProductionHandoff,
} from './private-production-handoff';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from '../core/confirmed-world-creation-intake';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
} from '../core/world-layout-constraints';
import {
  solveWorldLayoutPlanFromConstraints,
} from '../core/world-layout-plan';

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array): string {
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

async function fixture() {
  const environmentBytes = png(30);
  const characterBytes = png(220);
  const rights = {
    basis: 'owned' as const,
    license: 'LicenseRef-User-Owned',
    allowGenerativeAdaptation: true as const,
    allowOutputRedistribution: true as const,
    allowOutputCc0Dedication: true as const,
  };
  const environment = {
    id: 'environment-reference',
    role: 'environment-style' as const,
    path: 'references/environment.png',
    mediaType: 'image/png' as const,
    byteLength: environmentBytes.byteLength,
    width: 2,
    height: 2,
    sha256: sha256(environmentBytes),
    rights,
  };
  const character = {
    id: 'character-reference',
    role: 'character' as const,
    path: 'references/character.png',
    mediaType: 'image/png' as const,
    byteLength: characterBytes.byteLength,
    width: 2,
    height: 2,
    sha256: sha256(characterBytes),
    rights,
  };
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: 'mist-harbor',
    session_revision: 8,
    profile: 'side-platformer',
    target: 'raspberry-pi-4b',
    seed: 'mist-harbor-seed',
    facts: {
      premise: 'Restore the lantern route through a flooded harbor.',
      worldview: 'Tides preserve memories and the beacon guild controls safe passage.',
      terrain: 'Wet docks, stone ledges, reed marshes, and sea caves.',
      geography: 'A direct route connects the spawn pier, market, lighthouse, and cave exit.',
      culture: 'Boat builders and lantern keepers live in timber houses on stone foundations.',
      ecology: 'Cool rain, salt grass, gulls, glowing plankton, and drifting fog.',
      mood: 'Quietly mysterious with strong silhouettes and readable hazards.',
      art_direction: 'Original hand-painted pixels, blue slate, warm lanterns, and consistent character scale.',
      traversal: 'Cross the market and lighthouse checkpoints, avoid waves, and reach the sea cave exit.',
      landmarks: 'Spawn pier, red market canopy, leaning lighthouse, luminous sea cave.',
    },
    character_source: {
      reference_id: character.id,
      identity_digest_sha256: 'd'.repeat(64),
    },
    references: [environment, character],
    approved_intent_preview_sha256: 'e'.repeat(64),
  });
  return {
    intake,
    environment: { descriptor: environment, bytes: environmentBytes },
    character: { descriptor: character, bytes: characterBytes },
  };
}

async function planningFixture(intake: ConfirmedWorldCreationIntake) {
  const layoutConstraints =
    await createWorldLayoutConstraintsFromConfirmedIntake(intake, {
      route_shape: 'loop',
      scale: 'extended',
      verticality: 'high',
      water: 'basin',
      settlement_density: 'dense',
      hazard_level: 'dangerous',
      landmark_labels: [
        'Spawn pier',
        'Red market canopy',
        'Leaning lighthouse',
        'Luminous sea cave',
      ],
    });
  const layoutPlan = await solveWorldLayoutPlanFromConstraints(
    layoutConstraints,
    intake,
  );
  return { layoutConstraints, layoutPlan };
}

describe('private production handoff archive', () => {
  it('builds a deterministic private archive and reads the exact intake and references', async () => {
    const input = await fixture();
    const first = await buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.character],
    );
    const replay = await buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.character],
    );
    expect(first.filename).toBe('mist-harbor-private-production-handoff.zip');
    expect(first.readBytes()).toEqual(replay.readBytes());
    expect(first.manifest).toMatchObject({
      intake_id: 'mist-harbor',
      profile: 'side-platformer',
      target: 'raspberry-pi-4b',
      privacy: {
        contains_original_references: true,
        public_distribution_allowed: false,
      },
      remote_request_count: 0,
    });
    expect(new Ajv2020().compile(handoffSchema)(first.manifest)).toBe(true);

    const read = await readPrivateProductionHandoff(first.readBytes());
    expect(read.intake).toEqual(input.intake);
    expect(read.references.map(({ descriptor, bytes }) => ({
      id: descriptor.id,
      sha256: sha256(bytes),
    }))).toEqual([
      {
        id: 'character-reference',
        sha256: input.character.descriptor.sha256,
      },
      {
        id: 'environment-reference',
        sha256: input.environment.descriptor.sha256,
      },
    ]);
  });

  it('freezes the exact confirmed layout and complete production inventory in a 1.1 handoff', async () => {
    const input = await fixture();
    const planning = await planningFixture(input.intake);
    const first = await buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.character],
      planning,
    );
    const replay = await buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.character],
      planning,
    );
    expect(first.readBytes()).toEqual(replay.readBytes());
    expect(first.manifest).toMatchObject({
      schema_version: '1.1.0',
      profile: 'side-platformer',
      planning: {
        requirement_count: expect.any(Number),
        task_count: expect.any(Number),
        scene_direction_requests: 1,
        approval_policy: 'scene-direction-then-complete-world',
      },
      privacy: {
        contains_original_references: true,
        contains_private_world_facts: true,
        public_distribution_allowed: false,
      },
      remote_request_count: 0,
    });
    expect(new Ajv2020().compile(handoffV1_1Schema)(first.manifest))
      .toBe(true);
    if (first.manifest.schema_version !== '1.1.0') {
      throw new Error('Expected a 1.1 handoff.');
    }
    expect(first.manifest.planning.maximum_remote_requests)
      .toBe(first.manifest.planning.task_count);

    const read = await readPrivateProductionHandoff(first.readBytes());
    expect(read.planning).toBeDefined();
    expect(read.planning?.layoutConstraints).toMatchObject({
      origin: 'confirmed-intent',
      route_shape: 'loop',
      scale: 'extended',
      verticality: 'high',
      water: 'basin',
      settlement_density: 'dense',
      hazard_level: 'dangerous',
    });
    expect(read.planning?.layoutPlan).toEqual(planning.layoutPlan);
    expect(read.planning?.assetRequirements.requirements)
      .toHaveLength(first.manifest.planning.requirement_count);
    expect(read.planning?.productionArtPlan.tasks)
      .toHaveLength(first.manifest.planning.task_count);

    const archive = await JSZip.loadAsync(first.readBytes());
    expect(Object.keys(archive.files)).toHaveLength(9);
    expect(Object.keys(archive.files)).toEqual(expect.arrayContaining([
      'mist-harbor-private-production-handoff/world-layout-constraints.json',
      'mist-harbor-private-production-handoff/world-layout-plan.json',
      'mist-harbor-private-production-handoff/complete-art/asset-requirements-1.1.json',
      'mist-harbor-private-production-handoff/complete-art/production-art-plan-1.1.json',
    ]));
  });

  it('prepares the existing zero-request workspace directly from the handoff CLI', async () => {
    const input = await fixture();
    const handoff = await buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.character],
    );
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-private-handoff-'));
    roots.push(root);
    const archivePath = resolve(root, handoff.filename);
    const workspace = resolve(root, 'workspace');
    await writeFile(archivePath, handoff.readBytes());

    const { stdout } = await execFileAsync(process.execPath, [
      resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
      resolve(process.cwd(), 'scripts/run-world-delivery-workspace.ts'),
      'prepare',
      '--handoff',
      archivePath,
      '--workspace',
      workspace,
      '--character-id',
      'harbor-traveler',
      '--completed-at',
      '2026-07-28T12:00:00.000Z',
      '--provider',
      'spritecook',
      '--resolution',
      '2K',
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    expect(JSON.parse(stdout)).toMatchObject({
      intake_id: 'mist-harbor',
      profile: 'side-platformer',
      character_id: 'harbor-traveler',
      remote_request_count: 0,
      baseline: {
        status: 'godot-import-ready',
        art_quality: 'procedural-placeholder',
        final_art_required: true,
      },
    });
    expect(JSON.parse(await readFile(
      resolve(workspace, 'production-art-workflow-job.json'),
      'utf8',
    ))).toMatchObject({
      workflow_id: 'mist-harbor',
      provider: 'spritecook',
      resolution: '2K',
    });
  });

  it('preserves 1.1 structured layout choices through the handoff CLI', async () => {
    const input = await fixture();
    const planning = await planningFixture(input.intake);
    const handoff = await buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.character],
      planning,
    );
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-private-handoff-1-1-'));
    roots.push(root);
    const archivePath = resolve(root, handoff.filename);
    const workspace = resolve(root, 'workspace');
    await writeFile(archivePath, handoff.readBytes());

    const { stdout } = await execFileAsync(process.execPath, [
      resolve(process.cwd(), 'node_modules/vite-node/vite-node.mjs'),
      resolve(process.cwd(), 'scripts/run-world-delivery-workspace.ts'),
      'prepare',
      '--handoff',
      archivePath,
      '--workspace',
      workspace,
      '--character-id',
      'harbor-traveler',
      '--completed-at',
      '2026-07-28T12:00:00.000Z',
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({
      profile: 'side-platformer',
      remote_request_count: 0,
      complete_art_plan: {
        requirement_count:
          handoff.manifest.schema_version === '1.1.0'
            ? handoff.manifest.planning.requirement_count
            : -1,
        task_count:
          handoff.manifest.schema_version === '1.1.0'
            ? handoff.manifest.planning.task_count
            : -1,
      },
    });
    expect(JSON.parse(await readFile(
      resolve(workspace, 'world-layout-constraints.json'),
      'utf8',
    ))).toMatchObject({
      origin: 'confirmed-intent',
      route_shape: 'loop',
      scale: 'extended',
      verticality: 'high',
      water: 'basin',
      settlement_density: 'dense',
      hazard_level: 'dangerous',
    });
    expect(JSON.parse(await readFile(
      resolve(workspace, 'world-layout-plan.json'),
      'utf8',
    ))).toEqual(planning.layoutPlan);
  });

  it('rejects changed reference bytes and undeclared archive files', async () => {
    const input = await fixture();
    const built = await buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.character],
    );
    const changedReference = await JSZip.loadAsync(built.readBytes());
    const characterPath = Object.keys(changedReference.files)
      .find((path) => path.endsWith('/references/character.png'));
    expect(characterPath).toBeDefined();
    changedReference.file(characterPath!, png(10), { createFolders: false });
    const changedBytes = Uint8Array.from(await changedReference.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
      streamFiles: false,
    }));
    await expect(readPrivateProductionHandoff(changedBytes))
      .rejects.toMatchObject({ code: 'private-handoff-archive.integrity' });

    const extraFile = await JSZip.loadAsync(built.readBytes());
    extraFile.file(
      'mist-harbor-private-production-handoff/private-notes.txt',
      'must not be admitted',
      { createFolders: false },
    );
    const extraBytes = Uint8Array.from(await extraFile.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
      streamFiles: false,
    }));
    await expect(readPrivateProductionHandoff(extraBytes))
      .rejects.toMatchObject({
        code: 'private-handoff-archive.invalid-inventory',
      });
  });

  it('rejects changed 1.1 planning bytes before workspace preparation', async () => {
    const input = await fixture();
    const planning = await planningFixture(input.intake);
    const built = await buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.character],
      planning,
    );
    const archive = await JSZip.loadAsync(built.readBytes());
    const planPath = Object.keys(archive.files).find((path) =>
      path.endsWith('/complete-art/production-art-plan-1.1.json'));
    expect(planPath).toBeDefined();
    archive.file(planPath!, `${JSON.stringify({
      changed: true,
    })}\n`, { createFolders: false });
    const changedBytes = Uint8Array.from(await archive.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
      streamFiles: false,
    }));
    await expect(readPrivateProductionHandoff(changedBytes))
      .rejects.toMatchObject({
        code: 'private-handoff-archive.integrity',
      });
  });

  it('rejects reference inputs that do not match the confirmed intake', async () => {
    const input = await fixture();
    await expect(buildPrivateProductionHandoff(
      input.intake,
      [
        input.environment,
        {
          ...input.character,
          bytes: png(1),
        },
      ],
    )).rejects.toMatchObject({
      code: 'private-handoff-archive.integrity',
    });
    await expect(buildPrivateProductionHandoff(
      input.intake,
      [input.environment, input.environment],
    )).rejects.toMatchObject({
      code: 'private-handoff-archive.invalid-input',
    });
  });
});
