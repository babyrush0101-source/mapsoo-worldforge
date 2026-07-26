import { encodeRgbaPng } from '../../src/adapters/canvas/encode-png';
import type { BrowserReferenceImage } from '../../src/adapters/read-reference-image-file';
import {
  generateReferenceWorldPack,
  type ImplementedReferenceWorldProfile,
} from '../../src/features/reference-world-generator/generate-reference-world-pack';
import { freezeWorldAssetRevision } from '../../src/core/world-asset-revision';

const COMPLETED_AT = '2026-07-20T12:00:00.000Z';
const CONFIRMATION = Object.freeze({
  sessionRevision: 4,
  checkpoints: Object.freeze([
    Object.freeze({ stage: 'world-brief' as const, snapshotSha256: 'a'.repeat(64) }),
    Object.freeze({ stage: 'art-direction' as const, snapshotSha256: 'b'.repeat(64) }),
    Object.freeze({ stage: 'map-layout' as const, snapshotSha256: 'c'.repeat(64) }),
    Object.freeze({ stage: 'style-sample' as const, snapshotSha256: 'd'.repeat(64) }),
  ]),
});

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function reference(role: 'environment-style' | 'character', marker: number): Promise<BrowserReferenceImage> {
  const bytes = encodeRgbaPng(2, 2, Uint8Array.from([
    marker, 90, 70, 255, 60, 120, 160, 255, 30, 50, 80, 255, 210, 170, 100, 255,
  ]));
  return {
    role,
    bytes,
    descriptor: {
      id: `${role}-reference`, role, path: `references/${role}.png`, mediaType: 'image/png',
      byteLength: bytes.byteLength, width: 2, height: 2, sha256: await sha256(bytes),
      rights: {
        basis: 'owned', license: 'LicenseRef-User-Owned', allowGenerativeAdaptation: true,
        allowOutputRedistribution: true, allowOutputCc0Dedication: true,
      },
    },
  };
}

async function run(): Promise<void> {
  const resultNode = document.querySelector<HTMLPreElement>('#result');
  const errorNode = document.querySelector<HTMLPreElement>('#error');
  if (!resultNode || !errorNode) throw new Error('Reference-world browser harness markup is incomplete.');
  try {
    const environment = await reference('environment-style', 35);
    const character = await reference('character', 175);
    const profiles: readonly ImplementedReferenceWorldProfile[] = [
      'topdown-farm',
      'side-platformer',
      'isometric-action',
      'layered-depth-2d',
    ];
    const exports = [];
    for (const profile of profiles) {
      const generated = await generateReferenceWorldPack({
        profile, environment, character, worldId: `browser-${profile}`,
        description: 'A public-safe browser export fixture.', seed: 'browser-route-seed',
        completedAt: COMPLETED_AT, confirmation: CONFIRMATION,
      });
      const launch = await freezeWorldAssetRevision(
        generated.assetRevision,
        generated.assetRevision.revision_sha256,
      );
      exports.push({
        profile, filename: generated.pack.filename, packSchemaVersion: generated.packSchemaVersion,
        generatedFileCount: generated.generatedFileCount, requiredRoleCount: generated.requiredRoleCount,
        characterClipCount: generated.characterClipCount,
        confirmationBindingSha256: generated.confirmationBinding?.binding_sha256,
        confirmationEmbeddedInPack: generated.confirmationEmbeddedInPack,
        assetRevisionSha256: generated.assetRevision.revision_sha256,
        assetPackSha256: generated.assetRevision.pack_sha256,
        assetDialogueBindingSha256: generated.assetRevision.dialogue_binding_sha256,
        launchAssetRevisionSha256: launch.asset_revision_sha256,
        launchBindingSha256: launch.launch_binding_sha256,
        launchScenePath: launch.scene_path,
        characterIdentitySignatureSha256: generated.characterIdentitySignatureSha256,
        environmentArtSignatureSha256: generated.environmentArtSignatureSha256,
        bytes: base64(generated.pack.bytes),
      });
    }
    resultNode.dataset.count = String(exports.length);
    resultNode.textContent = JSON.stringify(exports);
    document.documentElement.dataset.state = 'ready';
  } catch (cause) {
    errorNode.textContent = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
    document.documentElement.dataset.state = 'failed';
  }
}

void run();
