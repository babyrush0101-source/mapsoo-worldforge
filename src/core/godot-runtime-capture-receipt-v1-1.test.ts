import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import receiptSchema from '../../schemas/mapsoo-godot-runtime-capture-receipt-1.1.schema.json';
import { WORLD_ASSET_PROFILES, type WorldAssetProfile } from './asset-profile';
import {
  GODOT_RUNTIME_CAPTURE_V1_1_EVIDENCE,
  buildGodotRuntimeCaptureReceiptV1_1,
  fingerprintGodotRuntimeBindingKeysV1_1,
  fingerprintGodotRuntimeCaptureReceiptV1_1,
  materializeGodotRuntimeCaptureReceiptV1_1,
  serializeCanonicalGodotRuntimeCaptureReceiptV1_1,
  type BuildGodotRuntimeCaptureReceiptV1_1Input,
  type GodotRuntimeCaptureReceiptV1_1,
  type GodotRuntimeCaptureV1_1BindingKey,
} from './godot-runtime-capture-receipt-v1-1';

const validateSchema = new Ajv2020({ strict: true }).compile(receiptSchema);

function digest(character: string): string {
  return character.repeat(64);
}

const BINDING_KEYS = Object.freeze([
  { usage_kind: 'terrain-material', usage_id: 'ground' },
  { usage_kind: 'terrain-material', usage_id: 'water' },
  { usage_kind: 'landmark', usage_id: 'harbor-gate' },
  { usage_kind: 'character', usage_id: 'player' },
  { usage_kind: 'background', usage_id: 'sky' },
  { usage_kind: 'prop', usage_id: 'lamp-west' },
  { usage_kind: 'prop', usage_id: 'lamp-east' },
  { usage_kind: 'prop', usage_id: 'lamp-harbor' },
  { usage_kind: 'structure', usage_id: 'harbor-house' },
  { usage_kind: 'effect', usage_id: 'harbor-mist' },
  { usage_kind: 'depth', usage_id: 'foreground-reeds' },
] satisfies readonly GodotRuntimeCaptureV1_1BindingKey[]);

async function input(
  profile: WorldAssetProfile = 'side-platformer',
): Promise<BuildGodotRuntimeCaptureReceiptV1_1Input> {
  return {
    profile,
    source: {
      candidate_id: 'world-art-candidate-0123456789abcdef',
      candidate_receipt_sha256: digest('a'),
      layout_plan_sha256: digest('b'),
      runtime_overlay_id: 'world-art-runtime-overlay-fedcba9876543210',
      runtime_overlay_sha256: digest('c'),
      runtime_projection_id: 'world-art-runtime-projection-0011223344556677',
      runtime_projection_sha256: digest('d'),
    },
    engine: {
      godot_version: '4.3',
      executable_sha256: digest('e'),
    },
    evidence: GODOT_RUNTIME_CAPTURE_V1_1_EVIDENCE.map((item, index) => ({
      ...item,
      bytes: 1024 + index,
      sha256: String(index + 1).repeat(64),
    })),
    runtime: {
      visible_terrain_materials: 2,
      visible_landmarks: 1,
      visible_hazards: 0,
      visible_characters: 1,
      applied_background_layers: 1,
      applied_prop_instances: 3,
      applied_structure_instances: 1,
      applied_effect_bindings: 1,
      applied_depth_planes: 1,
      route_reached: true,
      catalog_assets: 12,
      bound_catalog_assets: 9,
      catalog_only_assets: 3,
      expected_bindings: BINDING_KEYS,
      applied_bindings: BINDING_KEYS,
    },
  };
}

async function receipt(
  profile: WorldAssetProfile = 'side-platformer',
): Promise<GodotRuntimeCaptureReceiptV1_1> {
  return buildGodotRuntimeCaptureReceiptV1_1(await input(profile));
}

