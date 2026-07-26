import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_JSON_PATH = resolve(REPOSITORY_ROOT, 'package.json');

const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, 'utf8'));

export const PACKAGE_VERSION = packageJson.version;

const CURRENT_SOURCE_EXAMPLE_PACK_SHA256 = Object.freeze({
  '0.1.0-alpha.1': 'bc221386971434a08f21c69f0537c0f93cc266d76d47bb08a7ccc834e5a64621',
  '0.1.0-alpha.2': 'e139519ed8d3e6e6e8ed811e9da2761eb7f227a1a3ddd7206adff171b50aa0ca',
  '0.1.0-alpha.3': 'c1acb8d61e72ccfcf609c02e37868fe3f20e0bd28b9f65aff71e25ac8b45d409',
  '0.1.0-alpha.4': 'f815676485f08cac53783d99b7b6fbf2a1dcbdef5ac2fc501a26ccefba3fd127',
  '0.1.0-alpha.5': '8d86124a4a37fa4a78487c4e91cb7f5024561f140814a5fd139c5b93fde54f36',
  '0.1.0-alpha.6': '4563552187977b38cdba86c7d3cbf5429a67b7a0a6049e978c2ef2992ef3a054',
  '0.1.0-alpha.7': '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
  '0.1.0-alpha.8': '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
  '0.1.0-alpha.9': '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function releaseFiles(tag, {
  evidenceVideo = false,
  receiptSchema = false,
  placesSchema = false,
  structuresSchema = false,
  worldGallery = false,
  externalHostBridge = false,
  completeFarm = false,
} = {}) {
  const files = {
    web: `mapsoo-worldsmith-web-${tag}.zip`,
    godotImporter: `mapsoo-godot-importer-${tag}.zip`,
    examplePack: `mapsoo-sunny-meadow-${tag}.zip`,
    exampleWorldSpec: `sunny-meadow-${tag}.world.json`,
    worldSchema: `mapsoo-world.schema-${tag}.json`,
    packSchema: `mapsoo-pack.schema-${tag}.json`,
    license: 'LICENSE',
    changelog: 'CHANGELOG.md',
    manifest: 'release-manifest.json',
    checksums: 'SHA256SUMS',
  };
  if (evidenceVideo) files.evidenceVideo = `mapsoo-worldsmith-${tag}-75s.mp4`;
  if (receiptSchema) {
    files.receiptSchema = `mapsoo-generation-receipt.schema-${tag}.json`;
  }
  if (placesSchema) files.placesSchema = `mapsoo-places.schema-${tag}.json`;
  if (structuresSchema) files.structuresSchema = `mapsoo-structures.schema-${tag}.json`;
  if (worldGallery) {
    files.dustwindPack = `mapsoo-dustwind-outpost-${tag}.zip`;
    files.frostwatchPack = `mapsoo-frostwatch-vale-${tag}.zip`;
    files.dustwindWorldSpec = `dustwind-outpost-${tag}.world.json`;
    files.frostwatchWorldSpec = `frostwatch-vale-${tag}.world.json`;
  }
  if (externalHostBridge) {
    files.externalHostRequestSchema = `external-host-asset-request.schema-${tag}.json`;
    files.externalHostExportReceiptSchema = `external-host-mapsoo-export-receipt.schema-${tag}.json`;
    files.externalHostExampleRequest = `river-valley-asset-request-${tag}.json`;
  }
  if (completeFarm) {
    files.completeFarmPack = `mapsoo-alpha9-godot-smoke-${tag}.zip`;
    files.completeFarmPackSchema = `mapsoo-pack-0.6.schema-${tag}.json`;
    files.generationRequestSchema = `mapsoo-generation-request-1.0.schema-${tag}.json`;
    files.worldAssetReceiptSchema = `mapsoo-world-asset-receipt-0.1.schema-${tag}.json`;
  }
  return files;
}

function assertConfig(condition, message) {
  if (!condition) throw new Error(`Invalid release config: ${message}`);
}

function assertRelativeConfigPath(path, context) {
  assertConfig(typeof path === 'string' && path.length > 0, `${context} is missing`);
  assertConfig(!path.startsWith('/') && !path.startsWith('\\') && !/^[A-Za-z]:/.test(path), `${context} must be relative`);
  assertConfig(!path.includes('\\'), `${context} must use forward slashes`);
  assertConfig(
    path.split('/').every((segment) => segment && segment !== '.' && segment !== '..'),
    `${context} contains an unsafe segment`,
  );
}

const receiptVerifierVersions = Object.freeze({
  'legacy-alpha1': Object.freeze(['0.1.0-alpha.1']),
  'builtin-procedural-alpha2-v0.2': Object.freeze(['0.1.0-alpha.2']),
  'builtin-procedural-alpha3-v0.2': Object.freeze(['0.1.0-alpha.3']),
  'builtin-playable-terrain-alpha4-v0.2': Object.freeze(['0.1.0-alpha.4']),
  'builtin-semantic-places-alpha5-v0.2': Object.freeze(['0.1.0-alpha.5']),
  'builtin-semantic-structures-alpha6-v0.2': Object.freeze(['0.1.0-alpha.6']),
  'builtin-world-gallery-alpha7-v0.2': Object.freeze(['0.1.0-alpha.7', '0.1.0-alpha.8', '0.1.0-alpha.9']),
});
const packVerificationPolicies = Object.freeze([
  'sunny-meadow-procedural-cc0-v1',
  'sunny-meadow-procedural-cc0-v2',
  'sunny-meadow-procedural-cc0-v3',
  'sunny-meadow-playable-terrain-cc0-v4',
  'sunny-meadow-semantic-places-cc0-v5',
  'sunny-meadow-semantic-structures-cc0-v6',
  'world-gallery-semantic-structures-cc0-v7',
]);
const itchVerificationPolicies = Object.freeze([
  'sunny-meadow-procedural-cc0-v1',
  'sunny-meadow-procedural-cc0-v2',
  'sunny-meadow-procedural-cc0-v3',
  'sunny-meadow-playable-terrain-cc0-v4',
  'sunny-meadow-semantic-places-cc0-v5',
  'sunny-meadow-semantic-structures-cc0-v6',
  'world-gallery-semantic-structures-cc0-v7',
]);

export function assertReceiptVerifierBinding(receiptVerifier, version) {
  assertConfig(
    Object.hasOwn(receiptVerifierVersions, receiptVerifier),
    `${String(receiptVerifier)} receipt verifier is not registered`,
  );
  assertConfig(
    receiptVerifierVersions[receiptVerifier].includes(version),
    `${receiptVerifier} does not authorize ${String(version)}`,
  );
}

