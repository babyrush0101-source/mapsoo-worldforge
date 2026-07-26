import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  WorldCreationDialogue,
  buildWorldCreationStyleSample,
} from './WorldCreationDialogue';

describe('world creation dialogue UI', () => {
  it('renders the seven-stage guided workflow and all four neutral profiles', () => {
    const markup = renderToStaticMarkup(createElement(WorldCreationDialogue));
    expect(markup).toContain('Build the world through a short conversation.');
    expect(markup).toContain('World brief');
    expect(markup).toContain('Art direction');
    expect(markup).toContain('Map layout');
    expect(markup).toContain('Style sample');
    expect(markup).toContain('Complete assets');
    expect(markup).toContain('Godot map');
    expect(markup).toContain('Enter the world');
    expect(markup).toContain('Top-down farm');
    expect(markup).toContain('Side platformer');
    expect(markup).toContain('Isometric action');
    expect(markup).toContain('Layered-depth 2D');
    expect(markup).toContain('Nothing is frozen until you explicitly approve it.');
  });

  it('accepts an asset handoff callback without exposing private integration data', () => {
    const markup = renderToStaticMarkup(createElement(WorldCreationDialogue, {
      onReadyForAssets: () => undefined,
    }));
    expect(markup).toContain('deterministic checkpoints');
    expect(markup).not.toContain('external-host');
  });

  it('builds a deterministic visual sample from the first three confirmed decisions', () => {
    const answers = {
      'world-brief': 'A riverside courier settlement.',
      'art-direction': 'Warm pixels and teal water.',
      'map-layout': 'Ferry spawn, market landmark, hill gate exit.',
    } as const;
    const first = buildWorldCreationStyleSample('topdown-farm', answers);
    const second = buildWorldCreationStyleSample('topdown-farm', answers);
    const side = buildWorldCreationStyleSample('side-platformer', answers);

    expect(first.pngBytes).toEqual(second.pngBytes);
    expect(first.pngBytes).not.toEqual(side.pngBytes);
    expect(first.pngBytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(first.metrics.distinctColorBuckets).toBeGreaterThan(10);
  });
});
