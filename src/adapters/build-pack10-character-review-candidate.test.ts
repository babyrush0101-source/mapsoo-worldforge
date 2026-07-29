import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import committedManifest from '../../tests/fixtures/pack10-public/mapsoo.manifest.json';
import { encodeRgbaPng } from './canvas/encode-png';
import {
  Pack10CharacterReviewCandidateError,
  buildPack10CharacterReviewCandidate,
  type Pack10CharacterReviewArtifact,
} from './build-pack10-character-review-candidate';
import type {
  LayeredDepthCharacterProjectionRecord,
} from './project-layered-depth-production-character';
import type {
  ProductionArtGenerationEvidence,
} from './normalize-production-art-png';
import {
  LAYERED_DEPTH_DIRECTIONS,
  LAYERED_DEPTH_NPC_ACTIONS,
  LAYERED_DEPTH_PLAYER_ACTIONS,
} from '../core/layered-depth-asset-bundle';
import {
  validatePack10Manifest,
  type Pack10Manifest,
} from '../core/pack-manifest-1.0';

// @ts-expect-error The public privacy helper is intentionally plain ESM.
import { containsPrivateConsumerToken } from '../../scripts/lib/private-consumer-boundary.mjs';

const ZIP_DATE = new Date(Date.UTC(1980, 0, 1));
type CharacterId = 'player' | 'npc';
type DeepMutable<T> =
  T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function solidPng(width: number, height: number, marker: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < rgba.byteLength; offset += 4) {
    rgba.set([40 + marker % 150, 70, 100, 255], offset);
  }
  return encodeRgbaPng(width, height, rgba);
}

function baseRasterSize(manifest: Pack10Manifest, path: string): readonly [number, number] {
  if (manifest.planes.some((plane) => plane.path === path)) return [320, 180];
  const preview = manifest.roles.find(({ role }) => role === 'world.preview');
  if (preview?.binding.kind === 'file' && preview.binding.path === path) return [320, 180];
  const atlas = manifest.atlases.find((candidate) => candidate.path === path);
  if (!atlas) return [1, 1];
  let width = atlas.cell_size[0];
  let height = atlas.cell_size[1];
  for (const role of manifest.roles) {
    if (role.binding.kind === 'atlas-region' && role.binding.atlas === atlas.id) {
      width = Math.max(width, role.binding.region.x + role.binding.region.width);
      height = Math.max(height, role.binding.region.y + role.binding.region.height);
    }
  }
  for (const character of manifest.characters) {
    if (character.atlas !== path) continue;
    for (const frame of character.clips.flatMap(({ frames }) => frames)) {
      width = Math.max(width, frame.x + character.frame_size[0]);
      height = Math.max(height, frame.y + character.frame_size[1]);
    }
  }
  return [width, height];
}

function baseJson(path: string): Uint8Array {
  const encoder = new TextEncoder();
  if (path === 'runtime/scene.json') {
    return encoder.encode(`${JSON.stringify({
      schema_version: 'fixture-scene/1.0',
      synthetic: true,
      canvas: { width: 320, height: 180 },
      spawn: { x: 32, y: 132 },
      placements: [
        { id: 'entry', role: 'structure.entrance', x: 32, y: 132 },
        { id: 'goal', role: 'structure.exit', x: 288, y: 132 },
        { id: 'player', role: 'character.player.atlas', x: 48, y: 132 },
        { id: 'guide', role: 'character.npc.atlas', x: 208, y: 132 },
      ],
    }, null, 2)}\n`);
  }
  if (path === 'runtime/collision.json') {
    return encoder.encode(`${JSON.stringify({
      schema_version: 'fixture-collision/1.0',
      synthetic: true,
      bounds: { x: 0, y: 0, width: 320, height: 180 },
      solids: [{ id: 'ground', x: 0, y: 148, width: 320, height: 32 }],
    }, null, 2)}\n`);
  }
  if (path === 'runtime/navigation.json') {
    return encoder.encode(`${JSON.stringify({
      schema_version: 'fixture-navigation/1.0',
      synthetic: true,
      nodes: [
        { id: 'spawn', x: 32, y: 132 },
        { id: 'exit', x: 288, y: 132 },
      ],
      edges: [{ from: 'spawn', to: 'exit' }],
    }, null, 2)}\n`);
  }
  return encoder.encode(`${JSON.stringify({
    schema_version: 'fixture-provenance/1.0',
    synthetic: true,
    generative_ai: false,
  }, null, 2)}\n`);
}

