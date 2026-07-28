import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';
import {
  prepareWorldDeliveryBatch,
} from '../src/app/world-delivery-batch';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const FLAGS = new Set([
  '--request',
  '--batch-root',
  '--provider',
  '--model',
  '--resolution',
  '--quality',
  '--request-budget',
]);

function usage(): string {
  return [
    'Mapsoo Worldforge — atomic multi-world workspace preparation',
    '',
    'Prepare 1-32 confirmed worlds without making a remote request:',
    '  pnpm world-delivery:batch -- prepare \\',
    '    --request <world-delivery-batch-request.json> \\',
    '    --batch-root <private-output-outside-this-repository> \\',
    '    [--provider openai|spritecook] [--model <spritecook-model>] \\',
    '    [--resolution 1K|2K|4K] [--quality low|medium|high] \\',
    '    [--request-budget <integer>]',
    '',
    'The request uses only portable paths relative to its own directory.',
    'Every world receives its own workspace and zero-request baseline pack.',
    'The complete batch is staged and renamed atomically; failures publish no',
    'partial batch. Private references and briefs remain outside the repository.',
  ].join('\n');
}

function parseFlags(argv: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!FLAGS.has(flag)) throw new Error(`Unknown flag: ${flag}.`);
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

function inputPath(value: string, label: string): string {
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

function privateBatchRoot(value: string): string {
  const path = inputPath(value, 'Batch root');
  if (isInside(REPOSITORY_ROOT, path)) {
    throw new Error(
      '--batch-root must be outside the public repository.',
    );
  }
  return path;
}

async function readRequest(pathValue: string): Promise<{
  readonly path: string;
  readonly value: unknown;
}> {
  const path = inputPath(pathValue, 'Batch request');
  const metadata = await stat(path);
  if (
    !metadata.isFile()
    || metadata.size < 2
    || metadata.size > MAX_REQUEST_BYTES
  ) {
    throw new Error('Batch request must be a JSON file no larger than 4 MiB.');
  }
  const bytes = await readFile(path);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Batch request must contain strict UTF-8 JSON.');
  }
  const parsed = parseStrictJsonDocument(text, 'Batch request');
  if (!parsed.ok) throw new Error(parsed.message);
  return { path, value: parsed.value };
}

async function prepare(argv: readonly string[]): Promise<void> {
  const values = parseFlags(argv);
  const request = await readRequest(required(values, '--request'));
  const provider = values.get('--provider');
  const resolution = values.get('--resolution');
  const quality = values.get('--quality');
  const budget = values.get('--request-budget');
  if (provider && provider !== 'openai' && provider !== 'spritecook') {
    throw new Error('--provider must be openai or spritecook.');
  }
  if (resolution && !['1K', '2K', '4K'].includes(resolution)) {
    throw new Error('--resolution must be 1K, 2K, or 4K.');
  }
  if (quality && !['low', 'medium', 'high'].includes(quality)) {
    throw new Error('--quality must be low, medium, or high.');
  }
  if (budget && !/^[1-9]\d?$/.test(budget)) {
    throw new Error('--request-budget must be an integer from 1 to 99.');
  }
  if (
    (provider ?? 'openai') === 'openai'
    && (values.has('--model') || values.has('--resolution'))
  ) {
    throw new Error('--model and --resolution require --provider spritecook.');
  }
  const receipt = await prepareWorldDeliveryBatch({
    request: request.value,
    requestRoot: dirname(request.path),
    batchRoot: privateBatchRoot(required(values, '--batch-root')),
    ...(provider === undefined
      ? {}
      : { provider: provider as 'openai' | 'spritecook' }),
    ...(values.has('--model') ? { model: values.get('--model') } : {}),
    ...(resolution === undefined
      ? {}
      : { resolution: resolution as '1K' | '2K' | '4K' }),
    ...(quality === undefined
      ? {}
      : { quality: quality as 'low' | 'medium' | 'high' }),
    ...(budget === undefined ? {} : { requestBudget: Number(budget) }),
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (command === '--help' || command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command !== 'prepare') {
    throw new Error('Expected prepare or --help.');
  }
  await prepare(argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`world-delivery-batch: ${message}\n`);
  process.exitCode = 1;
});
