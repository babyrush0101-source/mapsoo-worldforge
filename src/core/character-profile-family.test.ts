import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import familySchema from '../../schemas/mapsoo-character-profile-family-1.0.schema.json';
import {
  materializeCharacterProfileRevision,
  requiredCharacterProfileClips,
  serializeCharacterProfileRevisionCanonical,
  type CharacterProfileRevision,
} from './character-profile-revision';
import {
  fingerprintCharacterProfileFamily,
  materializeCharacterProfileFamily,
  verifyCharacterProfileFamily,
  type CharacterProfileFamilyArtifacts,
} from './character-profile-family';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function revision(
  profile: WorldAssetProfile,
  atlasBytes: Uint8Array,
  atlasSha256: string,
): CharacterProfileRevision {
  const clips = requiredCharacterProfileClips(profile).map((clipId, index) => {
    const separator = clipId.indexOf('.');
    return {
      clip_id: clipId,
      action: clipId.slice(0, separator),
      direction: clipId.slice(separator + 1),
      fps: 8,
      loop: true,
      frames: [{ column: index % 16, row: Math.floor(index / 16) }],
    };
  });
  return materializeCharacterProfileRevision({
    schema_version: '1.0.0',
    document_type: 'character-profile-revision',
    profile_revision_id: `neutral-traveler-${profile}-revision`,
    character_id: 'neutral-traveler',
    profile,
    atlas: {
      path: 'character-profile-atlas.png',
      media_type: 'image/png',
      bytes: atlasBytes.byteLength,
      sha256: atlasSha256,
      width: 256,
      height: 256,
    },
    frame_geometry: {
      frame_width: 16,
      frame_height: 16,
      columns: 16,
      rows: 16,
    },
    pivot: { x: 8, y: 14, unit: 'pixels' },
    clips,
    source_identity: {
      identity_digest_sha256: 'a'.repeat(64),
      source_reference_ids: ['character-reference'],
    },
    rights: {
      distribution: 'internal-review',
      license: 'CC0-1.0',
    },
  });
}

async function fixture(): Promise<{
  family: unknown;
  artifacts: CharacterProfileFamilyArtifacts;
}> {
  const pairs = await Promise.all(WORLD_ASSET_PROFILES.map(async (profile, index) => {
    const atlasBytes = Uint8Array.of(index + 1, 17, 29, 43);
    const atlasSha256 = await sha256(atlasBytes);
    const profileRevision = revision(profile, atlasBytes, atlasSha256);
    const revisionBytes = serializeCharacterProfileRevisionCanonical(profileRevision);
    return [profile, {
      revision: profileRevision,
      revisionBytes,
      atlasBytes,
      member: {
        profile,
        profile_revision_id: profileRevision.profile_revision_id,
        revision_path: `profiles/${profile}/character-profile-revision.json`,
        revision_sha256: await sha256(revisionBytes),
        atlas_path: `profiles/${profile}/character-profile-atlas.png`,
        atlas_sha256: atlasSha256,
        clip_count: profileRevision.clips.length,
      },
    }] as const;
  }));
  const records = Object.fromEntries(pairs);
  return {
    family: {
      schema_version: '1.0.0',
      document_type: 'character-profile-family',
      family_id: 'neutral-traveler-family',
      character_id: 'neutral-traveler',
      character_identity_sha256: 'a'.repeat(64),
      generation: {
        mode: 'procedural-reference-baseline',
        environment_style_signature_sha256: 'b'.repeat(64),
        description_binding_sha256: 'c'.repeat(64),
        seed_binding_sha256: 'd'.repeat(64),
      },
      rights: {
        distribution: 'internal-review',
        license: 'CC0-1.0',
      },
      profiles: WORLD_ASSET_PROFILES.map((profile) => records[profile].member),
      privacy: {
        source_images_included: false,
        source_paths_included: false,
        source_file_digests_included: false,
        free_text_description_included: false,
      },
      review: {
        human_art_review: 'required',
        production_ready: false,
      },
      status: 'internal-review',
    },
    artifacts: Object.freeze(Object.fromEntries(
      WORLD_ASSET_PROFILES.map((profile) => [
        profile,
        {
          revision: records[profile].revision,
          revisionBytes: records[profile].revisionBytes,
          atlasBytes: records[profile].atlasBytes,
        },
      ]),
    )) as CharacterProfileFamilyArtifacts,
  };
}

describe('character profile family', () => {
  it('materializes, fingerprints and schema-validates one ordered four-profile family', async () => {
    const { family, artifacts } = await fixture();
    const materialized = materializeCharacterProfileFamily(family);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(familySchema);

    expect(validate(materialized), JSON.stringify(validate.errors)).toBe(true);
    expect(materialized.profiles.map(({ profile }) => profile))
      .toEqual(WORLD_ASSET_PROFILES);
    expect(await verifyCharacterProfileFamily(materialized, artifacts)).toEqual(materialized);
    expect(await fingerprintCharacterProfileFamily(materialized))
      .toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects missing profiles, non-private privacy flags and rights/status drift', async () => {
    const { family } = await fixture();
    const value = family as Record<string, unknown>;
    expect(() => materializeCharacterProfileFamily({
      ...value,
      profiles: (value.profiles as unknown[]).slice(0, 3),
    })).toThrowError(expect.objectContaining({ code: 'character-family.incomplete-profiles' }));
    expect(() => materializeCharacterProfileFamily({
      ...value,
      privacy: {
        ...(value.privacy as Record<string, unknown>),
        source_paths_included: true,
      },
    })).toThrowError(expect.objectContaining({ code: 'character-family.invalid-value' }));
    expect(() => materializeCharacterProfileFamily({
      ...value,
      status: 'public',
    })).toThrowError(expect.objectContaining({ code: 'character-family.invalid-rights' }));
  });

  it('rejects changed atlas bytes, revision bytes and identity bindings', async () => {
    const { family, artifacts } = await fixture();
    const atlasChanged = {
      ...artifacts,
      'side-platformer': {
        ...artifacts['side-platformer'],
        atlasBytes: Uint8Array.of(99, 98, 97),
      },
    } as CharacterProfileFamilyArtifacts;
    await expect(verifyCharacterProfileFamily(family, atlasChanged))
      .rejects.toMatchObject({ code: 'character-family.integrity' });

    const revisionChanged = {
      ...artifacts,
      'topdown-farm': {
        ...artifacts['topdown-farm'],
        revisionBytes: Uint8Array.of(1, 2, 3),
      },
    } as CharacterProfileFamilyArtifacts;
    await expect(verifyCharacterProfileFamily(family, revisionChanged))
      .rejects.toMatchObject({ code: 'character-family.integrity' });

    const identityChanged = {
      ...artifacts,
      'isometric-action': {
        ...artifacts['isometric-action'],
        revision: {
          ...(artifacts['isometric-action'].revision as CharacterProfileRevision),
          source_identity: {
            identity_digest_sha256: 'e'.repeat(64),
            source_reference_ids: ['character-reference'],
          },
        },
      },
    } as CharacterProfileFamilyArtifacts;
    await expect(verifyCharacterProfileFamily(family, identityChanged))
      .rejects.toMatchObject({ code: 'character-family.binding-mismatch' });
  });
});
