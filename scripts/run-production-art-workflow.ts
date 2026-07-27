import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';
import {
  OPENAI_PRODUCTION_ART_MODEL,
  OPENAI_PRODUCTION_ART_PROVIDER_ID,
} from '../src/adapters/openai/openai-production-art-provider';
import {
  assertValidProductionArtOutput,
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtTask,
} from '../src/core/production-art-contract';
import {
  beginProductionArtWorkflowTask,
  completeProductionArtWorkflowTask,
  createProductionArtWorkflowState,
  parseProductionArtWorkflowState,
  reconcileProductionArtWorkflowTask,
  selectNextProductionArtWorkflowTask,
  type ProductionArtWorkflowArtifact,
  type ProductionArtWorkflowQuality,
  type ProductionArtWorkflowState,
} from '../src/core/production-art-workflow';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../src/core/asset-profile';
import {
  createProductionArtProgress,
} from '../src/core/production-art-progress';
import type {
  ProductionArtGenerationEvidence,
} from '../src/adapters/normalize-production-art-png';
import type {
  ProductionCharacterProfileProjectionRecord,
} from '../src/adapters/project-production-character-profile';
import {
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
} from '../src/core/character-profile-revision';
import { createProductionArtRunSet } from '../src/core/production-art-run-set';

const WORKFLOW_ROOT = 'docs/visual-qa/production-art/workflows';
const MODEL_RUN_ROOT = 'docs/visual-qa/production-art/model-runs';
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_SHA256 = /^[a-f0-9]{64}$/;
const MAX_JOB_BYTES = 128 * 1024;
const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 1024 * 1024;
const VALUE_FLAGS = new Set([
  '--job',
  '--max-requests',
  '--retry-task',
  '--reconcile-task',
  '--run-directory',
]);
const BOOLEAN_FLAGS = new Set([
  '--execute',
  '--allow-remote-upload',
  '--acknowledge-duplicate-cost-risk',
  '--help',
]);

interface Arguments {
  readonly help: boolean;
  readonly execute: boolean;
  readonly allowRemoteUpload: boolean;
  readonly acknowledgeDuplicateCostRisk: boolean;
  readonly job?: string;
  readonly maxRequests: number;
  readonly retryTask?: string;
  readonly reconcileTask?: string;
  readonly runDirectory?: string;
}

interface WorkflowJob {
  readonly schema_version: '1.0.0';
  readonly document_type: 'production-art-workflow-job';
  readonly workflow_id: string;
  readonly profile: WorldAssetProfile;
  readonly quality: ProductionArtWorkflowQuality;
  readonly request_budget: number;
  readonly world_brief_file: string;
  readonly style_bible_file: string;
  readonly environment_reference: string;
  readonly character_reference: string;
  readonly character_id: string;
  readonly approved_direction?: string;
  readonly private_output_root?: string;
}

