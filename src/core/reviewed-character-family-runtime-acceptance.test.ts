import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import acceptanceSchema from '../../schemas/mapsoo-reviewed-character-profile-family-runtime-acceptance-1.0.schema.json';
import {
  materializeCharacterProfileRevision,
  requiredCharacterProfileClips,
  serializeCharacterProfileRevisionCanonical,
  type CharacterProfileRevision,
} from './character-profile-revision';
import {
  materializeReviewedCharacterProfileFamily,
  serializeReviewedCharacterProfileFamilyCanonical,
  type ReviewedCharacterProfileFamilyArtifacts,
} from './reviewed-character-profile-family';
import {
  buildReviewedCharacterFamilyRuntimeAcceptance,
  fingerprintReviewedCharacterFamilyRuntimeAcceptance,
  materializeReviewedCharacterFamilyRuntimeAcceptance,
  verifyReviewedCharacterFamilyRuntimeAcceptance,
  type ReviewedCharacterFamilyRuntimeRun,
} from './reviewed-character-family-runtime-acceptance';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function runs(): readonly ReviewedCharacterFamilyRuntimeRun[] {
  return Object.freeze([
    {
      compatibility_version: '4.3',
      engine_version: '4.3.stable.official.synthetic',
      executable_sha256: '8'.repeat(64),
      host_platform: 'windows',
      host_architecture: 'x86_64',
      mode: 'headless-character-family-bind',
      profiles_loaded: 4,
      clips_loaded: 84,
      result: 'pass',
    },
    {
      compatibility_version: '4.7',
      engine_version: '4.7.stable.official.synthetic',
      executable_sha256: '9'.repeat(64),
      host_platform: 'windows',
      host_architecture: 'x86_64',
      mode: 'headless-character-family-bind',
      profiles_loaded: 4,
      clips_loaded: 84,
      result: 'pass',
    },
  ]);
}

async function fixture(): Promise<{
  family: ReturnType<typeof materializeReviewedCharacterProfileFamily>;
  familyBytes: Uint8Array;
  artifacts: ReviewedCharacterProfileFamilyArtifacts;
}> {
  const pairs = await Promise.all(WORLD_ASSET_PROFILES.map(
    async (profile: WorldAssetProfile, index: number) => {
      const atlasBytes = Uint8Array.of(137, 80, 78, 71, index + 1);
      const atlasSha256 = await sha256(atlasBytes);
      const clips = requiredCharacterProfileClips(profile).map(
        (clipId, clipIndex) => {
          const separator = clipId.indexOf('.');
          return {
            clip_id: clipId,
            action: clipId.slice(0, separator),
            direction: clipId.slice(separator + 1),
            fps: 8,
            loop: true,
            frames: [{
              column: clipIndex % 16,
              row: Math.floor(clipIndex / 16),
            }],
          };
        },
      );
      const revision = materializeCharacterProfileRevision({
        schema_version: '1.0.0',
        document_type: 'character-profile-revision',
        profile_revision_id: `runtime-fixture-${profile}-revision`,
        character_id: 'runtime-fixture-traveler',
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
          source_reference_ids: ['synthetic-contract-fixture'],
        },
        rights: {
          distribution: 'private',
          license: 'LicenseRef-Proprietary',
        },
      }) as CharacterProfileRevision;
      const revisionBytes = serializeCharacterProfileRevisionCanonical(revision);
      return [profile, {
        revision,
        revisionBytes,
        atlasBytes,
        revisionSha256: await sha256(revisionBytes),
        atlasSha256,
      }] as const;
    },
  ));
  const records = Object.fromEntries(pairs);
  const family = materializeReviewedCharacterProfileFamily({
    schema_version: '1.0.0',
    document_type: 'reviewed-character-profile-family',
    family_id: 'runtime-fixture-family',
    character_id: 'runtime-fixture-traveler',
    character_identity_sha256: 'a'.repeat(64),
    rights: {
      distribution: 'private',
      license: 'LicenseRef-Proprietary',
    },
    profiles: WORLD_ASSET_PROFILES.map((profile, index) => ({
      profile,
      profile_revision_id: records[profile].revision.profile_revision_id,
      revision_path:
        `profiles/${profile}/character-profile-revision.json`,
      revision_sha256: records[profile].revisionSha256,
      atlas_path: `profiles/${profile}/character-profile-atlas.png`,
      atlas_sha256: records[profile].atlasSha256,
      clip_count: records[profile].revision.clips.length,
      reviewed_source: {
        source_profile_revision_id: `synthetic-source-${index + 1}`,
        source_profile_revision_sha256: '1'.repeat(64),
        production_character_projection_sha256: '2'.repeat(64),
        runtime_overlay_sha256: '3'.repeat(64),
        runtime_projection_sha256: '4'.repeat(64),
        human_review_receipt_sha256: '5'.repeat(64),
        approved_world_review_sha256: '6'.repeat(64),
      },
    })),
    privacy: {
      source_images_included: false,
      source_paths_included: false,
      raw_prompts_included: false,
      provider_credentials_included: false,
    },
    review: {
      technical_world_review: 'passed',
      human_art_review: 'passed',
      exact_profile_count: 4,
      godot_family_runtime: 'pending',
      raspberry_pi: 'pending',
    },
    status: 'reviewed-release-candidate',
  });
  return {
    family,
    familyBytes: serializeReviewedCharacterProfileFamilyCanonical(family),
    artifacts: Object.freeze(Object.fromEntries(
      WORLD_ASSET_PROFILES.map((profile) => [profile, {
        revision: records[profile].revision,
        revisionBytes: records[profile].revisionBytes,
        atlasBytes: records[profile].atlasBytes,
      }]),
    )) as ReviewedCharacterProfileFamilyArtifacts,
  };
}

