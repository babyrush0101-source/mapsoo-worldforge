import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import paletteSchema from '../../schemas/mapsoo-world-material-palette-1.0.schema.json';
import { WORLD_ASSET_PROFILES, type WorldAssetProfile } from './asset-profile';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from './confirmed-world-creation-intake';
import {
  buildWorldLayoutPlanFromConfirmedIntake,
} from './world-layout-plan';
import { prepareWorldLayoutPackEntry } from './world-layout-pack-binding';
import {
  buildDefaultWorldMaterialPalette,
  materializeWorldMaterialPalette,
  prepareWorldMaterialPalettePackEntry,
  serializeCanonicalWorldMaterialPalette,
  WorldMaterialPaletteError,
} from './world-material-palette';

const PROFILE_ROLES = Object.freeze({
  'side-platformer': [
    'terrain.solid', 'terrain.one-way', 'terrain.slope-up', 'terrain.slope-down',
    'terrain.wall', 'terrain.breakable',
  ],
  'topdown-farm': [
    'terrain.ground', 'terrain.water', 'terrain.path', 'terrain.soil',
  ],
  'isometric-action': [
    'terrain.void', 'terrain.floor.base', 'terrain.floor.variant',
    'terrain.floor.edge', 'terrain.elevation.top', 'terrain.elevation.riser-left',
    'terrain.elevation.riser-right', 'terrain.ramp', 'terrain.wall',
  ],
  'layered-depth-2d': [
    'terrain.ground', 'terrain.path', 'terrain.edge', 'terrain.bridge',
    'terrain.stairs', 'terrain.water',
  ],
} satisfies Readonly<Record<WorldAssetProfile, readonly string[]>>);

async function intake(profile: WorldAssetProfile): Promise<ConfirmedWorldCreationIntake> {
  return createConfirmedWorldCreationIntake({
    intake_id: `material-palette-${profile}`,
    session_revision: 8,
    profile,
    target: 'raspberry-pi-4b',
    seed: `material-palette-${profile}-seed`,
    facts: {
      premise: 'A courier reconnects a settlement after the seasonal river changes course.',
      worldview: 'Restored crossings gradually change how neighboring communities cooperate.',
      terrain: 'River terraces, orchards, wetlands, stone ridges, and readable route surfaces.',
      geography: 'A ferry, market, workshop, homes, and a hill gate define the main route.',
      culture: 'River crafts, painted signs, shared meals, and lantern exchanges shape local life.',
      ecology: 'Willows, reeds, ducks, fireflies, orchard trees, and shallow flood pools.',
      mood: 'Hopeful exploration with gentle mystery and clear readable landmarks.',
      art_direction: 'Original pixel art with restrained colors and strong silhouettes.',
      traversal: 'Start at the ferry, visit two landmarks, cross the center, and reach the hill gate.',
      landmarks: 'Old ferry, Lantern market, Waterwheel workshop, Hill gate',
    },
    character_source: {
      reference_id: 'traveler-reference',
      identity_digest_sha256: 'c'.repeat(64),
    },
    references: [
      {
        id: 'environment-reference',
        role: 'environment-style',
        path: 'references/environment.png',
        mediaType: 'image/png',
        byteLength: 4096,
        width: 512,
        height: 512,
        sha256: 'b'.repeat(64),
        rights: {
          basis: 'owned',
          license: 'LicenseRef-User-Owned',
          allowGenerativeAdaptation: true,
          allowOutputRedistribution: true,
          allowOutputCc0Dedication: true,
        },
      },
      {
        id: 'traveler-reference',
        role: 'character',
        path: 'references/traveler.png',
        mediaType: 'image/png',
        byteLength: 4096,
        width: 512,
        height: 512,
        sha256: 'a'.repeat(64),
        rights: {
          basis: 'owned',
          license: 'LicenseRef-User-Owned',
          allowGenerativeAdaptation: true,
          allowOutputRedistribution: true,
          allowOutputCc0Dedication: true,
        },
      },
    ],
    approved_intent_preview_sha256: 'd'.repeat(64),
  });
}

