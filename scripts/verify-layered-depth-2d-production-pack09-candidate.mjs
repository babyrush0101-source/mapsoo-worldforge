import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import JSZip from 'jszip';
import { containsPrivateConsumerToken } from './lib/private-consumer-boundary.mjs';
import { decodeRgbaPng } from './lib/rgba-png.mjs';

const BUILDER = resolve('scripts/build-layered-depth-2d-production-pack09-candidate.mjs');
const RECORD_PATH = 'docs/visual-qa/production-art/layered-depth-2d-production-pack09-candidate-v1.json';
const PROJECTION_PATH = 'docs/visual-qa/production-art/layered-depth-2d-pack-atlases-v1.json';
const IMPORTER_PATH = 'godot/addons/mapsoo_importer/mapsoo_pack_09.gd';
const SAFE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const EXPECTED_DIMENSIONS = Object.freeze({
  'layers/background-sky.png': [320, 180],
  'layers/background-far.png': [320, 180],
  'layers/background-mid.png': [320, 180],
  'layers/background-depth-fog.png': [320, 180],
  'layers/near-overlay.png': [320, 180],
  'layers/lighting-ambient.png': [320, 180],
  'layers/lighting-local.png': [320, 180],
  'layers/foreground-overlay.png': [320, 180],
  'atlases/terrain.png': [256, 96],
  'atlases/props.png': [320, 96],
  'atlases/structures.png': [192, 112],
  'atlases/collectibles.png': [64, 32],
  'atlases/effects.png': [256, 64],
  'atlases/player.png': [768, 72],
  'atlases/npc.png': [384, 72],
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
    result.status === 0 && result.stdout.includes('MAPSOO_LAYERED_PACK09_CANDIDATE_OK'),
    `Production Pack 0.9 candidate builder failed.\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  );
}

async function listFiles(root) {
  const output = [];
  async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) output.push(path);
      else throw new Error(`Fixture contains a non-regular entry: ${path}`);
    }
  }
  await walk(resolve(root));
  return output.sort((left, right) => left.localeCompare(right, 'en'));
}

async function snapshot() {
  const recordBytes = await readFile(resolve(RECORD_PATH));
  const record = JSON.parse(recordBytes);
  const zipBytes = await readFile(resolve(record.archive.path));
  const fixtureFiles = await listFiles(record.fixture_root);
  const fixture = await Promise.all(fixtureFiles.map(async (path) => ({
    path: relative(resolve(record.fixture_root), path).replaceAll('\\', '/'),
    bytes: await readFile(path),
  })));
  return { recordBytes, record, zipBytes, fixture };
}

runBuilder();
const first = await snapshot();
runBuilder();
const second = await snapshot();
assert(first.recordBytes.equals(second.recordBytes), 'Repeated build changed the candidate build record.');
assert(first.zipBytes.equals(second.zipBytes), 'Repeated build changed the candidate ZIP.');
assert(first.fixture.length === second.fixture.length, 'Repeated build changed fixture inventory.');
for (let index = 0; index < first.fixture.length; index += 1) {
  assert(
    first.fixture[index].path === second.fixture[index].path
      && first.fixture[index].bytes.equals(second.fixture[index].bytes),
    `Repeated build changed fixture/${first.fixture[index].path}.`,
  );
}

const { record } = first;
assert(
  record.id === 'layered-depth-2d-production-pack09-candidate-v1'
    && record.status === 'runtime-candidate'
    && record.distribution === 'internal-review'
    && record.output_license === 'UNRELEASED'
    && record.archive.bytes === first.zipBytes.length
    && record.archive.sha256 === sha256(first.zipBytes)
    && record.inventory.production_projection_pngs === 15
    && record.inventory.composited_preview_pngs === 1
    && record.expected_contract_results.pack_0_9_godot_importer === 'expected-reject-license-contract',
  'Candidate build record overstates its review or license status.',
);

const fixtureByPath = new Map(first.fixture.map((item) => [item.path, item.bytes]));
const manifestBytes = fixtureByPath.get('mapsoo.manifest.json');
assert(manifestBytes, 'Fixture is missing mapsoo.manifest.json.');
assert(sha256(manifestBytes) === record.manifest_sha256, 'Manifest hash binding is stale.');
const manifest = JSON.parse(manifestBytes);
assert(
  manifest.schema_version === '0.9.0'
    && manifest.pack.id === 'lanternmere-crossing-production-v1'
    && manifest.profile === 'layered-depth-2d'
    && manifest.completeness_policy === 'layered-depth-2d-complete-v1'
    && manifest.roles.length === 36
    && manifest.characters.length === 2
    && manifest.characters[0].clips.length === 16
    && manifest.characters[1].clips.length === 8,
  'Candidate manifest does not retain the canonical Pack 0.9 inventory.',
);
assert(
  manifest.license.output.id === 'LicenseRef-UNRELEASED'
    && manifest.license.output.permits_redistribution === false
    && manifest.provenance.contains_generative_ai === true
    && manifest.provenance.output_provenance === 'hybrid'
    && manifest.provenance.human_curated === false,
  'Candidate manifest hides its license, AI provenance or pending human review.',
);

const knownPaths = new Set();
for (const file of manifest.files) {
  assert(SAFE_PATH.test(file.path) && !knownPaths.has(file.path), `Unsafe or duplicate manifest path: ${file.path}`);
  knownPaths.add(file.path);
  const bytes = fixtureByPath.get(file.path);
  assert(
    bytes
      && bytes.length === file.bytes
      && sha256(bytes) === file.sha256,
    `Fixture bytes do not match manifest: ${file.path}`,
  );
}
assert(
  fixtureByPath.size === manifest.files.length + 1,
  'Fixture contains unrecorded files or is missing the manifest.',
);
const references = [
  ...manifest.atlases.map(({ path }) => path),
  ...manifest.planes.map(({ path }) => path),
  ...manifest.roles.map(({ path }) => path),
  ...manifest.characters.map(({ atlas }) => atlas),
  manifest.runtime.scene.path,
  manifest.runtime.collision.path,
  manifest.runtime.navigation.path,
  manifest.license.output.notice_path,
];
assert(references.every((path) => knownPaths.has(path)), 'Manifest contains a dangling file reference.');

const projection = JSON.parse(await readFile(resolve(PROJECTION_PATH)));
assert(projection.outputs.length === 15, 'Source projection no longer has exactly 15 PNG outputs.');
const projectionFileRecords = new Map(
  projection.outputs.map((item) => [item.id, {
    bytes: item.bytes,
    sha256: item.sha256,
    source: item.path,
  }]),
);
const projectedPngPaths = Object.keys(EXPECTED_DIMENSIONS);
assert(projectedPngPaths.length === 15, 'Expected projection inventory must contain exactly 15 paths.');
for (const path of projectedPngPaths) {
  const bytes = fixtureByPath.get(path);
  assert(bytes, `Fixture is missing projected PNG ${path}.`);
  const image = decodeRgbaPng(bytes);
  const dimensions = EXPECTED_DIMENSIONS[path];
  assert(
    image.width === dimensions[0] && image.height === dimensions[1],
    `${path} does not match the exact Pack 0.9 dimensions.`,
  );
  const id = path.startsWith('layers/')
    ? [...new Map([
      ['layers/background-sky.png', 'background.sky'],
      ['layers/background-far.png', 'background.far'],
      ['layers/background-mid.png', 'background.mid'],
      ['layers/background-depth-fog.png', 'background.depth-fog'],
      ['layers/near-overlay.png', 'near.overlay'],
      ['layers/lighting-ambient.png', 'lighting.ambient'],
      ['layers/lighting-local.png', 'lighting.local'],
      ['layers/foreground-overlay.png', 'foreground.overlay'],
    ])].find(([candidate]) => candidate === path)?.[1]
    : path.slice(path.lastIndexOf('/') + 1, -4);
  const source = projectionFileRecords.get(id);
  assert(
    source
      && bytes.length === source.bytes
      && sha256(bytes) === source.sha256
      && (await readFile(resolve(source.source))).equals(bytes),
    `${path} is not an exact hash-bound production projection PNG.`,
  );
}
const pngPaths = manifest.files.filter(({ media_type: mediaType }) => mediaType === 'image/png');
assert(
  pngPaths.length === 16
    && pngPaths.filter(({ path }) => path === 'previews/world.png').length === 1,
  'Pack must contain 15 projection PNGs plus one separately bound preview.',
);

const schemas = {};
for (const name of [
  'mapsoo-pack-0.9.schema.json',
  'mapsoo-layered-depth-scene-0.4.schema.json',
  'mapsoo-layered-depth-collision-0.4.schema.json',
  'mapsoo-layered-depth-navigation-0.4.schema.json',
  'mapsoo-world-asset-receipt-0.4.schema.json',
]) {
  schemas[name] = JSON.parse(fixtureByPath.get(`schema/${name}`));
}
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validatePack = ajv.compile(schemas['mapsoo-pack-0.9.schema.json']);
assert(validatePack(manifest), `Pack 0.9 JSON structure failed: ${ajv.errorsText(validatePack.errors)}`);

const sidecars = {};
for (const [kind, schemaName] of [
  ['scene', 'mapsoo-layered-depth-scene-0.4.schema.json'],
  ['collision', 'mapsoo-layered-depth-collision-0.4.schema.json'],
  ['navigation', 'mapsoo-layered-depth-navigation-0.4.schema.json'],
]) {
  sidecars[kind] = JSON.parse(fixtureByPath.get(`runtime/${kind}.json`));
  const validate = ajv.compile(schemas[schemaName]);
  assert(validate(sidecars[kind]), `${kind} schema failed: ${ajv.errorsText(validate.errors)}`);
}
assert(
  JSON.stringify(manifest.runtime.spawn) === JSON.stringify(sidecars.scene.spawn)
    && JSON.stringify(sidecars.scene.spawn) === JSON.stringify(sidecars.collision.spawn)
    && JSON.stringify(sidecars.scene.spawn) === JSON.stringify(sidecars.navigation.spawn)
    && JSON.stringify(sidecars.scene.bounds) === JSON.stringify(sidecars.collision.bounds)
    && JSON.stringify(sidecars.scene.bounds) === JSON.stringify(sidecars.navigation.bounds),
  'Runtime sidecars do not share exact bounds and spawn.',
);
const nodes = new Map(sidecars.navigation.nodes.map((node) => [node.id, node]));
const spawnNode = sidecars.navigation.nodes.find((node) => node.kind === 'spawn');
const reached = new Set([spawnNode?.id]);
for (let changed = true; changed;) {
  changed = false;
  for (const edge of sidecars.navigation.edges) {
    assert(nodes.has(edge.from) && nodes.has(edge.to), 'Navigation edge contains a dangling node reference.');
    if (reached.has(edge.from) && !reached.has(edge.to)) {
      reached.add(edge.to);
      changed = true;
    }
  }
}
assert(reached.has(sidecars.navigation.exit_node_id), 'Production candidate exit is unreachable.');

const receipt = JSON.parse(fixtureByPath.get('generation-receipt.json'));
const validateReceipt = ajv.compile(schemas['mapsoo-world-asset-receipt-0.4.schema.json']);
assert(
  validateReceipt(receipt) === false
    && validateReceipt.errors?.length === 1
    && validateReceipt.errors[0].instancePath === '/output/license'
    && validateReceipt.errors[0].keyword === 'const'
    && receipt.output.license === 'LicenseRef-UNRELEASED',
  `Receipt 0.4 must reject only the unreleased license: ${ajv.errorsText(validateReceipt.errors)}`,
);

const review = JSON.parse(fixtureByPath.get('review-status.json'));
assert(
  review.distribution === 'internal-review'
    && review.output_license === 'UNRELEASED'
    && review.public_release_allowed === false
    && review.inventory.production_projection_pngs === 15
    && review.pack_0_9_compatibility.receipt_0_4_license_contract === 'expected-reject'
    && review.pack_0_9_compatibility.importer_license_contract === 'expected-reject'
    && review.review_gates.human_art_review === 'pending'
    && review.review_gates.rights_and_license_review === 'pending',
  'Review status does not preserve the internal-only release gate.',
);
const importer = await readFile(resolve(IMPORTER_PATH), 'utf8');
assert(
  importer.includes('output_license.get("id") != "CC0-1.0"')
    && importer.includes('output_license.get("permits_redistribution") != true')
    && importer.includes('Pack 0.9 requires the canonical CC0 output contract.')
    && (manifest.license.output.id !== 'CC0-1.0'
      || manifest.license.output.permits_redistribution !== true),
  'Static Pack 0.9 importer audit no longer proves the expected license rejection.',
);
const textualFixture = first.fixture
  .filter(({ path }) => /\.(?:json|md)$/.test(path))
  .map(({ bytes }) => bytes.toString('utf8'))
  .join('\n');
assert(!containsPrivateConsumerToken(textualFixture), 'Candidate fixture leaks a private consumer name.');

const zip = await JSZip.loadAsync(first.zipBytes);
const zipFiles = Object.values(zip.files).filter((item) => !item.dir);
assert(zipFiles.length === first.fixture.length, 'ZIP and extracted fixture inventories differ.');
const roots = new Set(zipFiles.map(({ name }) => name.split('/')[0]));
assert(roots.size === 1 && roots.has(record.archive.root), 'ZIP must contain one canonical archive root.');
for (const item of zipFiles) {
  const relativePath = item.name.slice(record.archive.root.length + 1);
  assert(SAFE_PATH.test(relativePath), `ZIP contains unsafe path: ${item.name}`);
  const bytes = await item.async('nodebuffer');
  assert(
    fixtureByPath.has(relativePath) && fixtureByPath.get(relativePath).equals(bytes),
    `ZIP and extracted fixture differ at ${relativePath}.`,
  );
}

console.log(
  `MAPSOO_LAYERED_PACK09_CANDIDATE_VERIFY_OK projection_pngs=15 preview_pngs=1`
    + ` files=${manifest.files.length} determinism=two-build-byte-equal`
    + ` zip_sha256=${sha256(first.zipBytes)} importer=expected-reject-license`,
);
