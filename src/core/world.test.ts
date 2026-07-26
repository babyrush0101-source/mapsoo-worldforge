import { describe, expect, it } from 'vitest';
import exampleWorldSpec from '../../examples/sunny-meadow-v0.2.world.json';
import alpha6ExampleWorldSpec from '../../examples/sunny-meadow-v0.3.world.json';
import { generateWorld } from './generate-world';
import { buildPackManifest, isSafePackPath } from './pack-manifest';
import { ALPHA6_DEFAULT_WORLD_SPEC, DEFAULT_WORLD_SPEC, cloneWorldSpec } from './world-spec';
import { validateGeneratedWorld, validateWorldSpec } from './validate-world';

const HASH = 'a'.repeat(64);

function manifestFiles(worldId = DEFAULT_WORLD_SPEC.id) {
  return [
    'readme.md',
    'license-assets.md',
    'generation-receipt.json',
    `worlds/${worldId}.world.json`,
    'worlds/demo-world.json',
    'atlases/terrain.png',
    'atlases/props.png',
    'previews/map-preview.png',
  ].map((path) => ({ path, media_type: 'application/octet-stream', bytes: 1, sha256: HASH }));
}

describe('world generation', () => {
  it('keeps the versioned example aligned with the built-in default', () => {
    expect(exampleWorldSpec).toEqual(DEFAULT_WORLD_SPEC);
    expect(alpha6ExampleWorldSpec).toEqual(ALPHA6_DEFAULT_WORLD_SPEC);
  });

  it('is deterministic for the same spec and seed', () => {
    const first = generateWorld(DEFAULT_WORLD_SPEC);
    const second = generateWorld(DEFAULT_WORLD_SPEC);

    expect(second.ground).toEqual(first.ground);
    expect(second.props).toEqual(first.props);
  });

  it('changes the world when the seed changes', () => {
    const next = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    next.seed = 'mapsoo-demo-002';

    expect(generateWorld(next).ground).not.toEqual(generateWorld(DEFAULT_WORLD_SPEC).ground);
  });

  it('produces a valid default world', () => {
    const issues = validateGeneratedWorld(generateWorld(DEFAULT_WORLD_SPEC));
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false);
    expect(issues.some((issue) => issue.code === 'world.ready')).toBe(true);
  });
});

describe('world spec validation', () => {
  it('rejects an unsafe world ID', () => {
    const spec = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    spec.id = '../Sunny Meadow';

    expect(validateWorldSpec(spec)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.invalid-id', severity: 'error' })]),
    );
  });

  it('rejects non-finite and fractional map dimensions before generation', () => {
    const spec = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    spec.map.width = Number.POSITIVE_INFINITY;
    spec.map.height = 12.5;

    expect(validateWorldSpec(spec)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.non-json-value', severity: 'error' })]),
    );
    expect(() => generateWorld(spec)).toThrow(/spec\.non-json-value/);
  });

  it('enforces the schema constants, bounded strings, palette, biome, and output tuple', () => {
    const spec = cloneWorldSpec(DEFAULT_WORLD_SPEC) as unknown as {
      schemaVersion: string;
      title: string;
      description: string;
      seed: string;
      visual: { style: string; tileSize: number; palette: string[] };
      map: { width: number; height: number; biome: string };
      output: { targets: string[]; assetLicense: string };
    };
    spec.schemaVersion = '99.0.0';
    spec.title = 'x'.repeat(121);
    spec.description = 'x'.repeat(1001);
    spec.seed = 'x'.repeat(161);
    spec.visual.style = 'painted';
    spec.visual.palette = ['#ffffff'];
    spec.map.biome = 'ocean';
    spec.output.targets = ['godot', 'common', 'itch'];
    spec.output.assetLicense = 'MIT';

    const codes = validateWorldSpec(spec as unknown as typeof DEFAULT_WORLD_SPEC).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'spec.schema-version',
      'spec.title',
      'spec.description',
      'spec.seed',
      'spec.style',
      'spec.palette',
      'spec.biome',
      'spec.output-targets',
      'spec.asset-license',
    ]));
  });

  it('rejects undeclared fields but preserves explicitly namespaced extensions', () => {
    const spec = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    spec.extensions = { 'org.mapsoo.externalhost.world.v1': { learningGoals: ['ecosystem-observation'] } };

    expect(validateWorldSpec(spec).some((issue) => issue.severity === 'error')).toBe(false);
    expect(generateWorld(spec).spec.extensions).toEqual(spec.extensions);
    expect(generateWorld(spec).spec.extensions).not.toBe(spec.extensions);

    const unknownRoot = { ...spec, privateStoryState: true } as unknown as typeof DEFAULT_WORLD_SPEC;
    expect(validateWorldSpec(unknownRoot)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.unknown-root-field', severity: 'error' })]),
    );

    const invalidNamespace = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    invalidNamespace.extensions = { 'external-host/world': {} };
    expect(validateWorldSpec(invalidNamespace)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.extension-namespace', severity: 'error' })]),
    );

    const noDotNamespace = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    noDotNamespace.extensions = { 'dev-external-host': {} };
    expect(validateWorldSpec(noDotNamespace)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.extension-namespace', severity: 'error' })]),
    );
  });

  it('rejects non-JSON and circular extension data before cloning or export', () => {
    const withFunction = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    withFunction.extensions = { 'org.mapsoo.externalhost': { callback: () => undefined } };
    expect(validateWorldSpec(withFunction)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.non-json-value', severity: 'error' })]),
    );

    const circularValue: Record<string, unknown> = {};
    circularValue.self = circularValue;
    const circular = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    circular.extensions = { 'org.mapsoo.externalhost': circularValue };
    expect(validateWorldSpec(circular)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.circular-json', severity: 'error' })]),
    );

    expect(() => generateWorld(withFunction)).toThrow(/spec\.non-json-value/);
    expect(() => generateWorld(circular)).toThrow(/spec\.circular-json/);

    const accessor = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    Object.defineProperty(accessor, 'title', {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error('must not be evaluated');
      },
    });
    expect(validateWorldSpec(accessor)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.non-json-value', severity: 'error' })]),
    );
  });

  it('counts Unicode code points and rejects title or seed control characters', () => {
    const validEmojiTitle = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    validEmojiTitle.title = '🌍'.repeat(120);
    expect(validateWorldSpec(validEmojiTitle).some((issue) => issue.code === 'spec.title')).toBe(false);

    const invalidEmojiTitle = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    invalidEmojiTitle.title = '🌍'.repeat(121);
    expect(validateWorldSpec(invalidEmojiTitle)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.title', severity: 'error' })]),
    );

    const controlCharacters = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    controlCharacters.title = 'Injected\nHeading';
    controlCharacters.seed = 'seed\tvalue';
    const codes = validateWorldSpec(controlCharacters).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['spec.title', 'spec.seed']));
  });
});