async function prepared(profile: WorldAssetProfile) {
  const confirmed = await intake(profile);
  const plan = await buildWorldLayoutPlanFromConfirmedIntake(confirmed);
  return prepareWorldLayoutPackEntry(plan, profile, confirmed.seed);
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('WorldMaterialPalette 1.0', () => {
  it.each(WORLD_ASSET_PROFILES)(
    'builds a deterministic, complete, schema-valid %s palette',
    async (profile) => {
      const layout = await prepared(profile);
      const first = await buildDefaultWorldMaterialPalette(layout, PROFILE_ROLES[profile]);
      const second = await buildDefaultWorldMaterialPalette(layout, PROFILE_ROLES[profile]);
      const validate = new Ajv2020({ strict: true, allErrors: true }).compile(paletteSchema);
      const logicalMaterials = new Set(
        (layout.plan.terrain_layout.kind === 'bands'
          ? layout.plan.terrain_layout.bands
          : layout.plan.terrain_layout.zones)
          .map(({ material }) => material),
      );

      expect(validate(first), JSON.stringify(validate.errors)).toBe(true);
      expect(first).toEqual(second);
      expect(first.entries).toHaveLength(logicalMaterials.size);
      expect(new Set(first.entries.map(({ material }) => material))).toEqual(logicalMaterials);
      expect(first.entries.map(({ material }) => material)).toEqual(
        [...logicalMaterials].sort((left, right) => left.localeCompare(right, 'en')),
      );
      expect(first.entries.every(({ role }) => PROFILE_ROLES[profile].includes(role))).toBe(true);
      expect(first.layout).toEqual({
        plan_id: layout.plan.plan_id,
        sha256: layout.binding.sha256,
      });
    },
  );

  it('serializes exact deterministic bytes and prepares a bound pack record', async () => {
    const layout = await prepared('topdown-farm');
    const palette = await buildDefaultWorldMaterialPalette(
      layout,
      PROFILE_ROLES['topdown-farm'],
    );
    const first = await serializeCanonicalWorldMaterialPalette(palette);
    const second = await serializeCanonicalWorldMaterialPalette(palette);
    const packEntry = await prepareWorldMaterialPalettePackEntry(
      layout,
      PROFILE_ROLES['topdown-farm'],
    );

    expect(first).toEqual(second);
    expect(first.at(-1)).toBe(10);
    expect(packEntry.bytes).toEqual(first);
    expect(packEntry.binding.layout_plan_sha256).toBe(layout.binding.sha256);
    expect(packEntry.binding.path).toBe('world-material-palette.json');
    expect(packEntry.binding.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects missing, duplicate, unsorted, unknown-role, and wrong-layout mappings', async () => {
    const layout = await prepared('topdown-farm');
    const palette = await buildDefaultWorldMaterialPalette(
      layout,
      PROFILE_ROLES['topdown-farm'],
    );
    const expected = {
      plan: layout.plan,
      layoutPlanSha256: layout.binding.sha256,
      availableRoles: PROFILE_ROLES['topdown-farm'],
    };

    const missing = mutable(palette);
    missing.entries.pop();
    await expect(materializeWorldMaterialPalette(missing, expected)).rejects.toMatchObject({
      code: 'material-palette.incomplete',
    });

    const duplicate = mutable(palette);
    duplicate.entries[1].material = duplicate.entries[0].material;
    await expect(materializeWorldMaterialPalette(duplicate, expected)).rejects.toMatchObject({
      code: 'material-palette.invalid-value',
    });

    const unsorted = mutable(palette);
    unsorted.entries.reverse();
    await expect(materializeWorldMaterialPalette(unsorted, expected)).rejects.toMatchObject({
      code: 'material-palette.invalid-value',
    });

    const unknownRole = mutable(palette);
    unknownRole.entries[0].role = 'terrain.not-in-pack';
    await expect(materializeWorldMaterialPalette(unknownRole, expected)).rejects.toMatchObject({
      code: 'material-palette.invalid-binding',
    });

    const wrongLayout = mutable(palette);
    wrongLayout.layout.sha256 = 'f'.repeat(64);
    await expect(materializeWorldMaterialPalette(wrongLayout, expected)).rejects.toMatchObject({
      code: 'material-palette.invalid-binding',
    });
  });

  it('rejects private extensions and unsupported generated material ids', async () => {
    const layout = await prepared('side-platformer');
    const palette = await buildDefaultWorldMaterialPalette(
      layout,
      PROFILE_ROLES['side-platformer'],
    );
    await expect(materializeWorldMaterialPalette({
      ...palette,
      private_consumer: 'not-portable',
    })).rejects.toBeInstanceOf(WorldMaterialPaletteError);

    const customLayout = mutable(layout);
    customLayout.plan.terrain_layout.bands[0].material = 'unmapped-new-material';
    await expect(buildDefaultWorldMaterialPalette(
      customLayout,
      PROFILE_ROLES['side-platformer'],
    )).rejects.toMatchObject({
      code: 'material-palette.unsupported-material',
    });
  });
});
