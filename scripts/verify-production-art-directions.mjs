import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const records = [
  {
    manifest: 'docs/visual-qa/production-art/side-platformer-direction-v1.json',
    profile: 'side-platformer',
    requiredIdentityCues: ['magenta jacket', 'amber scarf', 'dark trousers'],
  },
  {
    manifest: 'docs/visual-qa/production-art/topdown-farm-direction-v1.json',
    profile: 'topdown-farm',
    requiredIdentityCues: [
      'messy dark hair',
      'mustard-yellow scarf',
      'plum-purple coat',
      'brown shoulder satchel',
    ],
  },
  {
    manifest: 'docs/visual-qa/production-art/isometric-action-direction-v1.json',
    profile: 'isometric-action',
    requiredIdentityCues: [
      'short dark hair',
      'mustard-yellow scarf',
      'plum-purple coat',
      'brown cross-body satchel',
    ],
  },
  {
    manifest: 'docs/visual-qa/production-art/layered-depth-2d-direction-v1.json',
    profile: 'layered-depth-2d',
    requiredIdentityCues: [
      'short dark hair',
      'mustard-yellow scarf',
      'plum-purple coat',
      'brown cross-body satchel',
    ],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readPngSize(bytes, label) {
  assert(
    bytes.length >= 24 &&
      bytes[0] === 0x89 &&
      bytes.subarray(1, 4).toString('ascii') === 'PNG',
    `${label} is not a PNG.`,
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

async function verifyRecord(spec) {
  const manifestPath = resolve(spec.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const imagePath = resolve(manifest.path);
  const image = await readFile(imagePath);
  const imageSize = readPngSize(image, manifest.path);
  const sha256 = createHash('sha256').update(image).digest('hex');

  assert(
    manifest.schema_version === 'mapsoo-art-direction-sample/1.0',
    `${spec.manifest} has an unsupported schema version.`,
  );
  assert(manifest.profile === spec.profile, `${spec.manifest} has the wrong profile.`);
  assert(manifest.status === 'direction-review', `${spec.manifest} must remain direction-review.`);
  assert(
    manifest.distribution === 'internal-review' && manifest.output_license === 'UNRELEASED',
    `${spec.manifest} must not claim public distribution or a release license.`,
  );
  assert(imageSize.width === manifest.width, `${manifest.path} width does not match its record.`);
  assert(imageSize.height === manifest.height, `${manifest.path} height does not match its record.`);
  assert(image.length === manifest.bytes, `${manifest.path} byte length does not match its record.`);
  assert(sha256 === manifest.sha256, `${manifest.path} SHA-256 does not match its record.`);

  const cues = new Set(manifest.world_direction?.identity_cues ?? []);
  for (const cue of spec.requiredIdentityCues) {
    assert(cues.has(cue), `${spec.manifest} is missing identity cue "${cue}".`);
  }

  const forbiddenClaims = [
    'sprite atlas',
    'tile atlas',
    'animation atlas',
    'collision source',
    'navigation source',
    'public asset-pack release',
  ];
  const rejected = new Set(manifest.not_accepted_for ?? []);
  for (const claim of forbiddenClaims) {
    assert(rejected.has(claim), `${spec.manifest} must reject use as ${claim}.`);
  }

  if (['topdown-farm', 'isometric-action', 'layered-depth-2d'].includes(spec.profile)) {
    assert(
      manifest.generation_context?.reference_scope?.includes('character identity cues'),
      `${spec.manifest} must constrain the reference image to identity cues.`,
    );
    assert(
      manifest.automated_observations?.single_flattened_scene_only === true &&
        manifest.automated_observations?.runtime_layers_available === false &&
        manifest.automated_observations?.tile_grid_verified === false &&
        manifest.automated_observations?.collision_verified === false,
      `${spec.manifest} overstates the generated direction image's runtime readiness.`,
    );
    assert(
      rejected.has('Godot runtime import'),
      `${spec.manifest} must reject direct Godot runtime import.`,
    );
  }

  return {
    profile: spec.profile,
    image: manifest.path,
    width: imageSize.width,
    height: imageSize.height,
    bytes: image.length,
    sha256,
    status: 'pass',
  };
}

const results = [];
for (const record of records) results.push(await verifyRecord(record));

console.log(JSON.stringify({ status: 'pass', directionSamples: results }, null, 2));
