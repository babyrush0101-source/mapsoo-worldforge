#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import {
  PI4_ACCEPTANCE_THRESHOLDS,
  assertPi4Performance,
  parsePi4Metrics,
} from './lib/pi4-physical-acceptance.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const schema = JSON.parse(await readFile(
  `${root}/schemas/mapsoo-pi4-physical-acceptance-1.0.schema.json`,
  'utf8',
));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const digest = 'a'.repeat(64);
const metrics = parsePi4Metrics([
  'MAPSOO_PI4_PHYSICAL_METRICS',
  'observation_ms=30000',
  'frames=1780',
  'average_fps=59.333',
  'p95_frame_ms=18.500',
  'peak_static_memory_bytes=268435456',
].join(' '));
const runtimeMetrics = { ...metrics, peak_rss_bytes: 301_989_888 };
const peak = assertPi4Performance(runtimeMetrics, [51.25, 59.5], 1830);
const receipt = {
  schema_version: '1.0.0',
  document_type: 'pi4-physical-acceptance-receipt',
  tested_at: '2026-07-27T06:00:00.000Z',
  world_id: 'contract-test-world',
  profile: 'side-platformer',
  pack_sha256: digest,
  runtime_artifact: { kind: 'godot-pck', bytes: 382240, sha256: digest },
  character_binding: {
    profile_revision_id: 'contract-test-character',
    revision_sha256: digest,
    atlas_sha256: digest,
  },
  device: {
    model: 'Raspberry Pi 4 Model B',
    architecture: 'arm64',
    os_id: 'raspbian',
    os_version_id: '12',
  },
  runtime: {
    godot_version: '4.3',
    renderer: 'gl_compatibility',
    ...runtimeMetrics,
    startup_ms: 1830,
    temperature_start_c: 51.25,
    temperature_end_c: 59.5,
    temperature_peak_c: peak,
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
  runtime_log_sha256: digest,
  physical_raspberry_pi_tested: true,
  verdict: 'passed',
};
if (!validate(receipt)) {
  throw new Error(`Valid physical receipt failed schema: ${ajv.errorsText(validate.errors)}`);
}
try {
  assertPi4Performance({ ...metrics, average_fps: 12 }, [51.25], 1830);
  throw new Error('Slow performance was accepted.');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('average FPS')) throw error;
}
const falseClaim = { ...receipt, checks: { ...receipt.checks, character_bound: false } };
if (validate(falseClaim)) throw new Error('False character-bound claim passed the schema.');
process.stdout.write(
  'MAPSOO_PI4_PHYSICAL_ACCEPTANCE_CONTRACT_OK'
  + ' physical-device-gate=true character-binding=true performance=true privacy=true\n',
);
