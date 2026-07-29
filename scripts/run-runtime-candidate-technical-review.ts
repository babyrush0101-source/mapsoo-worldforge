import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import JSZip from 'jszip';

import {
  buildRuntimeCandidateProductionWorldReview,
  type RuntimeCandidateCaptureMetrics,
} from '../src/adapters/build-runtime-candidate-production-world-review';
import {
  loadWorldArtRuntimeCandidateWorkspace,
} from '../src/adapters/load-world-art-runtime-candidate-workspace';
import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';
import {
  writeProductionWorldReviewWorkspace,
} from '../src/app/production-world-review-workspace';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  serializeCanonicalWorldLayoutPlan,
} from '../src/core/world-layout-plan';

const FLAGS = Object.freeze([
  '--candidate',
  '--layout',
  '--godot-console',
  '--godot-version',
  '--review-id',
  '--out',
] as const);
const OPTIONAL_FLAGS = Object.freeze(['--overlay-grant'] as const);
const ALL_FLAGS = new Set<string>([...FLAGS, ...OPTIONAL_FLAGS]);
const SAFE_REVIEW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_GRANT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SENTINEL_PREFIX = 'WORLD_ART_RUNTIME_OVERLAY_V1_1_CAPTURE_OK ';
const CAPTURE_MODES = Object.freeze([
  'normal',
  'role-overlay',
  'collision-overlay',
  'spawn-exit',
  'navigation',
] as const);
const MAX_LAYOUT_BYTES = 2 * 1024 * 1024;
const MAX_GRANT_BYTES = 64 * 1024;
const MAX_CAPTURE_BYTES = 128 * 1024 * 1024;
const MAX_PROCESS_OUTPUT = 1024 * 1024;
const CAPTURE_TIMEOUT_MS = 180_000;
const LAYOUT_FILENAME = 'world-layout-plan.json';
const CAPTURE_SCRIPT =
  'res://tests/capture_world_art_runtime_overlay_v1_1.gd';
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GODOT_PROJECT_ROOT = resolve(REPOSITORY_ROOT, 'godot');

type CaptureMode = typeof CAPTURE_MODES[number];
type GodotVersion = '4.3' | '4.7';

export interface RuntimeCandidateTechnicalReviewArguments {
  readonly candidateDirectory: string;
  readonly layoutPath: string;
  readonly godotConsolePath: string;
  readonly godotVersion: GodotVersion;
  readonly reviewId: string;
  readonly outputDirectory: string;
  readonly overlayGrantPath?: string;
}

export interface GodotCaptureSentinel {
  readonly profile:
    | 'side-platformer'
    | 'topdown-farm'
    | 'isometric-action'
    | 'layered-depth-2d';
  readonly mode: CaptureMode;
  readonly layout_sha256: string;
  readonly overlay_id: string;
  readonly projection_id: string;
  readonly placement_plan_id: string;
  readonly placement_map_id: string;
  readonly render_sha256: string;
  readonly route_nodes: number;
  readonly terrain: number;
  readonly landmarks: number;
  readonly hazards: number;
  readonly characters: number;
  readonly backgrounds: number;
  readonly props: number;
  readonly structures: number;
  readonly effects: number;
  readonly depth_planes: number;
  readonly catalog_assets: number;
  readonly bound_catalog_assets: number;
  readonly runtime_bindings: number;
  readonly applied_runtime_bindings: number;
  readonly bindings_sha256: string;
  readonly applied_bindings_sha256: string;
  readonly animation: string;
  readonly output: string;
}

