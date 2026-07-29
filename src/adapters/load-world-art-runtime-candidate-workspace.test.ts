import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import receiptSchema
  from '../../schemas/mapsoo-world-art-runtime-candidate-receipt-1.0.schema.json';
import type { WorldAssetProfile } from '../core/asset-profile';
import {
  LoadWorldArtRuntimeCandidateWorkspaceError,
  loadWorldArtRuntimeCandidateWorkspace,
} from './load-world-art-runtime-candidate-workspace';
import {
  buildWorldArtRuntimeCandidateTestFixture,
  WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER,
} from '../app/world-art-runtime-candidate.test-fixture';

const PRIVATE_MARKER = WORLD_ART_RUNTIME_CANDIDATE_TEST_PRIVATE_MARKER;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(value)}\n`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function workspace(profile: WorldAssetProfile): Promise<Readonly<{
  directory: string;
  layout: unknown;
}>> {
  const root = await mkdtemp(resolve(tmpdir(), `mapsoo-runtime-candidate-${profile}-`));
  roots.push(root);
  const directory = resolve(root, 'candidate');
  await mkdir(directory);
  const { built, layout } = await buildWorldArtRuntimeCandidateTestFixture(profile);
  await Promise.all(built.files.map((file) =>
    writeFile(resolve(directory, file.path), file.readBytes())));
  return Object.freeze({ directory, layout });
}

async function updateReceiptForArtifact(
  directory: string,
  artifactPath: string,
): Promise<void> {
  const receiptPath = resolve(directory, 'runtime-candidate-receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  const bytes = Uint8Array.from(await readFile(resolve(directory, artifactPath)));
  const artifact = receipt.artifacts.find(({ path }: { path: string }) =>
    path === artifactPath);
  artifact.bytes = bytes.byteLength;
  artifact.sha256 = await sha256(bytes);
  const identity = {
    profile: receipt.profile,
    source: receipt.source,
    rights: receipt.rights,
    artifacts: receipt.artifacts,
  };
  receipt.candidate_id = `world-art-candidate-${(
    await sha256(canonicalBytes(identity))
  ).slice(0, 16)}`;
  await writeFile(receiptPath, canonicalBytes(receipt));
}

describe('loadWorldArtRuntimeCandidateWorkspace', () => {
  it.each([
    'side-platformer',
    'topdown-farm',
    'isometric-action',
    'layered-depth-2d',
  ] as const)('loads and cross-binds the exact six artifacts for %s', async (profile) => {
    const { directory, layout } = await workspace(profile);
    const loaded = await loadWorldArtRuntimeCandidateWorkspace(directory, layout);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(receiptSchema);

    expect(validate(loaded.receipt), JSON.stringify(validate.errors)).toBe(true);
    expect(loaded.receipt.profile).toBe(profile);
    expect(loaded.artifacts).toHaveLength(6);
    expect(loaded.overlay.manifest.profile).toBe(profile);
    expect(loaded.runtime_projection.profile).toBe(profile);
    const first = loaded.overlay.readBytes();
    const replay = loaded.overlay.readBytes();
    first[0] ^= 0xff;
    expect(loaded.overlay.readBytes()).toEqual(replay);
    const artifactFirst = loaded.artifacts[0]!.readBytes();
    const artifactReplay = loaded.artifacts[0]!.readBytes();
    artifactFirst[0] ^= 0xff;
    expect(loaded.artifacts[0]!.readBytes()).toEqual(artifactReplay);
    expect(JSON.stringify(loaded)).not.toContain(directory);
  }, 30_000);

  it('rejects changed artifacts, cross-binding tampering, and corrupt overlay archives', async () => {
    const changedWorkspace = await workspace('topdown-farm');
    const changedDirectory = changedWorkspace.directory;
    const changedPath = resolve(changedDirectory, 'world-art-variant-selections.json');
    const changedBytes = Uint8Array.from(await readFile(changedPath));
    changedBytes[changedBytes.length - 2] ^= 1;
    await writeFile(changedPath, changedBytes);
    await expect(loadWorldArtRuntimeCandidateWorkspace(
      changedDirectory,
      changedWorkspace.layout,
    ))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.integrity' });

    const bindingWorkspace = await workspace('side-platformer');
    const bindingDirectory = bindingWorkspace.directory;
    const reviewPath = resolve(bindingDirectory, 'world-art-selection-review.json');
    const review = JSON.parse(await readFile(reviewPath, 'utf8'));
    review.tasks[0].artifact_sha256 = '0'.repeat(64);
    await writeFile(reviewPath, canonicalBytes(review));
    await updateReceiptForArtifact(bindingDirectory, 'world-art-selection-review.json');
    await expect(loadWorldArtRuntimeCandidateWorkspace(
      bindingDirectory,
      bindingWorkspace.layout,
    ))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.invalid-binding' });

    const overlayWorkspace = await workspace('isometric-action');
    const overlayDirectory = overlayWorkspace.directory;
    const names = await readdir(overlayDirectory);
    const overlayName = names.find((name) => name.endsWith('.zip'))!;
    const overlayPath = resolve(overlayDirectory, overlayName);
    const overlayBytes = Uint8Array.from(await readFile(overlayPath));
    await writeFile(overlayPath, overlayBytes.subarray(0, overlayBytes.length - 7));
    await updateReceiptForArtifact(overlayDirectory, overlayName);
    await expect(loadWorldArtRuntimeCandidateWorkspace(
      overlayDirectory,
      overlayWorkspace.layout,
    ))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.invalid-overlay' });
  }, 30_000);

  it('rejects extra files, symlinks, and hard-link aliases', async () => {
    const extraWorkspace = await workspace('topdown-farm');
    const extraDirectory = extraWorkspace.directory;
    await writeFile(resolve(extraDirectory, 'private.log'), 'secret');
    await expect(loadWorldArtRuntimeCandidateWorkspace(
      extraDirectory,
      extraWorkspace.layout,
    ))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.invalid-inventory' });

    const aliasWorkspace = await workspace('side-platformer');
    const aliasDirectory = aliasWorkspace.directory;
    const first = resolve(aliasDirectory, 'world-art-variant-map.json');
    const second = resolve(aliasDirectory, 'world-art-variant-selections.json');
    await unlink(second);
    await link(first, second);
    await expect(loadWorldArtRuntimeCandidateWorkspace(
      aliasDirectory,
      aliasWorkspace.layout,
    ))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.path-alias' });

    const symlinkWorkspace = await workspace('layered-depth-2d');
    const symlinkDirectory = symlinkWorkspace.directory;
    const symlinkTarget = resolve(symlinkDirectory, 'world-art-variant-map.json');
    const symlinkPath = resolve(symlinkDirectory, 'world-art-variant-selections.json');
    await unlink(symlinkPath);
    try {
      await symlink(symlinkTarget, symlinkPath, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await expect(loadWorldArtRuntimeCandidateWorkspace(
      symlinkDirectory,
      symlinkWorkspace.layout,
    ))
      .rejects.toMatchObject({ code: 'runtime-candidate-workspace.invalid-inventory' });
  }, 30_000);

  it('does not return or embed private roots, intake text, provider metadata, or credentials', async () => {
    const { directory, layout } = await workspace('layered-depth-2d');
    const loaded = await loadWorldArtRuntimeCandidateWorkspace(directory, layout);
    const json = JSON.stringify(loaded).toLowerCase();

    for (const forbidden of [
      directory,
      PRIVATE_MARKER,
      'private-input',
      'private-seed',
      'provider_request_id',
      'remote_asset_id',
      'credentials',
      'openai-request',
      'spritecook-asset',
    ]) {
      expect(json).not.toContain(forbidden.toLowerCase());
    }
    expect(loaded.receipt.remote_request_count).toBe(0);
  }, 30_000);

  it('uses stable fail-closed errors without leaking the private path', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-invalid-candidate-'));
    roots.push(root);
    const privatePath = resolve(root, 'private-missing-candidate');
    let failure: unknown;
    try {
      await loadWorldArtRuntimeCandidateWorkspace(privatePath, {});
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(LoadWorldArtRuntimeCandidateWorkspaceError);
    expect((failure as Error).message).not.toContain(privatePath);
  });
});
