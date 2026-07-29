import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  assembleReviewedCharacterProfileFamily,
  type ReviewedCharacterProfileSources,
} from '../src/app/assemble-reviewed-character-profile-family';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../src/core/asset-profile';

const INPUT_FILES = Object.freeze({
  characterProfileRevisionBytes: 'character-profile-revision.json',
  characterProjectionRecordBytes: 'character-profile-projection.json',
  runtimeOverlayBytes: 'world-art-runtime-overlay.zip',
  approvedWorldReviewBytes: 'approved-world-review.json',
  humanArtReviewReceiptBytes: 'human-art-review-receipt.json',
} as const);
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Arguments {
  readonly familyId: string;
  readonly inputRoot: string;
  readonly outputDirectory: string;
  readonly help: boolean;
}

function usage(): string {
  return [
    'Assemble four human-reviewed player candidates into one source-free family.',
    '',
    'Usage:',
    '  pnpm character-family:reviewed:assemble -- \\',
    '    --family-id <portable-id> \\',
    '    --input-root <private-reviewed-root> \\',
    '    --output-dir <new-output-directory>',
    '',
    'Each <input-root>/<profile>/ directory must contain:',
    ...Object.values(INPUT_FILES).map((name) => `  - ${name}`),
    '',
    `Profiles: ${WORLD_ASSET_PROFILES.join(', ')}`,
    '',
    'The output directory must not already exist. Original references, prompts,',
    'world captures, review receipts, and overlays are verified but not exported.',
  ].join('\n');
}

function parseArguments(values: readonly string[]): Arguments {
  const parsed = new Map<string, string>();
  let help = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === '--') continue;
    if (value === '--help') {
      help = true;
      continue;
    }
    if (!['--family-id', '--input-root', '--output-dir'].includes(value)) {
      throw new Error(`Unknown argument: ${value}`);
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--') || parsed.has(value)) {
      throw new Error(`${value} requires exactly one value.`);
    }
    parsed.set(value, next);
    index += 1;
  }
  if (help) {
    return {
      help: true,
      familyId: 'help',
      inputRoot: process.cwd(),
      outputDirectory: process.cwd(),
    };
  }
  const familyId = parsed.get('--family-id');
  const inputRoot = parsed.get('--input-root');
  const outputDirectory = parsed.get('--output-dir');
  if (
    !familyId
    || !SAFE_ID.test(familyId)
    || familyId.length > 48
    || !inputRoot
    || !outputDirectory
  ) {
    throw new Error(
      '--family-id, --input-root, and --output-dir are required; family id uses lowercase kebab-case.',
    );
  }
  return {
    help: false,
    familyId,
    inputRoot: resolve(inputRoot),
    outputDirectory: resolve(outputDirectory),
  };
}

async function readProfile(
  inputRoot: string,
  profile: WorldAssetProfile,
): Promise<ReviewedCharacterProfileSources[WorldAssetProfile]> {
  const directory = resolve(inputRoot, profile);
  const entries = await Promise.all(Object.entries(INPUT_FILES).map(
    async ([key, filename]) => [
      key,
      Uint8Array.from(await readFile(resolve(directory, filename))),
    ] as const,
  ));
  return Object.freeze(Object.fromEntries(entries)) as
    ReviewedCharacterProfileSources[WorldAssetProfile];
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const pairs = await Promise.all(WORLD_ASSET_PROFILES.map(async (profile) =>
    [profile, await readProfile(args.inputRoot, profile)] as const));
  const assembled = await assembleReviewedCharacterProfileFamily({
    familyId: args.familyId,
    sources: Object.freeze(Object.fromEntries(pairs)) as
      ReviewedCharacterProfileSources,
  });
  await mkdir(args.outputDirectory, { recursive: false });
  await Promise.all(assembled.files.map(async (file) => {
    const target = resolve(args.outputDirectory, file.path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, file.bytes, { flag: 'wx' });
  }));
  console.log(JSON.stringify({
    status: assembled.family.status,
    family_id: assembled.family.family_id,
    character_id: assembled.family.character_id,
    profiles: assembled.family.profiles.map(({ profile }) => profile),
    files: assembled.files.length,
    source_images_included: assembled.sourceImagesIncluded,
    review_evidence_included: assembled.reviewEvidenceIncluded,
    godot_family_runtime: assembled.runtimeAcceptance,
    raspberry_pi: assembled.raspberryPiAcceptance,
    output_directory: args.outputDirectory,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
