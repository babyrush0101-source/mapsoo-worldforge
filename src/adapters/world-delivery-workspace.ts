import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  fingerprintConfirmedWorldCreationIntake,
  materializeConfirmedWorldCreationIntake,
  projectConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from '../core/confirmed-world-creation-intake';
import {
  bindReferenceImage,
  type ReferenceImageDescriptor,
} from '../core/reference-image';
import {
  createProductionArtPlan,
} from '../core/production-art-contract';
import {
  materializeCharacterProfileRevision,
  serializeCharacterProfileRevisionCanonical,
} from '../core/character-profile-revision';
import {
  createWorldRunnerDelivery,
  type WorldRunnerArchitecture,
  type WorldRunnerArtifactKind,
  type WorldRunnerDelivery,
} from '../core/world-runner-delivery';
import { parseStrictJsonDocument } from './import-world-spec';

const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const GODOT_VERSION =
  /^(?:4|[5-9]|[1-9]\d+)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?(?:[-+][0-9A-Za-z.-]+)?$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 2_147_483_647;

export interface PreparedWorldDeliveryWorkspace {
  readonly schema_version: '1.0.0';
  readonly document_type: 'world-delivery-workspace';
  readonly intake_id: string;
  readonly intake_sha256: string;
  readonly profile: ConfirmedWorldCreationIntake['profile'];
  readonly target: ConfirmedWorldCreationIntake['target'];
  readonly character_id: string;
  readonly task_count: number;
  readonly request_budget: number;
  readonly files: Readonly<Record<string, Readonly<{
    bytes: number;
    sha256: string;
  }>>>;
  readonly next_command: 'production-art:workflow';
  readonly remote_request_count: 0;
}

export interface GodotHeadlessSmokeReport {
  readonly schema_version: '1.0.0';
  readonly document_type: 'godot-headless-smoke-report';
  readonly passed: true;
  readonly godot_version: string;
  readonly world_id: string;
  readonly pack_sha256: string;
  readonly runtime_artifact_sha256: string;
  readonly launch_binding?: Readonly<{
    status: 'bound';
    spawn_id: string;
    player_slot_id: string;
  }>;
  readonly character_binding?: Readonly<{
    status: 'bound';
    profile_revision_id: string;
    revision_sha256: string;
    atlas_sha256: string;
  }>;
}

export interface PrepareWorldDeliveryWorkspaceInput {
  readonly intake: unknown;
  readonly referenceRoot: string;
  readonly workspace: string;
  readonly characterId: string;
  readonly quality?: 'low' | 'medium' | 'high';
  readonly requestBudget?: number;
}

export interface FinalizeWorldRunnerDeliveryInput {
  readonly intake: unknown;
  readonly bundleRoot: string;
  readonly worldPackPath: string;
  readonly runtimeArtifact: Readonly<{
    kind: WorldRunnerArtifactKind;
    architecture: WorldRunnerArchitecture;
    path: string;
  }>;
  readonly runtimeContractPath: string;
  readonly characterRevisionPath: string;
  readonly verificationReportPath: string;
  readonly deliveryId: string;
  readonly spawnId: string;
  readonly playerSlotId: string;
  readonly outputPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function errorCode(value: unknown): string | undefined {
  if (
    typeof value !== 'object'
    || value === null
    || !('code' in value)
    || typeof value.code !== 'string'
  ) return undefined;
  return value.code;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      hash.update(typeof chunk === 'string' ? chunk : Uint8Array.from(chunk));
    });
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

