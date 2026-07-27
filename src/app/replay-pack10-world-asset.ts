import type { GenerationRequestJobV2 } from '../core/generation-request-v2';
import type { WorldAssetGenerationResult } from '../core/world-asset-provider';
import type { Pack10WorldAssetReplayReceipt } from '../adapters/materialize-pack10-world-asset-output';
import { replayReviewedWorldAsset } from './replay-reviewed-world-asset';

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
  if (job.request.profile !== 'layered-depth-2d') {
    throw new Error('Pack 1.0 replay requires the layered-depth-2d profile.');
  }
  return replayReviewedWorldAsset(packBytes, job, options);
}
