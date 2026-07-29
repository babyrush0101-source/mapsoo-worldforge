import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import { parseStrictJsonDocument } from '../adapters/import-world-spec';
import {
  fingerprintWorldDeliveryBatchRequest,
  materializeWorldDeliveryBatchRequest,
  WORLD_DELIVERY_BATCH_VERSION,
  type WorldDeliveryBatchReceipt,
} from '../core/world-delivery-batch';
import type { WorldAssetProfile } from '../core/asset-profile';
import {
  prepareWorldDeliveryWorkspace,
} from './world-delivery-workspace';

const MAX_JSON_BYTES = 4 * 1024 * 1024;

export interface PrepareWorldDeliveryBatchInput {
  readonly request: unknown;
  readonly requestRoot: string;
  readonly batchRoot: string;
  readonly provider?: 'openai' | 'spritecook';
  readonly model?: string;
  readonly resolution?: '1K' | '2K' | '4K';
  readonly quality?: 'low' | 'medium' | 'high';
  readonly requestBudget?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorCode(value: unknown): string | undefined {
  if (
    typeof value !== 'object'
    || value === null
    || !('code' in value)
    || typeof value.code !== 'string'
  ) {
    return undefined;
  }
  return value.code;
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      hash.update(typeof chunk === 'string' ? chunk : Uint8Array.from(chunk));
    });
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

