import { encodeRgbaPng } from '../canvas/encode-png';
import { decodeReferenceImageRgba } from '../decode-reference-image-rgba';

export const SPRITECOOK_TOPDOWN17_ADAPTER_VERSION = '1.0.0' as const;
export const SPRITECOOK_TOPDOWN17_TILE_SIZES = Object.freeze([16, 32, 64] as const);
export type SpriteCookTopdown17TileSize =
  typeof SPRITECOOK_TOPDOWN17_TILE_SIZES[number];
export type SpriteCookTopdown17Grid = 'none' | 'one-pixel';

export interface SpriteCookTopdown17MaskMapping {
  readonly mask: number;
  readonly source_column: number;
  readonly source_row: number;
  readonly target_column: number;
  readonly target_row: number;
}

export interface SpriteCookTopdown17NormalizationReport {
  readonly schema_version: typeof SPRITECOOK_TOPDOWN17_ADAPTER_VERSION;
  readonly document_type: 'terrain-autotile-authoring-import';
  readonly adapter: Readonly<{
    id: 'spritecook-topdown17-local-export';
    version: typeof SPRITECOOK_TOPDOWN17_ADAPTER_VERSION;
  }>;
  readonly source: Readonly<{
    convention: 'spritecook-topdown-17-edge-mask-guide';
    sha256: string;
    width: number;
    height: number;
    tile_size: SpriteCookTopdown17TileSize;
    grid: SpriteCookTopdown17Grid;
  }>;
  readonly output: Readonly<{
    convention: 'worldforge-edge-mask-16';
    bit_order: readonly ['north', 'east', 'south', 'west'];
    sha256: string;
    width: number;
    height: number;
    cell_width: SpriteCookTopdown17TileSize;
    cell_height: SpriteCookTopdown17TileSize;
  }>;
  readonly mapping: readonly SpriteCookTopdown17MaskMapping[];
  readonly human_review: 'required';
  readonly public_release: 'not-authorized';
}

export interface NormalizedSpriteCookTopdown17Export {
  readonly report: SpriteCookTopdown17NormalizationReport;
  readonly png: Readonly<{
    byteLength: number;
    readBytes(): Uint8Array;
  }>;
}

export type SpriteCookTopdown17ImportErrorCode =
  | 'spritecook-import.invalid-bytes'
  | 'spritecook-import.unsupported-layout'
  | 'spritecook-import.invalid-target';

export class SpriteCookTopdown17ImportError extends Error {
  constructor(
    readonly code: SpriteCookTopdown17ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SpriteCookTopdown17ImportError';
  }
}

const BIT_ORDER = Object.freeze([
  'north',
  'east',
  'south',
  'west',
] as const);

/*
 * SpriteCook's open 17-piece guide stores the 16 N/E/S/W combinations in
 * rows 1-4 of a 5x5 sheet. Row 0 is empty and cell (4,1) is an additional
 * inner-corner helper. The values below are derived from the documented
 * connection labels, not copied rendering code.
 */
const SOURCE_CELL_BY_MASK = Object.freeze([
  Object.freeze({ column: 0, row: 4 }), // none
  Object.freeze({ column: 0, row: 3 }), // north
  Object.freeze({ column: 1, row: 4 }), // east
  Object.freeze({ column: 1, row: 3 }), // north + east
  Object.freeze({ column: 0, row: 1 }), // south
  Object.freeze({ column: 0, row: 2 }), // north + south
  Object.freeze({ column: 1, row: 1 }), // east + south
  Object.freeze({ column: 1, row: 2 }), // north + east + south
  Object.freeze({ column: 3, row: 4 }), // west
  Object.freeze({ column: 3, row: 3 }), // north + west
  Object.freeze({ column: 2, row: 4 }), // east + west
  Object.freeze({ column: 2, row: 3 }), // north + east + west
  Object.freeze({ column: 3, row: 1 }), // south + west
  Object.freeze({ column: 3, row: 2 }), // north + south + west
  Object.freeze({ column: 2, row: 1 }), // east + south + west
  Object.freeze({ column: 2, row: 2 }), // all
] as const);

function fail(
  code: SpriteCookTopdown17ImportErrorCode,
  message: string,
): never {
  throw new SpriteCookTopdown17ImportError(code, message);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const snapshot = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', snapshot.buffer);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function detectLayout(width: number, height: number): Readonly<{
  tileSize: SpriteCookTopdown17TileSize;
  grid: SpriteCookTopdown17Grid;
  inset: number;
  stride: number;
}> {
  if (width !== height) {
    fail(
      'spritecook-import.unsupported-layout',
      'SpriteCook top-down 17-piece input must be a square native export.',
    );
  }
  for (const tileSize of SPRITECOOK_TOPDOWN17_TILE_SIZES) {
    if (width === tileSize * 5) {
      return Object.freeze({
        tileSize,
        grid: 'none' as const,
        inset: 0,
        stride: tileSize,
      });
    }
    if (width === tileSize * 5 + 6) {
      return Object.freeze({
        tileSize,
        grid: 'one-pixel' as const,
        inset: 1,
        stride: tileSize + 1,
      });
    }
  }
  fail(
    'spritecook-import.unsupported-layout',
    'Expected a native 17-piece 5x5 export using 16, 32, or 64 pixel cells, with optional one-pixel grid lines. Corner-mask 15-piece and 1024-upscale exports are intentionally rejected.',
  );
}