async function basePack(extra?: { readonly path: string; readonly bytes: Uint8Array }): Promise<Uint8Array> {
  const manifest = structuredClone(committedManifest) as unknown as DeepMutable<Pack10Manifest>;
  const payloads = new Map<string, Uint8Array>();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const record = manifest.files[index];
    let bytes: Uint8Array;
    if (record.media_type === 'image/png') {
      const [width, height] = baseRasterSize(manifest, record.path);
      bytes = solidPng(width, height, index);
    } else if (record.media_type === 'text/markdown') {
      bytes = new TextEncoder().encode('# Synthetic fixture\n\nPublic test fixture asset notice.\n');
    } else {
      bytes = baseJson(record.path);
    }
    payloads.set(record.path, bytes);
    record.bytes = bytes.byteLength;
    record.sha256 = await sha256(bytes);
  }
  expect(validatePack10Manifest(manifest)).toEqual([]);
  const archive = new JSZip();
  const updatedManifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  archive.file('mapsoo.manifest.json', updatedManifestBytes, {
    binary: true,
    createFolders: false,
    date: ZIP_DATE,
  });
  for (const record of manifest.files) {
    archive.file(
      record.path,
      payloads.get(record.path) as Uint8Array,
      { binary: true, createFolders: false, date: ZIP_DATE },
    );
  }
  if (extra) {
    archive.file(extra.path, extra.bytes, {
      binary: true,
      createFolders: false,
      date: ZIP_DATE,
    });
  }
  return archive.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
}

