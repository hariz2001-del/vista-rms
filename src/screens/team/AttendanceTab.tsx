import { Check, Pencil, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, EmptyState, Panel } from '../../components/primitives.tsx'
import { TimeInput } from '../../components/TimeInput.tsx'
import {
  addDaysTo,
  clockText,
  dayName,
  hoursText,
  mondayOf,
  mytIso,
  mytParts,
  payrollApi,
  timeText,
  todayInKl,
  type Attendance,
} from '../../data/roster-api.ts'
import { errorText, teamApi, useLoad, type Staff, type WorkType } from '../../data/team-api.ts'
import { formatRinggit } from '../../domain/money.ts'

const FLAG_LABEL: Record<string, string> = {
  NO_CLOCK_OUT: 'No clock-out',
  UNROSTERED: 'Not on the roster',
  NO_RATE: 'No rate',
}

/** Start and end as date + time fields; the end may fall on the next day. */
function TimesEditor({
  record,
  workTypes,
  onSave,
  onCancel,
  saveLabel,
}: {
  record: Attendance
  workTypes: WorkType[]
  onSave: (body: { approvedStartAt: string; approvedEndAt: string; workTypeId: string | null }) => Promise<void>
  onCancel: () => void
  saveLabel: string
}) {
  const start = mytParts(record.approvedStartAt ?? record.clockInAt)
  const endIso = record.approvedEndAt ?? record.clockOutAt
  const end = endIso ? mytParts(endIso) : { date: start.date, time: '' }
  const [startTime, setStartTime] = useState(start.time)
  const [endDate, setEndDate] = useState(end.date)
  const [endTime, setEndTime] = useState(end.time)
  const [workTypeId, setWorkTypeId] = useState(record.workTypeId ?? '')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-2 grid gap-2 border border-rail/40 bg-canvas p-3 text-xs sm:grid-cols-[auto_auto_auto_1fr_auto]">
      <label className="block">
        <span className="vista-field-label">Start ({dayName(start.date)})</span>
        <span className="mt-1 block"><TimeInput label="Start" value={startTime} onChange={setStartTime} className="vista-control px-2" /></span>
      </label>
      <label className="block">
        <span className="vista-field-label">End date</span>
        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="vista-control mt-1 px-2" />
      </label>
      <label className="block">
        <span className="vista-field-label">End</span>
        <span className="mt-1 block"><TimeInput label="End" value={endTime} onChange={setEndTime} className="vista-control px-2" /></span>
      </label>
      <label className="block">
        <span className="vista-field-label">Work type</span>
        <select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)} className="vista-control mt-1 w-full px-2">
          <option value="">From the shift / their usual</option>
          {workTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name} · {formatRinggit(type.rateSenPerHour)}/h
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end gap-1">
        <button
          type="button"
          disabled={!startTime || !endTime}
          onClick={async () => {
            setError(null)
            try {
              await onSave({
                approvedStartAt: mytIso(start.date, startTime),
                approvedEndAt: mytIso(endDate, endTime),
                workTypeId: workTypeId || null,
              })
            } catch (caught) {
              setError(errorText(caught))
            }
          }}
          className="vista-button-primary min-h-10 disabled:opacity-50"
        >
          {saveLabel}
        </button>
        <button type="button" onClick={onCancel} className="vista-button-secondary min-h-10">
          Cancel
        </button>
      </div>
      {error ? <p className="font-bold text-serious sm:col-span-5">{error}</p> : null}
    </div>
  )
}

function ManualEntry({ staff, workTypes, onAdded }: { staff: Staff[]; workTypes: WorkType[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [staffId, setStaffId] = useState('')
  const [date, setDate] = useState(todayInKl())
  const [start, setStart] = useState('17:00')
  const [end, setEnd] = useState('22:00')
  const [workTypeId, setWorkTypeId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const endDate = end <= start ? addDaysTo(date, 1) : date
    try {
      await payrollApi.addAttendance({
        staffId,
        startAt: mytIso(date, start),
        endAt: mytIso(endDate, end),
        workTypeId: workTypeId || null,
        note: note.trim() || null,
      })
      setOpen(false)
      onAdded()
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="vista-button-secondary min-h-11">
        Add time by hand
      </button>
    )
  }
  return (
    <Panel>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7 lg:items-end">
        <label className="block">
          <span className="vista-field-label">Who</span>
          <select value={staffId} onChange={(event) => setStaffId(event.target.value)} required className="vista-control mt-1 w-full px-2">
            <option value="">Choose…</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="vista-field-label">Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="vista-control mt-1 w-full px-2" />
        </label>
        <label className="block">
          <span className="vista-field-label">From</span>
          <span className="mt-1 block"><TimeInput label="From" value={start} onChange={setStart} className="vista-control px-2" /></span>
        </label>
        <label className="block">
          <span className="vista-field-label">To</span>
          <span className="mt-1 block"><TimeInput label="To" value={end} onChange={setEnd} className="vista-control px-2" /></span>
        </label>
        <label className="block">
          <span className="vista-field-label">Work type</span>
          <select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)} className="vista-control mt-1 w-full px-2">
            <option value="">Their usual</option>
            {workTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="vista-field-label">Note</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} className="vista-control mt-1 w-full px-2" />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="vista-button-primary min-h-11">
            Add (approved)
          </button>
          <button type="button" onClick={() => setOpen(false)} className="vista-button-secondary min-h-11">
            Cancel
          </button>
        </div>
        {error ? <p className="text-xs font-bold text-serious lg:col-span-7">{error}</p> : null}
      </form>
    </Panel>
  )
}

