import JSZip from 'jszip';

import collisionSchema from '../../schemas/mapsoo-layered-depth-collision-0.4.schema.json';
import navigationSchema from '../../schemas/mapsoo-layered-depth-navigation-0.4.schema.json';
import sceneSchema from '../../schemas/mapsoo-layered-depth-scene-0.4.schema.json';
import packSchema from '../../schemas/mapsoo-pack-0.9.schema.json';
import receiptSchema from '../../schemas/mapsoo-world-asset-receipt-0.4.schema.json';
import type { ConfirmedGenerationBinding } from '../core/confirmed-generation-binding';
import { fingerprintGenerationRequestV2, type GenerationRequestV2 } from '../core/generation-request-v2';
import {
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_REQUIRED_ROLES,
  type LAYERED_DEPTH_NPC_ACTIONS,
  type LAYERED_DEPTH_PLAYER_ACTIONS,
} from '../core/layered-depth-asset-bundle';
import {
  ALPHA12_ATLAS_IDS,
  ALPHA12_LAYER_IDS,
  ALPHA12_PACK_SCHEMA_VERSION,
  ALPHA12_PACK_VERSION,
  ALPHA12_PLANE_IDS,
  materializeAlpha12Runtime,
  validateAlpha12PackManifest,
  type Alpha12CollisionSidecar,
  type Alpha12NavigationSidecar,
  type Alpha12PackManifest,
  type Alpha12SceneSidecar,
} from '../core/pack-manifest-alpha12';
import { projectLayeredDepthWorldAssetReceipt } from '../core/world-asset-receipt-alpha12';
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
import {
  prepareWorldMaterialPalettePackEntry,
  WORLD_MATERIAL_PALETTE_PATH,
} from '../core/world-material-palette';

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
type MediaType = Alpha12PackManifest['files'][number]['media_type'];
type FileRecord = Alpha12PackManifest['files'][number];
interface Entry { readonly path: string; readonly bytes: Uint8Array; readonly record: FileRecord }

const text = (value: string) => new TextEncoder().encode(value);
const json = (value: unknown) => text(`${JSON.stringify(value, null, 2)}\n`);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function entry(path: string, mediaType: MediaType, bytes: Uint8Array): Promise<Entry> {
  return { path, bytes, record: { path, media_type: mediaType, bytes: bytes.byteLength, sha256: await sha256(bytes) } };
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch (error) {
    throw new Error(`Alpha12 ${label} payload is not valid UTF-8 JSON.`, { cause: error });
  }
}

export interface Alpha12PortablePack {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly manifest: Alpha12PackManifest;
}

