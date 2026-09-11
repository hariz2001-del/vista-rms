import { ScanLine } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Money, Panel } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { withRunningBalance } from '../domain/finance.ts'
import { formatRinggit } from '../domain/money.ts'
import { formatDate, formatMonth, monthOf, monthsIn } from '../domain/selectors.ts'
import type { LedgerCategory, LedgerEntry } from '../domain/types.ts'

const CATEGORY_LABEL: Record<LedgerCategory, string> = {
  REVENUE: 'Sales',
  REFUND: 'Refund',
  OPERATING_EXPENSE: 'Operating expense',
  CAPITAL_INJECTION: 'Capital in',
  CAPITAL_ASSET: 'Equipment',
  OWNER_DRAWING: 'Partner drawing',
  LOAN_PROCEEDS: 'Loan received',
  LOAN_REPAYMENT: 'Loan repaid',
  RECONCILIATION_ADJUSTMENT: 'Reconciliation',
}

/**
 * Roll the day's individual sale entries into one line per brand.
 *
 * The API writes a revenue entry per order per brand, which is right for
 * traceability and unreadable as a cash book — 300 sales a day would bury every
 * expense, drawing and capital event in the ledger. The predecessor shipped
 * exactly this mistake: 64 shift closes produced ~288 near-identical rows and
 * the ledger stopped being something anyone opened.
 */
function groupDailySales(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const sales = new Map<string, LedgerEntry & { count: number }>()
  const rest: LedgerEntry[] = []

  for (const entry of entries) {
    if (entry.category !== 'REVENUE') {
      rest.push(entry)
      continue
    }
    const key = `${entry.businessDate}|${entry.brandId ?? 'none'}`
    const existing = sales.get(key)
    if (existing) {
      existing.amountSen += entry.amountSen
      existing.count += 1
      existing.id = Math.min(existing.id, entry.id)
    } else {
      sales.set(key, { ...entry, count: 1, orderId: null })
    }
  }

  const grouped = [...sales.values()].map((entry) => ({
    ...entry,
    description: `Sales · ${entry.count} order${entry.count === 1 ? '' : 's'}`,
  }))

  return [...grouped, ...rest]
}

