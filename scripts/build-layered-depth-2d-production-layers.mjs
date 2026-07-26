import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  decodeRgbaPng,
  encodeRgbaPng,
  resizeNearest,
} from './lib/rgba-png.mjs';

const MANIFEST_PATH =
  'docs/visual-qa/production-art/layered-depth-2d-production-layers-v1.json';
const DIRECTION_PATH =
  'docs/visual-qa/production-art/layered-depth-2d-direction-v1.png';
const TARGET = Object.freeze({ width: 1280, height: 720 });
const CHARACTER_ROUTE = Object.freeze({
  x: 544,
  y: 360,
  width: 192,
  height: 288,
});
const REPLACE_GENERATED = process.argv.includes('--replace-generated');
const LAYERS = Object.freeze([
  Object.freeze({
    role: 'background.sky',
    slug: 'background-sky',
    sourceSha256: '458203efb5c0c0a69a20f4747ab6226dbeb97826f334d0ba11d4bdf35be20ed3',
    sourceBytes: 1_582_440,
    sourceMode: 'opaque',
    alphaContract: 'opaque',
    blendMode: 'mix',
    zOrder: 0,
    parallaxFactor: 0.05,
    repeatStrategy: 'clamp-no-repeat',
    occludesRoute: false,
    promptSummary:
      'Independent original empty mauve-indigo blue-hour sky with sparse pixel-painted clouds and restrained peach horizon glow.',
  }),
  Object.freeze({
    role: 'background.far',
    slug: 'background-far',
    sourceSha256: '7cb71d187d35240aaa5ea28c2a4dd057eba62fff54221ef0ce0dc02d84816132',
    sourceBytes: 1_325_932,
    sourceMode: 'chroma',
    alphaContract: 'straight-alpha',
    blendMode: 'mix',
    zOrder: 10,
    parallaxFactor: 0.18,
    repeatStrategy: 'clamp-no-repeat',
    occludesRoute: false,
    promptSummary:
      'Independent original distant Lanternmere canal-town skyline with slate roofs, towers, trees and sparse warm windows on flat magenta chroma.',
  }),
  Object.freeze({
    role: 'background.mid',
    slug: 'background-mid',
    sourceSha256: '7780cd76276bcf5ad656322f6149e490b879271320272bea580fbbc5ec73b473',
    sourceBytes: 1_611_627,
    sourceMode: 'chroma',
    alphaContract: 'straight-alpha',
    blendMode: 'mix',
    zOrder: 20,
    parallaxFactor: 0.38,
    repeatStrategy: 'clamp-no-repeat',
    occludesRoute: false,
    promptSummary:
      'Independent original middle-distance canal bridge, masonry wall, market roofs, posts and lanterns on flat magenta chroma.',
  }),
  Object.freeze({
    role: 'background.depth-fog',
    slug: 'background-depth-fog',
    sourceSha256: '3a0946984721bea602245cfa38403a36a41e82493faff77e51b9ead6cdedeb03',
    sourceBytes: 895_254,
    sourceMode: 'black-intensity',
    alphaContract: 'straight-alpha',
    blendMode: 'mix',
    zOrder: 30,
    parallaxFactor: 0.5,
    repeatStrategy: 'clamp-no-repeat',
    occludesRoute: false,
    promptSummary:
      'Independent original separated lavender-blue canal-mist banks on pure black for deterministic intensity-to-alpha conversion.',
  }),
  Object.freeze({
    role: 'near.overlay',
    slug: 'near-overlay',
    sourceSha256: 'b8a84fe654648577a638e0c26338b74d5d0c2e06dac48add31beac107681bb72',
    sourceBytes: 1_434_401,
    sourceMode: 'chroma',
    alphaContract: 'straight-alpha',
    blendMode: 'mix',
    zOrder: 70,
    parallaxFactor: 1.08,
    repeatStrategy: 'clamp-no-repeat',
    occludesRoute: true,
    promptSummary:
      'Independent original near-plane mossy parapet fragments, reeds, mooring posts, rails and purple flowers on flat magenta chroma with a clear central route.',
  }),
  Object.freeze({
    role: 'foreground.overlay',
    slug: 'foreground-overlay',
    sourceSha256: 'ccd55575487af1e978b565c7da8ce7aa03108abb667424103dba5c01074caa42',
    sourceBytes: 1_435_607,
    sourceMode: 'chroma',
    alphaContract: 'straight-alpha',
    blendMode: 'mix',
    zOrder: 80,
    parallaxFactor: 1.22,
    repeatStrategy: 'clamp-no-repeat',
    occludesRoute: true,
    promptSummary:
      'Independent original dark foreground reeds, vines, flowers and cropped stone posts on flat magenta chroma with an empty central route.',
  }),
  Object.freeze({
    role: 'lighting.ambient',
    slug: 'lighting-ambient',
    sourceSha256: '7a5aec201ee43418655a0112720988236178d87b839897b7223d3821047310c6',
    sourceBytes: 1_311_202,
    sourceMode: 'opaque',
    alphaContract: 'opaque',
    blendMode: 'multiply',
    zOrder: 90,
    parallaxFactor: 0,
    repeatStrategy: 'clamp-no-repeat',
    occludesRoute: false,
    promptSummary:
      'Independent original non-representational indigo, violet and teal full-frame ambient color-grade texture.',
  }),
  Object.freeze({
    role: 'lighting.local',
    slug: 'lighting-local',
    sourceSha256: '404a48bc68f49090fd42e7a61c721784c8574ea49b3c8167c81d2b8ab6c8783a',
    sourceBytes: 556_426,
    sourceMode: 'black-intensity',
    alphaContract: 'straight-alpha',
    blendMode: 'add',
    zOrder: 100,
    parallaxFactor: 0,
    repeatStrategy: 'clamp-no-repeat',
    occludesRoute: false,
    promptSummary:
      'Independent original five amber light pools and one restrained teal glow on pure black for deterministic intensity-to-alpha conversion.',
  }),
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function pathsFor(layer) {
  return {
    source:
      `docs/visual-qa/production-art/layered-depth-2d-${layer.slug}-source-v1.png`,
    runtime:
      `docs/visual-qa/production-art/layered-depth-2d-${layer.slug}-runtime-v1.png`,
  };
}

function sampleTopKey(image, rows = 8) {
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = 0; y < Math.min(rows, image.height); y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      sum[0] += image.rgba[offset];
      sum[1] += image.rgba[offset + 1];
      sum[2] += image.rgba[offset + 2];
      count += 1;
    }
  }
  return sum.map((value) => value / count);
}

