import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from './asset-profile';

export const WORLD_ART_DELIVERY_KIT_VERSION = '1.0.0' as const;
export const WORLD_ART_DELIVERY_MANIFEST_PATH =
  'world-art-delivery.json' as const;

export interface WorldArtDeliveryFile {
  readonly path: string;
  readonly media_type:
    | 'application/json'
    | 'application/zip'
    | 'image/png'
    | 'video/mp4'
    | 'video/x-msvideo'
    | 'text/markdown'
    | 'text/plain';
  readonly bytes: number;
  readonly sha256: string;
}

export interface WorldArtDeliveryKitManifest {
  readonly schema_version: typeof WORLD_ART_DELIVERY_KIT_VERSION;
  readonly document_type: 'world-art-delivery-kit';
  readonly delivery_id: string;
  readonly pack: Readonly<{
    id: string;
    title: string;
    version: string;
  }>;
  readonly profile: WorldAssetProfile;
  readonly distribution: 'private' | 'public';
  readonly license: Readonly<{
    id:
      | 'LicenseRef-Proprietary'
      | 'CC0-1.0'
      | 'CC-BY-4.0'
      | 'CC-BY-SA-4.0';
    permits_redistribution: boolean;
    attribution?: string;
  }>;
  readonly content: Readonly<{
    runtime_overlay: Readonly<{
      path: string;
      overlay_id: string;
      bytes: number;
      sha256: string;
      projection_sha256: string;
    }>;
    production_world_review: Readonly<{
      path: string;
      sha256: string;
    }>;
    human_art_review: Readonly<{
      path: string;
      sha256: string;
    }>;
    preview: Readonly<{
      path: string;
      sha256: string;
      width: number;
      height: number;
    }>;
  }>;
  readonly compatibility: Readonly<{
    engine: 'godot';
    tested_versions: readonly ['4.3', '4.7'];
    importer: 'mapsoo-importer';
    asset_contract: 'world-art-runtime-overlay-1.0';
  }>;
  readonly ai_disclosure: Readonly<{
    contains_generative_ai: boolean;
    human_curated: true;
    original_references_embedded: false;
  }>;
  readonly files: readonly WorldArtDeliveryFile[];
}

export type WorldArtDeliveryKitDraft = Omit<
  WorldArtDeliveryKitManifest,
  'delivery_id'
>;

export type WorldArtDeliveryKitIssueCode =
  | 'world-art-delivery.invalid-shape'
  | 'world-art-delivery.invalid-value'
  | 'world-art-delivery.invalid-rights'
  | 'world-art-delivery.invalid-file'
  | 'world-art-delivery.invalid-order'
  | 'world-art-delivery.invalid-binding';

export class WorldArtDeliveryKitError extends Error {
  constructor(
    readonly code: WorldArtDeliveryKitIssueCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorldArtDeliveryKitError';
  }
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OVERLAY_ID = /^world-art-runtime-overlay-[a-f0-9]{16}$/;
const DELIVERY_ID = /^world-art-delivery-[a-f0-9]{16}$/;
const SAFE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
const MEDIA_TYPES = Object.freeze([
  'application/json',
  'application/zip',
  'image/png',
  'video/mp4',
  'video/x-msvideo',
  'text/markdown',
  'text/plain',
] as const);
const PUBLIC_LICENSES = Object.freeze([
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
] as const);

function fail(code: WorldArtDeliveryKitIssueCode, message: string): never {
  throw new WorldArtDeliveryKitError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])
  ) {
    fail(
      'world-art-delivery.invalid-shape',
      `${label} contains missing or unsupported fields.`,
    );
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('world-art-delivery.invalid-value', 'Manifest contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) {
    fail('world-art-delivery.invalid-value', 'Manifest contains an unsupported value.');
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

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    fail('world-art-delivery.invalid-value', `${label} must be SHA-256.`);
  }
  return value;
}

function positiveInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail('world-art-delivery.invalid-value', `${label} is out of bounds.`);
  }
  return value as number;
}

