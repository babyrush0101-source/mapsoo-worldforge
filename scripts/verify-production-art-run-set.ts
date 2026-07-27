import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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

function usage(): string {
  return [
    'Mapsoo Worldforge — production-art run-set verifier',
    '',
    'Verify one completed four-profile model-art run-set without remote calls:',
    '  pnpm production-art:run-set:verify -- --runs-manifest=<path>',
    '',
    'The command reads local frozen run directories but never writes, uploads,',
    'publishes, or embeds their paths in a pack.',
  ].join('\n');
}

function argument(argv: readonly string[]): string {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(usage());
    process.exit(0);
  }
  if (argv.length !== 1 || !argv[0].startsWith('--runs-manifest=')) {
    throw new Error('Use exactly --runs-manifest=<path>.');
  }
  const value = argv[0].slice('--runs-manifest='.length);
  if (!value || value.trim() !== value) throw new Error('Run-set path is invalid.');
  return value;
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
  const output = parseJson<ProductionArtOutput>(outputBytes, `${taskId} output`);
  const evidence = parseJson<ProductionArtGenerationEvidence>(
    evidenceBytes,
    `${taskId} evidence`,
  );
  return {
    output,
    evidence,
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

async function main(): Promise<void> {
  const manifestPath = resolve(argument(process.argv.slice(2)));
  const runSet = materializeProductionArtRunSet(parseJson<unknown>(
    await readFile(manifestPath),
    'Production art run-set',
  ));
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
  const inventory = await materializeProductionArtRunInventory(plan, runSet, results);
  console.log(JSON.stringify({
    status: 'production-art-run-set-valid',
    profile: inventory.profile,
    plan_id: inventory.plan_id,
    tasks: inventory.items.length,
    providers: inventory.providers,
    models: inventory.models,
    human_review: 'required',
    remote_request_count: 0,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : 'Production art run-set verification failed.';
  console.error(`MAPSOO_PRODUCTION_ART_RUN_SET_ERROR ${message}`);
  process.exitCode = 1;
});
