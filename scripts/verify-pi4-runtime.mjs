#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';
import { containsPrivateConsumerToken } from './lib/private-consumer-boundary.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PACKAGE_ROOT = 'mapsoo-pi4-arm64-alpha12';
const BASE_WORLD_IDS = [
  'alpha9-godot-smoke-pack',
  'alpha10-godot-smoke-pack',
  'alpha11-godot-smoke-pack',
  'alpha12-godot-smoke-pack',
];
const TEXT_SUFFIXES = ['.cfg', '.gd', '.json', '.md', '.sh', '.tscn', '.tres'];

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  throw new Error(`Pi runtime verification failed: ${message}`);
}

function verifyPortableText(path, bytes) {
  if (!TEXT_SUFFIXES.some((suffix) => path.endsWith(suffix))) return;
  const text = Buffer.from(bytes).toString('utf8');
  if (/(?:^|[^A-Za-z0-9])(?:[A-Za-z]:(?:\/|\\(?![nrtbfv0xu]))|\/Users\/|\/home\/)/u.test(text)) {
    fail(`absolute local path found in ${path}`);
  }
  if (containsPrivateConsumerToken(text)) {
    fail(`private consumer name found in ${path}`);
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

async function verifyManagedImport(productionWorld, expectedWorldSet, byPath) {
  const worldId = expectedWorldSet.id;
  const sceneName = `${worldId}.world.tscn`;
  const tilesetName = `${worldId}.tileset.tres`;
  const stateName = 'mapsoo.import-state.json';
  const prefix = `project/mapsoo_imports/${worldId}/`;
  const exactTargets = [sceneName, tilesetName, stateName];
  const records = new Map(productionWorld.files.map((record) => [
    record.path.slice(prefix.length),
    record,
  ]));
  if (records.size !== exactTargets.length
    || exactTargets.some((target) => !records.has(target))) {
    fail('importer-managed world does not contain exactly its three managed files');
  }
  const bytesFor = async (target) => {
    const record = records.get(target);
    const entry = byPath.get(`${PACKAGE_ROOT}/${record.path}`);
    if (!entry) fail(`importer-managed archive file is missing: ${target}`);
    return entry.async('uint8array');
  };
  const sceneBytes = await bytesFor(sceneName);
  const tilesetBytes = await bytesFor(tilesetName);
  const stateBytes = await bytesFor(stateName);
  let state;
  try {
    state = JSON.parse(Buffer.from(stateBytes).toString('utf8'));
  } catch (error) {
    fail(`importer-managed state is invalid JSON: ${error.message}`);
  }
  const sourcePack = expectedWorldSet.source_pack;
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
  if (!sourcePack
    || sourcePack.schema_version !== '1.0.0-draft.1'
    || sourcePack.importer_version !== '1.0.0'
    || sourcePack.godot_serialization !== '4.3'
    || !/^[0-9a-f]{64}$/u.test(sourcePack.candidate_sha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(sourcePack.manifest_sha256 ?? '')
    || JSON.stringify(Object.keys(state ?? {}).sort()) !== JSON.stringify(expectedStateKeys)
    || state.schema_version !== '1.0.0'
    || state.pack_id !== worldId
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
    || generatedFiles[sceneName] !== digest(sceneBytes)
    || generatedFiles[tilesetName] !== digest(tilesetBytes)) {
    fail('importer-managed state or source-pack binding is invalid');
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
    !== digest(new TextEncoder().encode(JSON.stringify(canonicalJson(stateCore))))) {
    fail('importer-managed state integrity digest is invalid');
  }
  const sceneText = Buffer.from(sceneBytes).toString('utf8');
  const resourcePaths = [...sceneText.matchAll(/path="(res:\/\/[^"]+)"/gu)]
    .map((match) => match[1]);
  const requiredMetadata = [
    `metadata/mapsoo_pack_id = "${worldId}"`,
    'metadata/mapsoo_profile = "layered-depth-2d"',
    'metadata/mapsoo_schema_version = "1.0.0-draft.1"',
    'metadata/mapsoo_distribution = "internal-review"',
    'metadata/mapsoo_output_license = "LicenseRef-UNRELEASED"',
    'metadata/mapsoo_authorization_grant = "pi4-pack10-review-prepare"',
    'metadata/mapsoo_data_only = true',
  ];
  const tilesetText = Buffer.from(tilesetBytes).toString('utf8');
  if (resourcePaths.length === 0
    || resourcePaths.some((path) =>
      !path.startsWith('res://addons/mapsoo_importer/runtime/'))
    || /(?:uid:\/\/|https?:\/\/|file:\/\/|\.\.|\\)/u.test(sceneText)
    || /path="res:\/\//u.test(tilesetText)
    || /(?:uid:\/\/|https?:\/\/|file:\/\/|\.\.|\\)/u.test(tilesetText)
    || requiredMetadata.some((record) => !sceneText.includes(record))) {
    fail('importer-managed scene metadata is incomplete');
  }
}

async function main() {
  const archivePath = resolve(option(
    'archive',
    join(ROOT, 'release', 'pi4-runtime', `${PACKAGE_ROOT}.zip`),
  ));
  const expectedWorldSetPath = option('extra-world-set', '');
  const expectedWorldSet = expectedWorldSetPath
    ? JSON.parse(await readFile(resolve(expectedWorldSetPath), 'utf8'))
    : null;
  const archiveBytes = await readFile(archivePath);
  const archive = await JSZip.loadAsync(archiveBytes);
  const files = Object.values(archive.files).filter((entry) => !entry.dir);
  const byPath = new Map(files.map((entry) => [entry.name, entry]));
  const requiredCore = [
    `${PACKAGE_ROOT}/godot`,
    `${PACKAGE_ROOT}/run-mapsoo.sh`,
    `${PACKAGE_ROOT}/README.md`,
    `${PACKAGE_ROOT}/runtime-manifest.json`,
  ];
  for (const path of requiredCore) {
    if (!byPath.has(path)) fail(`missing ${path}`);
  }
  if (files.some((entry) => !entry.name.startsWith(`${PACKAGE_ROOT}/`)
    || entry.name.includes('\\')
    || entry.name.includes('../')
    || entry.name.endsWith('.uid')
    || entry.name.endsWith('.import'))) {
    fail('archive contains an unsafe or non-portable path');
  }

  const runtimeBytes = await byPath.get(`${PACKAGE_ROOT}/godot`).async('uint8array');
  const runtimeHeader = Buffer.from(
    runtimeBytes.buffer,
    runtimeBytes.byteOffset,
    runtimeBytes.byteLength,
  );
  if (!runtimeHeader.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    || runtimeHeader.readUInt16LE(18) !== 183) {
    fail('Godot executable is not ELF AArch64');
  }

  const manifestBytes = await byPath
    .get(`${PACKAGE_ROOT}/runtime-manifest.json`)
    .async('uint8array');
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  if (manifest?.schema_version !== '1.0.0'
    || manifest?.target?.architecture !== 'arm64'
    || manifest?.target?.renderer !== 'gl_compatibility'
    || manifest?.runtime?.version !== '4.3-stable'
    || manifest?.runtime?.executable_sha256 !== digest(runtimeBytes)
    || manifest?.shell?.default_world_id !== 'alpha12-godot-smoke-pack'
    || manifest?.shell?.optional_character_profile?.root
      !== 'project/mapsoo_characters/<profile-revision-id>/'
    || manifest?.shell?.optional_character_profile?.revision
      !== 'character-profile-revision.json'
    || manifest?.shell?.optional_character_profile?.atlas
      !== 'character-profile-atlas.png'
    || JSON.stringify(manifest?.shell?.optional_character_profile?.launch_arguments)
      !== JSON.stringify(['profile-revision-id', 'revision-sha256'])) {
    fail('runtime manifest core contract mismatch');
  }

  const projectInventory = manifest.project_files;
  if (!Array.isArray(projectInventory) || projectInventory.length === 0) {
    fail('project inventory is missing');
  }
  const expectedArchivePaths = new Set(requiredCore);
  for (const record of projectInventory) {
    const archiveEntryPath = `${PACKAGE_ROOT}/${record.path}`;
    expectedArchivePaths.add(archiveEntryPath);
    const entry = byPath.get(archiveEntryPath);
    if (!entry) fail(`inventory file is missing: ${record.path}`);
    const bytes = await entry.async('uint8array');
    if (bytes.byteLength !== record.bytes || digest(bytes) !== record.sha256) {
      fail(`inventory digest mismatch: ${record.path}`);
    }
    verifyPortableText(record.path, bytes);
  }
  if (files.length !== expectedArchivePaths.size
    || files.some((entry) => !expectedArchivePaths.has(entry.name))) {
    fail('archive file set is not exactly represented by the manifest');
  }

  const worlds = manifest.worlds;
  if (!Array.isArray(worlds)
    || worlds.slice(0, BASE_WORLD_IDS.length).some((world, index) =>
      world.id !== BASE_WORLD_IDS[index]
      || world.scene_path !== `res://mapsoo_imports/${world.id}/${world.id}.world.tscn`)) {
    fail('four synthetic compatibility worlds changed');
  }
  const productionWorld = expectedWorldSet
    ? worlds.find((world) => world.id === expectedWorldSet.id)
    : null;
  if (expectedWorldSetPath) {
    if (!productionWorld
      || manifest.bundle_status !== 'internal-review'
      || productionWorld.profile !== expectedWorldSet.profile
      || productionWorld.distribution !== expectedWorldSet.distribution
      || productionWorld.output_license !== expectedWorldSet.output_license
      || productionWorld.standard_pack !== false
      || productionWorld.runtime_kind !== expectedWorldSet.runtime_kind
      || !Array.isArray(productionWorld.files)
      || productionWorld.files.length !== expectedWorldSet.files.length) {
      fail('controlled production world boundary mismatch');
    }
    const expectedTargets = new Map(expectedWorldSet.files.map((record) => [
      `project/mapsoo_imports/${expectedWorldSet.id}/${record.target}`,
      record,
    ]));
    for (const record of productionWorld.files) {
      const expected = expectedTargets.get(record.path);
      if (!expected || expected.bytes !== record.bytes || expected.sha256 !== record.sha256) {
        fail(`production world inventory mismatch: ${record.path}`);
      }
      if (record.path.endsWith('.gd') || record.path.endsWith('.shader')) {
        fail('generated production world supplied executable code');
      }
    }
    if (expectedWorldSet.runtime_kind === 'trusted-controlled-scene') {
      if (productionWorld.files.length !== 16
        || productionWorld.files.filter((record) =>
          record.path.includes('/assets/layer-') && record.path.endsWith('.png')).length !== 8) {
        fail('trusted production world does not contain its exact legacy inventory');
      }
    } else if (expectedWorldSet.runtime_kind === 'importer-managed-scene') {
      if (JSON.stringify(productionWorld.source_pack)
          !== JSON.stringify(expectedWorldSet.source_pack)) {
        fail('importer-managed source-pack record changed');
      }
      await verifyManagedImport(productionWorld, expectedWorldSet, byPath);
    } else {
      fail('unknown controlled production runtime kind');
    }
  } else if (productionWorld || manifest.bundle_status !== 'synthetic-fixture'
    || worlds.length !== BASE_WORLD_IDS.length) {
    fail('default bundle no longer contains exactly four synthetic worlds');
  }

  const launcherBytes = await byPath
    .get(`${PACKAGE_ROOT}/run-mapsoo.sh`)
    .async('uint8array');
  const launcher = Buffer.from(launcherBytes).toString('utf8');
  const expectedIds = expectedWorldSetPath
    ? [...BASE_WORLD_IDS, expectedWorldSet.id]
    : BASE_WORLD_IDS;
  if (!launcher.includes(`${expectedIds.join('|')}) ;;`)
    || !launcher.includes('Unknown bundled world:')
    || !launcher.includes('res://mapsoo_imports/$world_id/$world_id.world.tscn')
    || !launcher.includes('^[a-z0-9]+(-[a-z0-9]+)*$')
    || !launcher.includes('^[a-f0-9]{64}$')
    || !launcher.includes('res://mapsoo_characters/$character_revision_id')
    || !launcher.includes('character-profile-revision.json')
    || !launcher.includes('character-profile-atlas.png')
    || !launcher.includes('--mapsoo-character-revision-sha256=$character_revision_sha256')
    || launcher.includes('eval ')) {
    fail('launcher world/character allowlist or exact resource resolution changed');
  }
  verifyPortableText('run-mapsoo.sh', launcherBytes);
  verifyPortableText('runtime-manifest.json', manifestBytes);

  const sidecar = JSON.parse(await readFile(`${archivePath}.json`, 'utf8'));
  if (sidecar.sha256 !== digest(archiveBytes)
    || sidecar.worlds !== expectedIds.length
    || JSON.stringify(sidecar.world_ids) !== JSON.stringify(expectedIds)
    || sidecar.bundle_status !== manifest.bundle_status) {
    fail('archive sidecar mismatch');
  }

  console.log(
    `MAPSOO_PI4_RUNTIME_VERIFY_OK path=${archivePath} sha256=${sidecar.sha256}`
      + ` worlds=${worlds.length} files=${files.length} status=${manifest.bundle_status}`,
  );
}

await main();
