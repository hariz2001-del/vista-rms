import { Scale } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { DateRangePicker } from '../components/DateRangePicker.tsx'
import { Badge, Money, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { withRunningBalance } from '../domain/finance.ts'
import { formatRinggit, parseRinggitToSen } from '../domain/money.ts'
import { formatDate, formatRange, inRange, monthOf, type DateRange } from '../domain/selectors.ts'
import type { LedgerCategory, LedgerDirection, LedgerEntry } from '../domain/types.ts'

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
 *
 * Refunds are deliberately **not** rolled up. A counter correction is the one
 * thing in here nobody announced, so it always keeps its own visible line with
 * the cashier's reason on it rather than being netted into a day's total.
 */
function groupDailySales(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const sales = new Map<string, LedgerEntry & { count: number }>()
  const rest: LedgerEntry[] = []

  for (const entry of entries) {
    if (entry.category !== 'REVENUE' || entry.correctionId) {
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
  const [range, setRange] = useState<DateRange>(() => ({
    startDate: `${monthOf(store.today)}-01`,
    endDate: store.today,
  }))
  const [grouped, setGrouped] = useState(true)
  const [category, setCategory] = useState<'ALL' | LedgerCategory>('ALL')
  const [adjusting, setAdjusting] = useState(false)

  const brandName = (brandId: string | null) =>
    brandId === null ? 'Shared' : (store.brands.find((b) => b.id === brandId)?.name ?? '—')

  // Balance is cumulative, so it is computed over the whole ledger and then
  // sliced — never recomputed from the visible range, which would restart it
  // from zero and be quietly wrong.
  const rows = useMemo(() => {
    const source = grouped ? groupDailySales(store.ledger) : store.ledger
    const all = withRunningBalance(source)
    return inRange(all, range.startDate, range.endDate)
      .filter((row) => category === 'ALL' || row.category === category)
      .toReversed()
  }, [store.ledger, grouped, range, category])

  const totals = useMemo(() => {
    const periodRows = inRange(
      withRunningBalance(store.ledger),
      range.startDate,
      range.endDate,
    )
    return {
      inSen: periodRows.reduce((sum, row) => sum + row.moneyInSen, 0),
      outSen: periodRows.reduce((sum, row) => sum + row.moneyOutSen, 0),
      closingSen: periodRows.at(-1)?.balanceSen ?? 0,
    }
  }, [store.ledger, range])

  // Every closed shift in the window, newest first. The cashier declares no bank
  // figure at close, so this is what each shift recorded — for the owner to hold
  // up against the bank statement. It asks nothing of anyone.
  const closes = useMemo(
    () =>
      inRange(store.shifts, range.startDate, range.endDate)
        .filter((shift) => shift.closedAt !== null)
        .toSorted((a, b) => b.businessDate.localeCompare(a.businessDate)),
    [store.shifts, range],
  )

  // UNRECONCILED now means one thing: the takings moved after the shift closed,
  // because a sale or correction reached the server late.
  const changedAfterClose = closes.filter(
    (shift) => shift.reconciliationStatus === 'UNRECONCILED',
  )

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="page-kicker">Money movement / cash book</p>
          <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Cashflow</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Every ringgit in and out for {formatRange(range)}. History is never edited — a
            correction is its own entry.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdjusting(true)}
          className="vista-button-primary flex min-h-12 items-center gap-2 px-4"
        >
          <Scale aria-hidden="true" className="size-4" />
          Adjust balance
        </button>
      </div>

      <DateRangePicker value={range} onChange={setRange} today={store.today} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Money in</p>
          <p className="mt-1 text-xl font-black tabular text-good">
            {formatRinggit(totals.inSen)}
          </p>
        </Panel>
        <Panel>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Money out</p>
          <p className="mt-1 text-xl font-black tabular text-serious">
            {formatRinggit(totals.outSen)}
          </p>
        </Panel>
        <Panel>
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Closing balance</p>
          <p className="mt-1 text-xl font-black tabular">{formatRinggit(totals.closingSen)}</p>
        </Panel>
      </div>

      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3">
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
                    <Badge
                      tone={
                        row.category === 'RECONCILIATION_ADJUSTMENT'
                          ? 'warning'
                          : row.category === 'REFUND'
                            ? 'info'
                            : 'neutral'
                      }
                    >
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
            Nothing in this range for that filter.
          </p>
        ) : (
          <p className="pt-3 text-xs font-semibold text-muted">
            {rows.length} entries · newest first.{' '}
            {grouped
              ? 'Daily sales are rolled up; untick to see every order. Refunds always keep their own line.'
              : 'Showing every individual sale.'}
          </p>
        )}
      </Panel>

      {closes.length > 0 ? (
        <Panel>
          <SectionHeading
            title="Shift closes"
            hint="What each shift recorded when it closed. Check it against the bank statement; if something is off, use Adjust balance."
          />
          <div className="scrollbar-subtle -mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 text-left font-bold">Date</th>
                  <th className="py-2 pr-6 text-right font-bold">Takings recorded</th>
                  <th className="py-2 text-left font-bold">State</th>
                </tr>
              </thead>
              <tbody>
                {closes.map((shift) => (
                  <tr key={shift.id} className="border-b border-slate-100">
                    <td className="whitespace-nowrap py-2 font-semibold">
                      {formatDate(shift.businessDate)}
                    </td>
                    <td className="py-2 pr-6 text-right tabular">
                      {formatRinggit(shift.systemNetSalesSen ?? 0)}
                    </td>
                    <td className="py-2 text-xs font-bold text-muted">
                      {shift.reconciliationStatus === 'RECONCILED'
                        ? 'Adjusted'
                        : shift.reconciliationStatus === 'UNRECONCILED'
                          ? 'Changed after close'
                          : 'Closed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {changedAfterClose.length > 0 ? (
            <p className="pt-3 text-xs font-semibold text-muted">
              {changedAfterClose.length} shift{changedAfterClose.length === 1 ? '' : 's'} took a
              sale or correction after closing, so the takings above moved after the fact. Worth
              a look against the bank.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {adjusting ? (
        <AdjustBalanceDialog
          store={store}
          shifts={closes}
          onClose={() => setAdjusting(false)}
        />
      ) : null}
    </div>
  )
}

/**
 * The owner's one lever over the cash balance.
 *
 * Writes a single `RECONCILIATION_ADJUSTMENT` entry rather than editing
 * anything: a bank fee, a sale that never got rung up, a cashier's miscount.
 * Tying it to a shift is optional and only records which close prompted it; the
 * amount always comes from the owner, who has the bank statement in front of them.
 */
function AdjustBalanceDialog({
  store,
  shifts,
  onClose,
}: {
  store: VistaStore
  shifts: ReadonlyArray<VistaStore['shifts'][number]>
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [direction, setDirection] = useState<LedgerDirection>('MONEY_OUT')
  const [description, setDescription] = useState('')
  const [businessDate, setBusinessDate] = useState(store.today)
  const [shiftId, setShiftId] = useState<string>('')

  const amountSen = parseRinggitToSen(amount)
  const canSave = amountSen !== null && amountSen > 0 && description.trim().length > 0

  function pickShift(id: string) {
    setShiftId(id)
    const shift = shifts.find((candidate) => candidate.id === id)
    if (!shift) return
    setBusinessDate(shift.businessDate)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSave || amountSen === null) return
    store.adjustBalance({
      businessDate,
      amountSen,
      direction,
      description: description.trim(),
      shiftId: shiftId === '' ? null : shiftId,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adjust-balance"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg border border-line bg-surface p-6 shadow-2xl"
      >
        <h2 id="adjust-balance" className="text-xl font-black">
          Adjust the balance
        </h2>
        <p className="mt-2 text-sm text-muted">
          Writes one reconciliation entry in the cash book. Nothing already recorded changes.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="vista-field-label">Against a shift close (optional)</span>
            <select
              value={shiftId}
              onChange={(event) => pickShift(event.target.value)}
              className="vista-control mt-1 w-full px-3"
            >
              <option value="">Not tied to a shift</option>
              {shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {formatDate(shift.businessDate)} · {formatRinggit(shift.systemNetSalesSen ?? 0)}{' '}
                  recorded
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="vista-field-label">Amount (RM)</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className="vista-control mt-1 w-full px-3 tabular"
              />
            </label>
            <label className="block">
              <span className="vista-field-label">Date</span>
              <input
                type="date"
                value={businessDate}
                onChange={(event) => event.target.value && setBusinessDate(event.target.value)}
                className="vista-control mt-1 w-full px-3"
              />
            </label>
          </div>

          <div>
            <span className="vista-field-label">Direction</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('MONEY_IN')}
                aria-pressed={direction === 'MONEY_IN'}
                className={`min-h-12 border text-sm font-bold ${
                  direction === 'MONEY_IN'
                    ? 'border-good bg-good text-white'
                    : 'border-line bg-surface text-slate-700 hover:bg-canvas'
                }`}
              >
                Money in · balance was short
              </button>
              <button
                type="button"
                onClick={() => setDirection('MONEY_OUT')}
                aria-pressed={direction === 'MONEY_OUT'}
                className={`min-h-12 border text-sm font-bold ${
                  direction === 'MONEY_OUT'
                    ? 'border-serious bg-serious text-white'
                    : 'border-line bg-surface text-slate-700 hover:bg-canvas'
                }`}
              >
                Money out · balance was over
              </button>
            </div>
          </div>

          <label className="block">
            <span className="vista-field-label">What was it?</span>
            <input
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Bank transfer fee"
              className="vista-control mt-1 w-full px-3"
            />
            <span className="mt-1 block text-xs font-semibold text-muted">
              This is the only record of why the balance moved, so write it for someone reading
              it in six months.
            </span>
          </label>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="vista-button-secondary min-h-12">
            Cancel
          </button>
          <button type="submit" disabled={!canSave} className="vista-button-primary min-h-12">
            Write the entry
          </button>
        </div>
      </form>
    </div>
  )
}
