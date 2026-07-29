#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import JSZip from 'jszip';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    process.platform === 'win32' && process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    process.platform === 'win32' && process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
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
  throw new Error('Timed out waiting for the reference-world browser harness.');
}

function decodeHtml(text) {
  return text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function decodeDom(dom) {
  const state = dom.match(/<html\b[^>]*\bdata-state="([^"]+)"/i)?.[1];
  const error = decodeHtml(dom.match(/<pre\s+id="error"[^>]*>([\s\S]*?)<\/pre>/i)?.[1]?.trim() ?? '');
  assert(state === 'ready', `Reference-world browser harness failed (state=${String(state)}${error ? `, error=${error}` : ''}).`);
  const result = dom.match(/<pre\s+id="result"([^>]*)>([\s\S]*?)<\/pre>/i);
  assert(result, 'Reference-world browser harness returned no result.');
  assert(Number(result[1].match(/\bdata-count="([^"]+)"/i)?.[1]) === 4, 'Browser harness must export four implemented profiles.');
  return JSON.parse(decodeHtml(result[2]));
}

async function verifyPack(exported, expected) {
  assert(exported.profile === expected.profile, `${expected.profile} browser profile mismatch.`);
  assert(exported.packSchemaVersion === expected.schema, `${expected.profile} Pack schema mismatch.`);
  assert(exported.requiredRoleCount === expected.roles, `${expected.profile} role count mismatch.`);
  assert(exported.characterClipCount === expected.clips, `${expected.profile} clip count mismatch.`);
  assert(/^[a-f0-9]{64}$/.test(exported.confirmationBindingSha256), `${expected.profile} has no confirmed dialogue binding.`);
  assert(exported.confirmationEmbeddedInPack === expected.embedded, `${expected.profile} dialogue embedding status mismatch.`);
  assert(/^[a-f0-9]{64}$/.test(exported.assetRevisionSha256), `${expected.profile} has no asset revision.`);
  assert(/^[a-f0-9]{64}$/.test(exported.assetPackSha256), `${expected.profile} has no asset pack digest.`);
  assert(exported.assetDialogueBindingSha256 === exported.confirmationBindingSha256, `${expected.profile} asset revision lost its dialogue binding.`);
  assert(exported.launchAssetRevisionSha256 === exported.assetRevisionSha256, `${expected.profile} launch is not bound to the approved asset revision.`);
  assert(/^[a-f0-9]{64}$/.test(exported.launchBindingSha256), `${expected.profile} has no frozen launch binding.`);
  assert(/^[a-f0-9]{64}$/.test(exported.characterIdentitySignatureSha256), `${expected.profile} has no decoded character identity.`);
  assert(
    exported.launchScenePath === `res://mapsoo_imports/browser-${expected.profile}/browser-${expected.profile}.world.tscn`,
    `${expected.profile} launch scene path mismatch.`,
  );
  const bytes = Buffer.from(exported.bytes, 'base64');
  assert(bytes.length > 1000 && bytes[0] === 0x50 && bytes[1] === 0x4b, `${expected.profile} did not return ZIP bytes.`);
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const manifestName = names.find((name) => name.endsWith('/mapsoo.manifest.json'));
  assert(manifestName, `${expected.profile} pack has no manifest.`);
  const manifestText = await zip.file(manifestName).async('string');
  const manifest = JSON.parse(manifestText);
  assert(manifest.schema_version === expected.schema, `${expected.profile} manifest schema mismatch.`);
  assert(names.length === manifest.files.length + 1, `${expected.profile} archive inventory differs from its manifest.`);
  const exposed = await Promise.all(names.filter((name) => /\.(?:json|md|txt)$/i.test(name)).map((name) => zip.file(name).async('string')));
  assert(!exposed.join('\n').includes('references/'), `${expected.profile} leaked reference paths.`);
  const receiptName = names.find((name) => name.endsWith('/generation-receipt.json'));
  assert(receiptName, `${expected.profile} pack has no generation receipt.`);
  const receipt = JSON.parse(await zip.file(receiptName).async('string'));
  if (expected.embedded) {
    assert(
      receipt.request?.dialogue_binding?.binding_sha256 === exported.confirmationBindingSha256,
      `${expected.profile} receipt does not bind the confirmed dialogue.`,
    );
    assert(receipt.request.dialogue_binding.checkpoints.length === 4, `${expected.profile} receipt requires four dialogue checkpoints.`);
  } else {
    assert(receipt.request?.dialogue_binding === undefined, `${expected.profile} changed its frozen receipt schema.`);
  }
  return `${expected.profile}:bytes=${bytes.length}:files=${names.length}`;
}

async function verify() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/tests/browser/reference-world-export.html`;
  const profile = await mkdtemp(join(tmpdir(), 'mapsoo-reference-world-browser-'));
  const vite = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let viteErrors = '';
  vite.stderr.on('data', (chunk) => { viteErrors += String(chunk); });
  try {
    await waitForServer(url, vite);
    let browserDom = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { stdout } = await execFileAsync(chromeExecutable(), [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking',
        '--disable-component-update', '--no-first-run', `--user-data-dir=${profile}`, '--virtual-time-budget=120000', '--dump-dom', url,
      ], { maxBuffer: 64 * 1024 * 1024, timeout: 90_000, windowsHide: true });
      browserDom = stdout;
      // A cold CI runner can dump the initial page before Vite's async module
      // graph settles. Retry only that pre-result state; all failures stay fatal.
      if (!/<html\b[^>]*\bdata-state="loading"/i.test(browserDom)) break;
    }
    const exports = decodeDom(browserDom);
    assert(Array.isArray(exports) && exports.length === 4, 'Browser result must contain four profile exports.');
    assert(
      exports.every((entry) => entry.characterIdentitySignatureSha256 === exports[0].characterIdentitySignatureSha256),
      'The same character reference produced different cross-profile identity signatures.',
    );
    const summaries = await Promise.all([
      verifyPack(exports[0], { profile: 'topdown-farm', schema: '0.6.0', roles: 21, clips: 8, embedded: false }),
      verifyPack(exports[1], { profile: 'side-platformer', schema: '0.7.0', roles: 30, clips: 12, embedded: true }),
      verifyPack(exports[2], { profile: 'isometric-action', schema: '0.8.0', roles: 36, clips: 128, embedded: true }),
      verifyPack(exports[3], { profile: 'layered-depth-2d', schema: '0.9.0', roles: 36, clips: 24, embedded: true }),
    ]);
    console.log(`MAPSOO_BROWSER_REFERENCE_WORLD_OK ${summaries.join(' ')}`);
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
