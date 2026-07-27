import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type { NormalizedProductionArtResult } from './normalize-production-art-png';
import {
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  requiredCharacterProfileClips,
  type CharacterProfileRevision,
} from '../core/character-profile-revision';
import {
  assertValidProductionArtOutput,
  type ProductionArtPlan,
  type ProductionArtPoseMapping,
  type ProductionArtTask,
} from '../core/production-art-contract';
import type { WorldAssetProfile } from '../core/asset-profile';

const PROJECTION_SCHEMA_VERSION = '1.0.0' as const;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MINIMUM_VISIBLE_PIXELS = 24;
const IDENTITY_DIGEST_DOMAIN = 'mapsoo-character-identity-v1';

export type ProductionCharacterProfileProjectionErrorCode =
  | 'projection.unsupported-task'
  | 'projection.invalid-options'
  | 'projection.integrity'
  | 'projection.empty-frame'
  | 'projection.padding'
  | 'projection.foot-anchor'
  | 'projection.duplicate-frame'
  | 'projection.mirrored-frame';

export class ProductionCharacterProfileProjectionError extends Error {
  constructor(
    readonly code: ProductionCharacterProfileProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionCharacterProfileProjectionError';
  }
}

export interface ProductionCharacterProfileProjectionOptions {
  readonly characterId: string;
  readonly identityDigestSha256: string;
  readonly characterReferenceIds: readonly string[];
  /**
   * Explicit operator-reviewed runtime transform. Omit for independently
   * rendered directional frames; the projector never infers this from pixels.
  */
  readonly runtimeDirectionTransform?: Readonly<{
    readonly horizontalFlipDirections: readonly ['left' | 'right'];
    readonly provenanceReferenceIds: readonly string[];
  }>;
}

export interface ProductionCharacterProfileProjectionRecord {
  readonly schema_version: typeof PROJECTION_SCHEMA_VERSION;
  readonly document_type: 'production-character-profile-projection';
  readonly profile: WorldAssetProfile;
  readonly plan_id: string;
  readonly task_id: string;
  readonly role: 'character.player.atlas';
  readonly character_id: string;
  readonly profile_revision_id: string;
  readonly profile_revision_sha256: string;
  readonly source: {
    readonly normalized_sha256: string;
    readonly width: number;
    readonly height: number;
    readonly cell_size: readonly [number, number];
    readonly pivot: readonly [number, number];
    readonly identity_digest_sha256: string;
    readonly character_reference_ids: readonly string[];
  };
  readonly atlas: {
    readonly path: 'character-profile-atlas.png';
    readonly bytes: number;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly frame_size: readonly [number, number];
    readonly columns: number;
    readonly rows: number;
    readonly normalized_bytes_preserved: true;
  };
  readonly runtime_direction_transform?: CharacterProfileRevision['runtime_direction_transform'];
  readonly checks: {
    readonly pose_count: number;
    readonly distinct_pose_count: number;
    readonly transparent_padding_checked: true;
    readonly unused_cells_transparent_checked: true;
    readonly foot_anchor_range_y: readonly [number, number];
    readonly exact_duplicates_rejected: true;
    readonly mirrored_duplicates_rejected: true;
  };
  readonly human_review: 'required';
}

export interface ProductionCharacterProfileProjection {
  readonly revision: CharacterProfileRevision;
  readonly record: ProductionCharacterProfileProjectionRecord;
  readonly png: {
    readonly byteLength: number;
    readBytes(): Uint8Array;
  };
}

interface ProjectedFrame {
  readonly pose: ProductionArtPoseMapping;
  readonly rgba: Uint8Array;
}

function fail(
  code: ProductionCharacterProfileProjectionErrorCode,
  message: string,
): never {
  throw new ProductionCharacterProfileProjectionError(code, message);
}

