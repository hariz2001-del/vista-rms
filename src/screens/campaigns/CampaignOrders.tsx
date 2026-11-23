import { ArrowDown, ArrowUp, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  campaignsApi,
  type BulkAction,
  type CampaignDetail,
  type CampaignOrder,
  type CampaignSummary,
  type OrderQuery,
  type PickupOptions,
} from '../../data/campaigns-api.ts'
import { errorText } from '../../data/team-api.ts'
import { EmptyState, Money, StatTile } from '../../components/primitives.tsx'
import { OrderPanel } from './OrderPanel.tsx'
import { FlagBadges, VerificationBadge } from './badges.tsx'

type View = { key: string; label: string; query: OrderQuery }
const VIEWS: View[] = [
  { key: 'attention', label: 'Needs attention', query: { flag: 'NEEDS_ATTENTION' } },
  { key: 'unverified', label: 'To check', query: { verification: 'UNVERIFIED' } },
  { key: 'verified', label: 'Verified', query: { verification: 'VERIFIED' } },
  { key: 'rejected', label: 'Rejected', query: { verification: 'REJECTED' } },
  { key: 'all', label: 'All', query: {} },
  { key: 'deleted', label: 'Deleted', query: { includeDeleted: 'only' } },
]

/** YYYY-MM-DD in Malaysia, `days` from today. */
function malaysiaDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date())
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const QUICK_DAYS = [
  { days: 0, label: 'Today' },
  { days: 1, label: 'Tomorrow' },
  { days: 2, label: 'Day after' },
]
const COLLECTED: Array<{ value: '' | 'no' | 'yes'; label: string }> = [
  { value: '', label: 'All' },
  { value: 'no', label: 'Not collected' },
  { value: 'yes', label: 'Collected' },
]

const WHEN = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
const PAGE_SIZE = 25

