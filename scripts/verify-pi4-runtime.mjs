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
const PRODUCTION_WORLD_ID = 'layered-depth-2d-production-v1';
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

async function main() {
  const archivePath = resolve(option(
    'archive',
    join(ROOT, 'release', 'pi4-runtime', `${PACKAGE_ROOT}.zip`),
  ));
  const expectedWorldSetPath = option('extra-world-set', '');
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
    || manifest?.shell?.default_world_id !== 'alpha12-godot-smoke-pack') {
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
  const productionWorld = worlds.find((world) => world.id === PRODUCTION_WORLD_ID);
  if (expectedWorldSetPath) {
    if (!productionWorld
      || manifest.bundle_status !== 'internal-review'
      || productionWorld.profile !== 'layered-depth-2d'
      || productionWorld.distribution !== 'internal-review'
      || productionWorld.output_license !== 'UNRELEASED'
      || productionWorld.standard_pack !== false
      || productionWorld.runtime_kind !== 'trusted-controlled-scene'
      || !Array.isArray(productionWorld.files)
      || productionWorld.files.length !== 16) {
      fail('controlled production world boundary mismatch');
    }
    const expectedWorldSet = JSON.parse(await readFile(resolve(expectedWorldSetPath), 'utf8'));
    const expectedTargets = new Map(expectedWorldSet.files.map((record) => [
      `project/mapsoo_imports/${PRODUCTION_WORLD_ID}/${record.target}`,
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
    if (productionWorld.files.filter((record) =>
      record.path.includes('/assets/layer-') && record.path.endsWith('.png')).length !== 8) {
      fail('production world does not contain exactly eight runtime layers');
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
    ? [...BASE_WORLD_IDS, PRODUCTION_WORLD_ID]
    : BASE_WORLD_IDS;
  if (!launcher.includes(`${expectedIds.join('|')}) ;;`)
    || !launcher.includes('Unknown bundled world:')
    || !launcher.includes('res://mapsoo_imports/$world_id/$world_id.world.tscn')
    || launcher.includes('eval ')) {
    fail('launcher allowlist or exact scene resolution changed');
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
