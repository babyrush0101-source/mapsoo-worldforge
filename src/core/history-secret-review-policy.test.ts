import { describe, expect, it } from 'vitest';
import {
  historySecretFindingKey,
  REVIEWED_FINDINGS,
} from '../../scripts/lib/history-secret-review-policy.mjs';

describe('history secret review policy', () => {
  it('contains only exact full-object review keys', () => {
    expect(REVIEWED_FINDINGS.size).toBe(8);

    for (const key of REVIEWED_FINDINGS.keys()) {
      const [rule, path, objectId] = key.split('\0');
      expect(rule).toBe('password-assignment');
      expect(path).not.toBe('');
      expect(objectId).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('does not review prefixes, adjacent objects, or path-wide matches', () => {
    const exactObjectId = '91078935c5a55c7b74918ca3dbd9beed4805629d';
    const exactPath = 'node_modules/@jsr/supabase__supabase-js/test/deno/integration.test.ts';

    expect(REVIEWED_FINDINGS.has(historySecretFindingKey(
      'password-assignment',
      exactPath,
      exactObjectId,
    ))).toBe(true);
    expect(REVIEWED_FINDINGS.has(historySecretFindingKey(
      'password-assignment',
      exactPath,
      exactObjectId.slice(0, 12),
    ))).toBe(false);
    expect(REVIEWED_FINDINGS.has(historySecretFindingKey(
      'password-assignment',
      exactPath,
      `${exactObjectId.slice(0, -1)}e`,
    ))).toBe(false);
    expect(REVIEWED_FINDINGS.has(historySecretFindingKey(
      'password-assignment',
      'node_modules/another-package/test/example.test.ts',
      exactObjectId,
    ))).toBe(false);
    expect(REVIEWED_FINDINGS.has(historySecretFindingKey(
      'secret-assignment',
      exactPath,
      exactObjectId,
    ))).toBe(false);
  });
});
