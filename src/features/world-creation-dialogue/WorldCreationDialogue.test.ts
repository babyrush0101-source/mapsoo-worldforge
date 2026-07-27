import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  WorldCreationDialogue,
  buildWorldCreationStyleSample,
  fingerprintWorldCreationCheckpoint,
  materializeWorldCreationAssetHandoff,
  parseConfirmedLandmarkLabels,
} from './WorldCreationDialogue';

const FACTS = {
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

const LAYOUT_INTENT = {
  route_shape: 'loop',
  scale: 'standard',
  verticality: 'medium',
  water: 'crossing',
  settlement_density: 'settled',
  hazard_level: 'calm',
  landmark_labels: ['Old ferry', 'Market waterwheel', 'Hill gate'],
} as const;

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

  it('binds every visible structured map choice into the deterministic map checkpoint', async () => {
    const base = {
      profile: 'topdown-farm' as const,
      target: 'raspberry-pi-4b' as const,
      stage: 'map-layout' as const,
      facts: FACTS,
      layoutIntent: LAYOUT_INTENT,
    };
    const first = await fingerprintWorldCreationCheckpoint(base);
    expect(await fingerprintWorldCreationCheckpoint(base)).toBe(first);

    for (const replacement of [
      { route_shape: 'fork-rejoin' as const },
      { scale: 'extended' as const },
      { verticality: 'high' as const },
      { water: 'basin' as const },
      { settlement_density: 'dense' as const },
      { hazard_level: 'dangerous' as const },
      { landmark_labels: ['Old ferry', 'Hill gate'] as const },
    ]) {
      expect(await fingerprintWorldCreationCheckpoint({
        ...base,
        layoutIntent: { ...LAYOUT_INTENT, ...replacement },
      })).not.toBe(first);
    }

    expect(await fingerprintWorldCreationCheckpoint({
      ...base,
      stage: 'art-direction',
      layoutIntent: { ...LAYOUT_INTENT, route_shape: 'direct' },
    })).toBe(await fingerprintWorldCreationCheckpoint({
      ...base,
      stage: 'art-direction',
    }));
  });

  it('creates an immutable browser handoff with the exact confirmed layout intent', () => {
    const handoff = materializeWorldCreationAssetHandoff({
      profile: 'topdown-farm',
      target: 'raspberry-pi-4b',
      facts: FACTS,
      layoutIntent: LAYOUT_INTENT,
      description: 'Public-safe world description.',
      sessionRevision: 4,
      checkpoints: [
        { stage: 'world-brief', snapshotSha256: 'a'.repeat(64) },
        { stage: 'art-direction', snapshotSha256: 'b'.repeat(64) },
        { stage: 'map-layout', snapshotSha256: 'c'.repeat(64) },
        { stage: 'style-sample', snapshotSha256: 'd'.repeat(64) },
      ],
      approvedIntentPreviewSha256: 'e'.repeat(64),
    });

    expect(handoff.layoutIntent).toEqual(LAYOUT_INTENT);
    expect(Object.isFrozen(handoff)).toBe(true);
    expect(Object.isFrozen(handoff.layoutIntent.landmark_labels)).toBe(true);
    expect(() => materializeWorldCreationAssetHandoff({
      ...handoff,
      layoutIntent: { ...LAYOUT_INTENT, landmark_labels: ['Duplicate', 'Duplicate'] },
    })).toThrow('two to four unique landmark labels');
  });

  it('parses two to four public landmark labels without retaining extra prose', () => {
    expect(parseConfirmedLandmarkLabels('Ferry；Market、Gate\nTower;Ignored')).toEqual([
      'Ferry',
      'Market',
      'Gate',
      'Tower',
    ]);
  });

  it('builds a deterministic visual sample from the first three confirmed decisions', () => {
    const first = buildWorldCreationStyleSample('topdown-farm', FACTS);
    const second = buildWorldCreationStyleSample('topdown-farm', FACTS);
    const side = buildWorldCreationStyleSample('side-platformer', FACTS);

    expect(first.pngBytes).toEqual(second.pngBytes);
    expect(first.pngBytes).not.toEqual(side.pngBytes);
    expect(first.pngBytes.slice(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(first.metrics.distinctColorBuckets).toBeGreaterThan(10);
  });
});
