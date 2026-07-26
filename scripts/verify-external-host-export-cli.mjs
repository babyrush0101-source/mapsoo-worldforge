#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { REPOSITORY_ROOT } from './release-config.mjs';

const execFileAsync = promisify(execFile);
const cli = join(REPOSITORY_ROOT, 'scripts', 'export-external-host-pack.mjs');
const fixture = join(REPOSITORY_ROOT, 'examples', 'integrations', 'external-host', 'river-valley-asset-request.json');
const completedAt = '2026-07-19T12:00:00.000Z';
const packName = 'mapsoo-river-valley-observation-v0.1.0-alpha.7.zip';
const receiptName = 'mapsoo-river-valley-observation-external-host-export-receipt.json';
const receiptSchema = JSON.parse(await readFile(
  join(REPOSITORY_ROOT, 'integrations', 'external-host', 'external-host-mapsoo-export-receipt.schema.json'),
  'utf8',
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateReceipt = ajv.compile(receiptSchema);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function run(input, outDir, leadingSeparator = false) {
  const args = [cli];
  if (leadingSeparator) args.push('--');
  args.push('--input', input, '--out-dir', outDir, '--completed-at', completedAt);
  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: REPOSITORY_ROOT, maxBuffer: 64 * 1024 * 1024, timeout: 120_000, windowsHide: true,
  });
  return JSON.parse(stdout.trim());
}

async function expectFailure(input, outDir, pattern) {
  try {
    await run(input, outDir);
  } catch (error) {
    assert(pattern.test(String(error.stderr ?? error.message)), 'External Host CLI failed for the wrong reason.');
    return;
  }
  throw new Error('External Host CLI accepted an invalid or conflicting export.');
}

const root = await mkdtemp(join(tmpdir(), 'mapsoo-external-host-cli-verify-'));
try {
  const firstDir = join(root, 'first');
  const secondDir = join(root, 'second');
  const first = await run(fixture, firstDir);
  assert(first.status === 'created' && first.pack === packName && first.receipt === receiptName, 'First External Host export summary is invalid.');
  const packMtime = (await stat(join(firstDir, packName))).mtimeMs;
  const receiptMtime = (await stat(join(firstDir, receiptName))).mtimeMs;
  const unchanged = await run(fixture, firstDir);
  assert(unchanged.status === 'unchanged' && unchanged.sha256 === first.sha256, 'Repeated External Host export was not an unchanged no-op.');
  assert((await stat(join(firstDir, packName))).mtimeMs === packMtime, 'Unchanged External Host export rewrote the pack.');
  assert((await stat(join(firstDir, receiptName))).mtimeMs === receiptMtime, 'Unchanged External Host export rewrote the receipt.');
  const second = await run(fixture, secondDir);
  assert(second.status === 'created' && second.sha256 === first.sha256, 'Independent External Host export hash differs.');
  const separator = await run(fixture, join(root, 'pnpm-separator'), true);
  assert(separator.status === 'created' && separator.sha256 === first.sha256, 'pnpm leading separator changed the External Host export.');

  const firstPack = await readFile(join(firstDir, packName));
  const secondPack = await readFile(join(secondDir, packName));
  const firstReceipt = await readFile(join(firstDir, receiptName));
  const secondReceipt = await readFile(join(secondDir, receiptName));
  assert(firstPack.equals(secondPack) && firstReceipt.equals(secondReceipt), 'External Host ZIP or export receipt is not byte-reproducible.');
  const receipt = JSON.parse(firstReceipt.toString('utf8'));
  assert(validateReceipt(receipt), `External Host export receipt failed its JSON Schema: ${ajv.errorsText(validateReceipt.errors)}`);
  assert(receipt.schema_version === 'org.mapsoo.externalhost.mapsoo-export-receipt/1.0.0', 'External Host export receipt schema is invalid.');
  assert(receipt.pack.sha256 === sha256(firstPack) && receipt.pack.bytes === firstPack.byteLength, 'External Host export receipt does not bind the ZIP.');
  assert(!firstReceipt.toString('utf8').includes(root), 'External Host export receipt leaked an absolute test path.');
  const extraFieldReceipt = structuredClone(receipt);
  extraFieldReceipt.request.child_id = 'must-not-be-accepted';
  assert(!validateReceipt(extraFieldReceipt), 'External Host export receipt schema accepted an unknown private field.');
  const invalidTimestampReceipt = structuredClone(receipt);
  invalidTimestampReceipt.completed_at = '2026-07-19T12:00:00Z';
  assert(!validateReceipt(invalidTimestampReceipt), 'External Host export receipt schema accepted a non-canonical timestamp.');

  const originalPackHash = sha256(firstPack);
  await writeFile(join(firstDir, receiptName), `${firstReceipt.toString('utf8').trimEnd()} `);
  await expectFailure(fixture, firstDir, /Output conflict/);
  assert(sha256(await readFile(join(firstDir, packName))) === originalPackHash, 'Conflict handling modified the existing pack.');

  const invalidRequest = join(root, 'private-request.json');
  const invalid = JSON.parse(await readFile(fixture, 'utf8'));
  invalid.childId = 'must-not-cross-boundary';
  await writeFile(invalidRequest, `${JSON.stringify(invalid)}\n`);
  await expectFailure(invalidRequest, join(root, 'invalid'), /must contain exactly/);

  const oversizedRequest = join(root, 'oversized-request.json');
  await writeFile(oversizedRequest, Buffer.alloc(128 * 1024 + 1, 0x20));
  await expectFailure(oversizedRequest, join(root, 'oversized'), /regular file between 1 byte/);
  const invalidUtf8Request = join(root, 'invalid-utf8.json');
  await writeFile(invalidUtf8Request, Buffer.from([0xc3, 0x28]));
  await expectFailure(invalidUtf8Request, join(root, 'invalid-utf8'), /valid UTF-8/);

  const partialDir = join(root, 'partial');
  await mkdir(partialDir, { recursive: true });
  await writeFile(join(partialDir, packName), firstPack);
  await expectFailure(fixture, partialDir, /Output conflict/);

  const concurrentDir = join(root, 'concurrent');
  const concurrent = await Promise.allSettled([run(fixture, concurrentDir), run(fixture, concurrentDir)]);
  const fulfilled = concurrent.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value.status);
  const rejected = concurrent.filter((entry) => entry.status === 'rejected');
  const rejectedMessages = rejected.map((entry) => String(entry.reason.stderr ?? entry.reason.message));
  assert(fulfilled.includes('created'), 'Concurrent External Host exports did not create one complete output pair.');
  assert(
    (fulfilled.length === 2 && fulfilled.includes('unchanged'))
      || (fulfilled.length === 1 && rejected.length === 1 && /Output conflict/.test(rejectedMessages[0])),
    `Concurrent External Host export did not resolve as unchanged or fail-closed conflict: fulfilled=${JSON.stringify(fulfilled)} rejected=${JSON.stringify(rejectedMessages)}.`,
  );
  assert(validateReceipt(JSON.parse(await readFile(join(concurrentDir, receiptName), 'utf8'))), 'Concurrent External Host export left an invalid receipt.');

  console.log(`MAPSOO_EXTERNAL_HOST_EXPORT_CLI_OK bytes=${firstPack.byteLength} sha256=${first.sha256} request_sha256=${receipt.request.asset_request_sha256}`);
} finally {
  await rm(root, { recursive: true, force: true });
}