export function CashflowScreen({ store }: { store: VistaStore }) {
  const months = useMemo(() => monthsIn(store.ledger), [store.ledger])
  const [month, setMonth] = useState<string>(() => monthOf(store.today))
  const [grouped, setGrouped] = useState(true)
  const [category, setCategory] = useState<'ALL' | LedgerCategory>('ALL')

  const brandName = (brandId: string | null) =>
    brandId === null ? 'Shared' : (store.brands.find((b) => b.id === brandId)?.name ?? '—')

  // Balance is cumulative, so it is computed over the whole ledger and then
  // sliced — never recomputed from the visible month, which would restart it
  // from zero and be quietly wrong.
  const rows = useMemo(() => {
    const source = grouped ? groupDailySales(store.ledger) : store.ledger
    const all = withRunningBalance(source)
    return all
      .filter((row) => monthOf(row.businessDate) === month)
      .filter((row) => category === 'ALL' || row.category === category)
      .toReversed()
  }, [store.ledger, grouped, month, category])

  const unreconciled = useMemo(
    () => store.shifts.filter((shift) => shift.reconciliationStatus === 'UNRECONCILED'),
    [store.shifts],
  )

  const monthTotals = useMemo(() => {
    const monthRows = withRunningBalance(store.ledger).filter(
      (row) => monthOf(row.businessDate) === month,
    )
    return {
      inSen: monthRows.reduce((sum, row) => sum + row.moneyInSen, 0),
      outSen: monthRows.reduce((sum, row) => sum + row.moneyOutSen, 0),
      closingSen: monthRows.at(-1)?.balanceSen ?? 0,
    }
  }, [store.ledger, month])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="border-b border-line pb-5">
        <p className="page-kicker">Money movement / cash book</p>
        <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Cashflow</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Every ringgit in and out. History is never edited — a correction is its own entry.
        </p>
      </div>

      {unreconciled.length > 0 ? (
        <Panel className="border-t-2 border-t-warning">
          <div className="flex flex-wrap items-center gap-3">
            <ScanLine aria-hidden="true" className="size-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">
                {unreconciled.length} shift{unreconciled.length === 1 ? '' : 's'} where the bank
                total did not match
              </p>
              <p className="text-xs font-semibold text-muted">
                Until you say what the difference was, this balance is incomplete.
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {unreconciled.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-wrap items-center gap-3 border border-amber-200 bg-amber-50 p-3"
              >
                <span className="text-sm font-black">{formatDate(shift.businessDate)}</span>
                <span className="text-xs font-semibold text-muted">
                  Recorded {formatRinggit(shift.systemNetSalesSen ?? 0)} · bank said{' '}
                  {formatRinggit(shift.declaredBankTotalSen ?? 0)}
                </span>
                <span className="tabular text-sm font-black text-serious">
                  {formatRinggit(shift.varianceSen ?? 0)}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  {['Bank fee', 'Sale never recorded', 'Cashier error'].map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => store.reconcileShift(shift.id, `${reason} · ${formatDate(shift.businessDate)}`)}
                      className="vista-button-primary"
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Money in</p>
          <p className="mt-1 text-xl font-black tabular text-good">
            {formatRinggit(monthTotals.inSen)}
          </p>
        </Panel>
        <Panel>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Money out</p>
          <p className="mt-1 text-xl font-black tabular text-serious">
            {formatRinggit(monthTotals.outSen)}
          </p>
        </Panel>
        <Panel>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Closing balance</p>
          <p className="mt-1 text-xl font-black tabular">{formatRinggit(monthTotals.closingSen)}</p>
        </Panel>
      </div>

      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="vista-control px-3"
          >
            {months.map((value) => (
              <option key={value} value={value}>
                {formatMonth(value)}
              </option>
            ))}
          </select>

          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as 'ALL' | LedgerCategory)}
            className="vista-control px-3"
          >
            <option value="ALL">All categories</option>
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <label className="ml-auto flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-muted">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(event) => setGrouped(event.target.checked)}
              className="size-4"
            />
            Roll up daily sales
          </label>
        </div>

        <div className="scrollbar-subtle -mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-muted">
                <th className="py-2 text-left font-bold">Date</th>
                <th className="py-2 text-left font-bold">Description</th>
                <th className="py-2 text-left font-bold">Category</th>
                <th className="py-2 text-left font-bold">Brand</th>
                <th className="py-2 text-right font-bold">Money in</th>
                <th className="py-2 text-right font-bold">Money out</th>
                <th className="py-2 text-right font-bold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.id}-${row.description}`} className="border-b border-slate-100">
                  <td className="whitespace-nowrap py-2 font-semibold">
                    {formatDate(row.businessDate)}
                  </td>
                  <td className="py-2 font-semibold text-ink">{row.description}</td>
                  <td className="py-2">
                    <Badge tone={row.category === 'RECONCILIATION_ADJUSTMENT' ? 'warning' : 'neutral'}>
                      {CATEGORY_LABEL[row.category]}
                    </Badge>
                  </td>
                  <td className="py-2 text-xs font-bold text-muted">{brandName(row.brandId)}</td>
                  <td className="py-2 text-right">
                    {row.moneyInSen > 0 ? <Money sen={row.moneyInSen} tone="in" /> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-2 text-right">
                    {row.moneyOutSen > 0 ? <Money sen={row.moneyOutSen} tone="out" /> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="py-2 text-right font-black tabular">
                    {formatRinggit(row.balanceSen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm font-semibold text-muted">
            Nothing in this month for that filter.
          </p>
        ) : (
          <p className="pt-3 text-xs font-semibold text-muted">
            {rows.length} entries · newest first.{' '}
            {grouped
              ? 'Daily sales are rolled up; untick to see every order.'
              : 'Showing every individual sale.'}
          </p>
        )}
      </Panel>
    </div>
  )
}
