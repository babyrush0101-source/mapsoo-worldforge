import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  BuiltProductionWorldReview,
} from '../adapters/build-production-world-review';

export interface WrittenProductionWorldReviewWorkspace {
  readonly outputRoot: string;
  readonly files: readonly string[];
  readonly reviewPath: string;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot.length === 0
    || (
      fromRoot !== '..'
      && !fromRoot.startsWith(`..${sep}`)
      && !isAbsolute(fromRoot)
    );
}

async function writeIdenticalOrNew(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    const existing = await readFile(path).catch(() => undefined);
    if (!existing || !equalBytes(Uint8Array.from(existing), bytes)) {
      throw new Error(
        `Refusing to overwrite different existing review evidence: ${path}.`,
        { cause: error },
      );
    }
  }
}

export async function writeProductionWorldReviewWorkspace(
  built: BuiltProductionWorldReview,
  outputRootValue: string,
): Promise<WrittenProductionWorldReviewWorkspace> {
  if (
    outputRootValue.length < 1
    || outputRootValue.length > 1000
    || outputRootValue.trim() !== outputRootValue
    || /[\u0000-\u001f\u007f-\u009f]/u.test(outputRootValue)
  ) {
    throw new Error('Technical review output root is invalid.');
  }
  const outputRoot = resolve(outputRootValue);
  const entries: Readonly<{
    path: string;
    bytes: Uint8Array;
  }>[] = [];
  for (const file of built.files) {
    const path = resolve(outputRoot, ...file.path.split('/'));
    if (!inside(outputRoot, path)) {
      throw new Error('Technical review output escaped its workspace.');
    }
    const bytes = file.readBytes();
    if (
      !(bytes instanceof Uint8Array)
      || bytes.byteLength !== file.bytes
    ) {
      throw new Error('Technical review file bytes changed before writing.');
    }
    entries.push(Object.freeze({ path, bytes: Uint8Array.from(bytes) }));
  }
  if (new Set(entries.map(({ path }) => path)).size !== entries.length) {
    throw new Error('Technical review output paths must be unique.');
  }
  for (const entry of entries) {
    const existing = await readFile(entry.path).catch(() => undefined);
    if (existing && !equalBytes(Uint8Array.from(existing), entry.bytes)) {
      throw new Error(
        `Refusing to overwrite different existing review evidence: ${entry.path}.`,
      );
    }
  }
  for (const entry of entries) {
    await writeIdenticalOrNew(entry.path, entry.bytes);
  }
  const reviewPath = resolve(
    outputRoot,
    ...built.reviewFile.path.split('/'),
  );
  return Object.freeze({
    outputRoot,
    files: Object.freeze(entries.map(({ path }) => path)),
    reviewPath,
  });
}
