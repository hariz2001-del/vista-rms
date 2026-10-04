import { ArrowRight, ReceiptText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PanelErrorBoundary } from '../components/PanelErrorBoundary.tsx'
import { SalesLineChart } from '../components/SalesLineChart.tsx'
import { DateRangePicker } from '../components/DateRangePicker.tsx'
import { SalesPerformanceBreakdown } from '../components/SalesPerformanceBreakdown.tsx'
import { Badge, Money, Panel, SectionHeading, StatTile } from '../components/primitives.tsx'
import type { ScreenKey } from '../components/AppShell.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit } from '../domain/money.ts'
import { liquidBalance } from '../domain/finance.ts'
import {
  attentionItems,
  formatDate,
  formatRange,
  summariseRange,
  type DateRange,
} from '../domain/selectors.ts'

export function OverviewScreen({
  store,
  onNavigate,
}: {
  store: VistaStore
  onNavigate: (key: ScreenKey) => void
}) {
  // Opens on today; ‹ › step a day at a time.
  const [range, setRange] = useState<DateRange>(() => ({
    startDate: store.today,
    endDate: store.today,
  }))

  const summary = useMemo(
    () => summariseRange(range, store.orders, store.expenses, store.corrections),
    [range, store.orders, store.expenses, store.corrections],
  )
  const attention = useMemo(
    () => attentionItems(store.corrections),
    [store.corrections],
  )

  const balanceSen = liquidBalance(store.ledger)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="page-kicker">Owner ledger / {formatRange(range)}</p>
          <h1 className="mt-1 text-3xl sm:text-[2.65rem]">
            {range.startDate === range.endDate ? 'The day' : 'The period'}, at a glance
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Sales, cash position, and the few things worth your eye.
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} today={store.today} stepper />
      </div>

      {attention.length > 0 ? (
        <Panel className="border-t-2 border-t-warning lg:p-5">
          <SectionHeading
            title="Owner's desk"
            hint={`${attention.length} cashier correction${attention.length === 1 ? '' : 's'}, shown for oversight, not approval.`}
          />
          <ul className="divide-y divide-slate-100">
            {attention.map((item) => (
              <li
                key={item.id}
                className="grid gap-2 py-3.5 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-3"
              >
                <ReceiptText aria-hidden="true" className="size-4 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-ink">{item.title}</p>
                  <p className="text-xs font-semibold text-muted">
                    {formatDate(item.businessDate)} · {item.detail}
                  </p>
                </div>
                <Badge tone="warning">Cashier correction</Badge>
                <span className="font-mono text-sm font-bold tabular">
                  {item.deltaSen === null
                    ? formatRinggit(item.amountSen)
                    : item.deltaSen === 0
                      ? 'No net change'
                      : `${item.deltaSen > 0 ? 'Collected' : 'Refunded'} ${formatRinggit(item.amountSen)}`}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('cashflow')}
                  className="min-h-9 border border-line px-3 text-xs font-bold text-muted hover:bg-canvas"
                >
                  Review ledger
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <section aria-label="Period financial summary" className="grid border border-line bg-surface sm:grid-cols-2">
        <StatTile
          hero
          label="Net sales"
          value={<Money sen={summary.netSalesSen} />}
          sub="What customers paid, after discounts and cashier corrections."
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

      <section aria-label="Period activity" className="grid grid-cols-2 border border-line bg-surface lg:grid-cols-4">
        <StatTile
          className="border-t-0 border-r border-r-line"
          label="Operating result"
          value={<Money sen={summary.operatingResultSen} tone={summary.operatingResultSen >= 0 ? 'in' : 'out'} />}
          sub="Net sales minus operating expenses"
          tone={summary.operatingResultSen >= 0 ? 'good' : 'critical'}
        />
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

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(17rem,0.75fr)]">
        <Panel className="p-5">
          <PanelErrorBoundary name="sales chart">
          <SalesLineChart
            range={range}
            orders={store.orders}
            corrections={store.corrections}
            brands={store.brands}
            categories={store.categories}
            dayRolloverHour={store.settings.dayRolloverHour ?? 5}
          />
          </PanelErrorBoundary>
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
        {store.settings.settlementEnabled ? (
          <button
            type="button"
            onClick={() => onNavigate('settlement')}
            className="mt-5 flex min-h-11 items-center gap-2 border-t border-line pt-4 text-sm font-bold text-rail hover:underline"
          >
            See what each partner is owed <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        ) : null}
        </Panel>
      </div>

      <Panel className="p-5">
        <PanelErrorBoundary name="sales breakdown">
        <SalesPerformanceBreakdown
          range={range}
          orders={store.orders}
          corrections={store.corrections}
          categories={store.categories}
          brands={store.brands}
          periodNetSalesSen={summary.netSalesSen}
        />
        </PanelErrorBoundary>
      </Panel>
    </div>
  )
}
