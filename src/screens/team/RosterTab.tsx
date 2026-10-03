import { AlertTriangle, Check, Copy, Image as ImageIcon, Pencil, Plus, Printer, Trash2, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge, EmptyState } from '../../components/primitives.tsx'
import {
  addDaysTo,
  dateTimeText,
  dayName,
  hoursText,
  mondayOf,
  rosterApi,
  timeText,
  todayInKl,
  type RosterAssignment,
  type RosterSlot,
  type WeekDetail,
  type WeekSummary,
} from '../../data/roster-api.ts'
import { errorText, teamApi, useLoad, type WorkType } from '../../data/team-api.ts'
import { formatRinggit, parseRinggitToSen } from '../../domain/money.ts'
import { RosterShare } from './RosterShare.tsx'

/**
 * The roster, kept simple: make a week (empty, or a copy of an earlier one),
 * add or edit shifts — or copy a whole day's shifts from another day — let
 * staff pick the shifts they can work in the Team app, give the shifts out
 * from those picks (or by hand), publish, and export for the group chat.
 *
 * The suggested-roster engine and the fairness view still exist in the API;
 * they are simply not offered here for now.
 */

function NewWeek({ existing, onCreated }: { existing: WeekSummary[]; onCreated: (detail: WeekDetail) => void }) {
  const taken = new Set(existing.map((week) => week.weekStart))
  const options = Array.from({ length: 8 }, (_, index) => addDaysTo(mondayOf(todayInKl()), 7 * index)).filter((monday) => !taken.has(monday))
  const latest = existing[0] ?? null
  // Monday or Tuesday: this week is still worth planning. Later: next week.
  const weekday = (new Date(`${todayInKl()}T00:00:00Z`).getUTCDay() + 6) % 7
  const wanted = addDaysTo(mondayOf(todayInKl()), weekday <= 1 ? 0 : 7)
  const [weekStart, setWeekStart] = useState(options.find((monday) => monday >= wanted) ?? options[0] ?? '')
  const [copyFrom, setCopyFrom] = useState(latest?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      onCreated(await rosterApi.createWeek(weekStart, { copyFromWeekId: copyFrom || null }))
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border border-dashed border-line bg-surface p-3">
      <label className="block">
        <span className="vista-field-label">New roster week</span>
        <select value={weekStart} onChange={(event) => setWeekStart(event.target.value)} className="vista-control mt-1 w-full px-2">
          {options.map((monday) => (
            <option key={monday} value={monday}>
              Week of {dayName(monday, 'long')}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="vista-field-label">Shifts</span>
        <select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)} className="vista-control mt-1 w-full px-2">
          {existing.slice(0, 6).map((week) => (
            <option key={week.id} value={week.id}>
              Same shifts as {week.label}
            </option>
          ))}
          <option value="">Start empty</option>
        </select>
      </label>
      <button type="submit" disabled={!weekStart} className="vista-button-primary flex min-h-10 w-full items-center justify-center gap-1 disabled:opacity-50">
        <Plus aria-hidden="true" className="size-4" /> Create week
      </button>
      {error ? <p className="text-xs font-bold text-serious">{error}</p> : null}
    </form>
  )
}

/** Times, people needed, label and work type for a shift — adding one or editing one. */
function ShiftForm({
  initial,
  workTypes,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { startTime: string; endTime: string; requiredStaff: number; label: string | null; workTypeId: string | null }
  workTypes: WorkType[]
  submitLabel: string
  onSubmit: (value: { startTime: string; endTime: string; requiredStaff: number; label: string | null; workTypeId: string | null }) => Promise<void>
  onCancel: () => void
}) {
  const [startTime, setStart] = useState(initial.startTime)
  const [endTime, setEnd] = useState(initial.endTime)
  const [requiredStaff, setRequired] = useState(initial.requiredStaff)
  const [label, setLabel] = useState(initial.label ?? '')
  const [workTypeId, setWorkType] = useState(initial.workTypeId ?? '')

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        await onSubmit({ startTime, endTime, requiredStaff, label: label.trim() || null, workTypeId: workTypeId || null })
      }}
      className="space-y-2 border border-rail/40 bg-canvas p-2 text-xs"
    >
      <div className="grid grid-cols-2 gap-1">
        <label className="block">
          <span className="vista-field-label">Start</span>
          <input type="time" value={startTime} onChange={(event) => setStart(event.target.value)} className="vista-control w-full px-1" />
        </label>
        <label className="block">
          <span className="vista-field-label">End</span>
          <input type="time" value={endTime} onChange={(event) => setEnd(event.target.value)} className="vista-control w-full px-1" />
        </label>
        <label className="block">
          <span className="vista-field-label">People needed</span>
          <input type="number" min={1} value={requiredStaff} onChange={(event) => setRequired(Number(event.target.value))} className="vista-control w-full px-1" />
        </label>
        <label className="block">
          <span className="vista-field-label">Pay as</span>
          <select value={workTypeId} onChange={(event) => setWorkType(event.target.value)} className="vista-control w-full px-1">
            <option value="">Their usual</option>
            {workTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="vista-field-label">Label (optional)</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Closing" maxLength={40} className="vista-control w-full px-1" />
      </label>
      <div className="flex gap-1">
        <button type="submit" className="vista-button-primary min-h-9 flex-1">
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="vista-button-secondary min-h-9">
          Cancel
        </button>
      </div>
    </form>
  )
}

