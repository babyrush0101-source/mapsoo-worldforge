import { WORLD_ASSET_PROFILES, type WorldAssetProfile } from './asset-profile';
import {
  assertCompleteTopdownFarmAssetBundle,
  type GeneratedAssetBundle,
} from './generated-asset-bundle';
import { assertCompleteSidePlatformerAssetBundle } from './side-platformer-asset-bundle';
import { assertCompleteIsometricActionAssetBundle } from './isometric-action-asset-bundle';
import { assertCompleteLayeredDepthAssetBundle } from './layered-depth-asset-bundle';
import {
  bindGenerationRequestV2,
  fingerprintGenerationRequestV2,
  type GenerationRequestJobV2,
} from './generation-request-v2';
import { materializeCharacterIdentitySignature } from './character-identity-signature';
import { materializeEnvironmentArtSignature } from './environment-art-signature';

const PROVIDER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const trustedWorldAssetRuns = new WeakSet<object>();

export interface WorldAssetProviderCapabilities {
  readonly execution: 'local' | 'remote';
  readonly determinism: 'seeded' | 'best-effort' | 'replay';
  readonly outputProvenance: 'procedural' | 'generative-ai' | 'recorded-replay';
  readonly requiresCredentials: boolean;
  readonly supportsAbort: boolean;
  readonly supportedProfiles: readonly WorldAssetProfile[];
  readonly requiredReferenceRoles: readonly ['environment-style', 'character'];
  readonly maxReferenceBytes: number;
  readonly maxOutputBytes: number;
  readonly maxRasterDimension: number;
}

export interface GeneratedAssetFile {
  readonly assetId: string;
  readonly path: string;
  readonly mediaType: 'image/png' | 'application/json';
  readonly bytes: Uint8Array;
}

export interface TrustedGeneratedAssetPayload {
  readonly assetId: string;
  readonly path: string;
  readonly mediaType: 'image/png' | 'application/json';
  readonly byteLength: number;
  readBytes(): Uint8Array;
}

export interface WorldAssetProviderOutput {
  readonly bundle: GeneratedAssetBundle;
  readonly files: readonly GeneratedAssetFile[];
}

export interface WorldAssetProvider {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: WorldAssetProviderCapabilities;
  generate(job: GenerationRequestJobV2, options?: { readonly signal?: AbortSignal }): Promise<WorldAssetProviderOutput>;
}

export interface WorldAssetProviderSnapshot {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: WorldAssetProviderCapabilities;
}

export interface WorldAssetGenerationResult {
  readonly provider: WorldAssetProviderSnapshot;
  readonly requestId: string;
  readonly requestFingerprintSha256: string;
  readonly bundle: GeneratedAssetBundle;
  readonly payloads: readonly TrustedGeneratedAssetPayload[];
}

export type WorldAssetProviderErrorCode =
  | 'world-provider.invalid-metadata'
  | 'world-provider.unsupported-profile'
  | 'world-provider.aborted'
  | 'world-provider.execution-failed'
  | 'world-provider.invalid-output';

export class WorldAssetProviderError extends Error {
  constructor(readonly code: WorldAssetProviderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorldAssetProviderError';
  }
}

function fail(code: WorldAssetProviderErrorCode, message: string, options?: ErrorOptions): never {
  throw new WorldAssetProviderError(code, message, options);
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}

function requireExactDataObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) {
    fail('world-provider.invalid-metadata', `${label} must be a plain data object.`);
  }
  const names = Object.getOwnPropertyNames(value).sort();
  const expected = [...keys].sort();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    fail('world-provider.invalid-metadata', `${label} must contain only declared fields.`);
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      fail('world-provider.invalid-metadata', `${label} must contain only enumerable data properties.`);
    }
  }
}

