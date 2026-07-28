import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

import {
  buildCharacterProfileFamily,
} from '../src/app/build-character-profile-family';
import {
  inspectReferenceImageBytes,
  MAX_REFERENCE_IMAGE_BYTES,
  type ReferenceImageMediaType,
  type ReferenceImageRole,
} from '../src/core/reference-image';
import type {
  LocalReferenceImage,
} from '../src/app/generate-reference-world-pack';

interface Arguments {
  readonly characterPath: string;
  readonly environmentPath: string;
  readonly characterId: string;
  readonly familyId: string;
  readonly description: string;
  readonly seed: string;
  readonly completedAt: string;
  readonly outputPath: string;
  readonly distribution: 'internal-review' | 'public';
}

const HELP = `Mapsoo WorldForge four-profile character family builder

Usage:
  pnpm character-family:build -- \\
    --character <character.png|jpg> \\
    --environment <environment.png|jpg> \\
    --character-id <lowercase-kebab-id> \\
    --family-id <lowercase-kebab-id> \\
    --description <world description> \\
    --seed <reproducible seed> \\
    --completed-at <UTC ISO instant> \\
    --out <new output directory> \\
    --confirm-owned-references

Description may instead be read from --description-file <utf8.txt>.

Default output status is internal-review. To mark the generated CC0 baseline
as public, add both:
  --distribution public --confirm-public-release

The command refuses an existing output directory. Source images, source paths,
raw source file digests and free-text descriptions are never copied there.
`;

function fail(message: string): never {
  throw new Error(`character-family:build: ${message}`);
}

function argumentMap(argv: readonly string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`unexpected positional argument ${token}.`);
    if (flags.has(token)) fail(`duplicate option ${token}.`);
    if (
      token === '--confirm-owned-references'
      || token === '--confirm-public-release'
      || token === '--help'
    ) {
      flags.set(token, true);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`${token} requires a value.`);
    }
    flags.set(token, value);
    index += 1;
  }
  return flags;
}

function required(flags: Map<string, string | true>, key: string): string {
  const value = flags.get(key);
  if (typeof value !== 'string' || value.length < 1) fail(`${key} is required.`);
  return value;
}

async function parseArguments(argv: readonly string[]): Promise<Arguments | 'help'> {
  const flags = argumentMap(argv);
  if (flags.has('--help')) {
    if (flags.size !== 1) fail('--help cannot be combined with other options.');
    return 'help';
  }
  const allowed = new Set([
    '--character',
    '--environment',
    '--character-id',
    '--family-id',
    '--description',
    '--description-file',
    '--seed',
    '--completed-at',
    '--out',
    '--distribution',
    '--confirm-owned-references',
    '--confirm-public-release',
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) fail(`unsupported option ${key}.`);
  }
  if (flags.get('--confirm-owned-references') !== true) {
    fail(
      '--confirm-owned-references is required; it confirms adaptation, redistribution, and CC0 output permission.',
    );
  }
  const inlineDescription = flags.get('--description');
  const descriptionFile = flags.get('--description-file');
  if (
    (typeof inlineDescription === 'string') === (typeof descriptionFile === 'string')
  ) {
    fail('use exactly one of --description or --description-file.');
  }
  const description = typeof inlineDescription === 'string'
    ? inlineDescription
    : await readBoundedText(resolve(descriptionFile as string), 'description file');
  const distributionValue = flags.get('--distribution') ?? 'internal-review';
  if (distributionValue !== 'internal-review' && distributionValue !== 'public') {
    fail('--distribution must be internal-review or public.');
  }
  if (
    distributionValue === 'public'
    && flags.get('--confirm-public-release') !== true
  ) {
    fail('public distribution requires --confirm-public-release.');
  }
  if (
    distributionValue === 'internal-review'
    && flags.has('--confirm-public-release')
  ) {
    fail('--confirm-public-release is valid only with --distribution public.');
  }
  return Object.freeze({
    characterPath: resolve(required(flags, '--character')),
    environmentPath: resolve(required(flags, '--environment')),
    characterId: required(flags, '--character-id'),
    familyId: required(flags, '--family-id'),
    description,
    seed: required(flags, '--seed'),
    completedAt: required(flags, '--completed-at'),
    outputPath: resolve(required(flags, '--out')),
    distribution: distributionValue,
  });
}

