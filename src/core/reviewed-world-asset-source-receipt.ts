import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const REVIEWED_WORLD_ASSET_SOURCE_RECEIPT_VERSION = '1.0.0' as const;
export const REVIEWED_WORLD_ASSET_PACK_CONTRACTS = Object.freeze([
  'pack-0.6',
  'pack-0.7',
  'pack-0.8',
  'pack-1.0',
] as const);
export type ReviewedWorldAssetPackContract =
  typeof REVIEWED_WORLD_ASSET_PACK_CONTRACTS[number];
export type ReviewedWorldAssetGate = 'pending' | 'pass' | 'rejected';

export interface ReviewedWorldAssetSourceReceipt {
  readonly schema_version: typeof REVIEWED_WORLD_ASSET_SOURCE_RECEIPT_VERSION;
  readonly document_type: 'reviewed-world-asset-source-receipt';
  readonly profile: WorldAssetProfile;
  readonly pack_contract: ReviewedWorldAssetPackContract;
  readonly pack_id: string;
  readonly pack_sha256: string;
  readonly manifest_sha256: string;
  readonly review_record_sha256: string | null;
  readonly request_fingerprint_sha256: string;
  readonly authorization: Readonly<{
    distribution: 'internal-review' | 'private' | 'public';
    license_id: string;
    permits_redistribution: boolean;
    contains_generative_ai: boolean;
    human_curated: boolean;
  }>;
  readonly review: Readonly<{
    human_art: ReviewedWorldAssetGate;
    rights: ReviewedWorldAssetGate;
    runtime: ReviewedWorldAssetGate;
    raspberry_pi: ReviewedWorldAssetGate;
  }>;
  readonly runtime_asset_count: number;
  readonly runtime_role_count: number;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LICENSE = /^(?:[A-Za-z0-9][A-Za-z0-9.-]{0,79}|LicenseRef-[A-Za-z0-9][A-Za-z0-9.-]{0,79})$/;
const GATES = new Set<ReviewedWorldAssetGate>(['pending', 'pass', 'rejected']);
const PROFILE_CONTRACT = Object.freeze({
  'topdown-farm': 'pack-0.6',
  'side-platformer': 'pack-0.7',
  'isometric-action': 'pack-0.8',
  'layered-depth-2d': 'pack-1.0',
} as const satisfies Record<WorldAssetProfile, ReviewedWorldAssetPackContract>);
const ROLE_COUNT = Object.freeze({
  'topdown-farm': 21,
  'side-platformer': 30,
  'isometric-action': 36,
  'layered-depth-2d': 36,
} as const satisfies Record<WorldAssetProfile, number>);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

export function materializeReviewedWorldAssetSourceReceipt(
  value: unknown,
): ReviewedWorldAssetSourceReceipt {
  if (!record(value) || !exact(value, [
    'schema_version',
    'document_type',
    'profile',
    'pack_contract',
    'pack_id',
    'pack_sha256',
    'manifest_sha256',
    'review_record_sha256',
    'request_fingerprint_sha256',
    'authorization',
    'review',
    'runtime_asset_count',
    'runtime_role_count',
  ])) {
    throw new Error('Reviewed world asset source receipt shape is invalid.');
  }
  if (
    value.schema_version !== REVIEWED_WORLD_ASSET_SOURCE_RECEIPT_VERSION
    || value.document_type !== 'reviewed-world-asset-source-receipt'
    || !isWorldAssetProfile(value.profile)
    || !REVIEWED_WORLD_ASSET_PACK_CONTRACTS.includes(
      value.pack_contract as ReviewedWorldAssetPackContract,
    )
    || PROFILE_CONTRACT[value.profile] !== value.pack_contract
    || typeof value.pack_id !== 'string'
    || !SAFE_ID.test(value.pack_id)
    || value.pack_id.length > 80
    || typeof value.pack_sha256 !== 'string'
    || !SHA256.test(value.pack_sha256)
    || typeof value.manifest_sha256 !== 'string'
    || !SHA256.test(value.manifest_sha256)
    || (value.review_record_sha256 !== null
      && (typeof value.review_record_sha256 !== 'string'
        || !SHA256.test(value.review_record_sha256)))
    || typeof value.request_fingerprint_sha256 !== 'string'
    || !SHA256.test(value.request_fingerprint_sha256)
    || !Number.isSafeInteger(value.runtime_asset_count)
    || (value.runtime_asset_count as number) < 1
    || (value.runtime_asset_count as number) > ROLE_COUNT[value.profile]
    || value.runtime_role_count !== ROLE_COUNT[value.profile]
  ) {
    throw new Error('Reviewed world asset source receipt identity or counts are invalid.');
  }
  if (
    !record(value.authorization)
    || !exact(value.authorization, [
      'distribution',
      'license_id',
      'permits_redistribution',
      'contains_generative_ai',
      'human_curated',
    ])
    || !['internal-review', 'private', 'public'].includes(
      String(value.authorization.distribution),
    )
    || typeof value.authorization.license_id !== 'string'
    || !LICENSE.test(value.authorization.license_id)
    || typeof value.authorization.permits_redistribution !== 'boolean'
    || typeof value.authorization.contains_generative_ai !== 'boolean'
    || typeof value.authorization.human_curated !== 'boolean'
    || !record(value.review)
    || !exact(value.review, ['human_art', 'rights', 'runtime', 'raspberry_pi'])
    || Object.values(value.review).some((gate) => !GATES.has(gate as ReviewedWorldAssetGate))
  ) {
    throw new Error('Reviewed world asset source authorization or review gates are invalid.');
  }
  const versioned = value.pack_contract !== 'pack-1.0';
  if (versioned && (
    value.review_record_sha256 === null
    || value.authorization.distribution !== 'internal-review'
    || value.authorization.license_id !== 'LicenseRef-UNRELEASED'
    || value.authorization.permits_redistribution !== false
    || value.authorization.contains_generative_ai !== true
    || value.authorization.human_curated !== false
    || Object.values(value.review).some((gate) => gate !== 'pending')
  )) {
    throw new Error('Versioned production-review receipt cannot cross its review boundary.');
  }
  if (!versioned && value.review_record_sha256 !== null) {
    throw new Error('Pack 1.0 review state must remain manifest-bound.');
  }
  return Object.freeze({
    schema_version: REVIEWED_WORLD_ASSET_SOURCE_RECEIPT_VERSION,
    document_type: 'reviewed-world-asset-source-receipt',
    profile: value.profile,
    pack_contract: value.pack_contract as ReviewedWorldAssetPackContract,
    pack_id: value.pack_id,
    pack_sha256: value.pack_sha256,
    manifest_sha256: value.manifest_sha256,
    review_record_sha256: value.review_record_sha256,
    request_fingerprint_sha256: value.request_fingerprint_sha256,
    authorization: Object.freeze({
      distribution: value.authorization.distribution as
        'internal-review' | 'private' | 'public',
      license_id: value.authorization.license_id,
      permits_redistribution: value.authorization.permits_redistribution,
      contains_generative_ai: value.authorization.contains_generative_ai,
      human_curated: value.authorization.human_curated,
    }),
    review: Object.freeze({
      human_art: value.review.human_art as ReviewedWorldAssetGate,
      rights: value.review.rights as ReviewedWorldAssetGate,
      runtime: value.review.runtime as ReviewedWorldAssetGate,
      raspberry_pi: value.review.raspberry_pi as ReviewedWorldAssetGate,
    }),
    runtime_asset_count: value.runtime_asset_count as number,
    runtime_role_count: value.runtime_role_count as number,
  });
}
