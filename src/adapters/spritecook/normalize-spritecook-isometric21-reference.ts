import { encodeRgbaPng } from '../canvas/encode-png';
import { decodeReferenceImageRgba } from '../decode-reference-image-rgba';
import {
  bindReferenceImage,
  type RuntimeReferenceImage,
} from '../../core/reference-image';

export const SPRITECOOK_ISOMETRIC21_ADAPTER_VERSION = '1.0.0' as const;
export const SPRITECOOK_ISOMETRIC21_TILE_SIZES = Object.freeze([32, 64] as const);
export type SpriteCookIsometric21TileSize =
  typeof SPRITECOOK_ISOMETRIC21_TILE_SIZES[number];

const TARGET_CELL_WIDTH = 96;
const TARGET_CELL_HEIGHT = 48;
const TARGET_COLUMNS = 8;
const TARGET_ROWS = 8;

export const ISOMETRIC_TERRAIN_GEOMETRY_ROLES = Object.freeze([
  'terrain.void',
  'terrain.floor.base',
  'terrain.floor.variant',
  'terrain.floor.edge',
  'terrain.elevation.top',
  'terrain.elevation.riser-left',
  'terrain.elevation.riser-right',
  'terrain.ramp',
  'terrain.wall',
] as const);

export interface SpriteCookIsometric21TargetMapping {
  readonly role: typeof ISOMETRIC_TERRAIN_GEOMETRY_ROLES[number];
  readonly target_column: number;
  readonly target_row: number;
}

export interface SpriteCookIsometric21NormalizationReport {
  readonly schema_version: typeof SPRITECOOK_ISOMETRIC21_ADAPTER_VERSION;
  readonly document_type: 'production-art-geometry-reference-import';
  readonly adapter: Readonly<{
    id: 'spritecook-isometric21-local-export';
    version: typeof SPRITECOOK_ISOMETRIC21_ADAPTER_VERSION;
  }>;
  readonly source: Readonly<{
    convention: 'spritecook-isometric-2-1-reference-grid';
    sha256: string;
    width: number;
    height: number;
    tile_width: SpriteCookIsometric21TileSize;
    tile_height: 16 | 32;
    columns: number;
    rows: number;
    gap: 2;
    inset: 2;
    validated_cells: number;
    source_pixels_copied: false;
  }>;
  readonly output: Readonly<{
    convention: 'worldforge-isometric-terrain-task-geometry-reference';
    sha256: string;
    width: 768;
    height: 384;
    cell_width: 96;
    cell_height: 48;
    columns: 8;
    rows: 8;
    reference_role: 'environment-style';
    target_profile: 'isometric-action';
    target_task: 'terrain-sheet';
    license: 'CC0-1.0';
  }>;
  readonly target_mapping: readonly SpriteCookIsometric21TargetMapping[];
  readonly runtime_asset: false;
  readonly human_review: 'required';
  readonly public_release: 'reference-only';
}

export interface NormalizedSpriteCookIsometric21Reference {
  readonly report: SpriteCookIsometric21NormalizationReport;
  readonly png: Readonly<{
    byteLength: number;
    readBytes(): Uint8Array;
  }>;
}

export type SpriteCookIsometric21ImportErrorCode =
  | 'spritecook-isometric-import.invalid-bytes'
  | 'spritecook-isometric-import.unsupported-layout'
  | 'spritecook-isometric-import.invalid-grid'
  | 'spritecook-isometric-import.invalid-reference';

export class SpriteCookIsometric21ImportError extends Error {
  constructor(
    readonly code: SpriteCookIsometric21ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SpriteCookIsometric21ImportError';
  }
}

interface DetectedLayout {
  readonly tileWidth: SpriteCookIsometric21TileSize;
  readonly tileHeight: 16 | 32;
  readonly columns: number;
  readonly rows: number;
}

function fail(
  code: SpriteCookIsometric21ImportErrorCode,
  message: string,
): never {
  throw new SpriteCookIsometric21ImportError(code, message);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const snapshot = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', snapshot.buffer);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function detectLayout(width: number, height: number): DetectedLayout {
  const matches: DetectedLayout[] = [];
  for (const tileWidth of SPRITECOOK_ISOMETRIC21_TILE_SIZES) {
    const tileHeight = (tileWidth / 2) as 16 | 32;
    for (let columns = 1; columns <= 16; columns += 1) {
      const expectedWidth = columns * tileWidth + (columns - 1) * 2 + 4;
      if (expectedWidth !== width) continue;
      for (let rows = 1; rows <= 16; rows += 1) {
        const expectedHeight = rows * tileHeight + (rows - 1) * 2 + 4;
        if (expectedHeight === height) {
          matches.push({ tileWidth, tileHeight, columns, rows });
        }
      }
    }
  }
  if (matches.length !== 1) {
    fail(
      'spritecook-isometric-import.unsupported-layout',
      'Expected one native SpriteCook 2:1 isometric export using 32 or 64 pixel tile width, 2 pixel gaps, 2 pixel inset, and 1 to 16 rows and columns. Top-down and 1024-upscale exports are intentionally rejected.',
    );
  }
  return Object.freeze(matches[0]!);
}

