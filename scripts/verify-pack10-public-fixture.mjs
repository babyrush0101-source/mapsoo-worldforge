import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import JSZip from 'jszip';

import {
  buildPublicFixture,
  DEFAULT_OUTPUT_ROOT,
  ZIP_NAME,
} from './build-pack10-public-fixture.mjs';
import { containsPrivateConsumerToken } from './lib/private-consumer-boundary.mjs';
import { decodeRgbaPng } from './lib/rgba-png.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_PATH =
  /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*(?:\/[A-Za-z0-9][A-Za-z0-9._+!#$&^~-]*)*$/;
const FORBIDDEN_EXTENSION =
  /\.(?:gd|gdshader|glsl|shader|js|mjs|cjs|ts|tsx|jsx|cs|py|sh|ps1|bat|cmd|exe|dll|so|dylib|wasm)$/i;
const EMAIL_OR_ABSOLUTE =
  /@[a-z0-9.-]+\.[a-z]{2,}|\b[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var)\//i;
const URL = /(?:https?|file):\/\/|www\./i;
const SCRIPT_OR_SHADER = /#!\/|\bshader_type\b|\bextends\s+Node\b|<script\b/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function filesUnder(root, current = root) {
  const rows = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) rows.push(...await filesUnder(root, absolute));
    else rows.push(relative(root, absolute).replaceAll('\\', '/'));
  }
  return rows.sort();
}

async function readTree(root) {
  const result = new Map();
  for (const path of await filesUnder(root)) result.set(path, await readFile(join(root, ...path.split('/'))));
  return result;
}

function assertBytesEqual(left, right, label) {
  assert(left.length === right.length && left.equals(right), `${label} bytes differ.`);
}

function pngChunks(bytes) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    chunks.push(type);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  return chunks;
}

