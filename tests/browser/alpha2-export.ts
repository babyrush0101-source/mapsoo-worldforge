import { buildAlpha2PortablePack } from '../../src/adapters/export-browser-pack-alpha2';
import { ALPHA2_PACK_VERSION } from '../../src/core/pack-manifest-alpha2';
import { parseExternalHostAssetRequestJson } from '../../src/adapters/import-external-host-asset-request';
import { runGenerationProviderWithEvidence } from '../../src/core/generation-provider';
import type { WorldSpec } from '../../src/core/world-spec';
import historicalWorldSpec from '../../examples/sunny-meadow.world.json';
import { PROCEDURAL_PIXEL_PROVIDER } from '../../src/providers/procedural-pixel-provider';
import externalHostExampleRequest from '../../examples/integrations/external-host/river-valley-asset-request.json';

const FIXED_COMPLETION_TIME = '2026-07-18T20:38:44.843Z';

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

async function exportDefaultPack(): Promise<void> {
  const result = document.querySelector<HTMLPreElement>('#result');
  const error = document.querySelector<HTMLPreElement>('#error');
  if (!result || !error) throw new Error('Browser export harness markup is incomplete.');

  try {
    const run = await runGenerationProviderWithEvidence(
      PROCEDURAL_PIXEL_PROVIDER,
      historicalWorldSpec as unknown as WorldSpec,
      { now: () => new Date(FIXED_COMPLETION_TIME) },
    );
    const pack = await buildAlpha2PortablePack(run);
    const externalHostImport = await parseExternalHostAssetRequestJson(JSON.stringify(externalHostExampleRequest));
    if (!externalHostImport.ok) throw new Error(`External Host browser import failed: ${externalHostImport.code}`);
    const bytes = new Uint8Array(await pack.blob.arrayBuffer());
    result.dataset.filename = pack.filename;
    result.dataset.version = ALPHA2_PACK_VERSION;
    result.dataset.externalHostRequestSha256 = externalHostImport.projection.assetRequestSha256;
    result.dataset.externalHostWorldId = externalHostImport.projection.worldSpec.id;
    result.textContent = base64(bytes);
    document.documentElement.dataset.state = 'ready';
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
    document.documentElement.dataset.state = 'failed';
  }
}

void exportDefaultPack();
