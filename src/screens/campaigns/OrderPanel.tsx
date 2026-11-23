import { ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { campaignsApi, type OrderDetail } from '../../data/campaigns-api.ts'
import { errorText } from '../../data/team-api.ts'
import { formatRinggit, parseRinggitToSen } from '../../domain/money.ts'
import { Badge, Money, Panel } from '../../components/primitives.tsx'
import { FLAG_LABEL, VerificationBadge } from './badges.tsx'
import { OrderSets } from './OrderSets.tsx'

const WHEN = new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' })

/**
 * One order: its payment proof beside what was read from it, and the owner's
 * decision. The reader's flags are advice; only the buttons here decide.
 */
export function OrderPanel({
  campaignId,
  orderId,
  onClose,
  onChanged,
}: {
  campaignId: string
  orderId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    setDetail(null)
    campaignsApi
      .order(campaignId, orderId)
      .then((next) => live && (setDetail(next), setError(null)))
      .catch((caught) => live && setError(errorText(caught, 'Could not open the order.')))
    return () => {
      live = false
    }
  }, [campaignId, orderId, tick])

  const reload = () => {
    setTick((value) => value + 1)
    onChanged()
  }

  return (
    <Panel className="self-start xl:sticky xl:top-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="page-kicker">Order</p>
          <h2 className="font-mono text-lg font-black">{detail?.order.externalRef ?? '…'}</h2>
        </div>
        <button type="button" className="vista-button-secondary" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {error ? <p className="text-sm font-semibold text-critical">{error}</p> : null}
      {!detail && !error ? <p className="text-sm text-muted">Loading…</p> : null}
      {detail ? <OrderBody campaignId={campaignId} detail={detail} onChanged={reload} /> : null}
    </Panel>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 border-b border-line/50 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-semibold">{children}</dd>
    </div>
  )
}

