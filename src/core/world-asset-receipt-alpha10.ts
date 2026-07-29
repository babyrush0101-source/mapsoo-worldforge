import { fingerprintGenerationRequestV2, type GenerationRequestV2 } from './generation-request-v2';
import {
  materializeConfirmedGenerationBinding,
  type ConfirmedGenerationBinding,
} from './confirmed-generation-binding';
import { SIDE_PLATFORMER_COMPLETENESS_POLICY } from './side-platformer-asset-bundle';
import {
  assertTrustedWorldAssetGeneration,
  type WorldAssetGenerationResult,
} from './world-asset-provider';

export const WORLD_ASSET_RECEIPT_ALPHA10_SCHEMA_VERSION = '0.2.0' as const;

export interface SidePlatformerWorldAssetReceipt {
  readonly schema_version: typeof WORLD_ASSET_RECEIPT_ALPHA10_SCHEMA_VERSION;
  readonly completed_at: string;
  readonly request: {
    readonly fingerprint_sha256: string;
    readonly profile: 'side-platformer';
    readonly seed: string;
    readonly reference_rights: readonly {
      readonly role: 'environment-style' | 'character';
      readonly basis: 'owned';
      readonly license: 'LicenseRef-User-Owned';
      readonly permits_cc0_dedication: true;
    }[];
    readonly dialogue_binding?: ConfirmedGenerationBinding;
  };
  readonly provider: {
    readonly id: string;
    readonly version: string;
    readonly execution: 'local' | 'remote';
    readonly determinism: 'seeded' | 'best-effort' | 'replay';
    readonly output_provenance: 'procedural' | 'generative-ai' | 'recorded-replay';
  };
  readonly output: {
    readonly bundle_schema_version: '0.2.0';
    readonly completeness_policy: typeof SIDE_PLATFORMER_COMPLETENESS_POLICY;
    readonly license: 'CC0-1.0';
    readonly files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[];
  };
  readonly disclosures: readonly string[];
}

function canonicalTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new Error('Alpha10 world asset receipt requires a canonical UTC ISO timestamp.');
  }
  return value;
}

/** Public, privacy-minimized receipt for the strict Alpha10 side-platformer contract. */
export async function projectSidePlatformerWorldAssetReceipt(
  run: WorldAssetGenerationResult,
  request: GenerationRequestV2,
  completedAt: string,
  confirmationBinding?: ConfirmedGenerationBinding,
): Promise<SidePlatformerWorldAssetReceipt> {
  assertTrustedWorldAssetGeneration(run);
  if (
    request.id !== run.requestId
    || request.profile !== 'side-platformer'
    || run.bundle.profile !== 'side-platformer'
    || run.bundle.schemaVersion !== '0.2.0'
    || run.bundle.completenessPolicy !== SIDE_PLATFORMER_COMPLETENESS_POLICY
  ) {
    throw new Error('Alpha10 receipt requires a matching complete side-platformer run.');
  }
  if (run.provider.capabilities.outputProvenance !== 'procedural') {
    throw new Error('Alpha10 portable export currently accepts only locally generated procedural assets.');
  }
  if (request.references.some(({ rights }) => (
    rights.basis !== 'owned'
    || rights.license !== 'LicenseRef-User-Owned'
    || rights.allowGenerativeAdaptation !== true
    || rights.allowOutputRedistribution !== true
    || rights.allowOutputCc0Dedication !== true
  ))) {
    throw new Error('Alpha10 CC0 receipt requires user-owned references with explicit adaptation, redistribution, and CC0 dedication permission.');
  }
  const fingerprint = await fingerprintGenerationRequestV2(request);
  if (fingerprint !== run.requestFingerprintSha256) {
    throw new Error('Alpha10 receipt request fingerprint does not match the trusted run.');
  }
  const confirmed = confirmationBinding
    ? await materializeConfirmedGenerationBinding(confirmationBinding, request)
    : undefined;
  return Object.freeze({
    schema_version: WORLD_ASSET_RECEIPT_ALPHA10_SCHEMA_VERSION,
    completed_at: canonicalTimestamp(completedAt),
    request: Object.freeze({
      fingerprint_sha256: fingerprint,
      profile: 'side-platformer' as const,
      seed: request.seed,
      reference_rights: Object.freeze(request.references.map((reference) => Object.freeze({
        role: reference.role,
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
      bundle_schema_version: '0.2.0' as const,
      completeness_policy: SIDE_PLATFORMER_COMPLETENESS_POLICY,
      license: 'CC0-1.0' as const,
      files: Object.freeze(run.bundle.assets.map((asset) => Object.freeze({
        path: asset.path,
        bytes: asset.bytes,
        sha256: asset.sha256,
      })).sort((left, right) => left.path.localeCompare(right.path, 'en'))),
    }),
    disclosures: Object.freeze([
      'Reference images are not embedded in this pack.',
      'Reference paths, original image digests, attribution text, and the source description are omitted from public fields.',
      confirmed
        ? 'The dialogue binding one-way binds four confirmed checkpoints to the exact generation request.'
        : 'The request fingerprint is a one-way binding for local audit comparison; no confirmed dialogue binding was supplied.',
    ]),
  });
}
