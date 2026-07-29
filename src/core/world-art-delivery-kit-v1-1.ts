import {
  buildWorldArtDeliveryKitManifest,
  type WorldArtDeliveryKitDraft,
  type WorldArtDeliveryKitManifest,
} from './world-art-delivery-kit';

export const WORLD_ART_DELIVERY_KIT_V1_1_VERSION = '1.1.0' as const;

export type WorldArtDeliveryKitV1_1Manifest = Omit<
  WorldArtDeliveryKitManifest,
  'schema_version' | 'compatibility'
> & Readonly<{
  schema_version: typeof WORLD_ART_DELIVERY_KIT_V1_1_VERSION;
  compatibility: Readonly<{
    engine: 'godot';
    tested_versions: readonly ['4.3', '4.7'];
    importer: 'mapsoo-importer';
    asset_contract: 'world-art-runtime-overlay-1.1';
  }>;
}>;

export type WorldArtDeliveryKitV1_1Draft = Omit<
  WorldArtDeliveryKitV1_1Manifest,
  'delivery_id'
>;

export class WorldArtDeliveryKitV1_1Error extends Error {
  constructor(
    readonly code:
      | 'world-art-delivery-1.1.invalid-shape'
      | 'world-art-delivery-1.1.invalid-value'
      | 'world-art-delivery-1.1.invalid-binding',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'WorldArtDeliveryKitV1_1Error';
  }
}

type MutableRecord = Record<string, unknown>;

const DELIVERY_ID = /^world-art-delivery-[a-f0-9]{16}$/;

function fail(
  code: WorldArtDeliveryKitV1_1Error['code'],
  message: string,
  cause?: unknown,
): never {
  throw new WorldArtDeliveryKitV1_1Error(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isRecord(value: unknown): value is MutableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(
        'world-art-delivery-1.1.invalid-value',
        'Delivery manifest contains a non-finite number.',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (!isRecord(value)) {
    fail(
      'world-art-delivery-1.1.invalid-value',
      'Delivery manifest contains an unsupported value.',
    );
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function materializeDraft(
  value: unknown,
): Promise<WorldArtDeliveryKitV1_1Draft> {
  if (!isRecord(value)) {
    return fail(
      'world-art-delivery-1.1.invalid-shape',
      'Delivery manifest 1.1 must be an object.',
    );
  }
  if (
    value.schema_version !== WORLD_ART_DELIVERY_KIT_V1_1_VERSION
    || value.document_type !== 'world-art-delivery-kit'
    || !isRecord(value.compatibility)
    || value.compatibility.asset_contract
      !== 'world-art-runtime-overlay-1.1'
  ) {
    return fail(
      'world-art-delivery-1.1.invalid-value',
      'Delivery manifest 1.1 identity or asset contract is invalid.',
    );
  }
  const {
    delivery_id: _deliveryId,
    schema_version: _schemaVersion,
    compatibility: compatibilityValue,
    ...payload
  } = value;
  void _deliveryId;
  void _schemaVersion;
  const compatibility = compatibilityValue as MutableRecord;
  let validated: WorldArtDeliveryKitManifest;
  try {
    validated = await buildWorldArtDeliveryKitManifest({
      ...payload,
      schema_version: '1.0.0',
      document_type: 'world-art-delivery-kit',
      compatibility: {
        ...compatibility,
        asset_contract: 'world-art-runtime-overlay-1.0',
      },
    } as WorldArtDeliveryKitDraft);
  } catch (error) {
    return fail(
      'world-art-delivery-1.1.invalid-shape',
      'Delivery manifest 1.1 payload is invalid.',
      error,
    );
  }
  const {
    delivery_id: _ValidatedDeliveryId,
    schema_version: _ValidatedSchemaVersion,
    compatibility: validatedCompatibility,
    ...validatedPayload
  } = validated;
  void _ValidatedDeliveryId;
  void _ValidatedSchemaVersion;
  return Object.freeze({
    ...validatedPayload,
    schema_version: WORLD_ART_DELIVERY_KIT_V1_1_VERSION,
    document_type: 'world-art-delivery-kit' as const,
    compatibility: Object.freeze({
      ...validatedCompatibility,
      asset_contract: 'world-art-runtime-overlay-1.1' as const,
    }),
  });
}

export async function materializeWorldArtDeliveryKitV1_1(
  value: unknown,
): Promise<WorldArtDeliveryKitV1_1Manifest> {
  if (
    !isRecord(value)
    || typeof value.delivery_id !== 'string'
    || !DELIVERY_ID.test(value.delivery_id)
  ) {
    return fail(
      'world-art-delivery-1.1.invalid-binding',
      'Delivery manifest 1.1 id is invalid.',
    );
  }
  const draft = await materializeDraft(value);
  const expectedId = `world-art-delivery-${(await sha256(draft)).slice(0, 16)}`;
  if (value.delivery_id !== expectedId) {
    return fail(
      'world-art-delivery-1.1.invalid-binding',
      'Delivery manifest 1.1 id is stale.',
    );
  }
  return Object.freeze({
    ...draft,
    delivery_id: value.delivery_id,
  });
}

export async function buildWorldArtDeliveryKitManifestV1_1(
  draft: WorldArtDeliveryKitV1_1Draft,
): Promise<WorldArtDeliveryKitV1_1Manifest> {
  const validatedDraft = await materializeDraft(draft);
  return materializeWorldArtDeliveryKitV1_1({
    ...validatedDraft,
    delivery_id: `world-art-delivery-${(
      await sha256(validatedDraft)
    ).slice(0, 16)}`,
  });
}

export async function serializeCanonicalWorldArtDeliveryKitV1_1(
  value: unknown,
): Promise<Uint8Array> {
  const manifest = await materializeWorldArtDeliveryKitV1_1(value);
  return new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
}

export async function fingerprintWorldArtDeliveryKitV1_1(
  value: unknown,
): Promise<string> {
  return sha256(await materializeWorldArtDeliveryKitV1_1(value));
}
