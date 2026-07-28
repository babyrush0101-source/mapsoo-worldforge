import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-world-art-runtime-projection-1.0.schema.json';
import { encodeRgbaPng } from './canvas/encode-png';
import {
  normalizeProductionArtPngV1_1,
  type LocalProductionArtPngSourceV1_1,
  type NormalizedProductionArtResultV1_1,
} from './normalize-production-art-png-v1-1';
import {
  projectReviewedWorldArtVariants,
  type ProjectReviewedWorldArtVariantsInput,
} from './project-reviewed-world-art-variants';
import type { WorldAssetProfile } from '../core/asset-profile';
import { buildAssetRequirementsV1_1 } from '../core/asset-requirements-v1-1';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from '../core/confirmed-world-creation-intake';
import {
  buildProductionArtPlanV1_1,
  fingerprintProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../core/production-art-contract-v1-1';
import { buildProductionArtRunSetV1_1 } from '../core/production-art-run-set-v1-1';
import { worldMaterialRoleForProfile } from '../core/world-material-palette';
import {
  buildWorldArtVariantMap,
  type ReviewedWorldArtSlotInventory,
  type WorldArtVariantMapInput,
  type WorldArtVariantSelection,
} from '../core/world-art-variant-map';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  type WorldLayoutConstraintIntent,
} from '../core/world-layout-constraints';
import { solveWorldLayoutPlanFromConstraints } from '../core/world-layout-plan';

