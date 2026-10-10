import { ClipboardList, Eye, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { stockApi, type StockItem } from '../../data/stock-api.ts'
import { teamApi, useLoad } from '../../data/team-api.ts'
import { StockLevelBar } from '../../components/StockLevelBar.tsx'
import { groupStock, parseCountMilli, type StockBalance } from '../../domain/stock.ts'
import type { Brand } from '../../domain/types.ts'

/**
 * The closing stock count as the counter sees it (pos-vista's
 * StockCountScreen): same grouping, order, boxes and balance buttons, active
 * items only. The boxes and buttons can be tried, but nothing is kept or sent.
 */

const POS_INK = '#101826'

type Entry = { unopened: string; opened: string; balance: StockBalance | null }
const EMPTY: Entry = { unopened: '', opened: '', balance: null }

function CountBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const invalid = parseCountMilli(value) === 'invalid'
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      autoComplete="off"
      value={value}
      placeholder="–"
      onChange={(event) => onChange(event.target.value.replace(',', '.'))}
      onFocus={(event) => event.currentTarget.select()}
      className={`h-14 w-full min-w-0 rounded-xl border-2 bg-white text-center text-2xl font-black tabular-nums text-slate-900 outline-none placeholder:text-slate-300 focus:border-slate-900 ${
        invalid ? 'border-red-600' : 'border-slate-200'
      }`}
    />
  )
}

function Row({ item, entry, onChange }: { item: StockItem; entry: Entry; onChange: (patch: Partial<Entry>) => void }) {
  const done = Boolean(entry.unopened.trim() || entry.opened.trim() || entry.balance)
  return (
    <li className="grid grid-cols-2 items-center gap-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_15rem]">
      <div className="col-span-2 min-w-0 md:col-span-1">
        <p className="text-lg font-black leading-tight">
          {done ? <span className="mr-1 text-green-600">✓</span> : null}
          {item.name}
        </p>
        {item.unitLabel ? <p className="text-sm font-semibold text-slate-500">in {item.unitLabel}</p> : null}
      </div>
      {item.trackUnopened ? (
        <label className="block">
          <span className="block text-center text-[0.65rem] font-black uppercase tracking-wider text-slate-400">Unopened</span>
          <CountBox label={`${item.name} unopened`} value={entry.unopened} onChange={(unopened) => onChange({ unopened })} />
        </label>
      ) : (
        <span className="hidden md:block" />
      )}
      {item.trackOpened ? (
        <label className="block">
          <span className="block text-center text-[0.65rem] font-black uppercase tracking-wider text-slate-400">Opened</span>
          <CountBox label={`${item.name} opened`} value={entry.opened} onChange={(opened) => onChange({ opened })} />
        </label>
      ) : (
        <span className="hidden md:block" />
      )}
      {item.trackBalance ? (
        <div className="col-span-2 md:col-span-1">
          <span className="block text-center text-[0.65rem] font-black uppercase tracking-wider text-slate-400">Balance</span>
          <StockLevelBar label={`${item.name} balance`} value={entry.balance} onChange={(balance) => onChange({ balance })} />
        </div>
      ) : (
        <span className="hidden md:block" />
      )}
    </li>
  )
}

