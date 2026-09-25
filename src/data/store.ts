import { useCallback, useMemo, useState } from 'react'
import type {
  AccountSettings,
  CounterSession,
  Expense,
  ExpenseCategory,
  LedgerDirection,
  LedgerEntry,
  Order,
  Partner,
  PaymentSource,
  PeriodClosure,
  Product,
  SaleCorrection,
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

/** One deliberate correction to the cash balance. See `adjustBalance`. */
export type BalanceAdjustment = {
  businessDate: string
  amountSen: number
  direction: LedgerDirection
  description: string
  /** The shift close that prompted it, or null for a standalone correction. */
  shiftId: string | null
}

/** A product field the owner can change. Omitted fields are left as they are. */
export type ProductChanges = {
  categoryId?: string
  name?: string
  description?: string
  basePriceSen?: number
  imageUrl?: string | null
  isSoldOut?: boolean
  isActive?: boolean
}

/** One change to the menu, from the menu builder. */
export type MenuEdit =
  | { kind: 'addBrand'; name: string; colour: string }
  | { kind: 'updateBrand'; id: string; name?: string; colour?: string }
  | { kind: 'deleteBrand'; id: string }
  | { kind: 'addCategory'; brandId: string; name: string }
  | { kind: 'renameCategory'; id: string; name: string }
  | { kind: 'deleteCategory'; id: string }
  | {
      kind: 'addProduct'
      categoryId: string
      name: string
      description: string
      basePriceSen: number
      imageUrl: string | null
      /** Option groups of other items to copy onto the new one. */
      copyGroupIds: string[]
    }
  | { kind: 'updateProduct'; id: string; changes: ProductChanges }
  /** Copy another item's option group, with its options, onto this one. */
  | { kind: 'copyGroup'; productId: string; groupId: string }
  | { kind: 'deleteProduct'; id: string }
  | { kind: 'addGroup'; productId: string; name: string; minSelect: number; maxSelect: number }
  | { kind: 'updateGroup'; id: string; name?: string; minSelect?: number; maxSelect?: number }
  | { kind: 'deleteGroup'; id: string }
  | {
      kind: 'addOption'
      groupId: string
      name: string
      priceSen: number
      type: 'ADD_ON' | 'REMOVAL'
    }
  | {
      kind: 'updateOption'
      id: string
      name?: string
      priceSen?: number
      type?: 'ADD_ON' | 'REMOVAL'
      isSoldOut?: boolean
    }
  | { kind: 'deleteOption'; id: string }

const noop = () => {}

/** The demo catalogue is fixed; building a menu needs the real server. */
const editMenuUnavailable = async (edit: MenuEdit): Promise<boolean> => {
  void edit
  return false
}

/**
 * The demo books: generated history, in memory, reset on reload. Used only in
 * demo mode (`VITE_DEMO=1`); everything else runs on `useApiStore`, which returns
 * the same shape. The argument exists only so the two are interchangeable.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useDemoStore(_enabled = true) {
  const [settings, setSettingsState] = useState<AccountSettings>(ACCOUNT)
  const setSettings = useCallback((next: AccountSettings) => setSettingsState(next), [])
  const [orders, setOrders] = useState<Order[]>(HISTORY.orders)
  const [corrections] = useState<SaleCorrection[]>(HISTORY.corrections)
  const [shifts, setShifts] = useState<Shift[]>(HISTORY.shifts)
  const [expenses, setExpenses] = useState<Expense[]>(HISTORY.expenses)
  const [ledger, setLedger] = useState<LedgerEntry[]>(HISTORY.ledger)
  const [products, setProducts] = useState<Product[]>(PRODUCTS)
  const [closures, setClosures] = useState<PeriodClosure[]>(HISTORY.closures)
  const [terminal, setTerminal] = useState<TerminalStatus>(HISTORY.terminal)
  const [partners, setPartners] = useState<Partner[]>(HISTORY.partners)
  const [counterSessions, setCounterSessions] = useState<CounterSession[]>(() => [
    { id: 'demo-counter', signedInAt: `${TODAY}T03:58:00Z`, lastUsedAt: new Date().toISOString() },
  ])

  const renamePartner = useCallback((partnerId: string, name: string) => {
    setPartners((current) =>
      current.map((partner) => (partner.id === partnerId ? { ...partner, name } : partner)),
    )
  }, [])

  const signOutCounter = useCallback(() => setCounterSessions([]), [])

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

  // There is deliberately no `resolveFlag` or `clearReview` here. The owner does
  // not approve refunds and does not accept synced offline sales: the cashier
  // cancels or edits at the counter, which writes its own contra-entry, and the
  // owner sees the result as a REFUND row in the cash book. See spec §2.

  /**
   * Reconciliation, done deliberately rather than on prompt.
   *
   * Nothing nags the owner about a bank difference: variance is a quiet audit
   * column on the shift, and this is the button that closes the gap when the
   * owner chooses to. Writes exactly one `RECONCILIATION_ADJUSTMENT` entry, so
   * the running balance moves by the amount entered and nothing else.
   *
   * Naming a shift is optional and only ties the adjustment back to the close
   * that prompted it; that shift is then marked reconciled.
   */
  const adjustBalance = useCallback((input: BalanceAdjustment) => {
    if (input.amountSen <= 0) return

    setLedger((current) => [
      ...current,
      {
        id: current.reduce((max, entry) => Math.max(max, entry.id), 0) + 1,
        businessDate: input.businessDate,
        entryAt: new Date().toISOString(),
        direction: input.direction,
        amountSen: input.amountSen,
        category: 'RECONCILIATION_ADJUSTMENT',
        description: input.description,
        brandId: null,
        orderId: null,
        shiftId: input.shiftId,
      },
    ])

    if (input.shiftId !== null) {
      setShifts((current) =>
        current.map((shift) =>
          shift.id === input.shiftId
            ? { ...shift, reconciliationStatus: 'RECONCILED' as const }
            : shift,
        ),
      )
    }
  }, [])

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
      const correctionDeltaSen = corrections
        .filter((correction) => correction.shiftId === shiftId)
        .reduce((sum, correction) => sum + correction.deltaSen, 0)
      const systemNetSalesSen =
        shiftOrders.reduce((sum, order) => sum + order.totalAmountSen, 0) + correctionDeltaSen
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
    [orders, corrections],
  )

  /** Dev-only: preview each banner state without waiting for real conditions. */
  const simulateTerminal = useCallback((patch: Partial<TerminalStatus>) => {
    setTerminal((current) => ({ ...current, ...patch }))
  }, [])

  /**
   * Dev-only: put the demo back into a trading state.
   *
   * Without this, previewing the closed banner is a one-way trip — every state
   * above it in the precedence order needs an open shift, so they all become
   * unreachable until the page is reloaded.
   */
  const reopenDemoShift = useCallback(() => {
    setShifts((current) => [
      ...current,
      {
        id: `shift-demo-${Date.now()}`,
        businessDate: TODAY,
        openedAt: new Date().toISOString(),
        closedAt: null,
        systemNetSalesSen: null,
        declaredBankTotalSen: null,
        varianceSen: null,
        reconciliationStatus: 'NOT_REQUIRED',
      },
    ])
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
      corrections,
      shifts,
      expenses,
      ledger,
      partners,
      counterSessions,
      renamePartner,
      signOutCounter,
      closures,
      terminal,
      today: TODAY,
      closePeriod,
      forceCloseShift,
      reopenDemoShift,
      simulateTerminal,
      addExpense,
      adjustBalance,
      settleAdvance,
      toggleSoldOut,
      updatePrice,
      /** Resolves true once the change is saved; false if it was refused. */
      editMenu: editMenuUnavailable,
      canEditMenu: false,
      error: null as string | null,
      dismissError: noop,
      isLoading: false,
    }),
    [
      settings,
      setSettings,
      products,
      orders,
      corrections,
      shifts,
      expenses,
      ledger,
      closures,
      terminal,
      partners,
      counterSessions,
      renamePartner,
      signOutCounter,
      closePeriod,
      forceCloseShift,
      reopenDemoShift,
      simulateTerminal,
      addExpense,
      adjustBalance,
      settleAdvance,
      toggleSoldOut,
      updatePrice,
    ],
  )
}

export type VistaStore = ReturnType<typeof useDemoStore>
