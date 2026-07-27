#!/usr/bin/env node

import { resolve } from 'node:path';

import { buildWorldRunnerPck } from './lib/world-runner-pck.mjs';

const FLAGS = new Set([
  '--bundle-root',
  '--world-pack',
  '--imported-world',
  '--world-id',
  '--godot-bin',
  '--out',
  '--report',
  '--receipt',
]);

function usage() {
  return [
    'Build and smoke-test a target-neutral Godot PCK for an ARM64 World Runner.',
    '',
    'node scripts/build-world-runner-pck.mjs \\',
    '  --bundle-root <private-bundle-root> \\',
    '  --world-pack <path-inside-bundle> \\',
    '  --imported-world <directory-inside-bundle> \\',
    '  --world-id <lowercase-kebab-id> \\',
    '  --godot-bin <trusted-godot-4.3+-binary> \\',
    '  --out <pck-path-inside-bundle> \\',
    '  --report <json-path-inside-bundle> \\',
    '  --receipt <json-path-inside-bundle>',
    '',
    'The PCK is target-neutral content. The receipt binds it to an ARM64 runtime',
    'target, but never claims that the build host was a physical Raspberry Pi.',
  ].join('\n');
}

function flags(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!FLAGS.has(flag)) throw new Error(`Unknown flag: ${flag}.`);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    if (result.has(flag)) throw new Error(`Duplicate flag: ${flag}.`);
    result.set(flag, value);
  }
  for (const flag of FLAGS) {
    if (!result.has(flag)) throw new Error(`${flag} is required.`);
  }
  return result;
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const values = flags(process.argv.slice(2));
  const bundleRoot = resolve(values.get('--bundle-root'));
  const result = await buildWorldRunnerPck({
    bundleRoot,
    worldPackPath: resolve(bundleRoot, values.get('--world-pack')),
    importedWorldDir: resolve(bundleRoot, values.get('--imported-world')),
    worldId: values.get('--world-id'),
    godotBin: resolve(values.get('--godot-bin')),
    pckPath: resolve(bundleRoot, values.get('--out')),
    reportPath: resolve(bundleRoot, values.get('--report')),
    receiptPath: resolve(bundleRoot, values.get('--receipt')),
  });
  process.stdout.write(`${JSON.stringify({
    status: 'world-runner-pck-built',
    world_id: result.report.world_id,
    runtime_artifact_sha256: result.report.runtime_artifact_sha256,
    physical_raspberry_pi_tested: false,
    output: result.pckPath,
    report: result.reportPath,
    receipt: result.receiptPath,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`world-runner-pck: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
