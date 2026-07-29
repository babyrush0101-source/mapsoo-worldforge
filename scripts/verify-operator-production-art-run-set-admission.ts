import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';

import { encodeRgbaPng } from '../src/adapters/canvas/encode-png';
import {
  createProductionArtPlan,
  type ProductionArtTask,
} from '../src/core/production-art-contract';
import {
  fingerprintCharacterProfileRevision,
  materializeCharacterProfileRevision,
  serializeCharacterProfileRevisionCanonical,
} from '../src/core/character-profile-revision';

const PROFILE = 'side-platformer';
const ADMISSION = 'internal-technical-review-only';
const MODEL = 'offline-ci-fixture';
const PRIVATE_MARKERS = [
  'private-consumer-fixture',
  'private-user@example.invalid',
  'file://',
];

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface CandidateReport {
  readonly schema_version: '1.0.0';
  readonly document_type: 'operator-production-art-candidate';
  readonly profile: typeof PROFILE;
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
    readonly mode: 'proportional-grid';
    readonly mapped_cells_checked: true;
    readonly unmapped_cells_transparent: true;
    readonly transparent_rgb_zeroed: true;
    readonly binary_alpha: true;
  };
  readonly human_review: 'required';
  readonly not_accepted_for: readonly [
    'production-art run-set',
    'public asset-pack release',
  ];
}

function fail(message: string): never {
  throw new Error(message);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function json(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function setPixel(
  rgba: Uint8Array,
  width: number,
  x: number,
  y: number,
  color: readonly [number, number, number, 255],
): void {
  rgba.set(color, (y * width + x) * 4);
}

function fillInset(
  task: ProductionArtTask,
  rgba: Uint8Array,
  column: number,
  row: number,
  marker: number,
): void {
  const left = column * task.target.cell_width;
  const top = row * task.target.cell_height;
  const insetX = Math.max(1, Math.floor(task.target.cell_width / 8));
  const insetY = Math.max(1, Math.floor(task.target.cell_height / 8));
  const color = [
    24 + (marker * 37) % 210,
    32 + (marker * 53) % 200,
    40 + (marker * 71) % 190,
    255,
  ] as const;
  for (let y = top + insetY; y < top + task.target.cell_height - insetY; y += 1) {
    for (let x = left + insetX; x < left + task.target.cell_width - insetX; x += 1) {
      setPixel(rgba, task.target.width, x, y, color);
    }
  }
}

function fillPose(
  task: ProductionArtTask,
  rgba: Uint8Array,
  column: number,
  row: number,
  marker: number,
): void {
  const left = column * task.target.cell_width;
  const top = row * task.target.cell_height;
  const halfWidth = Math.max(8, Math.floor(task.target.cell_width / 4));
  const center = task.pivot.x + (marker % 5) - 2;
  const color = [
    24 + (marker * 37) % 210,
    32 + (marker * 53) % 200,
    40 + (marker * 71) % 190,
    255,
  ] as const;
  for (let y = Math.max(1, task.pivot.y - 72); y <= task.pivot.y; y += 1) {
    for (
      let x = Math.max(1, center - halfWidth);
      x < Math.min(task.target.cell_width - 1, center + halfWidth);
      x += 1
    ) {
      setPixel(rgba, task.target.width, left + x, top + y, color);
    }
  }
}

function candidatePng(task: ProductionArtTask): Uint8Array {
  const { width, height } = task.target;
  const rgba = new Uint8Array(width * height * 4);
  if (task.alpha_policy === 'opaque') {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        setPixel(rgba, width, x, y, [28, 56, 84, 255]);
      }
    }
    return encodeRgbaPng(width, height, rgba);
  }
  if (task.pose_mappings) {
    task.pose_mappings.forEach((pose, index) => {
      fillPose(task, rgba, pose.grid_cell.column, pose.grid_cell.row, index + 1);
    });
  } else if (task.kind === 'background-layer') {
    const insetX = Math.max(1, Math.floor(width / 10));
    const insetY = Math.max(1, Math.floor(height / 10));
    for (let y = insetY; y < height - insetY; y += 1) {
      for (let x = insetX; x < width - insetX; x += 1) {
        setPixel(rgba, width, x, y, [42, 76, 104, 255]);
      }
    }
  } else {
    task.role_mappings.forEach((mapping, index) => {
      const { column, row, column_span: columns, row_span: rows } = mapping.grid_rect;
      for (let rowOffset = 0; rowOffset < rows; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < columns; columnOffset += 1) {
          fillInset(
            task,
            rgba,
            column + columnOffset,
            row + rowOffset,
            index + rowOffset + columnOffset + 1,
          );
        }
      }
    });
  }
  return encodeRgbaPng(width, height, rgba);
}

