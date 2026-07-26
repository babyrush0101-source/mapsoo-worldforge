import { parseStrictJsonDocument, type StrictJsonImportErrorCode } from '../../adapters/import-world-spec';
import {
  ALPHA6_WORLD_SCHEMA_VERSION,
  WORLD_SCHEMA_VERSION,
  migrateWorldSpecV020,
  type WorldSpecV020,
  type WorldSpecV030,
} from '../../core/world-spec';
import {
  projectExternalHostAssetRequest,
  EXTERNAL_HOST_ASSET_REQUEST_EXTENSION,
  ExternalHostAssetRequestError,
  type ExternalHostAssetRequestErrorCode,
} from './asset-request';

export const EXTERNAL_HOST_MAPSOO_EXPORT_SCHEMA_VERSION = 'org.mapsoo.externalhost.mapsoo-export-receipt/1.0.0' as const;

export type ExternalHostExportBridgeErrorCode = StrictJsonImportErrorCode | ExternalHostAssetRequestErrorCode | 'export.invalid-binding';

export class ExternalHostExportBridgeError extends Error {
  constructor(readonly code: ExternalHostExportBridgeErrorCode, message: string) {
    super(message);
    this.name = 'ExternalHostExportBridgeError';
  }
}

export interface ExternalHostPublicPackBinding {
  readonly packId: string;
  readonly assetRequestSha256: string;
  readonly externalHostWorldId: string;
  readonly externalHostWorldVersion: string;
  readonly sceneId: string;
  readonly requiredSceneTags: readonly string[];
  readonly contentRating: string;
}

export interface PreparedExternalHostPackExport {
  readonly worldSpec: WorldSpecV030;
  readonly binding: ExternalHostPublicPackBinding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExternalHostExportBridgeError('export.invalid-binding', `Projected External Host binding is missing ${key}.`);
  }
  return value;
}

function snapshotBinding(worldSpec: WorldSpecV030, assetRequestSha256: string): ExternalHostPublicPackBinding {
  const extension = worldSpec.extensions?.[EXTERNAL_HOST_ASSET_REQUEST_EXTENSION];
  if (!isRecord(extension)) {
    throw new ExternalHostExportBridgeError('export.invalid-binding', 'Projected World Spec is missing the External Host binding.');
  }
  const tags = extension.requiredSceneTags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
    throw new ExternalHostExportBridgeError('export.invalid-binding', 'Projected External Host binding has invalid scene tags.');
  }
  if (requiredText(extension, 'assetRequestSha256') !== assetRequestSha256) {
    throw new ExternalHostExportBridgeError('export.invalid-binding', 'Projected External Host request hash does not match its binding.');
  }
  return Object.freeze({
    packId: worldSpec.id,
    assetRequestSha256,
    externalHostWorldId: requiredText(extension, 'externalHostWorldId'),
    externalHostWorldVersion: requiredText(extension, 'externalHostWorldVersion'),
    sceneId: requiredText(extension, 'sceneId'),
    requiredSceneTags: Object.freeze([...tags]),
    contentRating: requiredText(extension, 'contentRating'),
  });
}

/**
 * Validates the public-safe External Host request and losslessly advances its World
 * Spec 0.2 projection to the current Alpha.7 export contract. It deliberately
 * invents neither semantic places nor structures.
 */
export async function prepareExternalHostPackExport(jsonText: string): Promise<PreparedExternalHostPackExport> {
  const parsed = parseStrictJsonDocument(jsonText, 'External Host Asset Request');
  if (!parsed.ok) throw new ExternalHostExportBridgeError(parsed.code, parsed.message);

  let projection;
  try {
    projection = await projectExternalHostAssetRequest(parsed.value);
  } catch (error) {
    if (error instanceof ExternalHostAssetRequestError) {
      throw new ExternalHostExportBridgeError(error.code, error.message);
    }
    throw error;
  }

  if (projection.worldSpec.schemaVersion !== WORLD_SCHEMA_VERSION) {
    throw new ExternalHostExportBridgeError(
      'export.invalid-binding',
      `External Host Asset Request 1.0 must project to World Spec ${WORLD_SCHEMA_VERSION}.`,
    );
  }
  const worldSpec = migrateWorldSpecV020(projection.worldSpec as WorldSpecV020);
  if (worldSpec.schemaVersion !== ALPHA6_WORLD_SCHEMA_VERSION || worldSpec.places || worldSpec.structures) {
    throw new ExternalHostExportBridgeError(
      'export.invalid-binding',
      'The External Host export bridge must not invent semantic places or structures.',
    );
  }
  const binding = snapshotBinding(worldSpec, projection.assetRequestSha256);
  return Object.freeze({ worldSpec: structuredClone(worldSpec), binding });
}
