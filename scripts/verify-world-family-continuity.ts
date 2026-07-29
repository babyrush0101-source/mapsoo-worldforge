import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../src/core/asset-profile';
import {
  createWorldFamilyContinuity,
  verifyWorldFamilyContinuity,
  type WorldFamilyContinuitySources,
} from '../src/core/world-family-continuity';

const PROFILE_FLAGS: Readonly<Record<WorldAssetProfile, Readonly<{
  intake: string;
  character: string;
}>>> = Object.freeze(Object.fromEntries(WORLD_ASSET_PROFILES.map((profile) => [
  profile,
  Object.freeze({
    intake: `--${profile}-intake`,
    character: `--${profile}-character`,
  }),
]))) as Readonly<Record<WorldAssetProfile, Readonly<{
  intake: string;
  character: string;
}>>>;

function usage(): string {
  return [
    'Mapsoo Worldforge — four-profile world-family continuity',
    '',
    'Create a source-bound receipt on stdout:',
    '  pnpm world-family:continuity -- --family-id=<id> \\',
    ...WORLD_ASSET_PROFILES.flatMap((profile, index) => [
      `    --${profile}-intake=<confirmed-intake.json> \\`,
      `    --${profile}-character=<character-profile-revision.json>${index === WORLD_ASSET_PROFILES.length - 1 ? '' : ' \\'}`,
    ]),
    '',
    'Verify an existing receipt against the same eight source documents:',
    '  add --receipt=<world-family-continuity.json>',
    '',
    'The command is read-only and prints no source paths or raw world facts.',
  ].join('\n');
}

function argumentsByName(argv: readonly string[]): ReadonlyMap<string, string> {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(usage());
    process.exit(0);
  }
  const allowed = new Set([
    '--family-id',
    '--receipt',
    ...WORLD_ASSET_PROFILES.flatMap((profile) => [
      PROFILE_FLAGS[profile].intake,
      PROFILE_FLAGS[profile].character,
    ]),
  ]);
  const values = new Map<string, string>();
  for (const argument of argv) {
    const separator = argument.indexOf('=');
    const name = separator === -1 ? argument : argument.slice(0, separator);
    const value = separator === -1 ? '' : argument.slice(separator + 1);
    if (
      !allowed.has(name)
      || !value
      || value.trim() !== value
      || values.has(name)
    ) {
      throw new Error(`Invalid or duplicate argument: ${name || '(empty)'}.`);
    }
    values.set(name, value);
  }
  const required = [
    '--family-id',
    ...WORLD_ASSET_PROFILES.flatMap((profile) => [
      PROFILE_FLAGS[profile].intake,
      PROFILE_FLAGS[profile].character,
    ]),
  ];
  const missing = required.filter((name) => !values.has(name));
  if (missing.length > 0) throw new Error(`Missing required arguments: ${missing.join(', ')}.`);
  if (values.size !== required.length && values.size !== required.length + 1) {
    throw new Error('Unsupported argument set.');
  }
  return values;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not strict UTF-8 JSON.`);
  }
}

async function main(): Promise<void> {
  const args = argumentsByName(process.argv.slice(2));
  const pairs = await Promise.all(WORLD_ASSET_PROFILES.map(async (profile) => {
    const flags = PROFILE_FLAGS[profile];
    const [intakeBytes, characterBytes] = await Promise.all([
      readFile(resolve(args.get(flags.intake) as string)),
      readFile(resolve(args.get(flags.character) as string)),
    ]);
    return [profile, Object.freeze({
      intake: parseJson(intakeBytes, `${profile} confirmed intake`),
      character_revision: parseJson(characterBytes, `${profile} character revision`),
    })] as const;
  }));
  const sources = Object.freeze(Object.fromEntries(pairs)) as WorldFamilyContinuitySources;
  const familyId = args.get('--family-id') as string;
  const receiptPath = args.get('--receipt');
  const receipt = receiptPath
    ? await verifyWorldFamilyContinuity(
      parseJson(await readFile(resolve(receiptPath)), 'World family continuity receipt'),
      sources,
    )
    : await createWorldFamilyContinuity(familyId, sources);
  if (receipt.family_id !== familyId) {
    throw new Error('Receipt family id does not match --family-id.');
  }
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'World family continuity failed.';
  console.error(`MAPSOO_WORLD_FAMILY_CONTINUITY_ERROR ${message}`);
  process.exitCode = 1;
});
