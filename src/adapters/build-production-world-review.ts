import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from '../core/asset-profile';
import {
  PRODUCTION_WORLD_REVIEW_VERSION,
  assertProductionWorldReview,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from '../core/production-world-review-contract';

export interface ProductionWorldReviewSourceFile {
  readonly bytes: number;
  readBytes(): Uint8Array;
}

export interface ProductionWorldReviewBuildInput {
  readonly reviewId: string;
  readonly profile: WorldAssetProfile;
  readonly godotVersions: readonly ('4.3' | '4.7')[];
  readonly worldPreview: ProductionWorldReviewSourceFile;
  readonly renderedWorldCapture: ProductionWorldReviewSourceFile;
  readonly rolePlacementOverlay: ProductionWorldReviewSourceFile;
  readonly artCollisionOverlay: ProductionWorldReviewSourceFile;
  readonly spawnExitTraversal: ProductionWorldReviewSourceFile;
  readonly navigationTraversal: ProductionWorldReviewSourceFile;
}

export interface ProductionWorldReviewFile {
  readonly path: string;
  readonly media_type:
    | 'image/png'
    | 'video/mp4'
    | 'video/x-msvideo'
    | 'application/json';
  readonly bytes: number;
  readonly sha256: string;
  readBytes(): Uint8Array;
}

export interface BuiltProductionWorldReview {
  readonly review: ProductionWorldReviewContract;
  readonly files: readonly ProductionWorldReviewFile[];
  readonly reviewFile: ProductionWorldReviewFile;
}

export class BuildProductionWorldReviewError extends Error {
  constructor(
    readonly code:
      | 'production-world-review-build.input'
      | 'production-world-review-build.integrity'
      | 'production-world-review-build.media',
    message: string,
  ) {
    super(message);
    this.name = 'BuildProductionWorldReviewError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const PATHS = Object.freeze({
  review: 'review/production-world-review.json',
  preview: 'review-evidence/world-preview.png',
  capture: 'review-evidence/rendered-world-capture.png',
  roles: 'review-evidence/role-placement-overlay.png',
  collision: 'review-evidence/art-collision-overlay.png',
  spawnExit: 'review-evidence/spawn-exit-traversal',
  navigation: 'review-evidence/navigation-traversal',
} as const);

function fail(
  code: BuildProductionWorldReviewError['code'],
  message: string,
): never {
  throw new BuildProductionWorldReviewError(code, message);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function snapshot(
  source: ProductionWorldReviewSourceFile,
  label: string,
  maximum: number,
): Uint8Array {
  if (
    !Number.isSafeInteger(source.bytes)
    || source.bytes < 1
    || source.bytes > maximum
    || typeof source.readBytes !== 'function'
  ) {
    fail('production-world-review-build.input', `${label} metadata is invalid.`);
  }
  let value: unknown;
  try {
    value = source.readBytes();
  } catch {
    return fail(
      'production-world-review-build.integrity',
      `${label} bytes cannot be read.`,
    );
  }
  if (!(value instanceof Uint8Array) || value.byteLength !== source.bytes) {
    fail(
      'production-world-review-build.integrity',
      `${label} bytes changed after admission.`,
    );
  }
  return Uint8Array.from(value);
}

function pngDimensions(
  bytes: Uint8Array,
  label: string,
): Readonly<{ width: number; height: number }> {
  if (
    bytes.byteLength < 33
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
    || new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(8) !== 13
    || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
  ) {
    fail('production-world-review-build.media', `${label} is not a PNG with IHDR.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || width > 8192 || height < 1 || height > 8192) {
    fail(
      'production-world-review-build.media',
      `${label} PNG dimensions are outside the review boundary.`,
    );
  }
  return Object.freeze({ width, height });
}

function videoFormat(
  bytes: Uint8Array,
  label: string,
): Readonly<{
  mediaType: 'video/mp4' | 'video/x-msvideo';
  extension: 'mp4' | 'avi';
}> {
  if (bytes.byteLength < 12) {
    fail('production-world-review-build.media', `${label} video is too short.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstBoxBytes = view.getUint32(0);
  if (
    firstBoxBytes >= 12
    && firstBoxBytes <= bytes.byteLength
    && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp'
  ) {
    return Object.freeze({
      mediaType: 'video/mp4' as const,
      extension: 'mp4' as const,
    });
  }
  const riffSize = view.getUint32(4, true);
  if (
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'AVI '
    && riffSize >= 4
    && riffSize + 8 <= bytes.byteLength
  ) {
    return Object.freeze({
      mediaType: 'video/x-msvideo' as const,
      extension: 'avi' as const,
    });
  }
  return fail(
    'production-world-review-build.media',
    `${label} must be an MP4 ftyp stream or Godot-native RIFF AVI.`,
  );
}

async function file(
  path: string,
  mediaType: ProductionWorldReviewFile['media_type'],
  bytes: Uint8Array,
): Promise<ProductionWorldReviewFile> {
  const frozen = Uint8Array.from(bytes);
  return Object.freeze({
    path,
    media_type: mediaType,
    bytes: frozen.byteLength,
    sha256: await sha256(frozen),
    readBytes: () => Uint8Array.from(frozen),
  });
}

async function imageEvidence(
  evidenceId: string,
  kind: ProductionWorldEvidence['kind'],
  path: string,
  bytes: Uint8Array,
  godotVersions: readonly ('4.3' | '4.7')[],
  claim: string,
): Promise<Readonly<{
  evidence: ProductionWorldEvidence;
  file: ProductionWorldReviewFile;
}>> {
  const dimensions = pngDimensions(bytes, evidenceId);
  const artifact = await file(path, 'image/png', bytes);
  return Object.freeze({
    file: artifact,
    evidence: Object.freeze({
      evidence_id: evidenceId,
      kind,
      path,
      media_type: 'image/png',
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      claim,
      godot_versions: godotVersions,
      ...dimensions,
    }),
  });
}

async function videoEvidence(
  evidenceId: string,
  kind: ProductionWorldEvidence['kind'],
  pathWithoutExtension: string,
  bytes: Uint8Array,
  godotVersions: readonly ('4.3' | '4.7')[],
  claim: string,
): Promise<Readonly<{
  evidence: ProductionWorldEvidence;
  file: ProductionWorldReviewFile;
}>> {
  const format = videoFormat(bytes, evidenceId);
  const path = `${pathWithoutExtension}.${format.extension}`;
  const artifact = await file(path, format.mediaType, bytes);
  return Object.freeze({
    file: artifact,
    evidence: Object.freeze({
      evidence_id: evidenceId,
      kind,
      path,
      media_type: format.mediaType,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      claim,
      godot_versions: godotVersions,
    }),
  });
}

export async function buildProductionWorldReview(
  input: ProductionWorldReviewBuildInput,
): Promise<BuiltProductionWorldReview> {
  if (
    !SAFE_ID.test(input.reviewId)
    || input.reviewId.length > 100
    || !isWorldAssetProfile(input.profile)
    || input.godotVersions.length < 1
    || input.godotVersions.length > 2
    || new Set(input.godotVersions).size !== input.godotVersions.length
    || input.godotVersions.some((version) => version !== '4.3' && version !== '4.7')
  ) {
    fail(
      'production-world-review-build.input',
      'Review identity, profile, or Godot versions are invalid.',
    );
  }
  const versions = Object.freeze([...input.godotVersions]);
  const previewBytes = snapshot(
    input.worldPreview,
    'World preview',
    64 * 1024 * 1024,
  );
  const captureBytes = snapshot(
    input.renderedWorldCapture,
    'Rendered world capture',
    128 * 1024 * 1024,
  );
  const roleBytes = snapshot(
    input.rolePlacementOverlay,
    'Role placement overlay',
    128 * 1024 * 1024,
  );
  const collisionBytes = snapshot(
    input.artCollisionOverlay,
    'Art collision overlay',
    128 * 1024 * 1024,
  );
  const spawnExitBytes = snapshot(
    input.spawnExitTraversal,
    'Spawn-exit traversal',
    128 * 1024 * 1024,
  );
  const navigationBytes = snapshot(
    input.navigationTraversal,
    'Navigation traversal',
    128 * 1024 * 1024,
  );
  const previewDimensions = pngDimensions(previewBytes, 'World preview');
  const preview = await file(PATHS.preview, 'image/png', previewBytes);
  const [capture, roles, collision, spawnExit, navigation] = await Promise.all([
    imageEvidence(
      'rendered-world-capture',
      'rendered-world-capture',
      PATHS.capture,
      captureBytes,
      versions,
      'Rendered Godot world capture proving the exact candidate composition.',
    ),
    imageEvidence(
      'role-placement-overlay',
      'role-placement-overlay',
      PATHS.roles,
      roleBytes,
      versions,
      'Godot overlay proving semantic asset roles at their final placements.',
    ),
    imageEvidence(
      'art-collision-overlay',
      'art-collision-overlay',
      PATHS.collision,
      collisionBytes,
      versions,
      'Godot overlay proving visible art and gameplay collision alignment.',
    ),
    videoEvidence(
      'spawn-exit-traversal',
      'spawn-exit-traversal',
      PATHS.spawnExit,
      spawnExitBytes,
      versions,
      'Godot recording proving traversal from the declared spawn to exit.',
    ),
    videoEvidence(
      'navigation-traversal',
      'navigation-traversal',
      PATHS.navigation,
      navigationBytes,
      versions,
      'Godot recording proving the declared navigation route is traversable.',
    ),
  ]);
  const evidence = Object.freeze([
    capture.evidence,
    roles.evidence,
    collision.evidence,
    spawnExit.evidence,
    navigation.evidence,
  ]);
  const review: ProductionWorldReviewContract = Object.freeze({
    schema_version: PRODUCTION_WORLD_REVIEW_VERSION,
    review_id: input.reviewId,
    profile: input.profile,
    world_preview: Object.freeze({
      path: preview.path,
      bytes: preview.bytes,
      sha256: preview.sha256,
      ...previewDimensions,
    }),
    evidence,
    gates: Object.freeze([
      Object.freeze({
        gate: 'image-composition' as const,
        status: 'technical-pass' as const,
        evidence_ids: Object.freeze(['rendered-world-capture']),
      }),
      Object.freeze({
        gate: 'role-placement' as const,
        status: 'technical-pass' as const,
        evidence_ids: Object.freeze(['role-placement-overlay']),
      }),
      Object.freeze({
        gate: 'art-to-collision' as const,
        status: 'technical-pass' as const,
        evidence_ids: Object.freeze(['art-collision-overlay']),
      }),
      Object.freeze({
        gate: 'spawn-exit' as const,
        status: 'technical-pass' as const,
        evidence_ids: Object.freeze(['spawn-exit-traversal']),
      }),
      Object.freeze({
        gate: 'navigation' as const,
        status: 'technical-pass' as const,
        evidence_ids: Object.freeze(['navigation-traversal']),
      }),
      Object.freeze({
        gate: 'human-review' as const,
        status: 'pending' as const,
        evidence_ids: Object.freeze([]),
      }),
    ]),
    release_decision: 'blocked',
  });
  try {
    assertProductionWorldReview(review);
  } catch {
    return fail(
      'production-world-review-build.integrity',
      'Built production world review is invalid.',
    );
  }
  const reviewBytes = new TextEncoder().encode(
    `${JSON.stringify(review, null, 2)}\n`,
  );
  const reviewFile = await file(PATHS.review, 'application/json', reviewBytes);
  return Object.freeze({
    review,
    reviewFile,
    files: Object.freeze([
      preview,
      capture.file,
      roles.file,
      collision.file,
      spawnExit.file,
      navigation.file,
      reviewFile,
    ]),
  });
}
