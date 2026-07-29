import { randomBytes } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  decodeRgbaPng,
  encodeRgbaPng,
} from './lib/rgba-png.mjs';

const root = await mkdtemp(join(tmpdir(), 'mapsoo-operator-candidate-'));
const viteNode = resolve('node_modules/vite-node/vite-node.mjs');
const runner = resolve('scripts/materialize-operator-production-art-candidate.ts');

function rgba(width, height) {
  return {
    width,
    height,
    rgba: new Uint8Array(width * height * 4),
  };
}

function fillRect(image, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      image.rgba.set(color, (row * image.width + column) * 4);
    }
  }
}

function alphaContract(image) {
  let transparent = 0;
  let opaque = 0;
  let partial = 0;
  let transparentRgbLeaks = 0;
  for (let offset = 0; offset < image.rgba.byteLength; offset += 4) {
    const alpha = image.rgba[offset + 3];
    if (alpha === 0) {
      transparent += 1;
      if (
        image.rgba[offset] !== 0
        || image.rgba[offset + 1] !== 0
        || image.rgba[offset + 2] !== 0
      ) {
        transparentRgbLeaks += 1;
      }
    } else if (alpha === 255) {
      opaque += 1;
    } else {
      partial += 1;
    }
  }
  return { transparent, opaque, partial, transparentRgbLeaks };
}

