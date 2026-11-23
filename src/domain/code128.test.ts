import { describe, expect, it } from 'vitest'
import { code128Bars } from './code128.ts'

describe('code128Bars', () => {
  it('encodes start B, each character, the checksum and stop', () => {
    // "A": start B (104) + A (33) → checksum (104 + 33) % 103 = 34
    expect(code128Bars('A')).toEqual([2, 1, 1, 2, 1, 4, 1, 1, 1, 3, 2, 3, 1, 3, 1, 1, 2, 3, 2, 3, 3, 1, 1, 1, 2])
  })

  it('is 11 modules per symbol and 13 for stop, so scanners can size it', () => {
    const bars = code128Bars('SIB-ABCD-0001')!
    expect(bars.reduce((a, b) => a + b, 0)).toBe(11 * (1 + 13 + 1) + 13)
  })

  it('refuses what set B cannot carry', () => {
    expect(code128Bars('')).toBeNull()
    expect(code128Bars('kopi ☕')).toBeNull()
  })
})
