import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  CURRENT_PACK_VERSION,
  downloadCurrentPortablePack,
} from '../adapters/export-current-pack';
import { downloadAlpha5PortablePack } from '../adapters/export-browser-pack-alpha5';
import { readExternalHostAssetRequestFile } from '../adapters/import-external-host-asset-request';
import { readWorldSpecFile } from '../adapters/import-world-spec';
import type { GenerationRunResult } from '../core/generation-evidence';
import { runGenerationProviderWithEvidence } from '../core/generation-provider';
import { PLAYABLE_PROP_KINDS } from '../core/generate-playable-world';
import { PLAYABLE_TERRAIN_TILE_DEFINITIONS } from '../core/playable-terrain';
import {
  BIOME_PALETTES,
  ALPHA6_DEFAULT_WORLD_SPEC,
  ALPHA6_WORLD_SCHEMA_VERSION,
  DEFAULT_WORLD_SPEC,
  WORLD_SCHEMA_VERSION,
  cloneWorldSpec,
  type BiomeId,
  type GeneratedWorld,
  type TileSize,
  type WorldSpec,
} from '../core/world-spec';
import { validateGeneratedWorld, validateWorldSpec } from '../core/validate-world';
import { WorldPreview } from '../features/world-preview/WorldPreview';
import { WorldGallery } from '../features/world-gallery/WorldGallery';
import { ReferenceWorldGenerator } from '../features/reference-world-generator/ReferenceWorldGenerator';
import {
  WorldCreationDialogue,
  type WorldCreationAssetHandoff,
} from '../features/world-creation-dialogue/WorldCreationDialogue';
import { DEFAULT_GENERATION_PROVIDER } from '../providers/provider-registry';
import { CURRENT_PUBLIC_RELEASE } from './current-public-release';
import { GenerationSession, type GenerationRequest } from './generation-session';
import { safeGenerationFailureLog, safeGenerationFailureMessage } from './generation-status';
import {
  WORLD_EXAMPLES,
  cloneWorldExampleSpec,
  findMatchingWorldExample,
  type WorldExampleId,
} from './world-example-registry';

const BIOME_LABELS: Record<BiomeId, { name: string; note: string }> = {
  meadow: { name: 'Meadow', note: 'Lush, gentle, story-ready' },
  desert: { name: 'Desert', note: 'Warm, open, high contrast' },
  snow: { name: 'Snowfield', note: 'Quiet, crisp, exploratory' },
};

function normalizeInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function App() {
  const worldSpecInputRef = useRef<HTMLInputElement>(null);
  const externalHostAssetRequestInputRef = useRef<HTMLInputElement>(null);
  const generationSessionRef = useRef<GenerationSession | null>(null);
  if (generationSessionRef.current === null) generationSessionRef.current = new GenerationSession();
  const generationSession = generationSessionRef.current;
  const [draft, setDraft] = useState<WorldSpec>(() => cloneWorldSpec(ALPHA6_DEFAULT_WORLD_SPEC));
  const [generationRun, setGenerationRun] = useState<GenerationRunResult | null>(null);
  const world: GeneratedWorld | null = generationRun?.world ?? null;
  const [exportState, setExportState] = useState<'idle' | 'building' | 'failed'>('idle');
  const [generationState, setGenerationState] = useState<'idle' | 'generating'>('idle');
  const [exampleLoadingId, setExampleLoadingId] = useState<WorldExampleId | null>(null);
  const [generationNotice, setGenerationNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [importState, setImportState] = useState<'idle' | 'reading' | 'generating'>('idle');
  const [importKind, setImportKind] = useState<'world' | 'external-host' | null>(null);
  const [importNotice, setImportNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [creationHandoff, setCreationHandoff] = useState<WorldCreationAssetHandoff | null>(null);
  const draftIssues = useMemo(() => validateWorldSpec(draft), [draft]);
  const activeExampleId = useMemo(() => findMatchingWorldExample(draft)?.id ?? '', [draft]);
  const selectedPublicPack = CURRENT_PUBLIC_RELEASE.assetPacks.find((pack) => pack.id === activeExampleId)
    ?? CURRENT_PUBLIC_RELEASE.assetPack;
  const packIssues = useMemo(() => (world ? validateGeneratedWorld(world) : []), [world]);
  const hasDraftErrors = draftIssues.some((issue) => issue.severity === 'error');
  const hasPackErrors = !world || packIssues.some((issue) => issue.severity === 'error');
  const currentPackExportCompatible = world?.spec.schemaVersion === WORLD_SCHEMA_VERSION
    || world?.spec.schemaVersion === ALPHA6_WORLD_SCHEMA_VERSION;
  const hasChanges = !world || JSON.stringify(draft) !== JSON.stringify(world.spec);
  const operationBusy = generationState === 'generating'
    || exampleLoadingId !== null
    || importState !== 'idle'
    || exportState === 'building';
  const initialGenerationFailed = !world && generationState === 'idle' && generationNotice?.tone === 'error';
  const displayedProvider = generationRun?.evidence.provider ?? DEFAULT_GENERATION_PROVIDER;

  useEffect(() => {
    const request = generationSession.begin();
    setGenerationState('generating');
    setGenerationNotice(null);

    void runGenerationProviderWithEvidence(DEFAULT_GENERATION_PROVIDER, ALPHA6_DEFAULT_WORLD_SPEC, { signal: request.signal })
      .then((result) => {
        if (!generationSession.isCurrent(request)) return;
        setGenerationRun(result);
        setGenerationNotice({
          tone: 'success',
          message: `Ready with ${result.evidence.provider.displayName} ${result.evidence.provider.version}.`,
        });
      })
      .catch((error: unknown) => {
        if (!generationSession.isCurrent(request)) return;
        console.error(safeGenerationFailureLog(error));
        setGenerationNotice({ tone: 'error', message: safeGenerationFailureMessage(error) });
      })
      .finally(() => {
        if (generationSession.isCurrent(request)) setGenerationState('idle');
      });

    return () => generationSession.cancel();
  }, [generationSession]);

  useEffect(() => {
    if (window.location.hash !== '#godot-quickstart') return;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById('godot-quickstart')?.scrollIntoView({ block: 'start' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  function chooseBiome(biome: BiomeId) {
    setDraft((current) => ({
      ...current,
      visual: { ...current.visual, palette: [...BIOME_PALETTES[biome]] },
      map: { ...current.map, biome },
    }));
  }

  async function loadWorldExample(id: WorldExampleId) {
    const request = generationSession.begin();
    const spec = cloneWorldExampleSpec(id);
    setExampleLoadingId(id);
    setGenerationState('idle');
    setGenerationNotice(null);
    setImportState('idle');
    setImportKind(null);
    setImportNotice(null);

    try {
      const result = await runGenerationProviderWithEvidence(DEFAULT_GENERATION_PROVIDER, spec, {
        signal: request.signal,
      });
      if (!generationSession.isCurrent(request)) return;
      setDraft(cloneWorldSpec(spec));
      setGenerationRun(result);
      setExportState('idle');
      setGenerationNotice({
        tone: 'success',
        message: `Loaded ${spec.title} from the Alpha.7 public registry.`,
      });
    } catch (error) {
      if (!generationSession.isCurrent(request)) return;
      const message = safeGenerationFailureMessage(error);
      console.error(safeGenerationFailureLog(error));
      setGenerationNotice({ tone: 'error', message });
    } finally {
      if (generationSession.isCurrent(request)) setExampleLoadingId(null);
    }
  }

  async function generate() {
    if (hasDraftErrors) return;

    const request = generationSession.begin();
    setGenerationState('generating');
    setGenerationNotice(null);
    setImportState('idle');
    setImportNotice(null);

    try {
      const result = await runGenerationProviderWithEvidence(DEFAULT_GENERATION_PROVIDER, draft, {
        signal: request.signal,
      });
      if (!generationSession.isCurrent(request)) return;
      setGenerationRun(result);
      setExportState('idle');
      setGenerationNotice({
        tone: 'success',
        message: `Generated with ${result.evidence.provider.displayName} ${result.evidence.provider.version}.`,
      });
    } catch (error) {
      if (!generationSession.isCurrent(request)) return;
      const message = safeGenerationFailureMessage(error);
      console.error(safeGenerationFailureLog(error));
      setGenerationNotice({ tone: 'error', message });
    } finally {
      if (generationSession.isCurrent(request)) setGenerationState('idle');
    }
  }

  async function exportPack() {
    if (!generationRun) return;
    setExportState('building');
    try {
      const errors = validateGeneratedWorld(generationRun.world).filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        throw new Error(`Invalid generated world: ${errors.map((issue) => issue.code).join(', ')}`);
      }
      if (generationRun.world.spec.schemaVersion === ALPHA6_WORLD_SCHEMA_VERSION) {
        await downloadCurrentPortablePack(generationRun);
      } else {
        await downloadAlpha5PortablePack(generationRun);
      }
      setExportState('idle');
    } catch {
      console.error('Mapsoo portable export failed after local validation.');
      setExportState('failed');
    }
  }

  function exportWorldSpec() {
    if (!world) return;
    const errors = validateWorldSpec(world.spec).filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      console.error(`Invalid world spec: ${errors.map((issue) => issue.code).join(', ')}`);
      setExportState('failed');
      return;
    }

    downloadJson(`${world.spec.id}.world.json`, world.spec);
  }

  async function generateImportedSpec(
    spec: WorldSpec,
    request: GenerationRequest,
    successMessage: string,
  ) {
    try {
      setImportState('generating');
      const generationResult = await runGenerationProviderWithEvidence(DEFAULT_GENERATION_PROVIDER, spec, {
        signal: request.signal,
      });
      if (!generationSession.isCurrent(request)) return;
      setDraft(cloneWorldSpec(spec));
      setGenerationRun(generationResult);
      setExportState('idle');
      setImportNotice({ tone: 'success', message: successMessage });
    } catch (error) {
      if (!generationSession.isCurrent(request)) return;
      const message = safeGenerationFailureMessage(error);
      console.error(safeGenerationFailureLog(error));
      setImportNotice({
        tone: 'error',
        message: `The imported World Spec passed parsing but could not be generated. ${message}`,
      });
    } finally {
      if (generationSession.isCurrent(request)) {
        setImportState('idle');
        setImportKind(null);
      }
    }
  }

  async function importWorldSpec(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const request = generationSession.begin();

    setImportState('reading');
    setImportKind('world');
    setImportNotice(null);
    setGenerationState('idle');
    setGenerationNotice(null);

    const result = await readWorldSpecFile(file);
    if (!generationSession.isCurrent(request)) return;
    if (!result.ok) {
      setImportNotice({ tone: 'error', message: result.message });
      setImportState('idle');
      setImportKind(null);
      return;
    }

    const warningCount = result.issues.filter((issue) => issue.severity === 'warning').length;
    const successMessage = warningCount > 0
      ? `Loaded ${file.name} with ${warningCount} validation warning${warningCount === 1 ? '' : 's'}.`
      : `Loaded and generated ${file.name}.`;
    await generateImportedSpec(result.spec, request, successMessage);
  }

  async function importExternalHostAssetRequest(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    const request = generationSession.begin();
    setImportState('reading');
    setImportKind('external-host');
    setImportNotice(null);
    setGenerationState('idle');
    setGenerationNotice(null);

    const result = await readExternalHostAssetRequestFile(file);
    if (!generationSession.isCurrent(request)) return;
    if (!result.ok) {
      setImportNotice({ tone: 'error', message: result.message });
      setImportState('idle');
      setImportKind(null);
      return;
    }

    const { assetRequestSha256, worldSpec } = result.projection;
    await generateImportedSpec(
      worldSpec,
      request,
      `Loaded ${file.name} as ${worldSpec.id}; request ${assetRequestSha256.slice(0, 12)}… is bound to the pack.`,
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Mapsoo Worldsmith home">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>
            <strong>Mapsoo</strong>
            <small>Worldsmith · v{CURRENT_PACK_VERSION}</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="status-dot" /> Local-first
          <a href="https://github.com/babyrush0101-source/mapsoo-worldforge">GitHub</a>
        </div>
      </header>

      <main id="top">
        <section className="hero-copy">
          <p className="eyebrow">Open-source · Portable · Godot 4.3+ importer available</p>
          <h1>Describe a world.<br />Build a playable pack.</h1>
          <p>
            Turn a versioned world specification into coherent tiles, a map preview, validation results,
            and a portable PNG + JSON asset pack with a validated Godot importer.
          </p>
        </section>

        <WorldGallery
          examples={WORLD_EXAMPLES}
          activeWorldId={activeExampleId}
          loadingWorldId={exampleLoadingId}
          disabled={operationBusy}
          onSelect={(id) => void loadWorldExample(id)}
        />

        <WorldCreationDialogue onReadyForAssets={(handoff) => setCreationHandoff(handoff)} />

        <ReferenceWorldGenerator
          key={creationHandoff?.checkpoints.map(({ snapshotSha256 }) => snapshotSha256).join(':') ?? 'standalone-reference-generator'}
          initialProfile={creationHandoff?.profile}
          initialDescription={creationHandoff?.description}
          initialConfirmation={creationHandoff ? {
            sessionRevision: creationHandoff.sessionRevision,
            checkpoints: creationHandoff.checkpoints,
          } : undefined}
        />

        <section className="workbench" aria-label="World generator workbench">
          <aside className="panel controls-panel">
            <div className="panel-heading">
              <div>
                <span className="step">01</span>
                <h2>World spec</h2>
              </div>
              <span className={`dirty-state ${hasChanges ? 'is-dirty' : ''}`}>{hasChanges ? 'Edited' : 'Built'}</span>
            </div>

            <label>
              World title
              <input
                value={draft.title}
                maxLength={120}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              />
            </label>

            <label>
              World ID
              <input
                value={draft.id}
                onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))}
                spellCheck={false}
              />
            </label>

            <label>
              Brief
              <textarea
                value={draft.description}
                maxLength={1000}
                rows={3}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
              />
            </label>

            <fieldset>
              <legend>Biome recipe</legend>
              <div className="biome-grid">
                {(Object.keys(BIOME_LABELS) as BiomeId[]).map((biome) => (
                  <button
                    className={draft.map.biome === biome ? 'biome-card is-active' : 'biome-card'}
                    key={biome}
                    type="button"
                    onClick={() => chooseBiome(biome)}
                  >
                    <span className={`biome-swatch biome-${biome}`} />
                    <strong>{BIOME_LABELS[biome].name}</strong>
                    <small>{BIOME_LABELS[biome].note}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="two-column-fields">
              <label>
                Width
                <input
                  type="number"
                  min="8"
                  max="48"
                  step="1"
                  value={draft.map.width}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      map: { ...current.map, width: normalizeInteger(event.target.valueAsNumber, 8, 48) },
                    }))
                  }
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  min="8"
                  max="32"
                  step="1"
                  value={draft.map.height}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      map: { ...current.map, height: normalizeInteger(event.target.valueAsNumber, 8, 32) },
                    }))
                  }
                />
              </label>
            </div>

            <div className="two-column-fields">
              <label>
                Tile size
                <select
                  value={draft.visual.tileSize}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      visual: { ...current.visual, tileSize: Number(event.target.value) as TileSize },
                    }))
                  }
                >
                  <option value="16">16 px</option>
                  <option value="32">32 px</option>
                  <option value="64">64 px</option>
                </select>
              </label>
              <label>
                Seed
                <input
                  value={draft.seed}
                  maxLength={160}
                  onChange={(event) => setDraft((current) => ({ ...current, seed: event.target.value }))}
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="palette-row" aria-label="World palette">
              {draft.visual.palette.map((color, index) => (
                <label className="color-control" key={`${index}-${color}`} title={`Palette color ${index + 1}`}>
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => {
                      const palette = [...draft.visual.palette] as WorldSpec['visual']['palette'];
                      palette[index] = event.target.value;
                      setDraft((current) => ({ ...current, visual: { ...current.visual, palette } }));
                    }}
                  />
                </label>
              ))}
            </div>

            {draftIssues.length > 0 && (
              <div className="inline-issues">
                {draftIssues.map((issue) => (
                  <p key={issue.code} className={issue.severity}>
                    {issue.message}
                  </p>
                ))}
              </div>
            )}

            <button
              className="primary-action"
              type="button"
              onClick={generate}
              disabled={hasDraftErrors || operationBusy}
            >
              {generationState === 'generating' ? 'Generating with provider…' : 'Generate local world'}
              <span>→</span>
            </button>
            <div className="import-status" aria-live="polite" aria-busy={generationState === 'generating'}>
              {generationState === 'generating' && (
                <p>Validating the spec and generating through the provider contract…</p>
              )}
              {generationState === 'idle' && generationNotice && (
                <p className={generationNotice.tone}>{generationNotice.message}</p>
              )}
            </div>
          </aside>

          <section className="panel preview-panel" aria-busy={operationBusy}>
            <div className="panel-heading">
              <div>
                <span className="step">02</span>
                <h2>World preview</h2>
              </div>
              <div className="preview-tools">
                <span>
                  {world ? `${world.spec.map.width} × ${world.spec.map.height}` : initialGenerationFailed ? 'Unavailable' : 'Preparing…'}
                </span>
                <span>{world ? `${world.spec.visual.tileSize}px` : `${draft.visual.tileSize}px`}</span>
              </div>
            </div>

            {world ? (
              <>
                <WorldPreview world={world} />
                <div className="legend-row">
                  {[
                    ['ground', world.spec.visual.palette[1]],
                    ['water', world.spec.visual.palette[3]],
                    ['roads', world.spec.visual.palette[4]],
                    ['props', world.spec.visual.palette[2]],
                  ].map(([label, color]) => (
                    <span key={label}>
                      <i style={{ background: color }} /> {label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className={`preview-placeholder${initialGenerationFailed ? ' is-error' : ''}`} role="status">
                <strong>{initialGenerationFailed ? 'The first world could not be generated.' : 'Preparing the first world…'}</strong>
                <span>
                  {initialGenerationFailed
                    ? `${generationNotice.message} Review the spec and use Generate local world to retry.`
                    : 'The default provider is validating the starter World Spec.'}
                </span>
              </div>
            )}

            <div className="build-note">
              <span>Provider</span>
              <strong title={`${displayedProvider.id}@${displayedProvider.version}`}>
                {displayedProvider.displayName}
              </strong>
              <span>Mode</span>
              <strong>
                {displayedProvider.capabilities.execution} · {displayedProvider.capabilities.determinism}
                {' · '}{displayedProvider.capabilities.outputProvenance}
              </strong>
              <span>Credentials</span>
              <strong>{displayedProvider.capabilities.requiresCredentials ? 'required' : 'none'}</strong>
              <span>Seed</span>
              <strong>{world?.spec.seed ?? draft.seed}</strong>
              <span>Contract</span>
              <strong>{displayedProvider.id}@{displayedProvider.version}</strong>
            </div>
          </section>

          <aside className="panel inspector-panel">
            <div className="panel-heading">
              <div>
                <span className="step">03</span>
                <h2>Pack inspector</h2>
              </div>
              <span className="pass-badge">
                {!world
                  ? initialGenerationFailed ? 'Failed' : 'Preparing'
                  : packIssues.some((issue) => issue.severity === 'error') ? 'Blocked' : 'Valid'}
              </span>
            </div>

            <div className="metric-grid">
              <article><strong>{world?.ground.length ?? '—'}</strong><span>map cells</span></article>
              <article><strong>{PLAYABLE_TERRAIN_TILE_DEFINITIONS.length}</strong><span>terrain tiles</span></article>
              <article><strong>{PLAYABLE_PROP_KINDS.length}</strong><span>prop sprites</span></article>
              <article><strong>{world?.props.length ?? '—'}</strong><span>placed props</span></article>
            </div>

            <h3>Validation</h3>
            <div className="validation-list">
              {!world && (
                <article className={`validation-item ${initialGenerationFailed ? 'error' : 'info'}`}>
                  <span>{initialGenerationFailed ? '!' : '…'}</span>
                  <div>
                    <strong>{initialGenerationFailed ? 'provider.failed' : 'provider.pending'}</strong>
                    <p>
                      {initialGenerationFailed
                        ? `${generationNotice.message} Correct the spec or retry generation.`
                        : 'The first generated world is still being validated.'}
                    </p>
                  </div>
                </article>
              )}
              {packIssues.map((issue) => (
                <article key={issue.code} className={`validation-item ${issue.severity}`}>
                  <span>{issue.severity === 'error' ? '!' : issue.severity === 'warning' ? '△' : '✓'}</span>
                  <div>
                    <strong>{issue.code}</strong>
                    <p>{issue.message}</p>
                  </div>
                </article>
              ))}
            </div>

            <h3>Pack consumers</h3>
            <ul className="target-list">
              <li><span>Portable source</span><small>Current · one PNG + JSON ZIP</small></li>
              <li><span>Godot 4.3+</span><small>Official importer + TileMapLayer</small></li>
              <li><span>itch.io</span><small>Planned · publication postponed</small></li>
            </ul>

            <div className="export-actions">
              <input
                ref={worldSpecInputRef}
                className="file-input"
                type="file"
                accept=".json,application/json"
                aria-label="Choose a World Spec JSON file"
                onChange={importWorldSpec}
                disabled={operationBusy}
              />
              <input
                ref={externalHostAssetRequestInputRef}
                className="file-input"
                type="file"
                accept=".json,application/json"
                aria-label="Choose an External Host Asset Request JSON file"
                onChange={importExternalHostAssetRequest}
                disabled={operationBusy}
              />
              <button
                className="secondary-action is-ready"
                type="button"
                onClick={() => worldSpecInputRef.current?.click()}
                disabled={operationBusy}
                aria-describedby="json-import-status"
              >
                {importKind === 'world' && importState === 'reading'
                  ? 'Reading World Spec…'
                  : importKind === 'world' && importState === 'generating'
                    ? 'Generating imported world…'
                    : 'Load World Spec JSON'}
              </button>
              <button
                className="secondary-action is-ready"
                type="button"
                onClick={() => externalHostAssetRequestInputRef.current?.click()}
                disabled={operationBusy}
                aria-describedby="json-import-status"
              >
                {importKind === 'external-host' && importState === 'reading'
                  ? 'Reading External Host request…'
                  : importKind === 'external-host' && importState === 'generating'
                    ? 'Generating External Host world…'
                    : 'Load External Host Asset Request'}
              </button>
              <button
                className="secondary-action is-ready"
                type="button"
                onClick={exportWorldSpec}
                disabled={hasPackErrors || operationBusy}
              >
                Download World Spec
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={exportPack}
                disabled={exportState === 'building' || hasPackErrors || !currentPackExportCompatible || operationBusy}
              >
                {exportState === 'building'
                  ? 'Building ZIP…'
                  : world?.spec.schemaVersion === ALPHA6_WORLD_SCHEMA_VERSION
                    ? 'Assemble Alpha.6 preview ZIP'
                    : currentPackExportCompatible
                      ? 'Assemble Godot-compatible ZIP'
                      : 'Unsupported World Spec version'}
                <span>↓</span>
              </button>
            </div>
            <div
              id="json-import-status"
              className="import-status"
              aria-live="polite"
              aria-busy={importState !== 'idle'}
            >
              {importState === 'reading' && (
                <p>
                  Reading and validating the selected {importKind === 'external-host' ? 'External Host Asset Request' : 'World Spec'}…
                </p>
              )}
              {importState === 'generating' && <p>Generating the imported spec through the active provider…</p>}
              {importState === 'idle' && importNotice && <p className={importNotice.tone}>{importNotice.message}</p>}
            </div>
            {exportState === 'failed' && <p className="export-error">Pack assembly failed. Check the browser console.</p>}
          </aside>
        </section>

        <section className="first-import" id="godot-quickstart" aria-labelledby="godot-quickstart-title">
          <div className="first-import-heading">
            <div>
              <span className="step">04</span>
              <p className="eyebrow">Verified first-import path</p>
              <h2 id="godot-quickstart-title">From release ZIP to a Godot scene in 10 minutes.</h2>
            </div>
            <a
              className="text-link"
              href={CURRENT_PUBLIC_RELEASE.releaseUrl}
              target="_blank"
              rel="noreferrer"
            >
              View audited release ↗
            </a>
          </div>

          <div className="first-import-grid">
            <article>
              <span>01</span>
              <h3>Download the starter pack</h3>
              <p>Use the exact executable-free pack for the selected public world, tested by the release workflow.</p>
              <a className="onboarding-action is-primary" href={selectedPublicPack.url}>
                Download asset ZIP <span aria-hidden="true">↓</span>
              </a>
            </article>
            <article>
              <span>02</span>
              <h3>Install the official importer</h3>
              <p>Extract the separate MIT-licensed addon into your Godot project, then enable the plugin.</p>
              <a className="onboarding-action" href={CURRENT_PUBLIC_RELEASE.godotImporter.url}>
                Download importer <span aria-hidden="true">↓</span>
              </a>
            </article>
            <article>
              <span>03</span>
              <h3>Import and report the result</h3>
              <p>Follow the timed guide, open the generated scene, and share success or an exact error.</p>
              <div className="onboarding-links">
                <a
                  className="onboarding-action"
                  href={CURRENT_PUBLIC_RELEASE.firstImportGuideUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open 10-minute guide ↗
                </a>
                <a
                  className="onboarding-action"
                  href={CURRENT_PUBLIC_RELEASE.feedbackFormUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Share first-import feedback ↗
                </a>
              </div>
            </article>
          </div>

          <div className="integrity-note">
            <span>{selectedPublicPack.id} {CURRENT_PUBLIC_RELEASE.tag} SHA-256</span>
            <code>{selectedPublicPack.sha256}</code>
            <small>Hashes prove downloaded bytes match the audited attachment; install executable code only from the official repository.</small>
          </div>
        </section>

        <section className="principles">
          <article><span>01</span><h2>World-level coherence</h2><p>One versioned spec controls the whole pack—not a folder of unrelated prompts.</p></article>
          <article><span>02</span><h2>Engine-validated output</h2><p>PNG + JSON stays portable; the official importer is tested on Godot 4.3 and 4.7.</p></article>
          <article><span>03</span><h2>Traceable by default</h2><p>Seeds, providers, licenses, versions, and transformations travel with every pack.</p></article>
        </section>
      </main>

      <footer>
        <span>Mapsoo Worldsmith · MIT source</span>
        <span>Don’t prompt for pictures. Build playable worlds.</span>
      </footer>
    </div>
  );
}
