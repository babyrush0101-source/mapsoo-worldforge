import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import evidenceSchema from '../../schemas/mapsoo-production-art-generation-evidence-1.0.schema.json';
import {
  assertValidProductionArtOutput,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../core/production-art-contract';
import {
  materializeProductionArtRunSet,
  type ProductionArtRunSet,
} from '../core/production-art-run-set';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateEvidence = ajv.compile(evidenceSchema);

export interface ProductionArtRunInventoryItem {
  readonly task: ProductionArtTask;
  readonly run_directory: string;
  readonly output: NormalizedProductionArtResult['output'];
  readonly evidence: ProductionArtGenerationEvidence;
  readonly source: NormalizedProductionArtResult['source'];
  readonly normalized: NormalizedProductionArtResult['normalized'];
}

export interface ProductionArtRunInventory {
  readonly schema_version: '1.0.0';
  readonly document_type: 'production-art-run-inventory';
  readonly plan_id: string;
  readonly profile: ProductionArtPlan['profile'];
  readonly run_set: ProductionArtRunSet;
  readonly items: readonly ProductionArtRunInventoryItem[];
  readonly providers: readonly string[];
  readonly models: readonly string[];
}

export class ProductionArtRunInventoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionArtRunInventoryError';
  }
}

function fail(code: string, message: string): never {
  throw new ProductionArtRunInventoryError(code, message);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function snapshot(bytes: Uint8Array): NormalizedProductionArtResult['source'] {
  const value = Uint8Array.from(bytes);
  return Object.freeze({
    byteLength: value.byteLength,
    readBytes: () => Uint8Array.from(value),
  });
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

async function materializeItem(
  plan: ProductionArtPlan,
  task: ProductionArtTask,
  runDirectory: string,
  result: NormalizedProductionArtResult,
): Promise<ProductionArtRunInventoryItem> {
  try {
    assertValidProductionArtOutput(result.output, plan);
  } catch {
    fail('run-inventory.invalid-output', `Production art output is invalid for ${task.task_id}.`);
  }
  if (result.output.task_id !== task.task_id) {
    fail('run-inventory.task-mismatch', `Run result does not match task ${task.task_id}.`);
  }
  if (!validateEvidence(result.evidence)) {
    fail('run-inventory.invalid-evidence', `Generation evidence is invalid for ${task.task_id}.`);
  }
  const sourceBytes = result.source.readBytes();
  const normalizedBytes = result.normalized.readBytes();
  if (
    !(sourceBytes instanceof Uint8Array)
    || !(normalizedBytes instanceof Uint8Array)
    || sourceBytes.byteLength !== result.source.byteLength
    || normalizedBytes.byteLength !== result.normalized.byteLength
  ) {
    fail('run-inventory.mutable-bytes', `Run bytes are unstable for ${task.task_id}.`);
  }
  const [sourceSha256, normalizedSha256, sourceImage, normalizedImage] = await Promise.all([
    sha256(sourceBytes),
    sha256(normalizedBytes),
    decodeReferenceImageRgba(sourceBytes, 'image/png'),
    decodeReferenceImageRgba(normalizedBytes, 'image/png'),
  ]);
  const evidence = result.evidence;
  if (
    evidence.plan_id !== plan.plan_id
    || evidence.profile !== plan.profile
    || evidence.task_id !== task.task_id
    || evidence.human_review !== 'required'
    || evidence.source.bytes !== sourceBytes.byteLength
    || evidence.source.sha256 !== sourceSha256
    || evidence.source.width !== sourceImage.width
    || evidence.source.height !== sourceImage.height
    || evidence.normalized.bytes !== normalizedBytes.byteLength
    || evidence.normalized.sha256 !== normalizedSha256
    || evidence.normalized.width !== normalizedImage.width
    || evidence.normalized.height !== normalizedImage.height
    || evidence.normalized.width !== task.target.width
    || evidence.normalized.height !== task.target.height
    || evidence.normalized.alpha_policy !== task.alpha_policy
    || result.output.bytes !== normalizedBytes.byteLength
    || result.output.sha256 !== normalizedSha256
    || result.output.width !== normalizedImage.width
    || result.output.height !== normalizedImage.height
    || result.output.rights.distribution !== plan.rights.distribution
    || result.output.rights.license !== plan.rights.license
    || result.output.rights.attribution !== plan.rights.attribution
    || !sameStringArray(
      result.output.roles,
      task.role_mappings.map(({ role }) => role),
    )
  ) {
    fail('run-inventory.integrity', `Run evidence or normalized output changed for ${task.task_id}.`);
  }
  return Object.freeze({
    task,
    run_directory: runDirectory,
    output: result.output,
    evidence,
    source: snapshot(sourceBytes),
    normalized: snapshot(normalizedBytes),
  });
}

/**
 * Turns a source-free run-set plus local frozen task results into the single
 * trusted inventory consumed by profile-specific review-pack projectors.
 */
export async function materializeProductionArtRunInventory(
  plan: ProductionArtPlan,
  runSetValue: unknown,
  results: Readonly<Record<string, NormalizedProductionArtResult>>,
): Promise<ProductionArtRunInventory> {
  const runSet = materializeProductionArtRunSet(runSetValue, plan);
  if (typeof results !== 'object' || results === null || Array.isArray(results)) {
    fail('run-inventory.invalid-results', 'Production art run results must be a task-keyed object.');
  }
  const taskIds = plan.tasks.map(({ task_id: taskId }) => taskId);
  const resultIds = Object.keys(results).sort();
  if (
    resultIds.length !== taskIds.length
    || resultIds.some((taskId, index) => taskId !== [...taskIds].sort()[index])
  ) {
    fail('run-inventory.task-inventory', 'Run results must match every canonical task exactly once.');
  }
  const items = await Promise.all(plan.tasks.map((task) =>
    materializeItem(plan, task, runSet.runs[task.task_id], results[task.task_id])));
  const requestIds = items
    .map(({ evidence }) => evidence.provider_request_id)
    .filter((value): value is string => value !== undefined);
  if (new Set(requestIds).size !== requestIds.length) {
    fail('run-inventory.request-alias', 'Remote provider request ids must be unique per task.');
  }
  return Object.freeze({
    schema_version: '1.0.0',
    document_type: 'production-art-run-inventory',
    plan_id: plan.plan_id,
    profile: plan.profile,
    run_set: runSet,
    items: Object.freeze(items),
    providers: Object.freeze([...new Set(items.map(({ evidence }) => evidence.provider.id))].sort()),
    models: Object.freeze([...new Set(items.map(({ evidence }) => evidence.model))].sort()),
  });
}
