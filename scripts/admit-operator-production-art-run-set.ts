import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { decodeReferenceImageRgba } from '../src/adapters/decode-reference-image-rgba';
import {
  materializeProductionArtRunInventory,
} from '../src/adapters/materialize-production-art-run-inventory';
import {
  deriveCharacterIdentityDigestSha256,
  projectProductionCharacterProfile,
} from '../src/adapters/project-production-character-profile';
import type {
  NormalizedProductionArtResult,
  ProductionArtGenerationEvidence,
} from '../src/adapters/normalize-production-art-png';
import {
  assertValidProductionArtOutput,
  createProductionArtPlan,
  type ProductionArtOutput,
  type ProductionArtTask,
} from '../src/core/production-art-contract';
import {
  createProductionArtRunSet,
} from '../src/core/production-art-run-set';
import {
  isWorldAssetProfile,
  type WorldAssetProfile,
} from '../src/core/asset-profile';
import {
  serializeCharacterProfileRevisionCanonical,
} from '../src/core/character-profile-revision';

const ADMISSION = 'internal-technical-review-only';
const SAFE_MODEL = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FLAGS = new Set([
  '--profile',
  '--candidate-root',
  '--out',
  '--admission',
  '--model',
  '--runtime-direction-transform',
]);

interface Arguments {
  readonly profile: WorldAssetProfile;
  readonly candidateRoot: string;
  readonly outputRoot: string;
  readonly model: string;
  readonly runtimeDirectionTransform: 'none' | 'horizontal-flip-left';
}

