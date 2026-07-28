import JSZip from 'jszip';

import { parseStrictJsonDocument } from './import-world-spec';
import {
  fingerprintConfirmedWorldCreationIntake,
  materializeConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from '../core/confirmed-world-creation-intake';
import {
  bindReferenceImage,
  type ReferenceImageDescriptor,
} from '../core/reference-image';
import {
  PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH,
  PRIVATE_PRODUCTION_HANDOFF_MANIFEST_PATH,
  PRIVATE_PRODUCTION_HANDOFF_README_PATH,
  encodePrivateProductionHandoffManifest,
  materializePrivateProductionHandoffManifest,
  type PrivateProductionHandoffManifest,
} from '../core/private-production-handoff';

export interface PrivateProductionHandoffReferenceInput {
  readonly descriptor: ReferenceImageDescriptor;
  readonly bytes: Uint8Array;
}

export interface BuiltPrivateProductionHandoff {
  readonly filename: string;
  readonly bytes: number;
  readonly manifest: PrivateProductionHandoffManifest;
  readBytes(): Uint8Array;
}

export interface ReadPrivateProductionHandoff {
  readonly manifest: PrivateProductionHandoffManifest;
  readonly intake: ConfirmedWorldCreationIntake;
  readonly references: readonly [
    PrivateProductionHandoffReferenceInput,
    PrivateProductionHandoffReferenceInput,
  ];
}

export type PrivateProductionHandoffArchiveErrorCode =
  | 'private-handoff-archive.invalid-input'
  | 'private-handoff-archive.invalid-archive'
  | 'private-handoff-archive.invalid-inventory'
  | 'private-handoff-archive.integrity';

export class PrivateProductionHandoffArchiveError extends Error {
  constructor(
    readonly code: PrivateProductionHandoffArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PrivateProductionHandoffArchiveError';
  }
}

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

function fail(
  code: PrivateProductionHandoffArchiveErrorCode,
  message: string,
): never {
  throw new PrivateProductionHandoffArchiveError(code, message);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function readme(intakeId: string): Uint8Array {
  return new TextEncoder().encode([
    '# Private production handoff',
    '',
    `Intake: ${intakeId}`,
    '',
    'This local archive contains the original environment and character references.',
    'Do not publish it, attach it to an issue, or commit it to a public repository.',
    '',
    'Prepare the existing production workflow without a remote request:',
    '',
    '```bash',
    'pnpm world-delivery:workspace -- prepare \\',
    '  --handoff <this-archive.zip> \\',
    '  --workspace <private-workspace-outside-the-repository> \\',
    '  --character-id <neutral-kebab-case-id> \\',
    '  --completed-at <canonical-UTC-ISO> \\',
    '  --provider openai|spritecook',
    '```',
    '',
    'Real generation remains a separate, explicitly authorized step.',
    '',
  ].join('\n'));
}

function strictUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail(
      'private-handoff-archive.invalid-archive',
      `${label} must contain strict UTF-8.`,
    );
  }
}

function strictJson(bytes: Uint8Array, label: string): unknown {
  const parsed = parseStrictJsonDocument(strictUtf8(bytes, label), label);
  if (!parsed.ok) {
    return fail(
      'private-handoff-archive.invalid-archive',
      `${label} is not strict JSON.`,
    );
  }
  return parsed.value;
}

function archiveRoot(intakeId: string): string {
  return `${intakeId}-private-production-handoff`;
}