function snapshotProvider(provider: WorldAssetProvider): WorldAssetProviderSnapshot {
  requireExactDataObject(provider, ['id', 'version', 'displayName', 'capabilities', 'generate'], 'World asset provider');
  const capabilities = provider.capabilities;
  requireExactDataObject(capabilities, [
    'execution', 'determinism', 'outputProvenance', 'requiresCredentials', 'supportsAbort',
    'supportedProfiles', 'requiredReferenceRoles', 'maxReferenceBytes', 'maxOutputBytes', 'maxRasterDimension',
  ], 'World asset provider capabilities');
  if (
    !PROVIDER_ID.test(provider.id)
    || provider.id.length > 80
    || !VERSION.test(provider.version)
    || typeof provider.displayName !== 'string'
    || provider.displayName.trim() !== provider.displayName
    || provider.displayName.length < 1
    || provider.displayName.length > 120
    || typeof provider.generate !== 'function'
    || !capabilities
    || !['local', 'remote'].includes(capabilities.execution)
    || !['seeded', 'best-effort', 'replay'].includes(capabilities.determinism)
    || !['procedural', 'generative-ai', 'recorded-replay'].includes(capabilities.outputProvenance)
    || typeof capabilities.requiresCredentials !== 'boolean'
    || typeof capabilities.supportsAbort !== 'boolean'
    || !positiveInteger(capabilities.maxReferenceBytes, 64 * 1024 * 1024)
    || !positiveInteger(capabilities.maxOutputBytes, 512 * 1024 * 1024)
    || !positiveInteger(capabilities.maxRasterDimension, 8192)
    || !Array.isArray(capabilities.supportedProfiles)
    || capabilities.supportedProfiles.length < 1
    || new Set(capabilities.supportedProfiles).size !== capabilities.supportedProfiles.length
    || capabilities.supportedProfiles.some((profile) => !WORLD_ASSET_PROFILES.includes(profile))
    || JSON.stringify(capabilities.requiredReferenceRoles) !== '["environment-style","character"]'
  ) {
    fail('world-provider.invalid-metadata', 'World asset provider metadata or capabilities are invalid.');
  }
  return Object.freeze({
    id: provider.id,
    version: provider.version,
    displayName: provider.displayName,
    capabilities: Object.freeze({
      execution: capabilities.execution,
      determinism: capabilities.determinism,
      outputProvenance: capabilities.outputProvenance,
      requiresCredentials: capabilities.requiresCredentials,
      supportsAbort: capabilities.supportsAbort,
      supportedProfiles: Object.freeze([...capabilities.supportedProfiles]),
      requiredReferenceRoles: Object.freeze(['environment-style', 'character'] as const),
      maxReferenceBytes: capabilities.maxReferenceBytes,
      maxOutputBytes: capabilities.maxOutputBytes,
      maxRasterDimension: capabilities.maxRasterDimension,
    }),
  });
}

function abortIfNeeded(signal: AbortSignal | undefined, providerId: string): void {
  if (signal?.aborted) fail('world-provider.aborted', `Generation with ${providerId} was aborted.`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const snapshot = bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', snapshot.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validatePayloadFormat(file: GeneratedAssetFile, record: GeneratedAssetBundle['assets'][number], maximum: number): void {
  if (file.mediaType === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (file.bytes.byteLength < 24 || signature.some((byte, index) => file.bytes[index] !== byte)) {
      fail('world-provider.invalid-output', 'PNG payload has invalid magic bytes.');
    }
    const view = new DataView(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width < 1 || height < 1 || width > maximum || height > maximum || record.width !== width || record.height !== height) {
      fail('world-provider.invalid-output', 'PNG payload dimensions do not match its bundle record.');
    }
  } else {
    if (record.width !== undefined || record.height !== undefined) {
      fail('world-provider.invalid-output', 'JSON payload records cannot declare raster dimensions.');
    }
    try {
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
    } catch (error) {
      fail('world-provider.invalid-output', 'JSON payload must contain valid UTF-8 JSON.', { cause: error });
    }
  }
}

function cloneBundle(value: unknown): GeneratedAssetBundle {
  try {
    const raw = JSON.parse(JSON.stringify(value)) as GeneratedAssetBundle;
    return {
      schemaVersion: raw.schemaVersion,
      jobId: raw.jobId,
      profile: raw.profile,
      completenessPolicy: raw.completenessPolicy,
      assets: raw.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        path: asset.path,
        mediaType: asset.mediaType,
        bytes: asset.bytes,
        sha256: asset.sha256,
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
        sourceReferenceIds: [...asset.sourceReferenceIds],
      })),
      roles: raw.roles.map((role) => ({ role: role.role, assetId: role.assetId })),
      characters: raw.characters.map((character) => ({
        id: character.id,
        atlasAssetId: character.atlasAssetId,
        frameWidth: character.frameWidth,
        frameHeight: character.frameHeight,
        pivot: [character.pivot[0], character.pivot[1]],
        clips: character.clips.map((clip) => ({
          action: clip.action,
          direction: clip.direction,
          fps: clip.fps,
          frames: clip.frames.map((frame) => ({ x: frame.x, y: frame.y })),
        })),
      })),
      scene: {
        id: raw.scene.id,
        dataAssetId: raw.scene.dataAssetId,
        collisionAssetId: raw.scene.collisionAssetId,
        navigationAssetId: raw.scene.navigationAssetId,
        previewAssetId: raw.scene.previewAssetId,
        spawn: { x: raw.scene.spawn.x, y: raw.scene.spawn.y },
      },
    };
  } catch (error) {
    fail('world-provider.invalid-output', 'Provider bundle must be finite JSON data.', { cause: error });
  }
}

function deepFreezeData<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreezeData(nested);
  return Object.freeze(value);
}

