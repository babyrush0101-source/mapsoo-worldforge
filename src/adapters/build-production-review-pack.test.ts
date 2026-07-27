import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import reviewSchema from '../../schemas/mapsoo-production-art-pack-review-1.0.schema.json';
import reviewManifestSchema from '../../schemas/mapsoo-production-review-pack-manifest-1.0.schema.json';
import { encodeRgbaPng } from './canvas/encode-png';
import {
  buildProductionReviewPack,
  ProductionReviewPackError,
  type ProductionReviewBasePackArtifact,
} from './build-production-review-pack';
import {
  materializeProductionArtRunInventory,
} from './materialize-production-art-run-inventory';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';
import { buildAlpha9WorldAssetPack } from './export-world-asset-pack-alpha9';
import { buildAlpha10WorldAssetPack } from './export-world-asset-pack-alpha10';
import { buildAlpha11WorldAssetPack } from './export-world-asset-pack-alpha11';
import { extractCharacterIdentitySignature } from '../core/character-identity-signature';
import {
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtTask,
} from '../core/production-art-contract';
import { createProductionArtRunSet } from '../core/production-art-run-set';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import { runWorldAssetProvider } from '../core/world-asset-provider';
import type { WorldAssetProfile } from '../core/asset-profile';
import {
  buildWorldLayoutPlanFromConfirmedIntake,
  type WorldLayoutPlan,
} from '../core/world-layout-plan';
import { createConfirmedWorldCreationIntake } from '../core/confirmed-world-creation-intake';
import { PROCEDURAL_TOPDOWN_FARM_PROVIDER } from '../providers/procedural-topdown-farm-provider';
import { PROCEDURAL_SIDE_PLATFORMER_PROVIDER } from '../providers/procedural-side-platformer-provider';
import { PROCEDURAL_ISOMETRIC_ACTION_PROVIDER } from '../providers/procedural-isometric-action-provider';

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

function color(index: number): readonly [number, number, number] {
  return [
    32 + (index * 53) % 192,
    32 + (index * 97) % 192,
    32 + (index * 149) % 192,
  ];
}

function fillRect(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
  rectangleWidth: number,
  rectangleHeight: number,
  value: readonly [number, number, number],
): void {
  for (let row = y; row < y + rectangleHeight; row += 1) {
    for (let column = x; column < x + rectangleWidth; column += 1) {
      const offset = (row * width + column) * 4;
      rgba[offset] = value[0];
      rgba[offset + 1] = value[1];
      rgba[offset + 2] = value[2];
      rgba[offset + 3] = 255;
    }
  }
}

function syntheticTaskPng(task: ProductionArtTask, taskIndex: number): Uint8Array {
  const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  const rgba = new Uint8Array(width * height * 4);
  if (task.alpha_policy === 'opaque') {
    fillRect(rgba, width, 0, 0, width, height, color(taskIndex + 1));
    return encodeRgbaPng(width, height, rgba);
  }
  const mapped = task.pose_mappings ?? task.role_mappings.map((mapping, index) => ({
    grid_cell: {
      column: mapping.grid_rect.column,
      row: mapping.grid_rect.row,
    },
    frame_index: index,
  }));
  mapped.forEach((mapping, index) => {
    const marginX = Math.max(1, Math.floor(cellWidth / 8));
    const marginY = Math.max(1, Math.floor(cellHeight / 8));
    fillRect(
      rgba,
      width,
      mapping.grid_cell.column * cellWidth + marginX,
      mapping.grid_cell.row * cellHeight + marginY,
      cellWidth - marginX * 2,
      cellHeight - marginY * 2,
      color(taskIndex * 113 + index + 1),
    );
  });
  return encodeRgbaPng(width, height, rgba);
}

