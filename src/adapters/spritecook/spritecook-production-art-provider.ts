import {
  PRODUCTION_ART_TASK_KINDS,
} from '../../core/production-art-contract';
import {
  ProductionArtProviderError,
  type ProductionArtProvider,
  type ProductionArtProviderJob,
} from '../../core/production-art-provider';
import {
  WORLD_ASSET_PROFILES,
} from '../../core/asset-profile';
import {
  compileProductionArtPrompt,
} from '../../core/production-art-prompt';
import {
  decodeReferenceImageRgba,
} from '../decode-reference-image-rgba';
import {
  encodeRgbaPng,
} from '../canvas/encode-png';

export const SPRITECOOK_PRODUCTION_ART_PROVIDER_ID =
  'spritecook-game-art' as const;
export const SPRITECOOK_DEFAULT_MODEL =
  'gemini-3.1-flash-image' as const;
export const SPRITECOOK_IMPORT_ENDPOINT =
  'https://api.spritecook.ai/v1/api/assets/import' as const;
export const SPRITECOOK_GENERATE_ENDPOINT =
  'https://api.spritecook.ai/v1/api/generate-sync' as const;
export const SPRITECOOK_DOCUMENTATION_URL =
  'https://www.spritecook.ai/api-docs' as const;

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PNG_BYTES = 64 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'api.spritecook.ai',
  'gameartgenpublic.s3.eu-north-1.amazonaws.com',
]);

export type SpriteCookProductionArtQuality = 'low' | 'medium' | 'high';
export type SpriteCookProductionArtResolution = '1K' | '2K' | '4K';

export interface SpriteCookIntentSize {
  readonly width: number;
  readonly height: number;
  readonly targetScale: number;
}

export interface SpriteCookProductionArtProviderOptions {
  readonly model?: string;
  readonly quality?: SpriteCookProductionArtQuality;
  readonly resolution?: SpriteCookProductionArtResolution;
  readonly fetchImpl?: typeof fetch;
}

interface ImportedReference {
  readonly referenceId: string;
  readonly role: 'environment-style' | 'character';
  readonly assetId: string;
}

function invalidMetadata(message: string): never {
  throw new ProductionArtProviderError(
    'production-provider.invalid-metadata',
    message,
  );
}

function executionFailed(message: string): never {
  throw new ProductionArtProviderError(
    'production-provider.execution-failed',
    message,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function selectSpriteCookIntentSize(target: {
  readonly width: number;
  readonly height: number;
}): SpriteCookIntentSize {
  if (
    !Number.isSafeInteger(target.width)
    || !Number.isSafeInteger(target.height)
    || target.width < 16
    || target.height < 16
    || target.width > 4_096
    || target.height > 4_096
  ) {
    invalidMetadata('SpriteCook target dimensions are unsupported.');
  }
  const minimumScale = Math.max(
    1,
    Math.ceil(Math.max(target.width, target.height) / 512),
  );
  for (
    let scale = minimumScale;
    scale <= Math.min(target.width, target.height);
    scale += 1
  ) {
    if (target.width % scale !== 0 || target.height % scale !== 0) continue;
    const width = target.width / scale;
    const height = target.height / scale;
    if (width >= 16 && height >= 16 && width <= 512 && height <= 512) {
      return Object.freeze({ width, height, targetScale: scale });
    }
  }
  invalidMetadata(
    'SpriteCook target has no exact integer-scale intent size from 16 to 512 pixels.',
  );
}

function validateDirectAuthorization(job: ProductionArtProviderJob): void {
  const authorization = job.remoteAuthorization;
  const referenceIds = job.references.map(({ descriptor }) => descriptor.id);
  if (
    !authorization
    || authorization.decision !== 'approved'
    || authorization.provider_id !== SPRITECOOK_PRODUCTION_ART_PROVIDER_ID
    || authorization.task_id !== job.task.task_id
    || authorization.allow_reference_upload !== true
    || authorization.allow_prompt_upload !== true
    || authorization.max_requests !== 4
    || authorization.reference_ids.length !== referenceIds.length
    || authorization.reference_ids.some(
      (id, index) => id !== referenceIds[index],
    )
  ) {
    throw new ProductionArtProviderError(
      'production-provider.remote-authorization-required',
      'SpriteCook generation requires exact single-task authorization for at most four HTTP requests.',
    );
  }
}

function validateCredential(value: string | undefined): string {
  if (
    typeof value !== 'string'
    || value.length < 8
    || value.length > 512
    || /[\u0000-\u0020\u007f-\u009f]/u.test(value)
  ) {
    throw new ProductionArtProviderError(
      'production-provider.credentials-required',
      'SpriteCook production art generation requires a valid runtime API key.',
    );
  }
  return value;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)),
    );
  }
  return btoa(binary);
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null
    && (
      !/^\d+$/.test(declaredLength)
      || Number(declaredLength) > maximumBytes
    )
  ) {
    executionFailed('SpriteCook response exceeded the declared byte budget.');
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      executionFailed('SpriteCook response exceeded the byte budget.');
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      executionFailed('SpriteCook response exceeded the byte budget.');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readJson(
  response: Response,
  label: string,
): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBody(response, MAX_JSON_BYTES);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    executionFailed(`${label} was not bounded UTF-8 JSON.`);
  }
  if (!isRecord(parsed)) executionFailed(`${label} was not a JSON object.`);
  return parsed;
}

