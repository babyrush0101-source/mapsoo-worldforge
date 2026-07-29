import JSZip from 'jszip';

import { parseStrictJsonDocument } from './import-world-spec';
import type {
  ProjectedReviewedWorldArtImage,
} from './project-reviewed-world-art-variants';
import {
  ValidateWorldArtRuntimeOverlayV1_1SourceError,
  validateWorldArtRuntimeOverlayV1_1Source,
  type ValidatedWorldArtRuntimeOverlayV1_1Source,
} from './validate-world-art-runtime-overlay-v1-1';
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
  materializeWorldArtRuntimeOverlayV1_1,
  serializeCanonicalWorldArtRuntimeOverlayV1_1,
  type WorldArtRuntimeOverlayV1_1Manifest,
} from '../core/world-art-runtime-overlay-v1-1';
import {
  serializeCanonicalWorldVisualPlacementPlan,
} from '../core/world-visual-placement-plan';

export interface VerifiedWorldArtRuntimeOverlayV1_1Archive
  extends ValidatedWorldArtRuntimeOverlayV1_1Source {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly manifest: WorldArtRuntimeOverlayV1_1Manifest;
  readonly images: readonly ProjectedReviewedWorldArtImage[];
}

export type ReadWorldArtRuntimeOverlayV1_1ErrorCode =
  | 'world-art-runtime-overlay-1.1-read.archive'
  | 'world-art-runtime-overlay-1.1-read.inventory'
  | 'world-art-runtime-overlay-1.1-read.manifest'
  | 'world-art-runtime-overlay-1.1-read.document'
  | 'world-art-runtime-overlay-1.1-read.integrity'
  | 'world-art-runtime-overlay-1.1-read.binding';

export class ReadWorldArtRuntimeOverlayV1_1Error extends Error {
  constructor(
    readonly code: ReadWorldArtRuntimeOverlayV1_1ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReadWorldArtRuntimeOverlayV1_1Error';
  }
}

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

