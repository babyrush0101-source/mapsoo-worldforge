import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import committedManifest from '../../tests/fixtures/pack10-public/mapsoo.manifest.json';
import {
  Pack10ProductionReviewCandidateError,
  buildPack10ProductionReviewCandidate,
  type Pack10ProductionEnvironmentArtifact,
} from './build-pack10-production-review-candidate';
import type { Pack10CharacterReviewArtifact } from './build-pack10-character-review-candidate';
import { encodeRgbaPng } from './canvas/encode-png';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';
import {
  projectLayeredDepthProductionAtlases,
} from './project-layered-depth-production-atlases';
import {
  projectLayeredDepthProductionCharacter,
} from './project-layered-depth-production-character';
import {
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
import { createConfirmedWorldCreationIntake } from '../core/confirmed-world-creation-intake';
import { buildWorldLayoutPlanFromConfirmedIntake } from '../core/world-layout-plan';

// @ts-expect-error The public privacy helper is intentionally plain ESM.
import { containsPrivateConsumerToken } from '../../scripts/lib/private-consumer-boundary.mjs';

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
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

async function layeredLayoutPlan() {
  const rights = {
    basis: 'owned' as const,
    license: 'CC0-1.0',
    allowGenerativeAdaptation: true as const,
    allowOutputRedistribution: true as const,
    allowOutputCc0Dedication: true as const,
  };
  const references = [
    {
      id: 'environment-reference',
      role: 'environment-style' as const,
      path: 'references/environment.png',
      mediaType: 'image/png' as const,
      byteLength: 10,
      width: 2,
      height: 2,
      sha256: '1'.repeat(64),
      rights,
    },
    {
      id: 'character-reference',
      role: 'character' as const,
      path: 'references/character.png',
      mediaType: 'image/png' as const,
      byteLength: 10,
      width: 2,
      height: 2,
      sha256: '2'.repeat(64),
      rights,
    },
  ] as const;
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: 'neutral-layered-layout-intake',
    session_revision: 4,
    profile: 'layered-depth-2d',
    target: 'raspberry-pi-4b',
    seed: 'neutral-layered-layout-seed',
    facts: {
      premise: 'Restore a compact lantern route.',
      worldview: 'Lantern guilds preserve safe passage.',
      terrain: 'Stone lanes and shallow reed beds.',
      geography: 'One readable route connects pier and gate.',
      culture: 'Craft workers share a covered market.',
      ecology: 'Rain, salt grass, gulls, and fog.',
      mood: 'Quiet and readable.',
      art_direction: 'Original hand-painted pixel art.',
      traversal: 'Cross two landmarks before the exit.',
      landmarks: 'Bell buoy; leaning tower',
    },
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: '3'.repeat(64),
    },
    references,
    approved_intent_preview_sha256: '4'.repeat(64),
  });
  return buildWorldLayoutPlanFromConfirmedIntake(intake);
}

async function basePack(): Promise<Uint8Array> {
  const manifest = structuredClone(committedManifest) as unknown as DeepMutable<Pack10Manifest>;
  const payloads = new Map<string, Uint8Array>();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const record = manifest.files[index];
    let bytes: Uint8Array;
    if (record.media_type === 'image/png') {
      const [width, height] = baseRasterSize(manifest, record.path);
      bytes = baseSolidPng(width, height, index);
    } else if (record.media_type === 'text/markdown') {
      bytes = new TextEncoder().encode('# Synthetic fixture\n\nPublic test fixture asset notice.\n');
    } else {
      bytes = baseJson(record.path);
    }
    payloads.set(record.path, bytes);
    record.bytes = bytes.byteLength;
    record.sha256 = await sha256(bytes);
  }
  expect(validatePack10Manifest(manifest)).toEqual([]);
  const archive = new JSZip();
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  archive.file('mapsoo.manifest.json', manifestBytes, {
    binary: true,
    createFolders: false,
    date: ZIP_DATE,
  });
  for (const record of manifest.files) {
    archive.file(record.path, payloads.get(record.path) as Uint8Array, {
      binary: true,
      createFolders: false,
      date: ZIP_DATE,
    });
  }
  return archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
}

function baseSolidPng(width: number, height: number, marker: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set([40 + marker % 150, 70, 100, 255], offset);
  }
  return encodeRgbaPng(width, height, rgba);
}

