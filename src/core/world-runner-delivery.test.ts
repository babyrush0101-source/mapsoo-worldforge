import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import deliverySchema from '../../schemas/mapsoo-world-runner-delivery-1.0.schema.json';
import {
  CHARACTER_PROFILE_REVISION_VERSION,
  requiredCharacterProfileClips,
  type CharacterProfileRevision,
} from './character-profile-revision';
import type { CharacterAction, CharacterDirection } from './generated-asset-bundle';
import {
  PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
  type PortableWorldRuntimeContract,
} from './portable-world-runtime-contract';
import {
  WorldRunnerDeliveryError,
  createWorldRunnerDelivery,
  materializeWorldRunnerDelivery,
} from './world-runner-delivery';
import { createWorldRunnerLaunchEnvelope } from './world-runner-launch-envelope';

const PACK_HASH = 'a'.repeat(64);
const PCK_HASH = 'b'.repeat(64);
const ATLAS_HASH = 'c'.repeat(64);
const IDENTITY_HASH = 'd'.repeat(64);
const INTAKE_HASH = 'e'.repeat(64);
const REPORT_HASH = 'f'.repeat(64);

function runtimeContract(): PortableWorldRuntimeContract {
  return {
    schema_version: PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
    contract_id: 'riverside-world-runtime',
    world: {
      world_id: 'riverside-world',
      pack_id: 'riverside-world-pack',
      pack_version: '1.0.0-alpha.1',
      pack_sha256: PACK_HASH,
      profile: 'topdown-farm',
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
    event_hooks: [
      { hook_id: 'on-runtime-ready', event: 'runtime.ready', required: true },
      { hook_id: 'on-world-entered', event: 'world.entered', required: true },
      { hook_id: 'on-world-exited', event: 'world.exited', required: true },
    ],
  };
}

function characterRevision(): CharacterProfileRevision {
  return {
    schema_version: CHARACTER_PROFILE_REVISION_VERSION,
    document_type: 'character-profile-revision',
    profile_revision_id: 'traveler-topdown-revision-one',
    character_id: 'traveler-one',
    profile: 'topdown-farm',
    atlas: {
      path: 'characters/topdown-farm/traveler-one.png',
      media_type: 'image/png',
      bytes: 8192,
      sha256: ATLAS_HASH,
      width: 128,
      height: 64,
    },
    frame_geometry: {
      frame_width: 32,
      frame_height: 32,
      columns: 4,
      rows: 2,
    },
    pivot: { x: 16, y: 30, unit: 'pixels' },
    clips: requiredCharacterProfileClips('topdown-farm').map((clipId, index) => {
      const [action, direction] = clipId.split('.') as [CharacterAction, CharacterDirection];
      return {
        clip_id: clipId,
        action,
        direction,
        fps: 8,
        loop: true,
        frames: [{ column: index % 4, row: Math.floor(index / 4) }],
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

async function delivery() {
  return createWorldRunnerDelivery({
    delivery_id: 'riverside-pi-delivery-one',
    intake_sha256: INTAKE_HASH,
    target: 'raspberry-pi-4b',
    world_pack: {
      path: 'packs/riverside-world.zip',
      bytes: 1_024_000,
      sha256: PACK_HASH,
    },
    runtime_artifact: {
      kind: 'godot-pck',
      architecture: 'arm64',
      path: 'runtime/riverside-world.pck',
      bytes: 2_048_000,
      sha256: PCK_HASH,
    },
    runtime_contract: runtimeContract(),
    character_profile_revision: {
      path: 'characters/traveler-topdown-revision-one.json',
      revision: characterRevision(),
    },
    launch: {
      spawn_id: 'world-entry',
      player_slot_id: 'player-one',
    },
    verification: {
      godot_version: '4.3.0',
      headless_smoke_passed: true,
      report_path: 'evidence/riverside-headless-smoke.json',
      report_sha256: REPORT_HASH,
    },
  });
}

describe('World Runner delivery 1.0', () => {
  it('creates a strict Pi delivery that binds pack, PCK, runtime, player and smoke evidence', async () => {
    const value = await delivery();
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(deliverySchema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(value.runtime_artifact.kind).toBe('godot-pck');
    expect(value.runtime_contract.world.pack_sha256).toBe(value.world_pack.sha256);
    expect(value.character_profile_revision.identity_digest_sha256).toBe(IDENTITY_HASH);
    await expect(materializeWorldRunnerDelivery(value, characterRevision())).resolves.toEqual(value);
  });

  it('requires a prebuilt PCK for the Raspberry Pi 4B fast path', async () => {
    const value = await delivery();
    await expect(materializeWorldRunnerDelivery({
      ...value,
      runtime_artifact: {
        ...value.runtime_artifact,
        kind: 'godot-project-zip',
      },
    }, characterRevision())).rejects.toMatchObject({ code: 'delivery.target-mismatch' });
    await expect(materializeWorldRunnerDelivery({
      ...value,
      runtime_artifact: {
        ...value.runtime_artifact,
        architecture: 'x86_64',
      },
    }, characterRevision())).rejects.toMatchObject({ code: 'delivery.target-mismatch' });
  });

  it('rejects mismatched world pack, character identity and unknown player slot', async () => {
    const value = await delivery();
    await expect(materializeWorldRunnerDelivery({
      ...value,
      world_pack: { ...value.world_pack, sha256: '1'.repeat(64) },
    }, characterRevision())).rejects.toMatchObject({ code: 'delivery.invalid-reference' });
    await expect(materializeWorldRunnerDelivery({
      ...value,
      character_profile_revision: {
        ...value.character_profile_revision,
        identity_digest_sha256: '2'.repeat(64),
      },
    }, characterRevision())).rejects.toMatchObject({ code: 'delivery.character-mismatch' });
    await expect(materializeWorldRunnerDelivery({
      ...value,
      launch: { ...value.launch, player_slot_id: 'missing-player' },
    }, characterRevision())).rejects.toMatchObject({ code: 'delivery.invalid-reference' });
  });

  it('rejects local absolute paths and consumer-specific extension fields', async () => {
    const value = await delivery();
    await expect(materializeWorldRunnerDelivery({
      ...value,
      runtime_artifact: { ...value.runtime_artifact, path: 'C:/private/world.pck' },
    })).rejects.toMatchObject({ code: 'delivery.invalid-value' });
    await expect(materializeWorldRunnerDelivery({
      ...value,
      daemon_record: 'not-portable',
    })).rejects.toBeInstanceOf(WorldRunnerDeliveryError);
  });

  it('creates the complete neutral prepare, character bind, runtime bind and launch envelope', async () => {
    const value = await delivery();
    const envelope = await createWorldRunnerLaunchEnvelope({
      delivery: value,
      character_revision: characterRevision(),
      session_id: 'riverside-session-one',
      entity_id: 'traveler-one',
      idempotency_prefix: 'riverside:delivery:0001',
    });
    expect(envelope.prepare.message_type).toBe('runtime.prepare');
    expect(envelope.character_bind.message_type).toBe('character-profile.bind');
    expect(envelope.bind.message_type).toBe('runtime.bind');
    expect(envelope.bind.payload.bindings).toEqual([{
      slot_id: 'player-one',
      entity_id: 'traveler-one',
      asset_path: 'characters/topdown-farm/traveler-one.png',
      asset_sha256: ATLAS_HASH,
    }]);
    expect(envelope.launch.payload).toEqual({
      contract_id: 'riverside-world-runtime',
      session_id: 'riverside-session-one',
      spawn_id: 'world-entry',
    });
  });
});
