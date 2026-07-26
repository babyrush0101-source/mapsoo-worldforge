#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
import { containsPrivateConsumerToken } from './lib/private-consumer-boundary.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
const RUNTIME_VERSION = '4.3-stable';
const RUNTIME_ARCHIVE = 'Godot_v4.3-stable_linux.arm64.zip';
const RUNTIME_SHA512 = 'bf559c7d24f2a7c8980d021c9e8c54baa66c5f3a1a0c1fb6fe73586eca63417fd365adf2e6c8be0b5944ab80da800fe4aa3a9024f58363f5dc3962e6127c0dc6';
const PACKAGE_ROOT = 'mapsoo-pi4-arm64-alpha12';
const BASE_WORLD_IDS = Object.freeze([
  'alpha9-godot-smoke-pack',
  'alpha10-godot-smoke-pack',
  'alpha11-godot-smoke-pack',
  'alpha12-godot-smoke-pack',
]);
const SAFE_WORLD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_EXTRA_SUFFIXES = new Set(['.json', '.png', '.tscn', '.tres']);
const TEXT_SUFFIXES = new Set(['.cfg', '.gd', '.json', '.md', '.tscn', '.tres']);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const sourceRuntimeZip = resolve(option(
  'runtime-zip',
  join(ROOT, 'release', 'godot-runtimes', RUNTIME_ARCHIVE),
));
const outputZip = resolve(option(
  'out',
  join(ROOT, 'release', 'pi4-runtime', `${PACKAGE_ROOT}.zip`),
));
const extraWorldSetPath = option('extra-world-set', '');

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest('hex');
}

function portable(path) {
  return path.split(sep).join('/');
}

function extension(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index).toLowerCase();
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')
    || isAbsolute(value) || value.startsWith('/') || value.includes('\0')) {
    return false;
  }
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function assertInsideRoot(path, label) {
  const fromRoot = relative(ROOT, path);
  if (fromRoot === '' || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    throw new Error(`${label} must resolve to a file inside the repository.`);
  }
}

