import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng } from './lib/rgba-png.mjs';

const ROOT = 'docs/visual-qa/production-art';
const BUILDER = resolve('scripts/build-layered-depth-2d-pack-atlases.mjs');
const MANIFEST = `${ROOT}/layered-depth-2d-pack-atlases-v1.json`;
const EXPECTED = Object.freeze({
  'background.sky': [320, 180],
  'background.far': [320, 180],
  'background.mid': [320, 180],
  'background.depth-fog': [320, 180],
  'near.overlay': [320, 180],
  'lighting.ambient': [320, 180],
  'lighting.local': [320, 180],
  'foreground.overlay': [320, 180],
  terrain: [256, 96],
  props: [320, 96],
  structures: [192, 112],
  collectibles: [64, 32],
  effects: [256, 64],
  player: [768, 72],
  npc: [384, 72],
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runBuilder() {
  const result = spawnSync(process.execPath, [BUILDER], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert(
    result.status === 0 && result.stdout.includes('MAPSOO_LAYERED_DEPTH_PACK_ATLASES_OK'),
    `Layered Pack projection builder failed.\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  );
}

function regionAlpha(image, region) {
  let visible = 0;
  let hiddenRgb = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.rgba[offset + 3];
      if (alpha >= 16) visible += 1;
      if (alpha === 0 && (image.rgba[offset] || image.rgba[offset + 1] || image.rgba[offset + 2])) {
        hiddenRgb += 1;
      }
    }
  }
  return { visible, hiddenRgb };
}

function regionRgbaSha256(image, region) {
  const bytes = Buffer.alloc(region.width * region.height * 4);
  for (let y = 0; y < region.height; y += 1) {
    const sourceStart = ((region.y + y) * image.width + region.x) * 4;
    Buffer.from(
      image.rgba.subarray(sourceStart, sourceStart + region.width * 4),
    ).copy(bytes, y * region.width * 4);
  }
  return sha256(bytes);
}

async function snapshot() {
  const manifestBytes = await readFile(resolve(MANIFEST));
  const manifest = JSON.parse(manifestBytes);
  const files = await Promise.all(
    manifest.outputs.map(async ({ path }) => ({ path, bytes: await readFile(resolve(path)) })),
  );
  return { manifestBytes, files };
}

runBuilder();
const first = await snapshot();
runBuilder();
const second = await snapshot();
assert(first.manifestBytes.equals(second.manifestBytes), 'Repeated build changed projection manifest.');
assert(first.files.length === second.files.length, 'Repeated build changed output inventory.');
for (let index = 0; index < first.files.length; index += 1) {
  assert(
    first.files[index].path === second.files[index].path
      && first.files[index].bytes.equals(second.files[index].bytes),
    `Repeated build changed ${first.files[index].path}.`,
  );
}

const manifest = JSON.parse(first.manifestBytes);
assert(
  manifest.schema_version === 'mapsoo-layered-depth-pack-atlas-projection/1.0'
    && manifest.id === 'layered-depth-2d-pack-atlases-v1'
    && manifest.profile === 'layered-depth-2d'
    && manifest.pack_schema === '0.9.0'
    && manifest.compatibility?.importer === 'mapsoo_importer@0.1.0-alpha.12',
  'Layered Pack projection identity is invalid.',
);
assert(
  manifest.status === 'runtime-candidate'
    && manifest.distribution === 'internal-review'
    && manifest.output_license === 'UNRELEASED',
  'Layered Pack projection must remain internal and unreleased.',
);

for (const source of [
  ['layers', manifest.source_bindings.layers_manifest, manifest.source_bindings.layers_manifest_sha256],
  ['prop', manifest.source_bindings.prop_manifest, manifest.source_bindings.prop_manifest_sha256],
  ...manifest.source_bindings.characters.map((entry) => [
    entry.id,
    entry.manifest,
    entry.manifest_sha256,
  ]),
]) {
  const bytes = await readFile(resolve(source[1]));
  assert(sha256(bytes) === source[2], `${source[0]} source manifest hash binding is stale.`);
}

const [layerManifestBytes, propManifestBytes] = await Promise.all([
  readFile(resolve(manifest.source_bindings.layers_manifest)),
  readFile(resolve(manifest.source_bindings.prop_manifest)),
]);
const layerManifest = JSON.parse(layerManifestBytes);
const propManifest = JSON.parse(propManifestBytes);
const propAtlasBytes = await readFile(resolve(propManifest.path));
assert(
  propAtlasBytes.length === propManifest.bytes
    && sha256(propAtlasBytes) === propManifest.sha256
    && propManifest.sha256 === manifest.source_bindings.prop_atlas_sha256,
  'Production prop atlas hash binding is stale.',
);

assert(manifest.outputs.length === 15, 'Projection must contain eight layers and seven atlases.');
assert(
  manifest.outputs.map(({ id }) => id).join('|') === Object.keys(EXPECTED).join('|'),
  'Projection output order or inventory is not canonical.',
);

let boundRoles = 0;
let physicalRegions = 0;
for (const record of manifest.outputs) {
  const dimensions = EXPECTED[record.id];
  assert(dimensions, `Unexpected projection output ${record.id}.`);
  const bytes = await readFile(resolve(record.path));
  const image = decodeRgbaPng(bytes);
  assert(
    bytes.length === record.bytes
      && sha256(bytes) === record.sha256
      && image.width === dimensions[0]
      && image.height === dimensions[1]
      && record.width === image.width
      && record.height === image.height,
    `${record.id} bytes, digest or exact Pack 0.9 dimensions are invalid.`,
  );
  const full = regionAlpha(image, { x: 0, y: 0, width: image.width, height: image.height });
  assert(full.hiddenRgb === 0, `${record.id} contains RGB under zero alpha.`);

  if (record.kind === 'layer') {
    const production = layerManifest.layers.find(({ role }) => role === record.id)?.runtime;
    assert(
      production
        && record.source_path === production.path
        && record.source_sha256 === production.sha256,
      `${record.id} production-layer record binding is stale.`,
    );
    const sourceBytes = await readFile(resolve(production.path));
    const sourceImage = decodeRgbaPng(sourceBytes);
    assert(
      sourceBytes.length === production.bytes
        && sha256(sourceBytes) === production.sha256
        && sourceImage.width === 1280
        && sourceImage.height === 720,
      `${record.id} production-layer bytes or dimensions are stale.`,
    );
  } else if (record.kind === 'atlas') {
    assert(
      record.source_path === propManifest.path
        && record.source_sha256 === propManifest.sha256,
      `${record.id} production prop-atlas binding is stale.`,
    );
    for (const region of record.regions) {
      const rect = region.physical_region;
      assert(
        rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
          && rect.x + rect.width <= image.width
          && rect.y + rect.height <= image.height,
        `${record.id} region ${region.region_index} is out of bounds.`,
      );
      assert(
        regionAlpha(image, rect).visible > 0,
        `${record.id} region ${region.region_index} is empty.`,
      );
      const topPadding = rect.height - region.projected_content.height;
      if (topPadding > 0) {
        const padding = regionAlpha(image, {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: topPadding,
        });
        assert(
          padding.visible === 0 && padding.hiddenRgb === 0,
          `${record.id} unused top padding is not transparent.`,
        );
      }
      boundRoles += region.bound_importer_roles.length;
      physicalRegions += 1;
    }
  } else if (record.kind === 'character') {
    assert(
      record.frame_width === 48
        && record.frame_height === 72
        && record.pivot.join(',') === '24,67'
        && record.clips.length * 48 === image.width,
      `${record.id} character geometry is invalid.`,
    );
    const clipIds = new Set();
    const sourceBinding = manifest.source_bindings.characters.find(({ id }) => id === record.id);
    const sourceManifestBytes = await readFile(resolve(sourceBinding.manifest));
    const sourceManifest = JSON.parse(sourceManifestBytes);
    const sourceAtlasBytes = await readFile(resolve(sourceManifest.path));
    const sourceAtlas = decodeRgbaPng(sourceAtlasBytes);
    assert(
      sha256(sourceManifestBytes) === sourceBinding.manifest_sha256
        && sourceAtlasBytes.length === sourceManifest.bytes
        && sha256(sourceAtlasBytes) === sourceManifest.sha256
        && sourceManifest.sha256 === sourceBinding.production_atlas_sha256,
      `${record.id} production character-atlas binding is stale.`,
    );
    for (let index = 0; index < record.clips.length; index += 1) {
      const clip = record.clips[index];
      const rect = { x: index * 48, y: 0, width: 48, height: 72 };
      const sourceFrame = sourceManifest.frames.find(
        (frame) => frame.clip_id === clip.clip_id && frame.frame_index === 0,
      );
      const sourceRect = {
        x: clip.source_pixel_origin.x,
        y: clip.source_pixel_origin.y,
        width: 48,
        height: 72,
      };
      assert(
        clip.pack_pixel_origin.x === rect.x
          && clip.pack_pixel_origin.y === 0
          && clip.frame_policy === 'first-independent-source-pose-only'
          && clip.native_model_animation_frame === false
          && sourceFrame?.source_pose?.native_source_pose === true
          && sourceFrame?.derivation?.native_model_animation_frame === false
          && sourceFrame?.derivation?.synthetic_pose_variant === false
          && sourceFrame?.pixel_origin?.x === sourceRect.x
          && sourceFrame?.pixel_origin?.y === sourceRect.y
          && sourceFrame?.frame_rgba_sha256 === clip.source_frame_rgba_sha256
          && regionRgbaSha256(sourceAtlas, sourceRect) === sourceFrame.frame_rgba_sha256
          && regionRgbaSha256(image, rect) === sourceFrame.frame_rgba_sha256
          && !clipIds.has(clip.clip_id)
          && regionAlpha(image, rect).visible > 0,
        `${record.id} clip ${clip.clip_id} is empty, duplicated, or overstated.`,
      );
      clipIds.add(clip.clip_id);
    }
  }
}

const expectedAliases = [
  ['terrain.ground', 'terrain.stairs'],
  ['terrain.path', 'terrain.water'],
  ['prop.tree', 'prop.occluder'],
  ['structure.entrance', 'structure.landmark'],
];
assert(
  physicalRegions === 18
    && boundRoles === 22
    && manifest.alias_contract.independent_pack_regions === 18
    && manifest.alias_contract.canonical_role_bindings === 22
    && JSON.stringify(manifest.alias_contract.alias_groups.map((entry) => entry.shared_roles))
      === JSON.stringify(expectedAliases)
    && manifest.alias_contract.limitation.includes('do not retain independent art'),
  'Pack 0.9 alias limitation is missing or overstated.',
);
assert(
  manifest.source_bindings.characters[0].production_runtime_frames === 32
    && manifest.source_bindings.characters[0].pack_projected_frames === 16
    && manifest.source_bindings.characters[0].omitted_declared_synthetic_variants === 16
    && manifest.source_bindings.characters[1].production_runtime_frames === 16
    && manifest.source_bindings.characters[1].pack_projected_frames === 8
    && manifest.source_bindings.characters[1].omitted_declared_synthetic_variants === 8
    && manifest.automated_checks.character_native_animation_claim === false,
  'Character projection count or animation provenance is invalid.',
);
assert(
  manifest.automated_checks.exact_importer_dimensions === 'pass'
    && manifest.automated_checks.unused_padding_transparent === 'pass'
    && manifest.automated_checks.all_regions_in_bounds === 'pass'
    && manifest.automated_checks.godot_import === 'pending'
    && manifest.automated_checks.human_art_review === 'pending'
    && manifest.automated_checks.raspberry_pi_runtime === 'pending'
    && manifest.not_accepted_for.includes('independent Pack 0.9 art for aliased roles')
    && manifest.not_accepted_for.includes('model-native temporal character animation'),
  'Projection review boundary is invalid.',
);

console.log(
  `MAPSOO_LAYERED_DEPTH_PACK_VERIFY_OK outputs=15 roles=${boundRoles}`
  + ` physical_regions=${physicalRegions} player_clips=16 npc_clips=8`
  + ` determinism=two-build-byte-equal manifest_sha256=${sha256(first.manifestBytes)}`,
);
