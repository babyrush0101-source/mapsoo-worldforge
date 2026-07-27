import { createHash, randomBytes } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';

const repository = process.cwd();
const viteNode = resolve('node_modules/vite-node/vite-node.mjs');
const runner = resolve('scripts/run-production-art-workflow.ts');
const workflowRoot = resolve('docs/visual-qa/production-art/workflows');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'mapsoo-production-workflow-'));
const workflowId = `workflow-cli-smoke-${randomBytes(6).toString('hex')}`;
const workflowDirectory = resolve(workflowRoot, 'layered-depth-2d', workflowId);
if (!workflowDirectory.startsWith(`${workflowRoot}${sep}`)) {
  throw new Error('Workflow smoke directory escaped its fixed ignored root.');
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseSingleJson(text, label) {
  try {
    return JSON.parse(text.trim());
  } catch {
    throw new Error(`${label} did not return one JSON document.`);
  }
}

async function run(args, environment = {}) {
  const child = spawn(process.execPath, [viteNode, runner, ...args], {
    cwd: repository,
    env: { ...process.env, ...environment },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const exitCode = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', accept);
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

const briefPath = resolve(temporaryRoot, 'private-brief.txt');
const stylePath = resolve(temporaryRoot, 'private-style.txt');
const environmentPath = resolve(temporaryRoot, 'private-environment.bin');
const characterPath = resolve(temporaryRoot, 'private-character.bin');
const jobPath = resolve(temporaryRoot, 'private-workflow.json');
const duplicateJobPath = resolve(temporaryRoot, 'duplicate-workflow.json');
const brief = 'A quiet neutral harbor with original architecture.';
const style = 'Original limited palette, readable silhouettes, no named-game imitation.';
const environment = Buffer.from('89504e470d0a1a0a', 'hex');
const character = Buffer.from('ffd8ffe000104a46', 'hex');
const job = {
  schema_version: '1.0.0',
  document_type: 'production-art-workflow-job',
  workflow_id: workflowId,
  profile: 'layered-depth-2d',
  quality: 'medium',
  request_budget: 14,
  world_brief_file: briefPath,
  style_bible_file: stylePath,
  environment_reference: environmentPath,
  character_reference: characterPath,
  character_id: 'neutral-traveler',
};

try {
  await Promise.all([
    writeFile(briefPath, brief, { encoding: 'utf8', flag: 'wx' }),
    writeFile(stylePath, style, { encoding: 'utf8', flag: 'wx' }),
    writeFile(environmentPath, environment, { flag: 'wx' }),
    writeFile(characterPath, character, { flag: 'wx' }),
    writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    }),
    writeFile(
      duplicateJobPath,
      `${JSON.stringify(job).replace(
        '"workflow_id":',
        `"workflow_id":"${workflowId}","workflow_id":`,
      )}\n`,
      { encoding: 'utf8', flag: 'wx' },
    ),
  ]);

  const first = await run(['--job', jobPath], { OPENAI_API_KEY: 'must-not-be-used' });
  if (first.exitCode !== 0) throw new Error(`Dry-run failed: ${first.stderr}`);
  const firstSummary = parseSingleJson(first.stdout, 'Workflow dry-run');
  if (
    firstSummary.status !== 'ready'
    || firstSummary.mode !== 'dry-run'
    || firstSummary.next_task !== 'scene-direction'
    || firstSummary.requests_started !== 0
    || firstSummary.remote_request_count_this_invocation !== 0
    || firstSummary.total_tasks !== 14
    || firstSummary.progress?.document_type !== 'production-art-progress'
    || firstSummary.progress?.next_action !== 'generate-scene-direction'
    || firstSummary.progress?.coverage?.total_tasks !== 14
    || firstSummary.progress?.coverage?.succeeded_tasks !== 0
    || firstSummary.progress?.run_set_ready !== false
    || firstSummary.progress?.production_review_required !== true
    || firstSummary.progress?.runtime_verified !== false
    || firstSummary.progress?.runner_delivery_ready !== false
  ) {
    throw new Error('Dry-run did not initialize the canonical no-cost workflow.');
  }

  const statePath = resolve(workflowDirectory, 'state-000000.json');
  const stateText = await readFile(statePath, 'utf8');
  const forbidden = [
    temporaryRoot,
    temporaryRoot.replaceAll('\\', '/'),
    brief,
    style,
    'private-brief.txt',
    'private-style.txt',
    'private-environment.bin',
    'private-character.bin',
    digest(environment),
    digest(character),
    'must-not-be-used',
  ];
  if (forbidden.some((token) => stateText.includes(token))) {
    throw new Error('Workflow state exposed a private source value, path, digest, or key.');
  }

  const second = await run(['--job', jobPath]);
  if (second.exitCode !== 0) throw new Error(`Idempotent dry-run failed: ${second.stderr}`);
  const secondSummary = parseSingleJson(second.stdout, 'Second workflow dry-run');
  if (secondSummary.state_revision !== 0 || secondSummary.requests_started !== 0) {
    throw new Error('An idempotent dry-run mutated request accounting.');
  }

  await writeFile(briefPath, `${brief} Changed.`, 'utf8');
  const changed = await run(['--job', jobPath]);
  if (
    changed.exitCode === 0
    || !changed.stderr.includes('immutable state')
  ) {
    throw new Error('Changed private inputs did not fail closed under the same workflow id.');
  }
  await writeFile(briefPath, brief, 'utf8');

  const duplicate = await run(['--job', duplicateJobPath]);
  if (
    duplicate.exitCode === 0
    || !duplicate.stderr.includes('repeats the object key')
  ) {
    throw new Error('Duplicate workflow-job JSON keys were not rejected.');
  }

  const missingApproval = await run(['--job', jobPath, '--execute'], {
    OPENAI_API_KEY: '',
  });
  if (
    missingApproval.exitCode === 0
    || !missingApproval.stderr.includes(
      '--execute and --allow-remote-upload must be supplied together',
    )
  ) {
    throw new Error('Remote execution did not require its paired upload authorization.');
  }

  const noCredential = await run([
    '--job',
    jobPath,
    '--execute',
    '--allow-remote-upload',
  ], { OPENAI_API_KEY: '' });
  if (
    noCredential.exitCode === 0
    || !noCredential.stderr.includes('OPENAI_API_KEY is required')
  ) {
    throw new Error('Remote execution did not stop before scheduling without a credential.');
  }
  const afterNoCredential = JSON.parse(await readFile(statePath, 'utf8'));
  if (afterNoCredential.requests_started !== 0) {
    throw new Error('Credential preflight consumed remote request budget.');
  }

  const lockPath = resolve(workflowDirectory, '.workflow.lock');
  await mkdir(workflowDirectory, { recursive: true });
  await writeFile(lockPath, '{"pid":0}\n', { encoding: 'utf8', flag: 'wx' });
  const locked = await run(['--job', jobPath]);
  if (
    locked.exitCode === 0
    || !locked.stderr.includes('already active or has a stale lock')
  ) {
    throw new Error('Concurrent or stale workflow lock was not rejected.');
  }
  await rm(lockPath, { force: true });

  console.log(
    'MAPSOO_PRODUCTION_ART_WORKFLOW_OK dry_run=true private_state=true '
    + 'duplicate_keys=true immutable_inputs=true budget_preflight=true lock=true '
    + 'progress_contract=true',
  );
} finally {
  await rm(workflowDirectory, { recursive: true, force: true });
  await rm(temporaryRoot, { recursive: true, force: true });
}
