import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeF16, halfToFloat } from './f16';

describe('halfToFloat', () => {
  const cases: [string, number, number][] = [
    ['one', 0x3c00, 1],
    ['minus two', 0xc000, -2],
    ['zero', 0x0000, 0],
    ['half', 0x3800, 0.5],
    ['smallest subnormal', 0x0001, 2 ** -24],
    ['largest subnormal', 0x03ff, 1023 * 2 ** -24],
    ['smallest normal', 0x0400, 2 ** -14],
    ['max finite', 0x7bff, 65504],
    ['plus inf', 0x7c00, Infinity],
    ['minus inf', 0xfc00, -Infinity],
    ['negative 0.1 approx', 0xae66, -0.0999755859375],
  ];
  it.each(cases)('%s', (_name, bits, expected) => {
    expect(halfToFloat(bits)).toBe(expected);
  });

  it('nan', () => {
    expect(halfToFloat(0x7e00)).toBeNaN();
  });

  it('negative zero keeps its sign', () => {
    expect(Object.is(halfToFloat(0x8000), -0)).toBe(true);
  });
});

describe('decodeF16', () => {
  it('reads little endian', () => {
    const buf = new Uint8Array([0x00, 0x3c, 0x00, 0xc0]).buffer;
    expect(Array.from(decodeF16(buf))).toEqual([1, -2]);
  });

  it('rejects odd length', () => {
    expect(() => decodeF16(new ArrayBuffer(3))).toThrow();
  });

  it('video_emb.f16 rows are unit norm', () => {
    const file = readFileSync(resolve(import.meta.dirname, '../../public/data/video_emb.f16'));
    const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const all = decodeF16(buf as ArrayBuffer);
    expect(all.length).toBe(3008 * 384);
    for (const row of [0, 1, 1500, 3007]) {
      let s = 0;
      for (let j = 0; j < 384; j++) s += all[row * 384 + j]! ** 2;
      expect(Math.sqrt(s)).toBeCloseTo(1, 2);
    }
  });
});
