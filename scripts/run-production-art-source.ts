import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import { normalizeProductionArtPng } from '../src/adapters/normalize-production-art-png';
import {
  normalizeProductionArtPngV1_1,
} from '../src/adapters/normalize-production-art-png-v1-1';
import {
  ProductionCharacterProfileProjectionError,
  deriveCharacterIdentityDigestSha256,
  projectProductionCharacterProfile,
  type ProductionCharacterProfileProjection,
} from '../src/adapters/project-production-character-profile';
import {
  LayeredDepthCharacterProjectionError,
  projectLayeredDepthProductionCharacter,
  type LayeredDepthCharacterProjection,
} from '../src/adapters/project-layered-depth-production-character';
import {
  createOpenAiProductionArtProvider,
  OPENAI_PRODUCTION_ART_MODEL,
  OPENAI_PRODUCTION_ART_PROVIDER_ID,
  selectOpenAiSourceSize,
  type OpenAiProductionArtQuality,
} from '../src/adapters/openai/openai-production-art-provider';
import {
  createSpriteCookProductionArtProvider,
  selectSpriteCookIntentSize,
  SPRITECOOK_DEFAULT_MODEL,
  SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
  type SpriteCookProductionArtExecutionStats,
  type SpriteCookProductionArtResolution,
} from '../src/adapters/spritecook/spritecook-production-art-provider';
import {
  createPrivateSpriteCookReferenceCache,
} from '../src/adapters/spritecook/private-spritecook-reference-cache';
import {
  createProductionArtPlan,
  type ProductionArtPlan,
  type ProductionArtTask,
} from '../src/core/production-art-contract';
import {
  materializeProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
  type ProductionArtTaskV1_1,
} from '../src/core/production-art-contract-v1-1';
import {
  materializeAssetRequirementsV1_1,
  type AssetRequirementsV1_1,
} from '../src/core/asset-requirements-v1-1';
import {
  serializeCharacterProfileRevisionCanonical,
} from '../src/core/character-profile-revision';
import {
  materializeCharacterIdentitySemantics,
  type CharacterIdentitySemantics,
} from '../src/core/character-identity-semantics';
import {
  runProductionArtProvider,
  type RemoteProcessingAuthorization,
} from '../src/core/production-art-provider';
import {
  bindReferenceImage,
  inspectReferenceImageBytes,
  type ReferenceImageMediaType,
  type ReferenceImageRole,
  type RuntimeReferenceImage,
} from '../src/core/reference-image';
import {
  WORLD_ASSET_PROFILES,
  type WorldAssetProfile,
} from '../src/core/asset-profile';
import { parseStrictJsonDocument } from '../src/adapters/import-world-spec';

const DEFAULT_OUTPUT_ROOT = 'docs/visual-qa/production-art/model-runs';
const SAFE_CHARACTER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_REFERENCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PROVIDERS = Object.freeze(['openai', 'spritecook'] as const);
type ProductionArtProviderChoice = typeof PROVIDERS[number];
const VALUE_FLAGS = new Set([
  '--provider',
  '--model',
  '--resolution',
  '--spritecook-asset-cache-root',
  '--profile',
  '--task',
  '--asset-requirements-file',
  '--production-art-plan-file',
  '--quality',
  '--world-brief-file',
  '--style-bible-file',
  '--environment-reference',
  '--environment-reference-id',
  '--character-reference',
  '--character-reference-id',
  '--character-identity-semantics-file',
  '--character-identity-digest-sha256',
  '--approved-direction',
  '--character-id',
  '--output-root',
]);
const BOOLEAN_FLAGS = new Set([
  '--execute',
  '--allow-remote-upload',
  '--help',
]);

