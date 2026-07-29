import JSZip from 'jszip';

import {
  assertHumanArtReviewReceipt,
  encodeHumanArtReviewReceipt,
  type ApprovedProductionWorldReview,
  type HumanArtReviewReceipt,
} from '../core/human-art-review-receipt';
import {
  assertProductionWorldReview,
  type ProductionWorldEvidence,
} from '../core/production-world-review-contract';
import {
  materializeWorldArtRuntimeOverlay,
  serializeCanonicalWorldArtRuntimeOverlay,
  type WorldArtRuntimeOverlayManifest,
} from '../core/world-art-runtime-overlay';
import {
  materializeWorldArtRuntimeOverlayV1_1,
  serializeCanonicalWorldArtRuntimeOverlayV1_1,
  type WorldArtRuntimeOverlayV1_1Manifest,
} from '../core/world-art-runtime-overlay-v1-1';
import {
  readVersionedWorldArtRuntimeOverlayArchive,
  type VerifiedVersionedWorldArtRuntimeOverlayArchive,
} from './read-world-art-runtime-overlay-versioned';
import {
  WORLD_ART_DELIVERY_MANIFEST_PATH,
  buildWorldArtDeliveryKitManifest,
  serializeCanonicalWorldArtDeliveryKit,
  type WorldArtDeliveryFile,
  type WorldArtDeliveryKitManifest,
} from '../core/world-art-delivery-kit';
import {
  buildWorldArtDeliveryKitManifestV1_1,
  serializeCanonicalWorldArtDeliveryKitV1_1,
  type WorldArtDeliveryKitV1_1Manifest,
} from '../core/world-art-delivery-kit-v1-1';

// @ts-expect-error The public privacy helper is intentionally plain ESM.
import { containsPrivateConsumerToken } from '../../scripts/lib/private-consumer-boundary.mjs';

export interface ApprovedWorldArtRuntimeOverlayArtifact {
  readonly filename: string;
  readonly bytes: number;
  readonly manifest:
    | WorldArtRuntimeOverlayManifest
    | WorldArtRuntimeOverlayV1_1Manifest;
  readonly layoutPlan?: unknown;
  readBytes(): Uint8Array;
}

export interface WorldArtDeliveryReviewFile {
  readonly path: string;
  readonly media_type: Exclude<
    WorldArtDeliveryFile['media_type'],
    'application/zip' | 'text/markdown'
  >;
  readonly bytes: number;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
  readBytes(): Uint8Array;
}

export interface BuildApprovedWorldArtDeliveryKitOptions {
  readonly packId: string;
  readonly title: string;
  readonly version: string;
  readonly containsGenerativeAi: boolean;
}

export interface BuiltApprovedWorldArtDeliveryKit {
  readonly filename: string;
  readonly bytes: number;
  readonly manifest:
    | WorldArtDeliveryKitManifest
    | WorldArtDeliveryKitV1_1Manifest;
  readBytes(): Uint8Array;
}

export type ApprovedWorldArtDeliveryKitErrorCode =
  | 'world-art-delivery-build.invalid-input'
  | 'world-art-delivery-build.overlay'
  | 'world-art-delivery-build.review'
  | 'world-art-delivery-build.binding'
  | 'world-art-delivery-build.rights'
  | 'world-art-delivery-build.inventory'
  | 'world-art-delivery-build.integrity'
  | 'world-art-delivery-build.privacy'
  | 'world-art-delivery-build.archive';

export class ApprovedWorldArtDeliveryKitError extends Error {
  constructor(
    readonly code: ApprovedWorldArtDeliveryKitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApprovedWorldArtDeliveryKitError';
  }
}

