import { describe, expect, it, vi } from 'vitest';
import { generateWorld } from './generate-world';
import {
  GenerationProviderError,
  isTrustedGenerationRun,
  runGenerationProvider,
  runGenerationProviderWithEvidence,
  type GenerationOptions,
  type GeneratorCapabilities,
  type GeneratorProvider,
} from './generation-provider';
import {
  type ProviderGenerationClaims,
  type ProviderGenerationOutput,
} from './generation-evidence';
import { cloneWorldSpec, DEFAULT_WORLD_SPEC, type GeneratedWorld, type WorldSpec } from './world-spec';
import { PROCEDURAL_PIXEL_PROVIDER } from '../providers/procedural-pixel-provider';
import { PROCEDURAL_TERRAIN_PROVIDER } from '../providers/procedural-terrain-provider';
import {
  isValidGeneratorVersion,
  PROCEDURAL_PIXEL_GENERATOR_ID,
  PROCEDURAL_PIXEL_GENERATOR_VERSION,
} from './generator-identity';
import {
  DEFAULT_GENERATION_PROVIDER,
  GENERATION_PROVIDER_REGISTRY,
  GeneratorProviderRegistry,
} from '../providers/provider-registry';

function capabilities(overrides: Partial<GeneratorCapabilities> = {}): GeneratorCapabilities {
  return {
    execution: 'local',
    determinism: 'seeded',
    requiresCredentials: false,
    outputProvenance: 'procedural',
    supportedStyles: ['pixel-art'],
    supportedBiomes: ['meadow', 'desert', 'snow'],
    supportedTileSizes: [16, 32, 64],
    maxMapSize: { width: 48, height: 32 },
    supportsAbort: true,
    supportsPartialRegeneration: false,
    ...overrides,
  };
}

function identify(world: GeneratedWorld, provider: GeneratorProvider): GeneratedWorld {
  return { ...world, generator: { id: provider.id, version: provider.version } };
}

function claims(overrides: Partial<ProviderGenerationClaims> = {}): ProviderGenerationClaims {
  return {
    model: null,
    workflow: {
      id: 'test-workflow',
      version: '1.0.0',
      definition_sha256: null,
    },
    transformations: [{ id: 'test-transform', version: '1.0.0' }],
    disclosureStatement: null,
    providerTerms: null,
    sources: [],
    ...overrides,
  };
}

type WorldGenerator = (spec: WorldSpec, options?: GenerationOptions) => Promise<GeneratedWorld>;

function fakeProvider(
  generateWorld: WorldGenerator,
  overrides: Partial<GeneratorProvider> = {},
  generationClaims: ProviderGenerationClaims = claims(),
): GeneratorProvider {
  return {
    id: 'test-provider',
    version: '1.0.0',
    displayName: 'Test Provider',
    capabilities: capabilities(),
    async generate(spec, options) {
      return {
        world: await generateWorld(spec, options),
        claims: generationClaims,
      };
    },
    ...overrides,
  };
}

