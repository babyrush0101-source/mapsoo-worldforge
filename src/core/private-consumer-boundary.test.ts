import { describe, expect, it } from 'vitest';

// The runtime helper is deliberately plain ESM so Node build/verification
// scripts can use it without compiling the application first.
// @ts-expect-error The script helper intentionally has no public type package.
import { containsPrivateConsumerToken } from '../../scripts/lib/private-consumer-boundary.mjs';

function fromCodes(codes: readonly number[]) {
  return codes.map((code) => String.fromCharCode(code)).join('');
}

describe('private consumer boundary', () => {
  it('detects both protected spellings without storing them in source', () => {
    const canonical = fromCodes([115, 116, 111, 121, 111]);
    const transposed = fromCodes([115, 111, 116, 121, 111]);

    expect(containsPrivateConsumerToken(canonical)).toBe(true);
    expect(containsPrivateConsumerToken(`prefix-${transposed}-suffix`)).toBe(true);
  });

  it('does not reject neutral public integration text', () => {
    expect(containsPrivateConsumerToken('External Host integration')).toBe(false);
    expect(containsPrivateConsumerToken('Mapsoo Worldsmith')).toBe(false);
    expect(containsPrivateConsumerToken('')).toBe(false);
  });
});