const PRIVATE_MARKER = 'PRIVATE_RUNTIME_PROJECTION_LABEL';
const FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: `${PRIVATE_MARKER} premise`,
  worldview: `${PRIVATE_MARKER} worldview`,
  terrain: `${PRIVATE_MARKER} terrain`,
  geography: `${PRIVATE_MARKER} geography`,
  culture: `${PRIVATE_MARKER} culture`,
  ecology: `${PRIVATE_MARKER} ecology`,
  mood: `${PRIVATE_MARKER} mood`,
  art_direction: `${PRIVATE_MARKER} art`,
  traversal: `${PRIVATE_MARKER} traversal`,
  landmarks: `${PRIVATE_MARKER} alpha, beta, gamma`,
});
const INTENT: WorldLayoutConstraintIntent = Object.freeze({
  route_shape: 'loop',
  scale: 'standard',
  verticality: 'high',
  water: 'basin',
  settlement_density: 'dense',
  hazard_level: 'dangerous',
  landmark_labels: Object.freeze([
    `${PRIVATE_MARKER} alpha`,
    `${PRIVATE_MARKER} beta`,
    `${PRIVATE_MARKER} gamma`,
  ]),
});
const RIGHTS = Object.freeze({
  distribution: 'public' as const,
  license: 'CC0-1.0' as const,
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

function occupied(task: ProductionArtTaskV1_1): ReadonlySet<string> {
  if (task.kind === 'character-animation-sheet') {
    return new Set((task.pose_mappings ?? []).map(({ grid_cell }) =>
      `${grid_cell.column}:${grid_cell.row}`));
  }
  const cells = new Set<string>();
  for (const { grid_rect: rect } of task.slot_mappings) {
    for (let row = rect.row; row < rect.row + rect.row_span; row += 1) {
      for (let column = rect.column; column < rect.column + rect.column_span; column += 1) {
        cells.add(`${column}:${row}`);
      }
    }
  }
  return cells;
}

function pngFor(task: ProductionArtTaskV1_1): Uint8Array {
  const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }
  occupied(task).forEach((key) => {
    const [column, row] = key.split(':').map(Number);
    const inset = (
      task.seam_policy === 'transparent-cell-padding'
      || task.alpha_policy === 'straight-alpha'
    ) ? Math.max(2, Math.floor(Math.min(cellWidth, cellHeight) / 10)) : 0;
    for (let y = inset; y < cellHeight - inset; y += 1) {
      for (let x = inset; x < cellWidth - inset; x += 1) {
        const offset = (
          (row * cellHeight + y) * width
          + column * cellWidth
          + x
        ) * 4;
        rgba[offset] = 80 + (column % 4) * 30;
        rgba[offset + 1] = 30 + (row % 4) * 30;
        rgba[offset + 2] = 190;
        rgba[offset + 3] = 255;
      }
    }
  });
  return encodeRgbaPng(width, height, rgba);
}

function localSource(
  task: ProductionArtTaskV1_1,
  bytes: Uint8Array,
): LocalProductionArtPngSourceV1_1 {
  const snapshot = Uint8Array.from(bytes);
  return Object.freeze({
    media_type: 'image/png' as const,
    width: task.target.width,
    height: task.target.height,
    byteLength: snapshot.byteLength,
    readBytes: () => Uint8Array.from(snapshot),
  });
}

function localReferences(task: ProductionArtTaskV1_1): readonly string[] {
  if (task.kind === 'scene-direction') {
    return [
      ...(task.reference_roles.includes('environment-style')
        ? ['environment-reference']
        : []),
      ...(task.reference_roles.includes('character') ? ['character-reference'] : []),
    ];
  }
  return [
    'approved-scene-direction',
    ...(task.reference_roles.includes('character') ? ['character-reference'] : []),
  ];
}

async function fixture(
  profile: WorldAssetProfile,
  intent: WorldLayoutConstraintIntent = INTENT,
) {
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `runtime-projection-${profile}`,
    session_revision: 13,
    profile,
    target: 'raspberry-pi-4b',
    seed: `private-seed-${profile}`,
    facts: FACTS,
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: 'c'.repeat(64),
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: 'd'.repeat(64),
  });
  const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(intake, intent);
  const layout = await solveWorldLayoutPlanFromConstraints(constraints, intake);
  const requirements = await buildAssetRequirementsV1_1(constraints, layout);
  const plan = await buildProductionArtPlanV1_1(requirements, RIGHTS);
  const normalizedResults: NormalizedProductionArtResultV1_1[] = [];
  for (const [index, task] of plan.tasks.entries()) {
    normalizedResults.push(await normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: `normalized-asset-${String(index + 1).padStart(3, '0')}`,
      source_reference_ids: localReferences(task),
      source: localSource(task, pngFor(task)),
    }));
  }
  const runSet = await buildProductionArtRunSetV1_1(
    plan,
    requirements,
    normalizedResults.map((result) => ({
      taskId: result.output.task_id,
      runDirectory: `model-runs/${result.output.task_id}`,
      output: result.output,
      evidence: {
        artifactPath: result.output.path,
        bytes: result.output.bytes,
        sha256: result.output.sha256,
      },
    })),
  );
  const planSha = await fingerprintProductionArtPlanV1_1(plan, requirements);
  const slots = plan.tasks.flatMap((task) => task.slot_mappings.map((slot) => ({
    slot_id: slot.slot_id,
    requirement_id: slot.requirement_id,
    role: slot.role,
    variant_id: slot.variant_id,
    atlas_path: task.expected_output_path,
    atlas_cell: slot.grid_rect,
  })));
  const reviewedInventory: ReviewedWorldArtSlotInventory = {
    schema_version: '1.0.0',
    document_type: 'reviewed-world-art-slot-inventory',
    profile,
    production_art_plan_id: plan.plan_id,
    production_art_plan_sha256: planSha,
    review_record_sha256: 'e'.repeat(64),
    review_status: 'pass',
    slots,
  };
  const terrain = layout.terrain_layout.kind === 'bands'
    ? layout.terrain_layout.bands
    : layout.terrain_layout.zones;
  const materials = [...new Set(terrain.map(({ material }) => material))].sort();
  const terrainSlots = slots.filter(({ role }) => role.startsWith('terrain.'));
  const selections: WorldArtVariantSelection[] = materials.map((material) => {
    const expectedRole = worldMaterialRoleForProfile(profile, material);
    const slot = terrainSlots.find(({ role }) => role === expectedRole);
    if (!slot) throw new Error(`Missing terrain slot for ${profile}/${material}.`);
    return {
      usage_kind: 'terrain-material',
      usage_id: material,
      slot_id: slot.slot_id,
    };
  });
  for (const requirement of requirements.requirements) {
    if (requirement.category !== 'hazard' && requirement.category !== 'character') continue;
    const slot = slots.find(({ requirement_id }) =>
      requirement_id === requirement.requirement_id);
    if (!slot) throw new Error(`Missing slot for ${requirement.requirement_id}.`);
    selections.push({
      usage_kind: requirement.category,
      usage_id: requirement.requirement_id,
      slot_id: slot.slot_id,
    });
  }
  const variantMapInput: WorldArtVariantMapInput = {
    layout_plan: layout,
    asset_requirements: requirements,
    production_art_plan: plan,
    reviewed_slot_inventory: reviewedInventory,
    selections,
  };
  const variantMap = await buildWorldArtVariantMap(variantMapInput);
  const input: ProjectReviewedWorldArtVariantsInput = {
    variantMap,
    variantMapInput,
    requirements,
    plan,
    runSet,
    normalizedResults,
  };
  return { input, layout, requirements, plan, runSet, normalizedResults, variantMap };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