describe('pack manifest', () => {
  it('keeps stable Godot tile source IDs and atlas coordinates', () => {
    const manifest = buildPackManifest(
      generateWorld(DEFAULT_WORLD_SPEC),
      manifestFiles(),
      '2026-07-18T12:00:00.000Z',
    );

    expect(manifest.compatibility).toEqual({
      godot_min: '4.3',
      grid: 'orthogonal',
      art_style: 'pixel_art',
      importer: {
        id: 'mapsoo_importer',
        min_version: '0.1.0-alpha.1',
        source: 'https://github.com/babyrush0101-source/mapsoo-kids',
      },
    });
    expect(manifest.world_spec).toEqual({ path: 'worlds/sunny-meadow.world.json', sha256: HASH });
    expect(manifest.demo).toEqual({
      map: 'worlds/demo-world.json',
      preview: 'previews/map-preview.png',
    });
    expect(manifest.layers.map((layer) => layer.id)).toEqual(['ground', 'props']);
    expect(manifest.receipt).toEqual({ path: 'generation-receipt.json' });
    expect(manifest.atlases[0].source_id).toBe(0);
    expect(manifest.atlases[0].tiles.map((tile) => tile.atlas_coords)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(manifest.atlases[0].tiles.map((tile) => [tile.tile_id, tile.id, tile.atlas_coords])).toEqual([
      [0, 'ground_01', [0, 0]],
      [1, 'water_01', [1, 0]],
      [2, 'path_01', [2, 0]],
      [3, 'detail_01', [3, 0]],
    ]);
  });

  it('rejects paths that can escape or vary by platform', () => {
    expect(isSafePackPath('atlases/terrain.png')).toBe(true);
    expect(isSafePackPath('../terrain.png')).toBe(false);
    expect(isSafePackPath('atlases\\terrain.png')).toBe(false);
    expect(isSafePackPath('/terrain.png')).toBe(false);
    expect(isSafePackPath('atlases//terrain.png')).toBe(false);
    expect(isSafePackPath('atlases/./terrain.png')).toBe(false);
    expect(isSafePackPath('atlases/terrain.png/')).toBe(false);
  });

  it('rejects missing, duplicate, and unsafe payload records', () => {
    const world = generateWorld(DEFAULT_WORLD_SPEC);
    const createdAt = '2026-07-18T12:00:00.000Z';

    expect(() =>
      buildPackManifest(
        world,
        manifestFiles().filter((file) => file.path !== 'generation-receipt.json'),
        createdAt,
      ),
    ).toThrow('Manifest references missing pack file: generation-receipt.json');
    expect(() => buildPackManifest(world, [...manifestFiles(), manifestFiles()[0]], createdAt)).toThrow(
      'Duplicate pack file path: readme.md',
    );
    expect(() =>
      buildPackManifest(world, [...manifestFiles(), { ...manifestFiles()[0], path: '../escape.json' }], createdAt),
    ).toThrow('Unsafe pack path');
  });

  it('refuses to label an unknown provider as procedural provenance', () => {
    const world = generateWorld(DEFAULT_WORLD_SPEC);
    world.generator = { id: 'future-ai-provider', version: '1.0.0' };

    expect(() => buildPackManifest(world, manifestFiles(), '2026-07-18T12:00:00.000Z')).toThrow(
      'v0.1 portable export supports only procedural-pixel-v1@0.1.0',
    );
  });

  it('rejects malformed generator identities with a controlled export error', () => {
    const world = generateWorld(DEFAULT_WORLD_SPEC);
    world.generator = null as unknown as typeof world.generator;

    expect(() => buildPackManifest(world, manifestFiles(), '2026-07-18T12:00:00.000Z')).toThrow(
      'v0.1 portable export supports only procedural-pixel-v1@0.1.0',
    );
  });
});
