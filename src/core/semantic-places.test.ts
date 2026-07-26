import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORLD_SPEC,
  LEGACY_WORLD_SCHEMA_VERSION,
  WORLD_SCHEMA_VERSION,
  cloneWorldSpec,
  migrateWorldSpecV010,
  type GeneratedWorld,
  type WorldPlace,
  type WorldSpecV010,
} from './world-spec';
import { validateWorldSpec } from './validate-world';
import { PlaceResolutionError, resolveSemanticPlaces } from './semantic-places';
import { generateWorld } from './generate-world';

function place(
  id: string,
  placement: WorldPlace['placement'],
  kind: WorldPlace['kind'] = 'landmark',
): WorldPlace {
  return { id, label: `${id} label`, kind, placement, tags: ['test'] };
}

function fixtureWorld(places: WorldPlace[] | undefined): GeneratedWorld {
  const spec = cloneWorldSpec(DEFAULT_WORLD_SPEC);
  spec.map = { ...spec.map, width: 5, height: 5 };
  if (places) spec.places = places.map((entry) => ({ ...entry, tags: [...entry.tags] }));
  else delete spec.places;

  return {
    generator: { id: 'procedural-pixel-v1', version: '0.1.0' },
    spec,
    tiles: [
      { id: 0, name: 'ground', color: '#000000', accent: '#111111', walkable: true },
      { id: 1, name: 'water', color: '#222222', accent: '#333333', walkable: false },
      { id: 2, name: 'path', color: '#444444', accent: '#555555', walkable: true },
    ],
    ground: [
      0, 0, 0, 0, 0,
      0, 0, 1, 0, 0,
      2, 2, 2, 2, 2,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ],
    props: [],
  };
}

describe('World Spec 0.2 semantic places', () => {
  it('validates strict place counts, fields, identifiers, labels, kinds, placements, and tags', () => {
    const valid = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    expect(validateWorldSpec(valid).filter(({ severity }) => severity === 'error')).toEqual([]);

    const empty = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    empty.places = [];
    expect(validateWorldSpec(empty)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.places' })]),
    );

    const malformed = cloneWorldSpec(DEFAULT_WORLD_SPEC) as unknown as Record<string, unknown>;
    malformed.places = [
      {
        id: 'Bad ID',
        label: ' padded ',
        kind: 'castle',
        placement: 'random',
        tags: ['duplicate', 'duplicate'],
        coordinates: [1, 2],
      },
      { id: 'Bad ID', label: '', kind: 'castle', placement: 'random', tags: 'not-an-array' },
    ];
    const codes = validateWorldSpec(malformed).map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      'spec.unknown-place-field',
      'spec.place-id',
      'spec.place-label',
      'spec.place-kind',
      'spec.place-placement',
      'spec.place-tags',
    ]));

    const duplicate = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    duplicate.places = [place('same', 'center'), place('same', 'map-edge')];
    expect(validateWorldSpec(duplicate)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.duplicate-place-id' })]),
    );

    const tooMany = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    tooMany.places = Array.from({ length: 9 }, (_, index) => place(`place-${index}`, 'center'));
    expect(validateWorldSpec(tooMany)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'spec.places' })]),
    );
  });

  it('keeps the v0.1 type explicit and migrates it without inventing places or sharing nested data', () => {
    const { places: _places, ...currentWithoutPlaces } = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    const legacy: WorldSpecV010 = {
      ...currentWithoutPlaces,
      schemaVersion: LEGACY_WORLD_SCHEMA_VERSION,
      extensions: { 'org.mapsoo.externalhost': { values: ['kept'] } },
    };

    const migrated = migrateWorldSpecV010(legacy);
    expect(migrated.schemaVersion).toBe(WORLD_SCHEMA_VERSION);
    expect(migrated).not.toHaveProperty('places');
    expect(migrated.extensions).toEqual(legacy.extensions);
    expect(migrated.extensions).not.toBe(legacy.extensions);
    expect(migrated.visual.palette).not.toBe(legacy.visual.palette);
    expect(migrated.output.targets).not.toBe(legacy.output.targets);
  });
});

describe('semantic place resolution', () => {
  it('resolves every semantic place in the real default generated world', () => {
    const world = generateWorld(DEFAULT_WORLD_SPEC);
    const resolved = resolveSemanticPlaces(world);

    expect(resolved.map(({ id }) => id)).toEqual(['spawn', 'landmark', 'exit']);
    expect(resolved.every(({ cell }) => world.tiles.find(
      ({ id }) => id === world.ground[cell.y * world.spec.map.width + cell.x],
    )?.walkable)).toBe(true);
  });

  it('resolves all placement modes in stable declaration order to unique walkable cells and pixel centers', () => {
    const world = fixtureWorld([
      place('spawn', 'center', 'spawn'),
      place('watermark', 'near-water'),
      place('crossroad', 'on-road'),
      place('exit', 'map-edge', 'exit'),
    ]);
    const before = structuredClone(world);

    const first = resolveSemanticPlaces(world);
    const second = resolveSemanticPlaces(world);

    expect(second).toEqual(first);
    expect(first.map(({ id, order, cell, pixelCenter }) => ({ id, order, cell, pixelCenter }))).toEqual([
      { id: 'spawn', order: 0, cell: { x: 2, y: 2 }, pixelCenter: { x: 80, y: 80 } },
      { id: 'watermark', order: 1, cell: { x: 1, y: 1 }, pixelCenter: { x: 48, y: 48 } },
      { id: 'crossroad', order: 2, cell: { x: 1, y: 2 }, pixelCenter: { x: 48, y: 80 } },
      { id: 'exit', order: 3, cell: { x: 2, y: 0 }, pixelCenter: { x: 80, y: 16 } },
    ]);
    expect(new Set(first.map(({ cell }) => `${cell.x},${cell.y}`)).size).toBe(first.length);
    expect(world).toEqual(before);
    expect(first[0].tags).not.toBe(world.spec.places?.[0].tags);
  });

  it('returns an empty list when places are omitted', () => {
    expect(resolveSemanticPlaces(fixtureWorld(undefined))).toEqual([]);
  });

  it('fails with a stable typed error when a placement cannot be satisfied', () => {
    const world = fixtureWorld([place('first-road', 'on-road'), place('second-road', 'on-road')]);
    world.ground = world.ground.map((tileId, index) => index === 12 ? 2 : tileId === 2 ? 0 : tileId);

    expect(() => resolveSemanticPlaces(world)).toThrowError(
      new PlaceResolutionError('second-road', 'on-road'),
    );
    try {
      resolveSemanticPlaces(world);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'place.unsatisfied-placement',
        placeId: 'second-road',
        placement: 'on-road',
      });
    }
  });
});
