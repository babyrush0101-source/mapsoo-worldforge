import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import packSchema from '../../schemas/mapsoo-pack-1.0.schema.json';

const PLANE_DEFINITIONS = [
  ['sky', 'background.sky', 'layers/sky.png', 'mix'],
  ['far', 'background.far', 'layers/far.png', 'mix'],
  ['mid', 'background.mid', 'layers/mid.png', 'mix'],
  ['depth-fog', 'background.depth-fog', 'layers/depth-fog.png', 'mix'],
  ['near', 'near.overlay', 'layers/near.png', 'mix'],
  ['ambient-light', 'lighting.ambient', 'layers/ambient.png', 'multiply'],
  ['local-light', 'lighting.local', 'layers/local.png', 'add'],
  ['foreground', 'foreground.overlay', 'layers/foreground.png', 'mix'],
] as const;

function internalReviewManifest() {
  const layerFiles = PLANE_DEFINITIONS.map(([, , path]) => path);
  const supportFiles = [
    'atlases/environment.png',
    'atlases/characters.png',
    'runtime/scene.json',
    'runtime/collision.json',
    'runtime/navigation.json',
    'license-assets.md',
  ];
  return {
    schema_version: '1.0.0-draft.1',
    pack: {
      id: 'neutral-layered-candidate',
      title: 'Neutral layered candidate',
      version: '0.1.0-alpha.13',
      generator: { name: 'Mapsoo Worldsmith', version: '0.1.0-alpha.13' },
      created_at: '2026-07-26T15:00:00.000Z',
    },
    profile: 'layered-depth-2d',
    distribution: 'internal-review',
    review: {
      human_art: 'pending',
      rights: 'pending',
      runtime: 'pass',
      raspberry_pi: 'pending',
    },
    compatibility: {
      godot_min: '4.3',
      projection: 'layered-depth-stage',
      art_style: 'pixel_art',
      importer: { id: 'mapsoo_importer', min_version: '0.1.0-alpha.13' },
    },
    planes: PLANE_DEFINITIONS.map(([id, role, path, blend]) => ({
      id,
      role,
      path,
      layer: id,
      blend,
    })),
    atlases: [
      { id: 'environment', path: 'atlases/environment.png', cell_size: [96, 96] },
      { id: 'characters', path: 'atlases/characters.png', cell_size: [48, 72] },
    ],
    roles: Array.from({ length: 36 }, (_, index) => ({
      role: `fixture.role-${index}`,
      binding: {
        kind: 'atlas-region',
        atlas: 'environment',
        region: { x: index * 4, y: 0, width: 4, height: 4 },
      },
    })),
    characters: ['player', 'npc'].map((id, index) => ({
      id,
      atlas: 'atlases/characters.png',
      frame_size: [48, 72],
      pivot: [24, 67],
      clips: [{
        id: 'idle.left',
        action: 'idle',
        direction: 'left',
        frames: [
          {
            x: index * 96,
            y: 0,
            duration_ms: 160,
            provenance: 'independent-generated-pose',
          },
          {
            x: index * 96 + 48,
            y: 0,
            duration_ms: 160,
            provenance: 'declared-synthetic-variant',
          },
        ],
      }],
    })),
    runtime: {
      scene: { path: 'runtime/scene.json' },
      collision: { path: 'runtime/collision.json' },
      navigation: { path: 'runtime/navigation.json' },
      spawn: { x: 112, y: 286 },
    },
    files: [...layerFiles, ...supportFiles].map((path) => ({
      path,
      media_type: path.endsWith('.png')
        ? 'image/png'
        : path.endsWith('.md')
          ? 'text/markdown'
          : 'application/json',
      bytes: 1,
      sha256: 'a'.repeat(64),
    })),
    license: {
      output: {
        id: 'LicenseRef-UNRELEASED',
        notice_path: 'license-assets.md',
        permits_redistribution: false,
        permits_commercial_use: false,
      },
    },
    provenance: {
      output_provenance: 'generative-ai',
      contains_generative_ai: true,
      model_provider: 'provider-not-published',
      model: 'model-not-published',
      human_curated: false,
      source_manifest_hashes: ['b'.repeat(64)],
    },
    reference_policy: {
      embedded: false,
      original_references_excluded: true,
      raw_prompts_excluded: true,
      only_one_way_audit_hashes_retained: true,
    },
  };
}

function validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(packSchema);
}

describe('Pack 1.0 licensed-production draft', () => {
  it('accepts an honest non-redistributable internal-review candidate', () => {
    const validate = validator();
    expect(validate(internalReviewManifest()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('requires human, rights and runtime approval plus redistribution for public output', () => {
    const validate = validator();
    const unsafe = { ...internalReviewManifest(), distribution: 'public' };
    expect(validate(unsafe)).toBe(false);

    const publishable = {
      ...internalReviewManifest(),
      distribution: 'public',
      review: {
        human_art: 'pass',
        rights: 'pass',
        runtime: 'pass',
        raspberry_pi: 'pass',
      },
      license: {
        output: {
          id: 'CC-BY-4.0',
          notice_path: 'license-assets.md',
          permits_redistribution: true,
          permits_commercial_use: true,
        },
      },
    };
    expect(validate(publishable), JSON.stringify(validate.errors)).toBe(true);

    const restrictedPublic = structuredClone(publishable);
    restrictedPublic.license.output.permits_commercial_use = false;
    expect(validate(restrictedPublic)).toBe(false);
  });

  it('requires approved, non-redistributable rights for private output', () => {
    const validate = validator();
    const privateCandidate = internalReviewManifest();
    privateCandidate.distribution = 'private';
    privateCandidate.review = {
      human_art: 'pass',
      rights: 'pass',
      runtime: 'pass',
      raspberry_pi: 'pending',
    };
    privateCandidate.license.output = {
      id: 'LicenseRef-Private-Use',
      notice_path: 'license-assets.md',
      permits_redistribution: false,
      permits_commercial_use: true,
    };
    expect(validate(privateCandidate), JSON.stringify(validate.errors)).toBe(true);

    privateCandidate.review.rights = 'pending';
    expect(validate(privateCandidate)).toBe(false);
  });

  it('rejects embedded reference paths and one-frame compatibility animation', () => {
    const validate = validator();
    const referenceLeak = internalReviewManifest();
    referenceLeak.files.push({
      path: 'references/character.png',
      media_type: 'image/png',
      bytes: 1,
      sha256: 'a'.repeat(64),
    });
    expect(validate(referenceLeak)).toBe(false);

    const oneFrame = internalReviewManifest();
    oneFrame.characters[0].clips[0].frames.pop();
    expect(validate(oneFrame)).toBe(false);
  });
});
