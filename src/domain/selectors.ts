import type { Expense, Order, Shift } from './types.ts'
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
