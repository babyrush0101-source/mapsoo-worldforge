import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import JSZip from 'jszip';

import packSchema from '../../schemas/mapsoo-pack-1.0.schema.json';
import projectionSchema from '../../schemas/mapsoo-production-character-projection-1.0.schema.json';
import evidenceSchema from '../../schemas/mapsoo-production-art-generation-evidence-1.0.schema.json';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type {
  LayeredDepthCharacterProjectionRecord,
} from './project-layered-depth-production-character';
import type {
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';
import {
  assertPack10Manifest,
  type Pack10FileRecord,
  type Pack10Manifest,
} from '../core/pack-manifest-1.0';
import {
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
} from '../core/layered-depth-asset-bundle';

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
const MANIFEST_PATH = 'mapsoo.manifest.json';
const MAX_ARCHIVE_FILES = 256;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const SAFE_PATH =
  /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.-]{0,79}$/;
const EMAIL_OR_ABSOLUTE =
  /@[a-z0-9.-]+\.[a-z]{2,}|\b[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var)\//i;
const URL_OR_EXECUTABLE =
  /(?:https?|file):\/\/|www\.|#!\/|\bshader_type\b|\bextends\s+Node\b|<script\b/i;
const MEDIA_EXTENSION: Readonly<Record<Pack10FileRecord['media_type'], readonly string[]>> =
  Object.freeze({
    'image/png': Object.freeze(['.png']),
    'application/json': Object.freeze(['.json']),
    'application/schema+json': Object.freeze(['.json']),
    'text/markdown': Object.freeze(['.md']),
  });

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validatePackSchema = ajv.compile(packSchema);
const validateProjectionSchema = ajv.compile(projectionSchema);
const validateEvidenceSchema = ajv.compile(evidenceSchema);

type Pack10Character = Pack10Manifest['characters'][number];

export type Pack10CharacterReviewCandidateErrorCode =
  | 'review-pack.invalid-base'
  | 'review-pack.invalid-artifact'
  | 'review-pack.integrity'
  | 'review-pack.privacy'
  | 'review-pack.invalid-output';

export class Pack10CharacterReviewCandidateError extends Error {
  constructor(
    readonly code: Pack10CharacterReviewCandidateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'Pack10CharacterReviewCandidateError';
  }
}

export interface Pack10CharacterReviewArtifact {
  readonly projection: LayeredDepthCharacterProjectionRecord;
  readonly character: Pack10Character;
  readonly generationEvidence: ProductionArtGenerationEvidence;
  readonly atlasPngBytes: Uint8Array;
}

export interface Pack10CharacterReviewCandidateOptions {
  readonly packId: string;
  readonly title: string;
  readonly version: string;
  readonly createdAt: string;
}

