import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import reviewSchema from '../../schemas/mapsoo-production-world-review-1.0.schema.json';
import {
  PRODUCTION_WORLD_REVIEW_GATES,
  PRODUCTION_WORLD_REVIEW_VERSION,
  validateProductionWorldReview,
  type ProductionWorldEvidence,
  type ProductionWorldReviewContract,
} from './production-world-review-contract';

const HASHES = ['a', 'b', 'c', 'd', 'e', 'f', '0'].map((character) => character.repeat(64));

function evidence(
  evidenceId: string,
  kind: ProductionWorldEvidence['kind'],
  index: number,
  mediaType: ProductionWorldEvidence['media_type'] = 'application/json',
): ProductionWorldEvidence {
  return {
    evidence_id: evidenceId,
    kind,
    path: `review-evidence/${evidenceId}.${mediaType === 'image/png' ? 'png' : mediaType === 'video/mp4' ? 'mp4' : 'json'}`,
    media_type: mediaType,
    bytes: 4096 + index,
    sha256: HASHES[index],
    claim: `Synthetic bounded evidence for the ${evidenceId} review gate.`,
    ...(mediaType === 'image/png' ? { width: 1280, height: 720 } : {}),
    ...(kind !== 'human-review-record' ? { godot_versions: ['4.3', '4.7'] as const } : {}),
    ...(kind === 'human-review-record' ? { reviewer_id: 'maintainer-one' } : {}),
  };
}

function technicalEvidence(): readonly ProductionWorldEvidence[] {
  return [
    evidence('rendered-world', 'rendered-world-capture', 0, 'image/png'),
    evidence('role-overlay', 'role-placement-overlay', 1, 'image/png'),
    evidence('collision-overlay', 'art-collision-overlay', 2, 'image/png'),
    evidence('spawn-exit-video', 'spawn-exit-traversal', 3, 'video/mp4'),
    evidence('navigation-video', 'navigation-traversal', 4, 'video/mp4'),
    evidence('human-record', 'human-review-record', 5),
    evidence('headless-smoke', 'headless-asset-controller-smoke', 6),
  ];
}

function contract(): ProductionWorldReviewContract {
  return {
    schema_version: PRODUCTION_WORLD_REVIEW_VERSION,
    review_id: 'synthetic-side-review-v1',
    profile: 'side-platformer',
    world_preview: {
      path: 'review-evidence/world-preview.png',
      bytes: 8192,
      sha256: 'f'.repeat(64),
      width: 1280,
      height: 720,
    },
    evidence: technicalEvidence(),
    gates: [
      { gate: 'image-composition', status: 'technical-pass', evidence_ids: ['rendered-world'] },
      { gate: 'role-placement', status: 'technical-pass', evidence_ids: ['role-overlay'] },
      { gate: 'art-to-collision', status: 'technical-pass', evidence_ids: ['collision-overlay'] },
      { gate: 'spawn-exit', status: 'technical-pass', evidence_ids: ['spawn-exit-video'] },
      { gate: 'navigation', status: 'technical-pass', evidence_ids: ['navigation-video'] },
      { gate: 'human-review', status: 'pending', evidence_ids: [] },
    ],
    release_decision: 'blocked',
  };
}

