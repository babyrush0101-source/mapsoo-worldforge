import {
  PRODUCTION_ART_TASK_KINDS,
  validateProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtTask,
  type ProductionArtTaskKind,
} from './production-art-contract';
import {
  materializeProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from './production-art-contract-v1-1';
import type { AssetRequirementsV1_1 } from './asset-requirements-v1-1';
import {
  bindReferenceImage,
  type RuntimeReferenceImage,
} from './reference-image';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from './asset-profile';
import {
  materializeCharacterIdentitySemantics,
  type CharacterIdentitySemantics,
} from './character-identity-semantics';

const PROVIDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const trustedProductionArtSources = new WeakSet<object>();

export interface ProductionArtProviderCapabilities {
  readonly execution: 'local' | 'remote';
  readonly determinism: 'best-effort' | 'replay';
  readonly outputProvenance: 'generative-ai' | 'recorded-replay';
  readonly requiresCredentials: boolean;
  readonly supportsAbort: boolean;
  readonly supportedProfiles: readonly WorldAssetProfile[];
  readonly supportedTaskKinds: readonly ProductionArtTaskKind[];
  readonly maxReferenceBytes: number;
  readonly maxReferenceCount: number;
  readonly maxOutputBytes: number;
  readonly maxRasterDimension: number;
  readonly maxRequestsPerTask: number;
  readonly providerDocumentationUrl: string;
}

export interface RemoteProcessingAuthorization {
  readonly decision: 'approved';
  readonly provider_id: string;
  readonly task_id: string;
  readonly reference_ids: readonly string[];
  readonly allow_reference_upload: true;
  readonly allow_prompt_upload: true;
  readonly max_requests: number;
}

export interface ProductionArtProviderJob {
  readonly plan: ProductionArtPlan;
  readonly task: ProductionArtTask;
  readonly worldBrief: string;
  readonly styleBible: string;
  readonly characterIdentitySemantics?: CharacterIdentitySemantics;
  readonly references: readonly RuntimeReferenceImage[];
  readonly remoteAuthorization?: RemoteProcessingAuthorization;
}

export interface ProductionArtProviderJobV1_1 {
  readonly plan: ProductionArtPlanV1_1;
  readonly task: ProductionArtTaskV1_1;
  readonly worldBrief: string;
  readonly styleBible: string;
  readonly characterIdentitySemantics?: CharacterIdentitySemantics;
  readonly references: readonly RuntimeReferenceImage[];
  readonly remoteAuthorization?: RemoteProcessingAuthorization;
}

export interface ProductionArtProviderCandidate {
  readonly sourcePngBytes: Uint8Array;
  readonly model: string;
  readonly workflow: 'image-generation' | 'image-edit' | 'recorded-replay';
  readonly providerRequestId?: string;
}

export interface ProductionArtProvider {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: ProductionArtProviderCapabilities;
  generate(
    job: ProductionArtProviderJob,
    options?: {
      readonly signal?: AbortSignal;
      /** Runtime-only secret. The trusted runner never stores or returns it. */
      readonly credential?: string;
    },
  ): Promise<ProductionArtProviderCandidate>;
}

/**
 * Explicit 1.1 provider surface. Keeping it separate prevents widening the
 * established 1.0 provider method contract for existing adapters.
 */
export interface ProductionArtProviderV1_1 {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: ProductionArtProviderCapabilities;
  generate(
    job: ProductionArtProviderJobV1_1,
    options?: {
      readonly signal?: AbortSignal;
      /** Runtime-only secret. The trusted runner never stores or returns it. */
      readonly credential?: string;
    },
  ): Promise<ProductionArtProviderCandidate>;
}

export interface ProductionArtProviderSnapshot {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: ProductionArtProviderCapabilities;
}

export interface TrustedProductionArtSource {
  readonly provider: ProductionArtProviderSnapshot;
  readonly plan: ProductionArtPlan;
  readonly task: ProductionArtTask;
  readonly sourceReferenceIds: readonly string[];
  readonly generation: {
    readonly model: string;
    readonly workflow: ProductionArtProviderCandidate['workflow'];
    readonly providerRequestId?: string;
  };
  readonly source: {
    readonly mediaType: 'image/png';
    readonly byteLength: number;
    readonly width: number;
    readonly height: number;
    readBytes(): Uint8Array;
  };
}

export interface TrustedProductionArtSourceV1_1 {
  readonly provider: ProductionArtProviderSnapshot;
  readonly plan: ProductionArtPlanV1_1;
  readonly task: ProductionArtTaskV1_1;
  readonly sourceReferenceIds: readonly string[];
  readonly generation: {
    readonly model: string;
    readonly workflow: ProductionArtProviderCandidate['workflow'];
    readonly providerRequestId?: string;
  };
  readonly source: {
    readonly mediaType: 'image/png';
    readonly byteLength: number;
    readonly width: number;
    readonly height: number;
    readBytes(): Uint8Array;
  };
}

export interface ProductionArtProviderInputV1_1 {
  readonly plan: ProductionArtPlanV1_1;
  readonly requirements: AssetRequirementsV1_1;
  readonly taskId: string;
  readonly worldBrief: string;
  readonly styleBible: string;
  readonly characterIdentitySemantics?: unknown;
  readonly references: readonly RuntimeReferenceImage[];
  readonly remoteAuthorization?: RemoteProcessingAuthorization;
}

export type ProductionArtProviderErrorCode =
  | 'production-provider.invalid-metadata'
  | 'production-provider.unsupported-profile'
  | 'production-provider.unsupported-task'
  | 'production-provider.remote-authorization-required'
  | 'production-provider.credentials-required'
  | 'production-provider.aborted'
  | 'production-provider.execution-failed'
  | 'production-provider.invalid-output';

export class ProductionArtProviderError extends Error {
  constructor(readonly code: ProductionArtProviderErrorCode, message: string) {
    super(message);
    this.name = 'ProductionArtProviderError';
  }
}

function fail(code: ProductionArtProviderErrorCode, message: string): never {
  throw new ProductionArtProviderError(code, message);
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}

function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactDataObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!isPlainDataObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
    fail('production-provider.invalid-metadata', `${label} must be a plain data object.`);
  }
  const names = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    fail('production-provider.invalid-metadata', `${label} must contain only declared fields.`);
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail('production-provider.invalid-metadata', `${label} must contain only enumerable data properties.`);
    }
  }
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

