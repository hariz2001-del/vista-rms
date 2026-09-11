import { describe, expect, it } from 'vitest'
import {
  liquidBalance,
  openingDeficitFor,
  orderNetByBrand,
  settlePeriod,
  splitShared,
  withRunningBalance,
} from './finance.ts'
import type { AccountSettings, Expense, LedgerEntry, Order, PeriodClosure } from './types.ts'

const FOOD = 'brand-food'
const DRINKS = 'brand-drinks'

const SETTINGS: AccountSettings = {
  businessName: 'Test',
  outletName: 'Test',
  sharedOverheadFoodPct: 70,
  hostCommissionPct: 30,
  capitalAssetFoodPct: 50,
}

function order(lines: Array<{ brandId: string; netSen: number }>): Order {
  return {
    id: crypto.randomUUID(),
    shiftId: 'shift',
    businessDate: '2026-09-01',
    queueNumber: '#001',
    offlineLabel: null,
    completedAt: '2026-09-01T13:00:00Z',
    grossSen: 0,
    lineDiscountSen: 0,
    orderDiscountSen: 0,
    totalAmountSen: lines.reduce((sum, line) => sum + line.netSen, 0),
    flagStatus: 'NONE',
    flagReason: null,
    needsReview: false,
    reviewReason: null,
    lines: lines.map((line) => ({
      productName: 'Item',
      brandId: line.brandId,
      categoryId: 'cat',
      quantity: 1,
      unitPriceSen: line.netSen,
      modifierTotalSen: 0,
      lineDiscountSen: 0,
      allocatedOrderDiscountSen: 0,
    })),
  }
}

function expense(input: Partial<Expense> & { amountSen: number }): Expense {
  const foodSplitPct = input.foodSplitPct ?? 70
  const shared = input.brandId === undefined || input.brandId === null
  const foodAmountSen = shared
    ? Math.round((input.amountSen * foodSplitPct) / 100)
    : input.brandId === FOOD
      ? input.amountSen
      : 0
  return {
    id: crypto.randomUUID(),
    businessDate: '2026-09-01',
    category: 'OPERATIONS',
    paidBy: 'STALL_FUNDS',
    brandId: shared ? null : (input.brandId ?? null),
    foodSplitPct,
    foodAmountSen,
    drinksAmountSen: input.amountSen - foodAmountSen,
    description: 'Test',
    receiptUrl: null,
    isSettled: true,
    isLocked: false,
    ...input,
  }
}

describe('splitShared', () => {
  it('sums to exactly the whole even when the split does not divide evenly', () => {
    for (const amount of [1, 3, 7, 101, 3333, 99999]) {
      const { foodSen, drinksSen } = splitShared(amount, 70)
      expect(foodSen + drinksSen).toBe(amount)
    }
  })

  it('gives the whole amount to one side at the extremes', () => {
    expect(splitShared(1000, 100)).toEqual({ foodSen: 1000, drinksSen: 0 })
    expect(splitShared(1000, 0)).toEqual({ foodSen: 0, drinksSen: 1000 })
  })
})

describe('net sales by brand', () => {
  it('sums line net across a mixed-brand order', () => {
    const totals = orderNetByBrand([
      order([
        { brandId: FOOD, netSen: 1200 },
        { brandId: DRINKS, netSen: 550 },
      ]),
      order([{ brandId: FOOD, netSen: 800 }]),
    ])

    expect(totals.get(FOOD)).toBe(2000)
    expect(totals.get(DRINKS)).toBe(550)
  })

  it('subtracts both line and allocated order discounts', () => {
    const withDiscount = order([{ brandId: FOOD, netSen: 1000 }])
    const firstLine = withDiscount.lines[0]
    if (!firstLine) throw new Error('fixture has no lines')
    firstLine.lineDiscountSen = 100
    firstLine.allocatedOrderDiscountSen = 50

    expect(orderNetByBrand([withDiscount]).get(FOOD)).toBe(850)
  })
})

