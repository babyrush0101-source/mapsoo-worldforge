import JSZip from 'jszip';

import reviewSchema from '../../schemas/mapsoo-production-art-pack-review-1.0.schema.json';
import reviewManifestSchema from '../../schemas/mapsoo-production-review-pack-manifest-1.0.schema.json';
import type { ProductionArtRunInventory } from './materialize-production-art-run-inventory';
import {
  prepareTerrainAutotileAttachment,
  TerrainAutotileAttachmentError,
} from './prepare-terrain-autotile-attachment';
import {
  projectProductionReviewPackVisuals,
  type ProductionReviewBaseManifest,
  type ProductionReviewPackProfile,
  type ProductionReviewVisualProjection,
} from './project-production-review-pack-visuals';
import type {
  TerrainAutotileAuthoringArtifact,
} from './terrain-autotile-authoring-artifact';
import type { ProductionArtPlan } from '../core/production-art-contract';
import {
  assertAlpha9PackManifest,
  type Alpha9PackManifest,
} from '../core/pack-manifest-alpha9';
import {
  materializeAlpha10Runtime,
  validateAlpha10PackManifest,
  type Alpha10CollisionSidecar,
  type Alpha10NavigationSidecar,
  type Alpha10PackManifest,
  type Alpha10SceneSidecar,
} from '../core/pack-manifest-alpha10';
import {
  materializeAlpha11Runtime,
  validateAlpha11PackManifest,
  type Alpha11CollisionSidecar,
  type Alpha11NavigationSidecar,
  type Alpha11PackManifest,
  type Alpha11SceneSidecar,
} from '../core/pack-manifest-alpha11';
import {
  materializeWorldLayoutPlan,
} from '../core/world-layout-plan';
import type {
  PreparedWorldLayoutPackEntry,
} from '../core/world-layout-pack-binding';
import {
  materializeWorldMaterialPalette,
  type PreparedWorldMaterialPalettePackEntry,
} from '../core/world-material-palette';
import type {
  WorldTerrainAutotilePackBinding,
} from '../core/world-terrain-autotile-set';

// @ts-expect-error The public privacy helper is intentionally plain ESM.
import { containsPrivateConsumerToken } from '../../scripts/lib/private-consumer-boundary.mjs';

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
const SAFE_PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_MODEL_TEXT = /^[\u0020-\u007e]{1,160}$/;
const PUBLISHED_PACK_SCHEMA_PATHS: Readonly<Record<ProductionReviewPackProfile, string>> = Object.freeze({
  'topdown-farm': 'schema/mapsoo-pack-0.6.schema.json',
  'side-platformer': 'schema/mapsoo-pack-0.7.schema.json',
  'isometric-action': 'schema/mapsoo-pack-0.8.schema.json',
});
const TERRAIN_AUTOTILE_CELL_BY_PROFILE = Object.freeze({
  'topdown-farm': Object.freeze({ width: 32, height: 32 }),
  'side-platformer': Object.freeze({ width: 32, height: 32 }),
  'isometric-action': Object.freeze({ width: 64, height: 32 }),
} satisfies Readonly<Record<
ProductionReviewPackProfile,
Readonly<{ width: number; height: number }>
>>);

interface FileRecord {
  readonly path: string;
  readonly media_type: 'image/png' | 'application/json' | 'application/schema+json' | 'text/markdown';
  readonly bytes: number;
  readonly sha256: string;
}

export interface ProductionReviewBasePackArtifact {
  readonly byteLength: number;
  readBytes(): Uint8Array;
}

export interface ProductionReviewPackOptions {
  readonly packId: string;
  readonly title: string;
  readonly createdAt: string;
}

export type ProductionReviewTerrainAutotileArtifact =
  TerrainAutotileAuthoringArtifact;

export interface ProductionArtPackReviewRecord {
  readonly schema_version: '1.0.0';
  readonly document_type: 'production-art-pack-review';
  readonly profile: ProductionReviewPackProfile;
  readonly plan_id: string;
  readonly base_manifest_sha256: string;
  readonly source_outputs: ProductionReviewVisualProjection['source_outputs'];
  readonly files: readonly Readonly<{
    path: string;
    media_type: 'image/png';
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    roles: readonly string[];
    source_task_ids: readonly string[];
  }>[];
  readonly providers: readonly string[];
  readonly models: readonly string[];
  readonly gates: Readonly<{
    human_art: 'pending';
    rights: 'pending';
    runtime: 'pending';
    raspberry_pi: 'pending';
  }>;
}

