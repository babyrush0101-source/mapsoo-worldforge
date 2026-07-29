import type { WorldAssetProfile } from './asset-profile';
import type {
  WorldCreationIntakeTarget,
} from './confirmed-world-creation-intake';

export const WORLD_DELIVERY_BATCH_VERSION = '1.0.0' as const;
export const WORLD_DELIVERY_BATCH_MAX_WORLDS = 32;

export interface WorldDeliveryBatchRequest {
  readonly schema_version: typeof WORLD_DELIVERY_BATCH_VERSION;
  readonly document_type: 'world-delivery-batch-request';
  readonly batch_id: string;
  readonly completed_at: string;
  readonly worlds: readonly Readonly<{
    workspace_id: string;
    intake_path: string;
    reference_root: string;
    character_id: string;
    character_identity_semantics_path?: string;
  }>[];
}

export interface WorldDeliveryBatchReceipt {
  readonly schema_version: typeof WORLD_DELIVERY_BATCH_VERSION;
  readonly document_type: 'world-delivery-batch-receipt';
  readonly batch_id: string;
  readonly request_sha256: string;
  readonly completed_at: string;
  readonly world_count: number;
  readonly profile_counts: Readonly<Record<WorldAssetProfile, number>>;
  readonly workspaces: readonly Readonly<{
    workspace_id: string;
    path: string;
    intake_id: string;
    intake_sha256: string;
    profile: WorldAssetProfile;
    target: WorldCreationIntakeTarget;
    manifest_sha256: string;
    remote_request_count: 0;
  }>[];
  readonly atomic_write: true;
  readonly remote_request_count: 0;
  readonly privacy: Readonly<{
    receipt_embeds_private_inputs: false;
    receipt_contains_absolute_paths: false;
    repository_write_allowed: false;
  }>;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

function fail(message: string): never {
  throw new Error(`World delivery batch request: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  if (
    required.some((key) => !(key in value))
    || actual.some((key) => !allowed.has(key))
  ) {
    fail(
      `${label} must contain required keys ${required.join(', ')}`
      + (
        optional.length > 0
          ? ` and optional keys ${optional.join(', ')}.`
          : '.'
      ),
    );
  }
}

function id(value: unknown, label: string, maximum = 80): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || CONTROL_CHARACTER.test(value)
    || !ID.test(value)
  ) {
    fail(`${label} must use bounded lowercase kebab-case.`);
  }
  return value;
}

function portablePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.trim() !== value
    || CONTROL_CHARACTER.test(value)
    || !SAFE_PATH.test(value)
    || value.includes('\\')
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    fail(`${label} must be a safe portable relative path.`);
  }
  return value;
}

function canonicalUtcInstant(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    fail('completed_at must be a canonical UTC ISO instant.');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('completed_at must be a real canonical UTC ISO instant.');
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Batch canonical JSON cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (!isRecord(value)) {
    throw new Error('Batch canonical JSON contains an unsupported value.');
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function materializeWorldDeliveryBatchRequest(
  value: unknown,
): WorldDeliveryBatchRequest {
  if (!isRecord(value)) fail('root must be an object.');
  exactKeys(
    value,
    [
      'schema_version',
      'document_type',
      'batch_id',
      'completed_at',
      'worlds',
    ],
    [],
    'root',
  );
  if (
    value.schema_version !== WORLD_DELIVERY_BATCH_VERSION
    || value.document_type !== 'world-delivery-batch-request'
  ) {
    fail('schema_version or document_type is unsupported.');
  }
  if (
    !Array.isArray(value.worlds)
    || value.worlds.length < 1
    || value.worlds.length > WORLD_DELIVERY_BATCH_MAX_WORLDS
  ) {
    fail(
      `worlds must contain from 1 to ${WORLD_DELIVERY_BATCH_MAX_WORLDS} entries.`,
    );
  }
  const workspaceIds = new Set<string>();
  const worlds = value.worlds.map((entry, index) => {
    if (!isRecord(entry)) fail(`worlds[${index}] must be an object.`);
    const hasSemantics = 'character_identity_semantics_path' in entry;
    exactKeys(
      entry,
      [
        'workspace_id',
        'intake_path',
        'reference_root',
        'character_id',
      ],
      hasSemantics ? ['character_identity_semantics_path'] : [],
      `worlds[${index}]`,
    );
    const workspaceId = id(
      entry.workspace_id,
      `worlds[${index}].workspace_id`,
      64,
    );
    if (workspaceIds.has(workspaceId)) {
      fail(`workspace_id ${workspaceId} is duplicated.`);
    }
    workspaceIds.add(workspaceId);
    return Object.freeze({
      workspace_id: workspaceId,
      intake_path: portablePath(
        entry.intake_path,
        `worlds[${index}].intake_path`,
      ),
      reference_root: portablePath(
        entry.reference_root,
        `worlds[${index}].reference_root`,
      ),
      character_id: id(
        entry.character_id,
        `worlds[${index}].character_id`,
        48,
      ),
      ...(hasSemantics
        ? {
          character_identity_semantics_path: portablePath(
            entry.character_identity_semantics_path,
            `worlds[${index}].character_identity_semantics_path`,
          ),
        }
        : {}),
    });
  });
  return Object.freeze({
    schema_version: WORLD_DELIVERY_BATCH_VERSION,
    document_type: 'world-delivery-batch-request' as const,
    batch_id: id(value.batch_id, 'batch_id', 64),
    completed_at: canonicalUtcInstant(value.completed_at),
    worlds: Object.freeze(worlds),
  });
}

export function serializeWorldDeliveryBatchRequestCanonical(
  value: WorldDeliveryBatchRequest,
): Uint8Array {
  const request = materializeWorldDeliveryBatchRequest(value);
  return new TextEncoder().encode(`${canonicalJson(request)}\n`);
}

export async function fingerprintWorldDeliveryBatchRequest(
  value: WorldDeliveryBatchRequest,
): Promise<string> {
  const bytes = serializeWorldDeliveryBatchRequestCanonical(value);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
