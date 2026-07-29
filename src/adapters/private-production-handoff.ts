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
  buildAssetRequirementsV1_1,
  materializeAssetRequirementsV1_1,
  serializeCanonicalAssetRequirementsV1_1,
  type AssetRequirementsV1_1,
} from '../core/asset-requirements-v1-1';
import {
  buildProductionArtPlanV1_1,
  materializeProductionArtPlanV1_1,
  serializeCanonicalProductionArtPlanV1_1,
  type ProductionArtPlanV1_1,
} from '../core/production-art-contract-v1-1';
import {
  materializeWorldLayoutConstraints,
  type WorldLayoutConstraints,
} from '../core/world-layout-constraints';
import {
  materializeWorldLayoutPlan,
  serializeCanonicalWorldLayoutPlan,
  type WorldLayoutPlan,
} from '../core/world-layout-plan';
import {
  PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH,
  PRIVATE_PRODUCTION_HANDOFF_MANIFEST_PATH,
  PRIVATE_PRODUCTION_HANDOFF_README_PATH,
  encodePrivateProductionHandoffManifest,
  materializePrivateProductionHandoffManifest,
  type PrivateProductionHandoffManifest,
} from '../core/private-production-handoff';
import {
  PRIVATE_PRODUCTION_HANDOFF_ASSET_REQUIREMENTS_PATH,
  PRIVATE_PRODUCTION_HANDOFF_LAYOUT_CONSTRAINTS_PATH,
  PRIVATE_PRODUCTION_HANDOFF_LAYOUT_PLAN_PATH,
  PRIVATE_PRODUCTION_HANDOFF_PRODUCTION_ART_PLAN_PATH,
  encodePrivateProductionHandoffManifestV1_1,
  materializePrivateProductionHandoffManifestV1_1,
  type PrivateProductionHandoffManifestV1_1,
} from '../core/private-production-handoff-v1-1';

export interface PrivateProductionHandoffReferenceInput {
  readonly descriptor: ReferenceImageDescriptor;
  readonly bytes: Uint8Array;
}

export interface BuiltPrivateProductionHandoff {
  readonly filename: string;
  readonly bytes: number;
  readonly manifest:
    | PrivateProductionHandoffManifest
    | PrivateProductionHandoffManifestV1_1;
  readBytes(): Uint8Array;
}

export interface ReadPrivateProductionHandoff {
  readonly manifest:
    | PrivateProductionHandoffManifest
    | PrivateProductionHandoffManifestV1_1;
  readonly intake: ConfirmedWorldCreationIntake;
  readonly references: readonly [
    PrivateProductionHandoffReferenceInput,
    PrivateProductionHandoffReferenceInput,
  ];
  readonly planning?: Readonly<{
    layoutConstraints: WorldLayoutConstraints;
    layoutPlan: WorldLayoutPlan;
    assetRequirements: AssetRequirementsV1_1;
    productionArtPlan: ProductionArtPlanV1_1;
  }>;
}

