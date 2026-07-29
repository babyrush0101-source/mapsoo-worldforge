import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import characterProfileSchema from '../../schemas/mapsoo-character-profile-revision-1.0.schema.json';
import type { WorldAssetProfile } from './asset-profile';
import type {
  CharacterAction,
  CharacterDirection,
} from './generated-asset-bundle';
import {
  CHARACTER_PROFILE_REVISION_VERSION,
  CharacterProfileRevisionError,
  assertCharacterProfileBindMessagePayloadDigest,
  createCharacterProfileBindMessage,
  fingerprintCharacterProfileBindPayload,
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  projectCharacterProfileBindToPortableRuntime,
  requiredCharacterProfileClips,
  serializeCharacterProfileRevisionCanonical,
  type CharacterProfileRevision,
} from './character-profile-revision';
import {
  PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
  type PortableWorldRuntimeContract,
} from './portable-world-runtime-contract';

const ATLAS_HASH = 'a'.repeat(64);
const IDENTITY_HASH = 'b'.repeat(64);
const PACK_HASH = 'c'.repeat(64);

const PROFILE_GRID: Readonly<Record<WorldAssetProfile, Readonly<{
  columns: number;
  rows: number;
}>>> = Object.freeze({
  'side-platformer': { columns: 2, rows: 6 },
  'topdown-farm': { columns: 4, rows: 2 },
  'isometric-action': { columns: 8, rows: 6 },
  'layered-depth-2d': { columns: 4, rows: 4 },
});

function revision(profile: WorldAssetProfile = 'side-platformer'): CharacterProfileRevision {
  const geometry = PROFILE_GRID[profile];
  return {
    schema_version: CHARACTER_PROFILE_REVISION_VERSION,
    document_type: 'character-profile-revision',
    profile_revision_id: `synthetic-traveler-${profile}-revision-one`,
    character_id: 'synthetic-traveler',
    profile,
    atlas: {
      path: `characters/${profile}/synthetic-traveler.png`,
      media_type: 'image/png',
      bytes: 4096,
      sha256: ATLAS_HASH,
      width: geometry.columns * 32,
      height: geometry.rows * 32,
    },
    frame_geometry: {
      frame_width: 32,
      frame_height: 32,
      columns: geometry.columns,
      rows: geometry.rows,
    },
    pivot: { x: 16, y: 30, unit: 'pixels' },
    clips: requiredCharacterProfileClips(profile).map((clipId, index) => {
      const [action, direction] = clipId.split('.') as [CharacterAction, CharacterDirection];
      return {
        clip_id: clipId,
        action,
        direction,
        fps: 8,
        loop: action === 'idle' || action === 'walk' || action === 'move' || action === 'run',
        frames: [{
          column: index % geometry.columns,
          row: Math.floor(index / geometry.columns),
        }],
      };
    }),
    source_identity: {
      identity_digest_sha256: IDENTITY_HASH,
      source_reference_ids: ['synthetic-reference-one'],
    },
    rights: {
      distribution: 'public',
      license: 'CC0-1.0',
    },
  };
}

function runtimeContract(profile: WorldAssetProfile = 'side-platformer'): PortableWorldRuntimeContract {
  return {
    schema_version: PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
    contract_id: `synthetic-${profile}-runtime`,
    world: {
      world_id: `synthetic-${profile}-world`,
      pack_id: `synthetic-${profile}-pack`,
      pack_version: '1.0.0-alpha.1',
      pack_sha256: PACK_HASH,
      profile,
      entry_scene: 'world/main.tscn',
      viewport: { width: 640, height: 360 },
    },
    spawn_points: [{ spawn_id: 'world-entry', x: 96, y: 128 }],
    entity_slots: [{
      slot_id: 'player-one',
      kind: 'player',
      required: true,
      spawn_id: 'world-entry',
      accepted_asset_kinds: ['character-atlas', 'animation-set'],
    }],
    event_hooks: [],
  };
}

