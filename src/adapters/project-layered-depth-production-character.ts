import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type { NormalizedProductionArtResult } from './normalize-production-art-png';
import {
  assertValidProductionArtOutput,
  type ProductionArtPlan,
  type ProductionArtPoseMapping,
  type ProductionArtTask,
} from '../core/production-art-contract';
import {
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
} from '../core/layered-depth-asset-bundle';
import type {
  Pack10FileRecord,
  Pack10Manifest,
  Pack10RoleBinding,
} from '../core/pack-manifest-1.0';

const PROJECTION_SCHEMA_VERSION = '1.0.0' as const;
const RUNTIME_FRAME_WIDTH = 48;
const RUNTIME_FRAME_HEIGHT = 72;
const RUNTIME_PIVOT = Object.freeze([24, 67] as const);
const ATLAS_COLUMNS = 8;
const MINIMUM_VISIBLE_PIXELS = 24;
const FOOT_ANCHOR_MIN_Y = 62;
const FOOT_ANCHOR_MAX_Y = 68;

type Pack10Character = Pack10Manifest['characters'][number];
type Pack10Atlas = Pack10Manifest['atlases'][number];

export type LayeredDepthCharacterProjectionErrorCode =
  | 'projection.unsupported-task'
  | 'projection.integrity'
  | 'projection.empty-frame'
  | 'projection.padding'
  | 'projection.foot-anchor'
  | 'projection.duplicate-frame'
  | 'projection.mirrored-frame';

export class LayeredDepthCharacterProjectionError extends Error {
  constructor(
    readonly code: LayeredDepthCharacterProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LayeredDepthCharacterProjectionError';
  }
}

export interface LayeredDepthCharacterProjectionRecord {
  readonly schema_version: typeof PROJECTION_SCHEMA_VERSION;
  readonly document_type: 'production-character-atlas-projection';
  readonly profile: 'layered-depth-2d';
  readonly plan_id: string;
  readonly task_id: string;
  readonly role: 'character.player.atlas' | 'character.npc.atlas';
  readonly source: {
    readonly normalized_sha256: string;
    readonly width: number;
    readonly height: number;
    readonly cell_size: readonly [number, number];
    readonly pivot: readonly [number, number];
  };
  readonly atlas: {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly frame_size: readonly [number, number];
    readonly pivot: readonly [number, number];
  };
  readonly checks: {
    readonly pose_count: number;
    readonly distinct_pose_count: number;
    readonly transparent_padding_checked: true;
    readonly foot_anchor_range_y: readonly [number, number];
    readonly exact_duplicates_rejected: true;
    readonly mirrored_duplicates_rejected: true;
  };
  readonly human_review: 'required';
}