interface TaskRunnerSummary {
  readonly status: 'candidate-written' | 'candidate-written-projection-rejected';
  readonly remote_request_count: 1;
  readonly profile: WorldAssetProfile;
  readonly task_id: string;
  readonly source_sha256: string;
  readonly normalized_sha256: string;
  readonly output_directory: string;
  readonly character_profile_projection_error_code?: string;
  readonly pack10_projection_error_code?: string;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — resumable production-art workflow',
    '',
    'Inspect or initialize without any remote request:',
    '  pnpm production-art:workflow -- --job <private-workflow.json>',
    '',
    'Run at most one new paid task:',
    '  pnpm production-art:workflow -- --job <private-workflow.json> \\',
    '    --execute --allow-remote-upload --max-requests 1',
    '',
    'Explicitly retry one rejected/uncertain task:',
    '  pnpm production-art:workflow -- --job <private-workflow.json> \\',
    '    --retry-task <task-id> --acknowledge-duplicate-cost-risk \\',
    '    --execute --allow-remote-upload',
    '',
    'Reconcile an already-written run after interruption without another request:',
    '  pnpm production-art:workflow -- --job <private-workflow.json> \\',
    '    --reconcile-task <task-id> --run-directory <repo-relative-run-directory>',
    '',
    'Safety:',
    '  - dry-run is the default;',
    '  - every started remote task immediately consumes one request from the fixed budget;',
    '  - only one task runs at a time and the default invocation limit is one;',
    '  - interrupted tasks never retry automatically;',
    '  - scene-direction output needs an exact human-approved digest before later tasks;',
    '  - private paths and source contents are not copied into workflow state or run-set JSON;',
    '  - jobs created by world-delivery:workspace keep state and candidate bytes outside the repository.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (BOOLEAN_FLAGS.has(argument)) {
      if (booleans.has(argument)) throw new Error(`Duplicate flag: ${argument}.`);
      booleans.add(argument);
      continue;
    }
    if (!VALUE_FLAGS.has(argument)) throw new Error(`Unknown flag: ${argument}.`);
    if (values.has(argument)) throw new Error(`Duplicate flag: ${argument}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    values.set(argument, value);
    index += 1;
  }
  const maxRequestsValue = values.get('--max-requests') ?? '1';
  if (!/^[1-4]$/.test(maxRequestsValue)) {
    throw new Error('--max-requests must be an integer from 1 to 4.');
  }
  const args: Arguments = {
    help: booleans.has('--help'),
    execute: booleans.has('--execute'),
    allowRemoteUpload: booleans.has('--allow-remote-upload'),
    acknowledgeDuplicateCostRisk:
      booleans.has('--acknowledge-duplicate-cost-risk'),
    maxRequests: Number(maxRequestsValue),
    ...(values.has('--job') ? { job: values.get('--job') } : {}),
    ...(values.has('--retry-task') ? { retryTask: values.get('--retry-task') } : {}),
    ...(values.has('--reconcile-task')
      ? { reconcileTask: values.get('--reconcile-task') }
      : {}),
    ...(values.has('--run-directory')
      ? { runDirectory: values.get('--run-directory') }
      : {}),
  };
  if (args.help) return args;
  if (!args.job) throw new Error('--job is required.');
  if (args.execute !== args.allowRemoteUpload) {
    throw new Error('--execute and --allow-remote-upload must be supplied together.');
  }
  if (args.retryTask && !args.execute) {
    throw new Error('--retry-task requires --execute.');
  }
  if (args.retryTask && !args.acknowledgeDuplicateCostRisk) {
    throw new Error('--retry-task requires --acknowledge-duplicate-cost-risk.');
  }
  if (args.retryTask && args.maxRequests !== 1) {
    throw new Error('An explicit retry can run only one request per invocation.');
  }
  if (Boolean(args.reconcileTask) !== Boolean(args.runDirectory)) {
    throw new Error('--reconcile-task and --run-directory must be supplied together.');
  }
  if (args.reconcileTask && args.execute) {
    throw new Error('Reconciliation is local-only and cannot be combined with --execute.');
  }
  return args;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length
    && keys.every((key, index) => key === wanted[index]);
}

function safePathValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 1000
    && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function isInsideRepository(pathValue: string): boolean {
  const fromRepository = relative(REPOSITORY_ROOT, resolve(pathValue));
  return fromRepository.length === 0
    || (
      fromRepository !== '..'
      && !fromRepository.startsWith(`..${sep}`)
      && !isAbsolute(fromRepository)
    );
}

function parseWorkflowJob(value: unknown): WorkflowJob {
  if (!isPlainObject(value)) throw new Error('Workflow job root must be an object.');
  const hasApprovedDirection = Object.prototype.hasOwnProperty.call(
    value,
    'approved_direction',
  );
  const hasPrivateOutputRoot = Object.prototype.hasOwnProperty.call(
    value,
    'private_output_root',
  );
  if (
    !exactKeys(value, [
      'character_id',
      'character_reference',
      'document_type',
      'environment_reference',
      'profile',
      'quality',
      'request_budget',
      'schema_version',
      'style_bible_file',
      'workflow_id',
      'world_brief_file',
      ...(hasApprovedDirection ? ['approved_direction'] : []),
      ...(hasPrivateOutputRoot ? ['private_output_root'] : []),
    ])
    || value.schema_version !== '1.0.0'
    || value.document_type !== 'production-art-workflow-job'
    || typeof value.workflow_id !== 'string'
    || value.workflow_id.length > 80
    || !SAFE_ID.test(value.workflow_id)
    || !WORLD_ASSET_PROFILES.includes(value.profile as WorldAssetProfile)
    || !['low', 'medium', 'high'].includes(value.quality as string)
    || !Number.isSafeInteger(value.request_budget)
    || (value.request_budget as number) < 1
    || (value.request_budget as number) > 64
    || !safePathValue(value.world_brief_file)
    || !safePathValue(value.style_bible_file)
    || !safePathValue(value.environment_reference)
    || !safePathValue(value.character_reference)
    || (hasApprovedDirection && !safePathValue(value.approved_direction))
    || (hasPrivateOutputRoot && !safePathValue(value.private_output_root))
    || (
      hasPrivateOutputRoot
      && (
        !isAbsolute(value.private_output_root as string)
        || isInsideRepository(value.private_output_root as string)
      )
    )
    || typeof value.character_id !== 'string'
    || value.character_id.length > 48
    || !SAFE_ID.test(value.character_id)
  ) {
    throw new Error('Workflow job shape or values are invalid.');
  }
  return value as unknown as WorkflowJob;
}

async function readJob(path: string): Promise<WorkflowJob> {
  let bytes: Buffer;
  try {
    bytes = await readFile(resolve(path));
  } catch {
    throw new Error('Workflow job file could not be read.');
  }
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_JOB_BYTES) {
    throw new Error('Workflow job must be non-empty and no larger than 128 KiB.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Workflow job must contain strict UTF-8.');
  }
  const parsed = parseStrictJsonDocument(text, 'Production-art workflow job');
  if (!parsed.ok) throw new Error(parsed.message);
  return parseWorkflowJob(parsed.value);
}

async function readBoundedText(
  path: string,
  label: string,
  maximumCharacters: number,
): Promise<string> {
  let value: string;
  try {
    value = await readFile(resolve(path), 'utf8');
  } catch {
    throw new Error(`${label} could not be read.`);
  }
  if (
    value.length < 1
    || value.length > maximumCharacters
    || value.trim() !== value
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${label} must be non-empty, trimmed, and bounded.`);
  }
  return value;
}

