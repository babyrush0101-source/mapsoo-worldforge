import {
  PRODUCTION_ART_TASK_KINDS,
  type ProductionArtTask,
} from '../../core/production-art-contract';
import {
  ProductionArtProviderError,
  type ProductionArtProvider,
  type ProductionArtProviderJob,
} from '../../core/production-art-provider';
import { WORLD_ASSET_PROFILES } from '../../core/asset-profile';

export const OPENAI_PRODUCTION_ART_PROVIDER_ID = 'openai-gpt-image-2' as const;
export const OPENAI_PRODUCTION_ART_MODEL = 'gpt-image-2-2026-04-21' as const;
export const OPENAI_IMAGE_EDIT_ENDPOINT = 'https://api.openai.com/v1/images/edits' as const;
export const OPENAI_IMAGE_DOCUMENTATION_URL = 'https://developers.openai.com/api/docs/guides/image-generation' as const;

const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_EDGE = 3_840;
const MAX_RESPONSE_CHARACTERS = 96 * 1024 * 1024;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const NAMED_IMITATION = /\b(?:in\s+the\s+style\s+of|hades|stardew(?:\s+valley)?|octopath(?:\s+traveler)?)\b|(?:哈迪斯|星露谷物语|八方旅人)/iu;

export type OpenAiProductionArtQuality = 'low' | 'medium' | 'high';

export interface OpenAiSourceSize {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly value: `${number}x${number}`;
}

export interface OpenAiProductionArtProviderOptions {
  readonly quality?: OpenAiProductionArtQuality;
  readonly fetchImpl?: typeof fetch;
}

function invalidMetadata(message: string): never {
  throw new ProductionArtProviderError('production-provider.invalid-metadata', message);
}

function executionFailed(message: string): never {
  throw new ProductionArtProviderError('production-provider.execution-failed', message);
}

export function selectOpenAiSourceSize(target: {
  readonly width: number;
  readonly height: number;
}): OpenAiSourceSize {
  if (
    !Number.isSafeInteger(target.width)
    || !Number.isSafeInteger(target.height)
    || target.width < 1
    || target.height < 1
    || Math.max(target.width, target.height) / Math.min(target.width, target.height) > 3
  ) {
    invalidMetadata('Production target cannot be represented by a supported GPT Image 2 aspect ratio.');
  }
  for (let scale = 1; scale <= 64; scale += 1) {
    const width = target.width * scale;
    const height = target.height * scale;
    const pixels = width * height;
    if (width > MAX_EDGE || height > MAX_EDGE || pixels > MAX_PIXELS) break;
    if (width % 16 === 0 && height % 16 === 0 && pixels >= MIN_PIXELS) {
      return Object.freeze({
        width,
        height,
        scale,
        value: `${width}x${height}`,
      });
    }
  }
  invalidMetadata('Production target has no exact integer-scale GPT Image 2 source resolution.');
}

function boundedPromptText(value: string, label: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  ) {
    invalidMetadata(`${label} is invalid.`);
  }
  if (NAMED_IMITATION.test(value)) {
    invalidMetadata(
      `${label} must describe original visual traits instead of naming a commercial game, franchise, or artist style.`,
    );
  }
  return value;
}

function gridDescription(task: ProductionArtTask): string {
  const columns = task.target.width / task.target.cell_width;
  const rows = task.target.height / task.target.cell_height;
  return `${columns} columns by ${rows} rows`;
}

export function buildOpenAiProductionArtPrompt(job: ProductionArtProviderJob): string {
  const worldBrief = boundedPromptText(job.worldBrief, 'World brief', 2_000);
  const styleBible = boundedPromptText(job.styleBible, 'Style bible', 4_000);
  const alphaInstructions = job.task.alpha_policy === 'straight-alpha'
    ? [
      'Render on one perfectly solid #00FF00 green chroma background connected to all four outer image borders.',
      'Do not use green in any subject, prop, costume, effect, terrain, or lighting.',
      'Keep every subject fully isolated from neighboring cells.',
      job.task.seam_policy === 'transparent-cell-padding'
        ? 'Leave a clean empty chroma border on all four edges of every grid cell.'
        : 'Keep all undeclared grid cells entirely chroma green.',
    ]
    : [
      'Render a fully opaque image with no transparent or empty pixels.',
    ];
  return [
    'Create one original production source image for a Godot 2D world asset pipeline.',
    `Profile: ${job.plan.profile}. Task: ${job.task.kind}.`,
    `World brief: ${worldBrief}`,
    `Approved style bible: ${styleBible}`,
    `Canvas grid: ${gridDescription(job.task)}. Preserve the declared role order exactly.`,
    `Declared roles: ${job.task.role_mappings.map(({ role }) => role).join(', ')}.`,
    job.task.prompt,
    ...alphaInstructions,
    ...job.task.negative_constraints,
    'Do not imitate any named game, franchise, living artist, studio, logo, or existing protected character.',
    'Use a single coherent original palette, camera, pixel density, silhouette language, and material treatment.',
  ].join('\n');
}

function validateDirectRemoteAuthorization(job: ProductionArtProviderJob): void {
  const authorization = job.remoteAuthorization;
  const ids = job.references.map(({ descriptor }) => descriptor.id);
  if (
    !authorization
    || authorization.decision !== 'approved'
    || authorization.provider_id !== OPENAI_PRODUCTION_ART_PROVIDER_ID
    || authorization.task_id !== job.task.task_id
    || authorization.allow_reference_upload !== true
    || authorization.allow_prompt_upload !== true
    || authorization.max_requests !== 1
    || authorization.reference_ids.length !== ids.length
    || authorization.reference_ids.some((id, index) => id !== ids[index])
  ) {
    throw new ProductionArtProviderError(
      'production-provider.remote-authorization-required',
      'OpenAI image editing requires exact single-task upload authorization.',
    );
  }
}

