import { toPng } from 'html-to-image'
import { Download, Printer, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { dateTimeText, rosterApi, timeText, type RosterExport } from '../../data/roster-api.ts'
import { errorText, useLoad } from '../../data/team-api.ts'

/**
 * The roster as it is shared: days, times and names, and when it was last
 * changed. Built only from the export route, which carries nothing else — no
 * ratings, notes, scores or pay can end up in a WhatsApp group by accident.
 */
function RosterCard({ roster }: { roster: RosterExport }) {
  return (
    <div className="roster-card w-[1080px] bg-white p-12 text-[#18211d]" style={{ fontFamily: 'Segoe UI, Inter, system-ui, sans-serif' }}>
      <div className="flex items-end justify-between border-b-4 border-[#173a33] pb-5">
        <div>
          <p className="text-2xl font-bold uppercase tracking-[0.12em] text-[#667169]">{roster.businessName}</p>
          <h1 className="mt-1 text-6xl font-black">Roster · {roster.label}</h1>
        </div>
        {roster.isPublished ? null : <p className="bg-amber-100 px-4 py-2 text-2xl font-black text-amber-800">DRAFT</p>}
      </div>
      <div className="mt-6 space-y-4">
        {roster.days.map((day) => (
          <section key={day.date} className="grid grid-cols-[19rem_1fr] gap-6 border-b border-[#d9d5c9] pb-4 last:border-b-0">
            <h2 className="text-3xl font-black">{day.label}</h2>
            {day.shifts.length === 0 ? (
              <p className="text-2xl text-[#667169]">No shifts</p>
            ) : (
              <ul className="space-y-2">
                {day.shifts.map((shift, index) => (
                  <li key={index} className="flex gap-6 text-3xl">
                    <span className="w-72 shrink-0 font-bold tabular-nums">
                      {timeText(shift.startTime)}–{timeText(shift.endTime)}
                    </span>
                    <span className={shift.staff.length === 0 ? 'font-bold text-[#c2410c]' : ''}>
                      {shift.staff.length === 0 ? 'Not filled yet' : shift.staff.join(', ')}
                      {shift.label ? <span className="text-[#667169]"> · {shift.label}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <p className="mt-8 text-2xl font-bold text-[#667169]">Last updated: {dateTimeText(roster.updatedAt)}</p>
    </div>
  )
}

export function RosterShare({ weekId, onClose }: { weekId: string; onClose: () => void }) {
  const { data, error } = useLoad(() => rosterApi.exportWeek(weekId))
  const card = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function downloadImage() {
    if (!card.current || !data) return
    setBusy(true)
    setProblem(null)
    try {
      const url = await toPng(card.current, { pixelRatio: 1, backgroundColor: '#ffffff' })
      const link = document.createElement('a')
      link.href = url
      link.download = `roster-${data.weekStart}.png`
      link.click()
    } catch (caught) {
      setProblem(errorText(caught, 'The image could not be made. Try printing instead.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="share-title" className="fixed inset-0 z-50 overflow-y-auto bg-ink/60 p-4">
      <div className="mx-auto max-w-3xl space-y-3 bg-surface p-4 shadow-xl print:max-w-none print:bg-white print:p-0 print:shadow-none">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <h2 id="share-title" className="font-display text-lg font-bold">
            Export roster
          </h2>
          <span className="text-xs text-muted">Days, times and names only.</span>
          <div className="ml-auto flex gap-2">
            <button type="button" disabled={!data || busy} onClick={downloadImage} className="vista-button-primary flex min-h-11 items-center gap-2 disabled:opacity-50">
              <Download aria-hidden="true" className="size-4" /> Image for WhatsApp
            </button>
            <button type="button" disabled={!data} onClick={() => window.print()} className="vista-button-secondary flex min-h-11 items-center gap-2 disabled:opacity-50">
              <Printer aria-hidden="true" className="size-4" /> Print / PDF
            </button>
            <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 place-items-center hover:bg-canvas">
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
        {problem ? <p className="text-sm font-bold text-serious print:hidden">{problem}</p> : null}
        {error && !data ? <p className="text-sm font-bold text-serious">{error}</p> : null}
        {data ? (
          <div className="print-area overflow-x-auto border border-line print:overflow-visible print:border-0">
            {/* Zoom, not a transform: a transform leaves the full-size box behind. */}
            <div className="roster-preview">
              <div ref={card}>
                <RosterCard roster={data} />
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </div>
    </div>
  )
}
