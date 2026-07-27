import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createProductionArtPlan,
} from '../../core/production-art-contract';
import {
  bindReferenceImage,
  type ReferenceImageRole,
  type RuntimeReferenceImage,
} from '../../core/reference-image';
import type {
  CharacterIdentitySemantics,
} from '../../core/character-identity-semantics';
import type {
  ProductionArtProviderJob,
  RemoteProcessingAuthorization,
} from '../../core/production-art-provider';
import {
  encodeRgbaPng,
} from '../canvas/encode-png';
import {
  createSpriteCookProductionArtProvider,
  selectSpriteCookIntentSize,
  SPRITECOOK_GENERATE_ENDPOINT,
  SPRITECOOK_IMPORT_ENDPOINT,
  SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
} from './spritecook-production-art-provider';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function reference(
  id: string,
  role: ReferenceImageRole,
): Promise<RuntimeReferenceImage> {
  const bytes = encodeRgbaPng(
    2,
    2,
    new Uint8Array(2 * 2 * 4).fill(role === 'character' ? 90 : 180),
  );
  return bindReferenceImage({
    id,
    role,
    path: `references/${id}.png`,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    width: 2,
    height: 2,
    sha256: await sha256(bytes),
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  }, bytes);
}

function semantics(): CharacterIdentitySemantics {
  return {
    schema_version: '1.0.0',
    document_type: 'character-identity-semantics',
    character_id: 'lantern-courier',
    source_identity: {
      identity_digest_sha256: 'a'.repeat(64),
      source_reference_id: 'character-reference',
    },
    confirmation: {
      status: 'human-confirmed',
      checkpoint_sha256: 'b'.repeat(64),
    },
    cues: {
      silhouette: 'Compact traveler with a broad scarf and narrow boots.',
      body_proportions: 'Large head, short torso, slim arms, and sturdy legs.',
      hair: 'Dark wavy bob with one upward curl above the left eyebrow.',
      face: 'Round face, straight eyebrows, and a small triangular nose.',
      clothing: ['Magenta jacket.', 'Amber scarf.'],
      equipment: ['Small round lantern at the left hip.'],
      distinguishing_features: ['Pale crescent patch above the right eyebrow.'],
      palette: ['#231f2b', '#b43b73', '#e4a43b'],
    },
  };
}

