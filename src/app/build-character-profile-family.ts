import JSZip from 'jszip';

import { decodeReferenceImageRgba } from '../adapters/decode-reference-image-rgba';
import {
  generateReferenceWorldPack,
  type LocalReferenceImage,
} from './generate-reference-world-pack';
import {
  materializeCharacterProfileRevision,
  serializeCharacterProfileRevisionCanonical,
  type CharacterProfileDistribution,
  type CharacterProfileRevision,
  type CharacterProfileRights,
} from '../core/character-profile-revision';
import {
  materializeCharacterProfileFamily,
  serializeCharacterProfileFamilyCanonical,
  verifyCharacterProfileFamily,
  type CharacterProfileFamily,
  type CharacterProfileFamilyArtifact,
  type CharacterProfileFamilyArtifacts,
} from '../core/character-profile-family';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../core/asset-profile';

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface BuildCharacterProfileFamilyInput {
  readonly familyId: string;
  readonly characterId: string;
  readonly environment: LocalReferenceImage;
  readonly character: LocalReferenceImage;
  readonly description: string;
  readonly seed: string;
  readonly completedAt: string;
  readonly distribution?: Extract<
  CharacterProfileDistribution,
  'private' | 'internal-review' | 'public'
  >;
  readonly signal?: AbortSignal;
}

export interface CharacterProfileFamilyFile {
  readonly path: string;
  readonly mediaType: 'application/json' | 'image/png' | 'text/markdown';
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface BuiltCharacterProfileFamily {
  readonly family: CharacterProfileFamily;
  readonly files: readonly CharacterProfileFamilyFile[];
  readonly sourceImagesIncluded: false;
  readonly artQuality: 'procedural-baseline';
  readonly humanArtReview: 'required';
}

interface PackManifestFrame {
  readonly x: number;
  readonly y: number;
}

interface PackManifestClip {
  readonly id: string;
  readonly action: CharacterProfileRevision['clips'][number]['action'];
  readonly direction: CharacterProfileRevision['clips'][number]['direction'];
  readonly fps: number;
  readonly frames: readonly PackManifestFrame[];
}

interface PackManifestCharacter {
  readonly id: string;
  readonly atlas: string;
  readonly frame_size: readonly [number, number];
  readonly pivot: readonly [number, number];
  readonly clips: readonly PackManifestClip[];
}

interface PackManifest {
  readonly profile: WorldAssetProfile;
  readonly character?: PackManifestCharacter;
  readonly characters?: readonly PackManifestCharacter[];
  readonly files: readonly Readonly<{
    path: string;
    bytes: number;
    sha256: string;
  }>[];
}

interface ExtractedProfile {
  readonly revision: CharacterProfileRevision;
  readonly revisionBytes: Uint8Array;
  readonly atlasBytes: Uint8Array;
  readonly revisionSha256: string;
  readonly atlasSha256: string;
  readonly environmentStyleSignatureSha256: string;
}

function fail(message: string): never {
  throw new Error(`Character family export: ${message}`);
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Character family export was aborted.', 'AbortError');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertInput(input: BuildCharacterProfileFamilyInput): void {
  if (
    !SAFE_ID.test(input.familyId)
    || input.familyId.length > 40
    || !SAFE_ID.test(input.characterId)
    || input.characterId.length > 48
  ) {
    fail('familyId and characterId must use bounded lowercase kebab-case.');
  }
  if (
    input.environment.role !== 'environment-style'
    || input.environment.descriptor.role !== 'environment-style'
    || input.character.role !== 'character'
    || input.character.descriptor.role !== 'character'
  ) {
    fail('one environment-style image and one character image are required.');
  }
  if (
    typeof input.description !== 'string'
    || input.description !== input.description.trim()
    || input.description.length < 1
    || Array.from(input.description).length > 4_000
    || typeof input.seed !== 'string'
    || input.seed !== input.seed.trim()
    || input.seed.length < 1
    || Array.from(input.seed).length > 128
  ) {
    fail('description and seed must contain bounded, trimmed text.');
  }
  if (
    typeof input.completedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.completedAt)
    || new Date(input.completedAt).toISOString() !== (
      input.completedAt.includes('.') ? input.completedAt : input.completedAt.replace('Z', '.000Z')
    )
  ) {
    fail('completedAt must be a canonical UTC instant.');
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function boundTextDigest(domain: string, value: string): Promise<string> {
  return sha256(new TextEncoder().encode(`${domain}\u0000${value}`));
}

function byteSequenceIndex(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return -1;
  outer: for (
    let offset = 0;
    offset <= haystack.byteLength - needle.byteLength;
    offset += 1
  ) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  return -1;
}

function parseManifest(bytes: Uint8Array, profile: WorldAssetProfile): PackManifest {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`${profile} pack manifest is not strict UTF-8 JSON.`, { cause: error });
  }
  if (!isRecord(value) || value.profile !== profile || !Array.isArray(value.files)) {
    fail(`${profile} pack manifest is incomplete or profile-mismatched.`);
  }
  return value as unknown as PackManifest;
}

