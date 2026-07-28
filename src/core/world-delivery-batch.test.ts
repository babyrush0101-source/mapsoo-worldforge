import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import requestSchema
  from '../../schemas/mapsoo-world-delivery-batch-request-1.0.schema.json';
import {
  fingerprintWorldDeliveryBatchRequest,
  materializeWorldDeliveryBatchRequest,
  serializeWorldDeliveryBatchRequestCanonical,
} from './world-delivery-batch';

function request() {
  return {
    schema_version: '1.0.0',
    document_type: 'world-delivery-batch-request',
    batch_id: 'four-world-profile-sample',
    completed_at: '2026-07-29T12:00:00.000Z',
    worlds: [{
      workspace_id: 'harbor-platformer',
      intake_path: 'intakes/harbor-platformer.json',
      reference_root: 'references/harbor-platformer',
      character_id: 'neutral-traveler',
    }, {
      workspace_id: 'harbor-farm',
      intake_path: 'intakes/harbor-farm.json',
      reference_root: 'references/harbor-farm',
      character_id: 'neutral-traveler',
      character_identity_semantics_path:
        'characters/neutral-traveler.json',
    }],
  };
}

describe('world delivery batch request', () => {
  it('materializes and fingerprints a strict portable request', async () => {
    const value = materializeWorldDeliveryBatchRequest(request());
    expect(value.worlds).toHaveLength(2);
    expect(value.worlds[1].character_identity_semantics_path)
      .toBe('characters/neutral-traveler.json');
    expect(await fingerprintWorldDeliveryBatchRequest(value))
      .toMatch(/^[a-f0-9]{64}$/u);
    expect(new TextDecoder().decode(
      serializeWorldDeliveryBatchRequestCanonical(value),
    )).not.toContain('C:\\');
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    expect(ajv.compile(requestSchema)(value)).toBe(true);
  });

  it('rejects duplicate workspaces, path traversal, and unknown fields', () => {
    const duplicated = request();
    duplicated.worlds[1] = {
      ...duplicated.worlds[1],
      workspace_id: duplicated.worlds[0].workspace_id,
    };
    expect(() => materializeWorldDeliveryBatchRequest(duplicated))
      .toThrow(/duplicated/u);
    expect(() => materializeWorldDeliveryBatchRequest({
      ...request(),
      worlds: [{
        ...request().worlds[0],
        intake_path: '../private.json',
      }],
    })).toThrow(/portable relative path/u);
    expect(() => materializeWorldDeliveryBatchRequest({
      ...request(),
      private_product_id: 'must-not-cross',
    })).toThrow(/required keys/u);
  });

  it('requires a real canonical completion instant', () => {
    expect(() => materializeWorldDeliveryBatchRequest({
      ...request(),
      completed_at: '2026-07-29',
    })).toThrow(/canonical UTC/u);
    expect(() => materializeWorldDeliveryBatchRequest({
      ...request(),
      completed_at: '2026-02-30T12:00:00.000Z',
    })).toThrow(/real canonical UTC/u);
  });
});