function validateReleaseConfig(config) {
  config.packVersion ??= config.version;
  config.publicAssetNamePolicy ??= 'exact';
  config.currentSourceExamplePackSha256 =
    config.lifecycle === 'published'
      ? CURRENT_SOURCE_EXAMPLE_PACK_SHA256[config.version] ?? null
      : null;
  assertConfig(config.tag === `v${config.version}`, `${config.version} tag is inconsistent`);
  assertConfig(
    typeof config.packVersion === 'string' && /^0\.1\.0-alpha\.[1-9][0-9]*$/.test(config.packVersion),
    `${config.tag} packVersion is invalid`,
  );
  assertConfig(
    ['candidate', 'published'].includes(config.lifecycle),
    `${config.tag} lifecycle must be candidate or published`,
  );
  assertConfig(
    ['exact', 'privacy-redacted'].includes(config.publicAssetNamePolicy),
    `${config.tag} public asset name policy is invalid`,
  );
  assertConfig(
    config.expectedExamplePackSha256 === null
      || /^[a-f0-9]{64}$/.test(config.expectedExamplePackSha256),
    `${config.tag} expected example-pack hash is invalid`,
  );
  assertConfig(typeof config.receiptVerifier === 'string' && config.receiptVerifier, `${config.tag} receipt verifier is missing`);
  assertReceiptVerifierBinding(config.receiptVerifier, config.version);
  assertConfig(
    packVerificationPolicies.includes(config.release.verificationPolicy),
    `${config.tag} pack verification policy is not registered`,
  );
  assertConfig(
    itchVerificationPolicies.includes(config.itch.verificationPolicy),
    `${config.tag} itch verification policy is not registered`,
  );

  for (const key of [
    'web',
    'godotImporter',
    'examplePack',
    'exampleWorldSpec',
    'worldSchema',
    'packSchema',
    'license',
    'changelog',
    'manifest',
    'checksums',
  ]) {
    assertConfig(typeof config.release.files[key] === 'string', `${config.tag} release.files.${key} is missing`);
  }
  const fileNames = Object.values(config.release.files);
  assertConfig(new Set(fileNames).size === fileNames.length, `${config.tag} release filenames must be unique`);
  for (const [key, path] of Object.entries(config.release.files)) {
    assertRelativeConfigPath(path, `${config.tag} release.files.${key}`);
  }
  if (config.lifecycle === 'published') {
    assertConfig(
      /^[a-f0-9]{64}$/.test(config.publicExamplePackSha256),
      `${config.tag} public example-pack hash is invalid`,
    );
    const pinnedNames = Object.keys(config.publicReleaseAssetSha256).sort();
    const expectedNames = [...fileNames].sort();
    assertConfig(
      JSON.stringify(pinnedNames) === JSON.stringify(expectedNames),
      `${config.tag} published release hash list must cover every attachment exactly once`,
    );
    for (const [name, hash] of Object.entries(config.publicReleaseAssetSha256)) {
      assertConfig(/^[a-f0-9]{64}$/.test(hash), `${config.tag} published hash is invalid for ${name}`);
    }
    assertConfig(
      config.publicReleaseAssetSha256[config.release.files.examplePack]
        === config.publicExamplePackSha256,
      `${config.tag} example pack hashes disagree`,
    );
    assertConfig(
      config.expectedExamplePackSha256 === config.publicExamplePackSha256,
      `${config.tag} expected and public example-pack hashes disagree`,
    );
    assertConfig(
      /^[a-f0-9]{64}$/.test(config.currentSourceExamplePackSha256),
      `${config.tag} current-source example-pack hash is invalid`,
    );
    for (const pack of config.release.additionalExamplePacks ?? []) {
      assertConfig(
        config.publicReleaseAssetSha256[config.release.files[pack.releaseFileKey]] === pack.expectedSha256,
        `${config.tag} published hash disagrees for additional pack ${pack.id}`,
      );
    }
  } else {
    assertConfig(
      config.publicReleaseAssetSha256 === null,
      `${config.tag} candidate must not claim published release attachment hashes`,
    );
    assertConfig(
      config.publicExamplePackSha256 === null,
      `${config.tag} candidate must not claim a public example-pack hash`,
    );
    assertConfig(
      config.currentSourceExamplePackSha256 === null,
      `${config.tag} candidate must not pin a historical current-source example-pack hash`,
    );
  }
  assertRelativeConfigPath(config.release.notes, `${config.tag} release notes`);
  assertConfig(
    typeof config.release.examplePack.id === 'string' && config.release.examplePack.id.length > 0,
    `${config.tag} pack ID is missing`,
  );
  assertRelativeConfigPath(config.release.examplePack.sourceDirectory, `${config.tag} pack fixture`);
  assertRelativeConfigPath(config.release.examplePack.archiveRoot, `${config.tag} pack archive root`);
  assertRelativeConfigPath(
    config.release.examplePack.worldSpecPackPath,
    `${config.tag} pack World Spec path`,
  );
  for (const pack of config.release.additionalExamplePacks ?? []) {
    assertConfig(typeof pack.id === 'string' && pack.id.length > 0, `${config.tag} additional pack ID is missing`);
    assertConfig(typeof config.release.files[pack.releaseFileKey] === 'string', `${config.tag} additional pack file is missing`);
    assertConfig(typeof config.release.files[pack.worldSpecReleaseFileKey] === 'string', `${config.tag} additional World Spec file is missing`);
    assertRelativeConfigPath(pack.sourceDirectory, `${config.tag} additional pack fixture`);
    assertRelativeConfigPath(pack.archiveRoot, `${config.tag} additional pack archive root`);
    assertRelativeConfigPath(pack.worldSpecPackPath, `${config.tag} additional pack World Spec path`);
    assertRelativeConfigPath(pack.worldSpecInput, `${config.tag} additional pack World Spec input`);
    assertConfig(/^[a-f0-9]{64}$/.test(pack.expectedSha256 ?? ''), `${config.tag} additional pack hash is invalid`);
  }
  for (const key of ['exampleWorldSpec', 'license', 'changelog']) {
    assertConfig(typeof config.release.inputs[key] === 'string', `${config.tag} release.inputs.${key} is missing`);
  }
  assertConfig(
    Object.hasOwn(config.release.files, 'evidenceVideo')
      === Object.hasOwn(config.release.inputs, 'evidenceVideo'),
    `${config.tag} evidence video file and input must be declared together`,
  );
  for (const [key, path] of Object.entries(config.release.inputs)) {
    assertRelativeConfigPath(path, `${config.tag} release.inputs.${key}`);
  }

  for (const extra of config.release.extraFiles ?? []) {
    assertConfig(typeof extra.releaseFileKey === 'string' && extra.releaseFileKey, `${config.tag} extra release key is missing`);
    assertConfig(typeof config.release.files[extra.releaseFileKey] === 'string', `${config.tag} extra release file is not declared`);
    assertRelativeConfigPath(extra.source, `${config.tag} extra release source`);
  }

  for (const archive of config.release.directoryArchives ?? []) {
    assertConfig(typeof archive.releaseFileKey === 'string' && archive.releaseFileKey, `${config.tag} directory archive key is missing`);
    assertConfig(typeof config.release.files[archive.releaseFileKey] === 'string', `${config.tag} directory archive file is not declared`);
    assertRelativeConfigPath(archive.sourceDirectory, `${config.tag} directory archive source`);
    assertRelativeConfigPath(archive.archiveRoot, `${config.tag} directory archive root`);
    assertConfig(/^[a-f0-9]{64}$/.test(archive.expectedSha256 ?? '') && !/^0+$/.test(archive.expectedSha256), `${config.tag} directory archive hash is invalid`);
  }

  const schemaKeys = new Set();
  assertConfig(config.release.schemas.length > 0, `${config.tag} schema list is empty`);
  for (const schema of config.release.schemas) {
    assertConfig(!schemaKeys.has(schema.releaseFileKey), `${config.tag} schema release key is duplicated`);
    schemaKeys.add(schema.releaseFileKey);
    assertConfig(
      typeof config.release.files[schema.releaseFileKey] === 'string',
      `${config.tag} schema release key is not declared in release.files`,
    );
    assertRelativeConfigPath(schema.source, `${config.tag} schema source`);
    assertRelativeConfigPath(schema.packPath, `${config.tag} schema pack path`);
  }

  for (const key of ['sourceDirectory', 'visualDirectory', 'renderer']) {
    assertRelativeConfigPath(config.itch[key], `${config.tag} itch.${key}`);
  }
  assertConfig(
    ['required', 'postponed'].includes(config.itch.sourceKitStatus ?? 'required'),
    `${config.tag} itch source-kit status is invalid`,
  );
  assertConfig(
    typeof config.itch.shortDescription === 'string' && config.itch.shortDescription.length > 0,
    `${config.tag} itch short description is missing`,
  );
  assertConfig(
    typeof config.itch.feedbackUrl === 'string' && config.itch.feedbackUrl.startsWith('https://github.com/'),
    `${config.tag} itch feedback URL is invalid`,
  );
  const visualNames = new Set();
  for (const visual of config.itch.visuals) {
    assertRelativeConfigPath(visual.name, `${config.tag} itch visual name`);
    assertConfig(!visualNames.has(visual.name), `${config.tag} itch visual name is duplicated`);
    visualNames.add(visual.name);
    assertConfig(Number.isSafeInteger(visual.width) && visual.width > 0, `${visual.name} width is invalid`);
    assertConfig(Number.isSafeInteger(visual.height) && visual.height > 0, `${visual.name} height is invalid`);
    assertConfig(
      Number.isSafeInteger(visual.minBytes) && visual.minBytes > 0,
      `${visual.name} minimum byte size is invalid`,
    );
  }
  return config;
}

const ALPHA_1_VERSION = '0.1.0-alpha.1';
const ALPHA_1_TAG = `v${ALPHA_1_VERSION}`;
const alpha1ReleaseFiles = releaseFiles(ALPHA_1_TAG, { evidenceVideo: true });