async function readBoundedBinary(path: string, label: string): Promise<Uint8Array> {
  let bytes: Buffer;
  try {
    bytes = await readFile(resolve(path));
  } catch {
    throw new Error(`${label} could not be read.`);
  }
  if (bytes.byteLength < 8 || bytes.byteLength > MAX_REFERENCE_BYTES) {
    throw new Error(`${label} must be between 8 bytes and 32 MiB.`);
  }
  return Uint8Array.from(bytes);
}

function digestBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function privateInputBinding(input: {
  readonly job: WorkflowJob;
  readonly worldBrief: string;
  readonly styleBible: string;
  readonly environmentReference: Uint8Array;
  readonly characterReference: Uint8Array;
}): string {
  const hash = createHash('sha256');
  const fields: readonly [string, string | Uint8Array][] = [
    ['schema', 'production-art-private-input-binding-v1'],
    ['profile', input.job.profile],
    ['quality', input.job.quality],
    ['character-id', input.job.character_id],
    ['world-brief', input.worldBrief],
    ['style-bible', input.styleBible],
    ['environment-reference', input.environmentReference],
    ['character-reference', input.characterReference],
  ];
  for (const [label, value] of fields) {
    const bytes = typeof value === 'string'
      ? new TextEncoder().encode(value)
      : value;
    hash.update(label);
    hash.update('\0');
    hash.update(String(bytes.byteLength));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function safeWorkflowDirectory(
  workflowRoot: string,
  profile: WorldAssetProfile,
  workflowId: string,
): string {
  const root = resolve(workflowRoot);
  const target = resolve(root, profile, workflowId);
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error('Workflow directory escaped its fixed local root.');
  }
  return target;
}

function stateFileName(revision: number): string {
  return `state-${String(revision).padStart(6, '0')}.json`;
}

async function readLatestState(
  directory: string,
  plan: ReturnType<typeof createProductionArtPlan>,
): Promise<ProductionArtWorkflowState | undefined> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
  const stateEntries = entries
    .map((name) => {
      const match = /^state-(\d{6})\.json$/.exec(name);
      return match ? { name, revision: Number(match[1]) } : undefined;
    })
    .filter((entry): entry is { name: string; revision: number } => Boolean(entry))
    .sort((left, right) => left.revision - right.revision);
  if (stateEntries.length === 0) return undefined;
  const latest = stateEntries.at(-1)!;
  let text: string;
  try {
    text = await readFile(resolve(directory, latest.name), 'utf8');
  } catch {
    throw new Error('Latest workflow state could not be read.');
  }
  const parsed = parseStrictJsonDocument(text, 'Production-art workflow state');
  if (!parsed.ok) throw new Error(parsed.message);
  const state = parseProductionArtWorkflowState(parsed.value, plan);
  if (state.state_revision !== latest.revision) {
    throw new Error('Workflow journal filename does not match its state revision.');
  }
  return state;
}

