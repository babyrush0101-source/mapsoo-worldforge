import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import projectionSchema from '../../schemas/mapsoo-production-character-projection-1.0.schema.json';
import committedPublicFixture from '../../tests/fixtures/pack10-public/mapsoo.manifest.json';
import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import { normalizeProductionArtPng } from './normalize-production-art-png';
import {
  LayeredDepthCharacterProjectionError,
  projectLayeredDepthProductionCharacter,
} from './project-layered-depth-production-character';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../core/production-art-contract';
import {
  runProductionArtProvider,
  type ProductionArtProvider,
} from '../core/production-art-provider';
import {
  bindReferenceImage,
  type ReferenceImageRole,
  type RuntimeReferenceImage,
} from '../core/reference-image';
import {
  validatePack10Manifest,
  type Pack10Manifest,
} from '../core/pack-manifest-1.0';

type CharacterRole = 'character.player.atlas' | 'character.npc.atlas';
type SourceMode = 'valid' | 'duplicate' | 'mirrored' | 'bad-foot-anchor';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function reference(
  id: string,
  role: ReferenceImageRole,
  marker: number,
): Promise<RuntimeReferenceImage> {
  const rgba = new Uint8Array(2 * 2 * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set([marker, 40, 90, 255], offset);
  }
  const bytes = encodeRgbaPng(2, 2, rgba);
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

function fillRect(
  rgba: Uint8Array,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: readonly [number, number, number, number],
): void {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      rgba.set(color, (y * width + x) * 4);
    }
  }
}

function sourceSheet(task: ProductionArtTask, mode: SourceMode): Uint8Array {
  const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set([0, 255, 0, 255], offset);
  }
  (task.pose_mappings ?? []).forEach((pose, index) => {
    const originX = pose.grid_cell.column * cellWidth;
    const originY = pose.grid_cell.row * cellHeight;
    const red = mode === 'duplicate' ? 130 : 80 + (index * 37) % 160;
    const blue = mode === 'duplicate' ? 170 : 70 + (index * 53) % 170;
    const bottom = originY + (mode === 'bad-foot-anchor' ? 130 : 180);
    let left = originX + 40;
    let right = originX + 88;
    if (mode === 'mirrored' && index === 0) {
      left = originX + 32;
      right = originX + 63;
    } else if (mode === 'mirrored' && index === 1) {
      left = originX + 65;
      right = originX + 96;
    }
    const color = mode === 'mirrored' && index < 2
      ? [145, 24, 180, 255] as const
      : [red, 24, blue, 255] as const;
    fillRect(rgba, width, left, originY + 60, right, bottom, color);
  });
  return encodeRgbaPng(width, height, rgba);
}

async function normalizedCharacter(
  role: CharacterRole,
  mode: SourceMode = 'valid',
) {
  const plan = createProductionArtPlan('layered-depth-2d', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const task = plan.tasks.find(({ role_mappings: mappings }) => mappings[0]?.role === role);
  if (!task) throw new Error(`Missing test task for ${role}.`);
  const references = [
    await reference('synthetic-environment', 'environment-style', 150),
    await reference('synthetic-character', 'character', 190),
  ];
  const source = sourceSheet(task, mode);
  const provider: ProductionArtProvider = {
    id: 'fixture-character-provider',
    version: '1.0.0',
    displayName: 'Fixture character provider',
    capabilities: {
      execution: 'remote',
      determinism: 'best-effort',
      outputProvenance: 'generative-ai',
      requiresCredentials: true,
      supportsAbort: true,
      supportedProfiles: ['layered-depth-2d'],
      supportedTaskKinds: ['character-animation-sheet'],
      maxReferenceBytes: 1024 * 1024,
      maxReferenceCount: 2,
      maxOutputBytes: 64 * 1024 * 1024,
      maxRasterDimension: 2048,
      maxRequestsPerTask: 1,
      providerDocumentationUrl: 'https://example.com/fixture-provider',
    },
    async generate() {
      return {
        sourcePngBytes: source,
        model: 'fixture-image-model',
        workflow: 'image-edit',
      };
    },
  };
  const trusted = await runProductionArtProvider(provider, {
    plan,
    taskId: task.task_id,
    worldBrief: 'An original neutral layered-depth settlement.',
    styleBible: 'Distinct grounded silhouettes with stable proportions.',
    references,
    remoteAuthorization: {
      decision: 'approved',
      provider_id: provider.id,
      task_id: task.task_id,
      reference_ids: references.map(({ descriptor }) => descriptor.id),
      allow_reference_upload: true,
      allow_prompt_upload: true,
      max_requests: 1,
    },
  }, { credential: 'test-only-runtime-key' });
  return {
    plan,
    task,
    normalized: await normalizeProductionArtPng(trusted),
  };
}

function frameMaximumY(
  rgba: Uint8Array,
  atlasWidth: number,
  frameX: number,
  frameY: number,
): number {
  let maximumY = -1;
  for (let y = 0; y < 72; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      if (rgba[((frameY + y) * atlasWidth + frameX + x) * 4 + 3] > 0) maximumY = y;
    }
  }
  return maximumY;
}