export function StockPosPreview({ brands, onClose }: { brands: Brand[]; onClose: () => void }) {
  const { data, error } = useLoad(stockApi.listItems)
  const team = useLoad(teamApi.listStaff)
  const [entries, setEntries] = useState<Record<string, Entry>>({})

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Only active items reach the counter, in the list's order.
  const items = useMemo(() => (data?.items ?? []).filter((item) => item.isActive), [data])
  const groups = useMemo(() => groupStock(items.map((item) => ({ ...item, brandKey: item.brandId }))), [items])
  const staff = (team.data?.staff ?? []).filter((member) => member.status === 'ACTIVE')
  const filled = items.filter((item) => {
    const entry = entries[item.id]
    return Boolean(entry && (entry.unopened.trim() || entry.opened.trim() || entry.balance))
  }).length

  function update(id: string, patch: Partial<Entry>) {
    setEntries((current) => ({ ...current, [id]: { ...(current[id] ?? EMPTY), ...patch } }))
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Stock POS view" className="fixed inset-0 z-50 flex flex-col bg-slate-100 text-slate-900">
      <header className="flex min-h-16 shrink-0 items-center gap-3 px-4 text-white sm:px-6" style={{ backgroundColor: POS_INK }}>
        <Eye aria-hidden="true" className="size-5 shrink-0" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-black">
            <ClipboardList aria-hidden="true" className="size-4" /> POS view · Closing stock
          </p>
          <p className="truncate text-xs text-slate-300">What the counter sees under Stock count. Try it — nothing is kept or sent.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold hover:bg-white/20"
        >
          <X aria-hidden="true" className="size-4" /> Close
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {error && !data ? (
          <p className="p-6 text-center font-bold text-red-700">{error}</p>
        ) : !data ? (
          <p className="p-6 text-center font-bold text-slate-500">Loading the stock list…</p>
        ) : items.length === 0 ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div className="max-w-sm">
              <h2 className="text-2xl font-black">No stock list yet</h2>
              <p className="mt-2 font-semibold text-slate-600">
                This is what the counter sees now. Add items under Stock list and they appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-5">
            <section aria-label="Who counted" className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">Counted by</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {staff.map((member) => (
                  <span key={member.id} className="flex min-h-12 items-center rounded-xl border-2 border-slate-200 bg-white px-4 text-base font-black">
                    {member.name}
                  </span>
                ))}
                <span className="flex min-h-12 min-w-48 flex-1 items-center rounded-xl border-2 border-slate-200 px-3 font-bold text-slate-400">
                  {staff.length > 0 ? 'Not listed? Type a name' : 'Your name'}
                </span>
              </div>
              {team.error ? <p className="mt-2 text-xs text-slate-500">Staff names could not be loaded: {team.error}</p> : null}
            </section>

            {groups.map((brand) => {
              const info = brands.find((candidate) => candidate.id === brand.brandKey)
              return (
                <section key={brand.brandKey} className="space-y-3">
                  <h2 className="flex items-center gap-2 text-xl font-black">
                    <span aria-hidden="true" className="size-3 rounded-full" style={{ backgroundColor: info?.colour }} />
                    {info?.name ?? '—'}
                  </h2>
                  {brand.categories.map((category) => (
                    <div key={category.category} className="overflow-hidden rounded-2xl bg-white shadow-sm">
                      <p className="bg-slate-100 px-4 py-2 text-sm font-black uppercase tracking-wider text-slate-600">{category.category}</p>
                      {category.subcategories.map((group) => (
                        <div key={group.subcategory ?? '—'}>
                          {group.subcategory ? (
                            <p className="px-4 pt-3 text-xs font-black uppercase tracking-wider text-slate-400">{group.subcategory}</p>
                          ) : null}
                          <ul className="divide-y divide-slate-100">
                            {group.items.map((item) => (
                              <Row key={item.id} item={item} entry={entries[item.id] ?? EMPTY} onChange={(patch) => update(item.id, patch)} />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              )
            })}

            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">Reminder for tomorrow / restock / remarks</p>
              <p className="mt-2 min-h-20 rounded-xl border-2 border-slate-200 p-3 font-semibold text-slate-400">Running low on oat milk; order cups</p>
            </section>
          </div>
        )}
      </main>

      {items.length > 0 ? (
        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <p className="text-sm font-black text-slate-600">
              {filled}/{items.length} filled
              <span className="block text-xs font-bold text-slate-400">Preview — nothing is sent from here.</span>
            </p>
            <button type="button" disabled className="ml-auto min-h-14 rounded-2xl bg-slate-300 px-8 text-lg font-black text-white">
              Submit count
            </button>
          </div>
        </footer>
      ) : null}
    </div>
  )
}