export async function buildPrivateProductionHandoff(
  intakeValue: unknown,
  referenceInputs: readonly PrivateProductionHandoffReferenceInput[],
): Promise<BuiltPrivateProductionHandoff> {
  const intake = await materializeConfirmedWorldCreationIntake(intakeValue);
  if (referenceInputs.length !== 2) {
    fail(
      'private-handoff-archive.invalid-input',
      'Private production handoff requires exactly two reference inputs.',
    );
  }
  const references = await Promise.all(referenceInputs.map(async (input) => {
    const descriptor = intake.references.find(
      ({ id, role }) =>
        id === input.descriptor.id && role === input.descriptor.role,
    );
    if (!descriptor || descriptor.path !== input.descriptor.path) {
      return fail(
        'private-handoff-archive.invalid-input',
        'Reference input does not match the confirmed intake.',
      );
    }
    const bytes = Uint8Array.from(input.bytes);
    try {
      await bindReferenceImage(descriptor, bytes);
    } catch {
      return fail(
        'private-handoff-archive.integrity',
        'Reference input bytes do not match the confirmed intake.',
      );
    }
    return Object.freeze({ descriptor, bytes });
  }));
  if (
    new Set(references.map(({ descriptor }) => descriptor.id)).size !== 2
    || references.map(({ descriptor }) => descriptor.role).sort().join(',')
      !== 'character,environment-style'
  ) {
    fail(
      'private-handoff-archive.invalid-input',
      'Reference inputs are not role-complete.',
    );
  }
  const intakeBytes = jsonBytes(intake);
  const instructions = readme(intake.intake_id);
  const manifest = materializePrivateProductionHandoffManifest({
    schema_version: '1.0.0',
    document_type: 'private-production-handoff',
    intake_id: intake.intake_id,
    intake_sha256: await fingerprintConfirmedWorldCreationIntake(intake),
    profile: intake.profile,
    target: intake.target,
    intake: {
      path: PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH,
      bytes: intakeBytes.byteLength,
      sha256: await sha256(intakeBytes),
    },
    references: await Promise.all(references.map(async ({ descriptor, bytes }) => ({
      id: descriptor.id,
      role: descriptor.role,
      path: descriptor.path,
      media_type: descriptor.mediaType,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
    }))),
    instructions: {
      path: PRIVATE_PRODUCTION_HANDOFF_README_PATH,
      bytes: instructions.byteLength,
      sha256: await sha256(instructions),
    },
    privacy: {
      contains_original_references: true,
      public_distribution_allowed: false,
    },
    remote_request_count: 0,
  });
  const manifestBytes = encodePrivateProductionHandoffManifest(manifest);
  const root = archiveRoot(intake.intake_id);
  const archive = new JSZip();
  const files = [
    [PRIVATE_PRODUCTION_HANDOFF_MANIFEST_PATH, manifestBytes],
    [PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH, intakeBytes],
    [PRIVATE_PRODUCTION_HANDOFF_README_PATH, instructions],
    ...references.map(({ descriptor, bytes }) => [descriptor.path, bytes] as const),
  ] as const;
  for (const [path, bytes] of [...files].sort(([left], [right]) =>
    left.localeCompare(right, 'en'))) {
    archive.file(`${root}/${path}`, bytes, {
      binary: true,
      createFolders: false,
      date: ZIP_DATE,
      unixPermissions: 0o100600,
    });
  }
  let zipBytes: Uint8Array;
  try {
    zipBytes = await archive.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
      streamFiles: false,
    });
  } catch {
    return fail(
      'private-handoff-archive.invalid-archive',
      'Private production handoff ZIP could not be created.',
    );
  }
  if (zipBytes.byteLength < 1 || zipBytes.byteLength > MAX_ARCHIVE_BYTES) {
    fail(
      'private-handoff-archive.invalid-archive',
      'Private production handoff ZIP size is invalid.',
    );
  }
  const snapshot = Uint8Array.from(zipBytes);
  return Object.freeze({
    filename: `${root}.zip`,
    bytes: snapshot.byteLength,
    manifest,
    readBytes: () => Uint8Array.from(snapshot),
  });
}

async function readEntry(
  archive: JSZip,
  path: string,
  expectedBytes: number,
  expectedSha256: string,
): Promise<Uint8Array> {
  const entry = archive.file(path);
  if (!entry || entry.dir) {
    return fail(
      'private-handoff-archive.invalid-inventory',
      'Private production handoff is missing a declared file.',
    );
  }
  const bytes = Uint8Array.from(await entry.async('uint8array'));
  if (
    bytes.byteLength !== expectedBytes
    || bytes.byteLength > MAX_ENTRY_BYTES
    || await sha256(bytes) !== expectedSha256
  ) {
    return fail(
      'private-handoff-archive.integrity',
      'Private production handoff file integrity check failed.',
    );
  }
  return bytes;
}