function assertPortableText(path, bytes) {
  if (!TEXT_SUFFIXES.has(extension(path))) return;
  const text = Buffer.from(bytes).toString('utf8');
  if (/(?:^|[^A-Za-z0-9])(?:[A-Za-z]:(?:\/|\\(?![nrtbfv0xu]))|\/Users\/|\/home\/)/u.test(text)) {
    throw new Error(`Runtime text contains an absolute local path: ${path}`);
  }
  if (containsPrivateConsumerToken(text)) {
    throw new Error(`Runtime text crosses the private consumer boundary: ${path}`);
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

function validateManagedImport(manifest, byTarget) {
  const sceneName = `${manifest.id}.world.tscn`;
  const tilesetName = `${manifest.id}.tileset.tres`;
  const stateName = 'mapsoo.import-state.json';
  const exactTargets = [sceneName, tilesetName, stateName];
  if (byTarget.size !== exactTargets.length
    || exactTargets.some((target) => !byTarget.has(target))) {
    throw new Error('Importer-managed world-set must contain exactly scene, TileSet and import state.');
  }
  const sourcePack = manifest.source_pack;
  if (!sourcePack
    || !/^[0-9a-f]{64}$/u.test(sourcePack.candidate_sha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(sourcePack.manifest_sha256 ?? '')
    || sourcePack.schema_version !== '1.0.0-draft.1'
    || sourcePack.importer_version !== '1.0.0'
    || sourcePack.godot_serialization !== '4.3') {
    throw new Error('Importer-managed world-set source binding is invalid.');
  }
  let state;
  try {
    state = JSON.parse(Buffer.from(byTarget.get(stateName).bytes).toString('utf8'));
  } catch (error) {
    throw new Error(`Unable to parse importer-managed state: ${error.message}`);
  }
  const expectedStateKeys = [
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
  const generatedFiles = state?.generated_files;
  if (JSON.stringify(Object.keys(state ?? {}).sort()) !== JSON.stringify(expectedStateKeys)
    || state.schema_version !== '1.0.0'
    || state.pack_id !== manifest.id
    || state.manifest_sha256 !== sourcePack.manifest_sha256
    || state.godot_serialization !== sourcePack.godot_serialization
    || state.importer?.id !== 'mapsoo_importer'
    || state.importer?.version !== sourcePack.importer_version
    || !Number.isSafeInteger(state.cell_count)
    || state.cell_count < 0
    || !Number.isSafeInteger(state.prop_count)
    || state.prop_count < 0
    || !generatedFiles
    || JSON.stringify(Object.keys(generatedFiles).sort())
      !== JSON.stringify([tilesetName, sceneName].sort())
    || generatedFiles[sceneName] !== digest('sha256', byTarget.get(sceneName).bytes)
    || generatedFiles[tilesetName] !== digest('sha256', byTarget.get(tilesetName).bytes)) {
    throw new Error('Importer-managed state is not bound to the exact generated resources.');
  }
  const stateCore = {
    schema_version: state.schema_version,
    importer: {
      id: state.importer.id,
      version: state.importer.version,
    },
    godot_serialization: state.godot_serialization,
    pack_id: state.pack_id,
    manifest_sha256: state.manifest_sha256,
    generated_files: generatedFiles,
    cell_count: state.cell_count,
    prop_count: state.prop_count,
  };
  if (state.integrity_sha256
    !== digest('sha256', new TextEncoder().encode(JSON.stringify(canonicalJson(stateCore))))) {
    throw new Error('Importer-managed state integrity digest is invalid.');
  }
  const sceneText = Buffer.from(byTarget.get(sceneName).bytes).toString('utf8');
  const requiredMetadata = [
    `metadata/mapsoo_pack_id = "${manifest.id}"`,
    'metadata/mapsoo_profile = "layered-depth-2d"',
    'metadata/mapsoo_schema_version = "1.0.0-draft.1"',
    'metadata/mapsoo_distribution = "internal-review"',
    'metadata/mapsoo_output_license = "LicenseRef-UNRELEASED"',
    'metadata/mapsoo_authorization_grant = "pi4-pack10-review-prepare"',
    'metadata/mapsoo_data_only = true',
  ];
  if (requiredMetadata.some((record) => !sceneText.includes(record))) {
    throw new Error('Importer-managed scene metadata is incomplete.');
  }
}

async function loadExtraWorldSet() {
  if (!extraWorldSetPath) return null;
  const manifestPath = resolve(extraWorldSetPath);
  assertInsideRoot(manifestPath, 'Extra world-set manifest');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse extra world-set manifest: ${error.message}`);
  }
  const isTrustedScene = manifest?.runtime_kind === 'trusted-controlled-scene';
  const isManagedImport = manifest?.runtime_kind === 'importer-managed-scene';
  if (manifest?.schema_version !== 'mapsoo-pi4-world-set/1.0'
    || !SAFE_WORLD_ID.test(manifest.id ?? '')
    || BASE_WORLD_IDS.includes(manifest.id)
    || manifest.profile !== 'layered-depth-2d'
    || manifest.scene_target !== `${manifest.id}.world.tscn`
    || manifest.distribution !== 'internal-review'
    || (isTrustedScene && manifest.output_license !== 'UNRELEASED')
    || (isManagedImport && manifest.output_license !== 'LicenseRef-UNRELEASED')
    || manifest.standard_pack !== false
    || (!isTrustedScene && !isManagedImport)
    || !Array.isArray(manifest.files)
    || (isTrustedScene && manifest.files.length !== 16)
    || (isManagedImport && manifest.files.length !== 3)) {
    throw new Error('Extra world-set manifest does not satisfy the controlled internal-review contract.');
  }
  const targetPaths = new Set();
  const byTarget = new Map();
  let exactSceneCount = 0;
  const entries = [];
  for (const record of manifest.files) {
    if (!safeRelativePath(record?.source) || !safeRelativePath(record?.target)
      || !SAFE_EXTRA_SUFFIXES.has(extension(record.target))
      || targetPaths.has(record.target)
      || !Number.isSafeInteger(record.bytes)
      || record.bytes < 1
      || !/^[0-9a-f]{64}$/u.test(record.sha256 ?? '')) {
      throw new Error(`Unsafe or invalid extra world file record: ${JSON.stringify(record)}`);
    }
    if (/\.(?:gd|gdshader|shader|cs|dll|so)$/iu.test(record.target)) {
      throw new Error(`Generated world data cannot provide executable code: ${record.target}`);
    }
    targetPaths.add(record.target);
    if (record.target === manifest.scene_target) exactSceneCount += 1;
    const sourcePath = resolve(ROOT, record.source);
    assertInsideRoot(sourcePath, `Extra world source ${record.source}`);
    const bytes = await readFile(sourcePath);
    if (bytes.byteLength !== record.bytes || digest('sha256', bytes) !== record.sha256) {
      throw new Error(`Extra world source does not match its frozen inventory: ${record.source}`);
    }
    if (record.target.endsWith('.tscn')) {
      const sceneText = Buffer.from(bytes).toString('utf8');
      const resourcePaths = [...sceneText.matchAll(/path="(res:\/\/[^"]+)"/gu)].map((match) => match[1]);
      if (resourcePaths.length === 0
        || resourcePaths.some((path) => !path.startsWith('res://addons/mapsoo_importer/runtime/'))
        || /(?:uid:\/\/|https?:\/\/|file:\/\/|\.\.|\\)/u.test(sceneText)) {
        throw new Error(`Controlled scene has an untrusted resource reference: ${record.source}`);
      }
    }
    if (record.target.endsWith('.tres')) {
      const resourceText = Buffer.from(bytes).toString('utf8');
      if (/path="res:\/\//u.test(resourceText)
        || /(?:uid:\/\/|https?:\/\/|file:\/\/|\.\.|\\)/u.test(resourceText)) {
        throw new Error(`Controlled TileSet has an untrusted resource reference: ${record.source}`);
      }
    }
    entries.push({
      path: `project/mapsoo_imports/${manifest.id}/${record.target}`,
      bytes,
    });
    byTarget.set(record.target, { bytes, source: record.source });
  }
  if (exactSceneCount !== 1) {
    throw new Error('Extra world-set must provide exactly one canonical world scene.');
  }
  if (isTrustedScene) {
    const requiredTargets = [
      'manifests/layers.json',
      'manifests/props.json',
      'manifests/player.json',
      'manifests/npc.json',
      'assets/props.png',
      'assets/player.png',
      'assets/npc.png',
    ];
    if (requiredTargets.some((target) => !targetPaths.has(target))
      || [...targetPaths].filter((target) => target.startsWith('assets/layer-')).length !== 8) {
      throw new Error('Extra layered production world is missing its exact manifests or art inventory.');
    }
  } else {
    validateManagedImport(manifest, byTarget);
  }
  return {
    manifest,
    entries,
    world: {
      id: manifest.id,
      profile: manifest.profile,
      scene_path: `res://mapsoo_imports/${manifest.id}/${manifest.scene_target}`,
      runtime_kind: manifest.runtime_kind,
      distribution: manifest.distribution,
      output_license: manifest.output_license,
      standard_pack: false,
      source_evidence_status: manifest.source_evidence?.status ?? 'runtime-candidate',
      source_pack: manifest.source_pack,
      not_accepted_for: manifest.not_accepted_for,
      files: entries.map(({ path, bytes }) => ({
        path,
        bytes: bytes.byteLength,
        sha256: digest('sha256', bytes),
      })),
    },
  };
}

async function filesUnder(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && !entry.name.endsWith('.uid') && !entry.name.endsWith('.import')) output.push(fullPath);
    }
  }
  await visit(root);
  return output;
}

