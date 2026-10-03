import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Panel } from '../../components/primitives.tsx'
import { dayName, rosterApi, WEEKDAYS, type ClosedPeriod, type OperatingDay, type SlotTemplate } from '../../data/roster-api.ts'
import { errorText, teamApi, useLoad, type WorkType } from '../../data/team-api.ts'

function minutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let total = (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0))
  if (total <= 0) total += 24 * 60
  return total
}

function Hours({ initial }: { initial: OperatingDay[] }) {
  const [days, setDays] = useState<OperatingDay[]>(
    WEEKDAYS.map((_, weekday) => initial.find((day) => day.weekday === weekday) ?? { weekday, isClosed: false, opensAt: '16:00', closesAt: '23:00' }),
  )
  const [message, setMessage] = useState<string | null>(null)
  const set = (weekday: number, change: Partial<OperatingDay>) =>
    setDays((current) => current.map((day) => (day.weekday === weekday ? { ...day, ...change } : day)))

  return (
    <Panel className="space-y-3">
      <h3 className="text-sm font-black uppercase tracking-[0.06em]">Opening hours</h3>
      <ul className="space-y-2">
        {days.map((day) => (
          <li key={day.weekday} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-24 font-bold">{WEEKDAYS[day.weekday]}</span>
            <label className="flex items-center gap-1 text-xs font-bold text-muted">
              <input type="checkbox" checked={day.isClosed} onChange={(event) => set(day.weekday, { isClosed: event.target.checked })} /> Closed
            </label>
            {day.isClosed ? null : (
              <>
                <input type="time" aria-label={`${WEEKDAYS[day.weekday]} opens`} value={day.opensAt} onChange={(event) => set(day.weekday, { opensAt: event.target.value })} className="vista-control px-2" />
                <span className="text-muted">to</span>
                <input type="time" aria-label={`${WEEKDAYS[day.weekday]} closes`} value={day.closesAt} onChange={(event) => set(day.weekday, { closesAt: event.target.value })} className="vista-control px-2" />
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={async () => {
            try {
              await rosterApi.saveHours(days)
              setMessage('Saved.')
            } catch (caught) {
              setMessage(errorText(caught))
            }
          }}
          className="vista-button-primary min-h-11"
        >
          Save hours
        </button>
        {message ? <span className="text-sm font-bold text-muted">{message}</span> : null}
      </div>
    </Panel>
  )
}

function Closed({ initial, onChanged }: { initial: ClosedPeriod[]; onChanged: () => void }) {
  const [startDate, setStart] = useState('')
  const [endDate, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Panel className="space-y-3">
      <h3 className="text-sm font-black uppercase tracking-[0.06em]">Closed dates</h3>
      <p className="text-xs text-muted">No shifts are created on these days when a new roster week is made from the usual week.</p>
      <ul className="space-y-1 text-sm">
        {initial.map((period) => (
          <li key={period.id} className="flex items-center gap-2">
            <span className="font-bold">
              {dayName(period.startDate)}
              {period.endDate !== period.startDate ? ` – ${dayName(period.endDate)}` : ''}
            </span>
            <span className="text-muted">{period.reason}</span>
            <button
              type="button"
              aria-label="Remove"
              onClick={async () => {
                await rosterApi.removeClosed(period.id)
                onChanged()
              }}
              className="ml-auto grid size-8 place-items-center text-muted hover:text-critical"
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <input type="date" aria-label="From" value={startDate} onChange={(event) => setStart(event.target.value)} className="vista-control px-2" />
        <input type="date" aria-label="To" value={endDate} onChange={(event) => setEnd(event.target.value)} className="vista-control px-2" />
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason, e.g. Hari Raya" className="vista-control px-2" />
        <button
          type="button"
          disabled={!startDate}
          onClick={async () => {
            setError(null)
            try {
              await rosterApi.addClosed({ startDate, endDate: endDate || startDate, reason: reason.trim() || null })
              setStart('')
              setEnd('')
              setReason('')
              onChanged()
            } catch (caught) {
              setError(errorText(caught))
            }
          }}
          className="vista-button-secondary min-h-11 disabled:opacity-50"
        >
          Add closed dates
        </button>
      </div>
      {error ? <p className="text-xs font-bold text-serious">{error}</p> : null}
    </Panel>
  )
}

function Templates({ initial, workTypes }: { initial: SlotTemplate[]; workTypes: WorkType[] }) {
  const [rows, setRows] = useState<SlotTemplate[]>(initial)
  const [message, setMessage] = useState<string | null>(null)
  const set = (index: number, change: Partial<SlotTemplate>) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)))

  return (
    <Panel className="space-y-3">
      <h3 className="text-sm font-black uppercase tracking-[0.06em]">The usual week’s shifts</h3>
      <p className="text-xs text-muted">
        New roster weeks start from these. Any start and end time works — 4:30 pm to 9:00 pm is simply 4.5 hours. An end at
        or before the start runs past midnight.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="font-mono text-[0.62rem] uppercase tracking-[0.07em] text-muted">
              <th className="py-1 pr-2">Day</th>
              <th className="py-1 pr-2">Start</th>
              <th className="py-1 pr-2">End</th>
              <th className="py-1 pr-2">Hours</th>
              <th className="py-1 pr-2">Staff needed</th>
              <th className="py-1 pr-2">Can be one person</th>
              <th className="py-1 pr-2">Work type</th>
              <th className="py-1 pr-2">Label</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td className="py-1 pr-2">
                  <select value={row.weekday} onChange={(event) => set(index, { weekday: Number(event.target.value) })} className="vista-control px-1" aria-label="Day">
                    {WEEKDAYS.map((name, weekday) => (
                      <option key={name} value={weekday}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input type="time" value={row.startTime} onChange={(event) => set(index, { startTime: event.target.value })} className="vista-control px-1" aria-label="Start" />
                </td>
                <td className="py-1 pr-2">
                  <input type="time" value={row.endTime} onChange={(event) => set(index, { endTime: event.target.value })} className="vista-control px-1" aria-label="End" />
                </td>
                <td className="py-1 pr-2 tabular text-muted">{Math.round((minutes(row.startTime, row.endTime) / 60) * 100) / 100}h</td>
                <td className="py-1 pr-2">
                  <input type="number" min={1} value={row.requiredStaff} onChange={(event) => set(index, { requiredStaff: Number(event.target.value) })} className="vista-control w-16 px-1" aria-label="Staff needed" />
                </td>
                <td className="py-1 pr-2">
                  <input type="checkbox" checked={row.canRunSolo} onChange={(event) => set(index, { canRunSolo: event.target.checked })} aria-label="Can be one person" />
                </td>
                <td className="py-1 pr-2">
                  <select value={row.workTypeId ?? ''} onChange={(event) => set(index, { workTypeId: event.target.value || null })} className="vista-control px-1" aria-label="Work type">
                    <option value="">Staff member’s usual</option>
                    {workTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input value={row.label ?? ''} onChange={(event) => set(index, { label: event.target.value || null })} placeholder="e.g. Closing" className="vista-control w-28 px-1" aria-label="Label" />
                </td>
                <td>
                  <button type="button" aria-label="Remove shift" onClick={() => setRows(rows.filter((_, at) => at !== index))} className="grid size-8 place-items-center text-muted hover:text-critical">
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const last = rows.at(-1)
            setRows([
              ...rows,
              last
                ? { ...last, weekday: (last.weekday + 1) % 7, id: undefined }
                : { weekday: 0, startTime: '17:00', endTime: '22:00', requiredStaff: 1, canRunSolo: true, roleTags: [], workTypeId: null, label: null },
            ])
          }}
          className="vista-button-secondary flex min-h-11 items-center gap-1"
        >
          <Plus aria-hidden="true" className="size-4" /> Add a shift
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              await rosterApi.saveTemplates(rows.map(({ id: _id, ...row }) => row))
              setMessage('Saved. Weeks already created are not changed.')
            } catch (caught) {
              setMessage(errorText(caught))
            }
          }}
          className="vista-button-primary min-h-11"
        >
          Save the usual week
        </button>
        {message ? <span className="text-sm font-bold text-muted">{message}</span> : null}
      </div>
    </Panel>
  )
}

export function TimetableTab() {
  const { data, error, reload } = useLoad(() => Promise.all([rosterApi.scheduleSetup(), teamApi.listWorkTypes()]))
  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading timetable…</p>
  const [setup, types] = data
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Hours initial={setup.operatingHours} />
        <Closed initial={setup.closedPeriods} onChanged={reload} />
      </div>
      <Templates initial={setup.templates} workTypes={types.workTypes.filter((type) => type.isActive)} />
    </div>
  )
}
