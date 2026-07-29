import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeRgbaPng } from './lib/rgba-png.mjs';

const MANIFEST =
  'docs/visual-qa/production-art/isometric-action-pack-atlases-v1.json';
const EXPECTED = Object.freeze({
  terrain: {
    dimensions: [576, 64],
    cell: [64, 64],
    roles: [
      'terrain.void', 'terrain.floor.base', 'terrain.floor.variant',
      'terrain.floor.edge', 'terrain.elevation.top',
      'terrain.elevation.riser-left', 'terrain.elevation.riser-right',
      'terrain.ramp', 'terrain.wall',
    ],
  },
  hazards: {
    dimensions: [128, 64],
    cell: [64, 64],
    roles: ['hazard.contact', 'hazard.telegraph'],
  },
  props: {
    dimensions: [320, 96],
    cell: [64, 96],
    roles: [
      'prop.blocker', 'prop.breakable', 'prop.cover',
      'prop.decoration', 'prop.light',
    ],
  },
  structures: {
    dimensions: [192, 96],
    cell: [64, 96],
    roles: ['structure.entrance', 'structure.exit', 'structure.checkpoint'],
  },
  collectibles: {
    dimensions: [64, 32],
    cell: [32, 32],
    roles: ['collectible.primary', 'collectible.health'],
  },
  effects: {
    dimensions: [448, 64],
    cell: [64, 64],
    roles: [
      'effect.player-attack', 'effect.enemy-attack', 'effect.projectile',
      'effect.impact', 'effect.dash', 'effect.spawn', 'effect.defeat',
    ],
  },
  shadows: {
    dimensions: [64, 32],
    cell: [64, 32],
    roles: ['effect.shadow'],
  },
});
const EXPECTED_CHARACTERS = Object.freeze({
  player: {
    role: 'character.player.atlas',
    dimensions: [2304, 64],
    clips: 48,
  },
  'enemy-melee': {
    role: 'character.enemy-melee.atlas',
    dimensions: [1920, 64],
    clips: 40,
  },
  'enemy-ranged': {
    role: 'character.enemy-ranged.atlas',
    dimensions: [1920, 64],
    clips: 40,
  },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function visiblePixels(image, region) {
  let count = 0;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] >= 16) count += 1;
    }
  }
  return count;
}

const manifestBytes = await readFile(resolve(MANIFEST));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
assert(
  manifest.schema_version ===
    'mapsoo-isometric-action-pack-atlas-projection/1.0'
    && manifest.id === 'isometric-action-pack-atlases-v1'
    && manifest.profile === 'isometric-action'
    && manifest.pack_schema === '0.8.0'
    && manifest.compatibility?.grid === 'diamond-64x32',
  'Isometric Pack atlas projection identity is invalid.',
);
assert(
  manifest.status === 'runtime-candidate'
    && manifest.distribution === 'internal-review'
    && manifest.output_license === 'UNRELEASED',
  'Isometric Pack atlas projection must remain unreleased.',
);
assert(
  manifest.projection?.resampler === 'nearest-neighbor'
    && manifest.projection?.source_cell?.join('x') === '96x96'
    && manifest.projection?.scale?.join('/') === '2/3',
  'Isometric Pack projection policy is invalid.',
);

for (const key of ['terrain', 'prop']) {
  const path = manifest.source_bindings[`${key}_manifest`];
  const expectedHash = manifest.source_bindings[`${key}_manifest_sha256`];
  const bytes = await readFile(resolve(path));
  const source = JSON.parse(bytes.toString('utf8'));
  assert(sha256(bytes) === expectedHash, `${key} source manifest hash is stale.`);
  assert(
    source.sha256 === manifest.source_bindings[`${key}_atlas_sha256`],
    `${key} source atlas binding is stale.`,
  );
}

