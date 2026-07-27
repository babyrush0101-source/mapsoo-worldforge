import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import receiptSchema from '../../schemas/mapsoo-reviewed-world-asset-source-receipt-1.0.schema.json';
import { materializeReviewedWorldAssetSourceReceipt } from './reviewed-world-asset-source-receipt';

function receipt() {
  return {
    schema_version: '1.0.0',
    document_type: 'reviewed-world-asset-source-receipt',
    profile: 'side-platformer',
    pack_contract: 'pack-0.7',
    pack_id: 'review-world',
    pack_sha256: 'a'.repeat(64),
    manifest_sha256: 'b'.repeat(64),
    review_record_sha256: 'c'.repeat(64),
    request_fingerprint_sha256: 'd'.repeat(64),
    authorization: {
      distribution: 'internal-review',
      license_id: 'LicenseRef-UNRELEASED',
      permits_redistribution: false,
      contains_generative_ai: true,
      human_curated: false,
    },
    review: {
      human_art: 'pending',
      rights: 'pending',
      runtime: 'pending',
      raspberry_pi: 'pending',
    },
    runtime_asset_count: 14,
    runtime_role_count: 30,
  };
}

describe('reviewed world asset source receipt', () => {
  it('matches the public schema and materializes one exact versioned receipt', () => {
    const value = receipt();
    const validate = new Ajv2020({ strict: true }).compile(receiptSchema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(materializeReviewedWorldAssetSourceReceipt(value)).toEqual(value);
  });

  it('rejects profile/Pack drift, review promotion, and unknown fields', () => {
    expect(() => materializeReviewedWorldAssetSourceReceipt({
      ...receipt(),
      pack_contract: 'pack-0.8',
    })).toThrow(/identity or counts/);
    expect(() => materializeReviewedWorldAssetSourceReceipt({
      ...receipt(),
      review: { ...receipt().review, human_art: 'pass' },
    })).toThrow(/review boundary/);
    expect(() => materializeReviewedWorldAssetSourceReceipt({
      ...receipt(),
      private_consumer: 'forbidden',
    })).toThrow(/shape/);
  });
});
