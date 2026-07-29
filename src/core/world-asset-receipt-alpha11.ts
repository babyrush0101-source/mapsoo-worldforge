import {
  materializeConfirmedGenerationBinding,
  type ConfirmedGenerationBinding,
} from './confirmed-generation-binding';
import { fingerprintGenerationRequestV2, type GenerationRequestV2 } from './generation-request-v2';
import { ISOMETRIC_ACTION_COMPLETENESS_POLICY } from './isometric-action-asset-bundle';
import {
  assertTrustedWorldAssetGeneration,
  type WorldAssetGenerationResult,
} from './world-asset-provider';

export const WORLD_ASSET_RECEIPT_ALPHA11_SCHEMA_VERSION = '0.3.0' as const;

export interface IsometricActionWorldAssetReceipt {
  readonly schema_version: typeof WORLD_ASSET_RECEIPT_ALPHA11_SCHEMA_VERSION;
  readonly completed_at: string;
  readonly request: Readonly<{
    fingerprint_sha256: string;
    profile: 'isometric-action';
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
    bundle_schema_version: '0.3.0';
    completeness_policy: typeof ISOMETRIC_ACTION_COMPLETENESS_POLICY;
    license: 'CC0-1.0';
    files: readonly Readonly<{ path: string; bytes: number; sha256: string }>[];
  }>;
  readonly disclosures: readonly string[];
}

function canonicalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new Error('Alpha11 world asset receipt requires a canonical UTC ISO timestamp.');
  }
  return value;
}

/** Public receipt: it binds the run without publishing references, description or identity signature. */
export async function projectIsometricActionWorldAssetReceipt(
  run: WorldAssetGenerationResult,
  request: GenerationRequestV2,
  completedAt: string,
  confirmationBinding?: ConfirmedGenerationBinding,
): Promise<IsometricActionWorldAssetReceipt> {
  assertTrustedWorldAssetGeneration(run);
  if (request.id !== run.requestId
    || request.profile !== 'isometric-action'
    || run.bundle.profile !== 'isometric-action'
    || run.bundle.schemaVersion !== '0.3.0'
    || run.bundle.completenessPolicy !== ISOMETRIC_ACTION_COMPLETENESS_POLICY) {
    throw new Error('Alpha11 receipt requires a matching complete isometric-action run.');
  }
  if (run.provider.capabilities.outputProvenance !== 'procedural') {
    throw new Error('Alpha11 portable export currently accepts only locally generated procedural assets.');
  }
  if (request.references.some(({ rights }) =>
    rights.basis !== 'owned'
    || rights.license !== 'LicenseRef-User-Owned'
    || rights.allowGenerativeAdaptation !== true
    || rights.allowOutputRedistribution !== true
    || rights.allowOutputCc0Dedication !== true)) {
    throw new Error('Alpha11 CC0 receipt requires owned references and explicit output permission.');
  }
  const fingerprint = await fingerprintGenerationRequestV2(request);
  if (fingerprint !== run.requestFingerprintSha256) {
    throw new Error('Alpha11 receipt request fingerprint does not match the trusted run.');
  }
  const confirmed = confirmationBinding
    ? await materializeConfirmedGenerationBinding(confirmationBinding, request)
    : undefined;
  return Object.freeze({
    schema_version: WORLD_ASSET_RECEIPT_ALPHA11_SCHEMA_VERSION,
    completed_at: canonicalTimestamp(completedAt),
    request: Object.freeze({
      fingerprint_sha256: fingerprint,
      profile: 'isometric-action' as const,
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
      bundle_schema_version: '0.3.0' as const,
      completeness_policy: ISOMETRIC_ACTION_COMPLETENESS_POLICY,
      license: 'CC0-1.0' as const,
      files: Object.freeze(run.bundle.assets.map(({ path, bytes, sha256 }) =>
        Object.freeze({ path, bytes, sha256 })).sort((left, right) => left.path.localeCompare(right.path, 'en'))),
    }),
    disclosures: Object.freeze([
      'Reference images and the extracted local character identity signature are not embedded in this pack.',
      'Reference paths, original image digests, attribution text and source description are omitted from public fields.',
      confirmed
        ? 'The dialogue binding one-way binds four confirmed checkpoints to the exact generation request.'
        : 'The request fingerprint is a one-way binding for local audit comparison; no dialogue binding was supplied.',
    ]),
  });
}
