import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import schema from '../../schemas/mapsoo-world-art-runtime-projection-1.0.schema.json';
import {
  buildWorldArtRuntimeProjection,
  fingerprintWorldArtRuntimeProjection,
  materializeWorldArtRuntimeProjection,
  serializeCanonicalWorldArtRuntimeProjection,
} from './world-art-runtime-projection';

async function document() {
  return buildWorldArtRuntimeProjection({
    schema_version: '1.0.0',
    document_type: 'world-art-runtime-projection',
    profile: 'topdown-farm',
    source: {
      variant_map_id: `world-art-variant-map-${'b'.repeat(16)}`,
      variant_map_sha256: '1'.repeat(64),
      layout_plan_sha256: '2'.repeat(64),
      production_art_plan_id: 'production-art-plan-topdown-farm-1234',
      production_art_plan_sha256: '3'.repeat(64),
      requirements_sha256: '4'.repeat(64),
      run_set_sha256: '5'.repeat(64),
      reviewed_slot_inventory_sha256: '6'.repeat(64),
      review_record_sha256: '7'.repeat(64),
    },
    rights: {
      distribution: 'public',
      license: 'CC0-1.0',
    },
    images: [{
      task_id: 'character-sheet-001',
      path: 'production-art/topdown-farm/character-sheet-001.png',
      media_type: 'image/png',
      bytes: 4096,
      sha256: '8'.repeat(64),
      output_sha256: '9'.repeat(64),
      width: 256,
      height: 128,
      cell_size: [64, 64],
      pivot: [32, 60],
      alpha_policy: 'straight-alpha',
    }],
    assets: [{
      task_id: 'character-sheet-001',
      slot_id: 'requirement-character-player-canonical',
      requirement_id: 'requirement-character-player',
      role: 'character.player.atlas',
      variant_id: 'canonical',
      image_path: 'production-art/topdown-farm/character-sheet-001.png',
      region: { x: 0, y: 0, width: 64, height: 64 },
      cell_sha256: 'a'.repeat(64),
      poses: [{
        action: 'idle',
        direction: 'south',
        frame_index: 0,
        duration_ms: 125,
        region: { x: 0, y: 0, width: 64, height: 64 },
      }],
    }],
    bindings: [{
      usage_kind: 'character',
      usage_id: 'requirement-character-player',
      task_id: 'character-sheet-001',
      slot_id: 'requirement-character-player-canonical',
      role: 'character.player.atlas',
      variant_id: 'canonical',
      image_path: 'production-art/topdown-farm/character-sheet-001.png',
      region: { x: 0, y: 0, width: 64, height: 64 },
      cell_sha256: 'a'.repeat(64),
      poses: [{
        action: 'idle',
        direction: 'south',
        frame_index: 0,
        duration_ms: 125,
        region: { x: 0, y: 0, width: 64, height: 64 },
      }],
    }],
  });
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('WorldArtRuntimeProjection 1.0', () => {
  it('strictly materializes a schema-valid canonical projection', async () => {
    const raw = await document();
    const projection = await materializeWorldArtRuntimeProjection(raw);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

    expect(validate(projection), JSON.stringify(validate.errors)).toBe(true);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.images)).toBe(true);
    expect(Object.isFrozen(projection.assets)).toBe(true);
    expect(await fingerprintWorldArtRuntimeProjection(projection))
      .toBe(await fingerprintWorldArtRuntimeProjection(raw));
    expect(await serializeCanonicalWorldArtRuntimeProjection(projection))
      .toEqual(await serializeCanonicalWorldArtRuntimeProjection(raw));
  });

  it('rejects extra fields, unsafe paths, out-of-bounds regions, and noncanonical order', async () => {
    const extra = mutable(await document());
    extra.provider_request_id = 'remote-123';
    await expect(materializeWorldArtRuntimeProjection(extra))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-shape' });

    const unsafe = mutable(await document());
    unsafe.images[0].path = '../private.png';
    await expect(materializeWorldArtRuntimeProjection(unsafe))
      .rejects.toBeInstanceOf(Error);

    const outside = mutable(await document());
    outside.bindings[0].region.x = 256;
    await expect(materializeWorldArtRuntimeProjection(outside))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-binding' });

    const unordered = mutable(await document());
    unordered.images.push({
      ...unordered.images[0],
      task_id: 'aaa-task',
      path: 'production-art/topdown-farm/aaa-task.png',
    });
    await expect(materializeWorldArtRuntimeProjection(unordered))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-order' });
  });

  it('requires poses only for character bindings', async () => {
    const missing = mutable(await document());
    missing.bindings[0].poses = [];
    await expect(materializeWorldArtRuntimeProjection(missing))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-binding' });

    const unexpected = mutable(await document());
    unexpected.bindings[0].usage_kind = 'landmark';
    await expect(materializeWorldArtRuntimeProjection(unexpected))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-binding' });
  });

  it('rejects missing, tampered, duplicated, and noncanonical catalog assets', async () => {
    const missing = mutable(await document());
    missing.assets = [];
    await expect(materializeWorldArtRuntimeProjection(missing))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-value' });

    const tampered = mutable(await document());
    tampered.assets[0].cell_sha256 = 'b'.repeat(64);
    await expect(materializeWorldArtRuntimeProjection(tampered))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-binding' });

    const duplicated = mutable(await document());
    duplicated.assets.push({ ...duplicated.assets[0] });
    await expect(materializeWorldArtRuntimeProjection(duplicated))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-order' });

    const unordered = mutable(await document());
    unordered.images.push({
      ...unordered.images[0],
      task_id: 'z-task',
      path: 'production-art/topdown-farm/z-task.png',
    });
    unordered.assets.push({
      ...unordered.assets[0],
      task_id: 'z-task',
      slot_id: 'z-slot',
      image_path: 'production-art/topdown-farm/z-task.png',
    });
    unordered.assets.reverse();
    await expect(materializeWorldArtRuntimeProjection(unordered))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-order' });
  });

  it('requires every usage binding to exactly match its catalog asset', async () => {
    const changed = mutable(await document());
    changed.bindings[0].variant_id = 'alternate';

    await expect(materializeWorldArtRuntimeProjection(changed))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-binding' });
  });

  it('rejects an identity copied from a different runtime payload', async () => {
    const changed = mutable(await document());
    changed.source.run_set_sha256 = 'f'.repeat(64);

    await expect(materializeWorldArtRuntimeProjection(changed))
      .rejects.toMatchObject({ code: 'world-art-runtime-projection.invalid-value' });
  });
});