async function validateSchema(manifest) {
  const schema = JSON.parse(
    await readFile(join(REPOSITORY_ROOT, 'schemas', 'mapsoo-pack-1.0.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert(validate(manifest), `Schema errors: ${JSON.stringify(validate.errors)}`);
}

function validateText(path, bytes) {
  const text = bytes.toString('utf8');
  assert(!containsPrivateConsumerToken(text), `${path} crosses the private consumer boundary.`);
  assert(!EMAIL_OR_ABSOLUTE.test(text), `${path} contains an email address or absolute path.`);
  assert(!URL.test(text), `${path} contains a URL.`);
  assert(!SCRIPT_OR_SHADER.test(text), `${path} contains script or shader content.`);
}

function validateRuntime(manifest, payloads, roleIds) {
  const scene = JSON.parse(payloads.get(manifest.runtime.scene.path).toString('utf8'));
  const collision = JSON.parse(payloads.get(manifest.runtime.collision.path).toString('utf8'));
  const navigation = JSON.parse(payloads.get(manifest.runtime.navigation.path).toString('utf8'));
  for (const document of [scene, collision, navigation]) {
    assert(document.synthetic === true, 'Every runtime document must declare synthetic=true.');
    assert(document.fixture_id === manifest.pack.id, 'Runtime fixture id does not match the pack.');
  }
  assert(
    scene.spawn.x === manifest.runtime.spawn.x && scene.spawn.y === manifest.runtime.spawn.y,
    'Runtime spawn does not match scene spawn.',
  );
  for (const placement of scene.placements) {
    assert(roleIds.has(placement.role), `Scene placement references unknown role ${placement.role}.`);
  }
  assert(Array.isArray(collision.solids) && collision.solids.length >= 1, 'Collision fixture is empty.');

  const nodes = new Map(navigation.nodes.map((node) => [node.id, node]));
  const adjacency = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const edge of navigation.edges) {
    assert(nodes.has(edge.from) && nodes.has(edge.to), 'Navigation edge references an unknown node.');
    adjacency.get(edge.from).push(edge.to);
  }
  const visited = new Set(['spawn']);
  const queue = ['spawn'];
  while (queue.length > 0) {
    for (const next of adjacency.get(queue.shift()) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  assert(visited.has('exit'), 'Navigation has no spawn-to-exit route.');
}

async function validateFixture(root, expectedBuild) {
  const committed = await readTree(root);
  // ZIPs are repository-wide ignored release artifacts. A clean clone commits
  // only the portable fixture source tree and regenerates the deterministic ZIP
  // during verification.
  committed.delete(ZIP_NAME);
  const expectedPaths = [...expectedBuild.outputFiles.keys()]
    .filter((path) => path !== ZIP_NAME)
    .sort();
  assert(
    JSON.stringify([...committed.keys()]) === JSON.stringify(expectedPaths),
    `Fixture tree differs from the deterministic build.\nActual: ${[...committed.keys()]}\nExpected: ${expectedPaths}`,
  );
  for (const path of expectedPaths) {
    assertBytesEqual(committed.get(path), expectedBuild.outputFiles.get(path), `Committed ${path}`);
  }

  const manifestBytes = committed.get('mapsoo.manifest.json');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  await validateSchema(manifest);
  assert(manifest.distribution === 'public', 'Fixture distribution is not public.');
  assert(
    ['human_art', 'rights', 'runtime', 'raspberry_pi']
      .every((gate) => manifest.review[gate] === 'pass'),
    'Human, rights, runtime and Raspberry Pi gates must pass.',
  );
  assert(
    manifest.license.output.id === 'CC0-1.0'
      && manifest.license.output.permits_redistribution === true
      && manifest.license.output.permits_commercial_use === true,
    'Fixture is not redistributable CC0.',
  );
  assert(
    manifest.provenance.output_provenance === 'procedural'
      && manifest.provenance.contains_generative_ai === false
      && manifest.provenance.model_provider === null
      && manifest.provenance.model === null,
    'Fixture provenance is not fully procedural.',
  );

  const payloadPaths = [...committed.keys()]
    .filter((path) => path !== 'mapsoo.manifest.json' && path !== ZIP_NAME)
    .sort();
  assert(
    JSON.stringify(manifest.files.map(({ path }) => path)) === JSON.stringify(payloadPaths),
    'Manifest files are not a complete sorted payload inventory.',
  );
  const payloads = new Map();
  const dimensions = new Map();
  for (const record of manifest.files) {
    assert(SAFE_PATH.test(record.path), `Unsafe payload path: ${record.path}`);
    assert(!FORBIDDEN_EXTENSION.test(record.path), `Executable or script path is forbidden: ${record.path}`);
    const bytes = committed.get(record.path);
    assert(bytes.length === record.bytes, `${record.path} byte count differs.`);
    assert(sha256(bytes) === record.sha256, `${record.path} SHA-256 differs.`);
    payloads.set(record.path, bytes);
    if (record.media_type === 'image/png') {
      assert(
        JSON.stringify(pngChunks(bytes)) === JSON.stringify(['IHDR', 'IDAT', 'IEND']),
        `${record.path} contains PNG metadata or unexpected chunks.`,
      );
      const image = decodeRgbaPng(bytes);
      dimensions.set(record.path, [image.width, image.height]);
    } else {
      validateText(record.path, bytes);
      if (record.media_type.includes('json')) JSON.parse(bytes.toString('utf8'));
    }
  }
  validateText('mapsoo.manifest.json', manifestBytes);

  const referenced = new Set([
    manifest.license.output.notice_path,
    manifest.runtime.scene.path,
    manifest.runtime.collision.path,
    manifest.runtime.navigation.path,
  ]);
  const atlasById = new Map(manifest.atlases.map((atlas) => [atlas.id, atlas]));
  for (const plane of manifest.planes) {
    referenced.add(plane.path);
    assert(payloads.has(plane.path), `${plane.id} plane is missing.`);
    assert(
      JSON.stringify(dimensions.get(plane.path)) === JSON.stringify([160, 90]),
      `${plane.id} plane dimensions differ.`,
    );
  }
  for (const atlas of manifest.atlases) {
    referenced.add(atlas.path);
    assert(payloads.has(atlas.path), `${atlas.id} atlas is missing.`);
    const [width, height] = dimensions.get(atlas.path);
    assert(
      width % atlas.cell_size[0] === 0 && height % atlas.cell_size[1] === 0,
      `${atlas.id} atlas is not cell aligned.`,
    );
  }

  const roleIds = new Set();
  for (const entry of manifest.roles) {
    assert(!roleIds.has(entry.role), `Duplicate role ${entry.role}.`);
    roleIds.add(entry.role);
    if (entry.binding.kind === 'file') {
      referenced.add(entry.binding.path);
      assert(payloads.has(entry.binding.path), `${entry.role} file binding is missing.`);
    } else {
      const atlas = atlasById.get(entry.binding.atlas);
      assert(atlas, `${entry.role} references unknown atlas.`);
      const [width, height] = dimensions.get(atlas.path);
      const region = entry.binding.region;
      assert(region.x + region.width <= width && region.y + region.height <= height, `${entry.role} region exceeds its atlas.`);
    }
  }
  assert(roleIds.size === 36, `Expected 36 unique roles, found ${roleIds.size}.`);

  for (const character of manifest.characters) {
    referenced.add(character.atlas);
    const [width, height] = dimensions.get(character.atlas);
    const actions = character.id === 'player'
      ? ['idle', 'walk', 'run', 'interact']
      : character.id === 'npc'
        ? ['idle', 'talk']
        : [];
    const directions = ['left', 'right', 'near', 'far'];
    assert(
      character.frame_size[0] === 48
        && character.frame_size[1] === 72
        && character.pivot[0] === 24
        && character.pivot[1] === 67,
      `${character.id} geometry differs from the Pack 1.0 contract.`,
    );
    const expectedClips = new Set(
      actions.flatMap((action) => directions.map((direction) => `${action}.${direction}`)),
    );
    assert(
      character.clips.length === expectedClips.size
        && character.clips.every((clip) => expectedClips.delete(clip.id))
        && expectedClips.size === 0,
      `${character.id} does not contain the exact canonical clip inventory.`,
    );
    const frameOrigins = new Set();
    for (const clip of character.clips) {
      assert(clip.frames.length >= 2, `${character.id}.${clip.id} is not animated.`);
      for (const frame of clip.frames) {
        assert(
          frame.provenance === 'declared-synthetic-variant',
          `${character.id}.${clip.id} contains a non-synthetic frame.`,
        );
        assert(
          frame.x + character.frame_size[0] <= width
            && frame.y + character.frame_size[1] <= height,
          `${character.id}.${clip.id} frame exceeds its atlas.`,
        );
        const origin = `${frame.x},${frame.y}`;
        assert(!frameOrigins.has(origin), `${character.id} reuses frame origin ${origin}.`);
        frameOrigins.add(origin);
      }
    }
  }

  const recipePath = 'provenance/synthetic-recipe.json';
  referenced.add(recipePath);
  const recipe = JSON.parse(payloads.get(recipePath).toString('utf8'));
  assert(recipe.synthetic === true && recipe.generative_ai === false, 'Recipe is not explicitly synthetic.');
  assert(
    manifest.provenance.source_manifest_hashes.length === 1
      && manifest.provenance.source_manifest_hashes[0] === sha256(payloads.get(recipePath)),
    'Recipe hash is not bound by provenance.',
  );
  assert(
    JSON.stringify([...referenced].sort()) === JSON.stringify(payloadPaths),
    `Some payloads are unreferenced: ${payloadPaths.filter((path) => !referenced.has(path))}`,
  );
  validateRuntime(manifest, payloads, roleIds);

  const zipBytes = expectedBuild.outputFiles.get(ZIP_NAME);
  assert(sha256(zipBytes) === expectedBuild.zipSha256, 'Generated ZIP digest differs.');
  const archive = await JSZip.loadAsync(zipBytes);
  const zipPaths = Object.keys(archive.files).filter((path) => !archive.files[path].dir).sort();
  const expectedZipPaths = ['mapsoo.manifest.json', ...payloadPaths].sort();
  assert(JSON.stringify(zipPaths) === JSON.stringify(expectedZipPaths), 'ZIP entry inventory differs.');
  for (const path of zipPaths) {
    assert(SAFE_PATH.test(path) && !FORBIDDEN_EXTENSION.test(path), `Unsafe ZIP entry: ${path}`);
    const bytes = await archive.files[path].async('nodebuffer');
    assertBytesEqual(bytes, committed.get(path), `ZIP ${path}`);
  }

  return {
    manifest_sha256: sha256(manifestBytes),
    zip_sha256: sha256(zipBytes),
    payload_files: payloadPaths.length,
    roles: roleIds.size,
    characters: manifest.characters.length,
  };
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'mapsoo-pack10-public-'));
try {
  const firstRoot = join(temporaryRoot, 'first');
  const secondRoot = join(temporaryRoot, 'second');
  const first = await buildPublicFixture(firstRoot, join(firstRoot, ZIP_NAME));
  const second = await buildPublicFixture(secondRoot, join(secondRoot, ZIP_NAME));
  assert(first.manifestSha256 === second.manifestSha256, 'Two manifest builds differ.');
  assert(first.zipSha256 === second.zipSha256, 'Two ZIP builds differ.');
  assertBytesEqual(
    first.outputFiles.get(ZIP_NAME),
    second.outputFiles.get(ZIP_NAME),
    'Two deterministic ZIP builds',
  );
  const result = await validateFixture(DEFAULT_OUTPUT_ROOT, first);
  process.stdout.write(`PACK10_PUBLIC_FIXTURE_OK ${JSON.stringify(result)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
