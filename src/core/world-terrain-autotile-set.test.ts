import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import autotileSchema from '../../schemas/mapsoo-world-terrain-autotile-set-1.0.schema.json';
import { WORLD_ASSET_PROFILES, type WorldAssetProfile } from './asset-profile';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from './confirmed-world-creation-intake';
import { buildWorldLayoutPlanFromConfirmedIntake } from './world-layout-plan';
import { prepareWorldLayoutPackEntry } from './world-layout-pack-binding';
import { prepareWorldMaterialPalettePackEntry } from './world-material-palette';
import {
  buildWorldTerrainAutotileSet,
  materializeWorldTerrainAutotileSet,
  prepareWorldTerrainAutotilePackEntry,
  serializeCanonicalWorldTerrainAutotileSet,
  validateWorldTerrainAutotilePackBinding,
  WorldTerrainAutotileError,
} from './world-terrain-autotile-set';

const PROFILE_ROLES = Object.freeze({
  'side-platformer': [
    'terrain.solid', 'terrain.one-way', 'terrain.slope-up', 'terrain.slope-down',
    'terrain.wall', 'terrain.breakable', 'terrain.water',
  ],
  'topdown-farm': [
    'terrain.ground', 'terrain.water', 'terrain.path', 'terrain.soil',
  ],
  'isometric-action': [
    'terrain.void', 'terrain.floor.base', 'terrain.floor.variant',
    'terrain.floor.edge', 'terrain.elevation.top', 'terrain.elevation.riser-left',
    'terrain.elevation.riser-right', 'terrain.ramp', 'terrain.wall', 'terrain.water',
  ],
  'layered-depth-2d': [
    'terrain.ground', 'terrain.path', 'terrain.edge', 'terrain.bridge',
    'terrain.stairs', 'terrain.water',
  ],
} satisfies Readonly<Record<WorldAssetProfile, readonly string[]>>);

const CELL_BY_PROFILE = Object.freeze({
  'side-platformer': Object.freeze({ width: 32, height: 32 }),
  'topdown-farm': Object.freeze({ width: 32, height: 32 }),
  'isometric-action': Object.freeze({ width: 64, height: 32 }),
  'layered-depth-2d': Object.freeze({ width: 64, height: 32 }),
} satisfies Readonly<Record<WorldAssetProfile, Readonly<{ width: number; height: number }>>>);

