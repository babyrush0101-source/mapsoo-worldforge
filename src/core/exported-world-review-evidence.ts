import type { WorldAssetProfile } from './asset-profile';
import type { GeneratedAssetBundle, GeneratedAssetRecord } from './generated-asset-bundle';
import type { TrustedGeneratedAssetPayload } from './world-asset-provider';

export const EXPORTED_WORLD_REVIEW_EVIDENCE_SCHEMA_VERSION = '0.1.0' as const;

const SHA256 = /^[a-f0-9]{64}$/;

export interface ExportedWorldReviewEvidence {
  readonly schema_version: typeof EXPORTED_WORLD_REVIEW_EVIDENCE_SCHEMA_VERSION;
  readonly profile: WorldAssetProfile;
  readonly request_fingerprint_sha256: string;
  readonly dialogue_binding_sha256: string | null;
  readonly approved_intent_preview_sha256: string | null;
  readonly preview: Readonly<{
    readonly asset_id: string;
    readonly path: string;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
  }>;
  readonly runtime: Readonly<{
    readonly scene_sha256: string;
    readonly collision_sha256: string;
    readonly navigation_sha256: string;
  }>;
  readonly visual_asset_set_sha256: string;
  readonly review_binding_sha256: string;
}

function requireDigest(value: string | undefined, label: string): string {
  if (!value || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function requireAsset(bundle: GeneratedAssetBundle, id: string, label: string): GeneratedAssetRecord {
  const asset = bundle.assets.find((candidate) => candidate.id === id);
  if (!asset) throw new Error(`Exported world review is missing its ${label} asset.`);
  return asset;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) throw new Error('Review evidence contains an unsupported value.');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value.slice();
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createExportedWorldReviewEvidence(input: {
  readonly bundle: GeneratedAssetBundle;
  readonly payloads: readonly TrustedGeneratedAssetPayload[];
  readonly requestFingerprintSha256: string;
  readonly dialogueBindingSha256?: string;
  readonly approvedIntentPreviewSha256?: string;
}): Promise<ExportedWorldReviewEvidence> {
  const { bundle } = input;
  const preview = requireAsset(bundle, bundle.scene.previewAssetId, 'preview');
  const scene = requireAsset(bundle, bundle.scene.dataAssetId, 'scene');
  const collision = requireAsset(bundle, bundle.scene.collisionAssetId, 'collision');
  const navigation = requireAsset(bundle, bundle.scene.navigationAssetId, 'navigation');
  if (preview.kind !== 'preview' || preview.mediaType !== 'image/png' || !preview.width || !preview.height) {
    throw new Error('Exported world preview must be a dimensioned PNG preview asset.');
  }
  const previewRole = bundle.roles.find(({ role }) => role === 'world.preview');
  if (!previewRole || previewRole.assetId !== preview.id) {
    throw new Error('Exported world preview is not the scene-bound world.preview role.');
  }
  const payload = input.payloads.find(({ assetId }) => assetId === preview.id);
  if (!payload || payload.path !== preview.path || payload.mediaType !== 'image/png') {
    throw new Error('Exported world preview payload does not match its asset record.');
  }
  if (await sha256(payload.readBytes()) !== preview.sha256) {
    throw new Error('Exported world preview payload does not match its recorded SHA-256.');
  }

  const requestFingerprintSha256 = requireDigest(input.requestFingerprintSha256, 'Generation request fingerprint');
  const dialogueBindingSha256 = input.dialogueBindingSha256 === undefined
    ? null
    : requireDigest(input.dialogueBindingSha256, 'Dialogue binding');
  const approvedIntentPreviewSha256 = input.approvedIntentPreviewSha256 === undefined
    ? null
    : requireDigest(input.approvedIntentPreviewSha256, 'Approved intent preview');
  const visualAssets = bundle.assets
    .filter(({ mediaType, id }) => mediaType === 'image/png' && id !== preview.id)
    .map(({ id, kind, path, sha256: assetSha256 }) => ({ id, kind, path, sha256: assetSha256 }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (visualAssets.length === 0) throw new Error('Exported world review requires at least one visual source asset.');
  const visualAssetSetSha256 = await sha256(canonicalJson(visualAssets));
  const review = {
    schema_version: EXPORTED_WORLD_REVIEW_EVIDENCE_SCHEMA_VERSION,
    profile: bundle.profile,
    request_fingerprint_sha256: requestFingerprintSha256,
    dialogue_binding_sha256: dialogueBindingSha256,
    approved_intent_preview_sha256: approvedIntentPreviewSha256,
    preview: {
      asset_id: preview.id,
      path: preview.path,
      sha256: preview.sha256,
      width: preview.width,
      height: preview.height,
    },
    runtime: {
      scene_sha256: requireDigest(scene.sha256, 'Scene asset'),
      collision_sha256: requireDigest(collision.sha256, 'Collision asset'),
      navigation_sha256: requireDigest(navigation.sha256, 'Navigation asset'),
    },
    visual_asset_set_sha256: visualAssetSetSha256,
  } as const;
  return Object.freeze({
    ...review,
    preview: Object.freeze(review.preview),
    runtime: Object.freeze(review.runtime),
    review_binding_sha256: await sha256(canonicalJson(review)),
  });
}
