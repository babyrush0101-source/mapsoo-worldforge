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
  SPRITECOOK_DEFAULT_MODEL,
  SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
  type SpriteCookProductionArtResolution,
} from '../src/adapters/spritecook/spritecook-production-art-provider';
import {
  assertValidProductionArtOutput,
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtTask,
} from '../src/core/production-art-contract';
import {
  materializeProductionArtPlanV1_1,
  serializeCanonicalProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../src/core/production-art-contract-v1-1';
import {
  materializeProductionArtOutputV1_1,
  type ProductionArtOutputV1_1,
} from '../src/core/production-art-output-v1-1';
import {
  beginProductionArtWorkflowTask,
  completeProductionArtWorkflowTask,
  createProductionArtWorkflowState,
  parseProductionArtWorkflowState,
  reconcileProductionArtWorkflowTask,
  selectNextProductionArtWorkflowTask,
  type ProductionArtWorkflowArtifact,
  type ProductionArtWorkflowQuality,
  type ProductionArtPrivateInputBinding,
  type ProductionArtWorkflowPlan,
  type ProductionArtWorkflowPlanTask,
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
import {
  buildProductionArtRunSetV1_1,
} from '../src/core/production-art-run-set-v1-1';
import {
  fingerprintWorldLayoutPlan,
  materializeWorldLayoutPlan,
  serializeCanonicalWorldLayoutPlan,
} from '../src/core/world-layout-plan';
import {
  materializeCharacterIdentitySemantics,
  serializeCharacterIdentitySemanticsCanonical,
} from '../src/core/character-identity-semantics';
import {
  materializeAssetRequirements,
  serializeCanonicalAssetRequirements,
} from '../src/core/asset-requirements';
import {
  materializeAssetRequirementsV1_1,
  serializeCanonicalAssetRequirementsV1_1,
  type AssetRequirementsV1_1,
} from '../src/core/asset-requirements-v1-1';
import type {
  ProductionArtGenerationEvidenceV1_1,
} from '../src/adapters/normalize-production-art-png-v1-1';
import {
  materializeProductionArtRequirementsBinding,
  serializeCanonicalProductionArtRequirementsBinding,
  type ProductionArtRequirementsBinding,
} from '../src/core/production-art-requirements-binding';

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
  '--expected-state-revision',
  '--expected-next-task',
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
  readonly expectedStateRevision?: number;
  readonly expectedNextTask?: string;
  readonly retryTask?: string;
  readonly reconcileTask?: string;
  readonly runDirectory?: string;
}

interface WorkflowJob {
  readonly schema_version: '1.0.0' | '1.1.0';
  readonly document_type: 'production-art-workflow-job';
  readonly workflow_id: string;
  readonly profile: WorldAssetProfile;
  readonly provider?: 'openai' | 'spritecook';
  readonly model?: string;
  readonly resolution?: SpriteCookProductionArtResolution;
  readonly quality: ProductionArtWorkflowQuality;
  readonly request_budget: number;
  readonly world_brief_file: string;
  readonly style_bible_file: string;
  readonly character_identity_semantics_file?: string;
  readonly world_layout_plan_file?: string;
  readonly asset_requirements_file?: string;
  readonly production_art_plan_file?: string;
  readonly production_art_requirements_binding_file?: string;
  readonly environment_reference: string;
  readonly character_reference: string;
  readonly character_id: string;
  readonly private_input_binding: ProductionArtPrivateInputBinding;
  readonly approved_direction?: string;
  readonly private_output_root?: string;
}

interface TaskRunnerSummary {
  readonly status: 'candidate-written' | 'candidate-written-projection-rejected';
  readonly remote_request_count: number;
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
    '    --execute --allow-remote-upload --max-requests 1 \\',
    '    --expected-state-revision <integer> --expected-next-task <task-id>',
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
  const expectedStateRevisionValue = values.get('--expected-state-revision');
  if (
    expectedStateRevisionValue !== undefined
    && (
      !/^(?:0|[1-9]\d*)$/.test(expectedStateRevisionValue)
      || !Number.isSafeInteger(Number(expectedStateRevisionValue))
    )
  ) {
    throw new Error('--expected-state-revision must be a safe non-negative integer.');
  }
  const expectedNextTaskValue = values.get('--expected-next-task');
  if (
    expectedNextTaskValue !== undefined
    && (
      expectedNextTaskValue.length > 100
      || !SAFE_ID.test(expectedNextTaskValue)
    )
  ) {
    throw new Error('--expected-next-task must be a safe task id.');
  }
  const args: Arguments = {
    help: booleans.has('--help'),
    execute: booleans.has('--execute'),
    allowRemoteUpload: booleans.has('--allow-remote-upload'),
    acknowledgeDuplicateCostRisk:
      booleans.has('--acknowledge-duplicate-cost-risk'),
    maxRequests: Number(maxRequestsValue),
    ...(expectedStateRevisionValue !== undefined
      ? { expectedStateRevision: Number(expectedStateRevisionValue) }
      : {}),
    ...(expectedNextTaskValue !== undefined
      ? { expectedNextTask: expectedNextTaskValue }
      : {}),
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
  if (
    (args.expectedStateRevision === undefined)
    !== (args.expectedNextTask === undefined)
  ) {
    throw new Error(
      '--expected-state-revision and --expected-next-task must be supplied together.',
    );
  }
  if (args.expectedStateRevision !== undefined && !args.execute) {
    throw new Error('Expected workflow state guards require --execute.');
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
  const hasWorldLayoutPlan = Object.prototype.hasOwnProperty.call(
    value,
    'world_layout_plan_file',
  );
  const hasAssetRequirements = Object.prototype.hasOwnProperty.call(
    value,
    'asset_requirements_file',
  );
  const hasProductionArtPlan = Object.prototype.hasOwnProperty.call(
    value,
    'production_art_plan_file',
  );
  const hasProductionArtRequirementsBinding =
    Object.prototype.hasOwnProperty.call(
      value,
      'production_art_requirements_binding_file',
    );
  const hasCharacterIdentitySemantics = Object.prototype.hasOwnProperty.call(
    value,
    'character_identity_semantics_file',
  );
  const hasProvider = Object.prototype.hasOwnProperty.call(value, 'provider');
  const hasModel = Object.prototype.hasOwnProperty.call(value, 'model');
  const hasResolution = Object.prototype.hasOwnProperty.call(
    value,
    'resolution',
  );
  if (
    !exactKeys(value, [
      'character_id',
      'character_reference',
      'document_type',
      'environment_reference',
      'profile',
      'private_input_binding',
      'quality',
      'request_budget',
      'schema_version',
      'style_bible_file',
      'workflow_id',
      'world_brief_file',
      ...(hasProvider ? ['provider'] : []),
      ...(hasModel ? ['model'] : []),
      ...(hasResolution ? ['resolution'] : []),
      ...(hasCharacterIdentitySemantics
        ? ['character_identity_semantics_file']
        : []),
      ...(hasWorldLayoutPlan ? ['world_layout_plan_file'] : []),
      ...(hasAssetRequirements ? ['asset_requirements_file'] : []),
      ...(hasProductionArtPlan ? ['production_art_plan_file'] : []),
      ...(hasProductionArtRequirementsBinding
        ? ['production_art_requirements_binding_file']
        : []),
      ...(hasApprovedDirection ? ['approved_direction'] : []),
      ...(hasPrivateOutputRoot ? ['private_output_root'] : []),
    ])
    || !['1.0.0', '1.1.0'].includes(value.schema_version as string)
    || value.document_type !== 'production-art-workflow-job'
    || typeof value.workflow_id !== 'string'
    || value.workflow_id.length > 80
    || !SAFE_ID.test(value.workflow_id)
    || !WORLD_ASSET_PROFILES.includes(value.profile as WorldAssetProfile)
    || (
      hasProvider
      && !['openai', 'spritecook'].includes(value.provider as string)
    )
    || (
      (value.provider ?? 'openai') === 'openai'
      && (hasModel || hasResolution)
    )
    || (
      hasModel
      && (
        typeof value.model !== 'string'
        || value.model.length < 1
        || value.model.length > 80
        || !/^[a-z0-9][a-z0-9._-]*$/.test(value.model)
      )
    )
    || (
      hasResolution
      && !['1K', '2K', '4K'].includes(value.resolution as string)
    )
    || !['low', 'medium', 'high'].includes(value.quality as string)
    || !Number.isSafeInteger(value.request_budget)
    || (value.request_budget as number) < 1
    || (value.request_budget as number) > 64
    || !safePathValue(value.world_brief_file)
    || !safePathValue(value.style_bible_file)
    || (
      hasCharacterIdentitySemantics
      && !safePathValue(value.character_identity_semantics_file)
    )
    || (hasWorldLayoutPlan && !safePathValue(value.world_layout_plan_file))
    || hasAssetRequirements !== hasProductionArtRequirementsBinding
      && value.schema_version === '1.0.0'
    || (
      value.schema_version === '1.1.0'
      && (
        !hasAssetRequirements
        || !hasProductionArtPlan
        || hasProductionArtRequirementsBinding
      )
    )
    || (
      value.schema_version === '1.0.0'
      && hasProductionArtPlan
    )
    || (hasAssetRequirements && !hasWorldLayoutPlan)
    || (
      hasAssetRequirements
      && !safePathValue(value.asset_requirements_file)
    )
    || (
      hasProductionArtPlan
      && !safePathValue(value.production_art_plan_file)
    )
    || (
      hasProductionArtRequirementsBinding
      && !safePathValue(value.production_art_requirements_binding_file)
    )
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
    || !isPlainObject(value.private_input_binding)
    || !exactKeys(value.private_input_binding, [
      'character_identity_digest_sha256',
      'character_reference_id',
      'confirmed_intake_sha256',
      'environment_reference_id',
      'seed',
    ])
    || typeof value.private_input_binding.confirmed_intake_sha256 !== 'string'
    || !SAFE_SHA256.test(value.private_input_binding.confirmed_intake_sha256)
    || typeof value.private_input_binding.character_identity_digest_sha256 !== 'string'
    || !SAFE_SHA256.test(value.private_input_binding.character_identity_digest_sha256)
    || typeof value.private_input_binding.seed !== 'string'
    || value.private_input_binding.seed.length < 1
    || value.private_input_binding.seed.length > 160
    || value.private_input_binding.seed.trim() !== value.private_input_binding.seed
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value.private_input_binding.seed)
    || typeof value.private_input_binding.environment_reference_id !== 'string'
    || value.private_input_binding.environment_reference_id.length > 80
    || !SAFE_ID.test(value.private_input_binding.environment_reference_id)
    || typeof value.private_input_binding.character_reference_id !== 'string'
    || value.private_input_binding.character_reference_id.length > 80
    || !SAFE_ID.test(value.private_input_binding.character_reference_id)
    || value.private_input_binding.environment_reference_id
      === value.private_input_binding.character_reference_id
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
  readonly characterIdentitySemantics?: Uint8Array;
  readonly worldLayoutPlan?: Uint8Array;
  readonly assetRequirements?: Uint8Array;
  readonly productionArtPlan?: Uint8Array;
  readonly productionArtRequirementsBinding?: Uint8Array;
  readonly environmentReference: Uint8Array;
  readonly characterReference: Uint8Array;
}): string {
  const hash = createHash('sha256');
  const fields: readonly [string, string | Uint8Array][] = [
    ['schema', 'production-art-private-input-binding-v1'],
    ['profile', input.job.profile],
    ['provider', input.job.provider ?? 'openai'],
    [
      'model',
      input.job.provider === 'spritecook'
        ? input.job.model ?? SPRITECOOK_DEFAULT_MODEL
        : OPENAI_PRODUCTION_ART_MODEL,
    ],
    ['resolution', input.job.provider === 'spritecook'
      ? input.job.resolution ?? '2K'
      : 'provider-default'],
    ['quality', input.job.quality],
    ['character-id', input.job.character_id],
    ['confirmed-intake-sha256', input.job.private_input_binding.confirmed_intake_sha256],
    ['seed', input.job.private_input_binding.seed],
    [
      'character-identity-digest-sha256',
      input.job.private_input_binding.character_identity_digest_sha256,
    ],
    [
      'environment-reference-id',
      input.job.private_input_binding.environment_reference_id,
    ],
    [
      'character-reference-id',
      input.job.private_input_binding.character_reference_id,
    ],
    ['world-brief', input.worldBrief],
    ['style-bible', input.styleBible],
    ...(input.characterIdentitySemantics
      ? [[
        'character-identity-semantics',
        input.characterIdentitySemantics,
      ] as const]
      : []),
    ...(input.worldLayoutPlan
      ? [['world-layout-plan', input.worldLayoutPlan] as const]
      : []),
    ...(input.assetRequirements
      ? [['asset-requirements', input.assetRequirements] as const]
      : []),
    ...(input.productionArtPlan
      ? [['production-art-plan', input.productionArtPlan] as const]
      : []),
    ...(input.productionArtRequirementsBinding
      ? [[
        'production-art-requirements-binding',
        input.productionArtRequirementsBinding,
      ] as const]
      : []),
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
  plan: ProductionArtWorkflowPlan,
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

function workflowProvider(job: WorkflowJob): {
  readonly choice: 'openai' | 'spritecook';
  readonly id: string;
  readonly model: string;
  readonly credentialName: 'OPENAI_API_KEY' | 'SPRITECOOK_API_KEY';
} {
  if (job.provider === 'spritecook') {
    return Object.freeze({
      choice: 'spritecook',
      id: SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
      model: job.model ?? SPRITECOOK_DEFAULT_MODEL,
      credentialName: 'SPRITECOOK_API_KEY',
    });
  }
  return Object.freeze({
    choice: 'openai',
    id: OPENAI_PRODUCTION_ART_PROVIDER_ID,
    model: OPENAI_PRODUCTION_ART_MODEL,
    credentialName: 'OPENAI_API_KEY',
  });
}

function assertStateMatchesJob(
  state: ProductionArtWorkflowState,
  job: WorkflowJob,
  inputBindingSha256: string,
): void {
  const provider = workflowProvider(job);
  if (
    state.workflow_id !== job.workflow_id
    || state.profile !== job.profile
    || state.provider.id !== provider.id
    || state.provider.model !== provider.model
    || state.provider.quality !== job.quality
    || state.request_budget !== job.request_budget
    || state.input_binding_sha256 !== inputBindingSha256
    || state.private_input_binding.confirmed_intake_sha256
      !== job.private_input_binding.confirmed_intake_sha256
    || state.private_input_binding.seed !== job.private_input_binding.seed
    || state.private_input_binding.character_identity_digest_sha256
      !== job.private_input_binding.character_identity_digest_sha256
    || state.private_input_binding.environment_reference_id
      !== job.private_input_binding.environment_reference_id
    || state.private_input_binding.character_reference_id
      !== job.private_input_binding.character_reference_id
  ) {
    throw new Error(
      'Workflow job no longer matches its immutable state; create a new workflow id for changed inputs.',
    );
  }
}

function taskRoles(
  task: ProductionArtWorkflowPlanTask,
): readonly string[] {
  return 'role_mappings' in task
    ? task.role_mappings.map(({ role }) => role)
    : task.slot_mappings.map(({ role }) => role);
}

function isPlayerCharacterTask(task: ProductionArtWorkflowPlanTask): boolean {
  return task.kind === 'character-animation-sheet'
    && taskRoles(task).includes('character.player.atlas');
}

function taskArguments(
  job: WorkflowJob,
  task: ProductionArtWorkflowPlanTask,
): string[] {
  const values = [
    '--provider',
    job.provider ?? 'openai',
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
  if (
    job.schema_version === '1.1.0'
    && job.asset_requirements_file
    && job.production_art_plan_file
  ) {
    values.push(
      '--asset-requirements-file',
      job.asset_requirements_file,
      '--production-art-plan-file',
      job.production_art_plan_file,
    );
  }
  if (job.provider === 'spritecook') {
    if (job.model) values.push('--model', job.model);
    values.push('--resolution', job.resolution ?? '2K');
    if (job.private_output_root) {
      values.push(
        '--spritecook-asset-cache-root',
        resolve(
          job.private_output_root,
          'provider-cache',
          'spritecook',
          'v1',
        ),
      );
    }
  }
  if (task.task_id === 'scene-direction') {
    values.push(
      '--environment-reference',
      job.environment_reference,
      '--environment-reference-id',
      job.private_input_binding.environment_reference_id,
      '--character-reference',
      job.character_reference,
      '--character-reference-id',
      job.private_input_binding.character_reference_id,
    );
  } else {
    if (!job.approved_direction) {
      throw new Error(
        'A non-direction task requires the approved direction file in the workflow job.',
      );
    }
    values.push('--approved-direction', job.approved_direction!);
    if (task.reference_roles.includes('character')) {
      values.push(
        '--character-reference',
        job.character_reference,
        '--character-reference-id',
        job.private_input_binding.character_reference_id,
      );
    }
  }
  if (
    task.reference_roles.includes('character')
    && job.character_identity_semantics_file
  ) {
    values.push(
      '--character-identity-semantics-file',
      job.character_identity_semantics_file,
    );
  }
  if (isPlayerCharacterTask(task)) {
    values.push(
      '--character-id',
      job.character_id,
      '--character-identity-digest-sha256',
      job.private_input_binding.character_identity_digest_sha256,
    );
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
  task: ProductionArtWorkflowPlanTask,
): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const viteNode = resolve('node_modules/vite-node/vite-node.mjs');
  const runner = resolve('scripts/run-production-art-source.ts');
  const selectedProvider = workflowProvider(job);
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'NODE_ENV',
    'NODE_OPTIONS',
    'NO_COLOR',
    'FORCE_COLOR',
  ]) {
    if (process.env[name] !== undefined) {
      childEnvironment[name] = process.env[name];
    }
  }
  childEnvironment[selectedProvider.credentialName] =
    process.env[selectedProvider.credentialName];
  const child = spawn(process.execPath, [viteNode, runner, ...taskArguments(job, task)], {
    cwd: process.cwd(),
    env: childEnvironment,
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
    || !Number.isSafeInteger(value.remote_request_count)
    || (value.remote_request_count as number) < 1
    || (value.remote_request_count as number) > 4
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
  plan: ProductionArtWorkflowPlan,
  taskId: string,
  runDirectory: string,
  expectedCharacterId: string,
  allowProjectionRejected = false,
  privateOutputRoot?: string,
  requirements?: AssetRequirementsV1_1,
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
  const outputRecord = parseJsonRecord(
    outputBytes,
    'Production-art output',
  );
  const evidenceRecord = parseJsonRecord(
    evidenceBytes,
    'Production-art evidence',
  );
  const sourceSha256 = digestBytes(source);
  const normalizedSha256 = digestBytes(normalized);
  const artifact: ProductionArtWorkflowArtifact = {
    run_directory: relative(
      privateOutputRoot ? root : process.cwd(),
      directory,
    ).replaceAll('\\', '/'),
    source_sha256: sourceSha256,
    normalized_sha256: normalizedSha256,
  };
  if (plan.schema_version === '1.1.0') {
    if (!requirements) {
      throw new Error(
        'Plan 1.1 output requires its verified AssetRequirements source.',
      );
    }
    let output: ProductionArtOutputV1_1;
    try {
      output = await materializeProductionArtOutputV1_1(
        outputRecord,
        plan,
        requirements,
      );
    } catch {
      throw new Error(
        'Plan 1.1 output is invalid or does not match its verified sources.',
      );
    }
    const task = plan.tasks.find(({ task_id: candidate }) =>
      candidate === taskId)!;
    const evidence =
      evidenceRecord as unknown as ProductionArtGenerationEvidenceV1_1;
    if (
      output.profile !== profile
      || output.task_id !== taskId
      || output.sha256 !== normalizedSha256
      || output.bytes !== normalized.byteLength
      || evidence.schema_version !== '1.1.0'
      || evidence.document_type !== 'production-art-generation-evidence'
      || evidence.plan_id !== plan.plan_id
      || evidence.profile !== profile
      || evidence.task_id !== taskId
      || evidence.source_binding?.plan_sha256 !== output.source.plan_sha256
      || evidence.source_binding?.requirements_sha256
        !== output.source.requirements_sha256
      || evidence.source_png?.sha256 !== sourceSha256
      || evidence.source_png?.bytes !== source.byteLength
      || evidence.normalized_png?.sha256 !== normalizedSha256
      || evidence.normalized_png?.bytes !== normalized.byteLength
      || !Array.isArray(evidence.slots)
      || evidence.slots.length !== task.slot_mappings.length
      || evidence.slots.some((slot, index) => {
        const expected = task.slot_mappings[index];
        return slot.slot_id !== expected.slot_id
          || slot.requirement_id !== expected.requirement_id
          || slot.role !== expected.role
          || slot.variant_id !== expected.variant_id
          || slot.atlas_cell?.column !== expected.grid_rect.column
          || slot.atlas_cell?.row !== expected.grid_rect.row
          || slot.atlas_cell?.column_span !== expected.grid_rect.column_span
          || slot.atlas_cell?.row_span !== expected.grid_rect.row_span
          || typeof slot.cell_sha256 !== 'string'
          || !SAFE_SHA256.test(slot.cell_sha256);
      })
    ) {
      throw new Error('Plan 1.1 run directory hashes or task bindings are invalid.');
    }
    return artifact;
  }
  const output = outputRecord as unknown as ProductionArtOutput;
  const evidence =
    evidenceRecord as unknown as ProductionArtGenerationEvidence;
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
  plan: ProductionArtWorkflowPlan,
  privateOutputRoot?: string,
  requirements?: AssetRequirementsV1_1,
): Promise<string | undefined> {
  if (!state.tasks.every(({ status }) => status === 'succeeded')) return undefined;
  if (plan.schema_version === '1.1.0') {
    if (!requirements) {
      throw new Error(
        'Completed Plan 1.1 workflow is missing its verified AssetRequirements source.',
      );
    }
    const runInputs = await Promise.all(state.tasks.map(async (task) => {
      const runDirectory = task.attempts.at(-1)?.artifact?.run_directory;
      if (!runDirectory) {
        throw new Error('Successful workflow task has no frozen run directory.');
      }
      const absoluteRunDirectory = privateOutputRoot
        ? resolve(privateOutputRoot, 'model-runs', runDirectory)
        : resolve(runDirectory);
      const output = parseJsonRecord(
        await readFile(resolve(absoluteRunDirectory, 'output.json')),
        'Production-art Output 1.1',
      ) as unknown as ProductionArtOutputV1_1;
      return {
        taskId: task.task_id,
        runDirectory,
        output,
        evidence: {
          artifactPath: output.path,
          bytes: output.bytes,
          sha256: output.sha256,
        },
      };
    }));
    const runSet = await buildProductionArtRunSetV1_1(
      plan,
      requirements,
      runInputs,
    );
    const path = resolve(directory, 'production-art-run-set.json');
    const text = `${JSON.stringify(runSet, null, 2)}\n`;
    try {
      await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
    } catch {
      const existing = await readFile(path, 'utf8');
      if (existing !== text) {
        throw new Error(
          'Existing Plan 1.1 production-art run-set differs from completed workflow.',
        );
      }
    }
    return relative(process.cwd(), path).replaceAll('\\', '/');
  }
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
  plan: ProductionArtWorkflowPlan,
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
    provider: state.provider,
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
  if (args.execute && !job.character_identity_semantics_file) {
    throw new Error(
      'Remote workflow execution requires a human-confirmed character identity semantics file.',
    );
  }
  const [
    worldBrief,
    styleBible,
    characterIdentitySemanticsBytes,
    worldLayoutPlanBytes,
    assetRequirementsBytes,
    productionArtPlanBytes,
    productionArtRequirementsBindingBytes,
    environmentReference,
    characterReference,
    approvedDirection,
  ] = await Promise.all([
    readBoundedText(job.world_brief_file, 'World brief', 2_000),
    readBoundedText(job.style_bible_file, 'Style bible', 4_000),
    job.character_identity_semantics_file
      ? readBoundedBinary(
        job.character_identity_semantics_file,
        'Character identity semantics',
      )
      : undefined,
    job.world_layout_plan_file
      ? readBoundedBinary(job.world_layout_plan_file, 'World layout plan')
      : undefined,
    job.asset_requirements_file
      ? readBoundedBinary(job.asset_requirements_file, 'Asset requirements')
      : undefined,
    job.production_art_plan_file
      ? readBoundedBinary(job.production_art_plan_file, 'Production art plan')
      : undefined,
    job.production_art_requirements_binding_file
      ? readBoundedBinary(
        job.production_art_requirements_binding_file,
        'Production art requirements binding',
      )
      : undefined,
    readBoundedBinary(job.environment_reference, 'Environment reference'),
    readBoundedBinary(job.character_reference, 'Character reference'),
    job.approved_direction
      ? readBoundedBinary(job.approved_direction, 'Approved direction')
      : undefined,
  ]);
  if (characterIdentitySemanticsBytes) {
    if (characterIdentitySemanticsBytes.byteLength > 64 * 1024) {
      throw new Error(
        'Character identity semantics cannot exceed 64 KiB.',
      );
    }
    const semantics = materializeCharacterIdentitySemantics(
      parseJsonRecord(
        characterIdentitySemanticsBytes,
        'Character identity semantics',
      ),
    );
    const canonicalBytes =
      serializeCharacterIdentitySemanticsCanonical(semantics);
    if (
      canonicalBytes.byteLength !== characterIdentitySemanticsBytes.byteLength
      || canonicalBytes.some((byte, index) =>
        byte !== characterIdentitySemanticsBytes[index])
      || semantics.character_id !== job.character_id
      || semantics.source_identity.identity_digest_sha256
        !== job.private_input_binding.character_identity_digest_sha256
      || semantics.source_identity.source_reference_id
        !== job.private_input_binding.character_reference_id
    ) {
      throw new Error(
        'Character identity semantics must be canonical and bind the workflow character.',
      );
    }
  }
  let worldLayoutPlanSha256: string | undefined;
  if (worldLayoutPlanBytes) {
    const layoutRecord = parseJsonRecord(worldLayoutPlanBytes, 'World layout plan');
    const layout = await materializeWorldLayoutPlan(layoutRecord);
    const canonicalBytes = await serializeCanonicalWorldLayoutPlan(layout);
    worldLayoutPlanSha256 = await fingerprintWorldLayoutPlan(layout);
    if (
      canonicalBytes.byteLength !== worldLayoutPlanBytes.byteLength
      || canonicalBytes.some((byte, index) => byte !== worldLayoutPlanBytes[index])
      || layout.profile !== job.profile
      || layout.source.intake_sha256
        !== job.private_input_binding.confirmed_intake_sha256
      || layout.source.seed !== job.private_input_binding.seed
    ) {
      throw new Error(
        'World layout plan must be canonical and bind the workflow profile, intake, and seed.',
      );
    }
  }
  let plan: ProductionArtWorkflowPlan;
  let completeRequirements: AssetRequirementsV1_1 | undefined;
  let productionArtRequirementsBinding:
    ProductionArtRequirementsBinding | undefined;
  if (job.schema_version === '1.1.0') {
    if (
      !worldLayoutPlanSha256
      || !assetRequirementsBytes
      || !productionArtPlanBytes
    ) {
      throw new Error(
        'Plan 1.1 workflow requires its canonical layout, AssetRequirements, and production-art plan.',
      );
    }
    if (
      assetRequirementsBytes.byteLength > 512 * 1024
      || productionArtPlanBytes.byteLength > 2 * 1024 * 1024
    ) {
      throw new Error(
        'Plan 1.1 AssetRequirements and production-art plan exceed their fixed size limits.',
      );
    }
    completeRequirements = await materializeAssetRequirementsV1_1(
      parseJsonRecord(assetRequirementsBytes, 'Asset requirements 1.1'),
    );
    const canonicalRequirements =
      await serializeCanonicalAssetRequirementsV1_1(completeRequirements);
    plan = await materializeProductionArtPlanV1_1(
      parseJsonRecord(productionArtPlanBytes, 'Production art plan 1.1'),
      completeRequirements,
    );
    const canonicalPlan = await serializeCanonicalProductionArtPlanV1_1(
      plan,
      completeRequirements,
    );
    if (
      canonicalRequirements.byteLength !== assetRequirementsBytes.byteLength
      || canonicalRequirements.some((byte, index) =>
        byte !== assetRequirementsBytes[index])
      || canonicalPlan.byteLength !== productionArtPlanBytes.byteLength
      || canonicalPlan.some((byte, index) =>
        byte !== productionArtPlanBytes[index])
      || completeRequirements.profile !== job.profile
      || plan.profile !== job.profile
      || completeRequirements.source.layout_plan_sha256
        !== worldLayoutPlanSha256
    ) {
      throw new Error(
        'Plan 1.1 inputs must be canonical and bind the workflow profile and layout.',
      );
    }
  } else {
    plan = createProductionArtPlan(job.profile, {
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    });
  }
  if (
    job.schema_version === '1.0.0'
    && assetRequirementsBytes
    && productionArtRequirementsBindingBytes
  ) {
    if (!worldLayoutPlanSha256) {
      throw new Error(
        'Asset requirements require a canonical world layout plan.',
      );
    }
    if (
      assetRequirementsBytes.byteLength > 512 * 1024
      || productionArtRequirementsBindingBytes.byteLength > 512 * 1024
    ) {
      throw new Error(
        'Asset requirements and their production-art binding cannot exceed 512 KiB each.',
      );
    }
    const assetRequirements = await materializeAssetRequirements(
      parseJsonRecord(assetRequirementsBytes, 'Asset requirements'),
    );
    const canonicalAssetRequirements =
      await serializeCanonicalAssetRequirements(assetRequirements);
    productionArtRequirementsBinding =
      await materializeProductionArtRequirementsBinding(
        parseJsonRecord(
          productionArtRequirementsBindingBytes,
          'Production art requirements binding',
        ),
        {
          assetRequirements,
          productionArtPlan: plan,
        },
      );
    const canonicalBinding =
      await serializeCanonicalProductionArtRequirementsBinding(
        productionArtRequirementsBinding,
      );
    if (
      canonicalAssetRequirements.byteLength !== assetRequirementsBytes.byteLength
      || canonicalAssetRequirements.some((byte, index) =>
        byte !== assetRequirementsBytes[index])
      || canonicalBinding.byteLength
        !== productionArtRequirementsBindingBytes.byteLength
      || canonicalBinding.some((byte, index) =>
        byte !== productionArtRequirementsBindingBytes[index])
      || assetRequirements.profile !== job.profile
      || productionArtRequirementsBinding.profile !== job.profile
      || assetRequirements.source.layout_plan_sha256
        !== worldLayoutPlanSha256
    ) {
      throw new Error(
        'Asset requirements and their production-art binding must be canonical and match the workflow profile.',
      );
    }
    if (args.execute && productionArtRequirementsBinding.status === 'blocked') {
      throw new Error(
        'Production art requirements are unresolved; remote execution is blocked.',
      );
    }
  }
  const inputBindingSha256 = privateInputBinding({
    job,
    worldBrief,
    styleBible,
    ...(characterIdentitySemanticsBytes
      ? { characterIdentitySemantics: characterIdentitySemanticsBytes }
      : {}),
    ...(worldLayoutPlanBytes ? { worldLayoutPlan: worldLayoutPlanBytes } : {}),
    ...(assetRequirementsBytes
      ? { assetRequirements: assetRequirementsBytes }
      : {}),
    ...(productionArtPlanBytes
      ? { productionArtPlan: productionArtPlanBytes }
      : {}),
    ...(productionArtRequirementsBindingBytes
      ? {
        productionArtRequirementsBinding:
          productionArtRequirementsBindingBytes,
      }
      : {}),
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
    const selectedProvider = workflowProvider(job);
    let state = await readLatestState(directory, plan)
      ?? createProductionArtWorkflowState({
        workflowId: job.workflow_id,
        plan,
        provider: {
          id: selectedProvider.id,
          model: selectedProvider.model,
          quality: job.quality,
        },
        inputBindingSha256,
        privateInputBinding: job.private_input_binding,
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

    if (args.execute && args.expectedStateRevision !== undefined) {
      const guardedTaskId = args.retryTask
        ?? selectNextProductionArtWorkflowTask(
          state,
          plan,
          approvedDirectionSha256,
        ).task_id;
      if (
        state.state_revision !== args.expectedStateRevision
        || guardedTaskId !== args.expectedNextTask
      ) {
        throw new Error(
          'Workflow state changed after consent; no remote request was started.',
        );
      }
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
        completeRequirements,
      );
      state = reconcileProductionArtWorkflowTask(state, plan, {
        expectedStateRevision: state.state_revision,
        taskId: args.reconcileTask,
        artifact,
      });
      await persistState(directory, state);
      const runSet = await writeRunSet(
        directory,
        state,
        plan,
        job.private_output_root,
        completeRequirements,
      );
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
      const runSet = await writeRunSet(
        directory,
        state,
        plan,
        job.private_output_root,
        completeRequirements,
      );
      console.log(JSON.stringify(workflowSummary(
        state,
        plan,
        approvedDirectionSha256,
        'dry-run',
        runSet,
      ), null, 2));
      return;
    }
    if (!process.env[selectedProvider.credentialName]) {
      throw new Error(
        `${selectedProvider.credentialName} is required only for --execute.`,
      );
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
      if (selectedTaskId !== 'scene-direction' && !job.approved_direction) {
        throw new Error(
          'Remote execution requires the frozen approved direction file; no request was started.',
        );
      }
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
          completeRequirements,
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
    const runSet = await writeRunSet(
      directory,
      state,
      plan,
      job.private_output_root,
      completeRequirements,
    );
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