function safeAssetId(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !ASSET_ID.test(value)
  ) {
    executionFailed(`${label} did not contain a safe asset identifier.`);
  }
  return value;
}

function safeDownloadUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2_000) {
    executionFailed('SpriteCook generation did not return a bounded asset URL.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    executionFailed('SpriteCook generation returned an invalid asset URL.');
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.port !== ''
    || url.hash !== ''
    || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname)
  ) {
    executionFailed('SpriteCook generation returned an untrusted asset URL.');
  }
  return url;
}

function resizeNearest(
  source: {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
  },
  width: number,
  height: number,
): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(
      source.height - 1,
      Math.floor((y * source.height) / height),
    );
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(
        source.width - 1,
        Math.floor((x * source.width) / width),
      );
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      output.set(
        source.rgba.subarray(sourceOffset, sourceOffset + 4),
        targetOffset,
      );
    }
  }
  return output;
}

async function fitSourceToTarget(
  sourcePng: Uint8Array,
  target: { readonly width: number; readonly height: number },
): Promise<Uint8Array> {
  const decoded = await decodeReferenceImageRgba(sourcePng, 'image/png');
  if (decoded.width * target.height !== decoded.height * target.width) {
    executionFailed(
      'SpriteCook output aspect ratio did not match the approved production grid.',
    );
  }
  return encodeRgbaPng(
    target.width,
    target.height,
    resizeNearest(decoded, target.width, target.height),
  );
}

function palette(job: ProductionArtProviderJob): readonly string[] | undefined {
  const colors = job.characterIdentitySemantics?.cues.palette;
  return colors && colors.length > 0
    ? Object.freeze([...colors])
    : undefined;
}

