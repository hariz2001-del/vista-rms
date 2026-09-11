import { ArrowRight, HandCoins, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { settlePeriod } from '../domain/finance.ts'
import { formatRinggit } from '../domain/money.ts'
import {
  formatDate,
  formatMonth,
  inMonth,
  monthOf,
  monthsIn,
  partnerAdvances,
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
  const months = useMemo(() => monthsIn(store.orders), [store.orders])
  const [month, setMonth] = useState(() => monthOf(store.today))

  const summary = useMemo(() => {
    if (!foodBrand || !drinksBrand) return null
    return settlePeriod({
      orders: inMonth(store.orders, month),
      expenses: inMonth(store.expenses, month),
      // Not scoped to the month: an unreimbursed advance from an earlier period
      // is still owed, and settling without it would leave the partner short.
      outstandingAdvances: store.expenses,
      settings: store.settings,
      foodBrandId: foodBrand.id,
      drinksBrandId: drinksBrand.id,
      // No month has been closed yet, so nothing is carried in. Once period
      // closure exists this reads the previous closure's closing balance.
      openingIouSen: 0,
    })
  }, [store.orders, store.expenses, store.settings, foodBrand, drinksBrand, month])

  const advances = useMemo(
    () => partnerAdvances(store.expenses),
    [store.expenses],
  )

  if (!summary || !foodBrand || !drinksBrand) return null

  const isMonthOver = month < monthOf(store.today)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="page-kicker">Partner working / period close</p>
          <h1 className="mt-1 text-3xl sm:text-[2.65rem]">Settlement</h1>
          <p className="mt-2 text-sm text-muted">
            {isMonthOver ? formatMonth(month) : `${formatMonth(month)} so far — still running`}
          </p>
        </div>
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

      <Panel className="bg-slate-50">
        <div className="flex flex-wrap items-center gap-3">
          <Lock aria-hidden="true" className="size-5 shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black">Close {formatMonth(month)}</p>
            <p className="text-xs font-semibold text-muted">
              Freezes these figures permanently. Needs both partners to sign off, and refuses while
              any shift is unreconciled or any sale is still flagged.
            </p>
          </div>
          <Badge tone="neutral">Not built yet</Badge>
        </div>
      </Panel>
    </div>
  )
}
