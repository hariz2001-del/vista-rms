import { Minus, Plus, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatRinggit } from '../domain/money.ts'
import { apiRequest } from '../lib/http.ts'

type TicketLine = { line: number; product_name: string; quantity: number; modifiers: string[]; net_sen: number }
type Ticket = { order_id: string; queue_number: string; locked: boolean; lines: TicketLine[] }

/** What `count` of a line refunds: its share of what was actually charged, as the server works it out. */
export function lineRefundSen(line: Pick<TicketLine, 'quantity' | 'net_sen'>, count: number): number {
  if (count <= 0) return 0
  if (count >= line.quantity) return line.net_sen
  return line.net_sen - Math.round((line.net_sen * (line.quantity - count)) / line.quantity)
}

/**
 * The owner's fix for a paid sale: refund some items, or the whole sale, after
 * the fact — e.g. a refund given at the counter that was never keyed in. It is
 * recorded as a correction beside the sale, never by editing the sale itself,
 * and a closed shift's total moves with it.
 */
export function SaleFix({ orderId, onDone, onClose }: { orderId: string; onDone: (message: string) => void; onClose: () => void }) {
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // One fix, one ID: a double click or a retry after a dropped connection can't refund twice.
  const fixId = useRef(crypto.randomUUID())

  useEffect(() => {
    let live = true
    apiRequest<Ticket>('GET', `/rms/orders/${orderId}/ticket`)
      .then((result) => { if (live) setTicket(result) })
      .catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : 'Could not load the sale.') })
    return () => { live = false }
  }, [orderId])

  const lines = ticket?.lines ?? []
  const refundSen = lines.reduce((sum, line) => sum + lineRefundSen(line, counts[line.line] ?? 0), 0)
  const everything = lines.length > 0 && lines.every((line) => (counts[line.line] ?? 0) === line.quantity)
  const set = (line: TicketLine, count: number) =>
    setCounts((current) => ({ ...current, [line.line]: Math.max(0, Math.min(line.quantity, count)) }))

  async function save() {
    setSaving(true)
    setError('')
    try {
      await apiRequest('POST', `/rms/orders/${orderId}/corrections`, {
        client_txn_id: fixId.current,
        reason: reason.trim(),
        expected_refund_sen: refundSen,
        cancel: everything,
        refunds: everything ? [] : lines.flatMap((line) => ((counts[line.line] ?? 0) > 0 ? [{ line: line.line, quantity: counts[line.line] }] : [])),
      })
      onDone(everything ? `Sale ${ticket?.queue_number} cancelled · ${formatRinggit(refundSen)} refunded` : `${formatRinggit(refundSen)} refunded on sale ${ticket?.queue_number}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The fix was not saved.')
      // The amount may have changed under us: a fresh attempt gets a fresh ID.
      fixId.current = crypto.randomUUID()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Fix this sale" className="mt-4 border border-line bg-canvas p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">Fix this sale</h3>
          <p className="text-xs text-muted">Choose what was refunded. It's recorded beside the sale, and the shift's total updates.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 shrink-0 place-items-center">
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      {!ticket && !error ? <p className="py-3 text-sm text-muted">Loading the sale…</p> : null}
      {ticket?.locked ? <p className="py-2 text-sm font-bold text-serious">This sale is in a month that's already settled, so it can't be changed.</p> : null}
      {ticket && !ticket.locked && lines.length === 0 ? <p className="py-2 text-sm text-muted">Nothing left on this sale to refund.</p> : null}

      {ticket && !ticket.locked && lines.length > 0 ? (
        <>
          <ul className="divide-y divide-line border-y border-line">
            {lines.map((line) => {
              const count = counts[line.line] ?? 0
              return (
                <li key={line.line} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-bold">{line.quantity}× {line.product_name}</span>
                    {line.modifiers.length ? <span className="block text-xs text-muted">{line.modifiers.join(', ')}</span> : null}
                    <span className="block text-xs text-muted">{formatRinggit(line.net_sen)} charged</span>
                  </span>
                  <span className="flex items-center gap-1" aria-label={`Refund how many ${line.product_name}`}>
                    <button type="button" onClick={() => set(line, count - 1)} disabled={count === 0} aria-label={`One fewer ${line.product_name}`} className="grid size-10 place-items-center border border-line bg-surface disabled:opacity-30">
                      <Minus aria-hidden="true" className="size-4" />
                    </button>
                    <span className="w-14 text-center font-mono text-sm font-bold tabular">{count} of {line.quantity}</span>
                    <button type="button" onClick={() => set(line, count + 1)} disabled={count === line.quantity} aria-label={`One more ${line.product_name}`} className="grid size-10 place-items-center border border-line bg-surface disabled:opacity-30">
                      <Plus aria-hidden="true" className="size-4" />
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => setCounts(Object.fromEntries(lines.map((line) => [line.line, everything ? 0 : line.quantity])))}
            className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-xs font-bold underline"
          >
            <Undo2 aria-hidden="true" className="size-3.5" />
            {everything ? 'Clear' : 'Refund everything (cancel the sale)'}
          </button>

          <label className="mt-3 block text-sm font-bold">
            Why
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={240}
              placeholder="e.g. Customer refunded 3 items, only 2 were keyed in"
              className="mt-1 block min-h-11 w-full border border-line bg-surface px-3 text-sm font-normal"
            />
          </label>

          {error ? <p role="alert" className="mt-3 text-sm font-bold text-serious">{error}</p> : null}

          <button
            type="button"
            onClick={() => { void save() }}
            disabled={saving || refundSen <= 0 || !reason.trim()}
            className="mt-3 min-h-12 w-full bg-ink px-4 text-sm font-bold text-canvas disabled:opacity-40"
          >
            {saving ? 'Saving…' : refundSen > 0 ? `${everything ? 'Cancel sale and refund' : 'Refund'} ${formatRinggit(refundSen)}` : 'Choose what was refunded'}
          </button>
        </>
      ) : null}
      {error && !ticket ? <p role="alert" className="text-sm font-bold text-serious">{error}</p> : null}
    </section>
  )
}
