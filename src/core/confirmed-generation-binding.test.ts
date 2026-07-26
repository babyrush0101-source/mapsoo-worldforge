import { describe, expect, it } from 'vitest';

import type { GenerationRequestV2 } from './generation-request-v2';
import {
  ConfirmedGenerationBindingError,
  createConfirmedGenerationBinding,
  materializeConfirmedGenerationBinding,
} from './confirmed-generation-binding';

const request: GenerationRequestV2 = {
  schemaVersion: '1.0.0',
  id: 'confirmed-world',
  profile: 'side-platformer',
  description: 'A confirmed public-safe world description.',
  seed: 'confirmed-seed',
  references: [
    {
      id: 'environment-reference', role: 'environment-style', path: 'references/environment.png',
      mediaType: 'image/png', byteLength: 10, width: 2, height: 2, sha256: '1'.repeat(64),
      rights: {
        basis: 'owned', license: 'LicenseRef-User-Owned', allowGenerativeAdaptation: true,
        allowOutputRedistribution: true, allowOutputCc0Dedication: true,
      },
    },
    {
      id: 'character-reference', role: 'character', path: 'references/character.png',
      mediaType: 'image/png', byteLength: 10, width: 2, height: 2, sha256: '2'.repeat(64),
      rights: {
        basis: 'owned', license: 'LicenseRef-User-Owned', allowGenerativeAdaptation: true,
        allowOutputRedistribution: true, allowOutputCc0Dedication: true,
      },
    },
  ],
};

const dialogue = {
  sessionRevision: 4,
  checkpoints: [
    { stage: 'world-brief' as const, snapshotSha256: 'a'.repeat(64) },
    { stage: 'art-direction' as const, snapshotSha256: 'b'.repeat(64) },
    { stage: 'map-layout' as const, snapshotSha256: 'c'.repeat(64) },
    { stage: 'style-sample' as const, snapshotSha256: 'd'.repeat(64) },
  ],
};

describe('confirmed generation binding', () => {
  it('one-way binds all four dialogue snapshots to the exact generation request', async () => {
    const binding = await createConfirmedGenerationBinding(request, dialogue);
    expect(binding).toMatchObject({
      schema_version: '0.1.0',
      session_revision: 4,
      checkpoints: [
        { stage: 'world-brief', snapshot_sha256: 'a'.repeat(64) },
        { stage: 'art-direction', snapshot_sha256: 'b'.repeat(64) },
        { stage: 'map-layout', snapshot_sha256: 'c'.repeat(64) },
        { stage: 'style-sample', snapshot_sha256: 'd'.repeat(64) },
      ],
    });
    expect(binding.request_fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.dialogue_snapshot_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.binding_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await materializeConfirmedGenerationBinding(binding, request)).toEqual(binding);
    expect(JSON.stringify(binding)).not.toContain('confirmed public-safe world description');
    expect(Object.isFrozen(binding.checkpoints)).toBe(true);
  });

  it('changes the binding when any checkpoint or request field changes', async () => {
    const original = await createConfirmedGenerationBinding(request, dialogue);
    const changedCheckpoint = await createConfirmedGenerationBinding(request, {
      ...dialogue,
      checkpoints: dialogue.checkpoints.map((checkpoint, index) => (
        index === 2 ? { ...checkpoint, snapshotSha256: 'e'.repeat(64) } : checkpoint
      )),
    });
    const changedRequest = await createConfirmedGenerationBinding({
      ...request,
      seed: 'another-seed',
    }, dialogue);
    expect(changedCheckpoint.binding_sha256).not.toBe(original.binding_sha256);
    expect(changedRequest.binding_sha256).not.toBe(original.binding_sha256);
  });

  it('rejects missing, reordered, tampered, or request-mismatched bindings', async () => {
    await expect(createConfirmedGenerationBinding(request, {
      sessionRevision: 4,
      checkpoints: dialogue.checkpoints.slice(0, 3),
    })).rejects.toBeInstanceOf(ConfirmedGenerationBindingError);
    await expect(createConfirmedGenerationBinding(request, {
      sessionRevision: 4,
      checkpoints: [dialogue.checkpoints[1], dialogue.checkpoints[0], ...dialogue.checkpoints.slice(2)],
    })).rejects.toThrow(/must be world-brief/);

    const binding = await createConfirmedGenerationBinding(request, dialogue);
    await expect(materializeConfirmedGenerationBinding({
      ...binding,
      checkpoints: binding.checkpoints.map((checkpoint, index) => (
        index === 0 ? { ...checkpoint, snapshot_sha256: 'f'.repeat(64) } : checkpoint
      )),
    }, request)).rejects.toThrow(/dialogue snapshot/);
    await expect(materializeConfirmedGenerationBinding(binding, {
      ...request,
      description: 'A different request description.',
    })).rejects.toThrow(/does not match the generation request/);
  });
});
