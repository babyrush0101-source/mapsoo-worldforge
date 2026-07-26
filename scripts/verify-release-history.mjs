#!/usr/bin/env node

import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

import JSZip from 'jszip';

import { verifyReceiptForRelease } from './receipt-verifier.mjs';
import {
  REPOSITORY_ROOT,
  assertPortableRelativePath,
  assertReleaseBuildAllowed,
  assertReceiptVerifierBinding,
  assertRegisteredReleaseConfig,
  buildRelease,
  buildExamplePackArchive,
  comparePortablePaths,
  getReleaseConfig,
  listReleaseConfigs,
  listFiles,
  listPublishedReleaseConfigs,
  sha256,
} from './release-lib.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepFrozen(value, context) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value), `${context} must be immutable`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${context}.${key}`);
  }
}

async function assertRegularFile(path, context) {
  const fileStat = await lstat(path);
  assert(fileStat.isFile() && !fileStat.isSymbolicLink(), `${context} must be a regular file`);
}

async function verifyPublishedRelease(config) {
  assert(config.tag === `v${config.version}`, `${config.version} release tag is inconsistent`);
  assert(/^[a-f0-9]{64}$/.test(config.publicExamplePackSha256), `${config.tag} public hash is invalid`);
  assert(
    /^[a-f0-9]{64}$/.test(config.currentSourceExamplePackSha256),
    `${config.tag} current-source hash is invalid`,
  );
  assertDeepFrozen(config, `${config.tag} config`);

  const releaseNotesPath = join(REPOSITORY_ROOT, config.release.notes);
  await assertRegularFile(releaseNotesPath, `${config.tag} release notes`);
  const releaseNotes = await readFile(releaseNotesPath, 'utf8');
  assert(releaseNotes.includes(config.tag), `${config.tag} release notes do not name their tag`);

  if ((config.itch.sourceKitStatus ?? 'required') === 'required') {
    const sourceRoot = join(REPOSITORY_ROOT, config.itch.sourceDirectory);
    const sourceNames = (await listFiles(sourceRoot)).map(({ archivePath }) => archivePath);
    assert(
      JSON.stringify(sourceNames) === JSON.stringify(['metadata.json', 'page.md']),
      `${config.tag} itch source file list is invalid`,
    );
    const metadata = JSON.parse(await readFile(join(sourceRoot, 'metadata.json'), 'utf8'));
    assert(metadata.version === config.version, `${config.tag} itch metadata version is invalid`);
    const page = await readFile(join(sourceRoot, 'page.md'), 'utf8');
    assert(
      page.includes(config.release.files.examplePack),
      `${config.tag} itch page does not name its configured asset pack`,
    );
  } else {
    assert(
      config.itch.rendererFrames.length === 0
        && config.itch.requiredRendererFacts.length === 0
        && config.itch.supportingFiles.length === 0
        && config.itch.visuals.length === 0,
      `${config.tag} postponed itch source kit must not claim prepared visuals`,
    );
  }

  const visualRoot = join(REPOSITORY_ROOT, config.itch.visualDirectory);
  const expectedVisualNames = [
    ...config.itch.visuals.map(({ name }) => name),
    ...config.itch.supportingFiles,
  ]
    .sort(comparePortablePaths);
  const visualNames = expectedVisualNames.length === 0
    ? []
    : (await listFiles(visualRoot))
        .map(({ archivePath }) => archivePath)
        .sort(comparePortablePaths);
  assert(
    JSON.stringify(visualNames) === JSON.stringify(expectedVisualNames),
    `${config.tag} itch visual file list is invalid`,
  );

  const packBytes = await buildExamplePackArchive(config.version);
  const packHash = sha256(packBytes);
  assert(
    packHash === config.currentSourceExamplePackSha256,
    `${config.tag} current-source example pack is not deterministic`,
  );

  const zip = await JSZip.loadAsync(packBytes, { checkCRC32: true, createFolders: false });
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const prefix = `${config.release.examplePack.archiveRoot}/`;
  const entryBytes = new Map();
  for (const entry of entries) {
    assertPortableRelativePath(entry.name);
    assert(entry.name.startsWith(prefix), `${config.tag} pack entry is outside its configured root`);
    entryBytes.set(entry.name.slice(prefix.length), await entry.async('nodebuffer'));
  }
  const manifestBytes = entryBytes.get('mapsoo.manifest.json');
  assert(manifestBytes, `${config.tag} pack is missing mapsoo.manifest.json`);
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  assert(manifest.pack?.id === config.release.examplePack.id, `${config.tag} pack ID is invalid`);
  assert(manifest.pack?.version === config.packVersion, `${config.tag} pack version is invalid`);

  await verifyReceiptForRelease({
    version: config.version,
    manifest,
    context: `${config.tag} historical pack`,
    readPackFile: async (path) => entryBytes.get(path),
  });

  return {
    tag: config.tag,
    currentSourcePackHash: packHash,
    publicPackHash: config.publicExamplePackSha256,
    entries: entries.length,
  };
}

