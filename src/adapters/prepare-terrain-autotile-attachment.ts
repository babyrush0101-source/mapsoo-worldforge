import {
  assertCanonicalMetadataFreePng,
  CanonicalPngError,
} from './canonical-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type {
  TerrainAutotileAuthoringArtifact,
} from './terrain-autotile-authoring-artifact';
import type {
  PreparedWorldLayoutPackEntry,
} from '../core/world-layout-pack-binding';
import type {
  PreparedWorldMaterialPalettePackEntry,
} from '../core/world-material-palette';
import {
  prepareWorldTerrainAutotilePackEntry,
  WORLD_TERRAIN_AUTOTILE_PATH,
  type PreparedWorldTerrainAutotilePackEntry,
} from '../core/world-terrain-autotile-set';

export type TerrainAutotileAttachmentErrorCode =
  | 'terrain-authoring.invalid-artifact'
  | 'terrain-authoring.path-collision'
  | 'terrain-authoring.invalid-png'
  | 'terrain-authoring.incomplete';

export class TerrainAutotileAttachmentError extends Error {
  constructor(
    readonly code: TerrainAutotileAttachmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TerrainAutotileAttachmentError';
  }
}

export interface PreparedTerrainAutotileAttachment {
  readonly prepared: PreparedWorldTerrainAutotilePackEntry;
  readonly payloads: ReadonlyMap<string, Uint8Array>;
}

const SAFE_PATH =
  /^terrain-autotiles\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.png$/;

function fail(
  code: TerrainAutotileAttachmentErrorCode,
  message: string,
): never {
  throw new TerrainAutotileAttachmentError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const snapshot = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', snapshot.buffer);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Shared provider-neutral preparation used by every internal-review pack
 * builder. It validates bytes and coverage, but never interprets provider
 * reports, prompts, credentials, or remote response formats.
 */
export async function prepareTerrainAutotileAttachment(
  layout: PreparedWorldLayoutPackEntry,
  palette: PreparedWorldMaterialPalettePackEntry,
  expectedCell: Readonly<{ width: number; height: number }>,
  value: TerrainAutotileAuthoringArtifact,
  existingPaths: ReadonlySet<string> = new Set(),
): Promise<PreparedTerrainAutotileAttachment> {
  if (
    !isRecord(value)
    || !isRecord(value.cell)
    || !Array.isArray(value.images)
    || value.cell.width !== expectedCell.width
    || value.cell.height !== expectedCell.height
    || value.images.length !== palette.palette.entries.length
  ) {
    fail(
      'terrain-authoring.invalid-artifact',
      `Autotiles require complete ${expectedCell.width} by ${expectedCell.height} cell coverage.`,
    );
  }
  const payloads = new Map<string, Uint8Array>();
  const imageInputs: Array<Readonly<{
    material: string;
    path: string;
    sha256: string;
  }>> = [];
  for (const image of value.images) {
    if (
      !isRecord(image)
      || typeof image.material !== 'string'
      || typeof image.path !== 'string'
      || !SAFE_PATH.test(image.path)
      || !isRecord(image.png)
      || typeof image.png.byteLength !== 'number'
      || typeof image.png.readBytes !== 'function'
      || image.png.byteLength < 33
      || image.png.byteLength > 32 * 1024 * 1024
      || payloads.has(image.path)
      || existingPaths.has(image.path)
      || image.path === WORLD_TERRAIN_AUTOTILE_PATH
      || existingPaths.has(WORLD_TERRAIN_AUTOTILE_PATH)
    ) {
      fail(
        'terrain-authoring.path-collision',
        'Autotile image declaration is unsafe, duplicated, or collides with the pack.',
      );
    }
    const bytes = image.png.readBytes();
    if (
      !(bytes instanceof Uint8Array)
      || bytes.byteLength !== image.png.byteLength
    ) {
      fail(
        'terrain-authoring.invalid-png',
        `Autotile PNG bytes are unstable: ${image.path}.`,
      );
    }
    try {
      assertCanonicalMetadataFreePng(bytes);
      const decoded = await decodeReferenceImageRgba(bytes, 'image/png');
      if (
        decoded.width !== expectedCell.width * 4
        || decoded.height !== expectedCell.height * 4
      ) {
        fail(
          'terrain-authoring.invalid-png',
          `Autotile PNG has wrong 4x4 dimensions: ${image.path}.`,
        );
      }
    } catch (error) {
      if (error instanceof TerrainAutotileAttachmentError) throw error;
      const reason = error instanceof CanonicalPngError
        && error.code === 'canonical-png.metadata'
        ? 'contains metadata'
        : 'is invalid';
      fail(
        'terrain-authoring.invalid-png',
        `Autotile PNG ${reason}: ${image.path}.`,
      );
    }
    const snapshot = Uint8Array.from(bytes);
    payloads.set(image.path, snapshot);
    imageInputs.push(Object.freeze({
      material: image.material,
      path: image.path,
      sha256: await sha256(snapshot),
    }));
  }
  let prepared: PreparedWorldTerrainAutotilePackEntry;
  try {
    prepared = await prepareWorldTerrainAutotilePackEntry(
      layout,
      palette,
      expectedCell,
      imageInputs,
    );
  } catch {
    fail(
      'terrain-authoring.incomplete',
      'Autotile images do not exactly cover the material palette.',
    );
  }
  payloads.set(WORLD_TERRAIN_AUTOTILE_PATH, Uint8Array.from(prepared.bytes));
  return Object.freeze({ prepared, payloads });
}