function deepFreezeData<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreezeData(nested);
  return Object.freeze(value);
}

function clonePlan(plan: ProductionArtPlan): ProductionArtPlan {
  try {
    return deepFreezeData(JSON.parse(JSON.stringify(plan)) as ProductionArtPlan);
  } catch {
    fail('production-provider.invalid-metadata', 'Production art plan must be finite JSON data.');
  }
}

function clonePlanV1_1(plan: ProductionArtPlanV1_1): ProductionArtPlanV1_1 {
  try {
    return deepFreezeData(JSON.parse(JSON.stringify(plan)) as ProductionArtPlanV1_1);
  } catch {
    fail('production-provider.invalid-metadata', 'Production art plan must be finite JSON data.');
  }
}

function snapshotProvider(
  provider: ProductionArtProvider | ProductionArtProviderV1_1,
): ProductionArtProviderSnapshot {
  requireExactDataObject(provider, ['id', 'version', 'displayName', 'capabilities', 'generate'], 'Production art provider');
  const capabilities = provider.capabilities;
  requireExactDataObject(capabilities, [
    'execution',
    'determinism',
    'outputProvenance',
    'requiresCredentials',
    'supportsAbort',
    'supportedProfiles',
    'supportedTaskKinds',
    'maxReferenceBytes',
    'maxReferenceCount',
    'maxOutputBytes',
    'maxRasterDimension',
    'maxRequestsPerTask',
    'providerDocumentationUrl',
  ], 'Production art provider capabilities');
  if (
    !PROVIDER_ID.test(provider.id)
    || provider.id.length > 80
    || !VERSION.test(provider.version)
    || typeof provider.displayName !== 'string'
    || provider.displayName.trim() !== provider.displayName
    || provider.displayName.length < 1
    || provider.displayName.length > 120
    || typeof provider.generate !== 'function'
    || !['local', 'remote'].includes(capabilities.execution)
    || !['best-effort', 'replay'].includes(capabilities.determinism)
    || !['generative-ai', 'recorded-replay'].includes(capabilities.outputProvenance)
    || typeof capabilities.requiresCredentials !== 'boolean'
    || typeof capabilities.supportsAbort !== 'boolean'
    || !Array.isArray(capabilities.supportedProfiles)
    || capabilities.supportedProfiles.length < 1
    || new Set(capabilities.supportedProfiles).size !== capabilities.supportedProfiles.length
    || capabilities.supportedProfiles.some((profile) => !WORLD_ASSET_PROFILES.includes(profile))
    || !Array.isArray(capabilities.supportedTaskKinds)
    || capabilities.supportedTaskKinds.length < 1
    || new Set(capabilities.supportedTaskKinds).size !== capabilities.supportedTaskKinds.length
    || capabilities.supportedTaskKinds.some((kind) => !PRODUCTION_ART_TASK_KINDS.includes(kind))
    || !positiveInteger(capabilities.maxReferenceBytes, 64 * 1024 * 1024)
    || !positiveInteger(capabilities.maxReferenceCount, 8)
    || !positiveInteger(capabilities.maxOutputBytes, 128 * 1024 * 1024)
    || !positiveInteger(capabilities.maxRasterDimension, 8192)
    || !positiveInteger(capabilities.maxRequestsPerTask, 4)
    || !validHttpsUrl(capabilities.providerDocumentationUrl)
  ) {
    fail('production-provider.invalid-metadata', 'Production art provider metadata or capabilities are invalid.');
  }
  return deepFreezeData({
    id: provider.id,
    version: provider.version,
    displayName: provider.displayName,
    capabilities: {
      execution: capabilities.execution,
      determinism: capabilities.determinism,
      outputProvenance: capabilities.outputProvenance,
      requiresCredentials: capabilities.requiresCredentials,
      supportsAbort: capabilities.supportsAbort,
      supportedProfiles: [...capabilities.supportedProfiles],
      supportedTaskKinds: [...capabilities.supportedTaskKinds],
      maxReferenceBytes: capabilities.maxReferenceBytes,
      maxReferenceCount: capabilities.maxReferenceCount,
      maxOutputBytes: capabilities.maxOutputBytes,
      maxRasterDimension: capabilities.maxRasterDimension,
      maxRequestsPerTask: capabilities.maxRequestsPerTask,
      providerDocumentationUrl: capabilities.providerDocumentationUrl,
    },
  });
}