function baseRasterSize(
  manifest: Pack10Manifest,
  path: string,
): readonly [number, number] {
  if (manifest.planes.some((plane) => plane.path === path)) return [320, 180];
  const preview = manifest.roles.find(({ role }) => role === 'world.preview');
  if (preview?.binding.kind === 'file' && preview.binding.path === path) return [320, 180];
  const atlas = manifest.atlases.find((candidate) => candidate.path === path);
  if (!atlas) return [1, 1];
  let width = atlas.cell_size[0];
  let height = atlas.cell_size[1];
  for (const role of manifest.roles) {
    if (role.binding.kind === 'atlas-region' && role.binding.atlas === atlas.id) {
      width = Math.max(width, role.binding.region.x + role.binding.region.width);
      height = Math.max(height, role.binding.region.y + role.binding.region.height);
    }
  }
  for (const character of manifest.characters) {
    if (character.atlas !== path) continue;
    for (const frame of character.clips.flatMap(({ frames }) => frames)) {
      width = Math.max(width, frame.x + character.frame_size[0]);
      height = Math.max(height, frame.y + character.frame_size[1]);
    }
  }
  return [width, height];
}

function baseJson(path: string): Uint8Array {
  const encoder = new TextEncoder();
  if (path === 'runtime/scene.json') {
    return encoder.encode(`${JSON.stringify({
      schema_version: 'fixture-scene/1.0',
      synthetic: true,
      canvas: { width: 320, height: 180 },
      spawn: { x: 32, y: 132 },
      placements: [
        { id: 'entry', role: 'structure.entrance', x: 32, y: 132 },
        { id: 'goal', role: 'structure.exit', x: 288, y: 132 },
        { id: 'player', role: 'character.player.atlas', x: 48, y: 132 },
        { id: 'guide', role: 'character.npc.atlas', x: 208, y: 132 },
      ],
    }, null, 2)}\n`);
  }
  if (path === 'runtime/collision.json') {
    return encoder.encode(`${JSON.stringify({
      schema_version: 'fixture-collision/1.0',
      synthetic: true,
      bounds: { x: 0, y: 0, width: 320, height: 180 },
      solids: [{ id: 'ground', x: 0, y: 148, width: 320, height: 32 }],
    }, null, 2)}\n`);
  }
  if (path === 'runtime/navigation.json') {
    return encoder.encode(`${JSON.stringify({
      schema_version: 'fixture-navigation/1.0',
      synthetic: true,
      nodes: [
        { id: 'spawn', x: 32, y: 132 },
        { id: 'exit', x: 288, y: 132 },
      ],
      edges: [{ from: 'spawn', to: 'exit' }],
    }, null, 2)}\n`);
  }
  return encoder.encode(`${JSON.stringify({
    schema_version: 'fixture-provenance/1.0',
    synthetic: true,
    generative_ai: false,
  }, null, 2)}\n`);
}

function directionPng(task: ProductionArtTask): Uint8Array {
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set([38, 64, 92, 255], offset);
  }
  return encodeRgbaPng(task.target.width, task.target.height, rgba);
}

function layerPng(task: ProductionArtTask, marker: number): Uint8Array {
  if (task.alpha_policy === 'opaque') return directionPng(task);
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  const left = 80 + marker;
  const right = task.target.width - 80 - marker;
  const top = 60 + marker;
  const bottom = task.target.height - 60 - marker;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
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
  if (!task.pose_mappings) throw new Error('Character fixture task has no poses.');
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
        rgba.set(
          color,
          ((top + y) * task.target.width + left + x) * 4,
        );
      }
    }
  });
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
      id: 'fixture-production-provider',
      version: '1.0.0',
      documentation_url: 'https://example.com/fixture-production-provider',
      execution: 'remote',
      provenance: 'generative-ai',
      determinism: 'best-effort',
    },
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    model: 'fixture-production-model',
    workflow: 'image-edit',
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

