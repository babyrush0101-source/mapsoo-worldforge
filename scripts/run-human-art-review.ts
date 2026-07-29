import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  prepareHumanArtReviewTemplate,
  promoteHumanArtReviewWorkspace,
  validateHumanArtReviewWorkspace,
} from '../src/app/human-art-review-workspace';
import type {
  HumanArtReviewReceipt,
} from '../src/core/human-art-review-receipt';
import type {
  ProductionWorldReviewContract,
} from '../src/core/production-world-review-contract';
import {
  parseStrictJsonDocument,
} from '../src/adapters/import-world-spec';

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_OVERLAY_BYTES = 256 * 1024 * 1024;
const COMMON_FLAGS = Object.freeze([
  '--review',
  '--overlay',
  '--capture-evidence',
  '--character-binding',
] as const);

function usage(): string {
  return [
    'Mapsoo Worldforge — human art review workspace',
    '',
    'Create a fail-closed template from exact verified artifacts:',
    '  pnpm production-art:human-review -- template \\',
    '    --review <production-world-review.json> \\',
    '    --overlay <world-art-runtime-overlay.zip> \\',
    '    --capture-evidence <rendered-world-capture-evidence-id> \\',
    '    --character-binding <one-way-lowercase-sha256> \\',
    '    --review-id <kebab-case-id> --reviewer-id <opaque-kebab-case-id> \\',
    '    --reviewed-at <canonical-UTC-ISO> --out <receipt-template.json>',
    '',
    'Validate a human-completed receipt without changing files:',
    '  pnpm production-art:human-review -- validate \\',
    '    --review <production-world-review.json> \\',
    '    --overlay <world-art-runtime-overlay.zip> \\',
    '    --capture-evidence <rendered-world-capture-evidence-id> \\',
    '    --character-binding <one-way-lowercase-sha256> \\',
    '    --receipt <human-completed-receipt.json>',
    '',
    'Promote a complete human decision and write canonical records:',
    '  pnpm production-art:human-review -- promote \\',
    '    --review <production-world-review.json> \\',
    '    --overlay <world-art-runtime-overlay.zip> \\',
    '    --capture-evidence <rendered-world-capture-evidence-id> \\',
    '    --character-binding <one-way-lowercase-sha256> \\',
    '    --receipt <human-completed-receipt.json> \\',
    '    --receipt-path <safe/path/in-delivery-kit.json> \\',
    '    --canonical-receipt-out <canonical-receipt.json> \\',
    '    --out <approved-production-world-review.json>',
    '',
    'Safety:',
    '  - template always starts blocked with every criterion not-reviewed;',
    '  - validate and promote make zero remote requests;',
    '  - outputs never overwrite different existing bytes;',
    '  - only one-way character identity hashes are accepted;',
    '  - this command never uploads, publishes, releases, or fills human decisions.',
  ].join('\n');
}

