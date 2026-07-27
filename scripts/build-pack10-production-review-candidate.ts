import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import JSZip from 'jszip';

import {
  buildPack10ProductionReviewCandidate,
  type Pack10ProductionEnvironmentArtifact,
} from '../src/adapters/build-pack10-production-review-candidate';
import type { Pack10CharacterReviewArtifact } from '../src/adapters/build-pack10-character-review-candidate';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from '../src/adapters/normalize-production-art-png';
import {
  projectLayeredDepthProductionAtlases,
} from '../src/adapters/project-layered-depth-production-atlases';
import {
  projectLayeredDepthProductionCharacter,
} from '../src/adapters/project-layered-depth-production-character';
import {
  projectLayeredDepthProductionLayers,
} from '../src/adapters/project-layered-depth-production-layers';
import {
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtRights,
} from '../src/core/production-art-contract';
import {
  materializeProductionArtRunSet,
  type ProductionArtRunSet,
} from '../src/core/production-art-run-set';
import {
  materializeProductionArtRunInventory,
} from '../src/adapters/materialize-production-art-run-inventory';

// @ts-expect-error The public privacy helper is intentionally plain ESM.
import { containsPrivateConsumerToken } from './lib/private-consumer-boundary.mjs';

const TASK_IDS = Object.freeze(createProductionArtPlan('layered-depth-2d', {
  distribution: 'internal-review',
  license: 'LicenseRef-Proprietary',
}).tasks.map(({ task_id: taskId }) => taskId));

const VALUE_FLAGS = new Set([
  '--base-pack',
  '--runs-manifest',
  '--out',
  '--pack-id',
  '--title',
  '--version',
  '--created-at',
]);

interface Arguments {
  readonly help: boolean;
  readonly basePack: string;
  readonly runsManifest: string;
  readonly out: string;
  readonly packId: string;
  readonly title: string;
  readonly version: string;
  readonly createdAt: string;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — complete Pack 1.0 production review candidate builder',
    '',
    'Build one non-redistributable internal-review ZIP from frozen local model runs:',
    '  pnpm pack10:production-review:build -- \\',
    '    --base-pack tests/fixtures/pack10-public/mapsoo-pack10-public-fixture.zip \\',
    '    --runs-manifest review-input/layered-depth-run-set.json \\',
    '    --out review-output/neutral-production-review.zip \\',
    '    --pack-id neutral-production-review-world \\',
    '    --title "Neutral Production Review World" \\',
    '    --version 1.0.0-review.2 \\',
    '    --created-at 2026-07-27T20:00:00.000Z',
    '',
    'The run-set JSON must map exactly 14 canonical task ids to local run',
    'directories containing source.png, normalized.png, output.json and evidence.json.',
    'Paths are resolved relative to the run-set file and are never embedded.',
    'This command makes no remote request and never publishes a candidate.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Arguments {
  if (argv.length === 1 && argv[0] === '--help') {
    return {
      help: true,
      basePack: '',
      runsManifest: '',
      out: '',
      packId: '',
      title: '',
      version: '',
      createdAt: '',
    };
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!VALUE_FLAGS.has(flag)) throw new Error('Unknown or unsupported CLI flag.');
    if (values.has(flag)) throw new Error('Duplicate CLI flag.');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('CLI flag value is missing.');
    values.set(flag, value);
    index += 1;
  }
  if ([...VALUE_FLAGS].some((flag) => !values.has(flag))) {
    throw new Error('Every documented Pack 1.0 production-review flag is required.');
  }
  return {
    help: false,
    basePack: values.get('--base-pack') as string,
    runsManifest: values.get('--runs-manifest') as string,
    out: values.get('--out') as string,
    packId: values.get('--pack-id') as string,
    title: values.get('--title') as string,
    version: values.get('--version') as string,
    createdAt: values.get('--created-at') as string,
  };
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new Error(`${label} is not strict UTF-8 JSON.`);
  }
}

function parseRunSet(value: unknown): ProductionArtRunSet {
  const runSet = materializeProductionArtRunSet(value);
  if (runSet.profile !== 'layered-depth-2d') {
    throw new Error('Pack 1.0 production review accepts only layered-depth-2d runs.');
  }
  return runSet;
}