function sampleBorderMedianKey(image) {
  const samples = [[], [], []];
  const band = Math.max(1, Math.min(image.width, image.height, 6));
  const step = Math.max(1, Math.floor(Math.min(image.width, image.height) / 256));
  function sample(x, y) {
    const offset = (y * image.width + x) * 4;
    samples[0].push(image.rgba[offset]);
    samples[1].push(image.rgba[offset + 1]);
    samples[2].push(image.rgba[offset + 2]);
  }
  for (let x = 0; x < image.width; x += step) {
    for (let y = 0; y < band; y += 1) {
      sample(x, y);
      sample(x, image.height - 1 - y);
    }
  }
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < band; x += 1) {
      sample(x, y);
      sample(image.width - 1 - x, y);
    }
  }
  return samples.map((values) => {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2
      ? values[middle]
      : Math.round((values[middle - 1] + values[middle]) / 2);
  });
}

function spillChannels(key) {
  const keyMaximum = Math.max(...key);
  if (keyMaximum < 128) return [];
  return key
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => value >= keyMaximum - 16 && value >= 128)
    .map(({ index }) => index);
}

function dominanceAlpha(rgb, key) {
  const spill = spillChannels(key);
  if (spill.length === 0) return 255;
  const nonSpill = [0, 1, 2].filter((index) => !spill.includes(index));
  const keyStrength = spill.length > 1
    ? Math.min(...spill.map((index) => rgb[index]))
    : rgb[spill[0]];
  const nonKeyStrength = nonSpill.length
    ? Math.max(...nonSpill.map((index) => rgb[index]))
    : 0;
  const dominance = keyStrength - nonKeyStrength;
  if (dominance <= 0) return 255;
  const denominator = Math.max(1, Math.max(...key) - nonKeyStrength);
  return clampByte((1 - Math.min(1, dominance / denominator)) * 255);
}

