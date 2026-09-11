import type { Expense, Order, Shift, TerminalStatus } from './types.ts'
import { isOperatingExpense, orderNetByBrand } from './finance.ts'
import type { DailyPoint } from '../components/DailySalesChart.tsx'

/** `2026-09-08` → `2026-09`. */
export function monthOf(businessDate: string): string {
  return businessDate.slice(0, 7)
}

export function inMonth<T extends { businessDate: string }>(rows: readonly T[], month: string): T[] {
  return rows.filter((row) => monthOf(row.businessDate) === month)
}

export function monthsIn(rows: readonly { businessDate: string }[]): string[] {
  return [...new Set(rows.map((row) => monthOf(row.businessDate)))].toSorted()
}

export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`))
}

/** Inclusive on both ends. Business dates are `YYYY-MM-DD`, so string compare is date compare. */
export function inRange<T extends { businessDate: string }>(
  rows: readonly T[],
  startDate: string,
  endDate: string,
): T[] {
  return rows.filter((row) => row.businessDate >= startDate && row.businessDate <= endDate)
}

function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function endOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  if (year === undefined || monthNumber === undefined) throw new Error(`Bad month: ${month}`)
  return new Date(Date.UTC(year, monthNumber, 0, 12)).toISOString().slice(0, 10)
}

export type DateRange = { startDate: string; endDate: string }

/** The three ranges an owner actually asks for, relative to a given day. */
export function rangePresets(today: string): Array<{ label: string; range: DateRange }> {
  const thisMonth = monthOf(today)
  const [year, monthNumber] = thisMonth.split('-').map(Number)
  if (year === undefined || monthNumber === undefined) throw new Error(`Bad date: ${today}`)
  const previous = new Date(Date.UTC(year, monthNumber - 2, 1, 12)).toISOString().slice(0, 7)

  return [
    { label: 'This month', range: { startDate: `${thisMonth}-01`, endDate: today } },
    {
      label: 'Last month',
      range: { startDate: `${previous}-01`, endDate: endOfMonth(previous) },
    },
    { label: 'Last 30 days', range: { startDate: addDays(today, -29), endDate: today } },
  ]
}

export function formatRange({ startDate, endDate }: DateRange): string {
  return `${formatDate(startDate)} — ${formatDate(endDate)}`
}

export function formatDate(businessDate: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${businessDate}T12:00:00Z`))
}

export function dailyPoints(orders: readonly Order[], brandIds: readonly string[]): DailyPoint[] {
  const byDate = new Map<string, Record<string, number>>()

  for (const order of orders) {
    const bucket = byDate.get(order.businessDate) ?? Object.fromEntries(brandIds.map((id) => [id, 0]))
    for (const line of order.lines) {
      const net =
        (line.unitPriceSen + line.modifierTotalSen) * line.quantity -
        line.lineDiscountSen -
        line.allocatedOrderDiscountSen
      bucket[line.brandId] = (bucket[line.brandId] ?? 0) + net
    }
    byDate.set(order.businessDate, bucket)
  }

  return [...byDate.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([date, byBrand]) => ({
      date,
      byBrand,
      totalSen: Object.values(byBrand).reduce((sum, value) => sum + value, 0),
    }))
}

export type MonthSummary = {
  month: string
  netSalesSen: number
  discountsSen: number
  operatingExpensesSen: number
  operatingResultSen: number
  orderCount: number
  averageTicketSen: number
  netByBrand: Map<string, number>
}

export function summariseMonth(
  month: string,
  orders: readonly Order[],
  expenses: readonly Expense[],
): MonthSummary {
  const monthOrders = inMonth(orders, month)
  const monthExpenses = inMonth(expenses, month)

  const netSalesSen = monthOrders.reduce((sum, order) => sum + order.totalAmountSen, 0)
  const discountsSen = monthOrders.reduce(
    (sum, order) => sum + order.lineDiscountSen + order.orderDiscountSen,
    0,
  )
  const operatingExpensesSen = monthExpenses
    .filter(isOperatingExpense)
    .reduce((sum, expense) => sum + expense.amountSen, 0)

  return {
    month,
    netSalesSen,
    discountsSen,
    operatingExpensesSen,
    operatingResultSen: netSalesSen - operatingExpensesSen,
    orderCount: monthOrders.length,
    averageTicketSen: monthOrders.length === 0 ? 0 : Math.round(netSalesSen / monthOrders.length),
    netByBrand: orderNetByBrand(monthOrders),
  }
}

export type AttentionItem = {
  id: string
  kind: 'UNRECONCILED_SHIFT' | 'FLAGGED_SALE' | 'PRICE_REVIEW' | 'UNSETTLED_ADVANCE'
  title: string
  detail: string
  businessDate: string
  amountSen: number
}

/**
 * The one list the owner should look at first. Everything here is something a
 * person has to decide — none of it resolves itself.
 */
