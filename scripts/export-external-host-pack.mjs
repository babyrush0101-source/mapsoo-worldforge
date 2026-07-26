#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { createServer as createViteServer } from 'vite';
import JSZip from 'jszip';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { REPOSITORY_ROOT } from './release-config.mjs';

const execFileAsync = promisify(execFile);
const MAX_REQUEST_BYTES = 128 * 1024;
const EXPORT_SCHEMA_VERSION = 'org.mapsoo.externalhost.mapsoo-export-receipt/1.0.0';
const PACK_VERSION = '0.1.0-alpha.7';
const PACK_SCHEMA_VERSION = '0.5.0';
const exportReceiptSchema = JSON.parse(await readFile(
  join(REPOSITORY_ROOT, 'integrations', 'external-host', 'external-host-mapsoo-export-receipt.schema.json'),
  'utf8',
));
const receiptAjv = new Ajv2020({ allErrors: true, strict: true });
addFormats(receiptAjv);
const validateExportReceipt = receiptAjv.compile(exportReceiptSchema);

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  if (argv[0] === '--') argv = argv.slice(1);
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--input', '--out-dir', '--completed-at'].includes(key)) fail(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${key} requires a value.`);
    if (values.has(key)) fail(`${key} may be provided only once.`);
    values.set(key, value);
    index += 1;
  }
  for (const key of ['--input', '--out-dir', '--completed-at']) {
    if (!values.has(key)) fail(`${key} is required.`);
  }
  const completedAt = values.get('--completed-at');
  const date = new Date(completedAt);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== completedAt) {
    fail('--completed-at must be a canonical UTC ISO timestamp such as 2026-07-19T12:00:00.000Z.');
  }
  return {
    help: false,
    input: resolve(values.get('--input')),
    outDir: resolve(values.get('--out-dir')),
    completedAt,
  };
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    process.platform === 'win32' && process.env.PROGRAMFILES
      ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    process.platform === 'win32' && process.env['PROGRAMFILES(X86)']
      ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) fail('Chrome or Chromium is required. Set CHROME_BIN if necessary.');
  return executable;
}

function decodeHtml(value) {
  return value.replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

function decodeDom(dom) {
  const state = dom.match(/<html\b[^>]*\bdata-state="([^"]+)"/i)?.[1];
  const error = dom.match(/<pre\s+id="error"[^>]*>([\s\S]*?)<\/pre>/i)?.[1]?.trim();
  if (state !== 'ready') fail(`External Host browser export failed (state=${String(state)}${error ? `, error=${decodeHtml(error)}` : ''}).`);
  const result = dom.match(/<pre\s+id="result"[^>]*>([\s\S]*?)<\/pre>/i)?.[1];
  if (!result) fail('External Host browser export returned no result.');
  return JSON.parse(decodeHtml(result));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function ensureOutputDirectory(path) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail(`Output path must be a real directory: ${path}`);
}

async function outputState(path) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return { kind: 'conflict' };
    return { kind: 'file', bytes: await readFile(path) };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { kind: 'missing' };
  }
}

async function readBoundedFile(handle, maxBytes) {
  const buffer = Buffer.alloc(maxBytes + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > maxBytes) {
    fail(`External Host Asset Request must be a regular file between 1 byte and ${maxBytes} bytes.`);
  }
  return buffer.subarray(0, offset);
}