function keyChannelDominance(rgb, key) {
  const spill = spillChannels(key);
  if (spill.length === 0) return 0;
  const nonSpill = [0, 1, 2].filter((index) => !spill.includes(index));
  const keyStrength = spill.length > 1
    ? Math.min(...spill.map((index) => rgb[index]))
    : rgb[spill[0]];
  const nonKeyStrength = nonSpill.length
    ? Math.max(...nonSpill.map((index) => rgb[index]))
    : 0;
  return keyStrength - nonKeyStrength;
}

function cleanupSpill(rgb, key, alpha) {
  if (alpha >= 252) return rgb;
  const spill = spillChannels(key);
  const nonSpill = [0, 1, 2].filter((index) => !spill.includes(index));
  if (spill.length === 0 || nonSpill.length === 0) return rgb;
  const result = [...rgb];
  const cap = Math.max(0, Math.max(...nonSpill.map((index) => rgb[index])) - 1);
  for (const index of spill) result[index] = Math.min(result[index], cap);
  return result;
}

function contractAlphaOnePixel(image) {
  const rgba = new Uint8Array(image.rgba);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let alpha = 255;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = Math.max(0, Math.min(image.width - 1, x + offsetX));
          const sampleY = Math.max(0, Math.min(image.height - 1, y + offsetY));
          alpha = Math.min(
            alpha,
            image.rgba[(sampleY * image.width + sampleX) * 4 + 3],
          );
        }
      }
      const outputOffset = (y * image.width + x) * 4;
      rgba[outputOffset + 3] = alpha;
      if (alpha === 0) {
        rgba[outputOffset] = 0;
        rgba[outputOffset + 1] = 0;
        rgba[outputOffset + 2] = 0;
      }
    }
  }
  return { width: image.width, height: image.height, rgba };
}

function matteChroma(image, key) {
  const TRANSPARENT_DISTANCE = 12;
  const OPAQUE_DISTANCE = 220;
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let index = 0; index < image.width * image.height; index += 1) {
    const offset = index * 4;
    const red = image.rgba[offset];
    const green = image.rgba[offset + 1];
    const blue = image.rgba[offset + 2];
    const rgb = [red, green, blue];
    const distance = Math.max(
      Math.abs(red - key[0]),
      Math.abs(green - key[1]),
      Math.abs(blue - key[2]),
    );
    const keyLike = distance <= 32 || keyChannelDominance(rgb, key) >= 16;
    let softAlpha;
    if (distance <= TRANSPARENT_DISTANCE) softAlpha = 0;
    else if (distance >= OPAQUE_DISTANCE) softAlpha = 255;
    else {
      const ratio =
        (distance - TRANSPARENT_DISTANCE) / (OPAQUE_DISTANCE - TRANSPARENT_DISTANCE);
      const smooth = ratio * ratio * (3 - 2 * ratio);
      softAlpha = clampByte(smooth * 255);
    }
    const alpha = keyLike ? Math.min(softAlpha, dominanceAlpha(rgb, key)) : 255;
    if (alpha <= 8) continue;
    const cleaned = keyLike && distance <= 128 ? cleanupSpill(rgb, key, alpha) : rgb;
    rgba[offset] = cleaned[0];
    rgba[offset + 1] = cleaned[1];
    rgba[offset + 2] = cleaned[2];
    rgba[offset + 3] = alpha;
  }
  return contractAlphaOnePixel({ width: image.width, height: image.height, rgba });
}

