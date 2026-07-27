import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import receiptSchema from '../../schemas/mapsoo-world-runner-pck-build-receipt-1.0.schema.json';

const SHA = 'a'.repeat(64);

function receipt() {
  return {
    schema_version: '1.0.0',
    document_type: 'world-runner-pck-build-receipt',
    world_id: 'created-world',
    profile: 'side-platformer',
    pack_sha256: SHA,
    manifest_sha256: SHA,
    runtime_artifact: {
      kind: 'godot-pck',
      target_runtime_architecture: 'arm64',
      bytes: 380_096,
      sha256: SHA,
    },
    build_host: {
      godot_version: '4.3',
      platform: 'win32',
      architecture: 'x64',
    },
    launch_binding: {
      status: 'bound',
      spawn_id: 'world-entry',
      player_slot_id: 'player-one',
    },
    character_binding: {
      embedded: true,
      profile_revision_id: 'created-character-side-platformer',
      revision_bytes: 4_580,
      revision_sha256: SHA,
      atlas_bytes: 316_215,
      atlas_sha256: SHA,
    },
    physical_raspberry_pi_tested: false,
  };
}

describe('World Runner PCK build receipt 1.0', () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(receiptSchema);

  it('records an exact embedded character without claiming a physical Pi test', () => {
    const value = receipt();
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(value.character_binding.embedded).toBe(true);
    expect(value.physical_raspberry_pi_tested).toBe(false);
  });

  it('keeps receipts without portable launch evidence backward compatible', () => {
    const value = receipt();
    const { launch_binding: _launchBinding, ...legacyReceipt } = value;
    expect(validate(legacyReceipt), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects false claims, partial evidence and invalid portable launch IDs', () => {
    expect(validate({
      ...receipt(),
      physical_raspberry_pi_tested: true,
    })).toBe(false);
    expect(validate({
      ...receipt(),
      character_binding: {
        embedded: true,
        profile_revision_id: 'created-character-side-platformer',
        revision_sha256: SHA,
      },
    })).toBe(false);
    expect(validate({
      ...receipt(),
      launch_binding: {
        status: 'bound',
        spawn_id: 'World Entry',
        player_slot_id: 'player-one',
      },
    })).toBe(false);
    expect(validate({
      ...receipt(),
      launch_binding: {
        status: 'bound',
        spawn_id: 'world-entry',
      },
    })).toBe(false);
  });
});