function offset(width: number, x: number, y: number): number {
  return (y * width + x) * 4;
}

function samePixel(
  rgba: Uint8Array,
  leftOffset: number,
  rightOffset: number,
): boolean {
  return rgba[leftOffset] === rgba[rightOffset]
    && rgba[leftOffset + 1] === rgba[rightOffset + 1]
    && rgba[leftOffset + 2] === rgba[rightOffset + 2]
    && rgba[leftOffset + 3] === rgba[rightOffset + 3];
}

function cellCoordinate(
  value: number,
  cellSize: number,
  cellCount: number,
): Readonly<{ cell: number; local: number }> | undefined {
  const relative = value - 2;
  if (relative < 0) return undefined;
  const stride = cellSize + 2;
  const cell = Math.floor(relative / stride);
  const local = relative % stride;
  if (cell < 0 || cell >= cellCount || local >= cellSize) return undefined;
  return { cell, local };
}

function insideDiamond(
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const centerX = width / 2;
  const centerY = height / 2;
  return Math.abs((x + 0.5 - centerX) / centerX)
    + Math.abs((y + 0.5 - centerY) / centerY) <= 1;
}

function validateSourceGrid(
  rgba: Uint8Array,
  width: number,
  height: number,
  layout: DetectedLayout,
): number {
  const backgroundOffset = offset(width, 0, 0);
  const visibleByCell = Array.from(
    { length: layout.columns * layout.rows },
    () => 0,
  );
  for (let y = 0; y < height; y += 1) {
    const yCell = cellCoordinate(y, layout.tileHeight, layout.rows);
    for (let x = 0; x < width; x += 1) {
      const xCell = cellCoordinate(x, layout.tileWidth, layout.columns);
      const pixelOffset = offset(width, x, y);
      const background = samePixel(rgba, pixelOffset, backgroundOffset);
      if (!xCell || !yCell) {
        if (!background) {
          fail(
            'spritecook-isometric-import.invalid-grid',
            'SpriteCook isometric outer inset and 2 pixel gaps must use one uniform background.',
          );
        }
        continue;
      }
      if (background) continue;
      if (!insideDiamond(
        xCell.local,
        yCell.local,
        layout.tileWidth,
        layout.tileHeight,
      )) {
        fail(
          'spritecook-isometric-import.invalid-grid',
          'SpriteCook isometric reference pixels must stay inside each 2:1 diamond.',
        );
      }
      visibleByCell[yCell.cell * layout.columns + xCell.cell] += 1;
    }
  }
  if (visibleByCell.some((count) => count === 0)) {
    fail(
      'spritecook-isometric-import.invalid-grid',
      'Every declared SpriteCook isometric reference cell must contain a visible diamond.',
    );
  }
  return visibleByCell.length;
}

function drawCanonicalDiamond(
  target: Uint8Array,
  targetWidth: number,
  targetX: number,
  targetY: number,
): void {
  for (let y = 0; y < TARGET_CELL_HEIGHT; y += 1) {
    for (let x = 0; x < TARGET_CELL_WIDTH; x += 1) {
      if (!insideDiamond(x, y, TARGET_CELL_WIDTH, TARGET_CELL_HEIGHT)) continue;
      const isEdge = !insideDiamond(x - 1, y, TARGET_CELL_WIDTH, TARGET_CELL_HEIGHT)
        || !insideDiamond(x + 1, y, TARGET_CELL_WIDTH, TARGET_CELL_HEIGHT)
        || !insideDiamond(x, y - 1, TARGET_CELL_WIDTH, TARGET_CELL_HEIGHT)
        || !insideDiamond(x, y + 1, TARGET_CELL_WIDTH, TARGET_CELL_HEIGHT);
      const pixelOffset = offset(targetWidth, targetX + x, targetY + y);
      if (isEdge) {
        target.set([54, 68, 82, 255], pixelOffset);
      } else {
        const checker = (x + y) % 2 === 0;
        target.set(
          checker ? [181, 194, 207, 255] : [156, 171, 186, 255],
          pixelOffset,
        );
      }
    }
  }
}

/**
 * Validates a local SpriteCook 2:1 reference-grid export, then independently
 * renders an exact WorldForge isometric terrain-task geometry guide. No source
 * pixels, colors, prompts, credentials, paths, or vendor responses are copied.
 */