const PROJECTION_TEST_TIMEOUT_MS = 30_000;

describe('projectReviewedWorldArtVariants', () => {
  it.each([
    ['calm', 0],
    ['guarded', 1],
  ] as const)('projects %s hazard density from confirmed requirements', async (
    hazardLevel,
    expectedCount,
  ) => {
    const base = await fixture('topdown-farm', {
      ...INTENT,
      hazard_level: hazardLevel,
    });
    const projected = await projectReviewedWorldArtVariants(base.input);

    expect(projected.projection.hazards).toHaveLength(expectedCount);
    expect(projected.projection.hazards.every(({ kind }) => kind === 'contact')).toBe(true);
  }, PROJECTION_TEST_TIMEOUT_MS);

  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('projects a complete reviewed Plan 1.1 asset catalog for %s', async (profile) => {
    const base = await fixture(profile);
    const left = await projectReviewedWorldArtVariants(base.input);
    const right = await projectReviewedWorldArtVariants({
      ...base.input,
      normalizedResults: [...base.normalizedResults].reverse(),
    });
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(left.projection), JSON.stringify(validate.errors)).toBe(true);
    expect(left.projection).toEqual(right.projection);
    expect(left.images.map(({ task_id }) => task_id))
      .toEqual(left.projection.images.map(({ task_id }) => task_id));
    const tasksWithSlots = base.plan.tasks
      .filter(({ slot_mappings }) => slot_mappings.length > 0)
      .sort((leftTask, rightTask) => leftTask.task_id.localeCompare(rightTask.task_id));
    const expectedSlots = tasksWithSlots.flatMap(({ slot_mappings }) => slot_mappings);
    expect(left.images.map(({ task_id }) => task_id))
      .toEqual(tasksWithSlots.map(({ task_id }) => task_id));
    expect(left.projection.assets).toHaveLength(expectedSlots.length);
    expect(new Set(left.projection.assets.map(({ slot_id }) => slot_id)).size)
      .toBe(expectedSlots.length);
    expect(left.projection.bindings).toHaveLength(base.variantMap.bindings.length);
    expect(left.projection.hazards.map(({ hazard_id }) => hazard_id))
      .toEqual(['hazard-001', 'hazard-002']);
    expect(left.projection.hazards.map(({ kind }) => kind)).toEqual(
      profile === 'side-platformer' ? ['spikes', 'pit'] : ['contact', 'contact'],
    );
    for (const hazard of left.projection.hazards) {
      expect(hazard.logical_rect.x).toBeGreaterThanOrEqual(0);
      expect(hazard.logical_rect.y).toBeGreaterThanOrEqual(0);
      expect(hazard.logical_rect.x + hazard.logical_rect.width)
        .toBeLessThanOrEqual(base.layout.bounds.width);
      expect(hazard.logical_rect.y + hazard.logical_rect.height)
        .toBeLessThanOrEqual(base.layout.bounds.height);
      const visual = left.projection.bindings.find((binding) =>
        binding.usage_kind === 'hazard'
        && binding.usage_id === hazard.binding_usage_id);
      expect(visual?.role).toBe(`hazard.${hazard.kind}`);
      if (profile === 'isometric-action') {
        const telegraph = left.projection.bindings.find((binding) =>
          binding.usage_kind === 'hazard'
          && binding.usage_id === hazard.telegraph_usage_id);
        expect(telegraph?.role).toBe('hazard.telegraph');
      } else {
        expect(hazard.telegraph_usage_id).toBeUndefined();
      }
    }

    for (const asset of left.projection.assets) {
      const task = base.plan.tasks.find(({ task_id }) => task_id === asset.task_id)!;
      const slot = task.slot_mappings.find(({ slot_id }) => slot_id === asset.slot_id)!;
      expect(asset.requirement_id).toBe(slot.requirement_id);
      expect(asset.role).toBe(slot.role);
      expect(asset.variant_id).toBe(slot.variant_id);
      expect(asset.image_path).toBe(task.expected_output_path);
      expect(asset.region).toEqual({
        x: slot.grid_rect.column * task.target.cell_width,
        y: slot.grid_rect.row * task.target.cell_height,
        width: slot.grid_rect.column_span * task.target.cell_width,
        height: slot.grid_rect.row_span * task.target.cell_height,
      });
      if (asset.role.startsWith('character.')) {
        expect(asset.poses.length).toBeGreaterThan(0);
        expect(asset.poses).toHaveLength(
          task.pose_mappings?.filter(({ slot_id }) => slot_id === asset.slot_id).length ?? 0,
        );
      } else {
        expect(asset.poses).toEqual([]);
      }
    }

    for (const binding of left.projection.bindings) {
      const asset = left.projection.assets.find(({ slot_id }) => slot_id === binding.slot_id)!;
      expect(binding).toMatchObject({
        task_id: asset.task_id,
        slot_id: asset.slot_id,
        role: asset.role,
        variant_id: asset.variant_id,
        image_path: asset.image_path,
        region: asset.region,
        cell_sha256: asset.cell_sha256,
        poses: asset.poses,
      });
    }

    const boundSlots = new Set(left.projection.bindings.map(({ slot_id }) => slot_id));
    const unboundAssets = left.projection.assets.filter(({ slot_id }) => !boundSlots.has(slot_id));
    expect(unboundAssets.length).toBeGreaterThan(0);
    expect(unboundAssets.some(({ role }) =>
      /^(?:background|prop|structure)\./.test(role))).toBe(true);
  }, PROJECTION_TEST_TIMEOUT_MS);

  it('rejects stale run-set and missing or duplicated normalized tasks', async () => {
    const base = await fixture('topdown-farm');
    const missing = base.normalizedResults.slice(1);
    await expect(projectReviewedWorldArtVariants({
      ...base.input,
      normalizedResults: missing,
    })).rejects.toMatchObject({
      code: 'reviewed-world-art-projection.invalid-inventory',
    });
    await expect(projectReviewedWorldArtVariants({
      ...base.input,
      normalizedResults: [...base.normalizedResults, base.normalizedResults[0]],
    })).rejects.toMatchObject({
      code: 'reviewed-world-art-projection.invalid-inventory',
    });

    const changedRunSet = mutable(base.runSet);
    changedRunSet.source.plan_sha256 = '0'.repeat(64);
    await expect(projectReviewedWorldArtVariants({
      ...base.input,
      runSet: changedRunSet,
    })).rejects.toMatchObject({
      code: 'reviewed-world-art-projection.invalid-source',
    });
  });

  it('rejects normalized byte, output, and slot-evidence tampering', async () => {
    const base = await fixture('side-platformer');
    const target = base.normalizedResults[0];
    const changedBytes = {
      ...target,
      normalized: {
        ...target.normalized,
        readBytes: () => {
          const bytes = target.normalized.readBytes();
          bytes[bytes.length - 1] ^= 1;
          return bytes;
        },
      },
    };
    await expect(projectReviewedWorldArtVariants({
      ...base.input,
      normalizedResults: [
        changedBytes as NormalizedProductionArtResultV1_1,
        ...base.normalizedResults.slice(1),
      ],
    })).rejects.toBeInstanceOf(Error);

    const changedEvidence = {
      ...target,
      evidence: {
        ...target.evidence,
        slots: target.evidence.slots.map((slot, index) => index === 0
          ? { ...slot, cell_sha256: '0'.repeat(64) }
          : slot),
      },
    };
    await expect(projectReviewedWorldArtVariants({
      ...base.input,
      normalizedResults: [
        changedEvidence as NormalizedProductionArtResultV1_1,
        ...base.normalizedResults.slice(1),
      ],
    })).rejects.toMatchObject({
      code: 'reviewed-world-art-projection.invalid-evidence',
    });

    const changedOutput = {
      ...target,
      output: { ...target.output, sha256: 'f'.repeat(64) },
    };
    await expect(projectReviewedWorldArtVariants({
      ...base.input,
      normalizedResults: [
        changedOutput as NormalizedProductionArtResultV1_1,
        ...base.normalizedResults.slice(1),
      ],
    })).rejects.toMatchObject({
      code: 'reviewed-world-art-projection.invalid-output',
    });
  }, PROJECTION_TEST_TIMEOUT_MS);

  it('does not project private intake or provider-remote metadata', async () => {
    const base = await fixture('layered-depth-2d');
    const result = await projectReviewedWorldArtVariants(base.input);
    const json = JSON.stringify(result.projection).toLowerCase();

    for (const forbidden of [
      PRIVATE_MARKER,
      'private-input',
      'private-seed',
      'provider_request_id',
      'remote_asset_id',
      'credentials',
      'openai-request',
      'spritecook-asset',
    ]) {
      expect(json).not.toContain(forbidden.toLowerCase());
    }
    expect(result.images.every(({ path }) =>
      path.startsWith('production-art/layered-depth-2d/'))).toBe(true);
  }, PROJECTION_TEST_TIMEOUT_MS);
});
