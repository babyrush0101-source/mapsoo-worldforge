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
    expect(markup).toContain('Raspberry Pi 4B');
    expect(markup).toContain('What rules, beliefs, history, or central tension');
    expect(markup).toContain('Which terrain types must shape the playable space?');
    expect(markup).toContain('Who lives here');
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
    const facts = {
      premise: 'A riverside courier settlement.',
      worldview: 'Delivery routes reconnect districts after seasonal floods.',
      terrain: 'Riverbanks, bridges and a hill.',
      geography: 'Ferry spawn, market route and hill gate exit.',
      culture: 'Growers, ferry workers and timber homes.',
      ecology: 'Reeds, willow trees, birds and morning mist.',
      mood: 'Hopeful, calm and readable.',
      art_direction: 'Warm pixels and teal water.',
      traversal: 'Follow the ferry route through the market to the gate.',
      landmarks: 'Old ferry, market waterwheel, hill gate.',
    } as const;
    const first = buildWorldCreationStyleSample('topdown-farm', facts);
    const second = buildWorldCreationStyleSample('topdown-farm', facts);
    const side = buildWorldCreationStyleSample('side-platformer', facts);

    expect(first.pngBytes).toEqual(second.pngBytes);
    expect(first.pngBytes).not.toEqual(side.pngBytes);
    expect(first.pngBytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(first.metrics.distinctColorBuckets).toBeGreaterThan(10);
  });
});
