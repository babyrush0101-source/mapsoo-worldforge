import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import packSchema from '../../schemas/mapsoo-pack-1.0.schema.json';
import {
  LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION,
  type CharacterAction,
  type CharacterDirection,
  type GeneratedAssetBundle,
  type GeneratedAssetRecord,
} from '../core/generated-asset-bundle';
import {
  assertCompleteLayeredDepthAssetBundle,
  LAYERED_DEPTH_COMPLETENESS_POLICY,
  LAYERED_DEPTH_REQUIRED_ROLES,
  requiredLayeredDepthKind,
} from '../core/layered-depth-asset-bundle';
import {
  assertPack10Manifest,
  type Pack10Manifest,
} from '../core/pack-manifest-1.0';
import {
  materializeReviewedWorldAssetSourceReceipt,
  type ReviewedWorldAssetSourceReceipt,
} from '../core/reviewed-world-asset-source-receipt';
import {
  fingerprintGenerationRequestV2,
  materializeGenerationRequestV2,
  type GenerationRequestV2,
} from '../core/generation-request-v2';
import type {
  GeneratedAssetFile,
  WorldAssetProviderOutput,
} from '../core/world-asset-provider';
import { assertCanonicalMetadataFreePng } from './canonical-png';
import {
  ExactPackArchiveError,
  loadExactPackArchive,
} from './load-exact-pack-archive';

const MANIFEST_PATH = 'mapsoo.manifest.json';

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validatePackSchema = ajv.compile(packSchema);

const PLANE_ASSET_IDS = Object.freeze({
  sky: 'background-sky',
  far: 'background-far',
  mid: 'background-mid',
  'depth-fog': 'background-depth-fog',
  near: 'near-overlay',
  'ambient-light': 'lighting-ambient',
  'local-light': 'lighting-local',
  foreground: 'foreground-overlay',
} as const);

const ATLAS_ASSET_IDS = Object.freeze({
  terrain: 'terrain-atlas',
  props: 'prop-atlas',
  structures: 'structure-atlas',
  collectibles: 'collectible-atlas',
  effects: 'effect-atlas',
  player: 'player-atlas',
  npc: 'npc-atlas',
} as const);

export type Pack10WorldAssetProjectionErrorCode =
  | 'pack10-replay.invalid-archive'
  | 'pack10-replay.invalid-manifest'
  | 'pack10-replay.integrity'
  | 'pack10-replay.invalid-runtime-projection';

export class Pack10WorldAssetProjectionError extends Error {
  constructor(
    readonly code: Pack10WorldAssetProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'Pack10WorldAssetProjectionError';
  }
}

export type Pack10WorldAssetReplayReceipt = ReviewedWorldAssetSourceReceipt;

export interface Pack10WorldAssetReplayProjection {
  readonly output: WorldAssetProviderOutput;
  readonly receipt: Pack10WorldAssetReplayReceipt;
}

function fail(code: Pack10WorldAssetProjectionErrorCode, message: string): never {
  throw new Pack10WorldAssetProjectionError(code, message);
}

function pngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength < 33 || signature.some((value, index) => bytes[index] !== value)) {
    fail('pack10-replay.integrity', 'A declared PNG payload has invalid magic bytes.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8) !== 13
    || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
    || view.getUint32(16) < 1
    || view.getUint32(16) > 8192
    || view.getUint32(20) < 1
    || view.getUint32(20) > 8192
  ) {
    fail('pack10-replay.integrity', 'A declared PNG payload has an invalid IHDR.');
  }
  return Object.freeze({ width: view.getUint32(16), height: view.getUint32(20) });
}

async function loadArchive(zipBytes: Uint8Array): Promise<{
  readonly manifest: Pack10Manifest;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly archiveSha256: string;
  readonly payloads: ReadonlyMap<string, Uint8Array>;
}> {
  try {
    return await loadExactPackArchive(zipBytes, {
      locateManifestPath: (names) =>
        names.length > 0 && names.filter((name) => name === MANIFEST_PATH).length === 1
          ? MANIFEST_PATH
          : undefined,
      materializeManifest: (candidate) => {
        if (!validatePackSchema(candidate)) {
          fail('pack10-replay.invalid-manifest', 'Pack 1.0 manifest fails its JSON Schema.');
        }
        const manifest = candidate as unknown as Pack10Manifest;
        assertPack10Manifest(manifest);
        return manifest;
      },
      fileRecords: (manifest) => manifest.files,
    });
  } catch (error) {
    if (error instanceof Pack10WorldAssetProjectionError) throw error;
    if (error instanceof ExactPackArchiveError) {
      if (error.code === 'exact-pack.invalid-archive') {
        fail('pack10-replay.invalid-archive', error.message);
      }
      if (error.code === 'exact-pack.invalid-manifest') {
        fail('pack10-replay.invalid-manifest', error.message);
      }
      fail('pack10-replay.integrity', error.message);
    }
    fail('pack10-replay.invalid-manifest', 'Pack 1.0 manifest fails semantic validation.');
  }
}

