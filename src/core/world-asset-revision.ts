import type { WorldAssetProfile } from './asset-profile';

export const WORLD_ASSET_REVISION_SCHEMA_VERSION = '0.1.0' as const;
export const FROZEN_WORLD_LAUNCH_SCHEMA_VERSION = '0.1.0' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.zip$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/;
const GODOT_VERSION = /^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/;

export interface WorldAssetRevision {
  readonly schema_version: typeof WORLD_ASSET_REVISION_SCHEMA_VERSION;
  readonly world_id: string;
  readonly profile: WorldAssetProfile;
  readonly pack_schema_version: string;
  readonly pack_version: string;
  readonly pack_filename: string;
  readonly pack_bytes: number;
  readonly pack_sha256: string;
  readonly manifest_sha256: string;
  readonly request_fingerprint_sha256: string;
  readonly dialogue_binding_sha256: string | null;
  readonly godot: Readonly<{
    readonly minimum_version: string;
    readonly importer_id: 'mapsoo_importer';
    readonly importer_minimum_version: string;
    readonly scene_path: string;
  }>;
  readonly revision_sha256: string;
}

export interface FrozenWorldLaunchBinding {
  readonly schema_version: typeof FROZEN_WORLD_LAUNCH_SCHEMA_VERSION;
  readonly status: 'frozen';
  readonly world_id: string;
  readonly profile: WorldAssetProfile;
  readonly asset_revision_sha256: string;
  readonly dialogue_binding_sha256: string | null;
  readonly scene_path: string;
  readonly launch_binding_sha256: string;
}

export interface CreateWorldAssetRevisionInput {
  readonly worldId: string;
  readonly profile: WorldAssetProfile;
  readonly packSchemaVersion: string;
  readonly packVersion: string;
  readonly packFilename: string;
  readonly packBytes: Uint8Array;
  readonly manifest: unknown;
  readonly requestFingerprintSha256: string;
  readonly dialogueBindingSha256?: string;
  readonly minimumGodotVersion: string;
  readonly importerMinimumVersion: string;
}

export class WorldAssetRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldAssetRevisionError';
  }
}

function fail(message: string): never {
  throw new WorldAssetRevisionError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('Asset revision contains a non-canonical value.');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const snapshot = bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', snapshot.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Value(value: unknown): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(canonicalJson(value)));
}

function validateHash(value: string | undefined, label: string): string {
  if (!value || !SHA256.test(value)) fail(`${label} must be a lowercase SHA-256.`);
  return value;
}

function validateVersion(value: string, label: string): string {
  if (!VERSION.test(value)) fail(`${label} must be a semantic version.`);
  return value;
}

function scenePath(worldId: string): string {
  return `res://mapsoo_imports/${worldId}/${worldId}.world.tscn`;
}

function revisionPayload(revision: Omit<WorldAssetRevision, 'revision_sha256'>): unknown {
  return revision;
}

export async function createWorldAssetRevision(
  input: CreateWorldAssetRevisionInput,
): Promise<WorldAssetRevision> {
  if (!SAFE_ID.test(input.worldId)) fail('Asset revision world ID is invalid.');
  if (!['topdown-farm', 'side-platformer', 'isometric-action', 'layered-depth-2d'].includes(input.profile)) {
    fail('Asset revision profile is invalid.');
  }
  if (!SAFE_FILENAME.test(input.packFilename)) fail('Asset revision pack filename is unsafe.');
  if (!(input.packBytes instanceof Uint8Array) || input.packBytes.byteLength < 1) {
    fail('Asset revision pack bytes are missing.');
  }
  if (!isRecord(input.manifest)) fail('Asset revision manifest is missing.');

  const requestFingerprintSha256 = validateHash(
    input.requestFingerprintSha256,
    'Asset revision request fingerprint',
  );
  const dialogueBindingSha256 = input.dialogueBindingSha256 === undefined
    ? null
    : validateHash(input.dialogueBindingSha256, 'Asset revision dialogue binding');
  const packSchemaVersion = validateVersion(input.packSchemaVersion, 'Asset revision pack schema version');
  const packVersion = validateVersion(input.packVersion, 'Asset revision pack version');
  if (!GODOT_VERSION.test(input.minimumGodotVersion)) {
    fail('Asset revision minimum Godot version is invalid.');
  }
  const minimumGodotVersion = input.minimumGodotVersion;
  const importerMinimumVersion = validateVersion(
    input.importerMinimumVersion,
    'Asset revision importer minimum version',
  );

  const base = Object.freeze({
    schema_version: WORLD_ASSET_REVISION_SCHEMA_VERSION,
    world_id: input.worldId,
    profile: input.profile,
    pack_schema_version: packSchemaVersion,
    pack_version: packVersion,
    pack_filename: input.packFilename,
    pack_bytes: input.packBytes.byteLength,
    pack_sha256: await sha256Bytes(input.packBytes),
    manifest_sha256: await sha256Bytes(
      new TextEncoder().encode(`${JSON.stringify(input.manifest, null, 2)}\n`),
    ),
    request_fingerprint_sha256: requestFingerprintSha256,
    dialogue_binding_sha256: dialogueBindingSha256,
    godot: Object.freeze({
      minimum_version: minimumGodotVersion,
      importer_id: 'mapsoo_importer' as const,
      importer_minimum_version: importerMinimumVersion,
      scene_path: scenePath(input.worldId),
    }),
  });
  return Object.freeze({
    ...base,
    revision_sha256: await sha256Value(revisionPayload(base)),
  });
}

export async function freezeWorldAssetRevision(
  revision: WorldAssetRevision,
  approvedRevisionSha256: string,
): Promise<FrozenWorldLaunchBinding> {
  validateHash(approvedRevisionSha256, 'Approved asset revision');
  if (approvedRevisionSha256 !== revision.revision_sha256) {
    fail('Approval does not match the generated asset revision.');
  }
  const { revision_sha256: ignoredRevisionSha256, ...revisionWithoutHash } = revision;
  void ignoredRevisionSha256;
  const expectedRevisionSha256 = await sha256Value(revisionPayload(revisionWithoutHash));
  if (expectedRevisionSha256 !== revision.revision_sha256) {
    fail('Generated asset revision failed integrity verification.');
  }
  const base = Object.freeze({
    schema_version: FROZEN_WORLD_LAUNCH_SCHEMA_VERSION,
    status: 'frozen' as const,
    world_id: revision.world_id,
    profile: revision.profile,
    asset_revision_sha256: revision.revision_sha256,
    dialogue_binding_sha256: revision.dialogue_binding_sha256,
    scene_path: revision.godot.scene_path,
  });
  return Object.freeze({
    ...base,
    launch_binding_sha256: await sha256Value(base),
  });
}
