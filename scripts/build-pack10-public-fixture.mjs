import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import JSZip from 'jszip';

import { encodeRgbaPng } from './lib/rgba-png.mjs';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUTPUT_ROOT = join(
  REPOSITORY_ROOT,
  'tests',
  'fixtures',
  'pack10-public',
);
export const ZIP_NAME = 'mapsoo-pack10-public-fixture.zip';
const FIXED_DATE = new Date(Date.UTC(2026, 6, 26, 0, 0, 0));
const CELL = 32;
const DIRECTIONS = Object.freeze(['left', 'right', 'near', 'far']);
const PLAYER_ACTIONS = Object.freeze(['idle', 'walk', 'run', 'interact']);
const NPC_ACTIONS = Object.freeze(['idle', 'talk']);

const PLANES = Object.freeze([
  ['sky', 'background.sky', 'layers/background-sky.png', 'mix'],
  ['far', 'background.far', 'layers/background-far.png', 'mix'],
  ['mid', 'background.mid', 'layers/background-mid.png', 'mix'],
  ['depth-fog', 'background.depth-fog', 'layers/background-depth-fog.png', 'mix'],
  ['near', 'near.overlay', 'layers/near-overlay.png', 'mix'],
  ['ambient-light', 'lighting.ambient', 'layers/lighting-ambient.png', 'multiply'],
  ['local-light', 'lighting.local', 'layers/lighting-local.png', 'add'],
  ['foreground', 'foreground.overlay', 'layers/foreground-overlay.png', 'mix'],
]);

const ATLAS_DEFINITIONS = Object.freeze([
  ['terrain', 'atlases/terrain.png', 6, 1, CELL, CELL],
  ['props', 'atlases/props.png', 6, 1, CELL, CELL],
  ['structures', 'atlases/structures.png', 4, 1, CELL, CELL],
  ['collectibles', 'atlases/collectibles.png', 2, 1, CELL, CELL],
  ['effects', 'atlases/effects.png', 4, 1, CELL, CELL],
  ['player', 'atlases/player.png', 32, 1, 48, 72],
  ['npc', 'atlases/npc.png', 16, 1, 48, 72],
]);

const ATLAS_ROLE_GROUPS = Object.freeze([
  ['terrain', [
    'terrain.ground',
    'terrain.path',
    'terrain.edge',
    'terrain.bridge',
    'terrain.stairs',
    'terrain.water',
  ]],
  ['props', [
    'prop.tree',
    'prop.rock',
    'prop.crate',
    'prop.sign',
    'prop.lamp',
    'prop.occluder',
  ]],
  ['structures', [
    'structure.entrance',
    'structure.exit',
    'structure.checkpoint',
    'structure.landmark',
  ]],
  ['collectibles', ['collectible.primary', 'collectible.health']],
  ['effects', ['effect.footstep', 'effect.interact', 'effect.portal', 'effect.ambient']],
]);

const PALETTE = Object.freeze([
  [44, 58, 88, 255],
  [80, 120, 112, 255],
  [155, 116, 73, 255],
  [202, 167, 92, 255],
  [92, 69, 115, 255],
  [113, 151, 181, 255],
  [188, 91, 74, 255],
  [87, 92, 62, 255],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function rgbaImage(width, height, pixel) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rgba.set(pixel(x, y), (y * width + x) * 4);
    }
  }
  return Buffer.from(encodeRgbaPng(width, height, rgba));
}

function planePng(index) {
  const [id] = PLANES[index];
  return rgbaImage(160, 90, (x, y) => {
    if (id === 'sky') {
      return [42 + Math.floor(y / 3), 69 + Math.floor(y / 4), 105 + Math.floor(y / 5), 255];
    }
    if (id === 'ambient-light') return [190, 177, 151, 255];
    if (id === 'local-light') {
      const distance = Math.abs(x - 118) + Math.abs(y - 54);
      return [239, 173, 72, Math.max(0, 150 - distance * 4)];
    }
    const color = PALETTE[(index + 1) % PALETTE.length];
    const horizon = 34 + index * 5;
    const stripe = ((x + index * 13) % (29 + index)) < 6;
    const visible = y >= horizon && (stripe || y >= horizon + 18);
    const alpha = visible ? Math.min(205, 78 + (y - horizon) * 5) : 0;
    return [color[0], color[1], color[2], alpha];
  });
}

function atlasPng(columns, rows, cellWidth, cellHeight, paletteOffset) {
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  return rgbaImage(width, height, (x, y) => {
    const column = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);
    const localX = x % cellWidth;
    const localY = y % cellHeight;
    const color = PALETTE[(paletteOffset + column + row) % PALETTE.length];
    const inset = 3 + ((column + row) % 3);
    const body = localX >= inset
      && localX < cellWidth - inset
      && localY >= inset
      && localY < cellHeight - 2;
    if (!body) return [0, 0, 0, 0];
    const highlight = localX === inset || localY === inset;
    return highlight
      ? [Math.min(255, color[0] + 35), Math.min(255, color[1] + 35), Math.min(255, color[2] + 35), 255]
      : color;
  });
}

