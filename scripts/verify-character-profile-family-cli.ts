import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  join,
  relative,
  resolve,
} from 'node:path';

import { encodeRgbaPng } from '../src/adapters/canvas/encode-png';
import { materializeCharacterProfileFamily } from '../src/core/character-profile-family';
import { WORLD_ASSET_PROFILES } from '../src/core/asset-profile';

const execute = promisify(execFile);
const CLI = resolve('scripts/build-character-profile-family.ts');
const VITE_NODE = resolve('node_modules/vite-node/vite-node.mjs');

function png(width: number, height: number, character: boolean): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const subject = character
        ? x >= 14 && x < width - 14 && y >= 8 && y < height - 3
        : y > height / 2 || (x > width / 3 && x < width / 2);
      const color = subject
        ? (character ? [126, 44, 82, 255] : [65, 116, 73, 255])
        : (character ? [0, 0, 0, 0] : [92, 156, 202, 255]);
      rgba.set(color, offset);
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

async function inventory(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        files.push(relative(root, absolute).replaceAll('\\', '/'));
      } else {
        throw new Error(`Unsupported output entry ${absolute}.`);
      }
    }
  }
  await visit(root);
  return files.sort();
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength < 1 || needle.byteLength > haystack.byteLength) return false;
  outer: for (
    let offset = 0;
    offset <= haystack.byteLength - needle.byteLength;
    offset += 1
  ) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

const root = await mkdtemp(join(tmpdir(), 'mapsoo-character-family-cli-'));
try {
  const characterPath = join(root, 'private-character-filename.png');
  const environmentPath = join(root, 'private-environment-filename.png');
  const descriptionPath = join(root, 'private-description.txt');
  const output = join(root, 'family-output');
  const characterBytes = png(64, 96, true);
  const environmentBytes = png(128, 96, false);
  const description = 'PRIVATE-CLI-DESCRIPTION-MARKER anonymous test world.';
  await Promise.all([
    writeFile(characterPath, characterBytes),
    writeFile(environmentPath, environmentBytes),
    writeFile(descriptionPath, description, 'utf8'),
  ]);
  const baseArgs = [
    VITE_NODE,
    CLI,
    '--character', characterPath,
    '--environment', environmentPath,
    '--character-id', 'cli-traveler',
    '--family-id', 'cli-traveler-family',
    '--description-file', descriptionPath,
    '--seed', 'cli-family-seed',
    '--completed-at', '2026-07-28T00:00:00.000Z',
    '--out', output,
    '--confirm-owned-references',
  ];
  const success = await execute(process.execPath, baseArgs, {
    cwd: resolve('.'),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (
    !success.stdout.includes('MAPSOO_CHARACTER_FAMILY_OK')
    || !success.stdout.includes('profiles=4')
    || !success.stdout.includes('source_images=false')
    || success.stderr.trim().length > 0
  ) {
    throw new Error(`Unexpected character-family CLI output: ${success.stdout}${success.stderr}`);
  }
  const expected = [
    'character-profile-family.json',
    'readme.md',
    ...WORLD_ASSET_PROFILES.flatMap((profile) => [
      `profiles/${profile}/character-profile-atlas.png`,
      `profiles/${profile}/character-profile-revision.json`,
    ]),
  ].sort();
  const actual = await inventory(output);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Character-family CLI inventory mismatch: ${actual.join(', ')}.`);
  }
  const family = materializeCharacterProfileFamily(JSON.parse(
    await readFile(join(output, 'character-profile-family.json'), 'utf8'),
  ));
  if (
    family.status !== 'internal-review'
    || family.profiles.length !== 4
    || family.review.production_ready !== false
  ) {
    throw new Error('Character-family CLI produced an unsafe family status.');
  }
  const forbidden = [
    characterBytes,
    environmentBytes,
    new TextEncoder().encode(characterPath),
    new TextEncoder().encode(environmentPath),
    new TextEncoder().encode(descriptionPath),
    new TextEncoder().encode(description),
  ];
  for (const path of actual) {
    const bytes = await readFile(join(output, ...path.split('/')));
    if (forbidden.some((value) => contains(bytes, value))) {
      throw new Error(`Character-family CLI leaked a private source value into ${path}.`);
    }
  }

  let repeatedFailed = false;
  try {
    await execute(process.execPath, baseArgs, {
      cwd: resolve('.'),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    repeatedFailed = String(error).includes('output already exists');
  }
  if (!repeatedFailed) throw new Error('Character-family CLI did not refuse an existing output.');

  let publicFailed = false;
  try {
    await execute(process.execPath, [
      ...baseArgs.slice(0, -1),
      '--distribution', 'public',
      '--confirm-owned-references',
    ], {
      cwd: resolve('.'),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    publicFailed = String(error).includes('--confirm-public-release');
  }
  if (!publicFailed) {
    throw new Error('Character-family CLI allowed public status without explicit confirmation.');
  }

  process.stdout.write(
    `MAPSOO_CHARACTER_FAMILY_CLI_OK profiles=${family.profiles.length}`
      + ` files=${actual.length} default_status=${family.status}`
      + ' source_images=false private_metadata=false overwrite_refused=true'
      + ' public_confirmation_required=true\n',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