function playerCharacter(
  manifest: PackManifest,
  profile: WorldAssetProfile,
): PackManifestCharacter {
  const candidate = manifest.character
    ?? manifest.characters?.find(({ id }) => id === 'player');
  if (
    !candidate
    || candidate.id !== 'player'
    || typeof candidate.atlas !== 'string'
    || !Array.isArray(candidate.frame_size)
    || candidate.frame_size.length !== 2
    || !Array.isArray(candidate.pivot)
    || candidate.pivot.length !== 2
    || !Array.isArray(candidate.clips)
  ) {
    fail(`${profile} pack has no valid player character declaration.`);
  }
  return candidate;
}

function loopForAction(action: string): boolean {
  return ['idle', 'walk', 'run', 'move', 'fall'].includes(action);
}

async function extractProfile(
  profile: WorldAssetProfile,
  input: BuildCharacterProfileFamilyInput,
  identityDigestSha256: string,
  rights: CharacterProfileRights,
): Promise<ExtractedProfile> {
  const generated = await generateReferenceWorldPack({
    profile,
    environment: input.environment,
    character: input.character,
    worldId: `${input.familyId}-${profile}`,
    description: input.description,
    seed: input.seed,
    completedAt: input.completedAt,
    signal: input.signal,
  });
  return extractProfileFromGenerated(
    profile,
    generated,
    input,
    identityDigestSha256,
    rights,
  );
}

/**
 * Generates one source-free, four-profile character family from one approved
 * character image plus the current world's environment-style reference.
 *
 * This is the deterministic procedural baseline used before model-backed art
 * replacement and human review. Raw references, source paths, raw file hashes,
 * free-text description and full world packs are deliberately omitted.
 */
