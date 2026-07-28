import {
  lstat,
  open,
  readdir,
  realpath,
} from 'node:fs/promises';
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { parseStrictJsonDocument } from './import-world-spec';
import {
  readWorldArtRuntimeOverlayArchive,
  type VerifiedWorldArtRuntimeOverlayArchive,
} from './read-world-art-runtime-overlay';
import { isWorldAssetProfile } from '../core/asset-profile';
import type { WorldAssetProfile } from '../core/asset-profile';
import type { ProductionArtRights } from '../core/production-art-contract';
import {
  fingerprintWorldArtRuntimeProjection,
  materializeWorldArtRuntimeProjection,
  type WorldArtRuntimeProjection,
} from '../core/world-art-runtime-projection';
import type {
  ReviewedWorldArtSlotInventory,
  WorldArtAtlasCell,
  WorldArtVariantMap,
  WorldArtVariantSelection,
} from '../core/world-art-variant-map';
import type {
  WorldArtSelectionReview,
  WorldArtSelectionReviewSlot,
} from '../core/world-art-selection-review';

const RECEIPT_PATH = 'runtime-candidate-receipt.json';
const STATIC_ARTIFACT_PATHS = Object.freeze([
  'reviewed-world-art-slot-inventory.json',
  'world-art-runtime-projection.json',
  'world-art-selection-review.json',
  'world-art-variant-map.json',
  'world-art-variant-selections.json',
] as const);
const OVERLAY_PATH = /^world-art-runtime-overlay-[a-f0-9]{16}\.zip$/;
const CANDIDATE_ID = /^world-art-candidate-[a-f0-9]{16}$/;
const REVIEW_ID = /^world-art-selection-review-[a-f0-9]{16}$/;
const MAP_ID = /^world-art-variant-map-[a-f0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_ROLE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const USAGE_ORDER = Object.freeze({
  'terrain-material': 0,
  landmark: 1,
  hazard: 2,
  character: 3,
} as const);

type MutableRecord = Record<string, unknown>;

export interface WorldArtRuntimeCandidateArtifact {
  readonly path: string;
  readonly media_type: 'application/json' | 'application/zip';
  readonly bytes: number;
  readonly sha256: string;
}

export interface WorldArtRuntimeCandidateReceipt {
  readonly schema_version: '1.0.0';
  readonly document_type: 'world-art-runtime-candidate-receipt';
  readonly candidate_id: string;
  readonly profile: WorldAssetProfile;
  readonly source: Readonly<{
    layout_plan_sha256: string;
    requirements_sha256: string;
    production_art_plan_sha256: string;
    run_set_sha256: string;
    selection_review_sha256: string;
    variant_map_sha256: string;
    runtime_projection_sha256: string;
  }>;
  readonly rights: ProductionArtRights;
  readonly review: Readonly<{
    human_art: 'pass';
    runtime: 'pending';
    raspberry_pi: 'pending';
  }>;
  readonly artifacts: readonly WorldArtRuntimeCandidateArtifact[];
  readonly remote_request_count: 0;
  readonly production_ready: false;
}

export interface LoadedWorldArtRuntimeCandidateArtifact
  extends WorldArtRuntimeCandidateArtifact {
  readBytes(): Uint8Array;
}

export interface LoadedWorldArtRuntimeCandidateOverlay {
  readonly bytes: number;
  readonly sha256: string;
  readonly manifest: VerifiedWorldArtRuntimeOverlayArchive['manifest'];
  readBytes(): Uint8Array;
}

export interface LoadedWorldArtRuntimeCandidateWorkspace {
  readonly receipt: WorldArtRuntimeCandidateReceipt;
  readonly receipt_file: LoadedWorldArtRuntimeCandidateArtifact;
  readonly review: WorldArtSelectionReview & Readonly<{ review_status: 'pass' }>;
  readonly reviewed_slot_inventory: ReviewedWorldArtSlotInventory;
  readonly selections: readonly WorldArtVariantSelection[];
  readonly variant_map: WorldArtVariantMap;
  readonly runtime_projection: WorldArtRuntimeProjection;
  readonly overlay: LoadedWorldArtRuntimeCandidateOverlay;
  readonly artifacts: readonly LoadedWorldArtRuntimeCandidateArtifact[];
}

export type LoadWorldArtRuntimeCandidateWorkspaceErrorCode =
  | 'runtime-candidate-workspace.invalid-root'
  | 'runtime-candidate-workspace.invalid-inventory'
  | 'runtime-candidate-workspace.path-escape'
  | 'runtime-candidate-workspace.path-alias'
  | 'runtime-candidate-workspace.file-size'
  | 'runtime-candidate-workspace.invalid-json'
  | 'runtime-candidate-workspace.invalid-receipt'
  | 'runtime-candidate-workspace.integrity'
  | 'runtime-candidate-workspace.invalid-binding'
  | 'runtime-candidate-workspace.invalid-overlay';

export class LoadWorldArtRuntimeCandidateWorkspaceError extends Error {
  constructor(
    readonly code: LoadWorldArtRuntimeCandidateWorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LoadWorldArtRuntimeCandidateWorkspaceError';
  }
}

function fail(
  code: LoadWorldArtRuntimeCandidateWorkspaceErrorCode,
  message: string,
): never {
  throw new LoadWorldArtRuntimeCandidateWorkspaceError(code, message);
}

function isRecord(value: unknown): value is MutableRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: MutableRecord, expectedKeys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(
      'runtime-candidate-workspace.invalid-receipt',
      `${label} contains unsupported or missing fields.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('runtime-candidate-workspace.integrity', 'A candidate document is not finite.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('runtime-candidate-workspace.integrity', 'A candidate document is unsupported.');
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(value)}\n`);
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Value(value: unknown): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(canonicalJson(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function normalizedPathKey(value: string): string {
  const normalized = resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function strictlyInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot.length > 0
    && fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('runtime-candidate-workspace.invalid-receipt', `${label} is not SHA-256.`);
  }
  return value;
}

function safeId(value: unknown, label: string, maximum = 160): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || !SAFE_ID.test(value)
  ) {
    fail('runtime-candidate-workspace.invalid-receipt', `${label} is invalid.`);
  }
  return value;
}

function safePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.includes('\\')
    || value.startsWith('/')
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    fail('runtime-candidate-workspace.invalid-receipt', `${label} is not portable.`);
  }
  return value;
}

function safeRole(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 120 || !SAFE_ROLE.test(value)) {
    fail('runtime-candidate-workspace.invalid-binding', `${label} is invalid.`);
  }
  return value;
}

function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = 268435456,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('runtime-candidate-workspace.invalid-receipt', `${label} is invalid.`);
  }
  return value as number;
}

function materializeRights(value: unknown): ProductionArtRights {
  if (!isRecord(value)) {
    fail('runtime-candidate-workspace.invalid-receipt', 'Candidate rights must be an object.');
  }
  exactKeys(
    value,
    value.attribution === undefined
      ? ['distribution', 'license']
      : ['distribution', 'license', 'attribution'],
    'Candidate rights',
  );
  if (
    !['private', 'internal-review', 'public'].includes(String(value.distribution))
    || !['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'LicenseRef-Proprietary']
      .includes(String(value.license))
    || (value.distribution === 'public' && value.license === 'LicenseRef-Proprietary')
    || (['CC-BY-4.0', 'CC-BY-SA-4.0'].includes(String(value.license))
      && value.attribution === undefined)
    || (value.attribution !== undefined && (
      typeof value.attribution !== 'string'
      || value.attribution.trim() !== value.attribution
      || value.attribution.length < 1
      || value.attribution.length > 500
    ))
  ) {
    fail('runtime-candidate-workspace.invalid-receipt', 'Candidate rights are invalid.');
  }
  return Object.freeze({
    distribution: value.distribution as ProductionArtRights['distribution'],
    license: value.license as ProductionArtRights['license'],
    ...(value.attribution === undefined ? {} : { attribution: value.attribution as string }),
  });
}

function materializeArtifact(
  value: unknown,
  index: number,
): WorldArtRuntimeCandidateArtifact {
  if (!isRecord(value)) {
    fail('runtime-candidate-workspace.invalid-receipt', `Artifact ${index} must be an object.`);
  }
  exactKeys(value, ['path', 'media_type', 'bytes', 'sha256'], `Artifact ${index}`);
  const path = safePath(value.path, `Artifact ${index} path`);
  if (
    !['application/json', 'application/zip'].includes(String(value.media_type))
    || (value.media_type === 'application/json' && !path.endsWith('.json'))
    || (value.media_type === 'application/zip' && !OVERLAY_PATH.test(path))
  ) {
    fail('runtime-candidate-workspace.invalid-receipt', `Artifact ${index} type is invalid.`);
  }
  return Object.freeze({
    path,
    media_type: value.media_type as WorldArtRuntimeCandidateArtifact['media_type'],
    bytes: integer(value.bytes, `Artifact ${index} bytes`, 1),
    sha256: digest(value.sha256, `Artifact ${index} digest`),
  });
}

export async function materializeWorldArtRuntimeCandidateReceipt(
  value: unknown,
): Promise<WorldArtRuntimeCandidateReceipt> {
  if (!isRecord(value)) {
    fail('runtime-candidate-workspace.invalid-receipt', 'Candidate receipt must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'candidate_id',
    'profile',
    'source',
    'rights',
    'review',
    'artifacts',
    'remote_request_count',
    'production_ready',
  ], 'Candidate receipt');
  if (
    value.schema_version !== '1.0.0'
    || value.document_type !== 'world-art-runtime-candidate-receipt'
    || typeof value.candidate_id !== 'string'
    || !CANDIDATE_ID.test(value.candidate_id)
    || !isWorldAssetProfile(value.profile)
    || !isRecord(value.source)
    || !isRecord(value.review)
    || !Array.isArray(value.artifacts)
    || value.artifacts.length !== 6
    || value.remote_request_count !== 0
    || value.production_ready !== false
  ) {
    fail('runtime-candidate-workspace.invalid-receipt', 'Candidate receipt identity is invalid.');
  }
  exactKeys(value.source, [
    'layout_plan_sha256',
    'requirements_sha256',
    'production_art_plan_sha256',
    'run_set_sha256',
    'selection_review_sha256',
    'variant_map_sha256',
    'runtime_projection_sha256',
  ], 'Candidate source');
  const source = Object.freeze({
    layout_plan_sha256: digest(value.source.layout_plan_sha256, 'Layout digest'),
    requirements_sha256: digest(value.source.requirements_sha256, 'Requirements digest'),
    production_art_plan_sha256: digest(
      value.source.production_art_plan_sha256,
      'Production plan digest',
    ),
    run_set_sha256: digest(value.source.run_set_sha256, 'Run-set digest'),
    selection_review_sha256: digest(
      value.source.selection_review_sha256,
      'Selection review digest',
    ),
    variant_map_sha256: digest(value.source.variant_map_sha256, 'Variant map digest'),
    runtime_projection_sha256: digest(
      value.source.runtime_projection_sha256,
      'Runtime projection digest',
    ),
  });
  exactKeys(value.review, ['human_art', 'runtime', 'raspberry_pi'], 'Candidate review');
  if (
    value.review.human_art !== 'pass'
    || value.review.runtime !== 'pending'
    || value.review.raspberry_pi !== 'pending'
  ) {
    fail('runtime-candidate-workspace.invalid-receipt', 'Candidate review gates are invalid.');
  }
  const artifacts = Object.freeze(value.artifacts.map(materializeArtifact));
  if (
    artifacts.some((artifact, index) =>
      index > 0 && artifacts[index - 1]!.path.localeCompare(artifact.path, 'en') >= 0)
    || new Set(artifacts.map(({ path }) => path)).size !== artifacts.length
    || STATIC_ARTIFACT_PATHS.some((path) =>
      !artifacts.some((artifact) =>
        artifact.path === path && artifact.media_type === 'application/json'))
    || artifacts.filter(({ media_type }) => media_type === 'application/zip').length !== 1
  ) {
    fail(
      'runtime-candidate-workspace.invalid-receipt',
      'Candidate artifacts must be the canonical six-file inventory.',
    );
  }
  const rights = materializeRights(value.rights);
  const receipt = Object.freeze({
    schema_version: '1.0.0' as const,
    document_type: 'world-art-runtime-candidate-receipt' as const,
    candidate_id: value.candidate_id,
    profile: value.profile,
    source,
    rights,
    review: Object.freeze({
      human_art: 'pass' as const,
      runtime: 'pending' as const,
      raspberry_pi: 'pending' as const,
    }),
    artifacts,
    remote_request_count: 0 as const,
    production_ready: false as const,
  });
  const identity = Object.freeze({
    profile: receipt.profile,
    source: receipt.source,
    rights: receipt.rights,
    artifacts: receipt.artifacts,
  });
  const expectedId = `world-art-candidate-${(
    await sha256Bytes(canonicalBytes(identity))
  ).slice(0, 16)}`;
  if (receipt.candidate_id !== expectedId) {
    fail('runtime-candidate-workspace.invalid-receipt', 'Candidate id is stale.');
  }
  return receipt;
}

function parseCanonicalJson(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('runtime-candidate-workspace.invalid-json', `${label} is not UTF-8 JSON.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) {
    fail('runtime-candidate-workspace.invalid-json', `${label} is not strict JSON.`);
  }
  if (!equalBytes(bytes, canonicalBytes(parsed.value))) {
    fail('runtime-candidate-workspace.invalid-json', `${label} is not canonical JSON.`);
  }
  return parsed.value;
}

function materializeCell(value: unknown, label: string): WorldArtAtlasCell {
  if (!isRecord(value)) {
    fail('runtime-candidate-workspace.invalid-binding', `${label} must be an object.`);
  }
  exactKeys(value, ['column', 'row', 'column_span', 'row_span'], label);
  return Object.freeze({
    column: integer(value.column, `${label} column`, 0, 255),
    row: integer(value.row, `${label} row`, 0, 255),
    column_span: integer(value.column_span, `${label} column span`, 1, 256),
    row_span: integer(value.row_span, `${label} row span`, 1, 256),
  });
}

function materializeReview(value: unknown): WorldArtSelectionReview & {
  readonly review_status: 'pass';
} {
  if (!isRecord(value)) {
    fail('runtime-candidate-workspace.invalid-binding', 'Selection review must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'review_id',
    'profile',
    'review_status',
    'source',
    'rights',
    'declarations',
    'tasks',
    'selections',
  ], 'Selection review');
  if (
    value.schema_version !== '1.0.0'
    || value.document_type !== 'world-art-selection-review'
    || typeof value.review_id !== 'string'
    || !REVIEW_ID.test(value.review_id)
    || !isWorldAssetProfile(value.profile)
    || value.review_status !== 'pass'
    || !isRecord(value.source)
    || !isRecord(value.declarations)
    || !Array.isArray(value.tasks)
    || value.tasks.length < 1
    || !Array.isArray(value.selections)
    || value.selections.length < 1
  ) {
    fail('runtime-candidate-workspace.invalid-binding', 'Selection review identity is invalid.');
  }
  exactKeys(value.source, [
    'layout_plan_id',
    'layout_plan_sha256',
    'requirements_id',
    'requirements_sha256',
    'production_art_plan_id',
    'production_art_plan_sha256',
    'run_set_sha256',
  ], 'Selection review source');
  const source = Object.freeze({
    layout_plan_id: safeId(value.source.layout_plan_id, 'Layout plan id', 100),
    layout_plan_sha256: digest(value.source.layout_plan_sha256, 'Layout digest'),
    requirements_id: safeId(value.source.requirements_id, 'Requirements id', 100),
    requirements_sha256: digest(value.source.requirements_sha256, 'Requirements digest'),
    production_art_plan_id: safeId(
      value.source.production_art_plan_id,
      'Production plan id',
      100,
    ),
    production_art_plan_sha256: digest(
      value.source.production_art_plan_sha256,
      'Production plan digest',
    ),
    run_set_sha256: digest(value.source.run_set_sha256, 'Run-set digest'),
  });
  exactKeys(value.declarations, [
    'visual_quality_approved',
    'atlas_integrity_approved',
    'rights_and_redistribution_approved',
  ], 'Selection review declarations');
  if (
    value.declarations.visual_quality_approved !== true
    || value.declarations.atlas_integrity_approved !== true
    || value.declarations.rights_and_redistribution_approved !== true
  ) {
    fail('runtime-candidate-workspace.invalid-binding', 'Selection review is not fully approved.');
  }
  const tasks = Object.freeze(value.tasks.map((taskValue, taskIndex) => {
    if (!isRecord(taskValue)) {
      fail('runtime-candidate-workspace.invalid-binding', `Review task ${taskIndex} is invalid.`);
    }
    exactKeys(taskValue, [
      'task_id',
      'output_path',
      'artifact_sha256',
      'output_sha256',
      'slots',
    ], `Review task ${taskIndex}`);
    if (!Array.isArray(taskValue.slots)) {
      fail('runtime-candidate-workspace.invalid-binding', `Review task ${taskIndex} slots are invalid.`);
    }
    const slots = Object.freeze(taskValue.slots.map((slotValue, slotIndex) => {
      if (!isRecord(slotValue)) {
        fail('runtime-candidate-workspace.invalid-binding', `Review slot ${slotIndex} is invalid.`);
      }
      exactKeys(slotValue, [
        'slot_id',
        'requirement_id',
        'role',
        'variant_id',
        'atlas_cell',
        'decision',
      ], `Review slot ${slotIndex}`);
      if (slotValue.decision !== 'approved') {
        fail('runtime-candidate-workspace.invalid-binding', `Review slot ${slotIndex} is not approved.`);
      }
      return Object.freeze({
        slot_id: safeId(slotValue.slot_id, `Review slot ${slotIndex} id`),
        requirement_id: safeId(
          slotValue.requirement_id,
          `Review slot ${slotIndex} requirement`,
        ),
        role: safeRole(slotValue.role, `Review slot ${slotIndex} role`),
        variant_id: safeId(slotValue.variant_id, `Review slot ${slotIndex} variant`),
        atlas_cell: materializeCell(slotValue.atlas_cell, `Review slot ${slotIndex} cell`),
        decision: 'approved' as const,
      });
    }));
    if (slots.some((slot, index) =>
      index > 0 && slots[index - 1]!.slot_id.localeCompare(slot.slot_id, 'en') >= 0)) {
      fail('runtime-candidate-workspace.invalid-binding', 'Review slots are not canonical.');
    }
    return Object.freeze({
      task_id: safeId(taskValue.task_id, `Review task ${taskIndex} id`),
      output_path: safePath(taskValue.output_path, `Review task ${taskIndex} path`),
      artifact_sha256: digest(taskValue.artifact_sha256, `Review task ${taskIndex} artifact`),
      output_sha256: digest(taskValue.output_sha256, `Review task ${taskIndex} output`),
      slots,
    });
  }));
  if (tasks.some((task, index) =>
    index > 0 && tasks[index - 1]!.task_id.localeCompare(task.task_id, 'en') >= 0)) {
    fail('runtime-candidate-workspace.invalid-binding', 'Review tasks are not canonical.');
  }
  const selections = materializeSelections(value.selections);
  const review = Object.freeze({
    schema_version: '1.0.0' as const,
    document_type: 'world-art-selection-review' as const,
    review_id: value.review_id,
    profile: value.profile,
    review_status: 'pass' as const,
    source,
    rights: materializeRights(value.rights),
    declarations: Object.freeze({
      visual_quality_approved: true,
      atlas_integrity_approved: true,
      rights_and_redistribution_approved: true,
    }),
    tasks,
    selections,
  });
  return review;
}

function compareSelections(
  left: WorldArtVariantSelection,
  right: WorldArtVariantSelection,
): number {
  return USAGE_ORDER[left.usage_kind] - USAGE_ORDER[right.usage_kind]
    || left.usage_id.localeCompare(right.usage_id, 'en')
    || left.slot_id.localeCompare(right.slot_id, 'en');
}

function materializeSelections(value: unknown): readonly WorldArtVariantSelection[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2048) {
    fail('runtime-candidate-workspace.invalid-binding', 'Variant selections are invalid.');
  }
  const selections = Object.freeze(value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('runtime-candidate-workspace.invalid-binding', `Selection ${index} is invalid.`);
    }
    exactKeys(candidate, ['usage_kind', 'usage_id', 'slot_id'], `Selection ${index}`);
    if (!['terrain-material', 'hazard', 'character'].includes(String(candidate.usage_kind))) {
      fail('runtime-candidate-workspace.invalid-binding', `Selection ${index} kind is invalid.`);
    }
    return Object.freeze({
      usage_kind: candidate.usage_kind as WorldArtVariantSelection['usage_kind'],
      usage_id: safeId(candidate.usage_id, `Selection ${index} usage`),
      slot_id: safeId(candidate.slot_id, `Selection ${index} slot`),
    });
  }));
  if (selections.some((selection, index) =>
    index > 0 && compareSelections(selections[index - 1]!, selection) >= 0)) {
    fail('runtime-candidate-workspace.invalid-binding', 'Selections are not canonical.');
  }
  return selections;
}

function materializeInventory(value: unknown): ReviewedWorldArtSlotInventory {
  if (!isRecord(value)) {
    fail('runtime-candidate-workspace.invalid-binding', 'Reviewed inventory must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'profile',
    'production_art_plan_id',
    'production_art_plan_sha256',
    'review_record_sha256',
    'review_status',
    'slots',
  ], 'Reviewed inventory');
  if (
    value.schema_version !== '1.0.0'
    || value.document_type !== 'reviewed-world-art-slot-inventory'
    || !isWorldAssetProfile(value.profile)
    || value.review_status !== 'pass'
    || !Array.isArray(value.slots)
    || value.slots.length < 1
    || value.slots.length > 2048
  ) {
    fail('runtime-candidate-workspace.invalid-binding', 'Reviewed inventory identity is invalid.');
  }
  const slots = Object.freeze(value.slots.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('runtime-candidate-workspace.invalid-binding', `Inventory slot ${index} is invalid.`);
    }
    exactKeys(candidate, [
      'slot_id',
      'requirement_id',
      'role',
      'variant_id',
      'atlas_path',
      'atlas_cell',
    ], `Inventory slot ${index}`);
    return Object.freeze({
      slot_id: safeId(candidate.slot_id, `Inventory slot ${index} id`),
      requirement_id: safeId(candidate.requirement_id, `Inventory slot ${index} requirement`),
      role: safeRole(candidate.role, `Inventory slot ${index} role`),
      variant_id: safeId(candidate.variant_id, `Inventory slot ${index} variant`),
      atlas_path: safePath(candidate.atlas_path, `Inventory slot ${index} path`),
      atlas_cell: materializeCell(candidate.atlas_cell, `Inventory slot ${index} cell`),
    });
  }));
  if (new Set(slots.map(({ slot_id: slotId }) => slotId)).size !== slots.length) {
    fail('runtime-candidate-workspace.invalid-binding', 'Inventory slots are duplicated.');
  }
  return Object.freeze({
    schema_version: '1.0.0',
    document_type: 'reviewed-world-art-slot-inventory',
    profile: value.profile,
    production_art_plan_id: safeId(value.production_art_plan_id, 'Inventory plan id', 100),
    production_art_plan_sha256: digest(
      value.production_art_plan_sha256,
      'Inventory plan digest',
    ),
    review_record_sha256: digest(value.review_record_sha256, 'Inventory review digest'),
    review_status: 'pass',
    slots,
  });
}

function materializeVariantMap(value: unknown): WorldArtVariantMap {
  if (!isRecord(value)) {
    fail('runtime-candidate-workspace.invalid-binding', 'Variant map must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'map_id',
    'profile',
    'source',
    'bindings',
  ], 'Variant map');
  if (
    value.schema_version !== '1.0.0'
    || value.document_type !== 'world-art-variant-map'
    || typeof value.map_id !== 'string'
    || !MAP_ID.test(value.map_id)
    || !isWorldAssetProfile(value.profile)
    || !isRecord(value.source)
    || !Array.isArray(value.bindings)
    || value.bindings.length < 1
  ) {
    fail('runtime-candidate-workspace.invalid-binding', 'Variant map identity is invalid.');
  }
  exactKeys(value.source, [
    'layout_plan_id',
    'layout_plan_sha256',
    'production_art_plan_id',
    'production_art_plan_sha256',
    'reviewed_slot_inventory_sha256',
    'review_record_sha256',
  ], 'Variant map source');
  const source = Object.freeze({
    layout_plan_id: safeId(value.source.layout_plan_id, 'Variant map layout id', 100),
    layout_plan_sha256: digest(value.source.layout_plan_sha256, 'Variant map layout digest'),
    production_art_plan_id: safeId(
      value.source.production_art_plan_id,
      'Variant map plan id',
      100,
    ),
    production_art_plan_sha256: digest(
      value.source.production_art_plan_sha256,
      'Variant map plan digest',
    ),
    reviewed_slot_inventory_sha256: digest(
      value.source.reviewed_slot_inventory_sha256,
      'Variant map inventory digest',
    ),
    review_record_sha256: digest(
      value.source.review_record_sha256,
      'Variant map review digest',
    ),
  });
  const bindings = Object.freeze(value.bindings.map((candidate, index) => {
    if (!isRecord(candidate)) {
      fail('runtime-candidate-workspace.invalid-binding', `Variant binding ${index} is invalid.`);
    }
    exactKeys(candidate, [
      'usage_kind',
      'usage_id',
      'slot_id',
      'role',
      'variant_id',
      'atlas_path',
      'atlas_cell',
    ], `Variant binding ${index}`);
    if (!Object.hasOwn(USAGE_ORDER, String(candidate.usage_kind))) {
      fail('runtime-candidate-workspace.invalid-binding', `Variant binding ${index} kind is invalid.`);
    }
    return Object.freeze({
      usage_kind: candidate.usage_kind as keyof typeof USAGE_ORDER,
      usage_id: safeId(candidate.usage_id, `Variant binding ${index} usage`),
      slot_id: safeId(candidate.slot_id, `Variant binding ${index} slot`),
      role: safeRole(candidate.role, `Variant binding ${index} role`),
      variant_id: safeId(candidate.variant_id, `Variant binding ${index} variant`),
      atlas_path: safePath(candidate.atlas_path, `Variant binding ${index} path`),
      atlas_cell: materializeCell(candidate.atlas_cell, `Variant binding ${index} cell`),
    });
  }));
  if (bindings.some((binding, index) => index > 0 && (
    USAGE_ORDER[bindings[index - 1]!.usage_kind] - USAGE_ORDER[binding.usage_kind]
    || bindings[index - 1]!.usage_id.localeCompare(binding.usage_id, 'en')
    || bindings[index - 1]!.slot_id.localeCompare(binding.slot_id, 'en')
  ) >= 0)) {
    fail('runtime-candidate-workspace.invalid-binding', 'Variant bindings are not canonical.');
  }
  if (new Set(bindings.map(({ usage_kind: kind, usage_id: id }) =>
    `${kind}\u0000${id}`)).size !== bindings.length) {
    fail('runtime-candidate-workspace.invalid-binding', 'Variant bindings are duplicated.');
  }
  return Object.freeze({
    schema_version: '1.0.0',
    document_type: 'world-art-variant-map',
    map_id: value.map_id,
    profile: value.profile,
    source,
    bindings,
  });
}

async function candidateRoot(value: string): Promise<string> {
  if (typeof value !== 'string' || value.length < 1 || value.trim() !== value) {
    fail('runtime-candidate-workspace.invalid-root', 'Candidate root must be a local directory.');
  }
  const unresolved = resolve(value);
  try {
    const metadata = await lstat(unresolved);
    const canonical = await realpath(unresolved);
    if (
      metadata.isSymbolicLink()
      || !metadata.isDirectory()
      || normalizedPathKey(canonical) !== normalizedPathKey(unresolved)
    ) {
      throw new Error('aliased-root');
    }
    return canonical;
  } catch {
    fail(
      'runtime-candidate-workspace.invalid-root',
      'Candidate root must be a direct, existing directory.',
    );
  }
}

async function exactInventory(root: string): Promise<readonly string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    fail('runtime-candidate-workspace.invalid-root', 'Candidate root is not readable.');
  }
  const names = entries.map(({ name }) => name);
  const overlays = names.filter((name) => OVERLAY_PATH.test(name));
  const expected = new Set([RECEIPT_PATH, ...STATIC_ARTIFACT_PATHS, overlays[0]]);
  if (
    entries.length !== 7
    || overlays.length !== 1
    || expected.size !== 7
    || entries.some((entry) => !entry.isFile() || !expected.has(entry.name))
  ) {
    fail(
      'runtime-candidate-workspace.invalid-inventory',
      'Candidate root must contain only its receipt and exact six artifacts.',
    );
  }
  return Object.freeze([...names].sort((left, right) => left.localeCompare(right, 'en')));
}

interface ReadFileResult {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

async function readDirectFile(
  root: string,
  name: string,
): Promise<ReadFileResult> {
  const unresolved = join(root, name);
  const maximum = name.endsWith('.zip') ? MAX_ZIP_BYTES : MAX_JSON_BYTES;
  let metadata: Awaited<ReturnType<typeof lstat>>;
  let canonical: string;
  try {
    metadata = await lstat(unresolved);
    canonical = await realpath(unresolved);
  } catch {
    fail('runtime-candidate-workspace.invalid-inventory', 'A candidate artifact is missing.');
  }
  if (
    metadata.isSymbolicLink()
    || !metadata.isFile()
    || !strictlyInside(root, canonical)
    || normalizedPathKey(canonical) !== normalizedPathKey(unresolved)
  ) {
    fail(
      'runtime-candidate-workspace.path-escape',
      'Candidate artifacts must be direct regular files.',
    );
  }
  if (metadata.size < 1 || metadata.size > maximum) {
    fail('runtime-candidate-workspace.file-size', 'A candidate artifact has an invalid size.');
  }
  const handle = await open(unresolved, 'r').catch(() =>
    fail('runtime-candidate-workspace.invalid-inventory', 'A candidate artifact cannot be opened.'));
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.size !== metadata.size
      || opened.dev !== metadata.dev
      || opened.ino !== metadata.ino
    ) {
      fail('runtime-candidate-workspace.integrity', 'A candidate artifact changed while loading.');
    }
    const bytes = Uint8Array.from(await handle.readFile());
    if (bytes.byteLength !== opened.size) {
      fail('runtime-candidate-workspace.integrity', 'A candidate artifact changed while loading.');
    }
    return Object.freeze({
      name,
      bytes,
      dev: opened.dev,
      ino: opened.ino,
    });
  } finally {
    await handle.close();
  }
}

function assertNoAliases(files: readonly ReadFileResult[]): void {
  const identities = new Set<string>();
  for (const file of files) {
    const identity = `${String(file.dev)}:${String(file.ino)}`;
    if (identities.has(identity)) {
      fail(
        'runtime-candidate-workspace.path-alias',
        'Candidate artifacts must not alias the same filesystem object.',
      );
    }
    identities.add(identity);
  }
}

function reviewSlots(review: WorldArtSelectionReview): readonly Readonly<{
  task_id: string;
  output_path: string;
  slot: WorldArtSelectionReviewSlot;
}>[] {
  return Object.freeze(review.tasks.flatMap((task) =>
    task.slots.map((slot) => Object.freeze({
      task_id: task.task_id,
      output_path: task.output_path,
      slot,
    }))));
}

function assertCrossBindings(input: Readonly<{
  receipt: WorldArtRuntimeCandidateReceipt;
  review: WorldArtSelectionReview;
  inventory: ReviewedWorldArtSlotInventory;
  selections: readonly WorldArtVariantSelection[];
  map: WorldArtVariantMap;
  projection: WorldArtRuntimeProjection;
  overlay: VerifiedWorldArtRuntimeOverlayArchive;
  reviewSha: string;
  inventorySha: string;
  mapSha: string;
  projectionSha: string;
  projectionFileSha: string;
}>): void {
  const {
    receipt,
    review,
    inventory,
    selections,
    map,
    projection,
    overlay,
  } = input;
  if (
    receipt.profile !== review.profile
    || receipt.profile !== inventory.profile
    || receipt.profile !== map.profile
    || receipt.profile !== projection.profile
    || receipt.profile !== overlay.manifest.profile
    || canonicalJson(receipt.rights) !== canonicalJson(review.rights)
    || canonicalJson(receipt.rights) !== canonicalJson(projection.rights)
    || canonicalJson(receipt.rights) !== canonicalJson(overlay.manifest.rights)
    || receipt.source.layout_plan_sha256 !== review.source.layout_plan_sha256
    || receipt.source.layout_plan_sha256 !== map.source.layout_plan_sha256
    || receipt.source.layout_plan_sha256 !== projection.source.layout_plan_sha256
    || receipt.source.layout_plan_sha256 !== overlay.manifest.source.layout_plan_sha256
    || receipt.source.requirements_sha256 !== review.source.requirements_sha256
    || receipt.source.requirements_sha256 !== projection.source.requirements_sha256
    || receipt.source.production_art_plan_sha256
      !== review.source.production_art_plan_sha256
    || receipt.source.production_art_plan_sha256
      !== inventory.production_art_plan_sha256
    || receipt.source.production_art_plan_sha256
      !== map.source.production_art_plan_sha256
    || receipt.source.production_art_plan_sha256
      !== projection.source.production_art_plan_sha256
    || review.source.production_art_plan_id !== inventory.production_art_plan_id
    || review.source.production_art_plan_id !== map.source.production_art_plan_id
    || review.source.production_art_plan_id !== projection.source.production_art_plan_id
    || review.source.layout_plan_id !== map.source.layout_plan_id
    || receipt.source.run_set_sha256 !== review.source.run_set_sha256
    || receipt.source.run_set_sha256 !== projection.source.run_set_sha256
    || receipt.source.selection_review_sha256 !== input.reviewSha
    || inventory.review_record_sha256 !== input.reviewSha
    || map.source.review_record_sha256 !== input.reviewSha
    || projection.source.review_record_sha256 !== input.reviewSha
    || overlay.manifest.source.review_record_sha256 !== input.reviewSha
    || map.source.reviewed_slot_inventory_sha256 !== input.inventorySha
    || projection.source.reviewed_slot_inventory_sha256 !== input.inventorySha
    || receipt.source.variant_map_sha256 !== input.mapSha
    || projection.source.variant_map_id !== map.map_id
    || projection.source.variant_map_sha256 !== input.mapSha
    || receipt.source.runtime_projection_sha256 !== input.projectionSha
    || overlay.manifest.source.projection_id !== projection.projection_id
    || overlay.manifest.source.projection_sha256 !== input.projectionSha
    || overlay.manifest.projection.sha256 !== input.projectionFileSha
  ) {
    fail(
      'runtime-candidate-workspace.invalid-binding',
      'Candidate source, rights, review, map, projection, and overlay bindings differ.',
    );
  }
  const expectedSlots = reviewSlots(review);
  if (
    inventory.slots.length !== expectedSlots.length
    || inventory.slots.some((slot, index) => {
      const expected = expectedSlots[index];
      return !expected
        || slot.slot_id !== expected.slot.slot_id
        || slot.requirement_id !== expected.slot.requirement_id
        || slot.role !== expected.slot.role
        || slot.variant_id !== expected.slot.variant_id
        || slot.atlas_path !== expected.output_path
        || canonicalJson(slot.atlas_cell) !== canonicalJson(expected.slot.atlas_cell);
    })
    || canonicalJson(selections) !== canonicalJson(review.selections)
  ) {
    fail(
      'runtime-candidate-workspace.invalid-binding',
      'Candidate inventory or selections differ from the approved review.',
    );
  }
  const inventoryBySlot = new Map(inventory.slots.map((slot) => [slot.slot_id, slot]));
  if (map.bindings.some((binding) => {
    const slot = inventoryBySlot.get(binding.slot_id);
    return !slot
      || binding.role !== slot.role
      || binding.variant_id !== slot.variant_id
      || binding.atlas_path !== slot.atlas_path
      || canonicalJson(binding.atlas_cell) !== canonicalJson(slot.atlas_cell);
  })) {
    fail(
      'runtime-candidate-workspace.invalid-binding',
      'Variant map bindings differ from the approved inventory.',
    );
  }
  const projectionAssets = new Map(projection.assets.map((asset) => [asset.slot_id, asset]));
  const reviewTaskById = new Map(review.tasks.map((task) => [task.task_id, task]));
  if (
    inventory.slots.some((slot) => {
      const asset = projectionAssets.get(slot.slot_id);
      const task = [...reviewTaskById.values()].find(({ slots }) =>
        slots.some(({ slot_id: slotId }) => slotId === slot.slot_id));
      return !asset
        || !task
        || asset.requirement_id !== slot.requirement_id
        || asset.role !== slot.role
        || asset.variant_id !== slot.variant_id
        || asset.image_path !== slot.atlas_path
        || asset.task_id !== task.task_id;
    })
    || review.tasks.some((task) => {
      if (task.slots.length === 0) return false;
      const image = projection.images.find(({ task_id: taskId }) => taskId === task.task_id);
      return !image
        || image.path !== task.output_path
        || image.sha256 !== task.artifact_sha256
        || image.output_sha256 !== task.output_sha256;
    })
  ) {
    fail(
      'runtime-candidate-workspace.invalid-binding',
      'Runtime projection assets differ from the approved review inventory.',
    );
  }
  for (const selection of selections) {
    const binding = map.bindings.find((candidate) =>
      candidate.usage_kind === selection.usage_kind
      && candidate.usage_id === selection.usage_id);
    if (!binding || binding.slot_id !== selection.slot_id) {
      fail(
        'runtime-candidate-workspace.invalid-binding',
        'Variant map does not contain every approved selection.',
      );
    }
  }
}

export async function loadWorldArtRuntimeCandidateWorkspace(
  candidateDirectory: string,
): Promise<LoadedWorldArtRuntimeCandidateWorkspace> {
  const root = await candidateRoot(candidateDirectory);
  const inventoryNames = await exactInventory(root);
  const rawFiles = await Promise.all(inventoryNames.map((name) => readDirectFile(root, name)));
  assertNoAliases(rawFiles);
  const rawByName = new Map(rawFiles.map((file) => [file.name, file.bytes]));
  const receiptBytes = rawByName.get(RECEIPT_PATH)!;
  const receipt = await materializeWorldArtRuntimeCandidateReceipt(
    parseCanonicalJson(receiptBytes, 'Runtime candidate receipt'),
  );
  const directoryArtifacts = inventoryNames.filter((name) => name !== RECEIPT_PATH);
  if (
    receipt.artifacts.length !== directoryArtifacts.length
    || receipt.artifacts.some((artifact, index) => artifact.path !== directoryArtifacts[index])
  ) {
    fail(
      'runtime-candidate-workspace.invalid-inventory',
      'Receipt artifacts differ from the candidate directory inventory.',
    );
  }

  const loadedArtifacts: LoadedWorldArtRuntimeCandidateArtifact[] = [];
  for (const artifact of receipt.artifacts) {
    const bytes = rawByName.get(artifact.path);
    if (
      !bytes
      || bytes.byteLength !== artifact.bytes
      || await sha256Bytes(bytes) !== artifact.sha256
    ) {
      fail(
        'runtime-candidate-workspace.integrity',
        'A candidate artifact differs from its receipt.',
      );
    }
    const snapshot = Uint8Array.from(bytes);
    loadedArtifacts.push(Object.freeze({
      ...artifact,
      readBytes: () => Uint8Array.from(snapshot),
    }));
  }

  const reviewBytes = rawByName.get('world-art-selection-review.json')!;
  const inventoryBytes = rawByName.get('reviewed-world-art-slot-inventory.json')!;
  const selectionsBytes = rawByName.get('world-art-variant-selections.json')!;
  const mapBytes = rawByName.get('world-art-variant-map.json')!;
  const projectionBytes = rawByName.get('world-art-runtime-projection.json')!;
  const overlayArtifact = receipt.artifacts.find(({ media_type }) =>
    media_type === 'application/zip')!;
  const overlayBytes = rawByName.get(overlayArtifact.path)!;

  const review = materializeReview(parseCanonicalJson(reviewBytes, 'Selection review'));
  const reviewedInventory = materializeInventory(
    parseCanonicalJson(inventoryBytes, 'Reviewed slot inventory'),
  );
  const selections = materializeSelections(
    parseCanonicalJson(selectionsBytes, 'Variant selections'),
  );
  const variantMap = materializeVariantMap(parseCanonicalJson(mapBytes, 'Variant map'));
  let projection: WorldArtRuntimeProjection;
  let overlay: VerifiedWorldArtRuntimeOverlayArchive;
  try {
    projection = await materializeWorldArtRuntimeProjection(
      parseCanonicalJson(projectionBytes, 'Runtime projection'),
    );
  } catch {
    fail(
      'runtime-candidate-workspace.invalid-binding',
      'Runtime projection is not canonical or self-consistent.',
    );
  }
  try {
    overlay = await readWorldArtRuntimeOverlayArchive(overlayBytes);
  } catch {
    fail(
      'runtime-candidate-workspace.invalid-overlay',
      'Runtime overlay archive is invalid or changed.',
    );
  }

  const [
    reviewSha,
    inventorySha,
    mapSha,
    projectionSha,
    projectionFileSha,
    expectedReviewIdentitySha,
    expectedMapIdentitySha,
  ] = await Promise.all([
    sha256Value(review),
    sha256Value(reviewedInventory),
    sha256Value(variantMap),
    fingerprintWorldArtRuntimeProjection(projection),
    sha256Bytes(projectionBytes),
    sha256Value({ profile: review.profile, source: review.source }),
    sha256Value({
      profile: variantMap.profile,
      source: variantMap.source,
      bindings: variantMap.bindings,
    }),
  ]);
  if (
    review.review_id
      !== `world-art-selection-review-${expectedReviewIdentitySha.slice(0, 16)}`
    || variantMap.map_id !== `world-art-variant-map-${expectedMapIdentitySha.slice(0, 16)}`
    || overlayArtifact.path !== `${overlay.manifest.overlay_id}.zip`
  ) {
    fail(
      'runtime-candidate-workspace.invalid-binding',
      'Review, variant map, or overlay identity is stale.',
    );
  }
  assertCrossBindings({
    receipt,
    review,
    inventory: reviewedInventory,
    selections,
    map: variantMap,
    projection,
    overlay,
    reviewSha,
    inventorySha,
    mapSha,
    projectionSha,
    projectionFileSha,
  });

  const receiptSnapshot = Uint8Array.from(receiptBytes);
  const overlaySnapshot = Uint8Array.from(overlayBytes);
  const overlayResult = Object.freeze({
    bytes: overlaySnapshot.byteLength,
    sha256: overlay.sha256,
    manifest: overlay.manifest,
    readBytes: () => Uint8Array.from(overlaySnapshot),
  });
  return Object.freeze({
    receipt,
    receipt_file: Object.freeze({
      path: RECEIPT_PATH,
      media_type: 'application/json' as const,
      bytes: receiptSnapshot.byteLength,
      sha256: await sha256Bytes(receiptSnapshot),
      readBytes: () => Uint8Array.from(receiptSnapshot),
    }),
    review,
    reviewed_slot_inventory: reviewedInventory,
    selections,
    variant_map: variantMap,
    runtime_projection: projection,
    overlay: overlayResult,
    artifacts: Object.freeze(loadedArtifacts),
  });
}
