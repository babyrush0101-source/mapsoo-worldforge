import { describe, expect, it } from 'vitest';
import exampleRequest from '../../../examples/integrations/external-host/river-valley-asset-request.json';
import requestSchema from '../../../integrations/external-host/external-host-asset-request.schema.json';
import {
  EXTERNAL_HOST_ASSET_REQUEST_EXTENSION,
  ExternalHostAssetRequestError,
  canonicalizeExternalHostAssetRequest,
  projectExternalHostAssetRequest,
} from './asset-request';

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe('External Host Asset Request projection', () => {
  it('keeps the published schema identity, closed objects, and target tuple aligned with runtime validation', () => {
    expect(requestSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      additionalProperties: false,
      properties: {
        world: { additionalProperties: false },
        scene: { additionalProperties: false },
        visual: { additionalProperties: false },
        map: { additionalProperties: false },
        output: {
          additionalProperties: false,
          properties: {
            targets: {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              items: false,
              prefixItems: [{ const: 'common' }, { const: 'godot' }, { const: 'itch' }],
            },
          },
        },
      },
    });
  });

  it('projects the synthetic allowlisted request into a strict Mapsoo World Spec', async () => {
    const projection = await projectExternalHostAssetRequest(exampleRequest);
    expect(projection.assetRequestSha256).toBe(
      '3ecb182ee9cb2c8c61f2b9857ee6f3e42db01df5266a8a31595796799019aa51',
    );
    expect(projection.worldSpec).toMatchObject({
      schemaVersion: '0.2.0',
      id: 'river-valley-observation',
      map: { width: 24, height: 16, biome: 'meadow' },
      output: { targets: ['common', 'godot', 'itch'], assetLicense: 'CC0-1.0' },
    });
    expect(projection.worldSpec.extensions?.[EXTERNAL_HOST_ASSET_REQUEST_EXTENSION]).toEqual({
      schemaVersion: 'org.mapsoo.externalhost.asset-request/1.0.0',
      assetRequestSha256: projection.assetRequestSha256,
      externalHostWorldId: 'river-valley',
      externalHostWorldVersion: '1.0.0',
      sceneId: 'riverbank-observation',
      requiredSceneTags: ['riverbank', 'old-bridge', 'observation-point'],
      contentRating: 'ages-7-plus',
    });
  });

  it('uses canonical key ordering so equivalent requests have the same hash', async () => {
    const reordered = {
      output: clone(exampleRequest.output),
      map: clone(exampleRequest.map),
      visual: clone(exampleRequest.visual),
      seed: exampleRequest.seed,
      scene: {
        contentRating: exampleRequest.scene.contentRating,
        requiredSceneTags: clone(exampleRequest.scene.requiredSceneTags),
        id: exampleRequest.scene.id,
      },
      world: {
        description: exampleRequest.world.description,
        title: exampleRequest.world.title,
        version: exampleRequest.world.version,
        id: exampleRequest.world.id,
      },
      packId: exampleRequest.packId,
      schemaVersion: exampleRequest.schemaVersion,
    };
    const [first, second] = await Promise.all([
      projectExternalHostAssetRequest(exampleRequest),
      projectExternalHostAssetRequest(reordered),
    ]);
    expect(second.assetRequestSha256).toBe(first.assetRequestSha256);
    expect(canonicalizeExternalHostAssetRequest(reordered)).toBe(canonicalizeExternalHostAssetRequest(exampleRequest));
  });

  it.each(['childId', 'parentEmail', 'learningProgress', 'privateServiceUrl', 'apiKey'])(
    'rejects the non-allowlisted private field %s',
    async (field) => {
      const request = clone(exampleRequest) as typeof exampleRequest & Record<string, unknown>;
      request[field] = 'must-not-cross-the-boundary';
      await expect(projectExternalHostAssetRequest(request)).rejects.toMatchObject({
        code: 'request.invalid-shape',
      });
    },
  );

  it('rejects private fields hidden inside public sections', async () => {
    const request = clone(exampleRequest);
    const privateWorld = request.world as typeof request.world & { childId: string };
    privateWorld.childId = 'private-child';
    await expect(projectExternalHostAssetRequest(request)).rejects.toMatchObject({
      code: 'request.invalid-shape',
    });
  });

  it('rejects duplicate or malformed semantic scene tags', async () => {
    const duplicate = clone(exampleRequest);
    duplicate.scene.requiredSceneTags = ['riverbank', 'riverbank'];
    await expect(projectExternalHostAssetRequest(duplicate)).rejects.toMatchObject({
      code: 'request.invalid-value',
    });

    const malformed = clone(exampleRequest);
    malformed.scene.requiredSceneTags = ['Child Name'];
    await expect(projectExternalHostAssetRequest(malformed)).rejects.toMatchObject({
      code: 'request.invalid-value',
    });
  });

  it('rejects unsupported versions, styles, dimensions, and licenses', async () => {
    const wrongVersion = clone(exampleRequest);
    wrongVersion.schemaVersion = 'org.mapsoo.externalhost.asset-request/2.0.0';
    await expect(projectExternalHostAssetRequest(wrongVersion)).rejects.toBeInstanceOf(ExternalHostAssetRequestError);

    const wrongStyle = clone(exampleRequest);
    wrongStyle.visual.style = 'photorealistic';
    await expect(projectExternalHostAssetRequest(wrongStyle)).rejects.toBeInstanceOf(ExternalHostAssetRequestError);

    const oversized = clone(exampleRequest);
    oversized.map.width = 49;
    await expect(projectExternalHostAssetRequest(oversized)).rejects.toBeInstanceOf(ExternalHostAssetRequestError);

    const wrongLicense = clone(exampleRequest);
    wrongLicense.output.assetLicense = 'Proprietary';
    await expect(projectExternalHostAssetRequest(wrongLicense)).rejects.toBeInstanceOf(ExternalHostAssetRequestError);
  });

  it('rejects control characters in every public text field', async () => {
    const request = clone(exampleRequest);
    request.world.description = 'public description\u0000hidden suffix';
    await expect(projectExternalHostAssetRequest(request)).rejects.toMatchObject({
      code: 'request.invalid-value',
    });
  });

  it('returns detached arrays so callers cannot mutate the request or projection across boundaries', async () => {
    const request = clone(exampleRequest);
    const projection = await projectExternalHostAssetRequest(request);
    request.visual.palette[0] = '#000000';
    request.scene.requiredSceneTags[0] = 'changed';

    expect(projection.worldSpec.visual.palette[0]).toBe('#2F5D3A');
    expect(
      (projection.worldSpec.extensions?.[EXTERNAL_HOST_ASSET_REQUEST_EXTENSION] as { requiredSceneTags: string[] })
        .requiredSceneTags[0],
    ).toBe('riverbank');
  });
});
