import {
  ALPHA6_WORLD_SCHEMA_VERSION,
  PLACE_KINDS,
  PLACE_PLACEMENTS,
  LEGACY_WORLD_SCHEMA_VERSION,
  PLACES_WORLD_SCHEMA_VERSION,
  STRUCTURE_ARCHETYPES,
  WORLD_SCHEMA_VERSION,
  type GeneratedWorld,
  type WorldSpec,
} from './world-spec';
import { isValidGeneratorId, isValidGeneratorVersion } from './generator-identity';
import {
  FORBIDDEN_WORLD_SPEC_OBJECT_KEYS,
  MAX_WORLD_SPEC_FILE_BYTES,
  MAX_WORLD_SPEC_JSON_DEPTH,
  MAX_WORLD_SPEC_JSON_NODES,
} from './world-spec-limits';

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const WORLD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXTENSION_NAMESPACE = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;
const GENERATED_ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BIOMES = new Set(['meadow', 'desert', 'snow']);
const TILE_SIZES = new Set([16, 32, 64]);
const TILE_NAMES = new Set(['ground', 'water', 'path', 'detail']);
const PROP_KINDS = new Set(['tree', 'rock', 'flower', 'shrub', 'log', 'marker']);
const PLACE_KIND_SET = new Set<string>(PLACE_KINDS);
const PLACE_PLACEMENT_SET = new Set<string>(PLACE_PLACEMENTS);
const PLACE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACE_TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STRUCTURE_ARCHETYPE_SET = new Set<string>(STRUCTURE_ARCHETYPES);
const STRUCTURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== 'string') return false;
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function addUnknownKeyIssue(
  issues: ValidationIssue[],
  value: Record<string, unknown>,
  allowed: readonly string[],
  scope: string,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknownKeys.length > 0) {
    issues.push({
      code: `spec.unknown-${scope}-field`,
      severity: 'error',
      message: `Unknown ${scope} field${unknownKeys.length > 1 ? 's' : ''}: ${unknownKeys.join(', ')}.`,
    });
  }
}

interface JsonTraversalEntry {
  readonly value: unknown;
  readonly depth: number;
  readonly exit?: boolean;
}

