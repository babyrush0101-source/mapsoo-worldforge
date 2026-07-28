# Generation Provider SDK

This document describes the first provider boundary in Mapsoo WorldForge. It is an experimental contributor API for adding generation backends without weakening the deterministic v0.1 export contract.

## Current status

- The historical `procedural-pixel-v1@0.1.0` and current `procedural-terrain-v2@0.2.0` providers are local, seeded, credential-free, and non-AI.
- `runGenerationProviderWithEvidence()`, the compatibility `runGenerationProvider()` world-only wrapper, and `GeneratorProviderRegistry` are implemented and tested.
- The Workbench atomically stores the runner-owned `world + evidence` result for its initial world, edited specs, and imported specs; the preview shows the Provider snapshot that actually produced the current world.
- A single request session aborts superseded work and prevents stale completions from replacing the last successful world/evidence pair. UI and console errors expose only stable Mapsoo error codes.
- Provider Receipt schema `0.2.0` and its runtime validator are implemented without rewriting any published receipt.
- Alpha.4 is the registered public download and the package/Workbench default: it reserves a new provider identity, derives manifest time/World Spec/license/provenance from the runner-minted receipt, verifies the exact 11-file payload before ZIP creation, and uses the same deterministic ZIP encoding as release packaging. Historical Alpha.2/Alpha.3 browser gates call the frozen v1 provider explicitly.
- No optional AI provider is shipped yet.
- Each portable/itch exporter accepts only its version-reserved built-in procedural integration and exact source-free CC0 workflow/transformation evidence profile. A provider being runnable does **not** make its output publishable.

## Contract

```ts
interface GeneratorProvider {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: GeneratorCapabilities;
  generate(spec: WorldSpec, options?: { signal?: AbortSignal }): Promise<{
    world: GeneratedWorld;
    claims: ProviderGenerationClaims;
  }>;
}
```

Provider IDs are lowercase path-safe identifiers. Versions use SemVer 2.0. Capabilities declare:

- local or remote execution;
- seeded or best-effort determinism;
- whether credentials are required;
- procedural or generative-AI output provenance;
- supported styles, biomes, tile sizes, and maximum map dimensions;
- abort and partial-regeneration support.

The declaration is a runtime contract, not UI copy. A provider must not claim abort support if it can only observe cancellation after generation has finished. Capability objects accept only their declared enumerable data fields; accessors, unknown fields, and any attempt to reuse the reserved built-in identity are rejected.

## Safe execution path

Call providers through `runGenerationProviderWithEvidence()` rather than invoking `generate()` from application code:

```ts
const result = await runGenerationProviderWithEvidence(provider, worldSpec, {
  signal: abortController.signal,
});
```

The runner performs these boundaries in order:

1. validates and snapshots provider identity, display name, capabilities, and callable;
2. validates the World Spec as bounded JSON and saves an immutable comparison snapshot;
3. rejects unsupported styles, biomes, tile sizes, or dimensions before provider work;
4. checks cancellation, then passes a separate World Spec clone to the provider;
5. wraps unknown vendor failures in a stable `provider.execution-failed` error;
6. validates tile definitions, tile references, prop definitions, coordinates, and uniqueness;
7. verifies the returned provider identity and confirms the requested World Spec was not changed;
8. derives identity, execution, provenance, AI flag, human-curation flag, and completion time from the runner-owned snapshot rather than Provider claims;
9. strictly validates model/workflow/transformation/disclosure/terms/source claims against the receipt contract;
10. materializes only known world fields, deep-freezes the world/spec/provider/claims graph, checks cancellation again, and returns one indivisible `GenerationRunResult`.

Providers cannot set `createdAt`, `containsGenerativeAi`, `humanCurated`, execution mode, or provider identity inside claims. The Workbench and exporter accept the complete result as one value, never separate `world` and `evidence` parameters. The legacy exporter also rejects bare `GeneratedWorld` objects before rendering or ZIP side effects.

The in-process trust marker prevents accidental fabrication, stale pairing, and post-validation mutation inside the Workbench pipeline. It is not a sandbox, a digital signature, or a defense against arbitrary code already executing in the same JavaScript realm; optional Providers remain reviewed application integrations rather than untrusted plug-ins.

The registry also stores frozen provider snapshots. Mutating the object originally passed to the registry cannot rename or reconfigure the registered provider.

## Stable errors

`GenerationProviderError.code` is intended for application control flow:

| Code | Meaning |
| --- | --- |
| `provider.invalid-metadata` | Provider identity, capabilities, or callable is malformed. |
| `provider.invalid-spec` | Input is not a valid, bounded, JSON-safe World Spec. |
| `provider.unsupported-spec` | Valid input is outside the provider's declared capabilities. |
| `provider.aborted` | The supplied signal was aborted before or after provider execution. |
| `provider.execution-failed` | A non-Mapsoo vendor/provider exception was wrapped; the original is in `cause`. |
| `provider.invalid-output` | The generated world fails the runtime output contract. |
| `provider.invalid-evidence` | Provider claims or the runner-owned completion evidence fail the strict contract. |
| `provider.identity-mismatch` | Output identifies a different provider/version than the invocation snapshot. |
| `provider.spec-mismatch` | Output changed the requested World Spec. |
| `provider.not-found` | A registry lookup used an unknown provider ID. |

