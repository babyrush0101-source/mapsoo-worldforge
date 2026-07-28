import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import reviewedFamilySchema
  from '../../schemas/mapsoo-reviewed-character-profile-family-1.0.schema.json';

import { buildWorldArtRuntimeOverlayZip } from '../adapters/build-world-art-runtime-overlay';
import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from '../adapters/normalize-production-art-png';
import {
  projectProductionCharacterProfile,
} from '../adapters/project-production-character-profile';
import type {
  ProjectedReviewedWorldArtImage,
} from '../adapters/project-reviewed-world-art-variants';
import {
  HUMAN_ART_REVIEW_CRITERIA,
  encodeHumanArtReviewReceipt,
  type HumanArtReviewReceipt,
} from '../core/human-art-review-receipt';
import {
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtTask,
} from '../core/production-art-contract';
import {
  serializeCharacterProfileRevisionCanonical,
} from '../core/character-profile-revision';
import {
  PRODUCTION_WORLD_REVIEW_VERSION,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from '../core/production-world-review-contract';
import { buildWorldArtRuntimeProjection } from '../core/world-art-runtime-projection';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../core/asset-profile';
import {
  prepareHumanArtReviewTemplate,
  promoteHumanArtReviewWorkspace,
} from './human-art-review-workspace';
import {
  assembleReviewedCharacterProfileFamily,
  type ReviewedCharacterProfileSources,
} from './assemble-reviewed-character-profile-family';

const IDENTITY = 'b'.repeat(64);
const encoder = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function drawRect(
  rgba: Uint8Array,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: readonly [number, number, number, number],
): void {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      rgba.set(color, (y * width + x) * 4);
    }
  }
}

async function normalizedPlayer(
  profile: WorldAssetProfile,
): Promise<Readonly<{
  plan: ReturnType<typeof createProductionArtPlan>;
  task: ProductionArtTask;
  normalized: NormalizedProductionArtResult;
}>> {
  const plan = createProductionArtPlan(profile, {
    distribution: 'private',
    license: 'LicenseRef-Proprietary',
  });
  const task = plan.tasks.find(({ role_mappings: mappings }) =>
    mappings.some(({ role }) => role === 'character.player.atlas'));
  if (!task) throw new Error(`Missing player task for ${profile}.`);
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  task.pose_mappings?.forEach((pose, index) => {
    const left = pose.grid_cell.column * task.target.cell_width + 8 + index % 11;
    const bottom = pose.grid_cell.row * task.target.cell_height + task.pivot.y;
    drawRect(
      rgba,
      task.target.width,
      left,
      bottom - 24,
      left + 11 + index % 5,
      bottom,
      [
        170 + index % 80,
        10 + index % 10,
        30 + (index * 17) % 110,
        255,
      ],
    );
  });
  const png = encodeRgbaPng(task.target.width, task.target.height, rgba);
  const pngSha = await sha256(png);
  const output: ProductionArtOutput = {
    schema_version: '1.0.0',
    document_type: 'production-art-output',
    plan_id: plan.plan_id,
    profile,
    task_id: task.task_id,
    asset_id: `${task.task_id}-candidate`,
    path: task.expected_output_path,
    media_type: 'image/png',
    bytes: png.byteLength,
    sha256: pngSha,
    width: task.target.width,
    height: task.target.height,
    alpha_policy: task.alpha_policy,
    pivot: task.pivot,
    roles: task.role_mappings.map(({ role }) => role),
    source_reference_ids: ['approved-scene-direction', 'character-reference'],
    rights: plan.rights,
  };
  const evidence: ProductionArtGenerationEvidence = {
    schema_version: '1.0.0',
    document_type: 'production-art-generation-evidence',
    provider: {
      id: 'anonymous-reviewed-family-fixture',
      version: '1.0.0',
      documentation_url: 'https://example.com/fixture',
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    },
    plan_id: plan.plan_id,
    profile,
    task_id: task.task_id,
    model: 'fixture-no-model',
    workflow: 'recorded-replay',
    source: {
      media_type: 'image/png',
      bytes: png.byteLength,
      sha256: pngSha,
      width: task.target.width,
      height: task.target.height,
    },
    normalized: {
      media_type: 'image/png',
      bytes: png.byteLength,
      sha256: pngSha,
      width: task.target.width,
      height: task.target.height,
      alpha_policy: task.alpha_policy,
    },
    postprocess: {
      resize: 'nearest-neighbor-v1',
      alpha_extraction: 'edge-connected-green-chroma-v1',
      transparent_rgb_zeroed: true,
      mapped_grid_cells_checked: true,
    },
    human_review: 'required',
  };
  return {
    plan,
    task,
    normalized: {
      output,
      evidence,
      source: {
        byteLength: png.byteLength,
        readBytes: () => Uint8Array.from(png),
      },
      normalized: {
        byteLength: png.byteLength,
        readBytes: () => Uint8Array.from(png),
      },
    },
  };
}

