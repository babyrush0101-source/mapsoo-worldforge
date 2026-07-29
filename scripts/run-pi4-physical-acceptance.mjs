#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  PI4_ACCEPTANCE_THRESHOLDS,
  assertPi4Performance,
  parsePi4Metrics,
} from './lib/pi4-physical-acceptance.mjs';

const FLAGS = new Set([
  '--pck',
  '--build-receipt',
  '--godot-bin',
  '--observation-seconds',
  '--out',
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_PLATFORM_VALUE = /^[A-Za-z0-9._+-]{1,64}$/u;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

function usage() {
  return [
    'Run this command on a physical Raspberry Pi 4 Model B with a 64-bit OS.',
    '',
    'node scripts/run-pi4-physical-acceptance.mjs \\',
    '  --pck <verified-world.pck> \\',
    '  --build-receipt <pck-build-receipt.json> \\',
    '  --godot-bin <linux-arm64-godot> \\',
    '  --observation-seconds <30-900> \\',
    '  --out <physical-acceptance-receipt.json>',
    '',
    'The output excludes hostname, IP address, serial number and local paths.',
  ].join('\n');
}

function options(argv) {
  const result = new Map();
  if (argv.length !== FLAGS.size * 2) throw new Error('Every acceptance flag is required once.');
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!FLAGS.has(flag)) throw new Error(`Unknown flag: ${flag}.`);
    if (!value || value.startsWith('--') || result.has(flag)) {
      throw new Error(`Invalid or duplicate value for ${flag}.`);
    }
    result.set(flag, value);
  }
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not readable JSON: ${error.message}`);
  }
}

function parseOsRelease(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z_]+)=(?:"([^"]*)"|([^"]*))$/u);
    if (match) values[match[1]] = match[2] ?? match[3];
  }
  if (!SAFE_PLATFORM_VALUE.test(values.ID ?? '')
      || !SAFE_PLATFORM_VALUE.test(values.VERSION_ID ?? '')) {
    throw new Error('OS release identity is missing or not portable.');
  }
  return { os_id: values.ID, os_version_id: values.VERSION_ID };
}

async function temperatureC() {
  const raw = (await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8')).trim();
  const value = Number(raw) / 1000;
  if (!Number.isFinite(value) || value < -20 || value > 120) {
    throw new Error('Pi thermal sensor returned an invalid value.');
  }
  return Number(value.toFixed(3));
}

async function run(command, arguments_, timeoutMs, onOutput, sampleRss = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let peakRssBytes = 0;
    const started = Date.now();
    const rssSampler = sampleRss
      ? setInterval(() => {
        readFile(`/proc/${child.pid}/status`, 'utf8').then((statusText) => {
          const match = statusText.match(/^VmRSS:\s+(\d+)\s+kB$/mu);
          if (match) peakRssBytes = Math.max(peakRssBytes, Number(match[1]) * 1024);
        }).catch(() => {});
      }, 250)
      : null;
    const timeout = setTimeout(() => {
      if (rssSampler) clearInterval(rssSampler);
      child.kill('SIGTERM');
      reject(new Error('Godot physical acceptance timed out.'));
    }, timeoutMs);
    const consume = (chunk) => {
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
        clearTimeout(timeout);
        reject(new Error('Godot physical acceptance output exceeded 1 MiB.'));
        return;
      }
      onOutput?.(output, Date.now() - started);
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', (error) => {
      if (rssSampler) clearInterval(rssSampler);
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code, signal) => {
      if (rssSampler) clearInterval(rssSampler);
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Godot physical acceptance exited ${code ?? signal}: ${output}`));
        return;
      }
      resolvePromise({
        output,
        elapsedMs: Date.now() - started,
        peakRssBytes,
      });
    });
  });
}