interface CandidateReport {
  readonly schema_version: '1.0.0';
  readonly document_type: 'operator-production-art-candidate';
  readonly profile: WorldAssetProfile;
  readonly task_id: string;
  readonly status: 'internal-review-candidate';
  readonly distribution: 'internal-review';
  readonly output_license: 'UNRELEASED';
  readonly source: {
    readonly basename: string;
    readonly media_type: 'image/png';
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly output: {
    readonly basename: string;
    readonly media_type: 'image/png';
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
    readonly sha256: string;
    readonly alpha_policy: 'opaque' | 'straight-alpha';
  };
  readonly normalization: {
    readonly mode:
      | 'proportional-grid'
      | 'component-reading-order'
      | 'cover-crop';
    readonly mapped_cells_checked: true;
    readonly unmapped_cells_transparent: true;
    readonly transparent_rgb_zeroed: true;
    readonly binary_alpha: true;
  };
  readonly human_review: 'required';
  readonly not_accepted_for: readonly string[];
}

function usage(): string {
  return [
    'Admit one complete frozen operator candidate into a standard local run-set.',
    '',
    'pnpm exec vite-node scripts/admit-operator-production-art-run-set.ts -- \\',
    '  --profile side-platformer \\',
    '  --candidate-root <ignored-candidate-directory> \\',
    '  --out <ignored-run-set-directory> \\',
    `  --admission ${ADMISSION} \\`,
    '  --model <bounded-source-label> \\',
    '  --runtime-direction-transform none|horizontal-flip-left',
    '',
    'This command makes zero remote requests. Admission is only for internal',
    'technical assembly; human art, semantic direction, rights, runtime and',
    'Raspberry Pi review remain pending.',
  ].join('\n');
}

function parseArguments(argv: readonly string[]): Arguments {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log(usage());
    process.exit(0);
  }
  if (argv.length !== FLAGS.size * 2) {
    throw new Error('Every documented admission flag is required exactly once.');
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!FLAGS.has(flag) || !value || value.startsWith('--') || values.has(flag)) {
      throw new Error('Admission flags are invalid or duplicated.');
    }
    values.set(flag, value);
  }
  const profile = values.get('--profile');
  const model = values.get('--model')!;
  const runtimeDirectionTransform = values.get('--runtime-direction-transform');
  if (!isWorldAssetProfile(profile)) throw new Error('Production-art profile is unsupported.');
  if (values.get('--admission') !== ADMISSION) {
    throw new Error(`Explicit --admission ${ADMISSION} is required.`);
  }
  if (!SAFE_MODEL.test(model)) throw new Error('Model source label is invalid.');
  if (
    runtimeDirectionTransform !== 'none'
    && runtimeDirectionTransform !== 'horizontal-flip-left'
  ) {
    throw new Error('Runtime direction transform declaration is unsupported.');
  }
  if (
    runtimeDirectionTransform === 'horizontal-flip-left'
    && profile !== 'side-platformer'
    && profile !== 'layered-depth-2d'
  ) {
    throw new Error('Horizontal flip admission requires a side or layered profile.');
  }
  return {
    profile,
    candidateRoot: resolve(values.get('--candidate-root')!),
    outputRoot: resolve(values.get('--out')!),
    model,
    runtimeDirectionTransform,
  };
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch {
    throw new Error(`${label} is not strict UTF-8 JSON.`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function json(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeExclusiveOrIdentical(
  path: string,
  bytes: Uint8Array,
  label: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') {
      throw error;
    }
    const existing = Uint8Array.from(await readFile(path));
    if (
      existing.byteLength !== bytes.byteLength
      || existing.some((byte, index) => byte !== bytes[index])
    ) {
      throw new Error(`Refusing to overwrite different ${label}: ${path}.`);
    }
  }
}

function assertInside(root: string, path: string, label: string): void {
  const fromRoot = relative(root, path);
  if (
    !fromRoot
    || fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || /^[A-Za-z]:/.test(fromRoot)
  ) {
    throw new Error(`${label} must stay inside the output root.`);
  }
}

async function assertPixelPolicy(
  task: ProductionArtTask,
  bytes: Uint8Array,
): Promise<void> {
  const decoded = await decodeReferenceImageRgba(bytes, 'image/png');
  if (decoded.width !== task.target.width || decoded.height !== task.target.height) {
    throw new Error(`Candidate dimensions differ from ${task.task_id}.`);
  }
  let visible = 0;
  let transparent = 0;
  for (let offset = 0; offset < decoded.rgba.byteLength; offset += 4) {
    const alpha = decoded.rgba[offset + 3];
    if (task.alpha_policy === 'opaque') {
      if (alpha !== 255) throw new Error(`Opaque candidate ${task.task_id} contains transparency.`);
      visible += 1;
      continue;
    }
    if (alpha !== 0 && alpha !== 255) {
      throw new Error(`Candidate ${task.task_id} contains partial alpha.`);
    }
    if (alpha === 0) {
      transparent += 1;
      if (
        decoded.rgba[offset] !== 0
        || decoded.rgba[offset + 1] !== 0
        || decoded.rgba[offset + 2] !== 0
      ) {
        throw new Error(`Candidate ${task.task_id} leaks RGB under transparency.`);
      }
    } else {
      visible += 1;
    }
  }
  if (visible === 0 || (task.alpha_policy === 'straight-alpha' && transparent === 0)) {
    throw new Error(`Candidate ${task.task_id} has an invalid alpha inventory.`);
  }
}

function assertCandidateReport(
  value: unknown,
  task: ProductionArtTask,
): asserts value is CandidateReport {
  const report = value as Partial<CandidateReport>;
  if (
    report.schema_version !== '1.0.0'
    || report.document_type !== 'operator-production-art-candidate'
    || report.profile !== task.expected_output_path.split('/')[1]
    || report.task_id !== task.task_id
    || report.status !== 'internal-review-candidate'
    || report.distribution !== 'internal-review'
    || report.output_license !== 'UNRELEASED'
    || report.human_review !== 'required'
    || report.output?.media_type !== 'image/png'
    || report.output.width !== task.target.width
    || report.output.height !== task.target.height
    || report.output.alpha_policy !== task.alpha_policy
    || !SHA256.test(report.output.sha256 ?? '')
    || report.normalization?.mapped_cells_checked !== true
    || report.normalization.unmapped_cells_transparent !== true
    || report.normalization.transparent_rgb_zeroed !== true
    || report.normalization.binary_alpha !== true
    || !Array.isArray(report.not_accepted_for)
    || !report.not_accepted_for.includes('production-art run-set')
    || !report.not_accepted_for.includes('public asset-pack release')
  ) {
    throw new Error(`Candidate report is not a frozen unreleased operator result: ${task.task_id}.`);
  }
}

function sourceReferenceIds(task: ProductionArtTask): readonly string[] {
  return Object.freeze(task.reference_roles.map((role) =>
    role === 'character'
      ? 'operator-character-reference'
      : 'operator-environment-reference'));
}

async function materializeTask(
  args: Arguments,
  task: ProductionArtTask,
): Promise<Readonly<{
  result: NormalizedProductionArtResult;
  runDirectory: string;
  admission: Readonly<Record<string, unknown>>;
}>> {
  const reportPath = join(args.candidateRoot, `${task.task_id}-candidate.json`);
  const reportBytes = Uint8Array.from(await readFile(reportPath));
  const reportValue = parseJson<unknown>(reportBytes, `${task.task_id} candidate report`);
  assertCandidateReport(reportValue, task);
  const report = reportValue;
  const candidatePath = join(args.candidateRoot, report.output.basename);
  if (basename(candidatePath) !== report.output.basename) {
    throw new Error(`Candidate basename is unsafe: ${task.task_id}.`);
  }
  const candidateBytes = Uint8Array.from(await readFile(candidatePath));
  if (
    candidateBytes.byteLength !== report.output.bytes
    || sha256(candidateBytes) !== report.output.sha256
  ) {
    throw new Error(`Candidate bytes changed after operator materialization: ${task.task_id}.`);
  }
  await assertPixelPolicy(task, candidateBytes);
  const references = sourceReferenceIds(task);
  const output: ProductionArtOutput = Object.freeze({
    schema_version: '1.0.0',
    document_type: 'production-art-output',
    plan_id: `${args.profile}-production-art-v1`,
    profile: args.profile,
    task_id: task.task_id,
    asset_id: `${task.task_id}-operator-admitted`,
    path: task.expected_output_path,
    media_type: 'image/png',
    bytes: candidateBytes.byteLength,
    sha256: report.output.sha256,
    width: task.target.width,
    height: task.target.height,
    alpha_policy: task.alpha_policy,
    pivot: task.pivot,
    roles: Object.freeze(task.role_mappings.map(({ role }) => role)),
    source_reference_ids: references,
    rights: Object.freeze({
      distribution: 'internal-review',
      license: 'LicenseRef-Proprietary',
    }),
  });
  const evidence: ProductionArtGenerationEvidence = Object.freeze({
    schema_version: '1.0.0',
    document_type: 'production-art-generation-evidence',
    provider: Object.freeze({
      id: 'mapsoo-operator-admission',
      version: '1.0.0',
      documentation_url: 'https://github.com/babyrush0101-source/mapsoo-worldforge/blob/main/docs/49_MODEL_BACKED_PRODUCTION_ART.md',
      execution: 'local',
      provenance: 'recorded-replay',
      determinism: 'replay',
    }),
    plan_id: output.plan_id,
    profile: output.profile,
    task_id: output.task_id,
    model: args.model,
    workflow: 'recorded-replay',
    source: Object.freeze({
      media_type: 'image/png',
      bytes: candidateBytes.byteLength,
      sha256: report.output.sha256,
      width: task.target.width,
      height: task.target.height,
    }),
    normalized: Object.freeze({
      media_type: 'image/png',
      bytes: candidateBytes.byteLength,
      sha256: report.output.sha256,
      width: task.target.width,
      height: task.target.height,
      alpha_policy: task.alpha_policy,
    }),
    postprocess: Object.freeze({
      resize: 'nearest-neighbor-v1',
      alpha_extraction: 'none',
      transparent_rgb_zeroed: true,
      mapped_grid_cells_checked: true,
    }),
    human_review: 'required',
  });
  const snapshot = Uint8Array.from(candidateBytes);
  const result: NormalizedProductionArtResult = Object.freeze({
    output,
    evidence,
    source: Object.freeze({
      byteLength: snapshot.byteLength,
      readBytes: () => Uint8Array.from(snapshot),
    }),
    normalized: Object.freeze({
      byteLength: snapshot.byteLength,
      readBytes: () => Uint8Array.from(snapshot),
    }),
  });
  const runDirectory = `runs/${task.task_id}`;
  const target = resolve(args.outputRoot, ...runDirectory.split('/'));
  assertInside(args.outputRoot, target, 'Run directory');
  await Promise.all([
    writeExclusiveOrIdentical(join(target, 'source.png'), snapshot, 'frozen source'),
    writeExclusiveOrIdentical(join(target, 'normalized.png'), snapshot, 'normalized candidate'),
    writeExclusiveOrIdentical(join(target, 'output.json'), json(output), 'production output'),
    writeExclusiveOrIdentical(join(target, 'evidence.json'), json(evidence), 'generation evidence'),
  ]);
  const admission = Object.freeze({
    task_id: task.task_id,
    candidate_report: basename(reportPath),
    candidate_report_sha256: sha256(reportBytes),
    original_operator_source_sha256: report.source.sha256,
    admitted_png_sha256: report.output.sha256,
    operator_normalization_mode: report.normalization.mode,
    admission: ADMISSION,
    semantic_review: 'pending',
    rights_review: 'pending',
  });
  await writeExclusiveOrIdentical(
    join(target, 'operator-admission.json'),
    json(admission),
    'operator admission',
  );
  return Object.freeze({ result, runDirectory, admission });
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  await realpath(args.candidateRoot);
  await mkdir(args.outputRoot, { recursive: true });
  const plan = createProductionArtPlan(args.profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const admitted = await Promise.all(plan.tasks.map((task) => materializeTask(args, task)));
  for (const { result } of admitted) assertValidProductionArtOutput(result.output, plan);
  const directories = Object.fromEntries(plan.tasks.map((task, index) => [
    task.task_id,
    admitted[index].runDirectory,
  ]));
  const runSet = createProductionArtRunSet(plan, directories);
  const results = Object.fromEntries(plan.tasks.map((task, index) => [
    task.task_id,
    admitted[index].result,
  ]));
  const inventory = await materializeProductionArtRunInventory(plan, runSet, results);
  const characterResult = results['character-character-player-atlas'];
  if (!characterResult) {
    throw new Error('Canonical operator admission is missing its player character task.');
  }
  const characterProjection = await projectProductionCharacterProfile(
    plan,
    characterResult,
    {
      characterId: 'operator-neutral-player',
      identityDigestSha256: await deriveCharacterIdentityDigestSha256(
        characterResult.output.sha256,
      ),
      characterReferenceIds: ['operator-character-reference'],
      ...(args.runtimeDirectionTransform === 'horizontal-flip-left'
        ? {
          runtimeDirectionTransform: {
            horizontalFlipDirections: ['left'] as const,
            provenanceReferenceIds: ['operator-character-reference'],
          },
        }
        : {}),
    },
  );
  await writeExclusiveOrIdentical(
    join(args.outputRoot, 'production-art-run-set.json'),
    json(runSet),
    'production-art run-set',
  );
  await Promise.all([
    writeExclusiveOrIdentical(
      join(args.outputRoot, 'character', 'character-profile-revision.json'),
      serializeCharacterProfileRevisionCanonical(characterProjection.revision),
      'character profile revision',
    ),
    writeExclusiveOrIdentical(
      join(args.outputRoot, 'character', 'character-profile-atlas.png'),
      characterProjection.png.readBytes(),
      'character profile atlas',
    ),
    writeExclusiveOrIdentical(
      join(args.outputRoot, 'character', 'production-character-profile-projection.json'),
      json(characterProjection.record),
      'character profile projection',
    ),
  ]);
  await writeExclusiveOrIdentical(
    join(args.outputRoot, 'operator-admission.json'),
    json({
      schema_version: '1.0.0',
      document_type: 'operator-production-art-run-set-admission',
      profile: args.profile,
      plan_id: plan.plan_id,
      admission: ADMISSION,
      provider: 'mapsoo-operator-admission',
      model_source_label: args.model,
      tasks: admitted.map(({ admission }) => admission),
      gates: {
        human_art: 'pending',
        semantic_direction: 'pending',
        rights: 'pending',
        runtime: 'pending',
        raspberry_pi: 'pending',
        public_release: 'prohibited',
      },
      private_paths_embedded: false,
      character_identity_basis: 'admitted-operator-character-sheet-sha256',
      runtime_direction_transform_declaration: args.runtimeDirectionTransform,
      remote_request_count: 0,
    }),
    'run-set operator admission',
  );
  console.log(JSON.stringify({
    status: 'operator-production-art-run-set-admitted',
    profile: inventory.profile,
    tasks: inventory.items.length,
    providers: inventory.providers,
    models: inventory.models,
    human_review: 'required',
    rights: 'pending',
    public_release: 'prohibited',
    character_profile_revision_id: characterProjection.revision.profile_revision_id,
    runtime_direction_transform: args.runtimeDirectionTransform,
    private_paths_embedded: false,
    remote_request_count: 0,
    manifest: join(args.outputRoot, 'production-art-run-set.json'),
  }, null, 2));
}

main().catch((error) => {
  console.error(`MAPSOO_OPERATOR_RUN_SET_ADMISSION_ERROR ${
    error instanceof Error ? error.message : 'Admission failed.'
  }`);
  process.exitCode = 1;
});
