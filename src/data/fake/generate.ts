import type {
  Expense,
  LedgerEntry,
  Order,
  OrderLine,
  Partner,
  PeriodClosure,
  Shift,
} from '../../domain/types.ts'
import { BRAND_DRINKS, BRAND_FOOD, PRODUCTS } from './catalogue.ts'

/**
 * A stall's trading history, generated deterministically.
 *
 * The RMS is almost entirely derived views — ledgers, monthly settlements,
 * brand breakdowns. Thin data makes a bad dashboard look fine, so this produces
 * a realistic five weeks: weekday/weekend variation, a closed day each week,
 * rent and utilities on their usual dates, restocks, a partner-funded chiller
 * that has never been settled, two flagged sales, and one shift whose bank total
 * did not match.
 */

const SEED = 0x5153_7a11

/** mulberry32 — small, fast, and identical on every machine and every reload. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b_79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const rng = makeRng(SEED)
const pick = <T,>(items: readonly T[]): T => {
  const chosen = items[Math.floor(rng() * items.length)]
  if (!chosen) throw new Error('pick from empty list')
  return chosen
}
const between = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1))

const FOOD_PRODUCTS = PRODUCTS.filter((p) => p.brandId === BRAND_FOOD && !p.isSoldOut)
const DRINK_PRODUCTS = PRODUCTS.filter((p) => p.brandId === BRAND_DRINKS && !p.isSoldOut)

export const PERIOD_START = '2026-08-01'
export const TODAY = '2026-09-08'

function eachDate(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

export type FakeHistory = {
  shifts: Shift[]
  orders: Order[]
  ledger: LedgerEntry[]
  expenses: Expense[]
  partners: Partner[]
  closures: PeriodClosure[]
  tradingDates: string[]
}

export function generateHistory(): FakeHistory {
  const shifts: Shift[] = []
  const orders: Order[] = []
  const ledger: LedgerEntry[] = []
  const expenses: Expense[] = []

  let ledgerId = 1
  const addLedger = (entry: Omit<LedgerEntry, 'id'>): void => {
    ledger.push({ ...entry, id: ledgerId })
    ledgerId += 1
  }

  // Opening float the partners put in before trading started.
  addLedger({
    businessDate: PERIOD_START,
    entryAt: `${PERIOD_START}T02:00:00Z`,
    direction: 'MONEY_IN',
    amountSen: 500_000,
    category: 'CAPITAL_INJECTION',
    description: 'Opening capital · Food partner',
    brandId: BRAND_FOOD,
    orderId: null,
    shiftId: null,
  })
  addLedger({
    businessDate: PERIOD_START,
    entryAt: `${PERIOD_START}T02:05:00Z`,
    direction: 'MONEY_IN',
    amountSen: 500_000,
    category: 'CAPITAL_INJECTION',
    description: 'Opening capital · Drinks partner',
    brandId: BRAND_DRINKS,
    orderId: null,
    shiftId: null,
  })

  // Mondays closed.
  const tradingDates = eachDate(PERIOD_START, TODAY).filter((date) => weekday(date) !== 1)

  // Deliberate oddities, placed on known dates so the screens have something
  // real to surface rather than a uniformly happy month.
  const unreconciledDate = '2026-09-05'
  const flaggedOn = new Map([
    ['2026-08-22', 19],
    ['2026-09-06', 12],
  ])
  const offlineDate = '2026-09-03'

  for (const businessDate of tradingDates) {
    const shiftId = `shift-${businessDate}`
    const day = weekday(businessDate)
    const isWeekend = day === 5 || day === 6 || day === 0
    const orderCount = isWeekend ? between(38, 54) : between(20, 36)

    let queue = 0
    let dayNetSen = 0
    const dayNetByBrand = new Map<string, number>([
      [BRAND_FOOD, 0],
      [BRAND_DRINKS, 0],
    ])

    for (let i = 0; i < orderCount; i += 1) {
      queue += 1
      const roll = rng()
      const lineCount = roll < 0.45 ? 1 : roll < 0.8 ? 2 : 3
      const mixed = rng() < 0.42

      const lines: OrderLine[] = []
      for (let l = 0; l < lineCount; l += 1) {
        const useDrinks = mixed ? l % 2 === 1 : rng() < 0.32
        const product = pick(useDrinks ? DRINK_PRODUCTS : FOOD_PRODUCTS)
        const quantity = rng() < 0.85 ? 1 : 2
        // Add-ons roughly a third of the time.
        const modifierTotalSen = rng() < 0.34 ? pick([100, 150, 200, 250]) : 0
        lines.push({
          productName: product.name,
          brandId: product.brandId,
          categoryId: product.categoryId,
          quantity,
          unitPriceSen: product.basePriceSen,
          modifierTotalSen,
          lineDiscountSen: 0,
          allocatedOrderDiscountSen: 0,
        })
      }

      const grossSen = lines.reduce(
        (sum, line) => sum + (line.unitPriceSen + line.modifierTotalSen) * line.quantity,
        0,
      )

      // An order-level discount on roughly one ticket in twelve, apportioned
      // across lines the same way the POS and the API do it.
      let orderDiscountSen = 0
      if (rng() < 0.085) {
        orderDiscountSen = Math.min(pick([100, 200, 300, 500]), grossSen)
        let remaining = orderDiscountSen
        const bases = lines.map(
          (line) => (line.unitPriceSen + line.modifierTotalSen) * line.quantity,
        )
        const totalBase = bases.reduce((sum, base) => sum + base, 0)
        lines.forEach((line, index) => {
          const isLast = index === lines.length - 1
          const share = isLast
            ? remaining
            : Math.floor((orderDiscountSen * (bases[index] ?? 0)) / totalBase)
          line.allocatedOrderDiscountSen = share
          remaining -= share
        })
      }

      const totalAmountSen = grossSen - orderDiscountSen
      dayNetSen += totalAmountSen
      for (const line of lines) {
        const net =
          (line.unitPriceSen + line.modifierTotalSen) * line.quantity -
          line.lineDiscountSen -
          line.allocatedOrderDiscountSen
        dayNetByBrand.set(line.brandId, (dayNetByBrand.get(line.brandId) ?? 0) + net)
      }

      const isFlagged = flaggedOn.get(businessDate) === queue
      const isOffline = businessDate === offlineDate && queue === 7

      const orderId = `${businessDate}-${queue}`
      orders.push({
        id: orderId,
        shiftId,
        businessDate,
        queueNumber: `#${queue.toString().padStart(3, '0')}`,
        offlineLabel: isOffline ? '#OFF-01' : null,
        completedAt: `${businessDate}T${(12 + Math.floor(queue / 12)).toString().padStart(2, '0')}:${((queue * 7) % 60).toString().padStart(2, '0')}:00Z`,
        grossSen,
        lineDiscountSen: 0,
        orderDiscountSen,
        totalAmountSen,
        flagStatus: isFlagged ? 'FLAGGED' : 'NONE',
        flagReason: isFlagged ? 'Customer cancelled after paying' : null,
        needsReview: isOffline,
        reviewReason: isOffline
          ? 'Priced offline at RM 12.00; current menu gives RM 12.50.'
          : null,
        lines,
      })
    }

    // Revenue reaches the ledger per order in api-vista. Generated the same way
    // here so the Cashflow screen has to solve the readability problem for real
    // rather than being handed a tidy daily total.
    for (const order of orders.filter((o) => o.businessDate === businessDate)) {
      const byBrand = new Map<string, number>()
      for (const line of order.lines) {
        const net =
          (line.unitPriceSen + line.modifierTotalSen) * line.quantity -
          line.lineDiscountSen -
          line.allocatedOrderDiscountSen
        byBrand.set(line.brandId, (byBrand.get(line.brandId) ?? 0) + net)
      }
      for (const [brandId, amountSen] of byBrand) {
        if (amountSen <= 0) continue
        addLedger({
          businessDate,
          entryAt: order.completedAt,
          direction: 'MONEY_IN',
          amountSen,
          category: 'REVENUE',
          description: `Sale ${order.queueNumber}`,
          brandId,
          orderId: order.id,
          shiftId,
        })
      }
    }

    const isUnreconciled = businessDate === unreconciledDate
    const declared = isUnreconciled ? dayNetSen - 1_850 : dayNetSen
    shifts.push({
      id: shiftId,
      businessDate,
      openedAt: `${businessDate}T12:00:00Z`,
      closedAt: `${businessDate}T19:30:00Z`,
      systemNetSalesSen: dayNetSen,
      declaredBankTotalSen: declared,
      varianceSen: declared - dayNetSen,
      reconciliationStatus: isUnreconciled ? 'UNRECONCILED' : 'NOT_REQUIRED',
    })
  }

  // ---- Expenses -----------------------------------------------------------

  let expenseId = 1
  const addExpense = (input: Omit<Expense, 'id' | 'foodAmountSen' | 'drinksAmountSen'>): void => {
    const foodAmountSen =
      input.brandId === null
        ? Math.round((input.amountSen * input.foodSplitPct) / 100)
        : input.brandId === BRAND_FOOD
          ? input.amountSen
          : 0
    const expense: Expense = {
      ...input,
      id: `expense-${expenseId}`,
      foodAmountSen,
      drinksAmountSen: input.amountSen - foodAmountSen,
    }
    expenseId += 1
    expenses.push(expense)

    // Only money actually leaving the stall account reaches the ledger. A
    // partner paying out of pocket creates a debt, not an outflow.
    if (expense.paidBy === 'STALL_FUNDS') {
      addLedger({
        businessDate: expense.businessDate,
        entryAt: `${expense.businessDate}T08:00:00Z`,
        direction: 'MONEY_OUT',
        amountSen: expense.amountSen,
        category: expense.category === 'CAPITAL_ASSET' ? 'CAPITAL_ASSET' : 'OPERATING_EXPENSE',
        description: expense.description,
        brandId: expense.brandId,
        orderId: null,
        shiftId: null,
      })
    }
  }

  for (const month of ['2026-08', '2026-09']) {
    addExpense({
      businessDate: `${month}-01`,
      amountSen: 120_000,
      category: 'RENT',
      paidBy: 'STALL_FUNDS',
      brandId: null,
      foodSplitPct: 70,
      description: 'Stall rent',
      receiptUrl: null,
      isSettled: true,
      isLocked: false,
    })
    addExpense({
      businessDate: `${month}-05`,
      amountSen: between(31_000, 44_000),
      category: 'UTILITIES',
      paidBy: 'STALL_FUNDS',
      brandId: null,
      foodSplitPct: 70,
      description: 'Electricity and water',
      receiptUrl: null,
      isSettled: true,
      isLocked: false,
    })
  }

  for (const businessDate of tradingDates) {
    const day = weekday(businessDate)
    if (day === 2 || day === 4 || day === 6) {
      addExpense({
        businessDate,
        amountSen: between(18_000, 42_000),
        category: 'RAW_MATERIALS',
        paidBy: 'STALL_FUNDS',
        brandId: BRAND_FOOD,
        foodSplitPct: 100,
        description: 'Market restock · poultry and produce',
        receiptUrl: '/receipts/market.svg',
        isSettled: true,
        isLocked: false,
      })
    }
    if (day === 3 || day === 6) {
      addExpense({
        businessDate,
        amountSen: between(9_000, 26_000),
        category: 'RAW_MATERIALS',
        paidBy: 'STALL_FUNDS',
        brandId: BRAND_DRINKS,
        foodSplitPct: 0,
        description: 'Drinks restock · milk, syrup, ice',
        receiptUrl: null,
        isSettled: true,
        isLocked: false,
      })
    }
    if (day === 0) {
      addExpense({
        businessDate,
        amountSen: between(6_000, 13_000),
        category: 'PACKAGING',
        paidBy: 'STALL_FUNDS',
        brandId: null,
        foodSplitPct: 70,
        description: 'Packaging and consumables',
        receiptUrl: null,
        isSettled: true,
        isLocked: false,
      })
    }
  }

  // A shared capital asset the Drinks partner paid for personally and has not
  // been reimbursed for. Half of it is the Food partner's responsibility.
  addExpense({
    businessDate: '2026-08-14',
    amountSen: 240_000,
    category: 'CAPITAL_ASSET',
    paidBy: 'PARTNER_DRINKS',
    brandId: null,
    foodSplitPct: 50,
    description: 'Commercial chiller',
    receiptUrl: '/receipts/chiller.svg',
    isSettled: false,
    isLocked: false,
  })

  // The Food partner covering a shared bill out of pocket.
  addExpense({
    businessDate: '2026-09-02',
    amountSen: 18_500,
    category: 'MAINTENANCE',
    paidBy: 'PARTNER_FOOD',
    brandId: null,
    foodSplitPct: 70,
    description: 'Exhaust fan repair',
    receiptUrl: null,
    isSettled: false,
    isLocked: false,
  })

  // Drawings — real money out, but never an operating expense.
  for (const [date, brandId, amount, who] of [
    ['2026-08-20', BRAND_FOOD, 80_000, 'Food partner'],
    ['2026-08-28', BRAND_DRINKS, 60_000, 'Drinks partner'],
    ['2026-09-04', BRAND_FOOD, 50_000, 'Food partner'],
  ] as const) {
    addLedger({
      businessDate: date,
      entryAt: `${date}T10:00:00Z`,
      direction: 'MONEY_OUT',
      amountSen: amount,
      category: 'OWNER_DRAWING',
      description: `Drawing · ${who}`,
      brandId,
      orderId: null,
      shiftId: null,
    })
  }

  const partners: Partner[] = [
    { id: 'partner-food', name: 'Hariz', brandId: BRAND_FOOD, role: 'FOOD_OWNER' },
    { id: 'partner-drinks', name: 'Iman', brandId: BRAND_DRINKS, role: 'STALL_HOST' },
  ]

  return { shifts, orders, ledger, expenses, partners, closures: [], tradingDates }
}