describe('Godot runtime capture receipt 1.1', () => {
  it.each(WORLD_ASSET_PROFILES)(
    'builds, materializes, and schema-validates the %s profile',
    async (profile) => {
      const built = await receipt(profile);
      expect(validateSchema(built), JSON.stringify(validateSchema.errors))
        .toBe(true);
      expect(await materializeGodotRuntimeCaptureReceiptV1_1(built))
        .toEqual(built);
      expect(built.profile).toBe(profile);
      expect(built.schema_version).toBe('1.1.0');
      expect(built.claims).toEqual({
        runtime: 'technical-pass',
        raspberry_pi: 'pending',
        production_ready: false,
        remote_request_count: 0,
      });
    },
  );

  it('hashes the complete unique usage-kind and usage-id set canonically', async () => {
    const reordered = [...BINDING_KEYS].reverse();
    expect(await fingerprintGodotRuntimeBindingKeysV1_1(reordered))
      .toBe(await fingerprintGodotRuntimeBindingKeysV1_1(BINDING_KEYS));

    await expect(fingerprintGodotRuntimeBindingKeysV1_1([
      ...BINDING_KEYS,
      BINDING_KEYS[0]!,
    ])).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-binding',
    });
    await expect(fingerprintGodotRuntimeBindingKeysV1_1([
      { usage_kind: 'effect', usage_id: 'not safe' },
    ])).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-binding',
    });
  });

  it('allows multiple placement bindings to reuse catalog assets', async () => {
    const built = await receipt();
    expect(built.runtime.catalog_assets).toBe(12);
    expect(built.runtime.bound_catalog_assets).toBe(9);
    expect(built.runtime.runtime_bindings).toBe(11);
    expect(built.runtime.applied_runtime_bindings).toBe(11);
    expect(built.runtime.applied_prop_instances).toBe(3);
    expect(built.runtime.catalog_only_assets).toBe(3);
    expect(built.runtime.runtime_bindings)
      .toBeGreaterThan(built.runtime.bound_catalog_assets);
  });

  it('keeps catalog-only assets separate from bound and applied counts', async () => {
    const candidate = await input();
    const built = await buildGodotRuntimeCaptureReceiptV1_1({
      ...candidate,
      runtime: {
        ...candidate.runtime,
        catalog_assets: 15,
        catalog_only_assets: 6,
      },
    });
    expect(built.runtime.catalog_assets).toBe(15);
    expect(built.runtime.bound_catalog_assets).toBe(9);
    expect(built.runtime.catalog_only_assets).toBe(6);
    expect(built.runtime.runtime_bindings).toBe(11);
  });

  it('canonicalizes object keys and preserves exact capture evidence order', async () => {
    const built = await receipt();
    const reordered = {
      runtime: {
        all_required_bindings_applied: true,
        bindings_sha256: built.runtime.bindings_sha256,
        catalog_only_assets: 3,
        applied_runtime_bindings: 11,
        runtime_bindings: 11,
        bound_catalog_assets: 9,
        catalog_assets: 12,
        route_reached: true,
        applied_depth_planes: 1,
        applied_effect_bindings: 1,
        applied_structure_instances: 1,
        applied_prop_instances: 3,
        applied_background_layers: 1,
        visible_characters: 1,
        visible_hazards: 0,
        visible_landmarks: 1,
        visible_terrain_materials: 2,
      },
      claims: {
        remote_request_count: 0,
        production_ready: false,
        raspberry_pi: 'pending',
        runtime: 'technical-pass',
      },
      evidence: built.evidence.map((item) => ({
        sha256: item.sha256,
        bytes: item.bytes,
        media_type: item.media_type,
        path: item.path,
        kind: item.kind,
      })),
      engine: {
        executable_sha256: built.engine.executable_sha256,
        godot_version: built.engine.godot_version,
      },
      source: {
        runtime_projection_sha256: built.source.runtime_projection_sha256,
        runtime_projection_id: built.source.runtime_projection_id,
        runtime_overlay_sha256: built.source.runtime_overlay_sha256,
        runtime_overlay_id: built.source.runtime_overlay_id,
        layout_plan_sha256: built.source.layout_plan_sha256,
        candidate_receipt_sha256: built.source.candidate_receipt_sha256,
        candidate_id: built.source.candidate_id,
      },
      profile: built.profile,
      capture_id: built.capture_id,
      document_type: built.document_type,
      schema_version: built.schema_version,
    };
    expect(await serializeCanonicalGodotRuntimeCaptureReceiptV1_1(reordered))
      .toEqual(
        await serializeCanonicalGodotRuntimeCaptureReceiptV1_1(built),
      );
    expect(await fingerprintGodotRuntimeCaptureReceiptV1_1(reordered))
      .toBe(await fingerprintGodotRuntimeCaptureReceiptV1_1(built));
  });

  it('rejects a bound set that was not completely applied', async () => {
    const candidate = await input();
    await expect(buildGodotRuntimeCaptureReceiptV1_1({
      ...candidate,
      runtime: {
        ...candidate.runtime,
        applied_bindings: BINDING_KEYS.slice(0, -1),
      },
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-binding',
    });

    const built = await receipt();
    await expect(materializeGodotRuntimeCaptureReceiptV1_1({
      ...built,
      runtime: {
        ...built.runtime,
        all_required_bindings_applied: false,
      },
    }))
      .rejects.toMatchObject({
        code: 'godot-runtime-capture-1.1.invalid-claims',
      });
  });

  it('rejects expected/applied key mismatch, duplicates, and digest tampering', async () => {
    const candidate = await input();
    await expect(buildGodotRuntimeCaptureReceiptV1_1({
      ...candidate,
      runtime: {
        ...candidate.runtime,
        applied_bindings: BINDING_KEYS.map((binding, index) =>
          index === BINDING_KEYS.length - 1
            ? { ...binding, usage_id: 'different-depth-plane' }
            : binding),
      },
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-binding',
    });
    await expect(buildGodotRuntimeCaptureReceiptV1_1({
      ...candidate,
      runtime: {
        ...candidate.runtime,
        applied_bindings: [...BINDING_KEYS, BINDING_KEYS[0]!],
      },
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-binding',
    });

    const built = await receipt();
    await expect(materializeGodotRuntimeCaptureReceiptV1_1({
      ...built,
      runtime: {
        ...built.runtime,
        bindings_sha256: digest('f'),
      },
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-id',
    });
  });

  it('rejects catalog arithmetic and count tampering', async () => {
    const candidate = await input();
    await expect(buildGodotRuntimeCaptureReceiptV1_1({
      ...candidate,
      runtime: {
        ...candidate.runtime,
        catalog_only_assets: 4,
      },
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-binding',
    });
    await expect(buildGodotRuntimeCaptureReceiptV1_1({
      ...candidate,
      runtime: {
        ...candidate.runtime,
        bound_catalog_assets: 13,
        catalog_only_assets: 0,
      },
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-binding',
    });

    const built = await receipt();
    await expect(materializeGodotRuntimeCaptureReceiptV1_1({
      ...built,
      runtime: {
        ...built.runtime,
        applied_prop_instances: 4,
      },
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-id',
    });
  });

  it('keeps effect evidence applied-only and rejects extra fields', async () => {
    const built = await receipt('layered-depth-2d');
    const text = new TextDecoder().decode(
      await serializeCanonicalGodotRuntimeCaptureReceiptV1_1(built),
    );
    expect(text).toContain('"applied_effect_bindings"');
    expect(text).not.toContain('"visible_effects"');
    expect(text).not.toContain('"applied_bindings_sha256"');
    expect(text).not.toContain('"expected_bindings"');
    expect(text).not.toContain('"applied_bindings"');

    await expect(materializeGodotRuntimeCaptureReceiptV1_1({
      ...built,
      runtime: {
        ...built.runtime,
        visible_effects: 1,
      },
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-shape',
    });
  });

  it('rejects reordered, missing, and duplicated capture evidence', async () => {
    const built = await receipt();
    const swapped = [...built.evidence];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    await expect(materializeGodotRuntimeCaptureReceiptV1_1({
      ...built,
      evidence: swapped,
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-order',
    });
    await expect(materializeGodotRuntimeCaptureReceiptV1_1({
      ...built,
      evidence: built.evidence.slice(0, -1),
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-evidence',
    });
    await expect(materializeGodotRuntimeCaptureReceiptV1_1({
      ...built,
      evidence: built.evidence.map((item, index) =>
        index === 1 ? built.evidence[0]! : item),
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture-1.1.invalid-order',
    });
  });
});
