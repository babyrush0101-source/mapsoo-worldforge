#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOTICE_PATH = join(ROOT, 'public', 'THIRD_PARTY_NOTICES.txt');
const WRITE = process.argv.includes('--write');

const EXPECTED_PRODUCTION_DEPENDENCIES = [
  ['ajv', '8.17.1', 'MIT'],
  ['ajv-formats', '3.0.1', 'MIT'],
  ['core-util-is', '1.0.3', 'MIT'],
  ['fast-deep-equal', '3.1.3', 'MIT'],
  ['fast-uri', '3.1.4', 'BSD-3-Clause'],
  ['immediate', '3.0.6', 'MIT'],
  ['inherits', '2.0.4', 'ISC'],
  ['isarray', '1.0.0', 'MIT'],
  ['js-tokens', '4.0.0', 'MIT'],
  ['json-schema-traverse', '1.0.0', 'MIT'],
  ['jszip', '3.10.1', '(MIT OR GPL-3.0-or-later)'],
  ['lie', '3.3.0', 'MIT'],
  ['loose-envify', '1.4.0', 'MIT'],
  ['pako', '1.0.11', '(MIT AND Zlib)'],
  ['process-nextick-args', '2.0.1', 'MIT'],
  ['react', '18.3.1', 'MIT'],
  ['react-dom', '18.3.1', 'MIT'],
  ['readable-stream', '2.3.8', 'MIT'],
  ['require-from-string', '2.0.2', 'MIT'],
  ['safe-buffer', '5.1.2', 'MIT'],
  ['scheduler', '0.23.2', 'MIT'],
  ['setimmediate', '1.0.5', 'MIT'],
  ['string_decoder', '1.1.1', 'MIT'],
  ['util-deprecate', '1.0.2', 'MIT'],
].map(([name, version, license]) => ({ name, version, license }));

const LICENSE_FILENAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.markdown',
  'LICENSE.txt',
  'COPYING',
  'COPYING.md',
  'COPYING.txt',
];

const SUPPLEMENTAL_LICENSE_FILES = new Map([
  ['pako@1.0.11', ['lib/zlib/README']],
]);

function normalizeText(value) {
  return value.replace(/\r\n?/g, '\n').trim();
}

function comparePackageNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

function fail(message) {
  throw new Error(`THIRD_PARTY_NOTICES_INVALID: ${message}`);
}

function loadPnpmLicenseReport() {
  const pnpmEntrypoint = process.env.npm_execpath;
  if (!pnpmEntrypoint) {
    fail('npm_execpath is unavailable; run this verifier through pnpm.');
  }

  const output = execFileSync(
    process.execPath,
    [pnpmEntrypoint, 'licenses', 'list', '--prod', '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  return JSON.parse(output);
}

function flattenLicenseReport(report) {
  const dependencies = [];
  for (const packages of Object.values(report)) {
    for (const packageRecord of packages) {
      if (packageRecord.versions.length !== 1 || packageRecord.paths.length < 1) {
        fail(`expected one installed version and path for ${packageRecord.name}.`);
      }
      dependencies.push({
        name: packageRecord.name,
        version: packageRecord.versions[0],
        license: packageRecord.license,
        homepage: packageRecord.homepage ?? null,
        packageRoot: packageRecord.paths[0],
      });
    }
  }
  return dependencies.sort(comparePackageNames);
}

function assertExpectedDependencies(actual) {
  const expected = [...EXPECTED_PRODUCTION_DEPENDENCIES]
    .sort(comparePackageNames);
  if (JSON.stringify(actual.map(({ name, version, license }) => ({ name, version, license }))) !== JSON.stringify(expected)) {
    fail('the production dependency/license set changed; review it and update the allowlist deliberately.');
  }
}

function readPrimaryLicense(packageRecord) {
  const rootEntries = readdirSync(packageRecord.packageRoot);
  for (const preferredName of LICENSE_FILENAMES) {
    const actualName = rootEntries.find((entry) => entry.toLowerCase() === preferredName.toLowerCase());
    if (actualName) {
      return {
        source: actualName,
        text: normalizeText(readFileSync(join(packageRecord.packageRoot, actualName), 'utf8')),
      };
    }
  }

  if (packageRecord.name === 'isarray' && packageRecord.version === '1.0.0') {
    const readmePath = join(packageRecord.packageRoot, 'README.md');
    const readme = normalizeText(readFileSync(readmePath, 'utf8'));
    const marker = '## License';
    const licenseIndex = readme.indexOf(marker);
    if (licenseIndex === -1) fail('isarray README no longer contains its license section.');
    return {
      source: 'README.md#License',
      text: normalizeText(readme.slice(licenseIndex + marker.length)),
    };
  }

  fail(`no supported license file was found for ${packageRecord.name}@${packageRecord.version}.`);
}

function readLicenses(packageRecord) {
  const licenses = [readPrimaryLicense(packageRecord)];
  const packageKey = `${packageRecord.name}@${packageRecord.version}`;
  for (const relativePath of SUPPLEMENTAL_LICENSE_FILES.get(packageKey) ?? []) {
    const licensePath = join(packageRecord.packageRoot, ...relativePath.split('/'));
    if (!existsSync(licensePath)) fail(`${packageKey} is missing required supplemental license ${relativePath}.`);
    licenses.push({
      source: relativePath,
      text: normalizeText(readFileSync(licensePath, 'utf8')),
    });
  }
  return licenses;
}

function buildNotice(dependencies) {
  const sections = [
    'Mapsoo WorldForge third-party notices',
    '',
    'This file contains the license notices for every production dependency',
    'reported by the locked pnpm installation. Regenerate with:',
    '',
    '  pnpm third-party:write',
  ];

  for (const dependency of dependencies) {
    const licenses = readLicenses(dependency);
    sections.push(
      '',
      '================================================================',
      `${dependency.name} ${dependency.version}`,
      `Declared license: ${dependency.license}`,
      ...(dependency.homepage ? [`Project: ${dependency.homepage}`] : []),
    );
    for (const [index, license] of licenses.entries()) {
      sections.push(
        `${index === 0 ? 'Source' : 'Supplemental'} license text: ${license.source}`,
        '----------------------------------------------------------------',
        license.text,
      );
    }
  }

  return `${sections.join('\n')}\n`;
}

try {
  const dependencies = flattenLicenseReport(loadPnpmLicenseReport());
  assertExpectedDependencies(dependencies);
  const expectedNotice = buildNotice(dependencies);

  if (WRITE) {
    writeFileSync(NOTICE_PATH, expectedNotice, 'utf8');
    console.log(`THIRD_PARTY_NOTICES_WRITTEN packages=${dependencies.length}`);
  } else {
    if (!existsSync(NOTICE_PATH)) fail('public/THIRD_PARTY_NOTICES.txt is missing.');
    const actualNotice = normalizeText(readFileSync(NOTICE_PATH, 'utf8'));
    if (actualNotice !== normalizeText(expectedNotice)) {
      fail('public/THIRD_PARTY_NOTICES.txt is stale; run pnpm third-party:write and review the result.');
    }
    console.log(`THIRD_PARTY_NOTICES_OK packages=${dependencies.length}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
