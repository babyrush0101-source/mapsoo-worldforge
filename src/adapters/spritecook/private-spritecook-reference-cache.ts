import {
  createHmac,
  randomUUID,
} from 'node:crypto';
import {
  open,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  resolve,
} from 'node:path';

import type {
  ReferenceImageDescriptor,
} from '../../core/reference-image';
import {
  SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
  type SpriteCookReferenceAssetCache,
} from './spritecook-production-art-provider';

const CACHE_SCHEMA_VERSION = '1.0.0' as const;
const CACHE_DOCUMENT_TYPE =
  'spritecook-private-reference-cache-entry' as const;
const CACHE_KEY = /^[a-f0-9]{64}$/;
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_ENTRY_BYTES = 2_048;
const LOCK_WAIT_MILLISECONDS = 30_000;
const LOCK_POLL_MILLISECONDS = 100;

interface CacheEntry {
  readonly schema_version: typeof CACHE_SCHEMA_VERSION;
  readonly document_type: typeof CACHE_DOCUMENT_TYPE;
  readonly provider_id: typeof SPRITECOOK_PRODUCTION_ART_PROVIDER_ID;
  readonly cache_key: string;
  readonly asset_id: string;
}

interface CacheLock {
  readonly schema_version: typeof CACHE_SCHEMA_VERSION;
  readonly document_type: 'spritecook-private-reference-cache-lock';
  readonly cache_key: string;
  readonly owner_token: string;
}

export interface PrivateSpriteCookReferenceCacheOptions {
  readonly rootDirectory: string;
  readonly credential: string;
}

export class PrivateSpriteCookReferenceCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivateSpriteCookReferenceCacheError';
  }
}

function fail(message: string): never {
  throw new PrivateSpriteCookReferenceCacheError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { readonly code?: unknown }).code === code;
}

function validateAssetId(value: unknown): string {
  if (typeof value !== 'string' || !ASSET_ID.test(value)) {
    fail('Private SpriteCook cache contains an invalid asset identifier.');
  }
  return value;
}

function materializeEntry(value: unknown, expectedKey: string): CacheEntry {
  if (!isRecord(value)) {
    fail('Private SpriteCook cache entry must be a JSON object.');
  }
  const keys = Object.keys(value).sort();
  const expected = [
    'asset_id',
    'cache_key',
    'document_type',
    'provider_id',
    'schema_version',
  ];
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || value.schema_version !== CACHE_SCHEMA_VERSION
    || value.document_type !== CACHE_DOCUMENT_TYPE
    || value.provider_id !== SPRITECOOK_PRODUCTION_ART_PROVIDER_ID
    || value.cache_key !== expectedKey
    || typeof value.cache_key !== 'string'
    || !CACHE_KEY.test(value.cache_key)
  ) {
    fail('Private SpriteCook cache entry does not match its exact contract.');
  }
  return Object.freeze({
    schema_version: CACHE_SCHEMA_VERSION,
    document_type: CACHE_DOCUMENT_TYPE,
    provider_id: SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
    cache_key: expectedKey,
    asset_id: validateAssetId(value.asset_id),
  });
}

function cacheKey(
  credential: string,
  descriptor: ReferenceImageDescriptor,
): string {
  const binding = JSON.stringify({
    provider_id: SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
    role: descriptor.role,
    media_type: descriptor.mediaType,
    bytes: descriptor.byteLength,
    width: descriptor.width,
    height: descriptor.height,
    sha256: descriptor.sha256,
  });
  return createHmac('sha256', credential)
    .update(binding, 'utf8')
    .digest('hex');
}

async function ensurePrivateDirectory(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail('Private SpriteCook cache root must be a real directory.');
  }
}

async function readEntry(
  path: string,
  expectedKey: string,
): Promise<CacheEntry | undefined> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    fail('Private SpriteCook cache entry metadata could not be read.');
  }
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size < 2
    || metadata.size > MAX_ENTRY_BYTES
  ) {
    fail('Private SpriteCook cache entry is not a bounded regular file.');
  }
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    fail('Private SpriteCook cache entry could not be read.');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_ENTRY_BYTES) {
    fail('Private SpriteCook cache entry exceeded its byte budget.');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail('Private SpriteCook cache entry must contain strict JSON.');
  }
  return materializeEntry(value, expectedKey);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((accept) => {
    setTimeout(accept, milliseconds);
  });
}