function safePath(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.includes('\\')
    || value.startsWith('/')
  ) {
    fail('world-art-delivery.invalid-file', `${label} must be a safe relative path.`);
  }
  return value;
}

function text(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f]/.test(value)
  ) {
    fail('world-art-delivery.invalid-value', `${label} is invalid.`);
  }
  return value;
}

function materializeFile(value: unknown, index: number): WorldArtDeliveryFile {
  if (!isRecord(value)) {
    fail('world-art-delivery.invalid-file', `File ${index} is invalid.`);
  }
  exactKeys(value, ['path', 'media_type', 'bytes', 'sha256'], `File ${index}`);
  const path = safePath(value.path, `File ${index} path`);
  if (
    !MEDIA_TYPES.includes(value.media_type as WorldArtDeliveryFile['media_type'])
    || (value.media_type === 'application/json' && !path.endsWith('.json'))
    || (value.media_type === 'application/zip' && !path.endsWith('.zip'))
    || (value.media_type === 'image/png' && !path.endsWith('.png'))
    || (value.media_type === 'video/mp4' && !path.endsWith('.mp4'))
    || (value.media_type === 'video/x-msvideo' && !path.endsWith('.avi'))
    || (value.media_type === 'text/markdown' && !path.endsWith('.md'))
  ) {
    fail('world-art-delivery.invalid-file', `File ${index} media type is invalid.`);
  }
  return Object.freeze({
    path,
    media_type: value.media_type as WorldArtDeliveryFile['media_type'],
    bytes: positiveInteger(value.bytes, 256 * 1024 * 1024, `File ${index} bytes`),
    sha256: digest(value.sha256, `File ${index} SHA-256`),
  });
}