function targetSize(value: unknown, fallback: SpriteCookTopdown17TileSize):
SpriteCookTopdown17TileSize {
  if (value === undefined) return fallback;
  if (!SPRITECOOK_TOPDOWN17_TILE_SIZES.includes(
    value as SpriteCookTopdown17TileSize,
  )) {
    fail(
      'spritecook-import.invalid-target',
      'Target cell size must be 16, 32, or 64 pixels.',
    );
  }
  return value as SpriteCookTopdown17TileSize;
}

function sourceOffset(
  width: number,
  x: number,
  y: number,
): number {
  return (y * width + x) * 4;
}

function copyNearestCell(
  source: Uint8Array,
  sourceWidth: number,
  sourceX: number,
  sourceY: number,
  sourceSize: number,
  target: Uint8Array,
  targetWidth: number,
  targetX: number,
  targetY: number,
  targetCellSize: number,
): void {
  for (let y = 0; y < targetCellSize; y += 1) {
    const sampleY = sourceY + Math.floor(y * sourceSize / targetCellSize);
    for (let x = 0; x < targetCellSize; x += 1) {
      const sampleX = sourceX + Math.floor(x * sourceSize / targetCellSize);
      const from = sourceOffset(sourceWidth, sampleX, sampleY);
      const to = sourceOffset(targetWidth, targetX + x, targetY + y);
      target[to] = source[from]!;
      target[to + 1] = source[from + 1]!;
      target[to + 2] = source[from + 2]!;
      target[to + 3] = source[from + 3]!;
    }
  }
}

/**
 * Converts a local SpriteCook 17-piece top-down guide export into the neutral
 * WorldForge 4x4 edge-mask order. It makes no network request and carries no
 * source path, prompt, credential, or provider response into the report.
 */
export async function normalizeSpriteCookTopdown17Export(
  sourcePngBytes: Uint8Array,
  options: Readonly<{ targetCellSize?: SpriteCookTopdown17TileSize }> = {},
): Promise<NormalizedSpriteCookTopdown17Export> {
  if (!(sourcePngBytes instanceof Uint8Array) || sourcePngBytes.byteLength < 33) {
    fail(
      'spritecook-import.invalid-bytes',
      'SpriteCook import requires non-empty PNG bytes.',
    );
  }
  const sourceSnapshot = Uint8Array.from(sourcePngBytes);
  let decoded: Awaited<ReturnType<typeof decodeReferenceImageRgba>>;
  try {
    decoded = await decodeReferenceImageRgba(sourceSnapshot, 'image/png');
  } catch {
    fail(
      'spritecook-import.invalid-bytes',
      'SpriteCook import requires a supported, decodable PNG.',
    );
  }
  const layout = detectLayout(decoded.width, decoded.height);
  const cellSize = targetSize(options.targetCellSize, layout.tileSize);
  const outputWidth = cellSize * 4;
  const outputHeight = cellSize * 4;
  const outputRgba = new Uint8Array(outputWidth * outputHeight * 4);
  const mapping = Object.freeze(SOURCE_CELL_BY_MASK.map((sourceCell, mask) => {
    const targetColumn = mask % 4;
    const targetRow = Math.floor(mask / 4);
    const sourceX = layout.inset + sourceCell.column * layout.stride;
    const sourceY = layout.inset + sourceCell.row * layout.stride;
    copyNearestCell(
      decoded.rgba,
      decoded.width,
      sourceX,
      sourceY,
      layout.tileSize,
      outputRgba,
      outputWidth,
      targetColumn * cellSize,
      targetRow * cellSize,
      cellSize,
    );
    return Object.freeze({
      mask,
      source_column: sourceCell.column,
      source_row: sourceCell.row,
      target_column: targetColumn,
      target_row: targetRow,
    });
  }));
  const outputBytes = encodeRgbaPng(outputWidth, outputHeight, outputRgba);
  const [sourceDigest, outputDigest] = await Promise.all([
    sha256(sourceSnapshot),
    sha256(outputBytes),
  ]);
  const outputSnapshot = Uint8Array.from(outputBytes);
  return Object.freeze({
    report: Object.freeze({
      schema_version: SPRITECOOK_TOPDOWN17_ADAPTER_VERSION,
      document_type: 'terrain-autotile-authoring-import' as const,
      adapter: Object.freeze({
        id: 'spritecook-topdown17-local-export' as const,
        version: SPRITECOOK_TOPDOWN17_ADAPTER_VERSION,
      }),
      source: Object.freeze({
        convention: 'spritecook-topdown-17-edge-mask-guide' as const,
        sha256: sourceDigest,
        width: decoded.width,
        height: decoded.height,
        tile_size: layout.tileSize,
        grid: layout.grid,
      }),
      output: Object.freeze({
        convention: 'worldforge-edge-mask-16' as const,
        bit_order: BIT_ORDER,
        sha256: outputDigest,
        width: outputWidth,
        height: outputHeight,
        cell_width: cellSize,
        cell_height: cellSize,
      }),
      mapping,
      human_review: 'required' as const,
      public_release: 'not-authorized' as const,
    }),
    png: Object.freeze({
      byteLength: outputSnapshot.byteLength,
      readBytes: () => Uint8Array.from(outputSnapshot),
    }),
  });
}