export async function normalizeSpriteCookIsometric21Reference(
  sourcePngBytes: Uint8Array,
): Promise<NormalizedSpriteCookIsometric21Reference> {
  if (!(sourcePngBytes instanceof Uint8Array) || sourcePngBytes.byteLength < 33) {
    fail(
      'spritecook-isometric-import.invalid-bytes',
      'SpriteCook isometric import requires non-empty PNG bytes.',
    );
  }
  const sourceSnapshot = Uint8Array.from(sourcePngBytes);
  let decoded: Awaited<ReturnType<typeof decodeReferenceImageRgba>>;
  try {
    decoded = await decodeReferenceImageRgba(sourceSnapshot, 'image/png');
  } catch {
    fail(
      'spritecook-isometric-import.invalid-bytes',
      'SpriteCook isometric import requires a supported, decodable PNG.',
    );
  }
  const layout = detectLayout(decoded.width, decoded.height);
  const validatedCells = validateSourceGrid(
    decoded.rgba,
    decoded.width,
    decoded.height,
    layout,
  );
  const outputWidth = TARGET_CELL_WIDTH * TARGET_COLUMNS;
  const outputHeight = TARGET_CELL_HEIGHT * TARGET_ROWS;
  const outputRgba = new Uint8Array(outputWidth * outputHeight * 4);
  const targetMapping = Object.freeze(ISOMETRIC_TERRAIN_GEOMETRY_ROLES.map(
    (role, index) => {
      const targetColumn = index % TARGET_COLUMNS;
      const targetRow = Math.floor(index / TARGET_COLUMNS);
      drawCanonicalDiamond(
        outputRgba,
        outputWidth,
        targetColumn * TARGET_CELL_WIDTH,
        targetRow * TARGET_CELL_HEIGHT,
      );
      return Object.freeze({
        role,
        target_column: targetColumn,
        target_row: targetRow,
      });
    },
  ));
  const outputBytes = encodeRgbaPng(outputWidth, outputHeight, outputRgba);
  const [sourceDigest, outputDigest] = await Promise.all([
    sha256(sourceSnapshot),
    sha256(outputBytes),
  ]);
  const outputSnapshot = Uint8Array.from(outputBytes);
  return Object.freeze({
    report: Object.freeze({
      schema_version: SPRITECOOK_ISOMETRIC21_ADAPTER_VERSION,
      document_type: 'production-art-geometry-reference-import' as const,
      adapter: Object.freeze({
        id: 'spritecook-isometric21-local-export' as const,
        version: SPRITECOOK_ISOMETRIC21_ADAPTER_VERSION,
      }),
      source: Object.freeze({
        convention: 'spritecook-isometric-2-1-reference-grid' as const,
        sha256: sourceDigest,
        width: decoded.width,
        height: decoded.height,
        tile_width: layout.tileWidth,
        tile_height: layout.tileHeight,
        columns: layout.columns,
        rows: layout.rows,
        gap: 2 as const,
        inset: 2 as const,
        validated_cells: validatedCells,
        source_pixels_copied: false as const,
      }),
      output: Object.freeze({
        convention: 'worldforge-isometric-terrain-task-geometry-reference' as const,
        sha256: outputDigest,
        width: 768 as const,
        height: 384 as const,
        cell_width: 96 as const,
        cell_height: 48 as const,
        columns: 8 as const,
        rows: 8 as const,
        reference_role: 'environment-style' as const,
        target_profile: 'isometric-action' as const,
        target_task: 'terrain-sheet' as const,
        license: 'CC0-1.0' as const,
      }),
      target_mapping: targetMapping,
      runtime_asset: false as const,
      human_review: 'required' as const,
      public_release: 'reference-only' as const,
    }),
    png: Object.freeze({
      byteLength: outputSnapshot.byteLength,
      readBytes: () => Uint8Array.from(outputSnapshot),
    }),
  });
}

/**
 * Binds the independently rendered guide into the existing provider-neutral
 * reference contract. The caller must still explicitly authorize any remote
 * upload for the single production-art task.
 */
export async function bindSpriteCookIsometric21GeometryReference(
  normalized: NormalizedSpriteCookIsometric21Reference,
  options: Readonly<{
    id?: string;
    path?: string;
  }> = {},
): Promise<RuntimeReferenceImage> {
  if (
    !normalized
    || normalized.report.adapter.id !== 'spritecook-isometric21-local-export'
    || normalized.report.output.sha256.length !== 64
  ) {
    fail(
      'spritecook-isometric-import.invalid-reference',
      'Only a validated SpriteCook isometric geometry reference can be bound.',
    );
  }
  const id = options.id ?? 'isometric-terrain-geometry-guide';
  const path = options.path ?? `references/${id}.png`;
  const bytes = normalized.png.readBytes();
  return bindReferenceImage({
    id,
    role: 'environment-style',
    path,
    mediaType: 'image/png',
    byteLength: bytes.byteLength,
    width: normalized.report.output.width,
    height: normalized.report.output.height,
    sha256: normalized.report.output.sha256,
    rights: {
      basis: 'owned',
      license: 'CC0-1.0',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  }, bytes);
}
