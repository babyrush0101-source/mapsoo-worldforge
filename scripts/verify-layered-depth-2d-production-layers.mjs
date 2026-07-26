import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng } from './lib/rgba-png.mjs';

const MANIFEST_PATH =
  'docs/visual-qa/production-art/layered-depth-2d-production-layers-v1.json';
const DIRECTION_PATH =
  'docs/visual-qa/production-art/layered-depth-2d-direction-v1.png';
const REQUIRED = Object.freeze([
  Object.freeze({
    role: 'background.sky',
    slug: 'background-sky',
    sourceSha256: '458203efb5c0c0a69a20f4747ab6226dbeb97826f334d0ba11d4bdf35be20ed3',
    sourceBytes: 1_582_440,
    alpha: 'opaque',
    blend: 'mix',
    repeat: 'clamp-no-repeat',
    z: 0,
    routeGate: false,
  }),
  Object.freeze({
    role: 'background.far',
    slug: 'background-far',
    sourceSha256: '7cb71d187d35240aaa5ea28c2a4dd057eba62fff54221ef0ce0dc02d84816132',
    sourceBytes: 1_325_932,
    alpha: 'straight-alpha',
    blend: 'mix',
    repeat: 'clamp-no-repeat',
    z: 10,
    routeGate: false,
  }),
  Object.freeze({
    role: 'background.mid',
    slug: 'background-mid',
    sourceSha256: '7780cd76276bcf5ad656322f6149e490b879271320272bea580fbbc5ec73b473',
    sourceBytes: 1_611_627,
    alpha: 'straight-alpha',
    blend: 'mix',
    repeat: 'clamp-no-repeat',
    z: 20,
    routeGate: false,
  }),
  Object.freeze({
    role: 'background.depth-fog',
    slug: 'background-depth-fog',
    sourceSha256: '3a0946984721bea602245cfa38403a36a41e82493faff77e51b9ead6cdedeb03',
    sourceBytes: 895_254,
    alpha: 'straight-alpha',
    blend: 'mix',
    repeat: 'clamp-no-repeat',
    z: 30,
    routeGate: false,
  }),
  Object.freeze({
    role: 'near.overlay',
    slug: 'near-overlay',
    sourceSha256: 'b8a84fe654648577a638e0c26338b74d5d0c2e06dac48add31beac107681bb72',
    sourceBytes: 1_434_401,
    alpha: 'straight-alpha',
    blend: 'mix',
    repeat: 'clamp-no-repeat',
    z: 70,
    routeGate: true,
  }),
  Object.freeze({
    role: 'foreground.overlay',
    slug: 'foreground-overlay',
    sourceSha256: 'ccd55575487af1e978b565c7da8ce7aa03108abb667424103dba5c01074caa42',
    sourceBytes: 1_435_607,
    alpha: 'straight-alpha',
    blend: 'mix',
    repeat: 'clamp-no-repeat',
    z: 80,
    routeGate: true,
  }),
  Object.freeze({
    role: 'lighting.ambient',
    slug: 'lighting-ambient',
    sourceSha256: '7a5aec201ee43418655a0112720988236178d87b839897b7223d3821047310c6',
    sourceBytes: 1_311_202,
    alpha: 'opaque',
    blend: 'multiply',
    repeat: 'clamp-no-repeat',
    z: 90,
    routeGate: false,
  }),
  Object.freeze({
    role: 'lighting.local',
    slug: 'lighting-local',
    sourceSha256: '404a48bc68f49090fd42e7a61c721784c8574ea49b3c8167c81d2b8ab6c8783a',
    sourceBytes: 556_426,
    alpha: 'straight-alpha',
    blend: 'add',
    repeat: 'clamp-no-repeat',
    z: 100,
    routeGate: false,
  }),
]);
const ROUTE = Object.freeze({ x: 544, y: 360, width: 192, height: 288 });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRelativePath(path) {
  return (
    typeof path === 'string'
    && !path.includes('\\')
    && !path.startsWith('/')
    && !/^[A-Za-z]:/.test(path)
    && path.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

async function boundPng(record, label) {
  assert(safeRelativePath(record.path), `${label} has an unsafe path.`);
  const bytes = await readFile(resolve(record.path));
  const image = decodeRgbaPng(bytes);
  assert(bytes.length === record.bytes, `${label} byte count is stale.`);
  assert(sha256(bytes) === record.sha256, `${label} SHA-256 is stale.`);
  assert(
    image.width === record.width && image.height === record.height,
    `${label} dimensions are stale.`,
  );
  return { bytes, image };
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
  const pixels = image.width * image.height;
  return {
    visible_pixels: visiblePixels,
    visible_fraction: Number((visiblePixels / pixels).toFixed(6)),
    partial_alpha_pixels: partialPixels,
    opaque_pixels: opaquePixels,
    mean_alpha: Number((alphaSum / pixels).toFixed(3)),
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
  for (let y = ROUTE.y; y < ROUTE.y + ROUTE.height; y += 1) {
    for (let x = ROUTE.x; x < ROUTE.x + ROUTE.width; x += 1) {
      const alpha = image.rgba[(y * image.width + x) * 4 + 3];
      alphaSum += alpha;
      if (alpha >= 16) visiblePixels += 1;
      if (alpha >= 128) opaquePixels += 1;
    }
  }
  const pixels = ROUTE.width * ROUTE.height;
  return {
    route: ROUTE,
    visible_pixels: visiblePixels,
    visible_fraction: Number((visiblePixels / pixels).toFixed(6)),
    opaque_pixels: opaquePixels,
    opaque_fraction: Number((opaquePixels / pixels).toFixed(6)),
    mean_alpha: Number((alphaSum / pixels).toFixed(3)),
  };
}

const manifestBytes = await readFile(resolve(MANIFEST_PATH));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assert(
  manifest.schema_version === 'mapsoo-layered-depth-production-layers/1.0'
    && manifest.id === 'layered-depth-2d-production-layers-v1'
    && manifest.profile === 'layered-depth-2d'
    && manifest.world === 'Lanternmere Crossing'
    && manifest.status === 'runtime-candidate'
    && manifest.distribution === 'internal-review'
    && manifest.output_license === 'UNRELEASED',
  'Layered-depth production manifest overstates its status or has an invalid identity.',
);
assert(
  manifest.target?.width === 1280
    && manifest.target?.height === 720
    && JSON.stringify(manifest.required_roles) === JSON.stringify(REQUIRED.map(({ role }) => role))
    && Array.isArray(manifest.layers)
    && manifest.layers.length === REQUIRED.length,
  'Layered-depth production manifest has an invalid target or role set.',
);
assert(
  manifest.generation?.provider_mode === 'built-in-image-generation'
    && manifest.generation?.source_count === 8
    && manifest.generation?.independent_source_per_role === true
    && manifest.generation?.flattened_direction_auto_separation === false
    && manifest.generation?.default_originals_retained === true,
  'Layered-depth generation provenance is incomplete or misleading.',
);
assert(
  safeRelativePath(manifest.direction_reference?.path)
    && manifest.direction_reference.path === DIRECTION_PATH
    && manifest.direction_reference.role
      === 'project-owned visual direction only; not an automatic layer-extraction source',
  'Layered-depth direction reference scope is invalid.',
);
const directionBytes = await readFile(resolve(DIRECTION_PATH));
assert(
  manifest.direction_reference.bytes === directionBytes.length
    && manifest.direction_reference.sha256 === sha256(directionBytes),
  'Layered-depth direction reference hash is stale.',
);
assert(
  JSON.stringify({
    x: manifest.character_route?.x,
    y: manifest.character_route?.y,
    width: manifest.character_route?.width,
    height: manifest.character_route?.height,
  }) === JSON.stringify(ROUTE)
    && manifest.character_route?.maximum_opaque_fraction === 0.01
    && manifest.character_route?.maximum_mean_alpha === 3
    && JSON.stringify(manifest.character_route?.gated_roles)
      === JSON.stringify(REQUIRED.filter(({ routeGate }) => routeGate).map(({ role }) => role)),
  'Layered-depth character route contract is stale.',
);

for (let index = 0; index < REQUIRED.length; index += 1) {
  const expected = REQUIRED[index];
  const layer = manifest.layers[index];
  assert(
    layer.role === expected.role
      && layer.z_order === expected.z
      && layer.alpha_contract === expected.alpha
      && layer.blend_mode === expected.blend
      && layer.repeat_strategy === expected.repeat
      && layer.horizontal_edge_policy
        === 'No seamless-repeat claim; clamp at authored 1280px viewport boundary.',
    `${expected.role} runtime contract is stale.`,
  );
  assert(
    layer.source?.path
      === `docs/visual-qa/production-art/layered-depth-2d-${expected.slug}-source-v1.png`
      && layer.source?.width === 1672
      && layer.source?.height === 941
      && layer.source?.bytes === expected.sourceBytes
      && layer.source?.sha256 === expected.sourceSha256
      && layer.source?.creation_mode === 'independent-built-in-image-generation'
      && layer.source?.retained_default_original === true
      && typeof layer.source?.prompt_summary === 'string'
      && layer.source.prompt_summary.length >= 80
      && layer.source?.derivation_statement
        === 'This role was generated independently; it was not automatically extracted from the flattened direction image.',
    `${expected.role} source record is incomplete or misleading.`,
  );
  await boundPng(layer.source, `${MANIFEST_PATH}:${expected.role}:source`);
  assert(
    layer.runtime?.path
      === `docs/visual-qa/production-art/layered-depth-2d-${expected.slug}-runtime-v1.png`
      && layer.runtime?.width === 1280
      && layer.runtime?.height === 720,
    `${expected.role} runtime path or dimensions are invalid.`,
  );
  const { image } = await boundPng(
    layer.runtime,
    `${MANIFEST_PATH}:${expected.role}:runtime`,
  );
  const alpha = alphaMetrics(image);
  const horizontal = horizontalEdgeMetrics(image);
  const route = routeMetrics(image);
  assert(
    JSON.stringify(layer.alpha_metrics) === JSON.stringify(alpha)
      && JSON.stringify(layer.horizontal_edge_metrics) === JSON.stringify(horizontal)
      && JSON.stringify(layer.character_route_metrics) === JSON.stringify(route),
    `${expected.role} recorded metrics are stale.`,
  );
  assert(
    alpha.hidden_rgb_pixels === 0
      && alpha.chroma_spill_pixels === 0,
    `${expected.role} retains hidden RGB or opaque chroma spill.`,
  );
  if (expected.alpha === 'opaque') {
    assert(
      alpha.opaque_pixels === 1280 * 720
        && alpha.visible_fraction === 1
        && alpha.partial_alpha_pixels === 0,
      `${expected.role} violates its opaque alpha contract.`,
    );
  } else {
    assert(
      alpha.visible_fraction > 0.002
        && alpha.visible_fraction < 0.72
        && alpha.partial_alpha_pixels > 0,
      `${expected.role} has implausible straight-alpha coverage.`,
    );
  }
  if (expected.routeGate) {
    assert(
      route.opaque_fraction <= 0.01 && route.mean_alpha <= 3,
      `${expected.role} blocks the central character route.`,
    );
  }
  assert(
    layer.automated_checks?.source_hash_binding === 'pass'
      && layer.automated_checks?.target_dimensions === 'pass'
      && layer.automated_checks?.alpha_contract === 'pass'
      && layer.automated_checks?.hidden_rgb === 'pass'
      && layer.automated_checks?.chroma_spill === 'pass'
      && layer.automated_checks?.horizontal_edge_strategy_recorded === 'pass'
      && layer.automated_checks?.character_route_occlusion
        === (expected.routeGate ? 'pass' : 'not-applicable'),
    `${expected.role} automated checks are incomplete or overstated.`,
  );
}

assert(
  manifest.automated_checks?.exact_role_set === 'pass'
    && manifest.automated_checks?.independent_source_records === 'pass'
    && manifest.automated_checks?.exact_runtime_dimensions === 'pass'
    && manifest.automated_checks?.deterministic_png === 'pass'
    && manifest.automated_checks?.straight_alpha_layers === 'pass'
    && manifest.automated_checks?.horizontal_edge_contracts === 'pass'
    && manifest.automated_checks?.character_route_occlusion === 'pass'
    && manifest.automated_checks?.human_art_review === 'pending'
    && manifest.automated_checks?.godot_runtime === 'pending'
    && manifest.automated_checks?.raspberry_pi_runtime === 'pending',
  'Layered-depth production gates are incomplete or overstated.',
);
assert(
  manifest.not_accepted_for?.includes('flattened-direction automatic layer extraction')
    && manifest.not_accepted_for?.includes('complete world asset pack')
    && manifest.not_accepted_for?.includes('Godot runtime approval')
    && manifest.not_accepted_for?.includes('Raspberry Pi approval')
    && manifest.not_accepted_for?.includes('public asset-pack release'),
  'Layered-depth production layers must remain unreleased runtime candidates.',
);

console.log(
  `MAPSOO_LAYERED_DEPTH_PRODUCTION_STRICT_OK roles=8 route=${ROUTE.width}x${ROUTE.height} manifest=${sha256(manifestBytes)}`,
);