/** Finished rostered shifts nobody has confirmed yet. One tap each, or all at once. */
function ToConfirm({ start, end, onDone }: { start: string; end: string; onDone: () => void }) {
  const { data, reload } = useLoad(() => payrollApi.unconfirmed(start, end))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const shifts = data?.shifts ?? []
  if (shifts.length === 0) return null

  async function confirm(ids: string[]) {
    setBusy(true)
    setProblem(null)
    try {
      await payrollApi.confirmWorked(ids)
      reload()
      onDone()
    } catch (caught) {
      setProblem(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="space-y-3 border-warning/60">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-black uppercase tracking-[0.06em]">
          {shifts.length} finished shift{shifts.length === 1 ? '' : 's'} to confirm
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => confirm(shifts.map((shift) => shift.assignmentId))}
          className="vista-button-primary ml-auto flex min-h-11 items-center gap-1 disabled:opacity-50"
        >
          <Check aria-hidden="true" className="size-4" /> Mark all as worked
        </button>
      </div>
      <ul className="divide-y divide-line text-sm">
        {shifts.map((shift) => (
          <li key={shift.assignmentId} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-24 font-bold">{shift.staffName}</span>
            <span>{dayName(shift.date)}</span>
            <span className="tabular">
              {timeText(shift.startTime)}–{timeText(shift.endTime)} · {hoursText(shift.minutes)}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => confirm([shift.assignmentId])}
              className="vista-button-secondary ml-auto min-h-10 disabled:opacity-50"
            >
              Worked
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Didn’t work it, or different times? Confirm it, then use Edit times or Reject below.</p>
      {problem ? <p className="text-xs font-bold text-critical">{problem}</p> : null}
    </Panel>
  )
}

export function AttendanceTab() {
  const [start, setStart] = useState(mondayOf(todayInKl()))
  const [status, setStatus] = useState('')
  const end = addDaysTo(start, 6)
  const { data, error, reload } = useLoad(() => payrollApi.attendance(start, end, status || undefined))
  const people = useLoad(() => Promise.all([teamApi.listStaff(), teamApi.listWorkTypes()]))
  const [editing, setEditing] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const [staffList, typeList] = people.data ?? [{ staff: [] }, { workTypes: [] }]
  const workTypes = typeList.workTypes.filter((type) => type.isActive)

  async function act(action: () => Promise<unknown>) {
    setProblem(null)
    try {
      await action()
      setEditing(null)
      reload()
    } catch (caught) {
      setProblem(errorText(caught))
    }
  }

  const shift = (days: number) => {
    setStart(addDaysTo(start, days))
    setTimeout(reload, 0)
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[70ch] text-sm text-muted">
        Payroll pays only hours confirmed here. After each shift, confirm the rostered people worked it — adjust the
        times if someone came late or left early. Changing hours after payroll is paid never changes the paid amount;
        the difference shows in Payroll as an adjustment.
      </p>
      <ToConfirm key={start} start={start} end={end} onDone={reload} />
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" onClick={() => shift(-7)} className="vista-button-secondary min-h-11">
          ← Earlier
        </button>
        <p className="min-w-48 text-center font-bold">
          {dayName(start)} – {dayName(end)}
        </p>
        <button type="button" onClick={() => shift(7)} className="vista-button-secondary min-h-11">
          Later →
        </button>
        <label className="block">
          <span className="vista-field-label">Show</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setTimeout(reload, 0)
            }}
            className="vista-control mt-1 px-2"
          >
            <option value="">Everything</option>
            <option value="PENDING">Waiting for approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
        </label>
        <div className="ml-auto">
          <ManualEntry staff={staffList.staff.filter((member) => member.status === 'ACTIVE')} workTypes={workTypes} onAdded={reload} />
        </div>
      </div>

      {problem ? <p role="alert" className="bg-red-50 p-3 text-sm font-bold text-critical">{problem}</p> : null}
      {error && !data ? <p className="text-sm font-bold text-serious">{error}</p> : null}
      {!data ? <p className="text-sm text-muted">Loading attendance…</p> : null}
      {data && data.attendance.length === 0 ? <EmptyState title="No hours confirmed this week yet" /> : null}

      {data && data.attendance.length > 0 ? (
        <ul className="space-y-2">
          {data.attendance.map((record) => (
            <li key={record.id} className="border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="min-w-28 font-bold">{record.staffName}</span>
                <span className="text-sm">{dayName(record.date)}</span>
                <span className="text-sm tabular">
                  {clockText(record.clockInAt)} – {record.clockOutAt ? clockText(record.clockOutAt) : '…'}
                </span>
                {record.approvedStartAt && record.approvedEndAt && (record.approvedStartAt !== record.clockInAt || record.approvedEndAt !== record.clockOutAt) ? (
                  <span className="text-xs font-bold text-rail">
                    pays {clockText(record.approvedStartAt)} – {clockText(record.approvedEndAt)}
                  </span>
                ) : null}
                <span className="text-xs text-muted">
                  {record.shift ? `Rostered ${timeText(record.shift.startTime)}–${timeText(record.shift.endTime)}` : ''}
                </span>
                <span className="text-sm tabular">
                  {record.payableMinutes !== null ? hoursText(record.payableMinutes) : '—'}
                  {record.rate ? ` × ${formatRinggit(record.rate.rateSenPerHour)} (${record.rate.workTypeName})` : ''}
                </span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {record.flags.map((flag) => (
                    <Badge key={flag} tone={flag === 'UNROSTERED' ? 'info' : 'warning'}>
                      {FLAG_LABEL[flag] ?? flag}
                    </Badge>
                  ))}
                  <Badge tone={record.status === 'APPROVED' ? 'good' : record.status === 'PENDING' ? 'warning' : 'neutral'}>
                    {record.status === 'APPROVED' ? 'Approved' : record.status === 'PENDING' ? 'Waiting' : 'Rejected'}
                  </Badge>
                  {record.payslipStatus ? <Badge tone="info">{record.payslipStatus === 'PAID' ? 'Paid' : 'On payslip'}</Badge> : null}
                </span>
              </div>
              {record.note ? <p className="mt-1 text-xs text-muted">Note: {record.note}</p> : null}

              <div className="mt-2 flex flex-wrap gap-2">
                {record.status === 'PENDING' && record.clockOutAt ? (
                  <button type="button" onClick={() => act(() => payrollApi.approveAttendance(record.id))} className="vista-button-primary flex min-h-10 items-center gap-1">
                    <Check aria-hidden="true" className="size-4" /> Approve as clocked
                  </button>
                ) : null}
                <button type="button" onClick={() => setEditing(editing === record.id ? null : record.id)} className="vista-button-secondary flex min-h-10 items-center gap-1">
                  <Pencil aria-hidden="true" className="size-4" /> {record.status === 'PENDING' ? 'Adjust and approve' : 'Edit times'}
                </button>
                {record.status !== 'REJECTED' ? (
                  <button
                    type="button"
                    onClick={() => {
                      const note = window.prompt('Why is this being rejected? (optional)') ?? undefined
                      void act(() => payrollApi.rejectAttendance(record.id, note))
                    }}
                    className="flex min-h-10 items-center gap-1 border border-line px-3 text-xs font-bold text-muted hover:text-critical"
                  >
                    <X aria-hidden="true" className="size-4" /> Reject
                  </button>
                ) : null}
              </div>
              {editing === record.id ? (
                <TimesEditor
                  record={record}
                  workTypes={workTypes}
                  saveLabel={record.status === 'PENDING' ? 'Approve these times' : 'Save'}
                  onCancel={() => setEditing(null)}
                  onSave={async (body) => {
                    if (record.status === 'PENDING') {
                      if (body.workTypeId !== record.workTypeId) await payrollApi.editAttendance(record.id, { workTypeId: body.workTypeId })
                      await payrollApi.approveAttendance(record.id, { approvedStartAt: body.approvedStartAt, approvedEndAt: body.approvedEndAt })
                    } else {
                      await payrollApi.editAttendance(record.id, body)
                    }
                    setEditing(null)
                    reload()
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
