import JSZip from 'jszip';

import collisionSchema from '../../schemas/mapsoo-side-platformer-collision-0.2.schema.json';
import navigationSchema from '../../schemas/mapsoo-side-platformer-navigation-0.2.schema.json';
import packSchema from '../../schemas/mapsoo-pack-0.7.schema.json';
import receiptSchema from '../../schemas/mapsoo-world-asset-receipt-0.2.schema.json';
import sceneSchema from '../../schemas/mapsoo-side-platformer-scene-0.2.schema.json';
import {
  ALPHA10_ATLAS_IDS,
  ALPHA10_LAYER_IDS,
  ALPHA10_PACK_SCHEMA_VERSION,
  ALPHA10_PACK_VERSION,
  materializeAlpha10Runtime,
  validateAlpha10PackManifest,
  type Alpha10CollisionSidecar,
  type Alpha10NavigationSidecar,
  type Alpha10PackManifest,
  type Alpha10SceneSidecar,
} from '../core/pack-manifest-alpha10';
import { SIDE_PLATFORMER_ACTIONS, SIDE_PLATFORMER_REQUIRED_ROLES } from '../core/side-platformer-asset-bundle';
import { fingerprintGenerationRequestV2, type GenerationRequestV2 } from '../core/generation-request-v2';
import type { ConfirmedGenerationBinding } from '../core/confirmed-generation-binding';
import { projectSidePlatformerWorldAssetReceipt } from '../core/world-asset-receipt-alpha10';
import {
  assertTrustedWorldAssetGeneration,
  type WorldAssetGenerationResult,
} from '../core/world-asset-provider';
import {
  prepareWorldLayoutPackEntry,
  selectWorldLayoutAwarePackSchema,
  WORLD_LAYOUT_PACK_PATH,
} from '../core/world-layout-pack-binding';
import type { WorldLayoutPlan } from '../core/world-layout-plan';

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
type MediaType = Alpha10PackManifest['files'][number]['media_type'];
type Alpha10FileRecord = Alpha10PackManifest['files'][number];
interface Entry { readonly path: string; readonly bytes: Uint8Array; readonly record: Alpha10FileRecord }

function text(value: string): Uint8Array { return new TextEncoder().encode(value); }
function json(value: unknown): Uint8Array { return text(`${JSON.stringify(value, null, 2)}\n`); }
async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function entry(path: string, mediaType: MediaType, bytes: Uint8Array): Promise<Entry> {
  return { path, bytes, record: { path, media_type: mediaType, bytes: bytes.byteLength, sha256: await sha256(bytes) } };
}
function parseJson<T>(bytes: Uint8Array, label: string): T {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; }
  catch (error) { throw new Error(`Alpha10 ${label} payload is not valid UTF-8 JSON.`, { cause: error }); }
}

export interface Alpha10PortablePack {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly manifest: Alpha10PackManifest;
}

