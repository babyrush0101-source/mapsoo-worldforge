import { describe, expect, it } from 'vitest';

import fixture from '../../../examples/integrations/external-host/river-valley-asset-request.json';
import { validateWorldSpec } from '../../core/validate-world';
import { prepareExternalHostPackExport, ExternalHostExportBridgeError } from './export-bridge';

describe('External Host pack export bridge', () => {
  it('losslessly advances the public request to World Spec 0.3 without inventing semantics', async () => {
    const prepared = await prepareExternalHostPackExport(JSON.stringify(fixture));

    expect(prepared.worldSpec.schemaVersion).toBe('0.3.0');
    expect(prepared.worldSpec.id).toBe('river-valley-observation');
    expect(prepared.worldSpec.places).toBeUndefined();
    expect(prepared.worldSpec.structures).toBeUndefined();
    expect(validateWorldSpec(prepared.worldSpec).some((issue) => issue.severity === 'error')).toBe(false);
    expect(prepared.binding).toEqual({
      packId: 'river-valley-observation',
      assetRequestSha256: '3ecb182ee9cb2c8c61f2b9857ee6f3e42db01df5266a8a31595796799019aa51',
      externalHostWorldId: 'river-valley',
      externalHostWorldVersion: '1.0.0',
      sceneId: 'riverbank-observation',
      requiredSceneTags: ['riverbank', 'old-bridge', 'observation-point'],
      contentRating: 'ages-7-plus',
    });
  });

  it('keeps strict JSON and privacy allowlist failures fail-closed', async () => {
    await expect(prepareExternalHostPackExport('{"schemaVersion":1,"schemaVersion":2}')).rejects.toMatchObject({
      code: 'import.duplicate-key',
    });
    await expect(prepareExternalHostPackExport(JSON.stringify({ childId: 'private' }))).rejects.toBeInstanceOf(
      ExternalHostExportBridgeError,
    );
  });
});