function inspectWorldSpecJsonContract(value: unknown): ValidationIssue | null {
  const pending: JsonTraversalEntry[] = [{ value, depth: 0 }];
  const ancestors = new WeakSet<object>();
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;

    if (current.exit) {
      ancestors.delete(current.value as object);
      continue;
    }

    visitedNodes += 1;
    if (visitedNodes > MAX_WORLD_SPEC_JSON_NODES) {
      return {
        code: 'spec.too-complex',
        severity: 'error',
        message: `World Spec may contain at most ${MAX_WORLD_SPEC_JSON_NODES} JSON values.`,
      };
    }
    if (current.depth > MAX_WORLD_SPEC_JSON_DEPTH) {
      return {
        code: 'spec.too-deep',
        severity: 'error',
        message: `World Spec may be nested at most ${MAX_WORLD_SPEC_JSON_DEPTH} levels.`,
      };
    }

    const currentType = typeof current.value;
    if (
      current.value === null
      || currentType === 'string'
      || currentType === 'boolean'
    ) {
      continue;
    }
    if (currentType === 'number') {
      if (
        !Number.isFinite(current.value)
        || (Number.isInteger(current.value) && !Number.isSafeInteger(current.value))
      ) {
        return {
          code: 'spec.non-json-value',
          severity: 'error',
          message: 'World Spec numbers must be finite and integers must stay within the safe range.',
        };
      }
      continue;
    }
    if (currentType !== 'object') {
      return {
        code: 'spec.non-json-value',
        severity: 'error',
        message: 'World Spec values must be representable as JSON.',
      };
    }

    const objectValue = current.value as object;
    if (ancestors.has(objectValue)) {
      return {
        code: 'spec.circular-json',
        severity: 'error',
        message: 'World Spec values must not contain circular references.',
      };
    }

    const isArray = Array.isArray(objectValue);
    const prototype = Object.getPrototypeOf(objectValue);
    if (!isArray && prototype !== Object.prototype && prototype !== null) {
      return {
        code: 'spec.non-json-value',
        severity: 'error',
        message: 'World Spec objects must be plain JSON objects rather than class, Date, Map, or Set instances.',
      };
    }

    ancestors.add(objectValue);
    pending.push({ value: objectValue, depth: current.depth, exit: true });

    if (Object.getOwnPropertySymbols(objectValue).length > 0) {
      return {
        code: 'spec.non-json-value',
        severity: 'error',
        message: 'World Spec objects must not contain symbol-keyed properties.',
      };
    }

    if (isArray) {
      const arrayValue = objectValue as unknown[];
      const extraArrayKeys = Object.getOwnPropertyNames(arrayValue).filter((key) => {
        if (key === 'length') return false;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index < 0 || index >= arrayValue.length || `${index}` !== key;
      });
      if (extraArrayKeys.length > 0) {
        return {
          code: 'spec.non-json-value',
          severity: 'error',
          message: 'World Spec arrays must contain indexed JSON values only.',
        };
      }
      for (let index = arrayValue.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(arrayValue, index);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          return {
            code: 'spec.non-json-value',
            severity: 'error',
            message: 'World Spec arrays must contain enumerable data entries without holes or accessors.',
          };
        }
        pending.push({ value: descriptor.value, depth: current.depth + 1 });
      }
      continue;
    }

    const descriptors = Object.getOwnPropertyDescriptors(objectValue);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (FORBIDDEN_WORLD_SPEC_OBJECT_KEYS.has(key)) {
        return {
          code: 'spec.unsafe-json-key',
          severity: 'error',
          message: `World Spec contains a forbidden object key: ${key}.`,
        };
      }
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return {
          code: 'spec.non-json-value',
          severity: 'error',
          message: 'World Spec objects must contain data properties only.',
        };
      }
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }

  const encodedBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (encodedBytes > MAX_WORLD_SPEC_FILE_BYTES) {
    return {
      code: 'spec.too-large',
      severity: 'error',
      message: `World Spec JSON must be no larger than ${MAX_WORLD_SPEC_FILE_BYTES / 1024} KiB.`,
    };
  }

  return null;
}

