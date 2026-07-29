import JSZip from 'jszip';

import type {
  ProjectedReviewedWorldArtImage,
  ProjectedReviewedWorldArtVariants,
} from './project-reviewed-world-art-variants';
import {
  serializeCanonicalWorldArtPlacementMapEnvelope,
} from '../core/world-art-placement-map';
import {
  serializeCanonicalWorldArtRuntimeProjection,
} from '../core/world-art-runtime-projection';
import {
  WORLD_ART_RUNTIME_OVERLAY_V1_1_MANIFEST_PATH,
  WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH,
  WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH,
  WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH,
  buildWorldArtRuntimeOverlayV1_1,
  serializeCanonicalWorldArtRuntimeOverlayV1_1,
  type WorldArtRuntimeOverlayV1_1File,
  type WorldArtRuntimeOverlayV1_1Manifest,
} from '../core/world-art-runtime-overlay-v1-1';
import {
  serializeCanonicalWorldVisualPlacementPlan,
} from '../core/world-visual-placement-plan';
import {
  ValidateWorldArtRuntimeOverlayV1_1SourceError,
  validateWorldArtRuntimeOverlayV1_1Source,
} from './validate-world-art-runtime-overlay-v1-1';

export interface BuildWorldArtRuntimeOverlayV1_1Input {
  readonly projected: ProjectedReviewedWorldArtVariants;
  readonly layout_plan: unknown;
  readonly placement_plan: unknown;
  readonly placement_map: unknown;
}

export interface BuiltWorldArtRuntimeOverlayV1_1 {
  readonly filename: string;
  readonly bytes: number;
  readonly manifest: WorldArtRuntimeOverlayV1_1Manifest;
  readBytes(): Uint8Array;
}

export type BuildWorldArtRuntimeOverlayV1_1ErrorCode =
  | 'world-art-runtime-overlay-1.1-build.invalid-source'
  | 'world-art-runtime-overlay-1.1-build.invalid-inventory'
  | 'world-art-runtime-overlay-1.1-build.invalid-placement'
  | 'world-art-runtime-overlay-1.1-build.integrity'
  | 'world-art-runtime-overlay-1.1-build.archive';

export class BuildWorldArtRuntimeOverlayV1_1Error extends Error {
  constructor(
    readonly code: BuildWorldArtRuntimeOverlayV1_1ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BuildWorldArtRuntimeOverlayV1_1Error';
  }
}

interface ArchivePayload {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly file: WorldArtRuntimeOverlayV1_1File;
}

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));

function fail(
  code: BuildWorldArtRuntimeOverlayV1_1ErrorCode,
  message: string,
): never {
  throw new BuildWorldArtRuntimeOverlayV1_1Error(code, message);
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
      'world-art-runtime-overlay-1.1-build.invalid-source',
      `${label} contains unsupported or missing fields.`,
    );
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function jsonPayload(
  path: string,
  bytesValue: Promise<Uint8Array>,
): Promise<ArchivePayload> {
  const bytes = Uint8Array.from(await bytesValue);
  return Object.freeze({
    path,
    bytes,
    file: Object.freeze({
      path,
      media_type: 'application/json' as const,
      bytes: bytes.byteLength,
      sha256: await sha256Bytes(bytes),
    }),
  });
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
    fail(
      'world-art-runtime-overlay-1.1-build.invalid-inventory',
      `Image ${index} is invalid.`,
    );
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
      'world-art-runtime-overlay-1.1-build.invalid-inventory',
      `Image ${index} does not exactly match projection.images.`,
    );
  }
  let bytesValue: unknown;
  try {
    bytesValue = value.readBytes();
  } catch {
    fail(
      'world-art-runtime-overlay-1.1-build.integrity',
      `Image ${index} bytes cannot be read.`,
    );
  }
  if (!(bytesValue instanceof Uint8Array)) {
    fail(
      'world-art-runtime-overlay-1.1-build.integrity',
      `Image ${index} bytes are invalid.`,
    );
  }
  const bytes = Uint8Array.from(bytesValue);
  const actualSha = await sha256Bytes(bytes);
  if (bytes.byteLength !== expected.bytes || actualSha !== expected.sha256) {
    fail(
      'world-art-runtime-overlay-1.1-build.integrity',
      `Image ${index} bytes or SHA-256 changed after projection.`,
    );
  }
  return Object.freeze({
    path: expected.path,
    bytes,
    file: Object.freeze({
      path: expected.path,
      media_type: 'image/png' as const,
      bytes: bytes.byteLength,
      sha256: actualSha,
    }),
  });
}