export function createSpriteCookProductionArtProvider(
  options: SpriteCookProductionArtProviderOptions = {},
): ProductionArtProvider {
  const model = options.model ?? SPRITECOOK_DEFAULT_MODEL;
  const quality = options.quality ?? 'medium';
  const resolution = options.resolution ?? '2K';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!MODEL_ID.test(model)) invalidMetadata('SpriteCook model id is invalid.');
  if (!['low', 'medium', 'high'].includes(quality)) {
    invalidMetadata('SpriteCook quality is unsupported.');
  }
  if (!['1K', '2K', '4K'].includes(resolution)) {
    invalidMetadata('SpriteCook resolution is unsupported.');
  }
  if (typeof fetchImpl !== 'function') {
    invalidMetadata('This server runtime does not provide fetch.');
  }

  return Object.freeze({
    id: SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
    version: '1.0.0',
    displayName: 'SpriteCook game-art production source adapter',
    capabilities: Object.freeze({
      execution: 'remote' as const,
      determinism: 'best-effort' as const,
      outputProvenance: 'generative-ai' as const,
      requiresCredentials: true,
      supportsAbort: true,
      supportedProfiles: Object.freeze([...WORLD_ASSET_PROFILES]),
      supportedTaskKinds: Object.freeze([...PRODUCTION_ART_TASK_KINDS]),
      maxReferenceBytes: 16 * 1024 * 1024,
      maxReferenceCount: 2,
      maxOutputBytes: MAX_PNG_BYTES,
      maxRasterDimension: 4_096,
      maxRequestsPerTask: 4,
      providerDocumentationUrl: SPRITECOOK_DOCUMENTATION_URL,
    }),
    generate: async (
      job: ProductionArtProviderJob,
      generateOptions: {
        readonly signal?: AbortSignal;
        readonly credential?: string;
      } = {},
    ) => {
      if (typeof window !== 'undefined') {
        executionFailed(
          'SpriteCook production art generation is server-only; API keys cannot run in the browser.',
        );
      }
      validateDirectAuthorization(job);
      const credential = validateCredential(generateOptions.credential);
      const authorizationHeader = { Authorization: `Bearer ${credential}` };
      const imported: ImportedReference[] = [];

      for (const reference of job.references) {
        let response: Response;
        try {
          response = await fetchImpl(SPRITECOOK_IMPORT_ENDPOINT, {
            method: 'POST',
            headers: {
              ...authorizationHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              image: `data:${reference.descriptor.mediaType};base64,${base64(reference.readBytes())}`,
              pixel: true,
              display_name: reference.descriptor.id,
            }),
            signal: generateOptions.signal,
          });
        } catch {
          if (generateOptions.signal?.aborted) {
            throw new ProductionArtProviderError(
              'production-provider.aborted',
              'SpriteCook reference import was aborted.',
            );
          }
          executionFailed('SpriteCook reference import endpoint could not be reached.');
        }
        if (!response.ok) {
          executionFailed(
            `SpriteCook reference import returned HTTP ${response.status}.`,
          );
        }
        const record = await readJson(
          response,
          'SpriteCook reference import response',
        );
        imported.push(Object.freeze({
          referenceId: reference.descriptor.id,
          role: reference.descriptor.role,
          assetId: safeAssetId(record.id, 'SpriteCook reference import'),
        }));
      }

      const primary = imported.find(({ role }) => role === 'character')
        ?? imported[0];
      if (!primary) executionFailed('SpriteCook task has no imported reference.');
      const styleAssetIds = imported
        .filter(({ assetId }) => assetId !== primary.assetId)
        .map(({ assetId }) => assetId);
      const intent = selectSpriteCookIntentSize(job.task.target);
      const colors = palette(job);
      let generationResponse: Response;
      try {
        generationResponse = await fetchImpl(SPRITECOOK_GENERATE_ENDPOINT, {
          method: 'POST',
          headers: {
            ...authorizationHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: compileProductionArtPrompt(job),
            width: intent.width,
            height: intent.height,
            variations: 1,
            pixel: true,
            pixel_perfect: true,
            bg_mode: 'include',
            smart_crop: false,
            mode: 'assets',
            model,
            quality,
            resolution,
            reference_asset_id: primary.assetId,
            ...(styleAssetIds.length > 0
              ? { style_asset_ids: styleAssetIds }
              : {}),
            ...(colors ? { colors } : {}),
          }),
          signal: generateOptions.signal,
        });
      } catch {
        if (generateOptions.signal?.aborted) {
          throw new ProductionArtProviderError(
            'production-provider.aborted',
            'SpriteCook generation was aborted.',
          );
        }
        executionFailed('SpriteCook generation endpoint could not be reached.');
      }
      if (!generationResponse.ok) {
        executionFailed(
          `SpriteCook generation returned HTTP ${generationResponse.status}.`,
        );
      }
      const generation = await readJson(
        generationResponse,
        'SpriteCook generation response',
      );
      if (
        generation.status !== 'succeeded'
        || !Array.isArray(generation.assets)
        || generation.assets.length !== 1
        || !isRecord(generation.assets[0])
      ) {
        executionFailed(
          'SpriteCook synchronous generation did not return exactly one completed asset.',
        );
      }
      const jobId = safeAssetId(
        generation.job_id,
        'SpriteCook generation response',
      );
      const assetUrl = safeDownloadUrl(generation.assets[0].url);
      let download: Response;
      try {
        download = await fetchImpl(assetUrl, {
          method: 'GET',
          headers: assetUrl.hostname === 'api.spritecook.ai'
            ? authorizationHeader
            : undefined,
          signal: generateOptions.signal,
        });
      } catch {
        if (generateOptions.signal?.aborted) {
          throw new ProductionArtProviderError(
            'production-provider.aborted',
            'SpriteCook asset download was aborted.',
          );
        }
        executionFailed('SpriteCook asset download endpoint could not be reached.');
      }
      if (!download.ok) {
        executionFailed(
          `SpriteCook asset download returned HTTP ${download.status}.`,
        );
      }
      const rawSource = await readBoundedBody(download, MAX_PNG_BYTES);
      let sourcePngBytes: Uint8Array;
      try {
        sourcePngBytes = await fitSourceToTarget(
          rawSource,
          job.task.target,
        );
      } catch (error) {
        if (error instanceof ProductionArtProviderError) throw error;
        executionFailed('SpriteCook asset was not a supported PNG.');
      }
      return Object.freeze({
        sourcePngBytes,
        model,
        workflow: 'image-edit' as const,
        providerRequestId: jobId,
      });
    },
  });
}
