import {
  materializeConfirmedGenerationBinding,
  type ConfirmedGenerationBinding,
} from './confirmed-generation-binding';
import { fingerprintGenerationRequestV2, type GenerationRequestV2 } from './generation-request-v2';
import { LAYERED_DEPTH_COMPLETENESS_POLICY } from './layered-depth-asset-bundle';
import {
  assertTrustedWorldAssetGeneration,
  type WorldAssetGenerationResult,
} from './world-asset-provider';

export const WORLD_ASSET_RECEIPT_ALPHA12_SCHEMA_VERSION = '0.4.0' as const;

export interface LayeredDepthWorldAssetReceipt {
  readonly schema_version: typeof WORLD_ASSET_RECEIPT_ALPHA12_SCHEMA_VERSION;
  readonly completed_at: string;
  readonly request: Readonly<{
    fingerprint_sha256: string;
    profile: 'layered-depth-2d';
    seed: string;
    reference_rights: readonly Readonly<{
      role: 'environment-style' | 'character';
      basis: 'owned';
      license: 'LicenseRef-User-Owned';
      permits_cc0_dedication: true;
    }>[];
    dialogue_binding?: ConfirmedGenerationBinding;
  }>;
  readonly provider: Readonly<{
    id: string;
    version: string;
    execution: 'local' | 'remote';
    determinism: 'seeded' | 'best-effort' | 'replay';
    output_provenance: 'procedural' | 'generative-ai' | 'recorded-replay';
  }>;
  readonly output: Readonly<{
    bundle_schema_version: '0.4.0';
    completeness_policy: typeof LAYERED_DEPTH_COMPLETENESS_POLICY;
    license: 'CC0-1.0';
    files: readonly Readonly<{ path: string; bytes: number; sha256: string }>[];
  }>;
  readonly disclosures: readonly string[];
}

function canonicalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new Error('Alpha12 world asset receipt requires a canonical UTC ISO timestamp.');
  }
  return value;
}

/** Public receipt: exact run binding without source images, private text or identity features. */
export async function projectLayeredDepthWorldAssetReceipt(
  run: WorldAssetGenerationResult,
  request: GenerationRequestV2,
  completedAt: string,
  confirmationBinding?: ConfirmedGenerationBinding,
): Promise<LayeredDepthWorldAssetReceipt> {
  assertTrustedWorldAssetGeneration(run);
  if (request.id !== run.requestId
    || request.profile !== 'layered-depth-2d'
    || run.bundle.profile !== 'layered-depth-2d'
    || run.bundle.schemaVersion !== '0.4.0'
    || run.bundle.completenessPolicy !== LAYERED_DEPTH_COMPLETENESS_POLICY) {
    throw new Error('Alpha12 receipt requires a matching complete layered-depth run.');
  }
  if (run.provider.capabilities.outputProvenance !== 'procedural') {
    throw new Error('Alpha12 portable export currently accepts only local procedural assets.');
  }
  if (request.references.some(({ rights }) =>
    rights.basis !== 'owned'
    || rights.license !== 'LicenseRef-User-Owned'
    || rights.allowGenerativeAdaptation !== true
    || rights.allowOutputRedistribution !== true
    || rights.allowOutputCc0Dedication !== true)) {
    throw new Error('Alpha12 CC0 receipt requires owned references and explicit output permission.');
  }
  const fingerprint = await fingerprintGenerationRequestV2(request);
  if (fingerprint !== run.requestFingerprintSha256) {
    throw new Error('Alpha12 receipt request fingerprint does not match the trusted run.');
  }
  const confirmed = confirmationBinding
    ? await materializeConfirmedGenerationBinding(confirmationBinding, request)
    : undefined;
  return Object.freeze({
    schema_version: WORLD_ASSET_RECEIPT_ALPHA12_SCHEMA_VERSION,
    completed_at: canonicalTimestamp(completedAt),
    request: Object.freeze({
      fingerprint_sha256: fingerprint,
      profile: 'layered-depth-2d' as const,
      seed: request.seed,
      reference_rights: Object.freeze(request.references.map(({ role }) => Object.freeze({
        role,
        basis: 'owned' as const,
        license: 'LicenseRef-User-Owned' as const,
        permits_cc0_dedication: true as const,
      }))),
      ...(confirmed ? { dialogue_binding: confirmed } : {}),
    }),
    provider: Object.freeze({
      id: run.provider.id,
      version: run.provider.version,
      execution: run.provider.capabilities.execution,
      determinism: run.provider.capabilities.determinism,
      output_provenance: run.provider.capabilities.outputProvenance,
    }),
    output: Object.freeze({
      bundle_schema_version: '0.4.0' as const,
      completeness_policy: LAYERED_DEPTH_COMPLETENESS_POLICY,
      license: 'CC0-1.0' as const,
      files: Object.freeze(run.bundle.assets.map(({ path, bytes, sha256 }) =>
        Object.freeze({ path, bytes, sha256 })).sort((left, right) => left.path.localeCompare(right.path, 'en'))),
    }),
    disclosures: Object.freeze([
      'Reference images and the extracted local character identity signature are not embedded in this pack.',
      'Reference paths, original image digests, source description and raw dialogue answers are omitted.',
      confirmed
        ? 'The dialogue binding one-way binds four confirmed checkpoints to the exact generation request.'
        : 'The request fingerprint is a one-way local audit binding; no dialogue binding was supplied.',
    ]),
  });
}
