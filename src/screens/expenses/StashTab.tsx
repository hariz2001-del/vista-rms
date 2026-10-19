import { AlertTriangle, Check, Image as ImageIcon, Pencil, Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
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

function Sorter({ store, detail, onDone, onEdit }: { store: VistaStore; detail: StashDetail; onDone: (message: string) => void; onEdit: () => void }) {
  const foodBrand = store.brands[0]
  const drinksBrand = store.brands[1]
  const withSettlement = store.settings.settlementEnabled && drinksBrand !== undefined
  const pending = detail.lines.filter((line) => line.decision === 'pending')
  const [ticked, setTicked] = useState<number[]>(() => pending.map((line) => line.index))
  const [category, setCategory] = useState<ExpenseCategory>(detail.guess?.category ?? 'RAW_MATERIALS')
  const [brand, setBrand] = useState<string | null>(() => {
    if (!withSettlement) return foodBrand?.id ?? null
    if (detail.guess) return detail.guess.brandId
    return foodBrand?.id ?? null
  })
  const [paidBy, setPaidBy] = useState<PaymentSource>('STALL_FUNDS')
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // One ID per choice, kept across a retry: a lost answer never books twice.
  const attempt = useRef<string>(crypto.randomUUID())
  const choiceKey = JSON.stringify([ticked, category, brand, paidBy, method])
  useEffect(() => { attempt.current = crypto.randomUUID() }, [choiceKey])

  const amount = detail.lines.filter((line) => ticked.includes(line.index)).reduce((sum, line) => sum + line.amountSen, 0)
  const toggle = (index: number) => setTicked((list) => (list.includes(index) ? list.filter((i) => i !== index) : [...list, index].toSorted((a, b) => a - b)))

  async function book() {
    setBusy(true)
    setProblem('')
    try {
      await apiRequest('POST', `/rms/stash/${detail.receiptKey}/book`, {
        submissionId: attempt.current,
        lines: ticked,
        expectedSen: amount,
        brandId: brand,
        category,
        paidBy,
        paymentMethod: method,
        foodSplitPct: brand === null ? store.settings.sharedOverheadFoodPct : brand === foodBrand?.id ? 100 : 0,
      })
      onDone(`Booked ${formatRinggit(amount)} from ${detail.vendor ?? detail.receiptKey}.`)
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'That could not be booked.')
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

  const choice = (active: boolean) =>
    `min-h-11 border px-3 text-sm font-bold ${active ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:bg-white'}`

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
          {detail.duplicate ? <p className="flex gap-2 font-bold"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Looks like a receipt already in Vista. Check Expenses before booking it again.</p> : null}
          {detail.problem ? <p>{detail.problem}</p> : null}
          {detail.warning ? <p>{detail.warning}</p> : null}
          {!detail.ready && !detail.problem ? <p>Chopper is still checking this one, or its lines don’t add up to the total. Tap Edit to fix the reading.</p> : null}
        </div>
      ) : null}

      <fieldset>
        <legend className="vista-field-label">Lines — tick the ones that go together</legend>
        <ul className="mt-1 divide-y divide-line border border-line bg-surface">
          {detail.lines.map((line) => {
            const open = line.decision === 'pending'
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
                  <span className={`min-w-0 flex-1 ${line.decision === 'scrapped' ? 'line-through' : ''}`}>
                    <span className="font-bold text-ink">{line.index + 1}. {line.name}</span>
                    {line.quantityMilli !== 1000 ? <span className="text-muted"> · {quantity(line.quantityMilli)} × {formatRinggit(line.unitPriceSen)}</span> : null}
                  </span>
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

          {withSettlement ? (
            <div>
              <p className="vista-field-label">Brand</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {[foodBrand, drinksBrand].map((b) => b && (
                  <button key={b.id} type="button" className={choice(brand === b.id)} onClick={() => setBrand(b.id)}>{b.name}</button>
                ))}
                <button type="button" className={choice(brand === null)} onClick={() => setBrand(null)}>Shared {store.settings.sharedOverheadFoodPct}/{100 - store.settings.sharedOverheadFoodPct}</button>
              </div>
            </div>
          ) : null}

          <div>
            <p className="vista-field-label">Category</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button key={c.value} type="button" className={choice(category === c.value)} onClick={() => setCategory(c.value)}>{c.label}</button>
              ))}
            </div>
          </div>

          {withSettlement ? (
            <div>
              <p className="vista-field-label">Who paid</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" className={choice(paidBy === 'STALL_FUNDS')} onClick={() => setPaidBy('STALL_FUNDS')}>Stall funds</button>
                <button type="button" className={choice(paidBy === 'PARTNER_FOOD')} onClick={() => setPaidBy('PARTNER_FOOD')}>{foodBrand?.name} partner</button>
                <button type="button" className={choice(paidBy === 'PARTNER_DRINKS')} onClick={() => setPaidBy('PARTNER_DRINKS')}>{drinksBrand?.name} partner</button>
              </div>
            </div>
          ) : null}

          <div>
            <p className="vista-field-label">Payment</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button key={m.value} type="button" className={choice(method === m.value)} onClick={() => setMethod(method === m.value ? null : m.value)}>{m.label}</button>
              ))}
            </div>
          </div>

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
      ) : (
        <p className="text-sm font-bold text-green-800">All sorted. Chopper files the scan in Drive.</p>
      )}

      <BookedParts store={store} detail={detail} onDone={onDone} />
    </div>
  )
}