async function persistState(
  directory: string,
  state: ProductionArtWorkflowState,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const finalPath = resolve(directory, stateFileName(state.state_revision));
  const temporaryPath = resolve(
    directory,
    `.state-${String(state.state_revision).padStart(6, '0')}-${randomUUID()}.tmp`,
  );
  const bytes = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(temporaryPath, bytes, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(temporaryPath, finalPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    try {
      const existing = await readFile(finalPath, 'utf8');
      if (existing === bytes) return;
    } catch {
      // Preserve the original collision below.
    }
    throw new Error(
      'Workflow state revision collision detected; no remote request was started.',
      { cause: error },
    );
  }
}

async function acquireWorkflowLock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true });
  const lockPath = resolve(directory, '.workflow.lock');
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({
      schema_version: '1.0.0',
      document_type: 'production-art-workflow-lock',
      pid: process.pid,
    })}\n`, 'utf8');
    await handle.close();
  } catch {
    throw new Error(
      'Workflow is already active or has a stale lock; inspect the local workflow directory before removing only .workflow.lock.',
    );
  }
  return async () => {
    await rm(lockPath, { force: true });
  };
}

function assertStateMatchesJob(
  state: ProductionArtWorkflowState,
  job: WorkflowJob,
  inputBindingSha256: string,
): void {
  if (
    state.workflow_id !== job.workflow_id
    || state.profile !== job.profile
    || state.provider.id !== OPENAI_PRODUCTION_ART_PROVIDER_ID
    || state.provider.model !== OPENAI_PRODUCTION_ART_MODEL
    || state.provider.quality !== job.quality
    || state.request_budget !== job.request_budget
    || state.input_binding_sha256 !== inputBindingSha256
  ) {
    throw new Error(
      'Workflow job no longer matches its immutable state; create a new workflow id for changed inputs.',
    );
  }
}

function isPlayerCharacterTask(task: ProductionArtTask): boolean {
  return task.kind === 'character-animation-sheet'
    && task.role_mappings.length === 1
    && task.role_mappings[0].role === 'character.player.atlas';
}

function taskArguments(
  job: WorkflowJob,
  task: ProductionArtTask,
): string[] {
  const values = [
    '--profile',
    job.profile,
    '--task',
    task.task_id,
    '--quality',
    job.quality,
    '--world-brief-file',
    job.world_brief_file,
    '--style-bible-file',
    job.style_bible_file,
  ];
  if (task.task_id === 'scene-direction') {
    values.push(
      '--environment-reference',
      job.environment_reference,
      '--character-reference',
      job.character_reference,
    );
  } else {
    values.push('--approved-direction', job.approved_direction!);
    if (task.reference_roles.includes('character')) {
      values.push('--character-reference', job.character_reference);
    }
  }
  if (isPlayerCharacterTask(task)) {
    values.push('--character-id', job.character_id);
  }
  if (job.private_output_root) {
    values.push(
      '--output-root',
      resolve(job.private_output_root, 'model-runs'),
    );
  }
  values.push('--execute', '--allow-remote-upload');
  return values;
}

async function runTaskProcess(
  job: WorkflowJob,
  task: ProductionArtTask,
): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const viteNode = resolve('node_modules/vite-node/vite-node.mjs');
  const runner = resolve('scripts/run-openai-production-art-source.ts');
  const child = spawn(process.execPath, [viteNode, runner, ...taskArguments(job, task)], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let captured = 0;
  let oversized = false;
  const capture = (target: Buffer[]) => (chunk: Buffer) => {
    captured += chunk.byteLength;
    if (captured > MAX_CHILD_OUTPUT_BYTES) {
      oversized = true;
      child.kill();
      return;
    }
    target.push(Buffer.from(chunk));
  };
  child.stdout.on('data', capture(stdout));
  child.stderr.on('data', capture(stderr));
  const exitCode = await new Promise<number | null>((accept, reject) => {
    child.once('error', reject);
    child.once('close', accept);
  });
  if (oversized) {
    return {
      exitCode: null,
      stdout: '',
      stderr: 'Task runner output exceeded its fixed capture limit.',
    };
  }
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

function parseTaskSummary(stdout: string): TaskRunnerSummary {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    throw new Error('Task runner did not return one JSON summary.');
  }
  if (
    !isPlainObject(value)
    || !['candidate-written', 'candidate-written-projection-rejected']
      .includes(value.status as string)
    || value.remote_request_count !== 1
    || !WORLD_ASSET_PROFILES.includes(value.profile as WorldAssetProfile)
    || typeof value.task_id !== 'string'
    || typeof value.source_sha256 !== 'string'
    || !SAFE_SHA256.test(value.source_sha256)
    || typeof value.normalized_sha256 !== 'string'
    || !SAFE_SHA256.test(value.normalized_sha256)
    || typeof value.output_directory !== 'string'
  ) {
    throw new Error('Task runner JSON summary is invalid.');
  }
  return value as unknown as TaskRunnerSummary;
}

function parseJsonRecord(bytes: Uint8Array, label: string): Record<string, unknown> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not strict UTF-8.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    throw new Error(`${label} is invalid JSON.`);
  }
  return parsed.value;
}

async function verifyRunDirectory(
  profile: WorldAssetProfile,
  plan: ProductionArtPlan,
  taskId: string,
  runDirectory: string,
  expectedCharacterId: string,
  allowProjectionRejected = false,
  privateOutputRoot?: string,
): Promise<ProductionArtWorkflowArtifact> {
  const root = privateOutputRoot
    ? resolve(privateOutputRoot, 'model-runs')
    : resolve(MODEL_RUN_ROOT);
  const directory = privateOutputRoot
    ? resolve(root, runDirectory)
    : resolve(runDirectory);
  if (!directory.startsWith(`${root}${sep}`)) {
    throw new Error('Run directory must stay under the fixed ignored model-run root.');
  }
  const parts = relative(root, directory).split(/[\\/]/u);
  if (
    parts.length !== 3
    || parts[0] !== profile
    || parts[1] !== taskId
    || parts.some((part) => !SAFE_ID.test(part) || part.length > 120)
  ) {
    throw new Error('Run directory does not match profile/task/run-id layout.');
  }
  let source: Buffer;
  let normalized: Buffer;
  let outputBytes: Buffer;
  let evidenceBytes: Buffer;
  try {
    [source, normalized, outputBytes, evidenceBytes] = await Promise.all([
      readFile(resolve(directory, 'source.png')),
      readFile(resolve(directory, 'normalized.png')),
      readFile(resolve(directory, 'output.json')),
      readFile(resolve(directory, 'evidence.json')),
    ]);
  } catch {
    throw new Error('Run directory is incomplete.');
  }
  const output = parseJsonRecord(
    outputBytes,
    'Production-art output',
  ) as unknown as ProductionArtOutput;
  const evidence = parseJsonRecord(
    evidenceBytes,
    'Production-art evidence',
  ) as unknown as ProductionArtGenerationEvidence;
  const sourceSha256 = digestBytes(source);
  const normalizedSha256 = digestBytes(normalized);
  assertValidProductionArtOutput(output, plan);
  if (
    output.plan_id !== plan.plan_id
    || output.profile !== profile
    || output.task_id !== taskId
    || output.sha256 !== normalizedSha256
    || output.bytes !== normalized.byteLength
    || evidence.plan_id !== plan.plan_id
    || evidence.profile !== profile
    || evidence.task_id !== taskId
    || evidence.source.sha256 !== sourceSha256
    || evidence.source.bytes !== source.byteLength
    || evidence.normalized.sha256 !== normalizedSha256
    || evidence.normalized.bytes !== normalized.byteLength
  ) {
    throw new Error('Run directory hashes or task bindings are invalid.');
  }
  const artifact: ProductionArtWorkflowArtifact = {
    run_directory: relative(
      privateOutputRoot ? root : process.cwd(),
      directory,
    ).replaceAll('\\', '/'),
    source_sha256: sourceSha256,
    normalized_sha256: normalizedSha256,
  };
  if (output.roles.length === 1 && output.roles[0] === 'character.player.atlas') {
    let atlasBytes: Buffer;
    let revisionBytes: Buffer;
    let projectionBytes: Buffer;
    try {
      [atlasBytes, revisionBytes, projectionBytes] = await Promise.all([
        readFile(resolve(directory, 'character-profile-atlas.png')),
        readFile(resolve(directory, 'character-profile-revision.json')),
        readFile(resolve(directory, 'character-profile-projection.json')),
      ]);
    } catch {
      if (allowProjectionRejected) {
        let rejection: Record<string, unknown> | undefined;
        for (const filename of [
          'character-profile-projection-rejection.json',
          'projection-rejection.json',
        ]) {
          try {
            rejection = parseJsonRecord(
              await readFile(resolve(directory, filename)),
              'Character projection rejection',
            );
            break;
          } catch {
            // Try the other bounded, fixed rejection filename.
          }
        }
        if (
          rejection
          && rejection.profile === profile
          && rejection.task_id === taskId
          && typeof rejection.code === 'string'
        ) {
          return artifact;
        }
      }
      throw new Error('Player task is missing its portable character profile files.');
    }
    const revisionRecord = parseJsonRecord(
      revisionBytes,
      'Character profile revision',
    );
    const projection = parseJsonRecord(
      projectionBytes,
      'Character profile projection',
    ) as unknown as ProductionCharacterProfileProjectionRecord;
    const revision = materializeCharacterProfileRevision(revisionRecord);
    const revisionSha256 = await fingerprintCharacterProfileRevision(revision);
    const atlasSha256 = digestBytes(atlasBytes);
    if (
      revision.profile !== profile
      || revision.character_id !== expectedCharacterId
      || revision.atlas.path !== 'character-profile-atlas.png'
      || revision.atlas.bytes !== atlasBytes.byteLength
      || revision.atlas.sha256 !== atlasSha256
      || projection.profile !== profile
      || projection.plan_id !== plan.plan_id
      || projection.task_id !== taskId
      || projection.character_id !== expectedCharacterId
      || projection.profile_revision_id !== revision.profile_revision_id
      || projection.profile_revision_sha256 !== revisionSha256
      || projection.source.normalized_sha256 !== normalizedSha256
      || projection.atlas.bytes !== atlasBytes.byteLength
      || projection.atlas.sha256 !== atlasSha256
    ) {
      throw new Error('Portable character profile files do not match the player task.');
    }
    return {
      ...artifact,
      character_profile: {
        profile_revision_id: revision.profile_revision_id,
        profile_revision_sha256: revisionSha256,
        atlas_sha256: atlasSha256,
      },
    };
  }
  return artifact;
}

function interruptedTask(state: ProductionArtWorkflowState):
{ readonly taskId: string; readonly attempt: number } | undefined {
  const task = state.tasks.find(({ status }) => status === 'running');
  const attempt = task?.attempts.at(-1);
  return task && attempt
    ? { taskId: task.task_id, attempt: attempt.attempt }
    : undefined;
}

async function writeRunSet(
  directory: string,
  state: ProductionArtWorkflowState,
  plan: ProductionArtPlan,
  privateOutputRoot?: string,
): Promise<string | undefined> {
  if (!state.tasks.every(({ status }) => status === 'succeeded')) return undefined;
  const runs = Object.fromEntries(state.tasks.map((task) => {
    const runDirectory = task.attempts.at(-1)?.artifact?.run_directory;
    if (!runDirectory) throw new Error('Successful workflow task has no frozen run directory.');
    const absoluteRunDirectory = privateOutputRoot
      ? resolve(privateOutputRoot, 'model-runs', runDirectory)
      : resolve(runDirectory);
    return [
      task.task_id,
      relative(directory, absoluteRunDirectory).replaceAll('\\', '/'),
    ];
  }));
  const runSet = createProductionArtRunSet(plan, runs);
  const path = resolve(directory, 'production-art-run-set.json');
  const text = `${JSON.stringify(runSet, null, 2)}\n`;
  try {
    await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
  } catch {
    const existing = await readFile(path, 'utf8');
    if (existing !== text) {
      throw new Error('Existing production-art run-set differs from completed workflow.');
    }
  }
  return relative(process.cwd(), path).replaceAll('\\', '/');
}

function workflowSummary(
  state: ProductionArtWorkflowState,
  plan: ReturnType<typeof createProductionArtPlan>,
  approvedDirectionSha256: string | undefined,
  mode: 'dry-run' | 'executed' | 'reconciled',
  runSet?: string,
): object {
  const selection = selectNextProductionArtWorkflowTask(
    state,
    plan,
    approvedDirectionSha256,
  );
  const progress = createProductionArtProgress(
    state,
    plan,
    approvedDirectionSha256,
  );
  const characterProfile = state.tasks
    .flatMap(({ attempts }) => attempts)
    .map(({ artifact }) => artifact?.character_profile)
    .find((candidate) => candidate !== undefined);
  return {
    status: selection.phase,
    mode,
    remote_request_count_this_invocation: mode === 'executed'
      ? undefined
      : 0,
    workflow_id: state.workflow_id,
    profile: state.profile,
    state_revision: state.state_revision,
    request_budget: state.request_budget,
    requests_started: state.requests_started,
    requests_remaining: state.request_budget - state.requests_started,
    completed_tasks: state.tasks.filter(({ status }) => status === 'succeeded').length,
    rejected_tasks: state.tasks.filter(({ status }) => status === 'rejected').length,
    uncertain_tasks: state.tasks.filter(({ status }) => status === 'uncertain').length,
    total_tasks: state.tasks.length,
    ...(selection.task_id ? { next_task: selection.task_id } : {}),
    ...(runSet ? { run_set: runSet } : {}),
    ...(characterProfile ? { character_profile: characterProfile } : {}),
    progress,
    human_review: 'required',
    distribution: 'internal-review',
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const job = await readJob(args.job!);
  const plan = createProductionArtPlan(job.profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const [
    worldBrief,
    styleBible,
    environmentReference,
    characterReference,
    approvedDirection,
  ] = await Promise.all([
    readBoundedText(job.world_brief_file, 'World brief', 2_000),
    readBoundedText(job.style_bible_file, 'Style bible', 4_000),
    readBoundedBinary(job.environment_reference, 'Environment reference'),
    readBoundedBinary(job.character_reference, 'Character reference'),
    job.approved_direction
      ? readBoundedBinary(job.approved_direction, 'Approved direction')
      : undefined,
  ]);
  const inputBindingSha256 = privateInputBinding({
    job,
    worldBrief,
    styleBible,
    environmentReference,
    characterReference,
  });
  const approvedDirectionSha256 = approvedDirection
    ? digestBytes(approvedDirection)
    : undefined;
  const workflowRoot = job.private_output_root
    ? resolve(job.private_output_root, 'workflows')
    : resolve(WORKFLOW_ROOT);
  const directory = safeWorkflowDirectory(workflowRoot, job.profile, job.workflow_id);
  const releaseLock = await acquireWorkflowLock(directory);
  try {
    let state = await readLatestState(directory, plan)
      ?? createProductionArtWorkflowState({
        workflowId: job.workflow_id,
        plan,
        provider: {
          id: OPENAI_PRODUCTION_ART_PROVIDER_ID,
          model: OPENAI_PRODUCTION_ART_MODEL,
          quality: job.quality,
        },
        inputBindingSha256,
        requestBudget: job.request_budget,
      });
    assertStateMatchesJob(state, job, inputBindingSha256);
    if (state.state_revision === 0) await persistState(directory, state);

    const interrupted = interruptedTask(state);
    if (interrupted) {
      state = completeProductionArtWorkflowTask(state, plan, {
        expectedStateRevision: state.state_revision,
        taskId: interrupted.taskId,
        attempt: interrupted.attempt,
        outcome: 'uncertain',
        errorCode: 'task.process-interrupted',
      });
      await persistState(directory, state);
    }

    if (args.reconcileTask && args.runDirectory) {
      const artifact = await verifyRunDirectory(
        job.profile,
        plan,
        args.reconcileTask,
        args.runDirectory,
        job.character_id,
        false,
        job.private_output_root,
      );
      state = reconcileProductionArtWorkflowTask(state, plan, {
        expectedStateRevision: state.state_revision,
        taskId: args.reconcileTask,
        artifact,
      });
      await persistState(directory, state);
      const runSet = await writeRunSet(directory, state, plan, job.private_output_root);
      console.log(JSON.stringify(workflowSummary(
        state,
        plan,
        approvedDirectionSha256,
        'reconciled',
        runSet,
      ), null, 2));
      return;
    }

    if (!args.execute) {
      const runSet = await writeRunSet(directory, state, plan, job.private_output_root);
      console.log(JSON.stringify(workflowSummary(
        state,
        plan,
        approvedDirectionSha256,
        'dry-run',
        runSet,
      ), null, 2));
      return;
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required only for --execute.');
    }

    let requestsThisInvocation = 0;
    while (requestsThisInvocation < args.maxRequests) {
      const selectedTaskId = args.retryTask
        ? args.retryTask
        : selectNextProductionArtWorkflowTask(
          state,
          plan,
          approvedDirectionSha256,
        ).task_id;
      if (!selectedTaskId) break;
      const task = plan.tasks.find(({ task_id: taskId }) => taskId === selectedTaskId);
      if (!task) throw new Error('Selected workflow task is not in the canonical plan.');
      state = beginProductionArtWorkflowTask(state, plan, {
        expectedStateRevision: state.state_revision,
        taskId: selectedTaskId,
        ...(selectedTaskId === 'scene-direction'
          ? {}
          : { approvedDirectionSha256 }),
        ...(args.retryTask
          ? { acknowledgeDuplicateCostRisk: args.acknowledgeDuplicateCostRisk }
          : {}),
      });
      await persistState(directory, state);
      const attempt = state.tasks
        .find(({ task_id: taskId }) => taskId === selectedTaskId)!
        .attempts.at(-1)!.attempt;
      const result = await runTaskProcess(job, task);
      requestsThisInvocation += 1;
      try {
        const summary = parseTaskSummary(result.stdout);
        if (
          summary.profile !== job.profile
          || summary.task_id !== selectedTaskId
          || ![0, 2].includes(result.exitCode ?? -1)
        ) {
          throw new Error('Task runner result does not match the scheduled task.');
        }
        const artifact = await verifyRunDirectory(
          job.profile,
          plan,
          selectedTaskId,
          summary.output_directory,
          job.character_id,
          result.exitCode === 2
            || summary.status === 'candidate-written-projection-rejected',
          job.private_output_root,
        );
        if (
          artifact.source_sha256 !== summary.source_sha256
          || artifact.normalized_sha256 !== summary.normalized_sha256
        ) {
          throw new Error('Task runner summary does not match its frozen files.');
        }
        const rejected = result.exitCode === 2
          || summary.status === 'candidate-written-projection-rejected';
        state = completeProductionArtWorkflowTask(state, plan, {
          expectedStateRevision: state.state_revision,
          taskId: selectedTaskId,
          attempt,
          outcome: rejected ? 'rejected' : 'succeeded',
          artifact,
          ...(rejected ? {
            errorCode: summary.character_profile_projection_error_code
              ?? summary.pack10_projection_error_code
              ?? 'task.projection-rejected',
          } : {}),
        });
      } catch {
        state = completeProductionArtWorkflowTask(state, plan, {
          expectedStateRevision: state.state_revision,
          taskId: selectedTaskId,
          attempt,
          outcome: 'uncertain',
          errorCode: result.exitCode === null
            ? 'task.process-interrupted'
            : 'task.result-unverified',
        });
      }
      await persistState(directory, state);
      if (args.retryTask) break;
      if (state.tasks.some(({ status }) => status === 'rejected' || status === 'uncertain')) {
        break;
      }
    }
    const runSet = await writeRunSet(directory, state, plan, job.private_output_root);
    const summary = workflowSummary(
      state,
      plan,
      approvedDirectionSha256,
      'executed',
      runSet,
    ) as Record<string, unknown>;
    summary.remote_request_count_this_invocation = requestsThisInvocation;
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await releaseLock();
  }
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : 'Production-art workflow failed.';
  console.error(`MAPSOO_PRODUCTION_ART_WORKFLOW_ERROR ${message}`);
  process.exitCode = 1;
});
