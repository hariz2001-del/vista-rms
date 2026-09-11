import { useCallback, useMemo, useState } from 'react'
import type {
  AccountSettings,
  Expense,
  ExpenseCategory,
  LedgerEntry,
  Order,
  PaymentSource,
  PeriodClosure,
  Product,
  Shift,
  TerminalStatus,
} from '../domain/types.ts'
import { splitShared, type SettlementSummary } from '../domain/finance.ts'
import { ACCOUNT, BRANDS, CATEGORIES, HISTORY, PRODUCTS, TODAY } from './fake/index.ts'

/**
 * Stands in for the API. Everything here is in memory and resets on reload.
 *
 * The action names are deliberately the ones the real endpoints will have, so
 * replacing this module with `fetch` later is mechanical.
 */

export type NewExpense = {
  businessDate: string
  amountSen: number
  category: ExpenseCategory
  paidBy: PaymentSource
  brandId: string | null
  foodSplitPct: number
  description: string
}

export type FlagResolution = 'DISMISSED' | 'RESOLVED_REFUND' | 'RESOLVED_ADJUSTMENT'

export function useVistaStore() {
  const [settings, setSettings] = useState<AccountSettings>(ACCOUNT)
  const [orders, setOrders] = useState<Order[]>(HISTORY.orders)
  const [shifts, setShifts] = useState<Shift[]>(HISTORY.shifts)
  const [expenses, setExpenses] = useState<Expense[]>(HISTORY.expenses)
  const [ledger, setLedger] = useState<LedgerEntry[]>(HISTORY.ledger)
  const [products, setProducts] = useState<Product[]>(PRODUCTS)
  const [closures, setClosures] = useState<PeriodClosure[]>(HISTORY.closures)
  const [terminal, setTerminal] = useState<TerminalStatus>(HISTORY.terminal)

  const addExpense = useCallback(
    (input: NewExpense) => {
      const shared = input.brandId === null
      const { foodSen, drinksSen } = shared
        ? splitShared(input.amountSen, input.foodSplitPct)
        : input.brandId === BRANDS[0]?.id
          ? { foodSen: input.amountSen, drinksSen: 0 }
          : { foodSen: 0, drinksSen: input.amountSen }

      const expense: Expense = {
        id: `expense-${Date.now()}`,
        businessDate: input.businessDate,
        amountSen: input.amountSen,
        category: input.category,
        paidBy: input.paidBy,
        brandId: input.brandId,
        foodSplitPct: shared ? input.foodSplitPct : input.brandId === BRANDS[0]?.id ? 100 : 0,
        foodAmountSen: foodSen,
        drinksAmountSen: drinksSen,
        description: input.description,
        receiptUrl: null,
        isSettled: input.paidBy === 'STALL_FUNDS',
        isLocked: false,
      }

      setExpenses((current) => [expense, ...current])

      // Only money that actually left the stall account reaches the ledger. A
      // partner paying out of pocket creates a debt between partners instead.
      if (expense.paidBy === 'STALL_FUNDS') {
        setLedger((current) => [
          ...current,
          {
            id: current.reduce((max, entry) => Math.max(max, entry.id), 0) + 1,
            businessDate: expense.businessDate,
            entryAt: new Date().toISOString(),
            direction: 'MONEY_OUT',
            amountSen: expense.amountSen,
            category: expense.category === 'CAPITAL_ASSET' ? 'CAPITAL_ASSET' : 'OPERATING_EXPENSE',
            description: expense.description,
            brandId: expense.brandId,
            orderId: null,
            shiftId: null,
          },
        ])
      }
    },
    [],
  )

  /**
   * A paid sale is immutable. Resolving a flag never edits it — a refund writes
   * its own reversing entry, so the history stays auditable.
   */
  const resolveFlag = useCallback(
    (orderId: string, resolution: FlagResolution, note: string) => {
      const order = orders.find((candidate) => candidate.id === orderId)
      if (!order) return

      setOrders((current) =>
        current.map((candidate) =>
          candidate.id === orderId
            ? { ...candidate, flagStatus: resolution, flagReason: note || candidate.flagReason }
            : candidate,
        ),
      )

      if (resolution === 'RESOLVED_REFUND') {
        setLedger((current) => [
          ...current,
          {
            id: current.reduce((max, entry) => Math.max(max, entry.id), 0) + 1,
            businessDate: order.businessDate,
            entryAt: new Date().toISOString(),
            direction: 'MONEY_OUT',
            amountSen: order.totalAmountSen,
            category: 'REFUND',
            description: `Refund · sale ${order.queueNumber}`,
            brandId: null,
            orderId: order.id,
            shiftId: order.shiftId,
          },
        ])
      }
    },
    [orders],
  )

  const clearReview = useCallback((orderId: string) => {
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, needsReview: false, reviewReason: null } : order,
      ),
    )
  }, [])

  /**
   * The owner says what a shift's variance actually was. Shift close deliberately
   * leaves this open rather than guessing — the cashier is not asked to make an
   * accounting judgement mid-service — and this is where the ledger entry that
   * closes the gap gets written.
   */
  const reconcileShift = useCallback(
    (shiftId: string, description: string) => {
      const shift = shifts.find((candidate) => candidate.id === shiftId)
      // A zero variance has nothing to reconcile, and a null one means the shift
      // was never closed — neither should write a balancing entry.
      const varianceSen = shift?.varianceSen
      if (!shift || varianceSen === null || varianceSen === undefined || varianceSen === 0) return

      setShifts((current) =>
        current.map((candidate) =>
          candidate.id === shiftId
            ? { ...candidate, reconciliationStatus: 'RECONCILED' }
            : candidate,
        ),
      )

      setLedger((current) => [
        ...current,
        {
          id: current.reduce((max, entry) => Math.max(max, entry.id), 0) + 1,
          businessDate: shift.businessDate,
          entryAt: new Date().toISOString(),
          direction: varianceSen > 0 ? 'MONEY_IN' : 'MONEY_OUT',
          amountSen: Math.abs(varianceSen),
          category: 'RECONCILIATION_ADJUSTMENT',
          description,
          brandId: null,
          orderId: null,
          shiftId: shift.id,
        },
      ])
    },
    [shifts],
  )

  const settleAdvance = useCallback(
    (expenseId: string) => {
      const expense = expenses.find((candidate) => candidate.id === expenseId)
      if (!expense) return

      setExpenses((current) =>
        current.map((candidate) =>
          candidate.id === expenseId ? { ...candidate, isSettled: true } : candidate,
        ),
      )

      setLedger((current) => [
        ...current,
        {
          id: current.reduce((max, entry) => Math.max(max, entry.id), 0) + 1,
          businessDate: TODAY,
          entryAt: new Date().toISOString(),
          direction: 'MONEY_OUT',
          amountSen: expense.amountSen,
          category: expense.category === 'CAPITAL_ASSET' ? 'CAPITAL_ASSET' : 'OPERATING_EXPENSE',
          description: `Reimbursed · ${expense.description}`,
          brandId: expense.brandId,
          orderId: null,
          shiftId: null,
        },
      ])
    },
    [expenses],
  )

  /**
   * Freeze a settlement period.
   *
   * Writes the snapshot both partners agreed, marks everything inside the window
   * locked, and rolls any unrecovered deficit forward as the next period's
   * opening balance. Refuses while anything in the window is still undecided —
   * closing over an unreconciled shift or an unresolved flag would bake a figure
   * that is already known to be wrong.
   */
  const closePeriod = useCallback(
    (startDate: string, endDate: string, summary: SettlementSummary) => {
      setClosures((current) => [
        ...current,
        {
          id: `${startDate}..${endDate}`,
          startDate,
          endDate,
          closedAt: new Date().toISOString(),
          foodNetSalesSen: summary.food.netSalesSen,
          foodDirectExpensesSen: summary.food.directExpensesSen,
          foodOverheadShareSen: summary.food.sharedOverheadShareSen,
          foodNetResultSen: summary.food.netResultSen,
          openingIouSen: summary.openingIouSen,
          hostCommissionSen: summary.hostCommissionSen,
          closingIouSen: summary.closingIouSen,
        },
      ])

      const inWindow = (businessDate: string) =>
        businessDate >= startDate && businessDate <= endDate

      setOrders((current) =>
        current.map((order) => (inWindow(order.businessDate) ? { ...order, isLocked: true } : order)),
      )
      setExpenses((current) =>
        current.map((expense) =>
          inWindow(expense.businessDate) ? { ...expense, isLocked: true } : expense,
        ),
      )
      // Settling pays out every outstanding advance, so none carry into the next
      // period as still owed.
      setExpenses((current) =>
        current.map((expense) =>
          expense.paidBy === 'STALL_FUNDS' ? expense : { ...expense, isSettled: true },
        ),
      )
    },
    [],
  )

  /**
   * Close the counter from the dashboard.
   *
   * Only closes the database shift. Remotely locking the tablet back to its PIN
   * screen needs a push channel to the device, which the offline-first design
   * deliberately does not have — see VISTA-CORE-SPEC.md §15.
   */
  const forceCloseShift = useCallback(
    (shiftId: string) => {
      const shiftOrders = orders.filter((order) => order.shiftId === shiftId)
      const systemNetSalesSen = shiftOrders.reduce((sum, order) => sum + order.totalAmountSen, 0)
      setShifts((current) =>
        current.map((shift) =>
          shift.id === shiftId
            ? {
                ...shift,
                closedAt: new Date().toISOString(),
                systemNetSalesSen,
                // Nobody declared a bank total, so there is nothing to compare
                // against and the shift stays unreconciled until the owner does.
                declaredBankTotalSen: null,
                varianceSen: null,
                reconciliationStatus: 'UNRECONCILED' as const,
              }
            : shift,
        ),
      )
    },
    [orders],
  )

  /** Dev-only: preview each banner state without waiting for real conditions. */
  const simulateTerminal = useCallback((patch: Partial<TerminalStatus>) => {
    setTerminal((current) => ({ ...current, ...patch }))
  }, [])

  const toggleSoldOut = useCallback((productId: string) => {
    setProducts((current) =>
      current.map((product) =>
        product.id === productId ? { ...product, isSoldOut: !product.isSoldOut } : product,
      ),
    )
  }, [])

  const updatePrice = useCallback((productId: string, basePriceSen: number) => {
    setProducts((current) =>
      current.map((product) => (product.id === productId ? { ...product, basePriceSen } : product)),
    )
  }, [])

  return useMemo(
    () => ({
      settings,
      setSettings,
      brands: BRANDS,
      categories: CATEGORIES,
      products,
      orders,
      shifts,
      expenses,
      ledger,
      partners: HISTORY.partners,
      closures,
      terminal,
      today: TODAY,
      closePeriod,
      forceCloseShift,
      simulateTerminal,
      addExpense,
      resolveFlag,
      clearReview,
      reconcileShift,
      settleAdvance,
      toggleSoldOut,
      updatePrice,
    }),
    [
      settings,
      products,
      orders,
      shifts,
      expenses,
      ledger,
      closures,
      terminal,
      closePeriod,
      forceCloseShift,
      simulateTerminal,
      addExpense,
      resolveFlag,
      clearReview,
      reconcileShift,
      settleAdvance,
      toggleSoldOut,
      updatePrice,
    ],
  )
}

export type VistaStore = ReturnType<typeof useVistaStore>