async function readBoundedText(path: string, label: string): Promise<string> {
  const bytes = await readFile(path);
  if (bytes.byteLength < 1 || bytes.byteLength > 16 * 1024) {
    fail(`${label} must be between 1 byte and 16 KiB.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`${label} must contain strict UTF-8.`);
  }
  return text!.replace(/\r\n/g, '\n').trim();
}

function mediaType(bytes: Uint8Array): ReferenceImageMediaType {
  const png = [137, 80, 78, 71, 13, 10, 26, 10]
    .every((byte, index) => bytes[index] === byte);
  if (png) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  fail('reference images must contain PNG or JPEG bytes.');
}

async function readReference(
  path: string,
  role: ReferenceImageRole,
): Promise<LocalReferenceImage> {
  const source = await readFile(path);
  if (source.byteLength < 1 || source.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    fail(`the ${role} image must be between 1 byte and ${MAX_REFERENCE_IMAGE_BYTES} bytes.`);
  }
  const bytes = Uint8Array.from(source);
  const type = mediaType(bytes);
  const dimensions = inspectReferenceImageBytes(bytes, type);
  const character = role === 'character';
  return Object.freeze({
    role,
    descriptor: Object.freeze({
      id: character ? 'character-reference' : 'environment-reference',
      role,
      path: character
        ? `references/character.${type === 'image/png' ? 'png' : 'jpg'}`
        : `references/environment.${type === 'image/png' ? 'png' : 'jpg'}`,
      mediaType: type,
      byteLength: bytes.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      rights: Object.freeze({
        basis: 'owned' as const,
        license: 'LicenseRef-User-Owned',
        allowGenerativeAdaptation: true as const,
        allowOutputRedistribution: true as const,
        allowOutputCc0Dedication: true as const,
      }),
    }),
    bytes,
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeNewOutput(
  outputPath: string,
  files: Awaited<ReturnType<typeof buildCharacterProfileFamily>>['files'],
): Promise<void> {
  if (await pathExists(outputPath)) {
    fail(`output already exists: ${outputPath}`);
  }
  const parent = dirname(outputPath);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${basename(outputPath)}.tmp-`));
  let committed = false;
  try {
    for (const file of files) {
      const destination = resolve(staging, ...file.path.split('/'));
      const fromStaging = relative(resolve(staging), destination);
      if (
        fromStaging.length < 1
        || isAbsolute(fromStaging)
        || fromStaging === '..'
        || fromStaging.startsWith(`..\\`)
        || fromStaging.startsWith('../')
      ) {
        fail(`generated file path escaped the staging directory: ${file.path}`);
      }
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.bytes, { flag: 'wx' });
    }
    await rename(staging, outputPath);
    committed = true;
  } finally {
    if (!committed) await rm(staging, { recursive: true, force: true });
  }
}

const parsed = await parseArguments(process.argv.slice(2));
if (parsed === 'help') {
  process.stdout.write(HELP);
  process.exit(0);
}

const [character, environment] = await Promise.all([
  readReference(parsed.characterPath, 'character'),
  readReference(parsed.environmentPath, 'environment-style'),
]);
const built = await buildCharacterProfileFamily({
  familyId: parsed.familyId,
  characterId: parsed.characterId,
  character,
  environment,
  description: parsed.description,
  seed: parsed.seed,
  completedAt: parsed.completedAt,
  distribution: parsed.distribution,
});
await writeNewOutput(parsed.outputPath, built.files);

process.stdout.write(
  `MAPSOO_CHARACTER_FAMILY_OK family=${built.family.family_id}`
    + ` character=${built.family.character_id}`
    + ` profiles=${built.family.profiles.length}`
    + ` files=${built.files.length}`
    + ` status=${built.family.status}`
    + ` art_quality=${built.artQuality}`
    + ` human_review=${built.humanArtReview}`
    + ' source_images=false source_paths=false source_file_digests=false'
    + ` output=${parsed.outputPath}\n`,
);