interface Arguments {
  readonly execute: boolean;
  readonly allowRemoteUpload: boolean;
  readonly help: boolean;
  readonly provider: ProductionArtProviderChoice;
  readonly model?: string;
  readonly resolution: SpriteCookProductionArtResolution;
  readonly spriteCookAssetCacheRoot?: string;
  readonly profile: WorldAssetProfile;
  readonly taskId: string;
  readonly assetRequirementsFile?: string;
  readonly productionArtPlanFile?: string;
  readonly quality: OpenAiProductionArtQuality;
  readonly worldBriefFile?: string;
  readonly styleBibleFile?: string;
  readonly environmentReference?: string;
  readonly environmentReferenceId: string;
  readonly characterReference?: string;
  readonly characterReferenceId: string;
  readonly characterIdentitySemanticsFile?: string;
  readonly characterIdentityDigestSha256?: string;
  readonly approvedDirection?: string;
  readonly characterId?: string;
  readonly outputRoot: string;
  readonly outputRootIsCustom: boolean;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — provider-neutral production-art source runner',
    '',
    'Dry-run (default, no upload and no API cost):',
    '  pnpm production-art:model -- --profile layered-depth-2d --task scene-direction',
    '  pnpm production-art:model -- --provider spritecook --profile topdown-farm --task scene-direction',
    '',
    'Execute one remote image-edit request:',
    '  pnpm production-art:model -- --profile layered-depth-2d --task scene-direction \\',
    '    --world-brief-file <private-brief.txt> --style-bible-file <private-style.txt> \\',
    '    --environment-reference <environment.png> --character-reference <character.png> \\',
    '    --character-identity-semantics-file <human-confirmed-character.json> \\',
    '    --quality medium --execute --allow-remote-upload',
    '',
    'Execute an approved player-character round:',
    '  pnpm production-art:model -- --profile layered-depth-2d \\',
    '    --task character-character-player-atlas --character-id neutral-traveler \\',
    '    --world-brief-file <private-brief.txt> --style-bible-file <private-style.txt> \\',
    '    --approved-direction <accepted-direction.png> --character-reference <character.png> \\',
    '    --character-identity-semantics-file <human-confirmed-character.json> \\',
    '    --quality medium --execute --allow-remote-upload',
    '',
    'Execute one complete Plan 1.1 task through the same provider port:',
    '  pnpm production-art:model -- --profile topdown-farm \\',
    '    --asset-requirements-file <asset-requirements-1.1.json> \\',
    '    --production-art-plan-file <production-art-plan-1.1.json> \\',
    '    --task <plan-task-id> --approved-direction <accepted-direction.png> \\',
    '    --world-brief-file <private-brief.txt> --style-bible-file <private-style.txt> \\',
    '    --execute --allow-remote-upload',
    '',
    'Rules:',
    '  - OPENAI_API_KEY or SPRITECOOK_API_KEY is read only at runtime and is never written to output.',
    '  - --provider defaults to openai; SpriteCook accepts optional --model and --resolution 1K|2K|4K.',
    '  - Non-scene tasks require --approved-direction from the accepted scene-direction round.',
    '  - Player animation tasks require a portable --character-id; it is not a private display name.',
    '  - OpenAI makes one request; SpriteCook makes at most four bounded requests including imports and download.',
    '  - --spritecook-asset-cache-root enables account-scoped reference reuse only in an explicit private directory outside the repository.',
    `  - Candidate files default to ignored ${DEFAULT_OUTPUT_ROOT}/ until human review.`,
    '  - --output-root can keep all candidate bytes in a private workspace outside the repository.',
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
  const profile = values.get('--profile') ?? 'layered-depth-2d';
  if (!WORLD_ASSET_PROFILES.includes(profile as WorldAssetProfile)) {
    throw new Error(`Unsupported profile: ${profile}.`);
  }
  const quality = values.get('--quality') ?? 'medium';
  if (!['low', 'medium', 'high'].includes(quality)) {
    throw new Error(`Unsupported quality: ${quality}.`);
  }
  const provider = values.get('--provider') ?? 'openai';
  if (!PROVIDERS.includes(provider as ProductionArtProviderChoice)) {
    throw new Error(`Unsupported provider: ${provider}.`);
  }
  const resolution = values.get('--resolution') ?? '2K';
  if (!['1K', '2K', '4K'].includes(resolution)) {
    throw new Error(`Unsupported SpriteCook resolution: ${resolution}.`);
  }
  if (
    provider === 'openai'
    && (
      values.has('--model')
      || values.has('--resolution')
      || values.has('--spritecook-asset-cache-root')
    )
  ) {
    throw new Error(
      '--model, --resolution, and --spritecook-asset-cache-root are accepted only with --provider spritecook.',
    );
  }
  if (
    values.has('--asset-requirements-file')
    !== values.has('--production-art-plan-file')
  ) {
    throw new Error(
      '--asset-requirements-file and --production-art-plan-file must be supplied together.',
    );
  }
  return Object.freeze({
    execute: booleans.has('--execute'),
    allowRemoteUpload: booleans.has('--allow-remote-upload'),
    help: booleans.has('--help'),
    provider: provider as ProductionArtProviderChoice,
    ...(values.has('--model') ? { model: values.get('--model') } : {}),
    resolution: resolution as SpriteCookProductionArtResolution,
    ...(values.has('--spritecook-asset-cache-root')
      ? {
        spriteCookAssetCacheRoot: resolve(
          values.get('--spritecook-asset-cache-root')!,
        ),
      }
      : {}),
    profile: profile as WorldAssetProfile,
    taskId: values.get('--task') ?? 'scene-direction',
    ...(values.has('--asset-requirements-file')
      ? { assetRequirementsFile: values.get('--asset-requirements-file') }
      : {}),
    ...(values.has('--production-art-plan-file')
      ? { productionArtPlanFile: values.get('--production-art-plan-file') }
      : {}),
    quality: quality as OpenAiProductionArtQuality,
    ...(values.has('--world-brief-file') ? { worldBriefFile: values.get('--world-brief-file') } : {}),
    ...(values.has('--style-bible-file') ? { styleBibleFile: values.get('--style-bible-file') } : {}),
    ...(values.has('--environment-reference')
      ? { environmentReference: values.get('--environment-reference') }
      : {}),
    environmentReferenceId:
      values.get('--environment-reference-id') ?? 'environment-reference',
    ...(values.has('--character-reference')
      ? { characterReference: values.get('--character-reference') }
      : {}),
    characterReferenceId:
      values.get('--character-reference-id') ?? 'character-reference',
    ...(values.has('--character-identity-semantics-file')
      ? {
        characterIdentitySemanticsFile:
          values.get('--character-identity-semantics-file'),
      }
      : {}),
    ...(values.has('--character-identity-digest-sha256')
      ? {
        characterIdentityDigestSha256:
          values.get('--character-identity-digest-sha256'),
      }
      : {}),
    ...(values.has('--approved-direction')
      ? { approvedDirection: values.get('--approved-direction') }
      : {}),
    ...(values.has('--character-id')
      ? { characterId: values.get('--character-id') }
      : {}),
    outputRoot: resolve(values.get('--output-root') ?? DEFAULT_OUTPUT_ROOT),
    outputRootIsCustom: values.has('--output-root'),
  });
}

