import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SettlementSummary } from '../domain/finance.ts'
import type {
  AccountSettings,
  Brand,
  CounterSession,
  Category,
  Expense,
  LedgerEntry,
  Order,
  Partner,
  PeriodClosure,
  Product,
  SaleCorrection,
  Shift,
  TerminalStatus,
} from '../domain/types.ts'
import { ApiError, apiRequest, SessionExpiredError } from '../lib/http.ts'
import type { BalanceAdjustment, MenuEdit, NewExpense, VistaStore } from './store.ts'

/**
 * The real books, read from api-vista.
 *
 * Returns exactly the shape of the demo store, so no screen knows which one it
 * is looking at. The whole snapshot is polled every few seconds — that is how a
 * sale rung at the counter appears on the owner's screen — and re-read straight
 * after every action, so a change the owner makes is visible at once.
 */

const POLL_MS = 5_000
const SETTINGS_DEBOUNCE_MS = 600

/**
 * Validated chart marks, assigned to brands in their fixed sort order. The brand
 * colours themselves fail the chart contrast floor, so charts never use them.
 */
const CHART_COLOURS = ['#e2601f', '#0a8fa0']
const FALLBACK_CHART_COLOUR = '#5b6770'

type Snapshot = {
  businessDate: string
  settings: AccountSettings
  brands: Array<Omit<Brand, 'chartColour'>>
  categories: Category[]
  products: Product[]
  partners: Partner[]
  shifts: Shift[]
  orders: Order[]
  corrections: SaleCorrection[]
  ledger: LedgerEntry[]
  expenses: Expense[]
  closures: PeriodClosure[]
  terminal: TerminalStatus
  counterSessions: CounterSession[]
}

const EMPTY_SETTINGS: AccountSettings = {
  businessName: 'Vista',
  outletName: '',
  settlementEnabled: false,
  sharedOverheadFoodPct: 0,
  hostCommissionPct: 0,
  capitalAssetFoodPct: 0,
}

const EMPTY_TERMINAL: TerminalStatus = {
  lastSeenAt: null,
  consecutiveSyncFailures: 0,
  unsentSaleCount: 0,
}

/** The route each menu change goes to. */
function menuRequest(edit: MenuEdit): ['POST' | 'PATCH' | 'DELETE', string, object?] {
  switch (edit.kind) {
    case 'addBrand':
      return ['POST', '/rms/brands', { name: edit.name, colour: edit.colour }]
    case 'updateBrand':
      return ['PATCH', `/rms/brands/${edit.id}`, { name: edit.name, colour: edit.colour }]
    case 'deleteBrand':
      return ['DELETE', `/rms/brands/${edit.id}`]
    case 'addCategory':
      return ['POST', '/rms/categories', { brandId: edit.brandId, name: edit.name }]
    case 'renameCategory':
      return ['PATCH', `/rms/categories/${edit.id}`, { name: edit.name }]
    case 'deleteCategory':
      return ['DELETE', `/rms/categories/${edit.id}`]
    case 'addProduct':
      return [
        'POST',
        '/rms/products',
        {
          categoryId: edit.categoryId,
          name: edit.name,
          description: edit.description,
          basePriceSen: edit.basePriceSen,
          imageUrl: edit.imageUrl,
        },
      ]
    case 'updateProduct':
      return ['PATCH', `/rms/products/${edit.id}`, edit.changes]
    case 'deleteProduct':
      return ['DELETE', `/rms/products/${edit.id}`]
    case 'addGroup':
      return [
        'POST',
        `/rms/products/${edit.productId}/groups`,
        { name: edit.name, minSelect: edit.minSelect, maxSelect: edit.maxSelect },
      ]
    case 'updateGroup':
      return [
        'PATCH',
        `/rms/groups/${edit.id}`,
        { name: edit.name, minSelect: edit.minSelect, maxSelect: edit.maxSelect },
      ]
    case 'deleteGroup':
      return ['DELETE', `/rms/groups/${edit.id}`]
    case 'addOption':
      return [
        'POST',
        `/rms/groups/${edit.groupId}/options`,
        { name: edit.name, priceSen: edit.priceSen, type: edit.type },
      ]
    case 'updateOption':
      return [
        'PATCH',
        `/rms/options/${edit.id}`,
        { name: edit.name, priceSen: edit.priceSen, type: edit.type, isSoldOut: edit.isSoldOut },
      ]
    case 'deleteOption':
      return ['DELETE', `/rms/options/${edit.id}`]
  }
}

function messageFor(error: unknown, action: string): string {
  if (error instanceof ApiError) return error.message
  return `${action} did not reach the server. Check the connection and try again.`
}