function pixelOffset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function deriveCharacterIdentityDigestSha256(
  approvedReferenceSha256: string,
): Promise<string> {
  if (!SHA256.test(approvedReferenceSha256)) {
    fail(
      'projection.invalid-options',
      'Approved character reference digest must be lowercase SHA-256.',
    );
  }
  return sha256(new TextEncoder().encode(
    `${IDENTITY_DIGEST_DOMAIN}:${approvedReferenceSha256}`,
  ));
}

function assertOptions(
  options: ProductionCharacterProfileProjectionOptions,
  normalized: NormalizedProductionArtResult,
): void {
  if (!SAFE_ID.test(options.characterId)
    || options.characterId.length > 48
    || !SHA256.test(options.identityDigestSha256)
    || options.characterReferenceIds.length < 1
    || options.characterReferenceIds.length > 8
    || new Set(options.characterReferenceIds).size !== options.characterReferenceIds.length
    || options.characterReferenceIds.some((id) =>
      !SAFE_ID.test(id)
      || id.length > 80
      || !normalized.output.source_reference_ids.includes(id))) {
    fail(
      'projection.invalid-options',
      'Character projection options require a safe character id, identity digest, and bound opaque reference ids.',
    );
  }
  const transform = options.runtimeDirectionTransform;
  if (transform !== undefined) {
    if (
      !['side-platformer', 'layered-depth-2d'].includes(normalized.output.profile)
      || transform.horizontalFlipDirections.length !== 1
      || new Set(transform.horizontalFlipDirections).size
        !== transform.horizontalFlipDirections.length
      || transform.horizontalFlipDirections.some(
        (direction) => direction !== 'left' && direction !== 'right',
      )
      || transform.provenanceReferenceIds.length < 1
      || transform.provenanceReferenceIds.length > 8
      || new Set(transform.provenanceReferenceIds).size
        !== transform.provenanceReferenceIds.length
      || transform.provenanceReferenceIds.some(
        (referenceId) => !options.characterReferenceIds.includes(referenceId),
      )
    ) {
      fail(
        'projection.invalid-options',
        'Runtime direction transforms require explicit side/layered directions and bound provenance references.',
      );
    }
  }
}

function assertProjectionTask(
  plan: ProductionArtPlan,
  normalized: NormalizedProductionArtResult,
): ProductionArtTask & {
  readonly pose_mappings: readonly ProductionArtPoseMapping[];
} {
  assertValidProductionArtOutput(normalized.output, plan);
  const task = plan.tasks.find(({ task_id: taskId }) => taskId === normalized.output.task_id);
  if (
    task?.kind !== 'character-animation-sheet'
    || task.role_mappings.length !== 1
    || task.role_mappings[0].role !== 'character.player.atlas'
    || !task.pose_mappings
    || task.pose_mappings.length < 1
    || normalized.output.roles.length !== 1
    || normalized.output.roles[0] !== 'character.player.atlas'
  ) {
    fail(
      'projection.unsupported-task',
      'The portable character profile projector accepts only canonical player animation tasks.',
    );
  }
  return task as ProductionArtTask & {
    readonly pose_mappings: readonly ProductionArtPoseMapping[];
  };
}

function extractFrame(
  sourceWidth: number,
  sourceRgba: Uint8Array,
  task: ProductionArtTask,
  pose: ProductionArtPoseMapping,
): Uint8Array {
  const frameWidth = task.target.cell_width;
  const frameHeight = task.target.cell_height;
  const sourceLeft = pose.grid_cell.column * frameWidth;
  const sourceTop = pose.grid_cell.row * frameHeight;
  const frame = new Uint8Array(frameWidth * frameHeight * 4);
  for (let y = 0; y < frameHeight; y += 1) {
    const sourceOffset = pixelOffset(sourceWidth, sourceLeft, sourceTop + y);
    frame.set(
      sourceRgba.subarray(sourceOffset, sourceOffset + frameWidth * 4),
      pixelOffset(frameWidth, 0, y),
    );
  }
  return frame;
}