describe('settlement', () => {
  it('takes 30% of a positive Food result for the host', () => {
    const result = settlePeriod({
      orders: [
        order([
          { brandId: FOOD, netSen: 100_000 },
          { brandId: DRINKS, netSen: 50_000 },
        ]),
      ],
      // 20,000 direct Food + 10,000 shared (70/30 → 7,000 Food, 3,000 Drinks)
      expenses: [
        expense({ amountSen: 20_000, brandId: FOOD }),
        expense({ amountSen: 10_000, brandId: null, category: 'RENT' }),
      ],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [],
      ledger: [],
    })

    expect(result.food.netSalesSen).toBe(100_000)
    expect(result.food.directExpensesSen).toBe(20_000)
    expect(result.food.sharedOverheadShareSen).toBe(7_000)
    expect(result.food.netResultSen).toBe(73_000)

    expect(result.hostCommissionSen).toBe(21_900) // 30% of 73,000
    expect(result.closingIouSen).toBe(0)

    expect(result.foodPayoutSen).toBe(51_100)
    // Drinks keeps its own result and receives the host cut.
    expect(result.drinks.netResultSen).toBe(50_000 - 3_000)
    expect(result.drinksPayoutSen).toBe(47_000 + 21_900)
  })

  it('never takes a cut from a loss, and carries the deficit forward', () => {
    const result = settlePeriod({
      orders: [order([{ brandId: FOOD, netSen: 10_000 }])],
      expenses: [expense({ amountSen: 25_000, brandId: FOOD })],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [],
      ledger: [],
    })

    expect(result.food.netResultSen).toBe(-15_000)
    expect(result.hostCommissionSen).toBe(0)
    expect(result.closingIouSen).toBe(15_000)
    // Floored at zero. The loss carries forward as the IOU above — billing it
    // to the partner in cash as well would count the same loss twice.
    expect(result.foodPayoutSen).toBe(0)
  })

  it('recovers a carried deficit before the host cut resumes', () => {
    // Month 2: Food makes 20,000 but carries a 15,000 deficit.
    const result = settlePeriod({
      orders: [order([{ brandId: FOOD, netSen: 20_000 }])],
      expenses: [],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 15_000,
      outstandingAdvances: [],
      ledger: [],
    })

    expect(result.offsetResultSen).toBe(5_000)
    expect(result.hostCommissionSen).toBe(1_500) // 30% of the recovered 5,000, not of 20,000
    expect(result.closingIouSen).toBe(0)
    // Paid on what is left after the deficit, not on the raw 20,000 — otherwise
    // the hole never fills.
    expect(result.foodPayoutSen).toBe(3_500)
  })

  it('keeps carrying a deficit that this period could not clear', () => {
    const result = settlePeriod({
      orders: [order([{ brandId: FOOD, netSen: 5_000 }])],
      expenses: [],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 15_000,
      outstandingAdvances: [],
      ledger: [],
    })

    expect(result.hostCommissionSen).toBe(0)
    expect(result.closingIouSen).toBe(10_000)
  })

  it('excludes capital assets from the operating result', () => {
    const withAsset = settlePeriod({
      orders: [order([{ brandId: FOOD, netSen: 100_000 }])],
      expenses: [expense({ amountSen: 80_000, brandId: FOOD, category: 'CAPITAL_ASSET' })],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [],
      ledger: [],
    })

    // A freezer is real money out of the bank, but it is not a cost of trading.
    expect(withAsset.food.operatingExpensesSen).toBe(0)
    expect(withAsset.food.netResultSen).toBe(100_000)
  })

  it('uses the split stored on the expense, not the current setting', () => {
    // Logged back when the split was 50/50; the setting now says 70/30.
    const result = settlePeriod({
      orders: [order([{ brandId: FOOD, netSen: 100_000 }])],
      expenses: [
        expense({ amountSen: 10_000, brandId: null, foodSplitPct: 50, category: 'RENT' }),
      ],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [],
      ledger: [],
    })

    expect(result.food.sharedOverheadShareSen).toBe(5_000)
    expect(result.drinks.sharedOverheadShareSen).toBe(5_000)
  })
})