function decodeBase64Png(value: unknown): Uint8Array {
  if (
    typeof value !== 'string'
    || value.length < 4
    || value.length > MAX_RESPONSE_CHARACTERS
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    executionFailed('OpenAI image response did not contain bounded base64 PNG data.');
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    executionFailed('OpenAI image response contained invalid base64 data.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function responseImageData(raw: string): Uint8Array {
  if (raw.length < 2 || raw.length > MAX_RESPONSE_CHARACTERS) {
    executionFailed('OpenAI image response exceeded the bounded response budget.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    executionFailed('OpenAI image response was not valid JSON.');
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || !Array.isArray((parsed as { data?: unknown }).data)
    || (parsed as { data: unknown[] }).data.length !== 1
  ) {
    executionFailed('OpenAI image response did not contain exactly one image.');
  }
  const first = (parsed as { data: unknown[] }).data[0];
  if (typeof first !== 'object' || first === null) {
    executionFailed('OpenAI image response image record was invalid.');
  }
  return decodeBase64Png((first as { b64_json?: unknown }).b64_json);
}

function safeRequestId(response: Response): string | undefined {
  const value = response.headers.get('x-request-id') ?? undefined;
  return value && REQUEST_ID.test(value) ? value : undefined;
}

export function createOpenAiProductionArtProvider(
  options: OpenAiProductionArtProviderOptions = {},
): ProductionArtProvider {
  const quality = options.quality ?? 'medium';
  if (!['low', 'medium', 'high'].includes(quality)) invalidMetadata('OpenAI image quality is unsupported.');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') invalidMetadata('This server runtime does not provide fetch.');

  return Object.freeze({
    id: OPENAI_PRODUCTION_ART_PROVIDER_ID,
    version: '1.0.0',
    displayName: 'OpenAI GPT Image 2 production source adapter',
    capabilities: Object.freeze({
      execution: 'remote' as const,
      determinism: 'best-effort' as const,
      outputProvenance: 'generative-ai' as const,
      requiresCredentials: true,
      supportsAbort: true,
      supportedProfiles: Object.freeze([...WORLD_ASSET_PROFILES]),
      supportedTaskKinds: Object.freeze([...PRODUCTION_ART_TASK_KINDS]),
      maxReferenceBytes: 32 * 1024 * 1024,
      maxReferenceCount: 8,
      maxOutputBytes: 64 * 1024 * 1024,
      maxRasterDimension: MAX_EDGE,
      maxRequestsPerTask: 1,
      providerDocumentationUrl: OPENAI_IMAGE_DOCUMENTATION_URL,
    }),
    generate: async (
      job: ProductionArtProviderJob,
      generateOptions: { readonly signal?: AbortSignal; readonly credential?: string } = {},
    ) => {
      if (typeof window !== 'undefined') {
        executionFailed('OpenAI production art generation is server-only; API keys cannot run in the browser.');
      }
      validateDirectRemoteAuthorization(job);
      const credential = generateOptions.credential;
      if (
        typeof credential !== 'string'
        || credential.length < 8
        || credential.length > 512
        || /[\u0000-\u0020\u007f-\u009f]/u.test(credential)
      ) {
        throw new ProductionArtProviderError(
          'production-provider.credentials-required',
          'OpenAI production art generation requires a valid runtime API key.',
        );
      }
      const size = selectOpenAiSourceSize(job.task.target);
      const form = new FormData();
      form.append('model', OPENAI_PRODUCTION_ART_MODEL);
      form.append('prompt', buildOpenAiProductionArtPrompt(job));
      form.append('size', size.value);
      form.append('quality', quality);
      form.append('background', 'opaque');
      form.append('output_format', 'png');
      form.append('n', '1');
      job.references.forEach((reference, index) => {
        const extension = reference.descriptor.mediaType === 'image/png' ? 'png' : 'jpg';
        const bytes = reference.readBytes();
        form.append(
          'image[]',
          new Blob([Uint8Array.from(bytes).buffer], { type: reference.descriptor.mediaType }),
          `${reference.descriptor.role}-${index + 1}.${extension}`,
        );
      });
      let response: Response;
      try {
        response = await fetchImpl(OPENAI_IMAGE_EDIT_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credential}`,
          },
          body: form,
          signal: generateOptions.signal,
        });
      } catch {
        if (generateOptions.signal?.aborted) {
          throw new ProductionArtProviderError(
            'production-provider.aborted',
            'OpenAI production art generation was aborted.',
          );
        }
        executionFailed('OpenAI image endpoint could not be reached.');
      }
      const requestId = safeRequestId(response);
      if (!response.ok) {
        executionFailed(
          `OpenAI image endpoint returned HTTP ${response.status}${requestId ? ` (${requestId})` : ''}.`,
        );
      }
      const sourcePngBytes = responseImageData(await response.text());
      return Object.freeze({
        sourcePngBytes,
        model: OPENAI_PRODUCTION_ART_MODEL,
        workflow: 'image-edit' as const,
        ...(requestId === undefined ? {} : { providerRequestId: requestId }),
      });
    },
  });
}
