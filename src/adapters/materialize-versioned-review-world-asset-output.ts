import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import reviewSchema from '../../schemas/mapsoo-production-art-pack-review-1.0.schema.json';
import reviewManifestSchema from '../../schemas/mapsoo-production-review-pack-manifest-1.0.schema.json';
import {
  GENERATED_ASSET_BUNDLE_SCHEMA_VERSION,
  TOPDOWN_FARM_COMPLETENESS_POLICY,
  TOPDOWN_FARM_REQUIRED_ROLES,
  type CharacterAction,
  type CharacterDirection,
  type GeneratedAssetBundle,
  type GeneratedAssetKind,
  type GeneratedAssetRecord,
} from '../core/generated-asset-bundle';
import {
  assertCompleteSidePlatformerAssetBundle,
  requiredSidePlatformerKind,
  SIDE_PLATFORMER_ASSET_BUNDLE_SCHEMA_VERSION,
  SIDE_PLATFORMER_COMPLETENESS_POLICY,
  SIDE_PLATFORMER_REQUIRED_ROLES,
} from '../core/side-platformer-asset-bundle';
import {
  assertCompleteIsometricActionAssetBundle,
  ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION,
  ISOMETRIC_ACTION_COMPLETENESS_POLICY,
  ISOMETRIC_ACTION_REQUIRED_ROLES,
  requiredIsometricActionKind,
} from '../core/isometric-action-asset-bundle';
import { assertCompleteTopdownFarmAssetBundle } from '../core/generated-asset-bundle';
import {
  assertAlpha9PackManifest,
  type Alpha9PackManifest,
} from '../core/pack-manifest-alpha9';
import {
  materializeAlpha10Runtime,
  validateAlpha10PackManifest,
  type Alpha10CollisionSidecar,
  type Alpha10NavigationSidecar,
  type Alpha10PackManifest,
  type Alpha10SceneSidecar,
} from '../core/pack-manifest-alpha10';
import {
  materializeAlpha11Runtime,
  validateAlpha11PackManifest,
  type Alpha11CollisionSidecar,
  type Alpha11NavigationSidecar,
  type Alpha11PackManifest,
  type Alpha11SceneSidecar,
} from '../core/pack-manifest-alpha11';
import {
  fingerprintGenerationRequestV2,
  materializeGenerationRequestV2,
  type GenerationRequestV2,
} from '../core/generation-request-v2';
import type {
  GeneratedAssetFile,
  WorldAssetProviderOutput,
} from '../core/world-asset-provider';
import {
  materializeReviewedWorldAssetSourceReceipt,
  type ReviewedWorldAssetSourceReceipt,
} from '../core/reviewed-world-asset-source-receipt';
import type {
  ProductionArtPackReviewRecord,
} from './build-production-review-pack';
import { assertCanonicalMetadataFreePng } from './canonical-png';
import {
  ExactPackArchiveError,
  loadExactPackArchive,
  sha256Bytes,
} from './load-exact-pack-archive';
import type {
  ProductionReviewBaseManifest,
  ProductionReviewPackProfile,
} from './project-production-review-pack-visuals';

const REVIEW_PATH = 'production-art-review.json';
const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true });
addFormats(ajv);
const validateReviewManifestSchema = ajv.compile(reviewManifestSchema);
const validateReviewSchema = ajv.compile(reviewSchema);

export type VersionedReviewWorldAssetProjectionErrorCode =
  | 'versioned-review-replay.invalid-archive'
  | 'versioned-review-replay.invalid-manifest'
  | 'versioned-review-replay.integrity'
  | 'versioned-review-replay.invalid-runtime-projection';

export class VersionedReviewWorldAssetProjectionError extends Error {
  constructor(
    readonly code: VersionedReviewWorldAssetProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VersionedReviewWorldAssetProjectionError';
  }
}

export type VersionedReviewWorldAssetReplayReceipt =
  ReviewedWorldAssetSourceReceipt;

export interface VersionedReviewWorldAssetReplayProjection {
  readonly output: WorldAssetProviderOutput;
  readonly receipt: VersionedReviewWorldAssetReplayReceipt;
}

function fail(
  code: VersionedReviewWorldAssetProjectionErrorCode,
  message: string,
): never {
  throw new VersionedReviewWorldAssetProjectionError(code, message);
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch {
    fail('versioned-review-replay.integrity', `${label} must be strict UTF-8 JSON.`);
  }
}