export interface ProductionReviewPack {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly manifest: ProductionReviewBaseManifest;
  readonly review: ProductionArtPackReviewRecord;
}

export class ProductionReviewPackError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProductionReviewPackError';
  }
}

function fail(code: string, message: string): never {
  throw new ProductionReviewPackError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function json(value: unknown): Uint8Array {
  return text(`${JSON.stringify(value, null, 2)}\n`);
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch {
    return fail('production-review.invalid-json', `${label} is not strict UTF-8 JSON.`);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function record(
  path: string,
  mediaType: FileRecord['media_type'],
  bytes: Uint8Array,
): Promise<FileRecord> {
  return Object.freeze({
    path,
    media_type: mediaType,
    bytes: bytes.byteLength,
    sha256: await sha256(bytes),
  });
}

function assertOptions(options: ProductionReviewPackOptions): void {
  if (!SAFE_PACK_ID.test(options.packId) || options.packId.length > 80) {
    fail('production-review.pack-id', 'Review pack id must be bounded lowercase kebab-case.');
  }
  if (
    options.title.length < 1
    || options.title.length > 160
    || options.title.trim() !== options.title
    || /[\u0000-\u001f\u007f-\u009f]/.test(options.title)
  ) {
    fail('production-review.title', 'Review pack title is invalid.');
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(options.createdAt)
    || new Date(options.createdAt).toISOString() !== options.createdAt
  ) {
    fail('production-review.created-at', 'Review pack creation time must be canonical UTC ISO.');
  }
}

function cleanModelText(values: readonly string[], label: string): string {
  const joined = values.join(',');
  if (!SAFE_MODEL_TEXT.test(joined)) {
    fail('production-review.provider-metadata', `${label} metadata is not bounded printable ASCII.`);
  }
  return joined;
}

async function readBaseArchive(artifact: ProductionReviewBasePackArtifact): Promise<Readonly<{
  root: string;
  manifestBytes: Uint8Array;
  manifest: ProductionReviewBaseManifest;
  files: Readonly<Record<string, Uint8Array>>;
}>> {
  const archiveBytes = artifact.readBytes();
  if (
    !(archiveBytes instanceof Uint8Array)
    || archiveBytes.byteLength !== artifact.byteLength
    || archiveBytes.byteLength < 1
    || archiveBytes.byteLength > 128 * 1024 * 1024
  ) {
    fail('production-review.base-pack', 'Base pack bytes are invalid or unstable.');
  }
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(archiveBytes);
  } catch {
    return fail('production-review.base-pack', 'Base pack ZIP cannot be decoded.');
  }
  const archiveFiles = Object.values(archive.files).filter((file) => !file.dir);
  const manifestFiles = archiveFiles.filter(({ name }) => name.endsWith('/mapsoo.manifest.json'));
  if (manifestFiles.length !== 1) {
    fail('production-review.base-manifest', 'Base pack must contain one rooted manifest.');
  }
  const manifestFile = manifestFiles[0];
  const root = manifestFile.name.slice(0, -'mapsoo.manifest.json'.length);
  const manifestBytes = await manifestFile.async('uint8array');
  const value = parseJson<unknown>(manifestBytes, 'Base pack manifest');
  if (
    !isRecord(value)
    || !['topdown-farm', 'side-platformer', 'isometric-action'].includes(String(value.profile))
    || !Array.isArray(value.files)
  ) {
    fail('production-review.base-manifest', 'Base pack manifest identity is unsupported.');
  }
  const manifest = value as unknown as ProductionReviewBaseManifest;
  const expectedNames = new Set([
    `${root}mapsoo.manifest.json`,
    ...manifest.files.map(({ path }) => `${root}${path}`),
  ]);
  if (
    expectedNames.size !== archiveFiles.length
    || archiveFiles.some(({ name }) => !expectedNames.has(name))
  ) {
    fail('production-review.base-coverage', 'Base pack archive and manifest file inventory differ.');
  }
  const entries = await Promise.all(manifest.files.map(async (file) => {
    const entry = archive.file(`${root}${file.path}`);
    if (!entry) fail('production-review.base-file', `Base pack file is missing: ${file.path}.`);
    const bytes = await entry.async('uint8array');
    if (bytes.byteLength !== file.bytes || await sha256(bytes) !== file.sha256) {
      fail('production-review.base-integrity', `Base pack file changed: ${file.path}.`);
    }
    return [file.path, Uint8Array.from(bytes)] as const;
  }));
  return Object.freeze({
    root,
    manifestBytes: Uint8Array.from(manifestBytes),
    manifest,
    files: Object.freeze(Object.fromEntries(entries)),
  });
}

function validateBaseManifest(
  manifest: ProductionReviewBaseManifest,
  files: Readonly<Record<string, Uint8Array>>,
): void {
  try {
    if (manifest.profile === 'topdown-farm') {
      assertAlpha9PackManifest(manifest);
      return;
    }
    if (manifest.profile === 'side-platformer') {
      const issues = validateAlpha10PackManifest(manifest);
      if (issues.length > 0) fail('production-review.base-manifest', 'Base Pack 0.7 manifest is invalid.');
      materializeAlpha10Runtime(
        manifest,
        parseJson<Alpha10SceneSidecar>(files[manifest.runtime.scene.path], 'Base Pack 0.7 scene'),
        parseJson<Alpha10CollisionSidecar>(files[manifest.runtime.collision.path], 'Base Pack 0.7 collision'),
        parseJson<Alpha10NavigationSidecar>(files[manifest.runtime.navigation.path], 'Base Pack 0.7 navigation'),
      );
      return;
    }
    const issues = validateAlpha11PackManifest(manifest);
    if (issues.length > 0) fail('production-review.base-manifest', 'Base Pack 0.8 manifest is invalid.');
    materializeAlpha11Runtime(
      manifest,
      parseJson<Alpha11SceneSidecar>(files[manifest.runtime.scene.path], 'Base Pack 0.8 scene'),
      parseJson<Alpha11CollisionSidecar>(files[manifest.runtime.collision.path], 'Base Pack 0.8 collision'),
      parseJson<Alpha11NavigationSidecar>(files[manifest.runtime.navigation.path], 'Base Pack 0.8 navigation'),
    );
  } catch (error) {
    if (error instanceof ProductionReviewPackError) throw error;
    fail('production-review.base-manifest', 'Base pack fails its semantic contract.');
  }
}

function reviewRecord(
  projection: ProductionReviewVisualProjection,
  inventory: ProductionArtRunInventory,
  baseManifestSha256: string,
): ProductionArtPackReviewRecord {
  return Object.freeze({
    schema_version: '1.0.0',
    document_type: 'production-art-pack-review',
    profile: projection.profile,
    plan_id: projection.plan_id,
    base_manifest_sha256: baseManifestSha256,
    source_outputs: projection.source_outputs,
    files: Object.freeze(projection.files.map(({
      readBytes: _readBytes,
      ...file
    }) => Object.freeze(file))),
    providers: Object.freeze([...inventory.providers]),
    models: Object.freeze([...inventory.models]),
    gates: Object.freeze({
      human_art: 'pending',
      rights: 'pending',
      runtime: 'pending',
      raspberry_pi: 'pending',
    }),
  });
}

function transformManifest(
  manifest: ProductionReviewBaseManifest,
  options: ProductionReviewPackOptions,
  files: readonly FileRecord[],
  provider: string,
  model: string,
  terrainAutotiles?: WorldTerrainAutotilePackBinding,
): ProductionReviewBaseManifest {
  const shared = {
    ...manifest,
    pack: {
      ...manifest.pack,
      id: options.packId,
      title: options.title,
      created_at: options.createdAt,
    },
    files,
    ...(terrainAutotiles ? { terrain_autotiles: terrainAutotiles } : {}),
    license: {
      output: {
        id: 'LicenseRef-UNRELEASED' as const,
        notice_path: 'license-assets.md' as const,
        permits_redistribution: false,
      },
    },
    provenance: {
      ...manifest.provenance,
      provider: { id: 'mapsoo-production-review', version: '1.0.0' },
      output_provenance: 'hybrid' as const,
      contains_generative_ai: true,
      model_provider: provider,
      model,
      // The base seed is also the portable WorldLayoutPlan binding key.
      // Production provenance belongs in provider/model fields and the review
      // record; changing this value would detach an otherwise unchanged plan.
      seed: manifest.provenance.seed,
      human_curated: false,
    },
  };
  if (manifest.profile === 'topdown-farm') return shared as Alpha9PackManifest;
  if (manifest.profile === 'side-platformer') return shared as Alpha10PackManifest;
  return shared as Alpha11PackManifest;
}

function validateReviewManifest(manifest: ProductionReviewBaseManifest): void {
  if (manifest.profile === 'topdown-farm') {
    assertAlpha9PackManifest(manifest);
    return;
  }
  const issues = manifest.profile === 'side-platformer'
    ? validateAlpha10PackManifest(manifest)
    : validateAlpha11PackManifest(manifest);
  if (issues.length > 0) {
    fail('production-review.output-manifest', `Review pack manifest is invalid: ${issues.map(({ code }) => code).join(', ')}.`);
  }
}

function assertTextPrivacy(path: string, bytes: Uint8Array): void {
  if (!/\.(?:json|md)$/.test(path)) return;
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('production-review.privacy', `Text payload is not strict UTF-8: ${path}.`);
  }
  if (containsPrivateConsumerToken(value)) {
    fail('production-review.privacy', `Text payload crosses the private consumer boundary: ${path}.`);
  }
}

async function prepareReviewTerrainAutotileAttachment(
  base: Readonly<{
    manifest: ProductionReviewBaseManifest;
    files: Readonly<Record<string, Uint8Array>>;
  }>,
  value: ProductionReviewTerrainAutotileArtifact,
): Promise<Readonly<{
  binding: WorldTerrainAutotilePackBinding;
  payloads: ReadonlyMap<string, Uint8Array>;
}>> {
  const layoutBinding = base.manifest.layout;
  const paletteBinding = base.manifest.material_palette;
  if (!layoutBinding || !paletteBinding) {
    fail(
      'production-review.terrain-autotile',
      'Terrain autotiles require a base pack with exact layout and material-palette bindings.',
    );
  }
  const expectedCell = TERRAIN_AUTOTILE_CELL_BY_PROFILE[base.manifest.profile];
  if (
    !isRecord(value)
    || !isRecord(value.cell)
    || !Array.isArray(value.images)
    || value.cell.width !== expectedCell.width
    || value.cell.height !== expectedCell.height
  ) {
    fail(
      'production-review.terrain-autotile',
      `Terrain autotile cells must be ${expectedCell.width} by ${expectedCell.height} for ${base.manifest.profile}.`,
    );
  }
  const layoutBytes = base.files[layoutBinding.path];
  const paletteBytes = base.files[paletteBinding.path];
  if (
    !layoutBytes
    || !paletteBytes
    || await sha256(layoutBytes) !== layoutBinding.sha256
    || await sha256(paletteBytes) !== paletteBinding.sha256
  ) {
    fail(
      'production-review.terrain-autotile',
      'Base layout or material-palette bytes differ from their manifest bindings.',
    );
  }
  let preparedLayout: PreparedWorldLayoutPackEntry;
  let preparedPalette: PreparedWorldMaterialPalettePackEntry;
  try {
    const plan = await materializeWorldLayoutPlan(
      parseJson<unknown>(layoutBytes, 'Base world layout plan'),
    );
    const palette = await materializeWorldMaterialPalette(
      parseJson<unknown>(paletteBytes, 'Base world material palette'),
      { plan, layoutPlanSha256: layoutBinding.sha256 },
    );
    if (
      plan.profile !== base.manifest.profile
      || paletteBinding.layout_plan_sha256 !== layoutBinding.sha256
      || paletteBinding.palette_id !== palette.palette_id
    ) {
      fail(
        'production-review.terrain-autotile',
        'Base terrain authoring bindings are inconsistent.',
      );
    }
    preparedLayout = Object.freeze({
      plan,
      bytes: Uint8Array.from(layoutBytes),
      binding: layoutBinding,
    });
    preparedPalette = Object.freeze({
      palette,
      bytes: Uint8Array.from(paletteBytes),
      binding: paletteBinding,
    });
  } catch (error) {
    if (error instanceof ProductionReviewPackError) throw error;
    fail(
      'production-review.terrain-autotile',
      'Base layout or material palette is not a valid terrain authoring source.',
    );
  }
  try {
    const attachment = await prepareTerrainAutotileAttachment(
      preparedLayout,
      preparedPalette,
      expectedCell,
      value,
      new Set(Object.keys(base.files)),
    );
    return Object.freeze({
      binding: attachment.prepared.binding,
      payloads: attachment.payloads,
    });
  } catch (error) {
    if (!(error instanceof TerrainAutotileAttachmentError)) throw error;
    fail(
      'production-review.terrain-autotile',
      `Terrain autotile authoring input is invalid: ${error.code}.`,
    );
  }
}

/**
 * Replaces every visible production role over a validated procedural base
 * while retaining its deterministic scene, collision and navigation data.
 */
export async function buildProductionReviewPack(
  plan: ProductionArtPlan,
  inventory: ProductionArtRunInventory,
  baseArtifact: ProductionReviewBasePackArtifact,
  options: ProductionReviewPackOptions,
  terrainAutotileValue?: ProductionReviewTerrainAutotileArtifact,
): Promise<ProductionReviewPack> {
  assertOptions(options);
  if (plan.profile === 'layered-depth-2d') {
    fail('production-review.profile', 'Layered-depth must use the specialized Pack 1.0 assembler.');
  }
  const base = await readBaseArchive(baseArtifact);
  validateBaseManifest(base.manifest, base.files);
  if (base.manifest.profile !== plan.profile || inventory.profile !== plan.profile) {
    fail('production-review.profile', 'Base pack, plan and run inventory profiles differ.');
  }
  const projection = await projectProductionReviewPackVisuals(
    plan,
    inventory,
    base.manifest,
    base.files,
  );
  const terrainAutotiles = terrainAutotileValue === undefined
    ? undefined
    : await prepareReviewTerrainAutotileAttachment(base, terrainAutotileValue);
  const review = reviewRecord(projection, inventory, await sha256(base.manifestBytes));
  const provider = cleanModelText(inventory.providers, 'Provider');
  const model = cleanModelText(inventory.models, 'Model');
  const replacements = new Map(projection.files.map((file) => [file.path, file.readBytes()]));
  replacements.set('license-assets.md', text(
    '# Internal production-art review license\n\n'
      + 'This combined review pack is not licensed for redistribution. '
      + 'Its model-backed visual candidates remain LicenseRef-UNRELEASED until '
      + 'human art and rights review are explicitly completed. Reference images, '
      + 'private prompts and model working files are not included.\n',
  ));
  replacements.set('readme.md', text(
    `# ${options.title}\n\n`
      + `Internal-review ${plan.profile} Godot asset pack assembled by Mapsoo Worldforge. `
      + 'Visible PNGs are model-backed candidates; deterministic scene, collision '
      + 'and navigation data come from the validated base pack. This archive is '
      + 'not approved for publication or redistribution.\n',
  ));
  replacements.set('production-art-review.json', json(review));
  replacements.set(
    'schema/mapsoo-production-art-pack-review-1.0.schema.json',
    json(reviewSchema),
  );
  replacements.set(
    'schema/mapsoo-production-review-pack-manifest-1.0.schema.json',
    json(reviewManifestSchema),
  );
  if (terrainAutotiles) {
    for (const [path, bytes] of terrainAutotiles.payloads) {
      replacements.set(path, Uint8Array.from(bytes));
    }
  }

  const outputBytes = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(base.files)) {
    if (path === 'generation-receipt.json' || path === PUBLISHED_PACK_SCHEMA_PATHS[plan.profile]) continue;
    outputBytes.set(path, Uint8Array.from(replacements.get(path) ?? bytes));
  }
  for (const [path, bytes] of replacements) outputBytes.set(path, Uint8Array.from(bytes));
  const mediaType = (path: string): FileRecord['media_type'] => {
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.schema.json')) return 'application/schema+json';
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.md')) return 'text/markdown';
    return fail('production-review.output-path', `Unsupported output path: ${path}.`);
  };
  const fileRecords = await Promise.all([...outputBytes].map(([path, bytes]) =>
    record(path, mediaType(path), bytes)));
  fileRecords.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const manifest = transformManifest(
    base.manifest,
    options,
    fileRecords,
    provider,
    model,
    terrainAutotiles?.binding,
  );
  validateReviewManifest(manifest);
  const manifestBytes = json(manifest);
  for (const [path, bytes] of outputBytes) assertTextPrivacy(path, bytes);
  assertTextPrivacy('mapsoo.manifest.json', manifestBytes);

  const root = `mapsoo-${options.packId}-${plan.profile}-production-review-v${manifest.pack.version}/`;
  const archive = new JSZip();
  const entries = [
    ...[...outputBytes].map(([path, bytes]) => ({ path: `${root}${path}`, bytes })),
    { path: `${root}mapsoo.manifest.json`, bytes: manifestBytes },
  ].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  for (const item of entries) {
    archive.file(item.path, item.bytes, {
      binary: true,
      createFolders: false,
      date: ZIP_DATE,
      unixPermissions: 0o100644,
    });
  }
  const bytes = await archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
  return Object.freeze({
    filename: `${root.slice(0, -1)}.zip`,
    bytes,
    manifest,
    review,
  });
}
