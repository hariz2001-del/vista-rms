import { describe, expect, it } from 'vitest'
import { lineRefundSen } from './SaleFix.tsx'

// Must match the server's refund maths exactly, or the fix is refused as stale.
describe('lineRefundSen', () => {
  it('refunds a share of what was actually charged for the line', () => {
    expect(lineRefundSen({ quantity: 3, net_sen: 1550 }, 1)).toBe(517)
    expect(lineRefundSen({ quantity: 3, net_sen: 1550 }, 2)).toBe(1550 - 517)
  })
  it('refunds the whole line and nothing for none', () => {
    expect(lineRefundSen({ quantity: 3, net_sen: 1550 }, 3)).toBe(1550)
    expect(lineRefundSen({ quantity: 3, net_sen: 1550 }, 0)).toBe(0)
  })
})
