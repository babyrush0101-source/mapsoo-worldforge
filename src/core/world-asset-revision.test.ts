import { describe, expect, it } from 'vitest';

import {
  WorldAssetRevisionError,
  createWorldAssetRevision,
  freezeWorldAssetRevision,
} from './world-asset-revision';

function input() {
  return {
    worldId: 'river-world',
    profile: 'side-platformer' as const,
    packSchemaVersion: '0.7.0',
    packVersion: '0.1.0-alpha.10',
    packFilename: 'mapsoo-river-world-pack-0.7.zip',
    packBytes: Uint8Array.from([80, 75, 3, 4, 1, 2, 3, 4]),
    manifest: {
      schema_version: '0.7.0',
      pack: { id: 'river-world', version: '0.1.0-alpha.10' },
      files: [{ path: 'runtime/scene.json', sha256: 'a'.repeat(64) }],
    },
    requestFingerprintSha256: 'b'.repeat(64),
    dialogueBindingSha256: 'c'.repeat(64),
    minimumGodotVersion: '4.3',
    importerMinimumVersion: '0.1.0-alpha.10',
  };
}

describe('world asset revision', () => {
  it('binds the exact pack, manifest, request, dialogue and generated Godot scene', async () => {
    const first = await createWorldAssetRevision(input());
    const second = await createWorldAssetRevision(input());

    expect(second).toEqual(first);
    expect(first.pack_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.revision_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.godot).toEqual({
      minimum_version: '4.3',
      importer_id: 'mapsoo_importer',
      importer_minimum_version: '0.1.0-alpha.10',
      scene_path: 'res://mapsoo_imports/river-world/river-world.world.tscn',
    });

    const differentPack = await createWorldAssetRevision({
      ...input(),
      packBytes: Uint8Array.from([80, 75, 3, 4, 1, 2, 3, 5]),
    });
    const differentDialogue = await createWorldAssetRevision({
      ...input(),
      dialogueBindingSha256: 'd'.repeat(64),
    });
    expect(differentPack.revision_sha256).not.toBe(first.revision_sha256);
    expect(differentDialogue.revision_sha256).not.toBe(first.revision_sha256);
  });

  it('freezes only the revision the user explicitly approved', async () => {
    const revision = await createWorldAssetRevision(input());
    const launch = await freezeWorldAssetRevision(revision, revision.revision_sha256);

    expect(launch).toEqual(expect.objectContaining({
      status: 'frozen',
      world_id: 'river-world',
      profile: 'side-platformer',
      asset_revision_sha256: revision.revision_sha256,
      dialogue_binding_sha256: 'c'.repeat(64),
      scene_path: revision.godot.scene_path,
    }));
    expect(launch.launch_binding_sha256).toMatch(/^[a-f0-9]{64}$/);

    await expect(freezeWorldAssetRevision(revision, 'f'.repeat(64))).rejects.toThrow(
      'Approval does not match the generated asset revision.',
    );
  });

  it('rejects a mutated revision even if its old revision hash is presented', async () => {
    const revision = await createWorldAssetRevision(input());
    const mutated = {
      ...revision,
      pack_sha256: 'e'.repeat(64),
    };
    await expect(freezeWorldAssetRevision(mutated, revision.revision_sha256)).rejects.toBeInstanceOf(
      WorldAssetRevisionError,
    );
  });
});
