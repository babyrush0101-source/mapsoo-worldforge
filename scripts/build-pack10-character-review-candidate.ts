import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import JSZip from 'jszip';

import {
  buildPack10CharacterReviewCandidate,
  type Pack10CharacterReviewArtifact,
} from '../src/adapters/build-pack10-character-review-candidate';
import type {
  LayeredDepthCharacterProjectionRecord,
} from '../src/adapters/project-layered-depth-production-character';
import type {
  ProductionArtGenerationEvidence,
} from '../src/adapters/normalize-production-art-png';
import type {
  Pack10Manifest,
} from '../src/core/pack-manifest-1.0';

// @ts-expect-error The privacy helper intentionally remains a plain Node ESM module.
import { containsPrivateConsumerToken } from './lib/private-consumer-boundary.mjs';

const VALUE_FLAGS = new Set([
  '--base-pack',
  '--player-run',
  '--npc-run',
  '--out',
  '--pack-id',
  '--title',
  '--version',
  '--created-at',
]);

interface Arguments {
  readonly help: boolean;
  readonly basePack: string;
  readonly playerRun: string;
  readonly npcRun: string;
  readonly out: string;
  readonly packId: string;
  readonly title: string;
  readonly version: string;
  readonly createdAt: string;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — Pack 1.0 character review candidate builder',
    '',
    'Prerequisite:',
    '  pnpm pack10:fixture:build',
    '',
    'Build one non-redistributable internal-review ZIP:',
    '  pnpm pack10:character-review:build -- \\',
    '    --base-pack tests/fixtures/pack10-public/mapsoo-pack10-public-fixture.zip \\',
    '    --player-run docs/visual-qa/production-art/model-runs/layered-depth-2d/character-character-player-atlas/<run> \\',
    '    --npc-run docs/visual-qa/production-art/model-runs/layered-depth-2d/character-character-npc-atlas/<run> \\',
    '    --out review-output/neutral-character-review.zip \\',
    '    --pack-id neutral-character-review-world \\',
    '    --title "Neutral Character Review World" \\',
    '    --version 1.0.0-review.1 \\',
    '    --created-at 2026-07-27T18:00:00.000Z',
    '',
    'This command makes no remote request and never embeds source images, raw prompts,',
    'local paths, API keys, world briefs, or style bibles.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Arguments {
  if (argv.length === 1 && argv[0] === '--help') {
    return {
      help: true,
      basePack: '',
      playerRun: '',
      npcRun: '',
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
  const required = [...VALUE_FLAGS];
  if (required.some((flag) => !values.has(flag))) {
    throw new Error('Every documented Pack 1.0 character-review flag is required.');
  }
  return {
    help: false,
    basePack: values.get('--base-pack') as string,
    playerRun: values.get('--player-run') as string,
    npcRun: values.get('--npc-run') as string,
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

async function loadArtifact(directoryValue: string): Promise<Pack10CharacterReviewArtifact> {
  const directory = resolve(directoryValue);
  const [atlasPngBytes, projectionBytes, characterBytes, evidenceBytes] = await Promise.all([
    readFile(resolve(directory, 'runtime-atlas.png')),
    readFile(resolve(directory, 'projection.json')),
    readFile(resolve(directory, 'pack-character.json')),
    readFile(resolve(directory, 'evidence.json')),
  ]);
  return {
    atlasPngBytes: Uint8Array.from(atlasPngBytes),
    projection: parseJson<LayeredDepthCharacterProjectionRecord>(
      projectionBytes,
      'Projection record',
    ),
    character: parseJson<Pack10Manifest['characters'][number]>(
      characterBytes,
      'Pack character record',
    ),
    generationEvidence: parseJson<ProductionArtGenerationEvidence>(
      evidenceBytes,
      'Generation evidence',
    ),
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
  const [basePack, player, npc] = await Promise.all([
    readFile(resolve(args.basePack)),
    loadArtifact(args.playerRun),
    loadArtifact(args.npcRun),
  ]);
  const candidate = await buildPack10CharacterReviewCandidate(
    Uint8Array.from(basePack),
    player,
    npc,
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
    status: 'internal-review-candidate-written',
    distribution: 'internal-review',
    pack_id: candidate.manifest.pack.id,
    sha256: candidate.sha256,
    files: candidate.manifest.files.length,
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
    : 'Pack 1.0 character review candidate build failed.';
  console.error(`MAPSOO_PACK10_CHARACTER_REVIEW_ERROR ${message}`);
  process.exitCode = 1;
});
