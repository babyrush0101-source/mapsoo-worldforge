import { describe, expect, it, vi } from 'vitest';

import { encodeRgbaPng } from '../canvas/encode-png';
import {
  buildOpenAiProductionArtPrompt,
  createOpenAiProductionArtProvider,
  OPENAI_IMAGE_EDIT_ENDPOINT,
  OPENAI_PRODUCTION_ART_MODEL,
  OPENAI_PRODUCTION_ART_PROVIDER_ID,
  selectOpenAiSourceSize,
} from './openai-production-art-provider';
import { createProductionArtPlan } from '../../core/production-art-contract';
import {
  type ProductionArtProviderJob,
  type RemoteProcessingAuthorization,
} from '../../core/production-art-provider';
import { bindReferenceImage, type ReferenceImageRole, type RuntimeReferenceImage } from '../../core/reference-image';

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function reference(id: string, role: ReferenceImageRole): Promise<RuntimeReferenceImage> {
  const bytes = encodeRgbaPng(2, 2, new Uint8Array(2 * 2 * 4).fill(role === 'character' ? 90 : 180));
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

async function job(): Promise<ProductionArtProviderJob> {
  const plan = createProductionArtPlan('layered-depth-2d', {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const task = plan.tasks.find(({ task_id: taskId }) => taskId === 'scene-direction');
  if (!task) throw new Error('Scene direction task missing.');
  const references = [
    await reference('environment-reference', 'environment-style'),
    await reference('character-reference', 'character'),
  ];
  const remoteAuthorization: RemoteProcessingAuthorization = {
    decision: 'approved',
    provider_id: OPENAI_PRODUCTION_ART_PROVIDER_ID,
    task_id: task.task_id,
    reference_ids: references.map(({ descriptor }) => descriptor.id),
    allow_reference_upload: true,
    allow_prompt_upload: true,
    max_requests: 1,
  };
  return {
    plan,
    task,
    worldBrief: 'An original misty settlement built around a stone causeway.',
    styleBible: 'Layered depth, cool blue dawn, warm windows, compact readable silhouettes.',
    references,
    remoteAuthorization,
  };
}

async function characterJob(): Promise<ProductionArtProviderJob> {
  const value = await job();
  const task = value.plan.tasks.find(({ task_id: taskId }) =>
    taskId === 'character-character-player-atlas');
  if (!task) throw new Error('Layered-depth player production task missing.');
  return {
    ...value,
    task,
    remoteAuthorization: {
      ...value.remoteAuthorization!,
      task_id: task.task_id,
    },
  };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe('OpenAI production art source adapter', () => {
  it('selects exact integer-scale resolutions within GPT Image 2 limits', () => {
    expect(selectOpenAiSourceSize({ width: 384, height: 192 })).toEqual({
      width: 1152,
      height: 576,
      scale: 3,
      value: '1152x576',
    });
    expect(selectOpenAiSourceSize({ width: 256, height: 128 })).toEqual({
      width: 1280,
      height: 640,
      scale: 5,
      value: '1280x640',
    });
    expect(selectOpenAiSourceSize({ width: 1920, height: 1080 })).toEqual({
      width: 3840,
      height: 2160,
      scale: 2,
      value: '3840x2160',
    });
  });

  it('sends one bounded edit request without input_fidelity or transparent output', async () => {
    let capturedUrl: string | URL | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const png = encodeRgbaPng(1, 1, Uint8Array.from([1, 2, 3, 255]));
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ data: [{ b64_json: base64(png) }] }), {
        status: 200,
        headers: { 'x-request-id': 'req_openai_test_1' },
      });
    }) as unknown as typeof fetch;
    const provider = createOpenAiProductionArtProvider({ fetchImpl, quality: 'medium' });
    const result = await provider.generate(await job(), { credential: 'test-runtime-only' });

    expect(capturedUrl).toBe(OPENAI_IMAGE_EDIT_ENDPOINT);
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe('Bearer test-runtime-only');
    const form = capturedInit?.body as FormData;
    expect(form.get('model')).toBe(OPENAI_PRODUCTION_ART_MODEL);
    expect(form.get('size')).toBe('1536x1024');
    expect(form.get('background')).toBe('opaque');
    expect(form.get('output_format')).toBe('png');
    expect(form.get('input_fidelity')).toBeNull();
    expect(form.getAll('image[]')).toHaveLength(2);
    expect(form.getAll('image[]').map((value) =>
      typeof value === 'string' ? value : value.name)).toEqual([
      'environment-style-environment-reference.png',
      'character-character-reference.png',
    ]);
    expect(result).toMatchObject({
      model: OPENAI_PRODUCTION_ART_MODEL,
      workflow: 'image-edit',
      providerRequestId: 'req_openai_test_1',
    });
    expect(JSON.stringify(result)).not.toContain('test-runtime-only');
  });

  it('does not leak a credential or vendor response body through errors', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'do not expose secret-runtime-value' } }),
      { status: 401, headers: { 'x-request-id': 'req_denied_1' } },
    )) as unknown as typeof fetch;
    const provider = createOpenAiProductionArtProvider({ fetchImpl });
    let message = '';
    try {
      await provider.generate(await job(), { credential: 'secret-runtime-value' });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('HTTP 401');
    expect(message).toContain('req_denied_1');
    expect(message).not.toContain('secret-runtime-value');
    expect(message).not.toContain('do not expose');
  });

  it('rejects named commercial imitation before making a request', async () => {
    const value = await job();
    expect(() => buildOpenAiProductionArtPrompt({
      ...value,
      worldBrief: 'Make this look exactly like Stardew Valley.',
    })).toThrow(/original visual traits/);
  });

  it('serializes canonical action, direction, frame and cell semantics into character prompts', async () => {
    const value = await characterJob();
    const prompt = buildOpenAiProductionArtPrompt(value);
    expect(prompt).toContain(
      'image-1=environment-reference (environment-style)',
    );
    expect(prompt).toContain('image-2=character-reference (character)');
    expect(value.task.pose_mappings).toHaveLength(32);
    expect(prompt).toContain('0,0=idle.left.frame-0');
    expect(prompt).toContain('4,0=idle.left.frame-1');
    expect(prompt).toContain('independently rendered animation frame');
    expect(prompt).toContain('not a mirrored or shifted duplicate');
    expect(selectOpenAiSourceSize(value.task.target).value).toBe('1024x1152');
  });
});