function assertUnusedCellsTransparent(
  sourceRgba: Uint8Array,
  task: ProductionArtTask & {
    readonly pose_mappings: readonly ProductionArtPoseMapping[];
  },
): void {
  const columns = task.target.width / task.target.cell_width;
  const rows = task.target.height / task.target.cell_height;
  const occupied = new Set(task.pose_mappings.map(({ grid_cell: cell }) =>
    `${cell.column},${cell.row}`));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (occupied.has(`${column},${row}`)) continue;
      const left = column * task.target.cell_width;
      const top = row * task.target.cell_height;
      for (let y = top; y < top + task.target.cell_height; y += 1) {
        for (let x = left; x < left + task.target.cell_width; x += 1) {
          const offset = pixelOffset(task.target.width, x, y);
          if (sourceRgba[offset] !== 0
            || sourceRgba[offset + 1] !== 0
            || sourceRgba[offset + 2] !== 0
            || sourceRgba[offset + 3] !== 0) {
            fail(
              'projection.integrity',
              `Unused character atlas cell ${column},${row} must be fully transparent RGBA.`,
            );
          }
        }
      }
    }
  }
}

function assertFrameGeometry(
  frame: ProjectedFrame,
  task: ProductionArtTask,
  footAnchorRange: readonly [number, number],
): void {
  const frameWidth = task.target.cell_width;
  const frameHeight = task.target.cell_height;
  let visible = 0;
  let maximumY = -1;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const offset = pixelOffset(frameWidth, x, y);
      const alpha = frame.rgba[offset + 3];
      if (alpha === 0) {
        if (frame.rgba[offset] !== 0
          || frame.rgba[offset + 1] !== 0
          || frame.rgba[offset + 2] !== 0) {
          fail('projection.integrity', 'Transparent character pixels must have zero RGB channels.');
        }
        continue;
      }
      visible += 1;
      maximumY = y;
      if (x === 0 || y === 0 || x === frameWidth - 1 || y === frameHeight - 1) {
        fail(
          'projection.padding',
          `Character pose ${frame.pose.action}.${frame.pose.direction}.${frame.pose.frame_index} touches its cell boundary.`,
        );
      }
    }
  }
  if (visible < MINIMUM_VISIBLE_PIXELS) {
    fail(
      'projection.empty-frame',
      `Character pose ${frame.pose.action}.${frame.pose.direction}.${frame.pose.frame_index} has no usable subject pixels.`,
    );
  }
  if (maximumY < footAnchorRange[0] || maximumY > footAnchorRange[1]) {
    fail(
      'projection.foot-anchor',
      `Character pose ${frame.pose.action}.${frame.pose.direction}.${frame.pose.frame_index} does not land near its declared pivot.`,
    );
  }
}

