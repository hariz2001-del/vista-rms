import { AlertTriangle, Check, SkipForward } from 'lucide-react'
import { useState } from 'react'
import { Badge, EmptyState, Panel } from '../../components/primitives.tsx'
import { dateTimeText, dayName, rosterApi, timeText, type Coverage } from '../../data/roster-api.ts'
import { errorText, useLoad } from '../../data/team-api.ts'

const OFFER_LABEL: Record<string, { text: string; tone: 'neutral' | 'good' | 'warning' | 'critical' | 'info' }> = {
  PENDING: { text: 'Waiting for reply', tone: 'info' },
  ACCEPTED: { text: 'Accepted in the app', tone: 'good' },
  REJECTED: { text: 'Said no', tone: 'neutral' },
  MANAGER_CONFIRMED: { text: 'Confirmed by manager', tone: 'good' },
  MANAGER_SKIPPED: { text: 'Skipped by manager', tone: 'neutral' },
  SUPERSEDED: { text: 'No longer needed', tone: 'neutral' },
}

function CoverCard({ item, onDone, onError }: { item: Coverage; onDone: () => void; onError: (text: string) => void }) {
  const [choice, setChoice] = useState(item.queue[0]?.staffId ?? '')
  const open = item.status === 'OPEN'
  const pending = item.offers.find((offer) => offer.status === 'PENDING')

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      onDone()
    } catch (caught) {
      onError(errorText(caught))
    }
  }

  return (
    <Panel className={`space-y-3 ${open && item.isUrgent ? 'border-critical bg-red-50/40' : ''}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div>
          <p className="font-display text-lg font-bold">
            {dayName(item.slot.date, 'long')} · {timeText(item.slot.startTime)}–{timeText(item.slot.endTime)}
          </p>
          <p className="text-xs text-muted">
            {item.vacatedBy ? `${item.vacatedBy} ${item.vacatedHow === 'WITHDRAWN' ? 'pulled out' : 'was taken off'}` : 'Seat free'} ·
            opened {dateTimeText(item.createdAt)}
          </p>
        </div>
        <div className="ml-auto flex gap-1">
          {open && item.isUrgent ? (
            <Badge tone="critical" icon={<AlertTriangle aria-hidden="true" className="size-3" />}>
              Urgent cover
            </Badge>
          ) : null}
          <Badge tone={item.status === 'FILLED' ? 'good' : item.status === 'OPEN' ? 'warning' : 'neutral'}>
            {item.status === 'FILLED' ? 'Covered' : item.status === 'OPEN' ? 'Open' : 'Cancelled'}
          </Badge>
        </div>
      </div>

      {item.offers.length > 0 ? (
        <ol className="space-y-1 text-sm">
          {item.offers.map((offer) => (
            <li key={offer.id} className="flex items-center gap-2">
              <span className="w-5 font-mono text-xs text-muted">{offer.rank}.</span>
              <span className="font-bold">{offer.staffName}</span>
              <Badge tone={OFFER_LABEL[offer.status]?.tone ?? 'neutral'}>{OFFER_LABEL[offer.status]?.text ?? offer.status}</Badge>
              {offer.respondedAt ? <span className="text-xs text-muted">{dateTimeText(offer.respondedAt)}</span> : null}
            </li>
          ))}
        </ol>
      ) : open ? (
        <p className="text-sm text-muted">Nobody suitable has been offered it yet.</p>
      ) : null}

      {open ? (
        <>
          <div className="flex flex-wrap gap-2">
            {pending ? (
              <>
                <button type="button" onClick={() => run(() => rosterApi.confirmCover(item.id, pending.staffId))} className="vista-button-primary flex min-h-11 items-center gap-2">
                  <Check aria-hidden="true" className="size-4" /> {pending.staffName} said yes — confirm for them
                </button>
                <button type="button" onClick={() => run(() => rosterApi.skipCover(item.id))} className="vista-button-secondary flex min-h-11 items-center gap-2">
                  <SkipForward aria-hidden="true" className="size-4" /> Skip {pending.staffName}, offer the next
                </button>
              </>
            ) : (
              <button type="button" onClick={() => run(() => rosterApi.offerNext(item.id))} className="vista-button-secondary min-h-11">
                Offer to the next in the queue
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Stop looking for cover for this shift?')) void run(() => rosterApi.cancelCover(item.id))
              }}
              className="min-h-11 border border-line px-3 text-xs font-bold text-muted"
            >
              No cover needed
            </button>
          </div>

          {item.queue.length > 0 ? (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="vista-field-label">Replacement queue — management only</p>
              <ol className="space-y-1 text-sm">
                {item.queue.map((candidate, index) => (
                  <li key={candidate.staffId} className="flex gap-2">
                    <span className="w-5 font-mono text-xs text-muted">{index + 1}.</span>
                    <span>
                      <span className="font-bold">{candidate.staffName}</span>
                      <span className="block text-xs text-muted">{candidate.reason}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="vista-field-label">Someone agreed by phone or WhatsApp?</span>
                  <select value={choice} onChange={(event) => setChoice(event.target.value)} className="vista-control mt-1 px-2">
                    {item.queue.map((candidate) => (
                      <option key={candidate.staffId} value={candidate.staffId}>
                        {candidate.staffName}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" disabled={!choice} onClick={() => run(() => rosterApi.confirmCover(item.id, choice))} className="vista-button-secondary min-h-11 disabled:opacity-50">
                  Confirm on their behalf
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">Nobody else is free for this shift without a clash or going over their limits. You can still add anyone from the Roster tab.</p>
          )}
        </>
      ) : null}
    </Panel>
  )
}

export function CoverTab() {
  const { data, error, reload } = useLoad(() => rosterApi.coverage())
  const [problem, setProblem] = useState<string | null>(null)

  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading cover requests…</p>
  const open = data.coverage.filter((item) => item.status === 'OPEN')
  const recent = data.coverage.filter((item) => item.status !== 'OPEN')

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-muted">
        When someone pulls out of a published shift, it is offered to one person at a time — those who applied
        and were not picked first. Nobody is put on a shift without saying yes. If they tell you directly, confirm
        it for them here; it is recorded as confirmed by you.
      </p>
      {problem ? (
        <p role="alert" className="bg-red-50 p-3 text-sm font-bold text-critical">
          {problem}
        </p>
      ) : null}
      {open.length === 0 ? <EmptyState title="Nothing needs cover" hint="Every published shift has its people." /> : null}
      {open.map((item) => (
        <CoverCard
          key={item.id}
          item={item}
          onDone={() => {
            setProblem(null)
            reload()
          }}
          onError={setProblem}
        />
      ))}
      {recent.length > 0 ? (
        <div className="space-y-3">
          <h3 className="vista-field-label">Last 7 days</h3>
          {recent.map((item) => (
            <CoverCard key={item.id} item={item} onDone={reload} onError={setProblem} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
