import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  buildProductionWorldReview,
  type ProductionWorldReviewSourceFile,
} from '../src/adapters/build-production-world-review';
import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from '../src/core/asset-profile';
import {
  writeProductionWorldReviewWorkspace,
} from '../src/app/production-world-review-workspace';

const FLAGS = Object.freeze([
  '--review-id',
  '--profile',
  '--godot-versions',
  '--preview',
  '--capture',
  '--role-overlay',
  '--collision-overlay',
  '--spawn-exit-video',
  '--navigation-video',
  '--out',
] as const);
const MAX_INPUT_BYTES = 128 * 1024 * 1024;

function usage(): string {
  return [
    'Mapsoo Worldforge — production world technical review builder',
    '',
    'Build a blocked, human-pending review workspace from exact evidence:',
    '  pnpm production-art:technical-review -- \\',
    '    --review-id <kebab-case-id> \\',
    '    --profile side-platformer|topdown-farm|isometric-action|layered-depth-2d \\',
    '    --godot-versions 4.3,4.7 \\',
    '    --preview <world-preview.png> \\',
    '    --capture <rendered-godot-world.png> \\',
    '    --role-overlay <semantic-role-overlay.png> \\',
    '    --collision-overlay <art-collision-overlay.png> \\',
    '    --spawn-exit-video <spawn-to-exit.avi|mp4> \\',
    '    --navigation-video <navigation-route.avi|mp4> \\',
    '    --out <local-review-workspace>',
    '',
    'The output uses fixed portable paths under review/ and review-evidence/.',
    'Local input paths are never embedded. The command makes zero remote',
    'requests, never marks the human gate passed, and never publishes.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): ReadonlyMap<string, string> {
  if (argv.length % 2 !== 0) {
    throw new Error('Every technical-review flag requires exactly one value.');
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!;
    const value = argv[index + 1]!;
    if (
      !FLAGS.includes(flag as typeof FLAGS[number])
      || values.has(flag)
      || value.length < 1
      || value.trim() !== value
      || value.startsWith('--')
    ) {
      throw new Error('Every supplied flag must be documented, unique, and non-empty.');
    }
    values.set(flag, value);
  }
  for (const flag of FLAGS) {
    if (!values.has(flag)) throw new Error(`${flag} is required.`);
  }
  return values;
}

function required(values: ReadonlyMap<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

async function source(
  values: ReadonlyMap<string, string>,
  flag: string,
): Promise<ProductionWorldReviewSourceFile> {
  const bytes = Uint8Array.from(await readFile(resolve(required(values, flag))));
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`${flag} must be between 1 byte and 128 MiB.`);
  }
  return Object.freeze({
    bytes: bytes.byteLength,
    readBytes: () => Uint8Array.from(bytes),
  });
}

function versions(
  value: string,
): readonly ('4.3' | '4.7')[] {
  const parsed = value.split(',');
  if (
    parsed.length < 1
    || parsed.length > 2
    || new Set(parsed).size !== parsed.length
    || parsed.some((version) => version !== '4.3' && version !== '4.7')
  ) {
    throw new Error('--godot-versions must be 4.3, 4.7, or 4.3,4.7.');
  }
  return Object.freeze(parsed as ('4.3' | '4.7')[]);
}

function profile(value: string): WorldAssetProfile {
  if (!isWorldAssetProfile(value)) throw new Error('--profile is unsupported.');
  return value;
}

async function run(argv: readonly string[]): Promise<void> {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const values = parseArguments(argv);
  const built = await buildProductionWorldReview({
    reviewId: required(values, '--review-id'),
    profile: profile(required(values, '--profile')),
    godotVersions: versions(required(values, '--godot-versions')),
    worldPreview: await source(values, '--preview'),
    renderedWorldCapture: await source(values, '--capture'),
    rolePlacementOverlay: await source(values, '--role-overlay'),
    artCollisionOverlay: await source(values, '--collision-overlay'),
    spawnExitTraversal: await source(values, '--spawn-exit-video'),
    navigationTraversal: await source(values, '--navigation-video'),
  });
  const outputRoot = resolve(required(values, '--out'));
  await writeProductionWorldReviewWorkspace(built, outputRoot);
  process.stdout.write(`${JSON.stringify({
    status: 'technical-review-built',
    review_id: built.review.review_id,
    profile: built.review.profile,
    technical_gates: 5,
    human_gate: 'pending',
    release_decision: built.review.release_decision,
    files: built.files.length,
    output: outputRoot,
    remote_requests: 0,
    published: false,
  }, null, 2)}\n`);
}

const commandLine = process.argv.slice(2);
run(commandLine[0] === '--' ? commandLine.slice(1) : commandLine).catch(
  (error) => {
    process.stderr.write(
      `Production world technical review failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }\n`,
    );
    process.exitCode = 1;
  },
);
