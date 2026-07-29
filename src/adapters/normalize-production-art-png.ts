import { encodeRgbaPng } from './canvas/encode-png';
import { decodeReferenceImageRgba } from './decode-reference-image-rgba';
import {
  extractEdgeConnectedChroma,
  forceOpaque,
  pixelOffset,
  resizeNearest,
} from './production-art-png-pixels';
import {
  PRODUCTION_ART_CONTRACT_VERSION,
  assertValidProductionArtOutput,
  type ProductionArtOutput,
  type ProductionArtTask,
} from '../core/production-art-contract';
import {
  assertTrustedProductionArtSource,
  type TrustedProductionArtSource,
} from '../core/production-art-provider';

export interface ProductionArtGenerationEvidence {
  readonly schema_version: typeof PRODUCTION_ART_CONTRACT_VERSION;
  readonly document_type: 'production-art-generation-evidence';
  readonly provider: {
    readonly id: string;
    readonly version: string;
    readonly documentation_url: string;
    readonly execution: 'local' | 'remote';
    readonly provenance: 'generative-ai' | 'recorded-replay';
    readonly determinism: 'best-effort' | 'replay';
  };
  readonly plan_id: string;
  readonly profile: string;
  readonly task_id: string;
  readonly model: string;
  readonly workflow: 'image-generation' | 'image-edit' | 'recorded-replay';
  readonly provider_request_id?: string;
  readonly source: {
    readonly media_type: 'image/png';
    readonly bytes: number;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
  };
  readonly normalized: {
    readonly media_type: 'image/png';
    readonly bytes: number;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly alpha_policy: 'opaque' | 'straight-alpha';
  };
  readonly postprocess: {
    readonly resize: 'nearest-neighbor-v1';
    readonly alpha_extraction: 'none' | 'edge-connected-green-chroma-v1';
    readonly transparent_rgb_zeroed: true;
    readonly mapped_grid_cells_checked: true;
  };
  readonly human_review: 'required';
}

export interface NormalizedProductionArtResult {
  readonly output: ProductionArtOutput;
  readonly evidence: ProductionArtGenerationEvidence;
  readonly source: {
    readonly byteLength: number;
    readBytes(): Uint8Array;
  };
  readonly normalized: {
    readonly byteLength: number;
    readBytes(): Uint8Array;
  };
}

function occupiedCells(task: ProductionArtTask): ReadonlySet<string> {
  if (task.kind === 'character-animation-sheet' && task.pose_mappings) {
    return new Set(task.pose_mappings.map(({ grid_cell: cell }) => `${cell.column}:${cell.row}`));
  }
  const occupied = new Set<string>();
  for (const mapping of task.role_mappings) {
    const rect = mapping.grid_rect;
    for (let row = rect.row; row < rect.row + rect.row_span; row += 1) {
      for (let column = rect.column; column < rect.column + rect.column_span; column += 1) {
        occupied.add(`${column}:${row}`);
      }
    }
  }
  return occupied;
}

