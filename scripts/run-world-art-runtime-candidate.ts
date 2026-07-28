import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadProductionArtRunSetV1_1Workspace,
} from '../src/adapters/load-production-art-run-set-v1-1-workspace';
import {
  buildWorldArtRuntimeCandidate,
} from '../src/app/world-art-runtime-candidate';
import {
  buildPendingWorldArtSelectionReview,
  serializeCanonicalWorldArtSelectionReview,
} from '../src/core/world-art-selection-review';
import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const COMMON_FLAGS = new Set([
  '--layout',
  '--requirements',
  '--plan',
  '--run-set',
  '--model-runs-root',
  '--out',
  '--review',
]);

function usage(): string {
  return [
    'Mapsoo Worldforge — reviewed world-art runtime candidate workspace',
    '',
    'Create a private, hash-bound slot-review template (zero remote requests):',
    '  pnpm production-art:runtime-candidate -- template \\',
    '    --layout <world-layout-plan.json> \\',
    '    --requirements <asset-requirements-1.1.json> \\',
    '    --plan <production-art-plan-1.1.json> \\',
    '    --run-set <production-art-run-set.json> \\',
    '    --model-runs-root <model-runs-directory> \\',
    '    --out <private-review.json>',
    '',
    'Build a source-free Godot overlay after every slot is approved:',
    '  pnpm production-art:runtime-candidate -- build \\',
    '    --layout <world-layout-plan.json> \\',
    '    --requirements <asset-requirements-1.1.json> \\',
    '    --plan <production-art-plan-1.1.json> \\',
    '    --run-set <production-art-run-set.json> \\',
    '    --model-runs-root <model-runs-directory> \\',
    '    --review <approved-world-art-selection-review.json> \\',
    '    --out <private-candidate-directory>',
    '',
    'Safety:',
    '  - all JSON and model-run bytes are validated against their canonical hashes;',
    '  - template/build output must be outside this public repository;',
    '  - pending, rejected, partial, rights-drifted, or tampered reviews build nothing;',
    '  - the overlay records human-art pass, while runtime and Raspberry Pi stay pending;',
    '  - this command makes zero remote requests and never labels a candidate production-ready.',
  ].join('\n');
}

function isInside(parent: string, candidate: string): boolean {
  const value = relative(parent, candidate);
  return value.length === 0
    || (
      value !== '..'
      && !value.startsWith(`..${sep}`)
      && !isAbsolute(value)
    );
}

