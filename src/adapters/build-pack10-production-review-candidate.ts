import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import JSZip from 'jszip';

import packSchema from '../../schemas/mapsoo-pack-1.0.schema.json';
import layerProjectionSchema from '../../schemas/mapsoo-production-layer-projection-1.0.schema.json';
import atlasProjectionSchema from '../../schemas/mapsoo-production-environment-atlas-projection-1.0.schema.json';
import evidenceSchema from '../../schemas/mapsoo-production-art-generation-evidence-1.0.schema.json';
import {
  buildPack10CharacterReviewCandidate,
  type Pack10CharacterReviewArtifact,
  type Pack10CharacterReviewCandidateOptions,
} from './build-pack10-character-review-candidate';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type { ProductionArtGenerationEvidence } from './normalize-production-art-png';
import type {
  LayeredDepthProductionAtlasProjection,
} from './project-layered-depth-production-atlases';
import type {
  LayeredDepthProductionLayerProjection,
} from './project-layered-depth-production-layers';
import {
  assertPack10Manifest,
  type Pack10FileRecord,
  type Pack10Manifest,
  type Pack10RoleBinding,
} from '../core/pack-manifest-1.0';
import {
  prepareWorldLayoutPackEntry,
  WORLD_LAYOUT_PACK_PATH,
} from '../core/world-layout-pack-binding';
import type { WorldLayoutPlan } from '../core/world-layout-plan';
import {
  prepareWorldMaterialPalettePackEntry,
  WORLD_MATERIAL_PALETTE_PATH,
} from '../core/world-material-palette';

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
const MANIFEST_PATH = 'mapsoo.manifest.json';
const LAYER_PROJECTION_PATH = 'provenance/environment-layer-projection.json';
const ATLAS_PROJECTION_PATH = 'provenance/environment-atlas-projection.json';
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 256;
const EMAIL_OR_ABSOLUTE =
  /@[a-z0-9.-]+\.[a-z]{2,}|\b[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var)\//i;
const URL_OR_EXECUTABLE =
  /(?:https?|file):\/\/|www\.|#!\/|\bshader_type\b|\bextends\s+Node\b|<script\b/i;
const SAFE_PATH =
  /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const REQUIRED_ENVIRONMENT_EVIDENCE_TASKS = 12;

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validatePackSchema = ajv.compile(packSchema);
const validateLayerProjection = ajv.compile(layerProjectionSchema);
const validateAtlasProjection = ajv.compile(atlasProjectionSchema);
const validateEvidence = ajv.compile(evidenceSchema);

export type Pack10ProductionReviewCandidateErrorCode =
  | 'production-review.invalid-character-candidate'
  | 'production-review.invalid-environment'
  | 'production-review.integrity'
  | 'production-review.privacy'
  | 'production-review.invalid-output';

export class Pack10ProductionReviewCandidateError extends Error {
  constructor(
    readonly code: Pack10ProductionReviewCandidateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'Pack10ProductionReviewCandidateError';
  }
}

export interface Pack10ProductionEnvironmentArtifact {
  readonly layers: LayeredDepthProductionLayerProjection;
  readonly environmentAtlases: LayeredDepthProductionAtlasProjection;
  readonly generationEvidence: readonly ProductionArtGenerationEvidence[];
}

