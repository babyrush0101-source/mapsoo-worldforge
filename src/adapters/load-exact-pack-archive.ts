import JSZip from 'jszip';

const MANIFEST_BASENAME = 'mapsoo.manifest.json';
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 256;
const MAX_PAYLOAD_BYTES = 128 * 1024 * 1024;
const SAFE_PATH =
  /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;

export interface ExactPackFileRecord {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ExactPackArchive<TManifest> {
  readonly manifest: TManifest;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly archiveSha256: string;
  readonly root: string;
  readonly payloads: ReadonlyMap<string, Uint8Array>;
}

export class ExactPackArchiveError extends Error {
  constructor(
    readonly code:
      | 'exact-pack.invalid-archive'
      | 'exact-pack.invalid-manifest'
      | 'exact-pack.integrity',
    message: string,
  ) {
    super(message);
    this.name = 'ExactPackArchiveError';
  }
}

function fail(code: ExactPackArchiveError['code'], message: string): never {
  throw new ExactPackArchiveError(code, message);
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const snapshot = bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', snapshot.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('exact-pack.invalid-manifest', 'Pack manifest must be strict UTF-8 JSON.');
  }
}

export async function loadExactPackArchive<TManifest>(
  zipBytes: Uint8Array,
  options: Readonly<{
    locateManifestPath(names: readonly string[]): string | undefined;
    materializeManifest(value: unknown): TManifest;
    fileRecords(manifest: TManifest): readonly ExactPackFileRecord[];
  }>,
): Promise<ExactPackArchive<TManifest>> {
  if (!(zipBytes instanceof Uint8Array)
    || zipBytes.byteLength < 1
    || zipBytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail('exact-pack.invalid-archive', 'Pack ZIP size is invalid.');
  }
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(zipBytes.slice(), {
      checkCRC32: true,
      createFolders: false,
    });
  } catch {
    fail('exact-pack.invalid-archive', 'Pack ZIP cannot be decoded.');
  }
  const entries = Object.values(archive.files);
  if (
    entries.length < 2
    || entries.length > MAX_ARCHIVE_FILES
    || entries.some((entry) =>
      entry.dir
      || !SAFE_PATH.test(entry.name)
      || (entry.unsafeOriginalName ?? entry.name) !== entry.name)
  ) {
    fail('exact-pack.invalid-archive', 'Pack ZIP entry inventory is unsafe.');
  }
  const manifestPath = options.locateManifestPath(entries.map(({ name }) => name));
  if (
    manifestPath === undefined
    || !SAFE_PATH.test(manifestPath)
    || !manifestPath.endsWith(MANIFEST_BASENAME)
    || !archive.file(manifestPath)
  ) {
    fail('exact-pack.invalid-manifest', 'Pack manifest path is missing or ambiguous.');
  }
  const root = manifestPath.slice(0, -MANIFEST_BASENAME.length);
  const manifestBytes = Uint8Array.from(
    await archive.file(manifestPath)!.async('uint8array'),
  );
  let manifest: TManifest;
  try {
    manifest = options.materializeManifest(parseJson(manifestBytes));
  } catch (error) {
    if (error instanceof ExactPackArchiveError) throw error;
    fail('exact-pack.invalid-manifest', 'Pack manifest fails its declared contract.');
  }
  const records = options.fileRecords(manifest);
  const relativePaths = records.map(({ path }) => path);
  if (
    records.length < 1
    || new Set(relativePaths).size !== relativePaths.length
    || relativePaths.some((path) => !SAFE_PATH.test(path))
  ) {
    fail('exact-pack.invalid-manifest', 'Pack file records are missing, duplicated, or unsafe.');
  }
  const expectedPaths = new Set([
    manifestPath,
    ...relativePaths.map((path) => `${root}${path}`),
  ]);
  if (
    expectedPaths.size !== entries.length
    || entries.some(({ name }) => !expectedPaths.has(name))
  ) {
    fail('exact-pack.integrity', 'Pack ZIP and manifest inventories differ.');
  }
  const payloads = new Map<string, Uint8Array>();
  let totalBytes = manifestBytes.byteLength;
  for (const record of records) {
    const entry = archive.file(`${root}${record.path}`);
    if (!entry) fail('exact-pack.integrity', `Pack payload is missing: ${record.path}.`);
    const bytes = Uint8Array.from(await entry.async('uint8array'));
    totalBytes += bytes.byteLength;
    if (
      totalBytes > MAX_PAYLOAD_BYTES
      || bytes.byteLength !== record.bytes
      || await sha256Bytes(bytes) !== record.sha256
    ) {
      fail('exact-pack.integrity', `Pack payload integrity failed: ${record.path}.`);
    }
    payloads.set(record.path, bytes);
  }
  return Object.freeze({
    manifest,
    manifestBytes,
    manifestSha256: await sha256Bytes(manifestBytes),
    archiveSha256: await sha256Bytes(zipBytes),
    root,
    payloads,
  });
}