async function normalizedResult(
  task: ProductionArtTask,
  planId: string,
  profile: WorldAssetProfile,
  taskIndex: number,
): Promise<NormalizedProductionArtResult> {
  const png = syntheticTaskPng(task, taskIndex);
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
  const image = {
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
      id: 'synthetic-review-provider',
      version: '1.0.0',
      documentation_url: 'https://example.com/provider',
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    },
    plan_id: planId,
    profile,
    task_id: task.task_id,
    model: 'synthetic-review-model',
    workflow: 'recorded-replay',
    provider_request_id: `request-${profile}-${taskIndex}`,
    source: image,
    normalized: { ...image, alpha_policy: task.alpha_policy },
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

async function productionInput(profile: WorldAssetProfile) {
  const plan = createProductionArtPlan(profile, rights);
  const entries = await Promise.all(plan.tasks.map(async (task, index) => [
    task.task_id,
    await normalizedResult(task, plan.plan_id, profile, index),
  ] as const));
  const runSet = createProductionArtRunSet(
    plan,
    Object.fromEntries(plan.tasks.map(({ task_id: taskId }) => [
      taskId,
      `./runs/${taskId}`,
    ])),
  );
  const inventory = await materializeProductionArtRunInventory(
    plan,
    runSet,
    Object.fromEntries(entries),
  );
  return { plan, inventory };
}

async function boundRequest(profile: WorldAssetProfile) {
  const environmentRgba = Uint8Array.from([
    30, 110, 70, 255,
    60, 90, 150, 255,
    180, 120, 60, 255,
    20, 30, 45, 255,
  ]);
  const characterRgba = Uint8Array.from([
    200, 60, 90, 255,
    230, 180, 130, 255,
    45, 70, 150, 255,
    20, 25, 35, 255,
  ]);
  const environment = encodeRgbaPng(2, 2, environmentRgba);
  const character = encodeRgbaPng(2, 2, characterRgba);
  const descriptor = async (
    role: 'environment-style' | 'character',
    bytes: Uint8Array,
  ) => ({
    id: `${role}-reference`,
    role,
    path: `private/review/${role}.png`,
    mediaType: 'image/png' as const,
    byteLength: bytes.byteLength,
    width: 2,
    height: 2,
    sha256: await sha256(bytes),
    rights: {
      basis: 'owned' as const,
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true as const,
      allowOutputRedistribution: true as const,
      allowOutputCc0Dedication: true as const,
    },
  });
  const bound = await bindGenerationRequestV2({
    schemaVersion: '1.0.0',
    id: `review-base-${profile}`,
    profile,
    description: 'Private review fixture description.',
    seed: `review-base-${profile}-seed`,
    references: [
      await descriptor('environment-style', environment),
      await descriptor('character', character),
    ],
  }, [
    { path: 'private/review/environment-style.png', bytes: environment },
    { path: 'private/review/character.png', bytes: character },
  ]);
  return { bound, characterRgba };
}

async function basePack(
  profile: WorldAssetProfile,
  includeLayout = false,
): Promise<ProductionReviewBasePackArtifact> {
  const { bound, characterRgba } = await boundRequest(profile);
  const layout: WorldLayoutPlan | undefined = includeLayout
    ? await buildWorldLayoutPlanFromConfirmedIntake(
      await createConfirmedWorldCreationIntake({
      intake_id: `review-layout-${profile}`,
      session_revision: 4,
      profile,
      target: 'desktop',
      seed: bound.request.seed,
      facts: {
        premise: 'A compact production review world.',
        worldview: 'Routes and landmarks preserve the confirmed world logic.',
        terrain: 'Profile-specific terrain supports the complete route.',
        geography: 'Spawn, landmarks, and exit form one connected route.',
        culture: 'Architecture and props share one readable visual language.',
        ecology: 'Weather and vegetation reinforce the profile.',
        mood: 'Readable, coherent, and suitable for internal review.',
        art_direction: 'Consistent scale, palette, materials, and lighting.',
        traversal: 'The player can reach every landmark and the exit.',
        landmarks: 'Two distinctive landmarks anchor the route.',
      },
      character_source: {
        reference_id: bound.request.references[1].id,
        identity_digest_sha256: 'a'.repeat(64),
      },
      references: bound.request.references,
      approved_intent_preview_sha256: 'b'.repeat(64),
    }),
    )
    : undefined;
  if (profile === 'topdown-farm') {
    const run = await runWorldAssetProvider(PROCEDURAL_TOPDOWN_FARM_PROVIDER, bound);
    const pack = await buildAlpha9WorldAssetPack(
      run,
      bound.request,
      '2026-07-27T22:00:00.000Z',
      layout,
    );
    return { byteLength: pack.bytes.byteLength, readBytes: () => pack.bytes.slice() };
  }
  if (profile === 'side-platformer') {
    const run = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, bound);
    const pack = await buildAlpha10WorldAssetPack(
      run,
      bound.request,
      '2026-07-27T22:00:00.000Z',
      undefined,
      layout,
    );
    return { byteLength: pack.bytes.byteLength, readBytes: () => pack.bytes.slice() };
  }
  const run = await runWorldAssetProvider(PROCEDURAL_ISOMETRIC_ACTION_PROVIDER, {
    ...bound,
    characterIdentity: await extractCharacterIdentitySignature({
      width: 2,
      height: 2,
      rgba: characterRgba,
    }),
  });
  const pack = await buildAlpha11WorldAssetPack(
    run,
    bound.request,
    '2026-07-27T22:00:00.000Z',
    undefined,
    layout,
  );
  return { byteLength: pack.bytes.byteLength, readBytes: () => pack.bytes.slice() };
}

const cases = [
  'topdown-farm',
  'side-platformer',
  'isometric-action',
] as const;

