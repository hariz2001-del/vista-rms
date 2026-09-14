import type { Expense, Order, SaleCorrection, Shift, TerminalStatus } from './types.ts'
import { isOperatingExpense, orderNetByBrand } from './finance.ts'
import type { DailyPoint } from '../components/DailySalesChart.tsx'

/** `2026-09-08` → `2026-09`. */
export function monthOf(businessDate: string): string {
  return businessDate.slice(0, 7)
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

export function dailyPoints(
  orders: readonly Order[],
  brandIds: readonly string[],
  corrections: readonly SaleCorrection[] = [],
): DailyPoint[] {
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

  for (const correction of corrections) {
    const bucket =
      byDate.get(correction.businessDate) ?? Object.fromEntries(brandIds.map((id) => [id, 0]))
    for (const delta of correction.brandDeltas) {
      bucket[delta.brandId] = (bucket[delta.brandId] ?? 0) + delta.deltaSen
    }
    byDate.set(correction.businessDate, bucket)
  }

  return [...byDate.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([date, byBrand]) => ({
      date,
      byBrand,
      totalSen: Object.values(byBrand).reduce((sum, value) => sum + value, 0),
    }))
}

export type PeriodSummary = {
  range: DateRange
  netSalesSen: number
  discountsSen: number
  operatingExpensesSen: number
  operatingResultSen: number
  orderCount: number
  averageTicketSen: number
  netByBrand: Map<string, number>
}

export function summariseRange(
  range: DateRange,
  orders: readonly Order[],
  expenses: readonly Expense[],
  corrections: readonly SaleCorrection[] = [],
): PeriodSummary {
  const monthOrders = inRange(orders, range.startDate, range.endDate)
  const monthExpenses = inRange(expenses, range.startDate, range.endDate)
  const monthCorrections = inRange(corrections, range.startDate, range.endDate)

  const correctionDeltaSen = monthCorrections.reduce(
    (sum, correction) => sum + correction.deltaSen,
    0,
  )
  const netSalesSen =
    monthOrders.reduce((sum, order) => sum + order.totalAmountSen, 0) + correctionDeltaSen
  const discountsSen = monthOrders.reduce(
    (sum, order) => sum + order.lineDiscountSen + order.orderDiscountSen,
    0,
  )
  const operatingExpensesSen = monthExpenses
    .filter(isOperatingExpense)
    .reduce((sum, expense) => sum + expense.amountSen, 0)

  const netByBrand = orderNetByBrand(monthOrders)
  for (const correction of monthCorrections) {
    for (const delta of correction.brandDeltas) {
      netByBrand.set(delta.brandId, (netByBrand.get(delta.brandId) ?? 0) + delta.deltaSen)
    }
  }

  return {
    range,
    netSalesSen,
    discountsSen,
    operatingExpensesSen,
    operatingResultSen: netSalesSen - operatingExpensesSen,
    orderCount: monthOrders.length,
    averageTicketSen: monthOrders.length === 0 ? 0 : Math.round(netSalesSen / monthOrders.length),
    netByBrand,
  }
}

export type AttentionItem = {
  id: string
  kind: 'UNSETTLED_ADVANCE' | 'CORRECTION_ACTIVITY'
  title: string
  detail: string
  businessDate: string
  amountSen: number
  deltaSen: number | null
}

/**
 * Owner-visible work and security activity. Corrections need no approval, but
 * hiding direct cashier refunds in the cash book would remove the only practical
 * oversight control on that power.
 */
export function attentionItems(
  expenses: readonly Expense[],
  corrections: readonly SaleCorrection[] = [],
): AttentionItem[] {
  const advances = expenses
    .filter((expense) => expense.paidBy !== 'STALL_FUNDS' && !expense.isSettled)
    .map((expense) => ({
      id: `advance-${expense.id}`,
      kind: 'UNSETTLED_ADVANCE' as const,
      title: `${expense.description} paid out of pocket`,
      detail: 'The stall has not reimbursed this yet.',
      businessDate: expense.businessDate,
      amountSen: expense.amountSen,
      deltaSen: null,
    }))

  const correctionActivity = corrections.map((correction) => ({
    id: `correction-${correction.id}`,
    kind: 'CORRECTION_ACTIVITY' as const,
    title: `${correction.originalQueueNumber} ${correction.kind === 'CANCEL' ? 'cancelled' : 'edited'}`,
    detail: correction.reason,
    businessDate: correction.businessDate,
    amountSen: Math.abs(correction.deltaSen),
    deltaSen: correction.deltaSen,
  }))

  return [...advances, ...correctionActivity].toSorted((a, b) =>
    b.businessDate.localeCompare(a.businessDate),
  )
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
  | { kind: 'TABLET_OFFLINE'; minutesSince: number }
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
  corrections: readonly SaleCorrection[],
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
    // Only elapsed silence. A disconnected tablet cannot report how many sales
    // it is holding, and the server cannot know about sales it never received —
    // so any count here would be fiction.
    return { kind: 'TABLET_OFFLINE', minutesSince: quietFor }
  }

  // 3 — trading normally.
  if (openShift) {
    const shiftOrders = orders.filter((order) => order.shiftId === openShift.id)
    const correctionDeltaSen = corrections
      .filter((correction) => correction.shiftId === openShift.id)
      .reduce((sum, correction) => sum + correction.deltaSen, 0)
    return {
      kind: 'COUNTER_OPEN',
      shiftId: openShift.id,
      openedAt: openShift.openedAt,
      orderCount: shiftOrders.length,
      takingsSen:
        shiftOrders.reduce((sum, order) => sum + order.totalAmountSen, 0) + correctionDeltaSen,
    }
  }

  // 4 — resting.
  const lastClosed = shifts
    .filter((shift) => shift.closedAt !== null)
    .toSorted((a, b) => (a.closedAt ?? '').localeCompare(b.closedAt ?? ''))
    .at(-1)
  return { kind: 'COUNTER_CLOSED', lastClosedAt: lastClosed?.closedAt ?? null }
}