async function addFile(archive, path, bytes, executable = false) {
  archive.file(`${PACKAGE_ROOT}/${path}`, bytes, {
    binary: true,
    createFolders: false,
    date: ZIP_DATE,
    unixPermissions: executable ? 0o100755 : 0o100644,
  });
}

async function main() {
  const extraWorldSet = await loadExtraWorldSet();
  const worldIds = [
    ...BASE_WORLD_IDS,
    ...(extraWorldSet ? [extraWorldSet.manifest.id] : []),
  ];
  const worldRecords = [
    ...BASE_WORLD_IDS.map((id) => ({
      id,
      scene_path: `res://mapsoo_imports/${id}/${id}.world.tscn`,
      runtime_kind: 'importer-managed-scene',
    })),
    ...(extraWorldSet ? [extraWorldSet.world] : []),
  ];
  const runtimeArchiveBytes = await readFile(sourceRuntimeZip);
  const actualRuntimeSha512 = digest('sha512', runtimeArchiveBytes);
  if (actualRuntimeSha512 !== RUNTIME_SHA512) {
    throw new Error(`Godot ARM64 archive SHA-512 mismatch: ${actualRuntimeSha512}`);
  }
  const runtimeArchive = await JSZip.loadAsync(runtimeArchiveBytes);
  const runtimeEntries = Object.values(runtimeArchive.files).filter((entry) => !entry.dir);
  if (runtimeEntries.length !== 1) {
    throw new Error(`Expected one Godot ARM64 executable, found ${runtimeEntries.length}.`);
  }
  const runtimeBytes = await runtimeEntries[0].async('uint8array');
  const runtimeHeader = Buffer.from(runtimeBytes.buffer, runtimeBytes.byteOffset, runtimeBytes.byteLength);
  if (!runtimeHeader.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    || runtimeHeader.readUInt16LE(18) !== 183) {
    throw new Error('Godot runtime is not an ELF AArch64 executable.');
  }
  const projectFiles = [
    join(ROOT, 'godot', 'project.godot'),
    ...(await filesUnder(join(ROOT, 'godot', 'example'))),
    ...(await filesUnder(join(ROOT, 'godot', 'addons', 'mapsoo_importer'))),
  ];
  for (const worldId of BASE_WORLD_IDS) {
    projectFiles.push(...await filesUnder(join(ROOT, 'godot', 'mapsoo_imports', worldId)));
  }
  const uniqueProjectFiles = [...new Set(projectFiles)].sort((left, right) =>
    portable(relative(join(ROOT, 'godot'), left)).localeCompare(
      portable(relative(join(ROOT, 'godot'), right)),
      'en',
    ));
  const baseProjectEntries = await Promise.all(uniqueProjectFiles.map(async (path) => ({
    path: `project/${portable(relative(join(ROOT, 'godot'), path))}`,
    bytes: await readFile(path),
  })));
  const projectEntries = [
    ...baseProjectEntries,
    ...(extraWorldSet?.entries ?? []),
  ];
  const duplicateProjectPath = projectEntries.find((entry, index) =>
    projectEntries.findIndex((candidate) => candidate.path === entry.path) !== index);
  if (duplicateProjectPath) {
    throw new Error(`Duplicate runtime project path: ${duplicateProjectPath.path}`);
  }
  for (const entry of projectEntries) assertPortableText(entry.path, entry.bytes);
  const projectInventory = projectEntries.map(({ path, bytes }) => ({
    path,
    bytes: bytes.byteLength,
    sha256: digest('sha256', bytes),
  }));
  const launcher = `#!/usr/bin/env bash
set -euo pipefail
bundle_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
world_id="\${1:-alpha12-godot-smoke-pack}"
case "$world_id" in
  ${worldIds.join('|')}) ;;
  *) printf 'Unknown bundled world: %s\\n' "$world_id" >&2; exit 64 ;;
esac
exec "$bundle_dir/godot" --path "$bundle_dir/project" --mapsoo-scene="res://mapsoo_imports/$world_id/$world_id.world.tscn"
`;
  const readme = `# Mapsoo Raspberry Pi 4B ARM64 runtime

This bundle uses the official Godot ${RUNTIME_VERSION} Linux ARM64 executable and one reusable Mapsoo runtime shell.

On 64-bit Raspberry Pi OS:

\`\`\`bash
unzip ${basename(outputZip)}
cd ${PACKAGE_ROOT}
chmod +x godot run-mapsoo.sh
./run-mapsoo.sh alpha12-godot-smoke-pack
\`\`\`

Available world IDs:

${worldRecords.map((world) => `- \`${world.id}\`${world.distribution ? ` — ${world.distribution}, ${world.output_license}; not a public release` : ''}`).join('\n')}

