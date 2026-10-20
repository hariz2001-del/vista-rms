import { AlertTriangle, Check, ChevronLeft, ChevronRight, FolderCheck, Image as ImageIcon, Inbox, Pencil, Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, PAYMENT_METHODS } from '../../components/ExpenseForm.tsx'
import { Badge, EmptyState, Panel } from '../../components/primitives.tsx'
import type { VistaStore } from '../../data/store.ts'
import { formatRinggit } from '../../domain/money.ts'
import { formatDate } from '../../domain/selectors.ts'
import type { ExpenseCategory, PaymentMethod, PaymentSource } from '../../domain/types.ts'
import { apiFile, apiRequest } from '../../lib/http.ts'

/**
 * Chopper's stash, sorted here. Every receipt Chopper reads is already in the
 * books as one "not categorised" expense; sorting its lines into a brand and
 * category turns it into the real ones. The scan stays beside the lines the
 * whole time. Chopper files the scan in Drive and tells the sender on Telegram.
 */

export type StashSummary = {
  receiptKey: string
  vendor: string | null
  date: string | null
  receiptNo: string | null
  totalSen: number | null
  lineCount: number
  pendingSen: number
  bookedSen: number
  state: string
  problem: string | null
  warning: string | null
  duplicate: boolean
  ready: boolean
  recorded: boolean
  receivedAt: string
  drivePath?: string | null
}

type StashLine = { index: number; name: string; quantityMilli: number; unitPriceSen: number; amountSen: number; decision: 'pending' | 'posted' | 'scrapped' }

type StashDetail = StashSummary & {
  lines: StashLine[]
  allocations: Array<{ indices: number[]; brandId: string | null }>
  expenses: Array<{ id: string; amountSen: number; brandId: string | null; category: ExpenseCategory; uncategorised: boolean; description: string; paidBy: PaymentSource; paymentMethod: PaymentMethod | null; foodSplitPct: number; isLocked: boolean; lines: number[] }>
  sorted: boolean
  guess: { category: ExpenseCategory; brandId: string | null; source: string } | null
  hasOriginal: boolean
}

export const stashApi = {
  list: (sorted = false) => apiRequest<{ receipts: StashSummary[]; count: number }>('GET', `/rms/stash${sorted ? '?sorted=1' : ''}`),
  detail: (key: string) => apiRequest<StashDetail>('GET', `/rms/stash/${key}`),
}

const quantity = (milli: number) => (milli % 1000 === 0 ? String(milli / 1000) : (milli / 1000).toFixed(3).replace(/0+$/, ''))

function ScanViewer({ receiptKey, hasOriginal }: { receiptKey: string; hasOriginal: boolean }) {
  const [original, setOriginal] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const current = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    setError('')
    setUrl(null)
    apiFile(`/rms/stash/${receiptKey}/scan${original ? '?original=1' : ''}`)
      .then((file) => {
        if (!live) return
        if (current.current) URL.revokeObjectURL(current.current)
        current.current = URL.createObjectURL(file)
        setUrl(current.current)
      })
      .catch((reason) => live && setError(reason instanceof Error ? reason.message : 'The scan could not be loaded.'))
    return () => { live = false }
  }, [receiptKey, original])
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current) }, [])

  return (
    <div className="flex h-full min-h-0 flex-col border border-line bg-ink/95">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-2 py-1.5 text-xs font-bold text-white">
        <span className="mr-auto px-1">{original ? 'Original photo' : 'Chopper’s scan'}</span>
        <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Zoom out" className="grid size-9 place-items-center hover:bg-white/10"><ZoomOut aria-hidden="true" className="size-4" /></button>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Zoom in" className="grid size-9 place-items-center hover:bg-white/10"><ZoomIn aria-hidden="true" className="size-4" /></button>
        {hasOriginal ? (
          <button type="button" onClick={() => setOriginal((o) => !o)} className="min-h-9 px-2 underline">{original ? 'Show scan' : 'Show photo'}</button>
        ) : null}
      </div>
      <div className="min-h-[18rem] flex-1 overflow-auto p-2">
        {error ? <p role="alert" className="p-4 text-sm font-bold text-white">{error}</p> : null}
        {!url && !error ? <p className="p-4 text-sm text-white/70">Loading the receipt…</p> : null}
        {url ? <img src={url} alt={`Receipt ${receiptKey}`} style={{ width: `${zoom * 100}%` }} className="mx-auto block max-w-none bg-white" /> : null}
      </div>
    </div>
  )
}

/** Ringgit typed by the owner ("12.5", "RM 3.20") as sen, or null when it is not a price. */
function toSen(text: string): number | null {
  const clean = text.replace(/rm/i, '').replace(/,/g, '').trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) return null
  return Math.round(Number(clean) * 100)
}
const toText = (sen: number) => (sen / 100).toFixed(2)

type DraftLine = { name: string; quantity: string; price: string; decision: StashLine['decision'] }

/**
 * The receipt's title and lines, opened for correction. Booked lines change
 * their expense; unsorted ones change the not-categorised one. Lines are fixed
 * or added here; leaving one out is "Leave out".
 */
