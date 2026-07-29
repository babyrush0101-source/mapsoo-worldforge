import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import receiptSchema
  from '../../schemas/mapsoo-world-delivery-batch-receipt-1.0.schema.json';
import { encodeRgbaPng } from '../adapters/canvas/encode-png';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
} from '../core/confirmed-world-creation-intake';
import type { WorldAssetProfile } from '../core/asset-profile';
import { prepareWorldDeliveryBatch } from './world-delivery-batch';

const roots: string[] = [];
const COMPLETED_AT = '2026-07-29T12:00:00.000Z';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function png(marker: number): Uint8Array {
  return encodeRgbaPng(2, 2, Uint8Array.from([
    marker, 40, 80, 255,
    90, marker, 120, 255,
    140, 160, marker, 255,
    marker, marker, marker, 255,
  ]));
}

async function writeWorldFixture(
  root: string,
  id: string,
  profile: WorldAssetProfile,
): Promise<ConfirmedWorldCreationIntake> {
  const referenceRoot = resolve(root, 'references', id);
  const referenceDirectory = resolve(referenceRoot, 'references');
  await mkdir(referenceDirectory, { recursive: true });
  const environment = png(profile.length * 5);
  const character = png(220);
  await Promise.all([
    writeFile(resolve(referenceDirectory, 'environment.png'), environment),
    writeFile(resolve(referenceDirectory, 'character.png'), character),
  ]);
  const rights = {
    basis: 'owned' as const,
    license: 'LicenseRef-User-Owned',
    allowGenerativeAdaptation: true as const,
    allowOutputRedistribution: true as const,
    allowOutputCc0Dedication: true as const,
  };
  const intake = await createConfirmedWorldCreationIntake({
    intake_id: id,
    session_revision: 14,
    profile,
    target: 'raspberry-pi-4b',
    seed: `${id}-seed`,
    facts: {
      premise: 'Restore a harbor route and explore its landmarks.',
      worldview: 'Tides preserve memory and lantern guilds guard passages.',
      terrain: 'Stone paths, wet terraces, reeds, and sheltered water.',
      geography: 'A clear route joins spawn, market, landmark, and exit.',
      culture: 'Builders and keepers live around a working public square.',
      ecology: 'Cool rain, salt grass, birds, drifting fog, and warm lights.',
      mood: 'Quietly adventurous with readable routes and hazards.',
      art_direction: 'Painted pixels, strong silhouettes, and warm accents.',
      traversal: 'Follow the route, meet a guide, activate a marker, and exit.',
      landmarks: 'A tower, bridge, market canopy, and luminous gate.',
    },
    character_source: {
      reference_id: `${id}-character`,
      identity_digest_sha256: 'd'.repeat(64),
    },
    references: [{
      id: `${id}-environment`,
      role: 'environment-style',
      path: 'references/environment.png',
      mediaType: 'image/png',
      byteLength: environment.byteLength,
      width: 2,
      height: 2,
      sha256: sha(environment),
      rights,
    }, {
      id: `${id}-character`,
      role: 'character',
      path: 'references/character.png',
      mediaType: 'image/png',
      byteLength: character.byteLength,
      width: 2,
      height: 2,
      sha256: sha(character),
      rights,
    }],
    approved_intent_preview_sha256: 'e'.repeat(64),
  });
  await mkdir(resolve(root, 'intakes'), { recursive: true });
  await writeFile(
    resolve(root, 'intakes', `${id}.json`),
    `${JSON.stringify(intake, null, 2)}\n`,
  );
  return intake;
}

function batchRequest(worlds: readonly Readonly<{
  readonly id: string;
  readonly profile: WorldAssetProfile;
}>[]) {
  return {
    schema_version: '1.0.0',
    document_type: 'world-delivery-batch-request',
    batch_id: 'multi-world-sample',
    completed_at: COMPLETED_AT,
    worlds: worlds.map(({ id }) => ({
      workspace_id: id,
      intake_path: `intakes/${id}.json`,
      reference_root: `references/${id}`,
      character_id: 'neutral-traveler',
    })),
  };
}

describe('multi-world delivery preparation', () => {
  it('atomically prepares isolated workspaces with final job paths', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-batch-'));
    roots.push(root);
    const worlds = [
      { id: 'harbor-platformer', profile: 'side-platformer' },
      { id: 'harbor-farm', profile: 'topdown-farm' },
      { id: 'harbor-action', profile: 'isometric-action' },
      { id: 'harbor-depth', profile: 'layered-depth-2d' },
    ] as const;
    await Promise.all(worlds.map(({ id, profile }) =>
      writeWorldFixture(root, id, profile)));
    const output = resolve(root, 'private-batch');
    const request = batchRequest(worlds);
    const receipt = await prepareWorldDeliveryBatch({
      request,
      requestRoot: root,
      batchRoot: output,
    });
    expect(receipt).toMatchObject({
      world_count: 4,
      remote_request_count: 0,
      atomic_write: true,
      profile_counts: {
        'side-platformer': 1,
        'topdown-farm': 1,
        'isometric-action': 1,
        'layered-depth-2d': 1,
      },
      privacy: {
        receipt_embeds_private_inputs: false,
        receipt_contains_absolute_paths: false,
        repository_write_allowed: false,
      },
    });
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    expect(ajv.compile(receiptSchema)(receipt)).toBe(true);
    for (const { id } of worlds) {
      const workspace = resolve(output, 'worlds', id);
      await expect(readFile(
        resolve(workspace, 'workspace-manifest.json'),
        'utf8',
      )).resolves.toContain('"remote_request_count": 0');
      const job = await readFile(
        resolve(workspace, 'production-art-workflow-job.json'),
        'utf8',
      );
      expect(job).toContain(workspace.replaceAll('\\', '\\\\'));
      expect(job).not.toContain('.tmp-');
    }
    await expect(prepareWorldDeliveryBatch({
      request,
      requestRoot: root,
      batchRoot: output,
    })).resolves.toEqual(receipt);
  });

  it('removes the staged batch when any world fails', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'mapsoo-world-batch-fail-'));
    roots.push(root);
    await writeWorldFixture(root, 'valid-world', 'side-platformer');
    const output = resolve(root, 'failed-batch');
    await expect(prepareWorldDeliveryBatch({
      request: batchRequest([
        { id: 'valid-world', profile: 'side-platformer' },
        { id: 'missing-world', profile: 'topdown-farm' },
      ]),
      requestRoot: root,
      batchRoot: output,
    })).rejects.toThrow();
    await expect(readFile(
      resolve(output, 'batch-receipt.json'),
      'utf8',
    )).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(root)).some((name) =>
      name.startsWith('.failed-batch.tmp-'))).toBe(false);
  });
});