async function writeCandidates(root: string): Promise<readonly ProductionArtTask[]> {
  await mkdir(root, { recursive: true });
  const plan = createProductionArtPlan(PROFILE, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  for (const task of plan.tasks) {
    const png = candidatePng(task);
    const pngName = `${task.task_id}-candidate.png`;
    const digest = sha256(png);
    const report: CandidateReport = {
      schema_version: '1.0.0',
      document_type: 'operator-production-art-candidate',
      profile: PROFILE,
      task_id: task.task_id,
      status: 'internal-review-candidate',
      distribution: 'internal-review',
      output_license: 'UNRELEASED',
      source: {
        basename: `${task.task_id}-source.png`,
        media_type: 'image/png',
        width: task.target.width,
        height: task.target.height,
        bytes: png.byteLength,
        sha256: digest,
      },
      output: {
        basename: pngName,
        media_type: 'image/png',
        width: task.target.width,
        height: task.target.height,
        bytes: png.byteLength,
        sha256: digest,
        alpha_policy: task.alpha_policy,
      },
      normalization: {
        mode: 'proportional-grid',
        mapped_cells_checked: true,
        unmapped_cells_transparent: true,
        transparent_rgb_zeroed: true,
        binary_alpha: true,
      },
      human_review: 'required',
      not_accepted_for: [
        'production-art run-set',
        'public asset-pack release',
      ],
    };
    await Promise.all([
      writeFile(join(root, report.source.basename), png, { flag: 'wx' }),
      writeFile(join(root, pngName), png, { flag: 'wx' }),
      writeFile(join(root, `${task.task_id}-candidate.json`), json(report), { flag: 'wx' }),
    ]);
  }
  return plan.tasks;
}

async function runAdmission(
  candidateRoot: string,
  outputRoot: string,
  runtimeDirectionTransform: 'none' | 'horizontal-flip-left' = 'horizontal-flip-left',
): Promise<CommandResult> {
  const viteNode = resolve('node_modules/vite-node/vite-node.mjs');
  const runner = resolve('scripts/admit-operator-production-art-run-set.ts');
  const child = spawn(process.execPath, [
    viteNode,
    runner,
    '--profile', PROFILE,
    '--candidate-root', candidateRoot,
    '--out', outputRoot,
    '--admission', ADMISSION,
    '--model', MODEL,
    '--runtime-direction-transform', runtimeDirectionTransform,
  ], {
    cwd: process.cwd(),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  const exitCode = await new Promise<number>((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code) => accept(code ?? -1));
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

async function jsonFiles(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.json')) found.push(path);
    }
  }
  await visit(root);
  return found;
}

async function verifyPositive(
  candidateRoot: string,
  outputRoot: string,
  tasks: readonly ProductionArtTask[],
): Promise<void> {
  const result = await runAdmission(candidateRoot, outputRoot);
  if (result.exitCode !== 0) {
    fail(`Positive admission failed.\n${result.stdout}\n${result.stderr}`);
  }
  const summary = JSON.parse(result.stdout) as Record<string, unknown>;
  if (
    summary.status !== 'operator-production-art-run-set-admitted'
    || summary.tasks !== 9
    || summary.remote_request_count !== 0
    || summary.public_release !== 'prohibited'
    || summary.private_paths_embedded !== false
    || summary.runtime_direction_transform !== 'horizontal-flip-left'
  ) {
    fail('Admission summary does not retain the offline internal-review boundary.');
  }
  const expectedFiles = [
    'production-art-run-set.json',
    'operator-admission.json',
    join('character', 'character-profile-revision.json'),
    join('character', 'character-profile-atlas.png'),
    join('character', 'production-character-profile-projection.json'),
  ];
  for (const path of expectedFiles) {
    await readFile(join(outputRoot, path));
  }
  const runSet = JSON.parse(
    await readFile(join(outputRoot, 'production-art-run-set.json'), 'utf8'),
  ) as {
    document_type?: string;
    profile?: string;
    runs?: Record<string, string>;
  };
  if (
    runSet.document_type !== 'production-art-run-set'
    || runSet.profile !== PROFILE
    || !runSet.runs
    || Object.keys(runSet.runs).length !== tasks.length
  ) {
    fail('Standard production-art run-set is missing or incomplete.');
  }
  const admission = JSON.parse(
    await readFile(join(outputRoot, 'operator-admission.json'), 'utf8'),
  ) as {
    document_type?: string;
    remote_request_count?: number;
    private_paths_embedded?: boolean;
    gates?: { rights?: string; public_release?: string };
    runtime_direction_transform_declaration?: string;
    tasks?: readonly unknown[];
  };
  if (
    admission.document_type !== 'operator-production-art-run-set-admission'
    || admission.remote_request_count !== 0
    || admission.private_paths_embedded !== false
    || admission.gates?.rights !== 'pending'
    || admission.gates.public_release !== 'prohibited'
    || admission.runtime_direction_transform_declaration !== 'horizontal-flip-left'
    || admission.tasks?.length !== tasks.length
  ) {
    fail('Run-set admission record weakens rights, privacy or release gates.');
  }
  const characterRevisionBytes = Uint8Array.from(
    await readFile(join(outputRoot, 'character', 'character-profile-revision.json')),
  );
  const characterRevision = materializeCharacterProfileRevision(
    JSON.parse(Buffer.from(characterRevisionBytes).toString('utf8')),
  );
  const canonicalCharacterRevisionBytes =
    serializeCharacterProfileRevisionCanonical(characterRevision);
  const characterAtlas = Uint8Array.from(
    await readFile(join(outputRoot, 'character', 'character-profile-atlas.png')),
  );
  const characterTask = tasks.find(({ task_id: taskId }) =>
    taskId === 'character-character-player-atlas');
  if (
    characterRevision.document_type !== 'character-profile-revision'
    || typeof characterRevision.profile_revision_id !== 'string'
    || Buffer.compare(
      Buffer.from(characterRevisionBytes),
      Buffer.from(canonicalCharacterRevisionBytes),
    ) !== 0
    || sha256(characterRevisionBytes)
      !== await fingerprintCharacterProfileRevision(characterRevision)
    || characterRevision.runtime_direction_transform?.strategy !== 'horizontal-flip'
    || characterRevision.runtime_direction_transform.directions?.join(',') !== 'left'
    || characterRevision.runtime_direction_transform.provenance?.basis
      !== 'operator-declared-direction-equivalence'
    || characterRevision.runtime_direction_transform.provenance.source_reference_ids?.join(',')
      !== 'operator-character-reference'
    || !characterTask
    || sha256(characterAtlas) !== sha256(candidatePng(characterTask))
  ) {
    fail('Character revision or exact admitted atlas is invalid.');
  }
  for (const task of tasks) {
    const runRoot = join(outputRoot, 'runs', task.task_id);
    const taskAdmission = JSON.parse(
      await readFile(join(runRoot, 'operator-admission.json'), 'utf8'),
    ) as {
      task_id?: string;
      admission?: string;
      semantic_review?: string;
      rights_review?: string;
    };
    if (
      taskAdmission.task_id !== task.task_id
      || taskAdmission.admission !== ADMISSION
      || taskAdmission.semantic_review !== 'pending'
      || taskAdmission.rights_review !== 'pending'
    ) {
      fail(`Per-task operator admission is invalid: ${task.task_id}.`);
    }
  }
  const forbiddenRoots = [candidateRoot, outputRoot].map((path) => path.toLowerCase());
  for (const path of await jsonFiles(outputRoot)) {
    const text = await readFile(path, 'utf8');
    const lower = text.toLowerCase();
    if (
      PRIVATE_MARKERS.some((marker) => lower.includes(marker))
      || forbiddenRoots.some((marker) => lower.includes(marker))
      || /(?:^|[^a-z0-9])[a-z]:[\\/]/i.test(text)
    ) {
      fail(`Admission JSON embeds a private marker or absolute local path: ${
        relative(outputRoot, path).split(sep).join('/')
      }.`);
    }
  }
}

async function verifyTamperNegative(sourceRoot: string, root: string): Promise<void> {
  const candidateRoot = join(root, 'tamper-candidates');
  await cp(sourceRoot, candidateRoot, { recursive: true, errorOnExist: true });
  const path = join(candidateRoot, 'terrain-sheet-candidate.png');
  await writeFile(path, randomBytes(8), { flag: 'a' });
  const result = await runAdmission(candidateRoot, join(root, 'tamper-output'));
  if (
    result.exitCode === 0
    || !result.stderr.includes('MAPSOO_OPERATOR_RUN_SET_ADMISSION_ERROR')
    || !result.stderr.includes('changed after operator materialization')
  ) {
    fail('Tampered candidate bytes were not rejected fail closed.');
  }
}

async function verifyRightsReportNegative(sourceRoot: string, root: string): Promise<void> {
  const candidateRoot = join(root, 'rights-candidates');
  await cp(sourceRoot, candidateRoot, { recursive: true, errorOnExist: true });
  const path = join(candidateRoot, 'scene-direction-candidate.json');
  const report = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  report.output_license = 'CC0-1.0';
  await writeFile(path, json(report));
  const result = await runAdmission(candidateRoot, join(root, 'rights-output'));
  if (
    result.exitCode === 0
    || !result.stderr.includes('MAPSOO_OPERATOR_RUN_SET_ADMISSION_ERROR')
    || !result.stderr.includes('frozen unreleased operator result')
  ) {
    fail('Publishable rights/report mutation was not rejected fail closed.');
  }
}

async function verifyExplicitNoneDoesNotInfer(
  candidateRoot: string,
  outputRoot: string,
): Promise<void> {
  const result = await runAdmission(candidateRoot, outputRoot, 'none');
  if (result.exitCode !== 0) {
    fail(`Explicit-none admission failed.\n${result.stdout}\n${result.stderr}`);
  }
  const revision = JSON.parse(
    await readFile(join(outputRoot, 'character', 'character-profile-revision.json'), 'utf8'),
  ) as Record<string, unknown>;
  const admission = JSON.parse(
    await readFile(join(outputRoot, 'operator-admission.json'), 'utf8'),
  ) as Record<string, unknown>;
  if (
    'runtime_direction_transform' in revision
    || admission.runtime_direction_transform_declaration !== 'none'
  ) {
    fail('Explicit-none admission inferred a direction transform from candidate pixels.');
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'private-consumer-fixture-operator-admission-'));
  try {
    const candidateRoot = join(root, 'candidates');
    const outputRoot = join(root, 'admitted');
    const tasks = await writeCandidates(candidateRoot);
    if (tasks.length !== 9) fail(`Expected 9 side-platformer tasks, received ${tasks.length}.`);
    await verifyPositive(candidateRoot, outputRoot, tasks);
    await verifyExplicitNoneDoesNotInfer(candidateRoot, join(root, 'independent-output'));
    await verifyTamperNegative(candidateRoot, root);
    await verifyRightsReportNegative(candidateRoot, root);
    console.log(
      'MAPSOO_OPERATOR_RUN_SET_ADMISSION_OK '
      + 'profile=side-platformer tasks=9 character_projection=true '
      + 'direction_transform=horizontal-flip-left explicit_opt_in=true '
      + 'explicit_none_no_inference=true '
      + 'path_privacy=true remote_requests=0 public_release=prohibited '
      + 'negative_tamper=true negative_rights_report=true',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`MAPSOO_OPERATOR_RUN_SET_ADMISSION_VERIFY_ERROR ${
    error instanceof Error ? error.message : 'Verifier failed.'
  }`);
  process.exitCode = 1;
});
