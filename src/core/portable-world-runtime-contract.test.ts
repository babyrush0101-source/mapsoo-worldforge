import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import runtimeSchema from '../../schemas/mapsoo-portable-world-runtime-1.0.schema.json';
import {
  PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
  PortableRuntimeContractError,
  assertPortableRuntimeMessagePayloadDigest,
  createPortableRuntimeMessage,
  fingerprintPortableRuntimePayload,
  materializePortableRuntimeMessage,
  materializePortableWorldRuntimeContract,
  type PortableWorldRuntimeContract,
} from './portable-world-runtime-contract';

const HASH = 'a'.repeat(64);

function contract(): PortableWorldRuntimeContract {
  return {
    schema_version: PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
    contract_id: 'synthetic-meadow-runtime',
    world: {
      world_id: 'synthetic-meadow',
      pack_id: 'synthetic-meadow-pack',
      pack_version: '1.0.0-alpha.1',
      pack_sha256: HASH,
      profile: 'topdown-farm',
      entry_scene: 'world/main.tscn',
      viewport: { width: 640, height: 360 },
    },
    spawn_points: [
      { spawn_id: 'world-entry', x: 96, y: 128 },
      { spawn_id: 'village-entry', x: 320, y: 192 },
    ],
    entity_slots: [
      {
        slot_id: 'player-one',
        kind: 'player',
        required: true,
        spawn_id: 'world-entry',
        accepted_asset_kinds: ['character-atlas', 'animation-set', 'collision-profile'],
      },
      {
        slot_id: 'guide-one',
        kind: 'npc',
        required: false,
        spawn_id: 'village-entry',
        accepted_asset_kinds: ['character-atlas', 'interaction-profile'],
      },
    ],
    event_hooks: [
      { hook_id: 'on-world-ready', event: 'runtime.ready', required: true },
      {
        hook_id: 'on-player-interaction',
        event: 'interaction.requested',
        required: false,
        source_slot_id: 'player-one',
      },
    ],
  };
}