function RateEditor({
  assignment,
  workTypes,
  onChange,
  onClose,
}: {
  assignment: RosterAssignment
  workTypes: WorkType[]
  onChange: (body: Parameters<typeof rosterApi.updateAssignment>[1]) => Promise<void>
  onClose: () => void
}) {
  const [rate, setRate] = useState(assignment.rateOverrideSen === null ? '' : (assignment.rateOverrideSen / 100).toFixed(2))
  const [reason, setReason] = useState(assignment.rateOverrideReason ?? '')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-1 space-y-2 border border-rail/40 bg-canvas p-2 text-xs">
      <div className="flex items-center">
        <span className="font-black">Pay for {assignment.staffName} on this shift</span>
        <button type="button" aria-label="Close" onClick={onClose} className="ml-auto grid size-7 place-items-center">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <select
        value={assignment.workTypeId ?? ''}
        onChange={(event) => void onChange({ workTypeId: event.target.value || null })}
        aria-label="Pay as"
        className="vista-control w-full px-2"
      >
        <option value="">Their usual rate</option>
        {workTypes.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name} · {formatRinggit(type.rateSenPerHour)}/h
          </option>
        ))}
      </select>
      <div className="grid grid-cols-[6rem_1fr] gap-1">
        <input value={rate} onChange={(event) => setRate(event.target.value)} inputMode="decimal" placeholder="One-off RM/h" aria-label="One-off rate per hour" className="vista-control w-full px-2" />
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why, e.g. event night" aria-label="Reason" className="vista-control w-full px-2" />
      </div>
      <button
        type="button"
        onClick={async () => {
          const sen = rate.trim() === '' ? null : parseRinggitToSen(rate)
          if (rate.trim() !== '' && sen === null) {
            setError('Enter a rate like 12.00, or leave it blank.')
            return
          }
          await onChange({ rateOverrideSen: sen, rateOverrideReason: sen === null ? null : reason.trim() || null })
        }}
        className="vista-button-secondary min-h-9"
      >
        Save one-off rate
      </button>
      {error ? <p className="font-bold text-serious">{error}</p> : null}
    </div>
  )
}