describe('reviewed character family runtime acceptance', () => {
  it('binds exact family bytes and artifacts to ordered Godot 4.3/4.7 runs', async () => {
    const input = await fixture();
    const acceptance = await buildReviewedCharacterFamilyRuntimeAcceptance({
      ...input,
      runs: runs(),
    });
    const validate = new Ajv2020({
      strict: true,
      allErrors: true,
    }).compile(acceptanceSchema);

    expect(validate(acceptance), JSON.stringify(validate.errors)).toBe(true);
    expect(acceptance.profiles.map(({ profile }) => profile))
      .toEqual(WORLD_ASSET_PROFILES);
    expect(acceptance.runs.map(({ compatibility_version }) =>
      compatibility_version)).toEqual(['4.3', '4.7']);
    expect(acceptance.claims).toEqual({
      exact_family_artifacts_tested: true,
      technical_runtime_compatibility: 'passed',
      visual_quality_reassessed: false,
      human_art_review_reassessed: false,
      physical_raspberry_pi_tested: false,
    });
    await expect(verifyReviewedCharacterFamilyRuntimeAcceptance(
      acceptance,
      input.family,
      input.familyBytes,
      input.artifacts,
    )).resolves.toEqual(acceptance);
    expect(await fingerprintReviewedCharacterFamilyRuntimeAcceptance(acceptance))
      .toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects incomplete runs, expanded claims and local-path fields', async () => {
    const input = await fixture();
    const acceptance = await buildReviewedCharacterFamilyRuntimeAcceptance({
      ...input,
      runs: runs(),
    });
    expect(() => materializeReviewedCharacterFamilyRuntimeAcceptance({
      ...acceptance,
      runs: acceptance.runs.slice(0, 1),
    })).toThrowError(expect.objectContaining({
      code: 'reviewed-character-runtime.incomplete-runs',
    }));
    expect(() => materializeReviewedCharacterFamilyRuntimeAcceptance({
      ...acceptance,
      claims: {
        ...acceptance.claims,
        physical_raspberry_pi_tested: true,
      },
    })).toThrowError(expect.objectContaining({
      code: 'reviewed-character-runtime.invalid-value',
    }));
    expect(() => materializeReviewedCharacterFamilyRuntimeAcceptance({
      ...acceptance,
      local_path: 'C:/private/family',
    })).toThrowError(expect.objectContaining({
      code: 'reviewed-character-runtime.invalid-shape',
    }));
  });

  it('rejects changed manifest, atlas, and run evidence', async () => {
    const input = await fixture();
    const acceptance = await buildReviewedCharacterFamilyRuntimeAcceptance({
      ...input,
      runs: runs(),
    });
    await expect(verifyReviewedCharacterFamilyRuntimeAcceptance(
      acceptance,
      input.family,
      Uint8Array.of(1, 2, 3),
      input.artifacts,
    )).rejects.toMatchObject({
      code: 'reviewed-character-runtime.integrity',
    });
    await expect(verifyReviewedCharacterFamilyRuntimeAcceptance(
      acceptance,
      input.family,
      input.familyBytes,
      {
        ...input.artifacts,
        'topdown-farm': {
          ...input.artifacts['topdown-farm'],
          atlasBytes: Uint8Array.of(9, 9, 9),
        },
      },
    )).rejects.toMatchObject({
      code: 'reviewed-character-family.integrity',
    });
    const changedRun = {
      ...acceptance,
      runs: [
        { ...acceptance.runs[0], executable_sha256: '7'.repeat(64) },
        acceptance.runs[1],
      ],
    };
    await expect(verifyReviewedCharacterFamilyRuntimeAcceptance(
      changedRun,
      input.family,
      input.familyBytes,
      input.artifacts,
    )).rejects.toMatchObject({
      code: 'reviewed-character-runtime.binding-mismatch',
    });
  });
});