export interface Pack10ProductionReviewCandidate {
  readonly filename: string;
  readonly manifest: Pack10Manifest;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

interface LoadedCharacterCandidate {
  readonly manifest: Pack10Manifest;
  readonly manifestBytes: Uint8Array;
  readonly payloads: Map<string, Uint8Array>;
}

interface CheckedEnvironment {
  readonly planes: Pack10Manifest['planes'];
  readonly atlases: readonly Pack10Manifest['atlases'][number][];
  readonly roleBindings: readonly Pack10RoleBinding[];
  readonly payloads: ReadonlyMap<string, Uint8Array>;
  readonly projectionPayloads: ReadonlyMap<string, Uint8Array>;
  readonly auditHashes: readonly string[];
  readonly providers: readonly string[];
  readonly models: readonly string[];
}

function fail(
  code: Pack10ProductionReviewCandidateErrorCode,
  message: string,
): never {
  throw new Pack10ProductionReviewCandidateError(code, message);
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function jsonBytes(value: unknown): Uint8Array {
  return textBytes(`${JSON.stringify(value, null, 2)}\n`);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('production-review.invalid-character-candidate', `${label} is not strict UTF-8 JSON.`);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function assertSafeText(path: string, bytes: Uint8Array): void {
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('production-review.privacy', `Text payload ${path} is not strict UTF-8.`);
  }
  if (EMAIL_OR_ABSOLUTE.test(value) || URL_OR_EXECUTABLE.test(value)) {
    fail(
      'production-review.privacy',
      `Text payload ${path} contains an email, absolute path, URL, script, or shader marker.`,
    );
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  );
}

function assertMetadataFreePng(path: string, bytes: Uint8Array): void {
  if (
    bytes.byteLength < 33
    || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    fail('production-review.integrity', `PNG signature is invalid: ${path}.`);
  }
  let offset = 8;
  let chunkIndex = 0;
  let sawIdat = false;
  let sawIend = false;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) {
      fail('production-review.integrity', `PNG chunk is truncated: ${path}.`);
    }
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(length) || end > bytes.byteLength) {
      fail('production-review.integrity', `PNG chunk length is invalid: ${path}.`);
    }
    const type = new TextDecoder('ascii').decode(bytes.subarray(offset + 4, offset + 8));
    if (
      (chunkIndex === 0 && type !== 'IHDR')
      || !['IHDR', 'IDAT', 'IEND'].includes(type)
      || (type === 'IHDR' && chunkIndex !== 0)
      || (type === 'IEND' && (length !== 0 || end !== bytes.byteLength))
      || sawIend
    ) {
      fail(
        'production-review.privacy',
        `PNG ${path} contains metadata or a non-canonical chunk inventory.`,
      );
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') sawIend = true;
    offset = end;
    chunkIndex += 1;
  }
  if (!sawIdat || !sawIend || offset !== bytes.byteLength) {
    fail('production-review.integrity', `PNG chunk inventory is incomplete: ${path}.`);
  }
}

async function loadCharacterCandidate(bytes: Uint8Array): Promise<LoadedCharacterCandidate> {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail('production-review.invalid-character-candidate', 'Character candidate ZIP size is invalid.');
  }
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    fail('production-review.invalid-character-candidate', 'Character candidate ZIP cannot be decoded.');
  }
  const entries = Object.values(archive.files);
  if (
    entries.length < 2
    || entries.length > MAX_ARCHIVE_FILES
    || entries.some((entry) => entry.dir || !SAFE_PATH.test(entry.name))
  ) {
    fail(
      'production-review.invalid-character-candidate',
      'Character candidate ZIP inventory is unsafe.',
    );
  }
  const payloads = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const entry of entries) {
    const value = Uint8Array.from(await entry.async('uint8array'));
    totalBytes += value.byteLength;
    if (totalBytes > MAX_ARCHIVE_BYTES) {
      fail('production-review.invalid-character-candidate', 'Character candidate payload budget is exceeded.');
    }
    payloads.set(entry.name, value);
  }
  const manifestBytes = payloads.get(MANIFEST_PATH);
  if (!manifestBytes) {
    fail('production-review.invalid-character-candidate', 'Character candidate manifest is missing.');
  }
  const candidate = parseJson(manifestBytes, 'Character candidate manifest');
  if (!validatePackSchema(candidate)) {
    fail('production-review.invalid-character-candidate', 'Character candidate fails Pack 1.0 Schema.');
  }
  const manifest = candidate as unknown as Pack10Manifest;
  try {
    assertPack10Manifest(manifest);
  } catch {
    fail('production-review.invalid-character-candidate', 'Character candidate fails semantic validation.');
  }
  if (
    manifest.distribution !== 'internal-review'
    || manifest.license.output.id !== 'LicenseRef-UNRELEASED'
    || Object.values(manifest.review).some((gate) => gate !== 'pending')
  ) {
    fail(
      'production-review.invalid-character-candidate',
      'Character candidate does not preserve the internal-review boundary.',
    );
  }
  const expectedPaths = new Set([MANIFEST_PATH, ...manifest.files.map(({ path }) => path)]);
  if (
    expectedPaths.size !== payloads.size
    || [...payloads.keys()].some((path) => !expectedPaths.has(path))
  ) {
    fail(
      'production-review.invalid-character-candidate',
      'Character candidate ZIP and manifest inventories differ.',
    );
  }
  for (const record of manifest.files) {
    const value = payloads.get(record.path);
    if (
      !value
      || value.byteLength !== record.bytes
      || await sha256(value) !== record.sha256
    ) {
      fail('production-review.integrity', `Character candidate payload changed: ${record.path}.`);
    }
    if (record.media_type === 'image/png') {
      assertMetadataFreePng(record.path, value);
    } else {
      assertSafeText(record.path, value);
    }
  }
  assertSafeText(MANIFEST_PATH, manifestBytes);
  payloads.delete(MANIFEST_PATH);
  return { manifest, manifestBytes: Uint8Array.from(manifestBytes), payloads };
}

