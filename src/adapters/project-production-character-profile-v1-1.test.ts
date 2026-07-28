import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from './canvas/encode-png';
import { normalizeProductionArtPngV1_1 } from './normalize-production-art-png-v1-1';
import { projectProductionCharacterProfileV1_1 } from './project-production-character-profile';
import {
  buildAssetRequirementsV1_1,
} from '../core/asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from '../core/confirmed-world-creation-intake';
import {
  buildProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../core/production-art-contract-v1-1';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from '../core/world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from '../core/world-layout-plan';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../core/asset-profile';

const IDENTITY = 'c'.repeat(64);
const FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'An original anonymous world used only for contract verification.',
  worldview: 'Communities preserve knowledge through shared public landmarks.',
  terrain: 'Low hills, safe paths, wetlands, and one elevated crossing.',
  geography: 'A compact region with a loop route and three connected districts.',
  culture: 'Residents exchange tools, stories, seeds, and practical craft.',
  ecology: 'Native plants cluster around water and sheltered stone.',
  mood: 'Hopeful, readable, adventurous, and calm between hazards.',
  art_direction: 'Original compact pixel art with a restrained cool-warm palette.',
  traversal: 'A readable loop with optional elevation and one short detour.',
  landmarks: 'Archive, bridge, garden',
});
const INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'standard',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'dangerous',
  landmark_labels: Object.freeze(['Archive', 'Bridge', 'Garden']),
});

function reference(role: 'environment-style' | 'character') {
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

async function fixture(profile: WorldAssetProfile) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `projector-v11-${profile}`,
    session_revision: 11,
    profile,
    target: 'raspberry-pi-4b',
    seed: `anonymous-${profile}`,
    facts: FACTS,
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: IDENTITY,
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: 'd'.repeat(64),
  });
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(
    intake,
    INTENT,
  );
  const layout = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layout);
  const plan = await buildProductionArtPlanV1_1(requirements, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const task = plan.tasks.find(({ kind, slot_mappings: slots }) =>
    kind === 'character-animation-sheet'
    && slots.some(({ role }) => role === 'character.player.atlas'));
  if (!task) throw new Error(`Missing 1.1 player task for ${profile}.`);
  return { requirements, plan, task };
}

function characterPng(task: ProductionArtTaskV1_1): Uint8Array {
  const { width, height, cell_width: cellWidth } = task.target;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set([0, 255, 0, 255], offset);
  }
  task.pose_mappings?.forEach((pose, index) => {
    const left = pose.grid_cell.column * cellWidth + 8 + index % 11;
    const top = pose.grid_cell.row * task.target.cell_height
      + task.pivot.y - 24;
    const right = left + 11 + index % 5;
    const bottom = pose.grid_cell.row * task.target.cell_height + task.pivot.y;
    const color = [
      170 + index % 80,
      10 + index % 10,
      30 + (index * 17) % 110,
      255,
    ] as const;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        rgba.set(color, (y * width + x) * 4);
      }
    }
  });
  return encodeRgbaPng(width, height, rgba);
}

async function normalized(profile: WorldAssetProfile) {
  const built = await fixture(profile);
  const png = characterPng(built.task);
  const result = await normalizeProductionArtPngV1_1({
    plan: built.plan,
    requirements: built.requirements,
    task: built.task,
    asset_id: `${built.task.task_id}-candidate`,
    source_reference_ids: [
      'approved-scene-direction',
      'character-reference',
    ],
    source: {
      media_type: 'image/png',
      width: built.task.target.width,
      height: built.task.target.height,
      byteLength: png.byteLength,
      readBytes: () => Uint8Array.from(png),
    },
  });
  return { ...built, result };
}

describe('requirements-driven 1.1 character profile projection', () => {
  it.each(WORLD_ASSET_PROFILES)(
    'projects the exact normalized %s player task into a portable revision',
    async (profile) => {
      const { requirements, plan, task, result } = await normalized(profile);
      const projected = await projectProductionCharacterProfileV1_1(
        plan,
        requirements,
        result,
        {
          characterId: 'anonymous-traveler',
          identityDigestSha256: IDENTITY,
          characterReferenceIds: ['character-reference'],
        },
      );

      expect(projected.revision.profile).toBe(profile);
      expect(projected.revision.atlas.sha256).toBe(result.output.sha256);
      expect(projected.record.plan_id).toBe(plan.plan_id);
      expect(projected.record.task_id).toBe(task.task_id);
      expect(projected.record.source.identity_digest_sha256).toBe(IDENTITY);
      expect(projected.record.checks.pose_count)
        .toBe(task.pose_mappings?.length);
      expect(projected.png.readBytes()).toEqual(result.normalized.readBytes());
    },
  );

  it('rejects evidence drift instead of projecting an unbound PNG', async () => {
    const { requirements, plan, result } = await normalized('topdown-farm');
    const changed = {
      ...result,
      evidence: {
        ...result.evidence,
        source_binding: {
          ...result.evidence.source_binding,
          plan_sha256: 'f'.repeat(64),
        },
      },
    };
    await expect(projectProductionCharacterProfileV1_1(
      plan,
      requirements,
      changed,
      {
        characterId: 'anonymous-traveler',
        identityDigestSha256: IDENTITY,
        characterReferenceIds: ['character-reference'],
      },
    )).rejects.toMatchObject({ code: 'projection.integrity' });
  });
});