async function expectFailure(action, expectedPattern, context) {
  try {
    await action();
  } catch (error) {
    assert(
      expectedPattern.test(error instanceof Error ? error.message : String(error)),
      `${context} failed for the wrong reason`,
    );
    return;
  }
  throw new Error(`${context} was accepted unexpectedly`);
}

async function assertReceiptDispatchFailsClosed() {
  const configs = listReleaseConfigs();
  assert(configs.length >= 4, 'release registry must contain alpha.1 through alpha.4');
  const config = configs.find(({ version }) => version === '0.1.0-alpha.1');
  assert(config, 'release registry is missing alpha.1');
  for (const registered of configs) assertDeepFrozen(registered, `${registered.tag} config`);
  const alpha4 = getReleaseConfig('0.1.0-alpha.4');
  assert(alpha4.lifecycle === 'published', 'alpha.4 must be registered as published after publication');
  assert(
    alpha4.expectedExamplePackSha256 === 'a57e810baaf2f015d7db96bf0e88ab7b6340d476a61ade7447735a6109b8fb35'
      && alpha4.publicExamplePackSha256 === alpha4.expectedExamplePackSha256,
    'alpha.4 expected and public example-pack hashes must remain pinned',
  );
  assert(
    alpha4.release.schemas.find(({ releaseFileKey }) => releaseFileKey === 'packSchema')?.source
      === 'schemas/mapsoo-pack-0.2.schema.json',
    'alpha.4 must bind the release pack schema to mapsoo-pack-0.2.schema.json',
  );
  let reads = 0;
  const readPackFile = async () => {
    reads += 1;
    return undefined;
  };
  const cases = [
    {
      context: 'unknown release version',
      expected: /Unsupported release version/,
      action: () => verifyReceiptForRelease({
        version: '9999.0.0-unknown',
        manifest: {},
        readPackFile,
      }),
    },
    ...configs.flatMap((registered) => [
      {
        context: `${registered.tag} forged pack ID`,
        expected: /pack ID must match trusted release config/,
        action: () => verifyReceiptForRelease({
          version: registered.version,
          manifest: { pack: { id: 'forged-pack', version: registered.version } },
          readPackFile,
        }),
      },
      {
        context: `${registered.tag} forged pack version`,
        expected: /pack version must match trusted release config/,
        action: () => verifyReceiptForRelease({
          version: registered.version,
          manifest: { pack: { id: registered.release.examplePack.id, version: '9999.0.0' } },
          readPackFile,
        }),
      },
    ]),
  ];
  for (const testCase of cases) {
    await expectFailure(testCase.action, testCase.expected, testCase.context);
    assert(reads === 0, `${testCase.context} read pack bytes before rejecting the envelope`);
  }

  await expectFailure(
    () => assertRegisteredReleaseConfig({ ...config }),
    /not the registered immutable config/,
    'synthetic release config',
  );
  await expectFailure(
    () => assertReleaseBuildAllowed(config),
    /Refusing to rebuild published release/,
    'published release build',
  );
  const buildSentinel = join(REPOSITORY_ROOT, 'release', '.published-build-guard-sentinel');
  let sentinelExists = true;
  try {
    await lstat(buildSentinel);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    sentinelExists = false;
  }
  assert(!sentinelExists, 'published build guard sentinel already exists');
  await expectFailure(
    () => buildRelease(buildSentinel, config.version),
    /Refusing to rebuild published release/,
    'direct published release build',
  );
  try {
    await lstat(buildSentinel);
    throw new Error('published build guard wrote its output sentinel before rejecting');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await expectFailure(
    () => assertReceiptVerifierBinding('unknown-policy', config.version),
    /receipt verifier is not registered/,
    'unknown receipt verifier policy',
  );
  await expectFailure(
    () => assertReceiptVerifierBinding('legacy-alpha1', '0.1.0-alpha.2'),
    /does not authorize/,
    'legacy receipt verifier on a future version',
  );
  await expectFailure(
    () => assertReceiptVerifierBinding('builtin-procedural-alpha2-v0.2', '0.1.0-alpha.1'),
    /does not authorize/,
    'alpha2 receipt verifier on alpha1',
  );
  await expectFailure(
    () => assertReceiptVerifierBinding('legacy-alpha1', '0.1.0-alpha.3'),
    /does not authorize/,
    'legacy receipt verifier on alpha3',
  );
  await expectFailure(
    () => assertReceiptVerifierBinding('builtin-procedural-alpha2-v0.2', '0.1.0-alpha.3'),
    /does not authorize/,
    'alpha2 receipt verifier on alpha3',
  );
  await expectFailure(
    () => assertReceiptVerifierBinding('builtin-procedural-alpha3-v0.2', '0.1.0-alpha.1'),
    /does not authorize/,
    'alpha3 receipt verifier on alpha1',
  );
  await expectFailure(
    () => assertReceiptVerifierBinding('builtin-procedural-alpha3-v0.2', '0.1.0-alpha.2'),
    /does not authorize/,
    'alpha3 receipt verifier on alpha2',
  );
  await expectFailure(
    () => assertReceiptVerifierBinding('builtin-playable-terrain-alpha4-v0.2', '0.1.0-alpha.3'),
    /does not authorize/,
    'alpha4 receipt verifier on alpha3',
  );
  await expectFailure(
    () => assertReceiptVerifierBinding('builtin-procedural-alpha3-v0.2', '0.1.0-alpha.4'),
    /does not authorize/,
    'alpha3 receipt verifier on alpha4',
  );
  await expectFailure(
    () => assertReleaseBuildAllowed(alpha4),
    /Refusing to rebuild published release/,
    'published alpha4 build',
  );

  for (const action of [
    () => getReleaseConfig('9999.0.0-unknown'),
  ]) {
    try {
      await action();
    } catch (error) {
      assert(
        /Unsupported release version/.test(error instanceof Error ? error.message : String(error)),
        'unknown release version failed for the wrong reason',
      );
      continue;
    }
    throw new Error('unknown release version was accepted unexpectedly');
  }
}

try {
  await assertReceiptDispatchFailsClosed();
  const configs = listPublishedReleaseConfigs();
  assert(configs.length > 0, 'release registry contains no published releases');
  const results = [];
  for (const config of configs) {
    results.push(await verifyPublishedRelease(config));
  }
  console.log(
    `MAPSOO_RELEASE_HISTORY_OK releases=${results.length} ${results
      .map(
        ({ tag, currentSourcePackHash, publicPackHash, entries }) =>
          `${tag}:current=${currentSourcePackHash}:public=${publicPackHash}:entries=${entries}`,
      )
      .join(' ')}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
