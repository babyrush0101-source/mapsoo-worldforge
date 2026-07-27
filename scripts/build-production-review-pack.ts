import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildProductionReviewPack,
} from '../src/adapters/build-production-review-pack';
import {
  materializeProductionArtRunInventory,
} from '../src/adapters/materialize-production-art-run-inventory';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from '../src/adapters/normalize-production-art-png';
import {
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtRights,
} from '../src/core/production-art-contract';
import {
  materializeProductionArtRunSet,
} from '../src/core/production-art-run-set';

const FLAGS = Object.freeze([
  '--base-pack',
  '--runs-manifest',
  '--out',
  '--pack-id',
  '--title',
  '--created-at',
] as const);

type Flag = typeof FLAGS[number];

interface Arguments {
  readonly basePack: string;
  readonly runsManifest: string;
  readonly out: string;
  readonly packId: string;
  readonly title: string;
  readonly createdAt: string;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — three-profile production review pack builder',
    '',
    'Project one complete top-down, side-platformer or isometric model-art run-set',
    'over its matching deterministic Godot base pack:',
    '  pnpm production-art:review-pack:build -- \\',
    '    --base-pack <base.zip> \\',
    '    --runs-manifest <production-art-run-set.json> \\',
    '    --out <review.zip> \\',
    '    --pack-id <lowercase-kebab-id> \\',
    '    --title <review-title> \\',
    '    --created-at <canonical-UTC-ISO>',
    '',
    'The command makes zero remote requests and always emits an unreleased',
    'internal-review pack with every approval gate pending.',
  ].join('\n');
}

function argumentsFrom(argv: readonly string[]): Arguments {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(usage());
    process.exit(0);
  }
  const values = new Map<Flag, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index] as Flag;
    const value = argv[index + 1];
    if (
      !FLAGS.includes(flag)
      || typeof value !== 'string'
      || value.length < 1
      || value.trim() !== value
      || values.has(flag)
    ) {
      throw new Error('Every documented review-pack flag is required exactly once.');
    }
    values.set(flag, value);
  }
  if (values.size !== FLAGS.length || argv.length !== FLAGS.length * 2) {
    throw new Error('Every documented review-pack flag is required exactly once.');
  }
  return {
    basePack: values.get('--base-pack')!,
    runsManifest: values.get('--runs-manifest')!,
    out: values.get('--out')!,
    packId: values.get('--pack-id')!,
    title: values.get('--title')!,
    createdAt: values.get('--created-at')!,
  };
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new Error(`${label} is not strict UTF-8 JSON.`);
  }
}

async function loadResult(
  manifestDirectory: string,
  taskId: string,
  relativeDirectory: string,
): Promise<NormalizedProductionArtResult> {
  const runDirectory = resolve(manifestDirectory, relativeDirectory);
  const [source, normalized, outputBytes, evidenceBytes] = await Promise.all([
    readFile(resolve(runDirectory, 'source.png')),
    readFile(resolve(runDirectory, 'normalized.png')),
    readFile(resolve(runDirectory, 'output.json')),
    readFile(resolve(runDirectory, 'evidence.json')),
  ]);
  return {
    output: parseJson<ProductionArtOutput>(outputBytes, `${taskId} output`),
    evidence: parseJson<ProductionArtGenerationEvidence>(
      evidenceBytes,
      `${taskId} evidence`,
    ),
    source: {
      byteLength: source.byteLength,
      readBytes: () => Uint8Array.from(source),
    },
    normalized: {
      byteLength: normalized.byteLength,
      readBytes: () => Uint8Array.from(normalized),
    },
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

async function writeReproducible(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const existing = Uint8Array.from(await readFile(path));
    if (!equalBytes(existing, bytes)) {
      throw new Error(`Refusing to overwrite non-identical review pack: ${path}.`);
    }
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
    await writeFile(path, bytes, { flag: 'wx' });
  }
}

async function main(): Promise<void> {
  const args = argumentsFrom(process.argv.slice(2));
  const manifestPath = resolve(args.runsManifest);
  const runSet = materializeProductionArtRunSet(parseJson<unknown>(
    await readFile(manifestPath),
    'Production art run-set',
  ));
  if (runSet.profile === 'layered-depth-2d') {
    throw new Error('Layered-depth must use pack10:production-review:build.');
  }
  const manifestDirectory = dirname(manifestPath);
  const entries = await Promise.all(Object.entries(runSet.runs).map(
    async ([taskId, runDirectory]) => [
      taskId,
      await loadResult(manifestDirectory, taskId, runDirectory),
    ] as const,
  ));
  const results = Object.fromEntries(entries);
  const direction = results['scene-direction'];
  if (!direction) throw new Error('Production art run-set is missing scene direction.');
  const plan = createProductionArtPlan(
    runSet.profile,
    direction.output.rights as ProductionArtRights,
  );
  const inventory = await materializeProductionArtRunInventory(
    plan,
    runSet,
    results,
  );
  const baseBytes = Uint8Array.from(await readFile(resolve(args.basePack)));
  const reviewPack = await buildProductionReviewPack(
    plan,
    inventory,
    {
      byteLength: baseBytes.byteLength,
      readBytes: () => Uint8Array.from(baseBytes),
    },
    {
      packId: args.packId,
      title: args.title,
      createdAt: args.createdAt,
    },
  );
  const output = resolve(args.out);
  await writeReproducible(output, reviewPack.bytes);
  console.log(JSON.stringify({
    status: 'production-internal-review-pack-written',
    profile: reviewPack.manifest.profile,
    pack_id: reviewPack.manifest.pack.id,
    sha256: await (async () => {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        reviewPack.bytes.slice().buffer,
      );
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    })(),
    files: reviewPack.manifest.files.length,
    projected_visuals: reviewPack.review.files.length,
    source_tasks: reviewPack.review.source_outputs.length,
    human_art: reviewPack.review.gates.human_art,
    rights: reviewPack.review.gates.rights,
    runtime: reviewPack.review.gates.runtime,
    raspberry_pi: reviewPack.review.gates.raspberry_pi,
    remote_request_count: 0,
    output,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : 'Production review pack build failed.';
  console.error(`MAPSOO_PRODUCTION_REVIEW_PACK_ERROR ${message}`);
  process.exitCode = 1;
});
