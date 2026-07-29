import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildApprovedWorldArtDeliveryKit,
  type ApprovedWorldArtRuntimeOverlayArtifact,
  type WorldArtDeliveryReviewFile,
} from '../src/adapters/build-approved-world-art-delivery-kit';
import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';
import {
  readVersionedWorldArtRuntimeOverlayArchive,
} from '../src/adapters/read-world-art-runtime-overlay-versioned';
import type {
  ApprovedProductionWorldReview,
  HumanArtReviewReceipt,
} from '../src/core/human-art-review-receipt';
import type {
  ProductionWorldEvidence,
} from '../src/core/production-world-review-contract';
import {
  materializeWorldLayoutPlan,
  serializeCanonicalWorldLayoutPlan,
} from '../src/core/world-layout-plan';

const REQUIRED_FLAGS = Object.freeze([
  '--overlay',
  '--approval',
  '--receipt',
  '--evidence-root',
  '--pack-id',
  '--title',
  '--version',
  '--contains-generative-ai',
  '--out',
] as const);
const OPTIONAL_FLAGS = Object.freeze(['--layout'] as const);
const ALLOWED_FLAGS = new Set<string>([
  ...REQUIRED_FLAGS,
  ...OPTIONAL_FLAGS,
]);
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_LAYOUT_BYTES = 2 * 1024 * 1024;
const MAX_OVERLAY_BYTES = 256 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 128 * 1024 * 1024;
const SAFE_RELATIVE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

interface DirectFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly identity: string;
}

export interface ApprovedWorldArtDeliveryKitCliResult {
  readonly status: 'delivery-kit-created' | 'delivery-kit-unchanged';
  readonly schema_version: '1.0.0' | '1.1.0';
  readonly profile:
    | 'side-platformer'
    | 'topdown-farm'
    | 'isometric-action'
    | 'layered-depth-2d';
  readonly distribution: 'private' | 'public';
  readonly output: string;
  readonly bytes: number;
  readonly files: number;
  readonly remote_requests: 0;
  readonly uploaded: false;
  readonly published: false;
}

function usage(): string {
  return [
    'Mapsoo WorldForge - approved world-art delivery kit',
    '',
    'Build one deterministic itch.io-style Graphical Assets ZIP:',
    '  pnpm production-art:delivery-kit:build -- \\',
    '    --overlay <world-art-runtime-overlay-id.zip> \\',
    '    --approval <approved-production-world-review.json> \\',
    '    --receipt <canonical-human-art-review.json> \\',
    '    --evidence-root <technical-review-workspace> \\',
    '    [--layout <world-layout-plan.json>] \\',
    '    --pack-id <kebab-case-id> --title <display-title> \\',
    '    --version <semver> --contains-generative-ai <true|false> \\',
    '    --out <empty-or-existing-output-directory>',
    '',
    'Overlay 1.1 requires the exact separately supplied canonical layout.',
    'Overlay 1.0 rejects --layout and remains layout-independent.',
    'The command makes zero remote requests and never uploads or publishes.',
  ].join('\n');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ''
    && path !== '..'
    && !path.startsWith(`..${sep}`)
    && !isAbsolute(path);
}