export interface PrivateProductionHandoffPlanningInput {
  readonly layoutConstraints: unknown;
  readonly layoutPlan: unknown;
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

function readme(
  intakeId: string,
  planning?: Readonly<{
    requirementCount: number;
    taskCount: number;
  }>,
): Uint8Array {
  return new TextEncoder().encode([
    '# Private production handoff',
    '',
    `Intake: ${intakeId}`,
    '',
    'This local archive contains the original environment and character references.',
    'Do not publish it, attach it to an issue, or commit it to a public repository.',
    ...(planning
      ? [
        '',
        `The confirmed layout is frozen with ${planning.requirementCount} complete asset requirements and at most ${planning.taskCount} reviewed image requests.`,
        'Generate and approve the one scene-direction request before authorizing the remaining world tasks.',
      ]
      : []),
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
  planningInput?: PrivateProductionHandoffPlanningInput,
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
  const planning = planningInput === undefined
    ? undefined
    : await (async () => {
      const layoutConstraints = await materializeWorldLayoutConstraints(
        planningInput.layoutConstraints,
        intake,
      );
      const layoutPlan = await materializeWorldLayoutPlan(
        planningInput.layoutPlan,
        intake,
      );
      const assetRequirements = await buildAssetRequirementsV1_1(
        layoutConstraints,
        layoutPlan,
      );
      const productionArtPlan = await buildProductionArtPlanV1_1(
        assetRequirements,
        {
          distribution: 'internal-review',
          license: 'LicenseRef-Proprietary',
        },
      );
      return Object.freeze({
        layoutConstraints,
        layoutPlan,
        assetRequirements,
        productionArtPlan,
        layoutConstraintsBytes: jsonBytes(layoutConstraints),
        layoutPlanBytes: await serializeCanonicalWorldLayoutPlan(layoutPlan),
        assetRequirementsBytes:
          await serializeCanonicalAssetRequirementsV1_1(assetRequirements),
        productionArtPlanBytes:
          await serializeCanonicalProductionArtPlanV1_1(
            productionArtPlan,
            assetRequirements,
        ),
      });
    })();
  const instructions = readme(
    intake.intake_id,
    planning
      ? {
        requirementCount: planning.assetRequirements.requirements.length,
        taskCount: planning.productionArtPlan.tasks.length,
      }
      : undefined,
  );
  const commonManifest = {
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
    remote_request_count: 0,
  } as const;
  const manifest = planning === undefined
    ? materializePrivateProductionHandoffManifest({
    schema_version: '1.0.0',
    ...commonManifest,
    privacy: {
      contains_original_references: true,
      public_distribution_allowed: false,
    },
  })
    : materializePrivateProductionHandoffManifestV1_1({
      schema_version: '1.1.0',
      ...commonManifest,
      planning: {
        layout_constraints: {
          path: PRIVATE_PRODUCTION_HANDOFF_LAYOUT_CONSTRAINTS_PATH,
          bytes: planning.layoutConstraintsBytes.byteLength,
          sha256: await sha256(planning.layoutConstraintsBytes),
        },
        layout_plan: {
          path: PRIVATE_PRODUCTION_HANDOFF_LAYOUT_PLAN_PATH,
          bytes: planning.layoutPlanBytes.byteLength,
          sha256: await sha256(planning.layoutPlanBytes),
        },
        asset_requirements: {
          path: PRIVATE_PRODUCTION_HANDOFF_ASSET_REQUIREMENTS_PATH,
          bytes: planning.assetRequirementsBytes.byteLength,
          sha256: await sha256(planning.assetRequirementsBytes),
        },
        production_art_plan: {
          path: PRIVATE_PRODUCTION_HANDOFF_PRODUCTION_ART_PLAN_PATH,
          bytes: planning.productionArtPlanBytes.byteLength,
          sha256: await sha256(planning.productionArtPlanBytes),
        },
        requirement_count: planning.assetRequirements.requirements.length,
        task_count: planning.productionArtPlan.tasks.length,
        maximum_remote_requests: planning.productionArtPlan.tasks.length,
        scene_direction_requests: 1,
        approval_policy: 'scene-direction-then-complete-world',
      },
      privacy: {
        contains_original_references: true,
        contains_private_world_facts: true,
        public_distribution_allowed: false,
      },
    });
  const manifestBytes = manifest.schema_version === '1.1.0'
    ? encodePrivateProductionHandoffManifestV1_1(manifest)
    : encodePrivateProductionHandoffManifest(manifest);
  const root = archiveRoot(intake.intake_id);
  const archive = new JSZip();
  const files = [
    [PRIVATE_PRODUCTION_HANDOFF_MANIFEST_PATH, manifestBytes],
    [PRIVATE_PRODUCTION_HANDOFF_INTAKE_PATH, intakeBytes],
    [PRIVATE_PRODUCTION_HANDOFF_README_PATH, instructions],
    ...references.map(({ descriptor, bytes }) => [descriptor.path, bytes] as const),
    ...(planning === undefined
      ? []
      : [
        [
          PRIVATE_PRODUCTION_HANDOFF_LAYOUT_CONSTRAINTS_PATH,
          planning.layoutConstraintsBytes,
        ],
        [
          PRIVATE_PRODUCTION_HANDOFF_LAYOUT_PLAN_PATH,
          planning.layoutPlanBytes,
        ],
        [
          PRIVATE_PRODUCTION_HANDOFF_ASSET_REQUIREMENTS_PATH,
          planning.assetRequirementsBytes,
        ],
        [
          PRIVATE_PRODUCTION_HANDOFF_PRODUCTION_ART_PLAN_PATH,
          planning.productionArtPlanBytes,
        ],
      ] as const),
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
    names.some((name) =>
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
  const rawManifest = strictJson(
    manifestBytes,
    'Private production handoff manifest',
  );
  let manifest:
    | PrivateProductionHandoffManifest
    | PrivateProductionHandoffManifestV1_1;
  try {
    manifest = (
      typeof rawManifest === 'object'
      && rawManifest !== null
      && !Array.isArray(rawManifest)
      && 'schema_version' in rawManifest
      && rawManifest.schema_version === '1.1.0'
    )
      ? materializePrivateProductionHandoffManifestV1_1(rawManifest)
      : materializePrivateProductionHandoffManifest(rawManifest);
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
    ...(manifest.schema_version === '1.1.0'
      ? [
        `${root}/${manifest.planning.layout_constraints.path}`,
        `${root}/${manifest.planning.layout_plan.path}`,
        `${root}/${manifest.planning.asset_requirements.path}`,
        `${root}/${manifest.planning.production_art_plan.path}`,
      ]
      : []),
  ]);
  if (
    expectedNames.size !== (manifest.schema_version === '1.1.0' ? 9 : 5)
    || names.length !== expectedNames.size
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
  if (manifest.schema_version === '1.0.0') {
    return Object.freeze({ manifest, intake, references });
  }
  let planning: NonNullable<ReadPrivateProductionHandoff['planning']>;
  try {
    const constraintsBytes = await readEntry(
      archive,
      `${root}/${manifest.planning.layout_constraints.path}`,
      manifest.planning.layout_constraints.bytes,
      manifest.planning.layout_constraints.sha256,
    );
    const layoutPlanBytes = await readEntry(
      archive,
      `${root}/${manifest.planning.layout_plan.path}`,
      manifest.planning.layout_plan.bytes,
      manifest.planning.layout_plan.sha256,
    );
    const assetRequirementsBytes = await readEntry(
      archive,
      `${root}/${manifest.planning.asset_requirements.path}`,
      manifest.planning.asset_requirements.bytes,
      manifest.planning.asset_requirements.sha256,
    );
    const productionArtPlanBytes = await readEntry(
      archive,
      `${root}/${manifest.planning.production_art_plan.path}`,
      manifest.planning.production_art_plan.bytes,
      manifest.planning.production_art_plan.sha256,
    );
    const layoutConstraints = await materializeWorldLayoutConstraints(
      strictJson(constraintsBytes, 'World layout constraints'),
      intake,
    );
    const layoutPlan = await materializeWorldLayoutPlan(
      strictJson(layoutPlanBytes, 'World layout plan'),
      intake,
    );
    const assetRequirements = await materializeAssetRequirementsV1_1(
      strictJson(assetRequirementsBytes, 'Asset requirements'),
      {
        constraints: layoutConstraints,
        plan: layoutPlan,
      },
    );
    const productionArtPlan = await materializeProductionArtPlanV1_1(
      strictJson(productionArtPlanBytes, 'Production art plan'),
      assetRequirements,
    );
    if (
      !equalBytes(constraintsBytes, jsonBytes(layoutConstraints))
      || !equalBytes(
        layoutPlanBytes,
        await serializeCanonicalWorldLayoutPlan(layoutPlan),
      )
      || !equalBytes(
        assetRequirementsBytes,
        await serializeCanonicalAssetRequirementsV1_1(assetRequirements),
      )
      || !equalBytes(
        productionArtPlanBytes,
        await serializeCanonicalProductionArtPlanV1_1(
          productionArtPlan,
          assetRequirements,
        ),
      )
      || assetRequirements.requirements.length
        !== manifest.planning.requirement_count
      || productionArtPlan.tasks.length !== manifest.planning.task_count
    ) {
      fail(
        'private-handoff-archive.integrity',
        'Private production planning is not canonical or count-complete.',
      );
    }
    planning = Object.freeze({
      layoutConstraints,
      layoutPlan,
      assetRequirements,
      productionArtPlan,
    });
  } catch (error) {
    if (error instanceof PrivateProductionHandoffArchiveError) throw error;
    return fail(
      'private-handoff-archive.integrity',
      'Private production planning binding is invalid.',
    );
  }
  return Object.freeze({ manifest, intake, references, planning });
}