function previewPng() {
  return rgbaImage(320, 180, (x, y) => {
    if (y < 108) return [45 + Math.floor(y / 7), 72 + Math.floor(y / 8), 108, 255];
    if (y >= 148) return [51, 61, 58, 255];
    if (x > 122 && x < 198 && y > 112) return [113, 151, 181, 255];
    if ((x > 30 && x < 76) || (x > 244 && x < 292)) return [155, 116, 73, 255];
    return [80, 120, 112, 255];
  });
}

function character(id, atlas, clips) {
  return {
    id,
    atlas,
    frame_size: [48, 72],
    pivot: [24, 67],
    clips: clips.map(([action, direction], clipIndex) => ({
      id: `${action}.${direction}`,
      action,
      direction,
      frames: [0, 1].map((variant) => ({
        x: (clipIndex * 2 + variant) * 48,
        y: 0,
        duration_ms: action === 'idle' ? 240 : 140,
        provenance: 'declared-synthetic-variant',
      })),
    })),
  };
}

function atlasRegions() {
  const definitions = new Map(
    ATLAS_DEFINITIONS.map(([id, , , , cellWidth, cellHeight]) => [
      id,
      { cellWidth, cellHeight },
    ]),
  );
  return ATLAS_ROLE_GROUPS.flatMap(([atlas, roles]) => roles.map((role, index) => {
    const { cellWidth, cellHeight } = definitions.get(atlas);
    return {
      role,
      binding: {
        kind: 'atlas-region',
        atlas,
        region: {
          x: index * cellWidth,
          y: 0,
          width: cellWidth,
          height: cellHeight,
        },
      },
    };
  }));
}

function mediaType(path) {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.md')) return 'text/markdown';
  return 'application/json';
}

async function validateManifest(manifest) {
  const schema = JSON.parse(
    await readFile(join(REPOSITORY_ROOT, 'schemas', 'mapsoo-pack-1.0.schema.json'), 'utf8'),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    throw new Error(`Pack 1.0 schema validation failed: ${JSON.stringify(validate.errors)}`);
  }
}

