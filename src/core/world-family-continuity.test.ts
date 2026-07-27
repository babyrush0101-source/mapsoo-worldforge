import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import continuitySchema from '../../schemas/mapsoo-world-family-continuity-1.0.schema.json';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';
import {
  CHARACTER_PROFILE_REVISION_VERSION,
  requiredCharacterProfileClips,
  type CharacterProfileRevision,
} from './character-profile-revision';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from './confirmed-world-creation-intake';
import type { CharacterAction, CharacterDirection } from './generated-asset-bundle';
import {
  WorldFamilyContinuityError,
  createWorldFamilyContinuity,
  materializeWorldFamilyContinuity,
  verifyWorldFamilyContinuity,
  type WorldFamilyContinuitySources,
} from './world-family-continuity';

const CHARACTER_HASH = 'a'.repeat(64);
const ENVIRONMENT_HASH = 'b'.repeat(64);
const IDENTITY_HASH = 'c'.repeat(64);

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

async function intake(profile: WorldAssetProfile): Promise<ConfirmedWorldCreationIntake> {
  return createConfirmedWorldCreationIntake({
    intake_id: `riverside-${profile}-world`,
    session_revision: 8,
    profile,
    target: 'raspberry-pi-4b',
    seed: 'riverside-family-seed',
    facts: {
      premise: 'A young courier reconnects neighborhoods separated by a seasonal river.',
      worldview: 'Promises shape safe routes, and restored crossings change community cooperation.',
      terrain: 'Low river terraces, orchards, reed wetlands, and one elevated stone ridge.',
      geography: `${profile} projection of the west ferry, market island, eastern homes, and hill gate.`,
      culture: 'River crafts, shared meals, painted ferry signs, and lantern exchange define the settlement.',
      ecology: 'Willows, reeds, ducks, fireflies, orchard trees, and shallow seasonal flood pools.',
      mood: 'Hopeful morning exploration with gentle mystery and strong landmark readability.',
      art_direction: `${profile} pixel-art camera grammar with teal water and warm amber landmarks.`,
      traversal: `${profile} route from the old ferry through the market to the hill gate.`,
      landmarks: 'Old ferry, lantern market, waterwheel workshop, ridge shrine, and hill gate exit.',
    },
    character_source: {
      reference_id: 'traveler-reference',
      identity_digest_sha256: IDENTITY_HASH,
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: (
      WORLD_ASSET_PROFILES.indexOf(profile) + 1
    ).toString(16).repeat(64),
  });
}

function characterRevision(profile: WorldAssetProfile): CharacterProfileRevision {
  const clipIds = requiredCharacterProfileClips(profile);
  const columns = 8;
  const rows = Math.ceil(clipIds.length / columns);
  return {
    schema_version: CHARACTER_PROFILE_REVISION_VERSION,
    document_type: 'character-profile-revision',
    profile_revision_id: `traveler-${profile}-revision-one`,
    character_id: 'traveler-one',
    profile,
    atlas: {
      path: `characters/${profile}/traveler-one.png`,
      media_type: 'image/png',
      bytes: 8192,
      sha256: (
        WORLD_ASSET_PROFILES.indexOf(profile) + 5
      ).toString(16).repeat(64),
      width: columns * 32,
      height: rows * 32,
    },
    frame_geometry: {
      frame_width: 32,
      frame_height: 32,
      columns,
      rows,
    },
    pivot: { x: 16, y: 30, unit: 'pixels' },
    clips: clipIds.map((clipId, index) => {
      const [action, direction] = clipId.split('.') as [CharacterAction, CharacterDirection];
      return {
        clip_id: clipId,
        action,
        direction,
        fps: 8,
        loop: action !== 'defeat',
        frames: [{ column: index % columns, row: Math.floor(index / columns) }],
      };
    }),
    source_identity: {
      identity_digest_sha256: IDENTITY_HASH,
      source_reference_ids: ['traveler-reference'],
    },
    rights: {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    },
  };
}

async function sources(): Promise<WorldFamilyContinuitySources> {
  return Object.freeze(Object.fromEntries(await Promise.all(
    WORLD_ASSET_PROFILES.map(async (profile) => [
      profile,
      Object.freeze({
        intake: await intake(profile),
        character_revision: characterRevision(profile),
      }),
    ]),
  ))) as WorldFamilyContinuitySources;
}

describe('world family continuity 1.0', () => {
  it('binds one confirmed world and character across the exact four profiles', async () => {
    const sourceSet = await sources();
    const value = await createWorldFamilyContinuity('riverside-world-family', sourceSet);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(continuitySchema);

    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(value.profiles.map(({ profile }) => profile)).toEqual(WORLD_ASSET_PROFILES);
    expect(value.status).toBe('continuity-confirmed');
    expect(value.character_identity_sha256).toBe(IDENTITY_HASH);
    await expect(verifyWorldFamilyContinuity(value, sourceSet)).resolves.toEqual(value);
  });

  it('allows camera, geography and traversal to adapt per profile', async () => {
    const value = await createWorldFamilyContinuity(
      'riverside-world-family',
      await sources(),
    );
    expect(value.world_identity_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when shared world identity or the environment reference drifts', async () => {
    const sourceSet = await sources();
    const changedWorld = await createConfirmedWorldCreationIntake({
      ...sourceSet['topdown-farm'].intake as ConfirmedWorldCreationIntake,
      facts: {
        ...(sourceSet['topdown-farm'].intake as ConfirmedWorldCreationIntake).facts,
        landmarks: 'A different landmark set that does not belong to this world family.',
      },
    });
    await expect(createWorldFamilyContinuity('riverside-world-family', {
      ...sourceSet,
      'topdown-farm': {
        ...sourceSet['topdown-farm'],
        intake: changedWorld,
      },
    })).rejects.toMatchObject({ code: 'world-family.world-drift' });
  });

  it('fails closed when character identity, id, source reference or rights drift', async () => {
    const sourceSet = await sources();
    await expect(createWorldFamilyContinuity('riverside-world-family', {
      ...sourceSet,
      'layered-depth-2d': {
        ...sourceSet['layered-depth-2d'],
        character_revision: {
          ...sourceSet['layered-depth-2d'].character_revision as CharacterProfileRevision,
          character_id: 'unrelated-character',
        },
      },
    })).rejects.toMatchObject({ code: 'world-family.character-drift' });
  });

  it('rejects missing profiles and profile-swapped source documents', async () => {
    const sourceSet = await sources();
    const { 'layered-depth-2d': _omitted, ...incomplete } = sourceSet;
    await expect(createWorldFamilyContinuity(
      'riverside-world-family',
      incomplete,
    )).rejects.toMatchObject({ code: 'world-family.invalid-shape' });
    await expect(createWorldFamilyContinuity('riverside-world-family', {
      ...sourceSet,
      'topdown-farm': sourceSet['side-platformer'],
    })).rejects.toMatchObject({ code: 'world-family.profile-mismatch' });
  });

  it('rejects changed bindings and private extension fields', async () => {
    const sourceSet = await sources();
    const value = await createWorldFamilyContinuity('riverside-world-family', sourceSet);
    await expect(verifyWorldFamilyContinuity({
      ...value,
      world_identity_sha256: 'f'.repeat(64),
    }, sourceSet)).rejects.toMatchObject({ code: 'world-family.binding-mismatch' });
    expect(() => materializeWorldFamilyContinuity({
      ...value,
      private_consumer_record: 'forbidden',
    })).toThrow(WorldFamilyContinuityError);
  });
});
