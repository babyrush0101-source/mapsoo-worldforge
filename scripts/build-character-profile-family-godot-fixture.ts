import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';

import { encodeRgbaPng } from '../src/adapters/canvas/encode-png';
import {
  buildCharacterProfileFamily,
} from '../src/app/build-character-profile-family';
import type {
  LocalReferenceImage,
} from '../src/app/generate-reference-world-pack';
import type {
  ReferenceImageRole,
} from '../src/core/reference-image';

function fail(message: string): never {
  throw new Error(`character-family:godot:fixture: ${message}`);
}

function outputArgument(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--out' || argv[1].startsWith('--')) {
    fail('usage: --out <new fixture directory>.');
  }
  return resolve(argv[1]);
}

function fixturePng(width: number, height: number, character: boolean): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (character) {
        const head = x >= 20 && x < 44 && y >= 12 && y < 42;
        const coat = x >= 15 && x < 49 && y >= 42 && y < 77;
        const legs = (
          (x >= 20 && x < 30) || (x >= 35 && x < 45)
        ) && y >= 77 && y < 94;
        const scarf = x >= 15 && x < 54 && y >= 42 && y < 50;
        const color = scarf
          ? [230, 166, 48, 255]
          : head
            ? [224, 166, 116, 255]
            : coat
              ? [126, 44, 82, 255]
              : legs
                ? [42, 55, 70, 255]
                : [0, 0, 0, 0];
        rgba.set(color, offset);
      } else {
        const structure = x >= 14 && x < 48 && y >= 42 && y < 79;
        const tree = x >= 72 && x < 103 && y >= 22 && y < 78;
        const ground = y >= 58;
        const color = structure
          ? [201, 159, 75, 255]
          : tree
            ? [42, 103, 62, 255]
            : ground
              ? [63, 112, 71, 255]
              : [94, 157, 201, 255];
        rgba.set(color, offset);
      }
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

function reference(
  role: ReferenceImageRole,
  bytes: Uint8Array,
  width: number,
  height: number,
): LocalReferenceImage {
  const character = role === 'character';
  return Object.freeze({
    role,
    descriptor: Object.freeze({
      id: character ? 'character-reference' : 'environment-reference',
      role,
      path: character
        ? 'fixtures/character-family/character.png'
        : 'fixtures/character-family/environment.png',
      mediaType: 'image/png' as const,
      byteLength: bytes.byteLength,
      width,
      height,
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const outputRoot = outputArgument(process.argv.slice(2));
if (await exists(outputRoot)) fail(`output already exists: ${outputRoot}`);
const characterBytes = fixturePng(64, 96, true);
const environmentBytes = fixturePng(128, 96, false);
const family = await buildCharacterProfileFamily({
  familyId: 'godot-character-family-fixture',
  characterId: 'fixture-traveler',
  character: reference('character', characterBytes, 64, 96),
  environment: reference('environment-style', environmentBytes, 128, 96),
  description: 'An anonymous deterministic world used only for Godot runtime verification.',
  seed: 'godot-character-family-seed',
  completedAt: '2026-07-28T00:00:00.000Z',
});
await mkdir(outputRoot, { recursive: false });
for (const file of family.files) {
  const path = resolve(outputRoot, ...file.path.split('/'));
  const fromRoot = relative(outputRoot, path);
  if (
    fromRoot.length < 1
    || isAbsolute(fromRoot)
    || fromRoot === '..'
    || fromRoot.startsWith('../')
    || fromRoot.startsWith('..\\')
  ) {
    fail(`generated file path escaped output: ${file.path}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.bytes, { flag: 'wx' });
}
process.stdout.write(
  `MAPSOO_CHARACTER_FAMILY_FIXTURE_OK profiles=${family.family.profiles.length}`
    + ` files=${family.files.length} status=${family.family.status}`
    + ' source_images=false private_metadata=false\n',
);