function fail(
  code: ReadWorldArtRuntimeOverlayV1_1ErrorCode,
  message: string,
): never {
  throw new ReadWorldArtRuntimeOverlayV1_1Error(code, message);
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function parseJsonEntry(
  archive: JSZip,
  root: string,
  path: string,
  label: string,
): Promise<{ readonly value: unknown; readonly bytes: Uint8Array }> {
  const entry = archive.file(`${root}/${path}`);
  if (!entry) {
    return fail(
      'world-art-runtime-overlay-1.1-read.inventory',
      `${label} is missing from the runtime overlay.`,
    );
  }
  try {
    const bytes = await entry.async('uint8array');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = parseStrictJsonDocument(text, label);
    if (!parsed.ok) throw new Error(parsed.message);
    return Object.freeze({ value: parsed.value, bytes });
  } catch {
    return fail(
      'world-art-runtime-overlay-1.1-read.document',
      `${label} is not valid strict UTF-8 JSON.`,
    );
  }
}

export async function readWorldArtRuntimeOverlayV1_1Archive(
  value: Uint8Array,
  layoutPlan: unknown,
): Promise<VerifiedWorldArtRuntimeOverlayV1_1Archive> {
  if (
    !(value instanceof Uint8Array)
    || value.byteLength < 1
    || value.byteLength > MAX_ARCHIVE_BYTES
  ) {
    fail(
      'world-art-runtime-overlay-1.1-read.archive',
      'Runtime overlay 1.1 ZIP must be between 1 byte and 256 MiB.',
    );
  }
  const bytes = Uint8Array.from(value);
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    return fail(
      'world-art-runtime-overlay-1.1-read.archive',
      'Runtime overlay 1.1 ZIP is invalid or fails CRC verification.',
    );
  }

  const files = Object.values(archive.files);
  const manifestEntries = files.filter(({ dir, name }) =>
    !dir && name.endsWith(`/${WORLD_ART_RUNTIME_OVERLAY_V1_1_MANIFEST_PATH}`));
  if (manifestEntries.length !== 1) {
    fail(
      'world-art-runtime-overlay-1.1-read.inventory',
      'Runtime overlay 1.1 ZIP must contain exactly one canonical manifest.',
    );
  }

  let archivedManifest: Uint8Array;
  let manifest: WorldArtRuntimeOverlayV1_1Manifest;
  try {
    archivedManifest = await manifestEntries[0]!.async('uint8array');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(archivedManifest);
    const parsed = parseStrictJsonDocument(text, 'Runtime overlay 1.1 manifest');
    if (!parsed.ok) throw new Error(parsed.message);
    manifest = await materializeWorldArtRuntimeOverlayV1_1(parsed.value);
  } catch {
    return fail(
      'world-art-runtime-overlay-1.1-read.manifest',
      'Runtime overlay 1.1 manifest is not valid canonical UTF-8 JSON.',
    );
  }

  const root = manifest.overlay_id;
  if (
    manifestEntries[0]!.name
    !== `${root}/${WORLD_ART_RUNTIME_OVERLAY_V1_1_MANIFEST_PATH}`
  ) {
    fail(
      'world-art-runtime-overlay-1.1-read.inventory',
      'Runtime overlay 1.1 manifest root does not match its overlay id.',
    );
  }
  const expected = new Set([
    `${root}/${WORLD_ART_RUNTIME_OVERLAY_V1_1_MANIFEST_PATH}`,
    ...manifest.files.map(({ path }) => `${root}/${path}`),
  ]);
  if (
    files.length !== expected.size
    || files.some(({ dir, name }) => dir || !expected.has(name))
  ) {
    fail(
      'world-art-runtime-overlay-1.1-read.inventory',
      'Runtime overlay 1.1 ZIP inventory differs from its manifest.',
    );
  }
  if (!equalBytes(
    archivedManifest,
    await serializeCanonicalWorldArtRuntimeOverlayV1_1(manifest),
  )) {
    fail(
      'world-art-runtime-overlay-1.1-read.manifest',
      'Runtime overlay 1.1 manifest bytes are not canonical.',
    );
  }

  const payloadBytes = new Map<string, Uint8Array>();
  for (const record of manifest.files) {
    const entry = archive.file(`${root}/${record.path}`);
    if (!entry) {
      fail(
        'world-art-runtime-overlay-1.1-read.inventory',
        `Runtime overlay 1.1 file is missing: ${record.path}.`,
      );
    }
    const fileBytes = await entry.async('uint8array');
    if (
      fileBytes.byteLength !== record.bytes
      || await sha256(fileBytes) !== record.sha256
    ) {
      fail(
        'world-art-runtime-overlay-1.1-read.integrity',
        `Runtime overlay 1.1 file changed: ${record.path}.`,
      );
    }
    payloadBytes.set(record.path, Uint8Array.from(fileBytes));
  }

  const [projectionEntry, planEntry, mapEntry] = await Promise.all([
    parseJsonEntry(
      archive,
      root,
      WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH,
      'Runtime projection',
    ),
    parseJsonEntry(
      archive,
      root,
      WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH,
      'Visual placement plan',
    ),
    parseJsonEntry(
      archive,
      root,
      WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH,
      'Art placement map',
    ),
  ]);

  let validated: ValidatedWorldArtRuntimeOverlayV1_1Source;
  try {
    validated = await validateWorldArtRuntimeOverlayV1_1Source({
      projection: projectionEntry.value,
      layout_plan: layoutPlan,
      placement_plan: planEntry.value,
      placement_map: mapEntry.value,
    });
  } catch (error) {
    return fail(
      'world-art-runtime-overlay-1.1-read.binding',
      error instanceof ValidateWorldArtRuntimeOverlayV1_1SourceError
        ? error.message
        : 'Runtime overlay 1.1 documents are not source-bound.',
    );
  }

  const [
    canonicalProjection,
    canonicalPlan,
    canonicalMap,
  ] = await Promise.all([
    serializeCanonicalWorldArtRuntimeProjection(validated.projection),
    serializeCanonicalWorldVisualPlacementPlan(
      validated.placement_plan,
      validated.layout_plan,
    ),
    serializeCanonicalWorldArtPlacementMapEnvelope(validated.placement_map),
  ]);
  if (
    !equalBytes(projectionEntry.bytes, canonicalProjection)
    || !equalBytes(planEntry.bytes, canonicalPlan)
    || !equalBytes(mapEntry.bytes, canonicalMap)
  ) {
    fail(
      'world-art-runtime-overlay-1.1-read.document',
      'Runtime overlay 1.1 JSON payload bytes are not canonical.',
    );
  }

  if (
    manifest.profile !== validated.projection.profile
    || manifest.source.projection_id !== validated.projection.projection_id
    || manifest.source.projection_sha256 !== validated.projection_sha256
    || manifest.source.layout_plan_id !== validated.layout_plan.plan_id
    || manifest.source.layout_plan_sha256 !== validated.layout_plan_sha256
    || manifest.source.placement_plan_id !== validated.placement_plan.plan_id
    || manifest.source.placement_plan_sha256 !== validated.placement_plan_sha256
    || manifest.source.placement_map_id !== validated.placement_map.map_id
    || manifest.source.placement_map_sha256 !== validated.placement_map_sha256
    || manifest.source.review_record_sha256
      !== validated.projection.source.review_record_sha256
    || !equalJson(manifest.rights, validated.projection.rights)
  ) {
    fail(
      'world-art-runtime-overlay-1.1-read.binding',
      'Runtime overlay 1.1 manifest does not match its semantic documents.',
    );
  }

  const fileByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const imagePaths = new Set(validated.projection.images.map(({ path }) => path));
  const expectedPaths = new Set([
    WORLD_ART_RUNTIME_OVERLAY_V1_1_PROJECTION_PATH,
    WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_PLAN_PATH,
    WORLD_ART_RUNTIME_OVERLAY_V1_1_PLACEMENT_MAP_PATH,
    ...imagePaths,
  ]);
  if (
    manifest.files.length !== expectedPaths.size
    || manifest.files.some(({ path }) => !expectedPaths.has(path))
  ) {
    fail(
      'world-art-runtime-overlay-1.1-read.inventory',
      'Runtime overlay 1.1 files do not exactly cover its documents and images.',
    );
  }

  const images: ProjectedReviewedWorldArtImage[] = [];
  for (const image of validated.projection.images) {
    const record = fileByPath.get(image.path);
    const imageBytes = payloadBytes.get(image.path);
    if (
      !record
      || !imageBytes
      || record.media_type !== 'image/png'
      || record.bytes !== image.bytes
      || record.sha256 !== image.sha256
    ) {
      fail(
        'world-art-runtime-overlay-1.1-read.binding',
        `Runtime projection image does not match the overlay inventory: ${image.path}.`,
      );
    }
    const snapshot = Uint8Array.from(imageBytes);
    images.push(Object.freeze({
      task_id: image.task_id,
      path: image.path,
      media_type: 'image/png',
      bytes: snapshot.byteLength,
      sha256: image.sha256,
      readBytes: () => Uint8Array.from(snapshot),
    }));
  }

  return Object.freeze({
    bytes,
    sha256: await sha256(bytes),
    manifest,
    ...validated,
    images: Object.freeze(images),
  });
}