describe('PortableWorldRuntimeContract 1.0', () => {
  it('has a strict JSON Schema that accepts the synthetic contract', () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(runtimeSchema);
    expect(validate(contract()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('materializes a neutral synthetic world with entity slots and event hooks', () => {
    const result = materializePortableWorldRuntimeContract(contract());
    expect(result).toEqual(contract());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entity_slots[0].accepted_asset_kinds)).toBe(true);
  });

  it('fails closed on private extension fields and broken cross references', () => {
    expect(() => materializePortableWorldRuntimeContract({
      ...contract(),
      vendor_extension: 'not-portable',
    })).toThrowError(PortableRuntimeContractError);
    expect(() => materializePortableWorldRuntimeContract({
      ...contract(),
      entity_slots: [{ ...contract().entity_slots[0], spawn_id: 'missing-spawn' }],
    })).toThrowError(expect.objectContaining({ code: 'runtime.invalid-reference' }));
    expect(() => materializePortableWorldRuntimeContract({
      ...contract(),
      event_hooks: [{
        ...contract().event_hooks[1],
        source_slot_id: 'missing-slot',
      }],
    })).toThrowError(expect.objectContaining({ code: 'runtime.invalid-reference' }));
  });

  it('rejects absolute paths, duplicate ids and unsupported events', () => {
    expect(() => materializePortableWorldRuntimeContract({
      ...contract(),
      world: { ...contract().world, entry_scene: 'C:/private/main.tscn' },
    })).toThrowError(expect.objectContaining({ code: 'runtime.invalid-value' }));
    expect(() => materializePortableWorldRuntimeContract({
      ...contract(),
      spawn_points: [contract().spawn_points[0], contract().spawn_points[0]],
    })).toThrowError(expect.objectContaining({ code: 'runtime.invalid-value' }));
    expect(() => materializePortableWorldRuntimeContract({
      ...contract(),
      event_hooks: [{ hook_id: 'custom', event: 'vendor.private', required: false }],
    })).toThrowError(expect.objectContaining({ code: 'runtime.invalid-value' }));
  });
});

describe('portable runtime bridge messages', () => {
  it.each([
    ['runtime.prepare', {
      runtime_contract: contract(),
    }],
    ['runtime.bind', {
      contract_id: contract().contract_id,
      session_id: 'session-alpha-one',
      bindings: [{
        slot_id: 'player-one',
        entity_id: 'traveler-one',
        asset_path: 'characters/traveler-one.png',
        asset_sha256: 'b'.repeat(64),
      }],
    }],
    ['runtime.launch', {
      contract_id: contract().contract_id,
      session_id: 'session-alpha-one',
      spawn_id: 'world-entry',
    }],
    ['runtime.exit', {
      contract_id: contract().contract_id,
      session_id: 'session-alpha-one',
      reason: 'user-request',
    }],
    ['runtime.status', {
      contract_id: contract().contract_id,
      session_id: 'session-alpha-one',
      state: 'running',
      sequence: 3,
      detail_code: 'world.entered',
    }],
  ] as const)('creates and verifies a canonical %s message', async (messageType, payload) => {
    const message = await createPortableRuntimeMessage(
      messageType,
      `synthetic:${messageType}:0001`,
      payload,
      messageType === 'runtime.prepare' ? undefined : contract(),
    );
    expect(message.payload_sha256).toBe(await fingerprintPortableRuntimePayload(message.payload));
    await expect(assertPortableRuntimeMessagePayloadDigest(
      message,
      messageType === 'runtime.prepare' ? undefined : contract(),
    )).resolves.toEqual(message);
  });

  it('detects payload mutation after an idempotent message is signed', async () => {
    const message = await createPortableRuntimeMessage(
      'runtime.launch',
      'synthetic:launch:0001',
      {
        contract_id: contract().contract_id,
        session_id: 'session-alpha-one',
        spawn_id: 'world-entry',
      },
      contract(),
    );
    await expect(assertPortableRuntimeMessagePayloadDigest({
      ...message,
      payload: { ...message.payload, spawn_id: 'village-entry' },
    }, contract())).rejects.toMatchObject({ code: 'runtime.payload-digest-mismatch' });
  });

  it('validates every bridge message shape with the public JSON Schema', async () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(runtimeSchema);
    const message = await createPortableRuntimeMessage(
      'runtime.bind',
      'synthetic:bind:0002',
      {
        contract_id: contract().contract_id,
        session_id: 'session-alpha-one',
        bindings: [{
          slot_id: 'player-one',
          entity_id: 'traveler-one',
          asset_path: 'characters/traveler-one.png',
          asset_sha256: 'b'.repeat(64),
        }],
      },
      contract(),
    );
    expect(validate(message), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects unknown slots, spawns, contracts and malformed idempotency keys', async () => {
    const bindPayload = {
      contract_id: contract().contract_id,
      session_id: 'session-alpha-one',
      bindings: [{
        slot_id: 'missing-slot',
        entity_id: 'traveler-one',
        asset_path: 'characters/traveler-one.png',
        asset_sha256: 'b'.repeat(64),
      }],
    };
    expect(() => materializePortableRuntimeMessage({
      schema_version: '1.0.0',
      message_type: 'runtime.bind',
      idempotency_key: 'synthetic:bind:0001',
      payload_sha256: HASH,
      payload: bindPayload,
    }, contract())).toThrowError(expect.objectContaining({ code: 'runtime.invalid-reference' }));
    expect(() => materializePortableRuntimeMessage({
      schema_version: '1.0.0',
      message_type: 'runtime.launch',
      idempotency_key: 'short',
      payload_sha256: HASH,
      payload: {
        contract_id: 'other-contract',
        session_id: 'session-alpha-one',
        spawn_id: 'missing-spawn',
      },
    }, contract())).toThrowError(expect.objectContaining({ code: 'runtime.invalid-value' }));
  });
});
