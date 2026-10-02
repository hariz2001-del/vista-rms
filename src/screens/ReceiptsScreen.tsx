import { ChevronLeft, ChevronRight, CloudOff, RotateCcw, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, EmptyState, Money, Panel, SectionHeading } from '../components/primitives.tsx'
import type { VistaStore } from '../data/store.ts'
import { formatRinggit, formatSignedRinggit } from '../domain/money.ts'
import { formatDate } from '../domain/selectors.ts'
import type { Brand, Category, Order, SaleCorrection } from '../domain/types.ts'

function addDays(businessDate: string, days: number): string {
  const date = new Date(`${businessDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function timeOf(iso: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(iso))
}

function itemCount(order: Order): number {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0)
}

/**
 * Every receipt the counter rang up, a business day at a time — the same
 * tickets the cashier sees on the till, from every tablet.
 *
 * Read-only on purpose. A paid sale is corrected at the counter, in front of the
 * customer; here the owner only sees what was sold and what was changed after.
 */
export function ReceiptsScreen({ store }: { store: VistaStore }) {
  const [date, setDate] = useState(store.today)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const orders = useMemo(
    () =>
      store.orders
        .filter((order) => order.businessDate === date)
        .toSorted((a, b) => b.completedAt.localeCompare(a.completedAt)),
    [store.orders, date],
  )
  const correctionsByOrder = useMemo(() => {
    const byOrder = new Map<string, SaleCorrection[]>()
    for (const correction of store.corrections) {
      const list = byOrder.get(correction.originalOrderId) ?? []
      list.push(correction)
      byOrder.set(correction.originalOrderId, list)
    }
    return byOrder
  }, [store.corrections])

  const netOf = (order: Order) =>
    order.totalAmountSen +
    (correctionsByOrder.get(order.id) ?? []).reduce((sum, correction) => sum + correction.deltaSen, 0)
  const dayNetSen = orders.reduce((sum, order) => sum + netOf(order), 0)

  const selected = orders.find((order) => order.id === selectedId) ?? orders[0] ?? null
  const isToday = date === store.today

  const go = (next: string) => {
    setDate(next)
    setSelectedId(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeading
          title="Receipts"
          hint="Every sale rung up at the counter, from every tablet. Cancels and edits are made at the till; here they show beside the sale they changed."
        />
        <div className="flex items-center gap-1 border border-line bg-surface">
          <button
            type="button"
            onClick={() => go(addDays(date, -1))}
            aria-label="Previous day"
            className="grid size-11 place-items-center hover:bg-canvas"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <input
            type="date"
            value={date}
            max={store.today}
            onChange={(event) => {
              if (event.target.value) go(event.target.value)
            }}
            aria-label="Business day"
            className="min-h-11 bg-transparent px-2 font-mono text-sm font-bold"
          />
          <button
            type="button"
            onClick={() => go(addDays(date, 1))}
            disabled={isToday}
            aria-label="Next day"
            className="grid size-11 place-items-center hover:bg-canvas disabled:opacity-30"
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
          {isToday ? null : (
            <button
              type="button"
              onClick={() => go(store.today)}
              className="min-h-11 border-l border-line px-3 text-xs font-bold hover:bg-canvas"
            >
              Today
            </button>
          )}
        </div>
      </div>

      <p className="font-mono text-xs font-bold uppercase tracking-[0.08em] text-muted">
        {formatDate(date)}
        {isToday ? ' · today' : ''} · {orders.length} sale{orders.length === 1 ? '' : 's'} ·{' '}
        {formatRinggit(dayNetSen)} after corrections
      </p>

      {orders.length === 0 ? (
        <EmptyState title="No sales on this day" hint="Pick another day with the arrows or the date." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
          <ul aria-label={`Receipts on ${formatDate(date)}`} className="border border-line bg-surface">
            {orders.map((order) => {
              const corrections = correctionsByOrder.get(order.id) ?? []
              const isCancelled = corrections.some((correction) => correction.kind === 'CANCEL')
              const isSelected = selected?.id === order.id
              return (
                <li key={order.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(order.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`flex min-h-14 w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left hover:bg-canvas ${
                      isSelected ? 'bg-canvas shadow-[inset_3px_0_0_var(--color-rail)]' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-mono text-base font-bold ${isCancelled ? 'text-muted line-through' : ''}`}
                        >
                          {order.queueNumber}
                        </span>
                        {isCancelled ? (
                          <Badge tone="critical">Cancelled</Badge>
                        ) : corrections.length > 0 ? (
                          <Badge>Edited</Badge>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted">
                        {timeOf(order.completedAt)} · {itemCount(order)} item
                        {itemCount(order) === 1 ? '' : 's'}
                      </span>
                    </span>
                    <Money
                      sen={isCancelled ? order.totalAmountSen : netOf(order)}
                      tone={isCancelled ? 'muted' : 'default'}
                      className={`font-bold ${isCancelled ? 'line-through' : ''}`}
                    />
                  </button>
                </li>
              )
            })}
          </ul>

          {selected ? (
            <ReceiptDetail
              order={selected}
              corrections={correctionsByOrder.get(selected.id) ?? []}
              brands={store.brands}
              categories={store.categories}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function ReceiptDetail({
  order,
  corrections,
  brands,
  categories,
}: {
  order: Order
  corrections: SaleCorrection[]
  brands: Brand[]
  categories: Category[]
}) {
  const isCancelled = corrections.some((correction) => correction.kind === 'CANCEL')
  const discountSen = order.lineDiscountSen + order.orderDiscountSen
  const netSen = order.totalAmountSen + corrections.reduce((sum, c) => sum + c.deltaSen, 0)

  return (
    <Panel className="self-start sm:p-6">
      <div className="flex flex-wrap items-start gap-3 border-b border-dashed border-line pb-4">
        <div>
          <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-muted">
            Queue number
          </p>
          <p
            className={`font-mono text-4xl font-bold leading-none tracking-[-0.04em] ${isCancelled ? 'text-muted line-through' : ''}`}
          >
            {order.queueNumber}
          </p>
          <p className="mt-2 text-xs text-muted">
            {formatDate(order.businessDate)} · {timeOf(order.completedAt)} · QR · manually confirmed
          </p>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-1.5">
          {order.offlineLabel ? (
            <Badge icon={<CloudOff aria-hidden="true" className="size-3" />}>
              Rung up offline as {order.offlineLabel}
            </Badge>
          ) : null}
          {isCancelled ? <Badge tone="critical">Cancelled</Badge> : null}
          {order.needsReview ? <Badge tone="warning">Needs review</Badge> : null}
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {order.lines.map((line, index) => {
          const brand = brands.find((candidate) => candidate.id === line.brandId)
          const category = categories.find((candidate) => candidate.id === line.categoryId)
          const grossSen = (line.unitPriceSen + line.modifierTotalSen) * line.quantity
          return (
            <li key={`${line.productId ?? line.productName}-${index}`} className="text-sm">
              <div className="flex items-start gap-3">
                <span className="w-8 shrink-0 font-mono font-bold text-muted">{line.quantity}×</span>
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{line.productName}</span>
                  {category ? (
                    <span
                      // Brand colours are data, so they cannot be Tailwind utility classes.
                      style={{
                        backgroundColor: brand?.softColour ?? '#eef1f0',
                        color: brand?.colour ?? '#18211d',
                      }}
                      className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-[11px] font-bold"
                    >
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: brand?.colour ?? '#18211d' }}
                        className="size-1.5 rounded-full"
                      />
                      {category.name}
                    </span>
                  ) : null}
                </span>
                <Money sen={grossSen} className="shrink-0 font-bold" />
              </div>
              {line.modifiers && line.modifiers.length > 0 ? (
                <ul className="ml-11 mt-0.5 space-y-0.5 text-xs text-muted">
                  {line.modifiers.map((modifier, modifierIndex) => (
                    <li key={`${modifier.name}-${modifierIndex}`}>
                      {modifier.name}
                      {modifier.priceSen > 0 ? ` (${formatRinggit(modifier.priceSen)})` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {line.lineDiscountSen > 0 ? (
                <div className="ml-11 mt-0.5 flex justify-between text-xs font-bold text-serious">
                  <span>Discount</span>
                  <span className="tabular">−{formatRinggit(line.lineDiscountSen)}</span>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      <div className="mt-4 space-y-1.5 border-t border-dashed border-line pt-4 text-sm">
        <div className="flex justify-between text-muted">
          <span>Subtotal</span>
          <Money sen={order.grossSen} tone="muted" />
        </div>
        {discountSen > 0 ? (
          <div className="flex justify-between text-serious">
            <span>Discount</span>
            <span className="tabular">−{formatRinggit(discountSen)}</span>
          </div>
        ) : null}
        <div className="flex items-end justify-between pt-1">
          <span className="font-bold">Paid</span>
          <Money
            sen={order.totalAmountSen}
            tone={corrections.length > 0 ? 'muted' : 'default'}
            className={`text-2xl font-bold ${corrections.length > 0 ? 'line-through' : ''}`}
          />
        </div>
        {corrections.length > 0 ? (
          <div className="flex items-end justify-between">
            <span className="font-bold">Now</span>
            <Money sen={netSen} className="text-2xl font-bold" />
          </div>
        ) : null}
      </div>

      {corrections.length > 0 ? (
        <div className="mt-4 space-y-2">
          {corrections.map((correction) => (
            <p
              key={correction.id}
              className="flex flex-wrap items-center gap-2 bg-canvas p-2.5 text-xs font-bold text-muted"
            >
              {correction.kind === 'CANCEL' ? (
                <Undo2 aria-hidden="true" className="size-3.5 shrink-0" />
              ) : (
                <RotateCcw aria-hidden="true" className="size-3.5 shrink-0" />
              )}
              <span className="text-ink">{correction.kind === 'CANCEL' ? 'Cancelled' : 'Edited'}</span>
              <span>·</span>
              <span className="font-semibold">{correction.reason}</span>
              <span>
                · {correction.businessDate === order.businessDate ? '' : `${formatDate(correction.businessDate)} `}
                {timeOf(correction.createdAt)}
              </span>
              <span className="ml-auto tabular text-ink">{formatSignedRinggit(correction.deltaSen)}</span>
            </p>
          ))}
        </div>
      ) : null}
    </Panel>
  )
}