async function godotVersion(godotBin) {
  const result = await run(godotBin, ['--version'], 15_000);
  const match = result.output.match(/\b(4\.(?:3|[4-9]|\d{2,})(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b/u);
  if (!match) throw new Error('Godot 4.3 or newer is required.');
  return match[1];
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const values = options(process.argv.slice(2));
  const observationSeconds = Number(values.get('--observation-seconds'));
  if (!Number.isSafeInteger(observationSeconds)
      || observationSeconds < 30
      || observationSeconds > 900) {
    throw new Error('Observation seconds must be an integer from 30 through 900.');
  }
  const model = (await readFile('/proc/device-tree/model', 'utf8'))
    .replaceAll('\0', '')
    .trim();
  if (!model.startsWith('Raspberry Pi 4 Model B')) {
    throw new Error('Physical acceptance requires a Raspberry Pi 4 Model B.');
  }
  if (process.arch !== 'arm64') {
    throw new Error('Physical acceptance requires an ARM64 Node.js process.');
  }
  const os = parseOsRelease(await readFile('/etc/os-release', 'utf8'));
  const pckPath = await realpath(resolve(values.get('--pck')));
  const godotBin = await realpath(resolve(values.get('--godot-bin')));
  if (!(await stat(pckPath)).isFile() || !(await stat(godotBin)).isFile()) {
    throw new Error('PCK and Godot binary must be regular files.');
  }
  const receipt = await readJson(
    resolve(values.get('--build-receipt')),
    'PCK build receipt',
  );
  const pckBytes = await readFile(pckPath);
  const pckSha256 = sha256(pckBytes);
  const character = receipt?.character_binding;
  if (receipt?.schema_version !== '1.0.0'
      || receipt?.document_type !== 'world-runner-pck-build-receipt'
      || receipt?.physical_raspberry_pi_tested !== false
      || receipt?.runtime_artifact?.kind !== 'godot-pck'
      || receipt?.runtime_artifact?.target_runtime_architecture !== 'arm64'
      || receipt?.runtime_artifact?.bytes !== pckBytes.byteLength
      || receipt?.runtime_artifact?.sha256 !== pckSha256
      || character?.embedded !== true
      || !SHA256.test(character?.revision_sha256 ?? '')
      || !SHA256.test(character?.atlas_sha256 ?? '')) {
    throw new Error('PCK build receipt is incomplete or does not bind these exact bytes.');
  }
  const version = await godotVersion(godotBin);
  const temperatures = [await temperatureC()];
  let startupMs;
  let lastTemperatureSample = 0;
  const expectedReadyTokens = [
    'MAPSOO_WORLD_RUNNER_READY',
    `world_id=${receipt.world_id}`,
    `pack_sha256=${receipt.pack_sha256}`,
    `profile=${receipt.profile}`,
    'character_binding=bound',
    `character_revision_id=${character.profile_revision_id}`,
    `character_revision_sha256=${character.revision_sha256}`,
  ];
  const result = await run(godotBin, [
    '--no-header',
    '--fullscreen',
    '--single-window',
    '--resolution', '640x360',
    '--max-fps', '60',
    '--main-pack', pckPath,
    '--',
    `--world-id=${receipt.world_id}`,
    `--pack-sha256=${receipt.pack_sha256}`,
    `--character-revision-id=${character.profile_revision_id}`,
    `--character-revision-sha256=${character.revision_sha256}`,
    `--physical-acceptance-seconds=${observationSeconds}`,
  ], (observationSeconds + 60) * 1000, (output, elapsedMs) => {
    if (startupMs === undefined && output.split(/\r?\n/u).some(
      (line) => expectedReadyTokens.every((token) => line.includes(token)),
    )) {
      startupMs = elapsedMs;
    }
    if (elapsedMs - lastTemperatureSample >= 1000) {
      lastTemperatureSample = elapsedMs;
      temperatureC().then((value) => temperatures.push(value)).catch(() => {});
    }
  }, true);
  temperatures.push(await temperatureC());
  if (startupMs === undefined) {
    throw new Error('World Runner did not emit exact world-entered and character-bound readiness.');
  }
  const metrics = parsePi4Metrics(result.output);
  if (!Number.isSafeInteger(result.peakRssBytes) || result.peakRssBytes < 1) {
    throw new Error('Physical acceptance could not sample Godot peak RSS.');
  }
  if (metrics.observation_ms < observationSeconds * 1000) {
    throw new Error('Godot observation ended before the requested duration.');
  }
  const runtimeMetrics = {
    ...metrics,
    peak_rss_bytes: result.peakRssBytes,
  };
  const peakTemperature = assertPi4Performance(
    runtimeMetrics,
    temperatures,
    startupMs,
  );
  const value = {
    schema_version: '1.0.0',
    document_type: 'pi4-physical-acceptance-receipt',
    tested_at: new Date().toISOString(),
    world_id: receipt.world_id,
    profile: receipt.profile,
    pack_sha256: receipt.pack_sha256,
    runtime_artifact: {
      kind: 'godot-pck',
      bytes: pckBytes.byteLength,
      sha256: pckSha256,
    },
    character_binding: {
      profile_revision_id: character.profile_revision_id,
      revision_sha256: character.revision_sha256,
      atlas_sha256: character.atlas_sha256,
    },
    device: {
      model: 'Raspberry Pi 4 Model B',
      architecture: 'arm64',
      ...os,
    },
    runtime: {
      godot_version: version,
      renderer: 'gl_compatibility',
      ...runtimeMetrics,
      startup_ms: startupMs,
      temperature_start_c: temperatures[0],
      temperature_end_c: temperatures.at(-1),
      temperature_peak_c: peakTemperature,
    },
    thresholds: PI4_ACCEPTANCE_THRESHOLDS,
    checks: {
      device_model_verified: true,
      arm64_verified: true,
      pck_digest_verified: true,
      world_entered: true,
      character_bound: true,
      performance_passed: true,
    },
    runtime_log_sha256: sha256(Buffer.from(result.output, 'utf8')),
    physical_raspberry_pi_tested: true,
    verdict: 'passed',
  };
  const schema = await readJson(
    resolve(REPOSITORY_ROOT, 'schemas', 'mapsoo-pi4-physical-acceptance-1.0.schema.json'),
    'Physical acceptance schema',
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    throw new Error(`Physical receipt failed its schema: ${ajv.errorsText(validate.errors)}`);
  }
  await writeFile(resolve(values.get('--out')), `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
  });
  process.stdout.write(`${JSON.stringify({
    status: 'pi4-physical-acceptance-passed',
    world_id: value.world_id,
    runtime_artifact_sha256: value.runtime_artifact.sha256,
    average_fps: value.runtime.average_fps,
    output: resolve(values.get('--out')),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `pi4-physical-acceptance: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