function flags(
  argv: readonly string[],
  allowed: readonly string[],
): ReadonlyMap<string, string> {
  if (argv.length % 2 !== 0) {
    throw new Error('Every flag requires exactly one value.');
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!;
    const value = argv[index + 1]!;
    if (
      !allowed.includes(flag)
      || values.has(flag)
      || value.length < 1
      || value.trim() !== value
      || value.startsWith('--')
    ) {
      throw new Error('Every supplied flag must be documented, unique, and non-empty.');
    }
    values.set(flag, value);
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

async function readBounded(
  pathValue: string,
  label: string,
  maximum: number,
): Promise<Uint8Array> {
  const bytes = Uint8Array.from(await readFile(resolve(pathValue)));
  if (bytes.byteLength < 1 || bytes.byteLength > maximum) {
    throw new Error(`${label} is empty or exceeds its size boundary.`);
  }
  return bytes;
}

async function readJson<T>(pathValue: string, label: string): Promise<T> {
  const bytes = await readBounded(pathValue, label, MAX_JSON_BYTES);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be UTF-8 JSON.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value as T;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

async function writeIdenticalOrNew(
  pathValue: string,
  bytes: Uint8Array,
): Promise<void> {
  const path = resolve(pathValue);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    const existing = await readFile(path).catch(() => undefined);
    if (!existing || !equalBytes(Uint8Array.from(existing), bytes)) {
      throw new Error(
        `Refusing to overwrite different existing output: ${path}.`,
        { cause: error },
      );
    }
  }
}

async function artifacts(values: ReadonlyMap<string, string>) {
  return {
    review: await readJson<ProductionWorldReviewContract>(
      required(values, '--review'),
      'Production world review',
    ),
    runtimeOverlayBytes: await readBounded(
      required(values, '--overlay'),
      'Runtime overlay',
      MAX_OVERLAY_BYTES,
    ),
    godotCaptureEvidenceId: required(values, '--capture-evidence'),
    characterIdentityBindingSha256: required(values, '--character-binding'),
  };
}

async function template(argv: readonly string[]): Promise<void> {
  const values = flags(argv, [
    ...COMMON_FLAGS,
    '--review-id',
    '--reviewer-id',
    '--reviewed-at',
    '--out',
  ]);
  const prepared = await prepareHumanArtReviewTemplate({
    ...await artifacts(values),
    reviewId: required(values, '--review-id'),
    reviewerId: required(values, '--reviewer-id'),
    reviewedAt: required(values, '--reviewed-at'),
  });
  await writeIdenticalOrNew(
    required(values, '--out'),
    prepared.canonicalReceiptBytes,
  );
  process.stdout.write(`${JSON.stringify({
    status: 'template-created',
    decision: prepared.receipt.decision,
    criteria: prepared.receipt.criteria.length,
    output: resolve(required(values, '--out')),
    remote_requests: 0,
  }, null, 2)}\n`);
}

async function validate(argv: readonly string[]): Promise<void> {
  const values = flags(argv, [...COMMON_FLAGS, '--receipt']);
  const receipt = await readJson<HumanArtReviewReceipt>(
    required(values, '--receipt'),
    'Human art review receipt',
  );
  const validated = await validateHumanArtReviewWorkspace({
    ...await artifacts(values),
    receipt,
  });
  process.stdout.write(`${JSON.stringify({
    status: 'valid',
    decision: validated.receipt.decision,
    canonical_bytes: validated.canonicalReceiptBytes.byteLength,
    runtime_overlay_sha256: validated.overlay.sha256,
    remote_requests: 0,
  }, null, 2)}\n`);
}

async function promote(argv: readonly string[]): Promise<void> {
  const values = flags(argv, [
    ...COMMON_FLAGS,
    '--receipt',
    '--receipt-path',
    '--canonical-receipt-out',
    '--out',
  ]);
  const receipt = await readJson<HumanArtReviewReceipt>(
    required(values, '--receipt'),
    'Human art review receipt',
  );
  const promoted = await promoteHumanArtReviewWorkspace({
    ...await artifacts(values),
    receipt,
    receiptPath: required(values, '--receipt-path'),
  });
  const approvalBytes = new TextEncoder().encode(
    `${JSON.stringify(promoted.approval, null, 2)}\n`,
  );
  await writeIdenticalOrNew(
    required(values, '--canonical-receipt-out'),
    promoted.canonicalReceiptBytes,
  );
  await writeIdenticalOrNew(required(values, '--out'), approvalBytes);
  process.stdout.write(`${JSON.stringify({
    status: 'promoted',
    decision: promoted.approval.human_review.decision,
    canonical_receipt: resolve(required(values, '--canonical-receipt-out')),
    approval: resolve(required(values, '--out')),
    uploaded: false,
    published: false,
    remote_requests: 0,
  }, null, 2)}\n`);
}

export async function runHumanArtReviewCli(
  argv: readonly string[],
): Promise<void> {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const [command, ...rest] = argv;
  if (command === 'template') return template(rest);
  if (command === 'validate') return validate(rest);
  if (command === 'promote') return promote(rest);
  throw new Error('Command must be template, validate, or promote.');
}

const commandLine = process.argv.slice(2);
runHumanArtReviewCli(
  commandLine[0] === '--' ? commandLine.slice(1) : commandLine,
).catch((error) => {
  process.stderr.write(
    `Human art review failed: ${
      error instanceof Error ? error.message : 'unknown error'
    }\n`,
  );
  process.exitCode = 1;
});
