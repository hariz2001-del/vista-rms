import { describe, expect, it } from 'vitest'
import { settlePeriod } from './finance.ts'
import type { AccountSettings, Order, SaleCorrection } from './types.ts'

const FOOD = 'brand-food'
const DRINKS = 'brand-drinks'

const SETTINGS: AccountSettings = {
  businessName: 'Test',
  outletName: 'Test',
  sharedOverheadFoodPct: 70,
  hostCommissionPct: 30,
  capitalAssetFoodPct: 50,
}

function sale(id: string, brandId: string, netSen: number): Order {
  return {
    id,
    shiftId: 'shift',
    businessDate: '2026-09-01',
    queueNumber: `#${id}`,
    offlineLabel: null,
    completedAt: '2026-09-01T13:00:00Z',
    grossSen: netSen,
    lineDiscountSen: 0,
    orderDiscountSen: 0,
    totalAmountSen: netSen,
    flagStatus: 'NONE',
    flagReason: null,
    needsReview: false,
    reviewReason: null,
    lines: [
      {
        productName: 'Item',
        brandId,
        categoryId: 'cat',
        quantity: 1,
        unitPriceSen: netSen,
        modifierTotalSen: 0,
        lineDiscountSen: 0,
        allocatedOrderDiscountSen: 0,
      },
    ],
  }
}

function cancel(order: Order): SaleCorrection {
  return {
    id: `cancel-${order.id}`,
    originalOrderId: order.id,
    originalQueueNumber: order.queueNumber,
    shiftId: order.shiftId,
    businessDate: order.businessDate,
    createdAt: '2026-09-01T13:05:00Z',
    kind: 'CANCEL',
    reason: 'Customer cancelled after paying',
    deltaSen: -order.totalAmountSen,
    brandDeltas: order.lines.map((line) => ({
      brandId: line.brandId,
      deltaSen: -(line.unitPriceSen * line.quantity),
    })),
  }
}

const BASE = {
  expenses: [],
  outstandingAdvances: [],
  ledger: [],
  settings: SETTINGS,
  foodBrandId: FOOD,
  drinksBrandId: DRINKS,
  openingIouSen: 0,
}

describe('settlement preview with counter corrections', () => {
  it('does not pay the partners on a sale the cashier refunded', () => {
    const kept = sale('001', FOOD, 800)
    const refunded = sale('002', FOOD, 800)

    const withoutRefund = settlePeriod({ ...BASE, orders: [kept] })
    const withRefund = settlePeriod({
      ...BASE,
      // The refunded sale is still in the orders — sales are never edited — so
      // it is the correction that has to take it back out.
      orders: [kept, refunded],
      corrections: [cancel(refunded)],
    })

    expect(withRefund.food.netSalesSen).toBe(800)
    expect(withRefund.foodPayoutSen).toBe(withoutRefund.foodPayoutSen)
  })

  it('matches the server: Food 800 and Drinks 400 kept, a Food 800 cancelled', () => {
    // The same case api-vista's period-close test asserts, so preview and the
    // locked figures can be seen to agree.
    const food = sale('001', FOOD, 800)
    const drinks = sale('002', DRINKS, 400)
    const refunded = sale('003', FOOD, 800)

    const summary = settlePeriod({
      ...BASE,
      orders: [food, drinks, refunded],
      corrections: [cancel(refunded)],
    })

    expect(summary.hostCommissionSen).toBe(240)
    expect(summary.foodPayoutSen).toBe(560)
    expect(summary.drinksPayoutSen).toBe(640)
  })
})
