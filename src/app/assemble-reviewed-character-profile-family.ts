import JSZip from 'jszip';

import { parseStrictJsonDocument } from '../adapters/import-world-spec';
import {
  readVersionedWorldArtRuntimeOverlayArchive,
} from '../adapters/read-world-art-runtime-overlay-versioned';
import {
  assertHumanArtReviewReceipt,
  encodeHumanArtReviewReceipt,
  type ApprovedProductionWorldReview,
  type HumanArtReviewReceipt,
} from '../core/human-art-review-receipt';
import {
  assertProductionWorldReview,
} from '../core/production-world-review-contract';
import {
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  serializeCharacterProfileRevisionCanonical,
  type CharacterProfileRevision,
  type CharacterProfileRights,
} from '../core/character-profile-revision';
import {
  fingerprintWorldArtRuntimeProjection,
  materializeWorldArtRuntimeProjection,
  type WorldArtRuntimeProjection,
} from '../core/world-art-runtime-projection';
import {
  materializeReviewedCharacterProfileFamily,
  serializeReviewedCharacterProfileFamilyCanonical,
  verifyReviewedCharacterProfileFamily,
  type ReviewedCharacterProfileFamily,
  type ReviewedCharacterProfileFamilyArtifact,
  type ReviewedCharacterProfileFamilyArtifacts,
} from '../core/reviewed-character-profile-family';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../core/asset-profile';

export interface ReviewedCharacterProfileSource {
  readonly profile: WorldAssetProfile;
  readonly characterProfileRevisionBytes: Uint8Array;
  readonly characterProjectionRecordBytes: Uint8Array;
  readonly runtimeOverlayBytes: Uint8Array;
  readonly layoutPlan?: unknown;
  readonly approvedWorldReviewBytes: Uint8Array;
  readonly humanArtReviewReceiptBytes: Uint8Array;
}

export type ReviewedCharacterProfileSources = Readonly<Record<
WorldAssetProfile,
Omit<ReviewedCharacterProfileSource, 'profile'>
>>;

export interface AssembleReviewedCharacterProfileFamilyInput {
  readonly familyId: string;
  readonly sources: ReviewedCharacterProfileSources;
  readonly signal?: AbortSignal;
}