async function releaseOwnedLock(
  lockPath: string,
  ownerToken: string,
): Promise<void> {
  let value: unknown;
  try {
    const text = await readFile(lockPath, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_ENTRY_BYTES) return;
    value = JSON.parse(text);
  } catch {
    return;
  }
  if (
    !isRecord(value)
    || value.document_type !== 'spritecook-private-reference-cache-lock'
    || value.owner_token !== ownerToken
  ) {
    return;
  }
  await rm(lockPath, { force: true });
}

async function publishEntry(
  root: string,
  key: string,
  assetId: string,
  ownerToken: string,
): Promise<void> {
  const entryPath = resolve(root, `${key}.json`);
  const temporaryPath = resolve(root, `${key}.${ownerToken}.tmp`);
  const entry: CacheEntry = Object.freeze({
    schema_version: CACHE_SCHEMA_VERSION,
    document_type: CACHE_DOCUMENT_TYPE,
    provider_id: SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
    cache_key: key,
    asset_id: validateAssetId(assetId),
  });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, entryPath);
  } catch {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    fail('Private SpriteCook cache entry could not be published atomically.');
  }
}

async function resolveWithLock(
  root: string,
  key: string,
  importAsset: () => Promise<string>,
): Promise<{
  readonly assetId: string;
  readonly source: 'cache' | 'import';
}> {
  const entryPath = resolve(root, `${key}.json`);
  const lockPath = resolve(root, `${key}.lock`);
  const existing = await readEntry(entryPath, key);
  if (existing) {
    return Object.freeze({
      assetId: existing.asset_id,
      source: 'cache' as const,
    });
  }

  const ownerToken = randomUUID();
  const lock: CacheLock = Object.freeze({
    schema_version: CACHE_SCHEMA_VERSION,
    document_type: 'spritecook-private-reference-cache-lock',
    cache_key: key,
    owner_token: ownerToken,
  });
  try {
    await writeFile(
      lockPath,
      `${JSON.stringify(lock, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    );
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) {
      fail('Private SpriteCook cache lock could not be created.');
    }
    const deadline = Date.now() + LOCK_WAIT_MILLISECONDS;
    while (Date.now() < deadline) {
      await delay(LOCK_POLL_MILLISECONDS);
      const completed = await readEntry(entryPath, key);
      if (completed) {
        return Object.freeze({
          assetId: completed.asset_id,
          source: 'cache' as const,
        });
      }
      try {
        await lstat(lockPath);
      } catch (lockError) {
        if (hasErrorCode(lockError, 'ENOENT')) {
          return resolveWithLock(root, key, importAsset);
        }
        fail('Private SpriteCook cache lock could not be inspected.');
      }
    }
    fail(
      'Private SpriteCook cache lock remained active; inspect the exact lock before recovery.',
    );
  }

  try {
    const assetId = validateAssetId(await importAsset());
    await publishEntry(root, key, assetId, ownerToken);
    return Object.freeze({
      assetId,
      source: 'import' as const,
    });
  } finally {
    await releaseOwnedLock(lockPath, ownerToken);
  }
}

export function createPrivateSpriteCookReferenceCache(
  options: PrivateSpriteCookReferenceCacheOptions,
): SpriteCookReferenceAssetCache {
  if (
    typeof options.rootDirectory !== 'string'
    || options.rootDirectory.length < 1
    || options.rootDirectory.length > 1_024
    || typeof options.credential !== 'string'
    || options.credential.length < 8
    || options.credential.length > 512
    || /[\u0000-\u0020\u007f-\u009f]/u.test(options.credential)
  ) {
    fail('Private SpriteCook cache configuration is invalid.');
  }
  const root = resolve(options.rootDirectory);
  const credential = options.credential;

  return Object.freeze({
    resolve: async (
      descriptor: ReferenceImageDescriptor,
      importAsset: () => Promise<string>,
    ) => {
      if (typeof importAsset !== 'function') {
        fail('Private SpriteCook cache importer is invalid.');
      }
      await ensurePrivateDirectory(root);
      const key = cacheKey(credential, descriptor);
      return resolveWithLock(root, key, importAsset);
    },
  });
}