function blackIntensityToStraightAlpha(image) {
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let index = 0; index < image.width * image.height; index += 1) {
    const offset = index * 4;
    const red = image.rgba[offset];
    const green = image.rgba[offset + 1];
    const blue = image.rgba[offset + 2];
    const alpha = Math.max(red, green, blue);
    if (alpha <= 4) continue;
    const normalizedAlpha = alpha / 255;
    rgba[offset] = clampByte(red / normalizedAlpha);
    rgba[offset + 1] = clampByte(green / normalizedAlpha);
    rgba[offset + 2] = clampByte(blue / normalizedAlpha);
    rgba[offset + 3] = alpha;
  }
  return { width: image.width, height: image.height, rgba };
}

function forceOpaque(image) {
  const rgba = new Uint8Array(image.rgba);
  for (let offset = 3; offset < rgba.length; offset += 4) rgba[offset] = 255;
  return { width: image.width, height: image.height, rgba };
}

function alphaMetrics(image) {
  let visiblePixels = 0;
  let partialPixels = 0;
  let opaquePixels = 0;
  let hiddenRgbPixels = 0;
  let chromaSpillPixels = 0;
  let alphaSum = 0;
  for (let offset = 0; offset < image.rgba.length; offset += 4) {
    const alpha = image.rgba[offset + 3];
    alphaSum += alpha;
    if (alpha === 0) {
      if (image.rgba[offset] || image.rgba[offset + 1] || image.rgba[offset + 2]) {
        hiddenRgbPixels += 1;
      }
      continue;
    }
    visiblePixels += 1;
    if (alpha === 255) opaquePixels += 1;
    else partialPixels += 1;
    if (
      alpha >= 192
      && image.rgba[offset] > 230
      && image.rgba[offset + 2] > 230
      && image.rgba[offset + 1] < 70
    ) chromaSpillPixels += 1;
  }
  const totalPixels = image.width * image.height;
  return {
    visible_pixels: visiblePixels,
    visible_fraction: Number((visiblePixels / totalPixels).toFixed(6)),
    partial_alpha_pixels: partialPixels,
    opaque_pixels: opaquePixels,
    mean_alpha: Number((alphaSum / totalPixels).toFixed(3)),
    hidden_rgb_pixels: hiddenRgbPixels,
    chroma_spill_pixels: chromaSpillPixels,
  };
}

function horizontalEdgeMetrics(image, edgeWidth = 4) {
  const left = { visible: 0, alpha: 0, rgb: [0, 0, 0] };
  const right = { visible: 0, alpha: 0, rgb: [0, 0, 0] };
  for (let y = 0; y < image.height; y += 1) {
    for (let edgeX = 0; edgeX < edgeWidth; edgeX += 1) {
      for (const [side, x] of [
        [left, edgeX],
        [right, image.width - edgeWidth + edgeX],
      ]) {
        const offset = (y * image.width + x) * 4;
        const alpha = image.rgba[offset + 3];
        side.alpha += alpha;
        if (alpha >= 16) side.visible += 1;
        side.rgb[0] += image.rgba[offset];
        side.rgb[1] += image.rgba[offset + 1];
        side.rgb[2] += image.rgba[offset + 2];
      }
    }
  }
  const pixels = image.height * edgeWidth;
  function finalize(side) {
    return {
      visible_fraction: Number((side.visible / pixels).toFixed(6)),
      mean_alpha: Number((side.alpha / pixels).toFixed(3)),
      mean_rgb: side.rgb.map((value) => Number((value / pixels).toFixed(3))),
    };
  }
  return {
    sample_width: edgeWidth,
    left: finalize(left),
    right: finalize(right),
  };
}

function routeMetrics(image) {
  let visiblePixels = 0;
  let opaquePixels = 0;
  let alphaSum = 0;
  for (let y = CHARACTER_ROUTE.y; y < CHARACTER_ROUTE.y + CHARACTER_ROUTE.height; y += 1) {
    for (let x = CHARACTER_ROUTE.x; x < CHARACTER_ROUTE.x + CHARACTER_ROUTE.width; x += 1) {
      const alpha = image.rgba[(y * image.width + x) * 4 + 3];
      alphaSum += alpha;
      if (alpha >= 16) visiblePixels += 1;
      if (alpha >= 128) opaquePixels += 1;
    }
  }
  const pixels = CHARACTER_ROUTE.width * CHARACTER_ROUTE.height;
  return {
    route: CHARACTER_ROUTE,
    visible_pixels: visiblePixels,
    visible_fraction: Number((visiblePixels / pixels).toFixed(6)),
    opaque_pixels: opaquePixels,
    opaque_fraction: Number((opaquePixels / pixels).toFixed(6)),
    mean_alpha: Number((alphaSum / pixels).toFixed(3)),
  };
}