describe('layered-depth production character projector', () => {
  it.each([
    ['character.player.atlas', 32, 16, 288],
    ['character.npc.atlas', 16, 8, 144],
  ] as const)(
    'projects %s into a hash-bound Pack 1.0 atlas',
    async (role, poseCount, clipCount, atlasHeight) => {
      const { plan, normalized } = await normalizedCharacter(role);
      const projected = await projectLayeredDepthProductionCharacter(plan, normalized);
      const validateRecord = new Ajv2020({ strict: true, allErrors: true })
        .compile(projectionSchema);

      expect(validateRecord(projected.record), JSON.stringify(validateRecord.errors)).toBe(true);
      expect(projected.record).toMatchObject({
        role,
        human_review: 'required',
        atlas: { width: 384, height: atlasHeight, frame_size: [48, 72], pivot: [24, 67] },
        checks: {
          pose_count: poseCount,
          distinct_pose_count: poseCount,
          transparent_padding_checked: true,
          exact_duplicates_rejected: true,
          mirrored_duplicates_rejected: true,
        },
      });
      expect(projected.character.clips).toHaveLength(clipCount);
      expect(projected.character.clips.every(({ frames }) => frames.length === 2)).toBe(true);
      expect(new Set(projected.character.clips.flatMap(({ frames }) =>
        frames.map(({ x, y }) => `${x},${y}`))).size).toBe(poseCount);
      expect(projected.file.sha256).toBe(await sha256(projected.png.readBytes()));
      const decoded = await decodeReferenceImageRgba(projected.png.readBytes(), 'image/png');
      for (const clip of projected.character.clips) {
        for (const frame of clip.frames) {
          expect(frameMaximumY(decoded.rgba, decoded.width, frame.x, frame.y))
            .toBeGreaterThanOrEqual(62);
          expect(frameMaximumY(decoded.rgba, decoded.width, frame.x, frame.y))
            .toBeLessThanOrEqual(68);
        }
      }
      const mutableCopy = projected.png.readBytes();
      mutableCopy.fill(0);
      expect(projected.png.readBytes()).not.toEqual(mutableCopy);
    },
  );

  it('produces character records accepted by the complete Pack 1.0 semantic validator', async () => {
    const [playerInput, npcInput] = await Promise.all([
      normalizedCharacter('character.player.atlas'),
      normalizedCharacter('character.npc.atlas'),
    ]);
    const [player, npc] = await Promise.all([
      projectLayeredDepthProductionCharacter(playerInput.plan, playerInput.normalized),
      projectLayeredDepthProductionCharacter(npcInput.plan, npcInput.normalized),
    ]);
    const manifest = structuredClone(committedPublicFixture) as unknown as Pack10Manifest;
    (manifest as { characters: Pack10Manifest['characters'] }).characters = [
      player.character,
      npc.character,
    ];
    (manifest as { files: Pack10Manifest['files'] }).files = manifest.files.map((file) =>
      file.path === player.file.path ? player.file
        : file.path === npc.file.path ? npc.file
          : file);

    expect(validatePack10Manifest(manifest)).toEqual([]);
  });

  it.each([
    ['duplicate', 'projection.duplicate-frame'],
    ['mirrored', 'projection.mirrored-frame'],
    ['bad-foot-anchor', 'projection.foot-anchor'],
  ] as const)('rejects %s pose inventory', async (mode, code) => {
    const { plan, normalized } = await normalizedCharacter('character.npc.atlas', mode);
    await expect(projectLayeredDepthProductionCharacter(plan, normalized))
      .rejects.toEqual(expect.objectContaining({ code }));
  });

  it('rejects normalized bytes whose declared digest was changed', async () => {
    const { plan, normalized } = await normalizedCharacter('character.npc.atlas');
    const tampered = {
      ...normalized,
      output: { ...normalized.output, sha256: 'f'.repeat(64) },
    };
    await expect(projectLayeredDepthProductionCharacter(
      plan as ProductionArtPlan,
      tampered,
    )).rejects.toBeInstanceOf(LayeredDepthCharacterProjectionError);
  });
});