export interface Pack10CharacterReviewCandidate {
  readonly filename: string;
  readonly manifest: Pack10Manifest;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

interface LoadedBase {
  readonly manifest: Pack10Manifest;
  readonly manifestBytes: Uint8Array;
  readonly payloads: ReadonlyMap<string, Uint8Array>;
}

interface CheckedArtifact {
  readonly projection: LayeredDepthCharacterProjectionRecord;
  readonly character: Pack10Character;
  readonly generationEvidence: ProductionArtGenerationEvidence;
  readonly atlasBytes: Uint8Array;
  readonly atlasSha256: string;
  readonly projectionBytes: Uint8Array;
  readonly projectionSha256: string;
}

function fail(
  code: Pack10CharacterReviewCandidateErrorCode,
  message: string,
): never {
  throw new Pack10CharacterReviewCandidateError(code, message);
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function jsonBytes(value: unknown): Uint8Array {
  return textBytes(`${JSON.stringify(value, null, 2)}\n`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('review-pack.invalid-base', `${label} is not strict UTF-8 JSON.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function cropFrame(
  rgba: Uint8Array,
  atlasWidth: number,
  originX: number,
  originY: number,
): Uint8Array {
  const frame = new Uint8Array(48 * 72 * 4);
  for (let y = 0; y < 72; y += 1) {
    const sourceOffset = pixelOffset(atlasWidth, originX, originY + y);
    frame.set(
      rgba.subarray(sourceOffset, sourceOffset + 48 * 4),
      pixelOffset(48, 0, y),
    );
  }
  return frame;
}

function mirrorFrame(frame: Uint8Array): Uint8Array {
  const mirrored = new Uint8Array(frame.byteLength);
  for (let y = 0; y < 72; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      const sourceOffset = pixelOffset(48, x, y);
      mirrored.set(
        frame.subarray(sourceOffset, sourceOffset + 4),
        pixelOffset(48, 47 - x, y),
      );
    }
  }
  return mirrored;
}

async function assertRuntimeFrames(
  character: Pack10Character,
  decoded: { readonly width: number; readonly height: number; readonly rgba: Uint8Array },
  expected: { readonly id: 'player' | 'npc'; readonly poseCount: number },
): Promise<void> {
  const actions = expected.id === 'player'
    ? LAYERED_DEPTH_PLAYER_ACTIONS
    : LAYERED_DEPTH_NPC_ACTIONS;
  const expectedClips = new Set(actions.flatMap((action) =>
    LAYERED_DEPTH_DIRECTIONS.map((direction) => `${action}.${direction}`)));
  const origins = new Set<string>();
  const seenHashes = new Set<string>();
  let poseCount = 0;
  for (const clip of character.clips) {
    if (
      !expectedClips.delete(clip.id)
      || clip.id !== `${clip.action}.${clip.direction}`
      || clip.frames.length !== 2
    ) {
      fail('review-pack.invalid-artifact', `${expected.id} clip inventory is not canonical.`);
    }
    for (const frameRecord of clip.frames) {
      poseCount += 1;
      const origin = `${frameRecord.x},${frameRecord.y}`;
      if (
        origins.has(origin)
        || frameRecord.x % 48 !== 0
        || frameRecord.y % 72 !== 0
        || frameRecord.x < 0
        || frameRecord.y < 0
        || frameRecord.x + 48 > decoded.width
        || frameRecord.y + 72 > decoded.height
      ) {
        fail('review-pack.invalid-artifact', `${expected.id} frame origin is invalid.`);
      }
      origins.add(origin);
      const frame = cropFrame(decoded.rgba, decoded.width, frameRecord.x, frameRecord.y);
      let visible = 0;
      let maximumY = -1;
      for (let y = 0; y < 72; y += 1) {
        for (let x = 0; x < 48; x += 1) {
          const offset = pixelOffset(48, x, y);
          const alpha = frame[offset + 3];
          if (alpha === 0) {
            if (frame[offset] !== 0 || frame[offset + 1] !== 0 || frame[offset + 2] !== 0) {
              fail('review-pack.integrity', `${expected.id} transparent frame RGB is not zero.`);
            }
            continue;
          }
          if (alpha !== 255 || x === 0 || y === 0 || x === 47 || y === 71) {
            fail('review-pack.integrity', `${expected.id} frame alpha or transparent padding is invalid.`);
          }
          visible += 1;
          maximumY = y;
        }
      }
      if (visible < 24 || maximumY < 62 || maximumY > 68) {
        fail('review-pack.integrity', `${expected.id} frame is empty or misses its foot anchor.`);
      }
      const [frameHash, mirrorHash] = await Promise.all([
        sha256(frame),
        sha256(mirrorFrame(frame)),
      ]);
      if (seenHashes.has(frameHash) || seenHashes.has(mirrorHash)) {
        fail('review-pack.integrity', `${expected.id} frame is duplicated or mirrored.`);
      }
      seenHashes.add(frameHash);
    }
  }
  if (expectedClips.size > 0 || poseCount !== expected.poseCount) {
    fail('review-pack.invalid-artifact', `${expected.id} canonical poses are incomplete.`);
  }
}

function assertSafeText(path: string, bytes: Uint8Array): void {
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('review-pack.privacy', `Text payload ${path} is not strict UTF-8.`);
  }
  if (EMAIL_OR_ABSOLUTE.test(value) || URL_OR_EXECUTABLE.test(value)) {
    fail(
      'review-pack.privacy',
      `Text payload ${path} contains an email, absolute path, URL, script, or shader marker.`,
    );
  }
}

function mediaTypeFor(
  path: string,
  previous?: Pack10FileRecord['media_type'],
): Pack10FileRecord['media_type'] {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.json')) return previous === 'application/schema+json'
    ? previous
    : 'application/json';
  fail('review-pack.invalid-output', `Unsupported candidate payload extension: ${path}.`);
}

async function loadBaseArchive(baseZipBytes: Uint8Array): Promise<LoadedBase> {
  if (baseZipBytes.byteLength < 1 || baseZipBytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail('review-pack.invalid-base', 'Base Pack 1.0 ZIP byte length is invalid.');
  }
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(Uint8Array.from(baseZipBytes), { checkCRC32: true });
  } catch {
    fail('review-pack.invalid-base', 'Base Pack 1.0 ZIP cannot be decoded.');
  }
  const entries = Object.values(archive.files);
  if (
    entries.length < 2
    || entries.length > MAX_ARCHIVE_FILES
    || entries.some((entry) => entry.dir || !SAFE_PATH.test(entry.name))
  ) {
    fail('review-pack.invalid-base', 'Base Pack 1.0 ZIP has an unsafe entry inventory.');
  }
  const payloads = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const entry of entries) {
    const bytes = await entry.async('uint8array');
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_ARCHIVE_BYTES) {
      fail('review-pack.invalid-base', 'Base Pack 1.0 uncompressed payload budget is exceeded.');
    }
    payloads.set(entry.name, Uint8Array.from(bytes));
  }
  const manifestBytes = payloads.get(MANIFEST_PATH);
  if (!manifestBytes) fail('review-pack.invalid-base', 'Base Pack 1.0 manifest is missing.');
  const candidate = parseJson(manifestBytes, 'Base Pack 1.0 manifest');
  if (!validatePackSchema(candidate)) {
    fail('review-pack.invalid-base', 'Base Pack 1.0 manifest fails its JSON Schema.');
  }
  const manifest = candidate as unknown as Pack10Manifest;
  try {
    assertPack10Manifest(manifest);
  } catch {
    fail('review-pack.invalid-base', 'Base Pack 1.0 manifest fails semantic validation.');
  }
  const expectedPaths = new Set([MANIFEST_PATH, ...manifest.files.map(({ path }) => path)]);
  if (
    expectedPaths.size !== payloads.size
    || [...payloads.keys()].some((path) => !expectedPaths.has(path))
  ) {
    fail('review-pack.invalid-base', 'Base Pack 1.0 ZIP and manifest inventories differ.');
  }
  for (const record of manifest.files) {
    const bytes = payloads.get(record.path);
    const allowedExtensions = MEDIA_EXTENSION[record.media_type];
    if (
      !bytes
      || bytes.byteLength !== record.bytes
      || !allowedExtensions.some((extension) => record.path.endsWith(extension))
      || await sha256(bytes) !== record.sha256
    ) {
      fail('review-pack.integrity', `Base payload integrity failed: ${record.path}.`);
    }
    if (record.media_type !== 'image/png') assertSafeText(record.path, bytes);
  }
  assertSafeText(MANIFEST_PATH, manifestBytes);
  payloads.delete(MANIFEST_PATH);
  return {
    manifest,
    manifestBytes: Uint8Array.from(manifestBytes),
    payloads,
  };
}

async function checkArtifact(
  value: Pack10CharacterReviewArtifact,
  expected: {
    readonly id: 'player' | 'npc';
    readonly role: 'character.player.atlas' | 'character.npc.atlas';
    readonly path: 'atlases/player.png' | 'atlases/npc.png';
    readonly poseCount: 32 | 16;
    readonly clipCount: 16 | 8;
    readonly height: 288 | 144;
  },
): Promise<CheckedArtifact> {
  if (
    !validateProjectionSchema(value.projection)
    || !validateEvidenceSchema(value.generationEvidence)
    || !(value.atlasPngBytes instanceof Uint8Array)
  ) {
    fail('review-pack.invalid-artifact', `${expected.id} projection or evidence shape is invalid.`);
  }
  const projection = value.projection;
  const evidence = value.generationEvidence;
  const character = value.character;
  if (
    projection.role !== expected.role
    || projection.atlas.path !== expected.path
    || projection.atlas.height !== expected.height
    || projection.checks.pose_count !== expected.poseCount
    || projection.checks.distinct_pose_count !== expected.poseCount
    || projection.human_review !== 'required'
    || evidence.profile !== 'layered-depth-2d'
    || evidence.plan_id !== projection.plan_id
    || evidence.task_id !== projection.task_id
    || evidence.normalized.sha256 !== projection.source.normalized_sha256
    || evidence.human_review !== 'required'
  ) {
    fail('review-pack.invalid-artifact', `${expected.id} projection bindings do not match.`);
  }
  if (
    !isRecord(character)
    || character.id !== expected.id
    || character.atlas !== expected.path
    || !Array.isArray(character.frame_size)
    || character.frame_size[0] !== 48
    || character.frame_size[1] !== 72
    || !Array.isArray(character.pivot)
    || character.pivot[0] !== 24
    || character.pivot[1] !== 67
    || !Array.isArray(character.clips)
    || character.clips.length !== expected.clipCount
  ) {
    fail('review-pack.invalid-artifact', `${expected.id} Pack character record is invalid.`);
  }
  const frames = character.clips.flatMap((clip) => clip.frames);
  if (
    frames.length !== expected.poseCount
    || frames.some(({ provenance }) => provenance !== 'independent-generated-pose')
  ) {
    fail('review-pack.invalid-artifact', `${expected.id} projected frame inventory is invalid.`);
  }
  const atlasBytes = Uint8Array.from(value.atlasPngBytes);
  const atlasSha256 = await sha256(atlasBytes);
  const decoded = await decodeReferenceImageRgba(atlasBytes, 'image/png');
  if (
    atlasBytes.byteLength !== projection.atlas.bytes
    || atlasSha256 !== projection.atlas.sha256
    || decoded.width !== 384
    || decoded.height !== expected.height
  ) {
    fail('review-pack.integrity', `${expected.id} runtime atlas does not match its projection record.`);
  }
  await assertRuntimeFrames(character, decoded, expected);
  const projectionBytes = jsonBytes(projection);
  return {
    projection,
    character,
    generationEvidence: evidence,
    atlasBytes,
    atlasSha256,
    projectionBytes,
    projectionSha256: await sha256(projectionBytes),
  };
}

async function fileRecords(
  payloads: ReadonlyMap<string, Uint8Array>,
  previous: ReadonlyMap<string, Pack10FileRecord>,
): Promise<readonly Pack10FileRecord[]> {
  return Object.freeze(await Promise.all([...payloads.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(async ([path, bytes]) => Object.freeze({
      path,
      media_type: mediaTypeFor(path, previous.get(path)?.media_type),
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
    }))));
}

function validateOptions(options: Pack10CharacterReviewCandidateOptions): void {
  const date = new Date(options.createdAt);
  if (
    !SAFE_ID.test(options.packId)
    || options.packId.length > 80
    || options.title.length < 1
    || options.title.length > 120
    || options.title.trim() !== options.title
    || EMAIL_OR_ABSOLUTE.test(options.title)
    || URL_OR_EXECUTABLE.test(options.title)
    || !SAFE_VERSION.test(options.version)
    || Number.isNaN(date.getTime())
    || date.toISOString() !== options.createdAt
  ) {
    fail('review-pack.invalid-output', 'Review candidate identity, title, version, or timestamp is invalid.');
  }
}

/**
 * Replaces only the player and NPC atlases in one complete Pack 1.0 base world.
 * Every authorization gate is reset to pending and the output is always an
 * explicitly non-redistributable internal-review candidate.
 */
export async function buildPack10CharacterReviewCandidate(
  baseZipBytes: Uint8Array,
  playerValue: Pack10CharacterReviewArtifact,
  npcValue: Pack10CharacterReviewArtifact,
  options: Pack10CharacterReviewCandidateOptions,
): Promise<Pack10CharacterReviewCandidate> {
  validateOptions(options);
  const [base, player, npc] = await Promise.all([
    loadBaseArchive(baseZipBytes),
    checkArtifact(playerValue, {
      id: 'player',
      role: 'character.player.atlas',
      path: 'atlases/player.png',
      poseCount: 32,
      clipCount: 16,
      height: 288,
    }),
    checkArtifact(npcValue, {
      id: 'npc',
      role: 'character.npc.atlas',
      path: 'atlases/npc.png',
      poseCount: 16,
      clipCount: 8,
      height: 144,
    }),
  ]);
  const payloads: Map<string, Uint8Array> = new Map([...base.payloads.entries()]
    .map(([path, bytes]) => [path, Uint8Array.from(bytes)] as const));
  payloads.set('atlases/player.png', Uint8Array.from(player.atlasBytes));
  payloads.set('atlases/npc.png', Uint8Array.from(npc.atlasBytes));
  payloads.set('provenance/player-projection.json', Uint8Array.from(player.projectionBytes));
  payloads.set('provenance/npc-projection.json', Uint8Array.from(npc.projectionBytes));
  payloads.set('license-assets.md', textBytes(
    '# Internal review asset notice\n\n'
      + 'This candidate is not released. Redistribution and commercial use are not authorized. '
      + 'Original reference images and raw prompts are excluded.\n',
  ));
  for (const [path, bytes] of payloads) {
    if (!path.endsWith('.png')) assertSafeText(path, bytes);
  }
  const previousFiles = new Map(base.manifest.files.map((record) => [record.path, record]));
  const files = await fileRecords(payloads, previousFiles);
  const auditHashes = new Set([
    ...base.manifest.provenance.source_manifest_hashes,
    await sha256(base.manifestBytes),
    player.projectionSha256,
    npc.projectionSha256,
    player.projection.source.normalized_sha256,
    npc.projection.source.normalized_sha256,
  ]);
  const providers = new Set([
    player.generationEvidence.provider.id,
    npc.generationEvidence.provider.id,
  ]);
  const models = new Set([
    player.generationEvidence.model,
    npc.generationEvidence.model,
  ]);
  const manifest: Pack10Manifest = Object.freeze({
    ...base.manifest,
    pack: Object.freeze({
      id: options.packId,
      title: options.title,
      version: options.version,
      generator: Object.freeze({
        name: 'Mapsoo Worldsmith',
        version: options.version,
      }),
      created_at: options.createdAt,
    }),
    distribution: 'internal-review',
    review: Object.freeze({
      human_art: 'pending',
      rights: 'pending',
      runtime: 'pending',
      raspberry_pi: 'pending',
    }),
    characters: Object.freeze([player.character, npc.character]),
    files,
    license: Object.freeze({
      output: Object.freeze({
        id: 'LicenseRef-UNRELEASED',
        notice_path: 'license-assets.md',
        permits_redistribution: false,
        permits_commercial_use: false,
      }),
    }),
    provenance: Object.freeze({
      output_provenance: 'hybrid',
      contains_generative_ai: true,
      model_provider: providers.size === 1 ? [...providers][0] : 'multiple-providers',
      model: models.size === 1 ? [...models][0] : 'multiple-models',
      human_curated: false,
      source_manifest_hashes: Object.freeze([...auditHashes]),
    }),
    reference_policy: Object.freeze({
      embedded: false,
      original_references_excluded: true,
      raw_prompts_excluded: true,
      only_one_way_audit_hashes_retained: true,
    }),
  });
  if (!validatePackSchema(manifest)) {
    fail('review-pack.invalid-output', 'Character review Pack fails Pack 1.0 JSON Schema.');
  }
  try {
    assertPack10Manifest(manifest);
  } catch {
    fail('review-pack.invalid-output', 'Character review Pack fails Pack 1.0 semantic validation.');
  }
  const manifestBytes = jsonBytes(manifest);
  assertSafeText(MANIFEST_PATH, manifestBytes);
  const archive = new JSZip();
  const entries = [
    ...payloads.entries(),
    [MANIFEST_PATH, manifestBytes] as const,
  ].sort(([left], [right]) => left.localeCompare(right, 'en'));
  for (const [path, bytes] of entries) {
    archive.file(path, bytes, {
      binary: true,
      createFolders: false,
      date: ZIP_DATE,
      unixPermissions: 0o100644,
    });
  }
  const zipBytes = await archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
  const snapshot = Uint8Array.from(zipBytes);
  return Object.freeze({
    filename: `${options.packId}-v${options.version}-internal-review.zip`,
    manifest,
    bytes: snapshot,
    sha256: await sha256(snapshot),
  });
}
