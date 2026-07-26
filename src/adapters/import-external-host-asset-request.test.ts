import { describe, expect, it, vi } from 'vitest';
import exampleRequest from '../../examples/integrations/external-host/river-valley-asset-request.json';
import { MAX_WORLD_SPEC_FILE_BYTES } from './import-world-spec';
import {
  parseExternalHostAssetRequestJson,
  readExternalHostAssetRequestFile,
} from './import-external-host-asset-request';

function asFile(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer,
  };
}

describe('External Host Asset Request file import', () => {
  it('strictly parses and projects the public synthetic fixture', async () => {
    const result = await parseExternalHostAssetRequestJson(JSON.stringify(exampleRequest));
    expect(result).toMatchObject({
      ok: true,
      projection: {
        assetRequestSha256: '3ecb182ee9cb2c8c61f2b9857ee6f3e42db01df5266a8a31595796799019aa51',
        worldSpec: {
          id: 'river-valley-observation',
          map: { biome: 'meadow', width: 24, height: 16 },
        },
      },
    });
  });

  it('accepts a UTF-8 BOM and fatal-decodes file bytes', async () => {
    const valid = new TextEncoder().encode(`\uFEFF${JSON.stringify(exampleRequest)}`);
    await expect(readExternalHostAssetRequestFile(asFile('request.json', valid))).resolves.toMatchObject({ ok: true });

    const invalid = Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
    await expect(readExternalHostAssetRequestFile(asFile('invalid.json', invalid))).resolves.toMatchObject({
      ok: false,
      code: 'import.invalid-utf8',
    });
  });

  it('rejects duplicate keys before request projection', async () => {
    const duplicate = JSON.stringify(exampleRequest).replace(
      /^{/,
      '{"schemaVersion":"org.mapsoo.externalhost.asset-request/1.0.0",',
    );
    await expect(parseExternalHostAssetRequestJson(duplicate)).resolves.toMatchObject({
      ok: false,
      code: 'import.duplicate-key',
    });
  });

  it('rejects non-allowlisted private fields without echoing their values', async () => {
    const privateRequest = { ...structuredClone(exampleRequest), parentEmail: 'private-child@example.com' };
    const result = await parseExternalHostAssetRequestJson(JSON.stringify(privateRequest));
    expect(result).toMatchObject({
      ok: false,
      code: 'import.invalid-external-host-request',
      requestCode: 'request.invalid-shape',
    });
    if (!result.ok) expect(result.message).not.toContain('private-child@example.com');
  });

  it('surfaces stable request validation codes for unsupported values', async () => {
    const invalid = structuredClone(exampleRequest);
    invalid.output.assetLicense = 'Proprietary';
    await expect(parseExternalHostAssetRequestJson(JSON.stringify(invalid))).resolves.toMatchObject({
      ok: false,
      code: 'import.invalid-external-host-request',
      requestCode: 'request.invalid-value',
    });
  });

  it('checks declared and actual file sizes before projection', async () => {
    const oversizedRead = vi.fn(async () => new ArrayBuffer(0));
    await expect(readExternalHostAssetRequestFile({
      name: 'large.json',
      size: MAX_WORLD_SPEC_FILE_BYTES + 1,
      arrayBuffer: oversizedRead,
    })).resolves.toMatchObject({ ok: false, code: 'import.too-large' });
    expect(oversizedRead).not.toHaveBeenCalled();

    await expect(readExternalHostAssetRequestFile({
      name: 'understated.json',
      size: 1,
      arrayBuffer: async () => new ArrayBuffer(MAX_WORLD_SPEC_FILE_BYTES + 1),
    })).resolves.toMatchObject({ ok: false, code: 'import.too-large' });
  });

  it('reports read failures without throwing or exposing an exception', async () => {
    const result = await readExternalHostAssetRequestFile({
      name: 'broken-request.json',
      size: 42,
      arrayBuffer: async () => {
        throw new Error('private filesystem detail');
      },
    });
    expect(result).toMatchObject({ ok: false, code: 'import.read-failed' });
    if (!result.ok) expect(result.message).not.toContain('private filesystem detail');
  });
});
