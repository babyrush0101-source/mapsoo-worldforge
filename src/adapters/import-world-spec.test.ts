import { describe, expect, it, vi } from 'vitest';
import { ALPHA6_DEFAULT_WORLD_SPEC, DEFAULT_WORLD_SPEC } from '../core/world-spec';
import {
  MAX_WORLD_SPEC_FILE_BYTES,
  parseWorldSpecJson,
  readWorldSpecFile,
} from './import-world-spec';

describe('World Spec JSON import', () => {
  function asFile(name: string, bytes: Uint8Array) {
    return {
      name,
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  function nestedArrays(count: number): unknown {
    let value: unknown = 0;
    for (let index = 0; index < count; index += 1) value = [value];
    return value;
  }

  function countJsonNodes(root: unknown): number {
    const pending = [root];
    let count = 0;
    while (pending.length > 0) {
      const value = pending.pop();
      count += 1;
      if (Array.isArray(value)) {
        pending.push(...value);
      } else if (typeof value === 'object' && value !== null) {
        pending.push(...Object.values(value));
      }
    }
    return count;
  }

  it('loads a valid spec, accepts a UTF-8 BOM, and returns an independent clone', () => {
    const result = parseWorldSpecJson(`\uFEFF${JSON.stringify(DEFAULT_WORLD_SPEC)}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.spec).toEqual(DEFAULT_WORLD_SPEC);
    expect(result.spec).not.toBe(DEFAULT_WORLD_SPEC);
    expect(result.spec.visual.palette).not.toBe(DEFAULT_WORLD_SPEC.visual.palette);
    result.spec.visual.palette[0] = '#000000';
    expect(DEFAULT_WORLD_SPEC.visual.palette[0]).not.toBe('#000000');
  });

  it('loads the opt-in World Spec 0.3 structure preview without changing the Alpha.5 default', () => {
    const result = parseWorldSpecJson(JSON.stringify(ALPHA6_DEFAULT_WORLD_SPEC));

    expect(result).toMatchObject({
      ok: true,
      spec: {
        schemaVersion: '0.3.0',
        structures: ALPHA6_DEFAULT_WORLD_SPEC.structures,
      },
    });
    expect(DEFAULT_WORLD_SPEC.schemaVersion).toBe('0.2.0');
  });

  it('preserves legal JSON punctuation, escaped quotes, and backslashes inside strings', () => {
    const spec = {
      ...DEFAULT_WORLD_SPEC,
      title: 'Quoted "world" at C:\\maps',
      description: 'Legal punctuation stays data: { [ , : ] } and "quoted text".',
    };
    const result = parseWorldSpecJson(JSON.stringify(spec));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec).toEqual(spec);
  });

  it('returns stable errors for empty, malformed, and oversized JSON', () => {
    expect(parseWorldSpecJson('  ')).toMatchObject({ ok: false, code: 'import.empty' });
    expect(parseWorldSpecJson('{')).toMatchObject({ ok: false, code: 'import.invalid-json' });
    expect(parseWorldSpecJson(`"${'x'.repeat(MAX_WORLD_SPEC_FILE_BYTES)}"`)).toMatchObject({
      ok: false,
      code: 'import.too-large',
    });
  });

  it('surfaces schema validation codes and keeps warnings non-blocking', () => {
    const invalid = { ...DEFAULT_WORLD_SPEC, unexpected: true };
    const invalidResult = parseWorldSpecJson(JSON.stringify(invalid));
    expect(invalidResult).toMatchObject({ ok: false, code: 'import.invalid-spec' });
    expect(invalidResult.issues.map((issue) => issue.code)).toContain('spec.unknown-root-field');

    const warning = { ...DEFAULT_WORLD_SPEC, description: 'short' };
    const warningResult = parseWorldSpecJson(JSON.stringify(warning));
    expect(warningResult.ok).toBe(true);
    expect(warningResult.issues.map((issue) => issue.code)).toContain('spec.short-description');
  });

  it('rejects prototype keys and deeply nested extension data', () => {
    for (const forbiddenKey of ['__proto__', 'constructor', 'prototype']) {
      const unsafeJson = JSON.stringify(DEFAULT_WORLD_SPEC).replace(
        /}$/, `,"extensions":{"org.mapsoo.externalhost":{"${forbiddenKey}":{"polluted":true}}}}`,
      );
      expect(parseWorldSpecJson(unsafeJson)).toMatchObject({ ok: false, code: 'import.unsafe-key' });
    }

    let nested: unknown = 'leaf';
    for (let index = 0; index < 34; index += 1) nested = { child: nested };
    const tooDeep = { ...DEFAULT_WORLD_SPEC, extensions: { 'org.mapsoo.externalhost': nested } };
    expect(parseWorldSpecJson(JSON.stringify(tooDeep))).toMatchObject({ ok: false, code: 'import.too-deep' });

    const tooComplex = {
      ...DEFAULT_WORLD_SPEC,
      extensions: { 'org.mapsoo.externalhost': Array.from({ length: 10_001 }, () => 0) },
    };
    expect(parseWorldSpecJson(JSON.stringify(tooComplex))).toMatchObject({ ok: false, code: 'import.too-complex' });
  });

  it('rejects duplicate keys and numbers that cannot round-trip safely', () => {
    const duplicate = JSON.stringify(DEFAULT_WORLD_SPEC).replace(
      /^{/,
      '{"schemaVersion":"0.1.0",',
    );
    expect(parseWorldSpecJson(duplicate)).toMatchObject({ ok: false, code: 'import.duplicate-key' });

    const escapedDuplicate = JSON.stringify(DEFAULT_WORLD_SPEC).replace(
      '"seed":"mapsoo-demo-001"',
      '"seed":"mapsoo-demo-001","\\u0073eed":"shadowed"',
    );
    expect(parseWorldSpecJson(escapedDuplicate)).toMatchObject({ ok: false, code: 'import.duplicate-key' });

    const nonFinite = JSON.stringify(DEFAULT_WORLD_SPEC).replace(
      /}$/,
      ',"extensions":{"org.mapsoo.externalhost":{"value":1e400}}}',
    );
    expect(parseWorldSpecJson(nonFinite)).toMatchObject({ ok: false, code: 'import.non-finite-number' });

    const unsafeInteger = JSON.stringify(DEFAULT_WORLD_SPEC).replace(
      /}$/,
      ',"extensions":{"org.mapsoo.externalhost":{"value":9007199254740993}}}',
    );
    expect(parseWorldSpecJson(unsafeInteger)).toMatchObject({ ok: false, code: 'import.unsafe-integer' });
  });

  it('migrates a strict v0.1 World Spec without inventing semantic places', () => {
    const { places: _places, ...legacy } = structuredClone(DEFAULT_WORLD_SPEC);
    const result = parseWorldSpecJson(JSON.stringify({ ...legacy, schemaVersion: '0.1.0' }));

    expect(result).toMatchObject({
      ok: true,
      spec: { schemaVersion: '0.2.0' },
      issues: [expect.objectContaining({ code: 'spec.schema-migrated', severity: 'warning' })],
    });
    if (result.ok) expect(result.spec).not.toHaveProperty('places');
  });

  it('rejects v0.2-only places hidden in a v0.1 document', () => {
    const legacyWithPlaces = { ...structuredClone(DEFAULT_WORLD_SPEC), schemaVersion: '0.1.0' };
    expect(parseWorldSpecJson(JSON.stringify(legacyWithPlaces))).toMatchObject({
      ok: false,
      code: 'import.invalid-spec',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'spec.unknown-root-field' })]),
    });
  });

  it('enforces structural limits before a duplicate key can hide the unsafe value', () => {
    const deeplyNestedValue = `${'['.repeat(40)}0${']'.repeat(40)}`;
    const shadowedDeepJson = JSON.stringify(DEFAULT_WORLD_SPEC).replace(
      /}$/,
      `,"extensions":{"org.mapsoo.externalhost":{"payload":${deeplyNestedValue},"payload":null}}}`,
    );
    expect(parseWorldSpecJson(shadowedDeepJson)).toMatchObject({ ok: false, code: 'import.too-deep' });

    const complexValue = `[${Array.from({ length: 10_001 }, () => '0').join(',')}]`;
    const shadowedComplexJson = JSON.stringify(DEFAULT_WORLD_SPEC).replace(
      /}$/,
      `,"extensions":{"org.mapsoo.externalhost":{"payload":${complexValue},"payload":null}}}`,
    );
    expect(parseWorldSpecJson(shadowedComplexJson)).toMatchObject({ ok: false, code: 'import.too-complex' });
  });

  it('accepts the exact depth and node limits and rejects one value beyond them', () => {
    const exactDepth = {
      ...DEFAULT_WORLD_SPEC,
      extensions: { 'org.mapsoo.externalhost': nestedArrays(30) },
    };
    const excessiveDepth = {
      ...DEFAULT_WORLD_SPEC,
      extensions: { 'org.mapsoo.externalhost': nestedArrays(31) },
    };
    expect(parseWorldSpecJson(JSON.stringify(exactDepth))).toMatchObject({ ok: true });
    expect(parseWorldSpecJson(JSON.stringify(excessiveDepth))).toMatchObject({ ok: false, code: 'import.too-deep' });

    const nodeShell = { ...DEFAULT_WORLD_SPEC, extensions: { 'org.mapsoo.externalhost': [] as number[] } };
    const remainingNodes = 10_000 - countJsonNodes(nodeShell);
    const exactNodes = {
      ...DEFAULT_WORLD_SPEC,
      extensions: { 'org.mapsoo.externalhost': Array.from({ length: remainingNodes }, () => 0) },
    };
    const excessiveNodes = {
      ...DEFAULT_WORLD_SPEC,
      extensions: { 'org.mapsoo.externalhost': Array.from({ length: remainingNodes + 1 }, () => 0) },
    };
    expect(countJsonNodes(exactNodes)).toBe(10_000);
    expect(parseWorldSpecJson(JSON.stringify(exactNodes))).toMatchObject({ ok: true });
    expect(parseWorldSpecJson(JSON.stringify(excessiveNodes))).toMatchObject({
      ok: false,
      code: 'import.too-complex',
    });
  });

  it('uses fatal UTF-8 decoding and accepts valid UTF-8 bytes', async () => {
    const validBytes = new TextEncoder().encode(JSON.stringify(DEFAULT_WORLD_SPEC));
    await expect(readWorldSpecFile(asFile('valid.world.json', validBytes))).resolves.toMatchObject({ ok: true });

    const bomBytes = new TextEncoder().encode(`\uFEFF${JSON.stringify(DEFAULT_WORLD_SPEC)}`);
    await expect(readWorldSpecFile(asFile('bom.world.json', bomBytes))).resolves.toMatchObject({ ok: true });

    const invalidBytes = Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
    await expect(readWorldSpecFile(asFile('invalid-utf8.world.json', invalidBytes))).resolves.toMatchObject({
      ok: false,
      code: 'import.invalid-utf8',
    });
  });

  it('checks declared file size before reading and reports read failures without throwing', async () => {
    const oversizedRead = vi.fn(async () => new ArrayBuffer(0));
    const oversized = await readWorldSpecFile({
      name: 'large.world.json',
      size: MAX_WORLD_SPEC_FILE_BYTES + 1,
      arrayBuffer: oversizedRead,
    });
    expect(oversized).toMatchObject({ ok: false, code: 'import.too-large' });
    expect(oversizedRead).not.toHaveBeenCalled();

    const jsonBytes = new TextEncoder().encode(JSON.stringify(DEFAULT_WORLD_SPEC));
    const exactLimitBytes = new Uint8Array(MAX_WORLD_SPEC_FILE_BYTES);
    exactLimitBytes.set(jsonBytes);
    exactLimitBytes.fill(0x20, jsonBytes.byteLength);
    await expect(readWorldSpecFile(asFile('exact-limit.world.json', exactLimitBytes))).resolves.toMatchObject({
      ok: true,
    });

    const understated = await readWorldSpecFile({
      name: 'understated.world.json',
      size: 1,
      arrayBuffer: async () => new ArrayBuffer(MAX_WORLD_SPEC_FILE_BYTES + 1),
    });
    expect(understated).toMatchObject({ ok: false, code: 'import.too-large' });

    const unreadable = await readWorldSpecFile({
      name: 'broken.world.json',
      size: 42,
      arrayBuffer: async () => {
        throw new Error('disk error');
      },
    });
    expect(unreadable).toMatchObject({ ok: false, code: 'import.read-failed' });
  });
});