describe('out-of-pocket advances', () => {
  const rentPaidByDrinks = expense({
    amountSen: 1_000,
    brandId: null,
    foodSplitPct: 70,
    category: 'RENT',
    paidBy: 'PARTNER_DRINKS',
    isSettled: false,
  })

  it('reimburses the payer the full amount, not the counterparty share', () => {
    const result = settlePeriod({
      orders: [order([{ brandId: DRINKS, netSen: 10_000 }])],
      expenses: [rentPaidByDrinks],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [rentPaidByDrinks],
      ledger: [],
    })

    // Not 300 (their own share) and not 700 (the counterparty's) — all of it.
    expect(result.drinksAdvancesSen).toBe(1_000)
    expect(result.foodAdvancesSen).toBe(0)
  })

  it('leaves the books balanced against the bank', () => {
    // Both brands take 10,000. Rent of 1,000 is paid by the Drinks partner
    // personally, so it never leaves the stall account: the bank holds 20,000.
    const result = settlePeriod({
      orders: [
        order([
          { brandId: FOOD, netSen: 10_000 },
          { brandId: DRINKS, netSen: 10_000 },
        ]),
      ],
      expenses: [rentPaidByDrinks],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [rentPaidByDrinks],
      ledger: [],
    })

    // The results absorb their shares of the rent...
    expect(result.food.netResultSen).toBe(9_300)
    expect(result.drinks.netResultSen).toBe(9_700)
    // ...which leaves them 1,000 short of the cash actually sitting in the bank.
    expect(result.food.netResultSen + result.drinks.netResultSen).toBe(19_000)

    // Reimbursing the payer in full is exactly what closes that gap: the two
    // payouts must come to the 20,000 the bank is holding, with nothing left
    // over and nothing unaccounted for.
    expect(result.foodPayoutSen + result.drinksPayoutSen).toBe(20_000)
  })

  it('does not reimburse an advance that has already been settled', () => {
    const settled = { ...rentPaidByDrinks, isSettled: true }
    const result = settlePeriod({
      orders: [],
      expenses: [settled],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [settled],
      ledger: [],
    })

    expect(result.drinksAdvancesSen).toBe(0)
  })

  it('still reimburses an advance carried over from an earlier period', () => {
    // The expense is dated in August; this settles September. An outstanding
    // debt does not expire because the month rolled over.
    const august = { ...rentPaidByDrinks, businessDate: '2026-08-14' }
    const result = settlePeriod({
      orders: [order([{ brandId: DRINKS, netSen: 10_000 }])],
      expenses: [],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [august],
      ledger: [],
    })

    expect(result.drinksAdvancesSen).toBe(1_000)
    expect(result.drinksPayoutSen).toBe(10_000 + 1_000)
  })
})

describe('partner drawings', () => {
  function drawing(brandId: string, amountSen: number): LedgerEntry {
    return {
      id: 1,
      businessDate: '2026-09-04',
      entryAt: '2026-09-04T10:00:00Z',
      direction: 'MONEY_OUT',
      amountSen,
      category: 'OWNER_DRAWING',
      description: 'Drawing',
      brandId,
      orderId: null,
      shiftId: null,
    }
  }

  it('deducts what a partner already took from what they are paid', () => {
    const result = settlePeriod({
      orders: [order([{ brandId: FOOD, netSen: 100_000 }])],
      expenses: [],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [],
      ledger: [drawing(FOOD, 30_000)],
    })

    // 100,000 result, 30,000 host cut, so the share is 70,000 — less the
    // 30,000 already taken.
    expect(result.hostCommissionSen).toBe(30_000)
    expect(result.foodDrawingsSen).toBe(30_000)
    expect(result.foodPayoutSen).toBe(40_000)
  })

  it('keeps one partner drawing from touching the other payout', () => {
    const result = settlePeriod({
      orders: [
        order([
          { brandId: FOOD, netSen: 100_000 },
          { brandId: DRINKS, netSen: 50_000 },
        ]),
      ],
      expenses: [],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [],
      ledger: [drawing(FOOD, 30_000)],
    })

    expect(result.drinksDrawingsSen).toBe(0)
    expect(result.drinksPayoutSen).toBe(50_000 + 30_000)
  })

  it('leaves a partner owing when they drew more than they earned', () => {
    const result = settlePeriod({
      orders: [order([{ brandId: FOOD, netSen: 10_000 }])],
      expenses: [],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [],
      ledger: [drawing(FOOD, 50_000)],
    })

    // Share is 7,000 after the cut; they took 50,000. Not floored — hiding the
    // overdraw behind a zero would quietly write off the difference.
    expect(result.foodPayoutSen).toBe(7_000 - 50_000)
    expect(result.transfer.direction).toBe('FOOD_OWES_HOST')
    expect(result.transfer.amountSen).toBe(43_000)
  })

  it('ignores a drawing that is not a drawing', () => {
    const expenseEntry = { ...drawing(FOOD, 30_000), category: 'OPERATING_EXPENSE' as const }
    const result = settlePeriod({
      orders: [order([{ brandId: FOOD, netSen: 100_000 }])],
      expenses: [],
      settings: SETTINGS,
      foodBrandId: FOOD,
      drinksBrandId: DRINKS,
      openingIouSen: 0,
      outstandingAdvances: [],
      ledger: [expenseEntry],
    })

    expect(result.foodDrawingsSen).toBe(0)
  })
})