export interface ReviewedCharacterProfileFamilyFile {
  readonly path: string;
  readonly mediaType: 'application/json' | 'image/png' | 'text/markdown';
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface AssembledReviewedCharacterProfileFamily {
  readonly family: ReviewedCharacterProfileFamily;
  readonly files: readonly ReviewedCharacterProfileFamilyFile[];
  readonly sourceImagesIncluded: false;
  readonly reviewEvidenceIncluded: false;
  readonly runtimeAcceptance: 'pending';
  readonly raspberryPiAcceptance: 'pending';
}

interface CharacterProjectionRecord {
  readonly schema_version: '1.0.0';
  readonly document_type: 'production-character-profile-projection';
  readonly profile: WorldAssetProfile;
  readonly plan_id: string;
  readonly task_id: string;
  readonly role: 'character.player.atlas';
  readonly character_id: string;
  readonly profile_revision_id: string;
  readonly profile_revision_sha256: string;
  readonly source: Readonly<{
    normalized_sha256: string;
    width: number;
    height: number;
    cell_size: readonly [number, number];
    pivot: readonly [number, number];
    identity_digest_sha256: string;
    character_reference_ids: readonly string[];
  }>;
  readonly atlas: Readonly<{
    path: 'character-profile-atlas.png';
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    frame_size: readonly [number, number];
    columns: number;
    rows: number;
    normalized_bytes_preserved: true;
  }>;
  readonly runtime_direction_transform?: CharacterProfileRevision['runtime_direction_transform'];
  readonly checks: Readonly<{
    pose_count: number;
    distinct_pose_count: number;
    transparent_padding_checked: true;
    unused_cells_transparent_checked: true;
    foot_anchor_range_y: readonly [number, number];
    exact_duplicates_rejected: true;
    mirrored_duplicates_rejected: true;
  }>;
  readonly human_review: 'required';
}

interface VerifiedReviewedSource {
  readonly profile: WorldAssetProfile;
  readonly sourceRevision: CharacterProfileRevision;
  readonly sourceRevisionSha256: string;
  readonly promotedRevision: CharacterProfileRevision;
  readonly promotedRevisionBytes: Uint8Array;
  readonly promotedRevisionSha256: string;
  readonly atlasBytes: Uint8Array;
  readonly atlasSha256: string;
  readonly characterProjectionSha256: string;
  readonly runtimeOverlaySha256: string;
  readonly runtimeProjectionSha256: string;
  readonly humanReviewReceiptSha256: string;
  readonly approvedWorldReviewSha256: string;
  readonly rights: ReviewedCharacterProfileFamily['rights'];
}

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(message: string): never {
  throw new Error(`Reviewed character family assembly: ${message}`);
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Reviewed character family assembly was aborted.', 'AbortError');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  label = 'Object',
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) {
    fail(`${label} contains missing or undeclared fields.`);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const hash = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('canonical evidence contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!record(value)) fail('canonical evidence contains an unsupported value.');
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonical(value[key])}`
  )).join(',')}}`;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonical(left) === canonical(right);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(`${label} must contain strict UTF-8.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) fail(parsed.message);
  return parsed.value;
}

function approval(value: unknown): ApprovedProductionWorldReview {
  if (!record(value)) fail('approved world review must be an object.');
  exact(value, ['review', 'human_review', 'authorization'], [], 'Approved world review');
  if (!record(value.human_review) || !record(value.authorization)) {
    fail('approved world review metadata is incomplete.');
  }
  exact(value.human_review, [
    'receipt_path',
    'receipt_sha256',
    'reviewer_id',
    'reviewed_at',
    'decision',
  ], [], 'Approved world review human record');
  exact(
    value.authorization,
    [
      'distribution',
      'output_license_id',
      'permits_redistribution',
      'source_authority_confirmed',
    ],
    ['attribution'],
    'Approved world review authorization',
  );
  const candidate = value as unknown as ApprovedProductionWorldReview;
  assertProductionWorldReview(candidate.review);
  if (
    candidate.review.release_decision !== 'approved'
    || (
      candidate.human_review.decision !== 'approved-private'
      && candidate.human_review.decision !== 'approved-public'
    )
  ) {
    fail('approved world review is not a promoted human-approved record.');
  }
  return candidate;
}

function receipt(value: unknown): HumanArtReviewReceipt {
  const candidate = value as HumanArtReviewReceipt;
  assertHumanArtReviewReceipt(candidate);
  if (
    candidate.decision !== 'approved-private'
    && candidate.decision !== 'approved-public'
  ) {
    fail('human art review receipt is not approved.');
  }
  return candidate;
}

function promotedRights(
  value: HumanArtReviewReceipt,
): ReviewedCharacterProfileFamily['rights'] {
  const output = value.rights;
  if (value.decision === 'approved-private') {
    if (
      output.distribution !== 'private'
      || output.output_license_id !== 'LicenseRef-Proprietary'
      || output.permits_redistribution
    ) {
      fail('private human approval has inconsistent rights.');
    }
    return Object.freeze({
      distribution: 'private',
      license: 'LicenseRef-Proprietary',
    });
  }
  if (
    output.distribution !== 'public'
    || !output.permits_redistribution
    || !['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0']
      .includes(output.output_license_id)
  ) {
    fail('public human approval has inconsistent rights.');
  }
  return Object.freeze({
    distribution: 'public',
    license: output.output_license_id as Exclude<
    CharacterProfileRights['license'],
    'LicenseRef-Proprietary'
    >,
    ...(output.attribution === undefined
      ? {}
      : { attribution: output.attribution }),
  });
}

function projectionRecord(value: unknown): CharacterProjectionRecord {
  if (!record(value)) fail('character projection record must be an object.');
  exact(value, [
    'schema_version',
    'document_type',
    'profile',
    'plan_id',
    'task_id',
    'role',
    'character_id',
    'profile_revision_id',
    'profile_revision_sha256',
    'source',
    'atlas',
    'checks',
    'human_review',
  ], ['runtime_direction_transform'], 'Character projection record');
  if (!record(value.source) || !record(value.atlas) || !record(value.checks)) {
    fail('character projection source or atlas record is missing.');
  }
  exact(value.source, [
    'normalized_sha256',
    'width',
    'height',
    'cell_size',
    'pivot',
    'identity_digest_sha256',
    'character_reference_ids',
  ], [], 'Character projection source');
  exact(value.atlas, [
    'path',
    'bytes',
    'sha256',
    'width',
    'height',
    'frame_size',
    'columns',
    'rows',
    'normalized_bytes_preserved',
  ], [], 'Character projection atlas');
  exact(value.checks, [
    'pose_count',
    'distinct_pose_count',
    'transparent_padding_checked',
    'unused_cells_transparent_checked',
    'foot_anchor_range_y',
    'exact_duplicates_rejected',
    'mirrored_duplicates_rejected',
  ], [], 'Character projection checks');
  if (
    value.schema_version !== '1.0.0'
    || value.document_type !== 'production-character-profile-projection'
    || value.role !== 'character.player.atlas'
    || value.human_review !== 'required'
    || typeof value.profile !== 'string'
    || !WORLD_ASSET_PROFILES.includes(value.profile as WorldAssetProfile)
    || typeof value.character_id !== 'string'
    || typeof value.profile_revision_id !== 'string'
    || typeof value.profile_revision_sha256 !== 'string'
    || !SHA256.test(value.profile_revision_sha256)
    || typeof value.plan_id !== 'string'
    || !SAFE_ID.test(value.plan_id)
    || typeof value.task_id !== 'string'
    || !SAFE_ID.test(value.task_id)
    || typeof value.source.normalized_sha256 !== 'string'
    || !SHA256.test(value.source.normalized_sha256)
    || !Number.isSafeInteger(value.source.width)
    || !Number.isSafeInteger(value.source.height)
    || !Array.isArray(value.source.cell_size)
    || value.source.cell_size.length !== 2
    || value.source.cell_size.some((item) => !Number.isSafeInteger(item))
    || !Array.isArray(value.source.pivot)
    || value.source.pivot.length !== 2
    || value.source.pivot.some((item) => !Number.isSafeInteger(item))
    || typeof value.source.identity_digest_sha256 !== 'string'
    || !SHA256.test(value.source.identity_digest_sha256)
    || !Array.isArray(value.source.character_reference_ids)
    || value.source.character_reference_ids.length < 1
    || value.source.character_reference_ids.some((item) =>
      typeof item !== 'string' || !SAFE_ID.test(item))
    || value.atlas.path !== 'character-profile-atlas.png'
    || typeof value.atlas.sha256 !== 'string'
    || !SHA256.test(value.atlas.sha256)
    || !Number.isSafeInteger(value.atlas.bytes)
    || !Number.isSafeInteger(value.atlas.width)
    || !Number.isSafeInteger(value.atlas.height)
    || !Array.isArray(value.atlas.frame_size)
    || value.atlas.frame_size.length !== 2
    || value.atlas.frame_size.some((item) => !Number.isSafeInteger(item))
    || !Number.isSafeInteger(value.atlas.columns)
    || !Number.isSafeInteger(value.atlas.rows)
    || value.atlas.normalized_bytes_preserved !== true
    || !Number.isSafeInteger(value.checks.pose_count)
    || (value.checks.pose_count as number) < 1
    || value.checks.distinct_pose_count !== value.checks.pose_count
    || value.checks.transparent_padding_checked !== true
    || value.checks.unused_cells_transparent_checked !== true
    || value.checks.exact_duplicates_rejected !== true
    || value.checks.mirrored_duplicates_rejected !== true
    || !Array.isArray(value.checks.foot_anchor_range_y)
    || value.checks.foot_anchor_range_y.length !== 2
    || value.checks.foot_anchor_range_y.some((item) => !Number.isSafeInteger(item))
  ) {
    fail('character projection record is invalid.');
  }
  return value as unknown as CharacterProjectionRecord;
}

async function overlayProjection(
  overlayBytes: Uint8Array,
  overlayId: string,
  path: string,
): Promise<Readonly<{
  projection: WorldArtRuntimeProjection;
  bytes: Uint8Array;
  sha256: string;
  readFile(relativePath: string): Promise<Uint8Array>;
}>> {
  const zip = await JSZip.loadAsync(overlayBytes, { checkCRC32: true });
  const entry = zip.file(`${overlayId}/${path}`);
  if (!entry) fail('runtime overlay is missing its canonical projection file.');
  const bytes = await entry.async('uint8array');
  const projection = await materializeWorldArtRuntimeProjection(
    parseJson(bytes, 'Runtime projection'),
  );
  return Object.freeze({
    projection,
    bytes,
    sha256: await sha256(bytes),
    readFile: async (relativePath: string) => {
      const file = zip.file(`${overlayId}/${relativePath}`);
      if (!file) fail(`runtime overlay is missing ${relativePath}.`);
      return Uint8Array.from(await file.async('uint8array'));
    },
  });
}

function runtimeRightsFromReceipt(
  value: HumanArtReviewReceipt,
): Readonly<{ distribution: string; license: string; attribution?: string }> {
  return Object.freeze({
    distribution: value.rights.distribution,
    license: value.rights.output_license_id,
    ...(value.rights.attribution === undefined
      ? {}
      : { attribution: value.rights.attribution }),
  });
}

function loopForAction(action: string): boolean {
  return ['idle', 'walk', 'run', 'move', 'fall'].includes(action);
}

function assertRuntimePosesMatchRevision(
  revision: CharacterProfileRevision,
  poses: WorldArtRuntimeProjection['assets'][number]['poses'],
): void {
  const expected = revision.clips.flatMap((clip) =>
    clip.frames.map((frame, frameIndex) => ({
      action: clip.action,
      direction: clip.direction,
      frame_index: frameIndex,
      duration_ms: Math.round(1000 / clip.fps),
      region: {
        x: frame.column * revision.frame_geometry.frame_width,
        y: frame.row * revision.frame_geometry.frame_height,
        width: revision.frame_geometry.frame_width,
        height: revision.frame_geometry.frame_height,
      },
    }))).sort((left, right) =>
    left.action.localeCompare(right.action, 'en')
    || left.direction.localeCompare(right.direction, 'en')
    || left.frame_index - right.frame_index);
  if (
    revision.clips.some(({ action, loop, fps }) =>
      loop !== loopForAction(action)
      || Math.abs((1000 / Math.round(1000 / fps)) - fps) > 1e-9)
    || canonical(expected) !== canonical(poses)
  ) {
    fail(`${revision.profile} runtime poses do not exactly match the reviewed character clips.`);
  }
}

function sourceRightsCanPromote(
  source: CharacterProfileRights,
  target: ReviewedCharacterProfileFamily['rights'],
): boolean {
  return canonical(source) === canonical(target)
    || (
      source.distribution === 'internal-review'
      && source.license === 'LicenseRef-Proprietary'
    );
}

async function verifyReviewedSource(
  source: ReviewedCharacterProfileSource,
  signal?: AbortSignal,
): Promise<VerifiedReviewedSource> {
  abortIfNeeded(signal);
  const [
    revisionValue,
    projectionValue,
    approvalValue,
    receiptValue,
    characterProjectionSha256,
    approvedWorldReviewSha256,
  ] = await Promise.all([
    Promise.resolve(parseJson(
      source.characterProfileRevisionBytes,
      `${source.profile} character revision`,
    )),
    Promise.resolve(parseJson(
      source.characterProjectionRecordBytes,
      `${source.profile} character projection record`,
    )),
    Promise.resolve(parseJson(
      source.approvedWorldReviewBytes,
      `${source.profile} approved world review`,
    )),
    Promise.resolve(parseJson(
      source.humanArtReviewReceiptBytes,
      `${source.profile} human art review receipt`,
    )),
    sha256(source.characterProjectionRecordBytes),
    sha256(source.approvedWorldReviewBytes),
  ]);
  const sourceRevision = materializeCharacterProfileRevision(revisionValue);
  const sourceRevisionCanonical = serializeCharacterProfileRevisionCanonical(
    sourceRevision,
  );
  if (!equal(source.characterProfileRevisionBytes, sourceRevisionCanonical)) {
    fail(`${source.profile} character revision bytes are not canonical.`);
  }
  const sourceRevisionSha256 = await fingerprintCharacterProfileRevision(sourceRevision);
  const projectionRecordValue = projectionRecord(projectionValue);
  const approvalValueChecked = approval(approvalValue);
  const receiptValueChecked = receipt(receiptValue);
  const canonicalReceiptBytes = encodeHumanArtReviewReceipt(receiptValueChecked);
  if (!equal(source.humanArtReviewReceiptBytes, canonicalReceiptBytes)) {
    fail(`${source.profile} human review receipt bytes are not canonical.`);
  }
  const humanReviewReceiptSha256 = await sha256(canonicalReceiptBytes);
  const reviewedRights = promotedRights(receiptValueChecked);
  const footTolerance = Math.max(
    2,
    Math.floor(sourceRevision.frame_geometry.frame_height / 16),
  );
  const expectedFootRange = [
    Math.max(1, sourceRevision.pivot.y - footTolerance),
    Math.min(
      sourceRevision.frame_geometry.frame_height - 2,
      sourceRevision.pivot.y + footTolerance,
    ),
  ];
  abortIfNeeded(signal);

  const overlay = await readVersionedWorldArtRuntimeOverlayArchive(
    source.runtimeOverlayBytes,
    source.layoutPlan === undefined
      ? {}
      : { layout_plan: source.layoutPlan },
  );
  const projected = await overlayProjection(
    overlay.bytes,
    overlay.manifest.overlay_id,
    overlay.manifest.projection.path,
  );
  const runtimeProjectionFingerprint = await fingerprintWorldArtRuntimeProjection(
    projected.projection,
  );
  const humanEvidenceRecords = approvalValueChecked.review.evidence.filter((evidence) =>
    evidence.kind === 'human-review-record'
    && evidence.path === approvalValueChecked.human_review.receipt_path);
  const humanEvidence = humanEvidenceRecords[0];
  const humanGate = approvalValueChecked.review.gates.find(
    ({ gate }) => gate === 'human-review',
  );
  const capture = approvalValueChecked.review.evidence.find((evidence) =>
    evidence.kind === 'rendered-world-capture'
    && evidence.sha256 === receiptValueChecked.bindings.godot_capture_sha256);
  const compositionGate = approvalValueChecked.review.gates.find(
    ({ gate }) => gate === 'image-composition',
  );
  if (
    sourceRevision.profile !== source.profile
    || projectionRecordValue.profile !== source.profile
    || approvalValueChecked.review.profile !== source.profile
    || receiptValueChecked.profile !== source.profile
    || overlay.manifest.profile !== source.profile
    || projected.projection.profile !== source.profile
  ) {
    fail(`${source.profile} reviewed inputs contain profile drift.`);
  }
  if (
    projectionRecordValue.profile_revision_id
      !== sourceRevision.profile_revision_id
    || projectionRecordValue.profile_revision_sha256 !== sourceRevisionSha256
    || projectionRecordValue.character_id !== sourceRevision.character_id
    || projectionRecordValue.source.identity_digest_sha256
      !== sourceRevision.source_identity.identity_digest_sha256
    || canonical(projectionRecordValue.source.character_reference_ids)
      !== canonical(sourceRevision.source_identity.source_reference_ids)
    || projectionRecordValue.atlas.sha256 !== sourceRevision.atlas.sha256
    || projectionRecordValue.source.normalized_sha256 !== sourceRevision.atlas.sha256
    || projectionRecordValue.source.width !== sourceRevision.atlas.width
    || projectionRecordValue.source.height !== sourceRevision.atlas.height
    || projectionRecordValue.atlas.width !== sourceRevision.atlas.width
    || projectionRecordValue.atlas.height !== sourceRevision.atlas.height
    || canonical(projectionRecordValue.source.cell_size) !== canonical([
      sourceRevision.frame_geometry.frame_width,
      sourceRevision.frame_geometry.frame_height,
    ])
    || canonical(projectionRecordValue.atlas.frame_size) !== canonical([
      sourceRevision.frame_geometry.frame_width,
      sourceRevision.frame_geometry.frame_height,
    ])
    || projectionRecordValue.atlas.columns !== sourceRevision.frame_geometry.columns
    || projectionRecordValue.atlas.rows !== sourceRevision.frame_geometry.rows
    || canonical(projectionRecordValue.source.pivot) !== canonical([
      sourceRevision.pivot.x,
      sourceRevision.pivot.y,
    ])
    || !sameCanonical(
      projectionRecordValue.runtime_direction_transform,
      sourceRevision.runtime_direction_transform,
    )
    || projectionRecordValue.checks.pose_count
      !== sourceRevision.clips.reduce((sum, clip) => sum + clip.frames.length, 0)
    || canonical(projectionRecordValue.checks.foot_anchor_range_y)
      !== canonical(expectedFootRange)
  ) {
    fail(`${source.profile} character projection does not bind its exact revision and atlas.`);
  }
  if (
    approvalValueChecked.human_review.receipt_sha256 !== humanReviewReceiptSha256
    || approvalValueChecked.human_review.reviewer_id
      !== receiptValueChecked.reviewer_id
    || approvalValueChecked.human_review.reviewed_at
      !== receiptValueChecked.reviewed_at
    || approvalValueChecked.human_review.decision !== receiptValueChecked.decision
    || canonical(approvalValueChecked.authorization)
      !== canonical(receiptValueChecked.rights)
    || humanEvidenceRecords.length !== 1
    || receiptValueChecked.bindings.production_world_review_id
      !== approvalValueChecked.review.review_id
    || receiptValueChecked.bindings.world_preview_sha256
      !== approvalValueChecked.review.world_preview.sha256
    || !humanEvidence
    || humanEvidence.sha256 !== humanReviewReceiptSha256
    || humanEvidence.reviewer_id !== receiptValueChecked.reviewer_id
    || humanGate?.status !== 'human-pass'
    || !humanGate.evidence_ids.includes(humanEvidence.evidence_id)
    || !capture
    || compositionGate?.status !== 'technical-pass'
    || !compositionGate.evidence_ids.includes(capture.evidence_id)
  ) {
    fail(`${source.profile} approved world review does not bind its exact human receipt.`);
  }
  if (
    receiptValueChecked.bindings.runtime_overlay_sha256 !== overlay.sha256
    || receiptValueChecked.bindings.runtime_projection_sha256
      !== overlay.manifest.source.projection_sha256
    || projected.sha256 !== overlay.manifest.projection.sha256
    || runtimeProjectionFingerprint !== overlay.manifest.source.projection_sha256
    || receiptValueChecked.bindings.character_identity_binding_sha256
      !== sourceRevision.source_identity.identity_digest_sha256
    || canonical(overlay.manifest.rights)
      !== canonical(projected.projection.rights)
    || canonical(projected.projection.rights)
      !== canonical(runtimeRightsFromReceipt(receiptValueChecked))
    || !sourceRightsCanPromote(sourceRevision.rights, reviewedRights)
  ) {
    fail(`${source.profile} human receipt does not bind the reviewed runtime overlay.`);
  }

  const characterAssets = projected.projection.assets.filter(
    ({ role }) => role === 'character.player.atlas',
  );
  const characterBindings = projected.projection.bindings.filter((binding) =>
    binding.usage_kind === 'character'
    && binding.role === 'character.player.atlas');
  if (characterAssets.length !== 1 || characterBindings.length !== 1) {
    fail(
      `${source.profile} runtime projection must contain exactly one player asset and binding.`,
    );
  }
  const characterAsset = characterAssets[0]!;
  const characterBinding = characterBindings[0]!;
  const characterImages = projected.projection.images.filter(
    ({ task_id: taskId, path }) =>
      taskId === characterAsset.task_id && path === characterAsset.image_path,
  );
  const characterImage = characterImages[0];
  const overlayImage = characterImage
    ? overlay.manifest.files.find(({ path }) => path === characterImage.path)
    : undefined;
  const atlasBytes = characterImage
    ? await projected.readFile(characterImage.path)
    : new Uint8Array();
  const atlasSha256 = await sha256(atlasBytes);
  if (
    characterImages.length !== 1
    || !characterImage
    || !overlayImage
    || characterImage.sha256 !== atlasSha256
    || characterImage.bytes !== atlasBytes.byteLength
    || characterImage.width !== sourceRevision.atlas.width
    || characterImage.height !== sourceRevision.atlas.height
    || overlayImage.sha256 !== atlasSha256
    || overlayImage.bytes !== atlasBytes.byteLength
    || sourceRevision.atlas.bytes !== atlasBytes.byteLength
    || sourceRevision.atlas.sha256 !== atlasSha256
    || projectionRecordValue.atlas.bytes !== atlasBytes.byteLength
    || projectionRecordValue.atlas.sha256 !== atlasSha256
    || projectionRecordValue.plan_id
      !== projected.projection.source.production_art_plan_id
    || projectionRecordValue.task_id !== characterAsset.task_id
    || characterImage.cell_size[0] !== sourceRevision.frame_geometry.frame_width
    || characterImage.cell_size[1] !== sourceRevision.frame_geometry.frame_height
    || characterImage.pivot[0] !== sourceRevision.pivot.x
    || characterImage.pivot[1] !== sourceRevision.pivot.y
    || characterAsset.image_path !== characterImage.path
    || characterAsset.region.x !== 0
    || characterAsset.region.y !== 0
    || characterAsset.region.width !== characterImage.width
    || characterAsset.region.height !== characterImage.height
    || canonical({
      task_id: characterBinding.task_id,
      slot_id: characterBinding.slot_id,
      role: characterBinding.role,
      variant_id: characterBinding.variant_id,
      image_path: characterBinding.image_path,
      region: characterBinding.region,
      cell_sha256: characterBinding.cell_sha256,
      poses: characterBinding.poses,
    }) !== canonical({
      task_id: characterAsset.task_id,
      slot_id: characterAsset.slot_id,
      role: characterAsset.role,
      variant_id: characterAsset.variant_id,
      image_path: characterAsset.image_path,
      region: characterAsset.region,
      cell_sha256: characterAsset.cell_sha256,
      poses: characterAsset.poses,
    })
  ) {
    fail(`${source.profile} reviewed runtime projection does not contain the exact character atlas.`);
  }
  assertRuntimePosesMatchRevision(sourceRevision, characterAsset.poses);

  const promotionSeed = new TextEncoder().encode(canonical({
    domain: 'mapsoo-reviewed-character-profile/v1',
    source_revision_sha256: sourceRevisionSha256,
    runtime_overlay_sha256: overlay.sha256,
    human_review_receipt_sha256: humanReviewReceiptSha256,
    approved_world_review_sha256: approvedWorldReviewSha256,
    rights: reviewedRights,
  }));
  const promotedRevision = materializeCharacterProfileRevision({
    ...sourceRevision,
    profile_revision_id: `${sourceRevision.character_id}-${source.profile}-reviewed-${
      (await sha256(promotionSeed)).slice(0, 16)
    }`,
    rights: reviewedRights,
  });
  const promotedRevisionBytes = serializeCharacterProfileRevisionCanonical(
    promotedRevision,
  );
  return Object.freeze({
    profile: source.profile,
    sourceRevision,
    sourceRevisionSha256,
    promotedRevision,
    promotedRevisionBytes,
    promotedRevisionSha256: await fingerprintCharacterProfileRevision(promotedRevision),
    atlasBytes,
    atlasSha256,
    characterProjectionSha256,
    runtimeOverlaySha256: overlay.sha256,
    runtimeProjectionSha256: runtimeProjectionFingerprint,
    humanReviewReceiptSha256,
    approvedWorldReviewSha256,
    rights: reviewedRights,
  });
}

export async function assembleReviewedCharacterProfileFamily(
  input: AssembleReviewedCharacterProfileFamilyInput,
): Promise<AssembledReviewedCharacterProfileFamily> {
  if (
    !SAFE_ID.test(input.familyId)
    || input.familyId.length < 1
    || input.familyId.length > 48
  ) {
    fail('familyId must use bounded lowercase kebab-case.');
  }
  const sourceKeys = Object.keys(input.sources).sort();
  const expectedKeys = [...WORLD_ASSET_PROFILES].sort();
  if (
    sourceKeys.length !== 4
    || sourceKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail('sources must contain exactly the four supported profiles.');
  }
  const verifiedPairs = await Promise.all(WORLD_ASSET_PROFILES.map(
    async (profile) => [profile, await verifyReviewedSource({
      profile,
      ...input.sources[profile],
    }, input.signal)] as const,
  ));
  const sources = Object.freeze(Object.fromEntries(verifiedPairs)) as Readonly<Record<
  WorldAssetProfile,
  VerifiedReviewedSource
  >>;
  const first = sources[WORLD_ASSET_PROFILES[0]];
  for (const profile of WORLD_ASSET_PROFILES.slice(1)) {
    const candidate = sources[profile];
    if (
      candidate.sourceRevision.character_id !== first.sourceRevision.character_id
      || candidate.sourceRevision.source_identity.identity_digest_sha256
        !== first.sourceRevision.source_identity.identity_digest_sha256
      || canonical(candidate.sourceRevision.source_identity.source_reference_ids)
        !== canonical(first.sourceRevision.source_identity.source_reference_ids)
      || canonical(candidate.rights) !== canonical(first.rights)
    ) {
      fail('all four reviewed profiles must preserve one character identity and rights decision.');
    }
  }

  const family = materializeReviewedCharacterProfileFamily({
    schema_version: '1.0.0',
    document_type: 'reviewed-character-profile-family',
    family_id: input.familyId,
    character_id: first.sourceRevision.character_id,
    character_identity_sha256:
      first.sourceRevision.source_identity.identity_digest_sha256,
    rights: first.rights,
    profiles: WORLD_ASSET_PROFILES.map((profile) => {
      const source = sources[profile];
      return {
        profile,
        profile_revision_id: source.promotedRevision.profile_revision_id,
        revision_path: `profiles/${profile}/character-profile-revision.json`,
        revision_sha256: source.promotedRevisionSha256,
        atlas_path: `profiles/${profile}/character-profile-atlas.png`,
        atlas_sha256: source.atlasSha256,
        clip_count: source.promotedRevision.clips.length,
        reviewed_source: {
          source_profile_revision_id: source.sourceRevision.profile_revision_id,
          source_profile_revision_sha256: source.sourceRevisionSha256,
          production_character_projection_sha256:
            source.characterProjectionSha256,
          runtime_overlay_sha256: source.runtimeOverlaySha256,
          runtime_projection_sha256: source.runtimeProjectionSha256,
          human_review_receipt_sha256: source.humanReviewReceiptSha256,
          approved_world_review_sha256: source.approvedWorldReviewSha256,
        },
      };
    }),
    privacy: {
      source_images_included: false,
      source_paths_included: false,
      raw_prompts_included: false,
      provider_credentials_included: false,
    },
    review: {
      technical_world_review: 'passed',
      human_art_review: 'passed',
      exact_profile_count: 4,
      godot_family_runtime: 'pending',
      raspberry_pi: 'pending',
    },
    status: 'reviewed-release-candidate',
  });
  const artifacts = Object.freeze(Object.fromEntries(
    WORLD_ASSET_PROFILES.map((profile) => {
      const source = sources[profile];
      return [profile, Object.freeze({
        revision: source.promotedRevision,
        revisionBytes: source.promotedRevisionBytes,
        atlasBytes: source.atlasBytes,
      }) satisfies ReviewedCharacterProfileFamilyArtifact];
    }),
  )) as ReviewedCharacterProfileFamilyArtifacts;
  await verifyReviewedCharacterProfileFamily(family, artifacts);

  const manifestBytes = serializeReviewedCharacterProfileFamilyCanonical(family);
  const readmeBytes = new TextEncoder().encode(
    '# Reviewed character profile family\n\n'
      + 'This source-free release candidate contains one human-reviewed character '
      + 'identity projected into all four Mapsoo 2D world profiles.\n\n'
      + 'The original references, prompts, provider credentials, runtime overlays, '
      + 'world captures, and human review records are excluded. Their one-way '
      + 'integrity bindings remain in the family manifest.\n\n'
      + 'Human and technical world review passed for every profile. Godot family '
      + 'runtime acceptance and physical Raspberry Pi acceptance remain pending.\n',
  );
  const fileInputs = [
    {
      path: 'reviewed-character-profile-family.json',
      mediaType: 'application/json' as const,
      bytes: manifestBytes,
    },
    {
      path: 'readme.md',
      mediaType: 'text/markdown' as const,
      bytes: readmeBytes,
    },
    ...WORLD_ASSET_PROFILES.flatMap((profile) => {
      const source = sources[profile];
      return [
        {
          path: `profiles/${profile}/character-profile-revision.json`,
          mediaType: 'application/json' as const,
          bytes: source.promotedRevisionBytes,
        },
        {
          path: `profiles/${profile}/character-profile-atlas.png`,
          mediaType: 'image/png' as const,
          bytes: source.atlasBytes,
        },
      ];
    }),
  ];
  const files = Object.freeze(await Promise.all(fileInputs.map(async (file) => (
    Object.freeze({
      ...file,
      bytes: Uint8Array.from(file.bytes),
      sha256: await sha256(file.bytes),
    })
  ))));
  return Object.freeze({
    family,
    files,
    sourceImagesIncluded: false,
    reviewEvidenceIncluded: false,
    runtimeAcceptance: 'pending',
    raspberryPiAcceptance: 'pending',
  });
}
