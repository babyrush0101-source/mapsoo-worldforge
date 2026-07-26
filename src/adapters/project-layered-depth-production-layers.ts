import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import type { NormalizedProductionArtResult } from './normalize-production-art-png';
import {
  assertValidProductionArtOutput,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../core/production-art-contract';
import type {
  Pack10FileRecord,
  Pack10Manifest,
  Pack10RoleBinding,
} from '../core/pack-manifest-1.0';

const PROJECTION_SCHEMA_VERSION = '1.0.0' as const;
const RUNTIME_WIDTH = 640;
const RUNTIME_HEIGHT = 360;
const APPROVED_DIRECTION_REFERENCE_ID = 'approved-scene-direction';

const LAYER_DEFINITIONS = Object.freeze([
  {
    id: 'sky',
    role: 'background.sky',
    path: 'layers/background-sky.png',
    blend: 'mix',
  },
  {
    id: 'far',
    role: 'background.far',
    path: 'layers/background-far.png',
    blend: 'mix',
  },
  {
    id: 'mid',
    role: 'background.mid',
    path: 'layers/background-mid.png',
    blend: 'mix',
  },
  {
    id: 'depth-fog',
    role: 'background.depth-fog',
    path: 'layers/background-depth-fog.png',
    blend: 'mix',
  },
  {
    id: 'near',
    role: 'near.overlay',
    path: 'layers/near-overlay.png',
    blend: 'mix',
  },
  {
    id: 'ambient-light',
    role: 'lighting.ambient',
    path: 'layers/lighting-ambient.png',
    blend: 'multiply',
  },
  {
    id: 'local-light',
    role: 'lighting.local',
    path: 'layers/lighting-local.png',
    blend: 'add',
  },
  {
    id: 'foreground',
    role: 'foreground.overlay',
    path: 'layers/foreground-overlay.png',
    blend: 'mix',
  },
] as const satisfies readonly Readonly<{
  id: string;
  role: string;
  path: string;
  blend: 'mix' | 'add' | 'multiply';
}>[]);

type Pack10Plane = Pack10Manifest['planes'][number];

export type LayeredDepthLayerProjectionErrorCode =
  | 'layer-projection.invalid-inventory'
  | 'layer-projection.invalid-direction'
  | 'layer-projection.style-binding'
  | 'layer-projection.integrity'
  | 'layer-projection.empty-layer';

export class LayeredDepthLayerProjectionError extends Error {
  constructor(
    readonly code: LayeredDepthLayerProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LayeredDepthLayerProjectionError';
  }
}

export interface LayeredDepthProductionLayerProjectionRecord {
  readonly schema_version: typeof PROJECTION_SCHEMA_VERSION;
  readonly document_type: 'production-layer-pack10-projection';
  readonly profile: 'layered-depth-2d';
  readonly plan_id: string;
  readonly approved_direction: {
    readonly task_id: 'scene-direction';
    readonly normalized_sha256: string;
  };
  readonly runtime_size: readonly [640, 360];
  readonly planes: readonly Readonly<{
    id: string;
    role: string;
    source_task_id: string;
    source_normalized_sha256: string;
    path: string;
    bytes: number;
    sha256: string;
    alpha_policy: 'opaque' | 'straight-alpha';
  }>[];
  readonly checks: {
    readonly exact_canonical_planes: true;
    readonly approved_direction_bound: true;
    readonly normalized_evidence_bound: true;
    readonly transparent_rgb_zeroed: true;
    readonly output_alpha_checked: true;
  };
  readonly seam_review: 'required';
  readonly human_review: 'required';
}

export interface ProjectedProductionLayer {
  readonly plane: Pack10Plane;
  readonly roleBinding: Pack10RoleBinding;
  readonly file: Pack10FileRecord;
  readonly png: {
    readonly byteLength: number;
    readBytes(): Uint8Array;
  };
}

export interface LayeredDepthProductionLayerProjection {
  readonly planes: readonly ProjectedProductionLayer[];
  readonly record: LayeredDepthProductionLayerProjectionRecord;
}

function fail(
  code: LayeredDepthLayerProjectionErrorCode,
  message: string,
): never {
  throw new LayeredDepthLayerProjectionError(code, message);
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

function resizeNearestEndpoints(
  source: { readonly width: number; readonly height: number; readonly rgba: Uint8Array },
): Uint8Array {
  const output = new Uint8Array(RUNTIME_WIDTH * RUNTIME_HEIGHT * 4);
  for (let y = 0; y < RUNTIME_HEIGHT; y += 1) {
    const sourceY = Math.round(y * (source.height - 1) / (RUNTIME_HEIGHT - 1));
    for (let x = 0; x < RUNTIME_WIDTH; x += 1) {
      const sourceX = Math.round(x * (source.width - 1) / (RUNTIME_WIDTH - 1));
      const sourceOffset = pixelOffset(source.width, sourceX, sourceY);
      output.set(
        source.rgba.subarray(sourceOffset, sourceOffset + 4),
        pixelOffset(RUNTIME_WIDTH, x, y),
      );
    }
  }
  return output;
}

function assertRuntimeAlpha(
  definition: typeof LAYER_DEFINITIONS[number],
  rgba: Uint8Array,
): void {
  let visible = 0;
  let transparent = 0;
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    const alpha = rgba[offset + 3];
    if (alpha === 0) {
      transparent += 1;
      if (rgba[offset] !== 0 || rgba[offset + 1] !== 0 || rgba[offset + 2] !== 0) {
        fail('layer-projection.integrity', `${definition.id} transparent RGB is not zero.`);
      }
    } else {
      visible += 1;
      if (alpha !== 255) {
        fail('layer-projection.integrity', `${definition.id} contains unsupported partial alpha.`);
      }
    }
  }
  if (
    visible < 1
    || (definition.role === 'background.sky' && transparent > 0)
    || (definition.role !== 'background.sky' && transparent < 1)
  ) {
    fail('layer-projection.empty-layer', `${definition.id} runtime alpha inventory is invalid.`);
  }
}

async function verifiedBytes(
  plan: ProductionArtPlan,
  result: NormalizedProductionArtResult,
  task: ProductionArtTask,
): Promise<{
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly decoded: Awaited<ReturnType<typeof decodeReferenceImageRgba>>;
}> {
  assertValidProductionArtOutput(result.output, plan);
  if (result.output.task_id !== task.task_id) {
    fail('layer-projection.invalid-inventory', 'Normalized layer result targets the wrong task.');
  }
  const bytes = result.normalized.readBytes();
  const digest = await sha256(bytes);
  if (
    result.normalized.byteLength !== bytes.byteLength
    || result.output.bytes !== bytes.byteLength
    || result.output.sha256 !== digest
    || result.evidence.plan_id !== plan.plan_id
    || result.evidence.task_id !== task.task_id
    || result.evidence.normalized.bytes !== bytes.byteLength
    || result.evidence.normalized.sha256 !== digest
    || result.evidence.normalized.width !== task.target.width
    || result.evidence.normalized.height !== task.target.height
  ) {
    fail('layer-projection.integrity', 'Normalized layer bytes and evidence do not match.');
  }
  const decoded = await decodeReferenceImageRgba(bytes, 'image/png');
  if (decoded.width !== task.target.width || decoded.height !== task.target.height) {
    fail('layer-projection.integrity', 'Decoded layer dimensions changed after normalization.');
  }
  return { bytes: Uint8Array.from(bytes), sha256: digest, decoded };
}

/**
 * Converts all eight normalized layered-depth production planes to the fixed
 * 640x360 Pack 1.0 runtime layer inventory. The approved direction image is
 * hash-bound but intentionally excluded from the runtime pack.
 */
export async function projectLayeredDepthProductionLayers(
  plan: ProductionArtPlan,
  approvedDirection: NormalizedProductionArtResult,
  layerResults: readonly NormalizedProductionArtResult[],
): Promise<LayeredDepthProductionLayerProjection> {
  if (plan.profile !== 'layered-depth-2d') {
    fail('layer-projection.invalid-inventory', 'Layer projection requires a layered-depth plan.');
  }
  const directionTask = plan.tasks.find(({ task_id: taskId }) => taskId === 'scene-direction');
  if (!directionTask) {
    fail('layer-projection.invalid-direction', 'Layered-depth scene-direction task is missing.');
  }
  const direction = await verifiedBytes(plan, approvedDirection, directionTask);
  if (
    approvedDirection.output.source_reference_ids.includes(APPROVED_DIRECTION_REFERENCE_ID)
    || approvedDirection.output.roles.length !== 1
    || approvedDirection.output.roles[0] !== 'world.preview'
  ) {
    fail('layer-projection.invalid-direction', 'Approved direction output binding is invalid.');
  }
  const resultByTask = new Map<string, NormalizedProductionArtResult>();
  for (const result of layerResults) {
    if (resultByTask.has(result.output.task_id)) {
      fail('layer-projection.invalid-inventory', 'Layer projection received a duplicate task result.');
    }
    resultByTask.set(result.output.task_id, result);
  }
  if (resultByTask.size !== LAYER_DEFINITIONS.length) {
    fail('layer-projection.invalid-inventory', 'Layer projection requires exactly eight plane results.');
  }

  const projected: ProjectedProductionLayer[] = [];
  const recordPlanes: LayeredDepthProductionLayerProjectionRecord['planes'][number][] = [];
  for (const definition of LAYER_DEFINITIONS) {
    const task = plan.tasks.find(({ role_mappings: mappings, kind }) =>
      kind === 'background-layer' && mappings[0]?.role === definition.role);
    const result = task ? resultByTask.get(task.task_id) : undefined;
    if (!task || !result) {
      fail('layer-projection.invalid-inventory', `Missing canonical plane: ${definition.id}.`);
    }
    if (
      result.output.source_reference_ids.length < 1
      || !result.output.source_reference_ids.includes(APPROVED_DIRECTION_REFERENCE_ID)
    ) {
      fail('layer-projection.style-binding', `${definition.id} is not bound to the approved direction.`);
    }
    const verified = await verifiedBytes(plan, result, task);
    const runtimeRgba = resizeNearestEndpoints(verified.decoded);
    assertRuntimeAlpha(definition, runtimeRgba);
    const runtimeBytes = encodeRgbaPng(RUNTIME_WIDTH, RUNTIME_HEIGHT, runtimeRgba);
    const runtimeSha256 = await sha256(runtimeBytes);
    const snapshot = Uint8Array.from(runtimeBytes);
    const file: Pack10FileRecord = Object.freeze({
      path: definition.path,
      media_type: 'image/png',
      bytes: snapshot.byteLength,
      sha256: runtimeSha256,
    });
    const plane: Pack10Plane = Object.freeze({
      id: definition.id,
      role: definition.role,
      path: definition.path,
      layer: definition.id,
      blend: definition.blend,
    });
    projected.push(Object.freeze({
      plane,
      roleBinding: Object.freeze({
        role: definition.role,
        binding: Object.freeze({ kind: 'file', path: definition.path }),
      }),
      file,
      png: Object.freeze({
        byteLength: snapshot.byteLength,
        readBytes: () => Uint8Array.from(snapshot),
      }),
    }));
    recordPlanes.push(Object.freeze({
      id: definition.id,
      role: definition.role,
      source_task_id: task.task_id,
      source_normalized_sha256: verified.sha256,
      path: definition.path,
      bytes: snapshot.byteLength,
      sha256: runtimeSha256,
      alpha_policy: task.alpha_policy,
    }));
  }
  if ([...resultByTask.keys()].some((taskId) =>
    !recordPlanes.some(({ source_task_id: sourceTaskId }) => sourceTaskId === taskId))) {
    fail('layer-projection.invalid-inventory', 'Layer projection received an unexpected task result.');
  }
  const record: LayeredDepthProductionLayerProjectionRecord = Object.freeze({
    schema_version: PROJECTION_SCHEMA_VERSION,
    document_type: 'production-layer-pack10-projection',
    profile: 'layered-depth-2d',
    plan_id: plan.plan_id,
    approved_direction: Object.freeze({
      task_id: 'scene-direction',
      normalized_sha256: direction.sha256,
    }),
    runtime_size: Object.freeze([RUNTIME_WIDTH, RUNTIME_HEIGHT] as const),
    planes: Object.freeze(recordPlanes),
    checks: Object.freeze({
      exact_canonical_planes: true,
      approved_direction_bound: true,
      normalized_evidence_bound: true,
      transparent_rgb_zeroed: true,
      output_alpha_checked: true,
    }),
    seam_review: 'required',
    human_review: 'required',
  });
  return Object.freeze({
    planes: Object.freeze(projected),
    record,
  });
}