async function validateAndSnapshotOutput(
  output: WorldAssetProviderOutput,
  requestId: string,
  profile: WorldAssetProfile,
  maxOutputBytes: number,
  maxRasterDimension: number,
  referenceIds: ReadonlySet<string>,
): Promise<{ bundle: GeneratedAssetBundle; payloads: readonly TrustedGeneratedAssetPayload[] }> {
  if (!output || typeof output !== 'object' || !Array.isArray(output.files)) {
    fail('world-provider.invalid-output', 'Provider output must contain a bundle and files.');
  }
  const bundle = cloneBundle(output.bundle);
  if (bundle.jobId !== requestId || bundle.profile !== profile) {
    fail('world-provider.invalid-output', 'Provider bundle does not match the requested job and profile.');
  }
  try {
    if (profile === 'topdown-farm') assertCompleteTopdownFarmAssetBundle(bundle);
    else if (profile === 'side-platformer') assertCompleteSidePlatformerAssetBundle(bundle);
    else if (profile === 'isometric-action') assertCompleteIsometricActionAssetBundle(bundle);
    else if (profile === 'layered-depth-2d') assertCompleteLayeredDepthAssetBundle(bundle);
    else fail('world-provider.unsupported-profile', `No complete asset contract is implemented for ${profile}.`);
  } catch (error) {
    if (error instanceof WorldAssetProviderError) throw error;
    fail('world-provider.invalid-output', `Provider returned an incomplete ${profile} bundle.`, { cause: error });
  }
  const records = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  if (bundle.assets.some((asset) => asset.sourceReferenceIds.some((id) => !referenceIds.has(id)))) {
    fail('world-provider.invalid-output', 'Bundle assets contain an unknown source reference id.');
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  const payloads: TrustedGeneratedAssetPayload[] = [];
  for (const file of output.files) {
    if (!file || typeof file !== 'object' || !(file.bytes instanceof Uint8Array)) {
      fail('world-provider.invalid-output', 'Every generated asset file must contain byte data.');
    }
    const record = records.get(file.assetId);
    if (!record || seen.has(file.assetId) || file.path !== record.path || file.mediaType !== record.mediaType) {
      fail('world-provider.invalid-output', 'Generated asset files must map one-to-one to bundle records.');
    }
    seen.add(file.assetId);
    validatePayloadFormat(file, record, maxRasterDimension);
    totalBytes += file.bytes.byteLength;
    if (file.bytes.byteLength !== record.bytes || totalBytes > maxOutputBytes || await sha256(file.bytes) !== record.sha256) {
      fail('world-provider.invalid-output', 'Generated asset file integrity does not match its bundle record.');
    }
    const snapshot = file.bytes.slice();
    payloads.push(Object.freeze({
      assetId: file.assetId,
      path: file.path,
      mediaType: file.mediaType,
      byteLength: snapshot.byteLength,
      readBytes: () => snapshot.slice(),
    }));
  }
  if (seen.size !== records.size) {
    fail('world-provider.invalid-output', 'Provider output is missing generated asset files.');
  }
  return Object.freeze({ bundle: deepFreezeData(bundle), payloads: Object.freeze(payloads) });
}

export async function runWorldAssetProvider(
  provider: WorldAssetProvider,
  suppliedJob: GenerationRequestJobV2,
  options: { readonly signal?: AbortSignal } = {},
): Promise<WorldAssetGenerationResult> {
  const contract = snapshotProvider(provider);
  abortIfNeeded(options.signal, contract.id);
  const reboundJob = await bindGenerationRequestV2(
    suppliedJob.request,
    suppliedJob.references.map((reference) => ({
      path: reference.descriptor.path,
      bytes: reference.readBytes(),
    })),
  );
  const characterIdentity = suppliedJob.characterIdentity
    ? await materializeCharacterIdentitySignature(suppliedJob.characterIdentity)
    : undefined;
  const environmentArt = suppliedJob.environmentArt
    ? await materializeEnvironmentArtSignature(suppliedJob.environmentArt)
    : undefined;
  const job: GenerationRequestJobV2 = Object.freeze({
    ...reboundJob,
    ...(characterIdentity ? { characterIdentity } : {}),
    ...(environmentArt ? { environmentArt } : {}),
  });
  if (!contract.capabilities.supportedProfiles.includes(job.request.profile)) {
    fail('world-provider.unsupported-profile', `${contract.id} does not support ${job.request.profile}.`);
  }
  const referenceBytes = job.references.reduce((total, reference) => total + reference.byteLength, 0);
  if (referenceBytes > contract.capabilities.maxReferenceBytes) {
    fail('world-provider.invalid-metadata', 'Bound references exceed the provider capability limit.');
  }
  let output: WorldAssetProviderOutput;
  try {
    output = await provider.generate(job, { signal: options.signal });
  } catch (error) {
    if (error instanceof WorldAssetProviderError) throw error;
    fail('world-provider.execution-failed', `Generation with ${contract.id} failed.`, { cause: error });
  }
  abortIfNeeded(options.signal, contract.id);
  const accepted = await validateAndSnapshotOutput(
    output,
    job.request.id,
    job.request.profile,
    contract.capabilities.maxOutputBytes,
    contract.capabilities.maxRasterDimension,
    new Set(job.request.references.map((reference) => reference.id)),
  );
  abortIfNeeded(options.signal, contract.id);
  const result = Object.freeze({
    provider: contract,
    requestId: job.request.id,
    requestFingerprintSha256: await fingerprintGenerationRequestV2(job.request),
    bundle: accepted.bundle,
    payloads: accepted.payloads,
  });
  trustedWorldAssetRuns.add(result);
  return result;
}

export function assertTrustedWorldAssetGeneration(value: unknown): asserts value is WorldAssetGenerationResult {
  if (typeof value !== 'object' || value === null || !trustedWorldAssetRuns.has(value)) {
    fail('world-provider.invalid-output', 'World asset generation result was not created by the trusted runner.');
  }
}

export function createTopdownFarmReplayProvider(
  id: string,
  version: string,
  fixture: WorldAssetProviderOutput,
): WorldAssetProvider {
  return Object.freeze({
    id,
    version,
    displayName: 'Top-down Farm Recorded Replay',
    capabilities: Object.freeze({
      execution: 'local' as const,
      determinism: 'replay' as const,
      outputProvenance: 'recorded-replay' as const,
      requiresCredentials: false,
      supportsAbort: true,
      supportedProfiles: Object.freeze(['topdown-farm'] as const),
      requiredReferenceRoles: Object.freeze(['environment-style', 'character'] as const),
      maxReferenceBytes: 16 * 1024 * 1024,
      maxOutputBytes: 128 * 1024 * 1024,
      maxRasterDimension: 8192,
    }),
    async generate(job: GenerationRequestJobV2, options?: { readonly signal?: AbortSignal }) {
      abortIfNeeded(options?.signal, id);
      if (fixture.bundle.jobId !== job.request.id) {
        fail('world-provider.invalid-output', 'Replay fixture is bound to a different request id.');
      }
      return fixture;
    },
  });
}

/**
 * Replays one previously materialized complete bundle only for the exact request
 * that created it. This is the narrow bridge for reviewed/imported asset packs;
 * it does not grant release approval or regenerate artwork.
 */
export function createFingerprintBoundWorldAssetReplayProvider(
  id: string,
  version: string,
  profile: WorldAssetProfile,
  fixture: WorldAssetProviderOutput,
  expectedRequestFingerprintSha256: string,
): WorldAssetProvider {
  if (!WORLD_ASSET_PROFILES.includes(profile) || !/^[a-f0-9]{64}$/.test(expectedRequestFingerprintSha256)) {
    fail('world-provider.invalid-metadata', 'Replay profile or request fingerprint is invalid.');
  }
  const bundle = deepFreezeData(cloneBundle(fixture.bundle));
  const files = Object.freeze(fixture.files.map((file) => Object.freeze({
    assetId: file.assetId,
    path: file.path,
    mediaType: file.mediaType,
    bytes: file.bytes.slice(),
  })));
  return Object.freeze({
    id,
    version,
    displayName: 'Fingerprint-bound World Asset Replay',
    capabilities: Object.freeze({
      execution: 'local' as const,
      determinism: 'replay' as const,
      outputProvenance: 'recorded-replay' as const,
      requiresCredentials: false,
      supportsAbort: true,
      supportedProfiles: Object.freeze([profile]),
      requiredReferenceRoles: Object.freeze(['environment-style', 'character'] as const),
      maxReferenceBytes: 16 * 1024 * 1024,
      maxOutputBytes: 128 * 1024 * 1024,
      maxRasterDimension: 8192,
    }),
    async generate(job: GenerationRequestJobV2, options?: { readonly signal?: AbortSignal }) {
      abortIfNeeded(options?.signal, id);
      const actualFingerprint = await fingerprintGenerationRequestV2(job.request);
      if (
        job.request.profile !== profile
        || bundle.profile !== profile
        || bundle.jobId !== job.request.id
        || actualFingerprint !== expectedRequestFingerprintSha256
      ) {
        fail('world-provider.invalid-output', 'Replay fixture is bound to a different complete generation request.');
      }
      return {
        bundle,
        files: files.map((file) => ({
          assetId: file.assetId,
          path: file.path,
          mediaType: file.mediaType,
          bytes: file.bytes.slice(),
        })),
      };
    },
  });
}