export async function buildAlpha10WorldAssetPack(
  run: WorldAssetGenerationResult,
  request: GenerationRequestV2,
  completedAt: string,
  confirmationBinding?: ConfirmedGenerationBinding,
  layoutPlan?: WorldLayoutPlan,
): Promise<Alpha10PortablePack> {
  assertTrustedWorldAssetGeneration(run);
  if (run.requestId !== request.id || request.profile !== 'side-platformer' || run.bundle.profile !== 'side-platformer') {
    throw new Error('Alpha10 export requires the matching side-platformer request.');
  }
  if (await fingerprintGenerationRequestV2(request) !== run.requestFingerprintSha256) {
    throw new Error('Alpha10 export request fingerprint does not match the trusted generation run.');
  }
  if (request.references.some(({ rights }) => rights.basis !== 'owned' || rights.allowOutputCc0Dedication !== true)) {
    throw new Error('Alpha10 CC0 export requires user-owned references with explicit CC0 dedication permission.');
  }
  const receipt = await projectSidePlatformerWorldAssetReceipt(run, request, completedAt, confirmationBinding);
  const preparedLayout = layoutPlan === undefined
    ? undefined
    : await prepareWorldLayoutPackEntry(layoutPlan, request.profile, request.seed);
  const generatedEntries = await Promise.all(run.payloads.map(async (payload) => entry(payload.path, payload.mediaType, payload.readBytes())));
  const supportEntries = await Promise.all([
    entry('generation-receipt.json', 'application/json', json(receipt)),
    entry(
      'schema/mapsoo-pack-0.7.schema.json',
      'application/schema+json',
      json(selectWorldLayoutAwarePackSchema(packSchema, Boolean(preparedLayout))),
    ),
    entry('schema/mapsoo-side-platformer-scene-0.2.schema.json', 'application/schema+json', json(sceneSchema)),
    entry('schema/mapsoo-side-platformer-collision-0.2.schema.json', 'application/schema+json', json(collisionSchema)),
    entry('schema/mapsoo-side-platformer-navigation-0.2.schema.json', 'application/schema+json', json(navigationSchema)),
    entry('schema/mapsoo-world-asset-receipt-0.2.schema.json', 'application/schema+json', json(receiptSchema)),
    entry('license-assets.md', 'text/markdown', text(
      '# Asset license\n\nGenerated PNG and runtime JSON assets are dedicated under CC0-1.0.\n\nReference images are not included and retain their original rights. Schemas and documentation are MIT licensed.\n',
    )),
    entry('readme.md', 'text/markdown', text(
      `# ${request.id}\n\nComplete side-platformer source asset pack generated by Mapsoo Worldsmith ${ALPHA10_PACK_VERSION}.\n\nIncludes platform terrain, one-way surfaces, slopes, hazards, props, structures, collectibles, layered backgrounds, foreground, twelve side-view character clips, collision, traversal graph, scene data and preview. Install the official Mapsoo Godot importer separately and select mapsoo.manifest.json.\n`,
    )),
  ]);
  const layoutEntries = preparedLayout
    ? [await entry(WORLD_LAYOUT_PACK_PATH, 'application/json', preparedLayout.bytes)]
    : [];
  const entries = [...generatedEntries, ...supportEntries, ...layoutEntries].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const assetPath = new Map(run.bundle.assets.map((asset) => [asset.id, asset.path]));
  const rolePath = new Map(run.bundle.roles.map((role) => [role.role, assetPath.get(role.assetId) ?? '']));
  const payloadById = new Map(run.payloads.map((payload) => [payload.assetId, payload]));
  const scene = parseJson<Alpha10SceneSidecar>(payloadById.get(run.bundle.scene.dataAssetId)?.readBytes() ?? new Uint8Array(), 'scene');
  const collision = parseJson<Alpha10CollisionSidecar>(payloadById.get(run.bundle.scene.collisionAssetId)?.readBytes() ?? new Uint8Array(), 'collision');
  const navigation = parseJson<Alpha10NavigationSidecar>(payloadById.get(run.bundle.scene.navigationAssetId)?.readBytes() ?? new Uint8Array(), 'navigation');
  const character = run.bundle.characters[0];
  const atlasPaths: Record<typeof ALPHA10_ATLAS_IDS[number], string> = {
    terrain: rolePath.get('terrain.solid') ?? '',
    hazards: rolePath.get('hazard.spikes') ?? '',
    props: rolePath.get('prop.crate') ?? '',
    structures: rolePath.get('structure.entrance') ?? '',
    collectibles: rolePath.get('collectible.primary') ?? '',
    backgrounds: rolePath.get('background.far') ?? '',
    foreground: rolePath.get('foreground.overlay') ?? '',
    character: rolePath.get('character.player.atlas') ?? '',
  };
  const manifest: Alpha10PackManifest = {
    schema_version: ALPHA10_PACK_SCHEMA_VERSION,
    pack: {
      id: request.id, title: request.id, version: ALPHA10_PACK_VERSION,
      generator: { name: 'Mapsoo Worldsmith', version: ALPHA10_PACK_VERSION }, created_at: completedAt,
    },
    profile: 'side-platformer', completeness_policy: 'side-platformer-complete-v1',
    compatibility: {
      godot_min: '4.3', grid: 'pixel', art_style: 'pixel_art',
      importer: { id: 'mapsoo_importer', min_version: ALPHA10_PACK_VERSION },
    },
    layers: ALPHA10_LAYER_IDS.map((id, order) => ({ id, order })),
    atlases: ALPHA10_ATLAS_IDS.map((id) => ({ id, path: atlasPaths[id] })),
    roles: SIDE_PLATFORMER_REQUIRED_ROLES.map((role) => ({ role, path: rolePath.get(role) ?? '' })),
    character: {
      id: character.id, atlas: atlasPaths.character,
      frame_size: [character.frameWidth, character.frameHeight], pivot: character.pivot,
      clips: character.clips.map((clip) => ({
        id: `${clip.action}.${clip.direction}`, action: clip.action as typeof SIDE_PLATFORMER_ACTIONS[number],
        direction: clip.direction as 'left' | 'right', fps: clip.fps,
        frames: clip.frames.map((frame) => ({ x: frame.x, y: frame.y })),
      })),
    },
    runtime: {
      scene: { path: assetPath.get(run.bundle.scene.dataAssetId) ?? '' },
      collision: { path: assetPath.get(run.bundle.scene.collisionAssetId) ?? '' },
      navigation: { path: assetPath.get(run.bundle.scene.navigationAssetId) ?? '' },
      spawn: run.bundle.scene.spawn,
    },
    ...(preparedLayout ? { layout: preparedLayout.binding } : {}),
    files: entries.map(({ record }) => record),
    license: { output: { id: 'CC0-1.0', notice_path: 'license-assets.md', permits_redistribution: true } },
    provenance: {
      provider: { id: run.provider.id, version: run.provider.version },
      output_provenance: 'procedural', contains_generative_ai: false,
      model_provider: null, model: null, seed: request.seed, human_curated: false,
    },
  };
  const manifestIssues = validateAlpha10PackManifest(manifest);
  if (manifestIssues.length) throw new Error(`Invalid Alpha10 manifest: ${manifestIssues.map(({ code }) => code).join(', ')}.`);
  materializeAlpha10Runtime(manifest, scene, collision, navigation);

  const root = `mapsoo-${request.id}-v${ALPHA10_PACK_VERSION}`;
  const archive = new JSZip();
  const archiveEntries = [
    ...entries.map(({ path, bytes }) => ({ path: `${root}/${path}`, bytes })),
    { path: `${root}/mapsoo.manifest.json`, bytes: json(manifest) },
  ].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  for (const item of archiveEntries) archive.file(item.path, item.bytes, { binary: true, createFolders: false, date: ZIP_DATE, unixPermissions: 0o100644 });
  const bytes = await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX', streamFiles: false });
  return Object.freeze({ filename: `${root}.zip`, bytes, manifest });
}
