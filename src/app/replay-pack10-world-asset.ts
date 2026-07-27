import type { GenerationRequestJobV2 } from '../core/generation-request-v2';
import {
  createFingerprintBoundWorldAssetReplayProvider,
  runWorldAssetProvider,
  type WorldAssetGenerationResult,
} from '../core/world-asset-provider';
import {
  materializePack10WorldAssetOutput,
  type Pack10WorldAssetReplayReceipt,
} from '../adapters/materialize-pack10-world-asset-output';

export interface Pack10WorldAssetReplayResult {
  readonly generation: WorldAssetGenerationResult;
  readonly source: Pack10WorldAssetReplayReceipt;
}

/**
 * Re-enters an accepted Pack 1.0 archive through the same trusted provider
 * boundary used by generated worlds. The source receipt is intentionally kept
 * beside the runtime result so review/distribution state is never upgraded.
 */
export async function replayPack10WorldAsset(
  packBytes: Uint8Array,
  job: GenerationRequestJobV2,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Pack10WorldAssetReplayResult> {
  const projection = await materializePack10WorldAssetOutput(packBytes, job.request);
  const provider = createFingerprintBoundWorldAssetReplayProvider(
    'mapsoo-pack10-world-replay',
    '1.0.0',
    'layered-depth-2d',
    projection.output,
    projection.receipt.request_fingerprint_sha256,
  );
  const generation = await runWorldAssetProvider(provider, job, options);
  return Object.freeze({
    generation,
    source: projection.receipt,
  });
}