function runtimeAtlas(poseCount: number, duplicate = false): Uint8Array {
  const width = 384;
  const height = Math.ceil(poseCount / 8) * 72;
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < poseCount; index += 1) {
    const identity = duplicate && index === 1 ? 0 : index;
    const color = [
      55 + identity * 5,
      25 + identity * 3,
      75 + identity * 4,
      255,
    ] as const;
    const originX = (index % 8) * 48;
    const originY = Math.floor(index / 8) * 72;
    for (let y = 20; y < 68; y += 1) {
      for (let x = 14; x < 34; x += 1) {
        rgba.set(color, ((originY + y) * width + originX + x) * 4);
      }
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

function characterRecord(id: CharacterId): Pack10Manifest['characters'][number] {
  const actions = id === 'player'
    ? LAYERED_DEPTH_PLAYER_ACTIONS
    : LAYERED_DEPTH_NPC_ACTIONS;
  let poseIndex = 0;
  return {
    id,
    atlas: `atlases/${id}.png`,
    frame_size: [48, 72],
    pivot: [24, 67],
    clips: actions.flatMap((action) =>
      LAYERED_DEPTH_DIRECTIONS.map((direction) => ({
        id: `${action}.${direction}`,
        action,
        direction,
        frames: [0, 1].map(() => {
          const index = poseIndex;
          poseIndex += 1;
          return {
            x: (index % 8) * 48,
            y: Math.floor(index / 8) * 72,
            duration_ms: action === 'idle' ? 250 : 150,
            provenance: 'independent-generated-pose' as const,
          };
        }),
      }))),
  };
}

async function artifact(
  id: CharacterId,
  options: { readonly duplicate?: boolean; readonly mismatchedEvidence?: boolean } = {},
): Promise<Pack10CharacterReviewArtifact> {
  const player = id === 'player';
  const poseCount = player ? 32 : 16;
  const atlasPngBytes = runtimeAtlas(poseCount, options.duplicate);
  const atlasSha256 = await sha256(atlasPngBytes);
  const normalizedSha256 = (player ? 'b' : 'c').repeat(64);
  const taskId = `character-character-${id}-atlas`;
  const projection: LayeredDepthCharacterProjectionRecord = {
    schema_version: '1.0.0',
    document_type: 'production-character-atlas-projection',
    profile: 'layered-depth-2d',
    plan_id: 'layered-depth-2d-production-art-v1',
    task_id: taskId,
    role: `character.${id}.atlas`,
    source: {
      normalized_sha256: normalizedSha256,
      width: 1024,
      height: 1152,
      cell_size: [128, 192],
      pivot: [64, 180],
    },
    atlas: {
      path: `atlases/${id}.png`,
      bytes: atlasPngBytes.byteLength,
      sha256: atlasSha256,
      width: 384,
      height: player ? 288 : 144,
      frame_size: [48, 72],
      pivot: [24, 67],
    },
    checks: {
      pose_count: poseCount,
      distinct_pose_count: poseCount,
      transparent_padding_checked: true,
      foot_anchor_range_y: [62, 68],
      exact_duplicates_rejected: true,
      mirrored_duplicates_rejected: true,
    },
    human_review: 'required',
  };
  const generationEvidence: ProductionArtGenerationEvidence = {
    schema_version: '1.0.0',
    document_type: 'production-art-generation-evidence',
    provider: {
      id: 'fixture-image-provider',
      version: '1.0.0',
      documentation_url: 'https://example.com/fixture-provider',
      execution: 'remote',
      provenance: 'generative-ai',
      determinism: 'best-effort',
    },
    plan_id: projection.plan_id,
    profile: 'layered-depth-2d',
    task_id: projection.task_id,
    model: 'fixture-image-model',
    workflow: 'image-edit',
    source: {
      media_type: 'image/png',
      bytes: 4096,
      sha256: (player ? 'd' : 'e').repeat(64),
      width: 1024,
      height: 1152,
    },
    normalized: {
      media_type: 'image/png',
      bytes: 4096,
      sha256: options.mismatchedEvidence ? 'f'.repeat(64) : normalizedSha256,
      width: 1024,
      height: 1152,
      alpha_policy: 'straight-alpha',
    },
    postprocess: {
      resize: 'nearest-neighbor-v1',
      alpha_extraction: 'edge-connected-green-chroma-v1',
      transparent_rgb_zeroed: true,
      mapped_grid_cells_checked: true,
    },
    human_review: 'required',
  };
  return {
    projection,
    character: characterRecord(id),
    generationEvidence,
    atlasPngBytes,
  };
}

const OPTIONS = Object.freeze({
  packId: 'neutral-character-review-world',
  title: 'Neutral Character Review World',
  version: '1.0.0-review.1',
  createdAt: '2026-07-27T18:00:00.000Z',
});

describe('Pack 1.0 model-character review candidate builder', () => {
  it('builds one deterministic, privacy-minimized internal-review ZIP', async () => {
    const [base, player, npc] = await Promise.all([
      basePack(),
      artifact('player'),
      artifact('npc'),
    ]);
    const [first, second] = await Promise.all([
      buildPack10CharacterReviewCandidate(base, player, npc, OPTIONS),
      buildPack10CharacterReviewCandidate(base, player, npc, OPTIONS),
    ]);

    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(await sha256(first.bytes));
    expect(first.manifest).toMatchObject({
      distribution: 'internal-review',
      review: {
        human_art: 'pending',
        rights: 'pending',
        runtime: 'pending',
        raspberry_pi: 'pending',
      },
      license: {
        output: {
          id: 'LicenseRef-UNRELEASED',
          permits_redistribution: false,
          permits_commercial_use: false,
        },
      },
      provenance: {
        output_provenance: 'hybrid',
        contains_generative_ai: true,
        model_provider: 'fixture-image-provider',
        model: 'fixture-image-model',
        human_curated: false,
      },
    });
    expect(validatePack10Manifest(first.manifest)).toEqual([]);
    expect(first.manifest.characters[0].clips).toHaveLength(16);
    expect(first.manifest.characters[1].clips).toHaveLength(8);
    expect(first.manifest.characters.flatMap(({ clips }) => clips)
      .every(({ frames }) => frames.length === 2
        && frames.every(({ provenance }) => provenance === 'independent-generated-pose')))
      .toBe(true);

    const archive = await JSZip.loadAsync(first.bytes, { checkCRC32: true });
    const paths = Object.values(archive.files).map(({ name }) => name).sort();
    expect(paths).toEqual([
      'mapsoo.manifest.json',
      ...first.manifest.files.map(({ path }) => path),
    ].sort());
    expect(paths).toContain('provenance/player-projection.json');
    expect(paths).toContain('provenance/npc-projection.json');
    expect(paths.some((path) => path.includes('reference') || path.includes('prompt'))).toBe(false);
    expect(paths.some((path) => path.includes('evidence'))).toBe(false);
    const allText = await Promise.all(Object.values(archive.files)
      .filter(({ name }) => !name.endsWith('.png'))
      .map((entry) => entry.async('text')));
    expect(containsPrivateConsumerToken(allText.join('\n'))).toBe(false);
    expect(allText.join('\n')).not.toMatch(
      /@[a-z0-9.-]+\.[a-z]{2,}|\b[A-Za-z]:[\\/]|\/(?:Users|home|root|tmp|var)\//i,
    );
  });

  it('rejects a matching-hash atlas that contains duplicated projected frames', async () => {
    const [base, duplicatePlayer, npc] = await Promise.all([
      basePack(),
      artifact('player', { duplicate: true }),
      artifact('npc'),
    ]);
    await expect(buildPack10CharacterReviewCandidate(
      base,
      duplicatePlayer,
      npc,
      OPTIONS,
    )).rejects.toEqual(expect.objectContaining({ code: 'review-pack.integrity' }));
  });

  it('rejects mismatched generation evidence and an unmanifested base file', async () => {
    const [base, unsafeBase, player, mismatchedNpc] = await Promise.all([
      basePack(),
      basePack({ path: 'extra.json', bytes: new TextEncoder().encode('{}') }),
      artifact('player'),
      artifact('npc', { mismatchedEvidence: true }),
    ]);
    await expect(buildPack10CharacterReviewCandidate(
      base,
      player,
      mismatchedNpc,
      OPTIONS,
    )).rejects.toEqual(expect.objectContaining({ code: 'review-pack.invalid-artifact' }));
    await expect(buildPack10CharacterReviewCandidate(
      unsafeBase,
      player,
      await artifact('npc'),
      OPTIONS,
    )).rejects.toBeInstanceOf(Pack10CharacterReviewCandidateError);
  });
});