function safeRelativePath(path) {
  return typeof path === 'string'
    && path.length > 0
    && !path.includes('\\')
    && !path.startsWith('/')
    && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

async function verifyPack(packBytes, result, completedAt) {
  const archive = await JSZip.loadAsync(packBytes, { checkCRC32: true, createFolders: false });
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  const expectedRoot = result.pack.filename.slice(0, -4);
  const roots = new Set();
  const payloads = new Map();
  for (const entry of entries) {
    if (!safeRelativePath(entry.name)) fail(`Unsafe path in generated pack: ${entry.name}`);
    const [root, ...segments] = entry.name.split('/');
    roots.add(root);
    const relativePath = segments.join('/');
    if (!relativePath || payloads.has(relativePath)) fail(`Invalid or duplicate pack path: ${entry.name}`);
    payloads.set(relativePath, Buffer.from(await entry.async('uint8array')));
  }
  if (roots.size !== 1 || !roots.has(expectedRoot) || entries.length !== 18) {
    fail('Generated pack must contain one versioned root and exactly 18 files.');
  }
  const manifestBytes = payloads.get('mapsoo.manifest.json');
  if (!manifestBytes) fail('Generated pack is missing mapsoo.manifest.json.');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  if (
    manifest.schema_version !== PACK_SCHEMA_VERSION
    || manifest.pack?.id !== result.binding.packId
    || manifest.pack?.version !== PACK_VERSION
    || manifest.pack?.created_at !== completedAt
  ) {
    fail('Generated pack manifest identity or timestamp is inconsistent.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 17) fail('Generated manifest file set is invalid.');
  const recordedPaths = new Set();
  for (const record of manifest.files) {
    if (!safeRelativePath(record.path) || recordedPaths.has(record.path) || record.path === 'mapsoo.manifest.json') {
      fail(`Invalid manifest payload path: ${String(record.path)}`);
    }
    const bytes = payloads.get(record.path);
    if (!bytes || bytes.byteLength !== record.bytes || sha256(bytes) !== record.sha256) {
      fail(`Generated manifest digest mismatch: ${record.path}`);
    }
    recordedPaths.add(record.path);
  }
  if ([...payloads.keys()].some((path) => path !== 'mapsoo.manifest.json' && !recordedPaths.has(path))) {
    fail('Generated manifest does not cover every pack payload.');
  }

  const worldSpecPath = manifest.world_spec?.path;
  const worldSpecBytes = payloads.get(worldSpecPath);
  if (!worldSpecBytes || sha256(worldSpecBytes) !== manifest.world_spec?.sha256) {
    fail('Generated World Spec binding is invalid.');
  }
  const worldSpec = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(worldSpecBytes));
  const extension = worldSpec.extensions?.['org.mapsoo.externalhost.assetrequest.v1'];
  const extensionTags = extension?.requiredSceneTags;
  if (
    worldSpec.schemaVersion !== '0.3.0'
    || worldSpec.id !== result.binding.packId
    || worldSpec.places !== undefined
    || worldSpec.structures !== undefined
    || extension?.assetRequestSha256 !== result.binding.assetRequestSha256
    || extension?.externalHostWorldId !== result.binding.externalHostWorldId
    || extension?.externalHostWorldVersion !== result.binding.externalHostWorldVersion
    || extension?.sceneId !== result.binding.sceneId
    || extension?.contentRating !== result.binding.contentRating
    || !Array.isArray(extensionTags)
    || JSON.stringify(extensionTags) !== JSON.stringify(result.binding.requiredSceneTags)
  ) {
    fail('Generated pack does not preserve the External Host request binding without invented semantics.');
  }

  const generationReceiptPath = manifest.receipt?.path;
  const generationReceiptBytes = payloads.get(generationReceiptPath);
  if (!generationReceiptBytes) fail('Generated pack is missing its generation receipt.');
  const generationReceipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(generationReceiptBytes));
  if (
    generationReceipt.created_at !== completedAt
    || generationReceipt.world?.id !== result.binding.packId
    || generationReceipt.world?.input_spec?.path !== worldSpecPath
    || generationReceipt.world?.input_spec?.sha256 !== manifest.world_spec.sha256
    || generationReceipt.provider?.execution !== 'local'
    || generationReceipt.provider?.output_provenance !== 'procedural'
  ) {
    fail('Generated pack receipt does not bind the request, provider, and World Spec.');
  }
  return {
    manifestSha256: sha256(manifestBytes),
    worldSpecPath,
    worldSpecSha256: sha256(worldSpecBytes),
    generationReceiptSha256: sha256(generationReceiptBytes),
    provider: {
      id: generationReceipt.provider.id,
      version: generationReceipt.provider.version,
      execution: generationReceipt.provider.execution,
      output_provenance: generationReceipt.provider.output_provenance,
    },
  };
}

async function exportPack(options) {
  const requestHandle = await open(options.input, 'r');
  let requestBytes;
  try {
    const info = await requestHandle.stat();
    if (!info.isFile() || info.size === 0 || info.size > MAX_REQUEST_BYTES) {
      fail(`External Host Asset Request must be a regular file between 1 byte and ${MAX_REQUEST_BYTES} bytes.`);
    }
    requestBytes = await readBoundedFile(requestHandle, MAX_REQUEST_BYTES);
    if (requestBytes.byteLength !== info.size) {
      fail('External Host Asset Request changed while it was being read.');
    }
  } finally {
    await requestHandle.close();
  }
  let requestText;
  try {
    requestText = new TextDecoder('utf-8', { fatal: true }).decode(requestBytes);
  } catch {
    fail('External Host Asset Request must use valid UTF-8 encoding.');
  }

  const profile = await mkdtemp(join(tmpdir(), 'mapsoo-external-host-export-'));
  let server;
  let httpServer;
  try {
    server = await createViteServer({
      root: REPOSITORY_ROOT,
      // Concurrent CLI processes must not share Vite's dependency optimizer
      // cache. The profile is unique per export and removed on exit.
      cacheDir: join(profile, 'vite-cache'),
      appType: 'spa',
      logLevel: 'error',
      server: { middlewareMode: true },
      plugins: [{
        name: 'mapsoo-external-host-request',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url?.split('?')[0] !== '/__mapsoo_external_host_request') return next();
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store');
            response.end(requestText);
          });
        },
      }],
    });
    // Port 0 keeps allocation and listen atomic. Probing a free port and
    // reopening it races when independent exporters start concurrently.
    httpServer = createHttpServer(server.middlewares);
    await new Promise((resolveListen, rejectListen) => {
      httpServer.once('error', rejectListen);
      httpServer.listen(0, '127.0.0.1', resolveListen);
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') fail('External Host export server did not bind a local TCP port.');
    const port = address.port;
    const url = `http://127.0.0.1:${port}/tests/browser/external-host-export.html?completedAt=${encodeURIComponent(options.completedAt)}`;
    let browserDom = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { stdout } = await execFileAsync(chromeExecutable(), [
        '--headless=new', '--disable-gpu', '--disable-dev-shm-usage',
        '--disable-background-networking', '--disable-component-update', '--no-first-run',
        `--user-data-dir=${profile}`, '--virtual-time-budget=120000', '--dump-dom', url,
      ], { maxBuffer: 64 * 1024 * 1024, timeout: 90_000, windowsHide: true });
      browserDom = stdout;
      // Under concurrent cold starts Chromium can dump the initial HTML before
      // Vite's module graph has evaluated. No output has been written yet, so a
      // bounded retry is safe and keeps the transaction fail-closed.
      if (!/<html\b[^>]*\bdata-state="loading"/i.test(browserDom)) break;
    }
    const result = decodeDom(browserDom);
    if (result.schemaVersion !== EXPORT_SCHEMA_VERSION || result.completedAt !== options.completedAt) {
      fail('External Host browser export envelope is inconsistent.');
    }
    if (!result.binding || result.binding.packId !== result.pack?.filename?.match(/^mapsoo-(.+)-v0\.1\.0-alpha\.7\.zip$/)?.[1]) {
      fail('External Host browser export pack identity is inconsistent.');
    }
    if (
      typeof result.pack.bytes !== 'string'
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.pack.bytes)
    ) {
      fail('External Host browser export returned invalid base64.');
    }
    const packBytes = Buffer.from(result.pack.bytes, 'base64');
    if (packBytes.byteLength === 0 || packBytes.toString('base64') !== result.pack.bytes) {
      fail('External Host browser export returned invalid pack bytes.');
    }
    const verified = await verifyPack(packBytes, result, options.completedAt);

    await ensureOutputDirectory(options.outDir);
    const packPath = join(options.outDir, basename(result.pack.filename));
    const receiptName = `mapsoo-${result.binding.packId}-external-host-export-receipt.json`;
    const receiptPath = join(options.outDir, receiptName);
    const receipt = {
      schema_version: EXPORT_SCHEMA_VERSION,
      completed_at: options.completedAt,
      request: {
        schema_version: 'org.mapsoo.externalhost.asset-request/1.0.0',
        pack_id: result.binding.packId,
        asset_request_sha256: result.binding.assetRequestSha256,
        external_host_world_id: result.binding.externalHostWorldId,
        external_host_world_version: result.binding.externalHostWorldVersion,
        scene_id: result.binding.sceneId,
        required_scene_tags: result.binding.requiredSceneTags,
        content_rating: result.binding.contentRating,
      },
      projection: {
        world_spec_schema_version: '0.3.0',
        world_spec_path: verified.worldSpecPath,
        world_spec_sha256: verified.worldSpecSha256,
      },
      provider: verified.provider,
      pack: {
        filename: result.pack.filename,
        version: PACK_VERSION,
        schema_version: PACK_SCHEMA_VERSION,
        bytes: packBytes.byteLength,
        sha256: sha256(packBytes),
        manifest_sha256: verified.manifestSha256,
        generation_receipt_sha256: verified.generationReceiptSha256,
      },
      tool: { id: 'mapsoo-external-host-export', version: '0.1.0' },
    };
    if (!validateExportReceipt(receipt)) {
      fail(`Generated External Host export receipt does not match its schema: ${receiptAjv.errorsText(validateExportReceipt.errors)}`);
    }
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    const packState = await outputState(packPath);
    const receiptState = await outputState(receiptPath);
    if (packState.kind !== 'missing' || receiptState.kind !== 'missing') {
      if (
        packState.kind === 'file'
        && receiptState.kind === 'file'
        && packState.bytes.equals(packBytes)
        && receiptState.bytes.equals(receiptBytes)
      ) {
        console.log(JSON.stringify({
          status: 'unchanged', pack: basename(packPath), receipt: basename(receiptPath),
          bytes: packBytes.byteLength, sha256: receipt.pack.sha256,
        }));
        return;
      }
      fail(`Output conflict: ${packPath} and ${receiptPath} must both be absent or byte-identical.`);
    }
    const suffix = `${process.pid}-${randomUUID()}.tmp`;
    const tempPack = join(options.outDir, `.${basename(packPath)}.${suffix}`);
    const tempReceipt = join(options.outDir, `.${basename(receiptPath)}.${suffix}`);
    try {
      await writeFile(tempPack, packBytes, { flag: 'wx' });
      await writeFile(tempReceipt, receiptBytes, { flag: 'wx' });
      // A hard link publishes the already-written bytes without the overwrite
      // semantics of rename(2). The output directory and temp files share a
      // filesystem, so EEXIST is a fail-closed race instead of data loss.
      await link(tempPack, packPath);
      try {
        await link(tempReceipt, receiptPath);
      } catch (error) {
        await rm(packPath, { force: true });
        throw error;
      }
    } catch (error) {
      if (error?.code === 'EEXIST') {
        fail(`Output conflict: ${packPath} and ${receiptPath} changed during exclusive publication.`);
      }
      throw error;
    } finally {
      await rm(tempPack, { force: true });
      await rm(tempReceipt, { force: true });
    }
    console.log(JSON.stringify({
      status: 'created', pack: basename(packPath), receipt: basename(receiptPath),
      bytes: packBytes.byteLength, sha256: receipt.pack.sha256,
    }));
  } finally {
    try {
      if (httpServer?.listening) {
        await new Promise((resolveClose, rejectClose) => {
          httpServer.close((error) => error ? rejectClose(error) : resolveClose());
        });
      }
      if (server) await server.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}

function printHelp() {
  console.log(`Usage:\n  pnpm external-host:export -- --input <request.json> --out-dir <directory> --completed-at <UTC ISO timestamp>\n\nThe command validates the privacy-minimized External Host Asset Request, exports an executable-free Alpha.7 Godot world pack in headless Chrome, and writes a machine-readable request-to-pack receipt. Existing outputs are never overwritten.`);
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) printHelp();
  else await exportPack(options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
