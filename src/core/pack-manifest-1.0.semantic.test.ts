import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import packSchema from '../../schemas/mapsoo-pack-1.0.schema.json';
import committedPublicFixture from '../../tests/fixtures/pack10-public/mapsoo.manifest.json';
import {
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
  LAYERED_DEPTH_REQUIRED_ROLES,
} from './layered-depth-asset-bundle';
import {
  PACK_1_0_PLANE_BINDINGS,
  validatePack10Manifest,
  type Pack10Manifest,
  type Pack10RoleBinding,
} from './pack-manifest-1.0';

const HASH = 'a'.repeat(64);
const PLANE_FILES = new Map(PACK_1_0_PLANE_BINDINGS.map(
  ([id, role]) => [role, `layers/${id}.png`],
));
const ENVIRONMENT_ROLES = LAYERED_DEPTH_REQUIRED_ROLES.filter((role) =>
  role.startsWith('terrain.')
  || role.startsWith('prop.')
  || role.startsWith('structure.')
  || role.startsWith('collectible.')
  || role.startsWith('effect.'));

type DeepMutable<T> =
  T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;
type MutablePack10Manifest = DeepMutable<Pack10Manifest>;

function character(
  id: 'player' | 'npc',
  actions: readonly string[],
): DeepMutable<Pack10Manifest['characters'][number]> {
  let frameIndex = 0;
  return {
    id,
    atlas: `atlases/${id}.png`,
    frame_size: [48, 72],
    pivot: [24, 67],
    clips: actions.flatMap((action) => LAYERED_DEPTH_DIRECTIONS.map((direction) => {
      const first = frameIndex;
      frameIndex += 2;
      return {
        id: `${action}.${direction}`,
        action,
        direction,
        frames: [
          {
            x: first * 48,
            y: 0,
            duration_ms: 160,
            provenance: 'independent-generated-pose' as const,
          },
          {
            x: (first + 1) * 48,
            y: 0,
            duration_ms: 160,
            provenance: 'declared-synthetic-variant' as const,
          },
        ],
      };
    })),
  };
}

function publicFixture(): MutablePack10Manifest {
  const roles: Pack10RoleBinding[] = [
    ...PACK_1_0_PLANE_BINDINGS.map(([, role]) => ({
      role,
      binding: { kind: 'file' as const, path: PLANE_FILES.get(role) as string },
    })),
    ...ENVIRONMENT_ROLES.map((role, index) => ({
      role,
      binding: {
        kind: 'atlas-region' as const,
        atlas: 'environment',
        region: { x: index * 96, y: 0, width: 96, height: 96 },
      },
    })),
    {
      role: 'character.player.atlas',
      binding: { kind: 'file', path: 'atlases/player.png' },
    },
    {
      role: 'character.npc.atlas',
      binding: { kind: 'file', path: 'atlases/npc.png' },
    },
    { role: 'world.scene', binding: { kind: 'file', path: 'runtime/scene.json' } },
    { role: 'world.collision', binding: { kind: 'file', path: 'runtime/collision.json' } },
    { role: 'world.navigation', binding: { kind: 'file', path: 'runtime/navigation.json' } },
    { role: 'world.preview', binding: { kind: 'file', path: 'previews/world.png' } },
  ];
  roles.sort(
    (left, right) =>
      LAYERED_DEPTH_REQUIRED_ROLES.indexOf(left.role as typeof LAYERED_DEPTH_REQUIRED_ROLES[number])
      - LAYERED_DEPTH_REQUIRED_ROLES.indexOf(right.role as typeof LAYERED_DEPTH_REQUIRED_ROLES[number]),
  );
  const paths = [
    ...PLANE_FILES.values(),
    'atlases/environment.png',
    'atlases/player.png',
    'atlases/npc.png',
    'runtime/scene.json',
    'runtime/collision.json',
    'runtime/navigation.json',
    'previews/world.png',
    'license-assets.md',
  ];
  return {
    schema_version: '1.0.0-draft.1',
    pack: {
      id: 'neutral-public-layered-world',
      title: 'Neutral public layered world',
      version: '1.0.0',
      generator: { name: 'Mapsoo Worldsmith', version: '1.0.0' },
      created_at: '2026-07-26T16:00:00.000Z',
    },
    profile: 'layered-depth-2d',
    distribution: 'public',
    review: {
      human_art: 'pass',
      rights: 'pass',
      runtime: 'pass',
      raspberry_pi: 'pass',
    },
    compatibility: {
      godot_min: '4.3',
      projection: 'layered-depth-stage',
      art_style: 'pixel_art',
      importer: { id: 'mapsoo_importer', min_version: '1.0.0' },
    },
    planes: PACK_1_0_PLANE_BINDINGS.map(([id, role]) => ({
      id,
      role,
      path: PLANE_FILES.get(role) as string,
      layer: id,
      blend: id === 'ambient-light' ? 'multiply' : id === 'local-light' ? 'add' : 'mix',
    })),
    atlases: [
      { id: 'environment', path: 'atlases/environment.png', cell_size: [96, 96] },
      { id: 'player', path: 'atlases/player.png', cell_size: [48, 72] },
      { id: 'npc', path: 'atlases/npc.png', cell_size: [48, 72] },
    ],
    roles,
    characters: [
      character('player', LAYERED_DEPTH_PLAYER_ACTIONS),
      character('npc', LAYERED_DEPTH_NPC_ACTIONS),
    ],
    runtime: {
      scene: { path: 'runtime/scene.json' },
      collision: { path: 'runtime/collision.json' },
      navigation: { path: 'runtime/navigation.json' },
      spawn: { x: 112, y: 286 },
    },
    files: paths.map((path) => ({
      path,
      media_type: path.endsWith('.png')
        ? 'image/png'
        : path.endsWith('.md')
          ? 'text/markdown'
          : 'application/json',
      bytes: 10,
      sha256: HASH,
    })),
    license: {
      output: {
        id: 'CC-BY-4.0',
        notice_path: 'license-assets.md',
        permits_redistribution: true,
        permits_commercial_use: true,
      },
    },
    provenance: {
      output_provenance: 'generative-ai',
      contains_generative_ai: true,
      model_provider: 'neutral-model-provider',
      model: 'neutral-image-model',
      human_curated: true,
      source_manifest_hashes: ['b'.repeat(64)],
    },
    reference_policy: {
      embedded: false,
      original_references_excluded: true,
      raw_prompts_excluded: true,
      only_one_way_audit_hashes_retained: true,
    },
  } as MutablePack10Manifest;
}

