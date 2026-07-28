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
import {
  materializeCharacterProfileRevision,
  serializeCharacterProfileRevisionCanonical,
} from '../src/core/character-profile-revision';
import {
  materializeReviewedCharacterProfileFamily,
  serializeReviewedCharacterProfileFamilyCanonical,
  verifyReviewedCharacterProfileFamily,
  type ReviewedCharacterProfileFamilyArtifacts,
} from '../src/core/reviewed-character-profile-family';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../src/core/asset-profile';
import type { ReferenceImageRole } from '../src/core/reference-image';

function fail(message: string): never {
  throw new Error(`reviewed-character-runtime:fixture: ${message}`);
}

function outputArgument(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--out' || argv[1].startsWith('--')) {
    fail('usage: --out <new fixture directory>.');
  }
  return resolve(argv[1]);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixturePng(width: number, height: number, character: boolean): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const body = x >= 16 && x < 48 && y >= 20 && y < 90;
      const ground = y >= 65;
      rgba.set(
        character
          ? body ? [105, 64, 140, 255] : [0, 0, 0, 0]
          : ground ? [51, 112, 72, 255] : [104, 166, 210, 255],
        offset,
      );
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
      id: character ? 'synthetic-character' : 'synthetic-environment',
      role,
      path: character
        ? 'fixtures/runtime-contract/character.png'
        : 'fixtures/runtime-contract/environment.png',
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
    fail(`generated file path escaped output: ${portablePath}`);
  }
  return target;
}

const outputRoot = outputArgument(process.argv.slice(2));
if (await exists(outputRoot)) fail(`output already exists: ${outputRoot}`);

const characterBytes = fixturePng(64, 96, true);
const environmentBytes = fixturePng(128, 96, false);
const baseline = await buildCharacterProfileFamily({
  familyId: 'synthetic-reviewed-runtime-source',
  characterId: 'synthetic-runtime-traveler',
  character: reference('character', characterBytes, 64, 96),
  environment: reference(
    'environment-style',
    environmentBytes,
    128,
    96,
  ),
  description: 'Synthetic contract fixture; not evidence of a human art review.',
  seed: 'synthetic-reviewed-runtime-fixture-v1',
  completedAt: '2026-07-29T00:00:00.000Z',
});
const baselineFiles = new Map(
  baseline.files.map((file) => [file.path, file.bytes] as const),
);
const records = Object.fromEntries(await Promise.all(
  WORLD_ASSET_PROFILES.map(async (profile: WorldAssetProfile) => {
    const revisionPath =
      `profiles/${profile}/character-profile-revision.json`;
    const atlasPath = `profiles/${profile}/character-profile-atlas.png`;
    const baselineRevisionBytes = baselineFiles.get(revisionPath);
    const atlasBytes = baselineFiles.get(atlasPath);
    if (!baselineRevisionBytes || !atlasBytes) {
      fail(`${profile} baseline artifacts are missing.`);
    }
    const baselineRevision = JSON.parse(
      new TextDecoder().decode(baselineRevisionBytes),
    ) as Record<string, unknown>;
    const revision = materializeCharacterProfileRevision({
      ...baselineRevision,
      rights: {
        distribution: 'private',
        license: 'LicenseRef-Proprietary',
      },
    });
    const revisionBytes = serializeCharacterProfileRevisionCanonical(revision);
    return [profile, {
      revision,
      revisionBytes,
      revisionSha256: await sha256(revisionBytes),
      atlasBytes,
      atlasSha256: await sha256(atlasBytes),
    }] as const;
  }),
));
const family = materializeReviewedCharacterProfileFamily({
  schema_version: '1.0.0',
  document_type: 'reviewed-character-profile-family',
  family_id: 'synthetic-reviewed-runtime-fixture',
  character_id: 'synthetic-runtime-traveler',
  character_identity_sha256: baseline.family.character_identity_sha256,
  rights: {
    distribution: 'private',
    license: 'LicenseRef-Proprietary',
  },
  profiles: WORLD_ASSET_PROFILES.map((profile, index) => ({
    profile,
    profile_revision_id: records[profile].revision.profile_revision_id,
    revision_path:
      `profiles/${profile}/character-profile-revision.json`,
    revision_sha256: records[profile].revisionSha256,
    atlas_path: `profiles/${profile}/character-profile-atlas.png`,
    atlas_sha256: records[profile].atlasSha256,
    clip_count: records[profile].revision.clips.length,
    reviewed_source: {
      source_profile_revision_id: `synthetic-source-${index + 1}`,
      source_profile_revision_sha256: '1'.repeat(64),
      production_character_projection_sha256: '2'.repeat(64),
      runtime_overlay_sha256: '3'.repeat(64),
      runtime_projection_sha256: '4'.repeat(64),
      human_review_receipt_sha256: '5'.repeat(64),
      approved_world_review_sha256: '6'.repeat(64),
    },
  })),
  privacy: {
    source_images_included: false,
    source_paths_included: false,
    raw_prompts_included: false,
    provider_credentials_included: false,
  },
  review: {
    technical_world_review: 'passed',
    human_art_review: 'passed',
    exact_profile_count: 4,
    godot_family_runtime: 'pending',
    raspberry_pi: 'pending',
  },
  status: 'reviewed-release-candidate',
});
const artifacts = Object.freeze(Object.fromEntries(
  WORLD_ASSET_PROFILES.map((profile) => [profile, {
    revision: records[profile].revision,
    revisionBytes: records[profile].revisionBytes,
    atlasBytes: records[profile].atlasBytes,
  }]),
)) as ReviewedCharacterProfileFamilyArtifacts;
await verifyReviewedCharacterProfileFamily(family, artifacts);

const files = [
  {
    path: 'reviewed-character-profile-family.json',
    bytes: serializeReviewedCharacterProfileFamilyCanonical(family),
  },
  ...WORLD_ASSET_PROFILES.flatMap((profile) => [
    {
      path: `profiles/${profile}/character-profile-revision.json`,
      bytes: records[profile].revisionBytes,
    },
    {
      path: `profiles/${profile}/character-profile-atlas.png`,
      bytes: records[profile].atlasBytes,
    },
  ]),
];
await mkdir(outputRoot, { recursive: false });
for (const file of files) {
  const target = safeTarget(outputRoot, file.path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, file.bytes, { flag: 'wx' });
}
process.stdout.write(
  'MAPSOO_REVIEWED_CHARACTER_RUNTIME_FIXTURE_OK'
    + ` profiles=${family.profiles.length} files=${files.length}`
    + ' synthetic=true human_review_evidence=false\n',
);