export function StashTab({ store, onCount }: { store: VistaStore; onCount: (n: number) => void }) {
  const [list, setList] = useState<StashSummary[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<StashDetail | null>(null)
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<'toSort' | 'sorted'>('toSort')
  const [editing, setEditing] = useState(false)

  const loadList = useCallback(async () => {
    try {
      const result = await stashApi.list(view === 'sorted')
      setList(result.receipts)
      onCount(result.count)
      setError('')
      setSelected((key) => (key && result.receipts.some((r) => r.receiptKey === key) ? key : (result.receipts[0]?.receiptKey ?? null)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The stash could not be loaded.')
    }
  }, [onCount, view])

  useEffect(() => {
    void loadList()
    const timer = window.setInterval(() => void loadList(), 20_000)
    return () => window.clearInterval(timer)
  }, [loadList])

  useEffect(() => {
    setEditing(false)
    if (!selected) { setDetail(null); return }
    let live = true
    stashApi.detail(selected).then((d) => live && setDetail(d)).catch(() => live && setDetail(null))
    return () => { live = false }
  }, [selected])

  const sorted = useMemo(() => list ?? [], [list])

  async function done(message: string) {
    setNotice(message)
    setEditing(false)
    await store.reloadBooks()
    await loadList()
    if (selected) setDetail(await stashApi.detail(selected).catch(() => null))
  }

  const switcher = (
    <div className="mb-3 flex gap-1">
      {([['toSort', 'To sort'], ['sorted', 'Sorted']] as const).map(([key, label]) => (
        <button key={key} type="button" onClick={() => { setView(key); setSelected(null); setList(null); setNotice('') }}
          className={`min-h-10 border px-3 text-sm font-bold ${view === key ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink hover:bg-white'}`}>
          {label}
        </button>
      ))}
    </div>
  )
  if (error && !list) return <Panel className="p-5">{switcher}<p role="alert" className="text-sm font-bold text-serious">{error}</p></Panel>
  if (!list) return <Panel className="p-5">{switcher}<p className="text-sm text-muted">Loading the stash…</p></Panel>
  if (!sorted.length) {
    return (
      <Panel className="p-5">
        {switcher}
        {view === 'toSort' ? (
          <EmptyState title="Nothing to sort" hint="Receipts sent to Chopper on Telegram show up here, already in the books as not categorised, until their lines are sorted." />
        ) : (
          <EmptyState title="Nothing sorted yet" hint="Receipts you have sorted show up here, to reopen and correct." />
        )}
      </Panel>
    )
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Panel className="p-2">
        <div className="px-1 pt-1">{switcher}</div>
        <p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-muted">{sorted.length} {view === 'toSort' ? 'to sort' : 'sorted'}</p>
        <ul className="space-y-1">
          {sorted.map((r) => (
            <li key={r.receiptKey}>
              <button
                type="button"
                onClick={() => { setSelected(r.receiptKey); setNotice('') }}
                className={`w-full border-l-4 px-3 py-2 text-left ${selected === r.receiptKey ? 'border-ink bg-canvas' : 'border-transparent hover:bg-canvas'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-black">{r.vendor ?? 'Reading…'}</span>
                  <span className="tabular text-sm font-bold">{formatRinggit((view === 'toSort' ? r.pendingSen : r.bookedSen) || r.totalSen || 0)}</span>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted">
                  <span>{r.date ? formatDate(r.date) : '—'} · {r.receiptKey}</span>
                  {r.duplicate ? <Badge tone="warning">Duplicate?</Badge> : null}
                  {r.problem || !r.ready ? <Badge tone="warning">Check</Badge> : null}
                  {r.bookedSen ? <Badge tone="info">Part sorted</Badge> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {detail ? (
        <Panel className="p-4 sm:p-5">
          {notice ? <p role="status" className="mb-3 flex items-center gap-2 text-sm font-bold text-green-800"><Check aria-hidden="true" className="size-4" />{notice}</p> : null}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)]">
              <ScanViewer key={detail.receiptKey} receiptKey={detail.receiptKey} hasOriginal={detail.hasOriginal} />
            </div>
            {editing ? (
              <ReadingEditor detail={detail} onCancel={() => setEditing(false)} onSaved={(m) => void done(m)} />
            ) : (
              <Sorter key={`${detail.receiptKey}:${detail.lines.map((l) => `${l.decision}${l.amountSen}`).join()}`} store={store} detail={detail} onDone={(m) => void done(m)} onEdit={() => { setNotice(''); setEditing(true) }} />
            )}
          </div>
        </Panel>
      ) : (
        <Panel className="grid min-h-60 place-items-center p-5 text-sm text-muted">
          <span className="flex items-center gap-2"><ImageIcon aria-hidden="true" className="size-4" /> Pick a receipt to sort it.</span>
        </Panel>
      )}
    </div>
  )
}