function assertPixelContract(task: ProductionArtTask, rgba: Uint8Array): void {
  const { width, height, cell_width: cellWidth, cell_height: cellHeight } = task.target;
  let transparent = 0;
  let visible = 0;
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    const alpha = rgba[offset + 3];
    if (alpha === 0) {
      transparent += 1;
      if (rgba[offset] !== 0 || rgba[offset + 1] !== 0 || rgba[offset + 2] !== 0) {
        throw new Error('Transparent output pixels must have zero RGB channels.');
      }
    } else {
      visible += 1;
      if (task.alpha_policy === 'opaque' && alpha !== 255) {
        throw new Error('Opaque production art output cannot contain partial alpha.');
      }
    }
  }
  if (task.alpha_policy === 'opaque' && transparent !== 0) {
    throw new Error('Opaque production art output cannot contain transparent pixels.');
  }
  if (task.alpha_policy === 'straight-alpha' && (transparent === 0 || visible === 0)) {
    throw new Error('Straight-alpha production art output requires both visible and transparent pixels.');
  }

  const columns = width / cellWidth;
  const rows = height / cellHeight;
  const mapped = occupiedCells(task);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const expectedVisible = mapped.has(`${column}:${row}`);
      let cellVisible = 0;
      let paddingTouched = false;
      for (let y = 0; y < cellHeight; y += 1) {
        for (let x = 0; x < cellWidth; x += 1) {
          const alpha = rgba[pixelOffset(width, column * cellWidth + x, row * cellHeight + y) + 3];
          if (alpha > 0) {
            cellVisible += 1;
            if (x === 0 || y === 0 || x === cellWidth - 1 || y === cellHeight - 1) paddingTouched = true;
          }
        }
      }
      if (expectedVisible && cellVisible === 0) {
        throw new Error(`Mapped production grid cell ${column}:${row} is empty.`);
      }
      if (!expectedVisible && cellVisible > 0) {
        throw new Error(`Unmapped production grid cell ${column}:${row} must remain transparent.`);
      }
      if (expectedVisible && task.seam_policy === 'transparent-cell-padding' && paddingTouched) {
        throw new Error(`Production grid cell ${column}:${row} touches its transparent padding boundary.`);
      }
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function normalizeProductionArtPng(
  trustedSource: TrustedProductionArtSource,
): Promise<NormalizedProductionArtResult> {
  assertTrustedProductionArtSource(trustedSource);
  const sourceBytes = trustedSource.source.readBytes();
  const decoded = await decodeReferenceImageRgba(sourceBytes, 'image/png');
  if (decoded.width !== trustedSource.source.width || decoded.height !== trustedSource.source.height) {
    throw new Error('Decoded production PNG dimensions changed after provider validation.');
  }
  const horizontalScale = decoded.width / trustedSource.task.target.width;
  const verticalScale = decoded.height / trustedSource.task.target.height;
  if (
    !Number.isSafeInteger(horizontalScale)
    || horizontalScale < 1
    || horizontalScale !== verticalScale
  ) {
    throw new Error('Production source PNG must be one exact integer scale of the approved target grid.');
  }
  const alphaRgba = trustedSource.task.alpha_policy === 'opaque'
    ? forceOpaque(decoded.rgba)
    : extractEdgeConnectedChroma(decoded.width, decoded.height, decoded.rgba);
  const normalizedRgba = resizeNearest(
    { width: decoded.width, height: decoded.height, rgba: alphaRgba },
    trustedSource.task.target.width,
    trustedSource.task.target.height,
  );
  assertPixelContract(trustedSource.task, normalizedRgba);
  const normalizedBytes = encodeRgbaPng(
    trustedSource.task.target.width,
    trustedSource.task.target.height,
    normalizedRgba,
  );
  const [sourceSha256, normalizedSha256] = await Promise.all([
    sha256(sourceBytes),
    sha256(normalizedBytes),
  ]);
  const output: ProductionArtOutput = Object.freeze({
    schema_version: PRODUCTION_ART_CONTRACT_VERSION,
    document_type: 'production-art-output',
    plan_id: trustedSource.plan.plan_id,
    profile: trustedSource.plan.profile,
    task_id: trustedSource.task.task_id,
    asset_id: `${trustedSource.task.task_id}-candidate`,
    path: trustedSource.task.expected_output_path,
    media_type: 'image/png',
    bytes: normalizedBytes.byteLength,
    sha256: normalizedSha256,
    width: trustedSource.task.target.width,
    height: trustedSource.task.target.height,
    alpha_policy: trustedSource.task.alpha_policy,
    pivot: trustedSource.task.pivot,
    roles: Object.freeze(trustedSource.task.role_mappings.map(({ role }) => role)),
    source_reference_ids: Object.freeze([...trustedSource.sourceReferenceIds]),
    rights: trustedSource.plan.rights,
  });
  assertValidProductionArtOutput(output, trustedSource.plan);
  const evidence: ProductionArtGenerationEvidence = Object.freeze({
    schema_version: PRODUCTION_ART_CONTRACT_VERSION,
    document_type: 'production-art-generation-evidence',
    provider: Object.freeze({
      id: trustedSource.provider.id,
      version: trustedSource.provider.version,
      documentation_url: trustedSource.provider.capabilities.providerDocumentationUrl,
      execution: trustedSource.provider.capabilities.execution,
      provenance: trustedSource.provider.capabilities.outputProvenance,
      determinism: trustedSource.provider.capabilities.determinism,
    }),
    plan_id: trustedSource.plan.plan_id,
    profile: trustedSource.plan.profile,
    task_id: trustedSource.task.task_id,
    model: trustedSource.generation.model,
    workflow: trustedSource.generation.workflow,
    ...(trustedSource.generation.providerRequestId === undefined
      ? {}
      : { provider_request_id: trustedSource.generation.providerRequestId }),
    source: Object.freeze({
      media_type: 'image/png',
      bytes: sourceBytes.byteLength,
      sha256: sourceSha256,
      width: decoded.width,
      height: decoded.height,
    }),
    normalized: Object.freeze({
      media_type: 'image/png',
      bytes: normalizedBytes.byteLength,
      sha256: normalizedSha256,
      width: trustedSource.task.target.width,
      height: trustedSource.task.target.height,
      alpha_policy: trustedSource.task.alpha_policy,
    }),
    postprocess: Object.freeze({
      resize: 'nearest-neighbor-v1',
      alpha_extraction: trustedSource.task.alpha_policy === 'opaque'
        ? 'none'
        : 'edge-connected-green-chroma-v1',
      transparent_rgb_zeroed: true,
      mapped_grid_cells_checked: true,
    }),
    human_review: 'required',
  });
  const sourceSnapshot = Uint8Array.from(sourceBytes);
  const normalizedSnapshot = Uint8Array.from(normalizedBytes);
  return Object.freeze({
    output,
    evidence,
    source: Object.freeze({
      byteLength: sourceSnapshot.byteLength,
      readBytes: () => Uint8Array.from(sourceSnapshot),
    }),
    normalized: Object.freeze({
      byteLength: normalizedSnapshot.byteLength,
      readBytes: () => Uint8Array.from(normalizedSnapshot),
    }),
  });
}
