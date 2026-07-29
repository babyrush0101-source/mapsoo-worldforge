const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

export type CanonicalPngErrorCode =
  | 'canonical-png.invalid'
  | 'canonical-png.metadata';

export class CanonicalPngError extends Error {
  constructor(readonly code: CanonicalPngErrorCode, message: string) {
    super(message);
    this.name = 'CanonicalPngError';
  }
}

function fail(code: CanonicalPngErrorCode, message: string): never {
  throw new CanonicalPngError(code, message);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000
    + bytes[offset + 1]! * 0x10000
    + bytes[offset + 2]! * 0x100
    + bytes[offset + 3]!
  );
}

/**
 * Admits only the deterministic PNG chunk inventory emitted by WorldForge:
 * one leading IHDR, one or more IDAT chunks, and one trailing IEND.
 */
export function assertCanonicalMetadataFreePng(bytes: Uint8Array): void {
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 33
    || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    fail('canonical-png.invalid', 'PNG signature is invalid.');
  }
  let offset = 8;
  let chunkIndex = 0;
  let sawIdat = false;
  let sawIend = false;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) {
      fail('canonical-png.invalid', 'PNG chunk is truncated.');
    }
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(length) || end > bytes.byteLength) {
      fail('canonical-png.invalid', 'PNG chunk length is invalid.');
    }
    const type = new TextDecoder('ascii')
      .decode(bytes.subarray(offset + 4, offset + 8));
    if (
      (chunkIndex === 0 && type !== 'IHDR')
      || !['IHDR', 'IDAT', 'IEND'].includes(type)
      || (type === 'IHDR' && chunkIndex !== 0)
      || (type === 'IEND' && (length !== 0 || end !== bytes.byteLength))
      || sawIend
    ) {
      fail(
        'canonical-png.metadata',
        'PNG contains metadata or a non-canonical chunk inventory.',
      );
    }
    if (type === 'IDAT') sawIdat = true;
    if (type === 'IEND') sawIend = true;
    offset = end;
    chunkIndex += 1;
  }
  if (!sawIdat || !sawIend || offset !== bytes.byteLength) {
    fail('canonical-png.invalid', 'PNG chunk inventory is incomplete.');
  }
}