function evidence(
  evidenceId: string,
  kind: ProductionWorldEvidence['kind'],
  index: number,
  mediaType: 'image/png' | 'video/mp4',
): ProductionWorldEvidence {
  return {
    evidence_id: evidenceId,
    kind,
    path: `review-evidence/${evidenceId}.${mediaType === 'image/png' ? 'png' : 'mp4'}`,
    media_type: mediaType,
    bytes: 1000 + index,
    sha256: String(index + 1).repeat(64),
    claim: `Anonymous exact evidence for the ${evidenceId} review gate.`,
    godot_versions: ['4.3', '4.7'],
    ...(mediaType === 'image/png' ? { width: 1280, height: 720 } : {}),
  };
}

function reviewFixture(profile: WorldAssetProfile): ProductionWorldReviewContract {
  return {
    schema_version: PRODUCTION_WORLD_REVIEW_VERSION,
    review_id: `${profile}-technical-review`,
    profile,
    world_preview: {
      path: 'review-evidence/world-preview.png',
      bytes: 2000,
      sha256: 'a'.repeat(64),
      width: 1280,
      height: 720,
    },
    evidence: [
      evidence('godot-world-capture', 'rendered-world-capture', 0, 'image/png'),
      evidence('role-overlay', 'role-placement-overlay', 1, 'image/png'),
      evidence('collision-overlay', 'art-collision-overlay', 2, 'image/png'),
      evidence('spawn-exit-route', 'spawn-exit-traversal', 3, 'video/mp4'),
      evidence('navigation-route', 'navigation-traversal', 4, 'video/mp4'),
    ],
    gates: [
      {
        gate: 'image-composition',
        status: 'technical-pass',
        evidence_ids: ['godot-world-capture'],
      },
      {
        gate: 'role-placement',
        status: 'technical-pass',
        evidence_ids: ['role-overlay'],
      },
      {
        gate: 'art-to-collision',
        status: 'technical-pass',
        evidence_ids: ['collision-overlay'],
      },
      {
        gate: 'spawn-exit',
        status: 'technical-pass',
        evidence_ids: ['spawn-exit-route'],
      },
      {
        gate: 'navigation',
        status: 'technical-pass',
        evidence_ids: ['navigation-route'],
      },
      { gate: 'human-review', status: 'pending', evidence_ids: [] },
    ],
    release_decision: 'blocked',
  };
}

function approvePrivate(receipt: HumanArtReviewReceipt): HumanArtReviewReceipt {
  return {
    ...receipt,
    criteria: HUMAN_ART_REVIEW_CRITERIA.map((criterion) => ({
      criterion,
      status: 'pass' as const,
    })),
    rights: {
      distribution: 'private',
      output_license_id: 'LicenseRef-Proprietary',
      permits_redistribution: false,
      source_authority_confirmed: true,
    },
    decision: 'approved-private',
  };
}

