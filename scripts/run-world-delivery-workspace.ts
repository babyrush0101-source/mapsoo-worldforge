import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  finalizeWorldRunnerDelivery,
  prepareWorldDeliveryWorkspace,
} from '../src/adapters/world-delivery-workspace';
import {
  WORLD_RUNNER_ARCHITECTURES,
  WORLD_RUNNER_ARTIFACT_KINDS,
  type WorldRunnerArchitecture,
  type WorldRunnerArtifactKind,
} from '../src/core/world-runner-delivery';
import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_INTAKE_BYTES = 4 * 1024 * 1024;

const PREPARE_FLAGS = new Set([
  '--intake',
  '--reference-root',
  '--workspace',
  '--character-id',
  '--quality',
  '--request-budget',
]);
const FINALIZE_FLAGS = new Set([
  '--intake',
  '--bundle-root',
  '--world-pack',
  '--runtime-artifact',
  '--runtime-kind',
  '--architecture',
  '--runtime-contract',
  '--character-revision',
  '--verification-report',
  '--delivery-id',
  '--spawn-id',
  '--player-slot-id',
  '--out',
]);

function usage(): string {
  return [
    'Mapsoo Worldforge — private-workspace preparation and verified delivery',
    '',
    'Prepare a local production-art job without making a remote request:',
    '  pnpm world-delivery:workspace -- prepare \\',
    '    --intake <confirmed-intake.json> \\',
    '    --reference-root <reference-root> \\',
    '    --workspace <private-workspace-outside-this-repository> \\',
    '    --character-id <neutral-kebab-case-id> \\',
    '    [--quality low|medium|high] [--request-budget <integer>]',
    '',
    'Finalize an already reviewed and headless-smoked runtime delivery:',
    '  pnpm world-delivery:workspace -- finalize \\',
    '    --intake <confirmed-intake.json> \\',
    '    --bundle-root <staged-bundle-root> \\',
    '    --world-pack <portable-relative-path> \\',
    '    --runtime-artifact <portable-relative-path> \\',
    '    --runtime-kind godot-pck|godot-project-zip|web-bundle-zip \\',
    '    --architecture arm64|x86_64|wasm32 \\',
    '    --runtime-contract <portable-relative-path> \\',
    '    --character-revision <portable-relative-path> \\',
    '    --verification-report <portable-relative-path> \\',
    '    --delivery-id <kebab-case-id> --spawn-id <kebab-case-id> \\',
    '    --player-slot-id <kebab-case-id> --out <delivery.json>',
    '',
    'Privacy and safety:',
    '  - prepare writes private references, briefs, and absolute paths only outside the repository;',
    '  - prepare makes zero remote requests; the production-art workflow remains a separate reviewed step;',
    '  - finalize never overwrites different output and binds exact pack, runtime, character, and report bytes;',
    '  - this CLI accepts only the public consumer-neutral contract; private product records stay private.',
  ].join('\n');
}

function parseValueFlags(
  argv: readonly string[],
  allowed: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new Error(`Unknown flag: ${flag}.`);
    if (values.has(flag)) throw new Error(`Duplicate flag: ${flag}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}.`);
    }
    values.set(flag, value);
    index += 1;
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function resolveInputPath(value: string, label: string): string {
  if (
    value.length < 1
    || value.length > 1000
    || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return resolve(value);
}

function isInside(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return fromParent.length === 0
    || (
      fromParent !== '..'
      && !fromParent.startsWith(`..${sep}`)
      && !isAbsolute(fromParent)
    );
}

function privateWorkspacePath(value: string): string {
  const workspace = resolveInputPath(value, 'Workspace');
  if (isInside(REPOSITORY_ROOT, workspace)) {
    throw new Error(
      '--workspace must be outside the public repository so private inputs cannot be committed.',
    );
  }
  return workspace;
}

async function readStrictJson(pathValue: string, label: string): Promise<unknown> {
  const path = resolveInputPath(pathValue, label);
  const bytes = await readFile(path);
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_INTAKE_BYTES) {
    throw new Error(`${label} must be between 2 bytes and 4 MiB.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be strict UTF-8 JSON.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

async function prepare(argv: readonly string[]): Promise<void> {
  const values = parseValueFlags(argv, PREPARE_FLAGS);
  for (const flag of [
    '--intake',
    '--reference-root',
    '--workspace',
    '--character-id',
  ]) required(values, flag);
  const requestBudgetText = values.get('--request-budget');
  if (requestBudgetText && !/^[1-9]\d?$/.test(requestBudgetText)) {
    throw new Error('--request-budget must be an integer from 1 to 99.');
  }
  const quality = values.get('--quality');
  if (quality && quality !== 'low' && quality !== 'medium' && quality !== 'high') {
    throw new Error('--quality must be low, medium, or high.');
  }
  const result = await prepareWorldDeliveryWorkspace({
    intake: await readStrictJson(required(values, '--intake'), 'Confirmed intake'),
    referenceRoot: resolveInputPath(
      required(values, '--reference-root'),
      'Reference root',
    ),
    workspace: privateWorkspacePath(required(values, '--workspace')),
    characterId: required(values, '--character-id'),
    ...(quality ? { quality } : {}),
    ...(requestBudgetText ? { requestBudget: Number(requestBudgetText) } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function artifactKind(value: string): WorldRunnerArtifactKind {
  if (!WORLD_RUNNER_ARTIFACT_KINDS.includes(value as WorldRunnerArtifactKind)) {
    throw new Error('--runtime-kind is unsupported.');
  }
  return value as WorldRunnerArtifactKind;
}

function architecture(value: string): WorldRunnerArchitecture {
  if (!WORLD_RUNNER_ARCHITECTURES.includes(value as WorldRunnerArchitecture)) {
    throw new Error('--architecture is unsupported.');
  }
  return value as WorldRunnerArchitecture;
}

async function finalize(argv: readonly string[]): Promise<void> {
  const values = parseValueFlags(argv, FINALIZE_FLAGS);
  for (const flag of FINALIZE_FLAGS) required(values, flag);
  const result = await finalizeWorldRunnerDelivery({
    intake: await readStrictJson(required(values, '--intake'), 'Confirmed intake'),
    bundleRoot: resolveInputPath(required(values, '--bundle-root'), 'Bundle root'),
    worldPackPath: required(values, '--world-pack'),
    runtimeArtifact: {
      path: required(values, '--runtime-artifact'),
      kind: artifactKind(required(values, '--runtime-kind')),
      architecture: architecture(required(values, '--architecture')),
    },
    runtimeContractPath: required(values, '--runtime-contract'),
    characterRevisionPath: required(values, '--character-revision'),
    verificationReportPath: required(values, '--verification-report'),
    deliveryId: required(values, '--delivery-id'),
    spawnId: required(values, '--spawn-id'),
    playerSlotId: required(values, '--player-slot-id'),
    outputPath: resolveInputPath(required(values, '--out'), 'Output path'),
  });
  process.stdout.write(`${JSON.stringify({
    status: 'delivery-written',
    delivery_id: result.delivery_id,
    target: result.target,
    profile: result.runtime_contract.world.profile,
    world_id: result.runtime_contract.world.world_id,
    output: resolve(required(values, '--out')),
  }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (command === '--help' || command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === 'prepare') {
    await prepare(argv);
    return;
  }
  if (command === 'finalize') {
    await finalize(argv);
    return;
  }
  throw new Error('Expected prepare, finalize, or --help.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`world-delivery: ${message}\n`);
  process.exitCode = 1;
});