async function loadResult(
  manifestDirectory: string,
  taskId: typeof TASK_IDS[number],
  directoryValue: string,
): Promise<NormalizedProductionArtResult> {
  const directory = resolve(manifestDirectory, directoryValue);
  const [sourceBytes, normalizedBytes, outputBytes, evidenceBytes] = await Promise.all([
    readFile(resolve(directory, 'source.png')),
    readFile(resolve(directory, 'normalized.png')),
    readFile(resolve(directory, 'output.json')),
    readFile(resolve(directory, 'evidence.json')),
  ]);
  const output = parseJson<ProductionArtOutput>(outputBytes, `${taskId} output`);
  const evidence = parseJson<ProductionArtGenerationEvidence>(
    evidenceBytes,
    `${taskId} evidence`,
  );
  if (output.task_id !== taskId || evidence.task_id !== taskId) {
    throw new Error(`Run directory does not match its declared task: ${taskId}.`);
  }
  const source = Uint8Array.from(sourceBytes);
  const normalized = Uint8Array.from(normalizedBytes);
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

function characterArtifact(
  projection: Awaited<ReturnType<typeof projectLayeredDepthProductionCharacter>>,
  result: NormalizedProductionArtResult,
): Pack10CharacterReviewArtifact {
  return {
    projection: projection.record,
    character: projection.character,
    generationEvidence: result.evidence,
    atlasPngBytes: projection.png.readBytes(),
  };
}

async function assertPrivateBoundary(zipBytes: Uint8Array): Promise<void> {
  const archive = await JSZip.loadAsync(zipBytes, { checkCRC32: true });
  const textual = await Promise.all(Object.values(archive.files)
    .filter((entry) => !entry.dir && !entry.name.endsWith('.png'))
    .map((entry) => entry.async('text')));
  if (containsPrivateConsumerToken(textual.join('\n'))) {
    throw new Error('Candidate crosses the private consumer boundary.');
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const outputPath = resolve(args.out);
  if (!outputPath.toLowerCase().endsWith('.zip')) {
    throw new Error('Output must use a .zip filename.');
  }
  const runManifestPath = resolve(args.runsManifest);
  const runSet = parseRunSet(parseJson<unknown>(
    await readFile(runManifestPath),
    'Production run-set',
  ));
  const manifestDirectory = dirname(runManifestPath);
  const entries = await Promise.all(TASK_IDS.map(async (taskId) => [
    taskId,
    await loadResult(manifestDirectory, taskId, runSet.runs[taskId]),
  ] as const));
  let results = new Map(entries);
  const direction = results.get('scene-direction') as NormalizedProductionArtResult;
  const rights = direction.output.rights as ProductionArtRights;
  const plan = createProductionArtPlan('layered-depth-2d', rights);
  const inventory = await materializeProductionArtRunInventory(
    plan,
    runSet,
    Object.fromEntries(entries),
  );
  results = new Map(inventory.items.map((item) => [item.task.task_id, item]));
  const layerResults = plan.tasks
    .filter(({ kind }) => kind === 'background-layer')
    .map(({ task_id: taskId }) => results.get(taskId) as NormalizedProductionArtResult);
  const sheetResults = ['terrain-sheet', 'prop-sheet', 'effect-sheet']
    .map((taskId) => results.get(taskId) as NormalizedProductionArtResult);
  const playerResult = results.get(
    'character-character-player-atlas',
  ) as NormalizedProductionArtResult;
  const npcResult = results.get(
    'character-character-npc-atlas',
  ) as NormalizedProductionArtResult;
  const [layers, environmentAtlases, playerProjection, npcProjection, basePack] =
    await Promise.all([
      projectLayeredDepthProductionLayers(plan, direction, layerResults),
      projectLayeredDepthProductionAtlases(plan, direction, sheetResults),
      projectLayeredDepthProductionCharacter(plan, playerResult),
      projectLayeredDepthProductionCharacter(plan, npcResult),
      readFile(resolve(args.basePack)),
    ]);
  const environment: Pack10ProductionEnvironmentArtifact = {
    layers,
    environmentAtlases,
    generationEvidence: [
      direction.evidence,
      ...layerResults.map(({ evidence }) => evidence),
      ...sheetResults.map(({ evidence }) => evidence),
    ],
  };
  const candidate = await buildPack10ProductionReviewCandidate(
    Uint8Array.from(basePack),
    characterArtifact(playerProjection, playerResult),
    characterArtifact(npcProjection, npcResult),
    environment,
    {
      packId: args.packId,
      title: args.title,
      version: args.version,
      createdAt: args.createdAt,
    },
  );
  await assertPrivateBoundary(candidate.bytes);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, candidate.bytes, { flag: 'wx' });
  console.log(JSON.stringify({
    status: 'complete-production-internal-review-candidate-written',
    distribution: 'internal-review',
    pack_id: candidate.manifest.pack.id,
    sha256: candidate.sha256,
    files: candidate.manifest.files.length,
    planes: candidate.manifest.planes.length,
    atlases: candidate.manifest.atlases.length,
    roles: candidate.manifest.roles.length,
    characters: candidate.manifest.characters.length,
    human_art: 'pending',
    rights: 'pending',
    runtime: 'pending',
    raspberry_pi: 'pending',
    remote_request_count: 0,
    output: relative(process.cwd(), outputPath).replaceAll('\\', '/'),
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : 'Pack 1.0 production review candidate build failed.';
  console.error(`MAPSOO_PACK10_PRODUCTION_REVIEW_ERROR ${message}`);
  process.exitCode = 1;
});