async function writeOutput(root, path, bytes) {
  const destination = join(root, ...path.split('/'));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

function runtimePayloads() {
  const scene = {
    schema_version: 'mapsoo-public-fixture-scene/1.0',
    fixture_id: 'pack10-public-fixture',
    synthetic: true,
    canvas: { width: 320, height: 180 },
    spawn: { x: 32, y: 132 },
    exit: { x: 288, y: 132 },
    placements: [
      { id: 'entry', role: 'structure.entrance', x: 32, y: 132 },
      { id: 'marker', role: 'structure.checkpoint', x: 160, y: 132 },
      { id: 'goal', role: 'structure.exit', x: 288, y: 132 },
      { id: 'player', role: 'character.player.atlas', x: 48, y: 132 },
      { id: 'guide', role: 'character.npc.atlas', x: 208, y: 132 },
    ],
  };
  const collision = {
    schema_version: 'mapsoo-public-fixture-collision/1.0',
    fixture_id: 'pack10-public-fixture',
    synthetic: true,
    bounds: { x: 0, y: 0, width: 320, height: 180 },
    solids: [
      { id: 'ground', x: 0, y: 148, width: 320, height: 32 },
      { id: 'marker-block', x: 152, y: 128, width: 16, height: 20 },
    ],
  };
  const navigation = {
    schema_version: 'mapsoo-public-fixture-navigation/1.0',
    fixture_id: 'pack10-public-fixture',
    synthetic: true,
    nodes: [
      { id: 'spawn', x: 32, y: 132 },
      { id: 'checkpoint', x: 160, y: 116 },
      { id: 'exit', x: 288, y: 132 },
    ],
    edges: [
      { from: 'spawn', to: 'checkpoint' },
      { from: 'checkpoint', to: 'exit' },
    ],
  };
  return new Map([
    ['runtime/scene.json', jsonBytes(scene)],
    ['runtime/collision.json', jsonBytes(collision)],
    ['runtime/navigation.json', jsonBytes(navigation)],
  ]);
}

function publicRecipe() {
  return {
    schema_version: 'mapsoo-public-synthetic-recipe/1.0',
    id: 'pack10-public-fixture-recipe',
    seed: 'pack10-public-fixture-seed-001',
    synthetic: true,
    algorithm: 'fixed-palette-rgba-primitives-v1',
    source_images: [],
    generative_ai: false,
    raw_prompts: false,
    notes: 'Every raster is generated from fixed integer geometry and a fixed palette.',
  };
}

export async function buildPublicFixture(
  outputRoot = DEFAULT_OUTPUT_ROOT,
  zipPath = join(outputRoot, ZIP_NAME),
) {
  const payloads = runtimePayloads();
  PLANES.forEach(([, , path], index) => payloads.set(path, planePng(index)));
  ATLAS_DEFINITIONS.forEach(([, path, columns, rows, cellWidth, cellHeight], index) => {
    payloads.set(path, atlasPng(columns, rows, cellWidth, cellHeight, index));
  });
  payloads.set('previews/world.png', previewPng());
  payloads.set(
    'license-assets.md',
    Buffer.from(
      '# Asset license\n\n'
        + 'All assets in this synthetic fixture are dedicated to the public domain under CC0 1.0. '
        + 'Redistribution and commercial use are permitted.\n',
      'utf8',
    ),
  );
  const recipeBytes = jsonBytes(publicRecipe());
  payloads.set('provenance/synthetic-recipe.json', recipeBytes);

  const planeRoles = PLANES.map(([, role, path]) => ({
    role,
    binding: { kind: 'file', path },
  }));
  const roles = [
    ...planeRoles,
    ...atlasRegions(),
    {
      role: 'character.player.atlas',
      binding: { kind: 'file', path: 'atlases/player.png' },
    },
    {
      role: 'character.npc.atlas',
      binding: { kind: 'file', path: 'atlases/npc.png' },
    },
    ...[
      ['world.scene', 'runtime/scene.json'],
      ['world.collision', 'runtime/collision.json'],
      ['world.navigation', 'runtime/navigation.json'],
      ['world.preview', 'previews/world.png'],
    ].map(([role, path]) => ({ role, binding: { kind: 'file', path } })),
  ];

  const files = [...payloads.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => ({
      path,
      media_type: mediaType(path),
      bytes: bytes.length,
      sha256: sha256(bytes),
    }));

  const manifest = {
    schema_version: '1.0.0-draft.1',
    pack: {
      id: 'pack10-public-fixture',
      title: 'Pack 1.0 Public Synthetic Fixture',
      version: '1.0.0-fixture.1',
      generator: { name: 'Mapsoo Worldsmith', version: '1.0.0-fixture.1' },
      created_at: '2026-07-26T00:00:00.000Z',
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
      importer: { id: 'mapsoo_importer', min_version: '1.0.0-fixture.1' },
    },
    planes: PLANES.map(([id, role, path, blend]) => ({
      id,
      role,
      path,
      layer: id,
      blend,
    })),
    atlases: ATLAS_DEFINITIONS.map(([id, path, , , cellWidth, cellHeight]) => ({
      id,
      path,
      cell_size: [cellWidth, cellHeight],
    })),
    roles,
    characters: [
      character(
        'player',
        'atlases/player.png',
        PLAYER_ACTIONS.flatMap((action) => DIRECTIONS.map((direction) => [action, direction])),
      ),
      character(
        'npc',
        'atlases/npc.png',
        NPC_ACTIONS.flatMap((action) => DIRECTIONS.map((direction) => [action, direction])),
      ),
    ],
    runtime: {
      scene: { path: 'runtime/scene.json' },
      collision: { path: 'runtime/collision.json' },
      navigation: { path: 'runtime/navigation.json' },
      spawn: { x: 32, y: 132 },
    },
    files,
    license: {
      output: {
        id: 'CC0-1.0',
        notice_path: 'license-assets.md',
        permits_redistribution: true,
        permits_commercial_use: true,
      },
    },
    provenance: {
      output_provenance: 'procedural',
      contains_generative_ai: false,
      model_provider: null,
      model: null,
      human_curated: true,
      source_manifest_hashes: [sha256(recipeBytes)],
    },
    reference_policy: {
      embedded: false,
      original_references_excluded: true,
      raw_prompts_excluded: true,
      only_one_way_audit_hashes_retained: true,
    },
  };

  if (roles.length !== 36) throw new Error(`Expected exactly 36 fixture roles, found ${roles.length}.`);
  await validateManifest(manifest);
  const manifestBytes = jsonBytes(manifest);

  for (const [path, bytes] of payloads) await writeOutput(outputRoot, path, bytes);
  await writeOutput(outputRoot, 'mapsoo.manifest.json', manifestBytes);

  const archive = new JSZip();
  const archiveEntries = new Map(payloads);
  archiveEntries.set('mapsoo.manifest.json', manifestBytes);
  for (const [path, bytes] of [...archiveEntries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    archive.file(path, bytes, {
      binary: true,
      createFolders: false,
      date: FIXED_DATE,
      unixPermissions: 0o100644,
    });
  }
  const zipBytes = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
  await mkdir(dirname(zipPath), { recursive: true });
  await writeFile(zipPath, zipBytes);

  const outputFiles = new Map(archiveEntries);
  outputFiles.set(ZIP_NAME, zipBytes);
  return {
    manifest,
    manifestSha256: sha256(manifestBytes),
    zipSha256: sha256(zipBytes),
    outputFiles,
  };
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const outputRoot = resolve(argument('out-dir') ?? DEFAULT_OUTPUT_ROOT);
  const zipPath = resolve(argument('zip') ?? join(outputRoot, ZIP_NAME));
  const result = await buildPublicFixture(outputRoot, zipPath);
  process.stdout.write(`${JSON.stringify({
    output_root: outputRoot,
    manifest_sha256: result.manifestSha256,
    zip_sha256: result.zipSha256,
    files: result.manifest.files.length,
    roles: result.manifest.roles.length,
  })}\n`);
}
