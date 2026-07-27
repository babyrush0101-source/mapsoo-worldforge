import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import intakeSchema from '../../schemas/mapsoo-confirmed-world-creation-intake-1.0.schema.json';
import { WORLD_ASSET_PROFILES, type WorldAssetProfile } from './asset-profile';
import {
  ConfirmedWorldCreationIntakeError,
  createConfirmedWorldCreationIntake,
  fingerprintConfirmedWorldCreationIntake,
  materializeConfirmedWorldCreationIntake,
  projectConfirmedWorldCreationIntake,
} from './confirmed-world-creation-intake';

const CHARACTER_HASH = 'a'.repeat(64);
const ENVIRONMENT_HASH = 'b'.repeat(64);
const IDENTITY_HASH = 'c'.repeat(64);
const PREVIEW_HASH = 'd'.repeat(64);

function reference(role: 'environment-style' | 'character') {
  const stem = role === 'character' ? 'traveler' : 'riverside';
  return {
    id: `${stem}-reference`,
    role,
    path: `references/${stem}.png`,
    mediaType: 'image/png',
    byteLength: 4096,
    width: 512,
    height: 512,
    sha256: role === 'character' ? CHARACTER_HASH : ENVIRONMENT_HASH,
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  } as const;
}

async function intake(profile: WorldAssetProfile = 'topdown-farm') {
  return createConfirmedWorldCreationIntake({
    intake_id: `riverside-${profile}-world`,
    session_revision: 8,
    profile,
    target: 'raspberry-pi-4b',
    seed: `riverside-${profile}-seed`,
    facts: {
      premise: 'A young courier reconnects neighborhoods separated by a seasonal river.',
      worldview: 'Promises shape safe routes, and every restored crossing changes how the community cooperates.',
      terrain: 'Low river terraces, orchards, reed wetlands, and one elevated stone ridge.',
      geography: 'A west ferry, central market island, eastern homes, and a hill gate form the main route.',
      culture: 'River crafts, shared meals, painted ferry signs, and a weekly lantern exchange define the settlement.',
      ecology: 'Willows, reeds, ducks, fireflies, orchard trees, and shallow seasonal flood pools.',
      mood: 'Hopeful morning exploration with gentle mystery and strong landmark readability.',
      art_direction: 'Hand-painted pixel art, warm amber landmarks, teal water, soft mist, and clean silhouettes.',
      traversal: 'Spawn at the old ferry, cross two restored routes, visit the market, then reach the hill gate.',
      landmarks: 'Old ferry, lantern market, waterwheel workshop, ridge shrine, and the hill gate exit.',
    },
    character_source: {
      reference_id: 'traveler-reference',
      identity_digest_sha256: IDENTITY_HASH,
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: PREVIEW_HASH,
  });
}

describe('confirmed world creation intake 1.0', () => {
  it.each(WORLD_ASSET_PROFILES)('accepts and projects a complete %s conversation', async (profile) => {
    const value = await intake(profile);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(intakeSchema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);

    const projection = await projectConfirmedWorldCreationIntake(value);
    expect(projection.intake.profile).toBe(profile);
    expect(projection.generation_request.profile).toBe(profile);
    expect(projection.generation_request.references).toHaveLength(2);
    expect(projection.generation_request.description).toContain('Worldview:');
    expect(projection.generation_request.description).toContain('Geography:');
    expect(projection.generation_request.description).toContain('Culture:');
    expect(projection.generation_binding.checkpoints.map(({ stage }) => stage)).toEqual([
      'world-brief',
      'art-direction',
      'map-layout',
      'style-sample',
    ]);
    expect(projection.intake_sha256).toBe(await fingerprintConfirmedWorldCreationIntake(value));
  });

  it('binds every checkpoint to its confirmed fact group', async () => {
    const value = await intake();
    await expect(materializeConfirmedWorldCreationIntake({
      ...value,
      facts: { ...value.facts, culture: 'A replacement culture that was never confirmed.' },
    })).rejects.toMatchObject({ code: 'intake.checkpoint-mismatch' });
    await expect(materializeConfirmedWorldCreationIntake({
      ...value,
      approved_intent_preview_sha256: 'e'.repeat(64),
    })).rejects.toMatchObject({ code: 'intake.checkpoint-mismatch' });
  });

  it('requires the selected character source to be the declared character reference', async () => {
    const value = await intake();
    await expect(materializeConfirmedWorldCreationIntake({
      ...value,
      character_source: {
        ...value.character_source,
        reference_id: 'riverside-reference',
      },
    })).rejects.toMatchObject({ code: 'intake.invalid-reference' });
  });

  it('rejects private extension fields and local absolute paths', async () => {
    const value = await intake();
    await expect(materializeConfirmedWorldCreationIntake({
      ...value,
      private_user_record: 'not-portable',
    })).rejects.toBeInstanceOf(ConfirmedWorldCreationIntakeError);
    await expect(materializeConfirmedWorldCreationIntake({
      ...value,
      references: [
        { ...value.references[0], path: 'C:/private/world.png' },
        value.references[1],
      ],
    })).rejects.toMatchObject({ code: 'intake.invalid-reference' });
  });
});
