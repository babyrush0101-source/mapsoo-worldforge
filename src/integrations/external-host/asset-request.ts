import type { WorldSpec } from '../../core/world-spec';
import { validateWorldSpec } from '../../core/validate-world';

export const EXTERNAL_HOST_ASSET_REQUEST_SCHEMA_VERSION = 'org.mapsoo.externalhost.asset-request/1.0.0' as const;
export const EXTERNAL_HOST_ASSET_REQUEST_EXTENSION = 'org.mapsoo.externalhost.assetrequest.v1' as const;

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;

type JsonObject = Record<string, unknown>;

export interface ExternalHostAssetRequest {
  schemaVersion: typeof EXTERNAL_HOST_ASSET_REQUEST_SCHEMA_VERSION;
  packId: string;
  world: {
    id: string;
    version: string;
    title: string;
    description: string;
  };
  scene: {
    id: string;
    requiredSceneTags: string[];
    contentRating: string;
  };
  seed: string;
  visual: WorldSpec['visual'];
  map: WorldSpec['map'];
  output: WorldSpec['output'];
}

export interface ExternalHostAssetProjection {
  assetRequestSha256: string;
  worldSpec: WorldSpec;
}

export type ExternalHostAssetRequestErrorCode =
  | 'request.invalid-shape'
  | 'request.invalid-value'
  | 'request.invalid-world-spec';

export class ExternalHostAssetRequestError extends Error {
  constructor(readonly code: ExternalHostAssetRequestErrorCode, message: string) {
    super(message);
    this.name = 'ExternalHostAssetRequestError';
  }
}

function fail(code: ExternalHostAssetRequestErrorCode, message: string): never {
  throw new ExternalHostAssetRequestError(code, message);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string): JsonObject {
  if (!isRecord(value)) fail('request.invalid-shape', `${path} must be an object.`);
  return value;
}