/** Deterministic Pack 0.9 source archive. Runtime code remains in the trusted importer. */
export async function buildAlpha12WorldAssetPack(
  run: WorldAssetGenerationResult,
  request: GenerationRequestV2,
  completedAt: string,
  confirmationBinding?: ConfirmedGenerationBinding,
  layoutPlan?: WorldLayoutPlan,
): Promise<Alpha12PortablePack> {
  assertTrustedWorldAssetGeneration(run);
  if (run.requestId !== request.id
    || request.profile !== 'layered-depth-2d'
    || run.bundle.profile !== 'layered-depth-2d') {
    throw new Error('Alpha12 export requires the matching layered-depth request.');
  }
  if (await fingerprintGenerationRequestV2(request) !== run.requestFingerprintSha256) {
    throw new Error('Alpha12 export request fingerprint does not match the trusted generation run.');
  }
  if (request.references.some(({ rights }) =>
    rights.basis !== 'owned' || rights.allowOutputCc0Dedication !== true)) {
    throw new Error('Alpha12 CC0 export requires owned references with explicit CC0 permission.');
  }

  const receipt = await projectLayeredDepthWorldAssetReceipt(run, request, completedAt, confirmationBinding);
  const preparedLayout = layoutPlan === undefined
    ? undefined
    : await prepareWorldLayoutPackEntry(layoutPlan, request.profile, request.seed);
  const preparedPalette = preparedLayout === undefined
    ? undefined
    : await prepareWorldMaterialPalettePackEntry(preparedLayout, LAYERED_DEPTH_REQUIRED_ROLES);
  const generatedEntries = await Promise.all(run.payloads.map((payload) =>
    entry(payload.path, payload.mediaType, payload.readBytes())));
  const supportEntries = await Promise.all([
    entry('generation-receipt.json', 'application/json', json(receipt)),
    entry(
      'schema/mapsoo-pack-0.9.schema.json',
      'application/schema+json',
      json(selectWorldLayoutAwarePackSchema(packSchema, Boolean(preparedLayout))),
    ),
    entry('schema/mapsoo-layered-depth-scene-0.4.schema.json', 'application/schema+json', json(sceneSchema)),
    entry('schema/mapsoo-layered-depth-collision-0.4.schema.json', 'application/schema+json', json(collisionSchema)),
    entry('schema/mapsoo-layered-depth-navigation-0.4.schema.json', 'application/schema+json', json(navigationSchema)),
    entry('schema/mapsoo-world-asset-receipt-0.4.schema.json', 'application/schema+json', json(receiptSchema)),
    entry('license-assets.md', 'text/markdown', text(
      '# Asset license\n\nGenerated PNG and runtime JSON assets are dedicated under CC0-1.0.\n\nReference images are not included and retain their original rights. Schemas and documentation are MIT licensed.\n',
    )),
    entry('readme.md', 'text/markdown', text(
      `# ${request.id}\n\nOriginal layered-depth 2D source pack generated by Mapsoo Worldsmith ${ALPHA12_PACK_VERSION}.\n\nIncludes seven depth planes, stage terrain, props, structures, collectibles, effects, player and NPC atlases, 24 four-direction clips, collision, traversal data and a composited preview. It does not contain assets or names from any commercial game. Install the official Mapsoo Godot importer separately and select mapsoo.manifest.json.\n`,
    )),
  ]);
  const layoutEntries = preparedLayout && preparedPalette
    ? [
      await entry(WORLD_LAYOUT_PACK_PATH, 'application/json', preparedLayout.bytes),
      await entry(WORLD_MATERIAL_PALETTE_PATH, 'application/json', preparedPalette.bytes),
    ]
    : [];
  const entries = [...generatedEntries, ...supportEntries, ...layoutEntries].sort((left, right) =>
    left.path.localeCompare(right.path, 'en'));
  const assetPath = new Map(run.bundle.assets.map(({ id, path }) => [id, path]));
  const rolePath = new Map(run.bundle.roles.map(({ role, assetId }) =>
    [role, assetPath.get(assetId) ?? '']));
  const payloadById = new Map(run.payloads.map((payload) => [payload.assetId, payload]));
  const scene = parseJson<Alpha12SceneSidecar>(
    payloadById.get(run.bundle.scene.dataAssetId)?.readBytes() ?? new Uint8Array(),
    'scene',
  );
  const collision = parseJson<Alpha12CollisionSidecar>(
    payloadById.get(run.bundle.scene.collisionAssetId)?.readBytes() ?? new Uint8Array(),
    'collision',
  );
  const navigation = parseJson<Alpha12NavigationSidecar>(
    payloadById.get(run.bundle.scene.navigationAssetId)?.readBytes() ?? new Uint8Array(),
    'navigation',
  );
  const atlasPaths: Record<typeof ALPHA12_ATLAS_IDS[number], string> = {
    terrain: rolePath.get('terrain.ground') ?? '',
    props: rolePath.get('prop.tree') ?? '',
    structures: rolePath.get('structure.entrance') ?? '',
    collectibles: rolePath.get('collectible.primary') ?? '',
    effects: rolePath.get('effect.footstep') ?? '',
    player: rolePath.get('character.player.atlas') ?? '',
    npc: rolePath.get('character.npc.atlas') ?? '',
  };
  const planePaths: Record<typeof ALPHA12_PLANE_IDS[number], { role: string; path: string }> = {
    sky: { role: 'background.sky', path: rolePath.get('background.sky') ?? '' },
    far: { role: 'background.far', path: rolePath.get('background.far') ?? '' },
    mid: { role: 'background.mid', path: rolePath.get('background.mid') ?? '' },
    'depth-fog': { role: 'background.depth-fog', path: rolePath.get('background.depth-fog') ?? '' },
    near: { role: 'near.overlay', path: rolePath.get('near.overlay') ?? '' },
    'ambient-light': { role: 'lighting.ambient', path: rolePath.get('lighting.ambient') ?? '' },
    foreground: { role: 'foreground.overlay', path: rolePath.get('foreground.overlay') ?? '' },
  };
  const manifest: Alpha12PackManifest = {
    schema_version: ALPHA12_PACK_SCHEMA_VERSION,
    pack: {
      id: request.id,
      title: request.id,
      version: ALPHA12_PACK_VERSION,
      generator: { name: 'Mapsoo Worldsmith', version: ALPHA12_PACK_VERSION },
      created_at: completedAt,
    },
    profile: 'layered-depth-2d',
    completeness_policy: 'layered-depth-2d-complete-v1',
    compatibility: {
      godot_min: '4.3',
      projection: 'layered-depth-stage',
      art_style: 'pixel_art',
      importer: { id: 'mapsoo_importer', min_version: ALPHA12_PACK_VERSION },
    },
    layers: ALPHA12_LAYER_IDS.map((id, order) => ({ id, order })),
    atlases: ALPHA12_ATLAS_IDS.map((id) => ({ id, path: atlasPaths[id] })),
    planes: ALPHA12_PLANE_IDS.map((id) => ({ id, ...planePaths[id] })),
    roles: LAYERED_DEPTH_REQUIRED_ROLES.map((role) => ({ role, path: rolePath.get(role) ?? '' })),
    characters: run.bundle.characters.map((character) => ({
      id: character.id as 'player' | 'npc',
      atlas: assetPath.get(character.atlasAssetId) ?? '',
      frame_size: [48, 72] as const,
      pivot: [24, 67] as const,
      clips: character.clips.map((clip) => ({
        id: `${clip.action}.${clip.direction}`,
        action: clip.action as typeof LAYERED_DEPTH_PLAYER_ACTIONS[number] | typeof LAYERED_DEPTH_NPC_ACTIONS[number],
        direction: clip.direction as typeof LAYERED_DEPTH_DIRECTIONS[number],
        fps: clip.fps,
        frames: clip.frames.map(({ x, y }) => ({ x, y })),
      })),
    })),
    runtime: {
      scene: { path: assetPath.get(run.bundle.scene.dataAssetId) ?? '' },
      collision: { path: assetPath.get(run.bundle.scene.collisionAssetId) ?? '' },
      navigation: { path: assetPath.get(run.bundle.scene.navigationAssetId) ?? '' },
      spawn: run.bundle.scene.spawn,
    },
    ...(preparedLayout ? { layout: preparedLayout.binding } : {}),
    ...(preparedPalette ? { material_palette: preparedPalette.binding } : {}),
    files: entries.map(({ record }) => record),
    license: {
      output: { id: 'CC0-1.0', notice_path: 'license-assets.md', permits_redistribution: true },
    },
    provenance: {
      provider: { id: run.provider.id, version: run.provider.version },
      output_provenance: 'procedural',
      contains_generative_ai: false,
      model_provider: null,
      model: null,
      seed: request.seed,
      human_curated: false,
    },
  };
  const issues = validateAlpha12PackManifest(manifest);
  if (issues.length > 0) {
    throw new Error(`Invalid Alpha12 manifest: ${issues.map(({ code }) => code).join(', ')}.`);
  }
  materializeAlpha12Runtime(manifest, scene, collision, navigation);

  const root = `mapsoo-${request.id}-v${ALPHA12_PACK_VERSION}`;
  const archive = new JSZip();
  const archiveEntries = [
    ...entries.map(({ path, bytes }) => ({ path: `${root}/${path}`, bytes })),
    { path: `${root}/mapsoo.manifest.json`, bytes: json(manifest) },
  ].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  for (const item of archiveEntries) {
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
  return Object.freeze({ filename: `${root}.zip`, bytes, manifest });
}