export function validateWorldSpec(spec: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const candidate: unknown = spec;

  if (!isRecord(candidate)) {
    return [{ code: 'spec.invalid-root', severity: 'error', message: 'World spec must be an object.' }];
  }

  try {
    const jsonContractIssue = inspectWorldSpecJsonContract(candidate);
    if (jsonContractIssue) return [jsonContractIssue];
  } catch {
    return [{
      code: 'spec.non-json-value',
      severity: 'error',
      message: 'World Spec could not be inspected as a plain JSON value.',
    }];
  }

  const legacySchema = candidate.schemaVersion === LEGACY_WORLD_SCHEMA_VERSION;
  const placesSchema = candidate.schemaVersion === PLACES_WORLD_SCHEMA_VERSION;
  const currentSchema = candidate.schemaVersion === ALPHA6_WORLD_SCHEMA_VERSION;

  addUnknownKeyIssue(
    issues,
    candidate,
    legacySchema
      ? ['schemaVersion', 'id', 'title', 'description', 'seed', 'visual', 'map', 'output', 'extensions']
      : placesSchema
        ? ['schemaVersion', 'id', 'title', 'description', 'seed', 'visual', 'map', 'output', 'places', 'extensions']
        : ['schemaVersion', 'id', 'title', 'description', 'seed', 'visual', 'map', 'output', 'places', 'structures', 'extensions'],
    'root',
  );

  if (!legacySchema && !placesSchema && !currentSchema) {
    issues.push({
      code: 'spec.schema-version',
      severity: 'error',
      message: `Schema version must be ${LEGACY_WORLD_SCHEMA_VERSION}, ${PLACES_WORLD_SCHEMA_VERSION}, or ${ALPHA6_WORLD_SCHEMA_VERSION}.`,
    });
  }

  if (typeof candidate.id !== 'string' || candidate.id.length > 80 || !WORLD_ID.test(candidate.id)) {
    issues.push({
      code: 'spec.invalid-id',
      severity: 'error',
      message: 'World ID must use lowercase letters, numbers, and single hyphens.',
      suggestion: 'Example: sunny-meadow',
    });
  }

  if (
    !isBoundedString(candidate.title, 1, 120)
    || !candidate.title.trim()
    || hasControlCharacters(candidate.title)
  ) {
    issues.push({
      code: 'spec.title',
      severity: 'error',
      message: 'World title is required, must contain no control characters, and must be no more than 120 characters.',
    });
  }

  if (!isBoundedString(candidate.description, 0, 1000)) {
    issues.push({
      code: 'spec.description',
      severity: 'error',
      message: 'World description must be a string no longer than 1,000 characters.',
    });
  } else if (candidate.description.trim().length < 12) {
    issues.push({
      code: 'spec.short-description',
      severity: 'warning',
      message: 'A more specific world description will help future AI providers stay coherent.',
    });
  }

  if (
    !isBoundedString(candidate.seed, 1, 160)
    || !candidate.seed.trim()
    || hasControlCharacters(candidate.seed)
  ) {
    issues.push({
      code: 'spec.seed',
      severity: 'error',
      message: 'A seed from 1 to 160 characters is required for reproducible generation.',
    });
  }

  const visual = candidate.visual;
  if (!isRecord(visual)) {
    issues.push({ code: 'spec.visual', severity: 'error', message: 'Visual settings must be an object.' });
  } else {
    addUnknownKeyIssue(issues, visual, ['style', 'tileSize', 'palette'], 'visual');
    if (visual.style !== 'pixel-art') {
      issues.push({ code: 'spec.style', severity: 'error', message: 'Visual style must be pixel-art in v0.1.' });
    }

    if (typeof visual.tileSize !== 'number' || !TILE_SIZES.has(visual.tileSize)) {
      issues.push({ code: 'spec.tile-size', severity: 'error', message: 'Tile size must be 16, 32, or 64 pixels.' });
    }

    if (
      !Array.isArray(visual.palette)
      || visual.palette.length !== 5
      || visual.palette.some((color) => typeof color !== 'string' || !HEX_COLOR.test(color))
    ) {
      issues.push({
        code: 'spec.palette',
        severity: 'error',
        message: 'Palette must contain exactly five six-digit hex colors.',
      });
    }
  }

  const map = candidate.map;
  if (!isRecord(map)) {
    issues.push({ code: 'spec.map', severity: 'error', message: 'Map settings must be an object.' });
  } else {
    addUnknownKeyIssue(issues, map, ['width', 'height', 'biome'], 'map');
    const validWidth = typeof map.width === 'number'
      && Number.isFinite(map.width)
      && Number.isInteger(map.width)
      && map.width >= 8
      && map.width <= 48;
    const validHeight = typeof map.height === 'number'
      && Number.isFinite(map.height)
      && Number.isInteger(map.height)
      && map.height >= 8
      && map.height <= 32;

    if (!validWidth || !validHeight) {
      issues.push({
        code: 'spec.map-size',
        severity: 'error',
        message: 'The v0.1 preview requires integer map dimensions from 8x8 to 48x32 cells.',
      });
    }

    if (typeof map.biome !== 'string' || !BIOMES.has(map.biome)) {
      issues.push({
        code: 'spec.biome',
        severity: 'error',
        message: 'Biome must be meadow, desert, or snow.',
      });
    }
  }

  const output = candidate.output;
  if (!isRecord(output)) {
    issues.push({ code: 'spec.output', severity: 'error', message: 'Output settings must be an object.' });
  } else {
    addUnknownKeyIssue(issues, output, ['targets', 'assetLicense'], 'output');
    const targets = output.targets;
    if (
      !Array.isArray(targets)
      || targets.length !== 3
      || targets[0] !== 'common'
      || targets[1] !== 'godot'
      || targets[2] !== 'itch'
    ) {
      issues.push({
        code: 'spec.output-targets',
        severity: 'error',
        message: 'Output targets must be the ordered common, godot, and itch tuple.',
      });
    }

    if (output.assetLicense !== 'CC0-1.0') {
      issues.push({
        code: 'spec.asset-license',
        severity: 'error',
        message: 'Generated v0.1 assets must use the CC0-1.0 license.',
      });
    }
  }

  if ((placesSchema || currentSchema) && candidate.places !== undefined) {
    if (!Array.isArray(candidate.places) || candidate.places.length < 1 || candidate.places.length > 8) {
      issues.push({
        code: 'spec.places',
        severity: 'error',
        message: 'Places, when declared, must contain from 1 through 8 semantic locations.',
      });
    } else {
      const placeIds = new Set<string>();
      let duplicatePlaceId = false;

      for (const place of candidate.places) {
        if (!isRecord(place)) {
          issues.push({
            code: 'spec.place',
            severity: 'error',
            message: 'Every place must be an object.',
          });
          continue;
        }

        addUnknownKeyIssue(issues, place, ['id', 'label', 'kind', 'placement', 'tags'], 'place');

        if (
          !isBoundedString(place.id, 1, 64)
          || !PLACE_ID.test(place.id)
        ) {
          issues.push({
            code: 'spec.place-id',
            severity: 'error',
            message: 'Place IDs must be 1 to 64 characters using lowercase letters, numbers, and single hyphens.',
          });
        } else if (placeIds.has(place.id)) {
          duplicatePlaceId = true;
        } else {
          placeIds.add(place.id);
        }

        if (
          !isBoundedString(place.label, 1, 80)
          || !place.label.trim()
          || place.label !== place.label.trim()
          || hasControlCharacters(place.label)
        ) {
          issues.push({
            code: 'spec.place-label',
            severity: 'error',
            message: 'Place labels must be 1 to 80 trimmed characters without control characters.',
          });
        }

        if (typeof place.kind !== 'string' || !PLACE_KIND_SET.has(place.kind)) {
          issues.push({
            code: 'spec.place-kind',
            severity: 'error',
            message: `Place kind must be one of: ${PLACE_KINDS.join(', ')}.`,
          });
        }

        if (typeof place.placement !== 'string' || !PLACE_PLACEMENT_SET.has(place.placement)) {
          issues.push({
            code: 'spec.place-placement',
            severity: 'error',
            message: `Place placement must be one of: ${PLACE_PLACEMENTS.join(', ')}.`,
          });
        }

        if (!Array.isArray(place.tags) || place.tags.length > 8) {
          issues.push({
            code: 'spec.place-tags',
            severity: 'error',
            message: 'Place tags must be an array containing at most 8 tags.',
          });
        } else {
          const tags = new Set<string>();
          const invalidTag = place.tags.some((tag) => {
            if (!isBoundedString(tag, 1, 32) || !PLACE_TAG.test(tag) || tags.has(tag)) return true;
            tags.add(tag);
            return false;
          });
          if (invalidTag) {
            issues.push({
              code: 'spec.place-tags',
              severity: 'error',
              message: 'Place tags must be unique 1 to 32 character lowercase letter, number, or hyphen slugs.',
            });
          }
        }
      }

      if (duplicatePlaceId) {
        issues.push({
          code: 'spec.duplicate-place-id',
          severity: 'error',
          message: 'Place IDs must be unique within a world spec.',
        });
      }
    }
  }

  if (currentSchema && candidate.structures !== undefined) {
    if (!Array.isArray(candidate.structures) || candidate.structures.length < 1 || candidate.structures.length > 8) {
      issues.push({
        code: 'spec.structures',
        severity: 'error',
        message: 'Structures, when declared, must contain from 1 through 8 semantic structures.',
      });
    } else {
      const placeIds = new Set<string>();
      if (Array.isArray(candidate.places)) {
        for (const place of candidate.places) {
          if (isRecord(place) && typeof place.id === 'string') placeIds.add(place.id);
        }
      }
      const structureIds = new Set<string>();
      const occupiedPlaceIds = new Set<string>();

      for (const structure of candidate.structures) {
        if (!isRecord(structure)) {
          issues.push({ code: 'spec.structure', severity: 'error', message: 'Every structure must be an object.' });
          continue;
        }

        addUnknownKeyIssue(issues, structure, ['id', 'placeId', 'archetype'], 'structure');

        if (!isBoundedString(structure.id, 1, 64) || !STRUCTURE_ID.test(structure.id)) {
          issues.push({
            code: 'spec.structure-id',
            severity: 'error',
            message: 'Structure IDs must be 1 to 64 characters using lowercase letters, numbers, and single hyphens.',
          });
        } else if (structureIds.has(structure.id)) {
          issues.push({
            code: 'spec.duplicate-structure-id',
            severity: 'error',
            message: 'Structure IDs must be unique within a world spec.',
          });
        } else {
          structureIds.add(structure.id);
        }

        if (!isBoundedString(structure.placeId, 1, 64) || !STRUCTURE_ID.test(structure.placeId)) {
          issues.push({
            code: 'spec.structure-place-id',
            severity: 'error',
            message: 'Structure placeId must be a path-safe place identifier.',
          });
        } else {
          if (!placeIds.has(structure.placeId)) {
            issues.push({
              code: 'spec.structure-place-reference',
              severity: 'error',
              message: `Structure placeId must reference a declared place: ${structure.placeId}.`,
            });
          }
          if (occupiedPlaceIds.has(structure.placeId)) {
            issues.push({
              code: 'spec.duplicate-structure-place',
              severity: 'error',
              message: `At most one structure may reference place: ${structure.placeId}.`,
            });
          } else {
            occupiedPlaceIds.add(structure.placeId);
          }
        }

        if (typeof structure.archetype !== 'string' || !STRUCTURE_ARCHETYPE_SET.has(structure.archetype)) {
          issues.push({
            code: 'spec.structure-archetype',
            severity: 'error',
            message: `Structure archetype must be one of: ${STRUCTURE_ARCHETYPES.join(', ')}.`,
          });
        }
      }
    }
  }

  if (candidate.extensions !== undefined) {
    if (!isRecord(candidate.extensions)) {
      issues.push({
        code: 'spec.extensions',
        severity: 'error',
        message: 'Extensions must be an object keyed by a reverse-DNS namespace.',
      });
    } else if (Object.keys(candidate.extensions).some((key) => !EXTENSION_NAMESPACE.test(key))) {
      issues.push({
        code: 'spec.extension-namespace',
        severity: 'error',
        message: 'Every extension key must use a reverse-DNS namespace such as org.mapsoo.externalhost.',
      });
    }
  }

  return issues;
}

