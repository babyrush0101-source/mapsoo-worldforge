import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';

import { encodeRgbaPng } from '../../adapters/canvas/encode-png';
import { decodeReferenceImageRgba } from '../../adapters/decode-reference-image-rgba';
import type { BrowserReferenceImage } from '../../adapters/read-reference-image-file';
import { extractCharacterIdentitySignature } from '../../core/character-identity-signature';
import { createConfirmedWorldCreationIntake } from '../../core/confirmed-world-creation-intake';
import { buildWorldLayoutPlanFromConfirmedIntake } from '../../core/world-layout-plan';
import {
  generateConfirmedReferenceWorldPack,
  generateReferenceWorldPack,
  type ImplementedReferenceWorldProfile,
} from './generate-reference-world-pack';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function references(): Promise<readonly [BrowserReferenceImage, BrowserReferenceImage]> {
  const build = async (role: 'environment-style' | 'character', marker: number): Promise<BrowserReferenceImage> => {
    const bytes = encodeRgbaPng(2, 2, Uint8Array.from([marker, 90, 70, 255, 60, 120, 160, 255, 30, 50, 80, 255, 210, 170, 100, 255]));
    return {
      role,
      descriptor: {
        id: `${role}-reference`, role, path: `private/browser/${role}.png`, mediaType: 'image/png',
        byteLength: bytes.byteLength, width: 2, height: 2, sha256: await sha256(bytes),
        rights: {
          basis: 'owned', license: 'LicenseRef-User-Owned', allowGenerativeAdaptation: true,
          allowOutputRedistribution: true, allowOutputCc0Dedication: true,
        },
      },
      bytes,
    };
  };
  return [await build('environment-style', 35), await build('character', 175)];
}

async function silhouetteCharacter(accessory: boolean): Promise<BrowserReferenceImage> {
  const width = 12;
  const height = 16;
  const rgba = new Uint8Array(width * height * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, color: readonly number[]) => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) rgba.set([...color, 255], (y * width + x) * 4);
    }
  };
  fill(4, 1, 7, 4, [232, 184, 136]);
  fill(3, 5, 8, 11, [64, 112, 208]);
  fill(3, 12, 4, 15, [32, 40, 56]);
  fill(7, 12, 8, 15, [32, 40, 56]);
  if (accessory) fill(8, 6, 10, 8, [232, 72, 88]);
  const bytes = encodeRgbaPng(width, height, rgba);
  return {
    role: 'character',
    descriptor: {
      id: 'character-reference',
      role: 'character',
      path: 'private/browser/character.png',
      mediaType: 'image/png',
      byteLength: bytes.byteLength,
      width,
      height,
      sha256: await sha256(bytes),
      rights: {
        basis: 'owned',
        license: 'LicenseRef-User-Owned',
        allowGenerativeAdaptation: true,
        allowOutputRedistribution: true,
        allowOutputCc0Dedication: true,
      },
    },
    bytes,
  };
}

async function generate(profile: ImplementedReferenceWorldProfile) {
  const [environment, character] = await references();
  return generateReferenceWorldPack({
    profile, environment, character, worldId: `route-${profile}`, description: 'A public-safe route fixture.',
    seed: 'route-seed', completedAt: '2026-07-20T12:00:00.000Z',
  });
}

const confirmation = {
  sessionRevision: 4,
  checkpoints: [
    { stage: 'world-brief' as const, snapshotSha256: 'a'.repeat(64) },
    { stage: 'art-direction' as const, snapshotSha256: 'b'.repeat(64) },
    { stage: 'map-layout' as const, snapshotSha256: 'c'.repeat(64) },
    { stage: 'style-sample' as const, snapshotSha256: 'd'.repeat(64) },
  ],
};