export async function buildCharacterProfileFamily(
  input: BuildCharacterProfileFamilyInput,
): Promise<BuiltCharacterProfileFamily> {
  assertInput(input);
  abortIfNeeded(input.signal);
  const distribution = input.distribution ?? 'internal-review';
  const rights: CharacterProfileRights = Object.freeze({
    distribution,
    license: 'CC0-1.0',
  });
  const first = await generateReferenceWorldPack({
    profile: WORLD_ASSET_PROFILES[0],
    environment: input.environment,
    character: input.character,
    worldId: `${input.familyId}-${WORLD_ASSET_PROFILES[0]}`,
    description: input.description,
    seed: input.seed,
    completedAt: input.completedAt,
    signal: input.signal,
  });
  const identityDigestSha256 = first.characterIdentitySignatureSha256;
  abortIfNeeded(input.signal);

  const firstProfile = await extractProfileFromGenerated(
    WORLD_ASSET_PROFILES[0],
    first,
    input,
    identityDigestSha256,
    rights,
  );
  const remainingPairs = await Promise.all(WORLD_ASSET_PROFILES.slice(1).map(
    async (profile) => [profile, await extractProfile(
      profile,
      input,
      identityDigestSha256,
      rights,
    )] as const,
  ));
  const profiles = Object.freeze({
    [WORLD_ASSET_PROFILES[0]]: firstProfile,
    ...Object.fromEntries(remainingPairs),
  }) as Readonly<Record<WorldAssetProfile, ExtractedProfile>>;
  const environmentSignatures = new Set(
    WORLD_ASSET_PROFILES.map(
      (profile) => profiles[profile].environmentStyleSignatureSha256,
    ),
  );
  if (environmentSignatures.size !== 1) {
    fail('the four profiles changed the shared environment-style binding.');
  }

  const members = await Promise.all(WORLD_ASSET_PROFILES.map(async (profile) => {
    const projection = profiles[profile];
    return Object.freeze({
      profile,
      profile_revision_id: projection.revision.profile_revision_id,
      revision_path: `profiles/${profile}/character-profile-revision.json`,
      revision_sha256: projection.revisionSha256,
      atlas_path: `profiles/${profile}/character-profile-atlas.png`,
      atlas_sha256: projection.atlasSha256,
      clip_count: projection.revision.clips.length,
    });
  }));
  const family = materializeCharacterProfileFamily({
    schema_version: '1.0.0',
    document_type: 'character-profile-family',
    family_id: input.familyId,
    character_id: input.characterId,
    character_identity_sha256: identityDigestSha256,
    generation: {
      mode: 'procedural-reference-baseline',
      environment_style_signature_sha256: firstProfile.environmentStyleSignatureSha256,
      description_binding_sha256: await boundTextDigest(
        'mapsoo-character-family/description/v1',
        input.description,
      ),
      seed_binding_sha256: await boundTextDigest(
        'mapsoo-character-family/seed/v1',
        input.seed,
      ),
    },
    rights,
    profiles: members,
    privacy: {
      source_images_included: false,
      source_paths_included: false,
      source_file_digests_included: false,
      free_text_description_included: false,
    },
    review: {
      human_art_review: 'required',
      production_ready: false,
    },
    status: distribution,
  });

  const artifacts = Object.freeze(Object.fromEntries(
    WORLD_ASSET_PROFILES.map((profile) => {
      const projection = profiles[profile];
      return [profile, Object.freeze({
        revision: projection.revision,
        revisionBytes: projection.revisionBytes,
        atlasBytes: projection.atlasBytes,
      }) satisfies CharacterProfileFamilyArtifact];
    }),
  )) as CharacterProfileFamilyArtifacts;
  await verifyCharacterProfileFamily(family, artifacts);

  const familyBytes = serializeCharacterProfileFamilyCanonical(family);
  const readmeBytes = new TextEncoder().encode(
    '# Character profile family\n\n'
      + 'This directory contains one character identity adapted to all four '
      + 'Mapsoo 2D world profiles. Each profile directory contains a portable '
      + '`CharacterProfileRevision` and its PNG atlas.\n\n'
      + 'The source images, source paths, raw source file digests, free-text '
      + 'description, and generated world packs are intentionally excluded.\n\n'
      + 'Art status: deterministic procedural baseline. Human art and rights '
      + 'review are required before production release.\n',
  );
  const fileInputs = [
    {
      path: 'character-profile-family.json',
      mediaType: 'application/json' as const,
      bytes: familyBytes,
    },
    {
      path: 'readme.md',
      mediaType: 'text/markdown' as const,
      bytes: readmeBytes,
    },
    ...WORLD_ASSET_PROFILES.flatMap((profile) => {
      const projection = profiles[profile];
      return [
        {
          path: `profiles/${profile}/character-profile-revision.json`,
          mediaType: 'application/json' as const,
          bytes: projection.revisionBytes,
        },
        {
          path: `profiles/${profile}/character-profile-atlas.png`,
          mediaType: 'image/png' as const,
          bytes: projection.atlasBytes,
        },
      ];
    }),
  ];
  const files = Object.freeze(await Promise.all(fileInputs.map(async (file) => (
    Object.freeze({
      ...file,
      bytes: Uint8Array.from(file.bytes),
      sha256: await sha256(file.bytes),
    })
  ))));
  return Object.freeze({
    family,
    files,
    sourceImagesIncluded: false,
    artQuality: 'procedural-baseline',
    humanArtReview: 'required',
  });
}

