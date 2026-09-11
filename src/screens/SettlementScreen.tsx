import { AlertTriangle, ArrowRight, Banknote, HandCoins, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { openingDeficitFor, settlePeriod } from '../domain/finance.ts'
import { formatRinggit } from '../domain/money.ts'
import {
  formatDate,
  formatRange,
  inRange,
  monthOf,
  partnerAdvances,
  rangePresets,
} from '../domain/selectors.ts'

function WorkingRow({
  label,
  sen,
  hint,
  operator,
  emphasis = false,
}: {
  label: string
  sen: number
  hint?: string
  operator?: '−' | '+' | '='
  emphasis?: boolean
}) {
  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 ${
        emphasis ? 'border-t-2 border-slate-200 font-black' : 'border-t border-slate-100'
      }`}
    >
      <span className="w-4 shrink-0 text-center font-black text-muted">{operator ?? ''}</span>
      <span className={`min-w-0 flex-1 ${emphasis ? 'text-ink' : 'text-slate-700'} font-semibold`}>
        {label}
        {hint ? <span className="block text-xs font-semibold text-muted">{hint}</span> : null}
      </span>
      <span className={`tabular ${emphasis ? 'text-lg' : ''}`}>{formatRinggit(sen)}</span>
    </div>
  )
}

export function SettlementScreen({ store }: { store: VistaStore }) {
  const foodBrand = store.brands[0]
  const drinksBrand = store.brands[1]

  const presets = useMemo(() => rangePresets(store.today), [store.today])
  const [range, setRange] = useState(
    () => presets[0]?.range ?? { startDate: store.today, endDate: store.today },
  )

  const summary = useMemo(() => {
    if (!foodBrand || !drinksBrand) return null
    return settlePeriod({
      orders: inRange(store.orders, range.startDate, range.endDate),
      expenses: inRange(store.expenses, range.startDate, range.endDate),
      // Not scoped to the range: an unreimbursed advance from an earlier period
      // is still owed, and settling without it would leave the partner short.
      outstandingAdvances: store.expenses,
      // Drawings the partners already took inside this window.
      ledger: inRange(store.ledger, range.startDate, range.endDate),
      settings: store.settings,
      foodBrandId: foodBrand.id,
      drinksBrandId: drinksBrand.id,
      // Read from the closure chain, so a locked period's figures stay exactly
      // as both partners agreed them.
      openingIouSen: openingDeficitFor(store.closures, range.startDate),
    })
  }, [
    store.orders,
    store.expenses,
    store.ledger,
    store.closures,
    store.settings,
    foodBrand,
    drinksBrand,
    range,
  ])

  const [confirming, setConfirming] = useState(false)
  const advances = useMemo(() => partnerAdvances(store.expenses), [store.expenses])

  /**
   * Reasons this period cannot be frozen yet.
   *
   * Locking over an unreconciled shift or an unresolved flag would bake a figure
   * already known to be wrong into a snapshot both partners are paid against.
   */
  const blockers = useMemo(() => {
    const reasons: string[] = []
    const shifts = inRange(store.shifts, range.startDate, range.endDate)
    const orders = inRange(store.orders, range.startDate, range.endDate)

    const open = shifts.filter((shift) => shift.closedAt === null).length
    const unreconciled = shifts.filter(
      (shift) => shift.reconciliationStatus === 'UNRECONCILED',
    ).length
    const flagged = orders.filter((order) => order.flagStatus === 'FLAGGED').length
    const review = orders.filter((order) => order.needsReview).length

    if (open > 0) reasons.push(`${open} shift still open`)
    if (unreconciled > 0) reasons.push(`${unreconciled} shift with an unexplained bank difference`)
    if (flagged > 0) reasons.push(`${flagged} sale still flagged by the cashier`)
    if (review > 0) reasons.push(`${review} sale awaiting a price review`)
    return reasons
  }, [store.shifts, store.orders, range])

  const alreadyClosed = useMemo(
    () =>
      store.closures.some(
        (closure) =>
          closure.startDate === range.startDate && closure.endDate === range.endDate,
      ),
    [store.closures, range],
  )

  if (!summary || !foodBrand || !drinksBrand) return null

  const isCurrentPeriod = monthOf(range.endDate) === monthOf(store.today)
  const foodPartnerName =
    store.partners.find((partner) => partner.brandId === foodBrand.id)?.name ?? foodBrand.name
  const drinksPartnerName =
    store.partners.find((partner) => partner.brandId === drinksBrand.id)?.name ?? drinksBrand.name

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="page-kicker">Partner working / period close</p>
          <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Settlement</h1>
          <p className="mt-2 text-sm text-muted">
            {formatRange(range)}
            {isCurrentPeriod ? ' · still running' : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {presets.map((preset) => {
            const isActive =
              preset.range.startDate === range.startDate && preset.range.endDate === range.endDate
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setRange(preset.range)}
                className={`min-h-11 border px-3 text-sm font-bold ${
                  isActive ? 'border-rail bg-rail text-white' : 'border-line bg-surface text-slate-700'
                }`}
              >
                {preset.label}
              </button>
            )
          })}
          <label className="flex flex-col gap-1">
            <span className="vista-field-label">From</span>
            <input
              type="date"
              value={range.startDate}
              max={range.endDate}
              onChange={(event) => setRange({ ...range, startDate: event.target.value })}
              className="vista-control px-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="vista-field-label">To</span>
            <input
              type="date"
              value={range.endDate}
              min={range.startDate}
              onChange={(event) => setRange({ ...range, endDate: event.target.value })}
              className="vista-control px-2"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Food — the working, not just the answer. Both partners have to be
            able to check this line by line or they will not trust the payout. */}
        <Panel>
          <SectionHeading
            title={`${foodBrand.name} result`}
            hint={`Shared overheads split ${store.settings.sharedOverheadFoodPct}/${100 - store.settings.sharedOverheadFoodPct}.`}
          />
          <WorkingRow label="Net sales" sen={summary.food.netSalesSen} />
          <WorkingRow
            label="Direct expenses"
            hint="Stock and anything charged only to this brand"
            sen={summary.food.directExpensesSen}
            operator="−"
          />
          <WorkingRow
            label={`Share of shared overheads`}
            hint={`${store.settings.sharedOverheadFoodPct}% of ${formatRinggit(summary.sharedOverheadSen)}`}
            sen={summary.food.sharedOverheadShareSen}
            operator="−"
          />
          <WorkingRow label="Operating result" sen={summary.food.netResultSen} operator="=" emphasis />
        </Panel>

        <Panel>
          <SectionHeading
            title={`${drinksBrand.name} result`}
            hint={`${drinksBrand.name} keeps 100% of its own result.`}
          />
          <WorkingRow label="Net sales" sen={summary.drinks.netSalesSen} />
          <WorkingRow label="Direct expenses" sen={summary.drinks.directExpensesSen} operator="−" />
          <WorkingRow
            label="Share of shared overheads"
            hint={`${100 - store.settings.sharedOverheadFoodPct}% of ${formatRinggit(summary.sharedOverheadSen)}`}
            sen={summary.drinks.sharedOverheadShareSen}
            operator="−"
          />
          <WorkingRow label="Operating result" sen={summary.drinks.netResultSen} operator="=" emphasis />
        </Panel>
      </div>

      <Panel>
        <SectionHeading
          title="Host commission"
          hint={`The host takes ${store.settings.hostCommissionPct}% of the ${foodBrand.name} result. Never from a loss.`}
        />
        {summary.openingIouSen > 0 ? (
          <WorkingRow
            label="Deficit carried in from earlier months"
            hint="Recovered before the host's cut resumes"
            sen={summary.openingIouSen}
            operator="−"
          />
        ) : null}
        <WorkingRow label={`${foodBrand.name} result to share`} sen={summary.offsetResultSen} operator="=" />
        <WorkingRow
          label={`Host cut · ${store.settings.hostCommissionPct}%`}
          hint={
            summary.offsetResultSen <= 0
              ? 'Clamped to zero — the host never takes a share of a loss'
              : undefined
          }
          sen={summary.hostCommissionSen}
          operator="="
          emphasis
        />

        {summary.closingIouSen > 0 ? (
          <p className="mt-3 border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-warning">
            {formatRinggit(summary.closingIouSen)} of this month&apos;s loss carries forward. It must
            be recovered from future profit before the host&apos;s cut resumes — it is not forgiven.
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel className="border-t-4" style={{ borderTopColor: foodBrand.colour }}>
          <p className="vista-field-label">
            {foodBrand.name} partner takes
          </p>
          <p className="mt-1 text-3xl font-black tabular">
            {formatRinggit(summary.foodPayoutSen)}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted">
            {formatRinggit(summary.offsetResultSen)} after the carried deficit, less the{' '}
            {formatRinggit(summary.hostCommissionSen)} host cut
            {summary.foodAdvancesSen > 0
              ? `, plus ${formatRinggit(summary.foodAdvancesSen)} reimbursed`
              : ''}
            {summary.foodDrawingsSen > 0
              ? `, less ${formatRinggit(summary.foodDrawingsSen)} already drawn`
              : ''}
          </p>
        </Panel>
        <Panel className="border-t-4" style={{ borderTopColor: drinksBrand.colour }}>
          <p className="vista-field-label">
            {drinksBrand.name} partner takes
          </p>
          <p className="mt-1 text-3xl font-black tabular">
            {formatRinggit(summary.drinksPayoutSen)}
          </p>
          <p className="mt-1 text-xs font-semibold text-muted">
            Own result {formatRinggit(summary.drinks.netResultSen)} plus the{' '}
            {formatRinggit(summary.hostCommissionSen)} host cut
            {summary.drinksAdvancesSen > 0
              ? `, plus ${formatRinggit(summary.drinksAdvancesSen)} reimbursed`
              : ''}
            {summary.drinksDrawingsSen > 0
              ? `, less ${formatRinggit(summary.drinksDrawingsSen)} already drawn`
              : ''}
          </p>
        </Panel>
      </div>

      <Panel>
        <SectionHeading
          title="Between the partners"
          hint="Money a partner paid from their own pocket. The stall owes them all of it — both brands already bore their share through the operating results above."
        />
        {advances.length === 0 ? (
          <p className="py-6 text-center text-sm font-semibold text-muted">
            Nothing outstanding between partners.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {advances.map(({ expense, owedToPayerSen, payer: payerSide }) => {
              const payer = payerSide === 'FOOD' ? foodBrand : drinksBrand
              return (
                <li key={expense.id} className="flex flex-wrap items-center gap-3 py-3">
                  <HandCoins aria-hidden="true" className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black">{expense.description}</p>
                    <p className="text-xs font-semibold text-muted">
                      {formatDate(expense.businessDate)} · {payer.name} paid{' '}
                      {formatRinggit(expense.amountSen)}
                      {expense.brandId === null
                        ? `, split ${expense.foodSplitPct}/${100 - expense.foodSplitPct}`
                        : ''}
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-bold text-muted">
                    Stall <ArrowRight aria-hidden="true" className="size-3" /> {payer.name}
                  </span>
                  <span className="tabular text-sm font-black">{formatRinggit(owedToPayerSen)}</span>
                  <button
                    type="button"
                    onClick={() => store.settleAdvance(expense.id)}
                    className="vista-button-primary"
                  >
                    Mark reimbursed
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {/* The sentence a settlement has to end with. Two payout figures are a
          calculation; this is an instruction someone can actually act on. */}
      <Panel className="border-t-4" style={{ borderTopColor: 'var(--color-rail)' }}>
        <div className="flex flex-wrap items-center gap-3">
          <Banknote aria-hidden="true" className="size-5 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="vista-field-label">To settle this period</p>
            {summary.transfer.direction === 'HOST_PAYS_FOOD' ? (
              <p className="mt-1 text-lg font-black">
                {drinksPartnerName} transfers{' '}
                <span className="tabular">{formatRinggit(summary.transfer.amountSen)}</span> to{' '}
                {foodPartnerName}
              </p>
            ) : summary.transfer.direction === 'FOOD_OWES_HOST' ? (
              <p className="mt-1 text-lg font-black">
                {foodPartnerName} owes the stall{' '}
                <span className="tabular">{formatRinggit(summary.transfer.amountSen)}</span>
              </p>
            ) : (
              <p className="mt-1 text-lg font-black">Nothing moves — no payout is due.</p>
            )}
            <p className="mt-1 text-xs text-muted">
              The stall account is held by the host, so only the {foodBrand.name} payout leaves
              it. {drinksBrand.name}&apos;s share is already there.
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="bg-canvas">
        <div className="flex flex-wrap items-center gap-3">
          <Lock aria-hidden="true" className="size-5 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black">Lock &amp; settle {formatRange(range)}</p>
            <p className="text-xs text-muted">
              Freezes these figures permanently, marks everything in the window settled, and
              carries any unrecovered deficit into the next period.
            </p>
          </div>

          {alreadyClosed ? (
            <span className="border border-good px-3 py-2 text-xs font-bold text-good">
              Already settled
            </span>
          ) : (
            <button
              type="button"
              disabled={blockers.length > 0}
              onClick={() => setConfirming(true)}
              className="vista-button-primary min-h-11 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Lock &amp; Settle Period
            </button>
          )}
        </div>

        {blockers.length > 0 && !alreadyClosed ? (
          <div className="mt-3 flex gap-2 border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-warning">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div>
              <p>Cannot settle yet — these would be frozen at a figure already known to be wrong:</p>
              <ul className="mt-1 list-disc pl-4 font-semibold">
                {blockers.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Panel>

      {confirming ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-settle"
        >
          <div className="w-full max-w-md border border-line bg-surface p-6 shadow-2xl">
            <h2 id="confirm-settle" className="text-xl font-black">
              Settle {formatRange(range)}?
            </h2>
            <p className="mt-2 text-sm text-muted">
              This cannot be undone. The figures below are frozen and every order and expense in
              the window is locked.
            </p>

            <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-muted">{foodBrand.name} takes</dt>
                <dd className="font-black tabular">{formatRinggit(summary.foodPayoutSen)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted">{drinksBrand.name} takes</dt>
                <dd className="font-black tabular">{formatRinggit(summary.drinksPayoutSen)}</dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-muted">Host cut</dt>
                <dd className="font-black tabular">{formatRinggit(summary.hostCommissionSen)}</dd>
              </div>
              {summary.closingIouSen > 0 ? (
                <div className="flex justify-between py-2">
                  <dt className="text-muted">Deficit carried forward</dt>
                  <dd className="font-black tabular text-warning">
                    {formatRinggit(summary.closingIouSen)}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="vista-button-secondary min-h-12"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  store.closePeriod(range.startDate, range.endDate, summary)
                  setConfirming(false)
                }}
                className="vista-button-primary min-h-12"
              >
                Lock it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
