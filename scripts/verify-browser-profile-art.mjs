#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const capture = join(root, 'docs', 'visual-qa', 'four-profile-baseline.png');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    process.platform === 'win32' && process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert(executable, 'Chrome or Chromium is required. Set CHROME_BIN if necessary.');
  return executable;
}

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer(url, processHandle) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    assert(processHandle.exitCode === null, `Vite exited early (${processHandle.exitCode}).`);
    try { if ((await fetch(url)).ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the profile-art browser harness.');
}

function decodeHtml(text) {
  return text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function verifyDom(dom) {
  const state = dom.match(/<html\b[^>]*\bdata-state="([^"]+)"/i)?.[1];
  const error = decodeHtml(dom.match(/<pre\s+id="error"[^>]*>([\s\S]*?)<\/pre>/i)?.[1]?.trim() ?? '');
  assert(state === 'ready', `Profile art harness failed (state=${String(state)}${error ? `, error=${error}` : ''}).`);
  const result = dom.match(/<pre\s+id="result"([^>]*)>([\s\S]*?)<\/pre>/i);
  assert(result, 'Profile art harness returned no result.');
  assert(Number(result[1].match(/\bdata-count="([^"]+)"/i)?.[1]) === 4, 'Profile art harness must render four profiles.');
  const rows = JSON.parse(decodeHtml(result[2]));
  assert(rows.filter((row) => row.status === 'implemented').length === 4, 'Exactly four profiles should be implemented.');
  assert(rows.filter((row) => row.status === 'visual-prototype').length === 0, 'No profile should remain a visual prototype.');
  for (const row of rows) {
    assert(row.width === 320 && row.height === 180, `${row.profile} visual dimensions changed.`);
    assert(row.pngBytes > 1000, `${row.profile} visual is unexpectedly small.`);
  }
  return rows;
}

async function verify() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/tests/browser/profile-art-validation.html`;
  const profile = await mkdtemp(join(tmpdir(), 'mapsoo-profile-art-browser-'));
  const vite = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let viteErrors = '';
  vite.stderr.on('data', (chunk) => { viteErrors += String(chunk); });
  try {
    await waitForServer(url, vite);
    await mkdir(dirname(capture), { recursive: true });
    const { stdout } = await execFileAsync(chromeExecutable(), [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking',
      '--disable-component-update', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${profile}`,
      '--window-size=1100,1180', '--force-device-scale-factor=1', '--virtual-time-budget=15000',
      `--screenshot=${capture}`, '--dump-dom', url,
    ], { maxBuffer: 32 * 1024 * 1024, timeout: 45_000, windowsHide: true });
    const rows = verifyDom(stdout);
    const captureStat = await stat(capture);
    const signature = await readFile(capture);
    assert(captureStat.size > 20_000, 'Profile art screenshot is unexpectedly small.');
    assert(signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Profile art screenshot is not PNG.');
    console.log(`MAPSOO_PROFILE_ART_OK profiles=${rows.length} capture=${capture} bytes=${captureStat.size}`);
  } finally {
    vite.kill();
    await rm(profile, { recursive: true, force: true });
    if (vite.exitCode !== null && vite.exitCode !== 0 && viteErrors.trim()) process.stderr.write(viteErrors);
  }
}

try { await verify(); } catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
