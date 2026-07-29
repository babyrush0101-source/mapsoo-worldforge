import JSZip from 'jszip';

import type {
  ProjectedReviewedWorldArtImage,
  ProjectedReviewedWorldArtVariants,
} from './project-reviewed-world-art-variants';
import {
  fingerprintWorldArtRuntimeProjection,
  materializeWorldArtRuntimeProjection,
  serializeCanonicalWorldArtRuntimeProjection,
} from '../core/world-art-runtime-projection';
import {
  WORLD_ART_RUNTIME_OVERLAY_MANIFEST_PATH,
  WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH,
  buildWorldArtRuntimeOverlay,
  serializeCanonicalWorldArtRuntimeOverlay,
  type WorldArtRuntimeOverlayFile,
  type WorldArtRuntimeOverlayManifest,
} from '../core/world-art-runtime-overlay';

export interface BuiltWorldArtRuntimeOverlay {
  readonly filename: string;
  readonly bytes: number;
  readonly manifest: WorldArtRuntimeOverlayManifest;
  readBytes(): Uint8Array;
}

export type BuildWorldArtRuntimeOverlayErrorCode =
  | 'world-art-runtime-overlay-build.invalid-source'
  | 'world-art-runtime-overlay-build.invalid-inventory'
  | 'world-art-runtime-overlay-build.integrity'
  | 'world-art-runtime-overlay-build.archive';

export class BuildWorldArtRuntimeOverlayError extends Error {
  constructor(
    readonly code: BuildWorldArtRuntimeOverlayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BuildWorldArtRuntimeOverlayError';
  }
}

interface ArchivePayload {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly file: WorldArtRuntimeOverlayFile;
}

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));

function fail(code: BuildWorldArtRuntimeOverlayErrorCode, message: string): never {
  throw new BuildWorldArtRuntimeOverlayError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      'world-art-runtime-overlay-build.invalid-source',
      `${label} contains unsupported or missing fields.`,
    );
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function imagePayload(
  value: ProjectedReviewedWorldArtImage,
  expected: {
    readonly task_id: string;
    readonly path: string;
    readonly media_type: 'image/png';
    readonly bytes: number;
    readonly sha256: string;
  },
  index: number,
): Promise<ArchivePayload> {
  if (!isRecord(value)) {
    fail('world-art-runtime-overlay-build.invalid-inventory', `Image ${index} is invalid.`);
  }
  exactKeys(
    value,
    ['task_id', 'path', 'media_type', 'bytes', 'sha256', 'readBytes'],
    `Image ${index}`,
  );
  if (
    value.task_id !== expected.task_id
    || value.path !== expected.path
    || value.media_type !== 'image/png'
    || value.media_type !== expected.media_type
    || value.bytes !== expected.bytes
    || value.sha256 !== expected.sha256
    || typeof value.readBytes !== 'function'
  ) {
    fail(
      'world-art-runtime-overlay-build.invalid-inventory',
      `Image ${index} does not exactly match projection.images.`,
    );
  }
  let bytes: unknown;
  try {
    bytes = value.readBytes();
  } catch {
    fail('world-art-runtime-overlay-build.integrity', `Image ${index} bytes cannot be read.`);
  }
  if (!(bytes instanceof Uint8Array)) {
    fail('world-art-runtime-overlay-build.integrity', `Image ${index} bytes are invalid.`);
  }
  const snapshot = Uint8Array.from(bytes);
  const actualSha = await sha256Bytes(snapshot);
  if (snapshot.byteLength !== expected.bytes || actualSha !== expected.sha256) {
    fail(
      'world-art-runtime-overlay-build.integrity',
      `Image ${index} bytes or SHA-256 changed after projection.`,
    );
  }
  return Object.freeze({
    path: expected.path,
    bytes: snapshot,
    file: Object.freeze({
      path: expected.path,
      media_type: 'image/png' as const,
      bytes: snapshot.byteLength,
      sha256: actualSha,
    }),
  });
}

