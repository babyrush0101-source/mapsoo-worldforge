import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import receiptSchema from '../../schemas/mapsoo-godot-runtime-capture-receipt-1.0.schema.json';
import { WORLD_ASSET_PROFILES, type WorldAssetProfile } from './asset-profile';
import {
  GODOT_RUNTIME_CAPTURE_EVIDENCE,
  buildGodotRuntimeCaptureReceipt,
  fingerprintGodotRuntimeCaptureReceipt,
  materializeGodotRuntimeCaptureReceipt,
  serializeCanonicalGodotRuntimeCaptureReceipt,
  type BuildGodotRuntimeCaptureReceiptInput,
  type GodotRuntimeCaptureReceipt,
} from './godot-runtime-capture-receipt';

const validateSchema = new Ajv2020({ strict: true }).compile(receiptSchema);

function digest(character: string): string {
  return character.repeat(64);
}

function input(
  profile: WorldAssetProfile = 'side-platformer',
): BuildGodotRuntimeCaptureReceiptInput {
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
    evidence: GODOT_RUNTIME_CAPTURE_EVIDENCE.map((item, index) => ({
      ...item,
      bytes: 1024 + index,
      sha256: String(index + 1).repeat(64),
    })),
    runtime: {
      visible_terrain_materials: 4,
      visible_landmarks: 2,
      visible_hazards: 0,
      visible_characters: 1,
      route_reached: true,
      catalog_assets: 9,
      runtime_bindings: 7,
      catalog_only_assets: 2,
      all_required_bindings_applied: true,
    },
  };
}

async function receipt(
  profile: WorldAssetProfile = 'side-platformer',
): Promise<GodotRuntimeCaptureReceipt> {
  return buildGodotRuntimeCaptureReceipt(input(profile));
}

describe('Godot runtime capture receipt', () => {
  it.each(WORLD_ASSET_PROFILES)(
    'builds, materializes, and schema-validates the %s profile',
    async (profile) => {
      const built = await receipt(profile);
      expect(validateSchema(built), JSON.stringify(validateSchema.errors))
        .toBe(true);
      expect(await materializeGodotRuntimeCaptureReceipt(built)).toEqual(built);
      expect(built.profile).toBe(profile);
      expect(built.evidence.map(({ kind }) => kind))
        .toEqual(GODOT_RUNTIME_CAPTURE_EVIDENCE.map(({ kind }) => kind));
      expect(built.claims).toEqual({
        runtime: 'technical-pass',
        raspberry_pi: 'pending',
        production_ready: false,
        remote_request_count: 0,
      });
    },
  );

  it('canonicalizes object keys while preserving the exact evidence order', async () => {
    const built = await receipt();
    const reordered = {
      runtime: {
        all_required_bindings_applied: true,
        catalog_only_assets: 2,
        runtime_bindings: 7,
        catalog_assets: 9,
        route_reached: true,
        visible_characters: 1,
        visible_hazards: 0,
        visible_landmarks: 2,
        visible_terrain_materials: 4,
      },
      profile: built.profile,
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
      claims: {
        remote_request_count: 0,
        production_ready: false,
        raspberry_pi: 'pending',
        runtime: 'technical-pass',
      },
      capture_id: built.capture_id,
      document_type: built.document_type,
      schema_version: built.schema_version,
    };
    expect(await serializeCanonicalGodotRuntimeCaptureReceipt(reordered))
      .toEqual(await serializeCanonicalGodotRuntimeCaptureReceipt(built));
    expect(await fingerprintGodotRuntimeCaptureReceipt(reordered))
      .toBe(await fingerprintGodotRuntimeCaptureReceipt(built));
  });

  it('rejects reordered, duplicated, missing, and noncanonical evidence', async () => {
    const built = await receipt();
    const swappedEvidence = [...built.evidence];
    [swappedEvidence[0], swappedEvidence[1]] = [
      swappedEvidence[1]!,
      swappedEvidence[0]!,
    ];
    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      evidence: swappedEvidence,
    }))
      .rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-order' });

    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      evidence: built.evidence.map((item, index) =>
        index === 1 ? built.evidence[0]! : item),
    }))
      .rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-order' });

    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      evidence: built.evidence.slice(0, -1),
    }))
      .rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-evidence' });

    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      evidence: built.evidence.map((item, index) => index === 3
        ? { ...item, media_type: 'image/png' }
        : item),
    }))
      .rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-order' });
  });

  it('rejects source, engine, result, claim, and canonical-id tampering', async () => {
    const built = await receipt();
    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      source: {
        ...built.source,
        runtime_overlay_sha256: digest('f'),
      },
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-id' });
    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      engine: {
        ...built.engine,
        godot_version: '4.4',
      },
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-binding' });
    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      runtime: {
        ...built.runtime,
        route_reached: false,
      },
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-claims' });
    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      claims: {
        ...built.claims,
        production_ready: true,
      },
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-claims' });
    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      capture_id: 'godot-runtime-capture-0000000000000000',
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-id' });
  });

  it('keeps paths, host identity, provider data, and raw output outside the contract', async () => {
    const built = await receipt('layered-depth-2d');
    const text = new TextDecoder().decode(
      await serializeCanonicalGodotRuntimeCaptureReceipt(built),
    );
    for (const forbidden of [
      'C:\\Users\\',
      '/home/',
      'hostname',
      'provider_request',
      'raw_engine_output',
      'reviewer_id',
    ]) {
      expect(text).not.toContain(forbidden);
    }

    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      local_path: 'C:\\Users\\private\\candidate',
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-shape' });
    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      engine: {
        ...built.engine,
        executable_path: 'C:\\Godot\\godot.exe',
      },
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-shape' });
    await expect(materializeGodotRuntimeCaptureReceipt({
      ...built,
      evidence: built.evidence.map((item, index) => index === 0
        ? { ...item, path: '/home/private/capture.png' }
        : item),
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-order' });
  });

  it('rejects invisible terrain/characters and duplicate evidence digests', async () => {
    await expect(buildGodotRuntimeCaptureReceipt({
      ...input(),
      runtime: {
        ...input().runtime,
        visible_terrain_materials: 0,
      },
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-value' });
    await expect(buildGodotRuntimeCaptureReceipt({
      ...input(),
      runtime: {
        ...input().runtime,
        visible_characters: 0,
      },
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-value' });
    await expect(buildGodotRuntimeCaptureReceipt({
      ...input(),
      runtime: {
        ...input().runtime,
        catalog_only_assets: 3,
      },
    })).rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-binding' });
    await expect(buildGodotRuntimeCaptureReceipt({
      ...input(),
      runtime: {
        ...input().runtime,
        all_required_bindings_applied: false,
      },
    } as unknown as BuildGodotRuntimeCaptureReceiptInput))
      .rejects.toMatchObject({ code: 'godot-runtime-capture.invalid-claims' });
    const duplicateDigest = input();
    await expect(buildGodotRuntimeCaptureReceipt({
      ...duplicateDigest,
      evidence: duplicateDigest.evidence.map((item, index) => index === 1
        ? { ...item, sha256: duplicateDigest.evidence[0]!.sha256 }
        : item),
    })).rejects.toMatchObject({
      code: 'godot-runtime-capture.invalid-evidence',
    });
  });
});