describe('transfer instruction', () => {
  const base = {
    expenses: [],
    settings: SETTINGS,
    foodBrandId: FOOD,
    drinksBrandId: DRINKS,
    openingIouSen: 0,
    outstandingAdvances: [],
    ledger: [],
  }

  it('says the host pays Food when Food is owed', () => {
    const result = settlePeriod({ ...base, orders: [order([{ brandId: FOOD, netSen: 100_000 }])] })
    expect(result.transfer).toEqual({ amountSen: 70_000, direction: 'HOST_PAYS_FOOD' })
  })

  it('says nothing moves when a loss leaves Food at zero', () => {
    const result = settlePeriod({
      ...base,
      orders: [order([{ brandId: FOOD, netSen: 10_000 }])],
      expenses: [expense({ amountSen: 25_000, brandId: FOOD })],
    })
    expect(result.transfer).toEqual({ amountSen: 0, direction: 'NOTHING' })
  })
})

describe('closure chain', () => {
  function closure(startDate: string, endDate: string, closingIouSen: number): PeriodClosure {
    return {
      id: `${startDate}..${endDate}`,
      startDate,
      endDate,
      closedAt: `${endDate}T12:00:00Z`,
      foodNetSalesSen: 0,
      foodDirectExpensesSen: 0,
      foodOverheadShareSen: 0,
      foodNetResultSen: 0,
      openingIouSen: 0,
      hostCommissionSen: 0,
      closingIouSen,
    }
  }

  it('starts from zero when nothing has ever been closed', () => {
    expect(openingDeficitFor([], '2026-09-01')).toBe(0)
  })

  it('carries the previous closure forward', () => {
    const closures = [closure('2026-08-01', '2026-08-31', 15_000)]
    expect(openingDeficitFor(closures, '2026-09-01')).toBe(15_000)
  })

  it('takes the most recent prior closure, not the first', () => {
    const closures = [
      closure('2026-07-01', '2026-07-31', 40_000),
      closure('2026-08-01', '2026-08-31', 15_000),
    ]
    expect(openingDeficitFor(closures, '2026-09-01')).toBe(15_000)
  })

  it('ignores closures that end after the period starts', () => {
    const closures = [closure('2026-09-01', '2026-09-30', 99_000)]
    expect(openingDeficitFor(closures, '2026-09-01')).toBe(0)
  })
})

describe('cashflow ledger', () => {
  function entry(id: number, businessDate: string, direction: 'MONEY_IN' | 'MONEY_OUT', amountSen: number): LedgerEntry {
    return {
      id,
      businessDate,
      entryAt: `${businessDate}T12:00:00Z`,
      direction,
      amountSen,
      category: direction === 'MONEY_IN' ? 'REVENUE' : 'OPERATING_EXPENSE',
      description: 'Test',
      brandId: null,
      orderId: null,
      shiftId: null,
    }
  }

  it('orders by business date, not by insertion, so a backdated entry sits in place', () => {
    const rows = withRunningBalance([
      entry(1, '2026-09-05', 'MONEY_IN', 10_000),
      entry(2, '2026-09-06', 'MONEY_IN', 5_000),
      // Entered last, but dated earlier — a receipt found in a pocket.
      entry(3, '2026-09-01', 'MONEY_OUT', 2_000),
    ])

    expect(rows.map((row) => row.businessDate)).toEqual([
      '2026-09-01',
      '2026-09-05',
      '2026-09-06',
    ])
    expect(rows.map((row) => row.balanceSen)).toEqual([-2_000, 8_000, 13_000])
  })

  it('breaks ties on the same date by insertion order', () => {
    const rows = withRunningBalance([
      entry(2, '2026-09-05', 'MONEY_OUT', 3_000),
      entry(1, '2026-09-05', 'MONEY_IN', 10_000),
    ])
    expect(rows.map((row) => row.id)).toEqual([1, 2])
    expect(rows.at(-1)?.balanceSen).toBe(7_000)
  })

  it('carries an opening balance', () => {
    const rows = withRunningBalance([entry(1, '2026-09-05', 'MONEY_IN', 1_000)], 50_000)
    expect(rows[0]?.balanceSen).toBe(51_000)
  })

  it('ends on the same figure the liquid balance reports', () => {
    const entries = [
      entry(1, '2026-09-01', 'MONEY_IN', 100_000),
      entry(2, '2026-09-02', 'MONEY_OUT', 30_000),
      entry(3, '2026-09-03', 'MONEY_OUT', 12_345),
    ]
    const rows = withRunningBalance(entries)
    expect(rows.at(-1)?.balanceSen).toBe(liquidBalance(entries))
  })
})
