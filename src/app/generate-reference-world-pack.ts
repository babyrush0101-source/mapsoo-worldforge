import { decodeReferenceImageRgba } from '../adapters/decode-reference-image-rgba';
import {
  createConfirmedGenerationBinding,
  type ConfirmedDialogueInput,
  type ConfirmedGenerationBinding,
} from '../core/confirmed-generation-binding';
import { bindGenerationRequestV2 } from '../core/generation-request-v2';
import { extractCharacterIdentitySignature } from '../core/character-identity-signature';
import {
  createConfirmedWorldCreationIntake,
  projectConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
  type WorldCreationIntakeTarget,
} from '../core/confirmed-world-creation-intake';
import { extractEnvironmentArtSignature } from '../core/environment-art-signature';
import {
  createExportedWorldReviewEvidence,
  type ExportedWorldReviewEvidence,
} from '../core/exported-world-review-evidence';
import { runWorldAssetProvider, type WorldAssetGenerationResult } from '../core/world-asset-provider';
import {
  createWorldAssetRevision,
  type WorldAssetRevision,
} from '../core/world-asset-revision';
import {
  buildWorldLayoutPlanFromConfirmedIntake,
  fingerprintWorldLayoutPlan,
  type WorldLayoutPlan,
} from '../core/world-layout-plan';
import type {
  ReferenceImageDescriptor,
  ReferenceImageRole,
} from '../core/reference-image';

export const IMPLEMENTED_REFERENCE_WORLD_PROFILES = Object.freeze([
  'topdown-farm',
  'side-platformer',
  'isometric-action',
  'layered-depth-2d',
] as const);
export type ImplementedReferenceWorldProfile = typeof IMPLEMENTED_REFERENCE_WORLD_PROFILES[number];

