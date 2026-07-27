import { describe, expect, it } from 'vitest';

import { createConfirmedWorldCreationIntake } from './confirmed-world-creation-intake';
import {
  prepareWorldLayoutPackEntry,
  validateWorldLayoutPackBinding,
  WORLD_LAYOUT_PACK_PATH,
} from './world-layout-pack-binding';
import { buildWorldLayoutPlanFromConfirmedIntake } from './world-layout-plan';

async function layout(profile: 'topdown-farm' | 'side-platformer' = 'topdown-farm') {
  const rights = {
    basis: 'owned' as const,
    license: 'LicenseRef-User-Owned',
    allowGenerativeAdaptation: true as const,
    allowOutputRedistribution: true as const,
    allowOutputCc0Dedication: true as const,
  };
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: `layout-pack-${profile}`,
    session_revision: 4,
    profile,
    target: 'raspberry-pi-4b',
    seed: 'layout-pack-seed',
    facts: {
      premise: 'Restore a compact harbor route.',
      worldview: 'Lantern guilds preserve safe passage.',
      terrain: 'Stone paths, wet docks, and reed beds.',
      geography: 'A readable route connects the pier and lighthouse.',
      culture: 'Boat builders share a market square.',
      ecology: 'Rain, gulls, salt grass, and fog.',
      mood: 'Quiet and readable.',
      art_direction: 'Original hand-painted pixel art.',
      traversal: 'Move from the pier through two landmarks to the exit.',
      landmarks: 'Bell buoy; leaning lighthouse',
    },
    character_source: {
      reference_id: 'character-reference',
      identity_digest_sha256: 'a'.repeat(64),
    },
    references: [{
      id: 'environment-reference',
      role: 'environment-style',
      path: 'references/environment.png',
      mediaType: 'image/png',
      byteLength: 8,
      width: 1,
      height: 1,
      sha256: 'b'.repeat(64),
      rights,
    }, {
      id: 'character-reference',
      role: 'character',
      path: 'references/character.png',
      mediaType: 'image/png',
      byteLength: 8,
      width: 1,
      height: 1,
      sha256: 'c'.repeat(64),
      rights,
    }],
    approved_intent_preview_sha256: 'd'.repeat(64),
  });
  return buildWorldLayoutPlanFromConfirmedIntake(intake);
}

describe('WorldLayoutPlan pack binding', () => {
  it('materializes canonical bytes and one matching manifest file record', async () => {
    const prepared = await prepareWorldLayoutPackEntry(
      await layout(),
      'topdown-farm',
      'layout-pack-seed',
    );
    expect(prepared.binding.path).toBe(WORLD_LAYOUT_PACK_PATH);
    expect(prepared.binding.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(new TextDecoder().decode(prepared.bytes)).toContain('"document_type":"world-layout-plan"');
    expect(validateWorldLayoutPackBinding(prepared.binding, [{
      path: WORLD_LAYOUT_PACK_PATH,
      media_type: 'application/json',
      bytes: prepared.bytes.byteLength,
      sha256: prepared.binding.sha256,
    }])).toEqual([]);
  });

  it('rejects profile, seed, and manifest file mismatches', async () => {
    const plan = await layout('side-platformer');
    await expect(prepareWorldLayoutPackEntry(
      plan,
      'topdown-farm',
      'layout-pack-seed',
    )).rejects.toThrow(/profile/u);
    await expect(prepareWorldLayoutPackEntry(
      plan,
      'side-platformer',
      'different-seed',
    )).rejects.toThrow(/seed/u);
    const prepared = await prepareWorldLayoutPackEntry(
      plan,
      'side-platformer',
      'layout-pack-seed',
    );
    expect(validateWorldLayoutPackBinding(prepared.binding, [{
      path: WORLD_LAYOUT_PACK_PATH,
      media_type: 'application/json',
      bytes: prepared.bytes.byteLength,
      sha256: 'f'.repeat(64),
    }]).map(({ code }) => code)).toContain('layout.file-record');
  });
});
