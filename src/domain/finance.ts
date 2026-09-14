import type {
  AccountSettings,
  Expense,
  LedgerEntry,
  Order,
  PeriodClosure,
  SaleCorrection,
} from './types.ts'

/**
 * The partner settlement maths.
 *
 * Kept as pure functions with tests because this is what decides how much money
 * each partner actually takes home. It is also the place the predecessor product
 * got wrong: its profit figure subtracted a theoretical ingredient cost *and*
 * the restock purchases that were that same cost, so a healthy business rendered
 * as near break-even and nobody noticed for months.
 *
 * Vista avoids that by not computing COGS at all. There is exactly one subtraction:
 *
 *     Operating Result = Net Sales − Operating Expenses
 *
 * Capital asset purchases and owner drawings move real money but are NOT
 * operating expenses, so they never enter this calculation. They show in the
 * cashflow ledger and the liquid balance instead.
 */

/** Non-operating categories: real money, but not a cost of trading. */
const NON_OPERATING = new Set(['CAPITAL_ASSET'])

export function isOperatingExpense(expense: Expense): boolean {
  return !NON_OPERATING.has(expense.category)
}

/**
 * Split a shared amount so the parts sum to exactly the whole. The second share
 * is derived by subtraction rather than a second rounding, which is what
 * guarantees no sen is invented or lost.
 */
export function splitShared(
  amountSen: number,
  foodPct: number,
): { foodSen: number; drinksSen: number } {
  const foodSen = Math.round((amountSen * foodPct) / 100)
  return { foodSen, drinksSen: amountSen - foodSen }
}

export function orderNetByBrand(orders: readonly Order[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const order of orders) {
    for (const line of order.lines) {
      const net =
        (line.unitPriceSen + line.modifierTotalSen) * line.quantity -
        line.lineDiscountSen -
        line.allocatedOrderDiscountSen
      totals.set(line.brandId, (totals.get(line.brandId) ?? 0) + net)
    }
  }
  return totals
}

export type BrandFinancials = {
  brandId: string
  netSalesSen: number
  directExpensesSen: number
  sharedOverheadShareSen: number
  operatingExpensesSen: number
  netResultSen: number
}

export type SettlementSummary = {
  food: BrandFinancials
  drinks: BrandFinancials
  sharedOverheadSen: number
  /** Deficit carried in from previous periods, as a positive number. */
  openingIouSen: number
  /** Food's result after the carried deficit is offset against it. */
  offsetResultSen: number
  hostCommissionSen: number
  /** Deficit still unrecovered at the end of this period, as a positive number. */
  closingIouSen: number
  /** Out-of-pocket money each partner is being reimbursed in this settlement. */
  foodAdvancesSen: number
  drinksAdvancesSen: number
  /** Cash each partner already took during the period. Deducted from the payout. */
  foodDrawingsSen: number
  drinksDrawingsSen: number
  foodPayoutSen: number
  drinksPayoutSen: number
  /** What actually has to move when this is settled. See `transferInstruction`. */
  transfer: TransferInstruction
}

/**
 * The single sentence a settlement has to end with.
 *
 * The stall's bank account is operated by the host, so settling does not mean
 * two transfers out of a neutral account — it means the host pays the Food
 * partner what they are owed and retains their own share. If Food's payout
 * lands at or below zero there is nothing to send.
 */
export type TransferInstruction = {
  /** Positive: host → Food. Negative: Food owes the stall. Zero: nothing moves. */
  amountSen: number
  direction: 'HOST_PAYS_FOOD' | 'FOOD_OWES_HOST' | 'NOTHING'
}

type SettlementInput = {
  orders: readonly Order[]
  /**
   * Cashier cancels and exchanges in the period. The original sale is never
   * edited, so without these the partners would be paid on money that was
   * handed back to the customer. The server's period close folds them in the
   * same way; the preview here must agree with it.
   */
  corrections?: readonly SaleCorrection[]
  expenses: readonly Expense[]
  settings: AccountSettings
  foodBrandId: string
  drinksBrandId: string
  openingIouSen: number
  /**
   * Every partner-paid expense still unreimbursed, regardless of date — not
   * just this period's. An advance from August is still owed when September is
   * settled, so this is an outstanding balance, not a window.
   */
  outstandingAdvances: readonly Expense[]
  /**
   * Ledger entries for the period. Only `OWNER_DRAWING` rows are read: cash a
   * partner already took mid-period, which must come off what they are paid at
   * settlement or the same money leaves the business twice.
   */
  ledger: readonly LedgerEntry[]
}