function parseFlags(argv: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!COMMON_FLAGS.has(flag)) throw new Error(`Unknown flag: ${flag}.`);
    if (values.has(flag)) throw new Error(`Duplicate flag: ${flag}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    values.set(flag, value);
    index += 1;
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required.`);
  if (
    value.length > 1000
    || value.trim() !== value
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${flag} is invalid.`);
  }
  return value;
}

async function readStrictJson(pathValue: string, label: string): Promise<unknown> {
  const bytes = Uint8Array.from(await readFile(resolve(pathValue)));
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error(`${label} must be between 2 bytes and 4 MiB.`);
  }
  let text: string;
  try {
    if (
      bytes.byteLength >= 3
      && bytes[0] === 0xef
      && bytes[1] === 0xbb
      && bytes[2] === 0xbf
    ) {
      throw new Error('bom');
    }
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be strict UTF-8 JSON without a BOM.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

async function assertPrivateOutput(pathValue: string): Promise<string> {
  const output = resolve(pathValue);
  if (isInside(REPOSITORY_ROOT, output)) {
    throw new Error('Output must be outside the public repository.');
  }
  const parent = dirname(output);
  await mkdir(parent, { recursive: true });
  const canonicalParent = await realpath(parent);
  const canonicalOutput = resolve(canonicalParent, output.slice(parent.length + 1));
  if (isInside(await realpath(REPOSITORY_ROOT), canonicalOutput)) {
    throw new Error('Output resolves inside the public repository.');
  }
  return canonicalOutput;
}

async function writeFileIdempotent(path: string, bytes: Uint8Array): Promise<void> {
  try {
    const existing = Uint8Array.from(await readFile(path));
    if (
      existing.byteLength === bytes.byteLength
      && existing.every((byte, index) => byte === bytes[index])
    ) return;
    throw new Error('Output exists with different bytes.');
  } catch (error) {
    if (
      error instanceof Error
      && !('code' in error && error.code === 'ENOENT')
    ) throw error;
  }
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, bytes, { flag: 'wx' });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeDirectoryIdempotent(
  output: string,
  files: readonly Readonly<{ path: string; readBytes(): Uint8Array }>[],
): Promise<void> {
  try {
    const metadata = await lstat(output);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Candidate output exists and is not a regular directory.');
    }
    const existing = (await readdir(output)).sort();
    const expected = files.map(({ path }) => path).sort();
    if (
      existing.length !== expected.length
      || existing.some((name, index) => name !== expected[index])
    ) {
      throw new Error('Candidate output exists with a different file inventory.');
    }
    for (const file of files) {
      const bytes = Uint8Array.from(await readFile(resolve(output, file.path)));
      const expectedBytes = file.readBytes();
      if (
        bytes.byteLength !== expectedBytes.byteLength
        || bytes.some((byte, index) => byte !== expectedBytes[index])
      ) {
        throw new Error(`Candidate output ${file.path} exists with different bytes.`);
      }
    }
    return;
  } catch (error) {
    if (
      error instanceof Error
      && !('code' in error && error.code === 'ENOENT')
    ) throw error;
  }
  const staging = `${output}.staging-${randomUUID()}`;
  await mkdir(staging, { recursive: false });
  try {
    for (const file of files) {
      await writeFile(resolve(staging, file.path), file.readBytes(), { flag: 'wx' });
    }
    await rename(staging, output);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function loadInputs(values: ReadonlyMap<string, string>) {
  const [layout, requirements, plan, runSet] = await Promise.all([
    readStrictJson(required(values, '--layout'), 'World layout plan'),
    readStrictJson(required(values, '--requirements'), 'Asset Requirements 1.1'),
    readStrictJson(required(values, '--plan'), 'Production Art Plan 1.1'),
    readStrictJson(required(values, '--run-set'), 'Production Art RunSet 1.1'),
  ]);
  const loaded = await loadProductionArtRunSetV1_1Workspace({
    requirements,
    plan,
    runSet,
    modelRunsRoot: resolve(required(values, '--model-runs-root')),
  });
  return Object.freeze({ layout, ...loaded });
}

async function template(values: ReadonlyMap<string, string>): Promise<void> {
  if (values.has('--review')) throw new Error('--review is not accepted by template.');
  const loaded = await loadInputs(values);
  const reviewInput = {
    layout_plan: loaded.layout,
    asset_requirements: loaded.requirements,
    production_art_plan: loaded.plan,
    production_art_run_set: loaded.runSet,
  };
  const review = await buildPendingWorldArtSelectionReview(reviewInput);
  const bytes = await serializeCanonicalWorldArtSelectionReview(review, reviewInput);
  const output = await assertPrivateOutput(required(values, '--out'));
  await writeFileIdempotent(output, bytes);
  console.log(JSON.stringify({
    status: 'review-template-written',
    profile: review.profile,
    review_id: review.review_id,
    task_count: review.tasks.length,
    slot_count: review.tasks.reduce((total, task) => total + task.slots.length, 0),
    remote_request_count: 0,
    output,
  }, null, 2));
}

async function build(values: ReadonlyMap<string, string>): Promise<void> {
  const loaded = await loadInputs(values);
  const review = await readStrictJson(
    required(values, '--review'),
    'Approved world-art selection review',
  );
  const candidate = await buildWorldArtRuntimeCandidate({
    layout_plan: loaded.layout,
    asset_requirements: loaded.requirements,
    production_art_plan: loaded.plan,
    production_art_run_set: loaded.runSet,
    normalized_results: loaded.normalizedResults,
    selection_review: review,
  });
  const output = await assertPrivateOutput(required(values, '--out'));
  await writeDirectoryIdempotent(output, candidate.files);
  console.log(JSON.stringify({
    status: 'runtime-candidate-written',
    candidate_id: candidate.receipt.candidate_id,
    profile: candidate.receipt.profile,
    human_art: 'pass',
    runtime: 'pending',
    raspberry_pi: 'pending',
    production_ready: false,
    remote_request_count: 0,
    output,
  }, null, 2));
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }
  if (command !== 'template' && command !== 'build') {
    throw new Error(`Unknown command: ${command}.\n\n${usage()}`);
  }
  const values = parseFlags(argv);
  for (const flag of [
    '--layout',
    '--requirements',
    '--plan',
    '--run-set',
    '--model-runs-root',
    '--out',
  ]) required(values, flag);
  if (command === 'template') await template(values);
  else await build(values);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