export function attentionItems(
  shifts: readonly Shift[],
  orders: readonly Order[],
  expenses: readonly Expense[],
): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const shift of shifts) {
    if (shift.reconciliationStatus !== 'UNRECONCILED') continue
    items.push({
      id: `shift-${shift.id}`,
      kind: 'UNRECONCILED_SHIFT',
      title: 'Bank total did not match',
      detail: 'Say what the difference was so the cashflow balance is complete.',
      businessDate: shift.businessDate,
      amountSen: shift.varianceSen ?? 0,
    })
  }

  for (const order of orders) {
    if (order.flagStatus === 'FLAGGED') {
      items.push({
        id: `flag-${order.id}`,
        kind: 'FLAGGED_SALE',
        title: `Sale ${order.queueNumber} flagged by the cashier`,
        detail: order.flagReason ?? 'No reason given.',
        businessDate: order.businessDate,
        amountSen: order.totalAmountSen,
      })
    }
    if (order.needsReview) {
      items.push({
        id: `review-${order.id}`,
        kind: 'PRICE_REVIEW',
        title: `Sale ${order.queueNumber} priced offline`,
        detail: order.reviewReason ?? 'Priced against a cached menu.',
        businessDate: order.businessDate,
        amountSen: order.totalAmountSen,
      })
    }
  }

  for (const expense of expenses) {
    if (expense.paidBy === 'STALL_FUNDS' || expense.isSettled) continue
    items.push({
      id: `advance-${expense.id}`,
      kind: 'UNSETTLED_ADVANCE',
      title: `${expense.description} paid out of pocket`,
      detail: 'The stall has not reimbursed this yet.',
      businessDate: expense.businessDate,
      amountSen: expense.amountSen,
    })
  }

  return items.toSorted((a, b) => b.businessDate.localeCompare(a.businessDate))
}

/**
 * Money a partner has paid out of their own pocket and not yet been reimbursed.
 *
 * The **stall** owes the payer the **full amount** — not the counterparty's
 * share of it. The expense has already been charged against both brands'
 * operating results through the usual split, so each side has borne its portion
 * there. Reimbursing only the other side's share would make the payer bear
 * their own portion twice.
 */
export function partnerAdvances(
  expenses: readonly Expense[],
): Array<{ expense: Expense; owedToPayerSen: number; payer: 'FOOD' | 'DRINKS' }> {
  return expenses
    .filter((expense) => expense.paidBy !== 'STALL_FUNDS' && !expense.isSettled)
    .map((expense) => ({
      expense,
      owedToPayerSen: expense.amountSen,
      payer: (expense.paidBy === 'PARTNER_FOOD' ? 'FOOD' : 'DRINKS') as 'FOOD' | 'DRINKS',
    }))
}

// ---------------------------------------------------------------------------
// The status banner
// ---------------------------------------------------------------------------

/** A tablet quiet for longer than this, mid-shift, is treated as disconnected. */
export const HEARTBEAT_GRACE_MINUTES = 10
/** Consecutive failures before it stops being a blip and becomes a fault. */
export const SYNC_FAILURE_THRESHOLD = 3

export type BannerState =
  | { kind: 'SYNC_FAILING'; failures: number }
  | { kind: 'TABLET_OFFLINE'; minutesSince: number; unsentSaleCount: number }
  | { kind: 'COUNTER_OPEN'; shiftId: string; openedAt: string; orderCount: number; takingsSen: number }
  | { kind: 'COUNTER_CLOSED'; lastClosedAt: string | null }

export function minutesSince(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000))
}

/**
 * Which single banner to show.
 *
 * One at a time, by strict precedence, so a green "all fine" line can never sit
 * on top of a red one. Everything here is **live state** that resolves itself —
 * anything needing a decision belongs in the attention list instead, or the two
 * views eventually disagree about the same fact.
 */
export function bannerState(
  shifts: readonly Shift[],
  orders: readonly Order[],
  terminal: TerminalStatus,
  now: Date,
): BannerState {
  const openShift = shifts.find((shift) => shift.closedAt === null)

  // 1 — something is actually broken.
  if (terminal.consecutiveSyncFailures >= SYNC_FAILURE_THRESHOLD) {
    return { kind: 'SYNC_FAILING', failures: terminal.consecutiveSyncFailures }
  }

  // 2 — the tablet has gone quiet mid-service. Only meaningful during a shift:
  // a silent tablet overnight is a closed stall, not a fault.
  const quietFor = minutesSince(terminal.lastSeenAt, now)
  if (openShift && quietFor > HEARTBEAT_GRACE_MINUTES) {
    return {
      kind: 'TABLET_OFFLINE',
      minutesSince: quietFor,
      unsentSaleCount: terminal.unsentSaleCount,
    }
  }

  // 3 — trading normally.
  if (openShift) {
    const shiftOrders = orders.filter((order) => order.shiftId === openShift.id)
    return {
      kind: 'COUNTER_OPEN',
      shiftId: openShift.id,
      openedAt: openShift.openedAt,
      orderCount: shiftOrders.length,
      takingsSen: shiftOrders.reduce((sum, order) => sum + order.totalAmountSen, 0),
    }
  }

  // 4 — resting.
  const lastClosed = shifts
    .filter((shift) => shift.closedAt !== null)
    .toSorted((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''))
    .at(-1)
  return { kind: 'COUNTER_CLOSED', lastClosedAt: lastClosed?.closedAt ?? null }
}
