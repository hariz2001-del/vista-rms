import { AlertTriangle, Check, Image as ImageIcon, X, ZoomIn, ZoomOut } from 'lucide-react'
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
  expenses: Array<{ id: string; amountSen: number; brandId: string | null; category: ExpenseCategory; uncategorised: boolean; description: string }>
  guess: { category: ExpenseCategory; brandId: string | null; source: string } | null
  hasOriginal: boolean
}

export const stashApi = {
  list: () => apiRequest<{ receipts: StashSummary[]; count: number }>('GET', '/rms/stash'),
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

function Sorter({ store, detail, onDone }: { store: VistaStore; detail: StashDetail; onDone: (message: string) => void }) {
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
      <div>
        <p className="page-kicker">{detail.receiptKey}{detail.receiptNo ? ` · No. ${detail.receiptNo}` : ''}</p>
        <h3 className="mt-1 text-2xl font-black">{detail.vendor ?? 'Receipt'}</h3>
        <p className="text-sm font-semibold text-muted">
          {detail.date ? formatDate(detail.date) : 'No date read'} · {detail.totalSen === null ? 'no total read' : formatRinggit(detail.totalSen)}
        </p>
      </div>

      {detail.problem || detail.warning || detail.duplicate || !detail.ready ? (
        <div className="space-y-1 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {detail.duplicate ? <p className="flex gap-2 font-bold"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Looks like a receipt already in Vista. Check Expenses before booking it again.</p> : null}
          {detail.problem ? <p>{detail.problem}</p> : null}
          {detail.warning ? <p>{detail.warning}</p> : null}
          {!detail.ready && !detail.problem ? <p>Chopper is still checking this one, or its lines don’t add up to the total. Fix the reading in Chopper first.</p> : null}
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
        <p className="text-sm font-bold text-green-800">All sorted. Chopper is filing the scan in Drive.</p>
      )}
    </div>
  )
}

export function StashTab({ store, onCount }: { store: VistaStore; onCount: (n: number) => void }) {
  const [list, setList] = useState<StashSummary[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<StashDetail | null>(null)
  const [notice, setNotice] = useState('')

  const loadList = useCallback(async () => {
    try {
      const result = await stashApi.list()
      setList(result.receipts)
      onCount(result.count)
      setError('')
      setSelected((key) => key ?? result.receipts[0]?.receiptKey ?? null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The stash could not be loaded.')
    }
  }, [onCount])

  useEffect(() => {
    void loadList()
    const timer = window.setInterval(() => void loadList(), 20_000)
    return () => window.clearInterval(timer)
  }, [loadList])

  useEffect(() => {
    if (!selected) { setDetail(null); return }
    let live = true
    stashApi.detail(selected).then((d) => live && setDetail(d)).catch(() => live && setDetail(null))
    return () => { live = false }
  }, [selected])

  const sorted = useMemo(() => list ?? [], [list])

  async function done(message: string) {
    setNotice(message)
    await store.reloadBooks()
    await loadList()
    if (selected) setDetail(await stashApi.detail(selected).catch(() => null))
  }

  if (error && !list) return <Panel className="p-5"><p role="alert" className="text-sm font-bold text-serious">{error}</p></Panel>
  if (!list) return <Panel className="p-5"><p className="text-sm text-muted">Loading the stash…</p></Panel>
  if (!sorted.length) {
    return (
      <Panel className="p-5">
        <EmptyState title="Nothing to sort" hint="Receipts sent to Chopper on Telegram show up here, already in the books as not categorised, until their lines are sorted." />
      </Panel>
    )
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <Panel className="p-2">
        <p className="px-2 pb-2 pt-1 text-xs font-bold uppercase tracking-wider text-muted">{sorted.length} to sort</p>
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
                  <span className="tabular text-sm font-bold">{formatRinggit(r.pendingSen || r.totalSen || 0)}</span>
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
            <Sorter key={`${detail.receiptKey}:${detail.lines.map((l) => l.decision).join()}`} store={store} detail={detail} onDone={(m) => void done(m)} />
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