async function sourceFixture(profile: WorldAssetProfile) {
  const { plan, task, normalized } = await normalizedPlayer(profile);
  const projectedCharacter = await projectProductionCharacterProfile(
    plan,
    normalized,
    {
      characterId: 'anonymous-traveler',
      identityDigestSha256: IDENTITY,
      characterReferenceIds: ['character-reference'],
    },
  );
  const atlas = projectedCharacter.png.readBytes();
  const atlasSha = await sha256(atlas);
  const imagePath = `production-art/${profile}/${task.task_id}.png`;
  const poses = projectedCharacter.revision.clips.flatMap((clip) =>
    clip.frames.map((frame, frameIndex) => ({
      action: clip.action,
      direction: clip.direction,
      frame_index: frameIndex,
      duration_ms: Math.round(1000 / clip.fps),
      region: {
        x: frame.column * projectedCharacter.revision.frame_geometry.frame_width,
        y: frame.row * projectedCharacter.revision.frame_geometry.frame_height,
        width: projectedCharacter.revision.frame_geometry.frame_width,
        height: projectedCharacter.revision.frame_geometry.frame_height,
      },
    }))).sort((left, right) =>
    left.action.localeCompare(right.action, 'en')
    || left.direction.localeCompare(right.direction, 'en')
    || left.frame_index - right.frame_index);
  const region = {
    x: 0,
    y: 0,
    width: projectedCharacter.revision.atlas.width,
    height: projectedCharacter.revision.atlas.height,
  };
  const common = {
    task_id: task.task_id,
    slot_id: 'player-canonical',
    role: 'character.player.atlas',
    variant_id: 'canonical',
    image_path: imagePath,
    region,
    cell_sha256: '9'.repeat(64),
    poses,
  } as const;
  const runtimeProjection = await buildWorldArtRuntimeProjection({
    schema_version: '1.0.0',
    document_type: 'world-art-runtime-projection',
    profile,
    source: {
      variant_map_id: 'variant-map-fixture',
      variant_map_sha256: '1'.repeat(64),
      layout_plan_sha256: '2'.repeat(64),
      production_art_plan_id: plan.plan_id,
      production_art_plan_sha256: '3'.repeat(64),
      requirements_sha256: '4'.repeat(64),
      run_set_sha256: '5'.repeat(64),
      reviewed_slot_inventory_sha256: '6'.repeat(64),
      review_record_sha256: '7'.repeat(64),
    },
    rights: plan.rights,
    images: [{
      task_id: task.task_id,
      path: imagePath,
      media_type: 'image/png',
      bytes: atlas.byteLength,
      sha256: atlasSha,
      output_sha256: '8'.repeat(64),
      width: projectedCharacter.revision.atlas.width,
      height: projectedCharacter.revision.atlas.height,
      cell_size: [
        projectedCharacter.revision.frame_geometry.frame_width,
        projectedCharacter.revision.frame_geometry.frame_height,
      ],
      pivot: [
        projectedCharacter.revision.pivot.x,
        projectedCharacter.revision.pivot.y,
      ],
      alpha_policy: 'straight-alpha',
    }],
    assets: [{
      ...common,
      requirement_id: 'character-player',
    }],
    bindings: [{
      usage_kind: 'character',
      usage_id: 'player',
      ...common,
    }],
    hazards: [],
  });
  const image: ProjectedReviewedWorldArtImage = {
    task_id: task.task_id,
    path: imagePath,
    media_type: 'image/png',
    bytes: atlas.byteLength,
    sha256: atlasSha,
    readBytes: () => Uint8Array.from(atlas),
  };
  const overlay = await buildWorldArtRuntimeOverlayZip({
    projection: runtimeProjection,
    images: [image],
  });
  const review = reviewFixture(profile);
  const prepared = await prepareHumanArtReviewTemplate({
    review,
    runtimeOverlayBytes: overlay.readBytes(),
    godotCaptureEvidenceId: 'godot-world-capture',
    characterIdentityBindingSha256: IDENTITY,
    reviewId: `${profile}-human-review`,
    reviewerId: 'owner-reviewer',
    reviewedAt: '2026-07-29T00:00:00.000Z',
  });
  const receipt = approvePrivate(prepared.receipt);
  const promoted = await promoteHumanArtReviewWorkspace({
    review,
    runtimeOverlayBytes: overlay.readBytes(),
    godotCaptureEvidenceId: 'godot-world-capture',
    characterIdentityBindingSha256: IDENTITY,
    receipt,
    receiptPath: `review-evidence/${profile}-human-review.json`,
  });
  return {
    characterProfileRevisionBytes:
      serializeCharacterProfileRevisionCanonical(projectedCharacter.revision),
    characterProjectionRecordBytes:
      encoder.encode(JSON.stringify(projectedCharacter.record)),
    runtimeOverlayBytes: overlay.readBytes(),
    approvedWorldReviewBytes: encoder.encode(JSON.stringify(promoted.approval)),
    humanArtReviewReceiptBytes: encodeHumanArtReviewReceipt(receipt),
  };
}

async function sourcesFixture(): Promise<ReviewedCharacterProfileSources> {
  return Object.freeze(Object.fromEntries(await Promise.all(
    WORLD_ASSET_PROFILES.map(async (profile) =>
      [profile, await sourceFixture(profile)] as const),
  ))) as ReviewedCharacterProfileSources;
}

describe('assembleReviewedCharacterProfileFamily', () => {
  it('assembles four exact human-reviewed runtime atlases without source inputs', async () => {
    const result = await assembleReviewedCharacterProfileFamily({
      familyId: 'anonymous-traveler-reviewed',
      sources: await sourcesFixture(),
    });

    expect(result.family.status).toBe('reviewed-release-candidate');
    const validate = new Ajv2020({ strict: true, allErrors: true })
      .compile(reviewedFamilySchema);
    expect(validate(result.family), JSON.stringify(validate.errors)).toBe(true);
    expect(result.family.profiles).toHaveLength(4);
    expect(result.family.character_identity_sha256).toBe(IDENTITY);
    expect(result.family.rights).toEqual({
      distribution: 'private',
      license: 'LicenseRef-Proprietary',
    });
    expect(result.files).toHaveLength(10);
    expect(result.sourceImagesIncluded).toBe(false);
    expect(result.reviewEvidenceIncluded).toBe(false);
  });

  it('rejects a projection record whose production plan drifts from the reviewed overlay', async () => {
    const sources = await sourcesFixture();
    const changed = JSON.parse(new TextDecoder().decode(
      sources['topdown-farm'].characterProjectionRecordBytes,
    ));
    changed.plan_id = 'other-production-plan';
    await expect(assembleReviewedCharacterProfileFamily({
      familyId: 'anonymous-traveler-reviewed',
      sources: {
        ...sources,
        'topdown-farm': {
          ...sources['topdown-farm'],
          characterProjectionRecordBytes: encoder.encode(JSON.stringify(changed)),
        },
      },
    })).rejects.toThrow('character atlas');
  });
});