function OrderBody({ campaignId, detail, onChanged }: { campaignId: string; detail: OrderDetail; onChanged: () => void }) {
  const { order } = detail
  const proof = order.proof
  const extraction = proof?.extraction ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <VerificationBadge order={order} />
        {order.posted ? <Badge tone="info">In the books</Badge> : null}
        {order.coupons.some((coupon) => coupon.redeemedAt) ? <Badge>Coupon used</Badge> : null}
      </div>

      {order.sheetSaysPaid ? (
        <p className="border border-warning bg-amber-50 p-2 text-sm">
          <strong>The sheet says “{order.sourceStatus}”, but this payment isn’t verified in Vista.</strong> Its coupons won’t work at the till until you verify it
          below, which also books the revenue on the day it was paid.
        </p>
      ) : null}

      {proof?.hasFile ? <ProofViewer campaignId={campaignId} orderId={order.id} /> : <p className="border border-dashed border-critical p-3 text-sm font-semibold text-critical">No payment proof was uploaded with this order.</p>}

      {proof ? (
        <section>
          <h3 className="vista-field-label">Payment check</h3>
          {proof.readStatus === 'PENDING' || proof.readStatus === 'READING' ? (
            <p className="text-sm text-muted">Chopper is reading this proof.</p>
          ) : null}
          {proof.flags.length ? (
            <div className={`mt-1 border p-2 text-sm ${proof.openFlags.length ? 'border-warning bg-amber-50' : 'border-line bg-[#f6f3ec]'}`}>
              <div className="mb-1 flex flex-wrap gap-1">
                {proof.flags.map((flag) => (
                  <Badge key={flag} tone={flag === 'PASSED' ? 'good' : proof.openFlags.length ? 'warning' : 'neutral'}>
                    {FLAG_LABEL[flag]}
                  </Badge>
                ))}
              </div>
              {proof.summary ? <p>{proof.summary}</p> : null}
              {proof.dismissedAt ? <p className="mt-1 text-xs text-muted">Flags cleared {WHEN.format(new Date(proof.dismissedAt))}.</p> : null}
              <p className="mt-1 text-xs text-muted">A first look only. It does not prove the money reached the bank — check your account.</p>
            </div>
          ) : null}
          {extraction ? (
            <dl className="mt-2">
              <Row label="Bank / app">{extraction.provider ?? '—'}</Row>
              <Row label="Paid on">{[extraction.date, extraction.time].filter(Boolean).join(' ') || '—'}</Row>
              <Row label="Amount">{extraction.amountSen === null ? '—' : <Money sen={extraction.amountSen} />}</Row>
              <Row label="Reference">{extraction.reference ?? '—'}</Row>
              <Row label="To">{extraction.recipient ?? '—'}</Row>
              {extraction.status ? <Row label="Status">{extraction.status}</Row> : null}
            </dl>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 className="vista-field-label">Customer and order</h3>
        <dl>
          <Row label="Name">{order.customerName}</Row>
          <Row label="Contact">{order.contact ?? '—'}</Row>
          <Row label="Submitted">{WHEN.format(new Date(order.submittedAt))}</Row>
          <Row label="Should pay">
            <Money sen={order.expectedSen} />
          </Row>
          {Object.entries(order.fulfilment).map(([key, value]) => (
            <Row key={key} label={key}>
              {value}
            </Row>
          ))}
          {order.sourceStatus ? <Row label="Sheet status">{order.sourceStatus}</Row> : null}
        </dl>
      </section>

      <OrderSets campaignId={campaignId} detail={detail} />

      <Decision campaignId={campaignId} detail={detail} onChanged={onChanged} />

      <details>
        <summary className="cursor-pointer text-sm font-bold">Everything the source sent</summary>
        <div className="mt-2 space-y-2">
          {(detail.sourceData.rows ?? []).map((row, index) => (
            <dl key={index} className="border border-line/60 p-2">
              {Object.entries(row).map(([key, value]) => (
                <Row key={key} label={key}>
                  {value}
                </Row>
              ))}
            </dl>
          ))}
        </div>
      </details>

      {detail.history.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-bold">History</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {detail.history.map((entry) => (
              <li key={entry.id}>
                <span className="text-muted">{WHEN.format(new Date(entry.createdAt))}</span> · {entry.actorLabel} · <span className="font-mono">{entry.action}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

/** The proof, fetched with the owner's session and never given a public link. */
function ProofViewer({ campaignId, orderId }: { campaignId: string; orderId: string }) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    let live = true
    let made: string | null = null
    setFile(null)
    setError(null)
    setZoom(1)
    campaignsApi
      .proofFile(campaignId, orderId)
      .then((loaded) => {
        if (!live) return
        made = URL.createObjectURL(loaded)
        setFile({ url: made, type: loaded.type })
      })
      .catch((caught) => live && setError(errorText(caught, 'Could not load the proof.')))
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [campaignId, orderId])

  if (error) return <p className="border border-line p-3 text-sm font-semibold text-critical">{error}</p>
  if (!file) return <div className="grid aspect-[3/4] max-h-[28rem] place-items-center bg-[#1d2420] text-sm text-white/70">Loading proof…</div>
  if (file.type === 'application/pdf') {
    return <iframe title="Payment proof" src={file.url} className="h-[28rem] w-full border border-line" />
  }
  return (
    <div className="relative">
      <div className="scrollbar-subtle max-h-[28rem] overflow-auto bg-[#1d2420]">
        <img src={file.url} alt="Payment proof" style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} className="mx-auto block" />
      </div>
      <div className="absolute right-2 top-2 flex gap-1">
        <button type="button" className="grid place-items-center bg-white/90 p-1.5" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}>
          <ZoomOut size={16} />
        </button>
        <button type="button" className="grid place-items-center bg-white/90 p-1.5" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.5))}>
          <ZoomIn size={16} />
        </button>
        <a href={file.url} target="_blank" rel="noreferrer" className="bg-white/90 p-1.5" aria-label="Open full size">
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  )
}