function SlotCard({
  slot,
  detail,
  workTypes,
  onDetail,
  onError,
}: {
  slot: RosterSlot
  detail: WeekDetail
  workTypes: WorkType[]
  onDetail: (next: WeekDetail) => void
  onError: (message: string) => void
}) {
  const [editingShift, setEditingShift] = useState(false)
  const [editingPay, setEditingPay] = useState<string | null>(null)
  const active = slot.assignments.filter((assignment) => assignment.status === 'ACTIVE')
  const choices = detail.staff.filter((staff) => staff.status === 'ACTIVE' && !active.some((assignment) => assignment.staffId === staff.id))
  const clashes = detail.warnings.filter((warning) => warning.slotId === slot.id && warning.kind === 'OVERLAP')
  // Who picked this shift in the Team app and is not on it yet, first pick first.
  const picks = slot.applicants
    .filter((pick) => !active.some((assignment) => assignment.staffId === pick.staffId))
    .toSorted((a, b) => a.appliedAt.localeCompare(b.appliedAt))
    .flatMap((pick) => detail.staff.filter((staff) => staff.id === pick.staffId && staff.status === 'ACTIVE'))

  async function run(action: () => Promise<WeekDetail>) {
    try {
      onDetail(await action())
    } catch (caught) {
      onError(errorText(caught))
    }
  }

  async function assign(staffId: string) {
    if (!staffId) return
    try {
      const result = await rosterApi.assign(slot.id, staffId)
      onDetail(result.detail)
      const clash = result.warnings.find((warning) => warning.kind === 'OVERLAP')
      if (clash) onError(`Added — but note: ${clash.message}`)
    } catch (caught) {
      onError(errorText(caught))
    }
  }

  if (editingShift) {
    return (
      <ShiftForm
        initial={slot}
        workTypes={workTypes}
        submitLabel="Save shift"
        onCancel={() => setEditingShift(false)}
        onSubmit={async (value) => {
          await run(() => rosterApi.updateSlot(slot.id, { ...value, canRunSolo: value.requiredStaff === 1 }))
          setEditingShift(false)
        }}
      />
    )
  }

  const short = active.length < slot.requiredStaff
  return (
    <article className={`border bg-surface p-3 ${slot.openCoverage?.isUrgent ? 'border-critical' : short ? 'border-warning/60' : 'border-line'}`}>
      <button type="button" onClick={() => setEditingShift(true)} title="Edit this shift" className="block w-full text-left">
        <span className="block whitespace-nowrap font-bold hover:underline">
          {timeText(slot.startTime)}–{timeText(slot.endTime)}
        </span>
        <span className="block text-xs text-muted">
          {hoursText(slot.minutes)} · {active.length} of {slot.requiredStaff} {slot.requiredStaff === 1 ? 'person' : 'people'}
          {slot.label ? ` · ${slot.label}` : ''}
        </span>
      </button>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEditingShift(true)}
          className="flex min-h-8 items-center gap-1 border border-line px-2 text-xs font-bold text-ink hover:bg-canvas"
        >
          <Pencil aria-hidden="true" className="size-3.5" /> Edit
        </button>
        <button
          type="button"
          aria-label="Delete shift"
          title="Delete shift"
          onClick={() => {
            if (window.confirm('Delete this shift?')) void run(() => rosterApi.removeSlot(slot.id))
          }}
          className="ml-auto grid size-8 shrink-0 place-items-center text-muted hover:text-critical"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </div>

      {slot.openCoverage ? (
        <p className={`mt-2 px-2 py-1 text-xs font-bold ${slot.openCoverage.isUrgent ? 'bg-red-100 text-critical' : 'bg-amber-100 text-warning'}`}>
          {slot.openCoverage.vacatedBy ?? 'Someone'} can’t make it.{' '}
          {slot.openCoverage.askingName
            ? `Asking ${slot.openCoverage.askingName} in the app — or add someone below.`
            : 'Nobody else is free to ask — add someone below.'}
        </p>
      ) : null}

      <ul className="mt-2 space-y-1">
        {active.map((assignment) => (
          <li key={assignment.id}>
            <div className="flex items-center gap-1 bg-canvas px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate font-bold">
                {assignment.staffName}
                {assignment.rateOverrideSen !== null ? <span className="ml-1 text-xs text-warning">{formatRinggit(assignment.rateOverrideSen)}/h</span> : null}
              </span>
              <button
                type="button"
                aria-label={`Pay for ${assignment.staffName} on this shift`}
                title="Pay for this shift"
                onClick={() => setEditingPay(editingPay === assignment.id ? null : assignment.id)}
                className="grid size-7 place-items-center text-xs font-bold text-muted hover:text-ink"
              >
                RM
              </button>
              <button
                type="button"
                aria-label={`Take ${assignment.staffName} off`}
                onClick={() => {
                  if (window.confirm(`Take ${assignment.staffName} off this shift?`)) void run(() => rosterApi.unassign(assignment.id))
                }}
                className="grid size-7 place-items-center text-muted hover:text-critical"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
            {editingPay === assignment.id ? (
              <RateEditor
                assignment={assignment}
                workTypes={workTypes}
                onClose={() => setEditingPay(null)}
                onChange={async (body) => run(() => rosterApi.updateAssignment(assignment.id, body))}
              />
            ) : null}
          </li>
        ))}
      </ul>

      {picks.length > 0 ? (
        <div className="mt-2 border-t border-dashed border-line pt-2">
          <p className="text-[0.7rem] font-bold uppercase tracking-wider text-muted">Picked by</p>
          <ul className="mt-1 space-y-1">
            {picks.map((staff) => (
              <li key={staff.id} className="flex items-center gap-1 text-sm">
                <span className="min-w-0 flex-1 truncate">{staff.name}</span>
                <button
                  type="button"
                  onClick={() => void assign(staff.id)}
                  aria-label={`Give this shift to ${staff.name}`}
                  className="flex min-h-7 items-center gap-1 bg-rail px-2 text-xs font-bold text-white hover:opacity-90"
                >
                  <Check aria-hidden="true" className="size-3.5" /> Give
                </button>
              </li>
            ))}
          </ul>
          {!short ? <p className="mt-1 text-[0.7rem] text-muted">This shift is already full.</p> : null}
        </div>
      ) : null}

      {choices.length > 0 ? (
        <select
          value=""
          onChange={(event) => void assign(event.target.value)}
          aria-label="Add someone to this shift"
          className="vista-control mt-2 w-full px-2 text-xs"
        >
          <option value="">+ Add someone…</option>
          {choices.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.name}
            </option>
          ))}
        </select>
      ) : null}

      {clashes.map((warning, index) => (
        <p key={index} className="mt-2 flex gap-1 text-[0.7rem] font-bold text-warning">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-3 shrink-0" /> {warning.message}
        </p>
      ))}
    </article>
  )
}