export interface LayeredDepthCharacterProjection {
  readonly atlas: Pack10Atlas;
  readonly roleBinding: Pack10RoleBinding;
  readonly character: Pack10Character;
  readonly file: Pack10FileRecord;
  readonly record: LayeredDepthCharacterProjectionRecord;
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
  code: LayeredDepthCharacterProjectionErrorCode,
  message: string,
): never {
  throw new LayeredDepthCharacterProjectionError(code, message);
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

function characterDefinition(role: string): {
  readonly id: 'player' | 'npc';
  readonly role: 'character.player.atlas' | 'character.npc.atlas';
  readonly actions: readonly string[];
  readonly atlasPath: string;
} | undefined {
  if (role === 'character.player.atlas') {
    return {
      id: 'player',
      role,
      actions: LAYERED_DEPTH_PLAYER_ACTIONS,
      atlasPath: 'atlases/player.png',
    };
  }
  if (role === 'character.npc.atlas') {
    return {
      id: 'npc',
      role,
      actions: LAYERED_DEPTH_NPC_ACTIONS,
      atlasPath: 'atlases/npc.png',
    };
  }
  return undefined;
}

function assertProjectionTask(
  plan: ProductionArtPlan,
  normalized: NormalizedProductionArtResult,
): {
  readonly task: ProductionArtTask & {
    readonly pose_mappings: readonly ProductionArtPoseMapping[];
  };
  readonly definition: NonNullable<ReturnType<typeof characterDefinition>>;
} {
  assertValidProductionArtOutput(normalized.output, plan);
  const task = plan.tasks.find(({ task_id: taskId }) => taskId === normalized.output.task_id);
  const role = task?.role_mappings[0]?.role;
  const definition = characterDefinition(role ?? '');
  if (
    plan.profile !== 'layered-depth-2d'
    || task?.kind !== 'character-animation-sheet'
    || task.role_mappings.length !== 1
    || !task.pose_mappings
    || task.pose_mappings.length < 1
    || !definition
    || normalized.output.roles.length !== 1
    || normalized.output.roles[0] !== definition.role
  ) {
    fail(
      'projection.unsupported-task',
      'The Pack 1.0 character projector accepts only canonical layered-depth player or NPC tasks.',
    );
  }
  return {
    task: task as ProductionArtTask & {
      readonly pose_mappings: readonly ProductionArtPoseMapping[];
    },
    definition,
  };
}

function resizeCellToRuntimeFrame(
  sourceWidth: number,
  sourceRgba: Uint8Array,
  task: ProductionArtTask,
  pose: ProductionArtPoseMapping,
): Uint8Array {
  const sourceCellWidth = task.target.cell_width;
  const sourceCellHeight = task.target.cell_height;
  const sourceLeft = pose.grid_cell.column * sourceCellWidth;
  const sourceTop = pose.grid_cell.row * sourceCellHeight;
  const frame = new Uint8Array(RUNTIME_FRAME_WIDTH * RUNTIME_FRAME_HEIGHT * 4);
  for (let y = 0; y < RUNTIME_FRAME_HEIGHT; y += 1) {
    const sourceY = sourceTop + Math.round(
      y * (sourceCellHeight - 1) / (RUNTIME_FRAME_HEIGHT - 1),
    );
    for (let x = 0; x < RUNTIME_FRAME_WIDTH; x += 1) {
      const sourceX = sourceLeft + Math.round(
        x * (sourceCellWidth - 1) / (RUNTIME_FRAME_WIDTH - 1),
      );
      const sourceOffset = pixelOffset(sourceWidth, sourceX, sourceY);
      frame.set(
        sourceRgba.subarray(sourceOffset, sourceOffset + 4),
        pixelOffset(RUNTIME_FRAME_WIDTH, x, y),
      );
    }
  }
  return frame;
}

function assertFrameGeometry(frame: ProjectedFrame): void {
  let visible = 0;
  let maximumY = -1;
  for (let y = 0; y < RUNTIME_FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < RUNTIME_FRAME_WIDTH; x += 1) {
      const offset = pixelOffset(RUNTIME_FRAME_WIDTH, x, y);
      const alpha = frame.rgba[offset + 3];
      if (alpha === 0) {
        if (frame.rgba[offset] !== 0 || frame.rgba[offset + 1] !== 0 || frame.rgba[offset + 2] !== 0) {
          fail('projection.integrity', 'Transparent projected pixels must have zero RGB channels.');
        }
        continue;
      }
      visible += 1;
      maximumY = y;
      if (x === 0 || y === 0 || x === RUNTIME_FRAME_WIDTH - 1 || y === RUNTIME_FRAME_HEIGHT - 1) {
        fail(
          'projection.padding',
          `Projected pose ${frame.pose.action}.${frame.pose.direction}.${frame.pose.frame_index} touches its frame boundary.`,
        );
      }
    }
  }
  if (visible < MINIMUM_VISIBLE_PIXELS) {
    fail(
      'projection.empty-frame',
      `Projected pose ${frame.pose.action}.${frame.pose.direction}.${frame.pose.frame_index} has no usable subject pixels.`,
    );
  }
  if (maximumY < FOOT_ANCHOR_MIN_Y || maximumY > FOOT_ANCHOR_MAX_Y) {
    fail(
      'projection.foot-anchor',
      `Projected pose ${frame.pose.action}.${frame.pose.direction}.${frame.pose.frame_index} does not land near pivot y=${RUNTIME_PIVOT[1]}.`,
    );
  }
}