export async function buildWorldArtRuntimeOverlayZip(
  projectedValue: ProjectedReviewedWorldArtVariants,
): Promise<BuiltWorldArtRuntimeOverlay> {
  if (!isRecord(projectedValue)) {
    fail('world-art-runtime-overlay-build.invalid-source', 'Projected variants must be an object.');
  }
  exactKeys(projectedValue, ['projection', 'images'], 'Projected variants');
  if (!Array.isArray(projectedValue.images)) {
    fail('world-art-runtime-overlay-build.invalid-inventory', 'Projected images must be an array.');
  }
  const projection = await materializeWorldArtRuntimeProjection(
    projectedValue.projection,
  ).catch((error) => fail(
    'world-art-runtime-overlay-build.invalid-source',
    `Runtime projection is invalid: ${error instanceof Error ? error.message : 'unknown error'}`,
  ));
  if (projectedValue.images.length !== projection.images.length) {
    fail(
      'world-art-runtime-overlay-build.invalid-inventory',
      'Projected images must exactly cover projection.images.',
    );
  }
  const projectionBytes = await serializeCanonicalWorldArtRuntimeProjection(projection);
  const [projectionSha, projectionFileSha, imagePayloads] = await Promise.all([
    fingerprintWorldArtRuntimeProjection(projection),
    sha256Bytes(projectionBytes),
    Promise.all(projectedValue.images.map((image, index) =>
      imagePayload(image, projection.images[index]!, index))),
  ]);
  const projectionPayload: ArchivePayload = Object.freeze({
    path: WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH,
    bytes: projectionBytes,
    file: Object.freeze({
      path: WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH,
      media_type: 'application/json' as const,
      bytes: projectionBytes.byteLength,
      sha256: projectionFileSha,
    }),
  });
  const payloads = Object.freeze([
    projectionPayload,
    ...imagePayloads,
  ].sort((left, right) => left.path.localeCompare(right.path, 'en')));
  if (new Set(payloads.map(({ path }) => path)).size !== payloads.length) {
    fail(
      'world-art-runtime-overlay-build.invalid-inventory',
      'Projection JSON and PNG paths must be unique.',
    );
  }
  const manifest = await buildWorldArtRuntimeOverlay({
    schema_version: '1.0.0',
    document_type: 'world-art-runtime-overlay',
    profile: projection.profile,
    source: Object.freeze({
      projection_id: projection.projection_id,
      projection_sha256: projectionSha,
      layout_plan_sha256: projection.source.layout_plan_sha256,
      review_record_sha256: projection.source.review_record_sha256,
    }),
    rights: projection.rights,
    review: Object.freeze({
      human_art: 'pass',
      runtime: 'pending',
      raspberry_pi: 'pending',
    }),
    projection: Object.freeze({
      path: WORLD_ART_RUNTIME_OVERLAY_PROJECTION_PATH,
      sha256: projectionFileSha,
    }),
    files: Object.freeze(payloads.map(({ file }) => file)),
    reference_policy: Object.freeze({
      embedded: false,
      original_references_excluded: true,
      raw_prompts_excluded: true,
      only_one_way_audit_hashes_retained: true,
    }),
  }).catch((error) => fail(
    'world-art-runtime-overlay-build.invalid-source',
    `Overlay manifest cannot bind the projection: ${
      error instanceof Error ? error.message : 'unknown error'
    }`,
  ));
  const manifestBytes = await serializeCanonicalWorldArtRuntimeOverlay(manifest);
  const root = manifest.overlay_id;
  const entries = [
    ...payloads.map(({ path, bytes }) => Object.freeze({
      path: `${root}/${path}`,
      bytes,
    })),
    Object.freeze({
      path: `${root}/${WORLD_ART_RUNTIME_OVERLAY_MANIFEST_PATH}`,
      bytes: manifestBytes,
    }),
  ].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const archive = new JSZip();
  for (const entry of entries) {
    archive.file(entry.path, entry.bytes, {
      binary: true,
      createFolders: false,
      date: ZIP_DATE,
      unixPermissions: 0o100644,
    });
  }
  let archiveBytes: Uint8Array;
  try {
    archiveBytes = await archive.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
      streamFiles: false,
    });
  } catch {
    fail('world-art-runtime-overlay-build.archive', 'Overlay ZIP could not be created.');
  }
  const snapshot = Uint8Array.from(archiveBytes);
  return Object.freeze({
    filename: `${manifest.overlay_id}.zip`,
    bytes: snapshot.byteLength,
    manifest,
    readBytes: () => Uint8Array.from(snapshot),
  });
}
