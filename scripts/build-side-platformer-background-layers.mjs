import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng, encodeRgbaPng, resizeNearest } from './lib/rgba-png.mjs';

const sourceManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-background-layers-v1.json',
);
const outputManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-background-runtime-v1.json',
);
const TARGET = Object.freeze({ width: 1920, height: 1080 });
const ROLES = Object.freeze([
  'background.sky',
  'background.far',
  'background.mid',
  'background.near',
  'foreground.overlay',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function slug(role) {
  return role.replaceAll('.', '-');
}

function reconcileHorizontalSeam(image, band = 8) {
  for (let y = 0; y < image.height; y += 1) {
    for (let inset = 0; inset < band; inset += 1) {
      const left = (y * image.width + inset) * 4;
      const right = (y * image.width + image.width - 1 - inset) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const average = Math.round((image.rgba[left + channel] + image.rgba[right + channel]) / 2);
        image.rgba[left + channel] = average;
        image.rgba[right + channel] = average;
      }
    }
  }
}

function layerMetrics(image) {
  let visible = 0;
  let chromaEdgePixels = 0;
  let seamMismatches = 0;
  for (let y = 0; y < image.height; y += 1) {
    const left = y * image.width * 4;
    const right = (y * image.width + image.width - 1) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      if (image.rgba[left + channel] !== image.rgba[right + channel]) seamMismatches += 1;
    }
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const red = image.rgba[offset];
      const green = image.rgba[offset + 1];
      const blue = image.rgba[offset + 2];
      const alpha = image.rgba[offset + 3];
      if (alpha >= 16) visible += 1;
      if (alpha < 250 && alpha >= 16 && green > 170 && red < 100 && blue < 100 && green - red > 90) {
        chromaEdgePixels += 1;
      }
    }
  }
  return {
    visible_fraction: Number((visible / (image.width * image.height)).toFixed(6)),
    chroma_edge_pixels: chromaEdgePixels,
    horizontal_seam_mismatches: seamMismatches,
  };
}

async function writeIdenticalOrNew(path, bytes) {
  try {
    const existing = await readFile(path);
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error(`Refusing to overwrite non-identical generated output: ${path}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
if (
  sourceManifest.schema_version !== 'mapsoo-production-art-source/1.0'
  || sourceManifest.id !== 'side-platformer-background-layers-v1'
  || sourceManifest.status !== 'source-candidate'
  || sourceManifest.distribution !== 'internal-review'
  || sourceManifest.output_license !== 'UNRELEASED'
  || JSON.stringify(sourceManifest.rasters.map((record) => record.role)) !== JSON.stringify(ROLES)
) {
  throw new Error('Background source manifest is not the canonical internal-review layer set.');
}

const outputs = [];
for (const sourceRecord of sourceManifest.rasters) {
  const sourceBytes = await readFile(resolve(sourceRecord.path));
  if (sourceBytes.length !== sourceRecord.bytes || sha256(sourceBytes) !== sourceRecord.sha256) {
    throw new Error(`Background source bytes do not match their review record: ${sourceRecord.role}.`);
  }
  const source = decodeRgbaPng(sourceBytes);
  if (source.width !== sourceRecord.width || source.height !== sourceRecord.height) {
    throw new Error(`Background source dimensions do not match their review record: ${sourceRecord.role}.`);
  }
  const normalized = resizeNearest(source, TARGET.width, TARGET.height);
  reconcileHorizontalSeam(normalized);
  const metrics = layerMetrics(normalized);
  const isSky = sourceRecord.role === 'background.sky';
  if (isSky && metrics.visible_fraction !== 1) {
    throw new Error('Background sky must remain fully opaque.');
  }
  if (!isSky && (metrics.visible_fraction < 0.02 || metrics.visible_fraction > 0.75)) {
    throw new Error(`${sourceRecord.role} alpha coverage is outside the parallax layer budget.`);
  }
  if (metrics.chroma_edge_pixels !== 0 || metrics.horizontal_seam_mismatches !== 0) {
    throw new Error(`${sourceRecord.role} failed chroma/seam normalization.`);
  }
  const outputBytes = encodeRgbaPng(TARGET.width, TARGET.height, normalized.rgba);
  const relativePath = `docs/visual-qa/production-art/side-platformer-${slug(sourceRecord.role)}-v1.png`;
  await writeIdenticalOrNew(resolve(relativePath), outputBytes);
  outputs.push({
    role: sourceRecord.role,
    path: relativePath,
    media_type: 'image/png',
    width: TARGET.width,
    height: TARGET.height,
    bytes: outputBytes.length,
    sha256: sha256(outputBytes),
    alpha_policy: isSky ? 'opaque' : 'straight-alpha',
    seam_policy: 'horizontal-parallax',
    source_sha256: sourceRecord.sha256,
    ...metrics,
  });
}

const outputManifest = {
  schema_version: 'mapsoo-runtime-background-layers/1.0',
  id: 'side-platformer-background-runtime-v1',
  profile: 'side-platformer',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  source_manifest: 'docs/visual-qa/production-art/side-platformer-background-layers-v1.json',
  layers: outputs,
  automated_checks: {
    exact_role_order: 'pass',
    exact_target_dimensions: 'pass',
    alpha_policy: 'pass',
    horizontal_seam: 'pass',
    chroma_edge_pixels: 0,
    deterministic_png: 'pass',
    depth_order: 'manual-review',
    gameplay_contrast: 'manual-review',
    godot_runtime: 'pending',
  },
  not_accepted_for: [
    'complete world asset pack',
    'public asset-pack release',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');
await writeIdenticalOrNew(outputManifestPath, manifestBytes);
console.log(
  `MAPSOO_BACKGROUND_LAYERS_OK side-platformer:1920x1080:layers=${outputs.length}:sha256=${sha256(manifestBytes)}`,
);
