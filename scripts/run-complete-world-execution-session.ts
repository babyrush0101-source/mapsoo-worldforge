import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import {
  runCompleteWorldExecutionSession,
  type CompleteWorldWorkflowInvocation,
  type CompleteWorldWorkflowInvocationResult,
} from '../src/app/complete-world-execution-session';
import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

interface Arguments {
  readonly help: boolean;
  readonly execute: boolean;
  readonly job?: string;
  readonly authorizationSha256?: string;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — complete-world production-art execution session',
    '',
    'Preview the exact task inventory and maximum paid request count:',
    '  pnpm production-art:world-session -- --job <private-workflow.json>',
    '',
    'Execute the exact preview after explicit authorization:',
    '  pnpm production-art:world-session -- --job <private-workflow.json> \\',
    '    --execute --authorize-session-sha256 <preview.authorization_sha256>',
    '',
    'Safety:',
    '  - dry-run is the default and starts zero remote requests;',
    '  - each paid task runs through the existing journal with exact revision/task guards;',
    '  - the scene-direction round is always a separate one-request session;',
    '  - downstream tasks require the exact human-approved scene-direction bytes;',
    '  - rejected, uncertain, interrupted, or divergent work stops immediately;',
    '  - this session never retries a task;',
    '  - receipts contain neutral ids and digests, not prompts, source paths, credentials, or provider responses.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Arguments {
  let job: string | undefined;
  let authorizationSha256: string | undefined;
  let execute = false;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      if (help) throw new Error('Duplicate --help flag.');
      help = true;
      continue;
    }
    if (argument === '--execute') {
      if (execute) throw new Error('Duplicate --execute flag.');
      execute = true;
      continue;
    }
    if (
      argument !== '--job'
      && argument !== '--authorize-session-sha256'
    ) {
      throw new Error(`Unknown flag: ${argument}.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    if (argument === '--job') {
      if (job) throw new Error('Duplicate --job flag.');
      job = value;
    } else {
      if (authorizationSha256) {
        throw new Error('Duplicate --authorize-session-sha256 flag.');
      }
      authorizationSha256 = value;
    }
    index += 1;
  }
  if (help) return { help, execute };
  if (!job) throw new Error('--job is required.');
  if (
    execute
    && (
      !authorizationSha256
      || !SHA256.test(authorizationSha256)
    )
  ) {
    throw new Error(
      '--execute requires the exact lowercase preview authorization SHA-256.',
    );
  }
  if (!execute && authorizationSha256) {
    throw new Error(
      '--authorize-session-sha256 is accepted only with --execute.',
    );
  }
  return {
    help,
    execute,
    job,
    ...(authorizationSha256 ? { authorizationSha256 } : {}),
  };
}

function runWorkflow(
  job: string,
  invocation: CompleteWorldWorkflowInvocation,
): Promise<CompleteWorldWorkflowInvocationResult> {
  const viteNode = resolve('node_modules/vite-node/vite-node.mjs');
  const workflow = resolve('scripts/run-production-art-workflow.ts');
  const childArguments = [viteNode, workflow, '--job', job];
  if (invocation.execute) {
    if (
      invocation.expectedStateRevision === undefined
      || !invocation.expectedNextTaskId
    ) {
      throw new Error('Executable workflow invocation requires exact guards.');
    }
    childArguments.push(
      '--execute',
      '--allow-remote-upload',
      '--max-requests',
      '1',
      '--expected-state-revision',
      String(invocation.expectedStateRevision),
      '--expected-next-task',
      invocation.expectedNextTaskId,
    );
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, childArguments, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const collect = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (outputBytes > MAX_OUTPUT_BYTES) {
        reject(new Error('Workflow child output exceeded 2 MiB.'));
        return;
      }
      if (exitCode !== 0) {
        const message = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(
          message.length > 0
            ? `Workflow child stopped: ${message}`
            : 'Workflow child stopped before producing a verified summary.',
        ));
        return;
      }
      const text = Buffer.concat(stdout).toString('utf8');
      const parsed = parseStrictJsonDocument(text, 'Workflow child summary');
      if (
        !parsed.ok
        || typeof parsed.value !== 'object'
        || parsed.value === null
        || Array.isArray(parsed.value)
        || !('execution_snapshot' in parsed.value)
        || !('remote_request_count_this_invocation' in parsed.value)
        || !Number.isSafeInteger(
          parsed.value.remote_request_count_this_invocation,
        )
      ) {
        reject(new Error('Workflow child summary is invalid.'));
        return;
      }
      resolvePromise({
        execution_snapshot: parsed.value.execution_snapshot,
        remote_request_count_this_invocation:
          parsed.value.remote_request_count_this_invocation as number,
      });
    });
  });
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const result = await runCompleteWorldExecutionSession(
    {
      execute: args.execute,
      ...(args.authorizationSha256
        ? { authorizationSha256: args.authorizationSha256 }
        : {}),
    },
    (invocation) => runWorkflow(args.job!, invocation),
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error
    ? error.message
    : 'Complete-world execution session failed.';
  console.error(`MAPSOO_COMPLETE_WORLD_SESSION_ERROR ${message}`);
  process.exitCode = 1;
});