New worlds are imported and verified before deployment, then copied into
\`project/mapsoo_imports/<world-id>/\` with their importer ownership state. The
runtime shell loads an exact generated scene path; it does not recompile the
Godot application for each world.

The controlled production candidate, when present, is for internal review only. Its
UNRELEASED assets must not be redistributed or described as a public release.
`;
  const manifest = {
    schema_version: '1.0.0',
    target: {
      device: 'Raspberry Pi 4B',
      os: '64-bit Raspberry Pi OS or compatible Linux ARM64',
      architecture: 'arm64',
      renderer: 'gl_compatibility',
    },
    runtime: {
      name: 'Godot Engine',
      version: RUNTIME_VERSION,
      upstream_archive: RUNTIME_ARCHIVE,
      upstream_url: `https://github.com/godotengine/godot-builds/releases/download/${RUNTIME_VERSION}/${RUNTIME_ARCHIVE}`,
      upstream_sha512: RUNTIME_SHA512,
      executable_sha256: digest('sha256', runtimeBytes),
    },
    shell: {
      project: 'project/project.godot',
      launcher: 'run-mapsoo.sh',
      default_world_id: 'alpha12-godot-smoke-pack',
    },
    bundle_status: extraWorldSet ? 'internal-review' : 'synthetic-fixture',
    worlds: worldRecords,
    project_files: projectInventory,
  };
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const archive = new JSZip();
  await addFile(archive, 'godot', runtimeBytes, true);
  await addFile(archive, 'run-mapsoo.sh', new TextEncoder().encode(launcher), true);
  await addFile(archive, 'README.md', new TextEncoder().encode(readme));
  await addFile(archive, 'runtime-manifest.json', manifestBytes);
  for (const entry of projectEntries) await addFile(archive, entry.path, entry.bytes);
  const bytes = await archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
  await mkdir(dirname(outputZip), { recursive: true });
  await writeFile(outputZip, bytes);
  const result = {
    path: portable(relative(ROOT, outputZip)),
    bytes: bytes.byteLength,
    sha256: digest('sha256', bytes),
    runtime_sha512: actualRuntimeSha512,
    worlds: worldIds.length,
    files: projectInventory.length + 4,
    bundle_status: manifest.bundle_status,
    world_ids: worldIds,
  };
  await writeFile(`${outputZip}.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`MAPSOO_PI4_RUNTIME_OK path=${outputZip} bytes=${result.bytes} sha256=${result.sha256} worlds=${result.worlds}`);
}

await main();
