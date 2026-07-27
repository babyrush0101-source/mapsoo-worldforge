import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHELL_ROOT = join(REPOSITORY_ROOT, 'godot', 'world_runner_shell');
const PACKER_SCRIPT = join(REPOSITORY_ROOT, 'godot', 'tests', 'build_world_runner_pck.gd');
const RUNTIME_ROOT = join(REPOSITORY_ROOT, 'godot', 'addons', 'mapsoo_importer', 'runtime');
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_PROFILES = new Set([
  'side-platformer',
  'topdown-farm',
  'isometric-action',
  'layered-depth-2d',
]);
const RUNTIME_FILES = [
  'mapsoo_character_profile_runtime.gd',
  'mapsoo_isometric_player_controller.gd',
  'mapsoo_layered_depth_player_controller.gd',
  'mapsoo_layered_depth_production_candidate.gd',
  'mapsoo_player_controller.gd',
];
const STATE_KEYS = [
  'cell_count',
  'generated_files',
  'godot_serialization',
  'importer',
  'integrity_sha256',
  'manifest_sha256',
  'pack_id',
  'prop_count',
  'schema_version',
];
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has unexpected fields.`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function strictUtf8(bytes, label) {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_TEXT_BYTES) {
    throw new Error(`${label} is outside its byte limit.`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not strict UTF-8.`);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(strictUtf8(bytes, label));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} is invalid JSON.`);
    throw error;
  }
}

async function realFileInside(rootValue, pathValue, label) {
  const root = await realpath(resolve(rootValue));
  const path = await realpath(resolve(pathValue));
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)
      || isAbsolute(fromRoot) || !(await stat(path)).isFile()) {
    throw new Error(`${label} must be a file inside the bundle root.`);
  }
  return path;
}

async function realDirectoryInside(rootValue, pathValue, label) {
  const root = await realpath(resolve(rootValue));
  const path = await realpath(resolve(pathValue));
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)
      || isAbsolute(fromRoot) || !(await stat(path)).isDirectory()) {
    throw new Error(`${label} must be a directory inside the bundle root.`);
  }
  return path;
}

async function manifestRecordFromPack(packBytes, worldId) {
  if (packBytes.byteLength < 64 || packBytes.byteLength > 2_147_483_647) {
    throw new Error('World pack is outside its byte limit.');
  }
  let archive;
  try {
    archive = await JSZip.loadAsync(packBytes, { checkCRC32: true });
  } catch {
    throw new Error('World pack must be a valid ZIP archive.');
  }
  const manifestEntries = Object.values(archive.files).filter((entry) =>
    !entry.dir && basename(entry.name) === 'mapsoo.manifest.json');
  if (manifestEntries.length !== 1) {
    throw new Error('World pack must contain exactly one mapsoo.manifest.json.');
  }
  const advertisedManifestBytes = manifestEntries[0]?._data?.uncompressedSize;
  if (!Number.isSafeInteger(advertisedManifestBytes)
      || advertisedManifestBytes < 2
      || advertisedManifestBytes > MAX_TEXT_BYTES) {
    throw new Error('World pack manifest is outside its advertised byte limit.');
  }
  const manifestBytes = await manifestEntries[0].async('uint8array');
  const manifest = parseJson(manifestBytes, 'World pack manifest');
  const manifestWorldId = manifest?.pack?.id ?? manifest?.id;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || manifestWorldId !== worldId || !SAFE_PROFILES.has(manifest.profile)) {
    throw new Error('World pack manifest does not match the requested world.');
  }
  return {
    bytes: Uint8Array.from(manifestBytes),
    sha256: sha256Bytes(manifestBytes),
    profile: manifest.profile,
  };
}

async function verifyManagedImport(importedWorldDir, worldId, manifestRecord) {
  const sceneName = `${worldId}.world.tscn`;
  const tilesetName = `${worldId}.tileset.tres`;
  const stateName = 'mapsoo.import-state.json';
  const names = (await readdir(importedWorldDir)).sort((left, right) =>
    left.localeCompare(right, 'en'));
  if (JSON.stringify(names) !== JSON.stringify([stateName, tilesetName, sceneName].sort())) {
    throw new Error('Imported world must contain exactly its three importer-managed files.');
  }
  const [scenePath, tilesetPath, statePath] = await Promise.all([
    realFileInside(importedWorldDir, join(importedWorldDir, sceneName), 'Managed scene'),
    realFileInside(importedWorldDir, join(importedWorldDir, tilesetName), 'Managed TileSet'),
    realFileInside(importedWorldDir, join(importedWorldDir, stateName), 'Importer state'),
  ]);
  const sceneBytes = Uint8Array.from(await readFile(scenePath));
  const tilesetBytes = Uint8Array.from(await readFile(tilesetPath));
  const stateBytes = Uint8Array.from(await readFile(statePath));
  const state = parseJson(stateBytes, 'Importer state');
  exactKeys(state, STATE_KEYS, 'Importer state');
  exactKeys(state.importer, ['id', 'version'], 'Importer identity');
  exactKeys(state.generated_files, [sceneName, tilesetName], 'Generated file inventory');
  if (state.schema_version !== '1.0.0'
      || state.pack_id !== worldId
      || state.manifest_sha256 !== manifestRecord.sha256
      || state.importer.id !== 'mapsoo_importer'
      || typeof state.importer.version !== 'string'
      || !/^\d+\.\d+\.\d+$/u.test(state.importer.version)
      || typeof state.godot_serialization !== 'string'
      || !/^4\.(?:3|[4-9]|\d{2,})$/u.test(state.godot_serialization)
      || !Number.isSafeInteger(state.cell_count) || state.cell_count < 0
      || !Number.isSafeInteger(state.prop_count) || state.prop_count < 0
      || state.generated_files[sceneName] !== sha256Bytes(sceneBytes)
      || state.generated_files[tilesetName] !== sha256Bytes(tilesetBytes)) {
    throw new Error('Importer state is not bound to the exact managed files and Pack manifest.');
  }
  const core = {
    schema_version: state.schema_version,
    importer: state.importer,
    godot_serialization: state.godot_serialization,
    pack_id: state.pack_id,
    manifest_sha256: state.manifest_sha256,
    generated_files: state.generated_files,
    cell_count: state.cell_count,
    prop_count: state.prop_count,
  };
  if (!SHA256.test(state.integrity_sha256)
      || state.integrity_sha256 !== sha256Bytes(Buffer.from(
        JSON.stringify(canonicalJson(core)),
        'utf8',
      ))) {
    throw new Error('Importer state integrity digest is invalid.');
  }
  const sceneText = strictUtf8(sceneBytes, 'Managed scene');
  const tilesetText = strictUtf8(tilesetBytes, 'Managed TileSet');
  const forbidden = /(?:uid:\/\/|https?:\/\/|file:\/\/|\.\.|\\)/u;
  const resourcePaths = [...sceneText.matchAll(/path="(res:\/\/[^"]+)"/gu)]
    .map((match) => match[1]);
  if (forbidden.test(sceneText) || forbidden.test(tilesetText)
      || /path="res:\/\//u.test(tilesetText)
      || /\[sub_resource type="(?:GDScript|Shader|GDExtension)"/u.test(sceneText)
      || /source_code\s*=/u.test(sceneText)
      || resourcePaths.some((path) =>
        !path.startsWith('res://addons/mapsoo_importer/runtime/'))
      || !sceneText.includes(`metadata/mapsoo_pack_id = "${worldId}"`)
      || !sceneText.includes(`metadata/mapsoo_profile = "${manifestRecord.profile}"`)) {
    throw new Error('Managed scene or TileSet contains an unsafe reference or wrong metadata.');
  }
  return { sceneName, tilesetName, stateName, state, sceneBytes, tilesetBytes, stateBytes };
}

async function runGodot(godotBin, args, label) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(godotBin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const output = `${stdout}\n${stderr}`;
      if (code !== 0 || /^(?:SCRIPT )?ERROR:/mu.test(output)) {
        reject(new Error(`${label} failed.\n${output}`));
        return;
      }
      resolvePromise({ stdout, stderr, output });
    });
  });
}

async function writeExclusiveOrIdentical(pathValue, bytes, label) {
  const path = resolve(pathValue);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = Uint8Array.from(await readFile(path));
    if (existing.byteLength !== bytes.byteLength
        || existing.some((byte, index) => byte !== bytes[index])) {
      throw new Error(`Refusing to overwrite a different ${label}.`);
    }
  }
}

async function prepareContainedOutput(root, path, label) {
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)
      || isAbsolute(fromRoot)) {
    throw new Error(`${label} must be inside the bundle root.`);
  }
  await mkdir(dirname(path), { recursive: true });
  const realParent = await realpath(dirname(path));
  const realFromRoot = relative(root, realParent);
  if (realFromRoot === '..' || realFromRoot.startsWith(`..${sep}`)
      || isAbsolute(realFromRoot)) {
    throw new Error(`${label} parent must stay inside the bundle root.`);
  }
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`${label} must not be a link or non-file.`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function copyTrustedProject(stagingRoot, managed, importedWorldDir, worldId) {
  const records = [];
  async function stage(source, target) {
    const path = join(stagingRoot, ...target.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await copyFile(source, path);
    records.push({ source: path, target: `res://${target}` });
  }
  for (const name of ['delivery_probe.gd', 'delivery_probe.tscn', 'project.godot']) {
    await stage(join(SHELL_ROOT, name), name);
  }
  for (const name of RUNTIME_FILES) {
    await stage(
      join(RUNTIME_ROOT, name),
      `addons/mapsoo_importer/runtime/${name}`,
    );
  }
  for (const name of [managed.stateName, managed.tilesetName, managed.sceneName]) {
    await stage(
      join(importedWorldDir, name),
      `mapsoo_imports/${worldId}/${name}`,
    );
  }
  records.sort((left, right) => left.target.localeCompare(right.target, 'en'));
  return records;
}