A provider may throw an existing `GenerationProviderError` when one of these meanings applies. Do not expose vendor response bodies, credentials, prompts containing private data, or raw remote error payloads to end users.

## Minimal provider example

```ts
export const EXAMPLE_PROVIDER = {
  id: 'example-provider',
  version: '0.1.0',
  displayName: 'Example Provider',
  capabilities: {
    execution: 'remote',
    determinism: 'best-effort',
    requiresCredentials: true,
    outputProvenance: 'generative-ai',
    supportedStyles: ['pixel-art'],
    supportedBiomes: ['meadow'],
    supportedTileSizes: [32],
    maxMapSize: { width: 24, height: 16 },
    supportsAbort: true,
    supportsPartialRegeneration: false,
  },
  async generate(spec, { signal } = {}) {
    // Call the backend and normalize its result.
    return {
      world,
      claims: {
        model: { provider: 'Vendor', id: 'model-id', revision: 'immutable-revision' },
        workflow: { id: 'example-workflow', version: '0.1.0', definition_sha256: '...' },
        transformations: [{ id: 'image-generation', version: '0.1.0' }],
        disclosureStatement: 'Generated with Vendor model-id.',
        providerTerms: { url: 'https://vendor.example/terms', version: '2026-07' },
        sources: [],
      },
    };
  },
} satisfies GeneratorProvider;
```

The example is deliberately incomplete: it omits backend code, error normalization, the real workflow hash, and publication policy. Copying it must not create a provider that appears production-ready. API keys, Authorization values, private prompts, signed URLs, and raw vendor responses belong in private runtime configuration, never World Spec extensions, claims, receipts, or ZIP payloads.

## Provider Receipt contract

`schemas/mapsoo-generation-receipt.schema.json` defines the full `0.2.0` receipt planned for the next pack release. Its runtime validator requires and cross-checks:

- receipt time, World ID, seed, World Spec pack path, and exact SHA-256;
- provider identity, execution mode, and output provenance from the frozen provider snapshot;
- explicit model and workflow records plus ordered, versioned transformations;
- generative-AI and human-curation disclosure;
- output licensing, provider terms, and hashed/licensed source declarations.

Procedural receipts require `model: null`, `contains_generative_ai: false`, a null disclosure statement, and null provider terms. Generative-AI receipts require a model, a hashed workflow definition, a non-empty disclosure statement, and provider terms. Human curation never overrides AI provenance. Unknown fields, unsafe paths, malformed timestamps/hashes, duplicate or unlocated sources, missing CC attribution, unknown bare license names, and context mismatches are rejected. Public terms/source URLs must be canonical HTTPS URLs without credentials, query strings, or fragments. Custom licenses use an explicit `LicenseRef-*`; custom source licenses also require a public HTTPS terms URL.

The public `v0.1.0-alpha.1` fixture remains byte-for-byte immutable with its legacy `0.1.0` receipt. Release and itch verification pin the published asset ZIP SHA-256, accept that legacy shape only for the exact built-in procedural identity, and cross-check its world, seed, license, transformations, and non-AI provenance. Receipt 0.2 enters only the new `v0.1.0-alpha.2` fixture; the historical tag is never rewritten.

The alpha.2 builder remains a distinct implementation from the frozen legacy exporter. A package-version-checked current-export binding selects it for the Workbench. It accepts only a `GenerationRunResult` minted by the runner, serializes the World Spec once, binds its actual SHA-256 into receipt `0.2.0`, includes the receipt schema, and derives manifest creation time, World Spec, license, and provenance from the shipped receipt. Its 11 manifest records exactly cover all non-manifest ZIP payloads; the full ZIP has 12 files and no implicit directory entries.

## Publication gate for future AI providers

Before any AI provider can enter portable or itch.io output, the project still needs:

- a separate reviewed AI-publication policy and fixture rather than reuse of the procedural-only alpha.2 allowlist;
- a license decision for every output and any source/reference asset;
- truthful `contains_generative_ai` manifest and itch.io AI Disclosure mapping;
- secret handling outside browser bundles and repository history;
- deterministic normalization tests plus failure, cancellation, and malformed-output tests;
- a reviewed removal of the v0.1 procedural-only exporter allowlist.

Until all of those are implemented, an optional provider may be developed behind the SDK boundary but its output must not be labeled CC0 procedural content or uploaded through the v0.1 release kit.

## Verification

Run:

```bash
pnpm check
pnpm release:itch
```

Provider tests live in `src/core/generation-provider.test.ts`. The release command additionally proves that the existing Sunny Meadow pack and itch.io operator kit remain byte-reproducible.
