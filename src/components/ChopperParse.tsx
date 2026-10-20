import { Check, ImagePlus, LoaderCircle, ScanText, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { formatRinggit } from '../domain/money.ts'
import { apiRequest } from '../lib/http.ts'
import { prepareReceiptPhoto } from '../lib/receipt-photo.ts'
import { chopperChatApi } from './ChopperChat.tsx'

/**
 * Receipts read by Chopper, from here: pick or drop as many photos as you like,
 * then Parse. Each goes through Chopper's own reading (the same as Telegram) and
 * lands in the books as not categorised, ready to sort now or later.
 */

type Staged = { id: string; file: File; url: string }
type Sent = { name: string; id: string | null; error: string | null }
type Status = { id: string; status: string; receiptKey: string | null; receipt: { state: string; vendor: string | null; totalSen: number | null; problem: string | null; duplicate: boolean; recorded: boolean } | null }

const openReceipt = (key: string) => {
  try { sessionStorage.setItem('vista.openReceipt', key) } catch { /* private window */ }
  window.dispatchEvent(new CustomEvent('vista:open-receipt', { detail: key }))
}

function Row({ sent, status, onRecorded }: { sent: Sent; status: Status | undefined; onRecorded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const r = status?.receipt
  const read = r && r.state !== 'PROCESSING' && r.state !== 'RECEIVING'
  async function putIn() {
    if (!status?.receiptKey) return
    setBusy(true)
    setProblem('')
    try {
      await apiRequest('POST', `/rms/stash/${status.receiptKey}/record`)
      onRecorded()
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'It could not be put in.')
    } finally {
      setBusy(false)
    }
  }
  let line: string
  let tone = 'text-muted'
  if (sent.error) { line = sent.error; tone = 'text-serious' }
  else if (!status || status.status === 'PENDING' || status.status === 'WORKING') line = 'Sent — Chopper is taking it in…'
  else if (status.status === 'FAILED') { line = 'Not taken in. Try it again.'; tone = 'text-serious' }
  else if (!read) line = 'Reading…'
  else if (r!.recorded) { line = 'In the books as not categorised.'; tone = 'text-green-800' }
  else if (r!.duplicate) { line = 'Looks like a receipt already in Vista — held back.'; tone = 'text-amber-800' }
  else if (r!.problem) { line = r!.problem; tone = 'text-amber-800' }
  else line = 'Read. Going into the books…'
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-b-0">
      {read && r?.recorded ? <Check aria-hidden="true" className="size-4 text-green-700" /> : sent.error || status?.status === 'FAILED' ? <X aria-hidden="true" className="size-4 text-serious" /> : <LoaderCircle aria-hidden="true" className={`size-4 ${read ? '' : 'animate-spin'} text-muted`} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{read ? (r!.vendor ?? 'Receipt') : sent.name}{read && r!.totalSen ? ` · ${formatRinggit(r!.totalSen)}` : ''}</span>
        <span className={`block text-xs font-semibold ${tone}`}>{problem || line}</span>
      </span>
      {read && status?.receiptKey && !r!.recorded ? (
        <button type="button" disabled={busy} onClick={() => void putIn()} className="vista-button-secondary min-h-9 px-3 text-xs disabled:opacity-50">{busy ? '…' : 'Put in the books anyway'}</button>
      ) : null}
      {read && status?.receiptKey ? (
        <button type="button" onClick={() => openReceipt(status.receiptKey!)} className="vista-button-secondary min-h-9 px-3 text-xs">Sort now</button>
      ) : null}
    </li>
  )
}

export function ChopperParse() {
  const [open, setOpen] = useState(false)
  const [staged, setStaged] = useState<Staged[]>([])
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<Sent[]>([])
  const [statuses, setStatuses] = useState<Record<string, Status>>({})
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const add = (files: File[]) => {
    const photos = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    setStaged((list) => [...list, ...photos.map((file) => ({ id: crypto.randomUUID(), file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' }))])
  }
  const remove = (id: string) => setStaged((list) => { const gone = list.find((s) => s.id === id); if (gone?.url) URL.revokeObjectURL(gone.url); return list.filter((s) => s.id !== id) })

  async function parse() {
    const batch = staged
    setStaged([])
    setSending(true)
    const results: Sent[] = batch.map((s) => ({ name: s.file.name, id: null, error: null }))
    setSent((prior) => [...results, ...prior])
    let next = 0
    const worker = async () => {
      while (next < batch.length) {
        const index = next++
        const item = batch[index]!
        try {
          const ready = await prepareReceiptPhoto(item.file)
          const message = await chopperChatApi.photo({ ...ready, source: 'expenses' })
          results[index] = { ...results[index]!, id: message.id }
        } catch (reason) {
          results[index] = { ...results[index]!, error: reason instanceof Error ? reason.message : 'Not sent.' }
        }
        setSent((prior) => [...results, ...prior.slice(results.length)])
        if (item.url) URL.revokeObjectURL(item.url)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setSending(false)
  }

  const ids = sent.flatMap((s) => (s.id ? [s.id] : []))
  const pending = ids.filter((id) => {
    const st = statuses[id]
    return !st || st.status === 'PENDING' || st.status === 'WORKING' || (st.status === 'ANSWERED' && (!st.receipt || st.receipt.state === 'PROCESSING' || (!st.receipt.recorded && !st.receipt.duplicate && !st.receipt.problem)))
  })
  const refresh = useCallback(async () => {
    if (!ids.length) return
    try {
      const result = await chopperChatApi.photos(`ids=${ids.slice(0, 100).join(',')}`)
      setStatuses((s) => ({ ...s, ...Object.fromEntries(result.receipts.map((r) => [r.id, r as unknown as Status])) }))
    } catch { /* next tick */ }
  }, [ids.join(',')])
  useEffect(() => {
    if (!pending.length) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => window.clearInterval(timer)
  }, [pending.length, refresh])

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    setOpen(true)
    add(Array.from(event.dataTransfer.files))
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex min-h-12 w-full items-center justify-center gap-2 border border-dashed hover:bg-canvas ${dragging ? 'border-ink bg-canvas' : 'border-slate-400'}`}
      >
        <img src="/chopper.jpg" alt="" className="size-6 rounded-full" />
        <span className="text-sm font-bold text-ink">Parse receipts with Chopper</span>
      </button>
    )
  }

  return (
    <div className="space-y-3 border border-rail/40 bg-canvas p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <img src="/chopper.jpg" alt="" className="size-7 rounded-full" />
          <p className="text-sm font-black text-ink">Parse receipts with Chopper</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-8 place-items-center text-muted hover:bg-surface">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <p className="text-xs text-muted">Add as many photos as you like, then Parse. Each goes into the books as not categorised — sort it now, or later under Stash from Chopper.</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`grid grid-cols-3 gap-2 border-2 border-dashed p-2 sm:grid-cols-4 ${dragging ? 'border-ink bg-white' : 'border-line'}`}
      >
        {staged.map((s) => (
          <div key={s.id} className="relative aspect-[3/4] overflow-hidden border border-line bg-white">
            {s.url ? <img src={s.url} alt={s.file.name} className="size-full object-cover object-top" /> : <span className="grid size-full place-items-center p-1 text-center text-[0.65rem] font-bold text-muted">{s.file.name}</span>}
            <button type="button" onClick={() => remove(s.id)} aria-label={`Remove ${s.file.name}`} className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-ink/80 text-white">
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => picker.current?.click()} className="flex aspect-[3/4] flex-col items-center justify-center gap-1 border border-dashed border-slate-400 bg-surface text-xs font-bold text-ink hover:bg-white">
          <ImagePlus aria-hidden="true" className="size-6" />
          Add photos
        </button>
        <input ref={picker} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>

      <button type="button" disabled={!staged.length || sending} onClick={() => void parse()} className="vista-button-primary flex min-h-12 w-full items-center justify-center gap-2 disabled:opacity-50">
        <ScanText aria-hidden="true" className="size-5" />
        {sending ? 'Sending…' : staged.length ? `Parse ${staged.length} receipt${staged.length === 1 ? '' : 's'}` : 'Add photos to parse'}
      </button>

      {sent.length ? (
        <ul aria-live="polite" className="border border-line bg-surface px-3">
          {sent.map((s, i) => <Row key={s.id ?? `s${i}`} sent={s} status={s.id ? statuses[s.id] : undefined} onRecorded={() => void refresh()} />)}
        </ul>
      ) : null}
    </div>
  )
}
