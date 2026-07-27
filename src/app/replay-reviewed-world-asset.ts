import type { GenerationRequestJobV2 } from '../core/generation-request-v2';
import {
  createFingerprintBoundWorldAssetReplayProvider,
  runWorldAssetProvider,
  type WorldAssetGenerationResult,
} from '../core/world-asset-provider';
import type { ReviewedWorldAssetSourceReceipt } from '../core/reviewed-world-asset-source-receipt';
import { materializePack10WorldAssetOutput } from '../adapters/materialize-pack10-world-asset-output';
import { materializeVersionedReviewWorldAssetOutput } from '../adapters/materialize-versioned-review-world-asset-output';

export interface ReviewedWorldAssetReplayResult {
  readonly generation: WorldAssetGenerationResult;
  readonly source: ReviewedWorldAssetSourceReceipt;
}

/** One reviewed-Pack replay entry for all four public world profiles. */
export async function replayReviewedWorldAsset(
  packBytes: Uint8Array,
  job: GenerationRequestJobV2,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ReviewedWorldAssetReplayResult> {
  const projection = job.request.profile === 'layered-depth-2d'
    ? await materializePack10WorldAssetOutput(packBytes, job.request)
    : await materializeVersionedReviewWorldAssetOutput(packBytes, job.request);
  const provider = createFingerprintBoundWorldAssetReplayProvider(
    'mapsoo-reviewed-world-replay',
    '1.0.0',
    job.request.profile,
    projection.output,
    projection.receipt.request_fingerprint_sha256,
  );
  return Object.freeze({
    generation: await runWorldAssetProvider(provider, job, options),
    source: projection.receipt,
  });
}
