#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
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
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  buildWorldRunnerPck,
  inspectWorldRunnerPckInput,
} from './lib/world-runner-pck.mjs';
import { parsePi4Metrics } from './lib/pi4-physical-acceptance.mjs';

const WORLD_ID = 'ci-world';
const PROFILE = 'side-platformer';
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
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

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function characterFixture() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const atlas = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const actions = ['idle', 'run', 'jump', 'fall', 'land', 'hurt'];
  const directions = ['left', 'right'];
  const revision = {
    schema_version: '1.0.0',
    document_type: 'character-profile-revision',
    profile_revision_id: 'ci-character-side-platformer',
    character_id: 'ci-character',
    profile: PROFILE,
    atlas: {
      path: 'characters/ci-character.png',
      media_type: 'image/png',
      bytes: atlas.byteLength,
      sha256: sha256(atlas),
      width: 1,
      height: 1,
    },
    frame_geometry: {
      frame_width: 1,
      frame_height: 1,
      columns: 1,
      rows: 1,
    },
    pivot: { x: 0, y: 0, unit: 'pixels' },
    clips: actions.flatMap((action) => directions.map((direction) => ({
      clip_id: `${action}.${direction}`,
      action,
      direction,
      fps: 8,
      loop: action === 'idle' || action === 'run',
      frames: [{ column: 0, row: 0 }],
    }))),
    source_identity: {
      identity_digest_sha256: 'c'.repeat(64),
      source_reference_ids: ['ci-character-reference'],
    },
    rights: {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    },
  };
  return {
    atlas,
    revision: Buffer.from(`${JSON.stringify(revision, null, 2)}\n`, 'utf8'),
  };
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
      + `metadata/mapsoo_profile = "${PROFILE}"\n\n`
      + '[node name="PlayerSpawn" type="Marker2D" parent="."]\n\n'
      + '[node name="Player" type="Node2D" parent="."]\n\n'
      + '[node name="Visual" type="AnimatedSprite2D" parent="Player"]\n'
      + 'metadata/mapsoo_runtime_slot_id = "player"\n',
    'utf8',
  );
  const tilesetBytes = Buffer.from('[gd_resource type="TileSet" format=3]\n', 'utf8');
  const sceneName = `${WORLD_ID}.world.tscn`;
  const tilesetName = `${WORLD_ID}.tileset.tres`;
  const core = {
    schema_version: '1.0.0',
    importer: {
      id: 'mapsoo_importer',
      version: options.importerVersion ?? '0.1.0-alpha.10+fixture.1',
    },
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
  if (options.character) {
    const character = join(bundle, 'character');
    await mkdir(character, { recursive: true });
    const fixture = characterFixture();
    await Promise.all([
      writeFile(
        join(character, 'character-profile-revision.json'),
        fixture.revision,
      ),
      writeFile(
        join(character, 'character-profile-atlas.png'),
        fixture.atlas,
      ),
    ]);
  }
  return {
    bundle,
    imported,
    pack: join(bundle, 'world.zip'),
    characterRevision: join(bundle, 'character', 'character-profile-revision.json'),
    characterAtlas: join(bundle, 'character', 'character-profile-atlas.png'),
  };
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

async function verifyInteractiveReady(godotBin, pckPath, arguments_, expectedMarker) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(godotBin, [
      '--headless',
      '--main-pack', pckPath,
      '--',
      ...arguments_,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let ready = false;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Interactive World Runner readiness timed out: ${output}`));
    }, 15_000);
    const consume = (chunk) => {
      output += chunk.toString('utf8');
      if (ready || !output.split(/\r?\n/u).includes(expectedMarker)) return;
      ready = true;
      setTimeout(() => {
        if (child.exitCode !== null) {
          clearTimeout(timeout);
          reject(new Error('Interactive World Runner exited after its readiness marker.'));
          return;
        }
        child.kill();
        clearTimeout(timeout);
        resolvePromise();
      }, 250);
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      if (ready) return;
      clearTimeout(timeout);
      reject(new Error(`Interactive World Runner exited before readiness (${code}): ${output}`));
    });
  });
}

async function verifyLaunchRejected(
  godotBin,
  pckPath,
  arguments_,
  expectedFailure,
) {
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(godotBin, [
      '--headless',
      '--main-pack', pckPath,
      '--',
      ...arguments_,
      '--delivery-smoke=true',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let combined = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Mismatched launch-binding rejection timed out.'));
    }, 15_000);
    const consume = (chunk) => {
      combined += chunk.toString('utf8');
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (
        code === 0
        || !combined.includes(expectedFailure)
        || combined.includes('MAPSOO_WORLD_RUNNER_PCK_OK')
      ) {
        reject(new Error(`Invalid launch binding did not fail closed: ${combined}`));
        return;
      }
      resolvePromise(combined);
    });
  });
  return output;
}

async function verifyMetricsProbe(godotBin, pckPath, arguments_) {
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(godotBin, [
      '--headless',
      '--main-pack', pckPath,
      '--',
      ...arguments_,
      '--physical-acceptance-seconds=30',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let combined = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Desktop metrics-probe exercise timed out.'));
    }, 45_000);
    const consume = (chunk) => {
      combined += chunk.toString('utf8');
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Desktop metrics-probe exercise exited ${code}: ${combined}`));
        return;
      }
      resolvePromise(combined);
    });
  });
  const metrics = parsePi4Metrics(output);
  if (metrics.observation_ms < 30_000 || metrics.frames < 1) {
    throw new Error('Desktop metrics-probe exercise did not cover its observation window.');
  }
  return metrics;
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'mapsoo-world-runner-pck-'));
  try {
    const valid = await writeFixture(root, { name: 'valid', character: true });
    const inspected = await inspectWorldRunnerPckInput({
      bundleRoot: valid.bundle,
      worldPackPath: valid.pack,
      importedWorldDir: valid.imported,
      worldId: WORLD_ID,
    });
    if (inspected.profile !== PROFILE || inspected.managed.state.cell_count !== 1) {
      throw new Error('Valid managed input inspection did not preserve its exact binding.');
    }
    for (const [index, importerVersion] of [
      '1.0.0-',
      '1.0.0-01',
      '1.0.0-alpha.01',
      '1.0.0-alpha..1',
      '1.0.0-any string',
      '01.0.0',
      '1.0.0+',
      '1.0.0+build..1',
    ].entries()) {
      const invalidVersion = await writeFixture(root, {
        name: `invalid-importer-version-${index}`,
        importerVersion,
      });
      await rejects(() => inspectWorldRunnerPckInput({
        bundleRoot: invalidVersion.bundle,
        worldPackPath: invalidVersion.pack,
        importedWorldDir: invalidVersion.imported,
        worldId: WORLD_ID,
      }), 'Importer state');
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
    const wrongCharacter = await writeFixture(root, {
      name: 'wrong-character',
      character: true,
    });
    const changedRevision = JSON.parse(
      await readFile(wrongCharacter.characterRevision, 'utf8'),
    );
    changedRevision.profile = 'topdown-farm';
    await writeFile(
      wrongCharacter.characterRevision,
      `${JSON.stringify(changedRevision, null, 2)}\n`,
    );
    await rejects(() => inspectWorldRunnerPckInput({
      bundleRoot: wrongCharacter.bundle,
      worldPackPath: wrongCharacter.pack,
      importedWorldDir: wrongCharacter.imported,
      worldId: WORLD_ID,
      characterRevisionPath: wrongCharacter.characterRevision,
      characterAtlasPath: wrongCharacter.characterAtlas,
    }), 'does not match the world');
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
        characterRevisionPath: valid.characterRevision,
        characterAtlasPath: valid.characterAtlas,
        spawnId: 'world-entry',
        playerSlotId: 'player-one',
        godotBin,
        pckPath: join(valid.bundle, 'runtime', `${id}.pck`),
        reportPath: join(valid.bundle, 'reports', `${id}.json`),
        receiptPath: join(valid.bundle, 'receipts', `${id}.json`),
      });
      builds.push(result);
    }
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const [receiptSchema, reportSchema] = await Promise.all([
      readFile(
        join(REPOSITORY_ROOT, 'schemas', 'mapsoo-world-runner-pck-build-receipt-1.0.schema.json'),
        'utf8',
      ).then(JSON.parse),
      readFile(
        join(REPOSITORY_ROOT, 'schemas', 'mapsoo-godot-headless-smoke-report-1.0.schema.json'),
        'utf8',
      ).then(JSON.parse),
    ]);
    const validateReceipt = ajv.compile(receiptSchema);
    const validateReport = ajv.compile(reportSchema);
    for (const build of builds) {
      if (!validateReceipt(build.receipt)) {
        throw new Error(`PCK build receipt failed schema: ${ajv.errorsText(validateReceipt.errors)}`);
      }
      if (!validateReport(build.report)) {
        throw new Error(`PCK smoke report failed schema: ${ajv.errorsText(validateReport.errors)}`);
      }
    }
    const firstBytes = await readFile(builds[0].pckPath);
    const secondBytes = await readFile(builds[1].pckPath);
    if (sha256(firstBytes) !== sha256(secondBytes)
        || builds[0].report.runtime_artifact_sha256 !== sha256(firstBytes)
        || builds[0].receipt.runtime_artifact.target_runtime_architecture !== 'arm64'
        || builds[0].receipt.launch_binding.status !== 'bound'
        || builds[0].receipt.launch_binding.spawn_id !== 'world-entry'
        || builds[0].receipt.launch_binding.player_slot_id !== 'player-one'
        || builds[0].report.launch_binding.status !== 'bound'
        || builds[0].report.launch_binding.spawn_id !== 'world-entry'
        || builds[0].report.launch_binding.player_slot_id !== 'player-one'
        || builds[0].receipt.character_binding.embedded !== true
        || builds[0].report.character_binding.status !== 'bound'
        || builds[0].receipt.physical_raspberry_pi_tested !== false) {
      throw new Error('PCK reproducibility or evidence binding failed.');
    }
    const binding = builds[0].receipt.character_binding;
    await verifyInteractiveReady(
      godotBin,
      builds[0].pckPath,
      [
        `--world-id=${WORLD_ID}`,
        `--pack-sha256=${inspected.packSha256}`,
        '--spawn-id=world-entry',
        '--player-slot-id=player-one',
        `--character-revision-id=${binding.profile_revision_id}`,
        `--character-revision-sha256=${binding.revision_sha256}`,
      ],
      [
        'MAPSOO_WORLD_RUNNER_READY',
        `world_id=${WORLD_ID}`,
        `pack_sha256=${inspected.packSha256}`,
        `profile=${PROFILE}`,
        `scene=res://mapsoo_imports/${WORLD_ID}/${WORLD_ID}.world.tscn`,
        'launch_binding=bound',
        'spawn_id=world-entry',
        'player_slot_id=player-one',
        'character_binding=bound',
        `character_revision_id=${binding.profile_revision_id}`,
        `character_revision_sha256=${binding.revision_sha256}`,
        'physical_raspberry_pi=not-tested',
      ].join(' '),
    );
    const embeddedLaunchMarker = [
      'MAPSOO_WORLD_RUNNER_READY',
      `world_id=${WORLD_ID}`,
      `pack_sha256=${inspected.packSha256}`,
      `profile=${PROFILE}`,
      `scene=res://mapsoo_imports/${WORLD_ID}/${WORLD_ID}.world.tscn`,
      'launch_binding=bound',
      'spawn_id=world-entry',
      'player_slot_id=player-one',
      'character_binding=bound',
      `character_revision_id=${binding.profile_revision_id}`,
      `character_revision_sha256=${binding.revision_sha256}`,
      'physical_raspberry_pi=not-tested',
    ].join(' ');
    await verifyInteractiveReady(
      godotBin,
      builds[0].pckPath,
      [
        `--world-id=${WORLD_ID}`,
        `--pack-sha256=${inspected.packSha256}`,
        `--character-revision-id=${binding.profile_revision_id}`,
        `--character-revision-sha256=${binding.revision_sha256}`,
      ],
      embeddedLaunchMarker,
    );
    await verifyLaunchRejected(
      godotBin,
      builds[0].pckPath,
      [
        `--world-id=${WORLD_ID}`,
        `--pack-sha256=${inspected.packSha256}`,
        '--spawn-id=wrong-entry',
        '--player-slot-id=player-one',
        `--character-revision-id=${binding.profile_revision_id}`,
        `--character-revision-sha256=${binding.revision_sha256}`,
      ],
      'Requested launch binding does not match the embedded binding.',
    );
    await verifyLaunchRejected(
      godotBin,
      builds[0].pckPath,
      [
        `--world-id=${WORLD_ID}`,
        `--pack-sha256=${inspected.packSha256}`,
        '--spawn-id=world-entry',
        '--spawn-id=world-entry',
        '--player-slot-id=player-one',
        '--player-slot-id=player-one',
        `--character-revision-id=${binding.profile_revision_id}`,
        `--character-revision-sha256=${binding.revision_sha256}`,
      ],
      'Spawn ID and player slot ID arguments must be supplied together exactly once.',
    );
    const exercisedMetrics = process.argv.includes('--exercise-metrics')
      ? await verifyMetricsProbe(
        godotBin,
        builds[0].pckPath,
        [
          `--world-id=${WORLD_ID}`,
          `--pack-sha256=${inspected.packSha256}`,
          '--spawn-id=world-entry',
          '--player-slot-id=player-one',
          `--character-revision-id=${binding.profile_revision_id}`,
          `--character-revision-sha256=${binding.revision_sha256}`,
        ],
      )
      : null;
    process.stdout.write(
      `MAPSOO_WORLD_RUNNER_PCK_GODOT_OK version=${builds[0].report.godot_version}`
      + ` bytes=${firstBytes.byteLength} sha256=${sha256(firstBytes)}`
      + ' reproducible=true launch_binding=custom-bound'
      + ' launch_fallback=true launch_mismatch_rejected=true'
      + ' launch_duplicate_rejected=true'
      + ' character_binding=bound interactive_ready=true'
      + ` metrics_probe=${exercisedMetrics ? 'exercised-on-build-host' : 'not-requested'}`
      + ' target_runtime=arm64 physical_raspberry_pi=false\n',
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