async function productionInputs(): Promise<{
  readonly player: Pack10CharacterReviewArtifact;
  readonly npc: Pack10CharacterReviewArtifact;
  readonly environment: Pack10ProductionEnvironmentArtifact;
}> {
  const plan = createProductionArtPlan('layered-depth-2d', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const byId = new Map(plan.tasks.map((task) => [task.task_id, task]));
  const directionTask = byId.get('scene-direction');
  if (!directionTask) throw new Error('Direction task is missing.');
  const direction = await normalizedResult(
    plan,
    directionTask,
    directionPng(directionTask),
    ['synthetic-environment', 'synthetic-character'],
  );
  const layerTasks = plan.tasks.filter(({ kind }) => kind === 'background-layer');
  const layerResults = await Promise.all(layerTasks.map((task, index) => normalizedResult(
    plan,
    task,
    layerPng(task, index + 1),
    ['approved-scene-direction'],
  )));
  const sheetTasks = ['terrain-sheet', 'prop-sheet', 'effect-sheet'].map((taskId) => {
    const task = byId.get(taskId);
    if (!task) throw new Error(`Sheet task is missing: ${taskId}.`);
    return task;
  });
  const sheetResults = await Promise.all(sheetTasks.map((task) => normalizedResult(
    plan,
    task,
    environmentSheetPng(task),
    ['approved-scene-direction'],
  )));
  const characterTasks = [
    'character-character-player-atlas',
    'character-character-npc-atlas',
  ].map((taskId) => {
    const task = byId.get(taskId);
    if (!task) throw new Error(`Character task is missing: ${taskId}.`);
    return task;
  });
  const characterResults = await Promise.all(characterTasks.map((task) => normalizedResult(
    plan,
    task,
    characterSheetPng(task),
    ['approved-scene-direction', 'synthetic-character'],
  )));
  const [layers, environmentAtlases, playerProjection, npcProjection] = await Promise.all([
    projectLayeredDepthProductionLayers(plan, direction, layerResults),
    projectLayeredDepthProductionAtlases(plan, direction, sheetResults),
    projectLayeredDepthProductionCharacter(plan, characterResults[0]),
    projectLayeredDepthProductionCharacter(plan, characterResults[1]),
  ]);
  const characterArtifact = (
    projection: Awaited<ReturnType<typeof projectLayeredDepthProductionCharacter>>,
    source: NormalizedProductionArtResult,
  ): Pack10CharacterReviewArtifact => ({
    projection: projection.record,
    character: projection.character,
    generationEvidence: source.evidence,
    atlasPngBytes: projection.png.readBytes(),
  });
  return {
    player: characterArtifact(playerProjection, characterResults[0]),
    npc: characterArtifact(npcProjection, characterResults[1]),
    environment: {
      layers,
      environmentAtlases,
      generationEvidence: [
        direction.evidence,
        ...layerResults.map(({ evidence }) => evidence),
        ...sheetResults.map(({ evidence }) => evidence),
      ],
    },
  };
}

const OPTIONS = Object.freeze({
  packId: 'neutral-production-review-world',
  title: 'Neutral Production Review World',
  version: '1.0.0-review.2',
  createdAt: '2026-07-27T20:00:00.000Z',
});
const PACK10_PRODUCTION_REVIEW_TEST_TIMEOUT_MS = 15_000;

describe('Pack 1.0 complete production-art review candidate builder', () => {
  it('builds a deterministic, privacy-minimized full visual replacement ZIP', async () => {
    const [base, inputs] = await Promise.all([basePack(), productionInputs()]);
    const [first, second] = await Promise.all([
      buildPack10ProductionReviewCandidate(
        base,
        inputs.player,
        inputs.npc,
        inputs.environment,
        OPTIONS,
      ),
      buildPack10ProductionReviewCandidate(
        base,
        inputs.player,
        inputs.npc,
        inputs.environment,
        OPTIONS,
      ),
    ]);

    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(await sha256(first.bytes));
    expect(first.manifest).toMatchObject({
      distribution: 'internal-review',
      review: {
        human_art: 'pending',
        rights: 'pending',
        runtime: 'pending',
        raspberry_pi: 'pending',
      },
      license: {
        output: {
          id: 'LicenseRef-UNRELEASED',
          permits_redistribution: false,
          permits_commercial_use: false,
        },
      },
      provenance: {
        output_provenance: 'hybrid',
        contains_generative_ai: true,
        model_provider: 'fixture-production-provider',
        model: 'fixture-production-model',
        human_curated: false,
      },
    });
    expect(validatePack10Manifest(first.manifest)).toEqual([]);
    expect(first.manifest.planes.map(({ path }) => path))
      .toEqual(inputs.environment.layers.planes.map(({ file }) => file.path));
    expect(first.manifest.atlases.slice(0, 5).map(({ cell_size: cell }) => cell)).toEqual([
      [64, 128],
      [96, 176],
      [96, 176],
      [96, 176],
      [64, 64],
    ]);
    expect(first.manifest.roles.filter(({ binding }) => binding.kind === 'atlas-region'))
      .toHaveLength(22);

    const archive = await JSZip.loadAsync(first.bytes, { checkCRC32: true });
    const paths = Object.values(archive.files).map(({ name }) => name).sort();
    expect(paths).toEqual([
      'mapsoo.manifest.json',
      ...first.manifest.files.map(({ path }) => path),
    ].sort());
    expect(paths).toContain('provenance/environment-layer-projection.json');
    expect(paths).toContain('provenance/environment-atlas-projection.json');
    expect(paths).toContain('provenance/player-projection.json');
    expect(paths).toContain('provenance/npc-projection.json');
    expect(paths.some((path) => path.includes('reference') || path.includes('prompt'))).toBe(false);
    expect(paths.some((path) => path.includes('evidence'))).toBe(false);
    const allText = await Promise.all(Object.values(archive.files)
      .filter(({ name }) => !name.endsWith('.png'))
      .map((entry) => entry.async('text')));
    expect(containsPrivateConsumerToken(allText.join('\n'))).toBe(false);
    expect(allText.join('\n')).not.toMatch(
      /@[a-z0-9.-]+\.[a-z]{2,}|\b[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var)\//i,
    );
  }, PACK10_PRODUCTION_REVIEW_TEST_TIMEOUT_MS);

  it('embeds a canonical optional WorldLayoutPlan with exact manifest bytes', async () => {
    const [base, inputs, layoutPlan] = await Promise.all([
      basePack(),
      productionInputs(),
      layeredLayoutPlan(),
    ]);
    const candidate = await buildPack10ProductionReviewCandidate(
      base,
      inputs.player,
      inputs.npc,
      inputs.environment,
      OPTIONS,
      layoutPlan,
    );
    expect(validatePack10Manifest(candidate.manifest)).toEqual([]);
    expect(candidate.manifest.layout).toMatchObject({
      schema_version: '1.0.0',
      document_type: 'world-layout-plan',
      plan_id: layoutPlan.plan_id,
      path: 'world-layout-plan.json',
    });
    expect(candidate.manifest.material_palette).toMatchObject({
      schema_version: '1.0.0',
      document_type: 'world-material-palette',
      layout_plan_sha256: candidate.manifest.layout?.sha256,
      path: 'world-material-palette.json',
    });

    const archive = await JSZip.loadAsync(candidate.bytes, { checkCRC32: true });
    const layoutBytes = await archive.file('world-layout-plan.json')!.async('uint8array');
    const layoutRecord = candidate.manifest.files.find(
      ({ path }) => path === 'world-layout-plan.json',
    );
    expect(JSON.parse(new TextDecoder().decode(layoutBytes))).toMatchObject({
      plan_id: layoutPlan.plan_id,
      profile: 'layered-depth-2d',
      source: { seed: 'neutral-layered-layout-seed' },
    });
    expect(layoutRecord).toMatchObject({
      media_type: 'application/json',
      bytes: layoutBytes.byteLength,
      sha256: await sha256(layoutBytes),
    });
    expect(candidate.manifest.layout?.sha256).toBe(await sha256(layoutBytes));
    const paletteBytes = await archive.file('world-material-palette.json')!.async('uint8array');
    const paletteRecord = candidate.manifest.files.find(
      ({ path }) => path === 'world-material-palette.json',
    );
    expect(JSON.parse(new TextDecoder().decode(paletteBytes))).toMatchObject({
      document_type: 'world-material-palette',
      profile: 'layered-depth-2d',
      layout: {
        plan_id: layoutPlan.plan_id,
        sha256: await sha256(layoutBytes),
      },
    });
    expect(paletteRecord).toMatchObject({
      media_type: 'application/json',
      bytes: paletteBytes.byteLength,
      sha256: await sha256(paletteBytes),
    });
    expect(candidate.manifest.material_palette?.sha256).toBe(await sha256(paletteBytes));
  }, PACK10_PRODUCTION_REVIEW_TEST_TIMEOUT_MS);

  it('rejects missing environment evidence and changed projected plane bytes', async () => {
    const [base, inputs] = await Promise.all([basePack(), productionInputs()]);
    await expect(buildPack10ProductionReviewCandidate(
      base,
      inputs.player,
      inputs.npc,
      {
        ...inputs.environment,
        generationEvidence: inputs.environment.generationEvidence.slice(1),
      },
      OPTIONS,
    )).rejects.toEqual(expect.objectContaining({
      code: 'production-review.invalid-environment',
    }));

    const firstPlane = inputs.environment.layers.planes[0];
    const changedLayers = {
      ...inputs.environment.layers,
      planes: [
        {
          ...firstPlane,
          png: {
            byteLength: firstPlane.png.byteLength,
            readBytes: () => {
              const bytes = firstPlane.png.readBytes();
              bytes[bytes.byteLength - 1] ^= 1;
              return bytes;
            },
          },
        },
        ...inputs.environment.layers.planes.slice(1),
      ],
    };
    await expect(buildPack10ProductionReviewCandidate(
      base,
      inputs.player,
      inputs.npc,
      { ...inputs.environment, layers: changedLayers },
      OPTIONS,
    )).rejects.toBeInstanceOf(Pack10ProductionReviewCandidateError);
  }, PACK10_PRODUCTION_REVIEW_TEST_TIMEOUT_MS);
});