function pngDimensions(bytes: Uint8Array, path: string): {
  readonly width: number;
  readonly height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    assertCanonicalMetadataFreePng(bytes);
  } catch {
    fail('versioned-review-replay.integrity', `Runtime PNG is not canonical: ${path}.`);
  }
  if (
    bytes.byteLength < 33
    || view.getUint32(8) !== 13
    || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
    || view.getUint32(16) < 1
    || view.getUint32(16) > 8192
    || view.getUint32(20) < 1
    || view.getUint32(20) > 8192
  ) {
    fail('versioned-review-replay.integrity', `Runtime PNG has invalid dimensions: ${path}.`);
  }
  return Object.freeze({ width: view.getUint32(16), height: view.getUint32(20) });
}

function materializeManifest(value: unknown): ProductionReviewBaseManifest {
  if (!validateReviewManifestSchema(value)) {
    fail(
      'versioned-review-replay.invalid-manifest',
      'Production review manifest fails its JSON Schema.',
    );
  }
  const manifest = value as unknown as ProductionReviewBaseManifest;
  if (manifest.profile === 'topdown-farm') {
    assertAlpha9PackManifest(manifest);
  } else if (manifest.profile === 'side-platformer') {
    if (validateAlpha10PackManifest(manifest).length > 0) {
      fail('versioned-review-replay.invalid-manifest', 'Pack 0.7 semantic validation failed.');
    }
  } else if (validateAlpha11PackManifest(manifest).length > 0) {
    fail('versioned-review-replay.invalid-manifest', 'Pack 0.8 semantic validation failed.');
  }
  if (
    manifest.license.output.id !== 'LicenseRef-UNRELEASED'
    || manifest.license.output.permits_redistribution !== false
    || manifest.provenance.contains_generative_ai !== true
    || manifest.provenance.human_curated !== false
    || !['generative-ai', 'hybrid'].includes(manifest.provenance.output_provenance)
  ) {
    fail(
      'versioned-review-replay.invalid-manifest',
      'Versioned replay accepts only unreleased generative production-review Packs.',
    );
  }
  return manifest;
}

async function loadReviewArchive(zipBytes: Uint8Array) {
  try {
    return await loadExactPackArchive(zipBytes, {
      locateManifestPath: (names) => {
        const matches = names.filter((name) => name.endsWith('/mapsoo.manifest.json'));
        return matches.length === 1 ? matches[0] : undefined;
      },
      materializeManifest,
      fileRecords: (manifest) => manifest.files,
    });
  } catch (error) {
    if (error instanceof VersionedReviewWorldAssetProjectionError) throw error;
    if (error instanceof ExactPackArchiveError) {
      if (error.code === 'exact-pack.invalid-archive') {
        fail('versioned-review-replay.invalid-archive', error.message);
      }
      if (error.code === 'exact-pack.invalid-manifest') {
        fail('versioned-review-replay.invalid-manifest', error.message);
      }
      fail('versioned-review-replay.integrity', error.message);
    }
    fail('versioned-review-replay.invalid-manifest', 'Production review manifest is invalid.');
  }
}

function topdownKind(role: string): GeneratedAssetKind | undefined {
  if (role.startsWith('terrain.')) return 'terrain-atlas';
  if (role.startsWith('prop.')) return 'prop-atlas';
  if (role.startsWith('structure.')) return 'structure-sprite';
  if (role.startsWith('crop.')) return 'crop-sprite';
  if (role === 'character.player.atlas') return 'character-atlas';
  if (role === 'world.collision') return 'collision-map';
  if (role === 'world.navigation') return 'navigation-map';
  if (role === 'world.scene') return 'scene-data';
  if (role === 'world.preview') return 'preview';
  return undefined;
}

function profileContract(profile: ProductionReviewPackProfile) {
  if (profile === 'topdown-farm') {
    return {
      roles: TOPDOWN_FARM_REQUIRED_ROLES as readonly string[],
      schemaVersion: GENERATED_ASSET_BUNDLE_SCHEMA_VERSION,
      completenessPolicy: TOPDOWN_FARM_COMPLETENESS_POLICY,
      kind: topdownKind,
      assertComplete: assertCompleteTopdownFarmAssetBundle,
    } as const;
  }
  if (profile === 'side-platformer') {
    return {
      roles: SIDE_PLATFORMER_REQUIRED_ROLES as readonly string[],
      schemaVersion: SIDE_PLATFORMER_ASSET_BUNDLE_SCHEMA_VERSION,
      completenessPolicy: SIDE_PLATFORMER_COMPLETENESS_POLICY,
      kind: requiredSidePlatformerKind,
      assertComplete: assertCompleteSidePlatformerAssetBundle,
    } as const;
  }
  return {
    roles: ISOMETRIC_ACTION_REQUIRED_ROLES as readonly string[],
    schemaVersion: ISOMETRIC_ACTION_ASSET_BUNDLE_SCHEMA_VERSION,
    completenessPolicy: ISOMETRIC_ACTION_COMPLETENESS_POLICY,
    kind: requiredIsometricActionKind,
    assertComplete: assertCompleteIsometricActionAssetBundle,
  } as const;
}