describe('CharacterProfileRevision 1.0', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('accepts a complete, independent %s player revision', (profile) => {
    const value = revision(profile);
    const result = materializeCharacterProfileRevision(value);
    expect(result).toEqual(value);
    expect(result.clips).toHaveLength(PROFILE_GRID[profile].columns * PROFILE_GRID[profile].rows);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.atlas)).toBe(true);
    expect(Object.isFrozen(result.clips)).toBe(true);
    expect(Object.isFrozen(result.clips[0].frames)).toBe(true);
  });

  it('has a strict public JSON Schema for the revision', () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(characterProfileSchema);
    expect(validate(revision()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('fails closed when a canonical action-direction clip is missing or reordered', () => {
    const value = revision('isometric-action');
    expect(() => materializeCharacterProfileRevision({
      ...value,
      clips: value.clips.slice(0, -1),
    })).toThrowError(expect.objectContaining({ code: 'character-profile.incomplete-clips' }));
    expect(() => materializeCharacterProfileRevision({
      ...value,
      clips: [value.clips[1], value.clips[0], ...value.clips.slice(2)],
    })).toThrowError(expect.objectContaining({ code: 'character-profile.incomplete-clips' }));
  });

  it('rejects unsafe atlas paths, local source paths and private extension fields', () => {
    const value = revision();
    expect(() => materializeCharacterProfileRevision({
      ...value,
      atlas: { ...value.atlas, path: 'C:/private/character.png' },
    })).toThrowError(expect.objectContaining({ code: 'character-profile.invalid-value' }));
    expect(() => materializeCharacterProfileRevision({
      ...value,
      source_identity: {
        ...value.source_identity,
        source_reference_ids: ['private/source/image.png'],
      },
    })).toThrowError(expect.objectContaining({ code: 'character-profile.invalid-value' }));
    expect(() => materializeCharacterProfileRevision({
      ...value,
      private_character_record: 'not-portable',
    })).toThrowError(CharacterProfileRevisionError);
  });

  it('binds atlas dimensions, frame geometry, pivot and frame bounds', () => {
    const value = revision();
    expect(() => materializeCharacterProfileRevision({
      ...value,
      atlas: { ...value.atlas, width: value.atlas.width + 1 },
    })).toThrowError(expect.objectContaining({ code: 'character-profile.invalid-value' }));
    expect(() => materializeCharacterProfileRevision({
      ...value,
      pivot: { ...value.pivot, y: value.frame_geometry.frame_height },
    })).toThrowError(expect.objectContaining({ code: 'character-profile.invalid-value' }));
    expect(() => materializeCharacterProfileRevision({
      ...value,
      clips: value.clips.map((clip, index) => index === 0 ? {
        ...clip,
        frames: [{ column: value.frame_geometry.columns, row: 0 }],
      } : clip),
    })).toThrowError(expect.objectContaining({ code: 'character-profile.invalid-value' }));
  });

  it('allows private and internal-review proprietary output but rejects public proprietary output', () => {
    const privateRevision = {
      ...revision(),
      rights: {
        distribution: 'private',
        license: 'LicenseRef-Proprietary',
      },
    };
    expect(materializeCharacterProfileRevision(privateRevision).rights).toEqual(privateRevision.rights);
    const reviewRevision = {
      ...revision(),
      rights: {
        distribution: 'internal-review',
        license: 'LicenseRef-Proprietary',
      },
    };
    expect(materializeCharacterProfileRevision(reviewRevision).rights).toEqual(reviewRevision.rights);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(characterProfileSchema);
    expect(validate(reviewRevision), JSON.stringify(validate.errors)).toBe(true);
    const publicProprietary = {
      ...revision(),
      rights: {
        distribution: 'public',
        license: 'LicenseRef-Proprietary',
      },
    };
    expect(() => materializeCharacterProfileRevision(publicProprietary))
      .toThrowError(expect.objectContaining({ code: 'character-profile.invalid-rights' }));
    expect(validate(publicProprietary)).toBe(false);
  });

  it('keeps only an identity digest and opaque source reference ids', () => {
    const json = JSON.stringify(materializeCharacterProfileRevision(revision()));
    expect(json).toContain(IDENTITY_HASH);
    expect(json).toContain('synthetic-reference-one');
    expect(json).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(json).not.toContain('source_path');
    expect(json).not.toContain('reference_path');
  });

  it('serializes canonical bytes whose raw digest is the revision fingerprint', async () => {
    const value = revision();
    const bytes = serializeCharacterProfileRevisionCanonical(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const text = new TextDecoder().decode(bytes);
    expect(JSON.parse(text)).toEqual(materializeCharacterProfileRevision(value));
    expect(text.startsWith('{"atlas":')).toBe(true);
    expect(text).not.toContain('\n');
    expect(hex).toBe(await fingerprintCharacterProfileRevision(value));
  });

  it('binds an explicit operator-declared horizontal transform without changing legacy canonical bytes', async () => {
    const legacy = revision();
    const legacyBytes = serializeCharacterProfileRevisionCanonical(legacy);
    expect(new TextDecoder().decode(legacyBytes))
      .not.toContain('runtime_direction_transform');
    expect(await fingerprintCharacterProfileRevision(legacy))
      .toBe('f3da79c8f13847ac70492a0b44b3741aab5debf6a218c676d89a242550b0caeb');
    const transformed = {
      ...legacy,
      runtime_direction_transform: {
        strategy: 'horizontal-flip',
        directions: ['left'],
        provenance: {
          basis: 'operator-declared-direction-equivalence',
          source_reference_ids: ['synthetic-reference-one'],
        },
      },
    } as const;
    const materialized = materializeCharacterProfileRevision(transformed);
    expect(materialized.runtime_direction_transform).toEqual(
      transformed.runtime_direction_transform,
    );
    expect(await fingerprintCharacterProfileRevision(materialized))
      .not.toBe(await fingerprintCharacterProfileRevision(legacy));
    const validate = new Ajv2020({ strict: true, allErrors: true })
      .compile(characterProfileSchema);
    expect(validate(materialized), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects inferred, unsupported or unbound direction transforms', () => {
    const value = revision();
    expect(() => materializeCharacterProfileRevision({
      ...value,
      runtime_direction_transform: {
        strategy: 'horizontal-flip',
        directions: ['left'],
        provenance: {
          basis: 'operator-declared-direction-equivalence',
          source_reference_ids: ['not-bound-to-source-identity'],
        },
      },
    })).toThrowError(expect.objectContaining({
      code: 'character-profile.invalid-reference',
    }));
    expect(() => materializeCharacterProfileRevision({
      ...revision('topdown-farm'),
      runtime_direction_transform: {
        strategy: 'horizontal-flip',
        directions: ['left'],
        provenance: {
          basis: 'human-reviewed-direction-equivalence',
          source_reference_ids: ['synthetic-reference-one'],
        },
      },
    })).toThrowError(expect.objectContaining({
      code: 'character-profile.invalid-value',
    }));
    expect(() => materializeCharacterProfileRevision({
      ...value,
      runtime_direction_transform: {
        strategy: 'horizontal-flip',
        directions: ['left', 'right'],
        provenance: {
          basis: 'operator-declared-direction-equivalence',
          source_reference_ids: ['synthetic-reference-one'],
        },
      },
    })).toThrowError(expect.objectContaining({
      code: 'character-profile.invalid-value',
    }));
    expect(() => materializeCharacterProfileRevision({
      ...value,
      runtime_direction_transform: {
        strategy: 'horizontal-flip',
        directions: ['left'],
        provenance: {
          basis: 'model-inferred',
          source_reference_ids: ['synthetic-reference-one'],
        },
      },
    })).toThrowError(expect.objectContaining({
      code: 'character-profile.invalid-value',
    }));
  });
});

describe('CharacterProfileRevision neutral bind', () => {
  it('creates a canonical idempotent bind and projects it to runtime.bind', async () => {
    const characterRevision = revision();
    const contract = runtimeContract();
    const message = await createCharacterProfileBindMessage(
      'synthetic:character-bind:0001',
      {
        contract_id: contract.contract_id,
        session_id: 'session-alpha-one',
        slot_id: 'player-one',
        entity_id: 'traveler-one',
      },
      characterRevision,
      contract,
    );
    expect(message.payload.profile_revision_sha256)
      .toBe(await fingerprintCharacterProfileRevision(characterRevision));
    expect(message.payload_sha256)
      .toBe(await fingerprintCharacterProfileBindPayload(message.payload));
    expect(await projectCharacterProfileBindToPortableRuntime(
      message,
      characterRevision,
      contract,
    )).toEqual({
      contract_id: contract.contract_id,
      session_id: 'session-alpha-one',
      bindings: [{
        slot_id: 'player-one',
        entity_id: 'traveler-one',
        asset_path: characterRevision.atlas.path,
        asset_sha256: characterRevision.atlas.sha256,
      }],
    });
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(characterProfileSchema);
    expect(validate(message), JSON.stringify(validate.errors)).toBe(true);
  });

  it('detects canonical payload mutation and revision substitution', async () => {
    const characterRevision = revision();
    const contract = runtimeContract();
    const message = await createCharacterProfileBindMessage(
      'synthetic:character-bind:0002',
      {
        contract_id: contract.contract_id,
        session_id: 'session-alpha-one',
        slot_id: 'player-one',
        entity_id: 'traveler-one',
      },
      characterRevision,
      contract,
    );
    await expect(assertCharacterProfileBindMessagePayloadDigest({
      ...message,
      payload: { ...message.payload, entity_id: 'traveler-two' },
    }, characterRevision, contract)).rejects.toMatchObject({
      code: 'character-profile.payload-digest-mismatch',
    });
    await expect(assertCharacterProfileBindMessagePayloadDigest(
      message,
      { ...characterRevision, source_identity: {
        ...characterRevision.source_identity,
        identity_digest_sha256: 'd'.repeat(64),
      } },
      contract,
    )).rejects.toMatchObject({
      code: 'character-profile.revision-digest-mismatch',
    });
  });

  it('rejects mismatched profiles and non-character runtime slots', async () => {
    const characterRevision = revision();
    const contract = runtimeContract();
    const message = await createCharacterProfileBindMessage(
      'synthetic:character-bind:0003',
      {
        contract_id: contract.contract_id,
        session_id: 'session-alpha-one',
        slot_id: 'player-one',
        entity_id: 'traveler-one',
      },
      characterRevision,
      contract,
    );
    await expect(assertCharacterProfileBindMessagePayloadDigest(
      message,
      revision('topdown-farm'),
      contract,
    )).rejects.toMatchObject({ code: 'character-profile.invalid-reference' });
    const propContract: PortableWorldRuntimeContract = {
      ...contract,
      entity_slots: [{
        ...contract.entity_slots[0],
        kind: 'prop',
        accepted_asset_kinds: ['character-atlas'],
      }],
    };
    await expect(assertCharacterProfileBindMessagePayloadDigest(
      message,
      characterRevision,
      propContract,
    )).rejects.toMatchObject({ code: 'character-profile.invalid-reference' });
  });
});
