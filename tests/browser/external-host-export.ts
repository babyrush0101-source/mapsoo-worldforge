import { buildAlpha7PortablePack } from '../../src/adapters/export-browser-pack-alpha7';
import { runGenerationProviderWithEvidence } from '../../src/core/generation-provider';
import { ALPHA7_PACK_VERSION } from '../../src/core/pack-manifest-alpha7';
import {
  prepareExternalHostPackExport,
  EXTERNAL_HOST_MAPSOO_EXPORT_SCHEMA_VERSION,
} from '../../src/integrations/external-host/export-bridge';
import { PROCEDURAL_TERRAIN_PROVIDER } from '../../src/providers/procedural-terrain-provider';

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

async function exportExternalHostPack(): Promise<void> {
  const result = document.querySelector<HTMLPreElement>('#result');
  const error = document.querySelector<HTMLPreElement>('#error');
  if (!result || !error) throw new Error('External Host browser export harness markup is incomplete.');
  try {
    const completedAt = new URL(window.location.href).searchParams.get('completedAt');
    if (!completedAt || Number.isNaN(Date.parse(completedAt))) {
      throw new Error('A valid completedAt timestamp is required.');
    }
    const response = await fetch('/__mapsoo_external_host_request', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load External Host request (${response.status}).`);
    const prepared = await prepareExternalHostPackExport(await response.text());
    const run = await runGenerationProviderWithEvidence(PROCEDURAL_TERRAIN_PROVIDER, prepared.worldSpec, {
      now: () => new Date(completedAt),
    });
    const pack = await buildAlpha7PortablePack(run);
    const bytes = new Uint8Array(await pack.blob.arrayBuffer());
    result.dataset.version = ALPHA7_PACK_VERSION;
    result.textContent = JSON.stringify({
      schemaVersion: EXTERNAL_HOST_MAPSOO_EXPORT_SCHEMA_VERSION,
      completedAt,
      binding: prepared.binding,
      pack: { filename: pack.filename, bytes: base64(bytes) },
    });
    document.documentElement.dataset.state = 'ready';
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
    document.documentElement.dataset.state = 'failed';
  }
}

void exportExternalHostPack();
