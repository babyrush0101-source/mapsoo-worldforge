import JSZip from 'jszip';

import collisionSchema from '../../schemas/mapsoo-isometric-action-collision-0.3.schema.json';
import navigationSchema from '../../schemas/mapsoo-isometric-action-navigation-0.3.schema.json';
import sceneSchema from '../../schemas/mapsoo-isometric-action-scene-0.3.schema.json';
import packSchema from '../../schemas/mapsoo-pack-0.8.schema.json';
import receiptSchema from '../../schemas/mapsoo-world-asset-receipt-0.3.schema.json';
import type { ConfirmedGenerationBinding } from '../core/confirmed-generation-binding';
import { fingerprintGenerationRequestV2, type GenerationRequestV2 } from '../core/generation-request-v2';
import {
  ISOMETRIC_ACTION_DIRECTIONS,
  ISOMETRIC_ACTION_REQUIRED_ROLES,
  type ISOMETRIC_ENEMY_ACTIONS,
  type ISOMETRIC_PLAYER_ACTIONS,
} from '../core/isometric-action-asset-bundle';
import {
  ALPHA11_ATLAS_IDS,
  ALPHA11_LAYER_IDS,
  ALPHA11_PACK_SCHEMA_VERSION,
  ALPHA11_PACK_VERSION,
  materializeAlpha11Runtime,
  validateAlpha11PackManifest,
  type Alpha11CollisionSidecar,
  type Alpha11NavigationSidecar,
  type Alpha11PackManifest,
  type Alpha11SceneSidecar,
} from '../core/pack-manifest-alpha11';
import { projectIsometricActionWorldAssetReceipt } from '../core/world-asset-receipt-alpha11';
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
type MediaType = Alpha11PackManifest['files'][number]['media_type'];
type FileRecord = Alpha11PackManifest['files'][number];
interface Entry { readonly path: string; readonly bytes: Uint8Array; readonly record: FileRecord }

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function json(value: unknown): Uint8Array {
  return text(`${JSON.stringify(value, null, 2)}\n`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function entry(path: string, mediaType: MediaType, bytes: Uint8Array): Promise<Entry> {
  return {
    path,
    bytes,
    record: { path, media_type: mediaType, bytes: bytes.byteLength, sha256: await sha256(bytes) },
  };
}

function parseJson<T>(bytes: Uint8Array, label: string): T {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  } catch (error) {
    throw new Error(`Alpha11 ${label} payload is not valid UTF-8 JSON.`, { cause: error });
  }
}

export interface Alpha11PortablePack {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly manifest: Alpha11PackManifest;
}

/** Builds the deterministic Pack 0.8 source archive. The importer remains a separate trusted component. */
export async function buildAlpha11WorldAssetPack(
  run: WorldAssetGenerationResult,
  request: GenerationRequestV2,
  completedAt: string,
  confirmationBinding?: ConfirmedGenerationBinding,
  layoutPlan?: WorldLayoutPlan,
): Promise<Alpha11PortablePack> {
  assertTrustedWorldAssetGeneration(run);
  if (run.requestId !== request.id
    || request.profile !== 'isometric-action'
    || run.bundle.profile !== 'isometric-action') {
    throw new Error('Alpha11 export requires the matching isometric-action request.');
  }
  if (await fingerprintGenerationRequestV2(request) !== run.requestFingerprintSha256) {
    throw new Error('Alpha11 export request fingerprint does not match the trusted generation run.');
  }
  if (request.references.some(({ rights }) =>
    rights.basis !== 'owned' || rights.allowOutputCc0Dedication !== true)) {
    throw new Error('Alpha11 CC0 export requires owned references with explicit CC0 permission.');
  }

  const receipt = await projectIsometricActionWorldAssetReceipt(
    run,
    request,
    completedAt,
    confirmationBinding,
  );
  const preparedLayout = layoutPlan === undefined
    ? undefined
    : await prepareWorldLayoutPackEntry(layoutPlan, request.profile, request.seed);
  const generatedEntries = await Promise.all(run.payloads.map((payload) =>
    entry(payload.path, payload.mediaType, payload.readBytes())));
  const supportEntries = await Promise.all([
    entry('generation-receipt.json', 'application/json', json(receipt)),
    entry(
      'schema/mapsoo-pack-0.8.schema.json',
      'application/schema+json',
      json(selectWorldLayoutAwarePackSchema(packSchema, Boolean(preparedLayout))),
    ),
    entry('schema/mapsoo-isometric-action-scene-0.3.schema.json', 'application/schema+json', json(sceneSchema)),
    entry('schema/mapsoo-isometric-action-collision-0.3.schema.json', 'application/schema+json', json(collisionSchema)),
    entry('schema/mapsoo-isometric-action-navigation-0.3.schema.json', 'application/schema+json', json(navigationSchema)),
    entry('schema/mapsoo-world-asset-receipt-0.3.schema.json', 'application/schema+json', json(receiptSchema)),
    entry('license-assets.md', 'text/markdown', text(
      '# Asset license\n\nGenerated PNG and runtime JSON assets are dedicated under CC0-1.0.\n\nReference images are not included and retain their original rights. Schemas and documentation are MIT licensed.\n',
    )),
    entry('readme.md', 'text/markdown', text(
      `# ${request.id}\n\nOriginal diamond-grid action-world source pack generated by Mapsoo Worldsmith ${ALPHA11_PACK_VERSION}.\n\nIncludes terrain and elevation, hazards, props, structures, collectibles, combat effects, player plus melee and ranged enemy atlases, 128 eight-direction clips, collision, navigation, scene data and preview. It does not copy or contain assets from any commercial game. Install the official Mapsoo Godot importer separately and select mapsoo.manifest.json.\n`,
    )),
  ]);
  const layoutEntries = preparedLayout
    ? [await entry(WORLD_LAYOUT_PACK_PATH, 'application/json', preparedLayout.bytes)]
    : [];
  const entries = [...generatedEntries, ...supportEntries, ...layoutEntries].sort((left, right) =>
    left.path.localeCompare(right.path, 'en'));
  const assetPath = new Map(run.bundle.assets.map(({ id, path }) => [id, path]));
  const rolePath = new Map(run.bundle.roles.map(({ role, assetId }) =>
    [role, assetPath.get(assetId) ?? '']));
  const payloadById = new Map(run.payloads.map((payload) => [payload.assetId, payload]));
  const scene = parseJson<Alpha11SceneSidecar>(
    payloadById.get(run.bundle.scene.dataAssetId)?.readBytes() ?? new Uint8Array(),
    'scene',
  );
  const collision = parseJson<Alpha11CollisionSidecar>(
    payloadById.get(run.bundle.scene.collisionAssetId)?.readBytes() ?? new Uint8Array(),
    'collision',
  );
  const navigation = parseJson<Alpha11NavigationSidecar>(
    payloadById.get(run.bundle.scene.navigationAssetId)?.readBytes() ?? new Uint8Array(),
    'navigation',
  );
  const atlasPaths: Record<typeof ALPHA11_ATLAS_IDS[number], string> = {
    terrain: rolePath.get('terrain.floor.base') ?? '',
    hazards: rolePath.get('hazard.contact') ?? '',
    props: rolePath.get('prop.blocker') ?? '',
    structures: rolePath.get('structure.entrance') ?? '',
    collectibles: rolePath.get('collectible.primary') ?? '',
    effects: rolePath.get('effect.player-attack') ?? '',
    shadows: rolePath.get('effect.shadow') ?? '',
    player: rolePath.get('character.player.atlas') ?? '',
    'enemy-melee': rolePath.get('character.enemy-melee.atlas') ?? '',
    'enemy-ranged': rolePath.get('character.enemy-ranged.atlas') ?? '',
  };
  const manifest: Alpha11PackManifest = {
    schema_version: ALPHA11_PACK_SCHEMA_VERSION,
    pack: {
      id: request.id,
      title: request.id,
      version: ALPHA11_PACK_VERSION,
      generator: { name: 'Mapsoo Worldsmith', version: ALPHA11_PACK_VERSION },
      created_at: completedAt,
    },
    profile: 'isometric-action',
    completeness_policy: 'isometric-action-complete-v1',
    compatibility: {
      godot_min: '4.3',
      grid: 'diamond-64x32',
      art_style: 'pixel_art',
      importer: { id: 'mapsoo_importer', min_version: ALPHA11_PACK_VERSION },
    },
    layers: ALPHA11_LAYER_IDS.map((id, order) => ({ id, order })),
    atlases: ALPHA11_ATLAS_IDS.map((id) => ({ id, path: atlasPaths[id] })),
    roles: ISOMETRIC_ACTION_REQUIRED_ROLES.map((role) => ({ role, path: rolePath.get(role) ?? '' })),
    characters: run.bundle.characters.map((character) => ({
      id: character.id,
      atlas: assetPath.get(character.atlasAssetId) ?? '',
      frame_size: [48, 64] as const,
      pivot: [24, 58] as const,
      clips: character.clips.map((clip) => ({
        id: `${clip.action}.${clip.direction}`,
        action: clip.action as typeof ISOMETRIC_PLAYER_ACTIONS[number] | typeof ISOMETRIC_ENEMY_ACTIONS[number],
        direction: clip.direction as typeof ISOMETRIC_ACTION_DIRECTIONS[number],
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
  const issues = validateAlpha11PackManifest(manifest);
  if (issues.length > 0) {
    throw new Error(`Invalid Alpha11 manifest: ${issues.map(({ code }) => code).join(', ')}.`);
  }
  materializeAlpha11Runtime(manifest, scene, collision, navigation);

  const root = `mapsoo-${request.id}-v${ALPHA11_PACK_VERSION}`;
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