function portableRelativePath(value: string, label: string): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || !SAFE_PATH.test(value)
    || value.includes('\\')
    || value.startsWith('/')
    || isAbsolute(value)
    || value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a safe portable relative path.`);
  }
  return value;
}

async function resolveFileInside(rootValue: string, pathValue: string, label: string): Promise<string> {
  const portablePath = portableRelativePath(pathValue, label);
  const root = await realpath(resolve(rootValue));
  const candidate = await realpath(resolve(root, ...portablePath.split('/')));
  const fromRoot = relative(root, candidate);
  if (
    fromRoot.length < 1
    || fromRoot === '..'
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
    || !(await stat(candidate)).isFile()
  ) {
    throw new Error(`${label} must resolve to a file inside its declared root.`);
  }
  return candidate;
}

async function readBoundedJson(path: string, label: string): Promise<unknown> {
  const bytes = await readFile(path);
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error(`${label} must be between 2 bytes and 4 MiB.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain strict UTF-8 JSON.`);
  }
  const parsed = parseStrictJsonDocument(text, label);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

function assertSafeId(value: string, label: string, maximum = 80): string {
  if (value.length < 1 || value.length > maximum || !SAFE_ID.test(value)) {
    throw new Error(`${label} must use bounded lowercase kebab-case.`);
  }
  return value;
}

function worldBrief(intake: ConfirmedWorldCreationIntake): string {
  const facts = intake.facts;
  return [
    `Premise: ${facts.premise}`,
    `Worldview: ${facts.worldview}`,
    `Terrain: ${facts.terrain}`,
    `Geography: ${facts.geography}`,
    `Culture: ${facts.culture}`,
    `Ecology: ${facts.ecology}`,
    `Traversal: ${facts.traversal}`,
    `Landmarks: ${facts.landmarks}`,
  ].join('\n');
}

function styleBible(intake: ConfirmedWorldCreationIntake): string {
  return [
    `Profile: ${intake.profile}`,
    `Mood and readability: ${intake.facts.mood}`,
    `Art direction: ${intake.facts.art_direction}`,
    'Character rule: preserve recognizable identity cues while adapting proportions, materials, palette, lighting, and animation language to this world profile.',
    'Runtime rule: every gameplay role must remain readable at the declared camera scale; decorative detail must not obscure collision, hazards, exits, or interaction targets.',
    'Output rule: generate a coherent complete 2D set for internal review; do not introduce 3D assets, private product fields, text logos, signatures, or watermarks.',
  ].join('\n');
}

function referenceName(reference: ReferenceImageDescriptor): string {
  const role = reference.role === 'environment-style' ? 'environment' : 'character';
  return `references/${role}.${reference.mediaType === 'image/png' ? 'png' : 'jpg'}`;
}

async function existingFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
      else throw new Error('Workspace contains a non-file, non-directory entry.');
    }
  }
  await visit(root);
  return files;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

async function writeDirectoryAtomically(
  workspace: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const target = resolve(workspace);
  try {
    const info = await stat(target);
    if (!info.isDirectory()) throw new Error('Existing workspace is not a directory.');
    const names = await existingFiles(target);
    if (names.length !== files.size
      || names.some((name) => !files.has(name))) {
      throw new Error('Existing workspace inventory differs from this intake.');
    }
    for (const [name, bytes] of files) {
      if (!equalBytes(Uint8Array.from(await readFile(resolve(target, name))), bytes)) {
        throw new Error(`Existing workspace file differs: ${name}.`);
      }
    }
    return;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }

  const parent = dirname(target);
  const temporary = resolve(parent, `.${basename(target)}.tmp-${randomUUID()}`);
  await mkdir(parent, { recursive: true });
  await mkdir(temporary, { recursive: false });
  try {
    for (const [name, bytes] of files) {
      const path = resolve(temporary, ...name.split('/'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: 'wx' });
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function prepareWorldDeliveryWorkspace(
  input: PrepareWorldDeliveryWorkspaceInput,
): Promise<PreparedWorldDeliveryWorkspace> {
  const intake = await materializeConfirmedWorldCreationIntake(input.intake);
  const projection = await projectConfirmedWorldCreationIntake(intake);
  const characterId = assertSafeId(input.characterId, 'Character id', 48);
  const quality = input.quality ?? 'medium';
  if (!['low', 'medium', 'high'].includes(quality)) {
    throw new Error('Production quality must be low, medium, or high.');
  }
  const plan = createProductionArtPlan(intake.profile, {
    distribution: 'internal-review',
    license: 'LicenseRef-Proprietary',
  });
  const requestBudget = input.requestBudget ?? plan.tasks.length;
  if (
    !Number.isSafeInteger(requestBudget)
    || requestBudget < plan.tasks.length
    || requestBudget > 64
  ) {
    throw new Error(`Request budget must be from ${plan.tasks.length} to 64.`);
  }

  const referenceRecords = await Promise.all(intake.references.map(async (descriptor) => {
    const sourcePath = await resolveFileInside(
      input.referenceRoot,
      descriptor.path,
      `${descriptor.role} reference`,
    );
    const bytes = Uint8Array.from(await readFile(sourcePath));
    await bindReferenceImage(descriptor, bytes);
    return { descriptor, bytes, name: referenceName(descriptor) };
  }));
  const environment = referenceRecords.find(({ descriptor }) =>
    descriptor.role === 'environment-style')!;
  const character = referenceRecords.find(({ descriptor }) =>
    descriptor.role === 'character')!;
  const intakeSha256 = await fingerprintConfirmedWorldCreationIntake(intake);
  const workspace = resolve(input.workspace);
  const job = {
    schema_version: '1.0.0',
    document_type: 'production-art-workflow-job',
    workflow_id: intake.intake_id,
    profile: intake.profile,
    quality,
    request_budget: requestBudget,
    world_brief_file: resolve(workspace, 'world-brief.txt'),
    style_bible_file: resolve(workspace, 'style-bible.txt'),
    environment_reference: resolve(workspace, ...environment.name.split('/')),
    character_reference: resolve(workspace, ...character.name.split('/')),
    character_id: characterId,
    private_input_binding: {
      confirmed_intake_sha256: intakeSha256,
      seed: intake.seed,
      character_identity_digest_sha256:
        intake.character_source.identity_digest_sha256,
      environment_reference_id: environment.descriptor.id,
      character_reference_id: character.descriptor.id,
    },
    private_output_root: resolve(
      dirname(workspace),
      `${basename(workspace)}-production-art-output`,
    ),
  };
  const sourceFiles = new Map<string, Uint8Array>([
    ['confirmed-intake.json', jsonBytes(intake)],
    ['confirmed-intake-projection.json', jsonBytes(projection)],
    ['world-brief.txt', textBytes(worldBrief(intake))],
    ['style-bible.txt', textBytes(styleBible(intake))],
    ['production-art-workflow-job.json', jsonBytes(job)],
    ...referenceRecords.map(({ name, bytes }) => [name, bytes] as const),
  ]);
  const inventory = Object.fromEntries(
    [...sourceFiles.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([path, bytes]) => [path, {
        bytes: bytes.byteLength,
        sha256: sha256Bytes(bytes),
      }]),
  );
  const manifest: PreparedWorldDeliveryWorkspace = Object.freeze({
    schema_version: '1.0.0',
    document_type: 'world-delivery-workspace',
    intake_id: intake.intake_id,
    intake_sha256: intakeSha256,
    profile: intake.profile,
    target: intake.target,
    character_id: characterId,
    task_count: plan.tasks.length,
    request_budget: requestBudget,
    files: Object.freeze(inventory),
    next_command: 'production-art:workflow',
    remote_request_count: 0,
  });
  const files = new Map(sourceFiles);
  files.set('workspace-manifest.json', jsonBytes(manifest));
  await writeDirectoryAtomically(workspace, files);
  return manifest;
}

function materializeVerificationReport(value: unknown): GodotHeadlessSmokeReport {
  if (!isRecord(value)) throw new Error('Godot headless smoke report must be an object.');
  exactKeys(value, [
    'schema_version',
    'document_type',
    'passed',
    'godot_version',
    'world_id',
    'pack_sha256',
    'runtime_artifact_sha256',
    ...('launch_binding' in value ? ['launch_binding'] : []),
    ...('character_binding' in value ? ['character_binding'] : []),
  ], 'Godot headless smoke report');
  if (
    value.schema_version !== '1.0.0'
    || value.document_type !== 'godot-headless-smoke-report'
    || value.passed !== true
    || typeof value.godot_version !== 'string'
    || !GODOT_VERSION.test(value.godot_version)
    || typeof value.world_id !== 'string'
    || !SAFE_ID.test(value.world_id)
    || typeof value.pack_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.pack_sha256)
    || typeof value.runtime_artifact_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.runtime_artifact_sha256)
  ) {
    throw new Error('Godot headless smoke report values are invalid.');
  }
  if ('launch_binding' in value) {
    if (!isRecord(value.launch_binding)) {
      throw new Error('Godot headless smoke launch binding must be an object.');
    }
    exactKeys(value.launch_binding, [
      'status',
      'spawn_id',
      'player_slot_id',
    ], 'Godot headless smoke launch binding');
    if (
      value.launch_binding.status !== 'bound'
      || typeof value.launch_binding.spawn_id !== 'string'
      || value.launch_binding.spawn_id.length > 80
      || !SAFE_ID.test(value.launch_binding.spawn_id)
      || typeof value.launch_binding.player_slot_id !== 'string'
      || value.launch_binding.player_slot_id.length > 80
      || !SAFE_ID.test(value.launch_binding.player_slot_id)
    ) {
      throw new Error('Godot headless smoke launch binding values are invalid.');
    }
  }
  if ('character_binding' in value) {
    if (!isRecord(value.character_binding)) {
      throw new Error('Godot headless smoke character binding must be an object.');
    }
    exactKeys(value.character_binding, [
      'status',
      'profile_revision_id',
      'revision_sha256',
      'atlas_sha256',
    ], 'Godot headless smoke character binding');
    if (
      value.character_binding.status !== 'bound'
      || typeof value.character_binding.profile_revision_id !== 'string'
      || !SAFE_ID.test(value.character_binding.profile_revision_id)
      || typeof value.character_binding.revision_sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.character_binding.revision_sha256)
      || typeof value.character_binding.atlas_sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(value.character_binding.atlas_sha256)
    ) {
      throw new Error('Godot headless smoke character binding values are invalid.');
    }
  }
  return value as unknown as GodotHeadlessSmokeReport;
}

async function artifactDescriptor(
  bundleRoot: string,
  path: string,
  label: string,
): Promise<Readonly<{ path: string; bytes: number; sha256: string }>> {
  const portablePath = portableRelativePath(path, label);
  const absolute = await resolveFileInside(bundleRoot, portablePath, label);
  const size = (await stat(absolute)).size;
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ARTIFACT_BYTES) {
    throw new Error(`${label} must be from 1 byte to 2 GiB minus one.`);
  }
  return Object.freeze({
    path: portablePath,
    bytes: size,
    sha256: await sha256File(absolute),
  });
}

async function writeFileExclusiveOrIdentical(pathValue: string, bytes: Uint8Array): Promise<void> {
  const path = resolve(pathValue);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
    const existing = Uint8Array.from(await readFile(path));
    if (!equalBytes(existing, bytes)) {
      throw new Error('Refusing to overwrite a different World Runner delivery.');
    }
  }
}

export async function finalizeWorldRunnerDelivery(
  input: FinalizeWorldRunnerDeliveryInput,
): Promise<WorldRunnerDelivery> {
  const intake = await materializeConfirmedWorldCreationIntake(input.intake);
  const [worldPack, runtimeArtifact, runtimeContractValue, revisionValue, reportValue] =
    await Promise.all([
      artifactDescriptor(input.bundleRoot, input.worldPackPath, 'World pack'),
      artifactDescriptor(
        input.bundleRoot,
        input.runtimeArtifact.path,
        'Runtime artifact',
      ),
      resolveFileInside(
        input.bundleRoot,
        input.runtimeContractPath,
        'Runtime contract',
      ).then((path) => readBoundedJson(path, 'Runtime contract')),
      resolveFileInside(
        input.bundleRoot,
        input.characterRevisionPath,
        'Character revision',
      ).then((path) => readBoundedJson(path, 'Character revision')),
      resolveFileInside(
        input.bundleRoot,
        input.verificationReportPath,
        'Verification report',
      ).then((path) => readBoundedJson(path, 'Verification report')),
    ]);
  const revision = materializeCharacterProfileRevision(revisionValue);
  const report = materializeVerificationReport(reportValue);
  if (
    !report.launch_binding
    || report.launch_binding.spawn_id !== input.spawnId
    || report.launch_binding.player_slot_id !== input.playerSlotId
  ) {
    throw new Error(
      'Headless smoke report is missing or does not bind the requested launch spawn and player slot.',
    );
  }
  const revisionPath = portableRelativePath(
    input.characterRevisionPath,
    'Character revision',
  );
  const revisionAbsolute = await resolveFileInside(
    input.bundleRoot,
    revisionPath,
    'Character revision',
  );
  const storedRevisionBytes = Uint8Array.from(await readFile(revisionAbsolute));
  if (!equalBytes(storedRevisionBytes, serializeCharacterProfileRevisionCanonical(revision))) {
    throw new Error('Character revision file must contain exact canonical bytes.');
  }
  const atlas = await artifactDescriptor(
    input.bundleRoot,
    revision.atlas.path,
    'Character atlas',
  );
  if (
    atlas.bytes !== revision.atlas.bytes
    || atlas.sha256 !== revision.atlas.sha256
  ) {
    throw new Error('Character atlas does not match the canonical character revision.');
  }
  if (
    report.character_binding
    && (
      report.character_binding.profile_revision_id !== revision.profile_revision_id
      || report.character_binding.revision_sha256 !== sha256Bytes(storedRevisionBytes)
      || report.character_binding.atlas_sha256 !== atlas.sha256
    )
  ) {
    throw new Error('Headless smoke report did not bind the exact character revision and atlas.');
  }
  if (
    revision.profile !== intake.profile
    || revision.source_identity.identity_digest_sha256
      !== intake.character_source.identity_digest_sha256
  ) {
    throw new Error('Character revision does not match the confirmed intake identity/profile.');
  }
  if (
    report.pack_sha256 !== worldPack.sha256
    || report.runtime_artifact_sha256 !== runtimeArtifact.sha256
  ) {
    throw new Error('Headless smoke report does not bind the exact pack and runtime artifact.');
  }
  const delivery = await createWorldRunnerDelivery({
    delivery_id: assertSafeId(input.deliveryId, 'Delivery id'),
    intake_sha256: await fingerprintConfirmedWorldCreationIntake(intake),
    target: intake.target,
    world_pack: worldPack,
    runtime_artifact: {
      kind: input.runtimeArtifact.kind,
      architecture: input.runtimeArtifact.architecture,
      ...runtimeArtifact,
    },
    runtime_contract: runtimeContractValue as WorldRunnerDelivery['runtime_contract'],
    character_profile_revision: {
      path: revisionPath,
      revision,
    },
    launch: {
      spawn_id: assertSafeId(input.spawnId, 'Spawn id'),
      player_slot_id: assertSafeId(input.playerSlotId, 'Player slot id'),
    },
    verification: {
      godot_version: report.godot_version,
      headless_smoke_passed: true,
      report_path: portableRelativePath(
        input.verificationReportPath,
        'Verification report',
      ),
      report_sha256: await sha256File(await resolveFileInside(
        input.bundleRoot,
        input.verificationReportPath,
        'Verification report',
      )),
    },
  });
  if (
    delivery.runtime_contract.world.world_id !== report.world_id
    || delivery.runtime_contract.world.profile !== intake.profile
  ) {
    throw new Error('Headless smoke report/runtime contract does not match the confirmed world.');
  }
  await writeFileExclusiveOrIdentical(input.outputPath, jsonBytes(delivery));
  return delivery;
}