async function intake(profile: WorldAssetProfile): Promise<ConfirmedWorldCreationIntake> {
  return createConfirmedWorldCreationIntake({
    intake_id: `terrain-autotile-${profile}`,
    session_revision: 9,
    profile,
    target: 'raspberry-pi-4b',
    seed: `terrain-autotile-${profile}-seed`,
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

async function fixture(profile: WorldAssetProfile) {
  const confirmed = await intake(profile);
  const plan = await buildWorldLayoutPlanFromConfirmedIntake(confirmed);
  const layout = await prepareWorldLayoutPackEntry(plan, profile, confirmed.seed);
  const palette = await prepareWorldMaterialPalettePackEntry(layout, PROFILE_ROLES[profile]);
  const images = palette.palette.entries.map(({ material }, index) => Object.freeze({
    material,
    path: `terrain-autotiles/${profile}/${material}.png`,
    sha256: (index + 1).toString(16).padStart(64, '0'),
  }));
  return { layout, palette, images };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('WorldTerrainAutotileSet 1.0', () => {
  it.each(WORLD_ASSET_PROFILES)(
    'builds a deterministic, complete, schema-valid %s edge-mask set',
    async (profile) => {
      const { layout, palette, images } = await fixture(profile);
      const first = await buildWorldTerrainAutotileSet(
        layout,
        palette,
        CELL_BY_PROFILE[profile],
        images,
      );
      const second = await buildWorldTerrainAutotileSet(
        layout,
        palette,
        CELL_BY_PROFILE[profile],
        images,
      );
      const validate = new Ajv2020({ strict: true, allErrors: true }).compile(autotileSchema);

      expect(validate(first), JSON.stringify(validate.errors)).toBe(true);
      expect(first).toEqual(second);
      expect(first.entries).toHaveLength(palette.palette.entries.length);
      expect(first.entries.map(({ material, role }) => ({ material, role }))).toEqual(
        palette.palette.entries.map(({ material, role }) => ({ material, role })),
      );
      expect(first.entries.every(({ tiles }) => (
        tiles.length === 16
        && tiles.every(({ mask, column, row }, index) => (
          mask === index && column === index % 4 && row === Math.floor(index / 4)
        ))
      ))).toBe(true);
      expect(first.layout.sha256).toBe(layout.binding.sha256);
      expect(first.palette.sha256).toBe(palette.binding.sha256);
    },
  );

  it('serializes deterministic bytes and prepares a binding chained to layout and palette', async () => {
    const profile = 'topdown-farm';
    const { layout, palette, images } = await fixture(profile);
    const prepared = await prepareWorldTerrainAutotilePackEntry(
      layout,
      palette,
      CELL_BY_PROFILE[profile],
      images,
    );
    const first = await serializeCanonicalWorldTerrainAutotileSet(prepared.set);
    const second = await serializeCanonicalWorldTerrainAutotileSet(prepared.set);

    expect(first).toEqual(second);
    expect(prepared.bytes).toEqual(first);
    expect(prepared.binding.path).toBe('world-terrain-autotiles.json');
    expect(prepared.binding.layout_plan_sha256).toBe(layout.binding.sha256);
    expect(prepared.binding.material_palette_sha256).toBe(palette.binding.sha256);
    expect(prepared.binding.sha256).toMatch(/^[a-f0-9]{64}$/);

    const files = [
      {
        path: prepared.binding.path,
        media_type: 'application/json',
        bytes: prepared.bytes.byteLength,
        sha256: prepared.binding.sha256,
      },
    ];
    expect(validateWorldTerrainAutotilePackBinding(
      prepared.binding,
      layout.binding,
      palette.binding,
      files,
    )).toEqual([]);
  });

  it('rejects missing coverage, duplicate cells, wrong dimensions, and wrong chained bindings', async () => {
    const profile = 'topdown-farm';
    const { layout, palette, images } = await fixture(profile);
    const canonical = await buildWorldTerrainAutotileSet(
      layout,
      palette,
      CELL_BY_PROFILE[profile],
      images,
    );
    const expected = {
      plan: layout.plan,
      layoutPlanSha256: layout.binding.sha256,
      palette: palette.palette,
      materialPaletteSha256: palette.binding.sha256,
    };

    const missing = mutable(canonical);
    missing.entries.pop();
    await expect(materializeWorldTerrainAutotileSet(missing, expected)).rejects.toMatchObject({
      code: 'terrain-autotile.incomplete',
    });

    const duplicateCell = mutable(canonical);
    duplicateCell.entries[0].tiles[1].column = duplicateCell.entries[0].tiles[0].column;
    duplicateCell.entries[0].tiles[1].row = duplicateCell.entries[0].tiles[0].row;
    await expect(materializeWorldTerrainAutotileSet(duplicateCell, expected)).rejects.toMatchObject({
      code: 'terrain-autotile.incomplete',
    });

    const wrongDimensions = mutable(canonical);
    wrongDimensions.entries[0].image.width += 1;
    await expect(materializeWorldTerrainAutotileSet(wrongDimensions, expected)).rejects.toMatchObject({
      code: 'terrain-autotile.invalid-value',
    });

    const wrongPalette = mutable(canonical);
    wrongPalette.palette.sha256 = 'f'.repeat(64);
    await expect(materializeWorldTerrainAutotileSet(wrongPalette, expected)).rejects.toMatchObject({
      code: 'terrain-autotile.invalid-binding',
    });
  });

  it('checks every image against pack records and rejects unsafe/private extensions', async () => {
    const profile = 'side-platformer';
    const { layout, palette, images } = await fixture(profile);
    const canonical = await buildWorldTerrainAutotileSet(
      layout,
      palette,
      CELL_BY_PROFILE[profile],
      images,
    );
    const imageFiles = canonical.entries.map(({ image }) => ({
      path: image.path,
      media_type: 'image/png',
      bytes: 2048,
      sha256: image.sha256,
    }));
    await expect(materializeWorldTerrainAutotileSet(canonical, {
      plan: layout.plan,
      layoutPlanSha256: layout.binding.sha256,
      palette: palette.palette,
      materialPaletteSha256: palette.binding.sha256,
      imageFiles,
    })).resolves.toEqual(canonical);

    const tamperedFiles = mutable(imageFiles);
    tamperedFiles[0].sha256 = 'e'.repeat(64);
    await expect(materializeWorldTerrainAutotileSet(canonical, {
      plan: layout.plan,
      layoutPlanSha256: layout.binding.sha256,
      palette: palette.palette,
      materialPaletteSha256: palette.binding.sha256,
      imageFiles: tamperedFiles,
    })).rejects.toMatchObject({ code: 'terrain-autotile.invalid-binding' });

    await expect(materializeWorldTerrainAutotileSet({
      ...canonical,
      private_consumer: 'not-portable',
    })).rejects.toBeInstanceOf(WorldTerrainAutotileError);

    await expect(materializeWorldTerrainAutotileSet({
      ...canonical,
      profile: 'provider-specific-world',
    })).rejects.toMatchObject({ code: 'terrain-autotile.invalid-value' });
  });
});