export function validateGeneratedWorld(world: GeneratedWorld): ValidationIssue[] {
  const candidate: unknown = world;
  if (!isRecord(candidate)) {
    return [{ code: 'world.invalid-root', severity: 'error', message: 'Generated world must be an object.' }];
  }

  const spec = candidate.spec as WorldSpec;
  const issues = validateWorldSpec(spec);
  const generator = candidate.generator;
  if (
    !isRecord(generator)
    || !isValidGeneratorId(generator.id)
    || !isValidGeneratorVersion(generator.version)
  ) {
    issues.push({
      code: 'world.generator',
      severity: 'error',
      message: 'Generated world must identify a path-safe provider ID and semantic provider version.',
    });
  }
  if (!isRecord(spec) || !isRecord(spec.map)) return issues;

  const width = spec.map.width;
  const height = spec.map.height;
  const dimensionsAreValid = Number.isFinite(width) && Number.isInteger(width)
    && Number.isFinite(height) && Number.isInteger(height);
  const ground = Array.isArray(candidate.ground) ? candidate.ground : null;
  const tiles = Array.isArray(candidate.tiles) ? candidate.tiles : null;
  const props = Array.isArray(candidate.props) ? candidate.props : null;

  if (!ground) {
    issues.push({ code: 'world.ground', severity: 'error', message: 'Ground layer must be an array.' });
  } else if (dimensionsAreValid) {
    const expectedCells = width * height;
    if (ground.length !== expectedCells) {
      issues.push({
        code: 'world.cell-count',
        severity: 'error',
        message: `Ground layer has ${ground.length} cells; expected ${expectedCells}.`,
      });
    }
  }

  const tileIds = new Set<number>();
  if (!tiles) {
    issues.push({ code: 'world.tiles', severity: 'error', message: 'Tile definitions must be an array.' });
  } else {
    const tileNames = new Set<string>();
    let invalidTileDefinition = tiles.length < 1 || tiles.length > TILE_NAMES.size;
    let duplicateTileDefinition = false;

    for (const tile of tiles.slice(0, TILE_NAMES.size)) {
      if (
        !isRecord(tile)
        || !Number.isSafeInteger(tile.id)
        || (tile.id as number) < 0
        || typeof tile.name !== 'string'
        || !TILE_NAMES.has(tile.name)
        || typeof tile.color !== 'string'
        || !HEX_COLOR.test(tile.color)
        || typeof tile.accent !== 'string'
        || !HEX_COLOR.test(tile.accent)
        || typeof tile.walkable !== 'boolean'
      ) {
        invalidTileDefinition = true;
        continue;
      }
      if (tileIds.has(tile.id as number) || tileNames.has(tile.name)) duplicateTileDefinition = true;
      tileIds.add(tile.id as number);
      tileNames.add(tile.name);
    }

    if (invalidTileDefinition) {
      issues.push({
        code: 'world.tile-definition',
        severity: 'error',
        message: 'Every tile needs a unique non-negative integer ID, supported name, two colors, and walkable flag.',
      });
    }
    if (duplicateTileDefinition) {
      issues.push({
        code: 'world.duplicate-tile',
        severity: 'error',
        message: 'Tile IDs and tile names must be unique.',
      });
    }
  }

  if (ground && tiles && dimensionsAreValid) {
    const expectedCells = width * height;
    let invalidGroundValue = false;
    for (let index = 0; index < Math.min(ground.length, expectedCells); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(ground, index);
      if (
        !descriptor
        || !descriptor.enumerable
        || !('value' in descriptor)
        || !Number.isSafeInteger(descriptor.value)
        || !tileIds.has(descriptor.value as number)
      ) {
        invalidGroundValue = true;
        break;
      }
    }
    if (invalidGroundValue) {
      issues.push({ code: 'world.unknown-tile', severity: 'error', message: 'The map references an unknown tile ID.' });
    }
  }

  if (!props) {
    issues.push({ code: 'world.props', severity: 'error', message: 'Props must be an array.' });
  } else if (dimensionsAreValid) {
    const propIds = new Set<string>();
    const occupiedCells = new Set<string>();
    let invalidProp = props.length > width * height;
    let invalidPropBounds = false;
    let duplicateProp = false;

    for (const prop of props.slice(0, width * height)) {
      if (
        !isRecord(prop)
        || typeof prop.id !== 'string'
        || prop.id.length > 120
        || !GENERATED_ITEM_ID.test(prop.id)
        || typeof prop.kind !== 'string'
        || !PROP_KINDS.has(prop.kind)
      ) {
        invalidProp = true;
        continue;
      }

      if (
        !Number.isSafeInteger(prop.x)
        || !Number.isSafeInteger(prop.y)
        || (prop.x as number) < 0
        || (prop.y as number) < 0
        || (prop.x as number) >= width
        || (prop.y as number) >= height
      ) {
        invalidPropBounds = true;
        continue;
      }

      const cell = `${prop.x},${prop.y}`;
      if (propIds.has(prop.id) || occupiedCells.has(cell)) duplicateProp = true;
      propIds.add(prop.id);
      occupiedCells.add(cell);
    }

    if (invalidProp) {
      issues.push({
        code: 'world.prop-definition',
        severity: 'error',
        message: 'Every prop needs a path-safe ID and a supported prop kind.',
      });
    }
    if (invalidPropBounds) {
      issues.push({ code: 'world.prop-bounds', severity: 'error', message: 'One or more props have invalid map coordinates.' });
    }
    if (duplicateProp) {
      issues.push({
        code: 'world.duplicate-prop',
        severity: 'error',
        message: 'Prop IDs and occupied map cells must be unique.',
      });
    }
  }

  if (!issues.some((issue) => issue.severity === 'error') && ground && props) {
    issues.push({
      code: 'world.ready',
      severity: 'info',
      message: `${ground.length} cells and ${props.length} props are ready for pack assembly.`,
    });
  }

  return issues;
}
