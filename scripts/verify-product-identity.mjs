import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function text(path) {
  return readFile(resolve(root, ...path.split('/')), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Product identity verification failed: ${message}`);
}

const packageRecord = JSON.parse(await text('package.json'));
const readme = await text('README.md');
const index = await text('index.html');
const app = await text('src/app/App.tsx');
const manifest = await text('src/core/pack-manifest-1.0.ts');
const importer = await text('godot/addons/mapsoo_importer/mapsoo_pack_importer.gd');
const releaseWorkflow = await text('.github/workflows/release.yml');
const releaseConfig = await text('scripts/release-config.mjs');

assert(packageRecord.name === 'mapsoo-worldforge', 'package name must match the public repository.');
assert(readme.startsWith('# Mapsoo WorldForge\n'), 'README must lead with the current product name.');
assert(
  readme.includes('`Mapsoo Worldsmith` remains the legacy Pack generator/protocol identity'),
  'README must explain the legacy Pack identity.',
);
assert(index.includes('<title>Mapsoo WorldForge</title>'), 'browser title must use the current product name.');
assert(
  index.includes('content="Mapsoo WorldForge turns world specifications'),
  'browser description must use the current product name.',
);
assert(!app.includes('Mapsoo Worldsmith'), 'Workbench UI must not display the legacy Pack identity as the product.');
assert(
  app.includes('Mapsoo WorldForge home')
    && app.includes('WorldForge · v{CURRENT_PUBLIC_RELEASE.version}')
    && app.includes('Mapsoo WorldForge · MIT source'),
  'Workbench UI must use the current product name in its visible identity.',
);

for (const [name, source] of [
  ['Pack 1.0 manifest', manifest],
  ['Godot Pack importer', importer],
]) {
  assert(
    source.includes('Mapsoo Worldsmith'),
    `${name} must retain the legacy generator identity for compatibility.`,
  );
}
assert(
  releaseWorkflow.includes('mapsoo-worldsmith-${{ github.ref_name }}')
    && releaseConfig.includes('mapsoo-worldsmith-web-${tag}.zip'),
  'immutable Alpha release filenames must retain their legacy identity.',
);

console.log(
  'MAPSOO_PRODUCT_IDENTITY_OK product="Mapsoo WorldForge" '
  + 'legacy_pack_generator="Mapsoo Worldsmith"',
);