export async function materializeWorldArtDeliveryKit(
  value: unknown,
): Promise<WorldArtDeliveryKitManifest> {
  if (!isRecord(value)) {
    fail('world-art-delivery.invalid-shape', 'Delivery manifest must be an object.');
  }
  exactKeys(value, [
    'schema_version',
    'document_type',
    'delivery_id',
    'pack',
    'profile',
    'distribution',
    'license',
    'content',
    'compatibility',
    'ai_disclosure',
    'files',
  ], 'Delivery manifest');
  if (
    value.schema_version !== WORLD_ART_DELIVERY_KIT_VERSION
    || value.document_type !== 'world-art-delivery-kit'
    || typeof value.delivery_id !== 'string'
    || !DELIVERY_ID.test(value.delivery_id)
    || !isWorldAssetProfile(value.profile)
    || !isRecord(value.pack)
    || !isRecord(value.license)
    || !isRecord(value.content)
    || !isRecord(value.compatibility)
    || !isRecord(value.ai_disclosure)
    || !Array.isArray(value.files)
    || value.files.length < 7
    || value.files.length > 160
  ) {
    fail('world-art-delivery.invalid-value', 'Delivery identity is invalid.');
  }
  exactKeys(value.pack, ['id', 'title', 'version'], 'Pack');
  if (
    typeof value.pack.id !== 'string'
    || !SAFE_ID.test(value.pack.id)
    || value.pack.id.length > 80
    || typeof value.pack.version !== 'string'
    || !SEMVER.test(value.pack.version)
  ) {
    fail('world-art-delivery.invalid-value', 'Pack id or version is invalid.');
  }
  const pack = Object.freeze({
    id: value.pack.id,
    title: text(value.pack.title, 160, 'Pack title'),
    version: value.pack.version,
  });
  exactKeys(
    value.license,
    value.license.attribution === undefined
      ? ['id', 'permits_redistribution']
      : ['id', 'permits_redistribution', 'attribution'],
    'License',
  );
  const distribution = value.distribution;
  const licenseId = value.license.id;
  if (
    (distribution !== 'private' && distribution !== 'public')
    || (
      distribution === 'private'
      && (
        licenseId !== 'LicenseRef-Proprietary'
        || value.license.permits_redistribution !== false
        || value.license.attribution !== undefined
      )
    )
    || (
      distribution === 'public'
      && (
        !(PUBLIC_LICENSES as readonly unknown[]).includes(licenseId)
        || value.license.permits_redistribution !== true
      )
    )
    || (
      (licenseId === 'CC-BY-4.0' || licenseId === 'CC-BY-SA-4.0')
      && value.license.attribution === undefined
    )
  ) {
    fail('world-art-delivery.invalid-rights', 'Delivery rights are inconsistent.');
  }
  const license = Object.freeze({
    id: licenseId as WorldArtDeliveryKitManifest['license']['id'],
    permits_redistribution: value.license.permits_redistribution as boolean,
    ...(value.license.attribution === undefined
      ? {}
      : { attribution: text(value.license.attribution, 500, 'Attribution') }),
  });
  exactKeys(value.content, [
    'runtime_overlay',
    'production_world_review',
    'human_art_review',
    'preview',
  ], 'Content');
  if (
    !isRecord(value.content.runtime_overlay)
    || !isRecord(value.content.production_world_review)
    || !isRecord(value.content.human_art_review)
    || !isRecord(value.content.preview)
  ) {
    fail('world-art-delivery.invalid-shape', 'Delivery content records are invalid.');
  }
  exactKeys(value.content.runtime_overlay, [
    'path',
    'overlay_id',
    'bytes',
    'sha256',
    'projection_sha256',
  ], 'Runtime overlay content');
  exactKeys(
    value.content.production_world_review,
    ['path', 'sha256'],
    'Production review content',
  );
  exactKeys(
    value.content.human_art_review,
    ['path', 'sha256'],
    'Human review content',
  );
  exactKeys(
    value.content.preview,
    ['path', 'sha256', 'width', 'height'],
    'Preview content',
  );
  if (
    typeof value.content.runtime_overlay.overlay_id !== 'string'
    || !OVERLAY_ID.test(value.content.runtime_overlay.overlay_id)
  ) {
    fail('world-art-delivery.invalid-binding', 'Runtime overlay id is invalid.');
  }
  const content = Object.freeze({
    runtime_overlay: Object.freeze({
      path: safePath(value.content.runtime_overlay.path, 'Runtime overlay path'),
      overlay_id: value.content.runtime_overlay.overlay_id,
      bytes: positiveInteger(
        value.content.runtime_overlay.bytes,
        256 * 1024 * 1024,
        'Runtime overlay bytes',
      ),
      sha256: digest(value.content.runtime_overlay.sha256, 'Runtime overlay SHA-256'),
      projection_sha256: digest(
        value.content.runtime_overlay.projection_sha256,
        'Runtime projection SHA-256',
      ),
    }),
    production_world_review: Object.freeze({
      path: safePath(
        value.content.production_world_review.path,
        'Production review path',
      ),
      sha256: digest(
        value.content.production_world_review.sha256,
        'Production review SHA-256',
      ),
    }),
    human_art_review: Object.freeze({
      path: safePath(value.content.human_art_review.path, 'Human review path'),
      sha256: digest(value.content.human_art_review.sha256, 'Human review SHA-256'),
    }),
    preview: Object.freeze({
      path: safePath(value.content.preview.path, 'Preview path'),
      sha256: digest(value.content.preview.sha256, 'Preview SHA-256'),
      width: positiveInteger(value.content.preview.width, 8192, 'Preview width'),
      height: positiveInteger(value.content.preview.height, 8192, 'Preview height'),
    }),
  });
  exactKeys(
    value.compatibility,
    ['engine', 'tested_versions', 'importer', 'asset_contract'],
    'Compatibility',
  );
  if (
    value.compatibility.engine !== 'godot'
    || !Array.isArray(value.compatibility.tested_versions)
    || value.compatibility.tested_versions.length !== 2
    || value.compatibility.tested_versions[0] !== '4.3'
    || value.compatibility.tested_versions[1] !== '4.7'
    || value.compatibility.importer !== 'mapsoo-importer'
    || value.compatibility.asset_contract !== 'world-art-runtime-overlay-1.0'
  ) {
    fail('world-art-delivery.invalid-value', 'Compatibility declaration is invalid.');
  }
  const compatibility = Object.freeze({
    engine: 'godot' as const,
    tested_versions: Object.freeze(['4.3', '4.7'] as const),
    importer: 'mapsoo-importer' as const,
    asset_contract: 'world-art-runtime-overlay-1.0' as const,
  });
  exactKeys(
    value.ai_disclosure,
    ['contains_generative_ai', 'human_curated', 'original_references_embedded'],
    'AI disclosure',
  );
  if (
    typeof value.ai_disclosure.contains_generative_ai !== 'boolean'
    || value.ai_disclosure.human_curated !== true
    || value.ai_disclosure.original_references_embedded !== false
  ) {
    fail('world-art-delivery.invalid-value', 'AI disclosure is invalid.');
  }
  const aiDisclosure = Object.freeze({
    contains_generative_ai: value.ai_disclosure.contains_generative_ai,
    human_curated: true as const,
    original_references_embedded: false as const,
  });
  const files = Object.freeze(value.files.map(materializeFile));
  if (
    new Set(files.map(({ path }) => path)).size !== files.length
    || files.some((file, index) =>
      index > 0 && files[index - 1]!.path.localeCompare(file.path, 'en') >= 0)
  ) {
    fail('world-art-delivery.invalid-order', 'Delivery files must be unique and sorted.');
  }
  const required = [
    [content.runtime_overlay.path, 'application/zip', content.runtime_overlay.sha256],
    [
      content.production_world_review.path,
      'application/json',
      content.production_world_review.sha256,
    ],
    [content.human_art_review.path, 'application/json', content.human_art_review.sha256],
    [content.preview.path, 'image/png', content.preview.sha256],
  ] as const;
  if (
    required.some(([path, mediaType, expectedSha]) => {
      const file = files.find((candidate) => candidate.path === path);
      return !file || file.media_type !== mediaType || file.sha256 !== expectedSha;
    })
    || files.some(({ path }) => path === WORLD_ART_DELIVERY_MANIFEST_PATH)
    || !files.some(({ path }) => path === 'readme.md')
    || !files.some(({ path }) => path === 'license-assets.md')
    || !files.some(({ path }) => path === 'changelog.md')
  ) {
    fail('world-art-delivery.invalid-binding', 'Delivery content is not bound to its files.');
  }
  const manifest = Object.freeze({
    schema_version: WORLD_ART_DELIVERY_KIT_VERSION,
    document_type: 'world-art-delivery-kit' as const,
    delivery_id: value.delivery_id,
    pack,
    profile: value.profile,
    distribution: distribution as 'private' | 'public',
    license,
    content,
    compatibility,
    ai_disclosure: aiDisclosure,
    files,
  });
  const { delivery_id: _deliveryId, ...payload } = manifest;
  void _deliveryId;
  const expectedId = `world-art-delivery-${(await sha256(payload)).slice(0, 16)}`;
  if (manifest.delivery_id !== expectedId) {
    fail('world-art-delivery.invalid-binding', 'Delivery id is stale.');
  }
  return manifest;
}

export async function buildWorldArtDeliveryKitManifest(
  draft: WorldArtDeliveryKitDraft,
): Promise<WorldArtDeliveryKitManifest> {
  const deliveryId = `world-art-delivery-${(await sha256(draft)).slice(0, 16)}`;
  return materializeWorldArtDeliveryKit({
    ...draft,
    delivery_id: deliveryId,
  });
}

export async function serializeCanonicalWorldArtDeliveryKit(
  value: unknown,
): Promise<Uint8Array> {
  const manifest = await materializeWorldArtDeliveryKit(value);
  return new TextEncoder().encode(`${canonicalJson(manifest)}\n`);
}