describe('production world visual/collision review contract', () => {
  it('accepts a schema-valid technical review while human approval remains pending', () => {
    const value = contract();
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(reviewSchema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(validateProductionWorldReview(value)).toEqual([]);
  });

  it('accepts a recorded headless smoke only while the related review gates stay pending', () => {
    const value: ProductionWorldReviewContract = {
      ...contract(),
      gates: PRODUCTION_WORLD_REVIEW_GATES.map((gate) => ({
        gate,
        status: 'pending',
        evidence_ids: gate === 'image-composition' ? ['headless-smoke'] : [],
      })),
    };
    expect(validateProductionWorldReview(value)).toEqual([]);
  });

  it.each([
    'image-composition',
    'role-placement',
    'art-to-collision',
    'spawn-exit',
    'navigation',
  ] as const)('forbids headless smoke from satisfying the %s gate', (gateName) => {
    const value = contract();
    const changed: ProductionWorldReviewContract = {
      ...value,
      gates: value.gates.map((gate) => gate.gate === gateName
        ? { ...gate, evidence_ids: ['headless-smoke'] }
        : gate),
    };
    const codes = validateProductionWorldReview(changed)
      .filter(({ gate }) => gate === gateName)
      .map(({ code }) => code);
    expect(codes).toContain('gate.headless-smoke');
    expect(codes).toContain('gate.technical-evidence');
  });

  it('does not accept spawn/exit traversal evidence as navigation proof', () => {
    const value = contract();
    const changed: ProductionWorldReviewContract = {
      ...value,
      gates: value.gates.map((gate) => gate.gate === 'navigation'
        ? { ...gate, evidence_ids: ['spawn-exit-video'] }
        : gate),
    };
    expect(validateProductionWorldReview(changed))
      .toContainEqual(expect.objectContaining({
        code: 'gate.technical-evidence',
        gate: 'navigation',
      }));
  });

  it('requires gate-specific technical evidence plus human evidence for a human pass', () => {
    const value = contract();
    const withoutHuman: ProductionWorldReviewContract = {
      ...value,
      gates: value.gates.map((gate) => gate.gate === 'image-composition'
        ? { ...gate, status: 'human-pass' }
        : gate),
    };
    expect(validateProductionWorldReview(withoutHuman))
      .toContainEqual(expect.objectContaining({
        code: 'gate.human-evidence',
        gate: 'image-composition',
      }));

    const withHuman: ProductionWorldReviewContract = {
      ...value,
      gates: value.gates.map((gate) => gate.gate === 'image-composition'
        ? { ...gate, status: 'human-pass', evidence_ids: ['rendered-world', 'human-record'] }
        : gate),
    };
    expect(validateProductionWorldReview(withHuman)).toEqual([]);
  });

  it('forbids technical-pass on human review and blocks approval until every gate passes', () => {
    const value = contract();
    const invalidHuman: ProductionWorldReviewContract = {
      ...value,
      gates: value.gates.map((gate) => gate.gate === 'human-review'
        ? { ...gate, status: 'technical-pass', evidence_ids: ['headless-smoke'] }
        : gate),
      release_decision: 'approved',
    };
    const codes = validateProductionWorldReview(invalidHuman).map(({ code }) => code);
    expect(codes).toContain('gate.human-review-technical');
    expect(codes).toContain('review.release-decision');
  });

  it('allows approval only after all technical gates and explicit human review pass', () => {
    const value = contract();
    const approved: ProductionWorldReviewContract = {
      ...value,
      gates: value.gates.map((gate) => gate.gate === 'human-review'
        ? { ...gate, status: 'human-pass', evidence_ids: ['human-record'] }
        : gate),
      release_decision: 'approved',
    };
    expect(validateProductionWorldReview(approved)).toEqual([]);
  });

  it('rejects unsafe evidence paths, broken hashes, duplicate gates and non-JSON human records', () => {
    const value = contract();
    const changed: ProductionWorldReviewContract = {
      ...value,
      evidence: value.evidence.map((record) => {
        if (record.evidence_id === 'collision-overlay') {
          return { ...record, path: '../private/collision.png', sha256: 'bad' };
        }
        if (record.evidence_id === 'human-record') {
          return { ...record, media_type: 'text/plain' };
        }
        return record;
      }),
      gates: value.gates.map((gate) => gate.gate === 'navigation'
        ? { ...gate, gate: 'spawn-exit' }
        : gate),
    };
    const codes = validateProductionWorldReview(changed).map(({ code }) => code);
    expect(codes).toContain('evidence.path');
    expect(codes).toContain('evidence.integrity');
    expect(codes).toContain('evidence.human-review');
    expect(codes).toContain('review.gates');
  });
});