function ReadingEditor({ detail, onSaved, onCancel }: { detail: StashDetail; onSaved: (message: string) => void; onCancel: () => void }) {
  const [vendor, setVendor] = useState(detail.vendor ?? '')
  const [date, setDate] = useState(detail.date ?? '')
  const [receiptNo, setReceiptNo] = useState(detail.receiptNo ?? '')
  const [total, setTotal] = useState(detail.totalSen === null ? '' : toText(detail.totalSen))
  const [lines, setLines] = useState<DraftLine[]>(() =>
    detail.lines.map((l) => ({ name: l.name, quantity: quantity(l.quantityMilli), price: toText(l.unitPriceSen), decision: l.decision })),
  )
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const parsed = lines.map((l) => {
    const qty = Number(l.quantity)
    const price = toSen(l.price)
    const ok = l.name.trim() && Number.isFinite(qty) && qty > 0 && price !== null
    return ok ? { name: l.name.trim(), quantityMilli: Math.round(qty * 1000), unitPriceSen: price!, amountSen: Math.round((Math.round(qty * 1000) * price!) / 1000) } : null
  })
  const sum = parsed.reduce((n, l) => n + (l?.amountSen ?? 0), 0)
  const totalSen = toSen(total)
  const set = (i: number, patch: Partial<DraftLine>) => setLines((list) => list.map((l, n) => (n === i ? { ...l, ...patch } : l)))

  async function save() {
    setProblem('')
    if (!vendor.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || totalSen === null || totalSen <= 0) {
      setProblem('Fill in the shop, the date and the total.')
      return
    }
    if (parsed.some((l) => l === null)) {
      setProblem('Each line needs a name, a quantity and a price.')
      return
    }
    setBusy(true)
    try {
      const result = await apiRequest<{ addsUp: boolean }>('PUT', `/rms/stash/${detail.receiptKey}/reading`, {
        vendor: vendor.trim(), date, receiptNo: receiptNo.trim() || null, totalSen,
        lines: parsed.map((l) => ({ name: l!.name, quantityMilli: l!.quantityMilli, unitPriceSen: l!.unitPriceSen })),
      })
      onSaved(result.addsUp ? 'Reading corrected. The books follow it.' : 'Saved — but the lines still don’t add up to the total.')
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'That could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const field = 'min-h-11 w-full border border-line bg-white px-3 text-sm text-ink outline-none focus:border-ink'
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-black">Correct the reading</h3>
        <span className="text-xs font-bold text-muted">{detail.receiptKey}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="vista-field-label">Shop</span><input className={field} value={vendor} onChange={(e) => setVendor(e.target.value)} /></label>
        <label><span className="vista-field-label">Date</span><input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span className="vista-field-label">Receipt no.</span><input className={field} value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} /></label>
        <label><span className="vista-field-label">Total (RM)</span><input inputMode="decimal" className={field} value={total} onChange={(e) => setTotal(e.target.value)} /></label>
      </div>

      <div>
        <p className="vista-field-label">Lines</p>
        <ul className="mt-1 space-y-2">
          {lines.map((l, i) => (
            <li key={i} className={`grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-2 border border-line bg-surface p-2 ${l.decision === 'scrapped' ? 'opacity-60' : ''}`}>
              <span className="row-span-2 self-start pt-3 text-center text-xs font-black text-muted" title={l.decision === 'posted' ? 'Booked' : l.decision === 'scrapped' ? 'Left out' : 'Not sorted yet'}>
                {i + 1}{l.decision === 'posted' ? ' ✓' : l.decision === 'scrapped' ? ' ✗' : ''}
              </span>
              <input aria-label={`Line ${i + 1} name`} placeholder="What it was" className={`${field} col-span-2`} value={l.name} onChange={(e) => set(i, { name: e.target.value })} />
              <label><span className="text-[0.65rem] font-bold uppercase text-muted">Qty</span>
                <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" className={`${field} text-right`} value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></label>
              <label><span className="text-[0.65rem] font-bold uppercase text-muted">Each (RM)</span>
                <input aria-label={`Line ${i + 1} unit price`} inputMode="decimal" className={`${field} text-right`} value={l.price} onChange={(e) => set(i, { price: e.target.value })} /></label>
              <span className="col-span-3 text-right text-xs font-bold text-muted">= {parsed[i] ? formatRinggit(parsed[i]!.amountSen) : '—'}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setLines((list) => [...list, { name: '', quantity: '1', price: '', decision: 'pending' }])} className="mt-2 flex min-h-11 items-center gap-2 text-sm font-bold text-ink underline">
          <Plus aria-hidden="true" className="size-4" /> Add a line
        </button>
      </div>

      <p className={`text-sm font-bold ${totalSen !== null && sum === totalSen ? 'text-green-800' : 'text-amber-800'}`}>
        Lines add up to {formatRinggit(sum)}{totalSen !== null ? (sum === totalSen ? ' — matches the total.' : ` — the total is ${formatRinggit(totalSen)}.`) : '.'}
      </p>
      {problem ? <p role="alert" className="text-sm font-bold text-serious">{problem}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className="vista-button-primary min-h-12 flex-1 disabled:opacity-50">{busy ? 'Saving…' : 'Save corrections'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="vista-button-secondary min-h-12">Cancel</button>
      </div>
    </div>
  )
}

/** The parts of this receipt already in the books, each open to re-categorising. */
function BookedParts({ store, detail, onDone }: { store: VistaStore; detail: StashDetail; onDone: (message: string) => void }) {
  const booked = detail.expenses.filter((e) => !e.uncategorised)
  const [editing, setEditing] = useState<string | null>(null)
  if (!booked.length) return null
  const brandName = (id: string | null) => (id === null ? 'Shared' : (store.brands.find((b) => b.id === id)?.name ?? '—'))
  const categoryName = (c: ExpenseCategory) => CATEGORIES.find((x) => x.value === c)?.label ?? c
  return (
    <div>
      <p className="vista-field-label">In the books</p>
      <ul className="mt-1 divide-y divide-line border border-line bg-surface">
        {booked.map((e) => (
          <li key={e.id} className="px-3 py-2">
            {editing === e.id ? (
              <PartEditor store={store} receiptKey={detail.receiptKey} part={e} onCancel={() => setEditing(null)} onSaved={(m) => { setEditing(null); onDone(m) }} />
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{brandName(e.brandId)} · {categoryName(e.category)}</span>
                  <span className="text-muted">{e.lines.length ? ` · line${e.lines.length > 1 ? 's' : ''} ${e.lines.map((i) => i + 1).join(', ')}` : ''}{e.paymentMethod ? ` · ${PAYMENT_METHODS.find((m) => m.value === e.paymentMethod)?.label}` : ''}</span>
                </span>
                <span className="tabular font-bold">{formatRinggit(e.amountSen)}</span>
                {e.isLocked ? <Badge tone="neutral">Settled</Badge> : (
                  <button type="button" onClick={() => setEditing(e.id)} aria-label={`Change ${brandName(e.brandId)} part`} className="grid size-10 place-items-center text-muted hover:bg-canvas hover:text-ink">
                    <Pencil aria-hidden="true" className="size-4" />
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PartEditor({ store, receiptKey, part, onCancel, onSaved }: { store: VistaStore; receiptKey: string; part: StashDetail['expenses'][number]; onCancel: () => void; onSaved: (message: string) => void }) {
  const foodBrand = store.brands[0]
  const drinksBrand = store.brands[1]
  const withSettlement = store.settings.settlementEnabled && drinksBrand !== undefined
  const [brand, setBrand] = useState<string | null>(part.brandId)
  const [category, setCategory] = useState<ExpenseCategory>(part.category)
  const [paidBy, setPaidBy] = useState<PaymentSource>(part.paidBy)
  const [method, setMethod] = useState<PaymentMethod | null>(part.paymentMethod)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const choice = (active: boolean) => `min-h-10 border px-2.5 text-xs font-bold ${active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink'}`
  async function save() {
    setBusy(true)
    setProblem('')
    try {
      await apiRequest('PATCH', `/rms/stash/${receiptKey}/expenses/${part.id}`, {
        brandId: brand, category, paidBy, paymentMethod: method,
        foodSplitPct: brand === null ? store.settings.sharedOverheadFoodPct : brand === foodBrand?.id ? 100 : 0,
      })
      await store.reloadBooks()
      onSaved('Changed. The books follow it.')
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'That could not be changed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 py-1">
      {withSettlement ? (
        <div className="flex flex-wrap gap-1.5">
          {[foodBrand, drinksBrand].map((b) => b && <button key={b.id} type="button" className={choice(brand === b.id)} onClick={() => setBrand(b.id)}>{b.name}</button>)}
          <button type="button" className={choice(brand === null)} onClick={() => setBrand(null)}>Shared</button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => <button key={c.value} type="button" className={choice(category === c.value)} onClick={() => setCategory(c.value)}>{c.label}</button>)}
      </div>
      {withSettlement ? (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={choice(paidBy === 'STALL_FUNDS')} onClick={() => setPaidBy('STALL_FUNDS')}>Stall funds</button>
          <button type="button" className={choice(paidBy === 'PARTNER_FOOD')} onClick={() => setPaidBy('PARTNER_FOOD')}>{foodBrand?.name} partner</button>
          <button type="button" className={choice(paidBy === 'PARTNER_DRINKS')} onClick={() => setPaidBy('PARTNER_DRINKS')}>{drinksBrand?.name} partner</button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {PAYMENT_METHODS.map((m) => <button key={m.value} type="button" className={choice(method === m.value)} onClick={() => setMethod(method === m.value ? null : m.value)}>{m.label}</button>)}
      </div>
      {problem ? <p role="alert" className="text-xs font-bold text-serious">{problem}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className="vista-button-primary min-h-10 flex-1 text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="vista-button-secondary min-h-10 text-sm">Cancel</button>
      </div>
    </div>
  )
}

type DuplicateOther = { kind: 'booked' | 'stash' | 'manual'; receiptKey: string | null; expenseIds: string[]; vendor: string | null; date: string | null; totalSen: number | null; reasons: string[]; hasScan: boolean }

function PlainImage({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let made: string | null = null
    let live = true
    apiFile(path).then((file) => { if (!live) return; made = URL.createObjectURL(file); setUrl(made) }).catch(() => live && setFailed(true))
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [path])
  return (
    <div className="h-[min(34rem,60vh)] overflow-auto border border-line bg-ink/95 p-1">
      {url ? <img src={url} alt={label} className="w-full bg-white" /> : <p className="p-3 text-xs text-white/70">{failed ? 'The photo could not be loaded.' : 'Loading…'}</p>}
    </div>
  )
}

/**
 * Two receipts that look like the same one, side by side, and what to do:
 * drop the new one, let it replace the other, or keep both.
 */
function DuplicateReview({ detail, onDone, onClose }: { detail: StashDetail; onDone: (message: string) => void; onClose: () => void }) {
  const [others, setOthers] = useState<DuplicateOther[] | null>(null)
  const [pick, setPick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    apiRequest<{ others: DuplicateOther[] }>('GET', `/rms/stash/${detail.receiptKey}/duplicates`).then((r) => setOthers(r.others)).catch(() => setOthers([]))
  }, [detail.receiptKey])
  const other = others?.[pick]
  const replaceText = other ? { booked: 'Keep that booking, with this new photo', stash: 'Drop the other photo, keep this one', manual: 'Attach this photo to that expense' }[other.kind] : ''
  const where = other ? { booked: 'Already in Vista', stash: 'Also in the stash', manual: 'Typed into Vista by hand' }[other.kind] : ''

  async function settle(action: 'cancel' | 'replace' | 'keep') {
    if (action === 'cancel' && !window.confirm('Drop the new photo? It leaves the stash and the books.')) return
    setBusy(true)
    setProblem('')
    try {
      await apiRequest('POST', `/rms/stash/${detail.receiptKey}/duplicate`, {
        action,
        otherKey: other?.receiptKey ?? null,
        expenseIds: other?.kind === 'manual' ? other.expenseIds : null,
      })
      onDone({ cancel: 'Dropped the new photo.', keep: other?.kind === 'manual' ? 'Kept apart. It stays in the books as not categorised.' : 'Kept both. It stays in the books as not categorised.', replace: other?.kind === 'booked' ? 'Replaced the photo; the booking stays.' : other?.kind === 'manual' ? 'Linked: that expense now has this receipt.' : 'Replaced: the other photo is gone.' }[action])
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'That could not be done.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-black">{other?.kind === 'manual' ? 'The receipt for an expense you keyed in?' : 'Same receipt twice?'}</h3>
        <button type="button" onClick={onClose} className="vista-button-secondary min-h-10 px-3 text-sm">Back</button>
      </div>
      {!others ? <p className="text-sm text-muted">Looking for it…</p> : !other ? (
        <p className="text-sm text-muted">No duplicate found any more. It may have been settled already.</p>
      ) : (
        <>
          {others.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {others.map((o, i) => <button key={i} type="button" onClick={() => setPick(i)} className={`min-h-9 border px-3 text-xs font-bold ${pick === i ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{o.receiptKey ?? 'Hand-typed'} · {o.totalSen ? formatRinggit(o.totalSen) : ''}</button>)}
            </div>
          ) : null}
          <p className="text-sm font-bold text-amber-900">Why: {other.reasons.join(', ') || 'they look alike'}.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-black uppercase text-muted">New · {detail.receiptKey}</p>
              <PlainImage path={`/rms/stash/${detail.receiptKey}/scan`} label="The new photo" />
              <p className="mt-1 text-sm font-bold">{detail.vendor ?? 'Receipt'}</p>
              <p className="text-xs text-muted">{detail.date ? formatDate(detail.date) : '—'} · {detail.totalSen ? formatRinggit(detail.totalSen) : '—'}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-black uppercase text-muted">{where}{other.receiptKey ? ` · ${other.receiptKey}` : ''}</p>
              {other.receiptKey && other.hasScan ? <PlainImage path={`/rms/receipts/${other.receiptKey}/scan`} label="The other receipt" /> : (
                <div className="grid h-[min(34rem,60vh)] place-items-center border border-dashed border-line bg-canvas p-3 text-center text-sm text-muted">No photo — this one was typed in by hand.</div>
              )}
              <p className="mt-1 text-sm font-bold">{other.vendor ?? 'Expense'}</p>
              <p className="text-xs text-muted">{other.date ? formatDate(other.date) : '—'} · {other.totalSen ? formatRinggit(other.totalSen) : '—'}</p>
            </div>
          </div>
          {problem ? <p role="alert" className="text-sm font-bold text-serious">{problem}</p> : null}
          {other.kind === 'manual' ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <button type="button" disabled={busy} onClick={() => void settle('replace')} className="vista-button-primary min-h-12 text-sm disabled:opacity-50">🔗 Link to it</button>
                <button type="button" disabled={busy} onClick={() => void settle('keep')} className="vista-button-secondary min-h-12 text-sm disabled:opacity-50">It’s a different one</button>
                <button type="button" disabled={busy} onClick={() => void settle('cancel')} className="vista-button-secondary min-h-12 text-sm disabled:opacity-50">✗ Drop the photo</button>
              </div>
              <p className="text-xs text-muted">Link: the expense you keyed in keeps its brand and category, and gets this receipt. Nothing is booked twice.</p>
            </>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <button type="button" disabled={busy} onClick={() => void settle('cancel')} className="vista-button-secondary min-h-12 text-sm disabled:opacity-50">✗ Cancel the new one</button>
                <button type="button" disabled={busy} onClick={() => void settle('replace')} className="vista-button-primary min-h-12 text-sm disabled:opacity-50" title={replaceText}>⇄ Replace</button>
                <button type="button" disabled={busy} onClick={() => void settle('keep')} className="vista-button-secondary min-h-12 text-sm disabled:opacity-50">Keep both</button>
              </div>
              <p className="text-xs text-muted">Replace: {replaceText.toLowerCase()}.</p>
            </>
          )}
        </>
      )}
    </div>
  )
}

type Choice = { brand: string | null; category: ExpenseCategory; paidBy: PaymentSource; method: PaymentMethod | null }

const chip = (active: boolean) =>
  `min-h-11 border px-3 text-sm font-bold ${active ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:bg-white'}`

/** Brand, category, who paid and how: the settings one booking gets. */
function ChoiceFields({ store, value, onChange }: { store: VistaStore; value: Choice; onChange: (next: Choice) => void }) {
  const foodBrand = store.brands[0]
  const drinksBrand = store.brands[1]
  const withSettlement = store.settings.settlementEnabled && drinksBrand !== undefined
  const set = (patch: Partial<Choice>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-3">
      {withSettlement ? (
        <div>
          <p className="vista-field-label">Brand</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {[foodBrand, drinksBrand].map((b) => b && (
              <button key={b.id} type="button" className={chip(value.brand === b.id)} onClick={() => set({ brand: b.id })}>{b.name}</button>
            ))}
            <button type="button" className={chip(value.brand === null)} onClick={() => set({ brand: null })}>Shared {store.settings.sharedOverheadFoodPct}/{100 - store.settings.sharedOverheadFoodPct}</button>
          </div>
        </div>
      ) : null}
      <div>
        <p className="vista-field-label">Category</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => <button key={c.value} type="button" className={chip(value.category === c.value)} onClick={() => set({ category: c.value })}>{c.label}</button>)}
        </div>
      </div>
      {withSettlement ? (
        <div>
          <p className="vista-field-label">Who paid</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="button" className={chip(value.paidBy === 'STALL_FUNDS')} onClick={() => set({ paidBy: 'STALL_FUNDS' })}>Stall funds</button>
            <button type="button" className={chip(value.paidBy === 'PARTNER_FOOD')} onClick={() => set({ paidBy: 'PARTNER_FOOD' })}>{foodBrand?.name} partner</button>
            <button type="button" className={chip(value.paidBy === 'PARTNER_DRINKS')} onClick={() => set({ paidBy: 'PARTNER_DRINKS' })}>{drinksBrand?.name} partner</button>
          </div>
        </div>
      ) : null}
      <div>
        <p className="vista-field-label">Payment</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => <button key={m.value} type="button" className={chip(value.method === m.value)} onClick={() => set({ method: value.method === m.value ? null : m.value })}>{m.label}</button>)}
        </div>
      </div>
    </div>
  )
}

const PART_TONES = ['bg-ink text-white', 'bg-sky-700 text-white', 'bg-amber-600 text-white', 'bg-emerald-700 text-white', 'bg-fuchsia-700 text-white']

function Sorter({ store, detail, onDone, onEdit, onReview }: { store: VistaStore; detail: StashDetail; onDone: (message: string) => void; onEdit: () => void; onReview: () => void }) {
  const foodBrand = store.brands[0]
  const withSettlement = store.settings.settlementEnabled && store.brands[1] !== undefined
  const pending = detail.lines.filter((line) => line.decision === 'pending')
  const [split, setSplit] = useState(false)
  const [ticked, setTicked] = useState<number[]>(() => pending.map((line) => line.index))
  // Split: every open line belongs to a part (or is left out); each part is booked with its own settings.
  const [parts, setParts] = useState<Choice[]>(() => [{
    brand: !withSettlement ? foodBrand?.id ?? null : detail.guess ? detail.guess.brandId : foodBrand?.id ?? null,
    category: detail.guess?.category ?? 'RAW_MATERIALS', paidBy: 'STALL_FUNDS', method: null,
  }])
  const [assign, setAssign] = useState<Record<number, number | 'out'>>(() => Object.fromEntries(pending.map((line) => [line.index, 0])))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // One ID per booking choice, kept across a retry: a lost answer never books twice.
  const attempts = useRef(new Map<string, string>())
  const attemptFor = (key: string) => {
    if (!attempts.current.has(key)) attempts.current.set(key, crypto.randomUUID())
    return attempts.current.get(key)!
  }

  const sum = (indexes: number[]) => detail.lines.filter((line) => indexes.includes(line.index)).reduce((total, line) => total + line.amountSen, 0)
  const amount = sum(ticked)
  const toggle = (index: number) => setTicked((list) => (list.includes(index) ? list.filter((i) => i !== index) : [...list, index].toSorted((a, b) => a - b)))
  const linesOf = (part: number | 'out') => pending.filter((line) => assign[line.index] === part).map((line) => line.index)

  async function bookPart(lines: number[], choice: Choice) {
    const payload = {
      lines, expectedSen: sum(lines), brandId: choice.brand, category: choice.category, paidBy: choice.paidBy, paymentMethod: choice.method,
      foodSplitPct: choice.brand === null ? store.settings.sharedOverheadFoodPct : choice.brand === foodBrand?.id ? 100 : 0,
    }
    await apiRequest('POST', `/rms/stash/${detail.receiptKey}/book`, { submissionId: attemptFor(JSON.stringify(payload)), ...payload })
  }

  async function book() {
    setBusy(true)
    setProblem('')
    try {
      await bookPart(ticked, parts[0]!)
      onDone(`Booked ${formatRinggit(amount)} from ${detail.vendor ?? detail.receiptKey}.`)
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'That could not be booked.')
    } finally {
      setBusy(false)
    }
  }

  async function bookAll() {
    const out = linesOf('out')
    if (out.length && !window.confirm(`Leave ${out.length === 1 ? 'one line' : `${out.length} lines`} (${formatRinggit(sum(out))}) out of the books?`)) return
    setBusy(true)
    setProblem('')
    let booked = 0
    try {
      for (const [n, choice] of parts.entries()) {
        const lines = linesOf(n)
        if (!lines.length) continue
        await bookPart(lines, choice)
        booked += 1
      }
      if (out.length) await apiRequest('POST', `/rms/stash/${detail.receiptKey}/scrap`, { lines: out })
      onDone(`Split ${detail.vendor ?? detail.receiptKey} into ${booked} booking${booked === 1 ? '' : 's'}${out.length ? `, ${formatRinggit(sum(out))} left out` : ''}.`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'That could not be booked.'
      if (booked) onDone(`Booked ${booked} part${booked === 1 ? '' : 's'}; the next one failed: ${message}`)
      else setProblem(message)
    } finally {
      setBusy(false)
    }
  }

  async function scrap() {
    if (!window.confirm(`Leave ${ticked.length === 1 ? 'this line' : 'these lines'} (${formatRinggit(amount)}) out of the books?`)) return
    setBusy(true)
    setProblem('')
    try {
      await apiRequest('POST', `/rms/stash/${detail.receiptKey}/scrap`, { lines: ticked })
      onDone(`Left ${formatRinggit(amount)} out of the books.`)
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'That could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  function removePart(n: number) {
    setParts((list) => list.filter((_, i) => i !== n))
    setAssign((map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v === 'out' ? v : v === n ? 0 : v > n ? v - 1 : v])))
  }

  const usedParts = parts.filter((_, n) => linesOf(n).length > 0).length
  const splitTotal = sum(pending.map((line) => line.index).filter((i) => assign[i] !== 'out'))

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="page-kicker">{detail.receiptKey}{detail.receiptNo ? ` · No. ${detail.receiptNo}` : ''}</p>
          <h3 className="mt-1 text-2xl font-black">{detail.vendor ?? 'Receipt'}</h3>
          <p className="text-sm font-semibold text-muted">
            {detail.date ? formatDate(detail.date) : 'No date read'} · {detail.totalSen === null ? 'no total read' : formatRinggit(detail.totalSen)}
          </p>
        </div>
        {detail.lines.length ? (
          <button type="button" onClick={onEdit} className="vista-button-secondary flex min-h-11 shrink-0 items-center gap-2">
            <Pencil aria-hidden="true" className="size-4" /> Edit
          </button>
        ) : null}
      </div>

      {detail.problem || detail.warning || detail.duplicate || !detail.ready ? (
        <div className="space-y-1 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {detail.duplicate ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex flex-1 gap-2 font-bold"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Looks like a receipt already in Vista, or an expense keyed in by hand.</p>
              <button type="button" onClick={onReview} className="min-h-10 rounded border border-amber-700 bg-white px-3 text-sm font-bold text-amber-900">⚑ Review</button>
            </div>
          ) : null}
          {detail.problem ? <p>{detail.problem}</p> : null}
          {detail.warning ? <p>{detail.warning}</p> : null}
          {!detail.ready && !detail.problem ? <p>Chopper is still checking this one, or its lines don’t add up to the total. Tap Edit to fix the reading.</p> : null}
        </div>
      ) : null}

      {pending.length > 1 ? (
        <div className="flex border border-line" role="group" aria-label="How to book">
          <button type="button" aria-pressed={!split} onClick={() => setSplit(false)} className={`min-h-10 flex-1 text-sm font-bold ${!split ? 'bg-ink text-white' : 'bg-surface'}`}>One booking</button>
          <button type="button" aria-pressed={split} onClick={() => setSplit(true)} className={`min-h-10 flex-1 text-sm font-bold ${split ? 'bg-ink text-white' : 'bg-surface'}`}>Split by line</button>
        </div>
      ) : null}

      <fieldset>
        <legend className="vista-field-label">{split ? 'Lines — pick a part for each' : 'Lines — tick the ones that go together'}</legend>
        <ul className="mt-1 divide-y divide-line border border-line bg-surface">
          {detail.lines.map((line) => {
            const open = line.decision === 'pending'
            const label = (
              <span className={`min-w-0 flex-1 ${line.decision === 'scrapped' ? 'line-through' : ''}`}>
                <span className="font-bold text-ink">{line.index + 1}. {line.name}</span>
                {line.quantityMilli !== 1000 ? <span className="text-muted"> · {quantity(line.quantityMilli)} × {formatRinggit(line.unitPriceSen)}</span> : null}
              </span>
            )
            if (open && split) {
              const at = assign[line.index] ?? 0
              return (
                <li key={line.index} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
                  {label}
                  <span className="tabular font-bold">{formatRinggit(line.amountSen)}</span>
                  <span className="flex w-full flex-wrap gap-1">
                    {parts.map((_, n) => (
                      <button key={n} type="button" onClick={() => setAssign((map) => ({ ...map, [line.index]: n }))} aria-pressed={at === n}
                        className={`min-h-9 border px-2 text-xs font-black ${at === n ? `${PART_TONES[n % PART_TONES.length]} border-transparent` : 'border-line bg-white text-ink'}`}>Part {n + 1}</button>
                    ))}
                    <button type="button" onClick={() => setAssign((map) => ({ ...map, [line.index]: 'out' }))} aria-pressed={at === 'out'}
                      className={`min-h-9 border px-2 text-xs font-bold ${at === 'out' ? 'border-serious bg-serious text-white' : 'border-line bg-white text-muted'}`}>Leave out</button>
                  </span>
                </li>
              )
            }
            return (
              <li key={line.index}>
                <label className={`flex min-h-12 items-center gap-3 px-3 py-2 text-sm ${open ? 'cursor-pointer hover:bg-white' : 'text-muted'}`}>
                  {open ? (
                    <input type="checkbox" checked={ticked.includes(line.index)} onChange={() => toggle(line.index)} className="size-5 accent-ink" />
                  ) : line.decision === 'posted' ? (
                    <Check aria-label="Booked" className="size-5 text-green-700" />
                  ) : (
                    <X aria-label="Left out" className="size-5 text-serious" />
                  )}
                  {label}
                  <span className="tabular font-bold">{formatRinggit(line.amountSen)}</span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>

      {pending.length ? (
        <>
          {detail.guess ? (
            <p className="text-xs font-semibold text-muted">Filled in from {detail.guess.source === 'vendor history' ? 'past receipts from this shop' : 'what these items were booked as before'} — change anything that’s wrong.</p>
          ) : null}

          {split ? (
            <>
              {parts.map((choice, n) => (
                <section key={n} className="space-y-3 border border-line p-3">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs font-black ${PART_TONES[n % PART_TONES.length]}`}>Part {n + 1}</span>
                    <span className="flex-1 text-sm font-bold">{linesOf(n).length ? `${linesOf(n).length} line${linesOf(n).length === 1 ? '' : 's'} · ${formatRinggit(sum(linesOf(n)))}` : <span className="text-muted">No lines yet — pick Part {n + 1} on a line</span>}</span>
                    {n > 0 ? <button type="button" onClick={() => removePart(n)} className="min-h-9 px-2 text-xs font-bold text-muted hover:text-serious">Remove</button> : null}
                  </div>
                  <ChoiceFields store={store} value={choice} onChange={(next) => setParts((list) => list.map((c, i) => (i === n ? next : c)))} />
                </section>
              ))}
              {parts.length < pending.length ? (
                <button type="button" onClick={() => setParts((list) => [...list, { ...list[list.length - 1]! }])} className="vista-button-secondary flex min-h-11 w-full items-center justify-center gap-2 text-sm">
                  <Plus aria-hidden="true" className="size-4" /> Add a part
                </button>
              ) : null}
              {problem ? <p role="alert" className="text-sm font-bold text-serious">{problem}</p> : null}
              <button type="button" disabled={busy || !detail.ready || (!usedParts && !linesOf('out').length)} onClick={() => void bookAll()} className="vista-button-primary min-h-12 w-full disabled:opacity-50">
                {busy ? 'Working…' : usedParts ? `Book ${usedParts} part${usedParts === 1 ? '' : 's'} · ${formatRinggit(splitTotal)}` : 'Leave them all out'}
              </button>
            </>
          ) : (
            <>
              <ChoiceFields store={store} value={parts[0]!} onChange={(next) => setParts((list) => [next, ...list.slice(1)])} />
              {problem ? <p role="alert" className="text-sm font-bold text-serious">{problem}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || !ticked.length || !detail.ready} onClick={() => void book()} className="vista-button-primary min-h-12 flex-1 disabled:opacity-50">
                  {busy ? 'Working…' : ticked.length ? `Book ${ticked.length === pending.length ? 'it' : 'ticked lines'} · ${formatRinggit(amount)}` : 'Tick the lines first'}
                </button>
                <button type="button" disabled={busy || !ticked.length} onClick={() => void scrap()} className="vista-button-secondary min-h-12 disabled:opacity-50">
                  Leave out
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <p className="text-sm font-bold text-green-800">All sorted. Chopper files the scan in Drive.</p>
      )}

      <BookedParts store={store} detail={detail} onDone={onDone} />
    </div>
  )
}

/** A receipt in the list: a small preview of its scan (loaded when it scrolls into view), shop, date and amount. */
function ReceiptRow({ receipt, sorted, active, onOpen }: { receipt: StashSummary; sorted: boolean; active: boolean; onOpen: () => void }) {
  const box = useRef<HTMLButtonElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const element = box.current
    if (!element) return
    let made: string | null = null
    let live = true
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      observer.disconnect()
      apiFile(`/rms/stash/${receipt.receiptKey}/thumb`)
        .then((file) => { if (!live) return; made = URL.createObjectURL(file); setUrl(made) })
        .catch(() => live && setFailed(true))
    }, { rootMargin: '200px' })
    observer.observe(element)
    return () => { live = false; observer.disconnect(); if (made) URL.revokeObjectURL(made) }
  }, [receipt.receiptKey])
  const amount = (sorted ? receipt.bookedSen : receipt.pendingSen) || receipt.totalSen || 0
  return (
    <button ref={box} type="button" onClick={onOpen} aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center gap-3 border-l-4 px-3 py-2 text-left ${active ? 'border-ink bg-canvas' : 'border-transparent hover:bg-white'}`}>
      <span className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden border border-line bg-canvas">
        {url ? <img src={url} alt="" className="size-full object-cover object-top" /> : failed ? <ImageIcon aria-hidden="true" className="size-4 text-muted" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-black text-ink">{receipt.vendor ?? 'Reading…'}</span>
          <span className="tabular shrink-0 text-sm font-bold text-ink">{formatRinggit(amount)}</span>
        </span>
        <span className="flex items-center justify-between gap-2 text-xs font-semibold text-muted">
          <span className="truncate">{receipt.date ? formatDate(receipt.date) : '—'} · {receipt.receiptKey}</span>
          <span className="flex shrink-0 gap-1">
            {receipt.duplicate ? <Badge tone="warning">Duplicate?</Badge> : null}
            {receipt.problem || (!sorted && !receipt.ready) ? <Badge tone="warning">Check</Badge> : null}
            {!sorted && receipt.bookedSen ? <Badge tone="info">Part sorted</Badge> : null}
            {sorted && receipt.pendingSen ? <Badge tone="info">Part open</Badge> : null}
          </span>
        </span>
      </span>
    </button>
  )
}

/**
 * Chopper's receipts as a list: Stashed (still to sort) and Sorted (already in
 * the books), newest first. The open one shows beside the list, its scan next
 * to its lines, to sort, split, correct or change.
 */
export function StashTab({ store, onCount, openKey = null }: { store: VistaStore; onCount: (n: number) => void; openKey?: string | null }) {
  const [area, setArea] = useState<'stashed' | 'sorted'>('stashed')
  const [lists, setLists] = useState<{ stashed: StashSummary[] | null; sorted: StashSummary[] | null }>({ stashed: null, sorted: null })
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<StashDetail | null>(null)
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  useEffect(() => { if (openKey) { setSelected(openKey); setNotice('') } }, [openKey])

  const loadLists = useCallback(async () => {
    try {
      const [stashed, sorted] = await Promise.all([stashApi.list(false), stashApi.list(true)])
      setLists({ stashed: stashed.receipts, sorted: sorted.receipts })
      onCount(stashed.count)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The receipts could not be loaded.')
    }
  }, [onCount])

  useEffect(() => {
    void loadLists()
    const timer = window.setInterval(() => void loadLists(), 30_000)
    return () => window.clearInterval(timer)
  }, [loadLists])

  useEffect(() => {
    setEditing(false)
    setReviewing(false)
    if (!selected) { setDetail(null); return }
    let live = true
    stashApi.detail(selected).then((d) => live && setDetail(d)).catch(() => live && setDetail(null))
    return () => { live = false }
  }, [selected])

  async function done(message: string) {
    setNotice(message)
    setEditing(false)
    setReviewing(false)
    await store.reloadBooks()
    await loadLists()
    if (selected) setDetail(await stashApi.detail(selected).catch(() => null))
  }

  const sorted = useMemo(() => (lists.sorted ?? []).toSorted((a, b) => (b.date ?? '').localeCompare(a.date ?? '')), [lists.sorted])
  const crumbs = [area === 'stashed' ? 'Stashed' : 'Sorted']
  const goTo = () => { setSelected(null); setNotice('') }
  const stashed = lists.stashed ?? []

  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      {([['stashed', `Stashed${lists.stashed ? ` (${stashed.length})` : ''}`], ['sorted', 'Sorted']] as const).map(([key, label]) => (
        <button key={key} type="button" onClick={() => { setArea(key); setSelected(null); setNotice('') }}
          className={`flex min-h-11 items-center gap-2 border px-4 text-sm font-bold ${area === key ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:bg-white'}`}>
          {key === 'stashed' ? <Inbox aria-hidden="true" className="size-4" /> : <FolderCheck aria-hidden="true" className="size-4" />}
          {label}
        </button>
      ))}
      <nav aria-label="Folder" className="ml-1 flex flex-wrap items-center gap-1 text-sm font-bold text-muted">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight aria-hidden="true" className="size-4" /> : null}
            {i < crumbs.length - 1 || selected ? (
              <button type="button" onClick={goTo} className="min-h-9 px-1 underline-offset-2 hover:text-ink hover:underline">{c}</button>
            ) : <span className="px-1 text-ink">{c}</span>}
          </span>
        ))}
        {selected && detail ? (<><ChevronRight aria-hidden="true" className="size-4" /><span className="px-1 text-ink">{detail.vendor ?? detail.receiptKey}</span></>) : null}
      </nav>
    </div>
  )

  if (error && !lists.stashed) return <Panel className="space-y-3 p-5">{bar}<p role="alert" className="text-sm font-bold text-serious">{error}</p></Panel>
  if (!lists.stashed) return <Panel className="space-y-3 p-5">{bar}<p className="text-sm text-muted">Loading the receipts…</p></Panel>

  const shown = area === 'stashed' ? stashed : sorted
  const list = shown.length ? (
    <Panel className="divide-y divide-line overflow-y-auto p-0 lg:max-h-[calc(100vh-10rem)]">
      {shown.map((r) => <ReceiptRow key={r.receiptKey} receipt={r} sorted={area === 'sorted'} active={r.receiptKey === selected} onOpen={() => { setSelected(r.receiptKey); setNotice('') }} />)}
    </Panel>
  ) : area === 'stashed' ? (
    <EmptyState title="Nothing to sort" hint="Receipts sent to Chopper on Telegram show up here, already in the books as not categorised, until their lines are sorted." />
  ) : (
    <EmptyState title="Nothing sorted yet" hint="Receipts you sort show up here, to reopen, correct or change." />
  )

  // The open receipt: its scan beside its lines.
  const open = selected ? (
    detail ? (
      <Panel className="p-4 sm:p-5">
        {notice ? <p role="status" className="mb-3 flex items-center gap-2 text-sm font-bold text-green-800"><Check aria-hidden="true" className="size-4" />{notice}</p> : null}
        {reviewing ? (
          <DuplicateReview detail={detail} onClose={() => setReviewing(false)} onDone={(m) => void done(m)} />
        ) : (
          <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="h-[50vh] 2xl:sticky 2xl:top-4 2xl:h-[calc(100vh-10rem)]">
              <ScanViewer key={detail.receiptKey} receiptKey={detail.receiptKey} hasOriginal={detail.hasOriginal} />
            </div>
            {editing ? (
              <ReadingEditor detail={detail} onCancel={() => setEditing(false)} onSaved={(m) => void done(m)} />
            ) : (
              <Sorter key={`${detail.receiptKey}:${detail.lines.map((l) => `${l.decision}${l.amountSen}`).join()}`} store={store} detail={detail} onDone={(m) => void done(m)} onEdit={() => { setNotice(''); setEditing(true) }} onReview={() => { setNotice(''); setReviewing(true) }} />
            )}
          </div>
        )}
      </Panel>
    ) : <Panel className="p-5"><p className="text-sm text-muted">Opening the receipt…</p></Panel>
  ) : null

  return (
    <div className="space-y-3">
      {bar}
      <div className="grid items-start gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className={selected ? 'hidden lg:block' : ''}>{list}</div>
        {selected ? (
          <div className="space-y-2">
            <button type="button" onClick={goTo} className="flex min-h-11 items-center gap-1 text-sm font-bold text-ink hover:underline lg:hidden">
              <ChevronLeft aria-hidden="true" className="size-4" /> Back to {crumbs[0]}
            </button>
            {open}
          </div>
        ) : shown.length ? (
          <Panel className="hidden min-h-64 place-items-center p-5 text-sm text-muted lg:grid">Pick a receipt to see it here.</Panel>
        ) : null}
      </div>
    </div>
  )
}