function boundedText(value: string, label: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)
  ) {
    fail('production-provider.invalid-metadata', `${label} must be non-empty, trimmed, and bounded.`);
  }
  return value;
}

function abortIfNeeded(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail('production-provider.aborted', 'Production art generation was aborted.');
}

function validateRemoteAuthorization(
  authorization: RemoteProcessingAuthorization | undefined,
  provider: ProductionArtProviderSnapshot,
  task: Pick<ProductionArtTask, 'task_id'> | Pick<ProductionArtTaskV1_1, 'task_id'>,
  referenceIds: readonly string[],
): void {
  if (provider.capabilities.execution !== 'remote') return;
  if (!authorization) {
    fail(
      'production-provider.remote-authorization-required',
      'Remote generation requires explicit, provider-bound authorization for this single task.',
    );
  }
  requireExactDataObject(authorization, [
    'decision',
    'provider_id',
    'task_id',
    'reference_ids',
    'allow_reference_upload',
    'allow_prompt_upload',
    'max_requests',
  ], 'Remote processing authorization');
  const authorizedIds = [...authorization.reference_ids];
  if (
    authorization.decision !== 'approved'
    || authorization.provider_id !== provider.id
    || authorization.task_id !== task.task_id
    || authorization.allow_reference_upload !== true
    || authorization.allow_prompt_upload !== true
    || authorization.max_requests !== provider.capabilities.maxRequestsPerTask
    || authorizedIds.length !== referenceIds.length
    || authorizedIds.some((id, index) => id !== referenceIds[index])
  ) {
    fail(
      'production-provider.remote-authorization-required',
      'Remote authorization must exactly match the provider, task, references, and request limit.',
    );
  }
}

function pngHeader(
  bytes: Uint8Array,
  maximumBytes: number,
  maximumDimension: number,
): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 33
    || bytes.byteLength > maximumBytes
    || signature.some((byte, index) => bytes[index] !== byte)
  ) {
    fail('production-provider.invalid-output', 'Provider output must be a bounded PNG.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (
    view.getUint32(8) !== 13
    || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
    || bytes[24] !== 8
    || ![2, 6].includes(bytes[25])
    || bytes[26] !== 0
    || bytes[27] !== 0
    || bytes[28] !== 0
    || width < 1
    || height < 1
    || width > maximumDimension
    || height > maximumDimension
  ) {
    fail(
      'production-provider.invalid-output',
      'Provider PNG must be non-interlaced 8-bit RGB/RGBA within the raster budget.',
    );
  }
  return { width, height };
}

