import { WORLD_ASSET_PROFILES } from '../../src/core/asset-profile';
import {
  PROFILE_VISUAL_ACCEPTANCE,
  assertProfileReferenceScene,
  renderProfileReferenceScene,
} from '../../src/adapters/canvas/render-profile-reference-scene';

function pngUrl(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }));
}

async function run(): Promise<void> {
  const grid = document.querySelector<HTMLElement>('#profile-grid');
  const result = document.querySelector<HTMLPreElement>('#result');
  const error = document.querySelector<HTMLPreElement>('#error');
  if (!grid || !result || !error) throw new Error('Profile art validation markup is incomplete.');
  const urls: string[] = [];
  try {
    const rows = WORLD_ASSET_PROFILES.map((profile) => {
      const contract = PROFILE_VISUAL_ACCEPTANCE[profile];
      const scene = renderProfileReferenceScene(profile);
      assertProfileReferenceScene(scene);
      const url = pngUrl(scene.pngBytes);
      urls.push(url);
      const article = document.createElement('article');
      const statusLabel = contract.status === 'implemented' ? 'Pipeline ready · baseline art' : 'Visual prototype';
      article.dataset.profile = profile;
      article.innerHTML = `
        <div class="visual"><img src="${url}" alt="${contract.label} deterministic visual baseline"></div>
        <div class="copy">
          <div class="title-row">
            <h2>${contract.label}</h2>
            <span class="status ${contract.status === 'visual-prototype' ? 'prototype' : ''}">${statusLabel}</span>
          </div>
          <p class="camera">${contract.cameraGrammar}</p>
          <dl>
            <div><dt>Color groups</dt><dd>${scene.metrics.distinctColorBuckets}</dd></div>
            <div><dt>Value range</dt><dd>${scene.metrics.luminanceRange}</dd></div>
            <div><dt>Edge density</dt><dd>${scene.metrics.edgeDensity}</dd></div>
          </dl>
          <p class="layers">Required planes: ${contract.requiredLayers.join(' · ')}</p>
        </div>
      `;
      grid.append(article);
      return {
        profile,
        status: contract.status,
        width: scene.width,
        height: scene.height,
        pngBytes: scene.pngBytes.byteLength,
        metrics: scene.metrics,
      };
    });
    await Promise.all([...grid.querySelectorAll('img')].map((image) => image.decode()));
    result.dataset.count = String(rows.length);
    result.textContent = JSON.stringify(rows);
    document.documentElement.dataset.state = 'ready';
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
    document.documentElement.dataset.state = 'failed';
  }
  window.addEventListener('pagehide', () => urls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
}

void run();