async function checkPlanePng(
  path: string,
  role: string,
  bytes: Uint8Array,
): Promise<void> {
  assertMetadataFreePng(path, bytes);
  const decoded = await decodeReferenceImageRgba(bytes, 'image/png');
  if (decoded.width !== 640 || decoded.height !== 360) {
    fail('production-review.integrity', `Production plane dimensions are invalid: ${path}.`);
  }
  let visible = 0;
  let transparent = 0;
  for (let offset = 0; offset < decoded.rgba.byteLength; offset += 4) {
    const alpha = decoded.rgba[offset + 3];
    if (alpha === 0) {
      transparent += 1;
      if (
        decoded.rgba[offset] !== 0
        || decoded.rgba[offset + 1] !== 0
        || decoded.rgba[offset + 2] !== 0
      ) {
        fail('production-review.integrity', `Production plane transparent RGB is invalid: ${path}.`);
      }
    } else if (alpha === 255) {
      visible += 1;
    } else {
      fail('production-review.integrity', `Production plane partial alpha is unsupported: ${path}.`);
    }
  }
  if (
    visible < 1
    || (role === 'background.sky' && transparent !== 0)
    || (role !== 'background.sky' && transparent < 1)
  ) {
    fail('production-review.integrity', `Production plane alpha inventory is invalid: ${path}.`);
  }
}

function cropRegion(
  rgba: Uint8Array,
  atlasWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = pixelOffset(atlasWidth, x, y + row);
    output.set(
      rgba.subarray(sourceOffset, sourceOffset + width * 4),
      pixelOffset(width, 0, row),
    );
  }
  return output;
}

async function checkAtlasPng(
  item: LayeredDepthProductionAtlasProjection['atlases'][number],
  record: LayeredDepthProductionAtlasProjection['record']['atlases'][number],
  seenCells: Map<string, string>,
): Promise<void> {
  const bytes = item.png.readBytes();
  assertMetadataFreePng(item.file.path, bytes);
  if (
    bytes.byteLength !== item.png.byteLength
    || bytes.byteLength !== item.file.bytes
    || await sha256(bytes) !== item.file.sha256
  ) {
    fail('production-review.integrity', `Production atlas bytes changed: ${item.file.path}.`);
  }
  const decoded = await decodeReferenceImageRgba(bytes, 'image/png');
  const [cellWidth, cellHeight] = item.atlas.cell_size;
  if (
    decoded.width !== record.width
    || decoded.height !== record.height
    || record.width !== item.roleBindings.length * cellWidth
    || record.height !== cellHeight
    || record.source_pivot[0] !== record.runtime_cell_center[0]
    || record.source_pivot[1] !== record.runtime_cell_center[1]
    || record.runtime_cell_center[0] !== cellWidth / 2
    || record.runtime_cell_center[1] !== cellHeight / 2
  ) {
    fail('production-review.integrity', `Production atlas geometry is invalid: ${item.file.path}.`);
  }
  for (const [index, binding] of item.roleBindings.entries()) {
    if (
      binding.role !== record.roles[index]
      || binding.binding.kind !== 'atlas-region'
      || binding.binding.atlas !== item.atlas.id
      || binding.binding.region.x !== index * cellWidth
      || binding.binding.region.y !== 0
      || binding.binding.region.width !== cellWidth
      || binding.binding.region.height !== cellHeight
    ) {
      fail('production-review.invalid-environment', `Production role region is invalid: ${binding.role}.`);
    }
    const cell = cropRegion(
      decoded.rgba,
      decoded.width,
      index * cellWidth,
      0,
      cellWidth,
      cellHeight,
    );
    let visible = 0;
    for (let y = 0; y < cellHeight; y += 1) {
      for (let x = 0; x < cellWidth; x += 1) {
        const offset = pixelOffset(cellWidth, x, y);
        const alpha = cell[offset + 3];
        if (alpha === 0) {
          if (cell[offset] !== 0 || cell[offset + 1] !== 0 || cell[offset + 2] !== 0) {
            fail('production-review.integrity', `${binding.role} transparent RGB is invalid.`);
          }
        } else {
          if (alpha !== 255) {
            fail('production-review.integrity', `${binding.role} contains partial alpha.`);
          }
          visible += 1;
          if (
            item.atlas.id !== 'terrain'
            && (x === 0
              || y === 0
              || x === record.source_cell_size[0] - 1
              || y === record.source_cell_size[1] - 1)
          ) {
            fail('production-review.integrity', `${binding.role} source padding is invalid.`);
          }
          if (y >= record.source_cell_size[1]) {
            fail('production-review.integrity', `${binding.role} leaked into pivot padding.`);
          }
        }
      }
    }
    if (visible < 4) {
      fail('production-review.integrity', `${binding.role} has no usable runtime pixels.`);
    }
    const digest = await sha256(cell);
    const previous = seenCells.get(digest);
    if (previous) {
      fail('production-review.integrity', `${binding.role} duplicates ${previous}.`);
    }
    seenCells.set(digest, binding.role);
  }
}

