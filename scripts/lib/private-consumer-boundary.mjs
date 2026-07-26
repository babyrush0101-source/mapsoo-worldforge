import { createHash } from 'node:crypto';

// Store only one-way digests in the public tree. The private consumer names
// themselves must never be committed merely to implement a leak detector.
const FORBIDDEN_TOKEN_HASHES = new Set([
  'f3f704d27407c98b177a0f0908bb9838c6465b2f3b5acd6cdcdb4174ad29496a',
  'a4f94a2ce6518dd8cfeb557166b2b35babd3c331cec3fc1dc55a8be6d405d096',
]);
const TOKEN_LENGTH = 5;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function containsPrivateConsumerToken(value) {
  if (typeof value !== 'string' || value.length < TOKEN_LENGTH) return false;
  const normalized = value.toLowerCase();
  for (let index = 0; index <= normalized.length - TOKEN_LENGTH; index += 1) {
    const candidate = normalized.slice(index, index + TOKEN_LENGTH);
    if (/^[a-z]+$/.test(candidate) && FORBIDDEN_TOKEN_HASHES.has(sha256(candidate))) {
      return true;
    }
  }
  return false;
}