async function job(
  authorizationMaxRequests = 4,
): Promise<ProductionArtProviderJob> {
  const plan = createProductionArtPlan('topdown-farm', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const task = plan.tasks.find(({ task_id: taskId }) =>
    taskId === 'scene-direction');
  if (!task) throw new Error('Scene direction task missing.');
  const references = [
    await reference('environment-reference', 'environment-style'),
    await reference('character-reference', 'character'),
  ];
  const remoteAuthorization: RemoteProcessingAuthorization = {
    decision: 'approved',
    provider_id: SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
    task_id: task.task_id,
    reference_ids: references.map(({ descriptor }) => descriptor.id),
    allow_reference_upload: true,
    allow_prompt_upload: true,
    max_requests: authorizationMaxRequests,
  };
  return {
    plan,
    task,
    worldBrief: 'An original misty settlement built around a stone causeway.',
    styleBible: 'Cool blue dawn, warm windows, compact readable silhouettes.',
    characterIdentitySemantics: semantics(),
    references,
    remoteAuthorization,
  };
}

function sourcePng(): Uint8Array {
  return encodeRgbaPng(
    3,
    2,
    Uint8Array.from([
      0, 255, 0, 255,
      0, 255, 0, 255,
      0, 255, 0, 255,
      0, 255, 0, 255,
      120, 80, 60, 255,
      0, 255, 0, 255,
    ]),
  );
}

describe('SpriteCook production art source adapter', () => {
  it('selects exact intent sizes inside the public 16-512 range', () => {
    expect(selectSpriteCookIntentSize({ width: 1_536, height: 1_024 }))
      .toEqual({ width: 384, height: 256, targetScale: 4 });
    expect(selectSpriteCookIntentSize({ width: 1_920, height: 1_080 }))
      .toEqual({ width: 480, height: 270, targetScale: 4 });
    expect(selectSpriteCookIntentSize({ width: 256, height: 128 }))
      .toEqual({ width: 256, height: 128, targetScale: 1 });
  });

  it('imports ordered references, reuses their asset ids, and returns one grid-fitted PNG', async () => {
    const requests: Array<{
      readonly url: string;
      readonly init: RequestInit | undefined;
    }> = [];
    let importCount = 0;
    const fetchImpl = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url === SPRITECOOK_IMPORT_ENDPOINT) {
        importCount += 1;
        return new Response(JSON.stringify({
          id: importCount === 1 ? 'asset-environment-1' : 'asset-character-1',
          url: `https://api.spritecook.ai/v1/assets/imported-${importCount}`,
        }), { status: 200 });
      }
      if (url === SPRITECOOK_GENERATE_ENDPOINT) {
        return new Response(JSON.stringify({
          job_id: 'job-spritecook-1',
          status: 'succeeded',
          assets: [{
            id: 'asset-generated-1',
            url: 'https://api.spritecook.ai/v1/assets/asset-generated-1/content/pixel',
          }],
          credits_used: 8,
          credits_remaining: 100,
        }), { status: 200 });
      }
      return new Response(Uint8Array.from(sourcePng()).buffer, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }) as unknown as typeof fetch;
    const provider = createSpriteCookProductionArtProvider({
      fetchImpl,
      model: 'gemini-3.1-flash-image',
      quality: 'medium',
      resolution: '2K',
    });

    const result = await provider.generate(
      await job(),
      { credential: 'sc_test_runtime_only' },
    );

    expect(requests).toHaveLength(4);
    expect(requests.slice(0, 2).map(({ url }) => url)).toEqual([
      SPRITECOOK_IMPORT_ENDPOINT,
      SPRITECOOK_IMPORT_ENDPOINT,
    ]);
    const imports = requests.slice(0, 2).map(({ init }) =>
      JSON.parse(String(init?.body)));
    expect(imports.map(({ display_name: displayName }) => displayName)).toEqual([
      'environment-reference',
      'character-reference',
    ]);
    expect(imports.every(({ image }) =>
      typeof image === 'string' && image.startsWith('data:image/png;base64,')))
      .toBe(true);

    const generation = JSON.parse(String(requests[2].init?.body));
    expect(generation).toMatchObject({
      width: 384,
      height: 256,
      variations: 1,
      pixel: true,
      pixel_perfect: true,
      bg_mode: 'include',
      smart_crop: false,
      reference_asset_id: 'asset-character-1',
      style_asset_ids: ['asset-environment-1'],
      colors: ['#231f2b', '#b43b73', '#e4a43b'],
    });
    expect(generation.prompt).toContain('Human-confirmed character preservation contract');
    expect(generation.prompt).toContain('Dark wavy bob');
    expect(requests[3].init?.headers).toEqual({
      Authorization: 'Bearer sc_test_runtime_only',
    });
    expect(result).toMatchObject({
      model: 'gemini-3.1-flash-image',
      workflow: 'image-edit',
      providerRequestId: 'job-spritecook-1',
    });
    const view = new DataView(
      result.sourcePngBytes.buffer,
      result.sourcePngBytes.byteOffset,
      result.sourcePngBytes.byteLength,
    );
    expect(view.getUint32(16)).toBe(1_536);
    expect(view.getUint32(20)).toBe(1_024);
    expect(JSON.stringify(result)).not.toContain('sc_test_runtime_only');
  });

  it('requires provider-bound four-request authorization before any upload', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const provider = createSpriteCookProductionArtProvider({ fetchImpl });
    await expect(provider.generate(
      await job(1),
      { credential: 'sc_test_runtime_only' },
    )).rejects.toMatchObject({
      code: 'production-provider.remote-authorization-required',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not expose credentials or remote error bodies', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call <= 2) {
        return new Response(JSON.stringify({ id: `asset-import-${call}` }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({
        error: 'secret-runtime-value should never escape',
      }), { status: 402 });
    }) as unknown as typeof fetch;
    const provider = createSpriteCookProductionArtProvider({ fetchImpl });
    const error = await provider.generate(
      await job(),
      { credential: 'secret-runtime-value' },
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'production-provider.execution-failed',
    });
    expect(String(error)).not.toContain('secret-runtime-value');
  });

  it('rejects an untrusted download host before fetching generated bytes', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call <= 2) {
        return new Response(JSON.stringify({ id: `asset-import-${call}` }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({
        job_id: 'job-untrusted-url',
        status: 'succeeded',
        assets: [{
          id: 'asset-generated',
          url: 'https://example.invalid/private-source.png',
        }],
      }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createSpriteCookProductionArtProvider({ fetchImpl });
    await expect(provider.generate(
      await job(),
      { credential: 'sc_test_runtime_only' },
    )).rejects.toMatchObject({
      code: 'production-provider.execution-failed',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
