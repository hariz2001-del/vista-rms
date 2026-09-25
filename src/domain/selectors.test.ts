import { describe, expect, it } from 'vitest'
import type { Order, SaleCorrection, Shift, TerminalStatus } from './types.ts'
import { attentionItems, bannerState, dailyPoints, summariseRange } from './selectors.ts'

const ORDER: Order = {
  id: 'order-1',
  shiftId: 'shift-1',
  businessDate: '2026-09-08',
  queueNumber: '#014',
  offlineLabel: null,
  completedAt: '2026-09-08T12:00:00Z',
  grossSen: 1_000,
  lineDiscountSen: 0,
  orderDiscountSen: 0,
  totalAmountSen: 1_000,
  flagStatus: 'NONE',
  flagReason: null,
  needsReview: false,
  reviewReason: null,
  lines: [
    {
      productName: 'Test item',
      brandId: 'food',
      categoryId: 'mains',
      quantity: 1,
      unitPriceSen: 1_000,
      modifierTotalSen: 0,
      lineDiscountSen: 0,
      allocatedOrderDiscountSen: 0,
    },
  ],
}

const CORRECTION: SaleCorrection = {
  id: 'correction-1',
  originalOrderId: ORDER.id,
  originalQueueNumber: ORDER.queueNumber,
  shiftId: ORDER.shiftId,
  businessDate: ORDER.businessDate,
  createdAt: '2026-09-08T12:05:00Z',
  kind: 'EXCHANGE',
  reason: 'Swapped for a different item',
  deltaSen: 0,
  brandDeltas: [
    { brandId: 'food', deltaSen: -1_000 },
    { brandId: 'drinks', deltaSen: 1_000 },
  ],
}

describe('correction reporting', () => {
  it('keeps same-price cross-brand corrections in the period and chart split', () => {
    const range = { startDate: '2026-09-01', endDate: '2026-09-30' }
    const summary = summariseRange(range, [ORDER], [], [CORRECTION])
    expect(summary.netSalesSen).toBe(1_000)
    expect(summary.netByBrand.get('food')).toBe(0)
    expect(summary.netByBrand.get('drinks')).toBe(1_000)

    const points = dailyPoints([ORDER], ['food', 'drinks'], [CORRECTION])
    expect(points[0]).toMatchObject({
      totalSen: 1_000,
      byBrand: { food: 0, drinks: 1_000 },
    })
  })

  it('surfaces cashier corrections as owner activity even when no money changed', () => {
    expect(attentionItems([], [CORRECTION])).toEqual([
      expect.objectContaining({
        kind: 'CORRECTION_ACTIVITY',
        title: '#014 edited',
        amountSen: 0,
        deltaSen: 0,
      }),
    ])
  })

  it('includes correction deltas in the live counter takings', () => {
    const refund = { ...CORRECTION, deltaSen: -200, brandDeltas: [{ brandId: 'food', deltaSen: -200 }] }
    const shifts: Shift[] = [
      {
        id: 'shift-1',
        businessDate: '2026-09-08',
        openedAt: '2026-09-08T11:00:00Z',
        closedAt: null,
        systemNetSalesSen: null,
        declaredBankTotalSen: null,
        varianceSen: null,
        reconciliationStatus: 'NOT_REQUIRED',
      },
    ]
    const terminal: TerminalStatus = {
      lastSeenAt: '2026-09-08T12:00:00Z',
      consecutiveSyncFailures: 0,
      unsentSaleCount: 0,
    }

    expect(
      bannerState(shifts, [ORDER], [refund], terminal, new Date('2026-09-08T12:01:00Z')),
    ).toMatchObject({ kind: 'COUNTER_OPEN', takingsSen: 800 })
  })
})
