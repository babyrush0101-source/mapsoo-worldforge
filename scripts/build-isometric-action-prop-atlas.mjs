import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const GENERATION_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-sheet-generation-v1.png';
const SOURCE_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-sheet-source-v1.png';
const RGBA_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-sheet-rgba-v1.png';
const SOURCE_MANIFEST_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-sheet-v1.json';
const OUTPUT_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-atlas-v1.png';
const OUTPUT_MANIFEST_PATH =
  'docs/visual-qa/production-art/isometric-action-prop-atlas-v1.json';
const GENERATION_EXPECTED = Object.freeze({
  width: 1536,
  height: 1024,
  bytes: 1_605_112,
  sha256: 'd50ecf478a035197faa5e97ccf18bdd48f809a1ef7bad77feb0713c833e729f7',
});
const SOURCE_GRID = Object.freeze({
  width: 1536,
  height: 1024,
  columns: 6,
  rows: 4,
  cell: 256,
  inset: 18,
  maximumVisibleExtent: 220,
});
const ATLAS = Object.freeze({
  width: 768,
  height: 768,
  columns: 8,
  rows: 8,
  cell: 96,
  maximumVisibleExtent: 88,
});
const KEY = Object.freeze([251, 3, 251]);
const SOURCE_KEY = Object.freeze([255, 0, 255, 255]);
const KEY_TOLERANCE = 18;
const ALPHA_THRESHOLD = 16;
const X_BANDS = Object.freeze([
  [0, 300],
  [300, 550],
  [550, 790],
  [790, 1030],
  [1030, 1280],
  [1280, 1536],
]);
const Y_BANDS = Object.freeze([
  [0, 256],
  [256, 512],
  [512, 768],
  [768, 1024],
]);
const ORDERED_ROLES = Object.freeze([
  'hazard.contact',
  'hazard.telegraph',
  'prop.blocker',
  'prop.breakable',
  'prop.cover',
  'prop.decoration',
  'prop.light',
  'structure.entrance',
  'structure.exit',
  'structure.checkpoint',
  'collectible.primary',
  'collectible.health',
  'effect.player-attack',
  'effect.enemy-attack',
  'effect.projectile',
  'effect.impact',
  'effect.dash',
  'effect.spawn',
  'effect.defeat',
  'effect.shadow',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeIdenticalOrNew(path, bytes) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error(`Refusing to overwrite non-identical generated output: ${path}`);
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
  const edgePixelsToClear = [];
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
      let bordersTransparency = false;
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
          ) bordersTransparency = true;
        }
      }
      if (bordersTransparency) edgePixelsToClear.push(index);
    }
  }
  for (const index of edgePixelsToClear) rgba.fill(0, index * 4, index * 4 + 4);
  transparentPixels += edgePixelsToClear.length;
  opaquePixels -= edgePixelsToClear.length;
  return {
    width: image.width,
    height: image.height,
    rgba,
    transparentPixels,
    opaquePixels,
    edgePixelsRemoved: edgePixelsToClear.length,
  };
}

function visibleBounds(image, region = null) {
  const xStart = region?.[0] ?? 0;
  const yStart = region?.[1] ?? 0;
  const xEnd = region?.[2] ?? image.width;
  const yEnd = region?.[3] ?? image.height;
  let minX = xEnd;
  let minY = yEnd;
  let maxX = -1;
  let maxY = -1;
  let visiblePixels = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
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

function retainNearbyComponents(image) {
  const pixelCount = image.width * image.height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (
      visited[start] !== 0
      || image.rgba[start * 4 + 3] < ALPHA_THRESHOLD
    ) continue;
    let head = 0;
    let tail = 0;
    const pixels = [];
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
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
      bounds: {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
    });
  }
  components.sort((first, second) => second.pixels.length - first.pixels.length);
  if (components.length === 0) throw new Error('Cannot clean an empty source band.');
  const primary = components[0];
  const output = new Uint8Array(image.rgba.length);
  let retainedComponents = 0;
  let removedComponents = 0;
  let removedPixels = 0;
  const primaryRight = primary.bounds.x + primary.bounds.width - 1;
  const primaryBottom = primary.bounds.y + primary.bounds.height - 1;
  for (const [index, component] of components.entries()) {
    const componentRight = component.bounds.x + component.bounds.width - 1;
    const componentBottom = component.bounds.y + component.bounds.height - 1;
    const horizontalDistance = Math.max(
      0,
      primary.bounds.x - componentRight,
      component.bounds.x - primaryRight,
    );
    const verticalDistance = Math.max(
      0,
      primary.bounds.y - componentBottom,
      component.bounds.y - primaryBottom,
    );
    const touchesPreviousRow = (
      component.bounds.y === 0
      && component.pixels.length < primary.pixels.length * 0.1
    );
    const retain = index === 0 || (
      !touchesPreviousRow
      && Math.max(horizontalDistance, verticalDistance) <= 48
    );
    if (!retain) {
      removedComponents += 1;
      removedPixels += component.pixels.length;
      continue;
    }
    retainedComponents += 1;
    for (const pixel of component.pixels) {
      const offset = pixel * 4;
      output.set(image.rgba.subarray(offset, offset + 4), offset);
    }
  }
  return {
    image: { width: image.width, height: image.height, rgba: output },
    retainedComponents,
    removedComponents,
    removedPixels,
  };
}

