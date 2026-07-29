import {
  PRODUCTION_ART_TASK_KINDS,
  type ProductionArtTaskKind,
} from '../core/production-art-contract';
import {
  ProductionArtProviderError,
  type ProductionArtProvider,
  type ProductionArtProviderJob,
} from '../core/production-art-provider';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../core/asset-profile';

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const REPLAY_DOCUMENTATION_URL =
  'https://github.com/babyrush0101-source/mapsoo-worldforge/blob/main/docs/49_MODEL_BACKED_PRODUCTION_ART.md';

export interface ProductionArtReplayReferenceBinding {
  readonly id: string;
  readonly sha256: string;
}

export interface ProductionArtReplayFixture {
  readonly planId: string;
  readonly profile: WorldAssetProfile;
  readonly taskId: string;
  readonly taskKind: ProductionArtTaskKind;
  readonly references: readonly ProductionArtReplayReferenceBinding[];
  readonly sourcePngBytes: Uint8Array;
  readonly sourceSha256: string;
  readonly originalModel: string;
}

function invalidMetadata(message: string): never {
  throw new ProductionArtProviderError('production-provider.invalid-metadata', message);
}

function invalidOutput(message: string): never {
  throw new ProductionArtProviderError('production-provider.invalid-output', message);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateFixture(
  providerId: string,
  version: string,
  fixture: ProductionArtReplayFixture,
): void {
  if (
    !SAFE_ID.test(providerId)
    || providerId.length > 80
    || !VERSION.test(version)
    || !SAFE_ID.test(fixture.planId)
    || fixture.planId.length > 100
    || !WORLD_ASSET_PROFILES.includes(fixture.profile)
    || !SAFE_ID.test(fixture.taskId)
    || fixture.taskId.length > 100
    || !PRODUCTION_ART_TASK_KINDS.includes(fixture.taskKind)
    || !Array.isArray(fixture.references)
    || fixture.references.length < 1
    || fixture.references.length > 8
    || new Set(fixture.references.map(({ id }) => id)).size !== fixture.references.length
    || fixture.references.some(({ id, sha256: digest }) =>
      !SAFE_ID.test(id) || id.length > 80 || !SHA256.test(digest))
    || !(fixture.sourcePngBytes instanceof Uint8Array)
    || fixture.sourcePngBytes.byteLength < 33
    || fixture.sourcePngBytes.byteLength > 64 * 1024 * 1024
    || !SHA256.test(fixture.sourceSha256)
    || !MODEL_ID.test(fixture.originalModel)
  ) {
    invalidMetadata('Production art replay fixture metadata is invalid.');
  }
}

export function createProductionArtReplayProvider(
  providerId: string,
  version: string,
  fixture: ProductionArtReplayFixture,
): ProductionArtProvider {
  validateFixture(providerId, version, fixture);
  const sourceSnapshot = Uint8Array.from(fixture.sourcePngBytes);
  const referenceSnapshot = Object.freeze(
    fixture.references.map(({ id, sha256: digest }) => Object.freeze({ id, sha256: digest })),
  );
  return Object.freeze({
    id: providerId,
    version,
    displayName: 'Hash-bound production art source replay',
    capabilities: Object.freeze({
      execution: 'local' as const,
      determinism: 'replay' as const,
      outputProvenance: 'recorded-replay' as const,
      requiresCredentials: false,
      supportsAbort: true,
      supportedProfiles: Object.freeze([fixture.profile]),
      supportedTaskKinds: Object.freeze([fixture.taskKind]),
      maxReferenceBytes: 32 * 1024 * 1024,
      maxReferenceCount: referenceSnapshot.length,
      maxOutputBytes: 64 * 1024 * 1024,
      maxRasterDimension: 8192,
      maxRequestsPerTask: 1,
      providerDocumentationUrl: REPLAY_DOCUMENTATION_URL,
    }),
    generate: async (
      job: ProductionArtProviderJob,
      options: { readonly signal?: AbortSignal } = {},
    ) => {
      if (options.signal?.aborted) {
        throw new ProductionArtProviderError(
          'production-provider.aborted',
          'Production art source replay was aborted.',
        );
      }
      if (
        job.plan.plan_id !== fixture.planId
        || job.plan.profile !== fixture.profile
        || job.task.task_id !== fixture.taskId
        || job.task.kind !== fixture.taskKind
      ) {
        invalidOutput('Replay source is bound to a different production plan or task.');
      }
      if (
        job.references.length !== referenceSnapshot.length
        || job.references.some((reference, index) =>
          reference.descriptor.id !== referenceSnapshot[index].id
          || reference.descriptor.sha256 !== referenceSnapshot[index].sha256)
      ) {
        invalidOutput('Replay source is bound to different reference image digests.');
      }
      if (await sha256(sourceSnapshot) !== fixture.sourceSha256) {
        invalidOutput('Replay source PNG does not match its frozen SHA-256.');
      }
      return Object.freeze({
        sourcePngBytes: Uint8Array.from(sourceSnapshot),
        model: fixture.originalModel,
        workflow: 'recorded-replay' as const,
      });
    },
  });
}