function exactKeys(value: JsonObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('request.invalid-shape', `${path} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function text(value: unknown, path: string, maximum: number, allowEmpty = false): string {
  if (
    typeof value !== 'string'
    || Array.from(value).length > maximum
    || (!allowEmpty && value.trim().length === 0)
    || CONTROL_CHARACTER.test(value)
  ) {
    fail('request.invalid-value', `${path} is not a supported public text value.`);
  }
  return value;
}

function id(value: unknown, path: string): string {
  const candidate = text(value, path, 80);
  if (!ID.test(candidate)) {
    fail('request.invalid-value', `${path} must use lowercase kebab-case.`);
  }
  return candidate;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail('request.invalid-value', `${path} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function normalizeRequest(input: unknown): ExternalHostAssetRequest {
  const root = record(input, 'request');
  exactKeys(root, ['schemaVersion', 'packId', 'world', 'scene', 'seed', 'visual', 'map', 'output'], 'request');

  if (root.schemaVersion !== EXTERNAL_HOST_ASSET_REQUEST_SCHEMA_VERSION) {
    fail('request.invalid-value', `request.schemaVersion must be ${EXTERNAL_HOST_ASSET_REQUEST_SCHEMA_VERSION}.`);
  }

  const world = record(root.world, 'request.world');
  exactKeys(world, ['id', 'version', 'title', 'description'], 'request.world');
  const version = text(world.version, 'request.world.version', 80);
  if (!SEMVER.test(version)) fail('request.invalid-value', 'request.world.version must be semantic version text.');

  const scene = record(root.scene, 'request.scene');
  exactKeys(scene, ['id', 'requiredSceneTags', 'contentRating'], 'request.scene');
  if (!Array.isArray(scene.requiredSceneTags) || scene.requiredSceneTags.length < 1 || scene.requiredSceneTags.length > 32) {
    fail('request.invalid-value', 'request.scene.requiredSceneTags must contain 1 to 32 public tags.');
  }
  const requiredSceneTags = scene.requiredSceneTags.map((value, index) => (
    id(value, `request.scene.requiredSceneTags[${index}]`)
  ));
  if (new Set(requiredSceneTags).size !== requiredSceneTags.length) {
    fail('request.invalid-value', 'request.scene.requiredSceneTags must not contain duplicates.');
  }

  const visual = record(root.visual, 'request.visual');
  exactKeys(visual, ['style', 'tileSize', 'palette'], 'request.visual');
  if (visual.style !== 'pixel-art') fail('request.invalid-value', 'request.visual.style must be pixel-art.');
  const tileSize = integer(visual.tileSize, 'request.visual.tileSize', 16, 64);
  if (![16, 32, 64].includes(tileSize)) {
    fail('request.invalid-value', 'request.visual.tileSize must be 16, 32, or 64.');
  }
  if (!Array.isArray(visual.palette) || visual.palette.length !== 5 || visual.palette.some((value) => (
    typeof value !== 'string' || !COLOR.test(value)
  ))) {
    fail('request.invalid-value', 'request.visual.palette must contain exactly five hexadecimal colors.');
  }

  const map = record(root.map, 'request.map');
  exactKeys(map, ['width', 'height', 'biome'], 'request.map');
  if (map.biome !== 'meadow' && map.biome !== 'desert' && map.biome !== 'snow') {
    fail('request.invalid-value', 'request.map.biome is not supported by the portable alpha.');
  }

  const output = record(root.output, 'request.output');
  exactKeys(output, ['targets', 'assetLicense'], 'request.output');
  if (
    !Array.isArray(output.targets)
    || output.targets.length !== 3
    || output.targets[0] !== 'common'
    || output.targets[1] !== 'godot'
    || output.targets[2] !== 'itch'
  ) {
    fail('request.invalid-value', 'request.output.targets must be common, godot, itch in that order.');
  }
  if (output.assetLicense !== 'CC0-1.0') {
    fail('request.invalid-value', 'request.output.assetLicense must be CC0-1.0 for the portable alpha.');
  }

  return {
    schemaVersion: EXTERNAL_HOST_ASSET_REQUEST_SCHEMA_VERSION,
    packId: id(root.packId, 'request.packId'),
    world: {
      id: id(world.id, 'request.world.id'),
      version,
      title: text(world.title, 'request.world.title', 120),
      description: text(world.description, 'request.world.description', 1000, true),
    },
    scene: {
      id: id(scene.id, 'request.scene.id'),
      requiredSceneTags,
      contentRating: id(scene.contentRating, 'request.scene.contentRating'),
    },
    seed: text(root.seed, 'request.seed', 160),
    visual: {
      style: 'pixel-art',
      tileSize: tileSize as WorldSpec['visual']['tileSize'],
      palette: [...visual.palette] as WorldSpec['visual']['palette'],
    },
    map: {
      width: integer(map.width, 'request.map.width', 8, 48),
      height: integer(map.height, 'request.map.height', 8, 32),
      biome: map.biome,
    },
    output: {
      targets: ['common', 'godot', 'itch'],
      assetLicense: 'CC0-1.0',
    },
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as JsonObject;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

async function sha256(textValue: string): Promise<string> {
  const bytes = new TextEncoder().encode(textValue);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalizeExternalHostAssetRequest(input: unknown): string {
  return `${canonicalJson(normalizeRequest(input))}\n`;
}

export async function projectExternalHostAssetRequest(input: unknown): Promise<ExternalHostAssetProjection> {
  const normalized = normalizeRequest(input);
  const assetRequestSha256 = await sha256(`${canonicalJson(normalized)}\n`);
  const worldSpec: WorldSpec = {
    schemaVersion: '0.2.0',
    id: normalized.packId,
    title: normalized.world.title,
    description: normalized.world.description,
    seed: normalized.seed,
    visual: {
      ...normalized.visual,
      palette: [...normalized.visual.palette],
    },
    map: { ...normalized.map },
    output: {
      targets: ['common', 'godot', 'itch'],
      assetLicense: 'CC0-1.0',
    },
    extensions: {
      [EXTERNAL_HOST_ASSET_REQUEST_EXTENSION]: {
        schemaVersion: EXTERNAL_HOST_ASSET_REQUEST_SCHEMA_VERSION,
        assetRequestSha256,
        externalHostWorldId: normalized.world.id,
        externalHostWorldVersion: normalized.world.version,
        sceneId: normalized.scene.id,
        requiredSceneTags: [...normalized.scene.requiredSceneTags],
        contentRating: normalized.scene.contentRating,
      },
    },
  };

  const errors = validateWorldSpec(worldSpec).filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    fail(
      'request.invalid-world-spec',
      `The public asset request could not be projected: ${errors.map((issue) => issue.code).join(', ')}.`,
    );
  }

  return { assetRequestSha256, worldSpec };
}