function mirrorFrameHorizontally(frame: Uint8Array): Uint8Array {
  const mirrored = new Uint8Array(frame.byteLength);
  for (let y = 0; y < RUNTIME_FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < RUNTIME_FRAME_WIDTH; x += 1) {
      const sourceOffset = pixelOffset(RUNTIME_FRAME_WIDTH, x, y);
      const targetOffset = pixelOffset(RUNTIME_FRAME_WIDTH, RUNTIME_FRAME_WIDTH - 1 - x, y);
      mirrored.set(frame.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return mirrored;
}

async function assertDistinctFrames(frames: readonly ProjectedFrame[]): Promise<void> {
  const seenHashes = new Set<string>();
  for (const frame of frames) {
    const [frameHash, mirroredHash] = await Promise.all([
      sha256(frame.rgba),
      sha256(mirrorFrameHorizontally(frame.rgba)),
    ]);
    const poseId = `${frame.pose.action}.${frame.pose.direction}.${frame.pose.frame_index}`;
    if (seenHashes.has(frameHash)) {
      fail('projection.duplicate-frame', `Projected pose ${poseId} duplicates an earlier frame.`);
    }
    if (seenHashes.has(mirroredHash)) {
      fail('projection.mirrored-frame', `Projected pose ${poseId} mirrors an earlier frame.`);
    }
    seenHashes.add(frameHash);
  }
}

function writeAtlas(frames: readonly ProjectedFrame[]): {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
} {
  const rows = Math.ceil(frames.length / ATLAS_COLUMNS);
  const width = ATLAS_COLUMNS * RUNTIME_FRAME_WIDTH;
  const height = rows * RUNTIME_FRAME_HEIGHT;
  const rgba = new Uint8Array(width * height * 4);
  frames.forEach((frame, index) => {
    const targetLeft = (index % ATLAS_COLUMNS) * RUNTIME_FRAME_WIDTH;
    const targetTop = Math.floor(index / ATLAS_COLUMNS) * RUNTIME_FRAME_HEIGHT;
    for (let y = 0; y < RUNTIME_FRAME_HEIGHT; y += 1) {
      const sourceOffset = pixelOffset(RUNTIME_FRAME_WIDTH, 0, y);
      const targetOffset = pixelOffset(width, targetLeft, targetTop + y);
      rgba.set(
        frame.rgba.subarray(sourceOffset, sourceOffset + RUNTIME_FRAME_WIDTH * 4),
        targetOffset,
      );
    }
  });
  return { width, height, rgba };
}

function clipsFor(
  frames: readonly ProjectedFrame[],
  actions: readonly string[],
): Pack10Character['clips'] {
  return Object.freeze(actions.flatMap((action) =>
    LAYERED_DEPTH_DIRECTIONS.map((direction) => {
      const clipFrames = frames
        .map((frame, index) => ({ frame, index }))
        .filter(({ frame }) => frame.pose.action === action && frame.pose.direction === direction)
        .sort((left, right) => left.frame.pose.frame_index - right.frame.pose.frame_index);
      return Object.freeze({
        id: `${action}.${direction}`,
        action,
        direction,
        frames: Object.freeze(clipFrames.map(({ frame, index }) => Object.freeze({
          x: (index % ATLAS_COLUMNS) * RUNTIME_FRAME_WIDTH,
          y: Math.floor(index / ATLAS_COLUMNS) * RUNTIME_FRAME_HEIGHT,
          duration_ms: frame.pose.duration_ms,
          provenance: 'independent-generated-pose' as const,
        }))),
      });
    })));
}

/**
 * Projects one normalized, hash-bound layered-depth production character sheet
 * into a Pack 1.0 runtime atlas. This is a technical candidate operation only;
 * it never changes the required human art-review gate.
 */
export async function projectLayeredDepthProductionCharacter(
  plan: ProductionArtPlan,
  normalized: NormalizedProductionArtResult,
): Promise<LayeredDepthCharacterProjection> {
  const { task, definition } = assertProjectionTask(plan, normalized);
  const normalizedBytes = normalized.normalized.readBytes();
  const normalizedSha256 = await sha256(normalizedBytes);
  if (
    normalized.normalized.byteLength !== normalizedBytes.byteLength
    || normalized.output.bytes !== normalizedBytes.byteLength
    || normalized.output.sha256 !== normalizedSha256
    || normalized.evidence.plan_id !== plan.plan_id
    || normalized.evidence.task_id !== task.task_id
    || normalized.evidence.normalized.bytes !== normalizedBytes.byteLength
    || normalized.evidence.normalized.sha256 !== normalizedSha256
    || normalized.evidence.normalized.width !== task.target.width
    || normalized.evidence.normalized.height !== task.target.height
  ) {
    fail('projection.integrity', 'Normalized production art bytes and evidence must match exactly.');
  }
  const decoded = await decodeReferenceImageRgba(normalizedBytes, 'image/png');
  if (decoded.width !== task.target.width || decoded.height !== task.target.height) {
    fail('projection.integrity', 'Decoded production character dimensions do not match the task.');
  }

  const frames = task.pose_mappings.map((pose) => Object.freeze({
    pose,
    rgba: resizeCellToRuntimeFrame(decoded.width, decoded.rgba, task, pose),
  }));
  for (const frame of frames) assertFrameGeometry(frame);
  await assertDistinctFrames(frames);

  const atlasPixels = writeAtlas(frames);
  const atlasBytes = encodeRgbaPng(atlasPixels.width, atlasPixels.height, atlasPixels.rgba);
  const atlasSha256 = await sha256(atlasBytes);
  const file: Pack10FileRecord = Object.freeze({
    path: definition.atlasPath,
    media_type: 'image/png',
    bytes: atlasBytes.byteLength,
    sha256: atlasSha256,
  });
  const atlas: Pack10Atlas = Object.freeze({
    id: definition.id,
    path: definition.atlasPath,
    cell_size: Object.freeze([RUNTIME_FRAME_WIDTH, RUNTIME_FRAME_HEIGHT] as const),
  });
  const roleBinding: Pack10RoleBinding = Object.freeze({
    role: definition.role,
    binding: Object.freeze({ kind: 'file', path: definition.atlasPath }),
  });
  const character: Pack10Character = Object.freeze({
    id: definition.id,
    atlas: definition.atlasPath,
    frame_size: Object.freeze([RUNTIME_FRAME_WIDTH, RUNTIME_FRAME_HEIGHT] as const),
    pivot: RUNTIME_PIVOT,
    clips: clipsFor(frames, definition.actions),
  });
  const record: LayeredDepthCharacterProjectionRecord = Object.freeze({
    schema_version: PROJECTION_SCHEMA_VERSION,
    document_type: 'production-character-atlas-projection',
    profile: 'layered-depth-2d',
    plan_id: plan.plan_id,
    task_id: task.task_id,
    role: definition.role,
    source: Object.freeze({
      normalized_sha256: normalizedSha256,
      width: task.target.width,
      height: task.target.height,
      cell_size: Object.freeze([task.target.cell_width, task.target.cell_height] as const),
      pivot: Object.freeze([task.pivot.x, task.pivot.y] as const),
    }),
    atlas: Object.freeze({
      path: definition.atlasPath,
      bytes: atlasBytes.byteLength,
      sha256: atlasSha256,
      width: atlasPixels.width,
      height: atlasPixels.height,
      frame_size: Object.freeze([RUNTIME_FRAME_WIDTH, RUNTIME_FRAME_HEIGHT] as const),
      pivot: RUNTIME_PIVOT,
    }),
    checks: Object.freeze({
      pose_count: frames.length,
      distinct_pose_count: frames.length,
      transparent_padding_checked: true,
      foot_anchor_range_y: Object.freeze([FOOT_ANCHOR_MIN_Y, FOOT_ANCHOR_MAX_Y] as const),
      exact_duplicates_rejected: true,
      mirrored_duplicates_rejected: true,
    }),
    human_review: 'required',
  });
  const snapshot = Uint8Array.from(atlasBytes);
  return Object.freeze({
    atlas,
    roleBinding,
    character,
    file,
    record,
    png: Object.freeze({
      byteLength: snapshot.byteLength,
      readBytes: () => Uint8Array.from(snapshot),
    }),
  });
}