async function readBoundedJson(path: string, label: string): Promise<unknown> {
  const bytes = await readFile(path);
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error(`${label} must be between 2 bytes and 4 MiB.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain strict UTF-8 JSON.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

async function resolveInside(
  rootValue: string,
  portablePath: string,
  kind: 'file' | 'directory',
  label: string,
): Promise<string> {
  const root = await realpath(resolve(rootValue));
  const candidate = await realpath(resolve(root, ...portablePath.split('/')));
  const fromRoot = relative(root, candidate);
  if (
    fromRoot.length < 1
    || fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) {
    throw new Error(`${label} must resolve inside the batch request root.`);
  }
  const metadata = await stat(candidate);
  if (
    (kind === 'file' && !metadata.isFile())
    || (kind === 'directory' && !metadata.isDirectory())
  ) {
    throw new Error(`${label} must resolve to a ${kind}.`);
  }
  return candidate;
}

function profileCounts(): Record<WorldAssetProfile, number> {
  return {
    'side-platformer': 0,
    'topdown-farm': 0,
    'isometric-action': 0,
    'layered-depth-2d': 0,
  };
}

async function existingReceipt(
  batchRoot: string,
  requestSha256: string,
  expectedWorkspaceIds: readonly string[],
): Promise<WorldDeliveryBatchReceipt | undefined> {
  try {
    const metadata = await stat(batchRoot);
    if (!metadata.isDirectory()) {
      throw new Error('Existing batch output is not a directory.');
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
  const receiptValue = await readBoundedJson(
    resolve(batchRoot, 'batch-receipt.json'),
    'Existing batch receipt',
  );
  if (
    !isRecord(receiptValue)
    || receiptValue.schema_version !== WORLD_DELIVERY_BATCH_VERSION
    || receiptValue.document_type !== 'world-delivery-batch-receipt'
    || receiptValue.request_sha256 !== requestSha256
    || !Array.isArray(receiptValue.workspaces)
    || receiptValue.workspaces.length !== expectedWorkspaceIds.length
  ) {
    throw new Error(
      'Existing batch output does not match this batch request.',
    );
  }
  const actualIds: string[] = [];
  for (const value of receiptValue.workspaces) {
    if (
      !isRecord(value)
      || typeof value.workspace_id !== 'string'
      || typeof value.path !== 'string'
      || typeof value.manifest_sha256 !== 'string'
    ) {
      throw new Error('Existing batch receipt workspace entry is invalid.');
    }
    actualIds.push(value.workspace_id);
    const expectedPath = `worlds/${value.workspace_id}`;
    if (value.path !== expectedPath) {
      throw new Error(
        `Existing workspace path is invalid: ${value.workspace_id}.`,
      );
    }
    const manifestPath = resolve(
      batchRoot,
      ...expectedPath.split('/'),
      'workspace-manifest.json',
    );
    if (await sha256File(manifestPath) !== value.manifest_sha256) {
      throw new Error(
        `Existing workspace manifest differs: ${value.workspace_id}.`,
      );
    }
  }
  if (
    actualIds.length !== expectedWorkspaceIds.length
    || actualIds.some((id, index) => id !== expectedWorkspaceIds[index])
  ) {
    throw new Error('Existing batch workspace order differs from the request.');
  }
  return receiptValue as unknown as WorldDeliveryBatchReceipt;
}

export async function prepareWorldDeliveryBatch(
  input: PrepareWorldDeliveryBatchInput,
): Promise<WorldDeliveryBatchReceipt> {
  const request = materializeWorldDeliveryBatchRequest(input.request);
  const requestSha256 =
    await fingerprintWorldDeliveryBatchRequest(request);
  const finalRoot = resolve(input.batchRoot);
  const workspaceIds = request.worlds.map(({ workspace_id }) => workspace_id);
  const existing = await existingReceipt(
    finalRoot,
    requestSha256,
    workspaceIds,
  );
  if (existing) return existing;

  const requestRoot = await realpath(resolve(input.requestRoot));
  if (!(await stat(requestRoot)).isDirectory()) {
    throw new Error('Batch request root must be a directory.');
  }
  await mkdir(dirname(finalRoot), { recursive: true });
  const stagingRoot = resolve(
    dirname(finalRoot),
    `.${basename(finalRoot)}.tmp-${randomUUID()}`,
  );
  await mkdir(resolve(stagingRoot, 'worlds'), { recursive: true });

  try {
    const counts = profileCounts();
    const workspaces: WorldDeliveryBatchReceipt['workspaces'][number][] = [];
    for (const world of request.worlds) {
      const intakePath = await resolveInside(
        requestRoot,
        world.intake_path,
        'file',
        `${world.workspace_id} intake`,
      );
      const referenceRoot = await resolveInside(
        requestRoot,
        world.reference_root,
        'directory',
        `${world.workspace_id} reference root`,
      );
      const characterIdentitySemantics =
        world.character_identity_semantics_path === undefined
          ? undefined
          : await readBoundedJson(
            await resolveInside(
              requestRoot,
              world.character_identity_semantics_path,
              'file',
              `${world.workspace_id} character identity semantics`,
            ),
            `${world.workspace_id} character identity semantics`,
          );
      const physicalWorkspace = resolve(
        stagingRoot,
        'worlds',
        world.workspace_id,
      );
      const finalWorkspace = resolve(
        finalRoot,
        'worlds',
        world.workspace_id,
      );
      const manifest = await prepareWorldDeliveryWorkspace({
        intake: await readBoundedJson(
          intakePath,
          `${world.workspace_id} confirmed intake`,
        ),
        referenceRoot,
        workspace: physicalWorkspace,
        finalWorkspacePath: finalWorkspace,
        characterId: world.character_id,
        ...(characterIdentitySemantics === undefined
          ? {}
          : { characterIdentitySemantics }),
        completedAt: request.completed_at,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.resolution === undefined
          ? {}
          : { resolution: input.resolution }),
        ...(input.quality === undefined ? {} : { quality: input.quality }),
        ...(input.requestBudget === undefined
          ? {}
          : { requestBudget: input.requestBudget }),
      });
      counts[manifest.profile] += 1;
      workspaces.push(Object.freeze({
        workspace_id: world.workspace_id,
        path: `worlds/${world.workspace_id}`,
        intake_id: manifest.intake_id,
        intake_sha256: manifest.intake_sha256,
        profile: manifest.profile,
        target: manifest.target,
        manifest_sha256: await sha256File(
          resolve(physicalWorkspace, 'workspace-manifest.json'),
        ),
        remote_request_count: 0 as const,
      }));
    }
    const receipt: WorldDeliveryBatchReceipt = Object.freeze({
      schema_version: WORLD_DELIVERY_BATCH_VERSION,
      document_type: 'world-delivery-batch-receipt' as const,
      batch_id: request.batch_id,
      request_sha256: requestSha256,
      completed_at: request.completed_at,
      world_count: workspaces.length,
      profile_counts: Object.freeze(counts),
      workspaces: Object.freeze(workspaces),
      atomic_write: true as const,
      remote_request_count: 0 as const,
      privacy: Object.freeze({
        receipt_embeds_private_inputs: false as const,
        receipt_contains_absolute_paths: false as const,
        repository_write_allowed: false as const,
      }),
    });
    await writeFile(
      resolve(stagingRoot, 'batch-receipt.json'),
      jsonBytes(receipt),
      { flag: 'wx' },
    );
    await rename(stagingRoot, finalRoot);
    return receipt;
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
