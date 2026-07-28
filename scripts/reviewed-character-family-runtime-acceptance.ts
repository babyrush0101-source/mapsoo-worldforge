import {
  access,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';

import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';
import {
  buildReviewedCharacterFamilyRuntimeAcceptance,
  serializeReviewedCharacterFamilyRuntimeAcceptanceCanonical,
  verifyReviewedCharacterFamilyRuntimeAcceptance,
  type ReviewedCharacterFamilyRuntimeRun,
} from '../src/core/reviewed-character-family-runtime-acceptance';
import {
  materializeReviewedCharacterProfileFamily,
  verifyReviewedCharacterProfileFamily,
  type ReviewedCharacterProfileFamilyArtifacts,
} from '../src/core/reviewed-character-profile-family';
import {
  WORLD_ASSET_PROFILES,
} from '../src/core/asset-profile';

interface Arguments {
  readonly mode: 'prepare' | 'receipt' | 'verify';
  readonly familyDirectory: string;
  readonly stageDirectory?: string;
  readonly runJson?: string;
  readonly output?: string;
}

function fail(message: string): never {
  throw new Error(`reviewed-character-runtime: ${message}`);
}

function parseArguments(values: readonly string[]): Arguments {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index]!;
    if (key === '--') continue;
    if (!['--mode', '--family-dir', '--stage-dir', '--run-json', '--out']
      .includes(key)) {
      fail(`unknown argument: ${key}`);
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--') || parsed.has(key)) {
      fail(`${key} requires exactly one value.`);
    }
    parsed.set(key, next);
    index += 1;
  }
  const mode = parsed.get('--mode');
  const familyDirectory = parsed.get('--family-dir');
  if (
    !familyDirectory
    || !mode
    || !['prepare', 'receipt', 'verify'].includes(mode)
  ) {
    fail('--mode and --family-dir are required.');
  }
  if (mode === 'prepare' && !parsed.get('--stage-dir')) {
    fail('prepare requires --stage-dir.');
  }
  if (
    mode === 'receipt'
    && (!parsed.get('--run-json') || !parsed.get('--out'))
  ) {
    fail('receipt requires --run-json and --out.');
  }
  if (mode === 'verify' && !parsed.get('--out')) {
    fail('verify requires --out <existing receipt>.');
  }
  return {
    mode: mode as Arguments['mode'],
    familyDirectory: resolve(familyDirectory),
    ...(parsed.get('--stage-dir')
      ? { stageDirectory: resolve(parsed.get('--stage-dir')!) }
      : {}),
    ...(parsed.get('--run-json')
      ? { runJson: resolve(parsed.get('--run-json')!) }
      : {}),
    ...(parsed.get('--out') ? { output: resolve(parsed.get('--out')!) } : {}),
  };
}

function strictJson(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(`${label} must be strict UTF-8.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) fail(parsed.message);
  return parsed.value;
}

function safeTarget(root: string, portablePath: string): string {
  const target = resolve(root, ...portablePath.split('/'));
  const fromRoot = relative(root, target);
  if (
    fromRoot.length < 1
    || isAbsolute(fromRoot)
    || fromRoot === '..'
    || fromRoot.startsWith('../')
    || fromRoot.startsWith('..\\')
  ) {
    fail(`artifact path escaped the family root: ${portablePath}`);
  }
  return target;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadFamily(directory: string) {
  const manifestPath = resolve(
    directory,
    'reviewed-character-profile-family.json',
  );
  const familyBytes = Uint8Array.from(await readFile(manifestPath));
  const family = materializeReviewedCharacterProfileFamily(
    strictJson(familyBytes, 'Reviewed character family manifest'),
  );
  const artifacts = Object.freeze(Object.fromEntries(await Promise.all(
    family.profiles.map(async (member) => {
      const revisionBytes = Uint8Array.from(await readFile(
        safeTarget(directory, member.revision_path),
      ));
      const atlasBytes = Uint8Array.from(await readFile(
        safeTarget(directory, member.atlas_path),
      ));
      return [member.profile, {
        revision: strictJson(
          revisionBytes,
          `${member.profile} character revision`,
        ),
        revisionBytes,
        atlasBytes,
      }] as const;
    }),
  ))) as ReviewedCharacterProfileFamilyArtifacts;
  await verifyReviewedCharacterProfileFamily(family, artifacts);
  return { family, familyBytes, artifacts };
}

const args = parseArguments(process.argv.slice(2));
const loaded = await loadFamily(args.familyDirectory);
if (args.mode === 'prepare') {
  if (await exists(args.stageDirectory!)) {
    fail(`stage directory already exists: ${args.stageDirectory}`);
  }
  await mkdir(args.stageDirectory!, { recursive: false });
  const files = [
    {
      path: 'reviewed-character-profile-family.json',
      bytes: loaded.familyBytes,
    },
    ...loaded.family.profiles.flatMap((member) => [
      {
        path: member.revision_path,
        bytes: loaded.artifacts[member.profile].revisionBytes,
      },
      {
        path: member.atlas_path,
        bytes: loaded.artifacts[member.profile].atlasBytes,
      },
    ]),
  ];
  for (const file of files) {
    const target = safeTarget(args.stageDirectory!, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { flag: 'wx' });
  }
  process.stdout.write(
    `MAPSOO_REVIEWED_CHARACTER_RUNTIME_PREPARED profiles=${
      WORLD_ASSET_PROFILES.length
    } files=${files.length} exact_artifacts=true\n`,
  );
} else if (args.mode === 'receipt') {
  const runsValue = strictJson(
    Uint8Array.from(await readFile(args.runJson!)),
    'Godot runtime run evidence',
  );
  if (!Array.isArray(runsValue)) fail('run evidence must be an array.');
  const acceptance = await buildReviewedCharacterFamilyRuntimeAcceptance({
    ...loaded,
    runs: runsValue as readonly ReviewedCharacterFamilyRuntimeRun[],
  });
  const bytes =
    serializeReviewedCharacterFamilyRuntimeAcceptanceCanonical(acceptance);
  await mkdir(dirname(args.output!), { recursive: true });
  await writeFile(args.output!, bytes, { flag: 'wx' });
  process.stdout.write(
    `MAPSOO_REVIEWED_CHARACTER_RUNTIME_RECEIPT_OK acceptance_id=${
      acceptance.acceptance_id
    } profiles=4 runs=2 exact_artifacts=true\n`,
  );
} else {
  const acceptanceBytes = Uint8Array.from(await readFile(args.output!));
  const acceptance = await verifyReviewedCharacterFamilyRuntimeAcceptance(
    strictJson(acceptanceBytes, 'Runtime acceptance receipt'),
    loaded.family,
    loaded.familyBytes,
    loaded.artifacts,
  );
  process.stdout.write(
    `MAPSOO_REVIEWED_CHARACTER_RUNTIME_RECEIPT_VERIFIED acceptance_id=${
      acceptance.acceptance_id
    } profiles=4 runs=2 exact_artifacts=true\n`,
  );
}
