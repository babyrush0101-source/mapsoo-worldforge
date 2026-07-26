import type { WorldAssetProfile } from './asset-profile';

export const PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION = '1.0.0' as const;
export const PORTABLE_RUNTIME_BRIDGE_VERSION = '1.0.0' as const;

export const PORTABLE_RUNTIME_ENTITY_KINDS = Object.freeze([
  'player',
  'npc',
  'companion',
  'interactive',
  'prop',
] as const);

export const PORTABLE_RUNTIME_ASSET_KINDS = Object.freeze([
  'character-atlas',
  'animation-set',
  'collision-profile',
  'interaction-profile',
] as const);

export const PORTABLE_RUNTIME_EVENTS = Object.freeze([
  'runtime.ready',
  'world.entered',
  'world.exited',
  'entity.bound',
  'interaction.requested',
  'checkpoint.reached',
  'objective.completed',
  'runtime.error',
] as const);

export type PortableRuntimeEntityKind = typeof PORTABLE_RUNTIME_ENTITY_KINDS[number];
export type PortableRuntimeAssetKind = typeof PORTABLE_RUNTIME_ASSET_KINDS[number];
export type PortableRuntimeEvent = typeof PORTABLE_RUNTIME_EVENTS[number];

export interface PortableWorldRuntimeContract {
  readonly schema_version: typeof PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION;
  readonly contract_id: string;
  readonly world: Readonly<{
    world_id: string;
    pack_id: string;
    pack_version: string;
    pack_sha256: string;
    profile: WorldAssetProfile;
    entry_scene: string;
    viewport: Readonly<{ width: number; height: number }>;
  }>;
  readonly spawn_points: readonly Readonly<{
    spawn_id: string;
    x: number;
    y: number;
  }>[];
  readonly entity_slots: readonly Readonly<{
    slot_id: string;
    kind: PortableRuntimeEntityKind;
    required: boolean;
    spawn_id: string;
    accepted_asset_kinds: readonly PortableRuntimeAssetKind[];
  }>[];
  readonly event_hooks: readonly Readonly<{
    hook_id: string;
    event: PortableRuntimeEvent;
    required: boolean;
    source_slot_id?: string;
  }>[];
}

export type PortableRuntimeMessageType =
  | 'runtime.prepare'
  | 'runtime.bind'
  | 'runtime.launch'
  | 'runtime.exit'
  | 'runtime.status';

export interface PortableRuntimePreparePayload {
  readonly runtime_contract: PortableWorldRuntimeContract;
}

export interface PortableRuntimeBindPayload {
  readonly contract_id: string;
  readonly session_id: string;
  readonly bindings: readonly Readonly<{
    slot_id: string;
    entity_id: string;
    asset_path: string;
    asset_sha256: string;
  }>[];
}

export interface PortableRuntimeLaunchPayload {
  readonly contract_id: string;
  readonly session_id: string;
  readonly spawn_id: string;
}

export interface PortableRuntimeExitPayload {
  readonly contract_id: string;
  readonly session_id: string;
  readonly reason: 'user-request' | 'world-complete' | 'runtime-error' | 'host-shutdown';
}

export interface PortableRuntimeStatusPayload {
  readonly contract_id: string;
  readonly session_id: string;
  readonly state: 'preparing' | 'ready' | 'running' | 'exiting' | 'exited' | 'error';
  readonly sequence: number;
  readonly detail_code?: string;
}

export type PortableRuntimePayloadByType = {
  readonly 'runtime.prepare': PortableRuntimePreparePayload;
  readonly 'runtime.bind': PortableRuntimeBindPayload;
  readonly 'runtime.launch': PortableRuntimeLaunchPayload;
  readonly 'runtime.exit': PortableRuntimeExitPayload;
  readonly 'runtime.status': PortableRuntimeStatusPayload;
};

export type PortableRuntimeBridgeMessage<T extends PortableRuntimeMessageType = PortableRuntimeMessageType> = {
  readonly [K in T]: Readonly<{
    schema_version: typeof PORTABLE_RUNTIME_BRIDGE_VERSION;
    message_type: K;
    idempotency_key: string;
    payload_sha256: string;
    payload: PortableRuntimePayloadByType[K];
  }>;
}[T];

