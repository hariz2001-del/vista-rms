import { AlertTriangle, ArrowRight, Flag, HandCoins, ScanLine } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DailySalesChart } from '../components/DailySalesChart.tsx'
import { Badge, Money, Panel, SectionHeading, StatTile } from '../components/primitives.tsx'
import type { ScreenKey } from '../components/AppShell.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit } from '../domain/money.ts'
import { liquidBalance } from '../domain/finance.ts'
import {
  attentionItems,
  dailyPoints,
  formatDate,
  formatMonth,
  inMonth,
  monthsIn,
  monthOf,
  summariseMonth,
} from '../domain/selectors.ts'

const KIND_META = {
  UNRECONCILED_SHIFT: { icon: ScanLine, tone: 'warning' as const, label: 'Bank mismatch' },
  FLAGGED_SALE: { icon: Flag, tone: 'critical' as const, label: 'Flagged' },
  PRICE_REVIEW: { icon: AlertTriangle, tone: 'warning' as const, label: 'Price review' },
  UNSETTLED_ADVANCE: { icon: HandCoins, tone: 'info' as const, label: 'Owed to partner' },
}

export function OverviewScreen({
  store,
  onNavigate,
}: {
  store: VistaStore
  onNavigate: (key: ScreenKey) => void
}) {
  const months = useMemo(() => monthsIn(store.orders), [store.orders])
  const [month, setMonth] = useState(() => monthOf(store.today))

  const summary = useMemo(
    () => summariseMonth(month, store.orders, store.expenses),
    [month, store.orders, store.expenses],
  )
  const points = useMemo(
    () =>
      dailyPoints(
        inMonth(store.orders, month),
        store.brands.map((brand) => brand.id),
      ),
    [store.orders, store.brands, month],
  )
  const attention = useMemo(
    () => attentionItems(store.shifts, store.orders, store.expenses),
    [store.shifts, store.orders, store.expenses],
  )

  const balanceSen = liquidBalance(store.ledger)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="page-kicker">Owner ledger / {formatMonth(month)}</p>
          <h1 className="mt-1 text-3xl sm:text-[2.65rem]">The month, at a glance</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Sales, cash position and the decisions still waiting on you.
          </p>
        </div>
        <label className="flex items-center gap-2 font-mono text-[0.7rem] font-bold uppercase tracking-[0.06em] text-muted">
          Month
          <select
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="min-h-10 border border-line bg-surface px-3 font-sans text-sm font-bold normal-case tracking-normal text-ink"
          >
            {months.map((value) => (
              <option key={value} value={value}>
                {formatMonth(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {attention.length > 0 ? (
        <Panel className="border-t-2 border-t-warning lg:p-5">
          <SectionHeading
            title="Owner's desk"
            hint={`${attention.length} open decision${attention.length === 1 ? '' : 's'}. Each needs a human call before the books are complete.`}
          />
          <ul className="divide-y divide-slate-100">
            {attention.map((item) => {
              const meta = KIND_META[item.kind]
              const Icon = meta.icon
              const orderId = item.id.replace(/^(flag|review)-/, '')
              return (
                <li key={item.id} className="grid gap-2 py-3.5 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3 lg:grid-cols-[1.25rem_minmax(0,1fr)_auto_auto_auto]">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-ink">{item.title}</p>
                    <p className="text-xs font-semibold text-muted">
                      {formatDate(item.businessDate)} · {item.detail}
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="font-mono text-sm font-bold tabular">{formatRinggit(item.amountSen)}</span>

                  {/*
                    A paid sale is immutable, so nothing here edits one. A refund
                    writes its own reversing entry; dismissing just records the
                    decision. The other two kinds are resolved where the money
                    lives, so they link rather than act.
                  */}
                  <div className="flex flex-wrap gap-2 sm:col-start-2 sm:col-end-5 sm:pl-0 lg:col-auto lg:pl-2">
                    {item.kind === 'FLAGGED_SALE' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => store.resolveFlag(orderId, 'RESOLVED_REFUND', 'Refunded by owner')}
                          className="min-h-9 bg-rail px-3 text-xs font-bold text-white transition-colors hover:bg-[#24554a]"
                        >
                          Refund
                        </button>
                        <button
                          type="button"
                          onClick={() => store.resolveFlag(orderId, 'DISMISSED', 'No action needed')}
                          className="min-h-9 border border-line px-3 text-xs font-bold text-muted hover:bg-canvas"
                        >
                          Dismiss
                        </button>
                      </>
                    ) : null}

                    {item.kind === 'PRICE_REVIEW' ? (
                      <button
                        type="button"
                        onClick={() => store.clearReview(orderId)}
                        className="min-h-9 bg-rail px-3 text-xs font-bold text-white transition-colors hover:bg-[#24554a]"
                      >
                        Accept
                      </button>
                    ) : null}

                    {item.kind === 'UNRECONCILED_SHIFT' ? (
                      <button
                        type="button"
                        onClick={() => onNavigate('cashflow')}
                        className="min-h-9 border border-line px-3 text-xs font-bold text-muted hover:bg-canvas"
                      >
                        Reconcile
                      </button>
                    ) : null}

                    {item.kind === 'UNSETTLED_ADVANCE' ? (
                      <button
                        type="button"
                        onClick={() => onNavigate('settlement')}
                        className="min-h-9 border border-line px-3 text-xs font-bold text-muted hover:bg-canvas"
                      >
                        Settle
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>
      ) : null}

      <section aria-label="Monthly financial summary" className="grid border border-line bg-surface sm:grid-cols-2">
        <StatTile
          hero
          label="Operating result"
          value={<Money sen={summary.operatingResultSen} tone={summary.operatingResultSen >= 0 ? 'in' : 'out'} />}
          sub="Net sales minus operating expenses. Cost of goods is not tracked, so this is not accounting profit."
          tone={summary.operatingResultSen >= 0 ? 'good' : 'critical'}
          className="border-t-0 sm:border-r sm:border-r-line"
        />
        <StatTile
          hero
          label="Money in the bank"
          value={<Money sen={balanceSen} />}
          sub="Every inflow and outflow to date, including capital and drawings."
          className="border-t-line sm:border-t-0"
        />
      </section>

      <section aria-label="Monthly activity" className="grid grid-cols-2 border border-line bg-surface lg:grid-cols-4">
        <StatTile className="border-t-0 border-r border-r-line" label="Net sales" value={<Money sen={summary.netSalesSen} />} />
        <StatTile
          className="border-t-0 lg:border-r lg:border-r-line"
          label="Discounts given"
          value={<Money sen={summary.discountsSen} tone="muted" />}
          sub="Reduces sales, not a cash expense"
        />
        <StatTile className="border-r border-r-line lg:border-t-0" label="Operating expenses" value={<Money sen={summary.operatingExpensesSen} />} />
        <StatTile
          className="lg:border-t-0"
          label="Orders"
          value={summary.orderCount.toLocaleString('en-MY')}
          sub={`${formatRinggit(summary.averageTicketSen)} average`}
        />
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(17rem,0.75fr)]">
        <Panel className="p-5">
          <DailySalesChart points={points} brands={store.brands} />
        </Panel>

        <Panel className="p-5">
        <SectionHeading title="Brand split" hint="Net sales after every discount." />
        <ul className="space-y-3">
          {store.brands.map((brand) => {
            const net = summary.netByBrand.get(brand.id) ?? 0
            const share = summary.netSalesSen === 0 ? 0 : (net / summary.netSalesSen) * 100
            return (
              <li key={brand.id}>
                <div className="flex items-center justify-between text-sm font-bold">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-3 rounded-sm"
                      style={{ backgroundColor: brand.chartColour }}
                    />
                    {brand.name}
                  </span>
                  <span className="tabular">
                    {formatRinggit(net)}{' '}
                    <span className="font-semibold text-muted">{share.toFixed(0)}%</span>
                  </span>
                </div>
                <div className="mt-2 h-1 bg-slate-100">
                  <div
                    className="h-full"
                    style={{ width: `${share}%`, backgroundColor: brand.chartColour }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
        <button
          type="button"
          onClick={() => onNavigate('settlement')}
          className="mt-5 flex min-h-11 items-center gap-2 border-t border-line pt-4 text-sm font-bold text-rail hover:underline"
        >
          See what each partner is owed <ArrowRight aria-hidden="true" className="size-4" />
        </button>
        </Panel>
      </div>
    </div>
  )
}