export interface DownloadableWorldPack {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export interface LocalReferenceImage {
  readonly role: ReferenceImageRole;
  readonly descriptor: ReferenceImageDescriptor;
  readonly bytes: Uint8Array;
}

export interface GenerateReferenceWorldPackInput {
  readonly profile: ImplementedReferenceWorldProfile;
  readonly environment: LocalReferenceImage;
  readonly character: LocalReferenceImage;
  readonly worldId: string;
  readonly description: string;
  readonly seed: string;
  readonly completedAt: string;
  readonly confirmation?: ConfirmedDialogueInput;
  readonly approvedIntentPreviewSha256?: string;
  readonly layoutPlan?: WorldLayoutPlan;
  readonly signal?: AbortSignal;
}

export interface GeneratedReferenceWorldPack {
  readonly profile: ImplementedReferenceWorldProfile;
  readonly packSchemaVersion: '0.6.0' | '0.7.0' | '0.8.0' | '0.9.0';
  readonly pack: DownloadableWorldPack;
  readonly previewBytes: Uint8Array;
  readonly generatedFileCount: number;
  readonly requiredRoleCount: 21 | 30 | 36;
  readonly characterClipCount: 8 | 12 | 24 | 128;
  readonly confirmationBinding?: ConfirmedGenerationBinding;
  readonly confirmationEmbeddedInPack: boolean;
  readonly layoutPlanEmbeddedInPack: boolean;
  readonly assetRevision: WorldAssetRevision;
  /** Local-only correlation aid; not serialized into either public pack. */
  readonly characterIdentitySignatureSha256: string;
  /** Local-only normalized color/value/structure analysis; not serialized into the public request. */
  readonly environmentArtSignatureSha256: string;
  /** Binds the displayed pack preview to the exact runtime and visual asset revision under review. */
  readonly reviewEvidence: ExportedWorldReviewEvidence;
}

export interface GenerateConfirmedReferenceWorldPackInput {
  readonly intakeId: string;
  readonly sessionRevision: number;
  readonly profile: ImplementedReferenceWorldProfile;
  readonly target: WorldCreationIntakeTarget;
  readonly seed: string;
  readonly facts: ConfirmedWorldFacts;
  readonly environment: LocalReferenceImage;
  readonly character: LocalReferenceImage;
  readonly approvedIntentPreviewSha256: string;
  readonly completedAt: string;
  readonly signal?: AbortSignal;
}

export interface GeneratedConfirmedReferenceWorldPack extends GeneratedReferenceWorldPack {
  readonly confirmedIntake: ConfirmedWorldCreationIntake;
  readonly confirmedIntakeSha256: string;
  readonly layoutPlan: WorldLayoutPlan;
  readonly layoutPlanSha256: string;
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('World generation was aborted.', 'AbortError');
}

export async function generateReferenceWorldPack(input: GenerateReferenceWorldPackInput): Promise<GeneratedReferenceWorldPack> {
  if (!IMPLEMENTED_REFERENCE_WORLD_PROFILES.includes(input.profile)) {
    throw new Error(`No complete reference-world pipeline is implemented for ${String(input.profile)}.`);
  }
  abortIfNeeded(input.signal);
  const boundJob = await bindGenerationRequestV2({
    schemaVersion: '1.0.0', id: input.worldId, profile: input.profile,
    description: input.description, seed: input.seed,
    references: [input.environment.descriptor, input.character.descriptor],
  }, [
    { path: input.environment.descriptor.path, bytes: input.environment.bytes },
    { path: input.character.descriptor.path, bytes: input.character.bytes },
  ]);
  const characterIdentity = await extractCharacterIdentitySignature(
    await decodeReferenceImageRgba(input.character.bytes, input.character.descriptor.mediaType),
  );
  const environmentArt = await extractEnvironmentArtSignature(
    await decodeReferenceImageRgba(input.environment.bytes, input.environment.descriptor.mediaType),
  );
  const job = Object.freeze({ ...boundJob, characterIdentity, environmentArt });
  const confirmationBinding = input.confirmation
    ? await createConfirmedGenerationBinding(job.request, input.confirmation)
    : undefined;
  abortIfNeeded(input.signal);

  let result: WorldAssetGenerationResult;
  let pack: DownloadableWorldPack;
  let packSchemaVersion: '0.6.0' | '0.7.0' | '0.8.0' | '0.9.0';
  let requiredRoleCount: 21 | 30 | 36;
  let characterClipCount: 8 | 12 | 24 | 128;
  let portableManifest: unknown;
  let packVersion: string;
  let minimumGodotVersion: string;
  let importerMinimumVersion: string;
  if (input.profile === 'topdown-farm') {
    const [{ PROCEDURAL_TOPDOWN_FARM_PROVIDER }, { buildAlpha9WorldAssetPack }] = await Promise.all([
      import('../providers/procedural-topdown-farm-provider'),
      import('../adapters/export-world-asset-pack-alpha9'),
    ]);
    abortIfNeeded(input.signal);
    result = await runWorldAssetProvider(PROCEDURAL_TOPDOWN_FARM_PROVIDER, job, { signal: input.signal });
    abortIfNeeded(input.signal);
    const builtPack = await buildAlpha9WorldAssetPack(
      result,
      job.request,
      input.completedAt,
      input.layoutPlan,
    );
    pack = builtPack;
    portableManifest = builtPack.manifest;
    packVersion = builtPack.manifest.pack.version;
    minimumGodotVersion = builtPack.manifest.compatibility.godot_min;
    importerMinimumVersion = builtPack.manifest.compatibility.importer.min_version;
    packSchemaVersion = '0.6.0'; requiredRoleCount = 21; characterClipCount = 8;
  } else if (input.profile === 'side-platformer') {
    const [{ PROCEDURAL_SIDE_PLATFORMER_PROVIDER }, { buildAlpha10WorldAssetPack }] = await Promise.all([
      import('../providers/procedural-side-platformer-provider'),
      import('../adapters/export-world-asset-pack-alpha10'),
    ]);
    abortIfNeeded(input.signal);
    result = await runWorldAssetProvider(PROCEDURAL_SIDE_PLATFORMER_PROVIDER, job, { signal: input.signal });
    abortIfNeeded(input.signal);
    const builtPack = await buildAlpha10WorldAssetPack(
      result,
      job.request,
      input.completedAt,
      confirmationBinding,
      input.layoutPlan,
    );
    pack = builtPack;
    portableManifest = builtPack.manifest;
    packVersion = builtPack.manifest.pack.version;
    minimumGodotVersion = builtPack.manifest.compatibility.godot_min;
    importerMinimumVersion = builtPack.manifest.compatibility.importer.min_version;
    packSchemaVersion = '0.7.0'; requiredRoleCount = 30; characterClipCount = 12;
  } else if (input.profile === 'isometric-action') {
    const [{ PROCEDURAL_ISOMETRIC_ACTION_PROVIDER }, { buildAlpha11WorldAssetPack }] = await Promise.all([
      import('../providers/procedural-isometric-action-provider'),
      import('../adapters/export-world-asset-pack-alpha11'),
    ]);
    abortIfNeeded(input.signal);
    result = await runWorldAssetProvider(PROCEDURAL_ISOMETRIC_ACTION_PROVIDER, job, { signal: input.signal });
    abortIfNeeded(input.signal);
    const builtPack = await buildAlpha11WorldAssetPack(
      result,
      job.request,
      input.completedAt,
      confirmationBinding,
      input.layoutPlan,
    );
    pack = builtPack;
    portableManifest = builtPack.manifest;
    packVersion = builtPack.manifest.pack.version;
    minimumGodotVersion = builtPack.manifest.compatibility.godot_min;
    importerMinimumVersion = builtPack.manifest.compatibility.importer.min_version;
    packSchemaVersion = '0.8.0'; requiredRoleCount = 36; characterClipCount = 128;
  } else {
    const [{ PROCEDURAL_LAYERED_DEPTH_PROVIDER }, { buildAlpha12WorldAssetPack }] = await Promise.all([
      import('../providers/procedural-layered-depth-provider'),
      import('../adapters/export-world-asset-pack-alpha12'),
    ]);
    abortIfNeeded(input.signal);
    result = await runWorldAssetProvider(PROCEDURAL_LAYERED_DEPTH_PROVIDER, job, { signal: input.signal });
    abortIfNeeded(input.signal);
    const builtPack = await buildAlpha12WorldAssetPack(
      result,
      job.request,
      input.completedAt,
      confirmationBinding,
      input.layoutPlan,
    );
    pack = builtPack;
    portableManifest = builtPack.manifest;
    packVersion = builtPack.manifest.pack.version;
    minimumGodotVersion = builtPack.manifest.compatibility.godot_min;
    importerMinimumVersion = builtPack.manifest.compatibility.importer.min_version;
    packSchemaVersion = '0.9.0'; requiredRoleCount = 36; characterClipCount = 24;
  }
  abortIfNeeded(input.signal);
  const preview = result.payloads.find((payload) => payload.assetId === 'world-preview');
  if (!preview) throw new Error('Generated pack is missing its world preview.');
  const reviewEvidence = await createExportedWorldReviewEvidence({
    bundle: result.bundle,
    payloads: result.payloads,
    requestFingerprintSha256: result.requestFingerprintSha256,
    ...(confirmationBinding ? { dialogueBindingSha256: confirmationBinding.binding_sha256 } : {}),
    ...(input.approvedIntentPreviewSha256
      ? { approvedIntentPreviewSha256: input.approvedIntentPreviewSha256 }
      : {}),
  });
  const assetRevision = await createWorldAssetRevision({
    worldId: input.worldId,
    profile: input.profile,
    packSchemaVersion,
    packVersion,
    packFilename: pack.filename,
    packBytes: pack.bytes,
    manifest: portableManifest,
    requestFingerprintSha256: result.requestFingerprintSha256,
    ...(confirmationBinding ? { dialogueBindingSha256: confirmationBinding.binding_sha256 } : {}),
    minimumGodotVersion,
    importerMinimumVersion,
  });
  abortIfNeeded(input.signal);
  return Object.freeze({
    profile: input.profile,
    packSchemaVersion,
    pack: Object.freeze({ filename: pack.filename, bytes: pack.bytes.slice() }),
    previewBytes: preview.readBytes(),
    generatedFileCount: result.bundle.assets.length,
    requiredRoleCount,
    characterClipCount,
    ...(confirmationBinding ? { confirmationBinding } : {}),
    confirmationEmbeddedInPack: Boolean(confirmationBinding && input.profile !== 'topdown-farm'),
    layoutPlanEmbeddedInPack: Boolean(input.layoutPlan),
    assetRevision,
    characterIdentitySignatureSha256: characterIdentity.signature_sha256,
    environmentArtSignatureSha256: environmentArt.signature_sha256,
    reviewEvidence,
  });
}

export async function generateConfirmedReferenceWorldPack(
  input: GenerateConfirmedReferenceWorldPackInput,
): Promise<GeneratedConfirmedReferenceWorldPack> {
  abortIfNeeded(input.signal);
  const characterIdentity = await extractCharacterIdentitySignature(
    await decodeReferenceImageRgba(
      input.character.bytes,
      input.character.descriptor.mediaType,
    ),
  );
  const confirmedIntake = await createConfirmedWorldCreationIntake({
    intake_id: input.intakeId,
    session_revision: input.sessionRevision,
    profile: input.profile,
    target: input.target,
    seed: input.seed,
    facts: input.facts,
    character_source: {
      reference_id: input.character.descriptor.id,
      identity_digest_sha256: characterIdentity.signature_sha256,
    },
    references: [
      input.environment.descriptor,
      input.character.descriptor,
    ],
    approved_intent_preview_sha256: input.approvedIntentPreviewSha256,
  });
  const [projection, layoutPlan] = await Promise.all([
    projectConfirmedWorldCreationIntake(confirmedIntake),
    buildWorldLayoutPlanFromConfirmedIntake(confirmedIntake),
  ]);
  abortIfNeeded(input.signal);
  const generated = await generateReferenceWorldPack({
    profile: input.profile,
    environment: input.environment,
    character: input.character,
    worldId: projection.generation_request.id,
    description: projection.generation_request.description,
    seed: projection.generation_request.seed,
    completedAt: input.completedAt,
    confirmation: {
      sessionRevision: confirmedIntake.session_revision,
      checkpoints: confirmedIntake.checkpoints.map(({ stage, snapshot_sha256 }) => ({
        stage,
        snapshotSha256: snapshot_sha256,
      })),
    },
    approvedIntentPreviewSha256: confirmedIntake.approved_intent_preview_sha256,
    layoutPlan,
    signal: input.signal,
  });
  if (
    generated.characterIdentitySignatureSha256 !== characterIdentity.signature_sha256
    || generated.confirmationBinding?.binding_sha256
      !== projection.generation_binding.binding_sha256
    || !generated.layoutPlanEmbeddedInPack
  ) {
    throw new Error('Confirmed world generation did not preserve its intake and layout bindings.');
  }
  return Object.freeze({
    ...generated,
    confirmedIntake,
    confirmedIntakeSha256: projection.intake_sha256,
    layoutPlan,
    layoutPlanSha256: await fingerprintWorldLayoutPlan(layoutPlan),
  });
}