function mirrorFrameHorizontally(
  frame: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const mirrored = new Uint8Array(frame.byteLength);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = pixelOffset(width, x, y);
      const targetOffset = pixelOffset(width, width - 1 - x, y);
      mirrored.set(frame.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return mirrored;
}

async function assertDistinctFrames(
  frames: readonly ProjectedFrame[],
  task: ProductionArtTask,
): Promise<void> {
  const seenHashes = new Set<string>();
  for (const frame of frames) {
    const [frameHash, mirroredHash] = await Promise.all([
      sha256(frame.rgba),
      sha256(mirrorFrameHorizontally(
        frame.rgba,
        task.target.cell_width,
        task.target.cell_height,
      )),
    ]);
    const poseId = `${frame.pose.action}.${frame.pose.direction}.${frame.pose.frame_index}`;
    if (seenHashes.has(frameHash)) {
      fail('projection.duplicate-frame', `Character pose ${poseId} duplicates an earlier frame.`);
    }
    if (seenHashes.has(mirroredHash)) {
      fail('projection.mirrored-frame', `Character pose ${poseId} mirrors an earlier frame.`);
    }
    seenHashes.add(frameHash);
  }
}

function loopForAction(action: string): boolean {
  return ['idle', 'walk', 'run', 'move', 'fall'].includes(action);
}

function clipsFor(
  profile: WorldAssetProfile,
  poses: readonly ProductionArtPoseMapping[],
): CharacterProfileRevision['clips'] {
  return Object.freeze(requiredCharacterProfileClips(profile).map((clipId) => {
    const separator = clipId.indexOf('.');
    const action = clipId.slice(0, separator) as ProductionArtPoseMapping['action'];
    const direction = clipId.slice(separator + 1) as ProductionArtPoseMapping['direction'];
    const frames = poses
      .filter((pose) => pose.action === action && pose.direction === direction)
      .sort((left, right) => left.frame_index - right.frame_index);
    if (frames.length < 1
      || frames.some((pose, index) => pose.frame_index !== index)
      || new Set(frames.map(({ duration_ms: duration }) => duration)).size !== 1) {
      fail(
        'projection.integrity',
        `Canonical character clip ${clipId} has an invalid frame sequence.`,
      );
    }
    return Object.freeze({
      clip_id: clipId,
      action,
      direction,
      fps: 1000 / frames[0].duration_ms,
      loop: loopForAction(action),
      frames: Object.freeze(frames.map(({ grid_cell: cell }) => Object.freeze({
        column: cell.column,
        row: cell.row,
      }))),
    });
  }));
}

/**
 * Converts one normalized player animation sheet into a source-free,
 * profile-specific CharacterProfileRevision. Source pixels are preserved
 * exactly; all semantic pose, identity, integrity and rights checks run before
 * the revision can be bound to a neutral runtime character slot.
 */
export async function projectProductionCharacterProfile(
  plan: ProductionArtPlan,
  normalized: NormalizedProductionArtResult,
  options: ProductionCharacterProfileProjectionOptions,
): Promise<ProductionCharacterProfileProjection> {
  const task = assertProjectionTask(plan, normalized);
  assertOptions(options, normalized);
  const normalizedBytes = normalized.normalized.readBytes();
  const normalizedSha256 = await sha256(normalizedBytes);
  if (
    normalized.normalized.byteLength !== normalizedBytes.byteLength
    || normalized.output.bytes !== normalizedBytes.byteLength
    || normalized.output.sha256 !== normalizedSha256
    || normalized.evidence.plan_id !== plan.plan_id
    || normalized.evidence.profile !== plan.profile
    || normalized.evidence.task_id !== task.task_id
    || normalized.evidence.normalized.bytes !== normalizedBytes.byteLength
    || normalized.evidence.normalized.sha256 !== normalizedSha256
    || normalized.evidence.normalized.width !== task.target.width
    || normalized.evidence.normalized.height !== task.target.height
  ) {
    fail('projection.integrity', 'Normalized character bytes and generation evidence must match exactly.');
  }
  const decoded = await decodeReferenceImageRgba(normalizedBytes, 'image/png');
  if (decoded.width !== task.target.width || decoded.height !== task.target.height) {
    fail('projection.integrity', 'Decoded character dimensions do not match the approved task.');
  }
  assertUnusedCellsTransparent(decoded.rgba, task);

  const footTolerance = Math.max(2, Math.floor(task.target.cell_height / 16));
  const footAnchorRange = Object.freeze([
    Math.max(1, task.pivot.y - footTolerance),
    Math.min(task.target.cell_height - 2, task.pivot.y + footTolerance),
  ] as const);
  const frames = task.pose_mappings.map((pose) => Object.freeze({
    pose,
    rgba: extractFrame(decoded.width, decoded.rgba, task, pose),
  }));
  for (const frame of frames) assertFrameGeometry(frame, task, footAnchorRange);
  await assertDistinctFrames(frames, task);

  const columns = task.target.width / task.target.cell_width;
  const rows = task.target.height / task.target.cell_height;
  const profileRevisionSeed = new TextEncoder().encode(JSON.stringify({
    character_id: options.characterId,
    profile: plan.profile,
    task_id: task.task_id,
    normalized_sha256: normalizedSha256,
    identity_digest_sha256: options.identityDigestSha256,
    character_reference_ids: options.characterReferenceIds,
    runtime_direction_transform: options.runtimeDirectionTransform,
    rights: plan.rights,
  }));
  const profileRevisionId = `${options.characterId}-${plan.profile}-${
    (await sha256(profileRevisionSeed)).slice(0, 16)
  }`;
  const revision = materializeCharacterProfileRevision({
    schema_version: '1.0.0',
    document_type: 'character-profile-revision',
    profile_revision_id: profileRevisionId,
    character_id: options.characterId,
    profile: plan.profile,
    atlas: {
      path: 'character-profile-atlas.png',
      media_type: 'image/png',
      bytes: normalizedBytes.byteLength,
      sha256: normalizedSha256,
      width: task.target.width,
      height: task.target.height,
    },
    frame_geometry: {
      frame_width: task.target.cell_width,
      frame_height: task.target.cell_height,
      columns,
      rows,
    },
    pivot: {
      x: task.pivot.x,
      y: task.pivot.y,
      unit: 'pixels',
    },
    clips: clipsFor(plan.profile, task.pose_mappings),
    source_identity: {
      identity_digest_sha256: options.identityDigestSha256,
      source_reference_ids: [...options.characterReferenceIds],
    },
    ...(options.runtimeDirectionTransform
      ? {
        runtime_direction_transform: {
          strategy: 'horizontal-flip',
          directions: [...options.runtimeDirectionTransform.horizontalFlipDirections],
          provenance: {
            basis: 'operator-declared-direction-equivalence',
            source_reference_ids: [
              ...options.runtimeDirectionTransform.provenanceReferenceIds,
            ],
          },
        },
      }
      : {}),
    rights: { ...plan.rights },
  });
  const revisionSha256 = await fingerprintCharacterProfileRevision(revision);
  const record: ProductionCharacterProfileProjectionRecord = Object.freeze({
    schema_version: PROJECTION_SCHEMA_VERSION,
    document_type: 'production-character-profile-projection',
    profile: plan.profile,
    plan_id: plan.plan_id,
    task_id: task.task_id,
    role: 'character.player.atlas',
    character_id: options.characterId,
    profile_revision_id: revision.profile_revision_id,
    profile_revision_sha256: revisionSha256,
    source: Object.freeze({
      normalized_sha256: normalizedSha256,
      width: task.target.width,
      height: task.target.height,
      cell_size: Object.freeze([
        task.target.cell_width,
        task.target.cell_height,
      ] as const),
      pivot: Object.freeze([task.pivot.x, task.pivot.y] as const),
      identity_digest_sha256: options.identityDigestSha256,
      character_reference_ids: Object.freeze([...options.characterReferenceIds]),
    }),
    atlas: Object.freeze({
      path: 'character-profile-atlas.png',
      bytes: normalizedBytes.byteLength,
      sha256: normalizedSha256,
      width: task.target.width,
      height: task.target.height,
      frame_size: Object.freeze([
        task.target.cell_width,
        task.target.cell_height,
      ] as const),
      columns,
      rows,
      normalized_bytes_preserved: true,
    }),
    ...(revision.runtime_direction_transform
      ? { runtime_direction_transform: revision.runtime_direction_transform }
      : {}),
    checks: Object.freeze({
      pose_count: frames.length,
      distinct_pose_count: frames.length,
      transparent_padding_checked: true,
      unused_cells_transparent_checked: true,
      foot_anchor_range_y: footAnchorRange,
      exact_duplicates_rejected: true,
      mirrored_duplicates_rejected: true,
    }),
    human_review: 'required',
  });
  const snapshot = Uint8Array.from(normalizedBytes);
  return Object.freeze({
    revision,
    record,
    png: Object.freeze({
      byteLength: snapshot.byteLength,
      readBytes: () => Uint8Array.from(snapshot),
    }),
  });
}
