import { describe, expect, it } from 'vitest';

import {
  buildGodotCaptureArguments,
  parseGodotCaptureSentinel,
  parseRuntimeCandidateTechnicalReviewArguments,
} from '../../scripts/run-runtime-candidate-technical-review';

const REQUIRED = Object.freeze([
  '--candidate', 'private/candidate',
  '--layout', 'private/world-layout-plan.json',
  '--godot-console', 'private/Godot_console.exe',
  '--godot-version', '4.3',
  '--review-id', 'side-platformer-runtime-review',
  '--out', 'private/review-output',
] as const);

function sentinel(
  mode = 'normal',
  output = 'C:/private capture/rendered-world.png',
): string {
  return [
    `WORLD_ART_RUNTIME_OVERLAY_CAPTURE_OK profile=side-platformer mode=${mode}`,
    `layout_sha256=${'a'.repeat(64)}`,
    'overlay_id=world-art-runtime-overlay-1234567890abcdef',
    `render_sha256=${'b'.repeat(64)}`,
    'route_nodes=7 terrain=4 landmarks=3 hazards=1 characters=1',
    `animation=idle output=${output}`,
  ].join(' ');
}

describe('runtime-candidate technical review CLI', () => {
  it('parses the six required flags and optional exact local grant', () => {
    expect(parseRuntimeCandidateTechnicalReviewArguments(REQUIRED)).toEqual({
      candidateDirectory: 'private/candidate',
      layoutPath: 'private/world-layout-plan.json',
      godotConsolePath: 'private/Godot_console.exe',
      godotVersion: '4.3',
      reviewId: 'side-platformer-runtime-review',
      outputDirectory: 'private/review-output',
    });
    expect(parseRuntimeCandidateTechnicalReviewArguments([
      ...REQUIRED,
      '--overlay-grant',
      'private/overlay-grant.json',
    ])).toMatchObject({
      overlayGrantPath: 'private/overlay-grant.json',
    });
  });

  it('rejects missing, duplicate, unknown, empty, and malformed arguments', () => {
    const cases: readonly string[][] = [
      REQUIRED.slice(0, -2),
      [...REQUIRED, '--out', 'duplicate'],
      [...REQUIRED, '--unknown', 'value'],
      REQUIRED.map((value) => value === '4.3' ? '4.4' : value),
      REQUIRED.map((value) =>
        value === 'side-platformer-runtime-review' ? 'Not Safe' : value),
      [...REQUIRED.slice(0, -1), '--empty'],
    ];
    for (const args of cases) {
      expect(() => parseRuntimeCandidateTechnicalReviewArguments(args)).toThrow();
    }
  });

  it('parses exactly one strongly bound Godot sentinel', () => {
    const parsed = parseGodotCaptureSentinel(sentinel(), 'normal');
    expect(parsed).toMatchObject({
      profile: 'side-platformer',
      mode: 'normal',
      layout_sha256: 'a'.repeat(64),
      overlay_id: 'world-art-runtime-overlay-1234567890abcdef',
      render_sha256: 'b'.repeat(64),
      route_nodes: 7,
      terrain: 4,
      landmarks: 3,
      hazards: 1,
      characters: 1,
      animation: 'idle',
      output: 'C:/private capture/rendered-world.png',
    });
    expect(() => parseGodotCaptureSentinel(
      `${sentinel()}\n${sentinel()}`,
      'normal',
    )).toThrow(/exactly one/u);
    expect(() => parseGodotCaptureSentinel(sentinel('navigation'), 'normal'))
      .toThrow(/mode/u);
    expect(() => parseGodotCaptureSentinel(
      sentinel().replace('terrain=4', 'terrain=-1'),
      'normal',
    )).toThrow();
  });

  it('builds shell-free fixed Godot capture arguments for images and AVI modes', () => {
    const image = buildGodotCaptureArguments({
      mode: 'normal',
      profile: 'topdown-farm',
      layoutPath: 'C:/tmp/world-layout-plan.json',
      overlayManifestPath: 'C:/tmp/world-art-runtime-overlay.json',
      outputPath: 'C:/tmp/capture.png',
    });
    expect(image).toContain('640x480');
    expect(image).toContain('--display-driver');
    expect(image).toContain('--audio-driver');
    expect(image).not.toContain('--headless');
    expect(image).toContain('res://tests/capture_world_art_runtime_overlay.gd');
    expect(image).toContain('--evidence-mode=normal');
    expect(image).not.toContain('--write-movie');

    const movie = buildGodotCaptureArguments({
      mode: 'spawn-exit',
      profile: 'side-platformer',
      layoutPath: 'C:/tmp/world-layout-plan.json',
      overlayManifestPath: 'C:/tmp/world-art-runtime-overlay.json',
      outputPath: 'C:/tmp/frame.png',
      moviePath: 'C:/tmp/route.avi',
      overlayGrantPath: 'C:/tmp/grant.json',
    });
    expect(movie).toContain('--write-movie');
    expect(movie).toContain('C:/tmp/route.avi');
    expect(movie).toContain('--overlay-grant=C:/tmp/grant.json');
  });
});
