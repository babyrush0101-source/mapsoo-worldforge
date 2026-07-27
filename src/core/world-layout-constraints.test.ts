import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import constraintsSchema from '../../schemas/mapsoo-world-layout-constraints-1.0.schema.json';
import { type WorldAssetProfile } from './asset-profile';
import {
  createConfirmedWorldCreationIntake,
  type ConfirmedWorldCreationIntake,
  type ConfirmedWorldFacts,
} from './confirmed-world-creation-intake';
import {
  createWorldLayoutConstraintsFromConfirmedIntake,
  deriveWorldLayoutConstraintsFromConfirmedIntake,
  fingerprintWorldLayoutConstraints,
  materializeWorldLayoutConstraints,
  WorldLayoutConstraintsError,
} from './world-layout-constraints';

const CHARACTER_HASH = 'a'.repeat(64);
const ENVIRONMENT_HASH = 'b'.repeat(64);
const IDENTITY_HASH = 'c'.repeat(64);
const PREVIEW_HASH = 'd'.repeat(64);

function reference(role: 'environment-style' | 'character') {
  const stem = role === 'character' ? 'traveler' : 'harbor';
  return {
    id: `${stem}-reference`,
    role,
    path: `references/${stem}.png`,
    mediaType: 'image/png',
    byteLength: 4096,
    width: 512,
    height: 512,
    sha256: role === 'character' ? CHARACTER_HASH : ENVIRONMENT_HASH,
    rights: {
      basis: 'owned',
      license: 'LicenseRef-User-Owned',
      allowGenerativeAdaptation: true,
      allowOutputRedistribution: true,
      allowOutputCc0Dedication: true,
    },
  } as const;
}

const BASE_FACTS: ConfirmedWorldFacts = Object.freeze({
  premise: 'A courier reconnects neighborhoods separated by a seasonal river.',
  worldview: 'Promises shape safe routes, and restored crossings change community cooperation.',
  terrain: 'Low river terraces, orchards, reed wetlands, and one elevated stone ridge.',
  geography: 'A west ferry, central market island, eastern homes, and a hill gate form two routes.',
  culture: 'River crafts, shared meals, painted ferry signs, and a lantern market define the settlement.',
  ecology: 'Willows, reeds, ducks, fireflies, orchard trees, and shallow seasonal flood pools.',
  mood: 'Hopeful morning exploration with gentle mystery and strong landmark readability.',
  art_direction: 'Hand-painted pixel art, warm landmarks, teal water, mist, and clean silhouettes.',
  traversal: 'Spawn at the old ferry, choose two routes, visit the market, then reach the hill gate.',
  landmarks: 'Old ferry, Lantern market, Waterwheel workshop, Hill gate',
});

async function intake(
  profile: WorldAssetProfile = 'topdown-farm',
  facts: ConfirmedWorldFacts = BASE_FACTS,
): Promise<ConfirmedWorldCreationIntake> {
  return createConfirmedWorldCreationIntake({
    intake_id: `layout-constraints-${profile}`,
    session_revision: 8,
    profile,
    target: 'raspberry-pi-4b',
    seed: `layout-constraints-${profile}-seed`,
    facts,
    character_source: {
      reference_id: 'traveler-reference',
      identity_digest_sha256: IDENTITY_HASH,
    },
    references: [reference('environment-style'), reference('character')],
    approved_intent_preview_sha256: PREVIEW_HASH,
  });
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe('WorldLayoutConstraints 1.0', () => {
  it('deterministically projects reviewable constraints without raw dialogue', async () => {
    const confirmed = await intake();
    const first = await deriveWorldLayoutConstraintsFromConfirmedIntake(confirmed);
    const second = await deriveWorldLayoutConstraintsFromConfirmedIntake(confirmed);
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(constraintsSchema);

    expect(validate(first), JSON.stringify(validate.errors)).toBe(true);
    expect(first).toEqual(second);
    expect(await fingerprintWorldLayoutConstraints(first)).toBe(
      await fingerprintWorldLayoutConstraints(second),
    );
    expect(first).toMatchObject({
      origin: 'compatibility-derived',
      profile: 'topdown-farm',
      route_shape: 'fork-rejoin',
      scale: 'extended',
      verticality: 'high',
      water: 'crossing',
      settlement_density: 'dense',
      hazard_level: 'calm',
      landmark_labels: ['Old ferry', 'Lantern market', 'Waterwheel workshop', 'Hill gate'],
    });
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain(BASE_FACTS.premise);
    expect(serialized).not.toContain(BASE_FACTS.geography);
    expect(serialized).not.toContain(BASE_FACTS.traversal);
    expect(serialized).not.toContain('references/');
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('accepts one explicitly confirmed provider-neutral intent without NLP inference', async () => {
    const confirmed = await intake('side-platformer');
    const constraints = await createWorldLayoutConstraintsFromConfirmedIntake(confirmed, {
      route_shape: 'loop',
      scale: 'compact',
      verticality: 'medium',
      water: 'none',
      settlement_density: 'sparse',
      hazard_level: 'guarded',
      landmark_labels: ['Camp gate', 'Signal tower'],
    });

    expect(constraints).toMatchObject({
      origin: 'confirmed-intent',
      profile: 'side-platformer',
      route_shape: 'loop',
      scale: 'compact',
      verticality: 'medium',
      water: 'none',
      settlement_density: 'sparse',
      hazard_level: 'guarded',
      landmark_labels: ['Camp gate', 'Signal tower'],
    });
    await expect(materializeWorldLayoutConstraints(constraints, confirmed)).resolves.toEqual(
      constraints,
    );
  });

  it('recognizes confirmed Chinese structural cues without provider-specific data', async () => {
    const confirmed = await intake('layered-depth-2d', {
      ...BASE_FACTS,
      terrain: '多层山地、悬崖、河流与桥梁构成明显高低差。',
      geography: '路线从村庄分叉为两条路线，穿过桥梁后重新汇合。',
      culture: '城市街区、集市和工坊沿道路密集分布。',
      traversal: '玩家经过敌人、陷阱和危险区，在检查点后抵达出口。',
      landmarks: '钟楼，河桥，山门',
    });
    const constraints = await deriveWorldLayoutConstraintsFromConfirmedIntake(confirmed);

    expect(constraints).toMatchObject({
      route_shape: 'fork-rejoin',
      verticality: 'high',
      water: 'crossing',
      settlement_density: 'dense',
      hazard_level: 'dangerous',
      landmark_labels: ['钟楼', '河桥', '山门'],
    });
  });

  it('fails closed on unknown fields and source mismatch', async () => {
    const confirmed = await intake();
    const constraints = mutable(await deriveWorldLayoutConstraintsFromConfirmedIntake(confirmed));
    constraints.provider_prompt = 'must not enter the core';
    await expect(materializeWorldLayoutConstraints(constraints)).rejects.toBeInstanceOf(
      WorldLayoutConstraintsError,
    );

    delete constraints.provider_prompt;
    constraints.source.layout_facts_sha256 = 'f'.repeat(64);
    await expect(materializeWorldLayoutConstraints(constraints, confirmed)).rejects.toMatchObject({
      code: 'layout-constraints.invalid-binding',
    });
  });
});