describe('three-profile production review pack builder', () => {
  it('preserves a base layout and its seed in the final review pack', async () => {
    const profile = 'side-platformer';
    const [{ plan, inventory }, base] = await Promise.all([
      productionInput(profile),
      basePack(profile, true),
    ]);
    const review = await buildProductionReviewPack(plan, inventory, base, {
      packId: 'neutral-side-layout-review',
      title: 'Neutral Side Layout Review',
      createdAt: '2026-07-27T23:00:00.000Z',
    });
    expect(review.manifest.provenance.seed).toBe('review-base-side-platformer-seed');
    expect(review.manifest.layout).toMatchObject({
      document_type: 'world-layout-plan',
      path: 'world-layout-plan.json',
    });
    const validatePack = new Ajv2020({
      strict: true,
      strictTypes: false,
      allErrors: true,
    });
    addFormats(validatePack);
    const validate = validatePack.compile(reviewManifestSchema);
    expect(validate(review.manifest), JSON.stringify(validate.errors)).toBe(true);
    const archive = await JSZip.loadAsync(review.bytes);
    const layoutPath = Object.keys(archive.files).find((path) =>
      path.endsWith('/world-layout-plan.json'));
    expect(layoutPath).toBeTruthy();
  }, 15_000);

  it.each(cases)(
    'projects a complete deterministic %s model-art inventory into its Godot pack',
    async (profile) => {
      const [{ plan, inventory }, base] = await Promise.all([
        productionInput(profile),
        basePack(profile),
      ]);
      const options = {
        packId: `neutral-${profile}-review`,
        title: `Neutral ${profile} Review`,
        createdAt: '2026-07-27T23:00:00.000Z',
      };
      const first = await buildProductionReviewPack(plan, inventory, base, options);
      const replay = await buildProductionReviewPack(plan, inventory, base, options);
      expect(first.bytes).toEqual(replay.bytes);
      expect(first.manifest.license.output).toEqual({
        id: 'LicenseRef-UNRELEASED',
        notice_path: 'license-assets.md',
        permits_redistribution: false,
      });
      expect(first.manifest.provenance).toMatchObject({
        output_provenance: 'hybrid',
        contains_generative_ai: true,
        human_curated: false,
      });
      expect(first.review.source_outputs).toHaveLength(plan.tasks.length);
      expect(first.review.files.flatMap(({ roles }) => roles).sort()).toEqual(
        plan.tasks.flatMap(({ role_mappings: mappings }) =>
          mappings.map(({ role }) => role)).sort(),
      );
      expect(first.review.gates).toEqual({
        human_art: 'pending',
        rights: 'pending',
        runtime: 'pending',
        raspberry_pi: 'pending',
      });

      const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
      addFormats(ajv);
      const validatePack = ajv.compile(reviewManifestSchema);
      const validateReview = ajv.compile(reviewSchema);
      expect(validatePack(first.manifest), JSON.stringify(validatePack.errors)).toBe(true);
      expect(validateReview(first.review), JSON.stringify(validateReview.errors)).toBe(true);

      const archive = await JSZip.loadAsync(first.bytes);
      const names = Object.keys(archive.files);
      const manifestPath = names.find((name) => name.endsWith('/mapsoo.manifest.json'))!;
      const root = manifestPath.slice(0, -'mapsoo.manifest.json'.length);
      expect(names.sort()).toEqual([
        manifestPath,
        ...first.manifest.files.map(({ path }) => `${root}${path}`),
      ].sort());
      expect(names).not.toContain(`${root}generation-receipt.json`);
      expect(names.some((name) => /\/schema\/mapsoo-pack-0\.[678]\.schema\.json$/.test(name))).toBe(false);
      expect(names).toContain(`${root}schema/mapsoo-production-review-pack-manifest-1.0.schema.json`);
      const reviewText = await archive.file(`${root}production-art-review.json`)!.async('string');
      const licenseText = await archive.file(`${root}license-assets.md`)!.async('string');
      expect(JSON.parse(reviewText)).toEqual(first.review);
      expect(licenseText).toContain('not licensed for redistribution');
      const exposed = await Promise.all(names
        .filter((name) => /\.(?:json|md)$/.test(name))
        .map((name) => archive.file(name)!.async('string')));
      expect(exposed.join('\n')).not.toContain('private/review');
      expect(exposed.join('\n')).not.toContain('Private review fixture description');
    },
    30_000,
  );

  it('rejects a base pack from another profile before projection', async () => {
    const [{ plan, inventory }, base] = await Promise.all([
      productionInput('topdown-farm'),
      basePack('side-platformer'),
    ]);
    await expect(buildProductionReviewPack(plan, inventory, base, {
      packId: 'wrong-profile-review',
      title: 'Wrong Profile Review',
      createdAt: '2026-07-27T23:00:00.000Z',
    })).rejects.toThrowError(expect.objectContaining<Partial<ProductionReviewPackError>>({
      code: 'production-review.profile',
    }));
  });
});
