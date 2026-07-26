import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng, encodeRgbaPng, resizeNearest } from './lib/rgba-png.mjs';

const targetArgument = process.argv.find((argument) => argument.startsWith('--target='))?.slice('--target='.length) ?? '1280x720';
if (!['1280x720', '640x360'].includes(targetArgument)) {
  throw new Error('Runtime background target must be 1280x720 or 640x360.');
}
const [WIDTH, HEIGHT] = targetArgument.split('x').map(Number);
const sourceManifestPath = resolve(
  'docs/visual-qa/production-art/side-platformer-background-runtime-v1.json',
);
const outputManifestPath = resolve(
  `docs/visual-qa/production-art/side-platformer-background-runtime-${targetArgument}-v1.json`,
);
const roleNames = new Map([
  ['background.sky', 'sky'],
  ['background.far', 'far'],
  ['background.mid', 'mid'],
  ['background.near', 'near'],
  ['foreground.overlay', 'foreground-overlay'],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeIdenticalOrNew(path, bytes) {
  try {
    const existing = await readFile(path);
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error(`Refusing to overwrite non-identical runtime layer: ${path}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

const sourceManifestBytes = await readFile(sourceManifestPath);
const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8'));
if (
  sourceManifest.schema_version !== 'mapsoo-runtime-background-layers/1.0'
  || sourceManifest.status !== 'runtime-candidate'
  || sourceManifest.layers?.length !== 5
) {
  throw new Error('Source background manifest is not a five-layer runtime candidate.');
}

const layers = [];
for (const source of sourceManifest.layers) {
  const sourceBytes = await readFile(resolve(source.path));
  if (sha256(sourceBytes) !== source.sha256) {
    throw new Error(`Source background digest mismatch: ${source.path}`);
  }
  const decoded = decodeRgbaPng(sourceBytes);
  if (decoded.width !== source.width || decoded.height !== source.height) {
    throw new Error(`Source background dimensions mismatch: ${source.path}`);
  }
  const resized = resizeNearest(decoded, WIDTH, HEIGHT);
  const outputBytes = encodeRgbaPng(WIDTH, HEIGHT, resized.rgba);
  const shortName = roleNames.get(source.role);
  if (!shortName) throw new Error(`Unsupported background role: ${source.role}`);
  const path = `docs/visual-qa/production-art/side-platformer-background-${shortName}-runtime-${targetArgument}-v1.png`;
  await writeIdenticalOrNew(resolve(path), outputBytes);
  layers.push({
    role: source.role,
    path,
    media_type: 'image/png',
    width: WIDTH,
    height: HEIGHT,
    bytes: outputBytes.length,
    sha256: sha256(outputBytes),
    source_sha256: source.sha256,
    alpha_policy: source.alpha_policy,
    resize: 'nearest-neighbor-precomputed',
  });
}

const manifest = {
  schema_version: 'mapsoo-runtime-background-layers/1.1',
  id: `side-platformer-background-runtime-${targetArgument}-v1`,
  profile: 'side-platformer',
  status: 'runtime-candidate',
  distribution: 'internal-review',
  output_license: 'UNRELEASED',
  source_manifest: 'docs/visual-qa/production-art/side-platformer-background-runtime-v1.json',
  source_manifest_sha256: sha256(sourceManifestBytes),
  target: {
    width: WIDTH,
    height: HEIGHT,
    resize: 'nearest-neighbor-precomputed',
    purpose: 'bounded Godot and Raspberry Pi candidate',
  },
  layers,
  automated_checks: {
    exact_role_order: 'pass',
    exact_target_dimensions: 'pass',
    source_digest_binding: 'pass',
    deterministic_png: 'pass',
    godot_render: 'pending',
    human_art_review: 'pending',
  },
  not_accepted_for: [
    'public asset-pack release',
    'Raspberry Pi 4B performance claim',
  ],
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeIdenticalOrNew(outputManifestPath, manifestBytes);
console.log(
  `MAPSOO_RUNTIME_BACKGROUND_LAYERS_OK side-platformer:${WIDTH}x${HEIGHT}:layers=${layers.length}:manifest_sha256=${sha256(manifestBytes)}`,
);
