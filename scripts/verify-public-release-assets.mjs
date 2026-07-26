#!/usr/bin/env node

import { listPublishedReleaseConfigs } from './release-lib.mjs';

const REPOSITORY = 'babyrush0101-source/mapsoo-kids';

function requestHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'mapsoo-release-history-verifier',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verify() {
  const configs = listPublishedReleaseConfigs();
  assert(configs.length > 0, 'No published release config is registered.');
  let assetCount = 0;

  for (const config of configs) {
    const response = await fetch(
      `https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(config.tag)}`,
      {
        headers: requestHeaders(),
      },
    );
    assert(response.ok, `${config.tag} GitHub release lookup failed: HTTP ${response.status}`);
    const release = await response.json();
    assert(release.tag_name === config.tag, `${config.tag} GitHub tag changed`);
    assert(release.draft === false, `${config.tag} public release unexpectedly became a draft`);
    assert(release.prerelease === true, `${config.tag} must remain a prerelease`);

    const assets = new Map();
    for (const asset of release.assets ?? []) {
      assert(typeof asset.name === 'string' && !assets.has(asset.name), `${config.tag} has duplicate release asset names`);
      assert(asset.state === 'uploaded', `${config.tag} has an attachment that is not uploaded`);
      assert(Number.isSafeInteger(asset.size) && asset.size > 0, `${config.tag} has an empty attachment`);
      assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? ''), `${config.tag} has an invalid attachment digest`);
      assets.set(asset.name, asset);
    }
    const expectedNames = Object.keys(config.publicReleaseAssetSha256).sort();
    if (config.publicAssetNamePolicy === 'exact') {
      assert(
        JSON.stringify([...assets.keys()].sort()) === JSON.stringify(expectedNames),
        `${config.tag} GitHub release asset list differs from the immutable registry`,
      );
      for (const name of expectedNames) {
        const expectedDigest = `sha256:${config.publicReleaseAssetSha256[name]}`;
        assert(assets.get(name).digest === expectedDigest, `${config.tag} GitHub digest changed: ${name}`);
      }
    } else {
      const actualDigests = [...assets.values()].map(({ digest }) => digest).sort();
      const expectedDigests = Object.values(config.publicReleaseAssetSha256)
        .map((digest) => `sha256:${digest}`)
        .sort();
      assert(
        JSON.stringify(actualDigests) === JSON.stringify(expectedDigests),
        `${config.tag} privacy-redacted attachment digest set differs from the immutable registry`,
      );
    }
    assetCount += assets.size;
  }

  console.log(`MAPSOO_PUBLIC_RELEASE_ASSETS_OK releases=${configs.length} assets=${assetCount}`);
}

try {
  await verify();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
