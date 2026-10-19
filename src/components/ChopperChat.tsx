import { Download, Minus, Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { apiFile, apiRequest, saveFile } from '../lib/http.ts'

/**
 * Chopper, in the RMS. The same Chopper as on Telegram (Hermes, with all its
 * tools and memory), in one ongoing conversation. Messages go through Vista;
 * Chopper's relay on its own server picks them up and answers, usually in under
 * a minute. A collapsed bubble shows a dot when an answer arrives.
 */

type Message = {
  id: string
  role: 'owner' | 'chopper'
  text: string
  status: 'PENDING' | 'WORKING' | 'ANSWERED' | 'FAILED' | 'DONE'
  file: { name: string; mime: string } | null
  createdAt: string
}

const chat = {
  load: (after?: string) => apiRequest<{ messages: Message[]; open: Message[] }>('GET', `/rms/chopper/chat${after ? `?after=${after}` : ''}`),
  send: (text: string) => apiRequest<Message>('POST', '/rms/chopper/chat', { text }),
}

const SEEN_KEY = 'vista.chopper.seen'
const time = (iso: string) =>
  new Intl.DateTimeFormat('en-MY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(iso))

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

function FileChip({ message }: { message: Message }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const image = message.file?.mime.startsWith('image/')
  useEffect(() => {
    if (!image) return
    let url: string | null = null
    apiFile(`/rms/chopper/chat/${message.id}/file`).then((file) => { url = URL.createObjectURL(file); setPreview(url) }).catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [image, message.id])
  if (!message.file) return null
  async function download() {
    setBusy(true)
    try { saveFile(await apiFile(`/rms/chopper/chat/${message.id}/file`)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-2">
      {preview ? <img src={preview} alt={message.file.name} className="mb-1 max-h-60 w-full rounded-lg border border-line object-contain bg-white" /> : null}
      <button type="button" onClick={() => void download()} className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-line bg-white px-3 text-left text-sm font-bold text-ink hover:bg-canvas">
        <Download aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{message.file.name}</span>
        {busy ? <span className="text-xs text-muted">…</span> : null}
      </button>
    </div>
  )
}

export function ChopperChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [waiting, setWaiting] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')
  const [unread, setUnread] = useState(false)
  const last = useRef<string | undefined>(undefined)
  const list = useRef<HTMLDivElement>(null)

  const merge = useCallback((incoming: Message[], openOnes: Message[]) => {
    setMessages((current) => {
      const byId = new Map(current.map((m) => [m.id, m]))
      for (const m of [...incoming, ...openOnes]) byId.set(m.id, m)
      // Anything no longer open has been answered (or failed); its new status comes with its reply.
      for (const m of byId.values()) {
        if (m.role === 'owner' && (m.status === 'PENDING' || m.status === 'WORKING') && !openOnes.some((o) => o.id === m.id)) {
          byId.set(m.id, { ...m, status: 'ANSWERED' })
        }
      }
      return [...byId.values()].toSorted((a, b) => Number(BigInt(a.id) - BigInt(b.id)))
    })
    if (incoming.length) last.current = incoming[incoming.length - 1]!.id
    setWaiting(openOnes.length > 0)
    const newest = incoming.findLast((m) => m.role === 'chopper')
    if (newest) {
      let seen = '0'
      try { seen = localStorage.getItem(SEEN_KEY) ?? '0' } catch { /* private window */ }
      if (BigInt(newest.id) > BigInt(seen)) setUnread(true)
    }
  }, [])

  const poll = useCallback(async () => {
    try {
      const result = await chat.load(last.current)
      merge(result.messages, result.open)
      setProblem('')
    } catch {
      // Quietly retried on the next tick; the owner sees the last state meanwhile.
    }
  }, [merge])

  // Fast while Chopper is working on something, slow otherwise.
  useEffect(() => {
    void poll()
    const timer = window.setInterval(() => void poll(), waiting ? 2500 : open ? 8000 : 30000)
    return () => window.clearInterval(timer)
  }, [poll, waiting, open])

  // Opening the chat reads everything.
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
      const sent = await chat.send(text)
      merge([sent], [sent])
      setWaiting(true)
    } catch (reason) {
      setDraft(text)
      setProblem(reason instanceof Error ? reason.message : 'Not sent. Try again.')
    }
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread ? 'Open chat with Chopper — new answer' : 'Open chat with Chopper'}
        className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-[44] grid size-14 place-items-center rounded-full bg-[#e35f27] text-2xl text-white shadow-[0_8px_24px_rgba(227,95,39,0.45)] transition-transform hover:scale-105 lg:bottom-6 lg:right-6"
      >
        <span aria-hidden="true">🧾</span>
        {unread ? <span className="absolute right-1 top-1 size-3.5 rounded-full border-2 border-white bg-green-500" /> : null}
        {waiting ? <span className="absolute -bottom-1 rounded-full bg-ink px-1.5 text-[0.6rem] font-bold">…</span> : null}
      </button>
    )
  }

  return (
    <section
      aria-label="Chat with Chopper"
      className="fixed inset-x-0 bottom-0 top-0 z-[46] flex flex-col bg-surface shadow-2xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(40rem,calc(100dvh-3rem))] sm:w-[25rem] sm:rounded-2xl sm:border sm:border-line"
    >
      <header className="flex items-center gap-3 bg-rail px-4 py-3 text-white sm:rounded-t-2xl">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-[#e35f27] text-xl">🧾</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-tight">Chopper</p>
          <p className="text-xs text-white/70">{waiting ? 'Thinking…' : 'Same Chopper as on Telegram'}</p>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Minimise chat" className="grid size-11 place-items-center rounded-lg hover:bg-white/10">
          <Minus aria-hidden="true" className="size-5" />
        </button>
      </header>

      <div ref={list} className="flex-1 space-y-2 overflow-y-auto bg-canvas px-3 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted">
            <p className="font-bold text-ink">Ask Chopper anything about the books.</p>
            <p className="mt-1">“How were sales yesterday?” · “What’s still in the stash?” · “Send me this week’s roster.”</p>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'owner' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${m.role === 'owner' ? 'rounded-br-md bg-ink text-white' : 'rounded-bl-md bg-white text-ink'}`}>
              {m.text ? <p className="whitespace-pre-wrap break-words"><Text value={m.text} /></p> : null}
              {m.file ? <FileChip message={m} /> : null}
              <p className={`mt-1 text-right text-[0.65rem] ${m.role === 'owner' ? 'text-white/60' : 'text-muted'}`}>
                {time(m.createdAt)}
                {m.role === 'owner' && m.status === 'FAILED' ? ' · not answered' : ''}
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

      <form onSubmit={(e) => void send(e)} className="flex items-end gap-2 border-t border-line bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:rounded-b-2xl">
        <label className="sr-only" htmlFor="chopper-draft">Message to Chopper</label>
        <textarea
          id="chopper-draft"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Message Chopper"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-ink"
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e35f27] text-white disabled:opacity-40">
          <Send aria-hidden="true" className="size-5" />
        </button>
      </form>
      {problem ? <p role="alert" className="bg-surface px-3 pb-2 text-xs font-bold text-serious">{problem}</p> : null}
    </section>
  )
}
