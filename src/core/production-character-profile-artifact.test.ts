import { describe, expect, it } from 'vitest';

import {
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  requiredCharacterProfileClips,
  type CharacterProfileRevision,
} from './character-profile-revision';

function neutralPrivateFixture(): CharacterProfileRevision {
  const clipIds = requiredCharacterProfileClips('side-platformer');
  return {
    schema_version: '1.0.0',
    document_type: 'character-profile-revision',
    profile_revision_id: 'neutral-side-platformer-v1',
    character_id: 'neutral-courier',
    profile: 'side-platformer',
    atlas: {
      path: 'fixtures/neutral-courier-side-platformer.png',
      media_type: 'image/png',
      bytes: 4096,
      sha256: 'a'.repeat(64),
      width: 1024,
      height: 384,
    },
    frame_geometry: {
      frame_width: 128,
      frame_height: 128,
      columns: 8,
      rows: 3,
    },
    pivot: {
      x: 64,
      y: 120,
      unit: 'pixels',
    },
    clips: clipIds.map((clipId, index) => {
      const [action, direction] = clipId.split('.') as [
        CharacterProfileRevision['clips'][number]['action'],
        CharacterProfileRevision['clips'][number]['direction'],
      ];
      const first = index * 2;
      const second = first + 1;
      return {
        clip_id: clipId,
        action,
        direction,
        fps: action === 'run' ? 10 : 6,
        loop: action === 'idle' || action === 'run' || action === 'fall',
        frames: [
          { column: first % 8, row: Math.floor(first / 8) },
          { column: second % 8, row: Math.floor(second / 8) },
        ],
      };
    }),
    source_identity: {
      identity_digest_sha256: 'b'.repeat(64),
      source_reference_ids: ['synthetic-character'],
    },
    rights: {
      distribution: 'private',
      license: 'LicenseRef-Proprietary',
    },
  };
}

describe('source-free private character profile fixture', () => {
  it('materializes a complete private revision without importing internal art evidence', async () => {
    const revision = materializeCharacterProfileRevision(neutralPrivateFixture());

    expect(revision.profile_revision_id).toBe('neutral-side-platformer-v1');
    expect(revision.profile).toBe('side-platformer');
    expect(revision.rights).toEqual({
      distribution: 'private',
      license: 'LicenseRef-Proprietary',
    });
    expect(revision.atlas).toMatchObject({
      bytes: 4096,
      sha256: 'a'.repeat(64),
      width: 1024,
      height: 384,
    });
    expect(revision.clips.map((clip) => clip.clip_id)).toEqual(
      requiredCharacterProfileClips('side-platformer'),
    );
    expect(revision.clips.every((clip) => clip.frames.length === 2)).toBe(true);
    expect(await fingerprintCharacterProfileRevision(revision)).toMatch(/^[a-f0-9]{64}$/);
  });
});
