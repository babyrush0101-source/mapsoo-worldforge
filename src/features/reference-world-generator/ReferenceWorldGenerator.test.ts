import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ReferenceWorldGenerator } from './ReferenceWorldGenerator';

describe('reference world generator UI', () => {
  it('renders four complete source-pack paths', () => {
    const markup = renderToStaticMarkup(createElement(ReferenceWorldGenerator, null));
    expect(markup).toContain('Environment style');
    expect(markup).toContain('Character reference');
    expect(markup).toContain('allow generative adaptation, redistribution, and CC0 dedication');
    expect(markup).toContain('World ID and seed are public');
    expect(markup).toContain('Generate complete farm pack');
    expect(markup).toContain('Side platformer — Alpha10 pipeline / baseline art');
    expect(markup).toContain('Isometric action — Alpha11 pipeline / baseline art');
    expect(markup).toContain('Layered-depth 2D — Alpha12 pipeline / baseline art');
    expect(markup).not.toContain('value="isometric-action" disabled=""');
    expect(markup).not.toContain('value="layered-depth-2d" disabled=""');
    expect(markup).toContain('Godot 4.3+ importer verified');
    expect(markup).toContain('No reference images embedded');
    expect(markup).not.toContain('private/');
  });

  it('renders the Alpha10 side source-pack path without claiming a finished Godot importer', () => {
    const markup = renderToStaticMarkup(createElement(ReferenceWorldGenerator, { initialProfile: 'side-platformer' }));
    expect(markup).toContain('Generate complete side-platformer pack');
    expect(markup).toContain('Pack 0.7');
    expect(markup).toContain('Alpha10 candidate');
    expect(markup).toContain('Godot importer candidate');
    expect(markup).toContain('Four profiles generate complete source packs');
    expect(markup).toContain('replaceable engineering art');
    expect(markup).not.toContain('Side platformer is implemented end to end');
  });

  it('renders Alpha11 as a complete source pack with verified candidate importer support', () => {
    const markup = renderToStaticMarkup(createElement(ReferenceWorldGenerator, { initialProfile: 'isometric-action' }));
    expect(markup).toContain('Generate complete isometric action pack');
    expect(markup).toContain('Pack 0.8');
    expect(markup).toContain('Alpha11 candidate');
    expect(markup).toContain('Godot 4.3 / 4.7 importer verified');
    expect(markup).toContain('Four profiles generate complete source packs');
  });

  it('renders Alpha12 layered depth as a complete source pack', () => {
    const markup = renderToStaticMarkup(createElement(ReferenceWorldGenerator, { initialProfile: 'layered-depth-2d' }));
    expect(markup).toContain('Generate complete layered-depth pack');
    expect(markup).toContain('Pack 0.9');
    expect(markup).toContain('Alpha12 candidate');
    expect(markup).toContain('Seven depth planes');
  });
});