describe('reference-world profile router', () => {
  it('turns structured dialogue facts into the exact intake and embedded Godot layout', async () => {
    const [environment, character] = await references();
    const generated = await generateConfirmedReferenceWorldPack({
      intakeId: 'browser-confirmed-river-world',
      sessionRevision: 4,
      profile: 'topdown-farm',
      target: 'raspberry-pi-4b',
      seed: 'browser-confirmed-seed',
      facts: {
        premise: 'Reconnect a riverside settlement through courier work.',
        worldview: 'Seasonal floods made mutual aid the central civic rule.',
        terrain: 'Riverbanks, bridges, gardens and a climbable hill.',
        geography: 'The ferry spawn connects a market and waterwheel to the hill gate exit.',
        culture: 'Ferry workers, growers and craftspeople share timber public spaces.',
        ecology: 'Reeds, willow trees, birds, drifting leaves and morning mist.',
        mood: 'Hopeful, calm and readable.',
        art_direction: 'Warm hand-painted pixels, teal water and amber landmarks.',
        traversal: 'Walk from the ferry through two checkpoints to the hill gate.',
        landmarks: 'Old ferry; waterwheel market; hilltop gate',
      },
      environment,
      character,
      approvedIntentPreviewSha256: 'e'.repeat(64),
      completedAt: '2026-07-20T12:00:00.000Z',
    });

    expect(generated.confirmedIntake).toMatchObject({
      intake_id: 'browser-confirmed-river-world',
      profile: 'topdown-farm',
      target: 'raspberry-pi-4b',
      seed: 'browser-confirmed-seed',
      facts: {
        geography: 'The ferry spawn connects a market and waterwheel to the hill gate exit.',
        landmarks: 'Old ferry; waterwheel market; hilltop gate',
      },
    });
    expect(generated.confirmedIntakeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.layoutPlanSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.layoutPlan).toMatchObject({
      profile: 'topdown-farm',
      source: {
        intake_id: generated.confirmedIntake.intake_id,
        intake_sha256: generated.confirmedIntakeSha256,
        seed: generated.confirmedIntake.seed,
      },
    });
    expect(generated.confirmationBinding?.binding_sha256)
      .toBe(generated.assetRevision.dialogue_binding_sha256);
    expect(generated.reviewEvidence.approved_intent_preview_sha256).toBe('e'.repeat(64));

    const zip = await JSZip.loadAsync(generated.pack.bytes);
    const layoutEntry = Object.values(zip.files)
      .find(({ name }) => name.endsWith('/world-layout-plan.json'));
    expect(layoutEntry).toBeDefined();
    expect(JSON.parse(await layoutEntry!.async('text'))).toEqual(generated.layoutPlan);
  });

  it('embeds the confirmed deterministic layout across all four pack profiles', async () => {
    const [environment, character] = await references();
    for (const profile of [
      'topdown-farm',
      'side-platformer',
      'isometric-action',
      'layered-depth-2d',
    ] as const) {
      const intake = await createConfirmedWorldCreationIntake({
        intake_id: `layout-route-${profile}`,
        session_revision: 4,
        profile,
        target: 'raspberry-pi-4b',
        seed: 'confirmed-layout-seed',
        facts: {
          premise: 'Restore a compact harbor route.',
          worldview: 'Lantern guilds preserve safe passage.',
          terrain: 'Stone paths, wet docks, and reed beds.',
          geography: 'A readable route connects the pier and lighthouse.',
          culture: 'Boat builders share a market square.',
          ecology: 'Rain, gulls, salt grass, and fog.',
          mood: 'Quiet and readable.',
          art_direction: 'Original hand-painted pixel art.',
          traversal: 'Move from the pier through two landmarks to the exit.',
          landmarks: 'Bell buoy; leaning lighthouse',
        },
        character_source: {
          reference_id: character.descriptor.id,
          identity_digest_sha256: 'a'.repeat(64),
        },
        references: [environment.descriptor, character.descriptor],
        approved_intent_preview_sha256: 'd'.repeat(64),
      });
      const layoutPlan = await buildWorldLayoutPlanFromConfirmedIntake(intake);
      const generated = await generateReferenceWorldPack({
        profile,
        environment,
        character,
        worldId: intake.intake_id,
        description: 'A confirmed layout route.',
        seed: intake.seed,
        completedAt: '2026-07-20T12:00:00.000Z',
        layoutPlan,
      });
      expect(generated.layoutPlanEmbeddedInPack).toBe(true);
      const zip = await JSZip.loadAsync(generated.pack.bytes);
      const layoutEntry = Object.values(zip.files)
        .find(({ name }) => name.endsWith('/world-layout-plan.json'));
      expect(layoutEntry).toBeDefined();
      expect(JSON.parse(await layoutEntry!.async('text'))).toMatchObject({
        plan_id: layoutPlan.plan_id,
        profile,
        source: { seed: intake.seed },
      });
      const paletteEntry = Object.values(zip.files)
        .find(({ name }) => name.endsWith('/world-material-palette.json'));
      expect(paletteEntry).toBeDefined();
      expect(JSON.parse(await paletteEntry!.async('text'))).toMatchObject({
        document_type: 'world-material-palette',
        profile,
        layout: { plan_id: layoutPlan.plan_id },
      });
      const manifestEntry = Object.values(zip.files)
        .find(({ name }) => name.endsWith('/mapsoo.manifest.json'));
      expect(manifestEntry).toBeDefined();
      expect(JSON.parse(await manifestEntry!.async('text'))).toMatchObject({
        layout: {
          plan_id: layoutPlan.plan_id,
          path: 'world-layout-plan.json',
        },
        material_palette: {
          document_type: 'world-material-palette',
          path: 'world-material-palette.json',
        },
      });
      const schemaStem = generated.packSchemaVersion.split('.').slice(0, 2).join('.');
      const schemaEntry = Object.values(zip.files)
        .find(({ name }) => name.endsWith(`/schema/mapsoo-pack-${schemaStem}.schema.json`));
      expect(schemaEntry).toBeDefined();
      expect(JSON.parse(await schemaEntry!.async('text'))).toMatchObject({
        properties: {
          layout: { $ref: '#/$defs/layoutBinding' },
          material_palette: { $ref: '#/$defs/materialPaletteBinding' },
        },
        $defs: {
          layoutBinding: {
            properties: {
              document_type: { const: 'world-layout-plan' },
              path: { const: 'world-layout-plan.json' },
            },
          },
          materialPaletteBinding: {
            properties: {
              document_type: { const: 'world-material-palette' },
              path: { const: 'world-material-palette.json' },
            },
          },
        },
      });
    }
  });

  it('routes four complete profiles to their versioned source packs', async () => {
    const farm = await generate('topdown-farm');
    const side = await generate('side-platformer');
    const isometric = await generate('isometric-action');
    const layered = await generate('layered-depth-2d');
    expect(farm).toMatchObject({ profile: 'topdown-farm', packSchemaVersion: '0.6.0', requiredRoleCount: 21, characterClipCount: 8 });
    expect(farm.pack.filename).toBe('mapsoo-route-topdown-farm-v0.1.0-alpha.9.zip');
    expect(side).toMatchObject({ profile: 'side-platformer', packSchemaVersion: '0.7.0', requiredRoleCount: 30, characterClipCount: 12 });
    expect(side.pack.filename).toBe('mapsoo-route-side-platformer-v0.1.0-alpha.10.zip');
    expect(isometric).toMatchObject({
      profile: 'isometric-action',
      packSchemaVersion: '0.8.0',
      requiredRoleCount: 36,
      characterClipCount: 128,
    });
    expect(isometric.pack.filename).toBe('mapsoo-route-isometric-action-v0.1.0-alpha.11.zip');
    expect(layered).toMatchObject({
      profile: 'layered-depth-2d',
      packSchemaVersion: '0.9.0',
      requiredRoleCount: 36,
      characterClipCount: 24,
    });
    expect(layered.pack.filename).toBe('mapsoo-route-layered-depth-2d-v0.1.0-alpha.12.zip');
    expect(farm.previewBytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(side.previewBytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(isometric.previewBytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(layered.previewBytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    for (const generated of [farm, side, isometric, layered]) {
      expect(generated.reviewEvidence).toMatchObject({
        profile: generated.profile,
        request_fingerprint_sha256: generated.assetRevision.request_fingerprint_sha256,
        dialogue_binding_sha256: null,
        approved_intent_preview_sha256: null,
        preview: { asset_id: 'world-preview', path: 'previews/world.png' },
      });
      expect(generated.reviewEvidence.preview.sha256).toBe(await sha256(generated.previewBytes));
      expect(generated.reviewEvidence.review_binding_sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(farm.assetRevision).toMatchObject({
      world_id: 'route-topdown-farm',
      profile: 'topdown-farm',
      pack_schema_version: '0.6.0',
      dialogue_binding_sha256: null,
    });
    expect(side.assetRevision).toMatchObject({
      world_id: 'route-side-platformer',
      profile: 'side-platformer',
      pack_schema_version: '0.7.0',
      dialogue_binding_sha256: null,
    });
    expect(side.assetRevision.godot.scene_path).toBe(
      'res://mapsoo_imports/route-side-platformer/route-side-platformer.world.tscn',
    );
    expect(isometric.assetRevision).toMatchObject({
      world_id: 'route-isometric-action',
      profile: 'isometric-action',
      pack_schema_version: '0.8.0',
    });
    expect(layered.assetRevision).toMatchObject({
      world_id: 'route-layered-depth-2d',
      profile: 'layered-depth-2d',
      pack_schema_version: '0.9.0',
    });
  });

  it('does not return a pack when already aborted', async () => {
    const [environment, character] = await references();
    const controller = new AbortController(); controller.abort();
    await expect(generateReferenceWorldPack({
      profile: 'side-platformer', environment, character, worldId: 'aborted-side',
      description: 'Must not finish.', seed: 'abort-seed', completedAt: '2026-07-20T12:00:00.000Z',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('binds confirmed dialogue and embeds it in post-Alpha9 versioned receipts', async () => {
    const [environment, character] = await references();
    const build = (profile: ImplementedReferenceWorldProfile) => generateReferenceWorldPack({
      profile, environment, character, worldId: `confirmed-${profile}`,
      description: 'A description projected from four confirmed dialogue rounds.',
      seed: 'confirmed-route-seed', completedAt: '2026-07-20T12:00:00.000Z', confirmation,
    });
    const farm = await build('topdown-farm');
    const side = await build('side-platformer');
    const isometric = await build('isometric-action');
    expect(farm.confirmationBinding?.checkpoints).toHaveLength(4);
    expect(farm.confirmationEmbeddedInPack).toBe(false);
    expect(side.confirmationBinding?.binding_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(side.confirmationEmbeddedInPack).toBe(true);
    expect(isometric.confirmationEmbeddedInPack).toBe(true);
    expect(farm.assetRevision.dialogue_binding_sha256).toBe(farm.confirmationBinding?.binding_sha256);
    expect(side.assetRevision.dialogue_binding_sha256).toBe(side.confirmationBinding?.binding_sha256);
    expect(isometric.assetRevision.dialogue_binding_sha256).toBe(isometric.confirmationBinding?.binding_sha256);

    const zip = await JSZip.loadAsync(side.pack.bytes);
    const receiptEntry = Object.values(zip.files).find(({ name }) => name.endsWith('/generation-receipt.json'));
    expect(receiptEntry).toBeDefined();
    const receipt = JSON.parse(await receiptEntry!.async('text'));
    expect(receipt.request.dialogue_binding).toEqual(side.confirmationBinding);
    expect(JSON.stringify(receipt.request.dialogue_binding)).not.toContain('description projected');
  });

  it('carries the approved intent preview into the exact exported-preview review chain', async () => {
    const [environment, character] = await references();
    const approvedIntentPreviewSha256 = 'e'.repeat(64);
    const generated = await generateReferenceWorldPack({
      profile: 'layered-depth-2d',
      environment,
      character,
      worldId: 'confirmed-review-chain',
      description: 'A dialogue-confirmed layered world.',
      seed: 'review-chain-seed',
      completedAt: '2026-07-20T12:00:00.000Z',
      confirmation,
      approvedIntentPreviewSha256,
    });
    expect(generated.reviewEvidence).toMatchObject({
      dialogue_binding_sha256: generated.confirmationBinding?.binding_sha256,
      approved_intent_preview_sha256: approvedIntentPreviewSha256,
      preview: { sha256: await sha256(generated.previewBytes) },
    });
  });

  it('carries one decoded character palette into both implemented profile atlases', async () => {
    const [environment, character] = await references();
    const identity = await extractCharacterIdentitySignature(
      await decodeReferenceImageRgba(character.bytes, character.descriptor.mediaType),
    );
    const build = (profile: ImplementedReferenceWorldProfile) => generateReferenceWorldPack({
      profile,
      environment,
      character,
      worldId: `identity-${profile}`,
      description: profile === 'topdown-farm' ? 'A sunny farm.' : 'A moonlit platform route.',
      seed: profile === 'topdown-farm' ? 'farm-identity-seed' : 'side-identity-seed',
      completedAt: '2026-07-20T12:00:00.000Z',
    });
    const [farm, side] = await Promise.all([build('topdown-farm'), build('side-platformer')]);
    expect(farm.characterIdentitySignatureSha256).toBe(identity.signature_sha256);
    expect(side.characterIdentitySignatureSha256).toBe(identity.signature_sha256);
    const atlasPixels = async (bytes: Uint8Array) => {
      const zip = await JSZip.loadAsync(bytes);
      const entry = Object.values(zip.files).find(({ name }) => name.endsWith('/atlases/character.png'));
      if (!entry) throw new Error('Character atlas is missing.');
      return (await decodeReferenceImageRgba(await entry.async('uint8array'), 'image/png')).rgba;
    };
    const contains = (rgba: Uint8Array, hex: string) => {
      const rgb = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
      for (let offset = 0; offset < rgba.byteLength; offset += 4) {
        if (rgba[offset] === rgb[0] && rgba[offset + 1] === rgb[1] && rgba[offset + 2] === rgb[2] && rgba[offset + 3] > 0) {
          return true;
        }
      }
      return false;
    };
    const [farmPixels, sidePixels] = await Promise.all([
      atlasPixels(farm.pack.bytes),
      atlasPixels(side.pack.bytes),
    ]);
    for (const color of Object.values(identity.palette)) {
      expect(contains(farmPixels, color), `farm identity color ${color}`).toBe(true);
      expect(contains(sidePixels, color), `side identity color ${color}`).toBe(true);
    }
  });

  it('carries a distinctive decoded silhouette through the complete ZIP pipeline without changing world terrain', async () => {
    const [environment] = await references();
    const build = (character: BrowserReferenceImage, suffix: string) => generateReferenceWorldPack({
      profile: 'side-platformer',
      environment,
      character,
      worldId: `silhouette-${suffix}`,
      description: 'The same public-safe forest route.',
      seed: 'silhouette-route-seed',
      completedAt: '2026-07-20T12:00:00.000Z',
    });
    const [withAccessory, withoutAccessory] = await Promise.all([
      build(await silhouetteCharacter(true), 'with-accessory'),
      build(await silhouetteCharacter(false), 'without-accessory'),
    ]);
    const entries = async (bytes: Uint8Array) => {
      const zip = await JSZip.loadAsync(bytes);
      const read = async (suffix: string) => {
        const entry = Object.values(zip.files).find(({ name }) => name.endsWith(suffix));
        if (!entry) throw new Error(`Missing ${suffix}.`);
        return entry.async('uint8array');
      };
      return {
        character: await read('/atlases/character.png'),
        terrain: await read('/atlases/platforms.png'),
        preview: await read('/previews/world.png'),
      };
    };
    const [first, second] = await Promise.all([
      entries(withAccessory.pack.bytes),
      entries(withoutAccessory.pack.bytes),
    ]);
    expect(withAccessory.characterIdentitySignatureSha256)
      .not.toBe(withoutAccessory.characterIdentitySignatureSha256);
    expect(first.character).not.toEqual(second.character);
    expect(first.preview).not.toEqual(second.preview);
    expect(first.terrain).toEqual(second.terrain);
  });
});