function Decision({ campaignId, detail, onChanged }: { campaignId: string; detail: OrderDetail; onChanged: () => void }) {
  const { order } = detail
  const extraction = order.proof?.extraction ?? null
  const [paymentDate, setPaymentDate] = useState(order.paymentDate ?? extraction?.date ?? '')
  const [amount, setAmount] = useState(((order.paidSen ?? extraction?.amountSen ?? order.expectedSen) / 100).toFixed(2))
  const [reference, setReference] = useState(order.paymentRef ?? extraction?.reference ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const openFlags = order.proof?.openFlags ?? []

  async function act(work: () => Promise<unknown>) {
    setBusy(true)
    setMessage(null)
    try {
      await work()
      onChanged()
    } catch (caught) {
      setMessage(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  if (order.deletedAt) return <p className="text-sm text-muted">This order is deleted. Restore it from the Deleted view to act on it.</p>

  if (order.verification === 'VERIFIED') {
    return (
      <section className="border border-good/40 bg-green-50 p-3 text-sm">
        <p className="font-bold text-good">
          Verified by {order.decidedByLabel ?? 'the owner'}
          {order.decidedAt ? ` on ${WHEN.format(new Date(order.decidedAt))}` : ''}.
        </p>
        <p className="mt-1">
          <Money sen={order.paidSen ?? order.expectedSen} /> booked as revenue on <strong>{order.paymentDate}</strong>, the day it was paid.
        </p>
        {order.reviewNote ? <p className="mt-1 text-muted">Note: {order.reviewNote}</p> : null}
        <button
          type="button"
          className="vista-button-secondary mt-3"
          disabled={busy}
          onClick={() => {
            const reason = window.prompt('Why undo this verification? A reversing entry is added on the same date.')
            if (reason && reason.trim().length >= 3) void act(() => campaignsApi.unverify(campaignId, order.id, reason.trim()))
          }}
        >
          Undo verification
        </button>
        {message ? <p className="mt-2 font-semibold text-critical">{message}</p> : null}
      </section>
    )
  }

  if (order.verification === 'REJECTED') {
    return (
      <section className="border border-critical/40 bg-red-50 p-3 text-sm">
        <p className="font-bold text-critical">Rejected by {order.decidedByLabel ?? 'the owner'}.</p>
        {order.reviewNote ? <p className="mt-1">Reason: {order.reviewNote}</p> : null}
        <button type="button" className="vista-button-secondary mt-3" disabled={busy} onClick={() => void act(() => campaignsApi.reopen(campaignId, order.id))}>
          Reopen for checking
        </button>
        {message ? <p className="mt-2 font-semibold text-critical">{message}</p> : null}
      </section>
    )
  }

  const paidSen = parseRinggitToSen(amount)
  return (
    <section className="space-y-3 border border-line p-3">
      <h3 className="font-bold">Your decision</h3>
      <p className="text-xs text-muted">
        Verify only once you have seen the money in the account. It is booked as revenue on the date below — the day the customer paid — not today.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          <span className="vista-field-label">Customer paid on</span>
          <input type="date" className="vista-control w-full" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          {!extraction?.date ? <span className="text-xs text-warning">Not read from the proof: enter it yourself.</span> : null}
        </label>
        <label>
          <span className="vista-field-label">Amount received (RM)</span>
          <input className="vista-control tabular w-full" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          {paidSen !== null && paidSen !== order.expectedSen ? <span className="text-xs text-warning">Differs from the {formatRinggit(order.expectedSen)} owed.</span> : null}
        </label>
        <label className="sm:col-span-2">
          <span className="vista-field-label">Transfer reference</span>
          <input className="vista-control w-full" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="vista-field-label">Note (optional)</span>
          <input className="vista-control w-full" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="vista-button-primary"
          disabled={busy || !paymentDate || paidSen === null || paidSen <= 0}
          onClick={() => {
            if (openFlags.length && !window.confirm(`The reader flagged this proof (${openFlags.map((flag) => FLAG_LABEL[flag]).join(', ')}). Verify anyway?`)) return
            void act(() =>
              campaignsApi.verify(campaignId, order.id, { paymentDate, paidSen: paidSen ?? undefined, paymentRef: reference.trim() || null, note: note.trim() || null }),
            )
          }}
        >
          Verify payment
        </button>
        <button type="button" className="vista-button-secondary text-critical" disabled={busy} onClick={() => void act(() => campaignsApi.reject(campaignId, order.id, note.trim() || null))}>
          Reject
        </button>
        {openFlags.length ? (
          <button type="button" className="vista-button-secondary" disabled={busy} onClick={() => void act(() => campaignsApi.dismissFlags(campaignId, order.id))}>
            Clear flags
          </button>
        ) : null}
        {order.proof?.hasFile ? (
          <button type="button" className="vista-button-secondary" disabled={busy} onClick={() => void act(() => campaignsApi.reread(campaignId, order.id))}>
            Read again
          </button>
        ) : null}
      </div>
      {message ? <p className="text-sm font-semibold text-critical">{message}</p> : null}
    </section>
  )
}