export async function buildWorldArtRuntimeOverlayV1_1Zip(
  input: BuildWorldArtRuntimeOverlayV1_1Input,
): Promise<BuiltWorldArtRuntimeOverlayV1_1> {
  if (!isRecord(input)) {
    fail(
      'world-art-runtime-overlay-1.1-build.invalid-source',
      'Overlay 1.1 input must be an object.',
    );
  }
  exactKeys(
    input,
    ['projected', 'layout_plan', 'placement_plan', 'placement_map'],
    'Overlay 1.1 input',
  );
  if (!isRecord(input.projected)) {
    fail(
      'world-art-runtime-overlay-1.1-build.invalid-source',
      'Projected variants must be an object.',
    );
  }
  exactKeys(input.projected, ['projection', 'images'], 'Projected variants');
  if (!Array.isArray(input.projected.images)) {
    fail(
      'world-art-runtime-overlay-1.1-build.invalid-inventory',
      'Projected images must be an array.',
    );
  }
  const validated = await validateWorldArtRuntimeOverlayV1_1Source({
    projection: input.projected.projection,
    layout_plan: input.layout_plan,
    placement_plan: input.placement_plan,
    placement_map: input.placement_map,
  }).catch((error) => {
    if (
      error instanceof ValidateWorldArtRuntimeOverlayV1_1SourceError
      && error.code === 'world-art-runtime-overlay-1.1-source.invalid-placement-binding'
    ) {
      return fail(
        'world-art-runtime-overlay-1.1-build.invalid-placement',
        error.message,
      );
    }
    return fail(
      'world-art-runtime-overlay-1.1-build.invalid-source',
      error instanceof Error ? error.message : 'Overlay 1.1 source is invalid.',
    );
  });
  const {
    projection,
    layout_plan: layout,
    placement_plan: plan,
    placement_map: map,
    projection_sha256: projectionSha256,
    layout_plan_sha256: layoutSha256,
    placement_plan_sha256: planSha256,
    placement_map_sha256: mapSha256,
  } = validated;
  if (input.projected.images.length !== projection.images.length) {
    fail(
      'world-art-runtime-overlay-1.1-build.invalid-inventory',
      'Projected images must exactly cover projection.images.',
    );
  }
  const [projectionPayload, planPayload, mapPayload, imagePayloads] = await Promise.all([
    jsonPayload(
      WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH,
      serializeCanonicalWorldArtRuntimeProjection(projection),
    ),
    jsonPayload(
      WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH,
      serializeCanonicalWorldVisualPlacementPlan(plan, layout),
    ),
    jsonPayload(
      WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH,
      serializeCanonicalWorldArtPlacementMapEnvelope(map),
    ),
    Promise.all(input.projected.images.map((image, index) =>
      imagePayload(image, projection.images[index]!, index))),
  ]);
  const payloads = Object.freeze([
    projectionPayload,
    planPayload,
    mapPayload,
    ...imagePayloads,
  ].sort((left, right) => left.path.localeCompare(right.path, 'en')));
  if (new Set(payloads.map(({ path }) => path)).size !== payloads.length) {
    fail(
      'world-art-runtime-overlay-1.1-build.invalid-inventory',
      'Overlay JSON and PNG paths must be unique.',
    );
  }
  const manifest = await buildWorldArtRuntimeOverlayV1_1({
    schema_version: '1.1.0',
    document_type: 'world-art-runtime-overlay',
    profile: projection.profile,
    source: Object.freeze({
      projection_id: projection.projection_id,
      projection_sha256: projectionSha256,
      layout_plan_id: layout.plan_id,
      layout_plan_sha256: layoutSha256,
      placement_plan_id: plan.plan_id,
      placement_plan_sha256: planSha256,
      placement_map_id: map.map_id,
      placement_map_sha256: mapSha256,
      review_record_sha256: projection.source.review_record_sha256,
    }),
    rights: projection.rights,
    review: Object.freeze({
      human_art: 'pass',
      runtime: 'pending',
      raspberry_pi: 'pending',
    }),
    projection: Object.freeze({
      path: WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH,
      sha256: projectionPayload.file.sha256,
    }),
    visual_placement: Object.freeze({
      plan_path: WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH,
      plan_sha256: planPayload.file.sha256,
      map_path: WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH,
      map_sha256: mapPayload.file.sha256,
    }),
    files: Object.freeze(payloads.map(({ file }) => file)),
    reference_policy: Object.freeze({
      embedded: false,
      original_references_excluded: true,
      raw_prompts_excluded: true,
      only_one_way_audit_hashes_retained: true,
    }),
  }).catch((error) => fail(
    'world-art-runtime-overlay-1.1-build.invalid-source',
    `Overlay 1.1 manifest cannot bind its payloads: ${
      error instanceof Error ? error.message : 'unknown error'
    }`,
  ));
  const manifestBytes = await serializeCanonicalWorldArtRuntimeOverlayV1_1(manifest);
  const root = manifest.overlay_id;
  const entries = [
    ...payloads.map(({ path, bytes }) => Object.freeze({
      path: `${root}/${path}`,
      bytes,
    })),
    Object.freeze({
      path: `${root}/${WORLD_ART_RUNTIME_OVERLAY_V1_1_MANIFEST_PATH}`,
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
  } catch (error) {
    fail(
      'world-art-runtime-overlay-1.1-build.archive',
      `Overlay 1.1 ZIP generation failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
  const snapshot = Uint8Array.from(archiveBytes);
  return Object.freeze({
    filename: `${manifest.overlay_id}.zip`,
    bytes: snapshot.byteLength,
    manifest,
    readBytes: () => Uint8Array.from(snapshot),
  });
}