interface Payload {
  readonly path: string;
  readonly media_type: WorldArtDeliveryFile['media_type'];
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(
  code: ApprovedWorldArtDeliveryKitErrorCode,
  message: string,
): never {
  throw new ApprovedWorldArtDeliveryKitError(code, message);
}

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function markdown(value: string): Uint8Array {
  return new TextEncoder().encode(value.replace(/\r\n/g, '\n'));
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength
    && left.every((byte, index) => byte === right[index]);
}

async function payload(
  path: string,
  mediaType: Payload['media_type'],
  bytes: Uint8Array,
): Promise<Payload> {
  const snapshot = Uint8Array.from(bytes);
  return Object.freeze({
    path,
    media_type: mediaType,
    bytes: snapshot,
    sha256: await sha256(snapshot),
  });
}

function assertOptions(options: BuildApprovedWorldArtDeliveryKitOptions): void {
  if (
    !SAFE_ID.test(options.packId)
    || options.packId.length > 80
    || !SEMVER.test(options.version)
    || options.title.length < 1
    || options.title.length > 160
    || options.title.trim() !== options.title
    || /[\u0000-\u001f\u007f-\u009f]/.test(options.title)
    || typeof options.containsGenerativeAi !== 'boolean'
  ) {
    fail('world-art-delivery-build.invalid-input', 'Delivery options are invalid.');
  }
}

async function verifyOverlay(
  artifact: ApprovedWorldArtRuntimeOverlayArtifact,
): Promise<VerifiedVersionedWorldArtRuntimeOverlayArchive> {
  if (
    !Number.isSafeInteger(artifact.bytes)
    || artifact.bytes < 1
    || artifact.bytes > 256 * 1024 * 1024
  ) {
    fail('world-art-delivery-build.overlay', 'Runtime overlay artifact metadata is invalid.');
  }
  let read: unknown;
  try {
    read = artifact.readBytes();
  } catch {
    return fail('world-art-delivery-build.overlay', 'Runtime overlay bytes cannot be read.');
  }
  if (!(read instanceof Uint8Array) || read.byteLength !== artifact.bytes) {
    fail('world-art-delivery-build.overlay', 'Runtime overlay bytes are invalid.');
  }
  let verified;
  let claimedManifestBytes: Uint8Array;
  try {
    verified = await readVersionedWorldArtRuntimeOverlayArchive(
      read,
      artifact.layoutPlan === undefined
        ? {}
        : { layout_plan: artifact.layoutPlan },
    );
    claimedManifestBytes = artifact.manifest.schema_version === '1.1.0'
      ? await serializeCanonicalWorldArtRuntimeOverlayV1_1(
        await materializeWorldArtRuntimeOverlayV1_1(artifact.manifest),
      )
      : await serializeCanonicalWorldArtRuntimeOverlay(
        await materializeWorldArtRuntimeOverlay(artifact.manifest),
      );
  } catch {
    return fail('world-art-delivery-build.overlay', 'Runtime overlay ZIP is invalid.');
  }
  const verifiedManifestBytes = verified.manifest.schema_version === '1.1.0'
    ? await serializeCanonicalWorldArtRuntimeOverlayV1_1(verified.manifest)
    : await serializeCanonicalWorldArtRuntimeOverlay(verified.manifest);
  if (
    artifact.filename !== `${verified.manifest.overlay_id}.zip`
    || !equalBytes(claimedManifestBytes, verifiedManifestBytes)
  ) {
    fail(
      'world-art-delivery-build.overlay',
      'Runtime overlay metadata differs from the verified archive.',
    );
  }
  return verified;
}

function expectedReviewFiles(
  approval: ApprovedProductionWorldReview,
): readonly Readonly<{
  path: string;
  media_type: WorldArtDeliveryReviewFile['media_type'];
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
}>[] {
  return Object.freeze([
    Object.freeze({
      ...approval.review.world_preview,
      media_type: 'image/png' as const,
    }),
    ...approval.review.evidence
      .filter(({ kind }) => kind !== 'human-review-record')
      .map((evidence) => Object.freeze({
        path: evidence.path,
        media_type: evidence.media_type as WorldArtDeliveryReviewFile['media_type'],
        bytes: evidence.bytes,
        sha256: evidence.sha256,
        ...(evidence.width === undefined ? {} : { width: evidence.width }),
        ...(evidence.height === undefined ? {} : { height: evidence.height }),
      })),
  ]);
}

async function verifyReviewFiles(
  approval: ApprovedProductionWorldReview,
  provided: readonly WorldArtDeliveryReviewFile[],
): Promise<readonly Payload[]> {
  const expected = expectedReviewFiles(approval);
  if (
    provided.length !== expected.length
    || new Set(provided.map(({ path }) => path)).size !== provided.length
  ) {
    fail(
      'world-art-delivery-build.inventory',
      'Review files must exactly cover the approved preview and technical evidence.',
    );
  }
  const results: Payload[] = [];
  for (const record of expected) {
    const file = provided.find(({ path }) => path === record.path);
    if (
      !file
      || file.media_type !== record.media_type
      || file.bytes !== record.bytes
      || file.sha256 !== record.sha256
      || file.width !== record.width
      || file.height !== record.height
      || !SHA256.test(file.sha256)
    ) {
      fail(
        'world-art-delivery-build.inventory',
        `Review file metadata differs from approval: ${record.path}.`,
      );
    }
    let read: unknown;
    try {
      read = file.readBytes();
    } catch {
      return fail(
        'world-art-delivery-build.integrity',
        `Review file cannot be read: ${record.path}.`,
      );
    }
    if (!(read instanceof Uint8Array)) {
      fail(
        'world-art-delivery-build.integrity',
        `Review file bytes are invalid: ${record.path}.`,
      );
    }
    const bytes = Uint8Array.from(read);
    if (bytes.byteLength !== record.bytes || await sha256(bytes) !== record.sha256) {
      fail(
        'world-art-delivery-build.integrity',
        `Review file bytes changed: ${record.path}.`,
      );
    }
    results.push(Object.freeze({
      path: record.path,
      media_type: record.media_type,
      bytes,
      sha256: record.sha256,
    }));
  }
  return Object.freeze(results);
}

function rightsMatch(
  overlay: WorldArtRuntimeOverlayManifest | WorldArtRuntimeOverlayV1_1Manifest,
  receipt: HumanArtReviewReceipt,
): boolean {
  return overlay.rights.distribution === receipt.rights.distribution
    && overlay.rights.license === receipt.rights.output_license_id
    && overlay.rights.attribution === receipt.rights.attribution
    && receipt.rights.source_authority_confirmed
    && (
      receipt.decision === 'approved-private'
        ? (
          receipt.rights.distribution === 'private'
          && receipt.rights.output_license_id === 'LicenseRef-Proprietary'
          && !receipt.rights.permits_redistribution
        )
        : (
          receipt.decision === 'approved-public'
          && receipt.rights.distribution === 'public'
          && receipt.rights.permits_redistribution
        )
    );
}

function approvedRightsMatch(
  approval: ApprovedProductionWorldReview,
  receipt: HumanArtReviewReceipt,
): boolean {
  return approval.authorization.distribution === receipt.rights.distribution
    && approval.authorization.output_license_id === receipt.rights.output_license_id
    && approval.authorization.permits_redistribution
      === receipt.rights.permits_redistribution
    && approval.authorization.source_authority_confirmed
      === receipt.rights.source_authority_confirmed
    && approval.authorization.attribution === receipt.rights.attribution;
}

function readme(
  options: BuildApprovedWorldArtDeliveryKitOptions,
  overlayFilename: string,
  distribution: 'private' | 'public',
  profile: string,
): string {
  return `# ${options.title}

Version: ${options.version}
Profile: ${profile}
Distribution: ${distribution}
Engine: Godot 4.3 and 4.7

## Quick start

1. Extract \`assets/${overlayFilename}\`.
2. Install the trusted Mapsoo importer from the public WorldForge repository.
3. In Godot, select the extracted \`world-art-runtime-overlay.json\`.
4. Apply the overlay to the matching generated world layout.

The nested runtime overlay contains only PNG and JSON asset data. It contains
no executable addon, private reference image, raw prompt, account credential,
or editor cache.

The \`review-evidence/\` files document the exact human-approved render,
placement, collision and traversal evidence. See \`license-assets.md\` before
copying or redistributing this pack.
`;
}

function licenseText(receipt: HumanArtReviewReceipt): string {
  if (receipt.decision === 'approved-private') {
    return `# Asset license

License: LicenseRef-Proprietary
Distribution: private

This delivery is approved only for the recipient's private use. Redistribution
is not granted. The WorldForge source code remains separately licensed under
MIT; that code license does not license these generated assets.
`;
  }
  return `# Asset license

License: ${receipt.rights.output_license_id}
Distribution: public
Redistribution: permitted
${receipt.rights.attribution === undefined
    ? ''
    : `Attribution: ${receipt.rights.attribution}\n`}
The WorldForge source code remains separately licensed under MIT.
`;
}

function changelog(options: BuildApprovedWorldArtDeliveryKitOptions): string {
  return `# Changelog

## ${options.version}

- Initial human-approved ${options.packId} world-art delivery.
- Includes one exact Godot runtime overlay and its bound review evidence.
`;
}

function assertTextPrivacy(payloads: readonly Payload[]): void {
  for (const file of payloads) {
    const textPayload = file.media_type === 'application/json'
      || file.media_type === 'text/markdown'
      || file.media_type === 'text/plain';
    if (
      containsPrivateConsumerToken(file.path)
      || (
        textPayload
        && containsPrivateConsumerToken(new TextDecoder().decode(file.bytes))
      )
    ) {
      fail(
        'world-art-delivery-build.privacy',
        `Delivery payload crosses the private consumer boundary: ${file.path}.`,
      );
    }
  }
}

export async function buildApprovedWorldArtDeliveryKit(
  overlayArtifact: ApprovedWorldArtRuntimeOverlayArtifact,
  approval: ApprovedProductionWorldReview,
  receipt: HumanArtReviewReceipt,
  receiptBytes: Uint8Array,
  reviewFiles: readonly WorldArtDeliveryReviewFile[],
  options: BuildApprovedWorldArtDeliveryKitOptions,
): Promise<BuiltApprovedWorldArtDeliveryKit> {
  assertOptions(options);
  try {
    assertProductionWorldReview(approval.review);
    assertHumanArtReviewReceipt(receipt);
  } catch {
    return fail('world-art-delivery-build.review', 'Approval or human receipt is invalid.');
  }
  if (
    approval.review.release_decision !== 'approved'
    || receipt.decision === 'blocked'
    || approval.human_review.decision !== receipt.decision
    || approval.human_review.reviewer_id !== receipt.reviewer_id
    || approval.human_review.reviewed_at !== receipt.reviewed_at
    || !approvedRightsMatch(approval, receipt)
  ) {
    fail('world-art-delivery-build.review', 'Human approval is incomplete or detached.');
  }
  const canonicalReceipt = encodeHumanArtReviewReceipt(receipt);
  if (
    receiptBytes.byteLength !== canonicalReceipt.byteLength
    || receiptBytes.some((byte, index) => byte !== canonicalReceipt[index])
  ) {
    fail('world-art-delivery-build.review', 'Human receipt bytes are not canonical.');
  }
  const receiptSha = await sha256(canonicalReceipt);
  const humanEvidence = approval.review.evidence.filter(
    ({ kind }) => kind === 'human-review-record',
  );
  if (
    humanEvidence.length !== 1
    || humanEvidence[0]!.path !== approval.human_review.receipt_path
    || humanEvidence[0]!.sha256 !== receiptSha
    || approval.human_review.receipt_sha256 !== receiptSha
  ) {
    fail('world-art-delivery-build.review', 'Human receipt evidence is not exact.');
  }
  const overlay = await verifyOverlay(overlayArtifact);
  if (
    overlay.manifest.profile !== approval.review.profile
    || receipt.profile !== approval.review.profile
    || receipt.bindings.production_world_review_id !== approval.review.review_id
    || receipt.bindings.world_preview_sha256 !== approval.review.world_preview.sha256
    || receipt.bindings.runtime_projection_sha256
      !== overlay.manifest.source.projection_sha256
    || receipt.bindings.runtime_overlay_sha256 !== overlay.sha256
    || !approval.review.evidence.some((evidence) =>
      evidence.kind === 'rendered-world-capture'
      && evidence.sha256 === receipt.bindings.godot_capture_sha256)
  ) {
    fail('world-art-delivery-build.binding', 'Delivery artifacts do not match approval.');
  }
  if (!rightsMatch(overlay.manifest, receipt)) {
    fail('world-art-delivery-build.rights', 'Overlay and human-approved rights differ.');
  }
  const verifiedReviewFiles = await verifyReviewFiles(approval, reviewFiles);
  const productionReviewBytes = json(approval.review);
  const productionReviewSha = await sha256(productionReviewBytes);
  const overlayPath = `assets/${overlayArtifact.filename}`;
  const productionReviewPath = 'review/production-world-review.json';
  const humanReviewPath = approval.human_review.receipt_path;
  const generated = await Promise.all([
    payload(overlayPath, 'application/zip', overlay.bytes),
    payload(productionReviewPath, 'application/json', productionReviewBytes),
    payload(humanReviewPath, 'application/json', canonicalReceipt),
    payload('readme.md', 'text/markdown', markdown(
      readme(
        options,
        overlayArtifact.filename,
        receipt.rights.distribution as 'private' | 'public',
        approval.review.profile,
      ),
    )),
    payload('license-assets.md', 'text/markdown', markdown(licenseText(receipt))),
    payload('changelog.md', 'text/markdown', markdown(changelog(options))),
  ]);
  const payloads = Object.freeze([
    ...generated,
    ...verifiedReviewFiles,
  ].sort((left, right) => left.path.localeCompare(right.path, 'en')));
  if (new Set(payloads.map(({ path }) => path)).size !== payloads.length) {
    fail('world-art-delivery-build.inventory', 'Delivery payload paths conflict.');
  }
  assertTextPrivacy(payloads);
  const manifestPayload = {
    pack: Object.freeze({
      id: options.packId,
      title: options.title,
      version: options.version,
    }),
    profile: approval.review.profile,
    distribution: receipt.rights.distribution as 'private' | 'public',
    license: Object.freeze({
      id: receipt.rights.output_license_id as WorldArtDeliveryKitManifest['license']['id'],
      permits_redistribution: receipt.rights.permits_redistribution,
      ...(receipt.rights.attribution === undefined
        ? {}
        : { attribution: receipt.rights.attribution }),
    }),
    content: Object.freeze({
      runtime_overlay: Object.freeze({
        path: overlayPath,
        overlay_id: overlay.manifest.overlay_id,
        bytes: overlay.bytes.byteLength,
        sha256: overlay.sha256,
        projection_sha256: overlay.manifest.source.projection_sha256,
      }),
      production_world_review: Object.freeze({
        path: productionReviewPath,
        sha256: productionReviewSha,
      }),
      human_art_review: Object.freeze({
        path: humanReviewPath,
        sha256: receiptSha,
      }),
      preview: Object.freeze({
        path: approval.review.world_preview.path,
        sha256: approval.review.world_preview.sha256,
        width: approval.review.world_preview.width,
        height: approval.review.world_preview.height,
      }),
    }),
    ai_disclosure: Object.freeze({
      contains_generative_ai: options.containsGenerativeAi,
      human_curated: true,
      original_references_embedded: false,
    }),
    files: Object.freeze(payloads.map((file) => Object.freeze({
      path: file.path,
      media_type: file.media_type,
      bytes: file.bytes.byteLength,
      sha256: file.sha256,
    }))),
  };
  const manifest = overlay.manifest.schema_version === '1.1.0'
    ? await buildWorldArtDeliveryKitManifestV1_1({
      ...manifestPayload,
      schema_version: '1.1.0',
      document_type: 'world-art-delivery-kit',
      compatibility: Object.freeze({
        engine: 'godot',
        tested_versions: Object.freeze(['4.3', '4.7'] as const),
        importer: 'mapsoo-importer',
        asset_contract: 'world-art-runtime-overlay-1.1',
      }),
    })
    : await buildWorldArtDeliveryKitManifest({
      ...manifestPayload,
      schema_version: '1.0.0',
      document_type: 'world-art-delivery-kit',
      compatibility: Object.freeze({
        engine: 'godot',
        tested_versions: Object.freeze(['4.3', '4.7'] as const),
        importer: 'mapsoo-importer',
        asset_contract: 'world-art-runtime-overlay-1.0',
      }),
    });
  const manifestBytes = manifest.schema_version === '1.1.0'
    ? await serializeCanonicalWorldArtDeliveryKitV1_1(manifest)
    : await serializeCanonicalWorldArtDeliveryKit(manifest);
  const root = `${options.packId}-v${options.version}`;
  const archive = new JSZip();
  for (const entry of [
    ...payloads,
    Object.freeze({
      path: WORLD_ART_DELIVERY_MANIFEST_PATH,
      media_type: 'application/json' as const,
      bytes: manifestBytes,
      sha256: await sha256(manifestBytes),
    }),
  ].sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
    archive.file(`${root}/${entry.path}`, entry.bytes, {
      binary: true,
      createFolders: false,
      date: ZIP_DATE,
      unixPermissions: 0o100644,
    });
  }
  let bytes: Uint8Array;
  try {
    bytes = await archive.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
      platform: 'UNIX',
      streamFiles: false,
    });
  } catch {
    return fail('world-art-delivery-build.archive', 'Delivery ZIP could not be created.');
  }
  const snapshot = Uint8Array.from(bytes);
  return Object.freeze({
    filename: `${root}.zip`,
    bytes: snapshot.byteLength,
    manifest,
    readBytes: () => Uint8Array.from(snapshot),
  });
}
