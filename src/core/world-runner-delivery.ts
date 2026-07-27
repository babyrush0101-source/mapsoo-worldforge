import {
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  type CharacterProfileRevision,
} from './character-profile-revision';
import {
  materializePortableWorldRuntimeContract,
  type PortableWorldRuntimeContract,
} from './portable-world-runtime-contract';
import type { WorldCreationIntakeTarget } from './confirmed-world-creation-intake';

export const WORLD_RUNNER_DELIVERY_VERSION = '1.0.0' as const;
export const WORLD_RUNNER_ARTIFACT_KINDS = Object.freeze([
  'godot-pck',
  'godot-project-zip',
  'web-bundle-zip',
] as const);
export const WORLD_RUNNER_ARCHITECTURES = Object.freeze([
  'arm64',
  'x86_64',
  'wasm32',
] as const);

export type WorldRunnerArtifactKind = typeof WORLD_RUNNER_ARTIFACT_KINDS[number];
export type WorldRunnerArchitecture = typeof WORLD_RUNNER_ARCHITECTURES[number];

export interface WorldRunnerDelivery {
  readonly schema_version: typeof WORLD_RUNNER_DELIVERY_VERSION;
  readonly document_type: 'world-runner-delivery';
  readonly delivery_id: string;
  readonly intake_sha256: string;
  readonly target: WorldCreationIntakeTarget;
  readonly world_pack: Readonly<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
  readonly runtime_artifact: Readonly<{
    kind: WorldRunnerArtifactKind;
    architecture: WorldRunnerArchitecture;
    path: string;
    bytes: number;
    sha256: string;
  }>;
  readonly runtime_contract: PortableWorldRuntimeContract;
  readonly character_profile_revision: Readonly<{
    profile_revision_id: string;
    path: string;
    sha256: string;
    identity_digest_sha256: string;
  }>;
  readonly launch: Readonly<{
    spawn_id: string;
    player_slot_id: string;
  }>;
  readonly verification: Readonly<{
    godot_version: string;
    headless_smoke_passed: true;
    report_path: string;
    report_sha256: string;
  }>;
}

export type WorldRunnerDeliveryErrorCode =
  | 'delivery.invalid-shape'
  | 'delivery.invalid-value'
  | 'delivery.invalid-reference'
  | 'delivery.target-mismatch'
  | 'delivery.character-mismatch';

export class WorldRunnerDeliveryError extends Error {
  constructor(readonly code: WorldRunnerDeliveryErrorCode, message: string) {
    super(message);
    this.name = 'WorldRunnerDeliveryError';
  }
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const GODOT_VERSION = /^(?:4|[5-9]|[1-9]\d+)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?(?:[-+][0-9A-Za-z.-]+)?$/;

function fail(code: WorldRunnerDeliveryErrorCode, message: string): never {
  throw new WorldRunnerDeliveryError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('delivery.invalid-shape', `${label} must contain exactly: ${expected.join(', ')}.`);
  }
}

function id(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 80 || !ID.test(value)) {
    fail('delivery.invalid-value', `${label} must use lowercase kebab-case.`);
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('delivery.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function path(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    fail('delivery.invalid-value', `${label} must be a portable relative path.`);
  }
  return value;
}

function bytes(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 2_147_483_647) {
    fail('delivery.invalid-value', `${label} must be a positive safe byte count.`);
  }
  return value as number;
}

function materializeArtifact(
  value: unknown,
  label: string,
  includeKind: boolean,
): {
  readonly kind?: WorldRunnerArtifactKind;
  readonly architecture?: WorldRunnerArchitecture;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
} {
  if (!isRecord(value)) fail('delivery.invalid-shape', `${label} must be an object.`);
  exactKeys(
    value,
    includeKind ? ['kind', 'architecture', 'path', 'bytes', 'sha256'] : ['path', 'bytes', 'sha256'],
    label,
  );
  if (includeKind && !WORLD_RUNNER_ARTIFACT_KINDS.includes(value.kind as WorldRunnerArtifactKind)) {
    fail('delivery.invalid-value', `${label} kind is unsupported.`);
  }
  if (includeKind && !WORLD_RUNNER_ARCHITECTURES.includes(value.architecture as WorldRunnerArchitecture)) {
    fail('delivery.invalid-value', `${label} architecture is unsupported.`);
  }
  return Object.freeze({
    ...(includeKind ? { kind: value.kind as WorldRunnerArtifactKind } : {}),
    ...(includeKind ? { architecture: value.architecture as WorldRunnerArchitecture } : {}),
    path: path(value.path, `${label} path`),
    bytes: bytes(value.bytes, `${label} bytes`),
    sha256: hash(value.sha256, `${label} digest`),
  });
}

