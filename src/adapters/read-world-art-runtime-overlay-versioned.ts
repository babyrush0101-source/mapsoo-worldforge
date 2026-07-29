import JSZip from 'jszip';

import { parseStrictJsonDocument } from './import-world-spec';
import {
  readWorldArtRuntimeOverlayArchive,
  type VerifiedWorldArtRuntimeOverlayArchive,
} from './read-world-art-runtime-overlay';
import {
  readWorldArtRuntimeOverlayV1_1Archive,
  type VerifiedWorldArtRuntimeOverlayV1_1Archive,
} from './read-world-art-runtime-overlay-v1-1';

export type VerifiedVersionedWorldArtRuntimeOverlayArchive =
  | VerifiedWorldArtRuntimeOverlayArchive
  | VerifiedWorldArtRuntimeOverlayV1_1Archive;

export interface ReadVersionedWorldArtRuntimeOverlayOptions {
  readonly layout_plan?: unknown;
}

export class ReadVersionedWorldArtRuntimeOverlayError extends Error {
  constructor(
    readonly code:
      | 'world-art-runtime-overlay-versioned.invalid-archive'
      | 'world-art-runtime-overlay-versioned.ambiguous-manifest'
      | 'world-art-runtime-overlay-versioned.unsupported-version'
      | 'world-art-runtime-overlay-versioned.layout-required',
    message: string,
  ) {
    super(message);
    this.name = 'ReadVersionedWorldArtRuntimeOverlayError';
  }
}

function fail(
  code: ReadVersionedWorldArtRuntimeOverlayError['code'],
  message: string,
): never {
  throw new ReadVersionedWorldArtRuntimeOverlayError(code, message);
}

export async function readVersionedWorldArtRuntimeOverlayArchive(
  bytes: Uint8Array,
  options: ReadVersionedWorldArtRuntimeOverlayOptions = {},
): Promise<VerifiedVersionedWorldArtRuntimeOverlayArchive> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    return fail(
      'world-art-runtime-overlay-versioned.invalid-archive',
      'Runtime overlay ZIP is invalid or fails CRC verification.',
    );
  }
  const entries = Object.values(archive.files).filter(({ dir, name }) =>
    !dir && name.endsWith('/world-art-runtime-overlay.json'));
  if (entries.length !== 1) {
    fail(
      'world-art-runtime-overlay-versioned.ambiguous-manifest',
      'Runtime overlay ZIP must contain exactly one versioned manifest.',
    );
  }
  let version: unknown;
  try {
    const manifestBytes = await entries[0]!.async('uint8array');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
    const parsed = parseStrictJsonDocument(text, 'Runtime overlay manifest');
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
      throw new Error('invalid manifest');
    }
    version = (parsed.value as Record<string, unknown>).schema_version;
  } catch {
    return fail(
      'world-art-runtime-overlay-versioned.invalid-archive',
      'Runtime overlay manifest is not strict UTF-8 JSON.',
    );
  }
  if (version === '1.0.0') {
    return readWorldArtRuntimeOverlayArchive(bytes);
  }
  if (version === '1.1.0') {
    if (options.layout_plan === undefined) {
      fail(
        'world-art-runtime-overlay-versioned.layout-required',
        'Runtime overlay 1.1 requires its trusted WorldLayoutPlan.',
      );
    }
    return readWorldArtRuntimeOverlayV1_1Archive(
      bytes,
      options.layout_plan,
    );
  }
  return fail(
    'world-art-runtime-overlay-versioned.unsupported-version',
    'Runtime overlay schema version is unsupported.',
  );
}