export function useApiStore(enabled: boolean): VistaStore {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** What the settings sliders show while a save is on its way. */
  const [settingsDraft, setSettingsDraft] = useState<AccountSettings | null>(null)
  const settingsTimer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await apiRequest<Snapshot>('GET', '/rms/snapshot'))
      setError(null)
    } catch (caught) {
      // A rejected token is handled by the sign-in listener in App.
      if (caught instanceof SessionExpiredError) return
      setError(messageFor(caught, 'Loading the books'))
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    // The request is async; the state update lands after it, not during the effect.
    // eslint-disable-next-line react/set-state-in-effect
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [enabled, refresh])

  /** Run one owner action, then re-read the books so the result shows at once. */
  const perform = useCallback(
    async (action: string, request: () => Promise<unknown>) => {
      try {
        await request()
        await refresh()
      } catch (caught) {
        if (caught instanceof SessionExpiredError) return
        setError(messageFor(caught, action))
      }
    },
    [refresh],
  )

  const addExpense = useCallback(
    (input: NewExpense) => {
      void perform('The expense', () => apiRequest('POST', '/rms/expenses', input))
    },
    [perform],
  )

  const adjustBalance = useCallback(
    (input: BalanceAdjustment) => {
      void perform('The adjustment', () => apiRequest('POST', '/rms/ledger/adjustments', input))
    },
    [perform],
  )

  const settleAdvance = useCallback(
    (expenseId: string) => {
      void perform('The reimbursement', () =>
        apiRequest('POST', `/rms/expenses/${expenseId}/settle`),
      )
    },
    [perform],
  )

  /**
   * The summary on screen is a preview. The server recomputes it from the
   * database and freezes its own figures, so only the window is sent.
   */
  const closePeriod = useCallback(
    (startDate: string, endDate: string, summary: SettlementSummary) => {
      void summary
      void perform('Settling the period', () =>
        apiRequest('POST', '/rms/periods/close', { startDate, endDate }),
      )
    },
    [perform],
  )

  const forceCloseShift = useCallback(
    (shiftId: string) => {
      void perform('Closing the counter', () =>
        apiRequest('POST', `/rms/shifts/${shiftId}/force-close`),
      )
    },
    [perform],
  )

  const toggleSoldOut = useCallback(
    (productId: string) => {
      const product = snapshot?.products.find((candidate) => candidate.id === productId)
      if (!product) return
      void perform('The menu change', () =>
        apiRequest('PATCH', `/rms/products/${productId}`, { isSoldOut: !product.isSoldOut }),
      )
    },
    [perform, snapshot],
  )

  const updatePrice = useCallback(
    (productId: string, basePriceSen: number) => {
      void perform('The price change', () =>
        apiRequest('PATCH', `/rms/products/${productId}`, { basePriceSen }),
      )
    },
    [perform],
  )

  /**
   * One change from the menu builder. Resolves true once saved and re-read, so
   * the form that sent it can close; false if it was refused, with the reason
   * shown in the error banner.
   */
  const editMenu = useCallback(
    async (edit: MenuEdit): Promise<boolean> => {
      const [method, path, body] = menuRequest(edit)
      try {
        await apiRequest(method, path, body)
        await refresh()
        return true
      } catch (caught) {
        if (!(caught instanceof SessionExpiredError)) setError(messageFor(caught, 'The menu change'))
        return false
      }
    },
    [refresh],
  )

  /**
   * The split sliders call this on every movement. The screen follows the draft
   * immediately; the save is sent once the owner stops dragging.
   */
  const setSettings = useCallback(
    (next: AccountSettings) => {
      setSettingsDraft(next)
      if (settingsTimer.current !== null) window.clearTimeout(settingsTimer.current)
      settingsTimer.current = window.setTimeout(() => {
        settingsTimer.current = null
        void perform('The settings', () => apiRequest('PUT', '/rms/settings', next)).finally(() =>
          setSettingsDraft(null),
        )
      }, SETTINGS_DEBOUNCE_MS)
    },
    [perform],
  )

  useEffect(
    () => () => {
      if (settingsTimer.current !== null) window.clearTimeout(settingsTimer.current)
    },
    [],
  )

  const renamePartner = useCallback(
    (partnerId: string, name: string) => {
      void perform('The partner name', () =>
        apiRequest('PUT', `/rms/partners/${partnerId}`, { name }),
      )
    },
    [perform],
  )

  /** Sends the counter tablet back to its sign-in screen on its next request. */
  const signOutCounter = useCallback(() => {
    void perform('Signing the counter out', () => apiRequest('POST', '/rms/counter/sign-out'))
  }, [perform])

  const dismissError = useCallback(() => setError(null), [])
  // Banner previews are a demo-mode affordance. Real terminal state comes from
  // the counter's heartbeat and nothing here may pretend otherwise.
  const simulateTerminal = useCallback((patch: Partial<TerminalStatus>) => void patch, [])
  const reopenDemoShift = useCallback(() => {}, [])

  const brands = useMemo<Brand[]>(
    () =>
      (snapshot?.brands ?? []).map((brand, index) => ({
        ...brand,
        chartColour: CHART_COLOURS[index] ?? FALLBACK_CHART_COLOUR,
      })),
    [snapshot?.brands],
  )

  return useMemo(
    () => ({
      settings: settingsDraft ?? snapshot?.settings ?? EMPTY_SETTINGS,
      setSettings,
      brands,
      categories: snapshot?.categories ?? [],
      products: snapshot?.products ?? [],
      orders: snapshot?.orders ?? [],
      corrections: snapshot?.corrections ?? [],
      shifts: snapshot?.shifts ?? [],
      expenses: snapshot?.expenses ?? [],
      ledger: snapshot?.ledger ?? [],
      partners: snapshot?.partners ?? [],
      counterSessions: snapshot?.counterSessions ?? [],
      renamePartner,
      signOutCounter,
      closures: snapshot?.closures ?? [],
      terminal: snapshot?.terminal ?? EMPTY_TERMINAL,
      today: snapshot?.businessDate ?? new Date().toISOString().slice(0, 10),
      closePeriod,
      forceCloseShift,
      reopenDemoShift,
      simulateTerminal,
      addExpense,
      adjustBalance,
      settleAdvance,
      toggleSoldOut,
      updatePrice,
      editMenu,
      canEditMenu: true,
      error,
      dismissError,
      isLoading: enabled && snapshot === null,
    }),
    [
      snapshot,
      settingsDraft,
      setSettings,
      brands,
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
      editMenu,
      error,
      dismissError,
      enabled,
    ],
  )
}
