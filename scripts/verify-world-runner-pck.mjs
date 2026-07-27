#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildWorldRunnerPck,
  inspectWorldRunnerPckInput,
} from './lib/world-runner-pck.mjs';

const WORLD_ID = 'ci-world';
const PROFILE = 'side-platformer';
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return value >>> 0;
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function singleFileZip(name, bytes) {
  const nameBytes = Buffer.from(name, 'utf8');
  const checksum = crc32(bytes);
  const local = Buffer.alloc(30 + nameBytes.byteLength);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(bytes.byteLength, 18);
  local.writeUInt32LE(bytes.byteLength, 22);
  local.writeUInt16LE(nameBytes.byteLength, 26);
  nameBytes.copy(local, 30);
  const central = Buffer.alloc(46 + nameBytes.byteLength);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(bytes.byteLength, 20);
  central.writeUInt32LE(bytes.byteLength, 24);
  central.writeUInt16LE(nameBytes.byteLength, 28);
  central.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.byteLength, 12);
  eocd.writeUInt32LE(local.byteLength + bytes.byteLength, 16);
  return Buffer.concat([local, bytes, central, eocd]);
}

async function writeFixture(root, options = {}) {
  const bundle = join(root, options.name ?? 'bundle');
  const imported = join(bundle, 'imported', WORLD_ID);
  await mkdir(imported, { recursive: true });
  const manifest = {
    schema_version: '1.0.0-draft.1',
    pack: {
      id: options.manifestWorldId ?? WORLD_ID,
      title: 'CI World',
      version: '1.0.0-test.1',
    },
    profile: PROFILE,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const packBytes = singleFileZip(
    `${WORLD_ID}/mapsoo.manifest.json`,
    manifestBytes,
  );
  await writeFile(join(bundle, 'world.zip'), packBytes);
  const extraResource = options.unsafe
    ? '\n[ext_resource type="Script" path="res://../private.gd" id="1_bad"]\n'
    : '';
  const sceneBytes = Buffer.from(
    `[gd_scene format=3]${extraResource}\n`
      + '[node name="World" type="Node2D"]\n'
      + `metadata/mapsoo_pack_id = "${WORLD_ID}"\n`
      + `metadata/mapsoo_profile = "${PROFILE}"\n`,
    'utf8',
  );
  const tilesetBytes = Buffer.from('[gd_resource type="TileSet" format=3]\n', 'utf8');
  const sceneName = `${WORLD_ID}.world.tscn`;
  const tilesetName = `${WORLD_ID}.tileset.tres`;
  const core = {
    schema_version: '1.0.0',
    importer: { id: 'mapsoo_importer', version: '1.0.0' },
    godot_serialization: '4.3',
    pack_id: WORLD_ID,
    manifest_sha256: sha256(manifestBytes),
    generated_files: {
      [sceneName]: sha256(sceneBytes),
      [tilesetName]: sha256(tilesetBytes),
    },
    cell_count: 1,
    prop_count: 0,
  };
  const state = {
    ...core,
    integrity_sha256: sha256(Buffer.from(JSON.stringify(canonical(core)), 'utf8')),
  };
  await Promise.all([
    writeFile(join(imported, sceneName), sceneBytes),
    writeFile(join(imported, tilesetName), tilesetBytes),
    writeFile(
      join(imported, 'mapsoo.import-state.json'),
      `${JSON.stringify(state, null, 2)}\n`,
    ),
  ]);
  return { bundle, imported, pack: join(bundle, 'world.zip') };
}

async function rejects(action, expected) {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return;
    throw error;
  }
  throw new Error(`Expected rejection containing: ${expected}`);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'mapsoo-world-runner-pck-'));
  try {
    const valid = await writeFixture(root, { name: 'valid' });
    const inspected = await inspectWorldRunnerPckInput({
      bundleRoot: valid.bundle,
      worldPackPath: valid.pack,
      importedWorldDir: valid.imported,
      worldId: WORLD_ID,
    });
    if (inspected.profile !== PROFILE || inspected.managed.state.cell_count !== 1) {
      throw new Error('Valid managed input inspection did not preserve its exact binding.');
    }
    const unsafe = await writeFixture(root, { name: 'unsafe', unsafe: true });
    await rejects(() => inspectWorldRunnerPckInput({
      bundleRoot: unsafe.bundle,
      worldPackPath: unsafe.pack,
      importedWorldDir: unsafe.imported,
      worldId: WORLD_ID,
    }), 'unsafe reference');
    const wrongPack = await writeFixture(root, {
      name: 'wrong-pack',
      manifestWorldId: 'other-world',
    });
    await rejects(() => inspectWorldRunnerPckInput({
      bundleRoot: wrongPack.bundle,
      worldPackPath: wrongPack.pack,
      importedWorldDir: wrongPack.imported,
      worldId: WORLD_ID,
    }), 'manifest does not match');
    const outside = join(root, 'outside.zip');
    await copyFile(valid.pack, outside);
    await rejects(() => inspectWorldRunnerPckInput({
      bundleRoot: valid.bundle,
      worldPackPath: outside,
      importedWorldDir: valid.imported,
      worldId: WORLD_ID,
    }), 'inside the bundle root');

    const godotFlag = process.argv.indexOf('--godot-bin');
    if (godotFlag < 0) {
      process.stdout.write(
        'MAPSOO_WORLD_RUNNER_PCK_STATIC_OK valid=true unsafe=true pack-binding=true containment=true\n',
      );
      return;
    }
    const godotBin = resolve(process.argv[godotFlag + 1] ?? '');
    if (!godotBin) throw new Error('--godot-bin requires a path.');
    const builds = [];
    for (const id of ['first', 'second']) {
      const result = await buildWorldRunnerPck({
        bundleRoot: valid.bundle,
        worldPackPath: valid.pack,
        importedWorldDir: valid.imported,
        worldId: WORLD_ID,
        godotBin,
        pckPath: join(valid.bundle, 'runtime', `${id}.pck`),
        reportPath: join(valid.bundle, 'reports', `${id}.json`),
        receiptPath: join(valid.bundle, 'receipts', `${id}.json`),
      });
      builds.push(result);
    }
    const firstBytes = await readFile(builds[0].pckPath);
    const secondBytes = await readFile(builds[1].pckPath);
    if (sha256(firstBytes) !== sha256(secondBytes)
        || builds[0].report.runtime_artifact_sha256 !== sha256(firstBytes)
        || builds[0].receipt.runtime_artifact.target_runtime_architecture !== 'arm64'
        || builds[0].receipt.physical_raspberry_pi_tested !== false) {
      throw new Error('PCK reproducibility or evidence binding failed.');
    }
    process.stdout.write(
      `MAPSOO_WORLD_RUNNER_PCK_GODOT_OK version=${builds[0].report.godot_version}`
      + ` bytes=${firstBytes.byteLength} sha256=${sha256(firstBytes)}`
      + ' reproducible=true target_runtime=arm64 physical_raspberry_pi=false\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(
    `world-runner-pck-verify: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