/**
 * What a partner is reimbursed for paying a stall cost out of their own pocket.
 *
 * The full amount, not their counterparty's share. The expense has already been
 * charged against both brands' operating results through the usual split, so
 * each side has borne its portion there. Reimbursing only the counterparty's
 * share would make the payer bear their own portion twice — once through their
 * reduced result and again by never getting the cash back.
 *
 * Worked through: rent RM 1,000 split 70/30 and paid by Drinks. Food's result
 * drops 700, Drinks' drops 300, so the two results sum to RM 1,000 less than
 * the bank holds — because that rent never left the stall account. Handing
 * Drinks the full RM 1,000 is exactly what closes that gap.
 */
function advancesFor(expenses: readonly Expense[], paidBy: Expense['paidBy']): number {
  return expenses
    .filter((expense) => expense.paidBy === paidBy && !expense.isSettled)
    .reduce((sum, expense) => sum + expense.amountSen, 0)
}

/**
 * Cash a partner already took out during the period.
 *
 * A drawing is not an operating expense — it never touches either brand's
 * result — but it is money that has already left the bank and reached that
 * partner. Settling their full share on top of it would pay the same money out
 * twice, so it is deducted here and nowhere else.
 */
function drawingsFor(ledger: readonly LedgerEntry[], brandId: string): number {
  return ledger
    .filter((entry) => entry.category === 'OWNER_DRAWING' && entry.brandId === brandId)
    .reduce((sum, entry) => sum + entry.amountSen, 0)
}

/**
 * The deficit a period starts with: whatever the previous closure left unpaid.
 *
 * Read from the closure chain rather than recomputed, so a locked period's
 * figures stay exactly as both partners agreed them. Periods that have never
 * been closed start from zero.
 */
export function openingDeficitFor(
  closures: readonly PeriodClosure[],
  startDate: string,
): number {
  const previous = closures
    .filter((closure) => closure.endDate < startDate)
    .toSorted((a, b) => a.endDate.localeCompare(b.endDate))
    .at(-1)
  return previous?.closingIouSen ?? 0
}

function transferInstruction(foodPayoutSen: number): TransferInstruction {
  if (foodPayoutSen > 0) return { amountSen: foodPayoutSen, direction: 'HOST_PAYS_FOOD' }
  if (foodPayoutSen < 0) return { amountSen: -foodPayoutSen, direction: 'FOOD_OWES_HOST' }
  return { amountSen: 0, direction: 'NOTHING' }
}

function brandFinancials(
  brandId: string,
  netSalesSen: number,
  expenses: readonly Expense[],
  pick: (expense: Expense) => number,
): BrandFinancials {
  let directExpensesSen = 0
  let sharedOverheadShareSen = 0

  for (const expense of expenses) {
    if (!isOperatingExpense(expense)) continue
    // The stored split is a snapshot taken when the expense was logged. Using it
    // rather than recomputing from today's ratio is what stops a settings change
    // silently rewriting a past month.
    if (expense.brandId === brandId) directExpensesSen += expense.amountSen
    else if (expense.brandId === null) sharedOverheadShareSen += pick(expense)
  }

  const operatingExpensesSen = directExpensesSen + sharedOverheadShareSen
  return {
    brandId,
    netSalesSen,
    directExpensesSen,
    sharedOverheadShareSen,
    operatingExpensesSen,
    netResultSen: netSalesSen - operatingExpensesSen,
  }
}

/**
 * Settle one period.
 *
 * The carried deficit is absorbed **once**, before the commission is worked out,
 * and Food is then paid on what is left. That ordering matters: taking the
 * deficit off the commission basis but still paying Food on the full result
 * would mean the deficit never actually gets repaid and the hole never fills.
 *
 * The host takes a cut of what remains. When that is negative the cut is clamped
 * to zero — the host never takes a share of a loss — and Food's payout is
 * clamped to zero too, because the loss is carried forward rather than settled
 * in cash. It is not forgiven; it must be recovered from future profit before
 * either partner sees money from it again.
 */