async function writeIdenticalOrNew(path, bytes) {
  try {
    const existing = await readFile(resolve(path));
    if (!existing.equals(Buffer.from(bytes))) {
      if (REPLACE_GENERATED) {
        await writeFile(resolve(path), bytes);
        return;
      }
      throw new Error(`Refusing to overwrite non-identical generated output: ${path}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(resolve(path), bytes, { flag: 'wx' });
  }
}

const directionBytes = await readFile(resolve(DIRECTION_PATH));
const outputRecords = [];
for (const layer of LAYERS) {
  const paths = pathsFor(layer);
  const sourceBytes = await readFile(resolve(paths.source));
  const source = decodeRgbaPng(sourceBytes);
  if (
    source.width !== 1672
    || source.height !== 941
    || sourceBytes.length !== layer.sourceBytes
    || sha256(sourceBytes) !== layer.sourceSha256
  ) {
    throw new Error(`${layer.role} source does not match its retained generated original.`);
  }
  let normalizedSource;
  let conversion;
  if (layer.sourceMode === 'chroma') {
    const key = sampleBorderMedianKey(source);
    if (key[0] < 240 || key[1] > 20 || key[2] < 240) {
      throw new Error(`${layer.role} does not have the required flat magenta top border.`);
    }
    normalizedSource = matteChroma(source, key);
    conversion = {
      method: 'border-median-chroma-soft-matte-plus-key-dominance',
      sampled_key_rgb: key.map((value) => Number(value.toFixed(3))),
      transparent_distance: 12,
      opaque_distance: 220,
      spill_cleanup: 'key-channel-cap',
      spill_cleanup_max_key_distance: 128,
      edge_contract_pixels: 1,
    };
  } else if (layer.sourceMode === 'black-intensity') {
    const key = sampleTopKey(source);
    if (key.some((value) => value > 12)) {
      throw new Error(`${layer.role} does not have the required pure-black intensity border.`);
    }
    normalizedSource = blackIntensityToStraightAlpha(source);
    conversion = {
      method: 'max-rgb-intensity-to-straight-alpha',
      transparent_max_rgb_threshold: 4,
      sampled_black_rgb: key.map((value) => Number(value.toFixed(3))),
    };
  } else {
    normalizedSource = forceOpaque(source);
    conversion = { method: 'force-opaque' };
  }
  const runtime = resizeNearest(normalizedSource, TARGET.width, TARGET.height);
  const metrics = alphaMetrics(runtime);
  const route = routeMetrics(runtime);
  const horizontalEdges = horizontalEdgeMetrics(runtime);
  if (metrics.hidden_rgb_pixels !== 0 || metrics.chroma_spill_pixels !== 0) {
    throw new Error(`${layer.role} fails hidden-RGB or chroma sanitation.`);
  }
  if (layer.alphaContract === 'opaque') {
    if (metrics.opaque_pixels !== TARGET.width * TARGET.height) {
      throw new Error(`${layer.role} must be fully opaque.`);
    }
  } else if (
    metrics.visible_fraction <= 0.002
    || metrics.visible_fraction >= 0.72
    || metrics.partial_alpha_pixels <= 0
  ) {
    throw new Error(`${layer.role} has implausible straight-alpha coverage.`);
  }
  if (
    layer.occludesRoute
    && (route.opaque_fraction > 0.01 || route.mean_alpha > 3)
  ) {
    throw new Error(
      `${layer.role} blocks the central character route: ${JSON.stringify(route)}.`,
    );
  }
  const runtimeBytes = encodeRgbaPng(runtime.width, runtime.height, runtime.rgba);
  await writeIdenticalOrNew(paths.runtime, runtimeBytes);
  outputRecords.push({
    role: layer.role,
    z_order: layer.zOrder,
    parallax_factor: layer.parallaxFactor,
    blend_mode: layer.blendMode,
    alpha_contract: layer.alphaContract,
    repeat_strategy: layer.repeatStrategy,
    horizontal_edge_policy:
      'No seamless-repeat claim; clamp at authored 1280px viewport boundary.',
    character_route_relation: layer.occludesRoute
      ? 'front-of-character; strict central-route occlusion gate applies'
      : 'does-not-occlude-character-route-by-render-order-or-lighting-contract',
    source: {
      path: paths.source,
      media_type: 'image/png',
      width: source.width,
      height: source.height,
      bytes: sourceBytes.length,
      sha256: sha256(sourceBytes),
      creation_mode: 'independent-built-in-image-generation',
      retained_default_original: true,
      prompt_summary: layer.promptSummary,
      direction_reference_scope:
        'project-owned palette, pixel-painting finish, dusk lighting and Lanternmere material language only',
      derivation_statement:
        'This role was generated independently; it was not automatically extracted from the flattened direction image.',
    },
    normalization: {
      target_width: TARGET.width,
      target_height: TARGET.height,
      resize: 'nearest-neighbour-full-frame',
      conversion,
    },
    runtime: {
      path: paths.runtime,
      media_type: 'image/png',
      width: runtime.width,
      height: runtime.height,
      bytes: runtimeBytes.length,
      sha256: sha256(runtimeBytes),
    },
    alpha_metrics: metrics,
    horizontal_edge_metrics: horizontalEdges,
    character_route_metrics: route,
    automated_checks: {
      source_hash_binding: 'pass',
      target_dimensions: 'pass',
      alpha_contract: 'pass',
      hidden_rgb: 'pass',
      chroma_spill: 'pass',
      horizontal_edge_strategy_recorded: 'pass',
      character_route_occlusion: layer.occludesRoute ? 'pass' : 'not-applicable',
    },
  });
}

const manifest = {
  schema_version: 'mapsoo-layered-depth-production-layers/1.0',
  id: 'layered-depth-2d-production-layers-v1',
  profile: 'layered-depth-2d',
  world: 'Lanternmere Crossing',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  target: TARGET,
  direction_reference: {
    path: DIRECTION_PATH,
    bytes: directionBytes.length,
    sha256: sha256(directionBytes),
    role: 'project-owned visual direction only; not an automatic layer-extraction source',
  },
  generation: {
    provider_mode: 'built-in-image-generation',
    source_count: outputRecords.length,
    independent_source_per_role: true,
    flattened_direction_auto_separation: false,
    default_originals_retained: true,
  },
  required_roles: LAYERS.map(({ role }) => role),
  character_route: {
    ...CHARACTER_ROUTE,
    purpose:
      'Conservative runtime character readability corridor used for front-plane alpha occlusion gates.',
    gated_roles: LAYERS.filter(({ occludesRoute }) => occludesRoute).map(({ role }) => role),
    maximum_opaque_fraction: 0.01,
    maximum_mean_alpha: 3,
  },
  layers: outputRecords,
  automated_checks: {
    exact_role_set: 'pass',
    independent_source_records: 'pass',
    exact_runtime_dimensions: 'pass',
    deterministic_png: 'pass',
    straight_alpha_layers: 'pass',
    horizontal_edge_contracts: 'pass',
    character_route_occlusion: 'pass',
    human_art_review: 'pending',
    godot_runtime: 'pending',
    raspberry_pi_runtime: 'pending',
  },
  not_accepted_for: [
    'flattened-direction automatic layer extraction',
    'complete world asset pack',
    'Godot runtime approval',
    'Raspberry Pi approval',
    'public asset-pack release',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeIdenticalOrNew(MANIFEST_PATH, manifestBytes);

console.log(
  `MAPSOO_LAYERED_DEPTH_PRODUCTION_OK roles=${outputRecords.length} manifest=${sha256(manifestBytes)} runtimes=${outputRecords.map(({ runtime }) => runtime.sha256).join(',')}`,
);