export async function inspectWorldRunnerPckInput(input) {
  const worldId = String(input.worldId ?? '');
  if (!SAFE_ID.test(worldId) || worldId.length > 80) {
    throw new Error('World ID must use bounded lowercase kebab-case.');
  }
  const bundleRoot = await realpath(resolve(input.bundleRoot));
  const worldPackPath = await realFileInside(
    bundleRoot,
    input.worldPackPath,
    'World pack',
  );
  const importedWorldDir = await realDirectoryInside(
    bundleRoot,
    input.importedWorldDir,
    'Imported world',
  );
  const packBytes = Uint8Array.from(await readFile(worldPackPath));
  const manifest = await manifestRecordFromPack(packBytes, worldId);
  const managed = await verifyManagedImport(importedWorldDir, worldId, manifest);
  return Object.freeze({
    bundleRoot,
    worldId,
    worldPackPath,
    importedWorldDir,
    packSha256: sha256Bytes(packBytes),
    profile: manifest.profile,
    manifestSha256: manifest.sha256,
    godotSerialization: managed.state.godot_serialization,
    managed,
  });
}

export async function buildWorldRunnerPck(input) {
  const inspected = await inspectWorldRunnerPckInput(input);
  const godotBin = await realpath(resolve(input.godotBin));
  if (!(await stat(godotBin)).isFile()) throw new Error('Godot binary is not a file.');
  const pckPath = resolve(input.pckPath);
  const reportPath = resolve(input.reportPath);
  const receiptPath = resolve(input.receiptPath);
  for (const [path, label] of [
    [pckPath, 'PCK output'],
    [reportPath, 'smoke report'],
    [receiptPath, 'build receipt'],
  ]) {
    await prepareContainedOutput(inspected.bundleRoot, path, label);
  }
  const versionRun = await runGodot(godotBin, ['--version'], 'Godot version check');
  const versionMatch = versionRun.output.match(/\b(4\.(?:3|[4-9]|\d{2,})(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b/u);
  if (!versionMatch) throw new Error('Godot 4.3 or newer is required.');
  const godotVersion = versionMatch[1];
  const temporary = join(
    inspected.bundleRoot,
    `.world-runner-pck-${randomUUID()}`,
  );
  const stagingRoot = join(temporary, 'project');
  const temporaryPck = join(temporary, `${inspected.worldId}.pck`);
  try {
    await mkdir(stagingRoot, { recursive: true });
    const inventory = await copyTrustedProject(
      stagingRoot,
      inspected.managed,
      inspected.importedWorldDir,
      inspected.worldId,
    );
    const inventoryPath = join(temporary, 'inventory.json');
    await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
    const buildRun = await runGodot(godotBin, [
      '--headless',
      '--path', join(REPOSITORY_ROOT, 'godot'),
      '--script', PACKER_SCRIPT,
      '--',
      `--inventory=${inventoryPath}`,
      `--output=${temporaryPck}`,
    ], 'Godot PCK build');
    if (!buildRun.output.includes(`MAPSOO_WORLD_RUNNER_PCK_BUILD_OK files=${inventory.length}`)) {
      throw new Error('Godot PCK build did not emit the exact success marker.');
    }
    const pckBytes = Uint8Array.from(await readFile(temporaryPck));
    if (pckBytes.byteLength < 64) throw new Error('Generated PCK is unexpectedly small.');
    const runtimeArtifactSha256 = sha256Bytes(pckBytes);
    const smokeRun = await runGodot(godotBin, [
      '--headless',
      '--main-pack', temporaryPck,
      '--',
      `--world-id=${inspected.worldId}`,
      `--pack-sha256=${inspected.packSha256}`,
    ], 'Packaged world headless smoke');
    const expectedMarker = [
      'MAPSOO_WORLD_RUNNER_PCK_OK',
      `world_id=${inspected.worldId}`,
      `pack_sha256=${inspected.packSha256}`,
      `profile=${inspected.profile}`,
      `scene=res://mapsoo_imports/${inspected.worldId}/${inspected.worldId}.world.tscn`,
      'physical_raspberry_pi=not-tested',
    ].join(' ');
    if (!smokeRun.output.split(/\r?\n/u).includes(expectedMarker)) {
      throw new Error('Packaged world smoke did not emit the exact delivery marker.');
    }
    const report = {
      schema_version: '1.0.0',
      document_type: 'godot-headless-smoke-report',
      passed: true,
      godot_version: godotVersion,
      world_id: inspected.worldId,
      pack_sha256: inspected.packSha256,
      runtime_artifact_sha256: runtimeArtifactSha256,
    };
    const receipt = {
      schema_version: '1.0.0',
      document_type: 'world-runner-pck-build-receipt',
      world_id: inspected.worldId,
      profile: inspected.profile,
      pack_sha256: inspected.packSha256,
      manifest_sha256: inspected.manifestSha256,
      runtime_artifact: {
        kind: 'godot-pck',
        target_runtime_architecture: 'arm64',
        bytes: pckBytes.byteLength,
        sha256: runtimeArtifactSha256,
      },
      build_host: {
        godot_version: godotVersion,
        platform: process.platform,
        architecture: process.arch,
      },
      physical_raspberry_pi_tested: false,
    };
    await writeExclusiveOrIdentical(pckPath, pckBytes, 'PCK');
    await writeExclusiveOrIdentical(
      reportPath,
      Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8'),
      'smoke report',
    );
    await writeExclusiveOrIdentical(
      receiptPath,
      Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
      'build receipt',
    );
    return Object.freeze({ report, receipt, pckPath, reportPath, receiptPath });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