type SelectedProductionArtTask = Readonly<{
  plan: ProductionArtPlan | ProductionArtPlanV1_1;
  task: ProductionArtTask | ProductionArtTaskV1_1;
  requirements?: AssetRequirementsV1_1;
}>;

async function readStrictJsonFile(
  path: string,
  label: string,
  maximumBytes = 1024 * 1024,
): Promise<unknown> {
  const bytes = Uint8Array.from(await readFile(resolve(path)));
  if (bytes.byteLength < 2 || bytes.byteLength > maximumBytes) {
    throw new Error(`${label} must be bounded, non-empty JSON.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain strict UTF-8.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

async function selectTask(
  args: Arguments,
): Promise<SelectedProductionArtTask> {
  if (args.assetRequirementsFile && args.productionArtPlanFile) {
    const requirements = await materializeAssetRequirementsV1_1(
      await readStrictJsonFile(
        args.assetRequirementsFile,
        'AssetRequirements 1.1',
      ),
    );
    const plan = await materializeProductionArtPlanV1_1(
      await readStrictJsonFile(
        args.productionArtPlanFile,
        'ProductionArtPlan 1.1',
      ),
      requirements,
    );
    if (plan.profile !== args.profile) {
      throw new Error('ProductionArtPlan 1.1 does not match --profile.');
    }
    const task = plan.tasks.find(({ task_id: id }) => id === args.taskId);
    if (!task) {
      throw new Error(
        `Unknown task ${args.taskId}. Available: ${
          plan.tasks.map(({ task_id: id }) => id).join(', ')
        }.`,
      );
    }
    return Object.freeze({ plan, task, requirements });
  }
  const { profile, taskId } = args;
  const plan = createProductionArtPlan(profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const task = plan.tasks.find(({ task_id: id }) => id === taskId);
  if (!task) {
    throw new Error(`Unknown task ${taskId}. Available: ${plan.tasks.map(({ task_id: id }) => id).join(', ')}.`);
  }
  return { plan, task };
}

function taskRoles(
  task: ProductionArtTask | ProductionArtTaskV1_1,
): readonly string[] {
  return 'role_mappings' in task
    ? task.role_mappings.map(({ role }) => role)
    : task.slot_mappings.map(({ role }) => role);
}

function isPlayerCharacterTask(
  task: ProductionArtTask | ProductionArtTaskV1_1,
): boolean {
  return task.kind === 'character-animation-sheet'
    && taskRoles(task).includes('character.player.atlas');
}

function assertExecutionArguments(
  args: Arguments,
  task: ProductionArtTask | ProductionArtTaskV1_1,
): void {
  if (!args.allowRemoteUpload) {
    throw new Error('--execute also requires --allow-remote-upload for this exact request.');
  }
  if (!args.worldBriefFile || !args.styleBibleFile) {
    throw new Error('--execute requires --world-brief-file and --style-bible-file.');
  }
  if (task.task_id === 'scene-direction') {
    if (!args.environmentReference || !args.characterReference) {
      throw new Error('scene-direction requires environment and character reference images.');
    }
    if (args.approvedDirection) {
      throw new Error('scene-direction does not accept --approved-direction; that file is its output.');
    }
  } else if (!args.approvedDirection) {
    throw new Error('Every non-scene task requires --approved-direction from the accepted first round.');
  }
  if (task.reference_roles.includes('character') && !args.characterReference) {
    throw new Error(`${task.task_id} requires --character-reference.`);
  }
  if (
    task.reference_roles.includes('character')
    && !args.characterIdentitySemanticsFile
  ) {
    throw new Error(
      `${task.task_id} requires --character-identity-semantics-file.`,
    );
  }
  if (
    args.characterIdentitySemanticsFile
    && !task.reference_roles.includes('character')
  ) {
    throw new Error(
      '--character-identity-semantics-file is accepted only for a character-bearing task.',
    );
  }
  const isPlayerTask = isPlayerCharacterTask(task);
  if (isPlayerTask && !args.characterId) {
    throw new Error(`${task.task_id} requires --character-id for the portable character revision.`);
  }
  if (args.characterId && !isPlayerTask) {
    throw new Error('--character-id is accepted only for a player animation task.');
  }
  if (args.characterId
    && (!SAFE_CHARACTER_ID.test(args.characterId) || args.characterId.length > 48)) {
    throw new Error('--character-id must be a lowercase portable id of at most 48 characters.');
  }
  if (
    !SAFE_REFERENCE_ID.test(args.environmentReferenceId)
    || args.environmentReferenceId.length > 80
    || !SAFE_REFERENCE_ID.test(args.characterReferenceId)
    || args.characterReferenceId.length > 80
    || args.environmentReferenceId === args.characterReferenceId
  ) {
    throw new Error('Reference ids must be distinct lowercase portable ids of at most 80 characters.');
  }
  if (
    args.characterIdentityDigestSha256 !== undefined
    && !SHA256.test(args.characterIdentityDigestSha256)
  ) {
    throw new Error('--character-identity-digest-sha256 must be canonical SHA-256.');
  }
  if (args.characterIdentityDigestSha256 && !isPlayerTask) {
    throw new Error(
      '--character-identity-digest-sha256 is accepted only for a player animation task.',
    );
  }
  if (args.spriteCookAssetCacheRoot) {
    const repositoryRoot = resolve(process.cwd());
    const cacheRelativePath = relative(
      repositoryRoot,
      args.spriteCookAssetCacheRoot,
    );
    if (
      cacheRelativePath === ''
      || (
        cacheRelativePath !== '..'
        && !cacheRelativePath.startsWith(`..${sep}`)
        && !isAbsolute(cacheRelativePath)
      )
    ) {
      throw new Error(
        '--spritecook-asset-cache-root must resolve outside the repository.',
      );
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex');
}

function detectMediaType(bytes: Uint8Array): ReferenceImageMediaType {
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  throw new Error('A local reference contains neither PNG nor JPEG bytes.');
}

async function loadReference(
  filePath: string,
  id: string,
  role: ReferenceImageRole,
): Promise<RuntimeReferenceImage> {
  const bytes = Uint8Array.from(await readFile(resolve(filePath)));
  const mediaType = detectMediaType(bytes);
  const dimensions = inspectReferenceImageBytes(bytes, mediaType);
  return bindReferenceImage({
    id,
    role,
    path: `references/${id}.${mediaType === 'image/png' ? 'png' : 'jpg'}`,
    mediaType,
    byteLength: bytes.byteLength,
    width: dimensions.width,
    height: dimensions.height,
    sha256: await sha256(bytes),
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  }, bytes);
}

async function loadReferences(
  args: Arguments,
  task: ProductionArtTask | ProductionArtTaskV1_1,
): Promise<RuntimeReferenceImage[]> {
  const references: RuntimeReferenceImage[] = [];
  if (args.approvedDirection) {
    references.push(await loadReference(
      args.approvedDirection,
      'approved-scene-direction',
      'environment-style',
    ));
  }
  if (args.environmentReference) {
    references.push(await loadReference(
      args.environmentReference,
      args.environmentReferenceId,
      'environment-style',
    ));
  }
  if (task.reference_roles.includes('character') && args.characterReference) {
    references.push(await loadReference(
      args.characterReference,
      args.characterReferenceId,
      'character',
    ));
  }
  return references;
}

async function readBoundedText(path: string, label: string, maximum: number): Promise<string> {
  const value = await readFile(resolve(path), 'utf8');
  if (
    value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`${label} must be non-empty, trimmed, and at most ${maximum} characters.`);
  }
  return value;
}

async function readCharacterIdentitySemantics(
  path: string,
): Promise<CharacterIdentitySemantics> {
  const bytes = Uint8Array.from(await readFile(resolve(path)));
  if (bytes.byteLength < 2 || bytes.byteLength > 64 * 1024) {
    throw new Error(
      'Character identity semantics must be between 2 bytes and 64 KiB.',
    );
  }
  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = parseStrictJsonDocument(
      text,
      'Character identity semantics',
    );
    if (!parsed.ok) throw new Error(parsed.message);
    value = parsed.value;
  } catch {
    throw new Error(
      'Character identity semantics must be strict UTF-8 JSON.',
    );
  }
  return materializeCharacterIdentitySemantics(value);
}

function dryRunSummary(
  args: Arguments,
  task: ProductionArtTask | ProductionArtTaskV1_1,
): object {
  const openAiSource = args.provider === 'openai'
    ? selectOpenAiSourceSize(task.target)
    : undefined;
  const spriteCookSource = args.provider === 'spritecook'
    ? selectSpriteCookIntentSize(task.target)
    : undefined;
  return {
    mode: 'dry-run',
    remote_request_count: 0,
    reference_upload: false,
    provider: args.provider === 'openai'
      ? OPENAI_PRODUCTION_ART_PROVIDER_ID
      : SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
    model: args.provider === 'openai'
      ? OPENAI_PRODUCTION_ART_MODEL
      : args.model ?? SPRITECOOK_DEFAULT_MODEL,
    profile: args.profile,
    task_id: task.task_id,
    task_kind: task.kind,
    target_size: `${task.target.width}x${task.target.height}`,
    source_size: openAiSource
      ? openAiSource.value
      : `${spriteCookSource!.width}x${spriteCookSource!.height}`,
    source_scale: openAiSource
      ? openAiSource.scale
      : spriteCookSource!.targetScale,
    quality: args.quality,
    ...(args.provider === 'spritecook'
      ? {
        resolution: args.resolution,
        maximum_http_requests: 4,
        reference_import_policy: args.spriteCookAssetCacheRoot
          ? 'private-account-scoped-cache'
          : 'per-task-private-upload',
      }
      : { maximum_http_requests: 1 }),
    required_reference_roles: task.reference_roles,
    semantic_pose_cells: task.pose_mappings?.length ?? 0,
    requires_approved_direction: task.task_id !== 'scene-direction',
    plan_schema_version: args.productionArtPlanFile ? '1.1.0' : '1.0.0',
    requires_character_id: isPlayerCharacterTask(task),
    requires_character_identity_semantics:
      task.reference_roles.includes('character'),
    output_policy: 'internal-review',
    human_review: 'required',
  };
}

function safeRunDirectory(
  outputRoot: string,
  profile: WorldAssetProfile,
  taskId: string,
  runId: string,
): string {
  const root = resolve(outputRoot);
  const target = resolve(root, profile, taskId, runId);
  if (!target.startsWith(`${root}${sep}`)) throw new Error('Resolved model-run directory escaped its fixed root.');
  return target;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function canonicalSourceReferenceIds(
  task: ProductionArtTaskV1_1,
  references: readonly RuntimeReferenceImage[],
): readonly string[] {
  const values = new Set<string>(['approved-scene-direction']);
  for (const reference of references) {
    if (reference.descriptor.role === 'character') {
      values.add('character-reference');
    } else if (reference.descriptor.id !== 'approved-scene-direction') {
      values.add('environment-reference');
    }
  }
  const required = [
    'approved-scene-direction',
    ...(task.reference_roles.includes('environment-style')
      ? ['environment-reference']
      : []),
    ...(task.reference_roles.includes('character')
      ? ['character-reference']
      : []),
  ];
  return Object.freeze(required.filter((value) => values.has(value)));
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const { plan, task, requirements } = await selectTask(args);
  if (!args.execute) {
    console.log(JSON.stringify(dryRunSummary(args, task), null, 2));
    return;
  }
  assertExecutionArguments(args, task);
  const credential = args.provider === 'openai'
    ? process.env.OPENAI_API_KEY
    : process.env.SPRITECOOK_API_KEY;
  if (!credential) {
    throw new Error(
      `${args.provider === 'openai' ? 'OPENAI_API_KEY' : 'SPRITECOOK_API_KEY'} is required only when --execute is present.`,
    );
  }
  const [
    worldBrief,
    styleBible,
    references,
    characterIdentitySemantics,
  ] = await Promise.all([
    readBoundedText(args.worldBriefFile!, 'World brief', 2_000),
    readBoundedText(args.styleBibleFile!, 'Style bible', 4_000),
    loadReferences(args, task),
    args.characterIdentitySemanticsFile
      ? readCharacterIdentitySemantics(args.characterIdentitySemanticsFile)
      : undefined,
  ]);
  const authorization: RemoteProcessingAuthorization = Object.freeze({
    decision: 'approved',
    provider_id: args.provider === 'openai'
      ? OPENAI_PRODUCTION_ART_PROVIDER_ID
      : SPRITECOOK_PRODUCTION_ART_PROVIDER_ID,
    task_id: task.task_id,
    reference_ids: Object.freeze(references.map(({ descriptor }) => descriptor.id)),
    allow_reference_upload: true,
    allow_prompt_upload: true,
    max_requests: args.provider === 'openai' ? 1 : 4,
  });
  let spriteCookExecutionStats:
    SpriteCookProductionArtExecutionStats | undefined;
  const provider = args.provider === 'openai'
    ? createOpenAiProductionArtProvider({ quality: args.quality })
    : createSpriteCookProductionArtProvider({
      quality: args.quality,
      resolution: args.resolution,
      ...(args.model ? { model: args.model } : {}),
      ...(args.spriteCookAssetCacheRoot
        ? {
          referenceAssetCache: createPrivateSpriteCookReferenceCache({
            rootDirectory: args.spriteCookAssetCacheRoot,
            credential,
          }),
        }
        : {}),
      onExecutionStats: (stats) => {
        spriteCookExecutionStats = stats;
      },
    });
  const trusted = requirements
    ? await runProductionArtProvider(provider, {
      plan: plan as ProductionArtPlanV1_1,
      requirements,
      taskId: task.task_id,
      worldBrief,
      styleBible,
      ...(characterIdentitySemantics ? { characterIdentitySemantics } : {}),
      references,
      remoteAuthorization: authorization,
    }, { credential })
    : await runProductionArtProvider(provider, {
      plan: plan as ProductionArtPlan,
      taskId: task.task_id,
      worldBrief,
      styleBible,
      ...(characterIdentitySemantics ? { characterIdentitySemantics } : {}),
      references,
      remoteAuthorization: authorization,
    }, { credential });
  const normalized = requirements
    ? await normalizeProductionArtPngV1_1({
      plan,
      requirements,
      task,
      asset_id: `${task.task_id}-candidate`,
      source_reference_ids: canonicalSourceReferenceIds(
        task as ProductionArtTaskV1_1,
        references,
      ),
      source: {
        media_type: 'image/png',
        width: trusted.source.width,
        height: trusted.source.height,
        byteLength: trusted.source.byteLength,
        readBytes: trusted.source.readBytes,
      },
    })
    : await normalizeProductionArtPng(trusted);
  let characterProfileProjection: ProductionCharacterProfileProjection | undefined;
  let characterProfileProjectionErrorCode: string | undefined;
  const isPlayerTask = isPlayerCharacterTask(task);
  if (isPlayerTask && !requirements) {
    const characterReference = references.find(({ descriptor }) =>
      descriptor.role === 'character');
    if (!characterReference || !args.characterId) {
      throw new Error('Player projection requires the validated character reference and character id.');
    }
    const identityDigestSha256 = args.characterIdentityDigestSha256
      ?? await deriveCharacterIdentityDigestSha256(
        characterReference.descriptor.sha256,
      );
    try {
      characterProfileProjection = await projectProductionCharacterProfile(
        plan as ProductionArtPlan,
        normalized as Awaited<ReturnType<typeof normalizeProductionArtPng>>,
        {
        characterId: args.characterId,
        identityDigestSha256,
        characterReferenceIds: [characterReference.descriptor.id],
        },
      );
    } catch (error) {
      characterProfileProjectionErrorCode =
        error instanceof ProductionCharacterProfileProjectionError
          ? error.code
          : 'projection.failed';
    }
  }

  let pack10Projection: LayeredDepthCharacterProjection | undefined;
  let pack10ProjectionErrorCode: string | undefined;
  if (
    !requirements
    && plan.profile === 'layered-depth-2d'
    && task.kind === 'character-animation-sheet'
  ) {
    try {
      pack10Projection = await projectLayeredDepthProductionCharacter(
        plan as ProductionArtPlan,
        normalized as Awaited<ReturnType<typeof normalizeProductionArtPng>>,
      );
    } catch (error) {
      pack10ProjectionErrorCode = error instanceof LayeredDepthCharacterProjectionError
        ? error.code
        : 'projection.failed';
    }
  }
  const sourceSha256 = normalized.evidence.schema_version === '1.1.0'
    ? normalized.evidence.source_png.sha256
    : normalized.evidence.source.sha256;
  const normalizedSha256 = normalized.evidence.schema_version === '1.1.0'
    ? normalized.evidence.normalized_png.sha256
    : normalized.evidence.normalized.sha256;
  const providerRequestId = normalized.evidence.schema_version === '1.1.0'
    ? undefined
    : normalized.evidence.provider_request_id;
  const runId = providerRequestId ?? sourceSha256.slice(0, 20);
  const directory = safeRunDirectory(args.outputRoot, args.profile, task.task_id, runId);
  await mkdir(resolve(directory, '..'), { recursive: true });
  await mkdir(directory, { recursive: false });
  const writes: Promise<unknown>[] = [
    writeFile(resolve(directory, 'source.png'), normalized.source.readBytes(), { flag: 'wx' }),
    writeFile(resolve(directory, 'normalized.png'), normalized.normalized.readBytes(), { flag: 'wx' }),
    writeJson(resolve(directory, 'output.json'), normalized.output),
    writeJson(resolve(directory, 'evidence.json'), normalized.evidence),
  ];
  if (characterProfileProjection) {
    writes.push(
      writeFile(
        resolve(directory, 'character-profile-atlas.png'),
        characterProfileProjection.png.readBytes(),
        { flag: 'wx' },
      ),
      writeFile(
        resolve(directory, 'character-profile-revision.json'),
        serializeCharacterProfileRevisionCanonical(characterProfileProjection.revision),
        { flag: 'wx' },
      ),
      writeJson(
        resolve(directory, 'character-profile-projection.json'),
        characterProfileProjection.record,
      ),
    );
  } else if (characterProfileProjectionErrorCode) {
    writes.push(writeJson(resolve(directory, 'character-profile-projection-rejection.json'), {
      schema_version: '1.0.0',
      document_type: 'production-character-profile-projection-rejection',
      profile: args.profile,
      task_id: task.task_id,
      code: characterProfileProjectionErrorCode,
      human_review: 'required',
    }));
  }
  if (pack10Projection) {
    writes.push(
      writeFile(resolve(directory, 'runtime-atlas.png'), pack10Projection.png.readBytes(), { flag: 'wx' }),
      writeJson(resolve(directory, 'projection.json'), pack10Projection.record),
      writeJson(resolve(directory, 'pack-character.json'), pack10Projection.character),
    );
  } else if (pack10ProjectionErrorCode) {
    writes.push(writeJson(resolve(directory, 'projection-rejection.json'), {
      schema_version: '1.0.0',
      document_type: 'production-character-atlas-projection-rejection',
      profile: args.profile,
      task_id: task.task_id,
      code: pack10ProjectionErrorCode,
      human_review: 'required',
    }));
  }
  await Promise.all(writes);
  const projectionRejected = Boolean(
    characterProfileProjectionErrorCode || pack10ProjectionErrorCode,
  );
  console.log(JSON.stringify({
    status: projectionRejected
      ? 'candidate-written-projection-rejected'
      : 'candidate-written',
    remote_request_count: args.provider === 'openai'
      ? 1
      : spriteCookExecutionStats?.httpRequests ?? references.length + 2,
    ...(args.provider === 'spritecook'
      ? {
        reference_cache: args.spriteCookAssetCacheRoot
          ? {
            status: 'enabled-private',
            imported_reference_count:
              spriteCookExecutionStats?.importedReferenceIds.length ?? 0,
            reused_reference_count:
              spriteCookExecutionStats?.reusedReferenceIds.length ?? 0,
          }
          : { status: 'disabled' },
      }
      : {}),
    profile: args.profile,
    task_id: task.task_id,
    source_sha256: sourceSha256,
    normalized_sha256: normalizedSha256,
    character_profile_projection: characterProfileProjection
      ? 'passed'
      : characterProfileProjectionErrorCode
        ? 'rejected'
        : 'not-applicable',
    ...(characterProfileProjection ? {
      character_profile_revision_id: characterProfileProjection.revision.profile_revision_id,
      character_profile_revision_sha256:
        characterProfileProjection.record.profile_revision_sha256,
      character_profile_atlas_path: 'character-profile-atlas.png',
    } : {}),
    ...(characterProfileProjectionErrorCode
      ? { character_profile_projection_error_code: characterProfileProjectionErrorCode }
      : {}),
    pack10_projection: pack10Projection
      ? 'passed'
      : pack10ProjectionErrorCode
        ? 'rejected'
        : 'not-applicable',
    ...(pack10Projection ? {
      runtime_atlas_sha256: pack10Projection.file.sha256,
      runtime_atlas_path: 'runtime-atlas.png',
    } : {}),
    ...(pack10ProjectionErrorCode
      ? { pack10_projection_error_code: pack10ProjectionErrorCode }
      : {}),
    human_review: 'required',
    output_directory: relative(
      args.outputRootIsCustom ? args.outputRoot : process.cwd(),
      directory,
    ).replaceAll('\\', '/'),
  }, null, 2));
  if (projectionRejected) process.exitCode = 2;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Production-art source generation failed.';
  console.error(`MAPSOO_PRODUCTION_ART_ERROR ${message}`);
  process.exitCode = 1;
});