function flags(argv: readonly string[]): ReadonlyMap<string, string> {
  if (argv.length % 2 !== 0) {
    throw new Error('Every flag requires exactly one value.');
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!;
    const value = argv[index + 1]!;
    if (
      !ALLOWED_FLAGS.has(flag)
      || values.has(flag)
      || value.length < 1
      || value.trim() !== value
      || value.startsWith('--')
    ) {
      throw new Error(
        'Every supplied flag must be documented, unique, and non-empty.',
      );
    }
    values.set(flag, value);
  }
  for (const flag of REQUIRED_FLAGS) {
    if (!values.has(flag)) throw new Error(`${flag} is required.`);
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

async function directDirectory(pathValue: string, label: string): Promise<string> {
  const path = resolve(pathValue);
  const metadata = await lstat(path, { bigint: true }).catch(() => undefined);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a direct local directory.`);
  }
  const canonical = await realpath(path).catch(() => undefined);
  if (!canonical || !samePath(canonical, path)) {
    throw new Error(`${label} must not use a symlink or junction.`);
  }
  return canonical;
}

async function directFile(
  pathValue: string,
  label: string,
  maximumBytes: number,
): Promise<DirectFile> {
  const path = resolve(pathValue);
  const before = await lstat(path, { bigint: true }).catch(() => undefined);
  if (
    !before
    || before.isSymbolicLink()
    || !before.isFile()
    || before.size < 1n
    || before.size > BigInt(maximumBytes)
  ) {
    throw new Error(`${label} must be a bounded direct local file.`);
  }
  const canonical = await realpath(path).catch(() => undefined);
  if (!canonical || !samePath(canonical, path)) {
    throw new Error(`${label} must not use a symlink or junction.`);
  }
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
    ) {
      throw new Error(`${label} changed while it was opened.`);
    }
    const bytes = Uint8Array.from(await handle.readFile());
    const after = await handle.stat({ bigint: true });
    if (
      bytes.byteLength !== Number(opened.size)
      || after.dev !== opened.dev
      || after.ino !== opened.ino
      || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs
    ) {
      throw new Error(`${label} changed while it was read.`);
    }
    return Object.freeze({
      path: canonical,
      bytes,
      identity: `${opened.dev.toString()}:${opened.ino.toString()}`,
    });
  } finally {
    await handle.close();
  }
}

function strictJson(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be UTF-8 JSON.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

async function canonicalLayout(
  pathValue: string | undefined,
): Promise<Readonly<{ value: unknown; file: DirectFile }> | undefined> {
  if (pathValue === undefined) return undefined;
  const file = await directFile(
    pathValue,
    'WorldLayoutPlan',
    MAX_LAYOUT_BYTES,
  );
  if (basename(file.path) !== 'world-layout-plan.json') {
    throw new Error('Layout file must be named world-layout-plan.json.');
  }
  const value = await materializeWorldLayoutPlan(
    strictJson(file.bytes, 'WorldLayoutPlan'),
  );
  const canonical = await serializeCanonicalWorldLayoutPlan(value);
  if (!equalBytes(file.bytes, canonical)) {
    throw new Error('WorldLayoutPlan bytes must be canonical.');
  }
  return Object.freeze({ value, file });
}

function safeEvidencePath(path: string): boolean {
  return path.length >= 1
    && path.length <= 240
    && path.includes('/')
    && SAFE_RELATIVE_PATH.test(path)
    && !path.includes('//')
    && !path.endsWith('/');
}

function expectedReviewFiles(
  approval: ApprovedProductionWorldReview,
): readonly Readonly<{
  path: string;
  media_type: WorldArtDeliveryReviewFile['media_type'];
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
}>[] {
  return Object.freeze([
    Object.freeze({
      ...approval.review.world_preview,
      media_type: 'image/png' as const,
    }),
    ...approval.review.evidence
      .filter(({ kind }) => kind !== 'human-review-record')
      .map((evidence: ProductionWorldEvidence) => Object.freeze({
        path: evidence.path,
        media_type:
          evidence.media_type as WorldArtDeliveryReviewFile['media_type'],
        bytes: evidence.bytes,
        sha256: evidence.sha256,
        ...(evidence.width === undefined ? {} : { width: evidence.width }),
        ...(evidence.height === undefined ? {} : { height: evidence.height }),
      })),
  ]);
}

async function loadReviewFiles(
  approval: ApprovedProductionWorldReview,
  evidenceRoot: string,
  identities: Set<string>,
): Promise<readonly WorldArtDeliveryReviewFile[]> {
  const expected = expectedReviewFiles(approval);
  if (
    new Set(expected.map(({ path }) => path)).size !== expected.length
    || expected.some(({ path }) => !safeEvidencePath(path))
  ) {
    throw new Error('Approved review contains an unsafe evidence inventory.');
  }
  const files: WorldArtDeliveryReviewFile[] = [];
  for (const record of expected) {
    const path = resolve(evidenceRoot, ...record.path.split('/'));
    if (!inside(evidenceRoot, path)) {
      throw new Error(`Evidence path escapes its root: ${record.path}.`);
    }
    const file = await directFile(
      path,
      `Review evidence ${record.path}`,
      MAX_EVIDENCE_BYTES,
    );
    if (identities.has(file.identity)) {
      throw new Error(`Review evidence uses a hard-link alias: ${record.path}.`);
    }
    identities.add(file.identity);
    const snapshot = Uint8Array.from(file.bytes);
    files.push(Object.freeze({
      ...record,
      readBytes: () => Uint8Array.from(snapshot),
    }));
  }
  return Object.freeze(files);
}

async function writeIdenticalOrNew(
  path: string,
  bytes: Uint8Array,
): Promise<'created' | 'unchanged'> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
    return 'created';
  } catch (error) {
    const existing = await readFile(path).catch(() => undefined);
    if (!existing || !equalBytes(Uint8Array.from(existing), bytes)) {
      throw new Error(
        `Refusing to overwrite different existing output: ${path}.`,
        { cause: error },
      );
    }
    return 'unchanged';
  }
}

export async function buildApprovedWorldArtDeliveryKitFromCli(
  argv: readonly string[],
): Promise<ApprovedWorldArtDeliveryKitCliResult> {
  const args = flags(argv);
  const layout = await canonicalLayout(args.get('--layout'));
  const [overlayFile, approvalFile, receiptFile, evidenceRoot] =
    await Promise.all([
      directFile(
        required(args, '--overlay'),
        'Runtime overlay',
        MAX_OVERLAY_BYTES,
      ),
      directFile(
        required(args, '--approval'),
        'Approved production-world review',
        MAX_JSON_BYTES,
      ),
      directFile(
        required(args, '--receipt'),
        'Canonical human-art review receipt',
        MAX_JSON_BYTES,
      ),
      directDirectory(required(args, '--evidence-root'), 'Evidence root'),
    ]);
  const identities = new Set([
    overlayFile.identity,
    approvalFile.identity,
    receiptFile.identity,
    ...(layout === undefined ? [] : [layout.file.identity]),
  ]);
  if (identities.size !== (layout === undefined ? 3 : 4)) {
    throw new Error('Delivery inputs must not use hard-link aliases.');
  }
  const approval = strictJson(
    approvalFile.bytes,
    'Approved production-world review',
  ) as ApprovedProductionWorldReview;
  const receipt = strictJson(
    receiptFile.bytes,
    'Canonical human-art review receipt',
  ) as HumanArtReviewReceipt;
  const verifiedOverlay = await readVersionedWorldArtRuntimeOverlayArchive(
    overlayFile.bytes,
    layout === undefined ? {} : { layout_plan: layout.value },
  );
  if (
    verifiedOverlay.manifest.schema_version === '1.1.0'
      ? layout === undefined
      : layout !== undefined
  ) {
    throw new Error(
      verifiedOverlay.manifest.schema_version === '1.1.0'
        ? 'Overlay 1.1 requires --layout.'
        : 'Overlay 1.0 must not receive --layout.',
    );
  }
  const reviewFiles = await loadReviewFiles(
    approval,
    evidenceRoot,
    identities,
  );
  const overlaySnapshot = Uint8Array.from(overlayFile.bytes);
  const artifact: ApprovedWorldArtRuntimeOverlayArtifact = Object.freeze({
    filename: basename(overlayFile.path),
    bytes: overlaySnapshot.byteLength,
    manifest: verifiedOverlay.manifest,
    ...(layout === undefined ? {} : { layoutPlan: layout.value }),
    readBytes: () => Uint8Array.from(overlaySnapshot),
  });
  const containsGenerativeAi = required(
    args,
    '--contains-generative-ai',
  );
  if (containsGenerativeAi !== 'true' && containsGenerativeAi !== 'false') {
    throw new Error('--contains-generative-ai must be true or false.');
  }
  const built = await buildApprovedWorldArtDeliveryKit(
    artifact,
    approval,
    receipt,
    receiptFile.bytes,
    reviewFiles,
    {
      packId: required(args, '--pack-id'),
      title: required(args, '--title'),
      version: required(args, '--version'),
      containsGenerativeAi: containsGenerativeAi === 'true',
    },
  );
  const outputRoot = resolve(required(args, '--out'));
  const output = resolve(outputRoot, built.filename);
  if (!inside(outputRoot, output)) {
    throw new Error('Delivery output escaped its directory.');
  }
  const status = await writeIdenticalOrNew(output, built.readBytes());
  return Object.freeze({
    status: status === 'created'
      ? 'delivery-kit-created'
      : 'delivery-kit-unchanged',
    schema_version: built.manifest.schema_version,
    profile: built.manifest.profile,
    distribution: built.manifest.distribution,
    output,
    bytes: built.bytes,
    files: built.manifest.files.length + 1,
    remote_requests: 0,
    uploaded: false,
    published: false,
  });
}

export async function runApprovedWorldArtDeliveryKitCli(
  argv: readonly string[],
): Promise<void> {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await buildApprovedWorldArtDeliveryKitFromCli(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === entry) {
  runApprovedWorldArtDeliveryKitCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `Approved delivery-kit build failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }\n`,
    );
    process.exitCode = 1;
  });
}