async function extractProfileFromGenerated(
  profile: WorldAssetProfile,
  generated: Awaited<ReturnType<typeof generateReferenceWorldPack>>,
  input: BuildCharacterProfileFamilyInput,
  identityDigestSha256: string,
  rights: CharacterProfileRights,
): Promise<ExtractedProfile> {
  if (
    generated.profile !== profile
    || generated.characterIdentitySignatureSha256 !== identityDigestSha256
  ) {
    fail(`${profile} generated result does not bind the shared character identity.`);
  }
  abortIfNeeded(input.signal);
  const zip = await JSZip.loadAsync(generated.pack.bytes);
  const manifestEntries = Object.values(zip.files)
    .filter(({ dir, name }) => !dir && name.endsWith('/mapsoo.manifest.json'));
  if (manifestEntries.length !== 1) {
    fail(`${profile} pack must contain exactly one mapsoo.manifest.json.`);
  }
  const manifestEntry = manifestEntries[0];
  const manifest = parseManifest(await manifestEntry.async('uint8array'), profile);
  const character = playerCharacter(manifest, profile);
  const root = manifestEntry.name.slice(0, -'mapsoo.manifest.json'.length);
  const atlasEntry = zip.file(`${root}${character.atlas}`);
  if (!atlasEntry) fail(`${profile} pack is missing ${character.atlas}.`);
  const atlasBytes = await atlasEntry.async('uint8array');
  const atlasSha256 = await sha256(atlasBytes);
  const inventory = manifest.files.find(({ path }) => path === character.atlas);
  if (
    !inventory
    || inventory.bytes !== atlasBytes.byteLength
    || inventory.sha256 !== atlasSha256
  ) {
    fail(`${profile} character atlas does not match the pack inventory.`);
  }
  if (
    byteSequenceIndex(atlasBytes, input.character.bytes) >= 0
    || byteSequenceIndex(atlasBytes, input.environment.bytes) >= 0
  ) {
    fail(`${profile} character atlas contains a raw source image.`);
  }
  const decoded = await decodeReferenceImageRgba(atlasBytes, 'image/png');
  const [frameWidth, frameHeight] = character.frame_size;
  const [pivotX, pivotY] = character.pivot;
  if (
    !Number.isSafeInteger(frameWidth)
    || !Number.isSafeInteger(frameHeight)
    || frameWidth < 1
    || frameHeight < 1
    || decoded.width % frameWidth !== 0
    || decoded.height % frameHeight !== 0
  ) {
    fail(`${profile} character atlas has invalid frame geometry.`);
  }
  const revisionSeed = new TextEncoder().encode(JSON.stringify({
    family_id: input.familyId,
    character_id: input.characterId,
    profile,
    identity_digest_sha256: identityDigestSha256,
    atlas_sha256: atlasSha256,
  }));
  const revision = materializeCharacterProfileRevision({
    schema_version: '1.0.0',
    document_type: 'character-profile-revision',
    profile_revision_id: `${input.characterId}-${profile}-${
      (await sha256(revisionSeed)).slice(0, 16)
    }`,
    character_id: input.characterId,
    profile,
    atlas: {
      path: 'character-profile-atlas.png',
      media_type: 'image/png',
      bytes: atlasBytes.byteLength,
      sha256: atlasSha256,
      width: decoded.width,
      height: decoded.height,
    },
    frame_geometry: {
      frame_width: frameWidth,
      frame_height: frameHeight,
      columns: decoded.width / frameWidth,
      rows: decoded.height / frameHeight,
    },
    pivot: { x: pivotX, y: pivotY, unit: 'pixels' },
    clips: character.clips.map((clip) => ({
      clip_id: clip.id,
      action: clip.action,
      direction: clip.direction,
      fps: clip.fps,
      loop: loopForAction(clip.action),
      frames: clip.frames.map(({ x, y }) => {
        if (
          !Number.isSafeInteger(x)
          || !Number.isSafeInteger(y)
          || x < 0
          || y < 0
          || x % frameWidth !== 0
          || y % frameHeight !== 0
        ) {
          fail(`${profile} character clip ${clip.id} contains an unaligned frame.`);
        }
        return { column: x / frameWidth, row: y / frameHeight };
      }),
    })),
    source_identity: {
      identity_digest_sha256: identityDigestSha256,
      source_reference_ids: ['character-reference'],
    },
    rights,
  });
  const revisionBytes = serializeCharacterProfileRevisionCanonical(revision);
  return Object.freeze({
    revision,
    revisionBytes,
    atlasBytes: Uint8Array.from(atlasBytes),
    revisionSha256: await sha256(revisionBytes),
    atlasSha256,
    environmentStyleSignatureSha256: generated.environmentArtSignatureSha256,
  });
}
