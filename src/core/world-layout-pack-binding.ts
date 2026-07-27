import type { WorldAssetProfile } from './asset-profile';
import {
  materializeWorldLayoutPlan,
  serializeCanonicalWorldLayoutPlan,
  WORLD_LAYOUT_PLAN_VERSION,
  type WorldLayoutPlan,
} from './world-layout-plan';

export const WORLD_LAYOUT_PACK_PATH = 'world-layout-plan.json' as const;

export interface WorldLayoutPackBinding {
  readonly schema_version: typeof WORLD_LAYOUT_PLAN_VERSION;
  readonly document_type: 'world-layout-plan';
  readonly plan_id: string;
  readonly path: typeof WORLD_LAYOUT_PACK_PATH;
  readonly sha256: string;
}

export interface WorldLayoutPackFileRecord {
  readonly path: string;
  readonly media_type: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PreparedWorldLayoutPackEntry {
  readonly plan: WorldLayoutPlan;
  readonly bytes: Uint8Array;
  readonly binding: WorldLayoutPackBinding;
}

export interface WorldLayoutPackBindingIssue {
  readonly code: string;
  readonly message: string;
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keeps immutable no-layout pack fixtures byte-compatible with their published
 * schemas while allowing new layout-bearing packs to advertise the extension.
 */
export function selectWorldLayoutAwarePackSchema(
  schema: unknown,
  includeLayout: boolean,
): unknown {
  if (includeLayout || !isRecord(schema) || !isRecord(schema.properties)) {
    return schema;
  }
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([key]) =>
      key !== 'layout' && key !== 'material_palette' && key !== 'terrain_autotiles'),
  );
  const selected: Record<string, unknown> = {
    ...schema,
    properties: Object.freeze(properties),
  };
  if (isRecord(schema.$defs)) {
    const definitions = Object.fromEntries(
      Object.entries(schema.$defs).filter(([key]) =>
        key !== 'layoutBinding'
        && key !== 'materialPaletteBinding'
        && key !== 'terrainAutotileBinding'),
    );
    if (Object.keys(definitions).length === 0) {
      delete selected.$defs;
    } else {
      selected.$defs = Object.freeze(definitions);
    }
  }
  return Object.freeze(selected);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validates and prepares the optional provider-neutral layout artifact.
 * Profile and seed must agree with the generation request that owns the pack.
 */
export async function prepareWorldLayoutPackEntry(
  value: unknown,
  expectedProfile: WorldAssetProfile,
  expectedSeed: string,
): Promise<PreparedWorldLayoutPackEntry> {
  const plan = await materializeWorldLayoutPlan(value);
  if (plan.profile !== expectedProfile) {
    throw new Error(`World layout profile ${plan.profile} does not match pack profile ${expectedProfile}.`);
  }
  if (plan.source.seed !== expectedSeed) {
    throw new Error('World layout seed does not match the pack generation seed.');
  }
  const bytes = await serializeCanonicalWorldLayoutPlan(plan);
  const binding = Object.freeze({
    schema_version: WORLD_LAYOUT_PLAN_VERSION,
    document_type: 'world-layout-plan' as const,
    plan_id: plan.plan_id,
    path: WORLD_LAYOUT_PACK_PATH,
    sha256: await sha256(bytes),
  });
  return Object.freeze({ plan, bytes, binding });
}

/** Performs manifest-only integrity checks; ZIP byte verification remains an archive verifier concern. */
export function validateWorldLayoutPackBinding(
  binding: WorldLayoutPackBinding | undefined,
  files: readonly WorldLayoutPackFileRecord[],
): WorldLayoutPackBindingIssue[] {
  if (binding === undefined) return [];
  const issues: WorldLayoutPackBindingIssue[] = [];
  const keys = Object.keys(binding).sort();
  const expectedKeys = ['document_type', 'path', 'plan_id', 'schema_version', 'sha256'];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    issues.push({
      code: 'layout.binding-shape',
      message: 'World layout binding contains unsupported or missing fields.',
    });
  }
  if (
    binding.schema_version !== WORLD_LAYOUT_PLAN_VERSION
    || binding.document_type !== 'world-layout-plan'
    || binding.path !== WORLD_LAYOUT_PACK_PATH
    || !SAFE_ID.test(binding.plan_id)
    || !SHA256.test(binding.sha256)
  ) {
    issues.push({
      code: 'layout.binding',
      message: 'World layout binding must identify one safe canonical WorldLayoutPlan 1.0 artifact.',
    });
  }
  const record = files.find(({ path }) => path === binding.path);
  if (
    !record
    || record.media_type !== 'application/json'
    || record.sha256 !== binding.sha256
    || !Number.isSafeInteger(record.bytes)
    || record.bytes < 1
  ) {
    issues.push({
      code: 'layout.file-record',
      message: 'World layout binding must match its JSON file integrity record.',
    });
  }
  return issues;
}