function runtimePathAssetIds(manifest: Pack10Manifest): Map<string, string> {
  const result = new Map<string, string>();
  const insert = (path: string, assetId: string) => {
    if (result.has(path) || [...result.values()].includes(assetId)) {
      fail('pack10-replay.invalid-runtime-projection', 'Runtime paths and asset ids must be one-to-one.');
    }
    result.set(path, assetId);
  };
  for (const plane of manifest.planes) {
    const assetId = PLANE_ASSET_IDS[plane.id as keyof typeof PLANE_ASSET_IDS];
    if (!assetId) fail('pack10-replay.invalid-runtime-projection', `Unknown plane id: ${plane.id}.`);
    insert(plane.path, assetId);
  }
  for (const atlas of manifest.atlases) {
    const assetId = ATLAS_ASSET_IDS[atlas.id as keyof typeof ATLAS_ASSET_IDS];
    if (!assetId) fail('pack10-replay.invalid-runtime-projection', `Unknown atlas id: ${atlas.id}.`);
    insert(atlas.path, assetId);
  }
  insert(manifest.runtime.scene.path, 'scene-data');
  insert(manifest.runtime.collision.path, 'collision-map');
  insert(manifest.runtime.navigation.path, 'navigation-map');
  const preview = manifest.roles.find(({ role }) => role === 'world.preview')?.binding;
  if (preview?.kind !== 'file') {
    fail('pack10-replay.invalid-runtime-projection', 'World preview must bind one file.');
  }
  insert(preview.path, 'world-preview');
  return result;
}

function sourceReferenceIds(
  assetId: string,
  environmentReferenceId: string,
  characterReferenceId: string,
): readonly string[] {
  if (assetId === 'npc-atlas') return Object.freeze([environmentReferenceId]);
  if (
    assetId === 'player-atlas'
    || assetId === 'scene-data'
    || assetId === 'collision-map'
    || assetId === 'navigation-map'
    || assetId === 'world-preview'
  ) {
    return Object.freeze([environmentReferenceId, characterReferenceId]);
  }
  return Object.freeze([environmentReferenceId]);
}

function roleAssetId(
  manifest: Pack10Manifest,
  pathAssetIds: ReadonlyMap<string, string>,
  role: string,
): string {
  const binding = manifest.roles.find((candidate) => candidate.role === role)?.binding;
  const path = binding?.kind === 'file'
    ? binding.path
    : manifest.atlases.find(({ id }) => id === binding?.atlas)?.path;
  const assetId = path === undefined ? undefined : pathAssetIds.get(path);
  if (!assetId) fail('pack10-replay.invalid-runtime-projection', `Role cannot resolve to a runtime asset: ${role}.`);
  return assetId;
}

