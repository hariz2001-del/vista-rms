import { Download, ExternalLink, Minus, Paperclip, Send, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { formatRinggit } from '../domain/money.ts'
import { apiFile, apiRequest, saveFile } from '../lib/http.ts'
import { prepareReceiptPhoto } from '../lib/receipt-photo.ts'

/**
 * Chopper, in the RMS: the same Chopper as on Telegram (Hermes, with its tools
 * and memory) for questions, and the same receipt pipeline for photos. Drop,
 * paste or pick photos; /bulk reads a pile quietly and /endbulk lists them;
 * /stash shows what is waiting. Every photo is in the books as not categorised
 * the moment it is read.
 */

type Message = {
  id: string
  role: 'owner' | 'chopper'
  text: string
  status: 'PENDING' | 'WORKING' | 'ANSWERED' | 'FAILED' | 'DONE'
  kind: 'text' | 'receipt' | 'upload' | 'card' | 'stash' | 'batch'
  batch: string | null
  receiptKey: string | null
  file: { name: string; mime: string } | null
  createdAt: string
}
type ReceiptState = { state: string; vendor: string | null; date: string | null; totalSen: number | null; problem: string | null; warning: string | null; recorded: boolean; duplicate: boolean }
type PhotoStatus = Message & { receipt: ReceiptState | null }

const chat = {
  load: (after?: string) => apiRequest<{ messages: Message[]; open: Message[] }>('GET', `/rms/chopper/chat${after ? `?after=${after}` : ''}`),
  send: (text: string, batch?: string | null) => apiRequest<{ messages: Message[]; batch?: string | null }>('POST', '/rms/chopper/chat', { text, ...(batch ? { batch } : {}) }),
  photo: (body: { name: string; mime: string; base64: string; source: 'chat' | 'expenses'; batch?: string }) => apiRequest<Message>('POST', '/rms/chopper/receipts', body),
  photos: (query: string) => apiRequest<{ receipts: PhotoStatus[] }>('GET', `/rms/chopper/receipts?${query}`),
  stash: () => apiRequest<{ receipts: Array<{ receiptKey: string } & Partial<ReceiptState>> }>('GET', '/rms/chopper/stash-list'),
}
export { chat as chopperChatApi }

const SEEN_KEY = 'vista.chopper.seen'
const BULK_KEY = 'vista.chopper.bulk'
const time = (iso: string) =>
  new Intl.DateTimeFormat('en-MY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(iso))
const read = (r: ReceiptState | null | undefined) => Boolean(r && r.state !== 'PROCESSING' && r.state !== 'RECEIVING')

/** Links in Chopper's text, clickable; everything else as written. */
function Text({ value }: { value: string }) {
  const parts = value.split(/(https?:\/\/[^\s)]+)/g)
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a key={index} href={part} target="_blank" rel="noreferrer" className="break-all underline">{part}</a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  )
}

