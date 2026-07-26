import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { normalizeProductionArtPng } from '../src/adapters/normalize-production-art-png';
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
  createProductionArtPlan,
  type ProductionArtTask,
} from '../src/core/production-art-contract';
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

const OUTPUT_ROOT = 'docs/visual-qa/production-art/model-runs';
const SAFE_CHARACTER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALUE_FLAGS = new Set([
  '--profile',
  '--task',
  '--quality',
  '--world-brief-file',
  '--style-bible-file',
  '--environment-reference',
  '--character-reference',
  '--approved-direction',
  '--character-id',
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
  readonly profile: WorldAssetProfile;
  readonly taskId: string;
  readonly quality: OpenAiProductionArtQuality;
  readonly worldBriefFile?: string;
  readonly styleBibleFile?: string;
  readonly environmentReference?: string;
  readonly characterReference?: string;
  readonly approvedDirection?: string;
  readonly characterId?: string;
}

function usage(): string {
  return [
    'Mapsoo Worldforge — OpenAI production-art source runner',
    '',
    'Dry-run (default, no upload and no API cost):',
    '  pnpm production-art:model -- --profile layered-depth-2d --task scene-direction',
    '',
    'Execute one remote image-edit request:',
    '  pnpm production-art:model -- --profile layered-depth-2d --task scene-direction \\',
    '    --world-brief-file <private-brief.txt> --style-bible-file <private-style.txt> \\',
    '    --environment-reference <environment.png> --character-reference <character.png> \\',
    '    --quality medium --execute --allow-remote-upload',
    '',
    'Execute an approved player-character round:',
    '  pnpm production-art:model -- --profile layered-depth-2d \\',
    '    --task character-character-player-atlas --character-id neutral-traveler \\',
    '    --world-brief-file <private-brief.txt> --style-bible-file <private-style.txt> \\',
    '    --approved-direction <accepted-direction.png> --character-reference <character.png> \\',
    '    --quality medium --execute --allow-remote-upload',
    '',
    'Rules:',
    '  - OPENAI_API_KEY is read only at runtime and is never written to output.',
    '  - Non-scene tasks require --approved-direction from the accepted scene-direction round.',
    '  - Player animation tasks require a portable --character-id; it is not a private display name.',
    '  - Each invocation can make at most one remote request.',
    `  - Candidate files stay ignored under ${OUTPUT_ROOT}/ until human review.`,
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
  return Object.freeze({
    execute: booleans.has('--execute'),
    allowRemoteUpload: booleans.has('--allow-remote-upload'),
    help: booleans.has('--help'),
    profile: profile as WorldAssetProfile,
    taskId: values.get('--task') ?? 'scene-direction',
    quality: quality as OpenAiProductionArtQuality,
    ...(values.has('--world-brief-file') ? { worldBriefFile: values.get('--world-brief-file') } : {}),
    ...(values.has('--style-bible-file') ? { styleBibleFile: values.get('--style-bible-file') } : {}),
    ...(values.has('--environment-reference')
      ? { environmentReference: values.get('--environment-reference') }
      : {}),
    ...(values.has('--character-reference')
      ? { characterReference: values.get('--character-reference') }
      : {}),
    ...(values.has('--approved-direction')
      ? { approvedDirection: values.get('--approved-direction') }
      : {}),
    ...(values.has('--character-id')
      ? { characterId: values.get('--character-id') }
      : {}),
  });
}

function selectTask(profile: WorldAssetProfile, taskId: string): {
  plan: ReturnType<typeof createProductionArtPlan>;
  task: ProductionArtTask;
} {
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

function assertExecutionArguments(args: Arguments, task: ProductionArtTask): void {
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
  const isPlayerCharacterTask = task.kind === 'character-animation-sheet'
    && task.role_mappings.length === 1
    && task.role_mappings[0].role === 'character.player.atlas';
  if (isPlayerCharacterTask && !args.characterId) {
    throw new Error(`${task.task_id} requires --character-id for the portable character revision.`);
  }
  if (args.characterId && !isPlayerCharacterTask) {
    throw new Error('--character-id is accepted only for a player animation task.');
  }
  if (args.characterId
    && (!SAFE_CHARACTER_ID.test(args.characterId) || args.characterId.length > 48)) {
    throw new Error('--character-id must be a lowercase portable id of at most 48 characters.');
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

async function loadReferences(args: Arguments, task: ProductionArtTask): Promise<RuntimeReferenceImage[]> {
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
      'environment-reference',
      'environment-style',
    ));
  }
  if (task.reference_roles.includes('character') && args.characterReference) {
    references.push(await loadReference(
      args.characterReference,
      'character-reference',
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

function dryRunSummary(args: Arguments, task: ProductionArtTask): object {
  const source = selectOpenAiSourceSize(task.target);
  return {
    mode: 'dry-run',
    remote_request_count: 0,
    reference_upload: false,
    provider: OPENAI_PRODUCTION_ART_PROVIDER_ID,
    model: OPENAI_PRODUCTION_ART_MODEL,
    profile: args.profile,
    task_id: task.task_id,
    task_kind: task.kind,
    target_size: `${task.target.width}x${task.target.height}`,
    source_size: source.value,
    source_scale: source.scale,
    quality: args.quality,
    required_reference_roles: task.reference_roles,
    semantic_pose_cells: task.pose_mappings?.length ?? 0,
    requires_approved_direction: task.task_id !== 'scene-direction',
    requires_character_id: task.kind === 'character-animation-sheet'
      && task.role_mappings.length === 1
      && task.role_mappings[0].role === 'character.player.atlas',
    output_policy: 'internal-review',
    human_review: 'required',
  };
}

function safeRunDirectory(profile: WorldAssetProfile, taskId: string, runId: string): string {
  const root = resolve(OUTPUT_ROOT);
  const target = resolve(root, profile, taskId, runId);
  if (!target.startsWith(`${root}${sep}`)) throw new Error('Resolved model-run directory escaped its fixed root.');
  return target;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const { plan, task } = selectTask(args.profile, args.taskId);
  if (!args.execute) {
    console.log(JSON.stringify(dryRunSummary(args, task), null, 2));
    return;
  }
  assertExecutionArguments(args, task);
  const credential = process.env.OPENAI_API_KEY;
  if (!credential) throw new Error('OPENAI_API_KEY is required only when --execute is present.');
  const [worldBrief, styleBible, references] = await Promise.all([
    readBoundedText(args.worldBriefFile!, 'World brief', 2_000),
    readBoundedText(args.styleBibleFile!, 'Style bible', 4_000),
    loadReferences(args, task),
  ]);
  const authorization: RemoteProcessingAuthorization = Object.freeze({
    decision: 'approved',
    provider_id: OPENAI_PRODUCTION_ART_PROVIDER_ID,
    task_id: task.task_id,
    reference_ids: Object.freeze(references.map(({ descriptor }) => descriptor.id)),
    allow_reference_upload: true,
    allow_prompt_upload: true,
    max_requests: 1,
  });
  const provider = createOpenAiProductionArtProvider({ quality: args.quality });
  const trusted = await runProductionArtProvider(provider, {
    plan,
    taskId: task.task_id,
    worldBrief,
    styleBible,
    references,
    remoteAuthorization: authorization,
  }, { credential });
  const normalized = await normalizeProductionArtPng(trusted);
  let characterProfileProjection: ProductionCharacterProfileProjection | undefined;
  let characterProfileProjectionErrorCode: string | undefined;
  const isPlayerCharacterTask = task.kind === 'character-animation-sheet'
    && task.role_mappings.length === 1
    && task.role_mappings[0].role === 'character.player.atlas';
  if (isPlayerCharacterTask) {
    const characterReference = references.find(({ descriptor }) =>
      descriptor.id === 'character-reference');
    if (!characterReference || !args.characterId) {
      throw new Error('Player projection requires the validated character reference and character id.');
    }
    const identityDigestSha256 = await deriveCharacterIdentityDigestSha256(
      characterReference.descriptor.sha256,
    );
    try {
      characterProfileProjection = await projectProductionCharacterProfile(plan, normalized, {
        characterId: args.characterId,
        identityDigestSha256,
        characterReferenceIds: [characterReference.descriptor.id],
      });
    } catch (error) {
      characterProfileProjectionErrorCode =
        error instanceof ProductionCharacterProfileProjectionError
          ? error.code
          : 'projection.failed';
    }
  }

  let pack10Projection: LayeredDepthCharacterProjection | undefined;
  let pack10ProjectionErrorCode: string | undefined;
  if (plan.profile === 'layered-depth-2d' && task.kind === 'character-animation-sheet') {
    try {
      pack10Projection = await projectLayeredDepthProductionCharacter(plan, normalized);
    } catch (error) {
      pack10ProjectionErrorCode = error instanceof LayeredDepthCharacterProjectionError
        ? error.code
        : 'projection.failed';
    }
  }
  const runId = normalized.evidence.provider_request_id
    ?? normalized.evidence.source.sha256.slice(0, 20);
  const directory = safeRunDirectory(args.profile, task.task_id, runId);
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
      writeJson(
        resolve(directory, 'character-profile-revision.json'),
        characterProfileProjection.revision,
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
    remote_request_count: 1,
    profile: args.profile,
    task_id: task.task_id,
    source_sha256: normalized.evidence.source.sha256,
    normalized_sha256: normalized.evidence.normalized.sha256,
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
    output_directory: relative(process.cwd(), directory).replaceAll('\\', '/'),
  }, null, 2));
  if (projectionRejected) process.exitCode = 2;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Production-art source generation failed.';
  console.error(`MAPSOO_PRODUCTION_ART_ERROR ${message}`);
  process.exitCode = 1;
});