describe('generation provider contract', () => {
  it('registers both versioned local providers and advances the candidate default to v2', () => {
    expect(DEFAULT_GENERATION_PROVIDER).not.toBe(PROCEDURAL_TERRAIN_PROVIDER);
    expect(DEFAULT_GENERATION_PROVIDER).toMatchObject({
      id: PROCEDURAL_TERRAIN_PROVIDER.id,
      version: PROCEDURAL_TERRAIN_PROVIDER.version,
    });
    expect(Object.isFrozen(DEFAULT_GENERATION_PROVIDER)).toBe(true);
    const summaries = GENERATION_PROVIDER_REGISTRY.list();
    expect(summaries).toEqual([
      expect.objectContaining({
        id: 'procedural-pixel-v1',
        version: '0.1.0',
        capabilities: expect.objectContaining({
          execution: 'local',
          determinism: 'seeded',
          requiresCredentials: false,
          outputProvenance: 'procedural',
          supportsAbort: false,
          supportsPartialRegeneration: false,
        }),
      }),
      expect.objectContaining({
        id: PROCEDURAL_TERRAIN_PROVIDER.id,
        version: PROCEDURAL_TERRAIN_PROVIDER.version,
        capabilities: expect.objectContaining({
          execution: 'local',
          determinism: 'seeded',
          requiresCredentials: false,
          outputProvenance: 'procedural',
          supportsAbort: false,
          supportsPartialRegeneration: false,
        }),
      }),
    ]);
    expect(Object.isFrozen(summaries)).toBe(true);
    expect(Object.isFrozen(summaries[0].capabilities)).toBe(true);
    expect(Object.isFrozen(summaries[1].capabilities)).toBe(true);
  });

  it('runs the procedural provider without changing v0.1 output', async () => {
    const result = await runGenerationProvider(PROCEDURAL_PIXEL_PROVIDER, DEFAULT_WORLD_SPEC);

    expect(result).toEqual(generateWorld(DEFAULT_WORLD_SPEC));
    expect(result.spec).not.toBe(DEFAULT_WORLD_SPEC);
  });

  it('returns an atomic runner-owned result with deeply frozen invocation evidence', async () => {
    const completedAt = new Date('2026-07-18T18:30:00.000Z');
    const now = vi.fn(() => completedAt);
    const result = await runGenerationProviderWithEvidence(
      PROCEDURAL_PIXEL_PROVIDER,
      DEFAULT_WORLD_SPEC,
      { now },
    );

    expect(now).toHaveBeenCalledOnce();
    expect(isTrustedGenerationRun(result)).toBe(true);
    expect(result.evidence).toMatchObject({
      schemaVersion: '0.1.0',
      createdAt: completedAt.toISOString(),
      provider: {
        id: PROCEDURAL_PIXEL_GENERATOR_ID,
        version: PROCEDURAL_PIXEL_GENERATOR_VERSION,
        displayName: 'Mapsoo Procedural Pixel',
        capabilities: {
          execution: 'local',
          determinism: 'seeded',
          outputProvenance: 'procedural',
        },
      },
      model: null,
      workflow: { id: 'mapsoo-procedural-world-pack', version: '0.1.0' },
      aiDisclosure: {
        containsGenerativeAi: false,
        humanCurated: false,
        statement: null,
      },
      providerTerms: null,
      sources: [],
    });
    expect(result.world.spec).toBe(result.evidence.requestSpec);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.world)).toBe(true);
    expect(Object.isFrozen(result.world.spec.visual.palette)).toBe(true);
    expect(Object.isFrozen(result.evidence.provider.capabilities.supportedBiomes)).toBe(true);
    expect(Object.isFrozen(result.evidence.transformations)).toBe(true);
  });

  it('detaches the returned run from provider-owned world, claims, and metadata references', async () => {
    let rawWorld: GeneratedWorld | undefined;
    const rawClaims = claims();
    const provider = fakeProvider(async (spec) => {
      rawWorld = identify(generateWorld(spec), provider);
      return rawWorld;
    }, {}, rawClaims);

    const result = await runGenerationProviderWithEvidence(provider, DEFAULT_WORLD_SPEC, {
      now: () => new Date('2026-07-18T18:31:00.000Z'),
    });
    if (!rawWorld) throw new Error('test provider did not expose its raw world');

    rawWorld.spec.title = 'Mutated after runner validation';
    rawWorld.ground[0] = 999;
    rawClaims.workflow.id = 'mutated-workflow';
    (provider as { id: string }).id = 'mutated-provider';
    (provider.capabilities as { supportedBiomes: GeneratorCapabilities['supportedBiomes'] }).supportedBiomes = ['desert'];

    expect(result.world.spec.title).toBe(DEFAULT_WORLD_SPEC.title);
    expect(result.world.ground[0]).not.toBe(999);
    expect(result.evidence.workflow.id).toBe('test-workflow');
    expect(result.evidence.provider.id).toBe('test-provider');
    expect(result.evidence.provider.capabilities.supportedBiomes).toEqual(['meadow', 'desert', 'snow']);
  });

  it('materializes provider world and claims from data descriptors without invoking Proxy get traps', async () => {
    const worldGet = vi.fn((target: GeneratedWorld, property: PropertyKey, receiver: object) => {
      if (property === 'then') return undefined;
      return Reflect.get(target, property, receiver);
    });
    const claimsGet = vi.fn(() => {
      throw new Error('claims get trap must not run');
    });
    const proxiedClaims = new Proxy(claims(), { get: claimsGet });
    const provider = fakeProvider(
      async (spec) => new Proxy(identify(generateWorld(spec), provider), { get: worldGet }),
      {},
      proxiedClaims,
    );

    const result = await runGenerationProviderWithEvidence(provider, DEFAULT_WORLD_SPEC);

    expect(result.world.spec.id).toBe(DEFAULT_WORLD_SPEC.id);
    expect(result.evidence.workflow.id).toBe('test-workflow');
    expect(worldGet).toHaveBeenCalledOnce();
    expect(worldGet.mock.calls[0][1]).toBe('then');
    expect(claimsGet).not.toHaveBeenCalled();
  });

  it('derives AI disclosure from the frozen provider and fails closed on incomplete AI claims', async () => {
    const validClaims = claims({
      model: { provider: 'Example AI', id: 'image-model-v1', revision: '2026-07-01' },
      workflow: {
        id: 'example-ai-workflow',
        version: '1.0.0',
        definition_sha256: 'd'.repeat(64),
      },
      disclosureStatement: 'Generated by Example AI from a versioned workflow.',
      providerTerms: { url: 'https://example.com/terms', version: '2026-07' },
    });
    const aiProvider = fakeProvider(
      async (spec) => identify(generateWorld(spec), aiProvider),
      { capabilities: capabilities({ execution: 'remote', outputProvenance: 'generative-ai' }) },
      validClaims,
    );
    const result = await runGenerationProviderWithEvidence(aiProvider, DEFAULT_WORLD_SPEC);

    expect(result.evidence.aiDisclosure).toEqual({
      containsGenerativeAi: true,
      humanCurated: false,
      statement: validClaims.disclosureStatement,
    });

    const incompleteProvider = fakeProvider(
      async (spec) => identify(generateWorld(spec), incompleteProvider),
      { capabilities: capabilities({ execution: 'remote', outputProvenance: 'generative-ai' }) },
      claims({
        workflow: {
          id: 'example-ai-workflow',
          version: '1.0.0',
          definition_sha256: null,
        },
      }),
    );
    await expect(
      runGenerationProviderWithEvidence(incompleteProvider, DEFAULT_WORLD_SPEC),
    ).rejects.toMatchObject({ code: 'provider.invalid-evidence' });
  });

  it('rejects unknown raw provider output fields and aborts before returning an envelope', async () => {
    const base = fakeProvider(async (spec) => identify(generateWorld(spec), base));
    const withRawResponse: GeneratorProvider = {
      ...base,
      async generate(spec) {
        return {
          world: identify(generateWorld(spec), withRawResponse),
          claims: claims(),
          raw_response: 'MAPSOO_PRIVATE_SENTINEL',
        } as unknown as ProviderGenerationOutput;
      },
    };
    await expect(
      runGenerationProviderWithEvidence(withRawResponse, DEFAULT_WORLD_SPEC),
    ).rejects.toMatchObject({ code: 'provider.invalid-output' });

    const withAccessor: GeneratorProvider = {
      ...base,
      async generate(spec) {
        const output = {
          world: identify(generateWorld(spec), withAccessor),
        } as { world: GeneratedWorld; claims?: ProviderGenerationClaims };
        Object.defineProperty(output, 'claims', {
          enumerable: true,
          get: () => claims(),
        });
        return output as ProviderGenerationOutput;
      },
    };
    await expect(
      runGenerationProviderWithEvidence(withAccessor, DEFAULT_WORLD_SPEC),
    ).rejects.toMatchObject({ code: 'provider.invalid-output' });

    const claimsWithSecret = {
      ...claims(),
      secret: 'MAPSOO_PRIVATE_SENTINEL',
    } as unknown as ProviderGenerationClaims;
    const withSecretClaims = fakeProvider(
      async (spec) => identify(generateWorld(spec), withSecretClaims),
      {},
      claimsWithSecret,
    );
    await expect(
      runGenerationProviderWithEvidence(withSecretClaims, DEFAULT_WORLD_SPEC),
    ).rejects.toMatchObject({ code: 'provider.invalid-evidence' });

    const nestedGetter = vi.fn(() => null);
    const accessorClaims = claims();
    Object.defineProperty(accessorClaims.workflow, 'definition_sha256', {
      enumerable: true,
      get: nestedGetter,
    });
    const withNestedAccessor = fakeProvider(
      async (spec) => identify(generateWorld(spec), withNestedAccessor),
      {},
      accessorClaims,
    );
    await expect(
      runGenerationProviderWithEvidence(withNestedAccessor, DEFAULT_WORLD_SPEC),
    ).rejects.toMatchObject({ code: 'provider.invalid-evidence' });
    expect(nestedGetter).not.toHaveBeenCalled();

    const controller = new AbortController();
    await expect(runGenerationProviderWithEvidence(base, DEFAULT_WORLD_SPEC, {
      signal: controller.signal,
      now: () => {
        controller.abort();
        return new Date('2026-07-18T18:32:00.000Z');
      },
    })).rejects.toMatchObject({ code: 'provider.aborted' });
  });

  it('validates the World Spec and provider capabilities before generation', async () => {
    const generate = vi.fn(async (spec: WorldSpec) => generateWorld(spec));
    const desertOnly = fakeProvider(generate, {
      capabilities: capabilities({ supportedBiomes: ['desert'] }),
    });

    await expect(runGenerationProvider(desertOnly, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.unsupported-spec',
    });
    expect(generate).not.toHaveBeenCalled();

    const invalid = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    invalid.map.width = 99;
    await expect(runGenerationProvider(desertOnly, invalid)).rejects.toMatchObject({
      code: 'provider.invalid-spec',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('passes an independent spec clone to providers', async () => {
    const input = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    let providerSawIndependentInput = false;
    const provider = fakeProvider(async (spec) => {
      spec.title = 'Provider-local mutation';
      providerSawIndependentInput = input.title === DEFAULT_WORLD_SPEC.title;
      return identify(generateWorld(input), provider);
    });

    const result = await runGenerationProvider(provider, input);

    expect(providerSawIndependentInput).toBe(true);
    expect(input.title).toBe(DEFAULT_WORLD_SPEC.title);
    expect(result.spec.title).toBe(DEFAULT_WORLD_SPEC.title);
  });

  it('rejects invalid provider output and identity mismatches', async () => {
    const invalidOutput = fakeProvider(async (spec) => {
      const world = identify(generateWorld(spec), invalidOutput);
      return { ...world, ground: [] };
    });
    await expect(runGenerationProvider(invalidOutput, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.invalid-output',
    });

    const sparseGround = fakeProvider(async (spec) => {
      const world = identify(generateWorld(spec), sparseGround);
      return { ...world, ground: new Array(world.spec.map.width * world.spec.map.height) };
    });
    await expect(runGenerationProvider(sparseGround, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.invalid-output',
    });

    const invalidTiles = fakeProvider(async (spec) => {
      const world = identify(generateWorld(spec), invalidTiles);
      return {
        ...world,
        tiles: [{ id: 0 }] as unknown as GeneratedWorld['tiles'],
        ground: world.ground.map(() => 0),
      };
    });
    await expect(runGenerationProvider(invalidTiles, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.invalid-output',
    });

    const invalidProps = fakeProvider(async (spec) => {
      const world = identify(generateWorld(spec), invalidProps);
      return {
        ...world,
        props: [{ x: 0, y: 0 }] as unknown as GeneratedWorld['props'],
      };
    });
    await expect(runGenerationProvider(invalidProps, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.invalid-output',
    });

    const hostileOutput = fakeProvider(async () => new Proxy({} as GeneratedWorld, {
      get(target, property, receiver) {
        if (property === 'spec') throw new Error('hostile output getter');
        return Reflect.get(target, property, receiver);
      },
    }));
    await expect(runGenerationProvider(hostileOutput, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.invalid-output',
    });

    const wrongIdentity = fakeProvider(async (spec) => generateWorld(spec));
    await expect(runGenerationProvider(wrongIdentity, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.identity-mismatch',
    });

    const changedSpec = fakeProvider(async (spec) => {
      spec.title = 'Changed by provider';
      return identify(generateWorld(spec), changedSpec);
    });
    await expect(runGenerationProvider(changedSpec, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.spec-mismatch',
    });
  });

  it('honors abort signals before and after provider execution', async () => {
    const beforeController = new AbortController();
    beforeController.abort();
    const beforeGenerate = vi.fn(async (spec: WorldSpec) => generateWorld(spec));
    const beforeProvider = fakeProvider(beforeGenerate);

    await expect(
      runGenerationProvider(beforeProvider, DEFAULT_WORLD_SPEC, { signal: beforeController.signal }),
    ).rejects.toMatchObject({ code: 'provider.aborted' });
    expect(beforeGenerate).not.toHaveBeenCalled();

    const afterController = new AbortController();
    const afterProvider = fakeProvider(async (spec) => {
      afterController.abort();
      return identify(generateWorld(spec), afterProvider);
    });
    await expect(
      runGenerationProvider(afterProvider, DEFAULT_WORLD_SPEC, { signal: afterController.signal }),
    ).rejects.toMatchObject({ code: 'provider.aborted' });
  });

  it('snapshots provider identity, capabilities, and requested spec before awaiting', async () => {
    let releaseGeneration: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const input = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    const mutable = fakeProvider(async (spec) => {
      await gate;
      return identify(generateWorld(spec), mutable);
    });

    const resultPromise = runGenerationProvider(mutable, input);
    (mutable as { id: string }).id = PROCEDURAL_PIXEL_GENERATOR_ID;
    (mutable as { version: string }).version = PROCEDURAL_PIXEL_GENERATOR_VERSION;
    (mutable.capabilities as { supportedBiomes: GeneratorCapabilities['supportedBiomes'] }).supportedBiomes = ['desert'];
    input.title = 'Concurrent caller mutation';
    releaseGeneration?.();

    await expect(resultPromise).rejects.toMatchObject({ code: 'provider.identity-mismatch' });

    const stableProvider = fakeProvider(async (spec) => identify(generateWorld(spec), stableProvider), {
      id: 'stable-provider',
    });
    let releaseStable: (() => void) | undefined;
    const stableGate = new Promise<void>((resolve) => {
      releaseStable = resolve;
    });
    (stableProvider as { generate: GeneratorProvider['generate'] }).generate = async (spec) => {
      await stableGate;
      return {
        world: identify(generateWorld(spec), stableProvider),
        claims: claims(),
      };
    };
    const stableInput = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    const stableResultPromise = runGenerationProvider(stableProvider, stableInput);
    stableInput.title = 'Changed after invocation';
    releaseStable?.();
    await expect(stableResultPromise).resolves.toMatchObject({
      spec: { title: DEFAULT_WORLD_SPEC.title },
    });
  });

  it('wraps vendor failures and rejects non-JSON extension values with stable errors', async () => {
    const vendorFailure = new Error('vendor secret detail');
    const failingProvider = fakeProvider(async () => {
      throw vendorFailure;
    });
    await expect(runGenerationProvider(failingProvider, DEFAULT_WORLD_SPEC)).rejects.toMatchObject({
      code: 'provider.execution-failed',
      cause: vendorFailure,
    });

    const cyclic = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    const extension: Record<string, unknown> = {};
    extension.self = extension;
    cyclic.extensions = { 'org.mapsoo.externalhost': extension };
    await expect(runGenerationProvider(failingProvider, cyclic)).rejects.toMatchObject({
      code: 'provider.invalid-spec',
    });

    const withFunction = cloneWorldSpec(DEFAULT_WORLD_SPEC);
    withFunction.extensions = { 'org.mapsoo.externalhost': { callback: () => undefined } };
    await expect(runGenerationProvider(failingProvider, withFunction)).rejects.toMatchObject({
      code: 'provider.invalid-spec',
    });
  });

  it('accepts SemVer build metadata and rejects malformed prerelease identifiers', () => {
    expect(isValidGeneratorVersion('1.2.3-alpha.1+build.7')).toBe(true);
    expect(isValidGeneratorVersion('1.0.0-..')).toBe(false);
    expect(isValidGeneratorVersion('1.0.0-01')).toBe(false);
  });

  it('rejects invalid, duplicate, and unknown provider registrations', () => {
    const provider = fakeProvider(async (spec) => identify(generateWorld(spec), provider));
    expect(() => new GeneratorProviderRegistry([provider, provider])).toThrowError(GenerationProviderError);

    const invalid = fakeProvider(async (spec) => generateWorld(spec), { id: '../unsafe' });
    expect(() => new GeneratorProviderRegistry([invalid])).toThrowError(GenerationProviderError);
    expect(() => new GeneratorProviderRegistry([null as unknown as GeneratorProvider])).toThrowError(
      GenerationProviderError,
    );

    const incomplete = fakeProvider(async (spec) => generateWorld(spec), {
      capabilities: {
        ...capabilities(),
        supportedBiomes: undefined,
        maxMapSize: undefined,
      } as unknown as GeneratorCapabilities,
    });
    expect(() => new GeneratorProviderRegistry([incomplete])).toThrowError(GenerationProviderError);

    const registry = new GeneratorProviderRegistry([provider]);
    (provider as { id: string }).id = 'mutated-after-registration';
    expect(registry.require('test-provider').id).toBe('test-provider');
    expect(() => registry.require('missing-provider')).toThrowError(GenerationProviderError);
    try {
      registry.require('missing-provider');
    } catch (error) {
      expect(error).toMatchObject({ code: 'provider.not-found' });
    }

    const aiImpersonator = fakeProvider(async (spec) => generateWorld(spec), {
      id: PROCEDURAL_PIXEL_GENERATOR_ID,
      version: PROCEDURAL_PIXEL_GENERATOR_VERSION,
      capabilities: capabilities({ outputProvenance: 'generative-ai' }),
    });
    expect(() => new GeneratorProviderRegistry([aiImpersonator])).toThrowError(GenerationProviderError);

    const proceduralImpersonator = fakeProvider(async (spec) => generateWorld(spec), {
      id: PROCEDURAL_PIXEL_GENERATOR_ID,
      version: PROCEDURAL_PIXEL_GENERATOR_VERSION,
    });
    expect(() => new GeneratorProviderRegistry([proceduralImpersonator])).toThrowError(GenerationProviderError);

    const capabilitySecret = fakeProvider(async (spec) => identify(generateWorld(spec), capabilitySecret), {
      capabilities: {
        ...capabilities(),
        apiKey: 'MAPSOO_PRIVATE_SENTINEL',
      } as unknown as GeneratorCapabilities,
    });
    expect(() => new GeneratorProviderRegistry([capabilitySecret])).toThrowError(GenerationProviderError);

    const shiftingTarget = fakeProvider(async (spec) => identify(generateWorld(spec), shiftingTarget));
    const shiftingIdentity = new Proxy(shiftingTarget, {
      get(target, property, receiver) {
        if (property === 'id') return PROCEDURAL_PIXEL_GENERATOR_ID;
        if (property === 'version') return PROCEDURAL_PIXEL_GENERATOR_VERSION;
        return Reflect.get(target, property, receiver);
      },
    });
    const shiftingRegistry = new GeneratorProviderRegistry([shiftingIdentity]);
    expect(shiftingRegistry.require('test-provider')).toMatchObject({ id: 'test-provider', version: '1.0.0' });
  });
});