interface CapturePaths {
  readonly normal: string;
  readonly roleOverlay: string;
  readonly collisionOverlay: string;
  readonly spawnFrame: string;
  readonly navigationFrame: string;
  readonly spawnVideo: string;
  readonly navigationVideo: string;
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function usage(): string {
  return [
    'Mapsoo Worldforge - runtime-candidate technical review',
    '',
    'pnpm production-art:runtime-candidate:technical-review -- \\',
    '  --candidate <strict-runtime-candidate-directory> \\',
    '  --layout <canonical-world-layout-plan.json> \\',
    '  --godot-console <Godot-console-executable> \\',
    '  --godot-version 4.3|4.7 \\',
    '  --review-id <kebab-case-id> \\',
    '  --out <private-technical-review-directory> \\',
    '  [--overlay-grant <canonical-local-grant.json>]',
    '',
    'The command performs local validation and Godot capture only.',
    'It makes no network requests and never publishes.',
  ].join('\n');
}

function cleanValue(value: string): boolean {
  return value.length >= 1
    && value.length <= 1000
    && value.trim() === value
    && !value.startsWith('--')
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

export function parseRuntimeCandidateTechnicalReviewArguments(
  argv: readonly string[],
): RuntimeCandidateTechnicalReviewArguments {
  if (argv.length % 2 !== 0) {
    throw new Error('Every runtime-candidate technical-review flag requires one value.');
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!;
    const value = argv[index + 1]!;
    if (!ALL_FLAGS.has(flag) || values.has(flag) || !cleanValue(value)) {
      throw new Error('Flags must be documented, unique, and non-empty.');
    }
    values.set(flag, value);
  }
  for (const flag of FLAGS) {
    if (!values.has(flag)) throw new Error(`${flag} is required.`);
  }
  const godotVersion = values.get('--godot-version');
  const reviewId = values.get('--review-id')!;
  if (godotVersion !== '4.3' && godotVersion !== '4.7') {
    throw new Error('--godot-version must be 4.3 or 4.7.');
  }
  if (!SAFE_REVIEW_ID.test(reviewId) || reviewId.length > 100) {
    throw new Error('--review-id must be lowercase kebab-case.');
  }
  return Object.freeze({
    candidateDirectory: values.get('--candidate')!,
    layoutPath: values.get('--layout')!,
    godotConsolePath: values.get('--godot-console')!,
    godotVersion,
    reviewId,
    outputDirectory: values.get('--out')!,
    ...(values.has('--overlay-grant')
      ? { overlayGrantPath: values.get('--overlay-grant')! }
      : {}),
  });
}

function integer(value: string, label: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Godot sentinel ${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Godot sentinel ${label} is outside the capture boundary.`);
  }
  return parsed;
}

export function parseGodotCaptureSentinel(
  output: string,
  expectedMode?: CaptureMode,
): GodotCaptureSentinel {
  const lines = output.split(/\r?\n/u)
    .filter((line) => line.startsWith(SENTINEL_PREFIX));
  if (lines.length !== 1) {
    throw new Error('Godot capture must emit exactly one success sentinel.');
  }
  const match = /^WORLD_ART_RUNTIME_OVERLAY_V1_1_CAPTURE_OK profile=(side-platformer|topdown-farm|isometric-action|layered-depth-2d) mode=(normal|role-overlay|collision-overlay|spawn-exit|navigation) layout_sha256=([a-f0-9]{64}) overlay_id=(world-art-runtime-overlay-[a-f0-9]{16}) projection_id=(world-art-runtime-projection-[a-f0-9]{16}) placement_plan_id=(world-visual-placement-plan-[a-f0-9]{16}) placement_map_id=(world-art-placement-map-[a-f0-9]{16}) render_sha256=([a-f0-9]{64}) route_nodes=([0-9]+) terrain=([0-9]+) landmarks=([0-9]+) hazards=([0-9]+) characters=([0-9]+) backgrounds=([0-9]+) props=([0-9]+) structures=([0-9]+) effects=([0-9]+) depth_planes=([0-9]+) catalog_assets=([0-9]+) bound_catalog_assets=([0-9]+) runtime_bindings=([0-9]+) applied_runtime_bindings=([0-9]+) bindings_sha256=([a-f0-9]{64}) applied_bindings_sha256=([a-f0-9]{64}) animation=(\S+) output=(.+)$/u.exec(lines[0]!);
  if (!match) throw new Error('Godot capture sentinel is malformed.');
  if (expectedMode && match[2] !== expectedMode) {
    throw new Error('Godot capture sentinel mode differs from the requested mode.');
  }
  return Object.freeze({
    profile: match[1] as GodotCaptureSentinel['profile'],
    mode: match[2] as CaptureMode,
    layout_sha256: match[3]!,
    overlay_id: match[4]!,
    projection_id: match[5]!,
    placement_plan_id: match[6]!,
    placement_map_id: match[7]!,
    render_sha256: match[8]!,
    route_nodes: integer(match[9]!, 'route_nodes'),
    terrain: integer(match[10]!, 'terrain'),
    landmarks: integer(match[11]!, 'landmarks'),
    hazards: integer(match[12]!, 'hazards'),
    characters: integer(match[13]!, 'characters'),
    backgrounds: integer(match[14]!, 'backgrounds'),
    props: integer(match[15]!, 'props'),
    structures: integer(match[16]!, 'structures'),
    effects: integer(match[17]!, 'effects'),
    depth_planes: integer(match[18]!, 'depth_planes'),
    catalog_assets: integer(match[19]!, 'catalog_assets'),
    bound_catalog_assets: integer(match[20]!, 'bound_catalog_assets'),
    runtime_bindings: integer(match[21]!, 'runtime_bindings'),
    applied_runtime_bindings: integer(match[22]!, 'applied_runtime_bindings'),
    bindings_sha256: match[23]!,
    applied_bindings_sha256: match[24]!,
    animation: match[25]!,
    output: match[26]!,
  });
}

function canonicalJson(value: unknown): string {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Canonical input contains a non-finite number.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('Canonical input is unsupported.');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function inside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot.length === 0
    || (
      fromRoot !== '..'
      && !fromRoot.startsWith(`..${sep}`)
      && !isAbsolute(fromRoot)
    );
}

function overlaps(left: string, right: string): boolean {
  return inside(left, right) || inside(right, left);
}

function normalizedPath(value: string): string {
  const normalized = resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function directFile(
  value: string,
  label: string,
  maximumBytes: number,
): Promise<Readonly<{ path: string; bytes: Uint8Array }>> {
  const unresolved = resolve(value);
  try {
    const metadata = await lstat(unresolved);
    const canonical = await realpath(unresolved);
    if (
      metadata.isSymbolicLink()
      || !metadata.isFile()
      || normalizedPath(canonical) !== normalizedPath(unresolved)
      || metadata.size < 1
      || metadata.size > maximumBytes
    ) {
      throw new Error('invalid-file');
    }
    const handle = await open(unresolved, 'r');
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile()
        || opened.size !== metadata.size
        || opened.dev !== metadata.dev
        || opened.ino !== metadata.ino
      ) {
        throw new Error('changed-file');
      }
      const bytes = Uint8Array.from(await handle.readFile());
      if (bytes.byteLength !== opened.size) throw new Error('changed-file');
      return Object.freeze({ path: canonical, bytes });
    } finally {
      await handle.close();
    }
  } catch {
    throw new Error(`${label} must be a direct, stable local file.`);
  }
}

function strictJson(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be UTF-8 JSON.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) throw new Error(`${label} must be strict JSON.`);
  return parsed.value;
}

async function canonicalLayout(value: string): Promise<Readonly<{
  plan: Awaited<ReturnType<typeof materializeWorldLayoutPlan>>;
  semanticSha256: string;
  captureBytes: Uint8Array;
}>> {
  const file = await directFile(value, 'Layout', MAX_LAYOUT_BYTES);
  if (basename(file.path) !== LAYOUT_FILENAME) {
    throw new Error(`Layout file must be named ${LAYOUT_FILENAME}.`);
  }
  const parsed = strictJson(file.bytes, 'WorldLayoutPlan');
  const plan = await materializeWorldLayoutPlan(parsed);
  const canonicalFileBytes = await serializeCanonicalWorldLayoutPlan(plan);
  if (!equalBytes(file.bytes, canonicalFileBytes)) {
    throw new Error('Layout file bytes are not canonical.');
  }
  return Object.freeze({
    plan,
    semanticSha256: await fingerprintWorldLayoutPlan(plan),
    captureBytes: new TextEncoder().encode(canonicalJson(plan)),
  });
}

async function canonicalGrant(
  value: string,
  expected: Readonly<{
    distribution: string;
    overlayId: string;
  }>,
): Promise<Uint8Array> {
  const file = await directFile(value, 'Overlay grant', MAX_GRANT_BYTES);
  const parsed = strictJson(file.bytes, 'Overlay grant');
  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
  ) {
    throw new Error('Overlay grant must be an object.');
  }
  const grant = parsed as Record<string, unknown>;
  const keys = Object.keys(grant).sort();
  const expectedKeys = ['decision', 'distribution', 'grant_id', 'overlay_id'];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || grant.decision !== 'allow'
    || grant.distribution !== expected.distribution
    || grant.overlay_id !== expected.overlayId
    || typeof grant.grant_id !== 'string'
    || grant.grant_id.length > 100
    || !SAFE_GRANT_ID.test(grant.grant_id)
  ) {
    throw new Error('Overlay grant does not authorize this exact local overlay.');
  }
  const canonical = new TextEncoder().encode(`${canonicalJson(grant)}\n`);
  if (!equalBytes(file.bytes, canonical)) {
    throw new Error('Overlay grant bytes are not canonical.');
  }
  return canonical;
}

async function executable(value: string): Promise<Readonly<{
  path: string;
  sha256: string;
}>> {
  const file = await directFile(value, 'Godot console', 1024 * 1024 * 1024);
  return Object.freeze({
    path: file.path,
    sha256: await sha256(file.bytes),
  });
}

function runProcess(
  executablePath: string,
  args: readonly string[],
  cwd: string,
  timeoutMs = CAPTURE_TIMEOUT_MS,
): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executablePath, [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error('Godot capture timed out.'));
      }
    }, timeoutMs);
    const append = (current: string, chunk: Buffer): string => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PROCESS_OUTPUT) {
        child.kill('SIGKILL');
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('Godot capture output exceeded its boundary.'));
        }
        return current;
      }
      return current + chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new Error('Godot capture could not start.'));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolvePromise(Object.freeze({
          exitCode: code ?? -1,
          stdout,
          stderr,
        }));
      }
    });
  });
}

async function verifyGodotVersion(
  executablePath: string,
  expected: GodotVersion,
): Promise<void> {
  const result = await runProcess(executablePath, ['--version'], REPOSITORY_ROOT, 30_000);
  const line = `${result.stdout}\n${result.stderr}`.split(/\r?\n/u)
    .find((candidate) => candidate.trim().length > 0);
  if (result.exitCode !== 0 || !line?.startsWith(`${expected}.`)) {
    throw new Error('Godot console version differs from --godot-version.');
  }
}

function captureResolution(profile: string): string {
  return profile === 'topdown-farm' ? '640x480' : '640x360';
}

export function buildGodotCaptureArguments(input: Readonly<{
  mode: CaptureMode;
  profile: string;
  layoutPath: string;
  overlayManifestPath: string;
  outputPath: string;
  moviePath?: string;
  overlayGrantPath?: string;
}>): readonly string[] {
  const displayDriver = process.platform === 'win32' ? 'windows' : 'x11';
  return Object.freeze([
    '--display-driver',
    displayDriver,
    '--audio-driver',
    'Dummy',
    '--single-window',
    '--position',
    '10000,10000',
    '--path',
    GODOT_PROJECT_ROOT,
    '--resolution',
    captureResolution(input.profile),
    ...(input.moviePath
      ? ['--fixed-fps', '30', '--write-movie', input.moviePath]
      : []),
    '--script',
    CAPTURE_SCRIPT,
    '--',
    `--layout=${input.layoutPath}`,
    `--overlay-manifest=${input.overlayManifestPath}`,
    `--output=${input.outputPath}`,
    `--evidence-mode=${input.mode}`,
    ...(input.overlayGrantPath
      ? [`--overlay-grant=${input.overlayGrantPath}`]
      : []),
  ]);
}

async function extractOverlay(
  overlayBytes: Uint8Array,
  manifest: Readonly<{
    overlay_id: string;
    files: readonly Readonly<{ path: string }>[];
  }>,
  destination: string,
): Promise<string> {
  const archive = await JSZip.loadAsync(overlayBytes, { checkCRC32: true });
  const root = resolve(destination, manifest.overlay_id);
  await mkdir(root, { recursive: true });
  const expected = new Set([
    `${manifest.overlay_id}/world-art-runtime-overlay.json`,
    ...manifest.files.map(({ path }) => `${manifest.overlay_id}/${path}`),
  ]);
  const entries = Object.values(archive.files);
  if (
    entries.length !== expected.size
    || entries.some(({ dir, name }) => dir || !expected.has(name))
  ) {
    throw new Error('Verified overlay inventory changed before extraction.');
  }
  for (const entry of entries) {
    const relativePath = entry.name.slice(manifest.overlay_id.length + 1);
    const target = resolve(root, ...relativePath.split('/'));
    if (!inside(root, target) || target === root) {
      throw new Error('Overlay extraction path escaped its temporary directory.');
    }
    await mkdir(dirname(target), { recursive: true });
    const bytes = await entry.async('uint8array');
    await writeFile(target, bytes, { flag: 'wx' });
  }
  return resolve(root, 'world-art-runtime-overlay.json');
}

async function boundedSource(
  path: string,
): Promise<Readonly<{ bytes: number; readBytes(): Uint8Array }>> {
  const file = await directFile(path, 'Godot evidence', MAX_CAPTURE_BYTES);
  const snapshot = Uint8Array.from(file.bytes);
  return Object.freeze({
    bytes: snapshot.byteLength,
    readBytes: () => Uint8Array.from(snapshot),
  });
}

async function capture(
  executablePath: string,
  input: Parameters<typeof buildGodotCaptureArguments>[0],
  expected: Readonly<{
    profile: string;
    layoutSha256: string;
    overlayId: string;
    projectionId: string;
    placementPlanId: string;
    placementMapId: string;
  }>,
): Promise<GodotCaptureSentinel> {
  const result = await runProcess(
    executablePath,
    buildGodotCaptureArguments(input),
    REPOSITORY_ROOT,
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  if (
    result.exitCode !== 0
    || combined.split(/\r?\n/u).some((line) =>
      /^(?:SCRIPT )?ERROR:/u.test(line)
      && line !== 'ERROR: Failed to read the root certificate store.')
  ) {
    throw new Error(`Godot ${input.mode} capture failed.`);
  }
  const sentinel = parseGodotCaptureSentinel(combined, input.mode);
  const actualOutput = await directFile(input.outputPath, 'Godot PNG evidence', MAX_CAPTURE_BYTES);
  if (
    sentinel.profile !== expected.profile
    || sentinel.layout_sha256 !== expected.layoutSha256
    || sentinel.overlay_id !== expected.overlayId
    || sentinel.projection_id !== expected.projectionId
    || sentinel.placement_plan_id !== expected.placementPlanId
    || sentinel.placement_map_id !== expected.placementMapId
    || sentinel.render_sha256 !== await sha256(actualOutput.bytes)
    || resolve(sentinel.output) !== resolve(input.outputPath)
  ) {
    throw new Error(`Godot ${input.mode} sentinel differs from exact capture inputs.`);
  }
  if (input.moviePath) {
    await directFile(input.moviePath, 'Godot AVI evidence', MAX_CAPTURE_BYTES);
  }
  return sentinel;
}

function sameCounts(
  left: GodotCaptureSentinel,
  right: GodotCaptureSentinel,
): boolean {
  return left.terrain === right.terrain
    && left.landmarks === right.landmarks
    && left.hazards === right.hazards
    && left.characters === right.characters
    && left.backgrounds === right.backgrounds
    && left.props === right.props
    && left.structures === right.structures
    && left.effects === right.effects
    && left.depth_planes === right.depth_planes
    && left.catalog_assets === right.catalog_assets
    && left.bound_catalog_assets === right.bound_catalog_assets
    && left.runtime_bindings === right.runtime_bindings
    && left.applied_runtime_bindings === right.applied_runtime_bindings
    && left.bindings_sha256 === right.bindings_sha256
    && left.applied_bindings_sha256 === right.applied_bindings_sha256
    && left.projection_id === right.projection_id
    && left.placement_plan_id === right.placement_plan_id
    && left.placement_map_id === right.placement_map_id;
}

async function directorySnapshot(root: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join('/');
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        result.set(relativePath, Uint8Array.from(await readFile(path)));
      } else {
        throw new Error('Technical review workspace contains an unsupported entry.');
      }
    }
  }
  return result;
}

async function promoteIdempotently(staging: string, output: string): Promise<'created' | 'unchanged'> {
  try {
    const metadata = await lstat(output);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Technical review output must be a direct directory.');
    }
    const [left, right] = await Promise.all([
      directorySnapshot(staging),
      directorySnapshot(output),
    ]);
    if (
      left.size !== right.size
      || [...left].some(([path, bytes]) => {
        const existing = right.get(path);
        return !existing || !equalBytes(bytes, existing);
      })
    ) {
      throw new Error('Existing technical review output differs.');
    }
    return 'unchanged';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rename(staging, output);
  return 'created';
}

export async function runRuntimeCandidateTechnicalReview(
  input: RuntimeCandidateTechnicalReviewArguments,
): Promise<Readonly<{
  status: 'technical-review-created' | 'technical-review-unchanged';
  review_id: string;
  profile: string;
  technical_gates: 5;
  human_gate: 'pending';
  release_decision: 'blocked';
  files: number;
  remote_requests: 0;
  published: false;
}>> {
  const layout = await canonicalLayout(input.layoutPath);
  const candidate = await loadWorldArtRuntimeCandidateWorkspace(
    input.candidateDirectory,
    layout.plan,
  );
  if (
    layout.plan.profile !== candidate.receipt.profile
    || layout.semanticSha256 !== candidate.receipt.source.layout_plan_sha256
  ) {
    throw new Error('Layout does not bind the exact runtime candidate.');
  }
  const candidateRoot = await realpath(resolve(input.candidateDirectory));
  const output = resolve(input.outputDirectory);
  if (overlaps(candidateRoot, output)) {
    throw new Error('Technical review output must be separate from candidate input.');
  }
  const godot = await executable(input.godotConsolePath);
  await verifyGodotVersion(godot.path, input.godotVersion);
  const outputParent = dirname(output);
  await mkdir(outputParent, { recursive: true });
  const temporaryRoot = await mkdtemp(resolve(
    outputParent,
    '.runtime-candidate-technical-review-',
  ));
  try {
    const overlayManifestPath = await extractOverlay(
      candidate.overlay.readBytes(),
      candidate.overlay.manifest,
      resolve(temporaryRoot, 'overlay'),
    );
    const captureLayoutPath = resolve(temporaryRoot, LAYOUT_FILENAME);
    await writeFile(captureLayoutPath, layout.captureBytes, { flag: 'wx' });
    let grantPath: string | undefined;
    if (input.overlayGrantPath) {
      const grant = await canonicalGrant(input.overlayGrantPath, {
        distribution: candidate.receipt.rights.distribution,
        overlayId: candidate.overlay.manifest.overlay_id,
      });
      grantPath = resolve(temporaryRoot, 'overlay-grant.json');
      await writeFile(grantPath, grant, { flag: 'wx' });
    } else if (candidate.receipt.rights.distribution !== 'public') {
      throw new Error('Private or internal-review overlay requires --overlay-grant.');
    }
    const captureRoot = resolve(temporaryRoot, 'captures');
    await mkdir(captureRoot);
    const paths: CapturePaths = Object.freeze({
      normal: resolve(captureRoot, 'rendered-world-capture.png'),
      roleOverlay: resolve(captureRoot, 'role-placement-overlay.png'),
      collisionOverlay: resolve(captureRoot, 'art-collision-overlay.png'),
      spawnFrame: resolve(captureRoot, 'spawn-exit-frame.png'),
      navigationFrame: resolve(captureRoot, 'navigation-frame.png'),
      spawnVideo: resolve(captureRoot, 'spawn-exit-traversal.avi'),
      navigationVideo: resolve(captureRoot, 'navigation-traversal.avi'),
    });
    const expected = Object.freeze({
      profile: candidate.receipt.profile,
      layoutSha256: layout.semanticSha256,
      overlayId: candidate.overlay.manifest.overlay_id,
      projectionId: candidate.runtime_projection.projection_id,
      placementPlanId: candidate.overlay.placement_plan.plan_id,
      placementMapId: candidate.overlay.placement_map.map_id,
    });
    const sentinels: GodotCaptureSentinel[] = [];
    for (const mode of CAPTURE_MODES) {
      const outputPath = mode === 'normal'
        ? paths.normal
        : mode === 'role-overlay'
          ? paths.roleOverlay
          : mode === 'collision-overlay'
            ? paths.collisionOverlay
            : mode === 'spawn-exit'
              ? paths.spawnFrame
              : paths.navigationFrame;
      const moviePath = mode === 'spawn-exit'
        ? paths.spawnVideo
        : mode === 'navigation'
          ? paths.navigationVideo
          : undefined;
      sentinels.push(await capture(godot.path, {
        mode,
        profile: candidate.receipt.profile,
        layoutPath: captureLayoutPath,
        overlayManifestPath,
        outputPath,
        ...(moviePath ? { moviePath } : {}),
        ...(grantPath ? { overlayGrantPath: grantPath } : {}),
      }, expected));
    }
    const baseline = sentinels[0]!;
    if (
      sentinels.some((sentinel) => !sameCounts(baseline, sentinel))
      || sentinels.find(({ mode }) => mode === 'spawn-exit')!.route_nodes < 2
      || sentinels.find(({ mode }) => mode === 'navigation')!.route_nodes < 2
    ) {
      throw new Error('Godot capture modes disagree on runtime counts or traversal.');
    }
    const metrics: RuntimeCandidateCaptureMetrics = Object.freeze({
      visible_terrain_materials: baseline.terrain,
      visible_landmarks: baseline.landmarks,
      visible_hazards: baseline.hazards,
      visible_characters: baseline.characters,
      applied_background_layers: baseline.backgrounds,
      applied_prop_instances: baseline.props,
      applied_structure_instances: baseline.structures,
      applied_effect_bindings: baseline.effects,
      applied_depth_planes: baseline.depth_planes,
      route_reached: true,
      catalog_assets: baseline.catalog_assets,
      bound_catalog_assets: baseline.bound_catalog_assets,
      runtime_bindings: baseline.runtime_bindings,
      applied_runtime_bindings: baseline.applied_runtime_bindings,
      catalog_only_assets:
        baseline.catalog_assets - baseline.bound_catalog_assets,
      bindings_sha256: baseline.bindings_sha256,
      applied_bindings_sha256: baseline.applied_bindings_sha256,
    });
    const built = await buildRuntimeCandidateProductionWorldReview({
      candidate,
      layoutPlanSha256: layout.semanticSha256,
      reviewId: input.reviewId,
      godotVersion: input.godotVersion,
      godotExecutableSha256: godot.sha256,
      captureMetrics: metrics,
      renderedWorldCapture: await boundedSource(paths.normal),
      rolePlacementOverlay: await boundedSource(paths.roleOverlay),
      artCollisionOverlay: await boundedSource(paths.collisionOverlay),
      spawnExitTraversal: await boundedSource(paths.spawnVideo),
      navigationTraversal: await boundedSource(paths.navigationVideo),
    });
    const stagingOutput = resolve(temporaryRoot, 'review-workspace');
    await writeProductionWorldReviewWorkspace(built, stagingOutput);
    const promoted = await promoteIdempotently(stagingOutput, output);
    return Object.freeze({
      status: promoted === 'created'
        ? 'technical-review-created'
        : 'technical-review-unchanged',
      review_id: built.review.review_id,
      profile: built.review.profile,
      technical_gates: 5,
      human_gate: 'pending',
      release_decision: 'blocked',
      files: built.files.length,
      remote_requests: 0,
      published: false,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const parsed = parseRuntimeCandidateTechnicalReviewArguments(args);
  const result = await runRuntimeCandidateTechnicalReview(parsed);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entry = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === entry) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `Runtime-candidate technical review failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }\n`,
    );
    process.exitCode = 1;
  });
}
