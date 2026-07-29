import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const PATHS = Object.freeze({
  generation:
    'docs/visual-qa/production-art/layered-depth-2d-prop-sheet-generation-v1.png',
  source:
    'docs/visual-qa/production-art/layered-depth-2d-prop-sheet-source-v1.png',
  rgba:
    'docs/visual-qa/production-art/layered-depth-2d-prop-sheet-rgba-v1.png',
  sourceManifest:
    'docs/visual-qa/production-art/layered-depth-2d-prop-sheet-v1.json',
  atlas:
    'docs/visual-qa/production-art/layered-depth-2d-prop-atlas-v1.png',
  atlasManifest:
    'docs/visual-qa/production-art/layered-depth-2d-prop-atlas-v1.json',
});
const GENERATION = Object.freeze({
  width: 1536,
  height: 1024,
  bytes: 1_766_562,
  sha256: 'e5b9e27215f115ce93025d8e3f5946d4c75c3c861fa9c8b72007e7bd3065f798',
});
const SOURCE = Object.freeze({
  width: 1536,
  height: 1024,
  columns: 6,
  rows: 4,
  cell: 256,
  inset: 18,
  maximumExtent: 220,
});
const ATLAS = Object.freeze({
  width: 768,
  height: 768,
  columns: 8,
  rows: 8,
  cell: 96,
  maximumExtent: 88,
});
const KEY = Object.freeze([251, 3, 251]);
const SOURCE_KEY = Object.freeze([255, 0, 255, 255]);
const KEY_TOLERANCE = 18;
const ALPHA_THRESHOLD = 16;
const X_BANDS = Object.freeze([
  [0, 285],
  [285, 540],
  [540, 780],
  [780, 1030],
  [1030, 1275],
  [1275, 1536],
]);
const Y_BANDS = Object.freeze([
  [0, 256],
  [256, 512],
  [512, 768],
  [768, 1024],
]);
const ROLES = Object.freeze([
  'terrain.ground',
  'terrain.path',
  'terrain.edge',
  'terrain.bridge',
  'terrain.stairs',
  'terrain.water',
  'prop.tree',
  'prop.rock',
  'prop.crate',
  'prop.sign',
  'prop.lamp',
  'prop.occluder',
  'structure.entrance',
  'structure.exit',
  'structure.checkpoint',
  'structure.landmark',
  'collectible.primary',
  'collectible.health',
  'effect.footstep',
  'effect.interact',
  'effect.portal',
  'effect.ambient',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeIdenticalOrNew(path, bytes) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error(`Refusing to overwrite non-identical output: ${path}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

function keyDistance(red, green, blue) {
  return Math.max(
    Math.abs(red - KEY[0]),
    Math.abs(green - KEY[1]),
    Math.abs(blue - KEY[2]),
  );
}

function matteGeneration(image) {
  const rgba = new Uint8Array(image.rgba.length);
  let transparentPixels = 0;
  let opaquePixels = 0;
  for (let offset = 0; offset < image.rgba.length; offset += 4) {
    const red = image.rgba[offset];
    const green = image.rgba[offset + 1];
    const blue = image.rgba[offset + 2];
    if (keyDistance(red, green, blue) <= KEY_TOLERANCE) {
      transparentPixels += 1;
      continue;
    }
    rgba[offset] = red;
    rgba[offset + 1] = green;
    rgba[offset + 2] = blue;
    rgba[offset + 3] = 255;
    opaquePixels += 1;
  }
  const edgePixels = [];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      const offset = index * 4;
      if (rgba[offset + 3] === 0) continue;
      const red = rgba[offset];
      const green = rgba[offset + 1];
      const blue = rgba[offset + 2];
      if (
        keyDistance(red, green, blue) > 96
        || Math.min(red, blue) - green < 48
      ) continue;
      let nextToTransparency = false;
      for (
        let neighborY = Math.max(0, y - 1);
        neighborY <= Math.min(image.height - 1, y + 1);
        neighborY += 1
      ) {
        for (
          let neighborX = Math.max(0, x - 1);
          neighborX <= Math.min(image.width - 1, x + 1);
          neighborX += 1
        ) {
          if (
            rgba[(neighborY * image.width + neighborX) * 4 + 3] === 0
          ) nextToTransparency = true;
        }
      }
      if (nextToTransparency) edgePixels.push(index);
    }
  }
  for (const index of edgePixels) rgba.fill(0, index * 4, index * 4 + 4);
  return {
    width: image.width,
    height: image.height,
    rgba,
    transparentPixels: transparentPixels + edgePixels.length,
    opaquePixels: opaquePixels - edgePixels.length,
    edgePixelsRemoved: edgePixels.length,
  };
}

function visibleBounds(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      visiblePixels += 1;
    }
  }
  if (visiblePixels === 0) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    visible_pixels: visiblePixels,
  };
}

function crop(image, bounds) {
  const rgba = new Uint8Array(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = ((bounds.y + y) * image.width + bounds.x) * 4;
    rgba.set(
      image.rgba.subarray(sourceStart, sourceStart + bounds.width * 4),
      y * bounds.width * 4,
    );
  }
  return { width: bounds.width, height: bounds.height, rgba };
}

function retainNearbyComponents(image) {
  const count = image.width * image.height;
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  const components = [];
  for (let start = 0; start < count; start += 1) {
    if (
      visited[start] !== 0
      || image.rgba[start * 4 + 3] < ALPHA_THRESHOLD
    ) continue;
    let head = 0;
    let tail = 0;
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    const pixels = [];
    visited[start] = 1;
    queue[tail] = start;
    tail += 1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      pixels.push(index);
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (
        let neighborY = Math.max(0, y - 1);
        neighborY <= Math.min(image.height - 1, y + 1);
        neighborY += 1
      ) {
        for (
          let neighborX = Math.max(0, x - 1);
          neighborX <= Math.min(image.width - 1, x + 1);
          neighborX += 1
        ) {
          const neighbor = neighborY * image.width + neighborX;
          if (
            visited[neighbor] !== 0
            || image.rgba[neighbor * 4 + 3] < ALPHA_THRESHOLD
          ) continue;
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }
    components.push({
      pixels,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    });
  }
  components.sort((first, second) => second.pixels.length - first.pixels.length);
  if (components.length === 0) throw new Error('Source band is empty.');
  const primary = components[0];
  const primaryRight = primary.bounds.x + primary.bounds.width - 1;
  const primaryBottom = primary.bounds.y + primary.bounds.height - 1;
  const rgba = new Uint8Array(image.rgba.length);
  let retained = 0;
  let removed = 0;
  let removedPixels = 0;
  for (const [index, component] of components.entries()) {
    const right = component.bounds.x + component.bounds.width - 1;
    const bottom = component.bounds.y + component.bounds.height - 1;
    const horizontalDistance = Math.max(
      0,
      primary.bounds.x - right,
      component.bounds.x - primaryRight,
    );
    const verticalDistance = Math.max(
      0,
      primary.bounds.y - bottom,
      component.bounds.y - primaryBottom,
    );
    const priorRowFragment = (
      component.bounds.y === 0
      && component.pixels.length < primary.pixels.length * 0.1
    );
    const keep = index === 0 || (
      !priorRowFragment
      && Math.max(horizontalDistance, verticalDistance) <= 48
    );
    if (!keep) {
      removed += 1;
      removedPixels += component.pixels.length;
      continue;
    }
    retained += 1;
    for (const pixel of component.pixels) {
      const offset = pixel * 4;
      rgba.set(image.rgba.subarray(offset, offset + 4), offset);
    }
  }
  return {
    image: { width: image.width, height: image.height, rgba },
    retained,
    removed,
    removedPixels,
  };
}

function fillChroma(rgba) {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba.set(SOURCE_KEY, offset);
  }
}

function blitBottomCentered({
  target,
  targetWidth,
  cell,
  image,
  column,
  row,
  inset,
  preserveAlpha,
}) {
  const x = column * cell + Math.floor((cell - image.width) / 2);
  const y = row * cell + cell - inset - image.height;
  if (
    image.width > cell - inset * 2
    || image.height > cell - inset * 2
    || x < column * cell + inset
    || y < row * cell + inset
  ) throw new Error(`Image does not fit cell ${column},${row}.`);
  for (let sourceY = 0; sourceY < image.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < image.width; sourceX += 1) {
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      if (image.rgba[sourceOffset + 3] < ALPHA_THRESHOLD) continue;
      const targetOffset = (
        ((y + sourceY) * targetWidth) + x + sourceX
      ) * 4;
      target[targetOffset] = image.rgba[sourceOffset];
      target[targetOffset + 1] = image.rgba[sourceOffset + 1];
      target[targetOffset + 2] = image.rgba[sourceOffset + 2];
      target[targetOffset + 3] = preserveAlpha
        ? image.rgba[sourceOffset + 3]
        : 255;
    }
  }
  return {
    x: x - column * cell,
    y: y - row * cell,
    width: image.width,
    height: image.height,
  };
}

function cellMetrics(image, column, row, cell) {
  const local = crop(image, {
    x: column * cell,
    y: row * cell,
    width: cell,
    height: cell,
  });
  const bounds = visibleBounds(local);
  return {
    visible_pixels: bounds?.visible_pixels ?? 0,
    bounds: bounds
      ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      : null,
  };
}

const generationBytes = await readFile(resolve(PATHS.generation));
const generation = decodeRgbaPng(generationBytes);
if (
  generation.width !== GENERATION.width
  || generation.height !== GENERATION.height
  || generationBytes.length !== GENERATION.bytes
  || sha256(generationBytes) !== GENERATION.sha256
) throw new Error('Layered-depth generation original is not approved.');

const matte = matteGeneration(generation);
const extracted = ROLES.map((role, index) => {
  const column = index % SOURCE.columns;
  const row = Math.floor(index / SOURCE.columns);
  const [xStart, xEnd] = X_BANDS[column];
  const [yStart, yEnd] = Y_BANDS[row];
  const band = crop(matte, {
    x: xStart,
    y: yStart,
    width: xEnd - xStart,
    height: yEnd - yStart,
  });
  const cleaned = retainNearbyComponents(band);
  const bounds = visibleBounds(cleaned.image);
  if (!bounds || bounds.visible_pixels < 128) {
    throw new Error(`Layered-depth source role is empty: ${role}.`);
  }
  return {
    role,
    generation_band: {
      x: xStart,
      y: yStart,
      width: xEnd - xStart,
      height: yEnd - yStart,
    },
    generation_bounds: {
      ...bounds,
      x: bounds.x + xStart,
      y: bounds.y + yStart,
    },
    component_sanitation: {
      policy: 'retain-components-within-48px-of-largest',
      retained_components: cleaned.retained,
      removed_components: cleaned.removed,
      removed_pixels: cleaned.removedPixels,
    },
    cropped: crop(cleaned.image, bounds),
  };
});
const generationLargestDimension = Math.max(
  ...extracted.flatMap(({ cropped: image }) => [image.width, image.height]),
);
const sourceScale = Math.min(
  1,
  SOURCE.maximumExtent / generationLargestDimension,
);
const sourceRgba = new Uint8Array(SOURCE.width * SOURCE.height * 4);
const transparentRgba = new Uint8Array(sourceRgba.length);
fillChroma(sourceRgba);
const sourceCells = extracted.map((entry, index) => {
  const column = index % SOURCE.columns;
  const row = Math.floor(index / SOURCE.columns);
  const scaled = resizeNearest(
    entry.cropped,
    Math.max(1, Math.round(entry.cropped.width * sourceScale)),
    Math.max(1, Math.round(entry.cropped.height * sourceScale)),
  );
  const normalized = crop(scaled, visibleBounds(scaled));
  const sourceBox = blitBottomCentered({
    target: sourceRgba,
    targetWidth: SOURCE.width,
    cell: SOURCE.cell,
    image: normalized,
    column,
    row,
    inset: SOURCE.inset,
    preserveAlpha: false,
  });
  const rgbaBox = blitBottomCentered({
    target: transparentRgba,
    targetWidth: SOURCE.width,
    cell: SOURCE.cell,
    image: normalized,
    column,
    row,
    inset: SOURCE.inset,
    preserveAlpha: true,
  });
  if (JSON.stringify(sourceBox) !== JSON.stringify(rgbaBox)) {
    throw new Error(`Source placement diverged for ${entry.role}.`);
  }
  return {
    role: entry.role,
    column,
    row,
    generation_band: entry.generation_band,
    generation_bounds: entry.generation_bounds,
    component_sanitation: entry.component_sanitation,
    strict_visible_bounds: rgbaBox,
  };
});
const sourceImage = { width: SOURCE.width, height: SOURCE.height, rgba: transparentRgba };
for (let index = 0; index < SOURCE.columns * SOURCE.rows; index += 1) {
  const column = index % SOURCE.columns;
  const row = Math.floor(index / SOURCE.columns);
  const metrics = cellMetrics(sourceImage, column, row, SOURCE.cell);
  if (index < ROLES.length) {
    if (!metrics.bounds || metrics.visible_pixels < 128) {
      throw new Error(`Mapped strict source cell ${column},${row} is empty.`);
    }
  } else if (metrics.visible_pixels !== 0) {
    throw new Error(`Reserved strict source cell ${column},${row} is not transparent.`);
  }
}

const sourceBytes = encodeRgbaPng(SOURCE.width, SOURCE.height, sourceRgba);
const rgbaBytes = encodeRgbaPng(SOURCE.width, SOURCE.height, transparentRgba);
const sourceManifest = {
  schema_version: 'mapsoo-production-art-source/1.0',
  id: 'layered-depth-2d-prop-sheet-v1',
  profile: 'layered-depth-2d',
  world_direction: 'lanternmere-crossing',
  role: 'terrain-prop-structure-collectible-effect.atlas',
  status: 'source-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  rasters: [
    {
      stage: 'generation-original',
      path: PATHS.generation,
      media_type: 'image/png',
      width: generation.width,
      height: generation.height,
      bytes: generationBytes.length,
      sha256: sha256(generationBytes),
    },
    {
      stage: 'strict-chroma-source',
      path: PATHS.source,
      media_type: 'image/png',
      width: SOURCE.width,
      height: SOURCE.height,
      bytes: sourceBytes.length,
      sha256: sha256(sourceBytes),
    },
    {
      stage: 'rgba-candidate',
      path: PATHS.rgba,
      media_type: 'image/png',
      width: SOURCE.width,
      height: SOURCE.height,
      bytes: rgbaBytes.length,
      sha256: sha256(rgbaBytes),
    },
  ],
  generation_context: {
    reference_image:
      'docs/visual-qa/production-art/layered-depth-2d-direction-v1.png',
    provider_mode: 'built-in-image-generation',
    originality_scope: 'original Lanternmere Crossing world assets',
    requested_grid: { columns: 6, rows: 4 },
    requested_key: '#ff00ff',
    default_generated_original_retained: true,
  },
  matte: {
    policy: 'fixed-max-channel-distance-hard-matte-with-key-edge-contract',
    sampled_key_rgb: [...KEY],
    tolerance: KEY_TOLERANCE,
    key_edge_contract_pixels: 1,
    key_edge_pixels_removed: matte.edgePixelsRemoved,
    transparent_pixels: matte.transparentPixels,
    opaque_pixels: matte.opaquePixels,
  },
  normalization: {
    policy: 'adaptive-generation-bands-common-scale-bottom-center',
    source_scale: sourceScale,
    generation_largest_dimension: generationLargestDimension,
    maximum_visible_extent: SOURCE.maximumExtent,
    inset: SOURCE.inset,
  },
  grid: {
    columns: SOURCE.columns,
    rows: SOURCE.rows,
    cell_width: SOURCE.cell,
    cell_height: SOURCE.cell,
    ordered_roles: [...ROLES],
    mapped_cells: sourceCells,
    reserved_cells: [
      { column: 4, row: 3 },
      { column: 5, row: 3 },
    ],
  },
  automated_checks: {
    strict_grid_geometry: 'pass',
    exact_role_count: 'pass',
    mapped_cells_visible: 'pass',
    mapped_cells_in_bounds: 'pass',
    reserved_cells_transparent: 'pass',
    deterministic_matte: 'pass',
    exact_chroma_key_visible_pixels: 0,
    role_semantics: 'manual-review',
  },
  not_accepted_for: [
    'runtime prop atlas',
    'Godot runtime pass',
    'Raspberry Pi pass',
    'human art approval',
    'public asset-pack release',
  ],
};
const sourceManifestBytes = Buffer.from(
  `${JSON.stringify(sourceManifest, null, 2)}\n`,
);

const strictCrops = sourceCells.map((cell) => crop(sourceImage, {
  x: cell.column * SOURCE.cell + cell.strict_visible_bounds.x,
  y: cell.row * SOURCE.cell + cell.strict_visible_bounds.y,
  width: cell.strict_visible_bounds.width,
  height: cell.strict_visible_bounds.height,
}));
const strictLargestDimension = Math.max(
  ...strictCrops.flatMap((image) => [image.width, image.height]),
);
const atlasScale = ATLAS.maximumExtent / strictLargestDimension;
const atlasRgba = new Uint8Array(ATLAS.width * ATLAS.height * 4);
const atlasImage = { width: ATLAS.width, height: ATLAS.height, rgba: atlasRgba };
const roleMappings = sourceCells.map((cell, index) => {
  const column = index % ATLAS.columns;
  const row = Math.floor(index / ATLAS.columns);
  const cropImage = strictCrops[index];
  const scaled = resizeNearest(
    cropImage,
    Math.max(1, Math.round(cropImage.width * atlasScale)),
    Math.max(1, Math.round(cropImage.height * atlasScale)),
  );
  const normalized = crop(scaled, visibleBounds(scaled));
  const normalizationBox = blitBottomCentered({
    target: atlasRgba,
    targetWidth: ATLAS.width,
    cell: ATLAS.cell,
    image: normalized,
    column,
    row,
    inset: 0,
    preserveAlpha: true,
  });
  const metrics = cellMetrics(atlasImage, column, row, ATLAS.cell);
  if (!metrics.bounds || metrics.visible_pixels < 32) {
    throw new Error(`Runtime atlas role is empty: ${cell.role}.`);
  }
  return {
    role: cell.role,
    canonical_role: cell.role,
    source_cell: { column: cell.column, row: cell.row },
    atlas_cell: { column, row },
    pivot: [48, 96],
    normalization_box: normalizationBox,
    placed_bounds: metrics.bounds,
    visible_pixels: metrics.visible_pixels,
  };
});
const mappedCells = new Set(
  roleMappings.map(({ atlas_cell: cell }) => `${cell.column},${cell.row}`),
);
for (let row = 0; row < ATLAS.rows; row += 1) {
  for (let column = 0; column < ATLAS.columns; column += 1) {
    const metrics = cellMetrics(atlasImage, column, row, ATLAS.cell);
    if (mappedCells.has(`${column},${row}`)) {
      if (!metrics.bounds || metrics.visible_pixels < 32) {
        throw new Error(`Mapped atlas cell ${column},${row} is empty.`);
      }
    } else if (metrics.visible_pixels !== 0) {
      throw new Error(`Unmapped atlas cell ${column},${row} is not transparent.`);
    }
  }
}
const atlasBytes = encodeRgbaPng(ATLAS.width, ATLAS.height, atlasRgba);
const atlasManifest = {
  schema_version: 'mapsoo-runtime-prop-atlas/1.0',
  id: 'layered-depth-2d-prop-atlas-v1',
  profile: 'layered-depth-2d',
  world_direction: 'lanternmere-crossing',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: PATHS.atlas,
  media_type: 'image/png',
  width: ATLAS.width,
  height: ATLAS.height,
  bytes: atlasBytes.length,
  sha256: sha256(atlasBytes),
  columns: ATLAS.columns,
  rows: ATLAS.rows,
  cell_width: ATLAS.cell,
  cell_height: ATLAS.cell,
  pivot: [48, 96],
  normalization: {
    policy: 'common-source-scale-nearest-neighbor-bottom-center',
    common_scale: atlasScale,
    largest_source_dimension: strictLargestDimension,
    maximum_visible_extent: ATLAS.maximumExtent,
  },
  source_manifest: PATHS.sourceManifest,
  source_manifest_sha256: sha256(sourceManifestBytes),
  required_roles: [...ROLES],
  role_mappings: roleMappings,
  sanitation: {
    mapped_cells: ROLES.length,
    unmapped_cells: ATLAS.columns * ATLAS.rows - ROLES.length,
  },
  automated_checks: {
    exact_target_grid: 'pass',
    deterministic_png: 'pass',
    required_roles_present: 'pass',
    canonical_roles_bound: 'pass',
    mapped_cells_visible: 'pass',
    mapped_cells_in_bounds: 'pass',
    all_unmapped_cells_transparent: 'pass',
    common_bottom_pivot: 'pass',
    exact_chroma_key_visible_pixels: 0,
    role_semantics: 'manual-review',
    godot_runtime: 'pending',
    raspberry_pi_runtime: 'pending',
    human_art_review: 'pending',
  },
  not_accepted_for: [
    'complete world asset pack',
    'Godot runtime pass',
    'Raspberry Pi pass',
    'human art approval',
    'public asset-pack release',
  ],
};

await writeIdenticalOrNew(PATHS.source, sourceBytes);
await writeIdenticalOrNew(PATHS.rgba, rgbaBytes);
await writeIdenticalOrNew(PATHS.sourceManifest, sourceManifestBytes);
await writeIdenticalOrNew(PATHS.atlas, atlasBytes);
await writeIdenticalOrNew(
  PATHS.atlasManifest,
  Buffer.from(`${JSON.stringify(atlasManifest, null, 2)}\n`),
);
console.log(
  `MAPSOO_LAYERED_DEPTH_PROP_OK roles=${ROLES.length} grid=8x8 cell=96 `
  + `sha256=${atlasManifest.sha256}`,
);