/** A file in a message: an image shown, anything else as a download. */
function FileChip({ message, localUrl }: { message: Message; localUrl?: string }) {
  const [preview, setPreview] = useState<string | null>(localUrl ?? null)
  const [busy, setBusy] = useState(false)
  const image = message.file?.mime.startsWith('image/')
  useEffect(() => {
    if (!image || localUrl) return
    let url: string | null = null
    apiFile(`/rms/chopper/chat/${message.id}/file`).then((file) => { url = URL.createObjectURL(file); setPreview(url) }).catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [image, message.id, localUrl])
  if (!message.file) return null
  if (image && message.kind === 'receipt') {
    return preview ? <img src={preview} alt="Receipt photo" className="max-h-56 w-full rounded-lg object-cover object-top" /> : <div className="h-32 w-40 animate-pulse rounded-lg bg-white/20" />
  }
  async function download() {
    setBusy(true)
    try { saveFile(await apiFile(`/rms/chopper/chat/${message.id}/file`)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-2">
      {preview ? <img src={preview} alt={message.file.name} className="mb-1 max-h-60 w-full rounded-lg border border-line bg-white object-contain" /> : null}
      <button type="button" onClick={() => void download()} className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-line bg-white px-3 text-left text-sm font-bold text-ink hover:bg-canvas">
        <Download aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{message.file.name}</span>
        {busy ? <span className="text-xs text-muted">…</span> : null}
      </button>
    </div>
  )
}

function PhotoState({ status, receipt }: { status: Message['status']; receipt: ReceiptState | null | undefined }) {
  const label = status === 'FAILED' ? 'Not taken in — send it again'
    : status === 'PENDING' ? 'Sent'
    : !receipt || !read(receipt) ? 'Reading…'
    : receipt.problem ? 'Needs a look'
    : receipt.duplicate ? 'Looks like a duplicate'
    : `✓ ${receipt.vendor ?? 'Read'}${receipt.totalSen ? ` · ${formatRinggit(receipt.totalSen)}` : ''}`
  return <p className="mt-1 text-xs font-bold text-white/85">{label}</p>
}

/** One receipt as a row in a /stash or /endbulk list. */
function ReceiptRow({ receiptKey, receipt, onOpen }: { receiptKey: string; receipt: Partial<ReceiptState> | null | undefined; onOpen: (key: string) => void }) {
  const ready = receipt && read(receipt as ReceiptState)
  return (
    <li>
      <button type="button" onClick={() => onOpen(receiptKey)} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-left text-sm hover:bg-white">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{ready ? (receipt?.vendor ?? 'Receipt') : 'Reading…'}</span>
          <span className="block text-xs text-muted">{receiptKey}{receipt?.problem || receipt?.duplicate ? ' · check' : ''}</span>
        </span>
        {ready && receipt?.totalSen ? <span className="tabular font-bold">{formatRinggit(receipt.totalSen)}</span> : null}
        <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-muted" />
      </button>
    </li>
  )
}

function StashCard({ onOpen }: { onOpen: (key: string) => void }) {
  const [rows, setRows] = useState<Array<{ receiptKey: string } & Partial<ReceiptState>> | null>(null)
  useEffect(() => { chat.stash().then((r) => setRows(r.receipts)).catch(() => setRows([])) }, [])
  if (!rows) return <p className="mt-1 text-xs text-muted">Loading…</p>
  return <ul className="mt-2 space-y-1">{rows.map((r) => <ReceiptRow key={r.receiptKey} receiptKey={r.receiptKey} receipt={r} onOpen={onOpen} />)}</ul>
}

function BatchCard({ batch, onOpen }: { batch: string; onOpen: (key: string) => void }) {
  const [rows, setRows] = useState<PhotoStatus[] | null>(null)
  useEffect(() => {
    let live = true
    const load = () => chat.photos(`batch=${batch}`).then((r) => { if (live) setRows(r.receipts) }).catch(() => {})
    void load()
    const timer = window.setInterval(load, 4000)
    return () => { live = false; window.clearInterval(timer) }
  }, [batch])
  if (!rows) return <p className="mt-1 text-xs text-muted">Loading…</p>
  return (
    <ul className="mt-2 space-y-1">
      {rows.map((r) => r.receiptKey
        ? <ReceiptRow key={r.id} receiptKey={r.receiptKey} receipt={r.receipt} onOpen={onOpen} />
        : <li key={r.id} className="rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs text-muted">{r.status === 'FAILED' ? 'A photo could not be taken in.' : 'Taking a photo in…'}</li>)}
    </ul>
  )
}

export function ChopperChat({ onOpenReceipt }: { onOpenReceipt: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [photoStates, setPhotoStates] = useState<Record<string, ReceiptState | null>>({})
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({})
  const [waiting, setWaiting] = useState(false)
  const [sending, setSending] = useState(0)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')
  const [unread, setUnread] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [bulk, setBulk] = useState<string | null>(() => { try { return sessionStorage.getItem(BULK_KEY) } catch { return null } })
  const last = useRef<string | undefined>(undefined)
  const list = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => { try { if (bulk) sessionStorage.setItem(BULK_KEY, bulk); else sessionStorage.removeItem(BULK_KEY) } catch { /* private window */ } }, [bulk])

  const merge = useCallback((incoming: Message[], openOnes: Message[] | null) => {
    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.id, m]))
      for (const m of incoming) byId.set(m.id, m)
      if (openOnes) {
        for (const m of openOnes) byId.set(m.id, m)
        for (const m of byId.values()) {
          if (m.role === 'owner' && m.kind === 'text' && (m.status === 'PENDING' || m.status === 'WORKING') && !openOnes.some((o) => o.id === m.id)) {
            byId.set(m.id, { ...m, status: 'ANSWERED' })
          }
        }
      }
      return [...byId.values()].toSorted((a, b) => Number(BigInt(a.id) - BigInt(b.id)))
    })
    if (incoming.length) last.current = incoming[incoming.length - 1]!.id
    if (openOnes) setWaiting(openOnes.some((m) => m.kind === 'text'))
    const newest = incoming.findLast((m) => m.role === 'chopper')
    if (newest) {
      let seen = '0'
      try { seen = localStorage.getItem(SEEN_KEY) ?? '0' } catch { /* private window */ }
      if (BigInt(newest.id) > BigInt(seen)) setUnread(true)
    }
  }, [])

  // Photos still being taken in or read: their status, until each is read.
  const unreadPhotos = messages.filter((m) => m.kind === 'receipt' && m.status !== 'FAILED' && !read(photoStates[m.id] ?? null))
  const photoIds = unreadPhotos.map((m) => m.id).slice(-50).join(',')
  const refreshPhotos = useCallback(async () => {
    if (!photoIds) return
    try {
      const result = await chat.photos(`ids=${photoIds}`)
      setPhotoStates((s) => ({ ...s, ...Object.fromEntries(result.receipts.map((r) => [r.id, r.receipt])) }))
      setMessages((current) => current.map((m) => { const r = result.receipts.find((x) => x.id === m.id); return r ? { ...m, status: r.status, receiptKey: r.receiptKey } : m }))
    } catch { /* next tick */ }
  }, [photoIds])

  const poll = useCallback(async () => {
    try {
      const result = await chat.load(last.current)
      merge(result.messages, result.open)
      setProblem('')
    } catch { /* quietly retried */ }
    await refreshPhotos()
  }, [merge, refreshPhotos])

  // Fast while Chopper is working on something, slow otherwise.
  const busy = waiting || sending > 0 || unreadPhotos.length > 0
  useEffect(() => {
    void poll()
    const timer = window.setInterval(() => void poll(), busy ? 2000 : open ? 8000 : 30000)
    return () => window.clearInterval(timer)
  }, [poll, busy, open])

  useEffect(() => {
    if (!open) return
    setUnread(false)
    const newest = messages.findLast((m) => m.role === 'chopper')
    if (newest) try { localStorage.setItem(SEEN_KEY, newest.id) } catch { /* private window */ }
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [open, messages])

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setProblem('')
    try {
      const result = await chat.send(text, text.toLowerCase().startsWith('/endbulk') ? bulk : null)
      merge(result.messages, null)
      if (result.batch !== undefined) setBulk(result.batch)
      if (result.messages.some((m) => m.role === 'owner' && m.status === 'PENDING')) setWaiting(true)
    } catch (reason) {
      setDraft(text)
      setProblem(reason instanceof Error ? reason.message : 'Not sent. Try again.')
    }
  }

  async function command(text: string) {
    setDraft(text)
    try {
      const result = await chat.send(text, text === '/endbulk' ? bulk : null)
      merge(result.messages, null)
      if (result.batch !== undefined) setBulk(result.batch)
      setDraft('')
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : 'Not sent. Try again.')
    }
  }

  async function sendPhotos(files: File[]) {
    const photos = files.filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (!photos.length) return
    setProblem('')
    setSending((n) => n + photos.length)
    // A few at a time: quick, without choking a phone's connection.
    let next = 0
    const worker = async () => {
      while (next < photos.length) {
        const file = photos[next++]!
        try {
          const ready = await prepareReceiptPhoto(file)
          const sent = await chat.photo({ ...ready, source: 'chat', ...(bulk ? { batch: bulk } : {}) })
          setLocalUrls((u) => ({ ...u, [sent.id]: ready.previewUrl }))
          merge([sent], null)
        } catch (reason) {
          setProblem(reason instanceof Error ? reason.message : 'A photo could not be sent.')
        } finally {
          setSending((n) => n - 1)
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }
  function onPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData.files)
    if (files.length) { event.preventDefault(); void sendPhotos(files) }
  }
  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void sendPhotos(Array.from(event.dataTransfer.files))
  }
  const openReceipt = (key: string) => { setOpen(false); onOpenReceipt(key) }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread ? 'Open chat with Chopper — new answer' : 'Open chat with Chopper'}
        className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-[44] size-14 rounded-full shadow-[0_8px_24px_rgba(23,58,51,0.35)] transition-transform hover:scale-105 lg:bottom-6 lg:right-6"
      >
        <img src="/chopper.jpg" alt="" className="size-14 rounded-full border-2 border-white object-cover" />
        {unread ? <span className="absolute right-0 top-0 size-3.5 rounded-full border-2 border-white bg-green-500" /> : null}
        {busy ? <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-ink px-1.5 text-[0.6rem] font-bold text-white">…</span> : null}
      </button>
    )
  }

  const chip = 'min-h-8 rounded-full border border-line bg-white px-3 text-xs font-bold text-ink hover:bg-canvas'
  return (
    <section
      aria-label="Chat with Chopper"
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
      className="fixed inset-x-0 bottom-0 top-0 z-[46] flex flex-col bg-surface shadow-2xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(42rem,calc(100dvh-3rem))] sm:w-[26rem] sm:rounded-2xl sm:border sm:border-line"
    >
      <header className="flex items-center gap-3 bg-rail px-4 py-3 text-white sm:rounded-t-2xl">
        <img src="/chopper.jpg" alt="" className="size-10 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-tight">Chopper</p>
          <p className="text-xs text-white/70">{sending ? `Sending ${sending} photo${sending === 1 ? '' : 's'}…` : waiting ? 'Thinking…' : 'Same Chopper as on Telegram'}</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Minimise chat" className="grid size-11 place-items-center rounded-lg hover:bg-white/10">
          <Minus aria-hidden="true" className="size-5" />
        </button>
      </header>

      {bulk ? (
        <div className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-xs font-bold text-amber-900">
          <span className="flex-1">Bulk on — drop or pick photos; I read them quietly.</span>
          <button type="button" onClick={() => void command('/endbulk')} className="rounded-full bg-amber-900 px-3 py-1 text-white">End bulk</button>
        </div>
      ) : null}

      <div ref={list} className="relative flex-1 space-y-2 overflow-y-auto bg-canvas px-3 py-3" aria-live="polite">
        {dragging ? <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-ink bg-white/80 text-sm font-bold">Drop receipt photos to send them</div> : null}
        {messages.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted">
            <p className="font-bold text-ink">Send receipts, or ask anything about the books.</p>
            <p className="mt-1">Drop photos here, paste them, or tap the paperclip. “How were sales yesterday?” · “Send me this week’s roster.”</p>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'owner' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'chopper' ? <img src="/chopper.jpg" alt="" className="mr-1.5 mt-auto size-6 shrink-0 rounded-full" /> : null}
            <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${m.role === 'owner' ? (m.kind === 'receipt' ? 'w-44 rounded-br-md bg-ink p-1.5 text-white' : 'rounded-br-md bg-ink text-white') : 'rounded-bl-md bg-white text-ink'}`}>
              {m.kind === 'receipt' ? (
                <>
                  <FileChip message={m} localUrl={localUrls[m.id]} />
                  <div className="px-1">
                    <PhotoState status={m.status} receipt={photoStates[m.id]} />
                    {m.batch ? <p className="text-[0.65rem] text-white/60">in bulk</p> : null}
                  </div>
                </>
              ) : (
                <>
                  {m.text ? <p className="whitespace-pre-wrap break-words"><Text value={m.text} /></p> : null}
                  {m.file ? <FileChip message={m} /> : null}
                  {m.kind === 'card' && m.receiptKey ? (
                    <button type="button" onClick={() => openReceipt(m.receiptKey!)} className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-bold text-white">
                      Open in Stash <ExternalLink aria-hidden="true" className="size-4" />
                    </button>
                  ) : null}
                  {m.kind === 'stash' ? <StashCard onOpen={openReceipt} /> : null}
                  {m.kind === 'batch' && m.batch ? <BatchCard batch={m.batch} onOpen={openReceipt} /> : null}
                </>
              )}
              <p className={`mt-1 text-right text-[0.65rem] ${m.role === 'owner' ? 'text-white/60' : 'text-muted'}`}>
                {time(m.createdAt)}
                {m.role === 'owner' && m.kind === 'text' && m.status === 'FAILED' ? ' · not answered' : ''}
              </p>
            </div>
          </div>
        ))}
        {waiting ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm text-muted shadow-sm">Chopper is working on it…</div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-line bg-surface px-3 pt-2">
        {bulk ? <button type="button" className={chip} onClick={() => void command('/endbulk')}>/endbulk</button> : <button type="button" className={chip} onClick={() => void command('/bulk')}>/bulk</button>}
        <button type="button" className={chip} onClick={() => void command('/stash')}>/stash</button>
      </div>
      <form onSubmit={(e) => void send(e)} className="flex items-end gap-2 bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:rounded-b-2xl">
        <input ref={picker} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { void sendPhotos(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <button type="button" onClick={() => picker.current?.click()} aria-label="Send receipt photos" className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-white text-ink hover:bg-canvas">
          <Paperclip aria-hidden="true" className="size-5" />
        </button>
        <label className="sr-only" htmlFor="chopper-draft">Message to Chopper</label>
        <textarea
          id="chopper-draft"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          placeholder={bulk ? 'Bulk on — send photos' : 'Message Chopper'}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-ink"
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e35f27] text-white disabled:opacity-40">
          <Send aria-hidden="true" className="size-5" />
        </button>
      </form>
      {problem ? (
        <p role="alert" className="flex items-center gap-2 bg-surface px-3 pb-2 text-xs font-bold text-serious">
          <span className="flex-1">{problem}</span>
          <button type="button" onClick={() => setProblem('')} aria-label="Dismiss"><X aria-hidden="true" className="size-3.5" /></button>
        </p>
      ) : null}
    </section>
  )
}
