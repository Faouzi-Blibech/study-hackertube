// Manual IEEE 754 half-precision decode. Float16Array is not available in every
// browser we target, so we decode the bits ourselves.

/** Decode one 16-bit half float (as an unsigned integer) to a JS number. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x03ff;
  if (exp === 0) {
    // zero or subnormal: frac * 2^-24
    return sign * frac * 2 ** -24;
  }
  if (exp === 0x1f) {
    return frac === 0 ? sign * Infinity : NaN;
  }
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/**
 * Decode a raw little-endian float16 buffer into a Float32Array.
 * The byteLength must be even.
 */
export function decodeF16(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength % 2 !== 0) {
    throw new Error(`float16 buffer has odd byte length ${buffer.byteLength}`);
  }
  const view = new DataView(buffer);
  const n = buffer.byteLength / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = halfToFloat(view.getUint16(i * 2, true));
  }
  return out;
}