export type PortableRuntimeContractErrorCode =
  | 'runtime.invalid-shape'
  | 'runtime.invalid-value'
  | 'runtime.invalid-reference'
  | 'runtime.payload-digest-mismatch';

export class PortableRuntimeContractError extends Error {
  constructor(readonly code: PortableRuntimeContractErrorCode, message: string) {
    super(message);
    this.name = 'PortableRuntimeContractError';
  }
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DETAIL_CODE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const PROFILES = Object.freeze([
  'side-platformer',
  'isometric-action',
  'topdown-farm',
  'layered-depth-2d',
] as const satisfies readonly WorldAssetProfile[]);

function fail(code: PortableRuntimeContractErrorCode, message: string): never {
  throw new PortableRuntimeContractError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || actual.some((key) => !allowed.has(key))) {
    fail('runtime.invalid-shape', `Object must contain ${required.join(', ')}${optional.length ? `; optional: ${optional.join(', ')}` : ''}.`);
  }
}

function text(value: unknown, label: string, maximum = 80): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || Array.from(value).length > maximum
    || CONTROL_CHARACTER.test(value)
  ) {
    fail('runtime.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function id(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!ID.test(normalized)) fail('runtime.invalid-value', `${label} must use lowercase kebab-case.`);
  return normalized;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('runtime.invalid-value', `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function safePath(value: unknown, label: string): string {
  const normalized = text(value, label, 240);
  if (!SAFE_PATH.test(normalized) || normalized.includes('..')) {
    fail('runtime.invalid-value', `${label} must be a portable relative path.`);
  }
  return normalized;
}

function finiteCoordinate(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    fail('runtime.invalid-value', `${label} must be a finite portable world coordinate.`);
  }
  return value;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    fail('runtime.invalid-value', `${label} must be unique.`);
  }
}

export function materializePortableWorldRuntimeContract(value: unknown): PortableWorldRuntimeContract {
  if (!isRecord(value)) fail('runtime.invalid-shape', 'Portable world runtime contract must be an object.');
  exactKeys(value, ['schema_version', 'contract_id', 'world', 'spawn_points', 'entity_slots', 'event_hooks']);
  if (value.schema_version !== PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION) {
    fail('runtime.invalid-value', `Runtime contract schema must be ${PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION}.`);
  }
  const contractId = id(value.contract_id, 'Contract id');
  if (!isRecord(value.world)) fail('runtime.invalid-shape', 'Runtime world must be an object.');
  exactKeys(value.world, [
    'world_id', 'pack_id', 'pack_version', 'pack_sha256', 'profile', 'entry_scene', 'viewport',
  ]);
  const packVersion = text(value.world.pack_version, 'Pack version', 64);
  if (!VERSION.test(packVersion)) fail('runtime.invalid-value', 'Pack version must be semantic version text.');
  if (!PROFILES.includes(value.world.profile as WorldAssetProfile)) {
    fail('runtime.invalid-value', 'Runtime world profile is unsupported.');
  }
  if (!isRecord(value.world.viewport)) fail('runtime.invalid-shape', 'Viewport must be an object.');
  exactKeys(value.world.viewport, ['width', 'height']);
  const viewport = {
    width: value.world.viewport.width,
    height: value.world.viewport.height,
  };
  if (
    !Number.isSafeInteger(viewport.width)
    || !Number.isSafeInteger(viewport.height)
    || (viewport.width as number) < 160
    || (viewport.height as number) < 90
    || (viewport.width as number) > 8192
    || (viewport.height as number) > 8192
  ) {
    fail('runtime.invalid-value', 'Viewport dimensions must be integers from 160x90 through 8192x8192.');
  }

  if (!Array.isArray(value.spawn_points) || value.spawn_points.length < 1 || value.spawn_points.length > 64) {
    fail('runtime.invalid-value', 'Runtime contract requires 1 to 64 spawn points.');
  }
  const spawnPoints = value.spawn_points.map((candidate, index) => {
    if (!isRecord(candidate)) fail('runtime.invalid-shape', `Spawn point ${index} must be an object.`);
    exactKeys(candidate, ['spawn_id', 'x', 'y']);
    return Object.freeze({
      spawn_id: id(candidate.spawn_id, `Spawn point ${index} id`),
      x: finiteCoordinate(candidate.x, `Spawn point ${index} x`),
      y: finiteCoordinate(candidate.y, `Spawn point ${index} y`),
    });
  });
  unique(spawnPoints.map(({ spawn_id }) => spawn_id), 'Spawn point ids');
  const spawnIds = new Set(spawnPoints.map(({ spawn_id }) => spawn_id));

  if (!Array.isArray(value.entity_slots) || value.entity_slots.length > 64) {
    fail('runtime.invalid-value', 'Runtime contract supports at most 64 entity slots.');
  }
  const entitySlots = value.entity_slots.map((candidate, index) => {
    if (!isRecord(candidate)) fail('runtime.invalid-shape', `Entity slot ${index} must be an object.`);
    exactKeys(candidate, ['slot_id', 'kind', 'required', 'spawn_id', 'accepted_asset_kinds']);
    if (!PORTABLE_RUNTIME_ENTITY_KINDS.includes(candidate.kind as PortableRuntimeEntityKind)) {
      fail('runtime.invalid-value', `Entity slot ${index} kind is unsupported.`);
    }
    if (typeof candidate.required !== 'boolean') {
      fail('runtime.invalid-value', `Entity slot ${index} required must be boolean.`);
    }
    if (!Array.isArray(candidate.accepted_asset_kinds) || candidate.accepted_asset_kinds.length < 1) {
      fail('runtime.invalid-value', `Entity slot ${index} requires accepted asset kinds.`);
    }
    const assetKinds = candidate.accepted_asset_kinds.map((kind) => {
      if (!PORTABLE_RUNTIME_ASSET_KINDS.includes(kind as PortableRuntimeAssetKind)) {
        fail('runtime.invalid-value', `Entity slot ${index} asset kind is unsupported.`);
      }
      return kind as PortableRuntimeAssetKind;
    });
    unique(assetKinds, `Entity slot ${index} accepted asset kinds`);
    const spawnId = id(candidate.spawn_id, `Entity slot ${index} spawn id`);
    if (!spawnIds.has(spawnId)) {
      fail('runtime.invalid-reference', `Entity slot ${index} references an unknown spawn point.`);
    }
    return Object.freeze({
      slot_id: id(candidate.slot_id, `Entity slot ${index} id`),
      kind: candidate.kind as PortableRuntimeEntityKind,
      required: candidate.required,
      spawn_id: spawnId,
      accepted_asset_kinds: Object.freeze(assetKinds),
    });
  });
  unique(entitySlots.map(({ slot_id }) => slot_id), 'Entity slot ids');
  const slotIds = new Set(entitySlots.map(({ slot_id }) => slot_id));

  if (!Array.isArray(value.event_hooks) || value.event_hooks.length > 64) {
    fail('runtime.invalid-value', 'Runtime contract supports at most 64 event hooks.');
  }
  const eventHooks = value.event_hooks.map((candidate, index) => {
    if (!isRecord(candidate)) fail('runtime.invalid-shape', `Event hook ${index} must be an object.`);
    exactKeys(candidate, ['hook_id', 'event', 'required'], ['source_slot_id']);
    if (!PORTABLE_RUNTIME_EVENTS.includes(candidate.event as PortableRuntimeEvent)) {
      fail('runtime.invalid-value', `Event hook ${index} event is unsupported.`);
    }
    if (typeof candidate.required !== 'boolean') {
      fail('runtime.invalid-value', `Event hook ${index} required must be boolean.`);
    }
    const sourceSlotId = candidate.source_slot_id === undefined
      ? undefined
      : id(candidate.source_slot_id, `Event hook ${index} source slot id`);
    if (sourceSlotId && !slotIds.has(sourceSlotId)) {
      fail('runtime.invalid-reference', `Event hook ${index} references an unknown entity slot.`);
    }
    return Object.freeze({
      hook_id: id(candidate.hook_id, `Event hook ${index} id`),
      event: candidate.event as PortableRuntimeEvent,
      required: candidate.required,
      ...(sourceSlotId ? { source_slot_id: sourceSlotId } : {}),
    });
  });
  unique(eventHooks.map(({ hook_id }) => hook_id), 'Event hook ids');

  return Object.freeze({
    schema_version: PORTABLE_WORLD_RUNTIME_CONTRACT_VERSION,
    contract_id: contractId,
    world: Object.freeze({
      world_id: id(value.world.world_id, 'World id'),
      pack_id: id(value.world.pack_id, 'Pack id'),
      pack_version: packVersion,
      pack_sha256: hash(value.world.pack_sha256, 'Pack digest'),
      profile: value.world.profile as WorldAssetProfile,
      entry_scene: safePath(value.world.entry_scene, 'Entry scene'),
      viewport: Object.freeze({
        width: viewport.width as number,
        height: viewport.height as number,
      }),
    }),
    spawn_points: Object.freeze(spawnPoints),
    entity_slots: Object.freeze(entitySlots),
    event_hooks: Object.freeze(eventHooks),
  });
}

function contractReference(record: Record<string, unknown>, contract?: PortableWorldRuntimeContract): {
  contract_id: string;
  session_id: string;
} {
  const contractId = id(record.contract_id, 'Payload contract id');
  if (contract && contractId !== contract.contract_id) {
    fail('runtime.invalid-reference', 'Message contract id does not match the runtime contract.');
  }
  return {
    contract_id: contractId,
    session_id: id(record.session_id, 'Runtime session id'),
  };
}

function materializePayload(
  messageType: PortableRuntimeMessageType,
  value: unknown,
  contract?: PortableWorldRuntimeContract,
): PortableRuntimePayloadByType[PortableRuntimeMessageType] {
  if (!isRecord(value)) fail('runtime.invalid-shape', 'Runtime message payload must be an object.');
  if (messageType === 'runtime.prepare') {
    exactKeys(value, ['runtime_contract']);
    const runtimeContract = materializePortableWorldRuntimeContract(value.runtime_contract);
    if (contract && runtimeContract.contract_id !== contract.contract_id) {
      fail('runtime.invalid-reference', 'Prepare payload does not match the supplied runtime contract.');
    }
    return Object.freeze({ runtime_contract: runtimeContract });
  }
  if (messageType === 'runtime.bind') {
    exactKeys(value, ['contract_id', 'session_id', 'bindings']);
    const reference = contractReference(value, contract);
    if (!Array.isArray(value.bindings) || value.bindings.length < 1 || value.bindings.length > 64) {
      fail('runtime.invalid-value', 'Bind payload requires 1 to 64 entity bindings.');
    }
    const bindings = value.bindings.map((candidate, index) => {
      if (!isRecord(candidate)) fail('runtime.invalid-shape', `Entity binding ${index} must be an object.`);
      exactKeys(candidate, ['slot_id', 'entity_id', 'asset_path', 'asset_sha256']);
      const slotId = id(candidate.slot_id, `Entity binding ${index} slot id`);
      if (contract && !contract.entity_slots.some(({ slot_id }) => slot_id === slotId)) {
        fail('runtime.invalid-reference', `Entity binding ${index} references an unknown entity slot.`);
      }
      return Object.freeze({
        slot_id: slotId,
        entity_id: id(candidate.entity_id, `Entity binding ${index} entity id`),
        asset_path: safePath(candidate.asset_path, `Entity binding ${index} asset path`),
        asset_sha256: hash(candidate.asset_sha256, `Entity binding ${index} asset digest`),
      });
    });
    unique(bindings.map(({ slot_id }) => slot_id), 'Bound entity slot ids');
    return Object.freeze({ ...reference, bindings: Object.freeze(bindings) });
  }
  if (messageType === 'runtime.launch') {
    exactKeys(value, ['contract_id', 'session_id', 'spawn_id']);
    const reference = contractReference(value, contract);
    const spawnId = id(value.spawn_id, 'Launch spawn id');
    if (contract && !contract.spawn_points.some(({ spawn_id }) => spawn_id === spawnId)) {
      fail('runtime.invalid-reference', 'Launch payload references an unknown spawn point.');
    }
    return Object.freeze({ ...reference, spawn_id: spawnId });
  }
  if (messageType === 'runtime.exit') {
    exactKeys(value, ['contract_id', 'session_id', 'reason']);
    const reference = contractReference(value, contract);
    const reasons: readonly PortableRuntimeExitPayload['reason'][] = [
      'user-request', 'world-complete', 'runtime-error', 'host-shutdown',
    ];
    if (!reasons.includes(value.reason as PortableRuntimeExitPayload['reason'])) {
      fail('runtime.invalid-value', 'Exit reason is unsupported.');
    }
    return Object.freeze({ ...reference, reason: value.reason as PortableRuntimeExitPayload['reason'] });
  }
  exactKeys(value, ['contract_id', 'session_id', 'state', 'sequence'], ['detail_code']);
  const reference = contractReference(value, contract);
  const states: readonly PortableRuntimeStatusPayload['state'][] = [
    'preparing', 'ready', 'running', 'exiting', 'exited', 'error',
  ];
  if (!states.includes(value.state as PortableRuntimeStatusPayload['state'])) {
    fail('runtime.invalid-value', 'Runtime status state is unsupported.');
  }
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
    fail('runtime.invalid-value', 'Runtime status sequence must be a non-negative safe integer.');
  }
  const detailCode = value.detail_code === undefined ? undefined : text(value.detail_code, 'Status detail code', 80);
  if (detailCode && !DETAIL_CODE.test(detailCode)) {
    fail('runtime.invalid-value', 'Status detail code must be a neutral dotted code.');
  }
  return Object.freeze({
    ...reference,
    state: value.state as PortableRuntimeStatusPayload['state'],
    sequence: value.sequence as number,
    ...(detailCode ? { detail_code: detailCode } : {}),
  });
}

export function materializePortableRuntimeMessage(
  value: unknown,
  contractValue?: unknown,
): PortableRuntimeBridgeMessage {
  if (!isRecord(value)) fail('runtime.invalid-shape', 'Portable runtime message must be an object.');
  exactKeys(value, ['schema_version', 'message_type', 'idempotency_key', 'payload_sha256', 'payload']);
  if (value.schema_version !== PORTABLE_RUNTIME_BRIDGE_VERSION) {
    fail('runtime.invalid-value', `Runtime bridge schema must be ${PORTABLE_RUNTIME_BRIDGE_VERSION}.`);
  }
  const messageTypes: readonly PortableRuntimeMessageType[] = [
    'runtime.prepare', 'runtime.bind', 'runtime.launch', 'runtime.exit', 'runtime.status',
  ];
  if (!messageTypes.includes(value.message_type as PortableRuntimeMessageType)) {
    fail('runtime.invalid-value', 'Runtime message type is unsupported.');
  }
  if (typeof value.idempotency_key !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotency_key)) {
    fail('runtime.invalid-value', 'Runtime idempotency key is invalid.');
  }
  const contract = contractValue === undefined
    ? undefined
    : materializePortableWorldRuntimeContract(contractValue);
  const messageType = value.message_type as PortableRuntimeMessageType;
  return Object.freeze({
    schema_version: PORTABLE_RUNTIME_BRIDGE_VERSION,
    message_type: messageType,
    idempotency_key: value.idempotency_key,
    payload_sha256: hash(value.payload_sha256, 'Payload digest'),
    payload: materializePayload(messageType, value.payload, contract),
  }) as PortableRuntimeBridgeMessage;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('runtime.invalid-value', 'Canonical runtime payload cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) fail('runtime.invalid-value', 'Canonical runtime payload contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function fingerprintPortableRuntimePayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function assertPortableRuntimeMessagePayloadDigest(
  value: unknown,
  contractValue?: unknown,
): Promise<PortableRuntimeBridgeMessage> {
  const message = materializePortableRuntimeMessage(value, contractValue);
  if (await fingerprintPortableRuntimePayload(message.payload) !== message.payload_sha256) {
    fail('runtime.payload-digest-mismatch', 'Runtime message payload digest does not match its canonical payload.');
  }
  return message;
}

export async function createPortableRuntimeMessage<T extends PortableRuntimeMessageType>(
  messageType: T,
  idempotencyKey: string,
  payload: PortableRuntimePayloadByType[T],
  contractValue?: unknown,
): Promise<PortableRuntimeBridgeMessage<T>> {
  const payloadSha256 = await fingerprintPortableRuntimePayload(payload);
  return assertPortableRuntimeMessagePayloadDigest({
    schema_version: PORTABLE_RUNTIME_BRIDGE_VERSION,
    message_type: messageType,
    idempotency_key: idempotencyKey,
    payload_sha256: payloadSha256,
    payload,
  }, contractValue) as Promise<PortableRuntimeBridgeMessage<T>>;
}