interface ProductionArtProviderInputV1_0 {
  readonly plan: ProductionArtPlan;
  readonly taskId: string;
  readonly worldBrief: string;
  readonly styleBible: string;
  readonly characterIdentitySemantics?: unknown;
  readonly references: readonly RuntimeReferenceImage[];
  readonly remoteAuthorization?: RemoteProcessingAuthorization;
}

interface ProductionArtProviderRunOptions {
  readonly signal?: AbortSignal;
  readonly credential?: string;
}

export function runProductionArtProvider(
  provider: ProductionArtProvider,
  supplied: ProductionArtProviderInputV1_0,
  options?: ProductionArtProviderRunOptions,
): Promise<TrustedProductionArtSource>;
export function runProductionArtProvider(
  provider: ProductionArtProviderV1_1,
  supplied: ProductionArtProviderInputV1_1,
  options?: ProductionArtProviderRunOptions,
): Promise<TrustedProductionArtSourceV1_1>;
export async function runProductionArtProvider(
  provider: ProductionArtProvider | ProductionArtProviderV1_1,
  supplied: ProductionArtProviderInputV1_0 | ProductionArtProviderInputV1_1,
  options: ProductionArtProviderRunOptions = {},
): Promise<TrustedProductionArtSource | TrustedProductionArtSourceV1_1> {
  const contract = snapshotProvider(provider);
  abortIfNeeded(options.signal);
  const isV1_1 = supplied.plan.schema_version === '1.1.0';
  let plan: ProductionArtPlan | ProductionArtPlanV1_1;
  if (isV1_1) {
    if (!Object.prototype.hasOwnProperty.call(supplied, 'requirements')) {
      fail(
        'production-provider.invalid-metadata',
        'ProductionArtPlan 1.1 requires its AssetRequirements 1.1 source.',
      );
    }
    try {
      const confirmed = await materializeProductionArtPlanV1_1(
        supplied.plan,
        (supplied as ProductionArtProviderInputV1_1).requirements,
      );
      plan = clonePlanV1_1(confirmed);
    } catch (error) {
      if (error instanceof ProductionArtProviderError) throw error;
      fail(
        'production-provider.invalid-metadata',
        `ProductionArtPlan 1.1 source binding is invalid: ${
          error instanceof Error ? error.message : 'unknown error'
        }.`,
      );
    }
  } else {
    plan = clonePlan(supplied.plan as ProductionArtPlan);
    const planIssues = validateProductionArtPlan(plan);
    if (planIssues.length > 0) {
      fail(
        'production-provider.invalid-metadata',
        `Production art plan is invalid: ${planIssues.map(({ code }) => code).join(', ')}.`,
      );
    }
  }
  const task = plan.tasks.find(({ task_id: taskId }) => taskId === supplied.taskId);
  if (!task) fail('production-provider.unsupported-task', 'Production art task does not exist in the approved plan.');
  if (!contract.capabilities.supportedProfiles.includes(plan.profile)) {
    fail('production-provider.unsupported-profile', `${contract.id} does not support ${plan.profile}.`);
  }
  if (!contract.capabilities.supportedTaskKinds.includes(task.kind)) {
    fail('production-provider.unsupported-task', `${contract.id} does not support ${task.kind}.`);
  }
  const worldBrief = boundedText(supplied.worldBrief, 'World brief', 2_000);
  const styleBible = boundedText(supplied.styleBible, 'Style bible', 4_000);
  if (
    !Array.isArray(supplied.references)
    || supplied.references.length < 1
    || supplied.references.length > contract.capabilities.maxReferenceCount
  ) {
    fail('production-provider.invalid-metadata', 'Reference count is outside the provider capability limit.');
  }
  const references = await Promise.all(supplied.references.map((reference) =>
    bindReferenceImage(reference.descriptor, reference.readBytes())));
  const referenceIds = references.map(({ descriptor }) => descriptor.id);
  if (new Set(referenceIds).size !== referenceIds.length) {
    fail('production-provider.invalid-metadata', 'Reference ids must be unique.');
  }
  const referenceRoles = new Set(references.map(({ descriptor }) => descriptor.role));
  if (task.reference_roles.some((role) => !referenceRoles.has(role))
    || references.some(({ descriptor }) => !task.reference_roles.includes(descriptor.role))) {
    fail(
      'production-provider.invalid-metadata',
      'Runtime references must exactly cover only the roles declared by the production task.',
    );
  }
  const referenceBytes = references.reduce((sum, reference) => sum + reference.byteLength, 0);
  if (referenceBytes > contract.capabilities.maxReferenceBytes) {
    fail('production-provider.invalid-metadata', 'References exceed the provider byte limit.');
  }
  const characterIdentitySemantics = supplied.characterIdentitySemantics === undefined
    ? undefined
    : materializeCharacterIdentitySemantics(
      supplied.characterIdentitySemantics,
    );
  if (characterIdentitySemantics) {
    const characterReferenceIds = references
      .filter(({ descriptor }) => descriptor.role === 'character')
      .map(({ descriptor }) => descriptor.id);
    if (
      !task.reference_roles.includes('character')
      || characterIdentitySemantics.source_identity.source_reference_id
        !== characterReferenceIds[0]
      || characterReferenceIds.length !== 1
    ) {
      fail(
        'production-provider.invalid-metadata',
        'Character semantics must bind the task single declared character reference.',
      );
    }
  }
  validateRemoteAuthorization(supplied.remoteAuthorization, contract, task, referenceIds);
  if (contract.capabilities.requiresCredentials
    && (typeof options.credential !== 'string' || options.credential.length < 1)) {
    fail('production-provider.credentials-required', `${contract.id} requires a runtime credential.`);
  }
  const job = Object.freeze({
    plan,
    task,
    worldBrief,
    styleBible,
    ...(characterIdentitySemantics ? { characterIdentitySemantics } : {}),
    references: Object.freeze(references),
    ...(supplied.remoteAuthorization
      ? { remoteAuthorization: deepFreezeData(JSON.parse(JSON.stringify(supplied.remoteAuthorization))) }
      : {}),
  }) as ProductionArtProviderJob | ProductionArtProviderJobV1_1;
  let candidate: ProductionArtProviderCandidate;
  try {
    const generateOptions = {
      signal: options.signal,
      ...(options.credential === undefined ? {} : { credential: options.credential }),
    };
    candidate = isV1_1
      ? await (provider as ProductionArtProviderV1_1).generate(
        job as ProductionArtProviderJobV1_1,
        generateOptions,
      )
      : await (provider as ProductionArtProvider).generate(
        job as ProductionArtProviderJob,
        generateOptions,
      );
  } catch (error) {
    abortIfNeeded(options.signal);
    if (error instanceof ProductionArtProviderError) throw error;
    fail('production-provider.execution-failed', `${contract.id} failed without returning a trusted image.`);
  }
  abortIfNeeded(options.signal);
  if (!isPlainDataObject(candidate)) {
    fail('production-provider.invalid-output', 'Production art provider candidate must be a plain data object.');
  }
  const candidateNames = Object.getOwnPropertyNames(candidate);
  const candidateHasRequestId = candidateNames.includes('providerRequestId');
  requireExactDataObject(
    candidate,
    candidateHasRequestId
      ? ['sourcePngBytes', 'model', 'workflow', 'providerRequestId']
      : ['sourcePngBytes', 'model', 'workflow'],
    'Production art provider candidate',
  );
  if (
    typeof candidate.model !== 'string'
    || !MODEL_ID.test(candidate.model)
    || !['image-generation', 'image-edit', 'recorded-replay'].includes(candidate.workflow)
    || (candidate.providerRequestId !== undefined
      && (typeof candidate.providerRequestId !== 'string' || !REQUEST_ID.test(candidate.providerRequestId)))
  ) {
    fail('production-provider.invalid-output', 'Provider generation evidence is invalid.');
  }
  const dimensions = pngHeader(
    candidate.sourcePngBytes,
    contract.capabilities.maxOutputBytes,
    contract.capabilities.maxRasterDimension,
  );
  const sourceSnapshot = Uint8Array.from(candidate.sourcePngBytes);
  const result = deepFreezeData({
    provider: contract,
    plan,
    task,
    sourceReferenceIds: [...referenceIds],
    generation: {
      model: candidate.model,
      workflow: candidate.workflow,
      ...(candidate.providerRequestId === undefined ? {} : { providerRequestId: candidate.providerRequestId }),
    },
    source: {
      mediaType: 'image/png' as const,
      byteLength: sourceSnapshot.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      readBytes: () => Uint8Array.from(sourceSnapshot),
    },
  }) as TrustedProductionArtSource | TrustedProductionArtSourceV1_1;
  trustedProductionArtSources.add(result);
  return result;
}

export function assertTrustedProductionArtSource(
  value: TrustedProductionArtSource,
): asserts value is TrustedProductionArtSource {
  if (!trustedProductionArtSources.has(value as object)) {
    fail(
      'production-provider.invalid-output',
      'Production art source must come from the trusted provider runner.',
    );
  }
}