function issueCodes(manifest: Pack10Manifest): string[] {
  return validatePack10Manifest(manifest).map(({ code }) => code);
}

describe('Pack 1.0 semantic validator', () => {
  it('accepts the committed deterministic public fixture', () => {
    expect(validatePack10Manifest(
      committedPublicFixture as unknown as Pack10Manifest,
    )).toEqual([]);
  });

  it('accepts a neutral complete public fixture in JSON Schema and semantic validation', () => {
    const value = publicFixture();
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(packSchema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(validatePack10Manifest(value)).toEqual([]);
    expect(value.roles.map(({ role }) => role)).toEqual(LAYERED_DEPTH_REQUIRED_ROLES);
    expect(value.characters[0].clips).toHaveLength(16);
    expect(value.characters[1].clips).toHaveLength(8);
  });

  it('accepts an optional exact-byte WorldLayoutPlan binding and rejects mismatched integrity', () => {
    const value = publicFixture();
    value.layout = {
      schema_version: '1.0.0',
      document_type: 'world-layout-plan',
      plan_id: 'neutral-layered-layout',
      path: 'world-layout-plan.json',
      sha256: HASH,
    };
    value.files.push({
      path: 'world-layout-plan.json',
      media_type: 'application/json',
      bytes: 10,
      sha256: HASH,
    });
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(packSchema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(validatePack10Manifest(value)).toEqual([]);

    value.layout.sha256 = 'f'.repeat(64);
    expect(issueCodes(value)).toContain('layout.file-record');
  });

  it('enforces distinct internal-review, private and public authorization gates', () => {
    const internal = publicFixture();
    internal.distribution = 'internal-review';
    internal.review.human_art = 'pending';
    internal.review.rights = 'pending';
    internal.review.raspberry_pi = 'pending';
    internal.license.output.id = 'LicenseRef-UNRELEASED';
    internal.license.output.permits_redistribution = false;
    internal.license.output.permits_commercial_use = false;
    internal.provenance.human_curated = false;
    expect(validatePack10Manifest(internal)).toEqual([]);

    internal.license.output.permits_redistribution = true;
    expect(issueCodes(internal)).toContain('authorization.internal-review');

    const privatePack = publicFixture();
    privatePack.distribution = 'private';
    privatePack.review.raspberry_pi = 'pending';
    privatePack.license.output.id = 'LicenseRef-Private-Use';
    privatePack.license.output.permits_redistribution = false;
    expect(validatePack10Manifest(privatePack)).toEqual([]);
    privatePack.review.rights = 'pending';
    expect(issueCodes(privatePack)).toContain('authorization.private');

    const publicPack = publicFixture();
    publicPack.review.raspberry_pi = 'pending';
    expect(issueCodes(publicPack)).toContain('authorization.public');
    publicPack.review.raspberry_pi = 'pass';
    publicPack.provenance.human_curated = false;
    expect(issueCodes(publicPack)).toContain('authorization.public');

    const restrictedPublic = publicFixture();
    restrictedPublic.license.output.id = 'LicenseRef-Proprietary';
    restrictedPublic.license.output.permits_commercial_use = false;
    expect(issueCodes(restrictedPublic)).toContain('authorization.public');
  });

  it('rejects missing files, dangling role atlases and aliased role regions', () => {
    const missingFile = publicFixture();
    missingFile.files = missingFile.files.filter(({ path }) => path !== 'runtime/scene.json');
    expect(issueCodes(missingFile)).toContain('file.missing-reference');

    const missingAtlas = publicFixture();
    const firstRegion = missingAtlas.roles.find(
      ({ binding }) => binding.kind === 'atlas-region',
    ) as Pack10RoleBinding & { binding: { kind: 'atlas-region'; atlas: string } };
    firstRegion.binding.atlas = 'missing-atlas';
    expect(issueCodes(missingAtlas)).toContain('role.missing-atlas');

    const aliased = publicFixture();
    const regions = aliased.roles.filter(
      ({ binding }) => binding.kind === 'atlas-region',
    ) as (Pack10RoleBinding & {
      binding: {
        kind: 'atlas-region';
        region: { x: number; y: number; width: number; height: number };
      };
    })[];
    regions[1].binding.region = { ...regions[0].binding.region };
    expect(issueCodes(aliased)).toContain('role.alias');

    const missingRegion = publicFixture();
    const terrain = missingRegion.roles.find(({ role }) => role === 'terrain.ground');
    if (!terrain) throw new Error('Fixture must contain terrain.ground.');
    terrain.binding = { kind: 'file', path: 'atlases/environment.png' };
    expect(issueCodes(missingRegion)).toContain('role.binding-kind');
  });

  it('requires complete canonical multi-frame character references', () => {
    const missingClip = publicFixture();
    missingClip.characters[0].clips = missingClip.characters[0].clips.slice(1);
    expect(issueCodes(missingClip)).toContain('character.missing-clip');

    const badFrame = publicFixture();
    badFrame.characters[0].clips[0].frames[1].x =
      badFrame.characters[0].clips[0].frames[0].x;
    expect(issueCodes(badFrame)).toContain('character.frame');

    const reusedFrame = publicFixture();
    reusedFrame.characters[0].clips[1].frames[0].x =
      reusedFrame.characters[0].clips[0].frames[0].x;
    expect(issueCodes(reusedFrame)).toContain('character.frame');

    const missingAtlas = publicFixture();
    missingAtlas.characters[1].atlas = 'atlases/missing-npc.png';
    expect(issueCodes(missingAtlas)).toContain('character.atlas');
  });

  it('rejects source-reference paths, raw-prompt fields and weakened exclusion policy', () => {
    const referencePath = publicFixture();
    referencePath.files.push({
      path: 'source-references/character.png',
      media_type: 'image/png',
      bytes: 10,
      sha256: HASH,
    });
    expect(issueCodes(referencePath)).toContain('privacy.source-material');

    const rawPrompt = publicFixture() as unknown as Pack10Manifest & { raw_prompt: string };
    rawPrompt.raw_prompt = 'must never be exported';
    expect(issueCodes(rawPrompt)).toContain('privacy.source-material');

    const weakPolicy = publicFixture();
    (weakPolicy.reference_policy as { raw_prompts_excluded: boolean }).raw_prompts_excluded = false;
    expect(issueCodes(weakPolicy)).toContain('privacy.reference-policy');
  });
});