function assetIdFromRole(role: string): string {
  return `asset-${role.replaceAll('.', '-')}`;
}

function referenceIdsForRole(
  role: string,
  environmentReferenceId: string,
  characterReferenceId: string,
): readonly string[] {
  if (
    role === 'character.player.atlas'
    || role.startsWith('world.')
  ) {
    return Object.freeze([environmentReferenceId, characterReferenceId]);
  }
  return Object.freeze([environmentReferenceId]);
}

function normalizedCharacters(manifest: ProductionReviewBaseManifest) {
  const characters = manifest.profile === 'isometric-action'
    ? manifest.characters
    : [manifest.character];
  return characters.map((character) => ({
    id: character.id,
    atlas: character.atlas,
    frameWidth: character.frame_size[0],
    frameHeight: character.frame_size[1],
    pivot: [character.pivot[0], character.pivot[1]] as const,
    clips: character.clips.map((clip) => ({
      action: clip.action as CharacterAction,
      direction: clip.direction as CharacterDirection,
      fps: clip.fps,
      frames: clip.frames.map(({ x, y }) => ({ x, y })),
    })),
  }));
}

export async function materializeVersionedReviewWorldAssetOutput(
  zipBytes: Uint8Array,
  requestValue: GenerationRequestV2,
): Promise<VersionedReviewWorldAssetReplayProjection> {
  const request = materializeGenerationRequestV2(requestValue);
  if (request.profile === 'layered-depth-2d') {
    fail(
      'versioned-review-replay.invalid-runtime-projection',
      'Layered-depth review Packs use the Pack 1.0 projector.',
    );
  }
  const loaded = await loadReviewArchive(zipBytes);
  const manifest = loaded.manifest;
  if (manifest.profile !== request.profile) {
    fail(
      'versioned-review-replay.invalid-runtime-projection',
      'Review Pack profile does not match the generation request.',
    );
  }
  const reviewBytes = loaded.payloads.get(REVIEW_PATH);
  if (!reviewBytes) {
    fail('versioned-review-replay.invalid-manifest', 'Production review record is missing.');
  }
  const review = parseJson<ProductionArtPackReviewRecord>(
    reviewBytes,
    'Production review record',
  );
  if (
    !validateReviewSchema(review)
    || review.profile !== manifest.profile
    || Object.values(review.gates).some((gate) => gate !== 'pending')
  ) {
    fail(
      'versioned-review-replay.invalid-manifest',
      'Production review record is invalid or no longer pending.',
    );
  }
  if (manifest.profile === 'side-platformer') {
    materializeAlpha10Runtime(
      manifest,
      parseJson<Alpha10SceneSidecar>(
        loaded.payloads.get(manifest.runtime.scene.path)!,
        'Pack 0.7 scene',
      ),
      parseJson<Alpha10CollisionSidecar>(
        loaded.payloads.get(manifest.runtime.collision.path)!,
        'Pack 0.7 collision',
      ),
      parseJson<Alpha10NavigationSidecar>(
        loaded.payloads.get(manifest.runtime.navigation.path)!,
        'Pack 0.7 navigation',
      ),
    );
  } else if (manifest.profile === 'isometric-action') {
    materializeAlpha11Runtime(
      manifest,
      parseJson<Alpha11SceneSidecar>(
        loaded.payloads.get(manifest.runtime.scene.path)!,
        'Pack 0.8 scene',
      ),
      parseJson<Alpha11CollisionSidecar>(
        loaded.payloads.get(manifest.runtime.collision.path)!,
        'Pack 0.8 collision',
      ),
      parseJson<Alpha11NavigationSidecar>(
        loaded.payloads.get(manifest.runtime.navigation.path)!,
        'Pack 0.8 navigation',
      ),
    );
  }
  const environmentReferenceId = request.references.find(
    ({ role }) => role === 'environment-style',
  )!.id;
  const characterReferenceId = request.references.find(
    ({ role }) => role === 'character',
  )!.id;
  const contract = profileContract(manifest.profile);
  const rolePath = new Map<string, string>(
    manifest.roles.map(({ role, path }) => [role, path]),
  );
  const roles = contract.roles.map((role) => {
    const path = rolePath.get(role);
    if (!path) {
      fail(
        'versioned-review-replay.invalid-runtime-projection',
        `Required role has no Pack path: ${role}.`,
      );
    }
    return Object.freeze({ role, path, assetId: assetIdFromRole(role) });
  });
  const firstRoleByPath = new Map<string, typeof roles[number]>();
  for (const binding of roles) {
    const previous = firstRoleByPath.get(binding.path);
    if (previous) {
      const previousKind = contract.kind(previous.role);
      if (previousKind !== contract.kind(binding.role)) {
        fail(
          'versioned-review-replay.invalid-runtime-projection',
          `One Pack path is bound to incompatible role kinds: ${binding.path}.`,
        );
      }
    } else {
      firstRoleByPath.set(binding.path, binding);
    }
  }
  const fileRecords = new Map(manifest.files.map((record) => [record.path, record]));
  const assets: GeneratedAssetRecord[] = [];
  const files: GeneratedAssetFile[] = [];
  const assetIdByPath = new Map<string, string>();
  for (const [path, binding] of firstRoleByPath) {
    const record = fileRecords.get(path);
    const bytes = loaded.payloads.get(path);
    const kind = contract.kind(binding.role);
    if (
      !record
      || !bytes
      || !kind
      || (record.media_type !== 'image/png' && record.media_type !== 'application/json')
    ) {
      fail(
        'versioned-review-replay.invalid-runtime-projection',
        `Runtime role path is missing or unsupported: ${path}.`,
      );
    }
    const dimensions = record.media_type === 'image/png'
      ? pngDimensions(bytes, path)
      : undefined;
    assetIdByPath.set(path, binding.assetId);
    assets.push({
      id: binding.assetId,
      kind,
      path,
      mediaType: record.media_type,
      bytes: record.bytes,
      sha256: record.sha256,
      ...(dimensions ?? {}),
      sourceReferenceIds: referenceIdsForRole(
        binding.role,
        environmentReferenceId,
        characterReferenceId,
      ),
    });
    files.push({
      assetId: binding.assetId,
      path,
      mediaType: record.media_type,
      bytes: bytes.slice(),
    });
  }
  const characters = normalizedCharacters(manifest).map((character) => ({
    id: character.id,
    atlasAssetId: assetIdByPath.get(character.atlas) ?? '',
    frameWidth: character.frameWidth,
    frameHeight: character.frameHeight,
    pivot: character.pivot,
    clips: character.clips,
  }));
  const bundle: GeneratedAssetBundle = {
    schemaVersion: contract.schemaVersion,
    jobId: request.id,
    profile: manifest.profile,
    completenessPolicy: contract.completenessPolicy,
    assets,
    roles: roles.map(({ role, path }) => ({
      role,
      assetId: assetIdByPath.get(path) ?? '',
    })),
    characters,
    scene: {
      id: manifest.pack.id,
      dataAssetId: assetIdByPath.get(manifest.runtime.scene.path) ?? '',
      collisionAssetId: assetIdByPath.get(manifest.runtime.collision.path) ?? '',
      navigationAssetId: assetIdByPath.get(manifest.runtime.navigation.path) ?? '',
      previewAssetId: assetIdByPath.get(rolePath.get('world.preview') ?? '') ?? '',
      spawn: { x: manifest.runtime.spawn.x, y: manifest.runtime.spawn.y },
    },
  };
  try {
    contract.assertComplete(bundle);
  } catch {
    fail(
      'versioned-review-replay.invalid-runtime-projection',
      `Review Pack cannot project to a complete ${manifest.profile} runtime bundle.`,
    );
  }
  return Object.freeze({
    output: Object.freeze({ bundle, files: Object.freeze(files) }),
    receipt: materializeReviewedWorldAssetSourceReceipt({
      document_type: 'reviewed-world-asset-source-receipt',
      schema_version: '1.0.0',
      profile: manifest.profile,
      pack_contract: manifest.profile === 'topdown-farm'
        ? 'pack-0.6'
        : manifest.profile === 'side-platformer'
          ? 'pack-0.7'
          : 'pack-0.8',
      pack_id: manifest.pack.id,
      pack_sha256: loaded.archiveSha256,
      manifest_sha256: loaded.manifestSha256,
      review_record_sha256: await sha256Bytes(reviewBytes),
      request_fingerprint_sha256: await fingerprintGenerationRequestV2(request),
      authorization: {
        distribution: 'internal-review',
        license_id: 'LicenseRef-UNRELEASED',
        permits_redistribution: false,
        contains_generative_ai: true,
        human_curated: false,
      },
      review: { ...review.gates },
      runtime_asset_count: assets.length,
      runtime_role_count: roles.length,
    }),
  });
}
