import { useCallback, useMemo, useState } from 'react'
import type {
  AccountSettings,
  Expense,
  ExpenseCategory,
  LedgerEntry,
  Order,
  PaymentSource,
  Product,
  Shift,
} from '../domain/types.ts'
import { splitShared } from '../domain/finance.ts'
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
      today: TODAY,
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
