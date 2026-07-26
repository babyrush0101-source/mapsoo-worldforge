#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  REPOSITORY_ROOT,
  assertSafeOutputPath,
  buildExamplePackArchive,
  sha256,
} from './release-lib.mjs';
import { getReleaseConfig } from './release-config.mjs';

const ALPHA2_RELEASE_CONFIG = getReleaseConfig('0.1.0-alpha.2');

const execFileAsync = promisify(execFile);
const captureArgument = process.argv.find((argument) => argument.startsWith('--capture='));
const captureRoot = resolve(REPOSITORY_ROOT, 'release', 'browser-captures');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    process.platform === 'win32' && process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.platform === 'win32' && process.env['PROGRAMFILES(X86)']
      ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert(executable, 'Chrome or Chromium is required for the real browser-export gate. Set CHROME_BIN if it is installed elsewhere.');
  return executable;
}

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitForServer(url, processHandle) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    assert(processHandle.exitCode === null, `Vite exited before the browser harness was ready (${processHandle.exitCode}).`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Vite returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for browser harness: ${lastError instanceof Error ? lastError.message : lastError}`);
}

function decodeHarnessDom(dom) {
  const state = dom.match(/<html\b[^>]*\bdata-state="([^"]+)"/i)?.[1];
  const error = dom.match(/<pre\s+id="error"[^>]*>([\s\S]*?)<\/pre>/i)?.[1]?.trim();
  assert(state === 'ready', `Browser export harness did not become ready (state=${String(state)}${error ? `, error=${error}` : ''}).`);
  const resultTag = dom.match(/<pre\s+id="result"([^>]*)>([A-Za-z0-9+/=]+)<\/pre>/i);
  assert(resultTag, 'Browser export harness did not return ZIP bytes.');
  const filename = resultTag[1].match(/\bdata-filename="([^"]+)"/i)?.[1];
  const version = resultTag[1].match(/\bdata-version="([^"]+)"/i)?.[1];
  const externalHostRequestSha256 = resultTag[1].match(/\bdata-external-host-request-sha256="([^"]+)"/i)?.[1];
  const externalHostWorldId = resultTag[1].match(/\bdata-external-host-world-id="([^"]+)"/i)?.[1];
  return { filename, version, externalHostRequestSha256, externalHostWorldId, bytes: Buffer.from(resultTag[2], 'base64') };
}

function capturePath() {
  if (!captureArgument) return null;
  const requested = captureArgument.slice('--capture='.length);
  assert(requested && !requested.includes('\\'), 'Capture path must be a forward-slash relative path.');
  const output = resolve(REPOSITORY_ROOT, requested);
  assert(
    dirname(output) === captureRoot && output.startsWith(`${captureRoot}${sep}`) && output.endsWith('.zip'),
    'Capture output must be a direct .zip child of release/browser-captures/.',
  );
  return output;
}

async function verify() {
  assert(ALPHA2_RELEASE_CONFIG.version === '0.1.0-alpha.2', 'Browser gate is bound to the alpha.2 release policy.');
  const port = await freePort();
  assert(Number.isSafeInteger(port), 'Unable to allocate a local browser-harness port.');
  const harnessUrl = `http://127.0.0.1:${port}/tests/browser/alpha2-export.html`;
  const viteEntry = join(REPOSITORY_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const profile = await mkdtemp(join(tmpdir(), 'mapsoo-alpha2-browser-'));
  const vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: REPOSITORY_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let viteErrors = '';
  vite.stderr.on('data', (chunk) => { viteErrors += String(chunk); });

  try {
    await waitForServer(harnessUrl, vite);
    const { stdout } = await execFileAsync(chromeExecutable(), [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-component-update',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=15000',
      '--dump-dom',
      harnessUrl,
    ], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000, windowsHide: true });
    const exported = decodeHarnessDom(stdout);
    assert(exported.filename === ALPHA2_RELEASE_CONFIG.release.files.examplePack, 'Browser export filename differs from the alpha.2 registry.');
    assert(exported.version === ALPHA2_RELEASE_CONFIG.version, 'Browser export version differs from the alpha.2 registry.');
    assert(
      exported.externalHostRequestSha256 === '3ecb182ee9cb2c8c61f2b9857ee6f3e42db01df5266a8a31595796799019aa51',
      'Real browser External Host request hash differs from the registered integration fixture.',
    );
    assert(
      exported.externalHostWorldId === 'river-valley-observation',
      'Real browser External Host request projected to the wrong World Spec.',
    );
    const hash = sha256(exported.bytes);

    const output = capturePath();
    if (output) {
      await assertSafeOutputPath(captureRoot, output, 'Browser capture output must stay inside a link-free release/browser-captures/ directory');
      await writeFile(output, exported.bytes);
      console.log(
        `MAPSOO_BROWSER_ALPHA2_CAPTURED ${relative(REPOSITORY_ROOT, output)} bytes=${exported.bytes.length} sha256=${hash}`
        + ` external_host_request_sha256=${exported.externalHostRequestSha256} external_host_world=${exported.externalHostWorldId}`,
      );
      return;
    }

    const canonical = await buildExamplePackArchive(ALPHA2_RELEASE_CONFIG.version);
    assert(exported.bytes.equals(canonical), 'Real browser export bytes differ from the registered canonical alpha.2 pack.');
    assert(hash === ALPHA2_RELEASE_CONFIG.expectedExamplePackSha256, 'Real browser export hash differs from the registered alpha.2 hash.');
    console.log(
      `MAPSOO_BROWSER_ALPHA2_OK bytes=${exported.bytes.length} sha256=${hash}`
      + ` external_host_request_sha256=${exported.externalHostRequestSha256} external_host_world=${exported.externalHostWorldId}`,
    );
  } finally {
    vite.kill();
    await rm(profile, { recursive: true, force: true });
    if (vite.exitCode !== null && vite.exitCode !== 0 && viteErrors.trim()) process.stderr.write(viteErrors);
  }
}

try {
  await verify();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