const alpha1 = deepFreeze(validateReleaseConfig({
  version: ALPHA_1_VERSION,
  tag: ALPHA_1_TAG,
  lifecycle: 'published',
  receiptVerifier: 'legacy-alpha1',
  expectedExamplePackSha256: 'e9434cebdecdc9ad2c1cdfa1629cb323c0384385dc70b6943426bfbf96205c8a',
  publicExamplePackSha256: 'e9434cebdecdc9ad2c1cdfa1629cb323c0384385dc70b6943426bfbf96205c8a',
  publicReleaseAssetSha256: {
    [alpha1ReleaseFiles.changelog]: '84ded87f294c6136b2a2699738a3a7c8394cc7176e2f0fcb20d82829d88f4b51',
    [alpha1ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha1ReleaseFiles.godotImporter]: 'c5d27f6df15026006c1bec7d8086569de1527da5091a87a7f941102dd34fc726',
    [alpha1ReleaseFiles.packSchema]: 'c64118ca191b47e9aa5df8970490e00d57b29c096e0d125036de6fe0b4aeb0f9',
    [alpha1ReleaseFiles.examplePack]: 'e9434cebdecdc9ad2c1cdfa1629cb323c0384385dc70b6943426bfbf96205c8a',
    [alpha1ReleaseFiles.worldSchema]: 'f51c34a56110d5536514f2add6abc565f13f687a2cfbed8c20fa40fb5578ad31',
    [alpha1ReleaseFiles.evidenceVideo]: 'e98b3e07d121ab28462a08a6cfffc375556e2234aba0eb713bff8556bb9cb13f',
    [alpha1ReleaseFiles.web]: 'f32b3cfa0defa961bf90d4e1f9c3a37db82be7328eb7fd2ba4ddb4efc8ff8b6f',
    [alpha1ReleaseFiles.manifest]: '531bb50066a2c492021f6af69fd4a045f3cb933eed3061c041dc242c81bb3449',
    [alpha1ReleaseFiles.checksums]: '5e38338d3e476d446454f0a5496ebdb5aca0e336c38545fc9ec77b0123f667bb',
    [alpha1ReleaseFiles.exampleWorldSpec]: '81734ed934bf80719a852dfee227538d0a3927cf9b568adbd6dd7a3586313bd9',
  },
  release: {
    verificationPolicy: 'sunny-meadow-procedural-cc0-v1',
    files: alpha1ReleaseFiles,
    notes: `docs/releases/${ALPHA_1_TAG}.md`,
    examplePack: {
      id: 'sunny-meadow',
      sourceDirectory: `examples/packs/sunny-meadow-${ALPHA_1_TAG}`,
      archiveRoot: `mapsoo-sunny-meadow-${ALPHA_1_TAG}`,
      worldSpecPackPath: 'worlds/sunny-meadow.world.json',
    },
    inputs: {
      exampleWorldSpec: 'examples/sunny-meadow.world.json',
      license: 'LICENSE',
      changelog: 'CHANGELOG.md',
      evidenceVideo: `docs/media/${ALPHA_1_TAG}/video/mapsoo-worldsmith-${ALPHA_1_TAG}-75s.mp4`,
    },
    schemas: [
      {
        releaseFileKey: 'worldSchema',
        source: 'schemas/mapsoo-world.schema.json',
        packPath: 'schema/mapsoo-world.schema.json',
      },
      {
        releaseFileKey: 'packSchema',
        source: 'schemas/mapsoo-pack.schema.json',
        packPath: 'schema/mapsoo-pack.schema.json',
      },
    ],
  },
  itch: {
    verificationPolicy: 'sunny-meadow-procedural-cc0-v1',
    shortDescription: 'Free CC0 pixel-art tiles, props, map JSON, and an import workflow tested on Godot 4.3 and 4.7.',
    feedbackUrl: 'https://github.com/babyrush0101-source/mapsoo-kids/issues/12',
    sourceDirectory: `docs/itch-kit/${ALPHA_1_TAG}`,
    visualDirectory: `docs/media/${ALPHA_1_TAG}/itch`,
    renderer: 'docs/release-visuals/renderer.html',
    rendererFrames: ['cover', 'hero', 'workbench', 'contents', 'godot', 'contract'],
    requiredRendererFacts: [
      'CC0-1.0',
      'Godot 4.3',
      'Godot 4.7',
      'contains_generative_ai',
      'Executable-free asset ZIP',
    ],
    supportingFiles: ['captions-75s.json'],
    visuals: [
      { name: 'cover-1260x1000.png', width: 1260, height: 1000, minBytes: 100_000, role: 'cover' },
      { name: '01-generated-pack-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '02-workbench-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '03-pack-contents-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '04-godot-verification-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '05-open-contract-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
    ],
  },
}));

const ALPHA_2_VERSION = '0.1.0-alpha.2';
const ALPHA_2_TAG = `v${ALPHA_2_VERSION}`;
const alpha2ReleaseFiles = releaseFiles(ALPHA_2_TAG, { receiptSchema: true });

const alpha2 = deepFreeze(validateReleaseConfig({
  version: ALPHA_2_VERSION,
  tag: ALPHA_2_TAG,
  lifecycle: 'published',
  receiptVerifier: 'builtin-procedural-alpha2-v0.2',
  expectedExamplePackSha256: '8c7720a8578cdc276ff69677ed0d64d8a1524d32fd00da0ffb8035b5a52bfcb6',
  publicExamplePackSha256: '8c7720a8578cdc276ff69677ed0d64d8a1524d32fd00da0ffb8035b5a52bfcb6',
  publicReleaseAssetSha256: {
    [alpha2ReleaseFiles.changelog]: '75c3ab85e94d3a838e86a51589dde087ecc044283562daf09d4dbfff5d028594',
    [alpha2ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha2ReleaseFiles.receiptSchema]: '7e9d88967366d43d84b4529746c362963e63b9992ea101ae92703b3797c9b9e3',
    [alpha2ReleaseFiles.godotImporter]: 'c5d27f6df15026006c1bec7d8086569de1527da5091a87a7f941102dd34fc726',
    [alpha2ReleaseFiles.packSchema]: 'c64118ca191b47e9aa5df8970490e00d57b29c096e0d125036de6fe0b4aeb0f9',
    [alpha2ReleaseFiles.examplePack]: '8c7720a8578cdc276ff69677ed0d64d8a1524d32fd00da0ffb8035b5a52bfcb6',
    [alpha2ReleaseFiles.worldSchema]: 'f51c34a56110d5536514f2add6abc565f13f687a2cfbed8c20fa40fb5578ad31',
    [alpha2ReleaseFiles.web]: 'b25bf5f0d20b48193643a86806775b731af2852c60853b2e2f852a810e43b0c0',
    [alpha2ReleaseFiles.manifest]: '5baa85816af7965b439e643a58d3a10f28d66e683a5c8501155f08ee4c640dec',
    [alpha2ReleaseFiles.checksums]: '0e77173a9b364de9aa8994b73677f48e92d1afe718b5aa4a4e1af16654783479',
    [alpha2ReleaseFiles.exampleWorldSpec]: '81734ed934bf80719a852dfee227538d0a3927cf9b568adbd6dd7a3586313bd9',
  },
  release: {
    verificationPolicy: 'sunny-meadow-procedural-cc0-v2',
    files: alpha2ReleaseFiles,
    notes: `docs/releases/${ALPHA_2_TAG}.md`,
    examplePack: {
      id: 'sunny-meadow',
      sourceDirectory: `examples/packs/sunny-meadow-${ALPHA_2_TAG}`,
      archiveRoot: `mapsoo-sunny-meadow-${ALPHA_2_TAG}`,
      worldSpecPackPath: 'worlds/sunny-meadow.world.json',
    },
    inputs: {
      exampleWorldSpec: 'examples/sunny-meadow.world.json',
      license: 'LICENSE',
      changelog: 'CHANGELOG.md',
    },
    schemas: [
      {
        releaseFileKey: 'worldSchema',
        source: 'schemas/mapsoo-world.schema.json',
        packPath: 'schema/mapsoo-world.schema.json',
      },
      {
        releaseFileKey: 'packSchema',
        source: 'schemas/mapsoo-pack.schema.json',
        packPath: 'schema/mapsoo-pack.schema.json',
      },
      {
        releaseFileKey: 'receiptSchema',
        source: 'schemas/mapsoo-generation-receipt.schema.json',
        packPath: 'schema/mapsoo-generation-receipt.schema.json',
      },
    ],
  },
  itch: {
    verificationPolicy: 'sunny-meadow-procedural-cc0-v2',
    shortDescription: 'Free CC0 pixel-art tiles, props, map JSON, and a fixed-hash import workflow CI-gated on Godot 4.3 and 4.7.',
    feedbackUrl: 'https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=bug-report.yml',
    sourceDirectory: `docs/itch-kit/${ALPHA_2_TAG}`,
    visualDirectory: `docs/media/${ALPHA_2_TAG}/itch`,
    renderer: `docs/release-visuals/renderer-${ALPHA_2_TAG}.html`,
    rendererFrames: ['cover', 'hero', 'workbench', 'contents', 'godot', 'contract'],
    requiredRendererFacts: [
      ALPHA_2_TAG,
      'Generation receipt 0.2.0',
      '12 files',
      '11 payload records',
      'CC0-1.0',
      'Godot 4.3',
      'Godot 4.7',
      'contains_generative_ai',
      'Executable-free asset ZIP',
    ],
    supportingFiles: [],
    visuals: [
      { name: 'cover-1260x1000.png', width: 1260, height: 1000, minBytes: 100_000, role: 'cover' },
      { name: '01-generated-pack-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '02-workbench-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '03-pack-contents-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '04-godot-verification-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '05-open-contract-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
    ],
  },
}));

const ALPHA_3_VERSION = '0.1.0-alpha.3';
const ALPHA_3_TAG = `v${ALPHA_3_VERSION}`;
const alpha3ReleaseFiles = releaseFiles(ALPHA_3_TAG, { receiptSchema: true });

const alpha3 = deepFreeze(validateReleaseConfig({
  version: ALPHA_3_VERSION,
  tag: ALPHA_3_TAG,
  lifecycle: 'published',
  receiptVerifier: 'builtin-procedural-alpha3-v0.2',
  expectedExamplePackSha256: 'af95a4e57187fb85d06e34ccb0e1a1b1dba9b91e8989debf4c30a93108589696',
  publicExamplePackSha256: 'af95a4e57187fb85d06e34ccb0e1a1b1dba9b91e8989debf4c30a93108589696',
  publicReleaseAssetSha256: {
    [alpha3ReleaseFiles.changelog]: '9bf61a834edf7b657dd68d8ef647db91e720b9c5b601d9a954a34484b54e9260',
    [alpha3ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha3ReleaseFiles.receiptSchema]: '7e9d88967366d43d84b4529746c362963e63b9992ea101ae92703b3797c9b9e3',
    [alpha3ReleaseFiles.godotImporter]: '49a2c30b0df50cff46c4a2acaa5c093d0eb58733387472ab27e6e7f2dfaabd86',
    [alpha3ReleaseFiles.packSchema]: 'c64118ca191b47e9aa5df8970490e00d57b29c096e0d125036de6fe0b4aeb0f9',
    [alpha3ReleaseFiles.examplePack]: 'af95a4e57187fb85d06e34ccb0e1a1b1dba9b91e8989debf4c30a93108589696',
    [alpha3ReleaseFiles.worldSchema]: 'f51c34a56110d5536514f2add6abc565f13f687a2cfbed8c20fa40fb5578ad31',
    [alpha3ReleaseFiles.web]: '7a8d685ec3a113c9a75b7b191bba4096d1dc274439d542f1b8cf8f66be3c0372',
    [alpha3ReleaseFiles.manifest]: 'a38a20a1e5ad35b21ea5fe6da8bcd7f2ad751dcb3d4226e23b9c1f1f697e1710',
    [alpha3ReleaseFiles.checksums]: '7defff5b9c75e1c1de9fb4b1da5786732e7ed60840b31243c541a8ce6241bde9',
    [alpha3ReleaseFiles.exampleWorldSpec]: '81734ed934bf80719a852dfee227538d0a3927cf9b568adbd6dd7a3586313bd9',
  },
  release: {
    verificationPolicy: 'sunny-meadow-procedural-cc0-v3',
    files: alpha3ReleaseFiles,
    notes: `docs/releases/${ALPHA_3_TAG}.md`,
    examplePack: {
      id: 'sunny-meadow',
      sourceDirectory: `examples/packs/sunny-meadow-${ALPHA_3_TAG}`,
      archiveRoot: `mapsoo-sunny-meadow-${ALPHA_3_TAG}`,
      worldSpecPackPath: 'worlds/sunny-meadow.world.json',
    },
    inputs: {
      exampleWorldSpec: 'examples/sunny-meadow.world.json',
      license: 'LICENSE',
      changelog: 'CHANGELOG.md',
    },
    schemas: [
      {
        releaseFileKey: 'worldSchema',
        source: 'schemas/mapsoo-world.schema.json',
        packPath: 'schema/mapsoo-world.schema.json',
      },
      {
        releaseFileKey: 'packSchema',
        source: 'schemas/mapsoo-pack.schema.json',
        packPath: 'schema/mapsoo-pack.schema.json',
      },
      {
        releaseFileKey: 'receiptSchema',
        source: 'schemas/mapsoo-generation-receipt.schema.json',
        packPath: 'schema/mapsoo-generation-receipt.schema.json',
      },
    ],
  },
  itch: {
    verificationPolicy: 'sunny-meadow-procedural-cc0-v3',
    shortDescription: 'Free CC0 pixel-art world pack with transactional Godot re-import tested on 4.3 and 4.7.',
    feedbackUrl: 'https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml',
    sourceDirectory: `docs/itch-kit/${ALPHA_3_TAG}`,
    visualDirectory: `docs/media/${ALPHA_3_TAG}/itch`,
    renderer: `docs/release-visuals/renderer-${ALPHA_3_TAG}.html`,
    rendererFrames: ['cover', 'hero', 'workbench', 'contents', 'godot', 'contract'],
    requiredRendererFacts: [
      ALPHA_3_TAG,
      'af95a4e57187fb85d06e34ccb0e1a1b1dba9b91e8989debf4c30a93108589696',
      'mapsoo.import-state.json',
      'created / unchanged / updated / conflict',
      'Process-level rollback',
      'Generation receipt 0.2.0',
      '12 files',
      '11 payload records',
      'CC0-1.0',
      'Godot 4.3',
      'Godot 4.7',
      'contains_generative_ai',
      'Executable-free asset ZIP',
    ],
    supportingFiles: [],
    visuals: [
      { name: 'cover-1260x1000.png', width: 1260, height: 1000, minBytes: 100_000, role: 'cover' },
      { name: '01-generated-pack-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '02-workbench-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '03-pack-contents-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '04-godot-verification-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '05-open-contract-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
    ],
  },
}));

const ALPHA_4_VERSION = '0.1.0-alpha.4';
const ALPHA_4_TAG = `v${ALPHA_4_VERSION}`;
const alpha4ReleaseFiles = releaseFiles(ALPHA_4_TAG, { receiptSchema: true });

const alpha4 = deepFreeze(validateReleaseConfig({
  version: ALPHA_4_VERSION,
  tag: ALPHA_4_TAG,
  lifecycle: 'published',
  receiptVerifier: 'builtin-playable-terrain-alpha4-v0.2',
  expectedExamplePackSha256: 'a57e810baaf2f015d7db96bf0e88ab7b6340d476a61ade7447735a6109b8fb35',
  publicExamplePackSha256: 'a57e810baaf2f015d7db96bf0e88ab7b6340d476a61ade7447735a6109b8fb35',
  publicReleaseAssetSha256: {
    [alpha4ReleaseFiles.changelog]: '950452e45bf3dc5c1f5b55dce9ac68ca4335e6adcf4a52803bca8eb9c7a396b4',
    [alpha4ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha4ReleaseFiles.receiptSchema]: '7e9d88967366d43d84b4529746c362963e63b9992ea101ae92703b3797c9b9e3',
    [alpha4ReleaseFiles.godotImporter]: '428fdab014682fcee49b7777f9647f9222ee9793d55fd2b25053460912f167fb',
    [alpha4ReleaseFiles.packSchema]: 'dff9ebdd163c9cbdb026287bb1ad1b3f51737a9b31fd8a7e8d443770a6fc2b73',
    [alpha4ReleaseFiles.examplePack]: 'a57e810baaf2f015d7db96bf0e88ab7b6340d476a61ade7447735a6109b8fb35',
    [alpha4ReleaseFiles.worldSchema]: 'f51c34a56110d5536514f2add6abc565f13f687a2cfbed8c20fa40fb5578ad31',
    [alpha4ReleaseFiles.web]: 'ea1386add84a44ef7f79de63b25b0ed4ce3617f4d7dd380ca4f198d84c254e2b',
    [alpha4ReleaseFiles.manifest]: 'c68b13c6450b4965f115bf97085bdac7f723cadc830909ab574b936c5f681346',
    [alpha4ReleaseFiles.checksums]: 'ffe30f4298a2a73dc92e6d6f484cdc822b97334e2e4859a2f22085e6a7ced1d2',
    [alpha4ReleaseFiles.exampleWorldSpec]: '81734ed934bf80719a852dfee227538d0a3927cf9b568adbd6dd7a3586313bd9',
  },
  release: {
    verificationPolicy: 'sunny-meadow-playable-terrain-cc0-v4',
    files: alpha4ReleaseFiles,
    notes: `docs/releases/${ALPHA_4_TAG}.md`,
    examplePack: {
      id: 'sunny-meadow',
      sourceDirectory: `examples/packs/sunny-meadow-${ALPHA_4_TAG}`,
      archiveRoot: `mapsoo-sunny-meadow-${ALPHA_4_TAG}`,
      worldSpecPackPath: 'worlds/sunny-meadow.world.json',
    },
    inputs: {
      exampleWorldSpec: 'examples/sunny-meadow.world.json',
      license: 'LICENSE',
      changelog: 'CHANGELOG.md',
    },
    schemas: [
      {
        releaseFileKey: 'worldSchema',
        source: 'schemas/mapsoo-world.schema.json',
        packPath: 'schema/mapsoo-world.schema.json',
      },
      {
        releaseFileKey: 'packSchema',
        source: 'schemas/mapsoo-pack-0.2.schema.json',
        packPath: 'schema/mapsoo-pack-0.2.schema.json',
      },
      {
        releaseFileKey: 'receiptSchema',
        source: 'schemas/mapsoo-generation-receipt.schema.json',
        packPath: 'schema/mapsoo-generation-receipt.schema.json',
      },
    ],
  },
  itch: {
    verificationPolicy: 'sunny-meadow-playable-terrain-cc0-v4',
    shortDescription: 'Free CC0 layered terrain pack with Godot Terrain Sets, six props, and basic water collision.',
    feedbackUrl: 'https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml',
    sourceDirectory: `docs/itch-kit/${ALPHA_4_TAG}`,
    visualDirectory: `docs/media/${ALPHA_4_TAG}/itch`,
    renderer: `docs/release-visuals/renderer-${ALPHA_4_TAG}.html`,
    rendererFrames: ['cover', 'hero', 'workbench', 'contents', 'godot', 'contract'],
    requiredRendererFacts: [
      ALPHA_4_TAG,
      'Pack schema 0.2.0',
      'Ground / Water / Roads / Props',
      '35 terrain tiles',
      '6 prop sprites',
      'CC0-1.0',
      'Godot 4.3',
      'Godot 4.7',
      'contains_generative_ai',
      'Executable-free asset ZIP',
    ],
    supportingFiles: [],
    visuals: [
      { name: 'cover-1260x1000.png', width: 1260, height: 1000, minBytes: 100_000, role: 'cover' },
      { name: '01-generated-pack-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '02-workbench-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '03-pack-contents-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '04-godot-verification-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
      { name: '05-open-contract-1600x900.png', width: 1600, height: 900, minBytes: 100_000, role: 'screenshot' },
    ],
  },
}));

const ALPHA_5_VERSION = '0.1.0-alpha.5';
const ALPHA_5_TAG = `v${ALPHA_5_VERSION}`;
const alpha5ReleaseFiles = releaseFiles(ALPHA_5_TAG, { receiptSchema: true, placesSchema: true });

const alpha5 = deepFreeze(validateReleaseConfig({
  version: ALPHA_5_VERSION,
  tag: ALPHA_5_TAG,
  lifecycle: 'published',
  receiptVerifier: 'builtin-semantic-places-alpha5-v0.2',
  expectedExamplePackSha256: '8d86124a4a37fa4a78487c4e91cb7f5024561f140814a5fd139c5b93fde54f36',
  publicExamplePackSha256: '8d86124a4a37fa4a78487c4e91cb7f5024561f140814a5fd139c5b93fde54f36',
  publicReleaseAssetSha256: {
    [alpha5ReleaseFiles.changelog]: 'b8c3e890710aef075ae1ea7900e007296d0de8f7df2634cb59b31877e90aa976',
    [alpha5ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha5ReleaseFiles.receiptSchema]: '7e9d88967366d43d84b4529746c362963e63b9992ea101ae92703b3797c9b9e3',
    [alpha5ReleaseFiles.godotImporter]: '6020bda92da56aacb924b994990bc6bd20086ddd1370f71eee36f9ee782c9894',
    [alpha5ReleaseFiles.packSchema]: '8bb09ca30c2b7ffcc49c10fd8089a08ea7d234afb88ef72601d0e0bcc440f423',
    [alpha5ReleaseFiles.placesSchema]: '28874f02c038526d2c7f8b442adc177f77c64cae6422a23aa775a2669b59fa7b',
    [alpha5ReleaseFiles.examplePack]: '8d86124a4a37fa4a78487c4e91cb7f5024561f140814a5fd139c5b93fde54f36',
    [alpha5ReleaseFiles.worldSchema]: '2d2f81d0241404d8a8a503af3d6493437a8878b04f599ca1e0080f1f7e17e1e5',
    [alpha5ReleaseFiles.web]: '1c73f8887ae045c9ba47f914ffd8e6ff9eef9c72c7cfb13c0a4bc0d6d90d66bd',
    [alpha5ReleaseFiles.manifest]: '4da5bfadaaf705e8e4b64be68113a7229bd5732049b53214faca184bd5c3704a',
    [alpha5ReleaseFiles.checksums]: '51351875b647fd8d159a933766092b949e4a6b619b85de3a0eb84effde40eceb',
    [alpha5ReleaseFiles.exampleWorldSpec]: '191f070cbe517fa84c1f8aa1039f94ab20628d6e78fbd725cead4cad0979567c',
  },
  release: {
    verificationPolicy: 'sunny-meadow-semantic-places-cc0-v5',
    files: alpha5ReleaseFiles,
    notes: `docs/releases/${ALPHA_5_TAG}.md`,
    examplePack: {
      id: 'sunny-meadow',
      sourceDirectory: `examples/packs/sunny-meadow-${ALPHA_5_TAG}`,
      archiveRoot: `mapsoo-sunny-meadow-${ALPHA_5_TAG}`,
      worldSpecPackPath: 'worlds/sunny-meadow.world.json',
    },
    inputs: {
      exampleWorldSpec: 'examples/sunny-meadow-v0.2.world.json',
      license: 'LICENSE',
      changelog: 'CHANGELOG.md',
    },
    schemas: [
      { releaseFileKey: 'worldSchema', source: 'schemas/mapsoo-world-0.2.schema.json', packPath: 'schema/mapsoo-world-0.2.schema.json' },
      { releaseFileKey: 'packSchema', source: 'schemas/mapsoo-pack-0.3.schema.json', packPath: 'schema/mapsoo-pack-0.3.schema.json' },
      { releaseFileKey: 'placesSchema', source: 'schemas/mapsoo-places-0.1.schema.json', packPath: 'schema/mapsoo-places-0.1.schema.json' },
      { releaseFileKey: 'receiptSchema', source: 'schemas/mapsoo-generation-receipt.schema.json', packPath: 'schema/mapsoo-generation-receipt.schema.json' },
    ],
  },
  itch: {
    verificationPolicy: 'sunny-meadow-semantic-places-cc0-v5',
    shortDescription: 'Free CC0 Godot world pack with deterministic semantic places and engine-neutral runtime metadata.',
    feedbackUrl: 'https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml',
    sourceDirectory: `docs/itch-kit/${ALPHA_5_TAG}`,
    visualDirectory: `docs/media/${ALPHA_5_TAG}/itch`,
    renderer: `docs/release-visuals/renderer-${ALPHA_5_TAG}.html`,
    rendererFrames: [],
    requiredRendererFacts: [],
    supportingFiles: [],
    visuals: [],
  },
}));

const ALPHA_6_VERSION = '0.1.0-alpha.6';
const ALPHA_6_TAG = `v${ALPHA_6_VERSION}`;
const alpha6ReleaseFiles = releaseFiles(ALPHA_6_TAG, {
  receiptSchema: true,
  placesSchema: true,
  structuresSchema: true,
});

const alpha6 = deepFreeze(validateReleaseConfig({
  version: ALPHA_6_VERSION,
  tag: ALPHA_6_TAG,
  lifecycle: 'published',
  receiptVerifier: 'builtin-semantic-structures-alpha6-v0.2',
  expectedExamplePackSha256: '4563552187977b38cdba86c7d3cbf5429a67b7a0a6049e978c2ef2992ef3a054',
  publicExamplePackSha256: '4563552187977b38cdba86c7d3cbf5429a67b7a0a6049e978c2ef2992ef3a054',
  publicReleaseAssetSha256: {
    [alpha6ReleaseFiles.changelog]: '6fc13bf4b5038ddbfdaa4d87bd159afff8df46d8081216cf1e64c53a01b55122',
    [alpha6ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha6ReleaseFiles.receiptSchema]: '7e9d88967366d43d84b4529746c362963e63b9992ea101ae92703b3797c9b9e3',
    [alpha6ReleaseFiles.godotImporter]: 'bbfacd2b5c8503214b7647d59e9911a34fa1b4e073f86bd1310686812c9142c0',
    [alpha6ReleaseFiles.packSchema]: 'fb5a5476e7e28a5c7fa62c806d9f1b80cf275ab3f13e2b151ae5bc11258502cc',
    [alpha6ReleaseFiles.placesSchema]: 'f5daa98aaec09928558f404242be2b2b68082a4edd9fa62cb8d891c6a5f806df',
    [alpha6ReleaseFiles.structuresSchema]: '3265a90cc13dee53c018a6b6e55c276f71a609eb1397712ddc5acb39a003f74e',
    [alpha6ReleaseFiles.examplePack]: '4563552187977b38cdba86c7d3cbf5429a67b7a0a6049e978c2ef2992ef3a054',
    [alpha6ReleaseFiles.worldSchema]: 'aa9e1422d25f92b7fea0b41723b35f59a2a77ad87008baa15e7e0921b3abcef6',
    [alpha6ReleaseFiles.web]: 'c7dde2aebffd1607312987c5b4b452eda690558f7d9f16c9df883da66e63024f',
    [alpha6ReleaseFiles.manifest]: '48c3344735aa60f50f93aeeac96784e410027d191c801b767bf447bdd2ecd0e7',
    [alpha6ReleaseFiles.checksums]: '6398ab13fbdbc6fd38a811a5064ce97b841b55931c203a7026a7e24e39bcc339',
    [alpha6ReleaseFiles.exampleWorldSpec]: 'e33a3e67f2febd803b7920a0fc9e58ebead35e5b8b830fabe3816e0e960b4655',
  },
  release: {
    verificationPolicy: 'sunny-meadow-semantic-structures-cc0-v6',
    files: alpha6ReleaseFiles,
    notes: `docs/releases/${ALPHA_6_TAG}.md`,
    examplePack: {
      id: 'sunny-meadow',
      sourceDirectory: `examples/packs/sunny-meadow-${ALPHA_6_TAG}`,
      archiveRoot: `mapsoo-sunny-meadow-${ALPHA_6_TAG}`,
      worldSpecPackPath: 'worlds/sunny-meadow.world.json',
    },
    inputs: {
      exampleWorldSpec: 'examples/sunny-meadow-v0.3.world.json',
      license: 'LICENSE',
      changelog: 'CHANGELOG.md',
    },
    schemas: [
      { releaseFileKey: 'worldSchema', source: 'schemas/mapsoo-world-0.3.schema.json', packPath: 'schema/mapsoo-world-0.3.schema.json' },
      { releaseFileKey: 'packSchema', source: 'schemas/mapsoo-pack-0.4.schema.json', packPath: 'schema/mapsoo-pack-0.4.schema.json' },
      { releaseFileKey: 'placesSchema', source: 'schemas/mapsoo-places-0.2.schema.json', packPath: 'schema/mapsoo-places-0.2.schema.json' },
      { releaseFileKey: 'structuresSchema', source: 'schemas/mapsoo-structures-0.1.schema.json', packPath: 'schema/mapsoo-structures-0.1.schema.json' },
      { releaseFileKey: 'receiptSchema', source: 'schemas/mapsoo-generation-receipt.schema.json', packPath: 'schema/mapsoo-generation-receipt.schema.json' },
    ],
  },
  itch: {
    verificationPolicy: 'sunny-meadow-semantic-structures-cc0-v6',
    shortDescription: 'Free CC0 Godot world pack with deterministic place-linked exterior structures.',
    feedbackUrl: 'https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml',
    sourceDirectory: `docs/itch-kit/${ALPHA_6_TAG}`,
    visualDirectory: `docs/media/${ALPHA_6_TAG}/itch`,
    renderer: `docs/release-visuals/renderer-${ALPHA_6_TAG}.html`,
    rendererFrames: [],
    requiredRendererFacts: [],
    supportingFiles: [],
    visuals: [],
  },
}));

const ALPHA_7_VERSION = '0.1.0-alpha.7';
const ALPHA_7_TAG = `v${ALPHA_7_VERSION}`;
const alpha7ReleaseFiles = releaseFiles(ALPHA_7_TAG, {
  receiptSchema: true,
  placesSchema: true,
  structuresSchema: true,
  worldGallery: true,
});

const alpha7 = deepFreeze(validateReleaseConfig({
  version: ALPHA_7_VERSION,
  tag: ALPHA_7_TAG,
  lifecycle: 'published',
  receiptVerifier: 'builtin-world-gallery-alpha7-v0.2',
  expectedExamplePackSha256: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
  publicExamplePackSha256: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
  publicReleaseAssetSha256: {
    [alpha7ReleaseFiles.changelog]: '2669582cde4c363941af0c2adc51c9ee57488e8fbc0b9a24b129c2126eb6995b',
    [alpha7ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha7ReleaseFiles.exampleWorldSpec]: 'e33a3e67f2febd803b7920a0fc9e58ebead35e5b8b830fabe3816e0e960b4655',
    [alpha7ReleaseFiles.dustwindWorldSpec]: 'd229ed303e2c003a2f9ba75760e1dab5ab0e8dcd1d385f0c0e17bf69c6140e07',
    [alpha7ReleaseFiles.frostwatchWorldSpec]: '0ca57d56c646898a091f9a7b59c2542c645d66138e435d527ed0e089148a716f',
    [alpha7ReleaseFiles.examplePack]: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
    [alpha7ReleaseFiles.dustwindPack]: 'd6dd38a47522f45d24184d9b6869d92b89cc2ae3ad1c2ca1eab0b9cf4b13a502',
    [alpha7ReleaseFiles.frostwatchPack]: '35a49edd901becae1422731a132803eebaf07659fc3d69efa7d39cd1e87b9e12',
    [alpha7ReleaseFiles.receiptSchema]: '7e9d88967366d43d84b4529746c362963e63b9992ea101ae92703b3797c9b9e3',
    [alpha7ReleaseFiles.godotImporter]: '674ce0a057c1808b8d2b04e706a26031aa7ca321304ce34c0e6a2f3553bd6a26',
    [alpha7ReleaseFiles.packSchema]: '209a97580ceede4fc46f1fbe86144a1cb7a28b68c20396558fac38b410d26c21',
    [alpha7ReleaseFiles.placesSchema]: '880c319b72dedcc38c881fb06ee269649a9e1301a4dd09d63005b94d9aa03152',
    [alpha7ReleaseFiles.structuresSchema]: 'be1b7f4720c74f6a342a224eb9d6ed8bad99c34ca0c0fe9e1397b8eee9c6710d',
    [alpha7ReleaseFiles.worldSchema]: 'aa9e1422d25f92b7fea0b41723b35f59a2a77ad87008baa15e7e0921b3abcef6',
    [alpha7ReleaseFiles.web]: 'd3b5e899c57fe433ad283bee605ea8cbb024ccdeecf615f2d6c6470157bd024f',
    [alpha7ReleaseFiles.manifest]: '1e93af30bfda3e7a1d24e69d4852adbbdea532b1df87ac63631e55e9d8631e6e',
    [alpha7ReleaseFiles.checksums]: '79525089015e1a8ac4fd51978521171406684366d61153bc45f60e385ac02619',
  },
  release: {
    verificationPolicy: 'world-gallery-semantic-structures-cc0-v7',
    files: alpha7ReleaseFiles,
    notes: `docs/releases/${ALPHA_7_TAG}.md`,
    examplePack: {
      id: 'sunny-meadow',
      sourceDirectory: `examples/packs/sunny-meadow-${ALPHA_7_TAG}`,
      archiveRoot: `mapsoo-sunny-meadow-${ALPHA_7_TAG}`,
      worldSpecPackPath: 'worlds/sunny-meadow.world.json',
    },
    additionalExamplePacks: [
      {
        id: 'dustwind-outpost', releaseFileKey: 'dustwindPack', worldSpecReleaseFileKey: 'dustwindWorldSpec',
        sourceDirectory: `examples/packs/dustwind-outpost-${ALPHA_7_TAG}`,
        archiveRoot: `mapsoo-dustwind-outpost-${ALPHA_7_TAG}`,
        worldSpecPackPath: 'worlds/dustwind-outpost.world.json',
        worldSpecInput: 'examples/dustwind-outpost-v0.3.world.json',
        expectedSha256: 'd6dd38a47522f45d24184d9b6869d92b89cc2ae3ad1c2ca1eab0b9cf4b13a502',
      },
      {
        id: 'frostwatch-vale', releaseFileKey: 'frostwatchPack', worldSpecReleaseFileKey: 'frostwatchWorldSpec',
        sourceDirectory: `examples/packs/frostwatch-vale-${ALPHA_7_TAG}`,
        archiveRoot: `mapsoo-frostwatch-vale-${ALPHA_7_TAG}`,
        worldSpecPackPath: 'worlds/frostwatch-vale.world.json',
        worldSpecInput: 'examples/frostwatch-vale-v0.3.world.json',
        expectedSha256: '35a49edd901becae1422731a132803eebaf07659fc3d69efa7d39cd1e87b9e12',
      },
    ],
    inputs: {
      exampleWorldSpec: 'examples/sunny-meadow-v0.3.world.json',
      license: 'LICENSE',
      changelog: 'CHANGELOG.md',
    },
    schemas: [
      { releaseFileKey: 'worldSchema', source: 'schemas/mapsoo-world-0.3.schema.json', packPath: 'schema/mapsoo-world-0.3.schema.json' },
      { releaseFileKey: 'packSchema', source: 'schemas/mapsoo-pack-0.5.schema.json', packPath: 'schema/mapsoo-pack-0.5.schema.json' },
      { releaseFileKey: 'placesSchema', source: 'schemas/mapsoo-places-0.3.schema.json', packPath: 'schema/mapsoo-places-0.3.schema.json' },
      { releaseFileKey: 'structuresSchema', source: 'schemas/mapsoo-structures-0.2.schema.json', packPath: 'schema/mapsoo-structures-0.2.schema.json' },
      { releaseFileKey: 'receiptSchema', source: 'schemas/mapsoo-generation-receipt.schema.json', packPath: 'schema/mapsoo-generation-receipt.schema.json' },
    ],
  },
  itch: {
    verificationPolicy: 'world-gallery-semantic-structures-cc0-v7',
    sourceKitStatus: 'postponed',
    shortDescription: 'Free CC0 Godot world gallery with three deterministic, executable-free asset packs.',
    feedbackUrl: 'https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml',
    sourceDirectory: `docs/itch-kit/${ALPHA_7_TAG}`,
    visualDirectory: `docs/media/${ALPHA_7_TAG}/itch`,
    renderer: `docs/release-visuals/renderer-${ALPHA_7_TAG}.html`,
    rendererFrames: [], requiredRendererFacts: [], supportingFiles: [], visuals: [],
  },
}));

const ALPHA_8_VERSION = '0.1.0-alpha.8';
const ALPHA_8_TAG = `v${ALPHA_8_VERSION}`;
const alpha8ReleaseFiles = {
  ...releaseFiles(ALPHA_8_TAG, {
    receiptSchema: true,
    placesSchema: true,
    structuresSchema: true,
    worldGallery: true,
    externalHostBridge: true,
  }),
  // Alpha.8 is a toolchain/bridge release. Its audited compatibility assets
  // remain the byte-identical, explicitly named Alpha.7 packs.
  examplePack: alpha7ReleaseFiles.examplePack,
  dustwindPack: alpha7ReleaseFiles.dustwindPack,
  frostwatchPack: alpha7ReleaseFiles.frostwatchPack,
};

const alpha8 = deepFreeze(validateReleaseConfig({
  version: ALPHA_8_VERSION,
  tag: ALPHA_8_TAG,
  packVersion: ALPHA_7_VERSION,
  lifecycle: 'published',
  publicAssetNamePolicy: 'privacy-redacted',
  receiptVerifier: 'builtin-world-gallery-alpha7-v0.2',
  expectedExamplePackSha256: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
  publicExamplePackSha256: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
  publicReleaseAssetSha256: {
    [alpha8ReleaseFiles.changelog]: '250f27a849c65ce86b6727047a5935565bdc3570e3dc668d6f425889a71e607f',
    [alpha8ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha8ReleaseFiles.exampleWorldSpec]: 'e33a3e67f2febd803b7920a0fc9e58ebead35e5b8b830fabe3816e0e960b4655',
    [alpha8ReleaseFiles.dustwindWorldSpec]: 'd229ed303e2c003a2f9ba75760e1dab5ab0e8dcd1d385f0c0e17bf69c6140e07',
    [alpha8ReleaseFiles.frostwatchWorldSpec]: '0ca57d56c646898a091f9a7b59c2542c645d66138e435d527ed0e089148a716f',
    [alpha8ReleaseFiles.examplePack]: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
    [alpha8ReleaseFiles.dustwindPack]: 'd6dd38a47522f45d24184d9b6869d92b89cc2ae3ad1c2ca1eab0b9cf4b13a502',
    [alpha8ReleaseFiles.frostwatchPack]: '35a49edd901becae1422731a132803eebaf07659fc3d69efa7d39cd1e87b9e12',
    [alpha8ReleaseFiles.receiptSchema]: '7e9d88967366d43d84b4529746c362963e63b9992ea101ae92703b3797c9b9e3',
    [alpha8ReleaseFiles.godotImporter]: 'd959c6675dad612bb69e5699022ef98f761a3b894051e17e232c332ff1b42257',
    [alpha8ReleaseFiles.packSchema]: '209a97580ceede4fc46f1fbe86144a1cb7a28b68c20396558fac38b410d26c21',
    [alpha8ReleaseFiles.placesSchema]: '880c319b72dedcc38c881fb06ee269649a9e1301a4dd09d63005b94d9aa03152',
    [alpha8ReleaseFiles.structuresSchema]: 'be1b7f4720c74f6a342a224eb9d6ed8bad99c34ca0c0fe9e1397b8eee9c6710d',
    [alpha8ReleaseFiles.worldSchema]: 'aa9e1422d25f92b7fea0b41723b35f59a2a77ad87008baa15e7e0921b3abcef6',
    [alpha8ReleaseFiles.web]: 'adb7a1182f296b6aebcec998d4c67e191a1a24c11cbb25292cf1252c3ff92426',
    [alpha8ReleaseFiles.manifest]: '349d0c202c0d57a432051a8a676709bd2d518728f077f074abc6a35f6d3194ae',
    [alpha8ReleaseFiles.checksums]: '70bb3bfea75c132cd8748dcd808d94c4fdf59ed31eeff7f06320de4f1ecb6467',
    [alpha8ReleaseFiles.externalHostRequestSchema]: 'd3b7d6bb76c0f0b5b91f9a9b31eaa494b14b1ba6fa96567038bf388a6a09a7ba',
    [alpha8ReleaseFiles.externalHostExportReceiptSchema]: '6d5d7bf6d022bea07527e9a0a12f5dae645bb75c51748b860c6f64b35e1811fd',
    [alpha8ReleaseFiles.externalHostExampleRequest]: 'b17e92d74bd707031d60e851668ecf6279528eb2b6595b65c59b8bfcfb702682',
  },
  release: {
    verificationPolicy: 'world-gallery-semantic-structures-cc0-v7',
    files: alpha8ReleaseFiles,
    notes: `docs/releases/${ALPHA_8_TAG}.md`,
    examplePack: {
      id: 'sunny-meadow',
      sourceDirectory: `examples/packs/sunny-meadow-${ALPHA_7_TAG}`,
      archiveRoot: `mapsoo-sunny-meadow-${ALPHA_7_TAG}`,
      worldSpecPackPath: 'worlds/sunny-meadow.world.json',
    },
    additionalExamplePacks: [
      {
        id: 'dustwind-outpost', releaseFileKey: 'dustwindPack', worldSpecReleaseFileKey: 'dustwindWorldSpec',
        sourceDirectory: `examples/packs/dustwind-outpost-${ALPHA_7_TAG}`,
        archiveRoot: `mapsoo-dustwind-outpost-${ALPHA_7_TAG}`,
        worldSpecPackPath: 'worlds/dustwind-outpost.world.json',
        worldSpecInput: 'examples/dustwind-outpost-v0.3.world.json',
        expectedSha256: 'd6dd38a47522f45d24184d9b6869d92b89cc2ae3ad1c2ca1eab0b9cf4b13a502',
      },
      {
        id: 'frostwatch-vale', releaseFileKey: 'frostwatchPack', worldSpecReleaseFileKey: 'frostwatchWorldSpec',
        sourceDirectory: `examples/packs/frostwatch-vale-${ALPHA_7_TAG}`,
        archiveRoot: `mapsoo-frostwatch-vale-${ALPHA_7_TAG}`,
        worldSpecPackPath: 'worlds/frostwatch-vale.world.json',
        worldSpecInput: 'examples/frostwatch-vale-v0.3.world.json',
        expectedSha256: '35a49edd901becae1422731a132803eebaf07659fc3d69efa7d39cd1e87b9e12',
      },
    ],
    inputs: {
      exampleWorldSpec: 'examples/sunny-meadow-v0.3.world.json',
      license: 'LICENSE',
      changelog: 'CHANGELOG.md',
    },
    schemas: [
      { releaseFileKey: 'worldSchema', source: 'schemas/mapsoo-world-0.3.schema.json', packPath: 'schema/mapsoo-world-0.3.schema.json' },
      { releaseFileKey: 'packSchema', source: 'schemas/mapsoo-pack-0.5.schema.json', packPath: 'schema/mapsoo-pack-0.5.schema.json' },
      { releaseFileKey: 'placesSchema', source: 'schemas/mapsoo-places-0.3.schema.json', packPath: 'schema/mapsoo-places-0.3.schema.json' },
      { releaseFileKey: 'structuresSchema', source: 'schemas/mapsoo-structures-0.2.schema.json', packPath: 'schema/mapsoo-structures-0.2.schema.json' },
      { releaseFileKey: 'receiptSchema', source: 'schemas/mapsoo-generation-receipt.schema.json', packPath: 'schema/mapsoo-generation-receipt.schema.json' },
    ],
    extraFiles: [
      { releaseFileKey: 'externalHostRequestSchema', source: 'integrations/external-host/external-host-asset-request.schema.json' },
      { releaseFileKey: 'externalHostExportReceiptSchema', source: 'integrations/external-host/external-host-mapsoo-export-receipt.schema.json' },
      { releaseFileKey: 'externalHostExampleRequest', source: 'examples/integrations/external-host/river-valley-asset-request.json' },
    ],
  },
  itch: {
    verificationPolicy: 'world-gallery-semantic-structures-cc0-v7',
    sourceKitStatus: 'postponed',
    shortDescription: 'Local-first External Host request bridge for reproducible Alpha.7-compatible Godot world packs.',
    feedbackUrl: 'https://github.com/babyrush0101-source/mapsoo-kids/issues/new?template=first-import-feedback.yml',
    sourceDirectory: `docs/itch-kit/${ALPHA_8_TAG}`,
    visualDirectory: `docs/media/${ALPHA_8_TAG}/itch`,
    renderer: `docs/release-visuals/renderer-${ALPHA_8_TAG}.html`,
    rendererFrames: [], requiredRendererFacts: [], supportingFiles: [], visuals: [],
  },
}));

const ALPHA_9_VERSION = '0.1.0-alpha.9';
const ALPHA_9_TAG = `v${ALPHA_9_VERSION}`;
const alpha9ReleaseFiles = {
  ...releaseFiles(ALPHA_9_TAG, {
    receiptSchema: true,
    placesSchema: true,
    structuresSchema: true,
    worldGallery: true,
    externalHostBridge: true,
    completeFarm: true,
  }),
  // Preserve the exact Alpha.7 compatibility packs while adding Pack 0.6 as
  // a separately named, independently hashed release attachment.
  examplePack: alpha7ReleaseFiles.examplePack,
  dustwindPack: alpha7ReleaseFiles.dustwindPack,
  frostwatchPack: alpha7ReleaseFiles.frostwatchPack,
};

const alpha9 = deepFreeze(validateReleaseConfig({
  ...alpha8,
  version: ALPHA_9_VERSION,
  tag: ALPHA_9_TAG,
  // This field binds only the three legacy primary-pack receipt checks. The
  // separately registered completeFarmPack identifies Alpha.9 throughout.
  packVersion: ALPHA_7_VERSION,
  lifecycle: 'published',
  publicExamplePackSha256: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
  publicReleaseAssetSha256: {
    [alpha9ReleaseFiles.changelog]: '82b62cefbd164524d54bf7ee67e61430119fdfa1d1936be60efd0fcfd4d56a1c',
    [alpha9ReleaseFiles.license]: '0fb6db3e8b9916a72339ad81b200c8b9419d5524ed333d42eaac86c41b6a1581',
    [alpha9ReleaseFiles.exampleWorldSpec]: 'e33a3e67f2febd803b7920a0fc9e58ebead35e5b8b830fabe3816e0e960b4655',
    [alpha9ReleaseFiles.dustwindWorldSpec]: 'd229ed303e2c003a2f9ba75760e1dab5ab0e8dcd1d385f0c0e17bf69c6140e07',
    [alpha9ReleaseFiles.frostwatchWorldSpec]: '0ca57d56c646898a091f9a7b59c2542c645d66138e435d527ed0e089148a716f',
    [alpha9ReleaseFiles.examplePack]: '6113b30fec3615b72730d8d775919aa3c5552285c614b6916a109b887ab8012c',
    [alpha9ReleaseFiles.dustwindPack]: 'd6dd38a47522f45d24184d9b6869d92b89cc2ae3ad1c2ca1eab0b9cf4b13a502',
    [alpha9ReleaseFiles.frostwatchPack]: '35a49edd901becae1422731a132803eebaf07659fc3d69efa7d39cd1e87b9e12',
    [alpha9ReleaseFiles.receiptSchema]: '7e9d88967366d43d84b4529746c362963e63b9992ea101ae92703b3797c9b9e3',
    [alpha9ReleaseFiles.godotImporter]: 'bfb736d044818b01955feb35d84b438fe6c139e77764907847a1f4d89ea7b526',
    [alpha9ReleaseFiles.packSchema]: '209a97580ceede4fc46f1fbe86144a1cb7a28b68c20396558fac38b410d26c21',
    [alpha9ReleaseFiles.placesSchema]: '880c319b72dedcc38c881fb06ee269649a9e1301a4dd09d63005b94d9aa03152',
    [alpha9ReleaseFiles.structuresSchema]: 'be1b7f4720c74f6a342a224eb9d6ed8bad99c34ca0c0fe9e1397b8eee9c6710d',
    [alpha9ReleaseFiles.worldSchema]: 'aa9e1422d25f92b7fea0b41723b35f59a2a77ad87008baa15e7e0921b3abcef6',
    [alpha9ReleaseFiles.web]: 'dc66870e7ff3c72a805597ec3a1ede808c3401b64e06d1b745d75f0bd6d9e10a',
    [alpha9ReleaseFiles.manifest]: 'fde8fa73be3e436a74161a8704e9fdd1af96ef884e62ee045963de8885b36830',
    [alpha9ReleaseFiles.checksums]: 'c99ed1cf8c225aeaf60163eca49907fc9d4062c4a7cf93d0e05049ca206d4443',
    [alpha9ReleaseFiles.externalHostRequestSchema]: 'd3b7d6bb76c0f0b5b91f9a9b31eaa494b14b1ba6fa96567038bf388a6a09a7ba',
    [alpha9ReleaseFiles.externalHostExportReceiptSchema]: '6d5d7bf6d022bea07527e9a0a12f5dae645bb75c51748b860c6f64b35e1811fd',
    [alpha9ReleaseFiles.externalHostExampleRequest]: 'b17e92d74bd707031d60e851668ecf6279528eb2b6595b65c59b8bfcfb702682',
    [alpha9ReleaseFiles.completeFarmPack]: '10d89c7888b70215a14af2b6552fc5237d799df9cd3092aee99541961d9e480c',
    [alpha9ReleaseFiles.completeFarmPackSchema]: '296d03c140d1f3759f66a023ecc555ea83d9e488e187723fc419bdaff1b0605d',
    [alpha9ReleaseFiles.generationRequestSchema]: '75576e35742cdbfad022d1fbd7abad34e93fc5e4ef45b2ae191bb4664c6f2615',
    [alpha9ReleaseFiles.worldAssetReceiptSchema]: 'bb366168f8318f30882e57ffb4d86bffe37367d154ab0ab220b68ea01271aa93',
  },
  release: {
    ...alpha8.release,
    files: alpha9ReleaseFiles,
    notes: `docs/releases/${ALPHA_9_TAG}.md`,
    directoryArchives: [{
      id: 'alpha9-godot-smoke-pack',
      releaseFileKey: 'completeFarmPack',
      sourceDirectory: 'examples/packs/alpha9-godot-smoke-v0.1.0-alpha.9',
      archiveRoot: 'mapsoo-alpha9-godot-smoke-pack-v0.1.0-alpha.9',
      expectedSha256: '10d89c7888b70215a14af2b6552fc5237d799df9cd3092aee99541961d9e480c',
      purpose: 'Executable-free complete top-down farm Pack 0.6 fixture, generated by the public Alpha.9 pipeline',
    }],
    extraFiles: [
      ...alpha8.release.extraFiles,
      { releaseFileKey: 'completeFarmPackSchema', source: 'schemas/mapsoo-pack-0.6.schema.json' },
      { releaseFileKey: 'generationRequestSchema', source: 'schemas/mapsoo-generation-request-1.0.schema.json' },
      { releaseFileKey: 'worldAssetReceiptSchema', source: 'schemas/mapsoo-world-asset-receipt-0.1.schema.json' },
    ],
    schemas: alpha8.release.schemas,
  },
  itch: {
    ...alpha8.itch,
    sourceDirectory: `docs/itch-kit/${ALPHA_9_TAG}`,
    visualDirectory: `docs/media/${ALPHA_9_TAG}/itch`,
    renderer: `docs/release-visuals/renderer-${ALPHA_9_TAG}.html`,
  },
}));

const releaseConfigs = Object.freeze({
  [alpha1.version]: alpha1,
  [alpha2.version]: alpha2,
  [alpha3.version]: alpha3,
  [alpha4.version]: alpha4,
  [alpha5.version]: alpha5,
  [alpha6.version]: alpha6,
  [alpha7.version]: alpha7,
  [alpha8.version]: alpha8,
  [alpha9.version]: alpha9,
});

export function getReleaseConfig(version) {
  if (typeof version !== 'string' || !Object.hasOwn(releaseConfigs, version)) {
    throw new Error(`Unsupported release version: ${String(version)}`);
  }
  return releaseConfigs[version];
}

export function assertRegisteredReleaseConfig(config) {
  const registered = getReleaseConfig(config?.version);
  if (registered !== config) {
    throw new Error(`Release config is not the registered immutable config for ${config?.version}`);
  }
  return registered;
}

export function assertReleaseBuildAllowed(config) {
  const registered = assertRegisteredReleaseConfig(config);
  if (registered.lifecycle === 'published') {
    throw new Error(
      `Refusing to rebuild published release ${registered.tag}; create a new candidate version instead`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(registered.expectedExamplePackSha256 ?? '')) {
    throw new Error(
      `Refusing to build candidate ${registered.tag}; capture and pin its canonical example-pack hash first`,
    );
  }
  for (const pack of registered.release.additionalExamplePacks ?? []) {
    if (!/^[a-f0-9]{64}$/.test(pack.expectedSha256 ?? '') || /^0+$/.test(pack.expectedSha256)) {
      throw new Error(
        `Refusing to build candidate ${registered.tag}; capture and pin ${pack.id} canonical pack hash first`,
      );
    }
  }
  if (/^0+$/.test(registered.expectedExamplePackSha256)) {
    throw new Error(
      `Refusing to build candidate ${registered.tag}; capture and pin its canonical example-pack hash first`,
    );
  }
  return registered;
}

export function listReleaseConfigs() {
  return Object.values(releaseConfigs);
}

export function listPublishedReleaseConfigs() {
  return listReleaseConfigs().filter(({ lifecycle }) => lifecycle === 'published');
}

export const CURRENT_RELEASE_CONFIG = getReleaseConfig(PACKAGE_VERSION);