function DayColumn({
  date,
  detail,
  workTypes,
  onDetail,
  onError,
}: {
  date: string
  detail: WeekDetail
  workTypes: WorkType[]
  onDetail: (next: WeekDetail) => void
  onError: (message: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const slots = detail.slots.filter((slot) => slot.date === date)
  const otherDays = Array.from({ length: 7 }, (_, index) => addDaysTo(detail.week.weekStart, index)).filter(
    (other) => other !== date && detail.slots.some((slot) => slot.date === other),
  )
  const last = slots.at(-1)

  async function copyFrom(fromDate: string) {
    if (!fromDate) return
    if (slots.length > 0 && !window.confirm(`Replace ${dayName(date)}’s shifts with ${dayName(fromDate)}’s? People on them are taken off.`)) return
    try {
      onDetail(await rosterApi.copyDay(detail.week.id, date, fromDate))
    } catch (caught) {
      onError(errorText(caught))
    }
  }

  return (
    <section className="space-y-2">
      <h4 className="font-mono text-xs font-bold uppercase tracking-[0.06em] text-muted">{dayName(date)}</h4>
      {slots.map((slot) => (
        <SlotCard key={slot.id} slot={slot} detail={detail} workTypes={workTypes} onDetail={onDetail} onError={onError} />
      ))}
      {adding ? (
        <ShiftForm
          initial={{ startTime: last?.startTime ?? '17:00', endTime: last?.endTime ?? '22:00', requiredStaff: 1, label: null, workTypeId: null }}
          workTypes={workTypes}
          submitLabel="Add shift"
          onCancel={() => setAdding(false)}
          onSubmit={async (value) => {
            try {
              onDetail(await rosterApi.addSlot(detail.week.id, { date, ...value, canRunSolo: value.requiredStaff === 1, roleTags: [] }))
              setAdding(false)
            } catch (caught) {
              onError(errorText(caught))
            }
          }}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex min-h-9 w-full items-center justify-center gap-1 border border-dashed border-line text-xs font-bold text-muted hover:text-ink">
          <Plus aria-hidden="true" className="size-3.5" /> Add shift
        </button>
      )}
      {otherDays.length > 0 ? (
        <label className="flex items-center gap-1 text-xs text-muted">
          <Copy aria-hidden="true" className="size-3.5 shrink-0" />
          <select value="" onChange={(event) => void copyFrom(event.target.value)} aria-label={`Copy shifts to ${dayName(date)} from another day`} className="min-h-9 w-full bg-transparent text-xs font-bold">
            <option value="">Copy shifts from…</option>
            {otherDays.map((other) => (
              <option key={other} value={other}>
                {dayName(other)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </section>
  )
}

function WeekView({
  weekId,
  workTypes,
  onChanged,
  onDeleted,
}: {
  weekId: string
  workTypes: WorkType[]
  onChanged: () => void
  onDeleted: () => void
}) {
  const { data, error, setData } = useLoad(() => rosterApi.week(weekId))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading week…</p>

  const update = (next: WeekDetail) => {
    setData(next)
    onChanged()
  }
  const act = async (action: () => Promise<WeekDetail>) => {
    setBusy(true)
    setMessage(null)
    try {
      update(await action())
    } catch (caught) {
      setMessage(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  const published = data.week.status === 'PUBLISHED'
  const picking = data.week.status === 'APPLICATIONS_OPEN'
  const pickers = new Set(data.slots.flatMap((slot) => slot.applicants.map((pick) => pick.staffId))).size
  // Picks not yet turned into a place on the shift.
  const waitingPicks = data.slots.reduce(
    (sum, slot) =>
      sum +
      slot.applicants.filter((pick) => !slot.assignments.some((assignment) => assignment.status === 'ACTIVE' && assignment.staffId === pick.staffId)).length,
    0,
  )
  const stageText = published
    ? 'Published — staff can see their shifts'
    : picking
      ? 'Staff are picking shifts in the Team app'
      : data.week.status === 'DRAFT'
        ? 'Draft — staff cannot see it yet'
        : 'Picking closed — staff cannot see the roster yet'

  async function giveFromPicks() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await rosterApi.fillFromPicks(data!.week.id)
      update(result.detail)
      setMessage(
        result.added === 0 && result.leftOver === 0
          ? 'Nothing to give — no new picks.'
          : `Gave out ${result.added} shift${result.added === 1 ? '' : 's'}.` +
              (result.leftOver > 0
                ? ` ${result.leftOver} pick${result.leftOver === 1 ? '' : 's'} did not fit (shift full, or they already work then) — still listed under “Picked by”.`
                : ''),
      )
    } catch (caught) {
      setMessage(errorText(caught))
    } finally {
      setBusy(false)
    }
  }
  const days = Array.from({ length: 7 }, (_, index) => addDaysTo(data.week.weekStart, index))
  const unfilled = data.slots.reduce(
    (sum, slot) => sum + Math.max(0, slot.requiredStaff - slot.assignments.filter((assignment) => assignment.status === 'ACTIVE').length),
    0,
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h3 className="font-display text-2xl font-bold">Week of {dayName(data.week.weekStart, 'long')}</h3>
          <p className="text-xs text-muted">
            {stageText} · last updated {dateTimeText(data.week.updatedAt)}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {published ? (
            <button type="button" disabled={busy} onClick={() => act(() => rosterApi.setStatus(data.week.id, 'DRAFT'))} className="vista-button-secondary min-h-11 disabled:opacity-50">
              Unpublish
            </button>
          ) : (
            <>
              {picking ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(() => rosterApi.setStatus(data.week.id, 'APPLICATIONS_CLOSED'))}
                  className="vista-button-secondary min-h-11 disabled:opacity-50"
                >
                  Stop picking
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (data.slots.length === 0) {
                      setMessage('Add the week’s shifts first, then let staff pick.')
                      return
                    }
                    void act(() => rosterApi.setStatus(data.week.id, 'APPLICATIONS_OPEN'))
                  }}
                  className="vista-button-secondary min-h-11 disabled:opacity-50"
                >
                  Let staff pick shifts
                </button>
              )}
              {waitingPicks > 0 ? (
                <button type="button" disabled={busy} onClick={() => void giveFromPicks()} className="vista-button-secondary min-h-11 disabled:opacity-50">
                  Give shifts to who picked
                </button>
              ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const warning =
                  data.slots.length === 0
                    ? 'This week has no shifts yet. Publish it anyway?'
                    : unfilled > 0
                      ? `${unfilled} place${unfilled === 1 ? ' is' : 's are'} still empty. Publish anyway? Staff will only see their own shifts.`
                      : null
                if (warning && !window.confirm(warning)) return
                void act(() => rosterApi.publish(data.week.id))
              }}
              className="vista-button-primary min-h-11 px-5 disabled:opacity-50"
            >
              Publish to staff
            </button>
            </>
          )}
          <button type="button" onClick={() => setSharing(true)} className="vista-button-secondary flex min-h-11 items-center gap-2">
            <ImageIcon aria-hidden="true" className="size-4" /> <Printer aria-hidden="true" className="size-4" /> Export
          </button>
          {published ? null : (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm('Delete this whole week and its shifts?')) return
                try {
                  await rosterApi.deleteWeek(data.week.id)
                  onDeleted()
                } catch (caught) {
                  setMessage(errorText(caught))
                }
              }}
              className="min-h-11 border border-critical/40 px-3 text-xs font-bold text-critical"
            >
              Delete week
            </button>
          )}
        </div>
      </div>

      {message ? (
        <div role="alert" className="flex items-start gap-2 bg-amber-50 p-3 text-sm font-bold text-warning">
          <p className="flex-1">{message}</p>
          <button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}>
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      {picking ? (
        <p className="bg-rail-soft p-3 text-sm">
          <strong>Staff can now pick shifts</strong> at team.vistahub.my.{' '}
          {pickers === 0
            ? 'Nobody has picked yet.'
            : `${pickers} ${pickers === 1 ? 'person has' : 'people have'} picked. Their names show on each shift under “Picked by”.`}{' '}
          When you are ready, press <strong>Give shifts to who picked</strong> (or tap Give on a name), check the roster, then <strong>Publish</strong>.
        </p>
      ) : null}

      {data.slots.length === 0 ? (
        <Badge tone="warning">No shifts yet — use “Add shift” on each day</Badge>
      ) : (
        <Badge tone={unfilled ? 'warning' : 'good'}>{unfilled ? `${unfilled} place${unfilled === 1 ? '' : 's'} still to fill` : 'Every shift filled'}</Badge>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        {days.map((date) => (
          <DayColumn key={date} date={date} detail={data} workTypes={workTypes} onDetail={update} onError={setMessage} />
        ))}
      </div>

      {sharing ? <RosterShare weekId={data.week.id} onClose={() => setSharing(false)} /> : null}
    </div>
  )
}

export function RosterTab() {
  const { data, error, reload } = useLoad(() => Promise.all([rosterApi.weeks(), teamApi.listWorkTypes()]))
  const [selected, setSelected] = useState<string | null>(null)

  if (error && !data) return <p className="text-sm font-bold text-serious">{error}</p>
  if (!data) return <p className="text-sm text-muted">Loading rosters…</p>
  const [{ weeks }, { workTypes }] = data
  const current = selected ?? weeks[0]?.id ?? null

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="space-y-2">
        <NewWeek
          // Starts afresh whenever the list changes, so it never offers a week just taken.
          key={weeks.map((week) => week.id).join()}
          existing={weeks}
          onCreated={(detail) => {
            setSelected(detail.week.id)
            reload()
          }}
        />
        {weeks.length === 0 ? null : (
        <ul className="border border-line bg-surface">
          {weeks.map((week) => (
            <li key={week.id}>
              <button
                type="button"
                onClick={() => setSelected(week.id)}
                aria-current={current === week.id ? 'true' : undefined}
                className={`w-full border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-canvas ${current === week.id ? 'bg-canvas shadow-[inset_3px_0_0_var(--color-rail)]' : ''}`}
              >
                <span className="block text-sm font-bold">{week.label}</span>
                <span className="block text-xs text-muted">
                  {week.status === 'PUBLISHED' ? 'Published' : week.status === 'APPLICATIONS_OPEN' ? 'Staff picking' : 'Draft'} · {week.filled}/{week.seats} filled
                </span>
              </button>
            </li>
          ))}
        </ul>
        )}
      </aside>
      {current ? (
        <WeekView
          key={current}
          weekId={current}
          workTypes={workTypes.filter((type) => type.isActive)}
          onChanged={reload}
          onDeleted={() => {
            setSelected(null)
            reload()
          }}
        />
      ) : (
        <EmptyState title="No roster weeks yet" hint="Create one on the left, then add shifts to each day." />
      )}
    </div>
  )
}