export async function materializePack10WorldAssetOutput(
  zipBytes: Uint8Array,
  requestValue: GenerationRequestV2,
): Promise<Pack10WorldAssetReplayProjection> {
  const request = materializeGenerationRequestV2(requestValue);
  if (request.profile !== 'layered-depth-2d') {
    fail('pack10-replay.invalid-runtime-projection', 'Pack 1.0 replay requires a layered-depth-2d request.');
  }
  const loaded = await loadArchive(zipBytes);
  const { manifest, payloads } = loaded;
  if (manifest.profile !== request.profile) {
    fail('pack10-replay.invalid-runtime-projection', 'Pack 1.0 profile does not match the generation request.');
  }
  const environmentReferenceId = request.references.find(({ role }) => role === 'environment-style')?.id;
  const characterReferenceId = request.references.find(({ role }) => role === 'character')?.id;
  if (!environmentReferenceId || !characterReferenceId) {
    fail('pack10-replay.invalid-runtime-projection', 'Generation request references are incomplete.');
  }
  const pathAssetIds = runtimePathAssetIds(manifest);
  const recordsByPath = new Map(manifest.files.map((record) => [record.path, record]));
  const roles = LAYERED_DEPTH_REQUIRED_ROLES.map((role) => Object.freeze({
    role,
    assetId: roleAssetId(manifest, pathAssetIds, role),
  }));
  const kindByAssetId = new Map<string, ReturnType<typeof requiredLayeredDepthKind>>();
  for (const binding of roles) {
    const kind = requiredLayeredDepthKind(binding.role);
    const previous = kindByAssetId.get(binding.assetId);
    if (!kind || (previous !== undefined && previous !== kind)) {
      fail(
        'pack10-replay.invalid-runtime-projection',
        `Runtime asset has incompatible role kinds: ${binding.assetId}.`,
      );
    }
    kindByAssetId.set(binding.assetId, kind);
  }
  const assets: GeneratedAssetRecord[] = [];
  const files: GeneratedAssetFile[] = [];
  for (const [path, assetId] of pathAssetIds) {
    const record = recordsByPath.get(path);
    const bytes = payloads.get(path);
    if (
      !record
      || !bytes
      || (record.media_type !== 'image/png' && record.media_type !== 'application/json')
    ) {
      fail('pack10-replay.invalid-runtime-projection', `Runtime payload is missing or unsupported: ${path}.`);
    }
    const mediaType = record.media_type;
    const kind = kindByAssetId.get(assetId);
    if (!kind) {
      fail('pack10-replay.invalid-runtime-projection', `Runtime asset kind cannot be derived: ${assetId}.`);
    }
    const dimensions = mediaType === 'image/png' ? pngDimensions(bytes) : undefined;
    if (mediaType === 'image/png') {
      try {
        assertCanonicalMetadataFreePng(bytes);
      } catch {
        fail('pack10-replay.integrity', `Runtime PNG is not canonical: ${path}.`);
      }
    }
    assets.push({
      id: assetId,
      kind,
      path,
      mediaType,
      bytes: record.bytes,
      sha256: record.sha256,
      ...(dimensions ?? {}),
      sourceReferenceIds: sourceReferenceIds(assetId, environmentReferenceId, characterReferenceId),
    });
    files.push({
      assetId,
      path,
      mediaType,
      bytes: bytes.slice(),
    });
  }
  const characters = manifest.characters.map((character) => ({
    id: character.id,
    atlasAssetId: pathAssetIds.get(character.atlas) ?? '',
    frameWidth: character.frame_size[0],
    frameHeight: character.frame_size[1],
    pivot: [character.pivot[0], character.pivot[1]] as const,
    clips: character.clips.map((clip) => ({
      action: clip.action as CharacterAction,
      direction: clip.direction as CharacterDirection,
      fps: 1000 / (
        clip.frames.reduce((sum, frame) => sum + frame.duration_ms, 0)
        / clip.frames.length
      ),
      frames: clip.frames.map(({ x, y }) => ({ x, y })),
    })),
  }));
  const bundle: GeneratedAssetBundle = {
    schemaVersion: LAYERED_DEPTH_ASSET_BUNDLE_SCHEMA_VERSION,
    jobId: request.id,
    profile: request.profile,
    completenessPolicy: LAYERED_DEPTH_COMPLETENESS_POLICY,
    assets,
    roles,
    characters,
    scene: {
      id: manifest.pack.id,
      dataAssetId: pathAssetIds.get(manifest.runtime.scene.path) ?? '',
      collisionAssetId: pathAssetIds.get(manifest.runtime.collision.path) ?? '',
      navigationAssetId: pathAssetIds.get(manifest.runtime.navigation.path) ?? '',
      previewAssetId: roleAssetId(manifest, pathAssetIds, 'world.preview'),
      spawn: { x: manifest.runtime.spawn.x, y: manifest.runtime.spawn.y },
    },
  };
  try {
    assertCompleteLayeredDepthAssetBundle(bundle);
  } catch {
    fail(
      'pack10-replay.invalid-runtime-projection',
      'Pack 1.0 cannot project to a complete layered-depth runtime bundle.',
    );
  }
  const requestFingerprint = await fingerprintGenerationRequestV2(request);
  return Object.freeze({
    output: Object.freeze({
      bundle,
      files: Object.freeze(files),
    }),
    receipt: materializeReviewedWorldAssetSourceReceipt({
      document_type: 'reviewed-world-asset-source-receipt',
      schema_version: '1.0.0',
      profile: manifest.profile,
      pack_contract: 'pack-1.0',
      pack_id: manifest.pack.id,
      pack_sha256: loaded.archiveSha256,
      manifest_sha256: loaded.manifestSha256,
      review_record_sha256: null,
      request_fingerprint_sha256: requestFingerprint,
      authorization: {
        distribution: manifest.distribution,
        license_id: manifest.license.output.id,
        permits_redistribution: manifest.license.output.permits_redistribution,
        contains_generative_ai: manifest.provenance.contains_generative_ai,
        human_curated: manifest.provenance.human_curated,
      },
      review: { ...manifest.review },
      runtime_asset_count: assets.length,
      runtime_role_count: roles.length,
    }),
  });
}
