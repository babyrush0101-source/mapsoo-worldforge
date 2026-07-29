import JSZip from 'jszip';

import {
  parseStrictJsonDocument,
} from './import-world-spec';
import {
  WORLD_ART_RUNTIME_OVERLAY_MANIFEST_PATH,
  materializeWorldArtRuntimeOverlay,
  serializeCanonicalWorldArtRuntimeOverlay,
  type WorldArtRuntimeOverlayManifest,
} from '../core/world-art-runtime-overlay';

export interface VerifiedWorldArtRuntimeOverlayArchive {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly manifest: WorldArtRuntimeOverlayManifest;
}

export class ReadWorldArtRuntimeOverlayError extends Error {
  constructor(
    readonly code:
      | 'world-art-runtime-overlay-read.archive'
      | 'world-art-runtime-overlay-read.inventory'
      | 'world-art-runtime-overlay-read.manifest'
      | 'world-art-runtime-overlay-read.integrity',
    message: string,
  ) {
    super(message);
    this.name = 'ReadWorldArtRuntimeOverlayError';
  }
}

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

function fail(
  code: ReadWorldArtRuntimeOverlayError['code'],
  message: string,
): never {
  throw new ReadWorldArtRuntimeOverlayError(code, message);
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

export async function readWorldArtRuntimeOverlayArchive(
  value: Uint8Array,
): Promise<VerifiedWorldArtRuntimeOverlayArchive> {
  if (
    !(value instanceof Uint8Array)
    || value.byteLength < 1
    || value.byteLength > MAX_ARCHIVE_BYTES
  ) {
    fail(
      'world-art-runtime-overlay-read.archive',
      'Runtime overlay ZIP must be between 1 byte and 256 MiB.',
    );
  }
  const bytes = Uint8Array.from(value);
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    return fail(
      'world-art-runtime-overlay-read.archive',
      'Runtime overlay ZIP is invalid or fails CRC verification.',
    );
  }
  const files = Object.values(archive.files);
  const manifestEntries = files.filter(({ dir, name }) =>
    !dir && name.endsWith(`/${WORLD_ART_RUNTIME_OVERLAY_MANIFEST_PATH}`));
  if (manifestEntries.length !== 1) {
    fail(
      'world-art-runtime-overlay-read.inventory',
      'Runtime overlay ZIP must contain exactly one canonical manifest.',
    );
  }
  let manifest: WorldArtRuntimeOverlayManifest;
  let archivedManifest: Uint8Array;
  try {
    archivedManifest = await manifestEntries[0]!.async('uint8array');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(archivedManifest);
    const parsed = parseStrictJsonDocument(text, 'Runtime overlay manifest');
    if (!parsed.ok) throw new Error(parsed.message);
    manifest = await materializeWorldArtRuntimeOverlay(parsed.value);
  } catch {
    return fail(
      'world-art-runtime-overlay-read.manifest',
      'Runtime overlay manifest is not valid canonical UTF-8 JSON.',
    );
  }
  const root = manifest.overlay_id;
  if (manifestEntries[0]!.name !== `${root}/${WORLD_ART_RUNTIME_OVERLAY_MANIFEST_PATH}`) {
    fail(
      'world-art-runtime-overlay-read.inventory',
      'Runtime overlay manifest root does not match its overlay id.',
    );
  }
  const expected = new Set([
    `${root}/${WORLD_ART_RUNTIME_OVERLAY_MANIFEST_PATH}`,
    ...manifest.files.map(({ path }) => `${root}/${path}`),
  ]);
  if (
    files.length !== expected.size
    || files.some(({ dir, name }) => dir || !expected.has(name))
  ) {
    fail(
      'world-art-runtime-overlay-read.inventory',
      'Runtime overlay ZIP inventory differs from its manifest.',
    );
  }
  const canonicalManifest = await serializeCanonicalWorldArtRuntimeOverlay(manifest);
  if (!equalBytes(archivedManifest, canonicalManifest)) {
    fail(
      'world-art-runtime-overlay-read.manifest',
      'Runtime overlay manifest bytes are not canonical.',
    );
  }
  for (const record of manifest.files) {
    const entry = archive.file(`${root}/${record.path}`);
    if (!entry) {
      fail(
        'world-art-runtime-overlay-read.inventory',
        `Runtime overlay file is missing: ${record.path}.`,
      );
    }
    const fileBytes = await entry.async('uint8array');
    if (
      fileBytes.byteLength !== record.bytes
      || await sha256(fileBytes) !== record.sha256
    ) {
      fail(
        'world-art-runtime-overlay-read.integrity',
        `Runtime overlay file changed: ${record.path}.`,
      );
    }
  }
  return Object.freeze({
    bytes,
    sha256: await sha256(bytes),
    manifest,
  });
}
