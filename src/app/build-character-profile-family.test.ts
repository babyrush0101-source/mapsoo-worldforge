import { describe, expect, it } from 'vitest';

import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import {
  buildCharacterProfileFamily,
  type CharacterProfileFamilyFile,
} from './build-character-profile-family';
import {
  materializeCharacterProfileRevision,
  type CharacterProfileRevision,
} from '../core/character-profile-revision';
import {
  verifyCharacterProfileFamily,
  type CharacterProfileFamilyArtifacts,
} from '../core/character-profile-family';
import { WORLD_ASSET_PROFILES } from '../core/asset-profile';
import type {
  LocalReferenceImage,
} from './generate-reference-world-pack';

type Color = readonly [number, number, number, number];

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fillRect(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: Color,
): void {
  for (let targetY = y; targetY < y + rectHeight; targetY += 1) {
    for (let targetX = x; targetX < x + rectWidth; targetX += 1) {
      if (
        targetX < 0
        || targetY < 0
        || targetX >= width
        || targetY >= height
      ) continue;
      pixels.set(color, (targetY * width + targetX) * 4);
    }
  }
}

function characterPng(): Uint8Array {
  const width = 64;
  const height = 96;
  const rgba = new Uint8Array(width * height * 4);
  fillRect(rgba, width, height, 18, 12, 28, 22, [38, 45, 58, 255]);
  fillRect(rgba, width, height, 21, 28, 22, 19, [224, 166, 116, 255]);
  fillRect(rgba, width, height, 16, 47, 32, 30, [126, 44, 82, 255]);
  fillRect(rgba, width, height, 14, 51, 7, 24, [230, 166, 48, 255]);
  fillRect(rgba, width, height, 43, 51, 7, 24, [230, 166, 48, 255]);
  fillRect(rgba, width, height, 20, 77, 10, 17, [42, 55, 70, 255]);
  fillRect(rgba, width, height, 35, 77, 10, 17, [42, 55, 70, 255]);
  return encodeRgbaPng(width, height, rgba);
}

function environmentPng(): Uint8Array {
  const width = 128;
  const height = 96;
  const rgba = new Uint8Array(width * height * 4);
  fillRect(rgba, width, height, 0, 0, width, 56, [94, 157, 201, 255]);
  fillRect(rgba, width, height, 0, 56, width, 40, [63, 112, 71, 255]);
  fillRect(rgba, width, height, 12, 42, 30, 34, [83, 66, 49, 255]);
  fillRect(rgba, width, height, 18, 49, 18, 27, [206, 163, 73, 255]);
  fillRect(rgba, width, height, 76, 30, 10, 48, [73, 56, 42, 255]);
  fillRect(rgba, width, height, 61, 18, 42, 23, [42, 103, 62, 255]);
  return encodeRgbaPng(width, height, rgba);
}

async function reference(
  role: LocalReferenceImage['role'],
  bytes: Uint8Array,
): Promise<LocalReferenceImage> {
  const character = role === 'character';
  return Object.freeze({
    role,
    descriptor: Object.freeze({
      id: character ? 'private-character-input' : 'private-environment-input',
      role,
      path: character
        ? 'private-inputs/secret-character-name.png'
        : 'private-inputs/secret-environment-name.png',
      mediaType: 'image/png' as const,
      byteLength: bytes.byteLength,
      width: character ? 64 : 128,
      height: 96,
      sha256: await sha256(bytes),
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

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
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

function file(
  files: readonly CharacterProfileFamilyFile[],
  path: string,
): CharacterProfileFamilyFile {
  const found = files.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`Missing family file ${path}.`);
  return found;
}

describe('build character profile family', () => {
  it('exports one source-free Godot character identity across all four profiles', async () => {
    const characterBytes = characterPng();
    const environmentBytes = environmentPng();
    const [character, environment] = await Promise.all([
      reference('character', characterBytes),
      reference('environment-style', environmentBytes),
    ]);
    const description = 'PRIVATE-FREE-TEXT-MARKER: an anonymous orchard beneath two moons.';
    const result = await buildCharacterProfileFamily({
      familyId: 'anonymous-traveler-family',
      characterId: 'anonymous-traveler',
      character,
      environment,
      description,
      seed: 'anonymous-family-seed',
      completedAt: '2026-07-28T00:00:00.000Z',
    });

    expect(result.files).toHaveLength(10);
    expect(result.family.profiles.map(({ profile }) => profile))
      .toEqual(WORLD_ASSET_PROFILES);
    expect(result.family.rights).toEqual({
      distribution: 'internal-review',
      license: 'CC0-1.0',
    });
    expect(result.family.review).toEqual({
      human_art_review: 'required',
      production_ready: false,
    });
    expect(result.sourceImagesIncluded).toBe(false);

    const forbidden = [
      characterBytes,
      environmentBytes,
      new TextEncoder().encode(character.descriptor.path),
      new TextEncoder().encode(environment.descriptor.path),
      new TextEncoder().encode(character.descriptor.sha256),
      new TextEncoder().encode(environment.descriptor.sha256),
      new TextEncoder().encode(description),
    ];
    for (const output of result.files) {
      expect(
        forbidden.some((needle) => containsBytes(output.bytes, needle)),
        `${output.path} leaked a private source value`,
      ).toBe(false);
    }

    const artifacts = Object.freeze(Object.fromEntries(
      WORLD_ASSET_PROFILES.map((profile) => {
        const revisionFile = file(
          result.files,
          `profiles/${profile}/character-profile-revision.json`,
        );
        const atlasFile = file(
          result.files,
          `profiles/${profile}/character-profile-atlas.png`,
        );
        const revision = materializeCharacterProfileRevision(
          JSON.parse(new TextDecoder().decode(revisionFile.bytes)),
        );
        expect(revision.profile).toBe(profile);
        expect(revision.character_id).toBe('anonymous-traveler');
        expect(revision.source_identity.identity_digest_sha256)
          .toBe(result.family.character_identity_sha256);
        return [profile, {
          revision,
          revisionBytes: revisionFile.bytes,
          atlasBytes: atlasFile.bytes,
        }];
      }),
    )) as CharacterProfileFamilyArtifacts;
    expect(await verifyCharacterProfileFamily(result.family, artifacts))
      .toEqual(result.family);
  }, 30_000);

  it('requires explicit valid roles, ids, text bounds and UTC completion time', async () => {
    const characterBytes = characterPng();
    const environmentBytes = environmentPng();
    const [character, environment] = await Promise.all([
      reference('character', characterBytes),
      reference('environment-style', environmentBytes),
    ]);
    await expect(buildCharacterProfileFamily({
      familyId: 'unsafe/family',
      characterId: 'anonymous-traveler',
      character,
      environment,
      description: 'Valid description.',
      seed: 'seed',
      completedAt: '2026-07-28',
    })).rejects.toThrow('familyId and characterId');
  });
});