async function checkEnvironment(
  value: Pack10ProductionEnvironmentArtifact,
): Promise<CheckedEnvironment> {
  if (
    !validateLayerProjection(value.layers.record)
    || !validateAtlasProjection(value.environmentAtlases.record)
    || value.layers.record.profile !== 'layered-depth-2d'
    || value.environmentAtlases.record.profile !== 'layered-depth-2d'
    || value.layers.record.plan_id !== value.environmentAtlases.record.plan_id
    || value.layers.record.approved_direction.normalized_sha256
      !== value.environmentAtlases.record.approved_direction.normalized_sha256
    || value.layers.record.seam_review !== 'required'
    || value.layers.record.human_review !== 'required'
    || value.environmentAtlases.record.seam_review !== 'required'
    || value.environmentAtlases.record.human_review !== 'required'
  ) {
    fail('production-review.invalid-environment', 'Environment projection records are invalid.');
  }
  const payloads = new Map<string, Uint8Array>();
  const roleBindings: Pack10RoleBinding[] = [];
  if (
    value.layers.planes.length !== value.layers.record.planes.length
    || value.layers.planes.length !== 8
  ) {
    fail('production-review.invalid-environment', 'Production plane inventory is incomplete.');
  }
  for (const [index, item] of value.layers.planes.entries()) {
    const record = value.layers.record.planes[index];
    const bytes = item.png.readBytes();
    if (
      item.plane.id !== record.id
      || item.plane.role !== record.role
      || item.plane.path !== record.path
      || item.file.path !== record.path
      || item.file.bytes !== record.bytes
      || item.file.sha256 !== record.sha256
      || item.roleBinding.role !== record.role
      || item.roleBinding.binding.kind !== 'file'
      || item.roleBinding.binding.path !== record.path
      || bytes.byteLength !== item.png.byteLength
      || bytes.byteLength !== record.bytes
      || await sha256(bytes) !== record.sha256
    ) {
      fail('production-review.invalid-environment', `Production plane binding is invalid: ${record.id}.`);
    }
    await checkPlanePng(item.file.path, item.plane.role, bytes);
    payloads.set(item.file.path, Uint8Array.from(bytes));
    roleBindings.push(item.roleBinding);
  }

  if (
    value.environmentAtlases.atlases.length
      !== value.environmentAtlases.record.atlases.length
    || value.environmentAtlases.atlases.length !== 5
  ) {
    fail('production-review.invalid-environment', 'Production atlas inventory is incomplete.');
  }
  const seenCells = new Map<string, string>();
  for (const [index, item] of value.environmentAtlases.atlases.entries()) {
    const record = value.environmentAtlases.record.atlases[index];
    if (
      item.atlas.id !== record.id
      || item.atlas.path !== record.path
      || item.atlas.cell_size[0] !== record.cell_size[0]
      || item.atlas.cell_size[1] !== record.cell_size[1]
      || item.file.path !== record.path
      || item.file.bytes !== record.bytes
      || item.file.sha256 !== record.sha256
      || item.roleBindings.length !== record.roles.length
    ) {
      fail('production-review.invalid-environment', `Production atlas binding is invalid: ${record.id}.`);
    }
    await checkAtlasPng(item, record, seenCells);
    payloads.set(item.file.path, item.png.readBytes());
    roleBindings.push(...item.roleBindings);
  }
  if (roleBindings.length !== 30 || payloads.size !== 13) {
    fail('production-review.invalid-environment', 'Production environment role or file inventory is incomplete.');
  }

  const expectedEvidence = new Map<string, string>([
    [
      'scene-direction',
      value.layers.record.approved_direction.normalized_sha256,
    ],
    ...value.layers.record.planes.map((plane) =>
      [plane.source_task_id, plane.source_normalized_sha256] as const),
  ]);
  for (const atlas of value.environmentAtlases.record.atlases) {
    const previous = expectedEvidence.get(atlas.source_task_id);
    if (previous && previous !== atlas.source_normalized_sha256) {
      fail('production-review.invalid-environment', 'Environment source task hashes conflict.');
    }
    expectedEvidence.set(atlas.source_task_id, atlas.source_normalized_sha256);
  }
  if (
    expectedEvidence.size !== REQUIRED_ENVIRONMENT_EVIDENCE_TASKS
    || value.generationEvidence.length !== REQUIRED_ENVIRONMENT_EVIDENCE_TASKS
  ) {
    fail('production-review.invalid-environment', 'Environment generation evidence inventory is incomplete.');
  }
  const providers = new Set<string>();
  const models = new Set<string>();
  const seenEvidence = new Set<string>();
  for (const evidence of value.generationEvidence) {
    if (
      !validateEvidence(evidence)
      || seenEvidence.has(evidence.task_id)
      || evidence.plan_id !== value.layers.record.plan_id
      || evidence.profile !== 'layered-depth-2d'
      || evidence.human_review !== 'required'
      || expectedEvidence.get(evidence.task_id) !== evidence.normalized.sha256
    ) {
      fail('production-review.invalid-environment', `Environment evidence is invalid: ${evidence.task_id}.`);
    }
    seenEvidence.add(evidence.task_id);
    providers.add(evidence.provider.id);
    models.add(evidence.model);
  }
  if ([...expectedEvidence.keys()].some((taskId) => !seenEvidence.has(taskId))) {
    fail('production-review.invalid-environment', 'Environment evidence omits a canonical task.');
  }

  const layerProjectionBytes = jsonBytes(value.layers.record);
  const atlasProjectionBytes = jsonBytes(value.environmentAtlases.record);
  const projectionPayloads = new Map<string, Uint8Array>([
    [LAYER_PROJECTION_PATH, layerProjectionBytes],
    [ATLAS_PROJECTION_PATH, atlasProjectionBytes],
  ]);
  return {
    planes: Object.freeze(value.layers.planes.map(({ plane }) => plane)),
    atlases: Object.freeze(value.environmentAtlases.atlases.map(({ atlas }) => atlas)),
    roleBindings: Object.freeze(roleBindings),
    payloads,
    projectionPayloads,
    auditHashes: Object.freeze([
      await sha256(layerProjectionBytes),
      await sha256(atlasProjectionBytes),
      ...expectedEvidence.values(),
    ]),
    providers: Object.freeze([...providers]),
    models: Object.freeze([...models]),
  };
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
  fail('production-review.invalid-output', `Unsupported output extension: ${path}.`);
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

/**
 * Builds a complete, non-redistributable Pack 1.0 production-art candidate by
 * replacing all visible environment and character assets over one validated
 * data-only base world. Runtime, rights, art and Pi gates stay pending.
 */
export async function buildPack10ProductionReviewCandidate(
  baseZipBytes: Uint8Array,
  player: Pack10CharacterReviewArtifact,
  npc: Pack10CharacterReviewArtifact,
  environmentValue: Pack10ProductionEnvironmentArtifact,
  options: Pack10CharacterReviewCandidateOptions,
  layoutPlan?: WorldLayoutPlan,
): Promise<Pack10ProductionReviewCandidate> {
  const [characterCandidate, environment, preparedLayout] = await Promise.all([
    buildPack10CharacterReviewCandidate(baseZipBytes, player, npc, options),
    checkEnvironment(environmentValue),
    layoutPlan === undefined
      ? Promise.resolve(undefined)
      : prepareWorldLayoutPackEntry(
        layoutPlan,
        'layered-depth-2d',
        layoutPlan.source.seed,
      ),
  ]);
  const loaded = await loadCharacterCandidate(characterCandidate.bytes);
  const payloads = new Map<string, Uint8Array>([...loaded.payloads.entries()]
    .map(([path, bytes]) => [path, Uint8Array.from(bytes)] as const));
  if (preparedLayout) {
    payloads.set(WORLD_LAYOUT_PACK_PATH, Uint8Array.from(preparedLayout.bytes));
  }
  for (const [path, bytes] of environment.payloads) payloads.set(path, Uint8Array.from(bytes));
  for (const [path, bytes] of environment.projectionPayloads) {
    payloads.set(path, Uint8Array.from(bytes));
  }
  for (const [path, bytes] of payloads) {
    if (path.endsWith('.png')) assertMetadataFreePng(path, bytes);
    else assertSafeText(path, bytes);
  }

  const atlasReplacements = new Map(environment.atlases.map((atlas) => [atlas.id, atlas]));
  const atlases = Object.freeze(loaded.manifest.atlases.map((atlas) =>
    atlasReplacements.get(atlas.id) ?? atlas));
  const roleReplacements = new Map(environment.roleBindings.map((binding) => [
    binding.role,
    binding,
  ]));
  const roles = Object.freeze(loaded.manifest.roles.map((binding) =>
    roleReplacements.get(binding.role) ?? binding));
  const preparedPalette = preparedLayout === undefined
    ? undefined
    : await prepareWorldMaterialPalettePackEntry(
      preparedLayout,
      roles.map(({ role }) => role),
    );
  if (preparedPalette) {
    payloads.set(WORLD_MATERIAL_PALETTE_PATH, Uint8Array.from(preparedPalette.bytes));
    assertSafeText(WORLD_MATERIAL_PALETTE_PATH, preparedPalette.bytes);
  }
  const previousFiles = new Map(loaded.manifest.files.map((file) => [file.path, file]));
  const files = await fileRecords(payloads, previousFiles);
  const providers = new Set([
    player.generationEvidence.provider.id,
    npc.generationEvidence.provider.id,
    ...environment.providers,
  ]);
  const models = new Set([
    player.generationEvidence.model,
    npc.generationEvidence.model,
    ...environment.models,
  ]);
  const sourceManifestHashes = Object.freeze([...new Set([
    ...loaded.manifest.provenance.source_manifest_hashes,
    await sha256(loaded.manifestBytes),
    ...environment.auditHashes,
  ])]);
  const manifest: Pack10Manifest = Object.freeze({
    ...loaded.manifest,
    planes: environment.planes,
    atlases,
    roles,
    ...(preparedLayout ? { layout: preparedLayout.binding } : {}),
    ...(preparedPalette ? { material_palette: preparedPalette.binding } : {}),
    files,
    provenance: Object.freeze({
      output_provenance: 'hybrid',
      contains_generative_ai: true,
      model_provider: providers.size === 1 ? [...providers][0] : 'multiple-providers',
      model: models.size === 1 ? [...models][0] : 'multiple-models',
      human_curated: false,
      source_manifest_hashes: sourceManifestHashes,
    }),
  });
  if (!validatePackSchema(manifest)) {
    fail('production-review.invalid-output', 'Production review Pack fails Pack 1.0 JSON Schema.');
  }
  try {
    assertPack10Manifest(manifest);
  } catch {
    fail('production-review.invalid-output', 'Production review Pack fails Pack 1.0 semantic validation.');
  }
  if (
    manifest.distribution !== 'internal-review'
    || Object.values(manifest.review).some((gate) => gate !== 'pending')
    || manifest.license.output.id !== 'LicenseRef-UNRELEASED'
    || manifest.license.output.permits_redistribution
    || manifest.license.output.permits_commercial_use
    || manifest.reference_policy.embedded
    || !manifest.reference_policy.original_references_excluded
    || !manifest.reference_policy.raw_prompts_excluded
  ) {
    fail('production-review.invalid-output', 'Production review authorization boundary changed.');
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
    filename: `${options.packId}-v${options.version}-production-internal-review.zip`,
    manifest,
    bytes: snapshot,
    sha256: await sha256(snapshot),
  });
}