assert(
  manifest.atlases.length
    === Object.keys(EXPECTED).length + Object.keys(EXPECTED_CHARACTERS).length,
  'Pack atlas projection must contain ten canonical atlases.',
);
const allRoles = new Set();
for (const record of manifest.atlases.filter(({ atlas_id: id }) => EXPECTED[id])) {
  const expected = EXPECTED[record.atlas_id];
  assert(expected, `Unexpected Pack atlas id: ${record.atlas_id}.`);
  const bytes = await readFile(resolve(record.path));
  const image = decodeRgbaPng(bytes);
  assert(
    bytes.length === record.bytes
      && sha256(bytes) === record.sha256
      && image.width === expected.dimensions[0]
      && image.height === expected.dimensions[1]
      && record.width === image.width
      && record.height === image.height,
    `Pack atlas ${record.atlas_id} integrity or dimensions are stale.`,
  );
  assert(
    record.roles.map(({ role }) => role).join('|') === expected.roles.join('|'),
    `Pack atlas ${record.atlas_id} canonical role order is invalid.`,
  );
  for (let index = 0; index < record.roles.length; index += 1) {
    const role = record.roles[index];
    assert(!allRoles.has(role.role), `Pack role is duplicated: ${role.role}.`);
    allRoles.add(role.role);
    assert(
      role.region.x === index * expected.cell[0]
        && role.region.y === 0
        && role.region.width === expected.cell[0]
        && role.region.height === expected.cell[1]
        && visiblePixels(image, role.region) > 0,
      `Pack role region is invalid or empty: ${role.role}.`,
    );
  }
}
assert(allRoles.size === 29, 'Pack projection must bind exactly 29 visual roles.');

assert(
  manifest.source_bindings.characters?.length === 3,
  'Pack projection must bind three production character manifests.',
);
let characterClips = 0;
for (const record of manifest.atlases.filter(
  ({ atlas_id: id }) => EXPECTED_CHARACTERS[id],
)) {
  const expected = EXPECTED_CHARACTERS[record.atlas_id];
  const binding = manifest.source_bindings.characters.find(
    ({ manifest: path }) => path.includes(`-${record.atlas_id}-atlas-v1.json`),
  );
  assert(binding, `Character source binding is missing: ${record.atlas_id}.`);
  const sourceManifestBytes = await readFile(resolve(binding.manifest));
  const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8'));
  assert(
    sha256(sourceManifestBytes) === binding.manifest_sha256
      && sourceManifest.sha256 === binding.production_atlas_sha256
      && sourceManifest.role === expected.role,
    `Character source binding is stale: ${record.atlas_id}.`,
  );
  const bytes = await readFile(resolve(record.path));
  const image = decodeRgbaPng(bytes);
  assert(
    bytes.length === record.bytes
      && sha256(bytes) === record.sha256
      && record.sha256 === binding.pack_atlas_sha256
      && image.width === expected.dimensions[0]
      && image.height === expected.dimensions[1]
      && record.frame_width === 48
      && record.frame_height === 64
      && record.pivot?.join(',') === '24,58'
      && record.clips?.length === expected.clips,
    `Character Pack atlas is incompatible: ${record.atlas_id}.`,
  );
  const clipIds = new Set();
  for (let index = 0; index < record.clips.length; index += 1) {
    const clip = record.clips[index];
    assert(
      !clipIds.has(clip.clip_id)
        && clip.pack_pixel_origin?.x === index * 48
        && clip.pack_pixel_origin?.y === 0
        && clip.frame_policy === 'first-independent-native-source-pose'
        && visiblePixels(image, { x: index * 48, y: 0, width: 48, height: 64 }) > 0,
      `Character Pack clip is invalid: ${record.atlas_id}/${clip.clip_id}.`,
    );
    clipIds.add(clip.clip_id);
  }
  characterClips += record.clips.length;
}
assert(characterClips === 128, 'Pack projection must bind exactly 128 character clips.');
assert(
  manifest.automated_checks?.exact_pack_dimensions === 'pass'
    && manifest.automated_checks?.exact_canonical_role_order === 'pass'
    && manifest.automated_checks?.character_first_native_frame_projection === 'pass'
    && manifest.automated_checks?.godot_import === 'pending'
    && manifest.automated_checks?.human_art_review === 'pending'
    && manifest.automated_checks?.raspberry_pi_runtime === 'pending',
  'Pack projection overstates an unverified acceptance gate.',
);
console.log(
  `MAPSOO_ISOMETRIC_PACK_ATLASES_STRICT_OK atlases=10 roles=${allRoles.size} character_clips=${characterClips} manifest_sha256=${sha256(manifestBytes)}`,
);
