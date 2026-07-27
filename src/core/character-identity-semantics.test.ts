import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import semanticsSchema
  from '../../schemas/mapsoo-character-identity-semantics-1.0.schema.json';
import {
  compileCharacterIdentitySemanticsPrompt,
  fingerprintCharacterIdentitySemantics,
  materializeCharacterIdentitySemantics,
  serializeCharacterIdentitySemanticsCanonical,
} from './character-identity-semantics';
import { WORLD_ASSET_PROFILES } from './asset-profile';

function semantics() {
  return {
    schema_version: '1.0.0',
    document_type: 'character-identity-semantics',
    character_id: 'lantern-courier',
    source_identity: {
      identity_digest_sha256: 'a'.repeat(64),
      source_reference_id: 'courier-reference',
    },
    confirmation: {
      status: 'human-confirmed',
      checkpoint_sha256: 'b'.repeat(64),
    },
    cues: {
      silhouette: 'Compact traveler silhouette with a broad scarf and narrow boots.',
      body_proportions: 'Large head, short torso, slim arms, and sturdy short legs.',
      hair: 'Dark wavy bob with one upward curl above the left eyebrow.',
      face: 'Round face, thick straight eyebrows, and a small triangular nose.',
      clothing: [
        'Magenta cropped jacket with two brass clasps.',
        'Amber scarf wrapped once with a long right tail.',
        'Charcoal trousers tucked into dark boots.',
      ],
      equipment: ['Small round lantern carried at the left hip.'],
      distinguishing_features: [
        'Crescent-shaped pale patch above the right eyebrow.',
      ],
      palette: ['#231f2b', '#b43b73', '#e4a43b', '#e7d8c9'],
    },
  } as const;
}

describe('Character Identity Semantics 1.0', () => {
  it('matches its public schema and emits stable canonical bytes', async () => {
    const value = semantics();
    const validate = new Ajv2020({ strict: true, allErrors: true })
      .compile(semanticsSchema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(materializeCharacterIdentitySemantics(value)).toEqual(value);
    const bytes = serializeCharacterIdentitySemanticsCanonical(value);
    expect(new TextDecoder().decode(bytes).startsWith('{"character_id"')).toBe(true);
    expect(await fingerprintCharacterIdentitySemantics(value))
      .toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each(WORLD_ASSET_PROFILES)(
    'compiles exact semantic cues into the %s adaptation boundary',
    (profile) => {
      const prompt = compileCharacterIdentitySemanticsPrompt(semantics(), profile);
      expect(prompt).toContain('Magenta cropped jacket');
      expect(prompt).toContain('Amber scarf');
      expect(prompt).toContain('Crescent-shaped pale patch');
      expect(prompt).toContain('Do not replace, remove, recolor, or invent');
    },
  );

  it('rejects unconfirmed, incomplete, unsafe, or private extension data', () => {
    expect(() => materializeCharacterIdentitySemantics({
      ...semantics(),
      confirmation: {
        ...semantics().confirmation,
        status: 'agent-inferred',
      },
    })).toThrow(/human confirmation/u);
    expect(() => materializeCharacterIdentitySemantics({
      ...semantics(),
      cues: {
        ...semantics().cues,
        hair: 'Make the hair exactly like a protected Hades character.',
      },
    })).toThrow(/original traits/u);
    expect(() => materializeCharacterIdentitySemantics({
      ...semantics(),
      cues: {
        ...semantics().cues,
        clothing: [],
      },
    })).toThrow(/1 through 8/u);
    expect(() => materializeCharacterIdentitySemantics({
      ...semantics(),
      private_character_record: 'forbidden',
    })).toThrow(/exactly/u);
  });
});
