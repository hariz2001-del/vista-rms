import { ArrowRight, HandCoins, ReceiptText } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DailySalesChart } from '../components/DailySalesChart.tsx'
import { DateRangePicker } from '../components/DateRangePicker.tsx'
import { Badge, Money, Panel, SectionHeading, StatTile } from '../components/primitives.tsx'
import type { ScreenKey } from '../components/AppShell.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit } from '../domain/money.ts'
import { liquidBalance } from '../domain/finance.ts'
import {
  attentionItems,
  dailyPoints,
  formatDate,
  formatRange,
  inRange,
  monthOf,
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
  const [range, setRange] = useState<DateRange>(() => ({
    startDate: `${monthOf(store.today)}-01`,
    endDate: store.today,
  }))

  const summary = useMemo(
    () => summariseRange(range, store.orders, store.expenses, store.corrections),
    [range, store.orders, store.expenses, store.corrections],
  )
  const points = useMemo(
    () =>
      dailyPoints(
        inRange(store.orders, range.startDate, range.endDate),
        store.brands.map((brand) => brand.id),
        inRange(store.corrections, range.startDate, range.endDate),
      ),
    [store.orders, store.corrections, store.brands, range],
  )
  const attention = useMemo(
    () => attentionItems(store.expenses, store.corrections),
    [store.expenses, store.corrections],
  )

  const balanceSen = liquidBalance(store.ledger)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="page-kicker">Owner ledger / {formatRange(range)}</p>
          <h1 className="mt-1 text-3xl sm:text-[2.65rem]">The period, at a glance</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Sales, cash position, and the few things worth your eye.
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} today={store.today} />
      </div>

      {attention.length > 0 ? (
        <Panel className="border-t-2 border-t-warning lg:p-5">
          <SectionHeading
            title="Owner's desk"
            hint={`${attention.length} item${attention.length === 1 ? '' : 's'} worth seeing: partner reimbursements need action; cashier corrections are shown for oversight, not approval.`}
          />
          <ul className="divide-y divide-slate-100">
            {attention.map((item) => (
              <li
                key={item.id}
                className="grid gap-2 py-3.5 sm:grid-cols-[1.25rem_minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-3"
              >
                {item.kind === 'UNSETTLED_ADVANCE' ? (
                  <HandCoins aria-hidden="true" className="size-4 shrink-0 text-muted" />
                ) : (
                  <ReceiptText aria-hidden="true" className="size-4 shrink-0 text-warning" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-ink">{item.title}</p>
                  <p className="text-xs font-semibold text-muted">
                    {formatDate(item.businessDate)} · {item.detail}
                  </p>
                </div>
                <Badge tone={item.kind === 'UNSETTLED_ADVANCE' ? 'info' : 'warning'}>
                  {item.kind === 'UNSETTLED_ADVANCE' ? 'Owed to partner' : 'Cashier correction'}
                </Badge>
                <span className="font-mono text-sm font-bold tabular">
                  {item.deltaSen === null
                    ? formatRinggit(item.amountSen)
                    : item.deltaSen === 0
                      ? 'No net change'
                      : `${item.deltaSen > 0 ? 'Collected' : 'Refunded'} ${formatRinggit(item.amountSen)}`}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onNavigate(item.kind === 'UNSETTLED_ADVANCE' ? 'settlement' : 'cashflow')
                  }
                  className="min-h-9 border border-line px-3 text-xs font-bold text-muted hover:bg-canvas"
                >
                  {item.kind === 'UNSETTLED_ADVANCE' ? 'Settle' : 'Review ledger'}
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <section aria-label="Period financial summary" className="grid border border-line bg-surface sm:grid-cols-2">
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

      <section aria-label="Period activity" className="grid grid-cols-2 border border-line bg-surface lg:grid-cols-4">
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
    </div>
  )
}