function assertTargetArtifact(
  target: WorldCreationIntakeTarget,
  kind: WorldRunnerArtifactKind,
  architecture: WorldRunnerArchitecture,
): void {
  if (target === 'raspberry-pi-4b' && (kind !== 'godot-pck' || architecture !== 'arm64')) {
    fail(
      'delivery.target-mismatch',
      'Raspberry Pi 4B delivery requires a prebuilt Godot PCK bound to the ARM64 runtime target.',
    );
  }
  if (target === 'web' && (kind !== 'web-bundle-zip' || architecture !== 'wasm32')) {
    fail('delivery.target-mismatch', 'Web delivery requires a wasm32 web bundle archive.');
  }
  if (target === 'desktop' && (kind === 'web-bundle-zip' || architecture === 'wasm32')) {
    fail('delivery.target-mismatch', 'Desktop delivery requires a Godot PCK or project archive.');
  }
}

export async function materializeWorldRunnerDelivery(
  value: unknown,
  characterRevisionValue?: unknown,
): Promise<WorldRunnerDelivery> {
  if (!isRecord(value)) fail('delivery.invalid-shape', 'World Runner delivery must be an object.');
  exactKeys(value, [
    'schema_version',
    'document_type',
    'delivery_id',
    'intake_sha256',
    'target',
    'world_pack',
    'runtime_artifact',
    'runtime_contract',
    'character_profile_revision',
    'launch',
    'verification',
  ], 'World Runner delivery');
  if (
    value.schema_version !== WORLD_RUNNER_DELIVERY_VERSION
    || value.document_type !== 'world-runner-delivery'
  ) {
    fail('delivery.invalid-value', 'World Runner delivery must use the 1.0.0 contract.');
  }
  const targets: readonly WorldCreationIntakeTarget[] = ['desktop', 'raspberry-pi-4b', 'web'];
  if (!targets.includes(value.target as WorldCreationIntakeTarget)) {
    fail('delivery.invalid-value', 'World Runner delivery target is unsupported.');
  }
  const target = value.target as WorldCreationIntakeTarget;
  const worldPack = materializeArtifact(value.world_pack, 'World pack', false);
  const runtimeArtifact = materializeArtifact(value.runtime_artifact, 'Runtime artifact', true);
  assertTargetArtifact(
    target,
    runtimeArtifact.kind as WorldRunnerArtifactKind,
    runtimeArtifact.architecture as WorldRunnerArchitecture,
  );
  let runtimeContract: PortableWorldRuntimeContract;
  try {
    runtimeContract = materializePortableWorldRuntimeContract(value.runtime_contract);
  } catch (error) {
    fail(
      'delivery.invalid-reference',
      `Runtime contract is invalid${error instanceof Error ? `: ${error.message}` : '.'}`,
    );
  }
  if (runtimeContract.world.pack_sha256 !== worldPack.sha256) {
    fail('delivery.invalid-reference', 'Runtime contract pack digest must match the delivered world pack.');
  }

  if (!isRecord(value.character_profile_revision)) {
    fail('delivery.invalid-shape', 'Character profile revision descriptor must be an object.');
  }
  exactKeys(
    value.character_profile_revision,
    ['profile_revision_id', 'path', 'sha256', 'identity_digest_sha256'],
    'Character profile revision descriptor',
  );
  const characterDescriptor = Object.freeze({
    profile_revision_id: id(
      value.character_profile_revision.profile_revision_id,
      'Character profile revision id',
    ),
    path: path(value.character_profile_revision.path, 'Character profile revision path'),
    sha256: hash(value.character_profile_revision.sha256, 'Character profile revision digest'),
    identity_digest_sha256: hash(
      value.character_profile_revision.identity_digest_sha256,
      'Character identity digest',
    ),
  });

  if (!isRecord(value.launch)) fail('delivery.invalid-shape', 'Launch descriptor must be an object.');
  exactKeys(value.launch, ['spawn_id', 'player_slot_id'], 'Launch descriptor');
  const launch = Object.freeze({
    spawn_id: id(value.launch.spawn_id, 'Launch spawn id'),
    player_slot_id: id(value.launch.player_slot_id, 'Launch player slot id'),
  });
  if (!runtimeContract.spawn_points.some(({ spawn_id }) => spawn_id === launch.spawn_id)) {
    fail('delivery.invalid-reference', 'Launch descriptor references an unknown spawn point.');
  }
  const playerSlot = runtimeContract.entity_slots.find(({ slot_id }) => slot_id === launch.player_slot_id);
  if (
    !playerSlot
    || playerSlot.kind !== 'player'
    || !playerSlot.accepted_asset_kinds.includes('character-atlas')
  ) {
    fail('delivery.invalid-reference', 'Launch descriptor requires a character-capable player slot.');
  }

  if (!isRecord(value.verification)) {
    fail('delivery.invalid-shape', 'Runtime verification must be an object.');
  }
  exactKeys(
    value.verification,
    ['godot_version', 'headless_smoke_passed', 'report_path', 'report_sha256'],
    'Runtime verification',
  );
  if (
    typeof value.verification.godot_version !== 'string'
    || !GODOT_VERSION.test(value.verification.godot_version)
    || value.verification.headless_smoke_passed !== true
  ) {
    fail('delivery.invalid-value', 'Runtime verification requires a supported Godot version and passing smoke.');
  }
  const verification = Object.freeze({
    godot_version: value.verification.godot_version,
    headless_smoke_passed: true as const,
    report_path: path(value.verification.report_path, 'Runtime verification report path'),
    report_sha256: hash(value.verification.report_sha256, 'Runtime verification report digest'),
  });

  if (characterRevisionValue !== undefined) {
    let characterRevision: CharacterProfileRevision;
    try {
      characterRevision = materializeCharacterProfileRevision(characterRevisionValue);
    } catch (error) {
      fail(
        'delivery.character-mismatch',
        `Character profile revision is invalid${error instanceof Error ? `: ${error.message}` : '.'}`,
      );
    }
    if (
      characterRevision.profile_revision_id !== characterDescriptor.profile_revision_id
      || characterRevision.profile !== runtimeContract.world.profile
      || characterRevision.source_identity.identity_digest_sha256 !== characterDescriptor.identity_digest_sha256
      || await fingerprintCharacterProfileRevision(characterRevision) !== characterDescriptor.sha256
    ) {
      fail(
        'delivery.character-mismatch',
        'Character profile revision does not match the delivery descriptor or world profile.',
      );
    }
  }

  return Object.freeze({
    schema_version: WORLD_RUNNER_DELIVERY_VERSION,
    document_type: 'world-runner-delivery',
    delivery_id: id(value.delivery_id, 'World Runner delivery id'),
    intake_sha256: hash(value.intake_sha256, 'Confirmed intake digest'),
    target,
    world_pack: Object.freeze({
      path: worldPack.path,
      bytes: worldPack.bytes,
      sha256: worldPack.sha256,
    }),
    runtime_artifact: Object.freeze({
      kind: runtimeArtifact.kind as WorldRunnerArtifactKind,
      architecture: runtimeArtifact.architecture as WorldRunnerArchitecture,
      path: runtimeArtifact.path,
      bytes: runtimeArtifact.bytes,
      sha256: runtimeArtifact.sha256,
    }),
    runtime_contract: runtimeContract,
    character_profile_revision: characterDescriptor,
    launch,
    verification,
  });
}

export async function createWorldRunnerDelivery(
  input: Omit<
    WorldRunnerDelivery,
    'schema_version' | 'document_type' | 'character_profile_revision'
  > & Readonly<{
    character_profile_revision: Readonly<{
      path: string;
      revision: unknown;
    }>;
  }>,
): Promise<WorldRunnerDelivery> {
  const revision = materializeCharacterProfileRevision(input.character_profile_revision.revision);
  const candidate = {
    ...input,
    schema_version: WORLD_RUNNER_DELIVERY_VERSION,
    document_type: 'world-runner-delivery',
    character_profile_revision: {
      profile_revision_id: revision.profile_revision_id,
      path: input.character_profile_revision.path,
      sha256: await fingerprintCharacterProfileRevision(revision),
      identity_digest_sha256: revision.source_identity.identity_digest_sha256,
    },
  };
  return materializeWorldRunnerDelivery(candidate, revision);
}