function crop(image, bounds) {
  const rgba = new Uint8Array(bounds.width * bounds.height * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = ((bounds.y + y) * image.width + bounds.x) * 4;
    const targetStart = y * bounds.width * 4;
    rgba.set(
      image.rgba.subarray(sourceStart, sourceStart + bounds.width * 4),
      targetStart,
    );
  }
  return { width: bounds.width, height: bounds.height, rgba };
}

function fillChroma(rgba) {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba.set(SOURCE_KEY, offset);
  }
}

function blitBottomCentered({
  targetRgba,
  targetWidth,
  cell,
  image,
  column,
  row,
  inset,
  transparentBackground,
}) {
  const x = column * cell + Math.floor((cell - image.width) / 2);
  const y = row * cell + cell - inset - image.height;
  if (
    image.width > cell - inset * 2
    || image.height > cell - inset * 2
    || x < column * cell + inset
    || y < row * cell + inset
  ) {
    throw new Error(`Sprite does not fit target cell ${column},${row}.`);
  }
  for (let sourceY = 0; sourceY < image.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < image.width; sourceX += 1) {
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      if (image.rgba[sourceOffset + 3] < ALPHA_THRESHOLD) continue;
      const targetOffset = (
        ((y + sourceY) * targetWidth) + x + sourceX
      ) * 4;
      targetRgba[targetOffset] = image.rgba[sourceOffset];
      targetRgba[targetOffset + 1] = image.rgba[sourceOffset + 1];
      targetRgba[targetOffset + 2] = image.rgba[sourceOffset + 2];
      targetRgba[targetOffset + 3] = transparentBackground
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
  const bounds = visibleBounds(image, [
    column * cell,
    row * cell,
    (column + 1) * cell,
    (row + 1) * cell,
  ]);
  if (!bounds) return { visible_pixels: 0, bounds: null };
  return {
    visible_pixels: bounds.visible_pixels,
    bounds: {
      x: bounds.x - column * cell,
      y: bounds.y - row * cell,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

const generationBytes = await readFile(resolve(GENERATION_PATH));
const generation = decodeRgbaPng(generationBytes);
if (
  generation.width !== GENERATION_EXPECTED.width
  || generation.height !== GENERATION_EXPECTED.height
  || generationBytes.length !== GENERATION_EXPECTED.bytes
  || sha256(generationBytes) !== GENERATION_EXPECTED.sha256
) {
  throw new Error('Isometric prop generation input does not match the approved image.');
}
const matte = matteGeneration(generation);
const extracted = [];
for (let index = 0; index < ORDERED_ROLES.length; index += 1) {
  const column = index % SOURCE_GRID.columns;
  const row = Math.floor(index / SOURCE_GRID.columns);
  const xBand = X_BANDS[column];
  const yBand = Y_BANDS[row];
  const band = crop(matte, {
    x: xBand[0],
    y: yBand[0],
    width: xBand[1] - xBand[0],
    height: yBand[1] - yBand[0],
  });
  const cleaned = retainNearbyComponents(band);
  const localBounds = visibleBounds(cleaned.image);
  if (!localBounds || localBounds.visible_pixels < 256) {
    throw new Error(`Generated source role ${ORDERED_ROLES[index]} is empty.`);
  }
  const bounds = {
    ...localBounds,
    x: localBounds.x + xBand[0],
    y: localBounds.y + yBand[0],
  };
  extracted.push({
    role: ORDERED_ROLES[index],
    generation_band: {
      x: xBand[0],
      y: yBand[0],
      width: xBand[1] - xBand[0],
      height: yBand[1] - yBand[0],
    },
    generation_bounds: bounds,
    component_sanitation: {
      policy: 'retain-components-within-48px-of-largest',
      retained_components: cleaned.retainedComponents,
      removed_components: cleaned.removedComponents,
      removed_pixels: cleaned.removedPixels,
    },
    cropped: crop(cleaned.image, localBounds),
  });
}
const generationLargestDimension = Math.max(
  ...extracted.flatMap(({ cropped: image }) => [image.width, image.height]),
);
const sourceScale = Math.min(
  1,
  SOURCE_GRID.maximumVisibleExtent / generationLargestDimension,
);
const strictSourceRgba = new Uint8Array(
  SOURCE_GRID.width * SOURCE_GRID.height * 4,
);
fillChroma(strictSourceRgba);
const strictRgba = new Uint8Array(strictSourceRgba.length);
const strictCells = extracted.map((entry, index) => {
  const column = index % SOURCE_GRID.columns;
  const row = Math.floor(index / SOURCE_GRID.columns);
  const scaled = resizeNearest(
    entry.cropped,
    Math.max(1, Math.round(entry.cropped.width * sourceScale)),
    Math.max(1, Math.round(entry.cropped.height * sourceScale)),
  );
  const normalized = crop(scaled, visibleBounds(scaled));
  const sourceBox = blitBottomCentered({
    targetRgba: strictSourceRgba,
    targetWidth: SOURCE_GRID.width,
    cell: SOURCE_GRID.cell,
    image: normalized,
    column,
    row,
    inset: SOURCE_GRID.inset,
    transparentBackground: false,
  });
  const rgbaBox = blitBottomCentered({
    targetRgba: strictRgba,
    targetWidth: SOURCE_GRID.width,
    cell: SOURCE_GRID.cell,
    image: normalized,
    column,
    row,
    inset: SOURCE_GRID.inset,
    transparentBackground: true,
  });
  if (JSON.stringify(sourceBox) !== JSON.stringify(rgbaBox)) {
    throw new Error(`Strict source and RGBA placement diverged for ${entry.role}.`);
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

for (let index = 0; index < SOURCE_GRID.columns * SOURCE_GRID.rows; index += 1) {
  const column = index % SOURCE_GRID.columns;
  const row = Math.floor(index / SOURCE_GRID.columns);
  const metrics = cellMetrics(
    { width: SOURCE_GRID.width, height: SOURCE_GRID.height, rgba: strictRgba },
    column,
    row,
    SOURCE_GRID.cell,
  );
  if (index < ORDERED_ROLES.length) {
    if (!metrics.bounds || metrics.visible_pixels < 128) {
      throw new Error(`Strict mapped source cell ${column},${row} is empty.`);
    }
  } else if (metrics.visible_pixels !== 0) {
    throw new Error(`Strict reserved source cell ${column},${row} is not transparent.`);
  }
}

const strictSourceBytes = encodeRgbaPng(
  SOURCE_GRID.width,
  SOURCE_GRID.height,
  strictSourceRgba,
);
const strictRgbaBytes = encodeRgbaPng(
  SOURCE_GRID.width,
  SOURCE_GRID.height,
  strictRgba,
);
const sourceManifest = {
  schema_version: 'mapsoo-production-art-source/1.0',
  id: 'isometric-action-prop-sheet-v1',
  profile: 'isometric-action',
  world_direction: 'emberglass-foundry',
  role: 'prop-effect.atlas',
  status: 'source-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  rasters: [
    {
      stage: 'generation-original',
      path: GENERATION_PATH,
      media_type: 'image/png',
      width: generation.width,
      height: generation.height,
      bytes: generationBytes.length,
      sha256: sha256(generationBytes),
    },
    {
      stage: 'strict-chroma-source',
      path: SOURCE_PATH,
      media_type: 'image/png',
      width: SOURCE_GRID.width,
      height: SOURCE_GRID.height,
      bytes: strictSourceBytes.length,
      sha256: sha256(strictSourceBytes),
    },
    {
      stage: 'rgba-candidate',
      path: RGBA_PATH,
      media_type: 'image/png',
      width: SOURCE_GRID.width,
      height: SOURCE_GRID.height,
      bytes: strictRgbaBytes.length,
      sha256: sha256(strictRgbaBytes),
    },
  ],
  generation_context: {
    reference_image:
      'docs/visual-qa/production-art/isometric-action-direction-v1.png',
    provider_mode: 'built-in-image-generation',
    originality_scope: 'original Emberglass Foundry props and effects',
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
    maximum_visible_extent: SOURCE_GRID.maximumVisibleExtent,
    inset: SOURCE_GRID.inset,
  },
  grid: {
    columns: SOURCE_GRID.columns,
    rows: SOURCE_GRID.rows,
    cell_width: SOURCE_GRID.cell,
    cell_height: SOURCE_GRID.cell,
    ordered_roles: [...ORDERED_ROLES],
    mapped_cells: strictCells,
    reserved_cells: [
      { column: 2, row: 3 },
      { column: 3, row: 3 },
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

const atlasRgba = new Uint8Array(ATLAS.width * ATLAS.height * 4);
const strictCrops = strictCells.map((cell) => {
  const bounds = {
    x: cell.column * SOURCE_GRID.cell + cell.strict_visible_bounds.x,
    y: cell.row * SOURCE_GRID.cell + cell.strict_visible_bounds.y,
    width: cell.strict_visible_bounds.width,
    height: cell.strict_visible_bounds.height,
  };
  return crop(
    { width: SOURCE_GRID.width, height: SOURCE_GRID.height, rgba: strictRgba },
    bounds,
  );
});
const strictLargestDimension = Math.max(
  ...strictCrops.flatMap((image) => [image.width, image.height]),
);
const atlasScale = ATLAS.maximumVisibleExtent / strictLargestDimension;
const roleMappings = strictCells.map((cell, index) => {
  const column = index % ATLAS.columns;
  const row = Math.floor(index / ATLAS.columns);
  const sourceCrop = strictCrops[index];
  const scaled = resizeNearest(
    sourceCrop,
    Math.max(1, Math.round(sourceCrop.width * atlasScale)),
    Math.max(1, Math.round(sourceCrop.height * atlasScale)),
  );
  const normalized = crop(scaled, visibleBounds(scaled));
  const normalizationBox = blitBottomCentered({
    targetRgba: atlasRgba,
    targetWidth: ATLAS.width,
    cell: ATLAS.cell,
    image: normalized,
    column,
    row,
    inset: 0,
    transparentBackground: true,
  });
  const metrics = cellMetrics(
    { width: ATLAS.width, height: ATLAS.height, rgba: atlasRgba },
    column,
    row,
    ATLAS.cell,
  );
  if (
    !metrics.bounds
    || metrics.visible_pixels < 32
    || metrics.bounds.x < 0
    || metrics.bounds.y < 0
    || metrics.bounds.x + metrics.bounds.width > ATLAS.cell
    || metrics.bounds.y + metrics.bounds.height > ATLAS.cell
  ) {
    throw new Error(`Runtime atlas role ${cell.role} is empty or out of bounds.`);
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
const mappedAtlasCells = new Set(
  roleMappings.map(({ atlas_cell: cell }) => `${cell.column},${cell.row}`),
);
for (let row = 0; row < ATLAS.rows; row += 1) {
  for (let column = 0; column < ATLAS.columns; column += 1) {
    const metrics = cellMetrics(
      { width: ATLAS.width, height: ATLAS.height, rgba: atlasRgba },
      column,
      row,
      ATLAS.cell,
    );
    if (mappedAtlasCells.has(`${column},${row}`)) {
      if (!metrics.bounds || metrics.visible_pixels < 32) {
        throw new Error(`Mapped runtime cell ${column},${row} is empty.`);
      }
    } else if (metrics.visible_pixels !== 0) {
      throw new Error(`Unmapped runtime cell ${column},${row} is not transparent.`);
    }
  }
}
const atlasBytes = encodeRgbaPng(ATLAS.width, ATLAS.height, atlasRgba);
const outputManifest = {
  schema_version: 'mapsoo-runtime-prop-atlas/1.0',
  id: 'isometric-action-prop-atlas-v1',
  profile: 'isometric-action',
  world_direction: 'emberglass-foundry',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  path: OUTPUT_PATH,
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
    maximum_visible_extent: ATLAS.maximumVisibleExtent,
  },
  source_manifest: SOURCE_MANIFEST_PATH,
  source_manifest_sha256: sha256(sourceManifestBytes),
  required_roles: [...ORDERED_ROLES],
  role_mappings: roleMappings,
  sanitation: {
    mapped_cells: roleMappings.length,
    unmapped_cells: ATLAS.columns * ATLAS.rows - roleMappings.length,
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

await writeIdenticalOrNew(SOURCE_PATH, strictSourceBytes);
await writeIdenticalOrNew(RGBA_PATH, strictRgbaBytes);
await writeIdenticalOrNew(SOURCE_MANIFEST_PATH, sourceManifestBytes);
await writeIdenticalOrNew(OUTPUT_PATH, atlasBytes);
await writeIdenticalOrNew(
  OUTPUT_MANIFEST_PATH,
  Buffer.from(`${JSON.stringify(outputManifest, null, 2)}\n`),
);
console.log(
  `MAPSOO_ISOMETRIC_PROP_OK roles=${roleMappings.length} grid=8x8 cell=96 `
  + `sha256=${outputManifest.sha256}`,
);