/** A campaign's orders: what needs a look first, then everything else. Same for every campaign. */
export function CampaignOrders({ detail, onChanged }: { detail: CampaignDetail; onChanged: () => void }) {
  const id = detail.campaign.id
  const [summary, setSummary] = useState<CampaignSummary | null>(null)
  const [view, setView] = useState<View>(VIEWS[1]!)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<NonNullable<OrderQuery['sort']>>('submittedAt')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<{ total: number; orders: CampaignOrder[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openOrder, setOpenOrder] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const [tick, setTick] = useState(0)
  const [pickups, setPickups] = useState<PickupOptions | null>(null)
  const [pickupDate, setPickupDate] = useState('')
  const [pickupSlot, setPickupSlot] = useState('')
  const [collected, setCollected] = useState<'' | 'no' | 'yes'>('')

  const query: OrderQuery = useMemo(
    () => ({
      ...view.query,
      q: q || undefined,
      pickupDate: pickupDate || undefined,
      pickupSlot: pickupSlot || undefined,
      collected: collected || undefined,
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    [view, q, pickupDate, pickupSlot, collected, sort, dir, page],
  )

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let live = true
    Promise.all([campaignsApi.summary(id), campaignsApi.orders(id, query)])
      .then(([nextSummary, list]) => {
        if (!live) return
        setSummary(nextSummary)
        setRows({ total: list.total, orders: list.orders })
        setError(null)
      })
      .catch((caught) => live && setError(errorText(caught, 'Could not load the orders.')))
    return () => {
      live = false
    }
  }, [id, query, tick])

  useEffect(() => {
    let live = true
    campaignsApi
      .pickups(id)
      .then((options) => live && setPickups(options))
      .catch(() => live && setPickups(null))
    return () => {
      live = false
    }
  }, [id, tick])

  if (detail.source.kind === 'NONE') {
    return <EmptyState title="No order source yet" hint="Connect where this campaign's orders come from in Setup, then sync them here." />
  }

  async function syncNow() {
    setSyncing(true)
    setNotice(null)
    try {
      const result = await campaignsApi.sync(id)
      setNotice({
        tone: 'good',
        text: `Synced: ${result.added} new, ${result.updated} changed, ${result.unchanged} unchanged${result.skipped ? `, ${result.skipped} skipped` : ''}.`,
      })
      refresh()
      onChanged()
    } catch (caught) {
      setNotice({ tone: 'bad', text: errorText(caught) })
    } finally {
      setSyncing(false)
    }
  }

  async function runBulk(action: BulkAction) {
    const ids = [...selected]
    const label = { reject: 'Reject', dismiss: 'Clear the flags on', delete: 'Delete', restore: 'Restore' }[action]
    const extra =
      action === 'delete'
        ? '\n\nVerified orders and orders whose coupon was used are never deleted; they will be skipped. Nothing is removed from the Google Sheet or Drive.'
        : action === 'reject'
          ? '\n\nOnly orders still waiting for a check are rejected; verified ones are skipped.'
          : ''
    if (!window.confirm(`${label} ${ids.length} ${ids.length === 1 ? 'order' : 'orders'}?${extra}`)) return
    const note = action === 'reject' ? window.prompt('Reason (optional, kept on each order):') : null
    try {
      const result = await campaignsApi.bulk(id, { action, ids, note })
      const skipped = result.skipped.length
        ? ` ${result.skipped.length} skipped: ${result.skipped
            .slice(0, 4)
            .map((item) => `${item.ref ?? 'an order'} (${item.reason})`)
            .join(', ')}${result.skipped.length > 4 ? '…' : ''}`
        : ''
      setNotice({ tone: skipped ? 'bad' : 'good', text: `${result.done.length} done.${skipped}` })
      setSelected(new Set())
      refresh()
    } catch (caught) {
      setNotice({ tone: 'bad', text: errorText(caught) })
    }
  }

  async function selectAllMatching() {
    try {
      const { ids } = await campaignsApi.orderIds(id, query)
      setSelected(new Set(ids))
    } catch (caught) {
      setNotice({ tone: 'bad', text: errorText(caught) })
    }
  }

  function choosePickup(value: string) {
    setPickupDate(value)
    setPickupSlot('')
    setPage(1)
    setSelected(new Set())
    // A day's list reads best in pickup order.
    if (value) {
      setSort('pickup')
      setDir('asc')
    }
  }
  const chip = (active: boolean) =>
    `border px-2.5 py-1 font-bold disabled:opacity-40 ${active ? 'border-rail bg-rail text-white' : 'border-line bg-surface text-ink hover:border-rail'}`

  const orders = rows?.orders ?? []
  const pageIds = orders.map((order) => order.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((orderId) => selected.has(orderId))
  const pages = rows ? Math.max(1, Math.ceil(rows.total / PAGE_SIZE)) : 1

  const sortHeader = (key: NonNullable<OrderQuery['sort']>, label: string, className = '') => (
    <th className={`px-3 py-2 font-mono text-[0.65rem] uppercase ${className}`} aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        data-compact
        className="inline-flex items-center gap-1 uppercase"
        onClick={() => {
          if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc')
          else {
            setSort(key)
            setDir(key === 'submittedAt' || key === 'expectedSen' ? 'desc' : 'asc')
          }
          setPage(1)
        }}
      >
        {label}
        {sort === key ? dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
      </button>
    </th>
  )

  return (
    <div className="space-y-4">
      {summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Pre-orders" value={summary.orders} />
          <StatTile label="Expected" value={<Money sen={summary.expectedSen} />} sub="excl. rejected" />
          <StatTile label="Verified revenue" value={<Money sen={summary.verifiedSen} />} tone="good" sub={`${summary.verified} paid`} />
          <StatTile label="To check" value={summary.unverified} tone={summary.unverified ? 'warning' : 'default'} sub={summary.unread ? `${summary.unread} being read` : undefined} />
          <StatTile label="Flagged" value={summary.flagged} tone={summary.flagged ? 'critical' : 'default'} sub="by the reader" />
          <StatTile label="Rejected" value={summary.rejected} />
          <StatTile label="Coupons used" value={`${summary.couponsRedeemed} / ${summary.couponsIssued}`} />
          <StatTile label="Still owed" value={<Money sen={summary.outstandingSen} />} sub="paid coupons not used" />
          <StatTile
            label="Walk-ins sold"
            value={summary.walkIns.units}
            sub={
              detail.campaign.walkInProductIds.length
                ? summary.walkIns.items.map((item) => `${item.units} ${item.name}`).join(' · ') || 'none yet'
                : 'link the items in Setup'
            }
          />
          <StatTile label="Walk-in revenue" value={<Money sen={summary.walkIns.netSen} />} tone="good" sub={`${summary.walkIns.sales} ${summary.walkIns.sales === 1 ? 'sale' : 'sales'} at the till`} />
          <StatTile label="Campaign revenue" value={<Money sen={summary.verifiedSen + summary.walkIns.netSen} />} tone="good" sub="pre-orders verified + walk-ins" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="vista-button-secondary inline-flex items-center gap-1.5" onClick={() => void syncNow()} disabled={syncing}>
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        {summary?.lastSync ? (
          <p className="text-sm text-muted">
            Last sync {WHEN.format(new Date(summary.lastSync.startedAt))}
            {summary.lastSync.status === 'FAILED' ? <span className="font-bold text-critical"> · failed</span> : null}
          </p>
        ) : (
          <p className="text-sm text-muted">Never synced.</p>
        )}
        {notice ? <p className={`text-sm font-semibold ${notice.tone === 'good' ? 'text-good' : 'text-critical'}`} role="status">{notice.text}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex flex-wrap gap-1">
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={view.key === item.key}
              onClick={() => {
                setView(item)
                setPage(1)
                setSelected(new Set())
              }}
              className={`min-h-11 border px-3 py-1.5 text-sm font-bold sm:min-h-0 ${view.key === item.key ? 'border-rail bg-rail text-white' : 'border-line bg-surface text-ink hover:border-rail'}`}
            >
              {item.label}
              {item.key === 'attention' && summary?.flagged ? ` (${summary.flagged})` : ''}
            </button>
          ))}
        </div>
        <label className="relative w-full sm:ml-auto sm:w-auto sm:min-w-[14rem] sm:max-w-xs sm:flex-1">
          <span className="sr-only">Search orders</span>
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="vista-control w-full pl-8"
            placeholder="Name, order, coupon, reference"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-line bg-surface p-2 text-sm">
        {pickups?.hasPickup ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[0.65rem] uppercase text-muted">Pickup</span>
            <button type="button" className={chip(!pickupDate)} onClick={() => choosePickup('')}>
              All dates
            </button>
            {QUICK_DAYS.map((quick) => {
              const option = pickups.dates.find((date) => date.isoDate === malaysiaDay(quick.days))
              return (
                <button
                  key={quick.days}
                  type="button"
                  disabled={!option}
                  title={option ? option.value : 'No pickups that day'}
                  className={chip(!!option && pickupDate === option.value)}
                  onClick={() => option && choosePickup(option.value)}
                >
                  {quick.label}
                  {option ? ` (${option.orders})` : ''}
                </button>
              )
            })}
            <label>
              <span className="sr-only">Pickup date</span>
              <select className="vista-control py-1" value={pickupDate} onChange={(event) => choosePickup(event.target.value)}>
                <option value="">Any date…</option>
                {pickups.dates.map((date) => (
                  <option key={date.value} value={date.value}>
                    {date.value} ({date.orders})
                  </option>
                ))}
              </select>
            </label>
            {pickupDate ? (
              <label>
                <span className="sr-only">Time slot</span>
                <select
                  className="vista-control py-1"
                  value={pickupSlot}
                  onChange={(event) => {
                    setPickupSlot(event.target.value)
                    setPage(1)
                    setSelected(new Set())
                  }}
                >
                  <option value="">All slots</option>
                  {(pickups.dates.find((date) => date.value === pickupDate)?.slots ?? []).map((slot) => (
                    <option key={slot.value} value={slot.value}>
                      {slot.value} ({slot.orders})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[0.65rem] uppercase text-muted">Collection</span>
          {COLLECTED.map((option) => (
            <button
              key={option.value}
              type="button"
              className={chip(collected === option.value)}
              onClick={() => {
                setCollected(option.value)
                setPage(1)
                setSelected(new Set())
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border border-rail bg-[#e8efe9] p-2 text-sm font-bold">
          <span>{selected.size} selected</span>
          {rows && rows.total > orders.length && selected.size < rows.total ? (
            <button type="button" className="underline" onClick={() => void selectAllMatching()}>
              Select all {rows.total} matching
            </button>
          ) : null}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          {view.key === 'deleted' ? (
            <button type="button" className="vista-button-secondary" onClick={() => void runBulk('restore')}>Restore</button>
          ) : (
            <>
              <button type="button" className="vista-button-secondary" onClick={() => void runBulk('reject')}>Reject</button>
              <button type="button" className="vista-button-secondary" onClick={() => void runBulk('dismiss')}>Clear flags</button>
              <button type="button" className="vista-button-secondary text-critical" onClick={() => void runBulk('delete')}>Delete</button>
            </>
          )}
          <button type="button" className="ml-auto underline" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      ) : null}

      {error ? <p className="border border-critical bg-red-50 p-3 text-sm font-semibold text-critical">{error}</p> : null}

      <div className={`grid grid-cols-1 gap-4 ${openOrder ? 'xl:grid-cols-[minmax(0,1fr)_minmax(26rem,34rem)]' : ''}`}>
        <div className={openOrder ? 'hidden xl:block' : ''}>
          {rows && orders.length === 0 ? (
            <EmptyState title="No orders here" hint={q ? 'Nothing matches that search.' : 'Try another view, or sync.'} />
          ) : (
            <>
            {/* Phones: one card per order, the few things that matter at the counter. */}
            <ul className="space-y-2 md:hidden" aria-label="Orders">
              {orders.map((order) => (
                <li key={order.id} className={`flex items-stretch border bg-surface ${openOrder === order.id ? 'border-rail' : 'border-line'} ${order.deletedAt ? 'opacity-60' : ''}`}>
                  <label className="flex items-center px-3">
                    <span className="sr-only">Select {order.externalRef}</span>
                    <input
                      type="checkbox"
                      checked={selected.has(order.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(order.id)
                          else next.delete(order.id)
                          return next
                        })
                      }
                    />
                  </label>
                  <button type="button" className="min-w-0 flex-1 py-2.5 pr-3 text-left" onClick={() => setOpenOrder(order.id)}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-bold">{order.customerName}</span>
                      <Money sen={order.expectedSen} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      <span className="font-mono font-bold text-ink">{order.externalRef}</span>
                      {order.lines.length ? ` · ${order.lines.map((line) => line.label).join(', ')}` : ''}
                    </span>
                    {order.pickup?.date ? (
                      <span className="mt-0.5 block truncate text-xs font-semibold">
                        Pickup {order.pickup.date}
                        {order.pickup.slot ? ` · ${order.pickup.slot}` : ''}
                      </span>
                    ) : null}
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <VerificationBadge order={order} />
                      <FlagBadges order={order} />
                      {order.coupons.length ? (
                        <span className="text-muted">
                          {order.coupons.filter((coupon) => coupon.redeemedAt).length}/{order.coupons.length} collected
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="scrollbar-subtle hidden overflow-x-auto border border-line bg-surface md:block">
              <table className="w-full min-w-[54rem] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select this page"
                        checked={allOnPage}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current)
                            for (const orderId of pageIds) {
                              if (event.target.checked) next.add(orderId)
                              else next.delete(orderId)
                            }
                            return next
                          })
                        }
                      />
                    </th>
                    {sortHeader('externalRef', 'Order')}
                    {sortHeader('customerName', 'Customer')}
                    <th className="px-3 py-2 font-mono text-[0.65rem] uppercase">Items</th>
                    {pickups?.hasPickup ? sortHeader('pickup', 'Pickup') : null}
                    {sortHeader('expectedSen', 'Amount', 'text-right')}
                    <th className="px-3 py-2 font-mono text-[0.65rem] uppercase">Payment check</th>
                    {sortHeader('verification', 'Status')}
                    <th className="px-3 py-2 font-mono text-[0.65rem] uppercase">Coupons</th>
                    {sortHeader('submittedAt', 'Submitted')}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className={`cursor-pointer border-b border-line/60 hover:bg-[#f6f3ec] ${openOrder === order.id ? 'bg-[#eef3ef]' : ''} ${order.deletedAt ? 'opacity-60' : ''}`}
                      onClick={() => setOpenOrder(order.id)}
                    >
                      <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${order.externalRef}`}
                          checked={selected.has(order.id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(order.id)
                              else next.delete(order.id)
                              return next
                            })
                          }
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-bold">{order.externalRef}</td>
                      <td className="px-3 py-2">
                        <p className="font-semibold">{order.customerName}</p>
                        {order.contact ? <p className="text-xs text-muted">{order.contact}</p> : null}
                      </td>
                      <td className="max-w-[14rem] px-3 py-2 text-xs">{order.lines.map((line) => line.label).join(', ')}</td>
                      {pickups?.hasPickup ? (
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          <p className="font-semibold">{order.pickup?.date ?? '—'}</p>
                          {order.pickup?.slot ? <p className="text-muted">{order.pickup.slot}</p> : null}
                        </td>
                      ) : null}
                      <td className="px-3 py-2 text-right">
                        <Money sen={order.expectedSen} />
                      </td>
                      <td className="px-3 py-2">
                        <FlagBadges order={order} />
                      </td>
                      <td className="px-3 py-2">
                        <VerificationBadge order={order} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {order.coupons.length === 0 ? (
                          <span className="text-muted">None</span>
                        ) : (
                          `${order.coupons.filter((coupon) => coupon.redeemedAt).length}/${order.coupons.length} used`
                        )}
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-2 text-xs text-muted">{WHEN.format(new Date(order.submittedAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}

          {rows && rows.total > PAGE_SIZE ? (
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <p className="text-muted">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.total)} of {rows.total}
              </p>
              <div className="flex gap-2">
                <button type="button" className="vista-button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="self-center font-semibold">Page {page} of {pages}</span>
                <button type="button" className="vista-button-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          ) : null}
        </div>

        {openOrder ? (
          <OrderPanel
            campaignId={id}
            orderId={openOrder}
            onClose={() => setOpenOrder(null)}
            onChanged={() => {
              refresh()
              onChanged()
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