async function run(args) {
  const child = spawn(process.execPath, [viteNode, runner, ...args], {
    cwd: process.cwd(),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const exitCode = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', accept);
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

try {
  const directionSource = rgba(1600, 900);
  fillRect(
    directionSource,
    0,
    0,
    directionSource.width,
    directionSource.height,
    Uint8Array.from([45, 90, 135, 255]),
  );
  fillRect(
    directionSource,
    125,
    420,
    1350,
    260,
    Uint8Array.from([70, 120, 80, 255]),
  );
  const directionSourcePath = join(root, 'private-operator-direction.png');
  const directionOutputPath = join(root, 'direction-candidate.png');
  const directionReportPath = join(root, 'direction-candidate.json');
  await writeFile(
    directionSourcePath,
    encodeRgbaPng(
      directionSource.width,
      directionSource.height,
      directionSource.rgba,
    ),
  );
  const direction = await run([
    '--profile', 'side-platformer',
    '--task', 'scene-direction',
    '--source', directionSourcePath,
    '--mode', 'cover-crop',
    '--out', directionOutputPath,
    '--report', directionReportPath,
  ]);
  if (direction.exitCode !== 0) {
    throw new Error(`Direction cover crop failed: ${direction.stderr}`);
  }
  const directionReportText = await readFile(directionReportPath, 'utf8');
  const directionReport = JSON.parse(directionReportText);
  const directionPng = decodeRgbaPng(await readFile(directionOutputPath));
  if (
    directionPng.width !== 1536
    || directionPng.height !== 1024
    || directionReport.normalization.mode !== 'cover-crop'
    || directionReport.normalization.crop_bounds.x !== 125
    || directionReport.normalization.crop_bounds.y !== 0
    || directionReport.normalization.crop_bounds.width !== 1350
    || directionReport.normalization.crop_bounds.height !== 900
    || directionReport.role_bindings.length !== 1
    || directionReportText.includes(directionSourcePath)
  ) {
    throw new Error('Direction cover crop did not preserve the safe canonical contract.');
  }

  const terrainSource = rgba(800, 400);
  const terrainRects = [
    [25, 120, 110, 170],
    [165, 230, 100, 48],
    [300, 90, 105, 200],
    [440, 90, 105, 200],
    [590, 60, 50, 230],
    [670, 70, 110, 80],
  ];
  terrainRects.forEach(([x, y, width, height], index) => {
    fillRect(
      terrainSource,
      x,
      y,
      width,
      height,
      Uint8Array.from([
        30 + index * 20,
        80 + index * 10,
        120,
        index % 2 === 0 ? 96 : 255,
      ]),
    );
  });
  terrainSource.rgba.set(Uint8Array.from([210, 30, 90, 8]), 4);
  const terrainSourcePath = join(root, 'private-operator-terrain.png');
  const terrainOutputPath = join(root, 'terrain-candidate.png');
  const terrainReportPath = join(root, 'terrain-candidate.json');
  await writeFile(
    terrainSourcePath,
    encodeRgbaPng(terrainSource.width, terrainSource.height, terrainSource.rgba),
  );
  const terrain = await run([
    '--profile', 'side-platformer',
    '--task', 'terrain-sheet',
    '--source', terrainSourcePath,
    '--mode', 'component-reading-order',
    '--out', terrainOutputPath,
    '--report', terrainReportPath,
  ]);
  if (terrain.exitCode !== 0) {
    throw new Error(`Terrain operator import failed: ${terrain.stderr}`);
  }
  const terrainSummary = JSON.parse(terrain.stdout.trim());
  const terrainReportText = await readFile(terrainReportPath, 'utf8');
  const terrainReport = JSON.parse(terrainReportText);
  const terrainPng = decodeRgbaPng(await readFile(terrainOutputPath));
  const terrainAlpha = alphaContract(terrainPng);
  if (
    terrainSummary.status !== 'operator-candidate-written'
    || terrainSummary.roles !== 6
    || terrainReport.normalization.significant_components !== 6
    || terrainReport.role_bindings[0].role !== 'terrain.solid'
    || terrainReport.role_bindings[5].role !== 'terrain.ceiling'
    || terrainPng.width !== 384
    || terrainPng.height !== 192
    || terrainAlpha.partial !== 0
    || terrainAlpha.transparent < 1
    || terrainAlpha.opaque < 1
    || terrainAlpha.transparentRgbLeaks !== 0
    || terrainReport.normalization.binary_alpha !== true
    || terrainReportText.includes(terrainSourcePath)
  ) {
    throw new Error('Terrain component reflow did not preserve the safe canonical contract.');
  }

  const propSource = rgba(800, 800);
  for (let index = 0; index < 14; index += 1) {
    const column = index % 8;
    const row = Math.floor(index / 8);
    fillRect(
      propSource,
      column * 100 + 20,
      row * 100 + 16,
      60,
      68,
      Uint8Array.from([90, 40 + index * 8, 170 - index * 5, 255]),
    );
  }
  const propSourcePath = join(root, 'private-operator-props.png');
  const propOutputPath = join(root, 'prop-candidate.png');
  const propReportPath = join(root, 'prop-candidate.json');
  await writeFile(
    propSourcePath,
    encodeRgbaPng(propSource.width, propSource.height, propSource.rgba),
  );
  const prop = await run([
    '--profile', 'side-platformer',
    '--task', 'prop-sheet',
    '--source', propSourcePath,
    '--mode', 'proportional-grid',
    '--out', propOutputPath,
    '--report', propReportPath,
  ]);
  if (prop.exitCode !== 0) {
    throw new Error(`Prop operator import failed: ${prop.stderr}`);
  }
  const propReport = JSON.parse(await readFile(propReportPath, 'utf8'));
  const propPng = decodeRgbaPng(await readFile(propOutputPath));
  const propAlpha = alphaContract(propPng);
  if (
    propReport.role_bindings.length !== 14
    || propReport.normalization.mode !== 'proportional-grid'
    || propPng.width !== 512
    || propPng.height !== 512
    || propAlpha.partial !== 0
    || propAlpha.transparentRgbLeaks !== 0
    || propReport.normalization.binary_alpha !== true
  ) {
    throw new Error('Proportional grid import did not preserve the canonical prop task.');
  }

  const characterSource = rgba(800, 600);
  const characterCells = [
    [0, 0], [1, 0], [2, 0], [3, 0],
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1],
    [0, 2], [1, 2], [2, 2], [3, 2],
    [0, 3], [1, 3], [2, 3], [3, 3],
    [0, 4], [1, 4], [2, 4], [3, 4],
    [0, 5], [1, 5], [2, 5], [3, 5],
  ];
  characterCells.forEach(([column, row], index) => {
    fillRect(
      characterSource,
      column * 100 + 18,
      row * 100 + 12,
      64,
      78,
      Uint8Array.from([40 + index * 4, 90, 150, 255]),
    );
  });
  const characterSourcePath = join(root, 'private-operator-character.png');
  const characterOutputPath = join(root, 'character-candidate.png');
  const characterReportPath = join(root, 'character-candidate.json');
  await writeFile(
    characterSourcePath,
    encodeRgbaPng(
      characterSource.width,
      characterSource.height,
      characterSource.rgba,
    ),
  );
  const character = await run([
    '--profile', 'side-platformer',
    '--task', 'character-character-player-atlas',
    '--source', characterSourcePath,
    '--mode', 'component-reading-order',
    '--out', characterOutputPath,
    '--report', characterReportPath,
  ]);
  if (character.exitCode !== 0) {
    throw new Error(`Character operator import failed: ${character.stderr}`);
  }
  const characterReport = JSON.parse(await readFile(characterReportPath, 'utf8'));
  const characterPng = decodeRgbaPng(await readFile(characterOutputPath));
  const characterAlpha = alphaContract(characterPng);
  if (
    characterReport.role_bindings.length !== 28
    || characterReport.role_bindings[0].role
      !== 'character.player.atlas:idle.left.frame-0'
    || characterReport.role_bindings[27].role
      !== 'character.player.atlas:hurt.right.frame-1'
    || characterAlpha.partial !== 0
    || characterAlpha.transparentRgbLeaks !== 0
    || characterReport.normalization.binary_alpha !== true
  ) {
    throw new Error('Character reflow did not preserve the canonical pose inventory.');
  }

  const invalidSource = rgba(800, 400);
  terrainRects.concat([[730, 320, 40, 40]]).forEach(
    ([x, y, width, height], index) => {
      fillRect(
        invalidSource,
        x,
        y,
        width,
        height,
        Uint8Array.from([160, 60 + index, 90, 255]),
      );
    },
  );
  const invalidSourcePath = join(root, 'invalid-component-count.png');
  const invalidOutputPath = join(root, `must-not-exist-${randomBytes(4).toString('hex')}.png`);
  const invalidReportPath = join(root, `must-not-exist-${randomBytes(4).toString('hex')}.json`);
  await writeFile(
    invalidSourcePath,
    encodeRgbaPng(invalidSource.width, invalidSource.height, invalidSource.rgba),
  );
  const invalid = await run([
    '--profile', 'side-platformer',
    '--task', 'terrain-sheet',
    '--source', invalidSourcePath,
    '--mode', 'component-reading-order',
    '--out', invalidOutputPath,
    '--report', invalidReportPath,
  ]);
  if (
    invalid.exitCode === 0
    || !invalid.stderr.includes('requires exactly 6')
  ) {
    throw new Error('Unexpected component count did not fail closed.');
  }

  const invalidCoverCropOutputPath = join(
    root,
    `must-not-cover-crop-${randomBytes(4).toString('hex')}.png`,
  );
  const invalidCoverCropReportPath = join(
    root,
    `must-not-cover-crop-${randomBytes(4).toString('hex')}.json`,
  );
  const invalidCoverCrop = await run([
    '--profile', 'side-platformer',
    '--task', 'prop-sheet',
    '--source', propSourcePath,
    '--mode', 'cover-crop',
    '--out', invalidCoverCropOutputPath,
    '--report', invalidCoverCropReportPath,
  ]);
  if (
    invalidCoverCrop.exitCode === 0
    || !invalidCoverCrop.stderr.includes(
      'limited to scene-direction and background-layer tasks',
    )
  ) {
    throw new Error('Cover crop did not reject a grid-bound task.');
  }

  console.log(
    'MAPSOO_OPERATOR_PRODUCTION_ART_CANDIDATE_OK '
    + 'cover_crop=1 component_reflow=6 proportional_roles=14 character_poses=28 '
    + 'binary_alpha=true transparent_rgb_zeroed=true '
    + 'path_privacy=true fail_closed=true',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