export async function readPrivateProductionHandoff(
  archiveBytesValue: Uint8Array,
): Promise<ReadPrivateProductionHandoff> {
  if (
    !(archiveBytesValue instanceof Uint8Array)
    || archiveBytesValue.byteLength < 1
    || archiveBytesValue.byteLength > MAX_ARCHIVE_BYTES
  ) {
    fail(
      'private-handoff-archive.invalid-input',
      'Private production handoff ZIP bytes are invalid.',
    );
  }
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(Uint8Array.from(archiveBytesValue), {
      checkCRC32: true,
      createFolders: false,
    });
  } catch {
    return fail(
      'private-handoff-archive.invalid-archive',
      'Private production handoff ZIP could not be read.',
    );
  }
  const names = Object.keys(archive.files);
  if (
    names.length !== 5
    || names.some((name) =>
      name.includes('\\')
      || name.startsWith('/')
      || name.endsWith('/')
      || name.split('/').some((segment) => segment === '.' || segment === '..')
      || /[\u0000-\u001f\u007f-\u009f]/u.test(name))
  ) {
    fail(
      'private-handoff-archive.invalid-inventory',
      'Private production handoff ZIP inventory is invalid.',
    );
  }
  const manifestNames = names.filter((name) =>
    name.endsWith(`/${PRIVATE_PRODUCTION_HANDOFF_MANIFEST_PATH}`));
  if (manifestNames.length !== 1) {
    fail(
      'private-handoff-archive.invalid-inventory',
      'Private production handoff ZIP must contain one manifest.',
    );
  }
  const manifestEntry = archive.file(manifestNames[0]);
  if (!manifestEntry) {
    fail(
      'private-handoff-archive.invalid-inventory',
      'Private production handoff manifest is missing.',
    );
  }
  const manifestBytes = Uint8Array.from(
    await manifestEntry.async('uint8array'),
  );
  if (manifestBytes.byteLength < 2 || manifestBytes.byteLength > 128 * 1024) {
    fail(
      'private-handoff-archive.invalid-archive',
      'Private production handoff manifest size is invalid.',
    );
  }
  let manifest: PrivateProductionHandoffManifest;
  try {
    manifest = materializePrivateProductionHandoffManifest(
      strictJson(manifestBytes, 'Private production handoff manifest'),
    );
  } catch (error) {
    if (error instanceof PrivateProductionHandoffArchiveError) throw error;
    return fail(
      'private-handoff-archive.invalid-archive',
      'Private production handoff manifest is invalid.',
    );
  }
  const root = archiveRoot(manifest.intake_id);
  if (manifestNames[0] !== `${root}/${PRIVATE_PRODUCTION_HANDOFF_MANIFEST_PATH}`) {
    fail(
      'private-handoff-archive.invalid-inventory',
      'Private production handoff root is not canonical.',
    );
  }
  const expectedNames = new Set([
    `${root}/${PRIVATE_PRODUCTION_HANDOFF_MANIFEST_PATH}`,
    `${root}/${manifest.intake.path}`,
    `${root}/${manifest.instructions.path}`,
    ...manifest.references.map(({ path }) => `${root}/${path}`),
  ]);
  if (
    expectedNames.size !== 5
    || names.some((name) => !expectedNames.has(name))
  ) {
    fail(
      'private-handoff-archive.invalid-inventory',
      'Private production handoff ZIP contains undeclared files.',
    );
  }
  const intakeBytes = await readEntry(
    archive,
    `${root}/${manifest.intake.path}`,
    manifest.intake.bytes,
    manifest.intake.sha256,
  );
  let intake: ConfirmedWorldCreationIntake;
  try {
    intake = await materializeConfirmedWorldCreationIntake(
      strictJson(intakeBytes, 'Confirmed world creation intake'),
    );
  } catch (error) {
    if (error instanceof PrivateProductionHandoffArchiveError) throw error;
    return fail(
      'private-handoff-archive.integrity',
      'Confirmed world creation intake is invalid.',
    );
  }
  if (
    intake.intake_id !== manifest.intake_id
    || intake.profile !== manifest.profile
    || intake.target !== manifest.target
    || await fingerprintConfirmedWorldCreationIntake(intake)
      !== manifest.intake_sha256
  ) {
    fail(
      'private-handoff-archive.integrity',
      'Private production handoff intake binding is invalid.',
    );
  }
  await readEntry(
    archive,
    `${root}/${manifest.instructions.path}`,
    manifest.instructions.bytes,
    manifest.instructions.sha256,
  );
  const references = Object.freeze(await Promise.all(
    manifest.references.map(async (reference) => {
      const descriptor = intake.references.find(
        ({ id, role }) => id === reference.id && role === reference.role,
      );
      if (
        !descriptor
        || descriptor.path !== reference.path
        || descriptor.mediaType !== reference.media_type
        || descriptor.byteLength !== reference.bytes
        || descriptor.sha256 !== reference.sha256
      ) {
        return fail(
          'private-handoff-archive.integrity',
          'Private production handoff reference binding is invalid.',
        );
      }
      const bytes = await readEntry(
        archive,
        `${root}/${reference.path}`,
        reference.bytes,
        reference.sha256,
      );
      try {
        await bindReferenceImage(descriptor, bytes);
      } catch {
        return fail(
          'private-handoff-archive.integrity',
          'Private production handoff reference bytes are invalid.',
        );
      }
      return Object.freeze({ descriptor, bytes });
    }),
  )) as ReadPrivateProductionHandoff['references'];
  return Object.freeze({ manifest, intake, references });
}
