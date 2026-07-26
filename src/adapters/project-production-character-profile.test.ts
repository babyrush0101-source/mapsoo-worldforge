import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import characterProfileSchema from '../../schemas/mapsoo-character-profile-revision-1.0.schema.json';
import characterProjectionSchema
  from '../../schemas/mapsoo-production-character-profile-projection-1.0.schema.json';
import { encodeRgbaPng } from './canvas/encode-png';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';
import {
  deriveCharacterIdentityDigestSha256,
  projectProductionCharacterProfile,
} from './project-production-character-profile';
import {
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../core/production-art-contract';
import { requiredCharacterProfileClips } from '../core/character-profile-revision';
import { WORLD_ASSET_PROFILES } from '../core/asset-profile';

type FixtureMode = 'valid' | 'duplicate' | 'mirrored' | 'bad-foot' | 'unused-cell';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
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

async function normalizedFixture(
  plan: ProductionArtPlan,
  task: ProductionArtTask,
  mode: FixtureMode = 'valid',
): Promise<NormalizedProductionArtResult> {
  const rgba = new Uint8Array(task.target.width * task.target.height * 4);
  task.pose_mappings?.forEach((pose, index) => {
    const cellLeft = pose.grid_cell.column * task.target.cell_width;
    const cellTop = pose.grid_cell.row * task.target.cell_height;
    const baseLeft = 10;
    const baseWidth = 12;
    let left = baseLeft + index % 7;
    let subjectWidth = baseWidth + index % 5;
    let bottom = task.pivot.y;
    let color: readonly [number, number, number, number] = [
      30 + (index * 37) % 200,
      40 + (index * 61) % 190,
      50 + (index * 83) % 180,
      255,
    ];
    if ((mode === 'duplicate' || mode === 'mirrored') && index === 1) {
      left = mode === 'mirrored'
        ? task.target.cell_width - 1 - (baseLeft + baseWidth - 1)
        : baseLeft;
      subjectWidth = baseWidth;
      color = [30, 40, 50, 255];
    }
    if (mode === 'bad-foot' && index === 0) {
      bottom = task.pivot.y - Math.max(12, Math.floor(task.target.cell_height / 8));
    }
    drawRect(
      rgba,
      task.target.width,
      cellLeft + left,
      cellTop + bottom - 24,
      cellLeft + left + subjectWidth - 1,
      cellTop + bottom,
      color,
    );
  });
  if (mode === 'unused-cell') {
    const occupied = new Set(task.pose_mappings?.map(({ grid_cell: cell }) =>
      `${cell.column},${cell.row}`));
    const columns = task.target.width / task.target.cell_width;
    const rows = task.target.height / task.target.cell_height;
    let unused: { column: number; row: number } | undefined;
    for (let row = 0; row < rows && !unused; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (!occupied.has(`${column},${row}`)) {
          unused = { column, row };
          break;
        }
      }
    }
    if (!unused) throw new Error('Fixture task does not expose an unused atlas cell.');
    rgba.set(
      [255, 0, 255, 255],
      ((unused.row * task.target.cell_height + 2) * task.target.width
        + unused.column * task.target.cell_width + 2) * 4,
    );
  }
  const png = encodeRgbaPng(task.target.width, task.target.height, rgba);
  const digest = await sha256(png);
  const output: ProductionArtOutput = {
    schema_version: '1.0.0',
    document_type: 'production-art-output',
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    asset_id: `${task.task_id}-candidate`,
    path: task.expected_output_path,
    media_type: 'image/png',
    bytes: png.byteLength,
    sha256: digest,
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
      id: 'synthetic-character-profile-fixture',
      version: '1.0.0',
      documentation_url: 'https://example.com/synthetic-character-profile-fixture',
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    },
    plan_id: plan.plan_id,
    profile: plan.profile,
    task_id: task.task_id,
    model: 'synthetic-fixture-no-model',
    workflow: 'recorded-replay',
    source: {
      media_type: 'image/png',
      bytes: png.byteLength,
      sha256: digest,
      width: task.target.width,
      height: task.target.height,
    },
    normalized: {
      media_type: 'image/png',
      bytes: png.byteLength,
      sha256: digest,
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
  const snapshot = Uint8Array.from(png);
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

function reviewPlan(profile: typeof WORLD_ASSET_PROFILES[number]): ProductionArtPlan {
  return createProductionArtPlan(profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
}

function playerTask(plan: ProductionArtPlan): ProductionArtTask {
  const task = plan.tasks.find(({ role_mappings: roles }) =>
    roles.some(({ role }) => role === 'character.player.atlas'));
  if (!task) throw new Error('Fixture plan has no player task.');
  return task;
}

describe('four-profile production character projection', () => {
  it('derives a stable domain-separated identity digest without exposing the raw reference digest', async () => {
    const referenceDigest = 'a'.repeat(64);
    const first = await deriveCharacterIdentityDigestSha256(referenceDigest);
    const second = await deriveCharacterIdentityDigestSha256(referenceDigest);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(referenceDigest);
    await expect(deriveCharacterIdentityDigestSha256('invalid'))
      .rejects.toMatchObject({ code: 'projection.invalid-options' });
  });

  it.each(WORLD_ASSET_PROFILES)(
    'projects a complete, source-free %s player revision without changing normalized pixels',
    async (profile) => {
      const plan = reviewPlan(profile);
      const task = playerTask(plan);
      const normalized = await normalizedFixture(plan, task);
      const projection = await projectProductionCharacterProfile(plan, normalized, {
        characterId: 'neutral-traveler',
        identityDigestSha256: 'b'.repeat(64),
        characterReferenceIds: ['character-reference'],
      });
      const validate = new Ajv2020({ strict: true, allErrors: true })
        .compile(characterProfileSchema);
      const validateProjection = new Ajv2020({ strict: true, allErrors: true })
        .compile(characterProjectionSchema);

      expect(validate(projection.revision), JSON.stringify(validate.errors)).toBe(true);
      expect(
        validateProjection(projection.record),
        JSON.stringify(validateProjection.errors),
      ).toBe(true);
      expect(projection.revision.profile).toBe(profile);
      expect(projection.revision.rights).toEqual({
        distribution: 'internal-review',
        license: 'LicenseRef-Proprietary',
      });
      expect(projection.revision.clips.map(({ clip_id: clipId }) => clipId))
        .toEqual(requiredCharacterProfileClips(profile));
      expect(projection.revision.clips.flatMap(({ frames }) => frames))
        .toHaveLength(task.pose_mappings?.length ?? 0);
      expect(projection.revision.source_identity).toEqual({
        identity_digest_sha256: 'b'.repeat(64),
        source_reference_ids: ['character-reference'],
      });
      expect(projection.png.readBytes()).toEqual(normalized.normalized.readBytes());
      expect(projection.record.checks).toMatchObject({
        pose_count: task.pose_mappings?.length,
        distinct_pose_count: task.pose_mappings?.length,
        transparent_padding_checked: true,
        unused_cells_transparent_checked: true,
        exact_duplicates_rejected: true,
        mirrored_duplicates_rejected: true,
      });
      expect(projection.record.profile_revision_sha256).toMatch(/^[a-f0-9]{64}$/);
    },
  );

  it('rejects non-player tasks and unbound identity options', async () => {
    const plan = reviewPlan('isometric-action');
    const enemy = plan.tasks.find(({ role_mappings: [mapping] }) =>
      mapping.role === 'character.enemy-melee.atlas');
    expect(enemy).toBeDefined();
    const normalized = await normalizedFixture(plan, enemy!);
    await expect(projectProductionCharacterProfile(plan, normalized, {
      characterId: 'neutral-traveler',
      identityDigestSha256: 'b'.repeat(64),
      characterReferenceIds: ['character-reference'],
    })).rejects.toMatchObject({ code: 'projection.unsupported-task' });

    const player = playerTask(plan);
    await expect(projectProductionCharacterProfile(
      plan,
      await normalizedFixture(plan, player),
      {
        characterId: 'unsafe/character',
        identityDigestSha256: 'not-a-digest',
        characterReferenceIds: ['missing-reference'],
      },
    )).rejects.toMatchObject({ code: 'projection.invalid-options' });
  });

  it('keeps revision ids deterministic while separating different identity bindings', async () => {
    const plan = reviewPlan('topdown-farm');
    const task = playerTask(plan);
    const normalized = await normalizedFixture(plan, task);
    const common = {
      characterId: 'neutral-traveler',
      characterReferenceIds: ['character-reference'],
    } as const;
    const first = await projectProductionCharacterProfile(plan, normalized, {
      ...common,
      identityDigestSha256: 'a'.repeat(64),
    });
    const replay = await projectProductionCharacterProfile(plan, normalized, {
      ...common,
      identityDigestSha256: 'a'.repeat(64),
    });
    const otherIdentity = await projectProductionCharacterProfile(plan, normalized, {
      ...common,
      identityDigestSha256: 'b'.repeat(64),
    });
    expect(replay.revision.profile_revision_id).toBe(first.revision.profile_revision_id);
    expect(replay.record.profile_revision_sha256).toBe(first.record.profile_revision_sha256);
    expect(otherIdentity.revision.profile_revision_id)
      .not.toBe(first.revision.profile_revision_id);
    expect(otherIdentity.record.profile_revision_sha256)
      .not.toBe(first.record.profile_revision_sha256);
  });

  it.each([
    ['duplicate', 'projection.duplicate-frame'],
    ['mirrored', 'projection.mirrored-frame'],
    ['bad-foot', 'projection.foot-anchor'],
    ['unused-cell', 'projection.integrity'],
  ] as const)('rejects %s player pose evidence', async (mode, code) => {
    const plan = reviewPlan('side-platformer');
    const task = playerTask(plan);
    await expect(projectProductionCharacterProfile(
      plan,
      await normalizedFixture(plan, task, mode),
      {
        characterId: 'neutral-traveler',
        identityDigestSha256: 'b'.repeat(64),
        characterReferenceIds: ['character-reference'],
      },
    )).rejects.toMatchObject({ code });
  });

  it('rejects changed normalized bytes or evidence digests', async () => {
    const plan = reviewPlan('topdown-farm');
    const task = playerTask(plan);
    const normalized = await normalizedFixture(plan, task);
    const changed = {
      ...normalized,
      output: {
        ...normalized.output,
        sha256: 'c'.repeat(64),
      },
    };
    await expect(projectProductionCharacterProfile(plan, changed, {
      characterId: 'neutral-traveler',
      identityDigestSha256: 'b'.repeat(64),
      characterReferenceIds: ['character-reference'],
    })).rejects.toMatchObject({ code: 'projection.integrity' });
  });
});