export function settlePeriod(input: SettlementInput): SettlementSummary {
  const netByBrand = orderNetByBrand(input.orders)
  for (const correction of input.corrections ?? []) {
    for (const delta of correction.brandDeltas) {
      netByBrand.set(delta.brandId, (netByBrand.get(delta.brandId) ?? 0) + delta.deltaSen)
    }
  }

  const food = brandFinancials(
    input.foodBrandId,
    netByBrand.get(input.foodBrandId) ?? 0,
    input.expenses,
    (expense) => expense.foodAmountSen,
  )
  const drinks = brandFinancials(
    input.drinksBrandId,
    netByBrand.get(input.drinksBrandId) ?? 0,
    input.expenses,
    (expense) => expense.drinksAmountSen,
  )

  const sharedOverheadSen = input.expenses
    .filter((expense) => isOperatingExpense(expense) && expense.brandId === null)
    .reduce((sum, expense) => sum + expense.amountSen, 0)

  const offsetResultSen = food.netResultSen - input.openingIouSen

  const hostCommissionSen =
    offsetResultSen > 0
      ? Math.round((offsetResultSen * input.settings.hostCommissionPct) / 100)
      : 0
  const closingIouSen = offsetResultSen < 0 ? -offsetResultSen : 0

  const foodAdvancesSen = advancesFor(input.outstandingAdvances, 'PARTNER_FOOD')
  const drinksAdvancesSen = advancesFor(input.outstandingAdvances, 'PARTNER_DRINKS')

  const foodDrawingsSen = drawingsFor(input.ledger, input.foodBrandId)
  const drinksDrawingsSen = drawingsFor(input.ledger, input.drinksBrandId)

  // Floored at zero: a loss carries forward as the IOU above rather than being
  // billed to the partner in cash. Without the floor the same loss would be
  // counted twice — once as a negative payout and again as a carried deficit.
  const foodShareSen = Math.max(0, offsetResultSen - hostCommissionSen)

  // Drawings are NOT floored. Drawing more than you earned leaves you owing the
  // stall, and hiding that behind a zero would quietly write the difference off.
  const foodPayoutSen = foodShareSen + foodAdvancesSen - foodDrawingsSen
  const drinksPayoutSen =
    drinks.netResultSen + hostCommissionSen + drinksAdvancesSen - drinksDrawingsSen

  return {
    food,
    drinks,
    sharedOverheadSen,
    openingIouSen: input.openingIouSen,
    offsetResultSen,
    hostCommissionSen,
    closingIouSen,
    foodAdvancesSen,
    drinksAdvancesSen,
    foodDrawingsSen,
    drinksDrawingsSen,
    foodPayoutSen,
    // The host is the Drinks partner: they keep all of Drinks and take the cut.
    drinksPayoutSen,
    transfer: transferInstruction(foodPayoutSen),
  }
}

// ---------------------------------------------------------------------------
// Cashflow
// ---------------------------------------------------------------------------

export type LedgerRow = LedgerEntry & {
  moneyInSen: number
  moneyOutSen: number
  balanceSen: number
}

/**
 * Running balance over the ledger.
 *
 * Ordered by business date first and insertion id second, never by id alone.
 * Entries get backdated routinely — a receipt entered on the 8th for the 3rd —
 * and ordering by insertion would drop it at the bottom of the book with a
 * balance beside it that means nothing.
 */
export function withRunningBalance(
  entries: readonly LedgerEntry[],
  openingBalanceSen = 0,
): LedgerRow[] {
  const ordered = entries.toSorted(
    (a, b) => a.businessDate.localeCompare(b.businessDate) || a.id - b.id,
  )

  let balanceSen = openingBalanceSen
  return ordered.map((entry) => {
    const moneyInSen = entry.direction === 'MONEY_IN' ? entry.amountSen : 0
    const moneyOutSen = entry.direction === 'MONEY_OUT' ? entry.amountSen : 0
    balanceSen += moneyInSen - moneyOutSen
    return { ...entry, moneyInSen, moneyOutSen, balanceSen }
  })
}

export function liquidBalance(entries: readonly LedgerEntry[]): number {
  return entries.reduce(
    (sum, entry) => sum + (entry.direction === 'MONEY_IN' ? entry.amountSen : -entry.amountSen),
    0,
  )
}
